import fs from "node:fs";
import path from "node:path";
import type { ProductionStepKey } from "@/types/project";
import type { ProductionExecutionPersistenceAdapter } from "@/types/productionExecutionPersistence";
import type { ProductionExecutionIdempotencyRecord } from "@/types/productionExecutionIdempotency";
import type { ProductionRegenerationBinding } from "@/types/productionRegeneration";
import { stableProductionId } from "./ProductionDeterminism";
import {
  type RuntimeStorageInput,
  getProjectRoot,
  resolveRuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import { buildProductionPipelineExecutionIdentity } from "./ProductionPipelineExecutionFactory";
import {
  listRegenerationExecutionBindingCandidates,
  listRegenerationExecutionBindings,
  listRegenerationIds as listProductionRegenerationIds,
  isRegenerationCompleted as isProductionRegenerationCompleted,
} from "./ProductionCompletedStageRegenerationStore";
import {
  listRegenerationIds as listPipelineRegenerationIds,
  isRegenerationCompleted as isPipelineRegenerationCompleted,
} from "@/lib/pipeline/PipelineStageRegenerationStore";
import { anyDurableRecordReferencesRecordId } from "./ProductionPipelineRetryReconciliation";
import {
  findMatchingOrphanReservationToleranceAuthority,
  resolveOrphanReservationTolerance,
} from "./ProductionOrphanReservationToleranceAuthority";

/**
 * AUTHORITY-ONLY sibling mechanism for the "duplicate durable attempt ordinal"
 * class of defect (two different recordIds, from two different regeneration
 * bindings, both claiming the same durable attempt ordinal for the same
 * project/stage — see the real i-stanbul-un-fethi-1453/assembly attempt=7
 * case: `ca987045...` (Gen 2, orphaned before claim) vs `1ab478279f9a...`
 * (Gen 3, genuinely executed, VIDEO_ASSEMBLY_FAILED)).
 *
 * Same write-once / replay-safe / immutable-authority shape as
 * `ProductionOrphanReservationToleranceAuthority.ts`, applied to a
 * structurally different problem: NOT "does this one reservation get
 * tolerated," but "does this SPECIFIC (candidate, canonical) pair, in THIS
 * specific duplicate-ordinal collision, have a fully-provable supersession
 * relationship." Every published authority names exactly one candidate and
 * exactly one canonical record — never a general-purpose duplicate resolver,
 * never a scan-and-supersede-everything sweep.
 *
 * Deliberately NOT wired into `ProductionDurableAttemptLineageClassifier.ts`,
 * `ProductionExecutionRecoveryBootstrap.ts`, or any other automatic
 * startup/recovery/classifier path in this change. Publishing an authority
 * here has ZERO effect on classifier behavior, retry admission, or
 * production execution — the duplicate ordinal keeps resolving to
 * `lineage-cardinality` exactly as before. Classifier consumption (excluding
 * a superseded candidate from the record set the cardinality/topology proof
 * evaluates) is a distinct, separately-approved change, not part of this one.
 *
 * Deliberately does NOT reuse or extend `ProductionOrphanReservationToleranceAuthority`'s
 * own API/schema — that mechanism answers "was this reservation ever
 * claimed," nothing about regeneration precedence between two records. This
 * file only ever *consumes* an existing, already-published orphan-tolerance
 * authority as one of several required preconditions (see
 * `evaluateAndPublishSupersededDuplicateReservationDecision`'s step 9) — it
 * never re-derives that judgment itself, and never widens what that other
 * authority means.
 *
 * Every mutation-adjacent read here is read-only: this module never writes
 * to `idempotency`, `reservation`, `claim`, or `attempt` — only to its own,
 * brand-new sibling directory. Neither the candidate's nor the canonical's
 * own durable records are ever touched, before or after a decision is
 * published.
 */

export const supersededDuplicateReservationSchemaVersion = "1" as const;
export const supersededDuplicateReservationPolicyVersion =
  "superseded-duplicate-reservation-v1" as const;

export interface ProductionSupersededDuplicateReservationProof {
  readonly candidateReservationId: string;
  readonly canonicalReservationId: string;
  readonly candidateReservationContentFingerprint: string;
  readonly canonicalReservationContentFingerprint: string;
  readonly candidateRegenerationId: string;
  readonly candidateGenerationOrdinal: number;
  readonly canonicalRegenerationId: string;
  readonly canonicalGenerationOrdinal: number;
  readonly toleranceAuthorityId: string;
}

export interface ProductionSupersededDuplicateReservationAuthorityBody {
  readonly schemaVersion: typeof supersededDuplicateReservationSchemaVersion;
  readonly policyVersion: typeof supersededDuplicateReservationPolicyVersion;
  /** Deterministic — derived from the structural facts below, never random
   * and never timestamp-based, so two workers independently evaluating the
   * SAME (project, stage, attempt, candidate, canonical) tuple concurrently
   * always compute the identical decisionId and identical body, and the
   * second writer safely replays instead of racing to a false conflict. */
  readonly decisionId: string;
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly jobId: string;
  readonly attempt: number;
  readonly candidateRecordId: string;
  readonly canonicalRecordId: string;
  readonly reason: "later-regeneration-duplicate-ordinal";
  readonly proof: ProductionSupersededDuplicateReservationProof;
  readonly integrity: {
    readonly algorithm: "stable-production-id-v1";
    readonly fingerprint: string;
  };
}

export interface SupersededDuplicateReservationStoreResult<T> {
  readonly ok: boolean;
  readonly status: "created" | "found" | "replayed" | "not-found" | "conflict" | "failed";
  readonly writeFree: boolean;
  readonly value?: T;
  readonly reasonCode: string;
  readonly evidence: readonly string[];
}

function decisionIdFor(input: {
  readonly projectSlug: string; readonly stage: ProductionStepKey; readonly attempt: number;
  readonly candidateRecordId: string; readonly canonicalRecordId: string;
}): string {
  return stableProductionId("duplicate-ordinal-supersession-decision", {
    projectSlug: input.projectSlug, stage: input.stage, attempt: input.attempt,
    candidateRecordId: input.candidateRecordId, canonicalRecordId: input.canonicalRecordId,
  });
}

export function buildProductionSupersededDuplicateReservationAuthorityBody(
  input: Omit<ProductionSupersededDuplicateReservationAuthorityBody, "integrity" | "decisionId">,
): ProductionSupersededDuplicateReservationAuthorityBody {
  const decisionId = decisionIdFor(input);
  const withoutIntegrity = { ...input, decisionId };
  const fingerprint = stableProductionId(
    "superseded-duplicate-reservation-authority", withoutIntegrity,
  );
  return Object.freeze({
    ...withoutIntegrity,
    integrity: { algorithm: "stable-production-id-v1" as const, fingerprint },
  });
}

export function validateProductionSupersededDuplicateReservationAuthorityBody(
  body: ProductionSupersededDuplicateReservationAuthorityBody,
): boolean {
  if (
    body.schemaVersion !== supersededDuplicateReservationSchemaVersion ||
    body.policyVersion !== supersededDuplicateReservationPolicyVersion ||
    typeof body.decisionId !== "string" || !body.decisionId ||
    typeof body.projectSlug !== "string" || !body.projectSlug ||
    typeof body.stage !== "string" || !body.stage ||
    typeof body.jobId !== "string" || !body.jobId ||
    !Number.isSafeInteger(body.attempt) || body.attempt < 1 ||
    typeof body.candidateRecordId !== "string" || !body.candidateRecordId ||
    typeof body.canonicalRecordId !== "string" || !body.canonicalRecordId ||
    body.candidateRecordId === body.canonicalRecordId ||
    body.reason !== "later-regeneration-duplicate-ordinal" ||
    decisionIdFor(body) !== body.decisionId
  ) return false;
  const { integrity, ...withoutIntegrity } = body;
  return integrity.algorithm === "stable-production-id-v1" &&
    integrity.fingerprint === stableProductionId(
      "superseded-duplicate-reservation-authority", withoutIntegrity,
    );
}

function directory(projectSlug: string, input: RuntimeStorageInput = {}): string {
  // A dedicated sibling directory to orphan-reservation-tolerances/ — physically
  // separate so the two authority families can never collide or be confused.
  return path.join(getProjectRoot(projectSlug, input), "production-execution",
    "superseded-duplicate-reservations");
}

function assertContained(projectSlug: string, targetPath: string, input: RuntimeStorageInput = {}) {
  const root = directory(projectSlug, input);
  const rel = path.relative(root, targetPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`CANONICAL_CONTAINMENT_VIOLATION: ${targetPath} is outside ${root}`);
  }
}

export function writeProductionSupersededDuplicateReservationAuthority(
  projectSlug: string,
  body: ProductionSupersededDuplicateReservationAuthorityBody,
  input: RuntimeStorageInput = {},
): SupersededDuplicateReservationStoreResult<ProductionSupersededDuplicateReservationAuthorityBody> {
  if (!validateProductionSupersededDuplicateReservationAuthorityBody(body)) {
    return { ok: false, status: "failed", writeFree: true,
      reasonCode: "SUPERSEDED_DUPLICATE_RESERVATION_INTEGRITY_MISMATCH",
      evidence: ["body:integrity-invalid"] };
  }
  const dir = directory(projectSlug, input);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const decisionPath = path.join(dir, `decision-${body.decisionId}.json`);
  assertContained(projectSlug, decisionPath, input);
  if (fs.existsSync(decisionPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(decisionPath, "utf8")) as
        ProductionSupersededDuplicateReservationAuthorityBody;
      if (existing.decisionId === body.decisionId &&
        validateProductionSupersededDuplicateReservationAuthorityBody(existing) &&
        existing.integrity.fingerprint === body.integrity.fingerprint) {
        return { ok: true, status: "replayed", writeFree: true, value: existing,
          reasonCode: "SUPERSEDED_DUPLICATE_RESERVATION_REPLAYED",
          evidence: ["store:decision-replayed"] };
      }
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "SUPERSEDED_DUPLICATE_RESERVATION_CORRUPT",
        evidence: ["store:existing-decision-conflict"] };
    } catch {
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "SUPERSEDED_DUPLICATE_RESERVATION_CORRUPT",
        evidence: ["store:existing-decision-unreadable"] };
    }
  }
  const tempPath = path.join(dir,
    `decision-${body.decisionId}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(body, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    fs.renameSync(tempPath, decisionPath);
    return { ok: true, status: "created", writeFree: false, value: body,
      reasonCode: "SUPERSEDED_DUPLICATE_RESERVATION_PUBLISHED",
      evidence: ["store:decision-published"] };
  } catch (error) {
    if (fs.existsSync(tempPath)) { try { fs.unlinkSync(tempPath); } catch { /* ignore */ } }
    return { ok: false, status: "failed", writeFree: false,
      reasonCode: "SUPERSEDED_DUPLICATE_RESERVATION_PUBLICATION_FAILED",
      evidence: [`store:write-error:${error}`] };
  }
}

export function readProductionSupersededDuplicateReservationAuthority(
  projectSlug: string,
  decisionId: string,
  input: RuntimeStorageInput = {},
): SupersededDuplicateReservationStoreResult<ProductionSupersededDuplicateReservationAuthorityBody> {
  const dir = directory(projectSlug, input);
  const decisionPath = path.join(dir, `decision-${decisionId}.json`);
  assertContained(projectSlug, decisionPath, input);
  if (!fs.existsSync(decisionPath)) {
    return { ok: false, status: "not-found", writeFree: true,
      reasonCode: "SUPERSEDED_DUPLICATE_RESERVATION_NOT_FOUND",
      evidence: ["store:decision-not-found"] };
  }
  try {
    const body = JSON.parse(fs.readFileSync(decisionPath, "utf8")) as
      ProductionSupersededDuplicateReservationAuthorityBody;
    if (!validateProductionSupersededDuplicateReservationAuthorityBody(body) || body.decisionId !== decisionId) {
      return { ok: false, status: "conflict", writeFree: true,
        reasonCode: "SUPERSEDED_DUPLICATE_RESERVATION_CORRUPT",
        evidence: ["store:decision-corrupt"] };
    }
    return { ok: true, status: "found", writeFree: true, value: body,
      reasonCode: "SUPERSEDED_DUPLICATE_RESERVATION_FOUND",
      evidence: ["store:decision-found"] };
  } catch {
    return { ok: false, status: "conflict", writeFree: true,
      reasonCode: "SUPERSEDED_DUPLICATE_RESERVATION_CORRUPT",
      evidence: ["store:decision-unreadable"] };
  }
}

/** Read-only lookup by the structural tuple, mirroring
 * `findMatchingOrphanReservationToleranceAuthority`'s shape. Never writes. */
export function findExistingSupersededDuplicateReservationDecision(
  projectSlug: string,
  stage: ProductionStepKey,
  attempt: number,
  candidateRecordId: string,
  canonicalRecordId: string,
  input: RuntimeStorageInput = {},
): ProductionSupersededDuplicateReservationAuthorityBody | undefined {
  const decisionId = decisionIdFor({ projectSlug, stage, attempt, candidateRecordId, canonicalRecordId });
  const read = readProductionSupersededDuplicateReservationAuthority(projectSlug, decisionId, input);
  return read.ok ? read.value : undefined;
}

export type SupersessionDecisionDiscoveryResult =
  | { readonly status: "none" }
  | { readonly status: "found"; readonly decision: ProductionSupersededDuplicateReservationAuthorityBody }
  | { readonly status: "ambiguous"; readonly matchCount: number }
  | { readonly status: "invalid" };

/**
 * Read-only scan-by-candidate discovery. A name-derived lookup is not
 * available to callers that only know ONE record's id at a time (the
 * classifier's own record-discovery loop, in particular): `decisionId` is a
 * hash of BOTH `candidateRecordId` AND `canonicalRecordId`, so which file to
 * open by name can't be known until the pairing is already known — which is
 * exactly the thing this function exists to discover. Mirrors
 * `findMatchingOrphanReservationToleranceAuthority`'s scan+filter shape, but
 * goes further: unlike that function (first structurally-valid match wins),
 * this one treats a SECOND matching file for the same candidate as
 * `"ambiguous"` — fail-closed, never "first one wins" — and distinguishes a
 * structurally-broken match (`"invalid"`) from a genuine absence (`"none"`),
 * since a would-be exclusion decision this code cannot read as trustworthy
 * must never be treated as if it never existed. Only a `"found"` result may
 * ever be acted on by a caller; `"none"`, `"ambiguous"`, and `"invalid"` all
 * mean the same thing to a consumer -- do not exclude anything.
 */
export function findSupersessionDecisionForCandidate(
  projectSlug: string,
  stage: ProductionStepKey,
  candidateRecordId: string,
  input: RuntimeStorageInput = {},
): SupersessionDecisionDiscoveryResult {
  const dir = directory(projectSlug, input);
  if (!fs.existsSync(dir)) return { status: "none" };
  let files: string[];
  try { files = fs.readdirSync(dir); } catch { return { status: "none" }; }
  const validMatches: ProductionSupersededDuplicateReservationAuthorityBody[] = [];
  let invalidMatchCount = 0;
  for (const file of files) {
    if (!file.startsWith("decision-") || !file.endsWith(".json")) continue;
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")); } catch { continue; }
    const candidateLike = raw as Partial<ProductionSupersededDuplicateReservationAuthorityBody>;
    if (candidateLike.projectSlug !== projectSlug || candidateLike.stage !== stage ||
      candidateLike.candidateRecordId !== candidateRecordId) continue;
    if (validateProductionSupersededDuplicateReservationAuthorityBody(
      raw as ProductionSupersededDuplicateReservationAuthorityBody)) {
      validMatches.push(raw as ProductionSupersededDuplicateReservationAuthorityBody);
    } else {
      invalidMatchCount += 1;
    }
  }
  const totalMatches = validMatches.length + invalidMatchCount;
  if (totalMatches === 0) return { status: "none" };
  if (totalMatches > 1) return { status: "ambiguous", matchCount: totalMatches };
  return validMatches.length === 1 ? { status: "found", decision: validMatches[0] } : { status: "invalid" };
}

function runTypeFromOperation(operation: string): "initial" | "resume" | "retry" | undefined {
  const match = /^pipeline\.stage\.(initial|resume|retry)$/.exec(operation);
  return match ? (match[1] as "initial" | "resume" | "retry") : undefined;
}

async function readLatestIdempotencyRecord(
  adapter: ProductionExecutionPersistenceAdapter,
  recordId: string,
): Promise<ProductionExecutionIdempotencyRecord | undefined | "list-failed"> {
  const listed = await adapter.listKeys("idempotency");
  if (!listed.ok) return "list-failed";
  const versions: Array<{ version: number; value: ProductionExecutionIdempotencyRecord }> = [];
  for (const key of listed.keys) {
    const read = await adapter.read("idempotency", key);
    if (read.status === "failed") return "list-failed";
    if (read.status !== "found" || read.value.recordId !== recordId) continue;
    versions.push({ version: read.value.integrity.version, value: read.value });
  }
  if (versions.length === 0) return undefined;
  versions.sort((left, right) => left.version - right.version);
  for (let index = 0; index < versions.length; index += 1) {
    if (versions[index].version !== index + 1) return undefined; // discontinuous -> unresolvable
  }
  return versions[versions.length - 1].value;
}

/** Non-circular, position-independent regeneration resolution for a single
 * record — mirrors `ProductionDurableAttemptLineageClassifier.ts`'s private
 * `resolveHistoricalRecordIdentity` algorithm exactly (same public
 * primitives, same "search every historically-eligible regeneration
 * candidate, accept only an exact single match" discipline), reimplemented
 * here because that function is not exported and this change does not touch
 * the classifier file. Returns `{ regeneration: undefined, ambiguous: false }`
 * for a record with no regeneration (legacy/pre-regeneration identity) —
 * NOT the same as an unresolvable record, which sets `ambiguous: true`. */
function resolveRegenerationForRecord(
  projectSlug: string,
  stage: ProductionStepKey,
  record: ProductionExecutionIdempotencyRecord,
  runType: "initial" | "resume" | "retry",
  context: ReturnType<typeof resolveRuntimeStorageContext>,
): { regeneration: ProductionRegenerationBinding | undefined; ambiguous: boolean } {
  const ordinal = record.attempt - 1;
  const jobId = `${projectSlug}-${stage}`;
  const candidates = listRegenerationExecutionBindingCandidates(projectSlug, stage, context)
    .filter((item) => item.firstGlobalExecutionOrdinal <= ordinal)
    .map((item) => item.binding);
  const matches = [undefined, ...candidates].filter((regeneration) => {
    const planned = buildProductionPipelineExecutionIdentity(
      { projectSlug, stage, runType, regeneration }, { id: jobId, attempts: ordinal });
    return planned.recordId === record.recordId;
  });
  if (matches.length !== 1) return { regeneration: undefined, ambiguous: true };
  return { regeneration: matches[0], ambiguous: false };
}

function isAnyNamespaceRegenerationCompleted(
  projectSlug: string,
  regenerationId: string,
  context: ReturnType<typeof resolveRuntimeStorageContext>,
): boolean {
  // ProductionCompletedStageRegenerationStore.ts's own exported
  // isRegenerationCompleted() only checks the PRODUCTION namespace
  // (production-regeneration/regenerations/<id>/completed.json);
  // PipelineStageRegenerationStore.ts has its own, separate, pipeline-
  // namespace version. Neither top-level export dispatches between the two,
  // so this narrow authority determines origin by membership before asking
  // the correctly-scoped function — never assumes a specific namespace.
  if (listProductionRegenerationIds(projectSlug, context).includes(regenerationId)) {
    return isProductionRegenerationCompleted(projectSlug, regenerationId, context);
  }
  if (listPipelineRegenerationIds(projectSlug, context).includes(regenerationId)) {
    return isPipelineRegenerationCompleted(projectSlug, regenerationId, context);
  }
  return false; // unknown origin -> not provably completed -> fails closed downstream
}

export interface SupersededDuplicateReservationEvaluationInput {
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly candidateRecordId: string;
  readonly canonicalRecordId: string;
}

export interface SupersededDuplicateReservationEvaluationResult {
  readonly ok: boolean;
  readonly reasonCode: string;
  readonly writeFree: boolean;
  readonly evidence: readonly string[];
  readonly authority?: ProductionSupersededDuplicateReservationAuthorityBody;
}

function denied(reasonCode: string, evidence: string): SupersededDuplicateReservationEvaluationResult {
  return { ok: false, reasonCode, writeFree: true, evidence: [`reason:${reasonCode}`, evidence] };
}

/**
 * The single entry point for this authority family. Explicit, operator-
 * invoked, one-off evaluation against a specific, already-identified
 * (candidateRecordId, canonicalRecordId) pair — never a scan-and-supersede-
 * everything sweep (mirrors `reconcileOrphanedReservationWithoutClaim`'s own
 * invocation discipline). Every step below is independently fail-closed: if
 * ANY condition cannot be proven, no decision is written and the function
 * returns `ok:false` — the caller (and, unmodified, the classifier) continue
 * to see the duplicate exactly as before this function was ever called.
 *
 * Read-only except for the final, single write-once decision publish — never
 * touches `idempotency`, `reservation`, `claim`, or `attempt`.
 */
export async function evaluateAndPublishSupersededDuplicateReservationDecision(
  adapter: ProductionExecutionPersistenceAdapter,
  input: SupersededDuplicateReservationEvaluationInput,
  runtimeInput: RuntimeStorageInput = {},
): Promise<SupersededDuplicateReservationEvaluationResult> {
  const { projectSlug, stage, candidateRecordId, canonicalRecordId } = input;
  if (candidateRecordId === canonicalRecordId) return denied("SAME_RECORD_ID", "candidate:equals-canonical");

  const context = resolveRuntimeStorageContext(runtimeInput);
  const jobId = `${projectSlug}-${stage}`;

  const [candidateRecord, canonicalRecord] = await Promise.all([
    readLatestIdempotencyRecord(adapter, candidateRecordId),
    readLatestIdempotencyRecord(adapter, canonicalRecordId),
  ]);
  if (candidateRecord === "list-failed" || canonicalRecord === "list-failed") {
    return denied("RECORD_UNREADABLE", "idempotency:list-or-read-failed");
  }
  if (!candidateRecord) return denied("RECORD_NOT_FOUND", "candidate:missing");
  if (!canonicalRecord) return denied("RECORD_NOT_FOUND", "canonical:missing");

  if (candidateRecord.projectSlug !== projectSlug || candidateRecord.stage !== stage ||
    canonicalRecord.projectSlug !== projectSlug || canonicalRecord.stage !== stage) {
    return denied("PROJECT_STAGE_MISMATCH", "record:project-or-stage-does-not-match-input");
  }
  if (candidateRecord.attempt !== canonicalRecord.attempt) {
    return denied("ORDINAL_MISMATCH", `candidate:${candidateRecord.attempt}:canonical:${canonicalRecord.attempt}`);
  }

  const candidateRunType = runTypeFromOperation(candidateRecord.operation);
  const canonicalRunType = runTypeFromOperation(canonicalRecord.operation);
  if (!candidateRunType) return denied("OPERATION_FORMAT_INVALID", "candidate:operation");
  if (!canonicalRunType) return denied("OPERATION_FORMAT_INVALID", "canonical:operation");

  const candidateResolution = resolveRegenerationForRecord(projectSlug, stage, candidateRecord, candidateRunType, context);
  const canonicalResolution = resolveRegenerationForRecord(projectSlug, stage, canonicalRecord, canonicalRunType, context);
  if (candidateResolution.ambiguous) return denied("IDENTITY_RESOLUTION_AMBIGUOUS", "candidate:zero-or-multi-match");
  if (canonicalResolution.ambiguous) return denied("IDENTITY_RESOLUTION_AMBIGUOUS", "canonical:zero-or-multi-match");
  const candidateRegen = candidateResolution.regeneration;
  const canonicalRegen = canonicalResolution.regeneration;
  if (!candidateRegen) return denied("CANDIDATE_NO_REGENERATION", "candidate:legacy-identity-out-of-scope");
  if (!canonicalRegen) return denied("CANONICAL_NO_REGENERATION", "canonical:legacy-identity-out-of-scope");

  if (!(candidateRegen.generationOrdinal < canonicalRegen.generationOrdinal)) {
    return denied("GENERATION_ORDINAL_NOT_STRICTLY_LESS",
      `candidate:${candidateRegen.generationOrdinal}:canonical:${canonicalRegen.generationOrdinal}`);
  }
  if (!isAnyNamespaceRegenerationCompleted(projectSlug, candidateRegen.regenerationId, context)) {
    return denied("CANDIDATE_GENERATION_NOT_COMPLETED", `regenerationId:${candidateRegen.regenerationId}`);
  }
  const activeBindings = listRegenerationExecutionBindings(projectSlug, stage, context);
  if (!activeBindings.some((item) => item.binding.regenerationId === canonicalRegen.regenerationId)) {
    return denied("CANONICAL_GENERATION_NOT_ACTIVE_MAX", `regenerationId:${canonicalRegen.regenerationId}`);
  }

  const [candidateHasClaim, candidateHasAttempt] = await Promise.all([
    anyDurableRecordReferencesRecordId(adapter, "claim", candidateRecordId),
    anyDurableRecordReferencesRecordId(adapter, "attempt", candidateRecordId),
  ]);
  if (candidateHasClaim === "list-failed" || candidateHasAttempt === "list-failed") {
    return denied("RECORD_UNREADABLE", "candidate:claim-or-attempt-list-failed");
  }
  if (candidateHasClaim) return denied("CANDIDATE_HAS_CLAIM", "candidate:claim-exists");
  if (candidateHasAttempt) return denied("CANDIDATE_HAS_ATTEMPT", "candidate:attempt-exists");
  if (candidateRecord.result || candidateRecord.failure) {
    return denied("CANDIDATE_HAS_RESULT_OR_FAILURE", "candidate:execution-semantics-present");
  }

  const [canonicalHasClaim, canonicalHasAttempt] = await Promise.all([
    anyDurableRecordReferencesRecordId(adapter, "claim", canonicalRecordId),
    anyDurableRecordReferencesRecordId(adapter, "attempt", canonicalRecordId),
  ]);
  if (canonicalHasClaim === "list-failed" || canonicalHasAttempt === "list-failed") {
    return denied("RECORD_UNREADABLE", "canonical:claim-or-attempt-list-failed");
  }
  if (!canonicalHasClaim) return denied("CANONICAL_MISSING_CLAIM", "canonical:no-claim");
  if (!canonicalHasAttempt) return denied("CANONICAL_MISSING_ATTEMPT", "canonical:no-attempt");

  const candidateReservationRead = await adapter.read("reservation", candidateRecord.identityFingerprint);
  if (candidateReservationRead.status !== "found") {
    return denied("TOLERANCE_AUTHORITY_MISSING_OR_INVALID", "candidate:reservation-missing");
  }
  const toleranceMatch = findMatchingOrphanReservationToleranceAuthority(
    projectSlug, stage, jobId, candidateRecord.identityFingerprint, candidateRecord.operation,
    candidateRecord.attempt, context,
  );
  if (!toleranceMatch) return denied("TOLERANCE_AUTHORITY_MISSING_OR_INVALID", "candidate:no-matching-authority");
  const toleranceValid = await resolveOrphanReservationTolerance(adapter, candidateReservationRead.value, {
    projectSlug, stage, jobId, runtimeInput: context,
  });
  if (!toleranceValid) return denied("TOLERANCE_AUTHORITY_MISSING_OR_INVALID", "candidate:authority-cas-or-rescan-failed");

  const canonicalReservationRead = await adapter.read("reservation", canonicalRecord.identityFingerprint);
  if (canonicalReservationRead.status !== "found") {
    return denied("RECORD_UNREADABLE", "canonical:reservation-missing");
  }

  const body = buildProductionSupersededDuplicateReservationAuthorityBody({
    schemaVersion: supersededDuplicateReservationSchemaVersion,
    policyVersion: supersededDuplicateReservationPolicyVersion,
    projectSlug, stage, jobId, attempt: candidateRecord.attempt,
    candidateRecordId, canonicalRecordId,
    reason: "later-regeneration-duplicate-ordinal",
    proof: {
      candidateReservationId: candidateRecord.identityFingerprint,
      canonicalReservationId: canonicalRecord.identityFingerprint,
      candidateReservationContentFingerprint: stableProductionId(
        "superseded-duplicate-reservation-content", candidateReservationRead.value),
      canonicalReservationContentFingerprint: stableProductionId(
        "superseded-duplicate-reservation-content", canonicalReservationRead.value),
      candidateRegenerationId: candidateRegen.regenerationId,
      candidateGenerationOrdinal: candidateRegen.generationOrdinal,
      canonicalRegenerationId: canonicalRegen.regenerationId,
      canonicalGenerationOrdinal: canonicalRegen.generationOrdinal,
      toleranceAuthorityId: toleranceMatch.authorityId,
    },
  });
  const written = writeProductionSupersededDuplicateReservationAuthority(projectSlug, body, context);
  if (!written.ok) return denied(written.reasonCode, "store:write-failed");
  return { ok: true, reasonCode: written.reasonCode, writeFree: written.writeFree,
    evidence: written.evidence, authority: written.value };
}
