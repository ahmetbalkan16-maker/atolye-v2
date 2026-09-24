import crypto from "node:crypto";

import { classifyPatchSet } from "../selfheal/BrainPatchSafety";
import { isAyasCapabilityCategory, type AyasCapabilityCategory } from "./AyasCapabilityTaxonomy";
import { neutralizeAyasUntrustedText } from "./AyasDeepAnalysis";
import type { AyasExternalResearchFinding } from "./AyasExternalResearchStore";
import { normalizeAyasResearchUrl } from "./AyasResearchNoveltyStore";
import { selectAyasImprovementStrategy, type AyasImprovementRegistry, type AyasImprovementStrategy } from "./AyasResearchExperimentRegistry";

/**
 * Stage 8 — the pure decision core of the research → improvement loop:
 * finding → normalized candidate → relevance/novelty → local measurable gap
 * → explicit hypothesis. Nothing here performs I/O, runs anything, or grants
 * authority. External research text is carried only as a neutralized,
 * bounded quote and a fingerprint; no field of a finding can supply a file,
 * command, tool, benchmark, strategy or approval decision. Those come only
 * from the closed registry, selected by structured facts.
 */
export const AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION = "1" as const;

export type AyasResearchRelevance = "IRRELEVANT" | "ALREADY_SUPPORTED" | "DUPLICATE" | "PLAUSIBLE_IMPROVEMENT" | "NEEDS_MORE_EVIDENCE" | "UNSAFE_TO_TEST";
export type AyasResearchInstructionSignal = "OVERRIDE_RULES" | "APPROVAL_DIRECTIVE" | "COMMAND_DIRECTIVE" | "FILE_EDIT_DIRECTIVE" | "PATH_REFERENCE" | "TOOL_DIRECTIVE";
export type AyasResearchFreshness = "FRESH" | "AGING" | "STALE";

export interface AyasResearchImprovementCandidate {
  readonly schemaVersion: typeof AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION;
  readonly findingId: string;
  readonly sourceIds: readonly string[];
  readonly researchRunId: string | null;
  readonly researchMode: "LIGHT" | "DEEP" | null;
  readonly observedAt: string;
  readonly domain: AyasCapabilityCategory | null;
  readonly evidenceStrength: "STRONG" | "MODERATE" | "WEAK";
  readonly confidenceClass: "high" | "medium" | "low";
  readonly freshness: AyasResearchFreshness;
  readonly gapClaim: "already-supported" | "partially-supported" | "missing";
  readonly licenseCostStatus: "free-tier-available" | "paid-only" | "open-source" | "unknown";
  readonly isOfficialSource: boolean;
  /** Identity of the claim text; the text itself never leaves the quote below. */
  readonly claimFingerprint: string;
  /** Hashed content tokens for deterministic semantic-duplicate detection. */
  readonly claimTokenHashes: readonly string[];
  /** Neutralized, bounded quote. DATA ONLY — never parsed for paths, commands or decisions. */
  readonly quotedClaim: string;
  readonly instructionSignals: readonly AyasResearchInstructionSignal[];
  readonly authority: "NONE";
}

export class AyasResearchImprovementError extends Error {
  constructor(readonly code: "AYAS_RESEARCH_IMPROVEMENT_INVALID_FINDING", message: string) {
    super(message);
    this.name = "AyasResearchImprovementError";
    this.stack = undefined;
  }
}

const FINDING_ID = /^ayas-research-[0-9a-f-]{36}$/i;

/** Stable, bounded index key: the id itself when valid, otherwise a hash of whatever was stored. */
export function ayasResearchIndexKey(findingId: unknown): string {
  const raw = String(findingId ?? "");
  return FINDING_ID.test(raw) ? raw : `invalid-${crypto.createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 32)}`;
}
const DAY_MS = 24 * 60 * 60_000;
export const AYAS_RESEARCH_FRESH_DAYS = 30;
export const AYAS_RESEARCH_STALE_DAYS = 180;
export const AYAS_RESEARCH_SEMANTIC_DUPLICATE_JACCARD = 0.6;

const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");

function fold(text: string): string {
  return String(text ?? "").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ç/g, "c").replace(/ö/g, "o").replace(/ü/g, "u");
}

/**
 * Detects text that tries to direct AYAS rather than describe a capability.
 * Detection can only DOWNGRADE a finding to `UNSAFE_TO_TEST`; the loop's
 * authority boundary does not depend on it, because no text field is ever
 * read into a file, command, tool, strategy or approval decision.
 */
const INSTRUCTION_PATTERNS: readonly [AyasResearchInstructionSignal, RegExp][] = [
  ["OVERRIDE_RULES", /\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier|existing|system)?\s*(rules|instructions|policies|guardrails|prompt)\b|onceki\s+(kurallari|talimatlari|kurallar|talimatlar)\s*(yok\s+say|gormezden\s+gel|unut)|\bsystem\s+prompt\b|\byou\s+are\s+now\b/],
  ["APPROVAL_DIRECTIVE", /\b(auto(matically|-)?\s*approve|approve\s+(this|it|them|all|automatically|immediately)|grant\s+(yourself\s+)?(approval|authority|permission)|bypass\s+(the\s+)?(approval|gate|review|owner)|mark\s+(it|this)\s+(as\s+)?approved|pre-?authori[sz]ed\s+by\s+the\s+owner)\b|otomatik\s+(olarak\s+)?onayla|onayla\s+ve\s+uygula|sahip\s+onayi\s+(gerekmez|atla)/],
  ["COMMAND_DIRECTIVE", /\b(please\s+)?(run|execute)\s+(this|the\s+following|these|that)\s+(command|commands|script|shell|snippet)\b|`\s*(npm|npx|pnpm|yarn|git|curl|wget|powershell|pwsh|bash|sh|cmd|rm|del|node|tsx)\b[^`]*`|(su|bu|asagidaki)\s+komut(u|lari)?\s+calistir/],
  ["FILE_EDIT_DIRECTIVE", /\b(edit|modify|overwrite|delete|patch|rewrite)\s+(this|that|your|the\s+following)\s+(file|files|source|code|repository|repo|module)\b|(dosyayi|dosyasini|kodu|kaynak\s+kodu)\s+(duzenle|degistir|sil)/],
  ["PATH_REFERENCE", /(^|[\s"'`(=])(src|scripts|app|data|docs|\.env|\.git|node_modules)\/[\w.-]+|\b[a-z]:\\[\w .-]+/],
  ["TOOL_DIRECTIVE", /\b(you\s+must|you\s+should|always|then)\s+(use|call|invoke|select|dispatch)\s+(the\s+)?(tool|skill|agent|model|codex|claude)\b|\bmutationkind\b|\bpatch-artifact\b|\bresearch-(adaptation|experiment)-/],
];

export function detectAyasResearchInstructionSignals(text: string): readonly AyasResearchInstructionSignal[] {
  const folded = fold(String(text ?? "").slice(0, 4_000));
  return INSTRUCTION_PATTERNS.filter(([, pattern]) => pattern.test(folded)).map(([signal]) => signal);
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "now", "new", "can", "are", "its", "via", "per", "has", "have", "more", "better", "improved", "improve", "improves", "support", "supports", "using", "use", "based", "feature", "release", "version",
  "ile", "icin", "bir", "daha", "veya", "olan", "gibi", "yeni", "artik", "destek", "iyi",
]);

/** Order-insensitive content tokens, hashed so no external wording is persisted by the loop index. */
export function ayasResearchClaimTokenHashes(text: string): readonly string[] {
  const words = fold(text).replace(/v?\d+(\.\d+)*/g, " ").match(/[a-z]{3,}/g) ?? [];
  const stem = (word: string): string => word.replace(/(ing|ed|es|s)$/, "").replace(/e$/, "");
  const tokens = [...new Set(words.filter((word) => !STOPWORDS.has(word)).map(stem).filter((word) => word.length >= 3))];
  return tokens.map((token) => sha256(token).slice(0, 12)).sort().slice(0, 48);
}

export function ayasResearchTokenSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function canonicalIso(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Phase 4 contract: a finding becomes safe, structured metadata plus one quoted string. Invalid identity fails closed. */
export function normalizeAyasResearchImprovementCandidate(finding: AyasExternalResearchFinding, nowIso: string): AyasResearchImprovementCandidate {
  if (!FINDING_ID.test(String(finding?.findingId ?? ""))) {
    throw new AyasResearchImprovementError("AYAS_RESEARCH_IMPROVEMENT_INVALID_FINDING", "finding id is not a recorded research finding id");
  }
  const observedAt = canonicalIso(finding.lastCheckedAt) ?? canonicalIso(finding.recordedAt) ?? new Date(0).toISOString();
  const ageDays = Math.max(0, (Date.parse(nowIso) - Date.parse(observedAt)) / DAY_MS);
  const confidence = finding.confidence === "high" || finding.confidence === "medium" ? finding.confidence : "low";
  const official = finding.isOfficialSource === true;
  return {
    schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION,
    findingId: finding.findingId,
    sourceIds: [`source-${sha256(normalizeAyasResearchUrl(String(finding.sourceUrl ?? ""))).slice(0, 16)}`],
    researchRunId: typeof finding.researchRunId === "string" && /^[0-9a-f-]{36}$/i.test(finding.researchRunId) ? finding.researchRunId : null,
    researchMode: finding.researchMode === "LIGHT" || finding.researchMode === "DEEP" ? finding.researchMode : null,
    observedAt,
    domain: typeof finding.category === "string" && isAyasCapabilityCategory(finding.category) ? finding.category : null,
    evidenceStrength: official && confidence === "high" ? "STRONG" : (official && confidence === "medium") || (!official && confidence === "high") ? "MODERATE" : "WEAK",
    confidenceClass: confidence,
    freshness: ageDays <= AYAS_RESEARCH_FRESH_DAYS ? "FRESH" : ageDays <= AYAS_RESEARCH_STALE_DAYS ? "AGING" : "STALE",
    gapClaim: finding.atolyeGapStatus === "already-supported" || finding.atolyeGapStatus === "partially-supported" ? finding.atolyeGapStatus : "missing",
    licenseCostStatus: ["free-tier-available", "paid-only", "open-source"].includes(finding.licenseCostStatus) ? finding.licenseCostStatus : "unknown",
    isOfficialSource: official,
    claimFingerprint: sha256(fold(`${finding.capability ?? ""}\n${finding.problemSolved ?? ""}`).replace(/\s+/g, " ").trim()),
    claimTokenHashes: ayasResearchClaimTokenHashes(`${finding.capability ?? ""} ${finding.problemSolved ?? ""}`),
    quotedClaim: neutralizeAyasUntrustedText(`${finding.capability ?? ""}: ${finding.problemSolved ?? ""}`).slice(0, 240),
    // The external claim is scanned for every signal. Gap notes describe local architecture, so naming a local
    // module there is expected; every directive signal still applies to them.
    instructionSignals: [...new Set([
      ...detectAyasResearchInstructionSignals(`${finding.capability ?? ""}\n${finding.problemSolved ?? ""}`),
      ...detectAyasResearchInstructionSignals(String(finding.atolyeGapNotes ?? "")).filter((signal) => signal !== "PATH_REFERENCE"),
    ])],
    authority: "NONE",
  };
}

export interface AyasKnownResearchFinding {
  readonly findingId: string;
  readonly domain: AyasCapabilityCategory | null;
  readonly sourceIds: readonly string[];
  readonly claimFingerprint: string;
  readonly claimTokenHashes: readonly string[];
}

export interface AyasResearchRelevanceResult {
  readonly relevance: AyasResearchRelevance;
  readonly reasonCode: string;
  readonly duplicateOf?: string;
}

/**
 * Phase 5 — deterministic, conservative, ordered. A model's opinion never
 * decides it: the inputs are the stored enums, the closed capability map and
 * hashed token overlap. `known` must contain only findings already judged
 * PLAUSIBLE_IMPROVEMENT: a weak, unofficial or hostile finding seen first can
 * never suppress a later strong one as its "duplicate".
 */
export function classifyAyasResearchRelevance(candidate: AyasResearchImprovementCandidate, registry: AyasImprovementRegistry, known: readonly AyasKnownResearchFinding[]): AyasResearchRelevanceResult {
  if (candidate.instructionSignals.length > 0) return { relevance: "UNSAFE_TO_TEST", reasonCode: "SOURCE_CONTAINS_INSTRUCTIONS" };
  if (candidate.licenseCostStatus === "paid-only") return { relevance: "UNSAFE_TO_TEST", reasonCode: "PAID_PROVIDER_REQUIRED" };
  if (candidate.domain === null || registry.capabilityMap[candidate.domain] === null) return { relevance: "IRRELEVANT", reasonCode: "NO_AYAS_CAPABILITY" };
  if (candidate.gapClaim === "already-supported") return { relevance: "ALREADY_SUPPORTED", reasonCode: "CAPABILITY_ALREADY_SUPPORTED" };
  for (const prior of known) {
    if (prior.findingId === candidate.findingId) return { relevance: "DUPLICATE", reasonCode: "SAME_FINDING", duplicateOf: prior.findingId };
    if (prior.claimFingerprint === candidate.claimFingerprint && prior.sourceIds.some((id) => candidate.sourceIds.includes(id))) {
      return { relevance: "DUPLICATE", reasonCode: "SAME_SOURCE_AND_CLAIM", duplicateOf: prior.findingId };
    }
    if (prior.domain === candidate.domain && ayasResearchTokenSimilarity(prior.claimTokenHashes, candidate.claimTokenHashes) >= AYAS_RESEARCH_SEMANTIC_DUPLICATE_JACCARD) {
      return { relevance: "DUPLICATE", reasonCode: "SEMANTIC_DUPLICATE", duplicateOf: prior.findingId };
    }
  }
  if (candidate.confidenceClass === "low") return { relevance: "NEEDS_MORE_EVIDENCE", reasonCode: "LOW_CONFIDENCE_EVIDENCE" };
  if (!candidate.isOfficialSource) return { relevance: "NEEDS_MORE_EVIDENCE", reasonCode: "UNOFFICIAL_SOURCE" };
  if (candidate.licenseCostStatus === "unknown") return { relevance: "NEEDS_MORE_EVIDENCE", reasonCode: "LICENSE_COST_UNKNOWN" };
  if (candidate.freshness === "STALE") return { relevance: "NEEDS_MORE_EVIDENCE", reasonCode: "STALE_EVIDENCE" };
  return { relevance: "PLAUSIBLE_IMPROVEMENT", reasonCode: "RELEVANT_UNMEASURED_CLAIM" };
}

/** A deterministic benchmark measurement at one HEAD — the only accepted evidence of a local gap. */
export interface AyasLocalGapSnapshot {
  readonly schemaVersion: typeof AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION;
  readonly benchmarkId: string;
  readonly evaluatorSha256: string;
  readonly measuredAtHead: string;
  readonly measuredAt: string;
  readonly caseCount: number;
  readonly passed: number;
  readonly heldOut: { readonly passed: number; readonly total: number };
  readonly dimensions: Readonly<Record<string, { readonly passed: number; readonly total: number }>>;
  readonly failing: readonly { readonly id: string; readonly dimension: string; readonly heldOut: boolean; readonly knownLimitation: boolean }[];
}

export type AyasResearchGapMapping =
  | { readonly status: "MAPPED"; readonly capability: string; readonly component: string; readonly benchmarkId: string; readonly dimension: string; readonly targetCaseIds: readonly string[]; readonly snapshot: AyasLocalGapSnapshot }
  | { readonly status: "NO_LOCAL_BENCHMARK"; readonly capability: string }
  | { readonly status: "GAP_NOT_MEASURED"; readonly capability: string; readonly benchmarkId: string }
  | { readonly status: "NO_LOCAL_GAP"; readonly capability: string; readonly benchmarkId: string; readonly measuredAtHead: string };

/**
 * Phase 6 — RESEARCH CLAIM + LOCAL MEASURABLE GAP. A mapping exists only when
 * a benchmark measured at the current HEAD has a failing, non-held-out case in
 * a dimension the claim's capability covers. Held-out failures are protection
 * signals only; targeting them would be benchmark gaming.
 */
export function mapAyasResearchToLocalGap(candidate: AyasResearchImprovementCandidate, registry: AyasImprovementRegistry, snapshots: readonly AyasLocalGapSnapshot[], currentHead: string): AyasResearchGapMapping {
  const target = candidate.domain ? registry.capabilityMap[candidate.domain] : null;
  if (!target) return { status: "NO_LOCAL_BENCHMARK", capability: "none" };
  const benchmarks = target.benchmarks.filter((entry) => registry.benchmarks.some((benchmark) => benchmark.benchmarkId === entry.benchmarkId));
  if (benchmarks.length === 0) return { status: "NO_LOCAL_BENCHMARK", capability: target.capability };
  for (const entry of benchmarks) {
    const snapshot = snapshots.find((item) => item.benchmarkId === entry.benchmarkId && item.measuredAtHead === currentHead);
    if (!snapshot) return { status: "GAP_NOT_MEASURED", capability: target.capability, benchmarkId: entry.benchmarkId };
    for (const dimension of entry.dimensions) {
      const targetCaseIds = snapshot.failing.filter((row) => row.dimension === dimension && !row.heldOut).map((row) => row.id).sort();
      if (targetCaseIds.length > 0) return { status: "MAPPED", capability: target.capability, component: target.component, benchmarkId: entry.benchmarkId, dimension, targetCaseIds, snapshot };
    }
  }
  return { status: "NO_LOCAL_GAP", capability: target.capability, benchmarkId: benchmarks[0]!.benchmarkId, measuredAtHead: currentHead };
}

export interface AyasImprovementHypothesis {
  readonly schemaVersion: typeof AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION;
  readonly hypothesisId: string;
  readonly findingIds: readonly string[];
  readonly capability: string;
  readonly component: string;
  readonly benchmarkId: string;
  readonly targetDimension: string;
  readonly targetCaseIds: readonly string[];
  readonly expectedImprovement: { readonly metric: "target-cases-fixed"; readonly minDelta: number; readonly statement: string };
  readonly protectedInvariants: readonly string[];
  readonly regressionSuites: readonly string[];
  readonly abortConditions: readonly string[];
  readonly riskClass: "SAFE" | "REVIEW_REQUIRED" | "FORBIDDEN_AUTONOMOUS";
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly exactFiles: readonly string[];
  readonly maxChangedLines: number;
  readonly gapEvidence: { readonly measuredAtHead: string; readonly evaluatorSha256: string; readonly failingTargetCount: number };
}

export const AYAS_HYPOTHESIS_PROTECTED_INVARIANTS: readonly string[] = Object.freeze([
  "no baseline-passing benchmark case may fail",
  "held-out pass count may not decrease",
  "declared regression suites must keep passing",
  "benchmark evaluator digest and case set must be identical before and after",
  "changes stay inside the strategy's exact files and line budget",
  "no approval, execution-gate, mutation-registry or publication module is touched",
  "no network, paid provider or live runtime path is used",
]);

export const AYAS_HYPOTHESIS_ABORT_CONDITIONS: readonly string[] = Object.freeze([
  "BASELINE_NOT_REPRODUCED", "BENCHMARK_CHANGED", "BENCHMARK_TIMEOUT", "BENCHMARK_CRASHED", "REPORT_INVALID",
  "SCOPE_VIOLATION", "LIVE_WORKSPACE_CHANGED", "BASE_HEAD_MOVED", "TIME_BUDGET_EXHAUSTED",
]);

/** Phase 7 — only a mapped gap plus a registered strategy yields a hypothesis. The identity ignores which finding asked, so paraphrased findings converge on one experiment. */
export function buildAyasImprovementHypothesis(mapping: Extract<AyasResearchGapMapping, { status: "MAPPED" }>, strategy: AyasImprovementStrategy, findingIds: readonly string[]): AyasImprovementHypothesis {
  const targetCaseIds = [...mapping.targetCaseIds].sort();
  const hypothesisId = `ayas-hypothesis-${sha256(JSON.stringify([mapping.capability, mapping.benchmarkId, mapping.dimension, targetCaseIds, strategy.strategyId, strategy.version])).slice(0, 32)}`;
  return {
    schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION,
    hypothesisId,
    findingIds: [...new Set(findingIds)].sort(),
    capability: mapping.capability,
    component: strategy.component,
    benchmarkId: mapping.benchmarkId,
    targetDimension: mapping.dimension,
    targetCaseIds,
    expectedImprovement: {
      metric: "target-cases-fixed",
      minDelta: 1,
      statement: `If ${strategy.summary}, ${mapping.benchmarkId} ${mapping.dimension} should fix at least 1 of ${targetCaseIds.length} failing target case(s) with no newly failing case, no held-out loss and no protected-suite failure.`,
    },
    protectedInvariants: AYAS_HYPOTHESIS_PROTECTED_INVARIANTS,
    regressionSuites: [...strategy.regressionSuites],
    abortConditions: AYAS_HYPOTHESIS_ABORT_CONDITIONS,
    riskClass: classifyPatchSet(strategy.exactFiles).level,
    strategyId: strategy.strategyId,
    strategyVersion: strategy.version,
    exactFiles: [...strategy.exactFiles],
    maxChangedLines: strategy.maxChangedLines,
    gapEvidence: { measuredAtHead: mapping.snapshot.measuredAtHead, evaluatorSha256: mapping.snapshot.evaluatorSha256, failingTargetCount: targetCaseIds.length },
  };
}

export type AyasResearchCandidatePlan =
  | { readonly outcome: "IGNORED"; readonly relevance: AyasResearchRelevanceResult }
  | { readonly outcome: "NO_LOCAL_BENCHMARK"; readonly relevance: AyasResearchRelevanceResult; readonly mapping: Extract<AyasResearchGapMapping, { status: "NO_LOCAL_BENCHMARK" }> }
  | { readonly outcome: "GAP_NOT_MEASURED"; readonly relevance: AyasResearchRelevanceResult; readonly mapping: Extract<AyasResearchGapMapping, { status: "GAP_NOT_MEASURED" }> }
  | { readonly outcome: "NO_LOCAL_GAP"; readonly relevance: AyasResearchRelevanceResult; readonly mapping: Extract<AyasResearchGapMapping, { status: "NO_LOCAL_GAP" }> }
  | { readonly outcome: "NEEDS_EXPERIMENT_DESIGN"; readonly relevance: AyasResearchRelevanceResult; readonly mapping: Extract<AyasResearchGapMapping, { status: "MAPPED" }> }
  | { readonly outcome: "HYPOTHESIS"; readonly relevance: AyasResearchRelevanceResult; readonly mapping: Extract<AyasResearchGapMapping, { status: "MAPPED" }>; readonly hypothesis: AyasImprovementHypothesis };

/** Phases 5–7 composed: the whole finding-to-hypothesis decision, still pure. */
export function planAyasResearchCandidate(candidate: AyasResearchImprovementCandidate, registry: AyasImprovementRegistry, known: readonly AyasKnownResearchFinding[], snapshots: readonly AyasLocalGapSnapshot[], currentHead: string): AyasResearchCandidatePlan {
  const relevance = classifyAyasResearchRelevance(candidate, registry, known);
  if (relevance.relevance !== "PLAUSIBLE_IMPROVEMENT") return { outcome: "IGNORED", relevance };
  const mapping = mapAyasResearchToLocalGap(candidate, registry, snapshots, currentHead);
  if (mapping.status === "NO_LOCAL_BENCHMARK") return { outcome: "NO_LOCAL_BENCHMARK", relevance, mapping };
  if (mapping.status === "GAP_NOT_MEASURED") return { outcome: "GAP_NOT_MEASURED", relevance, mapping };
  if (mapping.status === "NO_LOCAL_GAP") return { outcome: "NO_LOCAL_GAP", relevance, mapping };
  const strategy = selectAyasImprovementStrategy(registry, mapping.capability, mapping.benchmarkId, mapping.dimension);
  if (!strategy) return { outcome: "NEEDS_EXPERIMENT_DESIGN", relevance, mapping };
  return { outcome: "HYPOTHESIS", relevance, mapping, hypothesis: buildAyasImprovementHypothesis(mapping, strategy, [candidate.findingId]) };
}
