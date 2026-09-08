/**
 * External runtime root — real project lifecycle (Master Sprint §7 / §30).
 *
 * Points the whole app at a temporary `ATOLYE_RUNTIME_ROOT`, runs a real
 * project through creation → research → script → scenes → visuals → an image
 * asset → manifest read-back using the ACTUAL `ProjectManager` / `ProjectWriter`
 * / `ImageStorage` code paths (no mocks of the storage layer), and proves:
 *
 *   - every file lands under the external runtime root;
 *   - nothing is written under the repository `data/projects/`;
 *   - `git status --porcelain` is byte-identical before and after.
 *
 * Run: npx tsx scripts/smoke-external-runtime-root-project-lifecycle.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let count = 0;
async function scenario(name: string, run: () => unknown | Promise<unknown>) {
  await run();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function gitStatus(): string {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

async function main() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-extroot-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const runtimeRoot = path.join(tempRoot, "runtime");
  await fsp.mkdir(workspaceRoot, { recursive: true });
  await fsp.mkdir(runtimeRoot, { recursive: true });

  const previousEnv = {
    root: process.env.ATOLYE_RUNTIME_ROOT,
    workspace: process.env.ATOLYE_WORKSPACE_ROOT,
    authority: process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT,
  };
  process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
  process.env.ATOLYE_WORKSPACE_ROOT = workspaceRoot;
  process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = path.join(tempRoot, "authority");

  const gitBefore = gitStatus();

  try {
    const { ProjectManager } = await import("../src/lib/projects/ProjectManager");
    const { ProjectReader } = await import("../src/lib/projects/ProjectReader");
    const { ImageStorage } = await import("../src/lib/assets/storage/ImageStorage");

    const project = await ProjectManager.createProject(
      "External Root Test Belgeseli 2026",
      "Storage authority acceptance run",
    );
    const slug = project.slug;
    const projectDir = path.join(runtimeRoot, "projects", slug);

    await scenario("project creation writes project.json + manifest.json to the external root", () => {
      assert.ok(fs.existsSync(path.join(projectDir, "project.json")));
      assert.ok(fs.existsSync(path.join(projectDir, "manifest.json")));
    });

    await scenario("research → script → scenes → visuals persist under the external root", async () => {
      await ProjectManager.saveResearch(slug, { topic: project.title, sources: ["a", "b"] });
      await ProjectManager.saveScript(slug, { acts: [{ id: 1, text: "..." }] });
      await ProjectManager.saveScenes(slug, { scenes: [{ id: "s1", prompt: "..." }] });
      await ProjectManager.saveVisuals(slug, { assets: [] });
      for (const name of ["research.json", "script.json", "scenes.json", "visuals.json"]) {
        assert.ok(fs.existsSync(path.join(projectDir, name)), `${name} missing`);
      }
    });

    await scenario("an image asset is stored + served through ImageStorage under the external root", () => {
      const saved = ImageStorage.saveImage({
        projectSlug: slug,
        data: PNG_1X1,
        assetId: "acceptance-shot",
        mimeType: "image/png",
      });
      const abs = path.join(projectDir, "assets", "images", saved.fileName);
      assert.ok(fs.existsSync(abs));
      const served = ImageStorage.readImage(slug, saved.fileName);
      assert.ok(served.data.equals(PNG_1X1));
      assert.equal(saved.url, `/api/assets/images/${slug}/${saved.fileName}`);
    });

    await scenario("manifest reads back through the real ProjectManager path", async () => {
      const manifest = await ProjectManager.getManifest(slug);
      assert.ok(manifest);
      const stored = await ProjectReader.readJSON<{ slug: string }>(slug, "project.json");
      assert.equal(stored?.slug, slug);
    });

    await scenario("nothing was written under the repository data/projects/", () => {
      assert.equal(fs.existsSync(path.join(REPO_ROOT, "data", "projects", slug)), false);
    });

    await scenario("nothing was written under the temp workspace data/projects/", () => {
      const legacy = path.join(workspaceRoot, "data", "projects");
      const present = fs.existsSync(legacy)
        ? fs.readdirSync(legacy)
        : [];
      assert.deepEqual(present, [], `unexpected legacy-root writes: ${present.join(", ")}`);
    });

    await scenario("git status --porcelain --untracked-files=all is unchanged", () => {
      assert.equal(gitStatus(), gitBefore, "the working tree changed during the external-root run");
    });

    console.log(`External runtime root project lifecycle: PASS (${count} scenarios)`);
    console.log(
      JSON.stringify({
        status: "PASS",
        suite: "external-runtime-root-project-lifecycle",
        scenarios: count,
        runtimeRoot,
      }),
    );
  } finally {
    restore("ATOLYE_RUNTIME_ROOT", previousEnv.root);
    restore("ATOLYE_WORKSPACE_ROOT", previousEnv.workspace);
    restore("ATOLYE_RUNTIME_AUTHORITY_ROOT", previousEnv.authority);
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error("External runtime root project lifecycle FAILED:", error);
    process.exitCode = 1;
  }
})();
