import type { V3Landscape } from "../render/RenderPlanTypes";
import { EFFECTS, EMOTIONS, type Episode, type EpisodeScene, GESTURES, LANDSCAPES, type LineAct, type SceneLine } from "../episode/EpisodeTypes";
import type { V3Budget, V3ModelChoice } from "../script/V3Budget";
import { BRAIN_NAMES, type DebateEntry, readJsonAnswer } from "./Council";

/**
 * AYAS as the director (owner approval, 2 Nov 2026: "after the first cut the brains — script writer, historian,
 * humourist, quality — debate and report to AYAS; AYAS decides fixes from a fixed list: rewrite lines, add stage
 * action, change a set; rounds and cost stay bounded; the best version is delivered"). Each critic scores the cut from
 * its own discipline and writes at most MAX_NOTES notes; each then supports or objects to the others' notes; AYAS reads
 * the notes and the objections and orders at most MAX_EDITS fixes from the menu, which the production applies in its
 * next retouch round (the same MAX_RETOUCH_ROUNDS as the likeness and set retouch). Nothing here changes code; a note
 * no menu item can fix stays a finding for the report.
 */
export const COUNCIL_CRITICS = ["kurgu", "arastirma", "mizah", "kalite"] as const;
export type Critic = (typeof COUNCIL_CRITICS)[number];

export const CRITIC_ROLES: Readonly<Record<Critic, string>> = {
  kurgu: "the script writer (the hook, the structure, the pace, how dialogue carries the story)",
  arastirma: "the historian (whether what is said is true to the period and clear: names, dates, stakes, cause and effect)",
  mizah: "the humour writer (whether the jokes land, their timing, character comedy, where a gag is missing or falls flat)",
  kalite: "the picture critic (whether the screen shows what is being told: who acts on the stage, whether the set fits the moment)",
};

/**
 * What each critic asks itself, and which measures it is shown. On the Caesar Short (2 Nov 2026) every critic was
 * shown the quality brain's frame findings and all four wrote the same five "not shown on screen" notes; the humourist
 * and the historian now read the script for their own faults, and only the picture critic gets the frame findings.
 */
export const CRITIC_FOCUS: Readonly<Record<Critic, string>> = {
  kurgu: "Does the first line hook within seconds? Is the story clear from line to line, does each scene turn, does the dialogue carry it instead of the narrator? Which line is flat, too long or redundant?",
  arastirma: "Is any line wrong for the period (a fact, a name, a date, a word or object that did not exist yet)? Is anything important left unclear — who, when, why it mattered? Is a legend told as fact without saying so?",
  mizah: "Which joke falls flat, and why (no setup, a weak punchline, said by the wrong character, explained)? Where is a gag missing that the moment begs for? Is a joke stepping on a serious beat?",
  kalite: "While each line is said, does the stage show it — do the characters on stage act out what the narrator tells? Does each stage scene's set fit what happens there?",
};

export const CRITIC_SEES: Readonly<Record<Critic, readonly ("tempo" | "qc" | "bulgular")[]>> = {
  kurgu: ["tempo", "qc"],
  arastirma: ["qc"],
  mizah: [],
  kalite: ["tempo", "bulgular"],
};

/** A council mean under this asks AYAS for a revision (the owner's "worst acceptable 8/10" of the likeness, 20 Oct 2026). */
export const DIRECTOR_BAR = 8;
export const MAX_NOTES = 5;
export const MAX_EDITS = 8;

/**
 * A council round's spend ceiling (inside the video's own cap): four critics and their replies on gpt-4.1-mini, AYAS
 * and the rewrite on gpt-4.1 — about 2 cents for a Short's script, about 8 for a 25-minute one.
 */
export const councilCapUsd = (targetS: number): number => (targetS >= 300 ? 0.3 : 0.1);

export type EditKind = "satir" | "oyun" | "set";

export interface CriticNote {
  readonly id: string;
  readonly beyin: Critic;
  readonly sahne: string;
  readonly satir?: number;
  /** In Turkish, for the owner's report and AYAS. */
  readonly sorun: string;
  readonly oneri: string;
  /** Which menu item would fix it; "yok": none of them (it stays a finding). */
  readonly eylem: EditKind | "yok";
}

export interface CriticReport {
  readonly beyin: Critic;
  /** 1..10 from the critic's discipline (8 = good enough to publish). */
  readonly puan: number;
  readonly notlar: readonly CriticNote[];
}

export interface CriticReply {
  readonly beyin: Critic;
  readonly destek: readonly string[];
  readonly itiraz: readonly { readonly id: string; readonly neden: string }[];
}

export type DirectorEdit =
  | { readonly tur: "satir"; readonly sahne: string; readonly satir: number; readonly talimat: string; readonly neden: string }
  | { readonly tur: "oyun"; readonly sahne: string; readonly satir: number; readonly oyun: readonly LineAct[]; readonly neden: string }
  | { readonly tur: "set"; readonly sahne: string; readonly manzara?: V3Landscape; readonly tasarim?: string; readonly neden: string };

/** A line the script writer rewrote on AYAS's order. */
export interface LineRewrite {
  readonly sahne: string;
  readonly satir: number;
  readonly eski: string;
  readonly metin: string;
  readonly balon?: string;
}

export interface DirectorDecision {
  /** Turkish: AYAS's verdict and what it changes. */
  readonly ozet: string;
  readonly duzeltmeler: readonly DirectorEdit[];
  readonly yeniden: readonly LineRewrite[];
  /** AYAS's fixes that broke the menu's rules (an unknown scene, an actor off stage, a set on a map) and were dropped. */
  readonly elenen?: number;
}

/** One round's council: the critics' reports and replies, the mean, AYAS's decision (when it was asked). */
export interface CouncilSession {
  readonly tur: number;
  readonly puan: number;
  readonly raporlar: readonly CriticReport[];
  readonly yanitlar: readonly CriticReply[];
  readonly karar?: DirectorDecision;
  /** Why AYAS was not asked (the cut passed the bar, no round left…). */
  readonly kararYok?: string;
  /** Answers that could not be read even when asked again (the start of each, to see why). */
  readonly okunamayan?: readonly { readonly beyin: Critic; readonly ham: string }[];
  readonly maliyetUsd: number;
}

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");
const isStage = (sc: EpisodeScene) => !sc.harita?.merkez && sc.kip !== "fotograf";

/**
 * The scene a model's answer means: its exact id, else the one scene whose id starts with it (the Caesar Short's critics,
 * 2 Nov 2026, wrote "s1" for "s1-capture" and every note was lost).
 */
export function findScene(episode: Pick<Episode, "sahneler">, id: unknown): EpisodeScene | undefined {
  const want = String(id ?? "").trim();
  if (!want) return undefined;
  const exact = episode.sahneler.find((s) => s.id === want);
  if (exact) return exact;
  const prefixed = episode.sahneler.filter((s) => s.id.startsWith(`${want}-`));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

/** A line number as a model writes it (3, "3", "#3", "s1-capture#3"), if the scene has that line. */
export function lineIndex(sc: Pick<EpisodeScene, "satirlar">, v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && /^(?:.*#)?\s*\d+\s*$/.test(v) ? Number(/(\d+)\s*$/.exec(v)![1]) : NaN;
  return Number.isInteger(n) && n >= 0 && n < sc.satirlar.length ? n : undefined;
}

/** A real scene id for the prompts' JSON examples, so the model copies the id's whole form. */
const exampleScene = (episode: Pick<Episode, "sahneler">) => (episode.sahneler.find(isStage) ?? episode.sahneler[0])?.id ?? "s1";

/** Who stands on a scene's stage (only they can act out a line). */
export function onStage(sc: EpisodeScene): Set<string> {
  return new Set(isStage(sc) ? (sc.sahne_duzeni ?? []).map((b) => b.karakter) : []);
}

export interface ScriptTimes {
  readonly scenes: readonly { readonly start: number; readonly end: number }[];
}

/** The script as the council reads it: scene by scene, numbered lines, who is on stage, what they do. */
export function compactScript(episode: Episode, times?: ScriptTimes): string {
  const name = (id: string) => (episode.oyuncu_kadrosu.find((c) => c.id === id)?.gorunur ? id : `${id} (voice only)`);
  return episode.sahneler
    .map((sc, si) => {
      const kind = sc.harita?.merkez ? "map" : sc.kip === "fotograf" ? "photo" : "stage";
      const t = times?.scenes[si];
      const set = kind === "stage" && sc.ortam ? ` — set: ${sc.ortam.manzara}, ${sc.ortam.uslup}, ${sc.ortam.zaman}` : "";
      const stage = [...onStage(sc)];
      const head = `SCENE ${sc.id} — ${kind} — ${sc.mekan}${set}${stage.length ? ` — on stage: ${stage.join(", ")}` : ""}${t ? ` — ${t.start.toFixed(0)}–${t.end.toFixed(0)} s` : ""}`;
      const lines = sc.satirlar.map((l, li) => {
        const extra = [l.jest ? `gesture ${l.jest}` : "", l.hareket ? `move ${l.hareket}` : "", l.balon ? `bubble "${l.balon}"` : "", l.oyun?.length ? `acts: ${l.oyun.map((a) => [a.karakter, a.jest, a.duygu, a.efekt].filter(Boolean).join(" ")).join("; ")}` : ""].filter(Boolean).join(", ");
        return `  #${li} ${name(l.karakter)} (${l.duygu}): ${l.metin}${extra ? ` [${extra}]` : ""}`;
      });
      return [head, ...lines].join("\n");
    })
    .join("\n");
}

export interface CouncilContext {
  readonly baslik: string;
  readonly sureSn: number;
  readonly shorts: boolean;
  /** Our pace against the studied references, one line each. */
  readonly tempo?: readonly string[];
  /** The QC rows the cut failed. */
  readonly qc?: readonly string[];
  /** What the other brains and the measures found (quality frames, layout, sound…), one line each. */
  readonly bulgular?: readonly string[];
}

export function criticPrompt(beyin: Critic, script: string, ctx: CouncilContext, lessons: readonly string[], example = "s1"): string {
  return `You are ${CRITIC_ROLES[beyin]} in the council of an animated history video studio. AYAS, the director, will decide what to fix in this first cut of "${ctx.baslik}" (${Math.round(ctx.sureSn)} s, ${ctx.shorts ? "a vertical YouTube Short" : "a YouTube video"}). Judge it ONLY from your discipline; another brain covers the rest.

${((m) => (m.length ? `\nWHAT WAS MEASURED IN THE CUT:\n${m.map((x) => `- ${x}`).join("\n")}\n` : ""))([...(CRITIC_SEES[beyin].includes("tempo") ? (ctx.tempo ?? []) : []), ...(CRITIC_SEES[beyin].includes("qc") ? (ctx.qc ?? []).map((q) => `QC failed: ${q}`) : []), ...(CRITIC_SEES[beyin].includes("bulgular") ? (ctx.bulgular ?? []) : [])])}${lessons.length ? `\nYOUR LESSONS (earlier episodes, studied reference videos, the owner's rules):\n${lessons.map((l) => `- ${l}`).join("\n")}\n` : ""}
SCRIPT (#n = line number; "on stage" = who can act; acts = what characters do while a line is said):
${script}

ASK YOURSELF: ${CRITIC_FOCUS[beyin]}

Score the cut 1–10 from your discipline (8 = good enough to publish, 10 = as good as the best history channels) and write at most ${MAX_NOTES} notes, worst first. Each note points to one scene (and a line when it is about a line), says in Turkish what is wrong ("sorun") and the concrete fix ("oneri"), and names the fix: "satir" = rewrite that line; "oyun" = the characters on stage act it out during that line; "set" = the stage scene's set does not fit what happens; "yok" = none of these three can fix it. "sahne" is the scene id exactly as written after SCENE, "satir" a plain number. Keep "sorun" and "oneri" under 200 characters each. Faces, likeness and costumes are judged by other brains: never write notes about them.
Return ONLY JSON: {"puan": 7, "notlar": [{"sahne": "${example}", "satir": 3, "sorun": "...", "oneri": "...", "eylem": "satir|oyun|set|yok"}]}`;
}

export function parseCriticReport(beyin: Critic, text: string, episode: Pick<Episode, "sahneler">, first = 1): CriticReport | undefined {
  const v = readJsonAnswer<{ puan?: unknown; notlar?: unknown }>(text);
  const score = typeof v?.puan === "number" ? v.puan : typeof v?.puan === "string" ? Number.parseFloat(v.puan) : NaN;
  if (!v || !Number.isFinite(score)) return undefined;
  const notes = (Array.isArray(v.notlar) ? (v.notlar as Record<string, unknown>[]) : []).flatMap((n): CriticNote[] => {
    const sc = findScene(episode, n?.sahne);
    const sorun = clip(n?.sorun, 300);
    if (!sc || !sorun) return [];
    const li = lineIndex(sc, n.satir);
    const eylem = (["satir", "oyun", "set"] as const).find((k) => k === n.eylem) ?? "yok";
    return [{ id: "", beyin, sahne: sc.id, ...(li !== undefined ? { satir: li } : {}), sorun, oneri: clip(n.oneri, 300), eylem }];
  });
  return { beyin, puan: Math.max(1, Math.min(10, Math.round(score))), notlar: notes.slice(0, MAX_NOTES).map((n, i) => ({ ...n, id: `n${first + i}` })) };
}

const noteLine = (episode: Episode, n: CriticNote) => {
  const line = n.satir !== undefined ? episode.sahneler.find((s) => s.id === n.sahne)?.satirlar[n.satir] : undefined;
  return `${n.id} (${n.beyin}) ${n.sahne}${n.satir !== undefined ? `#${n.satir}` : ""} [${n.eylem}]: ${n.sorun} → ${n.oneri}${line ? ` | line: ${line.karakter}: "${line.metin}"` : ""}`;
};

export function replyPrompt(beyin: Critic, episode: Episode, notes: readonly CriticNote[]): string {
  return `You are ${CRITIC_ROLES[beyin]} in the council of an animated history video studio. The other brains wrote these notes on the first cut of "${episode.baslik}":
${notes.filter((n) => n.beyin !== beyin).map((n) => `- ${noteLine(episode, n)}`).join("\n")}

From your discipline, support the notes you agree with and object to the ones whose fix would harm the video (a rewrite that would break a fact or lose a joke, an action that would distract from the line, a set change that would not fit the period…), each objection with its reason in Turkish. Leave out notes you have no view on.
Return ONLY JSON: {"destek": ["n3"], "itiraz": [{"id": "n5", "neden": "..."}]}`;
}

export function parseReply(beyin: Critic, text: string, ids: ReadonlySet<string>): CriticReply {
  const v = readJsonAnswer<{ destek?: unknown; itiraz?: unknown }>(text);
  const destek = (Array.isArray(v?.destek) ? v!.destek : []).map(String).filter((id) => ids.has(id));
  const itiraz = (Array.isArray(v?.itiraz) ? (v!.itiraz as Record<string, unknown>[]) : []).flatMap((x) => (ids.has(String(x?.id)) && clip(x.neden, 300) ? [{ id: String(x.id), neden: clip(x.neden, 300) }] : []));
  return { beyin, destek: [...new Set(destek)], itiraz };
}

export function councilMean(reports: readonly CriticReport[]): number {
  return reports.length ? Math.round((reports.reduce((a, r) => a + r.puan, 0) / reports.length) * 10) / 10 : 0;
}

export function directorPrompt(episode: Episode, script: string, reports: readonly CriticReport[], replies: readonly CriticReply[], earlier: readonly string[], maxEdits = MAX_EDITS): string {
  const notes = reports.flatMap((r) => r.notlar);
  const views = (id: string) => {
    const pro = replies.filter((r) => r.destek.includes(id)).map((r) => r.beyin);
    const con = replies.flatMap((r) => r.itiraz.filter((x) => x.id === id).map((x) => `${r.beyin}: ${x.neden}`));
    return `${pro.length ? ` | supported by ${pro.join(", ")}` : ""}${con.length ? ` | objections — ${con.join("; ")}` : ""}`;
  };
  const stages = episode.sahneler.filter((s) => onStage(s).size).map((s) => `${s.id}: ${[...onStage(s)].join(", ")}`).join("; ");
  return `You are AYAS, the director and manager of an animated history video studio. Your council (script writer, historian, humour writer, picture critic) debated the first cut of "${episode.baslik}". Scores: ${reports.map((r) => `${r.beyin} ${r.puan}/10`).join(", ")}.

NOTES (with the other brains' support and objections):
${notes.map((n) => `- ${noteLine(episode, n)}${views(n.id)}`).join("\n") || "- none"}
${earlier.length ? `\nYOUR EARLIER DECISIONS AND HOW THEY WORKED:\n${earlier.map((l) => `- ${l}`).join("\n")}\n` : ""}
SCRIPT:
${script}

Decide what to fix in ONE revision round, using ONLY these fixes:
1. {"tur": "satir", "sahne", "satir", "talimat": "<English instruction to the script writer>"} — the writer rewrites that line, keeping its speaker and facts;
2. {"tur": "oyun", "sahne", "satir", "oyun": [{"karakter", "jest", "duygu", "efekt"}]} — characters ON STAGE in that scene act during the line (the speaker's own entry sets the gesture and face it speaks with; one entry per character); jest: ${GESTURES.join(", ")}; duygu: ${EMOTIONS.join(", ")}; efekt: ${EFFECTS.join(", ")};
3. {"tur": "set", "sahne", "manzara", "tasarim"} — a stage scene gets another place: manzara one of ${LANDSCAPES.join(", ")}, and/or "tasarim" a new English description of the drawn place with NO people in it (the characters stand on the stage in front of it).
On stage: ${stages || "nobody"}. "sahne" is the scene id exactly as written after SCENE (like "${exampleScene(episode)}"); "satir" is the line's number as a plain number.
Faces, likeness and costumes are not yours to fix here: the retouch brain redesigns them by its own measures; never use a set or an act for them.
At most ${maxEdits} fixes, the most valuable first. Prefer what several brains support, weigh every objection, and leave out what these fixes cannot change. If the cut is good enough, order no fix. Every fix has "neden": its reason in Turkish.
Return ONLY JSON: {"ozet": "<two Turkish sentences: your verdict and what you change>", "duzeltmeler": [...]}`;
}

/**
 * AYAS's answer as fixes the production can apply: only known scenes and lines, only characters on that stage (never
 * the speaker of the line), only the menu's gestures, faces, effects and landscapes, no set on a map or photo scene,
 * one fix of a kind per scene line, at most `maxEdits`.
 */
export function parseDecision(episode: Episode, text: string, maxEdits = MAX_EDITS): Omit<DirectorDecision, "yeniden"> | undefined {
  const v = readJsonAnswer<{ ozet?: unknown; duzeltmeler?: unknown }>(text);
  if (!v) return undefined;
  const visible = new Set(episode.oyuncu_kadrosu.filter((c) => c.gorunur).map((c) => c.id));
  const seen = new Set<string>();
  const edits: DirectorEdit[] = [];
  for (const e of Array.isArray(v.duzeltmeler) ? (v.duzeltmeler as Record<string, unknown>[]) : []) {
    const sc = findScene(episode, e?.sahne);
    if (!sc || edits.length >= maxEdits) continue;
    const neden = clip(e.neden, 300);
    const li = lineIndex(sc, e.satir);
    const key = `${e.tur}|${sc.id}|${e.tur === "set" ? "" : li}`;
    if (seen.has(key)) continue;
    if (e.tur === "satir" && li !== undefined && clip(e.talimat, 400)) {
      edits.push({ tur: "satir", sahne: sc.id, satir: li, talimat: clip(e.talimat, 400), neden });
    } else if (e.tur === "oyun" && li !== undefined && Array.isArray(e.oyun)) {
      const stage = onStage(sc);
      const acts = (e.oyun as Record<string, unknown>[]).flatMap((a): LineAct[] => {
        const id = String(a?.karakter ?? "");
        if (!stage.has(id) || !visible.has(id)) return [];
        const act: LineAct = {
          karakter: id,
          ...(GESTURES.includes(a.jest as never) ? { jest: a.jest as LineAct["jest"] } : {}),
          ...(EMOTIONS.includes(a.duygu as never) ? { duygu: a.duygu as LineAct["duygu"] } : {}),
          ...(EFFECTS.includes(a.efekt as never) ? { efekt: a.efekt as LineAct["efekt"] } : {}),
        };
        return act.jest || act.duygu || act.efekt ? [act] : [];
      });
      // One act per character, its first gesture, face and effect (AYAS once gave the captain three gestures for a line).
      const merged = new Map<string, LineAct>();
      for (const a of acts) {
        const had = merged.get(a.karakter);
        merged.set(a.karakter, had ? { ...a, ...had } : a);
      }
      const once = [...merged.values()];
      if (!once.length) continue;
      edits.push({ tur: "oyun", sahne: sc.id, satir: li, oyun: once, neden });
    } else if (e.tur === "set" && isStage(sc)) {
      const manzara = LANDSCAPES.includes(e.manzara as V3Landscape) ? (e.manzara as V3Landscape) : undefined;
      const tasarim = clip(e.tasarim, 600);
      if (!manzara && tasarim.length < 20) continue;
      edits.push({ tur: "set", sahne: sc.id, ...(manzara ? { manzara } : {}), ...(tasarim.length >= 20 ? { tasarim } : {}), neden });
    } else continue;
    seen.add(key);
  }
  const asked = Array.isArray(v.duzeltmeler) ? Math.min(v.duzeltmeler.length, maxEdits) : 0;
  return { ozet: clip(v.ozet, 600), duzeltmeler: edits, ...(asked > edits.length ? { elenen: asked - edits.length } : {}) };
}

const SEP = "\u0001";
const lineKey = (sahne: string, satir: number) => `${sahne}${SEP}${satir}`;

/**
 * A Short's rewritten line may grow this much at most (share of its old length, and a few characters): the Zanzibar
 * remake's retouch round (4 Nov 2026) let lines grow up to 1.8× and the 48 s Short ran 60.1 s, over the ceiling.
 */
export const SHORT_REWRITE_GROWTH = 1.1;
const SHORT_REWRITE_SLACK = 15;

export function rewritePrompt(episode: Episode, edits: readonly DirectorEdit[], dil: string, opts: { readonly short?: boolean } = {}): string {
  const rows = edits.flatMap((e) => {
    if (e.tur !== "satir") return [];
    const sc = episode.sahneler.find((s) => s.id === e.sahne)!;
    const line = sc.satirlar[e.satir]!;
    const before = sc.satirlar[e.satir - 1];
    const after = sc.satirlar[e.satir + 1];
    return [`- ${e.sahne}#${e.satir} — ${line.karakter} (${line.duygu}): "${line.metin}"${line.balon ? ` | bubble: "${line.balon}"` : ""}\n  before: ${before ? `${before.karakter}: "${before.metin}"` : "(scene start)"} | after: ${after ? `${after.karakter}: "${after.metin}"` : "(scene end)"}\n  AYAS: ${e.talimat}`];
  });
  return `You are the script writer of "${episode.baslik}" (an animated history video, ${episode.donem}). AYAS, the director, asked for these lines to be rewritten. Write each new line in the video's language (${dil === "tr" ? "Turkish" : "American English"}); keep its speaker, every name, date and fact it carries, and add no new fact (when AYAS asks for context, use only what the other lines already say); keep it at most 240 characters and ${opts.short ? "NO LONGER than its old line — this is a YouTube Short at its time limit; a funny line stays funny" : "within about ±40% of its old length"}; keep stage directions in (parentheses) only where the old line had them; follow AYAS's instruction. A line with a speech bubble gets a new "balon" of at most 8 words taken from the new line.
${rows.join("\n")}
Return ONLY JSON, "sahne" and "satir" as given above: {"satirlar": [{"sahne": "${edits.find((e) => e.tur === "satir")?.sahne ?? exampleScene(episode)}", "satir": 3, "metin": "...", "balon": "..."}]}`;
}

const bubbleWords = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean);

/**
 * A rewritten line's speech bubble: the writer's, when it has at most 8 words and most of them are in the new line;
 * else the new line's last sentence cut to 8 words — an old bubble never hangs over a line that no longer says it.
 */
export function bubbleFor(metin: string, offered: string): string {
  const words = new Set(bubbleWords(metin));
  const b = bubbleWords(offered);
  if (b.length && b.length <= 8 && b.filter((w) => words.has(w)).length / b.length >= 0.6) return offered;
  const last = metin.split(/(?<=[.!?…])\s+/).filter((s) => s.trim()).pop() ?? metin;
  const cut = last.trim().split(/\s+/);
  return cut.length <= 8 ? last.trim() : `${cut.slice(0, 8).join(" ").replace(/[,;:]$/, "")}…`;
}

const MONTHS =
  /^(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)$/iu;
const SENTENCE_STARTERS = new Set(["the", "a", "an", "at", "on", "in", "but", "and", "after", "before", "well", "so", "then", "now", "yes", "no", "oh", "please", "even", "right", "who", "what", "why", "how", "is", "it", "i", "we", "you", "they", "he", "she", "this", "that", "history", "bu", "ve", "ama", "sonra", "önce"]);

/**
 * What a rewritten line says that the old one did not and the episode nowhere does: numbers, months, and names
 * (capitalised words) — the writer's new facts. The rewrite prompt forbids them and the fact check missed some: the
 * Zanzibar remake's rounds wrote "After Sultan Hamoud died on August 25…" and "At exactly 9:00 AM, August 27, Rawson
 * delivered his ultimatum" (it was delivered on the 26th, ran out at 9:00 on the 27th). Empty: nothing new.
 */
export function newFacts(episode: Episode, oldLine: string, newLine: string): string[] {
  const norm = (s: string) => s.toLocaleLowerCase("en-US").replace(/[’']s$/u, "");
  const tokens = (s: string) => s.split(/[^\p{L}\p{N}:’']+/u).filter(Boolean);
  const old = new Set(tokens(oldLine).map(norm));
  const known = new Set([
    ...old,
    ...episode.sahneler.flatMap((sc) => sc.satirlar.flatMap((l) => tokens(l.metin).map(norm))),
    ...episode.oyuncu_kadrosu.flatMap((c) => tokens(`${c.ad} ${c.id}`).map(norm)),
    ...tokens(`${episode.baslik} ${episode.konu} ${episode.donem}`).map(norm),
  ]);
  const out: string[] = [];
  // A sentence's first word is capitalised anyway ("Forward, Thirteenth! Into history!"): only later ones may be names.
  const sentenceStart = new Set(newLine.split(/(?<=[.!?…])\s+/u).map((s) => norm(tokens(s)[0] ?? "")));
  for (const [i, t] of tokens(newLine).entries()) {
    const n = norm(t);
    const isNumber = /\d/.test(t);
    const isMonth = MONTHS.test(t);
    const isName = /^\p{Lu}/u.test(t) && !SENTENCE_STARTERS.has(n) && i > 0 && !sentenceStart.has(n);
    // Numbers and months must be in the old line itself (a date moved from elsewhere is still a new claim here).
    if ((isNumber || isMonth) && !old.has(n)) out.push(t);
    else if (isName && !known.has(n)) out.push(t);
  }
  return [...new Set(out)];
}

/** The writer's rewrites that can be used: an ordered line, a new non-empty text of a sane length; a bubble only where one was. */
export function parseRewrites(episode: Episode, edits: readonly DirectorEdit[], text: string, opts: { readonly short?: boolean } = {}): LineRewrite[] {
  const asked = new Set(edits.flatMap((e) => (e.tur === "satir" ? [lineKey(e.sahne, e.satir)] : [])));
  const v = readJsonAnswer<{ satirlar?: unknown }>(text);
  const out = new Map<string, LineRewrite>();
  for (const r of Array.isArray(v?.satirlar) ? (v!.satirlar as Record<string, unknown>[]) : []) {
    const sc = findScene(episode, r?.sahne);
    const key = lineKey(sc?.id ?? "", Number(r?.satir));
    if (!sc || !asked.has(key) || out.has(key)) continue;
    const line = sc.satirlar[Number(r.satir)]!;
    // A stage direction "(stands tall)" only where the old line had one (the Caesar dry run's writer added one).
    const metin = (line.metin.includes("(") ? clip(r.metin, 240) : clip(r.metin, 240).replace(/\s*\([^)]*\)\s*/g, " ").trim());
    const longest = opts.short ? Math.max(line.metin.length * SHORT_REWRITE_GROWTH, line.metin.length + SHORT_REWRITE_SLACK) : Math.max(line.metin.length * 1.8, line.metin.length + 80);
    if (!metin || metin === line.metin || metin.length > longest || metin.length < Math.min(12, line.metin.length)) continue;
    // No new numbers, dates or names (the writer's facts are not checked against the sources line by line).
    if (newFacts(episode, line.metin, metin).length) continue;
    const balon = line.balon ? bubbleFor(metin, clip(r.balon, 70)) : "";
    out.set(key, { sahne: sc.id, satir: Number(r.satir), eski: line.metin, metin, ...(balon ? { balon } : {}) });
  }
  return [...out.values()];
}

/**
 * The episode with AYAS's fixes: rewritten lines (a line without a usable rewrite keeps its text), acts added to the
 * line's own (one per character, AYAS's wins), the set's landscape and design replaced. Pure; the caller validates.
 */
export function applyEdits(episode: Episode, edits: readonly DirectorEdit[], rewrites: readonly LineRewrite[]): Episode {
  const texts = new Map(rewrites.map((r) => [lineKey(r.sahne, r.satir), r] as const));
  return {
    ...episode,
    sahneler: episode.sahneler.map((sc) => {
      const mine = edits.filter((e) => e.sahne === sc.id);
      if (!mine.length) return sc;
      const set = mine.find((e): e is Extract<DirectorEdit, { tur: "set" }> => e.tur === "set");
      const satirlar = sc.satirlar.map((l, li): SceneLine => {
        const rw = texts.get(lineKey(sc.id, li));
        const act = mine.find((e): e is Extract<DirectorEdit, { tur: "oyun" }> => e.tur === "oyun" && e.satir === li);
        let out: SceneLine = l;
        if (rw && mine.some((e) => e.tur === "satir" && e.satir === li)) out = { ...out, metin: rw.metin, ...(rw.balon ? { balon: rw.balon } : {}) };
        if (act) {
          // The speaker's own act is the line's gesture, face and effect (the render never plays "oyun" on the speaker).
          const own = act.oyun.find((a) => a.karakter === l.karakter);
          const others = act.oyun.filter((a) => a.karakter !== l.karakter);
          if (own) out = { ...out, ...(own.jest ? { jest: own.jest } : {}), ...(own.duygu ? { duygu: own.duygu } : {}), ...(own.efekt ? { efekt: own.efekt } : {}) };
          if (others.length) out = { ...out, oyun: [...new Map([...(l.oyun ?? []), ...others].map((a) => [a.karakter, a] as const)).values()] };
        }
        return out;
      });
      return {
        ...sc,
        satirlar,
        ...(set?.manzara && sc.ortam ? { ortam: { ...sc.ortam, manzara: set.manzara } } : {}),
        ...(set?.tasarim ? { arka_plan_sorgusu: { ...sc.arka_plan_sorgusu, tasarim: set.tasarim } } : {}),
      };
    }),
  };
}

/** The rewrites the fact check flags (wrong or disputed), with its reason; the other claims (old lines) are not the rewrite's. */
export function droppedRewrites(rewrites: readonly LineRewrite[], claims: readonly { readonly sahne: string; readonly satir: number; readonly karar: string; readonly gerekce?: string }[]): (LineRewrite & { readonly gerekce: string })[] {
  return rewrites.flatMap((r) => {
    const c = claims.find((x) => x.sahne === r.sahne && Number(x.satir) === r.satir && (x.karar === "yanlis" || x.karar === "tartismali"));
    return c ? [{ ...r, gerekce: c.gerekce ?? c.karar }] : [];
  });
}

/** The fixes that are in effect: a line fix only with its rewrite (an unusable rewrite drops it). */
export function effectiveEdits(edits: readonly DirectorEdit[], rewrites: readonly LineRewrite[]): DirectorEdit[] {
  const done = new Set(rewrites.map((r) => lineKey(r.sahne, r.satir)));
  return edits.filter((e) => e.tur !== "satir" || done.has(lineKey(e.sahne, e.satir)));
}

/** The earliest production step the fixes need: new words are voiced again, a new set is drawn, an act is rendered. */
export function editsStep(edits: readonly DirectorEdit[]): "ses" | "gorsel" | "render" | undefined {
  if (edits.some((e) => e.tur === "satir")) return "ses";
  if (edits.some((e) => e.tur === "set")) return "gorsel";
  return edits.length ? "render" : undefined;
}

export function editLine(e: DirectorEdit): string {
  if (e.tur === "satir") return `${e.sahne}#${e.satir} satır yeniden yazılacak: ${e.talimat}`;
  if (e.tur === "oyun") return `${e.sahne}#${e.satir} sahnede oynanacak: ${e.oyun.map((a) => [a.karakter, a.jest, a.duygu, a.efekt].filter(Boolean).join(" ")).join("; ")}`;
  return `${e.sahne} seti değişecek: ${[e.manzara, e.tasarim].filter(Boolean).join(" — ")}`;
}

/** The session as a council transcript (Turkish, for KURUL.md and AYAS's inbox). */
export function sessionDebate(s: CouncilSession): DebateEntry[] {
  return [
    ...s.raporlar.flatMap((r) => [{ rol: `${BRAIN_NAMES[r.beyin]} (${r.puan}/10)`, metin: r.notlar.length ? r.notlar.map((n) => `${n.id} ${n.sahne}${n.satir !== undefined ? `#${n.satir}` : ""}: ${n.sorun} → ${n.oneri} [${n.eylem}]`).join(" · ") : "not yok" }]),
    ...s.yanitlar.filter((y) => y.destek.length || y.itiraz.length).map((y) => ({ rol: BRAIN_NAMES[y.beyin], metin: [y.destek.length ? `destekliyor: ${y.destek.join(", ")}` : "", ...y.itiraz.map((x) => `itiraz ${x.id}: ${x.neden}`)].filter(Boolean).join(" · ") })),
    s.karar
      ? { rol: BRAIN_NAMES.sef, metin: `kurul ${s.puan}/10. ${s.karar.ozet}${s.karar.duzeltmeler.length ? ` Düzeltmeler: ${s.karar.duzeltmeler.map(editLine).join(" · ")}` : " Düzeltme yok."}${s.karar.elenen ? ` (${s.karar.elenen} düzeltme menü kurallarına uymadığı için elendi)` : ""}` }
      : { rol: BRAIN_NAMES.sef, metin: `kurul ${s.puan}/10 — ${s.kararYok ?? "karar istenmedi"}` },
    ...(s.karar?.yeniden ?? []).map((r) => ({ rol: BRAIN_NAMES.kurgu, metin: `${r.sahne}#${r.satir}: "${r.eski}" → "${r.metin}"` })),
  ];
}

/**
 * Holds one round's council: every critic reports (a critic whose answer is unreadable is left out), every critic
 * answers the others' notes, then — when the cut is under the bar and a round is left — AYAS decides and the writer
 * rewrites the ordered lines. `check` validates the episode the fixes would make (the production's own validator);
 * fixes that would make an invalid episode are dropped as a whole.
 */
export async function holdCouncil(input: {
  readonly budget: V3Budget;
  readonly critic: V3ModelChoice;
  readonly director: V3ModelChoice;
  readonly episode: Episode;
  readonly dil: string;
  readonly round: number;
  readonly canRevise: boolean;
  readonly context: CouncilContext;
  readonly times?: ScriptTimes;
  readonly lessons: (beyin: Critic) => Promise<readonly string[]>;
  readonly earlier: readonly string[];
  readonly check: (e: Episode) => void;
  /**
   * The script's fact check (the production's editor against its source bank) on the episode the rewrites make: the
   * claims it finds wrong or disputed. A rewritten line it flags is dropped and the old one — already checked — stays
   * (Zanzibar remake, 4 Nov 2026: a rewrite asked for "context" wrote "After Sultan Hamoud died…" — Hamad died; Hamoud
   * succeeded him). Undefined: no check (as before).
   */
  readonly factCheck?: (e: Episode) => Promise<readonly { readonly sahne: string; readonly satir: number; readonly karar: string; readonly gerekce?: string }[] | undefined>;
  readonly maxEdits?: number;
  readonly log?: (s: string) => void;
}): Promise<CouncilSession> {
  const log = input.log ?? (() => {});
  const spent0 = input.budget.spentUsd;
  const script = compactScript(input.episode, input.times);
  const raporlar: CriticReport[] = [];
  const okunamayan: { beyin: Critic; ham: string }[] = [];
  for (const beyin of COUNCIL_CRITICS) {
    const prompt = criticPrompt(beyin, script, input.context, await input.lessons(beyin), exampleScene(input.episode));
    // An unreadable answer is asked once more (the picture critic's JSON broke twice in the Caesar dry runs).
    let r: CriticReport | undefined;
    let last = "";
    for (let attempt = 0; attempt < 2 && !r; attempt++) {
      const out = await input.budget.generate(`kurul-${beyin}`, input.critic, attempt ? `${prompt}\n\nYour last answer could not be read as JSON. Return ONLY the JSON object.` : prompt, { maxTokens: 1_800 }).catch((e: Error) => (log(`  kurul: ${BRAIN_NAMES[beyin]} yanıt veremedi (${e.message.slice(0, 120)})`), undefined));
      if (!out) break;
      last = out.result.content;
      r = parseCriticReport(beyin, last, input.episode, raporlar.reduce((a, x) => a + x.notlar.length, 0) + 1);
    }
    if (r) raporlar.push(r);
    else if (last) {
      okunamayan.push({ beyin, ham: last.slice(0, 300) });
      log(`  kurul: ${BRAIN_NAMES[beyin]} iki kez okunamayan yanıt verdi`);
    }
  }
  const puan = councilMean(raporlar);
  const notes = raporlar.flatMap((r) => r.notlar);
  const ids = new Set(notes.map((n) => n.id));
  const yanitlar: CriticReply[] = [];
  if (notes.length) {
    for (const r of raporlar) {
      if (!notes.some((n) => n.beyin !== r.beyin)) continue;
      const out = await input.budget.generate(`kurul-yanit-${r.beyin}`, input.critic, replyPrompt(r.beyin, input.episode, notes), { maxTokens: 700 }).catch(() => undefined);
      if (out) yanitlar.push(parseReply(r.beyin, out.result.content, ids));
    }
  }
  const base = { tur: input.round, puan, raporlar, yanitlar, ...(okunamayan.length ? { okunamayan } : {}) };
  const done = (rest: { karar?: DirectorDecision; kararYok?: string }): CouncilSession => ({ ...base, ...rest, maliyetUsd: Math.round((input.budget.spentUsd - spent0) * 1e6) / 1e6 });
  if (!raporlar.length) return done({ kararYok: "kurul yanıt vermedi" });
  if (!input.canRevise) return done({ kararYok: "rötuş turu hakkı kalmadı" });
  if (puan >= DIRECTOR_BAR && !raporlar.some((r) => r.puan < DIRECTOR_BAR - 1)) return done({ kararYok: `kesim eşiği geçti (${puan}/10 ≥ ${DIRECTOR_BAR})` });
  if (!notes.some((n) => n.eylem !== "yok")) return done({ kararYok: "menüdeki düzeltmelerle giderilecek not yok" });
  const out = await input.budget.generate("ayas-yonetmen", input.director, directorPrompt(input.episode, script, raporlar, yanitlar, input.earlier, input.maxEdits), { maxTokens: 2_000 }).catch((e: Error) => (log(`  AYAS (yönetmen) karar veremedi: ${e.message.slice(0, 120)}`), undefined));
  const decision = out ? parseDecision(input.episode, out.result.content, input.maxEdits) : undefined;
  if (!decision) return done({ kararYok: "AYAS'ın kararı okunamadı" });
  let yeniden: LineRewrite[] = [];
  if (decision.duzeltmeler.some((e) => e.tur === "satir")) {
    const short = { short: input.context.shorts };
    const rw = await input.budget.generate("ayas-yeniden-yazim", input.director, rewritePrompt(input.episode, decision.duzeltmeler, input.dil, short), { maxTokens: 2_000 }).catch(() => undefined);
    yeniden = rw ? parseRewrites(input.episode, decision.duzeltmeler, rw.result.content, short) : [];
    if (yeniden.length && input.factCheck) {
      const claims = await input.factCheck(applyEdits(input.episode, decision.duzeltmeler, yeniden)).catch(() => undefined);
      const flagged = droppedRewrites(yeniden, claims ?? []);
      for (const d of flagged) log(`  AYAS'ın yeniden yazdığı satır doğrulamadan geçmedi, eskisi kalıyor: ${d.sahne}#${d.satir} "${d.metin.slice(0, 90)}" — ${d.gerekce.slice(0, 160)}`);
      if (flagged.length) yeniden = yeniden.filter((r) => !flagged.some((d) => d.sahne === r.sahne && d.satir === r.satir));
    }
  }
  const duzeltmeler = effectiveEdits(decision.duzeltmeler, yeniden);
  try {
    if (duzeltmeler.length) input.check(applyEdits(input.episode, duzeltmeler, yeniden));
  } catch (e) {
    log(`  AYAS'ın düzeltmeleri geçersiz bölüm yapıyordu, uygulanmayacak: ${(e as Error).message.slice(0, 200)}`);
    return done({ karar: { ozet: decision.ozet, duzeltmeler: [], yeniden: [] }, kararYok: "düzeltmeler bölüm doğrulamasından geçmedi" });
  }
  return done({ karar: { ozet: decision.ozet, duzeltmeler, yeniden, ...(decision.elenen ? { elenen: decision.elenen } : {}) } });
}
