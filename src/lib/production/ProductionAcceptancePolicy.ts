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
    createProductionAcceptanceProjectSlug(state.value.topic, state.value.runId) !== projectSlug ||
    state.value.configurationFingerprint !== configurationFingerprint ||
    !await markerMatchesCurrentConfiguration(state.value, projectSlug)
  ) throw new ProductionAcceptancePolicyError();
  if (state.value.acceptanceStatus === "validated" && state.value.productionReady) return;
  const validatedAt = new Date().toISOString();
  const marker: ProductionAcceptanceMarker = {
    ...state.value,
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
  if (!safeSlug(projectSlug)) throw new ProductionAcceptancePolicyError();
  const state = await ProjectReader.readJSONState<unknown>(projectSlug, MARKER_FILE);
  if (state.status === "missing") return null;
  if (state.status !== "parsed" || !validMarker(state.value)) {
    throw new ProductionAcceptancePolicyError();
  }
  if (createProductionAcceptanceProjectSlug(state.value.topic, state.value.runId) !== projectSlug) {
    throw new ProductionAcceptancePolicyError();
  }
  if (!await markerMatchesCurrentConfiguration(state.value, projectSlug)) {
    throw new ProductionAcceptancePolicyError();
  }
  return {
    strictProductionAcceptance: true,
    youtubePublishMode: "package-only",
  };
}

export async function readProductionAcceptanceMarker(
  projectSlug: string,
): Promise<ProductionAcceptanceMarkerSnapshot> {
  if (!safeSlug(projectSlug)) throw new ProductionAcceptancePolicyError();
  const state = await ProjectReader.readJSONState<unknown>(projectSlug, MARKER_FILE);
  if (
    state.status !== "parsed" ||
    !validMarker(state.value) ||
    createProductionAcceptanceProjectSlug(state.value.topic, state.value.runId) !== projectSlug ||
    !await markerMatchesCurrentConfiguration(state.value, projectSlug)
  ) throw new ProductionAcceptancePolicyError();
  return Object.freeze({
    runId: state.value.runId,
    topic: state.value.topic,
    topicFingerprint: state.value.topicFingerprint,
    requestFingerprint: state.value.requestFingerprint,
    configurationFingerprint: state.value.configurationFingerprint,
    acceptanceStatus: state.value.acceptanceStatus,
    productionReady: state.value.productionReady,
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
  if (state.value.schemaVersion === "2") {
    const matches = state.value.configurationFingerprint ===
      productionAcceptanceConfigurationFingerprint(environment);
    return Object.freeze({
      schemaVersion: "2",
      matches,
      componentDiagnosticsAvailable: false,
      mismatchedComponents: Object.freeze([]),
    });
  }
  if (isMarkerV3Profile2(state.value)) {
    const current = await createProductionAcceptancePortableConfigurationSnapshotV2(
      projectSlug,
      environment,
    );
    const mismatchedComponents = findProductionAcceptanceConfigurationMismatchesV2(
      state.value.componentFingerprints,
      current.componentFingerprints,
    );
    const matches = mismatchedComponents.length === 0 &&
      state.value.configurationFingerprint === current.configurationFingerprint;
    return Object.freeze({
      schemaVersion: "3",
      matches,
      componentDiagnosticsAvailable: true,
      mismatchedComponents,
    });
  }
  const current = await createProductionAcceptancePortableConfigurationSnapshot(environment);
  const mismatchedComponents = findProductionAcceptanceConfigurationMismatches(
    state.value.componentFingerprints,
    current.componentFingerprints,
  );
  const matches = mismatchedComponents.length === 0 &&
    state.value.configurationFingerprint === current.configurationFingerprint;
  return Object.freeze({
    schemaVersion: "3",
    matches,
    componentDiagnosticsAvailable: true,
    mismatchedComponents,
  });
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
