import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { installPipelineRunnerProductionRuntime, PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { ProductionExecutionRecoveryBootstrap } from "../src/lib/production/ProductionExecutionRecoveryBootstrap";
import { ProductionExecutionFilePersistenceAdapter } from "../src/lib/production/ProductionExecutionPersistence";
import {
  captureCanonicalProductionWorkerLifecycleExecution,
  ProductionWorkerLifecycle,
} from "../src/lib/production/ProductionWorkerLifecycle";
import {
  executeConfiguredProductionPipelineStage,
} from "../src/lib/production/ProductionPipelineExecutionFactory";
import { configureProductionPipelineExecution } from "../src/lib/production/ProductionPipelineExecutionConfiguration";
import {
  assertProductionRuntimeOperationContext,
  createProductionRuntimeOperationContext,
  deriveProductionRuntimeOperationContext,
  getActiveProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  ProductionRuntimeOperationContextError,
  runWithProductionRuntimeOperationContext,
  type ProductionRuntimeOperationContext,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import {
  createRuntimeStorageContext,
  resolveRuntimeStorageContext,
  RuntimeStorageError,
  runtimeStoragePolicyVersion,
  type RuntimeStorageContext,
} from "../src/lib/runtime/RuntimeStoragePaths";
import type { ProductionRuntimeInitializationSuccess } from "../src/types/productionRuntimeInitialization";
import type { ProductionExecutionPersistenceAdapter } from "../src/types/productionExecutionPersistence";

const initializedAt = "2026-07-16T10:00:00.000Z";

async function main() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "atolye-c2b4-context-"));
  let scenarios = 0;
  const scenario = async (name: string, run: () => unknown | Promise<unknown>) => {
    await run();
    scenarios++;
    void name;
  };

  try {
    const workspaceRoot = path.join(temporaryRoot, "workspace");
    const runtimeRoot = path.join(temporaryRoot, "runtime-a");
    const alternateRuntimeRoot = path.join(temporaryRoot, "runtime-b");
    await fs.mkdir(workspaceRoot);
    const storageContext = createRuntimeStorageContext({
      environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
      workspaceRoot,
      authorityRoot: path.join(temporaryRoot, "authority-a"),
    });
    const alternateStorageContext = createRuntimeStorageContext({
      environment: { ATOLYE_RUNTIME_ROOT: alternateRuntimeRoot },
      workspaceRoot,
      authorityRoot: path.join(temporaryRoot, "authority-b"),
    });
    const processContext = createProductionRuntimeOperationContext({
      operationId: "runtime-startup-test",
      operationType: "runtime-startup",
      authorityGeneration: initialRuntimeAuthorityGeneration,
      storageContext,
    });

    await scenario("contract is deeply frozen and path-free", () => {
      assert.equal(Object.isFrozen(processContext), true);
      assert.equal(Object.isFrozen(processContext.authority), true);
      assert.equal(processContext.authority.storagePolicyIdentity, runtimeStoragePolicyVersion);
      assert.equal(processContext.authority.authorityGeneration, initialRuntimeAuthorityGeneration);
      assert.equal(processContext.authority.logicalProjectsRoot, "projects");
      const serialized = JSON.stringify(processContext);
      assert.equal(serialized.includes(temporaryRoot), false);
      assert.equal(/[a-zA-Z]:[\\/]/.test(serialized), false);
    });

    await scenario("contract mutation is rejected", () => {
      assert.equal(Reflect.set(processContext, "operationId", "changed"), false);
      assert.equal(Reflect.set(processContext.authority, "authorityGeneration", "changed"), false);
      assert.equal(processContext.operationId, "runtime-startup-test");
      assert.equal(processContext.authority.authorityGeneration, initialRuntimeAuthorityGeneration);
    });

    await scenario("frozen forged storage context is rejected", () => {
      const forged = Object.freeze({
        ...storageContext,
        projectsRoot: path.join(temporaryRoot, "forged", "projects"),
      }) as RuntimeStorageContext;
      assert.throws(
        () => createProductionRuntimeOperationContext({
          operationId: "forged-context-test",
          operationType: "pipeline-run",
          authorityGeneration: initialRuntimeAuthorityGeneration,
          storageContext: forged,
        }),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_INVALID",
      );
      assert.throws(
        () => resolveRuntimeStorageContext(forged),
        (error: unknown) => error instanceof RuntimeStorageError &&
          error.code === "RUNTIME_STORAGE_CONTEXT_INVALID",
      );
    });

    await scenario("spread storage and operation clones are rejected", () => {
      const storageClone = Object.freeze({ ...storageContext }) as RuntimeStorageContext;
      assert.throws(() => resolveRuntimeStorageContext(storageClone), RuntimeStorageError);
      const operationClone = Object.freeze({
        ...processContext,
        authority: Object.freeze({ ...processContext.authority }),
      }) as ProductionRuntimeOperationContext;
      assert.throws(
        () => assertProductionRuntimeOperationContext(operationClone),
        ProductionRuntimeOperationContextError,
      );
    });

    await scenario("raw operation scope opener is not public", async () => {
      const scopeModule = await import("../src/lib/runtime/RuntimeOperationScope");
      assert.equal("runInRuntimeOperationScope" in scopeModule, false);
    });

    await scenario("duplicated provenance registry fails closed", async () => {
      const duplicateUrl = `${pathToFileURL(path.resolve("src/lib/runtime/RuntimeStoragePaths.ts")).href}?registry-duplicate=${Date.now()}`;
      const duplicate = await import(duplicateUrl) as typeof import("../src/lib/runtime/RuntimeStoragePaths");
      const duplicateContext = duplicate.createRuntimeStorageContext({
        environment: { ATOLYE_RUNTIME_ROOT: path.join(temporaryRoot, "duplicate-runtime") },
        workspaceRoot,
        authorityRoot: path.join(temporaryRoot, "duplicate-authority"),
      });
      assert.throws(() => resolveRuntimeStorageContext(duplicateContext), RuntimeStorageError);
      assert.throws(() => duplicate.resolveRuntimeStorageContext(storageContext), duplicate.RuntimeStorageError);
    });

    await scenario("scope preserves one identity across async boundaries and environment drift", async () => {
      const previousRoot = process.env.ATOLYE_RUNTIME_ROOT;
      try {
        await runWithProductionRuntimeOperationContext(processContext, async () => {
          assert.strictEqual(getActiveProductionRuntimeOperationContext(), processContext);
          assert.strictEqual(createRuntimeStorageContext(), storageContext);
          process.env.ATOLYE_RUNTIME_ROOT = alternateRuntimeRoot;
          await Promise.resolve();
          assert.strictEqual(getActiveProductionRuntimeOperationContext(), processContext);
          assert.equal(ProjectReader.getProjectsRoot(), storageContext.projectsRoot);
        });
      } finally {
        if (previousRoot === undefined) delete process.env.ATOLYE_RUNTIME_ROOT;
        else process.env.ATOLYE_RUNTIME_ROOT = previousRoot;
      }
    });

    await scenario("explicit storage context mismatch fails closed", async () => {
      await runWithProductionRuntimeOperationContext(processContext, async () => {
        assert.throws(
          () => ProjectReader.getProjectsRoot(alternateStorageContext),
          (error: unknown) => error instanceof RuntimeStorageError &&
            error.code === "RUNTIME_STORAGE_OPERATION_CONTEXT_MISMATCH",
        );
      });
    });

    await scenario("derived operation preserves verified authority identity", () => {
      const child = deriveProductionRuntimeOperationContext(processContext, {
        operationId: "pipeline-operation-test",
        operationType: "pipeline-run",
      });
      assert.notStrictEqual(child, processContext);
      assert.deepEqual(child.authority, processContext.authority);
      assert.notEqual(child.bindingFingerprint, processContext.bindingFingerprint);
    });

    const worker = new ProductionWorkerLifecycle(() => initializedAt);
    worker.bindRuntimeOperationContext(processContext);
    await worker.start({ initialization: initialization(worker) });

    await scenario("bound worker rejects missing context", async () => {
      await assert.rejects(
        worker.execute(async () => "unexpected"),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_MISSING",
      );
    });

    await scenario("worker dispatch carries the same frozen context", async () => {
      const child = deriveProductionRuntimeOperationContext(processContext, {
        operationId: "worker-dispatch-test",
        operationType: "worker-dispatch",
      });
      const active = await worker.executeWithRuntimeOperationContext(
        child,
        async () => {
          await Promise.resolve();
          return getActiveProductionRuntimeOperationContext();
        },
      );
      assert.strictEqual(active, child);
    });

    await scenario("different authority generation is rejected before dispatch", async () => {
      const divergent = createProductionRuntimeOperationContext({
        operationId: "worker-divergent-test",
        operationType: "worker-dispatch",
        authorityGeneration: "runtime-authority-generation-v2",
        storageContext,
      });
      await assert.rejects(
        worker.executeWithRuntimeOperationContext(divergent, async () => "unexpected"),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_MISMATCH",
      );
    });

    await scenario("recovery requires and validates the operation context", async () => {
      const adapter = new ProductionExecutionFilePersistenceAdapter({
        trustedRootDirectory: path.join(temporaryRoot, "durable-read-only"),
        createRootDirectory: false,
      });
      const recovery = new ProductionExecutionRecoveryBootstrap(
        adapter,
        processContext,
      );
      await assert.rejects(
        recovery.bootstrapRecovery({ evaluatedAt: initializedAt }),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_MISSING",
      );
      const result = await runWithProductionRuntimeOperationContext(
        processContext,
        () => recovery.bootstrapRecovery({ evaluatedAt: initializedAt }),
      );
      assert.equal(result.decision, "ready");
      assert.equal(result.writeFree, true);
    });

    await scenario("unregistered context clone is invalid", () => {
      const clone = { ...processContext } as ProductionRuntimeOperationContext;
      assert.throws(
        () => assertProductionRuntimeOperationContext(clone),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_INVALID",
      );
    });

    await scenario("equivalent authority with a different storage object is rejected", async () => {
      const equivalentStorageContext = createRuntimeStorageContext({
        environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
        workspaceRoot,
        authorityRoot: path.join(temporaryRoot, "authority-a"),
      });
      const equivalentContext = createProductionRuntimeOperationContext({
        operationId: "equivalent-context-test",
        operationType: "pipeline-run",
        authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext: equivalentStorageContext,
      });
      assert.deepEqual(equivalentContext.authority, processContext.authority);
      await runWithProductionRuntimeOperationContext(processContext, async () => {
        assert.throws(
          () => ProjectReader.getProjectsRoot(equivalentStorageContext),
          (error: unknown) => error instanceof RuntimeStorageError &&
            error.code === "RUNTIME_STORAGE_OPERATION_CONTEXT_MISMATCH",
        );
        assert.throws(
          () => runWithProductionRuntimeOperationContext(equivalentContext, () => undefined),
          (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
            error.code === "RUNTIME_OPERATION_CONTEXT_MISMATCH",
        );
      });
    });

    await scenario("detached timer scope is revoked", async () => {
      const observed = new Promise<unknown>((resolve) => {
        runWithProductionRuntimeOperationContext(processContext, () => {
          setTimeout(() => {
            try {
              resolve(getActiveProductionRuntimeOperationContext());
            } catch (error) {
              resolve(error);
            }
          }, 0);
        });
      });
      const error = await observed;
      assert.ok(error instanceof ProductionRuntimeOperationContextError);
      assert.equal(error.code, "RUNTIME_OPERATION_CONTEXT_MISSING");
    });

    await scenario("detached promise continuation scope is revoked", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let observed!: Promise<unknown>;
      runWithProductionRuntimeOperationContext(processContext, () => {
        observed = gate.then(() => {
          try {
            return getActiveProductionRuntimeOperationContext();
          } catch (error) {
            return error;
          }
        });
      });
      release();
      const error = await observed;
      assert.ok(error instanceof ProductionRuntimeOperationContextError);
      assert.equal(error.code, "RUNTIME_OPERATION_CONTEXT_MISSING");
    });

    await scenario("parallel operation scopes remain isolated", async () => {
      const alternateContext = createProductionRuntimeOperationContext({
        operationId: "parallel-alternate-test",
        operationType: "pipeline-run",
        authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext: alternateStorageContext,
      });
      let releaseA!: () => void;
      let releaseB!: () => void;
      const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
      const gateB = new Promise<void>((resolve) => { releaseB = resolve; });
      const operationA = runWithProductionRuntimeOperationContext(processContext, async () => {
        assert.strictEqual(getActiveProductionRuntimeOperationContext(), processContext);
        await gateA;
        assert.strictEqual(getActiveProductionRuntimeOperationContext(), processContext);
      });
      const operationB = runWithProductionRuntimeOperationContext(alternateContext, async () => {
        assert.strictEqual(getActiveProductionRuntimeOperationContext(), alternateContext);
        await gateB;
        assert.strictEqual(getActiveProductionRuntimeOperationContext(), alternateContext);
      });
      releaseA();
      await operationA;
      assert.strictEqual(getActiveProductionRuntimeOperationContext(), undefined);
      releaseB();
      await operationB;
    });

    await scenario("worker completion revokes stale storage resolver access", async () => {
      let observe!: (value: unknown) => void;
      const observed = new Promise<unknown>((resolve) => { observe = resolve; });
      await worker.executeWithRuntimeOperationContext(processContext, async () => {
        setTimeout(() => {
          try {
            observe(createRuntimeStorageContext());
          } catch (error) {
            observe(error);
          }
        }, 0);
      });
      assert.equal(worker.snapshot().activeExecutions, 0);
      const error = await observed;
      assert.ok(error instanceof ProductionRuntimeOperationContextError);
      assert.equal(error.code, "RUNTIME_OPERATION_CONTEXT_MISSING");
    });

    await scenario("PipelineRunner exposes no arbitrary runtime scope configurator", async () => {
      assert.equal("configureRuntimeOperationScope" in PipelineRunner, false);
      const runnerModule = await import("../src/lib/pipeline/PipelineRunner");
      assert.throws(
        () => runnerModule.installPipelineRunnerProductionRuntime({} as ProductionWorkerLifecycle, processContext),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_INVALID",
      );
    });

    await scenario("subclass and pre-install lifecycle override remain fail-closed", () => {
      class DerivedWorkerLifecycle extends ProductionWorkerLifecycle {}
      assert.throws(
        () => installPipelineRunnerProductionRuntime(new DerivedWorkerLifecycle(() => initializedAt), processContext),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_INVALID",
      );
      const overridden = new ProductionWorkerLifecycle(() => initializedAt);
      Object.defineProperty(overridden, "executeWithRuntimeOperationContext", {
        configurable: true,
        value: async <T>(_context: ProductionRuntimeOperationContext, operation: () => T | Promise<T>) => operation(),
      });
      assert.throws(
        () => installPipelineRunnerProductionRuntime(overridden, processContext),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_INVALID",
      );
      const canonicalMethod = ProductionWorkerLifecycle.prototype.executeWithRuntimeOperationContext;
      Object.defineProperty(ProductionWorkerLifecycle.prototype, "executeWithRuntimeOperationContext", {
        configurable: true,
        writable: true,
        value: async <T>(_context: ProductionRuntimeOperationContext, operation: () => T | Promise<T>) => operation(),
      });
      try {
        assert.throws(
          () => installPipelineRunnerProductionRuntime(new ProductionWorkerLifecycle(() => initializedAt), processContext),
          (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
            error.code === "RUNTIME_OPERATION_CONTEXT_INVALID",
        );
      } finally {
        Object.defineProperty(ProductionWorkerLifecycle.prototype, "executeWithRuntimeOperationContext", {
          configurable: true,
          writable: true,
          value: canonicalMethod,
        });
      }
    });

    await scenario("all PipelineRunner production entries reject before callbacks without wiring", async () => {
      const harness = PipelineRunner as unknown as Record<string, unknown>;
      const callbackNames = ["runOnce", "resumeOnce", "retryStageOnce", "continueProjectScoped", "dispatchProjectContinuationOnce", "executeJobRetryOnce"];
      const originals = new Map(callbackNames.map((name) => [name, harness[name]]));
      let callbackCalls = 0;
      for (const name of callbackNames) harness[name] = async () => { callbackCalls++; return {}; };
      try {
        const operations = [
          PipelineRunner.run("must-not-create-a-project"),
          PipelineRunner.resume("missing-context-project"),
          PipelineRunner.retryStage("missing-context-project", "script"),
          PipelineRunner.continueProject("missing-context-project"),
          PipelineRunner.dispatchProjectContinuation("missing-context-project"),
          PipelineRunner.executeJobRetry("missing-context-project", "job-1"),
        ];
        for (const operation of operations) {
          await assert.rejects(
            operation,
            (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
              error.code === "RUNTIME_OPERATION_CONTEXT_MISSING",
          );
        }
        assert.equal(callbackCalls, 0);
      } finally {
        for (const [name, original] of originals) harness[name] = original;
      }
    });

    await scenario("same exact canonical PipelineRunner pair is idempotent", async () => {
      const runnerModule = await import("../src/lib/pipeline/PipelineRunner");
      runnerModule.installPipelineRunnerProductionRuntime(worker, processContext);
      runnerModule.installPipelineRunnerProductionRuntime(worker, processContext);
    });

    await scenario("post-install lifecycle method replacement cannot bypass admission", async () => {
      Object.defineProperty(worker, "executeWithRuntimeOperationContext", {
        configurable: true,
        value: async <T>(_context: ProductionRuntimeOperationContext, operation: () => T | Promise<T>) => operation(),
      });
      try {
        const active = await (PipelineRunner as unknown as {
          withRuntimeOperation<T>(operationType: string, operation: () => Promise<T>): Promise<T>;
        }).withRuntimeOperation("canonical-registration-test", async () => getActiveProductionRuntimeOperationContext());
        assert.ok(active);
        assert.deepEqual(active.authority, processContext.authority);
        assert.equal(worker.snapshot().activeExecutions, 0);
      } finally {
        delete (worker as unknown as { executeWithRuntimeOperationContext?: unknown }).executeWithRuntimeOperationContext;
      }
    });

    await scenario("post-install lifecycle method delete and rebind cannot change operation behavior", async () => {
      const run = () => (PipelineRunner as unknown as {
        withRuntimeOperation<T>(operationType: string, operation: () => Promise<T>): Promise<T>;
      }).withRuntimeOperation("canonical-method-delete-test", async () => getActiveProductionRuntimeOperationContext());
      Object.defineProperty(worker, "executeWithRuntimeOperationContext", { configurable: true, value: undefined });
      const afterDelete = await run();
      Object.defineProperty(worker, "executeWithRuntimeOperationContext", {
        configurable: true,
        value: async <T>(_context: ProductionRuntimeOperationContext, operation: () => T | Promise<T>) => operation(),
      });
      try {
        const afterRebind = await run();
        assert.ok(afterDelete);
        assert.ok(afterRebind);
        assert.deepEqual(afterDelete.authority, processContext.authority);
        assert.deepEqual(afterRebind.authority, processContext.authority);
      } finally {
        delete (worker as unknown as { executeWithRuntimeOperationContext?: unknown }).executeWithRuntimeOperationContext;
      }
    });

    await scenario("different real lifecycle with the same context cannot overwrite canonical registration", async () => {
      const runnerModule = await import("../src/lib/pipeline/PipelineRunner");
      const alternateWorker = new ProductionWorkerLifecycle(() => initializedAt);
      assert.throws(
        () => runnerModule.installPipelineRunnerProductionRuntime(alternateWorker, processContext),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_MISMATCH",
      );
    });

    await scenario("same lifecycle with a different trusted context cannot overwrite canonical registration", () => {
      const differentContext = createProductionRuntimeOperationContext({
        operationId: "same-worker-different-context",
        operationType: "runtime-startup",
        authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext: alternateStorageContext,
      });
      assert.throws(
        () => installPipelineRunnerProductionRuntime(worker, differentContext),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_MISMATCH",
      );
    });

    await scenario("different trusted storage binding cannot replace the canonical context", () => {
      const equivalentStorageContext = createRuntimeStorageContext({
        environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
        workspaceRoot,
        authorityRoot: path.join(temporaryRoot, "authority-a"),
      });
      const reboundContext = createProductionRuntimeOperationContext({
        operationId: "rebound-storage-context",
        operationType: "runtime-startup",
        authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext: equivalentStorageContext,
      });
      assert.deepEqual(reboundContext.authority, processContext.authority);
      assert.throws(
        () => installPipelineRunnerProductionRuntime(worker, reboundContext),
        ProductionRuntimeOperationContextError,
      );
    });

    await scenario("different real lifecycle and context cannot overwrite canonical registration", async () => {
      const runnerModule = await import("../src/lib/pipeline/PipelineRunner");
      const alternateWorker = new ProductionWorkerLifecycle(() => initializedAt);
      const alternateContext = createProductionRuntimeOperationContext({
        operationId: "alternate-canonical-install",
        operationType: "runtime-startup",
        authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext: alternateStorageContext,
      });
      alternateWorker.bindRuntimeOperationContext(alternateContext);
      await alternateWorker.start({ initialization: initialization(alternateWorker) });
      const active = await (PipelineRunner as unknown as {
        withRuntimeOperation<T>(operationType: string, operation: () => Promise<T>): Promise<T>;
      }).withRuntimeOperation("canonical-overwrite-test", async () => {
        assert.throws(
          () => runnerModule.installPipelineRunnerProductionRuntime(alternateWorker, alternateContext),
          (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
            error.code === "RUNTIME_OPERATION_CONTEXT_MISMATCH",
        );
        return getActiveProductionRuntimeOperationContext();
      });
      assert.ok(active);
      assert.deepEqual(active.authority, processContext.authority);
      assert.notDeepEqual(active.authority, alternateContext.authority);
      assert.equal(alternateWorker.snapshot().activeExecutions, 0);
    });

    await scenario("plain clone spread and proxy durable adapters are rejected before fake execution", () => {
      let fakeAdapterCalls = 0;
      let handlerCalls = 0;
      const plain = { execute: async (_context: unknown, handler: () => Promise<boolean>) => { fakeAdapterCalls++; handlerCalls++; return handler(); } };
      const candidates = [plain, { ...plain }, new Proxy(plain, {})];
      for (const candidate of candidates) {
        assert.throws(
          () => PipelineRunner.configureDurableExecution(candidate as never),
          (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
            error.code === "RUNTIME_OPERATION_CONTEXT_INVALID",
        );
      }
      assert.equal(fakeAdapterCalls, 0);
      assert.equal(handlerCalls, 0);
    });

    await scenario("query-duplicated PipelineRunner shares the process canonical registration", async () => {
      const duplicateUrl = `${pathToFileURL(path.resolve("src/lib/pipeline/PipelineRunner.ts")).href}?canonical-duplicate=${Date.now()}`;
      const duplicate = await import(duplicateUrl) as typeof import("../src/lib/pipeline/PipelineRunner");
      const alternateWorker = new ProductionWorkerLifecycle(() => initializedAt);
      assert.throws(
        () => duplicate.installPipelineRunnerProductionRuntime(alternateWorker, processContext),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_MISMATCH",
      );
      duplicate.installPipelineRunnerProductionRuntime(worker, processContext);
      const harness = duplicate.PipelineRunner as unknown as Record<string, unknown>;
      const callbackNames = ["runOnce", "resumeOnce", "retryStageOnce", "continueProjectScoped", "dispatchProjectContinuationOnce", "executeJobRetryOnce"];
      const originals = new Map(callbackNames.map((name) => [name, harness[name]]));
      const observed: ProductionRuntimeOperationContext[] = [];
      for (const name of callbackNames) {
        harness[name] = async () => {
          const active = getActiveProductionRuntimeOperationContext();
          assert.ok(active);
          observed.push(active);
          return {};
        };
      }
      try {
        await duplicate.PipelineRunner.run("query-duplicate-authority");
        await duplicate.PipelineRunner.resume("query-duplicate-authority");
        await duplicate.PipelineRunner.retryStage("query-duplicate-authority", "script");
        await duplicate.PipelineRunner.continueProject("query-duplicate-authority");
        await duplicate.PipelineRunner.dispatchProjectContinuation("query-duplicate-authority");
        await duplicate.PipelineRunner.executeJobRetry("query-duplicate-authority", "job-1");
        assert.equal(observed.length, 6);
        for (const active of observed) assert.deepEqual(active.authority, processContext.authority);
      } finally {
        for (const [name, original] of originals) harness[name] = original;
      }

      const duplicateRegistryUrl = `${pathToFileURL(path.resolve("src/lib/pipeline/PipelineRunnerCanonicalRuntime.ts")).href}?registry-hmr=${Date.now()}`;
      const duplicateRegistry = await import(duplicateRegistryUrl) as typeof import("../src/lib/pipeline/PipelineRunnerCanonicalRuntime");
      assert.throws(
        () => duplicateRegistry.installPipelineRunnerProductionRuntime(worker, processContext),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_MISMATCH",
      );
      const active = await (PipelineRunner as unknown as {
        withRuntimeOperation<T>(operationType: string, operation: () => Promise<T>): Promise<T>;
      }).withRuntimeOperation("post-duplicate-rejection", async () => getActiveProductionRuntimeOperationContext());
      assert.ok(active);
      assert.deepEqual(active.authority, processContext.authority);
    });

    await scenario("clear attempts cannot remove the process canonical registration", async () => {
      const base = await import("../src/lib/pipeline/PipelineRunner");
      const duplicateUrl = `${pathToFileURL(path.resolve("src/lib/pipeline/PipelineRunner.ts")).href}?clear-attempt=${Date.now()}`;
      const duplicate = await import(duplicateUrl) as typeof import("../src/lib/pipeline/PipelineRunner");
      assert.equal("clearPipelineRunnerProductionRuntime" in base, false);
      assert.equal("clearPipelineRunnerProductionRuntime" in duplicate, false);
      assert.throws(() => (base as unknown as { clearPipelineRunnerProductionRuntime(): void }).clearPipelineRunnerProductionRuntime(), TypeError);
      assert.throws(() => (duplicate as unknown as { clearPipelineRunnerProductionRuntime(): void }).clearPipelineRunnerProductionRuntime(), TypeError);
      assert.throws(
        () => duplicate.installPipelineRunnerProductionRuntime(new ProductionWorkerLifecycle(() => initializedAt), processContext),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_MISMATCH",
      );
      const active = await (PipelineRunner as unknown as {
        withRuntimeOperation<T>(operationType: string, operation: () => Promise<T>): Promise<T>;
      }).withRuntimeOperation("post-clear-attempt", async () => getActiveProductionRuntimeOperationContext());
      assert.ok(active);
      assert.deepEqual(active.authority, processContext.authority);
    });

    await scenario("all six PipelineRunner production entries retain the same canonical pair", async () => {
      installPipelineRunnerProductionRuntime(worker, processContext);
      const harness = PipelineRunner as unknown as Record<string, unknown>;
      const callbackNames = ["runOnce", "resumeOnce", "retryStageOnce", "continueProjectScoped", "dispatchProjectContinuationOnce", "executeJobRetryOnce"];
      const originals = new Map(callbackNames.map((name) => [name, harness[name]]));
      const observed: ProductionRuntimeOperationContext[] = [];
      for (const name of callbackNames) {
        harness[name] = async () => {
          const active = getActiveProductionRuntimeOperationContext();
          assert.ok(active);
          observed.push(active);
          return {};
        };
      }
      try {
        await PipelineRunner.run("canonical-entry-test");
        await PipelineRunner.resume("canonical-entry-test");
        await PipelineRunner.retryStage("canonical-entry-test", "script");
        await PipelineRunner.continueProject("canonical-entry-test");
        await PipelineRunner.dispatchProjectContinuation("canonical-entry-test");
        await PipelineRunner.executeJobRetry("canonical-entry-test", "job-1");
        assert.equal(observed.length, 6);
        for (const active of observed) assert.deepEqual(active.authority, processContext.authority);
      } finally {
        for (const [name, original] of originals) harness[name] = original;
      }
    });

    await scenario("factory rejects missing instrumentation instead of enabling legacy execution", () => {
      assert.throws(
        () => configureProductionPipelineExecution(),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_MISSING",
      );
    });

    await scenario("recovery rejects missing context before filesystem access", async () => {
      let persistenceCalls = 0;
      const adapter = new Proxy({}, {
        get() {
          return async () => {
            persistenceCalls++;
            throw new Error("persistence must not be reached");
          };
        },
      }) as ProductionExecutionPersistenceAdapter;
      const recovery = new ProductionExecutionRecoveryBootstrap(
        adapter,
        undefined as unknown as ProductionRuntimeOperationContext,
      );
      await assert.rejects(
        recovery.bootstrapRecovery({ evaluatedAt: initializedAt }),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_INVALID",
      );
      assert.equal(persistenceCalls, 0);
    });

    await scenario("active scope cannot authorize undefined or null recovery context", async () => {
      let persistenceCalls = 0;
      const adapter = new Proxy({}, { get: () => async () => { persistenceCalls++; throw new Error("persistence must not be reached"); } }) as ProductionExecutionPersistenceAdapter;
      for (const missing of [undefined, null]) {
        const recovery = new ProductionExecutionRecoveryBootstrap(adapter, missing as unknown as ProductionRuntimeOperationContext);
        await assert.rejects(
          runWithProductionRuntimeOperationContext(processContext, () => recovery.bootstrapRecovery({ evaluatedAt: initializedAt })),
          (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
            error.code === "RUNTIME_OPERATION_CONTEXT_INVALID",
        );
      }
      assert.equal(persistenceCalls, 0);
    });

    await scenario("recovery rejects forged and different expected context before persistence", async () => {
      let persistenceCalls = 0;
      const adapter = new Proxy({}, { get: () => async () => { persistenceCalls++; throw new Error("persistence must not be reached"); } }) as ProductionExecutionPersistenceAdapter;
      const forged = Object.freeze({ ...processContext, authority: Object.freeze({ ...processContext.authority }) }) as ProductionRuntimeOperationContext;
      const alternateContext = createProductionRuntimeOperationContext({ operationId: "recovery-alternate", operationType: "runtime-recovery", authorityGeneration: initialRuntimeAuthorityGeneration, storageContext: alternateStorageContext });
      for (const expected of [forged, alternateContext]) {
        const recovery = new ProductionExecutionRecoveryBootstrap(adapter, expected);
        await assert.rejects(runWithProductionRuntimeOperationContext(processContext, () => recovery.bootstrapRecovery({ evaluatedAt: initializedAt })), ProductionRuntimeOperationContextError);
      }
      assert.equal(persistenceCalls, 0);
    });

    await scenario("revoked recovery scope cannot reach persistence", async () => {
      let persistenceCalls = 0;
      const adapter = new Proxy({}, { get: () => async () => { persistenceCalls++; throw new Error("persistence must not be reached"); } }) as ProductionExecutionPersistenceAdapter;
      const recovery = new ProductionExecutionRecoveryBootstrap(adapter, processContext);
      const observed = new Promise<unknown>((resolve) => {
        runWithProductionRuntimeOperationContext(processContext, () => setTimeout(async () => {
          try { await recovery.bootstrapRecovery({ evaluatedAt: initializedAt }); resolve("unexpected"); }
          catch (error) { resolve(error); }
        }, 0));
      });
      const error = await observed;
      assert.ok(error instanceof ProductionRuntimeOperationContextError);
      assert.equal(error.code, "RUNTIME_OPERATION_CONTEXT_MISSING");
      assert.equal(persistenceCalls, 0);
    });

    await scenario("active scope cannot bypass worker lifecycle admission", async () => {
      const blockedWorker = new ProductionWorkerLifecycle(() => initializedAt);
      let handlerCalls = 0;
      blockedWorker.bindRuntimeOperationContext(processContext);
      const executeWithRuntimeOperationContext =
        captureCanonicalProductionWorkerLifecycleExecution(blockedWorker);
      await assert.rejects(
        runWithProductionRuntimeOperationContext(
          processContext,
          () => executeWithRuntimeOperationContext(
            processContext,
            async () => { handlerCalls++; return true; },
          ),
        ),
      );
      assert.equal(handlerCalls, 0);
      await assert.rejects(fs.stat(path.join(storageContext.projectsRoot, "blocked-worker", "production-execution")), { code: "ENOENT" });
    });

    await scenario("missing durable executor fails closed before legacy handler or filesystem access", async () => {
      const harness = PipelineRunner as unknown as {
        runStage(slug: string, stage: "script", action: () => Promise<boolean>, runType: "initial"): Promise<boolean>;
        runStageLegacy(slug: string, stage: "script", action: () => Promise<boolean>, runType: "initial"): Promise<boolean>;
      };
      const originalLegacy = harness.runStageLegacy;
      let legacyCalls = 0;
      let handlerCalls = 0;
      harness.runStageLegacy = async (_slug, _stage, action) => {
        legacyCalls++;
        return action();
      };
      const projectSlug = "missing-durable-executor";
      try {
        await assert.rejects(
          harness.runStage(projectSlug, "script", async () => { handlerCalls++; return true; }, "initial"),
          (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
            error.code === "RUNTIME_OPERATION_CONTEXT_MISSING",
        );
        assert.equal(legacyCalls, 0);
        assert.equal(handlerCalls, 0);
        const durableRoot = path.join(storageContext.projectsRoot, projectSlug, "production-execution");
        assert.deepEqual(
          {
            reservation: await countFilesIfPresent(path.join(durableRoot, "reservations")),
            idempotency: await countFilesIfPresent(path.join(durableRoot, "idempotency")),
            claim: await countFilesIfPresent(path.join(durableRoot, "claims")),
            lease: await countFilesIfPresent(path.join(durableRoot, "leases")),
            attempt: await countFilesIfPresent(path.join(durableRoot, "attempts")),
            handler: handlerCalls,
          },
          {
            reservation: 0,
            idempotency: 0,
            claim: 0,
            lease: 0,
            attempt: 0,
            handler: 0,
          },
        );
        await assert.rejects(fs.stat(durableRoot), { code: "ENOENT" });
      } finally {
        harness.runStageLegacy = originalLegacy;
      }
    });

    await scenario("foreign preseeded durable process slot fails closed without adoption", () => {
      const registryUrl = pathToFileURL(path.resolve(
        "src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts",
      )).href;
      const source = `
const key = Symbol.for("@atolye/production-pipeline-execution-canonical-authority-lock/v1");
const foreign = Object.freeze({ source: "foreign-preseed" });
Object.defineProperty(globalThis, key, { configurable: false, enumerable: false, value: foreign, writable: false });
const runtime = await import(${JSON.stringify(`${registryUrl}?foreign-preseed=${Date.now()}`)});
let rejectionCode;
try {
  await runtime.executeCanonicalProductionPipelineStage(
    { projectSlug: "foreign-preseed", stage: "script", runType: "initial" },
    async () => true,
  );
} catch (error) {
  rejectionCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
}
const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
const result = {
  descriptorLocked: descriptor?.configurable === false && descriptor?.writable === false,
  foreignSlotAdopted: descriptor?.value !== foreign,
  unsafeAuthorityAccepted: rejectionCode !== "RUNTIME_OPERATION_CONTEXT_MISMATCH",
};
console.log("DURABLE_PRESEED_RESULT:" + JSON.stringify(result));
if (!result.descriptorLocked || result.foreignSlotAdopted || result.unsafeAuthorityAccepted) process.exitCode = 1;
`;
      const child = spawnSync(
        process.execPath,
        [...process.execArgv, "--input-type=module", "--eval", source],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            TSX_TSCONFIG_PATH: path.resolve(process.cwd(), "tsconfig.json"),
          },
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30_000,
        },
      );
      if (child.error) throw child.error;
      assert.equal(child.status, 0, child.stderr || child.stdout);
      const resultLine = child.stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("DURABLE_PRESEED_RESULT:"));
      assert.ok(resultLine, child.stdout);
      assert.deepEqual(
        JSON.parse(resultLine.slice("DURABLE_PRESEED_RESULT:".length)),
        {
          descriptorLocked: true,
          foreignSlotAdopted: false,
          unsafeAuthorityAccepted: false,
        },
      );
    });

    await scenario("canonical durable wiring is idempotent rejects overwrite and creates the real durable tree", async () => {
      configureProductionPipelineExecution({ lifecycle: worker, runtimeOperationContext: processContext });
      configureProductionPipelineExecution({ lifecycle: worker, runtimeOperationContext: processContext });
      const alternateWorker = new ProductionWorkerLifecycle(() => initializedAt);
      const alternateContext = createProductionRuntimeOperationContext({
        operationId: "alternate-durable-install",
        operationType: "runtime-startup",
        authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext: alternateStorageContext,
      });
      alternateWorker.bindRuntimeOperationContext(alternateContext);
      await alternateWorker.start({ initialization: initialization(alternateWorker) });
      assert.throws(
        () => configureProductionPipelineExecution({ lifecycle: alternateWorker, runtimeOperationContext: alternateContext }),
        (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_MISMATCH",
      );
      const projectSlug = "canonical-durable-wiring";
      let handlerCalls = 0;
      assert.equal(await executeConfiguredProductionPipelineStage(
        { projectSlug, stage: "script", runType: "initial" },
        async () => { handlerCalls++; return true; },
      ), true);
      assert.equal(handlerCalls, 1);
      const durableRoot = path.join(storageContext.projectsRoot, projectSlug, "production-execution");
      for (const directory of ["reservations", "claims", "idempotency", "attempts"]) {
        assert.ok((await fs.readdir(path.join(durableRoot, directory))).length > 0);
      }
    });

    await scenario("duplicate durable factories and registries cannot replace the first executor authority", async () => {
      const baseFactory = await import("../src/lib/production/ProductionPipelineExecutionFactory");
      const duplicateFactoryUrl = `${pathToFileURL(path.resolve(
        "src/lib/production/ProductionPipelineExecutionFactory.ts",
      )).href}?durable-factory-duplicate=${Date.now()}`;
      const duplicateFactory = await import(duplicateFactoryUrl) as typeof import("../src/lib/production/ProductionPipelineExecutionFactory");
      const alternateWorker = new ProductionWorkerLifecycle(() => initializedAt);
      const alternateContext = createProductionRuntimeOperationContext({
        operationId: "duplicate-durable-authority",
        operationType: "runtime-startup",
        authorityGeneration: "runtime-authority-generation-v2",
        storageContext: alternateStorageContext,
      });
      alternateWorker.bindRuntimeOperationContext(alternateContext);
      await alternateWorker.start({ initialization: initialization(alternateWorker) });

      try {
        const rawCreatorProjectSlugs = [
          "base-raw-executor-creator-rejected",
          "query-raw-executor-creator-rejected",
        ];
        let rawCreatorHandlerCalls = 0;
        for (const [index, factoryModule] of [baseFactory, duplicateFactory].entries()) {
          assert.equal("createProductionPipelineExecutionExecutor" in factoryModule, false);
          let creatorError: unknown;
          try {
            await (factoryModule as unknown as {
              createProductionPipelineExecutionExecutor(
                lifecycle: ProductionWorkerLifecycle,
                context: ProductionRuntimeOperationContext,
              ): {
                execute(
                  context: { projectSlug: string; stage: "script"; runType: "initial" },
                  handler: () => Promise<boolean>,
                ): Promise<boolean>;
              };
            }).createProductionPipelineExecutionExecutor(
              alternateWorker,
              alternateContext,
            ).execute(
              {
                projectSlug: rawCreatorProjectSlugs[index],
                stage: "script",
                runType: "initial",
              },
              async () => { rawCreatorHandlerCalls++; return true; },
            );
          } catch (error) {
            creatorError = error;
          }
          assert.ok(creatorError instanceof TypeError);
        }
        assert.equal(rawCreatorHandlerCalls, 0);
        for (const projectSlug of rawCreatorProjectSlugs) {
          const durableRoot = path.join(
            alternateStorageContext.projectsRoot,
            projectSlug,
            "production-execution",
          );
          assert.deepEqual(
            {
              reservation: await countFilesIfPresent(path.join(durableRoot, "reservations")),
              idempotency: await countFilesIfPresent(path.join(durableRoot, "idempotency")),
              claim: await countFilesIfPresent(path.join(durableRoot, "claims")),
              lease: await countFilesIfPresent(path.join(durableRoot, "leases")),
              attempt: await countFilesIfPresent(path.join(durableRoot, "attempts")),
            },
            { reservation: 0, idempotency: 0, claim: 0, lease: 0, attempt: 0 },
          );
          await assert.rejects(fs.stat(durableRoot), { code: "ENOENT" });
        }

        assert.throws(
          () => duplicateFactory.installCanonicalProductionPipelineExecution(
            alternateWorker,
            alternateContext,
          ),
          (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
            error.code === "RUNTIME_OPERATION_CONTEXT_MISMATCH",
        );
        assert.doesNotThrow(
          () => duplicateFactory.installCanonicalProductionPipelineExecution(
            worker,
            processContext,
          ),
        );

        const rejectedProjectSlug = "duplicate-durable-handler-rejected";
        let rejectedHandlerCalls = 0;
        await assert.rejects(
          runWithProductionRuntimeOperationContext(
            alternateContext,
            () => duplicateFactory.executeConfiguredProductionPipelineStage(
              { projectSlug: rejectedProjectSlug, stage: "script", runType: "initial" },
              async () => { rejectedHandlerCalls++; return true; },
            ),
          ),
          (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
            error.code === "RUNTIME_OPERATION_CONTEXT_MISMATCH",
        );
        assert.equal(rejectedHandlerCalls, 0);
        await assert.rejects(
          fs.stat(path.join(alternateStorageContext.projectsRoot, rejectedProjectSlug, "production-execution")),
          { code: "ENOENT" },
        );

        const duplicateRegistryUrl = `${pathToFileURL(path.resolve(
          "src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts",
        )).href}?durable-registry-duplicate=${Date.now()}`;
        const duplicateRegistry = await import(duplicateRegistryUrl) as typeof import("../src/lib/production/ProductionPipelineExecutionCanonicalRuntime");
        assert.equal("clearCanonicalProductionPipelineExecutionRuntime" in duplicateRegistry, false);
        assert.equal("resetCanonicalProductionPipelineExecutionRuntime" in duplicateRegistry, false);
        assert.throws(
          () => duplicateRegistry.installCanonicalProductionPipelineExecutionRuntime(
            worker,
            processContext,
          ),
          (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
            error.code === "RUNTIME_OPERATION_CONTEXT_MISMATCH",
        );

        const lockKey = Symbol.for(
          "@atolye/production-pipeline-execution-canonical-authority-lock/v1",
        );
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, lockKey);
        assert.ok(descriptor);
        assert.equal(descriptor.configurable, false);
        assert.equal(descriptor.enumerable, false);
        assert.equal(descriptor.writable, false);
        assert.equal(Reflect.deleteProperty(globalThis, lockKey), false);
        assert.equal(Reflect.defineProperty(globalThis, lockKey, {
          value: Object.freeze({ source: "replacement-attempt" }),
        }), false);

        const compositionRoot = await import("../src/lib/runtime/ProductionRuntimeCompositionRoot");
        await compositionRoot.shutdownProductionProcessRuntime();
        assert.throws(
          () => duplicateFactory.installCanonicalProductionPipelineExecution(
            alternateWorker,
            alternateContext,
          ),
          (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
            error.code === "RUNTIME_OPERATION_CONTEXT_MISMATCH",
        );

        const projectSlug = "original-durable-after-duplicate-rejection";
        let handlerCalls = 0;
        let observedContext: ProductionRuntimeOperationContext | undefined;
        assert.equal(await executeConfiguredProductionPipelineStage(
          { projectSlug, stage: "script", runType: "initial" },
          async () => {
            handlerCalls++;
            observedContext = getActiveProductionRuntimeOperationContext();
            return true;
          },
        ), true);
        assert.equal(handlerCalls, 1);
        assert.ok(observedContext);
        assert.deepEqual(observedContext.authority, processContext.authority);
        const durableRoot = path.join(storageContext.projectsRoot, projectSlug, "production-execution");
        for (const directory of ["reservations", "claims", "idempotency", "attempts"]) {
          assert.ok((await fs.readdir(path.join(durableRoot, directory))).length > 0);
        }
      } finally {
        await alternateWorker.stop();
      }
    });

    await scenario("durable disable and clear attempts leave canonical execution installed", async () => {
      const factoryModule = await import("../src/lib/production/ProductionPipelineExecutionFactory");
      assert.equal("configureCanonicalProductionPipelineExecution" in factoryModule, false);
      assert.equal("clearCanonicalProductionPipelineExecution" in factoryModule, false);
      assert.equal("resetCanonicalProductionPipelineExecution" in factoryModule, false);
      assert.throws(
        () => (factoryModule as unknown as { configureCanonicalProductionPipelineExecution(): void }).configureCanonicalProductionPipelineExecution(),
        TypeError,
      );
      const disableAttempt = configureProductionPipelineExecution as unknown as (options: {
        enabled: false;
        lifecycle: ProductionWorkerLifecycle;
        runtimeOperationContext: ProductionRuntimeOperationContext;
      }) => boolean;
      assert.equal(disableAttempt({ enabled: false, lifecycle: worker, runtimeOperationContext: processContext }), true);
      const clearAttempt = configureProductionPipelineExecution as unknown as (...args: unknown[]) => boolean;
      for (const value of [false, null]) {
        assert.throws(() => clearAttempt(value));
      }
      assert.equal(clearAttempt(
        { lifecycle: worker, runtimeOperationContext: processContext },
        { enabled: false },
      ), true);
      const projectSlug = "post-durable-disable-attempt";
      let handlerCalls = 0;
      assert.equal(await executeConfiguredProductionPipelineStage(
        { projectSlug, stage: "script", runType: "initial" },
        async () => { handlerCalls++; return true; },
      ), true);
      assert.equal(handlerCalls, 1);
      const durableRoot = path.join(storageContext.projectsRoot, projectSlug, "production-execution");
      for (const directory of ["reservations", "claims", "idempotency", "attempts"]) {
        assert.ok((await fs.readdir(path.join(durableRoot, directory))).length > 0);
      }
    });

    await scenario("production factory exposes no raw durable executor creator", async () => {
      const factoryUrl = pathToFileURL(path.resolve(
        "src/lib/production/ProductionPipelineExecutionFactory.ts",
      )).href;
      const modules = [
        await import("../src/lib/production/ProductionPipelineExecutionFactory"),
        await import(`${factoryUrl}?raw-executor-export-check=${Date.now()}`),
      ];
      for (const factoryModule of modules) {
        assert.equal("createProductionPipelineExecutionExecutor" in factoryModule, false);
        assert.equal(
          Object.keys(factoryModule).includes("createProductionPipelineExecutionExecutor"),
          false,
        );
      }
    });

    await scenario("nested mismatched context is rejected", async () => {
      const mismatched = createProductionRuntimeOperationContext({
        operationId: "nested-mismatch-test",
        operationType: "pipeline-run",
        authorityGeneration: "runtime-authority-generation-v2",
        storageContext,
      });
      await runWithProductionRuntimeOperationContext(processContext, async () => {
        assert.throws(
          () => runWithProductionRuntimeOperationContext(mismatched, () => undefined),
          (error: unknown) => error instanceof ProductionRuntimeOperationContextError &&
            error.code === "RUNTIME_OPERATION_CONTEXT_MISMATCH",
        );
      });
    });

    await scenario("public errors are normalized and path-free", () => {
      const error = new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISMATCH");
      assert.equal(error.stack, undefined);
      const serialized = JSON.stringify({ code: error.code, message: error.message });
      assert.equal(serialized.includes(temporaryRoot), false);
      assert.equal(serialized.toLowerCase().includes("users"), false);
      assert.equal(/[a-zA-Z]:[\\/]/.test(serialized), false);
    });

    await scenario("repository-local authority behavior remains available", () => {
      const repositoryContext = createRuntimeStorageContext({
        environment: {},
        workspaceRoot: process.cwd(),
        authorityRoot: path.join(temporaryRoot, "repository-authority"),
      });
      assert.equal(repositoryContext.classification, "legacy-repository");
      assert.equal(repositoryContext.projectsRoot, path.resolve(process.cwd(), "data", "projects"));
    });

    assert.equal(scenarios, 48);
    console.log(`Sprint 129.25 C.2B.4 runtime context smoke: PASS (${scenarios} scenarios; 46 retained + 2 final remediation)`);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

function initialization(worker: ProductionWorkerLifecycle): ProductionRuntimeInitializationSuccess {
  return {
    schemaVersion: "1",
    ok: true,
    decision: "ready",
    reasonCode: "RUNTIME_INITIALIZED",
    initializedAt,
    writeFree: true,
    partialInitialization: false,
    projects: [],
    counts: {
      active: 0,
      running: 0,
      terminal: 0,
      orphaned: 0,
      "expired-lease": 0,
      replayable: 0,
    },
    worker: worker.snapshot(),
    evidence: ["runtime:ready"],
  };
}

async function countFilesIfPresent(directory: string): Promise<number> {
  try {
    return (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile()).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

void main();
