import { createAyasGoalStore, type AyasGoal } from "./AyasGoalStore";
import { createAyasExternalResearchStore, type AyasExternalResearchFinding } from "./AyasExternalResearchStore";
import { createAyasResearchSchedulerStateStore } from "./AyasResearchSchedulerStateStore";

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
  readonly scheduledResearchFindings: readonly AyasExternalResearchFinding[];
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
    // Scheduler state only links scheduled findings to their Goal; if it cannot
    // be read, goals and research stay visible without that projection.
    let goalByOccurrence = new Map<string, string>();
    try {
      goalByOccurrence = new Map((createAyasResearchSchedulerStateStore().read().goalResearchJobs ?? []).map((job) => [job.occurrenceId, job.goalId] as const));
    } catch { /* fail soft: display projection only */ }
    const findingById = new Map(allResearch.map((f) => [f.findingId, f] as const));
    const findingsByGoal = new Map<string, AyasExternalResearchFinding[]>();
    for (const finding of allResearch) if (finding.goalId && finding.occurrenceId && goalByOccurrence.get(finding.occurrenceId) === finding.goalId) {
      const group = findingsByGoal.get(finding.goalId) ?? [];
      group.push(finding);
      findingsByGoal.set(finding.goalId, group);
    }
    const goals = [...goalStore.list()]
      .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt))
      .map((goal): AyasGoalDevelopmentEntry => ({
        ...goal,
        resolvedCandidateFindings: goal.candidates.map((c) => findingById.get(c.reference)),
        scheduledResearchFindings: findingsByGoal.get(goal.goalId) ?? [],
      }));
    return { connected: true, goals, research: allResearch };
  } catch (error) {
    return { connected: false, goals: [], research: [], error: error instanceof Error ? error.message : String(error) };
  }
}
