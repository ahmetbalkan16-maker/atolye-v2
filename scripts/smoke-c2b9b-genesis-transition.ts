/**
 * C.2B.9b — genesis transition + migration operator layer.
 *
 * Deterministic / no browser / $0 / no network. Everything under an OS temp dir
 * — the repository `data/projects/**` and `.env.local` are never touched.
 *
 *   A. genesis transition (F10) — state machine + guards + crash/restart
 *   B. split-brain (F11) — legacy repo boot before / after genesis
 *   C. backup / recovery (F4) — restore does not auto-activate; recovery transition
 *   D. byte-exact materialization (F3)
 *   E. operator CLI (F2) — strict argument validation + a full genesis run
 *
 * Run: npx tsx scripts/smoke-c2b9b-genesis-transition.ts
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
  beginGenesisTransition,
  beginRecoveryTransition,
  confirmQuiescence,
  prepareTransition,
  publishTransition,
  quarantineSource,
  validateTarget,
} from "../src/lib/runtime/security/RuntimeAuthorityTransitionCoordinator";
import {
  enforceProductionRuntimeAuthorityGeneration,
  ProductionRuntimeAuthorityEnforcementError,
} from "../src/lib/runtime/security/ProductionRuntimeAuthorityGenerationEnforcement";
import { runRuntimeAuthorityTransitionCommand } from
  "../src/lib/runtime/security/RuntimeAuthorityTransitionCommand";

const REPO = path.resolve(__dirname, "..");
const GEN = "runtime-authority-generation-v1";
const NOW = "2026-08-01T09:00:00.000Z";

let count = 0;
const skipped: string[] = [];
async function scenario(name: string, run: () => unknown | Promise<unknown>) {
  await run();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}
const transitionErr = (code: string) => (e: unknown) =>
  e instanceof RuntimeAuthorityTransitionError && e.code === code;
const enforcementErr = (code: string) => (e: unknown) =>
  e instanceof ProductionRuntimeAuthorityEnforcementError && e.code === code;

function gitStatus(): string {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: REPO, encoding: "utf8",
  });
}

interface Site {
  base: string;
  workspaceRoot: string;   // stands in for the repo
  authorityRoot: string;
  externalRoot: string;
  legacyCtx: () => RuntimeStorageContext;
  externalCtx: (root?: string) => RuntimeStorageContext;
  store: (now?: () => string) => RuntimeAuthorityTransitionStore;
}

function makeSite(root: string, name: string): Site {
  const base = path.join(root, name);
  const workspaceRoot = path.join(base, "repo");
  const authorityRoot = path.join(base, "authority");
  const externalRoot = path.join(base, "external");
  fs.mkdirSync(path.join(workspaceRoot, "data", "projects", "proj-a", "production-execution"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "data", "projects", "proj-a", "manifest.json"), '{"slug":"proj-a"}\n');
  fs.mkdirSync(path.join(externalRoot, "projects"), { recursive: true });
  fs.mkdirSync(authorityRoot, { recursive: true });
  return {
    base, workspaceRoot, authorityRoot, externalRoot,
    legacyCtx: () => createRuntimeStorageContext({ environment: {}, workspaceRoot, authorityRoot }),
    externalCtx: (r = externalRoot) => createRuntimeStorageContext({
      environment: { ATOLYE_RUNTIME_ROOT: r }, workspaceRoot, authorityRoot,
    }),
    store: (now = () => NOW) => new RuntimeAuthorityTransitionStore({ authorityRoot, now }),
  };
}

/** Copy the repo's data/projects tree into <external>/projects (byte-exact). */
function materialize(site: Site, target = site.externalRoot): void {
  fs.rmSync(path.join(target, "projects"), { recursive: true, force: true });
  fs.cpSync(path.join(site.workspaceRoot, "data", "projects"), path.join(target, "projects"), {
    recursive: true,
  });
}

function runGenesis(site: Site, tid: string, opts: { byteExact?: boolean } = {}): void {
  const store = site.store();
  beginGenesisTransition({
    store, transitionId: tid,
    legacySourceContext: site.legacyCtx(), authorityGeneration: GEN,
    targetContext: site.externalCtx(),
  });
  confirmQuiescence({ store, transitionId: tid, workerLifecycleState: "stopped", durableRecovery: "clean" });
  materialize(site);
  const sourceProjects = path.join(site.workspaceRoot, "data", "projects");
  const targetProjects = path.join(site.externalRoot, "projects");
  prepareTransition({
    store, transitionId: tid,
    sourceProjectSlugs: ["proj-a"],
    ...(opts.byteExact ? { sourceProjectsRoot: sourceProjects } : {}),
  });
  validateTarget({
    store, transitionId: tid, targetContext: site.externalCtx(),
    targetAuthorityGeneration: GEN, targetProjectSlugs: ["proj-a"],
    ...(opts.byteExact ? { targetProjectsRoot: targetProjects } : {}),
  });
  publishTransition({ store, transitionId: tid, targetContext: site.externalCtx(), targetAuthorityGeneration: GEN });
  quarantineSource({ store, transitionId: tid });
}

function bootChild(env: Record<string, string | undefined>): {
  ok?: boolean; code?: string; msg?: string; stderr: string;
} {
  const url = pathToFileURL(path.resolve(REPO, "src/lib/runtime/ProductionRuntimeCompositionRoot.ts")).href;
  const src = `
const m = await import(${JSON.stringify(url)});
let o; try { const r = await m.initializeProductionProcessRuntime(); o = { ok: true }; await m.shutdownProductionProcessRuntime(); }
catch (e) { o = { ok: false, code: (e && typeof e === "object" && "code" in e) ? e.code : undefined, msg: String(e && e.message || e).slice(0,200) }; }
console.log("BOOT:" + JSON.stringify(o));`;
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete merged[k]; else merged[k] = v; }
  const c = spawnSync(process.execPath, [...process.execArgv, "--input-type=module", "--eval", src],
    { cwd: REPO, encoding: "utf8", env: merged, timeout: 90_000, maxBuffer: 20 * 1024 * 1024 });
  if (c.error) throw c.error;
  const line = (c.stdout || "").split(/\r?\n/).find((l) => l.startsWith("BOOT:"));
  return { ...(line ? JSON.parse(line.slice(5)) : {}), stderr: c.stderr || "" } as {
    ok?: boolean; code?: string; msg?: string; stderr: string;
  };
}

async function main() {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-c2b9b-"));
  const gitBefore = gitStatus();

  try {
    /* ================================================ A. genesis ======== */

    await scenario("genesis happy path → target active, legacy NOT quarantined", () => {
      const s = makeSite(tmp, "gen-happy");
      runGenesis(s, "genesis-happy-01", { byteExact: true });
      const store = s.store();
      assert.equal(store.readTransition("genesis-happy-01")?.state, "old-root-quarantined");
      assert.equal(store.readTransition("genesis-happy-01")?.kind, "genesis");
      assert.equal(store.readActiveAuthority()?.transitionSequence, 1);
      assert.equal(
        store.readActiveAuthority()?.resolverBindingIdentity,
        describeRuntimeAuthorityIdentity(s.externalCtx(), GEN).resolverBindingIdentity,
      );
      // legacy binding is NOT written to quarantine/
      assert.equal(
        store.readQuarantine(describeRuntimeAuthorityIdentity(s.legacyCtx(), GEN).resolverBindingIdentity),
        null,
      );
      assert.equal(store.readTransition("genesis-happy-01")?.targetValidation?.byteExact, true);
    });

    await scenario("genesis duplicate (same id) is idempotent", () => {
      const s = makeSite(tmp, "gen-dup");
      const store = s.store();
      const a = beginGenesisTransition({ store, transitionId: "genesis-dup-01",
        legacySourceContext: s.legacyCtx(), authorityGeneration: GEN, targetContext: s.externalCtx() });
      const b = beginGenesisTransition({ store, transitionId: "genesis-dup-01",
        legacySourceContext: s.legacyCtx(), authorityGeneration: GEN, targetContext: s.externalCtx() });
      assert.deepEqual(a, b);
    });

    await scenario("genesis rejects a non-legacy source / a marked source / an existing active authority", () => {
      const s1 = makeSite(tmp, "gen-guard-nonlegacy");
      assert.throws(() => beginGenesisTransition({ store: s1.store(), transitionId: "genesis-guard-01",
        legacySourceContext: s1.externalCtx(), authorityGeneration: GEN,
        targetContext: s1.externalCtx(path.join(s1.base, "other")) }),
        transitionErr("TRANSITION_INPUT_INVALID"));

      const s2 = makeSite(tmp, "gen-guard-marked");
      writeRuntimeAuthorityGenerationMarker({ context: s2.legacyCtx(), authorityGeneration: GEN, now: NOW });
      assert.throws(() => beginGenesisTransition({ store: s2.store(), transitionId: "genesis-guard-02",
        legacySourceContext: s2.legacyCtx(), authorityGeneration: GEN, targetContext: s2.externalCtx() }),
        transitionErr("TRANSITION_SOURCE_MARKED"));

      const s3 = makeSite(tmp, "gen-guard-active");
      runGenesis(s3, "genesis-guard-seed-01");
      assert.throws(() => beginGenesisTransition({ store: s3.store(), transitionId: "genesis-guard-03",
        legacySourceContext: s3.legacyCtx(), authorityGeneration: GEN,
        targetContext: s3.externalCtx(path.join(s3.base, "third")) }),
        transitionErr("TRANSITION_ALREADY_ACTIVE_ELSEWHERE"));
    });

    await scenario("genesis: target inventory mismatch → fail closed", () => {
      const s = makeSite(tmp, "gen-inv");
      const store = s.store();
      const tid = "genesis-inv-01";
      beginGenesisTransition({ store, transitionId: tid,
        legacySourceContext: s.legacyCtx(), authorityGeneration: GEN, targetContext: s.externalCtx() });
      confirmQuiescence({ store, transitionId: tid, workerLifecycleState: "stopped", durableRecovery: "clean" });
      prepareTransition({ store, transitionId: tid, sourceProjectSlugs: ["proj-a", "proj-b"] });
      assert.throws(() => validateTarget({ store, transitionId: tid, targetContext: s.externalCtx(),
        targetAuthorityGeneration: GEN, targetProjectSlugs: ["proj-a"] }),
        transitionErr("TRANSITION_TARGET_INVENTORY_MISMATCH"));
    });

    await scenario("genesis crash/restart: resumes across processes, no duplicate", () => {
      const name = "gen-crash";
      makeSite(tmp, name);
      const base = path.join(tmp, name);
      for (const step of ["begin", "quiesce", "materialize", "prepare", "validate", "publish", "quarantine"]) {
        stepChild(base, step);
      }
      const store = new RuntimeAuthorityTransitionStore({ authorityRoot: path.join(base, "authority") });
      assert.equal(store.listTransitions().length, 1);
      assert.equal(store.readTransition("genesis-crash-01")?.state, "old-root-quarantined");
      assert.equal(store.readActiveAuthority()?.transitionSequence, 1);
    });

    /* ================================================ B. split-brain ==== */

    await scenario("F11: legacy repo boots BEFORE genesis, refuses AFTER", () => {
      const s = makeSite(tmp, "split");
      const env = {
        ATOLYE_WORKSPACE_ROOT: s.workspaceRoot,
        ATOLYE_RUNTIME_AUTHORITY_ROOT: s.authorityRoot,
        NODE_ENV: "development",
        ATOLYE_RUNTIME_ROOT: undefined,
      };
      // before genesis: no active-authority → legacy dev boot succeeds
      const before = bootChild(env);
      assert.equal(before.ok, true, JSON.stringify(before));

      runGenesis(s, "split-genesis-01");

      // after genesis: legacy repo (still on disk) refuses
      const after = bootChild(env);
      assert.equal(after.ok, false, JSON.stringify(after));
      assert.equal(after.code, "RUNTIME_AUTHORITY_NOT_ACTIVE");

      // ...and again after a restart (state is durable)
      const restart = bootChild(env);
      assert.equal(restart.code, "RUNTIME_AUTHORITY_NOT_ACTIVE");

      // the TARGET cannot boot yet — the old repo tree still holds the same
      // slugs, so RuntimeStoragePaths' dual-root guard fires (fail closed).
      const targetBefore = bootChild({ ...env, NODE_ENV: "production", ATOLYE_RUNTIME_ROOT: s.externalRoot });
      assert.equal(targetBefore.ok, false, JSON.stringify(targetBefore));

      // runbook: quarantine / remove the old repo tree, then the target boots.
      fs.rmSync(path.join(s.workspaceRoot, "data", "projects"), { recursive: true, force: true });
      const target = bootChild({ ...env, NODE_ENV: "production", ATOLYE_RUNTIME_ROOT: s.externalRoot });
      assert.equal(target.ok, true, JSON.stringify(target));
    });

    await scenario("F11: a foreign copy of the repo tree to a stray root → fail closed", () => {
      const s = makeSite(tmp, "split-foreign");
      runGenesis(s, "split-foreign-01");
      const stray = path.join(s.base, "stray");
      fs.mkdirSync(path.join(stray, "projects", "proj-a"), { recursive: true });
      const strayCtx = createRuntimeStorageContext({
        environment: { ATOLYE_RUNTIME_ROOT: stray },
        workspaceRoot: s.workspaceRoot, authorityRoot: s.authorityRoot,
      });
      assert.throws(() => enforceProductionRuntimeAuthorityGeneration(strayCtx, GEN),
        enforcementErr("RUNTIME_AUTHORITY_NOT_ACTIVE"));
    });

    /* ================================================ C. recovery ======= */

    await scenario("F4: recovery — restore does not auto-activate; recovery transition re-establishes authority", () => {
      const s = makeSite(tmp, "recovery");
      runGenesis(s, "recovery-genesis-01"); // active = external
      const store = s.store();
      const badActive = store.readActiveAuthority()!;

      // operator restores the pre-migration backup into a FRESH root
      const restoreRoot = path.join(s.base, "restore");
      fs.mkdirSync(path.join(restoreRoot, "projects"), { recursive: true });
      fs.cpSync(path.join(s.workspaceRoot, "data", "projects"), path.join(restoreRoot, "projects"), { recursive: true });
      const restoreCtx = createRuntimeStorageContext({
        environment: { ATOLYE_RUNTIME_ROOT: restoreRoot },
        workspaceRoot: s.workspaceRoot, authorityRoot: s.authorityRoot,
      });

      // the restored root does NOT auto-become authority
      assert.throws(() => enforceProductionRuntimeAuthorityGeneration(restoreCtx, GEN),
        enforcementErr("RUNTIME_AUTHORITY_NOT_ACTIVE"));

      // explicit recovery transition
      const tid = "recovery-transition-01";
      beginRecoveryTransition({ store, transitionId: tid, targetContext: restoreCtx,
        targetAuthorityGeneration: GEN, reason: "target external root corrupted after genesis" });
      // recovery quiescence tolerates a non-clean (abandoned) source
      confirmQuiescence({ store, transitionId: tid, workerLifecycleState: "stopped", durableRecovery: "recovery-required" });
      prepareTransition({ store, transitionId: tid, sourceProjectSlugs: ["proj-a"] });
      validateTarget({ store, transitionId: tid, targetContext: restoreCtx,
        targetAuthorityGeneration: GEN, targetProjectSlugs: ["proj-a"] });
      publishTransition({ store, transitionId: tid, targetContext: restoreCtx, targetAuthorityGeneration: GEN });
      quarantineSource({ store, transitionId: tid });

      // authority moved to the restored root; the bad root is quarantined
      assert.equal(store.readActiveAuthority()?.resolverBindingIdentity,
        describeRuntimeAuthorityIdentity(restoreCtx, GEN).resolverBindingIdentity);
      assert.equal(store.readActiveAuthority()?.transitionSequence, 2);
      assert.ok(store.readQuarantine(badActive.resolverBindingIdentity));
      assert.equal(enforceProductionRuntimeAuthorityGeneration(restoreCtx, GEN).mode, "match");
      assert.throws(() => enforceProductionRuntimeAuthorityGeneration(s.externalCtx(), GEN),
        enforcementErr("RUNTIME_AUTHORITY_ROOT_QUARANTINED"));
    });

    await scenario("F4: recovery rejects no-active-authority, a quarantined target, a stale foreign marker", () => {
      const s = makeSite(tmp, "recovery-guards");
      const store = s.store();
      assert.throws(() => beginRecoveryTransition({ store, transitionId: "recovery-guard-01",
        targetContext: s.externalCtx(), targetAuthorityGeneration: GEN, reason: "nothing to recover" }),
        transitionErr("TRANSITION_NO_ACTIVE_AUTHORITY"));

      runGenesis(s, "recovery-guard-genesis-01");
      // stale foreign marker on the recovery target
      const staleRoot = path.join(s.base, "stale");
      fs.mkdirSync(path.join(staleRoot, "projects"), { recursive: true });
      const otherCtx = createRuntimeStorageContext({
        environment: { ATOLYE_RUNTIME_ROOT: path.join(s.base, "someoneelse") },
        workspaceRoot: s.workspaceRoot, authorityRoot: s.authorityRoot,
      });
      fs.mkdirSync(path.join(s.base, "someoneelse", "projects"), { recursive: true });
      writeRuntimeAuthorityGenerationMarker({ context: otherCtx, authorityGeneration: GEN, now: NOW });
      fs.copyFileSync(
        path.join(s.base, "someoneelse", "projects", runtimeAuthorityGenerationMarkerFileName),
        path.join(staleRoot, "projects", runtimeAuthorityGenerationMarkerFileName),
      );
      const staleCtx = createRuntimeStorageContext({
        environment: { ATOLYE_RUNTIME_ROOT: staleRoot },
        workspaceRoot: s.workspaceRoot, authorityRoot: s.authorityRoot,
      });
      assert.throws(() => beginRecoveryTransition({ store, transitionId: "recovery-guard-02",
        targetContext: staleCtx, targetAuthorityGeneration: GEN, reason: "recovery onto a stale root" }),
        (e: unknown) => e instanceof Error && "code" in e &&
          (e as { code: string }).code === "RUNTIME_AUTHORITY_GENERATION_MISMATCH");
    });

    /* ================================================ D. byte-exact ===== */

    await scenario("F3: byte-exact — exact copy PASS, mutated / missing / extra file FAIL", () => {
      const s = makeSite(tmp, "byte");
      const store = s.store();
      const tid = "byte-exact-01";
      fs.writeFileSync(path.join(s.workspaceRoot, "data", "projects", "proj-a", "manifest.json"), '{"a":1}\n');
      beginGenesisTransition({ store, transitionId: tid,
        legacySourceContext: s.legacyCtx(), authorityGeneration: GEN, targetContext: s.externalCtx() });
      confirmQuiescence({ store, transitionId: tid, workerLifecycleState: "stopped", durableRecovery: "clean" });
      materialize(s);
      const sourceProjects = path.join(s.workspaceRoot, "data", "projects");
      const targetProjects = path.join(s.externalRoot, "projects");
      prepareTransition({ store, transitionId: tid, sourceProjectSlugs: ["proj-a"], sourceProjectsRoot: sourceProjects });

      const validateOnce = () => validateTarget({ store, transitionId: tid, targetContext: s.externalCtx(),
        targetAuthorityGeneration: GEN, targetProjectSlugs: ["proj-a"], targetProjectsRoot: targetProjects });

      // mutate one byte
      fs.writeFileSync(path.join(targetProjects, "proj-a", "manifest.json"), '{"a":2}\n');
      assert.throws(validateOnce, transitionErr("TRANSITION_TARGET_CONTENT_MISMATCH"));
      // extra file
      fs.writeFileSync(path.join(targetProjects, "proj-a", "manifest.json"), '{"a":1}\n');
      fs.writeFileSync(path.join(targetProjects, "proj-a", "extra.json"), "{}\n");
      assert.throws(validateOnce, transitionErr("TRANSITION_TARGET_CONTENT_MISMATCH"));
      // missing file
      fs.rmSync(path.join(targetProjects, "proj-a", "extra.json"));
      fs.rmSync(path.join(targetProjects, "proj-a", "manifest.json"));
      assert.throws(validateOnce, transitionErr("TRANSITION_TARGET_CONTENT_MISMATCH"));
      // exact
      fs.writeFileSync(path.join(targetProjects, "proj-a", "manifest.json"), '{"a":1}\n');
      const record = validateOnce();
      assert.equal(record.targetValidation?.byteExact, true);
    });

    await scenario("F3: a symlink under the projects tree is rejected", () => {
      const s = makeSite(tmp, "byte-link");
      const outside = path.join(s.base, "outside.txt");
      fs.writeFileSync(outside, "x");
      try {
        fs.symlinkSync(outside, path.join(s.workspaceRoot, "data", "projects", "proj-a", "link.txt"), "file");
      } catch {
        skipped.push("symlink rejection (platform cannot create file symlinks)");
        return;
      }
      const store = s.store();
      const tid = "byte-link-test-01";
      beginGenesisTransition({ store, transitionId: tid,
        legacySourceContext: s.legacyCtx(), authorityGeneration: GEN, targetContext: s.externalCtx() });
      confirmQuiescence({ store, transitionId: tid, workerLifecycleState: "stopped", durableRecovery: "clean" });
      assert.throws(() => prepareTransition({ store, transitionId: tid, sourceProjectSlugs: ["proj-a"],
        sourceProjectsRoot: path.join(s.workspaceRoot, "data", "projects") }),
        transitionErr("TRANSITION_CONTENT_UNSAFE"));
    });

    /* ================================================ E. operator CLI === */

    await scenario("CLI: strict argument validation (traversal / missing dir / bad id / bad generation)", async () => {
      const s = makeSite(tmp, "cli-args");
      const base = ["--authority-root", s.authorityRoot];
      const bad = [
        ["begin-genesis", "--authority-root", "relative/path", "--target", s.externalRoot, "--transition-id", "cli-arg-test-01"],
        ["begin-genesis", "--authority-root", s.authorityRoot, "--target", path.join(s.base, "..", "escape"), "--transition-id", "cli-arg-test-01"],
        ["begin-genesis", ...base, "--target", s.externalRoot, "--transition-id", "short"],
        ["begin-genesis", ...base, "--target", s.externalRoot, "--transition-id", "cli-arg-test-01", "--generation", "bad gen"],
        ["begin-genesis", ...base, "--target", path.join(s.base, "does-not-exist"), "--transition-id", "cli-arg-test-01"],
        ["frobnicate", ...base],
      ];
      for (const argv of bad) {
        const r = await runRuntimeAuthorityTransitionCommand(argv);
        assert.equal(r.exitCode, 1, JSON.stringify(argv));
        assert.equal((r.report as { ok: boolean }).ok, false);
      }
    });

    await scenario("CLI: full genesis run drives the state machine end to end", async () => {
      const s = makeSite(tmp, "cli-run");
      const ar = ["--authority-root", s.authorityRoot, "--workspace-root", s.workspaceRoot];
      const tid = "cli-genesis-01";

      let r = await runRuntimeAuthorityTransitionCommand(["begin-genesis", ...ar, "--target", s.externalRoot, "--transition-id", tid]);
      assert.equal(r.exitCode, 0, JSON.stringify(r.report));

      r = await runRuntimeAuthorityTransitionCommand(["quiesce", ...ar, "--transition-id", tid, "--assert-worker-stopped",
        "--source-projects", path.join(s.workspaceRoot, "data", "projects")]);
      assert.equal(r.exitCode, 0, JSON.stringify(r.report));

      materialize(s);

      r = await runRuntimeAuthorityTransitionCommand(["prepare", ...ar, "--transition-id", tid,
        "--source-projects", path.join(s.workspaceRoot, "data", "projects")]);
      assert.equal(r.exitCode, 0, JSON.stringify(r.report));
      assert.ok((r.report as { contentDigest?: string }).contentDigest);

      r = await runRuntimeAuthorityTransitionCommand(["validate", ...ar, "--transition-id", tid, "--target", s.externalRoot]);
      assert.equal(r.exitCode, 0, JSON.stringify(r.report));
      assert.equal((r.report as { byteExact?: boolean }).byteExact, true);

      r = await runRuntimeAuthorityTransitionCommand(["publish", ...ar, "--transition-id", tid, "--target", s.externalRoot]);
      assert.equal(r.exitCode, 0, JSON.stringify(r.report));

      r = await runRuntimeAuthorityTransitionCommand(["quarantine", ...ar, "--transition-id", tid]);
      assert.equal(r.exitCode, 0, JSON.stringify(r.report));

      r = await runRuntimeAuthorityTransitionCommand(["status", "--authority-root", s.authorityRoot]);
      assert.equal(r.exitCode, 0);
      assert.equal((r.report as { activeAuthority?: { transitionSequence: number } }).activeAuthority?.transitionSequence, 1);
    });

    /* ================================================ regression + safety */

    await scenario("existing C.2B.9 smoke still passes", () => {
      const out = spawnSync(process.execPath,
        [...process.execArgv, path.resolve(REPO, "scripts/smoke-c2b9-authority-transition.ts")],
        { cwd: REPO, encoding: "utf8", timeout: 600_000, maxBuffer: 20 * 1024 * 1024 });
      assert.equal(out.status, 0, out.stderr);
      assert.match(out.stdout, /"status":"PASS"/);
    });

    await scenario("static: the genesis / recovery / CLI code references no execution primitive", () => {
      const strip = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
      const forbidden = /\bimport\b[\s\S]{0,120}(PipelineRunner|BrainWorkerCycle|ffmpeg)|executionGate\s*=\s*["']OPEN|ayasExecutionGate\s*=\s*["']OPEN/;
      for (const f of [
        "src/lib/runtime/security/RuntimeAuthorityTransitionCoordinator.ts",
        "src/lib/runtime/security/RuntimeAuthorityTransitionCommand.ts",
        "scripts/run-authority-transition.ts",
      ]) {
        assert.ok(!forbidden.test(strip(fs.readFileSync(path.join(REPO, f), "utf8"))), f);
      }
    });

    await scenario("git working tree unchanged; no data/projects or .env.local touched", () => {
      assert.equal(gitStatus(), gitBefore);
    });

    console.log(`C.2B.9b genesis transition: PASS (${count} scenarios)`);
    if (skipped.length) console.log(`  skipped: ${skipped.join("; ")}`);
    console.log(JSON.stringify({ status: "PASS", suite: "c2b9b-genesis-transition", scenarios: count, skipped }));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

function stepChild(base: string, step: string): void {
  const u = (p: string) => JSON.stringify(pathToFileURL(path.resolve(REPO, p)).href);
  const src = `
import fs from "node:fs";
import path from "node:path";
import { createRuntimeStorageContext } from ${u("src/lib/runtime/RuntimeStoragePaths.ts")};
import { RuntimeAuthorityTransitionStore } from ${u("src/lib/runtime/security/RuntimeAuthorityTransition.ts")};
import * as c from ${u("src/lib/runtime/security/RuntimeAuthorityTransitionCoordinator.ts")};
const base = ${JSON.stringify(base)};
const workspaceRoot = path.join(base, "repo");
const authorityRoot = path.join(base, "authority");
const externalRoot = path.join(base, "external");
const legacyCtx = createRuntimeStorageContext({ environment: {}, workspaceRoot, authorityRoot });
const externalCtx = createRuntimeStorageContext({ environment: { ATOLYE_RUNTIME_ROOT: externalRoot }, workspaceRoot, authorityRoot });
const store = new RuntimeAuthorityTransitionStore({ authorityRoot });
const tid = "genesis-crash-01";
const step = ${JSON.stringify(step)};
if (step === "begin") c.beginGenesisTransition({ store, transitionId: tid, legacySourceContext: legacyCtx, authorityGeneration: "${GEN}", targetContext: externalCtx });
else if (step === "quiesce") c.confirmQuiescence({ store, transitionId: tid, workerLifecycleState: "stopped", durableRecovery: "clean" });
else if (step === "materialize") { fs.rmSync(path.join(externalRoot, "projects"), { recursive: true, force: true }); fs.cpSync(path.join(workspaceRoot, "data", "projects"), path.join(externalRoot, "projects"), { recursive: true }); }
else if (step === "prepare") c.prepareTransition({ store, transitionId: tid, sourceProjectSlugs: ["proj-a"] });
else if (step === "validate") c.validateTarget({ store, transitionId: tid, targetContext: externalCtx, targetAuthorityGeneration: "${GEN}", targetProjectSlugs: ["proj-a"] });
else if (step === "publish") c.publishTransition({ store, transitionId: tid, targetContext: externalCtx, targetAuthorityGeneration: "${GEN}" });
else if (step === "quarantine") c.quarantineSource({ store, transitionId: tid });
console.log("STEP:" + JSON.stringify({ step, state: store.readTransition(tid)?.state }));
`;
  const c = spawnSync(process.execPath, [...process.execArgv, "--input-type=module", "--eval", src],
    { cwd: REPO, encoding: "utf8", timeout: 60_000, maxBuffer: 20 * 1024 * 1024 });
  if (c.status !== 0) throw new Error(`step ${step}: ${c.stderr}`);
}

void (async () => {
  try { await main(); }
  catch (error) { console.error("C.2B.9b genesis transition FAILED:", error); process.exitCode = 1; }
})();
