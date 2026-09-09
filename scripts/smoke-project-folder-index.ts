/**
 * Project folder identity index smoke (Final Execution Sprint).
 *
 * Deterministic / $0 / no network. Covers the read-only resolver that lets
 * `ProjectReader` (and thus `ProjectManager` / `PipelineRecoveryPlanner` / the
 * dashboard `/project/<slug>` route) find a project whose folder is named by id
 * (post-cutover) when the caller carries the human slug.
 *
 *  - direct folder segment still wins (unchanged behaviour, byte-for-byte);
 *  - id → folder, project.json-slug → folder;
 *  - missing / malformed project.json folders are skipped, not crashed;
 *  - a slug collision resolves deterministically (sorted folder name);
 *  - an unknown identifier → null;
 *  - end-to-end: ProjectReader.readJSON + ProjectManager.getManifest by slug and by id.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveProjectFolderSegment,
  clearProjectFolderIndexCache,
} from "../src/lib/projects/ProjectFolderIndex";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { ProjectManager } from "../src/lib/projects/ProjectManager";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function writeProj(projectsRoot: string, folder: string, record: Record<string, unknown> | string | null) {
  const dir = path.join(projectsRoot, folder);
  fs.mkdirSync(dir, { recursive: true });
  if (record === null) return;
  fs.writeFileSync(
    path.join(dir, "project.json"),
    typeof record === "string" ? record : JSON.stringify(record),
  );
}

async function run() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "pfi-"));
  const runtimeRoot = path.join(sandbox, "runtime");
  const projectsRoot = path.join(runtimeRoot, "projects");
  fs.mkdirSync(projectsRoot, { recursive: true });

  const prev = process.env.ATOLYE_RUNTIME_ROOT;
  const prevAuth = process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT;
  process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
  process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = path.join(sandbox, "authority");
  fs.mkdirSync(process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT, { recursive: true });

  try {
    // Post-cutover style: folder = id (uuid-ish), project.json carries the human slug.
    writeProj(projectsRoot, "0453f0b4-uuid-folder", {
      id: "0453f0b4-uuid-folder",
      slug: "mimar-sinan-hayati",
      title: "Mimar Sinan",
      status: "visuals",
    });
    fs.writeFileSync(
      path.join(projectsRoot, "0453f0b4-uuid-folder", "manifest.json"),
      JSON.stringify({ version: 1, slug: "mimar-sinan-hayati", projectId: "0453f0b4-uuid-folder", packages: { research: { key: "research", status: "completed" } } }),
    );
    // Legacy style: folder = slug.
    writeProj(projectsRoot, "legacy-slug-folder", {
      id: "id-legacy-9999",
      slug: "legacy-slug-folder",
      title: "Legacy",
      status: "draft",
    });
    // A folder with no project.json — must be skipped, never crash.
    writeProj(projectsRoot, "orphan-no-json", null);
    // A folder with malformed project.json — skipped.
    writeProj(projectsRoot, "malformed-folder", "{ not json");

    clearProjectFolderIndexCache();

    await scenario("direct folder segment wins unchanged", () => {
      assert.equal(resolveProjectFolderSegment("0453f0b4-uuid-folder", projectsRoot), "0453f0b4-uuid-folder");
      assert.equal(resolveProjectFolderSegment("legacy-slug-folder", projectsRoot), "legacy-slug-folder");
    });

    await scenario("id → folder", () => {
      assert.equal(resolveProjectFolderSegment("id-legacy-9999", projectsRoot), "legacy-slug-folder");
    });

    await scenario("project.json slug → folder (the post-cutover fix)", () => {
      assert.equal(resolveProjectFolderSegment("mimar-sinan-hayati", projectsRoot), "0453f0b4-uuid-folder");
    });

    await scenario("unknown identifier → null", () => {
      assert.equal(resolveProjectFolderSegment("does-not-exist", projectsRoot), null);
      assert.equal(resolveProjectFolderSegment("bad/segment", projectsRoot), null);
    });

    await scenario("orphan / malformed folders do not crash resolution", () => {
      assert.equal(resolveProjectFolderSegment("orphan-no-json", projectsRoot), "orphan-no-json"); // direct dir exists
      assert.equal(resolveProjectFolderSegment("whatever", projectsRoot), null);
    });

    await scenario("slug collision resolves deterministically (sorted folder name)", () => {
      writeProj(projectsRoot, "zzz-collide", { id: "id-z", slug: "dup-slug", title: "Z", status: "draft" });
      writeProj(projectsRoot, "aaa-collide", { id: "id-a", slug: "dup-slug", title: "A", status: "draft" });
      clearProjectFolderIndexCache();
      assert.equal(resolveProjectFolderSegment("dup-slug", projectsRoot), "aaa-collide");
      // id is still unique and exact
      assert.equal(resolveProjectFolderSegment("id-z", projectsRoot), "zzz-collide");
    });

    await scenario("end-to-end: ProjectReader.readJSON by human slug hits the uuid folder", async () => {
      const proj = await ProjectReader.readJSON<{ id: string; slug: string }>("mimar-sinan-hayati", "project.json");
      assert.ok(proj, "resolved");
      assert.equal(proj!.id, "0453f0b4-uuid-folder");
      assert.equal(proj!.slug, "mimar-sinan-hayati");
    });

    await scenario("end-to-end: ProjectManager.getManifest works by slug AND by id", async () => {
      const bySlug = await ProjectManager.getManifest("mimar-sinan-hayati");
      const byId = await ProjectManager.getManifest("0453f0b4-uuid-folder");
      assert.ok(bySlug, "getManifest(slug)");
      assert.ok(byId, "getManifest(id)");
      assert.equal(bySlug!.packages.research.status, "completed");
    });

    await scenario("end-to-end: a genuinely missing project still returns missing/null", async () => {
      const st = await ProjectReader.readJSONState("no-such-project-anywhere", "project.json");
      assert.equal(st.status, "missing");
      const mf = await ProjectManager.getManifest("no-such-project-anywhere");
      assert.equal(mf, null);
    });
  } finally {
    if (prev === undefined) delete process.env.ATOLYE_RUNTIME_ROOT;
    else process.env.ATOLYE_RUNTIME_ROOT = prev;
    if (prevAuth === undefined) delete process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT;
    else process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = prevAuth;
    clearProjectFolderIndexCache();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  console.log(`Project folder index smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "project-folder-index", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
