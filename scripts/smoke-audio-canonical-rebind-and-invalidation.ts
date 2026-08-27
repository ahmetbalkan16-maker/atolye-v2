import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import {
  updateAudioSectionBinding,
  AudioSectionBindingError,
} from "../src/lib/audio/AudioCanonicalSectionBinding";
import { rebuildAudioMixFromCanonicalSections } from "../src/lib/audio/AudioCanonicalMixRebuilder";
import { invalidateAssemblyForAudioChange } from
  "../src/lib/audio/AudioCompensationAssemblyInvalidation";
import { bootstrapRuntimeBackupStorageAuthority } from "../src/lib/runtime/backup/RuntimeBackupAuthority";
import { createVerifiedRuntimeBackup } from "../src/lib/runtime/backup/RuntimeBackupService";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import { createRuntimeStorageContext, type RuntimeStorageContext } from
  "../src/lib/runtime/RuntimeStoragePaths";
import type { ProjectManifest, ProductionStepKey } from "../src/types/project";
import type { PipelineJobList } from "../src/types/pipelineJob";
import type { AudioData } from "../src/types/audio";

/**
 * Covers Parts A2/C's reusable primitives:
 *   - `AudioCanonicalSectionBinding.updateAudioSectionBinding` — rebind one
 *     `audio.json` section to whichever registry asset is currently authoritative
 *     for that chapter.
 *   - `AudioCanonicalMixRebuilder.rebuildAudioMixFromCanonicalSections` — rebuild the
 *     "mix" asset `VideoAssemblyManager.requireMixAsset()` needs, from the
 *     currently-bound chapter WAVs, through the same hardened `AudioStorage.saveAudio`
 *     publication path every other real audio asset uses.
 *   - `AudioCompensationAssemblyInvalidation.invalidateAssemblyForAudioChange` — the
 *     systemic Part C fix: mark a completed `assembly` stage stale (by composing Part
 *     B's plain-pipeline regeneration module) once its underlying audio has changed.
 *
 * Needs both an active `ProductionRuntimeOperationContext` (for `AudioStorage.saveAudio`)
 * and a git-initialized workspace root containing the runtime root (for
 * `createVerifiedRuntimeBackup`, used by the invalidation scenario) — see
 * `smoke-pipeline-completed-stage-regeneration.ts` for why neither
 * `withCanonicalSmokeRuntime` alone nor a bare `createRuntimeStorageContext` alone
 * satisfies both at once.
 */

let passCount = 0;
function pass(label: string) { passCount += 1; console.log(`PASS: ${label}`); }

const STAGE_ORDER: readonly ProductionStepKey[] = [
  "research", "script", "scenes", "visuals", "animation", "video", "audio",
  "assembly", "thumbnail", "seo", "youtube", "export",
];

function writeJson(storageContext: RuntimeStorageContext, slug: string, relativePath: string, value: unknown) {
  const target = path.join(storageContext.projectsRoot, slug, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
}

const WAV_SAMPLE_RATE = 8000;
function buildTestWav(durationSeconds: number): Buffer {
  const numSamples = Math.round(durationSeconds * WAV_SAMPLE_RATE);
  const data = Buffer.alloc(numSamples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(WAV_SAMPLE_RATE, 24);
  header.writeUInt32LE(WAV_SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Publishes a real, canonically-verifiable WAV and registers a matching asset. */
function publishChapterAsset(input: {
  readonly slug: string; readonly projectId: string; readonly chapterId: number;
  readonly assetId: string; readonly durationSeconds: number; readonly model?: string;
}) {
  const saved = AudioStorage.saveAudio({
    projectSlug: input.slug, data: buildTestWav(input.durationSeconds), fileName: `${input.assetId}.wav`,
  }, {});
  const asset = AssetManager.createAsset({
    id: input.assetId, projectId: input.projectId, projectSlug: input.slug, sceneId: input.chapterId,
    type: "audio", status: "generated", provider: "openai", model: input.model ?? "tts-1",
    prompt: "narration", filePath: saved.filePath, url: saved.url, mimeType: "audio/wav",
    byteLength: saved.byteLength, durationSeconds: saved.durationSeconds,
  });
  AssetManager.addAssetAtomically(input.slug, input.projectId, asset, {});
  return asset;
}

function buildProjectShell(
  storageContext: RuntimeStorageContext, slug: string, projectId: string, audio: AudioData,
) {
  const now = new Date().toISOString();
  writeJson(storageContext, slug, "project.json",
    { id: projectId, slug, title: "t", status: "assembly", createdAt: now, updatedAt: now });
  const packages = Object.fromEntries(STAGE_ORDER.map((stage) => [stage, {
    key: stage, status: "completed", fileName: `${stage}.json`, updatedAt: now,
  }])) as ProjectManifest["packages"];
  writeJson(storageContext, slug, "manifest.json", {
    project: { id: projectId, slug, title: "t", status: "assembly", createdAt: now, updatedAt: now },
    projectId, slug, version: 1, packages, createdAt: now, updatedAt: now,
  } satisfies ProjectManifest);
  writeJson(storageContext, slug, "pipeline-jobs.json", {
    projectSlug: slug,
    jobs: STAGE_ORDER.map((stage) => ({
      id: `${slug}-${stage}`, projectSlug: slug, stage, title: stage,
      status: "completed", attempts: 1, createdAt: now, updatedAt: now,
    })),
    createdAt: now, updatedAt: now,
  } satisfies PipelineJobList);
  for (const stage of ["research", "script", "scenes", "visuals", "animation"] as const) {
    writeJson(storageContext, slug, `${stage}.json`, { stage, ok: true });
  }
  writeJson(storageContext, slug, "assembly.json", {
    stage: "assembly", ok: true, sourceAudioAssetId: "stale-mix-id",
    scenes: [{ sceneId: 1, chapterId: 1, audioAssetId: "stale-section-id" }],
  });
  writeJson(storageContext, slug, "video.json",
    { projectId, createdAt: now, scenes: [], status: "generated" });
  writeJson(storageContext, slug, "audio.json", audio);
  if (!fs.existsSync(path.join(storageContext.projectsRoot, slug, "assets", "assets.json"))) {
    writeJson(storageContext, slug, "assets/assets.json",
      { projectId, projectSlug: slug, assets: [], createdAt: now, updatedAt: now });
  }
}

function baseAudioData(): AudioData {
  return {
    outputAssetId: "stale-mix-id", status: "generated",
    narrator: { style: "documentary", tone: "cinematic", language: "tr" },
    sections: [{ chapterId: 1, title: "s1", duration: "10s", emotion: "cinematic", emphasis: [],
      narrationNotes: "clear", pacing: "normal", sourceText: "text",
      outputAssetId: "stale-section-id", status: "generated", durationSeconds: 10 }],
    music: { mood: "cinematic", suggestion: "orchestral", intensity: "medium" },
    production: { targetFormat: "wav", sampleRate: 44100, estimatedTotalDuration: "00:00:10",
      generationStatus: "generated" },
    createdAt: new Date().toISOString(),
  };
}

function setUpGitBackedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-smoke-audio-rebind-"));
  const workspaceRoot = path.join(root, "workspace");
  const runtimeRoot = path.join(workspaceRoot, "runtime");
  const authorityRoot = path.join(root, "authority");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(authorityRoot, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.email", "smoke@example.invalid"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.name", "smoke"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, ".gitkeep"), "");
  execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
  execFileSync("git", ["commit", "--quiet", "-m", "init"], { cwd: workspaceRoot });
  const storageContext = createRuntimeStorageContext({
    workspaceRoot, authorityRoot, environment: { ...process.env, ATOLYE_RUNTIME_ROOT: runtimeRoot },
  });
  return { root, storageContext };
}

/** Same rationale as the equivalent helper in `smoke-pipeline-completed-stage-regeneration.ts`. */
async function withGitBackedOperationRuntime<T>(
  operation: (storageContext: RuntimeStorageContext) => Promise<T>,
): Promise<T> {
  const { root, storageContext } = setUpGitBackedRoot();
  const operationContext = createProductionRuntimeOperationContext({
    operationId: "audio-rebind-smoke", operationType: "audio-rebind-smoke-test",
    authorityGeneration: initialRuntimeAuthorityGeneration, storageContext,
  });
  try {
    return await runWithProductionRuntimeOperationContext(operationContext,
      () => operation(storageContext));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Plain (no active operation context) counterpart of `withGitBackedOperationRuntime` —
 * `createVerifiedRuntimeBackup` refuses to run `createRuntimeStorageContext` with
 * explicit options while *any* operation context is active
 * (`RUNTIME_STORAGE_OPERATION_CONTEXT_MISMATCH`), so a scenario that needs a real
 * backup but not `AudioStorage.saveAudio` must not nest inside one — matching how a
 * real audio-republish operation and a later, separate backup-gated invalidation
 * request would run as two distinct top-level operations in production, not one.
 */
async function withGitBackedRuntime<T>(
  operation: (storageContext: RuntimeStorageContext) => Promise<T>,
): Promise<T> {
  const { root, storageContext } = setUpGitBackedRoot();
  try {
    return await operation(storageContext);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function run() {
  // 1. updateAudioSectionBinding rebinds a stale section to the authoritative asset.
  await withGitBackedOperationRuntime(async (storageContext) => {
    const projectId = "project-audio-rebind";
    const slug = "audio-rebind-section";
    buildProjectShell(storageContext, slug, projectId, baseAudioData());
    const real = publishChapterAsset({
      slug, projectId, chapterId: 1, assetId: "real-chapter-1", durationSeconds: 12,
    });
    const updated = await updateAudioSectionBinding({
      projectSlug: slug, projectId, chapterId: 1, assetId: real.id, context: storageContext,
    });
    assert.equal(updated.sections[0].outputAssetId, "real-chapter-1");
    assert.equal(updated.sections[0].provider, "openai");
    assert.equal(updated.sections[0].model, "tts-1");
    assert.equal(updated.sections[0].durationSeconds, real.durationSeconds);
    assert.equal(updated.sections[0].audioFileUrl, real.url);

    // Verify assembly.json scene audioAssetId was synchronized
    const assemblyPath = path.join(storageContext.projectsRoot, slug, "assembly.json");
    const assemblyData = JSON.parse(fs.readFileSync(assemblyPath, "utf8"));
    assert.equal(assemblyData.scenes[0].audioAssetId, "real-chapter-1");

    // Verify idempotency on second run
    const reUpdated = await updateAudioSectionBinding({
      projectSlug: slug, projectId, chapterId: 1, assetId: real.id, context: storageContext,
    });
    assert.equal(reUpdated.sections[0].outputAssetId, "real-chapter-1");
    const projectAssetsAfter = AssetManager.getProjectAssets(slug, projectId, storageContext);
    const chapter1Assets = projectAssetsAfter.assets.filter(a => a.id === "real-chapter-1");
    assert.equal(chapter1Assets.length, 1, "No duplicate asset records created in registry");
  });
  pass("updateAudioSectionBinding rebinds section & assembly.json to authoritative asset idempotently");

  // 2. updateAudioSectionBinding refuses a mock/placeholder asset as authoritative.
  await withGitBackedOperationRuntime(async (storageContext) => {
    const projectId = "project-audio-rebind";
    const slug = "audio-rebind-refuses-mock";
    buildProjectShell(storageContext, slug, projectId, baseAudioData());
    const fake = publishChapterAsset({
      slug, projectId, chapterId: 1, assetId: "fake-chapter-1", durationSeconds: 12, model: "mock",
    });
    await assert.rejects(
      updateAudioSectionBinding({
        projectSlug: slug, projectId, chapterId: 1, assetId: fake.id, context: storageContext,
      }),
      (error: unknown) => error instanceof AudioSectionBindingError &&
        error.code === "AUDIO_SECTION_BINDING_ASSET_NOT_AUTHORITATIVE",
    );
  });
  pass("updateAudioSectionBinding refuses a model:\"mock\" asset as an authoritative rebind target");

  // 3. rebuildAudioMixFromCanonicalSections concatenates the bound sections into a
  //    fresh, real mix asset and updates audio.json's top-level binding.
  await withGitBackedOperationRuntime(async (storageContext) => {
    const projectId = "project-audio-rebind";
    const slug = "audio-rebind-mix";
    const audio = baseAudioData();
    audio.sections.push({ chapterId: 2, title: "s2", duration: "8s", emotion: "cinematic",
      emphasis: [], narrationNotes: "clear", pacing: "normal", sourceText: "text",
      outputAssetId: "stale-section-2", status: "generated", durationSeconds: 8 });
    buildProjectShell(storageContext, slug, projectId, audio);
    const chapter1 = publishChapterAsset({
      slug, projectId, chapterId: 1, assetId: "real-chapter-1", durationSeconds: 6,
    });
    const chapter2 = publishChapterAsset({
      slug, projectId, chapterId: 2, assetId: "real-chapter-2", durationSeconds: 4,
    });
    await updateAudioSectionBinding({
      projectSlug: slug, projectId, chapterId: 1, assetId: chapter1.id, context: storageContext,
    });
    await updateAudioSectionBinding({
      projectSlug: slug, projectId, chapterId: 2, assetId: chapter2.id, context: storageContext,
    });
    const rebuilt = await rebuildAudioMixFromCanonicalSections({
      projectSlug: slug, projectId, context: storageContext,
    });
    assert.notEqual(rebuilt.outputAssetId, "stale-mix-id");
    assert.equal(rebuilt.provider, "openai");
    assert.notEqual(rebuilt.model, "mock");
    // 6s + 4s of 8kHz mono 16-bit PCM concatenated, byte-for-byte.
    assert.equal(rebuilt.production.durationSeconds, 10);
    const projectAssets = AssetManager.getProjectAssets(slug, projectId);
    const mixAsset = projectAssets.assets.find((asset) => asset.id === rebuilt.outputAssetId);
    assert.ok(mixAsset, "the new mix asset must be registered");
    assert.equal(mixAsset?.durationSeconds, 10);
  });
  pass("rebuildAudioMixFromCanonicalSections concatenates bound sections into a real, registered mix asset");

  // 4. invalidateAssemblyForAudioChange is a no-op when assembly isn't completed.
  await withGitBackedOperationRuntime(async (storageContext) => {
    const projectId = "project-audio-rebind";
    const slug = "audio-rebind-invalidate-noop";
    buildProjectShell(storageContext, slug, projectId, baseAudioData());
    const manifestPath = path.join(storageContext.projectsRoot, slug, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ProjectManifest;
    manifest.packages.assembly.status = "pending";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const result = await invalidateAssemblyForAudioChange({ projectSlug: slug, context: storageContext });
    assert.equal(result.invalidated, false);
  });
  pass("invalidateAssemblyForAudioChange no-ops when assembly is not completed");

  // 5. invalidateAssemblyForAudioChange, given a completed assembly but no backup id,
  //    reports the plan without mutating anything (safe-by-default).
  await withGitBackedOperationRuntime(async (storageContext) => {
    const projectId = "project-audio-rebind";
    const slug = "audio-rebind-invalidate-dryrun";
    buildProjectShell(storageContext, slug, projectId, baseAudioData());
    const audioDir = path.join(storageContext.projectsRoot, slug, "assets", "audio");
    fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(path.join(audioDir, "stale-section-id.wav"), Buffer.from("x"));
    fs.writeFileSync(path.join(audioDir, "stale-mix-id.wav"), Buffer.from("y"));
    const before = fs.readFileSync(
      path.join(storageContext.projectsRoot, slug, "manifest.json"), "utf8");
    const result = await invalidateAssemblyForAudioChange({ projectSlug: slug, context: storageContext });
    assert.equal(result.invalidated, false);
    assert.match(result.planFingerprint ?? "", /^[a-f0-9]{64}$/);
    const after = fs.readFileSync(
      path.join(storageContext.projectsRoot, slug, "manifest.json"), "utf8");
    assert.equal(after, before, "manifest.json must be untouched without a backup id");
  });
  pass("invalidateAssemblyForAudioChange without a backup id reports the plan but mutates nothing");

  // 6. invalidateAssemblyForAudioChange, given a completed assembly and a real
  //    verified backup, actually requeues assembly+downstream (composing Part B) —
  //    and never touches PipelineRunner/renders anything.
  await withGitBackedRuntime(async (storageContext) => {
    const projectId = "project-audio-rebind";
    const slug = "audio-rebind-invalidate-real";
    buildProjectShell(storageContext, slug, projectId, baseAudioData());
    const audioDir = path.join(storageContext.projectsRoot, slug, "assets", "audio");
    fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(path.join(audioDir, "stale-section-id.wav"), Buffer.from("x"));
    fs.writeFileSync(path.join(audioDir, "stale-mix-id.wav"), Buffer.from("y"));
    const backupAuthority = bootstrapRuntimeBackupStorageAuthority(storageContext);
    const backup = createVerifiedRuntimeBackup({ authority: backupAuthority, projectSlug: slug });
    const result = await invalidateAssemblyForAudioChange({
      projectSlug: slug, context: storageContext,
      backupId: backup.backupId, reasonCode: "AUDIO_REPUBLISHED",
    });
    assert.equal(result.invalidated, true);
    assert.ok(result.regenerationId);
    const manifest = JSON.parse(fs.readFileSync(
      path.join(storageContext.projectsRoot, slug, "manifest.json"), "utf8")) as ProjectManifest;
    assert.equal(manifest.packages.assembly.status, "pending");
    assert.equal(manifest.packages.thumbnail.status, "pending");
  });
  pass("invalidateAssemblyForAudioChange, with a real backup, requeues assembly+downstream");

  console.log(`\nPASS (${passCount} scenarios)`);
}

run().catch((error) => {
  console.error("SMOKE_FAILED", error);
  process.exitCode = 1;
});
