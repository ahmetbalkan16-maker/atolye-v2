import { pipelineRecoveryStageOrder } from "@/lib/pipeline/PipelineRecoveryPlanner";
import type { PipelineJobStatus } from "@/types/pipelineJob";
import type { PackageStatus, ProjectStatus } from "@/types/project";
import type {
  EffectiveStageStatus,
  ProductionSnapshotCoverageMetric,
  ProductionSnapshotSourceState,
  ProductionSnapshotSourceStatus,
  ProjectCompletionConsistency,
} from "@/types/productionSnapshot";

export type EffectiveStageStatusInput = {
  manifestStatus: PackageStatus | "unknown";
  jobStatus: PipelineJobStatus | "unknown";
  outputReady: boolean | "unknown";
};

export function resolveEffectiveStageStatus({
  manifestStatus,
  jobStatus,
  outputReady,
}: EffectiveStageStatusInput): EffectiveStageStatus {
  if (jobStatus === "cancelled") {
    return "cancelled";
  }

  if (
    (jobStatus === "running" && manifestStatus === "completed") ||
    (jobStatus === "completed" && manifestStatus !== "completed")
  ) {
    return "inconsistent";
  }

  if (manifestStatus === "completed") {
    return outputReady === true ? "completed" : "inconsistent";
  }

  if (jobStatus === "running" || jobStatus === "queued" || jobStatus === "failed") {
    return jobStatus;
  }

  if (manifestStatus === "running" || manifestStatus === "failed") {
    return manifestStatus;
  }

  if (manifestStatus === "pending" || manifestStatus === "missing") {
    return manifestStatus;
  }

  return "unknown";
}

export function resolveProjectCompletionConsistency(
  projectStatus: ProjectStatus,
  manifestProjectStatus: ProjectStatus | "unknown",
): ProjectCompletionConsistency {
  if (manifestProjectStatus === "unknown") {
    return "manifest_status_unknown";
  }

  const projectCompleted = projectStatus === "completed";
  const manifestCompleted = manifestProjectStatus === "completed";

  if (projectCompleted && manifestCompleted) {
    return "consistent_completed";
  }

  if (!projectCompleted && !manifestCompleted) {
    return "consistent_incomplete";
  }

  return projectCompleted
    ? "project_completed_manifest_not_completed"
    : "project_incomplete_manifest_completed";
}

export function calculateCoverage(
  values: readonly (number | undefined)[],
): ProductionSnapshotCoverageMetric {
  const recordedValues = values.filter(
    (value): value is number => typeof value === "number",
  );
  const totalRecords = values.length;
  const recordedRecords = recordedValues.length;

  return {
    value:
      recordedRecords === 0
        ? { state: "not_recorded" }
        : {
            state: "known",
            value: recordedValues.reduce((total, value) => total + value, 0),
          },
    recordedRecords,
    totalRecords,
    coverage: totalRecords === 0 ? 0 : recordedRecords / totalRecords,
  };
}

export function createSourceState(
  status: ProductionSnapshotSourceStatus,
  options: { updatedAt?: string; detail?: string } = {},
): ProductionSnapshotSourceState {
  return {
    status,
    ...(options.updatedAt === undefined
      ? {}
      : { updatedAt: options.updatedAt }),
    ...(options.detail === undefined ? {} : { detail: options.detail }),
  };
}

export function createCanonicalStageOrder() {
  return [...pipelineRecoveryStageOrder];
}
