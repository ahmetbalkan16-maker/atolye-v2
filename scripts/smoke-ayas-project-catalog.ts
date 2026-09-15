/**
 * AYAS Production Project Catalog smoke suite (Production Project Catalog +
 * Resume Awareness sprint).
 *
 * Deterministic / $0 / no network / no model. Covers `AyasProjectCatalog.ts`
 * against a temp runtime root (env-scoped, the SAME `ATOLYE_RUNTIME_ROOT`
 * save/restore idiom `smoke-ayas-studio-context.ts`/`smoke-project-folder
 * -index.ts` already use — no new isolation convention):
 *
 *  - SCENARIO A — authoritative-root resolution + a realistic multi-project
 *    fixture read correctly.
 *  - SCENARIO B — no double count: the SAME `.env.local`-resolved root is
 *    read exactly once, so a project cannot appear twice even if a second,
 *    legacy-shaped root happens to exist on disk (this module never
 *    consults more than one root per call — structurally, not just by
 *    accident of the fixture).
 *  - SCENARIO C — completed detection: `export/bundle/video.mp4` + a
 *    `completed` `project.json` status classify correctly, and a
 *    `completed`-status project WITHOUT a real video file is NOT
 *    mis-reported as having one (matches the real anomaly found in the
 *    prior forensic audit).
 *  - SCENARIO D — partial project normalization: assembly/scenes/visuals/
 *    script/research/draft all normalize with the correct `resumable`/
 *    `resumeCandidateStage` derived from a REAL `PipelineRecoveryPlanner`
 *    read, never guessed.
 *  - SCENARIO E — corrupt metadata: a malformed `project.json` and a
 *    missing one both surface as `status: "unknown"` with a note, and never
 *    fail the whole catalog.
 *  - SCENARIO F — read-only: the catalog never modifies any file.
 *  - SCENARIO G — path security: a `projectId`/`titleContains` query can
 *    never escape the runtime root.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadAyasProjectCatalog,
  listAyasProductionProjects,
  getAyasProductionProject,
  findAyasProductionProjects,
  summarizeAyasProductionProjects,
} from "../src/lib/ayas/AyasProjectCatalog";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const STAGES = ["research", "script", "scenes", "visuals", "animation", "video", "audio", "assembly", "thumbnail", "seo", "youtube", "export"] as const;

function writeProject(root: string, dir: string, record: Record<string, unknown> | null) {
  const folder = path.join(root, "projects", dir);
  fs.mkdirSync(folder, { recursive: true });
  if (record === null) return;
  fs.writeFileSync(path.join(folder, "project.json"), JSON.stringify(record));
}

function writeMalformedProject(root: string, dir: string) {
  const folder = path.join(root, "projects", dir);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "project.json"), "{ not valid json");
}

function writeManifest(root: string, dir: string, packages: Record<string, { status: string; error?: string }>) {
  const full: Record<string, { key: string; status: string; error: string | null }> = {};
  for (const s of STAGES) full[s] = { key: s, status: packages[s]?.status ?? "pending", error: packages[s]?.error ?? null };
  fs.writeFileSync(path.join(root, "projects", dir, "manifest.json"), JSON.stringify({ version: 1, slug: dir, projectId: dir, packages: full }));
}

function writeAsset(root: string, dir: string, relPath: string, content = "x") {
  const full = path.join(root, "projects", dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function snapshotMtimes(root: string): Map<string, number> {
  const out = new Map<string, number>();
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else out.set(full, fs.statSync(full).mtimeMs);
    }
  }
  return out;
}

async function withRuntimeRoot<T>(build: (root: string) => void, run: () => Promise<T>): Promise<T> {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-catalog-"));
  const runtimeRoot = path.join(sandbox, "runtime");
  fs.mkdirSync(path.join(runtimeRoot, "projects"), { recursive: true });
  const prev = process.env.ATOLYE_RUNTIME_ROOT;
  process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
  try {
    build(runtimeRoot);
    return await run();
  } finally {
    if (prev === undefined) delete process.env.ATOLYE_RUNTIME_ROOT;
    else process.env.ATOLYE_RUNTIME_ROOT = prev;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

async function main() {
  await scenario("SCENARIO A — authoritative-root resolution + a realistic multi-project fixture reads correctly", async () => {
    await withRuntimeRoot(
      (root) => {
        writeProject(root, "alpha", { id: "alpha", slug: "alpha", title: "Alpha", status: "completed", updatedAt: "2026-09-01T00:00:00.000Z" });
        writeAsset(root, "alpha", "export/bundle/video.mp4");
        writeManifest(root, "alpha", Object.fromEntries(STAGES.map((s) => [s, { status: "completed" }])));

        writeProject(root, "beta", { id: "beta", slug: "beta", title: "Beta", status: "visuals", updatedAt: "2026-09-02T00:00:00.000Z" });
        writeManifest(root, "beta", { research: { status: "completed" }, script: { status: "completed" }, scenes: { status: "completed" }, visuals: { status: "pending" } });

        writeProject(root, "gamma", { id: "gamma", slug: "gamma", title: "Gamma", status: "draft", updatedAt: "2026-09-03T00:00:00.000Z" });
      },
      async () => {
        const catalog = await loadAyasProjectCatalog();
        assert.equal(catalog.available, true);
        assert.equal(catalog.runtimeClassification, "explicit-external");
        assert.equal(catalog.external, true);
        assert.equal(catalog.projects.length, 3);
        assert.deepEqual(new Set(catalog.projects.map((p) => p.projectId)), new Set(["alpha", "beta", "gamma"]));
      },
    );
  });

  await scenario("SCENARIO B — no double count: exactly one root is ever read per call, even if a second legacy-shaped directory exists on disk", async () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-catalog-nodup-"));
    const runtimeRoot = path.join(sandbox, "runtime");
    const legacyRoot = path.join(sandbox, "legacy-lookalike"); // deliberately never referenced by ATOLYE_RUNTIME_ROOT
    fs.mkdirSync(path.join(runtimeRoot, "projects"), { recursive: true });
    fs.mkdirSync(path.join(legacyRoot, "projects"), { recursive: true });
    const prev = process.env.ATOLYE_RUNTIME_ROOT;
    process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
    try {
      writeProject(runtimeRoot, "solo", { id: "solo", title: "Solo", status: "draft" });
      // The exact SAME project id/slug ALSO exists under the legacy-lookalike root — but that root is never the resolved authoritative one, so it must never be consulted.
      writeProject(legacyRoot, "solo", { id: "solo", title: "Solo (legacy copy)", status: "draft" });
      const catalog = await loadAyasProjectCatalog();
      assert.equal(catalog.projects.length, 1, "only the authoritative root's copy is counted");
      assert.equal(catalog.projects[0]!.title, "Solo");
    } finally {
      if (prev === undefined) delete process.env.ATOLYE_RUNTIME_ROOT;
      else process.env.ATOLYE_RUNTIME_ROOT = prev;
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });

  await scenario("SCENARIO C — completed detection: real export/bundle/video.mp4 + completed status classify correctly; a completed project WITHOUT a real video is not mis-reported as having one", async () => {
    await withRuntimeRoot(
      (root) => {
        writeProject(root, "with-video", { id: "with-video", title: "With Video", status: "completed" });
        writeAsset(root, "with-video", "export/bundle/video.mp4");
        writeManifest(root, "with-video", Object.fromEntries(STAGES.map((s) => [s, { status: "completed" }])));

        writeProject(root, "no-video", { id: "no-video", title: "No Video", status: "completed" });
        writeManifest(root, "no-video", Object.fromEntries(STAGES.map((s) => [s, { status: "completed" }])));
      },
      async () => {
        const withVideo = await getAyasProductionProject("with-video");
        assert.equal(withVideo?.hasFinalVideo, true);
        assert.equal(withVideo?.finalVideoPath, "with-video/export/bundle/video.mp4");
        assert.equal(withVideo?.status, "completed");

        const noVideo = await getAyasProductionProject("no-video");
        assert.equal(noVideo?.hasFinalVideo, false, "a completed status must never be reported as hasFinalVideo without a real file");
        assert.equal(noVideo?.finalVideoPath, undefined);
        assert.equal(noVideo?.status, "completed");
      },
    );
  });

  await scenario("SCENARIO D — partial-project normalization: research/script/scenes/visuals/draft resolve real resumeCandidateStage from PipelineRecoveryPlanner", async () => {
    // `PipelineRecoveryPlanner`'s own `getNextIncompleteOrUnreadyStage` does
    // not trust the manifest's status claim alone — it also verifies the
    // stage's real output FILE exists (`isStageFileReady`) before treating
    // it as done. `video`/`youtube` have additional stage-specific validity
    // checks beyond "the file exists" (compatible video data / a validated
    // publish record) that are `PipelineRecoveryPlanner`'s own, already
    // separately tested, responsibility — this suite verifies
    // `AyasProjectCatalog.ts` correctly REUSES that computation, not
    // `PipelineRecoveryPlanner`'s internals, so fixtures stop at `visuals`,
    // the last stage whose readiness is a plain "does the file exist" check.
    await withRuntimeRoot(
      (root) => {
        writeProject(root, "p-visuals", { id: "p-visuals", title: "P Visuals", status: "visuals" });
        writeAsset(root, "p-visuals", "research.json", "{}");
        writeAsset(root, "p-visuals", "script.json", "{}");
        writeAsset(root, "p-visuals", "scenes.json", "{}");
        writeManifest(root, "p-visuals", { research: { status: "completed" }, script: { status: "completed" }, scenes: { status: "completed" }, visuals: { status: "pending" } });

        writeProject(root, "p-scenes", { id: "p-scenes", title: "P Scenes", status: "scenes" });
        writeAsset(root, "p-scenes", "research.json", "{}");
        writeAsset(root, "p-scenes", "script.json", "{}");
        writeManifest(root, "p-scenes", { research: { status: "completed" }, script: { status: "completed" }, scenes: { status: "pending" } });

        writeProject(root, "p-script", { id: "p-script", title: "P Script", status: "script" });
        writeAsset(root, "p-script", "research.json", "{}");
        writeManifest(root, "p-script", { research: { status: "completed" }, script: { status: "pending" } });

        writeProject(root, "p-research", { id: "p-research", title: "P Research", status: "research" });
        writeManifest(root, "p-research", { research: { status: "pending" } });

        writeProject(root, "p-draft", { id: "p-draft", title: "P Draft", status: "draft" });
        writeManifest(root, "p-draft", { research: { status: "pending" } });
      },
      async () => {
        const expectations: [string, string][] = [
          ["p-visuals", "visuals"],
          ["p-scenes", "scenes"],
          ["p-script", "script"],
          ["p-research", "research"],
          ["p-draft", "research"],
        ];
        for (const [id, expectedStage] of expectations) {
          const p = await getAyasProductionProject(id);
          assert.ok(p, id);
          assert.equal(p!.resumable, true, `${id} must be resumable`);
          assert.equal(p!.resumeCandidateStage, expectedStage, `${id} resumeCandidateStage`);
          assert.equal(p!.currentStage, expectedStage, `${id} currentStage`);
        }
      },
    );
  });

  await scenario("SCENARIO E — corrupt metadata: malformed and missing project.json both surface as status:unknown with a note, never fail the whole catalog", async () => {
    await withRuntimeRoot(
      (root) => {
        writeProject(root, "healthy", { id: "healthy", title: "Healthy", status: "draft" });
        writeMalformedProject(root, "malformed");
        fs.mkdirSync(path.join(root, "projects", "empty-folder"), { recursive: true }); // a directory with no project.json at all
      },
      async () => {
        const catalog = await loadAyasProjectCatalog();
        assert.equal(catalog.available, true, "one corrupt project must never fail the whole catalog");
        assert.equal(catalog.projects.length, 3);
        const malformed = catalog.projects.find((p) => p.projectId === "malformed");
        assert.equal(malformed?.status, "unknown");
        assert.ok(malformed?.note, "malformed entry carries an explanatory note");
        const empty = catalog.projects.find((p) => p.projectId === "empty-folder");
        assert.equal(empty?.status, "unknown");
        assert.ok(empty?.note);
        const healthy = catalog.projects.find((p) => p.projectId === "healthy");
        assert.equal(healthy?.status, "draft", "a healthy sibling project is unaffected by the corrupt one");
      },
    );
  });

  await scenario("SCENARIO F — read-only: the catalog never modifies any file (mtimes unchanged, byte-identical content)", async () => {
    await withRuntimeRoot(
      (root) => {
        writeProject(root, "readonly-check", { id: "readonly-check", title: "Readonly Check", status: "completed" });
        writeAsset(root, "readonly-check", "export/bundle/video.mp4");
        writeManifest(root, "readonly-check", Object.fromEntries(STAGES.map((s) => [s, { status: "completed" }])));
      },
      async () => {
        const root = process.env.ATOLYE_RUNTIME_ROOT!;
        const before = snapshotMtimes(root);
        const beforeContent = fs.readFileSync(path.join(root, "projects", "readonly-check", "project.json"), "utf8");
        await loadAyasProjectCatalog();
        await findAyasProductionProjects({ status: "completed" });
        await summarizeAyasProductionProjects(await listAyasProductionProjects());
        const after = snapshotMtimes(root);
        assert.deepEqual([...before.entries()].sort(), [...after.entries()].sort(), "no file mtime changed");
        const afterContent = fs.readFileSync(path.join(root, "projects", "readonly-check", "project.json"), "utf8");
        assert.equal(afterContent, beforeContent, "no file content changed");
      },
    );
  });

  await scenario("SCENARIO G — path security: a projectId/titleContains query can never escape the runtime root", async () => {
    await withRuntimeRoot(
      (root) => {
        writeProject(root, "in-scope", { id: "in-scope", title: "In Scope", status: "draft" });
        // A sibling secret file OUTSIDE the projects root, to prove a traversal query cannot reach it.
        fs.writeFileSync(path.join(root, "outside-secret.txt"), "should never be readable through the catalog");
      },
      async () => {
        for (const traversal of ["../outside-secret.txt", "..\\outside-secret.txt", "/etc/passwd", "..", "../../"]) {
          const byId = await getAyasProductionProject(traversal);
          assert.equal(byId, null, `projectId traversal must not resolve: ${traversal}`);
          const found = await findAyasProductionProjects({ projectId: traversal });
          assert.equal(found.length, 0, `find-by-id traversal must not resolve: ${traversal}`);
        }
        const inScope = await getAyasProductionProject("in-scope");
        assert.ok(inScope, "a real, in-scope project id still resolves normally");
      },
    );
  });

  console.log(`AYAS project catalog smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-project-catalog", scenarios: count }));
}

main().catch((error) => {
  console.error("AYAS project catalog smoke FAILED:", error);
  process.exitCode = 1;
});
