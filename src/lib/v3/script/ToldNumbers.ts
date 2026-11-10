import type { Episode, EpisodeScene, MapStrengthSide, SceneInfoCard } from "../episode/EpisodeTypes";
import { validateEpisode } from "../episode/EpisodeValidator";
import type { ScriptLanguage } from "./ScriptPrompts";

/**
 * Armies the narrator counts off the map are shown (the Cannae Short, 9 Nov 2026: "Rome fields its biggest army ever —
 * eighty-six thousand men. Hannibal? Only fifty thousand." and "Fifty thousand Romans fall." were told over standing
 * puppets; the quality brain scored the narration 1–2/10 on those frames, and the strength bar exists only on maps).
 * The writer is asked for a `guc` or `sayac` card; this is the last resort when it gave none, like the told crowds.
 */

/** A number the narration says, with the words right after it. */
export interface ToldNumber {
  readonly value: number;
  /** Where it stands in the sentence (characters). */
  readonly index: number;
  readonly end: number;
  /** Up to four words after it, before the sentence ends ("Romans fall"). */
  readonly after: string;
}

/** A side's army must be at least this big to be counted (smaller numbers are legions, days, ships, rulers). */
export const MIN_TOLD_ARMY = 1000;

const EN_UNITS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const TR_UNITS: Readonly<Record<string, number>> = {
  bir: 1, iki: 2, üç: 3, dört: 4, beş: 5, altı: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10, yirmi: 20, otuz: 30, kırk: 40, elli: 50,
  altmış: 60, yetmiş: 70, seksen: 80, doksan: 90,
};
const EN_SCALES: Readonly<Record<string, number>> = { hundred: 100, thousand: 1e3, million: 1e6 };
const TR_SCALES: Readonly<Record<string, number>> = { yüz: 100, bin: 1e3, milyon: 1e6 };

/** Words after a number that make it no army: eras, distances, years, money, ships, areas. */
const NOT_PEOPLE =
  /^(?:BC|BCE|AD|CE|MÖ|MS|miles?|km|kilomet(?:er|re)s?|feet|foot|met(?:er|re)s?|yards?|years?|days?|months?|hours?|pounds?|dollars?|denarii|denarius|sesterces|talents?|drachmas?|ducats?|florins?|coins?|gold|silver|ships?|galleys?|square|acres?|tons?|tonnes?|mil|kilometre|yıl\p{L}*|gün\p{L}*|altın\p{L}*|akçe\p{L}*|lira\p{L}*|gemi\p{L}*|kadırga\p{L}*)$/iu;

const lower = (s: string) => s.toLocaleLowerCase("tr-TR");

/**
 * The numbers a sentence says, in digits ("86,000", "2.5 million") or in words ("eighty-six thousand", Turkish
 * "seksen altı bin" when the episode is Turkish — "on" and "bir" are English and Turkish words too). A plain four-digit
 * number without a grouping is a year and never counted; a number followed by a distance, money or a fleet is no army.
 */
export function toldNumbers(sentence: string, dil: ScriptLanguage = "en"): ToldNumber[] {
  const units = dil === "tr" ? TR_UNITS : EN_UNITS;
  const scales = dil === "tr" ? TR_SCALES : EN_SCALES;
  const tokens = [...sentence.matchAll(/\d+(?:[.,]\d{3})+|\d+(?:[.,]\d+)?|\p{L}+/gu)].map((m) => ({ text: m[0], at: m.index!, end: m.index! + m[0].length }));
  const numeric = (t: string) => /^\d/.test(t) || lower(t) in units || lower(t) in scales;
  const out: ToldNumber[] = [];
  // A scale word starts a number only as "a thousand" (English) or alone as "bin"/"milyon" (Turkish; "yüz" is also "face").
  const startsAlone = (i: number) => (dil === "en" ? i > 0 && lower(tokens[i - 1]!.text) === "a" : lower(tokens[i]!.text) !== "yüz");
  for (let i = 0; i < tokens.length; i++) {
    if (!numeric(tokens[i]!.text) || (!/^\d/.test(tokens[i]!.text) && lower(tokens[i]!.text) in scales && !startsAlone(i))) continue;
    // A run of number words and digits joined by spaces or hyphens ("eighty-six thousand", "two hundred and fifty").
    let j = i;
    const run = [tokens[i]!];
    while (j + 1 < tokens.length && /^[\s\-‐–]*$/.test(sentence.slice(tokens[j]!.end, tokens[j + 1]!.at))) {
      const next = tokens[j + 1]!;
      const joinAnd = dil === "en" && lower(next.text) === "and" && j + 2 < tokens.length && numeric(tokens[j + 2]!.text) && !/^\d/.test(tokens[j + 2]!.text);
      if (!numeric(next.text) && !joinAnd) break;
      if (/^\d/.test(next.text) && run.length) break;
      j++;
      if (!joinAnd) run.push(next);
    }
    let total = 0;
    let current = 0;
    for (const t of run) {
      const w = lower(t.text);
      // A separator before exactly three digits groups thousands ("86,000", "1.000"); otherwise it is a decimal ("2.5").
      if (/^\d/.test(t.text)) current += Number(/^\d{1,3}(?:[.,]\d{3})+$/.test(t.text) ? t.text.replace(/[.,]/g, "") : t.text.replace(",", "."));
      else if (w in units) current += units[w]!;
      else if (scales[w] === 100) current = (current || 1) * 100;
      else {
        total += (current || 1) * scales[w]!;
        current = 0;
      }
    }
    const value = Math.round(total + current);
    const start = run[0]!;
    const last = run[run.length - 1]!;
    i = j;
    if (!Number.isFinite(value) || value < MIN_TOLD_ARMY) continue;
    // "In 1389" is a year; "86,000", "86 thousand", "eighty-six thousand" and "8000 men" are counts.
    if (run.length === 1 && /^\d{4}$/.test(start.text) && value <= 2100) continue;
    // Its words: up to the clause's end or the next number ("86,000 men and loses 50,000" → "men").
    const rest = sentence.slice(last.end).split(/[.!?;:,—–\d]|(?<!\p{L})(?:and|but|or|while|ve|ama|fakat)(?!\p{L})/iu)[0] ?? "";
    const words = rest.split(/[^\p{L}'’-]+/u).filter(Boolean);
    const unit = sentence.slice(last.end).split(/[^\p{L}]+/u).filter(Boolean)[0];
    if (unit && NOT_PEOPLE.test(unit)) continue;
    out.push({ value, index: start.at, end: last.end, after: words.slice(0, 4).join(" ") });
  }
  return out;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US");

/** Capitalised words that start sentences and share a side's first letters ("Then" and the Thebans). */
const NOT_A_NAME = new Set(["then", "they", "this", "that", "there", "these", "those", "their", "when", "what", "with", "from", "after", "before", "while", "only", "even", "soon", "still", "just", "here", "over", "into"]);

/**
 * Whether a word names the side ("Rome" → Romans, "Carthage" → Carthaginians): a capitalised name sharing most of its
 * start with the side's ("army" is no Armenian).
 */
export function namesSide(word: string, side: string): boolean {
  if (!/^\p{Lu}/u.test(word) || word.length < 4 || NOT_A_NAME.has(fold(word))) return false;
  const a = fold(word);
  const b = fold(side);
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n >= 3 && n >= Math.min(a.length, b.length) * 0.6;
}

interface Side extends MapStrengthSide {
  /** Names its units carry ("Hannibal" of "Hannibal's center"), so a commander's name points at his side. */
  readonly leaders: readonly string[];
}

/** The two sides the episode's maps fight with: a strength bar's, else the first two sides of a battle map's units. */
export function episodeSides(episode: Pick<Episode, "sahneler">): [Side, Side] | undefined {
  const leaders = new Map<string, Set<string>>();
  for (const s of episode.sahneler)
    for (const u of s.harita?.birlikler ?? []) {
      const owner = /^(\p{Lu}\p{L}+)['’]s\b/u.exec(u.ad ?? "")?.[1];
      if (owner) leaders.set(u.taraf, (leaders.get(u.taraf) ?? new Set()).add(owner));
    }
  const withLeaders = (t: MapStrengthSide): Side => ({ ...t, leaders: [...(leaders.get(t.ad) ?? [])] });
  for (const s of episode.sahneler) {
    const g = s.harita?.guc?.[0];
    if (g) return [withLeaders({ ad: g.taraflar[0].ad, renk: g.taraflar[0].renk, sayi: "" }), withLeaders({ ad: g.taraflar[1].ad, renk: g.taraflar[1].renk, sayi: "" })];
  }
  for (const s of episode.sahneler) {
    const units = s.harita?.birlikler ?? [];
    const first = units[0];
    const second = units.find((u) => u.taraf !== first?.taraf);
    if (first && second) return [withLeaders({ ad: first.taraf, renk: first.renk, sayi: "" }), withLeaders({ ad: second.taraf, renk: second.renk, sayi: "" })];
  }
  return undefined;
}

/** The side a number belongs to: the side or a leader of it named nearest before it in the sentence. */
function sideBefore(sentence: string, at: number, sides: readonly [Side, Side]): 0 | 1 | undefined {
  const words = [...sentence.slice(0, at).matchAll(/\p{L}+/gu)].map((m) => m[0]).reverse();
  for (const w of words) {
    for (const k of [0, 1] as const) if (namesSide(w, sides[k].ad) || sides[k].leaders.some((l) => fold(l) === fold(w))) return k;
  }
  return undefined;
}

/** Words that tell losses: a count after them is the dead of an army already counted. */
// No \b: it does not see Turkish letters (as CrowdRules).
const LOSS = /(?<!\p{L})(?:los[et]|loses|losing|f[ae]ll|fallen|die[sd]?|dead|killed|slain|slaughter\p{L}*|perish\p{L}*|casualt\p{L}*|kaybet\p{L}*|kayb\p{L}*|öldü\p{L}*|öl[eü]n\p{L}*|düştü\p{L}*)(?!\p{L})/iu;

const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * The card for a scene's narrator line that counts armies, or none: two counts and the episode's two sides → the two
 * armies (`guc`), the first count's side found by the side or its leader named before it, the other count the other
 * side's; else one count with words after it → a counter (`sayac`, "50,000 — Romans fall").
 */
export function toldStrengthCard(text: string, line: number, sides: readonly [Side, Side] | undefined, dil: ScriptLanguage = "en"): SceneInfoCard | undefined {
  // Each count with where it stands in the whole line (a side may be named a sentence before: "Hannibal? Only fifty thousand.").
  const counts: (ToldNumber & { readonly at: number; readonly to: number })[] = [];
  let offset = 0;
  for (const s of text.split(/(?<=[.!?;])\s+/)) {
    offset = text.indexOf(s, offset);
    for (const n of toldNumbers(s, dil)) counts.push({ ...n, at: offset + n.index, to: offset + n.end });
    offset += s.length;
  }
  if (!counts.length) return undefined;
  if (counts.length >= 2 && sides) {
    const [a, b] = counts as [(typeof counts)[number], (typeof counts)[number]];
    const sa = sideBefore(text.slice(0, a.at), a.at, sides);
    const between = sideBefore(text.slice(a.to, b.at), b.at - a.to, sides);
    // One army counted twice (its men, then its dead — the same side named again, or a loss told) is no two sides.
    const lost = LOSS.test(text.slice(a.to, b.at)) || LOSS.test(b.after);
    const first = lost ? undefined : sa !== undefined ? (between === sa ? undefined : sa) : between !== undefined ? ((1 - between) as 0 | 1) : undefined;
    if (first !== undefined) {
      const other = (1 - first) as 0 | 1;
      return { tur: "guc", satir: line, taraflar: [{ ad: sides[first].ad, renk: sides[first].renk, sayi: grouped(a.value) }, { ad: sides[other].ad, renk: sides[other].renk, sayi: grouped(b.value) }] };
    }
  }
  const one = counts[0]!;
  if (!one.after) return undefined;
  return { tur: "sayac", satir: line, deger: one.value, etiket: one.after.slice(0, 60) };
}

/**
 * The last resort after the script's rounds: in a scene without a map and without cards, the first narrator line that
 * counts armies gets its card (one per scene, so cards never overlap). Logged as fixes; a card that would break the
 * episode is not added.
 */
export function addToldStrengths(episode: Episode, dil: ScriptLanguage = "en"): { episode: Episode; fixes: string[] } {
  const narrators = new Set(episode.oyuncu_kadrosu.filter((c) => !c.gorunur).map((c) => c.id));
  const sides = episodeSides(episode);
  const fixes: string[] = [];
  const sahneler = episode.sahneler.map((s): EpisodeScene => {
    if (s.harita?.merkez || s.bilgi_kartlari?.length) return s;
    for (const [i, l] of s.satirlar.entries()) {
      if (!narrators.has(l.karakter)) continue;
      const card = toldStrengthCard(l.metin, i, sides, dil);
      if (!card) continue;
      fixes.push(
        card.tur === "guc"
          ? `${s.id}: anlatıcı iki ordunun sayısını veriyor — güç kartı eklendi (${card.taraflar![0].ad} ${card.taraflar![0].sayi} / ${card.taraflar![1].ad} ${card.taraflar![1].sayi}, satır ${i})`
          : `${s.id}: anlatıcı bir sayı veriyor — sayaç kartı eklendi (${grouped(card.deger!)} ${card.etiket}, satır ${i})`,
      );
      return { ...s, bilgi_kartlari: [card] };
    }
    return s;
  });
  if (!sahneler.some((s, i) => s !== episode.sahneler[i])) return { episode, fixes };
  const next = { ...episode, sahneler };
  if (!validateEpisode(next).ok) return { episode, fixes: ["sayı kartları bölümü bozuyordu; eklenmedi"] };
  return { episode: next, fixes };
}
