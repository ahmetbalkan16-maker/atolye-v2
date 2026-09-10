/**
 * Atölye Brain — page-lifecycle / unexpected-reload assessment (pure).
 *
 * iOS Safari (an installed PWA more so) will kill a memory-heavy page's web
 * content process and reload it from `start_url` with no warning — and a
 * service-worker update can also force a reload, and a React remount / bfcache
 * restore is neither. The Brain must (a) tell these apart with *evidence*, not a
 * guess, (b) surface that honestly in the Voice Lab, and (c) offer to resume a
 * voice session the reload interrupted.
 *
 * This module is the deterministic core. Given:
 *   - the previous boot record (`sessionStorage`),
 *   - the previous instance's last liveness heartbeat (`sessionStorage`),
 *   - the current navigation type (`PerformanceNavigationTiming.type`),
 *   - whether this load is a bfcache restore (`pageshow.persisted`),
 *   - whether the previous instance recorded a clean `pagehide`,
 * it classifies the transition. No DOM, no storage — `useBrainLifecycle` wires
 * those.
 *
 * Honesty rule: we can prove "the browser reloaded this page without a clean
 * unload while a voice session was live" (navigation=reload + no pagehide +
 * a fresh heartbeat). We CANNOT prove it was specifically an iOS memory
 * eviction vs a render crash — so the cause is `browser-reload-suspected`, and
 * the raw evidence (phase at death, uptime, dropped-frame count) rides along for
 * the operator to read.
 */

export const BRAIN_BOOT_STORAGE_KEY = "ayas.brain.boot.v1";
export const BRAIN_SW_RELOAD_KEY = "ayas.sw.reloadedAt.v1";
export const BRAIN_HEARTBEAT_KEY = "ayas.brain.heartbeat.v1";
export const BRAIN_VOICE_INTENT_KEY = "ayas.brain.voiceIntent.v1";

/** A reload within this window of an active voice session looks disruptive. */
export const EVICTION_WINDOW_MS = 15 * 60 * 1000;
/** A "sw reload" marker older than this is stale and ignored. */
export const SW_RELOAD_MARKER_TTL_MS = 20_000;
/** A heartbeat older than this tells us nothing precise about how the page died. */
export const HEARTBEAT_TRUST_MS = 12_000;
/** Interval the hook writes a heartbeat at while a voice session is armed. */
export const HEARTBEAT_INTERVAL_MS = 3_000;

/** Any adapter phase or engine state — a free-form telemetry label. */
export type BrainVoicePhase = string;

export type BrainNavigationKind =
  | "navigate"
  | "reload"
  | "back-forward"
  | "prerender"
  | "bfcache-restore"
  | "unknown";

export interface BrainBootRecord {
  /** Random id for this page instance. */
  readonly bootId: string;
  /** The prior instance's `bootId` (chain across reloads). */
  readonly previousBootId?: string;
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
  /** The prior instance recorded a `pagehide` (a clean unload) before this boot. */
  readonly cleanPagehide?: boolean;
  /** The last lifecycle event name the prior instance saw (e.g. `visibility:hidden`). */
  readonly lastEvent?: string;
}

/** A secret-free liveness beacon written every few seconds while voice is armed. */
export interface BrainHeartbeat {
  readonly bootId: string;
  /** `Date.now()` of this heartbeat. */
  readonly at: number;
  /** Page uptime (ms) when it was written. */
  readonly uptimeMs: number;
  readonly phase: BrainVoicePhase;
  readonly voiceActive: boolean;
  /** Wake frames dropped for back-pressure so far (`-1` = unknown). */
  readonly droppedFrames: number;
  /** Wake inferences run so far (`-1` = unknown). */
  readonly wakeInferences: number;
  readonly audioContextState: string;
  /** `document.visibilityState` when this heartbeat was written. */
  readonly visibilityState: string;
  /** Was the screen wake lock held? (`null` = unknown / unsupported.) */
  readonly wakeLockHeld: boolean | null;
  readonly lastError: string | null;
}

export type BrainReloadCause =
  | "first-boot"
  | "bfcache-restore"
  | "sw-update"
  | "browser-reload-suspected"
  | "manual-reload-or-nav";

export interface BrainPriorInstanceEvidence {
  /** A heartbeat fresh enough (< HEARTBEAT_TRUST_MS old at boot) was found. */
  readonly hadFreshHeartbeat: boolean;
  /** Uptime (ms) the prior instance reached by its last heartbeat, or null. */
  readonly diedAfterMs: number | null;
  /** How long before this boot the prior instance's last heartbeat was (ms), or null. */
  readonly heartbeatAgeAtBootMs: number | null;
  /** Phase the prior instance was in at its last heartbeat, or null. */
  readonly diedAtPhase: BrainVoicePhase | null;
  readonly droppedFrames: number | null;
  readonly wakeInferences: number | null;
  readonly audioContextState: string | null;
  /** Was the tab hidden (backgrounded / screen locked) at the last heartbeat / event? */
  readonly diedHidden: boolean;
  readonly wakeLockHeld: boolean | null;
  readonly lastError: string | null;
}

/**
 * When the browser tore the page down, was it in the FOREGROUND (a memory kill
 * while the user was looking at it) or the BACKGROUND (screen Auto-Lock / app
 * switch → WebKit process eviction)? The fix differs: foreground → cut the
 * footprint; background → hold the screen wake lock + restore seamlessly.
 */
export type BrainEvictionKind =
  | "foreground-memory-suspected"
  | "background-eviction-suspected"
  | "unknown";

export interface BrainReloadAssessment {
  readonly firstBoot: boolean;
  /** The page was replaced while a voice session was active — the disruptive case. */
  readonly unexpectedReload: boolean;
  readonly cause: BrainReloadCause;
  readonly navigationKind: BrainNavigationKind;
  readonly sinceLastBootMs: number;
  readonly priorVoiceActive: boolean;
  readonly priorVoiceCycles: number;
  readonly priorPhase: BrainVoicePhase;
  readonly priorCleanPagehide: boolean;
  /** The last lifecycle event the prior instance recorded, or `"unknown"`. */
  readonly priorLastEvent: string;
  readonly bootCount: number;
  readonly previousBootId: string | null;
  readonly priorInstance: BrainPriorInstanceEvidence | null;
  /**
   * The browser tore the page down without a clean unload while a voice session
   * was live — provable from (navigation=reload | fresh heartbeat) + no
   * pagehide + prior voice active. Not proof of *which* browser mechanism.
   */
  readonly browserReloadLikely: boolean;
  /** If `browserReloadLikely`, the best guess at foreground-kill vs background-eviction. */
  readonly evictionKind: BrainEvictionKind;
}

export interface AssessBrainReloadInput {
  readonly prev: BrainBootRecord | null;
  readonly heartbeat: BrainHeartbeat | null;
  readonly nowMs: number;
  readonly navigationKind: BrainNavigationKind;
  /** `pageshow` fired with `persisted === true` — the page was NOT destroyed. */
  readonly bfcacheRestore: boolean;
  /** `Date.now()` written by `PwaRegister` just before a service-worker reload. */
  readonly swReloadMarkerAt: number | null;
}

const FIRST_BOOT: Omit<BrainReloadAssessment, "navigationKind"> = {
  firstBoot: true,
  unexpectedReload: false,
  cause: "first-boot",
  sinceLastBootMs: 0,
  priorVoiceActive: false,
  priorVoiceCycles: 0,
  priorPhase: "off",
  priorCleanPagehide: false,
  priorLastEvent: "unknown",
  bootCount: 1,
  previousBootId: null,
  priorInstance: null,
  browserReloadLikely: false,
  evictionKind: "unknown",
};

/** ms a hidden tab's timers run before iOS freezes them — a bigger heartbeat gap = was backgrounded. */
const BACKGROUND_FREEZE_HINT_MS = 20_000;

function priorEvidence(
  heartbeat: BrainHeartbeat | null,
  prev: BrainBootRecord | null,
  nowMs: number,
): BrainPriorInstanceEvidence | null {
  if (!heartbeat) return null;
  // A heartbeat is only the *prior* instance's if its bootId differs from... we
  // don't know the current bootId here; the hook only passes a heartbeat whose
  // bootId matches the prev record (or no prev). Trust it.
  if (prev && heartbeat.bootId !== prev.bootId) return null;
  const age = Math.max(0, nowMs - heartbeat.at);
  return {
    hadFreshHeartbeat: age < HEARTBEAT_TRUST_MS,
    diedAfterMs: heartbeat.uptimeMs,
    heartbeatAgeAtBootMs: age,
    diedAtPhase: heartbeat.phase,
    droppedFrames: heartbeat.droppedFrames >= 0 ? heartbeat.droppedFrames : null,
    wakeInferences: heartbeat.wakeInferences >= 0 ? heartbeat.wakeInferences : null,
    audioContextState: heartbeat.audioContextState || null,
    diedHidden: heartbeat.visibilityState === "hidden",
    wakeLockHeld: typeof heartbeat.wakeLockHeld === "boolean" ? heartbeat.wakeLockHeld : null,
    lastError: heartbeat.lastError,
  };
}

function classifyEviction(
  prev: BrainBootRecord,
  evidence: BrainPriorInstanceEvidence | null,
): BrainEvictionKind {
  const lastEvent = prev.lastEvent ?? "";
  const wasHiddenLast = lastEvent.startsWith("visibility:hidden") || lastEvent === "pagehide";
  const heartbeatSaysHidden = evidence?.diedHidden === true;
  const bigHeartbeatGap =
    evidence?.heartbeatAgeAtBootMs != null && evidence.heartbeatAgeAtBootMs > BACKGROUND_FREEZE_HINT_MS;
  if (wasHiddenLast || heartbeatSaysHidden || bigHeartbeatGap) {
    // screen Auto-Lock / app switch → the tab was backgrounded, then evicted
    return "background-eviction-suspected";
  }
  if (evidence?.hadFreshHeartbeat && !evidence.diedHidden) {
    // alive and visible seconds before the reload → a memory kill in the foreground
    return "foreground-memory-suspected";
  }
  return "unknown";
}

export function assessBrainReload(input: AssessBrainReloadInput): BrainReloadAssessment {
  const { prev, heartbeat, nowMs, navigationKind, bfcacheRestore, swReloadMarkerAt } = input;

  if (!prev) {
    return { ...FIRST_BOOT, navigationKind };
  }

  const sinceLastBootMs = Math.max(0, nowMs - prev.bootAt);
  const swReload =
    swReloadMarkerAt != null &&
    nowMs - swReloadMarkerAt >= 0 &&
    nowMs - swReloadMarkerAt < SW_RELOAD_MARKER_TTL_MS;
  const evidence = priorEvidence(heartbeat, prev, nowMs);
  const priorCleanPagehide = prev.cleanPagehide === true;

  // The browser replaced a live page with no clean unload: navigation says
  // "reload" (or a fresh heartbeat proves the prior instance was alive seconds
  // ago) AND no pagehide was recorded AND a voice session was armed.
  const browserReloadLikely =
    !bfcacheRestore &&
    !swReload &&
    !priorCleanPagehide &&
    prev.voiceWasActive &&
    sinceLastBootMs < EVICTION_WINDOW_MS &&
    (navigationKind === "reload" ||
      navigationKind === "navigate" ||
      (evidence?.hadFreshHeartbeat ?? false));

  const cause: BrainReloadCause = bfcacheRestore
    ? "bfcache-restore"
    : swReload
      ? "sw-update"
      : browserReloadLikely
        ? "browser-reload-suspected"
        : "manual-reload-or-nav";

  return {
    firstBoot: false,
    // "unexpected" (worth telling the user + offering resume) only when a voice
    // session was actually running AND the page really went away (not bfcache).
    unexpectedReload: prev.voiceWasActive && !bfcacheRestore,
    cause,
    navigationKind,
    sinceLastBootMs,
    priorVoiceActive: prev.voiceWasActive,
    priorVoiceCycles: prev.voiceCycleCount,
    priorPhase: prev.lastPhase,
    priorCleanPagehide,
    priorLastEvent: prev.lastEvent ?? "unknown",
    bootCount: prev.bootCount + 1,
    previousBootId: prev.bootId || null,
    priorInstance: evidence,
    browserReloadLikely,
    evictionKind: browserReloadLikely ? classifyEviction(prev, evidence) : "unknown",
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
      previousBootId: typeof v.previousBootId === "string" ? v.previousBootId : undefined,
      bootCount: v.bootCount,
      bootAt: v.bootAt,
      voiceWasActive: v.voiceWasActive === true,
      voiceCycleCount: typeof v.voiceCycleCount === "number" ? v.voiceCycleCount : 0,
      lastPhase: (typeof v.lastPhase === "string" ? v.lastPhase : "off") as BrainVoicePhase,
      recoveryCount: typeof v.recoveryCount === "number" ? v.recoveryCount : 0,
      cleanPagehide: v.cleanPagehide === true,
      lastEvent: typeof v.lastEvent === "string" ? v.lastEvent : undefined,
    };
  } catch {
    return null;
  }
}

/** Parse a stored heartbeat, tolerating any corruption. */
export function parseBrainHeartbeat(raw: string | null): BrainHeartbeat | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<BrainHeartbeat>;
    if (typeof v.at !== "number" || typeof v.bootId !== "string") return null;
    return {
      bootId: v.bootId,
      at: v.at,
      uptimeMs: typeof v.uptimeMs === "number" ? v.uptimeMs : 0,
      phase: (typeof v.phase === "string" ? v.phase : "unknown") as BrainVoicePhase,
      voiceActive: v.voiceActive === true,
      droppedFrames: typeof v.droppedFrames === "number" ? v.droppedFrames : -1,
      wakeInferences: typeof v.wakeInferences === "number" ? v.wakeInferences : -1,
      audioContextState: typeof v.audioContextState === "string" ? v.audioContextState : "",
      visibilityState: typeof v.visibilityState === "string" ? v.visibilityState : "unknown",
      wakeLockHeld: typeof v.wakeLockHeld === "boolean" ? v.wakeLockHeld : null,
      lastError: typeof v.lastError === "string" ? v.lastError : null,
    };
  } catch {
    return null;
  }
}

/** Map `PerformanceNavigationTiming.type` (or the legacy enum) to our kind. */
export function navigationKindFrom(
  navType: string | number | undefined,
  bfcacheRestore: boolean,
): BrainNavigationKind {
  if (bfcacheRestore) return "bfcache-restore";
  switch (navType) {
    case "reload":
    case 1:
      return "reload";
    case "back_forward":
    case 2:
      return "back-forward";
    case "prerender":
      return "prerender";
    case "navigate":
    case 0:
      return "navigate";
    default:
      return "unknown";
  }
}

/** A compact, secret-free lifecycle snapshot for the Voice Lab diagnostics. */
export interface BrainLifecycleTelemetry {
  readonly bootId: string;
  readonly previousBootId: string | null;
  readonly bootCount: number;
  readonly sessionUptimeMs: number;
  readonly reloadCause: BrainReloadCause;
  readonly navigationKind: BrainNavigationKind;
  readonly browserReloadLikely: boolean;
  readonly evictionKind: BrainEvictionKind;
  readonly unexpectedReload: boolean;
  readonly priorVoiceActive: boolean;
  readonly priorVoiceCycles: number;
  readonly priorCleanPagehide: boolean;
  /** Phase the prior page instance was in at its last heartbeat, or "unknown". */
  readonly priorDiedAtPhase: string;
  /** Was the prior instance hidden (backgrounded / screen locked) when it died? */
  readonly priorDiedHidden: boolean;
  /** Screen wake lock held by the prior instance? (`null` = unknown.) */
  readonly priorWakeLockHeld: boolean | null;
  /** Uptime (ms) the prior instance reached, or -1. */
  readonly priorDiedAfterMs: number;
  /** ms between the prior instance's last heartbeat and this boot, or -1. */
  readonly priorHeartbeatAgeMs: number;
  readonly priorDroppedFrames: number;
  /** The last lifecycle event the prior instance recorded (e.g. `visibility:hidden`). */
  readonly priorLastEvent: string;
  /** Screen wake lock held right now? (`null` = unknown / unsupported.) */
  readonly wakeLockHeld: boolean | null;
  readonly voiceSessionCount: number;
  readonly voiceCycleCount: number;
  readonly lastVoicePhase: BrainVoicePhase;
  readonly wakeDroppedFrames: number;
  /** Last turn latency marks (ms): command capture, STT round-trip, wake→capture-end. `-1` = none. */
  readonly lastCaptureMs: number;
  readonly lastSttMs: number;
  readonly lastWakeToCaptureMs: number;
  readonly recoveryCount: number;
  readonly visibilityState: string;
  readonly onlineState: boolean;
  readonly serviceWorkerState: "unsupported" | "none" | "installing" | "waiting" | "active" | "controlled";
  readonly lastLifecycleEvent: string;
  readonly lastLifecycleEventAt: number;
}
