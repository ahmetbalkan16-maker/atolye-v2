import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import {
  planProductionAcceptanceLegacyReauthorization,
  reauthorizeProductionAcceptanceLegacyMarker,
} from "../src/lib/production/ProductionAcceptanceLegacyReauthorizationService";
import {
  canonicalJson,
  deriveLegacyReauthorizationId,
  integrityFor,
  legacyReauthorizationReceiptPolicyVersion,
  legacyReauthorizationSchemaVersion,
  ProductionAcceptanceLegacyReauthorizationError,
  sha256Bytes,
} from "../src/lib/production/ProductionAcceptanceLegacyReauthorization";
import {
  diagnoseProductionAcceptanceConfiguration,
  prepareProductionAcceptanceMarkerReprepare,
  ProductionAcceptancePolicyError,
  productionAcceptanceConfigurationFingerprint,
  productionAcceptanceRequestFingerprint,
  resolveEffectiveProductionAcceptanceAuthority,
  issueProductionAcceptanceStageCapability,
  consumeProductionAcceptanceStageCapability,
  type ProductionAcceptanceStageExecutionIdentity,
} from "../src/lib/production/ProductionAcceptancePolicy";
import { PipelineStageExecutor } from "../src/lib/pipeline/PipelineStageExecutor";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProductionWorkerLifecycle, runWithProductionWorkerLifecycleIdentity } from
  "../src/lib/production/ProductionWorkerLifecycle";
import { installCanonicalProductionPipelineExecutionRuntime } from
  "../src/lib/production/ProductionPipelineExecutionCanonicalRuntime";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { createProductionRuntimeOperationContext, initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext } from
  "../src/lib/runtime/ProductionRuntimeOperationContext";
import {
  createProductionAcceptanceProjectSlug,
  productionAcceptanceTopicFingerprint,
} from "../src/lib/production/ProductionAcceptanceTopic";
import { runProductionAcceptanceCommand } from
  "../src/lib/production/ProductionAcceptanceCommand";
import { normalizedFilesystemIdentity } from
  "../src/lib/production/ProductionAcceptanceMarkerDescriptorReader";
import { buildProductionExecutionIdempotencyIdentity, defaultProductionExecutionIdempotencyPolicy } from
  "../src/lib/production/ProductionExecutionIdempotency";
import { AdapterBackedProductionExecutionDurableStorage, defaultProductionExecutionDurableStoragePolicy } from
  "../src/lib/production/ProductionExecutionDurableStorage";
import { AdapterBackedProductionExecutionDurableLeaseService, defaultProductionExecutionDurableLeasePolicy } from
  "../src/lib/production/ProductionExecutionDurableLease";
import { AdapterBackedProductionExecutionClaimService, defaultProductionExecutionClaimPolicy } from
  "../src/lib/production/ProductionExecutionDurableClaim";
import { AdapterBackedProductionExecutionAttemptService, defaultProductionExecutionAttemptPolicy } from
  "../src/lib/production/ProductionExecutionDurableAttempt";
import { ProductionExecutionCoordinator } from
  "../src/lib/production/ProductionExecutionCoordinator";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { prepareProductionPipelineExecution, readCompletedProductionPipelinePreparation,
  type ProductionPipelineCompletedPreparationAuthority } from
  "../src/lib/production/ProductionPipelineExecutionFactory";
import { runWithProductionPipelineExecutionInstrumentation } from
  "../src/lib/production/ProductionPipelineExecutionInstrumentation";
import { ProductionExecutionDescriptorBoundReadAdapter } from
  "../src/lib/production/ProductionExecutionDescriptorBoundReadAdapter";
import { readProductionExecutionRecoverySemanticAuthority } from
  "../src/lib/production/ProductionExecutionRecoveryBootstrap";
import { stableProductionId } from "../src/lib/production/ProductionDeterminism";
import { createLegacyReauthorizationDurableRecoverySnapshot } from
  "../src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot";
import { withProductionAcceptanceLegacyAdmittedExecution } from
  "../src/lib/production/ProductionAcceptanceLegacyAdmissionContext";
import type { ProductionExecutionAuthorizationResult } from
  "../src/types/productionExecutionAuthorization";
import type { ProductionExecutionConfirmationValidationResult } from
  "../src/types/productionExecutionConfirmation";
import type { ProductionExecutionIdempotencyRecord, ProductionExecutionIdempotencyReservationRequest } from
  "../src/types/productionExecutionIdempotency";
import type { ProductionExecutionDurableWorkerIdentity, ProductionExecutionWorkerSessionIdentity } from
  "../src/types/productionExecutionDurableLease";

let scenarios = 0;
const scenario = async (name: string, run: () => void | Promise<void>) => {
  await run();
  scenarios += 1;
  process.stdout.write(`PASS ${scenarios}: ${name}\n`);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-sprint-129-28-"));
const runtimeRoot = path.join(root, "runtime");
const authorityRoot = path.join(root, "authority");
fs.mkdirSync(path.join(runtimeRoot, "projects"), { recursive: true });
const previousRuntimeRoot = process.env.ATOLYE_RUNTIME_ROOT;
process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
const configuredEnvironmentKeys = ["AI_PROVIDER", "IMAGE_PROVIDER", "AUDIO_PROVIDER",
  "ANIMATION_PROVIDER", "VIDEO_PROVIDER", "VIDEO_ASSEMBLY_PROVIDER", "THUMBNAIL_PROVIDER",
  "YOUTUBE_PROVIDER", "ATOLYE_DURABLE_PIPELINE_EXECUTION", "OPENAI_API_KEY", "FFMPEG_PATH",
  "FFPROBE_PATH"] as const;
const previousConfiguredEnvironment = new Map(configuredEnvironmentKeys.map((key) =>
  [key, process.env[key]] as const));
const ffmpeg = path.join(root, "ffmpeg.exe");
const ffprobe = path.join(root, "ffprobe.exe");
fs.writeFileSync(ffmpeg, "ffmpeg-binary-v1");
fs.writeFileSync(ffprobe, "ffprobe-binary-v1");

const environment = {
  ...process.env,
  ATOLYE_RUNTIME_ROOT: runtimeRoot,
  AI_PROVIDER: "openai",
  IMAGE_PROVIDER: "openai",
  AUDIO_PROVIDER: "openai",
  ANIMATION_PROVIDER: "openai",
  VIDEO_PROVIDER: "ffmpeg",
  VIDEO_ASSEMBLY_PROVIDER: "ffmpeg",
  THUMBNAIL_PROVIDER: "openai",
  YOUTUBE_PROVIDER: "openai",
  ATOLYE_DURABLE_PIPELINE_EXECUTION: "enabled",
  OPENAI_API_KEY: "sprint-129-28-secret",
  FFMPEG_PATH: ffmpeg,
  FFPROBE_PATH: ffprobe,
} satisfies NodeJS.ProcessEnv;

const recovery = (projectSlug = "fixture") => Promise.resolve({
  projectSlug,
  type: "resume" as const,
  blocked: false,
  startStage: "audio",
  stagesToRun: ["audio", "assembly"],
  dependencies: [],
  createdAt: "2026-07-21T00:00:00.000Z",
});
const jobs = (projectSlug = "fixture") => Promise.resolve({ projectSlug, jobs: [],
  createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z" });

function fixture(suffix: string) {
  const runId = crypto.randomUUID();
  const topic = `Sprint 129 28 ${suffix}`;
  const slug = createProductionAcceptanceProjectSlug(topic, runId);
  const folder = path.join(runtimeRoot, "projects", slug);
  fs.mkdirSync(folder);
  const legacyEnvironment = { ...environment, OPENAI_MODEL: `legacy-${suffix}` };
  const configurationFingerprint = productionAcceptanceConfigurationFingerprint(legacyEnvironment);
  const marker = {
    schemaVersion: "2",
    runId,
    topic,
    topicFingerprint: productionAcceptanceTopicFingerprint(topic),
    requestFingerprint: productionAcceptanceRequestFingerprint({ topic, runId, configurationFingerprint }),
    strictProductionAcceptance: true,
    publishMode: "package-only",
    configurationFingerprint,
    createdAt: "2026-07-21T00:00:00.000Z",
    acceptanceStatus: "prepared",
    productionReady: false,
    published: false,
  } as const;
  const markerPath = path.join(folder, "production-acceptance.json");
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2));
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ fixture: suffix }));
  const markerBytes = fs.readFileSync(markerPath);
  return { slug, folder, marker, markerPath, markerBytes, markerSha256: sha256Bytes(markerBytes) };
}

const deps = {
  environment,
  authorityRoot,
};
const originalCreateResumePlan = PipelineRecoveryPlanner.createResumePlan;
const originalListJobsReadOnly = PipelineJobManager.listJobsReadOnly;
let admissionRecovery: (projectSlug: string) => Promise<unknown> = recovery;
let admissionJobs: (projectSlug: string) => Promise<{ projectSlug: string; jobs: unknown[];
  createdAt: string; updatedAt: string }> = jobs;
let canonicalEvidenceRuntime: ReturnType<typeof createProductionRuntimeOperationContext> | undefined;
let canonicalEvidenceWorker: ProductionWorkerLifecycle | undefined;
PipelineRecoveryPlanner.createResumePlan = ((projectSlug: string) =>
  admissionRecovery(projectSlug)) as unknown as typeof PipelineRecoveryPlanner.createResumePlan;
PipelineJobManager.listJobsReadOnly = ((projectSlug: string) => admissionJobs(projectSlug)) as unknown as
  typeof PipelineJobManager.listJobsReadOnly;

async function publishFixture(item: ReturnType<typeof fixture>) {
  const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
  await reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
    sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
    reauthorizationId: plan.reauthorizationId, confirmation: plan.reauthorizationId }, deps);
  return plan;
}

async function publishCapabilityFixture(item: ReturnType<typeof fixture>) {
  const capabilityDependencies = { environment };
  const plan = await planProductionAcceptanceLegacyReauthorization(
    item.slug, item.markerSha256, capabilityDependencies);
  await reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
    sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
    reauthorizationId: plan.reauthorizationId, confirmation: plan.reauthorizationId },
  capabilityDependencies);
}

function rewriteAuthority(item: ReturnType<typeof fixture>, mutate: (body: Record<string, unknown>) => void) {
  const authorityPath = path.join(item.folder, "production-acceptance-reauthorization.json");
  const value = JSON.parse(fs.readFileSync(authorityPath, "utf8")) as Record<string, unknown>;
  delete value.integrity;
  mutate(value);
  value.integrity = integrityFor(value);
  fs.writeFileSync(authorityPath, JSON.stringify(value, null, 2));
}

function rewriteDurableRecord(directory: string, integrityDomain: string,
  mutate: (body: Record<string, unknown>) => void) {
  const file = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort().at(-1);
  assert.ok(file);
  const filePath = path.join(directory, file);
  const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  delete value.integrity;
  mutate(value);
  value.integrity = { algorithm: "stable-production-id-v1",
    fingerprint: stableProductionId(integrityDomain, value) };
  fs.writeFileSync(filePath, JSON.stringify(value));
}

async function settleDurableFixtureInactive(item: ReturnType<typeof fixture>) {
  const evaluatedAt = "2026-07-21T01:03:00.000Z";
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: path.join(item.folder, "production-execution"),
    trustedAttemptIdFactory: () => "fixed" });
  const attempts = new AdapterBackedProductionExecutionAttemptService(adapter);
  const cancelled = await attempts.transitionExecutionLifecycle({ attemptId: "attempt-1",
    claimId: "claim-1", workerId: "worker-1", workerSessionId: "session-1", leaseId: "lease-1",
    expectedAttemptVersion: 1, eventId: "attempt-1-cancelled", transition: "cancelled",
    evaluatedAt, metadata: { code: "TEST_CANCELLED", summary: "Fixture cancelled.",
      evidence: ["fixture:cancelled"] } },
  { ...defaultProductionExecutionAttemptPolicy, reservationTtlSeconds: 600 });
  assert.equal(cancelled.ok, true);
  const claims = new AdapterBackedProductionExecutionClaimService(adapter);
  const releasedClaim = await claims.releaseExecutionClaim({ claimId: "claim-1", workerId: "worker-1",
    workerSessionId: "session-1", leaseId: "lease-1", expectedClaimVersion: 1, evaluatedAt });
  assert.equal(releasedClaim.ok, true);
  const worker: ProductionExecutionDurableWorkerIdentity = { schemaVersion: "1", workerId: "worker-1",
    workerType: "server", operationScope: ["pipeline.stage.retry.preview"], identitySource: "trusted-server" };
  const session: ProductionExecutionWorkerSessionIdentity = { schemaVersion: "1", workerSessionId: "session-1",
    workerId: "worker-1", startedAt: "2026-07-21T01:00:00.000Z", identitySource: "trusted-server" };
  const leases = new AdapterBackedProductionExecutionDurableLeaseService(adapter);
  const releasedLease = await leases.release({ recordId: "record-1", expectedVersion: 2, evaluatedAt,
    releasedAt: evaluatedAt, worker, session, leaseId: "lease-1" },
  { ...defaultProductionExecutionDurableLeasePolicy, reservationTtlSeconds: 600,
    maximumLeaseDurationSeconds: 600 });
  assert.equal(releasedLease.ok, true);
  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);
  const releasedRecord = await storage.releaseReservation("record-1", { schemaVersion: "1",
    recordId: "record-1", idempotencyKey: "execution-1", fromState: "reserved", toState: "cancelled",
    expectedVersion: 3, attempt: 1, transitionedAt: evaluatedAt, actorId: "actor-1",
    reasonCode: "TEST_RELEASED", evidence: ["fixture:released"] }, { evaluatedAt,
    policy: { ...defaultProductionExecutionIdempotencyPolicy, enabled: true,
      policyVersion: "idempotency-policy-v1", reservationTtlSeconds: 600 } });
  assert.equal(releasedRecord.ok, true);
}

async function seedActiveDurableState(item: ReturnType<typeof fixture>, mode: "reservation" | "record" | "terminal" | "lease" | "claim" | "attempt",
  recent = false) {
  const base = recent ? Date.now() : Date.parse("2026-07-21T01:02:00.000Z");
  const t0 = new Date(base - 120_000).toISOString(), t1 = new Date(base - 60_000).toISOString();
  const t2 = new Date(base - 30_000).toISOString(), leaseExpiry = new Date(base + 300_000).toISOString();
  const operation = "pipeline.stage.retry.preview";
  const idempotencyPolicy = { ...defaultProductionExecutionIdempotencyPolicy, enabled: true,
    policyVersion: "idempotency-policy-v1", reservationTtlSeconds: 600 };
  const authorization: ProductionExecutionAuthorizationResult = { schemaVersion: "1", decisionId: "authorization-1", decision: "allow",
    authorized: true, reasonCode: "AUTHORIZED", reason: "safe", evaluatedAt: t0, requestId: "request-1",
    idempotencyKey: "execution-1", executionFingerprint: "snapshot-1", actorId: "actor-1",
    actorType: "user", projectSlug: item.slug, operation, action: "retry-stage", stage: "audio",
    requiredCapabilities: [], grantedCapabilities: [], missingCapabilities: [], policyVersion: "authorization-policy-v1",
    risk: "high", requiresConfirmation: true, requiredConfirmationLevel: "high", evidence: [] };
  const confirmation: ProductionExecutionConfirmationValidationResult = { schemaVersion: "1", decision: "valid", valid: true,
    reasonCode: "CONFIRMATION_VALID", reason: "safe", evaluatedAt: t0, confirmationId: "confirmation-1",
    confirmationRequestId: "confirmation-request-1", authorizationDecisionId: "authorization-1",
    requestId: "request-1", idempotencyKey: "execution-1", actorId: "actor-1", projectSlug: item.slug,
    operation, action: "retry-stage", stage: "audio", riskLevel: "high", requiredConfirmationLevel: "high",
    providedConfirmationLevel: "high", bindingMatches: true, bindingFingerprint: "confirmation-binding-1",
    expired: false, singleUse: true, consumed: false, policyVersion: "authorization-policy-v1", evidence: [] };
  const identity = buildProductionExecutionIdempotencyIdentity({ authorization, confirmation },
    { evaluatedAt: t0, policy: idempotencyPolicy }).identity!;
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: path.join(item.folder, "production-execution"), trustedAttemptIdFactory: () => "fixed" });
  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);
  const storagePolicy = { ...defaultProductionExecutionDurableStoragePolicy, enabled: true,
    reservationTtlSeconds: 600, idempotencyPolicy };
  const reservation: ProductionExecutionIdempotencyReservationRequest = { schemaVersion: "1", identity, authorization, confirmation, requestedAt: t0,
    expectedInitialState: "reserved", attempt: 1, maxAttempts: 3, reservationTtlSeconds: 600,
    policyContext: { source: "server", environment: "test" }, metadata: { source: "server" } };
  const record: ProductionExecutionIdempotencyRecord = { schemaVersion: "1", recordId: "record-1", identityFingerprint: identity.identityFingerprint,
    idempotencyKey: identity.idempotencyKey, requestId: identity.requestId,
    executionFingerprint: identity.executionFingerprint, bindingFingerprint: identity.bindingFingerprint,
    actorId: identity.actorId, projectSlug: item.slug, operation: identity.operation, action: identity.action,
    stage: identity.stage, authorizationDecisionId: identity.authorizationDecisionId,
    confirmationRequestId: identity.confirmationRequestId, confirmationId: identity.confirmationId,
    policyVersion: identity.policyVersion, riskLevel: identity.riskLevel, state: "reserved", attempt: 1,
    maxAttempts: 3, createdAt: t0, updatedAt: t0, reservedAt: t0, evidence: [],
    integrity: { algorithm: "stable-production-id-v1", fingerprint: identity.identityFingerprint, version: 1 } };
  await storage.createReservation(reservation, { evaluatedAt: t1, policy: storagePolicy });
  if (mode === "reservation") return;
  await storage.createRecord(record, { evaluatedAt: t1, policy: storagePolicy });
  if (mode === "record") return;
  if (mode === "terminal") {
    const released = await storage.releaseReservation("record-1", { schemaVersion: "1",
      recordId: "record-1", idempotencyKey: identity.idempotencyKey, fromState: "reserved",
      toState: "cancelled", expectedVersion: 1, attempt: 1, transitionedAt: t1,
      actorId: identity.actorId, reasonCode: "TEST_RELEASED", evidence: ["test:released"] },
    { evaluatedAt: t1, policy: idempotencyPolicy });
    assert.equal(released.ok, true);
    return;
  }
  const worker: ProductionExecutionDurableWorkerIdentity = { schemaVersion: "1", workerId: "worker-1", workerType: "server",
    operationScope: [operation], identitySource: "trusted-server" };
  const session: ProductionExecutionWorkerSessionIdentity = { schemaVersion: "1", workerSessionId: "session-1", workerId: "worker-1",
    startedAt: t0, identitySource: "trusted-server" };
  const leases = new AdapterBackedProductionExecutionDurableLeaseService(adapter);
  await leases.acquire({ recordId: "record-1", expectedVersion: 1, evaluatedAt: t1, worker, session,
    leaseId: "lease-1", acquiredAt: t1, heartbeatAt: t1, expiresAt: leaseExpiry },
  { ...defaultProductionExecutionDurableLeasePolicy, reservationTtlSeconds: 600, maximumLeaseDurationSeconds: 600 });
  if (mode === "lease") return;
  const claims = new AdapterBackedProductionExecutionClaimService(adapter);
  await claims.acquireExecutionClaim({ claimId: "claim-1", recordId: "record-1",
    reservationId: identity.identityFingerprint, requestId: identity.requestId,
    idempotencyKey: identity.idempotencyKey, executionFingerprint: identity.executionFingerprint,
    workerId: "worker-1", workerSessionId: "session-1", leaseId: "lease-1",
    expectedReservationVersion: 1, expectedIdempotencyVersion: 2, expectedLeaseVersion: 1,
    expectedClaimVersion: 0, evaluatedAt: t2 },
  { ...defaultProductionExecutionClaimPolicy, reservationTtlSeconds: 600 });
  if (mode === "attempt") {
    await new ProductionExecutionCoordinator(adapter).coordinate({
      claim: { claimId: "claim-1", recordId: "record-1", reservationId: identity.identityFingerprint,
        requestId: identity.requestId, idempotencyKey: identity.idempotencyKey,
        executionFingerprint: identity.executionFingerprint, workerId: "worker-1",
        workerSessionId: "session-1", leaseId: "lease-1", expectedReservationVersion: 1,
        expectedIdempotencyVersion: 2, expectedLeaseVersion: 1, expectedClaimVersion: 0,
        evaluatedAt: t2 },
      attempt: { attemptId: "attempt-1", claimId: "claim-1",
        reservationId: identity.identityFingerprint, recordId: "record-1",
        requestId: identity.requestId, idempotencyKey: identity.idempotencyKey,
        executionFingerprint: identity.executionFingerprint, workerId: "worker-1",
        workerSessionId: "session-1", leaseId: "lease-1", expectedClaimVersion: 1,
        expectedAttemptVersion: 0, evaluatedAt: t2 },
    }, { claim: { ...defaultProductionExecutionClaimPolicy, reservationTtlSeconds: 600 },
      attempt: { ...defaultProductionExecutionAttemptPolicy, reservationTtlSeconds: 600 } });
  }
}

async function readyWorker(runtime: ReturnType<typeof createProductionRuntimeOperationContext>) {
  const worker = new ProductionWorkerLifecycle(() => "2026-07-21T00:00:00.000Z");
  worker.bindRuntimeOperationContext(runtime);
  await worker.start({ initialization: { schemaVersion: "1", ok: true, decision: "ready",
    reasonCode: "RUNTIME_INITIALIZED", initializedAt: "2026-07-21T00:00:00.000Z",
    writeFree: true, partialInitialization: false, projects: [],
    counts: { active: 0, running: 0, terminal: 0, orphaned: 0,
      "expired-lease": 0, replayable: 0 }, worker: worker.snapshot(), evidence: [] } });
  return worker;
}

function researchProvider(topic: string, onCall: () => void) {
  return { generate: async () => {
    onCall();
    return JSON.stringify({ topic, summary: "summary", historicalContext: "context",
      timeline: ["timeline"], characters: [], locations: [], keyEvents: ["event"], strategies: [],
      controversies: [], interestingFacts: [], documentaryFlow: ["flow"], sceneIdeas: ["scene"],
      imagePrompts: ["image"], animationPrompts: [], musicIdeas: [], soundEffects: [],
      thumbnailIdeas: [], youtubeTitles: [], sources: ["https://example.invalid/source"] });
  } };
}

function exactStorePolicyEntry(value: { storePolicyMatrix: ReadonlyArray<{
  storeFamily: string; lifecycleReason: string; requirementState: string;
  observedState: string; normalizedOutcome: string }> }, storeFamily: string) {
  const entry = value.storePolicyMatrix.find((candidate) => candidate.storeFamily === storeFamily);
  assert.ok(entry);
  return entry;
}

async function withDirectCapabilityEvidence<T = void>(suffix: string, run: (input: {
  item: ReturnType<typeof fixture>;
  runtime: ReturnType<typeof createProductionRuntimeOperationContext>;
  worker: ProductionWorkerLifecycle;
  identity: ProductionAcceptanceStageExecutionIdentity;
  authority: ProductionPipelineCompletedPreparationAuthority;
  state: ReturnType<typeof PipelineStageExecutor.createInitialState>;
}) => Promise<T>) {
  const item = fixture(suffix);
  await publishCapabilityFixture(item);
  const runtime = createProductionRuntimeOperationContext({ operationId: suffix,
    operationType: "pipeline-stage-execution", authorityGeneration: initialRuntimeAuthorityGeneration,
    storageContext: createRuntimeStorageContext({ environment }) });
  const worker = await readyWorker(runtime);
  const state = PipelineStageExecutor.createInitialState({ id: `${suffix}-project`, slug: item.slug,
    title: item.marker.topic, status: "draft", createdAt: item.marker.createdAt,
    updatedAt: item.marker.createdAt });
  fs.writeFileSync(path.join(item.folder, "project.json"), JSON.stringify(state.project));
  await ProjectManager.createManifest(state.project);
  const prepared = await prepareProductionPipelineExecution({ projectSlug: item.slug,
    stage: "research", runType: "initial" });
  const completed = readCompletedProductionPipelinePreparation(prepared.authority);
  const identity = completed.canonicalIdentity;
  return worker.executeWithRuntimeOperationContext(runtime, () =>
    runWithProductionWorkerLifecycleIdentity(runtime, { projectSlug: item.slug, stage: "research",
      operation: "pipeline.stage.initial", executionFingerprint: identity.executionFingerprint },
    () => run({ item, runtime, worker, identity, authority: prepared.authority, state })));
}

function runCanonicalRunnerResearchStage(projectSlug: string,
  action: (capability: Awaited<ReturnType<typeof issueProductionAcceptanceStageCapability>>,
    identity: ProductionAcceptanceStageExecutionIdentity) => Promise<boolean>) {
  type ResearchAction = (capability: Awaited<ReturnType<typeof issueProductionAcceptanceStageCapability>>,
    identity: ProductionAcceptanceStageExecutionIdentity) => Promise<boolean>;
  const runner = PipelineRunner as unknown as { runStage(slug: string, stage: "research",
    action: ResearchAction, runType: "initial"): Promise<boolean> };
  return runner.runStage(projectSlug, "research", action, "initial");
}

function latestDurablePath(item: ReturnType<typeof fixture>, family: "reservations" | "idempotency" |
  "claims" | "attempts", identity: string): string {
  const directory = path.join(item.folder, "production-execution", family);
  const file = fs.readdirSync(directory).filter((name) => name === `${identity}.json` ||
    name.startsWith(`${identity}-v`)).sort().at(-1);
  assert.ok(file, `missing ${family} record for ${identity}`);
  return path.join(directory, file);
}

function rewriteJsonFile(target: string, mutate: (value: Record<string, unknown>) => void,
  integrityDomain?: string): () => void {
  const original = fs.readFileSync(target);
  const value = JSON.parse(original.toString("utf8")) as Record<string, unknown>;
  if (integrityDomain) delete value.integrity;
  mutate(value);
  if (integrityDomain) value.integrity = { algorithm: "stable-production-id-v1",
    fingerprint: stableProductionId(integrityDomain, value) };
  fs.writeFileSync(target, JSON.stringify(value));
  return () => fs.writeFileSync(target, original);
}

async function runCanonicalProviderGateFailure(input: {
  suffix: string;
  expectedCode: ConstructorParameters<typeof ProductionAcceptanceLegacyReauthorizationError>[0];
  mutate: (item: ReturnType<typeof fixture>, identity: ProductionAcceptanceStageExecutionIdentity) =>
    void | (() => void) | Promise<void | (() => void)>;
  assertSemantic?: (item: ReturnType<typeof fixture>) => Promise<void>;
}) {
  const item = fixture(input.suffix);
  const state = PipelineStageExecutor.createInitialState({ id: `${input.suffix}-project`, slug: item.slug,
    title: item.marker.topic, status: "draft", createdAt: item.marker.createdAt,
    updatedAt: item.marker.createdAt });
  fs.writeFileSync(path.join(item.folder, "project.json"), JSON.stringify(state.project));
  await ProjectManager.createManifest(state.project);
  await publishCapabilityFixture(item);
  let providerCalls = 0;
  await runCanonicalRunnerResearchStage(item.slug, async (capability, identity) => {
    assert.ok(capability);
    assert.equal(identity.durableAttemptRequired, true);
    const restore = await input.mutate(item, identity);
    try {
      if (input.assertSemantic) await input.assertSemantic(item);
      let gateError: unknown;
      try {
        await PipelineStageExecutor.execute(item.slug, "research", state,
          { aiProvider: researchProvider(item.marker.topic, () => { providerCalls += 1; }) },
          capability, identity);
      } catch (error) { gateError = error; }
      assert.ok(gateError instanceof ProductionAcceptanceLegacyReauthorizationError);
      assert.equal(gateError.code, input.expectedCode);
      await assert.rejects(consumeProductionAcceptanceStageCapability(identity, capability),
        (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
          error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_INVALIDATED");
    } finally { restore?.(); }
    return true;
  });
  assert.equal(providerCalls, 0);
}

async function assertReservationCorruptSemantic(item: ReturnType<typeof fixture>) {
  const semantic = await readProductionExecutionRecoverySemanticAuthority(
    new ProductionExecutionDescriptorBoundReadAdapter(path.join(item.folder, "production-execution")),
    new Date().toISOString());
  const entry = exactStorePolicyEntry(semantic, "reservation");
  assert.equal(entry.storeFamily, "reservation");
  assert.equal(entry.observedState, "corrupt");
  assert.equal(entry.normalizedOutcome, "rejected-corrupt");
  assert.notEqual(entry.observedState, "not-created");
  assert.notEqual(entry.observedState, "unavailable");
}

type RecordReadRace = "same-byte-replacement" | "truncate" | "growth" | "disappear";

function installRecordOpenRace(target: string, mutation: RecordReadRace, preserved: string) {
  const mutableFs = fs as unknown as { openSync(file: fs.PathLike, flags: fs.OpenMode,
    mode?: fs.Mode): number };
  const originalOpen = mutableFs.openSync;
  const originalBytes = fs.readFileSync(target);
  let crossed = false;
  mutableFs.openSync = (file, flags, mode) => {
    const descriptor = mode === undefined ? originalOpen(file, flags) : originalOpen(file, flags, mode);
    if (!crossed && path.resolve(file.toString()) === path.resolve(target)) {
      crossed = true;
      if (mutation === "same-byte-replacement") {
        fs.renameSync(target, preserved);
        fs.copyFileSync(preserved, target);
      } else if (mutation === "truncate") {
        fs.copyFileSync(target, preserved);
        fs.truncateSync(target, 1);
      } else if (mutation === "growth") {
        fs.copyFileSync(target, preserved);
        fs.appendFileSync(target, " ");
      } else {
        fs.renameSync(target, preserved);
      }
    }
    return descriptor;
  };
  return {
    crossed: () => crossed,
    restoreReader: () => { mutableFs.openSync = originalOpen; },
    restoreFile: () => {
      if (mutation === "same-byte-replacement" || mutation === "disappear") {
        if (fs.existsSync(target)) fs.rmSync(target);
        fs.renameSync(preserved, target);
      } else {
        fs.writeFileSync(target, originalBytes);
      }
    },
  };
}

async function verifyRecordLevelParity(mutation: RecordReadRace) {
  const evaluatedAt = new Date().toISOString();
  const adapterItem = fixture(`parity-${mutation}-adapter`);
  await seedActiveDurableState(adapterItem, "reservation", true);
  const adapterRoot = path.join(adapterItem.folder, "production-execution");
  const adapterTarget = fs.readdirSync(path.join(adapterRoot, "reservations"))
    .map((name) => path.join(adapterRoot, "reservations", name)).find((name) => name.endsWith(".json"))!;
  const adapterKey = path.basename(adapterTarget, ".json");
  const adapterPreserved = path.join(adapterRoot, `${mutation}-adapter-preserved.json`);
  const descriptor = new ProductionExecutionDescriptorBoundReadAdapter(adapterRoot, {
    afterRecordOpen: (kind, key, target) => {
      if (kind !== "reservation" || key !== adapterKey) return;
      if (mutation === "same-byte-replacement") {
        fs.renameSync(target, adapterPreserved); fs.copyFileSync(adapterPreserved, target);
      } else if (mutation === "truncate") {
        fs.copyFileSync(target, adapterPreserved); fs.truncateSync(target, 1);
      } else if (mutation === "growth") {
        fs.copyFileSync(target, adapterPreserved); fs.appendFileSync(target, " ");
      } else fs.renameSync(target, adapterPreserved);
    },
  });
  const descriptorRead = await descriptor.read("reservation", adapterKey);
  assert.equal(descriptorRead.status, "failed");
  assert.equal(descriptorRead.errorCode, "PERSISTENCE_IDENTITY_CHANGED");
  assert.equal(fs.existsSync(adapterPreserved), true);

  const semanticItem = fixture(`parity-${mutation}-semantic`);
  await seedActiveDurableState(semanticItem, "reservation", true);
  const semanticRoot = path.join(semanticItem.folder, "production-execution");
  const baseline = await readProductionExecutionRecoverySemanticAuthority(
    new ProductionExecutionDescriptorBoundReadAdapter(semanticRoot), evaluatedAt);
  const baselineEntry = exactStorePolicyEntry(baseline, "reservation");
  const semanticTarget = fs.readdirSync(path.join(semanticRoot, "reservations"))
    .map((name) => path.join(semanticRoot, "reservations", name)).find((name) => name.endsWith(".json"))!;
  const semanticRace = installRecordOpenRace(semanticTarget, mutation,
    path.join(semanticRoot, `${mutation}-semantic-preserved.json`));
  let semantic;
  try {
    semantic = await readProductionExecutionRecoverySemanticAuthority(
      new ProductionExecutionDescriptorBoundReadAdapter(semanticRoot), evaluatedAt);
  } finally { semanticRace.restoreReader(); }
  assert.equal(semanticRace.crossed(), true);
  const semanticEntry = exactStorePolicyEntry(semantic, "reservation");
  assert.equal(semanticEntry.storeFamily, "reservation");
  assert.equal(semanticEntry.requirementState, baselineEntry.requirementState);
  assert.equal(semanticEntry.lifecycleReason, baselineEntry.lifecycleReason);
  assert.equal(semanticEntry.observedState, "identity-changed");
  assert.equal(semanticEntry.normalizedOutcome, "rejected-identity-changed");
  assert.equal(semantic.decision, "indeterminate");

  const snapshotItem = fixture(`parity-${mutation}-snapshot`);
  await seedActiveDurableState(snapshotItem, "reservation", true);
  const snapshotRoot = path.join(snapshotItem.folder, "production-execution");
  const snapshotTarget = fs.readdirSync(path.join(snapshotRoot, "reservations"))
    .map((name) => path.join(snapshotRoot, "reservations", name)).find((name) => name.endsWith(".json"))!;
  const snapshotRace = installRecordOpenRace(snapshotTarget, mutation,
    path.join(snapshotRoot, `${mutation}-snapshot-preserved.json`));
  try {
    await assert.rejects(createLegacyReauthorizationDurableRecoverySnapshot({
      projectFolder: snapshotItem.folder, projectSlug: snapshotItem.slug,
      runId: snapshotItem.marker.runId, evaluatedAt, markerState: "prepared", startStage: "audio" }),
    (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
      error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_IDENTITY_CHANGED");
  } finally { snapshotRace.restoreReader(); }
  assert.equal(snapshotRace.crossed(), true);
  assert.equal(fs.existsSync(path.join(snapshotRoot, `${mutation}-snapshot-preserved.json`)), true);

  await runCanonicalProviderGateFailure({ suffix: `parity-${mutation}-provider-gate`,
    expectedCode: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_IDENTITY_CHANGED",
    mutate: (item, identity) => {
      const target = latestDurablePath(item, "reservations", identity.reservationId);
      const preserved = path.join(item.folder, "production-execution",
        `${mutation}-provider-preserved.json`);
      const race = installRecordOpenRace(target, mutation, preserved);
      return () => {
        race.restoreReader();
        assert.equal(race.crossed(), true);
        assert.equal(fs.existsSync(preserved), true);
        race.restoreFile();
      };
    } });
}

async function main() {
try {
  await scenario("deterministic ID binds every archive identity component", () => {
    const base = { protocolVersion: legacyReauthorizationSchemaVersion, projectSlug: "project-1",
      sourceMarkerSha256: "1".repeat(64), sourceMarkerByteLength: 100,
      sourceMarkerDeviceIdentity: "2".repeat(64), sourceMarkerInodeIdentity: "3".repeat(64),
      sourceLegacyConfigurationFingerprint: "4".repeat(64), runId: "run-1",
      topicFingerprint: "5".repeat(64), currentProfile2ConfigurationFingerprint: "6".repeat(64),
      storageAuthorityFingerprint: "7".repeat(64), artifactInventoryFingerprint: "8".repeat(64),
      recoveryStateFingerprint: "9".repeat(64), reason: "legacy-environment-unrecoverable" as const,
      strictProductionAcceptance: true as const, publishMode: "package-only" as const,
      archiveLocator: "production-acceptance-authority/legacy/source.json", archiveSha256: "a".repeat(64),
      archiveByteLength: 100, archiveDeviceIdentity: "b".repeat(64), archiveInodeIdentity: "c".repeat(64),
      archiveIdentityPolicyVersion: "production-acceptance-marker-identity-v1",
      publicationReceiptPolicyVersion: legacyReauthorizationReceiptPolicyVersion,
      publicationGenerationId: "d".repeat(64) };
    const expected = deriveLegacyReauthorizationId(base);
    assert.notEqual(deriveLegacyReauthorizationId({ ...base, archiveSha256: "e".repeat(64) }), expected);
    assert.notEqual(deriveLegacyReauthorizationId({ ...base, archiveByteLength: 101 }), expected);
    assert.notEqual(deriveLegacyReauthorizationId({ ...base, archiveDeviceIdentity: "e".repeat(64) }), expected);
    assert.notEqual(deriveLegacyReauthorizationId({ ...base, archiveInodeIdentity: "e".repeat(64) }), expected);
  });

  await scenario("canonical ID serialization uses code-unit order and rejects undefined", () => {
    assert.equal(canonicalJson({ "ä": 1, z: 2 }), "{\"z\":2,\"ä\":1}");
    assert.throws(() => canonicalJson({ required: undefined }));
  });

  await scenario("happy path publishes immutable archive and authority", async () => {
    const item = fixture("happy");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    const result = await reauthorizeProductionAcceptanceLegacyMarker({
      projectSlug: item.slug,
      sourceMarkerSha256: item.markerSha256,
      reason: "legacy-environment-unrecoverable",
      reauthorizationId: plan.reauthorizationId,
      confirmation: plan.reauthorizationId,
    }, deps);
    assert.equal(result.decision, "reauthorized");
    assert.equal(result.writePerformed, true);
    assert.deepEqual(fs.readFileSync(item.markerPath), item.markerBytes);
    assert.equal(fs.existsSync(path.join(item.folder, "production-acceptance-reauthorization.json")), true);
    assert.equal(fs.existsSync(path.join(
      item.folder,
      "production-acceptance-authority",
      "legacy",
      `${item.markerSha256}.json`,
    )), true);
  });

  await scenario("exact replay is mutation-free", async () => {
    const item = fixture("replay");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    const input = { projectSlug: item.slug, sourceMarkerSha256: item.markerSha256,
      reason: "legacy-environment-unrecoverable", reauthorizationId: plan.reauthorizationId,
      confirmation: plan.reauthorizationId };
    await reauthorizeProductionAcceptanceLegacyMarker(input, deps);
    const authorityPath = path.join(item.folder, "production-acceptance-reauthorization.json");
    const receiptPath = path.join(item.folder, "legacy-reauthorization-publication-receipt.json");
    const before = fs.readFileSync(authorityPath);
    const receiptBefore = fs.readFileSync(receiptPath);
    const receiptIdentityBefore = fs.statSync(receiptPath, { bigint: true });
    const replay = await reauthorizeProductionAcceptanceLegacyMarker(input, deps);
    assert.equal(replay.decision, "replayed");
    assert.equal(replay.writePerformed, false);
    assert.deepEqual(fs.readFileSync(authorityPath), before);
    assert.deepEqual(fs.readFileSync(receiptPath), receiptBefore);
    const receiptIdentityAfter = fs.statSync(receiptPath, { bigint: true });
    assert.equal(receiptIdentityAfter.dev, receiptIdentityBefore.dev);
    assert.equal(receiptIdentityAfter.ino, receiptIdentityBefore.ino);
  });

  await scenario("normal legacy reprepare mismatch remains fail closed", async () => {
    const item = fixture("normal-reprepare");
    await assert.rejects(
      prepareProductionAcceptanceMarkerReprepare(item.slug, item.marker, environment),
    );
  });

  await scenario("schema-2 without authority retains legacy diagnose", async () => {
    const item = fixture("legacy-diagnose");
    const diagnostic = await diagnoseProductionAcceptanceConfiguration(item.slug, environment);
    assert.equal(diagnostic.schemaVersion, "2");
    assert.equal(diagnostic.matches, false);
    assert.equal(diagnostic.componentDiagnosticsAvailable, false);
  });

  await scenario("valid sidecar resolves effective profile-2 authority", async () => {
    const item = fixture("effective");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    await reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
      sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
      reauthorizationId: plan.reauthorizationId, confirmation: plan.reauthorizationId }, deps);
    const resolved = await resolveEffectiveProductionAcceptanceAuthority(
      item.slug, undefined, environment,
    );
    assert.equal(resolved.source, "legacy-reauthorization");
    assert.equal(resolved.marker.schemaVersion, "3");
    assert.equal("componentFingerprintProfile" in resolved.marker, true);
  });

  await scenario("admission rejects semantically stale storage fingerprint", async () => {
    const item = fixture("admission-storage-drift");
    await publishFixture(item);
    rewriteAuthority(item, (body) => { body.storageAuthorityFingerprint = "1".repeat(64); });
    await assert.rejects(
      resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_PUBLICATION_RECEIPT_MISMATCH",
    );
  });

  await scenario("admission rejects artifact inventory byte drift", async () => {
    const item = fixture("admission-artifact-drift");
    const artifact = path.join(item.folder, "artifact-fixture.json");
    fs.writeFileSync(artifact, JSON.stringify({ fixture: "original" }));
    await publishFixture(item);
    fs.writeFileSync(artifact, JSON.stringify({ fixture: "changed" }));
    await assert.rejects(
      resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_ARTIFACT_DRIFT",
    );
  });

  await scenario("admission rejects semantic recovery drift", async () => {
    const item = fixture("admission-recovery-drift");
    await publishFixture(item);
    admissionRecovery = (projectSlug = "fixture") => Promise.resolve({ projectSlug,
      type: "resume" as const, blocked: false, startStage: "audio",
      stagesToRun: ["audio", "assembly", "youtube"], dependencies: [],
      createdAt: "2026-07-21T00:00:00.000Z" });
    try {
      await assert.rejects(
        resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment),
        (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
          error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_RECOVERY_DRIFT",
      );
    } finally {
      admissionRecovery = recovery;
    }
  });

  await scenario("controlled barrier catches artifact mutation between capture and recheck", async () => {
    const item = fixture("barrier-artifact-race");
    const artifact = path.join(item.folder, "artifact-fixture.json");
    fs.writeFileSync(artifact, JSON.stringify({ fixture: "original" }));
    await publishFixture(item);
    let calls = 0;
    admissionRecovery = async (projectSlug: string) => {
      calls += 1;
      if (calls === 2) fs.writeFileSync(artifact,
        JSON.stringify({ fixture: "barrier-mutated" }));
      return recovery(projectSlug);
    };
    try {
      await assert.rejects(resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment),
        (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
          error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONCURRENT_CHANGE");
      assert.equal(calls, 2);
    } finally { admissionRecovery = recovery; }
  });

  await scenario("controlled barrier catches recovery generation change", async () => {
    const item = fixture("barrier-recovery-race");
    await publishFixture(item);
    let calls = 0;
    admissionRecovery = async (projectSlug: string) => {
      calls += 1;
      if (calls === 2) return { projectSlug, type: "resume" as const, blocked: false,
        startStage: "audio", stagesToRun: ["audio", "assembly", "youtube"], dependencies: [],
        createdAt: "2026-07-21T00:00:00.000Z" };
      return recovery(projectSlug);
    };
    try {
      await assert.rejects(resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment),
        (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
          error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONCURRENT_CHANGE");
      assert.equal(calls, 2);
    } finally { admissionRecovery = recovery; }
  });

  await scenario("admission rejects current profile-2 configuration drift", async () => {
    const item = fixture("admission-configuration-drift");
    await publishFixture(item);
    await assert.rejects(
      resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined,
        { ...environment, OPENAI_AUDIO_MAX_TOKENS: "4096" }),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_CONFIGURATION_DRIFT",
    );
  });

  await scenario("admission re-derives and rejects a valid-format random ID", async () => {
    const item = fixture("admission-id-drift");
    await publishFixture(item);
    rewriteAuthority(item, (body) => { body.reauthorizationId = "2".repeat(64); });
    await assert.rejects(
      resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_PUBLICATION_RECEIPT_MISMATCH",
    );
  });

  await scenario("admission rejects same bytes on a replacement marker inode", async () => {
    const item = fixture("admission-marker-inode-drift");
    await publishFixture(item);
    const replacement = `${item.markerPath}.replacement`;
    fs.writeFileSync(replacement, item.markerBytes);
    fs.renameSync(replacement, item.markerPath);
    await assert.rejects(
      resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_SOURCE_IDENTITY_MISMATCH",
    );
    assert.deepEqual(fs.readFileSync(item.markerPath), item.markerBytes);
  });

  await scenario("admission rejects different bytes retained on the same marker inode", async () => {
    const item = fixture("admission-marker-byte-drift");
    await publishFixture(item);
    const changed = Buffer.from(item.markerBytes.toString("utf8").replace(
      "2026-07-21T00:00:00.000Z", "2026-07-22T00:00:00.000Z",
    ));
    fs.writeFileSync(item.markerPath, changed);
    await assert.rejects(
      resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_SOURCE_IDENTITY_MISMATCH",
    );
  });

  await scenario("admission rejects same-byte foreign archive inode replacement", async () => {
    const item = fixture("admission-archive-inode-drift");
    await publishFixture(item);
    const archivePath = path.join(item.folder, "production-acceptance-authority", "legacy",
      `${item.markerSha256}.json`);
    const replacement = `${archivePath}.replacement`;
    fs.writeFileSync(replacement, item.markerBytes);
    fs.renameSync(replacement, archivePath);
    await assert.rejects(
      resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_ARCHIVE_MISMATCH",
    );
  });

  await scenario("receipt blocks coordinated archive and sidecar identity replacement", async () => {
    const item = fixture("receipt-coordinated-replacement");
    await publishFixture(item);
    const archivePath = path.join(item.folder, "production-acceptance-authority", "legacy",
      `${item.markerSha256}.json`);
    const replacement = `${archivePath}.foreign`;
    fs.writeFileSync(replacement, item.markerBytes);
    fs.renameSync(replacement, archivePath);
    const stat = fs.statSync(archivePath, { bigint: true });
    rewriteAuthority(item, (body) => {
      const source = body.sourceMarker as Record<string, unknown>;
      source.archiveDeviceIdentity = normalizedFilesystemIdentity("device", stat.dev);
      source.archiveInodeIdentity = normalizedFilesystemIdentity("inode", stat.ino);
    });
    await assert.rejects(resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_PUBLICATION_RECEIPT_MISMATCH");
  });

  await scenario("same-byte foreign receipt inode replacement fails closed", async () => {
    const item = fixture("foreign-receipt");
    await publishFixture(item);
    const receiptPath = path.join(item.folder, "legacy-reauthorization-publication-receipt.json");
    const bytes = fs.readFileSync(receiptPath);
    const replacement = `${receiptPath}.foreign`;
    fs.writeFileSync(replacement, bytes);
    fs.renameSync(replacement, receiptPath);
    await assert.rejects(resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_PUBLICATION_RECEIPT_MISMATCH");
  });

  await scenario("malformed receipt version fails closed", async () => {
    const item = fixture("malformed-receipt");
    await publishFixture(item);
    const receiptPath = path.join(item.folder, "legacy-reauthorization-publication-receipt.json");
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as Record<string, unknown>;
    receipt.receiptSchemaVersion = "unsupported";
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
    await assert.rejects(resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_PUBLICATION_RECEIPT_MISMATCH");
  });

  await scenario("malformed persisted marker identity is fail closed", async () => {
    const item = fixture("admission-marker-identity-malformed");
    await publishFixture(item);
    rewriteAuthority(item, (body) => {
      (body.sourceMarker as Record<string, unknown>).inodeIdentity = "unsafe-inode";
    });
    await assert.rejects(
      resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment),
    );
  });

  await scenario("child-process pathname replacement race remains fail closed", async () => {
    const item = fixture("admission-child-race");
    await publishFixture(item);
    const childCode = [
      "const fs=require('node:fs');",
      "const p=process.argv[1]; const b=Buffer.from(process.argv[2],'base64');",
      "let ready=false;for(let i=0;i<80;i++){const t=p+'.child-'+i;const o=p+'.old-'+i;",
      "try{fs.writeFileSync(t,b);fs.renameSync(p,o);fs.renameSync(t,p);fs.rmSync(o,{force:true});",
      "if(!ready){ready=true;process.stdout.write('ready\\n');}}catch{try{fs.rmSync(t,{force:true})}catch{}",
      "try{if(fs.existsSync(o)&&!fs.existsSync(p))fs.renameSync(o,p)}catch{}}}if(!ready)process.exitCode=2;",
    ].join("");
    const child = spawn(process.execPath, ["-e", childCode, item.markerPath,
      item.markerBytes.toString("base64")], { stdio: ["ignore", "pipe", "pipe"] });
    const exited = once(child, "exit");
    await once(child.stdout, "data");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await assert.rejects(
        resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment),
        (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError ||
          error instanceof ProductionAcceptancePolicyError,
      );
    }
    const [exitCode] = await exited;
    for (const name of fs.readdirSync(item.folder)) {
      if (name.startsWith("production-acceptance.json.child-") ||
        name.startsWith("production-acceptance.json.old-")) {
        fs.rmSync(path.join(item.folder, name), { force: true });
      }
    }
    assert.equal(exitCode, 0);
  });

  await scenario("exact confirmation is required", async () => {
    const item = fixture("confirmation");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    await assert.rejects(
      reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
        sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
        reauthorizationId: plan.reauthorizationId, confirmation: "0".repeat(64) }, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONFIRMATION_REQUIRED",
    );
    assert.equal(fs.existsSync(path.join(item.folder, "production-acceptance-reauthorization.json")), false);
  });

  await scenario("wrong source hash fails before mutation", async () => {
    const item = fixture("source-hash");
    await assert.rejects(
      planProductionAcceptanceLegacyReauthorization(item.slug, "0".repeat(64), deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_SOURCE_HASH_MISMATCH",
    );
  });

  await scenario("binary unavailable fails closed", async () => {
    const item = fixture("binary-unavailable");
    const broken = { ...deps, environment: { ...environment, FFMPEG_PATH: path.join(root, "missing.exe") } };
    await assert.rejects(
      planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, broken),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONFIGURATION_UNAVAILABLE",
    );
  });

  await scenario("real active durable record fails closed", async () => {
    const item = fixture("active-durable-record");
    await seedActiveDurableState(item, "record");
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_ACTIVE_EXECUTION");
  });

  await scenario("reservation-only active execution fails closed", async () => {
    const item = fixture("active-reservation-only");
    await seedActiveDurableState(item, "reservation");
    fs.mkdirSync(path.join(item.folder, "production-execution", "idempotency"), { recursive: true });
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ACTIVE_RESERVATION_CONFLICT");
  });

  await scenario("reservation-only admitted execution is exactly self-excluded", async () => {
    const item = fixture("admitted-reservation-only");
    await seedActiveDurableState(item, "reservation");
    const reservations = path.join(item.folder, "production-execution", "reservations");
    const reservationFile = fs.readdirSync(reservations).find((name) => name.endsWith(".json"))!;
    const reservation = JSON.parse(fs.readFileSync(path.join(reservations, reservationFile), "utf8")) as
      ProductionExecutionIdempotencyReservationRequest;
    const snapshot = await withProductionAcceptanceLegacyAdmittedExecution({ projectSlug: item.slug,
      stage: "audio", runType: "initial", jobId: "current-job", attemptNumber: 0,
      recordId: "current-record", reservationId: reservation.identity.identityFingerprint,
      claimId: "current-claim", attemptId: "current-attempt", leaseId: "current-lease",
      requestId: reservation.identity.requestId,
      idempotencyKey: reservation.identity.idempotencyKey,
      operation: reservation.identity.operation,
      executionFingerprint: reservation.identity.executionFingerprint }, () =>
      createLegacyReauthorizationDurableRecoverySnapshot({ projectFolder: item.folder,
        projectSlug: item.slug, runId: item.marker.runId, evaluatedAt: item.marker.createdAt,
        markerState: "prepared", startStage: "audio" }));
    assert.equal(snapshot.recoveryBootstrap.activeReservationCount, 0);
  });

  await scenario("expired reservation-only state is normalized as inactive", async () => {
    const item = fixture("expired-reservation-only");
    await seedActiveDurableState(item, "reservation");
    fs.mkdirSync(path.join(item.folder, "production-execution", "idempotency"), { recursive: true });
    const snapshot = await createLegacyReauthorizationDurableRecoverySnapshot({ projectFolder: item.folder,
      projectSlug: item.slug, runId: item.marker.runId, evaluatedAt: "2026-07-21T02:00:00.000Z",
      markerState: "prepared", startStage: "audio" });
    assert.equal(snapshot.recoveryBootstrap.activeReservationCount, 0);
  });

  await scenario("released reservation is non-conflicting", async () => {
    const item = fixture("released-terminal-reservation");
    await seedActiveDurableState(item, "terminal");
    const snapshot = await createLegacyReauthorizationDurableRecoverySnapshot({ projectFolder: item.folder,
      projectSlug: item.slug, runId: item.marker.runId, evaluatedAt: "2026-07-21T01:02:00.000Z",
      markerState: "prepared", startStage: "audio" });
    assert.equal(snapshot.recoveryBootstrap.activeReservationCount, 0);
    assert.equal(snapshot.reservations.length, 1);
  });

  await scenario("terminal reservation is independently non-conflicting", async () => {
    const item = fixture("terminal-reservation");
    await seedActiveDurableState(item, "terminal");
    const snapshot = await createLegacyReauthorizationDurableRecoverySnapshot({ projectFolder: item.folder,
      projectSlug: item.slug, runId: item.marker.runId, evaluatedAt: "2026-07-21T01:02:00.000Z",
      markerState: "prepared", startStage: "audio" });
    assert.equal(snapshot.recoveryBootstrap.activeReservationCount, 0);
    assert.equal(snapshot.activeExecutions, false);
    assert.equal(snapshot.conflictingClaimOrLease, false);
  });

  for (const lifecycle of ["expired", "released", "terminal"] as const) {
    await scenario(`${lifecycle} reservation requires an existing idempotency store`, async () => {
      const item = fixture(`${lifecycle}-reservation-idempotency-requirement`);
      await seedActiveDurableState(item, lifecycle === "expired" ? "reservation" : "terminal");
      const evaluatedAt = lifecycle === "expired"
        ? "2026-07-21T02:00:00.000Z" : "2026-07-21T01:02:00.000Z";
      const durableRoot = path.join(item.folder, "production-execution");
      const idempotencyDirectory = path.join(durableRoot, "idempotency");
      const preserved = `${idempotencyDirectory}-preserved`;
      if (fs.existsSync(idempotencyDirectory)) fs.renameSync(idempotencyDirectory, preserved);
      try {
        const missing = await readProductionExecutionRecoverySemanticAuthority(
          new ProductionExecutionDescriptorBoundReadAdapter(durableRoot), evaluatedAt);
        assert.deepEqual(exactStorePolicyEntry(missing, "idempotency"), {
          storeFamily: "idempotency",
          lifecycleReason: "reservation-or-descendant-requires-idempotency",
          requirementState: "required", observedState: "not-created",
          normalizedOutcome: "rejected-required-missing",
        });
        await assert.rejects(createLegacyReauthorizationDurableRecoverySnapshot({
          projectFolder: item.folder, projectSlug: item.slug, runId: item.marker.runId,
          evaluatedAt, markerState: "prepared", startStage: "audio",
        }), (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
          error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_IDEMPOTENCY_STORE_MISSING");
      } finally {
        if (fs.existsSync(preserved)) fs.renameSync(preserved, idempotencyDirectory);
        else fs.mkdirSync(idempotencyDirectory, { recursive: true });
      }
      const present = await readProductionExecutionRecoverySemanticAuthority(
        new ProductionExecutionDescriptorBoundReadAdapter(durableRoot), evaluatedAt);
      assert.deepEqual(exactStorePolicyEntry(present, "idempotency"), {
        storeFamily: "idempotency",
        lifecycleReason: "reservation-or-descendant-requires-idempotency",
        requirementState: "required", observedState: "present",
        normalizedOutcome: "accepted-present",
      });
      const accepted = await createLegacyReauthorizationDurableRecoverySnapshot({
        projectFolder: item.folder, projectSlug: item.slug, runId: item.marker.runId,
        evaluatedAt, markerState: "prepared", startStage: "audio",
      });
      assert.equal(accepted.recoveryBootstrap.storePolicyFingerprint, present.storePolicyFingerprint);
    });
  }

  await scenario("empty reservation store is distinct from a not-created reservation store", async () => {
    const item = fixture("empty-reservation-store-state");
    const durableRoot = path.join(item.folder, "production-execution");
    const absent = await readProductionExecutionRecoverySemanticAuthority(
      new ProductionExecutionDescriptorBoundReadAdapter(durableRoot), item.marker.createdAt);
    assert.equal(exactStorePolicyEntry(absent, "reservation").observedState, "not-created");
    fs.mkdirSync(path.join(durableRoot, "reservations"), { recursive: true });
    const empty = await readProductionExecutionRecoverySemanticAuthority(
      new ProductionExecutionDescriptorBoundReadAdapter(durableRoot), item.marker.createdAt);
    assert.equal(exactStorePolicyEntry(empty, "reservation").observedState, "present");
    assert.equal(exactStorePolicyEntry(empty, "reservation").normalizedOutcome, "accepted-present");
  });

  await scenario("active reservation in another project is non-conflicting", async () => {
    const item = fixture("cross-project-reservation-target");
    const foreign = fixture("cross-project-reservation-foreign");
    await seedActiveDurableState(foreign, "reservation");
    const snapshot = await createLegacyReauthorizationDurableRecoverySnapshot({ projectFolder: item.folder,
      projectSlug: item.slug, runId: item.marker.runId, evaluatedAt: item.marker.createdAt,
      markerState: "prepared", startStage: "audio" });
    assert.equal(snapshot.recoveryBootstrap.activeReservationCount, 0);
    assert.equal(snapshot.reservations.length, 0);
  });

  await scenario("required reservation store missing fails closed", async () => {
    const item = fixture("required-reservation-missing");
    await seedActiveDurableState(item, "record");
    fs.rmSync(path.join(item.folder, "production-execution", "reservations"), { recursive: true });
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_RESERVATION_STORE_MISSING");
  });

  await scenario("required idempotency store missing fails closed", async () => {
    const item = fixture("required-idempotency-missing");
    await seedActiveDurableState(item, "claim");
    fs.rmSync(path.join(item.folder, "production-execution", "idempotency"), { recursive: true });
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_IDEMPOTENCY_STORE_MISSING");
  });

  await scenario("claim requires reservation store", async () => {
    const item = fixture("claim-reservation-missing");
    await seedActiveDurableState(item, "claim");
    fs.rmSync(path.join(item.folder, "production-execution", "reservations"), { recursive: true });
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_RESERVATION_STORE_MISSING");
  });

  await scenario("active claim requires attempt store", async () => {
    const item = fixture("required-attempt-missing");
    await seedActiveDurableState(item, "claim");
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_ATTEMPT_STORE_MISSING");
  });

  await scenario("attempt requires claim store", async () => {
    const item = fixture("required-claim-missing");
    await seedActiveDurableState(item, "attempt");
    fs.rmSync(path.join(item.folder, "production-execution", "claims"), { recursive: true });
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_CLAIM_STORE_MISSING");
  });

  await scenario("attempt requires reservation store", async () => {
    const item = fixture("attempt-reservation-missing");
    await seedActiveDurableState(item, "attempt");
    fs.rmSync(path.join(item.folder, "production-execution", "reservations"), { recursive: true });
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_RESERVATION_STORE_MISSING");
  });

  await scenario("required linked idempotency record missing fails closed", async () => {
    const item = fixture("linked-idempotency-missing");
    await seedActiveDurableState(item, "attempt");
    const directory = path.join(item.folder, "production-execution", "idempotency");
    for (const file of fs.readdirSync(directory)) fs.rmSync(path.join(directory, file));
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_IDEMPOTENCY_STORE_MISSING");
  });

  await scenario("optional stores and unsupported families have snapshot parity", async () => {
    const item = fixture("optional-store-parity");
    const snapshot = await createLegacyReauthorizationDurableRecoverySnapshot({ projectFolder: item.folder,
      projectSlug: item.slug, runId: item.marker.runId, evaluatedAt: item.marker.createdAt,
      markerState: "prepared", startStage: "audio" });
    assert.deepEqual(snapshot.recoveryBootstrap.storeStates, {
      reservations: "optional-not-created", idempotency: "optional-not-created",
      claims: "optional-not-created", attempts: "optional-not-created",
      transactions: "unsupported", journals: "unsupported" });
    assert.deepEqual(snapshot.recoveryBootstrap.storePolicyMatrix, [
      { storeFamily: "reservation", lifecycleReason: "no-durable-descendant",
        requirementState: "conditionally-required", observedState: "not-created",
        normalizedOutcome: "accepted-empty" },
      { storeFamily: "idempotency", lifecycleReason: "no-active-reservation-or-descendant",
        requirementState: "conditionally-required", observedState: "not-created",
        normalizedOutcome: "accepted-empty" },
      { storeFamily: "claim", lifecycleReason: "no-attempt-chain",
        requirementState: "conditionally-required", observedState: "not-created",
        normalizedOutcome: "accepted-empty" },
      { storeFamily: "attempt", lifecycleReason: "no-claim-coordination",
        requirementState: "conditionally-required", observedState: "not-created",
        normalizedOutcome: "accepted-empty" },
      { storeFamily: "transaction", lifecycleReason: "store-family-unsupported",
        requirementState: "unsupported", observedState: "not-created",
        normalizedOutcome: "ignored-unsupported" },
      { storeFamily: "journal", lifecycleReason: "store-family-unsupported",
        requirementState: "unsupported", observedState: "not-created",
        normalizedOutcome: "ignored-unsupported" },
    ]);
    assert.match(snapshot.recoveryBootstrap.storePolicyFingerprint,
      /^production-recovery-store-policy-[a-f0-9]{8}$/);
  });

  await scenario("reservation to claim link mismatch fails closed", async () => {
    const item = fixture("reservation-claim-link-mismatch");
    await seedActiveDurableState(item, "attempt");
    await settleDurableFixtureInactive(item);
    rewriteDurableRecord(path.join(item.folder, "production-execution", "claims"),
      "durable-claim-integrity", (value) => {
        const identity = value.identity as Record<string, unknown>;
        identity.reservationId = "foreign-reservation";
      });
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_CLAIM_BINDING_MISMATCH");
  });

  await scenario("reservation to attempt link mismatch fails closed", async () => {
    const item = fixture("reservation-attempt-link-mismatch");
    await seedActiveDurableState(item, "attempt");
    await settleDurableFixtureInactive(item);
    rewriteDurableRecord(path.join(item.folder, "production-execution", "attempts"),
      "durable-attempt-integrity", (value) => {
        const identity = value.identity as Record<string, unknown>;
        identity.reservationId = "foreign-reservation";
      });
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_ATTEMPT_BINDING_MISMATCH");
  });

  await scenario("claim to attempt link mismatch is causally isolated", async () => {
    const item = fixture("claim-attempt-link-mismatch");
    await seedActiveDurableState(item, "attempt");
    await settleDurableFixtureInactive(item);
    rewriteDurableRecord(path.join(item.folder, "production-execution", "attempts"),
      "durable-attempt-integrity", (value) => {
        const identity = value.identity as Record<string, unknown>;
        identity.claimId = "foreign-claim";
      });
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CLAIM_ATTEMPT_BINDING_MISMATCH");
  });

  await scenario("reservation to idempotency link mismatch is causally isolated", async () => {
    const item = fixture("reservation-idempotency-link-mismatch");
    await seedActiveDurableState(item, "attempt");
    await settleDurableFixtureInactive(item);
    const directory = path.join(item.folder, "production-execution", "idempotency");
    const file = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort().at(-1)!;
    const filePath = path.join(directory, file);
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    value.stage = "video";
    const core = { idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      executionFingerprint: value.executionFingerprint, bindingFingerprint: value.bindingFingerprint,
      authorizationDecisionId: value.authorizationDecisionId,
      confirmationRequestId: value.confirmationRequestId, confirmationId: value.confirmationId,
      actorId: value.actorId, projectSlug: value.projectSlug, operation: value.operation,
      action: value.action, stage: value.stage, policyVersion: value.policyVersion,
      riskLevel: value.riskLevel, createdAt: value.createdAt };
    const identityFingerprint = stableProductionId("idempotency-identity", core);
    value.identityFingerprint = identityFingerprint;
    value.integrity = { algorithm: "stable-production-id-v1", fingerprint: identityFingerprint,
      version: value.recordVersion };
    fs.writeFileSync(filePath, JSON.stringify(value));
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_IDEMPOTENCY_BINDING_MISMATCH");
  });

  await scenario("real store list failure is unavailable and not empty", async () => {
    const item = fixture("store-list-unavailable");
    await seedActiveDurableState(item, "reservation");
    const durableRoot = path.join(item.folder, "production-execution");
    const preserved = path.join(durableRoot, "reservations-preserved");
    let crossed = false;
    const adapter = new ProductionExecutionDescriptorBoundReadAdapter(durableRoot, {
      afterDirectoryIdentityRead: (kind, directory) => {
        if (kind !== "reservation" || crossed) return;
        crossed = true;
        fs.renameSync(directory, preserved);
        fs.writeFileSync(directory, "foreign-nondirectory");
      },
    });
    const semantic = await readProductionExecutionRecoverySemanticAuthority(adapter, item.marker.createdAt);
    assert.equal(crossed, true);
    assert.equal(semantic.storeStates.reservations, "unavailable");
    assert.equal(semantic.decision, "indeterminate");
    assert.deepEqual(exactStorePolicyEntry(semantic, "reservation"), {
      storeFamily: "reservation", lifecycleReason: "no-durable-descendant",
      requirementState: "conditionally-required", observedState: "unavailable",
      normalizedOutcome: "rejected-unavailable" });
    assert.equal(fs.statSync(preserved).isDirectory(), true);
    assert.equal(fs.readFileSync(path.join(durableRoot, "reservations"), "utf8"), "foreign-nondirectory");
  });

  await scenario("real store directory replacement is identity changed", async () => {
    const item = fixture("store-directory-identity-changed");
    await seedActiveDurableState(item, "reservation");
    const durableRoot = path.join(item.folder, "production-execution");
    const preserved = path.join(durableRoot, "reservations-preserved");
    let crossed = false;
    const adapter = new ProductionExecutionDescriptorBoundReadAdapter(durableRoot, {
      afterDirectoryIdentityRead: (kind, directory) => {
        if (kind !== "reservation" || crossed) return;
        crossed = true;
        fs.renameSync(directory, preserved);
        fs.cpSync(preserved, directory, { recursive: true });
      },
    });
    const semantic = await readProductionExecutionRecoverySemanticAuthority(adapter, item.marker.createdAt);
    assert.equal(semantic.storeStates.reservations, "identity-changed");
    assert.equal(semantic.decision, "indeterminate");
    assert.deepEqual(exactStorePolicyEntry(semantic, "reservation"), {
      storeFamily: "reservation", lifecycleReason: "no-durable-descendant",
      requirementState: "conditionally-required", observedState: "identity-changed",
      normalizedOutcome: "rejected-identity-changed" });
    assert.equal(fs.statSync(preserved).isDirectory(), true);
    assert.equal(fs.statSync(path.join(durableRoot, "reservations")).isDirectory(), true);
  });

  await scenario("real active durable lease fails closed", async () => {
    const item = fixture("active-durable-lease");
    await seedActiveDurableState(item, "lease");
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_CLAIM_OR_LEASE_CONFLICT");
  });

  await scenario("real conflicting durable claim fails closed", async () => {
    const item = fixture("active-durable-claim");
    await seedActiveDurableState(item, "attempt");
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_CLAIM_OR_LEASE_CONFLICT");
  });

  await scenario("malformed durable record fails closed", async () => {
    const item = fixture("malformed-durable");
    const durable = path.join(item.folder, "production-execution", "idempotency");
    fs.mkdirSync(durable, { recursive: true });
    fs.writeFileSync(path.join(durable, "malformed.json"), "{not-json");
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_RECORD_CORRUPT");
  });

  await scenario("corrupt durable directory entry fails closed", async () => {
    const item = fixture("corrupt-durable-directory-entry");
    const durable = path.join(item.folder, "production-execution", "reservations");
    fs.mkdirSync(durable, { recursive: true });
    fs.writeFileSync(path.join(durable, "foreign.bin"), "foreign");
    await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_CORRUPT");
  });

  await scenario("recovery stage mismatch fails closed", async () => {
    const item = fixture("recovery-stage");
    admissionRecovery = () => Promise.resolve({ blocked: false, startStage: "assembly",
      stagesToRun: [], dependencies: [] });
    try {
      await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
        (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
          error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID");
    } finally { admissionRecovery = recovery; }
  });

  await scenario("active execution fails closed", async () => {
    const item = fixture("active-job");
    admissionJobs = (projectSlug: string) => Promise.resolve({ projectSlug,
      jobs: [{ status: "running" }], createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z" });
    try {
      await assert.rejects(planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps),
        (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
          error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID");
    } finally { admissionJobs = jobs; }
  });

  await scenario("environment drift invalidates confirmation", async () => {
    const item = fixture("environment-drift");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    await assert.rejects(
      reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
        sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
        reauthorizationId: plan.reauthorizationId, confirmation: plan.reauthorizationId }, {
          ...deps,
          environment: { ...environment, OPENAI_AUDIO_MAX_TOKENS: "4096" },
        }),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ENVIRONMENT_DRIFT",
    );
  });

  await scenario("same bytes different inode during operation fails closed", async () => {
    const item = fixture("inode-swap");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    let calls = 0;
    admissionRecovery = async (projectSlug: string) => {
      calls += 1;
      if (calls === 2) {
        fs.renameSync(item.markerPath, `${item.markerPath}.owned`);
        fs.writeFileSync(item.markerPath, item.markerBytes);
      }
      return recovery(projectSlug);
    };
    try { await assert.rejects(
      reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
        sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
        reauthorizationId: plan.reauthorizationId, confirmation: plan.reauthorizationId }, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONCURRENT_CHANGE",
    ); } finally { admissionRecovery = recovery; }
    assert.deepEqual(fs.readFileSync(item.markerPath), item.markerBytes);
  });

  await scenario("foreign authority blocks overwrite", async () => {
    const item = fixture("foreign-authority");
    fs.writeFileSync(path.join(item.folder, "production-acceptance-reauthorization.json"), "foreign");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    await assert.rejects(
      reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
        sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
        reauthorizationId: plan.reauthorizationId, confirmation: plan.reauthorizationId }, deps),
    );
    assert.equal(fs.readFileSync(path.join(item.folder, "production-acceptance-reauthorization.json"), "utf8"), "foreign");
  });

  await scenario("foreign deterministic partial is preserved", async () => {
    const item = fixture("foreign-partial");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    const legacy = path.join(item.folder, "production-acceptance-authority", "legacy");
    fs.mkdirSync(legacy, { recursive: true });
    const partial = path.join(legacy, `.archive-${plan.reauthorizationId}.partial`);
    fs.writeFileSync(partial, "foreign-partial");
    await assert.rejects(
      reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
        sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
        reauthorizationId: plan.reauthorizationId, confirmation: plan.reauthorizationId }, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_REQUIRED",
    );
    assert.equal(fs.readFileSync(partial, "utf8"), "foreign-partial");
  });

  await scenario("command rejects malformed duplicate and unknown arguments", async () => {
    const dependencies = {
      readiness: async () => ({ ready: false, checks: [] }) as never,
      execute: async () => { throw new Error("not called"); },
      resume: async () => { throw new Error("not called"); },
    };
    for (const args of [
      ["legacy-reauthorization-plan", "--project-slug=x"],
      ["legacy-reauthorization-plan", "--project-slug=x", `--source-marker-sha256=${"0".repeat(64)}`, "--unknown=x"],
      ["reauthorize-legacy", "--project-slug=x", `--source-marker-sha256=${"0".repeat(64)}`],
    ]) {
      const result = await runProductionAcceptanceCommand(args, dependencies);
      assert.equal(result.exitCode, 2);
    }
  });

  await scenario("command plan path invokes no pipeline or provider dependency", async () => {
    const item = fixture("command-plan");
    let planned = 0;
    const result = await runProductionAcceptanceCommand([
      "legacy-reauthorization-plan",
      `--project-slug=${item.slug}`,
      `--source-marker-sha256=${item.markerSha256}`,
    ], {
      readiness: async () => { throw new Error("not called"); },
      execute: async () => { throw new Error("not called"); },
      resume: async () => { throw new Error("not called"); },
      legacyReauthorizationPlan: async () => {
        planned += 1;
        return { eligible: true, projectSlug: item.slug, sourceMarkerSha256: item.markerSha256,
          reauthorizationId: "1".repeat(64), reason: "legacy-environment-unrecoverable",
          writePerformed: false };
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(planned, 1);
  });

  await scenario("native schema-3 authority ignores foreign legacy sidecar", async () => {
    const item = fixture("native-v3");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    await reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
      sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
      reauthorizationId: plan.reauthorizationId, confirmation: plan.reauthorizationId }, deps);
    const legacyResolved = await resolveEffectiveProductionAcceptanceAuthority(
      item.slug, undefined, environment,
    );
    assert.equal(legacyResolved.marker.schemaVersion, "3");
    fs.writeFileSync(item.markerPath, JSON.stringify(legacyResolved.marker));
    fs.writeFileSync(path.join(item.folder, "production-acceptance-reauthorization.json"), "foreign", { flag: "w" });
    const native = await resolveEffectiveProductionAcceptanceAuthority(item.slug, legacyResolved.marker, environment);
    assert.equal(native.source, "native");
  });

  await scenario("canonical durable worker propagates legacy capability to the provider gate", async () => {
    for (const key of configuredEnvironmentKeys) {
      process.env[key] = environment[key];
    }
    const item = fixture("canonical-capability-propagation");
    const runtime = createProductionRuntimeOperationContext({ operationId: "canonical-capability-propagation",
      operationType: "pipeline-stage-execution", authorityGeneration: initialRuntimeAuthorityGeneration,
      storageContext: createRuntimeStorageContext({ environment }) });
    const worker = await readyWorker(runtime);
    installCanonicalProductionPipelineExecutionRuntime(worker, runtime);
    canonicalEvidenceRuntime = runtime;
    canonicalEvidenceWorker = worker;
    let providerCalls = 0;
    const state = PipelineStageExecutor.createInitialState({ id: "canonical-project", slug: item.slug,
      title: item.marker.topic, status: "draft", createdAt: item.marker.createdAt,
      updatedAt: item.marker.createdAt });
    fs.writeFileSync(path.join(item.folder, "project.json"), JSON.stringify(state.project));
    await ProjectManager.createManifest(state.project);
    await publishCapabilityFixture(item);
    await runCanonicalRunnerResearchStage(item.slug, (capability, identity) =>
        PipelineStageExecutor.execute(item.slug, "research", state,
          { aiProvider: researchProvider(item.marker.topic, () => { providerCalls += 1; }) },
          capability, identity));
    assert.equal(providerCalls, 1);
  });

  await scenario("canonical identity is structurally unavailable before completed durable preparation",
    async () => {
      const factorySource = fs.readFileSync(
        "src/lib/production/ProductionPipelineExecutionFactory.ts", "utf8");
      const runtimeSource = fs.readFileSync(
        "src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts", "utf8");
      const policySource = fs.readFileSync(
        "src/lib/production/ProductionAcceptancePolicy.ts", "utf8");
      assert.match(factorySource, /const completedPreparations\s*=\s*new WeakMap/);
      assert.match(factorySource, /readCompletedProductionPipelinePreparation/);
      assert.doesNotMatch(factorySource, /return \{[\s\S]{0,200}canonicalIdentity/);
      assert.match(runtimeSource, /const prepared = await prepareProductionPipelineExecution\(context\)/);
      assert.match(runtimeSource,
        /readCompletedProductionPipelinePreparation\([\s\S]{0,80}prepared\.authority/);
      assert.match(runtimeSource, /handler\(undefined, identity, prepared\.authority\)/);
      assert.match(policySource,
        /issueProductionAcceptanceStageCapability[\s\S]*readCompletedProductionPipelinePreparation\(authority\)/);
      await assert.rejects(issueProductionAcceptanceStageCapability(Object.freeze({}) as never));
      await assert.rejects(issueProductionAcceptanceStageCapability({ ...Object.freeze({}) } as never));
      await assert.rejects(issueProductionAcceptanceStageCapability(
        JSON.parse(JSON.stringify(Object.freeze({}))) as never));
    });

  await scenario("controlled ordering binds capability only after durable preparation completion",
    async () => {
      const item = fixture("canonical-post-prepare-ordering");
      const state = PipelineStageExecutor.createInitialState({ id: "post-prepare-ordering-project",
        slug: item.slug, title: item.marker.topic, status: "draft",
        createdAt: item.marker.createdAt, updatedAt: item.marker.createdAt });
      fs.writeFileSync(path.join(item.folder, "project.json"), JSON.stringify(state.project));
      await ProjectManager.createManifest(state.project);
      await publishCapabilityFixture(item);
      const events: string[] = [];
      let releaseAttempt!: () => void;
      let signalAttempt!: () => void;
      const attemptBarrier = new Promise<void>((resolve) => { releaseAttempt = resolve; });
      const attemptPersisted = new Promise<void>((resolve) => { signalAttempt = resolve; });
      let providerCalls = 0;
      try {
        const execution = runWithProductionPipelineExecutionInstrumentation({ onEvent: async (event) => {
          events.push(event);
          if (event === "durable-attempt-persisted") {
            signalAttempt();
            await attemptBarrier;
          }
        } }, () => runCanonicalRunnerResearchStage(item.slug, async (capability, identity) => {
          const attemptPath = latestDurablePath(item, "attempts", identity.attemptId);
          const attempt = JSON.parse(fs.readFileSync(attemptPath, "utf8")) as Record<string, unknown>;
          const attemptIdentity = attempt.identity as Record<string, unknown>;
          const recordPath = latestDurablePath(item, "idempotency", identity.recordId);
          const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as Record<string, unknown>;
          assert.equal(attemptIdentity.requestId, identity.requestId);
          assert.equal(attemptIdentity.idempotencyKey, identity.idempotencyKey);
          assert.equal(record.operation, identity.operation);
          assert.ok(capability);
          return PipelineStageExecutor.execute(item.slug, "research", state,
            { aiProvider: researchProvider(item.marker.topic, () => {
              providerCalls += 1;
              events.push("provider-entered");
            }) }, capability, identity);
        }));
        await attemptPersisted;
        assert.deepEqual(events, ["durable-entry", "durable-attempt-persisted"]);
        assert.equal(providerCalls, 0);
        releaseAttempt();
        await execution;
      } finally {
        releaseAttempt();
      }
      assert.deepEqual(events, ["durable-entry", "durable-attempt-persisted",
        "durable-readback-verified", "canonical-identity-extracted", "lifecycle-bound",
        "capability-issued", "revalidation-entered", "provider-entered"]);
      assert.equal(providerCalls, 1);
    });

  await scenario("pre-prepare identity poisoning cannot become capability authority", async () => {
    const item = fixture("canonical-pre-prepare-poisoning");
    const state = PipelineStageExecutor.createInitialState({ id: "pre-prepare-poisoning-project",
      slug: item.slug, title: item.marker.topic, status: "draft",
      createdAt: item.marker.createdAt, updatedAt: item.marker.createdAt });
    fs.writeFileSync(path.join(item.folder, "project.json"), JSON.stringify(state.project));
    await ProjectManager.createManifest(state.project);
    await publishCapabilityFixture(item);
    let providerCalls = 0;
    let admittedIdentity: ProductionAcceptanceStageExecutionIdentity | undefined;
    await runWithProductionPipelineExecutionInstrumentation({
      poisonPlanAfterDurableAttempt: (plan) => {
        plan.requestId = "poison-request";
        plan.idempotencyKey = "poison-idempotency";
        plan.operation = "pipeline.stage.poison";
        plan.leaseId = "poison-lease";
      },
    }, () => runCanonicalRunnerResearchStage(item.slug, (capability, identity) => {
      admittedIdentity = identity;
      return PipelineStageExecutor.execute(item.slug, "research", state,
        { aiProvider: researchProvider(item.marker.topic, () => { providerCalls += 1; }) },
        capability, identity);
    }));
    assert.ok(admittedIdentity);
    assert.notEqual(admittedIdentity.requestId, "poison-request");
    assert.notEqual(admittedIdentity.idempotencyKey, "poison-idempotency");
    assert.notEqual(admittedIdentity.operation, "pipeline.stage.poison");
    assert.notEqual(admittedIdentity.leaseId, "poison-lease");
    const recordPath = latestDurablePath(item, "idempotency", admittedIdentity.recordId);
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as Record<string, unknown>;
    const lease = (record.durableLease as Record<string, unknown>).identity as Record<string, unknown>;
    assert.equal(admittedIdentity.requestId, record.requestId);
    assert.equal(admittedIdentity.idempotencyKey, record.idempotencyKey);
    assert.equal(admittedIdentity.operation, record.operation);
    assert.equal(admittedIdentity.leaseId, lease.leaseId);
    assert.equal(providerCalls, 1);
  });

  for (const mutation of ["same-byte-replacement", "truncate", "growth", "disappear"] as const) {
    await scenario(`record-level ${mutation} has descriptor bootstrap snapshot and provider-gate parity`,
      () => verifyRecordLevelParity(mutation));
  }

  await scenario("missing capability after real durable preparation stops before provider", async () => {
    const item = fixture("canonical-missing-capability");
    assert.ok(canonicalEvidenceRuntime);
    assert.ok(canonicalEvidenceWorker);
    let providerCalls = 0;
    const state = PipelineStageExecutor.createInitialState({ id: "missing-capability-project", slug: item.slug,
      title: item.marker.topic, status: "draft", createdAt: item.marker.createdAt,
      updatedAt: item.marker.createdAt });
    fs.writeFileSync(path.join(item.folder, "project.json"), JSON.stringify(state.project));
    await ProjectManager.createManifest(state.project);
    await publishCapabilityFixture(item);
    let gateError: unknown;
    await assert.rejects(runCanonicalRunnerResearchStage(item.slug, (_capability, identity) =>
        PipelineStageExecutor.execute(item.slug, "research", state,
          { aiProvider: researchProvider(item.marker.topic, () => { providerCalls += 1; }) },
          undefined, identity).catch((error) => { gateError = error; throw error; })));
    assert.ok(gateError instanceof ProductionAcceptanceLegacyReauthorizationError);
    assert.equal(gateError.code, "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_MISSING");
    assert.equal(providerCalls, 0);
  });

  for (const mismatch of [
    { field: "requestId", value: "foreign-request",
      code: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_REQUEST_ID_MISMATCH" },
    { field: "idempotencyKey", value: "foreign-idempotency",
      code: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_IDEMPOTENCY_KEY_MISMATCH" },
    { field: "operation", value: "pipeline.stage.retry",
      code: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_OPERATION_MISMATCH" },
    { field: "leaseId", value: "foreign-lease",
      code: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_LEASE_ID_MISMATCH" },
  ] as const) {
    await scenario(`real PipelineRunner capability binds exact ${mismatch.field}`, async () => {
      const item = fixture(`canonical-${mismatch.field}-mismatch`);
      const state = PipelineStageExecutor.createInitialState({ id: `${mismatch.field}-project`,
        slug: item.slug, title: item.marker.topic, status: "draft",
        createdAt: item.marker.createdAt, updatedAt: item.marker.createdAt });
      fs.writeFileSync(path.join(item.folder, "project.json"), JSON.stringify(state.project));
      await ProjectManager.createManifest(state.project);
      await publishCapabilityFixture(item);
      let providerCalls = 0;
      await runCanonicalRunnerResearchStage(item.slug, async (capability, identity) => {
        assert.ok(capability);
        const mismatchedIdentity = Object.freeze({ ...identity, [mismatch.field]: mismatch.value });
        await assert.rejects(PipelineStageExecutor.execute(item.slug, "research", state,
          { aiProvider: researchProvider(item.marker.topic, () => { providerCalls += 1; }) },
          capability, mismatchedIdentity),
        (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
          error.code === mismatch.code);
        await assert.rejects(consumeProductionAcceptanceStageCapability(identity, capability),
          (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
            error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_INVALIDATED");
        return true;
      });
      assert.equal(providerCalls, 0);
    });
  }

  await scenario("issued completed lease rejects coordinated durable lease mutation", () =>
    runCanonicalProviderGateFailure({
      suffix: "canonical-coordinated-lease-mismatch",
      expectedCode: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_LEASE_ID_MISMATCH",
      mutate: (item, identity) => {
        const mutatedLeaseId = "coordinated-foreign-lease";
        assert.notEqual(identity.leaseId, mutatedLeaseId);
        const restoreRecord = rewriteJsonFile(
          latestDurablePath(item, "idempotency", identity.recordId),
          (value) => {
            const lease = value.durableLease as Record<string, unknown>;
            const leaseIdentity = lease.identity as Record<string, unknown>;
            delete lease.integrity;
            leaseIdentity.leaseId = mutatedLeaseId;
            lease.integrity = { algorithm: "stable-production-id-v1",
              fingerprint: stableProductionId("durable-lease-integrity", lease) };
          },
        );
        const restoreClaim = rewriteJsonFile(
          latestDurablePath(item, "claims", identity.claimId),
          (value) => { (value.identity as Record<string, unknown>).leaseId = mutatedLeaseId; },
          "durable-claim-integrity",
        );
        const restoreAttempt = rewriteJsonFile(
          latestDurablePath(item, "attempts", identity.attemptId),
          (value) => { (value.identity as Record<string, unknown>).leaseId = mutatedLeaseId; },
          "durable-attempt-integrity",
        );
        const mutatedRecord = JSON.parse(fs.readFileSync(
          latestDurablePath(item, "idempotency", identity.recordId), "utf8")) as Record<string, unknown>;
        const mutatedLease = (mutatedRecord.durableLease as Record<string, unknown>)
          .identity as Record<string, unknown>;
        const mutatedClaim = JSON.parse(fs.readFileSync(
          latestDurablePath(item, "claims", identity.claimId), "utf8")) as Record<string, unknown>;
        const mutatedAttempt = JSON.parse(fs.readFileSync(
          latestDurablePath(item, "attempts", identity.attemptId), "utf8")) as Record<string, unknown>;
        assert.equal(mutatedLease.leaseId, mutatedLeaseId);
        assert.equal((mutatedClaim.identity as Record<string, unknown>).leaseId, mutatedLeaseId);
        assert.equal((mutatedAttempt.identity as Record<string, unknown>).leaseId, mutatedLeaseId);
        return () => { restoreAttempt(); restoreClaim(); restoreRecord(); };
      },
    }));

  await scenario("real durable propagation rejects mandatory attempt store loss", async () => {
    const item = fixture("canonical-required-attempt-loss");
    let providerCalls = 0;
    let issuedCapability: Awaited<ReturnType<typeof issueProductionAcceptanceStageCapability>>;
    let issuedIdentity: ProductionAcceptanceStageExecutionIdentity | undefined;
    const state = PipelineStageExecutor.createInitialState({ id: "required-attempt-project", slug: item.slug,
      title: item.marker.topic, status: "draft", createdAt: item.marker.createdAt,
      updatedAt: item.marker.createdAt });
    fs.writeFileSync(path.join(item.folder, "project.json"), JSON.stringify(state.project));
    await ProjectManager.createManifest(state.project);
    await publishCapabilityFixture(item);
    await runCanonicalRunnerResearchStage(item.slug, async (capability, identity) => {
      issuedCapability = capability;
      issuedIdentity = identity;
      assert.equal(identity.durableAttemptRequired, true);
      const attempts = path.join(item.folder, "production-execution", "attempts");
      const preserved = path.join(item.folder, "production-execution", "attempts-preserved");
      assert.ok(fs.readdirSync(attempts).some((name) => name.startsWith(`${identity.attemptId}-v`)));
      fs.renameSync(attempts, preserved);
      await assert.rejects(PipelineStageExecutor.execute(item.slug, "research", state,
        { aiProvider: researchProvider(item.marker.topic, () => { providerCalls += 1; }) },
        capability, identity),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_ATTEMPT_STORE_MISSING");
      assert.equal(fs.statSync(preserved).isDirectory(), true);
      fs.renameSync(preserved, attempts);
      return true;
    });
    assert.equal(providerCalls, 0);
    assert.ok(issuedCapability && issuedIdentity);
    await assert.rejects(consumeProductionAcceptanceStageCapability(issuedIdentity, issuedCapability),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_INVALIDATED");
  });

  await scenario("real provider gate rejects same-project external active reservation", () =>
    runCanonicalProviderGateFailure({ suffix: "provider-gate-external-active-reservation",
      expectedCode: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ACTIVE_RESERVATION_CONFLICT",
      mutate: async (item) => { await seedActiveDurableState(item, "record", true); } }));

  for (const missing of [
    { family: "reservations", code: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_RESERVATION_STORE_MISSING" },
    { family: "idempotency", code: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_IDEMPOTENCY_STORE_MISSING" },
    { family: "claims", code: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_CLAIM_STORE_MISSING" },
  ] as const) {
    await scenario(`real provider gate rejects required ${missing.family} store loss`, () =>
      runCanonicalProviderGateFailure({ suffix: `provider-gate-required-${missing.family}-loss`,
        expectedCode: missing.code, mutate: (item) => {
          const directory = path.join(item.folder, "production-execution", missing.family);
          const preserved = `${directory}-preserved`;
          fs.renameSync(directory, preserved);
          return () => fs.renameSync(preserved, directory);
        } }));
  }

  await scenario("real provider gate classifies reservation store unavailable before provider", () =>
    runCanonicalProviderGateFailure({ suffix: "provider-gate-reservation-store-unavailable",
      expectedCode: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_UNAVAILABLE",
      mutate: (item) => {
        const directory = path.join(item.folder, "production-execution", "reservations");
        const preserved = `${directory}-preserved`;
        const mutableFs = fs as unknown as { lstatSync(target: fs.PathLike,
          options: { bigint: true }): fs.BigIntStats };
        const originalLstat = mutableFs.lstatSync;
        let crossed = false;
        mutableFs.lstatSync = (target, options) => {
          const result = originalLstat(target, options);
          if (!crossed && path.resolve(target.toString()) === path.resolve(directory)) {
            crossed = true;
            fs.renameSync(directory, preserved);
            fs.writeFileSync(directory, "foreign-nondirectory");
          }
          return result;
        };
        return () => {
          mutableFs.lstatSync = originalLstat;
          assert.equal(crossed, true);
          assert.equal(fs.readFileSync(directory, "utf8"), "foreign-nondirectory");
          fs.rmSync(directory); fs.renameSync(preserved, directory);
        };
      } }));

  const causalProviderGateCases = [
    { suffix: "provider-gate-reservation-claim-mismatch",
      code: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_CLAIM_BINDING_MISMATCH" as const,
      mutate: (item: ReturnType<typeof fixture>, identity: ProductionAcceptanceStageExecutionIdentity) =>
        rewriteJsonFile(latestDurablePath(item, "claims", identity.claimId), (value) => {
          (value.identity as Record<string, unknown>).reservationId = "foreign-reservation";
        }, "durable-claim-integrity") },
    { suffix: "provider-gate-reservation-attempt-mismatch",
      code: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_ATTEMPT_BINDING_MISMATCH" as const,
      mutate: (item: ReturnType<typeof fixture>, identity: ProductionAcceptanceStageExecutionIdentity) =>
        rewriteJsonFile(latestDurablePath(item, "attempts", identity.attemptId), (value) => {
          (value.identity as Record<string, unknown>).reservationId = "foreign-reservation";
        }, "durable-attempt-integrity") },
    { suffix: "provider-gate-reservation-idempotency-mismatch",
      code: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_IDEMPOTENCY_BINDING_MISMATCH" as const,
      mutate: (item: ReturnType<typeof fixture>, identity: ProductionAcceptanceStageExecutionIdentity) =>
        rewriteJsonFile(latestDurablePath(item, "idempotency", identity.recordId), (value) => {
          value.stage = "video";
          const core = { idempotencyKey: value.idempotencyKey, requestId: value.requestId,
            executionFingerprint: value.executionFingerprint, bindingFingerprint: value.bindingFingerprint,
            authorizationDecisionId: value.authorizationDecisionId,
            confirmationRequestId: value.confirmationRequestId, confirmationId: value.confirmationId,
            actorId: value.actorId, projectSlug: value.projectSlug, operation: value.operation,
            action: value.action, stage: value.stage, policyVersion: value.policyVersion,
            riskLevel: value.riskLevel, createdAt: value.createdAt };
          const fingerprint = stableProductionId("idempotency-identity", core);
          value.identityFingerprint = fingerprint;
          value.integrity = { algorithm: "stable-production-id-v1", fingerprint,
            version: value.recordVersion };
        }) },
    { suffix: "provider-gate-claim-attempt-mismatch",
      code: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CLAIM_ATTEMPT_BINDING_MISMATCH" as const,
      mutate: (item: ReturnType<typeof fixture>, identity: ProductionAcceptanceStageExecutionIdentity) =>
        rewriteJsonFile(latestDurablePath(item, "attempts", identity.attemptId), (value) => {
          (value.identity as Record<string, unknown>).recordId = "foreign-record";
        }, "durable-attempt-integrity") },
  ];
  for (const item of causalProviderGateCases) {
    await scenario(`real PipelineRunner provider gate isolates ${item.code}`, () =>
      runCanonicalProviderGateFailure({ suffix: item.suffix, expectedCode: item.code,
        mutate: item.mutate }));
  }

  await scenario("real provider gate rejects malformed reservation payload with corrupt matrix", () =>
    runCanonicalProviderGateFailure({ suffix: "provider-gate-malformed-reservation-payload",
      expectedCode: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_RECORD_CORRUPT",
      mutate: (item, identity) => {
        const target = latestDurablePath(item, "reservations", identity.reservationId);
        const original = fs.readFileSync(target); fs.writeFileSync(target, "{not-json");
        return () => fs.writeFileSync(target, original);
      }, assertSemantic: assertReservationCorruptSemantic }));

  await scenario("real provider gate rejects malformed reservation key with corrupt matrix", () =>
    runCanonicalProviderGateFailure({ suffix: "provider-gate-malformed-reservation-key",
      expectedCode: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_CORRUPT",
      mutate: (item, identity) => {
        const target = latestDurablePath(item, "reservations", identity.reservationId);
        const foreign = path.join(path.dirname(target), "Bad Key.json");
        fs.renameSync(target, foreign);
        return () => fs.renameSync(foreign, target);
      }, assertSemantic: assertReservationCorruptSemantic }));

  await scenario("real provider gate rejects unsupported reservation schema with corrupt matrix", () =>
    runCanonicalProviderGateFailure({ suffix: "provider-gate-unsupported-reservation-schema",
      expectedCode: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_RECORD_CORRUPT",
      mutate: (item, identity) => rewriteJsonFile(
        latestDurablePath(item, "reservations", identity.reservationId),
        (value) => { value.schemaVersion = "2"; }),
      assertSemantic: assertReservationCorruptSemantic }));

  await scenario("real provider gate rejects reservation key identity mismatch with corrupt matrix", () =>
    runCanonicalProviderGateFailure({ suffix: "provider-gate-reservation-key-identity-mismatch",
      expectedCode: "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_CORRUPT",
      mutate: (item, identity) => {
        const target = latestDurablePath(item, "reservations", identity.reservationId);
        const foreign = path.join(path.dirname(target), "foreign-reservation.json");
        fs.renameSync(target, foreign);
        return () => fs.renameSync(foreign, target);
      }, assertSemantic: assertReservationCorruptSemantic }));

  await scenario("real durable propagation rejects lifecycle generation change before provider", async () => {
    const item = fixture("canonical-lifecycle-generation-change");
    assert.ok(canonicalEvidenceWorker);
    let providerCalls = 0;
    const state = PipelineStageExecutor.createInitialState({ id: "lifecycle-change-project", slug: item.slug,
      title: item.marker.topic, status: "draft", createdAt: item.marker.createdAt,
      updatedAt: item.marker.createdAt });
    fs.writeFileSync(path.join(item.folder, "project.json"), JSON.stringify(state.project));
    await ProjectManager.createManifest(state.project);
    await publishCapabilityFixture(item);
    await assert.rejects(runCanonicalRunnerResearchStage(item.slug, async (capability, identity) => {
      await canonicalEvidenceWorker!.withExecutionIdentity({ projectSlug: "foreign-lifecycle-project",
        stage: "research", operation: "pipeline.stage.initial",
        executionFingerprint: "foreign-lifecycle-execution" }, async () => {});
      return PipelineStageExecutor.execute(item.slug, "research", state,
        { aiProvider: researchProvider(item.marker.topic, () => { providerCalls += 1; }) },
        capability, identity);
    }));
    assert.equal(providerCalls, 0);
  });

  await scenario("missing lifecycle binding invalidates a consuming capability", async () => {
    const issued = await withDirectCapabilityEvidence("missing-lifecycle-binding",
      async ({ item, runtime, identity, authority, state }) => {
        const capability = await issueProductionAcceptanceStageCapability(authority);
        assert.ok(capability);
        return { item, runtime, identity, state, capability };
      });
    let providerCalls = 0;
    await assert.rejects(runWithProductionRuntimeOperationContext(issued.runtime, () =>
      PipelineStageExecutor.execute(issued.item.slug, "research", issued.state,
        { aiProvider: researchProvider(issued.item.marker.topic, () => { providerCalls += 1; }) },
        issued.capability, issued.identity)),
    (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
      error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_WORKER_LIFECYCLE_UNAVAILABLE");
    assert.equal(providerCalls, 0);
    await assert.rejects(consumeProductionAcceptanceStageCapability(issued.identity, issued.capability),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_INVALIDATED");
  });

  await scenario("authority mutation after issuance rejects the first provider gate", async () => {
    await withDirectCapabilityEvidence("first-gate-authority-mutation",
      async ({ item, identity, authority, state }) => {
        const capability = await issueProductionAcceptanceStageCapability(authority);
        assert.ok(capability);
        const marker = JSON.parse(fs.readFileSync(item.markerPath, "utf8")) as Record<string, unknown>;
        marker.createdAt = "2026-07-21T00:00:01.000Z";
        fs.writeFileSync(item.markerPath, JSON.stringify(marker));
        let providerCalls = 0;
        await assert.rejects(PipelineStageExecutor.execute(item.slug, "research", state,
          { aiProvider: researchProvider(item.marker.topic, () => { providerCalls += 1; }) },
          capability, identity),
        (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
          error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_STALE");
        await assert.rejects(consumeProductionAcceptanceStageCapability(identity, capability),
          (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
            error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_INVALIDATED");
        assert.equal(providerCalls, 0);
      });
  });

  await scenario("provider throw consumes capability and blocks replay", async () => {
    await withDirectCapabilityEvidence("provider-throw-replay", async ({ item, identity, authority, state }) => {
      const capability = await issueProductionAcceptanceStageCapability(authority);
      assert.ok(capability);
      let providerCalls = 0;
      await assert.rejects(PipelineStageExecutor.execute(item.slug, "research", state,
        { aiProvider: { generate: async () => { providerCalls += 1;
          throw new Error("controlled provider failure"); } } }, capability, identity));
      assert.equal(providerCalls, 1);
      await assert.rejects(consumeProductionAcceptanceStageCapability(identity, capability),
        (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
          error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_REPLAYED");
      assert.equal(providerCalls, 1);
    });
  });

  await scenario("provider throw admits only one concurrent capability consumer", async () => {
    await withDirectCapabilityEvidence("provider-throw-concurrent", async ({ item, identity, authority, state }) => {
      const capability = await issueProductionAcceptanceStageCapability(authority);
      assert.ok(capability);
      let providerCalls = 0;
      let releaseProvider!: () => void;
      let markProviderEntered!: () => void;
      const providerEntered = new Promise<void>((resolve) => { markProviderEntered = resolve; });
      const providerBarrier = new Promise<void>((resolve) => { releaseProvider = resolve; });
      const provider = { generate: async () => {
        providerCalls += 1;
        markProviderEntered();
        await providerBarrier;
        throw new Error("controlled concurrent provider failure");
      } };
      const first = PipelineStageExecutor.execute(item.slug, "research", state,
        { aiProvider: provider }, capability, identity);
      const second = PipelineStageExecutor.execute(item.slug, "research", state,
        { aiProvider: provider }, capability, identity);
      const settledPromise = Promise.allSettled([first, second]);
      await providerEntered;
      releaseProvider();
      const settled = await settledPromise;
      assert.equal(providerCalls, 1);
      assert.equal(settled.filter((result) => result.status === "rejected").length, 2);
      assert.equal(settled.filter((result) => result.status === "rejected" &&
        result.reason instanceof ProductionAcceptanceLegacyReauthorizationError &&
        result.reason.code ===
          "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_CONCURRENT_CONSUMPTION").length, 1);
      await assert.rejects(consumeProductionAcceptanceStageCapability(identity, capability),
        (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
          error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_REPLAYED");
    });
  });

  await scenario("revalidation failure preserves exact concurrent loser outcome", async () => {
    await withDirectCapabilityEvidence("revalidation-concurrent", async ({ item, identity, authority, state }) => {
      const capability = await issueProductionAcceptanceStageCapability(authority);
      assert.ok(capability);
      const marker = JSON.parse(fs.readFileSync(item.markerPath, "utf8")) as Record<string, unknown>;
      marker.runId = crypto.randomUUID();
      fs.writeFileSync(item.markerPath, JSON.stringify(marker));
      let providerCalls = 0;
      let signalRevalidation!: () => void;
      let releaseRevalidation!: () => void;
      const revalidationEntered = new Promise<void>((resolve) => { signalRevalidation = resolve; });
      const revalidationBarrier = new Promise<void>((resolve) => { releaseRevalidation = resolve; });
      const settled = await runWithProductionPipelineExecutionInstrumentation({
        onEvent: async (event) => {
          if (event === "revalidation-entered") {
            signalRevalidation();
            await revalidationBarrier;
          }
        },
      }, async () => {
        const first = PipelineStageExecutor.execute(item.slug, "research", state,
          { aiProvider: researchProvider(item.marker.topic, () => { providerCalls += 1; }) }, capability, identity);
        await revalidationEntered;
        const second = PipelineStageExecutor.execute(item.slug, "research", state,
          { aiProvider: researchProvider(item.marker.topic, () => { providerCalls += 1; }) }, capability, identity);
        const outcomes = Promise.allSettled([first, second]);
        releaseRevalidation();
        return outcomes;
      });
      assert.equal(settled.filter((result) => result.status === "rejected" &&
        result.reason instanceof ProductionAcceptanceLegacyReauthorizationError &&
        result.reason.code ===
          "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_CONCURRENT_CONSUMPTION").length, 1);
      assert.equal(settled.filter((result) => result.status === "rejected" &&
        result.reason instanceof ProductionAcceptanceLegacyReauthorizationError &&
        result.reason.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_STALE").length, 1);
      assert.equal(providerCalls, 0);
      await assert.rejects(consumeProductionAcceptanceStageCapability(identity, capability),
        (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
          error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_INVALIDATED");
    });
  });

  await scenario("runtime authority generation mismatch invalidates before provider", async () => {
    const issued = await withDirectCapabilityEvidence("runtime-generation-mismatch",
      async ({ item, runtime, identity, authority, state }) => {
        const capability = await issueProductionAcceptanceStageCapability(authority);
        assert.ok(capability);
        return { item, runtime, identity, state, capability };
      });
    const divergentRuntimeRoot = path.join(root, "runtime-generation-divergent");
    fs.mkdirSync(path.join(divergentRuntimeRoot, "projects"), { recursive: true });
    const divergentStorage = createRuntimeStorageContext({
      environment: { ...environment, ATOLYE_RUNTIME_ROOT: divergentRuntimeRoot },
      workspaceRoot: process.cwd(), authorityRoot: path.join(root, "authority-generation-divergent") });
    const divergent = createProductionRuntimeOperationContext({ operationId: "runtime-generation-divergent",
      operationType: "pipeline-stage-execution",
      authorityGeneration: "runtime-authority-generation-v2",
      storageContext: divergentStorage });
    const divergentWorker = await readyWorker(divergent);
    let providerCalls = 0;
    await assert.rejects(divergentWorker.executeWithRuntimeOperationContext(divergent, () =>
      runWithProductionWorkerLifecycleIdentity(divergent, { projectSlug: issued.item.slug, stage: "research",
        operation: "pipeline.stage.initial", executionFingerprint: issued.identity.executionFingerprint }, () =>
        PipelineStageExecutor.execute(issued.item.slug, "research", issued.state,
          { aiProvider: researchProvider(issued.item.marker.topic, () => { providerCalls += 1; }) },
          issued.capability, issued.identity))),
    (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
      error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_STALE");
    assert.equal(providerCalls, 0);
    await assert.rejects(consumeProductionAcceptanceStageCapability(issued.identity, issued.capability),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_INVALIDATED");
  });

  await scenario("real lifecycle generation transition invalidates before provider", async () => {
    await withDirectCapabilityEvidence("lifecycle-generation-mismatch",
      async ({ item, worker, identity, authority, state }) => {
        const capability = await issueProductionAcceptanceStageCapability(authority);
        assert.ok(capability);
        await worker.withExecutionIdentity({ projectSlug: "cross-project", stage: "research",
          operation: "pipeline.stage.initial", executionFingerprint: "cross-execution" }, async () => {});
        let providerCalls = 0;
        await assert.rejects(PipelineStageExecutor.execute(item.slug, "research", state,
          { aiProvider: researchProvider(item.marker.topic, () => { providerCalls += 1; }) },
          capability, identity),
        (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
          error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_STALE");
        assert.equal(providerCalls, 0);
        await assert.rejects(consumeProductionAcceptanceStageCapability(identity, capability),
          (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
            error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_INVALIDATED");
      });
  });

  await scenario("wrong run invalidates capability before provider", async () => {
    await withDirectCapabilityEvidence("wrong-run", async ({ item, identity, authority, state }) => {
      const capability = await issueProductionAcceptanceStageCapability(authority);
      assert.ok(capability);
      const marker = JSON.parse(fs.readFileSync(item.markerPath, "utf8")) as Record<string, unknown>;
      marker.runId = crypto.randomUUID();
      fs.writeFileSync(item.markerPath, JSON.stringify(marker));
      let providerCalls = 0;
      await assert.rejects(PipelineStageExecutor.execute(item.slug, "research", state,
        { aiProvider: researchProvider(item.marker.topic, () => { providerCalls += 1; }) },
        capability, identity),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_STALE");
      assert.equal(providerCalls, 0);
      await assert.rejects(consumeProductionAcceptanceStageCapability(identity, capability),
        (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
          error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_INVALIDATED");
    });
  });

  await scenario("legacy capability gates the real provider boundary and rejects forgery replay and drift", async () => {
    const configuredKeys = ["AI_PROVIDER", "IMAGE_PROVIDER", "AUDIO_PROVIDER", "ANIMATION_PROVIDER",
      "VIDEO_PROVIDER", "VIDEO_ASSEMBLY_PROVIDER", "THUMBNAIL_PROVIDER", "YOUTUBE_PROVIDER",
      "ATOLYE_DURABLE_PIPELINE_EXECUTION", "OPENAI_API_KEY", "FFMPEG_PATH", "FFPROBE_PATH"] as const;
    const previous = new Map(configuredKeys.map((key) => [key, process.env[key]]));
    for (const key of configuredKeys) process.env[key] = environment[key];
    try {
      const item = fixture("capability-provider-gate");
      await publishCapabilityFixture(item);
      const storage = createRuntimeStorageContext({ environment });
      const runtime = createProductionRuntimeOperationContext({ operationId: "capability-provider-gate",
        operationType: "pipeline-stage-execution", authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext: storage });
      const worker = new ProductionWorkerLifecycle(() => "2026-07-21T00:00:00.000Z");
      worker.bindRuntimeOperationContext(runtime);
      await worker.start({ initialization: { schemaVersion: "1", ok: true, decision: "ready",
        reasonCode: "RUNTIME_INITIALIZED", initializedAt: "2026-07-21T00:00:00.000Z",
        writeFree: true, partialInitialization: false, projects: [],
        counts: { active: 0, running: 0, terminal: 0, orphaned: 0,
          "expired-lease": 0, replayable: 0 }, worker: worker.snapshot(), evidence: [] } });
      const state = PipelineStageExecutor.createInitialState({ id: "capability-project",
        slug: item.slug, title: item.marker.topic, status: "draft",
        createdAt: item.marker.createdAt, updatedAt: item.marker.createdAt });
      fs.writeFileSync(path.join(item.folder, "project.json"), JSON.stringify(state.project));
      await ProjectManager.createManifest(state.project);
      const prepared = await prepareProductionPipelineExecution({ projectSlug: item.slug,
        stage: "research", runType: "initial" });
      const identity = readCompletedProductionPipelinePreparation(prepared.authority).canonicalIdentity;
      let providerCalls = 0;
      let markProviderEntered!: () => void;
      let releaseProvider!: () => void;
      const providerEntered = new Promise<void>((resolve) => { markProviderEntered = resolve; });
      const providerBarrier = new Promise<void>((resolve) => { releaseProvider = resolve; });
      const provider = { generate: async () => {
        providerCalls += 1;
        markProviderEntered();
        await providerBarrier;
        return JSON.stringify({ topic: item.marker.topic, summary: "summary",
          historicalContext: "context", timeline: ["timeline"], characters: [], locations: [],
          keyEvents: ["event"], strategies: [], controversies: [], interestingFacts: [],
          documentaryFlow: ["flow"], sceneIdeas: ["scene"], imagePrompts: ["image"],
          animationPrompts: [], musicIdeas: [], soundEffects: [], thumbnailIdeas: [],
          youtubeTitles: [], sources: ["https://example.invalid/source"] });
      } };
      await worker.executeWithRuntimeOperationContext(runtime, () =>
        runWithProductionWorkerLifecycleIdentity(runtime, { projectSlug: item.slug,
          stage: "research", operation: "pipeline.stage.initial",
          executionFingerprint: identity.executionFingerprint }, async () => {
          const capability = await issueProductionAcceptanceStageCapability(prepared.authority);
          const staleCapability = await issueProductionAcceptanceStageCapability(prepared.authority);
          assert.ok(capability);
          assert.ok(staleCapability);
          const rejected = async (candidateIdentity: ProductionAcceptanceStageExecutionIdentity,
            candidateCapability: unknown) => assert.rejects(
            PipelineStageExecutor.execute(candidateIdentity.projectSlug, candidateIdentity.stage,
              state, { aiProvider: provider }, candidateCapability as never, candidateIdentity));
          await rejected(identity, undefined);
          await rejected(identity, Object.freeze({}));
          const rejectedIdentity = async (candidateIdentity: ProductionAcceptanceStageExecutionIdentity) => {
            const probe = await issueProductionAcceptanceStageCapability(prepared.authority);
            assert.ok(probe);
            await rejected(candidateIdentity, probe);
            await assert.rejects(consumeProductionAcceptanceStageCapability(identity, probe),
              (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
                error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_INVALIDATED");
          };
          await rejectedIdentity({ ...identity, projectSlug: `${item.slug}-wrong` });
          await rejectedIdentity({ ...identity, stage: "script" });
          await rejectedIdentity({ ...identity, jobId: "wrong-job" });
          await rejectedIdentity({ ...identity, attemptNumber: 1 });
          await rejectedIdentity({ ...identity, recordId: "wrong-record" });
          await rejectedIdentity({ ...identity, reservationId: "wrong-reservation" });
          await rejectedIdentity({ ...identity, claimId: "wrong-claim" });
          await rejectedIdentity({ ...identity, attemptId: "wrong-attempt" });
          await rejectedIdentity({ ...identity, executionFingerprint: "wrong-execution" });
          assert.equal(providerCalls, 0);
          let signalRevalidation!: () => void;
          const revalidationEntered = new Promise<void>((resolve) => { signalRevalidation = resolve; });
          const concurrent = await runWithProductionPipelineExecutionInstrumentation({
            onEvent: (event) => {
              if (event === "revalidation-entered") signalRevalidation();
            },
          }, async () => {
            const owner = PipelineStageExecutor.execute(item.slug, "research", state,
              { aiProvider: provider }, capability, identity);
            await revalidationEntered;
            const loser = PipelineStageExecutor.execute(item.slug, "research", state,
              { aiProvider: provider }, capability, identity);
            const concurrentPromise = Promise.allSettled([owner, loser]);
            await providerEntered;
            releaseProvider();
            return concurrentPromise;
          });
          assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
          assert.equal(concurrent.filter((result) => result.status === "rejected" &&
            result.reason instanceof ProductionAcceptanceLegacyReauthorizationError &&
            result.reason.code ===
              "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_CONCURRENT_CONSUMPTION").length, 1);
          assert.equal(providerCalls, 1);
          await assert.rejects(PipelineStageExecutor.execute(item.slug, "research", state,
            { aiProvider: provider }, staleCapability, identity),
          (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
            error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_STALE");
          assert.equal(providerCalls, 1);
          await assert.rejects(consumeProductionAcceptanceStageCapability(identity, staleCapability),
            (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
              error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_INVALIDATED");
          await assert.rejects(consumeProductionAcceptanceStageCapability(identity, capability),
            (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
              error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_REPLAYED");
          assert.equal(providerCalls, 1);
        }));
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  await scenario("public command errors remain path and secret free", async () => {
    const result = await runProductionAcceptanceCommand([
      "reauthorize-legacy",
      "--project-slug=safe-project",
      `--source-marker-sha256=${"0".repeat(64)}`,
      "--reason=legacy-environment-unrecoverable",
      `--reauthorization-id=${"1".repeat(64)}`,
      `--confirm-production-acceptance-legacy-reauthorization=${"2".repeat(64)}`,
    ]);
    const text = JSON.stringify(result.report);
    assert.equal(text.includes(root), false);
    assert.equal(text.includes(environment.OPENAI_API_KEY), false);
    assert.equal(/stack|AppData|ENOENT/.test(text), false);
  });

  process.stdout.write(`Sprint 129.28 legacy re-authorization smoke: PASS (${scenarios} scenarios)\n`);
} finally {
  PipelineRecoveryPlanner.createResumePlan = originalCreateResumePlan;
  PipelineJobManager.listJobsReadOnly = originalListJobsReadOnly;
  for (const [key, value] of previousConfiguredEnvironment) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  if (previousRuntimeRoot === undefined) delete process.env.ATOLYE_RUNTIME_ROOT;
  else process.env.ATOLYE_RUNTIME_ROOT = previousRuntimeRoot;
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
}

void main().catch((error) => {
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
  catch { /* Preserve failure. */ }
  throw error;
});
