/**
 * Atölye Brain — Self-Healing: loop + blast-radius limits (pure).
 *
 * Emir §15. The Brain must not grind on one incident forever, and a single
 * autonomous patch must stay small. When any limit trips, the incident goes to
 * FAILED with `needsHumanReason` — it is NOT retried and NOT learned as a win.
 *
 * FORBIDDEN for the Brain to self-modify (see BrainPatchSafety).
 */

export const BRAIN_SELFHEAL_LIMITS = Object.freeze({
  /** Distinct sandbox patch attempts for one incident before FAILED_NEEDS_HUMAN. */
  maxPatchAttempts: 3,
  /** Files a single autonomous patch may touch. */
  maxFilesChanged: 8,
  /** Added+removed lines a single autonomous patch may contain. */
  maxDiffLines: 400,
  /** Wall-clock budget for the whole self-heal run of one incident (ms). */
  maxRuntimeMs: 15 * 60 * 1000,
  /** Incidents opened from the same signature within the window before it is muted. */
  maxIncidentsPerSignature: 5,
  maxSignatureWindowMs: 24 * 60 * 60 * 1000,
  /** Total incidents the Brain may have in-flight (not terminal) at once. */
  maxConcurrentIncidents: 6,
  /* ---- v2 ---- */
  /** Autonomous SAFE auto-applies allowed per rolling hour (a brake on a self-patch storm). */
  maxAutonomousAppliesPerHour: 4,
  /** Auto-rollbacks for one incident before it is handed to a human. */
  maxRollbackAttempts: 2,
  /** Length of a self-heal cause chain (A→B→C) before the whole chain is frozen. */
  maxCauseChainDepth: 3,
});

export interface BrainSelfHealAttemptState {
  readonly attempt: number; // 1-based, the attempt about to run
  readonly runtimeMs: number;
  readonly filesChanged: number;
  readonly diffLines: number;
}

export interface BrainSelfHealLimitResult {
  readonly ok: boolean;
  readonly violation:
    | null
    | "MAX_PATCH_ATTEMPTS"
    | "MAX_FILES_CHANGED"
    | "MAX_DIFF_LINES"
    | "MAX_RUNTIME"
    | "SIGNATURE_MUTED"
    | "TOO_MANY_CONCURRENT";
  readonly reason: string;
}

const ok: BrainSelfHealLimitResult = Object.freeze({ ok: true, violation: null, reason: "within limits" });

/** Check whether the NEXT patch attempt for this incident is allowed. */
export function checkSelfHealAttempt(s: BrainSelfHealAttemptState): BrainSelfHealLimitResult {
  if (s.attempt > BRAIN_SELFHEAL_LIMITS.maxPatchAttempts) {
    return fail("MAX_PATCH_ATTEMPTS", `attempt ${s.attempt} exceeds max ${BRAIN_SELFHEAL_LIMITS.maxPatchAttempts}`);
  }
  if (s.runtimeMs > BRAIN_SELFHEAL_LIMITS.maxRuntimeMs) {
    return fail("MAX_RUNTIME", `runtime ${Math.round(s.runtimeMs / 1000)} s exceeds max ${BRAIN_SELFHEAL_LIMITS.maxRuntimeMs / 1000} s`);
  }
  if (s.filesChanged > BRAIN_SELFHEAL_LIMITS.maxFilesChanged) {
    return fail("MAX_FILES_CHANGED", `${s.filesChanged} files changed exceeds max ${BRAIN_SELFHEAL_LIMITS.maxFilesChanged}`);
  }
  if (s.diffLines > BRAIN_SELFHEAL_LIMITS.maxDiffLines) {
    return fail("MAX_DIFF_LINES", `${s.diffLines} diff lines exceeds max ${BRAIN_SELFHEAL_LIMITS.maxDiffLines}`);
  }
  return ok;
}

export interface BrainSignatureHistoryEntry {
  readonly signature: string;
  readonly openedAt: number; // epoch ms
}

/** Whether a fresh incident may be opened for `signature` given recent history. */
export function checkSignatureNotMuted(
  signature: string,
  history: readonly BrainSignatureHistoryEntry[],
  nowMs: number,
): BrainSelfHealLimitResult {
  const recent = history.filter(
    (h) => h.signature === signature && nowMs - h.openedAt <= BRAIN_SELFHEAL_LIMITS.maxSignatureWindowMs,
  );
  if (recent.length >= BRAIN_SELFHEAL_LIMITS.maxIncidentsPerSignature) {
    return fail(
      "SIGNATURE_MUTED",
      `${recent.length} incidents for "${signature}" in the last ${BRAIN_SELFHEAL_LIMITS.maxSignatureWindowMs / 3_600_000} h — muted; needs a human`,
    );
  }
  return ok;
}

export function checkConcurrency(inFlightCount: number): BrainSelfHealLimitResult {
  if (inFlightCount >= BRAIN_SELFHEAL_LIMITS.maxConcurrentIncidents) {
    return fail("TOO_MANY_CONCURRENT", `${inFlightCount} incidents already in flight — pause new self-heal runs`);
  }
  return ok;
}

/* ---------------------------------------------------------------- v2 limits --- */

export type BrainSelfHealV2Violation =
  | "AUTONOMOUS_APPLY_RATE"
  | "MAX_ROLLBACK_ATTEMPTS"
  | "CAUSE_CHAIN_TOO_DEEP"
  | "SELF_HEAL_LOOP";

export interface BrainSelfHealV2LimitResult {
  readonly ok: boolean;
  readonly violation: BrainSelfHealV2Violation | null;
  readonly reason: string;
}
const okV2: BrainSelfHealV2LimitResult = Object.freeze({ ok: true, violation: null, reason: "within limits" });

/** Whether ANOTHER autonomous SAFE auto-apply is allowed right now. */
export function checkAutonomousApplyRate(applyTimestampsMs: readonly number[], nowMs: number): BrainSelfHealV2LimitResult {
  const inHour = applyTimestampsMs.filter((t) => nowMs - t <= 3_600_000).length;
  if (inHour >= BRAIN_SELFHEAL_LIMITS.maxAutonomousAppliesPerHour) {
    return { ok: false, violation: "AUTONOMOUS_APPLY_RATE", reason: `${inHour} autonomous applies in the last hour (max ${BRAIN_SELFHEAL_LIMITS.maxAutonomousAppliesPerHour}) — pausing auto-apply` };
  }
  return okV2;
}

export function checkRollbackAttempts(rollbackCount: number): BrainSelfHealV2LimitResult {
  if (rollbackCount >= BRAIN_SELFHEAL_LIMITS.maxRollbackAttempts) {
    return { ok: false, violation: "MAX_ROLLBACK_ATTEMPTS", reason: `${rollbackCount} auto-rollbacks for this incident (max ${BRAIN_SELFHEAL_LIMITS.maxRollbackAttempts}) — needs a human` };
  }
  return okV2;
}

/**
 * Loop-loop protection (§25). `chain` is the caused-by chain leading to THIS
 * incident (root → … → parent). Too deep, or a signature that already appears
 * in the chain (A→B→…→A), freezes the whole chain.
 */
export function checkCauseChain(chain: readonly { id: string; signature: string }[], freshSignature: string): BrainSelfHealV2LimitResult {
  if (chain.length >= BRAIN_SELFHEAL_LIMITS.maxCauseChainDepth) {
    return { ok: false, violation: "CAUSE_CHAIN_TOO_DEEP", reason: `self-heal cause chain is ${chain.length} deep (max ${BRAIN_SELFHEAL_LIMITS.maxCauseChainDepth}) — freezing the chain for a human` };
  }
  if (chain.some((c) => c.signature === freshSignature)) {
    return { ok: false, violation: "SELF_HEAL_LOOP", reason: `signature "${freshSignature}" already appears in this incident's cause chain (A→…→A loop) — freezing` };
  }
  return okV2;
}

function fail(violation: NonNullable<BrainSelfHealLimitResult["violation"]>, reason: string): BrainSelfHealLimitResult {
  return { ok: false, violation, reason };
}
