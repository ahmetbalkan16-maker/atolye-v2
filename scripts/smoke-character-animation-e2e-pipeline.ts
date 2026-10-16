/**
 * Isolated end-to-end coverage of the stick-figure animation mode through the
 * FULL live pipeline entry point (`PipelineRunner.run` — exactly what
 * `POST /api/pipeline` invokes), DURABLE execution enabled, REAL FFmpeg for the
 * scene-video and final assembly stages, the real `CharacterImageProvider`
 * for the visuals stage and the real local Piper voice for audio: since
 * 2026-10-13 a character scene (`NARRATION_DIRECTION_V3`) is assembled only
 * after local Whisper aligns real speech to its sentences, so a synthetic tone
 * can never pass. Text, thumbnail and YouTube use deterministic fixture
 * providers (no model, no paid call). Derived from
 * `smoke-isolated-e2e-live-pipeline-ffmpeg.ts`.
 *
 * Proves that every scene is a labelled, $0 stick-figure reenactment, that the
 * scene videos really move (frames differ inside one scene), and that all 12
 * stages complete into a 1920x1080 h264/aac MP4 as long as the measured narration.
 * `SMOKE_CHARACTER_E2E_FRAMES_DIR` (optional) receives a few PNG frames of the
 * final video for a human look.
 *
 * SKIPS (exit 0, PASS 0) when FFMPEG_PATH / FFPROBE_PATH, the Piper voice
 * (PIPER_EXECUTABLE / PIPER_VOICE_MODEL, default bin/piper) or local Whisper
 * (AYAS_WHISPER_EXECUTABLE / AYAS_WHISPER_MODEL) are missing, or the temp dir
 * is not ASCII — all host preconditions. A skip is not validation evidence
 * (AyasMutationValidators).
 */
import assert from "node:assert/strict";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { CharacterImageProvider } from "../src/lib/assets/providers/CharacterImageProvider";
import { readCharacterScenePayload } from "../src/lib/animation/character/CharacterSceneAsset";
import { estimateNarrationSeconds } from "../src/lib/ai/NarrationDurationEstimator";
import { getPiperAudioProviderConfig } from "../src/lib/audio/providers/AudioProviderConfig";
import { PiperAudioProvider } from "../src/lib/audio/providers/PiperAudioProvider";
import { resolveAyasSttConfig } from "../src/lib/ayas/stt/AyasSttConfig";
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
import type { AudioData } from "../src/types/audio";
import type { ThumbnailProvider } from "../src/lib/thumbnail/providers/ThumbnailProvider";
import type { YouTubeProvider } from "../src/lib/youtube/providers/YouTubeProvider";

const SUITE = "character-animation-e2e-pipeline";
const ffmpegPath = process.env.FFMPEG_PATH;
const ffprobePath = process.env.FFPROBE_PATH;

const topic = "Smoke Cop Adam - Konstantiniye Kusatmasi";
/** One stick-figure scene per chapter: a march on the walls, a leader's speech, a victory. */
const SCENE_PROMPTS = [
  "Osmanli ordusu gece surlara dogru ilerliyor, Bizans savunuculari bekliyor",
  "Padisah ordusunun onunde durup son hucum icin emir veriyor",
  "Zafer! Askerler sancakla kutlama yapiyor, surlar dustu",
];
const slug = ProjectManager.createSlug(topic);
const now = new Date().toISOString();
const CHAPTER_DUR = 16;
const CHAPTERS = [1, 2, 3];
/**
 * Must narrate for about CHAPTER_DUR seconds: the strict script path derives each chapter's (and so each scene
 * clip's) duration from the narration text (NarrationDurationEstimator, ~14 chars/s), and assembly then targets the
 * real spoken length. A much shorter text renders short clips against long narration, which the assembly coverage
 * guard rightly refuses (VIDEO_DURATION_COVERAGE_FAILED: the earlier ~7s text against a fixed 16s tone). Proper
 * Turkish spelling so Piper speaks it and Whisper can align it.
 */
const narration = (id: number) => `Roma tarihinin ${id}. bölümünde lejyonlar sınırlara doğru ilerliyor, şehir her yıl biraz daha büyüyor, senato yeni yasaları tartışıyor, tüccarlar limanları dolduruyor ve imparatorluk yavaş yavaş bugün bilinen güçlü şekline kavuşuyor.`;

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
class AI implements AIProvider {
  createImmutableAiDispatchAdapter() { return createProviderDispatchAdapter(this, { metadata: { name: "smoke" }, requiredMethods: ["generate"] }); }
  async generate(prompt: string) {
    if (prompt.includes("documentary research assistant"))
      return JSON.stringify({ topic, summary: "Roma yukselisi deterministik arastirma metni.", historicalContext: "MO 8. yuzyil", timeline: ["MO 753: kurulus", "MO 509: cumhuriyet"], characters: ["Romulus", "Sezar"], locations: ["Roma", "Forum"], keyEvents: ["Kurulus", "Fetihler"], strategies: ["Lejyon duzeni"], controversies: [], interestingFacts: ["Yedi tepe"], documentaryFlow: ["Kurulus", "Cumhuriyet", "Imparatorluk"], sceneIdeas: ["Forum", "Lejyon"], imagePrompts: ["Roma forumu", "lejyon"], animationPrompts: ["yavas yaklasma"], musicIdeas: ["epik"], soundEffects: ["kalabalik"], thumbnailIdeas: ["Roma"], youtubeTitles: ["Roma'nin Yukselisi"], sources: ["fixture"], createdAt: now });
    if (prompt.includes("documentary script writer"))
      return JSON.stringify({ topic, title: "Roma'nin Yukselisi", subtitle: "Bir imparatorlugun dogusu", hook: "Her sey yedi tepede basladi.", introduction: "Roma kuruldu ve buyudu.", chapters: CHAPTERS.map((id) => ({ id, title: `Bolum ${id}`, narration: narration(id), duration: CHAPTER_DUR, visualGoal: "Roma forumu ve lejyonlar", emotion: "epik", transition: id === 1 ? "cut" : id === 2 ? "fade" : "crossfade" })), conclusion: "Roma bir imparatorluk oldu.", callToAction: "Takip edin.", estimatedDuration: CHAPTER_DUR * CHAPTERS.length, narrationWordCount: 45, targetAudience: "genel", language: "tr", voiceStyle: "documentary", musicStyle: "epic", thumbnailIdea: "Roma", seoKeywords: ["roma imparatorlugu", "roma tarihi"], createdAt: now });
    if (prompt.includes("documentary scene planner"))
      return JSON.stringify({ scenes: CHAPTERS.map((id) => ({ id, chapterId: id, title: `Bolum ${id}`, description: SCENE_PROMPTS[id - 1], visualPrompt: SCENE_PROMPTS[id - 1], duration: CHAPTER_DUR })), createdAt: now });
    return "";
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
  // Pure fixture check, runs even without FFmpeg so a drifted text fails here instead of deep inside assembly.
  for (const id of CHAPTERS) {
    const seconds = estimateNarrationSeconds(narration(id));
    assert.ok(Math.abs(seconds - CHAPTER_DUR) < 0.5, `fixture narration ${id} narrates ~${seconds.toFixed(1)}s, expected ~${CHAPTER_DUR}s`);
  }
  if (!ffmpegPath || !ffprobePath || !fsSync.existsSync(ffmpegPath) || !fsSync.existsSync(ffprobePath)) {
    process.stdout.write(
      "SKIP: FFMPEG_PATH / FFPROBE_PATH unset or pointing at missing binaries — real FFmpeg is a " +
      "host dependency for this suite (same as smoke-production-scene-video-rendering).\n",
    );
    emitSmokeResult(SUITE, 0);
    return;
  }
  const piper = getPiperAudioProviderConfig();
  const stt = resolveAyasSttConfig();
  // Whisper alignment refuses a non-ASCII temp dir (NARRATION_ALIGNMENT_ASCII_TEMP); the live server gets an ASCII one via
  // AYAS_TEMP_ROOT. The canonical smoke runtime places its temp under the RESOLVED temp path, so an ASCII junction
  // (D:\URETIM -> D:\ÜRETİM) does not help here.
  const asciiTemp = /^[\x20-\x7e]+$/.test(fsSync.realpathSync.native(os.tmpdir()));
  if (!fsSync.existsSync(piper.executablePath) || !fsSync.existsSync(piper.voiceModelPath) || !stt.enabled || !asciiTemp) {
    process.stdout.write(
      `SKIP: the local Piper voice, Whisper and an ASCII temp dir are host dependencies for this suite (piper ${fsSync.existsSync(piper.executablePath) ? "found" : "missing"}, ` +
      `voice ${fsSync.existsSync(piper.voiceModelPath) ? "found" : "missing"}, whisper ${stt.enabled ? "ready" : stt.reason ?? "missing"}, temp ${asciiTemp ? "ascii" : "non-ascii"}).\n`,
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
        visualAssetProvider: new CharacterImageProvider(),
        audioProvider: new PiperAudioProvider(() => piper),
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
    const images = assets.assets.filter((a) => a.type === "image" && a.status === "generated");
    assert.equal(images.length, CHAPTERS.length, "one image per scene");
    for (const image of images) {
      assert.equal(image.provider, "character");
      assert.equal(image.selectionReason, "local-character-reenactment");
      assert.equal(image.mediaOrigin, "ai");
      const read = readCharacterScenePayload(fsSync.readFileSync(resolveRuntimeLogicalPath(String(image.filePath), runtime.runtimeStorageContext)));
      assert.equal(read.status, "VALID", `scene ${image.sceneId} carries its animation`);
    }
    scenarios += 1; // every scene is a labelled $0 stick-figure reenactment
    const usagePath = path.join(root, "ai-usage.json");
    const usage = fsSync.existsSync(usagePath) ? JSON.parse(fsSync.readFileSync(usagePath, "utf8")) as { records?: { provider?: string; stage?: string }[] } : {};
    assert.ok(!(usage.records ?? []).some((record) => record.stage === "visuals" && record.provider === "openai"), "no paid image call");

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
    // Assembly follows the real, measured Piper narration; transitioned assembly (cut->fade->crossfade) trims ~1s of blends.
    const audio = await ProjectManager.getAudio(slug, runtime.runtimeStorageContext) as AudioData | null;
    const spoken = (audio?.sections ?? []).map((section) => Number(section.durationSeconds));
    assert.equal(spoken.length, CHAPTERS.length, "one narrated section per chapter");
    assert.ok(spoken.every((seconds) => Number.isFinite(seconds) && seconds > 5), `implausible narration lengths ${spoken.join(",")}`);
    const narrated = spoken.reduce((sum, seconds) => sum + seconds, 0);
    const duration = Number(probe.format.duration);
    assert.ok(Number.isFinite(duration) && duration > narrated - 4 && duration < narrated + 1, `MP4 duration ${duration} does not follow the ${narrated.toFixed(2)}s narration`);
    scenarios += 1; // ffprobe: h264/aac 1920x1080, expected duration

    // The figures move: two moments of the same (first) scene are different pictures.
    const grab = (t: number, size = "96x54") => execFileSync(ffmpegPath, ["-v", "error", "-ss", String(t), "-i", finalPath, "-frames:v", "1",
      "-f", "rawvideo", "-pix_fmt", "gray", "-s", size, "-"]);
    assert.notDeepEqual(grab(1), grab(5), "scene 1 is animated");
    scenarios += 1; // animated, not a still

    const framesDir = process.env.SMOKE_CHARACTER_E2E_FRAMES_DIR;
    if (framesDir) {
      fsSync.mkdirSync(framesDir, { recursive: true });
      for (const t of [1, 4, 8, 18, 22, 34, 40]) {
        execFileSync(ffmpegPath, ["-v", "error", "-y", "-ss", String(t), "-i", finalPath, "-frames:v", "1", "-s", "640x360", path.join(framesDir, `t${String(t).padStart(2, "0")}.png`)]);
      }
    }

    process.stdout.write(`stick-figure pipeline produced ${probe.format.duration}s h264/aac 1920x1080 MP4 (${video.byteLength} bytes)\n`);
  });

  emitSmokeResult(SUITE, scenarios);
}

main().catch((err) => { console.error("SMOKE_FAILED", err); process.exitCode = 1; });
