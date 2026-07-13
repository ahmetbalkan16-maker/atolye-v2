import type { ProductionWorkerLifecycleResult, ProductionWorkerLifecycleSnapshot, ProductionWorkerLifecycleStartRequest, ProductionWorkerLifecycleState } from "@/types/productionWorkerLifecycle";

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
  private initializedAt?: string;
  private failureReasonCode?: string;
  private startPromise?: Promise<ProductionWorkerLifecycleResult>;
  private drainPromise?: Promise<ProductionWorkerLifecycleResult>;
  private stopPromise?: Promise<ProductionWorkerLifecycleResult>;
  private resolveDrained?: () => void;

  snapshot(): ProductionWorkerLifecycleSnapshot {
    return { schemaVersion: "1", state: this.state, activeExecutions: this.activeExecutions, acceptingExecutions: this.state === "ready", ...(this.initializedAt ? { initializedAt: this.initializedAt } : {}), ...(this.failureReasonCode ? { failureReasonCode: this.failureReasonCode } : {}) };
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

  fail(reasonCode: string): ProductionWorkerLifecycleResult {
    if (this.state === "stopped") return result(true, "replayed", "WORKER_LIFECYCLE_STOP_REPLAYED", this.snapshot());
    if (this.state !== "failed") {
      this.state = "failed";
      this.failureReasonCode = safeReason(reasonCode);
      this.resolveDrained?.();
      this.resolveDrained = undefined;
    }
    return result(false, "failed", "WORKER_LIFECYCLE_FAILED", this.snapshot());
  }

  async execute<T>(operation: () => T | Promise<T>): Promise<T> {
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
    if (this.state !== "created" || !validInitialization(request.initialization)) {
      if (this.state === "created") this.fail("WORKER_LIFECYCLE_START_INVALID");
      return Promise.resolve(result(false, this.state === "failed" ? "failed" : "deny", this.state === "failed" ? "WORKER_LIFECYCLE_FAILED" : "WORKER_LIFECYCLE_TRANSITION_INVALID", this.snapshot()));
    }
    this.state = "starting";
    this.initializedAt = request.initialization.initializedAt;
    this.state = "ready";
    return Promise.resolve(result(true, "started", "WORKER_LIFECYCLE_STARTED", this.snapshot()));
  }

  private async drainOnce(): Promise<ProductionWorkerLifecycleResult> {
    this.state = "draining";
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
    this.state = "stopped";
    return result(true, "stopped", "WORKER_LIFECYCLE_STOPPED", this.snapshot());
  }
}

function validInitialization(value: ProductionWorkerLifecycleStartRequest["initialization"]): boolean {
  return value?.schemaVersion === "1" && value.ok === true && value.writeFree === true && value.partialInitialization === false && (value.decision === "ready" || value.decision === "recovery-required") && Array.isArray(value.projects);
}

function result(ok: boolean, decision: ProductionWorkerLifecycleResult["decision"], reasonCode: ProductionWorkerLifecycleResult["reasonCode"], snapshot: ProductionWorkerLifecycleSnapshot): ProductionWorkerLifecycleResult {
  return { schemaVersion: "1", ok, decision, reasonCode, snapshot, evidence: [`reason:${reasonCode}`, `state:${snapshot.state}`] };
}

function safeReason(value: string): string { return /^[A-Z0-9_-]{1,80}$/.test(value) ? value : "WORKER_LIFECYCLE_FAILED"; }
