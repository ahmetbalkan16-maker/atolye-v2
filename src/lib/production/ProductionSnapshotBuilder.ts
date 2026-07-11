import {
  resolveProjectCompletionConsistency,
} from "./ProductionSnapshotContract";
import {
  buildHistory,
  buildPipeline,
  buildQueue,
  buildStages,
  buildUsage,
  collectFindings,
} from "./ProductionSnapshotParts";
import {
  ProductionSnapshotSourceReader,
  type ProductionSnapshotSourceBundle,
} from "./ProductionSnapshotSourceReader";
import {
  productionSnapshotSchemaVersion,
  type ProductionSnapshot,
  type ProductionSnapshotProject,
  type SnapshotValue,
} from "@/types/productionSnapshot";
import type { ProjectStatus } from "@/types/project";

export class ProductionSnapshotBuilder {
  static async build(
    projectSlug: string,
    generatedAt = new Date().toISOString(),
  ): Promise<ProductionSnapshot> {
    const sources = await ProductionSnapshotSourceReader.read(projectSlug);
    return buildProductionSnapshot(sources, generatedAt);
  }
}

export function buildProductionSnapshot(
  sources: ProductionSnapshotSourceBundle,
  generatedAt: string,
): ProductionSnapshot {
  const history = buildHistory(sources.history);
  const usage = buildUsage(sources.aiUsage);
  const queue = buildQueue(sources.jobs);
  const stages = buildStages(sources, history, generatedAt);
  const pipeline = buildPipeline(stages, queue);
  const findings = collectFindings(sources, stages, queue, generatedAt);

  return {
    schemaVersion: productionSnapshotSchemaVersion,
    generatedAt,
    project: buildProject(sources),
    pipeline,
    stages,
    queue,
    history,
    usage,
    findings,
    sourceState: {
      project: sources.project.state,
      manifest: sources.manifest.state,
      jobs: sources.jobs.state,
      history: sources.history.state,
      aiUsage: sources.aiUsage.state,
      stageOutputs: Object.fromEntries(
        Object.entries(sources.stageOutputs).map(([stage, source]) => [
          stage,
          source.state,
        ]),
      ) as ProductionSnapshot["sourceState"]["stageOutputs"],
    },
  };
}

function buildProject(
  sources: ProductionSnapshotSourceBundle,
): ProductionSnapshotProject {
  const projectStatus = sources.project.data?.status;
  const manifestStatus = sources.manifest.data?.project.status;

  return {
    projectSlug: sources.projectSlug,
    projectStatus: projectStatus
      ? known(projectStatus)
      : unavailable<ProjectStatus>(sources.project.state.status),
    isCompleted: projectStatus
      ? known(projectStatus === "completed")
      : unavailable<boolean>(sources.project.state.status),
    projectUpdatedAt: sources.project.data?.updatedAt
      ? known(sources.project.data.updatedAt)
      : unavailable<string>(sources.project.state.status),
    manifestProjectStatus: manifestStatus
      ? known(manifestStatus)
      : unavailable<ProjectStatus>(sources.manifest.state.status),
    completionConsistency: projectStatus
      ? resolveProjectCompletionConsistency(
          projectStatus,
          manifestStatus ?? "unknown",
        )
      : "manifest_status_unknown",
  };
}

function unavailable<T>(
  status: ProductionSnapshotSourceBundle["project"]["state"]["status"],
): SnapshotValue<T> {
  if (status === "missing") return { state: "source_missing" };
  if (status === "malformed") return { state: "source_malformed" };
  if (status === "unreadable") return { state: "source_unreadable" };
  return { state: "not_recorded" };
}

function known<T>(value: T): SnapshotValue<T> {
  return { state: "known", value };
}
