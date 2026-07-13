import { PipelineRecoveryPlanner, pipelineRecoveryStageOrder } from "@/lib/pipeline/PipelineRecoveryPlanner";
import { stableProductionId } from "./ProductionDeterminism";
import { ProductionExecutionLifecycle } from "./ProductionExecutionLifecycle";
import { validateProductionExecutionDurableAttempt } from "./ProductionExecutionDurableAttempt";
import type { PipelineRecoveryPlan, PipelineRecoveryStageKey } from "@/types/pipelineRecovery";
import type { ProductionExecutionDurableAttemptRecord } from "@/types/productionExecutionDurableAttempt";
import type { ProductionExecutionIdempotencyRecord } from "@/types/productionExecutionIdempotency";
import type { ProductionExecutionPersistenceAdapter } from "@/types/productionExecutionPersistence";
import type {
  ProductionExecutionRecoveryBootstrapAttempt,
  ProductionExecutionRecoveryBootstrapClassification,
  ProductionExecutionRecoveryBootstrapPlannerPlan,
  ProductionExecutionRecoveryBootstrapRequest,
  ProductionExecutionRecoveryBootstrapResult,
} from "@/types/productionExecutionRecoveryBootstrap";

export interface ProductionExecutionRecoveryPlannerPort {
  createJobRetryPlan(projectSlug: string, stage: PipelineRecoveryStageKey): Promise<PipelineRecoveryPlan>;
}

const terminalStates = new Set(["succeeded", "failed", "cancelled", "abandoned"]);
const attemptKey = /^(.+)-v([1-9][0-9]*)$/;

export class ProductionExecutionRecoveryBootstrap {
  private readonly lifecycle: ProductionExecutionLifecycle;

  constructor(
    private readonly adapter: ProductionExecutionPersistenceAdapter,
    private readonly planner: ProductionExecutionRecoveryPlannerPort = PipelineRecoveryPlanner,
  ) {
    this.lifecycle = new ProductionExecutionLifecycle(adapter);
  }

  async bootstrapRecovery(request: ProductionExecutionRecoveryBootstrapRequest): Promise<ProductionExecutionRecoveryBootstrapResult> {
    const evaluatedAt = normalizeDate(request.evaluatedAt);
    if (!evaluatedAt) return this.result("invalid", "indeterminate", [], []);

    const listed = await this.adapter.listKeys("attempt");
    if (!listed.ok) return this.result(evaluatedAt, "indeterminate", [], []);

    const records = await this.loadAttemptChains(listed.keys);
    const idempotency = await this.loadLatestIdempotencyRecords();
    const attempts: ProductionExecutionRecoveryBootstrapAttempt[] = [];

    for (const chain of records) attempts.push(await this.classify(chain, evaluatedAt, idempotency));
    attempts.sort((left, right) => left.attemptId.localeCompare(right.attemptId));

    const plannerPlans: ProductionExecutionRecoveryBootstrapPlannerPlan[] = [];
    for (const item of attempts) {
      if (!item.recoveryCandidate || item.terminal || !item.projectSlug || !item.stage) continue;
      const plan = await this.planner.createJobRetryPlan(item.projectSlug, item.stage);
      const startStage = plan.startStage && pipelineRecoveryStageOrder.includes(plan.startStage) ? plan.startStage : null;
      const stagesToRun = plan.stagesToRun.filter((stage) => pipelineRecoveryStageOrder.includes(stage));
      const safePlan = {
        attemptId: item.attemptId,
        projectSlug: item.projectSlug,
        stage: item.stage,
        type: "retry" as const,
        startStage,
        stagesToRun,
        blocked: plan.blocked,
        ...(safeText(plan.reason) ? { reason: plan.reason } : {}),
        dependencies: plan.dependencies
          .filter((dependency) => pipelineRecoveryStageOrder.includes(dependency.stage))
          .map((dependency) => ({
            stage: dependency.stage,
            status: dependency.status,
            completed: dependency.completed,
            fileReady: dependency.fileReady,
            ready: dependency.ready,
            ...(safeText(dependency.reason) ? { reason: dependency.reason } : {}),
          })),
      };
      plannerPlans.push({ ...safePlan, fingerprint: stableProductionId("production-recovery-bootstrap-plan", safePlan) });
    }
    plannerPlans.sort((left, right) => left.attemptId.localeCompare(right.attemptId));

    return this.result(evaluatedAt, attempts.some((item) => item.recoveryCandidate) ? "recovery-required" : "ready", attempts, plannerPlans);
  }

  private async loadAttemptChains(keys: readonly string[]): Promise<AttemptChain[]> {
    const grouped = new Map<string, Array<{ key: string; version: number }>>();
    const invalid: AttemptChain[] = [];
    for (const key of [...keys].sort()) {
      const match = attemptKey.exec(key);
      if (!match) {
        invalid.push({ attemptId: safeIdentifier(key), versions: [], valid: false });
        continue;
      }
      const values = grouped.get(match[1]) ?? [];
      values.push({ key, version: Number(match[2]) });
      grouped.set(match[1], values);
    }

    const chains: AttemptChain[] = [...invalid];
    for (const [attemptId, versions] of grouped) {
      versions.sort((left, right) => left.version - right.version);
      const records: ProductionExecutionDurableAttemptRecord[] = [];
      let valid = versions.every((item, index) => item.version === index + 1);
      for (const item of versions) {
        const read = await this.adapter.read("attempt", item.key);
        if (read.status !== "found" || !validateProductionExecutionDurableAttempt(read.value) || read.value.identity.attemptId !== attemptId || read.value.attemptVersion !== item.version) {
          valid = false;
          continue;
        }
        records.push(read.value);
      }
      if (valid) valid = records.every((record, index) => index === 0 || immutableSuccessor(records[index - 1], record));
      chains.push({ attemptId, versions: records, valid });
    }
    return chains;
  }

  private async loadLatestIdempotencyRecords(): Promise<Map<string, ProductionExecutionIdempotencyRecord>> {
    const output = new Map<string, { version: number; value: ProductionExecutionIdempotencyRecord }>();
    const listed = await this.adapter.listKeys("idempotency");
    if (!listed.ok) return new Map();
    for (const key of listed.keys) {
      const match = attemptKey.exec(key);
      if (!match) continue;
      const read = await this.adapter.read("idempotency", key);
      if (read.status !== "found") continue;
      const current = output.get(match[1]);
      if (!current || current.version < Number(match[2])) output.set(match[1], { version: Number(match[2]), value: read.value });
    }
    return new Map([...output].map(([recordId, item]) => [recordId, item.value]));
  }

  private async classify(chain: AttemptChain, evaluatedAt: string, idempotency: Map<string, ProductionExecutionIdempotencyRecord>): Promise<ProductionExecutionRecoveryBootstrapAttempt> {
    const latest = chain.versions.at(-1);
    if (!latest || !chain.valid) return orphaned(chain.attemptId, latest);

    const assessment = await this.lifecycle.inspect(latest.identity.attemptId, evaluatedAt);
    const linked = idempotency.get(latest.identity.recordId);
    const stage = linked && pipelineRecoveryStageOrder.includes(linked.stage as PipelineRecoveryStageKey) ? linked.stage as PipelineRecoveryStageKey : undefined;
    const terminal = terminalStates.has(latest.state);
    const orphan = assessment.classification === "missing-linked-claim" || assessment.classification === "partial-coordination" || assessment.classification === "integrity-mismatch" || assessment.classification === "journal-corruption" || assessment.classification === "indeterminate";
    const expired = assessment.classification === "expired-lease";
    const classifications: ProductionExecutionRecoveryBootstrapClassification[] = [];
    if (terminal) classifications.push("terminal");
    else classifications.push("active");
    if (latest.state === "active") classifications.push("running");
    if (orphan) classifications.push("orphaned");
    if (expired) classifications.push("expired-lease");
    if (!terminal && chain.valid && !orphan) classifications.push("replayable");

    const primaryClassification: ProductionExecutionRecoveryBootstrapClassification = terminal ? "terminal" : orphan ? "orphaned" : expired ? "expired-lease" : latest.state === "active" ? "running" : "active";
    const recoveryCandidate = !terminal && (orphan || expired || latest.state === "opened" || latest.state === "outcome-proposed");
    const action = terminal ? "skip-terminal" : orphan ? "manual-recovery" : expired ? "recover-expired-lease" : latest.state === "active" ? "wait-for-owner" : "resume-through-coordinator-worker";
    return {
      attemptId: latest.identity.attemptId,
      state: latest.state,
      primaryClassification,
      classifications,
      action,
      reasonCode: assessment.reasonCode,
      attemptVersion: latest.attemptVersion,
      journalSequence: latest.journal.at(-1)?.sequence ?? 0,
      journalValid: true,
      versionChainValid: true,
      recoveryCandidate,
      terminal,
      ...(linked ? { projectSlug: linked.projectSlug, ...(stage ? { stage } : {}) } : {}),
      ownership: { claimId: latest.identity.claimId, leaseId: latest.identity.leaseId, workerId: latest.identity.workerId, workerSessionId: latest.identity.workerSessionId },
      evidence: [`classification:${primaryClassification}`, `reason:${assessment.reasonCode}`, "bootstrap:write-free"],
    };
  }

  private result(evaluatedAt: string, decision: ProductionExecutionRecoveryBootstrapResult["decision"], attempts: ProductionExecutionRecoveryBootstrapAttempt[], plannerPlans: ProductionExecutionRecoveryBootstrapPlannerPlan[]): ProductionExecutionRecoveryBootstrapResult {
    const counts = { active: 0, running: 0, terminal: 0, orphaned: 0, "expired-lease": 0, replayable: 0 };
    for (const attempt of attempts) for (const classification of attempt.classifications) counts[classification]++;
    const core = { evaluatedAt, decision, attempts, plannerPlans, counts };
    return { schemaVersion: "1", bootstrapId: stableProductionId("production-recovery-bootstrap", core), ...core, writeFree: true, evidence: [`decision:${decision}`, "bootstrap:read-only"] };
  }
}

interface AttemptChain { attemptId: string; versions: ProductionExecutionDurableAttemptRecord[]; valid: boolean }

function immutableSuccessor(previous: ProductionExecutionDurableAttemptRecord, next: ProductionExecutionDurableAttemptRecord): boolean {
  if (next.attemptVersion !== previous.attemptVersion + 1 || JSON.stringify(next.identity) !== JSON.stringify(previous.identity) || JSON.stringify(next.binding) !== JSON.stringify(previous.binding) || next.journal.length !== previous.journal.length + 1) return false;
  return previous.journal.every((entry, index) => entry.integrity.fingerprint === next.journal[index]?.integrity.fingerprint);
}

function orphaned(attemptId: string, latest?: ProductionExecutionDurableAttemptRecord): ProductionExecutionRecoveryBootstrapAttempt {
  const terminal = latest ? terminalStates.has(latest.state) : false;
  return { attemptId: safeIdentifier(attemptId), state: latest?.state ?? "unknown", primaryClassification: "orphaned", classifications: terminal ? ["terminal", "orphaned"] : ["orphaned"], action: terminal ? "skip-terminal" : "manual-recovery", reasonCode: "ATTEMPT_RECOVERY_REQUIRED", attemptVersion: latest?.attemptVersion ?? 0, journalSequence: latest?.journal.at(-1)?.sequence ?? 0, journalValid: false, versionChainValid: false, recoveryCandidate: !terminal, terminal, evidence: ["classification:orphaned", "reason:ATTEMPT_RECOVERY_REQUIRED", "bootstrap:write-free"] };
}

function normalizeDate(value: string): string | undefined { const timestamp = Date.parse(value); return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? value : undefined; }
function safeIdentifier(value: string): string { return /^[a-z0-9][a-z0-9_-]{0,101}$/.test(value) ? value : stableProductionId("production-recovery-artifact", value); }
function safeText(value: string | undefined): value is string { return typeof value === "string" && value.length <= 200 && !/secret|token|api.?key|stack|[a-zA-Z]:[\\/]|\.\.[\\/]|provider.?response/i.test(value); }
