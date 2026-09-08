/**
 * C.2B.8 — External Runtime Evidence Model.
 *
 * Pins the "byte / manifest authority is the gate; git HEAD/index is opt-in
 * informational repository evidence, never a live-freshness source" contract
 * (audit items B1 / C1 / PR2 / V1). Deterministic, $0, no network — a synthetic
 * git repo under an OS temp dir; the real repository is never touched.
 *
 * Run: npx tsx scripts/smoke-c2b8-evidence-model.ts
 */

import assert from "node:assert/strict";
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
import { verifyRuntimeBackup, verifyRuntimeTreeAgainstManifest } from "../src/lib/runtime/backup/RuntimeBackupVerifier";
import { preflightRuntimeMigrationExternalSource } from "../src/lib/runtime/migration/RuntimeMigrationExternalSourcePreflight";
import { RuntimeMigrationCandidateError } from "../src/lib/runtime/migration/RuntimeMigrationCandidateError";

const REPO = path.resolve(__dirname, "..");
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "c2b8-"));
const STAMP = "2026-07-16T12:00:00.000Z";
let count = 0;

async function scenario(name: string, run: () => unknown | Promise<unknown>) {
  await run();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}
function git(cwd: string, ...a: string[]): string {
  return execFileSync("git", a, { cwd, encoding: "utf8" });
}

async function main() {
  try {
    const repo = path.join(SANDBOX, "repo");
    const runtimeRoot = path.join(repo, "data");
    const projects = path.join(runtimeRoot, "projects");
    fs.mkdirSync(path.join(projects, "alpha", "production-execution"), { recursive: true });
    fs.mkdirSync(path.join(projects, "beta"), { recursive: true });
    fs.writeFileSync(path.join(projects, "alpha", "project.json"), '{"slug":"alpha"}\n');
    fs.writeFileSync(path.join(projects, "alpha", "production-execution", "a.json"), '{"s":"ok"}\n');
    fs.writeFileSync(path.join(projects, "beta", "project.json"), '{"slug":"beta"}\n');
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "f@e.invalid");
    git(repo, "config", "user.name", "F");
    git(repo, "config", "core.autocrlf", "false");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "seed");

    const context = createRuntimeStorageContext({
      workspaceRoot: repo, environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
      authorityRoot: path.join(SANDBOX, "auth"),
    });

    /* ---------------- B1 — byte authority == with or without git ------- */

    await scenario("B1: git metadata is opt-in and purely additive — byte authority is identical", () => {
      const withGit = collectRuntimeBackupInventory({ context, repositoryRoot: repo, now: () => STAMP });
      const noGit = collectRuntimeBackupInventory({ context, now: () => STAMP });
      assert.equal(withGit.aggregateFingerprint, noGit.aggregateFingerprint, "aggregate identical");
      assert.equal(withGit.inventory.files, noGit.inventory.files);
      assert.equal(withGit.inventory.bytes, noGit.inventory.bytes);
      assert.equal(withGit.files.some((f) => f.git !== undefined), true, "with repo: git fields present");
      assert.equal(noGit.files.some((f) => f.git !== undefined), false, "without repo: NO git fields");
      // the tree-identity used by every verifier strips git
      const stripped = (f: { relativePath: string; sizeBytes: number; sha256: string }) =>
        `${f.relativePath}\0${f.sizeBytes}\0${f.sha256}`;
      assert.deepEqual(withGit.files.map(stripped).sort(), noGit.files.map(stripped).sort());
    });

    await scenario("B1: verifyRuntimeTreeAgainstManifest passes on a tree with NO git metadata", () => {
      const manifest = collectRuntimeBackupInventory({ context, now: () => STAMP }); // no repositoryRoot
      assert.doesNotThrow(() => verifyRuntimeTreeAgainstManifest(projects, manifest));
      // and a byte mutation still fails it
      fs.appendFileSync(path.join(projects, "beta", "project.json"), " ");
      assert.throws(() => verifyRuntimeTreeAgainstManifest(projects, manifest), /verification failed/);
      fs.writeFileSync(path.join(projects, "beta", "project.json"), '{"slug":"beta"}\n'); // restore
    });

    /* ---------------- C1 — external-source preflight ------------------- */

    await scenario("C1: preflightRuntimeMigrationExternalSource splits filesystem vs repository cleanliness", () => {
      const backupRoot = path.join(SANDBOX, "bk");
      const backupDirectory = path.join(backupRoot, "b1");
      const m = collectRuntimeBackupInventory({ context, now: () => STAMP });
      const byId = new Map<string, string>();
      for (const f of m.files) { const id = f.relativePath.split("/")[0]; if (!byId.has(id)) byId.set(id, f.projectSlug ?? id); }
      for (const [id, slug] of byId) {
        fs.mkdirSync(path.join(backupDirectory, "payload", "projects", id), { recursive: true });
        fs.cpSync(path.join(projects, slug), path.join(backupDirectory, "payload", "projects", id), { recursive: true });
      }
      const s = serializeRuntimeBackupManifest(m);
      fs.writeFileSync(path.join(backupDirectory, "manifest.json"), s, { flag: "wx" });
      fs.writeFileSync(path.join(backupDirectory, "manifest.sha256"), `${runtimeBackupManifestSha256(s)}\n`, { flag: "wx" });
      verifyRuntimeBackup(backupDirectory);

      const noEvidence = preflightRuntimeMigrationExternalSource({ sourceContext: context, backupDirectory, now: () => STAMP });
      assert.equal(noEvidence.repositoryCleanliness, "not-applicable");
      assert.equal(noEvidence.filesystemSourceClean, true);
      assert.equal(noEvidence.cutoverAuthorized, false);

      const withEvidence = preflightRuntimeMigrationExternalSource({
        sourceContext: context, backupDirectory, now: () => STAMP,
        repositoryGitEvidence: { repositoryRoot: repo, projectsPathspec: "data/projects" },
      });
      assert.equal(withEvidence.repositoryCleanliness, "clean");

      // filesystem drift fails it — NOT a git decision
      fs.writeFileSync(path.join(projects, "alpha", "EXTRA.json"), "{}");
      assert.throws(() => preflightRuntimeMigrationExternalSource({ sourceContext: context, backupDirectory, now: () => STAMP }),
        (e: unknown) => e instanceof RuntimeMigrationCandidateError && e.code === "SOURCE_STALE");
      fs.rmSync(path.join(projects, "alpha", "EXTRA.json"));
    });

    /* ---------------- PR2 — portable storage fingerprint -------------- */

    await scenario("PR2: the acceptance STORAGE_IDENTITY fingerprint carries no host / physical path", () => {
      const src = fs.readFileSync(path.join(REPO, "src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts"), "utf8");
      const at = src.indexOf('componentFingerprint("STORAGE_IDENTITY"');
      assert.ok(at !== -1, "STORAGE_IDENTITY fingerprint construction present");
      const block = src.slice(at, at + 400);
      assert.match(block, /projectRoot: `data\/projects\/\$\{projectSlug\}`/, "projectRoot is the logical data/projects/<slug>");
      assert.ok(
        !/ATOLYE_RUNTIME_ROOT|process\.cwd|__dirname|[A-Za-z]:[\\/]/.test(block),
        "no physical path / env root in the fingerprint",
      );
    });

    /* ---------------- V1 — data/visuals is out of scope -------------- */

    await scenario("V1: data/visuals is not a production input — dead projects/VisualManager, 0 importers", () => {
      let importers = "";
      try {
        importers = execFileSync("git", ["grep", "-l", "-F", "projects/VisualManager", "--", "src", "app"], {
          cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      } catch (error) {
        // `git grep -l` exits 1 (no stdout) when there is no match — the good case.
        if ((error as { status?: number }).status !== 1) throw error;
      }
      assert.equal(importers, "", `dead projects/VisualManager must have 0 importers: ${importers}`);
      // and the physical dir the dead module targets does not exist / is not a production path
      assert.equal(fs.existsSync(path.join(REPO, "data/visuals")), false, "data/visuals must not exist");
    });

    console.log(`C.2B.8 evidence model: PASS (${count} scenarios)`);
    console.log(JSON.stringify({ status: "PASS", suite: "c2b8-evidence-model", scenarios: count }));
  } finally {
    await fsp.rm(SANDBOX, { recursive: true, force: true }).catch(() => {});
  }
}

void (async () => {
  try { await main(); }
  catch (error) { console.error("C.2B.8 evidence model FAILED:", error); process.exitCode = 1; }
})();
