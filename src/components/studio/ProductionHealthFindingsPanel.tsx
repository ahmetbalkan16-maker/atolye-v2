import type {
  ProductionHealthFinding,
  ProductionHealthSourceConfidenceLevel,
  ProductionHealthStatus,
} from "@/types/productionHealth";

type ProductionHealthFindingsPanelProps = {
  findings: readonly ProductionHealthFinding[];
  sourceConfidence: ProductionHealthSourceConfidenceLevel;
  status: ProductionHealthStatus;
};

export default function ProductionHealthFindingsPanel({
  findings,
  sourceConfidence,
  status,
}: ProductionHealthFindingsPanelProps) {
  return (
    <section aria-labelledby="production-health-findings-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          id="production-health-findings-title"
          className="font-semibold text-zinc-100"
        >
          Health findings
        </h3>
        <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-300">
          Total: {findings.length}
        </span>
      </div>

      {status === "unknown" ? (
        <p className="rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-sm text-zinc-400">
          Finding details may be incomplete because production health is
          currently unknown.
        </p>
      ) : null}

      {findings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
          No production health findings were reported.
        </p>
      ) : (
        <div className="space-y-3">
          {findings.map((finding, index) => (
            <FindingCard
              key={`${finding.code}-${finding.stage ?? "project"}-${index}`}
              finding={finding}
              sourceConfidence={sourceConfidence}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FindingCard({
  finding,
  sourceConfidence,
}: {
  finding: ProductionHealthFinding;
  sourceConfidence: ProductionHealthSourceConfidenceLevel;
}) {
  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getSeverityClassName(
              finding.severity,
            )}`}
          >
            {finding.severity}
          </span>
          <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-300">
            {finding.category}
          </span>
        </div>
        <code className="max-w-full break-all rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-400">
          {finding.code}
        </code>
      </div>

      <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200 [overflow-wrap:anywhere]">
        {finding.message}
      </p>

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <Detail
          label="Affected stages"
          value={finding.stage ?? "Project-wide"}
        />
        <Detail label="Source confidence" value={sourceConfidence} />
      </dl>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <dt className="font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="mt-1 break-words font-medium capitalize text-zinc-200">
        {value}
      </dd>
    </div>
  );
}

function getSeverityClassName(
  severity: ProductionHealthFinding["severity"],
) {
  const classNames: Record<ProductionHealthFinding["severity"], string> = {
    info: "bg-blue-500/10 text-blue-400",
    warning: "bg-yellow-500/10 text-yellow-400",
    critical: "bg-red-500/10 text-red-400",
  };
  return classNames[severity];
}
