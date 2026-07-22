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

export interface ProductionWorkerLifecycleExecutionIdentity {
  readonly projectSlug: string;
  readonly stage: string;
  readonly operation: string;
  readonly leaseId?: string;
  readonly executionFingerprint: string;
}

export interface ProductionWorkerLifecycleAuthoritySnapshot {
  readonly policyVersion: "production-worker-lifecycle-authority-v1";
  readonly lifecycleGeneration: number;
  readonly lifecycleState: ProductionWorkerLifecycleState;
  readonly activeExecutionCount: number;
  readonly activeExecutionIdentities: readonly ProductionWorkerLifecycleExecutionIdentity[];
  readonly conflict: boolean;
  readonly runtimeAuthorityGeneration: string;
  readonly runtimeOperationBinding: string;
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
  private lifecycleGeneration = 0;
  private readonly activeExecutionIdentities =
    new Map<string, ProductionWorkerLifecycleExecutionIdentity>();

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
    identity?: ProductionWorkerLifecycleExecutionIdentity,
  ): Promise<T> {
    if (!this.runtimeOperationContext) {
      throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISSING");
    }
    assertProductionRuntimeOperationAuthority(this.runtimeOperationContext, context);
    bindActiveLifecycle(context, this);
    try {
      return await runWithProductionRuntimeOperationContext(
        context,
        () => this.executeAccepted(operation, identity),
      );
    } finally { unbindActiveLifecycle(context, this); }
  }

  private async executeAccepted<T>(operation: () => T | Promise<T>,
    identity?: ProductionWorkerLifecycleExecutionIdentity): Promise<T> {
    if (this.state !== "ready") throw new ProductionWorkerLifecycleExecutionRejectedError(this.state);
    this.activeExecutions++;
    const key = identity ? `${identity.executionFingerprint}:${this.lifecycleGeneration + 1}` : undefined;
    if (key && identity) {
      this.activeExecutionIdentities.set(key, Object.freeze({ ...identity }));
      this.lifecycleGeneration++;
    }
    try {
      return await operation();
    } finally {
      if (key) {
        this.activeExecutionIdentities.delete(key);
        this.lifecycleGeneration++;
      }
      this.activeExecutions--;
      if (this.activeExecutions === 0) {
        this.resolveDrained?.();
        this.resolveDrained = undefined;
      }
    }
  }

  authoritySnapshot(context: ProductionRuntimeOperationContext,
    expectedProjectSlug: string, admittedExecutionFingerprint?: string):
  ProductionWorkerLifecycleAuthoritySnapshot {
    if (activeLifecycle(context) !== this) {
      throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISSING");
    }
    assertProductionRuntimeOperationAuthority(this.runtimeOperationContext!, context);
    const identities = [...this.activeExecutionIdentities.values()]
      .filter((identity) => identity.executionFingerprint !== admittedExecutionFingerprint)
      .sort((left, right) => left.executionFingerprint < right.executionFingerprint ? -1 : 1);
    const conflict = identities.some((identity) => identity.projectSlug === expectedProjectSlug);
    return Object.freeze({ policyVersion: "production-worker-lifecycle-authority-v1",
      lifecycleGeneration: this.lifecycleGeneration, lifecycleState: this.state,
      activeExecutionCount: identities.length,
      activeExecutionIdentities: Object.freeze(identities.map((identity) => Object.freeze({ ...identity }))),
      conflict, runtimeAuthorityGeneration: context.authority.authorityGeneration,
      runtimeOperationBinding: context.bindingFingerprint });
  }

  async withExecutionIdentity<T>(identity: ProductionWorkerLifecycleExecutionIdentity,
    operation: () => T | Promise<T>): Promise<T> {
    const key = `${identity.executionFingerprint}:${this.lifecycleGeneration + 1}`;
    this.activeExecutionIdentities.set(key, Object.freeze({ ...identity }));
    this.lifecycleGeneration++;
    try { return await operation(); }
    finally { this.activeExecutionIdentities.delete(key); this.lifecycleGeneration++; }
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

interface ActiveLifecycleBinding { readonly lifecycle: ProductionWorkerLifecycle; depth: number }
const activeLifecycles = new WeakMap<ProductionRuntimeOperationContext, ActiveLifecycleBinding>();

function bindActiveLifecycle(context: ProductionRuntimeOperationContext,
  lifecycle: ProductionWorkerLifecycle): void {
  const current = activeLifecycles.get(context);
  if (current) {
    if (current.lifecycle !== lifecycle) throw new ProductionRuntimeOperationContextError(
      "RUNTIME_OPERATION_CONTEXT_MISMATCH");
    current.depth++;
  } else activeLifecycles.set(context, { lifecycle, depth: 1 });
}

function unbindActiveLifecycle(context: ProductionRuntimeOperationContext,
  lifecycle: ProductionWorkerLifecycle): void {
  const current = activeLifecycles.get(context);
  if (!current || current.lifecycle !== lifecycle) return;
  current.depth--;
  if (current.depth === 0) activeLifecycles.delete(context);
}

function activeLifecycle(context: ProductionRuntimeOperationContext):
ProductionWorkerLifecycle | undefined {
  return activeLifecycles.get(context)?.lifecycle;
}

export function readProductionWorkerLifecycleAuthority(
  context: ProductionRuntimeOperationContext,
  expectedProjectSlug: string,
  admittedExecutionFingerprint?: string,
): ProductionWorkerLifecycleAuthoritySnapshot {
  const lifecycle = activeLifecycle(context);
  if (!lifecycle) throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISSING");
  return lifecycle.authoritySnapshot(context, expectedProjectSlug, admittedExecutionFingerprint);
}

export function runWithProductionWorkerLifecycleIdentity<T>(
  context: ProductionRuntimeOperationContext,
  identity: ProductionWorkerLifecycleExecutionIdentity,
  operation: () => T | Promise<T>,
): Promise<T> {
  const lifecycle = activeLifecycle(context);
  if (!lifecycle) throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISSING");
  return lifecycle.withExecutionIdentity(identity, operation);
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
