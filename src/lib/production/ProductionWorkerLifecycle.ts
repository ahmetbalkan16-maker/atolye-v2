import type { ProductionWorkerLifecycleResult, ProductionWorkerLifecycleSnapshot, ProductionWorkerLifecycleStartRequest, ProductionWorkerLifecycleState } from "@/types/productionWorkerLifecycle";
import type { ProductionRuntimeInitializationFailureStatus, ProductionRuntimeStatus } from "@/types/productionRuntimeStatus";
import {
  assertProductionRuntimeOperationAuthority,
  assertProductionRuntimeOperationContext,
  ProductionRuntimeOperationContextError,
  runWithProductionRuntimeOperationContext,
  type ProductionRuntimeOperationContext,
} from "@/lib/runtime/ProductionRuntimeOperationContext";

export class ProductionWorkerLifecycleExecutionRejectedError extends Error {
  readonly reasonCode = "WORKER_LIFECYCLE_NOT_READY";
  constructor(readonly state: ProductionWorkerLifecycleState) {
    super("Production worker is not accepting executions.");
    this.name = "ProductionWorkerLifecycleExecutionRejectedError";
  }
}

export class ProductionWorkerLifecycle {
  private state: ProductionWorkerLifecycleState = "created";
  private activeExecutions = 0;
  private initialized = false;
  private recoveryCompleted = false;
  private startupTimestamp: string | null = null;
  private lastStateTransitionTimestamp: string | null = null;
  private initializedAt?: string;
  private failureReasonCode?: string;
  private failedProjectSlug?: string;
  private startPromise?: Promise<ProductionWorkerLifecycleResult>;
  private drainPromise?: Promise<ProductionWorkerLifecycleResult>;
  private stopPromise?: Promise<ProductionWorkerLifecycleResult>;
  private resolveDrained?: () => void;
  private runtimeOperationContext?: ProductionRuntimeOperationContext;

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  snapshot(): ProductionWorkerLifecycleSnapshot {
    return { schemaVersion: "1", state: this.state, activeExecutions: this.activeExecutions, acceptingExecutions: this.state === "ready", ...(this.initializedAt ? { initializedAt: this.initializedAt } : {}), ...(this.failureReasonCode ? { failureReasonCode: this.failureReasonCode } : {}) };
  }

  statusSnapshot(): ProductionRuntimeStatus {
    const initializationFailure = this.initializationFailureSnapshot();
    return Object.freeze({
      schemaVersion: "1",
      writeFree: true,
      lifecycleState: this.state,
      activeExecutionCount: this.activeExecutions,
      acceptingExecutions: this.state === "ready",
      initialized: this.initialized,
      recoveryCompleted: this.recoveryCompleted,
      workerReady: this.state === "ready" && this.initialized && this.recoveryCompleted,
      draining: this.state === "draining",
      startupTimestamp: this.startupTimestamp,
      lastStateTransitionTimestamp: this.lastStateTransitionTimestamp,
      initializationFailure,
    });
  }

  beginInitialization(startupTimestamp: string): ProductionRuntimeStatus {
    if (this.state === "created" && validDate(startupTimestamp)) {
      this.startupTimestamp = startupTimestamp;
      this.transitionTo("starting", startupTimestamp);
    }
    return this.statusSnapshot();
  }

  start(request: ProductionWorkerLifecycleStartRequest): Promise<ProductionWorkerLifecycleResult> {
    this.startPromise ??= this.startOnce(request);
    return this.startPromise;
  }

  drain(): Promise<ProductionWorkerLifecycleResult> {
    if (this.drainPromise) return this.drainPromise;
    if (this.state === "stopped") return Promise.resolve(result(true, "replayed", "WORKER_LIFECYCLE_DRAIN_REPLAYED", this.snapshot()));
    if (this.state !== "ready" && this.state !== "draining") return Promise.resolve(result(false, "deny", "WORKER_LIFECYCLE_TRANSITION_INVALID", this.snapshot()));
    this.drainPromise = this.drainOnce();
    return this.drainPromise;
  }

  stop(): Promise<ProductionWorkerLifecycleResult> {
    this.stopPromise ??= this.stopOnce();
    return this.stopPromise;
  }

  fail(reasonCode: string, details?: { failedProjectSlug?: string }): ProductionWorkerLifecycleResult {
    if (this.state === "stopped") return result(true, "replayed", "WORKER_LIFECYCLE_STOP_REPLAYED", this.snapshot());
    if (this.state !== "failed") {
      this.failureReasonCode = safeReason(reasonCode);
      this.failedProjectSlug = safeProjectSlug(details?.failedProjectSlug);
      this.transitionTo("failed");
      this.resolveDrained?.();
      this.resolveDrained = undefined;
    }
    return result(false, "failed", "WORKER_LIFECYCLE_FAILED", this.snapshot());
  }

  bindRuntimeOperationContext(context: ProductionRuntimeOperationContext): void {
    assertProductionRuntimeOperationContext(context);
    if (this.runtimeOperationContext) {
      assertProductionRuntimeOperationAuthority(this.runtimeOperationContext, context);
      return;
    }
    this.runtimeOperationContext = context;
  }

  async execute<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.runtimeOperationContext) {
      throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISSING");
    }
    return this.executeAccepted(operation);
  }

  async executeWithRuntimeOperationContext<T>(
    context: ProductionRuntimeOperationContext,
    operation: () => T | Promise<T>,
  ): Promise<T> {
    if (!this.runtimeOperationContext) {
      throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISSING");
    }
    assertProductionRuntimeOperationAuthority(this.runtimeOperationContext, context);
    return runWithProductionRuntimeOperationContext(
      context,
      () => this.executeAccepted(operation),
    );
  }

  private async executeAccepted<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.state !== "ready") throw new ProductionWorkerLifecycleExecutionRejectedError(this.state);
    this.activeExecutions++;
    try {
      return await operation();
    } finally {
      this.activeExecutions--;
      if (this.activeExecutions === 0) {
        this.resolveDrained?.();
        this.resolveDrained = undefined;
      }
    }
  }

  private startOnce(request: ProductionWorkerLifecycleStartRequest): Promise<ProductionWorkerLifecycleResult> {
    if (this.state === "ready") return Promise.resolve(result(true, "replayed", "WORKER_LIFECYCLE_START_REPLAYED", this.snapshot()));
    if ((this.state !== "created" && this.state !== "starting") || !validInitialization(request.initialization)) {
      if (this.state === "created" || this.state === "starting") this.fail("WORKER_LIFECYCLE_START_INVALID");
      return Promise.resolve(result(false, this.state === "failed" ? "failed" : "deny", this.state === "failed" ? "WORKER_LIFECYCLE_FAILED" : "WORKER_LIFECYCLE_TRANSITION_INVALID", this.snapshot()));
    }
    if (this.state === "created") {
      this.startupTimestamp = request.initialization.initializedAt;
      this.transitionTo("starting", request.initialization.initializedAt);
    }
    this.initializedAt = request.initialization.initializedAt;
    this.recoveryCompleted = true;
    this.initialized = true;
    this.transitionTo("ready");
    return Promise.resolve(result(true, "started", "WORKER_LIFECYCLE_STARTED", this.snapshot()));
  }

  private async drainOnce(): Promise<ProductionWorkerLifecycleResult> {
    this.transitionTo("draining");
    if (this.activeExecutions > 0) await new Promise<void>((resolve) => { this.resolveDrained = resolve; });
    if (this.snapshot().state === "failed") return result(false, "failed", "WORKER_LIFECYCLE_FAILED", this.snapshot());
    return result(true, "draining", "WORKER_LIFECYCLE_DRAINING", this.snapshot());
  }

  private async stopOnce(): Promise<ProductionWorkerLifecycleResult> {
    if (this.state === "stopped") return result(true, "replayed", "WORKER_LIFECYCLE_STOP_REPLAYED", this.snapshot());
    if (this.state === "ready" || this.state === "draining") {
      const drained = await this.drain();
      if (!drained.ok) return drained;
    }
    this.transitionTo("stopped");
    return result(true, "stopped", "WORKER_LIFECYCLE_STOPPED", this.snapshot());
  }

  private transitionTo(state: ProductionWorkerLifecycleState, timestamp?: string): void {
    if (this.state === state) return;
    this.state = state;
    this.lastStateTransitionTimestamp = this.readTimestamp(timestamp);
  }

  private readTimestamp(preferred?: string): string | null {
    if (preferred && validDate(preferred)) return preferred;
    try {
      const timestamp = this.now();
      return validDate(timestamp) ? timestamp : null;
    } catch {
      return null;
    }
  }

  private initializationFailureSnapshot(): ProductionRuntimeInitializationFailureStatus | null {
    if (this.state !== "failed" || !this.failureReasonCode) return null;
    return Object.freeze({ reasonCode: this.failureReasonCode, ...(this.failedProjectSlug ? { failedProjectSlug: this.failedProjectSlug } : {}) });
  }
}

const canonicalExecuteWithRuntimeOperationContext =
  ProductionWorkerLifecycle.prototype.executeWithRuntimeOperationContext;

export function captureCanonicalProductionWorkerLifecycleExecution(
  lifecycle: ProductionWorkerLifecycle,
): ProductionWorkerLifecycle["executeWithRuntimeOperationContext"] {
  if (
    !(lifecycle instanceof ProductionWorkerLifecycle) ||
    Object.getPrototypeOf(lifecycle) !== ProductionWorkerLifecycle.prototype ||
    ProductionWorkerLifecycle.prototype.executeWithRuntimeOperationContext !== canonicalExecuteWithRuntimeOperationContext ||
    lifecycle.executeWithRuntimeOperationContext !== canonicalExecuteWithRuntimeOperationContext
  ) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_INVALID");
  }
  return canonicalExecuteWithRuntimeOperationContext.bind(lifecycle);
}

function validInitialization(value: ProductionWorkerLifecycleStartRequest["initialization"]): boolean {
  return value?.schemaVersion === "1" && value.ok === true && value.writeFree === true && value.partialInitialization === false && (value.decision === "ready" || value.decision === "recovery-required") && Array.isArray(value.projects);
}

function result(ok: boolean, decision: ProductionWorkerLifecycleResult["decision"], reasonCode: ProductionWorkerLifecycleResult["reasonCode"], snapshot: ProductionWorkerLifecycleSnapshot): ProductionWorkerLifecycleResult {
  return { schemaVersion: "1", ok, decision, reasonCode, snapshot, evidence: [`reason:${reasonCode}`, `state:${snapshot.state}`] };
}

function safeReason(value: string): string { return /^[A-Z0-9_-]{1,80}$/.test(value) ? value : "WORKER_LIFECYCLE_FAILED"; }
function safeProjectSlug(value: string | undefined): string | undefined { return value && /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(value) ? value : undefined; }
function validDate(value: string): boolean { const timestamp = Date.parse(value); return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value; }
