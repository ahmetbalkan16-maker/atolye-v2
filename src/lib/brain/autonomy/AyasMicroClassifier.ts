import { classifyPatchSet, type BrainPatchSafetyLevel } from "../selfheal/BrainPatchSafety";

/**
 * M18 — deterministic, server-owned MICRO_SAFE vs PRIORITY_SAFE
 * classification, layered strictly ON TOP of the existing (unmodified)
 * SAFE/REVIEW_REQUIRED/FORBIDDEN_AUTONOMOUS domain classifier
 * (`BrainPatchSafety.classifyPatchSet`). This module never weakens that
 * boundary — it only subdivides the SAFE case. A REVIEW_REQUIRED or
 * FORBIDDEN_AUTONOMOUS candidate can never become MICRO_SAFE or
 * PRIORITY_SAFE; it is classified `NOT_SAFE` here and must go through
 * existing human-governed channels exactly as before, never the micro lane.
 *
 * Classification is never influenced by model/proposal prose — only by
 * structural facts (file count, aggregate line count, and a closed,
 * server-owned allowlist of which generator identities are trusted to
 * produce genuinely small, low-complexity output).
 */
export type AyasMicroClassification = "MICRO_SAFE" | "PRIORITY_SAFE" | "NOT_SAFE";

export const AYAS_MICRO_MAX_FILES = 2;
export const AYAS_MICRO_MAX_TOTAL_LINES = 60;

/**
 * Closed, hand-reviewed list of generator identities trusted to produce
 * micro-eligible output. A generator is added here only after its own
 * output has been reviewed as consistently small, test-only, and
 * low-complexity (see `AyasPatchDetectors.ts`). Never populated from
 * proposal/candidate text.
 */
const AYAS_MICRO_ELIGIBLE_GENERATORS: ReadonlySet<string> = new Set([
  "ayas-detector:error-code-contract-gap-v1",
]);

export interface AyasMicroClassificationInput {
  readonly exactFiles: readonly string[];
  readonly totalLines: number;
  readonly generatorIdentity: string;
}

export interface AyasMicroClassificationResult {
  readonly domainSafety: BrainPatchSafetyLevel;
  readonly classification: AyasMicroClassification;
  readonly reason: string;
}

export function classifyAyasMicroCandidate(input: AyasMicroClassificationInput): AyasMicroClassificationResult {
  const domain = classifyPatchSet(input.exactFiles);
  if (domain.level !== "SAFE") {
    return { domainSafety: domain.level, classification: "NOT_SAFE", reason: `domain classification is ${domain.level}, not SAFE — never eligible for either safe lane` };
  }
  if (!AYAS_MICRO_ELIGIBLE_GENERATORS.has(input.generatorIdentity)) {
    return { domainSafety: domain.level, classification: "PRIORITY_SAFE", reason: `generator "${input.generatorIdentity}" is not on the micro-eligible allowlist` };
  }
  if (input.exactFiles.length > AYAS_MICRO_MAX_FILES) {
    return { domainSafety: domain.level, classification: "PRIORITY_SAFE", reason: `${input.exactFiles.length} files exceeds micro max ${AYAS_MICRO_MAX_FILES}` };
  }
  if (input.totalLines > AYAS_MICRO_MAX_TOTAL_LINES) {
    return { domainSafety: domain.level, classification: "PRIORITY_SAFE", reason: `${input.totalLines} total lines exceeds micro max ${AYAS_MICRO_MAX_TOTAL_LINES}` };
  }
  return { domainSafety: domain.level, classification: "MICRO_SAFE", reason: "SAFE domain, trusted micro generator, within file/line bounds" };
}
