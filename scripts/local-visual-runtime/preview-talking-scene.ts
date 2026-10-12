import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { withCanonicalSmokeRuntime } from "../lib/CanonicalSmokeRuntime";
import { ProjectManager } from "../../src/lib/projects/ProjectManager";
import { PiperAudioProvider } from "../../src/lib/audio/providers/PiperAudioProvider";
import { SpawnRunner } from "../../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import { assertAyasHeavyWorkloadAllowed } from "../../src/lib/ayas/machine/AyasMachineHealthGuard";
import { planCharacterScene } from "../../src/lib/animation/character/CharacterScenePlanner";
import { planCharacterSceneDirection } from "../../src/lib/animation/character/CharacterSceneDirection";
import { renderCharacterSceneAssetFrame, embedCharacterScenePayload, CHARACTER_SCENE_FONT_FAMILY } from "../../src/lib/animation/character/CharacterSceneAsset";
import { isCharacterBackdropPng, rasterizeCharacterSceneSvg } from "../../src/lib/character/CharacterSceneRasterizer";
import { EDITORIAL_RENDER_STYLE } from "../../src/lib/character/SvgSceneRenderer";
import { resolveRuntimeLogicalPath } from "../../src/lib/runtime/RuntimeStoragePaths";
import { AudioPipeline } from "../../src/lib/audio/AudioPipeline";

async function main() {
  const root = fs.realpathSync.native(process.cwd());
  const runtime = path.join(root, "bin", "ayas-local-visual");
  const candidates = path.join(runtime, "candidates");
  const candidate = fs.readdirSync(candidates).filter(n => /^ottoman-\d+\.png$/.test(n)).sort().at(-1);
  if (!candidate) throw new Error("LOCAL_VISUAL_CANDIDATE_MISSING");
  const backgroundPng = fs.readFileSync(path.join(candidates, candidate));
  const backgroundReceipt = JSON.parse(fs.readFileSync(path.join(candidates, candidate.replace(/\.png$/, ".json")), "utf8"));
  const sha256 = crypto.createHash("sha256").update(backgroundPng).digest("hex");
  if (!isCharacterBackdropPng(backgroundPng) || sha256 !== backgroundReceipt.sha256 || !backgroundReceipt.offlineInference || backgroundReceipt.paidCalls !== 0) throw new Error("LOCAL_VISUAL_CANDIDATE_REFUSED");
  const ffmpeg = process.env.FFMPEG_PATH; if (!ffmpeg || !path.isAbsolute(ffmpeg) || !fs.existsSync(ffmpeg)) throw new Error("FFMPEG_REQUIRED");
  const output = path.join(runtime, "demos", `ottoman-${Date.now()}`); fs.mkdirSync(output, { recursive: true });
  const frames = path.join(output, "frames"); fs.mkdirSync(frames);
  const narration = "Osmanlı sarayındayız. Padişah konuşuyor, danışmanı onu dinliyor. Muhafız ise kapıda bekliyor.";
  const planned = planCharacterScene({ sceneId: 1, text: "Osmanlı padişahı sarayda konuşuyor", contextualDirection: true });
  const request = { ...planned.request, blocking: { ...planned.request.blocking, caption: "Osmanlı sarayında — yerel kalite denemesi", characters: planned.request.blocking.characters.map((c, i) => i === 0 ? { ...c, expression: "HAPPY" as const } : c) } };
  const animation = { ...planned.animation, actors: planned.animation.actors.map((a, i) => i === 1 ? { ...a, action: "IDLE" as const } : a) };
  const payload = { schemaVersion: "1" as const, request, animation, fontFamily: CHARACTER_SCENE_FONT_FAMILY, renderStyle: EDITORIAL_RENDER_STYLE, direction: planCharacterSceneDirection(narration, request.blocking), background: { provider: "sdxl-local" as const, modelRevision: String(backgroundReceipt.modelRevision), sha256, stageLayout: "foreground-v1" as const } };
  await withCanonicalSmokeRuntime({ name: "local-visual-preview" }, async context => {
    const project = await ProjectManager.createProject(`local-visual-preview-${context.runId.slice(0, 10)}`);
    const generated = await AudioPipeline.generateAudio({ projectId: project.id, projectSlug: project.slug, provider: new PiperAudioProvider(), audio: { narrator: { style: "narrative", tone: "friendly", language: "tr" }, sections: [{ chapterId: 1, title: "Yerel kalite denemesi", duration: "10", emotion: "neutral", emphasis: [], narrationNotes: "Clear Turkish", pacing: "normal", sourceText: narration }], music: { mood: "calm", suggestion: "local", intensity: "low" }, production: { targetFormat: "wav", sampleRate: 22050, estimatedTotalDuration: "10", generationStatus: "planned" }, createdAt: new Date().toISOString() } });
    const audio = generated.projectAssets.assets.find(a => a.id === generated.audio.sections[0]!.outputAssetId);
    if (!audio || !audio.filePath || audio.mimeType !== "audio/wav") throw new Error("LOCAL_PREVIEW_TTS_FAILED");
    const audioFile = resolveRuntimeLogicalPath(audio.filePath, context.runtimeStorageContext);
    const wav = path.join(output, "narration.wav"); fs.copyFileSync(audioFile, wav);
    const duration = generated.audio.sections[0]!.durationSeconds ?? 0;
    if (duration <= 0 || duration > 30) throw new Error("LOCAL_PREVIEW_DURATION_REFUSED");
    const count = Math.ceil(duration * 15) + 1;
    try {
      for (let index = 0; index < count; index++) {
        if (index % 60 === 0) await assertAyasHeavyWorkloadAllowed({ stage: "video", ownedActive: true });
        const raster = await rasterizeCharacterSceneSvg(renderCharacterSceneAssetFrame(payload, index / 15, duration), { fast: true, backgroundPng });
        if (!raster.ok) throw new Error("LOCAL_PREVIEW_FRAME_FAILED");
        fs.writeFileSync(path.join(frames, `f${String(index).padStart(5, "0")}.png`), raster.png);
        if (index === 8) fs.writeFileSync(path.join(output, "scene.png"), embedCharacterScenePayload(raster.png, payload, backgroundPng));
      }
      const video = path.join(output, "preview.mp4");
      const result = await new SpawnRunner().run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-framerate", "15", "-i", path.join(frames, "f%05d.png"), "-i", wav, "-f", "lavfi", "-i", `sine=frequency=220:duration=${duration}`, "-filter_complex", "[2:a]volume=0.035[bed];[1:a][bed]amix=inputs=2:duration=first:normalize=0[a]", "-map", "0:v", "-map", "[a]", "-t", String(duration), "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-threads", "4", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", video], { timeoutMs: 120000, maxOutputBytes: 65536, healthCheck: () => assertAyasHeavyWorkloadAllowed({ stage: "assembly", ownedActive: true }) });
      if (result.failed || result.exitCode !== 0) throw new Error("LOCAL_PREVIEW_ENCODE_FAILED");
      const receipt = { status: "PASS", video, seconds: duration, width: 1920, height: 1080, frameRate: 30, backgroundNativeSize: "1024x576", backgroundModel: "sdxl-local", voice: "piper-local", syntheticBed: true, paidCalls: 0, ownerProjectUsed: false, timing: "SCENE_TEXT_ESTIMATE", ownerQualityAccepted: false };
      fs.writeFileSync(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
    } finally {
      const resolved = fs.realpathSync.native(frames);
      if (path.dirname(resolved) !== fs.realpathSync.native(output)) throw new Error("PREVIEW_CLEANUP_OUTSIDE_ROOT");
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
