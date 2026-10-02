import crypto from "node:crypto";
import { canonicalAyasJson } from "../ayas/provenance/AyasReleaseProvenance";

/** Stage 15M: evidence coverage, not a weighted quality score or publication authority. */
export const PRODUCTION_QUALITY_CRITERIA = Object.freeze({
  FACT: ["CLAIM_REFERENCES", "DATE_NAME_LOCATION_CONSISTENCY", "RECONSTRUCTION_LABELS", "SOURCE_QUALITY"],
  VISUAL: ["MEDIA_RELEVANCE", "CRITICAL_MEDIA_RESOLUTION", "VISUAL_REPETITION", "CHARACTER_CONTINUITY", "SCENE_TIMING", "TRANSITIONS"],
  AUDIO: ["NARRATION_COMPLETE", "NO_CLIPPING", "LOUDNESS_INTELLIGIBILITY", "MUSIC_DUCKING", "AUDIO_DURATION_ALIGNMENT", "NO_LONG_SILENCE"],
  STORY: ["HOOK", "PACING", "CHRONOLOGY", "PAYOFF", "NARRATION_REPETITION", "CURIOSITY_LOOP_RESOLVED", "NO_UNSUPPORTED_SENSATIONALISM"],
  TECHNICAL: ["FFPROBE_DURATION", "CODEC_CONTAINER", "INTENDED_RESOLUTION", "THUMBNAIL", "SUBTITLES", "ATTRIBUTION_CREDITS"],
} as const);
export type ProductionQualityDomain = keyof typeof PRODUCTION_QUALITY_CRITERIA;
export type ProductionQualityCriterion = (typeof PRODUCTION_QUALITY_CRITERIA)[ProductionQualityDomain][number];
export const YOUTUBE_READY_ARTIFACTS = Object.freeze(["MP4", "THUMBNAIL", "TITLE_OPTIONS", "DESCRIPTION", "CHAPTERS", "ATTRIBUTION", "SUBTITLES", "COST_REPORT", "QUALITY_REPORT", "TAGS"] as const);
export type YouTubeReadyArtifactId = (typeof YOUTUBE_READY_ARTIFACTS)[number];
export type ProductionQualityEvidenceState = "PASS" | "FAIL" | "UNMEASURED" | "NOT_APPLICABLE";
export interface ProductionQualityObservation {
  readonly criterion: ProductionQualityCriterion;
  readonly state: ProductionQualityEvidenceState;
  /** The exact production/artifact revision observed, never the revision of a previous render. */
  readonly revision: string;
  readonly evidenceClass: "DETERMINISTIC_CHECK" | "MEASUREMENT";
  /** Logical receipt identity and its bytes; free-form model conclusions are not evidence classes. */
  readonly receiptId: string;
  readonly receiptDigest: string;
}
export interface YouTubeReadyArtifact {
  readonly id: YouTubeReadyArtifactId;
  readonly state: "VERIFIED" | "MISSING" | "UNREADABLE" | "NOT_APPLICABLE";
  readonly sha256: string | null;
}
export interface ProductionQualityGateInput {
  readonly projectSlug: string;
  readonly repositoryHead: string;
  /** Digest of the project facts used (director/fact pack/scene plan); artifact digests alone omit editorial changes. */
  readonly factsDigest: string;
  readonly characteristics: { readonly syntheticReconstruction: boolean | null; readonly characterScenes: boolean | null; readonly musicBed: boolean | null };
  readonly observations: readonly ProductionQualityObservation[];
  readonly artifacts: readonly YouTubeReadyArtifact[];
  readonly rightsGate: "PASS" | "BLOCKED" | "UNKNOWN";
  readonly costGate: "PASS" | "BLOCKED" | "UNKNOWN";
}
export interface ProductionQualityGateReport {
  readonly schemaVersion: "1";
  readonly projectSlug: string;
  readonly revision: string | null;
  readonly outcome: "BLOCKED" | "QUALITY_REVIEW_REQUIRED" | "YOUTUBE_READY_OWNER_REVIEW";
  readonly checks: readonly { readonly domain: ProductionQualityDomain; readonly criterion: ProductionQualityCriterion; readonly state: ProductionQualityEvidenceState; readonly reason: string }[];
  readonly missingArtifacts: readonly YouTubeReadyArtifactId[];
  readonly problems: readonly string[];
  readonly counts: Readonly<Record<ProductionQualityEvidenceState, number>>;
  readonly authority: "NONE";
  readonly publication: "OWNER_ONLY";
}
const HASH = /^[a-f0-9]{64}$/;
const CRITERIA = Object.values(PRODUCTION_QUALITY_CRITERIA).flat();
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).sort().join("|") === [...expected].sort().join("|");
const member = (value: unknown, choices: readonly string[]): value is string => typeof value === "string" && choices.includes(value);
/** Closed data schema: approval, auto-publish, override and extra criterion fields are never interpreted. */
export function isProductionQualityGateInput(value: unknown): value is ProductionQualityGateInput {
  if (!plain(value) || !keys(value, ["projectSlug", "repositoryHead", "factsDigest", "characteristics", "observations", "artifacts", "rightsGate", "costGate"])) return false;
  if (typeof value.projectSlug !== "string" || !/^[a-z0-9][a-z0-9-]{0,179}$/.test(value.projectSlug) || typeof value.repositoryHead !== "string" || !/^[a-f0-9]{40}$/.test(value.repositoryHead) || typeof value.factsDigest !== "string" || !HASH.test(value.factsDigest)) return false;
  const c = value.characteristics;
  if (!plain(c) || !keys(c, ["syntheticReconstruction", "characterScenes", "musicBed"]) || Object.values(c).some((item) => item !== null && typeof item !== "boolean")) return false;
  if (!member(value.rightsGate, ["PASS", "BLOCKED", "UNKNOWN"]) || !member(value.costGate, ["PASS", "BLOCKED", "UNKNOWN"])) return false;
  if (!Array.isArray(value.observations) || value.observations.length > CRITERIA.length || !Array.isArray(value.artifacts) || value.artifacts.length > YOUTUBE_READY_ARTIFACTS.length) return false;
  const observed = new Set<string>();
  for (const o of value.observations) {
    if (!plain(o) || !keys(o, ["criterion", "state", "revision", "evidenceClass", "receiptId", "receiptDigest"]) || !(CRITERIA as readonly unknown[]).includes(o.criterion) || observed.has(String(o.criterion))
      || !member(o.state, ["PASS", "FAIL", "UNMEASURED", "NOT_APPLICABLE"]) || typeof o.revision !== "string" || !HASH.test(o.revision)
      || !member(o.evidenceClass, ["DETERMINISTIC_CHECK", "MEASUREMENT"]) || typeof o.receiptId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(o.receiptId) || typeof o.receiptDigest !== "string" || !HASH.test(o.receiptDigest)) return false;
    observed.add(String(o.criterion));
  }
  const artifacts = new Set<string>();
  for (const a of value.artifacts) {
    if (!plain(a) || !keys(a, ["id", "state", "sha256"]) || !(YOUTUBE_READY_ARTIFACTS as readonly unknown[]).includes(a.id) || artifacts.has(String(a.id)) || !member(a.state, ["VERIFIED", "MISSING", "UNREADABLE", "NOT_APPLICABLE"])
      || (a.state === "VERIFIED" ? typeof a.sha256 !== "string" || !HASH.test(a.sha256) : a.sha256 !== null)) return false;
    artifacts.add(String(a.id));
  }
  return true;
}
/** QUALITY_REPORT is output about this revision, so its own digest is excluded to avoid a self-reference cycle. */
export function productionQualityRevision(input: ProductionQualityGateInput): string {
  return crypto.createHash("sha256").update(canonicalAyasJson({ project: input.projectSlug, head: input.repositoryHead, facts: input.factsDigest, characteristics: input.characteristics,
    artifacts: [...input.artifacts].filter((a) => a.id !== "QUALITY_REPORT").sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) })).digest("hex");
}
const notApplicable = (id: ProductionQualityCriterion, c: ProductionQualityGateInput["characteristics"]) =>
  (id === "RECONSTRUCTION_LABELS" && c.syntheticReconstruction === false) || (id === "CHARACTER_CONTINUITY" && c.characterScenes === false) || (id === "MUSIC_DUCKING" && c.musicBed === false);

/** Evidence input must come from actual checks/measurements through the existing readers. This function does not collect or attest receipts, run production or waive owner review. */
export function evaluateProductionQualityGate(value: unknown): ProductionQualityGateReport {
  if (!isProductionQualityGateInput(value)) return { schemaVersion: "1", projectSlug: "UNKNOWN", revision: null, outcome: "BLOCKED", checks: [], missingArtifacts: [], problems: ["QUALITY_INPUT_INVALID"], counts: { PASS: 0, FAIL: 0, UNMEASURED: 0, NOT_APPLICABLE: 0 }, authority: "NONE", publication: "OWNER_ONLY" };
  const input = value;
  const revision = productionQualityRevision(input);
  const checks: ProductionQualityGateReport["checks"][number][] = [];
  const problems: string[] = [];
  for (const domain of Object.keys(PRODUCTION_QUALITY_CRITERIA) as ProductionQualityDomain[]) for (const criterion of PRODUCTION_QUALITY_CRITERIA[domain]) {
    const observation = input.observations.find((o) => o.criterion === criterion);
    let state: ProductionQualityEvidenceState = "UNMEASURED";
    let reason = "No receipt for this criterion; it cannot be counted as PASS.";
    if (observation && observation.revision !== revision) reason = "The receipt describes a different production revision; measure the current artifacts.";
    else if (observation) {
      if (observation.state === "NOT_APPLICABLE" && !notApplicable(criterion, input.characteristics)) { state = "FAIL"; reason = "This criterion is applicable or its applicability is unknown; it cannot be waived."; }
      else { state = observation.state; reason = state === "NOT_APPLICABLE" ? "Explicitly inapplicable to the recorded production characteristics." : `Recorded ${observation.evidenceClass} receipt ${observation.receiptId}.`; }
    }
    checks.push({ domain, criterion, state, reason });
  }
  const missingArtifacts = YOUTUBE_READY_ARTIFACTS.filter((id) => {
    const a = input.artifacts.find((item) => item.id === id);
    return !(a?.state === "VERIFIED" || (id === "TAGS" && a?.state === "NOT_APPLICABLE"));
  });
  if (input.rightsGate !== "PASS") problems.push(`RIGHTS_${input.rightsGate}`);
  if (input.costGate !== "PASS") problems.push(`COST_${input.costGate}`);
  const counts = { PASS: 0, FAIL: 0, UNMEASURED: 0, NOT_APPLICABLE: 0 };
  for (const check of checks) counts[check.state]++;
  const blocked = counts.FAIL > 0 || input.rightsGate === "BLOCKED" || input.costGate === "BLOCKED";
  const incomplete = counts.UNMEASURED > 0 || missingArtifacts.length > 0 || problems.length > 0;
  return { schemaVersion: "1", projectSlug: input.projectSlug, revision, outcome: blocked ? "BLOCKED" : incomplete ? "QUALITY_REVIEW_REQUIRED" : "YOUTUBE_READY_OWNER_REVIEW", checks, missingArtifacts, problems, counts, authority: "NONE", publication: "OWNER_ONLY" };
}
