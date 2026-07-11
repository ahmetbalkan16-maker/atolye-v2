import {
  calculateCoverage,
  resolveEffectiveStageStatus,
} from "./ProductionSnapshotContract";
import {
  pipelineRecoveryStageOrder,
  pipelineStageDependencies,
} from "@/lib/pipeline/PipelineRecoveryPlanner";
import type { AIUsageLog, AIUsageRecord } from "@/types/aiUsage";
import type {
  PipelineJob,
  PipelineJobHistory,
  PipelineJobHistoryEvent,
  PipelineJobList,
} from "@/types/pipelineJob";
import type { ProductionStepKey } from "@/types/project";
import type {
  EffectiveStageStatus,
  ProductionSnapshotConsistencyFinding,
  ProductionSnapshotFindingCode,
  ProductionSnapshotFindingScope,
  ProductionSnapshotFindingSeverity,
  ProductionSnapshotHistory,
  ProductionSnapshotPipeline,
  ProductionSnapshotQueue,
  ProductionSnapshotSourceName,
  ProductionSnapshotStage,
  ProductionSnapshotStageHistorySummary,
  ProductionSnapshotUsage,
  SnapshotValue,
} from "@/types/productionSnapshot";
import type {
  ProductionSnapshotSource,
  ProductionSnapshotSourceBundle,
} from "./ProductionSnapshotSourceReader";

export function buildHistory(
  source: ProductionSnapshotSource<PipelineJobHistory>,
): ProductionSnapshotHistory {
  const events = source.data?.events ?? [];
  const completed = events.filter((event) => event.status === "completed");
  const completedDurations = completed
    .map(getHistoryDuration)
    .filter((value): value is number => value !== undefined);
  const latest = sortNewest(events, (event) => event.recordedAt, (event) => event.id)[0];

  return {
    totalTerminalEvents: events.length,
    completedEvents: completed.length,
    failedEvents: events.filter((event) => event.status === "failed").length,
    cancelledEvents: events.filter((event) => event.status === "cancelled").length,
    latestEventAt: latest
      ? known(latest.recordedAt)
      : unavailableForSource(source, "not_recorded"),
    averageCompletedDurationMs:
      completedDurations.length === 0
        ? unavailableForSource(source, "not_recorded")
        : known(
            completedDurations.reduce((total, value) => total + value, 0) /
              completedDurations.length,
          ),
    successRate:
      events.length === 0
        ? unavailableForSource(source, "not_recorded")
        : known(completed.length / events.length),
    perStageSummary: Object.fromEntries(
      pipelineRecoveryStageOrder.map((stage) => [
        stage,
        buildStageHistory(stage, events.filter((event) => event.stage === stage)),
      ]),
    ) as Record<ProductionStepKey, ProductionSnapshotStageHistorySummary>,
  };
}

export function buildUsage(
  source: ProductionSnapshotSource<AIUsageLog>,
): ProductionSnapshotUsage {
  const records = source.data?.records ?? [];
  const newest = sortNewest(records, (record) => record.createdAt, (record) => record.id)[0];
  const inputCoverage = calculateCoverage(records.map((record) => record.promptTokens));
  const outputCoverage = calculateCoverage(records.map((record) => record.completionTokens));
  const totalCoverage = calculateCoverage(records.map((record) => record.totalTokens));
  const costCoverage = calculateCoverage(records.map((record) => record.estimatedCost));

  return {
    totalRequests: records.length,
    successfulRequests: records.filter((record) => record.status === "success").length,
    fallbackRequests: records.filter(
      (record) => record.status === "fallback" || record.fallbackUsed,
    ).length,
    failedRequests: records.filter((record) => record.status === "failed").length,
    totalDurationMs: records.reduce((total, record) => total + record.durationMs, 0),
    providerDistribution: createDistribution(records, (record) => record.provider),
    modelDistribution: createDistribution(records, (record) => record.model),
    availableInputTokens: inputCoverage,
    availableOutputTokens: outputCoverage,
    availableTotalTokens: totalCoverage,
    availableEstimatedCost: costCoverage,
    tokenCoverage: minimumCoverage(inputCoverage.coverage, outputCoverage.coverage, totalCoverage.coverage),
    costCoverage: costCoverage.coverage,
    latestUsageAt: newest
      ? known(newest.createdAt)
      : unavailableForSource(source, "not_recorded"),
    latestStatus: newest
      ? known(newest.status)
      : unavailableForSource(source, "not_recorded"),
  };
}

export function buildQueue(
  source: ProductionSnapshotSource<PipelineJobList>,
): ProductionSnapshotQueue {
  if (!source.data) {
    return {
      derivedFrom: "jobs",
      queued: [],
      running: [],
      failed: [],
      cancelled: [],
      nextCandidate: unavailableForSource(source, "not_recorded"),
      blockedReason: unavailableForSource(source, "not_recorded"),
      hasConflict: false,
      multipleRunningDetected: false,
    };
  }

  const latestJobs = pipelineRecoveryStageOrder
    .map((stage) => selectLatestJob(source.data?.jobs ?? [], stage))
    .filter((job): job is PipelineJob => Boolean(job));
  const byStatus = (status: PipelineJob["status"]) =>
    latestJobs.filter((job) => job.status === status).map((job) => job.stage);
  const running = byStatus("running");
  let nextCandidate: SnapshotValue<ProductionStepKey> = { state: "not_recorded" };
  let blockedReason: SnapshotValue<string> = { state: "not_recorded" };

  if (running.length > 0) {
    blockedReason = known(`Stage "${running[0]}" is already running.`);
  } else {
    for (const stage of pipelineRecoveryStageOrder) {
      const job = latestJobs.find((item) => item.stage === stage);
      if (!job) continue;
      if (job.status === "failed" || job.status === "cancelled") {
        blockedReason = known(`Stage "${stage}" is ${job.status}.`);
        break;
      }
      if (job.status === "queued") {
        nextCandidate = known(stage);
        break;
      }
    }
  }

  return {
    derivedFrom: "jobs",
    queued: byStatus("queued"),
    running,
    failed: byStatus("failed"),
    cancelled: byStatus("cancelled"),
    nextCandidate,
    blockedReason,
    hasConflict: running.length > 1,
    multipleRunningDetected: running.length > 1,
  };
}

export function buildStages(
  bundle: ProductionSnapshotSourceBundle,
  history: ProductionSnapshotHistory,
  generatedAt: string,
): ProductionSnapshotStage[] {
  return pipelineRecoveryStageOrder.map((stage) => {
    const manifestPackage = bundle.manifest.data?.packages[stage];
    const latestJob = selectLatestJob(bundle.jobs.data?.jobs ?? [], stage);
    const outputSource = bundle.stageOutputs[stage];
    const outputReady = outputSource.state.status === "available";
    const manifestStatus = manifestPackage?.status ?? "unknown";
    const jobStatus = latestJob?.status ?? "unknown";
    const consistency: ProductionSnapshotConsistencyFinding[] = [];

    if (
      manifestPackage &&
      latestJob &&
      !statusesCompatible(manifestPackage.status, latestJob.status)
    ) {
      consistency.push(
        finding(
          "manifest_job_status_mismatch",
          "warning",
          "stage",
          ["manifest", "jobs"],
          "Manifest and latest job status disagree.",
          generatedAt,
          stage,
          { manifestStatus: manifestPackage.status, jobStatus: latestJob.status },
        ),
      );
    }

    if (manifestPackage?.status === "completed" && !outputReady) {
      consistency.push(
        finding(
          "completed_stage_missing_output",
          "critical",
          "stage",
          ["manifest", "stageOutputs"],
          "Completed stage output is not ready.",
          generatedAt,
          stage,
          { outputState: outputSource.state.status },
        ),
      );
    }

    return {
      stage,
      manifestStatus: manifestPackage
        ? known(manifestPackage.status)
        : unavailableForSource(bundle.manifest, "not_recorded"),
      jobStatus: latestJob
        ? known(latestJob.status)
        : unavailableForSource(bundle.jobs, "not_recorded"),
      effectiveStatus: resolveEffectiveStageStatus({
        manifestStatus,
        jobStatus,
        outputReady:
          outputSource.state.status === "available"
            ? true
            : outputSource.state.status === "missing"
              ? false
              : "unknown",
      }),
      startedAt: manifestPackage?.startedAt
        ? known(manifestPackage.startedAt)
        : latestJob?.startedAt
          ? known(latestJob.startedAt)
          : notRecorded(),
      completedAt: manifestPackage?.completedAt
        ? known(manifestPackage.completedAt)
        : latestJob?.completedAt
          ? known(latestJob.completedAt)
          : notRecorded(),
      durationMs:
        typeof manifestPackage?.durationMs === "number"
          ? known(manifestPackage.durationMs)
          : notRecorded(),
      attempts:
        typeof manifestPackage?.attempts?.total === "number"
          ? known(manifestPackage.attempts.total)
          : unavailableForSource(bundle.manifest, "not_recorded"),
      retries:
        typeof manifestPackage?.attempts?.retry === "number"
          ? known(manifestPackage.attempts.retry)
          : unavailableForSource(bundle.manifest, "not_recorded"),
      lastRunType: manifestPackage?.attempts?.lastRunType
        ? known(manifestPackage.attempts.lastRunType)
        : unavailableForSource(bundle.manifest, "not_recorded"),
      dependencyReady: dependencyReadiness(bundle, stage),
      outputReady: outputReadiness(outputSource),
      latestJobId: latestJob ? known(latestJob.id) : unavailableForSource(bundle.jobs, "not_recorded"),
      latestError: manifestPackage?.error
        ? known(manifestPackage.error)
        : latestJob?.error
          ? known(latestJob.error)
          : notRecorded(),
      latestUsage: manifestPackage?.usage
        ? known(manifestPackage.usage)
        : unavailableForSource(bundle.manifest, "not_recorded"),
      consistency,
    };
  });
}

export function buildPipeline(
  stages: ProductionSnapshotStage[],
  queue: ProductionSnapshotQueue,
): ProductionSnapshotPipeline {
  const count = (status: EffectiveStageStatus) =>
    stages.filter((stage) => stage.effectiveStatus === status).length;
  const completed = count("completed");
  const running = count("running");
  const failed = count("failed");
  const cancelled = count("cancelled");
  const queued = count("queued");
  const inconsistent = count("inconsistent");
  const unknown = count("unknown");
  const effectiveStatus: EffectiveStageStatus =
    running > 0
      ? "running"
      : failed > 0
        ? "failed"
        : cancelled > 0
          ? "cancelled"
          : inconsistent > 0
            ? "inconsistent"
            : queued > 0
              ? "queued"
              : completed === stages.length
                ? "completed"
                : unknown > 0
                  ? "unknown"
                  : "pending";

  return {
    effectiveStatus,
    completedStageCount: completed,
    totalStageCount: stages.length,
    failedStageCount: failed,
    cancelledStageCount: cancelled,
    queuedStageCount: queued,
    runningStageCount: running,
    nextRunnableStage: queue.nextCandidate,
    blockedStage: queue.blockedReason.state === "known"
      ? stageFromBlockedReason(queue.blockedReason.value)
      : notRecorded(),
    isTerminal: completed === stages.length && running === 0 && queued === 0,
    hasActiveWork: running > 0 || queued > 0,
  };
}

export function collectFindings(
  bundle: ProductionSnapshotSourceBundle,
  stages: ProductionSnapshotStage[],
  queue: ProductionSnapshotQueue,
  generatedAt: string,
): ProductionSnapshotConsistencyFinding[] {
  const findings = stages.flatMap((stage) => stage.consistency);
  const projectStatus = bundle.project.data?.status;
  const manifestProjectStatus = bundle.manifest.data?.project.status;
  const exportStage = stages.find((stage) => stage.stage === "export");

  for (const [name, source] of sourceEntries(bundle)) {
    if (source.state.status === "missing" || source.state.status === "malformed" || source.state.status === "unreadable") {
      findings.push(sourceFinding(name, source.state.status, generatedAt));
    }
  }

  if (projectStatus && manifestProjectStatus && projectStatus !== manifestProjectStatus) {
    findings.push(finding("project_manifest_status_mismatch", "warning", "project", ["project", "manifest"], "Project and embedded manifest project status disagree.", generatedAt, undefined, { projectStatus, manifestProjectStatus }));
  }
  if (queue.multipleRunningDetected) {
    findings.push(finding("multiple_running_jobs", "critical", "queue", ["jobs"], "Multiple running jobs were detected.", generatedAt, undefined, { runningCount: queue.running.length }));
  }
  if (projectStatus === "completed" && (queue.running.length > 0 || queue.queued.length > 0)) {
    findings.push(finding("completed_project_with_active_jobs", "critical", "pipeline", ["project", "jobs"], "Completed project still has active jobs.", generatedAt, undefined, { activeJobs: queue.running.length + queue.queued.length }));
  }
  if (exportStage?.effectiveStatus === "completed" && projectStatus && projectStatus !== "completed") {
    findings.push(finding("export_completed_project_not_completed", "critical", "project", ["project", "manifest", "stageOutputs"], "Export is completed but project is not completed.", generatedAt));
  }
  if (projectStatus === "completed" && exportStage?.effectiveStatus !== "completed") {
    findings.push(finding("project_completed_export_not_completed", "critical", "project", ["project", "manifest", "stageOutputs"], "Project is completed but export is not completed.", generatedAt));
  }
  const usageRecords = bundle.aiUsage.data?.records ?? [];
  if (usageRecords.length > 0 && usageRecords.some((record) => record.totalTokens === undefined || record.estimatedCost === undefined)) {
    findings.push(finding("usage_data_partial", "info", "usage", ["aiUsage"], "AI usage token or cost data is partial.", generatedAt, undefined, { records: usageRecords.length }));
  }

  return sortAndDedupeFindings(findings);
}

export function selectLatestJob(
  jobs: readonly PipelineJob[],
  stage: ProductionStepKey,
): PipelineJob | undefined {
  return [...jobs]
    .filter((job) => job.stage === stage)
    .sort((left, right) =>
      compareDescending(left.updatedAt, right.updatedAt) ||
      compareDescending(left.startedAt ?? "", right.startedAt ?? "") ||
      compareDescending(left.createdAt, right.createdAt) ||
      compareAscending(left.id, right.id),
    )[0];
}

function buildStageHistory(stage: ProductionStepKey, events: PipelineJobHistoryEvent[]): ProductionSnapshotStageHistorySummary {
  const latest = sortNewest(events, (event) => event.recordedAt, (event) => event.id)[0];
  return {
    stage,
    completedEvents: events.filter((event) => event.status === "completed").length,
    failedEvents: events.filter((event) => event.status === "failed").length,
    cancelledEvents: events.filter((event) => event.status === "cancelled").length,
    latestStatus: latest ? known(latest.status) : notRecorded(),
    latestEventAt: latest ? known(latest.recordedAt) : notRecorded(),
  };
}

function getHistoryDuration(event: PipelineJobHistoryEvent) {
  if (!event.startedAt || !event.completedAt) return undefined;
  const duration = Date.parse(event.completedAt) - Date.parse(event.startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function createDistribution(records: AIUsageRecord[], select: (record: AIUsageRecord) => string | undefined) {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = select(record);
    if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || compareAscending(left.name, right.name));
}

function minimumCoverage(...values: number[]) {
  return values.length === 0 ? 0 : Math.min(...values);
}

function dependencyReadiness(
  bundle: ProductionSnapshotSourceBundle,
  stage: ProductionStepKey,
): SnapshotValue<boolean> {
  const manifest = bundle.manifest.data;
  if (!manifest) return unavailableForSource(bundle.manifest, "not_recorded");
  return known(
    pipelineStageDependencies[stage].every(
      (dependency) =>
        manifest.packages[dependency].status === "completed" &&
        bundle.stageOutputs[dependency].state.status === "available",
    ),
  );
}

function outputReadiness(source: ProductionSnapshotSource<unknown>): SnapshotValue<boolean> {
  if (source.state.status === "available") return known(true);
  if (source.state.status === "missing") return known(false);
  return unavailableForSource(source, "not_recorded");
}

function statusesCompatible(manifestStatus: string, jobStatus: string) {
  if (jobStatus === "cancelled") return false;
  return manifestStatus === jobStatus || (manifestStatus === "pending" && jobStatus === "queued");
}

function stageFromBlockedReason(reason: string): SnapshotValue<ProductionStepKey> {
  const match = reason.match(/^Stage "([^"]+)"/);
  const stage = match?.[1] as ProductionStepKey | undefined;
  return stage && pipelineRecoveryStageOrder.includes(stage) ? known(stage) : notRecorded();
}

function sourceEntries(bundle: ProductionSnapshotSourceBundle): Array<[ProductionSnapshotSourceName, ProductionSnapshotSource<unknown>]> {
  return [
    ["project", bundle.project],
    ["manifest", bundle.manifest],
    ["jobs", bundle.jobs],
    ["history", bundle.history],
    ["aiUsage", bundle.aiUsage],
    ...pipelineRecoveryStageOrder.map(
      (stage) =>
        ["stageOutputs", bundle.stageOutputs[stage]] as [
          ProductionSnapshotSourceName,
          ProductionSnapshotSource<unknown>,
        ],
    ),
  ];
}

function sourceFinding(name: ProductionSnapshotSourceName, status: "missing" | "malformed" | "unreadable", generatedAt: string) {
  const code = `source_${status}` as ProductionSnapshotFindingCode;
  return finding(code, status === "missing" ? "warning" : "critical", "source", [name], `Snapshot source is ${status}.`, generatedAt);
}

function finding(
  code: ProductionSnapshotFindingCode,
  severity: ProductionSnapshotFindingSeverity,
  scope: ProductionSnapshotFindingScope,
  sources: ProductionSnapshotSourceName[],
  message: string,
  detectedAt: string,
  stage?: ProductionStepKey,
  evidence: ProductionSnapshotConsistencyFinding["evidence"] = {},
): ProductionSnapshotConsistencyFinding {
  return { code, severity, scope, ...(stage ? { stage } : {}), sources, message, evidence, detectedAt };
}

function sortAndDedupeFindings(findings: ProductionSnapshotConsistencyFinding[]) {
  const unique = new Map<string, ProductionSnapshotConsistencyFinding>();
  for (const item of findings) {
    const key = `${item.code}|${item.stage ?? ""}|${item.sources.join(",")}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  const severityOrder = { critical: 0, warning: 1, info: 2 } as const;
  const scopeOrder = { project: 0, pipeline: 1, stage: 2, queue: 3, history: 4, usage: 5, source: 6 } as const;
  return [...unique.values()].sort((left, right) =>
    severityOrder[left.severity] - severityOrder[right.severity] ||
    scopeOrder[left.scope] - scopeOrder[right.scope] ||
    stageIndex(left.stage) - stageIndex(right.stage) ||
    compareAscending(left.code, right.code),
  );
}

function stageIndex(stage?: ProductionStepKey) {
  return stage ? pipelineRecoveryStageOrder.indexOf(stage) : -1;
}

function unavailableForSource<T>(source: ProductionSnapshotSource<unknown>, fallback: "not_recorded"): SnapshotValue<T> {
  if (source.state.status === "missing") return { state: "source_missing" };
  if (source.state.status === "malformed") return { state: "source_malformed" };
  if (source.state.status === "unreadable") return { state: "source_unreadable" };
  return { state: fallback };
}

function known<T>(value: T): SnapshotValue<T> {
  return { state: "known", value };
}

function notRecorded<T>(): SnapshotValue<T> {
  return { state: "not_recorded" };
}

function sortNewest<T>(values: readonly T[], time: (value: T) => string, id: (value: T) => string) {
  return [...values].sort((left, right) => compareDescending(time(left), time(right)) || compareAscending(id(left), id(right)));
}

function compareDescending(left: string, right: string) {
  return left === right ? 0 : left > right ? -1 : 1;
}

function compareAscending(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1;
}
