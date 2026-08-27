import path from "node:path";
import { AssetManager } from "@/lib/assets/AssetManager";
import { AudioStorage } from "@/lib/assets/storage/AudioStorage";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import { ProjectWriter } from "@/lib/projects/ProjectWriter";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import type { AssemblyPlanData } from "@/types/assembly";
import type { AudioData } from "@/types/audio";
import type { Asset } from "@/types/asset";

/**
 * Rebinds one chapter's `audio.json` section to point at whichever asset in the live
 * registry (`assets/assets.json`) is currently the authoritative, real (non-mock)
 * narration for that chapter — the repair `VideoAssemblyManager.requireAudioAsset()`
 * assumes has already happened by the time assembly runs, but that nothing in the
 * audio-compensation/publication path currently performs (see
 * `AudioCompensationAssemblyInvalidation.ts` for the caller that is meant to invoke
 * this right after a real chapter republish).
 *
 * This never touches the physical WAV file — the file at the asset's `filePath` is
 * assumed already correct (e.g. published via `AudioStorage.saveAudio` /
 * the canonical hard-link publication path). It repairs the *reference* from
 * `audio.json` and `assembly.json` to the registry, using `ProjectManager.saveAudio`
 * and `ProjectWriter.writeJSON` — the same, ordinary persistence path the ordinary
 * pipeline stage already uses.
 */
export class AudioSectionBindingError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AudioSectionBindingError";
    this.stack = undefined;
  }
}

export async function updateAudioSectionBinding(input: {
  readonly projectSlug: string;
  readonly projectId: string;
  readonly chapterId: number;
  readonly assetId: string;
  readonly context?: RuntimeStorageContext;
}): Promise<AudioData> {
  const audio = await ProjectManager.getAudio(input.projectSlug, input.context) as AudioData | null;
  if (!audio || !Array.isArray(audio.sections)) {
    throw new AudioSectionBindingError("AUDIO_SECTION_BINDING_SOURCE_INVALID");
  }
  const sectionIndex = audio.sections.findIndex((section) => section.chapterId === input.chapterId);
  if (sectionIndex < 0) {
    throw new AudioSectionBindingError("AUDIO_SECTION_BINDING_CHAPTER_NOT_FOUND");
  }

  const projectAssets = AssetManager.getProjectAssets(input.projectSlug, input.projectId, input.context);
  let asset = requireAuthoritativeChapterAsset(projectAssets.assets, input);

  // Normalize legacy asset URL if it differs from canonical AudioStorage URL
  if (typeof asset.filePath === "string") {
    const fileName = path.posix.basename(asset.filePath);
    const canonicalUrl = AudioStorage.getAudioUrl(input.projectSlug, fileName);
    if (asset.url !== canonicalUrl) {
      AssetManager.updateAsset(input.projectSlug, input.projectId, asset.id, { url: canonicalUrl }, input.context ?? {});
      asset = { ...asset, url: canonicalUrl };
    }
  }

  // Synchronize assembly.json scenes if assembly.json exists
  let assemblyUpdated = false;
  const assembly = await ProjectReader.readJSON<AssemblyPlanData>(input.projectSlug, "assembly.json", input.context);
  let updatedAssembly: AssemblyPlanData | undefined;
  if (assembly && Array.isArray(assembly.scenes)) {
    const assemblySceneIndex = assembly.scenes.findIndex((scene) => scene.chapterId === input.chapterId || scene.sceneId === input.chapterId);
    if (assemblySceneIndex >= 0 && assembly.scenes[assemblySceneIndex].audioAssetId !== asset.id) {
      const updatedScenes = [...assembly.scenes];
      updatedScenes[assemblySceneIndex] = {
        ...updatedScenes[assemblySceneIndex],
        audioAssetId: asset.id,
      };
      updatedAssembly = { ...assembly, scenes: updatedScenes };
      assemblyUpdated = true;
    }
  }

  const currentSection = audio.sections[sectionIndex];
  const audioNeedsUpdate = !(
    currentSection.outputAssetId === asset.id &&
    currentSection.status === "generated" &&
    currentSection.provider === asset.provider &&
    currentSection.model === asset.model &&
    currentSection.durationSeconds === asset.durationSeconds &&
    currentSection.audioFileUrl === (asset.url ?? asset.filePath)
  );

  if (!audioNeedsUpdate && !assemblyUpdated) {
    return audio;
  }

  let updatedAudio = audio;
  if (audioNeedsUpdate) {
    const updatedSections = [...audio.sections];
    updatedSections[sectionIndex] = {
      ...updatedSections[sectionIndex],
      outputAssetId: asset.id,
      status: "generated",
      provider: asset.provider,
      model: asset.model,
      audioFileUrl: asset.url ?? asset.filePath,
      byteLength: asset.byteLength,
      durationSeconds: asset.durationSeconds,
    };
    updatedAudio = { ...audio, sections: updatedSections };
    await ProjectManager.saveAudio(input.projectSlug, updatedAudio, input.context);
  }

  if (assemblyUpdated && updatedAssembly) {
    await ProjectWriter.writeJSON(input.projectSlug, "assembly.json", updatedAssembly, input.context);
  }

  return updatedAudio;
}

function requireAuthoritativeChapterAsset(
  assets: readonly Asset[],
  input: { readonly projectId: string; readonly projectSlug: string; readonly chapterId: number;
    readonly assetId: string },
): Asset {
  const candidates = assets.filter((asset) => asset.id === input.assetId);
  if (candidates.length !== 1) {
    throw new AudioSectionBindingError("AUDIO_SECTION_BINDING_ASSET_NOT_FOUND");
  }
  const asset = candidates[0];
  if (
    asset.projectId !== input.projectId ||
    asset.projectSlug !== input.projectSlug ||
    asset.type !== "audio" ||
    asset.status !== "generated" ||
    asset.provider === "mock" ||
    asset.model === "mock" ||
    asset.sceneId !== input.chapterId ||
    asset.mimeType !== "audio/wav" ||
    typeof asset.filePath !== "string" ||
    typeof asset.url !== "string" ||
    !Number.isSafeInteger(asset.byteLength) || (asset.byteLength as number) <= 0 ||
    !Number.isFinite(asset.durationSeconds) || (asset.durationSeconds as number) <= 0
  ) {
    // Deliberately the same fail-closed shape as
    // `VideoAssemblyManager.requireAudioAsset()`: only an asset that would *already*
    // pass assembly's own validation is accepted as an authoritative rebind target.
    throw new AudioSectionBindingError("AUDIO_SECTION_BINDING_ASSET_NOT_AUTHORITATIVE");
  }

  const fileName = path.posix.basename(asset.filePath);
  const expectedUrl = AudioStorage.getAudioUrl(input.projectSlug, fileName);
  if (asset.url !== expectedUrl) {
    // Legacy URLs (e.g. /projects/...) are acceptable for selection; they will be normalized in updateAudioSectionBinding
  }

  return asset;
}

