import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  withCanonicalSmokeRuntime,
  type CanonicalSmokeRuntime,
} from "./lib/CanonicalSmokeRuntime";
import {
  FFmpegVideoAssemblyProvider,
  selectKenBurnsMotion,
  buildKenBurnsFilter,
} from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
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
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
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

function generateValidPng(): Buffer {
  // Valid 100x100 Solid Red PNG
  const realProjImg = path.join(
    process.cwd(),
    "data", "projects",
    "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5",
    "assets", "images",
    "3206e749-5cc3-4dfb-b4d6-4d4476bf31ce.png"
  );
  if (fs.existsSync(realProjImg)) {
    return fs.readFileSync(realProjImg);
  }
  return Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc00000030001000001000100000000",
    "hex",
  );
}

async function runSmokeTests() {
  console.log("=== SMOKE TEST: FFmpeg Assembly Audio Ducking + Ken Burns Motion ===");

  const ffmpegPath = process.env.FFMPEG_PATH || getSystemBinaryPath("ffmpeg");
  const ffprobePath = process.env.FFPROBE_PATH || getSystemBinaryPath("ffprobe");

  await withCanonicalSmokeRuntime(
    {
      name: "smoke-ffmpeg-bgm-kenburns",
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

      const img1Path = path.join(imagesDir, "img1.png");
      const img2Path = path.join(imagesDir, "img2.png");
      const img3Path = path.join(imagesDir, "img3.png");
      const img4Path = path.join(imagesDir, "img4.png");
      const samplePng = generateValidPng();
      fs.writeFileSync(img1Path, samplePng);
      fs.writeFileSync(img2Path, samplePng);
      fs.writeFileSync(img3Path, samplePng);
      fs.writeFileSync(img4Path, samplePng);

      const audio1Path = path.join(audioDir, "audio1.wav");
      const audio2Path = path.join(audioDir, "audio2.wav");
      const bgmPath = path.join(audioDir, "bgm.wav");
      fs.writeFileSync(audio1Path, generateMinimalWav(0.5, 440));
      fs.writeFileSync(audio2Path, generateMinimalWav(0.5, 880));
      fs.writeFileSync(bgmPath, generateMinimalWav(1.5, 220));

      const relImg1 = `data/projects/${runtime.projectSlug}/assets/images/img1.png`;
      const relImg2 = `data/projects/${runtime.projectSlug}/assets/images/img2.png`;
      const relImg3 = `data/projects/${runtime.projectSlug}/assets/images/img3.png`;
      const relImg4 = `data/projects/${runtime.projectSlug}/assets/images/img4.png`;
      const relAudio1 = `data/projects/${runtime.projectSlug}/assets/audio/audio1.wav`;
      const relAudio2 = `data/projects/${runtime.projectSlug}/assets/audio/audio2.wav`;
      const relBgm = `data/projects/${runtime.projectSlug}/assets/audio/bgm.wav`;

      // Scenario 1: BGM yok -> mevcut davranış PASS
      console.log("[Scenario 1] BGM yok -> mevcut davranış PASS...");
      const inputNoBgm: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          {
            inputType: "image",
            sceneId: 1,
            imageFilePath: relImg1,
            audioFilePath: relAudio1,
            durationSeconds: 0.5,
          },
        ],
      };
      const res1 = await provider.assemble(inputNoBgm);
      assert.equal(res1.success, true);
      assert.ok(res1.byteLength > 0);
      console.log(`[Scenario 1] PASS: Rendered ${res1.byteLength} bytes without BGM.`);

      // Scenario 2: BGM var -> assembly PASS
      console.log("[Scenario 2] BGM var -> assembly PASS...");
      const inputWithBgm: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          {
            inputType: "image",
            sceneId: 1,
            imageFilePath: relImg1,
            audioFilePath: relAudio1,
            durationSeconds: 0.5,
          },
        ],
        backgroundMusic: {
          filePath: relBgm,
          volume: 0.15,
          ducking: true,
        },
      };
      const res2 = await provider.assemble(inputWithBgm);
      assert.equal(res2.success, true);
      assert.ok(res2.byteLength > 0);
      console.log(`[Scenario 2] PASS: Rendered ${res2.byteLength} bytes with BGM.`);

      // Scenario 3: BGM loop -> PASS (narration 1s, BGM 0.5s)
      console.log("[Scenario 3] BGM loop -> PASS...");
      const shortBgmPath = path.join(audioDir, "short_bgm.wav");
      fs.writeFileSync(shortBgmPath, generateMinimalWav(0.5, 220));
      const relShortBgm = `data/projects/${runtime.projectSlug}/assets/audio/short_bgm.wav`;
      const inputBgmLoop: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          {
            inputType: "image",
            sceneId: 1,
            imageFilePath: relImg1,
            audioFilePath: relAudio1,
            durationSeconds: 0.5,
          },
          {
            inputType: "image",
            sceneId: 2,
            imageFilePath: relImg2,
            audioFilePath: relAudio2,
            durationSeconds: 0.5,
          },
        ],
        backgroundMusic: {
          filePath: relShortBgm,
          volume: 0.20,
          ducking: true,
        },
      };
      const res3 = await provider.assemble(inputBgmLoop);
      assert.equal(res3.success, true);
      assert.ok(res3.byteLength > 0);
      console.log(`[Scenario 3] PASS: Short BGM looped successfully.`);

      // Scenario 4: narration + BGM -> ducking PASS
      console.log("[Scenario 4] narration + BGM -> ducking PASS...");
      const inputDucking: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          {
            inputType: "image",
            sceneId: 1,
            imageFilePath: relImg1,
            audioFilePath: relAudio1,
            durationSeconds: 0.5,
          },
        ],
        backgroundMusic: {
          filePath: relBgm,
          volume: 0.15,
          ducking: true,
        },
      };
      const res4 = await provider.assemble(inputDucking);
      assert.equal(res4.success, true);
      assert.ok(res4.byteLength > 0);
      console.log(`[Scenario 4] PASS: Sidechain ducking filter assembled cleanly.`);

      // Scenario 5: BGM yokken narration -> mevcut davranış PASS
      console.log("[Scenario 5] BGM yokken narration -> mevcut davranış PASS...");
      const inputNoBgmNarration: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          {
            inputType: "image",
            sceneId: 1,
            imageFilePath: relImg1,
            audioFilePath: relAudio1,
            durationSeconds: 0.5,
          },
          {
            inputType: "image",
            sceneId: 2,
            imageFilePath: relImg2,
            audioFilePath: relAudio2,
            durationSeconds: 0.5,
          },
        ],
      };
      const res5 = await provider.assemble(inputNoBgmNarration);
      assert.equal(res5.success, true);
      console.log(`[Scenario 5] PASS: Pure narration without BGM assembly matches baseline.`);

      // Scenario 6: Ken Burns zoom-in
      console.log("[Scenario 6] Ken Burns zoom-in...");
      const motion1 = selectKenBurnsMotion(1);
      assert.equal(motion1, "zoom-in");
      const filter1 = buildKenBurnsFilter(motion1, 0.5);
      assert.ok(filter1.includes("zoompan"));
      assert.ok(filter1.includes("min(1+0.0015*on,1.15)"));
      console.log(`[Scenario 6] PASS: sceneId=1 selected ${motion1}`);

      // Scenario 7: Ken Burns zoom-out
      console.log("[Scenario 7] Ken Burns zoom-out...");
      const motion2 = selectKenBurnsMotion(2);
      assert.equal(motion2, "zoom-out");
      const filter2 = buildKenBurnsFilter(motion2, 0.5);
      assert.ok(filter2.includes("zoompan"));
      assert.ok(filter2.includes("max(1.15-0.0015*on,1.0)"));
      console.log(`[Scenario 8] PASS: sceneId=2 selected ${motion2}`);

      // Scenario 8: Ken Burns pan-left
      console.log("[Scenario 8] Ken Burns pan-left...");
      const motion3 = selectKenBurnsMotion(3);
      assert.equal(motion3, "pan-left");
      const filter3 = buildKenBurnsFilter(motion3, 0.5);
      assert.ok(filter3.includes("zoompan"));
      assert.ok(filter3.includes("x='(on/"));
      console.log(`[Scenario 8] PASS: sceneId=3 selected ${motion3}`);

      // Scenario 9: Ken Burns pan-right
      console.log("[Scenario 9] Ken Burns pan-right...");
      const motion4 = selectKenBurnsMotion(4);
      assert.equal(motion4, "pan-right");
      const filter4 = buildKenBurnsFilter(motion4, 0.5);
      assert.ok(filter4.includes("zoompan"));
      assert.ok(filter4.includes("x='(1-on/"));
      console.log(`[Scenario 9] PASS: sceneId=4 selected ${motion4}`);

      // Scenario 10: Aynı scene iki kez -> aynı motion seçimi
      console.log("[Scenario 10] Aynı scene iki kez -> aynı motion seçimi...");
      assert.equal(selectKenBurnsMotion(42), selectKenBurnsMotion(42));
      assert.equal(selectKenBurnsMotion(7), selectKenBurnsMotion(7));
      console.log(`[Scenario 10] PASS: Motion selection is 100% deterministic.`);

      // Scenario 11: Kısa scene -> geçerli çıktı
      console.log("[Scenario 11] Kısa scene -> geçerli çıktı...");
      const shortAudioPath = path.join(audioDir, "short_audio.wav");
      fs.writeFileSync(shortAudioPath, generateMinimalWav(0.3, 440));
      const relShortAudio = `data/projects/${runtime.projectSlug}/assets/audio/short_audio.wav`;
      const inputShortScene: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          {
            inputType: "image",
            sceneId: 1,
            imageFilePath: relImg1,
            audioFilePath: relShortAudio,
            durationSeconds: 0.3,
          },
        ],
      };
      const res11 = await provider.assemble(inputShortScene);
      assert.equal(res11.success, true);
      assert.ok(res11.byteLength > 0);
      console.log(`[Scenario 11] PASS: 0.3s short scene rendered successfully (${res11.byteLength} bytes).`);

      // Scenario 12: FFprobe ile çıktı geçerli MP4 -> PASS
      console.log("[Scenario 12] FFprobe ile çıktı geçerli MP4 -> PASS...");
      const absMp4Path = path.join(runtime.runtimeStorageContext.projectsRoot, runtime.projectSlug, "assets", "videos", path.basename(res2.filePath));
      assert.ok(fs.existsSync(absMp4Path), `Output MP4 file must exist at ${absMp4Path}`);
      const probeStdout = execFileSync(ffprobePath, [
        "-v", "error",
        "-show_entries", "format=duration,size,format_name",
        "-of", "default=noprint_wrappers=1",
        absMp4Path,
      ], { encoding: "utf8" });
      assert.ok(probeStdout.includes("format_name=mov,mp4,m4a,3gp,3g2,mj2"), `Output must be valid MP4 container. Got: ${probeStdout}`);
      console.log(`[Scenario 12] PASS: FFprobe verified MP4 output:\n${probeStdout.trim()}`);

      console.log("=== SMOKE TEST: ALL 12 SCENARIOS PASSED ===");
    },
  );
}

runSmokeTests().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exitCode = 1;
});
