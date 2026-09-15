/**
 * AYAS Workflow Recovery (Durable Workflow / Schema-Bound Planner sprint).
 *
 * Loading a persisted workflow and DECIDING to continue it are kept as two
 * distinct steps — recovery never auto-executes on load. `classifyAyasWorkflowRecovery`
 * inspects an already-loaded (already schema/structure-validated, see
 * `AyasDeveloperWorkflowStore.ts`) workflow and answers exactly one question:
 * is it safe to hand this to `runAyasDeveloperWorkflow` again, and if so,
 * under what caveat?
 *
 * `recoverable` and `awaiting-authorization` are the only classifications a
 * caller may act on by calling `runAyasDeveloperWorkflow` again. Every other
 * classification is a caller-visible STOP — no action follows from it here.
 *
 * Staleness (Phase 13) is checked ONLY for repair-kind steps still pending a
 * write (`pending` / `ready` / `running` / `awaiting-authorization`): each
 * such step's own `patches[].expectedHash` is re-verified against the
 * CURRENT on-disk content — the exact same precondition-hash mechanism
 * `AyasGuidedRepair.ts`'s `apply()` already uses, reused here as an
 * up-front, read-only check rather than re-implemented. A workspace root
 * must be supplied to check staleness; without one, a repair-bearing
 * recoverable workflow is conservatively classified `blocked` rather than
 * silently skipping the check.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import type { AyasDeveloperWorkflow } from "./AyasDeveloperWorkflow";
import { AyasWorkflowStoreError, validateWorkflowShape } from "./AyasDeveloperWorkflowStore";

export type AyasWorkflowRecoveryClassification =
  | "recoverable"
  | "awaiting-authorization"
  | "terminal"
  | "stale"
  | "corrupt"
  | "unsupported-schema"
  | "blocked";

export interface AyasWorkflowRecoveryResult {
  readonly classification: AyasWorkflowRecoveryClassification;
  readonly detail: string;
  /** Present only for `recoverable` / `awaiting-authorization` — the validated workflow, unchanged. */
  readonly workflow?: AyasDeveloperWorkflow;
  /** Present only for `stale` — which repair step(s) no longer match the current source. */
  readonly staleSteps?: readonly string[];
}

const TERMINAL_STATES = new Set(["succeeded", "failed", "rejected", "budget-exhausted", "repair-non-convergent", "cancelled"]);
const PENDING_WRITE_STATES = new Set(["pending", "ready", "running", "awaiting-authorization"]);

function textHash(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Read-only staleness check for every pending repair step's patches, against
 * the CURRENT on-disk content. Never mutates anything. `workspaceRoot`
 * mirrors `AyasGuidedRepairDeps.workspaceRoot`'s own default resolution.
 */
export function findAyasStaleRepairSteps(workflow: AyasDeveloperWorkflow, workspaceRoot: string): readonly string[] {
  const root = path.resolve(workspaceRoot);
  const stale: string[] = [];
  for (const record of workflow.steps) {
    if (record.step.kind !== "repair" || !PENDING_WRITE_STATES.has(record.state)) continue;
    for (const patch of record.step.patches) {
      const absolute = path.resolve(root, patch.filePath);
      const relative = path.relative(root, absolute);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) { stale.push(record.step.id); break; }
      const exists = fs.existsSync(absolute);
      const current = exists ? fs.readFileSync(absolute, "utf8") : null;
      const currentHash = current === null ? null : textHash(current);
      if (currentHash !== patch.expectedHash) { stale.push(record.step.id); break; }
    }
  }
  return stale;
}

export interface AyasWorkflowRecoveryInput {
  /** Raw, not-yet-validated envelope contents — e.g. straight from `store.tryLoad(id)?.workflow`, or `undefined` if the record itself failed to load (the caller reports the store's own error separately; this function only classifies an already-successfully-loaded shape or an explicit corruption/unsupported-schema signal). */
  readonly workflow: AyasDeveloperWorkflow | undefined;
  /** Set when the store's OWN load already failed — passed through so the caller gets one classification path instead of two. */
  readonly loadError?: { readonly code: string; readonly message: string };
  /** Required to check repair-step staleness; a repair-bearing recoverable workflow without one is classified `blocked`, never silently skipped. */
  readonly workspaceRoot?: string;
}

export function classifyAyasWorkflowRecovery(input: AyasWorkflowRecoveryInput): AyasWorkflowRecoveryResult {
  if (input.loadError) {
    if (input.loadError.code === "AYAS_WORKFLOW_STORE_UNSUPPORTED_SCHEMA") {
      return { classification: "unsupported-schema", detail: input.loadError.message };
    }
    return { classification: "corrupt", detail: input.loadError.message };
  }
  if (!input.workflow) {
    return { classification: "corrupt", detail: "no workflow supplied and no load error explained why" };
  }
  // Re-validate the shape even for an already-loaded workflow — recovery
  // must never trust an in-process object that could have been mutated by
  // untrusted code between load and this call.
  let workflow: AyasDeveloperWorkflow;
  try {
    workflow = validateWorkflowShape(input.workflow, "recovery-input");
  } catch (error) {
    if (error instanceof AyasWorkflowStoreError && error.code === "AYAS_WORKFLOW_STORE_UNSUPPORTED_SCHEMA") {
      return { classification: "unsupported-schema", detail: error.message };
    }
    return { classification: "corrupt", detail: error instanceof Error ? error.message : String(error) };
  }

  if (TERMINAL_STATES.has(workflow.state)) {
    return { classification: "terminal", detail: `workflow is already terminal (${workflow.state}) — no further action`, workflow };
  }

  const hasPendingRepair = workflow.steps.some((record) => record.step.kind === "repair" && PENDING_WRITE_STATES.has(record.state));
  if (hasPendingRepair) {
    if (!input.workspaceRoot) {
      return { classification: "blocked", detail: "a pending repair step exists but no workspaceRoot was supplied to check staleness — refusing to guess", workflow };
    }
    const staleSteps = findAyasStaleRepairSteps(workflow, input.workspaceRoot);
    if (staleSteps.length > 0) {
      return { classification: "stale", detail: `source changed since the proposal was made (step(s): ${staleSteps.join(", ")}) — no mutation will be attempted`, workflow, staleSteps };
    }
  }

  if (workflow.state === "awaiting-authorization") {
    return { classification: "awaiting-authorization", detail: "workflow is paused for explicit authorization — still awaiting it after recovery", workflow };
  }

  return { classification: "recoverable", detail: "workflow structure, budgets and (if applicable) repair preconditions are all valid — safe to resume", workflow };
}
