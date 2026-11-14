import type { Episode, EpisodeSource } from "../episode/EpisodeTypes";
import { validateEpisode } from "../episode/EpisodeValidator";
import type { PackCatalogEntry } from "../costumes/CostumePackLoader";
import { normalizeDraft } from "./DraftNormalizer";
import { invitesToSubscribe } from "./ClosingLine";
import { addToldCrowds, crowdProblems } from "./CrowdRules";
import { addToldStrengths } from "./ToldNumbers";
import { directBattleMaps, livenStillMaps, mapProblems, markOnePicture, shareProblems } from "./MapRules";
import { factCheckPrompt, lengthPrompt, repairPrompt, type ScriptBrief, wordBudget, writingPrompt } from "./ScriptPrompts";
import { LONG_FORM_MIN_S, type V3Budget, type V3ModelChoice } from "./V3Budget";

/**
 * Long videos (owner, 21 Oct 2026: at least 15–20 minutes). One answer cannot hold them — 18 minutes is about 2,700
 * spoken words, roughly 58,000 tokens of episode JSON — so the writer first plans the chapters (cast, sources, one
 * paragraph each), then writes every chapter on its own with the story so far, and each chapter is repaired,
 * lengthened and fact-checked on its own before the chapters are joined.
 */
export function isLongForm(brief: Pick<ScriptBrief, "hedefSureSn">): boolean {
  return brief.hedefSureSn > LONG_FORM_MIN_S;
}

/** Chapters of a long video: about two minutes each, six to fifteen (a 30-minute episode). */
export function chapterCount(seconds: number): number {
  return Math.max(6, Math.min(15, Math.round(seconds / 120)));
}

export interface ChapterPlan {
  readonly id: string;
  readonly baslik: string;
  readonly ozet: string;
  readonly sure_sn: number;
  /** How the chapter follows from the one before (every chapter but the first): the story is one, never jumps. */
  readonly baglanti?: string;
}

export interface EpisodeOutline {
  readonly header: Omit<Episode, "sahneler">;
  readonly bolumler: readonly ChapterPlan[];
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function outlinePrompt(brief: ScriptBrief, catalog: readonly PackCatalogEntry[]): string {
  const n = chapterCount(brief.hedefSureSn);
  return `${writingPrompt(brief, catalog)}

LONG EPISODE — STEP 1: THE PLAN. This episode runs ${Math.round(brief.hedefSureSn / 60)} minutes, too long to write at once. Do NOT write any
scenes now. Plan it in ${n} chapters of about two minutes each, in story order, each with its own turn (a rise, a war, a
betrayal, a fall), the whole with a hook at the start and a payoff at the end. The cast is for the WHOLE episode: everyone
who will speak or appear in any chapter (the narrator plus 4–10 visible characters), with costumes and portraits as above.
GO DEEP, as a good long documentary does: the background and causes before the event; the people with their motives and
rivalries; every phase in order with its details (names, places, dates, numbers from the VERIFIED FACTS); the turning
points; the consequences and what it changed. No chapter rushes through what deserves a chapter of its own.
ONE CONTINUOUS STORY: the chapters are written one at a time, so the plan is the spine. Each chapter picks up exactly where
the one before ends — the same people, place or moment, or a bridge that says what happened in between and how long it
took. No jump in time or place without that bridge, and nothing the story needs is left out between two chapters.
Return ONLY this JSON (no "sahneler"):
{"id":"…","baslik":"…","konu":"…","donem":"…","hedef_sure_sn":${brief.hedefSureSn},"ton":"${brief.ton}","kaynaklar":[…],"oyuncu_kadrosu":[…],
 "bolumler":[{"id":"b1-<kebab-case>","baslik":"<chapter title, at most 6 words>","ozet":"<what happens, 3–5 sentences, with names, places, years and the facts it uses>","sure_sn":<seconds>,"baglanti":"<chapters after the first: one sentence — how it follows from the chapter before>"}, …]}
The chapters' "sure_sn" add up to ${brief.hedefSureSn}. In each "ozet" say which part is told on the MAP (between places)
and which in CHARACTER scenes (in one place) — see SCENE KIND BY SCALE.`;
}

/** The plan from the writer's answer, or the problems that make it unusable (sent back for one repair). */
export function readOutline(value: unknown, brief: Pick<ScriptBrief, "hedefSureSn">): { outline?: EpisodeOutline; problems: string[] } {
  const problems: string[] = [];
  if (!value || typeof value !== "object") return { problems: ["the answer is not a JSON object"] };
  const o = value as Record<string, unknown>;
  const raw = Array.isArray(o.bolumler) ? (o.bolumler as Record<string, unknown>[]) : [];
  if (raw.length < 4 || raw.length > 16) problems.push(`"bolumler" needs 4–16 chapters, got ${raw.length}`);
  const cast = Array.isArray(o.oyuncu_kadrosu) ? o.oyuncu_kadrosu : [];
  if (cast.length < 3) problems.push(`"oyuncu_kadrosu" needs the narrator and at least 2 visible characters, got ${cast.length}`);
  const ids = new Set<string>();
  raw.forEach((b, i) => {
    const id = typeof b?.id === "string" ? b.id : "";
    if (!SLUG.test(id) || ids.has(id)) problems.push(`bolumler[${i}].id must be a unique kebab-case id`);
    ids.add(id);
    if (typeof b?.baslik !== "string" || !b.baslik.trim()) problems.push(`bolumler[${i}].baslik is missing`);
    if (typeof b?.ozet !== "string" || b.ozet.trim().length < 20) problems.push(`bolumler[${i}].ozet needs 2–4 sentences`);
    if (typeof b?.sure_sn !== "number" || b.sure_sn < 30) problems.push(`bolumler[${i}].sure_sn must be at least 30`);
    if (i > 0 && (typeof b?.baglanti !== "string" || b.baglanti.trim().length < 10)) problems.push(`bolumler[${i}].baglanti is missing: one sentence on how this chapter follows from the chapter before — ONE CONTINUOUS STORY`);
  });
  if (problems.length) return { problems };
  // The chapter lengths are scaled to add up to the target exactly (a plan a little off is not worth a round).
  const total = raw.reduce((n, b) => n + (b.sure_sn as number), 0);
  const scale = brief.hedefSureSn / total;
  const bolumler = raw.map((b, i) => ({ id: b.id as string, baslik: (b.baslik as string).trim(), ozet: (b.ozet as string).trim(), sure_sn: Math.max(30, Math.round((b.sure_sn as number) * scale)), ...(i > 0 ? { baglanti: (b.baglanti as string).trim() } : {}) }));
  const header: Record<string, unknown> = { ...o };
  delete header.bolumler;
  delete header.sahneler;
  return { outline: { header: { ...(header as unknown as Omit<Episode, "sahneler">), hedef_sure_sn: brief.hedefSureSn }, bolumler }, problems: [] };
}

/** How the chapter before really ended: the plan's summary is what was meant, these are the lines that were written. */
export interface ChapterEnding {
  /** Its last scene's place. */
  readonly mekan: string;
  /** Its lines as "Speaker: text", the last ones last. */
  readonly lines: readonly string[];
}

/** The written ending of a chapter's scenes (at most its last `max` lines), with the cast's names as speakers. */
export function chapterEnding(scenes: readonly Record<string, unknown>[], cast: readonly { readonly id: string; readonly ad: string }[], max = 40): ChapterEnding | undefined {
  const names = new Map(cast.map((c) => [c.id, c.ad]));
  const lines = scenes.flatMap((s) => (Array.isArray(s.satirlar) ? (s.satirlar as { karakter?: unknown; metin?: unknown }[]) : []).map((l) => `${names.get(String(l.karakter)) ?? String(l.karakter)}: ${String(l.metin ?? "")}`));
  if (!lines.length) return undefined;
  return { mekan: String(scenes.at(-1)?.mekan ?? ""), lines: lines.slice(-max) };
}

/**
 * A chapter's brief: its own length, the whole video's for what kind of video it is. Since Shorts run up to 3 minutes
 * (11 Nov 2026) a two-minute chapter by its own length was a Short: every chapter of a long video was written under the
 * Shorts rules (a character's 2-second hook, one moment, no chapter card, a subscribe line at its end) and 92% of its words.
 */
export function chapterBrief(brief: ScriptBrief, ch: Pick<ChapterPlan, "sure_sn">): ScriptBrief {
  return { ...brief, hedefSureSn: ch.sure_sn, butunSureSn: brief.butunSureSn ?? brief.hedefSureSn };
}

/**
 * A chapter's own asks beyond the map rules (owner, 13 Nov 2026: the main character's subscribe invitation ends every
 * video — the whole video, once): a chapter before the last one invites no one to subscribe.
 */
export function chapterProblems(scenes: readonly Record<string, unknown>[], last: boolean): string[] {
  if (last) return [];
  const asks = scenes.flatMap((s) => (Array.isArray(s.satirlar) ? (s.satirlar as { metin?: unknown }[]) : []).flatMap((l, i) => (invitesToSubscribe(String(l.metin ?? "")) ? [`scene "${String(s.id)}" line ${i}`] : [])));
  return asks.length ? [`${asks.join(", ")} invite${asks.length > 1 ? "" : "s"} the viewer to subscribe, but this is not the last chapter: the subscribe invitation comes once, as the very last line of the whole episode — end this chapter on its own turn, leading into the next chapter`] : [];
}

/** The first scene of a chapter opens on its chapter card (the YouTube chapters and the music beds are read from them). */
export function withChapterCard(scenes: readonly Record<string, unknown>[], ch: Pick<ChapterPlan, "baslik">, index: number, dil: ScriptBrief["dil"]): Record<string, unknown>[] {
  const first = scenes[0];
  if (!first || (Array.isArray(first.yazi_karti) && (first.yazi_karti as { stil?: unknown }[]).some((k) => k?.stil === "bolum"))) return [...scenes];
  const card = { metin: ch.baslik.slice(0, 60), alt_metin: `${dil === "tr" ? "Bölüm" : "Chapter"} ${index + 1}`, stil: "bolum" };
  return [{ ...first, yazi_karti: [card, ...(Array.isArray(first.yazi_karti) ? first.yazi_karti : [])] }, ...scenes.slice(1)];
}

export function chapterPrompt(brief: ScriptBrief, catalog: readonly PackCatalogEntry[], outline: EpisodeOutline, index: number, previous?: ChapterEnding): string {
  const ch = outline.bolumler[index]!;
  const words = wordBudget(chapterBrief(brief, ch));
  const before = outline.bolumler.slice(0, index).map((b, i) => `${i + 1}. ${b.baslik}: ${b.ozet}`);
  const next = outline.bolumler[index + 1];
  const cast = outline.header.oyuncu_kadrosu.map((c) => ({ id: c.id, ad: c.ad, rol: c.rol, gorunur: c.gorunur }));
  // The chapter before as it was written (owner, 3 Nov 2026: "hikâye atlamamalı, konu bütün olmalı"): its plan summary
  // alone let a chapter open on a different moment than the last one really ended on.
  const ending = previous
    ? `THE CHAPTER BEFORE, AS WRITTEN — it ended at "${previous.mekan}". Its lines:\n${previous.lines.map((l) => `  ${l}`).join("\n")}\nPick up exactly from that ending${ch.baglanti ? ` (the plan: ${ch.baglanti})` : ""}: the first line connects to its last line — the same moment, or a bridge saying what happened in between and how long it took. Do not tell again what these lines told.\n`
    : ch.baglanti
      ? `HOW THIS CHAPTER FOLLOWS THE ONE BEFORE: ${ch.baglanti}\n`
      : "";
  return `${writingPrompt(chapterBrief(brief, ch), catalog)}

LONG EPISODE "${String(outline.header.baslik ?? brief.konu)}" — CHAPTER ${index + 1} OF ${outline.bolumler.length}: "${ch.baslik}".
THIS CHAPTER: ${ch.ozet}
${before.length ? `THE STORY SO FAR (already told — do not repeat it, build on it):\n${before.join("\n")}\nNo new hook and no "what you'll learn" promise: the episode opened with them; this chapter carries on the story.\n` : "This is the opening chapter: start with the hook.\n"}${ending}${next ? `NEXT CHAPTER (do not tell it yet; you may end on a hint): ${next.baslik} — ${next.ozet}\nNOT THE LAST CHAPTER: rule 7's bridge to the next video and the subscribe invitation belong only to the very end of the whole episode — no subscribe line here; end on this chapter's own turn.\n` : "This is the last chapter: end with the payoff, the bridge to the next video and, as the VERY LAST line, the main character's subscribe invitation (rule 7).\n"}Tell this chapter in full depth: its people, places, dates and numbers from the VERIFIED FACTS, the why as well as the what.
FIXED CAST — use ONLY these ids, never add or change a character (a person not listed is told by the narrator):
${JSON.stringify(cast)}
FIXED SOURCES — cite only these ids: ${outline.header.kaynaklar.map((k: EpisodeSource) => k.id).join(", ") || "(none)"}
Write ONLY this chapter's scenes, about ${words} spoken words, "sure_hedef" adding up to ${ch.sure_sn}. Scene ids start with
"${ch.id}-". The first scene opens with the chapter card: "yazi_karti": [{"metin": "${ch.baslik}", "alt_metin": "${brief.dil === "tr" ? "Bölüm" : "Chapter"} ${index + 1}", "stil": "bolum"}]; that scene's first line is the narrator's (the card stands over the picture for its first three seconds).
Tell what moves between places on the living map ("kamera", "rozetler" with "yol_satir", "savaslar" — MAP NARRATION) and
what happens in one place as character scenes (SCENE KIND BY SCALE), as the chapter's plan says.
SHARES: of this chapter's ${ch.sure_sn} seconds about ${Math.round(ch.sure_sn * 0.8)} on the map (wide or close) and about ${Math.max(10, Math.round(ch.sure_sn * 0.15))} in character
scenes (one short scene: a council, a quarrel or a reaction, the figures loud and emotional); mark "ara_goruntu_satir" on
one map scene for its period picture.
Return ONLY this JSON: {"sahneler": [ … ]}`;
}

/** A break the story editor found, and the line that mends it. */
export interface ContinuityFix {
  readonly sahne: string;
  readonly satir: number;
  readonly sorun: string;
  readonly yeni_metin: string;
}

const MAX_CONTINUITY_FIXES = 12;
const MAX_LINE_CHARS = 240;

/**
 * The story editor's pass over the joined chapters (owner, 3 Nov 2026: the story must not jump and the subject must stay
 * whole): chapters are written one at a time, so only a reader of the whole can see a jump no line explains, a person
 * who comes from nowhere, a step the next chapter assumes, a thing told twice. It names the one line to rewrite for each.
 */
export function continuityPrompt(scenes: readonly Record<string, unknown>[], cast: readonly { readonly id: string; readonly ad: string }[], dil: ScriptBrief["dil"]): string {
  const names = new Map(cast.map((c) => [c.id, c.ad]));
  const lang = dil === "tr" ? "Turkish" : "American English";
  const script = scenes
    .map((s) => `[${String(s.id)} | ${String(s.mekan ?? "")}]\n${(Array.isArray(s.satirlar) ? (s.satirlar as { karakter?: unknown; metin?: unknown }[]) : []).map((l, i) => `  ${i}. ${names.get(String(l.karakter)) ?? String(l.karakter)}: ${String(l.metin ?? "")}`).join("\n")}`)
    .join("\n");
  return `You are the story editor of a long history documentary whose chapters were written one at a time. Read the WHOLE script
and find where the story BREAKS: a jump in time or place that no line explains; a person who appears with no introduction;
an event the story skips that a later scene assumes; an event told twice; a contradiction between chapters; a chapter
that opens as if nothing came before it.
For each break give the ONE line to rewrite so the story flows: "sahne" (scene id), "satir" (the line's number), "sorun"
(in Turkish, one sentence), "yeni_metin": the rewritten line in ${lang}, the same speaker, at most ${MAX_LINE_CHARS} characters,
keeping its facts — it may add a short bridge ("Two years later…", "Meanwhile, in Edirne…").
List only real breaks, at most ${MAX_CONTINUITY_FIXES}; none: {"kopukluklar": []}.
Return ONLY JSON: {"kopukluklar":[{"sahne":"…","satir":0,"sorun":"…","yeni_metin":"…"}]}

SCRIPT ([scene id | place], then its numbered lines):
${script}`;
}

/** The editor's answer, or undefined when it cannot be read. */
export function readContinuity(text: string): ContinuityFix[] | undefined {
  const v = parseJson(text) as { kopukluklar?: unknown } | undefined;
  if (!v || !Array.isArray(v.kopukluklar)) return undefined;
  return v.kopukluklar
    .flatMap((x): ContinuityFix[] => {
      const o = (typeof x === "object" && x !== null ? x : {}) as Record<string, unknown>;
      return typeof o.sahne === "string" && typeof o.satir === "number" && typeof o.yeni_metin === "string" && o.yeni_metin.trim() ? [{ sahne: o.sahne, satir: o.satir, sorun: typeof o.sorun === "string" ? o.sorun : "", yeni_metin: o.yeni_metin.trim() }] : [];
    })
    .slice(0, MAX_CONTINUITY_FIXES);
}

/** The mends applied to the joined scenes: a fix for a line that does not exist, or too long, is skipped. */
export function applyContinuity(scenes: readonly Record<string, unknown>[], fixes: readonly ContinuityFix[]): { scenes: Record<string, unknown>[]; applied: ContinuityFix[] } {
  const copy = JSON.parse(JSON.stringify(scenes)) as Record<string, unknown>[];
  const applied: ContinuityFix[] = [];
  for (const fix of fixes) {
    const line = (copy.find((s) => s.id === fix.sahne)?.satirlar as Record<string, unknown>[] | undefined)?.[fix.satir];
    if (!line || fix.yeni_metin.length > MAX_LINE_CHARS) continue;
    line.metin = fix.yeni_metin;
    applied.push(fix);
  }
  return { scenes: copy, applied };
}

/** A chapter as an episode of its own (the plan's header and cast), so the usual checks and prompts apply to it. */
export function chapterEpisode(outline: EpisodeOutline, index: number, sahneler: unknown): Record<string, unknown> {
  return { ...outline.header, hedef_sure_sn: outline.bolumler[index]!.sure_sn, sahneler };
}

/** Scene ids carry their chapter's id, so scenes of different chapters never collide. */
export function prefixScenes(scenes: readonly Record<string, unknown>[], chapterId: string): Record<string, unknown>[] {
  return scenes.map((s) => (typeof s.id === "string" && s.id.startsWith(`${chapterId}-`) ? s : { ...s, id: `${chapterId}-${typeof s.id === "string" && s.id ? s.id : "sahne"}` }));
}

export interface LongFormCheck {
  /** The map rules (MapRules), asked for in the repair rounds but never fatal. */
  readonly quality: string[];
  readonly value?: unknown;
  readonly problems: string[];
}

export interface LongFormDeps {
  readonly brief: ScriptBrief;
  readonly catalog: readonly PackCatalogEntry[];
  readonly writer: V3ModelChoice;
  readonly checker: V3ModelChoice;
  readonly budget: V3Budget;
  readonly maxRepairs?: number;
  readonly log?: (s: string) => void;
  /** Whether a chapter's fact-check answer can be read (ScriptEngine's reader); an unreadable one is asked once more. */
  readonly readableCheck?: (text: string) => boolean;
  /**
   * The single-video script step's own asks of a chapter (ScriptEngine.copiedFromSources: a line copying a source's
   * sentence), asked in the chapter's repair rounds as its map rules are.
   */
  readonly chapterAsks?: (chapter: unknown) => string[];
  /** Where a chapter short of its words needs them (ScriptEngine.sceneShortfalls), for its lengthening round. */
  readonly shortfalls?: (chapter: Episode, targetWords: number) => string[];
}

/**
 * A chapter is lengthened below this share of its words, as a single video is (ScriptEngine's LENGTH_BAND, the QC's
 * ±10%): 0.85 of a Shorts-filled 92% budget let a whole long episode run ~22% short of its minutes.
 */
export const CHAPTER_LENGTH_MIN = 0.9;

/**
 * The plan's sources limited to the source bank's (a single video's script is sent back for one outside it,
 * ScriptEngine.bankProblems): every chapter cites only the plan's, so one made up in the plan would reach the
 * description unverified. None of the bank's listed: the whole bank.
 */
export function bankSourcesOnly(header: Omit<Episode, "sahneler">, bank: ScriptBrief["kaynakBankasi"]): { header: Omit<Episode, "sahneler">; dropped: string[] } {
  if (!bank?.kaynaklar.length) return { header, dropped: [] };
  const allowed = new Set(bank.kaynaklar.map((k) => k.id));
  const listed = Array.isArray(header.kaynaklar) ? header.kaynaklar : [];
  const kept = listed.filter((k) => allowed.has(k.id));
  const dropped = listed.filter((k) => !allowed.has(k.id)).map((k) => String(k.id));
  if (!dropped.length && kept.length) return { header, dropped };
  return { header: { ...header, kaynaklar: kept.length ? kept : [...bank.kaynaklar] }, dropped };
}

/** A chapter's fact check; a second look at an unreadable one gets room for a long chapter's claims (a cut answer). */
const CHAPTER_CHECK_MAX_TOKENS = 3_000;
const CHAPTER_CHECK_RETRY_MAX_TOKENS = 8_000;

/** The pieces writeScript needs back from a long episode (its fact check and outcome are assembled there). */
export interface LongFormDraft {
  readonly episode: Episode;
  readonly repairs: number;
  readonly lengthRounds: number;
  readonly writerUsed: V3ModelChoice;
  /** Every chapter's fact-check answer, to be applied to the joined episode. */
  readonly factChecks: readonly string[];
  /** The story editor's mended breaks ("<scene>#<line>: <what broke>"). */
  readonly continuity: readonly string[];
}

function parseJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function wordsOf(scenes: readonly Record<string, unknown>[]): number {
  return scenes.reduce((n, s) => n + (Array.isArray(s.satirlar) ? (s.satirlar as { metin?: unknown }[]).reduce((m, l) => m + String(l.metin ?? "").split(/\s+/).filter(Boolean).length, 0) : 0), 0);
}

/** Writes a long episode: the plan, then chapter by chapter (each checked, repaired and lengthened on its own). */
export async function writeLongScript(d: LongFormDeps): Promise<LongFormDraft> {
  const log = d.log ?? (() => {});
  const maxRepairs = d.maxRepairs ?? 2;
  let repairs = 0;
  let lengthRounds = 0;
  // 1) The plan.
  const planOpts = { maxTokens: 8_000 };
  const first = await d.budget.generate("taslak", d.writer, outlinePrompt(d.brief, d.catalog), planOpts);
  if (first.result.refused) throw new Error("V3_SCRIPT_REFUSED: model planı yazmayı reddetti");
  const writerUsed = first.used;
  let raw = first.result.content;
  let plan = readOutline(parseJson(raw), d.brief);
  for (let r = 0; plan.problems.length && r < maxRepairs; r++) {
    repairs++;
    raw = (await d.budget.generate(`taslak-onarim-${r + 1}`, writerUsed, repairPrompt(raw, plan.problems), planOpts)).result.content;
    plan = readOutline(parseJson(raw), d.brief);
  }
  if (!plan.outline) throw new Error(`V3_SCRIPT_INVALID: bölüm planı okunamadı: ${plan.problems.slice(0, 4).join("; ")}`);
  const sourced = bankSourcesOnly(plan.outline.header, d.brief.kaynakBankasi);
  if (sourced.dropped.length) log(`  senaryo planı: kaynak bankasında olmayan kaynaklar çıkarıldı — ${sourced.dropped.join(", ")}`);
  const outline: EpisodeOutline = { ...plan.outline, header: sourced.header };
  log(`senaryo planı: ${outline.bolumler.length} bölüm — ${outline.bolumler.map((b) => `${b.baslik} (${b.sure_sn} sn)`).join(" · ")}`);
  // 2) Chapter by chapter.
  const scenes: Record<string, unknown>[] = [];
  const factChecks: string[] = [];
  // The chapter before as it was written, for the next one to pick up from.
  let previous: ChapterEnding | undefined;
  for (let i = 0; i < outline.bolumler.length; i++) {
    const ch = outline.bolumler[i]!;
    const chBrief = chapterBrief(d.brief, ch);
    const lastChapter = i === outline.bolumler.length - 1;
    const opts = { maxTokens: Math.min(16_000, Math.max(6_000, 5_000 + wordBudget(chBrief) * 22)) };
    const check = (text: string): LongFormCheck => {
      const answer = parseJson(text) as { sahneler?: unknown } | undefined;
      const list = Array.isArray(answer?.sahneler) ? prefixScenes(answer!.sahneler as Record<string, unknown>[], ch.id) : undefined;
      if (!list?.length) return { problems: ['the answer needs {"sahneler": [ … ]} with this chapter\'s scenes'], quality: [] };
      const value = normalizeDraft(chapterEpisode(outline, i, list), d.catalog).value;
      const v = validateEpisode(value);
      const problems = v.errors.slice(0, 30).map((e) => `${e.path} ${e.code}: ${e.message}`);
      // The map rules (ScriptEngine.mapProblems) and the owner's shares are asked for in the same rounds, never worth
      // losing a valid chapter.
      const scenesOf = (value as { sahneler?: Record<string, unknown>[] }).sahneler ?? [];
      return { value, problems, quality: problems.length ? [] : [...mapProblems(value), ...shareProblems(value as Episode), ...crowdProblems(value), ...chapterProblems(scenesOf, lastChapter), ...(d.chapterAsks?.(value) ?? [])] };
    };
    let text = (await d.budget.generate(`bolum-${i + 1}`, writerUsed, chapterPrompt(d.brief, d.catalog, outline, i, previous), opts)).result.content;
    let state = check(text);
    for (let r = 0; (state.problems.length || state.quality.length) && r < maxRepairs; r++) {
      repairs++;
      const next = (await d.budget.generate(`bolum-${i + 1}-onarim-${r + 1}`, writerUsed, repairPrompt(state.value !== undefined ? JSON.stringify(state.value) : text, [...state.problems, ...state.quality]), opts)).result.content;
      const checked = check(next);
      if (!state.problems.length && checked.problems.length) break;
      text = next;
      state = checked;
    }
    if (state.problems.length) throw new Error(`V3_SCRIPT_INVALID: bölüm ${i + 1} (${ch.baslik}): ${state.problems.slice(0, 4).join("; ")}`);
    if (state.quality.length) d.log?.(`  bölüm ${i + 1}: harita isteği karşılanamadı — ${state.quality.join(" | ").slice(0, 240)}`);
    let chapter = state.value as Record<string, unknown>;
    // One lengthening round for a chapter short of its words (models stop short of a word count), with where the words
    // are missing scene by scene, as a single video's rounds have them (sceneShortfalls).
    const want = wordBudget(chBrief);
    const has = wordsOf(chapter.sahneler as Record<string, unknown>[]);
    if (has < want * CHAPTER_LENGTH_MIN) {
      lengthRounds++;
      const longer = check((await d.budget.generate(`bolum-${i + 1}-uzunluk`, writerUsed, lengthPrompt(JSON.stringify(chapter), has, want, d.shortfalls?.(chapter as unknown as Episode, want) ?? []), opts)).result.content);
      // Kept only if it keeps what the map rules won (they are not asked again after this round).
      if (!longer.problems.length && longer.quality.length <= state.quality.length && wordsOf((longer.value as Record<string, unknown>).sahneler as Record<string, unknown>[]) > has) chapter = longer.value as Record<string, unknown>;
    }
    // The chapter's period picture when no round marked one (markOnePicture), and its chapter card.
    const pictured = markOnePicture(chapter as unknown as Episode);
    for (const fix of pictured.fixes) log(`  bölüm ${i + 1}: ${fix}`);
    const chapterScenes = withChapterCard(prefixScenes(pictured.episode.sahneler as unknown as Record<string, unknown>[], ch.id), ch, i, d.brief.dil);
    for (const left of chapterProblems(chapterScenes, lastChapter)) log(`  bölüm ${i + 1}: ${left.slice(0, 240)}`);
    scenes.push(...chapterScenes);
    previous = chapterEnding(chapterScenes, outline.header.oyuncu_kadrosu);
    log(`  bölüm ${i + 1}/${outline.bolumler.length} "${ch.baslik}": ${chapterScenes.length} sahne, ${wordsOf(chapterScenes)}/${want} kelime`);
    const checkPrompt = factCheckPrompt(JSON.stringify(chapterEpisode(outline, i, chapterScenes)), d.brief.dil, d.brief.kaynakBankasi, d.brief.konu, d.brief.denetciDersleri);
    let checkText = (await d.budget.generate(`dogrulama-${i + 1}`, d.checker, checkPrompt, { maxTokens: CHAPTER_CHECK_MAX_TOKENS })).result.content;
    if (d.readableCheck && !d.readableCheck(checkText)) {
      log(`  bölüm ${i + 1}: tarih doğrulamasının yanıtı okunamadı — bir kez daha, daha geniş yanıt payıyla soruluyor`);
      const again = await d.budget.generate(`dogrulama-${i + 1}-tekrar`, d.checker, checkPrompt, { maxTokens: CHAPTER_CHECK_RETRY_MAX_TOKENS }).catch((e: Error) => (log(`  bölüm ${i + 1}: ikinci doğrulama yapılamadı: ${e.message.slice(0, 120)}`), undefined));
      if (again) checkText = again.result.content;
    }
    factChecks.push(checkText);
  }
  // 3) The story editor reads the whole and mends each break with one line; mends that would break the episode are dropped.
  let joined = scenes;
  const continuity: string[] = [];
  const editor = await d.budget.generate("akis", d.checker, continuityPrompt(scenes, outline.header.oyuncu_kadrosu, d.brief.dil), { maxTokens: 2_500 }).catch((e: Error) => (log(`  akış denetimi yapılamadı: ${e.message.slice(0, 120)}`), undefined));
  const breaks = editor ? readContinuity(editor.result.content) : undefined;
  if (breaks?.length) {
    const mended = applyContinuity(scenes, breaks);
    if (validateEpisode(normalizeDraft({ ...outline.header, sahneler: mended.scenes }, d.catalog).value).ok) {
      joined = mended.scenes;
      for (const f of mended.applied) continuity.push(`${f.sahne}#${f.satir}: ${f.sorun}`);
    } else log("  akış: düzeltmeler bölümü bozuyordu; yazıldığı gibi kaldı");
  }
  if (editor) log(`  akış denetimi: ${breaks === undefined ? "yanıt okunamadı" : continuity.length ? `${continuity.length} kopukluk düzeltildi — ${continuity.join(" · ").slice(0, 400)}` : "kopukluk yok"}`);
  // A map left still after its chapter's repair rounds gets the camera's move as a last resort.
  const livened = livenStillMaps(normalizeDraft({ ...outline.header, sahneler: joined }, d.catalog).value as Episode);
  for (const fix of livened.fixes) log(`  ${fix}`);
  // A group the narrator tells that no chapter round put on the stage gets its crowd.
  const crowded = addToldCrowds(livened.episode);
  for (const fix of crowded.fixes) log(`  senaryo: ${fix}`);
  // Armies counted off the map get their card (Cannae, 9 Nov 2026).
  const counted = addToldStrengths(crowded.episode, d.brief.dil);
  for (const fix of counted.fixes) log(`  senaryo: ${fix}`);
  const directed = directBattleMaps(counted.episode);
  for (const fix of directed.fixes) log(`  ${fix}`);
  // The whole video's words against its minutes (the QC's ±10% on the finished cut, read here before hours of voice and
  // render): a single video's rounds work to this band; a long one only says it, its chapters were lengthened one by one.
  const total = wordsOf(directed.episode.sahneler as unknown as Record<string, unknown>[]);
  const budget = wordBudget(d.brief);
  log(`  uzunluk: ${total}/${budget} kelime (%${Math.round((total / Math.max(1, budget)) * 100)})${total < budget * CHAPTER_LENGTH_MIN ? " — hedef sürenin altında kalacak" : total > budget * 1.1 ? " — hedef sürenin üstüne taşacak" : ""}`);
  return { episode: directed.episode, repairs, lengthRounds, writerUsed, factChecks, continuity };
}
