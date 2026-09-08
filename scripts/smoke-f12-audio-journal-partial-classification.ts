/**
 * F12 — audio-compensation journal-staging `.partial` classification in the
 * runtime backup inventory.
 *
 * Sprint 194 Phase 0 found that `collectRuntimeBackupInventory` throws
 * `RuntimeMutationError` on the real `data/projects` tree: 27 crash-atomic
 * `.audio-journal-staging/*.partial` files (97–108 char names, over the 96-char
 * portable file-name ceiling) were NOT excluded because
 * `isAudioCompensationJournalStagingPartialAtProjectPath` only matched the
 * legacy `audio-compensation-cleanup/<ref>/.audio-journal-staging/` layout and
 * never the `audio-compensation-recovery` tree.
 *
 * This suite pins the fix by ACTUALLY RUNNING `collectRuntimeBackupInventory`
 * against a fixture that reproduces the real on-disk layout (both the direct
 * `.audio-journal-staging/` form and the legacy `<ref>/` form, for cleanup and
 * recovery), with real-length 108-char `.partial` names.
 *
 * Deterministic / no network / $0. Everything under an OS temp dir — the
 * repository `data/projects/**` and `.env.local` are never touched.
 *
 * Run: npx tsx scripts/smoke-f12-audio-journal-partial-classification.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { isAudioCompensationJournalStagingPartialAtProjectPath } from "../src/lib/audio/AudioCompensationStore";
import { collectRuntimeBackupInventory } from "../src/lib/runtime/backup/RuntimeBackupInventory";

const REPO = path.resolve(__dirname, "..");

let count = 0;
async function scenario(name: string, run: () => unknown | Promise<unknown>) {
  await run();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function gitStatus(): string {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: REPO,
    encoding: "utf8",
  });
}

// A real 108-char basename straight off the blocked production tree.
const REAL_CLEANUP_PARTIAL =
  "retirement-audio-comp-01a13367-981a-43a0-a68e-8bbd338b7eaa.json.595d824a-a8e7-4f19-9f90-b6a0b6b71cbf.partial";
// A real 97-char basename from the recovery tree.
const REAL_RECOVERY_PARTIAL =
  "audio-comp-01a13367-981a-43a0-a68e-8bbd338b7eaa.json.127ca909-ec58-4edb-b213-718e8b4aaaff.partial";
const REF = "audio-comp-11111111-2222-4333-8444-555555555555";

async function main() {
  const gitBefore = gitStatus();
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-f12-"));

  try {
    /* ============================================ helper — positives ==== */

    await scenario("helper: real layout (no <ref>) — cleanup + recovery + record/ variants", () => {
      const slug = "proj";
      const cases = [
        `${slug}/production-execution/audio-compensation-cleanup/.audio-journal-staging/${REAL_CLEANUP_PARTIAL}`,
        `${slug}/production-execution/audio-compensation-recovery/.audio-journal-staging/${REAL_RECOVERY_PARTIAL}`,
        `${slug}/production-execution/audio-compensation-cleanup/record/.audio-journal-staging/publication.json.${REF}.partial`,
        `${slug}/production-execution/audio-compensation-recovery/record/.audio-journal-staging/workspace.json.${REF}.partial`,
        // no project slug prefix (the completed-stage regeneration planner passes this shape)
        `production-execution/audio-compensation-cleanup/.audio-journal-staging/${REAL_CLEANUP_PARTIAL}`,
        `production-execution/audio-compensation-recovery/.audio-journal-staging/${REAL_RECOVERY_PARTIAL}`,
      ];
      for (const p of cases) {
        assert.equal(isAudioCompensationJournalStagingPartialAtProjectPath(p), true, p);
      }
    });

    await scenario("helper: legacy layout (with <ref>) still classified — cleanup + recovery", () => {
      const slug = "proj";
      const cases = [
        `${slug}/production-execution/audio-compensation-cleanup/${REF}/.audio-journal-staging/workspace.json.${REF}.partial`,
        `${slug}/production-execution/audio-compensation-recovery/${REF}/.audio-journal-staging/workspace.json.${REF}.partial`,
        `${slug}/production-execution/audio-compensation-cleanup/${REF}/record/.audio-journal-staging/publication.json.${REF}.partial`,
      ];
      for (const p of cases) {
        assert.equal(isAudioCompensationJournalStagingPartialAtProjectPath(p), true, p);
      }
    });

    /* ============================================ helper — negatives ==== */

    await scenario("helper: negatives — nothing outside the genuine staging-partial shape is excluded", () => {
      const slug = "proj";
      const negatives: [string, string][] = [
        [`${slug}/production-execution/audio-compensation-cleanup/${REF}/.audio-journal-staging/receipt.json`,
          "non-.partial file inside the staging dir"],
        [`${slug}/production-execution/audio-compensation-cleanup/${REF}/record/receipt.json`,
          "durable record, not staging"],
        [`${slug}/production-execution/audio-compensation-cleanup/thing.partial`,
          ".partial directly under cleanup, no staging dir"],
        [`${slug}/production-execution/audio-compensation-recovery/thing.partial`,
          ".partial directly under recovery, no staging dir"],
        [`${slug}/production-execution/some-other-directory/${REF}/.audio-journal-staging/x.partial`,
          "staging-shaped, but wrong parent directory"],
        [`${slug}/assets/audio/normal-thing.partial`,
          "a plain .partial elsewhere in the project"],
        [`${slug}/audio-compensation-cleanup/.audio-journal-staging/${REAL_CLEANUP_PARTIAL}`,
          "not anchored under production-execution"],
        [`${slug}/production-execution/audio-compensation-cleanup/a/b/.audio-journal-staging/x.partial`,
          "two directory levels before the staging dir (only one <ref> is optional)"],
      ];
      for (const [p, why] of negatives) {
        assert.equal(isAudioCompensationJournalStagingPartialAtProjectPath(p), false, why);
      }
    });

    /* =============================== inventory — EXECUTED against fixture */

    await scenario("collectRuntimeBackupInventory completes and excludes the staging partials (real layout)", () => {
      const repo = path.join(tmp, "inv", "repo");
      const projectsRoot = path.join(repo, "data", "projects");
      const slug = "f12-fixture-project";
      const proj = path.join(projectsRoot, slug);

      const write = (rel: string, body = "{}") => {
        const abs = path.join(proj, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body);
        return `${slug}/${rel.split(path.sep).join("/")}`;
      };

      write("project.json", JSON.stringify({ slug }));
      write("manifest.json", JSON.stringify({ version: 1 }));
      const durable = write("production-execution/attempts/attempt-1.json");
      const normalPartial = write("assets/audio/normal-thing.partial", "x");

      // the F12 repro — real layout, no <ref>, 97–108 char names, both trees
      const stagingPartials = [
        write(`production-execution/audio-compensation-cleanup/.audio-journal-staging/${REAL_CLEANUP_PARTIAL}`, "x"),
        write(`production-execution/audio-compensation-recovery/.audio-journal-staging/${REAL_RECOVERY_PARTIAL}`, "x"),
        // and the legacy <ref> layout, to prove both still resolve
        write(`production-execution/audio-compensation-cleanup/${REF}/.audio-journal-staging/workspace.json.${REF}.partial`, "x"),
        write(`production-execution/audio-compensation-recovery/${REF}/record/.audio-journal-staging/publication.json.${REF}.partial`, "x"),
      ];

      const context = createRuntimeStorageContext({
        workspaceRoot: repo,
        environment: { ATOLYE_RUNTIME_ROOT: path.join(repo, "data") },
        authorityRoot: path.join(tmp, "inv", "authority"),
      });

      const manifest = collectRuntimeBackupInventory({
        context,
        now: () => "2026-09-08T00:00:00.000Z",
      });

      const paths = new Set(
        manifest.files.map((f) => f.relativePath.split("/").slice(1).join("/")),
      );
      const rel = (full: string) => full.split("/").slice(1).join("/");

      // the four journal-staging partials are gone
      for (const p of stagingPartials) {
        assert.equal(paths.has(rel(p)), false, `should be excluded: ${p}`);
      }
      // the durable record and the unrelated .partial survived
      assert.equal(paths.has(rel(durable)), true, "durable attempt record must be inventoried");
      assert.equal(paths.has(rel(normalPartial)), true,
        "a plain .partial that is not audio journal staging must NOT be auto-excluded");
      // inventory totals: 4 kept (project.json, manifest.json, attempt-1.json, normal-thing.partial)
      assert.equal(manifest.files.length, 4, JSON.stringify([...paths]));
    });

    await scenario("inventory throws on a genuinely over-length non-excludable name (no false all-clear)", () => {
      const repo = path.join(tmp, "invneg", "repo");
      const slug = "f12-neg";
      const proj = path.join(repo, "data", "projects", slug);
      fs.mkdirSync(path.join(proj, "assets", "audio"), { recursive: true });
      fs.writeFileSync(path.join(proj, "project.json"), JSON.stringify({ slug }));
      // a normal (non-staging) asset whose name really does exceed the ceiling
      fs.writeFileSync(
        path.join(proj, "assets", "audio", `mix-${"a".repeat(120)}.wav`),
        "x",
      );
      const context = createRuntimeStorageContext({
        workspaceRoot: repo,
        environment: { ATOLYE_RUNTIME_ROOT: path.join(repo, "data") },
        authorityRoot: path.join(tmp, "invneg", "authority"),
      });
      assert.throws(
        () => collectRuntimeBackupInventory({ context, now: () => "2026-09-08T00:00:00.000Z" }),
        /Runtime mutation path is invalid|Runtime backup/,
      );
    });

    /* ================================================ data safety ======= */

    await scenario("git working tree unchanged; no data/projects or .env.local touched", () => {
      assert.equal(gitStatus(), gitBefore);
    });

    console.log(`F12 audio journal partial classification: PASS (${count} scenarios)`);
    console.log(JSON.stringify({ status: "PASS", suite: "f12-audio-journal-partial-classification", scenarios: count }));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error("F12 audio journal partial classification FAILED:", error);
    process.exitCode = 1;
  }
})();
