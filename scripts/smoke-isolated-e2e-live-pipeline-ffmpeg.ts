/**
 * Isolated end-to-end coverage for the FULL live pipeline entry point
 * (`PipelineRunner.run` — exactly what `POST /api/pipeline` invokes) with the
 * DURABLE execution path enabled and REAL FFmpeg for the scene-video and final
 * assembly stages. Every other stage uses deterministic-but-real fixture
 * providers that write valid PNG / WAV assets, so FFmpeg operates on genuine
 * media exactly as it would in production; `videoProvider` / `videoAssemblyProvider`
 * are deliberately NOT injected so they resolve from env to the real
 * `FFmpegSceneVideoProvider` / `FFmpegVideoAssemblyProvider`.
 *
 * This is the only test that chains the pipeline orchestrator + durable
 * execution + real per-scene render + real transitioned assembly together and
 * ffprobe-verifies the resulting MP4 (h264 + aac, 1920x1080, expected duration).
 *
 * SKIPS (exit 0, PASS 0) when FFMPEG_PATH / FFPROBE_PATH are unset or point at
 * missing binaries — real FFmpeg is a host dependency, mirroring
 * `smoke-production-scene-video-rendering.ts`.
 */
import assert from "node:assert/strict";
import fsSync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { ThumbnailStorage } from "../src/lib/thumbnail/ThumbnailStorage";
import { createMockThumbnailData } from "../src/lib/thumbnail/providers/MockThumbnailProvider";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { pipelineRecoveryStageOrder } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { MockYouTubePublishProvider } from "../src/lib/youtube/publish/providers/MockYouTubePublishProvider";
import { createProviderDispatchAdapter } from "../src/lib/providers/ProviderDispatchAdapterAuthority";
import { withCanonicalSmokeRuntime, type CanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { emitSmokeResult } from "./lib/SmokeResult";
import { resolveRuntimeLogicalPath } from "../src/lib/runtime/RuntimeStoragePaths";
import type { AIProvider } from "../src/lib/ai/providers";
import type { AudioProvider } from "../src/lib/audio/providers/AudioProvider";
import type { ImageProvider } from "../src/lib/assets/providers/ImageProvider";
import type { ThumbnailProvider } from "../src/lib/thumbnail/providers/ThumbnailProvider";
import type { YouTubeProvider } from "../src/lib/youtube/providers/YouTubeProvider";

const SUITE = "isolated-e2e-live-pipeline-ffmpeg";
const ffmpegPath = process.env.FFMPEG_PATH;
const ffprobePath = process.env.FFPROBE_PATH;

const topic = "Smoke Live Flow - Roma Imparatorlugu'nun Yukselisi";
const slug = ProjectManager.createSlug(topic);
const now = new Date().toISOString();
const CHAPTER_DUR = 16;
const CHAPTERS = [1, 2, 3];

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const b of data) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w = 320, h = 180): Buffer {
  const bpr = 1 + w * 3;
  const raw = Buffer.alloc(bpr * h);
  for (let y = 0; y < h; y++) {
    const o = y * bpr;
    for (let x = 0; x < w; x++) {
      raw[o + 1 + x * 3] = (x * 255 / w) | 0;
      raw[o + 2 + x * 3] = (y * 255 / h) | 0;
      raw[o + 3 + x * 3] = 128;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type);
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0); t.copy(out, 4); data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([t, data])), data.length + 8);
    return out;
  };
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function wav(seconds: number): Buffer {
  const rate = 48000, ch = 2, bits = 16;
  const frames = Math.round(seconds * rate);
  const dataLen = frames * ch * (bits / 8);
  const out = Buffer.alloc(44 + dataLen);
  out.write("RIFF", 0); out.writeUInt32LE(out.length - 8, 4); out.write("WAVE", 8);
  out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20);
  out.writeUInt16LE(ch, 22); out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * ch * (bits / 8), 28); out.writeUInt16LE(ch * (bits / 8), 32);
  out.writeUInt16LE(bits, 34); out.write("data", 36); out.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 8000);
    out.writeInt16LE(v, 44 + i * 4); out.writeInt16LE(v, 44 + i * 4 + 2);
  }
  return out;
}

class AI implements AIProvider {
  createImmutableAiDispatchAdapter() { return createProviderDispatchAdapter(this, { metadata: { name: "smoke" }, requiredMethods: ["generate"] }); }
  async generate(prompt: string) {
    if (prompt.includes("documentary research assistant"))
      return JSON.stringify({ topic, summary: "Roma yukselisi deterministik arastirma metni.", historicalContext: "MO 8. yuzyil", timeline: ["MO 753: kurulus", "MO 509: cumhuriyet"], characters: ["Romulus", "Sezar"], locations: ["Roma", "Forum"], keyEvents: ["Kurulus", "Fetihler"], strategies: ["Lejyon duzeni"], controversies: [], interestingFacts: ["Yedi tepe"], documentaryFlow: ["Kurulus", "Cumhuriyet", "Imparatorluk"], sceneIdeas: ["Forum", "Lejyon"], imagePrompts: ["Roma forumu", "lejyon"], animationPrompts: ["yavas yaklasma"], musicIdeas: ["epik"], soundEffects: ["kalabalik"], thumbnailIdeas: ["Roma"], youtubeTitles: ["Roma'nin Yukselisi"], sources: ["fixture"], createdAt: now });
    if (prompt.includes("documentary script writer"))
      return JSON.stringify({ topic, title: "Roma'nin Yukselisi", subtitle: "Bir imparatorlugun dogusu", hook: "Her sey yedi tepede basladi.", introduction: "Roma kuruldu ve buyudu.", chapters: CHAPTERS.map((id) => ({ id, title: `Bolum ${id}`, narration: `Roma tarihinin ${id}. bolumunde lejyonlar ilerliyor, sehir buyuyor ve imparatorluk sekilleniyor.`, duration: CHAPTER_DUR, visualGoal: "Roma forumu ve lejyonlar", emotion: "epik", transition: id === 1 ? "cut" : id === 2 ? "fade" : "crossfade" })), conclusion: "Roma bir imparatorluk oldu.", callToAction: "Takip edin.", estimatedDuration: CHAPTER_DUR * CHAPTERS.length, narrationWordCount: 45, targetAudience: "genel", language: "tr", voiceStyle: "documentary", musicStyle: "epic", thumbnailIdea: "Roma", seoKeywords: ["roma imparatorlugu", "roma tarihi"], createdAt: now });
    if (prompt.includes("documentary scene planner"))
      return JSON.stringify({ scenes: CHAPTERS.map((id) => ({ id, title: `Bolum ${id}`, description: `Roma sahnesi ${id}`, visualPrompt: `Roma forumu, lejyonlar, sahne ${id}, sinematik`, duration: CHAPTER_DUR })), createdAt: now });
    return "";
  }
}
class Img implements ImageProvider {
  readonly name = "openai" as const;
  createImmutableImageDispatchAdapter() { return createProviderDispatchAdapter(this, { metadata: { name: this.name }, requiredMethods: ["generateImage"] }); }
  async generateImage(input: Parameters<ImageProvider["generateImage"]>[0]) {
    const id = `smoke-image-${input.sceneId}`;
    const saved = ImageStorage.saveImage({ projectSlug: input.projectSlug!, assetId: id, data: png(), mimeType: "image/png" });
    return { success: true as const, id, sceneId: input.sceneId, provider: this.name, model: "smoke-image-v1", ...saved, mimeType: "image/png" as const, createdAt: now };
  }
}
class Aud implements AudioProvider {
  readonly name = "openai" as const;
  createImmutableAudioDispatchAdapter() { return createProviderDispatchAdapter(this, { metadata: { name: this.name }, requiredMethods: ["validateInput", "generateAudio"] }); }
  validateInput() {}
  async generateAudio(input: Parameters<AudioProvider["generateAudio"]>[0]) {
    const target = input.target;
    const id = target.kind === "mix" ? "smoke-audio-mix" : `smoke-audio-${target.chapterId}`;
    const seconds = target.kind === "mix" ? CHAPTER_DUR * CHAPTERS.length : CHAPTER_DUR;
    const saved = AudioStorage.saveAudio({ projectSlug: input.projectSlug, assetId: id, data: wav(seconds) });
    return { success: true as const, target: input.target, provider: this.name, model: "smoke-audio-v1", ...saved, createdAt: now };
  }
}
class Thumb implements ThumbnailProvider {
  readonly name = "openai" as const;
  createImmutableThumbnailDispatchAdapter() { return createProviderDispatchAdapter(this, { metadata: { name: this.name }, requiredMethods: ["generateThumbnailPlan", "generateThumbnailAsset"] }); }
  async generateThumbnailPlan(input: Parameters<ThumbnailProvider["generateThumbnailPlan"]>[0]) {
    const t = createMockThumbnailData(input);
    return { provider: this.name, model: "smoke-thumb-plan-v1", status: "planned" as const, thumbnail: { ...t, provider: this.name, model: "smoke-thumb-plan-v1" } };
  }
  async generateThumbnailAsset(input: Parameters<ThumbnailProvider["generateThumbnailAsset"]>[0]) {
    const assetId = "smoke-thumbnail";
    return { success: true as const, assetId, provider: this.name, model: "smoke-thumb-v1", status: "generated" as const, generationMode: "production" as const, ...ThumbnailStorage.saveThumbnail({ projectSlug: input.projectSlug, assetId, data: png(1280, 720), mimeType: "image/png" }), createdAt: now };
  }
}
class YT implements YouTubeProvider {
  readonly name = "mock" as const;
  readonly model = "smoke-youtube-v1";
  createImmutableYoutubeDispatchAdapter() { return createProviderDispatchAdapter(this, { metadata: { name: this.name, model: this.model }, requiredMethods: ["generatePublishingPackage"] }); }
  async generatePublishingPackage() {
    return { success: true as const, provider: this.name, model: this.model, draft: { title: "Roma'nin Yukselisi", description: "Roma imparatorlugunun yukselisini anlatan smoke paketi metni.", tags: ["Roma", "Tarih"], hashtags: ["#Roma", "#Tarih"], chapters: [{ startSeconds: 0, title: "Bolum 1" }], pinnedComment: "Roma hakkinda ne dusunuyorsunuz?", thumbnailText: "ROMA" } };
  }
}

async function main() {
  if (!ffmpegPath || !ffprobePath || !fsSync.existsSync(ffmpegPath) || !fsSync.existsSync(ffprobePath)) {
    process.stdout.write(
      "SKIP: FFMPEG_PATH / FFPROBE_PATH unset or pointing at missing binaries — real FFmpeg is a " +
      "host dependency for this suite (same as smoke-production-scene-video-rendering).\n",
    );
    emitSmokeResult(SUITE, 0);
    return;
  }

  let scenarios = 0;
  await withCanonicalSmokeRuntime({
    name: SUITE,
    projectSlug: slug,
    operationType: "pipeline.run",
    environment: {
      ATOLYE_DURABLE_PIPELINE_EXECUTION: "enabled",
      FFMPEG_PATH: ffmpegPath, FFPROBE_PATH: ffprobePath,
      VIDEO_PROVIDER: "ffmpeg", VIDEO_ASSEMBLY_PROVIDER: "ffmpeg",
      FFMPEG_TIMEOUT_MS: String(10 * 60 * 1000),
    },
  }, async (runtime: CanonicalSmokeRuntime) => {
    const root = path.join(runtime.runtimeStorageContext.projectsRoot, runtime.projectSlug);

    const result = await PipelineRunner.run(topic, {
      stageExecution: {
        aiProvider: new AI(),
        visualAssetProvider: new Img(),
        audioProvider: new Aud(),
        thumbnailProvider: new Thumb(),
        youtubeProvider: new YT(),
        youtubePublishProvider: new MockYouTubePublishProvider(),
        // videoProvider + videoAssemblyProvider intentionally omitted -> real FFmpeg from env.
      },
    });
    assert.equal(result.success, true, `pipeline did not complete: ${result.stopReason}`);
    assert.equal(result.slug, slug);
    scenarios += 1; // full PipelineRunner.run completed

    const manifest = JSON.parse(fsSync.readFileSync(path.join(root, "manifest.json"), "utf8")) as {
      packages?: Record<string, { status?: string }>;
    };
    for (const stage of pipelineRecoveryStageOrder) {
      assert.equal(manifest.packages?.[stage]?.status, "completed", `stage ${stage} not completed`);
    }
    assert.equal(pipelineRecoveryStageOrder.length, 12);
    scenarios += 1; // all 12 stages completed

    const assets = AssetManager.getProjectAssets(slug, result.project.id);
    const video = [...assets.assets].reverse().find((a) => a.type === "video" && a.status === "generated");
    assert.ok(video, "no generated video asset");
    const finalPath = resolveRuntimeLogicalPath(String(video.filePath), runtime.runtimeStorageContext);
    assert.ok(fsSync.existsSync(finalPath), `assembled MP4 missing at ${finalPath}`);
    assert.ok((video.byteLength as number) > 100_000, `assembled MP4 suspiciously small: ${video.byteLength}`);
    scenarios += 1; // real MP4 file materialized

    const probe = JSON.parse(execFileSync(ffprobePath, [
      "-v", "error",
      "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height",
      "-of", "json", finalPath,
    ], { encoding: "utf8" })) as {
      streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number }>;
      format: { format_name: string; duration: string };
    };
    const v = probe.streams.find((s) => s.codec_type === "video");
    const a = probe.streams.find((s) => s.codec_type === "audio");
    assert.equal(v?.codec_name, "h264");
    assert.equal(a?.codec_name, "aac");
    assert.equal(v?.width, 1920);
    assert.equal(v?.height, 1080);
    assert.ok(probe.format.format_name.split(",").includes("mp4"));
    // 3 * 16s = 48s naive; transitioned assembly (cut->fade->crossfade) trims ~1s of blends.
    const duration = Number(probe.format.duration);
    assert.ok(Number.isFinite(duration) && duration > 44 && duration < 49, `unexpected MP4 duration ${duration}`);
    scenarios += 1; // ffprobe: h264/aac 1920x1080, expected duration

    process.stdout.write(`live pipeline produced ${probe.format.duration}s h264/aac 1920x1080 MP4 (${video.byteLength} bytes)\n`);
  });

  emitSmokeResult(SUITE, scenarios);
}

main().catch((err) => { console.error("SMOKE_FAILED", err); process.exitCode = 1; });
