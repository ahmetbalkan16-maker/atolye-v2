/**
 * Atölye Brain — logical roles.
 *
 * The Brain is NOT one LLM. It is a set of *logical* roles:
 *
 *   planner · researcher · critic/verifier · executor · security-guard ·
 *   memory · approval-manager
 *
 * These do NOT have to be separate physical models. The simplest, free,
 * self-hostable arrangement (and the current default) is: one local model
 * (`qwen2.5:3b` via Ollama) wearing a different, fixed system-prompt "hat" per
 * role, with the deterministic guards (`BrainSafetyGovernor`,
 * `BrainSecurityPolicy`, `BrainAutonomyPolicy`, `BrainRedaction`) doing the
 * parts that must never be left to a model.
 *
 * This file defines the role contracts and the default role→model assignment.
 * The role *implementations* are later, separately-approved phases.
 */

import type {
  BrainDecisionInput,
  BrainProductionRequest,
  BrainSafetyVerdict,
  BrainStrategyRecommendation,
} from "@/types/brain";
import type { BrainMemoryQuery, BrainMemoryRecall, BrainMemoryRecordInput } from "@/types/brainMemory";
import type { BrainRequestClassification } from "@/types/brainSecurity";
import type {
  BrainTask,
  BrainTaskInput,
  BrainTaskResult,
} from "@/types/brainWorker";

export type BrainRoleId =
  | "planner"
  | "researcher"
  | "critic"
  | "executor"
  | "security-guard"
  | "memory"
  | "approval-manager";

export const BRAIN_ROLE_IDS: readonly BrainRoleId[] = Object.freeze([
  "planner",
  "researcher",
  "critic",
  "executor",
  "security-guard",
  "memory",
  "approval-manager",
]);

/* ------------------------------------------------------------------------- *
 * Role contracts
 * ------------------------------------------------------------------------- */

/** Turns a request into an ordered, safety-gated plan of tasks. */
export interface BrainPlannerRole {
  readonly roleId: "planner";
  planTasks(
    request: BrainProductionRequest,
    safety: BrainSafetyVerdict,
    recommendation?: BrainStrategyRecommendation,
  ): Promise<readonly BrainTaskInput[]>;
}

/** Gathers and compares sources; returns a findings reference, never raw dumps. */
export interface BrainResearcherRole {
  readonly roleId: "researcher";
  research(question: string): Promise<{
    readonly findingsRef: string;
    readonly reliability: "low" | "mixed" | "solid";
    readonly openQuestions: readonly string[];
  }>;
}

/** Checks another role's output for correctness, drift and hallucination. */
export interface BrainCriticRole {
  readonly roleId: "critic";
  verify(input: {
    readonly claim: string;
    readonly evidence: readonly string[];
  }): Promise<{
    readonly verdict: "supported" | "unsupported" | "contradicted" | "uncertain";
    readonly notes: readonly string[];
  }>;
}

/** Runs only tasks the autonomy gate cleared; everything else it queues for approval. */
export interface BrainExecutorRole {
  readonly roleId: "executor";
  execute(task: BrainTask): Promise<BrainTaskResult>;
}

/** The deterministic security gate in front of every executor action. */
export interface BrainSecurityGuardRole {
  readonly roleId: "security-guard";
  classify(request: {
    readonly action: string;
    readonly target: string;
  }): BrainRequestClassification;
}

/** Controlled recall / write of what the Brain knows — never secrets. */
export interface BrainMemoryRole {
  readonly roleId: "memory";
  remember(input: BrainMemoryRecordInput): Promise<{ readonly recordId: string; readonly stored: boolean }>;
  recall(query: BrainMemoryQuery): Promise<BrainMemoryRecall>;
}

/** Owns the pending-approval list; nothing critical proceeds without it. */
export interface BrainApprovalManagerRole {
  readonly roleId: "approval-manager";
  pending(): Promise<readonly BrainTask[]>;
  recordDecision(input: BrainDecisionInput): Promise<{ readonly decisionId: string }>;
}

export type BrainRole =
  | BrainPlannerRole
  | BrainResearcherRole
  | BrainCriticRole
  | BrainExecutorRole
  | BrainSecurityGuardRole
  | BrainMemoryRole
  | BrainApprovalManagerRole;

/* ------------------------------------------------------------------------- *
 * Role → model assignment
 * ------------------------------------------------------------------------- */

export interface BrainRoleModelBinding {
  readonly roleId: BrainRoleId;
  /** Provider name understood by the existing `AIRouter` (`ollama` / `mock` / …). */
  readonly provider: string;
  /** Model tag, or `"deterministic"` when the role uses no model at all. */
  readonly model: string;
  /** Short description of the fixed system-prompt "hat" (or the deterministic rule). */
  readonly hat: string;
  /** Roughly how large a single call for this role should be allowed to get. */
  readonly maxCallTokens: number;
}

/**
 * The default, free, single-machine assignment. `security-guard` and part of
 * `approval-manager` are **deterministic** — no model. Everything else is one
 * local model wearing different hats.
 */
export const DEFAULT_BRAIN_ROLE_ASSIGNMENT: readonly BrainRoleModelBinding[] = Object.freeze([
  {
    roleId: "planner",
    provider: "ollama",
    model: "qwen2.5:3b",
    hat: "Break a goal into small, ordered, safety-gated steps. Output a task list, nothing else.",
    maxCallTokens: 1_200,
  },
  {
    roleId: "researcher",
    provider: "ollama",
    model: "qwen2.5:3b",
    hat: "Answer one narrow research question at a time; cite what you used; flag what you could not verify.",
    maxCallTokens: 1_400,
  },
  {
    roleId: "critic",
    provider: "ollama",
    model: "qwen2.5:3b",
    hat: "Adversarial reviewer. Given a claim + evidence, decide supported / unsupported / contradicted / uncertain.",
    maxCallTokens: 900,
  },
  {
    roleId: "executor",
    provider: "ollama",
    model: "qwen2.5:3b",
    hat: "Carry out ONLY the current cleared step. Never widen scope. Report exactly what was done.",
    maxCallTokens: 1_200,
  },
  {
    roleId: "security-guard",
    provider: "mock",
    model: "deterministic",
    hat: "No model. Deterministic allowlist / denylist / path / redaction checks in BrainSecurityPolicy.ts.",
    maxCallTokens: 0,
  },
  {
    roleId: "memory",
    provider: "mock",
    model: "deterministic",
    hat: "No model for storage. Deterministic redaction + build/validate; a model may only summarise on read.",
    maxCallTokens: 0,
  },
  {
    roleId: "approval-manager",
    provider: "mock",
    model: "deterministic",
    hat: "No model. Deterministic state machine + pending-task list; renders proposals for the user.",
    maxCallTokens: 0,
  },
]);

export function resolveBrainRoleBinding(
  roleId: BrainRoleId,
  assignment: readonly BrainRoleModelBinding[] = DEFAULT_BRAIN_ROLE_ASSIGNMENT,
): BrainRoleModelBinding {
  const binding = assignment.find((entry) => entry.roleId === roleId);
  if (!binding) {
    throw new Error(`No Brain role binding for "${roleId}".`);
  }
  return binding;
}

/** `true` when a role is enforced purely in code (no model call). */
export function isDeterministicBrainRole(roleId: BrainRoleId): boolean {
  return resolveBrainRoleBinding(roleId).model === "deterministic";
}
