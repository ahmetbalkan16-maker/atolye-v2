/**
 * READ-ONLY diagnostic: reproduces the i-stanbul-un-fethi-1453 `assembly`
 * stage render against a temp fs COPY of the real project (production-execution/
 * excluded), on the current HEAD, with the REAL FFmpeg assembly provider and
 * Sprint 149's detailed validateProbe / logAssemblyFailure diagnostics.
 *
 * Zero production mutation: everything happens inside withCanonicalSmokeRuntime's
 * isolated runtime root against a throwaway copy. No durable attempt record, no
 * retry-budget consumption, no write to data/projects/i-stanbul-un-fethi-1453/.
 *
 * It runs renderExistingAssets twice:
 *   (A) with the exact on-disk assembly.json (stale scene asset ids)
 *   (B) with the plan AssemblyManager.generateAssemblyPlan would compute now
 *       (fallback path, rebuilt from the current video.json / animation.json /
 *       audio.json) -- i.e. what the real assembly stage actually renders.
 *
 * Prints, for each scene: planned scene duration, narration duration, the
 * assembly branch taken, and -- on failure -- the full underlying error and
 * every [VideoAssemblyManager] / [FFmpegVideoAssemblyProvider] diagnostic line.
 */
import fs from "node:fs";
import path from "node:path";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { AssemblyManager } from "../src/lib/assembly/AssemblyManager";
import { VideoAssemblyManager } from "../src/lib/assembly/VideoAssemblyManager";
import { FFmpegVideoAssemblyProvider } from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import { resolveRuntimeLogicalPath } from "../src/lib/runtime/RuntimeStoragePaths";
import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers";
import type { ScriptData } from "../src/types/script";
import type { SceneData } from "../src/types/scene";
import type { VisualData } from "../src/types/visual";
import type { AudioData } from "../src/types/audio";
import type { AnimationData } from "../src/types/animation";
import type { VideoData } from "../src/types/video";
import type { AssemblyPlanData } from "../src/types/assembly";
import type { Project } from "../src/types/project";

const SOURCE_SLUG = "i-stanbul-un-fethi-1453";
const FFMPEG = process.env.FFMPEG_EXECUTABLE || process.env.FFMPEG_PATH || "";
const FFPROBE = process.env.FFPROBE_EXECUTABLE || process.env.FFPROBE_PATH || "";

function copyDirReplacingSlug(src: string, dest: string, targetSlug: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "production-execution") continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirReplacingSlug(s, d, targetSlug);
    else if (entry.isFile()) {
      if (entry.name.endsWith(".json")) {
        fs.writeFileSync(d, fs.readFileSync(s, "utf-8").replaceAll(SOURCE_SLUG, targetSlug), "utf-8");
      } else fs.copyFileSync(s, d);
    }
  }
}

const emptyPlanProvider: AIProvider = {
  async generate(): Promise<AIProviderResult> {
    return { content: "", finishReason: "stop", refused: false, complete: true, truncated: false };
  },
};

function summariseError(err: unknown): string {
  if (err instanceof Error) {
    const withInternal = err as Error & { internalDiagnosticStack?: unknown; cause?: unknown };
    const parts = [`${err.name}: ${err.message}`];
    if (typeof withInternal.internalDiagnosticStack === "string") {
      parts.push(`internalDiagnosticStack:\n${withInternal.internalDiagnosticStack}`);
    }
    if (withInternal.cause) parts.push(`cause: ${summariseError(withInternal.cause)}`);
    if (err.stack) parts.push(`stack:\n${err.stack}`);
    return parts.join("\n");
  }
  return String(err);
}

async function renderWith(
  label: string,
  input: Parameters<typeof VideoAssemblyManager.renderExistingAssets>[0],
) {
  console.log(`\n========================= ${label} =========================`);
  const captured: string[] = [];
  const origErr = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args.map((a) => (typeof a === "string" ? a : summariseError(a))).join(" "));
  };
  try {
    const result = await VideoAssemblyManager.renderExistingAssets(input);
    console.error = origErr;
    console.log(`RESULT: SUCCESS`);
    console.log(JSON.stringify(result.render, null, 2));
    return { ok: true as const, result };
  } catch (err) {
    console.error = origErr;
    console.log(`RESULT: FAILED`);
    console.log(`--- thrown error ---\n${summariseError(err)}`);
    if (captured.length) console.log(`--- captured console.error (diagnostics) ---\n${captured.join("\n")}`);
    return { ok: false as const, err, diagnostics: captured };
  }
}

/**
 * The copy excludes production-execution/, so AudioStorage's inode-pinned
 * canonical-descriptor protection (assertProtectedAudioCanonicalResolutionAllowed
 * -> readCanonicalFileDescriptorBound) has no ledger to resolve against and
 * fails for every WAV -- a pure isolation artifact. Patch inspectStoredWav to a
 * plain contained read + header inspection so the rest of the pipeline (section
 * audio mapping + FFmpeg render + validateProbe) is exercised on real media.
 * The real assembly stage still runs the full protection on the live project.
 */
function bypassAudioCanonicalProtection() {
  const storage = AudioStorage as unknown as {
    inspectStoredWav: (slug: string, filePath: string, input?: unknown) => unknown;
    inspectWav: (buf: Buffer) => unknown;
  };
  storage.inspectStoredWav = (_slug: string, filePath: string) => {
    const abs = resolveRuntimeLogicalPath(filePath);
    return storage.inspectWav(fs.readFileSync(abs));
  };
}

async function main() {
  console.log(`FFMPEG=${FFMPEG || "(unset)"}`);
  console.log(`FFPROBE=${FFPROBE || "(unset)"}`);
  if (!FFMPEG || !FFPROBE || !fs.existsSync(FFMPEG) || !fs.existsSync(FFPROBE)) {
    console.log("SKIP: real FFmpeg/FFprobe not available (set FFMPEG_EXECUTABLE / FFPROBE_EXECUTABLE).");
    return;
  }

  const { finalization } = await withCanonicalSmokeRuntime(
    {
      name: "istanbul-1453-assembly-render-diag",
      projectSlug: "istanbul-1453-assembly-diag",
      configureProductionExecution: true,
      environment: {
        VIDEO_ASSEMBLY_PROVIDER: "ffmpeg",
        FFMPEG_PATH: FFMPEG,
        FFPROBE_PATH: FFPROBE,
        FFMPEG_EXECUTABLE: FFMPEG,
        FFPROBE_EXECUTABLE: FFPROBE,
      },
    },
    async (runtime) => {
      const src = path.join(process.cwd(), "data", "projects", SOURCE_SLUG);
      const dest = path.join(runtime.runtimeStorageContext.projectsRoot, runtime.projectSlug);
      console.log(`\n[copy] ${src}\n    -> ${dest} (slug ${SOURCE_SLUG} -> ${runtime.projectSlug})`);
      copyDirReplacingSlug(src, dest, runtime.projectSlug);
      bypassAudioCanonicalProtection();
      console.log("[patch] AudioStorage.inspectStoredWav -> plain contained read (isolation artifact bypass)");

      const ctx = runtime.runtimeStorageContext;
      const script = (await ProjectReader.readJSON<ScriptData>(runtime.projectSlug, "script.json", ctx))!;
      const scenes = (await ProjectReader.readJSON<SceneData>(runtime.projectSlug, "scenes.json", ctx))!;
      const visuals = (await ProjectReader.readJSON<VisualData>(runtime.projectSlug, "visuals.json", ctx))!;
      const audio = (await ProjectReader.readJSON<AudioData>(runtime.projectSlug, "audio.json", ctx))!;
      const animation = (await ProjectReader.readJSON<AnimationData>(runtime.projectSlug, "animation.json", ctx))!;
      const video = (await ProjectReader.readJSON<VideoData>(runtime.projectSlug, "video.json", ctx))!;
      const diskAssembly = (await ProjectReader.readJSON<AssemblyPlanData>(runtime.projectSlug, "assembly.json", ctx))!;
      const projectJson = (await ProjectReader.readJSON<Project>(runtime.projectSlug, "project.json", ctx))!;
      const projectId = projectJson.id;

      console.log(`\n[packages]`);
      console.log(`  scenes:     ${scenes.scenes.length} (${scenes.scenes.map((s) => s.duration).join(", ")}s planned)`);
      console.log(`  audio:      ${audio.sections.length} sections (${audio.sections.map((s) => s.durationSeconds).join(", ")}s) outputAssetId=${audio.outputAssetId}`);
      console.log(`  animation:  ${animation.scenes.length} scenes (${animation.scenes.map((s) => s.durationSeconds).join(", ")}s)`);
      console.log(`  video.json: ${video.scenes.length} scenes (${video.scenes.map((s) => s.durationSeconds).join(", ")}s) ids=${video.scenes.map((s) => s.videoAssetId).join(",")}`);
      console.log(`  assembly.json (on disk): updatedAt=${diskAssembly.updatedAt} sourceAudioAssetId=${diskAssembly.sourceAudioAssetId}`);
      console.log(`     scene videoAssetIds: ${diskAssembly.scenes.map((s) => s.videoAssetId ?? "(none)").join(", ")}`);
      console.log(`     scene animationAssetIds: ${diskAssembly.scenes.map((s) => s.animationAssetId ?? "(none)").join(", ")}`);
      const narrationTotal = audio.sections.reduce((n, s) => n + (s.durationSeconds ?? 0), 0);
      console.log(`  narration total (expected output duration): ${narrationTotal.toFixed(4)}s`);

      // (B) what the real assembly stage computes now: generateAssemblyPlan's
      // fallback path, rebuilt from the current video/animation/audio packages.
      const computedPlan = await AssemblyManager.generateAssemblyPlan(
        script, scenes, visuals, audio,
        { project: projectJson, animation, video },
        { projectSlug: runtime.projectSlug, stage: "assembly", operation: "assembly-plan" },
        { aiProvider: emptyPlanProvider },
      );
      console.log(`\n[computed plan (fallback)] status=${computedPlan.status} sourceAudioAssetId=${computedPlan.sourceAudioAssetId}`);
      console.log(`     scene videoAssetIds: ${computedPlan.scenes.map((s) => s.videoAssetId ?? "(none)").join(", ")}`);
      console.log(`     scene animationAssetIds: ${computedPlan.scenes.map((s) => s.animationAssetId ?? "(none)").join(", ")}`);
      console.log(`     scene audioAssetIds: ${computedPlan.scenes.map((s) => s.audioAssetId ?? "(none)").join(", ")}`);

      await renderWith("A) render with ON-DISK assembly.json (stale)", {
        projectId, projectSlug: runtime.projectSlug,
        scenes, visuals, audio, assembly: diskAssembly, animation, video,
        provider: new FFmpegVideoAssemblyProvider(), strictProductionAcceptance: true,
      });

      await renderWith("B) render with COMPUTED plan (what the assembly stage renders now)", {
        projectId, projectSlug: runtime.projectSlug,
        scenes, visuals, audio, assembly: computedPlan, animation, video,
        provider: new FFmpegVideoAssemblyProvider(), strictProductionAcceptance: true,
      });
    },
  );

  console.log(`\n[isolation] cleanupCompleted=${finalization.cleanupCompleted} runtimeRemainder=${finalization.runtimeRemainder}`);
}

void main().catch((err) => {
  console.error("DIAGNOSTIC ERROR:", err);
  process.exitCode = 1;
});
