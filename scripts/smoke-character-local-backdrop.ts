import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { FFmpegSceneVideoProvider } from "../src/lib/video/providers/FFmpegSceneVideoProvider";
import { SpawnRunner } from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import { planCharacterScene } from "../src/lib/animation/character/CharacterScenePlanner";
import { planCharacterSceneDirection } from "../src/lib/animation/character/CharacterSceneDirection";
import { EDITORIAL_RENDER_STYLE } from "../src/lib/character/SvgSceneRenderer";
import { isCharacterBackdropPng, rasterizeCharacterSceneSvg } from "../src/lib/character/CharacterSceneRasterizer";
import { readCharacterLocalBackdrop } from "../src/lib/animation/character/CharacterLocalBackdrop";
import { CHARACTER_SCENE_FONT_FAMILY, embedCharacterScenePayload, readCharacterScenePayload, renderCharacterSceneAssetFrame, findCharacterSceneAssetPayloadProblems } from "../src/lib/animation/character/CharacterSceneAsset";

async function main() {
  const p = planCharacterScene({ sceneId: 1, text: "Osmanlı padişahı sarayda konuşur.", contextualDirection: true });
  const direction = planCharacterSceneDirection("Osmanlı padişahı sarayda konuşur.", p.request.blocking);
  const png = await sharp({ create: { width: 1024, height: 576, channels: 3, background: "#5b8a95" } }).png().toBuffer();
  assert(isCharacterBackdropPng(png));
  assert(!isCharacterBackdropPng(Buffer.from("not PNG")));
  const wrong = Buffer.from(png); wrong.writeUInt32BE(999999, 16); assert(!isCharacterBackdropPng(wrong));
  const background = { provider: "sdxl-local" as const, modelRevision: "a".repeat(40), sha256: crypto.createHash("sha256").update(png).digest("hex") };
  const payload = { schemaVersion: "1" as const, request: p.request, animation: p.animation, fontFamily: CHARACTER_SCENE_FONT_FAMILY, renderStyle: EDITORIAL_RENDER_STYLE, direction, background };
  assert.deepEqual(findCharacterSceneAssetPayloadProblems(payload), []);
  const svg = renderCharacterSceneAssetFrame(payload, 0.4, 8);
  assert.doesNotMatch(svg, /data-art-environment|<image|href=|url\s*\(/);
  const raster = await rasterizeCharacterSceneSvg(svg, { backgroundPng: png }); assert(raster.ok);
  if (!raster.ok) return;
  const embedded = embedCharacterScenePayload(raster.png, payload, png);
  const read = readCharacterScenePayload(embedded); assert.equal(read.status, "VALID");
  if (read.status === "VALID") { assert.deepEqual(read.payload, payload); assert(read.backgroundPng?.equals(png)); }
  const pixels = await sharp(raster.png).removeAlpha().raw().toBuffer(); assert.deepEqual([...pixels.subarray(0, 3)], [91, 138, 149]);
  const ffmpeg = process.env.FFMPEG_PATH; const ffprobe = process.env.FFPROBE_PATH;
  assert(ffmpeg && ffprobe && fs.existsSync(ffmpeg) && fs.existsSync(ffprobe), "real FFmpeg paths required for background wiring proof");
  await withCanonicalSmokeRuntime({ name: "local-backdrop" }, async runtime => {
    const slug = `backdrop-${runtime.runId.slice(0, 10)}`;
    await ProjectManager.createProject(slug);
    const saved = ImageStorage.saveImage({ projectSlug: slug, data: embedded, assetId: "backdrop-source", mimeType: "image/png" });
    const frame = { crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, transform: { scale: 1, translateX: 0, translateY: 0 } };
    const result = await new FFmpegSceneVideoProvider(new SpawnRunner(), () => ({ ffmpegPath: ffmpeg, ffprobePath: ffprobe, timeoutMs: 60000, maxOutputBytes: 32 * 1024 * 1024, maxStdioBytes: 1024 * 1024 })).generateVideo({ projectId: "backdrop-proof", projectSlug: slug, scenes: [{ sceneId: 1, sourceImageAssetId: "backdrop-source", animationAssetId: "backdrop-anim", imageFilePath: saved.filePath, imageMimeType: "image/png", motionPlan: { sceneId: 1, animationPrompt: "motion", sourceImageAssetId: "backdrop-source", outputAssetId: "backdrop-anim", animationAssetId: "backdrop-anim", durationSeconds: 1, motionType: "zoom-in", start: frame, end: frame, transition: "fade", provider: "mock", model: "fixture", generationMode: "mock", artifactType: "motion-plan", status: "generated" } }] });
    assert(result.success, JSON.stringify(result));
    if (result.success) {
      const output = path.join(runtime.runtimeStorageContext.projectsRoot, slug, "assets", "videos", path.posix.basename(result.scenes[0]!.filePath));
      const sample = (t: string) => execFileSync(ffmpeg, ["-v", "error", "-ss", t, "-i", output, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "96x54", "-"]);
      assert.notDeepEqual(sample("0.1"), sample("0.8"));
      assert.equal(result.scenes[0]!.width, 1920); assert.equal(result.scenes[0]!.height, 1080);
    }
  });
  assert.throws(() => embedCharacterScenePayload(raster.png, payload), /BACKGROUND_INVALID/);
  const corrupt = Buffer.from(embedded); const chunk = corrupt.indexOf(Buffer.from("atBG")); corrupt[chunk + 33] = corrupt[chunk + 33]! ^ 1; assert.equal(readCharacterScenePayload(corrupt).status, "INVALID");
  assert(findCharacterSceneAssetPayloadProblems({ ...payload, background: { ...background, modelRevision: "bad" } }).length);
  const library = path.join(process.cwd(), "bin", "ayas-local-visual", "library");
  // The harness is a private clone. Refuse to overwrite any existing model/library.
  assert(!fs.existsSync(library)); fs.mkdirSync(library, { recursive: true });
  try {
    fs.writeFileSync(path.join(library, "ottoman.png"), png);
    fs.writeFileSync(path.join(library, "ottoman.json"), JSON.stringify({ schema: 1, reviewStatus: "ENGINEERING_ACCEPTED", theme: "OTTOMAN", ...background }));
    assert.equal(readCharacterLocalBackdrop("off", direction.art), null);
    assert(readCharacterLocalBackdrop("cache", direction.art)?.png.equals(png));
    fs.writeFileSync(path.join(library, "ottoman.png"), wrong); assert.throws(() => readCharacterLocalBackdrop("cache", direction.art), /CHANGED/);
  } finally { fs.rmSync(library, { recursive: true, force: true }); }
  console.log("Character local backdrop: PASS (bounded raster, no SVG external reference, compositing, portable PNG chunk, SHA/CRC failure, off/cache compatibility; no model/network)");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
