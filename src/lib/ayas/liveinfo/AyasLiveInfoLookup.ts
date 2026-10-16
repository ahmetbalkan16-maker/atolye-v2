/**
 * AYAS personal assistant — live information lookup (weather, news).
 *
 * Answers an `AyasLiveInfoIntent` from a FIXED list of public sources and
 * returns one spoken Turkish answer (plain sentences, no links, no symbols,
 * because the console reads replies aloud):
 *
 *  - weather: Open-Meteo geocoding + forecast (free, keyless JSON);
 *  - news: Google Haberler RSS (search, or the Turkish top stories), with BBC
 *    News Türkçe's RSS as the fallback for top stories.
 *
 * Every request goes through `ayasSafePublicFetch` (SSRF, DNS-rebinding, size,
 * redirect and content-type boundary) behind this module's own host
 * allowlist, which is checked again on the final URL after redirects. GET
 * only; no cookie, credential, repository content or memory leaves the
 * machine — only the place name or the topic the owner just said.
 *
 * Runs no model and nothing else: text in, fixed public reads, text out. It
 * never throws; an unreachable source becomes an honest "ulaşamıyorum".
 */
import { ayasSafePublicFetch, classifyAyasFetchFailure, type AyasSafeFetchOptions, type AyasSafeFetchOutcome } from "../../brain/autonomy/AyasSafePublicFetch";
import { extractAyasFeedEntries } from "../../brain/autonomy/AyasFeedEntryExtractor";
import { detectAyasLiveInfoIntent, foldAyasLiveInfoText, type AyasLiveInfoIntent, type AyasWeatherDay } from "./AyasLiveInfoIntent";

/** The only hosts this lookup may read. */
export const AYAS_LIVE_INFO_HOSTS = Object.freeze(["geocoding-api.open-meteo.com", "api.open-meteo.com", "news.google.com", "feeds.bbci.co.uk"]);
export const AYAS_LIVE_INFO_FETCH_OPTIONS: AyasSafeFetchOptions = Object.freeze({ timeoutMs: 6_000, maxBodyBytes: 1_000_000, maxRedirects: 2, maxRetries: 1, retryBaseDelayMs: 300 });

export type AyasLiveInfoRead = (url: string) => Promise<AyasSafeFetchOutcome>;

export interface AyasLiveInfoDeps {
  /** Test seam; defaults to the allowlisted reader over `ayasSafePublicFetch`. */
  readonly read?: AyasLiveInfoRead;
  readonly now?: () => Date;
  readonly env?: NodeJS.ProcessEnv;
  /** Earlier turns of this conversation; only the owner's own weather questions are read, for the last place named. */
  readonly history?: readonly { readonly role: string; readonly text: string }[];
}

function isAllowedHost(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && AYAS_LIVE_INFO_HOSTS.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function refused(message: string): AyasSafeFetchOutcome {
  return { ok: false, code: "AYAS_FETCH_BLOCKED_HOST", message, failureClass: classifyAyasFetchFailure("AYAS_FETCH_BLOCKED_HOST"), attempts: 0 };
}

/** The production reader: host allowlist before the request and on the final URL after it. */
export function createAyasLiveInfoReader(transport: (url: string, options: AyasSafeFetchOptions) => Promise<AyasSafeFetchOutcome> = ayasSafePublicFetch): AyasLiveInfoRead {
  return async (url) => {
    if (!isAllowedHost(url)) return refused(`not a live-info host: ${url}`);
    const outcome = await transport(url, AYAS_LIVE_INFO_FETCH_OPTIONS);
    if (outcome.ok && !isAllowedHost(outcome.finalUrl)) return refused(`redirected off the live-info hosts: ${outcome.finalUrl}`);
    return outcome;
  };
}

function parseJson(outcome: AyasSafeFetchOutcome): Record<string, unknown> | null {
  if (!outcome.ok) return null;
  try {
    const value: unknown = JSON.parse(outcome.body);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

/* ----------------------------------------------------------------- weather --- */

const WEATHER_SERVICE_DOWN = "Hava durumu servisine şu an ulaşamıyorum; biraz sonra tekrar dener misin?";
const WEATHER_ASK_PLACE = "Hangi şehir için bakayım? Şehrin adıyla sorarsan, örneğin Bursa'da hava nasıl diye, hemen bakarım.";
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const WEEKDAYS = ["pazar", "pazartesi", "salı", "çarşamba", "perşembe", "cuma", "cumartesi"];

/** WMO weather interpretation codes (Open-Meteo `weather_code`) as a word that reads after "hava". */
const WEATHER_CODES: Readonly<Record<number, string>> = {
  0: "açık", 1: "çoğunlukla açık", 2: "parçalı bulutlu", 3: "kapalı", 45: "sisli", 48: "kırağılı ve sisli",
  51: "hafif çisentili", 53: "çisentili", 55: "yoğun çisentili", 56: "dondurucu çisentili", 57: "dondurucu çisentili",
  61: "hafif yağmurlu", 63: "yağmurlu", 65: "şiddetli yağmurlu", 66: "dondurucu yağmurlu", 67: "dondurucu yağmurlu",
  71: "hafif karlı", 73: "karlı", 75: "yoğun karlı", 77: "kar taneli", 80: "hafif sağanak yağışlı", 81: "sağanak yağışlı",
  82: "şiddetli sağanak yağışlı", 85: "hafif kar sağanaklı", 86: "yoğun kar sağanaklı", 95: "gök gürültülü fırtınalı",
  96: "dolulu gök gürültülü fırtınalı", 99: "dolulu gök gürültülü fırtınalı",
};
const describeCode = (code: number | null): string => (code === null ? undefined : WEATHER_CODES[code]) ?? "değişken";
/** Spoken degrees: "eksi 3", never a bare minus sign. */
function degrees(value: number): string {
  const rounded = Math.round(value);
  return rounded < 0 ? `eksi ${Math.abs(rounded)}` : String(rounded);
}

interface Place { readonly name: string; readonly label: string; readonly latitude: number; readonly longitude: number }

/** Bursa'da/bursada → bursa: a single typed word may carry a Turkish case suffix the geocoder does not know. */
function placeCandidates(location: string): string[] {
  const candidates = [location.trim()];
  const folded = foldAyasLiveInfoText(location);
  if (!folded.includes(" ")) {
    const match = /^(.{3,}?)(?:nda|nde|ndan|nden|da|de|ta|te|dan|den|tan|ten|ya|ye|nın|nin|nun|nün|ın|in|un|ün)$/u.exec(location.trim().toLocaleLowerCase("tr"));
    if (match?.[1] && match[1] !== candidates[0]!.toLocaleLowerCase("tr")) candidates.push(match[1]);
  }
  return candidates.slice(0, 2);
}

type GeocodeOutcome = { readonly ok: true; readonly place: Place } | { readonly ok: false; readonly reason: "not-found" | "unavailable" };

async function geocode(read: AyasLiveInfoRead, name: string): Promise<GeocodeOutcome> {
  const outcome = await read(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=tr&format=json`);
  const json = parseJson(outcome);
  if (!json) return { ok: false, reason: "unavailable" };
  const results = Array.isArray(json.results) ? json.results as Record<string, unknown>[] : [];
  const usable = results.filter((row) => row && typeof row === "object" && finite(row.latitude) !== null && finite(row.longitude) !== null && text(row.name));
  if (usable.length === 0) return { ok: false, reason: "not-found" };
  const wanted = foldAyasLiveInfoText(name);
  const exact = usable.filter((row) => foldAyasLiveInfoText(text(row.name)) === wanted);
  // A Turkish place of that exact name first (the owner is in Türkiye), then any exact name, then the geocoder's best match.
  const chosen = exact.find((row) => text(row.country_code) === "TR") ?? exact[0] ?? usable[0]!;
  const placeName = text(chosen.name);
  const country = text(chosen.country);
  const label = text(chosen.country_code) === "TR" || !country ? placeName : `${placeName}, ${country}`;
  return { ok: true, place: { name: placeName, label, latitude: finite(chosen.latitude)!, longitude: finite(chosen.longitude)! } };
}

interface DailyRow { readonly date: string; readonly code: number | null; readonly min: number | null; readonly max: number | null; readonly rain: number | null }
interface Forecast {
  readonly current: { readonly temperature: number; readonly feels: number | null; readonly humidity: number | null; readonly wind: number | null; readonly code: number | null } | null;
  readonly daily: readonly DailyRow[];
}

function parseForecast(json: Record<string, unknown>): Forecast | null {
  const daily = json.daily as Record<string, unknown> | undefined;
  const times = Array.isArray(daily?.time) ? daily!.time as unknown[] : [];
  const column = (key: string): unknown[] => Array.isArray(daily?.[key]) ? daily![key] as unknown[] : [];
  const codes = column("weather_code"), max = column("temperature_2m_max"), min = column("temperature_2m_min"), rain = column("precipitation_probability_max");
  const rows: DailyRow[] = times.flatMap((time, index) => typeof time === "string" && /^\d{4}-\d{2}-\d{2}$/.test(time)
    ? [{ date: time, code: finite(codes[index]), min: finite(min[index]), max: finite(max[index]), rain: finite(rain[index]) }] : []);
  const current = json.current as Record<string, unknown> | undefined;
  const temperature = finite(current?.temperature_2m);
  if (rows.length === 0 && temperature === null) return null;
  return {
    current: temperature === null ? null : {
      temperature, feels: finite(current?.apparent_temperature), humidity: finite(current?.relative_humidity_2m),
      wind: finite(current?.wind_speed_10m), code: finite(current?.weather_code),
    },
    daily: rows,
  };
}

const weekdayOf = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();
function dateLabel(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1] ?? ""}`.trim();
}
function dayWord(index: number, date: string): string {
  return index === 0 ? "bugün" : index === 1 ? "yarın" : index === 2 ? "öbür gün" : WEEKDAYS[weekdayOf(date)]!;
}

function selectDays(day: AyasWeatherDay, rows: readonly DailyRow[]): number[] {
  if (day.kind === "today") return rows.length ? [0] : [];
  if (day.kind === "offset") return day.days < rows.length ? [day.days] : [];
  if (day.kind === "weekday") {
    const index = rows.findIndex((row) => weekdayOf(row.date) === day.weekday);
    return index >= 0 ? [index] : [];
  }
  const first = rows.findIndex((row) => weekdayOf(row.date) === 6 || weekdayOf(row.date) === 0);
  if (first < 0) return [];
  return weekdayOf(rows[first]!.date) === 6 && first + 1 < rows.length ? [first, first + 1] : [first];
}

function dailySentence(place: string, row: DailyRow, index: number): string {
  const range = row.min !== null && row.max !== null ? `; en düşük ${degrees(row.min)}, en yüksek ${degrees(row.max)} derece` : "";
  const rain = row.rain !== null ? `, yağış ihtimali yüzde ${Math.round(row.rain)}` : "";
  return `${place} için ${dayWord(index, row.date)} ${dateLabel(row.date)} hava ${describeCode(row.code)}${range}${rain}.`;
}

function weatherAnswer(place: Place, forecast: Forecast, day: AyasWeatherDay): string | null {
  const indexes = selectDays(day, forecast.daily);
  if (day.kind === "today" && forecast.current) {
    const now = forecast.current;
    const parts = [`${place.label} için şu an hava ${describeCode(now.code)}, ${degrees(now.temperature)} derece${now.feels !== null ? `; hissedilen ${degrees(now.feels)} derece` : ""}.`];
    const air = [now.humidity !== null ? `Nem yüzde ${Math.round(now.humidity)}` : "", now.wind !== null ? `rüzgar saatte ${Math.round(now.wind)} kilometre` : ""].filter(Boolean);
    if (air.length) parts.push(`${air.join(", ")}.`.replace(/^rüzgar/, "Rüzgar"));
    const today = indexes.length ? forecast.daily[indexes[0]!] : undefined;
    if (today && today.min !== null && today.max !== null) {
      parts.push(`Bugün en düşük ${degrees(today.min)}, en yüksek ${degrees(today.max)} derece bekleniyor${today.rain !== null ? `, yağış ihtimali yüzde ${Math.round(today.rain)}` : ""}.`);
    }
    return `${parts.join(" ")} Kaynak: Open-Meteo.`;
  }
  if (indexes.length === 0) return null;
  return `${indexes.map((index) => dailySentence(place.label, forecast.daily[index]!, index)).join(" ")} Kaynak: Open-Meteo.`;
}

/** The place for a weather question that names none: the owner's last named place in this conversation, then the configured default. */
function fallbackLocation(deps: AyasLiveInfoDeps): string | null {
  const turns = deps.history ?? [];
  for (let i = turns.length - 1, seen = 0; i >= 0 && seen < 6; i--) {
    const turn = turns[i]!;
    if (turn.role !== "user") continue;
    seen++;
    // The turns before it, so a follow-up such as "Ya İzmir'de?" counts with its place.
    const earlier = detectAyasLiveInfoIntent(turn.text, turns.slice(0, i));
    if (earlier?.kind === "weather" && earlier.location) return earlier.location;
  }
  const configured = text((deps.env ?? process.env).AYAS_WEATHER_DEFAULT_LOCATION);
  return configured ? configured.slice(0, 80) : null;
}

async function answerWeather(intent: Extract<AyasLiveInfoIntent, { kind: "weather" }>, read: AyasLiveInfoRead, deps: AyasLiveInfoDeps): Promise<string> {
  const location = intent.location ?? fallbackLocation(deps);
  if (!location) return WEATHER_ASK_PLACE;
  let geocoded: GeocodeOutcome = { ok: false, reason: "not-found" };
  for (const candidate of placeCandidates(location)) {
    geocoded = await geocode(read, candidate);
    if (geocoded.ok || geocoded.reason === "unavailable") break;
  }
  if (!geocoded.ok) return geocoded.reason === "unavailable" ? WEATHER_SERVICE_DOWN : `${location} adında bir yer bulamadım. Şehir adını kontrol edip tekrar sorar mısın?`;
  const { place } = geocoded;
  const json = parseJson(await read(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude.toFixed(4)}&longitude=${place.longitude.toFixed(4)}`
    + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m"
    + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7"));
  const forecast = json ? parseForecast(json) : null;
  if (!forecast) return WEATHER_SERVICE_DOWN;
  return weatherAnswer(place, forecast, intent.day) ?? `${place.label} için o güne ait tahmin yok; en fazla 7 gün sonrasına bakabiliyorum.`;
}

/* -------------------------------------------------------------------- news --- */

const NEWS_SERVICE_DOWN = "Haber kaynaklarına şu an ulaşamıyorum; biraz sonra tekrar dener misin?";
const MAX_NEWS_ITEMS = 5;
const ORDINALS = ["Birinci", "İkinci", "Üçüncü", "Dördüncü", "Beşinci"];
const GOOGLE_NEWS = "Google Haberler";
const BBC_TURKCE = "BBC News Türkçe";

interface NewsItem { readonly headline: string; readonly source: string; readonly publishedAt: number | null }

const MAX_HEADLINE_CHARS = 160;
/** Some outlets put a whole paragraph in the title; read aloud, the first words are enough. */
function shortHeadline(headline: string): string {
  if (headline.length <= MAX_HEADLINE_CHARS) return headline;
  const cut = headline.slice(0, MAX_HEADLINE_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > 80 ? cut.slice(0, space) : cut).replace(/[\s,;:|–-]+$/u, "")}…`;
}
const sentenceCase = (value: string): string => value.charAt(0).toLocaleUpperCase("tr") + value.slice(1);

/** Google Haberler titles end with " - <yayın>"; BBC's do not. */
function parseNews(outcome: AyasSafeFetchOutcome, defaultSource: string): NewsItem[] {
  if (!outcome.ok) return [];
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const entry of extractAyasFeedEntries(outcome.body, "rss", 40)) {
    let headline = entry.title.replace(/\s+/g, " ").trim();
    let source = defaultSource;
    const split = headline.lastIndexOf(" - ");
    if (defaultSource === GOOGLE_NEWS && split > 0 && headline.length - split <= 63) {
      source = headline.slice(split + 3).trim() || defaultSource;
      headline = headline.slice(0, split).trim();
    }
    const key = foldAyasLiveInfoText(headline);
    if (!headline || seen.has(key)) continue;
    seen.add(key);
    const published = entry.updatedAt ? Date.parse(entry.updatedAt) : Number.NaN;
    items.push({ headline: shortHeadline(headline), source: source.slice(0, 60), publishedAt: Number.isFinite(published) ? published : null });
  }
  return items.sort((a, b) => (b.publishedAt ?? -Infinity) - (a.publishedAt ?? -Infinity)).slice(0, MAX_NEWS_ITEMS);
}

function relativeTime(publishedAt: number | null, now: Date): string {
  if (publishedAt === null) return "tarihi belirsiz";
  const minutes = Math.floor((now.getTime() - publishedAt) / 60_000);
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dakika önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "dün" : `${days} gün önce`;
}

function newsAnswer(items: readonly NewsItem[], topic: string | null, provider: string, now: Date): string {
  const lead = topic ? `${sentenceCase(topic)} ile ilgili en son ${items.length} haber, ${provider} üzerinden.` : `Türkiye gündeminden en son ${items.length} haber, ${provider} üzerinden.`;
  const lines = items.map((item, index) => {
    const headline = /[.!?…]$/u.test(item.headline) ? item.headline : `${item.headline}.`;
    return `${ORDINALS[index]} haber, ${item.source}, ${relativeTime(item.publishedAt, now)}: ${headline}`;
  });
  return [lead, ...lines].join(" ");
}

async function answerNews(intent: Extract<AyasLiveInfoIntent, { kind: "news" }>, read: AyasLiveInfoRead, now: Date): Promise<string> {
  const google = (query: string | null) => read(query
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=tr&gl=TR&ceid=TR:tr`
    : "https://news.google.com/rss?hl=tr&gl=TR&ceid=TR:tr");
  if (intent.topic) {
    // The last week first, so "son gelişmeler" is not answered with an old story; any date only when the week is empty.
    const recent = await google(`${intent.topic} when:7d`);
    if (!recent.ok) return NEWS_SERVICE_DOWN;
    let items = parseNews(recent, GOOGLE_NEWS);
    if (items.length === 0) items = parseNews(await google(intent.topic), GOOGLE_NEWS);
    return items.length ? newsAnswer(items, intent.topic, GOOGLE_NEWS, now) : `${intent.topic} ile ilgili güncel bir haber bulamadım.`;
  }
  const top = parseNews(await google(null), GOOGLE_NEWS);
  if (top.length) return newsAnswer(top, null, GOOGLE_NEWS, now);
  const bbc = parseNews(await read("https://feeds.bbci.co.uk/turkce/rss.xml"), BBC_TURKCE);
  return bbc.length ? newsAnswer(bbc, null, BBC_TURKCE, now) : NEWS_SERVICE_DOWN;
}

/* ----------------------------------------------------------------- resolve --- */

/** One spoken answer for a live-info intent. Never throws. */
export async function answerAyasLiveInfo(intent: AyasLiveInfoIntent, deps: AyasLiveInfoDeps = {}): Promise<string> {
  const read = deps.read ?? createAyasLiveInfoReader();
  try {
    return intent.kind === "weather" ? await answerWeather(intent, read, deps) : await answerNews(intent, read, (deps.now ?? (() => new Date()))());
  } catch {
    return intent.kind === "weather" ? WEATHER_SERVICE_DOWN : NEWS_SERVICE_DOWN;
  }
}
