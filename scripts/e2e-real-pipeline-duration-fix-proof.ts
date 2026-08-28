/**
 * §7 REAL, non-mock end-to-end proof for the F-08/F-02 duration-authority
 * fix: runs `ProductionAcceptanceOrchestrator.run()` (the same
 * strict/production-acceptance path `npm run production:acceptance:execute`
 * drives, and the one the real, protected `i-stanbul-un-fethi-1453` project
 * was itself built through) on a brand-new, previously-nonexistent project,
 * with REAL providers resolved from the current environment (OpenAI
 * text/image/TTS/animation, local FFmpeg for scene-video + final assembly)
 * -- no mocks, no isolated/ephemeral runtime root. The resulting project is
 * a real, persistent `data/projects/<slug>/` directory, safe to inspect
 * afterward exactly like any other project in this repo.
 *
 * (An earlier version of this script drove the plainer
 * `PipelineRunner.run()` entry point directly; that path uses the
 * non-strict/legacy scene-generation prompt, which -- independently of
 * F-08/F-02 -- creates extra opening/closing "bonus" scenes beyond the
 * script's chapter count. VideoAssemblyManager's legacy (no-chapterId)
 * identity validation assumes scene count == chapter count, so that
 * combination fails at assembly's very first validation step, before this
 * fix's own code ever runs. That is a real, pre-existing, unrelated gap in
 * the legacy scene-planning path -- not something F-08/F-02 should touch --
 * and is exactly why this script now uses the strict/production-acceptance
 * path instead, which ties scenes to chapters 1:1 via chapterId and is also
 * the more representative "real production" path.)
 *
 * Never touches i-stanbul-un-fethi-1453 or any other existing project: the
 * topic below is chosen specifically to be new and distinct, and this script
 * aborts before doing anything if a project with the same slug already
 * exists.
 *
 * Safe from any real external YouTube upload regardless of
 * YOUTUBE_PROVIDER/credentials in the environment: the production-acceptance
 * completion report's `published` field is a hardcoded `false` literal type
 * (`ProductionAcceptancePolicy.ts`: `youtubePublishMode: "package-only"` is
 * the only value ever produced) -- this path is structurally incapable of
 * publishing, not just configured not to.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { initializeProductionProcessRuntime } from "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import { ProductionAcceptanceOrchestrator } from "../src/lib/production/ProductionAcceptanceOrchestrator";
import { ProjectManager } from "../src/lib/projects/ProjectManager";

const TOPIC = "Anitkabir.nin Insa Sureci";
const slug = ProjectManager.createSlug(TOPIC);
const projectDir = path.join(process.cwd(), "data", "projects", slug);
const ffprobePath = process.env.FFPROBE_PATH || process.env.FFPROBE_EXECUTABLE || "";

async function main() {
  if (fs.existsSync(projectDir)) {
    console.error(
      `ABORT: ${projectDir} already exists. This script only ever runs against a brand-new project ` +
        `(never i-stanbul-un-fethi-1453 or any other existing one). Pick a different TOPIC or remove ` +
        `the stale directory yourself before re-running.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`=== §7 REAL pipeline + REAL FFmpeg proof (strict/production-acceptance path) ===`);
  console.log(`Topic: "${TOPIC}"  ->  slug: "${slug}"`);
  console.log(`Providers (from environment): AI_PROVIDER=${process.env.AI_PROVIDER} IMAGE_PROVIDER=${process.env.IMAGE_PROVIDER} AUDIO_PROVIDER=${process.env.AUDIO_PROVIDER} ANIMATION_PROVIDER=${process.env.ANIMATION_PROVIDER} VIDEO_PROVIDER=${process.env.VIDEO_PROVIDER} VIDEO_ASSEMBLY_PROVIDER=${process.env.VIDEO_ASSEMBLY_PROVIDER}`);
  console.log(`This path cannot perform a real external YouTube upload (see file header).\n`);

  // Mirrors instrumentation.ts's boot-time register() hook: a real `next
  // dev`/`next start` process does this once at server startup. A bare
  // `tsx` script never runs that hook, so this script does it explicitly
  // instead, against the same real default runtime storage root
  // (createRuntimeStorageContext() with no override).
  await initializeProductionProcessRuntime();

  const startedAt = Date.now();
  const result = await ProductionAcceptanceOrchestrator.run({ topic: TOPIC });
  const elapsedSeconds = (Date.now() - startedAt) / 1000;

  console.log(`ProductionAcceptanceOrchestrator.run() completed: projectSlug=${result.completion.projectSlug} productionReady=${result.completion.productionReady} published=${result.completion.published} sceneCount=${result.completion.sceneCount} imageCount=${result.completion.imageCount} providerCalls=${result.completion.providerCalls} retryCount=${result.completion.retryCount} warnings=${JSON.stringify(result.completion.warnings)} (${elapsedSeconds.toFixed(1)}s wall time)\n`);

  // The orchestrator may uniquify the slug (e.g. if a prior partial attempt
  // under the same topic-derived slug was ever seen) -- always resolve the
  // actual persisted directory from its own reported projectSlug rather
  // than the pre-flight guess above.
  const actualProjectDir = path.join(process.cwd(), "data", "projects", result.completion.projectSlug);
  if (result.completion.projectSlug !== slug) {
    console.log(`Note: actual project slug ("${result.completion.projectSlug}") differs from the requested one ("${slug}") -- using the actual directory for all reads below.\n`);
  }

  // ===== Persisted script.json (post-NarrationDurationEstimator reconciliation) =====
  const script = JSON.parse(fs.readFileSync(path.join(actualProjectDir, "script.json"), "utf-8")) as {
    estimatedDuration: number;
    narrationWordCount: number;
    chapters: Array<{ id: number; duration: number; narration: string }>;
  };
  console.log("=== Persisted script.json chapter durations (NarrationDurationEstimator-reconciled) ===");
  console.log(`estimatedDuration total: ${script.estimatedDuration}s (preserved, unchanged by reconciliation -- see docs/DURATION_AUTHORITY.md); narrationWordCount: ${script.narrationWordCount} (recomputed, real count)`);
  console.log("chapterId | narration chars | reconciled duration | chars/duration ratio (should be ~constant across chapters if reconciliation is proportional)");
  for (const chapter of script.chapters) {
    const chars = chapter.narration.trim().length;
    console.log(`${chapter.id}         | ${String(chars).padStart(6)}          | ${chapter.duration.toFixed(2)}s              | ${(chars / chapter.duration).toFixed(2)}`);
  }

  // ===== Real measured audio (TTS) durations =====
  const audio = JSON.parse(fs.readFileSync(path.join(actualProjectDir, "audio.json"), "utf-8")) as {
    sections: Array<{ chapterId: number; durationSeconds: number }>;
    production: { durationSeconds?: number };
  };
  const narrationTotal = audio.sections.reduce((sum, s) => sum + s.durationSeconds, 0);
  console.log(`\n=== Real, TTS-measured narration duration ===`);
  console.log(`Per chapter: ${audio.sections.map((s) => `ch${s.chapterId}=${s.durationSeconds.toFixed(2)}s`).join(", ")}`);
  console.log(`Total narration (sum of chapters): ${narrationTotal.toFixed(2)}s`);

  // ===== Video source (pre-tpad) durations vs assembly.json quality metrics =====
  const video = JSON.parse(fs.readFileSync(path.join(actualProjectDir, "video.json"), "utf-8")) as {
    scenes: Array<{ sceneId: number; durationSeconds: number }>;
  };
  const videoSourceTotal = video.scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  console.log(`\n=== Video source footage (pre-tpad, what was actually rendered per scene) ===`);
  console.log(`Per scene: ${video.scenes.map((s) => `s${s.sceneId}=${s.durationSeconds.toFixed(2)}s`).join(", ")}`);
  console.log(`Total video source footage: ${videoSourceTotal.toFixed(2)}s`);

  const assembly = JSON.parse(fs.readFileSync(path.join(actualProjectDir, "assembly.json"), "utf-8")) as {
    render?: {
      durationSeconds?: number;
      filePath?: string;
      quality?: {
        narrationDurationSeconds: number;
        videoDurationSeconds: number;
        coverageRatio: number;
        paddingDurationSeconds: number;
        paddingRatio: number;
        legitimatePaddingRatio: number;
      };
    };
  };
  console.log(`\n=== Final assembly quality gate report (assembly.json render.quality) ===`);
  console.log(JSON.stringify(assembly.render?.quality, null, 2));
  console.log(`Final rendered MP4 duration (assembly.json render.durationSeconds): ${assembly.render?.durationSeconds}s`);

  // ===== Real ffprobe technical inspection of the produced artifact =====
  const mp4Path = assembly.render?.filePath ? path.join(process.cwd(), assembly.render.filePath) : null;
  if (mp4Path && fs.existsSync(mp4Path) && ffprobePath) {
    const probe = JSON.parse(
      execFileSync(ffprobePath, [
        "-v", "error",
        "-show_entries", "format=format_name,duration,bit_rate,size:stream=codec_type,codec_name,width,height,avg_frame_rate,bit_rate,sample_rate,channels",
        "-of", "json", mp4Path,
      ], { encoding: "utf8" }),
    ) as {
      format: { format_name: string; duration: string; bit_rate: string; size: string };
      streams: Array<Record<string, unknown>>;
    };
    const v = probe.streams.find((s) => s.codec_type === "video");
    const a = probe.streams.find((s) => s.codec_type === "audio");
    console.log(`\n=== Real ffprobe technical inspection of the rendered MP4 ===`);
    console.log(`File: ${mp4Path}`);
    console.log(`Container: ${probe.format.format_name}, duration=${probe.format.duration}s, size=${probe.format.size} bytes, bitrate=${probe.format.bit_rate} bps`);
    console.log(`Video: codec=${v?.codec_name} ${v?.width}x${v?.height} @ ${v?.avg_frame_rate} fps, bitrate=${v?.bit_rate ?? "n/a"} bps`);
    console.log(`Audio: codec=${a?.codec_name} ${a?.sample_rate}Hz ${a?.channels}ch, bitrate=${a?.bit_rate ?? "n/a"} bps`);
    const videoDur = Number(v?.duration ?? probe.format.duration);
    const audioDur = Number(a?.duration ?? probe.format.duration);
    console.log(`Audio/video stream duration skew: ${Math.abs(videoDur - audioDur).toFixed(4)}s`);
  } else {
    console.log(`\n(ffprobe technical inspection skipped: mp4Path=${mp4Path} exists=${mp4Path ? fs.existsSync(mp4Path) : false} ffprobePath=${ffprobePath || "unset"})`);
  }

  console.log(`\n=== DONE. Project persisted at: ${actualProjectDir} ===`);
}

main().catch((error) => {
  console.error("§7 real pipeline proof FAILED:", error);
  process.exitCode = 1;
});
