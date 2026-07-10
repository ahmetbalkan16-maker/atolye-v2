"use client";

import { useEffect, useRef, useState } from "react";
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
  jobs?: unknown;
};

type JobActionState = {
  jobId: string;
  action: PipelineJobAction;
};

const pipelineJobStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export default function PipelineJobsPanel({
  projectSlug,
}: PipelineJobsPanelProps) {
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionState, setActionState] = useState<JobActionState | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [error, setError] = useState("");
  const actionInFlightRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    actionInFlightRef.current = false;
    setActionState(null);

    async function loadJobs() {
      try {
        setLoading(true);
        setJobs([]);
        setSuccessMessage("");
        setError("");

        if (!isSafeSlug(projectSlug)) {
          setJobs([]);
          setError("Gecersiz proje bilgisi nedeniyle pipeline jobs yuklenemedi.");
          return;
        }

        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectSlug)}/pipeline/jobs`,
        );
        const data = (await response.json()) as JobsResponse;

        if (!mounted) {
          return;
        }

        if (!response.ok || !data.success) {
          setJobs([]);
          setError(data.error || "Pipeline jobs yuklenemedi.");
          return;
        }

        const jobList = parseJobList(data.jobs, projectSlug);

        if (!jobList) {
          setJobs([]);
          setError("Pipeline job verisi eksik veya gecersiz.");
          return;
        }

        setJobs(jobList.jobs);
      } catch (err) {
        console.error("[PipelineJobsPanel] Jobs could not be loaded:", err);

        if (mounted) {
          setJobs([]);
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
    if (actionInFlightRef.current) {
      return;
    }

    if (!isPipelineJobAction(action)) {
      setSuccessMessage("");
      setError("Pipeline job aksiyonu gecersiz.");
      return;
    }

    const job = jobs.find((item) => item.id === jobId);

    if (!job || !isSafeJobId(jobId)) {
      setSuccessMessage("");
      setError("Pipeline job verisi eksik veya gecersiz.");
      return;
    }

    if (!canApplyAction(job.status, action)) {
      setSuccessMessage("");
      setError(
        `${getActionLabel(action)} aksiyonu ${getStatusLabel(job.status)} durumundaki job icin desteklenmiyor.`,
      );
      return;
    }

    try {
      actionInFlightRef.current = true;
      setActionState({ jobId, action });
      setSuccessMessage("");
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

      const jobList = parseJobList(data.jobs, projectSlug);

      if (!jobList) {
        setError("Pipeline job aksiyonu tamamlandi ancak guncel veri okunamadi.");
        return;
      }

      setJobs(jobList.jobs);
      setSuccessMessage(
        `${job.title || job.id} icin ${getActionProgressLabel(action)} tamamlandi.`,
      );
    } catch (err) {
      console.error("[PipelineJobsPanel] Job action failed:", err);
      setError("Pipeline job aksiyonu tamamlanamadi.");
    } finally {
      actionInFlightRef.current = false;
      setActionState(null);
    }
  }

  const summary = createJobSummary(jobs);
  const actionLocked = Boolean(actionState);

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

        {successMessage ? (
          <p className="rounded-lg border border-green-500/30 bg-green-950/30 p-3 text-sm text-green-300">
            {successMessage}
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
                actionState={actionState}
                actionLocked={actionLocked}
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
  actionState,
  actionLocked,
  onAction,
}: {
  job: PipelineJob;
  actionState: JobActionState | null;
  actionLocked: boolean;
  onAction: (jobId: string, action: PipelineJobAction) => void;
}) {
  const jobIsValid = isPipelineJob(job);
  const actionInProgress = actionState?.jobId === job.id;
  const unsupportedReason = jobIsValid
    ? getUnsupportedReason(job.status)
    : "Job verisi eksik veya gecersiz.";

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-zinc-100">
              {job.title || "Untitled job"}
            </h3>
            {jobIsValid ? (
              <StatusBadge status={job.status} />
            ) : (
              <span className="rounded-full bg-red-500/10 px-2 py-1 text-xs font-semibold text-red-300">
                invalid
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Attempts: {Number.isFinite(job.attempts) ? job.attempts : 0} /
            Updated: {formatDate(job.updatedAt)}
          </p>
          {job.error ? (
            <p className="mt-2 max-h-20 overflow-auto break-words rounded-md border border-red-500/30 bg-red-950/30 p-2 text-xs text-red-300">
              {job.error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {jobIsValid && canCancel(job.status) ? (
            <button
              type="button"
              aria-busy={actionInProgress && actionState?.action === "cancel"}
              disabled={actionLocked}
              onClick={() => onAction(job.id, "cancel")}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
            >
              {actionInProgress && actionState?.action === "cancel"
                ? "Canceling..."
                : "Cancel"}
            </button>
          ) : null}
          {jobIsValid && canRetry(job.status) ? (
            <button
              type="button"
              aria-busy={actionInProgress && actionState?.action === "retry"}
              disabled={actionLocked}
              onClick={() => onAction(job.id, "retry")}
              className="rounded-lg border border-yellow-500/40 px-3 py-2 text-xs font-bold text-yellow-300 transition hover:border-yellow-400 hover:text-yellow-200 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
            >
              {actionInProgress && actionState?.action === "retry"
                ? "Retrying..."
                : "Retry"}
            </button>
          ) : null}
        </div>
      </div>

      {unsupportedReason ? (
        <p className="mt-3 text-xs text-zinc-500">{unsupportedReason}</p>
      ) : null}
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

function canApplyAction(
  status: PipelineJobStatus,
  action: PipelineJobAction,
) {
  return action === "cancel" ? canCancel(status) : canRetry(status);
}

function getUnsupportedReason(status: PipelineJobStatus) {
  if (canCancel(status) || canRetry(status)) {
    return "";
  }

  return `Bu job ${getStatusLabel(status)} durumunda; kullanilabilir aksiyon yok.`;
}

function getActionLabel(action: PipelineJobAction) {
  return action === "cancel" ? "Cancel" : "Retry";
}

function getActionProgressLabel(action: PipelineJobAction) {
  return action === "cancel" ? "cancel" : "retry";
}

function getStatusLabel(status: PipelineJobStatus) {
  const labels: Record<PipelineJobStatus, string> = {
    queued: "queued",
    running: "running",
    completed: "completed",
    failed: "failed",
    cancelled: "cancelled",
  };

  return labels[status];
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

function parseJobList(
  value: unknown,
  projectSlug: string,
): PipelineJobList | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const jobList = value as PipelineJobList;

  if (
    jobList.projectSlug !== projectSlug ||
    !Array.isArray(jobList.jobs) ||
    typeof jobList.createdAt !== "string" ||
    typeof jobList.updatedAt !== "string" ||
    !jobList.jobs.every(isPipelineJob)
  ) {
    return null;
  }

  return jobList;
}

function isPipelineJob(value: unknown): value is PipelineJob {
  if (!value || typeof value !== "object") {
    return false;
  }

  const job = value as PipelineJob;

  return (
    typeof job.id === "string" &&
    isSafeJobId(job.id) &&
    typeof job.projectSlug === "string" &&
    typeof job.stage === "string" &&
    typeof job.title === "string" &&
    isPipelineJobStatus(job.status) &&
    typeof job.attempts === "number" &&
    Number.isFinite(job.attempts) &&
    typeof job.createdAt === "string" &&
    typeof job.updatedAt === "string"
  );
}

function isPipelineJobStatus(value: unknown): value is PipelineJobStatus {
  return pipelineJobStatuses.includes(value as PipelineJobStatus);
}

function isPipelineJobAction(value: unknown): value is PipelineJobAction {
  return value === "cancel" || value === "retry";
}

function isSafeSlug(value: string) {
  return /^[a-zA-Z0-9-_]+$/.test(value);
}

function isSafeJobId(value: string) {
  return /^[a-zA-Z0-9-_]+$/.test(value);
}
