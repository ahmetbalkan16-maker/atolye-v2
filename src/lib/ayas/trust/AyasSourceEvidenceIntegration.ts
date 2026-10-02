/** Stage 15P. Metadata for the existing finding store; no new persistence or acquisition path. */
import { ayasTechnologyIso, describeAyasTechnologySource } from "../technology/AyasTechnologyCandidate";
import { verifyAyasTechnologySource } from "../technology/AyasTechnologyWatch";
import { assessAyasSourceEvidence, isAyasSourceEvidenceGraph, sealAyasSourceEvidence, type AyasSourceEvidenceGraph, type AyasSourceReviewBinding, type AyasSourceTrustReport, type AyasSourceUse } from "./AyasSourceEvidence";

interface FindingFacts {
  readonly capability: string;
  readonly problemSolved: string;
  readonly sourceUrl: string;
  readonly isOfficialSource: boolean;
  readonly featureDate: string | null;
  readonly lastCheckedAt: string;
  readonly licenseCostStatus: string;
  readonly researchMode?: "LIGHT" | "DEEP";
}
const anchors = Object.freeze({ names: [], packages: [], repositories: [], hosts: [] });
const checkedTime = (value: string | null): string | null => ayasTechnologyIso(value);
const statement = (finding: FindingFacts) => `${finding.capability}: ${finding.problemSolved}`.slice(0, 1200);

/** The official flag is a declaration. Only the existing registered-source verifier can bind it to an identity. */
export function buildAyasFindingSourceEvidence(finding: FindingFacts): AyasSourceEvidenceGraph {
  const source = describeAyasTechnologySource(finding.sourceUrl);
  const registered = !!source && finding.isOfficialSource === true && verifyAyasTechnologySource(source.url, anchors) === "REGISTERED_OFFICIAL";
  return sealAyasSourceEvidence({ schemaVersion: "1", dataOnly: true,
    sources: [{ id: "finding-source", reference: source?.url ?? "UNVERIFIED_SOURCE_REFERENCE", domain: source?.host ?? null,
      kind: registered ? "OFFICIAL_RELEASE_NOTES" : "UNKNOWN", relationship: registered ? "FIRST_PARTY" : "UNKNOWN",
      checkedAt: checkedTime(finding.lastCheckedAt), publishedAt: checkedTime(finding.featureDate), usage: ["open-source", "paid-only", "free-tier-available"].includes(finding.licenseCostStatus) ? "DECLARED_ONLY" : "UNKNOWN" }],
    claims: [{ id: "finding-capability", text: statement(finding), use: "CODE_ADOPTION" }],
    evidence: [{ id: "finding-summary", claimId: "finding-capability", sourceId: "finding-source", relation: "SUPPORTS", extraction: finding.researchMode === "DEEP" ? "MODEL_SUMMARY" : "UNDECLARED", locator: null }],
  });
}

/** The default host policy recognizes registered code sources only; no license review is inferred from an open-source claim. */
export function registeredAyasFindingSourceBindings(graph: AyasSourceEvidenceGraph): readonly AyasSourceReviewBinding[] {
  return graph.sources.flatMap(source => verifyAyasTechnologySource(source.reference, anchors) === "REGISTERED_OFFICIAL"
    ? [{ sourceId: source.id, reference: source.reference, uses: ["CODE_ADOPTION" as const], publisher: describeAyasTechnologySource(source.reference)!.independenceKey, usageReviewed: false }]
    : []);
}

/** A persisted score never counts as current truth. Graph/summary/reference binding is rechecked before the contextual review. */
export function assessAyasFindingSourceTrust(finding: FindingFacts & { readonly sourceEvidence?: unknown; readonly sourceTrust?: unknown }, use: AyasSourceUse, now: string): AyasSourceTrustReport {
  const graph = finding.sourceEvidence;
  if (graph === undefined) return assessAyasSourceEvidence(undefined, use, now);
  const source = describeAyasTechnologySource(finding.sourceUrl);
  if (!isAyasSourceEvidenceGraph(graph) || !source || graph.sources.length !== 1 || graph.sources[0]!.reference !== source.url || graph.claims.length !== 1 || graph.claims[0]!.text !== statement(finding) || graph.digest !== buildAyasFindingSourceEvidence(finding).digest) {
    const result = assessAyasSourceEvidence(undefined, use, now);
    return { ...result, state: "BLOCKED", reasons: ["FINDING_GRAPH_BINDING_MISMATCH"] };
  }
  return assessAyasSourceEvidence(graph, use, now, registeredAyasFindingSourceBindings(graph));
}
