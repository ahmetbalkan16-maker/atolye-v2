import path from "node:path";
import { AssetManager } from "@/lib/assets/AssetManager";
import { AudioStorage } from "@/lib/assets/storage/AudioStorage";
import type {
  AudioData,
  AudioGenerationResult,
  AudioGenerationTarget,
  AudioMimeType,
  AudioProviderName,
  AudioSection,
} from "@/types/audio";
import type { Asset, ProjectAssets } from "@/types/asset";
import type {
  AudioGenerationInput,
  AudioProvider,
} from "./providers/AudioProvider";
import { AudioProviderRouter } from "./providers/AudioProviderRouter";

const SAFE_ASSET_ERROR = "Audio asset generation failed.";
const SAFE_PIPELINE_ERROR = "Audio asset generation failed.";
const SAFE_FAILURE_PROMPT = "Audio generation request.";
const SAFE_MODEL_NAME = /^[a-zA-Z0-9._:-]+$/;

export class AudioAssetGenerationError extends Error {
  readonly code = "AUDIO_ASSET_GENERATION_FAILED";

  constructor() {
    super(SAFE_PIPELINE_ERROR);
    this.name = "AudioAssetGenerationError";
    this.stack = undefined;
  }
}

type GenerateAudioInput = {
  projectId: string;
  projectSlug: string;
  audio: AudioData;
  provider?: AudioProvider;
};

type NormalizedAudioResult = {
  provider: AudioProviderName;
  model?: string;
  filePath: string;
  url: string;
  mimeType: AudioMimeType | "audio/mock";
  byteLength: number;
  durationSeconds: number;
  createdAt: string;
};

export type AudioPipelineResult = {
  audio: AudioData;
  projectAssets: ProjectAssets;
};

export class AudioPipeline {
  static async generateAudio({
    projectId,
    projectSlug,
    audio,
    provider,
  }: GenerateAudioInput): Promise<AudioPipelineResult> {
    const requests = buildAndValidateBatch(audio, projectSlug);
    const audioProvider = provider ?? AudioProviderRouter.getProvider();
    const selectedProvider = getProviderName(audioProvider);

    validateProviderInputs(audioProvider, requests);

    let projectAssets: ProjectAssets;

    try {
      projectAssets = AssetManager.getProjectAssets(projectSlug, projectId);
    } catch {
      throw new AudioAssetGenerationError();
    }
    const updatedSections: AudioSection[] = [];

    for (let index = 0; index < audio.sections.length; index += 1) {
      const section = audio.sections[index];
      const request = requests[index];
      const normalized = await generateAndNormalize({
        provider: audioProvider,
        selectedProvider,
        request,
        projectId,
        projectSlug,
      });
      const asset = createGeneratedAsset({
        projectId,
        projectSlug,
        sceneId: section.chapterId,
        prompt: section.sourceText,
        result: normalized,
      });

      projectAssets = addAssetOrFail(projectSlug, projectId, asset);
      updatedSections.push({
        ...section,
        outputAssetId: asset.id,
        audioFileUrl: normalized.url || normalized.filePath,
        status: "generated",
        provider: normalized.provider,
        model: normalized.model,
        byteLength: normalized.byteLength,
        durationSeconds: normalized.durationSeconds,
      });
    }

    const mixRequest = requests[requests.length - 1];
    const normalizedMix = await generateAndNormalize({
      provider: audioProvider,
      selectedProvider,
      request: mixRequest,
      projectId,
      projectSlug,
    });
    const mixAsset = createGeneratedAsset({
      projectId,
      projectSlug,
      prompt: buildMixPrompt(audio),
      result: normalizedMix,
    });

    projectAssets = addAssetOrFail(projectSlug, projectId, mixAsset);

    return {
      projectAssets,
      audio: {
        ...audio,
        outputAssetId: mixAsset.id,
        status: "generated",
        provider: normalizedMix.provider,
        model: normalizedMix.model,
        sections: updatedSections,
        production: {
          ...audio.production,
          targetFormat:
            selectedProvider === "openai"
              ? "wav"
              : audio.production.targetFormat,
          generationStatus: "generated",
          audioFileUrl: normalizedMix.url || normalizedMix.filePath,
          byteLength: normalizedMix.byteLength,
          durationSeconds: normalizedMix.durationSeconds,
        },
      },
    };
  }
}

export async function generateAudio(
  input: GenerateAudioInput,
): Promise<AudioPipelineResult> {
  return AudioPipeline.generateAudio(input);
}

async function generateAndNormalize({
  provider,
  selectedProvider,
  request,
  projectId,
  projectSlug,
}: {
  provider: AudioProvider;
  selectedProvider: AudioProviderName;
  request: AudioGenerationInput;
  projectId: string;
  projectSlug: string;
}): Promise<NormalizedAudioResult> {
  let result: AudioGenerationResult;

  try {
    result = await provider.generateAudio(request);
  } catch {
    persistFailedAssetSafely({
      projectId,
      projectSlug,
      target: request.target,
      providerName: selectedProvider,
    });
    throw new AudioAssetGenerationError();
  }

  let normalized: NormalizedAudioResult | null;

  try {
    normalized = normalizeGenerationResult(
      result,
      request.target,
      selectedProvider,
      projectSlug,
    );
  } catch {
    normalized = null;
  }

  if (!normalized) {
    persistFailedAssetSafely({
      projectId,
      projectSlug,
      target: request.target,
      providerName: selectedProvider,
    });
    throw new AudioAssetGenerationError();
  }

  return normalized;
}

function normalizeGenerationResult(
  result: AudioGenerationResult | null | undefined,
  expectedTarget: AudioGenerationTarget,
  providerName: AudioProviderName,
  projectSlug: string,
): NormalizedAudioResult | null {
  if (
    !result ||
    result.success !== true ||
    result.provider !== providerName ||
    !isExpectedTarget(result.target, expectedTarget) ||
    !isValidCreatedAt(result.createdAt)
  ) {
    return null;
  }

  if (providerName === "mock") {
    if (
      result.provider !== "mock" ||
      result.model !== "mock-audio-model" ||
      result.mimeType !== "audio/mock" ||
      result.filePath !== "" ||
      result.url !== "" ||
      result.byteLength !== 0 ||
      result.durationSeconds !== 0 ||
      (result as { error?: unknown }).error !== undefined
    ) {
      return null;
    }

    return {
      provider: "mock",
      model: result.model,
      filePath: "",
      url: "",
      mimeType: "audio/mock",
      byteLength: 0,
      durationSeconds: 0,
      createdAt: result.createdAt,
    };
  }

  if (
    result.provider !== "openai" ||
    result.mimeType !== "audio/wav" ||
    !isSafeModelName(result.model) ||
    !Number.isSafeInteger(result.byteLength) ||
    result.byteLength <= 0 ||
    !Number.isFinite(result.durationSeconds) ||
    result.durationSeconds <= 0 ||
    (result as { error?: unknown }).error !== undefined
  ) {
    return null;
  }

  const filePath = normalizeSafeAudioPath(result.filePath, projectSlug);
  const url = normalizeSafeAudioUrl(result.url, projectSlug, filePath);

  if (!filePath || !url) {
    return null;
  }

  const inspection = AudioStorage.inspectStoredWav(projectSlug, filePath);

  if (
    inspection.byteLength !== result.byteLength ||
    Math.abs(inspection.durationSeconds - result.durationSeconds) > 1e-9
  ) {
    return null;
  }

  return {
    provider: "openai",
    model: result.model,
    filePath,
    url,
    mimeType: "audio/wav",
    byteLength: inspection.byteLength,
    durationSeconds: inspection.durationSeconds,
    createdAt: result.createdAt,
  };
}

function createGeneratedAsset({
  projectId,
  projectSlug,
  sceneId,
  prompt,
  result,
}: {
  projectId: string;
  projectSlug: string;
  sceneId?: number;
  prompt: string;
  result: NormalizedAudioResult;
}) {
  return AssetManager.createAsset({
    projectId,
    projectSlug,
    sceneId,
    type: "audio",
    status: "generated",
    provider: result.provider,
    model: result.model,
    prompt,
    filePath: result.filePath,
    url: result.url,
    mimeType: result.mimeType,
    byteLength: result.byteLength,
    durationSeconds: result.durationSeconds,
    createdAt: result.createdAt,
  });
}

function persistFailedAssetSafely({
  projectId,
  projectSlug,
  target,
  providerName,
}: {
  projectId: string;
  projectSlug: string;
  target: AudioGenerationTarget;
  providerName: AudioProviderName;
}): void {
  try {
    const asset = AssetManager.createAsset({
      projectId,
      projectSlug,
      sceneId: target.kind === "section" ? target.chapterId : undefined,
      type: "audio",
      status: "failed",
      provider: providerName,
      prompt: SAFE_FAILURE_PROMPT,
      error: SAFE_ASSET_ERROR,
    });

    AssetManager.addAsset(projectSlug, projectId, asset);
  } catch {
    // A secondary registry failure must not replace the safe stage failure.
  }
}

function addAssetOrFail(
  projectSlug: string,
  projectId: string,
  asset: Asset,
) {
  try {
    return AssetManager.addAsset(projectSlug, projectId, asset);
  } catch {
    throw new AudioAssetGenerationError();
  }
}

function buildAndValidateBatch(
  audio: AudioData,
  projectSlug: string,
): AudioGenerationInput[] {
  if (
    !/^[a-zA-Z0-9-_]+$/.test(projectSlug) ||
    !audio.narrator ||
    typeof audio.narrator.style !== "string" ||
    !audio.narrator.style.trim() ||
    !Array.isArray(audio.sections) ||
    audio.sections.length === 0
  ) {
    throw new AudioAssetGenerationError();
  }

  const chapterIds = new Set<number>();
  const requests: AudioGenerationInput[] = [];

  for (const section of audio.sections) {
    const chapterId = (section as { chapterId?: unknown } | null)?.chapterId;
    const sourceText = (section as { sourceText?: unknown } | null)?.sourceText;

    if (
      typeof chapterId !== "number" ||
      !Number.isSafeInteger(chapterId) ||
      chapterId <= 0 ||
      chapterIds.has(chapterId) ||
      typeof sourceText !== "string" ||
      !sourceText.trim()
    ) {
      throw new AudioAssetGenerationError();
    }

    chapterIds.add(chapterId);
    requests.push({
      target: { kind: "section", chapterId },
      title: typeof section.title === "string" ? section.title : undefined,
      sourceText,
      voiceStyle: audio.narrator?.style,
      projectSlug,
    });
  }

  requests.push({
    target: { kind: "mix" },
    sourceText: audio.sections.map((section) => section.sourceText).join("\n\n"),
    voiceStyle: audio.narrator?.style,
    projectSlug,
  });

  return requests;
}

function validateProviderInputs(
  provider: AudioProvider,
  requests: AudioGenerationInput[],
) {
  try {
    for (const request of requests) {
      provider.validateInput(request);
    }
  } catch {
    throw new AudioAssetGenerationError();
  }
}

function getProviderName(provider: AudioProvider): AudioProviderName {
  try {
    if (provider.name === "mock" || provider.name === "openai") {
      return provider.name;
    }
  } catch {
    // Fall through to the safe pipeline error.
  }

  throw new AudioAssetGenerationError();
}

function isExpectedTarget(
  value: unknown,
  expected: AudioGenerationTarget,
): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const target = value as { kind?: unknown; chapterId?: unknown };

  if (expected.kind === "mix") {
    return target.kind === "mix" && target.chapterId === undefined;
  }

  return target.kind === "section" && target.chapterId === expected.chapterId;
}

function isValidCreatedAt(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function isSafeModelName(value: unknown): value is string {
  return typeof value === "string" && SAFE_MODEL_NAME.test(value);
}

function normalizeSafeAudioPath(value: unknown, projectSlug: string) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const candidate = value.trim();

  if (
    candidate.includes("\\") ||
    path.posix.isAbsolute(candidate) ||
    path.win32.isAbsolute(candidate)
  ) {
    return null;
  }

  const normalized = path.posix.normalize(candidate);
  const audioRoot = AudioStorage.getAudioDir(projectSlug);
  const expectedPrefix = `${audioRoot}/`;
  const fileName = normalized.slice(expectedPrefix.length);

  if (
    normalized !== candidate ||
    !normalized.startsWith(expectedPrefix) ||
    !fileName ||
    fileName.includes("/") ||
    !/^[a-zA-Z0-9-_.]+\.wav$/i.test(fileName) ||
    fileName.includes("..")
  ) {
    return null;
  }

  return normalized;
}

function normalizeSafeAudioUrl(
  value: unknown,
  projectSlug: string,
  filePath: string | null,
) {
  if (typeof value !== "string" || !value.trim() || !filePath) {
    return null;
  }

  const fileName = filePath.slice(filePath.lastIndexOf("/") + 1);
  const expected = AudioStorage.getAudioUrl(projectSlug, fileName);

  return value.trim() === expected ? expected : null;
}

function buildMixPrompt(audio: AudioData): string {
  return [
    "Narration mix from audio sections",
    `narrator: ${audio.narrator.style}`,
    `sections: ${audio.sections.length}`,
  ].join(", ");
}
