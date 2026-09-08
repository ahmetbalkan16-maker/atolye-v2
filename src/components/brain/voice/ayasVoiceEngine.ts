/**
 * AYAS — voice engine (Sprint 187). Pure orchestration, platform-independent.
 *
 * `AyasVoiceEngine` coordinates the whole voice experience — wake-word capture,
 * the state machine, self-hearing prevention, and speaking a reply — through an
 * injected {@link AyasVoicePlatform}. It contains NO browser API: the DOM wiring
 * lives in `browserVoiceAdapter.ts`, so the same engine can later drive a
 * mobile / native / always-on adapter without change.
 *
 * Execution-gate red line: the engine only ever turns speech into text and text
 * into speech. A captured command is delivered verbatim to `onCommand` and
 * nothing else — it runs no task, no pipeline, no GPU, approves nothing.
 *
 * Race safety: every external command (`enableListening`, `disableListening`,
 * `speak`, `stopSpeaking`, `markThinking`, `dispose`) bumps a monotonic epoch.
 * Async callbacks from a superseded recogniser / utterance compare their
 * captured epoch and no-op if stale — a late "wake" cannot knock AYAS out of
 * "speaking".
 */

import {
  AYAS_TTS_AUTOPLAY_BLOCKED,
  ayasRestingVoiceState,
  describeAyasRecognitionError,
  detectAyasWakeWord,
  nextAyasVoiceState,
  resolveAyasSpeechParams,
  selectAyasVoice,
  stripLeadingWakeWord,
  toSpokenAyasText,
  type AyasPlatformVoice,
  type AyasVoiceCapability,
  type AyasVoiceMachineContext,
  type AyasVoiceSelection,
  type AyasVoiceState,
} from "../ayasVoice";

/* ----------------------------------------------------------------- platform --- */

export interface AyasListenHandlers {
  /** A final (non-interim) transcript segment. */
  onFinalTranscript(text: string): void;
  /** A `SpeechRecognition` error code (`"not-allowed"`, `"no-speech"`, …). */
  onError(code: string): void;
  /** The recogniser stopped (it stops itself periodically even when healthy). */
  onEnd(): void;
}

export interface AyasListenHandle {
  stop(): void;
}

export interface AyasSpeakOptions {
  readonly voiceName: string | null;
  readonly lang: string;
  readonly pitch: number;
  readonly rate: number;
  readonly volume: number;
  onStart(): void;
  onEnd(): void;
  onError(): void;
}

export interface AyasSpeakHandle {
  cancel(): void;
}

/**
 * Everything the engine needs from a host platform. A browser implementation is
 * `BrowserVoiceAdapter`; tests inject a synchronous mock.
 */
export interface AyasVoicePlatform {
  detectCapability(): AyasVoiceCapability;
  listVoices(): AyasPlatformVoice[];
  /** Subscribe to async voice-list population; returns an unsubscribe fn. */
  onVoicesChanged(callback: () => void): () => void;
  startListening(lang: string, handlers: AyasListenHandlers): AyasListenHandle;
  speak(text: string, options: AyasSpeakOptions): AyasSpeakHandle;
  cancelSpeech(): void;
}

/* ------------------------------------------------------------------ engine --- */

export interface AyasVoiceEngineCallbacks {
  onStateChange(state: AyasVoiceState): void;
  /** A spoken command (wake word already stripped). Text in, nothing else. */
  onCommand(text: string): void;
  /** A recoverable error message (Turkish, user-facing). */
  onError(message: string): void;
  /** The wake word was just heard (before any command). */
  onWake(): void;
  /** Auto-speech was blocked by the browser; `text` can be replayed on a gesture. */
  onAutoplayBlocked(text: string): void;
}

const RESTART_DEBOUNCE_MS = 350;
const WAKE_TIMEOUT_MS = 12_000;
const SPEAK_START_TIMEOUT_MS = 1_600;

export interface AyasVoiceEngineOptions {
  /** Debounce before restarting the recogniser after it stops itself. */
  readonly restartDebounceMs?: number;
  /** How long a bare "AYAS" stays "awake" waiting for a follow-up command. */
  readonly wakeTimeoutMs?: number;
  /** How long to wait for `onstart` before treating auto-speech as blocked. */
  readonly speakStartTimeoutMs?: number;
}

export class AyasVoiceEngine {
  private readonly platform: AyasVoicePlatform;
  private readonly cb: AyasVoiceEngineCallbacks;
  private readonly restartDebounceMs: number;
  private readonly wakeTimeoutMs: number;
  private readonly speakStartTimeoutMs: number;

  private _state: AyasVoiceState;
  private _listening = false;
  private woke = false;
  private epoch = 0;
  private disposed = false;

  private capability: AyasVoiceCapability;
  private selection: AyasVoiceSelection;

  private listenHandle: AyasListenHandle | null = null;
  private speakHandle: AyasSpeakHandle | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private speakStartTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly offVoicesChanged: () => void;

  constructor(
    platform: AyasVoicePlatform,
    callbacks: AyasVoiceEngineCallbacks,
    options: AyasVoiceEngineOptions = {},
  ) {
    this.platform = platform;
    this.cb = callbacks;
    this.restartDebounceMs = options.restartDebounceMs ?? RESTART_DEBOUNCE_MS;
    this.wakeTimeoutMs = options.wakeTimeoutMs ?? WAKE_TIMEOUT_MS;
    this.speakStartTimeoutMs = options.speakStartTimeoutMs ?? SPEAK_START_TIMEOUT_MS;
    this.capability = safeCapability(platform);
    this.selection = selectAyasVoice(safeVoices(platform));
    this._state = ayasRestingVoiceState(this.ctx());
    this.offVoicesChanged = platform.onVoicesChanged(() => {
      if (this.disposed) return;
      this.selection = selectAyasVoice(safeVoices(platform));
    });
  }

  /* ---- read-only view ---- */

  get state(): AyasVoiceState {
    return this._state;
  }
  get listening(): boolean {
    return this._listening;
  }
  get capabilities(): AyasVoiceCapability {
    return this.capability;
  }
  get voiceSelection(): AyasVoiceSelection {
    return this.selection;
  }

  private ctx(): AyasVoiceMachineContext {
    return {
      listening: this._listening,
      hasStt: this.capability.stt,
      hasTts: this.capability.tts,
    };
  }

  private transition(event: Parameters<typeof nextAyasVoiceState>[1]): void {
    this.setState(nextAyasVoiceState(this._state, event, this.ctx()));
  }

  private setState(state: AyasVoiceState): void {
    if (this.disposed || state === this._state) return;
    this._state = state;
    this.cb.onStateChange(state);
  }

  /* ---- listening (STT) ---- */

  enableListening(): void {
    if (this.disposed || !this.capability.stt) return;
    this._listening = true;
    this.woke = false;
    this.transition("enable-listen");
    this.startRecognition();
  }

  disableListening(): void {
    if (this.disposed) return;
    this._listening = false;
    this.woke = false;
    this.bumpEpoch();
    this.teardownRecognition();
    this.transition("disable-listen");
  }

  private bumpEpoch(): void {
    this.epoch += 1;
    this.clearTimer("restartTimer");
    this.clearTimer("wakeTimer");
  }

  private startRecognition(): void {
    if (this.disposed || !this._listening || !this.capability.stt) return;
    // Never capture while AYAS is talking or busy — that is how it would hear
    // its own TTS output and treat it as a command.
    if (this._state === "speaking" || this._state === "thinking") return;

    this.teardownRecognition();
    const gen = this.epoch;
    let handle: AyasListenHandle;
    try {
      handle = this.platform.startListening(this.selection.lang, {
        onFinalTranscript: (text) => {
          if (this.isStale(gen)) return;
          this.handleTranscript(text);
        },
        onError: (code) => {
          if (this.isStale(gen)) return;
          this.handleRecognitionError(code);
        },
        onEnd: () => {
          if (this.isStale(gen)) return;
          this.listenHandle = null;
          if (this._listening && this._state !== "speaking" && this._state !== "thinking") {
            this.clearTimer("restartTimer");
            this.restartTimer = setTimeout(() => {
              this.restartTimer = null;
              this.startRecognition();
            }, this.restartDebounceMs);
          }
        },
      });
    } catch {
      this.cb.onError(describeAyasRecognitionError("unknown"));
      return;
    }
    this.listenHandle = handle;
    if (this._state === "off" || this._state === "unsupported" || this._state === "error") {
      this.setState("idle");
    }
  }

  private teardownRecognition(): void {
    this.clearTimer("restartTimer");
    const handle = this.listenHandle;
    this.listenHandle = null;
    if (handle) {
      try {
        handle.stop();
      } catch {
        /* already stopped */
      }
    }
  }

  private handleTranscript(raw: string): void {
    const transcript = String(raw ?? "").trim();
    if (!transcript) return;
    // Self-hearing guard (defence in depth — recognition is also torn down).
    if (this._state === "speaking" || this._state === "thinking") return;

    if (!this.woke) {
      const match = detectAyasWakeWord(transcript);
      if (!match.woke) return;
      this.woke = true;
      this.cb.onWake();
      this.transition("wake");
      this.armWakeTimeout();
      if (match.command) {
        this.dispatchCommand(match.command);
      }
      return;
    }

    // Already awake — this utterance is the command.
    this.dispatchCommand(stripLeadingWakeWord(transcript));
  }

  private dispatchCommand(command: string): void {
    this.woke = false;
    this.clearTimer("wakeTimer");
    const text = String(command ?? "").trim();
    if (!text) {
      // A bare "AYAS" with no follow-up — stay awake, keep waiting.
      this.woke = true;
      this.armWakeTimeout();
      return;
    }
    this.transition("capture-command");
    // Pause the mic while the reply is produced + spoken.
    this.bumpEpoch();
    this.teardownRecognition();
    this.cb.onCommand(text);
  }

  private armWakeTimeout(): void {
    this.clearTimer("wakeTimer");
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      if (this.woke && this._state === "listening") {
        this.woke = false;
        this.transition("speak-end"); // → resting (idle while listening)
      }
    }, this.wakeTimeoutMs);
  }

  private handleRecognitionError(code: string): void {
    if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
      this._listening = false;
      this.woke = false;
      this.bumpEpoch();
      this.teardownRecognition();
      this.cb.onError(describeAyasRecognitionError(code));
      this.transition("error");
      return;
    }
    if (code === "no-speech" || code === "aborted" || code === "network") {
      // Transient — `onEnd` will restart the recogniser.
      return;
    }
    this.cb.onError(describeAyasRecognitionError(code));
  }

  /* ---- speaking (TTS) ---- */

  /** Speak a reply. Safe to call for typed OR spoken turns. */
  speak(text: string): void {
    if (this.disposed || !this.capability.tts) {
      this.markIdle();
      return;
    }
    const spoken = toSpokenAyasText(text);
    if (!spoken) {
      this.markIdle();
      return;
    }

    this.bumpEpoch();
    this.teardownRecognition();
    this.safeCancelSpeech();

    const gen = this.epoch;
    const params = resolveAyasSpeechParams();
    let started = false;

    const finish = () => {
      if (this.isStale(gen)) return;
      this.clearTimer("speakStartTimer");
      this.speakHandle = null;
      this.afterOutput();
    };

    try {
      this.speakHandle = this.platform.speak(spoken, {
        voiceName: this.selection.voiceName,
        lang: this.selection.lang,
        pitch: params.pitch,
        rate: params.rate,
        volume: params.volume,
        onStart: () => {
          if (this.isStale(gen)) return;
          started = true;
          this.clearTimer("speakStartTimer");
          this.transition("speak-start");
        },
        onEnd: finish,
        onError: finish,
      });
    } catch {
      this.speakHandle = null;
      this.afterOutput();
      return;
    }

    // Auto-speech is often blocked until a user gesture: `speak()` silently
    // does nothing and never fires `onstart`. Detect that and offer a replay.
    this.clearTimer("speakStartTimer");
    if (started || this.isStale(gen)) return;
    this.speakStartTimer = setTimeout(() => {
      this.speakStartTimer = null;
      if (this.isStale(gen) || started) return;
      this.safeCancelSpeech();
      this.speakHandle = null;
      this.cb.onError(AYAS_TTS_AUTOPLAY_BLOCKED);
      this.cb.onAutoplayBlocked(text);
      this.afterOutput();
    }, this.speakStartTimeoutMs);
  }

  /** Stop any in-progress speech immediately. */
  stopSpeaking(): void {
    if (this.disposed) return;
    this.bumpEpoch();
    this.clearTimer("speakStartTimer");
    if (this.speakHandle) {
      try {
        this.speakHandle.cancel();
      } catch {
        /* ignore */
      }
      this.speakHandle = null;
    }
    this.safeCancelSpeech();
    this.afterOutput();
  }

  /** A typed turn was sent; show THINKING and pause the mic. */
  markThinking(): void {
    if (this.disposed) return;
    this.bumpEpoch();
    this.teardownRecognition();
    this.transition("capture-command");
  }

  /** Return to the resting state (used when a reply will not be spoken). */
  markIdle(): void {
    if (this.disposed || this._state === "speaking") return;
    this.afterOutput();
  }

  private afterOutput(): void {
    this.clearTimer("speakStartTimer");
    this.transition("speak-end");
    if (this._listening && this.capability.stt) {
      this.startRecognition();
    }
  }

  /* ---- lifecycle ---- */

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bumpEpoch();
    this.clearTimer("speakStartTimer");
    this.teardownRecognition();
    this.safeCancelSpeech();
    try {
      this.offVoicesChanged();
    } catch {
      /* ignore */
    }
  }

  /* ---- helpers ---- */

  private isStale(gen: number): boolean {
    return this.disposed || gen !== this.epoch;
  }

  private safeCancelSpeech(): void {
    try {
      this.platform.cancelSpeech();
    } catch {
      /* ignore */
    }
  }

  private clearTimer(
    key: "restartTimer" | "wakeTimer" | "speakStartTimer",
  ): void {
    const timer = this[key];
    if (timer) {
      clearTimeout(timer);
      this[key] = null;
    }
  }
}

function safeCapability(platform: AyasVoicePlatform): AyasVoiceCapability {
  try {
    return platform.detectCapability();
  } catch {
    return { stt: false, tts: false, sttCloudBacked: false };
  }
}

function safeVoices(platform: AyasVoicePlatform): AyasPlatformVoice[] {
  try {
    return platform.listVoices();
  } catch {
    return [];
  }
}
