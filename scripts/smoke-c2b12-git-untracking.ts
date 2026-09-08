/**
 * C.2B.12 — controlled runtime git untracking.
 *
 * On a synthetic temp repo (the real repository `data/projects/**` and
 * `.env.local` are never touched): `git rm -r --cached data/projects` +
 * a `/data/projects/` ignore rule removes the tree from the index only, leaves
 * every file on disk, keeps `data/brain` tracked, and prevents re-add. Then the
 * C1 external-source preflight is exercised against the now-untracked tree:
 * repository cleanliness reports `not-applicable`, filesystem cleanliness is a
 * separate check against the verified backup, and `collectRuntimeBackupInventory`
 * still runs.
 *
 * Run: npx tsx scripts/smoke-c2b12-git-untracking.ts
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { collectRuntimeBackupInventory } from "../src/lib/runtime/backup/RuntimeBackupInventory";
import {
  runtimeBackupManifestSha256,
  serializeRuntimeBackupManifest,
} from "../src/lib/runtime/backup/RuntimeBackupManifest";
import { verifyRuntimeBackup } from "../src/lib/runtime/backup/RuntimeBackupVerifier";
import { preflightRuntimeMigrationExternalSource } from "../src/lib/runtime/migration/RuntimeMigrationExternalSourcePreflight";
import { assertMigrationConsumeRootsDisjoint } from "../src/lib/runtime/security/RuntimeProtectedRoots";
import { RuntimeMigrationCandidateError } from "../src/lib/runtime/migration/RuntimeMigrationCandidateError";

const REPO = path.resolve(__dirname, "..");
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "c2b12-"));
const STAMP = "2026-07-16T12:00:00.000Z";
let count = 0;

async function scenario(name: string, run: () => unknown | Promise<unknown>) {
  await run();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}
function gitStatus(): string {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: REPO, encoding: "utf8" });
}
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}
function treeDigest(root: string): { files: number; bytes: number; digest: string } {
  const lines: string[] = [];
  let bytes = 0;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const full = path.join(dir, e.name);
      if (e.name === ".git") continue;
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.isFile()) continue;
      const buf = fs.readFileSync(full);
      bytes += buf.length;
      lines.push(`${path.relative(root, full).split(path.sep).join("/")}\0${createHash("sha256").update(buf).digest("hex")}`);
    }
  };
  walk(root);
  lines.sort();
  return { files: lines.length, bytes, digest: createHash("sha256").update(lines.join("\n")).digest("hex") };
}

async function main() {
  const gitBefore = gitStatus();
  try {
    /* -------------------- fixture: a tracked data/projects tree -------- */

    const repo = path.join(SANDBOX, "repo");
    const projects = path.join(repo, "data", "projects");
    const brain = path.join(repo, "data", "brain");
    fs.mkdirSync(path.join(projects, "alpha", "production-execution"), { recursive: true });
    fs.mkdirSync(path.join(projects, "beta"), { recursive: true });
    fs.mkdirSync(brain, { recursive: true });
    const w = (p: string, v: string) => fs.writeFileSync(p, v);
    w(path.join(projects, "alpha", "project.json"), '{"slug":"alpha"}\n');
    w(path.join(projects, "alpha", "production-execution", "a.json"), '{"state":"ok"}\n');
    w(path.join(projects, "beta", "project.json"), '{"slug":"beta"}\n');
    w(path.join(brain, "README.md"), "# brain\n");
    w(path.join(repo, ".gitignore"), "/data/brain/queue/\n");
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "f@e.invalid");
    git(repo, "config", "user.name", "F");
    git(repo, "config", "core.autocrlf", "false");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "seed");

    const before = treeDigest(projects);

    await scenario("git rm -r --cached data/projects — index only, disk preserved", () => {
      const trackedBefore = git(repo, "ls-files", "data/projects").trim().split("\n").filter(Boolean).length;
      assert.equal(trackedBefore, 3);
      git(repo, "rm", "-r", "--cached", "--", "data/projects");
      // add the narrow ignore rule
      fs.appendFileSync(path.join(repo, ".gitignore"),
        "\n# C.2B.12 — data/projects is external-runtime authority data.\n/data/projects/\n");
      git(repo, "add", ".gitignore");
      git(repo, "commit", "-qm", "C.2B.12 untrack data/projects");

      assert.equal(git(repo, "ls-files", "data/projects").trim(), "");
      assert.equal(git(repo, "status", "--porcelain").trim(), "", "working tree clean after commit");
      const after = treeDigest(projects);
      assert.deepEqual(after, before, "data/projects byte-identical on disk");
    });

    await scenario("data/brain stays tracked and is NOT ignored", () => {
      assert.equal(git(repo, "ls-files", "data/brain").trim(), "data/brain/README.md");
      assert.throws(() => git(repo, "check-ignore", "-v", "--", "data/brain/README.md"),
        (e: unknown) => e instanceof Error); // non-zero exit = not ignored
    });

    await scenario("re-add protection: untracked list is clean, real files are ignored", () => {
      const untracked = git(repo, "status", "--porcelain", "--untracked-files=all")
        .split("\n").filter((l) => l.startsWith("?? ") && l.includes("data/projects"));
      assert.equal(untracked.length, 0);
      const hit = git(repo, "check-ignore", "-v", "--", "data/projects/alpha/project.json").trim();
      assert.match(hit, /\.gitignore:\d+:\/data\/projects\/\s/);
      // a specific file re-add still needs -f
      assert.throws(() => git(repo, "add", "data/projects/beta/project.json"),
        (e: unknown) => e instanceof Error && /ignored/i.test(String(e)));
    });

    /* ------------------ C1: preflight against the untracked source ---- */

    await scenario("preflightRuntimeMigrationExternalSource — repository cleanliness = not-applicable", () => {
      const runtimeRoot = path.join(repo, "data");
      const authorityRoot = path.join(SANDBOX, "authority");
      const backupRoot = path.join(SANDBOX, "backup-root");
      const backupDirectory = path.join(backupRoot, "b1");
      fs.mkdirSync(authorityRoot, { recursive: true });
      const context = createRuntimeStorageContext({
        workspaceRoot: repo, environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot }, authorityRoot,
      });
      const manifest = collectRuntimeBackupInventory({ context, now: () => STAMP });
      const byId = new Map<string, string>();
      for (const f of manifest.files) {
        const id = f.relativePath.split("/")[0];
        if (!byId.has(id)) byId.set(id, f.projectSlug ?? id);
      }
      for (const [id, slug] of byId) {
        fs.mkdirSync(path.join(backupDirectory, "payload", "projects", id), { recursive: true });
        fs.cpSync(path.join(projects, slug), path.join(backupDirectory, "payload", "projects", id), { recursive: true });
      }
      const serialized = serializeRuntimeBackupManifest(manifest);
      fs.writeFileSync(path.join(backupDirectory, "manifest.json"), serialized, { flag: "wx" });
      fs.writeFileSync(path.join(backupDirectory, "manifest.sha256"), `${runtimeBackupManifestSha256(serialized)}\n`, { flag: "wx" });
      verifyRuntimeBackup(backupDirectory);

      const report = preflightRuntimeMigrationExternalSource({ sourceContext: context, backupDirectory, now: () => STAMP });
      assert.equal(report.status, "external-source-preflight-ready");
      assert.equal(report.repositoryCleanliness, "not-applicable");
      assert.equal(report.filesystemSourceClean, true);
      assert.equal(report.cutoverAuthorized, false);

      // mutate the untracked source → filesystem cleanliness fails (NOT git)
      fs.appendFileSync(path.join(projects, "alpha", "project.json"), " ");
      assert.throws(() => preflightRuntimeMigrationExternalSource({ sourceContext: context, backupDirectory, now: () => STAMP }),
        (e: unknown) => e instanceof RuntimeMigrationCandidateError && e.code === "SOURCE_STALE");
    });

    /* --------------------------- protected roots --------------------- */

    await scenario("protected-root disjointness still holds for the untracked source", () => {
      assert.doesNotThrow(() => assertMigrationConsumeRootsDisjoint({
        liveProjects: projects,
        candidate: path.join(SANDBOX, "cand"),
        relocationTarget: path.join(SANDBOX, "target"),
        backup: path.join(SANDBOX, "backup-root"),
      }));
      assert.throws(() => assertMigrationConsumeRootsDisjoint({
        liveProjects: projects, candidate: projects, relocationTarget: path.join(SANDBOX, "target"),
      }), (e: unknown) => e instanceof Error);
    });

    await scenario("static: no runtime-authority code discovers authority via git / .git / ls-files", () => {
      const forbidden = /\bgit ls-files\b|\.git[\\/]index|execFileSync\(\s*["']git["']|spawnSync\(\s*["']git["']/;
      for (const rel of [
        "src/lib/runtime/RuntimeStoragePaths.ts",
        "src/lib/runtime/ProductionRuntimeCompositionRoot.ts",
        "src/lib/runtime/security/ProductionRuntimeAuthorityGenerationEnforcement.ts",
        "src/lib/runtime/security/RuntimeAuthorityTransition.ts",
        "src/lib/runtime/security/RuntimeAuthorityTransitionCoordinator.ts",
        "src/lib/runtime/security/RuntimeAuthorityRollback.ts",
        "src/lib/runtime/security/RuntimeAuthorityOldRootQuarantine.ts",
      ]) {
        assert.ok(!forbidden.test(fs.readFileSync(path.join(REPO, rel), "utf8")), `${rel} touches git`);
      }
    });

    await scenario("git working tree unchanged; no data/projects or .env.local touched", () => {
      assert.equal(gitStatus(), gitBefore);
    });

    console.log(`C.2B.12 git untracking: PASS (${count} scenarios)`);
    console.log(JSON.stringify({ status: "PASS", suite: "c2b12-git-untracking", scenarios: count }));
  } finally {
    await fsp.rm(SANDBOX, { recursive: true, force: true }).catch(() => {});
  }
}

void (async () => {
  try { await main(); }
  catch (error) { console.error("C.2B.12 git untracking FAILED:", error); process.exitCode = 1; }
})();
