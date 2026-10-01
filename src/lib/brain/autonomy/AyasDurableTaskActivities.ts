import { evaluateAyasGraphifyState, type AyasGraphifyFacts } from "../../ayas/developer/AyasGraphifyState";
import { collectAyasGraphifyFacts } from "../../ayas/developer/AyasGraphifyStateCollector";
import { ayasDurableCanonicalJson, type AyasDurableJson, type AyasDurableTaskDefinitionInput } from "./AyasDurableTask";
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
 * never contacts a network endpoint and writes nothing.
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
}

const HEAD = /^[a-f0-9]{40}$/;

/** The closed registry a sweep is given. Frozen: nothing can be added to it at run time. */
export function createAyasFirstDurableActivitySet(deps: AyasFirstDurableActivitySetDeps): Readonly<Record<string, AyasDurableActivity>> {
  const collectFacts = deps.collectFacts ?? ((repoRoot: string) => collectAyasGraphifyFacts({ cwd: repoRoot }));
  const graphifyState: AyasDurableActivity = {
    declared: Object.freeze({ effect: "READ_ONLY", domains: Object.freeze(["SELF_DEVELOPMENT"] as const), targets: Object.freeze([AYAS_GRAPHIFY_STATE_TARGET]) }),
    async run(context) {
      if (ayasDurableCanonicalJson(context.input) !== "{}") return { outcome: "FAILED_NO_EFFECT", reason: "this activity takes no input", retryable: false };
      const facts = await collectFacts(deps.repoRoot);
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
