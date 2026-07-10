"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PipelineJob,
  PipelineJobAction,
  PipelineJobHistory,
  PipelineJobHistoryEvent,
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
  execution?: {
    status?: unknown;
    stage?: unknown;
  };
};

type HistoryResponse = {
  success?: boolean;
  error?: string;
  history?: unknown;
};

type LoadHistoryOptions = {
  silent?: boolean;
  queueIfInFlight?: boolean;
};

type JobActionState = {
  jobId: string;
  action: PipelineJobAction;
};

type PipelineHistoryInsights = {
  totalTerminalEvents: number;
  completedCount: number;
  failedCount: number;
  successRate?: number;
  lastTerminalEvent?: PipelineJobHistoryEvent;
  averageDurationMs?: number;
  queueHealth: string;
};

type PipelineHealthSeverity = "idle" | "healthy" | "active" | "waiting" | "attention";

type PipelineHealthInsights = {
  severity: PipelineHealthSeverity;
  statusLabel: string;
  attentionItems: string[];
};

const pipelineJobStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
const activeRefreshIntervalMs = 5000;
const LONG_RUNNING_THRESHOLD_MS = 10 * 60 * 1000;

export default function PipelineJobsPanel({
  projectSlug,
}: PipelineJobsPanelProps) {
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<PipelineJobHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [actionState, setActionState] = useState<JobActionState | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [error, setError] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const actionInFlightRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const historyRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const historyRefreshQueuedRef = useRef(false);
  const historyRefreshStartedCountRef = useRef(0);
  const latestProjectSlugRef = useRef(projectSlug);

  latestProjectSlugRef.current = projectSlug;

  const loadJobs = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (refreshInFlightRef.current) {
        return;
      }

      const requestedSlug = projectSlug;
      refreshInFlightRef.current = true;

      try {
        if (!silent) {
          setLoading(true);
          setJobs([]);
          setSuccessMessage("");
          setError("");
        }

        if (!isSafeSlug(requestedSlug)) {
          if (latestProjectSlugRef.current === requestedSlug) {
            setJobs([]);
            setError(
              "Gecersiz proje bilgisi nedeniyle pipeline jobs yuklenemedi.",
            );
          }

          return;
        }

        const response = await fetch(
          `/api/projects/${encodeURIComponent(requestedSlug)}/pipeline/jobs`,
        );
        const data = (await response.json()) as JobsResponse;

        if (latestProjectSlugRef.current !== requestedSlug) {
          return;
        }

        if (!response.ok || !data.success) {
          setJobs([]);
          setError(data.error || "Pipeline jobs yuklenemedi.");
          return;
        }

        const jobList = parseJobList(data.jobs, requestedSlug);

        if (!jobList) {
          setJobs([]);
          setError("Pipeline job verisi eksik veya gecersiz.");
          return;
        }

        setJobs(jobList.jobs);
        setError("");
      } catch (err) {
        console.error("[PipelineJobsPanel] Jobs could not be loaded:", err);

        if (latestProjectSlugRef.current === requestedSlug) {
          setJobs([]);
          setError("Pipeline jobs yuklenemedi.");
        }
      } finally {
        if (latestProjectSlugRef.current === requestedSlug && !silent) {
          setLoading(false);
        }

        refreshInFlightRef.current = false;
      }
    },
    [projectSlug],
  );

  const loadHistory = useCallback(
    async ({
      silent = false,
      queueIfInFlight = false,
    }: LoadHistoryOptions = {}) => {
      if (historyRefreshPromiseRef.current) {
        const startedCount = historyRefreshStartedCountRef.current;

        if (queueIfInFlight) {
          historyRefreshQueuedRef.current = true;
        }

        await historyRefreshPromiseRef.current;

        if (
          queueIfInFlight &&
          historyRefreshStartedCountRef.current <= startedCount
        ) {
          await loadHistory({ silent: true });
        }

        return;
      }

      let nextSilent = silent;
      const refreshPromise = (async () => {
        do {
          historyRefreshQueuedRef.current = false;
          const requestedSlug = projectSlug;
          historyRefreshStartedCountRef.current += 1;

          try {
            if (!nextSilent) {
              setHistoryLoading(true);
              setHistory([]);
              setHistoryError("");
            }

            if (!isSafeSlug(requestedSlug)) {
              if (latestProjectSlugRef.current === requestedSlug) {
                setHistory([]);
                setHistoryError(
                  "Gecersiz proje bilgisi nedeniyle execution history yuklenemedi.",
                );
              }

              return;
            }

            const response = await fetch(
              `/api/projects/${encodeURIComponent(requestedSlug)}/pipeline/history`,
            );
            const data = (await response.json()) as HistoryResponse;

            if (latestProjectSlugRef.current !== requestedSlug) {
              return;
            }

            if (!response.ok || !data.success) {
              setHistory([]);
              setHistoryError(data.error || "Execution history yuklenemedi.");
              return;
            }

            const historyList = parseHistory(data.history, requestedSlug);

            if (!historyList) {
              setHistory([]);
              setHistoryError("Execution history verisi eksik veya gecersiz.");
              return;
            }

            setHistory(historyList.events);
            setHistoryError("");
          } catch (err) {
            console.error(
              "[PipelineJobsPanel] Execution history could not be loaded:",
              err,
            );

            if (latestProjectSlugRef.current === requestedSlug) {
              setHistory([]);
              setHistoryError("Execution history yuklenemedi.");
            }
          } finally {
            if (latestProjectSlugRef.current === requestedSlug && !nextSilent) {
              setHistoryLoading(false);
            }

            nextSilent = true;
          }
        } while (
          historyRefreshQueuedRef.current &&
          latestProjectSlugRef.current === projectSlug
        );
      })();

      historyRefreshPromiseRef.current = refreshPromise;

      try {
        await refreshPromise;
      } finally {
        if (historyRefreshPromiseRef.current === refreshPromise) {
          historyRefreshPromiseRef.current = null;
          historyRefreshQueuedRef.current = false;
        }
      }
    },
    [projectSlug],
  );

  useEffect(() => {
    actionInFlightRef.current = false;
    refreshInFlightRef.current = false;
    historyRefreshPromiseRef.current = null;
    historyRefreshQueuedRef.current = false;
    setActionState(null);
    loadJobs();
    loadHistory();
  }, [loadJobs, loadHistory]);

  const hasActiveJobs = jobs.some(isActiveJob);
  const hasRunningJobs = jobs.some((job) => job.status === "running");

  useEffect(() => {
    if (!hasActiveJobs) {
      return;
    }

    const intervalId = window.setInterval(() => {
      loadJobs({ silent: true });
      loadHistory({ silent: true, queueIfInFlight: true });
    }, activeRefreshIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasActiveJobs, loadJobs, loadHistory]);

  useEffect(() => {
    if (!hasRunningJobs) {
      return;
    }

    setNowMs(Date.now());

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasRunningJobs]);

  useEffect(() => {
    function refreshOnFocus() {
      if (document.visibilityState === "visible") {
        loadJobs({ silent: true });
        loadHistory({ silent: true, queueIfInFlight: true });
      }
    }

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);

    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [loadJobs, loadHistory]);

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

      const jobList = parseJobList(data.jobs, projectSlug);

      if (jobList) {
        setJobs(jobList.jobs);
      }

      if (!response.ok || !data.success) {
        if (action === "retry" && data.execution?.status === "blocked") {
          setError(
            data.error || "Retry queued ancak execution baslatilamadi.",
          );
        } else {
          setError(data.error || "Pipeline job aksiyonu tamamlanamadi.");
        }
        return;
      }

      if (!jobList) {
        setError("Pipeline job aksiyonu tamamlandi ancak guncel veri okunamadi.");
        return;
      }

      await loadHistory({ silent: true, queueIfInFlight: true });
      setSuccessMessage(
        action === "retry"
          ? `${job.title || job.id} icin retry execution tamamlandi.`
          : `${job.title || job.id} icin ${getActionProgressLabel(action)} tamamlandi.`,
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
  const sortedHistory = sortHistoryEvents(history);
  const historyInsights = createHistoryInsights(history, jobs, nowMs);
  const healthInsights = createPipelineHealthInsights(history, jobs, nowMs);

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
                nowMs={nowMs}
              />
            ))}
          </div>
        )}

        <section className="border-t border-zinc-800 pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-100">
              Execution History
            </h3>
            <span className="text-xs text-zinc-500">
              {history.length} {history.length === 1 ? "event" : "events"}
            </span>
          </div>

          {historyError ? (
            <p className="rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-300">
              {historyError}
            </p>
          ) : null}

          {historyLoading ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
              Execution history yukleniyor.
            </p>
          ) : !historyError ? (
            <>
              <PipelineIntelligence
                insights={historyInsights}
                healthInsights={healthInsights}
              />
              {history.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
                  Bu proje icin execution history kaydi yok.
                </p>
              ) : (
                <div className="space-y-3 border-l border-zinc-800 pl-4">
                  {sortedHistory.map((event) => (
                    <HistoryRow key={event.id} event={event} />
                  ))}
                </div>
              )}
            </>
          ) : null}
        </section>
      </div>
    </StudioCard>
  );
}

function PipelineIntelligence({
  insights,
  healthInsights,
}: {
  insights: PipelineHistoryInsights;
  healthInsights: PipelineHealthInsights;
}) {
  return (
    <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-zinc-100">
          Pipeline Intelligence
        </h4>
        <span className="text-xs text-zinc-500">
          {insights.totalTerminalEvents} terminal events
        </span>
      </div>
      <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
        <JobDetail
          label="Success Rate"
          value={formatOptionalPercent(insights.successRate)}
        />
        <JobDetail label="Failures" value={formatNumber(insights.failedCount)} />
        <JobDetail
          label="Average Duration"
          value={formatOptionalDuration(insights.averageDurationMs)}
        />
        <JobDetail
          label="Last Event"
          value={formatLastHistoryEvent(insights.lastTerminalEvent)}
        />
        <JobDetail label="Queue Health" value={insights.queueHealth} />
      </div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <JobDetail label="Health" value={healthInsights.statusLabel} />
        <JobDetail
          label="Attention"
          value={formatAttentionItems(healthInsights.attentionItems)}
        />
      </div>
    </div>
  );
}

function HistoryRow({ event }: { event: PipelineJobHistoryEvent }) {
  const duration = getHistoryDurationLabel(event);
  const eventTime = getHistoryEventTimeLabel(event);
  const statusClassName = getHistoryStatusClassName(event.status);

  return (
    <div className="relative rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <span className="absolute -left-[23px] top-5 h-3 w-3 rounded-full border border-zinc-950 bg-zinc-500" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-zinc-100">{event.stage}</h4>
            <span
              className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClassName}`}
            >
              {event.status}
            </span>
          </div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <JobDetail label="Event Time" value={eventTime} />
            <JobDetail label="Job ID" value={event.jobId} />
            <JobDetail label="Recorded" value={formatDate(event.recordedAt)} />
            {event.startedAt ? (
              <JobDetail label="Started At" value={formatDate(event.startedAt)} />
            ) : null}
            {event.completedAt ? (
              <JobDetail
                label="Completed At"
                value={formatDate(event.completedAt)}
              />
            ) : null}
            {duration ? <JobDetail label="Duration" value={duration} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function JobRow({
  job,
  actionState,
  actionLocked,
  onAction,
  nowMs,
}: {
  job: PipelineJob;
  actionState: JobActionState | null;
  actionLocked: boolean;
  onAction: (jobId: string, action: PipelineJobAction) => void;
  nowMs: number;
}) {
  const jobIsValid = isPipelineJob(job);
  const actionInProgress = actionState?.jobId === job.id;
  const unsupportedReason = jobIsValid
    ? getUnsupportedReason(job.status)
    : "Job verisi eksik veya gecersiz.";
  const duration = getJobDurationLabel(job, nowMs);
  const startedAt = getOptionalString(job.startedAt);
  const completedAt = getOptionalString(job.completedAt);

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
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <JobDetail label="Updated" value={formatDate(job.updatedAt)} />
            {startedAt ? (
              <JobDetail label="Started At" value={formatDate(startedAt)} />
            ) : null}
            {completedAt ? (
              <JobDetail label="Completed At" value={formatDate(completedAt)} />
            ) : null}
            {duration ? <JobDetail label="Duration" value={duration} /> : null}
            <JobDetail
              label="Retry Attempts"
              value={formatNumber(job.attempts)}
            />
          </div>
          {job.status === "failed" && job.error ? (
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
                ? "Retrying execution..."
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

function JobDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2">
      <p className="font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-1 break-words text-zinc-300">{value}</p>
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

function sortHistoryEvents(events: PipelineJobHistoryEvent[]) {
  return [...events].sort(
    (left, right) => getHistoryEventTimeMs(right) - getHistoryEventTimeMs(left),
  );
}

function createHistoryInsights(
  history: PipelineJobHistoryEvent[],
  jobs: PipelineJob[],
  nowMs: number,
): PipelineHistoryInsights {
  const totalTerminalEvents = history.length;
  const completedCount = history.filter(
    (event) => event.status === "completed",
  ).length;
  const failedCount = history.filter((event) => event.status === "failed")
    .length;
  const successRate =
    totalTerminalEvents > 0 ? completedCount / totalTerminalEvents : undefined;
  const lastTerminalEvent = sortHistoryEvents(history)[0];
  const durationValues = history
    .map(getHistoryDurationMs)
    .filter((duration): duration is number => typeof duration === "number");
  const averageDurationMs =
    durationValues.length > 0
      ? durationValues.reduce((total, duration) => total + duration, 0) /
        durationValues.length
      : undefined;

  return {
    totalTerminalEvents,
    completedCount,
    failedCount,
    successRate,
    lastTerminalEvent,
    averageDurationMs,
    queueHealth: getQueueHealthLabel(jobs, nowMs),
  };
}

function createPipelineHealthInsights(
  history: PipelineJobHistoryEvent[],
  jobs: PipelineJob[],
  nowMs: number,
): PipelineHealthInsights {
  const summary = createJobSummary(jobs);
  const longRunningCount = getLongRunningJobs(jobs, nowMs).length;
  const retryPressureCount = jobs.filter((job) => job.attempts > 0).length;

  if (jobs.length === 0) {
    return {
      severity: "idle",
      statusLabel: "Idle",
      attentionItems: [],
    };
  }

  const attentionItems = [
    summary.failed > 0 ? `${formatNumber(summary.failed)} failed job` : "",
    summary.cancelled > 0
      ? `${formatNumber(summary.cancelled)} cancelled job`
      : "",
    longRunningCount > 0
      ? `${formatNumber(longRunningCount)} running over 10 minutes`
      : "",
    retryPressureCount > 0
      ? `${formatNumber(retryPressureCount)} retried job`
      : "",
    getRecentHistoryAttention(history),
  ].filter(Boolean).slice(0, 3);

  if (summary.failed > 0 || summary.cancelled > 0 || longRunningCount > 0) {
    return {
      severity: "attention",
      statusLabel: "Attention",
      attentionItems,
    };
  }

  if (summary.queued > 0 && summary.running === 0) {
    return {
      severity: "waiting",
      statusLabel: "Waiting",
      attentionItems,
    };
  }

  if (summary.running > 0) {
    return {
      severity: "active",
      statusLabel: "Active",
      attentionItems,
    };
  }

  if (summary.completed > 0) {
    return {
      severity: "healthy",
      statusLabel: "Healthy",
      attentionItems,
    };
  }

  return {
    severity: "idle",
    statusLabel: "Idle",
    attentionItems,
  };
}

function canCancel(status: PipelineJobStatus) {
  return status === "queued" || status === "running";
}

function canRetry(status: PipelineJobStatus) {
  return status === "failed" || status === "cancelled";
}

function isActiveJob(job: PipelineJob) {
  return job.status === "queued" || job.status === "running";
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

function getJobDurationLabel(job: PipelineJob, nowMs: number) {
  const startedAtMs = getTimestampMs(job.startedAt);

  if (startedAtMs === null) {
    return undefined;
  }

  const completedAtMs =
    job.status === "running" ? nowMs : getTimestampMs(job.completedAt);

  if (completedAtMs === null || completedAtMs < startedAtMs) {
    return undefined;
  }

  return formatDuration(completedAtMs - startedAtMs);
}

function getHistoryDurationLabel(event: PipelineJobHistoryEvent) {
  const durationMs = getHistoryDurationMs(event);

  return typeof durationMs === "number" ? formatDuration(durationMs) : undefined;
}

function getHistoryDurationMs(event: PipelineJobHistoryEvent) {
  const startedAtMs = getTimestampMs(event.startedAt);
  const completedAtMs = getTimestampMs(event.completedAt);

  if (
    startedAtMs === null ||
    completedAtMs === null ||
    completedAtMs < startedAtMs
  ) {
    return undefined;
  }

  return completedAtMs - startedAtMs;
}

function getHistoryEventTimeLabel(event: PipelineJobHistoryEvent) {
  const value =
    event.completedAt ?? event.recordedAt ?? event.jobUpdatedAt ?? event.jobCreatedAt;

  return formatDate(value);
}

function getHistoryEventTimeMs(event: PipelineJobHistoryEvent) {
  return (
    getTimestampMs(event.completedAt) ??
    getTimestampMs(event.recordedAt) ??
    getTimestampMs(event.jobUpdatedAt) ??
    getTimestampMs(event.jobCreatedAt) ??
    0
  );
}

function getTimestampMs(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : timestamp;
}

function getOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function formatNumber(value: number) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat("tr-TR").format(value)
    : "0";
}

function formatOptionalPercent(value?: number) {
  return typeof value === "number"
    ? new Intl.NumberFormat("tr-TR", {
        maximumFractionDigits: 0,
        style: "percent",
      }).format(value)
    : "Not available";
}

function formatOptionalDuration(value?: number) {
  return typeof value === "number" ? formatDuration(value) : "Not available";
}

function formatAttentionItems(items: string[]) {
  return items.length > 0 ? items.join(" / ") : "No action required";
}

function formatLastHistoryEvent(event?: PipelineJobHistoryEvent) {
  if (!event) {
    return "Not available";
  }

  return `${event.stage} / ${event.status} / ${getHistoryEventTimeLabel(event)}`;
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds} sn`;
  }

  return `${minutes} dk ${seconds} sn`;
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

function getHistoryStatusClassName(status: PipelineJobHistoryEvent["status"]) {
  const classNames: Record<PipelineJobHistoryEvent["status"], string> = {
    completed: "bg-green-500/10 text-green-300",
    failed: "bg-red-500/10 text-red-300",
    cancelled: "bg-zinc-700 text-zinc-400",
  };

  return classNames[status];
}

function getLongRunningJobs(jobs: PipelineJob[], nowMs: number) {
  return jobs.filter((job) => {
    if (job.status !== "running") {
      return false;
    }

    const startedAtMs = getTimestampMs(job.startedAt);

    return (
      startedAtMs !== null &&
      nowMs - startedAtMs > LONG_RUNNING_THRESHOLD_MS
    );
  });
}

function getRecentHistoryAttention(history: PipelineJobHistoryEvent[]) {
  const latestEvent = sortHistoryEvents(history)[0];

  if (!latestEvent || latestEvent.status === "completed") {
    return "";
  }

  return `last event ${latestEvent.status}`;
}

function getQueueHealthLabel(jobs: PipelineJob[], nowMs: number) {
  const summary = createJobSummary(jobs);

  if (summary.failed > 0) {
    return `${formatNumber(summary.failed)} failed`;
  }

  if (summary.cancelled > 0) {
    return `${formatNumber(summary.cancelled)} cancelled`;
  }

  if (summary.running > 0) {
    const staleRunningJobs = jobs.filter((job) => {
      if (job.status !== "running") {
        return false;
      }

      const startedAtMs = getTimestampMs(job.startedAt);

      return (
        startedAtMs !== null &&
        nowMs - startedAtMs > activeRefreshIntervalMs * 12
      );
    }).length;

    return staleRunningJobs > 0
      ? `${formatNumber(staleRunningJobs)} long running`
      : `${formatNumber(summary.running)} running`;
  }

  if (summary.queued > 0) {
    return `${formatNumber(summary.queued)} queued`;
  }

  if (summary.completed > 0) {
    return "Healthy";
  }

  return "No jobs";
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

function parseHistory(
  value: unknown,
  projectSlug: string,
): PipelineJobHistory | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const historyList = value as PipelineJobHistory;

  if (
    historyList.projectSlug !== projectSlug ||
    !Array.isArray(historyList.events) ||
    typeof historyList.createdAt !== "string" ||
    typeof historyList.updatedAt !== "string" ||
    !historyList.events.every(isPipelineJobHistoryEvent)
  ) {
    return null;
  }

  return historyList;
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

function isPipelineJobHistoryEvent(
  value: unknown,
): value is PipelineJobHistoryEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as PipelineJobHistoryEvent;

  return (
    typeof event.id === "string" &&
    event.id.length > 0 &&
    typeof event.jobId === "string" &&
    event.jobId.length > 0 &&
    typeof event.stage === "string" &&
    (event.status === "completed" ||
      event.status === "failed" ||
      event.status === "cancelled") &&
    typeof event.jobCreatedAt === "string" &&
    typeof event.jobUpdatedAt === "string" &&
    typeof event.recordedAt === "string" &&
    (event.startedAt === undefined || typeof event.startedAt === "string") &&
    (event.completedAt === undefined || typeof event.completedAt === "string")
  );
}

function isSafeSlug(value: string) {
  return /^[a-zA-Z0-9-_]+$/.test(value);
}

function isSafeJobId(value: string) {
  return /^[a-zA-Z0-9-_]+$/.test(value);
}
