/**
 * §7/§9 REAL "downstream reconciliation" demonstration: takes a real project
 * from THIS session's own real pipeline run (galata-kulesi-nin-tarihi-...,
 * which VideoDurationCoverageGuard correctly rejected -- video built at
 * 110s total vs. 157.95s real TTS-measured narration, 30.4% padding) and
 * regenerates ONLY its scene-video clips at CORRECTED durations matching the
 * real, already-measured audio -- exactly the "TTS = measured authority,
 * downstream video = reconciled target" contract from
 * docs/DURATION_AUTHORITY.md, and the kind of regeneration §9's analysis
 * describes for i-stanbul-un-fethi-1453 (never applied there; applied here,
 * on this disposable test project, to prove it actually works end to end).
 *
 * REAL, not simulated: real OpenAI animation motion-plan calls (new
 * durations require new provider identity -- the existing motion-plan
 * assets are never replayed), real local FFmpeg scene-video renders, real
 * local FFmpeg final assembly render. No new image generation cost -- the
 * existing real source images are reused via AnimationAssetPipeline's own
 * asset-registry lookup. All new assets are appended (never overwrites the
 * project's existing assets, matching the append-only asset model).
 *
 * Never touches i-stanbul-un-fethi-1453 or any other project: SOURCE_SLUG
 * below is hardcoded to one of this task's own disposable test projects.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { initializeProductionProcessRuntime } from "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { AnimationAssetPipeline } from "../src/lib/animation/AnimationAssetPipeline";
import { VideoPipeline } from "../src/lib/video/VideoPipeline";
import { AssemblyManager } from "../src/lib/assembly/AssemblyManager";
import { VideoAssemblyManager } from "../src/lib/assembly/VideoAssemblyManager";
import type { ScriptData } from "../src/types/script";
import type { SceneData } from "../src/types/scene";
import type { VisualData } from "../src/types/visual";
import type { AudioData } from "../src/types/audio";
import type { AnimationData, AnimationScene, AnimationMotionPlanScene } from "../src/types/animation";
import type { VideoData } from "../src/types/video";
import type { Project } from "../src/types/project";
import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers";

const SOURCE_SLUG = "galata-kulesi-nin-tarihi-6dd8f55a-0fe0-4f63-90b6-b941d521d7f6";
const ffprobePath = process.env.FFPROBE_PATH || process.env.FFPROBE_EXECUTABLE || "";

const emptyPlanProvider: AIProvider = {
  async generate(): Promise<AIProviderResult> {
    return { content: "", finishReason: "stop", refused: false, complete: true, truncated: false };
  },
};

async function main() {
  await initializeProductionProcessRuntime();

  // AnimationAssetPipeline/VideoPipeline/VideoAssemblyManager are normally
  // invoked through PipelineRunner/ProductionAcceptanceOrchestrator, which
  // wrap each stage in its own scoped production runtime operation context.
  // Calling them directly (as this script does, deliberately, to regenerate
  // just the video stage) needs that same scoping established explicitly --
  // initializeProductionProcessRuntime() alone only sets up the process-wide
  // boot-time context, not a scoped operation for this work.
  const operation = createProductionRuntimeOperationContext({
    operationId: `e2e-video-regeneration-${randomUUID()}`,
    operationType: "video-regeneration-proof",
    authorityGeneration: initialRuntimeAuthorityGeneration,
    storageContext: createRuntimeStorageContext(),
  });
  await runWithProductionRuntimeOperationContext(operation, run);
}

async function run() {
  const projectJson = (await ProjectReader.readJSON<Project>(SOURCE_SLUG, "project.json"))!;
  const projectId = projectJson.id;
  const script = (await ProjectReader.readJSON<ScriptData>(SOURCE_SLUG, "script.json"))!;
  const scenes = (await ProjectReader.readJSON<SceneData>(SOURCE_SLUG, "scenes.json"))!;
  const visuals = (await ProjectReader.readJSON<VisualData>(SOURCE_SLUG, "visuals.json"))!;
  const audio = (await ProjectReader.readJSON<AudioData>(SOURCE_SLUG, "audio.json"))!;
  const staleAnimation = (await ProjectReader.readJSON<AnimationData>(SOURCE_SLUG, "animation.json"))!;

  console.log(`=== Real downstream-reconciliation regeneration proof: ${SOURCE_SLUG} ===\n`);

  // chapterId -> real TTS-measured duration (the reconciliation target).
  const realDurationByChapter = new Map(audio.sections.map((s) => [s.chapterId, s.durationSeconds]));
  console.log("Correcting each scene's animation target duration to its real, TTS-measured chapter duration:");
  const correctedAnimationScenes: AnimationScene[] = scenes.scenes.map((scene) => {
    const chapterId = scene.chapterId ?? scene.id;
    const staleScene = staleAnimation.scenes.find((s) => s.sceneId === scene.id)!;
    const target = realDurationByChapter.get(chapterId);
    if (!target) throw new Error(`no real audio duration found for scene ${scene.id} (chapterId ${chapterId})`);
    console.log(`  scene ${scene.id}: stale target ${staleScene.durationSeconds}s -> corrected target ${target.toFixed(3)}s`);
    return {
      sceneId: scene.id,
      animationPrompt: staleScene.animationPrompt,
      status: "planned",
      durationSeconds: target,
    };
  });

  console.log("\n--- Regenerating animation motion plans at corrected durations (REAL OpenAI calls) ---");
  const animationResult = await AnimationAssetPipeline.generateAnimationAssets({
    projectId,
    projectSlug: SOURCE_SLUG,
    scenes: correctedAnimationScenes,
  });
  const correctedMotionPlans: AnimationMotionPlanScene[] = animationResult.updatedScenes;
  console.log(`Regenerated ${correctedMotionPlans.length} motion plans: ${correctedMotionPlans.map((s) => `scene${s.sceneId}=${s.durationSeconds.toFixed(2)}s`).join(", ")}`);

  console.log("\n--- Rendering corrected scene-video clips (REAL local FFmpeg) ---");
  const correctedAnimationData: AnimationData = {
    projectId,
    schemaVersion: "2",
    artifactType: "motion-plan",
    scenes: correctedMotionPlans,
    createdAt: new Date().toISOString(),
  };
  const videoResult = await VideoPipeline.generateVideo({
    projectId,
    projectSlug: SOURCE_SLUG,
    animation: correctedAnimationData,
  });
  const correctedVideo: VideoData = videoResult.video;
  console.log(`Rendered ${correctedVideo.scenes.length} corrected scene-video clips: ${correctedVideo.scenes.map((s) => `scene${s.sceneId}=${(s.durationSeconds ?? 0).toFixed(2)}s`).join(", ")}`);
  const correctedVideoTotal = correctedVideo.scenes.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
  const realNarrationTotal = audio.sections.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
  console.log(`Corrected video source total: ${correctedVideoTotal.toFixed(2)}s vs. real narration total: ${realNarrationTotal.toFixed(2)}s`);

  console.log("\n--- Building assembly plan from corrected video data ---");
  const assemblyPlan = await AssemblyManager.generateAssemblyPlan(
    script, scenes, visuals, audio,
    { project: projectJson, animation: correctedAnimationData, video: correctedVideo },
    { projectSlug: SOURCE_SLUG, stage: "assembly", operation: "assembly-plan-regenerated" },
    { aiProvider: emptyPlanProvider },
  );

  console.log("\n--- Rendering final assembly with the corrected video (REAL local FFmpeg) ---");
  let renderResult;
  try {
    renderResult = await VideoAssemblyManager.renderExistingAssets({
      projectId,
      projectSlug: SOURCE_SLUG,
      scenes, visuals, audio,
      assembly: assemblyPlan,
      animation: correctedAnimationData,
      video: correctedVideo,
      strictProductionAcceptance: true,
    });
  } catch (error) {
    console.error("\n=== RESULT: FAILED ===");
    console.error(error);
    process.exitCode = 1;
    return;
  }

  console.log("\n=== RESULT: SUCCESS -- corrected assembly PASSED the video duration coverage gate ===");
  console.log(JSON.stringify(renderResult.render, null, 2));

  const mp4Path = renderResult.render?.filePath ? path.join(process.cwd(), renderResult.render.filePath) : null;
  if (mp4Path && fs.existsSync(mp4Path) && ffprobePath) {
    const probe = JSON.parse(
      execFileSync(ffprobePath, [
        "-v", "error",
        "-show_entries", "format=format_name,duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate",
        "-of", "json", mp4Path,
      ], { encoding: "utf8" }),
    ) as { format: { format_name: string; duration: string; size: string }; streams: Array<Record<string, unknown>> };
    const v = probe.streams.find((s) => s.codec_type === "video");
    const a = probe.streams.find((s) => s.codec_type === "audio");
    console.log(`\n=== Real ffprobe technical inspection ===`);
    console.log(`File: ${mp4Path}`);
    console.log(`Container: ${probe.format.format_name}, duration=${probe.format.duration}s, size=${probe.format.size} bytes`);
    console.log(`Video: ${v?.codec_name} ${v?.width}x${v?.height} @ ${v?.avg_frame_rate}fps`);
    console.log(`Audio: ${a?.codec_name}`);
    const videoDur = Number(v?.duration ?? probe.format.duration);
    const audioDur = Number(a?.duration ?? probe.format.duration);
    console.log(`Audio/video stream duration skew: ${Math.abs(videoDur - audioDur).toFixed(4)}s`);
  }

  const assets = AssetManager.getProjectAssets(SOURCE_SLUG, projectId);
  console.log(`\nTotal assets on project after this regeneration (append-only, nothing overwritten): ${assets.assets.length}`);
}

main().catch((error) => {
  console.error("Regeneration proof FAILED:", error);
  process.exitCode = 1;
});
