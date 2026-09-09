/**
 * Atölye Brain — page-lifecycle / unexpected-reload assessment (pure).
 *
 * iOS Safari (and an installed PWA even more so) will silently evict a
 * memory-heavy page and reload it from `start_url` when it comes back — and a
 * service-worker update can also force a reload. Neither is an app bug, but the
 * Brain must (a) know it happened, (b) tell the operator honestly in the Voice
 * Lab, and (c) offer to resume a voice session that was interrupted.
 *
 * This module is the deterministic core: given the previous boot record (from
 * `sessionStorage`) and a few facts about the current boot, it classifies the
 * transition. No DOM, no storage — the hook (`useBrainLifecycle`) wires those.
 */

export const BRAIN_BOOT_STORAGE_KEY = "ayas.brain.boot.v1";
export const BRAIN_SW_RELOAD_KEY = "ayas.sw.reloadedAt.v1";
/** A reload within this window of an active voice session looks like eviction. */
export const EVICTION_WINDOW_MS = 15 * 60 * 1000;
/** A "sw reload" marker older than this is stale and ignored. */
export const SW_RELOAD_MARKER_TTL_MS = 20_000;

/** Any adapter phase or engine state — a free-form telemetry label. */
export type BrainVoicePhase = string;

export interface BrainBootRecord {
  /** Random id for this page instance. */
  readonly bootId: string;
  /** Monotonic across reloads within one tab/PWA session. */
  readonly bootCount: number;
  /** `Date.now()` at boot. */
  readonly bootAt: number;
  /** Was hands-free voice armed when this record was last written? */
  readonly voiceWasActive: boolean;
  /** Completed wake→…→re-arm cycles at last write. */
  readonly voiceCycleCount: number;
  /** Last known adapter phase at last write. */
  readonly lastPhase: BrainVoicePhase;
  /** How many controlled voice recoveries happened this session. */
  readonly recoveryCount: number;
}

export type BrainReloadCause =
  | "first-boot"
  | "sw-update"
  | "eviction-suspected"
  | "reload-or-navigation";

export interface BrainReloadAssessment {
  readonly firstBoot: boolean;
  /** The page was replaced while a voice session was active — the disruptive case. */
  readonly unexpectedReload: boolean;
  readonly cause: BrainReloadCause;
  readonly sinceLastBootMs: number;
  readonly priorVoiceActive: boolean;
  readonly priorVoiceCycles: number;
  readonly priorPhase: BrainVoicePhase;
  readonly bootCount: number;
}

export interface AssessBrainReloadInput {
  readonly prev: BrainBootRecord | null;
  readonly nowMs: number;
  /** `Date.now()` written by `PwaRegister` just before a service-worker reload. */
  readonly swReloadMarkerAt: number | null;
}

export function assessBrainReload(input: AssessBrainReloadInput): BrainReloadAssessment {
  const { prev, nowMs, swReloadMarkerAt } = input;

  if (!prev) {
    return {
      firstBoot: true,
      unexpectedReload: false,
      cause: "first-boot",
      sinceLastBootMs: 0,
      priorVoiceActive: false,
      priorVoiceCycles: 0,
      priorPhase: "off",
      bootCount: 1,
    };
  }

  const sinceLastBootMs = Math.max(0, nowMs - prev.bootAt);
  const swReload =
    swReloadMarkerAt != null && nowMs - swReloadMarkerAt >= 0 && nowMs - swReloadMarkerAt < SW_RELOAD_MARKER_TTL_MS;

  const cause: BrainReloadCause = swReload
    ? "sw-update"
    : prev.voiceWasActive && sinceLastBootMs < EVICTION_WINDOW_MS
      ? "eviction-suspected"
      : "reload-or-navigation";

  return {
    firstBoot: false,
    // Only "unexpected" (worth telling the user + offering resume) when a voice
    // session was actually running. A plain reload of an idle page is noise.
    unexpectedReload: prev.voiceWasActive,
    cause,
    sinceLastBootMs,
    priorVoiceActive: prev.voiceWasActive,
    priorVoiceCycles: prev.voiceCycleCount,
    priorPhase: prev.lastPhase,
    bootCount: prev.bootCount + 1,
  };
}

/** Parse a stored boot record, tolerating any corruption. */
export function parseBrainBootRecord(raw: string | null): BrainBootRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<BrainBootRecord>;
    if (typeof v.bootAt !== "number" || typeof v.bootCount !== "number") return null;
    return {
      bootId: typeof v.bootId === "string" ? v.bootId : "unknown",
      bootCount: v.bootCount,
      bootAt: v.bootAt,
      voiceWasActive: v.voiceWasActive === true,
      voiceCycleCount: typeof v.voiceCycleCount === "number" ? v.voiceCycleCount : 0,
      lastPhase: (typeof v.lastPhase === "string" ? v.lastPhase : "off") as BrainVoicePhase,
      recoveryCount: typeof v.recoveryCount === "number" ? v.recoveryCount : 0,
    };
  } catch {
    return null;
  }
}

/** A compact, secret-free lifecycle snapshot for the Voice Lab diagnostics. */
export interface BrainLifecycleTelemetry {
  readonly bootId: string;
  readonly bootCount: number;
  readonly sessionUptimeMs: number;
  readonly reloadCause: BrainReloadCause;
  readonly unexpectedReload: boolean;
  readonly priorVoiceActive: boolean;
  readonly priorVoiceCycles: number;
  readonly voiceSessionCount: number;
  readonly voiceCycleCount: number;
  readonly lastVoicePhase: BrainVoicePhase;
  readonly recoveryCount: number;
  readonly visibilityState: string;
  readonly onlineState: boolean;
  readonly serviceWorkerState: "unsupported" | "none" | "installing" | "waiting" | "active" | "controlled";
  readonly lastLifecycleEvent: string;
  readonly lastLifecycleEventAt: number;
}
