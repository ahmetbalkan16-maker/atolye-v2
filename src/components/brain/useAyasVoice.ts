"use client";

/**
 * AYAS — voice hook (Sprint 186, rebuilt Sprint 187).
 *
 * Binds the platform-agnostic {@link AyasVoiceEngine} to React state via the
 * {@link BrowserVoiceAdapter}. The hook owns no voice logic of its own — it
 * forwards intent to the engine and mirrors the engine's state.
 *
 * Two independent capabilities:
 *  - VOICE OUTPUT (`speechSynthesis`, local) — AYAS reads replies aloud. On by
 *    default when available; `muted` turns it off. Auto-speech that the browser
 *    blocks until a gesture surfaces a manual replay button (`pendingSpeech`).
 *  - VOICE INPUT (`SpeechRecognition`) — the "AYAS" wake word. OFF until the
 *    user enables it AND (for the cloud-backed Chromium engine) accepts the
 *    disclosure.
 *
 * No `fetch`, no XHR, no external URL. The only timers are the engine's short
 * lifecycle debounces. An absent API degrades to `"unsupported"`; text chat is
 * never affected.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { AyasVoiceEngine, type AyasVoicePlatform } from "./voice/ayasVoiceEngine";
import { BrowserVoiceAdapter } from "./voice/browserVoiceAdapter";
import { isWakeEngineCapable, selectAyasVoicePlatform } from "./ayasVoice";
import type { AyasRecognitionMode, AyasVoiceCapability, AyasVoiceState } from "./ayasVoice";

const NO_CAPABILITY: AyasVoiceCapability = { stt: false, tts: false, sttCloudBacked: false };

/** Numeric / enum wake-adapter health — no audio, no secrets. */
export interface VoiceHealthSnapshot {
  readonly phase: string;
  readonly droppedFrames: number;
  readonly frameAgeMs: number;
  readonly recoveryCount: number;
  readonly audioContextState: string;
  readonly lastError: string | null;
}

/** Operator opt-in: use the on-device openWakeWord + local whisper STT engine. */
const WAKE_ENGINE_OPT_IN = process.env.NEXT_PUBLIC_ATOLYE_WAKE_ENGINE === "on";

const noopSubscribe = (): (() => void) => () => {};

/** SSR-safe: which voice platform to build (server → always the browser one). */
function readVoicePlatformKind(): "wake-engine" | "browser" {
  return selectAyasVoicePlatform({
    wakeEngineOptIn: WAKE_ENGINE_OPT_IN,
    wakeEngineSupported: isWakeEngineCapable(
      typeof window === "undefined" ? undefined : (window as never),
    ),
  });
}

export interface UseAyasVoiceOptions {
  /** Fired with the command text captured after the wake word. */
  readonly onCommand: (text: string) => void;
}

export interface UseAyasVoiceResult {
  readonly capability: AyasVoiceCapability;
  readonly state: AyasVoiceState;
  /** Voice INPUT (wake word) mode is on. */
  readonly listening: boolean;
  /** `"single-shot"` on iOS/WebKit — a tap captures one utterance, no auto-restart. */
  readonly recognitionMode: AyasRecognitionMode;
  /** Voice OUTPUT (auto-speech) is muted. */
  readonly muted: boolean;
  readonly disclosureAccepted: boolean;
  readonly errorMessage: string | null;
  /** Set when auto-speech was blocked — call `replayPendingSpeech` on a gesture. */
  readonly pendingSpeech: string | null;
  /** The selected TTS voice name (diagnostic / report). */
  readonly voiceName: string | null;
  readonly voiceTier: string | null;
  /** `true` while the on-device wake pipeline is re-acquiring the mic / context. */
  readonly recovering: boolean;
  /**
   * `true` when a working wake session was interrupted (iOS took the mic away)
   * and is recovering — a mic tap retries immediately. NOT a permanent failure.
   */
  readonly voicePaused: boolean;
  /** Completed wake→command→reply→re-arm cycles this session (wake engine only). */
  readonly wakeCycles: number;
  /** Secret-free wake-adapter health for the Brain lifecycle heartbeat (wake engine only). */
  readonly voiceHealth: VoiceHealthSnapshot | null;
  acceptDisclosure(): void;
  /**
   * The mic button. First tap: enable voice mode + listen. On the single-shot
   * (iOS) path a later tap while at rest starts a FRESH recognition session
   * inside that tap's gesture (tap → "AYAS" → tap → command). On the continuous
   * path a later tap toggles listening off.
   */
  toggleListening(): void;
  /** The explicit "turn voice off" control (the "dinlemeyi kapat" link). */
  stopListening(): void;
  toggleMute(): void;
  speak(text: string): void;
  replayPendingSpeech(): void;
  markThinking(): void;
  markIdle(): void;
  /** Retry a paused wake pipeline NOW — call from inside a user gesture (a tap). */
  retryVoice(): void;
}

export function useAyasVoice(options: UseAyasVoiceOptions): UseAyasVoiceResult {
  const [ready, setReady] = useState(false);
  const [capability, setCapability] = useState<AyasVoiceCapability>(NO_CAPABILITY);
  const [state, setState] = useState<AyasVoiceState>("off");
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingSpeech, setPendingSpeech] = useState<string | null>(null);
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const [voiceTier, setVoiceTier] = useState<string | null>(null);
  const [recognitionMode, setRecognitionMode] = useState<AyasRecognitionMode>("continuous");
  const [recovering, setRecovering] = useState(false);
  const [voicePaused, setVoicePaused] = useState(false);
  const [wakeCycles, setWakeCycles] = useState(0);
  const [voiceHealth, setVoiceHealth] = useState<VoiceHealthSnapshot | null>(null);

  const engineRef = useRef<AyasVoiceEngine | null>(null);
  /** The wake adapter (when the wake engine is active) — for a gesture-driven retry. */
  const wakeAdapterRef = useRef<{ retryNow(): void; readonly isPaused: boolean } | null>(null);
  const voicePausedRef = useRef(false);
  const mutedRef = useRef(muted);
  const onCommandRef = useRef(options.onCommand);
  useEffect(() => {
    onCommandRef.current = options.onCommand;
  }, [options.onCommand]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // The wake engine can't start on this device → drop back to the browser one.
  const [forcedBrowser, setForcedBrowser] = useState(false);
  const storeKind = useSyncExternalStore(noopSubscribe, readVoicePlatformKind, () => "browser" as const);
  const platformKind: "wake-engine" | "browser" = forcedBrowser ? "browser" : storeKind;

  useEffect(() => {
    let engine: AyasVoiceEngine | null = null;
    let cancelled = false;

    const attach = (platform: AyasVoicePlatform): void => {
      if (cancelled) return;
      engine = new AyasVoiceEngine(platform, {
        onStateChange: (next) => setState(next),
        onCommand: (text) => onCommandRef.current(text),
        onError: (message) => setErrorMessage(message),
        onWake: () => setErrorMessage(null),
        onAutoplayBlocked: (text) => setPendingSpeech(text),
      });
      engineRef.current = engine;
      setCapability(engine.capabilities);
      setState(engine.state);
      setVoiceName(engine.voiceSelection.voiceName);
      setVoiceTier(engine.voiceSelection.tier);
      setRecognitionMode(engine.recognitionMode);
      setReady(true);
    };

    if (platformKind === "wake-engine") {
      // Load the openWakeWord + onnxruntime bundle only when it will be used.
      const fallBack = () => {
        setListening(false);
        setForcedBrowser(true);
      };
      void import("./voice/wakeWordVoiceAdapter")
        .then(({ WakeWordVoiceAdapter }) => {
          const adapter = new WakeWordVoiceAdapter({
            // Fires ONLY when the wake engine has never worked on this device —
            // a mid-session interruption pauses + self-heals instead.
            onUnavailable: fallBack,
            onStatus: (s) => {
              setRecovering(s.mic === "recovering");
              const paused = s.mic === "paused";
              voicePausedRef.current = paused;
              setVoicePaused(paused);
              setWakeCycles(s.cyclesCompleted);
              setVoiceHealth({
                phase: s.phase,
                droppedFrames: s.droppedFrames,
                frameAgeMs: s.frameAgeMs,
                recoveryCount: s.recoveryCount,
                audioContextState: s.audioContextState,
                lastError: s.lastError,
              });
            },
          });
          wakeAdapterRef.current = adapter;
          attach(adapter);
        })
        .catch(fallBack);
    } else {
      attach(new BrowserVoiceAdapter());
    }

    // The voice list often populates asynchronously — refine the label once.
    const refine = setTimeout(() => {
      const e = engineRef.current;
      if (!e) return;
      setVoiceName(e.voiceSelection.voiceName);
      setVoiceTier(e.voiceSelection.tier);
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(refine);
      engine?.dispose();
      if (engineRef.current === engine) engineRef.current = null;
      wakeAdapterRef.current = null;
      voicePausedRef.current = false;
      setVoicePaused(false);
    };
  }, [platformKind]);

  const acceptDisclosure = useCallback(() => setDisclosureAccepted(true), []);

  const retryVoice = useCallback(() => {
    setErrorMessage(null);
    wakeAdapterRef.current?.retryNow();
  }, []);

  const toggleListening = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.listening) {
      // A paused wake pipeline: this tap is the user gesture that lets iOS hand
      // the mic back — retry now, never toggle listening off.
      if (voicePausedRef.current && wakeAdapterRef.current) {
        setErrorMessage(null);
        wakeAdapterRef.current.retryNow();
        return;
      }
      if (engine.canRecapture) {
        // iOS single-shot: this tap IS the user gesture the next `start()` needs.
        setErrorMessage(null);
        engine.recaptureVoice();
      } else {
        engine.disableListening();
      }
    } else {
      setErrorMessage(null);
      engine.enableListening();
    }
    setListening(engine.listening);
  }, []);

  const stopListening = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.disableListening();
    setListening(engine.listening);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      if (next) engineRef.current?.stopSpeaking();
      return next;
    });
  }, []);

  const speak = useCallback((text: string) => {
    if (mutedRef.current) {
      engineRef.current?.markIdle();
      return;
    }
    setPendingSpeech(null);
    engineRef.current?.speak(text);
  }, []);

  const replayPendingSpeech = useCallback(() => {
    setPendingSpeech((text) => {
      if (text) engineRef.current?.speak(text);
      return null;
    });
  }, []);

  const markThinking = useCallback(() => engineRef.current?.markThinking(), []);
  const markIdle = useCallback(() => engineRef.current?.markIdle(), []);

  return {
    capability: ready ? capability : NO_CAPABILITY,
    state: ready ? state : "off",
    listening,
    recognitionMode,
    muted,
    disclosureAccepted,
    errorMessage,
    pendingSpeech,
    voiceName,
    voiceTier,
    recovering: ready ? recovering : false,
    voicePaused: ready ? voicePaused : false,
    wakeCycles,
    voiceHealth,
    acceptDisclosure,
    retryVoice,
    toggleListening,
    stopListening,
    toggleMute,
    speak,
    replayPendingSpeech,
    markThinking,
    markIdle,
  };
}
