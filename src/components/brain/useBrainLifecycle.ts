"use client";

/**
 * Atölye Brain — page-lifecycle tracking + unexpected-reload detection.
 *
 * Writes a small `sessionStorage` boot record on every Brain load, compares it
 * with the previous one, and classifies the transition (first boot / SW update
 * / suspected iOS eviction / plain reload). It keeps a secret-free lifecycle
 * telemetry snapshot for the Voice Lab, and tells `BrainCoreConsole` when a
 * voice session was interrupted by a reload so the UI can offer to resume it.
 *
 * No network, no polling, no React state churn — `sessionStorage` + refs only
 * (per-tab, cleared on close). The recorders are pure side effects, so they are
 * safe to call from a `useEffect`.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  assessBrainReload,
  parseBrainBootRecord,
  BRAIN_BOOT_STORAGE_KEY,
  BRAIN_SW_RELOAD_KEY,
  type BrainBootRecord,
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

const OFF_ASSESSMENT: BrainReloadAssessment = {
  firstBoot: true,
  unexpectedReload: false,
  cause: "first-boot",
  sinceLastBootMs: 0,
  priorVoiceActive: false,
  priorVoiceCycles: 0,
  priorPhase: "off",
  bootCount: 1,
};

export interface UseBrainLifecycleResult {
  readonly assessment: BrainReloadAssessment;
  /** `true` while a reload-interrupted voice session is unacknowledged. */
  readonly voiceSessionInterrupted: boolean;
  /** A fresh secret-free telemetry snapshot (call each render — no state churn). */
  getTelemetry(): BrainLifecycleTelemetry;
  /** Hands-free voice was armed / disarmed. */
  markVoiceActive(active: boolean): void;
  /** One completed wake→…→re-arm cycle. */
  noteVoiceCycle(): void;
  /** Latest adapter phase (cheap — persisted only at lifecycle moments). */
  notePhase(phase: BrainVoicePhase): void;
  /** A controlled voice-pipeline recovery ran. */
  noteRecovery(): void;
  /** The operator acknowledged / resumed the interrupted session. */
  dismissInterrupted(): void;
}

export function useBrainLifecycle(): UseBrainLifecycleResult {
  // Assess once, on the client, during the first render (lazy init — not an effect).
  const [assessment] = useState<BrainReloadAssessment>(() => {
    if (typeof window === "undefined") return OFF_ASSESSMENT;
    const prev = parseBrainBootRecord(readSession(BRAIN_BOOT_STORAGE_KEY));
    const markerRaw = readSession(BRAIN_SW_RELOAD_KEY);
    const swReloadMarkerAt = markerRaw && Number.isFinite(Number(markerRaw)) ? Number(markerRaw) : null;
    return assessBrainReload({ prev, nowMs: Date.now(), swReloadMarkerAt });
  });

  const [bootId] = useState<string>(() => {
    if (typeof window === "undefined") return "ssr";
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  });
  const [startedAt] = useState<number>(() => Date.now());

  const stateRef = useRef<{
    voiceActive: boolean;
    voiceCycleCount: number;
    voiceSessionCount: number;
    lastPhase: BrainVoicePhase;
    recoveryCount: number;
  } | null>(null);
  if (stateRef.current === null) {
    stateRef.current = {
      voiceActive: false,
      voiceCycleCount: assessment.priorVoiceCycles, // carry the count across a reload
      voiceSessionCount: 0,
      lastPhase: "off",
      recoveryCount: 0,
    };
  }
  const lastEventRef = useRef<{ name: string; at: number } | null>(null);
  if (lastEventRef.current === null) lastEventRef.current = { name: "boot", at: startedAt };
  const [acknowledged, setAcknowledged] = useState(false);

  const persist = useCallback(() => {
    if (typeof window === "undefined") return;
    const s = stateRef.current!;
    const record: BrainBootRecord = {
      bootId,
      bootCount: assessment.bootCount,
      bootAt: startedAt,
      voiceWasActive: s.voiceActive,
      voiceCycleCount: s.voiceCycleCount,
      lastPhase: s.lastPhase,
      recoveryCount: s.recoveryCount,
    };
    writeSession(BRAIN_BOOT_STORAGE_KEY, JSON.stringify(record));
  }, [assessment.bootCount, bootId, startedAt]);

  const note = useCallback((name: string) => {
    lastEventRef.current = { name, at: Date.now() };
  }, []);

  // Persist on mount; clear the one-shot SW-reload marker.
  useEffect(() => {
    persist();
    clearSession(BRAIN_SW_RELOAD_KEY);
  }, [persist]);

  // Lifecycle events — persist the record at each so a reload sees fresh data.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onVis = () => {
      note(`visibility:${document.visibilityState}`);
      persist();
    };
    const onPageHide = () => {
      note("pagehide");
      persist();
    };
    const onOnline = () => note("online");
    const onOffline = () => note("offline");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [note, persist]);

  const markVoiceActive = useCallback(
    (active: boolean) => {
      const s = stateRef.current!;
      if (s.voiceActive === active) return;
      s.voiceActive = active;
      if (active) s.voiceSessionCount += 1;
      note(active ? "voice:armed" : "voice:disarmed");
      persist();
    },
    [note, persist],
  );

  const noteVoiceCycle = useCallback(() => {
    stateRef.current!.voiceCycleCount += 1;
    note("voice:cycle");
    persist();
  }, [note, persist]);

  const notePhase = useCallback((phase: BrainVoicePhase) => {
    stateRef.current!.lastPhase = phase; // persisted at the next lifecycle moment
  }, []);

  const noteRecovery = useCallback(() => {
    stateRef.current!.recoveryCount += 1;
    note("voice:recovery");
    persist();
  }, [note, persist]);

  const dismissInterrupted = useCallback(() => setAcknowledged(true), []);

  const getTelemetry = useCallback<() => BrainLifecycleTelemetry>(() => {
    const s = stateRef.current!;
    return {
      bootId,
      bootCount: assessment.bootCount,
      sessionUptimeMs: Date.now() - startedAt,
      reloadCause: assessment.cause,
      unexpectedReload: assessment.unexpectedReload,
      priorVoiceActive: assessment.priorVoiceActive,
      priorVoiceCycles: assessment.priorVoiceCycles,
      voiceSessionCount: s.voiceSessionCount,
      voiceCycleCount: s.voiceCycleCount,
      lastVoicePhase: s.lastPhase,
      recoveryCount: s.recoveryCount,
      visibilityState: typeof document === "undefined" ? "unknown" : document.visibilityState,
      onlineState: typeof navigator === "undefined" ? true : navigator.onLine !== false,
      serviceWorkerState: swState(),
      lastLifecycleEvent: lastEventRef.current?.name ?? "boot",
      lastLifecycleEventAt: lastEventRef.current?.at ?? startedAt,
    };
  }, [assessment, bootId, startedAt]);

  return {
    assessment,
    voiceSessionInterrupted: assessment.unexpectedReload && !acknowledged,
    getTelemetry,
    markVoiceActive,
    noteVoiceCycle,
    notePhase,
    noteRecovery,
    dismissInterrupted,
  };
}
