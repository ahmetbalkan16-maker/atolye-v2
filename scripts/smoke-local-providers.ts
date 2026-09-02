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
import { estimateProductionCost } from "../src/lib/production/ProductionCostEstimate";
import {
  isFullyLocalProduction,
  resolveProductionProviderName,
} from "../src/lib/production/ProductionProviderResolution";
import { createProductionAcceptancePortableConfigurationSnapshotV2 } from
  "../src/lib/production/ProductionAcceptanceConfigurationFingerprint";
import type { AIProvider, AIProviderGenerateOptions, AIProviderResult } from "../src/lib/ai/providers/AIProvider";
import { AIManager } from "../src/lib/ai/AIManager";
import { strictGenerationExecutionPolicy } from "../src/lib/ai/GenerationExecutionPolicy";
import { buildScenesResponseJsonSchema } from "../src/lib/ai/SceneStructuredOutput";
import { canonicalSeoProviderSchema } from "../src/lib/seo/SeoStructuredOutput";
import { buildAssemblyResponseJsonSchema } from "../src/lib/assembly/AssemblyStructuredOutput";
import type { ScriptData } from "../src/types/script";
import type { SceneData } from "../src/types/scene";

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
      d.format === "json" && d.timeoutMs === OLLAMA_DEFAULTS.timeoutMs && d.timeoutMs >= 180_000 &&
      d.numCtx === undefined && d.maxRetries === OLLAMA_DEFAULTS.maxRetries,
    "OllamaConfig defaults (num_ctx left to the server)",
  );
  pass(
    resolveOllamaConfig(env({ OLLAMA_NUM_CTX: "16384" })).numCtx === 16_384,
    "OLLAMA_NUM_CTX override accepted",
  );
  assert.throws(() => resolveOllamaConfig(env({ OLLAMA_NUM_CTX: "999" })), OllamaConfigurationError);
  scenarios += 2;
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

  // A truncated reply is re-rolled; the first complete one wins.
  let calls = 0;
  const flaky = new OllamaProvider(
    (async () => {
      calls += 1;
      const truncated = calls < 3;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: { content: truncated ? '{"partial' : '{"ok":true}' },
          done: true,
          done_reason: truncated ? "length" : "stop",
          prompt_eval_count: 5,
          eval_count: 5,
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch,
    () => resolveOllamaConfig(env({ OLLAMA_MAX_RETRIES: "4" })),
  );
  const rolled = (await flaky.generate("x")) as AIProviderResult;
  pass(
    rolled.content === '{"ok":true}' && rolled.complete === true && calls === 3,
    "OllamaProvider re-rolls a truncated reply until one completes",
  );

  // Every attempt truncated -> the last (still-truncated) result is returned, not an error.
  const alwaysTrunc = new OllamaProvider(
    stubFetch({ message: { content: "{" }, done: true, done_reason: "length" }),
    () => resolveOllamaConfig(env({ OLLAMA_MAX_RETRIES: "2" })),
  );
  const exhausted = (await alwaysTrunc.generate("x")) as AIProviderResult;
  pass(exhausted.truncated === true && exhausted.complete === false, "exhausted retries -> truncated result surfaced");

  // OllamaYouTubeProvider: native /api/chat, JSON format, re-rolls a bad reply.
  process.env.YOUTUBE_PROVIDER = "ollama";
  try {
    let ytCalls = 0;
    const ytFetch = (async (url: string, init?: { body?: string }) => {
      ytCalls += 1;
      assert.ok(String(url).endsWith("/api/chat"), "OllamaYouTubeProvider must use native /api/chat");
      const body = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(body.format, "json");
      const bad = ytCalls < 2;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: { content: bad ? "{oops" : '{"title":"T","description":"D","tags":["a"],"chapters":[]}' },
          done_reason: bad ? "length" : "stop",
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const yt = new OllamaYouTubeProvider({ fetcher: ytFetch });
    const pkg = await yt.generatePublishingPackage({
      title: "Kanuni Sultan Süleyman",
      videoDurationSeconds: 120,
      assembly: { scenes: [{ sceneId: 1, duration: 10, notes: "" }] },
      thumbnail: { textSuggestion: "Kanuni" },
      seo: { titleSuggestions: ["Kanuni"], description: "d", tags: ["t"], hashtags: ["#k"] },
    } as unknown as Parameters<OllamaYouTubeProvider["generatePublishingPackage"]>[0]);
    pass(pkg.success === true && ytCalls === 2, "OllamaYouTubeProvider re-rolls a malformed package reply");
  } finally {
    delete process.env.YOUTUBE_PROVIDER;
  }
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

  // Provider-aware production cost estimate: the target chain (ollama LLM/anim/
  // youtube + real photos + OpenAI TTS + OpenAI thumbnail).
  const base = {
    chapterCount: 6, sceneCount: 16, narrationCharacters: 9000, plannedAiImageCount: 6,
    textModel: "gpt-4.1-mini", ttsModel: "tts-1",
    imageModel: "gpt-image-1", imageSize: "1536x1024", imageQuality: "auto",
  };
  const chain = estimateProductionCost({
    ...base,
    textProvider: "ollama", animationProvider: "ollama", youtubeProvider: "ollama",
    ttsProvider: "openai", imageProvider: "real", thumbnailProvider: "openai",
  }, { budgetUsd: 1 });
  pass(chain.status === "known", "provider-aware estimate resolves to known");
  pass(chain.breakdown.llmUsd === 0, "AI_PROVIDER=ollama -> LLM $0");
  pass(chain.breakdown.animationUsd === 0, "ANIMATION_PROVIDER=ollama -> animation $0");
  pass(chain.breakdown.youtubeUsd === 0, "YOUTUBE_PROVIDER=ollama -> youtube $0");
  pass(chain.breakdown.imageUsd === 0, "IMAGE_PROVIDER=real -> AI image $0");
  pass(chain.breakdown.ttsUsd > 0, "AUDIO_PROVIDER=openai -> TTS billed");
  pass(chain.breakdown.thumbnailUsd > 0, "THUMBNAIL_PROVIDER=openai -> thumbnail billed (not hidden)");
  pass(
    Math.abs(chain.totalUsd - (chain.breakdown.ttsUsd + chain.breakdown.thumbnailUsd)) < 1e-9,
    "total = TTS + thumbnail only",
  );
  // All-OpenAI (defaults) is unchanged: everything bills.
  const allOpenAi = estimateProductionCost(base, { budgetUsd: 1 });
  pass(
    allOpenAi.breakdown.llmUsd > 0 && allOpenAi.breakdown.imageUsd === 0.063 * 6,
    "default providers still price as OpenAI",
  );
  // Local thumbnail zeroes that line.
  const localThumb = estimateProductionCost({ ...base, thumbnailProvider: "local" }, { budgetUsd: 1 });
  pass(localThumb.breakdown.thumbnailUsd === 0, "THUMBNAIL_PROVIDER=local -> thumbnail $0");
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

// I — strict-path grammar (JSON Schema) contract + forwarding ----------------
function strictScript(): ScriptData {
  return {
    topic: "Kanuni Sultan Süleyman", title: "Kanuni", subtitle: "Zirve",
    hook: "1526, Mohaç.", introduction: "1520'de tahta çıktı.",
    chapters: Array.from({ length: 5 }, (_, i) => ({
      id: i + 1, title: `Bölüm ${i + 1}`, narration: "Tarihsel anlatım paragrafı.",
      duration: 20, visualGoal: "Sinematik sahne", emotion: "epik", transition: "kesme",
    })),
    conclusion: "Zirve geride kaldı.", callToAction: "Abone olun.",
    estimatedDuration: 100, narrationWordCount: 90, targetAudience: "genel", language: "tr",
    voiceStyle: "belgesel", musicStyle: "sinematik", thumbnailIdea: "Portre",
    seoKeywords: ["Kanuni"], createdAt: "2026-09-01T12:00:00.000Z",
  };
}

function strictScenes(): SceneData {
  return {
    scenes: Array.from({ length: 10 }, (_, i) => ({
      id: i + 1, chapterId: Math.floor(i / 2) + 1, title: `Sahne ${i + 1}`,
      description: "Sinematik açıklama.", visualPrompt: "Tarihi sahne, sinematik.", duration: 10,
    })),
    createdAt: "2026-09-01T12:00:00.000Z",
  } as SceneData;
}

async function strictGrammarForwarding() {
  // --- schema shape -------------------------------------------------------
  const sceneSchema = buildScenesResponseJsonSchema(strictScript(), env({}));
  const scenesProp = (sceneSchema.properties as Record<string, { type?: string; minItems?: number; maxItems?: number; prefixItems?: Array<{ additionalProperties?: boolean; required?: string[]; properties?: Record<string, { const?: number; minLength?: number }> }> }>).scenes;
  const prefix = scenesProp.prefixItems ?? [];
  pass(
    sceneSchema.type === "object" && sceneSchema.additionalProperties === false &&
      (sceneSchema.required as string[]).includes("scenes") &&
      scenesProp.type === "array" &&
      scenesProp.minItems === prefix.length && scenesProp.maxItems === prefix.length &&
      prefix.length >= 5 && prefix.length % 5 === 0 &&
      prefix.every((it, i) => it.additionalProperties === false &&
        ["id", "chapterId", "title", "description", "visualPrompt", "duration"].every((f) => it.required!.includes(f)) &&
        it.properties!.id.const === i + 1 &&
        it.properties!.title.minLength === 1),
    "buildScenesResponseJsonSchema: prefixItems pins id per position, closed scene items, count fixed",
  );
  // Every chapter gets ≥1 pinned slot, in non-decreasing order.
  const pinnedChapters = prefix.map((it) => it.properties!.chapterId.const);
  assert.deepEqual([...new Set(pinnedChapters)].sort((a, b) => (a ?? 0) - (b ?? 0)), [1, 2, 3, 4, 5],
    "scenes schema: every script chapter is covered by a pinned slot");
  assert.ok(pinnedChapters.every((c, i) => i === 0 || (c ?? 0) >= (pinnedChapters[i - 1] ?? 0)),
    "scenes schema: pinned chapterIds are non-decreasing");
  scenarios += 2;

  const seoSchema = canonicalSeoProviderSchema.jsonSchema;
  const seoProps = seoSchema.properties as Record<string, { type?: string }>;
  pass(
    seoSchema.additionalProperties === false &&
      (seoSchema.required as string[]).length === 8 &&
      ["titleSuggestions", "tags", "hashtags", "keywords"].every((f) => (seoProps[f] as { type?: string }).type === "array") &&
      ["description", "targetAudience", "searchIntent", "createdAt"].every((f) => seoProps[f].type === "string"),
    "canonicalSeoProviderSchema: 8 required, tags/keywords are arrays (not strings)",
  );

  const asmSchema = buildAssemblyResponseJsonSchema(strictScenes());
  const asmScene = ((asmSchema.properties as Record<string, { minItems?: number; maxItems?: number; items?: { properties?: Record<string, unknown>; required?: string[] } }>).scenes);
  pass(
    asmScene.minItems === 10 && asmScene.maxItems === 10 &&
      !("animationAssetId" in asmScene.items!.properties!) &&
      !("videoAssetId" in asmScene.items!.properties!) &&
      !("audioAssetId" in asmScene.items!.properties!) &&
      ((asmSchema.properties as Record<string, { properties?: Record<string, { enum?: string[] }> }>).render.properties!.status.enum?.[0]) === "planned",
    "buildAssemblyResponseJsonSchema: scenes pinned to source count, no AI-authored asset id fields, render.status=planned",
  );

  // --- OllamaProvider forwards jsonSchema as the request `format` --------
  let capturedFormat: unknown;
  const capturingFetch = (async (_url: string, init?: { body?: string }) => {
    capturedFormat = JSON.parse(String(init?.body ?? "{}")).format;
    return { ok: true, status: 200, json: async () => ({ message: { content: "{}" }, done: true, done_reason: "stop" }) } as unknown as Response;
  }) as unknown as typeof fetch;
  const schemaProvider = new OllamaProvider(capturingFetch, () => resolveOllamaConfig(env({})));
  await schemaProvider.generate("x", { jsonSchema: { type: "object", additionalProperties: false } });
  pass(
    JSON.stringify(capturedFormat) === JSON.stringify({ type: "object", additionalProperties: false }),
    "OllamaProvider.generate({jsonSchema}) -> request format is the schema",
  );
  await schemaProvider.generate("x");
  pass(capturedFormat === "json", "OllamaProvider.generate() with no schema -> request format stays \"json\"");

  // --- managers forward jsonSchema only on the fail-closed path ----------
  await withCanonicalSmokeRuntime(
    { name: "strict-grammar-forwarding", environment: { AI_PROVIDER: "ollama" } },
    async () => {
      const seen: Array<AIProviderGenerateOptions | undefined> = [];
      const captureProvider: AIProvider = {
        generate: async (_prompt: string, options?: AIProviderGenerateOptions) => {
          seen.push(options);
          return JSON.stringify({ scenes: [] });
        },
      };
      const sc = strictScript();
      await AIManager.runScenes(sc, { projectSlug: "unknown" }, captureProvider, strictGenerationExecutionPolicy, null).catch(() => undefined);
      await AIManager.runScenes(sc, { projectSlug: "unknown" }, captureProvider, undefined, null).catch(() => undefined);
      pass(
        seen[0]?.jsonSchema !== undefined && (seen[0]?.jsonSchema as { properties?: Record<string, unknown> })?.properties?.scenes !== undefined,
        "AIManager.runScenes(strict) forwards the scenes JSON Schema to the provider",
      );
      pass(
        seen[1]?.jsonSchema === undefined,
        "AIManager.runScenes(non-strict) forwards NO jsonSchema (bit-identical legacy path)",
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
  await strictGrammarForwarding();
  await live();
  await localThumbnailEndToEnd();
  console.log(`local providers smoke: PASS (${scenarios} scenarios)`);
  emitSmokeResult("local-providers", scenarios);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
