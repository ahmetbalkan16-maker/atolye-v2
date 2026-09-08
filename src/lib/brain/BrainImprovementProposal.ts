/**
 * Atölye Brain — self-improvement proposal engine (sections 8 + 16 of the emir,
 * and the expanded loop:
 *
 *   OBSERVE → ANALYZE → PROPOSE → TEST → VERIFY → REPORT → USER APPROVAL →
 *   APPLY → REGRESSION TEST → AUDIT
 *
 * The Brain may *observe*, *analyze*, *test in a temp workspace*, *verify* and
 * *draft a proposal*. It may NOT change production code, security policy or data
 * without an explicit `user-approve`. This module is the **pure** gate that
 * enforces that: it builds a proposal in `awaiting-user-approval` and only a
 * `user-approve` event moves it toward `implemented`.
 */

import { stableBrainId } from "./BrainId";
import {
  brainSchemaVersion,
  type BrainImprovementApprovalState,
  type BrainImprovementEvent,
  type BrainImprovementProposal,
  type BrainImprovementProposalInput,
  type BrainImprovementTransition,
  type BrainImprovementTransitionResult,
} from "@/types/brain";

/**
 * The legal transitions. `awaiting-user-approval → approved` is the ONLY door
 * to `approved`, and only `user-approve` opens it. Every state can `rollback`
 * except the terminal ones.
 */
const TRANSITIONS: Readonly<
  Record<BrainImprovementApprovalState, Partial<Record<BrainImprovementEvent, BrainImprovementApprovalState>>>
> = Object.freeze({
  draft: {
    "submit-for-approval": "awaiting-user-approval",
  },
  "awaiting-user-approval": {
    "user-approve": "approved",
    "user-reject": "rejected",
  },
  approved: {
    "mark-implemented": "implemented",
    rollback: "rolled-back",
  },
  implemented: {
    "mark-verified": "verified",
    rollback: "rolled-back",
  },
  verified: {
    rollback: "rolled-back",
  },
  rejected: {},
  "rolled-back": {},
});

function isIsoInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

const UNSAFE_TEXT = /secret|api.?key|bearer|password|BEGIN [A-Z ]+PRIVATE KEY|sk-[A-Za-z0-9]/;

function sanitize(value: string): string {
  return UNSAFE_TEXT.test(value) ? "[redacted]" : value;
}

/**
 * Build a proposal. It starts in `draft`; call {@link advanceBrainImprovementProposal}
 * with `submit-for-approval` to put it in front of the user. Deterministic id.
 */
export function buildBrainImprovementProposal(
  input: BrainImprovementProposalInput,
): BrainImprovementProposal {
  const canonical: BrainImprovementProposalInput = {
    title: sanitize(input.title.trim()),
    problem: sanitize(input.problem.trim()),
    currentBehaviorEvidence: input.currentBehaviorEvidence.map((item) => sanitize(item.trim())).filter(Boolean),
    options: input.options.map((option) => ({
      id: option.id.trim(),
      summary: sanitize(option.summary.trim()),
      approach: sanitize(option.approach.trim()),
      risks: option.risks.map((risk) => sanitize(risk.trim())).filter(Boolean),
      effort: option.effort,
    })),
    recommendedOptionId: input.recommendedOptionId.trim(),
    riskAssessment: sanitize(input.riskAssessment.trim()),
    filesLikelyToChange: input.filesLikelyToChange.map((item) => item.trim()).filter(Boolean),
    testPlan: input.testPlan.map((item) => sanitize(item.trim())).filter(Boolean),
    expectedBenefit: sanitize(input.expectedBenefit.trim()),
    createdAt: input.createdAt,
  };
  return {
    schemaVersion: brainSchemaVersion,
    ...canonical,
    proposalId: stableBrainId("brain-improvement", canonical),
    approvalState: "draft",
    history: [],
  };
}

/**
 * Apply one lifecycle event. Fail-closed: an illegal transition, a bad
 * timestamp or an unknown recommended option returns the proposal unchanged
 * with a specific reason code.
 */
export function advanceBrainImprovementProposal(
  proposal: BrainImprovementProposal,
  event: BrainImprovementEvent,
  occurredAt: string,
  note?: string,
): BrainImprovementTransitionResult {
  if (!isIsoInstant(occurredAt)) {
    return {
      ok: false,
      reasonCode: "BRAIN_IMPROVEMENT_TRANSITION_TIMESTAMP_REGRESSION",
      proposal,
    };
  }
  const last = proposal.history.at(-1);
  if (last && Date.parse(occurredAt) < Date.parse(last.occurredAt)) {
    return {
      ok: false,
      reasonCode: "BRAIN_IMPROVEMENT_TRANSITION_TIMESTAMP_REGRESSION",
      proposal,
    };
  }
  if (!proposal.options.some((option) => option.id === proposal.recommendedOptionId)) {
    return {
      ok: false,
      reasonCode: "BRAIN_IMPROVEMENT_TRANSITION_UNKNOWN_OPTION",
      proposal,
    };
  }

  const next = TRANSITIONS[proposal.approvalState][event];
  if (!next) {
    return {
      ok: false,
      reasonCode: "BRAIN_IMPROVEMENT_TRANSITION_ILLEGAL",
      proposal,
    };
  }

  const transition: BrainImprovementTransition = {
    event,
    from: proposal.approvalState,
    to: next,
    occurredAt,
    ...(note ? { note: sanitize(note) } : {}),
  };

  return {
    ok: true,
    reasonCode: "BRAIN_IMPROVEMENT_TRANSITION_OK",
    proposal: {
      ...proposal,
      approvalState: next,
      history: [...proposal.history, transition],
    },
  };
}

/** `true` when the proposal has cleared the user-approval gate. */
export function isBrainImprovementApproved(proposal: BrainImprovementProposal): boolean {
  return (
    proposal.approvalState === "approved" ||
    proposal.approvalState === "implemented" ||
    proposal.approvalState === "verified"
  );
}

/**
 * Render the `# USER APPROVAL REQUIRED` report from section 8 of the emir.
 * Deterministic and safe to show the user verbatim.
 */
export function renderBrainImprovementProposalReport(
  proposal: BrainImprovementProposal,
): string {
  const recommended = proposal.options.find(
    (option) => option.id === proposal.recommendedOptionId,
  );
  const lines: string[] = [
    `# ${proposal.title}`,
    "",
    proposal.approvalState === "awaiting-user-approval"
      ? "## STATUS: USER APPROVAL REQUIRED"
      : `## STATUS: ${proposal.approvalState.toUpperCase()}`,
    "",
    "### Problem",
    proposal.problem,
    "",
    "### Current behaviour (evidence)",
    ...proposal.currentBehaviorEvidence.map((item) => `- ${item}`),
    "",
    "### Options",
    ...proposal.options.flatMap((option) => [
      `- **${option.id}** (${option.effort})${option.id === proposal.recommendedOptionId ? " — RECOMMENDED" : ""}`,
      `  - ${option.summary}`,
      `  - approach: ${option.approach}`,
      ...option.risks.map((risk) => `  - risk: ${risk}`),
    ]),
    "",
    "### Risk assessment",
    proposal.riskAssessment,
    "",
    "### Files likely to change",
    ...(proposal.filesLikelyToChange.length
      ? proposal.filesLikelyToChange.map((item) => `- ${item}`)
      : ["- (none listed)"]),
    "",
    "### Test plan",
    ...proposal.testPlan.map((item) => `- ${item}`),
    "",
    "### Expected benefit",
    proposal.expectedBenefit,
    "",
    "### If approved",
    "1. checkpoint (record current state)",
    `2. implement ${recommended ? `option **${recommended.id}**` : "the recommended option"}`,
    "3. typecheck + lint + targeted smoke tests",
    "4. regression smoke set",
    "5. evaluate — keep on green, roll back on red",
    "6. graphify update",
    "7. result report + checkpoint entry",
    "",
    "_The Brain will not apply this without an explicit approval._",
  ];
  if (proposal.history.length) {
    lines.push("", "### History");
    for (const transition of proposal.history) {
      lines.push(
        `- ${transition.occurredAt} — ${transition.event}: ${transition.from} → ${transition.to}${transition.note ? ` (${transition.note})` : ""}`,
      );
    }
  }
  return lines.join("\n");
}
