import { splitDirections } from "../tts/StageDirections";
import { episodeNames, hookAnchor, shiftLineRefs } from "./HookFollow";

/**
 * A Short's question title (owner, 23 Nov 2026, "bütün planları uygula", after the study of Knowledgia's Shorts — 2.2 M
 * subscribers, median 1.86 M views a Short): all 52 of its titles are a Why/How/What question ("Why wasn't Portugal
 * Conquered by Spain?", 11 M views), and every one opens with the narrator reading that question word for word at 0 s
 * over a labelled map. Its weakest Shorts (Stalingrad 216 k, Dunkirk 50 k) opened on black, mid-story, with no question.
 * So a Short carries `soru`: the YouTube title and the first spoken line, a question a viewer would type into search,
 * with a concrete anchor (a name or a number: HookFollow.hookAnchor). Pure, no model, no files.
 */

/** Words a question title may have: Knowledgia's run 5–11 ("Why did the Soviet Union Collapse?"). */
export const QUESTION_MIN_WORDS = 4;
export const QUESTION_MAX_WORDS = 14;
/** Characters, so that " #Shorts" still fits in YouTube's 100 and the phone shows it whole. */
export const QUESTION_MAX_CHARS = 80;

/** How a question opens (folded, English and Turkish). */
const QUESTION_OPENERS = /^(why|how|what|when|who|whose|which|where|did|was|were|is|could|can|would|should|has|had|do|does|neden|nasil|ne|kim|hangi|nerede|niye|niçin|nicin)\b/;

const fold = (text: string) => text.replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const wordsOf = (text: string) => text.split(/\s+/).filter((w) => /\p{L}|\d/u.test(w));
/** A line compared by its words alone (case, punctuation and stage directions left out). */
const bareWords = (text: string) => wordsOf(fold(splitDirections(text).speech)).map((w) => w.replace(/[^\p{L}\d]+/gu, "")).filter(Boolean).join(" ");

export type QuestionFault = "yok" | "soru-degil" | "uzunluk" | "dayanak-yok" | "ilk-satir-degil";

interface Line { readonly karakter?: string; readonly metin?: string }
interface Scene { readonly id?: string; readonly satirlar?: readonly Line[]; readonly bilgi_kartlari?: readonly { readonly tur?: string; readonly deger?: number }[] }
interface QuestionEpisode {
  readonly soru?: string;
  readonly oyuncu_kadrosu?: readonly { readonly id?: string; readonly ad?: string; readonly gorunur?: boolean }[];
  readonly sahneler?: readonly Scene[];
}

/** What is wrong with a question title on its own: not a question, too short or too long, no name or number in it. */
export function questionTitleFaults(soru: string | undefined, names: readonly string[] = []): QuestionFault[] {
  const q = soru?.trim() ?? "";
  if (!q) return ["yok"];
  const out: QuestionFault[] = [];
  if (!q.endsWith("?") || !QUESTION_OPENERS.test(fold(q))) out.push("soru-degil");
  const n = wordsOf(q).length;
  if (n < QUESTION_MIN_WORDS || n > QUESTION_MAX_WORDS || q.length > QUESTION_MAX_CHARS) out.push("uzunluk");
  // A title capitalises every word ("Why Did the Soviet Union Collapse?"): only a name the episode knows counts as one.
  const known = new Set(names);
  const sentence = q.split(/\s+/).map((w) => (known.has(w.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "").replace(/['’]s$/u, "")) ? w : w.toLowerCase())).join(" ");
  if (!hookAnchor(sentence, names)) out.push("dayanak-yok");
  return out;
}

/** The episode's first spoken line: where it stands and what it says. */
function firstSpoken(episode: QuestionEpisode): { readonly scene: number; readonly line: number; readonly metin: string } | undefined {
  for (const [si, s] of (episode.sahneler ?? []).entries()) {
    for (const [li, l] of (s.satirlar ?? []).entries()) if (typeof l.metin === "string" && splitDirections(l.metin).speech) return { scene: si, line: li, metin: l.metin };
  }
  return undefined;
}

/** Whether the episode opens by saying its question (the same words; case, punctuation and directions aside). */
export function opensWithQuestion(episode: QuestionEpisode): boolean {
  const first = firstSpoken(episode);
  return !!first && !!episode.soru?.trim() && bareWords(first.metin) === bareWords(episode.soru);
}

/**
 * Everything wrong with a Short's question: its own faults (questionTitleFaults) and, when it is a good question, a first
 * line that does not say it.
 */
export function questionFaults(episode: QuestionEpisode): QuestionFault[] {
  const own = questionTitleFaults(episode.soru, episodeNames(episode));
  if (own.length) return own;
  return opensWithQuestion(episode) ? [] : ["ilk-satir-degil"];
}

/**
 * The writer's repair ask for a Short's question (ScriptEngine.openingProblems, asked first with the other opening asks).
 * Tagged QUESTION TITLE so the opening weight counts it.
 */
export function questionProblems(episode: QuestionEpisode): string[] {
  const clash = questionNumberClash(episode);
  const clashAsk = clash
    ? [`the question says ${clash.question.toLocaleString("en-US")} but the "sayac" card shows ${clash.card.toLocaleString("en-US")} for the same thing: use ONE figure from the source bank in "soru", the first line, every spoken figure and the card — QUESTION TITLE`]
    : [];
  const faults = questionFaults(episode);
  if (!faults.length) return clashAsk;
  const q = episode.soru?.trim();
  const what = faults.map((f) =>
    f === "yok"
      ? `the episode has no "soru"`
      : f === "soru-degil"
        ? `"soru" ("${q}") is not a question opening with Why/How/What/When/Who and ending in "?"`
        : f === "uzunluk"
          ? `"soru" has ${wordsOf(q ?? "").length} words / ${q?.length ?? 0} characters (${QUESTION_MIN_WORDS}–${QUESTION_MAX_WORDS} words, at most ${QUESTION_MAX_CHARS} characters)`
          : f === "dayanak-yok"
            ? `"soru" ("${q}") has no concrete anchor — no name, no number`
            : `the first spoken line does not say "soru" ("${q}") word for word`,
  );
  return [...clashAsk, `${what.join("; ")}: give the Short a "soru" — the question a viewer would type into search, which the video answers ("Why Couldn't 290,000 Germans Escape Stalingrad?", "How Did 21 Biplanes Sink Italy's Fleet?"), with a name or a number in it — and make the very first line the narrator saying exactly that question over the opening map; it is also the video's title — QUESTION TITLE`];
}

/** Whole numbers written in a text ("290,000", "21"); years 1000–2099 written alone are kept too — the caller compares magnitudes. */
function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d[\d,.]*/g)].map((m) => Number(m[0].replace(/[,.](?=\d{3}\b)/g, ""))).filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Owner, 26 Nov 2026 (review of the Stalingrad Short bolGvK1B9m0: title "Why Couldn't 290,000 Axis Troops Escape
 * Stalingrad?", big card "270,556 Axis trapped"): the question's number and the big "sayac" number must be one figure.
 * A card value within ±40 % of a number in the question, but not equal to it, is the same quantity told twice differently.
 */
export function questionNumberClash(episode: QuestionEpisode): { readonly question: number; readonly card: number } | undefined {
  const asked = numbersIn(episode.soru ?? "").filter((n) => n >= 10);
  if (!asked.length) return undefined;
  for (const scene of episode.sahneler ?? []) {
    for (const card of scene.bilgi_kartlari ?? []) {
      if (card.tur !== "sayac" || typeof card.deger !== "number" || card.deger <= 0) continue;
      for (const q of asked) {
        const ratio = card.deger / q;
        if (card.deger !== q && ratio > 0.6 && ratio < 1.4) return { question: q, card: card.deger };
      }
    }
  }
  return undefined;
}

/**
 * The last resort when the paid rounds left a good question unsaid (QuestionTitle owner rule): the narrator's line with the
 * question goes in before the first scene's first line, and that scene's line indexes move one down (HookFollow
 * shiftLineRefs). Nothing is changed when the question itself is faulty, when it is already said first, or when the
 * episode has no narrator (an invisible cast member). The caller validates the result.
 */
export function questionFirst<E extends QuestionEpisode>(episode: E): { readonly episode: E; readonly fix?: string } {
  if (questionTitleFaults(episode.soru, episodeNames(episode)).length || opensWithQuestion(episode)) return { episode };
  const narrator = (episode.oyuncu_kadrosu ?? []).find((c) => c.gorunur === false)?.id;
  const scenes = episode.sahneler ?? [];
  const scene = scenes[0] as (Scene & Record<string, unknown>) | undefined;
  if (!narrator || !scene) return { episode };
  const { satirlar, ...parts } = scene;
  const moved = { ...(shiftLineRefs(parts, -1) as Record<string, unknown>), satirlar: [{ karakter: narrator, metin: episode.soru!.trim() }, ...(satirlar ?? [])] };
  return {
    episode: { ...episode, sahneler: scenes.map((s, i) => (i === 0 ? moved : s)) } as E,
    fix: `${(scene.id as string | undefined) ?? "ilk sahne"}: açılış sorusu ("${episode.soru!.trim()}") ilk satır olarak anlatıcıya eklendi`,
  };
}

/** The YouTube title of a Short with a question: the question itself, "#Shorts" after it (within 100 characters). */
export function questionVideoTitle(soru: string): string {
  const q = soru.trim();
  return /#shorts\b/i.test(q) ? q : `${q} #Shorts`.slice(0, 100);
}

/**
 * Search tags from the question (Knowledgia tags every Short with the question's search variants: "why was portugal
 * never conquered by spain", "why didn't spain conquer portugal"): the question in lower case without its mark, and
 * the same without its articles ("why did caesar cross rubicon"). The package's model adds its own variants beside these.
 */
export function questionTags(soru: string): string[] {
  const base = soru.trim().replace(/[?!.]+$/u, "").replace(/\s+/g, " ").toLowerCase();
  if (!base) return [];
  const plain = base.replace(/\b(the|a|an)\s+/gu, "");
  return [...new Set([base, plain].map((t) => t.slice(0, 100)))];
}
