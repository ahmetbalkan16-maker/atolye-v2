import { splitDirections } from "../tts/StageDirections";

/**
 * The line right after a Short's hook (owner, 19 Nov 2026: "nerede kişi kaybediyoruz, ne geliştirmemiz gerekiyor bul ve
 * yap; bundan sonra Shorts videosu yapacağız"). YouTube Analytics' organic curves of the channel's 45–56 s Shorts (Caesar,
 * Zanzibar, Waterloo, Cannae) all kept their hook — relative retention 0.43–0.53 at 3 s — and then lost 43–56 % of those
 * viewers by 12 s, the steepest slope falling on the narrator's line after the hook: 14–18 words opening on a date or a
 * place ("Around 75 BC, Julius Caesar was kidnapped…", "On August 2nd, 216 BC, Rome fields…"), while the "yer_tarih"
 * card already showed where and when. All eight Shorts made so far open their second line this way. The rule: that
 * line, when the narrator's, is at most HOOK_FOLLOW_MAX_WORDS words and does not open on a date or a time. Measured,
 * not guessed, by ChannelAnalyticsMap.holdAfterHook on the next Shorts. No model, no files.
 */

/** Words the narrator's line after the hook may have: ~5 s at the channel's 2.3–2.5 spoken words a second. */
export const HOOK_FOLLOW_MAX_WORDS = 12;
/** The opening words searched for a date or a time ("Baghdad, December 1638." is a date opener too). */
const OPENING_WORDS = 6;

export type HookFollowFault = "uzun" | "tarih";

const MONTHS = /\b(january|february|march|april|june|july|august|september|october|november|december|ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\b/;

const fold = (text: string) => text.replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const words = (text: string) => text.split(/\s+/).filter((w) => /\p{L}|\d/u.test(w));

/**
 * The date or time a line opens with (within its first OPENING_WORDS words), or undefined. A year (3–4 digits standing
 * alone: "1638", not "108,589"), a number with an era ("75 BC", "MÖ 216"), a clock time ("1:25 a.m.") or a month with a
 * number ("November 11", "2 Ağustos").
 */
export function dateOpener(text: string): string | undefined {
  const head = words(splitDirections(text).speech).slice(0, OPENING_WORDS).join(" ");
  const f = fold(head);
  const hits = [
    /(?<!\d)(?<!\d[,.])\d{3,4}(?!\d)(?![,.]\d)/,
    /\b\d+(st|nd|rd|th)?\s*(bc|bce|ad|ce|b\.c\.|a\.d\.)(?![a-z])/,
    /\b(mo|ms|m\.o\.|m\.s\.)\s*\d+/,
    /\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/,
    /\b\d{1,2}:\d{2}\b/,
  ];
  for (const re of hits) {
    const m = re.exec(f);
    if (m) return m[0];
  }
  const month = MONTHS.exec(f);
  return month && /\d/.test(f) ? month[0] : undefined;
}

/** What is wrong with a narrator's line after the hook: too long, opening on a date — or nothing. */
export function hookFollowFaults(text: string): HookFollowFault[] {
  const out: HookFollowFault[] = [];
  if (words(splitDirections(text).speech).length > HOOK_FOLLOW_MAX_WORDS) out.push("uzun");
  if (dateOpener(text)) out.push("tarih");
  return out;
}

interface Scene { readonly id?: string; readonly satirlar?: readonly { readonly karakter?: string; readonly metin?: string }[] }
interface EpisodeLike { readonly oyuncu_kadrosu?: readonly { readonly id?: string; readonly ad?: string; readonly gorunur?: boolean }[]; readonly sahneler?: readonly Scene[] }

/**
 * The episode's second spoken line, the one after the hook, with whether the narrator (an invisible cast member) says
 * it. Undefined when the episode has fewer than two spoken lines.
 */
export function hookFollowLine(episode: EpisodeLike): { readonly sahne: string; readonly satir: number; readonly metin: string; readonly anlatici: boolean } | undefined {
  const narrators = new Set((episode.oyuncu_kadrosu ?? []).filter((c) => c.gorunur === false).map((c) => c.id));
  let seen = 0;
  for (const s of episode.sahneler ?? []) {
    for (const [i, l] of (s.satirlar ?? []).entries()) {
      if (typeof l.metin !== "string" || !splitDirections(l.metin).speech) continue;
      if (++seen === 2) return { sahne: s.id ?? "?", satir: i + 1, metin: l.metin, anlatici: narrators.has(l.karakter) };
    }
  }
  return undefined;
}

/**
 * The writer's repair asks for a Short's line after the hook (ScriptEngine.openingProblems asks them first in its repair
 * and length rounds, from SHORT_SHARES_FROM_S; a valid script is never lost over them, and a line still too long at the
 * end is split at its sentence break: splitHookFollow). Only the narrator's line is judged: a character answering the
 * hook keeps the scene going.
 */
export function hookFollowProblems(episode: EpisodeLike): string[] {
  const line = hookFollowLine(episode);
  if (!line?.anlatici) return [];
  const faults = hookFollowFaults(line.metin);
  if (!faults.length) return [];
  const n = words(splitDirections(line.metin).speech).length;
  const what = [
    ...(faults.includes("tarih") ? [`opens on a date or a time ("${dateOpener(line.metin)}")`] : []),
    ...(faults.includes("uzun") ? [`has ${n} words (at most ${HOOK_FOLLOW_MAX_WORDS})`] : []),
  ].join(" and ");
  return [`scene "${line.sahne}" line ${line.satir}, the narrator's line right after the hook, ${what}: feed viewers swipe away here — say the stakes in at most ${HOOK_FOLLOW_MAX_WORDS} words (who wants what, what is about to go wrong); the "yer_tarih" card already shows where and when, so a date that matters goes in a later line — HOOK FOLLOW-UP`];
}

/* ------------------------------------------------------------ the hook --- */

/**
 * What makes a Short's hook concrete (owner, 23 Nov 2026, after the Lake Trasimene Short's 73 views in 35 hours: its hook
 * "Who needs fog machines when you have nature?" was a joke that means nothing to a viewer who does not know the story —
 * no name, no number, no stake, no outcome; every Short's relative retention at 3 s was 0.15–0.41 against 0.5). A hook
 * carries at least one anchor: a number (digits or a number word), a proper name, or a word of what is at stake or how it
 * ends. Pure, no model.
 */
export type HookAnchorKind = "sayi" | "ad" | "tehlike";

/** Number words of both narration languages (folded). "one"/"bir" and "on" are left out: an article, a preposition. */
const NUMBER_WORDS = new Set([
  "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
  "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "hundreds", "thousand", "thousands", "million", "millions", "billion", "dozen", "dozens",
  "iki", "uc", "bes", "alti", "yedi", "yuz", "bin",
]);
/** Turkish number stems that only ever start a number word ("dört ayda", "binlerce", "kırk bin"). */
const NUMBER_STEMS = ["dort", "sekiz", "dokuz", "yirmi", "otuz", "kirk", "elli", "altmis", "yetmis", "seksen", "doksan", "milyon", "binlerce", "yuzlerce", "onlarca"];

/** Words of a stake or an outcome (folded English): who dies, falls, loses, is trapped, is the last or the only one. */
const STAKE_WORDS = new Set([
  "die", "dies", "died", "dying", "dead", "death", "deaths", "kill", "kills", "killed", "killing", "fall", "falls", "fell", "fallen",
  "lose", "loses", "lost", "losing", "win", "wins", "won", "trap", "trapped", "never", "last", "only", "nobody", "none",
  "survive", "survives", "survived", "survivor", "survivors", "escape", "escapes", "escaped", "drown", "drowns", "drowned", "drowning",
  "doomed", "destroyed", "wiped", "surrender", "surrenders", "surrendered", "massacre", "massacred", "slaughter", "slaughtered",
  "defeat", "defeated", "alive", "everyone", "vanished",
]);
/**
 * Turkish stake stems on the lower-cased (not folded) word: folding would make "öldü" (died) "oldu" (became). "öl" not
 * before "ç" (ölçü), "düş" not before "ün"/"man" (düşünmek, düşman), "son" alone (not "sonra").
 */
const STAKE_TR = /^(öl(?!ç)|öldür|kaybet|kaybed|kazan|düş(?!ün|man)|tuzak|asla|hiç|son$|sonu|sadece|yalnız|kimse|herkes|hepsi|kurtul|boğul|teslim|yenil|yendi|katlet|esir|kırıl|mahv)/u;

/** Capitalised words that are not names even inside a sentence ("I'm" never matches: one capital, no lower case). */
const NOT_NAME_WORDS = new Set(["The", "And", "But", "His", "Her", "Their", "This", "That", "Narrator"]);

const sentencesOf = (speech: string) => speech.split(/(?<=[.!?…])\s+/).filter((s) => /\p{L}|\d/u.test(s));
const bare = (w: string) => w.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
const isCapitalised = (w: string) => /^\p{Lu}\p{Ll}/u.test(w) && !NOT_NAME_WORDS.has(w);

/**
 * The proper names an episode knows: every capitalised word of a cast member's name, and every capitalised word its lines
 * use inside a sentence (so "Rome" opening the hook counts once "Rome" stands mid-sentence anywhere).
 */
export function episodeNames(episode: EpisodeLike): string[] {
  const out = new Set<string>();
  for (const c of episode.oyuncu_kadrosu ?? []) for (const w of (c.ad ?? "").split(/\s+/).map(bare)) if (w.length >= 3 && isCapitalised(w)) out.add(w);
  for (const s of episode.sahneler ?? []) {
    for (const l of s.satirlar ?? []) {
      if (typeof l.metin !== "string") continue;
      for (const sentence of sentencesOf(splitDirections(l.metin).speech)) for (const w of sentence.split(/\s+/).slice(1).map(bare)) if (w.length >= 2 && isCapitalised(w)) out.add(w);
    }
  }
  return [...out];
}

/**
 * The hook's concrete anchor, or undefined when it has none: a number ("Thirty thousand Romans walk into this fog."),
 * a proper name (a capitalised word that does not open its sentence, or one of `names`: the cast's and the episode's), or
 * a stake/outcome word ("never", "trapped", "last", "only", "öldü"…). "Who needs fog machines when you have nature?" has
 * none.
 */
export function hookAnchor(text: string, names: readonly string[] = []): { readonly tur: HookAnchorKind; readonly kelime: string } | undefined {
  const speech = splitDirections(text).speech;
  const tokens = speech.split(/[\s\-–—/]+/).map(bare).filter(Boolean);
  const digits = tokens.find((w) => /\d/.test(w));
  if (digits) return { tur: "sayi", kelime: digits };
  const number = tokens.find((w) => {
    const f = fold(w).replace(/['’].*$/u, "");
    return NUMBER_WORDS.has(f) || NUMBER_STEMS.some((s) => f.startsWith(s));
  });
  if (number) return { tur: "sayi", kelime: number };
  const known = new Set(names);
  for (const sentence of sentencesOf(speech)) {
    const ws = sentence.split(/\s+/).map(bare).filter(Boolean);
    const name = ws.find((w, i) => (i > 0 && isCapitalised(w)) || known.has(w.replace(/['’]s$/u, "")));
    if (name) return { tur: "ad", kelime: name };
  }
  const folded = fold(speech).split(/[^\p{L}'’]+/u).filter(Boolean);
  const lower = speech.toLocaleLowerCase("tr-TR").split(/[^\p{L}'’]+/u).filter(Boolean);
  // A possessive may go ("Rome's last"), a contraction may not: "won't" is no "won".
  const stake = folded.find((w) => STAKE_WORDS.has(w.replace(/['’]s$/u, ""))) ??(/\bno one\b/.test(folded.join(" ")) ? "no one" : undefined) ?? lower.find((w) => STAKE_TR.test(w));
  return stake ? { tur: "tehlike", kelime: stake } : undefined;
}

/** The episode's first spoken line (the hook) with whether the narrator says it; undefined without any spoken line. */
export function hookLine(episode: EpisodeLike): { readonly sahne: string; readonly satir: number; readonly metin: string; readonly anlatici: boolean } | undefined {
  const narrators = new Set((episode.oyuncu_kadrosu ?? []).filter((c) => c.gorunur === false).map((c) => c.id));
  for (const s of episode.sahneler ?? []) {
    for (const [i, l] of (s.satirlar ?? []).entries()) {
      if (typeof l.metin === "string" && splitDirections(l.metin).speech) return { sahne: s.id ?? "?", satir: i + 1, metin: l.metin, anlatici: narrators.has(l.karakter) };
    }
  }
  return undefined;
}

/**
 * The writer's repair ask for a Short whose hook has no concrete anchor (owner, 23 Nov 2026: a stronger hook — no joke
 * or quip; the outcome or a near-impossible concrete claim). Asked with the hook-follow ask (ScriptEngine).
 */
export function hookAnchorProblems(episode: EpisodeLike): string[] {
  const line = hookLine(episode);
  if (!line || hookAnchor(line.metin, episodeNames(episode))) return [];
  return [`scene "${line.sahne}" line ${line.satir}, the hook "${splitDirections(line.metin).speech.slice(0, 90)}", has no concrete anchor — no number, no name, nothing at stake: a joke or a quip means nothing to a viewer who does not know the story yet. Say the outcome or a near-impossible claim with a name, a number or the stake ("Thirty thousand Romans walk into my fog."), still a visible character's line of at most 8 words in their own voice; the joke goes in a later line — HOOK ANCHOR`];
}

/* ------------------------------------------------- the follow-up's split --- */

/** Line-index fields of a scene (map moves, badges, cards, pictures, crowds): every key ending in "satir". */
const LINE_KEY = /(^|_)satir$/;

/** Every line index in a scene's parts other than its lines, moved one down past `at` (a line inserted after `at`). */
export function shiftLineRefs(node: unknown, at: number): unknown {
  if (Array.isArray(node)) return node.map((x) => shiftLineRefs(x, at));
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (typeof v === "number" && LINE_KEY.test(k)) out[k] = v > at ? v + 1 : v;
    // A side's `vurgu` lists the lines that speak of it: both halves of a split line still do.
    else if (k === "vurgu" && Array.isArray(v) && v.every((x) => typeof x === "number")) out[k] = [...new Set((v as number[]).flatMap((x) => (x > at ? [x + 1] : x === at ? [x, x + 1] : [x])))];
    else out[k] = shiftLineRefs(v, at);
  }
  return out;
}

/**
 * The last resort for a narrator's line after the hook still too long after the paid rounds (owner, 23 Nov 2026, after
 * the Lake Trasimene Short went out with "Hannibal is about to spring history's biggest ambush. The Romans are walking
 * right into it." — 15 words; QC flagged it and nothing stopped it): when its first sentence(s) make a line of at most
 * HOOK_FOLLOW_MAX_WORDS, the line is split there into two narrator lines and the scene's line indexes move with it. No
 * word is added, dropped or changed; a line without such a sentence break, or with stage directions, stays as it is.
 * The caller validates the result (and keeps the old episode when the split breaks it).
 */
export function splitHookFollow<E extends EpisodeLike>(episode: E): { readonly episode: E; readonly fix?: string } {
  const line = hookFollowLine(episode);
  if (!line?.anlatici || !hookFollowFaults(line.metin).includes("uzun")) return { episode };
  const text = line.metin.trim();
  if (splitDirections(text).speech !== text) return { episode };
  const sentences = sentencesOf(text);
  let take = 0;
  let n = 0;
  while (take < sentences.length - 1 && n + words(sentences[take]!).length <= HOOK_FOLLOW_MAX_WORDS) n += words(sentences[take++]!).length;
  if (!take) return { episode };
  const first = sentences.slice(0, take).join(" ");
  const rest = sentences.slice(take).join(" ");
  const scenes = episode.sahneler ?? [];
  const sceneAt = scenes.findIndex((s) => (s.id ?? "?") === line.sahne);
  const scene = scenes[sceneAt] as (Scene & Record<string, unknown>) | undefined;
  const at = line.satir - 1;
  const old = scene?.satirlar?.[at] as Record<string, unknown> | undefined;
  if (!scene || !old) return { episode };
  const second: Record<string, unknown> = { karakter: old.karakter, metin: rest };
  for (const k of ["duygu", "kaynak", "kurgu", "rivayet"]) if (old[k] !== undefined) second[k] = old[k];
  const { satirlar, ...parts } = scene;
  const lines = satirlar ?? [];
  const moved = { ...(shiftLineRefs(parts, at) as Record<string, unknown>), satirlar: [...lines.slice(0, at), { ...old, metin: first }, second, ...lines.slice(at + 1)] };
  return {
    episode: { ...episode, sahneler: scenes.map((s, i) => (i === sceneAt ? moved : s)) } as E,
    fix: `${line.sahne}: kancadan sonraki anlatıcı satırı ${words(text).length} kelimeydi — cümle sınırından ikiye bölündü (${words(first).length} + ${words(rest).length} kelime, söz eklenmedi)`,
  };
}
