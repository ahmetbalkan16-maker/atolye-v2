import type { PackCatalogEntry } from "../costumes/CostumePackLoader";
import type { Episode } from "../episode/EpisodeTypes";
import { countWords, type EpisodeValidation, validateEpisode } from "../episode/EpisodeValidator";
import { normalizeDraft } from "./DraftNormalizer";
import { factCheckPrompt, lengthPrompt, repairPrompt, type ScriptBrief, type SourceBank, wordBudget, writingPrompt } from "./ScriptPrompts";
import type { V3Budget, V3ModelChoice } from "./V3Budget";

/**
 * V3 script writer: write → extract JSON → validate (up to two repair rounds) → a separate fact-check pass whose
 * corrections are applied to the lines. Every model call goes through the episode budget.
 */
export class ScriptError extends Error {
  constructor(
    readonly code: "V3_SCRIPT_NO_JSON" | "V3_SCRIPT_JSON_CUT" | "V3_SCRIPT_JSON_SYNTAX" | "V3_SCRIPT_REFUSED" | "V3_SCRIPT_INVALID",
    message: string,
    /** The last draft that failed, kept for diagnosis. */
    readonly draft?: string,
  ) {
    super(`${code}: ${message}`);
  }
}

export type FactVerdict = "dogru" | "tartismali" | "yanlis" | "kaynaksiz";

export interface FactClaim {
  readonly sahne: string;
  readonly satir: number;
  readonly karar: FactVerdict;
  readonly gerekce?: string;
  readonly yeni_metin?: string;
  readonly kaynak_onerisi?: string;
  /** What happened to the claim: the line was rewritten, or why it was not. */
  readonly sonuc?: "duzeltildi" | "rivayet_eklendi" | "rapor" | "bulunamadi" | "gecersiz_metin";
}

export interface FactCheckReport {
  /** `okunamadi`: the checker's answer was not usable — QC must treat the episode as unchecked. */
  readonly durum: "tamam" | "okunamadi";
  readonly iddialar: readonly FactClaim[];
  readonly genel_not?: string;
  readonly uygulanan: number;
}

export interface ScriptOutcome {
  readonly episode: Episode;
  readonly validation: EpisodeValidation;
  readonly factCheck: FactCheckReport;
  readonly repairs: number;
  /** Rounds spent fixing the length (0 or 1). */
  readonly lengthRounds: number;
  readonly spokenWords: number;
  readonly targetWords: number;
  /** The writer actually used (the free fallback when the budget refused the paid one). */
  readonly writerUsed: V3ModelChoice;
}

export function spokenWords(episode: Episode): number {
  return episode.sahneler.reduce((sum, s) => sum + s.satirlar.reduce((n, l) => n + countWords(l.metin), 0), 0);
}

/** Sources outside the bank, as repair problems. Lines can only cite listed sources, so the list is what to check. */
export function bankProblems(episode: unknown, bank: SourceBank | undefined): string[] {
  if (!bank || typeof episode !== "object" || episode === null) return [];
  const allowed = new Set(bank.kaynaklar.map((k) => k.id));
  const listed = Array.isArray((episode as { kaynaklar?: unknown }).kaynaklar) ? ((episode as { kaynaklar: { id?: unknown }[] }).kaynaklar) : [];
  return listed
    .filter((k) => typeof k.id !== "string" || !allowed.has(k.id))
    .map((k) => `$.kaynaklar: "${String(k.id)}" is not in the source bank; use only: ${[...allowed].join(", ")}`);
}

/** Bank sources replace the written ones, so the citation text is exactly the verified one. */
function withBankSources(episode: Episode, bank: SourceBank | undefined): Episode {
  if (!bank) return episode;
  const byId = new Map(bank.kaynaklar.map((k) => [k.id, k]));
  return { ...episode, kaynaklar: episode.kaynaklar.map((k) => byId.get(k.id) ?? k) };
}

/**
 * Outside this band of the spoken-word budget the episode would not fill, or would overrun, its target: the same
 * ±10% the QC checks on the finished video.
 */
const LENGTH_BAND = [0.9, 1.1] as const;
/** Share of scenes that must carry an exchange (two or more lines by visible characters). */
export const MIN_DIALOGUE_SCENES = 0.3;
/** Visible characters an episode needs (the narrator is not drawn). */
export const MIN_VISIBLE_CAST = 3;
/** Revision attempts; one that does not get closer is dropped and the best version is tried again. */
const MAX_REVISIONS = 3;

const visibleCast = (episode: Episode) => episode.oyuncu_kadrosu.filter((c) => c.gorunur).length;

/** Scenes with at least two lines spoken by visible characters, as a share of all scenes. */
export function dialogueSceneRatio(episode: Episode): number {
  const visible = new Set(episode.oyuncu_kadrosu.filter((c) => c.gorunur).map((c) => c.id));
  if (!episode.sahneler.length) return 0;
  return episode.sahneler.filter((s) => s.satirlar.filter((l) => visible.has(l.karakter)).length >= 2).length / episode.sahneler.length;
}

/** How far a script is from its targets: 0 is on target; length and dialogue both count. */
function revisionGap(episode: Episode, target: number): number {
  const words = spokenWords(episode);
  const lengthGap = words < target * LENGTH_BAND[0] ? target * LENGTH_BAND[0] - words : words > target * LENGTH_BAND[1] ? words - target * LENGTH_BAND[1] : 0;
  return lengthGap / Math.max(1, target) + Math.max(0, MIN_DIALOGUE_SCENES - dialogueSceneRatio(episode)) + 0.2 * Math.max(0, MIN_VISIBLE_CAST - visibleCast(episode));
}

/** First top-level JSON object in a model answer; code fences and chatter around it are ignored. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new ScriptError("V3_SCRIPT_NO_JSON", "yanıtta JSON nesnesi yok");
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch (e) {
        throw new ScriptError("V3_SCRIPT_JSON_SYNTAX", (e as Error).message);
      }
    }
  }
  throw new ScriptError("V3_SCRIPT_JSON_CUT", "JSON yarıda kesilmiş");
}

/** Output budget for the writer: the JSON around each spoken word costs several tokens. */
export function writerMaxTokens(brief: ScriptBrief): number {
  // Maps (outlines, routes), crowds and costumes add a large fixed share: the Rubicon script was cut at 4,884 tokens.
  return Math.min(16_000, Math.max(5_000, 4_000 + wordBudget(brief) * 20));
}

const FACT_CHECK_MAX_TOKENS = 3_000;
const MAX_LINE_CHARS = 240;

type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

function parse(text: string): Parsed {
  try {
    return { ok: true, value: extractJson(text) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const VERDICTS: readonly FactVerdict[] = ["dogru", "tartismali", "yanlis", "kaynaksiz"];

function readFactCheck(text: string): { iddialar: FactClaim[]; genel_not?: string } | undefined {
  const parsed = parse(text);
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) return undefined;
  const v = parsed.value as { iddialar?: unknown; genel_not?: unknown };
  if (!Array.isArray(v.iddialar)) return undefined;
  const iddialar = v.iddialar.flatMap((c): FactClaim[] => {
    if (typeof c !== "object" || c === null) return [];
    const o = c as Record<string, unknown>;
    if (typeof o.sahne !== "string" || typeof o.satir !== "number" || !VERDICTS.includes(o.karar as FactVerdict)) return [];
    return [{
      sahne: o.sahne,
      satir: o.satir,
      karar: o.karar as FactVerdict,
      ...(typeof o.gerekce === "string" ? { gerekce: o.gerekce } : {}),
      ...(typeof o.yeni_metin === "string" ? { yeni_metin: o.yeni_metin.trim() } : {}),
      ...(typeof o.kaynak_onerisi === "string" && o.kaynak_onerisi.trim() ? { kaynak_onerisi: o.kaynak_onerisi.trim() } : {}),
    }];
  });
  return { iddialar, ...(typeof v.genel_not === "string" && v.genel_not.trim() ? { genel_not: v.genel_not.trim() } : {}) };
}

/**
 * Applies the editor's verdicts: a wrong line is replaced by its correction, a disputed one gets its hedged text
 * and `rivayet`; an unsupported one is only reported (a suggested source cannot be verified here).
 */
export function applyFactCheck(episode: Episode, claims: readonly FactClaim[]): { episode: Episode; claims: FactClaim[]; applied: number } {
  const copy = JSON.parse(JSON.stringify(episode)) as { sahneler: { id: string; satirlar: Record<string, unknown>[] }[] };
  let applied = 0;
  const out = claims.map((claim): FactClaim => {
    if (claim.karar === "dogru") return claim;
    const line = copy.sahneler.find((s) => s.id === claim.sahne)?.satirlar[claim.satir];
    if (!line) return { ...claim, sonuc: "bulunamadi" };
    if (claim.karar === "kaynaksiz") return { ...claim, sonuc: "rapor" };
    const text = claim.yeni_metin ?? "";
    if (!text || text.length > MAX_LINE_CHARS) return { ...claim, sonuc: "gecersiz_metin" };
    line.metin = text;
    if (claim.karar === "tartismali") line.rivayet = true;
    applied++;
    return { ...claim, sonuc: claim.karar === "yanlis" ? "duzeltildi" : "rivayet_eklendi" };
  });
  return { episode: copy as unknown as Episode, claims: out, applied };
}

export interface ScriptEngineInput {
  readonly brief: ScriptBrief;
  readonly catalog: readonly PackCatalogEntry[];
  readonly writer: V3ModelChoice;
  readonly checker: V3ModelChoice;
  readonly budget: V3Budget;
  /** Episode JSON Schema; constrains decoding on providers that support it (Ollama). */
  readonly jsonSchema?: Record<string, unknown>;
  readonly maxRepairs?: number;
}

export async function writeScript(input: ScriptEngineInput): Promise<ScriptOutcome> {
  const { brief, budget } = input;
  const opts = { maxTokens: writerMaxTokens(brief), ...(input.jsonSchema ? { jsonSchema: input.jsonSchema } : {}) };
  const first = await budget.generate("senaryo", input.writer, writingPrompt(brief, input.catalog), opts);
  if (first.result.refused) throw new ScriptError("V3_SCRIPT_REFUSED", "model senaryoyu yazmayı reddetti");
  const writerUsed = first.used;
  const check = (text: string): { value?: unknown; validation?: EpisodeValidation; problems: string[] } => {
    const parsed = parse(text);
    if (!parsed.ok) return { problems: [parsed.error] };
    // Mechanical slips (visible narrator, English garment names, made-up items) are fixed here, not by a model round.
    const value = normalizeDraft(parsed.value, input.catalog).value;
    const validation = validateEpisode(value);
    const problems = [...validation.errors.slice(0, 40).map((e) => `${e.path} ${e.code}: ${e.message}`), ...bankProblems(value, brief.kaynakBankasi)];
    return { value, validation, problems };
  };
  let raw = first.result.content;
  let state = check(raw);
  let repairs = 0;
  while (state.problems.length && repairs < (input.maxRepairs ?? 3)) {
    repairs++;
    const next = await budget.generate(`onarim-${repairs}`, writerUsed, repairPrompt(state.value !== undefined ? JSON.stringify(state.value) : raw, state.problems), opts);
    raw = next.result.content;
    state = check(raw);
  }
  if (state.problems.length) throw new ScriptError("V3_SCRIPT_INVALID", `${repairs} onarımdan sonra: ${state.problems.slice(0, 5).join("; ")}`, raw);

  let written = state.value as Episode;
  let validation = state.validation!;
  const targetWords = wordBudget(brief);
  let lengthRounds = 0;
  // Revision attempts for length, dialogue and cast; one is kept only if it is valid and closer to the targets,
  // otherwise the best version so far is tried again.
  while (lengthRounds < MAX_REVISIONS && revisionGap(written, targetWords) > 0) {
    lengthRounds++;
    const extra: string[] = [];
    const ratio = dialogueSceneRatio(written);
    if (ratio < MIN_DIALOGUE_SCENES) extra.push(`only ${Math.round(ratio * 100)}% of scenes have two or more lines by visible characters; at least ${MIN_DIALOGUE_SCENES * 100}% must`);
    const cast = visibleCast(written);
    if (cast < MIN_VISIBLE_CAST) extra.push(`only ${cast} visible characters; add ${MIN_VISIBLE_CAST - cast} more fitting the period (costume from the catalog, own colour, own speaking style) and give them lines`);
    const next = await budget.generate(`uzunluk-${lengthRounds}`, writerUsed, lengthPrompt(JSON.stringify(written), spokenWords(written), targetWords, extra), opts);
    const revised = check(next.result.content);
    if (revised.problems.length || revisionGap(revised.value as Episode, targetWords) >= revisionGap(written, targetWords)) continue;
    written = revised.value as Episode;
    validation = revised.validation!;
  }
  written = withBankSources(written, brief.kaynakBankasi);
  const lengthFields = { lengthRounds, spokenWords: spokenWords(written), targetWords };
  const editor = await budget.generate("dogrulama", input.checker, factCheckPrompt(JSON.stringify(written), brief.dil, brief.kaynakBankasi), { maxTokens: FACT_CHECK_MAX_TOKENS });
  const report = readFactCheck(editor.result.content);
  if (!report) {
    return { episode: written, validation, factCheck: { durum: "okunamadi", iddialar: [], uygulanan: 0 }, repairs, ...lengthFields, writerUsed };
  }
  const fixed = applyFactCheck(written, report.iddialar);
  const fixedValidation = validateEpisode(fixed.episode);
  // A correction must never break a valid episode; if one would, the written text stays and the claims are reported.
  const keep = fixedValidation.ok;
  return {
    episode: keep ? fixed.episode : written,
    validation: keep ? fixedValidation : validation,
    factCheck: {
      durum: "tamam",
      iddialar: keep ? fixed.claims : report.iddialar.map((c) => ({ ...c, sonuc: "rapor" as const })),
      ...(report.genel_not ? { genel_not: report.genel_not } : {}),
      uygulanan: keep ? fixed.applied : 0,
    },
    repairs,
    ...lengthFields,
    writerUsed,
  };
}
