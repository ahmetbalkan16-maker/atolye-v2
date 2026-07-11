import type {
  ProductionHealthFinding,
  ProductionHealthSourceConfidenceLevel,
  ProductionHealthStatus,
} from "@/types/productionHealth";
import type { ProductionSnapshotFindingEvidenceValue } from "@/types/productionSnapshot";

type ProductionHealthFindingEvidenceProps = {
  finding: ProductionHealthFinding;
  confidence: ProductionHealthSourceConfidenceLevel;
  status: ProductionHealthStatus;
};

export default function ProductionHealthFindingEvidence({
  finding,
  confidence,
  status,
}: ProductionHealthFindingEvidenceProps) {
  const entries = Object.entries(finding.evidence);
  const source = finding.sources.length > 0
    ? finding.sources.join(", ")
    : "Source unavailable";
  const resource = finding.stage ?? finding.scope;

  return (
    <div className="mt-4 space-y-3 border-t border-zinc-800 pt-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Finding evidence
      </h4>

      {status === "unknown" ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-500">
          Evidence may be incomplete while production health is unknown.
        </p>
      ) : null}

      <dl className="grid gap-3 text-xs sm:grid-cols-3">
        <EvidenceMeta label="Source" value={source} />
        <EvidenceMeta label="Affected resource" value={resource} />
        <EvidenceMeta label="Confidence" value={confidence} />
      </dl>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-500">
          No structured evidence was provided for this finding.
        </p>
      ) : (
        <dl className="space-y-2">
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="grid gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-xs sm:grid-cols-[minmax(0,0.4fr)_minmax(0,1fr)] sm:gap-3"
            >
              <dt className="break-all font-semibold text-zinc-500">{key}</dt>
              <dd className="whitespace-pre-wrap break-words text-zinc-200 [overflow-wrap:anywhere]">
                {formatEvidenceValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function EvidenceMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <dt className="font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="mt-1 whitespace-pre-wrap break-words font-medium text-zinc-200 [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}

function formatEvidenceValue(value: ProductionSnapshotFindingEvidenceValue) {
  if (value === null) return "null";
  return String(value);
}
