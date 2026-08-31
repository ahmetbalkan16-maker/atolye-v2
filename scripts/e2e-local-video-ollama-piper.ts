/**
 * Real, $0 end-to-end video: local Ollama (LLM) + Piper (TTS) + local FFmpeg
 * thumbnail + real archival images + FFmpeg render — NO OpenAI, no paid API.
 *
 * Drives `PipelineRunner.run` (the same entry point as `POST /api/pipeline`)
 * with every provider resolved from the environment to its local backend, then
 * ffprobe-verifies the resulting MP4 and prints the per-stage provider + cost
 * ledger.
 *
 *   npx tsx scripts/e2e-local-video-ollama-piper.ts ["<topic>"]
 *
 * Requires: a running Ollama server with the configured model, `bin/piper/`
 * populated, and FFMPEG_PATH / FFPROBE_PATH set (read from the real env / .env.local).
 * SKIPS (exit 0) when Ollama or FFmpeg is unavailable.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { pipelineRecoveryStageOrder } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { MockYouTubePublishProvider } from "../src/lib/youtube/publish/providers/MockYouTubePublishProvider";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { resolveRuntimeLogicalPath } from "../src/lib/runtime/RuntimeStoragePaths";
import { buildProductionCostReport, renderProductionCostReportText } from "../src/lib/production/ProductionCostReport";
import { AIUsageManager } from "../src/lib/ai/AIUsageManager";

// A unique run token keeps the derived slug from ever colliding with a real
// project directory (which would trip the dual-root divergence guard).
const runToken = Date.now().toString(36);
const baseTopic = process.argv[2]?.trim() || "Tüm Dünyayı Korkutan 7 Osmanlı Padişahı";
const topic = `${baseTopic} (yerel test ${runToken})`;
// image backend: `mock` (fast, ugly, proves the $0 chain) | `real` (archival photos)
const imageProvider = process.argv[3]?.trim() || "mock";
const slug = ProjectManager.createSlug(topic);

function loadDotEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of fs.readFileSync(path.resolve(".env.local"), "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m && !line.trimStart().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch { /* optional */ }
  return out;
}

async function ollamaReachable(baseUrl: string): Promise<boolean> {
  try {
    return (await fetch(`${baseUrl}/api/version`, { signal: AbortSignal.timeout(3_000) })).ok;
  } catch {
    return false;
  }
}

async function main() {
  const dotenv = loadDotEnvLocal();
  const ffmpegPath = process.env.FFMPEG_PATH || process.env.FFMPEG_EXECUTABLE ||
    dotenv.FFMPEG_PATH || dotenv.FFMPEG_EXECUTABLE;
  const ffprobePath = process.env.FFPROBE_PATH || process.env.FFPROBE_EXECUTABLE ||
    dotenv.FFPROBE_PATH || dotenv.FFPROBE_EXECUTABLE;
  const ollamaHost = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  const ollamaModel = process.env.OLLAMA_MODEL || dotenv.OLLAMA_MODEL || "qwen2.5:3b";
  const piperExe = path.resolve("bin/piper", process.platform === "win32" ? "piper.exe" : "piper");
  const piperVoice = path.resolve("bin/piper/tr_TR-dfki-medium.onnx");

  if (!ffmpegPath || !fs.existsSync(ffmpegPath) || !ffprobePath || !fs.existsSync(ffprobePath)) {
    console.log("SKIP: FFMPEG_PATH / FFPROBE_PATH not set or missing.");
    return;
  }
  if (!fs.existsSync(piperExe) || !fs.existsSync(piperVoice)) {
    console.log("SKIP: bin/piper not installed.");
    return;
  }
  if (!(await ollamaReachable(ollamaHost))) {
    console.log(`SKIP: Ollama not reachable at ${ollamaHost}.`);
    return;
  }

  console.log(`=== Local $0 video: "${topic}" ===`);
  console.log(`LLM: ollama/${ollamaModel} | TTS: piper/tr_TR-dfki-medium | images: ${imageProvider} | thumbnail: local | render: ffmpeg`);

  const startedAt = Date.now();
  const outcome = await withCanonicalSmokeRuntime({
    name: "e2e-local-video-ollama-piper",
    projectSlug: slug,
    operationType: "pipeline.run",
    environment: {
      NODE_ENV: "test",
      AI_PROVIDER: "ollama",
      ANIMATION_PROVIDER: "ollama",
      AUDIO_PROVIDER: "piper",
      THUMBNAIL_PROVIDER: "local",
      YOUTUBE_PROVIDER: "ollama",
      YOUTUBE_PUBLISH_PROVIDER: "mock",
      IMAGE_PROVIDER: imageProvider,
      ATOLYE_MAX_AI_IMAGES: imageProvider === "real" ? "6" : "0",
      VIDEO_PROVIDER: "ffmpeg",
      VIDEO_ASSEMBLY_PROVIDER: "ffmpeg",
      FFMPEG_PATH: ffmpegPath,
      FFPROBE_PATH: ffprobePath,
      FFMPEG_EXECUTABLE: ffmpegPath,
      FFPROBE_EXECUTABLE: ffprobePath,
      FFMPEG_TIMEOUT_MS: String(15 * 60 * 1000),
      OLLAMA_HOST: ollamaHost,
      OLLAMA_MODEL: ollamaModel,
      OLLAMA_TIMEOUT_MS: process.env.OLLAMA_TIMEOUT_MS || "1800000",
      OLLAMA_MAX_TOKENS: process.env.OLLAMA_MAX_TOKENS || "2048",
      PIPER_EXECUTABLE: piperExe,
      PIPER_VOICE_MODEL: piperVoice,
      PIPER_TIMEOUT_MS: "600000",
      ATOLYE_REAL_MEDIA_DISCOVERY: "on",
      ATOLYE_REAL_MEDIA_SELECTION: "on",
      ATOLYE_AI_COST_GUARD: "on",
      // No OpenAI key at all — a paid call would hard-fail rather than bill.
      OPENAI_API_KEY: undefined,
    },
  }, async (runtime) => {
    const root = path.join(runtime.runtimeStorageContext.projectsRoot, runtime.projectSlug);

    const result = await PipelineRunner.run(topic, {
      stageExecution: {
        // Nothing injected — every provider resolves from the env above.
        youtubePublishProvider: new MockYouTubePublishProvider(),
      },
    });

    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")) as {
      packages?: Record<string, { status?: string; error?: string }>;
    };
    console.log("\n--- stage status ---");
    for (const stage of pipelineRecoveryStageOrder) {
      const pkg = manifest.packages?.[stage];
      console.log(`  ${stage.padEnd(10)} ${pkg?.status ?? "?"}${pkg?.error ? " (" + pkg.error + ")" : ""}`);
    }

    if (!result.success) {
      console.log(`\nPIPELINE INCOMPLETE: ${result.stopReason ?? "unknown"}`);
      return { ok: false, root, projectId: result.project.id };
    }

    const assets = AssetManager.getProjectAssets(slug, result.project.id);
    const video = [...assets.assets].reverse().find((a) => a.type === "video" && a.status === "generated");
    assert.ok(video, "no generated video asset");
    const finalPath = resolveRuntimeLogicalPath(String(video.filePath), runtime.runtimeStorageContext);
    assert.ok(fs.existsSync(finalPath), `MP4 missing at ${finalPath}`);

    const probe = JSON.parse(execFileSync(ffprobePath, [
      "-v", "error", "-show_entries",
      "format=format_name,duration:stream=codec_type,codec_name,width,height,sample_rate",
      "-of", "json", finalPath,
    ], { encoding: "utf8" })) as {
      streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; sample_rate?: string }>;
      format: { format_name: string; duration: string };
    };
    const v = probe.streams.find((s) => s.codec_type === "video");
    const a = probe.streams.find((s) => s.codec_type === "audio");
    console.log("\n--- final MP4 ---");
    console.log(`  path      ${finalPath}`);
    console.log(`  bytes     ${video.byteLength}`);
    console.log(`  container ${probe.format.format_name}`);
    console.log(`  video     ${v?.codec_name} ${v?.width}x${v?.height}`);
    console.log(`  audio     ${a?.codec_name} ${a?.sample_rate ?? "?"}Hz`);
    console.log(`  duration  ${Number(probe.format.duration).toFixed(2)}s`);

    assert.equal(v?.codec_name, "h264", "video codec");
    assert.equal(a?.codec_name, "aac", "audio codec");
    assert.ok(Number(probe.format.duration) > 20, "duration too short");

    const scenes = JSON.parse(fs.readFileSync(path.join(root, "scenes.json"), "utf8")) as { scenes: unknown[] };
    const usage = await AIUsageManager.getUsageLog(slug);
    const report = buildProductionCostReport({
      projectSlug: slug,
      usage,
      facts: {
        durationSeconds: Number(probe.format.duration),
        sceneCount: scenes.scenes.length,
        chapterCount: 5,
        narrationCharacters: 0,
        aiImageCount: assets.assets.filter((x) => x.type === "image" && x.mediaOrigin === "ai").length,
        aiVideoCount: 0,
        cachedAssetCount: 0,
        retryCount: 0,
      },
    });
    console.log("\n" + renderProductionCostReportText(report));

    const providerModels = new Set(
      usage.records.map((r) => `${r.provider}/${r.model ?? "?"}`),
    );
    console.log(`AI providers actually used: ${[...providerModels].join(", ") || "(none billed)"}`);
    const paid = usage.records.filter(
      (r) => r.pricingStatus === "known" && (r.estimatedCost ?? 0) > 0,
    );
    console.log(`Paid (non-$0) AI calls: ${paid.length}`);

    return {
      ok: true,
      finalPath,
      bytes: video.byteLength,
      duration: Number(probe.format.duration),
      paidCalls: paid.length,
      totalUsd: report.totalUsd,
    };
  });

  const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1);
  const v = outcome.value as { ok: boolean; finalPath?: string; paidCalls?: number; totalUsd?: number };
  console.log(`\n=== ${v.ok ? "SUCCESS" : "INCOMPLETE"} in ${elapsed} min ===`);
  if (v.ok) {
    console.log(`MP4: ${v.finalPath}`);
    console.log(`Paid AI calls: ${v.paidCalls} | ledger total: $${(v.totalUsd ?? 0).toFixed(4)}`);
  }
  process.exitCode = v.ok ? 0 : 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
