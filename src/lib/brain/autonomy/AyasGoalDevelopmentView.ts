import { createAyasGoalStore, type AyasGoal } from "./AyasGoalStore";
import { createAyasExternalResearchStore, type AyasExternalResearchFinding } from "./AyasExternalResearchStore";

/**
 * M22.14 — the read-only Gelişim Merkezi projection of AYAS's goal +
 * external-research durable state, mirroring the exact same "durable store
 * -> read-only view -> UI panel" pattern AyasApprovalInboxView/
 * AyasMicroBatchDevelopmentView already use. Never mutates anything, never
 * exposes a raw absolute path or secret — every free-text field in the
 * underlying stores is already scrubbed at write time (AyasGoalStore/
 * AyasExternalResearchStore's own `scrub`), so this view can render fields
 * directly without a second redaction pass.
 */
export interface AyasGoalDevelopmentEntry extends AyasGoal {
  /** Resolved research findings this goal's candidates reference, in candidate order. `undefined` for a candidate whose finding could not be resolved (deleted/corrupt) — never crashes the view. */
  readonly resolvedCandidateFindings: readonly (AyasExternalResearchFinding | undefined)[];
}

export interface AyasGoalDevelopmentView {
  readonly connected: boolean;
  readonly goals: readonly AyasGoalDevelopmentEntry[];
  readonly research: readonly AyasExternalResearchFinding[];
  readonly error?: string;
}

export function loadAyasGoalDevelopmentView(): AyasGoalDevelopmentView {
  try {
    const goalStore = createAyasGoalStore();
    const researchStore = createAyasExternalResearchStore();
    const allResearch = [...researchStore.list()].sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
    const findingById = new Map(allResearch.map((f) => [f.findingId, f] as const));
    const goals = [...goalStore.list()]
      .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt))
      .map((goal): AyasGoalDevelopmentEntry => ({
        ...goal,
        resolvedCandidateFindings: goal.candidates.map((c) => findingById.get(c.reference)),
      }));
    return { connected: true, goals, research: allResearch };
  } catch (error) {
    return { connected: false, goals: [], research: [], error: error instanceof Error ? error.message : String(error) };
  }
}
