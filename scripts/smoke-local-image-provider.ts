/**
 * Local, $0 last-resort image provider (`LocalImageProvider`) + its wiring as a
 * per-scene fallback inside `VisualAssetPipeline`.
 *
 * Proves:
 *  A. config / routing — `resolveImageProviderName("local")`, the router builds
 *     `LocalImageProvider`, `isLocalImageFallbackEnabled` reads the flag.
 *  B. LIVE FFmpeg — `LocalImageProvider.generateImage` writes a real 1920x1080
 *     PNG to the project image store (SKIPs when FFmpeg is unavailable).
 *  C. real-photo-first — with the flag on, a scene WITH an admissible archival
 *     photo keeps the real photo; only a scene with no usable real photo gets
 *     the local placeholder, even when it was force-`real`.
 *  D. no behaviour change with the flag OFF — a force-`real` miss still fails
 *     the stage closed.
 *  E. the placeholder is $0 — it does not consume `maxAiImages` and is
 *     classified `mediaOrigin: "ai"` / `selectionReason: local-generated-placeholder`.
 *
 * No OpenAI, no paid API. Real FFmpeg for scenario B only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { createProviderDispatchAdapter } from "../src/lib/providers/ProviderDispatchAdapterAuthority";
import { LocalImageProvider } from "../src/lib/assets/providers/LocalImageProvider";
import { ImageProviderRouter } from "../src/lib/assets/providers/ImageProviderRouter";
import {
  isLocalImageFallbackEnabled,
  resolveImageProviderName,
} from "../src/lib/assets/providers/ImageProviderConfig";
import {
  VisualAssetGenerationError,
  VisualAssetPipeline,
} from "../src/lib/assets/VisualAssetPipeline";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import type {
  ConfiguredImageProvider,
  ImageGenerationInput,
} from "../src/lib/assets/providers/ImageProvider";
import type { ImageGenerationResult } from "../src/types/asset";
import type { VisualData } from "../src/types/visual";

const now = "2026-09-01T00:00:00.000Z";
let count = 0;
let projectsRoot = "";
let prefix = "";

function scenario(name: string, fn: () => Promise<void>) {
  return fn().then(() => {
    count += 1;
    if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
  });
}

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

function visualData(sceneCount: number): VisualData {
  return {
    projectId: "local-image-smoke",
    scenes: Array.from({ length: sceneCount }, (_, i) => ({
      sceneId: i + 1,
      visualPrompt: `Kanuni Sultan Süleyman dönemi, sahne ${i + 1}: Osmanlı sarayında bir an.`,
      animationPrompt: "slow push in",
      style: "cinematic",
      searchKeywords: [`Suleiman the Magnificent scene ${i + 1}`],
    })),
    thumbnail: { title: "t", prompt: "p", composition: "c", mood: "m" },
    createdAt: now,
  };
}

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** A stub "real" provider: an admissible archival photo for `foundScenes`, not-found otherwise. */
function stubRealProvider(foundScenes: ReadonlySet<number>): ConfiguredImageProvider {
  const provider: ConfiguredImageProvider = {
    name: "real",
    async generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
      if (!foundScenes.has(input.sceneId)) {
        return {
          success: false,
          sceneId: input.sceneId,
          provider: "real",
          createdAt: now,
          error: "No matching real photo found.",
        };
      }
      const saved = ImageStorage.saveImage({
        projectSlug: input.projectSlug as string,
        data: PNG,
        mimeType: "image/png",
      });
      return {
        success: true,
        sceneId: input.sceneId,
        provider: "real",
        model: "wikimedia-commons",
        filePath: saved.filePath,
        url: saved.url,
        mimeType: "image/png",
        sourceName: "Wikimedia Commons",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Suleiman.jpg",
        license: "Public domain",
        attribution: "Unknown author",
        selectionScore: 0.8,
        selectionRank: 1,
        candidateCount: 3,
        width: 1600,
        height: 1000,
        createdAt: now,
      };
    },
    createImmutableImageDispatchAdapter() {
      return createProviderDispatchAdapter(provider, {
        metadata: { name: provider.name }, requiredMethods: ["generateImage"],
      });
    },
  };
  return provider;
}

const noDelay = { retryDelayMs: 0, delayFn: async () => {} };

async function run(ffmpegAvailable: boolean) {
  // ---- A. config / routing --------------------------------------------------
  await scenario("resolveImageProviderName accepts 'local'; router builds LocalImageProvider", async () => {
    assert.equal(resolveImageProviderName("local"), "local");
    const provider = ImageProviderRouter.getProvider("local");
    assert.equal(provider.name, "local");
    assert.ok(provider instanceof LocalImageProvider);
    assert.ok(provider.createImmutableImageDispatchAdapter());
  });

  await scenario("isLocalImageFallbackEnabled reads ATOLYE_LOCAL_IMAGE_FALLBACK", async () => {
    const env = (value?: string) =>
      ({ NODE_ENV: "test", ...(value === undefined ? {} : { ATOLYE_LOCAL_IMAGE_FALLBACK: value }) }) as NodeJS.ProcessEnv;
    assert.equal(isLocalImageFallbackEnabled(env()), false);
    assert.equal(isLocalImageFallbackEnabled(env("on")), true);
    assert.equal(isLocalImageFallbackEnabled(env("1")), true);
    assert.equal(isLocalImageFallbackEnabled(env("off")), false);
    assert.equal(isLocalImageFallbackEnabled(env("yes")), false);
  });

  // ---- B. LIVE FFmpeg ------------------------------------------------------
  if (ffmpegAvailable) {
    await scenario("LIVE: LocalImageProvider.generateImage writes a real 1920x1080 PNG", async () => {
      const slug = `${prefix}-live`;
      const result = await new LocalImageProvider().generateImage({
        prompt: "Osmanlı sarayında taht odası, mum ışığı",
        sceneId: 1,
        projectSlug: slug,
        searchKeywords: ["Topkapı Palace throne room"],
      });
      assert.equal(result.success, true, `expected success, got ${JSON.stringify(result)}`);
      if (result.success !== true) return;
      assert.equal(result.provider, "local");
      assert.equal(result.mimeType, "image/png");
      assert.equal(result.width, 1920);
      assert.equal(result.height, 1080);
      const abs = path.join(projectsRoot, slug, "assets", "images", path.posix.basename(String(result.filePath)));
      assert.ok(fs.existsSync(abs), `PNG missing at ${abs}`);
      const bytes = fs.readFileSync(abs);
      assert.ok(bytes.length > 2000, `PNG too small: ${bytes.length}`);
      assert.ok(bytes[0] === 0x89 && bytes[1] === 0x50, "not a PNG");
      if (process.env.FFPROBE_PATH || process.env.FFPROBE_EXECUTABLE) {
        const probe = JSON.parse(execFileSync(
          (process.env.FFPROBE_PATH || process.env.FFPROBE_EXECUTABLE) as string,
          ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", abs],
          { encoding: "utf8" },
        )) as { streams: Array<{ width: number; height: number }> };
        assert.equal(probe.streams[0]?.width, 1920);
        assert.equal(probe.streams[0]?.height, 1080);
      }
    });

    await scenario("LIVE: flag ON — real photo kept where found, local placeholder only where missing", async () => {
      const slug = `${prefix}-mix`;
      process.env.ATOLYE_LOCAL_IMAGE_FALLBACK = "on";
      try {
        const assets = await VisualAssetPipeline.generateAssets({
          projectId: "local-image-smoke",
          projectSlug: slug,
          visualData: visualData(3),
          provider: stubRealProvider(new Set([1, 3])),
          overrides: { 1: "real", 2: "real", 3: "real" },
          maxAiImages: 0,
          resilience: noDelay,
        });
        const images = assets.assets.filter((a) => a.type === "image" && a.status === "generated");
        assert.equal(images.length, 3, "every scene covered");
        const byScene = new Map(images.map((a) => [a.sceneId, a]));
        assert.equal(byScene.get(1)?.provider, "real");
        assert.equal(byScene.get(3)?.provider, "real");
        assert.equal(byScene.get(2)?.provider, "local");
        assert.equal(byScene.get(2)?.mediaOrigin, "ai");
        assert.equal(byScene.get(2)?.mediaType, "ai-image");
        assert.equal(byScene.get(2)?.selectionReason, "local-generated-placeholder");
        assert.equal(byScene.get(2)?.rightsStatus, undefined);
        // real photos keep their honest provenance
        assert.equal(byScene.get(1)?.mediaOrigin, "real");
      } finally {
        delete process.env.ATOLYE_LOCAL_IMAGE_FALLBACK;
      }
    });

    await scenario("LIVE: local placeholders do NOT consume the AI-image budget (maxAiImages: 0)", async () => {
      const slug = `${prefix}-budget`;
      process.env.ATOLYE_LOCAL_IMAGE_FALLBACK = "on";
      try {
        const assets = await VisualAssetPipeline.generateAssets({
          projectId: "local-image-smoke",
          projectSlug: slug,
          visualData: visualData(4),
          provider: stubRealProvider(new Set()),
          maxAiImages: 0,
          resilience: noDelay,
        });
        const images = assets.assets.filter((a) => a.type === "image" && a.status === "generated");
        assert.equal(images.length, 4);
        assert.ok(images.every((a) => a.provider === "local"));
      } finally {
        delete process.env.ATOLYE_LOCAL_IMAGE_FALLBACK;
      }
    });

    await scenario("LIVE: a scene with an inadmissible real photo licence falls to the local placeholder", async () => {
      const slug = `${prefix}-rights`;
      process.env.ATOLYE_LOCAL_IMAGE_FALLBACK = "on";
      try {
        const restrictedRealProvider: ConfiguredImageProvider = {
          name: "real",
          async generateImage(input) {
            const saved = ImageStorage.saveImage({
              projectSlug: input.projectSlug as string, data: PNG, mimeType: "image/png",
            });
            return {
              success: true, sceneId: input.sceneId, provider: "real", model: "wikimedia-commons",
              filePath: saved.filePath, url: saved.url, mimeType: "image/png",
              sourceName: "Wikimedia Commons",
              sourceUrl: "https://commons.wikimedia.org/wiki/File:x.jpg",
              license: "All rights reserved", attribution: "x",
              selectionScore: 0.9, selectionRank: 1, candidateCount: 2, width: 1600, height: 1000,
              createdAt: now,
            };
          },
          createImmutableImageDispatchAdapter() {
            return createProviderDispatchAdapter(this as ConfiguredImageProvider, {
              metadata: { name: "real" }, requiredMethods: ["generateImage"],
            });
          },
        };
        const assets = await VisualAssetPipeline.generateAssets({
          projectId: "local-image-smoke",
          projectSlug: slug,
          visualData: visualData(2),
          provider: restrictedRealProvider,
          maxAiImages: 0,
          resilience: noDelay,
        });
        const images = assets.assets.filter((a) => a.type === "image" && a.status === "generated");
        assert.equal(images.length, 2);
        assert.ok(images.every((a) => a.provider === "local"), "inadmissible real photo must not be used");
      } finally {
        delete process.env.ATOLYE_LOCAL_IMAGE_FALLBACK;
      }
    });
  }

  // ---- D. flag OFF: unchanged fail-closed behaviour -------------------------
  await scenario("flag OFF — a force-'real' miss still fails the stage closed", async () => {
    const slug = `${prefix}-off`;
    assert.equal(isLocalImageFallbackEnabled(), false, "flag must be unset for this scenario");
    await assert.rejects(
      VisualAssetPipeline.generateAssets({
        projectId: "local-image-smoke",
        projectSlug: slug,
        visualData: visualData(2),
        provider: stubRealProvider(new Set([1])),
        overrides: { 1: "real", 2: "real" },
        maxAiImages: 0,
        resilience: noDelay,
      }),
      (e) => e instanceof VisualAssetGenerationError,
    );
  });

  console.log(`Local image provider smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "local-image-provider", scenarios: count }));
}

async function main() {
  const dotenv = loadDotEnvLocal();
  const ffmpeg = process.env.FFMPEG_PATH || process.env.FFMPEG_EXECUTABLE ||
    dotenv.FFMPEG_PATH || dotenv.FFMPEG_EXECUTABLE;
  const ffprobe = process.env.FFPROBE_PATH || process.env.FFPROBE_EXECUTABLE ||
    dotenv.FFPROBE_PATH || dotenv.FFPROBE_EXECUTABLE;
  const ffmpegAvailable = Boolean(ffmpeg && fs.existsSync(ffmpeg));
  if (ffmpegAvailable) {
    process.env.FFMPEG_EXECUTABLE = ffmpeg;
    if (ffprobe && fs.existsSync(ffprobe)) process.env.FFPROBE_PATH = ffprobe;
  } else {
    console.log("NOTE: FFmpeg unavailable — scenario B (LIVE render) skipped.");
  }

  await withCanonicalSmokeRuntime(
    { name: "local-image-provider", now },
    async (runtime) => {
      projectsRoot = runtime.runtimeStorageContext.projectsRoot;
      prefix = `localimg-${runtime.runId.slice(0, 10)}`;
      await run(ffmpegAvailable);
    },
  );
}

main().catch((error) => {
  console.error("Local image provider smoke FAILED:", error);
  process.exitCode = 1;
});
