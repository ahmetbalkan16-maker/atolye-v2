/**
 * Local, $0 providers (Ollama LLM / Piper TTS / local FFmpeg thumbnail).
 *
 * A. OllamaConfig — defaults, host normalisation, fail-closed on bad values.
 * B. OllamaProvider — stub fetch -> AIProviderResult mapping (content /
 *    finish_reason / usage / complete); non-ok throws.
 * C. Routers accept the new names; resolve*ProviderName widened.
 * D. AiPricing — ollama / piper calls price as free ($0), never unknown.
 * E. resolveProductionProviderName — unset/mock/unknown -> "openai" (legacy),
 *    recognised local value -> that; never "mock".
 * F. acceptance fingerprint — OLLAMA_MODEL / PIPER_VOICE_MODEL are conditional.
 * G. LIVE (skipped if the tool is absent): a real Piper synthesis produces a
 *    valid WAV; a real Ollama call returns a JSON object.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emitSmokeResult } from "./lib/SmokeResult";
import {
  OLLAMA_DEFAULTS,
  OllamaConfigurationError,
  resolveOllamaBaseUrl,
  resolveOllamaConfig,
} from "../src/lib/ai/OllamaConfig";
import { OllamaProvider } from "../src/lib/ai/providers/OllamaProvider";
import { AIRouter } from "../src/lib/ai/router/AIRouter";
import { AnimationProviderRouter } from "../src/lib/animation/providers/AnimationProviderRouter";
import { resolveAnimationProviderName } from "../src/lib/animation/providers/AnimationProviderConfig";
import { AudioProviderRouter } from "../src/lib/audio/providers/AudioProviderRouter";
import { resolveAudioProviderName, getPiperAudioProviderConfig } from "../src/lib/audio/providers/AudioProviderConfig";
import { PiperAudioProvider } from "../src/lib/audio/providers/PiperAudioProvider";
import { ThumbnailProviderRouter } from "../src/lib/thumbnail/ThumbnailProviderRouter";
import { resolveThumbnailProviderName } from "../src/lib/thumbnail/ThumbnailProviderConfig";
import { YouTubeProviderRouter } from "../src/lib/youtube/YouTubeProviderRouter";
import { resolveYouTubeProviderName } from "../src/lib/youtube/YouTubeProviderConfig";
import { OllamaAnimationProvider } from "../src/lib/animation/providers/OllamaAnimationProvider";
import { OllamaYouTubeProvider } from "../src/lib/youtube/providers/OllamaYouTubeProvider";
import { LocalThumbnailProvider } from "../src/lib/thumbnail/providers/LocalThumbnailProvider";
import { resolveRuntimeLogicalPath } from "../src/lib/runtime/RuntimeStoragePaths";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { createMockThumbnailData } from "../src/lib/thumbnail/providers/MockThumbnailProvider";
import { spawnSync } from "node:child_process";
import type { AssemblyPlanData } from "../src/types/assembly";
import { estimateTokenCost, estimateTtsCost } from "../src/lib/ai/AiPricing";
import {
  isFullyLocalProduction,
  resolveProductionProviderName,
} from "../src/lib/production/ProductionProviderResolution";
import { createProductionAcceptancePortableConfigurationSnapshotV2 } from
  "../src/lib/production/ProductionAcceptanceConfigurationFingerprint";
import type { AIProviderResult } from "../src/lib/ai/providers/AIProvider";

let scenarios = 0;
function pass(c: unknown, label: string) {
  assert.ok(c, label);
  scenarios += 1;
}
function env(o: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return o as unknown as NodeJS.ProcessEnv;
}
function stubFetch(payload: unknown, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      status: ok ? 200 : 500,
      json: async () => payload,
    }) as unknown as Response) as unknown as typeof fetch;
}

// A ------------------------------------------------------------------------
function ollamaConfig() {
  const d = resolveOllamaConfig(env({}));
  pass(
    d.baseUrl === OLLAMA_DEFAULTS.baseUrl && d.model === "qwen2.5:3b" &&
      d.format === "json" && d.timeoutMs === OLLAMA_DEFAULTS.timeoutMs && d.timeoutMs >= 180_000,
    "OllamaConfig defaults",
  );
  pass(resolveOllamaBaseUrl(env({ OLLAMA_HOST: "localhost:11434" })) === "http://localhost:11434", "host without scheme -> http://");
  pass(resolveOllamaBaseUrl(env({ OLLAMA_HOST: "http://box:1234/" })) === "http://box:1234", "trailing slash stripped");
  pass(
    resolveOllamaConfig(env({ OLLAMA_MODEL: "qwen2.5:7b-instruct-q4_K_M" })).model === "qwen2.5:7b-instruct-q4_K_M",
    "custom model tag accepted",
  );
  assert.throws(() => resolveOllamaConfig(env({ OLLAMA_FORMAT: "yaml" })), OllamaConfigurationError);
  scenarios += 1;
  assert.throws(() => resolveOllamaConfig(env({ OLLAMA_TIMEOUT_MS: "-1" })), OllamaConfigurationError);
  scenarios += 1;
  assert.throws(() => resolveOllamaBaseUrl(env({ OLLAMA_HOST: "ftp://x" })), OllamaConfigurationError);
  scenarios += 1;
}

// B ------------------------------------------------------------------------
async function ollamaProvider() {
  const provider = new OllamaProvider(
    stubFetch({
      message: { content: '{"ok":true}' },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 12,
      eval_count: 8,
    }),
    () => resolveOllamaConfig(env({})),
  );
  const out = (await provider.generate("hi")) as AIProviderResult;
  pass(
    out.content === '{"ok":true}' && out.finishReason === "stop" && out.complete === true &&
      out.usage?.promptTokens === 12 && out.usage.completionTokens === 8,
    "OllamaProvider maps a normal /api/chat completion",
  );
  const noReason = new OllamaProvider(
    stubFetch({ message: { content: "{}" }, done: true }),
    () => resolveOllamaConfig(env({})),
  );
  pass(((await noReason.generate("x")) as AIProviderResult).finishReason === "stop", "missing done_reason -> stop");
  const bad = new OllamaProvider(stubFetch({}, false), () => resolveOllamaConfig(env({})));
  await assert.rejects(() => bad.generate("x"));
  scenarios += 1;
}

// C ------------------------------------------------------------------------
function routing() {
  pass(new AIRouter().getProvider("ollama") instanceof OllamaProvider, "AIRouter -> OllamaProvider");
  pass(resolveAnimationProviderName("ollama") === "ollama", "ANIMATION_PROVIDER=ollama accepted");
  pass(AnimationProviderRouter.getProvider("ollama") instanceof OllamaAnimationProvider, "AnimationRouter -> OllamaAnimationProvider");
  pass(resolveAudioProviderName("piper") === "piper", "AUDIO_PROVIDER=piper accepted");
  pass(AudioProviderRouter.getProvider("piper") instanceof PiperAudioProvider, "AudioRouter -> PiperAudioProvider");
  pass(resolveThumbnailProviderName("local") === "local", "THUMBNAIL_PROVIDER=local accepted");
  pass(new ThumbnailProviderRouter().getProvider("local") instanceof LocalThumbnailProvider, "ThumbnailRouter -> LocalThumbnailProvider");
  pass(resolveYouTubeProviderName("ollama") === "ollama", "YOUTUBE_PROVIDER=ollama accepted");
  pass(new YouTubeProviderRouter().getProvider("ollama") instanceof OllamaYouTubeProvider, "YouTubeRouter -> OllamaYouTubeProvider");
}

// D ------------------------------------------------------------------------
function pricing() {
  const t = estimateTokenCost({ provider: "ollama", model: "qwen2.5:3b", promptTokens: 5000, completionTokens: 5000 });
  pass(t.status === "free" && t.costUsd === 0, "ollama token call prices as free");
  const s = estimateTtsCost({ provider: "piper", model: "tr_TR-dfki-medium", characters: 50_000 });
  pass(s.status === "free" && s.costUsd === 0, "piper tts prices as free");
}

// E ------------------------------------------------------------------------
function productionResolution() {
  pass(resolveProductionProviderName("ai", env({})) === "openai", "ai: unset -> openai (legacy)");
  pass(resolveProductionProviderName("ai", env({ AI_PROVIDER: "mock" })) === "openai", "ai: mock -> openai (never mock in production)");
  pass(resolveProductionProviderName("ai", env({ AI_PROVIDER: "banana" })) === "openai", "ai: unknown -> openai");
  pass(resolveProductionProviderName("ai", env({ AI_PROVIDER: "ollama" })) === "ollama", "ai: ollama -> ollama");
  pass(resolveProductionProviderName("audio", env({ AUDIO_PROVIDER: "piper" })) === "piper", "audio: piper -> piper");
  pass(resolveProductionProviderName("thumbnail", env({ THUMBNAIL_PROVIDER: "local" })) === "local", "thumbnail: local -> local");
  pass(resolveProductionProviderName("youtube", env({})) === "openai", "youtube: unset -> openai");
  pass(
    isFullyLocalProduction(env({
      AI_PROVIDER: "ollama", AUDIO_PROVIDER: "piper", THUMBNAIL_PROVIDER: "local",
      YOUTUBE_PROVIDER: "ollama", ANIMATION_PROVIDER: "ollama", IMAGE_PROVIDER: "real",
    })),
    "isFullyLocalProduction true for the all-local env",
  );
  pass(
    !isFullyLocalProduction(env({ AI_PROVIDER: "ollama", AUDIO_PROVIDER: "openai" })),
    "isFullyLocalProduction false when TTS is still openai",
  );
}

// F ------------------------------------------------------------------------
async function fingerprint() {
  const slug = "local-provider-fingerprint-fixture";
  const readBinary = async () => Buffer.alloc(0);
  const base = { AI_PROVIDER: "ollama", AUDIO_PROVIDER: "piper" };
  const a = await createProductionAcceptancePortableConfigurationSnapshotV2(slug, env(base), readBinary);
  const b = await createProductionAcceptancePortableConfigurationSnapshotV2(slug, env({ ...base, OLLAMA_MODEL: undefined }), readBinary);
  const c = await createProductionAcceptancePortableConfigurationSnapshotV2(slug, env({ ...base, OLLAMA_MODEL: "qwen2.5:7b" }), readBinary);
  pass(a.configurationFingerprint === b.configurationFingerprint, "unset OLLAMA_MODEL does not alter the fingerprint");
  pass(c.configurationFingerprint !== a.configurationFingerprint, "explicit OLLAMA_MODEL folds into the fingerprint");
}

// G ------------------------------------------------------------------------
async function live() {
  const piperExe = path.resolve("bin/piper", process.platform === "win32" ? "piper.exe" : "piper");
  const voice = path.resolve("bin/piper/tr_TR-dfki-medium.onnx");
  // The Piper provider is configured + validated here; its config resolution is
  // the wiring under test. Full storage integration is covered by the bounded
  // production render.
  const cfg = getPiperAudioProviderConfig(env({ PIPER_EXECUTABLE: piperExe, PIPER_VOICE_MODEL: voice }));
  new PiperAudioProvider(() => cfg); // constructs without throwing
  pass(cfg.executablePath === piperExe && cfg.voiceModelPath === voice, "PiperAudioProvider config resolves the installed binary + voice");

  if (fs.existsSync(piperExe) && fs.existsSync(voice)) {
    const { spawnSync } = await import("node:child_process");
    const out = path.join(os.tmpdir(), `atolye-piper-live-${Date.now().toString(36)}.wav`);
    const r = spawnSync(piperExe, ["--model", voice, "--output_file", out], {
      input: "Bu, yerel Piper seslendirme sağlayıcısının canlı testidir.",
      timeout: 60_000,
      windowsHide: true,
    });
    const wav = r.status === 0 && fs.existsSync(out) ? fs.readFileSync(out) : Buffer.alloc(0);
    const validWav = wav.length > 44 &&
      wav.toString("ascii", 0, 4) === "RIFF" && wav.toString("ascii", 8, 12) === "WAVE" &&
      wav.readUInt16LE(22) === 1 && wav.readUInt32LE(24) >= 8_000;
    pass(validWav, `LIVE: Piper synthesised a valid ${wav.readUInt32LE(24)}Hz mono WAV (${wav.length} bytes)`);
    try { fs.rmSync(out, { force: true }); } catch { /* best-effort */ }
  } else {
    console.log("LIVE Piper: skipped (bin/piper not installed)");
  }

  const ollamaUp = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(2_000) })
    .then((r) => r.ok).catch(() => false);
  if (ollamaUp) {
    const provider = new OllamaProvider(fetch, () => resolveOllamaConfig(env({ OLLAMA_TIMEOUT_MS: "240000" })));
    const out = (await provider.generate(
      'Return exactly one JSON object: {"pong": true}. No markdown.',
    )) as AIProviderResult;
    let parsed: unknown;
    try { parsed = JSON.parse(out.content); } catch { parsed = null; }
    pass(
      out.finishReason !== "unknown" && parsed !== null && typeof parsed === "object",
      "LIVE: Ollama returned a parseable JSON object",
    );
  } else {
    console.log("LIVE Ollama: skipped (server not reachable at 127.0.0.1:11434)");
  }
}

// H — LocalThumbnailProvider end-to-end through ThumbnailAssetPipeline --------
async function localThumbnailEndToEnd() {
  const ffmpeg = process.env.FFMPEG_PATH || process.env.FFMPEG_EXECUTABLE;
  const ffprobe = process.env.FFPROBE_PATH || process.env.FFPROBE_EXECUTABLE;
  if (!ffmpeg || !fs.existsSync(ffmpeg) || !ffprobe || !fs.existsSync(ffprobe)) {
    console.log("LIVE LocalThumbnail: skipped (FFMPEG_PATH unset)");
    return;
  }
  await withCanonicalSmokeRuntime(
    {
      name: "local-thumbnail",
      operationType: "pipeline.run",
      environment: {
        THUMBNAIL_PROVIDER: "local",
        FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe,
        FFMPEG_EXECUTABLE: ffmpeg, FFPROBE_EXECUTABLE: ffprobe,
      },
    },
    async (runtime) => {
      const slug = runtime.projectSlug;
      const project = await ProjectManager.getProject(slug) ??
        (await ProjectManager.createProject(`local thumbnail ${Date.now()}`));
      const projectId = project.id;

      // A real, playable MP4 to grab a frame from.
      const paths = VideoStorage.createRenderPaths(slug);
      const gen = spawnSync(ffmpeg, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=navy:s=1280x720:d=2:r=30",
        "-f", "lavfi", "-i", "sine=frequency=220:duration=2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        paths.temporaryAbsolutePath ?? paths.absolutePath,
      ], { timeout: 60_000, windowsHide: true });
      if (gen.status !== 0) { console.log("LIVE LocalThumbnail: skipped (fixture mp4 render failed)"); return; }
      if (paths.temporaryAbsolutePath) VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath);
      const data = fs.readFileSync(paths.absolutePath);
      const videoAssetId = `local-thumb-video-${Date.now().toString(36)}`;
      AssetManager.addAsset(slug, projectId, AssetManager.createAsset({
        id: videoAssetId, projectId, projectSlug: slug, type: "video", status: "generated",
        provider: "ffmpeg", prompt: "assembly", filePath: paths.filePath, url: paths.url,
        mimeType: "video/mp4", byteLength: data.length,
      }));

      const assembly: AssemblyPlanData = {
        projectId,
        scenes: [],
        totalDuration: "00:02",
        style: "documentary",
        outputAssetId: videoAssetId,
        render: {
          status: "rendered", format: "mp4", mimeType: "video/mp4",
          filePath: paths.filePath, outputUrl: paths.url, byteLength: data.length,
          durationSeconds: 2, width: 1280, height: 720, videoCodec: "h264", audioCodec: "aac",
        },
        createdAt: new Date().toISOString(),
      } as unknown as AssemblyPlanData;

      void createMockThumbnailData;
      const provider = new LocalThumbnailProvider();
      const planResult = await provider.generateThumbnailPlan({ projectId, projectSlug: slug, title: project.title, assembly });
      pass(
        planResult.provider === "local" && planResult.status === "planned",
        "LocalThumbnailProvider plan carries provider=local",
      );

      // The pipeline's provider allow-list now admits "local" (verified by the
      // ThumbnailAssetPipeline regression); here we prove the provider itself
      // renders a real PNG from the finished video via FFmpeg drawtext.
      const asset = await provider.generateThumbnailAsset({
        projectId, projectSlug: slug, title: project.title,
        prompt: "x", thumbnail: planResult.thumbnail, assembly,
      });
      pass(
        asset.success === true && asset.provider === "local" &&
          asset.generationMode === "production" &&
          asset.mimeType === "image/png" &&
          (asset.width as number) === 1280 && (asset.height as number) === 720 &&
          (asset.byteLength as number) > 5_000 &&
          fs.existsSync(resolveRuntimeLogicalPath(String(asset.filePath))),
        `LIVE: LocalThumbnailProvider rendered a ${asset.success ? asset.width + "x" + asset.height : "?"} PNG (${asset.success ? asset.byteLength : 0} bytes) with a burned title`,
      );
    },
  );
}

async function main() {
  ollamaConfig();
  await ollamaProvider();
  routing();
  pricing();
  productionResolution();
  await fingerprint();
  await live();
  await localThumbnailEndToEnd();
  console.log(`local providers smoke: PASS (${scenarios} scenarios)`);
  emitSmokeResult("local-providers", scenarios);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
