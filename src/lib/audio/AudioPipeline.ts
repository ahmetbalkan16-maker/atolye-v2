import { AssetManager } from "@/lib/assets/AssetManager";
import type { AudioData, AudioSection, AudioStatus } from "@/types/audio";
import type { ProjectAssets } from "@/types/asset";
import { MockAudioProvider } from "./providers/MockAudioProvider";
import type { AudioProvider } from "./providers/AudioProvider";

type GenerateAudioInput = {
  projectId: string;
  projectSlug: string;
  audio: AudioData;
  provider?: AudioProvider;
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
    const audioProvider = provider ?? new MockAudioProvider();
    let projectAssets = AssetManager.getProjectAssets(projectSlug, projectId);
    const updatedSections: AudioSection[] = [];

    for (const section of audio.sections) {
      const result = await audioProvider.generateAudio({
        chapterId: section.chapterId,
        title: section.title,
        sourceText: section.sourceText,
        voiceStyle: audio.narrator.style,
        format: audio.production.targetFormat,
      });
      const status = toAudioStatus(result.error ? "failed" : result.status);
      const asset = AssetManager.createAsset({
        projectId,
        projectSlug,
        sceneId: section.chapterId,
        type: "audio",
        status,
        provider: result.provider,
        model: result.model,
        prompt: section.sourceText,
        filePath: result.filePath,
        url: result.url,
        mimeType: result.mimeType,
        error: result.error,
      });

      projectAssets = AssetManager.addAsset(projectSlug, projectId, asset);
      updatedSections.push({
        ...section,
        outputAssetId: asset.id,
        audioFileUrl: result.url || result.filePath || section.audioFileUrl,
        status,
        provider: result.provider,
        model: result.model,
      });
    }

    const mixResult = await audioProvider.generateAudio({
      sourceText: audio.sections.map((section) => section.sourceText).join("\n\n"),
      voiceStyle: audio.narrator.style,
      format: audio.production.targetFormat,
    });
    const mixStatus = toAudioStatus(
      mixResult.error ? "failed" : mixResult.status,
    );
    const mixAsset = AssetManager.createAsset({
      projectId,
      projectSlug,
      type: "audio",
      status: mixStatus,
      provider: mixResult.provider,
      model: mixResult.model,
      prompt: buildMixPrompt(audio),
      filePath: mixResult.filePath,
      url: mixResult.url,
      mimeType: mixResult.mimeType,
      error: mixResult.error,
    });

    projectAssets = AssetManager.addAsset(projectSlug, projectId, mixAsset);

    return {
      projectAssets,
      audio: {
        ...audio,
        outputAssetId: mixAsset.id,
        status: mixStatus,
        provider: mixResult.provider,
        model: mixResult.model,
        sections: updatedSections,
        production: {
          ...audio.production,
          generationStatus: mixStatus,
          audioFileUrl:
            mixResult.url || mixResult.filePath || audio.production.audioFileUrl,
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

function buildMixPrompt(audio: AudioData): string {
  return [
    "Mock audio mix from narration sections",
    `narrator: ${audio.narrator.style}`,
    `sections: ${audio.sections.length}`,
  ].join(", ");
}

function toAudioStatus(status: string): AudioStatus {
  if (
    status === "planned" ||
    status === "generating" ||
    status === "generated" ||
    status === "failed"
  ) {
    return status;
  }

  return "generated";
}
