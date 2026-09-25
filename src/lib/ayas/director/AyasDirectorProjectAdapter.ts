import type { Project } from "../../../types/project";
import type { ResearchData } from "../../../types/research";
import type { ScriptData } from "../../../types/script";
import type { SceneData } from "../../../types/scene";
import type { VisualData } from "../../../types/visual";
import type { AnimationData } from "../../../types/animation";
import type { AudioData } from "../../../types/audio";
import type { Asset, ProjectAssets, MediaType } from "../../../types/asset";
import type {
  DirectorFormat, DirectorMediaCandidate, DirectorMediaClass,
  DirectorScene, DirectorTask,
} from "./AyasDirectorReadiness";

/**
 * An additive projection of the existing project artifacts. It writes no
 * metadata back into project.json, package records, or the asset registry.
 * Missing intent stays missing rather than being inferred from a prompt.
 */
export interface DirectorProjectArtifacts {
  readonly project: Project;
  readonly research?: ResearchData | null;
  readonly script?: ScriptData | null;
  readonly scenes?: SceneData | null;
  readonly visuals?: VisualData | null;
  readonly animation?: AnimationData | null;
  readonly audio?: AudioData | null;
  readonly assets?: ProjectAssets | null;
}

export function directorTaskFromProjectArtifacts(
  artifacts: DirectorProjectArtifacts,
  options: {
    readonly format: DirectorFormat;
    readonly host?: DirectorTask["host"];
    readonly provider?: DirectorTask["provider"];
  },
): DirectorTask {
  const project = artifacts.project;
  const researchCandidates = (artifacts.research?.mediaCandidates ?? []).map((candidate) => ({
    id: candidate.id,
    mediaClass: mapMediaClass(candidate.mediaType),
    origin: "REAL" as const,
    title: candidate.title,
    subjects: candidate.queryTerms,
    sourceUrl: candidate.sourceUrl,
    sourceOrganization: candidate.provider,
    sourceQuality: "UNKNOWN" as const,
    license: candidate.license,
    attribution: candidate.attribution,
    width: candidate.width,
    height: candidate.height,
    durationSeconds: candidate.durationSeconds,
    segmentStartSeconds: candidate.segmentStartSeconds,
    segmentEndSeconds: candidate.segmentEndSeconds,
    // Discovery is reference evidence. A search hit is not a downloaded asset.
    availableForProduction: false,
  } satisfies DirectorMediaCandidate));
  const assetCandidates = (artifacts.assets?.assets ?? [])
    .filter((asset) => asset.type === "image" || asset.type === "video")
    .map(assetToCandidate);
  const visualByScene = new Map(artifacts.visuals?.scenes.map((scene) => [scene.sceneId, scene]) ?? []);
  const motionByScene = new Map(artifacts.animation?.scenes.map((scene) => [scene.sceneId, scene]) ?? []);
  const chapterById = new Map(artifacts.script?.chapters.map((chapter) => [chapter.id, chapter]) ?? []);
  const scenesPerChapter = new Map<number, number>();
  for (const scene of artifacts.scenes?.scenes ?? []) {
    if (scene.chapterId !== undefined) {
      scenesPerChapter.set(scene.chapterId, (scenesPerChapter.get(scene.chapterId) ?? 0) + 1);
    }
  }
  const scenes: DirectorScene[] = (artifacts.scenes?.scenes ?? []).map((scene, index) => {
    const visual = visualByScene.get(scene.id);
    const motion = motionByScene.get(scene.id);
    const chapter = scene.chapterId === undefined ? undefined : chapterById.get(scene.chapterId);
    return {
      id: scene.id,
      title: scene.title,
      // The old SceneItem schema contains description, not explicit purpose.
      purpose: undefined,
      // Chapter narration spans all of its scenes, so it is scene-level
      // evidence only when the chapter has exactly one scene.
      narration: chapter && scenesPerChapter.get(chapter.id) === 1 ? chapter.narration : undefined,
      visualObjective: visual?.visualPrompt ?? scene.visualPrompt,
      targetDurationSeconds: scene.duration,
      chronologyIndex: index + 1,
      selectedCandidateId: motion?.sourceImageAssetId,
      motion: mapMotion(motion?.motionType),
      audioStatus: chapter
        ? hasReadyAudioForChapter(artifacts.audio, chapter.id) ? "READY" : "UNKNOWN"
        : "UNKNOWN",
      // Old artifacts do not encode scene-level factual citations or labels.
      requiredEvidence: options.format === "DOCUMENTARY",
      sourceReferences: undefined,
      reconstructionLabeled: false,
    };
  });
  return {
    projectId: project.id,
    topic: artifacts.research?.topic ?? project.title,
    format: options.format,
    audience: artifacts.script?.targetAudience,
    objective: undefined,
    tone: artifacts.script?.voiceStyle,
    targetDurationSeconds: artifacts.script?.estimatedDuration,
    scenes,
    candidates: [...assetCandidates, ...researchCandidates],
    host: options.host ?? { ffmpeg: "UNKNOWN", ffprobe: "UNKNOWN" },
    provider: options.provider ?? "UNKNOWN",
  };
}

function mapMediaClass(mediaType: MediaType | undefined): DirectorMediaClass {
  switch (mediaType) {
    case "video": return "REAL_VIDEO";
    case "archive": return "ARCHIVAL_PHOTO";
    case "map": return "MAP";
    case "document": return "DOCUMENT";
    case "ai-image": return "GENERATED_IMAGE";
    default: return "REAL_PHOTO";
  }
}

function assetToCandidate(asset: Asset): DirectorMediaCandidate {
  const origin = asset.mediaOrigin === "real" || asset.provider === "real"
    ? "REAL" as const
    : asset.mediaOrigin === "ai" || ["openai", "mock", "local"].includes(asset.provider)
      ? "GENERATED" as const : "UNKNOWN" as const;
  return {
    id: asset.id,
    mediaClass: origin === "GENERATED" ? "GENERATED_IMAGE" : mapMediaClass(asset.mediaType),
    origin,
    title: asset.prompt || asset.id,
    sourceUrl: asset.sourceUrl,
    sourceOrganization: asset.sourceName,
    sourceQuality: "UNKNOWN",
    license: asset.license,
    attribution: asset.attribution,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    segmentStartSeconds: asset.segmentStartSeconds,
    segmentEndSeconds: asset.segmentEndSeconds,
    availableForProduction: asset.status === "generated"
      && asset.provider !== "mock" && Boolean(asset.filePath),
  };
}

function mapMotion(value: string | undefined): DirectorScene["motion"] {
  switch (value) {
    case "static": return "STATIC_HOLD";
    case "zoom-in": return "SLOW_PUSH";
    case "zoom-out": return "REVEAL";
    case "pan-left":
    case "pan-right": return "PAN";
    default: return undefined;
  }
}

function hasReadyAudioForChapter(audio: AudioData | null | undefined, chapterId: number): boolean {
  return Boolean(audio?.sections.some((section) =>
    section.chapterId === chapterId && section.status === "generated"
      && section.outputAssetId));
}
