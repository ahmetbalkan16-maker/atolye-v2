import { PipelineRecoveryPlanner, pipelineRecoveryStageOrder } from "@/lib/pipeline/PipelineRecoveryPlanner";
import { stableProductionId } from "./ProductionDeterminism";
import { ProductionExecutionLifecycle } from "./ProductionExecutionLifecycle";
import { validateProductionExecutionDurableAttempt } from "./ProductionExecutionDurableAttempt";
import { evaluateProductionExecutionReservationLifecycle } from "./ProductionExecutionIdempotency";
import type { PipelineRecoveryPlan, PipelineRecoveryStageKey } from "@/types/pipelineRecovery";
import type { ProductionExecutionDurableAttemptRecord } from "@/types/productionExecutionDurableAttempt";
import type { ProductionExecutionIdempotencyRecord,
  ProductionExecutionIdempotencyReservationRequest } from "@/types/productionExecutionIdempotency";
import type { ProductionExecutionPersistenceAdapter } from "@/types/productionExecutionPersistence";
import type { ProductionExecutionPersistenceRecordKind } from
  "@/types/productionExecutionPersistence";
import type {
  ProductionExecutionRecoveryBootstrapAttempt,
  ProductionExecutionRecoveryBootstrapClassification,
  ProductionExecutionRecoveryBootstrapPlannerPlan,
  ProductionExecutionRecoveryBootstrapRequest,
  ProductionExecutionRecoveryBootstrapResult,
} from "@/types/productionExecutionRecoveryBootstrap";
import {
  requireExactActiveProductionRuntimeOperationContext,
  type ProductionRuntimeOperationContext,
} from "@/lib/runtime/ProductionRuntimeOperationContext";

export interface ProductionExecutionRecoveryPlannerPort {
  createJobRetryPlan(projectSlug: string, stage: PipelineRecoveryStageKey): Promise<PipelineRecoveryPlan>;
}

export interface ProductionExecutionRecoverySemanticAuthority {
  readonly schemaVersion: "1";
  readonly policyVersion: "production-execution-recovery-semantic-authority-v1";
  readonly decision: "ready" | "recovery-required" | "indeterminate";
  readonly attempts: readonly ProductionExecutionRecoveryBootstrapAttempt[];
  readonly counts: Readonly<Record<ProductionExecutionRecoveryBootstrapClassification, number>>;
  readonly activeReservationCount: number;
  readonly activeReservationIdentities: readonly ProductionExecutionReservationSemanticIdentity[];
  readonly reservationConflicts: boolean;
  readonly reservationLifecycleState: "not-created" | "inactive" | "active" | "invalid";
  readonly reservationIntegrityFingerprint: string;
  readonly storeStates: ProductionExecutionRecoveryStoreStates;
  readonly storePolicyMatrix: readonly ProductionExecutionRecoveryStorePolicyEntry[];
  readonly storePolicyFingerprint: string;
  readonly writeFree: true;
}

export type ProductionExecutionRecoveryStoreFamily = "reservation" | "idempotency" |
  "claim" | "attempt" | "transaction" | "journal";
export type ProductionExecutionRecoveryStoreRequirementState = "optional" | "required" |
  "unsupported" | "conditionally-required";
export type ProductionExecutionRecoveryStoreObservedState = "present" | "not-created" |
  "unavailable" | "corrupt" | "identity-changed";
export type ProductionExecutionRecoveryStoreNormalizedOutcome = "accepted-empty" |
  "accepted-present" | "rejected-required-missing" | "rejected-unavailable" |
  "rejected-corrupt" | "rejected-identity-changed" | "ignored-unsupported";
export interface ProductionExecutionRecoveryStorePolicyEntry {
  readonly storeFamily: ProductionExecutionRecoveryStoreFamily;
  readonly lifecycleReason: string;
  readonly requirementState: ProductionExecutionRecoveryStoreRequirementState;
  readonly observedState: ProductionExecutionRecoveryStoreObservedState;
  readonly normalizedOutcome: ProductionExecutionRecoveryStoreNormalizedOutcome;
}

export interface ProductionExecutionReservationSemanticIdentity {
  readonly reservationId: string;
  readonly projectSlug: string;
  readonly operation: string;
  readonly stage: string | null;
  readonly executionFingerprint: string;
  readonly lifecycleState: "active" | "expired" | "terminal";
}

export type ProductionExecutionRecoveryStoreSemanticState = "optional-not-created" | "present" |
  "required-missing" | "unsupported" | "unavailable" | "corrupt" | "identity-changed";
export type ProductionExecutionRecoveryStoreStates = Readonly<Record<
  "reservations" | "idempotency" | "claims" | "attempts" | "transactions" | "journals",
  ProductionExecutionRecoveryStoreSemanticState>>;

const terminalStates = new Set(["succeeded", "failed", "cancelled", "abandoned"]);
const versionedKey = /^(.+)-v([1-9][0-9]*)$/;

export class ProductionExecutionRecoveryBootstrap {
  private readonly lifecycle: ProductionExecutionLifecycle;

  constructor(
    private readonly adapter: ProductionExecutionPersistenceAdapter,
    private readonly runtimeOperationContext: ProductionRuntimeOperationContext,
    private readonly planner: ProductionExecutionRecoveryPlannerPort = PipelineRecoveryPlanner,
  ) { this.lifecycle = new ProductionExecutionLifecycle(adapter); }

  async bootstrapRecovery(request: ProductionExecutionRecoveryBootstrapRequest):
  Promise<ProductionExecutionRecoveryBootstrapResult> {
    requireExactActiveProductionRuntimeOperationContext(this.runtimeOperationContext);
    const evaluatedAt = normalizeDate(request.evaluatedAt);
    if (!evaluatedAt) return result("invalid", "indeterminate", [], []);
    const semantic = await readProductionExecutionRecoverySemanticAuthority(
      this.adapter, evaluatedAt, this.lifecycle,
    );
    const attempts = [...semantic.attempts];
    const plannerPlans: ProductionExecutionRecoveryBootstrapPlannerPlan[] = [];
    for (const item of attempts) {
      if (!item.recoveryCandidate || item.terminal || !item.projectSlug || !item.stage) continue;
      const plan = await this.planner.createJobRetryPlan(item.projectSlug, item.stage);
      const startStage = plan.startStage && pipelineRecoveryStageOrder.includes(plan.startStage)
        ? plan.startStage : null;
      const stagesToRun = plan.stagesToRun.filter((stage) => pipelineRecoveryStageOrder.includes(stage));
      const safePlan = {
        attemptId: item.attemptId, projectSlug: item.projectSlug, stage: item.stage,
        type: "retry" as const, startStage, stagesToRun, blocked: plan.blocked,
        ...(safeText(plan.reason) ? { reason: plan.reason } : {}),
        dependencies: plan.dependencies
          .filter((dependency) => pipelineRecoveryStageOrder.includes(dependency.stage))
          .map((dependency) => ({ stage: dependency.stage, status: dependency.status,
            completed: dependency.completed, fileReady: dependency.fileReady,
            ready: dependency.ready,
            ...(safeText(dependency.reason) ? { reason: dependency.reason } : {}) })),
      };
      plannerPlans.push({ ...safePlan,
        fingerprint: stableProductionId("production-recovery-bootstrap-plan", safePlan) });
    }
    plannerPlans.sort((left, right) => codeUnitCompare(left.attemptId, right.attemptId));
    return result(evaluatedAt, semantic.decision, attempts, plannerPlans);
  }
}

export async function readProductionExecutionRecoverySemanticAuthority(
  adapter: ProductionExecutionPersistenceAdapter,
  evaluatedAt: string,
  lifecycle: ProductionExecutionLifecycle = new ProductionExecutionLifecycle(adapter),
): Promise<ProductionExecutionRecoverySemanticAuthority> {
  const normalized = normalizeDate(evaluatedAt);
  if (!normalized) {
    const policy = deriveStorePolicy(emptyStoreStates(), emptyStoreCounts(), 0, 0);
    return semanticResult("indeterminate", [], policy.storeStates, [], policy.matrix);
  }
  const readFailures = new Map<ProductionExecutionPersistenceRecordKind,
    ProductionExecutionRecoveryStoreObservedState>();
  const observedAdapter = observeRecordReads(adapter, readFailures);
  const [reservationList, idempotencyList, claimList, attemptList] = await Promise.all([
    observedAdapter.listKeys("reservation"), observedAdapter.listKeys("idempotency"),
    observedAdapter.listKeys("claim"), observedAdapter.listKeys("attempt"),
  ]);
  const lists = { reservations: reservationList, idempotency: idempotencyList,
    claims: claimList, attempts: attemptList };
  const initialStores = classifyStores(lists);
  if (Object.values(initialStores).some((state) => state === "unavailable" ||
    state === "corrupt" || state === "identity-changed")) {
    const policy = deriveStorePolicy(initialStores, emptyStoreCounts(), 0, 0);
    return semanticResult("indeterminate", [], policy.storeStates, [], policy.matrix);
  }
  if (!reservationList.ok || !idempotencyList.ok || !claimList.ok || !attemptList.ok) {
    const policy = deriveStorePolicy(initialStores, emptyStoreCounts(), 0, 0);
    return semanticResult("indeterminate", [], policy.storeStates, [], policy.matrix);
  }
  const chains = await loadAttemptChains(observedAdapter, attemptList.keys);
  const idempotency = await loadLatestIdempotencyRecords(observedAdapter, idempotencyList.keys);
  const reservations = await loadReservationAuthority(observedAdapter, reservationList.keys, normalized,
    idempotency);
  if (reservations.some((item) => item.lifecycleState === "invalid") &&
    !readFailures.has("reservation")) readFailures.set("reservation", "corrupt");
  if (readFailures.size > 0) {
    const observedStores = applyRecordReadFailures(initialStores, readFailures);
    const policy = deriveStorePolicy(observedStores, {
      reservations: reservationList.keys.length, idempotency: idempotencyList.keys.length,
      claims: claimList.keys.length, attempts: attemptList.keys.length,
    }, 0, 0);
    return semanticResult("indeterminate", [], policy.storeStates, [], policy.matrix);
  }
  const activeReservationCount = reservations.filter((item) => item.lifecycleState === "active").length;
  const validReservationCount = reservations.filter((item) => item.lifecycleState !== "invalid").length;
  const policy = deriveStorePolicy(initialStores, {
    reservations: reservationList.keys.length, idempotency: idempotencyList.keys.length,
    claims: claimList.keys.length, attempts: attemptList.keys.length,
  }, activeReservationCount, validReservationCount);
  const stores = policy.storeStates;
  const attempts: ProductionExecutionRecoveryBootstrapAttempt[] = [];
  for (const chain of chains) attempts.push(await classify(lifecycle, chain, normalized, idempotency));
  attempts.sort((left, right) => codeUnitCompare(left.attemptId, right.attemptId));
  const corrupt = attempts.some((item) => !item.versionChainValid || !item.journalValid ||
    item.primaryClassification === "orphaned");
  const invalidReservation = reservations.some((item) => item.lifecycleState === "invalid");
  const activeReservations = reservations.filter((item): item is ProductionExecutionReservationSemanticIdentity =>
    item.lifecycleState !== "invalid" && item.lifecycleState === "active");
  const requiredStoreMissing = Object.values(stores).includes("required-missing");
  return semanticResult(corrupt || invalidReservation || requiredStoreMissing ? "indeterminate" :
    activeReservations.length > 0 || attempts.some((item) => item.recoveryCandidate)
      ? "recovery-required" : "ready", attempts, stores, reservations, policy.matrix);
}

function observeRecordReads(
  adapter: ProductionExecutionPersistenceAdapter,
  failures: Map<ProductionExecutionPersistenceRecordKind,
    ProductionExecutionRecoveryStoreObservedState>,
): ProductionExecutionPersistenceAdapter {
  return {
    write: (kind, key, value) => adapter.write(kind, key, value),
    listKeys: (kind) => adapter.listKeys(kind),
    async read(kind, key) {
      const result = await adapter.read(kind, key);
      if (!result.ok) {
        const observed = result.errorCode === "PERSISTENCE_IDENTITY_CHANGED" ||
          result.errorCode === "PERSISTENCE_NOT_FOUND"
          ? "identity-changed" as const
          : result.errorCode === "PERSISTENCE_RECORD_CORRUPT" ||
              result.errorCode === "PERSISTENCE_INVALID_INPUT"
            ? "corrupt" as const : "unavailable" as const;
        const current = failures.get(kind);
        if (!current || readFailurePriority(observed) > readFailurePriority(current)) {
          failures.set(kind, observed);
        }
      }
      return result;
    },
  } as ProductionExecutionPersistenceAdapter;
}

function applyRecordReadFailures(
  states: ProductionExecutionRecoveryStoreStates,
  failures: ReadonlyMap<ProductionExecutionPersistenceRecordKind,
    ProductionExecutionRecoveryStoreObservedState>,
): ProductionExecutionRecoveryStoreStates {
  const output = { ...states };
  const keys: Partial<Record<ProductionExecutionPersistenceRecordKind,
    keyof ProductionExecutionRecoveryStoreStates>> = {
    reservation: "reservations", idempotency: "idempotency", claim: "claims",
    attempt: "attempts", transaction: "transactions", journal: "journals",
  };
  for (const [kind, observed] of failures) {
    const key = keys[kind];
    if (key && (observed === "identity-changed" || observed === "corrupt" ||
      observed === "unavailable")) output[key] = observed;
  }
  return output;
}

function readFailurePriority(state: ProductionExecutionRecoveryStoreObservedState): number {
  return state === "identity-changed" ? 3 : state === "corrupt" ? 2 :
    state === "unavailable" ? 1 : 0;
}

interface AttemptChain {
  attemptId: string;
  versions: ProductionExecutionDurableAttemptRecord[];
  valid: boolean;
}

async function loadAttemptChains(adapter: ProductionExecutionPersistenceAdapter,
  keys: readonly string[]): Promise<AttemptChain[]> {
  const grouped = new Map<string, Array<{ key: string; version: number }>>();
  const invalid: AttemptChain[] = [];
  for (const key of [...keys].sort(codeUnitCompare)) {
    const match = versionedKey.exec(key);
    if (!match) { invalid.push({ attemptId: safeIdentifier(key), versions: [], valid: false }); continue; }
    const values = grouped.get(match[1]) ?? [];
    values.push({ key, version: Number(match[2]) });
    grouped.set(match[1], values);
  }
  const chains: AttemptChain[] = [...invalid];
  for (const [attemptId, versions] of grouped) {
    versions.sort((left, right) => left.version - right.version);
    const records: ProductionExecutionDurableAttemptRecord[] = [];
    let valid = versions.every((item, index) => item.version === index + 1);
    for (const item of versions) {
      const read = await adapter.read("attempt", item.key);
      if (read.status !== "found" || !validateProductionExecutionDurableAttempt(read.value) ||
        read.value.identity.attemptId !== attemptId || read.value.attemptVersion !== item.version) {
        valid = false; continue;
      }
      records.push(read.value);
    }
    if (valid) valid = records.every((record, index) =>
      index === 0 || immutableSuccessor(records[index - 1], record));
    chains.push({ attemptId, versions: records, valid });
  }
  return chains;
}

async function loadLatestIdempotencyRecords(adapter: ProductionExecutionPersistenceAdapter,
  listedKeys?: readonly string[]):
Promise<Map<string, ProductionExecutionIdempotencyRecord>> {
  const listed = listedKeys ? { ok: true as const, keys: listedKeys } : await adapter.listKeys("idempotency");
  if (!listed.ok) return new Map();
  const grouped = new Map<string, Array<{ key: string; version: number }>>();
  for (const key of [...listed.keys].sort(codeUnitCompare)) {
    const match = versionedKey.exec(key);
    if (!match) return new Map();
    const values = grouped.get(match[1]) ?? [];
    values.push({ key, version: Number(match[2]) });
    grouped.set(match[1], values);
  }
  const output = new Map<string, ProductionExecutionIdempotencyRecord>();
  for (const [recordId, versions] of grouped) {
    versions.sort((left, right) => left.version - right.version);
    if (!versions.every((item, index) => item.version === index + 1)) return new Map();
    for (const item of versions) {
      const read = await adapter.read("idempotency", item.key);
      if (read.status !== "found" || read.value.recordId !== recordId ||
        (read.value as { recordVersion?: unknown }).recordVersion !== item.version) return new Map();
      output.set(recordId, read.value);
    }
  }
  return output;
}

async function classify(lifecycle: ProductionExecutionLifecycle, chain: AttemptChain,
  evaluatedAt: string, idempotency: Map<string, ProductionExecutionIdempotencyRecord>):
Promise<ProductionExecutionRecoveryBootstrapAttempt> {
  const latest = chain.versions.at(-1);
  if (!latest || !chain.valid) return orphaned(chain.attemptId, latest);
  const assessment = await lifecycle.inspect(latest.identity.attemptId, evaluatedAt);
  const linked = idempotency.get(latest.identity.recordId);
  const stage = linked && pipelineRecoveryStageOrder.includes(linked.stage as PipelineRecoveryStageKey)
    ? linked.stage as PipelineRecoveryStageKey : undefined;
  const terminal = terminalStates.has(latest.state);
  const orphan = assessment.classification === "missing-linked-claim" ||
    assessment.classification === "partial-coordination" ||
    assessment.classification === "integrity-mismatch" ||
    assessment.classification === "journal-corruption" ||
    assessment.classification === "indeterminate" || !linked;
  const expired = assessment.classification === "expired-lease";
  const classifications: ProductionExecutionRecoveryBootstrapClassification[] = [];
  if (terminal) classifications.push("terminal"); else classifications.push("active");
  if (latest.state === "active") classifications.push("running");
  if (orphan) classifications.push("orphaned");
  if (expired) classifications.push("expired-lease");
  if (!terminal && chain.valid && !orphan) classifications.push("replayable");
  const primaryClassification: ProductionExecutionRecoveryBootstrapClassification = terminal
    ? "terminal" : orphan ? "orphaned" : expired ? "expired-lease" :
      latest.state === "active" ? "running" : "active";
  const recoveryCandidate = !terminal &&
    (orphan || expired || latest.state === "opened" || latest.state === "outcome-proposed");
  const action = terminal ? "skip-terminal" : orphan ? "manual-recovery" : expired
    ? "recover-expired-lease" : latest.state === "active" ? "wait-for-owner"
      : "resume-through-coordinator-worker";
  return { attemptId: latest.identity.attemptId, state: latest.state,
    primaryClassification, classifications, action, reasonCode: assessment.reasonCode,
    attemptVersion: latest.attemptVersion,
    journalSequence: latest.journal.at(-1)?.sequence ?? 0,
    journalValid: assessment.classification !== "journal-corruption",
    versionChainValid: true, recoveryCandidate, terminal,
    ...(linked ? { projectSlug: linked.projectSlug, ...(stage ? { stage } : {}) } : {}),
    ownership: { claimId: latest.identity.claimId, leaseId: latest.identity.leaseId,
      workerId: latest.identity.workerId, workerSessionId: latest.identity.workerSessionId },
    evidence: [`classification:${primaryClassification}`, `reason:${assessment.reasonCode}`,
      "bootstrap:write-free"] };
}

function immutableSuccessor(previous: ProductionExecutionDurableAttemptRecord,
  next: ProductionExecutionDurableAttemptRecord): boolean {
  if (next.attemptVersion !== previous.attemptVersion + 1 ||
    JSON.stringify(next.identity) !== JSON.stringify(previous.identity) ||
    JSON.stringify(next.binding) !== JSON.stringify(previous.binding) ||
    next.journal.length !== previous.journal.length + 1) return false;
  return previous.journal.every((entry, index) =>
    entry.integrity.fingerprint === next.journal[index]?.integrity.fingerprint);
}

function orphaned(attemptId: string, latest?: ProductionExecutionDurableAttemptRecord):
ProductionExecutionRecoveryBootstrapAttempt {
  const terminal = latest ? terminalStates.has(latest.state) : false;
  return { attemptId: safeIdentifier(attemptId), state: latest?.state ?? "unknown",
    primaryClassification: "orphaned",
    classifications: terminal ? ["terminal", "orphaned"] : ["orphaned"],
    action: terminal ? "skip-terminal" : "manual-recovery",
    reasonCode: "ATTEMPT_RECOVERY_REQUIRED", attemptVersion: latest?.attemptVersion ?? 0,
    journalSequence: latest?.journal.at(-1)?.sequence ?? 0, journalValid: false,
    versionChainValid: false, recoveryCandidate: !terminal, terminal,
    evidence: ["classification:orphaned", "reason:ATTEMPT_RECOVERY_REQUIRED",
      "bootstrap:write-free"] };
}

type ReservationAuthorityEntry = ProductionExecutionReservationSemanticIdentity | {
  readonly reservationId: string; readonly lifecycleState: "invalid" };

async function loadReservationAuthority(adapter: ProductionExecutionPersistenceAdapter,
  keys: readonly string[], evaluatedAt: string,
  idempotency: ReadonlyMap<string, ProductionExecutionIdempotencyRecord>):
Promise<readonly ReservationAuthorityEntry[]> {
  const output: ReservationAuthorityEntry[] = [];
  for (const key of [...keys].sort(codeUnitCompare)) {
    const read = await adapter.read("reservation", key);
    if (read.status !== "found" || read.value.identity.identityFingerprint !== key) {
      output.push({ reservationId: safeIdentifier(key), lifecycleState: "invalid" });
      continue;
    }
    const reservation: ProductionExecutionIdempotencyReservationRequest = read.value;
    const candidates = [...idempotency.values()].filter((record) =>
      record.identityFingerprint === reservation.identity.identityFingerprint);
    const linked = candidates.length === 1 ? candidates[0] : undefined;
    const bindingValid = candidates.length <= 1 && (!linked ||
      linked.projectSlug === reservation.identity.projectSlug &&
      linked.operation === reservation.identity.operation &&
      (linked.stage ?? null) === (reservation.identity.stage ?? null) &&
      linked.requestId === reservation.identity.requestId &&
      linked.idempotencyKey === reservation.identity.idempotencyKey &&
      linked.executionFingerprint === reservation.identity.executionFingerprint &&
      linked.bindingFingerprint === reservation.identity.bindingFingerprint);
    const lifecycle = evaluateProductionExecutionReservationLifecycle(reservation, evaluatedAt);
    if (!bindingValid || lifecycle === "invalid") {
      output.push({ reservationId: safeIdentifier(key), lifecycleState: "invalid" });
      continue;
    }
    const lifecycleState = linked && terminalExecutionState(linked.state)
      ? "terminal" as const : lifecycle;
    output.push(Object.freeze({ reservationId: key, projectSlug: reservation.identity.projectSlug,
      operation: reservation.identity.operation, stage: reservation.identity.stage ?? null,
      executionFingerprint: reservation.identity.executionFingerprint, lifecycleState }));
  }
  return Object.freeze(output);
}

function terminalExecutionState(state: string): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled" ||
    state === "partially-succeeded";
}

function emptyStoreStates(): ProductionExecutionRecoveryStoreStates {
  return Object.freeze({ reservations: "optional-not-created", idempotency: "optional-not-created",
    claims: "optional-not-created", attempts: "optional-not-created",
    transactions: "unsupported", journals: "unsupported" });
}

function classifyStores(lists: Record<string, { ok: boolean; keys?: readonly string[];
  storeState?: "present" | "not-created"; errorCode?: string }>): ProductionExecutionRecoveryStoreStates {
  const classify = (value: { ok: boolean; keys?: readonly string[]; storeState?: "present" | "not-created";
    errorCode?: string }): ProductionExecutionRecoveryStoreSemanticState => {
    if (!value.ok) return value.errorCode === "PERSISTENCE_IDENTITY_CHANGED" ? "identity-changed" :
      value.errorCode === "PERSISTENCE_RECORD_CORRUPT" ? "corrupt" : "unavailable";
    return value.storeState === "not-created" ? "optional-not-created" : "present";
  };
  return Object.freeze({ reservations: classify(lists.reservations),
    idempotency: classify(lists.idempotency), claims: classify(lists.claims),
    attempts: classify(lists.attempts), transactions: "unsupported", journals: "unsupported" });
}

function deriveStorePolicy(states: ProductionExecutionRecoveryStoreStates,
  countsByStore: Readonly<Record<"reservations" | "idempotency" | "claims" | "attempts", number>>,
  activeReservationCount: number,
  validReservationCount: number): { readonly storeStates: ProductionExecutionRecoveryStoreStates;
    readonly matrix: readonly ProductionExecutionRecoveryStorePolicyEntry[] } {
  const required = {
    reservations: countsByStore.idempotency > 0 || countsByStore.claims > 0 || countsByStore.attempts > 0,
    idempotency: validReservationCount > 0 || activeReservationCount > 0 ||
      countsByStore.claims > 0 || countsByStore.attempts > 0,
    claims: countsByStore.attempts > 0,
    attempts: countsByStore.claims > 0,
  };
  const storeStates = Object.freeze(Object.fromEntries(Object.entries(states).map(([kind, state]) =>
    [kind, state === "optional-not-created" && required[kind as keyof typeof required]
      ? "required-missing" : state])) as unknown as ProductionExecutionRecoveryStoreStates);
  const families = [
    ["reservation", "reservations"], ["idempotency", "idempotency"], ["claim", "claims"],
    ["attempt", "attempts"], ["transaction", "transactions"], ["journal", "journals"],
  ] as const;
  const reasons: Readonly<Record<ProductionExecutionRecoveryStoreFamily, string>> = {
    reservation: required.reservations ? "durable-descendant-requires-reservation" : "no-durable-descendant",
    idempotency: required.idempotency ? "reservation-or-descendant-requires-idempotency" : "no-active-reservation-or-descendant",
    claim: required.claims ? "attempt-requires-linked-claim" : "no-attempt-chain",
    attempt: required.attempts ? "claim-coordination-requires-attempt" : "no-claim-coordination",
    transaction: "store-family-unsupported", journal: "store-family-unsupported",
  };
  const matrix = families.map(([storeFamily, key]) => {
    const semanticState = storeStates[key];
    const unsupported = storeFamily === "transaction" || storeFamily === "journal";
    const isRequired = !unsupported && required[key as keyof typeof required];
    const observedState: ProductionExecutionRecoveryStoreObservedState =
      semanticState === "present" ? "present" : semanticState === "unavailable" ? "unavailable" :
        semanticState === "corrupt" ? "corrupt" : semanticState === "identity-changed" ? "identity-changed" : "not-created";
    const normalizedOutcome: ProductionExecutionRecoveryStoreNormalizedOutcome = unsupported
      ? "ignored-unsupported" : semanticState === "required-missing" ? "rejected-required-missing" :
        observedState === "unavailable" ? "rejected-unavailable" : observedState === "corrupt" ? "rejected-corrupt" :
          observedState === "identity-changed" ? "rejected-identity-changed" : observedState === "present"
            ? "accepted-present" : "accepted-empty";
    return Object.freeze({ storeFamily, lifecycleReason: reasons[storeFamily],
      requirementState: unsupported ? "unsupported" as const : isRequired ? "required" as const :
        "conditionally-required" as const, observedState, normalizedOutcome });
  });
  return Object.freeze({ storeStates, matrix: Object.freeze(matrix) });
}

function emptyStoreCounts() {
  return Object.freeze({ reservations: 0, idempotency: 0, claims: 0, attempts: 0 });
}

function semanticResult(decision: ProductionExecutionRecoverySemanticAuthority["decision"],
  attempts: readonly ProductionExecutionRecoveryBootstrapAttempt[],
  storeStates: ProductionExecutionRecoveryStoreStates,
  reservations: readonly ReservationAuthorityEntry[],
  storePolicyMatrix: readonly ProductionExecutionRecoveryStorePolicyEntry[]):
ProductionExecutionRecoverySemanticAuthority {
  const validReservations = reservations.filter((item): item is ProductionExecutionReservationSemanticIdentity =>
    item.lifecycleState !== "invalid");
  const active = validReservations.filter((item) => item.lifecycleState === "active");
  const reservationLifecycleState = reservations.some((item) => item.lifecycleState === "invalid")
    ? "invalid" as const : active.length ? "active" as const : reservations.length
      ? "inactive" as const : "not-created" as const;
  const reservationIntegrityFingerprint = stableProductionId("production-reservation-authority", {
    reservations: validReservations.map((item) => ({ reservationId: item.reservationId,
      projectSlug: item.projectSlug, operation: item.operation, stage: item.stage,
      executionFingerprint: item.executionFingerprint, lifecycleState: item.lifecycleState })),
  });
  const storePolicyFingerprint = stableProductionId("production-recovery-store-policy", {
    entries: storePolicyMatrix,
  });
  return Object.freeze({ schemaVersion: "1",
    policyVersion: "production-execution-recovery-semantic-authority-v1", decision,
    attempts: Object.freeze([...attempts]), counts: Object.freeze(counts(attempts)),
    activeReservationCount: active.length, activeReservationIdentities: Object.freeze(active),
    reservationConflicts: active.length > 0, reservationLifecycleState,
    reservationIntegrityFingerprint, storeStates, storePolicyMatrix,
    storePolicyFingerprint, writeFree: true });
}

function result(evaluatedAt: string, decision: ProductionExecutionRecoveryBootstrapResult["decision"],
  attempts: ProductionExecutionRecoveryBootstrapAttempt[],
  plannerPlans: ProductionExecutionRecoveryBootstrapPlannerPlan[]):
ProductionExecutionRecoveryBootstrapResult {
  const core = { evaluatedAt, decision, attempts, plannerPlans, counts: counts(attempts) };
  return { schemaVersion: "1", bootstrapId: stableProductionId("production-recovery-bootstrap", core),
    ...core, writeFree: true, evidence: [`decision:${decision}`, "bootstrap:read-only"] };
}

function counts(attempts: readonly ProductionExecutionRecoveryBootstrapAttempt[]) {
  const value = { active: 0, running: 0, terminal: 0, orphaned: 0,
    "expired-lease": 0, replayable: 0 };
  for (const attempt of attempts) for (const classification of attempt.classifications) value[classification]++;
  return value;
}

function normalizeDate(value: string): string | undefined {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? value : undefined;
}
function safeIdentifier(value: string): string {
  return /^[a-z0-9][a-z0-9_-]{0,101}$/.test(value)
    ? value : stableProductionId("production-recovery-artifact", value);
}
function safeText(value: string | undefined): value is string {
  return typeof value === "string" && value.length <= 200 &&
    !/secret|token|api.?key|stack|[a-zA-Z]:[\\/]|\.\.[\\/]|provider.?response/i.test(value);
}
function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
