/**
 * Atölye Brain — Self-Healing: anomaly classifier (pure, deterministic).
 *
 * Not every wobble is a bug. This maps a raw telemetry snapshot to one of:
 *
 *   EXPECTED        a normal transition (idle → wake → idle, a clean pagehide)
 *   TRANSIENT       recovered on its own inside a bounded retry (paused → wake)
 *   USER_ACTION     the user did it (a real reload, a nav click, muting voice)
 *   KNOWN_BASELINE  matches a signature the operator has already triaged
 *   REAL_INCIDENT   a genuine fault with no benign explanation
 *   UNKNOWN         something is off but the evidence does not prove a cause
 *
 * The hard rule (emir §5): **no proof ⇒ UNKNOWN.** A missing browser-level
 * reload source is never reported as "the browser reloaded it". A page that
 * came back with a fresh heartbeat + a `visible` prior state + no clean
 * pagehide is `foreground-memory-suspected`, not "the OS killed it".
 */

import type { BrainAnomalyClassification, BrainIncidentCategory, BrainIncidentSeverity } from "./BrainIncident";

/** The disambiguated reason a page instance ended — never a guess dressed as fact. */
export type BrainReloadReason =
  | "USER_INITIATED_RELOAD"
  | "USER_NAVIGATION"
  | "BROWSER_RELOAD"
  | "PWA_LIFECYCLE_RESET"
  | "PAGE_RELOAD"
  | "CRASH"
  | "UNEXPECTED_UNLOAD"
  | "UNKNOWN";

/** The slice of `BrainLifecycleTelemetry` the classifier reads (kept loose to avoid a hard import cycle). */
export interface BrainAnomalySnapshot {
  readonly reloadCause: string; // BrainReloadCause
  readonly navigationKind: string; // "reload" | "navigate" | "back-forward" | "prerender" | "restore" | "unknown"
  readonly evictionKind: string; // BrainEvictionKind
  readonly unexpectedReload: boolean;
  readonly browserReloadLikely: boolean;
  readonly firstBoot: boolean;
  readonly priorVoiceActive: boolean;
  readonly priorCleanPagehide: boolean;
  readonly priorDiedHidden: boolean;
  readonly priorDiedAtPhase: string;
  readonly priorHeartbeatAgeMs: number; // -1 unknown
  readonly priorLastEvent: string;
  readonly bfcacheRestore?: boolean;
  readonly swReloadMarker?: boolean;
  /** Explicit operator/user markers captured at click time, when available. */
  readonly userGestureReload?: boolean;
  readonly userNavigationClick?: boolean;
}

export interface BrainVoiceAnomalySnapshot {
  readonly phase: string; // WakeAdapterPhase
  readonly mic: string; // WakeAdapterStatus.mic
  readonly recoveryCount: number;
  readonly droppedFrames: number;
  readonly frameAgeMs: number;
  readonly lastError: string | null;
  readonly lastCaptureMs: number;
  readonly lastSttMs: number;
}

/** An operator-triaged signature to treat as KNOWN_BASELINE (not a fresh incident). */
export interface BrainKnownBaseline {
  readonly id: string;
  readonly signature: string; // brainIncidentSignature() form
  readonly note: string;
}

export interface BrainAnomalyResult {
  readonly classification: BrainAnomalyClassification;
  readonly reloadReason: BrainReloadReason;
  readonly category: BrainIncidentCategory;
  readonly severity: BrainIncidentSeverity;
  readonly reason: string;
  readonly signals: Readonly<Record<string, string | number | boolean | null>>;
  /** True ⇒ open an incident. False ⇒ record & move on. */
  readonly openIncident: boolean;
}

const EMPTY = "";

/** Disambiguate why the previous page instance ended. Conservative: proof or UNKNOWN. */
export function classifyReloadReason(s: BrainAnomalySnapshot): BrainReloadReason {
  if (s.firstBoot) return "UNKNOWN"; // nothing ended; this is the first boot
  if (s.userGestureReload === true) return "USER_INITIATED_RELOAD";
  if (s.userNavigationClick === true) return "USER_NAVIGATION";
  if (s.bfcacheRestore === true || s.reloadCause === "bfcache-restore") return "PWA_LIFECYCLE_RESET";
  if (s.swReloadMarker === true || s.reloadCause === "sw-update") return "PWA_LIFECYCLE_RESET";
  if (s.navigationKind === "back-forward") return "USER_NAVIGATION";
  if (s.navigationKind === "navigate" && s.priorCleanPagehide) return "USER_NAVIGATION";
  if (s.navigationKind === "reload") {
    // A reload navigation entry with a clean prior pagehide is the user's F5 /
    // pull-to-refresh; without one it is a browser-driven reload.
    return s.priorCleanPagehide ? "USER_INITIATED_RELOAD" : "BROWSER_RELOAD";
  }
  // A recorded error / unhandled rejection right before the teardown ⇒ a crash.
  if (/\b(error|crash|rejection|fatal)\b/i.test(s.priorLastEvent) && !s.priorCleanPagehide) return "CRASH";
  // Died without a clean pagehide, but no error signal ⇒ we know it ended
  // unexpectedly, not *why* — that stays UNEXPECTED_UNLOAD (never dressed as a crash).
  if (!s.priorCleanPagehide && (s.priorDiedHidden || s.priorVoiceActive)) return "UNEXPECTED_UNLOAD";
  if (s.reloadCause === "browser-reload-suspected") return "PAGE_RELOAD";
  return "UNKNOWN";
}

function reloadReasonIsUserAction(r: BrainReloadReason): boolean {
  return r === "USER_INITIATED_RELOAD" || r === "USER_NAVIGATION";
}

export interface BrainAnomalyInput {
  readonly lifecycle: BrainAnomalySnapshot;
  readonly voice?: BrainVoiceAnomalySnapshot | null;
  readonly knownBaselines?: readonly BrainKnownBaseline[];
  /** For the KNOWN_BASELINE check — the signature this snapshot would produce. */
  readonly signature?: string;
}

/** Classify a lifecycle + voice snapshot. Deterministic; safe to call every heartbeat. */
export function classifyBrainAnomaly(input: BrainAnomalyInput): BrainAnomalyResult {
  const l = input.lifecycle;
  const v = input.voice ?? null;
  const reloadReason = classifyReloadReason(l);

  const baseSignals: Record<string, string | number | boolean | null> = {
    reloadCause: l.reloadCause,
    navigationKind: l.navigationKind,
    evictionKind: l.evictionKind,
    reloadReason,
    priorCleanPagehide: l.priorCleanPagehide,
    priorDiedHidden: l.priorDiedHidden,
    priorVoiceActive: l.priorVoiceActive,
    priorDiedAtPhase: l.priorDiedAtPhase || EMPTY,
    priorHeartbeatAgeMs: l.priorHeartbeatAgeMs,
    ...(v
      ? {
          voicePhase: v.phase,
          voiceMic: v.mic,
          recoveryCount: v.recoveryCount,
          droppedFrames: v.droppedFrames,
          voiceLastError: v.lastError,
        }
      : {}),
  };

  const known = matchKnownBaseline(input.knownBaselines, input.signature);
  if (known) {
    return result("KNOWN_BASELINE", reloadReason, "lifecycle", "P3", `Matches triaged baseline "${known.id}": ${known.note}`, baseSignals, false);
  }

  // 0 — the voice pipeline's own state is classified FIRST, regardless of how
  //     the page got here (a user reload does not excuse a FATAL wake engine,
  //     and a `paused` mic is a voice event, not a navigation event).
  if (v) {
    if (v.mic === "fatal") {
      return result("REAL_INCIDENT", reloadReason, "voice", "P0", `Wake pipeline reached a FATAL state (last error: ${v.lastError ?? "n/a"}).`, baseSignals, true);
    }
    if (v.mic === "paused" && v.recoveryCount >= 3) {
      return result("REAL_INCIDENT", reloadReason, "voice", "P1", `Wake pipeline paused and has not self-healed after ${v.recoveryCount} recoveries.`, baseSignals, true);
    }
    if (v.frameAgeMs > 4000 && (v.phase === "wake" || v.phase === "capturing")) {
      return result("REAL_INCIDENT", reloadReason, "voice", "P1", `No audio frame for ${v.frameAgeMs} ms while armed — the capture graph stalled.`, baseSignals, true);
    }
    if (v.lastCaptureMs >= 0 && v.lastCaptureMs < 900 && v.phase === "idle") {
      return result("REAL_INCIDENT", reloadReason, "voice", "P1", `Last command capture was only ${v.lastCaptureMs} ms — an early VAD endpoint (command likely lost).`, baseSignals, true);
    }
    if (v.droppedFrames > 400) {
      return result("REAL_INCIDENT", reloadReason, "performance", "P2", `${v.droppedFrames} wake frames dropped — sustained back-pressure on the runner.`, baseSignals, true);
    }
    if (v.mic === "paused") {
      return result("TRANSIENT", reloadReason, "voice", "P2", "Wake pipeline paused; still inside the bounded self-heal schedule.", baseSignals, false);
    }
    if (v.mic === "recovering") {
      return result("TRANSIENT", reloadReason, "voice", "P2", "Wake pipeline is re-acquiring the mic / AudioContext.", baseSignals, false);
    }
  }

  // 1 — the user did it.
  if (!l.firstBoot && reloadReasonIsUserAction(reloadReason)) {
    return result("USER_ACTION", reloadReason, "lifecycle", "P3", `Page ended by a user action (${reloadReason}).`, baseSignals, false);
  }

  // 2 — first boot / clean shutdown → expected.
  if (l.firstBoot || (l.priorCleanPagehide && !l.priorVoiceActive)) {
    return result("EXPECTED", reloadReason, "lifecycle", "P3", "First boot or a clean shutdown with no active voice session.", baseSignals, false);
  }

  // 3 — a voice session was interrupted with no benign reason → a real lifecycle incident.
  const interruptedVoice = l.priorVoiceActive && !l.priorCleanPagehide;
  if (interruptedVoice && reloadReason === "CRASH") {
    return result(
      "REAL_INCIDENT",
      reloadReason,
      "lifecycle",
      "P0",
      `A live voice session was lost to a crash (an error was recorded before the teardown); eviction: ${l.evictionKind}.`,
      baseSignals,
      true,
    );
  }
  if (interruptedVoice && reloadReason === "UNEXPECTED_UNLOAD") {
    // We can prove it ended unexpectedly. We can only *name* the cause when the
    // eviction classifier has a suspicion; otherwise it stays UNKNOWN (§5).
    if (l.evictionKind === "unknown") {
      return result(
        "UNKNOWN",
        reloadReason,
        "lifecycle",
        "P1",
        "A live voice session ended without a clean pagehide, but the teardown source is not provable (no error, no eviction signal, no navigation).",
        baseSignals,
        true,
      );
    }
    return result(
      "REAL_INCIDENT",
      reloadReason,
      "lifecycle",
      "P0",
      `A live voice session was lost to a suspected ${l.evictionKind.replace(/-/g, " ")}.`,
      baseSignals,
      true,
    );
  }
  if (interruptedVoice && reloadReason === "BROWSER_RELOAD") {
    return result(
      "REAL_INCIDENT",
      reloadReason,
      "lifecycle",
      "P1",
      "The browser reloaded the page during a voice session (not user-initiated, no SW update marker).",
      baseSignals,
      true,
    );
  }
  if (interruptedVoice && reloadReason === "PWA_LIFECYCLE_RESET") {
    // A deferred SW update that fired mid-session is a design tension, not a crash.
    return result("TRANSIENT", reloadReason, "lifecycle", "P2", "A PWA lifecycle reset (bfcache / SW update) interrupted the session; recoverable.", baseSignals, false);
  }

  // 4 — something ended a session with no clean pagehide but we cannot prove why.
  if (interruptedVoice) {
    return result("UNKNOWN", reloadReason, "lifecycle", "P2", "A voice session ended without a clean pagehide, but the teardown source is not provable.", baseSignals, true);
  }

  return result("EXPECTED", reloadReason, "lifecycle", "P3", "No anomaly.", baseSignals, false);
}

function matchKnownBaseline(
  baselines: readonly BrainKnownBaseline[] | undefined,
  signature: string | undefined,
): BrainKnownBaseline | null {
  if (!baselines || !signature) return null;
  return baselines.find((b) => b.signature === signature) ?? null;
}

function result(
  classification: BrainAnomalyClassification,
  reloadReason: BrainReloadReason,
  category: BrainIncidentCategory,
  severity: BrainIncidentSeverity,
  reason: string,
  signals: Record<string, string | number | boolean | null>,
  openIncident: boolean,
): BrainAnomalyResult {
  return {
    classification,
    reloadReason,
    category,
    severity,
    reason,
    signals: Object.freeze(signals),
    // Open an incident for a proven fault (REAL_INCIDENT) or an unexplained
    // session loss (UNKNOWN with openIncident set). Never for EXPECTED /
    // TRANSIENT / USER_ACTION / KNOWN_BASELINE.
    openIncident: openIncident && (classification === "REAL_INCIDENT" || classification === "UNKNOWN"),
  };
}
