import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import { ProjectWriter } from "@/lib/projects/ProjectWriter";
import {
  createProductionAcceptanceProjectSlug,
  normalizeProductionAcceptanceTopic,
  productionAcceptanceTopicFingerprint,
} from "./ProductionAcceptanceTopic";

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

interface ProductionAcceptanceMarker {
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
  const marker: ProductionAcceptanceMarker = {
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
    configurationFingerprint !== productionAcceptanceConfigurationFingerprint()
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
  if (state.value.configurationFingerprint !== productionAcceptanceConfigurationFingerprint()) {
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
    state.value.configurationFingerprint !== productionAcceptanceConfigurationFingerprint()
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
  const marker = value as Partial<ProductionAcceptanceMarker>;
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
