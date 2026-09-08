/**
 * Atölye Brain — autonomy gate (pure, deterministic).
 *
 * The Brain's most important principle: it does not make unbounded changes on
 * its own. This module is the single, code-level place that decides, per task
 * kind, whether the Brain may act without asking:
 *
 *   auto-safe             read-only analysis / diagnosis — just do it
 *   auto-safe-reversible  writes only to a temp workspace or regenerable output
 *                         (test runs, an AST-only graphify refresh, drafting a
 *                         proposal file) — do it, then report
 *   requires-user-approval  production behaviour, security policy, data, GPU
 *                           inference, cost, git push — STOP and ask
 *   forbidden             never, even with approval, from the Brain itself
 *                         (BIOS / power limits / undervolt / fan curve / HVCI /
 *                         driver swap / model pull / stress test / secret
 *                         exfiltration)
 *
 * It is intentionally boring: a fixed table, not a judgement call.
 */

import type { BrainTaskAutonomy, BrainTaskInput, BrainTaskKind } from "@/types/brainWorker";

const AUTONOMY_TABLE: Readonly<Record<BrainTaskKind, BrainTaskAutonomy>> = Object.freeze({
  "analyze-codebase": "auto-safe",
  "diagnose-failure": "auto-safe",
  "review-graph-staleness": "auto-safe",
  "quality-review": "auto-safe",
  "research-topic": "auto-safe",
  "security-audit": "auto-safe",
  "dependency-audit": "auto-safe",
  "health-check": "auto-safe",

  "run-tests": "auto-safe-reversible",
  "graphify-refresh": "auto-safe-reversible",
  "draft-improvement-proposal": "auto-safe-reversible",
  "draft-test": "auto-safe-reversible",

  "apply-improvement": "requires-user-approval",
  "modify-production-code": "requires-user-approval",
  "modify-security-policy": "requires-user-approval",
  "run-video-pipeline": "requires-user-approval",
  "gpu-inference-test": "requires-user-approval",
  "delete-or-mutate-data": "requires-user-approval",
  "git-push": "requires-user-approval",
});

/**
 * Payload keys that force a stricter classification regardless of task kind —
 * belt and braces against a mis-tagged task.
 */
const ESCALATING_PAYLOAD_KEYS: readonly string[] = Object.freeze([
  "writesOutsideWorkspace",
  "touchesEnvLocal",
  "touchesProductionData",
  "runsPaidApi",
  "runsGpu",
  "pushesGit",
  "disablesSecurityControl",
]);

const FORBIDDEN_PAYLOAD_KEYS: readonly string[] = Object.freeze([
  "changesBios",
  "changesPowerLimit",
  "changesFanCurve",
  "undervolt",
  "disablesHvci",
  "swapsDriver",
  "pullsModel",
  "runsStressTest",
  "exfiltratesSecret",
]);

export function classifyBrainTaskAutonomy(task: BrainTaskInput): BrainTaskAutonomy {
  for (const key of FORBIDDEN_PAYLOAD_KEYS) {
    if (task.payload[key] === true) return "forbidden";
  }
  const base = AUTONOMY_TABLE[task.kind] ?? "requires-user-approval";
  for (const key of ESCALATING_PAYLOAD_KEYS) {
    if (task.payload[key] === true && base !== "forbidden") {
      return "requires-user-approval";
    }
  }
  return base;
}

const AUTONOMY_RANK: Readonly<Record<BrainTaskAutonomy, number>> = Object.freeze({
  "auto-safe": 0,
  "auto-safe-reversible": 1,
  "requires-user-approval": 2,
  forbidden: 3,
});

/**
 * Whether the worker may run this task unattended, given the deployment's
 * `maxAutonomy` ceiling (`auto-safe` or `auto-safe-reversible`).
 */
export function isBrainTaskRunnableUnattended(
  autonomy: BrainTaskAutonomy,
  maxAutonomy: "auto-safe" | "auto-safe-reversible",
): boolean {
  return AUTONOMY_RANK[autonomy] <= AUTONOMY_RANK[maxAutonomy];
}

/** Human-readable reason for the classification. */
export function describeBrainTaskAutonomy(task: BrainTaskInput): string {
  const autonomy = classifyBrainTaskAutonomy(task);
  const forbidden = FORBIDDEN_PAYLOAD_KEYS.find((key) => task.payload[key] === true);
  if (forbidden) return `forbidden — payload.${forbidden} is set; the Brain never does this`;
  const escalating = ESCALATING_PAYLOAD_KEYS.find((key) => task.payload[key] === true);
  if (escalating) return `requires-user-approval — payload.${escalating} is set`;
  return `${autonomy} — task kind "${task.kind}"`;
}
