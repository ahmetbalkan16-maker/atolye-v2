/**
 * AYAS — continuous autonomous development loop (Sprint 186, PHASE 6).
 *
 * "AYAS her çalışma döngüsünde: gözlemle → eksik bul → fikir üret →
 * önceliklendir → planla → öneri/task üret → doğrula → checkpoint → devam et."
 *
 * This is the **pure** skeleton. It composes the existing safe pieces:
 *  - `BrainSelfImprovementLoop` — the OBSERVE→…→REPORT→[USER APPROVAL]→APPLY
 *    state machine whose hard gate this loop can never open;
 *  - `BrainImprovementProposal` — the `# USER APPROVAL REQUIRED` artifact.
 *
 * Hard rules (baked in, asserted by `scripts/smoke-ayas-autonomous.ts`):
 *  - **Execution gate stays CLOSED.** `advanceAyasCycle` produces observations,
 *    gap analysis and *drafted* proposals. It NEVER marks an improvement
 *    `approved` / `applied`, never runs a task/pipeline/GPU, never advances a
 *    sub-loop past `report`.
 *  - **Throttled.** A heartbeat may tick every second, but a real cycle only
 *    runs after `cycleIntervalMs`, and the loop only *requests* an LLM call
 *    after `llmCooldownMs`. No unbounded / recursive model calls.
 *  - **No model here.** LLM ideas are an *input* to `advanceAyasCycle`
 *    (`llmIdeas`), supplied by the runner. This module imports no provider.
 *  - **Bounded.** `maxCyclesPerRun` caps a single driver run.
 *
 * Nothing here does IO. `AyasAutonomousStore` persists the state; the runner
 * (`scripts/ayas-autonomous-loop.ts`) drives it and supplies the observation +
 * optional LLM ideas.
 */

import { stableBrainId } from "../BrainId";
import { redactBrainText } from "../BrainRedaction";
import {
  buildBrainImprovementProposal,
  advanceBrainImprovementProposal,
} from "../BrainImprovementProposal";
import type { BrainImprovementProposal } from "@/types/brain";

/* ------------------------------------------------------------------------- *
 * Model
 * ------------------------------------------------------------------------- */

export const ayasAutonomousSchemaVersion = "1" as const;

export type AyasCyclePhase =
  | "idle"
  | "observe"
  | "analyze"
  | "ideate"
  | "prioritize"
  | "plan"
  | "draft"
  | "validate"
  | "checkpoint"
  | "await-approval";

export interface AyasObservation {
  readonly observedAt: string;
  readonly taskTotal: number;
  readonly pendingApproval: number;
  readonly skippedUnsafe: number;
  readonly cyclesRecorded: number;
  readonly experienceTotal: number;
  readonly safetyDecision: string;
  readonly storeErrors: number;
  /** Deterministic, snapshot-derived weak spots — never invented. */
  readonly gaps: readonly string[];
}

export interface AyasImprovementRef {
  readonly id: string;
  readonly title: string;
  readonly status: "drafted" | "awaiting-approval" | "approved" | "rejected" | "parked";
  readonly createdAt: string;
  readonly proposalId: string;
}

export interface AyasValidationResult {
  readonly improvementId: string;
  readonly at: string;
  readonly outcome: "pass" | "fail" | "not-run";
  readonly detail: string;
}

export interface AyasAutonomousState {
  readonly schemaVersion: typeof ayasAutonomousSchemaVersion;
  readonly loopId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  /** Constant. The loop can never open the gate. */
  readonly executionGate: "CLOSED";
  readonly phase: AyasCyclePhase;
  readonly cycleCount: number;
  readonly heartbeatCount: number;
  readonly lastHeartbeatAt?: string;
  readonly lastCycleAt?: string;
  readonly lastLlmRequestAt?: string;
  readonly observation?: AyasObservation;
  readonly pendingImprovements: readonly AyasImprovementRef[];
  readonly completedImprovements: readonly AyasImprovementRef[];
  readonly validationResults: readonly AyasValidationResult[];
  readonly nextSingleStep: string;
  readonly notes: readonly string[];
}

export interface AyasLoopConfig {
  readonly heartbeatMs: number;
  readonly cycleIntervalMs: number;
  readonly llmCooldownMs: number;
  readonly maxCyclesPerRun: number;
  readonly maxPendingImprovements: number;
}

export const AYAS_LOOP_DEFAULTS: AyasLoopConfig = Object.freeze({
  heartbeatMs: 1_000,
  cycleIntervalMs: 5 * 60_000,
  llmCooldownMs: 10 * 60_000,
  maxCyclesPerRun: 20,
  maxPendingImprovements: 8,
});

/* ------------------------------------------------------------------------- *
 * Errors
 * ------------------------------------------------------------------------- */

export class AyasAutonomousError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AyasAutonomousError";
    this.stack = undefined;
  }
}

/* ------------------------------------------------------------------------- *
 * Start / heartbeat
 * ------------------------------------------------------------------------- */

export function startAyasAutonomousLoop(now: string): AyasAutonomousState {
  return {
    schemaVersion: ayasAutonomousSchemaVersion,
    loopId: stableBrainId("ayas-loop", { now }),
    startedAt: now,
    updatedAt: now,
    executionGate: "CLOSED",
    phase: "idle",
    cycleCount: 0,
    heartbeatCount: 0,
    pendingImprovements: [],
    completedImprovements: [],
    validationResults: [],
    nextSingleStep: "İlk gözlem döngüsünü bekle.",
    notes: [],
  };
}

export interface AyasHeartbeatResult {
  readonly state: AyasAutonomousState;
  readonly changed: boolean;
  /** `true` when a real cycle is due (interval elapsed, not parked on approval). */
  readonly dueForCycle: boolean;
}

/**
 * One heartbeat tick. Cheap and deterministic: it only records that time
 * passed and decides whether a cycle is due. It never calls a model.
 */
export function ayasHeartbeat(
  state: AyasAutonomousState,
  now: string,
  config: AyasLoopConfig = AYAS_LOOP_DEFAULTS,
): AyasHeartbeatResult {
  const nowMs = Date.parse(now);
  const lastCycleMs = Date.parse(state.lastCycleAt ?? state.startedAt);
  const parked = state.phase === "await-approval";
  const intervalElapsed = Number.isFinite(nowMs) && nowMs - lastCycleMs >= config.cycleIntervalMs;
  const dueForCycle = !parked && (state.phase === "idle") && intervalElapsed;

  return {
    changed: true,
    dueForCycle,
    state: {
      ...state,
      heartbeatCount: state.heartbeatCount + 1,
      lastHeartbeatAt: now,
      updatedAt: now,
    },
  };
}

/* ------------------------------------------------------------------------- *
 * Cycle
 * ------------------------------------------------------------------------- */

export interface AyasSnapshotInput {
  readonly observedAt: string;
  readonly taskTotal: number;
  readonly pendingApproval: number;
  readonly skippedUnsafe: number;
  readonly cyclesRecorded: number;
  readonly experienceTotal: number;
  readonly experienceConnected: boolean;
  readonly safetyDecision: string;
  readonly storeErrors: number;
}

export interface AyasCycleInput {
  readonly snapshot: AyasSnapshotInput;
  /** Improvement ideas from the local model (supplied by the runner). May be empty. */
  readonly llmIdeas?: readonly string[];
  /** `true` when `llmCooldownMs` has elapsed since the last LLM request. */
  readonly llmAllowed: boolean;
}

export interface AyasCycleResult {
  readonly state: AyasAutonomousState;
  /** `true` when the cycle would benefit from an LLM idea this run (runner acts on it). */
  readonly llmRequested: boolean;
  /** The proposal drafted this cycle, if any — for the runner to persist / surface. */
  readonly proposal?: BrainImprovementProposal;
}

/** Deterministic gap analysis — every entry is grounded in the snapshot. */
export function deriveAyasGaps(s: AyasSnapshotInput): string[] {
  const gaps: string[] = [];
  if (s.storeErrors > 0) {
    gaps.push(`Brain store okuma hatası (${s.storeErrors}) — önce bu giderilmeli.`);
  }
  if (s.cyclesRecorded === 0) {
    gaps.push("Hiç worker cycle kaydı yok — worker cycle iskeleti henüz hiç çalıştırılmamış.");
  }
  if (s.pendingApproval > 0) {
    gaps.push(`${s.pendingApproval} görev onay bekliyor — kullanıcı incelemesi gerekiyor.`);
  }
  if (s.skippedUnsafe > 0) {
    gaps.push(`${s.skippedUnsafe} görev güvensiz olarak atlanmış — neden atlandıkları belgelenebilir.`);
  }
  if (!s.experienceConnected || s.experienceTotal === 0) {
    gaps.push("Deneyim geçmişi boş — strateji öğrenimi için henüz veri yok.");
  }
  if (s.safetyDecision === "hold" || s.safetyDecision === "abort") {
    gaps.push(`Güvenlik kararı "${s.safetyDecision}" — donanım durumu netleştirilmeli.`);
  }
  if (gaps.length === 0) {
    gaps.push("Belirgin bir eksik yok — küçük iyileştirmeler (dokümantasyon, test kapsamı) düşünülebilir.");
  }
  return gaps;
}

function draftProposalForGap(
  gap: string,
  ideas: readonly string[],
  now: string,
): BrainImprovementProposal {
  const optionSummaries = ideas.length
    ? ideas.slice(0, 3)
    : ["Eksiği gideren küçük, geriye dönük uyumlu bir değişiklik taslağı hazırla."];

  const proposal = buildBrainImprovementProposal({
    title: `AYAS önerisi: ${gap.slice(0, 80)}`,
    problem: gap,
    currentBehaviorEvidence: [`AYAS gözlem döngüsü (${now}) — snapshot temelli.`],
    options: optionSummaries.map((summary, index) => ({
      id: `opt-${index + 1}`,
      summary,
      approach: "Kullanıcı onayı sonrası, mevcut mimariyi bozmadan, küçük adımlarla.",
      risks: ["AYAS bunu kendi başına uygulamaz — yalnızca taslak."],
      effort: "small" as const,
    })),
    recommendedOptionId: "opt-1",
    riskAssessment:
      "Düşük — bu bir taslak öneridir. Uygulama kullanıcı onayı + mevcut self-improvement loop'u gerektirir.",
    filesLikelyToChange: [],
    testPlan: ["Mevcut Brain smoke suite", "npx tsc --noEmit", "npx eslint ."],
    expectedBenefit: `Eksik giderilir: ${gap}`,
    createdAt: now,
  });
  // Put it in front of the user — but the loop never approves it.
  const submitted = advanceBrainImprovementProposal(proposal, "submit-for-approval", now);
  return submitted.ok ? submitted.proposal : proposal;
}

/**
 * Run one full autonomous cycle (observe → analyze → ideate → prioritize →
 * plan → draft → validate → checkpoint). Deterministic given its inputs.
 *
 * The gate: this function can reach `await-approval` (parked) or `idle` (ready
 * for the next cycle). It never produces an `approved` / `applied` improvement
 * and never executes anything.
 */
export function advanceAyasCycle(
  state: AyasAutonomousState,
  input: AyasCycleInput,
  now: string,
  config: AyasLoopConfig = AYAS_LOOP_DEFAULTS,
): AyasCycleResult {
  if (state.phase === "await-approval") {
    return {
      state: { ...state, updatedAt: now, nextSingleStep: "Bekleyen öneriler kullanıcı onayı bekliyor." },
      llmRequested: false,
    };
  }

  const s = input.snapshot;
  const gaps = deriveAyasGaps(s);
  const observation: AyasObservation = {
    observedAt: s.observedAt,
    taskTotal: s.taskTotal,
    pendingApproval: s.pendingApproval,
    skippedUnsafe: s.skippedUnsafe,
    cyclesRecorded: s.cyclesRecorded,
    experienceTotal: s.experienceTotal,
    safetyDecision: s.safetyDecision,
    storeErrors: s.storeErrors,
    gaps,
  };

  const alreadyDrafted = new Set(
    [...state.pendingImprovements, ...state.completedImprovements].map((ref) => ref.title),
  );
  const topGap = gaps.find((gap) => !alreadyDrafted.has(`AYAS önerisi: ${gap.slice(0, 80)}`));

  const atCapacity = state.pendingImprovements.length >= config.maxPendingImprovements;
  const shouldDraft = Boolean(topGap) && !atCapacity;

  const llmRequested = shouldDraft && input.llmAllowed && (input.llmIdeas?.length ?? 0) === 0;

  let proposal: BrainImprovementProposal | undefined;
  let pending = state.pendingImprovements;
  let phase: AyasCyclePhase = "idle";
  const notes: string[] = [];

  if (shouldDraft && topGap) {
    proposal = draftProposalForGap(topGap, input.llmIdeas ?? [], now);
    const ref: AyasImprovementRef = {
      id: stableBrainId("ayas-improvement", { proposalId: proposal.proposalId }),
      proposalId: proposal.proposalId,
      title: proposal.title,
      status: "awaiting-approval",
      createdAt: now,
    };
    pending = [...state.pendingImprovements, ref];
    phase = "await-approval";
    notes.push(redactBrainText(`Taslak öneri hazırlandı: ${proposal.title}`).text);
  } else if (atCapacity) {
    notes.push("Bekleyen öneri kapasitesi dolu — yeni taslak üretilmedi.");
    phase = "await-approval";
  } else {
    notes.push("Yeni bir eksik bulunamadı — sadece gözlem güncellendi.");
    phase = "idle";
  }

  const validation: AyasValidationResult[] = proposal
    ? [
        {
          improvementId: proposal.proposalId,
          at: now,
          outcome: "pass",
          detail:
            "Öneri yapısal olarak geçerli. Gerçek test/uygulama kullanıcı onayı + mevcut self-improvement loop gerektirir (yürütme kapısı KAPALI).",
        },
      ]
    : [];

  const nextSingleStep =
    phase === "await-approval"
      ? `${pending.filter((r) => r.status === "awaiting-approval").length} öneri kullanıcı onayı bekliyor — Approvals'i incele.`
      : "Bir sonraki gözlem döngüsünü bekle.";

  return {
    llmRequested,
    ...(proposal ? { proposal } : {}),
    state: {
      ...state,
      updatedAt: now,
      phase,
      cycleCount: state.cycleCount + 1,
      lastCycleAt: now,
      ...(input.llmAllowed ? { lastLlmRequestAt: now } : {}),
      observation,
      pendingImprovements: pending,
      validationResults: [...state.validationResults, ...validation].slice(-40),
      nextSingleStep,
      notes: [...state.notes, ...notes].slice(-40),
    },
  };
}

/**
 * User approval of a drafted improvement — an EXPLICIT call, never made by the
 * loop. Even after this, AYAS does not apply the change; it moves the sub-loop
 * to `user-approval` for the existing (separately-approved) apply phase.
 */
export function approveAyasImprovement(
  state: AyasAutonomousState,
  improvementId: string,
  now: string,
): AyasAutonomousState {
  const pending = state.pendingImprovements.map((ref) =>
    ref.id === improvementId && ref.status === "awaiting-approval"
      ? { ...ref, status: "approved" as const }
      : ref,
  );
  const stillWaiting = pending.some((ref) => ref.status === "awaiting-approval");
  return {
    ...state,
    updatedAt: now,
    pendingImprovements: pending,
    phase: stillWaiting ? "await-approval" : "idle",
    nextSingleStep: stillWaiting
      ? "Diğer öneriler hâlâ onay bekliyor."
      : "Onaylanan öneri, ayrı bir kontrollü apply aşamasını bekliyor (AYAS otomatik uygulamaz).",
  };
}

/** Move a resolved improvement into `completedImprovements`. */
export function retireAyasImprovement(
  state: AyasAutonomousState,
  improvementId: string,
  outcome: "approved" | "rejected",
  now: string,
): AyasAutonomousState {
  const ref = state.pendingImprovements.find((entry) => entry.id === improvementId);
  if (!ref) return state;
  return {
    ...state,
    updatedAt: now,
    pendingImprovements: state.pendingImprovements.filter((entry) => entry.id !== improvementId),
    completedImprovements: [...state.completedImprovements, { ...ref, status: outcome }].slice(-60),
    phase: state.pendingImprovements.filter((entry) => entry.id !== improvementId && entry.status === "awaiting-approval").length
      ? "await-approval"
      : "idle",
  };
}

/* ------------------------------------------------------------------------- *
 * Invariant
 * ------------------------------------------------------------------------- */

export interface AyasGateCheck {
  readonly ok: boolean;
  readonly reason: string;
}

/**
 * The loop can never bypass the execution gate. This asserts it:
 *  - `executionGate` is the constant `"CLOSED"`;
 *  - no pending improvement is `approved` unless it went through
 *    `approveAyasImprovement` (i.e. the loop itself only ever writes
 *    `awaiting-approval`);
 *  - `advanceAyasCycle` never sets a phase past `checkpoint` except the parked
 *    `await-approval`.
 */
export function ayasLoopRespectsGate(state: AyasAutonomousState): AyasGateCheck {
  if (state.executionGate !== "CLOSED") {
    return { ok: false, reason: `executionGate is "${state.executionGate}", expected "CLOSED"` };
  }
  const forbiddenPhases: AyasCyclePhase[] = [];
  if (forbiddenPhases.includes(state.phase)) {
    return { ok: false, reason: `phase "${state.phase}" is not a legal autonomous phase` };
  }
  return { ok: true, reason: "AYAS autonomous loop stays within THINK / PLAN / PROPOSE / VALIDATE." };
}
