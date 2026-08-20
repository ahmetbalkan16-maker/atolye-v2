import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  withCanonicalSmokeRuntime,
  type CanonicalSmokeRuntime,
} from "./lib/CanonicalSmokeRuntime";
import { FFmpegVideoAssemblyProvider } from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import { VideoAssemblyManager } from "../src/lib/assembly/VideoAssemblyManager";
import type { VideoAssemblyInput } from "../src/types/videoAssembly";

function getSystemBinaryPath(name: string): string {
  try {
    const stdout = execFileSync("where.exe", [name], { encoding: "utf8" });
    const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) return lines[0];
  } catch {
    // ignore
  }
  return name;
}

function generateMinimalWav(durationSeconds: number, frequency = 440): Buffer {
  const sampleRate = 48000;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    const sample = Math.floor(Math.sin(2 * Math.PI * frequency * t) * 16000);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }
  return buffer;
}

async function runIsolatedE2E() {
  console.log("=== ISOLATED REAL-RUNTIME E2E TEST: VideoAssemblyManager + FFmpeg BGM Ducking + Ken Burns Motion ===");

  const ffmpegPath = process.env.FFMPEG_PATH || getSystemBinaryPath("ffmpeg");
  const ffprobePath = process.env.FFPROBE_PATH || getSystemBinaryPath("ffprobe");

  await withCanonicalSmokeRuntime(
    {
      name: "isolated-s138-e2e",
      configureProductionExecution: true,
      environment: {
        VIDEO_ASSEMBLY_PROVIDER: "ffmpeg",
        FFMPEG_PATH: ffmpegPath,
        FFPROBE_PATH: ffprobePath,
      },
    },
    async (runtime: CanonicalSmokeRuntime) => {
      const provider = new FFmpegVideoAssemblyProvider(undefined, runtime.runtimeStorageContext);

      const projDir = path.join(runtime.runtimeStorageContext.projectsRoot, runtime.projectSlug);
      const imagesDir = path.join(projDir, "assets", "images");
      const audioDir = path.join(projDir, "assets", "audio");

      fs.mkdirSync(imagesDir, { recursive: true });
      fs.mkdirSync(audioDir, { recursive: true });

      const samplePng = fs.readFileSync(
        path.join(
          process.cwd(),
          "data", "projects",
          "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5",
          "assets", "images",
          "3206e749-5cc3-4dfb-b4d6-4d4476bf31ce.png"
        )
      );

      const img1Path = path.join(imagesDir, "scene1.png");
      const img2Path = path.join(imagesDir, "scene2.png");
      fs.writeFileSync(img1Path, samplePng);
      fs.writeFileSync(img2Path, samplePng);

      const audio1Path = path.join(audioDir, "narration1.wav");
      const audio2Path = path.join(audioDir, "narration2.wav");
      const bgmPath = path.join(audioDir, "bgm.wav");

      fs.writeFileSync(audio1Path, generateMinimalWav(1.0, 440));
      fs.writeFileSync(audio2Path, generateMinimalWav(1.0, 880));
      fs.writeFileSync(bgmPath, generateMinimalWav(3.0, 220));

      const relImg1 = `data/projects/${runtime.projectSlug}/assets/images/scene1.png`;
      const relImg2 = `data/projects/${runtime.projectSlug}/assets/images/scene2.png`;
      const relAudio1 = `data/projects/${runtime.projectSlug}/assets/audio/narration1.wav`;
      const relAudio2 = `data/projects/${runtime.projectSlug}/assets/audio/narration2.wav`;
      const relBgm = `data/projects/${runtime.projectSlug}/assets/audio/bgm.wav`;

      const assemblyInput: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          {
            inputType: "image",
            sceneId: 1,
            imageFilePath: relImg1,
            audioFilePath: relAudio1,
            durationSeconds: 1.0,
          },
          {
            inputType: "image",
            sceneId: 2,
            imageFilePath: relImg2,
            audioFilePath: relAudio2,
            durationSeconds: 1.0,
          },
        ],
        backgroundMusic: {
          filePath: relBgm,
          volume: 0.15,
          ducking: true,
        },
      };

      console.log("Rendering isolated video assembly via FFmpegVideoAssemblyProvider...");
      const result = await provider.assemble(assemblyInput);
      assert.equal(result.success, true, "Assembly must succeed");
      assert.ok(result.byteLength > 0, "Byte length must be positive");
      console.log(`PASS: Rendered MP4 video file at ${result.filePath} (${result.byteLength} bytes).`);

      // Verify container via ffprobe
      const absMp4Path = path.join(runtime.runtimeStorageContext.projectsRoot, runtime.projectSlug, "assets", "videos", path.basename(result.filePath));
      assert.ok(fs.existsSync(absMp4Path), `Output file must exist on disk at ${absMp4Path}`);

      const probeOut = execFileSync(ffprobePath, [
        "-v", "error",
        "-show_entries", "format=duration,size,format_name:stream=codec_name,codec_type",
        "-of", "json",
        absMp4Path,
      ], { encoding: "utf8" });

      const parsed = JSON.parse(probeOut);
      assert.equal(parsed.streams.length, 2, "Must contain exactly 1 video stream and 1 audio stream");
      const videoStream = parsed.streams.find((s: any) => s.codec_type === "video");
      const audioStream = parsed.streams.find((s: any) => s.codec_type === "audio");
      assert.equal(videoStream.codec_name, "h264", "Video codec must be h264");
      assert.equal(audioStream.codec_name, "aac", "Audio codec must be aac");
      assert.ok(Math.abs(Number(parsed.format.duration) - 2.0) <= 0.25, `Duration must be ~2.0s. Got: ${parsed.format.duration}`);

      console.log("=== ISOLATED REAL-RUNTIME E2E TEST: ALL ASSERTIONS PASSED ===");
    },
  );
}

runIsolatedE2E().catch((err) => {
  console.error("ISOLATED E2E TEST FAILED:", err);
  process.exitCode = 1;
});
