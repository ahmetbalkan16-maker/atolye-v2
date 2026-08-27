import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import { VideoAssemblyManager, VideoAssemblyError } from "../src/lib/assembly/VideoAssemblyManager";
import type { VideoAssemblyProvider } from "../src/lib/assembly/providers/VideoAssemblyProvider";
import type { VideoAssemblyResult } from "../src/types/videoAssembly";
import type { SceneData } from "../src/types/scene";
import type { VisualData } from "../src/types/visual";
import type { AudioData } from "../src/types/audio";
import type { AssemblyPlanData } from "../src/types/assembly";
import { runWithProductionRuntimeOperationContext } from
  "../src/lib/runtime/ProductionRuntimeOperationContext";
import type { RuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { withCanonicalSmokeRuntime, type CanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";

/**
 * Covers the A1 fix: `requireAudioAsset()` in VideoAssemblyManager.ts must reject an
 * asset whose `model` is "mock" even when its `provider` is not literally "mock" —
 * the exact "provider: openai, model: mock" placeholder shape found on
 * i-stanbul-un-fethi-1453's original (silent) narration/mix assets.
 *
 * Runs inside `withCanonicalSmokeRuntime` (the same isolated-project-tree +
 * production-runtime-operation-context harness used elsewhere in this repo's smoke
 * suites, e.g. `smoke-sprint-129-27-audio-remediation.ts`) because
 * `requireAudioAsset()`/`requireImageAsset()` re-inspect the physical file through
 * `AudioStorage`/`ImageStorage`, and `AudioStorage.saveAudio` itself requires an
 * active `ProductionRuntimeOperationContext` to publish through
 * `AudioCompensationStore`'s descriptor-bound chain of custody — there is no
 * lighter-weight way to produce a WAV `requireAudioAsset()` will actually accept.
 *
 * Uses a fake provider (self-reporting `.name === "ffmpeg"` — the only two names
 * `VideoAssemblyManager` accepts) whose `.assemble()` either asserts it is never
 * reached (the two rejection scenarios) or records that it *was* reached (the control
 * scenario, proving a real asset still gets past narration/mix resolution) — no ffmpeg
 * subprocess, no real media I/O.
 */

let passCount = 0;
function pass(label: string) { passCount += 1; console.log(`PASS: ${label}`); }

const PROJECT_ID = "project-mock-model-guard";

function fixtureScenes(): SceneData {
  return { scenes: [{ id: 1, chapterId: 1, title: "s1", description: "d", duration: 10 }],
    createdAt: new Date().toISOString() };
}
function fixtureVisuals(): VisualData {
  return {
    projectId: PROJECT_ID,
    scenes: [{ sceneId: 1, visualPrompt: "p", animationPrompt: "a", style: "s" }],
    thumbnail: { concept: "c", mood: "m", colors: [] } as unknown as VisualData["thumbnail"],
    createdAt: new Date().toISOString(),
  };
}
function fixtureAudio(sectionAssetId: string, mixAssetId: string): AudioData {
  return {
    outputAssetId: mixAssetId,
    status: "generated",
    narrator: { style: "documentary", tone: "cinematic", language: "tr" },
    sections: [{
      chapterId: 1, title: "s1", duration: "10s", emotion: "cinematic", emphasis: [],
      narrationNotes: "clear", pacing: "normal", sourceText: "text",
      outputAssetId: sectionAssetId, status: "generated", durationSeconds: 10,
    }],
    music: { mood: "cinematic", suggestion: "orchestral", intensity: "medium" },
    production: { targetFormat: "wav", sampleRate: 44100, estimatedTotalDuration: "00:00:10",
      generationStatus: "generated" },
    createdAt: new Date().toISOString(),
  };
}
function fixtureAssembly(slug: string): AssemblyPlanData {
  return {
    projectId: PROJECT_ID, slug, status: "assembled",
    scenes: [{ sceneId: 1, chapterId: 1, duration: "00:10", visualReference: "visual-1",
      audioAssetId: "section-1", audioReference: "section-1", transition: "cut",
      cameraMovement: "static", effects: [] } as unknown as AssemblyPlanData["scenes"][number]],
    totalDuration: "00:10", style: "documentary",
    render: { status: "planned" },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

/**
 * Records whether `.assemble()` was reached at all — i.e. whether narration/mix
 * resolution let the scene through — before throwing (an intentionally incomplete
 * fake result; only reachability is asserted). Deliberately does not need to satisfy
 * the full post-assemble MP4 storage validation (`VideoStorage.inspectStoredMp4`),
 * which needs a real container on disk; that stage is unrelated to the A1 fix and out
 * of scope here.
 *
 * Both the "should reject" and "should proceed" scenarios must check this flag, not
 * just that a `VideoAssemblyError` was thrown: `safeAssemble()` normalizes *any*
 * `.assemble()` failure into the same `VideoAssemblyError`, so a provider that always
 * throws would make every scenario "pass" whether or not the guard under test ever
 * actually fired.
 */
function trackingProvider(onReached: () => void): VideoAssemblyProvider {
  return {
    get name() { return "ffmpeg" as const; },
    async assemble(): Promise<VideoAssemblyResult> {
      onReached();
      throw new Error("intentionally incomplete fake result — only reachability is asserted");
    },
  } as unknown as VideoAssemblyProvider;
}

function writeAssetsRegistry(storageContext: RuntimeStorageContext, slug: string, assets: unknown[]) {
  const assetsPath = path.join(storageContext.projectsRoot, slug, "assets", "assets.json");
  fs.mkdirSync(path.dirname(assetsPath), { recursive: true });
  fs.writeFileSync(assetsPath, JSON.stringify({
    projectId: PROJECT_ID, projectSlug: slug, assets, createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, null, 2));
}

const WAV_SAMPLE_RATE = 8000;
function buildTestWav(durationSeconds: number): Buffer {
  const numSamples = Math.round(durationSeconds * WAV_SAMPLE_RATE);
  const data = Buffer.alloc(numSamples * 2); // mono, 16-bit
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(WAV_SAMPLE_RATE, 24);
  header.writeUInt32LE(WAV_SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
function writeTestWav(slug: string, fileName: string, durationSeconds: number) {
  const bytes = buildTestWav(durationSeconds);
  const saved = AudioStorage.saveAudio({ projectSlug: slug, data: bytes, fileName }, {});
  return { filePath: saved.filePath, url: saved.url, byteLength: saved.byteLength,
    durationSeconds: saved.durationSeconds };
}
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function writeTestPng(storageContext: RuntimeStorageContext, slug: string, fileName: string) {
  const bytes = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(16)]);
  const target = path.join(storageContext.projectsRoot, slug, "assets", "images", fileName);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  return { byteLength: bytes.length };
}

function imageAssetFields(slug: string, byteLength: number) {
  return {
    id: "image-1", projectId: PROJECT_ID, projectSlug: slug, sceneId: 1,
    type: "image" as const, status: "generated" as const, provider: "openai", model: "dall-e-3",
    prompt: "img", mimeType: "image/png" as const, byteLength,
    filePath: `data/projects/${slug}/assets/images/image-1.png`,
    url: `/api/assets/images/${slug}/image-1.png`,
  };
}

function baseAssetFields(slug: string, id: string, sceneId: number | undefined, durationSeconds: number) {
  const written = writeTestWav(slug, `${id}.wav`, durationSeconds);
  return {
    id, projectId: PROJECT_ID, projectSlug: slug, sceneId, type: "audio" as const,
    status: "generated" as const, mimeType: "audio/wav" as const,
    filePath: written.filePath, url: written.url,
    byteLength: written.byteLength, durationSeconds: written.durationSeconds, prompt: "narration",
  };
}

async function run() {
  await withCanonicalSmokeRuntime({
    name: "mock-model-guard",
    operationType: "video-assembly-mock-model-guard-test",
    enterOperationContext: false,
  }, async (canonicalRuntime: CanonicalSmokeRuntime) => {
    await runWithProductionRuntimeOperationContext(canonicalRuntime.operationContext, async () => {
      const storageContext = canonicalRuntime.runtimeStorageContext;

      // Scenario A: literal provider === "mock" (already-existing guard) must still reject.
      {
        const slug = "mock-model-guard-a";
        const image = writeTestPng(storageContext, slug, "image-1.png");
        writeAssetsRegistry(storageContext, slug, [
          { ...baseAssetFields(slug, "section-1", 1, 10), provider: "mock", model: "mock" },
          { ...baseAssetFields(slug, "mix-1", undefined, 10), provider: "mock", model: "mock" },
          imageAssetFields(slug, image.byteLength),
        ]);
        let reached = false;
        await assert.rejects(
          VideoAssemblyManager.renderExistingAssets({
            projectId: PROJECT_ID, projectSlug: slug,
            scenes: fixtureScenes(), visuals: fixtureVisuals(),
            audio: fixtureAudio("section-1", "mix-1"), assembly: fixtureAssembly(slug),
            provider: trackingProvider(() => { reached = true; }),
          }),
          VideoAssemblyError,
        );
        assert.equal(reached, false, "assemble() must not be reached — provider:\"mock\" should fail closed first");
      }
      pass("provider:\"mock\" asset is rejected (pre-existing guard, no regression)");

      // Scenario B: the actual fix — provider looks real, model says "mock".
      {
        const slug = "mock-model-guard-b";
        const image = writeTestPng(storageContext, slug, "image-1.png");
        writeAssetsRegistry(storageContext, slug, [
          { ...baseAssetFields(slug, "section-1", 1, 10), provider: "openai", model: "mock" },
          { ...baseAssetFields(slug, "mix-1", undefined, 10), provider: "openai", model: "tts-1" },
          imageAssetFields(slug, image.byteLength),
        ]);
        let reached = false;
        await assert.rejects(
          VideoAssemblyManager.renderExistingAssets({
            projectId: PROJECT_ID, projectSlug: slug,
            scenes: fixtureScenes(), visuals: fixtureVisuals(),
            audio: fixtureAudio("section-1", "mix-1"), assembly: fixtureAssembly(slug),
            provider: trackingProvider(() => { reached = true; }),
          }),
          VideoAssemblyError,
        );
        assert.equal(reached, false,
          "assemble() must not be reached — provider:\"openai\",model:\"mock\" should fail closed first");
      }
      pass("provider:\"openai\", model:\"mock\" asset is now rejected (the A1 fix)");

      // Scenario C: control — a genuinely real-looking asset must still be accepted.
      {
        const slug = "mock-model-guard-c";
        const image = writeTestPng(storageContext, slug, "image-1.png");
        writeAssetsRegistry(storageContext, slug, [
          { ...baseAssetFields(slug, "section-1", 1, 10), provider: "openai", model: "tts-1" },
          { ...baseAssetFields(slug, "mix-1", undefined, 10), provider: "openai", model: "tts-1" },
          imageAssetFields(slug, image.byteLength),
        ]);
        let reached = false;
        await assert.rejects(
          VideoAssemblyManager.renderExistingAssets({
            projectId: PROJECT_ID, projectSlug: slug,
            scenes: fixtureScenes(), visuals: fixtureVisuals(),
            audio: fixtureAudio("section-1", "mix-1"), assembly: fixtureAssembly(slug),
            provider: trackingProvider(() => { reached = true; }),
          }),
          VideoAssemblyError,
        );
        assert.equal(reached, true, "assemble() should have been reached for a genuinely real asset");
      }
      pass("a genuinely real (non-mock) asset is still accepted — no false-positive rejection");
    });
  });

  console.log(`\nPASS (${passCount} scenarios)`);
}

run().catch((error) => {
  console.error("SMOKE_FAILED", error);
  process.exitCode = 1;
});
