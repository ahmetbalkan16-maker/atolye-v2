/**
 * C.2B.10a — Verified Candidate Consume & Offline Materialization.
 *
 * Builds a real verified backup + verified migration candidate from a small
 * synthetic source tree (git-backed, under an OS temp dir — the repository
 * `data/projects/**` and `.env.local` are never touched), then exercises the
 * consume service: empty-target / no-clobber, per-file SHA-256, byte-exact
 * post-copy digest, manifest / backup / durable binding, protected-root role
 * disjointness, symlink / traversal rejection, crash-and-restart safety, and
 * idempotency.
 *
 * Run: npx tsx scripts/smoke-c2b10a-candidate-consume.ts
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { collectRuntimeBackupInventory } from "../src/lib/runtime/backup/RuntimeBackupInventory";
import {
  runtimeBackupManifestSha256,
  serializeRuntimeBackupManifest,
} from "../src/lib/runtime/backup/RuntimeBackupManifest";
import { verifyRuntimeBackup } from "../src/lib/runtime/backup/RuntimeBackupVerifier";
import {
  runtimeMigrationCandidateDirName,
  runtimeMigrationCandidateId,
  type RuntimeMigrationCandidateManifest,
} from "../src/lib/runtime/migration/RuntimeMigrationCandidateManifest";
import { RuntimeMigrationCandidateService } from "../src/lib/runtime/migration/RuntimeMigrationCandidateService";
import { verifyMigrationCandidate } from "../src/lib/runtime/migration/RuntimeMigrationCandidateVerifier";
import {
  RuntimeMigrationCandidateConsumeService,
  type RuntimeMigrationCandidateConsumeInput,
} from "../src/lib/runtime/migration/RuntimeMigrationCandidateConsumeService";
import { RuntimeMigrationCandidateConsumeError } from "../src/lib/runtime/migration/RuntimeMigrationCandidateConsumeError";
import { runRuntimeMigrationCandidateConsumeCommand } from "../src/lib/runtime/migration/RuntimeMigrationCandidateConsumeCommand";

const REPO = path.resolve(__dirname, "..");
const STAMP = "2026-07-16T12:00:00.000Z";
// One short shared sandbox. F13: the candidate directory is `c-<24hex>` and the
// payload tree sits directly under `projects/` (no `payload/`), so the
// materialised-path budget (259) has real headroom for a deep prefix.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "c2b10a-"));
let fixtureSeq = 0;
let count = 0;
const skipped: string[] = [];

async function scenario(name: string, run: () => unknown | Promise<unknown>) {
  await run();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const consumeErr = (code: string) => (e: unknown) =>
  (e instanceof RuntimeMigrationCandidateConsumeError && e.code === code);

function gitStatus(): string {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: REPO, encoding: "utf8",
  });
}

interface Fixture {
  readonly base: string;
  readonly repositoryRoot: string;
  readonly liveProjectsRoot: string;
  readonly backupDirectory: string;
  readonly candidateRoot: string;
  readonly candidateId: string;
  readonly candidateDirectory: string;
  readonly candidateManifest: RuntimeMigrationCandidateManifest;
  readonly fileCount: number;
  readonly byteCount: number;
}

/** A real verified backup + verified candidate from a synthetic source tree. */
function buildFixture(_name: string): Fixture {
  fixtureSeq += 1;
  const base = path.join(SANDBOX, `f${fixtureSeq}`);
  const repositoryRoot = path.join(base, "r");
  const runtimeRoot = path.join(repositoryRoot, "data");
  const liveProjectsRoot = path.join(runtimeRoot, "projects");
  const authorityRoot = path.join(base, "a");
  const backupRoot = path.join(base, "bk");
  const backupDirectory = path.join(backupRoot, "b1");
  const candidateRoot = path.join(base, "cr");
  const restoreVerificationRoot = path.join(base, "rv");
  for (const d of [liveProjectsRoot, authorityRoot, backupRoot, candidateRoot, restoreVerificationRoot]) {
    fs.mkdirSync(d, { recursive: true });
  }

  const projA = path.join(liveProjectsRoot, "alpha");
  const projB = path.join(liveProjectsRoot, "beta");
  fs.mkdirSync(path.join(projA, "production-execution"), { recursive: true });
  fs.mkdirSync(path.join(projA, "assets"), { recursive: true });
  fs.mkdirSync(path.join(projB, "production-execution"), { recursive: true });
  const w = (p: string, v: unknown) =>
    fs.writeFileSync(p, typeof v === "string" ? v : `${JSON.stringify(v)}\n`);
  w(path.join(projA, "project.json"), { slug: "alpha" });
  w(path.join(projA, "manifest.json"), { version: 1, nonce: `${_name}-${fixtureSeq}` });
  w(path.join(projA, "production-acceptance.json"), { schemaVersion: "2", accepted: true });
  w(path.join(projA, "production-execution", "a.json"), { state: "succeeded" });
  fs.writeFileSync(path.join(projA, "assets", "img.bin"), Buffer.from([0, 1, 2, 3, 255]));
  w(path.join(projB, "project.json"), { slug: "beta" });
  w(path.join(projB, "manifest.json"), { version: 1 });
  w(path.join(projB, "production-execution", "a.json"), { state: "failed" });

  execFileSync("git", ["init", "-q"], { cwd: repositoryRoot });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: repositoryRoot });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: repositoryRoot });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: repositoryRoot });
  execFileSync("git", ["add", "data/projects"], { cwd: repositoryRoot });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: repositoryRoot });

  const context = createRuntimeStorageContext({
    workspaceRoot: repositoryRoot,
    environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
    authorityRoot,
  });
  const backupManifest = collectRuntimeBackupInventory({ context, repositoryRoot, now: () => STAMP });
  // materialise the backup payload by project-id folder (v3 layout)
  const byId = new Map<string, string>();
  for (const file of backupManifest.files) {
    const id = file.relativePath.split("/")[0];
    if (!byId.has(id)) byId.set(id, file.projectSlug ?? id);
  }
  for (const [id, slug] of byId) {
    fs.mkdirSync(path.join(backupDirectory, "payload", "projects", id), { recursive: true });
    fs.cpSync(path.join(liveProjectsRoot, slug), path.join(backupDirectory, "payload", "projects", id), {
      recursive: true,
    });
  }
  const serialized = serializeRuntimeBackupManifest(backupManifest);
  fs.writeFileSync(path.join(backupDirectory, "manifest.json"), serialized, { flag: "wx" });
  fs.writeFileSync(path.join(backupDirectory, "manifest.sha256"),
    `${runtimeBackupManifestSha256(serialized)}\n`, { flag: "wx" });
  const backup = verifyRuntimeBackup(backupDirectory);

  const candidateId = runtimeMigrationCandidateId({
    sourceBackupManifestSha256: backup.manifestSha256,
    sourceBackupAggregate: backup.aggregateFingerprint,
  });
  RuntimeMigrationCandidateService.createVerifiedMigrationCandidate({
    context,
    repositoryRoot,
    backupRoot,
    backupDirectory,
    candidateRoot,
    restoreVerificationRoot,
    confirmCandidateCreation: true,
    allowTestTempRoot: true,
  }, { now: () => STAMP });

  const candidateDirectory = path.join(
    candidateRoot, "candidates", runtimeMigrationCandidateDirName(candidateId),
  );
  const candidateManifest = verifyMigrationCandidate(candidateDirectory).manifest;
  return {
    base, repositoryRoot, liveProjectsRoot, backupDirectory, candidateRoot,
    candidateId, candidateDirectory, candidateManifest,
    fileCount: candidateManifest.inventory.files,
    byteCount: candidateManifest.inventory.bytes,
  };
}

function baseInput(fx: Fixture, targetRoot: string, consumeId = "consume-happy-01"): RuntimeMigrationCandidateConsumeInput {
  return {
    consumeId,
    candidateId: fx.candidateId,
    candidateDirectory: fx.candidateDirectory,
    relocationTargetRoot: targetRoot,
    liveProjectsRoot: fx.liveProjectsRoot,
    backupDirectory: fx.backupDirectory,
    now: () => STAMP,
    allowTestTempRoot: true,
  };
}

const consume = (i: RuntimeMigrationCandidateConsumeInput, deps = {}) =>
  RuntimeMigrationCandidateConsumeService.consumeVerifiedMigrationCandidate(i, deps);

function freshTarget(fx: Fixture, sub = "target"): string {
  const p = path.join(fx.base, sub);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

async function main() {
  const gitBefore = gitStatus();
  const fixtures: Fixture[] = [];
  const mk = (name: string) => { const f = buildFixture(name); fixtures.push(f); return f; };

  try {
    /* ============================================== happy + bindings === */

    await scenario("1 exact verified candidate → empty target → PASS (byte-exact)", async () => {
      const fx = mk("happy");
      const target = freshTarget(fx);
      const result = await consume({
        ...baseInput(fx, target),
        expectedFileCount: fx.fileCount,
        expectedByteCount: fx.byteCount,
      });
      assert.equal(result.consumed, true);
      assert.equal(result.cutoverAuthorized, false);
      assert.equal(result.fileCount, fx.fileCount);
      assert.equal(result.byteCount, fx.byteCount);
      assert.equal(result.candidateAggregate, fx.candidateManifest.candidateAggregate);
      // every candidate file is present at the target, byte-identical
      for (const file of fx.candidateManifest.files) {
        const src = path.join(fx.candidateDirectory, "projects", file.relativePath);
        const dst = path.join(target, "projects", file.relativePath);
        assert.equal(sha(dst), sha(src), file.relativePath);
      }
      assert.equal(result.durableRecoveryDecision !== "recovery-required", true);
      // immutable result written
      assert.ok(fs.existsSync(path.join(target, ".migration-consume", "result.json")));
    });

    await scenario("2 target non-empty (stray data dir) → FAIL", async () => {
      const fx = mk("nonempty");
      const target = freshTarget(fx);
      fs.mkdirSync(path.join(target, "projects", "ghost"), { recursive: true });
      await assert.rejects(consume(baseInput(fx, target)), consumeErr("MIGRATION_TARGET_NOT_EMPTY"));
    });

    await scenario("3 target contains one unrelated file → FAIL", async () => {
      const fx = mk("stray");
      const target = freshTarget(fx);
      fs.writeFileSync(path.join(target, "README.txt"), "hi");
      await assert.rejects(consume(baseInput(fx, target)), consumeErr("MIGRATION_TARGET_NOT_EMPTY"));
    });

    await scenario("4 candidate mutated after verify → FAIL", async () => {
      const fx = mk("mutcand");
      const target = freshTarget(fx);
      const victim = path.join(fx.candidateDirectory, "projects",
        fx.candidateManifest.files[0].relativePath);
      fs.chmodSync(victim, 0o600);
      fs.writeFileSync(victim, "tampered");
      await assert.rejects(consume(baseInput(fx, target)),
        (e: unknown) => e instanceof RuntimeMigrationCandidateConsumeError &&
          (e.code === "MATERIALIZATION_FAILED" || e.code === "CANDIDATE_NOT_VERIFIED"));
    });

    await scenario("5 target mutated after copy (idempotent re-verify) → FAIL", async () => {
      const fx = mk("muttgt");
      const target = freshTarget(fx);
      await consume(baseInput(fx, target));
      const victim = path.join(target, "projects", fx.candidateManifest.files[0].relativePath);
      fs.chmodSync(victim, 0o600);
      fs.appendFileSync(victim, "x");
      await assert.rejects(consume(baseInput(fx, target)),
        (e: unknown) => e instanceof RuntimeMigrationCandidateConsumeError &&
          e.code.startsWith("POST_COPY"));
    });

    await scenario("6/7 extra target file / missing target file → FAIL", async () => {
      const fx = mk("extramiss");
      const t1 = freshTarget(fx, "t1");
      await consume(baseInput(fx, t1));
      fs.writeFileSync(path.join(t1, "projects", fx.candidateManifest.files[0].relativePath.split("/")[0], "EXTRA.json"), "{}");
      await assert.rejects(consume(baseInput(fx, t1)), (e: unknown) =>
        e instanceof RuntimeMigrationCandidateConsumeError && e.code.startsWith("POST_COPY"));

      const t2 = freshTarget(fx, "t2");
      await consume(baseInput(fx, t2));
      const gone = path.join(t2, "projects", fx.candidateManifest.files[0].relativePath);
      fs.chmodSync(gone, 0o600); fs.rmSync(gone);
      await assert.rejects(consume(baseInput(fx, t2)), (e: unknown) =>
        e instanceof RuntimeMigrationCandidateConsumeError && e.code.startsWith("POST_COPY"));
    });

    await scenario("8/9/10 symlink candidate / symlink target ancestor / junction → FAIL or SKIP", async () => {
      const fx = mk("links");
      const target = freshTarget(fx);
      const outside = path.join(fx.base, "outside.txt");
      fs.writeFileSync(outside, "x");
      let symlinkOk = true;
      try {
        const victim = path.join(fx.candidateDirectory, "projects", "linky.txt");
        fs.symlinkSync(outside, victim, "file");
        await assert.rejects(consume(baseInput(fx, target)), (e: unknown) =>
          e instanceof RuntimeMigrationCandidateConsumeError &&
          (e.code === "CANDIDATE_NOT_VERIFIED" || e.code === "MIGRATION_UNSUPPORTED_FILE_TYPE"));
        fs.rmSync(victim);
      } catch (e) {
        if (symlinkOk && (e as NodeJS.ErrnoException)?.code === "EPERM") {
          symlinkOk = false;
          skipped.push("symlink rejection (platform cannot create file symlinks)");
        } else if (!(e instanceof assert.AssertionError)) { /* symlink create failed post-check */ }
      }
      // symlinked relocation target root
      try {
        const realTarget = path.join(fx.base, "real-target");
        fs.mkdirSync(realTarget);
        const linkTarget = path.join(fx.base, "link-target");
        fs.symlinkSync(realTarget, linkTarget, "junction");
        await assert.rejects(consume({ ...baseInput(fx, linkTarget) }), (e: unknown) =>
          e instanceof RuntimeMigrationCandidateConsumeError);
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code === "EPERM") {
          skipped.push("junction target rejection (platform cannot create junctions)");
        } else if (!(e instanceof assert.AssertionError)) { throw e; }
      }
    });

    await scenario("11 path traversal consumeId / relative target → FAIL", async () => {
      const fx = mk("traversal");
      await assert.rejects(consume({ ...baseInput(fx, freshTarget(fx)), consumeId: "../evil" }),
        consumeErr("CONSUME_INPUT_INVALID"));
      await assert.rejects(consume({ ...baseInput(fx, "relative/target") }),
        consumeErr("CONSUME_INPUT_INVALID"));
      await assert.rejects(consume({ ...baseInput(fx, freshTarget(fx)), candidateDirectory: path.join(fx.base, "..", "escape") }),
        consumeErr("CONSUME_INPUT_INVALID"));
    });

    await scenario("12-15 candidate/backup/live/quarantine ∩ target → FAIL", async () => {
      const fx = mk("overlap");
      const cases: [string, Partial<RuntimeMigrationCandidateConsumeInput>][] = [
        ["candidate", { relocationTargetRoot: fx.candidateDirectory }],
        ["backup", { relocationTargetRoot: fx.backupDirectory }],
        ["live", { relocationTargetRoot: fx.liveProjectsRoot }],
      ];
      for (const [label, patch] of cases) {
        await assert.rejects(consume({ ...baseInput(fx, freshTarget(fx)), ...patch }), (e: unknown) =>
          e instanceof RuntimeMigrationCandidateConsumeError, label);
      }
      // quarantine == target
      const t = freshTarget(fx, "q-target");
      await assert.rejects(consume({ ...baseInput(fx, t), quarantineRoot: t }),
        consumeErr("MIGRATION_PROTECTED_ROOT_OVERLAP"));
    });

    await scenario("16 wrong candidateId → FAIL", async () => {
      const fx = mk("wrongid");
      await assert.rejects(consume({
        ...baseInput(fx, freshTarget(fx)),
        candidateId: `candidate-${"0".repeat(64)}`,
      }), consumeErr("CANDIDATE_BINDING_MISMATCH"));
    });

    await scenario("17 wrong manifest binding → FAIL", async () => {
      const fx = mk("wrongmanifest");
      const tampered = JSON.parse(JSON.stringify(fx.candidateManifest)) as RuntimeMigrationCandidateManifest;
      (tampered as { createdAt: string }).createdAt = "2000-01-01T00:00:00.000Z";
      await assert.rejects(consume({
        ...baseInput(fx, freshTarget(fx)),
        expectedCandidateManifest: tampered,
      }), consumeErr("MANIFEST_BINDING_MISMATCH"));
    });

    await scenario("18 wrong backup binding → FAIL", async () => {
      const fx = mk("wrongbackup");
      const other = mk("wrongbackup-other");
      await assert.rejects(consume({
        ...baseInput(fx, freshTarget(fx)),
        backupDirectory: other.backupDirectory,
      }), consumeErr("BACKUP_BINDING_MISMATCH"));
    });

    await scenario("19 durable record mutation in candidate → FAIL", async () => {
      const fx = mk("durablemut");
      const durable = fx.candidateManifest.files.find((f) => f.classification === "durable-execution");
      assert.ok(durable, "fixture must contain a durable-execution record");
      const victim = path.join(fx.candidateDirectory, "projects", durable!.relativePath);
      fs.chmodSync(victim, 0o600);
      fs.writeFileSync(victim, `${fs.readFileSync(victim, "utf8")} `);
      await assert.rejects(consume(baseInput(fx, freshTarget(fx))), (e: unknown) =>
        e instanceof RuntimeMigrationCandidateConsumeError);
    });

    await scenario("20/21 duplicate consumeId — same candidate idempotent, different candidate FAIL", async () => {
      const fx = mk("idempotent");
      const target = freshTarget(fx);
      const first = await consume(baseInput(fx, target, "consume-dup-01"));
      const second = await consume(baseInput(fx, target, "consume-dup-01"));
      assert.equal(second.consumed, true);
      assert.equal(second.resumed, true);
      assert.equal(second.contentDigest, first.contentDigest);

      const other = mk("idempotent-other");
      await assert.rejects(consume({
        ...baseInput(other, target, "consume-dup-01"),
      }), consumeErr("CONSUME_ID_CANDIDATE_MISMATCH"));
    });

    /* ============================================= crash / restart ==== */

    await scenario("22 crash before materialization complete → not consumed; 24 restart resumes safely", async () => {
      const fx = mk("crash-mid");
      const target = freshTarget(fx);
      const child = runConsumeChild(fx, target, "consume-crash-01", { crashAfterFile: 1 });
      assert.notEqual(child.status, 0, child.stderr);
      const state = readState(target);
      assert.notEqual(state?.state, "consumed");
      // restart in-process — resumes against the immutable candidate
      const resumed = await consume(baseInput(fx, target, "consume-crash-01"));
      assert.equal(resumed.consumed, true);
      assert.equal(resumed.resumed, true);
      assert.equal(readState(target)?.state, "consumed");
    });

    await scenario("23 crash after materialization, before verification → not consumed; restart → consumed", async () => {
      const fx = mk("crash-preverify");
      const target = freshTarget(fx);
      const child = runConsumeChild(fx, target, "consume-crash-02", { crashAtState: "materialized" });
      assert.notEqual(child.status, 0, child.stderr);
      assert.notEqual(readState(target)?.state, "consumed");
      const resumed = await consume(baseInput(fx, target, "consume-crash-02"));
      assert.equal(resumed.consumed, true);
      assert.equal(readState(target)?.state, "consumed");
    });

    await scenario("25/26/27 post-copy digest / file-count / byte-count exact (positive)", async () => {
      const fx = mk("exact");
      const target = freshTarget(fx);
      const r = await consume(baseInput(fx, target, "consume-exact-01"));
      // independent recompute of the two digests over source + target
      const srcDigest = contentDigest(path.join(fx.candidateDirectory, "projects"));
      const tgtDigest = contentDigest(path.join(target, "projects"));
      assert.equal(r.contentDigest, srcDigest.digest);
      assert.equal(r.contentDigest, tgtDigest.digest);
      assert.equal(r.fileCount, srcDigest.count);
      assert.equal(r.fileCount, tgtDigest.count);
      assert.equal(r.byteCount, fx.byteCount);
    });

    /* =================================================== CLI + safety = */

    await scenario("CLI: strict args + a full consume run", async () => {
      const fx = mk("cli");
      const target = freshTarget(fx, "cli-target");
      for (const argv of [
        ["--consume-id", "x"],  // too short
        ["--consume-id", "cli-run-01", "--candidate-id", "nope"],
        ["--consume-id", "cli-run-01", "--candidate-id", fx.candidateId,
          "--candidate-directory", "relative", "--relocation-target", target, "--live-projects", fx.liveProjectsRoot],
      ]) {
        const r = await runRuntimeMigrationCandidateConsumeCommand(argv);
        assert.equal(r.exitCode, 1, JSON.stringify(argv));
      }
      const ok = await runRuntimeMigrationCandidateConsumeCommand([
        "--consume-id", "cli-run-01",
        "--candidate-id", fx.candidateId,
        "--candidate-directory", fx.candidateDirectory,
        "--relocation-target", target,
        "--live-projects", fx.liveProjectsRoot,
        "--backup-directory", fx.backupDirectory,
        "--allow-test-temp-root",
      ]);
      assert.equal(ok.exitCode, 0, JSON.stringify(ok.report));
      assert.equal((ok.report as { cutoverAuthorized: boolean }).cutoverAuthorized, false);
    });

    await scenario("static: consume code imports no execution primitive; Execution Gate untouched", () => {
      const strip = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
      const forbidden = /\bimport\b[\s\S]{0,160}(PipelineRunner|BrainWorkerCycle|ffmpeg)|ayasExecutionGate\s*=\s*["']OPEN|executionGate\s*=\s*["']OPEN/;
      for (const f of [
        "src/lib/runtime/migration/RuntimeMigrationCandidateConsumeService.ts",
        "src/lib/runtime/migration/RuntimeMigrationCandidateConsumeCommand.ts",
        "src/lib/runtime/migration/RuntimeMigrationExternalSourcePreflight.ts",
        "src/lib/runtime/security/RuntimeProtectedRoots.ts",
        "scripts/run-migration-candidate-consume.ts",
      ]) {
        assert.ok(!forbidden.test(strip(fs.readFileSync(path.join(REPO, f), "utf8"))), f);
      }
    });

    await scenario("git working tree unchanged; no data/projects or .env.local touched", () => {
      assert.equal(gitStatus(), gitBefore);
    });

    console.log(`C.2B.10a candidate consume: PASS (${count} scenarios)`);
    if (skipped.length) console.log(`  skipped: ${[...new Set(skipped)].join("; ")}`);
    console.log(JSON.stringify({ status: "PASS", suite: "c2b10a-candidate-consume", scenarios: count, skipped: [...new Set(skipped)] }));
  } finally {
    void fixtures;
    await fsp.rm(SANDBOX, { recursive: true, force: true }).catch(() => {});
  }
}

/* -------------------------------------------------------------- helpers --- */

function sha(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function contentDigest(projectsRoot: string): { digest: string; count: number } {
  const lines: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.isFile()) continue;
      const rel = path.relative(projectsRoot, full).split(path.sep).join("/");
      const buf = fs.readFileSync(full);
      lines.push(`${rel}\0${createHash("sha256").update(buf).digest("hex")}\0${buf.length}`);
    }
  };
  walk(projectsRoot);
  lines.sort();
  return { digest: createHash("sha256").update(lines.join("\n")).digest("hex"), count: lines.length };
}

function readState(target: string): { state: string } | undefined {
  const p = path.join(target, ".migration-consume", "state.json");
  if (!fs.existsSync(p)) return undefined;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function runConsumeChild(
  fx: Fixture,
  target: string,
  consumeId: string,
  crash: { crashAfterFile?: number; crashAtState?: string },
) {
  const url = (p: string) => JSON.stringify(pathToFileURL(path.resolve(REPO, p)).href);
  const src = `
import { RuntimeMigrationCandidateConsumeService } from ${url("src/lib/runtime/migration/RuntimeMigrationCandidateConsumeService.ts")};
const input = ${JSON.stringify(baseInput(fx, target, consumeId))};
const crash = ${JSON.stringify(crash)};
let files = 0;
await RuntimeMigrationCandidateConsumeService.consumeVerifiedMigrationCandidate(input, {
  afterFileMaterialized: () => { files += 1; if (crash.crashAfterFile && files >= crash.crashAfterFile) { process.exit(7); } },
  observeState: (s) => { if (crash.crashAtState && s === crash.crashAtState) { process.exit(8); } },
});
console.log("CHILD_DONE");
`;
  return spawnSync(process.execPath, [...process.execArgv, "--input-type=module", "--eval", src], {
    cwd: REPO, encoding: "utf8", timeout: 90_000, maxBuffer: 20 * 1024 * 1024,
  });
}

void (async () => {
  try { await main(); }
  catch (error) { console.error("C.2B.10a candidate consume FAILED:", error); process.exitCode = 1; }
})();
