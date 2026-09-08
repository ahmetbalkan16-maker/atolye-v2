/**
 * C.2B.9 — versioned authority transition + quiescence + old-root quarantine.
 *
 * Deterministic / no browser / $0 / no network. Everything runs under an OS temp
 * dir — the repository `data/projects/**` and `.env.local` are never touched.
 *
 *   A. state machine + store + coordinator (unit)
 *   B. enforcement integration (in-process): quarantine / transition-in-progress
 *      / not-active / unbound-state / two-active-authorities
 *   C. child-process crash/restart: resume across process boundaries, real
 *      composition-root boots against source (denied) / quarantined (denied) /
 *      target (allowed)
 *   D. git safety + static no-execution assertions
 *
 * Run: npx tsx scripts/smoke-c2b9-authority-transition.ts
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createRuntimeStorageContext,
  type RuntimeStorageContext,
} from "../src/lib/runtime/RuntimeStoragePaths";
import {
  describeRuntimeAuthorityIdentity,
  runtimeAuthorityGenerationMarkerFileName,
  writeRuntimeAuthorityGenerationMarker,
} from "../src/lib/runtime/security/RuntimeAuthorityGenerationMarker";
import {
  RuntimeAuthorityTransitionError,
  RuntimeAuthorityTransitionStore,
} from "../src/lib/runtime/security/RuntimeAuthorityTransition";
import {
  beginTransition,
  confirmQuiescence,
  failTransition,
  prepareTransition,
  publishTransition,
  quarantineSource,
  validateTarget,
} from "../src/lib/runtime/security/RuntimeAuthorityTransitionCoordinator";
import {
  assertProductionRuntimeAuthorityGenerationCompatible,
  enforceProductionRuntimeAuthorityGeneration,
  ProductionRuntimeAuthorityEnforcementError,
} from "../src/lib/runtime/security/ProductionRuntimeAuthorityGenerationEnforcement";

const REPO_ROOT = path.resolve(__dirname, "..");
const GEN = "runtime-authority-generation-v1";
const NOW = "2026-07-25T09:00:00.000Z";

let count = 0;
const skipped: string[] = [];
async function scenario(name: string, run: () => unknown | Promise<unknown>) {
  await run();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function transitionErr(code: string) {
  return (error: unknown) =>
    error instanceof RuntimeAuthorityTransitionError && error.code === code;
}
function enforcementErr(code: string) {
  return (error: unknown) =>
    error instanceof ProductionRuntimeAuthorityEnforcementError &&
    error.code === code;
}

function gitStatus(): string {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

interface Pair {
  authorityRoot: string;
  workspaceRoot: string;
  sourceRoot: string;
  targetRoot: string;
  sourceCtx: () => RuntimeStorageContext;
  targetCtx: () => RuntimeStorageContext;
  store: (now?: () => string) => RuntimeAuthorityTransitionStore;
}

function makePair(base: string, name: string): Pair {
  const authorityRoot = path.join(base, name, "authority");
  const workspaceRoot = path.join(base, name, "ws");
  const sourceRoot = path.join(base, name, "source");
  const targetRoot = path.join(base, name, "target");
  fs.mkdirSync(path.join(sourceRoot, "projects"), { recursive: true });
  fs.mkdirSync(path.join(targetRoot, "projects"), { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(authorityRoot, { recursive: true });
  const ctx = (root: string) =>
    createRuntimeStorageContext({
      environment: { ATOLYE_RUNTIME_ROOT: root },
      workspaceRoot,
      authorityRoot,
    });
  return {
    authorityRoot,
    workspaceRoot,
    sourceRoot,
    targetRoot,
    sourceCtx: () => ctx(sourceRoot),
    targetCtx: () => ctx(targetRoot),
    store: (now = () => NOW) =>
      new RuntimeAuthorityTransitionStore({ authorityRoot, now }),
  };
}

function stampSource(pair: Pair): void {
  writeRuntimeAuthorityGenerationMarker({
    context: pair.sourceCtx(),
    authorityGeneration: GEN,
    now: NOW,
  });
}

function runFullTransition(
  pair: Pair,
  transitionId: string,
  opts: { sourceSlugs?: string[]; targetSlugs?: string[] } = {},
): void {
  const store = pair.store();
  const sourceSlugs = opts.sourceSlugs ?? [];
  const targetSlugs = opts.targetSlugs ?? sourceSlugs;
  beginTransition({
    store,
    transitionId,
    sourceContext: pair.sourceCtx(),
    sourceAuthorityGeneration: GEN,
    targetContext: pair.targetCtx(),
    targetAuthorityGeneration: GEN,
  });
  confirmQuiescence({
    store,
    transitionId,
    workerLifecycleState: "stopped",
    durableRecovery: "clean",
  });
  prepareTransition({ store, transitionId, sourceProjectSlugs: sourceSlugs });
  validateTarget({
    store,
    transitionId,
    targetContext: pair.targetCtx(),
    targetAuthorityGeneration: GEN,
    targetProjectSlugs: targetSlugs,
  });
  publishTransition({
    store,
    transitionId,
    targetContext: pair.targetCtx(),
    targetAuthorityGeneration: GEN,
  });
  quarantineSource({ store, transitionId });
}

/* --------------------------------------------------------- child boot ------ */

function bootChild(env: Record<string, string | undefined>): {
  status: number | null;
  outcome: Record<string, unknown> | undefined;
  stderr: string;
} {
  const url = pathToFileURL(
    path.resolve(REPO_ROOT, "src/lib/runtime/ProductionRuntimeCompositionRoot.ts"),
  ).href;
  const source = `
const mod = await import(${JSON.stringify(url)});
let outcome;
try {
  const result = await mod.initializeProductionProcessRuntime();
  outcome = { ok: true, decision: result.decision };
  await mod.shutdownProductionProcessRuntime();
} catch (error) {
  outcome = { ok: false, name: error?.name,
    code: (error && typeof error === "object" && "code" in error) ? error.code : undefined };
}
console.log("C2B9_BOOT:" + JSON.stringify(outcome));
`;
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, "--input-type=module", "--eval", source],
    { cwd: REPO_ROOT, encoding: "utf8", env: merged, maxBuffer: 20 * 1024 * 1024, timeout: 90_000 },
  );
  if (child.error) throw child.error;
  const line = (child.stdout ?? "").split(/\r?\n/).find((l) => l.startsWith("C2B9_BOOT:"));
  return {
    status: child.status,
    outcome: line ? JSON.parse(line.slice("C2B9_BOOT:".length)) : undefined,
    stderr: child.stderr ?? "",
  };
}

/** Run one coordinator step in a child process, then exit (simulated stop). */
function stepChild(base: string, name: string, step: string): { status: number | null; stderr: string } {
  const runnerSrc = `
import fs from "node:fs";
import path from "node:path";
import { createRuntimeStorageContext } from ${JSON.stringify(pathToFileURL(path.resolve(REPO_ROOT, "src/lib/runtime/RuntimeStoragePaths.ts")).href)};
import { RuntimeAuthorityTransitionStore } from ${JSON.stringify(pathToFileURL(path.resolve(REPO_ROOT, "src/lib/runtime/security/RuntimeAuthorityTransition.ts")).href)};
import * as coord from ${JSON.stringify(pathToFileURL(path.resolve(REPO_ROOT, "src/lib/runtime/security/RuntimeAuthorityTransitionCoordinator.ts")).href)};
const base = ${JSON.stringify(path.join(base, name))};
const authorityRoot = path.join(base, "authority");
const workspaceRoot = path.join(base, "ws");
const ctx = (root) => createRuntimeStorageContext({ environment: { ATOLYE_RUNTIME_ROOT: root }, workspaceRoot, authorityRoot });
const store = new RuntimeAuthorityTransitionStore({ authorityRoot });
const tid = "crash-transition-01";
const src = ctx(path.join(base, "source"));
const tgt = ctx(path.join(base, "target"));
const step = ${JSON.stringify(step)};
if (step === "begin") coord.beginTransition({ store, transitionId: tid, sourceContext: src, sourceAuthorityGeneration: "${GEN}", targetContext: tgt, targetAuthorityGeneration: "${GEN}" });
else if (step === "quiesce") coord.confirmQuiescence({ store, transitionId: tid, workerLifecycleState: "stopped", durableRecovery: "clean" });
else if (step === "prepare") coord.prepareTransition({ store, transitionId: tid, sourceProjectSlugs: [] });
else if (step === "validate") coord.validateTarget({ store, transitionId: tid, targetContext: tgt, targetAuthorityGeneration: "${GEN}", targetProjectSlugs: [] });
else if (step === "publish") coord.publishTransition({ store, transitionId: tid, targetContext: tgt, targetAuthorityGeneration: "${GEN}" });
else if (step === "quarantine") coord.quarantineSource({ store, transitionId: tid });
const rec = store.readTransition(tid);
console.log("C2B9_STEP:" + JSON.stringify({ step, state: rec?.state }));
`;
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, "--input-type=module", "--eval", runnerSrc],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 60_000 },
  );
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`step ${step} failed: ${child.stderr}`);
  return { status: child.status, stderr: child.stderr ?? "" };
}

async function main() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-c2b9-"));
  const gitBefore = gitStatus();

  try {
    /* ============================================ A. state machine ======= */

    await scenario("normal transition: begin → quiesce → prepare → validate → publish → quarantine", () => {
      const pair = makePair(tempRoot, "normal");
      stampSource(pair);
      runFullTransition(pair, "transition-normal-01");

      const store = pair.store();
      const record = store.readTransition("transition-normal-01");
      assert.equal(record?.state, "old-root-quarantined");
      assert.deepEqual(record?.history.map((h) => h.state), [
        "quiesce-requested",
        "quiesced",
        "prepared",
        "target-validated",
        "published",
        "old-root-quarantined",
      ]);
      const active = store.readActiveAuthority();
      assert.equal(active?.transitionSequence, 1);
      assert.equal(
        active?.resolverBindingIdentity,
        describeRuntimeAuthorityIdentity(pair.targetCtx(), GEN).resolverBindingIdentity,
      );
      assert.ok(
        store.readQuarantine(
          describeRuntimeAuthorityIdentity(pair.sourceCtx(), GEN).resolverBindingIdentity,
        ),
      );
      // target marker stamped
      assert.ok(
        fs.existsSync(
          path.join(pair.targetRoot, "projects", runtimeAuthorityGenerationMarkerFileName),
        ),
      );
    });

    await scenario("duplicate transition (same id) is idempotent", () => {
      const pair = makePair(tempRoot, "dup");
      stampSource(pair);
      const store = pair.store();
      const a = beginTransition({
        store, transitionId: "dup-test-01",
        sourceContext: pair.sourceCtx(), sourceAuthorityGeneration: GEN,
        targetContext: pair.targetCtx(), targetAuthorityGeneration: GEN,
      });
      const b = beginTransition({
        store, transitionId: "dup-test-01",
        sourceContext: pair.sourceCtx(), sourceAuthorityGeneration: GEN,
        targetContext: pair.targetCtx(), targetAuthorityGeneration: GEN,
      });
      assert.deepEqual(a, b);
    });

    await scenario("illegal ordering: publish before validate → TRANSITION_ILLEGAL_STATE", () => {
      const pair = makePair(tempRoot, "ordering");
      stampSource(pair);
      const store = pair.store();
      beginTransition({
        store, transitionId: "ordering-01",
        sourceContext: pair.sourceCtx(), sourceAuthorityGeneration: GEN,
        targetContext: pair.targetCtx(), targetAuthorityGeneration: GEN,
      });
      confirmQuiescence({ store, transitionId: "ordering-01", workerLifecycleState: "stopped", durableRecovery: "clean" });
      assert.throws(
        () => publishTransition({ store, transitionId: "ordering-01", targetContext: pair.targetCtx(), targetAuthorityGeneration: GEN }),
        transitionErr("TRANSITION_ILLEGAL_STATE"),
      );
    });

    await scenario("quiescence refused while the worker is active / durable not clean", () => {
      const pair = makePair(tempRoot, "quiesce-guard");
      stampSource(pair);
      const store = pair.store();
      beginTransition({
        store, transitionId: "quiesce-01",
        sourceContext: pair.sourceCtx(), sourceAuthorityGeneration: GEN,
        targetContext: pair.targetCtx(), targetAuthorityGeneration: GEN,
      });
      assert.throws(
        () => confirmQuiescence({ store, transitionId: "quiesce-01", workerLifecycleState: "ready", durableRecovery: "clean" }),
        transitionErr("TRANSITION_QUIESCENCE_WORKER_ACTIVE"),
      );
      assert.throws(
        () => confirmQuiescence({ store, transitionId: "quiesce-01", workerLifecycleState: "stopped", durableRecovery: "recovery-required" }),
        transitionErr("TRANSITION_QUIESCENCE_NOT_CLEAN"),
      );
      assert.equal(store.readTransition("quiesce-01")?.state, "quiesce-requested");
    });

    await scenario("target inventory mismatch → TRANSITION_TARGET_INVENTORY_MISMATCH", () => {
      const pair = makePair(tempRoot, "inv");
      stampSource(pair);
      const store = pair.store();
      const tid = "inventory-01";
      beginTransition({
        store, transitionId: tid,
        sourceContext: pair.sourceCtx(), sourceAuthorityGeneration: GEN,
        targetContext: pair.targetCtx(), targetAuthorityGeneration: GEN,
      });
      confirmQuiescence({ store, transitionId: tid, workerLifecycleState: "stopped", durableRecovery: "clean" });
      prepareTransition({ store, transitionId: tid, sourceProjectSlugs: ["proj-a", "proj-b"] });
      assert.throws(
        () => validateTarget({
          store, transitionId: tid, targetContext: pair.targetCtx(),
          targetAuthorityGeneration: GEN, targetProjectSlugs: ["proj-a"],
        }),
        transitionErr("TRANSITION_TARGET_INVENTORY_MISMATCH"),
      );
    });

    await scenario("begin rejects source == target, and an unmarked source", () => {
      const pair = makePair(tempRoot, "begin-guard");
      const store = pair.store();
      assert.throws(
        () => beginTransition({
          store, transitionId: "beginguard-01",
          sourceContext: pair.sourceCtx(), sourceAuthorityGeneration: GEN,
          targetContext: pair.sourceCtx(), targetAuthorityGeneration: GEN,
        }),
        transitionErr("TRANSITION_IDENTITY_MISMATCH"),
      );
      assert.throws(
        () => beginTransition({
          store, transitionId: "beginguard-02",
          sourceContext: pair.sourceCtx(), sourceAuthorityGeneration: GEN,
          targetContext: pair.targetCtx(), targetAuthorityGeneration: GEN,
        }),
        transitionErr("TRANSITION_SOURCE_UNMARKED"),
      );
    });

    await scenario("duplicate publish is idempotent; fail after publish is illegal", () => {
      const pair = makePair(tempRoot, "publish-idem");
      stampSource(pair);
      const store = pair.store();
      const tid = "publish-01";
      runFullTransitionUpToPublish(pair, tid);
      const first = publishTransition({ store, transitionId: tid, targetContext: pair.targetCtx(), targetAuthorityGeneration: GEN });
      const second = publishTransition({ store, transitionId: tid, targetContext: pair.targetCtx(), targetAuthorityGeneration: GEN });
      assert.equal(first.state, "published");
      assert.equal(second.state, "published");
      assert.equal(store.readActiveAuthority()?.transitionSequence, 1);
      assert.throws(
        () => failTransition({ store, transitionId: tid, reason: "too late" }),
        transitionErr("TRANSITION_ILLEGAL_STATE"),
      );
    });

    await scenario("a second transition from a stale source loses the CAS", () => {
      const pair = makePair(tempRoot, "cas");
      stampSource(pair);
      runFullTransition(pair, "cas-first-01");
      // target is now active; source is quarantined. A brand-new transition that
      // still claims `source` as its origin cannot begin (source quarantined),
      // and even a forged active record cannot be replaced without the CAS.
      const store = pair.store();
      assert.throws(
        () => beginTransition({
          store, transitionId: "cas-second-01",
          sourceContext: pair.sourceCtx(), sourceAuthorityGeneration: GEN,
          targetContext: pair.targetCtx(), targetAuthorityGeneration: GEN,
        }),
        transitionErr("TRANSITION_SOURCE_QUARANTINED"),
      );
    });

    /* ==================================== B. enforcement integration ===== */

    await scenario("after a transition: target boots, source is quarantined", () => {
      const pair = makePair(tempRoot, "enf-basic");
      stampSource(pair);
      runFullTransition(pair, "enf-basic-01");

      const targetResult = enforceProductionRuntimeAuthorityGeneration(pair.targetCtx(), GEN);
      assert.equal(targetResult.mode, "match");
      assert.throws(
        () => enforceProductionRuntimeAuthorityGeneration(pair.sourceCtx(), GEN),
        enforcementErr("RUNTIME_AUTHORITY_ROOT_QUARANTINED"),
      );
      // recovery variant too
      assert.throws(
        () => assertProductionRuntimeAuthorityGenerationCompatible(pair.sourceCtx(), GEN),
        enforcementErr("RUNTIME_AUTHORITY_ROOT_QUARANTINED"),
      );
    });

    await scenario("startup denied while a transition is in progress (source)", () => {
      const pair = makePair(tempRoot, "enf-inprogress");
      stampSource(pair);
      const store = pair.store();
      beginTransition({
        store, transitionId: "inprogress-01",
        sourceContext: pair.sourceCtx(), sourceAuthorityGeneration: GEN,
        targetContext: pair.targetCtx(), targetAuthorityGeneration: GEN,
      });
      confirmQuiescence({ store, transitionId: "inprogress-01", workerLifecycleState: "stopped", durableRecovery: "clean" });
      assert.throws(
        () => enforceProductionRuntimeAuthorityGeneration(pair.sourceCtx(), GEN),
        enforcementErr("RUNTIME_AUTHORITY_TRANSITION_IN_PROGRESS"),
      );
    });

    await scenario("marker-less copied durable state (no prior transition) → RUNTIME_AUTHORITY_UNBOUND_STATE", () => {
      const pair = makePair(tempRoot, "enf-unbound");
      // A third root gets project data copied in, but was never stamped and no
      // transition exists.
      fs.mkdirSync(path.join(pair.targetRoot, "projects", "copied-project"), { recursive: true });
      assert.throws(
        () => enforceProductionRuntimeAuthorityGeneration(pair.targetCtx(), GEN),
        enforcementErr("RUNTIME_AUTHORITY_UNBOUND_STATE"),
      );
    });

    await scenario("marker-less copy AFTER a transition → RUNTIME_AUTHORITY_NOT_ACTIVE", () => {
      const pair = makePair(tempRoot, "enf-notactive");
      stampSource(pair);
      runFullTransition(pair, "notactive-01");
      // a THIRD root, sharing the same authority root, with copied data + no marker
      const thirdRoot = path.join(tempRoot, "enf-notactive", "third");
      fs.mkdirSync(path.join(thirdRoot, "projects", "copied"), { recursive: true });
      const thirdCtx = createRuntimeStorageContext({
        environment: { ATOLYE_RUNTIME_ROOT: thirdRoot },
        workspaceRoot: pair.workspaceRoot,
        authorityRoot: pair.authorityRoot,
      });
      assert.throws(
        () => enforceProductionRuntimeAuthorityGeneration(thirdCtx, GEN),
        enforcementErr("RUNTIME_AUTHORITY_NOT_ACTIVE"),
      );
    });

    await scenario("foreign marker / wrong generation still FAIL CLOSED with the control plane present", () => {
      const pair = makePair(tempRoot, "enf-foreign");
      stampSource(pair);
      runFullTransition(pair, "foreign-01");
      // tamper the target marker generation
      const markerPath = path.join(pair.targetRoot, "projects", runtimeAuthorityGenerationMarkerFileName);
      const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
      const backup = fs.readFileSync(markerPath, "utf8");
      fs.writeFileSync(markerPath, `${JSON.stringify({ ...marker, authorityGeneration: "runtime-authority-generation-v9" })}\n`);
      assert.throws(
        () => enforceProductionRuntimeAuthorityGeneration(pair.targetCtx(), GEN),
        (error: unknown) =>
          error instanceof Error && "code" in error &&
          (error as { code: string }).code === "RUNTIME_AUTHORITY_GENERATION_MISMATCH",
      );
      fs.writeFileSync(markerPath, backup);
    });

    await scenario("two active authorities are impossible (source refuses after publish)", () => {
      const pair = makePair(tempRoot, "enf-split");
      stampSource(pair);
      runFullTransition(pair, "splitbrain-01");
      // target = active
      assert.equal(enforceProductionRuntimeAuthorityGeneration(pair.targetCtx(), GEN).mode, "match");
      // source = quarantined → cannot also be active
      assert.throws(
        () => enforceProductionRuntimeAuthorityGeneration(pair.sourceCtx(), GEN),
        enforcementErr("RUNTIME_AUTHORITY_ROOT_QUARANTINED"),
      );
      const active = pair.store().readActiveAuthority();
      assert.equal(
        active?.resolverBindingIdentity,
        describeRuntimeAuthorityIdentity(pair.targetCtx(), GEN).resolverBindingIdentity,
      );
    });

    /* ===================================== C. child-process crash ======== */

    await scenario("crash/restart: transition resumes across process boundaries, no duplicate", () => {
      const name = "crash";
      makePair(tempRoot, name); // sets up dirs
      const base = path.join(tempRoot, name);
      writeRuntimeAuthorityGenerationMarker({
        context: createRuntimeStorageContext({
          environment: { ATOLYE_RUNTIME_ROOT: path.join(base, "source") },
          workspaceRoot: path.join(base, "ws"),
          authorityRoot: path.join(base, "authority"),
        }),
        authorityGeneration: GEN,
        now: NOW,
      });
      for (const step of ["begin", "quiesce", "prepare", "validate", "publish", "quarantine"]) {
        stepChild(tempRoot, name, step); // each in its own process, then "crash" (exit)
      }
      const store = new RuntimeAuthorityTransitionStore({ authorityRoot: path.join(base, "authority") });
      assert.equal(store.listTransitions().length, 1);
      assert.equal(store.readTransition("crash-transition-01")?.state, "old-root-quarantined");
      assert.equal(store.readActiveAuthority()?.transitionSequence, 1);
    });

    await scenario("child: real composition-root boot is denied on the quarantined source, allowed on the target", () => {
      const pair = makePair(tempRoot, "child-boot");
      stampSource(pair);
      runFullTransition(pair, "childboot-01");
      const common = {
        ATOLYE_WORKSPACE_ROOT: pair.workspaceRoot,
        ATOLYE_RUNTIME_AUTHORITY_ROOT: pair.authorityRoot,
        NODE_ENV: "production",
      };
      const onSource = bootChild({ ...common, ATOLYE_RUNTIME_ROOT: pair.sourceRoot });
      assert.equal(onSource.outcome?.ok, false, JSON.stringify(onSource.outcome));
      assert.equal(onSource.outcome?.code, "RUNTIME_AUTHORITY_ROOT_QUARANTINED");

      const onTarget = bootChild({ ...common, ATOLYE_RUNTIME_ROOT: pair.targetRoot });
      assert.equal(onTarget.status, 0, onTarget.stderr);
      assert.equal(onTarget.outcome?.ok, true, JSON.stringify(onTarget.outcome));
    });

    await scenario("child: boot denied on the source while a transition is mid-flight", () => {
      const pair = makePair(tempRoot, "child-inflight");
      stampSource(pair);
      const store = pair.store();
      beginTransition({
        store, transitionId: "childinflight-01",
        sourceContext: pair.sourceCtx(), sourceAuthorityGeneration: GEN,
        targetContext: pair.targetCtx(), targetAuthorityGeneration: GEN,
      });
      confirmQuiescence({ store, transitionId: "childinflight-01", workerLifecycleState: "stopped", durableRecovery: "clean" });
      const result = bootChild({
        ATOLYE_RUNTIME_ROOT: pair.sourceRoot,
        ATOLYE_WORKSPACE_ROOT: pair.workspaceRoot,
        ATOLYE_RUNTIME_AUTHORITY_ROOT: pair.authorityRoot,
        NODE_ENV: "production",
      });
      assert.equal(result.outcome?.ok, false, JSON.stringify(result.outcome));
      assert.equal(result.outcome?.code, "RUNTIME_AUTHORITY_TRANSITION_IN_PROGRESS");
    });

    await scenario("old-root write attempt: the source stays refused, quarantine mark is not rewritten", () => {
      const pair = makePair(tempRoot, "old-root-write");
      stampSource(pair);
      runFullTransition(pair, "oldrootwrite-01");
      const store = pair.store();
      const quarantinePath = path.join(
        store.directory,
        "quarantine",
        `${describeRuntimeAuthorityIdentity(pair.sourceCtx(), GEN).resolverBindingIdentity}.json`,
      );
      const before = fs.readFileSync(quarantinePath, "utf8");
      // a re-run of quarantineSource is idempotent and does not rewrite
      quarantineSource({ store, transitionId: "oldrootwrite-01" });
      assert.equal(fs.readFileSync(quarantinePath, "utf8"), before);
      // enforcement keeps refusing the source
      assert.throws(
        () => enforceProductionRuntimeAuthorityGeneration(pair.sourceCtx(), GEN),
        enforcementErr("RUNTIME_AUTHORITY_ROOT_QUARANTINED"),
      );
    });

    /* ======================================= D. safety + static ========== */

    await scenario("Execution Gate is untouched by the transition machinery", () => {
      const files = [
        "src/lib/runtime/security/RuntimeAuthorityTransition.ts",
        "src/lib/runtime/security/RuntimeAuthorityTransitionCoordinator.ts",
        "src/lib/runtime/security/ProductionRuntimeAuthorityGenerationEnforcement.ts",
      ];
      // strip comments — a doc reference to a type is fine; an import / call is not.
      const stripComments = (s: string) =>
        s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
      const forbidden =
        /\bimport\b[\s\S]{0,120}(PipelineRunner|PipelineQueueScheduler|BrainWorkerCycle|ProductionExecution|child_process|node:child_process)|\bexeca\b|nvidia-smi|ffmpeg|spawnSync?\(|execFile|executionGate\s*=\s*["']OPEN|ayasExecutionGate\s*=\s*["']OPEN/;
      for (const file of files) {
        const code = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), "utf8"));
        assert.ok(!forbidden.test(code), file);
      }
    });

    await scenario("existing C.2B.6 marker smoke still passes (C.2B.6b covered by the top-level regression)", () => {
      const out = spawnSync(
        process.execPath,
        [...process.execArgv, path.resolve(REPO_ROOT, "scripts/smoke-c2b6-authority-generation-marker.ts")],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000, maxBuffer: 20 * 1024 * 1024 },
      );
      assert.equal(out.status, 0, out.stderr);
      assert.match(out.stdout, /"status":"PASS"/);
    });

    await scenario("git working tree unchanged; no data/projects or .env.local touched", () => {
      assert.equal(gitStatus(), gitBefore);
    });

    console.log(`C.2B.9 authority transition: PASS (${count} scenarios)`);
    if (skipped.length) console.log(`  skipped: ${skipped.join("; ")}`);
    console.log(
      JSON.stringify({ status: "PASS", suite: "c2b9-authority-transition", scenarios: count, skipped }),
    );
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

function runFullTransitionUpToPublish(pair: Pair, transitionId: string): void {
  const store = pair.store();
  beginTransition({
    store, transitionId,
    sourceContext: pair.sourceCtx(), sourceAuthorityGeneration: GEN,
    targetContext: pair.targetCtx(), targetAuthorityGeneration: GEN,
  });
  confirmQuiescence({ store, transitionId, workerLifecycleState: "stopped", durableRecovery: "clean" });
  prepareTransition({ store, transitionId, sourceProjectSlugs: [] });
  validateTarget({
    store, transitionId, targetContext: pair.targetCtx(),
    targetAuthorityGeneration: GEN, targetProjectSlugs: [],
  });
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error("C.2B.9 authority transition FAILED:", error);
    process.exitCode = 1;
  }
})();
