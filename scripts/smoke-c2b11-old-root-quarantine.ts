/**
 * C.2B.11 — old-root read-only quarantine + single-authority rollback token.
 *
 * Deterministic / no network / $0. Everything under an OS temp dir — the
 * repository `data/projects/**` and `.env.local` are never touched.
 *
 *   A. finalize old-root quarantine — read-only barrier + durable evidence + token
 *   B. old-root reuse rejection (enforcement)
 *   C. token-authorized rollback happy path (single live authority throughout)
 *   D. replay / generation / sequence / root / token mismatch → FAIL CLOSED
 *   E. target-dirty / old-root content drift → FAIL CLOSED
 *   F. crash / restart safety
 *   G. protected-root overlap incl. `authority`
 *   H. forward-recovery separation
 *   I. operator CLI
 *
 * Run: npx tsx scripts/smoke-c2b11-old-root-quarantine.ts
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { writeRuntimeAuthorityGenerationMarker } from "../src/lib/runtime/security/RuntimeAuthorityGenerationMarker";
import {
  RuntimeAuthorityTransitionStore,
  type RuntimeAuthorityRollbackToken,
} from "../src/lib/runtime/security/RuntimeAuthorityTransition";
import {
  beginTransition,
  confirmQuiescence,
  prepareTransition,
  publishTransition,
  quarantineSource,
  validateTarget,
} from "../src/lib/runtime/security/RuntimeAuthorityTransitionCoordinator";
import {
  beginTokenAuthorizedRollback,
  finalizeOldRootQuarantine,
  publishRollback,
  quarantineFormerTarget,
  readRollbackAvailability,
  RuntimeAuthorityRollbackError,
  validateRollback,
} from "../src/lib/runtime/security/RuntimeAuthorityRollback";
import {
  enforceProductionRuntimeAuthorityGeneration,
  ProductionRuntimeAuthorityEnforcementError,
} from "../src/lib/runtime/security/ProductionRuntimeAuthorityGenerationEnforcement";
import { assertMigrationConsumeRootsDisjoint } from "../src/lib/runtime/security/RuntimeProtectedRoots";
import { runRuntimeAuthorityTransitionCommand } from "../src/lib/runtime/security/RuntimeAuthorityTransitionCommand";

const REPO = path.resolve(__dirname, "..");
const GEN = "runtime-authority-generation-v1";
const NOW = "2026-08-01T09:00:00.000Z";
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "c2b11-"));
let seq = 0;
let count = 0;

async function scenario(name: string, run: () => unknown | Promise<unknown>) {
  await run();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}
const rbErr = (code: string) => (e: unknown) =>
  e instanceof RuntimeAuthorityRollbackError && e.code === code;
const enfErr = (code: string) => (e: unknown) =>
  e instanceof ProductionRuntimeAuthorityEnforcementError && e.code === code;

function gitStatus(): string {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: REPO, encoding: "utf8",
  });
}

interface Site {
  base: string;
  workspaceRoot: string;
  authorityRoot: string;
  oldRoot: string;
  newRoot: string;
  strayRoot: string;
  oldProjects: string;
  newProjects: string;
  ctx: (root: string) => ReturnType<typeof createRuntimeStorageContext>;
  store: (now?: () => string) => RuntimeAuthorityTransitionStore;
}

function seedProjects(root: string): string {
  const projects = path.join(root, "projects");
  fs.mkdirSync(path.join(projects, "alpha", "production-execution"), { recursive: true });
  fs.mkdirSync(path.join(projects, "beta"), { recursive: true });
  fs.writeFileSync(path.join(projects, "alpha", "project.json"), '{"slug":"alpha"}\n');
  fs.writeFileSync(path.join(projects, "alpha", "production-execution", "a.json"), '{"state":"ok"}\n');
  fs.writeFileSync(path.join(projects, "beta", "project.json"), '{"slug":"beta"}\n');
  return projects;
}

function makeSite(): Site {
  seq += 1;
  const base = path.join(SANDBOX, `s${seq}`);
  const workspaceRoot = path.join(base, "ws");
  const authorityRoot = path.join(base, "auth");
  const oldRoot = path.join(base, "old");
  const newRoot = path.join(base, "new");
  const strayRoot = path.join(base, "stray");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(authorityRoot, { recursive: true });
  const oldProjects = seedProjects(oldRoot);
  const newProjects = path.join(newRoot, "projects");
  fs.mkdirSync(newRoot, { recursive: true });
  fs.cpSync(oldProjects, newProjects, { recursive: true }); // byte-exact copy
  return {
    base, workspaceRoot, authorityRoot, oldRoot, newRoot, strayRoot, oldProjects, newProjects,
    ctx: (root) => createRuntimeStorageContext({
      environment: { ATOLYE_RUNTIME_ROOT: root }, workspaceRoot, authorityRoot,
    }),
    store: (now = () => NOW) => new RuntimeAuthorityTransitionStore({ authorityRoot, now }),
  };
}

/** Full byte-exact relocation old→new, ending at `old-root-quarantined`. */
function relocate(site: Site, tid: string): void {
  const store = site.store();
  writeRuntimeAuthorityGenerationMarker({ context: site.ctx(site.oldRoot), authorityGeneration: GEN, now: NOW });
  beginTransition({
    store, transitionId: tid,
    sourceContext: site.ctx(site.oldRoot), sourceAuthorityGeneration: GEN,
    targetContext: site.ctx(site.newRoot), targetAuthorityGeneration: GEN,
  });
  confirmQuiescence({ store, transitionId: tid, workerLifecycleState: "stopped", durableRecovery: "clean" });
  prepareTransition({ store, transitionId: tid, sourceProjectSlugs: ["alpha", "beta"], sourceProjectsRoot: site.oldProjects });
  validateTarget({
    store, transitionId: tid, targetContext: site.ctx(site.newRoot), targetAuthorityGeneration: GEN,
    targetProjectSlugs: ["alpha", "beta"], targetProjectsRoot: site.newProjects,
  });
  publishTransition({ store, transitionId: tid, targetContext: site.ctx(site.newRoot), targetAuthorityGeneration: GEN });
  quarantineSource({ store, transitionId: tid });
}

function readOnly(file: string): boolean {
  return (fs.statSync(file).mode & 0o200) === 0;
}
function chmodTree(root: string, mode: number): void {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) chmodTree(full, mode);
    else fs.chmodSync(full, mode);
  }
}

async function main() {
  const gitBefore = gitStatus();
  try {
    /* ============================================ A. finalize ========== */

    await scenario("finalize: read-only barrier + enforcement record + rollback token", () => {
      const s = makeSite();
      relocate(s, "reloc-final-01");
      const before = readRollbackAvailability(s.store(), "reloc-final-01");
      assert.equal(before.rollbackAvailable, false);

      const r = finalizeOldRootQuarantine({ store: s.store(), transitionId: "reloc-final-01", oldRootProjectsRoot: s.oldProjects });
      assert.equal(r.rollbackAvailable, true);
      assert.ok(r.rollbackToken?.tokenId.startsWith("rbt-"));
      assert.equal(readOnly(path.join(s.oldProjects, "alpha", "project.json")), true);
      assert.equal(readOnly(path.join(s.oldProjects, "alpha", "production-execution", "a.json")), true);

      const store = s.store();
      const binding = store.readTransition("reloc-final-01")!.source.resolverBindingIdentity;
      assert.ok(store.readQuarantineEnforcement(binding));
      const status = readRollbackAvailability(store, "reloc-final-01");
      assert.equal(status.rollbackAvailable, true);
      assert.equal(status.readOnlyEnforced, true);
    });

    await scenario("finalize is idempotent — same token", () => {
      const s = makeSite();
      relocate(s, "reloc-idem-01");
      const a = finalizeOldRootQuarantine({ store: s.store(), transitionId: "reloc-idem-01", oldRootProjectsRoot: s.oldProjects });
      const b = finalizeOldRootQuarantine({ store: s.store(), transitionId: "reloc-idem-01", oldRootProjectsRoot: s.oldProjects });
      assert.equal(a.rollbackToken?.tokenId, b.rollbackToken?.tokenId);
    });

    await scenario("finalize before quarantineSource → ROLLBACK_NOT_AVAILABLE", () => {
      const s = makeSite();
      const store = s.store();
      writeRuntimeAuthorityGenerationMarker({ context: s.ctx(s.oldRoot), authorityGeneration: GEN, now: NOW });
      beginTransition({ store, transitionId: "reloc-early-01",
        sourceContext: s.ctx(s.oldRoot), sourceAuthorityGeneration: GEN,
        targetContext: s.ctx(s.newRoot), targetAuthorityGeneration: GEN });
      confirmQuiescence({ store, transitionId: "reloc-early-01", workerLifecycleState: "stopped", durableRecovery: "clean" });
      prepareTransition({ store, transitionId: "reloc-early-01", sourceProjectSlugs: ["alpha", "beta"], sourceProjectsRoot: s.oldProjects });
      validateTarget({ store, transitionId: "reloc-early-01", targetContext: s.ctx(s.newRoot), targetAuthorityGeneration: GEN,
        targetProjectSlugs: ["alpha", "beta"], targetProjectsRoot: s.newProjects });
      publishTransition({ store, transitionId: "reloc-early-01", targetContext: s.ctx(s.newRoot), targetAuthorityGeneration: GEN });
      assert.throws(() => finalizeOldRootQuarantine({ store: s.store(), transitionId: "reloc-early-01", oldRootProjectsRoot: s.oldProjects }),
        rbErr("ROLLBACK_NOT_AVAILABLE"));
    });

    /* ============================================ B. old-root reuse ==== */

    await scenario("finalized old root cannot boot as a runtime (quarantined)", () => {
      const s = makeSite();
      relocate(s, "reuse-01");
      finalizeOldRootQuarantine({ store: s.store(), transitionId: "reuse-01", oldRootProjectsRoot: s.oldProjects });
      assert.throws(() => enforceProductionRuntimeAuthorityGeneration(s.ctx(s.oldRoot), GEN),
        enfErr("RUNTIME_AUTHORITY_ROOT_QUARANTINED"));
      // the new root IS the active authority
      assert.equal(enforceProductionRuntimeAuthorityGeneration(s.ctx(s.newRoot), GEN).mode, "match");
      // a stray copy is not active either
      fs.cpSync(s.oldProjects, path.join(s.strayRoot, "projects"), { recursive: true });
      chmodTree(path.join(s.strayRoot, "projects"), 0o644);
      assert.throws(() => enforceProductionRuntimeAuthorityGeneration(s.ctx(s.strayRoot), GEN),
        enfErr("RUNTIME_AUTHORITY_NOT_ACTIVE"));
    });

    /* ============================================ C. rollback happy ==== */

    await scenario("token-authorized rollback: authority returns to the old root, single live authority throughout", () => {
      const s = makeSite();
      relocate(s, "rb-happy-01");
      const token = finalizeOldRootQuarantine({ store: s.store(), transitionId: "rb-happy-01", oldRootProjectsRoot: s.oldProjects }).rollbackToken!;

      beginTokenAuthorizedRollback({
        store: s.store(), rollbackTransitionId: "rollback-happy-01", tokenId: token.tokenId,
        oldRootContext: s.ctx(s.oldRoot), oldRootAuthorityGeneration: GEN, oldRootProjectsRoot: s.oldProjects,
        formerTargetContext: s.ctx(s.newRoot), formerTargetAuthorityGeneration: GEN, formerTargetProjectsRoot: s.newProjects,
      });
      validateRollback({ store: s.store(), rollbackTransitionId: "rollback-happy-01", oldRootProjectsRoot: s.oldProjects, formerTargetProjectsRoot: s.newProjects });
      publishRollback({ store: s.store(), rollbackTransitionId: "rollback-happy-01", oldRootProjectsRoot: s.oldProjects });
      quarantineFormerTarget({ store: s.store(), rollbackTransitionId: "rollback-happy-01", formerTargetProjectsRoot: s.newProjects });

      const store = s.store();
      const active = store.readActiveAuthority()!;
      assert.equal(active.resolverBindingIdentity, token.sourceResolverBindingIdentity);
      assert.equal(active.transitionSequence, token.transitionSequence + 1);
      assert.ok(store.readRollbackTokenConsumption(token.tokenId));
      // old root writable + boots; former target read-only + quarantined + refuses
      assert.equal(readOnly(path.join(s.oldProjects, "alpha", "project.json")), false);
      assert.equal(enforceProductionRuntimeAuthorityGeneration(s.ctx(s.oldRoot), GEN).mode, "match");
      assert.equal(readOnly(path.join(s.newProjects, "alpha", "project.json")), true);
      assert.throws(() => enforceProductionRuntimeAuthorityGeneration(s.ctx(s.newRoot), GEN),
        enfErr("RUNTIME_AUTHORITY_ROOT_QUARANTINED"));
    });

    /* ============================================ D. mismatch / replay = */

    await scenario("replay: a consumed token cannot start another rollback", () => {
      const s = makeSite();
      relocate(s, "rb-replay-01");
      const token = finalizeOldRootQuarantine({ store: s.store(), transitionId: "rb-replay-01", oldRootProjectsRoot: s.oldProjects }).rollbackToken!;
      const full = (rid: string) => {
        beginTokenAuthorizedRollback({ store: s.store(), rollbackTransitionId: rid, tokenId: token.tokenId,
          oldRootContext: s.ctx(s.oldRoot), oldRootAuthorityGeneration: GEN, oldRootProjectsRoot: s.oldProjects,
          formerTargetContext: s.ctx(s.newRoot), formerTargetAuthorityGeneration: GEN, formerTargetProjectsRoot: s.newProjects });
        validateRollback({ store: s.store(), rollbackTransitionId: rid, oldRootProjectsRoot: s.oldProjects, formerTargetProjectsRoot: s.newProjects });
        publishRollback({ store: s.store(), rollbackTransitionId: rid, oldRootProjectsRoot: s.oldProjects });
      };
      full("rollback-replay-01");
      assert.throws(() => beginTokenAuthorizedRollback({ store: s.store(), rollbackTransitionId: "rollback-replay-02", tokenId: token.tokenId,
        oldRootContext: s.ctx(s.oldRoot), oldRootAuthorityGeneration: GEN, oldRootProjectsRoot: s.oldProjects,
        formerTargetContext: s.ctx(s.newRoot), formerTargetAuthorityGeneration: GEN, formerTargetProjectsRoot: s.newProjects }),
        rbErr("ROLLBACK_TOKEN_CONSUMED"));
    });

    await scenario("token: wrong generation / mutated token / wrong old root / wrong target → FAIL CLOSED", () => {
      const s = makeSite();
      relocate(s, "rb-mm-01");
      const token = finalizeOldRootQuarantine({ store: s.store(), transitionId: "rb-mm-01", oldRootProjectsRoot: s.oldProjects }).rollbackToken!;
      const base = {
        store: s.store(), rollbackTransitionId: "rollback-mm-01", tokenId: token.tokenId,
        oldRootContext: s.ctx(s.oldRoot), oldRootAuthorityGeneration: GEN, oldRootProjectsRoot: s.oldProjects,
        formerTargetContext: s.ctx(s.newRoot), formerTargetAuthorityGeneration: GEN, formerTargetProjectsRoot: s.newProjects,
      };
      assert.throws(() => beginTokenAuthorizedRollback({ ...base, oldRootAuthorityGeneration: "other-generation-v9", formerTargetAuthorityGeneration: "other-generation-v9" }),
        (e: unknown) => e instanceof RuntimeAuthorityRollbackError);
      const mutated: RuntimeAuthorityRollbackToken = { ...token, transitionSequence: token.transitionSequence + 5 };
      assert.throws(() => beginTokenAuthorizedRollback({ ...base, expectedToken: mutated }), rbErr("ROLLBACK_TOKEN_MISMATCH"));
      assert.throws(() => beginTokenAuthorizedRollback({ ...base, oldRootContext: s.ctx(s.strayRoot),
        oldRootProjectsRoot: (fs.mkdirSync(path.join(s.strayRoot, "projects"), { recursive: true }), path.join(s.strayRoot, "projects")) }),
        rbErr("ROLLBACK_SOURCE_ROOT_MISMATCH"));
      assert.throws(() => beginTokenAuthorizedRollback({ ...base, formerTargetContext: s.ctx(s.strayRoot), formerTargetProjectsRoot: path.join(s.strayRoot, "projects") }),
        rbErr("ROLLBACK_TARGET_ROOT_MISMATCH"));
      assert.throws(() => beginTokenAuthorizedRollback({ ...base, tokenId: `rbt-${"0".repeat(48)}` }), rbErr("ROLLBACK_TOKEN_NOT_FOUND"));
    });

    /* ============================================ E. drift / dirty ==== */

    await scenario("target dirty (new root mutated since cutover) → ROLLBACK_TARGET_DIRTY", () => {
      const s = makeSite();
      relocate(s, "rb-dirty-01");
      const token = finalizeOldRootQuarantine({ store: s.store(), transitionId: "rb-dirty-01", oldRootProjectsRoot: s.oldProjects }).rollbackToken!;
      fs.writeFileSync(path.join(s.newProjects, "alpha", "NEW.json"), "{}"); // a write on the new root
      assert.throws(() => beginTokenAuthorizedRollback({ store: s.store(), rollbackTransitionId: "rollback-dirty-01", tokenId: token.tokenId,
        oldRootContext: s.ctx(s.oldRoot), oldRootAuthorityGeneration: GEN, oldRootProjectsRoot: s.oldProjects,
        formerTargetContext: s.ctx(s.newRoot), formerTargetAuthorityGeneration: GEN, formerTargetProjectsRoot: s.newProjects }),
        rbErr("ROLLBACK_TARGET_DIRTY"));
    });

    await scenario("old-root content drift while quarantined → FAIL CLOSED", () => {
      const s = makeSite();
      relocate(s, "rb-drift-01");
      const token = finalizeOldRootQuarantine({ store: s.store(), transitionId: "rb-drift-01", oldRootProjectsRoot: s.oldProjects }).rollbackToken!;
      const victim = path.join(s.oldProjects, "beta", "project.json");
      fs.chmodSync(victim, 0o644); fs.appendFileSync(victim, "x"); // bypass the advisory barrier
      assert.throws(() => beginTokenAuthorizedRollback({ store: s.store(), rollbackTransitionId: "rollback-drift-01", tokenId: token.tokenId,
        oldRootContext: s.ctx(s.oldRoot), oldRootAuthorityGeneration: GEN, oldRootProjectsRoot: s.oldProjects,
        formerTargetContext: s.ctx(s.newRoot), formerTargetAuthorityGeneration: GEN, formerTargetProjectsRoot: s.newProjects }),
        (e: unknown) => e instanceof RuntimeAuthorityRollbackError &&
          (e.code === "ROLLBACK_OLD_ROOT_CONTENT_DRIFT" || e.code === "ROLLBACK_QUARANTINE_NOT_ENFORCED"));
    });

    /* ============================================ F. crash / restart == */

    await scenario("crash between validate-rollback and publish-rollback → restart resumes, no second authority", () => {
      const s = makeSite();
      relocate(s, "rb-crash-01");
      const token = finalizeOldRootQuarantine({ store: s.store(), transitionId: "rb-crash-01", oldRootProjectsRoot: s.oldProjects }).rollbackToken!;
      for (const step of ["begin", "validate"]) stepChild(s, "rollback-crash-01", token.tokenId, step);
      const store = s.store();
      assert.equal(store.readTransition("rollback-crash-01")?.state, "rollback-validated");
      assert.equal(store.readActiveAuthority()?.resolverBindingIdentity, token.targetResolverBindingIdentity); // still the new root
      assert.equal(store.readRollbackTokenConsumption(token.tokenId), null);
      // resume
      publishRollback({ store: s.store(), rollbackTransitionId: "rollback-crash-01", oldRootProjectsRoot: s.oldProjects });
      quarantineFormerTarget({ store: s.store(), rollbackTransitionId: "rollback-crash-01", formerTargetProjectsRoot: s.newProjects });
      assert.equal(s.store().readActiveAuthority()?.resolverBindingIdentity, token.sourceResolverBindingIdentity);
      assert.equal(s.store().listTransitions().filter((t) => t.kind === "rollback").length, 1);
    });

    /* ============================================ G. protected roots == */

    await scenario("protected roots: authority ∩ target / quarantine ∩ target → overlap", () => {
      const s = makeSite();
      assert.throws(() => assertMigrationConsumeRootsDisjoint({
        liveProjects: s.oldProjects, candidate: path.join(s.base, "cand"), relocationTarget: s.newProjects,
        authority: s.newProjects,
      }), (e: unknown) => e instanceof Error);
      assert.throws(() => assertMigrationConsumeRootsDisjoint({
        liveProjects: s.oldProjects, candidate: path.join(s.base, "cand"), relocationTarget: s.newProjects,
        quarantine: path.join(s.newProjects, "alpha"),
      }), (e: unknown) => e instanceof Error);
    });

    /* ============================================ H. recovery sep ===== */

    await scenario("a rollback token does not satisfy a forward-recovery, and vice versa", () => {
      const s = makeSite();
      relocate(s, "rb-sep-01");
      const token = finalizeOldRootQuarantine({ store: s.store(), transitionId: "rb-sep-01", oldRootProjectsRoot: s.oldProjects }).rollbackToken!;
      // the rollback record is kind "rollback", not "recovery"
      beginTokenAuthorizedRollback({ store: s.store(), rollbackTransitionId: "rollback-sep-01", tokenId: token.tokenId,
        oldRootContext: s.ctx(s.oldRoot), oldRootAuthorityGeneration: GEN, oldRootProjectsRoot: s.oldProjects,
        formerTargetContext: s.ctx(s.newRoot), formerTargetAuthorityGeneration: GEN, formerTargetProjectsRoot: s.newProjects });
      assert.equal(s.store().readTransition("rollback-sep-01")?.kind, "rollback");
      // validateRollback rejects a non-rollback transitionId
      assert.throws(() => validateRollback({ store: s.store(), rollbackTransitionId: "rb-sep-01", oldRootProjectsRoot: s.oldProjects, formerTargetProjectsRoot: s.newProjects }),
        rbErr("ROLLBACK_INPUT_INVALID"));
    });

    /* ============================================ I. CLI ============== */

    await scenario("CLI: finalize-quarantine → rollback-status → begin/validate/publish/quarantine-former-target", async () => {
      const s = makeSite();
      relocate(s, "cli-reloc-01");
      const ar = ["--authority-root", s.authorityRoot, "--generation", GEN, "--workspace-root", s.workspaceRoot];

      let r = await runRuntimeAuthorityTransitionCommand(["finalize-quarantine", ...ar, "--transition-id", "cli-reloc-01", "--old-root", s.oldRoot]);
      assert.equal(r.exitCode, 0, JSON.stringify(r.report));
      const tokenId = ((r.report as { finalized: { rollbackToken: { tokenId: string } } }).finalized.rollbackToken).tokenId;

      r = await runRuntimeAuthorityTransitionCommand(["rollback-status", ...ar, "--transition-id", "cli-reloc-01"]);
      assert.equal((r.report as { rollback: { rollbackAvailable: boolean } }).rollback.rollbackAvailable, true);

      // strict-arg negatives
      for (const argv of [
        ["begin-rollback", ...ar, "--rollback-transition-id", "x", "--token-id", tokenId, "--old-root", s.oldRoot, "--target", s.newRoot],
        ["begin-rollback", ...ar, "--rollback-transition-id", "cli-rollback-01", "--token-id", "nope", "--old-root", s.oldRoot, "--target", s.newRoot],
        ["begin-rollback", ...ar, "--rollback-transition-id", "cli-rollback-01", "--token-id", tokenId, "--old-root", "relative", "--target", s.newRoot],
      ]) {
        const bad = await runRuntimeAuthorityTransitionCommand(argv);
        assert.equal(bad.exitCode, 1, JSON.stringify(argv));
      }

      for (const argv of [
        ["begin-rollback", ...ar, "--rollback-transition-id", "cli-rollback-01", "--token-id", tokenId, "--old-root", s.oldRoot, "--target", s.newRoot],
        ["validate-rollback", ...ar, "--rollback-transition-id", "cli-rollback-01", "--old-root", s.oldRoot, "--target", s.newRoot],
        ["publish-rollback", ...ar, "--rollback-transition-id", "cli-rollback-01", "--old-root", s.oldRoot],
        ["quarantine-former-target", ...ar, "--rollback-transition-id", "cli-rollback-01", "--target", s.newRoot],
      ]) {
        const step = await runRuntimeAuthorityTransitionCommand(argv);
        assert.equal(step.exitCode, 0, JSON.stringify([argv[0], step.report]));
      }
      r = await runRuntimeAuthorityTransitionCommand(["status", "--authority-root", s.authorityRoot]);
      assert.equal((r.report as { activeAuthority: { transitionSequence: number } }).activeAuthority.transitionSequence, 2);
    });

    await scenario("static: rollback code imports no execution primitive; Execution Gate untouched", () => {
      const strip = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
      const forbidden = /\bimport\b[\s\S]{0,160}(PipelineRunner|BrainWorkerCycle|ffmpeg)|ayasExecutionGate\s*=\s*["']OPEN|executionGate\s*=\s*["']OPEN/;
      for (const f of [
        "src/lib/runtime/security/RuntimeAuthorityRollback.ts",
        "src/lib/runtime/security/RuntimeAuthorityOldRootQuarantine.ts",
      ]) {
        assert.ok(!forbidden.test(strip(fs.readFileSync(path.join(REPO, f), "utf8"))), f);
      }
    });

    await scenario("git working tree unchanged; no data/projects or .env.local touched", () => {
      assert.equal(gitStatus(), gitBefore);
    });

    console.log(`C.2B.11 old-root quarantine + rollback token: PASS (${count} scenarios)`);
    console.log(JSON.stringify({ status: "PASS", suite: "c2b11-old-root-quarantine", scenarios: count }));
  } finally {
    try { chmodTree(SANDBOX, 0o700); } catch { /* best effort */ }
    await fsp.rm(SANDBOX, { recursive: true, force: true }).catch(() => {});
  }
}

function stepChild(site: Site, rid: string, tokenId: string, step: string): void {
  const u = (p: string) => JSON.stringify(pathToFileURL(path.resolve(REPO, p)).href);
  const src = `
import { RuntimeAuthorityTransitionStore } from ${u("src/lib/runtime/security/RuntimeAuthorityTransition.ts")};
import * as rb from ${u("src/lib/runtime/security/RuntimeAuthorityRollback.ts")};
import { createRuntimeStorageContext } from ${u("src/lib/runtime/RuntimeStoragePaths.ts")};
const authorityRoot = ${JSON.stringify(site.authorityRoot)};
const workspaceRoot = ${JSON.stringify(site.workspaceRoot)};
const oldRoot = ${JSON.stringify(site.oldRoot)};
const newRoot = ${JSON.stringify(site.newRoot)};
const oldProjects = ${JSON.stringify(site.oldProjects)};
const newProjects = ${JSON.stringify(site.newProjects)};
const ctx = (r) => createRuntimeStorageContext({ environment: { ATOLYE_RUNTIME_ROOT: r }, workspaceRoot, authorityRoot });
const store = new RuntimeAuthorityTransitionStore({ authorityRoot });
const step = ${JSON.stringify(step)};
if (step === "begin") rb.beginTokenAuthorizedRollback({ store, rollbackTransitionId: ${JSON.stringify(rid)}, tokenId: ${JSON.stringify(tokenId)},
  oldRootContext: ctx(oldRoot), oldRootAuthorityGeneration: "${GEN}", oldRootProjectsRoot: oldProjects,
  formerTargetContext: ctx(newRoot), formerTargetAuthorityGeneration: "${GEN}", formerTargetProjectsRoot: newProjects });
else if (step === "validate") rb.validateRollback({ store, rollbackTransitionId: ${JSON.stringify(rid)}, oldRootProjectsRoot: oldProjects, formerTargetProjectsRoot: newProjects });
console.log("STEP_OK:" + step);
`;
  const c = spawnSync(process.execPath, [...process.execArgv, "--input-type=module", "--eval", src],
    { cwd: REPO, encoding: "utf8", timeout: 60_000, maxBuffer: 20 * 1024 * 1024 });
  if (c.status !== 0) throw new Error(`step ${step}: ${c.stderr}`);
}

void (async () => {
  try { await main(); }
  catch (error) { console.error("C.2B.11 old-root quarantine FAILED:", error); process.exitCode = 1; }
})();
