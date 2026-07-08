import type {
  ProjectStageProgress,
  ProjectProgressSummary,
} from "@/lib/projects/projectProgress";
import type { PackageStatus, ProductionStepKey } from "@/types/project";
import StudioCard from "./StudioCard";

type PipelineStatusProps = {
  stages: ProjectStageProgress[];
  completionPercentage: number;
  currentStage: ProductionStepKey | null;
  nextStage: ProductionStepKey | null;
  statusDescription: string;
  nextTaskSuggestion: string;
};

export default function PipelineStatus({
  stages,
  completionPercentage,
  currentStage,
  nextStage,
  statusDescription,
  nextTaskSuggestion,
}: PipelineStatusProps) {
  const currentStageLabel = getStageLabel(stages, currentStage, "Tamamlandi");
  const nextStageLabel = getStageLabel(stages, nextStage, "Hazir");
  const completedCount = stages.filter((stage) => stage.completed).length;

  return (
    <StudioCard title="Pipeline Status">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <SummaryItem label="Mevcut asama" value={currentStageLabel} />
          <SummaryItem label="Sonraki asama" value={nextStageLabel} />
          <SummaryItem
            label="Tamamlanan"
            value={`${completedCount}/${stages.length} asama`}
          />
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="font-medium text-zinc-300">Pipeline ilerlemesi</span>
            <span className="font-semibold text-yellow-400">
              %{completionPercentage}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-yellow-400 transition-all"
              style={{ width: `${completionPercentage}%` }}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stages.map((stage) => (
            <div
              key={stage.key}
              className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-white">{stage.label}</h3>
                <StatusBadge status={stage.status} />
              </div>

              <p className="mt-3 text-xs text-zinc-500">
                Dosya: {stage.fileName}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Son guncelleme:{" "}
                {stage.updatedAt
                  ? new Date(stage.updatedAt).toLocaleString("tr-TR")
                  : "Belirtilmedi"}
              </p>

              {stage.error ? (
                <p className="mt-3 rounded-lg border border-red-500/30 bg-red-950/30 p-2 text-xs text-red-300">
                  {stage.error}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <InfoBox title="Durum" text={statusDescription} />
          <InfoBox title="Siradaki gorev" text={nextTaskSuggestion} />
        </div>
      </div>
    </StudioCard>
  );
}

export function createPipelineStatusProps(
  progress: {
    stages: ProjectStageProgress[];
    currentStage: ProductionStepKey | null;
    nextStage: ProductionStepKey | null;
    completionPercentage: number;
  },
  summary: ProjectProgressSummary,
): PipelineStatusProps {
  return {
    stages: progress.stages,
    completionPercentage: summary.completionPercentage,
    currentStage: summary.currentStage,
    nextStage: summary.nextStage,
    statusDescription: summary.statusDescription,
    nextTaskSuggestion: summary.nextTaskSuggestion,
  };
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-2 font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: PackageStatus }) {
  const className = getStatusClassName(status);

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${className}`}>
      {getStatusLabel(status)}
    </span>
  );
}

function InfoBox({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </p>
      <p className="mt-2 text-sm font-medium text-zinc-200">{text}</p>
    </div>
  );
}

function getStageLabel(
  stages: ProjectStageProgress[],
  key: ProductionStepKey | null,
  fallback: string,
) {
  if (!key) {
    return fallback;
  }

  return stages.find((stage) => stage.key === key)?.label ?? fallback;
}

function getStatusLabel(status: PackageStatus) {
  const labels: Record<PackageStatus, string> = {
    completed: "Tamamlandi",
    running: "Calisiyor",
    failed: "Hatali",
    pending: "Bekliyor",
    missing: "Eksik",
  };

  return labels[status];
}

function getStatusClassName(status: PackageStatus) {
  const classNames: Record<PackageStatus, string> = {
    completed: "bg-green-500/10 text-green-400",
    running: "bg-blue-500/10 text-blue-400",
    failed: "bg-red-500/10 text-red-400",
    pending: "bg-yellow-500/10 text-yellow-400",
    missing: "bg-zinc-800 text-zinc-400",
  };

  return classNames[status];
}
