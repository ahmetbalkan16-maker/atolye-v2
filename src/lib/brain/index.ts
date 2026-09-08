/**
 * Atölye Brain — public surface.
 *
 * The Brain is the roadmap's PHASE 6 ("Intelligence": AI Director + Production
 * Memory + Knowledge Engine). Everything here is **pure / deterministic** and
 * **additive** — no module in `src/lib/pipeline` or `src/lib/production` imports
 * from `src/lib/brain`, and nothing here calls a model, a binary, or the
 * network. Wiring the Brain to real execution is a separate, user-approved
 * phase.
 */

/* ---- domain types ---- */
export type {
  BrainPhase,
  BrainTopicCategory,
  BrainQualityFloor,
  BrainCostPolicy,
  BrainProductionRequest,
  BrainHardwareProfile,
  BrainResourceSource,
  BrainAbnormalSignal,
  BrainResourceSnapshot,
  BrainSafetyDecision,
  BrainStrategyConstraint,
  BrainSafetyVerdict,
  BrainComputationMode,
  BrainWorkUnitKind,
  BrainWorkUnit,
  BrainStageWorkload,
  BrainComputationPlan,
  BrainDecisionInput,
  BrainDecision,
  BrainDecisionLogReasonCode,
  BrainDecisionLogValidation,
  BrainQualityDimension,
  BrainQualityStatus,
  BrainQualityObservation,
  BrainQualityOutcome,
  BrainRepairTarget,
  BrainQualityVerdict,
  BrainRenderedSceneReport,
  BrainFinalRenderReport,
  BrainStageOutcome,
  BrainErrorClass,
  BrainStageExperience,
  BrainMediaStrategy,
  BrainMediaStrategyOutcome,
  BrainExperienceRecord,
  BrainExperienceQuery,
  BrainInsightKind,
  BrainExperienceInsight,
  BrainStrategyRecommendation,
  BrainSelfImprovementStep,
  BrainImprovementApprovalState,
  BrainImprovementOption,
  BrainImprovementProposalInput,
  BrainImprovementEvent,
  BrainImprovementTransition,
  BrainImprovementProposal,
  BrainImprovementTransitionReasonCode,
  BrainImprovementTransitionResult,
} from "@/types/brain";
export { brainSchemaVersion, BRAIN_PHASE_ORDER, BRAIN_SELF_IMPROVEMENT_STEPS } from "@/types/brain";

export type {
  BrainMemoryKind,
  BrainMemoryImportance,
  BrainMemoryConfidence,
  BrainMemoryRecordInput,
  BrainMemoryRecord,
  BrainMemoryQuery,
  BrainMemoryRecall,
  BrainMemoryValidation,
  BrainMemoryValidationReasonCode,
} from "@/types/brainMemory";
export { brainMemorySchemaVersion } from "@/types/brainMemory";

export type {
  BrainTaskKind,
  BrainTaskStatus,
  BrainTaskPriority,
  BrainTaskAutonomy,
  BrainTaskInput,
  BrainTask,
  BrainTaskOutcomeKind,
  BrainTaskResult,
  BrainWorkerConfig,
  BrainWorkerCycleReport,
  BrainTaskQueueReasonCode,
  BrainTaskQueueValidation,
} from "@/types/brainWorker";
export { brainWorkerSchemaVersion } from "@/types/brainWorker";

export type {
  BrainSecurityControlId,
  BrainSecurityControlStatus,
  BrainSecuritySeverity,
  BrainSecurityEnforcementStyle,
  BrainSecurityControl,
  BrainSecurityFinding,
  BrainSecurityPostureInput,
  BrainSecurityPosture,
  BrainRequestRisk,
  BrainRequestClassification,
} from "@/types/brainSecurity";
export { brainSecuritySchemaVersion } from "@/types/brainSecurity";

/* ---- contracts / ports ---- */
export type {
  BrainSafetyGovernor,
  BrainComputationStrategist,
  BrainUnderstoodRequest,
  BrainPlanner,
  BrainResearchAgent,
  BrainMediaIntelligence,
  BrainScriptIntelligence,
  BrainSceneIntelligence,
  BrainProductionStrategist,
  BrainQualityJudge,
  BrainRepairAgent,
  BrainExperienceStore,
  BrainSystemOptimizer,
  BrainDecisionRecorderPort,
  BrainOrchestratorResult,
  BrainOrchestrator,
} from "./BrainContracts";

/* ---- roles ---- */
export type {
  BrainRoleId,
  BrainPlannerRole,
  BrainResearcherRole,
  BrainCriticRole,
  BrainExecutorRole,
  BrainSecurityGuardRole,
  BrainMemoryRole,
  BrainApprovalManagerRole,
  BrainRole,
  BrainRoleModelBinding,
} from "./BrainRoles";
export {
  BRAIN_ROLE_IDS,
  DEFAULT_BRAIN_ROLE_ASSIGNMENT,
  resolveBrainRoleBinding,
  isDeterministicBrainRole,
} from "./BrainRoles";

/* ---- id primitive ---- */
export { stableBrainId, stableBrainValue } from "./BrainId";

/* ---- decision journal ---- */
export {
  buildBrainDecision,
  validateBrainDecisionLog,
  BrainDecisionRecorder,
  renderBrainDecisionReport,
  brainDecisionLogFingerprint,
  stringifyBrainDecision,
} from "./BrainDecisionJournal";

/* ---- safety governor ---- */
export {
  DEFAULT_BRAIN_HARDWARE_PROFILES,
  BrainHardwareProfileError,
  resolveBrainHardwareProfile,
  BRAIN_ABORT_SIGNALS,
  BRAIN_HOLD_SIGNALS,
  brainThermalThresholds,
  evaluateBrainSafety,
  describeBrainSafetyVerdict,
} from "./BrainSafetyGovernor";
export type { BrainThermalThresholds } from "./BrainSafetyGovernor";

/* ---- computation planner ---- */
export {
  BRAIN_CHARS_PER_TOKEN,
  estimateStageWorkload,
  planStageComputation,
  describeBrainComputationPlan,
} from "./BrainComputationPlanner";
export type { BrainWorkloadEstimateInput } from "./BrainComputationPlanner";

/* ---- quality judge ---- */
export { evaluateBrainQuality, describeBrainQualityVerdict } from "./BrainQualityModel";

/* ---- experience / memory learning ---- */
export {
  deriveBrainExperienceInsights,
  recommendStrategyFromExperience,
  renderBrainExperienceInsights,
} from "./BrainExperienceModel";

/* ---- improvement proposals ---- */
export {
  buildBrainImprovementProposal,
  advanceBrainImprovementProposal,
  isBrainImprovementApproved,
  renderBrainImprovementProposalReport,
} from "./BrainImprovementProposal";

/* ---- self-improvement loop ---- */
export {
  BRAIN_IMPROVEMENT_LOOP_ORDER,
  BRAIN_UNATTENDED_LOOP_STAGES,
  startBrainImprovementLoop,
  advanceBrainImprovementLoop,
  isBrainLoopUnattended,
} from "./BrainSelfImprovementLoop";
export type {
  BrainImprovementLoopStage,
  BrainImprovementLoopEvent,
  BrainImprovementLoopTransition,
  BrainImprovementLoopState,
  BrainImprovementLoopResult,
} from "./BrainSelfImprovementLoop";

/* ---- memory model ---- */
export {
  buildBrainMemoryRecord,
  validateBrainMemoryRecord,
  recallBrainMemory,
  summarizeBrainMemory,
} from "./BrainMemoryModel";

/* ---- redaction ---- */
export {
  redactBrainText,
  redactBrainLines,
  containsBrainSecret,
} from "./BrainRedaction";
export type { BrainRedactionHit, BrainRedactionResult } from "./BrainRedaction";

/* ---- worker ---- */
export {
  classifyBrainTaskAutonomy,
  isBrainTaskRunnableUnattended,
  describeBrainTaskAutonomy,
} from "./worker/BrainAutonomyPolicy";
export {
  buildBrainTask,
  enqueueBrainTask,
  validateBrainTaskQueue,
  nextRunnableBrainTask,
  applyBrainTaskResult,
  pendingApprovalBrainTasks,
  approveBrainTask,
} from "./worker/BrainTaskQueue";
export type { BrainNextTaskOptions } from "./worker/BrainTaskQueue";
export {
  buildBrainWorkerCycleReport,
  renderBrainWorkerCycleReport,
} from "./worker/BrainWorkerReport";
export type { BrainWorkerCycleInput } from "./worker/BrainWorkerReport";
export {
  createBrainTaskStore,
  validateBrainTaskForStorage,
  validateBrainTaskResultForStorage,
  brainTaskResultId,
  brainTaskStoreSchemaVersion,
  BrainTaskStoreError,
} from "./worker/BrainTaskStore";
export type {
  BrainTaskStoreHandle,
  BrainTaskStoreOptions,
  BrainTaskStoreErrorCode,
  BrainTaskStorageValidation,
  BrainTaskStorageReasonCode,
  BrainCycleResultsRecord,
} from "./worker/BrainTaskStore";

/* ---- security ---- */
export {
  BRAIN_SHELL_ALLOWLIST,
  BRAIN_WRITABLE_PREFIXES,
  checkBrainShellCommand,
  isBrainPathContained,
  isBrainWritablePath,
  classifyBrainRequest,
} from "./security/BrainSecurityPolicy";
export type { BrainShellCheck } from "./security/BrainSecurityPolicy";
export {
  BRAIN_SECURITY_CATALOG,
  BRAIN_SECURITY_CATALOG_VERSION,
  findBrainSecurityControl,
} from "./security/BrainSecurityCatalog";
export {
  evaluateBrainSecurityPosture,
  describeBrainSecurityPosture,
} from "./security/BrainSecurityAuditModel";

/* ---- orchestrator run-planner ---- */
export { planBrainRun, describeBrainRunPlan } from "./BrainOrchestrator";
export type { BrainRunPhase, BrainRunPlan } from "./BrainOrchestrator";

/* ---- experience store (durable JSON-file persistence) ---- */
export {
  createBrainExperienceStore,
  validateBrainExperienceRecordForStorage,
  brainExperienceRecordId,
  BrainExperienceStoreError,
} from "./store/BrainExperienceStore";
export type {
  BrainExperienceStoreHandle,
  BrainExperienceStoreOptions,
  BrainExperienceListQuery,
  BrainExperienceValidation,
  BrainExperienceValidationReasonCode,
  BrainExperienceStoreErrorCode,
} from "./store/BrainExperienceStore";

/* ---- dry-run plan → experience record ---- */
export { buildBrainDryRunExperienceRecord } from "./BrainDryRunExperience";
export type { BrainDryRunExperienceInput } from "./BrainDryRunExperience";

/* ---- read-only host resource probe (nvidia-smi + os) ---- */
export {
  probeBrainResources,
  parseNvidiaSmiCsv,
  evaluateBrainResourceHardStop,
  BRAIN_A2000_GPU_HARD_STOP_C,
  BRAIN_A2000_PROFILE_ID,
} from "./probe/BrainResourceProbe";
export type {
  BrainResourceProbeOptions,
  NvidiaSmiGpuReading,
  BrainResourceHardStop,
} from "./probe/BrainResourceProbe";

/* ---- read-only ffprobe render adapter ---- */
export {
  probeMediaFile,
  parseFfprobeJson,
  buildBrainFinalRenderReport,
} from "./probe/BrainRenderProbe";
export type {
  FfprobeResult,
  FfprobeMediaSummary,
  FfprobeUnavailable,
  BrainRenderProbeOptions,
  BrainFinalRenderReportInput,
} from "./probe/BrainRenderProbe";

/* ---- experience mode ---- */
export type { BrainExperienceMode } from "@/types/brain";
