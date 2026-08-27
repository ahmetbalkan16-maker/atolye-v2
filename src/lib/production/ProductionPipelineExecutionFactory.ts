import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import path from "node:path";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import { assertCanonicalPipelineRetryAdmission } from
  "@/lib/pipeline/PipelineRetryAdmission";
import type { ProductionRuntimeOperationContext } from "@/lib/runtime/ProductionRuntimeOperationContext";
import { getActiveProductionRuntimeOperationContext,
  requireProductionRuntimeStorageContext } from "@/lib/runtime/ProductionRuntimeOperationContext";
import type { ProductionExecutionDurableAttemptRecord } from "@/types/productionExecutionDurableAttempt";
import type { ProductionExecutionDurableClaimRecord } from "@/types/productionExecutionDurableClaim";
import type { ProductionExecutionDurableLease } from "@/types/productionExecutionDurableLease";
import type { ProductionExecutionDurableRecord } from "@/types/productionExecutionDurableStorage";
import type {
  ProductionExecutionIdempotencyRecord,
  ProductionExecutionIdempotencyReservationRequest,
  ProductionExecutionIdempotencyTransitionRequest,
} from "@/types/productionExecutionIdempotency";
import type { ProductionExecutionAuthorizationResult } from "@/types/productionExecutionAuthorization";
import type { ProductionExecutionConfirmationValidationResult } from "@/types/productionExecutionConfirmation";
import type { ProductionExecutionWorkerExecutionRequest } from "@/types/productionExecutionWorker";
import {
  ProductionPipelineDurableExecutionError,
  type ProductionPipelineExecutionContext,
} from "./ProductionPipelineExecutionAdapter";
import {
  executeCanonicalProductionPipelineStage,
  installCanonicalProductionPipelineExecutionRuntime,
} from "./ProductionPipelineExecutionCanonicalRuntime";
import { canonicalProductionSecurityValue, stableProductionId,
  stableProductionValue } from "./ProductionDeterminism";
import {
  AdapterBackedProductionExecutionClaimService,
  defaultProductionExecutionClaimPolicy,
  validateProductionExecutionDurableClaim,
} from "./ProductionExecutionDurableClaim";
import { AdapterBackedProductionExecutionAttemptService,
  defaultProductionExecutionAttemptPolicy,
  validateProductionExecutionDurableAttempt } from "./ProductionExecutionDurableAttempt";
import {
  AdapterBackedProductionExecutionDurableLeaseService,
  defaultProductionExecutionDurableLeasePolicy,
  validateProductionExecutionDurableLease,
} from "./ProductionExecutionDurableLease";
import {
  AdapterBackedProductionExecutionDurableStorage,
  defaultProductionExecutionDurableStoragePolicy,
} from "./ProductionExecutionDurableStorage";
import { anyDurableRecordReferencesRecordId } from "./ProductionPipelineRetryReconciliation";
import {
  buildProductionExecutionIdempotencyIdentity,
  defaultProductionExecutionIdempotencyPolicy,
} from "./ProductionExecutionIdempotency";
import { ProductionExecutionCoordinator } from "./ProductionExecutionCoordinator";
import { ProductionExecutionFilePersistenceAdapter } from "./ProductionExecutionPersistence";
import { ProductionExecutionLifecycle } from "./ProductionExecutionLifecycle";
import { buildProductionPipelineExecutionIdentity } from "./ProductionPipelineExecutionIdentity";
import { buildRetryBudgetExtensionDurableBinding } from
  "./ProductionPipelineRetryBudgetExtensionSchema";
import { readProductionCanonicalTerminalDurableLineage } from
  "./ProductionCanonicalDurableLineage";
import { getProductionAcceptanceLegacyPreviousRetryJob,
  getProductionAcceptanceRetryAdmission } from
  "./ProductionAcceptanceLegacyAdmissionContext";
import { findConsumedRegenerationRetryBudgetExtension } from
  "./ProductionPipelineRegenerationRetryBudgetExtension";
import {
  emitProductionPipelineExecutionEvent,
  poisonProductionPipelineExecutionPlanAfterDurableAttempt,
} from "./ProductionPipelineExecutionInstrumentation";
import { classifyProductionDurableAttemptLineage } from
  "./ProductionDurableAttemptLineageClassifier";
import { productionPipelineExecutionAuthorizationAction } from
  "./ProductionPipelineExecutionSemantics";
import type { ProductionAcceptanceStageExecutionIdentity } from "./ProductionAcceptancePolicy";
import { productionAcceptanceProviderCapabilitiesForStage,
  createProductionAcceptanceProviderSelection,
  sameProductionAcceptanceProviderSelection,
  serializableProductionAcceptanceProviderSelection,
  serializableProductionAcceptanceExecutionScope,
  type ProductionAcceptanceProviderSelection,
  type ProductionAcceptanceStageExecutionScope } from
  "./ProductionAcceptanceExecutionScope";
import type { ProductionWorkerLifecycle } from "./ProductionWorkerLifecycle";
import {
  createProductionDurableAttemptLineageBindingError,
  productionDurableAttemptLineageBindingInvalidCode,
  type ProductionDurableAttemptLineageBoundary,
} from "./ProductionDurableAttemptLineageBoundary";

export { buildProductionPipelineExecutionIdentity } from "./ProductionPipelineExecutionIdentity";

const ttlSeconds = 31_536_000;
const workerId = "pipeline-worker";
const sessionId = "pipeline-session-v1";
export { productionDurableAttemptLineageBindingInvalidCode } from
  "./ProductionDurableAttemptLineageBoundary";
const trustedFileOperations = Object.freeze({
  access: fs.access.bind(fs), mkdir: fs.mkdir.bind(fs), readFile: fs.readFile.bind(fs),
  readdir: fs.readdir.bind(fs), writeFile: fs.writeFile.bind(fs), link: fs.link.bind(fs),
  unlink: fs.unlink.bind(fs), rename: fs.rename.bind(fs), lstat: fs.lstat.bind(fs),
  stat: fs.stat.bind(fs), realpath: fs.realpath.bind(fs), open: fs.open.bind(fs),
});
const trustedPersistencePrototype = Object.freeze(Object.create(Object.prototype,
  Object.getOwnPropertyDescriptors(ProductionExecutionFilePersistenceAdapter.prototype)));
declare const completedPreparationBrand: unique symbol;

export interface ProductionPipelineCompletedPreparationAuthority {
  readonly [completedPreparationBrand]: true;
}

export interface CompletedProductionPipelinePreparation {
  readonly canonicalIdentity: ProductionAcceptanceStageExecutionIdentity;
  readonly leaseId: string;
  readonly reservation: ProductionExecutionIdempotencyReservationRequest;
  readonly record: ProductionExecutionDurableRecord;
  readonly lease: ProductionExecutionDurableLease;
  readonly claim: ProductionExecutionDurableClaimRecord;
  readonly attempt: ProductionExecutionDurableAttemptRecord;
  readonly request: ProductionExecutionWorkerExecutionRequest;
  readonly providerSelection: ProductionAcceptanceProviderSelection;
}

type CompletedProductionPipelinePreparationRecord = CompletedProductionPipelinePreparation & {
  readonly storeRoot: string;
  readonly storeIdentity: string;
  readonly storeEntries: Readonly<Record<string, string>>;
  readonly runtimeAuthorityIdentity: string;
  readonly runtimeOperationBinding: string;
  readonly providerSelection: ProductionAcceptanceProviderSelection;
  readonly provenanceFingerprint: string;
};

/**
 * Process-global WeakMap, shared (via globalThis + Symbol.for) across every module instance of this
 * file that may be loaded in the same OS process — e.g. one instance reached through the durable
 * execution flow started by instrumentation.ts's boot-time registration
 * (ProductionPipelineExecutionCanonicalRuntime.ts), another reached independently through
 * ProductionAcceptancePolicy.ts's own import of this file within a Next.js route handler's module
 * graph, when a bundler compiles shared `src/lib` code separately per entry/layer instead of
 * deduplicating it into one shared chunk. A plain module-scoped WeakMap here made a preparation
 * recorded by `prepareProductionPipelineExecution` (running through one module instance) invisible to
 * `readCompletedProductionPipelinePreparation`/`readVerifiedCompletedProductionPipelinePreparationFingerprint`
 * when called through any other instance — even for the exact same `authority` object reference —
 * throwing "Pipeline durable preparation authority is invalid." (WORKER_EXECUTION_COORDINATION_FAILED).
 */
const processCompletedPreparationsKey = Symbol.for(
  "@atolye/production-pipeline-execution-completed-preparations/v1",
);
const completedPreparations = claimProcessCompletedPreparations();

/** @internal Install-only canonical composition; no production reset or adapter seam exists. */
export function installCanonicalProductionPipelineExecution(
  lifecycle: ProductionWorkerLifecycle,
  runtimeOperationContext: ProductionRuntimeOperationContext,
): void {
  installCanonicalProductionPipelineExecutionRuntime(lifecycle, runtimeOperationContext);
}

export function executeConfiguredProductionPipelineStage(
  context: ProductionPipelineExecutionContext,
  handler: Parameters<typeof executeCanonicalProductionPipelineStage>[1],
): Promise<boolean> {
  return executeCanonicalProductionPipelineStage(context, handler);
}

export function readCompletedProductionPipelinePreparation(
  authority: ProductionPipelineCompletedPreparationAuthority,
): CompletedProductionPipelinePreparation {
  const completed = completedPreparations.get(authority as object);
  if (!completed) {
    throw new ProductionPipelineDurableExecutionError(
      "Pipeline durable preparation authority is invalid.",
      "WORKER_EXECUTION_COORDINATION_FAILED",
    );
  }
  return completed;
}

export async function readVerifiedCompletedProductionPipelinePreparationFingerprint(
  authority: ProductionPipelineCompletedPreparationAuthority,
  executionScope: ProductionAcceptanceStageExecutionScope,
): Promise<string> {
  const completed = completedPreparations.get(authority as object);
  if (!completed) throw new ProductionPipelineDurableExecutionError(
    "Pipeline durable preparation authority is invalid.",
    "WORKER_EXECUTION_COORDINATION_FAILED",
  );
  const runtime = getActiveProductionRuntimeOperationContext();
  if (!runtime || runtime.authority.authorityIdentity !== completed.runtimeAuthorityIdentity ||
    runtime.bindingFingerprint !== completed.runtimeOperationBinding) {
    throw new ProductionPipelineDurableExecutionError(
      "Pipeline durable preparation runtime authority changed.",
      "WORKER_EXECUTION_COORDINATION_FAILED",
    );
  }
  const storage = requireProductionRuntimeStorageContext(runtime);
  const expectedRoot = canonicalStoreRoot(path.join(
    storage.projectsRoot,
    completed.canonicalIdentity.projectSlug,
    "production-execution",
  ));
  const currentStoreAuthority = await capturePhysicalStoreAuthority(expectedRoot);
  if (expectedRoot !== completed.storeRoot ||
    currentStoreAuthority.identity !== completed.storeIdentity) {
    throw new ProductionPipelineDurableExecutionError(
      "Pipeline durable preparation store authority changed.",
      "WORKER_EXECUTION_COORDINATION_FAILED",
    );
  }
  for (const [entry, identity] of Object.entries(completed.storeEntries)) {
    if (entry.endsWith(".json") && currentStoreAuthority.entries[entry] !== identity) {
      throw new ProductionPipelineDurableExecutionError(
        "Pipeline durable preparation record authority changed.",
        "WORKER_EXECUTION_COORDINATION_FAILED",
      );
    }
  }
  await emitProductionPipelineExecutionEvent("physical-store-identity-verified");
  assertExecutionScopeMatchesIdentity(executionScope, completed.canonicalIdentity);
  if (!sameProductionAcceptanceProviderSelection(
    completed.providerSelection, executionScope.providerSelection,
  )) throw new ProductionPipelineDurableExecutionError(
    "Pipeline durable preparation provider authority changed.",
    "WORKER_EXECUTION_COORDINATION_FAILED",
  );
  const trustedReader = createTrustedPersistenceReader(
    completed.storeRoot, false, {
      identity: completed.storeIdentity,
      entries: currentStoreAuthority.entries,
    },
  );
  const readback = await readCompletedDurableRecords(
    trustedReader,
    new AdapterBackedProductionExecutionDurableStorage(trustedReader),
    {
      reservationId: completed.canonicalIdentity.reservationId,
      recordId: completed.canonicalIdentity.recordId,
      claimId: completed.canonicalIdentity.claimId,
      attemptId: completed.canonicalIdentity.attemptId,
    },
    completed.attempt.updatedAt,
  );
  if (await physicalStoreIdentity(expectedRoot) !== completed.storeIdentity) {
    throw new Error("Pipeline durable physical store changed during readback.");
  }
  assertCompletedBindings(readback);
  assertCompletedCanonicalIdentityBindings(readback, completed.canonicalIdentity);
  const transition = completedPreparationTransition(completed, readback, completed.request);
  return completedPreparationIssuanceFingerprint({
    initialFingerprint: completed.provenanceFingerprint,
    transition,
    current: readback,
    identity: completed.canonicalIdentity,
    executionScope,
    storeIdentity: completed.storeIdentity,
    runtimeAuthorityIdentity: completed.runtimeAuthorityIdentity,
    runtimeOperationBinding: completed.runtimeOperationBinding,
  });
}

export async function prepareProductionPipelineExecution(
  context: ProductionPipelineExecutionContext,
) {
  await emitProductionPipelineExecutionEvent("durable-entry", { stage: context.stage });
  const resolvedStoreRoot = canonicalStoreRoot(
    `${ProjectReader.getProjectFolder(context.projectSlug)}/production-execution`,
  );
  const adapter = createTrustedPersistenceReader(resolvedStoreRoot, true);
  const job = await PipelineJobManager.getJobForStageReadOnly(context.projectSlug, context.stage);
  const jobId = `${context.projectSlug}-${context.stage}`;
  if (job && (job.id !== jobId || !Number.isSafeInteger(job.attempts) || job.attempts < 0)) {
    throw new Error("Pipeline durable preparation job identity is invalid.");
  }
  const retryAdmission = getProductionAcceptanceRetryAdmission();
  if (retryAdmission) {
    try {
      assertCanonicalPipelineRetryAdmission({ admission: retryAdmission,
        previousJob: getProductionAcceptanceLegacyPreviousRetryJob(),
        currentJob: job ?? undefined,
        projectSlug: context.projectSlug, stage: context.stage, runType: context.runType });
      await assertReconciledRetryLineageBinding(adapter, retryAdmission);
    } catch (error) {
      if (
        error instanceof ProductionPipelineDurableExecutionError &&
        error.code === productionDurableAttemptLineageBindingInvalidCode
      ) {
        throw error;
      }
      throw new ProductionPipelineDurableExecutionError(
        "Pipeline retry immutable admission binding is invalid.",
        "PIPELINE_RETRY_EXECUTION_ADMISSION_FAILED",
      );
    }
  }
  const providerSelection = context.providerSelection ??
    createProductionAcceptanceProviderSelection(context.stage);
  const attemptNumber = retryAdmission?.admittedJobAttemptIndex ??
    (context.regeneration
      ? job?.attempts ?? 0
      : await resolveDurableAttemptOrdinal(
        adapter, context.projectSlug, context.stage, job?.attempts ?? 0,
      ));
  const anchor = job?.updatedAt ?? job?.createdAt ?? new Date().toISOString();
  const now = new Date().toISOString();
  const planned = buildProductionPipelineExecutionIdentity(context, {
    id: jobId,
    attempts: attemptNumber,
  });
  if (retryAdmission && stableProductionValue(planned) !==
    stableProductionValue(retryAdmission.admittedDurableLineageIdentity)) {
    throw new ProductionPipelineDurableExecutionError(
      "Pipeline retry admitted durable identity changed.",
      "PIPELINE_RETRY_EXECUTION_ADMISSION_FAILED",
    );
  }
  const planIdentity = {
    requestId: planned.requestId,
    idempotencyKey: planned.idempotencyKey,
    operation: `pipeline.stage.${context.runType}`,
    leaseId: planned.leaseId,
  };
  const authorizationAction = productionPipelineExecutionAuthorizationAction(context);
  const authorization: ProductionExecutionAuthorizationResult = {
    schemaVersion: "1", decisionId: stableProductionId("pipeline-authorization", planned.core),
    decision: "allow", authorized: true, reasonCode: "AUTHORIZED",
    reason: "trusted pipeline composition", evaluatedAt: anchor,
    requestId: planIdentity.requestId, idempotencyKey: planIdentity.idempotencyKey,
    executionFingerprint: planned.executionFingerprint, actorId: "pipeline-system",
    actorType: "system", projectSlug: context.projectSlug, operation: planIdentity.operation,
    action: authorizationAction, stage: context.stage, requiredCapabilities: [], grantedCapabilities: [],
    missingCapabilities: [], policyVersion: "pipeline-durable-v1", risk: "high",
    requiresConfirmation: true, requiredConfirmationLevel: "high",
    evidence: ["source:pipeline-composition"],
  };
  const confirmation: ProductionExecutionConfirmationValidationResult = {
    schemaVersion: "1", decision: "valid", valid: true, reasonCode: "CONFIRMATION_VALID",
    reason: "trusted pipeline composition", evaluatedAt: anchor,
    confirmationId: stableProductionId("pipeline-confirmation", planned.core),
    confirmationRequestId: stableProductionId("pipeline-confirmation-request", planned.core),
    authorizationDecisionId: stableProductionId("pipeline-authorization", planned.core),
    requestId: planIdentity.requestId, idempotencyKey: planIdentity.idempotencyKey,
    actorId: "pipeline-system", projectSlug: context.projectSlug, operation: planIdentity.operation,
    action: authorizationAction, stage: context.stage, riskLevel: "high",
    requiredConfirmationLevel: "high", providedConfirmationLevel: "high", bindingMatches: true,
    bindingFingerprint: stableProductionId("pipeline-confirmation-binding", planned.core),
    expired: false, singleUse: true, consumed: false, policyVersion: "pipeline-durable-v1",
    evidence: ["source:pipeline-composition"],
  };
  const naturalRegenerationMaxAttempts =
    attemptNumber - (job?.attemptWithinGeneration ?? 0) + 3;
  let effectiveMaxAttempts = context.regeneration
    ? retryAdmission?.maxAttempts ?? naturalRegenerationMaxAttempts
    : retryAdmission?.effectiveMaxAttempts ?? 3;
  // Disconnected admission -> execution: a P3 regeneration-retry-budget
  // extension may already have been consumed by a prior, separate
  // prepareFailedStageRetry() call (a different process/invocation), whose
  // PipelineRetryAdmission cannot be carried here -- assertCanonicalPipeline
  // RetryAdmission requires the exact pre-mutation ("failed") job snapshot,
  // which no longer exists once the job is "queued" (see PipelineRetryAdmission.ts).
  // So instead of trusting an ambient admission object, independently
  // re-verify the real, on-disk, consumed P3 authority -- the same read-only
  // helper PipelineRunner.ts's own pre-execution guard already uses. Only
  // consulted when there is no in-process admission AND the natural,
  // unextended per-generation budget would otherwise be exceeded; never
  // widens the P1/P2 (non-regeneration) path or an ordinary within-budget
  // regeneration retry.
  if (context.regeneration && !retryAdmission && job &&
    attemptNumber + 1 > naturalRegenerationMaxAttempts) {
    const regenerationExtension = findConsumedRegenerationRetryBudgetExtension(
      context.projectSlug, context.stage, job,
    );
    if (regenerationExtension &&
      regenerationExtension.body.authorizedDurableOrdinal === attemptNumber + 1) {
      const lineage = await classifyProductionDurableAttemptLineage(
        adapter, context.projectSlug, context.stage,
        regenerationExtension.body.priorJob.attempts, "exact",
      );
      if (lineage.status === "valid") {
        effectiveMaxAttempts = regenerationExtension.body.authorizedDurableOrdinal;
      }
    }
  }
  const idempotencyPolicy = {
    ...defaultProductionExecutionIdempotencyPolicy,
    enabled: true,
    reservationTtlSeconds: ttlSeconds,
    maximumAttemptsByAction: {
      ...defaultProductionExecutionIdempotencyPolicy.maximumAttemptsByAction,
      "retry-stage": effectiveMaxAttempts,
      [authorizationAction]: effectiveMaxAttempts,
    },
  };
  const storagePolicy = {
    ...defaultProductionExecutionDurableStoragePolicy,
    enabled: true,
    reservationTtlSeconds: ttlSeconds,
    idempotencyPolicy,
  };
  const leasePolicy = {
    ...defaultProductionExecutionDurableLeasePolicy,
    reservationTtlSeconds: ttlSeconds,
    maximumLeaseDurationSeconds: ttlSeconds,
  };
  const claimPolicy = {
    ...defaultProductionExecutionClaimPolicy,
    reservationTtlSeconds: ttlSeconds,
  };
  const attemptPolicy = {
    ...defaultProductionExecutionAttemptPolicy,
    reservationTtlSeconds: ttlSeconds,
  };
  const idempotencyIdentity = buildProductionExecutionIdempotencyIdentity(
    { authorization, confirmation }, { evaluatedAt: anchor, policy: idempotencyPolicy },
  ).identity!;
  const retryBudgetExtension = retryAdmission?.retryBudgetAuthorityProof
    ? buildRetryBudgetExtensionDurableBinding({
        authorityId: retryAdmission.retryBudgetAuthorityProof.authorityId,
        authorityIntegrityFingerprint:
          retryAdmission.retryBudgetAuthorityProof.authorityIntegrityFingerprint,
        consumptionReceiptFingerprint:
          retryAdmission.retryBudgetAuthorityProof.consumptionReceiptFingerprint,
        projectSlug: context.projectSlug,
        stage: context.stage,
        jobId: `${context.projectSlug}-${context.stage}`,
        identityFingerprint: idempotencyIdentity.identityFingerprint,
        reservationBinding: idempotencyIdentity.identityFingerprint,
      })
    : undefined;
  if (retryAdmission) {
    const binding = retryAdmission.admittedExecutionBinding;
    const actualBinding = {
      identity: planned, operation: planIdentity.operation,
      durableOrdinal: attemptNumber + 1, maxAttempts: effectiveMaxAttempts,
      reservationId: idempotencyIdentity.identityFingerprint,
      workerId, workerSessionId: sessionId,
      recordVersion: 1, reservationVersion: 1, claimVersion: 1,
      attemptVersion: 1, leaseVersion: 1,
      reservationIdentityFingerprint: idempotencyIdentity.identityFingerprint,
      recordIntegrityFingerprint: idempotencyIdentity.identityFingerprint,
      recordIntegrityVersion: 1,
    };
    if (stableProductionValue(actualBinding) !== stableProductionValue(binding)) {
      throw new ProductionPipelineDurableExecutionError(
        "Pipeline retry admitted execution binding changed.",
        "PIPELINE_RETRY_EXECUTION_ADMISSION_FAILED",
      );
    }
  }
  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);
  const leases = new AdapterBackedProductionExecutionDurableLeaseService(adapter);
  const claims = new AdapterBackedProductionExecutionClaimService(adapter);
  const attempts = new AdapterBackedProductionExecutionAttemptService(adapter);
  const reservation: ProductionExecutionIdempotencyReservationRequest = {
    schemaVersion: "1", identity: idempotencyIdentity, authorization, confirmation,
    requestedAt: anchor, expectedInitialState: "reserved", attempt: attemptNumber + 1,
    maxAttempts: effectiveMaxAttempts, reservationTtlSeconds: ttlSeconds,
    policyContext: { source: "server", environment: "hosted" }, metadata: { source: "server" },
    ...(retryBudgetExtension ? { retryBudgetExtension } : {}),
  };
  const record: ProductionExecutionIdempotencyRecord = {
    schemaVersion: "1", recordId: planned.recordId,
    identityFingerprint: idempotencyIdentity.identityFingerprint,
    idempotencyKey: idempotencyIdentity.idempotencyKey, requestId: idempotencyIdentity.requestId,
    executionFingerprint: idempotencyIdentity.executionFingerprint,
    bindingFingerprint: idempotencyIdentity.bindingFingerprint, actorId: idempotencyIdentity.actorId,
    projectSlug: idempotencyIdentity.projectSlug, operation: idempotencyIdentity.operation,
    action: idempotencyIdentity.action, stage: idempotencyIdentity.stage,
    authorizationDecisionId: idempotencyIdentity.authorizationDecisionId,
    confirmationRequestId: idempotencyIdentity.confirmationRequestId,
    confirmationId: idempotencyIdentity.confirmationId, policyVersion: idempotencyIdentity.policyVersion,
    riskLevel: idempotencyIdentity.riskLevel, state: "reserved", attempt: attemptNumber + 1,
    maxAttempts: effectiveMaxAttempts, createdAt: anchor, updatedAt: anchor, reservedAt: anchor,
    evidence: ["source:pipeline-composition"],
    integrity: { algorithm: "stable-production-id-v1",
      fingerprint: idempotencyIdentity.identityFingerprint, version: 1 },
    ...(retryBudgetExtension ? { retryBudgetExtension } : {}),
  };
  const reservationRead = await adapter.read("reservation", idempotencyIdentity.identityFingerprint);
  if (reservationRead.status !== "found") {
    const created = await storage.createReservation(reservation, {
      evaluatedAt: anchor, policy: storagePolicy,
    });
    if (!created.ok || !created.reservation) {
      const raced = await adapter.read(
        "reservation",
        idempotencyIdentity.identityFingerprint,
      );
      if (raced.status !== "found" ||
        stableProductionValue(raced.value) !== stableProductionValue(reservation)) {
        // Genuine failure (not a benign concurrent-creation race that the
        // read above resolved): record the store's reason before the opaque
        // outward error.
        console.error(
          "[ProductionPipelineExecutionFactory] durable reservation creation failed:",
          created.reasonCode ?? "unknown",
          (created as { conflict?: unknown }).conflict ? "(conflict)" : "",
        );
        throw new ProductionPipelineDurableExecutionError(
          "Pipeline durable reservation preparation failed.",
          created.reasonCode,
        );
      }
    }
  }
  let existingRecord = await storage.read(record.recordId);
  if (!existingRecord.record) {
    const created = await storage.createRecord(record, { evaluatedAt: anchor, policy: storagePolicy });
    if (!created.ok || !created.record) {
      const raced = await storage.read(record.recordId);
      if (!raced.record ||
        raced.record.identityFingerprint !== record.identityFingerprint ||
        raced.record.attempt !== record.attempt ||
        raced.record.maxAttempts !== record.maxAttempts) {
        throw new ProductionPipelineDurableExecutionError(
          "Pipeline durable record preparation failed.",
          created.reasonCode,
        );
      }
    }
    existingRecord = await storage.read(record.recordId);
  } else if (existingRecord.record.state === "cancelled") {
    const transitionRequest: ProductionExecutionIdempotencyTransitionRequest = {
      schemaVersion: "1",
      recordId: record.recordId,
      idempotencyKey: planIdentity.idempotencyKey,
      fromState: "cancelled",
      toState: "reserved",
      expectedVersion: existingRecord.actualVersion ?? 1,
      attempt: record.attempt,
      transitionedAt: anchor,
      actorId: "pipeline-system",
      reasonCode: "RESERVED_FOR_RESTART",
      evidence: ["source:pipeline-composition"],
    };
    await storage.transition(
      record.recordId,
      transitionRequest,
      { evaluatedAt: anchor, policy: idempotencyPolicy },
    );
    existingRecord = await storage.read(record.recordId);
  }
  const worker = { schemaVersion: "1" as const, workerId, workerType: "server" as const,
    operationScope: [planIdentity.operation], identitySource: "trusted-server" as const };
  const session = { schemaVersion: "1" as const, workerSessionId: sessionId, workerId,
    startedAt: anchor, identitySource: "trusted-server" as const };
  const terminalReplay = existingRecord.record?.state === "succeeded" &&
    existingRecord.record.durableLease?.status === "released";
  if (!terminalReplay) {
    const expectedVersion = existingRecord.actualVersion ?? 1;
    const acquired = await leases.acquire({ recordId: record.recordId, expectedVersion,
      evaluatedAt: anchor, worker, session, leaseId: planned.leaseId, acquiredAt: anchor,
      heartbeatAt: anchor, expiresAt: new Date(Date.parse(anchor) + ttlSeconds * 1000).toISOString(),
      ...(retryBudgetExtension ? { retryBudgetExtension } : {}) },
    leasePolicy);
    if (!acquired.ok && acquired.reasonCode !== "LEASE_REPLAYED" && acquired.reasonCode !== "LEASE_TERMINAL_STATE") {
      throw new ProductionPipelineDurableExecutionError(
        "Pipeline durable lease preparation failed.",
        acquired.reasonCode,
      );
    }
  }
  existingRecord = await storage.read(record.recordId);
  const existingClaim = await claims.readExecutionClaim(planned.claimId);
  const claimRequest = {
    claimId: planned.claimId, recordId: record.recordId,
    reservationId: existingRecord.record?.identityFingerprint ?? idempotencyIdentity.identityFingerprint,
    requestId: planIdentity.requestId, idempotencyKey: planIdentity.idempotencyKey,
    operation: record.operation, executionFingerprint: planned.executionFingerprint,
    workerId, workerSessionId: sessionId, leaseId: planned.leaseId,
    expectedReservationVersion: 1, expectedIdempotencyVersion: existingRecord.actualVersion ?? 2,
    expectedLeaseVersion: existingRecord.record?.durableLease?.version ?? 1,
    expectedClaimVersion: existingClaim.claim?.claimVersion ?? 0, evaluatedAt: now,
    ...(retryBudgetExtension ? { retryBudgetExtension } : {}),
  };
  if (!terminalReplay) {
    const claimed = await claims.acquireExecutionClaim(claimRequest, claimPolicy);
    if (!claimed.ok && claimed.reasonCode !== "CLAIM_REPLAYED" && claimed.reasonCode !== "CLAIM_TERMINAL_STATE") {
      throw new ProductionPipelineDurableExecutionError(
        "Pipeline durable execution could not start.",
        claimed.reasonCode,
      );
    }
  }
  const existingAttempt = await attempts.readExecutionAttempt(planned.attemptId);
  const attemptRequest = {
    attemptId: planned.attemptId, claimId: planned.claimId,
    reservationId: existingRecord.record?.identityFingerprint ?? idempotencyIdentity.identityFingerprint, recordId: record.recordId,
    requestId: planIdentity.requestId, idempotencyKey: planIdentity.idempotencyKey,
    operation: record.operation, executionFingerprint: planned.executionFingerprint,
    workerId, workerSessionId: sessionId, leaseId: planned.leaseId,
    expectedClaimVersion: existingClaim.claim?.claimVersion ?? 1,
    expectedAttemptVersion: existingAttempt.attempt?.attemptVersion ?? 0, evaluatedAt: now,
    ...(retryBudgetExtension ? { retryBudgetExtension } : {}),
  };
  const plannedRequest: ProductionExecutionWorkerExecutionRequest = {
    coordinator: { claim: claimRequest, attempt: attemptRequest },
    policy: { claim: claimPolicy, attempt: attemptPolicy }, runningAt: now, finishedAt: now,
    runningEventId: planned.runningEventId, terminalEventId: planned.terminalEventId,
  };
  if (!terminalReplay) {
    const coordinated = await new ProductionExecutionCoordinator(adapter).coordinate(
      plannedRequest.coordinator, plannedRequest.policy,
    );
    const codeStr = String(coordinated.reasonCode);
    if (!coordinated.ok && codeStr !== "CLAIM_REPLAYED" && codeStr !== "CLAIM_TERMINAL_STATE" && codeStr !== "ATTEMPT_REPLAYED" && codeStr !== "ATTEMPT_TERMINAL_STATE" && (!coordinated.attempt && codeStr !== "CLAIM_TERMINAL_STATE")) {
      throw new ProductionPipelineDurableExecutionError(
        "Pipeline durable attempt preparation failed.", coordinated.reasonCode,
      );
    }
  }
  await emitProductionPipelineExecutionEvent("durable-attempt-persisted");
  const completed = await readCompletedDurableRecords(adapter, storage, {
    reservationId: existingRecord.record?.identityFingerprint ?? idempotencyIdentity.identityFingerprint,
    recordId: record.recordId,
    claimId: planned.claimId,
    attemptId: planned.attemptId,
  }, now);
  const durableStage = completed.record.stage;
  const durableRunType = runTypeFromOperation(completed.record.operation);
  const durableAttemptNumber = completed.record.attempt - 1;
  if (!durableStage || durableStage !== context.stage || durableRunType !== context.runType ||
    !Number.isInteger(durableAttemptNumber) || durableAttemptNumber < 0 ||
    durableAttemptNumber !== attemptNumber) {
    throw new Error("Pipeline durable preparation scope verification failed.");
  }
  const canonicalIdentity = Object.freeze({
    projectSlug: completed.record.projectSlug, stage: durableStage, runType: durableRunType,
    attemptNumber: durableAttemptNumber, attemptId: completed.attempt.identity.attemptId,
    recordId: completed.attempt.identity.recordId,
    reservationId: completed.attempt.identity.reservationId,
    claimId: completed.attempt.identity.claimId,
    leaseId: completed.lease.identity.leaseId,
    requestId: completed.attempt.identity.requestId,
    idempotencyKey: completed.attempt.identity.idempotencyKey,
    operation: completed.record.operation,
    executionFingerprint: completed.attempt.identity.executionFingerprint,
    durableAttemptRequired: true as const,
    ...(context.regeneration ? { regeneration: Object.freeze({ ...context.regeneration }) } : {}),
  });
  assertCompletedBindings(completed);
  assertCompletedCanonicalIdentityBindings(completed, canonicalIdentity);
  await emitProductionPipelineExecutionEvent("durable-readback-verified");
  poisonProductionPipelineExecutionPlanAfterDurableAttempt(planIdentity);
  const completedRequest: ProductionExecutionWorkerExecutionRequest = {
    coordinator: {
      claim: { ...claimRequest, claimId: completed.claim.identity.claimId,
        recordId: completed.claim.identity.recordId,
        reservationId: completed.claim.identity.reservationId,
        requestId: completed.claim.identity.requestId,
        idempotencyKey: completed.claim.identity.idempotencyKey,
        operation: completed.record.operation,
        executionFingerprint: completed.claim.identity.executionFingerprint,
        leaseId: completed.claim.identity.leaseId },
      attempt: { ...attemptRequest, ...completed.attempt.identity,
        operation: completed.record.operation, expectedClaimVersion: completed.attempt.binding.claimVersion },
    },
    policy: plannedRequest.policy, runningAt: now, finishedAt: now,
    runningEventId: planned.runningEventId, terminalEventId: planned.terminalEventId,
  };
  const authority = Object.freeze(Object.create(null)) as
    ProductionPipelineCompletedPreparationAuthority;
  const runtime = getActiveProductionRuntimeOperationContext();
  if (!runtime) throw new ProductionPipelineDurableExecutionError(
    "Pipeline durable preparation runtime authority is missing.",
    "WORKER_EXECUTION_COORDINATION_FAILED",
  );
  const resolvedStoreAuthority = await capturePhysicalStoreAuthority(resolvedStoreRoot);
  const resolvedStoreIdentity = resolvedStoreAuthority.identity;
  const authorityData = Object.freeze({ ...deepFreeze({ canonicalIdentity,
    leaseId: completed.lease.identity.leaseId, ...completed, request: completedRequest }),
    storeRoot: resolvedStoreRoot,
    storeIdentity: resolvedStoreIdentity,
    storeEntries: resolvedStoreAuthority.entries,
    runtimeAuthorityIdentity: runtime.authority.authorityIdentity,
    runtimeOperationBinding: runtime.bindingFingerprint,
    providerSelection,
    provenanceFingerprint: completedPreparationProvenanceFingerprint({
      completed, canonicalIdentity, storeIdentity: resolvedStoreIdentity,
      runtimeAuthorityIdentity: runtime.authority.authorityIdentity,
      runtimeOperationBinding: runtime.bindingFingerprint,
      providerSelection,
      request: completedRequest,
    }) });
  completedPreparations.set(authority as object, authorityData);
  await emitProductionPipelineExecutionEvent("canonical-identity-extracted");
  const callerVisibleAdapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: resolvedStoreRoot,
  });
  return { adapter: callerVisibleAdapter, executionAdapter: adapter,
    request: completedRequest, authority,
    settlement: { adapter, request: completedRequest, idempotencyPolicy, leasePolicy, worker, session } };
}

async function assertReconciledRetryLineageBinding(
  adapter: ProductionExecutionFilePersistenceAdapter,
  admission: NonNullable<ReturnType<typeof getProductionAcceptanceRetryAdmission>>,
): Promise<void> {
  const expected = admission.exactReconciledLineageBinding;
  const identity = admission.exactReconciledDurableLineageIdentity;
  if (expected.state === "none") {
    const [record, claim, attempt] = await Promise.all([
      readLatestVersionedBinding(adapter, "idempotency", identity.recordId),
      readLatestVersionedBinding(adapter, "claim", identity.claimId),
      readLatestVersionedBinding(adapter, "attempt", identity.attemptId),
    ]);
    if (record || claim || attempt) throw new Error("retry lineage unexpectedly exists");
    return;
  }
  try {
    await readProductionCanonicalTerminalDurableLineage(
      adapter, identity, expected.reservationId, expected,
    );
  } catch (error) {
    if (error instanceof ProductionPipelineDurableExecutionError) throw error;
    throw createProductionDurableAttemptLineageBindingError("version-contiguity");
  }
}

async function readLatestVersionedBinding(
  adapter: ProductionExecutionFilePersistenceAdapter,
  kind: "idempotency" | "claim" | "attempt",
  identity: string,
): Promise<unknown | undefined> {
  const listed = await adapter.listKeys(kind);
  if (!listed.ok) throw new Error("retry lineage list failed");
  const latest = listed.keys.map((key) => ({ key,
    version: Number(new RegExp(`^${escapeRegularExpression(identity)}-v([1-9][0-9]*)$`)
      .exec(key)?.[1]) }))
    .filter((item) => Number.isSafeInteger(item.version))
    .sort((left, right) => left.version - right.version).at(-1);
  if (!latest) return undefined;
  const read = await adapter.read(kind, latest.key);
  if (read.status !== "found") throw new Error("retry lineage read failed");
  return read.value;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readCompletedDurableRecords(
  adapter: ProductionExecutionFilePersistenceAdapter,
  storage: AdapterBackedProductionExecutionDurableStorage,
  ids: { reservationId: string; recordId: string; claimId: string; attemptId: string },
  evaluatedAt: string,
) {
  const reservation = await adapter.read("reservation", ids.reservationId);
  const record = await storage.read(ids.recordId);
  const claim = await readLatestVersioned<ProductionExecutionDurableClaimRecord>(
    adapter, "claim", ids.claimId,
  );
  const attempt = await new ProductionExecutionLifecycle(adapter).inspect(ids.attemptId, evaluatedAt);
  if (reservation.status !== "found" || !record.record || !record.record.durableLease ||
    !claim || !attempt.attempt || !validateProductionExecutionDurableClaim(claim) ||
    !validateProductionExecutionDurableAttempt(attempt.attempt) ||
    !validateProductionExecutionDurableLease(record.record.durableLease)) {
    throw new Error("Pipeline durable preparation readback failed.");
  }
  return { reservation: reservation.value as ProductionExecutionIdempotencyReservationRequest,
    record: record.record, lease: record.record.durableLease, claim, attempt: attempt.attempt };
}

async function readLatestVersioned<T>(
  adapter: ProductionExecutionFilePersistenceAdapter,
  kind: "claim" | "attempt",
  identity: string,
): Promise<T | undefined> {
  const listed = await adapter.listKeys(kind);
  if (!listed.ok) return undefined;
  const prefix = `${identity}-v`;
  const key = listed.keys.filter((candidate) => candidate.startsWith(prefix))
    .sort((left, right) => Number(right.slice(prefix.length)) - Number(left.slice(prefix.length)))[0];
  if (!key) return undefined;
  const read = await adapter.read(kind, key);
  return read.status === "found" ? read.value as T : undefined;
}

function assertCompletedBindings(completed: {
  reservation: ProductionExecutionIdempotencyReservationRequest;
  record: ProductionExecutionDurableRecord;
  lease: ProductionExecutionDurableLease;
  claim: ProductionExecutionDurableClaimRecord;
  attempt: ProductionExecutionDurableAttemptRecord;
}): void {
  const { reservation, record, lease, claim, attempt } = completed;
  const exact = reservation.identity.requestId === record.requestId &&
    record.requestId === claim.identity.requestId && claim.identity.requestId === attempt.identity.requestId &&
    reservation.identity.idempotencyKey === record.idempotencyKey &&
    record.idempotencyKey === claim.identity.idempotencyKey &&
    claim.identity.idempotencyKey === attempt.identity.idempotencyKey &&
    reservation.identity.operation === record.operation && claim.identity.operation === record.operation &&
    attempt.identity.operation === record.operation &&
    reservation.identity.identityFingerprint === claim.identity.reservationId &&
    claim.identity.reservationId === attempt.identity.reservationId &&
    claim.identity.claimId === attempt.identity.claimId && claim.identity.leaseId === attempt.identity.leaseId &&
    lease.identity.leaseId === attempt.identity.leaseId &&
    reservation.identity.executionFingerprint === attempt.identity.executionFingerprint;
  if (!exact) throw new Error("Pipeline durable preparation binding verification failed.");
}

/** @internal Read-only durable lineage admission used before any preparation write. */
export async function resolveDurableAttemptOrdinal(
  adapter: ProductionExecutionFilePersistenceAdapter,
  projectSlug: string,
  stage: string,
  expectedJobAttempt: number,
): Promise<number> {
  const listed = await adapter.listKeys("idempotency");
  if (listed.ok && listed.keys.length > 0) {
    // listKeys("idempotency") returns every write-once version file for every
    // record, not just the latest — dedupe to each record's highest
    // recordVersion before inspecting `state` below (P2's trailing-orphan
    // check needs the record's *current* state, not an arbitrary older one).
    const latestByRecordId = new Map<string, { attempt: number; state: string;
      recordId: string; recordVersion: number }>();
    for (const key of listed.keys) {
      const read = await adapter.read("idempotency", key);
      if (read.status === "found" && read.value.projectSlug === projectSlug && read.value.stage === stage) {
        const existing = latestByRecordId.get(read.value.recordId);
        if (!existing || read.value.integrity.version > existing.recordVersion) {
          latestByRecordId.set(read.value.recordId, { attempt: read.value.attempt,
            state: read.value.state, recordId: read.value.recordId,
            recordVersion: read.value.integrity.version });
        }
      }
    }
    const applicable = [...latestByRecordId.values()];
    if (applicable.length > 0) {
      applicable.sort((left, right) => left.attempt - right.attempt);
      // P2: mirror classifyProductionDurableAttemptLineage's trailing-orphan
      // exclusion (see that file) so the scanned "max" driving preparation-
      // mode classification stays consistent with it. A cancelled reservation
      // that never became a real attempt (no claim, no attempt record) must
      // not be counted as the durable maximum, or the next preparation would
      // mint a fresh attempt past it instead of reopening it.
      while (applicable.length > 1 && applicable[applicable.length - 1].state === "cancelled") {
        const top = applicable[applicable.length - 1];
        const hasClaim = await anyDurableRecordReferencesRecordId(adapter, "claim", top.recordId);
        const hasAttempt = await anyDurableRecordReferencesRecordId(adapter, "attempt", top.recordId);
        if (hasClaim === "list-failed" || hasAttempt === "list-failed" || hasClaim || hasAttempt) break;
        applicable.pop();
      }
      const max = applicable[applicable.length - 1].attempt;
      const res = await classifyProductionDurableAttemptLineage(adapter, projectSlug, stage, max, "preparation");
      if (res.status !== "invalid") return res.durableOrdinal;
    }
  }
  const lineage = await classifyProductionDurableAttemptLineage(
    adapter, projectSlug, stage, expectedJobAttempt,
  );
  if (lineage.status === "invalid") throw durableAttemptLineageBindingError(lineage.boundary);
  return lineage.durableOrdinal;
}

function durableAttemptLineageBindingError(
  boundary: ProductionDurableAttemptLineageBoundary,
): ProductionPipelineDurableExecutionError {
  return createProductionDurableAttemptLineageBindingError(boundary);
}

function assertCompletedCanonicalIdentityBindings(
  completed: {
    reservation: ProductionExecutionIdempotencyReservationRequest;
    record: ProductionExecutionDurableRecord;
    lease: ProductionExecutionDurableLease;
    claim: ProductionExecutionDurableClaimRecord;
    attempt: ProductionExecutionDurableAttemptRecord;
  },
  identity: ProductionAcceptanceStageExecutionIdentity,
): void {
  const { reservation, record, lease, claim, attempt } = completed;
  const exact = reservation.identity.projectSlug === identity.projectSlug &&
    reservation.identity.stage === identity.stage &&
    reservation.identity.requestId === identity.requestId &&
    reservation.identity.idempotencyKey === identity.idempotencyKey &&
    reservation.identity.operation === identity.operation &&
    reservation.identity.identityFingerprint === identity.reservationId &&
    reservation.identity.executionFingerprint === identity.executionFingerprint &&
    record.projectSlug === identity.projectSlug && record.stage === identity.stage &&
    record.recordId === identity.recordId && record.requestId === identity.requestId &&
    record.idempotencyKey === identity.idempotencyKey && record.operation === identity.operation &&
    record.identityFingerprint === identity.reservationId &&
    record.executionFingerprint === identity.executionFingerprint &&
    record.attempt === identity.attemptNumber + 1 &&
    lease.identity.leaseId === identity.leaseId && lease.identity.recordId === identity.recordId &&
    lease.identity.requestId === identity.requestId &&
    lease.identity.idempotencyKey === identity.idempotencyKey &&
    lease.identity.executionFingerprint === identity.executionFingerprint &&
    claim.identity.claimId === identity.claimId && claim.identity.recordId === identity.recordId &&
    claim.identity.reservationId === identity.reservationId &&
    claim.identity.requestId === identity.requestId &&
    claim.identity.idempotencyKey === identity.idempotencyKey &&
    claim.identity.operation === identity.operation && claim.identity.leaseId === identity.leaseId &&
    claim.identity.executionFingerprint === identity.executionFingerprint &&
    attempt.identity.attemptId === identity.attemptId &&
    attempt.identity.claimId === identity.claimId && attempt.identity.recordId === identity.recordId &&
    attempt.identity.reservationId === identity.reservationId &&
    attempt.identity.requestId === identity.requestId &&
    attempt.identity.idempotencyKey === identity.idempotencyKey &&
    attempt.identity.operation === identity.operation &&
    attempt.identity.leaseId === identity.leaseId &&
    attempt.identity.executionFingerprint === identity.executionFingerprint;
  if (!exact) throw new Error("Pipeline durable preparation canonical identity mismatch.");
}

type CompletedDurableReadback = {
    reservation: ProductionExecutionIdempotencyReservationRequest;
    record: ProductionExecutionDurableRecord;
    lease: ProductionExecutionDurableLease;
    claim: ProductionExecutionDurableClaimRecord;
    attempt: ProductionExecutionDurableAttemptRecord;
};

function completedPreparationProvenanceFingerprint(input: {
  completed: CompletedDurableReadback;
  canonicalIdentity: ProductionAcceptanceStageExecutionIdentity;
  storeIdentity: string;
  runtimeAuthorityIdentity: string;
  runtimeOperationBinding: string;
  providerSelection: ProductionAcceptanceProviderSelection;
  request: ProductionExecutionWorkerExecutionRequest;
}): string {
  return digestStable({
    version: "pipeline-completed-preparation-provenance-v2",
    storeIdentity: input.storeIdentity,
    runtimeAuthorityIdentity: input.runtimeAuthorityIdentity,
    runtimeOperationBinding: input.runtimeOperationBinding,
    providerSelection: serializableProductionAcceptanceProviderSelection(input.providerSelection),
    expectedRunningTransitionFingerprint: digestStable(expectedRunningEntry(
      input.completed.attempt, input.request,
    )),
    identity: input.canonicalIdentity,
    durableAttemptRequired: input.canonicalIdentity.durableAttemptRequired === true,
    reservation: input.completed.reservation,
    record: input.completed.record,
    lease: input.completed.lease,
    claim: input.completed.claim,
    attempt: input.completed.attempt,
  });
}

function completedPreparationTransition(
  initial: CompletedDurableReadback,
  current: CompletedDurableReadback,
  request: ProductionExecutionWorkerExecutionRequest,
): "unchanged" | "attempt-opened-to-active-v1" {
  for (const key of ["reservation", "record", "lease", "claim"] as const) {
    if (stableProductionValue(initial[key]) !== stableProductionValue(current[key])) {
      throw new Error("Pipeline durable preparation transition mutated immutable records.");
    }
  }
  if (stableProductionValue(initial.attempt) === stableProductionValue(current.attempt)) {
    return "unchanged";
  }
  const previous = initial.attempt;
  const next = current.attempt;
  const previousWithoutMutable = { ...previous, integrity: undefined };
  const nextWithoutMutable = { ...next, state: previous.state, attemptVersion: previous.attemptVersion,
    updatedAt: previous.updatedAt, journal: previous.journal, integrity: undefined };
  const appended = next.journal.at(-1);
  const expected = expectedRunningEntry(previous, request);
  if (previous.state !== "opened" || next.state !== "active" ||
    next.attemptVersion !== previous.attemptVersion + 1 ||
    next.journal.length !== previous.journal.length + 1 ||
    stableProductionValue(next.journal.slice(0, -1)) !== stableProductionValue(previous.journal) ||
    stableProductionValue(previousWithoutMutable) !== stableProductionValue(nextWithoutMutable) ||
    next.updatedAt !== request.runningAt ||
    stableProductionValue(appended) !== stableProductionValue(expected)) {
    throw new Error("Pipeline durable preparation lifecycle transition is invalid.");
  }
  return "attempt-opened-to-active-v1";
}

function expectedRunningEntry(
  attempt: ProductionExecutionDurableAttemptRecord,
  request: ProductionExecutionWorkerExecutionRequest,
) {
  const entry = { entryId: request.runningEventId, attemptId: attempt.identity.attemptId,
    sequence: attempt.journal.length + 1, entryType: "CHECKPOINT_RECORDED" as const,
    recordedAt: request.runningAt,
    payload: { code: "WORKER_RUNNING", category: "lifecycle-running",
      summary: "Worker execution running." }, evidence: ["worker:running"] };
  return { ...entry, integrity: { algorithm: "stable-production-id-v1" as const,
    fingerprint: stableProductionId("attempt-journal-entry-integrity", entry) } };
}

function completedPreparationIssuanceFingerprint(input: {
  initialFingerprint: string;
  transition: "unchanged" | "attempt-opened-to-active-v1";
  current: CompletedDurableReadback;
  identity: ProductionAcceptanceStageExecutionIdentity;
  executionScope: ProductionAcceptanceStageExecutionScope;
  storeIdentity: string;
  runtimeAuthorityIdentity: string;
  runtimeOperationBinding: string;
}): string {
  return digestStable({
    version: "pipeline-completed-preparation-issuance-v2",
    predecessorFingerprint: input.initialFingerprint,
    transition: input.transition,
    storeIdentity: input.storeIdentity,
    runtimeAuthorityIdentity: input.runtimeAuthorityIdentity,
    runtimeOperationBinding: input.runtimeOperationBinding,
    identity: input.identity,
    executionScope: serializableProductionAcceptanceExecutionScope(input.executionScope),
    reservation: input.current.reservation,
    record: input.current.record,
    lease: input.current.lease,
    claim: input.current.claim,
    attempt: input.current.attempt,
  });
}

function assertExecutionScopeMatchesIdentity(
  scope: ProductionAcceptanceStageExecutionScope,
  identity: ProductionAcceptanceStageExecutionIdentity,
): void {
  if (scope.projectSlug !== identity.projectSlug || scope.stage !== identity.stage ||
    scope.runType !== identity.runType || scope.operation !== identity.operation ||
    scope.executionFingerprint !== identity.executionFingerprint ||
    stableProductionValue(scope.regeneration) !== stableProductionValue(identity.regeneration) ||
    stableProductionValue(scope.providerCapabilityScope) !== stableProductionValue(
      productionAcceptanceProviderCapabilitiesForStage(identity.stage),
    )) {
    throw new Error("Pipeline durable preparation execution scope mismatch.");
  }
}

function runTypeFromOperation(operation: string): ProductionAcceptanceStageExecutionIdentity["runType"] {
  const match = /^pipeline\.stage\.(initial|resume|retry)$/.exec(operation);
  if (!match) throw new Error("Pipeline durable preparation operation scope is invalid.");
  return match[1] as ProductionAcceptanceStageExecutionIdentity["runType"];
}

function canonicalStoreRoot(value: string): string {
  const resolved = path.normalize(path.resolve(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function physicalStoreIdentity(root: string): Promise<string> {
  const [real, stat] = await Promise.all([
    trustedFileOperations.realpath(root), trustedFileOperations.stat(root, { bigint: true }),
  ]);
  if (!stat.isDirectory()) throw new Error("Pipeline durable physical store identity is unavailable.");
  return digestStable({ version: "production-execution-physical-store-root-v2",
    canonicalRoot: canonicalStoreRoot(root), realRoot: canonicalStoreRoot(real),
    device: stat.dev.toString(10), inode: stat.ino.toString(10),
    birthtimeNs: stat.birthtimeNs.toString(10) });
}

interface PhysicalStoreAuthority {
  readonly identity: string;
  readonly entries: Readonly<Record<string, string>>;
}

async function capturePhysicalStoreAuthority(root: string): Promise<PhysicalStoreAuthority> {
  const canonicalRoot = canonicalStoreRoot(root);
  const entries: Record<string, string> = {};
  const visit = async (target: string): Promise<void> => {
    const relative = canonicalStoreRoot(target) === canonicalRoot
      ? "." : path.relative(root, target).replaceAll("\\", "/");
    const link = await trustedFileOperations.lstat(target, { bigint: true });
    if (link.isSymbolicLink() || (!link.isDirectory() && !link.isFile())) {
      throw new Error("Pipeline durable physical store entry is unsupported.");
    }
    entries[relative] = physicalDescriptorIdentity(link);
    if (link.isDirectory()) {
      const names = await trustedFileOperations.readdir(target);
      for (const name of [...names].sort()) await visit(path.join(target, name));
    }
  };
  await visit(root);
  const frozenEntries = Object.freeze({ ...entries });
  return Object.freeze({
    identity: await physicalStoreIdentity(root),
    entries: frozenEntries,
  });
}

function physicalDescriptorIdentity(stat: BigIntFileStat): string {
  if (stat.dev === BigInt(0) && stat.ino === BigInt(0)) {
    throw new Error("Pipeline durable physical store identity is unavailable.");
  }
  return digestStable({ type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
    device: stat.dev.toString(10), inode: stat.ino.toString(10),
    birthtimeNs: stat.birthtimeNs.toString(10), ctimeNs: stat.ctimeNs.toString(10),
    mtimeNs: stat.mtimeNs.toString(10), size: stat.size.toString(10) });
}

function createTrustedPersistenceReader(
  root: string,
  createRootDirectory = false,
  expectedStoreAuthority?: PhysicalStoreAuthority,
): ProductionExecutionFilePersistenceAdapter {
  const reader = new ProductionExecutionFilePersistenceAdapter({ trustedRootDirectory: root,
    createRootDirectory,
    trustedFileOperations: descriptorBoundFileOperations(root, expectedStoreAuthority) });
  Object.setPrototypeOf(reader, trustedPersistencePrototype);
  return Object.seal(reader);
}

function descriptorBoundFileOperations(root: string, expectedStoreAuthority?: PhysicalStoreAuthority) {
  return Object.freeze({ ...trustedFileOperations,
    readFile: async (filePath: string, encoding: "utf8") => {
      if (expectedStoreAuthority &&
        await physicalStoreIdentity(root) !== expectedStoreAuthority.identity) {
        throw new Error("Pipeline durable physical store authority changed before record read.");
      }
      await emitProductionPipelineExecutionEvent("descriptor-path-verified");
      const rootHandle = await trustedFileOperations.open(root, "r");
      let fileHandle: Awaited<ReturnType<typeof trustedFileOperations.open>> | undefined;
      try {
        const rootBefore = await rootHandle.stat({ bigint: true });
        await emitProductionPipelineExecutionEvent("descriptor-root-opened");
        const rootLinkBefore = await trustedFileOperations.lstat(root, { bigint: true });
        const realBefore = await trustedFileOperations.realpath(root);
        assertDirectoryDescriptorParity(rootBefore, rootLinkBefore);
        assertExpectedDescriptor(root, root, rootBefore, expectedStoreAuthority);
        const parentPath = path.dirname(filePath);
        await emitProductionPipelineExecutionEvent("descriptor-parent-opening",
          { locator: relativeStoreLocator(root, parentPath) });
        const parentHandle = await trustedFileOperations.open(parentPath, "r");
        try {
          const parentBefore = await parentHandle.stat({ bigint: true });
          await emitProductionPipelineExecutionEvent("descriptor-parent-opened",
            { locator: relativeStoreLocator(root, parentPath) });
          const parentLinkBefore = await trustedFileOperations.lstat(parentPath, { bigint: true });
          assertDirectoryDescriptorParity(parentBefore, parentLinkBefore);
          assertExpectedDescriptor(root, parentPath, parentBefore, expectedStoreAuthority);
        await emitProductionPipelineExecutionEvent("descriptor-file-opening",
          { locator: relativeStoreLocator(root, filePath) });
        fileHandle = await trustedFileOperations.open(filePath, "r");
        await emitProductionPipelineExecutionEvent("descriptor-file-opened",
          { locator: relativeStoreLocator(root, filePath) });
        const linkBefore = await trustedFileOperations.lstat(filePath, { bigint: true });
        const before = await fileHandle.stat({ bigint: true });
        assertFileDescriptorParity(before, linkBefore);
        assertExpectedDescriptor(root, filePath, before, expectedStoreAuthority);
        const text = await fileHandle.readFile({ encoding });
        const after = await fileHandle.stat({ bigint: true });
        const linkAfter = await trustedFileOperations.lstat(filePath, { bigint: true });
        const rootAfter = await rootHandle.stat({ bigint: true });
        const rootLinkAfter = await trustedFileOperations.lstat(root, { bigint: true });
        const parentAfter = await parentHandle.stat({ bigint: true });
        const parentLinkAfter = await trustedFileOperations.lstat(parentPath, { bigint: true });
        const realAfter = await trustedFileOperations.realpath(root);
        assertExactFileDescriptor(before, after, linkAfter);
        assertExactDirectoryDescriptor(parentBefore, parentAfter, parentLinkAfter);
        assertExactDirectoryDescriptor(rootBefore, rootAfter, rootLinkAfter);
        if (canonicalStoreRoot(realBefore) !== canonicalStoreRoot(realAfter)) {
          throw new Error("Pipeline durable physical store realpath changed.");
        }
        if (expectedStoreAuthority &&
          await physicalStoreIdentity(root) !== expectedStoreAuthority.identity) {
          throw new Error("Pipeline durable physical store authority changed after record read.");
        }
        return text;
        } finally {
          await parentHandle.close().catch(() => undefined);
        }
      } finally {
        if (fileHandle) await fileHandle.close().catch(() => undefined);
        await rootHandle.close().catch(() => undefined);
      }
    },
    readdir: async (directoryPath: string) => {
      if (expectedStoreAuthority &&
        await physicalStoreIdentity(root) !== expectedStoreAuthority.identity) {
        throw new Error("Pipeline durable physical store authority changed before directory read.");
      }
      await emitProductionPipelineExecutionEvent("descriptor-path-verified");
      const rootHandle = await trustedFileOperations.open(root, "r");
      let directoryHandle: Awaited<ReturnType<typeof trustedFileOperations.open>> | undefined;
      try {
        const rootBefore = await rootHandle.stat({ bigint: true });
        await emitProductionPipelineExecutionEvent("descriptor-root-opened");
        const rootLinkBefore = await trustedFileOperations.lstat(root, { bigint: true });
        assertDirectoryDescriptorParity(rootBefore, rootLinkBefore);
        assertExpectedDescriptor(root, root, rootBefore, expectedStoreAuthority);
        await emitProductionPipelineExecutionEvent("descriptor-directory-opening",
          { locator: relativeStoreLocator(root, directoryPath) });
        directoryHandle = await trustedFileOperations.open(directoryPath, "r");
        await emitProductionPipelineExecutionEvent("descriptor-directory-opened",
          { locator: relativeStoreLocator(root, directoryPath) });
        const directoryBefore = await directoryHandle.stat({ bigint: true });
        const directoryLinkBefore = await trustedFileOperations.lstat(directoryPath, { bigint: true });
        assertDirectoryDescriptorParity(directoryBefore, directoryLinkBefore);
        assertExpectedDescriptor(root, directoryPath, directoryBefore, expectedStoreAuthority);
        const names = expectedStoreAuthority
          ? authoritativeDirectoryNames(root, directoryPath, expectedStoreAuthority)
          : await trustedFileOperations.readdir(directoryPath);
        const directoryAfter = await directoryHandle.stat({ bigint: true });
        const directoryLinkAfter = await trustedFileOperations.lstat(directoryPath, { bigint: true });
        const rootAfter = await rootHandle.stat({ bigint: true });
        const rootLinkAfter = await trustedFileOperations.lstat(root, { bigint: true });
        assertExactDirectoryDescriptor(directoryBefore, directoryAfter, directoryLinkAfter);
        assertExactDirectoryDescriptor(rootBefore, rootAfter, rootLinkAfter);
        if (expectedStoreAuthority &&
          await physicalStoreIdentity(root) !== expectedStoreAuthority.identity) {
          throw new Error("Pipeline durable physical store authority changed after directory read.");
        }
        return names;
      } finally {
        if (directoryHandle) await directoryHandle.close().catch(() => undefined);
        await rootHandle.close().catch(() => undefined);
      }
    } });
}

function authoritativeDirectoryNames(
  root: string,
  directoryPath: string,
  authority: PhysicalStoreAuthority,
): string[] {
  const relative = canonicalStoreRoot(directoryPath) === canonicalStoreRoot(root)
    ? "." : path.relative(root, directoryPath).replaceAll("\\", "/");
  const prefix = relative === "." ? "" : `${relative}/`;
  const names = new Set<string>();
  for (const entry of Object.keys(authority.entries)) {
    if (!entry.startsWith(prefix) || entry === relative) continue;
    const remainder = entry.slice(prefix.length);
    const name = remainder.split("/", 1)[0];
    if (name) names.add(name);
  }
  return [...names].sort();
}

function relativeStoreLocator(root: string, target: string): string {
  return canonicalStoreRoot(target) === canonicalStoreRoot(root)
    ? "." : path.relative(root, target).replaceAll("\\", "/");
}

type BigIntFileStat = BigIntStats;

function assertExpectedDescriptor(
  root: string,
  target: string,
  stat: BigIntFileStat,
  authority?: PhysicalStoreAuthority,
): void {
  if (!authority) return;
  const relative = canonicalStoreRoot(target) === canonicalStoreRoot(root)
    ? "." : path.relative(root, target).replaceAll("\\", "/");
  if (authority.entries[relative] !== physicalDescriptorIdentity(stat)) {
    throw new Error("Pipeline durable descriptor authority changed.");
  }
}

function assertDirectoryDescriptorParity(descriptor: BigIntFileStat, link: BigIntFileStat): void {
  if (!descriptor.isDirectory() || !link.isDirectory() || link.isSymbolicLink() ||
    descriptor.dev !== link.dev || descriptor.ino !== link.ino ||
    descriptor.birthtimeNs !== link.birthtimeNs) {
    throw new Error("Pipeline durable directory descriptor identity changed.");
  }
}

function assertFileDescriptorParity(descriptor: BigIntFileStat, link: BigIntFileStat): void {
  if (!descriptor.isFile() || !link.isFile() || link.isSymbolicLink() ||
    descriptor.dev !== link.dev || descriptor.ino !== link.ino ||
    descriptor.birthtimeNs !== link.birthtimeNs || descriptor.size !== link.size) {
    throw new Error("Pipeline durable record descriptor identity changed.");
  }
}

function assertExactDirectoryDescriptor(
  before: BigIntFileStat, after: BigIntFileStat, finalLink: BigIntFileStat,
): void {
  assertDirectoryDescriptorParity(after, finalLink);
  if (before.dev !== after.dev || before.ino !== after.ino ||
    before.birthtimeNs !== after.birthtimeNs || before.ctimeNs !== after.ctimeNs) {
    throw new Error("Pipeline durable directory descriptor changed during read.");
  }
}

function assertExactFileDescriptor(
  before: BigIntFileStat, after: BigIntFileStat, finalLink: BigIntFileStat,
): void {
  assertFileDescriptorParity(after, finalLink);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
    before.birthtimeNs !== after.birthtimeNs || before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs) {
    throw new Error("Pipeline durable record descriptor changed during read.");
  }
}

function digestStable(value: unknown): string {
  return createHash("sha256").update(canonicalProductionSecurityValue(value)).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

function claimProcessCompletedPreparations():
WeakMap<object, CompletedProductionPipelinePreparationRecord> {
  const existing = Object.getOwnPropertyDescriptor(globalThis, processCompletedPreparationsKey);
  if (existing) {
    // Adopt the real, already-claimed shared map if a prior module instance created it; never adopt a
    // foreign, non-WeakMap value that happens to occupy this exact process-global slot.
    return existing.value instanceof WeakMap
      ? existing.value
      : new WeakMap<object, CompletedProductionPipelinePreparationRecord>();
  }

  const map = new WeakMap<object, CompletedProductionPipelinePreparationRecord>();
  Object.defineProperty(globalThis, processCompletedPreparationsKey, {
    configurable: false,
    enumerable: false,
    value: map,
    writable: false,
  });
  const claimed = Object.getOwnPropertyDescriptor(globalThis, processCompletedPreparationsKey)?.value;
  return claimed === map ? map : new WeakMap<object, CompletedProductionPipelinePreparationRecord>();
}
