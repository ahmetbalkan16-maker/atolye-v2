import type { VideoData, VideoScene } from "@/types/video";

const statuses = new Set(["planned", "generating", "generated", "failed"]);

export function isCompatibleVideoData(value: unknown): value is VideoData {
  if (!value || typeof value !== "object") return false;
  const data = value as VideoData;
  if (
    !nonEmpty(data.projectId) ||
    !nonEmpty(data.createdAt) ||
    !Array.isArray(data.scenes)
  ) {
    return false;
  }
  const fullV2 = data.schemaVersion === "2" && data.artifactType === "scene-video";
  const hasMarker = data.schemaVersion !== undefined || data.artifactType !== undefined;
  if (hasMarker && !fullV2) return false;
  if (fullV2 && data.scenes.length === 0) return false;

  const sceneIds = new Set<number>();
  const videoIds = new Set<string>();
  for (const scene of data.scenes) {
    const isV2 = isSceneVideoScene(scene);
    if (fullV2 ? !isV2 : hasSceneVideoFields(scene) ? !isV2 : !isLegacyScene(scene)) {
      return false;
    }
    if (sceneIds.has(scene.sceneId)) return false;
    sceneIds.add(scene.sceneId);
    if (isV2) {
      if (videoIds.has(scene.videoAssetId)) return false;
      videoIds.add(scene.videoAssetId);
    }
  }
  return statuses.has(data.status);
}

export function isSceneVideoScene(value: unknown): value is VideoScene & {
  sourceImageAssetId: string;
  animationAssetId: string;
  videoAssetId: string;
  outputAssetId: string;
  durationSeconds: number;
  filePath: string;
  url: string;
  mimeType: "video/mp4" | "video/mock";
  byteLength: number;
  width: number;
  height: number;
  frameRate: number;
  generationMode: "mock" | "production";
  artifactType: "scene-video";
  status: "generated";
} {
  if (!isLegacyScene(value)) return false;
  const scene = value as VideoScene;
  if (
    scene.artifactType !== "scene-video" ||
    scene.sceneId <= 0 ||
    !nonEmpty(scene.sourceImageAssetId) ||
    !nonEmpty(scene.animationAssetId) ||
    !nonEmpty(scene.sourceAnimationAssetId) ||
    scene.sourceAnimationAssetId !== scene.animationAssetId ||
    !nonEmpty(scene.videoAssetId) ||
    scene.outputAssetId !== scene.videoAssetId ||
    !finitePositive(scene.durationSeconds) ||
    scene.frameRate !== 30 ||
    !nonEmpty(scene.transition) ||
    !safeProvider(scene.provider) ||
    scene.status !== "generated"
  ) {
    return false;
  }
  if (scene.generationMode === "mock") {
    return (
      scene.provider === "mock" &&
      scene.filePath === "" &&
      scene.url === "" &&
      scene.mimeType === "video/mock" &&
      scene.byteLength === 0 &&
      scene.width === 0 &&
      scene.height === 0
    );
  }
  return (
    scene.generationMode === "production" &&
    scene.provider === "ffmpeg" &&
    nonEmpty(scene.filePath) &&
    nonEmpty(scene.url) &&
    scene.mimeType === "video/mp4" &&
    Number.isSafeInteger(scene.byteLength) &&
    (scene.byteLength as number) > 0 &&
    scene.width === 1920 &&
    scene.height === 1080
  );
}

function isLegacyScene(value: unknown): value is VideoScene {
  if (!value || typeof value !== "object") return false;
  const scene = value as VideoScene;
  return (
    Number.isSafeInteger(scene.sceneId) &&
    scene.sceneId >= 0 &&
    typeof scene.sourceAnimationAssetId === "string" &&
    statuses.has(scene.status)
  );
}

function hasSceneVideoFields(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const scene = value as VideoScene;
  return (
    scene.artifactType !== undefined ||
    scene.sourceImageAssetId !== undefined ||
    scene.animationAssetId !== undefined ||
    scene.videoAssetId !== undefined ||
    scene.generationMode !== undefined ||
    scene.mimeType !== undefined ||
    scene.byteLength !== undefined ||
    scene.width !== undefined ||
    scene.height !== undefined ||
    scene.frameRate !== undefined
  );
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function safeProvider(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-_]+$/.test(value);
}
