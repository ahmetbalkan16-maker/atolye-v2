import { evaluateAyasGraphifyState, type AyasGraphifyFacts } from "../../ayas/developer/AyasGraphifyState";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { collectAyasGraphifyFacts, resolveAyasGraphifyModulesForStatus } from "../../ayas/developer/AyasGraphifyStateCollector";
import { createAyasActionFirewall } from "../../ayas/execution/AyasActionFirewall";
import { AyasExecutionAuthorizationStore } from "../../ayas/execution/AyasExecutionAuthorization";
import { resolveAyasExecutionAuditRoot } from "../../ayas/execution/AyasExecutionAuditContext";
import { isAyasLocalCapabilityRoot } from "../../ayas/execution/AyasCapabilityScope";
import { AYAS_DURABLE_TASK_ID, ayasDurableAttemptId, ayasDurableCanonicalJson, type AyasDurableJson, type AyasDurableTaskDefinitionInput } from "./AyasDurableTask";
import type { AyasDurableActivity } from "./AyasDurableTaskRuntime";

/**
 * Stage 15B — the first activity set of the durable task runtime.
 *
 * One activity, one domain, read-only:
 *
 *   self-development.graphify-state.read
 *
 * It records whether the knowledge graph is bound to the repository's
 * current HEAD, using the same read-only collector as
 * `scripts/ayas-graphify-status.ts`: two read-only Git queries with optional
 * locks disabled and local file reads. It never runs or refreshes Graphify,
 * never contacts a network endpoint and writes no target data. Stage 15D adds
 * mandatory grant/consume/outcome audit through the existing authorization store
 * before this ONE native read; recorded results never restore live authority.
 *
 * The repository root comes from the caller in code. The step's target is a
 * fixed logical name and its input must be empty, so no task, model or tool
 * text can point the activity at another directory. The result holds commit
 * IDs, enums and counts only: no path, no file content.
 *
 * Nothing in this module starts a task or a sweep, and no daemon imports it.
 */
export const AYAS_GRAPHIFY_STATE_ACTIVITY = "self-development.graphify-state.read";
export const AYAS_GRAPHIFY_STATE_TARGET = "repository:graphify-state";

export interface AyasFirstDurableActivitySetDeps {
  readonly repoRoot: string;
  /** Replaces the collector. Tests pass fixed facts. */
  readonly collectFacts?: (repoRoot: string) => Promise<AyasGraphifyFacts>;
  /** Trusted server/test store only. No task input can select an audit destination. */
  readonly authorizations?: AyasExecutionAuthorizationStore;
}

const HEAD = /^[a-f0-9]{40}$/;

/** The closed registry a sweep is given. Frozen: nothing can be added to it at run time. */
export function createAyasFirstDurableActivitySet(deps: AyasFirstDurableActivitySetDeps): Readonly<Record<string, AyasDurableActivity>> {
  const repoRoot = deps.repoRoot;
  const env = Object.freeze({ ...process.env });
  const modulesRoot = path.resolve(resolveAyasGraphifyModulesForStatus(env));
  let physicalRoot: string | undefined;
  let physicalModulesRoot: string | undefined;
  try {
    if (isAyasLocalCapabilityRoot(repoRoot) && isAyasLocalCapabilityRoot(modulesRoot)) {
      physicalRoot = fs.realpathSync(repoRoot);
      physicalModulesRoot = fs.realpathSync(modulesRoot);
    }
  } catch { /* unknown resource stays denied before any collector */ }
  const collectFacts = deps.collectFacts ?? ((root: string) => collectAyasGraphifyFacts({ cwd: root,
    env: { ...env, AYAS_GRAPHIFY_GLOBAL_MODULES: physicalModulesRoot }, includeUserConsumers: false }));
  const authorizations = deps.authorizations ?? new AyasExecutionAuthorizationStore({ rootDir: resolveAyasExecutionAuditRoot(), ttlMs: 120_000 });
  const startedAttempts = new Set<string>();
  const graphifyState: AyasDurableActivity = {
    declared: Object.freeze({ effect: "READ_ONLY", domains: Object.freeze(["SELF_DEVELOPMENT"] as const), targets: Object.freeze([AYAS_GRAPHIFY_STATE_TARGET]) }),
    async run(context) {
      if (ayasDurableCanonicalJson(context.input) !== "{}") return { outcome: "FAILED_NO_EFFECT", reason: "this activity takes no input", retryable: false };
      if (context.domain !== "SELF_DEVELOPMENT" || context.exactTarget !== AYAS_GRAPHIFY_STATE_TARGET || context.stepId !== "read-graphify-state" ||
          !AYAS_DURABLE_TASK_ID.test(context.taskId) || !/^[a-f0-9]{64}$/.test(context.idempotencyKey) ||
          !Number.isSafeInteger(context.attempt) || context.attempt < 1 || context.attempt > 3 ||
          context.attemptId !== ayasDurableAttemptId(context.idempotencyKey, context.attempt) || context.signal.aborted) {
        return { outcome: "FAILED_NO_EFFECT", reason: "durable activity scope refused", retryable: false };
      }
      const request = { schemaVersion: "1", action: "query-graphify", requestedBy: "ayas-durable-runtime", intent: "read repository Graphify state",
        plan: { operation: "state", activity: AYAS_GRAPHIFY_STATE_ACTIVITY, taskId: context.taskId, stepId: context.stepId,
          attempt: context.attempt, attemptId: context.attemptId, idempotencyKey: context.idempotencyKey, exactTarget: context.exactTarget } };
      let authorizationId: string;
      try {
        if (!physicalRoot || !physicalModulesRoot || fs.realpathSync(repoRoot) !== physicalRoot || fs.realpathSync(modulesRoot) !== physicalModulesRoot ||
            startedAttempts.has(context.attemptId)) throw new Error("resource or attempt changed");
        startedAttempts.add(context.attemptId);
        const firewall = createAyasActionFirewall({ repoRoot, authorizations, resolveResourceRoot: () => fs.realpathSync(repoRoot), resolveAdditionalReadRoots: () => [modulesRoot] });
        const issued = firewall.issue(request);
        if (!issued.allowed) throw new Error("grant refused");
        const admitted = firewall.admit(issued.lease, request);
        if (!admitted.allowed) throw new Error("admission refused");
        authorizationId = admitted.authorizationId;
      } catch { return { outcome: "FAILED_NO_EFFECT", reason: "durable capability admission refused", retryable: false }; }
      let facts: AyasGraphifyFacts;
      try {
        facts = await collectFacts(physicalRoot);
        authorizations.settle(authorizationId, { ok: true, resultDigest: crypto.createHash("sha256").update(JSON.stringify(facts)).digest("hex") });
      } catch {
        // The read may already have run: never claim zero dispatch or restore a consumed lease.
        return { outcome: "UNKNOWN", reason: "durable read or outcome audit failed" };
      }
      if (!facts.sourceHead || !HEAD.test(facts.sourceHead)) return { outcome: "FAILED_NO_EFFECT", reason: "repository HEAD could not be read", retryable: true };
      const status = evaluateAyasGraphifyState(facts);
      const branch = typeof facts.branch === "string" ? undefined : facts.branch;
      const graph = typeof facts.graph === "string" ? undefined : facts.graph;
      const stale = branch ? branch.stale : null;
      const result: AyasDurableJson = {
        sourceHead: facts.sourceHead,
        lastAnalyzedHead: status.lastAnalyzedHead,
        graphBuiltFromHead: status.graphBuiltFromHead,
        boundToHead: status.lastAnalyzedHead === facts.sourceHead && stale === false && !facts.needsUpdateFlag,
        stale,
        needsUpdate: facts.needsUpdateFlag,
        worktreeState: status.worktreeState,
        structuralStatus: status.structuralStatus,
        structuralReasons: status.structuralReasons.slice(0, 8).map((reason) => reason.slice(0, 120)),
        semanticStatus: status.semanticStatus,
        classification: status.classification,
        nodes: graph?.nodes ?? null,
        edges: graph?.links ?? null,
        duplicateNodes: graph?.duplicateIds ?? null,
        duplicateEdges: graph?.duplicateEdges ?? null,
        danglingEdges: graph?.dangling ?? null,
        selfLoops: graph?.selfLoops ?? null,
        incompleteCodeFiles: status.incompleteCodeFiles.length,
        criticalIncompleteFiles: status.criticalIncompleteFiles.length,
      };
      return { outcome: "SUCCEEDED", result };
    },
  };
  return Object.freeze({ [AYAS_GRAPHIFY_STATE_ACTIVITY]: Object.freeze(graphifyState) });
}

/**
 * The task that records the graph state for one commit. The key is the commit, so asking twice for the same HEAD
 * yields one task and one recorded result.
 */
export function ayasGraphifyStateTaskInput(head: string): AyasDurableTaskDefinitionInput {
  if (!HEAD.test(head)) throw new Error("AYAS_GRAPHIFY_STATE_TASK_HEAD_INVALID");
  return {
    domain: "SELF_DEVELOPMENT",
    taskKey: `graphify-state:${head}`,
    title: `Graphify binding at ${head.slice(0, 12)}`,
    steps: [{ stepId: "read-graphify-state", kind: "ACTIVITY", activity: AYAS_GRAPHIFY_STATE_ACTIVITY, effect: "READ_ONLY", exactTarget: AYAS_GRAPHIFY_STATE_TARGET, input: {}, timeoutMs: 120_000, maxAttempts: 3, retryDelayMs: 60_000 }],
  };
}
