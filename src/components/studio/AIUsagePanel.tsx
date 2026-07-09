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

  const visibleRecords = useMemo(
    () => sortByNewest(records).slice(0, maxVisibleRecords),
    [records],
  );

  return (
    <StudioCard title="AI Diagnostics">
      <div className="space-y-5">
        <div className="grid gap-4 text-sm text-zinc-300 md:grid-cols-3">
          <SummaryItem label="Kayit sayisi" value={String(records.length)} />
          <SummaryItem
            label="Gosterilen"
            value={`${visibleRecords.length}/${maxVisibleRecords}`}
          />
          <SummaryItem
            label="Son kayit"
            value={
              visibleRecords[0]
                ? formatDate(visibleRecords[0].createdAt)
                : "Belirtilmedi"
            }
          />
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

function sortByNewest(records: AIUsageRecord[]) {
  return [...records].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("tr-TR");
}
