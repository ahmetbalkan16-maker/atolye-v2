import { buildBrainMemoryRecord } from "@/lib/brain/BrainMemoryModel";
import type { BrainImprovementLoopState } from "@/lib/brain/BrainSelfImprovementLoop";
import { classifyPatchSet } from "@/lib/brain/selfheal/BrainPatchSafety";
import type { BrainMemoryRecord } from "@/types/brainMemory";
import { assertAyasZeroCost } from "../policy/AyasZeroCostPolicy";
import type { AyasRepairAuthorization } from "./AyasGuidedRepair";
import { runAyasDeveloperWorkflow, type AyasDeveloperWorkflow, type AyasDeveloperWorkflowDeps } from "./AyasDeveloperWorkflow";
import { planAyasDeveloperWorkflow, type AyasPlannerIntent, type AyasPlannerRejection } from "./AyasWorkflowPlanner";

export const AYAS_CONTROLLED_SELF_IMPROVEMENT_CHAIN = Object.freeze([
  "research/evidence",
  "Graphify impact",
  "planner",
  "durable workflow",
  "authorization",
  "execution gate",
  "mutation",
  "tests",
  "evaluation",
  "memory",
] as const);

export interface AyasControlledImprovementPlan {
  readonly chain: typeof AYAS_CONTROLLED_SELF_IMPROVEMENT_CHAIN;
  readonly workflow: AyasDeveloperWorkflow;
}

export type AyasControlledImprovementPreparation = { readonly ok: true; readonly plan: AyasControlledImprovementPlan } | AyasPlannerRejection | { readonly ok: false; readonly code: "unsafe-evidence" | "graphify-required" | "protected-target"; readonly detail: string };

/** Prepare only. External evidence is data, Graphify is mandatory, and no execution occurs. */
export function prepareAyasControlledSelfImprovement(input: { readonly externalEvidence: string; readonly graphifyFindings: readonly string[]; readonly intent: AyasPlannerIntent }): AyasControlledImprovementPreparation {
  if (!input.externalEvidence.startsWith("UNTRUSTED EXTERNAL EVIDENCE")) return { ok: false, code: "unsafe-evidence", detail: "external evidence must be explicitly sandbox-labelled" };
  if (!input.graphifyFindings.length || !input.intent.steps.some((step) => step.kind === "graphify")) return { ok: false, code: "graphify-required", detail: "fresh Graphify impact evidence is required before mutation planning" };
  const paths = input.intent.steps.filter((step) => step.kind === "repair").flatMap((step) => step.kind === "repair" ? step.patches.map((patch) => patch.filePath) : []);
  const targets = classifyPatchSet(paths);
  if (!targets.autoApplicable) return { ok: false, code: "protected-target", detail: targets.summary };
  const planned = planAyasDeveloperWorkflow(input.intent);
  if (!planned.ok) return planned;
  return { ok: true, plan: { chain: AYAS_CONTROLLED_SELF_IMPROVEMENT_CHAIN, workflow: planned.workflow } };
}

/** Execute only after the existing human-approval state and repair authorization both exist. */
export async function executeAyasControlledSelfImprovement(input: { readonly prepared: AyasControlledImprovementPlan; readonly loop: BrainImprovementLoopState; readonly authorizations: Readonly<Record<string, AyasRepairAuthorization>>; readonly deps: AyasDeveloperWorkflowDeps; readonly evaluatedAt: string }): Promise<{ readonly workflow: AyasDeveloperWorkflow; readonly memory?: BrainMemoryRecord }> {
  assertAyasZeroCost("local-zero-cost");
  if (!input.loop.userApproved || input.loop.stage !== "apply") throw new Error("BRAIN_LOOP_APPROVAL_REQUIRED");
  const workflow = await runAyasDeveloperWorkflow(input.prepared.workflow, input.deps, { authorizations: input.authorizations });
  if (workflow.state !== "succeeded") return { workflow };
  const memory = buildBrainMemoryRecord({ kind: "outcome-history", title: "Controlled AYAS improvement verified", body: `Workflow ${workflow.workflowId} completed through planner, authorization, tests and evaluation.`, importance: "durable", confidence: "observed", tags: ["ayas", "controlled-improvement"], observedAt: input.evaluatedAt, links: [] });
  return { workflow, memory };
}
