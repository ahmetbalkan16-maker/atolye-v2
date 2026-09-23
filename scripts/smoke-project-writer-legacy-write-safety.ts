/**
 * ProjectWriter legacy write-safety smoke (write-path safety sprint).
 *
 * Deterministic / $0 / no network / TEMP-only: every scenario gets its own
 * sandbox workspace (whose `data/projects` is the legacy quarantine root),
 * runtime root and authority root. No live runtime is read or written.
 *
 * Before this sprint `ProjectWriter` joined the caller's slug straight onto
 * `<projectsRoot>/<slug>/`, while the read path (`ProjectFolderIndex`) resolves
 * a legacy record (folder = UUID, `project.json.id == slug`) to its UUID folder.
 * A write by slug therefore created a second, partial `<slug>/` tree that then
 * shadowed the real project: `getProject(slug)` returned null (split-brain).
 * And `createProject` over a slug owned by a different (legacy) folder created
 * a second project that shadowed it.
 *
 * Covers: new-project create, normal slug-folder update, legacy alias update
 * with and without a quarantine folder, research-only and manifest-only writes,
 * duplicate-folder prevention, alias writes holding both the slug and the
 * folder lease, listProjects duplicate-id prevention, getProject canonical after
 * write, and the create guard against a slug owned by another folder.
 * Re-creating a topic into its own `<slug>/` is deliberately unchanged
 * (deferred owner decision — see ATOLYE_CHECKPOINT.md).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { ProjectAlreadyExistsError, ProjectWriter } from "../src/lib/projects/ProjectWriter";
import { clearProjectFolderIndexCache } from "../src/lib/projects/ProjectFolderIndex";
import {
  acquireProjectWriteAuthority,
  RuntimeStorageError,
} from "../src/lib/runtime/RuntimeStoragePaths";
import type { Project } from "../src/types/project";

let count = 0;
async function scenario(name: string, fn: () => Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const envKeys = ["ATOLYE_WORKSPACE_ROOT", "ATOLYE_RUNTIME_ROOT", "ATOLYE_RUNTIME_AUTHORITY_ROOT"] as const;
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const sandboxes: string[] = [];

const LEGACY_UUID = "8e2a1371-0000-4000-8000-00000000abcd";
const LEGACY_SLUG = "legacy-hunlar";

type Sandbox = { workspace: string; projectsRoot: string; quarantineRoot: string };

/** Fresh TEMP workspace + runtime + authority, bound through the env default path. */
function sandbox(): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pwlws-"));
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
  return { workspace, projectsRoot, quarantineRoot };
}

/** Legacy record: folder named by UUID, project.json id == slug (no `<slug>/` folder). */
function seedLegacy(sb: Sandbox) {
  const dir = path.join(sb.projectsRoot, LEGACY_UUID);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({
    id: LEGACY_SLUG, slug: LEGACY_SLUG, title: "Legacy Hunlar", status: "research",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  }));
  const project = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf-8")) as Project;
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      project, projectId: project.id, slug: project.slug, version: 1, packages: {},
      createdAt: project.createdAt, updatedAt: project.updatedAt,
    }),
  );
  clearProjectFolderIndexCache();
  return dir;
}

function folders(sb: Sandbox) {
  return fs.readdirSync(sb.projectsRoot).sort();
}

function snapshot(dir: string) {
  return Object.fromEntries(
    fs.readdirSync(dir).sort().map((name) => [name, fs.readFileSync(path.join(dir, name), "utf-8")]),
  );
}

async function run() {
  // 1 ---------------------------------------------------------------
  await scenario("normal new UUID project create + write stays in <slug>/", async () => {
    const sb = sandbox();
    const project = await ProjectManager.createProject("Brand New Topic");
    assert.equal(project.slug, "brand-new-topic");
    assert.match(project.id, /^[0-9a-f-]{36}$/);
    await ProjectManager.saveResearch(project.slug, { r: "new" });
    assert.deepEqual(folders(sb), ["brand-new-topic"]);
    assert.deepEqual(
      fs.readdirSync(path.join(sb.projectsRoot, "brand-new-topic")).sort(),
      ["manifest.json", "project.json", "research.json"],
    );
    assert.equal((await ProjectManager.getProject(project.slug))?.id, project.id);
  });

  // 2 ---------------------------------------------------------------
  await scenario("normal slug-folder project update is unchanged", async () => {
    const sb = sandbox();
    const project = await ProjectManager.createProject("Slug Folder Topic");
    await ProjectManager.updatePackageStatus(project.slug, "research", "completed");
    await ProjectWriter.writeJSON(project.slug, "research.json", { r: 2 });
    assert.deepEqual(folders(sb), ["slug-folder-topic"]);
    const manifest = await ProjectManager.getManifest(project.slug);
    assert.equal(manifest?.packages.research.status, "completed");
    assert.deepEqual(await ProjectManager.getResearch(project.slug), { r: 2 });
  });

  // 3 ---------------------------------------------------------------
  await scenario("legacy folder=UUID, id==slug: project.json update lands in the UUID folder", async () => {
    const sb = sandbox();
    const dir = seedLegacy(sb);
    const current = await ProjectManager.getProject(LEGACY_SLUG);
    assert.equal(current?.id, LEGACY_SLUG);
    await ProjectWriter.writeJSON(LEGACY_SLUG, "project.json", { ...current, title: "Legacy Hunlar v2" });
    assert.deepEqual(folders(sb), [LEGACY_UUID]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf-8")).title, "Legacy Hunlar v2");
  });

  // 4 ---------------------------------------------------------------
  await scenario("legacy update with no quarantine folder: no <slug>/ split-brain", async () => {
    const sb = sandbox();
    const dir = seedLegacy(sb);
    assert.equal(fs.existsSync(path.join(sb.quarantineRoot, LEGACY_SLUG)), false);
    await ProjectWriter.writeJSON(LEGACY_SLUG, "research.json", { r: "legacy" });
    assert.equal(fs.existsSync(path.join(sb.projectsRoot, LEGACY_SLUG)), false, "no <slug>/ tree");
    assert.deepEqual(folders(sb), [LEGACY_UUID]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "research.json"), "utf-8")), { r: "legacy" });
    clearProjectFolderIndexCache();
    assert.equal((await ProjectManager.getProject(LEGACY_SLUG))?.id, LEGACY_SLUG, "project still visible by slug");
  });

  // 5 ---------------------------------------------------------------
  await scenario("legacy update with quarantine folder still fails closed, nothing written", async () => {
    const sb = sandbox();
    const dir = seedLegacy(sb);
    fs.mkdirSync(path.join(sb.quarantineRoot, LEGACY_SLUG));
    const before = snapshot(dir);
    for (const write of [
      () => ProjectWriter.writeJSON(LEGACY_SLUG, "research.json", { r: "x" }),
      () => ProjectWriter.writeJSONOnce(LEGACY_SLUG, "script.json", { s: "x" }),
      () => ProjectWriter.removeJSON(LEGACY_SLUG, "manifest.json"),
      () => ProjectWriter.ensureProjectFolder(LEGACY_SLUG),
    ]) {
      await assert.rejects(write, (error) =>
        error instanceof RuntimeStorageError && error.code === "RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE");
    }
    assert.deepEqual(folders(sb), [LEGACY_UUID]);
    assert.deepEqual(snapshot(dir), before, "UUID folder byte-identical");
  });

  // 6 ---------------------------------------------------------------
  await scenario("research-only write by slug goes to the UUID folder", async () => {
    const sb = sandbox();
    const dir = seedLegacy(sb);
    await ProjectManager.saveResearch(LEGACY_SLUG, { topic: "Hunlar" });
    assert.deepEqual(folders(sb), [LEGACY_UUID]);
    assert.deepEqual(await ProjectManager.getResearch(LEGACY_SLUG), { topic: "Hunlar" });
    assert.ok(fs.existsSync(path.join(dir, "research.json")));
  });

  // 7 ---------------------------------------------------------------
  await scenario("manifest-only write by slug goes to the UUID folder", async () => {
    const sb = sandbox();
    const dir = seedLegacy(sb);
    await ProjectManager.updatePackageStatus(LEGACY_SLUG, "research", "completed");
    assert.deepEqual(folders(sb), [LEGACY_UUID]);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf-8"));
    assert.equal(onDisk.packages.research.status, "completed");
    assert.equal((await ProjectManager.getManifest(LEGACY_SLUG))?.packages.research.status, "completed");
  });

  // 8 ---------------------------------------------------------------
  await scenario("duplicate prevention across every ProjectWriter entry point", async () => {
    const sb = sandbox();
    const dir = seedLegacy(sb);
    const folder = await ProjectWriter.ensureProjectFolder(LEGACY_SLUG);
    assert.equal(fs.realpathSync(folder), fs.realpathSync(dir));
    await ProjectWriter.writeJSONOnce(LEGACY_SLUG, "script.json", { s: 1 });
    await ProjectWriter.writeJSONAtomically(LEGACY_SLUG, "seo.json", { k: 1 });
    await ProjectWriter.writeJSON(LEGACY_UUID, "audio.json", { a: 1 }); // addressed by folder id
    await ProjectWriter.removeJSON(LEGACY_SLUG, "seo.json");
    assert.deepEqual(folders(sb), [LEGACY_UUID]);
    assert.deepEqual(
      fs.readdirSync(dir).sort(),
      ["audio.json", "manifest.json", "project.json", "script.json"],
    );
    // writeJSONOnce keeps its exclusive-create contract on the resolved folder.
    await assert.rejects(
      () => ProjectWriter.writeJSONOnce(LEGACY_SLUG, "script.json", { s: 2 }),
      (error) => (error as NodeJS.ErrnoException).code === "EEXIST",
    );
    // An identifier that resolves to nothing is written exactly as before.
    await ProjectWriter.writeJSON("unindexed-slug", "ai-usage.json", { records: [] });
    assert.deepEqual(folders(sb), [LEGACY_UUID, "unindexed-slug"]);
    // An unsafe identifier is still rejected before any filesystem work.
    await assert.rejects(
      () => ProjectWriter.writeJSON("../escape", "research.json", {}),
      (error) => error instanceof RuntimeStorageError && error.code === "RUNTIME_STORAGE_PATH_INVALID",
    );
  });

  // 9 ---------------------------------------------------------------
  await scenario("listProjects has no duplicate ids after legacy writes", async () => {
    seedLegacy(sandbox());
    await ProjectManager.saveResearch(LEGACY_SLUG, { r: 1 });
    await ProjectManager.updatePackageStatus(LEGACY_SLUG, "research", "completed");
    await ProjectWriter.writeJSON(LEGACY_SLUG, "project.json", {
      ...(await ProjectManager.getProject(LEGACY_SLUG)), status: "script",
    });
    const other = await ProjectManager.createProject("Other Topic");
    clearProjectFolderIndexCache();
    const listed = (await ProjectReader.listProjects()) as Project[];
    const ids = listed.map((project) => project.id);
    assert.equal(new Set(ids).size, ids.length, "no duplicate ids");
    assert.deepEqual(ids.sort(), [LEGACY_SLUG, other.id].sort());
    assert.equal(listed.filter((project) => project.slug === LEGACY_SLUG).length, 1);
  });

  // 10 --------------------------------------------------------------
  await scenario("getProject stays canonical after writes (by slug and by folder id)", async () => {
    const sb = sandbox();
    seedLegacy(sb);
    const current = await ProjectManager.getProject(LEGACY_SLUG);
    await ProjectWriter.writeJSON(LEGACY_SLUG, "project.json", { ...current, status: "scenes" });
    await ProjectManager.saveResearch(LEGACY_SLUG, { r: 1 });
    clearProjectFolderIndexCache();
    const bySlug = await ProjectManager.getProject(LEGACY_SLUG);
    const byFolder = await ProjectManager.getProject(LEGACY_UUID);
    assert.equal(bySlug?.id, LEGACY_SLUG);
    assert.equal(bySlug?.status, "scenes");
    assert.deepEqual(byFolder, bySlug);
    assert.equal(
      path.basename(ProjectReader.getProjectFolder(LEGACY_SLUG)),
      LEGACY_UUID,
    );
  });

  // 11 --------------------------------------------------------------
  await scenario("re-creating a topic into its own <slug>/ is unchanged (deferred), no second folder", async () => {
    const sb = sandbox();
    const first = await ProjectManager.createProject("Same Topic");
    const second = await ProjectManager.createProject("Same Topic");
    assert.deepEqual(folders(sb), ["same-topic"]);
    assert.equal((await ProjectManager.getProject("same-topic"))?.id, second.id);
    assert.notEqual(first.id, second.id);
  });

  // 12 --------------------------------------------------------------
  await scenario("createProject refuses a slug owned by a legacy UUID folder (no shadow tree)", async () => {
    const sb = sandbox();
    const dir = seedLegacy(sb);
    const before = snapshot(dir);
    await assert.rejects(
      () => ProjectManager.createProject("Legacy Hunlar"),
      (error) => error instanceof ProjectAlreadyExistsError,
    );
    assert.deepEqual(folders(sb), [LEGACY_UUID]);
    assert.deepEqual(snapshot(dir), before);
    clearProjectFolderIndexCache();
    assert.equal((await ProjectManager.getProject(LEGACY_SLUG))?.id, LEGACY_SLUG);
  });

  // 12b -------------------------------------------------------------
  await scenario("createProject refuses a leftover <slug>/ while a legacy folder owns the slug", async () => {
    const sb = sandbox();
    const dir = seedLegacy(sb);
    const leftover = path.join(sb.projectsRoot, LEGACY_SLUG);
    fs.mkdirSync(leftover);
    fs.writeFileSync(path.join(leftover, "research.json"), JSON.stringify({ stale: true }));
    const before = snapshot(dir);
    await assert.rejects(
      () => ProjectManager.createProject("Legacy Hunlar"),
      (error) => error instanceof ProjectAlreadyExistsError,
    );
    assert.deepEqual(fs.readdirSync(leftover), ["research.json"], "leftover not turned into a project");
    assert.deepEqual(snapshot(dir), before);
  });

  // 12c -------------------------------------------------------------
  await scenario("alias writes hold both the slug lease and the folder lease", async () => {
    const sb = sandbox();
    const dir = seedLegacy(sb);
    for (const identity of [LEGACY_SLUG, LEGACY_UUID]) {
      const external = acquireProjectWriteAuthority(identity);
      try {
        await assert.rejects(
          () => ProjectWriter.writeJSON(LEGACY_SLUG, "research.json", { r: identity }),
          (error) => error instanceof RuntimeStorageError && error.code === "RUNTIME_STORAGE_AUTHORITY_LOCKED",
        );
      } finally {
        external.release();
      }
    }
    assert.equal(fs.existsSync(path.join(dir, "research.json")), false);
    await ProjectWriter.writeJSON(LEGACY_SLUG, "research.json", { r: "after-release" });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "research.json"), "utf-8")), { r: "after-release" });
    assert.deepEqual(folders(sb), [LEGACY_UUID]);
    // Both leases are released: a follow-up external lease on either identity succeeds.
    acquireProjectWriteAuthority(LEGACY_SLUG).release();
    acquireProjectWriteAuthority(LEGACY_UUID).release();
  });

  // 13 --------------------------------------------------------------
  await scenario("createProject into an existing <slug>/ folder without project.json is unchanged", async () => {
    const sb = sandbox();
    fs.mkdirSync(path.join(sb.projectsRoot, "leftover-topic"));
    fs.writeFileSync(path.join(sb.projectsRoot, "leftover-topic", "ai-usage.json"), "{}");
    const project = await ProjectManager.createProject("Leftover Topic");
    assert.equal((await ProjectManager.getProject("leftover-topic"))?.id, project.id);
    assert.deepEqual(folders(sb), ["leftover-topic"]);
  });

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
