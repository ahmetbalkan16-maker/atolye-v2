import type { ProductionExecutionDurableAttemptRecord } from "@/types/productionExecutionDurableAttempt";
import type { ProductionExecutionDurableClaimRecord } from "@/types/productionExecutionDurableClaim";
import type { ProductionExecutionIdempotencyReservationRequest } from "@/types/productionExecutionIdempotency";
import type {
  ProductionExecutionPersistenceAdapter,
  ProductionExecutionPersistenceRecordKind,
} from "@/types/productionExecutionPersistence";
import type { ProductionExecutionDurableRecord } from "@/types/productionExecutionDurableStorage";
import type { ProductionStepKey } from "@/types/project";
import {
  isProductionExecutionTerminalAttemptState,
  validateProductionExecutionDurableAttempt,
} from "./ProductionExecutionDurableAttempt";
import { validateProductionExecutionDurableClaim } from "./ProductionExecutionDurableClaim";
import { validateProductionExecutionDurableLease } from "./ProductionExecutionDurableLease";
import {
  isProductionExecutionTerminalDurableRecordState,
  validateProductionExecutionDurableRecord,
} from "./ProductionExecutionDurableStorage";
import { validateProductionExecutionPersistencePayload } from "./ProductionExecutionPersistence";
import { readProductionCanonicalTerminalDurableLineage } from "./ProductionCanonicalDurableLineage";
import { buildProductionPipelineExecutionIdentity } from "./ProductionPipelineExecutionIdentity";
import {
  buildVersionedProductionPipelineExecutionIdentity,
} from "./ProductionLegacyPipelineExecutionIdentity";

export type QuiescenceLineageIdentityVersion =
  | "strict-target-v2"
  | "legacy-terminal-v1"
  | "legacy-terminal-v2";

/**
 * Validates complete project durable store and proves global quiescence:
 * Proves there are no active, open, reserved, consuming, running, orphan,
 * ambiguous, malformed, corrupt, or foreign durable authorities.
 */
export async function validateProductionGlobalTerminalQuiescence(
  adapter: ProductionExecutionPersistenceAdapter,
  projectSlug: string,
  targetIdentity?: ReturnType<typeof buildProductionPipelineExecutionIdentity>,
): Promise<boolean> {
  try {
    const kinds = ["reservation", "idempotency", "claim", "attempt"] as const;
    const keys = new Map<(typeof kinds)[number], readonly string[]>();
    for (const kind of kinds) {
      const listed = await adapter.listKeys(kind);
      if (!listed.ok) return false;
      keys.set(kind, listed.keys);
    }

    const reservations = new Set<string>();
    for (const key of keys.get("reservation") ?? []) {
      const read = await adapter.read("reservation", key);
      if (
        read.status !== "found" ||
        !validateProductionExecutionPersistencePayload("reservation", read.value) ||
        key !== read.value.identity.identityFingerprint ||
        read.value.identity.projectSlug !== projectSlug
      ) {
        return false;
      }
      reservations.add(key);
    }

    const latestRecords = new Map<string, ProductionExecutionDurableRecord>();
    const recordVersions = new Map<string, number[]>();
    for (const key of keys.get("idempotency") ?? []) {
      const read = await adapter.read("idempotency", key);
      if (
        read.status !== "found" ||
        !validateProductionExecutionPersistencePayload("idempotency", read.value)
      ) {
        return false;
      }
      const record = read.value as ProductionExecutionDurableRecord;
      const parsed = parseVersionedKey(key);
      if (
        !parsed ||
        parsed.identity !== record.recordId ||
        parsed.version !== record.recordVersion ||
        record.projectSlug !== projectSlug
      ) {
        return false;
      }
      recordVersions.set(parsed.identity, [
        ...(recordVersions.get(parsed.identity) ?? []),
        parsed.version,
      ]);
      const existing = latestRecords.get(parsed.identity);
      if (!existing || existing.recordVersion < parsed.version) {
        latestRecords.set(parsed.identity, record);
      }
    }

    if ([...recordVersions.values()].some((versions) => !contiguous(versions))) {
      return false;
    }

    if (targetIdentity) {
      const maxStageIndex = Math.max(
        ...[...latestRecords.values()].map((r) =>
          PRODUCTION_STEP_ORDER.indexOf(r.stage as ProductionStepKey)
        )
      );
      const targetStageIndex = PRODUCTION_STEP_ORDER.indexOf(targetIdentity.core.stage);
      if (targetStageIndex < maxStageIndex) {
        return false;
      }
    }

    const consumedReservations = new Set<string>();
    const consumedClaims = new Set<string>();
    const consumedAttempts = new Set<string>();
    let targetFound = false;

    for (const record of latestRecords.values()) {
      const runType = /^pipeline\.stage\.(initial|resume|retry)$/.exec(record.operation)?.[1];
      if (
        !runType ||
        !isProductionStepKey(record.stage) ||
        !Number.isSafeInteger(record.attempt) ||
        record.attempt < 1
      ) {
        return false;
      }

      const isTarget = Boolean(targetIdentity && record.recordId === targetIdentity.recordId);

      if (isTarget && targetIdentity) {
        targetFound = true;
        // Target lineage MUST pass strict current v2 canonical lineage reader ONLY.
        try {
          await readProductionCanonicalTerminalDurableLineage(
            adapter,
            targetIdentity,
            record.identityFingerprint,
            undefined,
            record.operation,
          );
        } catch {
          return false;
        }
        consumedReservations.add(record.identityFingerprint);
        consumedClaims.add(targetIdentity.claimId);
        consumedAttempts.add(targetIdentity.attemptId);
      } else {
        // Historical terminal lineages are validated via versioned legacy verifier.
        const verified = await verifyTerminalLineageVersioned(
          adapter,
          projectSlug,
          record,
          runType as "initial" | "resume" | "retry",
        );
        if (!verified.ok) return false;
        consumedReservations.add(record.identityFingerprint);
        consumedClaims.add(verified.claimId);
        consumedAttempts.add(verified.attemptId);
      }
    }

    if (targetIdentity && !targetFound) {
      return false;
    }

    if (!sameSet(reservations, consumedReservations)) {
      return false;
    }

    const unconsumedClaim = (keys.get("claim") ?? []).find(k => {
      const p = parseVersionedKey(k);
      return !p || !consumedClaims.has(p.identity);
    });
    const unconsumedAttempt = (keys.get("attempt") ?? []).find(k => {
      const p = parseVersionedKey(k);
      return !p || !consumedAttempts.has(p.identity);
    });

    if (unconsumedClaim || unconsumedAttempt) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function verifyTerminalLineageVersioned(
  adapter: ProductionExecutionPersistenceAdapter,
  projectSlug: string,
  record: ProductionExecutionDurableRecord,
  runType: "initial" | "resume" | "retry",
): Promise<{ ok: boolean; claimId: string; attemptId: string; version: QuiescenceLineageIdentityVersion }> {
  // Try strict v2 first
  const currentIdentity = buildProductionPipelineExecutionIdentity(
    { projectSlug, stage: record.stage as ProductionStepKey, runType },
    { id: `${projectSlug}-${record.stage}`, attempts: record.attempt - 1 },
  );

  try {
    await readProductionCanonicalTerminalDurableLineage(
      adapter,
      currentIdentity,
      record.identityFingerprint,
      undefined,
      record.operation,
    );
    return {
      ok: true,
      claimId: currentIdentity.claimId,
      attemptId: currentIdentity.attemptId,
      version: "legacy-terminal-v2",
    };
  } catch {
    // Fall through to v1 validation if strict v2 fails
  }

  // Exact versioned legacy v1 validation
  const v1Identity = buildVersionedProductionPipelineExecutionIdentity(
    "production-pipeline-identity-v1",
    { projectSlug, stage: record.stage as ProductionStepKey, runType },
    { id: `${projectSlug}-${record.stage}`, attempts: record.attempt - 1 },
  );

  const reservationRead = await adapter.read("reservation", record.identityFingerprint);
  if (
    reservationRead.status !== "found" ||
    !validateProductionExecutionPersistencePayload("reservation", reservationRead.value)
  ) {
    return { ok: false, claimId: "", attemptId: "", version: "legacy-terminal-v1" };
  }
  const reservation = reservationRead.value as ProductionExecutionIdempotencyReservationRequest;

  let claim: ProductionExecutionDurableClaimRecord;
  let attempt: ProductionExecutionDurableAttemptRecord;
  try {
    claim = await readLatestVersioned<ProductionExecutionDurableClaimRecord>(
      adapter,
      "claim",
      v1Identity.claimId,
      (value) =>
        validateProductionExecutionPersistencePayload("claim", value) &&
        validateProductionExecutionDurableClaim(value),
      (value) =>
        JSON.stringify({
          identity: value.identity,
          binding: value.binding,
          ownership: value.ownership,
        }),
    );

    attempt = await readLatestVersioned<ProductionExecutionDurableAttemptRecord>(
      adapter,
      "attempt",
      v1Identity.attemptId,
      (value) =>
        validateProductionExecutionPersistencePayload("attempt", value) &&
        validateProductionExecutionDurableAttempt(value),
      (value) => JSON.stringify({ identity: value.identity, binding: value.binding }),
    );
  } catch {
    return { ok: false, claimId: "", attemptId: "", version: "legacy-terminal-v1" };
  }

  const lease = record.durableLease;
  if (!validateProductionExecutionDurableRecord(record).ok || !lease || !validateProductionExecutionDurableLease(lease)) {
    return { ok: false, claimId: "", attemptId: "", version: "legacy-terminal-v1" };
  }

  // Assert exact v1 identity bindings
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

  const failedCheck = checks.find(([, ok]) => !ok);
  if (failedCheck) {
    return { ok: false, claimId: "", attemptId: "", version: "legacy-terminal-v1" };
  }

  // Assert terminal state consistency
  if (
    !isProductionExecutionTerminalDurableRecordState(record.state) ||
    lease.status !== "released" ||
    !["released", "abandoned"].includes(claim.state) ||
    !isProductionExecutionTerminalAttemptState(attempt.state)
  ) {
    return { ok: false, claimId: "", attemptId: "", version: "legacy-terminal-v1" };
  }

  const consistent =
    (attempt.state === "succeeded" && record.state === "succeeded" && claim.state === "released") ||
    (["failed", "cancelled", "abandoned"].includes(attempt.state) &&
      ["failed", "cancelled", "partially-succeeded"].includes(record.state) &&
      claim.state === "abandoned");

  if (!consistent) {
    return { ok: false, claimId: "", attemptId: "", version: "legacy-terminal-v1" };
  }

  return {
    ok: true,
    claimId: v1Identity.claimId,
    attemptId: v1Identity.attemptId,
    version: "legacy-terminal-v1",
  };
}

async function readLatestVersioned<T>(
  adapter: ProductionExecutionPersistenceAdapter,
  kind: Extract<ProductionExecutionPersistenceRecordKind, "idempotency" | "claim" | "attempt">,
  identity: string,
  validate: (value: unknown) => boolean,
  immutableIdentity: (value: T) => string,
): Promise<T> {
  const listed = await adapter.listKeys(kind);
  if (!listed.ok) throw new Error("CANONICAL_DURABLE_LIST_FAILED");
  const expression = new RegExp(`^${escapeRegularExpression(identity)}-v([1-9][0-9]*)$`);
  const versions = listed.keys
    .map((key) => ({ key, match: expression.exec(key) }))
    .filter((item): item is { key: string; match: RegExpExecArray } => item.match !== null)
    .map((item) => ({ key: item.key, version: Number(item.match[1]) }))
    .sort((left, right) => left.version - right.version);
  if (versions.length === 0) throw new Error("CANONICAL_DURABLE_LINEAGE_MISSING");
  let latest: T | undefined;
  let immutable: string | undefined;
  for (let index = 0; index < versions.length; index += 1) {
    if (versions[index].version !== index + 1) {
      throw new Error("CANONICAL_DURABLE_VERSION_GAP");
    }
    const read = await adapter.read(kind, versions[index].key);
    if (read.status !== "found" || !validate(read.value)) {
      throw new Error("CANONICAL_DURABLE_VERSION_INVALID");
    }
    const value = read.value as T;
    const durableVersion =
      kind === "idempotency"
        ? (value as ProductionExecutionDurableRecord).recordVersion
        : kind === "claim"
          ? (value as ProductionExecutionDurableClaimRecord).claimVersion
          : (value as ProductionExecutionDurableAttemptRecord).attemptVersion;
    if (durableVersion !== versions[index].version) {
      throw new Error("CANONICAL_DURABLE_KEY_VERSION_MISMATCH");
    }
    const currentImmutable = immutableIdentity(value);
    if (immutable !== undefined && currentImmutable !== immutable) {
      throw new Error("CANONICAL_DURABLE_IMMUTABLE_IDENTITY_CHANGED");
    }
    immutable = currentImmutable;
    latest = value;
  }
  if (!latest) throw new Error("CANONICAL_DURABLE_LINEAGE_MISSING");
  return latest;
}

function parseVersionedKey(key: string) {
  const match = /^(.*)-v([1-9][0-9]*)$/.exec(key);
  if (!match) return undefined;
  const version = Number(match[2]);
  return Number.isSafeInteger(version) ? { identity: match[1], version } : undefined;
}

function contiguous(versions: number[]): boolean {
  versions.sort((left, right) => left - right);
  return versions.every((version, index) => version === index + 1);
}


function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

const PRODUCTION_STEP_ORDER: readonly ProductionStepKey[] = [
  "research",
  "script",
  "scenes",
  "visuals",
  "animation",
  "video",
  "audio",
  "assembly",
  "thumbnail",
  "seo",
  "youtube",
  "export",
];

const productionStepKeys = new Set<string>(PRODUCTION_STEP_ORDER);

function isProductionStepKey(value: unknown): value is ProductionStepKey {
  return typeof value === "string" && productionStepKeys.has(value);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
