import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export type ExpectedScenarios = number | string;
export interface CanonicalSmokeChildSpec { readonly childId: string; readonly partitionId: string;
  readonly name: string; readonly suite: string; readonly script: string;
  readonly expectedScenarios: ExpectedScenarios; readonly timeoutMs: number; readonly foundation?: boolean;
  readonly environment?: Readonly<Record<string, string>> }
export interface CanonicalSmokePartitionSpec { readonly partitionId: string; readonly childIds: readonly string[] }
type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
type JsonObject = { readonly [key: string]: JsonValue };
type MutableJsonObject = { [key: string]: JsonValue };

export type CanonicalEvidenceErrorCode =
  | "EVIDENCE_MATRIX_HEAD_MISMATCH" | "EVIDENCE_BASELINE_MISMATCH"
  | "EVIDENCE_REGISTRY_MISMATCH" | "EVIDENCE_HOSTILE_POLICY_MISMATCH"
  | "EVIDENCE_TIMEOUT_POLICY_MISMATCH" | "EVIDENCE_ROOT_IDENTITY_MISMATCH"
  | "EVIDENCE_ROOT_REPARSE_DETECTED" | "EVIDENCE_ROOT_PARENT_CHAIN_INVALID"
  | "EVIDENCE_CHILD_INTEGRITY_MISMATCH" | "EVIDENCE_CHILD_TERMINAL_MISMATCH"
  | "EVIDENCE_CHILD_SHARED_DELTA" | "EVIDENCE_CHILD_PRODUCTION_DELTA"
  | "EVIDENCE_CHILD_DATA_PROJECTS_DIRTY" | "EVIDENCE_CHILD_REMAINDER_PRESENT"
  | "EVIDENCE_PARTITION_COUNTER_MISMATCH" | "EVIDENCE_PARTITION_COVERAGE_MISMATCH"
  | "EVIDENCE_AGGREGATE_COUNTER_MISMATCH" | "EVIDENCE_RESUME_PROVENANCE_MISSING"
  | "EVIDENCE_RESUME_PROVENANCE_MISMATCH" | "EVIDENCE_ACTIVE_LEASE"
  | "EVIDENCE_INCOMPLETE_MATRIX" | "EVIDENCE_ENVIRONMENT_RESTORE_MISMATCH"
  | "EVIDENCE_REGISTRATION_RESTORE_MISMATCH" | "EVIDENCE_TEMP_CLEANUP_IDENTITY_MISMATCH"
  | "EVIDENCE_SUPPLIED_INTEGRITY_FORBIDDEN";
export class CanonicalEvidenceError extends Error { public constructor(public readonly code: CanonicalEvidenceErrorCode,
  message: string) { super(`${code}: ${message}`); this.name = "CanonicalEvidenceError"; } }

function child(partitionId: string, childId: string, name: string, suite: string, script: string,
  expectedScenarios: ExpectedScenarios, timeoutMs = 180_000,
  extra: Pick<CanonicalSmokeChildSpec, "foundation" | "environment"> = {}): CanonicalSmokeChildSpec {
  return Object.freeze({ partitionId, childId, name, suite, script, expectedScenarios, timeoutMs, ...extra });
}
const retryScript = "smoke-pipeline-retry-continuation-hardening.ts", retrySuite = "pipeline-retry-continuation-hardening";
export const canonicalSmokeChildren: readonly CanonicalSmokeChildSpec[] = Object.freeze([
  child("P1", "foundation", "Foundation invariants", "canonical-smoke-runtime-foundation", "smoke-canonical-smoke-runtime-foundation.ts", 29, 180_000, { foundation: true }),
  child("P1", "visual", "Visual", "production-visual-asset-wiring", "smoke-production-visual-asset-wiring.ts", 54),
  child("P1", "animation", "Animation", "production-animation-provider", "smoke-production-animation-provider.ts", 30),
  child("P1", "scene-video", "Scene-video", "production-scene-video-rendering", "smoke-production-scene-video-rendering.ts", 23),
  child("P1", "retry-continuation", "Retry continuation", retrySuite, retryScript, 23),
  child("P1", "retry-persistence", "Retry persistence", "retry-persistence", "smoke-retry-persistence.ts", "5 groups"),
  child("P1", "youtube-package", "YouTube package", "production-youtube-package-pipeline", "smoke-production-youtube-package-pipeline.ts", 58),
  child("P1", "youtube-publish", "YouTube publish", "production-youtube-publish-pipeline", "smoke-production-youtube-publish-pipeline.ts", 31),
  child("P1", "sprint-129-28", "Sprint 129.28", "sprint-129-28-production-acceptance-reauthorization", "smoke-sprint-129-28-production-acceptance-reauthorization.ts", 137, 300_000),
  ...Array.from({ length: 10 }, (_, index) => child("P2", `retry-isolated-${String(index + 1).padStart(2, "0")}`,
    `Retry isolated ${index + 1}/10`, retrySuite, retryScript, 23)),
  child("P3", "sprint-129-27", "Sprint 129.27", "sprint-129-27-audio-remediation", "smoke-sprint-129-27-audio-remediation.ts", 77, 300_000),
  child("P3", "durable-attempt", "Durable execution attempt", "production-execution-durable-attempt", "smoke-production-execution-durable-attempt.ts", 58),
  child("P3", "durable-recovery", "Durable recovery", "production-execution-durable-recovery", "smoke-production-execution-durable-recovery.ts", 29),
  child("P3", "recovery-bootstrap", "Recovery bootstrap", "production-recovery-bootstrap", "smoke-production-recovery-bootstrap.ts", 18),
  child("P3", "worker-lifecycle", "Worker lifecycle", "production-worker-lifecycle", "smoke-production-worker-lifecycle.ts", 21),
  child("P3", "runtime-context", "Runtime context", "sprint-129-25c-runtime-context", "smoke-sprint-129-25c-2b-4-runtime-context.ts", 48),
  child("P3", "audio-wiring", "Audio wiring", "production-audio-asset-wiring", "smoke-production-audio-asset-wiring.ts", 73),
  child("P4", "assembly-wiring", "Assembly wiring", "production-video-assembly-wiring", "smoke-production-video-assembly-wiring.ts", 46),
  child("P4", "thumbnail-full", "Thumbnail full", "production-thumbnail-pipeline", "smoke-production-thumbnail-pipeline.ts", 42),
  child("P4", "production-e2e", "Production E2E", "production-end-to-end", "smoke-production-end-to-end.ts", 20),
  child("P4", "durable-persistence", "Durable execution persistence", "production-execution-persistence", "smoke-production-execution-persistence.ts", 71),
  child("P4", "e2e-stabilization", "Production E2E stabilization", "production-end-to-end-stabilization", "smoke-production-end-to-end-stabilization.ts", 26),
  child("P4", "durable-wiring", "Production pipeline durable wiring", "production-pipeline-durable-wiring", "smoke-production-pipeline-durable-wiring.ts", 19),
  child("P4", "sprint-128-1", "Sprint 128.1 production acceptance", "sprint-128-1-production-acceptance", "smoke-sprint-128-1-production-acceptance.ts", 30),
  child("P5", "animation-motion-plan", "Animation motion-plan contract", "animation-motion-plan-contract", "smoke-animation-motion-plan-contract.ts", 21),
  child("P5", "assembly-scene-video", "Assembly scene-video consumption", "assembly-scene-video-consumption", "smoke-assembly-scene-video-consumption.ts", 19),
  child("P5", "pipeline-history", "Pipeline history persistence", "pipeline-history-persistence", "smoke-pipeline-history-persistence.ts", 6),
  child("P5", "pipeline-orchestration", "Pipeline orchestration", "pipeline-orchestration", "smoke-pipeline-orchestration.ts", 10),
  child("P5", "health-service", "Production health service", "production-health-service", "smoke-production-health-service.ts", 24),
  child("P5", "readiness-acceptance", "Production readiness acceptance", "production-readiness-acceptance", "smoke-production-readiness-acceptance.ts", 24),
  child("P5", "snapshot-builder", "Production snapshot builder", "production-snapshot-builder", "smoke-production-snapshot-builder.ts", 29),
  child("P5", "thumbnail-isolated", "Thumbnail isolated", "production-thumbnail-pipeline", "smoke-production-thumbnail-pipeline.ts", 1, 180_000,
    { environment: { THUMBNAIL_SMOKE_SCENARIO: "undefined and blank provider default to mock" } }),
]);
const partitionIds = ["P1", "P2", "P3", "P4", "P5"] as const;
export const canonicalSmokePartitions: readonly CanonicalSmokePartitionSpec[] = Object.freeze(partitionIds.map((partitionId) =>
  Object.freeze({ partitionId, childIds: Object.freeze(canonicalSmokeChildren.filter((item) => item.partitionId === partitionId).map((item) => item.childId)) })));
const hostileEnvironmentPolicy = Object.freeze({
  AI_PROVIDER: "hostile-ai", IMAGE_PROVIDER: "hostile-image", AUDIO_PROVIDER: "hostile-audio",
  ANIMATION_PROVIDER: "hostile-animation", VIDEO_PROVIDER: "hostile-video", VIDEO_ASSEMBLY_PROVIDER: "hostile-assembly",
  THUMBNAIL_PROVIDER: "hostile-thumbnail", YOUTUBE_PROVIDER: "hostile-youtube", YOUTUBE_PUBLISH_PROVIDER: "hostile-publish",
  OPENAI_API_KEY: "hostile-secret", YOUTUBE_ACCESS_TOKEN: "hostile-token", OPENAI_MODEL: "hostile-model",
  OPENAI_TTS_MODEL: "hostile-tts-model", OPENAI_BASE_URL: "http://127.0.0.1:1/hostile",
  OPENAI_API_BASE: "http://127.0.0.1:1/hostile", FFMPEG_PATH: "hostile-ffmpeg", FFPROBE_PATH: "hostile-ffprobe",
  FFMPEG_TIMEOUT_MS: "1", OPENAI_TTS_TIMEOUT_MS: "1", OPENAI_TTS_MAX_RESPONSE_BYTES: "1",
  YOUTUBE_CHANNEL_ID: "hostile-channel", ATOLYE_DURABLE_PIPELINE_EXECUTION: "hostile",
});

export function canonicalStringify(value: unknown): string { return JSON.stringify(normalizeJson(value)); }
export function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function addIntegrity<T extends Record<string, unknown>>(value: T): T & { readonly integrityHash: string } {
  const normalized = normalizeJson(value) as MutableJsonObject;
  assert(!("integrityHash" in normalized), "Integrity input already contains integrityHash.");
  return Object.freeze({ ...normalized, integrityHash: sha256(canonicalStringify(normalized)) }) as T & { readonly integrityHash: string };
}
export function verifyIntegrity(value: unknown, label = "manifest"): asserts value is JsonObject {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  const object = value as MutableJsonObject, integrityHash = object.integrityHash;
  assert(typeof integrityHash === "string" && integrityHash.length > 0, `${label}.integrityHash is invalid.`);
  const copy = { ...object }; delete copy.integrityHash;
  assert.equal(sha256(canonicalStringify(copy)), integrityHash, `${label} integrity hash mismatch.`);
}
export const canonicalSmokeRegistryFingerprint = sha256(canonicalStringify(canonicalSmokeChildren));
export const hostileEnvironmentPolicyFingerprint = sha256(canonicalStringify(hostileEnvironmentPolicy));
export const childTimeoutPolicyFingerprint = sha256(canonicalStringify(canonicalSmokeChildren.map((item) => ({ childId: item.childId, timeoutMs: item.timeoutMs }))));

function normalizeJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { assert(Number.isFinite(value), "Canonical JSON rejects NaN and Infinity."); return value; }
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (typeof value === "object") { const result: MutableJsonObject = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(compare)) { const item = (value as Record<string, unknown>)[key];
      assert(item !== undefined, `Canonical JSON rejects undefined at ${key}.`); result[key] = normalizeJson(item); } return result; }
  throw new TypeError(`Canonical JSON rejects ${typeof value}.`);
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
