import type { Episode } from "../episode/EpisodeTypes";
import { splitDirections } from "../tts/StageDirections";

/**
 * Three measurable rules taken from a studied MIT-licensed reference skill for code-made narrated documentaries (owner,
 * 20 Nov 2026: "integrate its quality into ours"), asked of the writer in the same repair rounds as the map rules (a
 * valid script is never lost over them). No model, no files:
 *  - story time only moves forward after the cold open and one bridge line ("Four years earlier, …");
 *  - one idea per line: a spoken line over LINE_MAX_WORDS words is two ideas (the validator only warned, SATIR_UZUN);
 *  - a phrase is shown one way: typed on screen OR spoken, never both word for word.
 */

/** Words a spoken line may have: one idea is one hero on screen (the validator's SATIR_UZUN and the prompt say 22 too). */
export const LINE_MAX_WORDS = 22;
/** A typed phrase counts as a phrase from this many words (a one-word card over black is the channel's hard-cut emphasis). */
export const TYPED_PHRASE_MIN_WORDS = 3;
/** The bridge: the step back in story time may only be the second dated moment (the first is the cold open). */
const BRIDGE_AT = 1;
/** The words of a line searched for the date it opens on (HookFollow.OPENING_WORDS). */
const OPENING_WORDS = 6;

const fold = (text: string) => text.replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const speechOf = (text: string) => splitDirections(text).speech;
const wordsOf = (text: string) => text.split(/\s+/).filter((w) => /\p{L}|\d/u.test(w));
/** Words for comparing a typed phrase with a spoken line: folded, letters and digits only. */
const plain = (text: string) => fold(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The story year a text names near its start (negative for BC), or undefined. A year needs an era ("216 BC", "AD 476",
 * "MÖ 216"), four digits ("1453") or, for three, an "in"/"year" before it. Numbers with a thousands comma ("108,589")
 * and years told as a past reference ("born in 247 BC", "since 1066") are not the moment the story is at.
 */
export function storyYear(text: string): number | undefined {
  const f = fold(text);
  const bc = /\b(?:bc|bce|b\.c\.)(?![a-z])|\bm\.?o\.?\s*\d/.test(f);
  const hits: { year: number; at: number }[] = [];
  const add = (re: RegExp, era: (m: RegExpExecArray) => number) => {
    for (let m = re.exec(f); m; m = re.exec(f)) hits.push({ year: era(m), at: m.index });
  };
  add(/(?<![\d,.])(\d{1,4})(?:st|nd|rd|th)?\s*(?:bc|bce|b\.c\.)(?![a-z])/g, (m) => -Number(m[1]));
  add(/\bm\.?o\.?\s*(\d{1,4})/g, (m) => -Number(m[1]));
  // The first year of a BC range ("218 to 202 BC") carries the range's era.
  add(/(?<![\d,.])(\d{1,4})(?=\s*(?:to|and|[-–—])\s*\d{1,4}\s*(?:bc|bce|b\.c\.)(?![a-z]))/g, (m) => -Number(m[1]));
  add(/\b(?:ad|ce|m\.?s\.?)\s*(\d{1,4})\b/g, (m) => Number(m[1]));
  add(/(?<![\d,.])(\d{1,4})\s*(?:ad|ce)(?![a-z])/g, (m) => Number(m[1]));
  // A bare year: four digits anywhere; three only after "in"/"year" (so "300 Spartans" is not the year 300). Inside a BC
  // text it is BC too ("from 218 to 202 BC").
  add(/(?<![\d,.])(\d{4})(?![\d])(?![,.]\d)(?!\s*(?:bc|bce|b\.c\.|ad|ce)(?![a-z]))/g, (m) => (bc ? -Number(m[1]) : Number(m[1])));
  add(/\b(?:in|year)\s+(\d{3})(?![\d])(?![,.]\d)(?!\s*(?:bc|bce|b\.c\.|ad|ce)(?![a-z]))/g, (m) => (bc ? -Number(m[1]) : Number(m[1])));
  hits.sort((a, b) => a.at - b.at);
  return hits[0]?.year;
}

/** What marks a year as a remembered reference, not where the story stands ("born in 247 BC", "since 1066"). */
const REFERENCE_BEFORE = /\b(born|died|dies|since|until|till|ago|founded|built|had|was|were|dogdu|oldu|beri)\b/;

/** The year a spoken line opens on (its first OPENING_WORDS words), or undefined when it opens on something else. */
function lineYear(text: string): number | undefined {
  const head = wordsOf(speechOf(text)).slice(0, OPENING_WORDS).join(" ");
  const year = storyYear(head);
  if (year === undefined) return undefined;
  const digit = /\d/.exec(head)?.index ?? 0;
  return REFERENCE_BEFORE.test(fold(head.slice(0, digit))) ? undefined : year;
}

interface Moment { readonly year: number; readonly sahne: string; readonly satir: number; readonly text: string }

/**
 * The dated moments of an episode in the order a viewer meets them: each place-and-date stamp ("yer_tarih"), each map date
 * stamp and each spoken line that opens on a year, by scene and line (a stamp before the line it appears with).
 */
export function datedMoments(episode: Pick<Episode, "sahneler">): Moment[] {
  const out: Moment[] = [];
  for (const s of episode.sahneler ?? []) {
    const id = s.id ?? "?";
    const here: { m: Moment; order: number }[] = [];
    for (const c of s.yazi_karti ?? []) {
      if (c.stil !== "yer_tarih") continue;
      const year = storyYear(`${c.alt_metin ?? ""} ${c.metin}`) ?? storyYear(c.metin);
      if (year !== undefined) here.push({ m: { year, sahne: id, satir: c.satir ?? 0, text: [c.metin, c.alt_metin].filter(Boolean).join(" — ") }, order: (c.satir ?? 0) * 2 });
    }
    for (const d of s.harita?.tarih ?? []) {
      const year = storyYear(d.metin);
      if (year !== undefined) here.push({ m: { year, sahne: id, satir: d.satir, text: d.metin }, order: d.satir * 2 });
    }
    (s.satirlar ?? []).forEach((l, i) => {
      const year = typeof l.metin === "string" ? lineYear(l.metin) : undefined;
      if (year !== undefined) here.push({ m: { year, sahne: id, satir: i, text: speechOf(l.metin).slice(0, 50) }, order: i * 2 + 1 });
    });
    // Order inside a scene only; scenes keep their own order.
    out.push(...here.sort((a, b) => a.order - b.order).map((h) => h.m));
  }
  return out;
}

/** A year for the writer to read: "216 BC", "1453". */
const yearText = (year: number) => (year < 0 ? `${-year} BC` : String(year));

/**
 * Story time only moves forward (reference story.md: "a year that steps back in time after the first take"): the cold open
 * may jump ahead and one bridge line ("Four years earlier, …") steps back; after that every dated moment is later than
 * the one before. As repair problems, one per step back (at most two asked at once).
 */
export function storyTimeProblems(episode: unknown): string[] {
  if (!episode || typeof episode !== "object" || !Array.isArray((episode as Episode).sahneler)) return [];
  const moments: Moment[] = [];
  for (const m of datedMoments(episode as Episode)) if (m.year !== moments[moments.length - 1]?.year) moments.push(m);
  const out: string[] = [];
  for (let i = 1; i < moments.length; i++) {
    const was = moments[i - 1]!, now = moments[i]!;
    if (now.year >= was.year) continue;
    if (i === BRIDGE_AT) continue;
    out.push(`scene "${now.sahne}" line ${now.satir + 1} steps back in story time (${yearText(was.year)} → ${yearText(now.year)}: "${now.text}"): after the cold open and one bridge line ("Four years earlier, …") story time only moves forward — keep the scenes in the order things happened, or tell the earlier event inside the present scene without dating it — STORY TIME`);
    if (out.length >= 2) break;
  }
  return out;
}

/** The scene's spoken lines (stage directions dropped) with their index. */
function spokenLines(scene: Episode["sahneler"][number]): { line: number; text: string }[] {
  return (scene.satirlar ?? []).flatMap((l, line) => {
    const text = typeof l.metin === "string" ? speechOf(l.metin) : "";
    return text ? [{ line, text }] : [];
  });
}

/**
 * One idea per line (reference story.md: a 30-word line "either holds one shot too long or crams in three heroes"): each
 * spoken line over LINE_MAX_WORDS words. The validator only warned (SATIR_UZUN) and warnings are not repaired; the
 * prompt already says "never more than 22". As repair problems, one for the longest lines (at most four).
 */
export function longLineProblems(episode: unknown): string[] {
  if (!episode || typeof episode !== "object" || !Array.isArray((episode as Episode).sahneler)) return [];
  const long = (episode as Episode).sahneler.flatMap((s) => spokenLines(s).map((l) => ({ sahne: s.id ?? "?", ...l, n: wordsOf(l.text).length }))).filter((l) => l.n > LINE_MAX_WORDS);
  return long
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map((l) => `scene "${l.sahne}" line ${l.line + 1} has ${l.n} words (at most ${LINE_MAX_WORDS}): one idea per line — split it into two lines, or cut the second idea ("${l.text.slice(0, 60)}…") — LINE LENGTH`);
}

/** The text a scene types on the screen: stamps and cards, map date stamps and arrow labels, info-card titles and items. */
function typedTexts(scene: Episode["sahneler"][number]): string[] {
  const out: (string | undefined)[] = [];
  for (const c of scene.yazi_karti ?? []) out.push(c.metin, c.alt_metin);
  for (const d of scene.harita?.tarih ?? []) out.push(d.metin);
  for (const a of scene.harita?.oklar ?? []) out.push(a.etiket);
  for (const c of scene.bilgi_kartlari ?? []) out.push(c.baslik, c.etiket, ...(c.maddeler ?? []).map((m) => m.metin));
  return out.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
}

/**
 * Show a phrase one way (reference SKILL.md: "either type it on screen or show it on a real document, never both"): a
 * card, stamp, map label or list item of TYPED_PHRASE_MIN_WORDS words or more that the narrator or a character also says
 * word for word in the same scene. As repair problems, one per phrase (at most three).
 */
export function typedAndSpokenProblems(episode: unknown): string[] {
  if (!episode || typeof episode !== "object" || !Array.isArray((episode as Episode).sahneler)) return [];
  const out: string[] = [];
  for (const s of (episode as Episode).sahneler) {
    const spoken = spokenLines(s).map((l) => ({ ...l, plain: ` ${plain(l.text)} ` }));
    const seen = new Set<string>();
    for (const typed of typedTexts(s)) {
      const p = plain(typed);
      if (p.split(" ").length < TYPED_PHRASE_MIN_WORDS || seen.has(p)) continue;
      seen.add(p);
      const hit = spoken.find((l) => l.plain.includes(` ${p} `) || (l.plain.trim().split(" ").length >= TYPED_PHRASE_MIN_WORDS && ` ${p} `.includes(l.plain)));
      if (hit) out.push(`scene "${s.id ?? "?"}": the text "${typed}" is typed on the screen and also said word for word in line ${hit.line + 1}: show a phrase one way — type the number, name or place and say the rest, or reword the line — TYPED AND SPOKEN`);
      if (out.length >= 3) return out;
    }
  }
  return out;
}

/** All three, as the writer's repair rounds ask them (and the length rounds count them). */
export function storyRuleProblems(episode: unknown): string[] {
  return [...storyTimeProblems(episode), ...longLineProblems(episode), ...typedAndSpokenProblems(episode)];
}
