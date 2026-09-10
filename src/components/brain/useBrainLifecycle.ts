"use client";

/**
 * Atölye Brain — page-lifecycle tracking + unexpected-reload detection.
 *
 * Writes a small `sessionStorage` boot record on every Brain load, compares it
 * with the previous one plus the previous instance's last liveness heartbeat,
 * and classifies the transition (first boot / bfcache restore / SW update /
 * suspected browser reload / manual reload). It keeps a secret-free lifecycle
 * telemetry snapshot for the Voice Lab, and tells `BrainCoreConsole` when a
 * voice session was interrupted so the UI can offer to resume it.
 *
 * While a voice session is armed it writes a heartbeat every few seconds; the
 * NEXT boot reads it to report *where* and *how far in* the previous instance
 * died — the evidence that separates "iOS killed the page mid-listen" from a
 * plain navigation or a React remount.
 *
 * No network, no polling of the server. `sessionStorage` + refs + one short
 * interval (only while voice is armed). The recorders are pure side effects.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  assessBrainReload,
  navigationKindFrom,
  parseBrainBootRecord,
  parseBrainHeartbeat,
  BRAIN_BOOT_STORAGE_KEY,
  BRAIN_SW_RELOAD_KEY,
  BRAIN_HEARTBEAT_KEY,
  BRAIN_VOICE_INTENT_KEY,
  HEARTBEAT_INTERVAL_MS,
  type BrainBootRecord,
  type BrainHeartbeat,
  type BrainLifecycleTelemetry,
  type BrainReloadAssessment,
  type BrainVoicePhase,
} from "@/lib/brain/ui/brainLifecycle";

function readSession(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* private mode / disabled — telemetry is best-effort */
  }
}
function clearSession(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function swState(): BrainLifecycleTelemetry["serviceWorkerState"] {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return "unsupported";
  return navigator.serviceWorker.controller ? "controlled" : "none";
}

/** `PerformanceNavigationTiming.type`, or the legacy `performance.navigation.type`. */
function rawNavigationType(): string | number | undefined {
  try {
    const entry = performance.getEntriesByType?.("navigation")?.[0] as
      | { type?: string }
      | undefined;
    if (entry?.type) return entry.type;
    const legacy = (performance as unknown as { navigation?: { type?: number } }).navigation;
    return legacy?.type;
  } catch {
    return undefined;
  }
}

/** Health the wake adapter reports — folded into the heartbeat. */
export interface BrainVoiceHealth {
  readonly phase?: BrainVoicePhase;
  readonly droppedFrames?: number;
  readonly wakeInferences?: number;
  readonly audioContextState?: string;
  readonly lastCaptureMs?: number;
  readonly lastSttMs?: number;
  readonly lastWakeToCaptureMs?: number;
  /** Conversation Session Mode — `true` while follow-up commands skip the wake word. */
  readonly conversationActive?: boolean;
  readonly conversationArmed?: boolean;
  /** Why the last conversation session closed (`idle-timeout` / `explicit-stop` / `fatal` / `disposed`). */
  readonly conversationClosedReason?: string | null;
  readonly lastError?: string | null;
}

const OFF_ASSESSMENT: BrainReloadAssessment = {
  firstBoot: true,
  unexpectedReload: false,
  cause: "first-boot",
  navigationKind: "unknown",
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

export interface UseBrainLifecycleResult {
  readonly assessment: BrainReloadAssessment;
  /** `true` while a reload-interrupted voice session is unacknowledged. */
  readonly voiceSessionInterrupted: boolean;
  /** The user has, at some point this tab session, asked for hands-free voice. */
  readonly voiceIntentPersisted: boolean;
  /** A fresh secret-free telemetry snapshot (call each render — no state churn). */
  getTelemetry(): BrainLifecycleTelemetry;
  /** Hands-free voice was armed / disarmed. */
  markVoiceActive(active: boolean): void;
  /** One completed wake→…→re-arm cycle. */
  noteVoiceCycle(): void;
  /** Latest adapter phase (cheap — persisted only at lifecycle moments). */
  notePhase(phase: BrainVoicePhase): void;
  /** Latest wake-adapter health numbers (folded into the heartbeat). */
  noteVoiceHealth(health: BrainVoiceHealth): void;
  /** Screen wake lock acquired / lost — folded into the heartbeat + telemetry. */
  noteWakeLock(held: boolean): void;
  /** A controlled voice-pipeline recovery ran. */
  noteRecovery(): void;
  /** The operator acknowledged / resumed the interrupted session. */
  dismissInterrupted(): void;
  /** Remember (or forget) that the user wants hands-free voice, across reloads. */
  setVoiceIntent(want: boolean): void;
}

export function useBrainLifecycle(): UseBrainLifecycleResult {
  // Assess once, on the client, during the first render (lazy init — not an effect).
  const [assessment] = useState<BrainReloadAssessment>(() => {
    if (typeof window === "undefined") return OFF_ASSESSMENT;
    const prev = parseBrainBootRecord(readSession(BRAIN_BOOT_STORAGE_KEY));
    const heartbeat = parseBrainHeartbeat(readSession(BRAIN_HEARTBEAT_KEY));
    const markerRaw = readSession(BRAIN_SW_RELOAD_KEY);
    const swReloadMarkerAt = markerRaw && Number.isFinite(Number(markerRaw)) ? Number(markerRaw) : null;
    // `pageshow.persisted` only arrives in an event; at first render assume not
    // a bfcache restore (the pageshow handler re-assesses if it was).
    const navigationKind = navigationKindFrom(rawNavigationType(), false);
    return assessBrainReload({
      prev,
      heartbeat,
      nowMs: Date.now(),
      navigationKind,
      bfcacheRestore: false,
      swReloadMarkerAt,
    });
  });

  const [bootId] = useState<string>(() => {
    if (typeof window === "undefined") return "ssr";
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  });
  const [startedAt] = useState<number>(() => Date.now());
  const [bfcacheRestored, setBfcacheRestored] = useState(false);

  const stateRef = useRef<{
    voiceActive: boolean;
    voiceCycleCount: number;
    voiceSessionCount: number;
    lastPhase: BrainVoicePhase;
    recoveryCount: number;
    cleanPagehide: boolean;
    wakeLockHeld: boolean | null;
    health: BrainVoiceHealth;
  } | null>(null);
  if (stateRef.current === null) {
    stateRef.current = {
      voiceActive: false,
      voiceCycleCount: assessment.priorVoiceCycles, // carry the count across a reload
      voiceSessionCount: 0,
      lastPhase: "off",
      recoveryCount: 0,
      cleanPagehide: false,
      wakeLockHeld: null,
      health: {},
    };
  }
  const lastEventRef = useRef<{ name: string; at: number } | null>(null);
  if (lastEventRef.current === null) lastEventRef.current = { name: "boot", at: startedAt };
  const [acknowledged, setAcknowledged] = useState(false);
  const [voiceIntentPersisted, setVoiceIntentPersisted] = useState<boolean>(
    () => readSession(BRAIN_VOICE_INTENT_KEY) === "1",
  );

  const persist = useCallback(() => {
    if (typeof window === "undefined") return;
    const s = stateRef.current!;
    const record: BrainBootRecord = {
      bootId,
      previousBootId: assessment.previousBootId ?? undefined,
      bootCount: assessment.bootCount,
      bootAt: startedAt,
      voiceWasActive: s.voiceActive,
      voiceCycleCount: s.voiceCycleCount,
      lastPhase: s.lastPhase,
      recoveryCount: s.recoveryCount,
      cleanPagehide: s.cleanPagehide,
      lastEvent: lastEventRef.current?.name,
    };
    writeSession(BRAIN_BOOT_STORAGE_KEY, JSON.stringify(record));
  }, [assessment.bootCount, assessment.previousBootId, bootId, startedAt]);

  const writeHeartbeat = useCallback(() => {
    if (typeof window === "undefined") return;
    const s = stateRef.current!;
    if (!s.voiceActive) return;
    const hb: BrainHeartbeat = {
      bootId,
      at: Date.now(),
      uptimeMs: Date.now() - startedAt,
      phase: s.health.phase ?? s.lastPhase,
      voiceActive: s.voiceActive,
      droppedFrames: typeof s.health.droppedFrames === "number" ? s.health.droppedFrames : -1,
      wakeInferences: typeof s.health.wakeInferences === "number" ? s.health.wakeInferences : -1,
      audioContextState: s.health.audioContextState ?? "",
      visibilityState: typeof document === "undefined" ? "unknown" : document.visibilityState,
      wakeLockHeld: s.wakeLockHeld,
      lastError: s.health.lastError ?? null,
    };
    writeSession(BRAIN_HEARTBEAT_KEY, JSON.stringify(hb));
  }, [bootId, startedAt]);

  const note = useCallback((name: string) => {
    lastEventRef.current = { name, at: Date.now() };
  }, []);

  // Persist on mount; clear the one-shot SW-reload marker + stale heartbeat.
  useEffect(() => {
    persist();
    clearSession(BRAIN_SW_RELOAD_KEY);
    clearSession(BRAIN_HEARTBEAT_KEY);
  }, [persist]);

  // Lifecycle events — persist the record at each so a reload sees fresh data.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onVis = () => {
      note(`visibility:${document.visibilityState}`);
      persist();
      // A hidden tab's timers freeze on iOS — write one last heartbeat NOW so the
      // next boot can tell a background eviction (was hidden) from a foreground
      // memory kill (was visible).
      if (document.visibilityState === "hidden") writeHeartbeat();
    };
    const onPageHide = () => {
      stateRef.current!.cleanPagehide = true;
      note("pagehide");
      persist();
      // A clean unload is not a kill — drop the heartbeat so the next boot
      // doesn't misread it as "died mid-listen".
      clearSession(BRAIN_HEARTBEAT_KEY);
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        setBfcacheRestored(true);
        note("pageshow:bfcache");
      }
    };
    const onOnline = () => note("online");
    const onOffline = () => note("offline");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [note, persist, writeHeartbeat]);

  // Heartbeat — only runs while a voice session is armed.
  const voiceActiveTick = useRef(0);
  const [voiceActiveGen, setVoiceActiveGen] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!stateRef.current!.voiceActive) return;
    writeHeartbeat();
    const id = window.setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [writeHeartbeat, voiceActiveGen]);

  const markVoiceActive = useCallback(
    (active: boolean) => {
      const s = stateRef.current!;
      if (s.voiceActive === active) return;
      s.voiceActive = active;
      if (active) s.voiceSessionCount += 1;
      note(active ? "voice:armed" : "voice:disarmed");
      persist();
      if (active) writeHeartbeat();
      else clearSession(BRAIN_HEARTBEAT_KEY);
      voiceActiveTick.current += 1;
      setVoiceActiveGen(voiceActiveTick.current); // (re)start / stop the interval
    },
    [note, persist, writeHeartbeat],
  );

  const noteVoiceCycle = useCallback(() => {
    stateRef.current!.voiceCycleCount += 1;
    note("voice:cycle");
    persist();
  }, [note, persist]);

  const notePhase = useCallback((phase: BrainVoicePhase) => {
    stateRef.current!.lastPhase = phase; // persisted at the next lifecycle moment
  }, []);

  const noteVoiceHealth = useCallback((health: BrainVoiceHealth) => {
    const s = stateRef.current!;
    s.health = { ...s.health, ...health };
    if (health.phase) s.lastPhase = health.phase;
  }, []);

  const noteWakeLock = useCallback((held: boolean) => {
    // Tracked for the heartbeat only — not a `note()` (it must not mask the
    // `visibility:hidden` that the eviction classifier reads).
    stateRef.current!.wakeLockHeld = held;
  }, []);

  const noteRecovery = useCallback(() => {
    stateRef.current!.recoveryCount += 1;
    note("voice:recovery");
    persist();
  }, [note, persist]);

  const dismissInterrupted = useCallback(() => setAcknowledged(true), []);

  const setVoiceIntent = useCallback((want: boolean) => {
    if (want) writeSession(BRAIN_VOICE_INTENT_KEY, "1");
    else clearSession(BRAIN_VOICE_INTENT_KEY);
    setVoiceIntentPersisted(want);
  }, []);

  const getTelemetry = useCallback<() => BrainLifecycleTelemetry>(() => {
    const s = stateRef.current!;
    const pi = assessment.priorInstance;
    return {
      bootId,
      previousBootId: assessment.previousBootId,
      bootCount: assessment.bootCount,
      sessionUptimeMs: Date.now() - startedAt,
      reloadCause: bfcacheRestored ? "bfcache-restore" : assessment.cause,
      navigationKind: bfcacheRestored ? "bfcache-restore" : assessment.navigationKind,
      browserReloadLikely: assessment.browserReloadLikely && !bfcacheRestored,
      evictionKind: bfcacheRestored ? "unknown" : assessment.evictionKind,
      unexpectedReload: assessment.unexpectedReload && !bfcacheRestored,
      priorVoiceActive: assessment.priorVoiceActive,
      priorVoiceCycles: assessment.priorVoiceCycles,
      priorCleanPagehide: assessment.priorCleanPagehide,
      priorDiedAtPhase: pi?.diedAtPhase ?? "unknown",
      priorDiedHidden: pi?.diedHidden ?? false,
      priorWakeLockHeld: pi?.wakeLockHeld ?? null,
      priorDiedAfterMs: pi?.diedAfterMs ?? -1,
      priorHeartbeatAgeMs: pi?.heartbeatAgeAtBootMs ?? -1,
      priorDroppedFrames: pi?.droppedFrames ?? -1,
      priorLastEvent: assessment.priorLastEvent,
      wakeLockHeld: s.wakeLockHeld,
      voiceSessionCount: s.voiceSessionCount,
      voiceCycleCount: s.voiceCycleCount,
      lastVoicePhase: s.lastPhase,
      wakeDroppedFrames: typeof s.health.droppedFrames === "number" ? s.health.droppedFrames : -1,
      lastCaptureMs: typeof s.health.lastCaptureMs === "number" ? s.health.lastCaptureMs : -1,
      lastSttMs: typeof s.health.lastSttMs === "number" ? s.health.lastSttMs : -1,
      lastWakeToCaptureMs: typeof s.health.lastWakeToCaptureMs === "number" ? s.health.lastWakeToCaptureMs : -1,
      recoveryCount: s.recoveryCount,
      visibilityState: typeof document === "undefined" ? "unknown" : document.visibilityState,
      onlineState: typeof navigator === "undefined" ? true : navigator.onLine !== false,
      serviceWorkerState: swState(),
      lastLifecycleEvent: lastEventRef.current?.name ?? "boot",
      lastLifecycleEventAt: lastEventRef.current?.at ?? startedAt,
    };
  }, [assessment, bfcacheRestored, bootId, startedAt]);

  return {
    assessment,
    voiceSessionInterrupted: assessment.unexpectedReload && !bfcacheRestored && !acknowledged,
    voiceIntentPersisted,
    getTelemetry,
    markVoiceActive,
    noteVoiceCycle,
    notePhase,
    noteVoiceHealth,
    noteWakeLock,
    noteRecovery,
    dismissInterrupted,
    setVoiceIntent,
  };
}
