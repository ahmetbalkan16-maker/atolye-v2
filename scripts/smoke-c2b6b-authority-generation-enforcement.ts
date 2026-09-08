/**
 * C.2B.6b — runtime authority generation enforcement at production startup +
 * recovery bootstrap.
 *
 * Deterministic / no browser / $0 / no network. Two layers:
 *   A. Direct unit tests of the enforcement primitive
 *      (`ProductionRuntimeAuthorityGenerationEnforcement`).
 *   B. Child-process integration: a fresh Node process imports the real
 *      `ProductionRuntimeCompositionRoot` with a controlled env and calls
 *      `initializeProductionProcessRuntime()` — proving the gate fires before
 *      any worker start / recovery / pipeline wiring, and fails closed on a
 *      generation mismatch.
 *
 * Run: npx tsx scripts/smoke-c2b6b-authority-generation-enforcement.ts
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
  assertProductionRuntimeAuthorityGenerationCompatible,
  enforceProductionRuntimeAuthorityGeneration,
  ProductionRuntimeAuthorityEnforcementError,
  RuntimeAuthorityGenerationMarkerError,
} from "../src/lib/runtime/security/ProductionRuntimeAuthorityGenerationEnforcement";
import { runtimeAuthorityGenerationMarkerFileName } from "../src/lib/runtime/security/RuntimeAuthorityGenerationMarker";

const REPO_ROOT = path.resolve(__dirname, "..");
const GEN_A = "runtime-authority-generation-v1";
const GEN_B = "runtime-authority-generation-v2";

let count = 0;
const skipped: string[] = [];
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

/** Run the real composition root in a fresh process with a controlled env. */
function bootChild(env: Record<string, string | undefined>): {
  status: number | null;
  outcome: Record<string, unknown> | undefined;
  stderr: string;
} {
  const compositionRootUrl = pathToFileURL(
    path.resolve(REPO_ROOT, "src/lib/runtime/ProductionRuntimeCompositionRoot.ts"),
  ).href;
  const source = `
const mod = await import(${JSON.stringify(compositionRootUrl)});
let outcome;
try {
  const result = await mod.initializeProductionProcessRuntime();
  outcome = { ok: true, decision: result.decision, workerState: result.worker?.state };
  await mod.shutdownProductionProcessRuntime();
} catch (error) {
  outcome = {
    ok: false,
    name: error?.name,
    code: (error && typeof error === "object" && "code" in error) ? error.code : undefined,
    message: String(error?.message ?? error).slice(0, 200),
  };
}
console.log("C2B6B_BOOT:" + JSON.stringify(outcome));
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
  const line = (child.stdout ?? "")
    .split(/\r?\n/)
    .find((l) => l.startsWith("C2B6B_BOOT:"));
  return {
    status: child.status,
    outcome: line ? JSON.parse(line.slice("C2B6B_BOOT:".length)) : undefined,
    stderr: child.stderr ?? "",
  };
}

async function main() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-c2b6b-"));
  const gitBefore = gitStatus();

  try {
    /* ---------------------------------------------------- A. unit tests --- */

    const workspaceRoot = path.join(tempRoot, "ws");
    const externalRoot = path.join(tempRoot, "external");
    await fsp.mkdir(workspaceRoot, { recursive: true });
    await fsp.mkdir(path.join(externalRoot, "projects"), { recursive: true });
    const markerPath = path.join(
      externalRoot,
      "projects",
      runtimeAuthorityGenerationMarkerFileName,
    );

    const externalCtx = (): RuntimeStorageContext =>
      createRuntimeStorageContext({
        environment: { ATOLYE_RUNTIME_ROOT: externalRoot },
        workspaceRoot,
        authorityRoot: path.join(tempRoot, "auth"),
      });
    const legacyCtx = (): RuntimeStorageContext =>
      createRuntimeStorageContext({
        environment: {},
        workspaceRoot,
        authorityRoot: path.join(tempRoot, "auth-legacy"),
      });

    await scenario("first init on an external root with projects/ → stamps the marker", () => {
      const result = enforceProductionRuntimeAuthorityGeneration(externalCtx(), GEN_A, {
        env: { NODE_ENV: "production" },
      });
      assert.equal(result.mode, "initialized");
      assert.equal(fs.existsSync(markerPath), true);
      assert.equal(JSON.parse(fs.readFileSync(markerPath, "utf8")).authorityGeneration, GEN_A);
    });

    await scenario("same generation on the same root → match, marker unchanged", () => {
      const before = fs.readFileSync(markerPath, "utf8");
      const result = enforceProductionRuntimeAuthorityGeneration(externalCtx(), GEN_A);
      assert.equal(result.mode, "match");
      assert.equal(fs.readFileSync(markerPath, "utf8"), before);
    });

    await scenario("different generation on the same root → FAIL CLOSED (MISMATCH), marker unchanged", () => {
      const before = fs.readFileSync(markerPath, "utf8");
      assert.throws(
        () => enforceProductionRuntimeAuthorityGeneration(externalCtx(), GEN_B),
        (error: unknown) =>
          error instanceof RuntimeAuthorityGenerationMarkerError &&
          error.code === "RUNTIME_AUTHORITY_GENERATION_MISMATCH",
      );
      assert.equal(fs.readFileSync(markerPath, "utf8"), before);
    });

    await scenario("recovery variant: mismatch → throws, and it NEVER writes", () => {
      const before = fs.readFileSync(markerPath, "utf8");
      assert.throws(
        () => assertProductionRuntimeAuthorityGenerationCompatible(externalCtx(), GEN_B),
        (error: unknown) =>
          error instanceof RuntimeAuthorityGenerationMarkerError &&
          error.code === "RUNTIME_AUTHORITY_GENERATION_MISMATCH",
      );
      assert.equal(fs.readFileSync(markerPath, "utf8"), before);
    });

    await scenario("recovery variant: matching generation → returns silently", () => {
      assert.doesNotThrow(() =>
        assertProductionRuntimeAuthorityGenerationCompatible(externalCtx(), GEN_A));
    });

    await scenario("recovery variant NEVER stamps an unstamped external root", () => {
      const freshExternal = path.join(tempRoot, "external-fresh");
      fs.mkdirSync(path.join(freshExternal, "projects"), { recursive: true });
      const ctx = createRuntimeStorageContext({
        environment: { ATOLYE_RUNTIME_ROOT: freshExternal },
        workspaceRoot,
        authorityRoot: path.join(tempRoot, "auth-fresh"),
      });
      assertProductionRuntimeAuthorityGenerationCompatible(ctx, GEN_A);
      assert.equal(
        fs.existsSync(
          path.join(freshExternal, "projects", runtimeAuthorityGenerationMarkerFileName),
        ),
        false,
      );
    });

    await scenario("production + ATOLYE_RUNTIME_ROOT unset → FAIL CLOSED", () => {
      assert.throws(
        () =>
          enforceProductionRuntimeAuthorityGeneration(legacyCtx(), GEN_A, {
            env: { NODE_ENV: "production" },
          }),
        (error: unknown) =>
          error instanceof ProductionRuntimeAuthorityEnforcementError &&
          error.code === "PRODUCTION_RUNTIME_ROOT_REQUIRED",
      );
    });

    await scenario("development + unset root → legacy default continues, nothing written", () => {
      const result = enforceProductionRuntimeAuthorityGeneration(legacyCtx(), GEN_A, {
        env: { NODE_ENV: "development" },
      });
      assert.equal(result.mode, "absent-unstamped");
      assert.equal(
        fs.existsSync(
          path.join(workspaceRoot, "data", "projects", runtimeAuthorityGenerationMarkerFileName),
        ),
        false,
      );
    });

    await scenario("external root with NO projects/ yet → first boot creates projects/ + stamps", () => {
      const noProjects = path.join(tempRoot, "external-noprojects");
      fs.mkdirSync(noProjects, { recursive: true });
      const ctx = createRuntimeStorageContext({
        environment: { ATOLYE_RUNTIME_ROOT: noProjects },
        workspaceRoot,
        authorityRoot: path.join(tempRoot, "auth-np"),
      });
      const result = enforceProductionRuntimeAuthorityGeneration(ctx, GEN_A);
      assert.equal(result.mode, "initialized");
      assert.equal(
        fs.existsSync(path.join(noProjects, "projects", runtimeAuthorityGenerationMarkerFileName)),
        true,
      );
    });

    await scenario("static: composition root calls the enforcement at startup AND recovery", () => {
      const src = fs.readFileSync(
        path.join(REPO_ROOT, "src/lib/runtime/ProductionRuntimeCompositionRoot.ts"),
        "utf8",
      );
      assert.match(src, /enforceProductionRuntimeAuthorityGeneration\(\s*processRuntimeStorageContext/);
      const createRecovery = src.slice(
        src.indexOf("createRecoveryBootstrap:"),
        src.indexOf("workerLifecycle: productionWorkerLifecycle"),
      );
      assert.match(
        createRecovery,
        /assertProductionRuntimeAuthorityGenerationCompatible\(/,
        "recovery bootstrap must run the read-only re-check",
      );
      // startup enforcement is before the operation scope / worker
      assert.ok(
        src.indexOf("enforceProductionRuntimeAuthorityGeneration(") <
          src.indexOf("runWithProductionRuntimeOperationContext("),
        "enforcement must precede runWithProductionRuntimeOperationContext",
      );
    });

    await scenario("static: enforcement module references no execution primitive", () => {
      const src = fs.readFileSync(
        path.join(REPO_ROOT, "src/lib/runtime/security/ProductionRuntimeAuthorityGenerationEnforcement.ts"),
        "utf8",
      );
      assert.ok(
        !/PipelineRunner|BrainWorkerCycle|ProductionExecution[A-Z]|child_process|spawn|execFile|ffmpeg|nvidia-smi/.test(src),
      );
    });

    /* -------------------------------------------- B. child-process boot --- */

    const bootRoot = path.join(tempRoot, "boot-external");
    fs.mkdirSync(path.join(bootRoot, "projects"), { recursive: true });
    const bootWorkspace = path.join(tempRoot, "boot-ws");
    fs.mkdirSync(bootWorkspace, { recursive: true });
    const bootEnv = {
      ATOLYE_RUNTIME_ROOT: bootRoot,
      ATOLYE_WORKSPACE_ROOT: bootWorkspace,
      ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(tempRoot, "boot-auth"),
      NODE_ENV: "production",
    };
    const bootMarker = path.join(bootRoot, "projects", runtimeAuthorityGenerationMarkerFileName);

    await scenario("child: clean external root → startup succeeds + marker stamped", () => {
      const first = bootChild(bootEnv);
      assert.equal(first.status, 0, first.stderr);
      assert.equal(first.outcome?.ok, true, JSON.stringify(first.outcome));
      assert.equal(fs.existsSync(bootMarker), true);
      assert.equal(JSON.parse(fs.readFileSync(bootMarker, "utf8")).authorityGeneration, GEN_A);
    });

    await scenario("child: same root, second process → startup succeeds (match)", () => {
      const before = fs.readFileSync(bootMarker, "utf8");
      const second = bootChild(bootEnv);
      assert.equal(second.status, 0, second.stderr);
      assert.equal(second.outcome?.ok, true, JSON.stringify(second.outcome));
      assert.equal(fs.readFileSync(bootMarker, "utf8"), before);
    });

    await scenario("child: with a project present, recovery bootstrap runs behind the same gate", () => {
      fs.mkdirSync(path.join(bootRoot, "projects", "c2b6b-recovery", "production-execution"), {
        recursive: true,
      });
      const before = fs.readFileSync(bootMarker, "utf8");
      const result = bootChild(bootEnv);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.outcome?.ok, true, JSON.stringify(result.outcome));
      assert.equal(fs.readFileSync(bootMarker, "utf8"), before, "recovery must not rewrite the marker");
      fs.rmSync(path.join(bootRoot, "projects", "c2b6b-recovery"), { recursive: true, force: true });
    });

    await scenario("child: foreign-generation marker → startup FAILS CLOSED, no worker, marker untouched", () => {
      const original = fs.readFileSync(bootMarker, "utf8");
      const tampered = JSON.parse(original);
      tampered.authorityGeneration = "runtime-authority-generation-v99";
      fs.writeFileSync(bootMarker, `${JSON.stringify(tampered)}\n`);
      const tamperedOnDisk = fs.readFileSync(bootMarker, "utf8");

      const result = bootChild(bootEnv);
      assert.equal(result.outcome?.ok, false, JSON.stringify(result.outcome));
      assert.equal(result.outcome?.code, "RUNTIME_AUTHORITY_GENERATION_MISMATCH");
      // marker NOT overwritten / repaired
      assert.equal(fs.readFileSync(bootMarker, "utf8"), tamperedOnDisk);
      // no fallback: nothing written under the repo or the temp workspace
      assert.equal(fs.existsSync(path.join(bootWorkspace, "data", "projects")), false);

      fs.writeFileSync(bootMarker, original);
    });

    await scenario("child: production + ATOLYE_RUNTIME_ROOT unset → startup FAILS CLOSED", () => {
      const result = bootChild({
        ...bootEnv,
        ATOLYE_RUNTIME_ROOT: undefined,
      });
      assert.equal(result.outcome?.ok, false, JSON.stringify(result.outcome));
      assert.equal(result.outcome?.code, "PRODUCTION_RUNTIME_ROOT_REQUIRED");
    });

    await scenario("child: development + unset root → startup still succeeds (legacy default)", () => {
      const result = bootChild({
        ...bootEnv,
        ATOLYE_RUNTIME_ROOT: undefined,
        NODE_ENV: "development",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.outcome?.ok, true, JSON.stringify(result.outcome));
    });

    await scenario("existing C.2B.6 marker smoke still passes", () => {
      const out = spawnSync(
        process.execPath,
        [...process.execArgv, path.resolve(REPO_ROOT, "scripts/smoke-c2b6-authority-generation-marker.ts")],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 },
      );
      assert.equal(out.status, 0, out.stderr);
      assert.match(out.stdout, /"status":"PASS"/);
    });

    await scenario("git working tree unchanged by the whole run", () => {
      assert.equal(gitStatus(), gitBefore);
    });

    console.log(`C.2B.6b authority generation enforcement: PASS (${count} scenarios)`);
    if (skipped.length) console.log(`  skipped: ${skipped.join("; ")}`);
    console.log(
      JSON.stringify({
        status: "PASS",
        suite: "c2b6b-authority-generation-enforcement",
        scenarios: count,
        skipped,
      }),
    );
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error("C.2B.6b authority generation enforcement FAILED:", error);
    process.exitCode = 1;
  }
})();
