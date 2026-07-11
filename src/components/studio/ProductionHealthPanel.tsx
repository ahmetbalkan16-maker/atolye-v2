"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getProductionHealth,
  isProductionHealthApiConsumerError,
  type GetProductionHealthOptions,
} from "@/lib/production/ProductionHealthApiClient";
import type { ProductionHealthReport } from "@/lib/production/ProductionHealthService";
import type {
  ProductionHealthOverallSeverity,
  ProductionHealthStatus,
} from "@/types/productionHealth";
import StudioCard from "./StudioCard";

export type ProductionHealthUiState =
  | { kind: "loading" }
  | { kind: "success"; report: ProductionHealthReport }
  | { kind: "error"; message: string };

export type ProductionHealthLoader = (
  slug: string,
  options?: GetProductionHealthOptions,
) => Promise<ProductionHealthReport>;

type ProductionHealthPanelProps = {
  projectSlug: string;
  loadHealth?: ProductionHealthLoader;
};

export default function ProductionHealthPanel({
  projectSlug,
  loadHealth = getProductionHealth,
}: ProductionHealthPanelProps) {
  const [state, setState] = useState<ProductionHealthUiState>({
    kind: "loading",
  });
  const requestId = useRef(0);
  const activeController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const nextState = await loadProductionHealthUiState(
      projectSlug,
      loadHealth,
      { signal: controller.signal },
    );

    if (
      requestId.current === currentRequestId &&
      !controller.signal.aborted
    ) {
      setState(nextState);
    }
  }, [loadHealth, projectSlug]);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    void load();
  }, [load]);

  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
      activeController.current?.abort();
    };
  }, [load]);

  return <ProductionHealthPanelView state={state} onRetry={retry} />;
}

export async function loadProductionHealthUiState(
  projectSlug: string,
  loadHealth: ProductionHealthLoader = getProductionHealth,
  options?: GetProductionHealthOptions,
): Promise<ProductionHealthUiState> {
  try {
    return {
      kind: "success",
      report: await loadHealth(projectSlug, options),
    };
  } catch (error) {
    return {
      kind: "error",
      message: isProductionHealthApiConsumerError(error)
        ? error.message
        : "Production health could not be loaded.",
    };
  }
}

export function ProductionHealthPanelView({
  state,
  onRetry,
}: {
  state: ProductionHealthUiState;
  onRetry: () => void;
}) {
  return (
    <StudioCard title="Production Health">
      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? (
        <ErrorState message={state.message} onRetry={onRetry} />
      ) : null}
      {state.kind === "success" ? (
        <HealthSummary report={state.report} onRetry={onRetry} />
      ) : null}
    </StudioCard>
  );
}

function LoadingState() {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400"
    >
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-yellow-400" />
      Production health yukleniyor.
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-4">
      <p role="alert" className="text-sm text-red-300">
        {message}
      </p>
      <RetryButton onRetry={onRetry} />
    </div>
  );
}

function HealthSummary({
  report,
  onRetry,
}: {
  report: ProductionHealthReport;
  onRetry: () => void;
}) {
  const health = report.health;
  const statusClassName = getStatusClassName(health.status);
  const severityClassName = getSeverityClassName(health.overallSeverity);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            label={`Status: ${health.status}`}
            className={statusClassName}
          />
          <Badge
            label={`Severity: ${health.overallSeverity}`}
            className={severityClassName}
          />
        </div>
        <RetryButton onRetry={onRetry} />
      </div>

      <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <SummaryItem label="Overall status" value={health.status} />
        <SummaryItem
          label="Overall severity"
          value={health.overallSeverity}
        />
        <SummaryItem
          label="Source confidence"
          value={health.sourceConfidence.level}
        />
        <SummaryItem label="Findings" value={String(health.counts.total)} />
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Evaluated at
        </p>
        <p className="mt-2 font-medium text-zinc-200">
          {formatDateTime(health.evaluatedAt)}
        </p>
      </div>

      {health.status === "unknown" ? (
        <p className="rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-sm text-zinc-400">
          Production health is currently unknown because source confidence is
          insufficient.
        </p>
      ) : null}

      {health.findings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
          No production health findings were reported.
        </p>
      ) : (
        <p className="text-xs text-zinc-500">
          Read-only health summary. Findings are not persisted by this panel.
        </p>
      )}
    </div>
  );
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="mt-3 inline-flex items-center justify-center rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 transition hover:border-yellow-400 hover:text-yellow-300"
    >
      Retry
    </button>
  );
}

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-2 font-semibold capitalize text-zinc-100">{value}</p>
    </div>
  );
}

function getStatusClassName(status: ProductionHealthStatus) {
  const classNames: Record<ProductionHealthStatus, string> = {
    healthy: "bg-green-500/10 text-green-400",
    warning: "bg-yellow-500/10 text-yellow-400",
    critical: "bg-red-500/10 text-red-400",
    unknown: "bg-zinc-800 text-zinc-400",
  };
  return classNames[status];
}

function getSeverityClassName(severity: ProductionHealthOverallSeverity) {
  const classNames: Record<ProductionHealthOverallSeverity, string> = {
    none: "bg-green-500/10 text-green-400",
    info: "bg-blue-500/10 text-blue-400",
    warning: "bg-yellow-500/10 text-yellow-400",
    critical: "bg-red-500/10 text-red-400",
  };
  return classNames[severity];
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(date);
}
