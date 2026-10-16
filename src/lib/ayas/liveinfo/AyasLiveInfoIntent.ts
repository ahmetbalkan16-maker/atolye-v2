/**
 * AYAS personal assistant — live information intent (weather, news).
 *
 * Pure, deterministic text classification, the same pre-model posture as
 * `detectAyasResearchStatusIntent`: it decides whether the owner asked for the
 * weather ("Bursa'da hava nasıl?", "yarın yağmur yağacak mı") or for news
 * ("Gazze hakkındaki son haberler", "deprem haberlerini bul"), and pulls out
 * the place, the day or the topic. It reads nothing and fetches nothing; the
 * lookup lives in `AyasLiveInfoLookup.ts`.
 *
 * Precision over recall: a wording that is not clearly a weather or news
 * request returns `null` and keeps its earlier route. Turkish everyday phrases
 * that only look similar stay out — "ne haber" (a greeting), "bana haber ver",
 * "haberin var mı", "bugün hava çok güzel" (a statement), "hava fritözü",
 * "hava kalitesi", a triangle's "kaç derece" — and so do requests about AYAS's
 * own development, a project, a video or code.
 */
import { isAyasDevelopmentStatusQuery } from "../model/AyasComplexityRouter";

export type AyasWeatherDay =
  | { readonly kind: "today" }
  | { readonly kind: "offset"; readonly days: 1 | 2 }
  /** 0 = pazar … 6 = cumartesi, the `Date#getUTCDay` numbering. */
  | { readonly kind: "weekday"; readonly weekday: number }
  | { readonly kind: "weekend" };

export type AyasLiveInfoIntent =
  | { readonly kind: "weather"; readonly location: string | null; readonly day: AyasWeatherDay }
  | { readonly kind: "news"; readonly topic: string | null };

const MAX_TEXT = 400;
const MAX_TOPIC_WORDS = 6;
const MAX_TOPIC_CHARS = 80;

/** Turkish-aware fold to ASCII-ish lower case; apostrophes are normalised, other punctuation becomes a space. */
export function foldAyasLiveInfoText(text: string): string {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/[’‘`´]/g, "'")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ç/g, "c").replace(/ö/g, "o").replace(/ü/g, "u")
    .replace(/[âà]/g, "a").replace(/[îì]/g, "i").replace(/[ûù]/g, "u")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Token {
  readonly raw: string;
  readonly folded: string;
  /** The word without an apostrophe suffix: "Bursa'da" → "Bursa". */
  readonly base: string;
  readonly baseFolded: string;
  readonly apostrophe: boolean;
}

function tokenize(text: string): Token[] {
  const words = String(text ?? "").normalize("NFC").replace(/[’‘`´]/g, "'").match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
  return words.map((raw) => {
    const base = raw.split("'")[0]!;
    return { raw, folded: foldAyasLiveInfoText(raw), base, baseFolded: foldAyasLiveInfoText(base), apostrophe: raw.includes("'") };
  });
}

/** Requests about building, the studio or AYAS itself: never a live lookup. */
const NOT_A_LOOKUP = /\b(?:kod\w*|uygulama\w*|api\w*|script\w*|fonksiyon\w*|programla\w*|yazilim\w*|widget\w*|ozellig\w*|ozellik\w*|entegrasyon\w*|modul\w*|proje\w*|belgesel\w*|sahne\w*|senaryo\w*|metin\w*|metn\w*|video\w*|thumbnail\w*|atolye\w*|gelisim merkez\w*|commit\w*|repo\w*|dosya\w*)\b/u;

/* ----------------------------------------------------------------- weather --- */

// Exact day words with their usual suffixes only, so a place such as Salihli is not read as salı.
const WEEKDAY = /\b(pazartesi|sali|carsamba|persembe|cumartesi|cuma|pazar)(?:'?(?:ya|ye|a|e|yi|i|ki|dan|den|nin))?(?:\s+gunu)?\b/u;
const WEEKDAY_WORD = /^(?:pazartesi|sali|carsamba|persembe|cumartesi|cuma|pazar)(?:'?(?:ya|ye|a|e|yi|i|ki|dan|den|nin))?$/u;
const WEEKDAY_NUMBER: Readonly<Record<string, number>> = { pazar: 0, pazartesi: 1, sali: 2, carsamba: 3, persembe: 4, cuma: 5, cumartesi: 6 };

/** Words that may stand between "hava" and its question: time, place, filler. */
const FILLER = "(?:bugun|yarin|yarindan sonra|simdi|su an|orada|orda|burada|burda|disarida|disarisi|bu aksam|bu sabah|bu gece|aksam|sabah|gece|ogleden sonra|hafta sonu|obur gun|ertesi gun|acaba|peki|pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar|[\\p{L}\\p{N}]+'[\\p{L}]+)";
const WEATHER_PATTERNS: readonly RegExp[] = [
  /\bhava ?durum\w*/u,
  new RegExp(`\\bhava(?:lar)?\\s+(?:${FILLER}\\s+){0,3}(?:nasil|kac|ne durumda|ne alemde)\\b`, "u"),
  new RegExp(`\\bhava(?:lar)?\\s+(?:${FILLER}\\s+){0,3}(?:guzel|soguk|sicak|serin|ilik|yagmurlu|yagisli|bulutlu|acik|kapali|karli|ruzgarli|gunesli|bozuk|kotu|iyi)\\s+(?:olacak\\s+|mi\\s+olacak\\s+)?m[iu]\\b`, "u"),
  /\byagmur\w*\s+(?:\S+\s+){0,2}?(?:yagacak|yagar|yagiyor|var|bekleniyor|olacak|gelecek|gelir)\s*m[iu]\b/u,
  /\b(?:yagis|saganak|firtina)\w*\s+(?:\S+\s+){0,2}?(?:var|bekleniyor|olacak|gelecek|gelir)\s*m[iu]\b/u,
  /\b(?:kar|dolu)\s+(?:yagacak|yagar|yagiyor|bekleniyor)\b/u,
  /\bsemsiye\w*\s+(?:alayim|almali\w*|almam|lazim|gerek\w*)\b/u,
  /\bweather\b/u,
];
/** "kaç derece" only with a weather context, and never for angles, ovens or the body. */
const DEGREE_QUESTION = /\bkac derece\b/u;
const DEGREE_CONTEXT = /\b(?:hava\w*|disari\w*|bugun|yarin|simdi|su an|[\p{L}\p{N}]+'(?:da|de|ta|te|nda|nde))\b/u;
const DEGREE_NOT_WEATHER = /\b(?:aci\w*|ucgen\w*|kosegen\w*|egim\w*|firin\w*|ates\w*|vucut\w*|kaynar\w*|kaynama\w*|donma\w*|termometre\w*)\b/u;
const WEATHER_NOT = /\b(?:hava kalite\w*|hava kirlil\w*|havaalan\w*|hava liman\w*|hava yol\w*|havadan sudan|hava at\w*|hava kuvvet\w*|hava yastig\w*|hava fritoz\w*|hava temizle\w*|hava pompa\w*|hava filtre\w*|hava akim\w*|hava sartlandir\w*)\b/u;

/** Folded words that are never part of a place name in a weather question. */
const WEATHER_STOP = new Set([
  "hava", "havalar", "durumu", "durum", "durumunu", "durumuna", "nasil", "olacak", "olur", "olcak", "kac", "derece", "mi", "mu", "misin", "musun",
  "bugun", "bugunku", "yarin", "yarinki", "yarindan", "simdi", "su", "an", "anki", "peki", "acaba", "ayas", "bana", "bize", "soyle", "soyler", "soylesene",
  "bakar", "bak", "bakabilir", "bakalim", "bakarmisin", "internetten", "internette", "ogren", "ogrenebilir", "guzel", "soguk", "sicak", "serin", "ilik",
  "yagmur", "yagmurlu", "yagacak", "yagar", "yagiyor", "kar", "karli", "yagis", "yagisli", "saganak", "firtina", "dolu", "ruzgar", "ruzgarli", "bulutlu",
  "gunesli", "acik", "kapali", "bozuk", "kotu", "iyi", "var", "yok", "bu", "o", "aksam", "sabah", "gece", "ogle", "ogleden", "sonra", "hafta", "sonu",
  "ici", "obur", "ertesi", "gun", "gunu", "gunler", "icin", "de", "da", "ve", "ile", "ne", "durumda", "alemde", "sence", "dersin", "disari", "disarisi",
  "disarida", "cikalim", "cikayim", "cikmali", "miyim", "miyiz", "sicaklik", "sicakligi", "weather", "today", "tomorrow", "lutfen", "bi", "bir", "merak",
  "ediyorum", "kontrol", "et", "getir", "ver", "bilgi", "bilgisi", "tahmin", "tahmini", "nedir", "semsiye", "alayim", "almali", "lazim", "gerekir",
  "bekleniyor", "gelecek", "gelir", "orada", "orda", "burada", "burda", "selam", "merhaba", "hey", "neler", "nelerdir", "simdiki", "suan",
]);
/** An apostrophe word that is not a place: "AYAS'a", "Atölye'nin". */
const NOT_A_PLACE = new Set(["ayas", "atolye", "hava", "yarin", "bugun"]);

function weatherDay(t: string): AyasWeatherDay {
  if (/\bhafta ?sonu\w*/u.test(t)) return { kind: "weekend" };
  if (/\b(?:yarindan sonra|obur gun\w*|ertesi gun\w*)\b/u.test(t)) return { kind: "offset", days: 2 };
  if (/\byarin\w*/u.test(t)) return { kind: "offset", days: 1 };
  const weekday = WEEKDAY.exec(t);
  if (weekday) return { kind: "weekday", weekday: WEEKDAY_NUMBER[weekday[1]!]! };
  return { kind: "today" };
}

const isCapitalized = (raw: string): boolean => /^\p{Lu}/u.test(raw);

function weatherLocation(tokens: readonly Token[]): string | null {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!token.apostrophe || NOT_A_PLACE.has(token.baseFolded) || WEATHER_STOP.has(token.baseFolded) || WEEKDAY_WORD.test(token.baseFolded)) continue;
    // "New York'ta": capitalised words right before the suffixed one belong to the name.
    let start = i;
    while (start > 0 && i - start < 2) {
      const previous = tokens[start - 1]!;
      if (previous.apostrophe || !isCapitalized(previous.raw) || WEATHER_STOP.has(previous.folded) || WEEKDAY_WORD.test(previous.folded)) break;
      start--;
    }
    return [...tokens.slice(start, i).map((item) => item.raw), token.base].join(" ");
  }
  const rest = tokens.filter((token) => !WEATHER_STOP.has(token.folded) && !WEEKDAY_WORD.test(token.folded) && !/^\d+$/.test(token.folded));
  if (rest.length === 0 || rest.length > 3) return null;
  return rest.map((token) => token.raw).join(" ");
}

function isWeatherQuestion(t: string): boolean {
  if (WEATHER_NOT.test(t)) return false;
  if (WEATHER_PATTERNS.some((pattern) => pattern.test(t))) return true;
  return DEGREE_QUESTION.test(t) && DEGREE_CONTEXT.test(t) && !DEGREE_NOT_WEATHER.test(t);
}

/* -------------------------------------------------------------------- news --- */

/** Everyday phrases with the word "haber" that ask for no news: removed before matching. */
const NEWS_NOISE = /\b(?:ne haber\w*|naber\w*|haber ver\w*|haberin|haberiniz\w*|haberim\w*|haberdar\w*|haberci\w*)\b/gu;
const NEWS_PATTERNS: readonly RegExp[] = [
  /\bhaberler\w*/u,
  /\bhaber(?:i|ini)?\s+(?:\S+\s+)?(?:bul\w*|ara|arar|arastir\w*|getir\w*|oku\w*|soyle\w*|anlat\w*|ozetle\w*|goster\w*|bak\w*)\b/u,
  /\bson dakika\b/u,
  /\bmanset\w*/u,
  /\bgundem\w*\b.*\b(?:ne|neler|nedir|var|ozet\w*|anlat\w*|soyle\w*|oku\w*|bak\w*)\b/u,
  /\b(?:bugun\w*|gunun) gundem\w*/u,
];
/** "gelişmeler" counts as news only when asked for ("son gelişmeler", "… ile ilgili gelişmeler neler"). */
const DEVELOPMENTS = /\bgelisme\w*/u;
const DEVELOPMENTS_ASKED = /\b(?:son|hakkinda\w*|ilgili|konusunda\w*|dair|neler|nedir|ne durumda|anlat\w*|soyle\w*|ozetle\w*|bul\w*)\b/u;
/** "Bugün hangi gelişmeleri yaptın?" asks about AYAS, not the world. */
const SECOND_PERSON_PAST = /\b\p{L}+(?:din|dun|tin|tun)\b/u;

const NEWS_KEYWORD = /^(?:haber\w*|gelisme\w*|gundem\w*|manset\w*)$/u;
/** Folded words that are never part of a news topic. */
const NEWS_STOP = new Set([
  "bana", "bize", "ben", "sen", "sana", "internetten", "internette", "webden", "netten", "son", "en", "guncel", "guncelleme", "dakika", "bugun", "bugunun",
  "bugunku", "gunun", "simdi", "su", "an", "anki", "suan", "bu", "o", "bunu", "sunu", "onu", "hakkinda", "hakkindaki", "ile", "ilgili", "konusunda",
  "konusundaki", "uzerine", "dair", "neler", "ne", "var", "yok", "mi", "mu", "misin", "musun", "nedir", "bul", "bulur", "bulsana", "bulabilir", "ara",
  "arar", "arastir", "arastirir", "arastirsana", "getir", "getirir", "oku", "okur", "soyle", "soyler", "soylesene", "anlat", "anlatir", "ozetle",
  "ozetler", "goster", "gosterir", "bak", "bakar", "bakabilir", "ver", "verir", "ayas", "peki", "acaba", "lutfen", "bir", "bi", "ve", "de", "da", "ki",
  "gibi", "olan", "oldu", "olmus", "olanlar", "yasandi", "yasanan", "yeni", "dis", "takip", "et", "edip", "sonra", "ardindan", "hangi", "nerede",
  "neymis", "ne", "merak", "ediyorum", "ettim", "news", "latest", "today", "about", "on", "the", "selam", "merhaba", "hey", "icin", "gelismeleri",
  "gelismeler", "durum", "durumu", "durumda", "oldugunu", "olup", "biten", "bitenleri", "simdiki",
]);

function newsTopic(tokens: readonly Token[]): string | null {
  const keywordAt = tokens.findIndex((token) => NEWS_KEYWORD.test(token.folded));
  const pick = (list: readonly Token[]): string[] => list
    .filter((token) => !NEWS_STOP.has(token.folded) && !NEWS_STOP.has(token.baseFolded) && !NEWS_KEYWORD.test(token.folded) && !/^\d+$/.test(token.folded))
    .map((token) => token.base);
  let words = keywordAt >= 0 ? pick(tokens.slice(0, keywordAt)) : [];
  if (words.length === 0) words = pick(keywordAt >= 0 ? tokens.slice(keywordAt + 1) : tokens);
  if (words.length === 0) return null;
  return words.slice(0, MAX_TOPIC_WORDS).join(" ").slice(0, MAX_TOPIC_CHARS).trim() || null;
}

function isNewsQuestion(t: string): boolean {
  const cleaned = t.replace(NEWS_NOISE, " ");
  if (NEWS_PATTERNS.some((pattern) => pattern.test(cleaned))) return true;
  return DEVELOPMENTS.test(cleaned) && DEVELOPMENTS_ASKED.test(cleaned) && !SECOND_PERSON_PAST.test(cleaned);
}

/* ----------------------------------------------------------------- resolve --- */

export function detectAyasLiveInfoIntent(text: string): AyasLiveInfoIntent | null {
  const source = String(text ?? "").slice(0, MAX_TEXT);
  const t = foldAyasLiveInfoText(source);
  if (!t || NOT_A_LOOKUP.test(t) || isAyasDevelopmentStatusQuery(source)) return null;
  const tokens = tokenize(source);
  if (isWeatherQuestion(t)) return { kind: "weather", location: weatherLocation(tokens), day: weatherDay(t) };
  if (isNewsQuestion(t)) return { kind: "news", topic: newsTopic(tokens) };
  return null;
}
