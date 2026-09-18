import { AYAS_CAPABILITY_CATEGORY_RELATED_PATHS, type AyasCapabilityCategory } from "./AyasCapabilityTaxonomy";

/**
 * AYAS EXTERNAL RESEARCH INTELLIGENCE sprint — the step that stops research
 * from treating every release note as a development opportunity.
 *
 * A finding that survives the DEEP scan's "is this noteworthy at all?"
 * judgment still has to answer a second, different question: what should
 * AYAS actually DO about it? Most genuinely-noteworthy external news is
 * still just news — worth knowing, not worth changing this repository over.
 * Collapsing those two questions into one boolean is what turns a research
 * feed into proposal spam.
 *
 * The disposition is computed DETERMINISTICALLY from facts that are already
 * structured and already corroborated — the taxonomy category, the model's
 * schema-validated gap/confidence/licensing enums, and whether the category
 * even maps to a module that exists on disk. It is never read out of the
 * external text, and never taken as a free-text verdict from the model,
 * because either of those would let a source argue its own importance. The
 * model describes; this module decides.
 *
 * Crucially, the strongest disposition this can produce is
 * `ACTIONABLE_PROPOSAL_CANDIDATE` — a CANDIDATE. It authorizes nothing. It
 * is an input to the existing discovery → proposal → safety-classification
 * → owner-approval → GuardedPublication path, which is unchanged and still
 * the only way anything reaches source code.
 */
export const AYAS_RESEARCH_DISPOSITIONS = ["INFORMATIONAL", "WATCH", "POTENTIAL_IMPROVEMENT", "ACTIONABLE_PROPOSAL_CANDIDATE"] as const;

export type AyasResearchDisposition = typeof AYAS_RESEARCH_DISPOSITIONS[number];

export function isAyasResearchDisposition(value: string): value is AyasResearchDisposition {
  return (AYAS_RESEARCH_DISPOSITIONS as readonly string[]).includes(value);
}

export interface AyasResearchDispositionInput {
  /** The taxonomy category, or `null` when the finding could not be categorized at all. */
  readonly category: AyasCapabilityCategory | null;
  /** Post-corroboration gap status (i.e. after `corroborateAyasGapClaim` has already downgraded any unsupported claim). */
  readonly atolyeGapStatus: "already-supported" | "partially-supported" | "missing";
  readonly confidence: "high" | "medium" | "low";
  readonly licenseCostStatus: "free-tier-available" | "paid-only" | "open-source" | "unknown";
  /** Whether the source is first-party/official. A capability claim sourced from somewhere unofficial never reaches the actionable tier. */
  readonly isOfficialSource: boolean;
  /** True when this exact item was already evaluated before and nothing material changed — a re-seen item is never re-proposed. */
  readonly previouslyEvaluated?: boolean;
}

export interface AyasResearchDispositionResult {
  readonly disposition: AyasResearchDisposition;
  /** A short, stable reason code — for the human reading Gelişim Merkezi, and for a test to assert on without matching prose. */
  readonly reasonCode: string;
}

/**
 * Deliberately conservative: a finding has to clear EVERY bar to become an
 * actionable candidate, and anything that falls short degrades to a weaker
 * disposition rather than being discarded. Nothing here is ever discarded
 * for being uninteresting — an INFORMATIONAL finding is still recorded, so
 * the owner can see what AYAS saw and disagree with this ranking.
 */
export function classifyAyasResearchDisposition(input: AyasResearchDispositionInput): AyasResearchDispositionResult {
  // An item AYAS already looked at and already judged does not get a second
  // bite purely because a scan ran again. Only a materially changed version
  // reopens evaluation, and that arrives as a NEW item, not this one.
  if (input.previouslyEvaluated === true) {
    return { disposition: "INFORMATIONAL", reasonCode: "ALREADY_EVALUATED" };
  }

  // Uncategorizable means AYAS cannot say which part of itself this would
  // even touch. That is a thing to know, never a thing to act on.
  if (input.category === null) {
    return { disposition: "INFORMATIONAL", reasonCode: "NO_CATEGORY" };
  }

  // Something Atölye/AYAS already fully supports is, by definition, not a
  // gap. It stays on the record as context, not as work.
  if (input.atolyeGapStatus === "already-supported") {
    return { disposition: "INFORMATIONAL", reasonCode: "CAPABILITY_ALREADY_SUPPORTED" };
  }

  // Low confidence means the evidence itself was thin. Watch it; do not
  // build on it.
  if (input.confidence === "low") {
    return { disposition: "WATCH", reasonCode: "LOW_CONFIDENCE_EVIDENCE" };
  }

  // An unofficial source can inform a watch item, never a change proposal.
  if (!input.isOfficialSource) {
    return { disposition: "WATCH", reasonCode: "UNOFFICIAL_SOURCE" };
  }

  // A capability behind a paywall is not actionable for a self-hosted,
  // zero-marginal-cost studio — the project's standing cost policy — so it
  // is surfaced for a human cost decision rather than proposed.
  if (input.licenseCostStatus === "paid-only") {
    return { disposition: "POTENTIAL_IMPROVEMENT", reasonCode: "PAID_ONLY_NEEDS_COST_DECISION" };
  }

  // Unknown licensing is the same situation with less information.
  if (input.licenseCostStatus === "unknown") {
    return { disposition: "POTENTIAL_IMPROVEMENT", reasonCode: "LICENSE_COST_UNKNOWN" };
  }

  // A category with no corresponding module on disk has no place to land.
  // It is a real opportunity, but a greenfield one — a human decides
  // whether this project should grow that surface at all.
  const relatedPaths = AYAS_CAPABILITY_CATEGORY_RELATED_PATHS[input.category];
  if (relatedPaths.length === 0) {
    return { disposition: "POTENTIAL_IMPROVEMENT", reasonCode: "NO_EXISTING_MODULE_FOR_CATEGORY" };
  }

  if (input.confidence === "medium") {
    return { disposition: "POTENTIAL_IMPROVEMENT", reasonCode: "MEDIUM_CONFIDENCE_EVIDENCE" };
  }

  // High-confidence, official, free/open, categorized, lands in a module
  // that actually exists, and names a real gap.
  return { disposition: "ACTIONABLE_PROPOSAL_CANDIDATE", reasonCode: "OFFICIAL_HIGH_CONFIDENCE_GAP" };
}

/**
 * The single gate every downstream consumer asks. Kept as one function so
 * "may this finding enter discovery?" has exactly one answer in the
 * codebase rather than a re-derived comparison at each call site.
 */
export function ayasFindingMayEnterDiscovery(disposition: AyasResearchDisposition): boolean {
  return disposition === "ACTIONABLE_PROPOSAL_CANDIDATE";
}
