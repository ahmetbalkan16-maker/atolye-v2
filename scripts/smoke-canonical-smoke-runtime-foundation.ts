import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ProductionExecutionDescriptorBoundReadAdapter,
  createProductionExecutionReadDescriptor } from
  "../src/lib/production/ProductionExecutionDescriptorBoundReadAdapter";
import { createProductionRuntimeOperationContext, initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext } from
  "../src/lib/runtime/ProductionRuntimeOperationContext";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { assertCanonicalSmokeRuntimeStorageContext, requireCanonicalSmokeOperationContext,
  recoverCanonicalSmokeWorkspace, withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { snapshotProductionPipelineExecutionConfiguration } from
  "../src/lib/production/ProductionPipelineExecutionConfiguration";

let scenarios = 0;
const hostTempRoot = path.resolve(process.env.TEMP ?? process.env.TMP ?? ".");
async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  scenarios += 1;
  process.stdout.write(`PASS ${scenarios}: ${name}\n`);
}

async function main() {
  if (process.argv.includes("--crash-child")) {
    await withCanonicalSmokeRuntime({ name: "real-crash-child" }, async (runtime) => {
      process.stdout.write(`ATOLYE_SMOKE_SETUP ${JSON.stringify({ workspaceRoot: runtime.workspaceRoot })}\n`);
      await new Promise<never>(() => undefined);
    });
    return;
  }
  const initialRegistration = snapshotProductionPipelineExecutionConfiguration();
  await withCanonicalSmokeRuntime({ name: "foundation-invariants", enterOperationContext: false,
    configureProductionExecution: false },
    async (outer) => {
      await scenario("default shared authority use fails fast", () => {
        const environment = { ...process.env };
        delete environment.ATOLYE_RUNTIME_AUTHORITY_ROOT;
        const context = createRuntimeStorageContext({ environment });
        assert.throws(() => assertCanonicalSmokeRuntimeStorageContext(context, outer.workspaceRoot));
      });
      await scenario("repository data/projects use fails fast", () => {
        const context = createRuntimeStorageContext({
          environment: { ...process.env, ATOLYE_RUNTIME_ROOT: path.join(process.cwd(), "data") },
          workspaceRoot: process.cwd(), authorityRoot: path.join(outer.authorityRoot, "repository-negative"),
        });
        assert.throws(() => assertCanonicalSmokeRuntimeStorageContext(context, outer.workspaceRoot));
      });
      await scenario("lifecycle use before operation context fails fast", () => {
        assert.throws(() => requireCanonicalSmokeOperationContext(outer));
      });
      await scenario("foreign root replacement is preserved", async () => {
        let workspace = "";
        await assert.rejects(withCanonicalSmokeRuntime({ name: "foreign-replacement",
          configureProductionExecution: false,
          cleanupBarrier: () => {
            fs.renameSync(workspace, `${workspace}.owned-preserved`);
            fs.mkdirSync(workspace);
            fs.writeFileSync(path.join(workspace, "foreign-marker"), "preserve");
          } }, async (runtime) => { workspace = runtime.workspaceRoot; }), AggregateError);
        assert.equal(fs.readFileSync(path.join(workspace, "foreign-marker"), "utf8"), "preserve");
      });
      await scenario("reparse root cleanup fails closed", async () => {
        let workspace = "";
        await assert.rejects(withCanonicalSmokeRuntime({ name: "reparse-replacement",
          configureProductionExecution: false,
          cleanupBarrier: () => {
            const owned = `${workspace}.owned-preserved`;
            fs.renameSync(workspace, owned);
            fs.symlinkSync(owned, workspace, "junction");
          } }, async (runtime) => { workspace = runtime.workspaceRoot; }), AggregateError);
        assert.equal(fs.lstatSync(workspace).isSymbolicLink(), true);
        fs.unlinkSync(workspace);
        fs.renameSync(`${workspace}.owned-preserved`, workspace);
      });
      await scenario("cleanup error prevents PASS and remains aggregated", async () => {
        await assert.rejects(withCanonicalSmokeRuntime({ name: "cleanup-error",
          configureProductionExecution: false,
          cleanupBarrier: () => { throw new Error("controlled-cleanup-error"); } }, async () => {
          throw new Error("controlled-primary-error");
        }), (error) => error instanceof AggregateError && error.errors.length === 2);
      });
      await scenario("environment is restored exactly", async () => {
        const key = "ATOLYE_CANONICAL_ENV_INVARIANT";
        const present = Object.hasOwn(process.env, key);
        const value = process.env[key];
        delete process.env[key];
        await withCanonicalSmokeRuntime({ name: "environment-restore", configureProductionExecution: false,
          environment: { [key]: "fixture" } }, async () => assert.equal(process.env[key], "fixture"));
        assert.equal(Object.hasOwn(process.env, key), false);
        if (present) process.env[key] = value!;
      });

      const slugA = "descriptor-project-a";
      const slugB = "descriptor-project-b";
      for (const slug of [slugA, slugB]) fs.mkdirSync(path.join(outer.runtimeStorageContext.projectsRoot,
        slug, "production-execution"), { recursive: true });
      const operationA = createProductionRuntimeOperationContext({ operationId: "descriptor-operation-a",
        operationType: "foundation-invariant", authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext: outer.runtimeStorageContext });
      const operationB = createProductionRuntimeOperationContext({ operationId: "descriptor-operation-b",
        operationType: "foundation-invariant", authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext: outer.runtimeStorageContext });
      const descriptorA = createProductionExecutionReadDescriptor({ runtimeOperationContext: operationA,
        projectSlug: slugA });
      const adapterA = new ProductionExecutionDescriptorBoundReadAdapter(descriptorA);
      await scenario("operation A descriptor cannot read under operation B", async () => {
        const result = await runWithProductionRuntimeOperationContext(operationB,
          () => adapterA.listKeys("attempt"));
        assert.equal(result.ok, false);
      });
      await scenario("project A descriptor cannot be substituted for project B", () => {
        const forged = Object.freeze({ ...descriptorA, projectSlug: slugB });
        assert.throws(() => new ProductionExecutionDescriptorBoundReadAdapter(forged));
      });
      await scenario("runtime authority mismatch fails closed", async () => {
        const runtimeRoot = path.join(outer.workspaceRoot, "foreign-runtime");
        const authorityRoot = path.join(outer.workspaceRoot, "foreign-authority");
        fs.mkdirSync(path.join(runtimeRoot, "projects", slugA, "production-execution"), { recursive: true });
        const storage = createRuntimeStorageContext({ environment: { ...process.env,
          ATOLYE_RUNTIME_ROOT: runtimeRoot }, workspaceRoot: outer.workspaceRoot, authorityRoot });
        const operation = createProductionRuntimeOperationContext({ operationId: "foreign-authority",
          operationType: "foundation-invariant", authorityGeneration: initialRuntimeAuthorityGeneration,
          storageContext: storage });
        const result = await runWithProductionRuntimeOperationContext(operation,
          () => adapterA.listKeys("attempt"));
        assert.equal(result.ok, false);
      });
      await scenario("shared authority metadata and content remain unchanged", async () => {
        const result = await withCanonicalSmokeRuntime({ name: "shared-inventory",
          configureProductionExecution: false }, async () => true);
        assert.equal(result.finalization.sharedAuthorityUnchanged, true);
      });
      await scenario("run-owned remainder is exactly zero", async () => {
        const result = await withCanonicalSmokeRuntime({ name: "zero-remainder",
          configureProductionExecution: false }, async () => true);
        assert.equal(result.finalization.runtimeRemainder, 0);
        assert.equal(result.finalization.authorityRemainder, 0);
      });
      await scenario("child crash exit remains visible", () => {
        const child = spawnSync(process.execPath, ["-e", "process.exit(17)"], { encoding: "utf8" });
        assert.equal(child.status, 17);
      });
      await scenario("test order does not change canonical defaults", async () => {
        const seen: string[] = [];
        for (const name of ["order-b", "order-a"]) await withCanonicalSmokeRuntime({ name,
          configureProductionExecution: false }, async () => {
          seen.push(`${process.env.AI_PROVIDER}:${process.env.VIDEO_PROVIDER}`);
        });
        assert.deepEqual(seen, ["mock:mock", "mock:mock"]);
      });
      await scenario("ambient provider values do not change results", async () => {
        const original = process.env.AI_PROVIDER;
        process.env.AI_PROVIDER = "openai";
        try {
          await withCanonicalSmokeRuntime({ name: "ambient-provider",
            configureProductionExecution: false }, async () => {
            assert.equal(process.env.AI_PROVIDER, "mock");
          });
          assert.equal(process.env.AI_PROVIDER, "openai");
        } finally {
          if (original === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = original;
        }
      });

      for (const stage of ["environment", "context", "worker", "registration"] as const) {
        await scenario(`partial setup rollback: ${stage}`, async () => {
          const before = process.env.AI_PROVIDER;
          await assert.rejects(withCanonicalSmokeRuntime({ name: `setup-failure-${stage}`,
            failureInjectionStage: stage }, async () => undefined),
          new RegExp(`controlled setup failure: ${stage}`));
          assert.equal(process.env.AI_PROVIDER, before);
        });
      }
      await scenario("best-effort multi-key environment restore", async () => {
        const first = process.env.AI_PROVIDER, second = process.env.VIDEO_PROVIDER;
        await assert.rejects(withCanonicalSmokeRuntime({ name: "environment-best-effort",
          environmentRestoreFailureKeys: ["AI_PROVIDER", "VIDEO_PROVIDER"] }, async () => {
          assert.equal(process.env.AI_PROVIDER, "mock");
          assert.equal(process.env.VIDEO_PROVIDER, "mock");
        }), (error) => error instanceof AggregateError && error.errors.length === 2);
        assert.equal(process.env.AI_PROVIDER, first);
        assert.equal(process.env.VIDEO_PROVIDER, second);
      });

      await scenario("nested global registration restores outer authority", async () => {
        await withCanonicalSmokeRuntime({ name: "nested-a", enterOperationContext: false }, async () => {
          const registrationA = snapshotProductionPipelineExecutionConfiguration();
          await withCanonicalSmokeRuntime({ name: "nested-b", enterOperationContext: false }, async () => undefined);
          assertRegistrationEqual(snapshotProductionPipelineExecutionConfiguration(), registrationA);
        });
      });
      await scenario("sequential global registration restores initial authority", async () => {
        await withCanonicalSmokeRuntime({ name: "sequential-a" }, async () => undefined);
        assertRegistrationEqual(snapshotProductionPipelineExecutionConfiguration(), initialRegistration);
        await withCanonicalSmokeRuntime({ name: "sequential-b" }, async () => undefined);
        assertRegistrationEqual(snapshotProductionPipelineExecutionConfiguration(), initialRegistration);
      });

      await scenario("post-check pre-rename foreign replacement is preserved", async () => {
        let workspace = "";
        await assert.rejects(withCanonicalSmokeRuntime({ name: "post-check-race",
          configureProductionExecution: false,
          postCheckPreRenameBarrier: () => {
            fs.renameSync(workspace, `${workspace}.owned-preserved`);
            fs.mkdirSync(workspace);
            fs.writeFileSync(path.join(workspace, "foreign-marker"), "preserve");
          } }, async (runtime) => { workspace = runtime.workspaceRoot; }), AggregateError);
        assert.equal(fs.readFileSync(path.join(workspace, "foreign-marker"), "utf8"), "preserve");
      });

      await scenario("active child recovery is rejected and crashed child recovers", async () => {
        const cli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
        const child = spawn(process.execPath, [cli, path.join(process.cwd(), "scripts",
          "smoke-canonical-smoke-runtime-foundation.ts"), "--crash-child"], {
          cwd: process.cwd(), env: { ...process.env, TEMP: hostTempRoot, TMP: hostTempRoot },
          stdio: ["ignore", "pipe", "pipe"],
        });
        const workspace = await readChildWorkspace(child);
        assert.throws(() => recoverCanonicalSmokeWorkspace(workspace), /active run/);
        assert.equal(fs.existsSync(workspace), true);
        child.kill("SIGKILL");
        await new Promise<void>((resolve, reject) => {
          child.once("close", () => resolve()); child.once("error", reject);
        });
        recoverCanonicalSmokeWorkspace(workspace);
        assert.equal(fs.existsSync(workspace), false);
      });

      await scenario("descriptor initially not-created remains not-created", async () => {
        const slug = "descriptor-not-created";
        fs.mkdirSync(path.join(outer.runtimeStorageContext.projectsRoot, slug), { recursive: true });
        const descriptor = createProductionExecutionReadDescriptor({ runtimeOperationContext: operationA,
          projectSlug: slug });
        const adapter = new ProductionExecutionDescriptorBoundReadAdapter(descriptor);
        const result = await runWithProductionRuntimeOperationContext(operationA,
          () => adapter.listKeys("attempt"));
        assert.equal(result.ok, true); if (result.ok) assert.equal(result.storeState, "not-created");
      });
      await scenario("descriptor initially not-created rejects foreign creation", async () => {
        const slug = "descriptor-created-later", project = path.join(outer.runtimeStorageContext.projectsRoot, slug);
        fs.mkdirSync(project, { recursive: true });
        const adapter = new ProductionExecutionDescriptorBoundReadAdapter(
          createProductionExecutionReadDescriptor({ runtimeOperationContext: operationA, projectSlug: slug }));
        fs.mkdirSync(path.join(project, "production-execution"));
        const result = await runWithProductionRuntimeOperationContext(operationA,
          () => adapter.listKeys("attempt"));
        assert.equal(result.ok, false); if (!result.ok) assert.equal(result.errorCode, "PERSISTENCE_IDENTITY_CHANGED");
      });
      await scenario("descriptor existing root deletion is identity changed", async () => {
        const slug = "descriptor-deleted", root = descriptorRoot(outer, slug);
        const adapter = descriptorAdapter(operationA, slug, root);
        fs.rmSync(root, { recursive: true });
        const result = await runWithProductionRuntimeOperationContext(operationA,
          () => adapter.listKeys("attempt"));
        assert.equal(result.ok, false); if (!result.ok) assert.equal(result.errorCode, "PERSISTENCE_IDENTITY_CHANGED");
      });
      await scenario("descriptor existing root replacement is identity changed", async () => {
        const slug = "descriptor-replaced", root = descriptorRoot(outer, slug);
        const adapter = descriptorAdapter(operationA, slug, root);
        fs.renameSync(root, `${root}.original`); fs.mkdirSync(root);
        const result = await runWithProductionRuntimeOperationContext(operationA,
          () => adapter.listKeys("attempt"));
        assert.equal(result.ok, false); if (!result.ok) assert.equal(result.errorCode, "PERSISTENCE_IDENTITY_CHANGED");
      });
      await scenario("descriptor existing root reparse is identity changed", async () => {
        const slug = "descriptor-reparse", root = descriptorRoot(outer, slug);
        const adapter = descriptorAdapter(operationA, slug, root);
        const original = `${root}.original`; fs.renameSync(root, original); fs.symlinkSync(original, root, "junction");
        const result = await runWithProductionRuntimeOperationContext(operationA,
          () => adapter.listKeys("attempt"));
        assert.equal(result.ok, false); if (!result.ok) assert.equal(result.errorCode, "PERSISTENCE_IDENTITY_CHANGED");
      });
    });
  assertRegistrationEqual(snapshotProductionPipelineExecutionConfiguration(), initialRegistration);
  process.stdout.write(`Canonical smoke runtime foundation: PASS (${scenarios} invariants)\n`);
  process.stdout.write(`ATOLYE_SMOKE_RESULT ${JSON.stringify({ status: "PASS",
    suite: "canonical-smoke-runtime-foundation", scenarios })}\n`);
}

function assertRegistrationEqual(
  actual: ReturnType<typeof snapshotProductionPipelineExecutionConfiguration>,
  expected: ReturnType<typeof snapshotProductionPipelineExecutionConfiguration>,
): void {
  assert.strictEqual(actual.runnerRuntime.registration, expected.runnerRuntime.registration);
  assert.strictEqual(actual.continuationAdmission, expected.continuationAdmission);
  assert.strictEqual(actual.pipelineExecution.registration, expected.pipelineExecution.registration);
}

function readChildWorkspace(child: ReturnType<typeof spawn>): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Crash child setup timed out.")), 15_000);
    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      for (const line of buffer.split(/\r?\n/)) {
        if (!line.startsWith("ATOLYE_SMOKE_SETUP ")) continue;
        clearTimeout(timer);
        resolve((JSON.parse(line.slice("ATOLYE_SMOKE_SETUP ".length)) as { workspaceRoot: string }).workspaceRoot);
      }
    });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { if (code !== null) {
      clearTimeout(timer); reject(new Error(`Crash child exited before setup: ${code}`));
    } });
  });
}

function descriptorRoot(runtime: { runtimeStorageContext: { projectsRoot: string } }, slug: string): string {
  const root = path.join(runtime.runtimeStorageContext.projectsRoot, slug, "production-execution");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function descriptorAdapter(operation: Parameters<typeof createProductionExecutionReadDescriptor>[0]["runtimeOperationContext"],
  slug: string, root: string): ProductionExecutionDescriptorBoundReadAdapter {
  void root;
  return new ProductionExecutionDescriptorBoundReadAdapter(
    createProductionExecutionReadDescriptor({ runtimeOperationContext: operation, projectSlug: slug }));
}

void main();
