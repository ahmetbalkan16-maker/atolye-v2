"use client";

import { useEffect, useState } from "react";
import type {
  PipelineJob,
  PipelineJobAction,
  PipelineJobList,
  PipelineJobStatus,
} from "@/types/pipelineJob";
import StudioCard from "./StudioCard";

type PipelineJobsPanelProps = {
  projectSlug: string;
};

type JobsResponse = {
  success?: boolean;
  error?: string;
  jobs?: PipelineJobList;
};

export default function PipelineJobsPanel({
  projectSlug,
}: PipelineJobsPanelProps) {
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingJobId, setActingJobId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadJobs() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectSlug)}/pipeline/jobs`,
        );
        const data = (await response.json()) as JobsResponse;

        if (!mounted) {
          return;
        }

        if (!response.ok || !data.success) {
          setError(data.error || "Pipeline jobs yuklenemedi.");
          return;
        }

        setJobs(data.jobs?.jobs ?? []);
      } catch (err) {
        console.error("[PipelineJobsPanel] Jobs could not be loaded:", err);

        if (mounted) {
          setError("Pipeline jobs yuklenemedi.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadJobs();

    return () => {
      mounted = false;
    };
  }, [projectSlug]);

  async function applyAction(jobId: string, action: PipelineJobAction) {
    if (actingJobId) {
      return;
    }

    try {
      setActingJobId(jobId);
      setError("");

      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectSlug)}/pipeline/jobs/${encodeURIComponent(jobId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action }),
        },
      );
      const data = (await response.json()) as JobsResponse;

      if (!response.ok || !data.success) {
        setError(data.error || "Pipeline job aksiyonu tamamlanamadi.");
        return;
      }

      setJobs(data.jobs?.jobs ?? []);
    } catch (err) {
      console.error("[PipelineJobsPanel] Job action failed:", err);
      setError("Pipeline job aksiyonu tamamlanamadi.");
    } finally {
      setActingJobId(null);
    }
  }

  const summary = createJobSummary(jobs);

  return (
    <StudioCard title="Pipeline Queue / Jobs">
      <div className="space-y-4">
        <div className="grid gap-3 text-sm sm:grid-cols-5">
          <SummaryPill label="Queued" value={summary.queued} />
          <SummaryPill label="Running" value={summary.running} />
          <SummaryPill label="Completed" value={summary.completed} />
          <SummaryPill label="Failed" value={summary.failed} />
          <SummaryPill label="Cancelled" value={summary.cancelled} />
        </div>

        {error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
            Pipeline jobs yukleniyor.
          </p>
        ) : jobs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
            Bu proje icin pipeline job kaydi yok.
          </p>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                acting={actingJobId === job.id}
                onAction={applyAction}
              />
            ))}
          </div>
        )}
      </div>
    </StudioCard>
  );
}

function JobRow({
  job,
  acting,
  onAction,
}: {
  job: PipelineJob;
  acting: boolean;
  onAction: (jobId: string, action: PipelineJobAction) => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-zinc-100">{job.title}</h3>
            <StatusBadge status={job.status} />
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Attempts: {job.attempts} / Updated: {formatDate(job.updatedAt)}
          </p>
          {job.error ? (
            <p className="mt-2 max-h-20 overflow-auto break-words rounded-md border border-red-500/30 bg-red-950/30 p-2 text-xs text-red-300">
              {job.error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {canCancel(job.status) ? (
            <button
              type="button"
              disabled={acting}
              onClick={() => onAction(job.id, "cancel")}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-600"
            >
              {acting ? "..." : "Cancel"}
            </button>
          ) : null}
          {canRetry(job.status) ? (
            <button
              type="button"
              disabled={acting}
              onClick={() => onAction(job.id, "retry")}
              className="rounded-lg border border-yellow-500/40 px-3 py-2 text-xs font-bold text-yellow-300 transition hover:border-yellow-400 hover:text-yellow-200 disabled:cursor-not-allowed disabled:text-zinc-600"
            >
              {acting ? "..." : "Retry"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-1 font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: PipelineJobStatus }) {
  const className = getStatusClassName(status);

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${className}`}>
      {status}
    </span>
  );
}

function createJobSummary(jobs: PipelineJob[]) {
  return jobs.reduce(
    (summary, job) => ({
      ...summary,
      [job.status]: summary[job.status] + 1,
    }),
    {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    } satisfies Record<PipelineJobStatus, number>,
  );
}

function canCancel(status: PipelineJobStatus) {
  return status === "queued" || status === "running";
}

function canRetry(status: PipelineJobStatus) {
  return status === "failed" || status === "cancelled";
}

function formatDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function getStatusClassName(status: PipelineJobStatus) {
  const classNames: Record<PipelineJobStatus, string> = {
    queued: "bg-zinc-800 text-zinc-300",
    running: "bg-blue-500/10 text-blue-300",
    completed: "bg-green-500/10 text-green-300",
    failed: "bg-red-500/10 text-red-300",
    cancelled: "bg-zinc-700 text-zinc-400",
  };

  return classNames[status];
}
