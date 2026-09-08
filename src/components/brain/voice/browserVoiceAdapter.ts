"use client";

/**
 * AYAS — browser voice adapter (Sprint 187).
 *
 * The only place the DOM Web Speech APIs are touched:
 *  - `window.speechSynthesis` / `SpeechSynthesisUtterance` — AYAS speaking (local).
 *  - `window.SpeechRecognition` / `window.webkitSpeechRecognition` — hearing "AYAS".
 *
 * No `fetch`, no `XMLHttpRequest`, no `WebSocket`, no `MediaRecorder`, no
 * `navigator.mediaDevices`, no external URL. Everything the browser itself
 * provides for free. `window` is read lazily inside methods so this module is
 * safe to import in a non-DOM (test / SSR) context.
 */

import {
  detectAyasVoiceCapability,
  type AyasPlatformVoice,
  type AyasVoiceCapability,
} from "../ayasVoice";
import type {
  AyasListenHandle,
  AyasListenHandlers,
  AyasSpeakHandle,
  AyasSpeakOptions,
  AyasVoicePlatform,
} from "./ayasVoiceEngine";

/* ---- minimal vendor types (Web Speech recognition is not in the TS DOM lib) ---- */

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly 0: SpeechRecognitionAlternativeLike;
  readonly isFinal: boolean;
  readonly length: number;
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getWindow(): (Window & typeof globalThis) | undefined {
  return typeof window === "undefined" ? undefined : window;
}

function getRecognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = getWindow() as unknown as
    | {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
      }
    | undefined;
  if (!w) return undefined;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function getSynth(): SpeechSynthesis | undefined {
  const w = getWindow();
  return w && "speechSynthesis" in w ? w.speechSynthesis : undefined;
}

export class BrowserVoiceAdapter implements AyasVoicePlatform {
  detectCapability(): AyasVoiceCapability {
    const w = getWindow();
    return detectAyasVoiceCapability(w ? (w as never) : undefined);
  }

  listVoices(): AyasPlatformVoice[] {
    const synth = getSynth();
    if (!synth) return [];
    try {
      return synth.getVoices().map((v) => ({
        name: v.name,
        lang: v.lang,
        localService: Boolean(v.localService),
        default: Boolean(v.default),
      }));
    } catch {
      return [];
    }
  }

  onVoicesChanged(callback: () => void): () => void {
    const synth = getSynth();
    if (!synth || typeof synth.addEventListener !== "function") return () => {};
    const handler = () => callback();
    synth.addEventListener("voiceschanged", handler);
    return () => {
      try {
        synth.removeEventListener("voiceschanged", handler);
      } catch {
        /* ignore */
      }
    };
  }

  startListening(lang: string, handlers: AyasListenHandlers): AyasListenHandle {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      handlers.onError("not-allowed");
      return { stop() {} };
    }

    let recognition: SpeechRecognitionLike | null = new Ctor();
    recognition.lang = lang || "tr-TR";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result?.isFinal) transcript += result[0]?.transcript ?? "";
      }
      transcript = transcript.trim();
      if (transcript) handlers.onFinalTranscript(transcript);
    };
    recognition.onerror = (event) => handlers.onError(event?.error ?? "unknown");
    recognition.onend = () => handlers.onEnd();

    try {
      recognition.start();
    } catch {
      /* start() throws if called twice in quick succession — ignored */
    }

    return {
      stop() {
        const current = recognition;
        recognition = null;
        if (!current) return;
        current.onresult = null;
        current.onerror = null;
        current.onend = null;
        try {
          current.abort();
        } catch {
          /* already stopped */
        }
      },
    };
  }

  speak(text: string, options: AyasSpeakOptions): AyasSpeakHandle {
    const synth = getSynth();
    const w = getWindow();
    if (!synth || !w || typeof w.SpeechSynthesisUtterance !== "function") {
      options.onError();
      return { cancel() {} };
    }

    try {
      const utterance = new w.SpeechSynthesisUtterance(text);
      utterance.lang = options.lang || "tr-TR";
      utterance.pitch = options.pitch;
      utterance.rate = options.rate;
      utterance.volume = options.volume;
      if (options.voiceName) {
        const match = synth.getVoices().find((v) => v.name === options.voiceName);
        if (match) utterance.voice = match;
      }
      utterance.onstart = () => options.onStart();
      utterance.onend = () => options.onEnd();
      utterance.onerror = () => options.onError();
      synth.cancel();
      synth.speak(utterance);
    } catch {
      options.onError();
      return { cancel() {} };
    }

    return {
      cancel() {
        try {
          synth.cancel();
        } catch {
          /* ignore */
        }
      },
    };
  }

  cancelSpeech(): void {
    const synth = getSynth();
    if (!synth) return;
    try {
      synth.cancel();
    } catch {
      /* ignore */
    }
  }
}
