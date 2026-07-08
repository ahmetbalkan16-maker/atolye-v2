import type { ProductionStepKey } from "@/types/project";

type ProjectProgressCardProps = {
  currentStage: ProgressStageSummary | null;
  nextStage: ProgressStageSummary | null;
  completionPercentage: number;
  completedStagesCount: number;
  totalStagesCount: number;
  completedCount?: number;
  totalStages?: number;
  statusDescription?: string;
  nextTaskSuggestion?: string;
};

type ProgressStageSummary = {
  key: ProductionStepKey;
  label: string;
};

export default function ProjectProgressCard({
  currentStage,
  nextStage,
  completionPercentage,
  completedStagesCount,
  totalStagesCount,
  completedCount,
  totalStages,
  statusDescription,
  nextTaskSuggestion,
}: ProjectProgressCardProps) {
  const completedValue = completedCount ?? completedStagesCount;
  const totalValue = totalStages ?? totalStagesCount;

  return (
    <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-4">
      <div className="flex items-center justify-between gap-4">
        <StageLabel title="Mevcut aşama" stage={currentStage} fallback="Tamamlandı" />
        <ProgressBadge value={completionPercentage} />
      </div>

      <ProgressBar value={completionPercentage} />

      {statusDescription ? (
        <p className="mt-2 text-sm font-medium text-gray-800">
          {statusDescription}
        </p>
      ) : null}

      <div className="mt-3 grid gap-2 text-sm text-gray-700 sm:grid-cols-2">
        <StageLabel title="Sonraki aşama" stage={nextStage} fallback="Hazır" />
        <div>
          <p className="text-xs font-semibold uppercase text-gray-500">
            Tamamlanan
          </p>
          <p className="font-medium text-gray-900">
            {completedValue}/{totalValue} aşama
          </p>
        </div>
      </div>

      {nextTaskSuggestion ? (
        <div className="mt-3 border-t border-gray-200 pt-3 text-sm">
          <p className="text-xs font-semibold uppercase text-gray-500">
            Sıradaki görev
          </p>
          <p className="mt-1 font-medium text-gray-900">
            {nextTaskSuggestion}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ProgressBadge({ value }: { value: number }) {
  return (
    <span className="rounded-full bg-yellow-100 px-3 py-1 text-sm font-semibold text-yellow-800">
      %{value}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200">
      <div
        className="h-full rounded-full bg-yellow-500"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function StageLabel({
  title,
  stage,
  fallback,
}: {
  title: string;
  stage: ProgressStageSummary | null;
  fallback: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-gray-500">{title}</p>
      <p className="font-medium text-gray-900">{stage?.label ?? fallback}</p>
    </div>
  );
}
