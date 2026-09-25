import crypto from "node:crypto";

import { AYAS_CAPABILITY_CATEGORY_RELATED_PATHS } from "../../brain/autonomy/AyasCapabilityTaxonomy";
import { detectAyasResearchInstructionSignals } from "../../brain/autonomy/AyasResearchImprovementLoop";
import { redactAyasHandoffText, type AyasContextItem } from "../developer/AyasDeveloperHandoff";
import {
  appendAyasEvolutionOpportunity, isAyasEvolutionBlockingIssue, normalizeAyasEvolutionOpportunity,
  type AyasEvolutionAuthorityClass, type AyasEvolutionCapabilityClass, type AyasEvolutionOpportunity, type AyasEvolutionOpportunityInput,
  type AyasEvolutionRegister, type AyasEvolutionResourceKind, type AyasEvolutionSideEffect,
} from "../evolution/AyasEvolutionOpportunity";
import { qualifyAyasEvolutionOpportunity, type AyasEvolutionEnvironment, type AyasEvolutionQualification } from "../evolution/AyasEvolutionQualification";
import {
  AYAS_TECHNOLOGY_LOCAL_DELIVERIES, AyasTechnologyError, assertAyasTechnologyRegister, ayasTechnologyCanonicalJson, ayasTechnologyIso,
  computeAyasTechnologyMaterialFingerprint, describeAyasTechnologySource, ingestAyasTechnologyObservation, isAyasTechnologyPlainObject, normalizeAyasTechnologyObservation,
  type AyasTechnologyClaim, type AyasTechnologyDelivery, type AyasTechnologyEvidence, type AyasTechnologyObservation, type AyasTechnologyRegister,
} from "./AyasTechnologyCandidate";
import {
  assertAyasTechnologyEnvironment, assessAyasTechnologyRegister, ayasTechnologyRegisterRelations, isAyasTechnologyAssessmentProduced,
  type AyasTechnologyAssessment, type AyasTechnologyWatchEnvironment,
} from "./AyasTechnologyWatch";

/**
 * Stage 14 → existing paths. Nothing here fetches, writes, installs,
 * dispatches, approves or spends.
 *
 * - Stage 8: a recorded research finding may become ONE observation, after
 *   provenance validation. It never becomes a candidate by itself being
 *   stored, and its model-summarized parts are hypotheses, not source claims.
 * - Stage 13: a HANDOFF_ELIGIBLE technology becomes an ordinary Stage 13
 *   opportunity INPUT with origin RESEARCH_LOOP (hardcoded) and research
 *   evidence. No lifecycle, issue, signal, id, approval or authority field is
 *   ever supplied: Stage 13 derives evidence class, readiness, risk, cost and
 *   required authority itself and stays authoritative.
 * - Stage 10: bounded advisory context lines for a developer task packet.
 */
export const AYAS_TECHNOLOGY_HANDOFF_ORIGIN = "RESEARCH_LOOP" as const;

type Obj = Record<string, unknown>;
const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const uniqueSorted = <T extends string>(values: Iterable<T>): T[] => [...new Set(values)].sort();
const RESEARCH_FINDING_ID = /^ayas-research-[0-9a-f-]{36}$/i;
const CODE_HOSTS: ReadonlySet<string> = new Set(["github.com", "gitlab.com", "codeberg.org", "bitbucket.org"]);

// ---------------------------------------------------------------- Stage 8 → observation

export type AyasTechnologyFindingExtraction =
  | { readonly status: "EXTRACTED"; readonly observation: AyasTechnologyObservation }
  | { readonly status: "NOT_EXTRACTED"; readonly reasonCode: "FINDING_MALFORMED" | "FINDING_ID_INVALID" | "UNTRUSTED_BOUNDARY_NOT_ACKNOWLEDGED" | "FINDING_TIME_INVALID" | "SOURCE_URL_INVALID" | "IDENTITY_INVALID" };

const LICENSE_COST_STATUS = ["free-tier-available", "paid-only", "open-source", "unknown"];
const CONFIDENCE = ["high", "medium", "low"];

/**
 * Provenance first: a finding without a valid recorded id, a real http(s)
 * source (no embedded credential), valid times and the explicit untrusted-
 * content acknowledgement is not extracted. Only the fetch itself (the source
 * existed) is a direct claim; the capability, price and licence are the Stage
 * 8 model's reading of the source, so they are MODEL_SUMMARY hypotheses —
 * a "paid" verdict still restricts, a "free" one never resolves the cost.
 * Stage 8's own gap verdict is not used: coverage comes from local facts.
 * Identity anchors are taken from the source only when it is an official one.
 */
export function extractAyasTechnologyObservationFromFinding(finding: unknown): AyasTechnologyFindingExtraction {
  const refuse = (reasonCode: Extract<AyasTechnologyFindingExtraction, { status: "NOT_EXTRACTED" }>["reasonCode"]): AyasTechnologyFindingExtraction => ({ status: "NOT_EXTRACTED", reasonCode });
  if (!isAyasTechnologyPlainObject(finding)) return refuse("FINDING_MALFORMED");
  const f = finding;
  if (typeof f.findingId !== "string" || !RESEARCH_FINDING_ID.test(f.findingId)) return refuse("FINDING_ID_INVALID");
  if (f.treatedSourceAsUntrusted !== true) return refuse("UNTRUSTED_BOUNDARY_NOT_ACKNOWLEDGED");
  const strings = [f.capability, f.problemSolved, f.licenseCostNotes ?? "", f.atolyeGapNotes ?? ""];
  if (typeof f.provider !== "string" || !f.provider.trim() || !strings.every((value) => typeof value === "string") || typeof f.isOfficialSource !== "boolean"
    || !LICENSE_COST_STATUS.includes(String(f.licenseCostStatus)) || !CONFIDENCE.includes(String(f.confidence)) || (f.category !== undefined && typeof f.category !== "string")) return refuse("FINDING_MALFORMED");
  const lastCheckedAt = ayasTechnologyIso(f.lastCheckedAt);
  const featureDate = f.featureDate === undefined || f.featureDate === null ? null : ayasTechnologyIso(f.featureDate);
  if (lastCheckedAt === null || (f.featureDate !== undefined && f.featureDate !== null && featureDate === null)) return refuse("FINDING_TIME_INVALID");
  const source = describeAyasTechnologySource(f.sourceUrl);
  if (!source) return refuse("SOURCE_URL_INVALID");
  const official = f.isOfficialSource === true;
  const segments = source.path.split("/").filter(Boolean);
  const provider = f.provider as string;
  const identity: Obj = official && CODE_HOSTS.has(source.host) && segments.length >= 2
    ? { name: segments[1], vendor: provider, repository: `https://${source.host}/${segments[0]}/${segments[1]}` }
    : official ? { name: provider, homepage: `https://${source.host}` } : { name: provider };
  const findingId = (f.findingId as string).toLowerCase();
  // The finding's own wording is scanned like any other external text; notes are scanned too, and carried only when they are directive-shaped.
  const noteSignals = [...detectAyasResearchInstructionSignals(String(f.licenseCostNotes ?? "")), ...detectAyasResearchInstructionSignals(String(f.atolyeGapNotes ?? "")).filter((signal) => signal !== "PATH_REFERENCE")];
  const statement = `${f.capability as string}: ${f.problemSolved as string}${noteSignals.length > 0 ? ` | ${String(f.licenseCostNotes ?? "")} | ${String(f.atolyeGapNotes ?? "")}` : ""}`;
  const sourceRef = { url: source.url, sourceClass: official ? "OFFICIAL_RELEASE_NOTES" : "UNKNOWN_SOURCE", publishedAt: featureDate };
  const summary = (claim: Obj, text = "Stage 8 model summary of the source") => ({ source: sourceRef, extraction: "MODEL_SUMMARY", claim, statement: text, researchFindingId: findingId });
  const evidence: Obj[] = [{ source: sourceRef, extraction: "DIRECT_SOURCE", claim: { kind: "EXISTS" }, statement: typeof f.category === "string" && f.category ? "Stage 8 fetched and recorded this source" : statement, researchFindingId: findingId }];
  if (typeof f.category === "string" && f.category) evidence.push(summary({ kind: "CAPABILITY", domain: f.category }, statement));
  if (f.licenseCostStatus === "paid-only") evidence.push(summary({ kind: "PRICING", model: "PAID", requirements: [] }));
  if (f.licenseCostStatus === "free-tier-available") evidence.push(summary({ kind: "PRICING", model: "FREE_TIER", requirements: [] }));
  if (f.licenseCostStatus === "open-source") {
    evidence.push(summary({ kind: "PRICING", model: "OPEN_SOURCE_SELF_HOSTED", requirements: [] }));
    evidence.push(summary({ kind: "LICENSE", licenseClass: "OPEN_SOURCE_UNSPECIFIED", identifier: null }));
  }
  try {
    return { status: "EXTRACTED", observation: normalizeAyasTechnologyObservation({ observedAt: lastCheckedAt, identity, evidence }, "RESEARCH_FINDING") };
  } catch (error) {
    if (error instanceof AyasTechnologyError) return refuse("IDENTITY_INVALID");
    throw error;
  }
}

// ---------------------------------------------------------------- Stage 13 hand-off

export interface AyasTechnologyEvolutionHandoff {
  readonly technologyKey: string;
  readonly materialFingerprint: string;
  /** A fresh Stage 13 producer input: no lifecycle, id, issues, signals, approval or authority. */
  readonly input: AyasEvolutionOpportunityInput;
  /** Digest of `input`; submission refuses an edited hand-off. */
  readonly inputDigest: string;
  /** Stage 13's own normalization of `input`, for display. Submission re-normalizes and never trusts this copy. */
  readonly opportunity: AyasEvolutionOpportunity;
  readonly executionAuthority: "NONE";
  readonly authority: "NONE";
}

const HANDOFF_INPUT_FIELDS: readonly string[] = ["schemaVersion", "createdAt", "origin", "kind", "need", "evidence", "target", "prerequisites", "constraints", "impact", "requiredAuthority"];
const STAGE13_EVIDENCE_LIMIT = 24;
const DELIVERY_CLASS: Readonly<Record<AyasTechnologyDelivery, AyasEvolutionCapabilityClass>> = Object.freeze({
  HOSTED_API: "SERVICE_INTEGRATION", PACKAGE_LIBRARY: "LIBRARY", MODEL_WEIGHTS: "MODEL", HOST_BINARY: "TOOL", CONTAINER_IMAGE: "TOOL", MCP_SERVER: "TOOL",
  EDITOR_EXTENSION: "TOOL", BROWSER_EXTENSION: "TOOL", AGENT_SKILL: "SKILL", SPECIFICATION_ONLY: "PIPELINE_EXTENSION", UNKNOWN: "UNKNOWN",
});
const PROCESS_DELIVERIES: ReadonlySet<AyasTechnologyDelivery> = new Set(["HOST_BINARY", "CONTAINER_IMAGE", "MCP_SERVER"]);

/** A server-owned one-line description of a claim: kinds, closed values and bounded versions only, never source wording. */
function describeClaim(claim: AyasTechnologyClaim): string {
  switch (claim.kind) {
    case "RELEASE": return `release ${claim.version}`;
    case "WITHDRAWN": return `withdrawal of ${claim.version ?? "the technology"}`;
    case "CAPABILITY": return `capability ${claim.domain ?? claim.unknownDomain ?? claim.capabilityKey}`;
    case "DELIVERY": return `delivery ${claim.delivery}`;
    case "REQUIREMENT": return `requirement ${claim.requirement} ${claim.present ? "present" : "absent"}`;
    case "PRICING": return `pricing ${claim.model}${claim.requirements.length ? ` with ${claim.requirements.join("+")}` : ""}`;
    case "LICENSE": return `licence ${claim.licenseClass}`;
    case "PROVENANCE": return `provenance ${claim.status}`;
    case "MAINTENANCE": return `maintenance ${claim.status}`;
    case "SECURITY_ADVISORY": return `security advisory ${claim.severity}${claim.fixedInVersion ? ` fixed in ${claim.fixedInVersion}` : ""}`;
    case "COMPROMISE": return `compromise of ${claim.version ?? "all releases"}`;
    case "EXISTS": return "existence";
  }
}

const isSecurityEvidence = (e: AyasTechnologyEvidence) => e.claim.kind === "SECURITY_ADVISORY" || e.claim.kind === "COMPROMISE";

/**
 * Builds the Stage 13 input for a technology the watch found eligible, or
 * `null`. Only an assessment this engine produced, for the current facts, of
 * a candidate that carries no issue or directive, whose relation is a genuine
 * gap or a complement, qualifies. A possible replacement is never handed off
 * automatically. The record is a research claim by construction, so Stage 13
 * will normally ask for local corroboration first.
 */
export function buildAyasTechnologyEvolutionHandoff(register: AyasTechnologyRegister, assessment: AyasTechnologyAssessment): AyasTechnologyEvolutionHandoff | null {
  const checked = assertAyasTechnologyRegister(register);
  if (!isAyasTechnologyAssessmentProduced(assessment)) return null;
  const candidate = checked.candidates.find((c) => c.technologyKey === assessment.technologyKey);
  if (!candidate) return null;
  if (!assessment.handoffEligible || assessment.readiness !== "HANDOFF_ELIGIBLE" || assessment.suppression.state !== "NONE" || assessment.executionAuthority !== "NONE") return null;
  if (computeAyasTechnologyMaterialFingerprint(candidate) !== assessment.materialFingerprint) return null;
  if (candidate.instructionSignals.length > 0 || candidate.issues.length > 0) return null;
  // Defense in depth, from the register passed in (never from the assessment alone): a record in identity conflict or
  // duplicating another is never handed off, even with an assessment made before the other record arrived.
  const relations = ayasTechnologyRegisterRelations(checked, candidate.technologyKey);
  if (relations.identityConflicts.length > 0 || relations.duplicateOf !== null || assessment.novelty.identityConflicts.length > 0 || assessment.novelty.duplicateOf !== null) return null;
  const relation = assessment.capability.relation;
  if (relation !== "GENUINE_GAP" && relation !== "COMPLEMENTARY") return null;

  // Security evidence is never the part that gets cut: if it does not all fit, there is no hand-off.
  const security = candidate.evidence.filter(isSecurityEvidence);
  if (security.length > STAGE13_EVIDENCE_LIMIT) return null;
  const others = candidate.evidence.filter((e) => !isSecurityEvidence(e)).sort((a, b) => b.lastObservedAt.localeCompare(a.lastObservedAt) || a.evidenceId.localeCompare(b.evidenceId));
  const selected = [...security, ...others].slice(0, STAGE13_EVIDENCE_LIMIT);

  const identity = candidate.identity;
  const deliveries = assessment.compatibility.deliveries;
  const requirements = assessment.compatibility.requirements;
  const cost = assessment.cost;
  const classes = uniqueSorted(deliveries.map((delivery) => DELIVERY_CLASS[delivery]));
  // More than one way to consume it is an ambiguous class: Stage 13's explicit UNKNOWN (the union of every requirement), never OTHER.
  const capabilityClass: AyasEvolutionCapabilityClass = classes.length === 1 ? classes[0]! : "UNKNOWN";
  const local = deliveries.some((delivery) => AYAS_TECHNOLOGY_LOCAL_DELIVERIES.has(delivery));
  const hosted = deliveries.includes("HOSTED_API");
  const knownNonZero = cost.costClass !== "unknown-cost" && !cost.decision.allowed;
  const effects = new Set<AyasEvolutionSideEffect>();
  if (local) effects.add("INSTALLS_DEPENDENCY");
  if (deliveries.some((delivery) => PROCESS_DELIVERIES.has(delivery))) effects.add("SPAWNS_PROCESS");
  if (requirements.NETWORK_REQUIRED === "PRESENT") effects.add("NETWORK_READ");
  if (requirements.SENDS_DATA_EXTERNALLY === "PRESENT") effects.add("NETWORK_WRITE");
  if (knownNonZero) effects.add("SPENDS_MONEY");
  if (deliveries.includes("UNKNOWN") || requirements.NETWORK_REQUIRED === "UNKNOWN" || requirements.SENDS_DATA_EXTERNALLY === "UNKNOWN") effects.add("UNKNOWN");
  const resources: { kind: AyasEvolutionResourceKind; costClass: string; key?: string }[] = [];
  const addResource = (kind: AyasEvolutionResourceKind, key?: string) => { if (!resources.some((r) => r.kind === kind && r.key === key)) resources.push({ kind, costClass: cost.costClass, ...(key ? { key } : {}) }); };
  if (hosted) addResource(cost.decision.allowed ? "NETWORK_REQUIRED" : "PAID_API");
  if (requirements.EXTERNAL_ACCOUNT === "PRESENT" || requirements.SECRET_OR_API_KEY === "PRESENT") addResource("EXTERNAL_ACCOUNT");
  if (deliveries.includes("MODEL_WEIGHTS")) { addResource("LOCAL_MODEL_WEIGHTS"); addResource("DISK_SPACE"); }
  if (deliveries.includes("HOST_BINARY")) addResource("HOST_BINARY", identity.nameSlug);
  if (deliveries.includes("CONTAINER_IMAGE")) addResource("HOST_BINARY", "container-runtime");
  if (deliveries.some((delivery) => ["PACKAGE_LIBRARY", "MCP_SERVER", "EDITOR_EXTENSION", "BROWSER_EXTENSION", "AGENT_SKILL", "SPECIFICATION_ONLY"].includes(delivery))) addResource("FREE_LOCAL");
  if (requirements.GPU === "PRESENT") addResource("GPU_REQUIRED");
  if (deliveries.includes("UNKNOWN")) addResource("UNKNOWN");
  const prerequisites = uniqueSorted(assessment.prerequisites.map((p) => `${p.kind}\u0000${p.key}`)).map((entry) => { const [kind, key] = entry.split("\u0000"); return { kind: kind!, key: key!, optional: false }; });
  const required = new Set<AyasEvolutionAuthorityClass>();
  if (local) required.add("DEPENDENCY_INSTALL_APPROVAL");
  if (hosted || requirements.NETWORK_REQUIRED === "PRESENT") required.add("EXTERNAL_SERVICE_APPROVAL");
  if (!cost.decision.allowed) required.add("PAID_PROVIDER_APPROVAL");
  const domains = assessment.capability.corroboratedDomains;
  // When the current set of claims was complete: re-observing unchanged facts keeps Stage 13's deterministic id.
  const createdAt = candidate.evidence.reduce((latest, e) => e.firstObservedAt > latest ? e.firstObservedAt : latest, candidate.createdAt);
  const slug = identity.nameSlug.slice(0, 32).replace(/-+$/, "");
  const category = identity.category.toLowerCase().replace(/_/g, "-");
  const input: AyasEvolutionOpportunityInput = {
    schemaVersion: "1",
    createdAt,
    origin: AYAS_TECHNOLOGY_HANDOFF_ORIGIN,
    kind: relation === "GENUINE_GAP" ? "NEW_CAPABILITY" : "EXTENSION",
    need: {
      summary: `Technology watch candidate ${candidate.technologyKey} (${identity.displayName}, ${identity.category}) may add ${domains.join(", ") || "an unmapped capability"}.`,
      affectedCapabilityKeys: [],
      consequences: [],
    },
    evidence: selected.map((e) => ({
      source: isSecurityEvidence(e) ? "SECURITY_FINDING" : "RESEARCH_RESULT",
      reference: `technology-source:${e.evidenceId}`,
      observedAt: e.lastObservedAt,
      statement: `A ${e.source.sourceClass} source (${e.extraction}) reports ${describeClaim(e.claim)} for ${candidate.technologyKey}.`,
      ...(e.researchFindingId ? { researchFindingId: e.researchFindingId } : {}),
    })),
    target: {
      capability: {
        key: `tech.${slug}-${candidate.technologyKey.slice(10, 16)}`, domain: `technology.${category}`, knownCategory: domains[0] ?? null, capabilityClass,
        inputs: [], outputs: [], sideEffects: effects.size > 0 ? uniqueSorted(effects) : ["NONE"], resources, trustLevel: "THIRD_PARTY",
      },
      intendedOutcome: `Evaluate whether ${identity.displayName} could provide ${domains.join(", ") || "its claimed capability"} for AYAS; this record implies no adoption.`,
      nonGoals: ["No installation, enablement, account, purchase or integration is implied by this record"],
    },
    prerequisites,
    constraints: requirements.NETWORK_REQUIRED === "PRESENT" ? [{ kind: "INVALID_OFFLINE" }] : [],
    impact: { affectedModules: uniqueSorted(domains.flatMap((domain) => AYAS_CAPABILITY_CATEGORY_RELATED_PATHS[domain])).slice(0, 40), affectedFlows: [], compatibility: "UNKNOWN" },
    requiredAuthority: uniqueSorted(required),
  };
  let opportunity: AyasEvolutionOpportunity;
  try { opportunity = normalizeAyasEvolutionOpportunity(input); } catch { return null; }
  if (opportunity.normalizationIssues.some(isAyasEvolutionBlockingIssue) || opportunity.instructionSignals.length > 0) return null;
  return Object.freeze({
    technologyKey: candidate.technologyKey, materialFingerprint: assessment.materialFingerprint, input, inputDigest: sha256(ayasTechnologyCanonicalJson(input)),
    opportunity, executionAuthority: "NONE" as const, authority: "NONE" as const,
  });
}

export interface AyasTechnologyHandoffSubmission {
  readonly register: AyasEvolutionRegister;
  readonly qualification: AyasEvolutionQualification;
  readonly opportunityId: string;
  readonly appended: boolean;
}

/**
 * Appends the hand-off to a Stage 13 register through Stage 13's own API and
 * returns Stage 13's qualification, which is authoritative. An edited
 * hand-off, one that names a lifecycle, id, approval or authority, or one
 * whose origin is not RESEARCH_LOOP, is refused. Submitting the same facts
 * twice appends nothing. The result is still a register value: nothing is
 * persisted, proposed or executed here.
 */
export function submitAyasTechnologyHandoff(evolutionRegister: AyasEvolutionRegister, handoff: AyasTechnologyEvolutionHandoff, env: AyasEvolutionEnvironment): AyasTechnologyHandoffSubmission {
  const refuse = (reason: string): never => { throw new AyasTechnologyError("AYAS_TECHNOLOGY_HANDOFF_REFUSED", reason); };
  const h: unknown = handoff;
  if (!isAyasTechnologyPlainObject(h) || h.executionAuthority !== "NONE" || h.authority !== "NONE") return refuse("a hand-off carries no authority");
  const input = h.input;
  if (!isAyasTechnologyPlainObject(input) || Object.keys(input).some((field) => !HANDOFF_INPUT_FIELDS.includes(field))) return refuse("a hand-off input may not name a lifecycle, id, issue, signal, approval or authority");
  if (input.origin !== AYAS_TECHNOLOGY_HANDOFF_ORIGIN) refuse("a technology-watch hand-off always has the research-loop origin");
  if (sha256(ayasTechnologyCanonicalJson(input)) !== h.inputDigest) refuse("the hand-off was edited after it was built");
  const opportunity = normalizeAyasEvolutionOpportunity(input as AyasEvolutionOpportunityInput);
  if (opportunity.normalizationIssues.some(isAyasEvolutionBlockingIssue) || opportunity.instructionSignals.length > 0) refuse("Stage 13 normalization found a blocking issue");
  if (!isAyasTechnologyPlainObject(h.opportunity) || h.opportunity.opportunityId !== opportunity.opportunityId) refuse("the hand-off does not describe its own input");
  const target: unknown = evolutionRegister;
  if (!isAyasTechnologyPlainObject(target) || !Array.isArray(target.opportunities)) refuse("the Stage 13 register is malformed");
  const exists = evolutionRegister.opportunities.some((item) => item.opportunityId === opportunity.opportunityId);
  const register = exists ? evolutionRegister : appendAyasEvolutionOpportunity(evolutionRegister, opportunity);
  return { register, qualification: qualifyAyasEvolutionOpportunity(opportunity.opportunityId, register, env), opportunityId: opportunity.opportunityId, appended: !exists };
}

// ---------------------------------------------------------------- Stage 10 context

/**
 * Advisory context for a Stage 10 task packet: a discovered tool, library or
 * skill may be described as relevant, never installed, enabled or dispatched.
 * A blocked candidate (directive-shaped or corrupted data) contributes nothing.
 */
export function buildAyasTechnologyDeveloperContext(assessment: AyasTechnologyAssessment): readonly AyasContextItem[] {
  if (!isAyasTechnologyAssessmentProduced(assessment) || assessment.readiness === "BLOCKED") return [];
  const text = redactAyasHandoffText(`Technology watch ${assessment.technologyKey} (advisory; not installed): ${assessment.identity.displayName} [${assessment.identity.category}, delivery ${assessment.compatibility.deliveries.join("+")}] — ${assessment.recommendation} (${assessment.primaryReason}). AYAS has no authority to install, enable, dispatch or spend; any adoption goes through the owner-controlled Stage 9 review and Stage 13.`, 600);
  return Object.freeze([Object.freeze({ id: `technology-watch:${assessment.technologyKey}`, kind: "investigation" as const, text, at: assessment.assessedAt })]);
}

// ---------------------------------------------------------------- one bounded watch cycle

export interface AyasTechnologyWatchCycleInput {
  readonly register: AyasTechnologyRegister;
  /** Stage 8 `AyasExternalResearchStore.list()` records (or any untrusted equivalent). */
  readonly findings: readonly unknown[];
  readonly env: AyasTechnologyWatchEnvironment;
  /** Findings processed this cycle (extracted or refused); the rest wait for the next cycle. Default 20, at most 200. */
  readonly limit?: number;
}

export interface AyasTechnologyWatchCycleResult {
  readonly register: AyasTechnologyRegister;
  readonly extracted: number;
  readonly refused: readonly { readonly index: number; readonly findingId: string | null; readonly reasonCode: string }[];
  readonly skipped: number;
  readonly deferred: number;
  readonly assessments: readonly AyasTechnologyAssessment[];
  /** Built, never submitted: submission to Stage 13 is a separate, explicit call. */
  readonly handoffs: readonly AyasTechnologyEvolutionHandoff[];
  readonly executionAuthority: "NONE";
}

/**
 * One bounded, restart-safe, pure watch pass over Stage 8 research findings.
 * It is the integration boundary the existing discovery daemon would call
 * after its Stage 8 cycle; it creates no scheduler of its own. A finding
 * already represented in the register is skipped, so a repeated cycle adds
 * nothing.
 */
export function runAyasTechnologyWatchCycle(input: AyasTechnologyWatchCycleInput): AyasTechnologyWatchCycleResult {
  if (!isAyasTechnologyPlainObject(input)) throw new AyasTechnologyError("AYAS_TECHNOLOGY_INVALID_OBSERVATION", "cycle input must be an object");
  assertAyasTechnologyEnvironment(input.env);
  let register = assertAyasTechnologyRegister(input.register);
  if (!Array.isArray(input.findings)) throw new AyasTechnologyError("AYAS_TECHNOLOGY_INVALID_OBSERVATION", "findings must be an array");
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 200) throw new AyasTechnologyError("AYAS_TECHNOLOGY_INVALID_OBSERVATION", "limit must be an integer between 0 and 200");
  const known = new Set(register.candidates.flatMap((candidate) => candidate.evidence.flatMap((e) => e.researchFindingId ? [e.researchFindingId] : [])));
  const refused: { index: number; findingId: string | null; reasonCode: string }[] = [];
  let processed = 0; let extracted = 0; let skipped = 0; let deferred = 0;
  // An index loop, not forEach: a hole in the list is a malformed finding to count, never a slot to skip.
  for (let index = 0; index < input.findings.length; index += 1) {
    const finding: unknown = input.findings[index];
    const raw = isAyasTechnologyPlainObject(finding) && typeof finding.findingId === "string" ? finding.findingId.toLowerCase() : null;
    const findingId = raw !== null && RESEARCH_FINDING_ID.test(raw) ? raw : null;
    if (findingId !== null && known.has(findingId)) { skipped += 1; continue; }
    if (processed >= limit) { deferred += 1; continue; }
    processed += 1;
    const result = extractAyasTechnologyObservationFromFinding(finding);
    if (result.status === "NOT_EXTRACTED") { refused.push({ index, findingId, reasonCode: result.reasonCode }); continue; }
    try {
      register = ingestAyasTechnologyObservation(register, result.observation).register;
      extracted += 1;
      if (findingId !== null) known.add(findingId);
    } catch (error) {
      if (!(error instanceof AyasTechnologyError)) throw error;
      refused.push({ index, findingId, reasonCode: error.code });
    }
  }
  const assessments = assessAyasTechnologyRegister(register, input.env);
  const handoffs = assessments.filter((a) => a.handoffEligible).flatMap((a) => { const handoff = buildAyasTechnologyEvolutionHandoff(register, a); return handoff ? [handoff] : []; });
  return Object.freeze({ register, extracted, refused: Object.freeze(refused), skipped, deferred, assessments, handoffs: Object.freeze(handoffs), executionAuthority: "NONE" as const });
}
