/**
 * Graphify consistency scan smoke (Final Production Master Sprint §13/§14).
 *
 * Deterministic / no browser / no env. Builds a temp `projects/` tree and
 * asserts `scanGraphifyConsistency` classifies:
 *  - a fully-consistent UUID-folder runtime → verdict "consistent";
 *  - an orphan folder (no `project.json`) → note, not failure;
 *  - `id` !== folder but the resolver still maps id + slug + folder → note only;
 *  - a project NO identifier resolves to → verdict "inconsistent" (real break);
 *  - a folder with `project.json` but no `manifest.json` → note;
 *  - the in-repo `data/projects` legacy root: a note when the runtime is
 *    external, a hard failure when it is the authoritative root;
 *  - a resolver that throws is treated as unresolved, never crashes;
 *  - a missing projects root → empty report, no throw;
 *  - the write-path risk string switches on all-UUID vs mixed folders.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { scanGraphifyConsistency } from "../src/lib/ayas/GraphifyConsistency";

let count = 0;
function scenario(name: string, fn: () => void) {
  fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UUID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function mkRuntime(): { root: string; projectsRoot: string; legacyDataProjectsDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-consistency-"));
  const projectsRoot = path.join(root, "runtime", "projects");
  const legacyDataProjectsDir = path.join(root, "data", "projects");
  fs.mkdirSync(projectsRoot, { recursive: true });
  fs.mkdirSync(legacyDataProjectsDir, { recursive: true });
  return { root, projectsRoot, legacyDataProjectsDir };
}

function writeFolder(
  projectsRoot: string,
  folder: string,
  project: Record<string, unknown> | null,
  withManifest = true,
) {
  const dir = path.join(projectsRoot, folder);
  fs.mkdirSync(dir, { recursive: true });
  if (project) fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project));
  if (withManifest) fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ version: 1, packages: {} }));
}

function writeRecord(legacyDataProjectsDir: string, name: string) {
  fs.writeFileSync(path.join(legacyDataProjectsDir, `${name}.json`), JSON.stringify({ slug: name }));
}

/** A resolver that maps folder name + project.json id + slug → folder, like ProjectFolderIndex. */
function indexResolver(identifier: string, projectsRoot: string): string | null {
  try {
    const folders = fs.readdirSync(projectsRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (folders.some((f) => f.name === identifier)) return identifier;
    for (const f of folders) {
      try {
        const pj = JSON.parse(fs.readFileSync(path.join(projectsRoot, f.name, "project.json"), "utf8")) as {
          id?: string;
          slug?: string;
        };
        if (pj.id === identifier || pj.slug === identifier) return f.name;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* missing root */
  }
  return null;
}

scenario("fully-consistent UUID runtime, external → verdict consistent, write-path risk flagged", () => {
  const { root, projectsRoot, legacyDataProjectsDir } = mkRuntime();
  try {
    writeFolder(projectsRoot, UUID_A, { id: UUID_A, slug: "alpha-" + UUID_A, status: "visuals" });
    writeFolder(projectsRoot, UUID_B, { id: UUID_B, slug: "beta-" + UUID_B, status: "script" });

    const report = scanGraphifyConsistency({
      projectsRoot,
      runtimeExternal: true,
      legacyDataProjectsDir,
      resolveFolder: indexResolver,
    });
    assert.equal(report.folderCount, 2);
    assert.equal(report.withProjectJson, 2);
    assert.equal(report.withManifest, 2);
    assert.deepEqual([...report.orphanFolders], []);
    assert.deepEqual([...report.idFolderMismatches], []);
    assert.deepEqual([...report.missingManifests], []);
    assert.deepEqual([...report.unresolvableProjects], []);
    assert.equal(report.verdict, "consistent");
    assert.match(report.writePathRisk, /ProjectWriter/);
    assert.match(report.writePathRisk, /Execution Gate is CLOSED/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

scenario("orphan folder (no project.json) → listed, verdict consistent-with-notes", () => {
  const { root, projectsRoot, legacyDataProjectsDir } = mkRuntime();
  try {
    writeFolder(projectsRoot, UUID_A, { id: UUID_A, slug: "alpha", status: "visuals" });
    writeFolder(projectsRoot, UUID_C, null, false); // orphan — nothing in it

    const report = scanGraphifyConsistency({
      projectsRoot,
      runtimeExternal: true,
      legacyDataProjectsDir,
      resolveFolder: indexResolver,
    });
    assert.deepEqual([...report.orphanFolders], [UUID_C]);
    assert.equal(report.withProjectJson, 1);
    assert.equal(report.verdict, "consistent-with-notes");
    assert.ok(report.notes.some((n) => /project\.json yok/.test(n)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

scenario("id !== folder but id + slug + folder all still resolve → note only, NOT inconsistent", () => {
  const { root, projectsRoot, legacyDataProjectsDir } = mkRuntime();
  try {
    // folder is a UUID, project.json.id is a human slug (the real D:\ Hun-project case)
    writeFolder(projectsRoot, UUID_A, { id: "hunlarin-dogusu", slug: "hunlarin-dogusu", status: "research" });

    const report = scanGraphifyConsistency({
      projectsRoot,
      runtimeExternal: true,
      legacyDataProjectsDir,
      resolveFolder: indexResolver,
    });
    assert.deepEqual([...report.idFolderMismatches], [UUID_A]);
    assert.deepEqual([...report.unresolvableProjects], [], "index resolves id + slug + folder → not a break");
    assert.equal(report.verdict, "consistent-with-notes");
    assert.ok(report.notes.some((n) => /folder adına eşit değil/.test(n)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

scenario("a project NO identifier resolves to → unresolvableProjects, verdict inconsistent", () => {
  const { root, projectsRoot, legacyDataProjectsDir } = mkRuntime();
  try {
    writeFolder(projectsRoot, UUID_A, { id: UUID_A, slug: "alpha", status: "visuals" });

    const report = scanGraphifyConsistency({
      projectsRoot,
      runtimeExternal: true,
      legacyDataProjectsDir,
      resolveFolder: () => null, // Graphify's resolver can't map anything
    });
    assert.equal(report.unresolvableProjects.length, 1);
    assert.equal(report.unresolvableProjects[0].folder, UUID_A);
    assert.ok(report.unresolvableProjects[0].identifiers.includes(UUID_A));
    assert.equal(report.verdict, "inconsistent");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

scenario("project.json but no manifest.json → missingManifests note", () => {
  const { root, projectsRoot, legacyDataProjectsDir } = mkRuntime();
  try {
    writeFolder(projectsRoot, UUID_A, { id: UUID_A, slug: "alpha", status: "visuals" }, false);

    const report = scanGraphifyConsistency({
      projectsRoot,
      runtimeExternal: true,
      legacyDataProjectsDir,
      resolveFolder: indexResolver,
    });
    assert.deepEqual([...report.missingManifests], [UUID_A]);
    assert.equal(report.withManifest, 0);
    assert.equal(report.verdict, "consistent-with-notes");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

scenario("legacy in-repo records: a note when runtime is external, a failure when it is authoritative", () => {
  const { root, projectsRoot, legacyDataProjectsDir } = mkRuntime();
  try {
    writeFolder(projectsRoot, UUID_A, { id: UUID_A, slug: "alpha", status: "visuals" });
    writeRecord(legacyDataProjectsDir, "alpha"); // resolvable via slug
    writeRecord(legacyDataProjectsDir, "ghost-project"); // nothing on disk

    const external = scanGraphifyConsistency({
      projectsRoot,
      runtimeExternal: true,
      legacyDataProjectsDir,
      resolveFolder: indexResolver,
    });
    assert.equal(external.legacyRecordCount, 2);
    assert.deepEqual([...external.legacyUnresolved], ["ghost-project"]);
    assert.equal(external.legacyRootIsQuarantine, true);
    assert.equal(external.verdict, "consistent-with-notes", "external runtime → legacy junk is expected");
    assert.ok(external.notes.some((n) => /karantina/.test(n)));

    const authoritative = scanGraphifyConsistency({
      projectsRoot,
      runtimeExternal: false,
      legacyDataProjectsDir,
      resolveFolder: indexResolver,
    });
    assert.equal(authoritative.legacyRootIsQuarantine, false);
    assert.equal(authoritative.verdict, "inconsistent", "in-repo root authoritative → an unresolved record is a real break");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

scenario("a resolver that throws is treated as unresolved, never crashes the scan", () => {
  const { root, projectsRoot, legacyDataProjectsDir } = mkRuntime();
  try {
    writeFolder(projectsRoot, UUID_A, { id: UUID_A, slug: "alpha", status: "visuals" });
    writeRecord(legacyDataProjectsDir, "alpha");

    const report = scanGraphifyConsistency({
      projectsRoot,
      runtimeExternal: false,
      legacyDataProjectsDir,
      resolveFolder: () => {
        throw new Error("resolver blew up");
      },
    });
    assert.deepEqual([...report.legacyUnresolved], ["alpha"]);
    assert.equal(report.unresolvableProjects.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

scenario("missing projects root → empty report, no throw", () => {
  const report = scanGraphifyConsistency({
    projectsRoot: path.join(os.tmpdir(), "graphify-consistency-does-not-exist-" + Date.now()),
    runtimeExternal: false,
    legacyDataProjectsDir: path.join(os.tmpdir(), "graphify-consistency-no-data-" + Date.now()),
    resolveFolder: indexResolver,
  });
  assert.equal(report.folderCount, 0);
  assert.equal(report.legacyRecordCount, 0);
  assert.equal(report.verdict, "consistent");
});

scenario("mixed slug + UUID folders → write-path risk switches to the 'mixed' wording", () => {
  const { root, projectsRoot, legacyDataProjectsDir } = mkRuntime();
  try {
    writeFolder(projectsRoot, UUID_A, { id: UUID_A, slug: "alpha", status: "visuals" });
    writeFolder(projectsRoot, "legacy-human-slug", { id: "legacy-human-slug", slug: "legacy-human-slug", status: "done" });

    const report = scanGraphifyConsistency({
      projectsRoot,
      runtimeExternal: true,
      legacyDataProjectsDir,
      resolveFolder: indexResolver,
    });
    assert.match(report.writePathRisk, /mixed slug\/UUID/);
    assert.equal(report.verdict, "consistent");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

console.log(`Graphify consistency smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "graphify-consistency", scenarios: count }));
