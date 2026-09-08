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

import { useCallback, useEffect, useRef, useState } from "react";

import { AyasVoiceEngine } from "./voice/ayasVoiceEngine";
import { BrowserVoiceAdapter } from "./voice/browserVoiceAdapter";
import type { AyasVoiceCapability, AyasVoiceState } from "./ayasVoice";

const NO_CAPABILITY: AyasVoiceCapability = { stt: false, tts: false, sttCloudBacked: false };

export interface UseAyasVoiceOptions {
  /** Fired with the command text captured after the wake word. */
  readonly onCommand: (text: string) => void;
}

export interface UseAyasVoiceResult {
  readonly capability: AyasVoiceCapability;
  readonly state: AyasVoiceState;
  /** Voice INPUT (wake word) mode is on. */
  readonly listening: boolean;
  /** Voice OUTPUT (auto-speech) is muted. */
  readonly muted: boolean;
  readonly disclosureAccepted: boolean;
  readonly errorMessage: string | null;
  /** Set when auto-speech was blocked — call `replayPendingSpeech` on a gesture. */
  readonly pendingSpeech: string | null;
  /** The selected TTS voice name (diagnostic / report). */
  readonly voiceName: string | null;
  readonly voiceTier: string | null;
  acceptDisclosure(): void;
  toggleListening(): void;
  toggleMute(): void;
  speak(text: string): void;
  replayPendingSpeech(): void;
  markThinking(): void;
  markIdle(): void;
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

  const engineRef = useRef<AyasVoiceEngine | null>(null);
  const mutedRef = useRef(muted);
  const onCommandRef = useRef(options.onCommand);
  useEffect(() => {
    onCommandRef.current = options.onCommand;
  }, [options.onCommand]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    const engine = new AyasVoiceEngine(new BrowserVoiceAdapter(), {
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
    setReady(true);

    // The voice list often populates asynchronously — refine the label once.
    const refine = setTimeout(() => {
      if (engineRef.current !== engine) return;
      setVoiceName(engine.voiceSelection.voiceName);
      setVoiceTier(engine.voiceSelection.tier);
    }, 400);

    return () => {
      clearTimeout(refine);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const acceptDisclosure = useCallback(() => setDisclosureAccepted(true), []);

  const toggleListening = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.listening) {
      engine.disableListening();
    } else {
      setErrorMessage(null);
      engine.enableListening();
    }
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
    muted,
    disclosureAccepted,
    errorMessage,
    pendingSpeech,
    voiceName,
    voiceTier,
    acceptDisclosure,
    toggleListening,
    toggleMute,
    speak,
    replayPendingSpeech,
    markThinking,
    markIdle,
  };
}
