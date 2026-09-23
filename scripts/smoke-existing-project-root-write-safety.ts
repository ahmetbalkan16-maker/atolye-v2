/**
 * Existing-project root write-safety smoke (system write-path safety sprint).
 *
 * Deterministic / $0 / no network / TEMP-only: every scenario gets its own
 * sandbox workspace (whose `data/projects` is the legacy quarantine root),
 * runtime root and authority root. No live runtime is read or written.
 *
 * Before this sprint the asset storages, `FileStorage` and the production
 * authority stores turned `data/projects/<slug>/…` (or `getProjectRoot(slug)`)
 * into `<projectsRoot>/<slug>/…` literally, while reads of the same project
 * resolve a post-cutover folder (named by project id) through
 * `ProjectFolderIndex`. A legacy / migrated project reaching the visuals+ stages
 * therefore grew a partial `<slug>/` tree that then shadowed the real project
 * (`getProject(slug)` → null, or — with the in-repo quarantine present — every
 * read of the slug failing `RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE`).
 *
 * Every scenario runs even if an earlier one fails; the summary lists each
 * failure, and PASS is printed only when none failed.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AssetManager } from "../src/lib/assets/AssetManager";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import {
  buildProductionOrphanReservationToleranceAuthorityBody,
  findMatchingOrphanReservationToleranceAuthority,
  writeProductionOrphanReservationToleranceAuthority,
} from "../src/lib/production/ProductionOrphanReservationToleranceAuthority";
import { getRetryBudgetExtensionDirectory } from "../src/lib/production/ProductionPipelineRetryBudgetExtensionStore";
import { clearProjectFolderIndexCache } from "../src/lib/projects/ProjectFolderIndex";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { ProjectAlreadyExistsError, ProjectWriter } from "../src/lib/projects/ProjectWriter";
import {
  acquireExistingProjectWriteAuthority,
  acquireProjectWriteAuthority,
  assertProjectWriteAuthorityLease,
  getExistingProjectRoot,
  getProjectRoot,
  resolveRuntimeLogicalPath,
  RuntimeStorageError,
} from "../src/lib/runtime/RuntimeStoragePaths";
import { FileStorage } from "../src/lib/storage/FileStorage";
import type { Project } from "../src/types/project";

const failures: string[] = [];
let count = 0;
async function scenario(name: string, fn: () => Promise<void> | void) {
  count += 1;
  try {
    await fn();
    if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
  } catch (error) {
    failures.push(`FAIL ${count}: ${name} — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

const envKeys = ["ATOLYE_WORKSPACE_ROOT", "ATOLYE_RUNTIME_ROOT", "ATOLYE_RUNTIME_AUTHORITY_ROOT"] as const;
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const sandboxes: string[] = [];

// Legacy record: folder = UUID, project.json id == slug.
const L_UUID = "8e2a1371-0000-4000-8000-00000000abcd";
const L_SLUG = "legacy-hunlar";
// Migrated record: folder = UUID = id, project.json slug = human slug.
const M_UUID = "6813e662-0000-4000-8000-00000000beef";
const M_SLUG = "istanbul-topic";
// Standard record: folder = slug, id = UUID.
const S_ID = "3f0c9a6e-0000-4000-8000-00000000cafe";
const S_SLUG = "slug-folder-topic";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

type Sandbox = { workspace: string; projectsRoot: string; quarantineRoot: string; authorityRoot: string };

function sandbox(): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eprws-"));
  sandboxes.push(root);
  const workspace = path.join(root, "workspace");
  const runtimeRoot = path.join(root, "runtime");
  const authorityRoot = path.join(root, "authority");
  const projectsRoot = path.join(runtimeRoot, "projects");
  const quarantineRoot = path.join(workspace, "data", "projects");
  fs.mkdirSync(projectsRoot, { recursive: true });
  fs.mkdirSync(quarantineRoot, { recursive: true });
  fs.mkdirSync(authorityRoot, { recursive: true });
  process.env.ATOLYE_WORKSPACE_ROOT = workspace;
  process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
  process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = authorityRoot;
  clearProjectFolderIndexCache();
  return { workspace, projectsRoot, quarantineRoot, authorityRoot };
}

function seed(sb: Sandbox, folder: string, id: string, slug: string) {
  const dir = path.join(sb.projectsRoot, folder);
  fs.mkdirSync(dir);
  const project = {
    id, slug, title: slug, status: "visuals",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    project, projectId: id, slug, version: 1, packages: {},
    createdAt: project.createdAt, updatedAt: project.updatedAt,
  }));
  clearProjectFolderIndexCache();
  return dir;
}

const seedLegacy = (sb: Sandbox) => seed(sb, L_UUID, L_SLUG, L_SLUG);
const seedMigrated = (sb: Sandbox) => seed(sb, M_UUID, M_UUID, M_SLUG);
const seedStandard = (sb: Sandbox) => seed(sb, S_SLUG, S_ID, S_SLUG);

function folders(sb: Sandbox) {
  return fs.readdirSync(sb.projectsRoot).sort();
}

function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        out[`${next}/`] = "";
        walk(next);
      } else {
        out[next] = fs.readFileSync(path.join(dir, next)).toString("base64");
      }
    }
  };
  walk("");
  return out;
}

function orphanBody(slug: string, authorityId = "tolerance-1") {
  return buildProductionOrphanReservationToleranceAuthorityBody({
    schemaVersion: "1", policyVersion: "orphan-reservation-tolerance-v1", authorityId,
    issuedAt: "2026-01-01T00:00:00.000Z", projectSlug: slug, stage: "visuals",
    jobId: `${slug}-visuals`, reservationId: "reservation-1", operation: "visuals.generate",
    attempt: 1, reason: "smoke", reservationContentFingerprint: "fingerprint",
  });
}

function isStorageError(code: string) {
  return (error: unknown) => error instanceof RuntimeStorageError && error.code === code;
}

/** Every existing-project writer this suite covers, addressed by `slug`. */
function writers(slug: string): Array<[string, () => unknown]> {
  return [
    ["image", () => ImageStorage.saveImage({ projectSlug: slug, data: PNG, assetId: "scene-1", mimeType: "image/png" })],
    ["video paths", () => VideoStorage.createSceneRenderPaths(slug, 1)],
    ["FileStorage", () => FileStorage.saveJsonAtomically(`data/projects/${slug}/assets/assembly/readiness.json`, { ready: 1 })],
    ["assets.json", () => AssetManager.saveProjectAssets(slug, AssetManager.createDefaultAssets(slug, slug))],
    ["orphan-tolerance authority", () => {
      const result = writeProductionOrphanReservationToleranceAuthority(slug, orphanBody(slug));
      if (!result.ok) throw new Error(result.reasonCode);
      return result;
    }],
    ["ProjectWriter", () => ProjectWriter.writeJSON(slug, "research.json", { r: 1 })],
  ];
}

/** Runs every writer by `slug` and asserts all landed in `expectedFolder`. */
async function assertWritersLandIn(sb: Sandbox, slug: string, expectedFolder: string) {
  const before = folders(sb);
  for (const [, write] of writers(slug)) await write();
  assert.deepEqual(folders(sb), before, "no second project root");
  const dir = path.join(sb.projectsRoot, expectedFolder);
  for (const file of [
    "assets/images/scene-1.png",
    "assets/assembly/readiness.json",
    "assets/assets.json",
    "production-execution/orphan-reservation-tolerances/tolerance-tolerance-1.json",
    "research.json",
  ]) {
    assert.ok(fs.existsSync(path.join(dir, file)), `${file} in ${expectedFolder}/`);
  }
  assert.ok(fs.statSync(path.join(dir, "assets", "videos")).isDirectory(), "video dir in the project root");
}

async function run() {
  // 1 ---------------------------------------------------------------
  await scenario("standard new project: writers stay in <slug>/ whether addressed by slug or by id", async () => {
    const sb = sandbox();
    const project = await ProjectManager.createProject("Brand New Topic");
    await assertWritersLandIn(sb, project.slug, project.slug);
    clearProjectFolderIndexCache();
    const byId = ImageStorage.saveImage({ projectSlug: project.id, data: PNG, assetId: "by-id", mimeType: "image/png" });
    assert.deepEqual(folders(sb), ["brand-new-topic"], "an id-addressed write does not open <id>/");
    assert.ok(fs.existsSync(path.join(sb.projectsRoot, "brand-new-topic", "assets", "images", "by-id.png")));
    assert.deepEqual(ImageStorage.readImage(project.id, byId.fileName).data, PNG);
    assert.deepEqual(ImageStorage.readImage(project.slug, byId.fileName).data, PNG);
  });

  // 2 ---------------------------------------------------------------
  await scenario("standard existing slug-folder project: writes unchanged", async () => {
    const sb = sandbox();
    seedStandard(sb);
    await assertWritersLandIn(sb, S_SLUG, S_SLUG);
    assert.equal((await ProjectManager.getProject(S_SLUG))?.id, S_ID);
  });

  // 3 ---------------------------------------------------------------
  await scenario("legacy UUID folder (id == slug), no quarantine: every writer lands in the UUID folder", async () => {
    const sb = sandbox();
    seedLegacy(sb);
    assert.equal(fs.existsSync(path.join(sb.quarantineRoot, L_SLUG)), false);
    await assertWritersLandIn(sb, L_SLUG, L_UUID);
    assert.equal(fs.existsSync(path.join(sb.projectsRoot, L_SLUG)), false, "no partial <slug>/ tree");
    clearProjectFolderIndexCache();
    assert.equal((await ProjectManager.getProject(L_SLUG))?.id, L_SLUG, "project still visible by slug");
  });

  // 4 ---------------------------------------------------------------
  await scenario("migrated UUID folder (id = uuid, slug = human), no quarantine: every writer lands in the UUID folder", async () => {
    const sb = sandbox();
    seedMigrated(sb);
    await assertWritersLandIn(sb, M_SLUG, M_UUID);
    clearProjectFolderIndexCache();
    assert.equal((await ProjectManager.getProject(M_SLUG))?.id, M_UUID);
    assert.equal((await ProjectManager.getProject(M_UUID))?.slug, M_SLUG);
  });

  // 5 ---------------------------------------------------------------
  await scenario("canonical read after write: every logical path reads back the bytes it wrote", async () => {
    const sb = sandbox();
    seedLegacy(sb);
    const image = ImageStorage.saveImage({ projectSlug: L_SLUG, data: PNG, assetId: "scene-2", mimeType: "image/png" });
    assert.deepEqual(ImageStorage.readImage(L_SLUG, image.fileName).data, PNG);
    assert.equal(ImageStorage.inspectStoredImage(L_SLUG, image.filePath, "image/png").byteLength, PNG.length);
    assert.equal(
      resolveRuntimeLogicalPath(image.filePath),
      path.join(sb.projectsRoot, L_UUID, "assets", "images", image.fileName),
    );
    FileStorage.saveJsonAtomically(`data/projects/${L_SLUG}/assets/assembly/readiness.json`, { ready: true });
    assert.deepEqual(FileStorage.loadJson(`data/projects/${L_SLUG}/assets/assembly/readiness.json`), { ready: true });
    assert.equal(FileStorage.exists(`data/projects/${L_SLUG}/assets/assembly/readiness.json`), true);
    AssetManager.saveProjectAssets(L_SLUG, { ...AssetManager.createDefaultAssets(L_SLUG, L_SLUG), assets: [] });
    assert.equal(AssetManager.getProjectAssets(L_SLUG, L_SLUG).projectSlug, L_SLUG);
    // Video: temp + finalize + remove all stay inside the UUID folder.
    const paths = VideoStorage.createSceneRenderPaths(L_SLUG, 7);
    fs.writeFileSync(paths.temporaryAbsolutePath, Buffer.from("mp4-bytes"));
    VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath);
    assert.equal(resolveRuntimeLogicalPath(paths.filePath), paths.absolutePath);
    assert.ok(paths.absolutePath.startsWith(path.join(sb.projectsRoot, L_UUID) + path.sep));
    assert.ok(fs.existsSync(paths.absolutePath));
    VideoStorage.removeIfExists(paths.absolutePath);
    assert.equal(fs.existsSync(paths.absolutePath), false);
    // Later-stage production authority: written by slug, found by slug.
    assert.equal(writeProductionOrphanReservationToleranceAuthority(L_SLUG, orphanBody(L_SLUG)).status, "created");
    const found = findMatchingOrphanReservationToleranceAuthority(
      L_SLUG, "visuals", `${L_SLUG}-visuals`, "reservation-1", "visuals.generate", 1);
    assert.equal(found?.authorityId, "tolerance-1");
    assert.deepEqual(folders(sb), [L_UUID]);
  });

  // 6 ---------------------------------------------------------------
  await scenario("research / script / scenes / visuals / manifest writes land in the UUID folder", async () => {
    const sb = sandbox();
    const dir = seedMigrated(sb);
    await ProjectManager.saveResearch(M_SLUG, { topic: "research" });
    await ProjectManager.saveScript(M_SLUG, { script: "text" });
    await ProjectManager.saveScenes(M_SLUG, { scenes: [{ id: 1 }] });
    await ProjectManager.saveVisuals(M_SLUG, { visuals: [{ sceneId: 1 }] });
    await ProjectManager.updatePackageStatus(M_SLUG, "visuals", "completed");
    assert.deepEqual(folders(sb), [M_UUID]);
    for (const file of ["research.json", "script.json", "scenes.json", "visuals.json"]) {
      assert.ok(fs.existsSync(path.join(dir, file)), file);
    }
    assert.deepEqual(await ProjectManager.getScenes(M_SLUG), { scenes: [{ id: 1 }] });
    assert.equal((await ProjectManager.getManifest(M_SLUG))?.packages.visuals.status, "completed");
  });

  // 7 ---------------------------------------------------------------
  await scenario("quarantine present: every writer fails closed DUAL_ROOT_DIVERGENCE, nothing created, project readable", async () => {
    const sb = sandbox();
    const dir = seedLegacy(sb);
    fs.mkdirSync(path.join(sb.quarantineRoot, L_SLUG));
    const before = tree(dir);
    for (const [name, write] of writers(L_SLUG)) {
      await assert.rejects(async () => { await write(); }, isStorageError("RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE"), name);
    }
    assert.deepEqual(folders(sb), [L_UUID], "no partial <slug>/ tree");
    assert.deepEqual(tree(dir), before, "UUID folder byte-identical");
    clearProjectFolderIndexCache();
    assert.equal((await ProjectManager.getProject(L_SLUG))?.id, L_SLUG, "reads by slug still work");
  });

  // 8 ---------------------------------------------------------------
  await scenario("quarantine absent vs present on the same record: only the quarantine changes the outcome", async () => {
    const sb = sandbox();
    seedMigrated(sb);
    ImageStorage.saveImage({ projectSlug: M_SLUG, data: PNG, assetId: "before-quarantine", mimeType: "image/png" });
    fs.mkdirSync(path.join(sb.quarantineRoot, M_SLUG));
    assert.throws(
      () => ImageStorage.saveImage({ projectSlug: M_SLUG, data: PNG, assetId: "after-quarantine", mimeType: "image/png" }),
      isStorageError("RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE"),
    );
    fs.rmdirSync(path.join(sb.quarantineRoot, M_SLUG));
    ImageStorage.saveImage({ projectSlug: M_SLUG, data: PNG, assetId: "after-removal", mimeType: "image/png" });
    assert.deepEqual(
      fs.readdirSync(path.join(sb.projectsRoot, M_UUID, "assets", "images")).sort(),
      ["after-removal.png", "before-quarantine.png"],
    );
    assert.deepEqual(folders(sb), [M_UUID]);
  });

  // 9 ---------------------------------------------------------------
  await scenario("repeated writes stay in one root; list/get unique after writes", async () => {
    const sb = sandbox();
    seedLegacy(sb);
    seedMigrated(sb);
    seedStandard(sb);
    for (let round = 0; round < 2; round += 1) {
      for (const slug of [L_SLUG, M_SLUG, S_SLUG]) {
        ImageStorage.saveImage({ projectSlug: slug, data: PNG, assetId: `scene-${round}`, mimeType: "image/png" });
        FileStorage.saveJsonAtomically(`data/projects/${slug}/assets/assembly/readiness.json`, { round });
        await ProjectManager.updatePackageStatus(slug, "visuals", "completed");
        const orphan = writeProductionOrphanReservationToleranceAuthority(slug, orphanBody(slug));
        assert.equal(orphan.status, round === 0 ? "created" : "replayed");
      }
    }
    assert.deepEqual(folders(sb), [L_UUID, M_UUID, S_SLUG].sort(), "no second project root");
    clearProjectFolderIndexCache();
    const listed = (await ProjectReader.listProjects()) as Project[];
    const ids = listed.map((project) => project.id);
    assert.equal(new Set(ids).size, ids.length, "no duplicate ids");
    assert.deepEqual(ids.sort(), [L_SLUG, M_UUID, S_ID].sort());
    for (const slug of [L_SLUG, M_SLUG, S_SLUG]) {
      assert.equal((await ProjectManager.getProject(slug))?.slug, slug);
      assert.deepEqual(FileStorage.loadJson(`data/projects/${slug}/assets/assembly/readiness.json`), { round: 1 });
    }
  });

  // 10 --------------------------------------------------------------
  await scenario("stale partial <slug>/ tree beside the owning folder: writes fail closed, nothing added", async () => {
    const sb = sandbox();
    const dir = seedLegacy(sb);
    const partial = path.join(sb.projectsRoot, L_SLUG);
    fs.mkdirSync(path.join(partial, "assets", "images"), { recursive: true });
    fs.writeFileSync(path.join(partial, "assets", "images", "old.png"), PNG);
    const beforeUuid = tree(dir);
    const beforePartial = tree(partial);
    for (const [name, write] of writers(L_SLUG)) {
      await assert.rejects(async () => { await write(); }, isStorageError("RUNTIME_STORAGE_PROJECT_ROOT_AMBIGUOUS"), name);
    }
    assert.deepEqual(tree(dir), beforeUuid, "owning folder untouched");
    assert.deepEqual(tree(partial), beforePartial, "partial tree not deepened");
  });

  // 11 --------------------------------------------------------------
  await scenario("several folders own one identifier: writes fail closed instead of picking one", async () => {
    const sb = sandbox();
    seed(sb, "aaaa1111-0000-4000-8000-000000000001", "shared-name", "other-slug");
    seed(sb, "bbbb2222-0000-4000-8000-000000000002", "bbbb2222-0000-4000-8000-000000000002", "shared-name");
    const before = folders(sb);
    assert.throws(
      () => ImageStorage.saveImage({ projectSlug: "shared-name", data: PNG, assetId: "x", mimeType: "image/png" }),
      isStorageError("RUNTIME_STORAGE_PROJECT_ROOT_AMBIGUOUS"),
    );
    await assert.rejects(
      () => ProjectWriter.writeJSON("shared-name", "research.json", {}),
      isStorageError("RUNTIME_STORAGE_PROJECT_ROOT_AMBIGUOUS"),
    );
    assert.deepEqual(folders(sb), before);
  });

  // 12 --------------------------------------------------------------
  await scenario("a direct <slug>/ project and another folder claiming the same identity fail closed", async () => {
    const sb = sandbox();
    const direct = seedStandard(sb);
    const other = seed(sb, "dddd4444-0000-4000-8000-000000000004", S_SLUG, "other-topic");
    const beforeDirect = tree(direct);
    const beforeOther = tree(other);
    assert.throws(
      () => ImageStorage.saveImage({ projectSlug: S_SLUG, data: PNG, assetId: "duplicate", mimeType: "image/png" }),
      isStorageError("RUNTIME_STORAGE_PROJECT_ROOT_AMBIGUOUS"),
    );
    await assert.rejects(
      () => ProjectWriter.writeJSON(S_SLUG, "research.json", {}),
      isStorageError("RUNTIME_STORAGE_PROJECT_ROOT_AMBIGUOUS"),
    );
    assert.deepEqual(tree(direct), beforeDirect);
    assert.deepEqual(tree(other), beforeOther);
  });

  // 13 --------------------------------------------------------------
  await scenario("stale folder-index cache: an in-place project.json retarget is picked up and reads follow", async () => {
    const sb = sandbox();
    const dir = seedMigrated(sb);
    assert.equal((await ProjectManager.getProject(M_SLUG))?.id, M_UUID, "cache built");
    const record = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf-8"));
    fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ ...record, slug: "renamed-topic" }));
    ImageStorage.saveImage({ projectSlug: "renamed-topic", data: PNG, assetId: "renamed", mimeType: "image/png" });
    assert.deepEqual(folders(sb), [M_UUID], "no <renamed-topic>/ tree");
    assert.ok(fs.existsSync(path.join(dir, "assets", "images", "renamed.png")));
    assert.equal((await ProjectManager.getProject("renamed-topic"))?.id, M_UUID, "read path agrees with the write");
  });

  // 13 --------------------------------------------------------------
  await scenario("an alias write holds the alias lease and the physical-folder lease", async () => {
    const sb = sandbox();
    const dir = seedLegacy(sb);
    for (const identity of [L_SLUG, L_UUID]) {
      const external = acquireProjectWriteAuthority(identity);
      try {
        assert.throws(
          () => ImageStorage.saveImage({ projectSlug: L_SLUG, data: PNG, assetId: identity, mimeType: "image/png" }),
          isStorageError("RUNTIME_STORAGE_AUTHORITY_LOCKED"), `image vs ${identity}`,
        );
        assert.throws(
          () => FileStorage.saveJsonAtomically(`data/projects/${L_SLUG}/assets/lock.json`, {}),
          isStorageError("RUNTIME_STORAGE_AUTHORITY_LOCKED"), `FileStorage vs ${identity}`,
        );
      } finally {
        external.release();
      }
    }
    assert.equal(fs.existsSync(path.join(dir, "assets")), false, "nothing written while locked");
    ImageStorage.saveImage({ projectSlug: L_SLUG, data: PNG, assetId: "after", mimeType: "image/png" });
    assert.deepEqual(folders(sb), [L_UUID]);
    // Both leases were released.
    acquireProjectWriteAuthority(L_SLUG).release();
    acquireProjectWriteAuthority(L_UUID).release();

    const lease = acquireExistingProjectWriteAuthority(L_SLUG);
    try {
      assert.equal(lease.projectFolder, L_UUID);
      assert.equal(lease.projectSlug, L_SLUG);
      assertProjectWriteAuthorityLease(lease, L_SLUG);
    } finally {
      lease.release();
    }
    assert.equal(fs.readdirSync(sb.authorityRoot).filter((name) => name.endsWith(".lock")).length, 0);
  });

  // 14 --------------------------------------------------------------
  await scenario("a lease whose physical-folder half was lost no longer authorizes writes", async () => {
    const sb = sandbox();
    seedLegacy(sb);
    const locks = () => new Set(fs.readdirSync(sb.authorityRoot).filter((name) => name.endsWith(".lock")));
    const alias = acquireProjectWriteAuthority(L_SLUG);
    const aliasLock = [...locks()][0];
    alias.release();
    const lease = acquireExistingProjectWriteAuthority(L_SLUG);
    const companionLock = [...locks()].find((name) => name !== aliasLock);
    assert.ok(companionLock, "folder lock held");
    fs.rmSync(path.join(sb.authorityRoot, companionLock, "owner.json"));
    assert.throws(() => assertProjectWriteAuthorityLease(lease, L_SLUG),
      isStorageError("RUNTIME_STORAGE_AUTHORITY_CLAIM_INVALID"));
    lease.release();
  });

  // 15 --------------------------------------------------------------
  await scenario("new-project creation stays literal and separate from existing-project resolution", async () => {
    const sb = sandbox();
    seedMigrated(sb);
    const created = await ProjectManager.createProject("Fresh Topic");
    assert.deepEqual(folders(sb), [M_UUID, "fresh-topic"].sort());
    assert.equal(path.basename(getExistingProjectRoot(created.slug)), "fresh-topic");
    await assert.rejects(() => ProjectManager.createProject("Istanbul Topic"),
      (error) => error instanceof ProjectAlreadyExistsError);
    // getProjectRoot is the literal-segment primitive (used by creation); only
    // the existing-project resolver maps the alias.
    assert.equal(getProjectRoot(M_SLUG), path.join(sb.projectsRoot, M_SLUG));
    assert.equal(getExistingProjectRoot(M_SLUG), path.join(sb.projectsRoot, M_UUID));
    assert.equal(ProjectReader.getProjectFolder(M_SLUG), getExistingProjectRoot(M_SLUG));
    assert.deepEqual(folders(sb), [M_UUID, "fresh-topic"].sort());
  });

  // 16 --------------------------------------------------------------
  await scenario("direct folder addressing unchanged; unowned identifiers keep the literal behaviour", async () => {
    const sb = sandbox();
    seedLegacy(sb);
    await assertWritersLandIn(sb, L_UUID, L_UUID);
    FileStorage.saveJsonAtomically("data/projects/unknown-ledger/ai-usage.json", { records: [] });
    assert.deepEqual(folders(sb), [L_UUID, "unknown-ledger"]);
    assert.throws(() => FileStorage.saveJsonAtomically("data/projects/../escape/x.json", {}),
      isStorageError("RUNTIME_STORAGE_PATH_INVALID"));
    assert.throws(
      () => ImageStorage.saveImage({ projectSlug: "..", data: PNG, assetId: "x", mimeType: "image/png" }),
      isStorageError("RUNTIME_STORAGE_PATH_INVALID"),
    );
  });

  // 17 --------------------------------------------------------------
  await scenario("later-stage production roots agree: retry-extension read == write == canonical", () => {
    const sb = sandbox();
    seedMigrated(sb);
    const canonical = path.join(sb.projectsRoot, M_UUID);
    const expected = path.join(canonical, "production-execution", "retry-budget-extensions");
    assert.equal(getRetryBudgetExtensionDirectory(M_SLUG), expected);
    assert.equal(getRetryBudgetExtensionDirectory(M_SLUG, {}, true), expected);
    assert.equal(
      resolveRuntimeLogicalPath(`data/projects/${M_SLUG}/production-execution`),
      path.join(canonical, "production-execution"),
    );
    assert.deepEqual(folders(sb), [M_UUID]);
  });

  // 18 --------------------------------------------------------------
  await scenario("/api/research: a slug owned by another folder → 409 before the paid research call", async () => {
    const sb = sandbox();
    const dir = seedMigrated(sb);
    const before = tree(dir);
    const { AIManager } = await import("../src/lib/ai/AIManager");
    const { POST } = await import("../app/api/research/route");
    const realRunResearch = AIManager.runResearch;
    let researchCalls = 0;
    AIManager.runResearch = async (...args: Parameters<typeof realRunResearch>) => {
      researchCalls += 1;
      return realRunResearch.apply(AIManager, args);
    };
    try {
      const response = await POST(new Request("http://local/api/research", {
        method: "POST",
        body: JSON.stringify({ topic: "Istanbul Topic" }),
      }));
      assert.equal(response.status, 409);
      const body = await response.json() as { success: boolean; code?: string };
      assert.equal(body.success, false);
      assert.equal(body.code, "PROJECT_ALREADY_EXISTS");
    } finally {
      AIManager.runResearch = realRunResearch;
    }
    assert.equal(researchCalls, 0, "no provider call before a known conflict");
    assert.deepEqual(folders(sb), [M_UUID]);
    assert.deepEqual(tree(dir), before);
  });

  // 19 --------------------------------------------------------------
  await scenario("/api/pipeline: a slug owned by another folder → 409 pointing at that project", async () => {
    const sb = sandbox();
    const dir = seedMigrated(sb);
    const before = tree(dir);
    const { POST } = await import("../app/api/pipeline/route");
    const { PipelineRunner } = await import("../src/lib/pipeline/PipelineRunner");
    // `run` needs the boot-time production runtime context; its first step
    // (PipelineRunner.runOnce) is the real `createProject`, reproduced here — as in
    // smoke-pipeline-start-recovery — so the route sees the genuine conflict.
    const runner = PipelineRunner as unknown as { run: (topic: string) => Promise<unknown> };
    const realRun = runner.run;
    let stagesReached = false;
    runner.run = async (topic: string) => {
      await ProjectManager.createProject(topic);
      stagesReached = true;
      throw new Error("stages must not run after a creation conflict");
    };
    let response: Response;
    try {
      response = await POST(new Request("http://local/api/pipeline", {
        method: "POST",
        body: JSON.stringify({ topic: "Istanbul Topic" }),
      }));
    } finally {
      runner.run = realRun;
    }
    assert.equal(stagesReached, false);
    const body = await response.json() as { success: boolean; code?: string; projectUrl?: string };
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.equal(body.success, false);
    assert.equal(body.code, "PROJECT_ALREADY_EXISTS");
    assert.equal(body.projectUrl, `/project/${M_SLUG}`);
    assert.deepEqual(folders(sb), [M_UUID]);
    assert.deepEqual(tree(dir), before, "no stage ran against the existing project");
  });

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    console.error(`FAIL (${failures.length} of ${count} scenarios)`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS (${count} scenarios)`);
}

run()
  .catch((error) => {
    console.error("FAIL", error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    clearProjectFolderIndexCache();
    for (const root of sandboxes) fs.rmSync(root, { recursive: true, force: true });
  });
