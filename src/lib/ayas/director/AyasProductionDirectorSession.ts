import crypto from "node:crypto";

import type { PackageStatus, ProductionStepKey } from "../../../types/project";
import { evaluateAyasZeroCost, type AyasCostClass } from "../policy/AyasZeroCostPolicy";
import { canonicalAyasJson } from "../provenance/AyasReleaseProvenance";

/**
 * Stage 15I — the production director session.
 *
 * One read model of one production: what the owner asked for, what the
 * pipeline has made, what it cost, what is wrong, and what may happen next.
 * It binds sixteen things, each from evidence someone else read, and says of
 * each whether it is bound, not provided, not produced yet or unreadable.
 *
 * From the same facts it decides, per stage, one of five things: nothing to
 * do, wait, a safe operation of one of four classes, a question for the owner,
 * or a code defect to route into controlled self-evolution while the
 * production holds where it is.
 *
 * It never decides to change source, raise a budget, change a rights
 * classification, publish or pass a production gate: those are not in its
 * vocabulary. A safe operation is a plan. It names the existing gated path
 * that would run it and says whether that path is open; this module runs
 * nothing.
 *
 * Pure: no filesystem, no network, no clock, no environment. The collector
 * reads the facts; this module binds, classifies and decides.
 */
export const AYAS_DIRECTOR_SESSION_SCHEMA_VERSION = "1" as const;

/** The sixteen bindings of the canonical design, in its order. */
export const AYAS_DIRECTOR_BINDINGS = Object.freeze([
  "OWNER_REQUEST", "TOPIC", "TARGET_DURATION", "FORMAT", "BUDGET_AUTHORIZATION", "PIPELINE_STAGE", "CONFIG_IDENTITY", "FACT_PACK",
  "SCENE_PLAN", "ASSET_MANIFEST", "AUDIO_STATE", "ASSEMBLY_STATE", "QUALITY_FINDINGS", "COST_STATE", "FAULT_STATE", "PUBLICATION_READINESS",
] as const);
export type AyasDirectorBindingId = (typeof AYAS_DIRECTOR_BINDINGS)[number];
/** `NOT_PROVIDED`: the owner did not say. `NOT_PRODUCED_YET`: the pipeline has not made it. `UNREADABLE`: it is there and could not be read. */
export type AyasDirectorBindingState = "BOUND" | "NOT_PROVIDED" | "NOT_PRODUCED_YET" | "UNREADABLE";
export type AyasDirectorFactValue = string | number | boolean | null;
export interface AyasDirectorBinding {
  readonly id: AyasDirectorBindingId;
  readonly state: AyasDirectorBindingState;
  /** Where the evidence came from: a logical name, never a path. */
  readonly source: string;
  readonly facts: Readonly<Record<string, AyasDirectorFactValue>>;
}

/** The pipeline's stages in its fixed order. */
export const AYAS_DIRECTOR_STAGES: readonly ProductionStepKey[] = Object.freeze(["research", "script", "scenes", "visuals", "animation", "video", "audio", "assembly", "thumbnail", "seo", "youtube", "export"]);
/** Stages that build or send what leaves the machine. The director never dispatches them. */
export const AYAS_DIRECTOR_PUBLICATION_STAGES: readonly ProductionStepKey[] = Object.freeze(["youtube", "export"]);
/** From this stage on, a rights or quality block stops the director. */
const GATED_FROM_STAGE: ProductionStepKey = "assembly";

export const AYAS_DIRECTOR_SAFE_OPERATIONS = Object.freeze(["BOUNDED_TRANSIENT_RETRY", "ZERO_COST_PROVIDER_FALLBACK", "REGENERATE_LOCAL_ARTIFACT", "RESUME_AUTHORIZED_STAGE"] as const);
export type AyasDirectorSafeOperation = (typeof AYAS_DIRECTOR_SAFE_OPERATIONS)[number];
/** What the director may never decide to do. None of these is a value of any decision it returns. */
export const AYAS_DIRECTOR_FORBIDDEN = Object.freeze(["SOURCE_CODE_HOT_PATCH", "BUDGET_CAP_INCREASE", "RIGHTS_CLASSIFICATION_BYPASS", "PUBLISH", "PRODUCTION_GATE_BYPASS"] as const);

export interface AyasDirectorOwnerRequest {
  readonly requestId: string;
  readonly topic: string;
  readonly format: "DOCUMENTARY" | "GENERAL" | null;
  readonly targetDurationSeconds: number | null;
  /** The project cap the owner approved. Null when the owner approved none: the technical ceiling is not an approval. */
  readonly approvedProjectCapUsd: number | null;
}
export interface AyasDirectorStageError {
  readonly kind: string | null;
  readonly code: string | null;
  readonly rootCode: string | null;
  readonly phase: string | null;
  readonly httpStatus: number | null;
  readonly providerErrorCode: string | null;
}
export interface AyasDirectorProvider { readonly variable: string; readonly provider: string | null; readonly costClass: AyasCostClass }
export interface AyasDirectorStageFact {
  readonly stage: ProductionStepKey;
  readonly status: PackageStatus | "unknown";
  /** The stage's package file as the collector found it. */
  readonly artifact: "PRESENT" | "MISSING" | "MALFORMED";
  readonly artifactDigest: string | null;
  readonly dependsOn: readonly ProductionStepKey[];
  /** Attempts already made, when a job or the manifest records them. */
  readonly attempts: number | null;
  readonly provider: AyasDirectorProvider | null;
  /** A zero-cost provider the policy already allows for this stage, when the configured one is not zero-cost. */
  readonly zeroCostAlternative: string | null;
  readonly error: AyasDirectorStageError | null;
}
export interface AyasDirectorArtifactSummary { readonly state: "PRESENT" | "MISSING" | "MALFORMED"; readonly digest: string | null; readonly counts: Readonly<Record<string, number>> }
export interface AyasDirectorReviewFacts {
  readonly readiness: string;
  readonly preAssemblyGate: "PASS" | "REVIEW_REQUIRED" | "BLOCKED";
  readonly postAssemblyGate: "PASS" | "REVIEW_REQUIRED" | "BLOCKED" | "NOT_EVALUATED";
  readonly blockers: number;
  readonly majors: number;
  readonly rightsBlocked: boolean;
  readonly findingCodes: readonly string[];
}
export interface AyasDirectorSessionFacts {
  readonly observedAt: string;
  readonly ownerRequest: AyasDirectorOwnerRequest | null;
  readonly repositoryHead: string | null;
  readonly project: { readonly state: "PRESENT" | "MISSING" | "MALFORMED"; readonly slug: string; readonly id: string | null; readonly title: string | null; readonly status: string | null };
  readonly manifest: "PRESENT" | "ABSENT";
  readonly stages: readonly AyasDirectorStageFact[];
  readonly factPack: AyasDirectorArtifactSummary;
  readonly scenePlan: AyasDirectorArtifactSummary;
  readonly assetManifest: AyasDirectorArtifactSummary;
  readonly audio: AyasDirectorArtifactSummary;
  readonly assembly: AyasDirectorArtifactSummary;
  /** The Stage 12 advisory review. Null when it was not run; `"UNREADABLE"` when the artifacts could not be reviewed. */
  readonly review: AyasDirectorReviewFacts | "UNREADABLE" | null;
  readonly cost: { readonly state: "READ" | "ABSENT" | "UNREADABLE"; readonly knownUsd: number; readonly unknownPricingRecords: number; readonly technicalCeilingUsd: number };
  readonly publication: { readonly packageState: "PRESENT" | "MISSING" | "MALFORMED"; readonly publishRecord: "PRESENT" | "ABSENT" | "UNREADABLE"; readonly publishStatus: string | null };
  /** The pipeline's own retry bound. */
  readonly retryMaxAttempts: number;
}

export type AyasDirectorFaultClass =
  | "PROVIDER_TRANSIENT" | "PROVIDER_RATE_LIMITED" | "PROVIDER_AUTH_OR_CONFIG" | "PROVIDER_REFUSAL" | "PROVIDER_REQUEST_REJECTED" | "MODEL_OUTPUT_INVALID"
  | "LOCAL_ARTIFACT_MISSING" | "LOCAL_ARTIFACT_CORRUPT" | "LOCAL_STORAGE" | "INTERNAL_CONTRACT" | "RUNNING_UNVERIFIED" | "UNCLASSIFIED_FAILURE";
export interface AyasDirectorFault { readonly stage: ProductionStepKey; readonly faultClass: AyasDirectorFaultClass; readonly code: string | null; readonly phase: string | null; readonly httpStatus: number | null }

const TRANSIENT_CODES = /(?:_TIMEOUT|_HTTP_FAILED|_REQUEST_FAILED|_RETRY_EXHAUSTED)$/;
const INVALID_OUTPUT_CODES = /(?:_RESPONSE_EMPTY|_RESPONSE_INVALID_JSON|_SCHEMA_INVALID|_RESPONSE_TRUNCATED|_RESPONSE_INCOMPLETE|_RESPONSE_TOO_LARGE|_RESPONSE_INVALID|_CONTENT_TYPE_INVALID|_WAV_INVALID)$/;
/** Phases in which the pipeline's own contract failed: its input, its registry, its settlement. */
const INTERNAL_PHASES = new Set(["input-validation", "settlement", "asset-registration", "registry", "assembly-dependency"]);
const STORAGE_PHASES = new Set(["persistence", "storage"]);

/**
 * What kind of fault a stage is in, from its status, its package file and the structured evidence the pipeline keeps.
 * Null when the stage is not in a fault. A failure with no evidence this function knows is `UNCLASSIFIED_FAILURE`:
 * it is never guessed into a retryable class.
 */
export function classifyAyasDirectorFault(stage: AyasDirectorStageFact): AyasDirectorFault | null {
  const error = stage.error;
  const code = error?.rootCode ?? error?.code ?? null;
  const fault = (faultClass: AyasDirectorFaultClass): AyasDirectorFault => ({ stage: stage.stage, faultClass, code, phase: error?.phase ?? null, httpStatus: error?.httpStatus ?? null });
  if (stage.status === "running") return fault("RUNNING_UNVERIFIED");
  // Only a stage the manifest records as complete can have lost its file. The manifest's own "missing" means the
  // stage has not produced anything yet, which is not a fault.
  if (stage.status === "completed") {
    if (stage.artifact === "MALFORMED") return fault("LOCAL_ARTIFACT_CORRUPT");
    if (stage.artifact === "MISSING") return fault("LOCAL_ARTIFACT_MISSING");
    return null;
  }
  if (stage.status !== "failed") return null;
  if (!error) return fault("UNCLASSIFIED_FAILURE");
  const status = error.httpStatus;
  if (status === 401 || status === 403 || /invalid_api_key|unauthorized|forbidden|insufficient_quota/.test(error.providerErrorCode ?? "") || /_CONFIGURATION_INVALID$/.test(code ?? "")) return fault("PROVIDER_AUTH_OR_CONFIG");
  if (status === 429) return fault("PROVIDER_RATE_LIMITED");
  if (/_REFUSAL$/.test(code ?? "")) return fault("PROVIDER_REFUSAL");
  if (status !== null && status >= 500 && status <= 599) return fault("PROVIDER_TRANSIENT");
  if (status !== null && status >= 400 && status <= 499) return fault("PROVIDER_REQUEST_REJECTED");
  // A code that names the cause decides before the phase does: a model answer that fails plan validation is an
  // invalid answer, not a defect in the pipeline.
  if (/_STORAGE_WRITE_FAILED$/.test(code ?? "")) return fault("LOCAL_STORAGE");
  if (/_REGISTRY_FAILED$/.test(code ?? "")) return fault("INTERNAL_CONTRACT");
  if (TRANSIENT_CODES.test(code ?? "")) return fault("PROVIDER_TRANSIENT");
  if (INVALID_OUTPUT_CODES.test(code ?? "")) return fault("MODEL_OUTPUT_INVALID");
  if (STORAGE_PHASES.has(error.phase ?? "")) return fault("LOCAL_STORAGE");
  if (INTERNAL_PHASES.has(error.phase ?? "")) return fault("INTERNAL_CONTRACT");
  if (error.phase === "provider-result-validation") return fault("MODEL_OUTPUT_INVALID");
  return fault("UNCLASSIFIED_FAILURE");
}

export type AyasDirectorDecisionKind = "NONE" | "WAIT" | "SAFE_OPERATION" | "REQUIRE_OWNER" | "ROUTE_CODE_DEFECT";
export type AyasDirectorOwnerQuestion =
  | "BIND_OWNER_REQUEST" | "REPAIR_PROJECT_RECORD" | "AUTHORIZE_PAID_STAGE" | "EXTEND_RETRY_BUDGET" | "FIX_PROVIDER_CREDENTIAL_OR_CONFIG" | "DECIDE_AFTER_PROVIDER_REFUSAL"
  | "REVIEW_REJECTED_REQUEST" | "REVIEW_INVALID_MODEL_OUTPUT" | "FREE_LOCAL_STORAGE" | "REVIEW_RIGHTS_OR_QUALITY_GATE" | "REVIEW_UNCLASSIFIED_FAILURE" | "PUBLICATION_IS_OWNER_ONLY" | "REVIEW_UNKNOWN_COST_STATE";
/** The existing action a plan would use, and whether AYAS can start it today. */
export interface AyasDirectorDispatch {
  readonly action: "resume-stage" | "retry-stage" | "regenerate-stage" | "select-provider";
  /** `AYAS_WRITE_ACTION_DISABLED`: the one AYAS write action exists and is switched off. `NO_AYAS_WRITE_ACTION`: only the operator's command line does this. */
  readonly state: "AYAS_WRITE_ACTION_DISABLED" | "NO_AYAS_WRITE_ACTION";
  readonly executableByAyas: false;
}
export interface AyasDirectorDecision {
  readonly stage: ProductionStepKey | null;
  readonly kind: AyasDirectorDecisionKind;
  readonly reason: string;
  readonly safeOperation?: AyasDirectorSafeOperation;
  readonly dispatch?: AyasDirectorDispatch;
  /** The exact decision asked of the owner. */
  readonly ownerQuestion?: AyasDirectorOwnerQuestion;
  /** Short closed facts for the owner: what changed, and the numbers that matter. */
  readonly ownerFacts?: Readonly<Record<string, AyasDirectorFactValue>>;
  /** Where a code defect goes, and where the production holds. */
  readonly route?: { readonly target: "STAGE_15_CONTROLLED_SELF_EVOLUTION"; readonly holdAfterStage: ProductionStepKey | null; readonly defect: AyasDirectorFault; readonly repositoryHead: string | null };
}
export type AyasDirectorHold = "OWNER_REQUEST_NOT_BOUND" | "PROJECT_RECORD_UNREADABLE" | "REPOSITORY_HEAD_UNKNOWN" | "CODE_DEFECT_PENDING_REPAIR";

export interface AyasProductionDirectorSession {
  readonly schemaVersion: typeof AYAS_DIRECTOR_SESSION_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly observedAt: string;
  readonly projectSlug: string;
  readonly bindings: readonly AyasDirectorBinding[];
  readonly boundCount: number;
  /** The first stage that is not complete with its file readable; `COMPLETED` when there is none; `UNKNOWN` when the record cannot say. */
  readonly currentStage: ProductionStepKey | "COMPLETED" | "UNKNOWN";
  readonly watch: readonly { readonly stage: ProductionStepKey; readonly status: PackageStatus | "unknown"; readonly artifact: "PRESENT" | "MISSING" | "MALFORMED"; readonly ready: boolean; readonly fault: AyasDirectorFault | null }[];
  readonly holds: readonly AyasDirectorHold[];
  readonly decisions: readonly AyasDirectorDecision[];
  /** The session is a read model. It grants nothing; every plan in it still needs the path it names. */
  readonly authority: "NONE";
  readonly sessionDigest: string;
}

const sha256 = (text: string) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const HEAD = /^[a-f0-9]{40}$/;
const stageReady = (stage: AyasDirectorStageFact) => stage.status === "completed" && stage.artifact === "PRESENT";
const zeroCost = (provider: AyasDirectorProvider | null) => provider !== null && provider.provider !== null && evaluateAyasZeroCost(provider.costClass).allowed;
const DISPATCH: Readonly<Record<AyasDirectorSafeOperation, AyasDirectorDispatch>> = Object.freeze({
  RESUME_AUTHORIZED_STAGE: { action: "resume-stage", state: "AYAS_WRITE_ACTION_DISABLED", executableByAyas: false },
  BOUNDED_TRANSIENT_RETRY: { action: "retry-stage", state: "NO_AYAS_WRITE_ACTION", executableByAyas: false },
  REGENERATE_LOCAL_ARTIFACT: { action: "regenerate-stage", state: "NO_AYAS_WRITE_ACTION", executableByAyas: false },
  ZERO_COST_PROVIDER_FALLBACK: { action: "select-provider", state: "NO_AYAS_WRITE_ACTION", executableByAyas: false },
});

function artifactBinding(id: AyasDirectorBindingId, source: string, summary: AyasDirectorArtifactSummary): AyasDirectorBinding {
  return { id, source, state: summary.state === "PRESENT" ? "BOUND" : summary.state === "MISSING" ? "NOT_PRODUCED_YET" : "UNREADABLE", facts: { digest: summary.digest, ...summary.counts } };
}

/** The sixteen bindings. Each is one fact about where its evidence stands, never a guess: a value the owner did not give stays not provided. */
export function bindAyasDirectorSession(facts: AyasDirectorSessionFacts, faults: readonly AyasDirectorFault[], currentStage: AyasProductionDirectorSession["currentStage"]): AyasDirectorBinding[] {
  const request = facts.ownerRequest;
  const projectReadable = facts.project.state === "PRESENT" && facts.manifest === "PRESENT";
  const providers = facts.stages.map((stage) => stage.provider).filter((provider): provider is AyasDirectorProvider => provider !== null);
  const configured = [...new Map(providers.map((provider) => [provider.variable, provider])).values()].sort((a, b) => (a.variable < b.variable ? -1 : 1));
  const headKnown = HEAD.test(facts.repositoryHead ?? "");
  const byId: Record<AyasDirectorBindingId, AyasDirectorBinding> = {
    OWNER_REQUEST: { id: "OWNER_REQUEST", source: "owner-request", state: request ? "BOUND" : "NOT_PROVIDED", facts: { requestId: request?.requestId ?? null } },
    TOPIC: { id: "TOPIC", source: request ? "owner-request" : "project.json", state: request?.topic ? "BOUND" : facts.project.title ? "BOUND" : facts.project.state === "PRESENT" ? "NOT_PROVIDED" : "UNREADABLE", facts: { topic: request?.topic || facts.project.title, fromOwnerRequest: Boolean(request?.topic) } },
    TARGET_DURATION: { id: "TARGET_DURATION", source: "owner-request", state: request?.targetDurationSeconds ? "BOUND" : "NOT_PROVIDED", facts: { targetDurationSeconds: request?.targetDurationSeconds ?? null } },
    FORMAT: { id: "FORMAT", source: "owner-request", state: request?.format ? "BOUND" : "NOT_PROVIDED", facts: { format: request?.format ?? null } },
    // The technical ceiling is the pipeline's own guard. It is recorded beside the approval and is never read as one.
    BUDGET_AUTHORIZATION: { id: "BUDGET_AUTHORIZATION", source: "owner-request", state: request?.approvedProjectCapUsd != null ? "BOUND" : "NOT_PROVIDED", facts: { approvedProjectCapUsd: request?.approvedProjectCapUsd ?? null, technicalCeilingUsd: facts.cost.technicalCeilingUsd, autonomousBudgetUsd: 0 } },
    PIPELINE_STAGE: { id: "PIPELINE_STAGE", source: "manifest.json", state: projectReadable ? "BOUND" : facts.project.state === "MISSING" ? "NOT_PRODUCED_YET" : "UNREADABLE", facts: { currentStage, projectStatus: facts.project.status, completedStages: facts.stages.filter(stageReady).length } },
    CONFIG_IDENTITY: { id: "CONFIG_IDENTITY", source: "git HEAD and provider selection", state: headKnown && configured.every((provider) => provider.provider !== null) ? "BOUND" : "UNREADABLE",
      facts: { repositoryHead: headKnown ? facts.repositoryHead : null, configDigest: sha256(canonicalAyasJson(configured)), unsetProviders: configured.filter((provider) => provider.provider === null).length, paidOrUnknownProviders: configured.filter((provider) => !zeroCost(provider)).length } },
    FACT_PACK: artifactBinding("FACT_PACK", "research.json", facts.factPack),
    SCENE_PLAN: artifactBinding("SCENE_PLAN", "scenes.json", facts.scenePlan),
    ASSET_MANIFEST: artifactBinding("ASSET_MANIFEST", "assets/assets.json", facts.assetManifest),
    AUDIO_STATE: artifactBinding("AUDIO_STATE", "audio.json", facts.audio),
    ASSEMBLY_STATE: artifactBinding("ASSEMBLY_STATE", "assembly.json", facts.assembly),
    QUALITY_FINDINGS: facts.review === null
      ? { id: "QUALITY_FINDINGS", source: "stage 12 director review", state: request?.format ? "NOT_PRODUCED_YET" : "NOT_PROVIDED", facts: {} }
      : facts.review === "UNREADABLE"
        ? { id: "QUALITY_FINDINGS", source: "stage 12 director review", state: "UNREADABLE", facts: {} }
        : { id: "QUALITY_FINDINGS", source: "stage 12 director review", state: "BOUND", facts: { readiness: facts.review.readiness, preAssemblyGate: facts.review.preAssemblyGate, postAssemblyGate: facts.review.postAssemblyGate, blockers: facts.review.blockers, majors: facts.review.majors, rightsBlocked: facts.review.rightsBlocked } },
    // No usage log yet is a fact (nothing was spent through the pipeline), not an unknown.
    COST_STATE: { id: "COST_STATE", source: "ai-usage.json", state: facts.cost.state === "UNREADABLE" ? "UNREADABLE" : "BOUND", facts: { knownUsd: facts.cost.knownUsd, unknownPricingRecords: facts.cost.unknownPricingRecords, usageLog: facts.cost.state } },
    FAULT_STATE: { id: "FAULT_STATE", source: "manifest.json and pipeline jobs", state: projectReadable ? "BOUND" : "UNREADABLE", facts: { faults: faults.length, classes: [...new Set(faults.map((fault) => fault.faultClass))].sort().join(",") } },
    PUBLICATION_READINESS: { id: "PUBLICATION_READINESS", source: "youtube.json and youtube-publish.json", state: facts.publication.packageState === "MALFORMED" || facts.publication.publishRecord === "UNREADABLE" ? "UNREADABLE" : facts.publication.packageState === "PRESENT" ? "BOUND" : "NOT_PRODUCED_YET",
      facts: { package: facts.publication.packageState, publishRecord: facts.publication.publishRecord, publishStatus: facts.publication.publishStatus, publishDecision: "OWNER_ONLY" } },
  };
  return AYAS_DIRECTOR_BINDINGS.map((id) => byId[id]);
}

const ownerDecision = (stage: ProductionStepKey | null, ownerQuestion: AyasDirectorOwnerQuestion, reason: string, ownerFacts: Readonly<Record<string, AyasDirectorFactValue>> = {}): AyasDirectorDecision => ({ stage, kind: "REQUIRE_OWNER", reason, ownerQuestion, ownerFacts });
const safeDecision = (stage: ProductionStepKey, safeOperation: AyasDirectorSafeOperation, reason: string): AyasDirectorDecision => ({ stage, kind: "SAFE_OPERATION", reason, safeOperation, dispatch: DISPATCH[safeOperation] });

/**
 * What may happen next, stage by stage. Holds are decided first: with one in place no safe operation is returned for
 * the project. Then each fault, in pipeline order; then, when nothing is in a fault, the next stage.
 */
export function decideAyasDirectorActions(facts: AyasDirectorSessionFacts): { readonly holds: AyasDirectorHold[]; readonly faults: AyasDirectorFault[]; readonly currentStage: AyasProductionDirectorSession["currentStage"]; readonly decisions: AyasDirectorDecision[] } {
  const stages = AYAS_DIRECTOR_STAGES.map((key) => facts.stages.find((stage) => stage.stage === key)).filter((stage): stage is AyasDirectorStageFact => stage !== undefined);
  const projectReadable = facts.project.state === "PRESENT" && facts.manifest === "PRESENT" && stages.length === AYAS_DIRECTOR_STAGES.length;
  const faults = projectReadable ? stages.map(classifyAyasDirectorFault).filter((fault): fault is AyasDirectorFault => fault !== null) : [];
  const next = stages.find((stage) => !stageReady(stage));
  const currentStage = !projectReadable ? "UNKNOWN" : next ? next.stage : "COMPLETED";

  const holds: AyasDirectorHold[] = [];
  if (!facts.ownerRequest) holds.push("OWNER_REQUEST_NOT_BOUND");
  if (!projectReadable) holds.push("PROJECT_RECORD_UNREADABLE");
  if (!HEAD.test(facts.repositoryHead ?? "")) holds.push("REPOSITORY_HEAD_UNKNOWN");
  if (faults.some((fault) => fault.faultClass === "INTERNAL_CONTRACT")) holds.push("CODE_DEFECT_PENDING_REPAIR");
  const held = holds.length > 0;

  const decisions: AyasDirectorDecision[] = [];
  if (!facts.ownerRequest) decisions.push(ownerDecision(null, "BIND_OWNER_REQUEST", "No owner request is bound to this production, so nothing here is authorized to continue.", { project: facts.project.slug }));
  if (!projectReadable) decisions.push(ownerDecision(null, "REPAIR_PROJECT_RECORD", "The project record or its manifest could not be read in full.", { project: facts.project.state, manifest: facts.manifest, stagesRead: stages.length }));
  if (!projectReadable) return { holds, faults, currentStage, decisions };

  const spend = { knownUsd: facts.cost.knownUsd, approvedProjectCapUsd: facts.ownerRequest?.approvedProjectCapUsd ?? null, technicalCeilingUsd: facts.cost.technicalCeilingUsd };
  const review = facts.review !== null && facts.review !== "UNREADABLE" ? facts.review : null;
  const rightsOrQualityBlocked = review !== null && (review.rightsBlocked || review.preAssemblyGate === "BLOCKED");
  const gatedIndex = AYAS_DIRECTOR_STAGES.indexOf(GATED_FROM_STAGE);
  /** The checks every safe operation has to pass, whatever its class. Null when it may be planned. */
  const refuse = (stage: AyasDirectorStageFact): AyasDirectorDecision | null => {
    if (AYAS_DIRECTOR_PUBLICATION_STAGES.includes(stage.stage)) return ownerDecision(stage.stage, "PUBLICATION_IS_OWNER_ONLY", "This stage builds or sends what leaves the machine. Publication is the owner's decision.", { publishStatus: facts.publication.publishStatus });
    if (rightsOrQualityBlocked && AYAS_DIRECTOR_STAGES.indexOf(stage.stage) >= gatedIndex) return ownerDecision(stage.stage, "REVIEW_RIGHTS_OR_QUALITY_GATE", "The director review blocks this production before assembly. The gate is not passed for it.", { rightsBlocked: review?.rightsBlocked ?? null, preAssemblyGate: review?.preAssemblyGate ?? null, blockers: review?.blockers ?? null });
    if (facts.cost.state === "UNREADABLE" || facts.cost.unknownPricingRecords > 0) return ownerDecision(stage.stage, "REVIEW_UNKNOWN_COST_STATE", "What this production has cost so far is not known.", { usageLog: facts.cost.state, unknownPricingRecords: facts.cost.unknownPricingRecords });
    return null;
  };
  const paid = (stage: AyasDirectorStageFact, what: string) => ownerDecision(stage.stage, "AUTHORIZE_PAID_STAGE", `${what} would use a provider that is not zero-cost. AYAS spends nothing on its own.`, { provider: stage.provider?.provider ?? null, costClass: stage.provider?.costClass ?? "unknown-cost", ...spend });

  for (const fault of faults) {
    const stage = stages.find((candidate) => candidate.stage === fault.stage)!;
    const about = { faultClass: fault.faultClass, code: fault.code, phase: fault.phase, httpStatus: fault.httpStatus, attempts: stage.attempts };
    if (fault.faultClass === "RUNNING_UNVERIFIED") { decisions.push({ stage: stage.stage, kind: "WAIT", reason: "The stage is recorded as running. Whether its owner is alive is not known here; it is reported and not taken over." }); continue; }
    if (fault.faultClass === "INTERNAL_CONTRACT") {
      const before = stages.slice(0, stages.indexOf(stage)).reverse().find(stageReady);
      decisions.push({ stage: stage.stage, kind: "ROUTE_CODE_DEFECT", reason: "The failure is in the pipeline's own contract, not in a provider or a file. It goes to controlled self-evolution; the production holds until a validated repair is promoted.",
        route: { target: "STAGE_15_CONTROLLED_SELF_EVOLUTION", holdAfterStage: before?.stage ?? null, defect: fault, repositoryHead: HEAD.test(facts.repositoryHead ?? "") ? facts.repositoryHead : null } });
      continue;
    }
    if (fault.faultClass === "PROVIDER_REFUSAL") { decisions.push(ownerDecision(stage.stage, "DECIDE_AFTER_PROVIDER_REFUSAL", "The provider refused the content. What to change is an editorial decision.", about)); continue; }
    if (fault.faultClass === "PROVIDER_REQUEST_REJECTED") { decisions.push(ownerDecision(stage.stage, "REVIEW_REJECTED_REQUEST", "The provider rejected the request itself. Sending it again would not change the answer.", about)); continue; }
    if (fault.faultClass === "LOCAL_STORAGE") { decisions.push(ownerDecision(stage.stage, "FREE_LOCAL_STORAGE", "A local write failed. The host's storage is the owner's to look at.", about)); continue; }
    if (fault.faultClass === "UNCLASSIFIED_FAILURE") { decisions.push(ownerDecision(stage.stage, "REVIEW_UNCLASSIFIED_FAILURE", "The stage failed and the evidence does not say why. It is not retried on a guess.", about)); continue; }
    if (held) { decisions.push({ stage: stage.stage, kind: "WAIT", reason: `Held: ${holds.join(", ")}.` }); continue; }
    const refused = refuse(stage);
    if (refused) { decisions.push(refused); continue; }

    if (fault.faultClass === "LOCAL_ARTIFACT_MISSING" || fault.faultClass === "LOCAL_ARTIFACT_CORRUPT") {
      decisions.push(zeroCost(stage.provider) ? safeDecision(stage.stage, "REGENERATE_LOCAL_ARTIFACT", "The stage is recorded complete and its file is missing or unreadable. It is made again through the stage's own contract; nothing is deleted.") : paid(stage, "Making the missing file again"));
      continue;
    }
    if (fault.faultClass === "PROVIDER_AUTH_OR_CONFIG") {
      decisions.push(stage.zeroCostAlternative
        ? { ...safeDecision(stage.stage, "ZERO_COST_PROVIDER_FALLBACK", "The configured provider refuses its credential or configuration. A zero-cost provider the policy already allows can do this stage."), ownerFacts: { from: stage.provider?.provider ?? null, to: stage.zeroCostAlternative } }
        : ownerDecision(stage.stage, "FIX_PROVIDER_CREDENTIAL_OR_CONFIG", "The provider refuses its credential or configuration, and no zero-cost provider is allowed for this stage.", about));
      continue;
    }
    // Transient provider failure, rate limiting, or an invalid model answer: bounded by the pipeline's own retry limit.
    if (stage.attempts === null || stage.attempts >= facts.retryMaxAttempts) {
      decisions.push(ownerDecision(stage.stage, fault.faultClass === "MODEL_OUTPUT_INVALID" ? "REVIEW_INVALID_MODEL_OUTPUT" : "EXTEND_RETRY_BUDGET", stage.attempts === null ? "How many attempts were made is not recorded, so the retry bound cannot be checked." : "The retry bound is used up.", { ...about, retryMaxAttempts: facts.retryMaxAttempts }));
      continue;
    }
    if (zeroCost(stage.provider)) decisions.push({ ...safeDecision(stage.stage, "BOUNDED_TRANSIENT_RETRY", "A transient failure on a zero-cost provider, inside the pipeline's retry bound."), ownerFacts: { attempts: stage.attempts, retryMaxAttempts: facts.retryMaxAttempts } });
    else if (stage.zeroCostAlternative) decisions.push({ ...safeDecision(stage.stage, "ZERO_COST_PROVIDER_FALLBACK", "The configured provider is not zero-cost and failed. A zero-cost provider the policy already allows can do this stage."), ownerFacts: { from: stage.provider?.provider ?? null, to: stage.zeroCostAlternative } });
    else decisions.push(paid(stage, "Retrying this stage"));
  }

  // Nothing is in a fault: the next stage, if its dependencies are ready.
  if (faults.length === 0 && next) {
    const waitingOn = next.dependsOn.filter((dependency) => !stages.some((stage) => stage.stage === dependency && stageReady(stage)));
    if (held) decisions.push({ stage: next.stage, kind: "WAIT", reason: `Held: ${holds.join(", ")}.` });
    else if (waitingOn.length) decisions.push({ stage: next.stage, kind: "WAIT", reason: `Waiting on ${waitingOn.join(", ")}.` });
    else decisions.push(refuse(next) ?? (zeroCost(next.provider) ? safeDecision(next.stage, "RESUME_AUTHORIZED_STAGE", "The owner's production is at this stage, its dependencies are complete, and the stage's provider is zero-cost.") : paid(next, "Resuming this stage")));
  }
  if (faults.length === 0 && !next) decisions.push({ stage: null, kind: "NONE", reason: "Every stage is complete with its file readable. Publication stays the owner's decision." });
  return { holds, faults, currentStage, decisions };
}

/** Binds, classifies and decides. The same facts always give the same session, digest included. */
export function buildAyasProductionDirectorSession(facts: AyasDirectorSessionFacts): AyasProductionDirectorSession {
  const { holds, faults, currentStage, decisions } = decideAyasDirectorActions(facts);
  const bindings = bindAyasDirectorSession(facts, faults, currentStage);
  const watch = AYAS_DIRECTOR_STAGES.flatMap((key) => {
    const stage = facts.stages.find((candidate) => candidate.stage === key);
    return stage ? [{ stage: key, status: stage.status, artifact: stage.artifact, ready: stageReady(stage), fault: faults.find((fault) => fault.stage === key) ?? null }] : [];
  });
  const session = {
    schemaVersion: AYAS_DIRECTOR_SESSION_SCHEMA_VERSION,
    sessionId: `director-${sha256(canonicalAyasJson({ project: facts.project.slug, request: facts.ownerRequest?.requestId ?? null })).slice(0, 24)}`,
    observedAt: facts.observedAt, projectSlug: facts.project.slug, bindings, boundCount: bindings.filter((binding) => binding.state === "BOUND").length,
    currentStage, watch, holds, decisions, authority: "NONE" as const,
  };
  return { ...session, sessionDigest: sha256(canonicalAyasJson(session)) };
}
