import type { ProductionExecutionDurableAttemptRecord } from
  "@/types/productionExecutionDurableAttempt";
import type { ProductionExecutionDurableClaimRecord } from
  "@/types/productionExecutionDurableClaim";
import type { ProductionExecutionIdempotencyRecord } from
  "@/types/productionExecutionIdempotency";
import type { ProductionExecutionPersistenceAdapter } from
  "@/types/productionExecutionPersistence";
import type { ProductionExecutionDurableRecord } from
  "@/types/productionExecutionDurableStorage";
import type { ProductionStepKey } from "@/types/project";
import type { ProductionAcceptanceStageExecutionIdentity } from
  "./ProductionAcceptancePolicy";
import { validateProductionExecutionDurableAttempt } from "./ProductionExecutionDurableAttempt";
import { validateProductionExecutionDurableClaim } from "./ProductionExecutionDurableClaim";
import { AdapterBackedProductionExecutionDurableStorage,
  isProductionExecutionTerminalDurableRecordState } from
  "./ProductionExecutionDurableStorage";
import { buildProductionPipelineExecutionIdentity } from
  "./ProductionPipelineExecutionIdentity";
import type { ProductionDurableAttemptLineageBoundary } from
  "./ProductionDurableAttemptLineageBoundary";
import { isProductionExecutionTerminalAttemptState } from "./ProductionExecutionDurableAttempt";

export type ProductionDurableAttemptLineageClassification =
  | { readonly status: "none"; readonly durableOrdinal: 0 }
  | {
    readonly status: "valid";
    readonly durableOrdinal: number;
    readonly maximumRecordAttempt: number;
    readonly latestAttempt: ProductionExecutionDurableAttemptRecord;
  }
  | { readonly status: "invalid"; readonly boundary: ProductionDurableAttemptLineageBoundary };

/** @internal Shared read-only classifier for preparation and retry reconciliation. */
export async function classifyProductionDurableAttemptLineage(
  adapter: ProductionExecutionPersistenceAdapter,
  projectSlug: string,
  stage: string,
  expectedJobAttempt: number,
  mode: "preparation" | "exact" = "preparation",
): Promise<ProductionDurableAttemptLineageClassification> {
  const [recordKeys, claimKeys, attemptKeys] = await Promise.all([
    adapter.listKeys("idempotency"),
    adapter.listKeys("claim"),
    adapter.listKeys("attempt"),
  ]);
  if (!recordKeys.ok) return invalid("idempotency-list");
  if (!claimKeys.ok) return invalid("claim-list");
  if (!attemptKeys.ok) return invalid("attempt-list");

  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);
  const records = new Map<string, Array<{ version: number;
    value: ProductionExecutionIdempotencyRecord }>>();
  const recordCount = await readApplicableRecords(
    adapter, storage, recordKeys.keys, projectSlug, stage, records,
  );
  if (typeof recordCount === "string") return invalid(recordCount);

  const claims = new Map<string, Array<{ version: number;
    value: ProductionExecutionDurableClaimRecord }>>();
  const attempts = new Map<string, Array<{ version: number;
    value: ProductionExecutionDurableAttemptRecord }>>();
  const scanLimit = Math.max(expectedJobAttempt + 3, recordKeys.keys.length + claimKeys.keys.length +
    attemptKeys.keys.length + 1);
  const plans = buildLineagePlans(projectSlug, stage, scanLimit);
  const claimRead = await readApplicableClaims(adapter, claimKeys.keys, plans.claimIds, claims);
  if (claimRead) return invalid(claimRead);
  const attemptRead = await readApplicableAttempts(adapter, attemptKeys.keys, plans.attemptIds, attempts);
  if (attemptRead) return invalid(attemptRead);

  if (records.size === 0) {
    if (claims.size > 0 || attempts.size > 0) return invalid("orphan-lineage");
    if (expectedJobAttempt !== 0) return invalid("no-applicable-lineage");
    return { status: "none", durableOrdinal: 0 };
  }

  const recordValues: ProductionExecutionIdempotencyRecord[] = [];
  for (const versions of records.values()) {
    const latest = exactLatestLineageVersion(versions, "version-contiguity");
    if (!latest.ok) return invalid(latest.boundary);
    recordValues.push(latest.value);
  }
  const maximum = Math.max(...recordValues.map((record) => record.attempt));
  if (recordValues.length !== maximum) return invalid("lineage-cardinality");
  recordValues.sort((left, right) => left.attempt - right.attempt);
  for (let index = 0; index < recordValues.length; index += 1) {
    if (recordValues[index].attempt !== index + 1) return invalid("record-ordinal-topology");
  }

  const lineagePlans = new Map<string, { record: ProductionExecutionIdempotencyRecord;
    planned: ReturnType<typeof buildProductionPipelineExecutionIdentity> }>();
  for (const record of recordValues) {
    const runType = durableLineageRunType(record.operation);
    if (!runType) return invalid("record-operation-format");
    const planned = buildProductionPipelineExecutionIdentity(
      { projectSlug, stage: stage as ProductionStepKey, runType },
      { id: `${projectSlug}-${stage}`, attempts: record.attempt - 1 },
    );
    const recordBoundary = recordBindingBoundary(record, planned);
    if (recordBoundary) return invalid(recordBoundary);
    if (lineagePlans.has(planned.attemptId)) return invalid("duplicate-attempt-plan");
    lineagePlans.set(planned.attemptId, { record, planned });
  }

  let latestAttempt: ProductionExecutionDurableAttemptRecord | undefined;
  const lineageClaims = new Set<string>();
  const lineageAttempts = new Set<string>();
  for (const { record, planned } of lineagePlans.values()) {
    const claimVersions = claims.get(planned.claimId);
    if (!claimVersions) return invalid("claim-lineage-missing");
    const latestClaim = exactLatestLineageVersion(claimVersions, "version-contiguity");
    if (!latestClaim.ok) return invalid(latestClaim.boundary);
    const claim = latestClaim.value;
    if (!validateProductionExecutionDurableClaim(claim)) return invalid("claim-integrity");
    const claimBoundary = claimBindingBoundary(claim, record, planned);
    if (claimBoundary) return invalid(claimBoundary);
    lineageClaims.add(planned.claimId);

    const attemptVersions = attempts.get(planned.attemptId);
    if (!attemptVersions) return invalid("attempt-lineage-missing");
    const latest = exactLatestLineageVersion(attemptVersions, "version-contiguity");
    if (!latest.ok) return invalid(latest.boundary);
    const attempt = latest.value;
    if (!validateProductionExecutionDurableAttempt(attempt)) return invalid("attempt-integrity");
    const attemptBoundary = attemptBindingBoundary(attempt, record, planned);
    if (attemptBoundary) return invalid(attemptBoundary);
    lineageAttempts.add(planned.attemptId);
    if (record.attempt === maximum) latestAttempt = attempt;
  }

  if (!latestAttempt || lineageClaims.size !== recordValues.length ||
    lineageAttempts.size !== recordValues.length) return invalid("lineage-inventory");
  if (claims.size !== lineageClaims.size || attempts.size !== lineageAttempts.size) {
    return invalid("orphan-lineage");
  }
  const exactOrdinal = maximum - 1;
  const nextRequired = latestAttempt.state === "failed" || latestAttempt.state === "cancelled" ||
    latestAttempt.state === "abandoned";
  const durableOrdinal = mode === "exact" ? exactOrdinal : nextRequired ? maximum : exactOrdinal;
  if (expectedJobAttempt !== durableOrdinal) return invalid("expected-attempt-ordinal");
  return { status: "valid", durableOrdinal, maximumRecordAttempt: maximum, latestAttempt };
}

function invalid(
  boundary: ProductionDurableAttemptLineageBoundary,
): ProductionDurableAttemptLineageClassification {
  return { status: "invalid", boundary };
}

async function readApplicableRecords(
  adapter: ProductionExecutionPersistenceAdapter,
  storage: AdapterBackedProductionExecutionDurableStorage,
  keys: readonly string[],
  projectSlug: string,
  stage: string,
  records: Map<string, Array<{ version: number; value: ProductionExecutionIdempotencyRecord }>>,
): Promise<number | ProductionDurableAttemptLineageBoundary> {
  let count = 0;
  for (const key of keys) {
    const read = await adapter.read("idempotency", key);
    if (read.status !== "found") {
      return read.status === "failed" && read.errorCode === "PERSISTENCE_RECORD_CORRUPT"
        ? "record-integrity"
        : "record-read";
    }
    const record = read.value;
    if (record.projectSlug !== projectSlug || record.stage !== stage) continue;
    count += 1;
    if (!storage.validateRecord(record as ProductionExecutionDurableRecord).ok) {
      return "record-integrity";
    }
    if (!Number.isSafeInteger(record.attempt) || record.attempt < 1) {
      return "record-ordinal-format";
    }
    const parsed = parseVersionedLineageKey(key);
    if (!parsed || parsed.identity !== record.recordId ||
      parsed.version !== record.integrity.version) return "record-key-binding";
    const versions = records.get(record.recordId) ?? [];
    versions.push({ version: parsed.version, value: record });
    records.set(record.recordId, versions);
  }
  return count;
}

async function readApplicableClaims(
  adapter: ProductionExecutionPersistenceAdapter,
  keys: readonly string[],
  claimIds: ReadonlySet<string>,
  claims: Map<string, Array<{ version: number; value: ProductionExecutionDurableClaimRecord }>>,
): Promise<ProductionDurableAttemptLineageBoundary | undefined> {
  for (const key of keys) {
    const read = await adapter.read("claim", key);
    if (read.status !== "found") {
      return read.status === "failed" && read.errorCode === "PERSISTENCE_RECORD_CORRUPT"
        ? "claim-integrity"
        : "claim-read";
    }
    const claim = read.value;
    if (!claimIds.has(claim.identity.claimId)) continue;
    const parsed = parseVersionedLineageKey(key);
    if (!parsed || parsed.identity !== claim.identity.claimId ||
      parsed.version !== claim.claimVersion) return "claim-key-binding";
    const versions = claims.get(claim.identity.claimId) ?? [];
    versions.push({ version: parsed.version, value: claim });
    claims.set(claim.identity.claimId, versions);
  }
  return undefined;
}

async function readApplicableAttempts(
  adapter: ProductionExecutionPersistenceAdapter,
  keys: readonly string[],
  attemptIds: ReadonlySet<string>,
  attempts: Map<string, Array<{ version: number; value: ProductionExecutionDurableAttemptRecord }>>,
): Promise<ProductionDurableAttemptLineageBoundary | undefined> {
  for (const key of keys) {
    const read = await adapter.read("attempt", key);
    if (read.status !== "found") {
      return read.status === "failed" && read.errorCode === "PERSISTENCE_RECORD_CORRUPT"
        ? "attempt-integrity"
        : "attempt-read";
    }
    const attempt = read.value;
    if (!attemptIds.has(attempt.identity.attemptId)) continue;
    const parsed = parseVersionedLineageKey(key);
    if (!parsed || parsed.identity !== attempt.identity.attemptId ||
      parsed.version !== attempt.attemptVersion) return "attempt-key-binding";
    const versions = attempts.get(attempt.identity.attemptId) ?? [];
    versions.push({ version: parsed.version, value: attempt });
    attempts.set(attempt.identity.attemptId, versions);
  }
  return undefined;
}

function buildLineagePlans(projectSlug: string, stage: string, maximumOrdinal: number) {
  const claimIds = new Set<string>();
  const attemptIds = new Set<string>();
  for (let ordinal = 0; ordinal <= maximumOrdinal; ordinal += 1) {
    const runType = ordinal === 0 ? "initial" : "retry";
    const planned = buildProductionPipelineExecutionIdentity(
      { projectSlug, stage: stage as ProductionStepKey, runType },
      { id: `${projectSlug}-${stage}`, attempts: ordinal },
    );
    claimIds.add(planned.claimId);
    attemptIds.add(planned.attemptId);
  }
  return { claimIds, attemptIds };
}

function recordBindingBoundary(
  record: ProductionExecutionIdempotencyRecord,
  planned: ReturnType<typeof buildProductionPipelineExecutionIdentity>,
): ProductionDurableAttemptLineageBoundary | undefined {
  if (record.recordId !== planned.recordId) return "record-canonical-id";
  if (record.requestId !== planned.requestId) return "record-request-binding";
  if (record.idempotencyKey !== planned.idempotencyKey) return "record-idempotency-binding";
  if (record.executionFingerprint !== planned.executionFingerprint) {
    return "record-execution-fingerprint";
  }
  return undefined;
}

function claimBindingBoundary(
  claim: ProductionExecutionDurableClaimRecord,
  record: ProductionExecutionIdempotencyRecord,
  planned: ReturnType<typeof buildProductionPipelineExecutionIdentity>,
): ProductionDurableAttemptLineageBoundary | undefined {
  if (claim.identity.claimId !== planned.claimId) return "claim-canonical-id";
  if (claim.identity.recordId !== planned.recordId) return "claim-record-binding";
  if (claim.identity.reservationId !== record.identityFingerprint) return "claim-reservation-binding";
  if (claim.identity.requestId !== planned.requestId) return "claim-request-binding";
  if (claim.identity.idempotencyKey !== planned.idempotencyKey) return "claim-idempotency-binding";
  if (claim.identity.leaseId !== planned.leaseId) return "claim-lease-binding";
  if (claim.identity.executionFingerprint !== planned.executionFingerprint) {
    return "claim-execution-fingerprint";
  }
  if (claim.identity.operation !== undefined && claim.identity.operation !== record.operation) {
    return "claim-record-operation-binding";
  }
  return undefined;
}

function attemptBindingBoundary(
  attempt: ProductionExecutionDurableAttemptRecord,
  record: ProductionExecutionIdempotencyRecord,
  planned: ReturnType<typeof buildProductionPipelineExecutionIdentity>,
): ProductionDurableAttemptLineageBoundary | undefined {
  if (attempt.identity.attemptId !== planned.attemptId) return "attempt-canonical-id-topology";
  if (attempt.identity.recordId !== planned.recordId) return "attempt-record-binding";
  if (attempt.identity.claimId !== planned.claimId) return "attempt-claim-binding";
  if (attempt.identity.leaseId !== planned.leaseId) return "attempt-lease-binding";
  if (attempt.identity.reservationId !== record.identityFingerprint) {
    return "attempt-reservation-binding";
  }
  if (attempt.identity.requestId !== planned.requestId) return "attempt-request-binding";
  if (attempt.identity.idempotencyKey !== planned.idempotencyKey) {
    return "attempt-idempotency-binding";
  }
  if (attempt.identity.executionFingerprint !== planned.executionFingerprint) {
    return "attempt-execution-fingerprint";
  }
  return durableAttemptOperationBindingBoundary(attempt, record);
}

function durableAttemptOperationBindingBoundary(
  attempt: ProductionExecutionDurableAttemptRecord,
  record: ProductionExecutionIdempotencyRecord,
): ProductionDurableAttemptLineageBoundary | undefined {
  const operation = attempt.identity.operation;
  if (Object.prototype.hasOwnProperty.call(attempt.identity, "operation")) {
    if (typeof operation !== "string") return "attempt-operation-presence";
    return operation === record.operation ? undefined : "attempt-record-operation-binding";
  }
  return isProductionExecutionTerminalAttemptState(attempt.state) &&
    isProductionExecutionTerminalDurableRecordState(record.state)
    ? undefined
    : "terminal-legacy-operation-compatibility";
}

function durableLineageRunType(
  operation: string,
): ProductionAcceptanceStageExecutionIdentity["runType"] | undefined {
  const match = /^pipeline\.stage\.(initial|resume|retry)$/.exec(operation);
  return match ? match[1] as ProductionAcceptanceStageExecutionIdentity["runType"] : undefined;
}

function parseVersionedLineageKey(key: string): { identity: string; version: number } | undefined {
  const match = /^(.*)-v([1-9][0-9]*)$/.exec(key);
  if (!match) return undefined;
  const version = Number(match[2]);
  return Number.isSafeInteger(version) ? { identity: match[1], version } : undefined;
}

function exactLatestLineageVersion<T>(
  versions: Array<{ version: number; value: T }>,
  boundary: ProductionDurableAttemptLineageBoundary,
): { ok: true; value: T } | { ok: false; boundary: ProductionDurableAttemptLineageBoundary } {
  versions.sort((left, right) => left.version - right.version);
  for (let index = 0; index < versions.length; index += 1) {
    if (versions[index].version !== index + 1) return { ok: false, boundary };
  }
  return { ok: true, value: versions[versions.length - 1].value };
}
