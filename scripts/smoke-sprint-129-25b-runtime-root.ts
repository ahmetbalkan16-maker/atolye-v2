import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  RuntimeStorageError,
  assertPathContained,
  createRuntimeStorageContext,
  getLogicalProjectIdentity,
  getMachineRuntimeRoot,
  getProjectRoot,
  resolveRuntimeLogicalPath,
  resolveRuntimeStorageConfiguration,
  runtimeStoragePolicyVersion,
} from "../src/lib/runtime/RuntimeStoragePaths";
import { collectRuntimeTrackingInventory } from "./lib/runtime-tracking-inventory";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";

const repositoryRoot = process.cwd();
const markerPath = path.join(
  repositoryRoot,
  "data",
  "projects",
  "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5",
  "production-acceptance.json",
);
const expectedTrackedCount = 184;
let scenarios = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

function expectRuntimeError(code: RuntimeStorageError["code"], run: () => unknown) {
  assert.throws(run, (error) =>
    error instanceof RuntimeStorageError &&
    error.code === code &&
    error.message.length <= 80);
}

function sha256(filePath: string) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function runtimeDiff() {
  return execFileSync("git", ["diff", "--", "data/projects"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

async function main() {
const beforeMarker = sha256(markerPath);
const beforeInventory = collectRuntimeTrackingInventory(repositoryRoot);
const beforeRuntimeDiff = runtimeDiff();
assert.equal(beforeInventory.trackedPaths.length, expectedTrackedCount);
assert.equal(beforeInventory.physicalPaths.length, expectedTrackedCount);
assert.equal(beforeInventory.untrackedPaths.length, 0);
assert.equal(beforeInventory.trackedMissingPaths.length, 0);
assert.equal(beforeRuntimeDiff, "");

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-runtime-root-"));
try {
  const workspace = path.join(sandbox, "workspace");
  const legacyProjects = path.join(workspace, "data", "projects");
  const externalRuntime = path.join(sandbox, "external-runtime");
  const externalProjects = path.join(externalRuntime, "projects");
  fs.mkdirSync(legacyProjects, { recursive: true });
  fs.mkdirSync(externalProjects, { recursive: true });

  await scenario("environment unset preserves exact legacy projects root", () => {
    const configuration = resolveRuntimeStorageConfiguration({
      workspaceRoot: workspace,
      environment: {},
    });
    assert.equal(configuration.projectsRoot, legacyProjects);
    assert.equal(configuration.classification, "legacy-repository");
    assert.equal(configuration.source, "legacy-default");
  });

  await scenario("absolute external root resolves projects root", () => {
    const configuration = resolveRuntimeStorageConfiguration({
      workspaceRoot: workspace,
      environment: { ATOLYE_RUNTIME_ROOT: externalRuntime },
    });
    assert.equal(configuration.projectsRoot, externalProjects);
    assert.equal(configuration.classification, "explicit-external");
  });

  await scenario("relative runtime root is rejected", () => {
    expectRuntimeError("RUNTIME_STORAGE_CONFIGURATION_INVALID", () =>
      resolveRuntimeStorageConfiguration({
        workspaceRoot: workspace,
        environment: { ATOLYE_RUNTIME_ROOT: "relative/runtime" },
      }));
  });

  await scenario("empty and whitespace runtime roots are rejected", () => {
    for (const value of ["", "   ", ` ${externalRuntime}`]) {
      expectRuntimeError("RUNTIME_STORAGE_CONFIGURATION_INVALID", () =>
        resolveRuntimeStorageConfiguration({
          workspaceRoot: workspace,
          environment: { ATOLYE_RUNTIME_ROOT: value },
        }));
    }
  });

  await scenario("valid slug resolves below configured root", () => {
    const root = getProjectRoot("project-1", {
      workspaceRoot: workspace,
      environment: { ATOLYE_RUNTIME_ROOT: externalRuntime },
    });
    assert.equal(root, path.join(externalProjects, "project-1"));
    assertPathContained(externalProjects, root);
  });

  await scenario("traversal absolute injection and root escape are rejected", () => {
    for (const slug of ["../escape", "..", path.resolve(sandbox, "escape")]) {
      expectRuntimeError("RUNTIME_STORAGE_PATH_INVALID", () =>
        getProjectRoot(slug, { workspaceRoot: workspace, environment: {} }));
    }
    expectRuntimeError("RUNTIME_STORAGE_PATH_INVALID", () =>
      assertPathContained(externalProjects, path.join(externalProjects, "..", "escape")));
  });

  await scenario("explicit legacy-equivalent root has no false divergence", () => {
    fs.mkdirSync(path.join(legacyProjects, "legacy-project"));
    const options = {
      workspaceRoot: workspace,
      environment: { ATOLYE_RUNTIME_ROOT: path.join(workspace, "data") },
    };
    assert.equal(
      resolveRuntimeStorageConfiguration(options).classification,
      "explicit-legacy",
    );
    assert.equal(getProjectRoot("legacy-project", options), path.join(legacyProjects, "legacy-project"));
  });

  await scenario("same slug in legacy and external roots fails closed", () => {
    const slug = "dual-project";
    const legacy = path.join(legacyProjects, slug);
    const external = path.join(externalProjects, slug);
    fs.mkdirSync(legacy);
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(legacy, "project.json"), "same-bytes");
    fs.writeFileSync(path.join(external, "project.json"), "same-bytes");
    expectRuntimeError("RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE", () =>
      getProjectRoot(slug, {
        workspaceRoot: workspace,
        environment: { ATOLYE_RUNTIME_ROOT: externalRuntime },
      }));
  });

  await scenario("legacy-only project remains compatible without opt-in", () => {
    assert.equal(
      getProjectRoot("legacy-project", { workspaceRoot: workspace, environment: {} }),
      path.join(legacyProjects, "legacy-project"),
    );
  });

  await scenario("external-only project uses configured root", () => {
    const slug = "external-project";
    fs.mkdirSync(path.join(externalProjects, slug));
    assert.equal(
      getProjectRoot(slug, {
        workspaceRoot: workspace,
        environment: { ATOLYE_RUNTIME_ROOT: externalRuntime },
      }),
      path.join(externalProjects, slug),
    );
  });

  await scenario("logical metadata path maps to configured physical root", () => {
    assert.equal(
      resolveRuntimeLogicalPath("data/projects/external-project/assets/images/image.png", {
        workspaceRoot: workspace,
        environment: { ATOLYE_RUNTIME_ROOT: externalRuntime },
      }),
      path.join(externalProjects, "external-project", "assets", "images", "image.png"),
    );
  });

  await scenario("storage policy identity excludes absolute host path", () => {
    assert.equal(runtimeStoragePolicyVersion, "runtime-storage-v1");
    assert.equal(getLogicalProjectIdentity("external-project"), "projects/external-project");
    assert.ok(!getLogicalProjectIdentity("external-project").includes(sandbox));
    assert.equal(
      getMachineRuntimeRoot("host-1", {
        workspaceRoot: workspace,
        environment: { ATOLYE_RUNTIME_ROOT: externalRuntime },
      }),
      path.join(externalRuntime, "machine", "host-1"),
    );
  });

  await scenario("fixture tree is not modified by runtime resolution", () => {
    const fixture = path.join(workspace, "fixtures", "project.json");
    fs.mkdirSync(path.dirname(fixture), { recursive: true });
    fs.writeFileSync(fixture, "fixture-byte-contract");
    const before = sha256(fixture);
    resolveRuntimeStorageConfiguration({ workspaceRoot: workspace, environment: {} });
    resolveRuntimeStorageConfiguration({
      workspaceRoot: workspace,
      environment: { ATOLYE_RUNTIME_ROOT: externalRuntime },
    });
    assert.equal(sha256(fixture), before);
  });

  await scenario("project and asset entrypoints use external physical storage", async () => {
    const slug = `runtime-root-integration-${process.pid}`;
    const context = createRuntimeStorageContext({
      workspaceRoot: repositoryRoot,
      environment: { ATOLYE_RUNTIME_ROOT: externalRuntime },
      authorityRoot: path.join(sandbox, "integration-authority"),
    });
    await ProjectWriter.writeJSON(slug, "project.json", { id: "project-1", slug }, context);
      const projectRoot = path.join(externalProjects, slug);
      assert.equal(ProjectReader.getProjectFolder(slug, context), projectRoot);
      assert.ok(fs.existsSync(path.join(projectRoot, "project.json")));
      assert.ok(!fs.existsSync(path.join(repositoryRoot, "data", "projects", slug)));

      AssetManager.saveProjectAssets(
        slug,
        AssetManager.createDefaultAssets("project-1", slug),
        context,
      );
      assert.ok(fs.existsSync(path.join(projectRoot, "assets", "assets.json")));

      const image = ImageStorage.saveImage({
        projectSlug: slug,
        assetId: "image-1",
        data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        mimeType: "image/png",
      }, context);
      assert.equal(image.filePath, `data/projects/${slug}/assets/images/image-1.png`);
      assert.equal(
        ImageStorage.inspectStoredImage(slug, image.filePath, "image/png", context).byteLength,
        8,
      );
      const video = VideoStorage.createSceneRenderPaths(slug, 1, context);
      assert.ok(video.absolutePath.startsWith(path.join(projectRoot, "assets", "videos")));
  });

  await scenario("existing symlink runtime root is rejected when supported", () => {
    const target = path.join(sandbox, "symlink-target");
    const link = path.join(sandbox, "symlink-runtime");
    fs.mkdirSync(target);
    try {
      fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
      expectRuntimeError("RUNTIME_STORAGE_LINK_UNSAFE", () =>
        resolveRuntimeStorageConfiguration({
          workspaceRoot: workspace,
          environment: { ATOLYE_RUNTIME_ROOT: link },
        }));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "ENOTSUP") throw error;
      process.stdout.write(`SKIP symlink runtime root unsupported (${code})\n`);
    }
  });

  await scenario("runtime abstraction has zero production wiring", () => {
    const source = fs.readFileSync(
      path.join(repositoryRoot, "src", "lib", "runtime", "RuntimeStoragePaths.ts"),
      "utf8",
    );
    assert.doesNotMatch(source, /Orchestrator|Provider|Worker|execute\(|resume\(|finalize\(|dispatch\(/);
    assert.deepEqual(productionBoundaryViolations(), []);
  });
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

const afterMarker = sha256(markerPath);
const afterInventory = collectRuntimeTrackingInventory(repositoryRoot);
assert.equal(afterMarker, beforeMarker);
assert.deepEqual(afterInventory, beforeInventory);
assert.equal(runtimeDiff(), beforeRuntimeDiff);

process.stdout.write(
  `Sprint 129.25B runtime root smoke: PASS (${scenarios} scenarios; tracked=${afterInventory.trackedPaths.length}; untracked=${afterInventory.untrackedPaths.length}; production-boundary-violations=${productionBoundaryViolations().length})\n`,
);
}

function productionBoundaryViolations() {
  const source = fs.readFileSync(import.meta.filename, "utf8");
  const imports = source.split(/\r?\n/).filter((line) => /^import\b/.test(line.trim()));
  return [
    "ProductionAcceptanceOrchestrator",
    "PipelineRunner",
    "ProductionExecutionWorkerExecutionService",
    "OpenAIImageProvider",
    "OpenAIAudioProvider",
  ].filter((boundary) => imports.some((line) => line.includes(boundary)));
}

void main();
