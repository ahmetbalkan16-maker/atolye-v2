/**
 * Documentary pipeline V2 (Faz 2a): many-short-shot assembly renders correctly.
 *
 * Multi-shot produces ~10-18 short scenes instead of ~5 long ones. This suite
 * runs the REAL local FFmpeg assembly provider (no API cost) over a 14-shot
 * timeline and checks the two things that could break at that scene count:
 *
 *  1. an all-"cut" timeline stays on the zero-blend plain-concat path and the
 *     rendered duration equals the sum of shot durations (no narration lost);
 *  2. a mixed timeline (a crossfade only at each "chapter" boundary, cuts
 *     everywhere else) loses at most (blends x MAX_BLEND) and never runs away
 *     short - i.e. slow dissolves between many short shots cannot eat the
 *     narration.
 *
 * Output contract (1920x1080, h264 + aac, 30 fps) is asserted from ffprobe.
 */
import assert from "node:assert/strict";
import { createMediaSmokePng } from "./lib/MediaSmokePng";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  withCanonicalSmokeRuntime,
  type CanonicalSmokeRuntime,
} from "./lib/CanonicalSmokeRuntime";
import {
  FFmpegVideoAssemblyProvider,
  MAX_BLEND_SECONDS,
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
function wav(seconds: number, hz = 330): Buffer {
  const rate = 24000;
  const n = Math.max(1, Math.floor(rate * seconds));
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

/**
 * A valid 64x64 PNG independent of owner project data and checkout contents.
 */
function samplePng(): Buffer {
  return createMediaSmokePng();
}

function probe(ffprobe: string, file: string) {
  const out = execFileSync(
    ffprobe,
    [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate",
      "-of", "json",
      file,
    ],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out) as {
    format: { duration: string };
    streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; avg_frame_rate?: string }>;
  };
  const video = parsed.streams.find((s) => s.codec_type === "video")!;
  const audio = parsed.streams.find((s) => s.codec_type === "audio")!;
  return {
    duration: Number(parsed.format.duration),
    video,
    audio,
  };
}

async function run() {
  const ffmpeg = process.env.FFMPEG_PATH || bin("ffmpeg");
  const ffprobe = process.env.FFPROBE_PATH || bin("ffprobe");

  await withCanonicalSmokeRuntime(
    {
      name: "smoke-multi-shot-assembly-render",
      configureProductionExecution: true,
      environment: { VIDEO_ASSEMBLY_PROVIDER: "ffmpeg", FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe },
    },
    async (runtime: CanonicalSmokeRuntime) => {
      const provider = new FFmpegVideoAssemblyProvider(undefined, runtime.runtimeStorageContext);
      const projDir = path.join(runtime.runtimeStorageContext.projectsRoot, runtime.projectSlug);
      const imagesDir = path.join(projDir, "assets", "images");
      const audioDir = path.join(projDir, "assets", "audio");
      fs.mkdirSync(imagesDir, { recursive: true });
      fs.mkdirSync(audioDir, { recursive: true });

      const SHOTS = 14;
      const SHOT_SECONDS = 0.45;
      const total = SHOTS * SHOT_SECONDS;
      const videosDir = path.join(projDir, "assets", "videos");
      fs.mkdirSync(videosDir, { recursive: true });

      const scenesFor = (transitions: (AnimationTransitionType | undefined)[]) => {
        const scenes: VideoAssemblyInput["scenes"] = [];
        for (let i = 0; i < SHOTS; i += 1) {
          const img = path.join(imagesDir, `s${i}.png`);
          const aud = path.join(audioDir, `s${i}.wav`);
          fs.writeFileSync(img, samplePng());
          fs.writeFileSync(aud, wav(SHOT_SECONDS, 300 + i * 10));
          scenes.push({
            inputType: "image",
            sceneId: i + 1,
            chapterId: Math.floor(i / 3) + 1,
            imageFilePath: `data/projects/${runtime.projectSlug}/assets/images/s${i}.png`,
            audioFilePath: `data/projects/${runtime.projectSlug}/assets/audio/s${i}.wav`,
            durationSeconds: SHOT_SECONDS,
            transition: transitions[i],
          });
        }
        return scenes;
      };

      const absOut = (filePath: string) =>
        path.join(runtime.runtimeStorageContext.projectsRoot, runtime.projectSlug, "assets", "videos", path.basename(filePath));

      // Scenario 1: all cuts -> plain concat, exact duration, no narration lost
      const allCuts = scenesFor(new Array(SHOTS).fill("cut"));
      const r1 = await provider.assemble({ projectSlug: runtime.projectSlug, scenes: allCuts });
      assert.equal(r1.success, true, JSON.stringify(r1));
      if (!r1.success || r1.provider !== "ffmpeg") throw new Error("expected ffmpeg success");
      const p1 = probe(ffprobe, absOut(r1.filePath));
      assert.equal(p1.video.codec_name, "h264", "assert.equal(p1.video.codec_name, \"h264\")");
      assert.equal(p1.video.width, 1920, "assert.equal(p1.video.width, 1920)");
      assert.equal(p1.video.height, 1080, "assert.equal(p1.video.height, 1080)");
      assert.equal(p1.video.avg_frame_rate, "30/1", "assert.equal(p1.video.avg_frame_rate, \"30/1\")");
      assert.equal(p1.audio.codec_name, "aac", "assert.equal(p1.audio.codec_name, \"aac\")");
      // all-cut -> plain concat -> full narration timeline preserved (a small
      // positive frame-rounding excess is expected, never a shortfall).
      assert.ok(
        p1.duration >= total - 0.1 && p1.duration <= total + 0.6,
        `all-cut ${SHOTS} shots: expected ~${total}s (no narration lost), got ${p1.duration}s`,
      );
      count += 1;
      if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: all-cut 14-shot render preserves the full timeline (${p1.duration.toFixed(3)}s vs ${total}s)`);

      // Scenario 2: crossfade only at each chapter boundary (i % 3 === 0, i>0), cuts elsewhere
      const mixed = scenesFor(
        Array.from({ length: SHOTS }, (_, i) =>
          i > 0 && i % 3 === 0 ? ("crossfade" as const) : ("cut" as const),
        ),
      );
      const blendJunctions = Array.from({ length: SHOTS }, (_, i) => i > 0 && i % 3 === 0).filter(Boolean).length;
      const r2 = await provider.assemble({ projectSlug: runtime.projectSlug, scenes: mixed });
      assert.equal(r2.success, true, JSON.stringify(r2));
      if (!r2.success || r2.provider !== "ffmpeg") throw new Error("expected ffmpeg success");
      const p2 = probe(ffprobe, absOut(r2.filePath));
      assert.equal(p2.video.width, 1920, "assert.equal(p2.video.width, 1920)");
      assert.equal(p2.video.height, 1080, "assert.equal(p2.video.height, 1080)");
      assert.equal(p2.video.codec_name, "h264", "assert.equal(p2.video.codec_name, \"h264\")");
      assert.equal(p2.audio.codec_name, "aac", "assert.equal(p2.audio.codec_name, \"aac\")");
      // The invariant: a dissolve at a junction shortens the timeline by at most
      // MAX_BLEND_SECONDS, so N dissolves lose at most N * MAX_BLEND vs the
      // all-cut baseline - the loss is bounded and cannot run away no matter how
      // many short shots there are.
      const loss = p1.duration - p2.duration;
      const maxLoss = blendJunctions * MAX_BLEND_SECONDS + 0.4; // + one frame margin
      assert.ok(
        loss >= -0.1 && loss <= maxLoss,
        `mixed timeline: ${blendJunctions} dissolves lost ${loss.toFixed(3)}s vs all-cut; bound is ${maxLoss.toFixed(2)}s`,
      );
      count += 1;
      if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: mixed 14-shot render loses a bounded ${loss.toFixed(3)}s to ${blendJunctions} dissolves (<= ${maxLoss.toFixed(2)}s)`);
    },
  );

  console.log(`Multi-shot assembly render smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "multi-shot-assembly-render", scenarios: count }));
}

run().catch((error) => {
  console.error("Multi-shot assembly render smoke FAILED:", error);
  process.exitCode = 1;
});
