import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  RuntimeStorageError,
  acquireProjectWriteAuthority,
  assertPathContained,
  createRuntimeStorageContext,
  ensureSafeContainedDirectory,
  getMachineRuntimeRoot,
  resolveRuntimeStorageConfiguration,
} from "../src/lib/runtime/RuntimeStoragePaths";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import { FileStorage } from "../src/lib/storage/FileStorage";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import { AnimationStorage } from "../src/lib/animation/AnimationStorage";
import { ThumbnailStorage } from "../src/lib/thumbnail/ThumbnailStorage";
import { ProductionReadinessService } from "../src/lib/production/ProductionReadinessService";
import { buildSceneFFmpegArgs } from "../src/lib/video/providers/FFmpegSceneVideoProvider";
import { collectRuntimeTrackingInventory } from "./lib/runtime-tracking-inventory";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";

const repositoryRoot = process.cwd();
const productionSlug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const markerPath = path.join(repositoryRoot, "data", "projects", productionSlug, "production-acceptance.json");
let scenarios = 0;
let providerProcessCalls = 0;

function sha256(filePath: string) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function runtimeDiff() {
  return execFileSync("git", ["diff", "--", "data/projects"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

async function scenario(name: string, run: () => unknown | Promise<unknown>) {
  await run();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

function expectCode(code: RuntimeStorageError["code"], run: () => unknown) {
  assert.throws(run, (error) =>
    error instanceof RuntimeStorageError &&
    error.code === code &&
    error.message.length <= 80 &&
    !/[a-zA-Z]:[\\/]|\/Users\//.test(error.message));
}

function context(
  workspaceRoot: string,
  runtimeRoot: string,
  authorityRoot: string,
) {
  return createRuntimeStorageContext({
    workspaceRoot,
    environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
    authorityRoot,
  });
}

async function main() {
  const beforeMarker = sha256(markerPath);
  const beforeInventory = collectRuntimeTrackingInventory(repositoryRoot);
  const beforeRuntimeDiff = runtimeDiff();
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-12925b1-"));
  const originalCwd = process.cwd();
  const originalRuntimeRoot = process.env.ATOLYE_RUNTIME_ROOT;

  try {
    const workspace = path.join(sandbox, "workspace");
    const authorityRoot = path.join(sandbox, "authority");
    fs.mkdirSync(workspace);

    await scenario("nonexistent external root bootstraps segment by segment", async () => {
      const runtimeRoot = path.join(sandbox, "normal", "nested", "runtime");
      const storage = context(workspace, runtimeRoot, authorityRoot);
      assert.equal(fs.existsSync(runtimeRoot), false);
      await ProjectWriter.writeJSON("normal-project", "project.json", { slug: "normal-project" }, storage);
      assert.equal(fs.existsSync(path.join(runtimeRoot, "projects", "normal-project", "project.json")), true);
    });

    await scenario("junction ancestor fails before any target side effect", async () => {
      const target = path.join(sandbox, "junction-target");
      const link = path.join(sandbox, "junction-parent");
      fs.mkdirSync(target);
      try {
        fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (["EPERM", "EACCES", "ENOTSUP"].includes(code ?? "")) {
          process.stdout.write(`SKIP junction ancestor unsupported (${code})\n`);
          return;
        }
        throw error;
      }
      const runtimeRoot = path.join(link, "must-not-exist");
      await assert.rejects(
        ProjectWriter.writeJSON("blocked", "project.json", { blocked: false }, {
          workspaceRoot: workspace,
          environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
          authorityRoot,
        }),
        (error) => error instanceof RuntimeStorageError && error.code === "RUNTIME_STORAGE_LINK_UNSAFE",
      );
      assert.equal(fs.existsSync(path.join(target, "must-not-exist")), false);
    });

    await scenario("existing linked runtime root remains rejected", () => {
      const target = path.join(sandbox, "direct-target");
      const link = path.join(sandbox, "direct-link");
      fs.mkdirSync(target);
      try {
        fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (["EPERM", "EACCES", "ENOTSUP"].includes(code ?? "")) {
          process.stdout.write(`SKIP direct link unsupported (${code})\n`);
          return;
        }
        throw error;
      }
      expectCode("RUNTIME_STORAGE_LINK_UNSAFE", () => context(workspace, link, authorityRoot));
    });

    await scenario("contained creation accepts ..foo and rejects prefix collision", () => {
      const root = path.join(sandbox, "containment");
      const safe = path.join(root, "..foo", "child");
      ensureSafeContainedDirectory(root, safe);
      assert.equal(fs.existsSync(safe), true);
      assertPathContained(root, safe);
      expectCode("RUNTIME_STORAGE_PATH_INVALID", () =>
        assertPathContained(root, path.join(sandbox, "containment-escape", "child")));
    });

    await scenario("filesystem roots and unsafe host ids are rejected", () => {
      expectCode("RUNTIME_STORAGE_CONFIGURATION_INVALID", () =>
        resolveRuntimeStorageConfiguration({
          workspaceRoot: workspace,
          environment: { ATOLYE_RUNTIME_ROOT: path.parse(workspace).root },
        }));
      const storage = context(workspace, path.join(sandbox, "host-runtime"), authorityRoot);
      for (const host of ["CON", "prn.txt", "AUX", "NUL", "COM1", "COM9", "LPT1", "LPT9", "host:name", "host.", "host ", "../host", "C:\\host"]) {
        expectCode("RUNTIME_STORAGE_PATH_INVALID", () => getMachineRuntimeRoot(host, storage));
      }
      assert.equal(getMachineRuntimeRoot("host-01", storage), path.join(storage.machineRoot, "host-01"));
    });

    await scenario("frozen context survives environment and cwd drift across all adapters", async () => {
      const runtimeRoot = path.join(sandbox, "frozen-runtime");
      const driftRuntime = path.join(sandbox, "drift-runtime");
      const driftWorkspace = path.join(sandbox, "drift-workspace");
      fs.mkdirSync(driftWorkspace);
      const storage = context(workspace, runtimeRoot, authorityRoot);
      assert.equal(Object.isFrozen(storage), true);
      process.env.ATOLYE_RUNTIME_ROOT = driftRuntime;
      process.chdir(driftWorkspace);
      const slug = "frozen-project";
      const operation = createProductionRuntimeOperationContext({
        operationId: "runtime-hardening-frozen-context",
        operationType: "runtime-hardening-test",
        authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext: storage,
      });
      await runWithProductionRuntimeOperationContext(operation, async () => {
        await ProjectWriter.writeJSON(slug, "project.json", { slug }, storage);
        FileStorage.saveJsonAtomically(`data/projects/${slug}/manifest.json`, { stable: true }, storage);
        const image = ImageStorage.saveImage({ projectSlug: slug, assetId: "image", data: png(), mimeType: "image/png" }, storage);
        const audio = AudioStorage.saveAudio({ projectSlug: slug, assetId: "audio", data: wav() }, storage);
        const thumbnail = ThumbnailStorage.saveThumbnail({ projectSlug: slug, assetId: "thumbnail", data: png(), mimeType: "image/png" }, storage);
        const animation = AnimationStorage.saveMotionPlan(slug, motionPlan(), storage);
        const video = VideoStorage.createSceneRenderPaths(slug, 1, storage);
        fs.writeFileSync(video.temporaryAbsolutePath, "temp-video", { flag: "wx" });
        VideoStorage.finalize(video.temporaryAbsolutePath, video.absolutePath, storage);
        assert.equal((await ProjectReader.readJSON<{ slug: string }>(slug, "project.json", storage))?.slug, slug);
        ImageStorage.inspectStoredImage(slug, image.filePath, "image/png", storage);
        AudioStorage.inspectStoredWav(slug, audio.filePath, storage);
        ThumbnailStorage.inspectStoredThumbnail(slug, thumbnail.filePath, "image/png", storage);
        AnimationStorage.inspectStoredMotionPlan(slug, animation.filePath, storage);
        const ffmpegArgs = buildSceneFFmpegArgs({
          sceneId: 1,
          sourceImageAssetId: "image",
          animationAssetId: "motion",
          imageFilePath: image.filePath,
          imageMimeType: "image/png",
          motionPlan: scenePlan(),
        }, video.temporaryAbsolutePath, storage);
        assert.ok(ffmpegArgs.includes(path.join(runtimeRoot, "projects", slug, "assets", "images", "image.png")));
        assert.equal(fs.existsSync(path.join(runtimeRoot, "projects", slug, "assets", "videos", path.basename(video.absolutePath))), true);
        assert.equal(fs.existsSync(driftRuntime), false);
      });
    });

    process.chdir(originalCwd);
    if (originalRuntimeRoot === undefined) delete process.env.ATOLYE_RUNTIME_ROOT;
    else process.env.ATOLYE_RUNTIME_ROOT = originalRuntimeRoot;

    await scenario("listProjects preserves ENOENT empty valid and divergence contracts", async () => {
      const missing = context(workspace, path.join(sandbox, "list-missing"), authorityRoot);
      assert.deepEqual(await ProjectReader.listProjects(missing), []);
      const runtimeRoot = path.join(sandbox, "list-runtime");
      const storage = context(workspace, runtimeRoot, authorityRoot);
      ensureSafeContainedDirectory(storage.runtimeRoot, storage.projectsRoot);
      assert.deepEqual(await ProjectReader.listProjects(storage), []);
      await ProjectWriter.writeJSON("listed", "project.json", { slug: "listed" }, storage);
      assert.deepEqual(await ProjectReader.listProjects(storage), [{ slug: "listed" }]);

      const dualWorkspace = path.join(sandbox, "dual-workspace");
      const dualRuntime = path.join(sandbox, "dual-runtime");
      fs.mkdirSync(path.join(dualWorkspace, "data", "projects", "dual"), { recursive: true });
      fs.mkdirSync(path.join(dualRuntime, "projects", "dual"), { recursive: true });
      fs.writeFileSync(path.join(dualWorkspace, "data", "projects", "dual", "project.json"), "{}");
      fs.writeFileSync(path.join(dualRuntime, "projects", "dual", "project.json"), "{}");
      const dual = context(dualWorkspace, dualRuntime, path.join(sandbox, "dual-authority"));
      await assert.rejects(ProjectReader.listProjects(dual), (error) =>
        error instanceof RuntimeStorageError && error.code === "RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE");
      await assert.rejects(ProjectReader.listProjects({
        workspaceRoot: workspace,
        environment: { ATOLYE_RUNTIME_ROOT: "relative" },
      }), (error) => error instanceof RuntimeStorageError && error.code === "RUNTIME_STORAGE_CONFIGURATION_INVALID");
    });

    await scenario("external writer blocks legacy-only authority before project creation", async () => {
      const localWorkspace = path.join(sandbox, "legacy-conflict-workspace");
      const runtimeRoot = path.join(sandbox, "legacy-conflict-runtime");
      const slug = "legacy-only";
      fs.mkdirSync(path.join(localWorkspace, "data", "projects", slug), { recursive: true });
      const storage = context(localWorkspace, runtimeRoot, path.join(sandbox, "legacy-conflict-authority"));
      await assert.rejects(
        ProjectWriter.writeJSON(slug, "project.json", { slug }, storage),
        (error) => error instanceof RuntimeStorageError && error.code === "RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE",
      );
      assert.equal(fs.existsSync(path.join(runtimeRoot, "projects", slug)), false);
    });

    await scenario("atomic authority lock rejects concurrent writer without project bytes", async () => {
      const runtimeRoot = path.join(sandbox, "lock-runtime");
      const lockAuthority = path.join(sandbox, "lock-authority");
      const storage = context(workspace, runtimeRoot, lockAuthority);
      const slug = "contended";
      const lease = acquireProjectWriteAuthority(slug, storage);
      try {
        const lockDirectory = fs.readdirSync(lockAuthority).find((name) => name.endsWith(".lock"));
        assert.ok(lockDirectory);
        const ownerBytes = fs.readFileSync(path.join(lockAuthority, lockDirectory, "owner.json"), "utf8");
        assert.ok(ownerBytes.length <= 256);
        assert.equal(ownerBytes.includes(sandbox), false);
        await assert.rejects(
          ProjectWriter.writeJSON(slug, "project.json", { loser: true }, storage),
          (error) => error instanceof RuntimeStorageError && error.code === "RUNTIME_STORAGE_AUTHORITY_LOCKED",
        );
        assert.equal(fs.existsSync(path.join(runtimeRoot, "projects", slug)), false);
      } finally {
        lease.release();
      }
      await ProjectWriter.writeJSON(slug, "project.json", { winner: true }, storage);
      assert.deepEqual(await ProjectReader.readJSON(slug, "project.json", storage), { winner: true });
      assert.equal(fs.readdirSync(lockAuthority).some((name) => name.endsWith(".lock")), false);
    });

    await scenario("authority lock releases on error and unknown stale lock fails closed", async () => {
      const runtimeRoot = path.join(sandbox, "release-runtime");
      const lockAuthority = path.join(sandbox, "release-authority");
      const storage = context(workspace, runtimeRoot, lockAuthority);
      await assert.rejects(ProjectWriter.writeJSON("release-test", "bad/name.json", {}, storage));
      const lease = acquireProjectWriteAuthority("release-test", storage);
      const lockName = fs.readdirSync(lockAuthority).find((name) => name.endsWith(".lock"));
      assert.ok(lockName);
      lease.release();
      fs.mkdirSync(path.join(lockAuthority, lockName));
      expectCode("RUNTIME_STORAGE_AUTHORITY_LOCKED", () =>
        acquireProjectWriteAuthority("release-test", storage));
      fs.rmSync(path.join(lockAuthority, lockName), { recursive: true, force: true });
    });

    await scenario("authority claim rejects a different root for the same workspace slug", () => {
      const claimAuthority = path.join(sandbox, "claim-authority");
      const external = context(workspace, path.join(sandbox, "claim-external"), claimAuthority);
      const legacy = createRuntimeStorageContext({
        workspaceRoot: workspace,
        environment: {},
        authorityRoot: claimAuthority,
      });
      const lease = acquireProjectWriteAuthority("claim-project", external);
      lease.release();
      const claimName = fs.readdirSync(claimAuthority).find((name) => name.endsWith(".claim.json"));
      assert.ok(claimName);
      const claimBytes = fs.readFileSync(path.join(claimAuthority, claimName), "utf8");
      assert.ok(claimBytes.length <= 512);
      assert.equal(claimBytes.includes(sandbox), false);
      expectCode("RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE", () =>
        acquireProjectWriteAuthority("claim-project", legacy));
    });

    await scenario("readiness adapters use injected context and cleanup without legacy leakage", async () => {
      const readinessWorkspace = path.join(sandbox, "readiness-workspace");
      const runtimeRoot = path.join(sandbox, "readiness-runtime");
      fs.mkdirSync(readinessWorkspace);
      const storage = context(readinessWorkspace, runtimeRoot, path.join(sandbox, "readiness-authority"));
      ensureSafeContainedDirectory(storage.runtimeRoot, storage.projectsRoot);
      let probeRoot = "";
      const readinessOperation = createProductionRuntimeOperationContext({
        operationId: "runtime-hardening-readiness",
        operationType: "runtime-hardening-test",
        authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext: storage,
      });
      const report = await runWithProductionRuntimeOperationContext(
        readinessOperation,
        () => new ProductionReadinessService({
        cwd: readinessWorkspace,
        environment: { NODE_ENV: "test", ATOLYE_RUNTIME_ROOT: runtimeRoot },
        runtimeStorageContext: storage,
        processRunner: {
          async run() {
            providerProcessCalls += 1;
            return { exitCode: 1, signal: null, stdout: "", timedOut: false, failed: true };
          },
        },
        beforeProbeCleanup(root) {
          probeRoot = root;
          assertPathContained(storage.projectsRoot, root);
          for (const relative of [
            "assets/images/readiness-image.png",
            "assets/audio/readiness-audio.wav",
            "assets/thumbnails/readiness-thumbnail.png",
            "assets/assembly/readiness.json",
          ]) assert.equal(fs.existsSync(path.join(root, relative)), true);
          assert.equal(fs.existsSync(path.join(readinessWorkspace, "data", "projects", path.basename(root))), false);
        },
        }).evaluate(),
      );
      assert.ok(report.checks.length > 0);
      assert.ok(probeRoot);
      assert.equal(
        fs.existsSync(probeRoot),
        false,
        fs.existsSync(probeRoot)
          ? JSON.stringify(fs.readdirSync(probeRoot, { recursive: true }))
          : undefined,
      );
      assert.equal(providerProcessCalls, 0);
    });

    await scenario("inventory helper requires repository top-level", () => {
      assert.throws(
        () => collectRuntimeTrackingInventory(path.join(repositoryRoot, "src")),
        /repository top-level/,
      );
    });
  } finally {
    process.chdir(originalCwd);
    if (originalRuntimeRoot === undefined) delete process.env.ATOLYE_RUNTIME_ROOT;
    else process.env.ATOLYE_RUNTIME_ROOT = originalRuntimeRoot;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  const afterMarker = sha256(markerPath);
  const afterInventory = collectRuntimeTrackingInventory(repositoryRoot);
  assert.equal(afterMarker, beforeMarker);
  assert.deepEqual(afterInventory, beforeInventory);
  assert.equal(runtimeDiff(), beforeRuntimeDiff);
  assert.equal(providerProcessCalls, 0);
  process.stdout.write(
    `Sprint 129.25B.1 runtime hardening smoke: PASS (${scenarios} scenarios; production-provider-worker-spy=${providerProcessCalls})\n`,
  );
}

function png() {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
}

function wav() {
  const samples = 80;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8_000, 24);
  buffer.writeUInt32LE(16_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

function motionPlan() {
  const frame = (scale: number) => ({
    crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    transform: { scale, translateX: 0, translateY: 0 },
  });
  return {
    schemaVersion: "1" as const,
    artifactType: "motion-plan" as const,
    assetId: "motion",
    sceneId: 1,
    sourceImageAssetId: "image",
    durationSeconds: 2,
    provider: "openai" as const,
    model: "test-model",
    generationMode: "production" as const,
    requestIdentity: "a".repeat(64),
    promptDigest: "b".repeat(64),
    motionType: "zoom-in" as const,
    start: frame(1),
    end: frame(1.2),
    transition: "fade" as const,
  };
}

function scenePlan() {
  const frame = (scale: number) => ({
    crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    transform: { scale, translateX: 0, translateY: 0 },
  });
  return {
    sceneId: 1,
    animationPrompt: "motion",
    sourceImageAssetId: "image",
    outputAssetId: "motion",
    animationAssetId: "motion",
    durationSeconds: 2,
    motionType: "zoom-in" as const,
    start: frame(1),
    end: frame(1.2),
    transition: "fade" as const,
    provider: "mock" as const,
    model: "mock-animation-model",
    generationMode: "mock" as const,
    artifactType: "motion-plan" as const,
    status: "generated" as const,
  };
}

void main();
