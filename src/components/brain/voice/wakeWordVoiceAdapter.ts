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
  private readonly tts = new BrowserVoiceAdapter();
  private readonly o: Required<
    Omit<WakeWordAdapterOptions, "audioBackend" | "runner" | "transcribe" | "onUnavailable">
  >;
  private readonly audio: WakeAudioBackend;
  private readonly runner: WakeRunnerLike;
  private readonly transcribe: (wav: Uint8Array) => Promise<string>;
  private readonly onUnavailable?: (reason: "not-allowed" | "start-blocked") => void;
  /** Set once `begin()` fails fatally — stops the engine's `onEnd` retry loop. */
  private fatal = false;

  private phase: "off" | "wake" | "command" | "busy" = "off";
  private handlers: AyasListenHandlers | null = null;
  private cmd: Float32Array[] = [];
  private cmdMs = 0;
  private silenceMs = 0;
  private cooldownUntil = 0;

  constructor(options: WakeWordAdapterOptions = {}) {
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
    return this.tts.speak(text, options);
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
    // A prior fatal failure means this device cannot run the wake engine —
    // don't re-attempt `begin()` on every `onEnd` retry; end quietly instead.
    if (this.fatal) {
      this.phase = "off";
      queueMicrotask(() => handlers.onEnd());
      return { stop: () => {} };
    }
    this.phase = "wake";
    this.resetCommand();
    void this.begin(handlers);
    return {
      stop: () => {
        this.phase = "off";
        this.handlers = null;
        this.audio.stop();
      },
    };
  }

  private async begin(handlers: AyasListenHandlers): Promise<void> {
    try {
      if (!this.runner.ready) await this.runner.init();
      this.runner.reset();
      await this.audio.start((frame) => this.onFrame(frame));
    } catch (error) {
      this.phase = "off";
      this.fatal = true;
      const reason = (error as Error).message?.includes("Permission") ? "not-allowed" : "start-blocked";
      this.onUnavailable?.(reason);
      handlers.onError(reason);
      handlers.onEnd();
    }
  }

  private resetCommand(): void {
    this.cmd = [];
    this.cmdMs = 0;
    this.silenceMs = 0;
  }

  private onFrame(frame: Float32Array): void {
    const handlers = this.handlers;
    if (!handlers) return;
    const ms = (frame.length / 16000) * 1000;

    if (this.phase === "wake") {
      if (Date.now() < this.cooldownUntil) return;
      void this.runner.accept(frame).then((score) => {
        if (this.phase !== "wake" || score === null) return;
        if (score >= this.o.threshold) {
          this.phase = "command";
          this.resetCommand();
          handlers.onFinalTranscript("AYAS");
        }
      });
      return;
    }

    if (this.phase === "command") {
      this.cmd.push(frame.slice(0));
      this.cmdMs += ms;
      this.silenceMs = frameRms(frame) < 0.012 ? this.silenceMs + ms : 0;
      const done =
        this.cmdMs >= COMMAND_MAX_MS ||
        (this.cmdMs >= COMMAND_MIN_MS && this.silenceMs >= COMMAND_SILENCE_MS);
      if (done) {
        this.phase = "busy";
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
      this.cooldownUntil = Date.now() + REARM_COOLDOWN_MS;
      this.phase = "off";
      this.audio.stop();
      handlers.onEnd(); // engine re-arms (wake-engine == continuous for re-arm)
    }
  }

  dispose(): void {
    this.phase = "off";
    this.handlers = null;
    this.audio.stop();
    this.runner.dispose();
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
