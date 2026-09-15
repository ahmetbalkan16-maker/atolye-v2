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
import { isAyasPushToTalkHotkey, isWakeEngineCapable, resolveAyasVoiceReadiness, selectAyasVoicePlatform } from "./ayasVoice";
import type { AyasMicPermissionState, AyasRecognitionMode, AyasVoiceCapability, AyasVoiceReadiness, AyasVoiceState } from "./ayasVoice";

const NO_CAPABILITY: AyasVoiceCapability = { stt: false, tts: false, sttCloudBacked: false };

/**
 * Mobile Voice Regression sprint — the wake-engine platform's dynamic import
 * (+ mic/AudioContext/ONNX bring-up) now travels over whatever transport the
 * page loaded through, including a Cloudflare Quick Tunnel — far less
 * predictable than a direct LAN hop. A hang here must NEVER leave `ready`
 * (and therefore the whole voice UI) stuck at "still initializing" forever;
 * past this bound it is treated exactly like `onUnavailable` and falls back
 * to the browser platform, which attaches synchronously.
 */
const WAKE_ENGINE_ATTACH_TIMEOUT_MS = 8_000;

const PERMISSION_DENIED_CODES = new Set(["not-allowed", "service-not-allowed"]);

/** Numeric / enum wake-adapter health — no audio, no secrets. */
export interface VoiceHealthSnapshot {
  readonly phase: string;
  readonly droppedFrames: number;
  readonly frameAgeMs: number;
  readonly recoveryCount: number;
  readonly audioContextState: string;
  /** Last turn latency marks (ms): command capture, STT round-trip, wake→capture-end. `-1` = none. */
  readonly lastCaptureMs: number;
  readonly lastSttMs: number;
  readonly lastWakeToCaptureMs: number;
  /** Conversation Session Mode diagnostics (wake engine). */
  readonly conversationActive: boolean;
  readonly conversationArmed: boolean;
  /** Why the last session closed (`idle-timeout` / `explicit-stop` / `fatal` / `disposed`); `null` = never. */
  readonly conversationClosedReason: string | null;
  /**
   * True Hands-Free UYAN Acoustic Wake Finalization — which acoustic model
   * produced the last wake hit (`"uyan-acoustic"` / `"ayas-acoustic"`), or
   * `null` before the first wake this session. Diagnostics only.
   */
  readonly wakeSource: string | null;
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

export interface AyasVoiceDebugSnapshot {
  readonly initializing: boolean;
  readonly ready: boolean;
  readonly sttAvailable: boolean;
  readonly ttsAvailable: boolean;
  readonly micPermission: AyasMicPermissionState;
  readonly wakeEngineEnabled: boolean;
  readonly wakeEngineAttached: boolean;
  readonly adapterKind: "wake-engine" | "browser" | null;
  readonly lastVoiceErrorCode: string | null;
  readonly lastRecognitionEvent:
    | "start"
    | "audiostart"
    | "soundstart"
    | "speechstart"
    | "result"
    | "speechend"
    | "soundend"
    | "audioend"
    | "error"
    | "end"
    | null;
  readonly initElapsedMs: number;
}

export interface UseAyasVoiceResult {
  readonly capability: AyasVoiceCapability;
  readonly ready: boolean;
  readonly readiness: AyasVoiceReadiness;
  /**
   * `true` until the voice platform has attached at least once — a transient
   * "still detecting" window, bounded by {@link WAKE_ENGINE_ATTACH_TIMEOUT_MS}
   * on the wake-engine path. Must be checked BEFORE treating `capability` as
   * final — a device is not "unsupported" just because this is still `true`.
   */
  readonly initializing: boolean;
  /** Best-effort; `"unknown"` on Safari/WebKit, which cannot be queried at all. */
  readonly micPermission: AyasMicPermissionState;
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
  /**
   * `true` between an "AYAS" wake and the idle timeout — follow-up commands skip
   * the wake word (Conversation Session Mode; wake engine only).
   */
  readonly conversationActive: boolean;
  /** Why the last conversation session closed — diagnostics (`null` = never opened). */
  readonly conversationClosedReason: string | null;
  /** Secret-free wake-adapter health for the Brain lifecycle heartbeat (wake engine only). */
  readonly voiceHealth: VoiceHealthSnapshot | null;
  readonly debug: AyasVoiceDebugSnapshot;
  /** Begin the real mic permission request directly from a user gesture. */
  primeMicrophone(): void;
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
  const [micPermission, setMicPermission] = useState<AyasMicPermissionState>("unknown");
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
  const [conversationActive, setConversationActive] = useState(false);
  const [conversationClosedReason, setConversationClosedReason] = useState<string | null>(null);
  const [voiceHealth, setVoiceHealth] = useState<VoiceHealthSnapshot | null>(null);
  const [adapterKind, setAdapterKind] = useState<AyasVoiceDebugSnapshot["adapterKind"]>(null);
  const [lastVoiceErrorCode, setLastVoiceErrorCode] = useState<string | null>(null);
  const [lastRecognitionEvent, setLastRecognitionEvent] = useState<AyasVoiceDebugSnapshot["lastRecognitionEvent"]>(null);
  const [initElapsedMs, setInitElapsedMs] = useState(0);
  const permissionPrimerRef = useRef<BrowserVoiceAdapter | null>(null);

  const engineRef = useRef<AyasVoiceEngine | null>(null);
  /** The wake adapter (when the wake engine is active) — for a gesture-driven retry / session close. */
  const wakeAdapterRef = useRef<
    { retryNow(): void; endConversation(): void; readonly isPaused: boolean } | null
  >(null);
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
    let wakeEngineTimedOut = false;
    let fallbackStarted = false;
    let attachTimeout: ReturnType<typeof setTimeout> | null = null;
    const initStartedAt = Date.now();
    let initSettled = false;
    const initTicker = setInterval(() => {
      if (!initSettled) setInitElapsedMs(Date.now() - initStartedAt);
    }, 100);

    const attach = (platform: AyasVoicePlatform, kind: AyasVoiceDebugSnapshot["adapterKind"]): void => {
      if (cancelled) return;
      engine = new AyasVoiceEngine(platform, {
        onStateChange: (next) => setState(next),
        onCommand: (text) => onCommandRef.current(text),
        onError: (message, code) => {
          setErrorMessage(message);
          if (code) setLastVoiceErrorCode(code);
          // A definitive, permanent signal regardless of what (if anything)
          // navigator.permissions reports — this is how Safari/WebKit, which
          // cannot be queried at all, is ever learned to be denied.
          if (code && PERMISSION_DENIED_CODES.has(code)) {
            setMicPermission("denied");
          }
        },
        onRecognitionEvent: (event, code) => {
          setLastRecognitionEvent(event);
          if (code) setLastVoiceErrorCode(code);
        },
        onWake: () => setErrorMessage(null),
        onAutoplayBlocked: (text) => setPendingSpeech(text),
        // Recognition genuinely started — the mic is live, which can only
        // happen once the browser's permission prompt was accepted. This is
        // what actually resolves "permission-needed" → "ready" the moment a
        // user grants access, instead of leaving the UI stuck on the earlier
        // "prompt" read forever.
        onListening: () => setMicPermission("granted"),
      });
      engineRef.current = engine;
      setAdapterKind(kind);
      setCapability(engine.capabilities);
      setState(engine.state);
      setVoiceName(engine.voiceSelection.voiceName);
      setVoiceTier(engine.voiceSelection.tier);
      setRecognitionMode(engine.recognitionMode);
      initSettled = true;
      setReady(true);
      setInitElapsedMs(Date.now() - initStartedAt);
      // Best-effort, fire-and-forget — Safari/WebKit resolves to "unknown"
      // (it cannot be queried), never blocks `ready`.
      void platform
        .queryMicPermission?.()
        .then((permission) => {
          if (!cancelled) setMicPermission(permission);
        })
        .catch(() => {});
    };

    if (platformKind === "wake-engine") {
      // Load the openWakeWord + onnxruntime bundle only when it will be used.
      const fallBack = () => {
        if (cancelled || fallbackStarted) return;
        fallbackStarted = true;
        wakeEngineTimedOut = true;
        if (attachTimeout) {
          clearTimeout(attachTimeout);
          attachTimeout = null;
        }

        // Do not wait for `setForcedBrowser` → effect cleanup → re-attach.
        // A hung/stale dynamic import can otherwise leave `ready` false
        // indefinitely on the physical phone. Attach the browser platform in
        // this same turn so `initializing` becomes false deterministically;
        // the state update below only selects the browser platform for future
        // renders and Strict Mode/effect replay remains idempotent.
        const previousEngine = engine;
        engine = null;
        if (engineRef.current === previousEngine) engineRef.current = null;
        previousEngine?.dispose();
        wakeAdapterRef.current = null;
        voicePausedRef.current = false;
        setVoicePaused(false);
        setRecovering(false);
        setConversationActive(false);
        setErrorMessage(null);
        attach(new BrowserVoiceAdapter(), "browser");
        setListening(false);
        setForcedBrowser(true);
      };
      // The dynamic import + adapter bring-up now often travels over a
      // Cloudflare Quick Tunnel (or worse network) rather than a direct LAN
      // hop — a hang here must never leave `ready` permanently false (the
      // exact regression this sprint traced "Bu cihazda ses yok" to).
      attachTimeout = setTimeout(() => {
        attachTimeout = null;
        if (cancelled || engineRef.current) return; // already attached in time
        fallBack();
      }, WAKE_ENGINE_ATTACH_TIMEOUT_MS);
      void import("./voice/wakeWordVoiceAdapter")
        .then(({ WakeWordVoiceAdapter }) => {
          if (wakeEngineTimedOut || cancelled) return;
          const adapter = new WakeWordVoiceAdapter({
            // The staged, physically validated acoustic asset is AYAS. UYAN and
            // the other aliases remain fully supported by BrowserVoiceAdapter's
            // text resolver, but must not be advertised or loaded as an acoustic
            // model until a real `uyan.onnx` is actually installed and validated.
            wakewordUrl: "/wake/ayas.onnx",
            primaryWakeLabel: "ayas-acoustic",
            // Fires ONLY when the wake engine has never worked on this device —
            // a mid-session interruption pauses + self-heals instead.
            onUnavailable: fallBack,
            onStatus: (s) => {
              // The wake engine's own mic acquisition (getUserMedia) is a
              // SEPARATE permission flow from webkitSpeechRecognition — "on"
              // can only be reached once that permission was granted, so this
              // is the wake-engine-mode equivalent of the browser adapter's
              // `onListening` signal.
              if (s.mic === "on") setMicPermission("granted");
              setRecovering(s.mic === "recovering");
              const paused = s.mic === "paused";
              voicePausedRef.current = paused;
              setVoicePaused(paused);
              setWakeCycles(s.cyclesCompleted);
              setConversationActive(s.conversationActive);
              setConversationClosedReason(s.conversationClosedReason);
              setVoiceHealth({
                phase: s.phase,
                droppedFrames: s.droppedFrames,
                frameAgeMs: s.frameAgeMs,
                recoveryCount: s.recoveryCount,
                audioContextState: s.audioContextState,
                lastCaptureMs: s.lastCaptureMs,
                lastSttMs: s.lastSttMs,
                lastWakeToCaptureMs: s.lastWakeToCaptureMs,
                conversationActive: s.conversationActive,
                conversationArmed: s.conversationArmed,
                conversationClosedReason: s.conversationClosedReason,
                wakeSource: s.wakeSource,
                lastError: s.lastError,
              });
            },
          });
          wakeAdapterRef.current = adapter;
          if (attachTimeout) clearTimeout(attachTimeout);
          attachTimeout = null;
          attach(adapter, "wake-engine");
        })
        .catch(() => {
          fallBack();
        });
    } else {
      attach(new BrowserVoiceAdapter(), "browser");
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
      if (attachTimeout) clearTimeout(attachTimeout);
      clearInterval(initTicker);
      engine?.dispose();
      if (engineRef.current === engine) engineRef.current = null;
      wakeAdapterRef.current = null;
      voicePausedRef.current = false;
      setVoicePaused(false);
      setConversationActive(false);
      setConversationClosedReason(null);
    };
  }, [platformKind]);

  // Push-to-talk fallback (Ctrl+Space): a keyboard alternative to a spoken
  // wake alias. Scoped to the `"browser"` platform only — on the wake-engine
  // (openWakeWord) platform, wake is decided by the audio classifier inside
  // `WakeWordVoiceAdapter`'s own phase state machine, which this cannot
  // (and must not) reach into; flipping the engine's `woke` flag there would
  // show a misleading "Listening…" state before the adapter actually starts
  // capturing.
  useEffect(() => {
    if (typeof document === "undefined" || platformKind !== "browser") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAyasPushToTalkHotkey(event)) return;
      const engine = engineRef.current;
      if (!engine || !engine.capabilities.stt) return;
      event.preventDefault();
      setErrorMessage(null);
      engine.activatePushToTalk();
      setListening(engine.listening);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [platformKind]);

  const acceptDisclosure = useCallback(() => setDisclosureAccepted(true), []);

  /**
   * Start microphone permission from the current tap before any wake runner,
   * AudioContext rebuild, or STT start can consume the gesture. The request is
   * intentionally not awaited here: the browser prompt must be opened in this
   * synchronous event turn, while the existing engine start/reconnect path
   * continues exactly as before.
   */
  const primeMicrophone = useCallback(() => {
    const primer = permissionPrimerRef.current ?? (permissionPrimerRef.current = new BrowserVoiceAdapter());
    void primer.requestMicrophonePermission().then((permission) => {
      if (permission === "granted" || permission === "denied") setMicPermission(permission);
      if (permission === "denied") setErrorMessage("Mikrofon izni reddedildi. Sesli mod kapatıldı; metin sohbeti çalışıyor.");
    }).catch(() => {});
  }, []);

  const retryVoice = useCallback(() => {
    setErrorMessage(null);
    // Keep the permission request and the recognition start in the same tap.
    // A paused wake adapter still owns the existing engine handlers, but its
    // recovery is async; recapture here makes the browser/STT platform enter
    // its start path immediately instead of waiting for wake recovery first.
    primeMicrophone();
    const wakeAdapter = wakeAdapterRef.current;
    wakeAdapter?.retryNow();
    const engine = engineRef.current;
    if (!engine) return;
    if (!engine.listening) engine.enableListening();
    else if (!wakeAdapter) engine.recaptureVoice();
    setListening(engine.listening);
  }, [primeMicrophone]);

  const toggleListening = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.listening) {
      // A paused wake pipeline: this tap is the user gesture that lets iOS hand
      // the mic back — retry now, never toggle listening off.
      if (voicePausedRef.current && wakeAdapterRef.current) {
        retryVoice();
        return;
      }
      if (engine.canRecapture) {
        // iOS single-shot: this tap IS the user gesture the next `start()` needs.
        setErrorMessage(null);
        primeMicrophone();
        engine.recaptureVoice();
      } else {
        // Explicit stop closes any open conversation session (next command needs "AYAS").
        wakeAdapterRef.current?.endConversation();
        engine.disableListening();
      }
    } else {
      setErrorMessage(null);
      primeMicrophone();
      engine.enableListening();
    }
    setListening(engine.listening);
  }, [primeMicrophone, retryVoice]);

  const stopListening = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    wakeAdapterRef.current?.endConversation();
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
  const readiness = resolveAyasVoiceReadiness({
    initializing: !ready,
    sttAvailable: ready ? capability.stt : false,
    ttsAvailable: ready ? capability.tts : false,
    micPermission,
    error: ready && state === "error",
  });

  return {
    capability: ready ? capability : NO_CAPABILITY,
    ready,
    initializing: !ready,
    readiness,
    micPermission,
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
    conversationActive: ready ? conversationActive : false,
    conversationClosedReason: ready ? conversationClosedReason : null,
    voiceHealth,
    primeMicrophone,
    debug: {
      initializing: !ready,
      ready,
      sttAvailable: ready ? capability.stt : false,
      ttsAvailable: ready ? capability.tts : false,
      micPermission,
      wakeEngineEnabled: platformKind === "wake-engine",
      wakeEngineAttached: adapterKind === "wake-engine",
      adapterKind,
      lastVoiceErrorCode,
      lastRecognitionEvent,
      initElapsedMs,
    },
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
