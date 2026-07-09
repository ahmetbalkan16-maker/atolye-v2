"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  ProjectStageProgress,
  ProjectProgressSummary,
} from "@/lib/projects/projectProgress";
import type { PipelineRetryResult } from "@/types/pipelineRecovery";
import type { PackageStatus, ProductionStepKey } from "@/types/project";
import StudioCard from "./StudioCard";

type PipelineStatusProps = {
  projectSlug: string;
  stages: ProjectStageProgress[];
  completionPercentage: number;
  currentStage: ProductionStepKey | null;
  nextStage: ProductionStepKey | null;
  statusDescription: string;
  nextTaskSuggestion: string;
};

type RetryResponse = {
  success?: boolean;
  blocked?: boolean;
  error?: string;
  result?: PipelineRetryResult;
};

export default function PipelineStatus({
  projectSlug,
  stages,
  completionPercentage,
  currentStage,
  nextStage,
  statusDescription,
  nextTaskSuggestion,
}: PipelineStatusProps) {
  const router = useRouter();
  const [retryingStage, setRetryingStage] = useState<ProductionStepKey | null>(
    null,
  );
  const [retryMessage, setRetryMessage] = useState("");
  const [retryError, setRetryError] = useState("");
  const currentStageLabel = getStageLabel(stages, currentStage, "Tamamlandi");
  const nextStageLabel = getStageLabel(stages, nextStage, "Hazir");
  const completedCount = stages.filter((stage) => stage.completed).length;

  async function retryStage(stageKey: ProductionStepKey) {
    if (retryingStage) {
      return;
    }

    try {
      setRetryingStage(stageKey);
      setRetryMessage("");
      setRetryError("");

      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectSlug)}/pipeline/retry`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            stage: stageKey,
          }),
        },
      );
      const data = (await response.json()) as RetryResponse;

      if (response.status === 409 || data.blocked) {
        setRetryError(
          data.error ||
            data.result?.reason ||
            "Bu asama su anda retry icin hazir degil.",
        );
        return;
      }

      if (!response.ok || !data.success) {
        setRetryError(data.error || "Pipeline retry baslatilamadi.");
        return;
      }

      setRetryMessage("Pipeline retry tamamlandi. Proje verileri yenileniyor.");
      router.refresh();
    } catch (err) {
      console.error("[PipelineStatus] Retry request failed:", err);
      setRetryError("Pipeline retry baslatilamadi. Lutfen tekrar deneyin.");
    } finally {
      setRetryingStage(null);
    }
  }

  return (
    <StudioCard title="Pipeline Status">
      <div className="space-y-5">
        <RetryToast message={retryMessage} error={retryError} />

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
          {stages.map((stage) => {
            const canRetry = isRetryableStatus(stage.status);
            const isRetrying = retryingStage === stage.key;

            return (
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

                {canRetry ? (
                  <button
                    type="button"
                    onClick={() => retryStage(stage.key)}
                    disabled={Boolean(retryingStage)}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/40 px-3 py-2 text-sm font-bold text-red-300 transition hover:border-red-400 hover:text-red-200 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-500"
                  >
                    {isRetrying ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-red-300" />
                    ) : null}
                    {isRetrying ? "Retrying..." : "Retry"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <InfoBox title="Durum" text={statusDescription} />
          <InfoBox title="Siradaki gorev" text={nextTaskSuggestion} />
        </div>
      </div>
    </StudioCard>
  );
}

function RetryToast({ message, error }: { message: string; error: string }) {
  const text = error || message;

  if (!text) {
    return null;
  }

  const className = error
    ? "border-red-500/30 bg-red-950 text-red-200"
    : "border-green-500/30 bg-green-950 text-green-200";

  return (
    <div
      role="status"
      className={`fixed right-4 top-4 z-50 max-w-sm rounded-xl border p-4 text-sm font-medium shadow-2xl shadow-black/30 ${className}`}
    >
      {text}
    </div>
  );
}

export function createPipelineStatusProps(
  progress: {
    projectSlug: string;
    stages: ProjectStageProgress[];
    currentStage: ProductionStepKey | null;
    nextStage: ProductionStepKey | null;
    completionPercentage: number;
  },
  summary: ProjectProgressSummary,
): PipelineStatusProps {
  return {
    projectSlug: progress.projectSlug,
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

function isRetryableStatus(status: PackageStatus) {
  return status === "failed";
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
