/**
 * Structured impact metadata for an `AyasInboxProposal` — the corrected
 * owner-approval model's replacement for the old text-pattern licensing
 * heuristic in `AyasInternalDecision.ts` (a regex over free-text fields).
 * Deliberately a single OPTIONAL nested object (`AyasInboxProposal.structuredImpact`)
 * rather than 12 new top-level fields: additive, does not collide with the
 * existing free-text explanation fields of similar name (e.g. the existing
 * top-level `productionImpact?: string` stays exactly as-is; this module's
 * `productionImpact` is a distinct, nested, structured severity), and a
 * proposal from before this module existed simply has `structuredImpact:
 * undefined` — no migration, no schema-version bump (`AyasApprovalInboxStore`
 * hashes/persists/reads any proposal shape generically, so this needs no
 * store change beyond the type declaration itself).
 *
 * Fail-closed posture, matching `AyasInternalDecision`'s existing philosophy:
 * every categorical field has an `"unresolved"` value, and the policy below
 * treats `undefined`/malformed impact data exactly like an explicit
 * `"unresolved"` — never like a favorable default.
 */

export type AyasDependencyImpact =
  | "none"
  | "local-free"
  | "existing-approved"
  | "new-package"
  | "external-free-service"
  | "external-paid-service"
  | "unresolved";

export type AyasLicensingStatus = "not-applicable" | "permissive-compatible" | "incompatible-or-unknown" | "unresolved";

export type AyasReversibility = "fully-reversible" | "reversible-with-effort" | "irreversible" | "unresolved";

export type AyasValidationConfidence = "high" | "medium" | "low" | "unresolved";

/** Generic severity scale reused across several structured-impact fields below, rather than each inventing its own. */
export type AyasImpactLevel = "none" | "low" | "medium" | "high" | "unresolved";

/** Nested, distinct-typed sibling of the legacy top-level `estimatedCost: "zero-cost"` literal — that field is left untouched for backward compatibility; this is the field that can actually vary. */
export type AyasStructuredCostEstimate = "zero-cost" | "non-zero" | "unresolved";

export interface AyasProposalStructuredImpact {
  readonly dependencyImpact: AyasDependencyImpact;
  readonly externalServiceImpact: AyasImpactLevel;
  readonly estimatedCost: AyasStructuredCostEstimate;
  readonly paidCommitmentRequired: boolean;
  readonly licensingImpact: AyasImpactLevel;
  readonly licensingStatus: AyasLicensingStatus;
  readonly securityImpact: AyasImpactLevel;
  readonly authorityImpact: AyasImpactLevel;
  readonly storageImpact: AyasImpactLevel;
  readonly productionImpact: AyasImpactLevel;
  readonly reversibility: AyasReversibility;
  readonly validationConfidence: AyasValidationConfidence;
}

/** The safe, non-committal default a discovery source can use when it hasn't (yet) modeled a candidate's impact in detail — every field resolves to the most conservative value, so omission can never look more favorable than an explicit "unresolved". */
export const AYAS_UNRESOLVED_STRUCTURED_IMPACT: AyasProposalStructuredImpact = {
  dependencyImpact: "unresolved",
  externalServiceImpact: "unresolved",
  estimatedCost: "unresolved",
  paidCommitmentRequired: true,
  licensingImpact: "unresolved",
  licensingStatus: "unresolved",
  securityImpact: "unresolved",
  authorityImpact: "unresolved",
  storageImpact: "unresolved",
  productionImpact: "unresolved",
  reversibility: "unresolved",
  validationConfidence: "unresolved",
};

const IMPACT_LEVELS: readonly AyasImpactLevel[] = ["none", "low", "medium", "high", "unresolved"];

/** Defensive runtime check for data read back off disk — a hand-edited or partially-written record must fail closed, not crash or silently pass. */
export function isWellFormedAyasStructuredImpact(value: unknown): value is AyasProposalStructuredImpact {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const dep: readonly string[] = ["none", "local-free", "existing-approved", "new-package", "external-free-service", "external-paid-service", "unresolved"];
  const lic: readonly string[] = ["not-applicable", "permissive-compatible", "incompatible-or-unknown", "unresolved"];
  const rev: readonly string[] = ["fully-reversible", "reversible-with-effort", "irreversible", "unresolved"];
  const conf: readonly string[] = ["high", "medium", "low", "unresolved"];
  const cost: readonly string[] = ["zero-cost", "non-zero", "unresolved"];
  return (
    dep.includes(v.dependencyImpact as string)
    && IMPACT_LEVELS.includes(v.externalServiceImpact as AyasImpactLevel)
    && cost.includes(v.estimatedCost as string)
    && typeof v.paidCommitmentRequired === "boolean"
    && IMPACT_LEVELS.includes(v.licensingImpact as AyasImpactLevel)
    && lic.includes(v.licensingStatus as string)
    && IMPACT_LEVELS.includes(v.securityImpact as AyasImpactLevel)
    && IMPACT_LEVELS.includes(v.authorityImpact as AyasImpactLevel)
    && IMPACT_LEVELS.includes(v.storageImpact as AyasImpactLevel)
    && IMPACT_LEVELS.includes(v.productionImpact as AyasImpactLevel)
    && rev.includes(v.reversibility as string)
    && conf.includes(v.validationConfidence as string)
  );
}

export interface AyasImpactPolicyResult {
  /** True when the impact data itself blocks even a DEFER-vs-recommend decision from being made confidently — the caller should DEFER, matching "any uncertainty: never recommend." */
  readonly mustDefer: boolean;
  /**
   * True when this proposal must never become `executable` (autonomous
   * SAFE-path execution) regardless of `safetyClassification` — e.g. a new
   * package dependency, a paid commitment, or an irreversible change. Does
   * NOT by itself mean DEFER: a `mustNeverExecute` proposal can still be
   * worth recommending to the owner as informational-only, mirroring the
   * existing `REVIEW_REQUIRED` → `executable: false` precedent.
   */
  readonly mustNeverExecute: boolean;
  readonly reasons: readonly string[];
}

/**
 * Pure cost/dependency/licensing policy (Step 3): distinguishes "unresolved"
 * (defer — AYAS cannot yet judge this) from "resolved but non-trivial" (may
 * still reach the owner, but never as a one-click autonomous execution).
 * `undefined` input (proposal predates this module) is treated exactly like
 * `AYAS_UNRESOLVED_STRUCTURED_IMPACT` — fail closed, never a free pass.
 */
export function evaluateAyasImpactPolicy(impact: AyasProposalStructuredImpact | undefined): AyasImpactPolicyResult {
  const effective = impact && isWellFormedAyasStructuredImpact(impact) ? impact : AYAS_UNRESOLVED_STRUCTURED_IMPACT;
  const reasons: string[] = [];
  let mustDefer = false;
  let mustNeverExecute = false;

  if (effective.licensingStatus === "unresolved") { mustDefer = true; reasons.push("unresolved licensing status"); }
  if (effective.licensingStatus === "incompatible-or-unknown") { mustDefer = true; reasons.push("incompatible or unknown licensing"); }
  if (effective.dependencyImpact === "unresolved") { mustDefer = true; reasons.push("unresolved dependency/cost impact"); }
  if (effective.estimatedCost === "unresolved") { mustDefer = true; reasons.push("unresolved cost estimate"); }
  if (effective.validationConfidence === "unresolved") { mustDefer = true; reasons.push("validation confidence not established"); }
  if (effective.reversibility === "unresolved") { mustDefer = true; reasons.push("reversibility not established"); }

  if (effective.paidCommitmentRequired) { mustNeverExecute = true; reasons.push("would require a paid external commitment — AYAS never autonomously creates one"); }
  if (effective.dependencyImpact === "new-package") { mustNeverExecute = true; reasons.push("introduces a new package dependency — never autonomously installed"); }
  if (effective.dependencyImpact === "external-paid-service") { mustNeverExecute = true; reasons.push("depends on a paid external service"); }
  if (effective.dependencyImpact === "external-free-service") { mustNeverExecute = true; reasons.push("depends on a new external service integration — owner review required even though it is free"); }
  if (effective.reversibility === "irreversible") { mustNeverExecute = true; reasons.push("change is not reversible"); }
  if (effective.licensingImpact === "high") { mustNeverExecute = true; reasons.push("high licensing impact"); }
  for (const [field, label] of [
    [effective.securityImpact, "security impact"],
    [effective.authorityImpact, "authority impact"],
    [effective.storageImpact, "storage impact"],
    [effective.productionImpact, "production impact"],
    [effective.externalServiceImpact, "external-service impact"],
  ] as const) {
    if (field === "high") { mustNeverExecute = true; reasons.push(`high ${label}`); }
  }

  return { mustDefer, mustNeverExecute, reasons };
}

const DEPENDENCY_LABEL: Record<AyasDependencyImpact, string> = {
  "none": "no new dependency",
  "local-free": "a local, free dependency",
  "existing-approved": "an already-approved existing dependency",
  "new-package": "a new package dependency",
  "external-free-service": "a new free external service",
  "external-paid-service": "a new paid external service",
  "unresolved": "an unresolved dependency impact",
};

const LICENSING_LABEL: Record<AyasLicensingStatus, string> = {
  "not-applicable": "no licensing concern",
  "permissive-compatible": "permissive, compatible licensing",
  "incompatible-or-unknown": "incompatible or unknown licensing",
  "unresolved": "unresolved licensing",
};

/** Owner-facing, plain-language, one-sentence disclosure — no raw enum values, no field names. Advanced/raw `structuredImpact` is a separate, explicitly-opened detail (see `AyasOwnerApprovalRequest.ts`), never shown inline. */
export function describeAyasProposalImpactForOwner(impact: AyasProposalStructuredImpact | undefined): string {
  if (!impact || !isWellFormedAyasStructuredImpact(impact)) return "Cost/dependency/licensing impact has not been assessed for this item.";
  const parts = [`Uses ${DEPENDENCY_LABEL[impact.dependencyImpact]}`, LICENSING_LABEL[impact.licensingStatus]];
  parts.push(impact.paidCommitmentRequired ? "would require a paid commitment" : impact.estimatedCost === "zero-cost" ? "no ongoing cost" : "cost not fully resolved");
  return `${parts.join("; ")}.`;
}
