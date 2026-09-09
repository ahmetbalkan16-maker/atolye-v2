"use client";

/**
 * AYAS — wake-engine voice platform (Voice Closure Sprint).
 *
 * An {@link AyasVoicePlatform} that replaces `webkitSpeechRecognition` with:
 *
 *   getUserMedia → AudioWorklet (16 kHz mono, 80 ms frames)
 *     → OpenWakeWordRunner   "AYAS"  → onFinalTranscript("AYAS")
 *     → command capture (~5 s / silence) → POST /api/ayas/stt
 *                                        → onFinalTranscript(<turkish text>)
 *
 * The captured command text then flows through the engine's existing
 * `onCommand` → `runAyas` path — unchanged, still gated, still text-only. TTS is
 * delegated verbatim to the injected {@link BrowserVoiceAdapter}. Audio never
 * leaves the device except the one command clip POSTed to the local STT route.
 *
 * The mic stays open across turns (no per-utterance gesture), so the engine
 * treats this like the `"continuous"` path for re-arming — see
 * `AyasRecognitionMode`.
 */

import { isWakeEngineCapable, type AyasPlatformVoice, type AyasRecognitionMode, type AyasVoiceCapability } from "../ayasVoice";
import type {
  AyasListenHandle,
  AyasListenHandlers,
  AyasListenOptions,
  AyasSpeakHandle,
  AyasSpeakOptions,
  AyasVoicePlatform,
} from "./ayasVoiceEngine";
import { BrowserVoiceAdapter } from "./browserVoiceAdapter";
import { OpenWakeWordRunner } from "./wake/openWakeWordRunner";
import { encodeWav16kMono } from "./wake/wav";

const FRAME = 1280; // 80 ms @ 16 kHz — matches the worklet + openWakeWord
const COMMAND_MAX_MS = 6000;
const COMMAND_SILENCE_MS = 900;
const COMMAND_MIN_MS = 350;
const REARM_COOLDOWN_MS = 700;
/** getUserMedia / ONNX load can hang on iOS — bound it so a hang can't wedge AYAS. */
const AUDIO_START_TIMEOUT_MS = 12_000;
/** Transient start failures (AbortError, timeout) get this many retries before fatal. */
const MAX_START_ATTEMPTS = 3;
/** Frame-flow watchdog: check this often while detecting. */
const WATCHDOG_INTERVAL_MS = 1500;
/** No 80 ms frame for this long while armed ⇒ the iOS AudioContext stalled — recover. */
const FRAME_STALL_MS = 2500;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}-timeout`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** True for a genuine, unrecoverable permission / hardware denial. */
function isFatalMediaError(error: unknown): boolean {
  const e = error as { name?: string; message?: string };
  const name = e?.name ?? "";
  const msg = e?.message ?? "";
  return (
    name === "NotAllowedError" ||
    name === "SecurityError" ||
    name === "NotFoundError" ||
    /permission|denied|not allowed/i.test(msg)
  );
}

export type WakeAdapterPhase =
  | "idle"
  | "starting"
  | "wake"
  | "capturing"
  | "processing"
  | "speaking"
  | "rearming"
  | "recovering"
  | "fatal"
  | "disposed";

export interface WakeAdapterStatus {
  readonly mic: "off" | "starting" | "on" | "recovering" | "fatal";
  readonly phase: WakeAdapterPhase;
  readonly cyclesCompleted: number;
  readonly startAttempts: number;
  /** How many times the pipeline was rebuilt after a stall / track-end. */
  readonly recoveryCount: number;
  /** ms since the last 80 ms frame arrived (`-1` before the first frame). */
  readonly frameAgeMs: number;
  /** Wake frames dropped because inference was still busy (iOS back-pressure). */
  readonly droppedFrames: number;
  /** The capture AudioContext state, or `"unknown"`. */
  readonly audioContextState: string;
  readonly lastError: string | null;
}

export interface WakeWordAdapterOptions {
  readonly wakewordUrl?: string;
  readonly melspectrogramUrl?: string;
  readonly embeddingUrl?: string;
  readonly wasmPaths?: string;
  readonly sttUrl?: string;
  /** Detection threshold in [0, 1]. */
  readonly threshold?: number;
  /** Test seam — replace the whole audio backend. */
  readonly audioBackend?: WakeAudioBackend;
  /** Test seam — replace the wake runner. */
  readonly runner?: WakeRunnerLike;
  /** Test seam — replace the STT transport. */
  readonly transcribe?: (wav: Uint8Array) => Promise<string>;
  /**
   * Called once when the wake engine cannot start on this device (mic denied,
   * ONNX/WASM failed to load, no worklet). The host should fall back to the
   * browser voice adapter — the engine will otherwise keep retrying `begin()`.
   */
  readonly onUnavailable?: (reason: "not-allowed" | "start-blocked") => void;
  /** Re-arm cooldown after a turn (default 700 ms). Test seam. */
  readonly rearmCooldownMs?: number;
  /** Backoff between mic-start retries: `n * attempt` ms (default 400). Test seam. */
  readonly startRetryBackoffMs?: number;
  /** Frame-flow watchdog tick interval (default 1500 ms). Test seam. */
  readonly watchdogIntervalMs?: number;
  /** Frame-stall threshold before a recover (default 2500 ms). Test seam. */
  readonly frameStallMs?: number;
  /** Test seam — the TTS platform (defaults to a fresh {@link BrowserVoiceAdapter}). */
  readonly tts?: Pick<
    AyasVoicePlatform,
    "speak" | "cancelSpeech" | "detectCapability" | "listVoices" | "onVoicesChanged"
  >;
  /** Fired on every phase transition — numeric/enum only, for a UI status line. */
  readonly onStatus?: (status: WakeAdapterStatus) => void;
}

export interface WakeRunnerLike {
  readonly ready: boolean;
  init(): Promise<void>;
  reset(): void;
  dispose(): void;
  accept(frame: Float32Array): Promise<number | null>;
}

/** The mic + worklet, abstracted so tests can drive frames synchronously. */
export interface WakeAudioBackend {
  /** Start capture; `onFrame` gets 1280-sample 16 kHz mono frames in [-1,1]. */
  start(onFrame: (frame: Float32Array) => void): Promise<void>;
  stop(): void;
  /**
   * Lightweight recovery: resume a suspended AudioContext (iOS suspends it while
   * `speechSynthesis` plays). Returns `true` if the capture is healthy again,
   * `false` if it must be fully rebuilt (track ended / context closed). Optional.
   */
  recover?(): Promise<boolean>;
  /** Current AudioContext state for diagnostics (`"unknown"` if not applicable). */
  state?(): string;
  /** Best-effort: does the environment support this path at all? */
  readonly supported: boolean;
}

const DEFAULTS = {
  wakewordUrl: "/wake/ayas.onnx",
  melspectrogramUrl: "/wake/melspectrogram.onnx",
  embeddingUrl: "/wake/embedding_model.onnx",
  wasmPaths: "/ort/",
  sttUrl: "/api/ayas/stt",
  threshold: 0.7,
};

function frameRms(f: Float32Array): number {
  let s = 0;
  for (let i = 0; i < f.length; i += 1) s += f[i] * f[i];
  return Math.sqrt(s / f.length);
}

async function postStt(url: string, wav: Uint8Array): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: new Blob([wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer], {
      type: "audio/wav",
    }),
  });
  if (!res.ok) throw new Error(`stt-${res.status}`);
  const data = (await res.json()) as { text?: string };
  return typeof data.text === "string" ? data.text.trim() : "";
}

export class WakeWordVoiceAdapter implements AyasVoicePlatform {
  private readonly tts: Pick<
    AyasVoicePlatform,
    "speak" | "cancelSpeech" | "detectCapability" | "listVoices" | "onVoicesChanged"
  >;
  private readonly o: Required<
    Omit<
      WakeWordAdapterOptions,
      | "audioBackend"
      | "runner"
      | "transcribe"
      | "onUnavailable"
      | "rearmCooldownMs"
      | "startRetryBackoffMs"
      | "watchdogIntervalMs"
      | "frameStallMs"
      | "tts"
      | "onStatus"
    >
  >;
  private readonly rearmCooldownMs: number;
  private readonly startRetryBackoffMs: number;
  private readonly watchdogIntervalMs: number;
  private readonly frameStallMs: number;
  private readonly audio: WakeAudioBackend;
  private readonly runner: WakeRunnerLike;
  private readonly transcribe: (wav: Uint8Array) => Promise<string>;
  private readonly onUnavailable?: (reason: "not-allowed" | "start-blocked") => void;
  private readonly onStatus?: (status: WakeAdapterStatus) => void;
  /** Set once the mic cannot be acquired at all — stops the engine's retry loop. */
  private fatal = false;

  /**
   * The mic + AudioContext + worklet + ONNX runner are started ONCE and kept
   * open for the whole session. Re-arming after a turn is a state flip plus a
   * health check (iOS suspends the capture AudioContext while `speechSynthesis`
   * plays, and never resumes it on its own) — never a fresh `getUserMedia`
   * unless the pipeline is genuinely gone (track ended / context closed).
   */
  private phase: WakeAdapterPhase = "idle";
  private handlers: AyasListenHandlers | null = null;
  private cmd: Float32Array[] = [];
  private cmdMs = 0;
  private silenceMs = 0;
  private cooldownUntil = 0;

  private audioUp = false;
  private starting: Promise<void> | null = null;
  private recovering = false;
  /** A wake inference is running — drop frames that land meanwhile (bounded memory). */
  private accepting = false;
  private droppedFrames = 0;
  private lastHealthEmitAt = 0;
  private lastHealthEmitDropped = 0;
  private startAttempts = 0;
  private cyclesCompleted = 0;
  private recoveryCount = 0;
  private lastFrameAt = 0;
  private lastError: string | null = null;
  private disposed = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private readonly onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      void this.resumeOrRebuild("foreground");
    }
  };

  constructor(options: WakeWordAdapterOptions = {}) {
    this.tts = options.tts ?? new BrowserVoiceAdapter();
    this.o = {
      wakewordUrl: options.wakewordUrl ?? DEFAULTS.wakewordUrl,
      melspectrogramUrl: options.melspectrogramUrl ?? DEFAULTS.melspectrogramUrl,
      embeddingUrl: options.embeddingUrl ?? DEFAULTS.embeddingUrl,
      wasmPaths: options.wasmPaths ?? DEFAULTS.wasmPaths,
      sttUrl: options.sttUrl ?? DEFAULTS.sttUrl,
      threshold: options.threshold ?? DEFAULTS.threshold,
    };
    this.audio = options.audioBackend ?? new MediaStreamWorkletBackend();
    this.runner =
      options.runner ??
      new OpenWakeWordRunner({
        wakewordUrl: this.o.wakewordUrl,
        melspectrogramUrl: this.o.melspectrogramUrl,
        embeddingUrl: this.o.embeddingUrl,
        wasmPaths: this.o.wasmPaths,
      });
    this.transcribe = options.transcribe ?? ((wav) => postStt(this.o.sttUrl, wav));
    this.onUnavailable = options.onUnavailable;
    this.onStatus = options.onStatus;
    this.rearmCooldownMs = options.rearmCooldownMs ?? REARM_COOLDOWN_MS;
    this.startRetryBackoffMs = options.startRetryBackoffMs ?? 400;
    this.watchdogIntervalMs = options.watchdogIntervalMs ?? WATCHDOG_INTERVAL_MS;
    this.frameStallMs = options.frameStallMs ?? FRAME_STALL_MS;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  private emit(): void {
    try {
      this.onStatus?.(this.getStatus());
    } catch {
      /* a UI callback must never break the pipeline */
    }
  }

  /** Numeric / enum status for diagnostics — no audio, no secrets. */
  getStatus(): WakeAdapterStatus {
    return {
      mic: this.fatal
        ? "fatal"
        : this.recovering
          ? "recovering"
          : this.audioUp
            ? "on"
            : this.starting
              ? "starting"
              : "off",
      phase: this.phase,
      cyclesCompleted: this.cyclesCompleted,
      startAttempts: this.startAttempts,
      recoveryCount: this.recoveryCount,
      frameAgeMs: this.lastFrameAt === 0 ? -1 : Date.now() - this.lastFrameAt,
      droppedFrames: this.droppedFrames,
      audioContextState: this.audio.state?.() ?? "unknown",
      lastError: this.lastError,
    };
  }

  /* ---- TTS + capability: delegate to the browser adapter ---- */
  detectCapability(): AyasVoiceCapability {
    const base = this.tts.detectCapability();
    // STT is local (whisper), not the cloud webkit engine.
    return { ...base, stt: true, sttCloudBacked: false };
  }
  listVoices(): AyasPlatformVoice[] {
    return this.tts.listVoices();
  }
  onVoicesChanged(cb: () => void): () => void {
    return this.tts.onVoicesChanged(cb);
  }
  speak(text: string, options: AyasSpeakOptions): AyasSpeakHandle {
    // The wake pipeline must NOT hear its own TTS — pause detection while it plays.
    if (this.phase === "wake" || this.phase === "rearming") this.phase = "speaking";
    let done = false;
    const afterSpeak = () => {
      if (done) return;
      done = true;
      // iOS suspends the capture AudioContext while speechSynthesis plays and
      // does not resume it. Proactively verify + resume before the engine re-arms.
      if (this.audioUp && !this.disposed && !this.fatal) void this.resumeOrRebuild("post-tts");
    };
    return this.tts.speak(text, {
      ...options,
      onEnd: () => {
        options.onEnd();
        afterSpeak();
      },
      onError: () => {
        options.onError();
        afterSpeak();
      },
    });
  }
  cancelSpeech(): void {
    this.tts.cancelSpeech();
  }

  recognitionMode(): AyasRecognitionMode {
    return "wake-engine";
  }

  static isSupported(win: Window | undefined): boolean {
    return isWakeEngineCapable(win as never);
  }

  startListening(lang: string, handlers: AyasListenHandlers, options?: AyasListenOptions): AyasListenHandle {
    void lang; // the openWakeWord model + the whisper route are both tr-only
    void options;
    this.handlers = handlers;

    // A device that has NO mic access will never get one — end quietly instead
    // of letting the engine's `onEnd` loop retry forever.
    if (this.fatal || this.disposed) {
      this.phase = "idle";
      queueMicrotask(() => handlers.onEnd());
      return { stop: () => {} };
    }

    this.resetCommand();

    if (this.audioUp) {
      // Re-arm after a turn: the mic + worklet are still live, but the iOS
      // AudioContext may have been suspended during TTS — verify + resume before
      // arming, and reset the streaming window.
      this.phase = "rearming";
      void this.ensureWakeReady();
    } else if (!this.starting && !this.recovering) {
      this.phase = "starting";
      void this.ensureAudio(handlers);
    }

    return {
      // The engine calls this on every `teardownRecognition` (per turn). It is
      // a PAUSE, not a teardown — keep the mic warm for the re-arm.
      stop: () => {
        if (this.phase === "wake" || this.phase === "rearming") this.phase = "idle";
      },
    };
  }

  /** Bring the mic + worklet + ONNX runner up ONCE, with a bounded retry. */
  private async ensureAudio(handlers: AyasListenHandlers): Promise<void> {
    if (this.audioUp || this.starting || this.disposed) return;
    const run = (async () => {
      for (this.startAttempts = 1; this.startAttempts <= MAX_START_ATTEMPTS; this.startAttempts += 1) {
        try {
          if (!this.runner.ready) {
            await withTimeout(this.runner.init(), AUDIO_START_TIMEOUT_MS, "runner-init");
          }
          this.runner.reset();
          await withTimeout(
            this.audio.start((frame) => this.onFrame(frame)),
            AUDIO_START_TIMEOUT_MS,
            "mic-start",
          );
          if (this.disposed) {
            this.audio.stop();
            return;
          }
          this.audioUp = true;
          this.lastError = null;
          this.lastFrameAt = Date.now();
          if (this.phase === "starting" || this.phase === "recovering") this.phase = "wake";
          this.armWatchdog();
          this.emit();
          return;
        } catch (error) {
          this.lastError = (error as Error)?.name || (error as Error)?.message || "start-error";
          try {
            this.audio.stop();
          } catch {
            /* ignore */
          }
          if (isFatalMediaError(error) || this.startAttempts >= MAX_START_ATTEMPTS) {
            this.fatal = true;
            this.phase = "fatal";
            this.emit();
            const reason = isFatalMediaError(error) ? "not-allowed" : "start-blocked";
            this.onUnavailable?.(reason);
            handlers.onError(reason);
            handlers.onEnd();
            return;
          }
          await delay(this.startRetryBackoffMs * this.startAttempts);
          if (this.disposed) return;
        }
      }
    })();
    this.starting = run.finally(() => {
      this.starting = null;
    });
    await this.starting;
  }

  /**
   * Re-arm: make sure the capture pipeline is actually producing frames, then
   * flip to `wake`. Called after every turn (from `startListening`) — this is
   * where the "first turn works, then dead" iOS bug is caught: the AudioContext
   * suspended during TTS is resumed here.
   */
  private async ensureWakeReady(): Promise<void> {
    if (this.disposed || this.fatal) return;
    if (!this.audioUp) {
      const h = this.handlers;
      if (h) {
        this.phase = "starting";
        await this.ensureAudio(h);
      }
      return;
    }
    await this.resumeOrRebuild("rearm");
    if (this.disposed || this.fatal || !this.audioUp) return;
    this.accepting = false;
    this.runner.reset();
    this.phase = "wake";
    this.lastFrameAt = Date.now();
    this.armWatchdog();
    this.emit();
  }

  /**
   * Resume a suspended AudioContext (the common iOS-after-TTS case). If the
   * capture is genuinely gone (track ended / context closed), rebuild it once.
   * Guarded so a burst of triggers (re-arm + post-tts + visibility) runs once.
   */
  private async resumeOrRebuild(reason: string): Promise<void> {
    if (this.recovering || this.disposed || this.fatal || !this.audioUp) return;
    this.recovering = true;
    this.emit();
    try {
      const before = this.lastFrameAt;
      let healthy = this.audio.recover
        ? await withTimeout(this.audio.recover(), AUDIO_START_TIMEOUT_MS, "recover").catch(() => false)
        : true;
      // A stall means frames actually stopped — a bare `resume()` claiming
      // health is not enough; if no frame arrives shortly, force a rebuild.
      if (healthy && reason === "stall") {
        await delay(Math.min(500, this.frameStallMs));
        if (this.lastFrameAt === before) healthy = false;
      }
      if (healthy) {
        this.lastError = null;
        return;
      }
      this.recovering = false; // let ensureAudio run
      await this.rebuildAudio(reason);
    } finally {
      this.recovering = false;
      this.emit();
    }
  }

  /** Full, bounded teardown + re-acquire — only when the pipeline is truly gone. */
  private async rebuildAudio(reason: string): Promise<void> {
    if (this.disposed || this.fatal) return;
    this.recoveryCount += 1;
    this.lastError = `recover:${reason}`;
    const wasArmed =
      this.phase === "wake" || this.phase === "rearming" || this.phase === "capturing";
    this.phase = "recovering";
    try {
      this.audio.stop();
    } catch {
      /* ignore */
    }
    this.audioUp = false;
    this.starting = null;
    this.startAttempts = 0;
    const h = this.handlers;
    if (h) await this.ensureAudio(h);
    if (!this.disposed && !this.fatal && this.audioUp) {
      this.accepting = false;
      this.runner.reset();
      this.phase = wasArmed ? "wake" : "idle";
      this.lastFrameAt = Date.now();
      this.armWatchdog();
    }
  }

  /* ---- frame-flow watchdog: the safety net for a silent iOS stall ---- */

  private armWatchdog(): void {
    this.clearWatchdog();
    if (this.disposed || this.fatal) return;
    this.watchdog = setTimeout(() => this.watchdogTick(), this.watchdogIntervalMs);
    // Node (tests): a watchdog must not keep the process alive on its own.
    (this.watchdog as { unref?: () => void }).unref?.();
  }

  private clearWatchdog(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  private watchdogTick(): void {
    this.watchdog = null;
    if (this.disposed || this.fatal) return;
    const armed = this.phase === "wake" || this.phase === "capturing";
    const stalled = this.audioUp && !this.recovering && Date.now() - this.lastFrameAt > this.frameStallMs;
    if (armed && stalled) {
      void this.resumeOrRebuild("stall").finally(() => this.armWatchdog());
      return;
    }
    // Surface a steady-state health beat while armed so the Brain lifecycle
    // heartbeat records rising `droppedFrames` (the iOS back-pressure signal) —
    // but only when it actually moved, so we don't re-render every tick.
    if (armed && this.audioUp) {
      const now = Date.now();
      if (this.droppedFrames !== this.lastHealthEmitDropped || now - this.lastHealthEmitAt > 6000) {
        this.lastHealthEmitDropped = this.droppedFrames;
        this.lastHealthEmitAt = now;
        this.emit();
      }
    }
    this.armWatchdog();
  }

  private resetCommand(): void {
    this.cmd = [];
    this.cmdMs = 0;
    this.silenceMs = 0;
  }

  private onFrame(frame: Float32Array): void {
    this.lastFrameAt = Date.now();
    const handlers = this.handlers;
    if (!handlers) return;
    const ms = (frame.length / 16000) * 1000;

    if (this.phase === "wake") {
      if (Date.now() < this.cooldownUntil) return;
      // Single-flight. On a phone, 3 WASM ONNX runs per frame can exceed the
      // 80 ms frame period; queuing every frame's `accept()` piles unbounded
      // work + allocations onto the microtask queue → iOS memory-kills the PWA
      // in ~30 s. Drop frames that arrive mid-inference (the runner also guards
      // internally); openWakeWord's sliding windows tolerate the gap.
      if (this.accepting) {
        this.droppedFrames += 1;
        return;
      }
      this.accepting = true;
      void this.runner
        .accept(frame)
        .then((score) => {
          if (this.phase !== "wake" || score === null) return;
          if (score >= this.o.threshold) {
            this.phase = "capturing";
            this.resetCommand();
            this.emit();
            handlers.onFinalTranscript("AYAS");
          }
        })
        .finally(() => {
          this.accepting = false;
        });
      return;
    }

    if (this.phase === "capturing") {
      this.cmd.push(frame.slice(0));
      this.cmdMs += ms;
      this.silenceMs = frameRms(frame) < 0.012 ? this.silenceMs + ms : 0;
      const done =
        this.cmdMs >= COMMAND_MAX_MS ||
        (this.cmdMs >= COMMAND_MIN_MS && this.silenceMs >= COMMAND_SILENCE_MS);
      if (done) {
        this.phase = "processing";
        void this.finishCommand(handlers);
      }
    }
  }

  private async finishCommand(handlers: AyasListenHandlers): Promise<void> {
    const merged = new Float32Array(this.cmd.reduce((n, f) => n + f.length, 0));
    let off = 0;
    for (const f of this.cmd) {
      merged.set(f, off);
      off += f.length;
    }
    this.resetCommand();
    try {
      const wav = encodeWav16kMono(merged);
      const text = await this.transcribe(wav);
      if (text) handlers.onFinalTranscript(text);
      else handlers.onError("no-speech");
    } catch (error) {
      handlers.onError((error as Error).message === "stt-503" ? "network" : "unknown");
    } finally {
      // Pause detection + start the re-arm cooldown, but KEEP the mic open — the
      // engine re-arms us via `startListening` after it speaks the reply.
      this.cooldownUntil = Date.now() + this.rearmCooldownMs;
      this.phase = "idle";
      this.cyclesCompleted += 1;
      this.emit();
      handlers.onEnd(); // engine re-arms (wake-engine == continuous for re-arm)
    }
  }

  dispose(): void {
    this.disposed = true;
    this.phase = "disposed";
    this.handlers = null;
    this.audioUp = false;
    this.starting = null;
    this.recovering = false;
    this.accepting = false;
    this.clearWatchdog();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    try {
      this.audio.stop();
    } catch {
      /* ignore */
    }
    try {
      this.runner.dispose();
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------ real backend --- */

class MediaStreamWorkletBackend implements WakeAudioBackend {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;

  get supported(): boolean {
    return WakeWordVoiceAdapter.isSupported(typeof window === "undefined" ? undefined : window);
  }

  async start(onFrame: (frame: Float32Array) => void): Promise<void> {
    const Ctor =
      (typeof window.AudioContext === "function" ? window.AudioContext : undefined) ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    await this.ctx.resume();
    // openWakeWord was trained on unprocessed audio. Browser noise-suppression
    // and auto-gain dynamically reshape the spectral envelope and clamp speech
    // onsets, which makes the per-frame wake score inconsistent ("sometimes it
    // hears me"). Keep echo-cancellation on so AYAS's own TTS can't self-trigger.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    });
    await this.ctx.audioWorklet.addModule("/worklets/d2-wake-lab-processor.js");
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "d2-wake-lab-processor");
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    this.node.port.onmessage = (e: MessageEvent<{ type: string; samples?: Float32Array }>) => {
      if (e.data.type === "frame" && e.data.samples && e.data.samples.length === FRAME) onFrame(e.data.samples);
    };
    src.connect(this.node);
    this.node.connect(gain);
    gain.connect(this.ctx.destination);
  }

  state(): string {
    return this.ctx?.state ?? "unknown";
  }

  async recover(): Promise<boolean> {
    const track = this.stream?.getAudioTracks()[0];
    // A closed context or an ended track cannot be resumed — needs a rebuild.
    if (!this.ctx || this.ctx.state === "closed" || !track || track.readyState === "ended") {
      return false;
    }
    if (this.ctx.state !== "running") {
      try {
        await this.ctx.resume();
      } catch {
        return false;
      }
    }
    // `muted` is often transient on iOS after an interruption — treat a running
    // context as recovered; the adapter's frame-flow watchdog rebuilds if the
    // frames do not actually resume.
    return this.ctx.state === "running";
  }

  stop(): void {
    try {
      this.node?.port.postMessage("stop");
      this.node?.disconnect();
    } catch {
      /* ignore */
    }
    this.stream?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    if (this.ctx && this.ctx.state !== "closed") this.ctx.close().catch(() => {});
    this.ctx = null;
    this.stream = null;
    this.node = null;
  }
}
