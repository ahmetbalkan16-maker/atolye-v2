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
