/**
 * Regression: the chained-xfade assembly timeline must not collapse.
 *
 * Root-cause guard for the real `302ce03f` (Fatih Sultan Mehmet) production
 * VIDEO_ASSEMBLY_FAILED incident. A 15-scene scene-video assembly whose
 * junctions were blended (fade/crossfade, plus "cut" junctions that still get
 * a single-frame xfade inside an otherwise-blended sequence) rendered as
 * 37.600000s instead of ~96s and failed validateProbe() with a ~59s A/V skew.
 *
 * Cause: buildTransitionedConcatArgs() placed every xfade `offset` exactly
 * `blend` seconds before a `cumulative` running total summed from exact,
 * non-frame-aligned narration seconds — zero margin. Once the real
 * frame-quantized accumulated stream fell a fraction of a frame short of
 * `cumulative`, ffmpeg's xfade hit EOF on its first input mid-transition and
 * terminated the ENTIRE filter graph, silently dropping every downstream
 * scene. "cut" junctions (1-frame blend) had essentially no slack, so the
 * collapse triggered after ~6 scenes.
 *
 * Fix: planTransitionedTimeline() plans the whole chain on the integer-frame
 * grid, every per-scene stream is forced to an exact frame count
 * (`trim=end_frame`), and each xfade offset keeps a deterministic 1-frame
 * safety margin.
 *
 * This suite runs the REAL local FFmpeg assembly provider (no API cost) over
 * a 15-scene, 30fps, fractional-narration timeline in two shapes — all
 * fade/crossfade, and the exact 5-fade/9-cut mix that collapsed in
 * production — and asserts ffmpeg exit 0, a real video stream, a video
 * duration close to the frame-exact expected value (NOT ~37.6s), and A/V
 * skew within one second.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  withCanonicalSmokeRuntime,
  type CanonicalSmokeRuntime,
} from "./lib/CanonicalSmokeRuntime";
import { emitSmokeResult } from "./lib/SmokeResult";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import {
  FFmpegVideoAssemblyProvider,
  FPS,
} from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import type { AnimationTransitionType } from "../src/types/animation";
import type { VideoAssemblyInput } from "../src/types/videoAssembly";

let count = 0;

function bin(name: string): string {
  try {
    const out = execFileSync("where.exe", [name], { encoding: "utf8" });
    const first = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
    if (first) return first;
  } catch {
    /* ignore */
  }
  return name;
}

/** Minimal mono 16-bit PCM WAV of the requested length. */
function wav(seconds: number, hz = 320): Buffer {
  const rate = 24000;
  const n = Math.max(1, Math.round(rate * seconds));
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i += 1) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 8000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function probeOutput(ffprobe: string, file: string) {
  const out = execFileSync(
    ffprobe,
    [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,duration",
      "-of", "json",
      file,
    ],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out) as {
    format: { duration: string };
    streams: Array<{
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      duration?: string;
    }>;
  };
  const video = parsed.streams.find((s) => s.codec_type === "video");
  const audio = parsed.streams.find((s) => s.codec_type === "audio");
  return {
    containerDuration: Number(parsed.format.duration),
    video,
    audio,
    videoDuration: Number(video?.duration),
    audioDuration: Number(audio?.duration),
  };
}

// The real 302ce03f timeline: 15 scenes, integer clip lengths, fractional
// TTS-reconciled narration durations.
const CLIP_SECONDS = [6, 6, 6, 6, 6, 7, 6, 7, 7, 7, 6, 7, 7, 6, 7];
const NARRATION_SECONDS = [
  6.4708, 6.4708, 6.4708, 6.0987, 6.0987, 7.1151, 5.9737, 6.9694,
  6.9694, 7.1487, 6.1275, 7.1487, 7.0131, 6.0113, 7.0131,
];

/** Mirror of planTransitionedTimeline()/blendFramesFor() for the expectation. */
function expectedRenderedSeconds(transitions: readonly AnimationTransitionType[]): number {
  const sceneFrames = NARRATION_SECONDS.map((s) => Math.max(1, Math.round(s * FPS)));
  const blendFrames = (t: AnimationTransitionType, fa: number, fb: number) => {
    const target = t === "cut" ? 1 / FPS : 0.5;
    const seconds = Math.max(0.01, Math.min(target, (fa / FPS) * 0.4, (fb / FPS) * 0.4));
    return Math.max(1, Math.round(seconds * FPS));
  };
  let accumulated = sceneFrames[0];
  for (let i = 1; i < sceneFrames.length; i += 1) {
    const bf = blendFrames(transitions[i], sceneFrames[i - 1], sceneFrames[i]);
    const offset = Math.max(0, accumulated - bf - 1);
    accumulated = offset + sceneFrames[i];
  }
  return accumulated / FPS;
}

async function renderAndCheck(
  runtime: CanonicalSmokeRuntime,
  ffmpeg: string,
  ffprobe: string,
  label: string,
  transitions: readonly AnimationTransitionType[],
) {
  const slug = runtime.projectSlug;
  const projectsRoot = runtime.runtimeStorageContext.projectsRoot;
  const context = runtime.runtimeStorageContext;

  const scenes: VideoAssemblyInput["scenes"] = [];
  for (let i = 0; i < NARRATION_SECONDS.length; i += 1) {
    const sceneId = i + 1;
    const clipSeconds = CLIP_SECONDS[i];
    const narrationDurationSeconds = NARRATION_SECONDS[i];

    // Real 1920x1080 h264 yuv420p 30fps scene clip, no audio track — every
    // clip rendered identically so validateSceneInputProbe()'s cross-scene
    // signature check passes.
    const paths = VideoStorage.createSceneRenderPaths(slug, sceneId, context);
    execFileSync(
      ffmpeg,
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi",
        "-i", `testsrc2=size=1920x1080:rate=30:duration=${clipSeconds}`,
        "-c:v", "libx264", "-preset", "ultrafast", "-profile:v", "high",
        "-pix_fmt", "yuv420p", "-an",
        paths.temporaryAbsolutePath,
      ],
      { encoding: "utf8" },
    );
    VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath, context);
    const byteLength = fs.statSync(
      path.join(projectsRoot, slug, "assets", "videos", path.basename(paths.filePath)),
    ).size;

    const audio = AudioStorage.saveAudio({
      projectSlug: slug,
      data: wav(narrationDurationSeconds, 300 + i * 7),
    });

    scenes.push({
      inputType: "scene-video",
      sceneId,
      videoAssetId: `video-${sceneId}`,
      sourceImageAssetId: `image-${sceneId}`,
      animationAssetId: `animation-${sceneId}`,
      filePath: paths.filePath,
      url: paths.url,
      durationSeconds: clipSeconds,
      narrationDurationSeconds,
      byteLength,
      provider: "ffmpeg",
      generationMode: "production",
      status: "generated",
      audioFilePath: audio.filePath,
      transition: transitions[i],
    });
  }

  const provider = new FFmpegVideoAssemblyProvider(undefined, context);
  const result = await provider.assemble({ projectSlug: slug, scenes });

  // result.success === true already means: ffmpeg exited 0 AND the provider's
  // own validateProbe() (duration + A/V skew + codec/dimension) accepted the
  // output. The collapse used to surface right here as success === false.
  assert.equal(
    result.success,
    true,
    `[${label}] assemble() failed: ${JSON.stringify(result)}`,
  );
  if (!result.success || result.provider !== "ffmpeg") {
    throw new Error(`[${label}] expected a real ffmpeg render`);
  }

  const outPath = path.join(
    projectsRoot, slug, "assets", "videos", path.basename(result.filePath),
  );
  assert.ok(fs.existsSync(outPath) && fs.statSync(outPath).size > 0, `[${label}] output file missing`);

  const p = probeOutput(ffprobe, outPath);
  assert.ok(p.video, `[${label}] no video stream in output`);
  assert.equal(p.video?.codec_name, "h264", `[${label}] video codec`);
  assert.equal(p.video?.width, 1920, `[${label}] video width`);
  assert.equal(p.video?.height, 1080, `[${label}] video height`);
  assert.equal(p.video?.avg_frame_rate, "30/1", `[${label}] video fps`);
  assert.ok(p.audio, `[${label}] no audio stream in output`);
  assert.equal(p.audio?.codec_name, "aac", `[${label}] audio codec`);

  const expected = expectedRenderedSeconds(transitions);

  // The whole point: NOT the 37.6s (or ~38.5s all-cut) collapse.
  assert.ok(
    p.videoDuration > 80,
    `[${label}] video stream duration ${p.videoDuration}s collapsed (expected ~${expected.toFixed(2)}s)`,
  );
  assert.ok(
    Math.abs(p.videoDuration - 37.6) > 10 && Math.abs(p.videoDuration - 38.53) > 10,
    `[${label}] video stream duration ${p.videoDuration}s matches a known collapse signature`,
  );
  // Close to the frame-exact planned length.
  assert.ok(
    Math.abs(p.videoDuration - expected) <= 1.0,
    `[${label}] video stream duration ${p.videoDuration}s vs expected ${expected.toFixed(3)}s`,
  );
  assert.ok(
    Math.abs(p.containerDuration - expected) <= 1.5,
    `[${label}] container duration ${p.containerDuration}s vs expected ${expected.toFixed(3)}s`,
  );

  // A/V skew bounded well under a second.
  const skew = Math.abs(p.videoDuration - p.audioDuration);
  assert.ok(
    skew <= 1.0,
    `[${label}] A/V skew ${skew.toFixed(4)}s exceeds 1.0s (video ${p.videoDuration}s, audio ${p.audioDuration}s)`,
  );

  count += 1;
  if (process.env.SMOKE_TRACE === "1") {
    console.log(
      `PASS ${count}: ${label} -> video ${p.videoDuration.toFixed(3)}s / audio ` +
        `${p.audioDuration.toFixed(3)}s (expected ${expected.toFixed(3)}s, skew ${skew.toFixed(3)}s)`,
    );
  }
}

async function run() {
  const ffmpeg = process.env.FFMPEG_PATH || bin("ffmpeg");
  const ffprobe = process.env.FFPROBE_PATH || bin("ffprobe");

  // Scenario 1: every junction blended (fade, with a crossfade at two
  // "chapter" boundaries) — a fully chained xfade, no "cut" break anywhere.
  await withCanonicalSmokeRuntime(
    {
      name: "smoke-assembly-xfade-chain-timeline-allfade",
      configureProductionExecution: true,
      environment: { VIDEO_ASSEMBLY_PROVIDER: "ffmpeg", FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe },
    },
    async (runtime) => {
      const transitions = NARRATION_SECONDS.map((_, i) =>
        i === 5 || i === 10 ? ("crossfade" as const) : ("fade" as const),
      );
      await renderAndCheck(runtime, ffmpeg, ffprobe, "15-scene all fade/crossfade", transitions);
    },
  );

  // Scenario 2: the exact production mix — 5 fade junctions, 9 "cut"
  // junctions (each a single-frame xfade inside the blended path). This is
  // the shape that rendered as 37.600000s pre-fix.
  await withCanonicalSmokeRuntime(
    {
      name: "smoke-assembly-xfade-chain-timeline-mixed",
      configureProductionExecution: true,
      environment: { VIDEO_ASSEMBLY_PROVIDER: "ffmpeg", FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe },
    },
    async (runtime) => {
      const fadeAt = new Set([1, 4, 7, 10, 13]);
      const transitions = NARRATION_SECONDS.map((_, i) =>
        i > 0 && fadeAt.has(i) ? ("fade" as const) : ("cut" as const),
      );
      await renderAndCheck(runtime, ffmpeg, ffprobe, "15-scene 5-fade / 9-cut (production mix)", transitions);
    },
  );

  emitSmokeResult("assembly-xfade-chain-timeline", count);
  console.log(`Assembly xfade-chain timeline smoke: PASS (${count} scenarios)`);
}

run().catch((error) => {
  console.error("Assembly xfade-chain timeline smoke FAILED:", error);
  process.exitCode = 1;
});
