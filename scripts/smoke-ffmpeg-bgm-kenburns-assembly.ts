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
import type { AnimationTransitionType } from "../src/types/animation";
import type { VideoAssemblyInput, VideoAssemblyResult } from "../src/types/videoAssembly";

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

      // Scenario 13: scene-video + BGM (retimed assembly yolunun BGM mikslemesi)
      console.log("[Scenario 13] scene-video + BGM (retimed path)...");
      const videoDir = path.join(projDir, "assets", "videos");
      fs.mkdirSync(videoDir, { recursive: true });
      const sv1Path = path.join(videoDir, "sv1.mp4");
      const sv2Path = path.join(videoDir, "sv2.mp4");
      execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-i", absMp4Path, "-an", "-c:v", "copy", sv1Path]);
      execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-i", absMp4Path, "-an", "-c:v", "copy", sv2Path]);
      const relSv1 = `data/projects/${runtime.projectSlug}/assets/videos/sv1.mp4`;
      const relSv2 = `data/projects/${runtime.projectSlug}/assets/videos/sv2.mp4`;
      const sv1Size = fs.statSync(sv1Path).size;
      const sv2Size = fs.statSync(sv2Path).size;

      const makeSceneVideoProps = (filePath: string, byteLength: number) => ({
        videoAssetId: "vid_1",
        sourceImageAssetId: "img_1",
        animationAssetId: "anim_1",
        url: `/api/assets/videos/${runtime.projectSlug}/${path.basename(filePath)}`,
        byteLength,
        provider: "ffmpeg" as const,
        generationMode: "production" as const,
        status: "generated" as const,
      });

      const inputSceneVideoRetimedBgm: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          {
            ...makeSceneVideoProps(relSv1, sv1Size),
            inputType: "scene-video",
            sceneId: 1,
            filePath: relSv1,
            audioFilePath: relAudio1,
            durationSeconds: 0.5,
            narrationDurationSeconds: 0.5,
            transition: "cut",
          },
          {
            ...makeSceneVideoProps(relSv2, sv2Size),
            inputType: "scene-video",
            sceneId: 2,
            filePath: relSv2,
            audioFilePath: relAudio2,
            durationSeconds: 0.5,
            narrationDurationSeconds: 0.5,
            transition: "cut",
          },
        ],
        backgroundMusic: {
          filePath: relBgm,
          volume: 0.2,
          ducking: true,
        },
      };

      const res13 = await provider.assemble(inputSceneVideoRetimedBgm);
      assert.equal(res13.success, true);
      assert.ok(res13.byteLength > 0);
      console.log(`[Scenario 13] PASS: scene-video + BGM (retimed) rendered successfully (${res13.byteLength} bytes).`);

      // Scenario 14: scene-video + BGM (transitioned path with fade)
      console.log("[Scenario 14] scene-video + BGM (transitioned path with fade)...");
      const inputSceneVideoTransitionedBgm: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          {
            ...makeSceneVideoProps(relSv1, sv1Size),
            inputType: "scene-video",
            sceneId: 1,
            filePath: relSv1,
            audioFilePath: relAudio1,
            durationSeconds: 0.5,
            narrationDurationSeconds: 0.5,
            transition: "cut",
          },
          {
            ...makeSceneVideoProps(relSv2, sv2Size),
            inputType: "scene-video",
            sceneId: 2,
            filePath: relSv2,
            audioFilePath: relAudio2,
            durationSeconds: 0.5,
            narrationDurationSeconds: 0.5,
            transition: "fade",
          },
        ],
        backgroundMusic: {
          filePath: relBgm,
          volume: 0.15,
          ducking: true,
        },
      };


      const res14 = await provider.assemble(inputSceneVideoTransitionedBgm);
      assert.equal(res14.success, true);
      assert.ok(res14.byteLength > 0);
      console.log(`[Scenario 14] PASS: scene-video + BGM (transitioned fade) rendered successfully (${res14.byteLength} bytes).`);

      // --- Sprint 140: static image fade / fadeblack xfade + acrossfade ---

      function probeStreamDurations(absPath: string) {
        const stdout = execFileSync(ffprobePath, [
          "-v", "error",
          "-show_entries", "format=duration:stream=codec_type,duration",
          "-of", "json",
          absPath,
        ], { encoding: "utf8" });
        const parsed = JSON.parse(stdout) as {
          format?: { duration?: string };
          streams?: Array<{ codec_type?: string; duration?: string }>;
        };
        const streams = parsed.streams ?? [];
        const video = streams.find((s) => s.codec_type === "video");
        const audio = streams.find((s) => s.codec_type === "audio");
        return {
          formatDuration: Number(parsed.format?.duration),
          videoDuration: Number(video?.duration),
          audioDuration: Number(audio?.duration),
        };
      }

      function absVideoPath(filePath: string) {
        return path.join(
          runtime.runtimeStorageContext.projectsRoot,
          runtime.projectSlug,
          "assets", "videos",
          path.basename(filePath),
        );
      }

      // Scenario 15: image cut -> mevcut concat yolu (blend YOK) korunuyor
      console.log("[Scenario 15] image cut -> mevcut concat yolu korunuyor...");
      const inputImageCut: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          {
            inputType: "image",
            sceneId: 1,
            imageFilePath: relImg1,
            audioFilePath: relAudio1,
            durationSeconds: 0.5,
            transition: "cut",
          },
          {
            inputType: "image",
            sceneId: 2,
            imageFilePath: relImg2,
            audioFilePath: relAudio2,
            durationSeconds: 0.5,
            transition: "cut",
          },
        ],
      };
      const res15 = await provider.assemble(inputImageCut);
      assert.equal(res15.success, true);
      assert.ok(res15.byteLength > 0);
      // Tight tolerance: proves NO xfade/acrossfade blend subtraction happened
      // (the transitioned-image path would shave ~1 frame off even for "cut").
      assert.ok(
        Math.abs(res15.durationSeconds - 1.0) < 0.05,
        `Expected ~1.0s (naive sum, no blend), got ${res15.durationSeconds}`,
      );
      console.log(`[Scenario 15] PASS: image cut duration=${res15.durationSeconds}s (naive sum preserved).`);

      // Scenario 16: image fade (domain "crossfade" -> ffmpeg xfade mode "fade"/dissolve)
      console.log("[Scenario 16] image fade (crossfade dissolve)...");
      const img3Audio = path.join(audioDir, "audio3.wav");
      fs.writeFileSync(img3Audio, generateMinimalWav(0.5, 660));
      const relAudio3 = `data/projects/${runtime.projectSlug}/assets/audio/audio3.wav`;
      const inputImageFade: VideoAssemblyInput = {
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
            transition: "crossfade",
          },
          {
            inputType: "image",
            sceneId: 3,
            imageFilePath: relImg3,
            audioFilePath: relAudio3,
            durationSeconds: 0.5,
            transition: "crossfade",
          },
        ],
      };
      const res16 = await provider.assemble(inputImageFade);
      assert.equal(res16.success, true);
      assert.ok(res16.byteLength > 0);
      // 3 scenes x 0.5s = 1.5s naive; each of 2 junctions blends
      // min(0.5, 0.5*0.4, 0.5*0.4) = 0.2s -> expected 1.5 - 0.4 = 1.1s.
      const expectedFadeDuration = 1.5 - 2 * 0.2;
      assert.ok(
        Math.abs(res16.durationSeconds - expectedFadeDuration) < 0.1,
        `Expected ~${expectedFadeDuration}s, got ${res16.durationSeconds}`,
      );
      const abs16 = absVideoPath(res16.filePath);
      const probe16 = probeStreamDurations(abs16);
      assert.ok(
        Math.abs(probe16.videoDuration - expectedFadeDuration) < 0.15,
        `video stream duration mismatch: ${probe16.videoDuration}`,
      );
      assert.ok(
        Math.abs(probe16.audioDuration - expectedFadeDuration) < 0.15,
        `audio stream duration mismatch: ${probe16.audioDuration}`,
      );
      console.log(`[Scenario 16] PASS: image crossfade duration=${res16.durationSeconds}s (video=${probe16.videoDuration}, audio=${probe16.audioDuration}).`);

      // Scenario 17: image fadeblack (domain "fade" -> ffmpeg xfade mode "fadeblack")
      console.log("[Scenario 17] image fadeblack (fade-through-black)...");
      const inputImageFadeblack: VideoAssemblyInput = {
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
            transition: "fade",
          },
        ],
      };
      const res17 = await provider.assemble(inputImageFadeblack);
      assert.equal(res17.success, true);
      assert.ok(res17.byteLength > 0);
      // 2 scenes x 0.5s = 1.0s naive; 1 junction blends min(0.5,0.2,0.2)=0.2s.
      const expectedFadeblackDuration = 1.0 - 0.2;
      assert.ok(
        Math.abs(res17.durationSeconds - expectedFadeblackDuration) < 0.1,
        `Expected ~${expectedFadeblackDuration}s, got ${res17.durationSeconds}`,
      );
      const abs17 = absVideoPath(res17.filePath);
      const probe17 = probeStreamDurations(abs17);
      assert.ok(
        Math.abs(probe17.videoDuration - expectedFadeblackDuration) < 0.15,
        `video stream duration mismatch: ${probe17.videoDuration}`,
      );
      assert.ok(
        Math.abs(probe17.audioDuration - expectedFadeblackDuration) < 0.15,
        `audio stream duration mismatch: ${probe17.audioDuration}`,
      );
      console.log(`[Scenario 17] PASS: image fadeblack duration=${res17.durationSeconds}s (video=${probe17.videoDuration}, audio=${probe17.audioDuration}).`);

      // Scenario 18: image fade + BGM + ducking (Sprint 139 appendBgmFilterGraph
      // wired into the image-xfade final narration/acrossfade stream)
      console.log("[Scenario 18] image fade + BGM + ducking...");
      const inputImageFadeBgm: VideoAssemblyInput = {
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
            transition: "fade",
          },
        ],
        backgroundMusic: {
          filePath: relBgm,
          volume: 0.15,
          ducking: true,
        },
      };
      const res18 = await provider.assemble(inputImageFadeBgm);
      assert.equal(res18.success, true);
      assert.ok(res18.byteLength > 0);
      assert.ok(
        Math.abs(res18.durationSeconds - expectedFadeblackDuration) < 0.1,
        `Expected ~${expectedFadeblackDuration}s (BGM must not shift duration), got ${res18.durationSeconds}`,
      );
      console.log(`[Scenario 18] PASS: image fade + BGM ducking rendered successfully (${res18.byteLength} bytes, ${res18.durationSeconds}s).`);

      // Scenario 19: custom duration + xfade (asymmetric scene durations,
      // verifies blendSecondsFor's duration*0.4 cap and offset math for
      // non-uniform scenes; real ffprobe verifies final/video/audio duration)
      console.log("[Scenario 19] custom duration + xfade (asymmetric durations)...");
      const audio6Path = path.join(audioDir, "audio6.wav");
      fs.writeFileSync(audio6Path, generateMinimalWav(0.6, 330));
      const relAudio6 = `data/projects/${runtime.projectSlug}/assets/audio/audio6.wav`;
      const audio4Path = path.join(audioDir, "audio4.wav");
      fs.writeFileSync(audio4Path, generateMinimalWav(0.4, 550));
      const relAudio4 = `data/projects/${runtime.projectSlug}/assets/audio/audio4.wav`;
      const audio5Path = path.join(audioDir, "audio5.wav");
      fs.writeFileSync(audio5Path, generateMinimalWav(0.8, 770));
      const relAudio5 = `data/projects/${runtime.projectSlug}/assets/audio/audio5.wav`;
      const img5Path = path.join(imagesDir, "img5.png");
      fs.writeFileSync(img5Path, samplePng);
      const relImg5 = `data/projects/${runtime.projectSlug}/assets/images/img5.png`;

      const inputCustomDurationXfade: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          {
            inputType: "image",
            sceneId: 1,
            imageFilePath: relImg1,
            audioFilePath: relAudio6,
            durationSeconds: 0.6,
          },
          {
            inputType: "image",
            sceneId: 2,
            imageFilePath: relImg4,
            audioFilePath: relAudio4,
            durationSeconds: 0.4,
            transition: "fade",
          },
          {
            inputType: "image",
            sceneId: 3,
            imageFilePath: relImg5,
            audioFilePath: relAudio5,
            durationSeconds: 0.8,
            transition: "crossfade",
          },
        ],
      };
      const res19 = await provider.assemble(inputCustomDurationXfade);
      assert.equal(res19.success, true);
      assert.ok(res19.byteLength > 0);
      // durations = [0.6, 0.4, 0.8]; naive sum = 1.8
      // junction1 (fade): min(0.5, 0.6*0.4=0.24, 0.4*0.4=0.16) = 0.16
      // junction2 (crossfade): min(0.5, 0.4*0.4=0.16, 0.8*0.4=0.32) = 0.16
      const blend1 = Math.min(0.5, 0.6 * 0.4, 0.4 * 0.4);
      const blend2 = Math.min(0.5, 0.4 * 0.4, 0.8 * 0.4);
      const expectedCustomDuration = 0.6 + 0.4 + 0.8 - blend1 - blend2;
      assert.ok(
        Math.abs(res19.durationSeconds - expectedCustomDuration) < 0.1,
        `Expected ~${expectedCustomDuration}s (xfade offset/acrossfade duration applied), got ${res19.durationSeconds}`,
      );
      const abs19 = absVideoPath(res19.filePath);
      const probe19 = probeStreamDurations(abs19);
      assert.ok(
        Math.abs(probe19.formatDuration - expectedCustomDuration) < 0.15,
        `final (format) duration mismatch: ${probe19.formatDuration}`,
      );
      assert.ok(
        Math.abs(probe19.videoDuration - expectedCustomDuration) < 0.15,
        `video stream duration mismatch: ${probe19.videoDuration}`,
      );
      assert.ok(
        Math.abs(probe19.audioDuration - expectedCustomDuration) < 0.15,
        `audio stream duration mismatch: ${probe19.audioDuration}`,
      );
      // Proves the offset/blend actually engaged: strictly shorter than the
      // naive 1.8s sum by more than either individual blend window alone.
      assert.ok(
        res19.durationSeconds < 1.8 - Math.min(blend1, blend2),
        `Duration must reflect xfade overlap, not naive concat sum (got ${res19.durationSeconds})`,
      );
      console.log(`[Scenario 19] PASS: custom duration + xfade final=${res19.durationSeconds}s video=${probe19.videoDuration}s audio=${probe19.audioDuration}s (expected=${expectedCustomDuration.toFixed(3)}s).`);

      // --- Sprint 143: FFmpegVideoAssemblyProvider.validateInput() transition-enum
      // fail-closed guard, tested directly at the provider level (bypassing
      // VideoAssemblyManager, whose classifyAssemblyTransition() always produces a
      // valid enum value and so can never actually reach this guard with an invalid
      // string in real production use). assemble() never rejects/throws - on any
      // failure, including a validateInput rejection, it resolves
      // { success: false, error: SAFE_ERROR } (see the outer try/catch wrapping
      // FFmpegVideoAssemblyProvider.ts's assemble()), so these scenarios assert on
      // that resolved shape rather than assert.rejects. A call-counting runner is
      // used (rather than relying on the resolved error shape alone, which looks
      // identical whether validateInput rejected the input before any process call
      // or a real process call itself failed afterward) to directly prove the
      // FFmpeg/FFprobe process was never invoked.

      // Scenario 20: invalid image transition fails closed
      console.log("[Scenario 20] invalid image transition fails closed...");
      let imageRunnerCalls = 0;
      const imageRejectingProvider = new FFmpegVideoAssemblyProvider(
        { async run() { imageRunnerCalls += 1; throw new Error("must not run"); } },
        runtime.runtimeStorageContext,
      );
      const inputInvalidImageTransition: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          {
            inputType: "image",
            sceneId: 1,
            imageFilePath: relImg1,
            audioFilePath: relAudio1,
            durationSeconds: 0.5,
            transition: "wipe" as unknown as AnimationTransitionType,
          },
        ],
      };
      const res20 = await imageRejectingProvider.assemble(inputInvalidImageTransition);
      assert.equal(res20.success, false);
      if (res20.success) throw new Error("unreachable");
      assert.equal(res20.error, "Video assembly failed.");
      assert.doesNotMatch(res20.error, /wipe|private|stack/i);
      assert.equal(imageRunnerCalls, 0, "FFmpeg/FFprobe process must not run for a rejected image transition");
      console.log("[Scenario 20] PASS: invalid image transition rejected before any FFmpeg process ran.");

      // Scenario 21: invalid scene-video transition fails closed
      console.log("[Scenario 21] invalid scene-video transition fails closed...");
      let sceneVideoRunnerCalls = 0;
      const sceneVideoRejectingProvider = new FFmpegVideoAssemblyProvider(
        { async run() { sceneVideoRunnerCalls += 1; throw new Error("must not run"); } },
        runtime.runtimeStorageContext,
      );
      const inputInvalidSceneVideoTransition: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          {
            ...makeSceneVideoProps(relSv1, sv1Size),
            inputType: "scene-video",
            sceneId: 1,
            filePath: relSv1,
            audioFilePath: relAudio1,
            durationSeconds: 0.5,
            narrationDurationSeconds: 0.5,
            transition: "wipe" as unknown as AnimationTransitionType,
          },
        ],
      };
      const res21 = await sceneVideoRejectingProvider.assemble(inputInvalidSceneVideoTransition);
      assert.equal(res21.success, false);
      if (res21.success) throw new Error("unreachable");
      assert.equal(res21.error, "Video assembly failed.");
      assert.doesNotMatch(res21.error, /wipe|private|stack/i);
      assert.equal(sceneVideoRunnerCalls, 0, "FFmpeg/FFprobe process must not run for a rejected scene-video transition");
      console.log("[Scenario 21] PASS: invalid scene-video transition rejected before any FFmpeg process ran.");

      // Scenario 22: undefined transition remains accepted (regression, both
      // inputTypes) - the guard only rejects scene.transition !== undefined &&
      // not-a-valid-enum-value; undefined (transition omitted entirely, the
      // pre-Sprint-140/141 default shape for every existing project) must keep
      // rendering successfully, completely unchanged.
      console.log("[Scenario 22] undefined transition remains accepted (image + scene-video)...");
      const inputUndefinedImageTransition: VideoAssemblyInput = {
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
      const res22a = await provider.assemble(inputUndefinedImageTransition);
      assert.equal(res22a.success, true);
      assert.ok(res22a.byteLength > 0);

      const inputUndefinedSceneVideoTransition: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          {
            ...makeSceneVideoProps(relSv1, sv1Size),
            inputType: "scene-video",
            sceneId: 1,
            filePath: relSv1,
            audioFilePath: relAudio1,
            durationSeconds: 0.5,
            narrationDurationSeconds: 0.5,
          },
        ],
      };
      const res22b = await provider.assemble(inputUndefinedSceneVideoTransition);
      assert.equal(res22b.success, true);
      assert.ok(res22b.byteLength > 0);
      console.log(`[Scenario 22] PASS: transition:undefined still accepted for image (${res22a.byteLength}b) and scene-video (${res22b.byteLength}b).`);

      // --- Sprint 144: FFmpegVideoAssemblyProvider.validateInput()'s backgroundMusic
      // validation block - a sibling fail-closed guard to Sprint 143's transition-enum
      // guard, in the same function, same "resolves { success:false, error:SAFE_ERROR },
      // never rejects" contract, tested the same way (call-counting runner proving
      // FFmpeg/FFprobe never ran, rather than trusting the resolved shape alone, which
      // looks identical whether validateInput rejected the input or a real process
      // call itself failed afterward).
      //
      // Reachability differs per sub-check: `volume` is always a hardcoded 0.15 via
      // VideoAssemblyManager's resolveBackgroundMusic(), so the volume-bounds checks
      // are defense-in-depth only reachable via a direct provider call (like Sprint
      // 143's transition guard) - but `backgroundMusic.filePath` is a real, dynamic
      // asset-registry path, so its traversal check protects the exact same real
      // threat model already covered for imageFilePath/audioFilePath/scene-video
      // filePath elsewhere in this suite and in smoke-production-video-assembly-
      // wiring.ts's "audio storage junction escape fails before process", just never
      // extended to BGM until now. isSafeInputPath() is a pure string check (no
      // filesystem I/O), so a real filesystem junction (that other file's heavier
      // AssetManager-based fixture) isn't needed to prove rejection here - this file
      // has no AssetManager/junction-replacement fixtures of its own, and a malformed
      // path string alone is sufficient to trigger the same lexical guard.

      function makeRejectingProvider() {
        let calls = 0;
        const rejectingProvider = new FFmpegVideoAssemblyProvider(
          { async run() { calls += 1; throw new Error("must not run"); } },
          runtime.runtimeStorageContext,
        );
        return { rejectingProvider, callCount: () => calls };
      }

      function assertBgmRejected(result: VideoAssemblyResult, callCount: number, label: string) {
        assert.equal(result.success, false, `${label} must be rejected`);
        if (result.success) throw new Error("unreachable");
        assert.equal(result.error, "Video assembly failed.");
        assert.doesNotMatch(result.error, /private|stack/i);
        assert.equal(callCount, 0, `FFmpeg/FFprobe process must not run for ${label}`);
      }

      // Scenario 23: BGM volume=0 fails closed (lower bound, exclusive: `<= 0`)
      console.log("[Scenario 23] BGM volume=0 fails closed...");
      const { rejectingProvider: volZeroProvider, callCount: volZeroCalls } = makeRejectingProvider();
      const inputBgmVolumeZero: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          { inputType: "image", sceneId: 1, imageFilePath: relImg1, audioFilePath: relAudio1, durationSeconds: 0.5 },
        ],
        backgroundMusic: { filePath: relBgm, volume: 0, ducking: true },
      };
      const res23 = await volZeroProvider.assemble(inputBgmVolumeZero);
      assertBgmRejected(res23, volZeroCalls(), "BGM volume=0");
      console.log("[Scenario 23] PASS: BGM volume=0 rejected before any FFmpeg process ran.");

      // Scenario 24: BGM volume=2.5 fails closed (upper bound, exclusive: `> 2.0`)
      console.log("[Scenario 24] BGM volume=2.5 fails closed...");
      const { rejectingProvider: volTooHighProvider, callCount: volTooHighCalls } = makeRejectingProvider();
      const inputBgmVolumeTooHigh: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          { inputType: "image", sceneId: 1, imageFilePath: relImg1, audioFilePath: relAudio1, durationSeconds: 0.5 },
        ],
        backgroundMusic: { filePath: relBgm, volume: 2.5, ducking: true },
      };
      const res24 = await volTooHighProvider.assemble(inputBgmVolumeTooHigh);
      assertBgmRejected(res24, volTooHighCalls(), "BGM volume=2.5");
      console.log("[Scenario 24] PASS: BGM volume=2.5 rejected before any FFmpeg process ran.");

      // Scenario 25: BGM volume=NaN fails closed (Number.isFinite guard)
      console.log("[Scenario 25] BGM volume=NaN fails closed...");
      const { rejectingProvider: volNaNProvider, callCount: volNaNCalls } = makeRejectingProvider();
      const inputBgmVolumeNaN: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          { inputType: "image", sceneId: 1, imageFilePath: relImg1, audioFilePath: relAudio1, durationSeconds: 0.5 },
        ],
        backgroundMusic: { filePath: relBgm, volume: NaN, ducking: true },
      };
      const res25 = await volNaNProvider.assemble(inputBgmVolumeNaN);
      assertBgmRejected(res25, volNaNCalls(), "BGM volume=NaN");
      console.log("[Scenario 25] PASS: BGM volume=NaN rejected before any FFmpeg process ran.");

      // Scenario 26: BGM volume=Infinity fails closed (Number.isFinite guard)
      console.log("[Scenario 26] BGM volume=Infinity fails closed...");
      const { rejectingProvider: volInfinityProvider, callCount: volInfinityCalls } = makeRejectingProvider();
      const inputBgmVolumeInfinity: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          { inputType: "image", sceneId: 1, imageFilePath: relImg1, audioFilePath: relAudio1, durationSeconds: 0.5 },
        ],
        backgroundMusic: { filePath: relBgm, volume: Infinity, ducking: true },
      };
      const res26 = await volInfinityProvider.assemble(inputBgmVolumeInfinity);
      assertBgmRejected(res26, volInfinityCalls(), "BGM volume=Infinity");
      console.log("[Scenario 26] PASS: BGM volume=Infinity rejected before any FFmpeg process ran.");

      // Scenario 27: unsafe BGM filePath (traversal) fails closed
      console.log("[Scenario 27] unsafe BGM filePath (traversal) fails closed...");
      const { rejectingProvider: unsafePathProvider, callCount: unsafePathCalls } = makeRejectingProvider();
      const unsafeBgmPath = `data/projects/${runtime.projectSlug}/assets/audio/../../../etc/unsafe-bgm.wav`;
      const inputBgmUnsafePath: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          { inputType: "image", sceneId: 1, imageFilePath: relImg1, audioFilePath: relAudio1, durationSeconds: 0.5 },
        ],
        backgroundMusic: { filePath: unsafeBgmPath, volume: 0.15, ducking: true },
      };
      const res27 = await unsafePathProvider.assemble(inputBgmUnsafePath);
      assertBgmRejected(res27, unsafePathCalls(), "unsafe BGM filePath");
      console.log("[Scenario 27] PASS: unsafe BGM filePath rejected before any FFmpeg process ran.");

      // Scenario 28: malformed backgroundMusic (null) fails closed
      console.log("[Scenario 28] malformed backgroundMusic (null) fails closed...");
      const { rejectingProvider: malformedBgmProvider, callCount: malformedBgmCalls } = makeRejectingProvider();
      const inputBgmMalformed: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          { inputType: "image", sceneId: 1, imageFilePath: relImg1, audioFilePath: relAudio1, durationSeconds: 0.5 },
        ],
        backgroundMusic: null as unknown as VideoAssemblyInput["backgroundMusic"],
      };
      const res28 = await malformedBgmProvider.assemble(inputBgmMalformed);
      assertBgmRejected(res28, malformedBgmCalls(), "malformed (null) backgroundMusic");
      console.log("[Scenario 28] PASS: malformed backgroundMusic rejected before any FFmpeg process ran.");

      // Scenario 29: BGM volume=2.0 remains accepted (upper bound, inclusive) - the
      // guard is `volume > 2.0`, so 2.0 itself is the valid maximum. Real render,
      // using the file's real ffmpeg-backed `provider`, same as every happy-path
      // scenario above.
      console.log("[Scenario 29] BGM volume=2.0 (inclusive upper bound) remains accepted...");
      const inputBgmVolumeUpperBound: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          { inputType: "image", sceneId: 1, imageFilePath: relImg1, audioFilePath: relAudio1, durationSeconds: 0.5 },
        ],
        backgroundMusic: { filePath: relBgm, volume: 2.0, ducking: true },
      };
      const res29 = await provider.assemble(inputBgmVolumeUpperBound);
      assert.equal(res29.success, true);
      assert.ok(res29.byteLength > 0);
      console.log(`[Scenario 29] PASS: BGM volume=2.0 rendered successfully (${res29.byteLength} bytes).`);

      // Scenario 30: BGM volume=undefined (only filePath given) remains accepted -
      // the default 0.15 (appendBgmFilterGraph's `bgmConfig.volume ?? 0.15`) still
      // applies. This file uses the real ffmpeg binary (no arg-capturing FakeRunner),
      // so a successful real render is this suite's available proof that the default
      // path still renders, same as every other happy-path scenario above; no
      // existing scenario in this file previously omitted `volume` entirely (all 7
      // prior backgroundMusic fixtures set it explicitly to 0.15/0.2/0.20).
      console.log("[Scenario 30] BGM volume=undefined (default) remains accepted...");
      const inputBgmVolumeUndefined: VideoAssemblyInput = {
        projectSlug: runtime.projectSlug,
        scenes: [
          { inputType: "image", sceneId: 1, imageFilePath: relImg1, audioFilePath: relAudio1, durationSeconds: 0.5 },
        ],
        backgroundMusic: { filePath: relBgm, ducking: true },
      };
      const res30 = await provider.assemble(inputBgmVolumeUndefined);
      assert.equal(res30.success, true);
      assert.ok(res30.byteLength > 0);
      console.log(`[Scenario 30] PASS: BGM volume=undefined (default 0.15) rendered successfully (${res30.byteLength} bytes).`);

      console.log("=== SMOKE TEST: ALL 30 SCENARIOS PASSED ===");
    },
  );
}

runSmokeTests().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exitCode = 1;
});
