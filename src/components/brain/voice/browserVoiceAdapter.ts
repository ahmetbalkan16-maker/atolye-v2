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
  detectAyasSpeechRecognitionMode,
  type AyasMicPermissionState,
  type AyasPlatformVoice,
  type AyasRecognitionMode,
  type AyasVoiceCapability,
} from "../ayasVoice";
import type {
  AyasListenHandle,
  AyasListenHandlers,
  AyasListenOptions,
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
  onstart?: (() => void) | null;
  onaudiostart?: (() => void) | null;
  onsoundstart?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  onsoundend?: (() => void) | null;
  onaudioend?: (() => void) | null;
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

let sharedMicrophonePermissionRequest: Promise<AyasMicPermissionState> | null = null;

export class BrowserVoiceAdapter implements AyasVoicePlatform {
  detectCapability(): AyasVoiceCapability {
    const w = getWindow();
    return detectAyasVoiceCapability(w ? (w as never) : undefined);
  }

  /**
   * Best-effort — Chromium exposes `navigator.permissions.query({name:
   * "microphone"})`; Safari/WebKit throws or has no `permissions` object at
   * all, in which case this resolves to `"unknown"` (a real platform gap,
   * never reported as "denied"). Never requests permission itself.
   */
  async queryMicPermission(): Promise<AyasMicPermissionState> {
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    try {
      const status = await nav?.permissions?.query({ name: "microphone" as PermissionName });
      if (status?.state === "granted" || status?.state === "denied" || status?.state === "prompt") {
        return status.state;
      }
    } catch {
      /* Safari/WebKit: no "microphone" permission descriptor support. */
    }
    return "unknown";
  }

  /**
   * Request microphone access immediately from the caller's user gesture.
   * The promise is shared while a prompt is open, so a gesture cannot create
   * competing getUserMedia prompts. Tracks are stopped immediately: the
   * actual SpeechRecognition / wake adapter remains the owner of live capture.
   */
  requestMicrophonePermission(): Promise<AyasMicPermissionState> {
    if (sharedMicrophonePermissionRequest) return sharedMicrophonePermissionRequest;
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    const mediaDevices = nav?.mediaDevices;
    const getUserMedia = mediaDevices?.getUserMedia;
    if (typeof getUserMedia !== "function") return Promise.resolve("unknown");

    sharedMicrophonePermissionRequest = getUserMedia.call(mediaDevices, { audio: true })
      .then((stream) => {
        for (const track of stream.getTracks()) track.stop();
        return "granted" as const;
      })
      .catch((error: unknown) => {
        const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
        return name === "NotAllowedError" || name === "PermissionDeniedError" ? "denied" : "unknown";
      })
      .finally(() => {
        sharedMicrophonePermissionRequest = null;
      });
    return sharedMicrophonePermissionRequest;
  }

  recognitionMode(): AyasRecognitionMode {
    const w = getWindow();
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    return detectAyasSpeechRecognitionMode({
      win: w ? (w as never) : undefined,
      nav: nav
        ? { userAgent: nav.userAgent, platform: nav.platform, maxTouchPoints: nav.maxTouchPoints }
        : undefined,
    });
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

  startListening(
    lang: string,
    handlers: AyasListenHandlers,
    options?: AyasListenOptions,
  ): AyasListenHandle {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      handlers.onError("not-allowed");
      return { stop() {} };
    }

    const singleShot = options?.singleShot === true;

    let recognition: SpeechRecognitionLike | null = new Ctor();
    recognition.lang = lang || "tr-TR";
    // iOS / WebKit is single-shot and drops the transcript if we wait for a
    // final-only result — capture interims and keep the last one as the fallback.
    recognition.continuous = !singleShot;
    recognition.interimResults = singleShot;
    recognition.maxAlternatives = 1;

    let forwardedFinal = false;
    let lastInterim = "";

    recognition.onresult = (event) => {
      handlers.onEvent?.("result");
      let final = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result?.[0]?.transcript ?? "";
        if (result?.isFinal) final += text;
        else interim += text;
      }
      final = final.trim();
      interim = interim.trim();
      if (final) {
        forwardedFinal = true;
        handlers.onFinalTranscript(final);
      } else if (singleShot && interim) {
        lastInterim = interim;
      }
    };
    recognition.onerror = (event) => {
      handlers.onEvent?.("error");
      handlers.onError(event?.error ?? "unknown");
    };
    // Fires once recognition genuinely begins — the mic is live, which can
    // only happen after the browser's permission prompt was accepted (or was
    // already granted from a prior visit). The one reliable, immediate signal
    // that a "prompt" permission state just became "granted".
    recognition.onstart = () => {
      handlers.onEvent?.("start");
      handlers.onListening?.();
    };
    recognition.onaudiostart = () => handlers.onEvent?.("audiostart");
    recognition.onsoundstart = () => handlers.onEvent?.("soundstart");
    recognition.onspeechstart = () => handlers.onEvent?.("speechstart");
    recognition.onspeechend = () => handlers.onEvent?.("speechend");
    recognition.onsoundend = () => handlers.onEvent?.("soundend");
    recognition.onaudioend = () => handlers.onEvent?.("audioend");
    recognition.onend = () => {
      handlers.onEvent?.("end");
      // iOS often ends without ever marking a result final — forward the last
      // interim once so a spoken command is not silently lost.
      if (singleShot && !forwardedFinal && lastInterim) {
        forwardedFinal = true;
        handlers.onFinalTranscript(lastInterim);
      }
      handlers.onEnd();
    };

    try {
      recognition.start();
    } catch {
      // iOS rejects `start()` outside a user activation, or it throws when
      // called twice quickly. Surface it — never leave the UI stuck "listening".
      handlers.onError("start-blocked");
    }

    return {
      stop() {
        const current = recognition;
        recognition = null;
        if (!current) return;
        current.onresult = null;
        current.onerror = null;
        current.onend = null;
        current.onstart = null;
        current.onaudiostart = null;
        current.onsoundstart = null;
        current.onspeechstart = null;
        current.onspeechend = null;
        current.onsoundend = null;
        current.onaudioend = null;
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
