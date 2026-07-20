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
import { isSafeAudioIdentifier } from "./AudioIdentifierPolicy";
import {
  AudioAssetRootError,
  AudioCanonicalAdmissionConflictError,
  createAudioAssetErrorEvidence,
  getAudioAssetErrorEvidence,
} from "./AudioAssetError";
import type { AudioAssetErrorEvidence } from "@/types/audioError";

const SAFE_ASSET_ERROR = "Audio asset generation failed.";
const SAFE_PIPELINE_ERROR = "Audio asset generation failed.";
const SAFE_FAILURE_PROMPT = "Audio generation request.";

export class AudioAssetGenerationError extends Error {
  readonly code = "AUDIO_ASSET_GENERATION_FAILED";
  readonly evidence: AudioAssetErrorEvidence;

  constructor(evidence?: AudioAssetErrorEvidence) {
    super(SAFE_PIPELINE_ERROR);
    this.name = "AudioAssetGenerationError";
    this.evidence = evidence ??
      createAudioAssetErrorEvidence("AUDIO_PROVIDER_RESPONSE_INVALID");
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
      throw audioFailure("AUDIO_ASSET_REGISTRY_FAILED", {
        phase: "registry",
        target: requests[0]?.target,
        provider: selectedProvider,
        compensation: "not-required",
      });
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
        prompt: SAFE_FAILURE_PROMPT,
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
  } catch (error) {
    persistFailedAssetSafely({
      projectId,
      projectSlug,
      target: request.target,
      providerName: selectedProvider,
    });
    throw new AudioAssetGenerationError(
      contextualEvidence(error, request.target, selectedProvider),
    );
  }

  let normalized: NormalizedAudioResult | null;

  try {
    normalized = normalizeGenerationResult(
      result,
      request.target,
      selectedProvider,
      projectSlug,
    );
  } catch (error) {
    if (error instanceof AudioCanonicalAdmissionConflictError) {
      throw new AudioAssetGenerationError(
        contextualEvidence(error, request.target, selectedProvider),
      );
    }
    compensateUnregisteredResult(result);
    persistFailedAssetSafely({
      projectId,
      projectSlug,
      target: request.target,
      providerName: selectedProvider,
    });
    if (error instanceof AudioAssetGenerationError) throw error;
    const evidence = contextualEvidence(error, request.target, selectedProvider);
    throw new AudioAssetGenerationError(evidence);
  }

  if (!normalized) {
    compensateUnregisteredResult(result);
    persistFailedAssetSafely({
      projectId,
      projectSlug,
      target: request.target,
      providerName: selectedProvider,
    });
    throw audioFailure("AUDIO_PROVIDER_RESPONSE_INVALID", {
      phase: "response",
      target: request.target,
      provider: selectedProvider,
    });
  }

  return normalized;
}

function normalizeGenerationResult(
  result: AudioGenerationResult | null | undefined,
  expectedTarget: AudioGenerationTarget,
  providerName: AudioProviderName,
  projectSlug: string,
): NormalizedAudioResult | null {
  if (!result) {
    return null;
  }

  if (result.success === false) {
    throw new AudioAssetGenerationError(
      contextualEvidence(result, expectedTarget, providerName),
    );
  }

  if (
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

  let inspection;
  try {
    inspection = AudioStorage.inspectStoredWav(projectSlug, filePath);
  } catch (error) {
    if (error instanceof AudioCanonicalAdmissionConflictError) throw error;
    throw new AudioAssetGenerationError(
      contextualEvidence(
        error instanceof AudioAssetRootError
          ? error
          : new AudioAssetRootError("AUDIO_STORAGE_WRITE_FAILED", {
              phase: "storage",
            }),
        expectedTarget,
        providerName,
      ),
    );
  }

  if (
    inspection.byteLength !== result.byteLength ||
    Math.abs(inspection.durationSeconds - result.durationSeconds) > 1e-9
  ) {
    return null;
  }

  const normalized: NormalizedAudioResult = {
    provider: "openai",
    model: result.model,
    filePath,
    url,
    mimeType: "audio/wav",
    byteLength: inspection.byteLength,
    durationSeconds: inspection.durationSeconds,
    createdAt: result.createdAt,
  };
  return AudioStorage.transferPublicationOwnership(result, normalized);
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
  const asset = AssetManager.createAsset({
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
  return AudioStorage.transferPublicationOwnership(result, asset);
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
  let updated: ProjectAssets;
  try {
    updated = AssetManager.addAssetAtomically(projectSlug, projectId, asset);
  } catch {
    const handoff = AudioStorage.handoffPublishedAudio(asset, projectId);
    if (
      handoff.status === "registry-owned-confirmed" ||
      handoff.status === "registry-ownership-completed"
    ) {
      return handoff.projectAssets;
    }
    const compensationResult = asset.filePath
      ? AudioStorage.compensatePublishedAudioResult(asset)
      : undefined;
    const compensation = compensationResult
      ? (compensationResult.compensated
          ? "completed" as const
          : "failed" as const)
      : "not-required" as const;
    throw audioFailure("AUDIO_ASSET_REGISTRY_FAILED", {
      phase: "registry",
      target: Number.isSafeInteger(asset.sceneId)
        ? { kind: "section", chapterId: asset.sceneId as number }
        : { kind: "mix" },
      provider: asset.provider === "mock" ? "mock" : "openai",
      model: asset.model,
      compensation,
      compensationRef: compensationResult?.compensationRef,
      cleanup: compensationResult?.cleanup,
    });
  }
  const compensationRef = AudioStorage.getCompensationRef(asset);
  if (asset.filePath && compensationRef) {
    const handoff = AudioStorage.handoffPublishedAudio(asset, projectId);
    if (
      handoff.status === "registry-owned-confirmed" ||
      handoff.status === "registry-ownership-completed"
    ) {
      return handoff.projectAssets;
    }
    const compensationResult =
      AudioStorage.compensatePublishedAudioResult(asset);
    const compensation = compensationResult.compensated
      ? "completed" as const
      : "failed" as const;
    throw audioFailure("AUDIO_STORAGE_WRITE_FAILED", {
      phase: "storage",
      target: Number.isSafeInteger(asset.sceneId)
        ? { kind: "section", chapterId: asset.sceneId as number }
        : { kind: "mix" },
      provider: asset.provider === "mock" ? "mock" : "openai",
      model: asset.model,
      compensation,
      compensationRef,
      cleanup: compensationResult.cleanup,
    });
  }
  return updated;
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
    throw audioFailure("AUDIO_PROVIDER_CONFIGURATION_INVALID", {
      phase: "configuration",
    });
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
      throw audioFailure("AUDIO_PROVIDER_CONFIGURATION_INVALID", {
        phase: "configuration",
        target: Number.isSafeInteger(chapterId) && (chapterId as number) > 0
          ? { kind: "section", chapterId: chapterId as number }
          : undefined,
      });
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
  } catch (error) {
    throw new AudioAssetGenerationError(
      contextualEvidence(
        error,
        requests[0]?.target,
        getProviderNameSafely(provider),
        "configuration",
      ),
    );
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

  throw audioFailure("AUDIO_PROVIDER_CONFIGURATION_INVALID", {
    phase: "configuration",
  });
}

function compensateUnregisteredResult(result: unknown): void {
  AudioStorage.compensatePublishedAudio(result);
}

function contextualEvidence(
  value: unknown,
  target: AudioGenerationTarget | undefined,
  provider: AudioProviderName,
  fallbackPhase: "configuration" | "request" | "response" = "response",
): AudioAssetErrorEvidence {
  const existing = getAudioAssetErrorEvidence(value);
  return createAudioAssetErrorEvidence(
    existing?.rootCode ??
      (fallbackPhase === "configuration"
        ? "AUDIO_PROVIDER_CONFIGURATION_INVALID"
        : "AUDIO_PROVIDER_RESPONSE_INVALID"),
    {
      phase: existing?.phase ?? fallbackPhase,
      target,
      provider: existing?.provider ?? provider,
      model: existing?.model,
      httpStatus: existing?.httpStatus,
      responseBytes: existing?.responseBytes,
      maximumResponseBytes: existing?.maximumResponseBytes,
      compensation: existing?.compensation,
      compensationRef: existing?.compensationRef,
      cleanup: existing?.cleanup,
    },
  );
}

function audioFailure(
  rootCode: AudioAssetErrorEvidence["rootCode"],
  metadata: Parameters<typeof createAudioAssetErrorEvidence>[1] = {},
): AudioAssetGenerationError {
  return new AudioAssetGenerationError(
    createAudioAssetErrorEvidence(rootCode, metadata),
  );
}

function getProviderNameSafely(provider: AudioProvider): AudioProviderName {
  try {
    return provider.name === "openai" ? "openai" : "mock";
  } catch {
    return "mock";
  }
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
  return isSafeAudioIdentifier(value);
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
