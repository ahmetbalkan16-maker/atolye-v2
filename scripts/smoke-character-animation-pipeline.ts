/**
 * Atölye stick-figure animation mode (`IMAGE_PROVIDER=character`) — engine, planner, asset, pipeline wiring, and the
 * two owner fixes that ship with it (start-screen lost-response recovery, 73 °C GPU admission).
 *
 * Proves:
 *  A. renderer — the still renderer's bytes are unchanged; a frame with no overrides is the still; fonts are checked.
 *  B. animation — plans are validated (unknown figure, bad action, moonwalk, target on a non-mover, delay), frames are
 *     deterministic, a walker moves at a fixed pace and stops at its target, talking opens the mouth, a fall lands.
 *  C. planner — Turkish and English scenes get the expected kind/backdrop/time, the same scene gets the same plan,
 *     nothing stands on water, and every plan for a spread of generated texts passes the engine's own validators.
 *  D. asset — the PNG payload round-trips, a flipped byte / second payload / non-documentary format is refused.
 *  E. provider + visuals stage (TEMP runtime) — a $0 labelled reenactment, outside the AI-image cap, honestly classified.
 *  F. scene video (real FFmpeg in TEMP, skipped without FFmpeg) — a character PNG renders animated frames at 1920x1080
 *     30 fps for the planned duration and leaves no frame folder behind; an ordinary PNG still takes the old path.
 *  G. cost / readiness / director — $0 everywhere, READY without a key, reenactment counted as labelled.
 *  H. start screen — the started project is found by slug and creation time; the slug derivation is unchanged.
 *  I. GPU admission — waits while hot, gives up after the bound, reads once when not waiting, no read off-A2000.
 *
 * No provider call, no network, no live runtime: everything writes under the canonical smoke TEMP runtime.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { renderCharacterSceneSvg, renderCharacterSceneFrameSvg } from "../src/lib/character/SvgSceneRenderer";
import { POSE_ANGLES } from "../src/lib/character/CharacterPose";
import { findSceneBlockingProblems, type SceneBlocking } from "../src/lib/character/SceneBlocking";
import {
  CHARACTER_ANIMATION_FPS,
  characterAnimationFrame,
  characterAnimationFrameCount,
  findCharacterAnimationProblems,
  type CharacterAnimationPlan,
} from "../src/lib/animation/character/CharacterAnimation";
import { classifyCharacterScene, planCharacterScene } from "../src/lib/animation/character/CharacterScenePlanner";
import { findCharacterSceneRequestProblems } from "../src/lib/character/CharacterSceneManifest";
import {
  CHARACTER_SCENE_ASSET_SCHEMA_VERSION,
  CHARACTER_SCENE_FONT_FAMILY,
  embedCharacterScenePayload,
  readCharacterScenePayload,
  renderCharacterSceneAssetFrame,
  type CharacterSceneAssetPayload,
} from "../src/lib/animation/character/CharacterSceneAsset";
import { rasterizeCharacterSceneSvg } from "../src/lib/character/CharacterSceneRasterizer";
import { CharacterImageProvider } from "../src/lib/assets/providers/CharacterImageProvider";
import { ImageProviderRouter } from "../src/lib/assets/providers/ImageProviderRouter";
import { resolveImageProviderName } from "../src/lib/assets/providers/ImageProviderConfig";
import { VisualAssetPipeline } from "../src/lib/assets/VisualAssetPipeline";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { SpawnRunner } from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import { buildSceneFFmpegArgs, FFmpegSceneVideoProvider } from "../src/lib/video/providers/FFmpegSceneVideoProvider";
import { estimateProductionCost } from "../src/lib/production/ProductionCostEstimate";
import { ProductionReadinessService } from "../src/lib/production/ProductionReadinessService";
import { directorTaskFromProjectArtifacts } from "../src/lib/ayas/director/AyasDirectorProjectAdapter";
import { resolveAyasDirectorProvider } from "../src/lib/ayas/director/AyasProductionDirectorCollector";
import { findStartedProjectUrl } from "../src/lib/pipeline/pipelineStartOutcome";
import { createProjectSlug } from "../src/lib/projects/projectSlug";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import {
  AYAS_A2000_GPU_HARD_STOP_C,
  AYAS_A2000_PROFILE_ID,
  awaitAyasGpuThermalHeadroom,
  readAyasGpuThermal,
} from "../src/lib/ayas/machine/AyasGpuThermalAdmission";
import { readAyasGpuTemperatureC } from "../src/lib/ayas/machine/AyasMachineTelemetry";
import { BRAIN_A2000_GPU_HARD_STOP_C, BRAIN_A2000_PROFILE_ID } from "../src/lib/brain/probe/BrainResourceProbe";
import type { AnimationMotionPlanScene } from "../src/types/animation";
import type { Asset } from "../src/types/asset";
import type { VisualData } from "../src/types/visual";

const now = "2026-10-11T00:00:00.000Z";
let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  try { await fn(); } catch (error) { console.error(`character-animation scenario FAILED: ${name}`); throw error; }
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const person = (id: string, patch: Record<string, unknown> = {}) => ({
  id, x: 0.3, depth: 0.1, facing: "RIGHT" as const, pose: "STAND" as const, expression: "NEUTRAL" as const,
  costume: "TURBAN" as const, handProp: null, ...patch,
}) as SceneBlocking["characters"][number];
const blocking = (patch: Partial<SceneBlocking> = {}): SceneBlocking => ({
  backdrop: "FIELD", time: "DAY", characters: [person("a"), person("b", { x: 0.7, facing: "LEFT" })], props: [], arrows: [], caption: null, ...patch,
});
const plan = (actors: CharacterAnimationPlan["actors"]): CharacterAnimationPlan => ({ schemaVersion: "1", fps: 15, actors });

function payloadFor(text: string, sceneId = 1): CharacterSceneAssetPayload {
  const planned = planCharacterScene({ sceneId, text });
  return { schemaVersion: CHARACTER_SCENE_ASSET_SCHEMA_VERSION, request: planned.request, animation: planned.animation, fontFamily: CHARACTER_SCENE_FONT_FAMILY };
}

function motionPlan(sceneId: number, imageId: string, durationSeconds: number): AnimationMotionPlanScene {
  const frame = { crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, transform: { scale: 1, translateX: 0, translateY: 0 } };
  return {
    sceneId, animationPrompt: "motion", sourceImageAssetId: imageId, outputAssetId: `${imageId}-anim`, animationAssetId: `${imageId}-anim`,
    durationSeconds, motionType: "zoom-in", start: frame, end: { ...frame, transform: { ...frame.transform, scale: 1.1 } }, transition: "fade",
    provider: "mock", model: "mock-animation-model", generationMode: "mock", artifactType: "motion-plan", status: "generated",
  };
}

function dotEnvValue(name: string): string | undefined {
  try {
    for (const line of fs.readFileSync(path.resolve(".env.local"), "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (match && match[1] === name) return match[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch { /* optional */ }
  return undefined;
}

async function run(projectsRoot: string, prefix: string, ffmpeg: string | null, ffprobe: string | null) {
  // ---- A. renderer ------------------------------------------------------------------------------------------------
  await scenario("the still renderer is unchanged and a frame with no overrides is the still", () => {
    const scene = blocking({ caption: "Sur önünde" });
    const still = renderCharacterSceneSvg(scene, { reenactmentLabel: "tr" });
    assert.equal(renderCharacterSceneFrameSvg(scene, {}, { reenactmentLabel: "tr" }), still);
    assert.match(still, /font-family="sans-serif"/);
    assert.doesNotMatch(still, /Segoe/);
    const named = renderCharacterSceneFrameSvg(scene, {}, { reenactmentLabel: "tr", fontFamily: CHARACTER_SCENE_FONT_FAMILY });
    assert.match(named, /font-family="Segoe UI, Arial, DejaVu Sans, sans-serif"/);
    assert.match(named, /data-reenactment-label="tr"/);
  });
  await scenario("fonts and frame overrides are checked before drawing", () => {
    const scene = blocking();
    assert.throws(() => renderCharacterSceneSvg(scene, { reenactmentLabel: "tr", fontFamily: 'Arial" onload="x' }), /CHARACTER_SCENE_FONT_INVALID/);
    const good = { pose: POSE_ANGLES.STAND, x: 0.5, mouthOpen: true };
    assert.throws(() => renderCharacterSceneFrameSvg(scene, { ghost: good }, { reenactmentLabel: "tr" }), /FRAME_INVALID/);
    assert.throws(() => renderCharacterSceneFrameSvg(scene, { a: { ...good, x: 1.5 } }, { reenactmentLabel: "tr" }), /FRAME_INVALID/);
    assert.throws(() => renderCharacterSceneFrameSvg(scene, { a: { ...good, pose: { ...good.pose, torsoLean: Number.NaN } } }, { reenactmentLabel: "tr" }), /FRAME_INVALID/);
    const moved = renderCharacterSceneFrameSvg(scene, { a: good }, { reenactmentLabel: "tr" });
    assert.notEqual(moved, renderCharacterSceneSvg(scene, { reenactmentLabel: "tr" }));
  });

  // ---- B. animation -----------------------------------------------------------------------------------------------
  await scenario("animation plans are validated against the blocking", () => {
    const scene = blocking();
    assert.deepEqual(findCharacterAnimationProblems(plan([{ id: "a", action: "WALK", toX: 0.6, delaySeconds: 0 }]), scene), []);
    assert.deepEqual(findCharacterAnimationProblems(plan([{ id: "zz", action: "IDLE", toX: null, delaySeconds: 0 }]), scene), ["ACTOR:0"]);
    assert.deepEqual(findCharacterAnimationProblems(plan([{ id: "a", action: "DANCE" as never, toX: null, delaySeconds: 0 }]), scene), ["ACTOR:0"]);
    assert.deepEqual(findCharacterAnimationProblems(plan([{ id: "a", action: "WALK", toX: 0.1, delaySeconds: 0 }]), scene), ["ACTOR_DIRECTION:0"]);
    assert.deepEqual(findCharacterAnimationProblems(plan([{ id: "a", action: "TALK", toX: 0.5, delaySeconds: 0 }]), scene), ["ACTOR_TARGET:0"]);
    assert.deepEqual(findCharacterAnimationProblems(plan([{ id: "a", action: "IDLE", toX: null, delaySeconds: 31 }]), scene), ["ACTOR:0"]);
    assert.deepEqual(findCharacterAnimationProblems(plan([{ id: "a", action: "IDLE", toX: null, delaySeconds: 0 }, { id: "a", action: "IDLE", toX: null, delaySeconds: 0 }]), scene), ["ACTOR:1"]);
    assert.deepEqual(findCharacterAnimationProblems({ ...plan([]), fps: 24 }, scene), ["ANIMATION_FPS"]);
    assert.deepEqual(findCharacterAnimationProblems({ ...plan([]), extra: 1 }, scene), ["ANIMATION_SHAPE"]);
  });
  await scenario("frames are deterministic; a walker keeps its pace and stops; talk, fall and the frame count", () => {
    const scene = blocking();
    const walk = plan([{ id: "a", action: "WALK", toX: 0.6, delaySeconds: 1 }, { id: "b", action: "TALK", toX: null, delaySeconds: 0 }]);
    assert.deepEqual(characterAnimationFrame(scene, walk, 2.5), characterAnimationFrame(scene, walk, 2.5));
    assert.equal(characterAnimationFrame(scene, walk, 0.5).a!.x, 0.3, "waits for its delay");
    const xs = [1.5, 2, 3, 4].map((t) => characterAnimationFrame(scene, walk, t).a!.x);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i]! > xs[i - 1]!, "walks forward");
    assert.equal(characterAnimationFrame(scene, walk, 60).a!.x, 0.6, "stops at its target");
    assert.equal(characterAnimationFrame(scene, walk, 60).a!.pose.legFront.upper, POSE_ANGLES.STAND.legFront.upper, "and stands");
    const mouths = new Set(Array.from({ length: 30 }, (_, i) => characterAnimationFrame(scene, walk, 0.1 + i / 15).b!.mouthOpen));
    assert.deepEqual([...mouths].sort(), [false, true], "talking opens and closes the mouth");
    const fall = plan([{ id: "a", action: "FALL", toX: null, delaySeconds: 1 }]);
    assert.equal(characterAnimationFrame(scene, fall, 0.5).a!.pose.bodyRotation, 0);
    assert.equal(characterAnimationFrame(scene, fall, 5).a!.pose.bodyRotation, POSE_ANGLES.FALLEN.bodyRotation);
    assert.equal(characterAnimationFrameCount(2), 2 * CHARACTER_ANIMATION_FPS + 1);
    assert.throws(() => characterAnimationFrameCount(0), /DURATION_INVALID/);
    assert.throws(() => characterAnimationFrameCount(601), /DURATION_INVALID/);
  });

  // ---- C. planner ---------------------------------------------------------------------------------------------------
  await scenario("Turkish and English scenes are planned to the expected kind, backdrop and time", () => {
    const cases: [string, string, string, string][] = [
      ["Osmanlı ordusu gece İstanbul surlarına doğru ilerliyor", "MARCH", "CITY_WALLS", "NIGHT"],
      ["Genç padişah cülus töreninde tahta çıkıyor, sarayda", "COURT", "INTERIOR", "DAY"],
      ["Vezirler divanda toplanıp antlaşmayı müzakere ediyor", "COUNCIL", "INTERIOR", "DAY"],
      ["Akşam vakti iki ordu ovada savaşıyor, kılıçlar çarpışıyor", "BATTLE", "FIELD", "DUSK"],
      ["The fleet sails across the sea at dawn", "VOYAGE", "SEA", "DUSK"],
      ["Fatih stands before his army and issues commands for the final assault", "RALLY", "FIELD", "DAY"],
      ["Bustling market streets full of merchants", "MARKET", "PLAIN", "DAY"],
      ["Sultan Mehmed sits inside the palace before a large map of Istanbul, planning", "COUNCIL", "INTERIOR", "DAY"],
      ["Giustiniani lies wounded on the ground", "DEATH", "PLAIN", "DAY"],
      ["", "NARRATOR", "PLAIN", "DAY"],
    ];
    for (const [text, kind, backdrop, time] of cases) {
      const got = classifyCharacterScene({ sceneId: 1, text });
      assert.deepEqual([got.kind, got.backdrop, got.time], [kind, backdrop, time], text);
    }
    // A city's name alone is not its walls.
    assert.notEqual(classifyCharacterScene({ sceneId: 1, text: "A panoramic view of Istanbul at noon" }).backdrop, "CITY_WALLS");
  });
  await scenario("the same scene gets the same plan; nothing but a ship stands on the water; every plan validates", () => {
    const text = "Osmanlı donanması Haliç'te, askerler kıyıda bekliyor; Bizans savunucuları karşıda";
    assert.deepEqual(planCharacterScene({ sceneId: 7, text }), planCharacterScene({ sceneId: 7, text }));
    const sea = planCharacterScene({ sceneId: 3, text: "Merchants trade in the harbour beside the sea, a tent and a table on the shore" });
    assert.equal(sea.request.blocking.backdrop, "SEA");
    for (const item of sea.request.blocking.characters) assert.ok(item.depth <= 0.5, "figure on the shore");
    for (const item of sea.request.blocking.props) if (item.prop !== "SHIP") assert.ok(item.depth <= 0.5, `${item.prop} on the shore`);
    const words = ["army", "ordu", "battle", "savaş", "sultan", "padişah", "ship", "gemi", "walls", "sur", "night", "gece", "market",
      "çarşı", "pray", "dua", "build", "inşa", "scholar", "kitap", "journey", "göç", "victory", "zafer", "wounded", "şehit", "council",
      "divan", "commands", "nutuk", "cannon", "top", "horse", "atlı", "tent", "çadır", "Byzantine", "Bizans", "Ottoman", "Osmanlı", "Huns", "Hunlar"];
    for (let i = 1; i <= 240; i++) {
      const text = Array.from({ length: 1 + (i % 6) }, (_, k) => words[(i * 7 + k * 13) % words.length]).join(" ");
      const planned = planCharacterScene({ sceneId: i, text });
      assert.deepEqual(findCharacterSceneRequestProblems(planned.request), [], text);
      assert.deepEqual(findCharacterAnimationProblems(planned.animation, planned.request.blocking), [], text);
      assert.equal(planned.request.format, "DOCUMENTARY");
      assert.ok(planned.request.blocking.characters.length >= 1);
    }
    assert.throws(() => planCharacterScene({ sceneId: 0, text: "x" }), /PLAN_INVALID/);
  });

  // ---- D. asset -----------------------------------------------------------------------------------------------------
  const payload = payloadFor("Osmanlı askerleri surlara doğru yürüyor, Bizans savunucuları bekliyor");
  const raster = await rasterizeCharacterSceneSvg(renderCharacterSceneAssetFrame(payload, 1.2));
  assert.equal(raster.ok, true, "sharp is installed with the framework");
  if (!raster.ok) return;
  const stored = embedCharacterScenePayload(raster.png, payload);
  await scenario("the PNG payload round-trips and a damaged, doubled or relabelled payload is refused", () => {
    assert.deepEqual(readCharacterScenePayload(stored), { status: "VALID", payload });
    assert.deepEqual(readCharacterScenePayload(raster.png), { status: "ABSENT" });
    assert.deepEqual(readCharacterScenePayload(Buffer.from("not a png")), { status: "ABSENT" });
    const flipped = Buffer.from(stored);
    const at = flipped.indexOf(Buffer.from("atolye:character-scene")) + 40;
    flipped[at] = flipped[at]! ^ 0x01;
    assert.equal(readCharacterScenePayload(flipped).status, "INVALID");
    assert.throws(() => embedCharacterScenePayload(stored, payload), /PNG_INVALID/);
    assert.throws(() => embedCharacterScenePayload(raster.png, { ...payload, request: { ...payload.request, format: "GENERAL" } }), /PAYLOAD_INVALID/);
    assert.throws(() => embedCharacterScenePayload(raster.png, { ...payload, fontFamily: "Comic Sans MS" }), /PAYLOAD_INVALID/);
    assert.equal(stored.readUInt32BE(16), 1920);
    assert.equal(stored.readUInt32BE(20), 1080);
  });

  // ---- E. provider + visuals stage ----------------------------------------------------------------------------------
  await scenario("routing: IMAGE_PROVIDER=character builds the character provider", () => {
    assert.equal(resolveImageProviderName("character"), "character");
    assert.equal(resolveImageProviderName(" Character "), "character");
    assert.equal(ImageProviderRouter.getProvider("character").name, "character");
  });
  const slug = `${prefix}-visuals`;
  let generatedAssets: Asset[] = [];
  await scenario("visuals stage: every scene is a $0 labelled reenactment, outside the AI-image cap", async () => {
    await ProjectManager.createProject(slug);
    const visualData: VisualData = {
      projectId: "character-smoke",
      scenes: [
        { sceneId: 1, visualPrompt: "Ottoman soldiers advance toward the walls of Constantinople", animationPrompt: "push", style: "cinematic", searchKeywords: ["Ottoman army"] },
        { sceneId: 2, visualPrompt: "Padişah divanda vezirleriyle konuşuyor", animationPrompt: "hold", style: "cinematic" },
      ],
      thumbnail: { title: "t", prompt: "p", composition: "c", mood: "m" },
      createdAt: now,
    };
    const assets = await VisualAssetPipeline.generateAssets({
      projectId: "character-smoke", projectSlug: slug, visualData, provider: new CharacterImageProvider(), maxAiImages: 0,
    });
    generatedAssets = assets.assets.filter((asset) => asset.type === "image" && asset.status === "generated");
    assert.equal(generatedAssets.length, 2);
    for (const asset of generatedAssets) {
      assert.equal(asset.provider, "character");
      assert.equal(asset.mediaOrigin, "ai");
      assert.equal(asset.mediaType, "ai-image");
      assert.equal(asset.selectionReason, "local-character-reenactment");
      assert.equal(asset.license, undefined);
      const bytes = fs.readFileSync(path.join(projectsRoot, slug, "assets", "images", path.posix.basename(String(asset.filePath))));
      const read = readCharacterScenePayload(bytes);
      assert.equal(read.status, "VALID");
      if (read.status === "VALID") assert.equal(read.payload.request.format, "DOCUMENTARY");
    }
  });
  await scenario("a request without a project slug or scene fails without writing", async () => {
    const result = await new CharacterImageProvider().generateImage({ prompt: "x", sceneId: 0, projectSlug: slug });
    assert.equal(result.success, false);
    const missing = await new CharacterImageProvider().generateImage({ prompt: "x", sceneId: 1 });
    assert.equal(missing.success, false);
  });

  // ---- F. scene video -----------------------------------------------------------------------------------------------
  if (ffmpeg && ffprobe) {
    await scenario("LIVE FFmpeg: a character scene renders animated 1920x1080 30 fps frames and cleans up", async () => {
      const image = generatedAssets.find((asset) => asset.sceneId === 1)!;
      const plain = ImageStorage.saveImage({ projectSlug: slug, data: raster.png, assetId: `${prefix}-plain`, mimeType: "image/png" });
      const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("atolye-charframes-")));
      const config = { ffmpegPath: ffmpeg, ffprobePath: ffprobe, timeoutMs: 120_000, maxOutputBytes: 64 * 1024 * 1024, maxStdioBytes: 1024 * 1024 };
      const result = await new FFmpegSceneVideoProvider(new SpawnRunner(), () => config).generateVideo({
        projectId: "character-smoke", projectSlug: slug,
        scenes: [
          { sceneId: 1, sourceImageAssetId: image.id, animationAssetId: `${image.id}-anim`, imageFilePath: String(image.filePath), imageMimeType: "image/png", motionPlan: motionPlan(1, image.id, 2) },
          { sceneId: 2, sourceImageAssetId: `${prefix}-plain`, animationAssetId: `${prefix}-plain-anim`, imageFilePath: plain.filePath, imageMimeType: "image/png", motionPlan: motionPlan(2, `${prefix}-plain`, 1) },
        ],
      });
      assert.equal(result.success, true, JSON.stringify(result));
      if (!result.success) return;
      const video = path.join(projectsRoot, slug, "assets", "videos", path.posix.basename(result.scenes[0]!.filePath));
      const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
        "stream=width,height,avg_frame_rate,nb_read_frames:format=duration", "-of", "json", video], { encoding: "utf8" })) as {
        streams: { width: number; height: number; avg_frame_rate: string; nb_read_frames: string }[]; format: { duration: string } };
      assert.deepEqual([probe.streams[0]!.width, probe.streams[0]!.height, probe.streams[0]!.avg_frame_rate], [1920, 1080, "30/1"]);
      assert.ok(Math.abs(Number(probe.format.duration) - 2) < 0.1, probe.format.duration);
      assert.ok(Math.abs(Number(probe.streams[0]!.nb_read_frames) - 60) <= 1, probe.streams[0]!.nb_read_frames);
      // The frames really differ: the first and last second of the scene are not the same picture.
      const grab = (t: number) => execFileSync(ffmpeg, ["-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "96x54", "-"]);
      assert.notDeepEqual(grab(0.1), grab(1.8));
      const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("atolye-charframes-") && !before.has(name));
      assert.deepEqual(after, [], "frame folder removed");
      assert.equal(result.scenes[1]!.durationSeconds > 0, true, "an ordinary PNG still renders");
    });
  } else {
    console.log("NOTE: FFmpeg unavailable — scenario F (LIVE scene video) skipped.");
  }
  await scenario("an ordinary image keeps the still path; a damaged payload fails the scene closed", async () => {
    const image = generatedAssets.find((asset) => asset.sceneId === 2)!;
    const args = buildSceneFFmpegArgs({ sceneId: 2, sourceImageAssetId: image.id, animationAssetId: "x", imageFilePath: String(image.filePath), imageMimeType: "image/png", motionPlan: motionPlan(2, image.id, 1) }, "out.mp4");
    assert.ok(args.includes("-loop"), "the still path is unchanged");
    const damaged = Buffer.from(fs.readFileSync(path.join(projectsRoot, slug, "assets", "images", path.posix.basename(String(image.filePath)))));
    const at = damaged.indexOf(Buffer.from("atolye:character-scene")) + 50;
    damaged[at] = damaged[at]! ^ 0x01;
    const saved = ImageStorage.saveImage({ projectSlug: slug, data: damaged, assetId: `${prefix}-damaged`, mimeType: "image/png" });
    const config = { ffmpegPath: ffmpeg ?? process.execPath, ffprobePath: ffprobe ?? process.execPath, timeoutMs: 30_000, maxOutputBytes: 1024, maxStdioBytes: 1024 };
    const result = await new FFmpegSceneVideoProvider(new SpawnRunner(), () => config).generateVideo({
      projectId: "character-smoke", projectSlug: slug,
      scenes: [{ sceneId: 3, sourceImageAssetId: `${prefix}-damaged`, animationAssetId: "y", imageFilePath: saved.filePath, imageMimeType: "image/png", motionPlan: motionPlan(3, `${prefix}-damaged`, 1) }],
    });
    assert.equal(result.success, false);
  });

  // ---- G. cost / readiness / director ---------------------------------------------------------------------------------
  await scenario("cost, readiness and the AYAS director treat the mode as $0, ready and labelled", () => {
    const estimate = estimateProductionCost({
      chapterCount: 6, sceneCount: 30, narrationCharacters: 9000, plannedAiImageCount: 30, textModel: "qwen2.5:3b", ttsModel: "tts-1",
      imageModel: "gpt-image-1", imageSize: "1536x1024", imageQuality: "auto", textProvider: "ollama", animationProvider: "ollama",
      youtubeProvider: "ollama", ttsProvider: "piper", imageProvider: "character", thumbnailProvider: "local",
    }, { budgetUsd: 1 });
    assert.equal(estimate.breakdown.imageUsd, 0);
    assert.equal(estimate.totalUsd, 0);
    const service = new ProductionReadinessService({ environment: { IMAGE_PROVIDER: "character" } as unknown as NodeJS.ProcessEnv });
    const checks = (service as unknown as { providerChecks(): { id: string; status: string }[] }).providerChecks();
    assert.equal(checks.find((item) => item.id === "image-provider")?.status, "READY");
    assert.equal(resolveAyasDirectorProvider("IMAGE_PROVIDER", { IMAGE_PROVIDER: "character" } as unknown as NodeJS.ProcessEnv).costClass, "local-zero-cost");
    const asset = generatedAssets.find((item) => item.sceneId === 1)!;
    const task = directorTaskFromProjectArtifacts({
      project: { id: "p", slug, title: "t", status: "draft", createdAt: now, updatedAt: now },
      scenes: { scenes: [{ id: 1, title: "s", description: "d" }, { id: 2, title: "s2", description: "d2" }], createdAt: now },
      animation: { projectId: "p", scenes: [{ sceneId: 1, animationPrompt: "a", sourceImageAssetId: asset.id, status: "generated" }, { sceneId: 2, animationPrompt: "b", sourceImageAssetId: "other", status: "generated" }], createdAt: now },
      assets: { projectId: "p", projectSlug: slug, assets: generatedAssets, createdAt: now, updatedAt: now },
    }, { format: "DOCUMENTARY" });
    assert.equal(task.scenes[0]!.reconstructionLabeled, true);
    assert.equal(task.scenes[1]!.reconstructionLabeled, false);
    assert.equal(task.candidates.find((item) => item.id === asset.id)?.origin, "GENERATED");
  });

  // ---- H. start screen --------------------------------------------------------------------------------------------------
  await scenario("the start screen finds the project its own request created", () => {
    for (const topic of ["Osmanlı'nın Kuruluşu", "  Çanakkale Savaşı 1915 ", "Hunların Doğuşu", "İstanbul'un Fethi"]) {
      assert.equal(createProjectSlug(topic), ProjectManager.createSlug(topic));
    }
    assert.equal(createProjectSlug("İstanbul'un Fethi"), "i-stanbul-un-fethi", "existing slugs are kept as they were");
    const started = Date.parse("2026-10-11T10:00:00.000Z");
    const list = [{ slug: "roma", createdAt: "2026-10-11T10:00:01.000Z" }, { slug: "eski", createdAt: "2026-10-01T10:00:00.000Z" }];
    assert.equal(findStartedProjectUrl(list, "roma", started), "/project/roma");
    assert.equal(findStartedProjectUrl(list, "eski", started), null, "an older project of the same topic is not this one");
    assert.equal(findStartedProjectUrl([{ slug: "roma", createdAt: "2026-10-11T09:57:00.000Z" }], "roma", started), "/project/roma", "clock tolerance");
    assert.equal(findStartedProjectUrl(list, "yok", started), null);
    assert.equal(findStartedProjectUrl(list, "../admin", started), null);
    assert.equal(findStartedProjectUrl({ projects: list }, "roma", started), null);
    assert.equal(findStartedProjectUrl([null, 1, { slug: "roma" }], "roma", started), null);
  });

  // ---- I. GPU admission ---------------------------------------------------------------------------------------------------
  await scenario("GPU admission waits for a hot card, gives up after its bound, and reads once when not waiting", async () => {
    let clock = 0;
    const sleep = async (ms: number) => { clock += ms; };
    const temps = [76, 74, 72];
    const reads: number[] = [];
    const read = async () => { const temp = temps.shift() ?? 72; reads.push(temp); return { tripped: temp >= 73, reason: `${temp}` }; };
    const cooled = await awaitAyasGpuThermalHeadroom({ wait: true, read, sleep, now: () => clock, pollMs: 15_000, maxWaitMs: 600_000 });
    assert.deepEqual([cooled.tripped, cooled.waitedMs, reads], [false, 30_000, [76, 74, 72]]);
    clock = 0;
    const hot = await awaitAyasGpuThermalHeadroom({ wait: true, read: async () => ({ tripped: true, reason: "70" }), sleep, now: () => clock, pollMs: 15_000, maxWaitMs: 40_000 });
    assert.deepEqual([hot.tripped, hot.waitedMs], [true, 40_000]);
    let once = 0;
    const single = await awaitAyasGpuThermalHeadroom({ wait: false, read: async () => { once += 1; return { tripped: true, reason: "65" }; }, sleep, now: () => clock });
    assert.deepEqual([single.tripped, once], [true, 1]);
    // Off the A2000 profile there is no hard stop, so nothing is even read from the GPU.
    const unread = async () => { throw new Error("the GPU must not be read off the A2000 profile"); };
    assert.equal((await readAyasGpuThermal({ ATOLYE_BRAIN_HARDWARE_PROFILE: "gtx-1650-4gb" } as unknown as NodeJS.ProcessEnv, unread)).tripped, false);
    assert.equal((await readAyasGpuThermal({} as unknown as NodeJS.ProcessEnv, unread)).tripped, false);
    // On the A2000 the limit is the Brain probe's own shared stop (85 °C since 2026-10-21), and an unreadable card does not hold.
    const a2000 = { ATOLYE_BRAIN_HARDWARE_PROFILE: "rtx-a2000-12gb" } as unknown as NodeJS.ProcessEnv;
    assert.equal((await readAyasGpuThermal(a2000, async () => 85)).tripped, true);
    assert.equal((await readAyasGpuThermal(a2000, async () => 86)).tripped, true);
    assert.equal((await readAyasGpuThermal(a2000, async () => 84.9)).tripped, false);
    assert.equal((await readAyasGpuThermal(a2000, async () => 60)).tripped, false);
    assert.equal((await readAyasGpuThermal(a2000, async () => undefined)).tripped, false);
    assert.equal(AYAS_A2000_GPU_HARD_STOP_C, BRAIN_A2000_GPU_HARD_STOP_C, "mirrors the Brain probe limit");
    assert.equal(AYAS_A2000_PROFILE_ID, BRAIN_A2000_PROFILE_ID, "mirrors the Brain probe profile");
    assert.equal(await readAyasGpuTemperatureC({ run: async () => "41\r\n57\r\n" }), 57, "hottest card");
    assert.equal(await readAyasGpuTemperatureC({ run: async () => "[N/A]" }), undefined);
    assert.equal(await readAyasGpuTemperatureC({ run: async () => { throw new Error("no nvidia-smi"); } }), undefined);
  });
}

async function main() {
  const ffmpeg = [process.env.FFMPEG_EXECUTABLE, process.env.FFMPEG_PATH, dotEnvValue("FFMPEG_EXECUTABLE"), dotEnvValue("FFMPEG_PATH")].find((value) => value && fs.existsSync(value)) ?? null;
  const ffprobe = [process.env.FFPROBE_EXECUTABLE, process.env.FFPROBE_PATH, dotEnvValue("FFPROBE_EXECUTABLE"), dotEnvValue("FFPROBE_PATH")].find((value) => value && fs.existsSync(value)) ?? null;
  await withCanonicalSmokeRuntime({ name: "character-animation", now }, async (runtime) => {
    assert.ok(findSceneBlockingProblems(blocking()).length === 0);
    await run(runtime.runtimeStorageContext.projectsRoot, `charanim-${runtime.runId.slice(0, 10)}`, ffmpeg, ffprobe);
  });
  console.log(`Character animation pipeline smoke: PASS (${count} scenarios)`);
}

main().catch((error) => {
  console.error("Character animation pipeline smoke FAILED:", error);
  process.exitCode = 1;
});
