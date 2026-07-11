import type { ProductionHealthRule } from "@/types/productionHealth";
import type {
  ProductionSnapshotSourceName,
  ProductionSnapshotSourceState,
} from "@/types/productionSnapshot";
import { createHealthFinding, createRule } from "./ProductionHealthRules";

export const productionHealthCoreRules: readonly ProductionHealthRule[] = [
  createRule("source-integrity", "source", "Evaluates snapshot source availability and integrity.", (snapshot, context) => {
    const findings = [];
    for (const [source, state] of topLevelSources(snapshot.sourceState)) {
      if (state.status === "available" || state.status === "stale") continue;
      const code = state.status === "malformed" ? "source_malformed" : state.status === "unreadable" ? "source_unreadable" : state.status === "missing" ? "source_missing" : state.status === "partial" ? "source_partial" : undefined;
      if (!code) continue;
      const required = source === "project" || source === "manifest";
      findings.push(createHealthFinding({
        code,
        severity: required && state.status !== "missing" && state.status !== "partial" ? "critical" : "warning",
        category: "source",
        scope: "source",
        sources: [source],
        message: `Snapshot source ${source} is ${state.status}.`,
        detectedAt: context.evaluatedAt,
      }));
    }
    return findings;
  }),
  createRule("completion-consistency", "completion", "Evaluates project, export and active-work completion consistency.", (snapshot, context) => {
    const findings = [];
    const projectCompleted = snapshot.project.isCompleted.state === "known" && snapshot.project.isCompleted.value;
    const exportStage = snapshot.stages.find((stage) => stage.stage === "export");
    const allCompleted = snapshot.stages.length > 0 && snapshot.stages.every((stage) => stage.effectiveStatus === "completed");
    if (projectCompleted && exportStage?.effectiveStatus !== "completed") findings.push(createHealthFinding({ code: "project_completed_export_not_completed", severity: "critical", category: "completion", scope: "project", sources: ["project", "manifest", "stageOutputs"], message: "Project is completed but export is not completed.", detectedAt: context.evaluatedAt }));
    if (!projectCompleted && exportStage?.effectiveStatus === "completed") findings.push(createHealthFinding({ code: "export_completed_project_not_completed", severity: "critical", category: "completion", scope: "project", sources: ["project", "manifest", "stageOutputs"], message: "Export is completed but project is not completed.", detectedAt: context.evaluatedAt }));
    if (!projectCompleted && allCompleted) findings.push(createHealthFinding({ code: "all_stages_completed_project_not_completed", severity: "critical", category: "completion", scope: "pipeline", sources: ["project", "manifest", "stageOutputs"], message: "All stages are completed but project is not completed.", detectedAt: context.evaluatedAt }));
    if (projectCompleted && snapshot.stages.some((stage) => stage.effectiveStatus !== "completed")) findings.push(createHealthFinding({ code: "project_completed_incomplete_stage", severity: "critical", category: "completion", scope: "pipeline", sources: ["project", "manifest", "jobs"], message: "Completed project contains an incomplete stage.", detectedAt: context.evaluatedAt }));
    if (projectCompleted && snapshot.pipeline.hasActiveWork) findings.push(createHealthFinding({ code: "completed_project_with_active_jobs", severity: "critical", category: "completion", scope: "pipeline", sources: ["project", "jobs"], message: "Completed project has active jobs.", evidence: { running: snapshot.pipeline.runningStageCount, queued: snapshot.pipeline.queuedStageCount }, detectedAt: context.evaluatedAt }));
    if (snapshot.pipeline.isTerminal && snapshot.pipeline.hasActiveWork) findings.push(createHealthFinding({ code: "terminal_pipeline_with_active_work", severity: "critical", category: "completion", scope: "pipeline", sources: ["manifest", "jobs"], message: "Terminal pipeline reports active work.", detectedAt: context.evaluatedAt }));
    return findings;
  }),
  createRule("stage-state", "stage", "Evaluates failed, cancelled and dependency-blocked stages.", (snapshot, context) => {
    const findings = [];
    for (const stage of snapshot.stages) {
      if (stage.effectiveStatus === "failed") findings.push(createHealthFinding({ code: "failed_stage", severity: "warning", category: "stage", scope: "stage", stage: stage.stage, sources: ["manifest", "jobs"], message: "Stage is failed.", detectedAt: context.evaluatedAt }));
      if (stage.effectiveStatus === "cancelled") findings.push(createHealthFinding({ code: "cancelled_stage", severity: "warning", category: "stage", scope: "stage", stage: stage.stage, sources: ["jobs"], message: "Stage is cancelled.", detectedAt: context.evaluatedAt }));
      if (stage.dependencyReady.state === "known" && !stage.dependencyReady.value && (stage.effectiveStatus === "queued" || stage.effectiveStatus === "running")) findings.push(createHealthFinding({ code: "dependency_not_ready_active_stage", severity: "warning", category: "stage", scope: "stage", stage: stage.stage, sources: ["manifest", "jobs", "stageOutputs"], message: "Stage is active while a dependency is not ready.", detectedAt: context.evaluatedAt }));
    }
    return findings;
  }),
  createRule("queue-consistency", "queue", "Evaluates queue conflicts and blocked candidates.", (snapshot, context) => {
    const findings = [];
    if (snapshot.queue.multipleRunningDetected || snapshot.queue.hasConflict) findings.push(createHealthFinding({ code: "multiple_running_jobs", severity: "critical", category: "queue", scope: "queue", sources: ["jobs"], message: "Multiple running jobs were detected.", evidence: { runningCount: snapshot.queue.running.length }, detectedAt: context.evaluatedAt }));
    if (snapshot.queue.blockedReason.state === "known" && snapshot.queue.queued.length > 0) findings.push(createHealthFinding({ code: "queue_prerequisite_blocked", severity: "warning", category: "queue", scope: "queue", sources: ["jobs"], message: "Queued work is blocked by an earlier terminal stage.", evidence: { blockedReason: snapshot.queue.blockedReason.value }, detectedAt: context.evaluatedAt }));
    if (snapshot.queue.nextCandidate.state === "known" && snapshot.pipeline.blockedStage.state === "known") findings.push(createHealthFinding({ code: "next_candidate_blocked_conflict", severity: "warning", category: "queue", scope: "queue", sources: ["jobs"], message: "Queue exposes both a next candidate and a blocked stage.", detectedAt: context.evaluatedAt }));
    if (snapshot.pipeline.runningStageCount !== snapshot.queue.running.length || snapshot.pipeline.queuedStageCount !== snapshot.queue.queued.length) findings.push(createHealthFinding({ code: "queue_summary_mismatch", severity: "warning", category: "queue", scope: "queue", sources: ["jobs"], message: "Pipeline and queue active counts disagree.", detectedAt: context.evaluatedAt }));
    return findings;
  }),
];

function topLevelSources(sourceState: Parameters<ProductionHealthRule["evaluate"]>[0]["sourceState"]): Array<[ProductionSnapshotSourceName, ProductionSnapshotSourceState]> {
  return [
    ["project", sourceState.project],
    ["manifest", sourceState.manifest],
    ["jobs", sourceState.jobs],
    ["history", sourceState.history],
    ["aiUsage", sourceState.aiUsage],
  ];
}
