import type { Episode, EpisodeSource } from "../episode/EpisodeTypes";
import { validateEpisode } from "../episode/EpisodeValidator";
import type { PackCatalogEntry } from "../costumes/CostumePackLoader";
import { normalizeDraft } from "./DraftNormalizer";
import { livenStillMaps, mapProblems, shareProblems } from "./MapRules";
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
Return ONLY this JSON (no "sahneler"):
{"id":"…","baslik":"…","konu":"…","donem":"…","hedef_sure_sn":${brief.hedefSureSn},"ton":"${brief.ton}","kaynaklar":[…],"oyuncu_kadrosu":[…],
 "bolumler":[{"id":"b1-<kebab-case>","baslik":"<chapter title, at most 6 words>","ozet":"<what happens, 2–4 sentences, with names, places and years>","sure_sn":<seconds>}, …]}
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
  });
  if (problems.length) return { problems };
  // The chapter lengths are scaled to add up to the target exactly (a plan a little off is not worth a round).
  const total = raw.reduce((n, b) => n + (b.sure_sn as number), 0);
  const scale = brief.hedefSureSn / total;
  const bolumler = raw.map((b) => ({ id: b.id as string, baslik: (b.baslik as string).trim(), ozet: (b.ozet as string).trim(), sure_sn: Math.max(30, Math.round((b.sure_sn as number) * scale)) }));
  const header: Record<string, unknown> = { ...o };
  delete header.bolumler;
  delete header.sahneler;
  return { outline: { header: { ...(header as unknown as Omit<Episode, "sahneler">), hedef_sure_sn: brief.hedefSureSn }, bolumler }, problems: [] };
}

export function chapterPrompt(brief: ScriptBrief, catalog: readonly PackCatalogEntry[], outline: EpisodeOutline, index: number): string {
  const ch = outline.bolumler[index]!;
  const words = wordBudget({ ...brief, hedefSureSn: ch.sure_sn });
  const before = outline.bolumler.slice(0, index).map((b, i) => `${i + 1}. ${b.baslik}: ${b.ozet}`);
  const next = outline.bolumler[index + 1];
  const cast = outline.header.oyuncu_kadrosu.map((c) => ({ id: c.id, ad: c.ad, rol: c.rol, gorunur: c.gorunur }));
  return `${writingPrompt({ ...brief, hedefSureSn: ch.sure_sn }, catalog)}

LONG EPISODE "${String(outline.header.baslik ?? brief.konu)}" — CHAPTER ${index + 1} OF ${outline.bolumler.length}: "${ch.baslik}".
THIS CHAPTER: ${ch.ozet}
${before.length ? `THE STORY SO FAR (already told — do not repeat it, build on it):\n${before.join("\n")}\n` : "This is the opening chapter: start with the hook.\n"}${next ? `NEXT CHAPTER (do not tell it yet; you may end on a hint): ${next.baslik} — ${next.ozet}\n` : "This is the last chapter: end with the payoff and the closing line.\n"}
FIXED CAST — use ONLY these ids, never add or change a character (a person not listed is told by the narrator):
${JSON.stringify(cast)}
FIXED SOURCES — cite only these ids: ${outline.header.kaynaklar.map((k: EpisodeSource) => k.id).join(", ") || "(none)"}
Write ONLY this chapter's scenes, about ${words} spoken words, "sure_hedef" adding up to ${ch.sure_sn}. Scene ids start with
"${ch.id}-". The first scene opens with the chapter card: "yazi_karti": [{"metin": "${ch.baslik}", "alt_metin": "${brief.dil === "tr" ? "Bölüm" : "Chapter"} ${index + 1}", "stil": "bolum"}].
Tell what moves between places on the living map ("kamera", "rozetler" with "yol_satir", "savaslar" — MAP NARRATION) and
what happens in one place as character scenes (SCENE KIND BY SCALE), as the chapter's plan says.
SHARES: of this chapter's ${ch.sure_sn} seconds about ${Math.round(ch.sure_sn * 0.8)} on the map (wide or close) and about ${Math.max(10, Math.round(ch.sure_sn * 0.15))} in character
scenes (one short scene: a council, a quarrel or a reaction, the figures loud and emotional); mark "ara_goruntu_satir" on
one map scene for its period picture.
Return ONLY this JSON: {"sahneler": [ … ]}`;
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
}

/** The pieces writeScript needs back from a long episode (its fact check and outcome are assembled there). */
export interface LongFormDraft {
  readonly episode: Episode;
  readonly repairs: number;
  readonly lengthRounds: number;
  readonly writerUsed: V3ModelChoice;
  /** Every chapter's fact-check answer, to be applied to the joined episode. */
  readonly factChecks: readonly string[];
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
  const outline = plan.outline;
  log(`senaryo planı: ${outline.bolumler.length} bölüm — ${outline.bolumler.map((b) => `${b.baslik} (${b.sure_sn} sn)`).join(" · ")}`);
  // 2) Chapter by chapter.
  const scenes: Record<string, unknown>[] = [];
  const factChecks: string[] = [];
  for (let i = 0; i < outline.bolumler.length; i++) {
    const ch = outline.bolumler[i]!;
    const chBrief = { ...d.brief, hedefSureSn: ch.sure_sn };
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
      return { value, problems, quality: problems.length ? [] : [...mapProblems(value), ...shareProblems(value as Episode)] };
    };
    let text = (await d.budget.generate(`bolum-${i + 1}`, writerUsed, chapterPrompt(d.brief, d.catalog, outline, i), opts)).result.content;
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
    // One lengthening round for a chapter well short of its words (models stop short of a word count).
    const want = wordBudget(chBrief);
    const has = wordsOf(chapter.sahneler as Record<string, unknown>[]);
    if (has < want * 0.85) {
      lengthRounds++;
      const longer = check((await d.budget.generate(`bolum-${i + 1}-uzunluk`, writerUsed, lengthPrompt(JSON.stringify(chapter), has, want), opts)).result.content);
      // Kept only if it keeps what the map rules won (they are not asked again after this round).
      if (!longer.problems.length && longer.quality.length <= state.quality.length && wordsOf((longer.value as Record<string, unknown>).sahneler as Record<string, unknown>[]) > has) chapter = longer.value as Record<string, unknown>;
    }
    const chapterScenes = prefixScenes(chapter.sahneler as Record<string, unknown>[], ch.id);
    scenes.push(...chapterScenes);
    log(`  bölüm ${i + 1}/${outline.bolumler.length} "${ch.baslik}": ${chapterScenes.length} sahne, ${wordsOf(chapterScenes)}/${want} kelime`);
    factChecks.push((await d.budget.generate(`dogrulama-${i + 1}`, d.checker, factCheckPrompt(JSON.stringify(chapterEpisode(outline, i, chapterScenes)), d.brief.dil, d.brief.kaynakBankasi), { maxTokens: 3_000 })).result.content);
  }
  // A map left still after its chapter's repair rounds gets the camera's move as a last resort.
  const livened = livenStillMaps(normalizeDraft({ ...outline.header, sahneler: scenes }, d.catalog).value as Episode);
  for (const fix of livened.fixes) log(`  ${fix}`);
  return { episode: livened.episode, repairs, lengthRounds, writerUsed, factChecks };
}
