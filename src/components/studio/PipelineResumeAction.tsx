"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProjectProgress } from "@/lib/projects/projectProgress";
import type { PipelineResumeResult } from "@/types/pipelineRecovery";
import StudioCard from "./StudioCard";

type PipelineResumeActionProps = {
  projectSlug: string;
  pipelineProgress: ProjectProgress;
};

type ResumeResponse = {
  success?: boolean;
  blocked?: boolean;
  error?: string;
  result?: PipelineResumeResult;
};

export default function PipelineResumeAction({
  projectSlug,
  pipelineProgress,
}: PipelineResumeActionProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [blockedReason, setBlockedReason] = useState("");

  const productionCompleted =
    pipelineProgress.completionPercentage >= 100 ||
    pipelineProgress.stages.every((stage) => stage.completed);
  const hasRunningStage = pipelineProgress.stages.some(
    (stage) => stage.status === "running",
  );

  if (productionCompleted) {
    return null;
  }

  async function resumePipeline() {
    if (loading || hasRunningStage) {
      return;
    }

    try {
      setLoading(true);
      setMessage("");
      setError("");
      setBlockedReason("");

      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectSlug)}/pipeline/resume`,
        {
          method: "POST",
        },
      );
      const data = (await response.json()) as ResumeResponse;

      if (response.status === 409 || data.blocked) {
        setBlockedReason(
          data.error ||
            data.result?.reason ||
            "Pipeline resume icin gerekli kosullar hazir degil.",
        );
        return;
      }

      if (!response.ok || !data.success) {
        setError(data.error || "Pipeline resume baslatilamadi.");
        return;
      }

      setMessage("Pipeline resume tamamlandi. Proje verileri yenileniyor.");
      router.refresh();
    } catch (err) {
      console.error("[PipelineResumeAction] Resume request failed:", err);
      setError("Pipeline resume baslatilamadi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <StudioCard title="Pipeline Resume">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-400">
            Mevcut proje, tamamlanmayan ilk asamadan itibaren devam ettirilir.
          </p>
          {hasRunningStage ? (
            <p className="mt-2 text-xs font-medium text-blue-300">
              Pipeline su anda calisiyor; yeni resume istegi bekletildi.
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={resumePipeline}
          disabled={loading || hasRunningStage}
          className="rounded-xl border border-yellow-500/40 px-4 py-2 text-sm font-bold text-yellow-300 transition hover:border-yellow-400 hover:text-yellow-200 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-500"
        >
          {loading ? "Devam ettiriliyor..." : "Uretime Devam Et"}
        </button>
      </div>

      {message ? (
        <p className="mt-4 rounded-xl border border-green-500/30 bg-green-950/30 p-4 text-sm text-green-300">
          {message}
        </p>
      ) : null}

      {blockedReason ? (
        <p className="mt-4 rounded-xl border border-yellow-500/30 bg-yellow-950/30 p-4 text-sm text-yellow-200">
          {blockedReason}
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </StudioCard>
  );
}
