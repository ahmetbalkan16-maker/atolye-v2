import crypto from "node:crypto";
import type { ProductionStepKey } from "../../../types/project";
import { pipelineStageDependencies } from "../../pipeline/PipelineRecoveryPlanner";
import { parseAyasLocalCodingTaskContract, type AyasLocalCodingTaskContract } from "../../brain/autonomy/AyasLocalCodingTaskContract";
import {
  AYAS_DIRECTOR_STAGES, buildAyasProductionDirectorSession,
  type AyasDirectorDecision, type AyasDirectorDispatch, type AyasDirectorFault, type AyasDirectorFaultClass, type AyasDirectorHold, type AyasDirectorOwnerQuestion,
  type AyasDirectorSessionFacts, type AyasProductionDirectorSession,
} from "./AyasProductionDirectorSession";

/**
 * Stage 15L — production fault repair and resume.
 *
 * The director session (Stage 15I) already reads a production, classifies a
 * stage's fault from the pipeline's evidence and decides what may happen next.
 * This module says the same thing in the vocabulary of the repair design: the
 * twelve fault classes, the six safe repairs, how long a retry waits, which
 * existing mechanisms a repair has to go through, what a code defect becomes,
 * and why an unknown fault stops.
 *
 * It adds two things the session does not look for: a stage recorded complete
 * on top of a dependency that is not, and an upload the publish record left
 * in flight.
 *
 * A repair is a plan. It names the existing path that would run it; no path is
 * opened here and nothing is started. A code defect is never patched in
 * production: it becomes a coding task for controlled self-evolution and the
 * production holds. An unknown fault fails closed and says what is known.
 *
 * Pure: it decides from facts it is given.
 */
export const AYAS_PRODUCTION_FAULT_CLASSES = Object.freeze([
  "TRANSIENT_EXTERNAL", "PROVIDER_UNAVAILABLE", "RATE_LIMIT", "ASSET_MISSING", "ASSET_CORRUPT", "RIGHTS_BLOCK", "QUALITY_BLOCK", "COST_BLOCK", "HOST_DEPENDENCY", "PIPELINE_STATE_DRIFT", "CODE_DEFECT", "UNKNOWN",
] as const);
export type AyasProductionFaultClass = (typeof AYAS_PRODUCTION_FAULT_CLASSES)[number];

export const AYAS_PRODUCTION_SAFE_REPAIRS = Object.freeze([
  "BOUNDED_RETRY_BACKOFF", "ZERO_COST_FALLBACK", "REGENERATE_LOCAL_SCENE_ASSET", "RERUN_DETERMINISTIC_ASSEMBLY", "RESUME_DURABLE_STAGE", "RECONCILE_INDETERMINATE_UPLOAD",
] as const);
export type AyasProductionSafeRepair = (typeof AYAS_PRODUCTION_SAFE_REPAIRS)[number];

/** The existing mechanisms the design says a repair must reuse. A plan names the ones its dispatch has to go through. */
export const AYAS_PRODUCTION_REPAIR_REUSE = Object.freeze(["IDEMPOTENCY", "DURABLE_RECOVERY", "STAGE_BOUNDED_RESUME", "RETRY_BUDGET", "RUNTIME_STABILITY_GUARD"] as const);
export type AyasProductionRepairReuse = (typeof AYAS_PRODUCTION_REPAIR_REUSE)[number];

/** How long a retry waits. Stated policy, not a measurement: one minute, doubling, never more than fifteen. */
export const AYAS_PRODUCTION_REPAIR_BACKOFF = Object.freeze({ baseSeconds: 60, factor: 2, maxSeconds: 900 });

/** Stages FFmpeg renders from files that are already there: running one again spends nothing and gives the same result. */
const DETERMINISTIC_STAGES: readonly ProductionStepKey[] = Object.freeze(["video", "assembly"]);

export type AyasProductionRepairAction = "AUTO_REPAIR_PLAN" | "REQUIRE_OWNER" | "CODING_TASK" | "FAIL_CLOSED" | "WAIT" | "NONE";
export interface AyasProductionRepairPlan {
  readonly stage: ProductionStepKey | null;
  /** Null when the item is not a fault: an owner-only stage, or a production with nothing wrong. */
  readonly faultClass: AyasProductionFaultClass | null;
  readonly action: AyasProductionRepairAction;
  readonly repair: AyasProductionSafeRepair | null;
  /** For a retry: which attempt it would be, of how many, and how long to wait first. */
  readonly backoff: { readonly attempt: number; readonly of: number; readonly delaySeconds: number } | null;
  readonly reuse: readonly AyasProductionRepairReuse[];
  readonly dispatch: AyasDirectorDispatch | { readonly action: "reconcile-publish"; readonly state: "OWNER_PUBLISH_PIPELINE_ONLY"; readonly executableByAyas: false } | null;
  readonly ownerQuestion: AyasDirectorOwnerQuestion | "RECONCILE_PIPELINE_STATE" | null;
  /** For a code defect: the task controlled self-evolution is given, and the steps it has to pass before production resumes. */
  readonly codingTask: { readonly target: "STAGE_15_CONTROLLED_SELF_EVOLUTION"; readonly productionHotPatch: false; readonly holdAfterStage: ProductionStepKey | null; readonly repositoryHead: string | null; readonly defect: { readonly stage: ProductionStepKey; readonly code: string | null; readonly phase: string | null }; readonly steps: readonly string[] } | null;
  readonly explanation: string;
}
export interface AyasProductionRepairReport {
  readonly schemaVersion: "1";
  readonly projectSlug: string;
  readonly sessionId: string;
  readonly sessionDigest: string;
  readonly holds: readonly AyasDirectorHold[];
  readonly plans: readonly AyasProductionRepairPlan[];
  readonly counts: Readonly<Record<AyasProductionRepairAction, number>>;
  /** A report plans; it starts nothing. */
  readonly authority: "NONE";
}

const CLASS_OF: Readonly<Record<AyasDirectorFaultClass, AyasProductionFaultClass>> = Object.freeze({
  PROVIDER_TRANSIENT: "TRANSIENT_EXTERNAL",
  // A provider answer that cannot be used is retried like a transient failure and, past the bound, is the owner's.
  MODEL_OUTPUT_INVALID: "TRANSIENT_EXTERNAL",
  PROVIDER_RATE_LIMITED: "RATE_LIMIT",
  PROVIDER_AUTH_OR_CONFIG: "PROVIDER_UNAVAILABLE", PROVIDER_REFUSAL: "PROVIDER_UNAVAILABLE", PROVIDER_REQUEST_REJECTED: "PROVIDER_UNAVAILABLE",
  LOCAL_ARTIFACT_MISSING: "ASSET_MISSING", LOCAL_ARTIFACT_CORRUPT: "ASSET_CORRUPT",
  LOCAL_STORAGE: "HOST_DEPENDENCY",
  RUNNING_UNVERIFIED: "PIPELINE_STATE_DRIFT",
  INTERNAL_CONTRACT: "CODE_DEFECT",
  UNCLASSIFIED_FAILURE: "UNKNOWN",
});
const QUESTION_CLASS: Readonly<Partial<Record<AyasDirectorOwnerQuestion, AyasProductionFaultClass>>> = Object.freeze({
  AUTHORIZE_PAID_STAGE: "COST_BLOCK", REVIEW_UNKNOWN_COST_STATE: "COST_BLOCK", FREE_LOCAL_STORAGE: "HOST_DEPENDENCY", REPAIR_PROJECT_RECORD: "PIPELINE_STATE_DRIFT",
  FIX_PROVIDER_CREDENTIAL_OR_CONFIG: "PROVIDER_UNAVAILABLE", DECIDE_AFTER_PROVIDER_REFUSAL: "PROVIDER_UNAVAILABLE", REVIEW_REJECTED_REQUEST: "PROVIDER_UNAVAILABLE", REVIEW_UNCLASSIFIED_FAILURE: "UNKNOWN",
});
const CODING_TASK_STEPS = Object.freeze(["local sandbox", "tests", "Graphify", "proposal", "owner promotion", "resume"]);

/** The fault class of the design for a fault the director named. */
export function classifyAyasProductionFault(fault: Pick<AyasDirectorFault, "faultClass">): AyasProductionFaultClass {
  return CLASS_OF[fault.faultClass] ?? "UNKNOWN";
}

/** The wait before attempt number `attempt` (the first retry is attempt 2). A rate limit waits the longest step: the provider's own wait is not in the evidence. */
export function ayasRepairBackoffSeconds(attempt: number, rateLimited: boolean): number {
  const { baseSeconds, factor, maxSeconds } = AYAS_PRODUCTION_REPAIR_BACKOFF;
  if (rateLimited || !Number.isSafeInteger(attempt) || attempt < 2) return rateLimited ? maxSeconds : baseSeconds;
  return Math.min(maxSeconds, baseSeconds * factor ** (attempt - 2));
}

function fromDecision(decision: AyasDirectorDecision, session: AyasProductionDirectorSession, facts: AyasDirectorSessionFacts): AyasProductionRepairPlan {
  const fault = decision.stage ? session.watch.find((entry) => entry.stage === decision.stage)?.fault ?? null : null;
  const faultClass = fault ? classifyAyasProductionFault(fault) : null;
  const stageFact = decision.stage ? facts.stages.find((stage) => stage.stage === decision.stage) : undefined;
  const base = { stage: decision.stage, faultClass, repair: null, backoff: null, reuse: [] as AyasProductionRepairReuse[], dispatch: null, ownerQuestion: null, codingTask: null, explanation: decision.reason };

  if (decision.kind === "SAFE_OPERATION") {
    const dispatch = decision.dispatch ?? null;
    if (decision.safeOperation === "BOUNDED_TRANSIENT_RETRY") {
      const attempt = (stageFact?.attempts ?? 0) + 1;
      return { ...base, action: "AUTO_REPAIR_PLAN", repair: "BOUNDED_RETRY_BACKOFF", dispatch, backoff: { attempt, of: facts.retryMaxAttempts, delaySeconds: ayasRepairBackoffSeconds(attempt, faultClass === "RATE_LIMIT") }, reuse: ["IDEMPOTENCY", "RETRY_BUDGET", "STAGE_BOUNDED_RESUME", "RUNTIME_STABILITY_GUARD"] };
    }
    if (decision.safeOperation === "ZERO_COST_PROVIDER_FALLBACK") return { ...base, action: "AUTO_REPAIR_PLAN", repair: "ZERO_COST_FALLBACK", dispatch, reuse: ["IDEMPOTENCY", "STAGE_BOUNDED_RESUME", "RUNTIME_STABILITY_GUARD"] };
    if (decision.safeOperation === "REGENERATE_LOCAL_ARTIFACT") {
      const deterministic = decision.stage !== null && DETERMINISTIC_STAGES.includes(decision.stage);
      return { ...base, action: "AUTO_REPAIR_PLAN", repair: deterministic ? "RERUN_DETERMINISTIC_ASSEMBLY" : "REGENERATE_LOCAL_SCENE_ASSET", dispatch, reuse: ["IDEMPOTENCY", "STAGE_BOUNDED_RESUME", "RUNTIME_STABILITY_GUARD"] };
    }
    return { ...base, action: "AUTO_REPAIR_PLAN", repair: "RESUME_DURABLE_STAGE", dispatch, reuse: ["IDEMPOTENCY", "DURABLE_RECOVERY", "STAGE_BOUNDED_RESUME", "RUNTIME_STABILITY_GUARD"] };
  }
  if (decision.kind === "ROUTE_CODE_DEFECT" && decision.route) {
    return { ...base, faultClass: "CODE_DEFECT", action: "CODING_TASK",
      codingTask: { target: decision.route.target, productionHotPatch: false, holdAfterStage: decision.route.holdAfterStage, repositoryHead: decision.route.repositoryHead, defect: { stage: decision.route.defect.stage, code: decision.route.defect.code, phase: decision.route.defect.phase }, steps: CODING_TASK_STEPS } };
  }
  if (decision.kind === "REQUIRE_OWNER") {
    const question = decision.ownerQuestion ?? null;
    if (question === "REVIEW_UNCLASSIFIED_FAILURE") {
      // Fail closed, and say what is and is not known.
      const known = [`stage ${decision.stage ?? "unknown"}`, `status ${stageFact?.status ?? "unknown"}`, `attempts ${stageFact?.attempts ?? "not recorded"}`, stageFact?.error ? `evidence code ${stageFact.error.rootCode ?? stageFact.error.code ?? "none"}, phase ${stageFact.error.phase ?? "none"}` : "no structured evidence"];
      return { ...base, faultClass: "UNKNOWN", action: "FAIL_CLOSED", ownerQuestion: question, explanation: `The failure does not match any class this module knows, so nothing is repaired automatically. Known: ${known.join("; ")}.` };
    }
    const review = facts.review !== null && facts.review !== "UNREADABLE" ? facts.review : null;
    const gateClass: AyasProductionFaultClass | null = question === "REVIEW_RIGHTS_OR_QUALITY_GATE" ? (review?.rightsBlocked ? "RIGHTS_BLOCK" : "QUALITY_BLOCK") : null;
    return { ...base, faultClass: gateClass ?? (question ? QUESTION_CLASS[question] ?? faultClass : faultClass), action: "REQUIRE_OWNER", ownerQuestion: question };
  }
  if (decision.kind === "WAIT") return { ...base, action: "WAIT" };
  return { ...base, action: "NONE" };
}

/**
 * The repair plan for one production. Every item of the director session is carried over in the design's vocabulary;
 * two further checks are added.
 */
export function planAyasProductionRepairs(facts: AyasDirectorSessionFacts): AyasProductionRepairReport {
  const session = buildAyasProductionDirectorSession(facts);
  const plans = session.decisions.map((decision) => fromDecision(decision, session, facts));
  const none = { repair: null, backoff: null, reuse: [] as AyasProductionRepairReuse[], dispatch: null, ownerQuestion: null, codingTask: null };
  // A report cannot infer an attempt, dependency or cap from malformed evidence.
  const invalid = facts.stages.length !== AYAS_DIRECTOR_STAGES.length || new Set(facts.stages.map((stage) => stage.stage)).size !== AYAS_DIRECTOR_STAGES.length
    || !Number.isSafeInteger(facts.retryMaxAttempts) || facts.retryMaxAttempts < 1
    || facts.stages.some((stage) => !AYAS_DIRECTOR_STAGES.includes(stage.stage)
      || (stage.attempts !== null && (!Number.isSafeInteger(stage.attempts) || stage.attempts < 0))
      || JSON.stringify([...stage.dependsOn].sort()) !== JSON.stringify([...pipelineStageDependencies[stage.stage]].sort()))
    || !Number.isFinite(facts.cost.knownUsd) || facts.cost.knownUsd < 0 || !Number.isFinite(facts.cost.technicalCeilingUsd) || facts.cost.technicalCeilingUsd < 0
    || !Number.isSafeInteger(facts.cost.unknownPricingRecords) || facts.cost.unknownPricingRecords < 0;
  if (invalid) {
    return { schemaVersion: "1", projectSlug: session.projectSlug, sessionId: session.sessionId, sessionDigest: session.sessionDigest, holds: session.holds,
      plans: [{ ...none, stage: null, faultClass: "UNKNOWN", action: "FAIL_CLOSED", explanation: "The stage inventory, dependency table, retry counts or cost evidence is invalid. No repair can be planned from these facts." }],
      counts: { AUTO_REPAIR_PLAN: 0, REQUIRE_OWNER: 0, CODING_TASK: 0, FAIL_CLOSED: 1, WAIT: 0, NONE: 0 }, authority: "NONE" };
  }

  // A stage recorded complete on top of a dependency that is not: the records disagree with each other. That is not
  // repaired by running something; the existing reconciliation is the owner's tool.
  const ready = new Set(session.watch.filter((entry) => entry.ready).map((entry) => entry.stage));
  for (const key of AYAS_DIRECTOR_STAGES) {
    const stage = facts.stages.find((candidate) => candidate.stage === key);
    if (!stage || stage.status !== "completed") continue;
    const unready = stage.dependsOn.filter((dependency) => !ready.has(dependency));
    if (unready.length > 0 && !plans.some((plan) => plan.stage === key && plan.faultClass === "PIPELINE_STATE_DRIFT")) {
      plans.push({ ...none, stage: key, faultClass: "PIPELINE_STATE_DRIFT", action: "REQUIRE_OWNER", ownerQuestion: "RECONCILE_PIPELINE_STATE", explanation: `The stage is recorded complete while ${unready.join(", ")} is not. The records disagree; they are reconciled with the existing diagnosis, not by running a stage.` });
    }
  }

  // An upload the publish record left in flight. The publish pipeline can ask the platform for it by its marker and
  // never uploads twice. Publishing is the owner's, so this is a plan for the owner's pipeline.
  if (facts.publication.publishRecord === "PRESENT" && facts.publication.publishStatus === "publishing") {
    plans.push({ ...none, stage: null, faultClass: "PIPELINE_STATE_DRIFT", action: "AUTO_REPAIR_PLAN", repair: "RECONCILE_INDETERMINATE_UPLOAD", reuse: ["IDEMPOTENCY", "DURABLE_RECOVERY"],
      dispatch: { action: "reconcile-publish", state: "OWNER_PUBLISH_PIPELINE_ONLY", executableByAyas: false },
      explanation: "The publish record says an upload was started and does not say how it ended. It is reconciled by its marker through the publish pipeline; the video is not uploaded again." });
  }

  if (facts.publication.publishRecord === "UNREADABLE" || (facts.publication.publishStatus === "publishing" && facts.publication.publishRecord !== "PRESENT")) {
    plans.push({ ...none, stage: null, faultClass: "UNKNOWN", action: "FAIL_CLOSED", explanation: "The publication record cannot prove the result of a possible side effect. Nothing is uploaded or replayed; inspect the durable publish record first." });
  }

  // With a hold in place nothing is repaired automatically, whatever was found above.
  const held = session.holds.length > 0;
  const drift = plans.some((plan) => plan.ownerQuestion === "RECONCILE_PIPELINE_STATE");
  const uncertain = plans.some((plan) => plan.action === "FAIL_CLOSED");
  const running = facts.stages.some((stage) => stage.status === "running");
  const publishing = facts.publication.publishStatus === "publishing";
  const final = plans.map((plan): AyasProductionRepairPlan => {
    if (plan.action !== "AUTO_REPAIR_PLAN") return plan;
    if (held || drift || uncertain || running || (publishing && plan.repair !== "RECONCILE_INDETERMINATE_UPLOAD")) {
      return { ...plan, ...none, action: "WAIT", explanation: `Repair waits: ${session.holds.join(", ") || (drift ? "pipeline records disagree" : uncertain ? "unproven side effect or failure" : running ? "a stage owner is unverified" : "publication reconciliation is pending")}.` };
    }
    if (plan.repair === "RECONCILE_INDETERMINATE_UPLOAD") return plan;
    if (facts.review === "UNREADABLE") return { ...plan, ...none, action: "FAIL_CLOSED", explanation: "The quality and rights evidence is unreadable. Nothing is repaired on an assumed gate result." };
    const stage = facts.stages.find((entry) => entry.stage === plan.stage)!;
    const unready = stage.dependsOn.filter((dependency) => !ready.has(dependency));
    if (unready.length) return { ...plan, ...none, action: "WAIT", explanation: `Repair waits for ${unready.join(", ")}; only the exact stage may resume after its dependencies are ready.` };
    if (facts.cost.knownUsd > facts.cost.technicalCeilingUsd) return { ...plan, ...none, faultClass: "COST_BLOCK", action: "REQUIRE_OWNER", ownerQuestion: "REVIEW_UNKNOWN_COST_STATE", explanation: "Recorded spend exceeds the technical ceiling. The cap is never raised by a repair." };
    if (stage.status === "failed" || stage.status === "completed") {
      if (stage.attempts === null || stage.attempts >= facts.retryMaxAttempts) return { ...plan, ...none, action: "REQUIRE_OWNER", ownerQuestion: "EXTEND_RETRY_BUDGET", explanation: "The existing retry budget is exhausted or cannot be proven; fallback and regeneration cannot bypass it." };
    }
    return { ...plan, reuse: [...new Set([...plan.reuse, "RETRY_BUDGET" as const])] };
  });
  const counts = { AUTO_REPAIR_PLAN: 0, REQUIRE_OWNER: 0, CODING_TASK: 0, FAIL_CLOSED: 0, WAIT: 0, NONE: 0 };
  for (const plan of final) counts[plan.action] += 1;
  return { schemaVersion: "1", projectSlug: session.projectSlug, sessionId: session.sessionId, sessionDigest: session.sessionDigest, holds: session.holds, plans: final, counts, authority: "NONE" };
}

/** Localization supplies exact files and a line budget; a fault code alone cannot invent that scope. No task is enqueued here. */
export function buildAyasProductionRepairCodingTask(report: AyasProductionRepairReport, stage: ProductionStepKey, scope: { readonly exactFiles: readonly string[]; readonly maxChangedLines: number }): AyasLocalCodingTaskContract {
  const route = report.plans.find((plan) => plan.stage === stage && plan.action === "CODING_TASK")?.codingTask;
  if (!route?.repositoryHead) throw new Error("AYAS_PRODUCTION_REPAIR_CODING_SCOPE_REQUIRED");
  const digest = crypto.createHash("sha256").update(JSON.stringify({ session: report.sessionId, head: route.repositoryHead, defect: route.defect, scope })).digest("hex");
  return parseAyasLocalCodingTaskContract({ schemaVersion: "1", taskId: `ayas-coding-${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`,
    baseHead: route.repositoryHead, objective: `Repair the ${stage} pipeline contract at the bound HEAD; validate before owner promotion.`, exactFiles: scope.exactFiles, maxChangedLines: scope.maxChangedLines });
}
