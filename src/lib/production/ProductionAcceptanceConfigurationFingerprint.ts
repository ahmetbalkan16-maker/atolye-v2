import { createHash } from "node:crypto";
import fs from "node:fs/promises";

const CONFIGURATION_COMPONENT_NAMES = [
  "AI_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_MAX_TOKENS",
  "OPENAI_TEMPERATURE",
  "OPENAI_RESEARCH_MAX_TOKENS",
  "OPENAI_SCRIPT_MAX_TOKENS",
  "OPENAI_VISUALS_MAX_TOKENS",
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
  "FFMPEG_EXECUTABLE",
  "FFPROBE_EXECUTABLE",
  "FFMPEG_TIMEOUT_MS",
  "FFMPEG_MAX_STDIO_BYTES",
  "SCENE_VIDEO_MAX_OUTPUT_BYTES",
  "VIDEO_ASSEMBLY_MAX_OUTPUT_BYTES",
  "THUMBNAIL_PROVIDER",
  "YOUTUBE_PROVIDER",
  "YOUTUBE_OPENAI_MODEL",
  "ATOLYE_DURABLE_PIPELINE_EXECUTION",
] as const;

const CONFIGURATION_COMPONENT_NAMES_V2 = [
  ...CONFIGURATION_COMPONENT_NAMES,
  "STORAGE_IDENTITY",
  "ENVIRONMENT_POLICY",
] as const;

type ProductionAcceptanceConfigurationComponent =
  (typeof CONFIGURATION_COMPONENT_NAMES)[number];

type ProductionAcceptanceConfigurationComponentV2 =
  (typeof CONFIGURATION_COMPONENT_NAMES_V2)[number];

export type ProductionAcceptanceComponentFingerprints = Readonly<
  Record<ProductionAcceptanceConfigurationComponent, string>
>;

export type ProductionAcceptanceComponentFingerprintsV2 = Readonly<
  Record<ProductionAcceptanceConfigurationComponentV2, string>
>;

export interface ProductionAcceptancePortableConfigurationSnapshot {
  readonly configurationFingerprint: string;
  readonly componentFingerprints: ProductionAcceptanceComponentFingerprints;
  readonly unavailableComponents: readonly ProductionAcceptanceConfigurationComponent[];
}

export interface ProductionAcceptancePortableConfigurationSnapshotV2 {
  readonly componentFingerprintProfile: "2";
  readonly configurationFingerprint: string;
  readonly componentFingerprints: ProductionAcceptanceComponentFingerprintsV2;
  readonly unavailableComponents: readonly ProductionAcceptanceConfigurationComponentV2[];
}

type ReadBinary = (filePath: string) => Promise<Buffer>;

export async function createProductionAcceptancePortableConfigurationSnapshot(
  environment: NodeJS.ProcessEnv = process.env,
  readBinary: ReadBinary = (filePath) => fs.readFile(filePath),
): Promise<ProductionAcceptancePortableConfigurationSnapshot> {
  const unavailableComponents: ProductionAcceptanceConfigurationComponent[] = [];
  const entries = await Promise.all(CONFIGURATION_COMPONENT_NAMES.map(async (name) => {
    let value: string | null;
    if (name === "FFMPEG_EXECUTABLE" || name === "FFPROBE_EXECUTABLE") {
      const pathName = name === "FFMPEG_EXECUTABLE" ? "FFMPEG_PATH" : "FFPROBE_PATH";
      const executablePath = environment[pathName]?.trim();
      if (!executablePath) {
        unavailableComponents.push(name);
        value = "unconfigured";
      } else {
        try {
          value = `sha256:${createHash("sha256").update(await readBinary(executablePath)).digest("hex")}`;
        } catch {
          unavailableComponents.push(name);
          value = "unavailable";
        }
      }
    } else if (name === "OPENAI_API_KEY") {
      value = secretIdentity(environment.OPENAI_API_KEY);
    } else {
      value = environment[name] ?? null;
    }
    return [name, componentFingerprint(name, value)] as const;
  }));
  const componentFingerprints = Object.freeze(Object.fromEntries(entries)) as
    ProductionAcceptanceComponentFingerprints;
  return Object.freeze({
    configurationFingerprint: createHash("sha256")
      .update(JSON.stringify(entries))
      .digest("hex"),
    componentFingerprints,
    unavailableComponents: Object.freeze([...unavailableComponents].sort()),
  });
}

export async function createProductionAcceptancePortableConfigurationSnapshotV2(
  projectSlug: string,
  environment: NodeJS.ProcessEnv = process.env,
  readBinary: ReadBinary = (filePath) => fs.readFile(filePath),
): Promise<ProductionAcceptancePortableConfigurationSnapshotV2> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(projectSlug)) {
    throw new Error("Invalid production acceptance configuration identity.");
  }
  const legacy = await createProductionAcceptancePortableConfigurationSnapshot(
    environment,
    readBinary,
  );
  const entries: Array<readonly [ProductionAcceptanceConfigurationComponentV2, string]> =
    CONFIGURATION_COMPONENT_NAMES.map((name) => [
      name,
      legacy.componentFingerprints[name],
    ] as const);
  entries.push([
    "STORAGE_IDENTITY",
    componentFingerprint("STORAGE_IDENTITY", JSON.stringify({
      projectRoot: `data/projects/${projectSlug}`,
      assetLayout: "project-assets-v1",
      containmentPolicy: "workspace-contained-no-links-v1",
    })),
  ]);
  entries.push([
    "ENVIRONMENT_POLICY",
    componentFingerprint("ENVIRONMENT_POLICY", JSON.stringify({
      policyVersion: "production-acceptance-environment-v2",
      strictProductionAcceptance: true,
      publishMode: "package-only",
      configurationSemantics: "explicit-environment-and-application-defaults-v1",
      ...(environment.OPENAI_AUDIO_MAX_TOKENS !== undefined
        ? { audioMaxTokens: environment.OPENAI_AUDIO_MAX_TOKENS }
        : {}),
      ...(environment.OPENAI_ASSEMBLY_MAX_TOKENS !== undefined
        ? { assemblyMaxTokens: environment.OPENAI_ASSEMBLY_MAX_TOKENS }
        : {}),
      ...(environment.OPENAI_SCENES_MAX_TOKENS !== undefined
        ? { scenesMaxTokens: environment.OPENAI_SCENES_MAX_TOKENS }
        : {}),
      ...(environment.IMAGE_OPENAI_REQUEST_INTERVAL_MS !== undefined
        ? { imageRequestIntervalMs: environment.IMAGE_OPENAI_REQUEST_INTERVAL_MS }
        : {}),
      // Documentary real-media + cost policy (Faz 5/6). Conditional: a component
      // enters the fingerprint only when the operator has EXPLICITLY set the env
      // var. The logic default (on for a real render, off in tests — see
      // `RealMediaProductionFlags`) leaves the var undefined and therefore does
      // NOT alter the fingerprint, so every already-prepared marker — including
      // `5be83a84` — keeps its existing fingerprint. `ATOLYE_AI_COST_GUARD` is
      // deliberately excluded: it is a runtime safety toggle that only blocks
      // over-budget dispatch and never changes what is generated.
      ...(environment.ATOLYE_REAL_MEDIA_DISCOVERY !== undefined
        ? { realMediaDiscovery: environment.ATOLYE_REAL_MEDIA_DISCOVERY }
        : {}),
      ...(environment.ATOLYE_REAL_MEDIA_SELECTION !== undefined
        ? { realMediaSelection: environment.ATOLYE_REAL_MEDIA_SELECTION }
        : {}),
      ...(environment.ATOLYE_MAX_AI_IMAGES !== undefined
        ? { maxAiImages: environment.ATOLYE_MAX_AI_IMAGES }
        : {}),
      ...(environment.ATOLYE_LOCAL_IMAGE_FALLBACK !== undefined
        ? { localImageFallback: environment.ATOLYE_LOCAL_IMAGE_FALLBACK }
        : {}),
      ...(environment.ATOLYE_AI_COST_BUDGET_USD !== undefined
        ? { aiCostBudgetUsd: environment.ATOLYE_AI_COST_BUDGET_USD }
        : {}),
      // Documentary pipeline revision (P0): the render quality preset. Same
      // conditional rule — the `documentary` default leaves the var undefined
      // and does NOT alter the fingerprint, so already-prepared markers stay
      // valid; an operator who explicitly pins `ATOLYE_QUALITY_PRESET` for a
      // render folds that choice into the marker.
      ...(environment.ATOLYE_QUALITY_PRESET !== undefined
        ? { qualityPreset: environment.ATOLYE_QUALITY_PRESET }
        : {}),
      // Local-provider revision: which local model / voice a $0 render uses.
      // `AI_PROVIDER` / `AUDIO_PROVIDER` / `ANIMATION_PROVIDER` etc. are already
      // fingerprint components above; these pin the concrete local model so a
      // marker prepared against `qwen2.5:3b` is not silently "matched" by a
      // later `qwen2.5:7b` config. Conditional — unset changes nothing.
      ...(environment.OLLAMA_MODEL !== undefined
        ? { ollamaModel: environment.OLLAMA_MODEL }
        : {}),
      ...(environment.OLLAMA_HOST !== undefined
        ? { ollamaHost: environment.OLLAMA_HOST }
        : {}),
      ...(environment.PIPER_VOICE_MODEL !== undefined
        ? { piperVoice: environment.PIPER_VOICE_MODEL }
        : {}),
    })),
  ]);
  const componentFingerprints = Object.freeze(Object.fromEntries(entries)) as
    ProductionAcceptanceComponentFingerprintsV2;
  return Object.freeze({
    componentFingerprintProfile: "2",
    configurationFingerprint: createHash("sha256")
      .update(JSON.stringify(entries))
      .digest("hex"),
    componentFingerprints,
    unavailableComponents: Object.freeze([...legacy.unavailableComponents]),
  });
}

export function validProductionAcceptanceComponentFingerprints(
  value: unknown,
): value is ProductionAcceptanceComponentFingerprints {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [...CONFIGURATION_COMPONENT_NAMES].sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]) &&
    keys.every((key) =>
      typeof record[key] === "string" && /^[a-f0-9]{64}$/.test(record[key]));
}

export function validProductionAcceptanceComponentFingerprintsV2(
  value: unknown,
): value is ProductionAcceptanceComponentFingerprintsV2 {
  return validComponentFingerprintRecord(value, CONFIGURATION_COMPONENT_NAMES_V2);
}

export function productionAcceptancePortableConfigurationFingerprint(
  componentFingerprints: ProductionAcceptanceComponentFingerprints,
): string {
  const entries = CONFIGURATION_COMPONENT_NAMES.map((name) => [
    name,
    componentFingerprints[name],
  ] as const);
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export function productionAcceptancePortableConfigurationFingerprintV2(
  componentFingerprints: ProductionAcceptanceComponentFingerprintsV2,
): string {
  const entries = CONFIGURATION_COMPONENT_NAMES_V2.map((name) => [
    name,
    componentFingerprints[name],
  ] as const);
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export function findProductionAcceptanceConfigurationMismatches(
  expected: ProductionAcceptanceComponentFingerprints,
  current: ProductionAcceptanceComponentFingerprints,
): readonly ProductionAcceptanceConfigurationComponent[] {
  return Object.freeze(CONFIGURATION_COMPONENT_NAMES.filter(
    (name) => expected[name] !== current[name],
  ));
}

export function findProductionAcceptanceConfigurationMismatchesV2(
  expected: ProductionAcceptanceComponentFingerprintsV2,
  current: ProductionAcceptanceComponentFingerprintsV2,
): readonly ProductionAcceptanceConfigurationComponentV2[] {
  return Object.freeze(CONFIGURATION_COMPONENT_NAMES_V2.filter(
    (name) => expected[name] !== current[name],
  ));
}

function validComponentFingerprintRecord(
  value: unknown,
  componentNames: readonly string[],
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [...componentNames].sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]) &&
    keys.every((key) =>
      typeof record[key] === "string" && /^[a-f0-9]{64}$/.test(record[key]));
}

function componentFingerprint(
  name: ProductionAcceptanceConfigurationComponentV2,
  value: string | null,
) {
  return createHash("sha256")
    .update(JSON.stringify({ domain: "production-acceptance-component-v3", name, value }))
    .digest("hex");
}

function secretIdentity(value: string | undefined) {
  const normalized = value?.trim();
  return normalized
    ? createHash("sha256").update(normalized).digest("hex")
    : null;
}
