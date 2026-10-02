/** Stage 15P. External evidence is data. These reviews never grant action authority. */
import crypto from "node:crypto";
import { detectAyasResearchInstructionSignals } from "../../brain/autonomy/AyasResearchImprovementLoop";
import { ayasTechnologyCanonicalJson, ayasTechnologyIso, describeAyasTechnologySource, isAyasTechnologyDenseArray, isAyasTechnologyPlainObject } from "../technology/AyasTechnologyCandidate";

export const AYAS_SOURCE_USES = Object.freeze(["HISTORICAL_CLAIM", "CODE_ADOPTION", "SECURITY_GUIDANCE", "PLATFORM_TERMS"] as const);
export type AyasSourceUse = typeof AYAS_SOURCE_USES[number];
export const AYAS_SOURCE_KINDS = Object.freeze(["OFFICIAL_DOCUMENTATION", "OFFICIAL_RELEASE_NOTES", "SOURCE_REPOSITORY", "SECURITY_ADVISORY", "PLATFORM_TERMS", "HISTORICAL_PRIMARY", "HISTORICAL_SCHOLARSHIP", "COMMUNITY", "UNKNOWN"] as const);
export type AyasSourceKind = typeof AYAS_SOURCE_KINDS[number];
export interface AyasEvidenceSource {
  readonly id: string;
  /** Canonical public URL, or an edition/citation. Never fetched or executed. */
  readonly reference: string;
  readonly domain: string | null;
  readonly kind: AyasSourceKind;
  readonly relationship: "FIRST_PARTY" | "SECONDARY" | "COMMUNITY" | "UNKNOWN";
  readonly checkedAt: string | null;
  readonly publishedAt: string | null;
  /** A declaration in the graph; a separate review binding must confirm it. */
  readonly usage: "UNKNOWN" | "DECLARED_ONLY" | "REVIEWED_FOR_USE" | "RESTRICTED";
}
export interface AyasEvidenceClaim { readonly id: string; readonly text: string; readonly use: AyasSourceUse }
export interface AyasEvidenceLink {
  readonly id: string;
  readonly claimId: string;
  readonly sourceId: string;
  readonly relation: "SUPPORTS" | "CONTRADICTS";
  readonly extraction: "DIRECT_SOURCE" | "MODEL_SUMMARY" | "UNDECLARED";
  readonly locator: string | null;
}
export interface AyasSourceEvidenceBody {
  readonly schemaVersion: "1";
  readonly dataOnly: true;
  readonly sources: readonly AyasEvidenceSource[];
  readonly claims: readonly AyasEvidenceClaim[];
  readonly evidence: readonly AyasEvidenceLink[];
}
export interface AyasSourceEvidenceGraph extends AyasSourceEvidenceBody { readonly digest: string }
/** Host/reviewer input, supplied separately. External text cannot supply this policy. It still grants no actions. */
export interface AyasSourceReviewBinding {
  readonly sourceId: string;
  readonly reference: string;
  readonly uses: readonly AyasSourceUse[];
  /** For citations only. URL publisher grouping is derived by the existing URL primitive. */
  readonly publisher: string;
  readonly usageReviewed: boolean;
}
export type AyasSourceTrustState = "SUPPORTED_FOR_USE" | "REVIEW_REQUIRED" | "UNMEASURED" | "BLOCKED";
export interface AyasSourceObservationReview {
  readonly sourceId: string;
  readonly evidenceId: string;
  readonly identity: "BOUND_FOR_USE" | "UNVERIFIED";
  readonly freshness: "CURRENT" | "STALE" | "UNKNOWN" | "FUTURE";
  readonly checkAgeDays: number | null;
  readonly usage: AyasEvidenceSource["usage"];
  readonly usageReviewed: boolean;
  readonly extraction: AyasEvidenceLink["extraction"];
  readonly counted: boolean;
}
export interface AyasSourceClaimReview {
  readonly claimId: string;
  readonly state: AyasSourceTrustState;
  readonly corroboration: "CORROBORATED" | "SINGLE_SOURCE" | "UNMEASURED" | "CONFLICT";
  readonly independentSources: number;
  readonly sourceIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly sources: readonly AyasSourceObservationReview[];
  readonly reasons: readonly string[];
}
export interface AyasSourceTrustReport {
  readonly schemaVersion: "1";
  readonly graphDigest: string | null;
  readonly use: AyasSourceUse;
  readonly assessedAt: string;
  readonly state: AyasSourceTrustState;
  readonly reasons: readonly string[];
  readonly claims: readonly AyasSourceClaimReview[];
  readonly dataOnly: true;
  readonly authority: "NONE";
  readonly mayAdopt: false;
  readonly mayExecute: false;
  readonly mayApprove: false;
  readonly maySpend: false;
  readonly mayPublish: false;
}

/** Conservative offline review defaults; passing these checks is not fact verification or owner approval. */
export const AYAS_SOURCE_TRUST_POLICIES: Readonly<Record<AyasSourceUse, { readonly maxCheckAgeDays: number; readonly independentRequired: number; readonly kinds: readonly AyasSourceKind[] }>> = Object.freeze({
  HISTORICAL_CLAIM: Object.freeze({ maxCheckAgeDays: 365, independentRequired: 2, kinds: Object.freeze(["HISTORICAL_PRIMARY", "HISTORICAL_SCHOLARSHIP"] as const) }),
  CODE_ADOPTION: Object.freeze({ maxCheckAgeDays: 30, independentRequired: 1, kinds: Object.freeze(["OFFICIAL_DOCUMENTATION", "OFFICIAL_RELEASE_NOTES", "SOURCE_REPOSITORY"] as const) }),
  SECURITY_GUIDANCE: Object.freeze({ maxCheckAgeDays: 7, independentRequired: 1, kinds: Object.freeze(["SECURITY_ADVISORY", "OFFICIAL_DOCUMENTATION"] as const) }),
  PLATFORM_TERMS: Object.freeze({ maxCheckAgeDays: 1, independentRequired: 1, kinds: Object.freeze(["PLATFORM_TERMS"] as const) }),
});
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const hash = (value: unknown) => crypto.createHash("sha256").update(ayasTechnologyCanonicalJson(value), "utf8").digest("hex");
const keys = (value: Record<string, unknown>, names: readonly string[]) => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const id = (value: unknown): value is string => typeof value === "string" && ID.test(value);
const iso = (value: unknown) => value === null || typeof value === "string" && ayasTechnologyIso(value) === value;
const list = (value: unknown, max: number): value is unknown[] => isAyasTechnologyDenseArray(value) && value.length <= max;
const isUse = (value: unknown): value is AyasSourceUse => (AYAS_SOURCE_USES as readonly unknown[]).includes(value);
const unique = (values: readonly string[]) => [...new Set(values)].sort();

/** Closed, bounded schema, all references resolved, unique IDs and digest checked before any review. */
export function isAyasSourceEvidenceGraph(value: unknown): value is AyasSourceEvidenceGraph {
  try {
    if (!isAyasTechnologyPlainObject(value) || !keys(value, ["schemaVersion", "dataOnly", "sources", "claims", "evidence", "digest"]) || value.schemaVersion !== "1" || value.dataOnly !== true ||
      !list(value.sources, 300) || !list(value.claims, 300) || !list(value.evidence, 2000) || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest)) return false;
    const sources = new Set<string>(); const claims = new Set<string>(); const links = new Set<string>();
    for (const source of value.sources) {
      if (!isAyasTechnologyPlainObject(source) || !keys(source, ["id", "reference", "domain", "kind", "relationship", "checkedAt", "publishedAt", "usage"]) || !id(source.id) || sources.has(source.id) ||
        !text(source.reference, 1500) || !(AYAS_SOURCE_KINDS as readonly unknown[]).includes(source.kind) || !["FIRST_PARTY", "SECONDARY", "COMMUNITY", "UNKNOWN"].includes(String(source.relationship)) ||
        !["UNKNOWN", "DECLARED_ONLY", "REVIEWED_FOR_USE", "RESTRICTED"].includes(String(source.usage)) || !iso(source.checkedAt) || !iso(source.publishedAt)) return false;
      if (/^https?:/i.test(source.reference)) {
        const normalized = describeAyasTechnologySource(source.reference);
        if (!normalized || normalized.url !== source.reference || normalized.host !== source.domain) return false;
      } else if (source.domain !== null) return false;
      sources.add(source.id);
    }
    for (const claim of value.claims) {
      if (!isAyasTechnologyPlainObject(claim) || !keys(claim, ["id", "text", "use"]) || !id(claim.id) || claims.has(claim.id) || !text(claim.text, 1200) || !isUse(claim.use)) return false;
      claims.add(claim.id);
    }
    for (const link of value.evidence) {
      if (!isAyasTechnologyPlainObject(link) || !keys(link, ["id", "claimId", "sourceId", "relation", "extraction", "locator"]) || !id(link.id) || links.has(link.id) || !id(link.claimId) || !claims.has(link.claimId) || !id(link.sourceId) || !sources.has(link.sourceId) ||
        !["SUPPORTS", "CONTRADICTS"].includes(String(link.relation)) || !["DIRECT_SOURCE", "MODEL_SUMMARY", "UNDECLARED"].includes(String(link.extraction)) || !(link.locator === null || text(link.locator, 500))) return false;
      links.add(link.id);
    }
    return value.digest === hash({ schemaVersion: value.schemaVersion, dataOnly: value.dataOnly, sources: value.sources, claims: value.claims, evidence: value.evidence });
  } catch { return false; }
}
export function sealAyasSourceEvidence(body: AyasSourceEvidenceBody): AyasSourceEvidenceGraph {
  const graph = { ...body, digest: hash(body) };
  if (!isAyasSourceEvidenceGraph(graph)) throw new Error("AYAS_SOURCE_EVIDENCE_INVALID");
  return graph;
}

function validBindings(value: readonly AyasSourceReviewBinding[]): boolean {
  if (!list(value, 300)) return false;
  const seen = new Set<string>();
  return value.every(binding => {
    if (!isAyasTechnologyPlainObject(binding) || !keys(binding, ["sourceId", "reference", "uses", "publisher", "usageReviewed"]) || !id(binding.sourceId) || seen.has(binding.sourceId) ||
      !text(binding.reference, 1500) || !list(binding.uses, 4) || !binding.uses.length || !binding.uses.every(isUse) || new Set(binding.uses).size !== binding.uses.length || !text(binding.publisher, 120) || typeof binding.usageReviewed !== "boolean") return false;
    seen.add(binding.sourceId); return true;
  });
}

/** Reviews a specific use now. Never reads a stored verdict, external instructions, model confidence or a universal reputation. */
export function assessAyasSourceEvidence(graph: unknown, use: AyasSourceUse, now: string, bindings: readonly AyasSourceReviewBinding[] = []): AyasSourceTrustReport {
  const base = { schemaVersion: "1" as const, graphDigest: null as string | null, use, assessedAt: now, dataOnly: true as const, authority: "NONE" as const,
    mayAdopt: false as const, mayExecute: false as const, mayApprove: false as const, maySpend: false as const, mayPublish: false as const };
  const unavailable = (state: AyasSourceTrustState, reason: string): AyasSourceTrustReport => ({ ...base, state, reasons: [reason], claims: [] });
  if (!isUse(use) || ayasTechnologyIso(now) !== now || !validBindings(bindings)) return unavailable("BLOCKED", "REVIEW_INPUT_INVALID");
  if (graph === undefined || graph === null) return unavailable("UNMEASURED", "SOURCE_GRAPH_MISSING");
  if (!isAyasSourceEvidenceGraph(graph)) return unavailable("BLOCKED", "SOURCE_GRAPH_INVALID");
  const policy = AYAS_SOURCE_TRUST_POLICIES[use]; const nowMs = Date.parse(now);
  const selected = graph.claims.filter(claim => claim.use === use);
  if (!selected.length) return { ...unavailable("UNMEASURED", "NO_CLAIMS_FOR_USE"), graphDigest: graph.digest };
  const claims: AyasSourceClaimReview[] = selected.map(claim => {
    const evidence = graph.evidence.filter(link => link.claimId === claim.id); const reasons: string[] = []; const publishers = new Set<string>(); const sources: AyasSourceObservationReview[] = [];
    const conflict = evidence.some(link => link.relation === "CONTRADICTS");
    const restricted = evidence.some(link => graph.sources.find(source => source.id === link.sourceId)!.usage === "RESTRICTED");
    const directive = detectAyasResearchInstructionSignals(claim.text).some(signal => signal !== "PATH_REFERENCE");
    if (conflict) reasons.push("CLAIM_CONFLICT");
    if (restricted) reasons.push("LINKED_USAGE_RESTRICTED");
    if (directive) reasons.push("EXTERNAL_INSTRUCTION_SIGNAL");
    for (const link of evidence) {
      const source = graph.sources.find(candidate => candidate.id === link.sourceId)!;
      const binding = bindings.find(candidate => candidate.sourceId === source.id && candidate.reference === source.reference && candidate.uses.includes(use));
      const rejected: string[] = [];
      let freshness: AyasSourceObservationReview["freshness"] = "UNKNOWN"; let checkAgeDays: number | null = null;
      if (!binding) rejected.push("IDENTITY_UNVERIFIED_FOR_USE");
      if (!policy.kinds.includes(source.kind) || (use !== "HISTORICAL_CLAIM" ? source.relationship !== "FIRST_PARTY" : !["FIRST_PARTY", "SECONDARY"].includes(source.relationship))) rejected.push("SOURCE_USE_MISMATCH");
      if (link.extraction !== "DIRECT_SOURCE") rejected.push("NOT_DIRECT_EVIDENCE");
      if (source.checkedAt === null) rejected.push("FRESHNESS_UNKNOWN");
      else { const age = nowMs - Date.parse(source.checkedAt); const expired = age > policy.maxCheckAgeDays * 86_400_000; checkAgeDays = Math.round(age / 86_400_000 * 100) / 100;
        freshness = age < 0 ? "FUTURE" : expired ? "STALE" : "CURRENT";
        if (age < 0) rejected.push("FUTURE_CHECK"); else if (expired) rejected.push("STALE_SOURCE"); }
      if (source.publishedAt !== null && Date.parse(source.publishedAt) > nowMs) { freshness = "FUTURE"; rejected.push("FUTURE_PUBLICATION"); }
      if (source.usage !== "REVIEWED_FOR_USE" || !binding?.usageReviewed) rejected.push(source.usage === "RESTRICTED" ? "USAGE_RESTRICTED" : "USAGE_NOT_REVIEWED");
      for (const reason of rejected) reasons.push(`${reason}:${source.id}`);
      if (rejected.length === 0 && link.relation === "SUPPORTS") publishers.add(describeAyasTechnologySource(source.reference)?.independenceKey ?? binding!.publisher);
      sources.push({ sourceId: source.id, evidenceId: link.id, identity: binding ? "BOUND_FOR_USE" : "UNVERIFIED", freshness, checkAgeDays,
        usage: source.usage, usageReviewed: binding?.usageReviewed === true, extraction: link.extraction, counted: rejected.length === 0 && link.relation === "SUPPORTS" });
    }
    if (!evidence.length) reasons.push("NO_EVIDENCE");
    if (publishers.size < policy.independentRequired) reasons.push("CORROBORATION_INSUFFICIENT");
    const state: AyasSourceTrustState = conflict || restricted || directive ? "BLOCKED" : publishers.size >= policy.independentRequired ? "SUPPORTED_FOR_USE" : !evidence.length ? "UNMEASURED" : "REVIEW_REQUIRED";
    return { claimId: claim.id, state, corroboration: conflict ? "CONFLICT" : publishers.size >= 2 ? "CORROBORATED" : publishers.size === 1 ? "SINGLE_SOURCE" : "UNMEASURED",
      independentSources: publishers.size, sourceIds: unique(evidence.map(link => link.sourceId)), evidenceIds: unique(evidence.map(link => link.id)), sources, reasons: unique(reasons) };
  });
  const state: AyasSourceTrustState = claims.some(claim => claim.state === "BLOCKED") ? "BLOCKED" : claims.every(claim => claim.state === "SUPPORTED_FOR_USE") ? "SUPPORTED_FOR_USE" : claims.every(claim => claim.state === "UNMEASURED") ? "UNMEASURED" : "REVIEW_REQUIRED";
  return { ...base, graphDigest: graph.digest, state, claims, reasons: unique(claims.flatMap(claim => claim.reasons)) };
}
