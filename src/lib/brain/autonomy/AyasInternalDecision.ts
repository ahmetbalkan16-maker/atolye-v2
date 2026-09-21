/**
 * AYAS internal proposal review — the filter that runs BEFORE anything ever
 * reaches the owner. Owner-approval-model correction: the owner must not
 * need to inspect code or judge a technical change; AYAS reviews every
 * PENDING proposal itself first and only ever surfaces one of three
 * internal outcomes: `REJECT`, `DEFER`, or `RECOMMEND_FOR_APPROVAL`. Only
 * `RECOMMEND_FOR_APPROVAL` ever reaches an owner-facing approval request
 * (see `AyasOwnerApprovalRequest.ts`).
 *
 * Deterministic and pure — no LLM call, no I/O. This mirrors the rest of
 * this pipeline's own philosophy (`BrainPatchSafety`, `AyasMicroClassifier`):
 * a safety-relevant decision is an ordered, inspectable, testable rule list,
 * not a model judgment call. Any rule that cannot be confidently evaluated
 * from the proposal's own declared fields defers rather than guesses —
 * "any uncertainty: DENY autonomous execution" extends here to "any
 * uncertainty: never recommend."
 *
 * Important: `RECOMMEND_FOR_APPROVAL` does NOT by itself mean the proposal
 * can ever execute. A `REVIEW_REQUIRED` proposal may still be internally
 * reviewed and (if AYAS judges it worth the owner's attention) recommended
 * — but `AyasApprovalInboxStore.decide()` hard-refuses an APPROVE decision
 * on anything that is not `SAFE` (`AYAS_INBOX_UNSAFE_APPROVAL`), and this
 * module does not weaken that. `executable` on the result says whether an
 * owner APPROVE could ever actually lead to execution; a `RECOMMEND_FOR_APPROVAL`
 * with `executable: false` is informational only — see `AyasOwnerApprovalRequest.ts`
 * for how that gets explained to the owner in plain language.
 */

import { classifyPatchSet } from "../selfheal/BrainPatchSafety";
import { isAyasProposalApprovalReady, missingAyasApprovalExplanation, type AyasInboxProposal } from "./AyasApprovalInboxStore";
import { evaluateAyasImpactPolicy } from "./AyasProposalImpact";
import { isAyasMutationKindRegistered } from "./AyasMutationRegistry";

export type AyasInternalDecisionKind = "REJECT" | "DEFER" | "RECOMMEND_FOR_APPROVAL";

export interface AyasInternalDecisionResult {
  readonly decision: AyasInternalDecisionKind;
  /** Ordered — the first reason is the one that actually determined the outcome; later reasons (if any) are additional context. */
  readonly reasons: readonly string[];
  /** True only when the proposal's own safetyClassification is SAFE, i.e. an owner APPROVE could actually reach execution. */
  readonly executable: boolean;
}

const LICENSE_UNRESOLVED_PATTERN = /(licens|lisans).{0,40}(unknown|belirsiz|unresolved|çözülmemiş)|(unknown|belirsiz|unresolved|çözülmemiş).{0,40}(licens|lisans)/i;
const MIN_BENEFIT_TEXT_LENGTH = 10;

function textOf(proposal: AyasInboxProposal, field: keyof AyasInboxProposal): string {
  const value = proposal[field];
  return typeof value === "string" ? value : "";
}

/**
 * `mutationKind` is required for anything to ever become execution-eligible
 * (see `AyasMutationRegistry` — an unregistered kind throws before any
 * reservation activity). A proposal with no declared `mutationKind` can
 * never execute regardless of classification, so it is never worth
 * recommending — deferred, not rejected, since discovery may still attach
 * one later.
 */
function hasNoExecutionPath(proposal: AyasInboxProposal): boolean {
  return !proposal.mutationKind || !proposal.mutationKind.trim() || !isAyasMutationKindRegistered(proposal.mutationKind);
}

export function evaluateAyasInternalDecision(proposal: AyasInboxProposal): AyasInternalDecisionResult {
  const domain = classifyPatchSet(proposal.exactFiles);
  const executable = proposal.safetyClassification === "SAFE";

  if (proposal.status !== "PENDING") {
    return { decision: "REJECT", reasons: [`proposal is not in a decidable state (status: ${proposal.status})`], executable };
  }

  if (proposal.safetyClassification === "FORBIDDEN_AUTONOMOUS" || domain.level === "FORBIDDEN_AUTONOMOUS") {
    return { decision: "REJECT", reasons: ["targets a never-autonomous domain — unsafe relative to any benefit"], executable: false };
  }

  if (proposal.exactFiles.length === 0) {
    return { decision: "REJECT", reasons: ["declares no target files — nothing to evaluate or execute"], executable: false };
  }

  const benefitText = textOf(proposal, "expectedUserBenefit");
  if (benefitText.trim().length < MIN_BENEFIT_TEXT_LENGTH) {
    return { decision: "REJECT", reasons: ["expected benefit is missing or too weak to justify the change"], executable };
  }

  if (hasNoExecutionPath(proposal)) {
    return { decision: "DEFER", reasons: ["no registered mutationKind — no execution path exists yet for this candidate"], executable: false };
  }

  const missingExplanations = missingAyasApprovalExplanation(proposal);
  if (missingExplanations.length > 0) {
    return { decision: "DEFER", reasons: [`missing required explanation field(s): ${missingExplanations.join(", ")}`], executable };
  }

  if (proposal.evidence.length === 0 || proposal.graphifyEvidence.length === 0) {
    return { decision: "DEFER", reasons: ["insufficient evidence — evidence and/or graphifyEvidence is empty"], executable };
  }

  // Structured impact metadata (Step 2/3 of the owner-approval-model
  // completion pass) supersedes the free-text licensing heuristic below for
  // ANY proposal that declares it — "do not rely on free-text pattern
  // matching when structured metadata exists". A proposal predating this
  // field (`structuredImpact` undefined) falls through to the unchanged
  // legacy checks instead: this branch is additive, never a migration, and
  // never makes an old proposal's evaluation stricter than it already was.
  if (proposal.structuredImpact) {
    const impactPolicy = evaluateAyasImpactPolicy(proposal.structuredImpact);
    if (impactPolicy.mustDefer) {
      return { decision: "DEFER", reasons: impactPolicy.reasons, executable: false };
    }
    if (proposal.safetyClassification === "SAFE" && domain.level === "SAFE" && isAyasProposalApprovalReady(proposal)) {
      return {
        decision: "RECOMMEND_FOR_APPROVAL",
        reasons: impactPolicy.mustNeverExecute
          ? ["SAFE domain and classification, evidence present", ...impactPolicy.reasons]
          : ["SAFE domain and classification, evidence present, no unresolved concern found"],
        executable: !impactPolicy.mustNeverExecute,
      };
    }
  } else {
    const licenseFields = [textOf(proposal, "currentProblem"), textOf(proposal, "riskIfNotDone"), textOf(proposal, "technicalRisk"), textOf(proposal, "productionImpact"), ...proposal.evidence];
    if (licenseFields.some((text) => LICENSE_UNRESOLVED_PATTERN.test(text))) {
      return { decision: "DEFER", reasons: ["unresolved licensing concern named in the proposal's own text"], executable };
    }

    // `estimatedCost` is a single-literal union ("zero-cost") today — the type
    // system itself already refuses anything else. This check is defense in
    // depth against a bad cast reaching here, not a runtime discovery.
    if (proposal.estimatedCost !== "zero-cost") {
      return { decision: "DEFER", reasons: [`non-zero estimated cost (${String(proposal.estimatedCost)}) — external cost/dependency must be resolved first`], executable };
    }

    if (proposal.safetyClassification === "SAFE" && domain.level === "SAFE" && isAyasProposalApprovalReady(proposal)) {
      return { decision: "RECOMMEND_FOR_APPROVAL", reasons: ["SAFE domain and classification, evidence present, no unresolved concern found"], executable: true };
    }
  }

  // Version-1 rule: REVIEW_REQUIRED can never become executable through the
  // existing SAFE-only execution path (AyasApprovalInboxStore.decide hard-
  // refuses an APPROVE decision on anything that is not SAFE), so it must
  // never reach RECOMMEND_FOR_APPROVAL either — showing the owner an APPROVE
  // button for something the real authority layer will refuse anyway is
  // exactly the "fake approval" this version explicitly rules out. AYAS may
  // still internally REJECT or DEFER a REVIEW_REQUIRED candidate; DEFER
  // (not REJECT) is the fail-closed default here since a REVIEW_REQUIRED
  // domain match on its own says nothing about whether the underlying idea
  // is good — only that this version cannot safely act on it yet.
  if (proposal.safetyClassification === "REVIEW_REQUIRED" || domain.level === "REVIEW_REQUIRED") {
    return {
      decision: "DEFER",
      reasons: [
        "REVIEW_REQUIRED domain/classification — not executable through the current SAFE-only authority path; deferred until a separately hardened high-risk execution architecture exists, not shown to the owner as an approval candidate",
      ],
      executable: false,
    };
  }

  // Fail-closed default: anything not explicitly matched above is deferred,
  // never recommended — "any uncertainty: never recommend."
  return { decision: "DEFER", reasons: ["did not match a known safe-to-recommend pattern — deferred rather than guessed"], executable };
}
