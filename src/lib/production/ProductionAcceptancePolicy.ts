import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import { ProjectWriter } from "@/lib/projects/ProjectWriter";
import {
  createProductionAcceptanceProjectSlug,
  normalizeProductionAcceptanceTopic,
  productionAcceptanceTopicFingerprint,
} from "./ProductionAcceptanceTopic";
import {
  createProductionAcceptancePortableConfigurationSnapshot,
  createProductionAcceptancePortableConfigurationSnapshotV2,
  findProductionAcceptanceConfigurationMismatches,
  findProductionAcceptanceConfigurationMismatchesV2,
  productionAcceptancePortableConfigurationFingerprint,
  productionAcceptancePortableConfigurationFingerprintV2,
  validProductionAcceptanceComponentFingerprints,
  validProductionAcceptanceComponentFingerprintsV2,
  type ProductionAcceptanceComponentFingerprints,
  type ProductionAcceptanceComponentFingerprintsV2,
  type ProductionAcceptancePortableConfigurationSnapshot,
  type ProductionAcceptancePortableConfigurationSnapshotV2,
} from "./ProductionAcceptanceConfigurationFingerprint";
import {
  markLegacyReauthorizationValidated,
  readLegacyReauthorizationAuthority,
} from "./ProductionAcceptanceLegacyAuthorityStore";
import type { ProductionAcceptanceLegacyReauthorizationV1 } from
  "./ProductionAcceptanceLegacyReauthorization";
import {
  canonicalJson,
  deriveLegacyReauthorizationId,
  legacyReauthorizationReceiptPolicyVersion,
  legacyReauthorizationReason,
  legacyReauthorizationSchemaVersion,
  ProductionAcceptanceLegacyReauthorizationError,
  sha256Bytes,
} from "./ProductionAcceptanceLegacyReauthorization";
import {
  createLegacyReauthorizationPreflight,
} from "./ProductionAcceptanceLegacyReauthorizationPreflight";
import { readCanonicalProductionAcceptanceMarkerDescriptorBound } from
  "./ProductionAcceptanceMarkerDescriptorReader";
import { getActiveProductionRuntimeOperationContext, requireProductionRuntimeStorageContext } from
  "@/lib/runtime/ProductionRuntimeOperationContext";
import type { ProductionStepKey, ProjectPackageRunType } from "@/types/project";
import { withProductionAcceptanceLegacyAdmittedExecution } from
  "./ProductionAcceptanceLegacyAdmissionContext";
import { readProductionWorkerLifecycleAuthority } from "./ProductionWorkerLifecycle";
import { createLegacyReauthorizationDurableRecoverySnapshot } from
  "./ProductionAcceptanceLegacyDurableRecoverySnapshot";
import { readCompletedProductionPipelinePreparation,
  type ProductionPipelineCompletedPreparationAuthority } from
  "./ProductionPipelineExecutionFactory";
import { emitProductionPipelineExecutionEvent } from
  "./ProductionPipelineExecutionInstrumentation";

const MARKER_FILE = "production-acceptance.json";
const CONFIGURATION_NAMES = [
  "AI_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_MAX_TOKENS",
  "OPENAI_TEMPERATURE",
  "IMAGE_PROVIDER",
  "IMAGE_OPENAI_TIMEOUT_MS",
  "IMAGE_OPENAI_MAX_RESPONSE_BYTES",
  "AUDIO_PROVIDER",
  "OPENAI_TTS_MODEL",
  "OPENAI_TTS_VOICE",
  "OPENAI_TTS_TIMEOUT_MS",
  "OPENAI_TTS_MAX_RESPONSE_BYTES",
  "ANIMATION_PROVIDER",
  "ANIMATION_OPENAI_MODEL",
  "ANIMATION_OPENAI_ENDPOINT",
  "ANIMATION_OPENAI_TIMEOUT_MS",
  "ANIMATION_OPENAI_RETRY_COUNT",
  "ANIMATION_OPENAI_MAX_RESPONSE_BYTES",
  "VIDEO_PROVIDER",
  "VIDEO_ASSEMBLY_PROVIDER",
  "FFMPEG_PATH",
  "FFPROBE_PATH",
  "FFMPEG_TIMEOUT_MS",
  "FFMPEG_MAX_STDIO_BYTES",
  "SCENE_VIDEO_MAX_OUTPUT_BYTES",
  "VIDEO_ASSEMBLY_MAX_OUTPUT_BYTES",
  "THUMBNAIL_PROVIDER",
  "YOUTUBE_PROVIDER",
  "YOUTUBE_OPENAI_MODEL",
  "ATOLYE_DURABLE_PIPELINE_EXECUTION",
] as const;

interface ProductionAcceptanceMarkerV2 {
  readonly schemaVersion: "2";
  readonly runId: string;
  readonly topic: string;
  readonly topicFingerprint: string;
  readonly requestFingerprint: string;
  readonly strictProductionAcceptance: true;
  readonly publishMode: "package-only";
  readonly configurationFingerprint: string;
  readonly createdAt: string;
  readonly acceptanceStatus: "prepared" | "validated";
  readonly productionReady: boolean;
  readonly published: false;
  readonly validatedAt?: string;
}

interface ProductionAcceptanceMarkerV3 {
  readonly schemaVersion: "3";
  readonly runId: string;
  readonly topic: string;
  readonly topicFingerprint: string;
  readonly requestFingerprint: string;
  readonly strictProductionAcceptance: true;
  readonly publishMode: "package-only";
  readonly configurationFingerprint: string;
  readonly componentFingerprints: ProductionAcceptanceComponentFingerprints;
  readonly createdAt: string;
  readonly acceptanceStatus: "prepared" | "validated";
  readonly productionReady: boolean;
  readonly published: false;
  readonly validatedAt?: string;
}

interface ProductionAcceptanceMarkerV3Profile2 {
  readonly schemaVersion: "3";
  readonly componentFingerprintProfile: "2";
  readonly runId: string;
  readonly topic: string;
  readonly topicFingerprint: string;
  readonly requestFingerprint: string;
  readonly strictProductionAcceptance: true;
  readonly publishMode: "package-only";
  readonly configurationFingerprint: string;
  readonly componentFingerprints: ProductionAcceptanceComponentFingerprintsV2;
  readonly createdAt: string;
  readonly acceptanceStatus: "prepared" | "validated";
  readonly productionReady: boolean;
  readonly published: false;
  readonly validatedAt?: string;
}

type ProductionAcceptanceMarker = ProductionAcceptanceMarkerV2 |
  ProductionAcceptanceMarkerV3 |
  ProductionAcceptanceMarkerV3Profile2;

export interface ProductionAcceptanceMarkerSnapshot {
  readonly runId: string;
  readonly topic: string;
  readonly topicFingerprint: string;
  readonly requestFingerprint: string;
  readonly configurationFingerprint: string;
  readonly acceptanceStatus: "prepared" | "validated";
  readonly productionReady: boolean;
  readonly published: false;
}

export interface ProductionAcceptanceConfigurationDiagnostic {
  readonly schemaVersion: "2" | "3";
  readonly matches: boolean;
  readonly componentDiagnosticsAvailable: boolean;
  readonly mismatchedComponents: readonly string[];
}

export interface ProductionAcceptanceRepreparePreparation {
  readonly decision: "reprepare" | "replayed";
  readonly marker: Readonly<Record<string, unknown>>;
}

export class ProductionAcceptancePolicyError extends Error {
  readonly code = "PRODUCTION_ACCEPTANCE_POLICY_INVALID";

  constructor() {
    super("Production acceptance policy validation failed.");
    this.name = "ProductionAcceptancePolicyError";
    this.stack = undefined;
  }
}

export async function createProductionAcceptanceMarker(
  projectSlug: string,
  runId: string,
  configurationFingerprint: string,
  topic: string,
): Promise<void> {
  let canonicalTopic: string;
  try {
    canonicalTopic = normalizeProductionAcceptanceTopic(topic);
  } catch {
    throw new ProductionAcceptancePolicyError();
  }
  if (
    !safeSlug(projectSlug) ||
    !safeRunId(runId) ||
    createProductionAcceptanceProjectSlug(canonicalTopic, runId) !== projectSlug ||
    !/^[a-f0-9]{64}$/.test(configurationFingerprint) ||
    configurationFingerprint !== productionAcceptanceConfigurationFingerprint()
  ) {
    throw new ProductionAcceptancePolicyError();
  }
  const projectFolder = ProjectReader.getProjectFolder(projectSlug);
  try {
    await fs.mkdir(projectFolder);
  } catch {
    throw new ProductionAcceptancePolicyError();
  }
  const marker: ProductionAcceptanceMarkerV2 = {
    schemaVersion: "2",
    runId,
    topic: canonicalTopic,
    topicFingerprint: productionAcceptanceTopicFingerprint(canonicalTopic),
    requestFingerprint: productionAcceptanceRequestFingerprint({
      topic: canonicalTopic,
      runId,
      configurationFingerprint,
    }),
    strictProductionAcceptance: true,
    publishMode: "package-only",
    configurationFingerprint,
    createdAt: new Date().toISOString(),
    acceptanceStatus: "prepared",
    productionReady: false,
    published: false,
  };
  try {
    await ProjectWriter.writeJSONAtomically(projectSlug, MARKER_FILE, marker);
  } catch {
    try { await fs.rmdir(projectFolder); } catch { /* Reserved directory is retained fail-closed. */ }
    throw new ProductionAcceptancePolicyError();
  }
}

export async function createProductionAcceptanceMarkerV3(
  projectSlug: string,
  runId: string,
  configuration: ProductionAcceptancePortableConfigurationSnapshot,
  topic: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  let canonicalTopic: string;
  try {
    canonicalTopic = normalizeProductionAcceptanceTopic(topic);
  } catch {
    throw new ProductionAcceptancePolicyError();
  }
  const current = await createProductionAcceptancePortableConfigurationSnapshot(environment);
  if (
    !safeSlug(projectSlug) ||
    !safeRunId(runId) ||
    createProductionAcceptanceProjectSlug(canonicalTopic, runId) !== projectSlug ||
    configuration.unavailableComponents.length > 0 ||
    current.unavailableComponents.length > 0 ||
    configuration.configurationFingerprint !== current.configurationFingerprint ||
    !sameComponentFingerprints(
      configuration.componentFingerprints,
      current.componentFingerprints,
    )
  ) {
    throw new ProductionAcceptancePolicyError();
  }
  const projectFolder = ProjectReader.getProjectFolder(projectSlug);
  try {
    await fs.mkdir(projectFolder);
  } catch {
    throw new ProductionAcceptancePolicyError();
  }
  const marker: ProductionAcceptanceMarkerV3 = {
    schemaVersion: "3",
    runId,
    topic: canonicalTopic,
    topicFingerprint: productionAcceptanceTopicFingerprint(canonicalTopic),
    requestFingerprint: productionAcceptanceRequestFingerprintV3({
      topic: canonicalTopic,
      runId,
      configurationFingerprint: configuration.configurationFingerprint,
    }),
    strictProductionAcceptance: true,
    publishMode: "package-only",
    configurationFingerprint: configuration.configurationFingerprint,
    componentFingerprints: configuration.componentFingerprints,
    createdAt: new Date().toISOString(),
    acceptanceStatus: "prepared",
    productionReady: false,
    published: false,
  };
  try {
    await ProjectWriter.writeJSONAtomically(projectSlug, MARKER_FILE, marker);
  } catch {
    try { await fs.rmdir(projectFolder); } catch { /* Reserved directory is retained fail-closed. */ }
    throw new ProductionAcceptancePolicyError();
  }
}

export async function createProductionAcceptanceMarkerV3Profile2(
  projectSlug: string,
  runId: string,
  configuration: ProductionAcceptancePortableConfigurationSnapshotV2,
  topic: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  let canonicalTopic: string;
  try {
    canonicalTopic = normalizeProductionAcceptanceTopic(topic);
  } catch {
    throw new ProductionAcceptancePolicyError();
  }
  const current = await createProductionAcceptancePortableConfigurationSnapshotV2(
    projectSlug,
    environment,
  );
  if (
    !safeSlug(projectSlug) ||
    !safeRunId(runId) ||
    createProductionAcceptanceProjectSlug(canonicalTopic, runId) !== projectSlug ||
    configuration.unavailableComponents.length > 0 ||
    current.unavailableComponents.length > 0 ||
    configuration.configurationFingerprint !== current.configurationFingerprint ||
    findProductionAcceptanceConfigurationMismatchesV2(
      configuration.componentFingerprints,
      current.componentFingerprints,
    ).length > 0
  ) {
    throw new ProductionAcceptancePolicyError();
  }
  const projectFolder = ProjectReader.getProjectFolder(projectSlug);
  try {
    await fs.mkdir(projectFolder);
  } catch {
    throw new ProductionAcceptancePolicyError();
  }
  const marker: ProductionAcceptanceMarkerV3Profile2 =
    createProductionAcceptanceMarkerV3Profile2Value({
      schemaVersion: "2",
      runId,
      topic: canonicalTopic,
      topicFingerprint: productionAcceptanceTopicFingerprint(canonicalTopic),
      requestFingerprint: productionAcceptanceRequestFingerprint({
        topic: canonicalTopic,
        runId,
        configurationFingerprint: productionAcceptanceConfigurationFingerprint(environment),
      }),
      strictProductionAcceptance: true,
      publishMode: "package-only",
      configurationFingerprint: productionAcceptanceConfigurationFingerprint(environment),
      createdAt: new Date().toISOString(),
      acceptanceStatus: "prepared",
      productionReady: false,
      published: false,
    }, configuration);
  try {
    await ProjectWriter.writeJSONAtomically(projectSlug, MARKER_FILE, marker);
  } catch {
    try { await fs.rmdir(projectFolder); } catch { /* Reserved directory is retained fail-closed. */ }
    throw new ProductionAcceptancePolicyError();
  }
}

export async function markProductionAcceptanceValidated(
  projectSlug: string,
  configurationFingerprint: string,
): Promise<void> {
  if (!safeSlug(projectSlug)) throw new ProductionAcceptancePolicyError();
  const state = await ProjectReader.readJSONState<unknown>(projectSlug, MARKER_FILE);
  if (
    state.status !== "parsed" ||
    !validMarker(state.value) ||
    createProductionAcceptanceProjectSlug(state.value.topic, state.value.runId) !== projectSlug
  ) throw new ProductionAcceptancePolicyError();
  const resolved = await resolveEffectiveProductionAcceptanceAuthority(
    projectSlug,
    state.value,
  );
  if (
    resolved.marker.configurationFingerprint !== configurationFingerprint ||
    !await markerMatchesCurrentConfiguration(resolved.marker, projectSlug)
  ) throw new ProductionAcceptancePolicyError();
  if (resolved.marker.acceptanceStatus === "validated" && resolved.marker.productionReady) return;
  const validatedAt = new Date().toISOString();
  if (resolved.source === "legacy-reauthorization") {
    markLegacyReauthorizationValidated({
      projectFolder: ProjectReader.getProjectFolder(projectSlug),
      authority: resolved.authority,
      validatedAt,
    });
    return;
  }
  const marker: ProductionAcceptanceMarker = {
    ...resolved.marker,
    acceptanceStatus: "validated",
    productionReady: true,
    published: false,
    validatedAt,
  };
  await ProjectWriter.writeJSONAtomically(projectSlug, MARKER_FILE, marker);
}

export async function readProductionAcceptancePolicy(projectSlug: string): Promise<{
  strictProductionAcceptance: true;
  youtubePublishMode: "package-only";
} | null> {
  const admission = await readProductionAcceptanceAdmissionAuthority(projectSlug);
  return admission === null ? null : {
    strictProductionAcceptance: true,
    youtubePublishMode: "package-only",
  };
}

const productionAcceptanceStageCapabilityBrand: unique symbol =
  Symbol("production-acceptance-stage-capability-brand");

export interface ProductionAcceptanceStageExecutionIdentity {
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly runType: ProjectPackageRunType;
  readonly jobId: string;
  readonly attemptNumber: number;
  readonly attemptId: string;
  readonly recordId: string;
  readonly reservationId: string;
  readonly claimId: string;
  readonly leaseId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly executionFingerprint: string;
  readonly durableAttemptRequired?: true;
}

export interface ProductionAcceptanceStageCapability {
  readonly [productionAcceptanceStageCapabilityBrand]: true;
}

interface RegisteredLegacyStageCapability {
  readonly identity: ProductionAcceptanceStageExecutionIdentity;
  readonly runId: string;
  readonly markerCreatedAt: string;
  readonly generationBinding: string;
  readonly runtimeAuthorityGeneration: string;
  readonly runtimeAuthorityIdentity: string;
  readonly runtimeOperationBinding: string;
  readonly workerLifecycleGeneration: number;
  readonly workerLifecyclePolicyVersion: "production-worker-lifecycle-authority-v1";
  state: "issued" | "consuming" | "consumed" | "invalidated";
}

const legacyStageCapabilities = new WeakMap<object, RegisteredLegacyStageCapability>();

export async function issueProductionAcceptanceStageCapability(
  authority: ProductionPipelineCompletedPreparationAuthority,
): Promise<ProductionAcceptanceStageCapability | undefined> {
  const identity = readCompletedProductionPipelinePreparation(authority).canonicalIdentity;
  const admission = await withProductionAcceptanceLegacyAdmittedExecution(identity, () =>
    readProductionAcceptanceAdmissionAuthority(identity.projectSlug));
  if (admission === null || admission.source !== "legacy-reauthorization") return undefined;
  const runtime = getActiveProductionRuntimeOperationContext();
  if (!runtime) throw admissionFailure(
    "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_GENERATION_MISMATCH",
    identity.projectSlug,
    "concurrency",
  );
  let worker: ReturnType<typeof readProductionWorkerLifecycleAuthority>;
  try { worker = readProductionWorkerLifecycleAuthority(
    runtime, identity.projectSlug, identity.executionFingerprint); }
  catch { throw admissionFailure(
    "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_WORKER_LIFECYCLE_UNAVAILABLE",
    identity.projectSlug, "recovery"); }
  if (worker.conflict || worker.activeExecutionCount !== 0) throw admissionFailure(
    "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_WORKER_LIFECYCLE_CONFLICT",
    identity.projectSlug,
    "recovery",
  );
  const capability = Object.freeze(Object.create(null)) as ProductionAcceptanceStageCapability;
  legacyStageCapabilities.set(capability as object, {
    identity: Object.freeze({ ...identity }),
    runId: admission.marker.runId,
    markerCreatedAt: admission.marker.createdAt,
    generationBinding: admission.generationBinding,
    runtimeAuthorityGeneration: runtime.authority.authorityGeneration,
    runtimeAuthorityIdentity: runtime.authority.authorityIdentity,
    runtimeOperationBinding: runtime.bindingFingerprint,
    workerLifecycleGeneration: worker.lifecycleGeneration,
    workerLifecyclePolicyVersion: worker.policyVersion,
    state: "issued",
  });
  await emitProductionPipelineExecutionEvent("capability-issued");
  return capability;
}

export async function consumeProductionAcceptanceStageCapability(
  identity: ProductionAcceptanceStageExecutionIdentity,
  capability?: ProductionAcceptanceStageCapability,
): Promise<{ strictProductionAcceptance: true; youtubePublishMode: "package-only" } | null> {
  const registered = capability && legacyStageCapabilities.get(capability as object);
  if (!registered) {
    const admission = await withProductionAcceptanceLegacyAdmittedExecution(identity, () =>
      readProductionAcceptanceAdmissionAuthority(identity.projectSlug));
    if (admission === null) return null;
    if (admission.source !== "legacy-reauthorization") {
      return { strictProductionAcceptance: true, youtubePublishMode: "package-only" };
    }
    throw admissionFailure(
    "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_MISSING",
    identity.projectSlug,
    "concurrency",
    );
  }
  if (registered.state !== "issued") throw admissionFailure(
    registered.state === "consuming"
      ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_CONCURRENT_CONSUMPTION"
      : registered.state === "invalidated"
        ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_INVALIDATED"
        : "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_REPLAYED",
    identity.projectSlug, "concurrency");
  registered.state = "consuming";
  await emitProductionPipelineExecutionEvent("revalidation-entered");
  let runtime: ReturnType<typeof getActiveProductionRuntimeOperationContext>;
  let worker: ReturnType<typeof readProductionWorkerLifecycleAuthority>;
  try {
    runtime = getActiveProductionRuntimeOperationContext();
    if (!runtime) throw new Error("runtime-unavailable");
    worker = readProductionWorkerLifecycleAuthority(
      runtime, identity.projectSlug, identity.executionFingerprint);
  } catch {
    registered.state = "invalidated";
    throw admissionFailure(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_WORKER_LIFECYCLE_UNAVAILABLE",
      identity.projectSlug, "recovery");
  }
  const identityMismatch = stageExecutionIdentityMismatch(registered.identity, identity);
  if (identityMismatch) {
    registered.state = "invalidated";
    throw admissionFailure(
      identityMismatch,
      identity.projectSlug,
      "concurrency",
    );
  }
  if (!runtime ||
    registered.runtimeAuthorityGeneration !== runtime.authority.authorityGeneration ||
    registered.runtimeAuthorityIdentity !== runtime.authority.authorityIdentity ||
    registered.runtimeOperationBinding !== runtime.bindingFingerprint || !worker ||
    worker.conflict || worker.activeExecutionCount !== 0 ||
    registered.workerLifecycleGeneration !== worker.lifecycleGeneration ||
    registered.workerLifecyclePolicyVersion !== worker.policyVersion) {
    registered.state = "invalidated";
    throw admissionFailure(
      worker?.conflict
        ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_WORKER_LIFECYCLE_CONFLICT"
        : !worker
          ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_WORKER_LIFECYCLE_UNAVAILABLE"
          : "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_STALE",
      identity.projectSlug,
      "concurrency",
    );
  }
  try {
    await withProductionAcceptanceLegacyAdmittedExecution(identity, () =>
      createLegacyReauthorizationDurableRecoverySnapshot({
        projectFolder: ProjectReader.getProjectFolder(identity.projectSlug),
        projectSlug: identity.projectSlug, runId: registered.runId,
        evaluatedAt: registered.markerCreatedAt, markerState: "prepared", startStage: "audio",
      }));
  } catch (error) {
    registered.state = "invalidated";
    if (error instanceof ProductionAcceptanceLegacyReauthorizationError &&
      isDurableCausalAdmissionFailure(error.code)) throw error;
    throw admissionFailure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_STALE",
      identity.projectSlug, "concurrency");
  }
  let admission: EffectiveProductionAcceptanceAuthority | null;
  try {
    admission = await withProductionAcceptanceLegacyAdmittedExecution(identity, () =>
      readProductionAcceptanceAdmissionAuthority(identity.projectSlug));
  } catch (error) {
    registered.state = "invalidated";
    if (error instanceof ProductionAcceptanceLegacyReauthorizationError &&
      isDurableCausalAdmissionFailure(error.code)) throw error;
    throw admissionFailure(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_STALE",
      identity.projectSlug,
      "concurrency",
    );
  }
  if (admission === null || admission.source !== "legacy-reauthorization" ||
    registered.runId !== admission.marker.runId ||
    registered.generationBinding !== admission.generationBinding) {
    registered.state = "invalidated";
    throw admissionFailure(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_STALE",
      identity.projectSlug,
      "concurrency",
    );
  }
  registered.state = "consumed";
  return { strictProductionAcceptance: true, youtubePublishMode: "package-only" };
}

function isDurableCausalAdmissionFailure(
  code: ConstructorParameters<typeof ProductionAcceptanceLegacyReauthorizationError>[0],
): boolean {
  return code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_RESERVATION_STORE_MISSING" ||
    code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ACTIVE_RESERVATION_CONFLICT" ||
    code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_IDEMPOTENCY_STORE_MISSING" ||
    code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_CLAIM_STORE_MISSING" ||
    code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_ATTEMPT_STORE_MISSING" ||
    code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_CLAIM_BINDING_MISMATCH" ||
    code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_ATTEMPT_BINDING_MISMATCH" ||
    code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_IDEMPOTENCY_BINDING_MISMATCH" ||
    code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CLAIM_ATTEMPT_BINDING_MISMATCH" ||
    code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_LEASE_ID_MISMATCH" ||
    code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_UNAVAILABLE" ||
    code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_CORRUPT" ||
    code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_IDENTITY_CHANGED" ||
    code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_RECORD_IDENTITY_CHANGED" ||
    code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_RECORD_CORRUPT";
}

async function readProductionAcceptanceAdmissionAuthority(projectSlug: string): Promise<
  EffectiveProductionAcceptanceAuthority | null
> {
  if (!safeSlug(projectSlug)) throw new ProductionAcceptancePolicyError();
  const state = await ProjectReader.readJSONState<unknown>(projectSlug, MARKER_FILE);
  if (state.status === "missing") return null;
  if (state.status !== "parsed" || !validMarker(state.value)) {
    throw new ProductionAcceptancePolicyError();
  }
  if (createProductionAcceptanceProjectSlug(state.value.topic, state.value.runId) !== projectSlug) {
    throw new ProductionAcceptancePolicyError();
  }
  const resolved = await resolveEffectiveProductionAcceptanceAuthority(projectSlug, state.value);
  if (!await markerMatchesCurrentConfiguration(resolved.marker, projectSlug)) {
    throw new ProductionAcceptancePolicyError();
  }
  if (resolved.source === "legacy-reauthorization") {
    const consumed = await resolveEffectiveProductionAcceptanceAuthority(projectSlug, state.value);
    if (consumed.source !== "legacy-reauthorization" ||
      consumed.generationBinding !== resolved.generationBinding) {
      throw admissionFailure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_GENERATION_MISMATCH",
        projectSlug, "concurrency");
    }
  }
  return resolved;
}

function stageExecutionIdentityMismatch(
  left: ProductionAcceptanceStageExecutionIdentity,
  right: ProductionAcceptanceStageExecutionIdentity,
): ConstructorParameters<typeof ProductionAcceptanceLegacyReauthorizationError>[0] | undefined {
  if (left.requestId !== right.requestId) {
    return "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_REQUEST_ID_MISMATCH";
  }
  if (left.idempotencyKey !== right.idempotencyKey) {
    return "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_IDEMPOTENCY_KEY_MISMATCH";
  }
  if (left.operation !== right.operation) {
    return "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_OPERATION_MISMATCH";
  }
  if (left.leaseId !== right.leaseId) {
    return "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_LEASE_ID_MISMATCH";
  }
  return left.projectSlug !== right.projectSlug || left.stage !== right.stage ||
    left.runType !== right.runType || left.jobId !== right.jobId ||
    left.attemptNumber !== right.attemptNumber || left.attemptId !== right.attemptId ||
    left.recordId !== right.recordId || left.reservationId !== right.reservationId ||
    left.claimId !== right.claimId ||
    left.executionFingerprint !== right.executionFingerprint ||
    left.durableAttemptRequired !== right.durableAttemptRequired
    ? "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_IDENTITY_MISMATCH"
    : undefined;
}

export async function readProductionAcceptanceMarker(
  projectSlug: string,
): Promise<ProductionAcceptanceMarkerSnapshot> {
  if (!safeSlug(projectSlug)) throw new ProductionAcceptancePolicyError();
  const state = await ProjectReader.readJSONState<unknown>(projectSlug, MARKER_FILE);
  if (
    state.status !== "parsed" ||
    !validMarker(state.value) ||
    createProductionAcceptanceProjectSlug(state.value.topic, state.value.runId) !== projectSlug
  ) throw new ProductionAcceptancePolicyError();
  const resolved = await resolveEffectiveProductionAcceptanceAuthority(projectSlug, state.value);
  if (!await markerMatchesCurrentConfiguration(resolved.marker, projectSlug)) {
    throw new ProductionAcceptancePolicyError();
  }
  return Object.freeze({
    runId: resolved.marker.runId,
    topic: resolved.marker.topic,
    topicFingerprint: resolved.marker.topicFingerprint,
    requestFingerprint: resolved.marker.requestFingerprint,
    configurationFingerprint: resolved.marker.configurationFingerprint,
    acceptanceStatus: resolved.marker.acceptanceStatus,
    productionReady: resolved.marker.productionReady,
    published: false,
  });
}

export async function diagnoseProductionAcceptanceConfiguration(
  projectSlug: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ProductionAcceptanceConfigurationDiagnostic> {
  if (!safeSlug(projectSlug)) throw new ProductionAcceptancePolicyError();
  const state = await ProjectReader.readJSONState<unknown>(projectSlug, MARKER_FILE);
  if (
    state.status !== "parsed" ||
    !validMarker(state.value) ||
    createProductionAcceptanceProjectSlug(state.value.topic, state.value.runId) !== projectSlug
  ) throw new ProductionAcceptancePolicyError();
  const resolved = await resolveEffectiveProductionAcceptanceAuthority(
    projectSlug,
    state.value,
    environment,
  );
  if (resolved.marker.schemaVersion === "2") {
    const matches = resolved.marker.configurationFingerprint ===
      productionAcceptanceConfigurationFingerprint(environment);
    return Object.freeze({
      schemaVersion: "2",
      matches,
      componentDiagnosticsAvailable: false,
      mismatchedComponents: Object.freeze([]),
    });
  }
  if (isMarkerV3Profile2(resolved.marker)) {
    const current = await createProductionAcceptancePortableConfigurationSnapshotV2(
      projectSlug,
      environment,
    );
    const mismatchedComponents = findProductionAcceptanceConfigurationMismatchesV2(
      resolved.marker.componentFingerprints,
      current.componentFingerprints,
    );
    const matches = mismatchedComponents.length === 0 &&
      resolved.marker.configurationFingerprint === current.configurationFingerprint;
    return Object.freeze({
      schemaVersion: "3",
      matches,
      componentDiagnosticsAvailable: true,
      mismatchedComponents,
    });
  }
  const current = await createProductionAcceptancePortableConfigurationSnapshot(environment);
  const mismatchedComponents = findProductionAcceptanceConfigurationMismatches(
    resolved.marker.componentFingerprints,
    current.componentFingerprints,
  );
  const matches = mismatchedComponents.length === 0 &&
    resolved.marker.configurationFingerprint === current.configurationFingerprint;
  return Object.freeze({
    schemaVersion: "3",
    matches,
    componentDiagnosticsAvailable: true,
    mismatchedComponents,
  });
}

export type EffectiveProductionAcceptanceAuthority =
  | { readonly source: "native"; readonly marker: ProductionAcceptanceMarker }
  | {
      readonly source: "legacy-reauthorization";
      readonly marker: ProductionAcceptanceMarkerV3Profile2;
      readonly authority: ProductionAcceptanceLegacyReauthorizationV1;
      readonly generationBinding: string;
    }
  | { readonly source: "legacy"; readonly marker: ProductionAcceptanceMarkerV2 };

export async function resolveEffectiveProductionAcceptanceAuthority(
  projectSlug: string,
  canonicalMarker?: ProductionAcceptanceMarker,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<EffectiveProductionAcceptanceAuthority> {
  if (!safeSlug(projectSlug)) throw new ProductionAcceptancePolicyError();
  let marker = canonicalMarker;
  if (!marker) {
    const state = await ProjectReader.readJSONState<unknown>(projectSlug, MARKER_FILE);
    if (state.status !== "parsed" || !validMarker(state.value)) {
      throw new ProductionAcceptancePolicyError();
    }
    marker = state.value;
  }
  if (createProductionAcceptanceProjectSlug(marker.topic, marker.runId) !== projectSlug) {
    throw new ProductionAcceptancePolicyError();
  }
  if (marker.schemaVersion === "3") {
    return Object.freeze({ source: "native" as const, marker });
  }
  const activeRuntime = getActiveProductionRuntimeOperationContext();
  const projectFolder = ProjectReader.getProjectFolder(projectSlug, activeRuntime
    ? requireProductionRuntimeStorageContext(activeRuntime) : { environment });
  let markerSnapshot: ReturnType<typeof readCanonicalProductionAcceptanceMarkerDescriptorBound>;
  try {
    markerSnapshot = readCanonicalProductionAcceptanceMarkerDescriptorBound({ projectFolder });
  } catch {
    throw admissionFailure(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_CONCURRENT_CHANGE",
      projectSlug,
      "concurrency",
    );
  }
  if (!validMarkerV2(markerSnapshot.parsedMarker)) {
    throw admissionFailure(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_SOURCE_IDENTITY_MISMATCH",
      projectSlug,
      "marker",
    );
  }
  marker = markerSnapshot.parsedMarker;
  if (
    canonicalMarker && canonicalJson(canonicalMarker) !== canonicalJson(marker) ||
    createProductionAcceptanceProjectSlug(marker.topic, marker.runId) !== projectSlug
  ) {
    throw admissionFailure(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_SOURCE_IDENTITY_MISMATCH",
      projectSlug,
      "marker",
    );
  }
  const legacy = readLegacyReauthorizationAuthority({
    projectFolder,
    projectSlug,
    markerBytes: markerSnapshot.bytes,
    markerValue: marker as unknown as Record<string, unknown>,
    markerDeviceIdentity: markerSnapshot.deviceIdentity,
    markerInodeIdentity: markerSnapshot.inodeIdentity,
  });
  if (legacy.status === "absent") {
    return Object.freeze({ source: "legacy" as const, marker });
  }
  if (!validMarkerV3Profile2(legacy.effectiveMarker)) {
    throw new ProductionAcceptancePolicyError();
  }
  const current = await createLegacyReauthorizationPreflight(
    projectSlug,
    markerSnapshot.sha256,
    { environment },
  );
  const authority = legacy.authority;
  if (
    authority.sourceMarker.deviceIdentity !== current.markerDeviceIdentity ||
    authority.sourceMarker.inodeIdentity !== current.markerInodeIdentity ||
    authority.sourceMarker.byteLength !== current.markerBytes.length ||
    authority.sourceMarker.sha256 !== current.sourceMarkerSha256
  ) throw admissionFailure(
    "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_SOURCE_IDENTITY_MISMATCH",
    projectSlug,
    "marker",
  );
  if (
    authority.configurationFingerprint !== current.configuration.configurationFingerprint ||
    canonicalJson(authority.componentFingerprints) !==
      canonicalJson(current.configuration.componentFingerprints)
  ) throw admissionFailure(
    "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_CONFIGURATION_DRIFT",
    projectSlug,
    "configuration",
  );
  if (authority.storageAuthorityFingerprint !== current.storageAuthorityFingerprint) {
    throw admissionFailure(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_STORAGE_DRIFT",
      projectSlug,
      "storage",
    );
  }
  if (authority.artifactInventoryFingerprint !== current.artifactInventoryFingerprint) {
    throw admissionFailure(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_ARTIFACT_DRIFT",
      projectSlug,
      "artifacts",
    );
  }
  if (authority.recoveryStateFingerprint !== current.recoveryStateFingerprint) {
    throw admissionFailure(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_RECOVERY_DRIFT",
      projectSlug,
      "recovery",
    );
  }
  const expectedId = deriveLegacyReauthorizationId({
    protocolVersion: legacyReauthorizationSchemaVersion, projectSlug,
    sourceMarkerSha256: current.sourceMarkerSha256, sourceMarkerByteLength: current.markerBytes.length,
    sourceMarkerDeviceIdentity: current.markerDeviceIdentity, sourceMarkerInodeIdentity: current.markerInodeIdentity,
    sourceLegacyConfigurationFingerprint: current.marker.configurationFingerprint, runId: current.marker.runId,
    topicFingerprint: current.marker.topicFingerprint,
    currentProfile2ConfigurationFingerprint: current.configuration.configurationFingerprint,
    storageAuthorityFingerprint: current.storageAuthorityFingerprint,
    artifactInventoryFingerprint: current.artifactInventoryFingerprint,
    recoveryStateFingerprint: current.recoveryStateFingerprint, reason: legacyReauthorizationReason,
    strictProductionAcceptance: true, publishMode: "package-only",
    archiveLocator: authority.sourceMarker.archiveLocator, archiveSha256: legacy.archiveSnapshot.sha256,
    archiveByteLength: legacy.archiveSnapshot.byteLength,
    archiveDeviceIdentity: legacy.archiveSnapshot.deviceIdentity,
    archiveInodeIdentity: legacy.archiveSnapshot.inodeIdentity,
    archiveIdentityPolicyVersion: legacy.archiveSnapshot.identityPolicyVersion,
    publicationReceiptPolicyVersion: legacyReauthorizationReceiptPolicyVersion,
    publicationGenerationId: authority.publicationGenerationId,
  });
  if (authority.reauthorizationId !== expectedId) {
    throw admissionFailure(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_ID_MISMATCH",
      projectSlug,
      "concurrency",
    );
  }
  const finalMarker = readCanonicalProductionAcceptanceMarkerDescriptorBound({ projectFolder });
  const final = await createLegacyReauthorizationPreflight(projectSlug, markerSnapshot.sha256, { environment });
  const finalLegacy = readLegacyReauthorizationAuthority({ projectFolder, projectSlug,
    markerBytes: finalMarker.bytes, markerValue: finalMarker.parsedMarker,
    markerDeviceIdentity: finalMarker.deviceIdentity, markerInodeIdentity: finalMarker.inodeIdentity });
  if (finalLegacy.status !== "valid" || !sameDescriptor(markerSnapshot, finalMarker) ||
    !sameDescriptor(legacy.authoritySnapshot, finalLegacy.authoritySnapshot) ||
    !sameDescriptor(legacy.archiveSnapshot, finalLegacy.archiveSnapshot) ||
    !sameDescriptor(legacy.receiptSnapshot, finalLegacy.receiptSnapshot) ||
    current.storageAuthorityFingerprint !== final.storageAuthorityFingerprint ||
    current.artifactInventoryFingerprint !== final.artifactInventoryFingerprint ||
    current.recoveryStateFingerprint !== final.recoveryStateFingerprint ||
    current.configuration.configurationFingerprint !== final.configuration.configurationFingerprint ||
    canonicalJson(current.configuration.componentFingerprints) !== canonicalJson(final.configuration.componentFingerprints) ||
    canonicalJson(current.recoverySnapshot) !== canonicalJson(final.recoverySnapshot)) {
    throw admissionFailure("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_CONCURRENT_CHANGE",
      projectSlug, "concurrency");
  }
  const generationBinding = sha256Bytes(canonicalJson({
    policyVersion: "legacy-reauthorization-admission-generation-v1", reauthorizationId: expectedId,
    marker: descriptorBinding(finalMarker), sidecar: descriptorBinding(finalLegacy.authoritySnapshot),
    archive: descriptorBinding(finalLegacy.archiveSnapshot), receipt: descriptorBinding(finalLegacy.receiptSnapshot),
    storageAuthorityFingerprint: final.storageAuthorityFingerprint,
    artifactInventoryFingerprint: final.artifactInventoryFingerprint,
    recoveryStateFingerprint: final.recoveryStateFingerprint,
    configurationFingerprint: final.configuration.configurationFingerprint,
  }));
  return Object.freeze({
    source: "legacy-reauthorization" as const,
    marker: legacy.effectiveMarker,
    authority: legacy.authority,
    generationBinding,
  });
}

function descriptorBinding(value: { sha256: string; byteLength: number; deviceIdentity: string; inodeIdentity: string }) {
  return { sha256: value.sha256, byteLength: value.byteLength,
    deviceIdentity: value.deviceIdentity, inodeIdentity: value.inodeIdentity };
}

function sameDescriptor(left: { sha256: string; byteLength: number; deviceIdentity: string; inodeIdentity: string },
  right: { sha256: string; byteLength: number; deviceIdentity: string; inodeIdentity: string }) {
  return canonicalJson(descriptorBinding(left)) === canonicalJson(descriptorBinding(right));
}

function admissionFailure(
  code: ConstructorParameters<typeof ProductionAcceptanceLegacyReauthorizationError>[0],
  projectSlug: string,
  category: ConstructorParameters<typeof ProductionAcceptanceLegacyReauthorizationError>[2],
) {
  return new ProductionAcceptanceLegacyReauthorizationError(code, projectSlug, category);
}

export async function prepareProductionAcceptanceMarkerReprepare(
  projectSlug: string,
  value: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ProductionAcceptanceRepreparePreparation> {
  if (
    !safeSlug(projectSlug) ||
    !validMarker(value) ||
    createProductionAcceptanceProjectSlug(value.topic, value.runId) !== projectSlug
  ) throw new ProductionAcceptancePolicyError();
  if (value.schemaVersion === "2") {
    if (
      value.configurationFingerprint !==
        productionAcceptanceConfigurationFingerprint(environment)
    ) throw new ProductionAcceptancePolicyError();
    const configuration =
      await createProductionAcceptancePortableConfigurationSnapshotV2(projectSlug, environment);
    if (configuration.unavailableComponents.length > 0) {
      throw new ProductionAcceptancePolicyError();
    }
    return Object.freeze({
      decision: "reprepare",
      marker: Object.freeze(
        createProductionAcceptanceMarkerV3Profile2Value(value, configuration),
      ) as unknown as Readonly<Record<string, unknown>>,
    });
  }
  if (!isMarkerV3Profile2(value)) {
    throw new ProductionAcceptancePolicyError();
  }
  const current =
    await createProductionAcceptancePortableConfigurationSnapshotV2(projectSlug, environment);
  if (
    current.unavailableComponents.length > 0 ||
    value.configurationFingerprint !== current.configurationFingerprint ||
    findProductionAcceptanceConfigurationMismatchesV2(
      value.componentFingerprints,
      current.componentFingerprints,
    ).length > 0
  ) throw new ProductionAcceptancePolicyError();
  return Object.freeze({
    decision: "replayed",
    marker: value as unknown as Readonly<Record<string, unknown>>,
  });
}

export async function validateProductionAcceptanceReprepareReadback(
  projectSlug: string,
  value: unknown,
  expectedMarker: Readonly<Record<string, unknown>>,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (
    !safeSlug(projectSlug) ||
    !validMarkerV3Profile2(value) ||
    createProductionAcceptanceProjectSlug(value.topic, value.runId) !== projectSlug ||
    JSON.stringify(value) !== JSON.stringify(expectedMarker)
  ) throw new ProductionAcceptancePolicyError();
  const current =
    await createProductionAcceptancePortableConfigurationSnapshotV2(projectSlug, environment);
  if (
    current.unavailableComponents.length > 0 ||
    value.configurationFingerprint !== current.configurationFingerprint ||
    findProductionAcceptanceConfigurationMismatchesV2(
      value.componentFingerprints,
      current.componentFingerprints,
    ).length > 0
  ) throw new ProductionAcceptancePolicyError();
}

export function productionAcceptanceConfigurationFingerprint(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const snapshot: Array<readonly [string, string | null]> = CONFIGURATION_NAMES.map((name) => [
    name,
    name === "OPENAI_API_KEY"
      ? secretFingerprint(environment[name])
      : environment[name] ?? null,
  ]);
  if (environment.OPENAI_RESEARCH_MAX_TOKENS !== undefined) {
    snapshot.push(["OPENAI_RESEARCH_MAX_TOKENS", environment.OPENAI_RESEARCH_MAX_TOKENS]);
  }
  if (environment.OPENAI_SCRIPT_MAX_TOKENS !== undefined) {
    snapshot.push(["OPENAI_SCRIPT_MAX_TOKENS", environment.OPENAI_SCRIPT_MAX_TOKENS]);
  }
  if (environment.OPENAI_VISUALS_MAX_TOKENS !== undefined) {
    snapshot.push(["OPENAI_VISUALS_MAX_TOKENS", environment.OPENAI_VISUALS_MAX_TOKENS]);
  }
  if (environment.OPENAI_AUDIO_MAX_TOKENS !== undefined) {
    snapshot.push(["OPENAI_AUDIO_MAX_TOKENS", environment.OPENAI_AUDIO_MAX_TOKENS]);
  }
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function productionAcceptanceRequestFingerprint({
  topic,
  runId,
  configurationFingerprint,
}: {
  topic: string;
  runId: string;
  configurationFingerprint: string;
}): string {
  const canonicalTopic = normalizeProductionAcceptanceTopic(topic);
  if (!safeRunId(runId) || !/^[a-f0-9]{64}$/.test(configurationFingerprint)) {
    throw new ProductionAcceptancePolicyError();
  }
  return createHash("sha256").update(JSON.stringify({
    topic: canonicalTopic,
    runId,
    configurationFingerprint,
    strictProductionAcceptance: true,
    publishMode: "package-only",
  })).digest("hex");
}

function secretFingerprint(value: string | undefined) {
  const normalized = value?.trim();
  return normalized
    ? createHash("sha256").update(normalized).digest("hex")
    : null;
}

function validMarker(value: unknown): value is ProductionAcceptanceMarker {
  if (!value || typeof value !== "object") return false;
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  return schemaVersion === "2"
    ? validMarkerV2(value)
    : schemaVersion === "3" &&
      ((value as { componentFingerprintProfile?: unknown }).componentFingerprintProfile === "2"
        ? validMarkerV3Profile2(value)
        : validMarkerV3(value));
}

function validMarkerV2(value: unknown): value is ProductionAcceptanceMarkerV2 {
  if (!value || typeof value !== "object") return false;
  const marker = value as Partial<ProductionAcceptanceMarkerV2>;
  if (
    marker.schemaVersion !== "2" ||
    !safeRunId(marker.runId) ||
    typeof marker.topic !== "string" ||
    typeof marker.topicFingerprint !== "string" ||
    typeof marker.requestFingerprint !== "string" ||
    typeof marker.configurationFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(marker.configurationFingerprint)
  ) return false;
  let canonicalTopic: string;
  let requestFingerprint: string;
  try {
    canonicalTopic = normalizeProductionAcceptanceTopic(marker.topic);
    requestFingerprint = productionAcceptanceRequestFingerprint({
      topic: canonicalTopic,
      runId: marker.runId,
      configurationFingerprint: marker.configurationFingerprint,
    });
  } catch {
    return false;
  }
  return marker.topic === canonicalTopic &&
    marker.topicFingerprint === productionAcceptanceTopicFingerprint(canonicalTopic) &&
    marker.requestFingerprint === requestFingerprint &&
    marker.strictProductionAcceptance === true &&
    marker.publishMode === "package-only" &&
    typeof marker.createdAt === "string" && validTimestamp(marker.createdAt) &&
    marker.published === false &&
    ((marker.acceptanceStatus === "prepared" && marker.productionReady === false && marker.validatedAt === undefined) ||
      (marker.acceptanceStatus === "validated" && marker.productionReady === true &&
        typeof marker.validatedAt === "string" && validTimestamp(marker.validatedAt)));
}

function validMarkerV3(value: unknown): value is ProductionAcceptanceMarkerV3 {
  if (!value || typeof value !== "object") return false;
  const marker = value as Partial<ProductionAcceptanceMarkerV3>;
  if (
    marker.schemaVersion !== "3" ||
    "componentFingerprintProfile" in marker ||
    !safeRunId(marker.runId) ||
    typeof marker.topic !== "string" ||
    typeof marker.topicFingerprint !== "string" ||
    typeof marker.requestFingerprint !== "string" ||
    typeof marker.configurationFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(marker.configurationFingerprint) ||
    !validProductionAcceptanceComponentFingerprints(marker.componentFingerprints) ||
    productionAcceptancePortableConfigurationFingerprint(marker.componentFingerprints) !==
      marker.configurationFingerprint
  ) return false;
  let canonicalTopic: string;
  let requestFingerprint: string;
  try {
    canonicalTopic = normalizeProductionAcceptanceTopic(marker.topic);
    requestFingerprint = productionAcceptanceRequestFingerprintV3({
      topic: canonicalTopic,
      runId: marker.runId,
      configurationFingerprint: marker.configurationFingerprint,
    });
  } catch {
    return false;
  }
  return marker.topic === canonicalTopic &&
    marker.topicFingerprint === productionAcceptanceTopicFingerprint(canonicalTopic) &&
    marker.requestFingerprint === requestFingerprint &&
    marker.strictProductionAcceptance === true &&
    marker.publishMode === "package-only" &&
    typeof marker.createdAt === "string" && validTimestamp(marker.createdAt) &&
    marker.published === false &&
    ((marker.acceptanceStatus === "prepared" && marker.productionReady === false && marker.validatedAt === undefined) ||
      (marker.acceptanceStatus === "validated" && marker.productionReady === true &&
        typeof marker.validatedAt === "string" && validTimestamp(marker.validatedAt)));
}

function validMarkerV3Profile2(value: unknown): value is ProductionAcceptanceMarkerV3Profile2 {
  if (!value || typeof value !== "object") return false;
  const marker = value as Partial<ProductionAcceptanceMarkerV3Profile2>;
  if (
    marker.schemaVersion !== "3" ||
    marker.componentFingerprintProfile !== "2" ||
    !safeRunId(marker.runId) ||
    typeof marker.topic !== "string" ||
    typeof marker.topicFingerprint !== "string" ||
    typeof marker.requestFingerprint !== "string" ||
    typeof marker.configurationFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(marker.configurationFingerprint) ||
    !validProductionAcceptanceComponentFingerprintsV2(marker.componentFingerprints) ||
    productionAcceptancePortableConfigurationFingerprintV2(marker.componentFingerprints) !==
      marker.configurationFingerprint
  ) return false;
  let canonicalTopic: string;
  let requestFingerprint: string;
  try {
    canonicalTopic = normalizeProductionAcceptanceTopic(marker.topic);
    requestFingerprint = productionAcceptanceRequestFingerprintV3Profile2({
      topic: canonicalTopic,
      runId: marker.runId,
      configurationFingerprint: marker.configurationFingerprint,
    });
  } catch {
    return false;
  }
  return marker.topic === canonicalTopic &&
    marker.topicFingerprint === productionAcceptanceTopicFingerprint(canonicalTopic) &&
    marker.requestFingerprint === requestFingerprint &&
    marker.strictProductionAcceptance === true &&
    marker.publishMode === "package-only" &&
    typeof marker.createdAt === "string" && validTimestamp(marker.createdAt) &&
    marker.published === false &&
    ((marker.acceptanceStatus === "prepared" && marker.productionReady === false && marker.validatedAt === undefined) ||
      (marker.acceptanceStatus === "validated" && marker.productionReady === true &&
        typeof marker.validatedAt === "string" && validTimestamp(marker.validatedAt)));
}

function productionAcceptanceRequestFingerprintV3({
  topic,
  runId,
  configurationFingerprint,
}: {
  topic: string;
  runId: string;
  configurationFingerprint: string;
}): string {
  const canonicalTopic = normalizeProductionAcceptanceTopic(topic);
  if (!safeRunId(runId) || !/^[a-f0-9]{64}$/.test(configurationFingerprint)) {
    throw new ProductionAcceptancePolicyError();
  }
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: "3",
    topic: canonicalTopic,
    runId,
    configurationFingerprint,
    strictProductionAcceptance: true,
    publishMode: "package-only",
  })).digest("hex");
}

export function productionAcceptanceRequestFingerprintV3Profile2({
  topic,
  runId,
  configurationFingerprint,
}: {
  topic: string;
  runId: string;
  configurationFingerprint: string;
}): string {
  const canonicalTopic = normalizeProductionAcceptanceTopic(topic);
  if (!safeRunId(runId) || !/^[a-f0-9]{64}$/.test(configurationFingerprint)) {
    throw new ProductionAcceptancePolicyError();
  }
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: "3",
    componentFingerprintProfile: "2",
    topic: canonicalTopic,
    runId,
    configurationFingerprint,
    strictProductionAcceptance: true,
    publishMode: "package-only",
  })).digest("hex");
}

function createProductionAcceptanceMarkerV3Profile2Value(
  source: ProductionAcceptanceMarkerV2,
  configuration: ProductionAcceptancePortableConfigurationSnapshotV2,
): ProductionAcceptanceMarkerV3Profile2 {
  return {
    schemaVersion: "3",
    componentFingerprintProfile: "2",
    runId: source.runId,
    topic: source.topic,
    topicFingerprint: source.topicFingerprint,
    requestFingerprint: productionAcceptanceRequestFingerprintV3Profile2({
      topic: source.topic,
      runId: source.runId,
      configurationFingerprint: configuration.configurationFingerprint,
    }),
    strictProductionAcceptance: true,
    publishMode: "package-only",
    configurationFingerprint: configuration.configurationFingerprint,
    componentFingerprints: configuration.componentFingerprints,
    createdAt: source.createdAt,
    acceptanceStatus: source.acceptanceStatus,
    productionReady: source.productionReady,
    published: false,
    ...(source.validatedAt ? { validatedAt: source.validatedAt } : {}),
  };
}

async function markerMatchesCurrentConfiguration(
  marker: ProductionAcceptanceMarker,
  projectSlug: string,
) {
  if (marker.schemaVersion === "2") {
    return marker.configurationFingerprint === productionAcceptanceConfigurationFingerprint();
  }
  if (isMarkerV3Profile2(marker)) {
    const current = await createProductionAcceptancePortableConfigurationSnapshotV2(projectSlug);
    return current.unavailableComponents.length === 0 &&
      marker.configurationFingerprint === current.configurationFingerprint &&
      findProductionAcceptanceConfigurationMismatchesV2(
        marker.componentFingerprints,
        current.componentFingerprints,
      ).length === 0;
  }
  const current = await createProductionAcceptancePortableConfigurationSnapshot();
  return current.unavailableComponents.length === 0 &&
    marker.configurationFingerprint === current.configurationFingerprint &&
    sameComponentFingerprints(marker.componentFingerprints, current.componentFingerprints);
}

function sameComponentFingerprints(
  left: ProductionAcceptanceComponentFingerprints,
  right: ProductionAcceptanceComponentFingerprints,
) {
  return findProductionAcceptanceConfigurationMismatches(left, right).length === 0;
}

function isMarkerV3Profile2(
  marker: ProductionAcceptanceMarker,
): marker is ProductionAcceptanceMarkerV3Profile2 {
  return marker.schemaVersion === "3" &&
    "componentFingerprintProfile" in marker &&
    marker.componentFingerprintProfile === "2";
}

function safeSlug(value: string) {
  return /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(value);
}

function safeRunId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
}

function validTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
