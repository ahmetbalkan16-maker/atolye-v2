import type { PackCatalogEntry } from "../costumes/CostumePackLoader";
import type { Episode } from "../episode/EpisodeTypes";
import { type EpisodeValidation, validateEpisode } from "../episode/EpisodeValidator";
import { factCheckPrompt, repairPrompt, type ScriptBrief, wordBudget, writingPrompt } from "./ScriptPrompts";
import type { V3Budget, V3ModelChoice } from "./V3Budget";

/**
 * V3 script writer: write → extract JSON → validate (up to two repair rounds) → a separate fact-check pass whose
 * corrections are applied to the lines. Every model call goes through the episode budget.
 */
export class ScriptError extends Error {
  constructor(readonly code: "V3_SCRIPT_NO_JSON" | "V3_SCRIPT_JSON_CUT" | "V3_SCRIPT_JSON_SYNTAX" | "V3_SCRIPT_REFUSED" | "V3_SCRIPT_INVALID", message: string) {
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
  /** The writer actually used (the free fallback when the budget refused the paid one). */
  readonly writerUsed: V3ModelChoice;
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
  return Math.min(16_000, Math.max(3_000, 1_500 + wordBudget(brief) * 12));
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
  let raw = first.result.content;
  let parsed = parse(raw);
  let validation = parsed.ok ? validateEpisode(parsed.value) : undefined;
  let repairs = 0;
  while (!(parsed.ok && validation?.ok) && repairs < (input.maxRepairs ?? 2)) {
    repairs++;
    const problems = !parsed.ok ? [parsed.error] : validation!.errors.slice(0, 40).map((e) => `${e.path} ${e.code}: ${e.message}`);
    const next = await budget.generate(`onarim-${repairs}`, writerUsed, repairPrompt(raw, problems), opts);
    raw = next.result.content;
    parsed = parse(raw);
    validation = parsed.ok ? validateEpisode(parsed.value) : undefined;
  }
  if (!parsed.ok) throw new ScriptError("V3_SCRIPT_INVALID", `${repairs} onarımdan sonra JSON okunamadı: ${parsed.error}`);
  if (!validation?.ok) {
    throw new ScriptError("V3_SCRIPT_INVALID", `${repairs} onarımdan sonra doğrulama hataları: ${validation!.errors.slice(0, 5).map((e) => `${e.path} ${e.code}`).join("; ")}`);
  }

  const written = parsed.value as Episode;
  const check = await budget.generate("dogrulama", input.checker, factCheckPrompt(JSON.stringify(written), brief.dil), { maxTokens: FACT_CHECK_MAX_TOKENS });
  const report = readFactCheck(check.result.content);
  if (!report) {
    return { episode: written, validation, factCheck: { durum: "okunamadi", iddialar: [], uygulanan: 0 }, repairs, writerUsed };
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
    writerUsed,
  };
}
