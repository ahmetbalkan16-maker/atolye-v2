"use client";

import { useEffect, useMemo, useState } from "react";
import type { AIUsageLog, AIUsageRecord, AIUsageStatus } from "@/types/aiUsage";
import StudioCard from "./StudioCard";

type AIUsagePanelProps = {
  projectSlug: string;
};

type AIUsageResponse = {
  success?: boolean;
  usage?: AIUsageLog;
  error?: string;
};

type UsageSummary = {
  totalCalls: number;
  successCount: number;
  fallbackCount: number;
  failedCount: number;
  averageDurationMs: number | null;
  lastCallAt: string | null;
  providerDistribution: ProviderDistributionItem[];
};

type ProviderDistributionItem = {
  provider: string;
  count: number;
};

const maxVisibleRecords = 20;

export default function AIUsagePanel({ projectSlug }: AIUsagePanelProps) {
  const [records, setRecords] = useState<AIUsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadUsage() {
      try {
        setLoading(true);
        setError("");

        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectSlug)}/ai-usage`,
        );
        const data = (await res.json()) as AIUsageResponse;

        if (!active) {
          return;
        }

        if (!res.ok || !data.success) {
          setError(data.error || "AI usage records could not be loaded.");
          setRecords([]);
          return;
        }

        setRecords(data.usage?.records ?? []);
      } catch (err) {
        console.error("[AIUsagePanel] Usage loading failed:", err);

        if (active) {
          setError("AI usage records could not be loaded.");
          setRecords([]);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadUsage();

    return () => {
      active = false;
    };
  }, [projectSlug]);

  const sortedRecords = useMemo(() => sortByNewest(records), [records]);
  const summary = useMemo(() => createUsageSummary(sortedRecords), [sortedRecords]);
  const visibleRecords = useMemo(
    () => sortedRecords.slice(0, maxVisibleRecords),
    [sortedRecords],
  );
  const averageDurationLabel =
    summary.averageDurationMs === null
      ? "-"
      : `${Math.round(summary.averageDurationMs)} ms`;

  const providerDistributionLabel = useMemo(
    () =>
      summary.providerDistribution.length > 0
        ? summary.providerDistribution
            .map((item) => `${item.provider}: ${item.count}`)
            .join(", ")
        : "-",
    [summary.providerDistribution],
  );

  return (
    <StudioCard title="AI Diagnostics">
      <div className="space-y-5">
        <div className="grid gap-4 text-sm text-zinc-300 md:grid-cols-3">
          <SummaryItem label="Toplam AI cagrisi" value={String(summary.totalCalls)} />
          <SummaryItem label="Success" value={String(summary.successCount)} />
          <SummaryItem label="Fallback" value={String(summary.fallbackCount)} />
          <SummaryItem label="Failed" value={String(summary.failedCount)} />
          <SummaryItem label="Ortalama sure" value={averageDurationLabel} />
          <SummaryItem
            label="Son AI cagrisi"
            value={
              summary.lastCallAt
                ? formatDate(summary.lastCallAt)
                : "Belirtilmedi"
            }
          />
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Provider dagilimi
          </p>
          <p className="mt-2 text-sm font-semibold text-zinc-100">
            {providerDistributionLabel}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
          <span>Gosterilen: {visibleRecords.length}/{maxVisibleRecords}</span>
          <span>Kaynak: read-only ai-usage.json</span>
        </div>

        {loading ? (
          <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
            AI usage kayitlari yukleniyor.
          </p>
        ) : null}

        {!loading && error ? (
          <p className="rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        {!loading && !error && visibleRecords.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
            Bu proje icin henuz AI usage kaydi bulunmuyor.
          </p>
        ) : null}

        {!loading && !error && visibleRecords.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <tr className="border-b border-zinc-800">
                  <th className="px-3 py-3">Stage</th>
                  <th className="px-3 py-3">Operation</th>
                  <th className="px-3 py-3">Provider</th>
                  <th className="px-3 py-3">Model</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Fallback</th>
                  <th className="px-3 py-3">Duration</th>
                  <th className="px-3 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-300">
                {visibleRecords.map((record) => (
                  <tr key={record.id}>
                    <td className="whitespace-nowrap px-3 py-3">
                      {record.stage}
                    </td>
                    <td className="min-w-44 px-3 py-3">{record.operation}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {record.provider}
                    </td>
                    <td className="min-w-40 px-3 py-3">
                      {record.model ?? "Belirtilmedi"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <StatusBadge status={record.status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {record.fallbackUsed ? "Evet" : "Hayir"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {record.durationMs} ms
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {formatDate(record.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </StudioCard>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-2 break-all font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: AIUsageStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-medium ${getStatusClassName(
        status,
      )}`}
    >
      {status}
    </span>
  );
}

function getStatusClassName(status: AIUsageStatus) {
  const classNames: Record<AIUsageStatus, string> = {
    success: "bg-green-500/10 text-green-400",
    fallback: "bg-yellow-500/10 text-yellow-400",
    failed: "bg-red-500/10 text-red-400",
  };

  return classNames[status];
}

function createUsageSummary(records: AIUsageRecord[]): UsageSummary {
  if (records.length === 0) {
    return {
      totalCalls: 0,
      successCount: 0,
      fallbackCount: 0,
      failedCount: 0,
      averageDurationMs: null,
      lastCallAt: null,
      providerDistribution: [],
    };
  }

  const providerCounts = new Map<string, number>();
  let successCount = 0;
  let fallbackCount = 0;
  let failedCount = 0;
  let totalDurationMs = 0;

  for (const record of records) {
    if (record.status === "success") {
      successCount += 1;
    }

    if (record.status === "fallback" || record.fallbackUsed) {
      fallbackCount += 1;
    }

    if (record.status === "failed") {
      failedCount += 1;
    }

    totalDurationMs += record.durationMs;
    providerCounts.set(
      record.provider,
      (providerCounts.get(record.provider) ?? 0) + 1,
    );
  }

  return {
    totalCalls: records.length,
    successCount,
    fallbackCount,
    failedCount,
    averageDurationMs: totalDurationMs / records.length,
    lastCallAt: records[0]?.createdAt ?? null,
    providerDistribution: Array.from(providerCounts.entries())
      .map(([provider, count]) => ({ provider, count }))
      .sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider)),
  };
}

function sortByNewest(records: AIUsageRecord[]) {
  return [...records].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("tr-TR");
}
