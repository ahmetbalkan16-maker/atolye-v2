import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ProductionExecutionFilePersistenceAdapter,
  validateProductionExecutionPersistencePayload,
} from "../src/lib/production/ProductionExecutionPersistence";
import { readProductionCanonicalTerminalDurableLineage } from
  "../src/lib/production/ProductionCanonicalDurableLineage";
import { buildVersionedProductionPipelineExecutionIdentity } from
  "../src/lib/production/ProductionLegacyPipelineExecutionIdentity";
import { resolveOrphanReservationTolerance } from
  "../src/lib/production/ProductionOrphanReservationToleranceAuthority";
import {
  isProductionExecutionTerminalAttemptState,
  validateProductionExecutionDurableAttempt,
} from "../src/lib/production/ProductionExecutionDurableAttempt";
import { validateProductionExecutionDurableClaim } from
  "../src/lib/production/ProductionExecutionDurableClaim";
import { validateProductionExecutionDurableLease } from
  "../src/lib/production/ProductionExecutionDurableLease";
import {
  isProductionExecutionTerminalDurableRecordState,
  validateProductionExecutionDurableRecord,
} from "../src/lib/production/ProductionExecutionDurableStorage";
import { validateProductionGlobalTerminalQuiescence } from
  "../src/lib/production/ProductionGlobalTerminalQuiescence";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import type { ProductionStepKey } from "../src/types/project";
import type { ProductionExecutionDurableRecord } from "../src/types/productionExecutionDurableStorage";
import type { ProductionExecutionDurableClaimRecord } from "../src/types/productionExecutionDurableClaim";
import type { ProductionExecutionDurableAttemptRecord } from "../src/types/productionExecutionDurableAttempt";
import type { ProductionExecutionIdempotencyReservationRequest } from
  "../src/types/productionExecutionIdempotency";
import type {
  ProductionExecutionPersistenceAdapter,
  ProductionExecutionPersistenceRecordKind,
} from "../src/types/productionExecutionPersistence";

/**
 * READ-ONLY forensic diagnostic (order 3): runs against a temp fs.cp() COPY
 * of the real i-stanbul-un-fethi-1453 production-execution/ store only.
 *
 * Unlike validateProductionGlobalTerminalQuiescence itself -- which returns
 * false at the FIRST failing record inside its per-record loop -- this
 * script continues through all 19 latest idempotency records and reports a
 * full per-record matrix, so a genuinely different second (or third) failing
 * record is never masked by whichever one happens to fail first in Map
 * iteration order.
 *
 * Every function called from src/lib/production is the real, unmodified,
 * exported production code (readProductionCanonicalTerminalDurableLineage,
 * buildVersionedProductionPipelineExecutionIdentity,
 * resolveOrphanReservationTolerance, the validate-/is-Terminal-state predicates,
 * validateProductionGlobalTerminalQuiescence itself). The only things
 * reimplemented here are ProductionGlobalTerminalQuiescence.ts's PRIVATE
 * (unexported) helpers -- deriveCanonicalIdentityFromRecord, the v1
 * readLatestVersioned loop, the v1 checks[] array, parseVersionedKey,
 * contiguous, sameSet, isProductionStepKey -- copied verbatim from that
 * file (as it stands, unmodified) purely so this diagnostic can inspect
 * per-record detail the exported function does not surface. Nothing in
 * ProductionGlobalTerminalQuiescence.ts is imported for mutation, edited,
 * monkey-patched, or reordered.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const RECORD_A = "pipeline-record-507fb8ec";
const RECORD_B = "pipeline-record-ca987045bc8dc5fa60a86406342051cbd03eec7aa534fd2b713ea3b36c9828c2";

// ---------------------------------------------------------------------------
// Verbatim mirrors of ProductionGlobalTerminalQuiescence.ts's private helpers
// ---------------------------------------------------------------------------

function parseVersionedKey(key: string) {
  const match = /^(.*)-v([1-9][0-9]*)$/.exec(key);
  if (!match) return undefined;
  const version = Number(match[2]);
  return Number.isSafeInteger(version) ? { identity: match[1], version } : undefined;
}

function contiguous(versions: number[]): boolean {
  versions = [...versions].sort((left, right) => left - right);
  return versions.every((version, index) => version === index + 1);
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

const PRODUCTION_STEP_ORDER: readonly ProductionStepKey[] = [
  "research", "script", "scenes", "visuals", "animation", "video", "audio",
  "assembly", "thumbnail", "seo", "youtube", "export",
];
const productionStepKeys = new Set<string>(PRODUCTION_STEP_ORDER);
function isProductionStepKey(value: unknown): value is ProductionStepKey {
  return typeof value === "string" && productionStepKeys.has(value);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deriveCanonicalIdentityFromRecord(
  record: ProductionExecutionDurableRecord,
  slug: string,
) {
  const match = /^pipeline-record-(.+)$/.exec(record.recordId);
  if (!match) return undefined;
  const suffix = match[1];
  return {
    core: {
      projectSlug: slug,
      stage: record.stage as ProductionStepKey,
      jobId: `${slug}-${record.stage}`,
      attemptNumber: record.attempt - 1,
    },
    requestId: record.requestId,
    idempotencyKey: record.idempotencyKey,
    executionFingerprint: record.executionFingerprint,
    claimId: `pipeline-claim-${suffix}`,
    leaseId: `pipeline-lease-${suffix}`,
    attemptId: `pipeline-attempt-${suffix}`,
    recordId: record.recordId,
    runningEventId: `pipeline-running-${suffix}`,
    terminalEventId: `pipeline-terminal-${suffix}`,
  };
}

async function readLatestVersionedMirror<T>(
  adapter: ProductionExecutionPersistenceAdapter,
  kind: Extract<ProductionExecutionPersistenceRecordKind, "idempotency" | "claim" | "attempt">,
  identity: string,
  validate: (value: unknown) => boolean,
  immutableIdentity: (value: T) => string,
): Promise<{ value: T; matchingKeys: string[] } | { error: string; matchingKeys: string[] }> {
  const listed = await adapter.listKeys(kind);
  if (!listed.ok) return { error: "CANONICAL_DURABLE_LIST_FAILED", matchingKeys: [] };
  const expression = new RegExp(`^${escapeRegularExpression(identity)}-v([1-9][0-9]*)$`);
  const versions = listed.keys
    .map((key) => ({ key, match: expression.exec(key) }))
    .filter((item): item is { key: string; match: RegExpExecArray } => item.match !== null)
    .map((item) => ({ key: item.key, version: Number(item.match[1]) }))
    .sort((left, right) => left.version - right.version);
  const matchingKeys = versions.map((v) => v.key);
  if (versions.length === 0) return { error: "CANONICAL_DURABLE_LINEAGE_MISSING", matchingKeys };
  let latest: T | undefined;
  let immutable: string | undefined;
  for (let index = 0; index < versions.length; index += 1) {
    if (versions[index].version !== index + 1) {
      return { error: "CANONICAL_DURABLE_VERSION_GAP", matchingKeys };
    }
    const read = await adapter.read(kind, versions[index].key);
    if (read.status !== "found" || !validate(read.value)) {
      return { error: "CANONICAL_DURABLE_VERSION_INVALID", matchingKeys };
    }
    const value = read.value as T;
    const durableVersion = kind === "idempotency"
      ? (value as ProductionExecutionDurableRecord).recordVersion
      : kind === "claim"
        ? (value as ProductionExecutionDurableClaimRecord).claimVersion
        : (value as ProductionExecutionDurableAttemptRecord).attemptVersion;
    if (durableVersion !== versions[index].version) {
      return { error: "CANONICAL_DURABLE_KEY_VERSION_MISMATCH", matchingKeys };
    }
    const currentImmutable = immutableIdentity(value);
    if (immutable !== undefined && currentImmutable !== immutable) {
      return { error: "CANONICAL_DURABLE_IMMUTABLE_IDENTITY_CHANGED", matchingKeys };
    }
    immutable = currentImmutable;
    latest = value;
  }
  if (!latest) return { error: "CANONICAL_DURABLE_LINEAGE_MISSING", matchingKeys };
  return { value: latest, matchingKeys };
}

// ---------------------------------------------------------------------------
// Diagnostic record shape
// ---------------------------------------------------------------------------

interface RecordDiagnostic {
  recordId: string;
  stage: string | undefined;
  attempt: number;
  state: string;
  identityFingerprint: string;
  operation: string;
  runType: string | undefined;
  precheckOk: boolean;
  v2: {
    attempted: boolean;
    derivedClaimId?: string;
    derivedAttemptId?: string;
    derivedLeaseId?: string;
    ok: boolean;
    error?: string;
    recordDurableLeaseId?: string;
  };
  v1: {
    attempted: boolean;
    derivedClaimId?: string;
    derivedAttemptId?: string;
    derivedLeaseId?: string;
    reservationFound: boolean;
    claimKeysFound: string[];
    claimError?: string;
    attemptKeysFound: string[];
    attemptError?: string;
    leasePresentOnRecord: boolean;
    leaseValid: boolean;
    ok: boolean;
    firstFailedCheck?: string;
    allFailedChecks: string[];
  };
  finalVerified: boolean;
  finalVersion: "legacy-terminal-v2" | "legacy-terminal-v1" | "none";
  toleranceTried: boolean;
  toleranceInputs?: {
    latestStateIsCancelled: boolean;
    statesSeen: string[];
    disqualifyingStateSeen: boolean;
    reservationFound: boolean;
    stage: string | undefined;
  };
  toleranceResult?: boolean;
  finalConsumed: boolean;
  failureCategory?: string;
}

function classifyFailure(diag: RecordDiagnostic): string | undefined {
  if (diag.finalVerified) return undefined;
  if (!diag.precheckOk) return "9. reservation mismatch / shape precheck failed (runType|stage|attempt invalid)";
  if (diag.v1.attempted) {
    if (!diag.v1.reservationFound) return "2. claim missing (reservation itself missing for v1 lookup)";
    if (diag.v1.claimError === "CANONICAL_DURABLE_LINEAGE_MISSING") return "2. claim missing";
    if (diag.v1.attemptError === "CANONICAL_DURABLE_LINEAGE_MISSING") return "3. attempt missing";
    if (diag.v1.claimError) return `10. exact predicate: v1 claim readLatestVersioned -> ${diag.v1.claimError}`;
    if (diag.v1.attemptError) return `10. exact predicate: v1 attempt readLatestVersioned -> ${diag.v1.attemptError}`;
    if (!diag.v1.leasePresentOnRecord || !diag.v1.leaseValid) return "4. lease missing / lease invalid";
    if (diag.v1.firstFailedCheck) {
      const c = diag.v1.firstFailedCheck;
      if (c.includes("identity") || c.includes("Id") || c.startsWith("res.") || c.startsWith("record.") ||
        c.startsWith("claim.identity") || c.startsWith("attempt.identity") || c === "workerId" ||
        c === "workerSessionId" || c === "leaseWorkerId" || c === "leaseWorkerSessionId") {
        return `1. identity mismatch (exact predicate: ${c})`;
      }
      if (c.startsWith("resVer") || c.startsWith("leaseVer") || c.startsWith("claimVer")) {
        return `8. version mismatch (exact predicate: ${c})`;
      }
      return `10. exact predicate: ${c}`;
    }
    return "5. terminal state mismatch (post-checks state/consistency assertion)";
  }
  if (diag.v2.attempted && diag.v2.error) {
    if (diag.v2.error === "CANONICAL_DURABLE_RESERVATION_INVALID") return "9. reservation mismatch (v2 reservation invalid)";
    if (diag.v2.error === "CANONICAL_DURABLE_LINEAGE_MISSING") return "2/3. claim or attempt missing (v2)";
    if (diag.v2.error === "CANONICAL_DURABLE_IDENTITY_BINDING_MISMATCH") return "6. authority tuple mismatch (v2 assertIdentity)";
    if (diag.v2.error === "CANONICAL_DURABLE_TERMINAL_STATE_INVALID" || diag.v2.error === "CANONICAL_DURABLE_TERMINAL_STATE_MISMATCH") {
      return "5. terminal state mismatch (v2)";
    }
    if (diag.v2.error === "CANONICAL_DURABLE_RECORD_OR_LEASE_INVALID") return "4. lease missing (v2)";
    return `10. exact predicate: v2 -> ${diag.v2.error}`;
  }
  return "10. unclassified (see raw fields)";
}

async function main() {
  const realRoot = path.join(process.cwd(), "data", "projects", projectSlug, "production-execution");
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-19-record-matrix-"));
  const copyRoot = path.join(tempRoot, "production-execution");
  try {
    await fsp.cp(realRoot, copyRoot, { recursive: true });
    const adapter = new ProductionExecutionFilePersistenceAdapter({
      trustedRootDirectory: copyRoot, createRootDirectory: false,
    });

    // ---- ground truth: run the real, unmodified exported function ----
    const realResultNoContext = await validateProductionGlobalTerminalQuiescence(adapter, projectSlug);
    const context = createRuntimeStorageContext();
    const realResultWithContext = await validateProductionGlobalTerminalQuiescence(
      adapter, projectSlug, undefined, context,
    );
    console.log("=".repeat(100));
    console.log("GROUND TRUTH (real exported validateProductionGlobalTerminalQuiescence, unmodified)");
    console.log("=".repeat(100));
    console.log(`  without toleranceRuntimeInput -> ${realResultNoContext}`);
    console.log(`  with createRuntimeStorageContext() (== real plan callsite)  -> ${realResultWithContext}`);
    console.log(`  context.projectsRoot=${context.projectsRoot}`);
    console.log(`  context.runtimeRoot=${context.runtimeRoot}`);
    console.log();

    // ---- replicate validateProductionGlobalTerminalQuiescence's own scan ----
    const kinds = ["reservation", "idempotency", "claim", "attempt"] as const;
    const keys = new Map<(typeof kinds)[number], readonly string[]>();
    for (const kind of kinds) {
      const listed = await adapter.listKeys(kind);
      if (!listed.ok) { console.log(`FATAL: listKeys(${kind}) failed`); return; }
      keys.set(kind, listed.keys);
    }

    const reservations = new Set<string>();
    const reservationValues = new Map<string, ProductionExecutionIdempotencyReservationRequest>();
    for (const key of keys.get("reservation") ?? []) {
      const read = await adapter.read("reservation", key);
      if (read.status !== "found" || !validateProductionExecutionPersistencePayload("reservation", read.value)) {
        console.log(`FATAL: reservation ${key} invalid/unreadable`); return;
      }
      reservations.add(key);
      reservationValues.set(key, read.value);
    }

    const latestRecords = new Map<string, ProductionExecutionDurableRecord>();
    const recordVersions = new Map<string, number[]>();
    const recordStatesSeen = new Map<string, Set<string>>();
    for (const key of keys.get("idempotency") ?? []) {
      const read = await adapter.read("idempotency", key);
      if (read.status !== "found" || !validateProductionExecutionPersistencePayload("idempotency", read.value)) {
        console.log(`FATAL: idempotency ${key} invalid/unreadable`); return;
      }
      const record = read.value as ProductionExecutionDurableRecord;
      const parsed = parseVersionedKey(key);
      if (!parsed || parsed.identity !== record.recordId || parsed.version !== record.recordVersion ||
        record.projectSlug !== projectSlug) {
        console.log(`FATAL: idempotency ${key} identity/version mismatch`); return;
      }
      recordVersions.set(parsed.identity, [...(recordVersions.get(parsed.identity) ?? []), parsed.version]);
      const states = recordStatesSeen.get(parsed.identity) ?? new Set<string>();
      states.add(record.state);
      recordStatesSeen.set(parsed.identity, states);
      const existing = latestRecords.get(parsed.identity);
      if (!existing || existing.recordVersion < parsed.version) latestRecords.set(parsed.identity, record);
    }

    const nonContiguous = [...recordVersions.entries()].filter(([, v]) => !contiguous(v));
    console.log(`Distinct recordIds (latest-version records): ${latestRecords.size}`);
    console.log(`Non-contiguous version chains: ${nonContiguous.length === 0 ? "NONE" : JSON.stringify(nonContiguous)}`);
    console.log(`Total reservation keys: ${reservations.size}`);
    console.log();

    // ---- per-record loop: continues through ALL records, never stops early ----
    const consumedReservations = new Set<string>();
    const consumedClaims = new Set<string>();
    const consumedAttempts = new Set<string>();
    const diagnostics: RecordDiagnostic[] = [];

    for (const [recordId, record] of [...latestRecords.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const runType = /^pipeline\.stage\.(initial|resume|retry)$/.exec(record.operation)?.[1];
      const precheckOk = Boolean(
        runType && isProductionStepKey(record.stage) &&
        Number.isSafeInteger(record.attempt) && record.attempt >= 1,
      );

      const diag: RecordDiagnostic = {
        recordId, stage: record.stage, attempt: record.attempt, state: record.state,
        identityFingerprint: record.identityFingerprint, operation: record.operation, runType,
        precheckOk,
        v2: { attempted: false, ok: false },
        v1: {
          attempted: false, reservationFound: false, claimKeysFound: [], attemptKeysFound: [],
          leasePresentOnRecord: false, leaseValid: false, ok: false, allFailedChecks: [],
        },
        finalVerified: false, finalVersion: "none",
        toleranceTried: false, finalConsumed: false,
      };

      if (!precheckOk) {
        diagnostics.push(diag);
        diag.failureCategory = classifyFailure(diag);
        continue;
      }

      // ---- v2 attempt (deriveCanonicalIdentityFromRecord + real exported reader) ----
      const v2Identity = deriveCanonicalIdentityFromRecord(record, projectSlug);
      diag.v2.attempted = Boolean(v2Identity);
      diag.v2.recordDurableLeaseId = record.durableLease?.identity.leaseId;
      let verified: { ok: true; claimId: string; attemptId: string; version: "legacy-terminal-v2" | "legacy-terminal-v1" }
        | { ok: false } = { ok: false };

      if (v2Identity) {
        diag.v2.derivedClaimId = v2Identity.claimId;
        diag.v2.derivedAttemptId = v2Identity.attemptId;
        diag.v2.derivedLeaseId = v2Identity.leaseId;
        try {
          await readProductionCanonicalTerminalDurableLineage(
            adapter, v2Identity, record.identityFingerprint, undefined, record.operation,
          );
          diag.v2.ok = true;
          verified = { ok: true, claimId: v2Identity.claimId, attemptId: v2Identity.attemptId, version: "legacy-terminal-v2" };
        } catch (error) {
          diag.v2.ok = false;
          diag.v2.error = error instanceof Error ? error.message : String(error);
        }
      }

      // ---- v1 fallback (only entered if v2 failed, exactly as production code does) ----
      if (!verified.ok) {
        diag.v1.attempted = true;
        const v1Identity = buildVersionedProductionPipelineExecutionIdentity(
          "production-pipeline-identity-v1",
          { projectSlug, stage: record.stage as ProductionStepKey, runType: runType as "initial" | "resume" | "retry" },
          { id: `${projectSlug}-${record.stage}`, attempts: record.attempt - 1 },
        );
        diag.v1.derivedClaimId = v1Identity.claimId;
        diag.v1.derivedAttemptId = v1Identity.attemptId;
        diag.v1.derivedLeaseId = v1Identity.leaseId;

        const reservationRead = await adapter.read("reservation", record.identityFingerprint);
        const reservationOk = reservationRead.status === "found" &&
          validateProductionExecutionPersistencePayload("reservation", reservationRead.value);
        diag.v1.reservationFound = reservationOk;

        if (reservationOk) {
          const reservation = reservationRead.value as ProductionExecutionIdempotencyReservationRequest;
          const claimResult = await readLatestVersionedMirror<ProductionExecutionDurableClaimRecord>(
            adapter, "claim", v1Identity.claimId,
            (v) => validateProductionExecutionPersistencePayload("claim", v) && validateProductionExecutionDurableClaim(v),
            (v) => JSON.stringify({ identity: v.identity, binding: v.binding, ownership: v.ownership }),
          );
          diag.v1.claimKeysFound = claimResult.matchingKeys;
          if ("error" in claimResult) diag.v1.claimError = claimResult.error;

          const attemptResult = await readLatestVersionedMirror<ProductionExecutionDurableAttemptRecord>(
            adapter, "attempt", v1Identity.attemptId,
            (v) => validateProductionExecutionPersistencePayload("attempt", v) && validateProductionExecutionDurableAttempt(v),
            (v) => JSON.stringify({ identity: v.identity, binding: v.binding }),
          );
          diag.v1.attemptKeysFound = attemptResult.matchingKeys;
          if ("error" in attemptResult) diag.v1.attemptError = attemptResult.error;

          if ("value" in claimResult && "value" in attemptResult) {
            const claim = claimResult.value;
            const attempt = attemptResult.value;
            const lease = record.durableLease;
            diag.v1.leasePresentOnRecord = Boolean(lease);
            const recordShapeOk = validateProductionExecutionDurableRecord(record).ok;
            const leaseShapeOk = Boolean(lease && validateProductionExecutionDurableLease(lease));
            diag.v1.leaseValid = leaseShapeOk;

            if (recordShapeOk && lease && leaseShapeOk) {
              const ordinal = v1Identity.core.attemptNumber + 1;
              const checks: [string, boolean][] = [
                ["res.schemaVersion", reservation.schemaVersion === "1"],
                ["res.identity.schemaVersion", reservation.identity.schemaVersion === "1"],
                ["res.identity.identityFingerprint", reservation.identity.identityFingerprint === record.identityFingerprint],
                ["res.identity.projectSlug", reservation.identity.projectSlug === v1Identity.core.projectSlug],
                ["res.identity.stage", reservation.identity.stage === v1Identity.core.stage],
                ["res.identity.operation", reservation.identity.operation === record.operation],
                ["res.identity.requestId", reservation.identity.requestId === v1Identity.requestId],
                ["res.identity.idempotencyKey", reservation.identity.idempotencyKey === v1Identity.idempotencyKey],
                ["res.identity.executionFingerprint", reservation.identity.executionFingerprint === v1Identity.executionFingerprint],
                ["res.attempt", reservation.attempt === ordinal],
                ["record.schemaVersion", record.schemaVersion === "1"],
                ["record.storageVersion", record.storageVersion === "1"],
                ["record.projectSlug", record.projectSlug === v1Identity.core.projectSlug],
                ["record.stage", record.stage === v1Identity.core.stage],
                ["record.recordId", record.recordId === v1Identity.recordId],
                ["record.requestId", record.requestId === v1Identity.requestId],
                ["record.idempotencyKey", record.idempotencyKey === v1Identity.idempotencyKey],
                ["record.executionFingerprint", record.executionFingerprint === v1Identity.executionFingerprint],
                ["record.attempt", record.attempt === ordinal],
                ["lease.schemaVersion", lease.schemaVersion === "1"],
                ["lease.identity.leaseId", lease.identity.leaseId === v1Identity.leaseId],
                ["lease.identity.recordId", lease.identity.recordId === v1Identity.recordId],
                ["lease.identity.requestId", lease.identity.requestId === v1Identity.requestId],
                ["lease.identity.idempotencyKey", lease.identity.idempotencyKey === v1Identity.idempotencyKey],
                ["lease.identity.executionFingerprint", lease.identity.executionFingerprint === v1Identity.executionFingerprint],
                ["claim.schemaVersion", claim.schemaVersion === "1"],
                ["claim.storageVersion", claim.storageVersion === "1"],
                ["claim.identity.claimId", claim.identity.claimId === v1Identity.claimId],
                ["claim.identity.recordId", claim.identity.recordId === v1Identity.recordId],
                ["claim.identity.reservationId", claim.identity.reservationId === record.identityFingerprint],
                ["claim.identity.requestId", claim.identity.requestId === v1Identity.requestId],
                ["claim.identity.idempotencyKey", claim.identity.idempotencyKey === v1Identity.idempotencyKey],
                ["claim.identity.executionFingerprint", claim.identity.executionFingerprint === v1Identity.executionFingerprint],
                ["claim.identity.leaseId", claim.identity.leaseId === v1Identity.leaseId],
                ["claim.identity.operation", (claim.identity as unknown as Record<string, unknown>).operation === undefined],
                ["attempt.schemaVersion", attempt.schemaVersion === "1"],
                ["attempt.storageVersion", attempt.storageVersion === "1"],
                ["attempt.identity.attemptId", attempt.identity.attemptId === v1Identity.attemptId],
                ["attempt.identity.claimId", attempt.identity.claimId === v1Identity.claimId],
                ["attempt.identity.recordId", attempt.identity.recordId === v1Identity.recordId],
                ["attempt.identity.reservationId", attempt.identity.reservationId === record.identityFingerprint],
                ["attempt.identity.requestId", attempt.identity.requestId === v1Identity.requestId],
                ["attempt.identity.idempotencyKey", attempt.identity.idempotencyKey === v1Identity.idempotencyKey],
                ["attempt.identity.executionFingerprint", attempt.identity.executionFingerprint === v1Identity.executionFingerprint],
                ["attempt.identity.leaseId", attempt.identity.leaseId === v1Identity.leaseId],
                ["attempt.identity.operation", (attempt.identity as unknown as Record<string, unknown>).operation === undefined],
                ["workerId", claim.identity.workerId === attempt.identity.workerId],
                ["workerSessionId", claim.identity.workerSessionId === attempt.identity.workerSessionId],
                ["leaseWorkerId", lease.identity.workerId === claim.identity.workerId],
                ["leaseWorkerSessionId", lease.identity.workerSessionId === claim.identity.workerSessionId],
                ["resVer", claim.binding.reservationVersion === attempt.binding.reservationVersion],
                ["leaseVer", claim.binding.leaseVersion === attempt.binding.leaseVersion],
                ["claimVer", attempt.binding.claimVersion <= claim.claimVersion],
              ];
              diag.v1.allFailedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
              diag.v1.firstFailedCheck = diag.v1.allFailedChecks[0];

              const terminalOk = isProductionExecutionTerminalDurableRecordState(record.state) &&
                lease.status === "released" &&
                ["released", "abandoned"].includes(claim.state) &&
                isProductionExecutionTerminalAttemptState(attempt.state);
              const consistent = terminalOk && (
                (attempt.state === "succeeded" && record.state === "succeeded" && claim.state === "released") ||
                (["failed", "cancelled", "abandoned"].includes(attempt.state) &&
                  ["failed", "cancelled", "partially-succeeded"].includes(record.state) &&
                  claim.state === "abandoned")
              );
              if (diag.v1.allFailedChecks.length === 0 && !terminalOk) {
                diag.v1.allFailedChecks.push("TERMINAL_STATE_INVALID");
                diag.v1.firstFailedCheck = "TERMINAL_STATE_INVALID";
              } else if (diag.v1.allFailedChecks.length === 0 && !consistent) {
                diag.v1.allFailedChecks.push("TERMINAL_STATE_MISMATCH");
                diag.v1.firstFailedCheck = "TERMINAL_STATE_MISMATCH";
              }
              diag.v1.ok = diag.v1.allFailedChecks.length === 0;
              if (diag.v1.ok) {
                verified = { ok: true, claimId: v1Identity.claimId, attemptId: v1Identity.attemptId, version: "legacy-terminal-v1" };
              }
            }
          }
        }
      }

      diag.finalVerified = verified.ok;
      diag.finalVersion = verified.ok ? verified.version : "none";
      diagnostics.push(diag);

      if (verified.ok) {
        consumedReservations.add(record.identityFingerprint);
        consumedClaims.add(verified.claimId);
        consumedAttempts.add(verified.attemptId);
        diag.finalConsumed = true;
      } else {
        // ---- tolerateCancelledOrphanRecord mirror ----
        diag.toleranceTried = true;
        const statesSeen = recordStatesSeen.get(record.recordId) ?? new Set<string>();
        const reservation = reservationValues.get(record.identityFingerprint);
        const stage = reservation?.identity.stage;
        const disqualifying = statesSeen.has("running") || statesSeen.has("succeeded") ||
          statesSeen.has("partially-succeeded");
        diag.toleranceInputs = {
          latestStateIsCancelled: record.state === "cancelled",
          statesSeen: [...statesSeen],
          disqualifyingStateSeen: disqualifying,
          reservationFound: Boolean(reservation),
          stage,
        };
        let tolerated = false;
        if (record.state === "cancelled" && !disqualifying && reservation && stage && isProductionStepKey(stage)) {
          tolerated = await resolveOrphanReservationTolerance(adapter, reservation, {
            projectSlug, stage, jobId: `${projectSlug}-${stage}`, runtimeInput: context,
          });
        }
        diag.toleranceResult = tolerated;
        if (tolerated) {
          consumedReservations.add(record.identityFingerprint);
          diag.finalConsumed = true;
        }
      }

      diag.failureCategory = diag.finalConsumed ? undefined : classifyFailure(diag);
    }

    // ---- print the 19-record matrix ----
    console.log("=".repeat(100));
    console.log("19-RECORD FULL MATRIX");
    console.log("=".repeat(100));
    for (const d of diagnostics) {
      const marker = d.recordId === RECORD_A ? " <<< RECORD A"
        : d.recordId === RECORD_B ? " <<< RECORD B" : "";
      console.log(`\n--- recordId=${d.recordId}${marker} ---`);
      console.log(`  stage=${d.stage} attempt=${d.attempt} state=${d.state} operation=${d.operation} runType=${d.runType}`);
      console.log(`  identityFingerprint=${d.identityFingerprint}`);
      console.log(`  precheckOk=${d.precheckOk}`);
      console.log(`  v2: attempted=${d.v2.attempted} ok=${d.v2.ok} error=${d.v2.error ?? "-"}`);
      console.log(`      derivedClaimId=${d.v2.derivedClaimId ?? "-"} derivedAttemptId=${d.v2.derivedAttemptId ?? "-"} derivedLeaseId=${d.v2.derivedLeaseId ?? "-"}`);
      console.log(`      record.durableLease.identity.leaseId=${d.v2.recordDurableLeaseId ?? "-"}`);
      if (d.v1.attempted) {
        console.log(`  v1: reservationFound=${d.v1.reservationFound} ok=${d.v1.ok}`);
        console.log(`      derivedClaimId=${d.v1.derivedClaimId} derivedAttemptId=${d.v1.derivedAttemptId} derivedLeaseId=${d.v1.derivedLeaseId}`);
        console.log(`      claimKeysFound=[${d.v1.claimKeysFound.join(", ") || "NONE"}] claimError=${d.v1.claimError ?? "-"}`);
        console.log(`      attemptKeysFound=[${d.v1.attemptKeysFound.join(", ") || "NONE"}] attemptError=${d.v1.attemptError ?? "-"}`);
        console.log(`      leasePresentOnRecord=${d.v1.leasePresentOnRecord} leaseValid=${d.v1.leaseValid}`);
        console.log(`      firstFailedCheck=${d.v1.firstFailedCheck ?? "-"}`);
        console.log(`      allFailedChecks=[${d.v1.allFailedChecks.join(", ") || "NONE"}]`);
      } else {
        console.log("  v1: not attempted (v2 succeeded or precheck failed)");
      }
      console.log(`  finalVerified=${d.finalVerified} finalVersion=${d.finalVersion}`);
      console.log(`  toleranceTried=${d.toleranceTried} toleranceResult=${d.toleranceResult ?? "-"}`);
      if (d.toleranceInputs) {
        console.log(`      toleranceInputs=${JSON.stringify(d.toleranceInputs)}`);
      }
      console.log(`  finalConsumed=${d.finalConsumed}`);
      if (d.failureCategory) console.log(`  FAILURE CATEGORY: ${d.failureCategory}`);
    }

    // ---- Record A / Record B explicit summary ----
    console.log("\n" + "=".repeat(100));
    console.log("RECORD A / RECORD B EXPLICIT RESULT");
    console.log("=".repeat(100));
    for (const [label, id] of [["RECORD A", RECORD_A], ["RECORD B", RECORD_B]] as const) {
      const d = diagnostics.find((x) => x.recordId === id);
      if (!d) { console.log(`${label} (${id}): NOT FOUND among latest idempotency records`); continue; }
      console.log(`${label} (${id}): finalVerified=${d.finalVerified} finalVersion=${d.finalVersion} ` +
        `finalConsumed=${d.finalConsumed} failureCategory=${d.failureCategory ?? "NONE (passed)"}`);
    }

    // ---- sameSet(reservations, consumedReservations) stage ----
    console.log("\n" + "=".repeat(100));
    console.log("sameSet(reservations, consumedReservations) STAGE");
    console.log("=".repeat(100));
    console.log(`reservations.size=${reservations.size} consumedReservations.size(after per-record loop)=${consumedReservations.size}`);
    const preSweepMatch = sameSet(reservations, consumedReservations);
    console.log(`sameSet BEFORE final orphan-reservation sweep: ${preSweepMatch}`);

    const unconsumedAfterLoop = [...reservations].filter((k) => !consumedReservations.has(k));
    console.log(`Reservations NOT consumed by per-record loop (${unconsumedAfterLoop.length}):`);
    const finalConsumedReservations = new Set(consumedReservations);
    for (const key of unconsumedAfterLoop) {
      const reservation = reservationValues.get(key);
      const hasIdempotencyRecord = [...latestRecords.values()].some((r) => r.identityFingerprint === key);
      let sweepTolerated: boolean | "not-attempted" = "not-attempted";
      if (reservation) {
        const stage = reservation.identity.stage;
        if (isProductionStepKey(stage)) {
          sweepTolerated = await resolveOrphanReservationTolerance(adapter, reservation, {
            projectSlug, stage, jobId: `${projectSlug}-${stage}`, runtimeInput: context,
          });
          if (sweepTolerated) finalConsumedReservations.add(key);
        }
      }
      console.log(`  - reservationId=${key} stage=${reservation?.identity.stage ?? "?"} ` +
        `operation=${reservation?.identity.operation ?? "?"} attempt=${reservation?.attempt ?? "?"} ` +
        `hasMatchingIdempotencyRecord(any version)=${hasIdempotencyRecord} finalSweepTolerated=${sweepTolerated}`);
    }
    const finalSameSet = sameSet(reservations, finalConsumedReservations);
    console.log(`sameSet AFTER final orphan-reservation sweep: ${finalSameSet}`);

    // ---- unconsumedClaim / unconsumedAttempt ----
    console.log("\n" + "=".repeat(100));
    console.log("unconsumedClaim / unconsumedAttempt STAGE");
    console.log("=".repeat(100));
    const unconsumedClaimKeys = (keys.get("claim") ?? []).filter((k) => {
      const p = parseVersionedKey(k);
      return !p || !consumedClaims.has(p.identity);
    });
    const unconsumedAttemptKeys = (keys.get("attempt") ?? []).filter((k) => {
      const p = parseVersionedKey(k);
      return !p || !consumedAttempts.has(p.identity);
    });
    console.log(`Total claim keys=${(keys.get("claim") ?? []).length} consumedClaims.size=${consumedClaims.size}`);
    console.log(`Unconsumed claim keys (${unconsumedClaimKeys.length}): [${unconsumedClaimKeys.join(", ") || "NONE"}]`);
    console.log(`Total attempt keys=${(keys.get("attempt") ?? []).length} consumedAttempts.size=${consumedAttempts.size}`);
    console.log(`Unconsumed attempt keys (${unconsumedAttemptKeys.length}): [${unconsumedAttemptKeys.join(", ") || "NONE"}]`);

    // ---- overall replica verdict vs ground truth ----
    console.log("\n" + "=".repeat(100));
    console.log("REPLICA VERDICT (this diagnostic's own re-derivation, informational only)");
    console.log("=".repeat(100));
    const allRecordsVerifiedOrConsumed = diagnostics.every((d) => d.finalConsumed);
    const replicaVerdict = allRecordsVerifiedOrConsumed && finalSameSet &&
      unconsumedClaimKeys.length === 0 && unconsumedAttemptKeys.length === 0;
    console.log(`allRecordsVerifiedOrConsumed=${allRecordsVerifiedOrConsumed}`);
    console.log(`finalSameSet=${finalSameSet}`);
    console.log(`unconsumedClaimKeys.length===0=${unconsumedClaimKeys.length === 0}`);
    console.log(`unconsumedAttemptKeys.length===0=${unconsumedAttemptKeys.length === 0}`);
    console.log(`replicaVerdict=${replicaVerdict} (compare to GROUND TRUTH with-context result above: ${realResultWithContext})`);
    if (replicaVerdict !== realResultWithContext) {
      console.log("  !! REPLICA/GROUND-TRUTH DIVERGENCE — replica does not exactly match production algorithm; " +
        "treat per-record detail above as directional only for whichever record(s) diverge.");
    }

    const failing = diagnostics.filter((d) => !d.finalConsumed);
    console.log(`\nRecords still failing after tolerance (${failing.length}): ` +
      `[${failing.map((d) => d.recordId).join(", ") || "NONE"}]`);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("DIAGNOSTIC ERROR:", error);
  process.exitCode = 1;
});
