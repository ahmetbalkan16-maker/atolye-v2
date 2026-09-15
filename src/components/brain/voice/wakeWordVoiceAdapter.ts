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

import {
  detectAyasStopConversationIntent,
  isWakeEngineCapable,
  stripLeadingWakeWord,
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
import { BrowserVoiceAdapter } from "./browserVoiceAdapter";
import { OpenWakeWordRunner, type WakeRunnerStats } from "./wake/openWakeWordRunner";
import { encodeWav16kMono } from "./wake/wav";

const FRAME = 1280; // 80 ms @ 16 kHz — matches the worklet + openWakeWord
/** Hard cap on one spoken command — a long question still fits. */
const COMMAND_MAX_MS = 8000;
/**
 * End-of-speech trailing silence. A short utterance is more likely still being
 * formed → give it longer; a long one is more likely finished → end sooner.
 * Old value (900 ms flat) cut people off mid-sentence when they paused to think.
 */
const EOS_SILENCE_LONG_MS = 1000; // short/medium utterance — room to pause & think
const EOS_SILENCE_SHORT_MS = 700; // clearly-complete long utterance — end sooner
const LONG_UTTERANCE_SPEECH_MS = 2000;
/** Once the command has begun: min command duration AND min post-wake speech to endpoint. */
const COMMAND_MIN_MS = 450;
const COMMAND_MIN_SPEECH_MS = 250;
/**
 * Rolling pre-roll prepended to a command capture. On a phone the wake score is
 * computed on a DELAYED chunk (single-flight + catch-up), so "AYAS" fires
 * hundreds of ms after it was actually spoken — the command's first word is
 * already in the past. A ~1.4 s pre-roll covers the wake word itself + the
 * detection lag + the command onset so nothing is lost. Whisper transcribes the
 * leading "AYAS" and `stripLeadingWakeWord` removes it; the extra ~1 s of audio
 * also lifts the clip above whisper's short-clip hallucination floor.
 *
 * The pre-roll is AUDIO ONLY. It never counts toward the end-of-speech test —
 * see `commandStarted` / `postWakeSpeechMs`. A lone "AYAS" pre-roll plus the
 * user's natural ~1 s pause before the command must NOT finalise the capture.
 */
const PREROLL_FRAMES = 18; // ~1.44 s
/**
 * After the wake word, how long the capture waits for the command to actually
 * START before giving up on a bare "AYAS". Must clear a natural "AYAS … <think>
 * … command" pause — the operator protocol tests a 5 s gap. The pre-roll wake
 * word does NOT count here.
 */
const COMMAND_ONSET_TIMEOUT_MS = 8000;
/**
 * A pre-roll already carrying clearly more speech than a lone wake word
 * (~0.4–0.6 s) — the one-breath "AYAS kaç proje var" where the whole command is
 * in the pre-roll because the wake score landed late. Treat the command as begun.
 */
const PREROLL_COMMAND_HINT_MS = 700;
/** Lead-in frames kept before the first command word when trimming a long gap. */
const COMMAND_LEADIN_FRAMES = 8; // ~640 ms
/** A wake→command gap longer than this ⇒ the pre-roll wake word is stale; drop it + the dead air. */
const COMMAND_GAP_DROP_PREROLL_MS = 1500;
/** Silence RMS floor — the adaptive threshold never drops below / rises above this. */
const SILENCE_RMS_MIN = 0.010;
const SILENCE_RMS_MAX = 0.05;
/** Frames used to estimate the room's noise floor at the start of a capture. */
const NOISE_CAL_FRAMES = 5;
/** RMS a frame must clear to count as speech energy (pre-roll classification). */
const PREROLL_SPEECH_RMS = 0.02;
/** After a turn the wake path ignores audio this long (echo / TTS tail). */
const REARM_COOLDOWN_MS = 350;
/** getUserMedia / ONNX load can hang on iOS — bound it so a hang can't wedge AYAS. */
const AUDIO_START_TIMEOUT_MS = 12_000;
/** Transient start failures (AbortError, timeout) get this many retries before fatal. */
const MAX_START_ATTEMPTS = 3;
/** Frame-flow watchdog: check this often while detecting. */
const WATCHDOG_INTERVAL_MS = 1500;
/** No 80 ms frame for this long while armed ⇒ the iOS AudioContext stalled — recover. */
const FRAME_STALL_MS = 2500;
/**
 * When a re-acquire fails on a session that HAD been working, the pipeline goes
 * to `paused` (not `fatal`) and self-heals on this growing schedule — plus
 * immediately on a mic tap or when the tab returns to the foreground.
 */
const PAUSED_RETRY_BACKOFF_MS = [3_000, 8_000, 20_000] as const;
/**
 * A never-healthy wake engine that is still paused after this many recovery
 * attempts is on a device that truly can't run it → fall back to the browser
 * adapter. Generous, because on a slow iOS device the first few attempts can
 * time out on the ONNX / WASM load or need one more gesture for the AudioContext.
 */
const MAX_UNPAUSE_BEFORE_FALLBACK = 6;
/** Auto-retries from `paused` before AYAS also shows a visible "tap to resume". */
const PAUSED_RETRIES_BEFORE_PROMPT = 3;
/**
 * Conversation session (Sprint — Conversation Session Mode). Once "AYAS" has
 * fired, follow-up commands are captured WITHOUT the wake word until this much
 * silence passes. The timer is reset by every wake hit, every command onset and
 * every finished command; the session is closed early by an explicit stop
 * (`endConversation`) or a fatal mic error. NOT closed by a normal reply.
 */
const CONVERSATION_IDLE_MS = 15_000;

export interface WakeDetectConfig {
  /** A single frame at/above this is an immediate hit. */
  readonly hard: number;
  /** `softVotes` of the last `softWindow` frames at/above this is also a hit. */
  readonly soft: number;
  readonly softVotes: number;
  readonly softWindow: number;
  /**
   * Near-hard fast-path: a frame at/above `nearHardPeak` PLUS at least
   * `nearHardVotes` frames (incl. the peak) at/above `nearHardSoft` in the
   * window is a hit. This catches a real "AYAS" that spikes briefly to
   * ~0.67-0.69 without sustaining 3 soft frames — a clear peak with real
   * support, NOT a lone blip, and it never lowers `hard` or `soft`. Optional
   * (defaults derived from `hard`).
   */
  readonly nearHardPeak?: number;
  readonly nearHardSoft?: number;
  readonly nearHardVotes?: number;
}

/**
 * softWindow 7 (≈ 560 ms) not 5 (400 ms): a carefully pronounced "AYAS" runs
 * ~500-650 ms, and a 400 ms window was clipping it before 3 soft frames could
 * land — the operator's "say it 3×" symptom. nearHardPeak 0.67 is a
 * clear-spike fast-path. hard (0.70) + soft (0.60) are UNCHANGED.
 */
const DEFAULT_WAKE_DETECT: WakeDetectConfig = {
  hard: 0.7,
  soft: 0.6,
  softVotes: 3,
  softWindow: 7,
  nearHardPeak: 0.67,
  nearHardSoft: 0.63,
  nearHardVotes: 2,
};

/**
 * Multi-tier wake decision. The model was trained on ONE synthetic voice
 * (`public/wake/ayas.report.json`), so a real human "AYAS" often peaks just
 * under the hard threshold — a sustained moderate run, or a clear near-hard
 * spike with support, is still a real hit and far less false-positive prone
 * than lowering the hard threshold. Numeric-only; no audio.
 */
export class WakeScoreDetector {
  private recent: number[] = [];
  private n = 0;
  private sum = 0;
  private min = 2;
  private max = -1;
  private hits = 0;
  constructor(private readonly cfg: WakeDetectConfig = DEFAULT_WAKE_DETECT) {}

  observe(score: number): boolean {
    if (!Number.isFinite(score)) return false;
    this.n += 1;
    this.sum += score;
    if (score < this.min) this.min = score;
    if (score > this.max) this.max = score;
    this.recent.push(score);
    if (this.recent.length > this.cfg.softWindow) this.recent.shift();

    if (score >= this.cfg.hard) return this.fire();
    const votes = this.recent.filter((s) => s >= this.cfg.soft).length;
    if (votes >= this.cfg.softVotes) return this.fire();

    // near-hard fast-path — a clear spike (>= nearHardPeak) with real support.
    const nearHardPeak = this.cfg.nearHardPeak ?? this.cfg.hard - 0.03;
    const nearHardSoft = this.cfg.nearHardSoft ?? this.cfg.soft + 0.03;
    const nearHardVotes = this.cfg.nearHardVotes ?? 2;
    let peak = 0;
    let support = 0;
    for (const s of this.recent) {
      if (s > peak) peak = s;
      if (s >= nearHardSoft) support += 1;
    }
    if (peak >= nearHardPeak && support >= nearHardVotes) return this.fire();
    return false;
  }

  private fire(): boolean {
    this.hits += 1;
    this.recent = [];
    return true;
  }

  /** Reset the sliding window (e.g. on re-arm) — keeps the session-long stats. */
  rearm(): void {
    this.recent = [];
  }

  /** Secret-free diagnostics for the Voice Lab / status line. */
  get stats(): {
    readonly n: number;
    readonly mean: number;
    readonly min: number;
    readonly max: number;
    readonly hits: number;
    readonly window: readonly number[];
  } {
    return {
      n: this.n,
      mean: this.n ? Math.round((this.sum / this.n) * 1000) / 1000 : 0,
      min: this.min > 1 ? 0 : Math.round(this.min * 1000) / 1000,
      max: this.max < 0 ? 0 : Math.round(this.max * 1000) / 1000,
      hits: this.hits,
      window: [...this.recent],
    };
  }
}

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

/**
 * A permission / hardware error name. On its OWN this is not fatal — iOS throws
 * `NotAllowedError` for a non-gesture `getUserMedia` even when permission is
 * granted, and `NotFoundError` transiently after an audio-session interruption.
 * It is only truly fatal when the wake engine has NEVER worked on this device
 * (see `ensureAudio`); mid-session it means "pause and retry", not "give up".
 */
function isPermissionError(error: unknown): boolean {
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
  | "paused"
  | "fatal"
  | "disposed";

export interface WakeAdapterStatus {
  readonly mic: "off" | "starting" | "on" | "recovering" | "paused" | "fatal";
  readonly phase: WakeAdapterPhase;
  readonly cyclesCompleted: number;
  readonly startAttempts: number;
  /** How many times the pipeline was rebuilt after a stall / track-end. */
  readonly recoveryCount: number;
  /** ms since the last 80 ms frame arrived (`-1` before the first frame). */
  readonly frameAgeMs: number;
  /** Wake samples the runner dropped under sustained overload (contiguous otherwise). */
  readonly droppedFrames: number;
  /** The capture AudioContext state, or `"unknown"`. */
  readonly audioContextState: string;
  /** Last turn: command capture duration (ms), STT round-trip (ms), wake→capture-end (ms). `-1` = none yet. */
  readonly lastCaptureMs: number;
  readonly lastSttMs: number;
  readonly lastWakeToCaptureMs: number;
  /** Wake-score distribution this session (for real-voice threshold tuning). */
  readonly wakeScore: {
    readonly n: number;
    readonly mean: number;
    readonly min: number;
    readonly max: number;
    readonly hits: number;
    readonly window: readonly number[];
  };
  /**
   * Sprint 5 §16 — openWakeWord runner runtime cost: current + peak inference
   * queue depth (samples), catch-up batches, and the single-flight proof
   * (`maxConcurrentInference` must be 1). `null` for a test runner without stats.
   */
  readonly runnerCost: {
    readonly pendingSamples: number;
    readonly maxPendingSamples: number;
    readonly catchupBatchesTotal: number;
    readonly maxCatchupInOneAccept: number;
    readonly maxConcurrentInference: number;
    readonly inferences: number;
  } | null;
  /**
   * Sprint 5 §17 — audio-resource lifetime counts: a healthy multi-turn session
   * is `audioContextsCreated: 1, mediaStreamsAcquired: 1` however many turns run.
   * `null` for a test backend without counters.
   */
  readonly backendResources: {
    readonly audioContextsCreated: number;
    readonly mediaStreamsAcquired: number;
    readonly graphRebuilds: number;
    readonly audioContextState: string;
    readonly micTrackState: string;
  } | null;
  /**
   * Conversation Session Mode — `true` between a wake hit and the idle timeout,
   * while follow-up commands skip the wake word. Drives the "Konuşma aktif" UI.
   */
  readonly conversationActive: boolean;
  /** `true` while an in-session capture is waiting for the user (no wake word needed). */
  readonly conversationArmed: boolean;
  /**
   * Why the last conversation session closed — `"idle-timeout"` / `"explicit-stop"`
   * / `"fatal"` / `"disposed"`. `null` before the first session. Diagnostics for
   * the real-device "why did I have to say AYAS again" question.
   */
  readonly conversationClosedReason: string | null;
  /**
   * True Hands-Free UYAN Acoustic Wake Finalization — which model produced
   * the last wake hit (`primaryWakeLabel` / `aliasWakeLabel`, e.g.
   * `"uyan-acoustic"` / `"ayas-acoustic"`), or `null` before the first wake
   * this session. Diagnostics only — see `AyasVoicePlatform`'s doc comment:
   * it never changes what a wake DOES (still only the canonical `AYAS` wake
   * intent, still no execution authority).
   */
  readonly wakeSource: string | null;
  /** Alias-model wake-score distribution — `null` when no alias is configured. */
  readonly wakeScoreAlias: {
    readonly n: number;
    readonly mean: number;
    readonly min: number;
    readonly max: number;
    readonly hits: number;
    readonly window: readonly number[];
  } | null;
  readonly lastError: string | null;
}

export interface WakeWordAdapterOptions {
  readonly wakewordUrl?: string;
  readonly melspectrogramUrl?: string;
  readonly embeddingUrl?: string;
  readonly wasmPaths?: string;
  readonly sttUrl?: string;
  /** Hard detection threshold in [0, 1] (default 0.7). */
  readonly threshold?: number;
  /** Two-tier wake decision config (default hard 0.7 / soft 0.6, 3-of-5). Test seam. */
  readonly wakeDetect?: Partial<WakeDetectConfig>;
  /** Test seam — replace the whole audio backend. */
  readonly audioBackend?: WakeAudioBackend;
  /** Test seam — replace the wake runner. */
  readonly runner?: WakeRunnerLike;
  /**
   * True Hands-Free UYAN Acoustic Wake Finalization — an OPTIONAL second
   * acoustic wake model (e.g. the original "AYAS" model, kept as a
   * backward-compatible alias once `wakewordUrl` becomes "UYAN"), scored on
   * every frame ALONGSIDE the primary model. Either firing runs the exact
   * same capture → STT → command path — see `onFrame`. Omitted by default:
   * single-model behavior is byte-for-byte unchanged from before this option
   * existed.
   */
  readonly wakewordUrlAlias?: string;
  /** `WakeAdapterStatus.wakeSource` label when the PRIMARY model fires. Default `"ayas-acoustic"` (unchanged from before this field existed). */
  readonly primaryWakeLabel?: string;
  /** `WakeAdapterStatus.wakeSource` label when the ALIAS model fires. Only meaningful when `wakewordUrlAlias` (or `runnerAlias`) is set. */
  readonly aliasWakeLabel?: string;
  /** Test seam — replace the alias runner (see `wakewordUrlAlias`). */
  readonly runnerAlias?: WakeRunnerLike;
  /** Two-tier wake-decision config for the ALIAS model only (defaults to the same as `wakeDetect`). Test seam. */
  readonly wakeDetectAlias?: Partial<WakeDetectConfig>;
  /** Test seam — replace the STT transport. */
  readonly transcribe?: (wav: Uint8Array) => Promise<string>;
  /**
   * Called once when the wake engine cannot start on this device (mic denied,
   * ONNX/WASM failed to load, no worklet). The host should fall back to the
   * browser voice adapter — the engine will otherwise keep retrying `begin()`.
   */
  readonly onUnavailable?: (reason: "not-allowed" | "start-blocked" | "runner-init") => void;
  /** Re-arm cooldown after a turn (default 700 ms). Test seam. */
  readonly rearmCooldownMs?: number;
  /** Backoff between mic-start retries: `n * attempt` ms (default 400). Test seam. */
  readonly startRetryBackoffMs?: number;
  /** Frame-flow watchdog tick interval (default 1500 ms). Test seam. */
  readonly watchdogIntervalMs?: number;
  /** Frame-stall threshold before a recover (default 2500 ms). Test seam. */
  readonly frameStallMs?: number;
  /** Backoff between self-heal retries from `paused` (default 3s→8s→20s). Test seam. */
  readonly pausedRetryMs?: number;
  /** Conversation-session idle timeout (default 15 s). Test seam. */
  readonly conversationIdleMs?: number;
  /** Test seam — the TTS platform (defaults to a fresh {@link BrowserVoiceAdapter}). */
  readonly tts?: Pick<
    AyasVoicePlatform,
    "speak" | "cancelSpeech" | "detectCapability" | "listVoices" | "onVoicesChanged" | "requestMicrophonePermission"
  >;
  /** Fired on every phase transition — numeric/enum only, for a UI status line. */
  readonly onStatus?: (status: WakeAdapterStatus) => void;
}

export interface WakeRunnerLike {
  readonly ready: boolean;
  /** Numeric-only diagnostics (frames / inferences / dropped / lastScore / §5 + §16 …). */
  readonly stats?: Partial<WakeRunnerStats> & {
    readonly dropped: number;
    readonly inferences: number;
    readonly lastError: string | null;
  };
  init(): Promise<void>;
  reset(): void;
  dispose(): void;
  accept(frame: Float32Array): Promise<number | null>;
}

/** The mic + worklet, abstracted so tests can drive frames synchronously. */
export interface WakeAudioBackend {
  /**
   * (Re)build the capture graph; `onFrame` gets 1280-sample 16 kHz mono frames.
   * A real implementation MUST reuse a live AudioContext + mic track rather than
   * creating fresh ones each call — iOS caps a page at ~4 AudioContexts and a
   * non-gesture `getUserMedia` can be refused, so a long session that rebuilds
   * per turn eventually cannot start at all.
   */
  start(onFrame: (frame: Float32Array) => void): Promise<void>;
  /**
   * Synchronous, best-effort: create + `resume()` the capture AudioContext RIGHT
   * NOW, while a user gesture (the mic tap) is still an active user activation.
   * iOS Safari only lets an AudioContext reach `running` when it is created /
   * resumed inside a user activation — but `start()` runs from `ensureAudio`,
   * AFTER `await runner.init()` (a multi-second ONNX / WASM load), by which time
   * the gesture is long gone and the context would stay `suspended`. The adapter
   * calls this from inside `startListening` so the later `start()` inherits a
   * blessed context. No-op on a backend without a real AudioContext. Optional.
   */
  prime?(): void;
  /** Between-turn pause: disconnect the graph but keep the context + mic warm. */
  stop(): void;
  /**
   * Lightweight recovery: resume a suspended AudioContext (iOS suspends it while
   * `speechSynthesis` plays). Returns `true` if the capture is healthy again,
   * `false` if it must be rebuilt (track ended / context closed). Optional.
   */
  recover?(): Promise<boolean>;
  /** Current AudioContext state for diagnostics (`"unknown"` if not applicable). */
  state?(): string;
  /** Sprint 5 §17 — numeric-only lifetime resource counters, if the backend keeps them. */
  readonly resourceStats?: {
    readonly audioContextsCreated: number;
    readonly mediaStreamsAcquired: number;
    readonly graphRebuilds: number;
    readonly audioContextState: string;
    readonly micTrackState: string;
  };
  /** Full teardown — close the context, stop the tracks. Only on adapter dispose. */
  dispose?(): void;
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
    "speak" | "cancelSpeech" | "detectCapability" | "listVoices" | "onVoicesChanged" | "requestMicrophonePermission"
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
      | "pausedRetryMs"
      | "conversationIdleMs"
      | "wakeDetect"
      | "tts"
      | "onStatus"
      | "wakewordUrlAlias"
      | "primaryWakeLabel"
      | "aliasWakeLabel"
      | "runnerAlias"
      | "wakeDetectAlias"
    >
  >;
  private readonly rearmCooldownMs: number;
  private readonly startRetryBackoffMs: number;
  private readonly watchdogIntervalMs: number;
  private readonly frameStallMs: number;
  private readonly pausedRetryBackoffMs: readonly number[];
  private readonly conversationIdleMs: number;
  private readonly audio: WakeAudioBackend;
  private readonly runner: WakeRunnerLike;
  private readonly transcribe: (wav: Uint8Array) => Promise<string>;
  private readonly onUnavailable?: (reason: "not-allowed" | "start-blocked" | "runner-init") => void;
  private readonly onStatus?: (status: WakeAdapterStatus) => void;
  /**
   * Set ONLY when the wake engine has never worked on this device (a true
   * first-start permission / no-hardware denial). A one-way latch → the host
   * falls back to the browser adapter. A mid-session interruption never sets it.
   */
  private fatal = false;
  /** The pipeline was interrupted after working — recoverable by a retry (tap / auto / foreground). */
  private paused = false;
  /** `true` once the mic + worklet + runner have come up at least once. */
  private everHealthy = false;
  private pausedRetries = 0;
  private pausedRetryTimer: ReturnType<typeof setTimeout> | null = null;

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
  /** ms + frame count of pre-roll audio prepended to the clip — NOT a command. */
  private preRollMs = 0;
  private preRollFrameCount = 0;
  /** ms elapsed in the capturing phase since the wake word (pre-roll excluded). */
  private postWakeMs = 0;
  /** ms of speech energy observed since the wake word (pre-roll excluded). */
  private postWakeSpeechMs = 0;
  /** All speech ms incl. a speech-heavy pre-roll — only picks the EOS-silence window. */
  private speechMs = 0;
  private silenceMs = 0;
  private sawSpeech = false;
  /** The command has actually begun (post-wake speech, or it was already in the pre-roll). */
  private commandStarted = false;
  /** ms since the command began — drives COMMAND_MAX + the EOS-silence check. */
  private commandMs = 0;
  /** postWakeMs at the moment the command began — the wake→command gap. */
  private gapMs = 0;
  /** this.cmd.length at the moment the command began — for trimming a long silent gap. */
  private cmdStartFrameCount = 0;
  /** Adaptive silence RMS threshold — calibrated from the first quiet frames of a capture. */
  private silenceRms = 0.012;
  private noiseSamples = 0;
  private noiseSum = 0;
  /** Ring buffer of the most recent wake-phase frames, prepended to a new capture. */
  private preRoll: Float32Array[] = [];
  private readonly detector: WakeScoreDetector;
  /**
   * True Hands-Free UYAN Acoustic Wake Finalization — an OPTIONAL second
   * acoustic model + detector, scored on every "wake" frame ALONGSIDE
   * `runner`/`detector`. Either one firing runs the exact same capture code
   * below (same canonical `AYAS` wake intent, same state machine, same STT/
   * TTS path) — this only ever adds a second SCORE source, never a second
   * engine. `null` (the default) reproduces the original single-model
   * behaviour byte-for-byte — every existing single-model caller/test is
   * unaffected.
   */
  private readonly runnerAlias: WakeRunnerLike | null;
  private readonly detectorAlias: WakeScoreDetector | null;
  /** Diagnostic labels only — see `WakeAdapterStatus.wakeSource`. Never gate behavior. */
  private readonly primaryWakeLabel: string;
  private readonly aliasWakeLabel: string;
  /** Which model produced the last wake hit — diagnostics only, `null` before the first. */
  private lastWakeSource: string | null = null;
  private cooldownUntil = 0;
  /** Conversation session: a wake fired and follow-up commands skip the wake word. */
  private conversationActive = false;
  /** An in-session capture is armed — waiting for the user to speak, no wake needed. */
  private conversationArmed = false;
  /** This capture began from a real wake hit (vs. an in-session re-arm). */
  private wokeThisTurn = false;
  private conversationTimer: ReturnType<typeof setTimeout> | null = null;
  /** Why the last conversation session closed — diagnostics only (`null` = never opened). */
  private conversationClosedReason: string | null = null;
  /** Per-turn latency marks (ms epoch) — surfaced via onStatus, no audio. */
  private tWake = 0;
  private tCaptureEnd = 0;
  private tSttStart = 0;
  private lastSttMs = -1;
  private lastCaptureMs = -1;
  private lastWakeToCaptureMs = -1;

  private audioUp = false;
  private starting: Promise<void> | null = null;
  private recovering = false;
  /** A wake score-check is pending — the runner still buffers every frame. */
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
    if (typeof document === "undefined" || document.visibilityState !== "visible") return;
    // Returning to the foreground is a user action iOS accepts for AudioContext
    // resume — prime before the recovery path re-touches it.
    this.audio.prime?.();
    if (this.paused) void this.attemptUnpause("foreground");
    else void this.resumeOrRebuild("foreground");
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
    this.detector = new WakeScoreDetector({
      ...DEFAULT_WAKE_DETECT,
      hard: options.threshold ?? DEFAULT_WAKE_DETECT.hard,
      ...options.wakeDetect,
    });
    this.audio = options.audioBackend ?? new MediaStreamWorkletBackend();
    this.runner =
      options.runner ??
      new OpenWakeWordRunner({
        wakewordUrl: this.o.wakewordUrl,
        melspectrogramUrl: this.o.melspectrogramUrl,
        embeddingUrl: this.o.embeddingUrl,
        wasmPaths: this.o.wasmPaths,
      });
    this.primaryWakeLabel = options.primaryWakeLabel ?? "ayas-acoustic";
    this.aliasWakeLabel = options.aliasWakeLabel ?? "alias-acoustic";
    this.runnerAlias =
      options.runnerAlias ??
      (options.wakewordUrlAlias
        ? new OpenWakeWordRunner({
            wakewordUrl: options.wakewordUrlAlias,
            melspectrogramUrl: this.o.melspectrogramUrl,
            embeddingUrl: this.o.embeddingUrl,
            wasmPaths: this.o.wasmPaths,
          })
        : null);
    this.detectorAlias = this.runnerAlias
      ? new WakeScoreDetector({
          ...DEFAULT_WAKE_DETECT,
          hard: options.threshold ?? DEFAULT_WAKE_DETECT.hard,
          ...options.wakeDetectAlias,
        })
      : null;
    this.transcribe = options.transcribe ?? ((wav) => postStt(this.o.sttUrl, wav));
    this.onUnavailable = options.onUnavailable;
    this.onStatus = options.onStatus;
    this.rearmCooldownMs = options.rearmCooldownMs ?? REARM_COOLDOWN_MS;
    this.startRetryBackoffMs = options.startRetryBackoffMs ?? 400;
    this.watchdogIntervalMs = options.watchdogIntervalMs ?? WATCHDOG_INTERVAL_MS;
    this.frameStallMs = options.frameStallMs ?? FRAME_STALL_MS;
    this.pausedRetryBackoffMs =
      typeof options.pausedRetryMs === "number"
        ? [options.pausedRetryMs, options.pausedRetryMs, options.pausedRetryMs]
        : PAUSED_RETRY_BACKOFF_MS;
    this.conversationIdleMs = options.conversationIdleMs ?? CONVERSATION_IDLE_MS;
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

  /** `true` while the pipeline is down but a retry (tap / foreground / timer) can restore it. */
  get isPaused(): boolean {
    return this.paused && !this.disposed && !this.fatal;
  }

  /**
   * Retry the mic acquisition NOW — call from inside a user gesture (a mic tap).
   * Cancels the pending backoff timer so the attempt is immediate.
   */
  retryNow(): void {
    if (this.disposed || this.fatal) return;
    // This runs inside a mic-tap user activation — bless the AudioContext now so
    // the resume() in start() (off-gesture) can move it to `running`.
    this.audio.prime?.();
    if (this.pausedRetryTimer) {
      clearTimeout(this.pausedRetryTimer);
      this.pausedRetryTimer = null;
    }
    if (this.paused) {
      void this.attemptUnpause("gesture");
      return;
    }
    if (!this.audioUp && !this.starting && this.handlers) {
      this.phase = "starting";
      void this.ensureAudio(this.handlers);
    }
  }

  /** Numeric / enum status for diagnostics — no audio, no secrets. */
  getStatus(): WakeAdapterStatus {
    return {
      mic: this.fatal
        ? "fatal"
        : this.paused
          ? "paused"
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
      droppedFrames: this.runner.stats?.dropped ?? this.droppedFrames,
      audioContextState: this.audio.state?.() ?? "unknown",
      lastCaptureMs: this.lastCaptureMs,
      lastSttMs: this.lastSttMs,
      lastWakeToCaptureMs: this.lastWakeToCaptureMs,
      wakeScore: this.detector.stats,
      runnerCost: this.runnerCost(),
      backendResources: this.audio.resourceStats ?? null,
      conversationActive: this.conversationActive,
      conversationArmed: this.conversationArmed,
      conversationClosedReason: this.conversationClosedReason,
      wakeSource: this.lastWakeSource,
      wakeScoreAlias: this.detectorAlias?.stats ?? null,
      lastError: this.lastError,
    };
  }

  requestMicrophonePermission(): Promise<AyasMicPermissionState> {
    return this.tts.requestMicrophonePermission?.() ?? Promise.resolve("unknown");
  }

  /* ---- conversation session: wake once, then follow-ups skip the wake word ----
   *
   * The session is a LOGICAL state ("the user is in a back-and-forth with AYAS")
   * and is deliberately ORTHOGONAL to audio-pipeline health. iOS suspends /
   * rebuilds the capture AudioContext on every `speechSynthesis` reply — that
   * churn (`resumeOrRebuild` / `rebuildAudio` / a transient `paused`) must NOT
   * end the session, or every turn falls back to needing "AYAS" (the exact
   * real-device regression the fake-backend smoke tests missed). The session
   * ends ONLY on: 15 s of user silence, an explicit stop, the permanent `fatal`
   * latch, or dispose. A pipeline rebuild re-arms straight back into the
   * in-session capture via {@link rearmAfterRecovery}.
   */

  private armConversationTimer(): void {
    this.clearConversationTimer();
    if (this.disposed || this.fatal || !this.conversationActive) return;
    this.conversationTimer = setTimeout(() => this.onConversationIdle(), this.conversationIdleMs);
    // Node (tests): the idle timer must not keep the process alive on its own.
    (this.conversationTimer as { unref?: () => void }).unref?.();
  }

  private clearConversationTimer(): void {
    if (this.conversationTimer) {
      clearTimeout(this.conversationTimer);
      this.conversationTimer = null;
    }
  }

  /**
   * Close the session — flag + timer only, `phase` unchanged (callers decide).
   * ONLY the four legitimate enders call this: idle timeout, explicit stop, the
   * `fatal` latch, dispose. NOT pipeline recovery.
   */
  private resetConversation(reason: string): void {
    this.clearConversationTimer();
    if (this.conversationActive) this.conversationClosedReason = reason;
    this.conversationActive = false;
    this.conversationArmed = false;
    this.wokeThisTurn = false;
  }

  /**
   * `conversationIdleMs` of silence with no command elapsed — close the session.
   * An in-session capture that never got a command drops back to the wake word;
   * a capture already in progress is left to finish normally.
   */
  private onConversationIdle(): void {
    this.conversationTimer = null;
    if (this.disposed || this.fatal) return;
    const wasArmed = this.conversationArmed;
    this.conversationClosedReason = "idle-timeout";
    this.conversationActive = false;
    this.conversationArmed = false;
    if (wasArmed && this.phase === "capturing" && !this.commandStarted) {
      this.resetCommand();
      this.preRoll = [];
      this.detector.rearm();
      this.detectorAlias?.rearm();
      this.runner.reset();
      this.runnerAlias?.reset();
      this.phase = "wake";
      this.lastFrameAt = Date.now();
      this.armWatchdog();
    }
    this.emit();
  }

  /**
   * After the mic pipeline was resumed / rebuilt (post-TTS on iOS, a stall, the
   * tab returning), flip to the correct armed phase: an open conversation
   * session → straight into an in-session capture (NO wake word); otherwise →
   * wait for "AYAS". Shared by {@link ensureWakeReady}, {@link rebuildAudio} and
   * {@link attemptUnpause} so a rebuild never silently drops the session.
   */
  private rearmAfterRecovery(): void {
    this.accepting = false;
    this.preRoll = [];
    this.runner.reset();
    this.runnerAlias?.reset();
    if (this.conversationActive && !this.disposed && !this.fatal) {
      this.conversationArmed = true;
      this.wokeThisTurn = false;
      this.resetCommand();
      this.tWake = Date.now();
      this.cooldownUntil = Date.now() + this.rearmCooldownMs; // ignore the TTS echo tail
      this.phase = "capturing";
      this.armConversationTimer();
    } else {
      this.detector.rearm();
      this.detectorAlias?.rearm();
      this.wokeThisTurn = false;
      this.phase = "wake";
    }
    this.lastFrameAt = Date.now();
    this.armWatchdog();
  }

  /**
   * The user explicitly turned voice input off (or is toggling it). Close any
   * open conversation session so the NEXT command needs the wake word again.
   * Never interrupts a capture already in progress.
   */
  endConversation(): void {
    if (this.disposed) return;
    const wasArmed = this.conversationArmed;
    this.resetConversation("explicit-stop");
    if (wasArmed && this.phase === "capturing" && !this.commandStarted) {
      this.resetCommand();
      this.preRoll = [];
      this.phase = "idle";
    }
    this.emit();
  }

  /**
   * An in-session command reached STT without a real wake hit. Prefix the wake
   * word so the engine's existing `!woke` path detects it and dispatches the
   * command exactly as if "AYAS <command>" had been spoken — zero engine change.
   */
  private withSessionWakePrefix(text: string): string {
    const bare = stripLeadingWakeWord(text).trim();
    return bare ? `AYAS ${bare}` : "AYAS";
  }

  private runnerCost(): WakeAdapterStatus["runnerCost"] {
    const s = this.runner.stats;
    if (!s || typeof s.maxConcurrentInference !== "number") return null;
    return {
      pendingSamples: s.pendingSamples ?? 0,
      maxPendingSamples: s.maxPendingSamples ?? 0,
      catchupBatchesTotal: s.catchupBatchesTotal ?? 0,
      maxCatchupInOneAccept: s.maxCatchupInOneAccept ?? 0,
      maxConcurrentInference: s.maxConcurrentInference,
      inferences: s.inferences,
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
    // The wake pipeline must NOT hear its own TTS — pause detection while it
    // plays. `capturing` covers an in-session conversation capture that is still
    // waiting for the user (a typed turn during a voice session); the re-arm
    // after TTS restores it.
    if (this.phase === "wake" || this.phase === "rearming" || this.phase === "capturing") {
      this.phase = "speaking";
    }
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

    // Paused: the pipeline is down but recovering on its own schedule (+ on a
    // tap / foreground). Don't burn a `getUserMedia` on every engine re-arm and
    // don't re-emit status (that would re-render the UI every ~350 ms) — just
    // acknowledge and let `attemptUnpause` drive the retries.
    if (this.paused) {
      queueMicrotask(() => handlers.onEnd());
      return { stop: () => {} };
    }

    this.resetCommand();

    // iOS: `startListening` is called from inside the mic-tap user activation.
    // Bless the AudioContext NOW — `ensureAudio` / `ensureWakeReady` create /
    // resume it much later (after the ONNX + WASM load), off-gesture, when iOS
    // would leave it `suspended` and `start()` throws `audiocontext-not-running`.
    this.audio.prime?.();

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
          const inits: Promise<void>[] = [];
          if (!this.runner.ready) inits.push(this.runner.init());
          if (this.runnerAlias && !this.runnerAlias.ready) inits.push(this.runnerAlias.init());
          if (inits.length) {
            try {
              await withTimeout(Promise.all(inits).then(() => undefined), AUDIO_START_TIMEOUT_MS, "runner-init");
            } catch (error) {
              // A model/WASM/asset failure is not a microphone interruption and
              // another user gesture cannot repair it. Before the wake engine
              // has ever been healthy, hand control back to the host so it can
              // attach BrowserVoiceAdapter immediately instead of entering the
              // visible reconnect loop for a permanently unavailable model.
              if (!this.everHealthy) {
                this.lastError = (error as Error)?.name || (error as Error)?.message || "runner-init";
                this.resetConversation("fatal");
                this.fatal = true;
                this.phase = "fatal";
                this.emit();
                this.onUnavailable?.("runner-init");
                handlers.onError("start-blocked");
                handlers.onEnd();
                return;
              }
              throw error;
            }
          }
          this.runner.reset();
          this.runnerAlias?.reset();
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
          this.everHealthy = true;
          this.paused = false;
          this.lastError = null;
          this.lastFrameAt = Date.now();
          if (this.phase === "starting" || this.phase === "recovering" || this.phase === "paused") {
            this.phase = "wake";
          }
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
          // Truly fatal ONLY if the wake engine has never worked here — then the
          // host should fall back to the browser adapter. A permission / device
          // error mid-session (iOS refuses a non-gesture getUserMedia, ends the
          // track for speechSynthesis, …) is recoverable: pause + retry.
          const neverWorked = !this.everHealthy && this.cyclesCompleted === 0;
          if (neverWorked && isPermissionError(error)) {
            this.resetConversation("fatal");
            this.fatal = true;
            this.phase = "fatal";
            this.emit();
            this.onUnavailable?.("not-allowed");
            handlers.onError("not-allowed");
            handlers.onEnd();
            return;
          }
          if (this.startAttempts >= MAX_START_ATTEMPTS) {
            // A device that passed `isWakeEngineCapable` (AudioWorkletNode +
            // getUserMedia + secure context) but still can't start is almost
            // always transient / gesture / slow-network — most often iOS leaving
            // the AudioContext `suspended` because it was created off-gesture
            // ("audiocontext-not-running"). Pause with a visible "tap to resume"
            // (a tap re-runs `start()` inside a fresh activation) rather than a
            // silent, permanent fallback to the browser adapter — which on an
            // iOS installed PWA has no SpeechRecognition and hears nothing.
            // A genuine permission denial (`NotAllowedError`) is handled above.
            this.enterPaused(handlers);
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

  /* ---- paused: a working session was interrupted; recover, don't give up ---- */

  /**
   * The re-acquire failed on a session that HAD been working (iOS took the mic /
   * context away and won't give it back without a gesture, or the ~4-context
   * page limit was hit). Keep the engine's loop alive and self-heal.
   */
  private enterPaused(handlers: AyasListenHandlers): void {
    // A `paused` interruption is RECOVERABLE and self-heals in seconds — it does
    // NOT close the conversation session (that would make every iOS post-TTS
    // rebuild drop the session). But a paused mic IS "the user not conversing",
    // so run the 15 s idle timer while paused: a short glitch self-heals into
    // the in-session capture (`attemptUnpause` → `rearmAfterRecovery`), a
    // genuinely long disconnection lapses the session on its own.
    this.paused = true;
    this.audioUp = false;
    this.starting = null;
    this.phase = "paused";
    this.clearWatchdog();
    if (this.conversationActive) this.armConversationTimer();
    this.emit();
    // Only escalate to a visible "tap to resume" once auto-retries have had a go.
    if (this.pausedRetries >= PAUSED_RETRIES_BEFORE_PROMPT) {
      handlers.onError("mic-interrupted");
    }
    handlers.onEnd(); // engine keeps re-arming; `startListening` no-ops while paused
    this.scheduleUnpause();
  }

  private scheduleUnpause(): void {
    if (this.pausedRetryTimer || this.disposed || this.fatal || !this.paused) return;
    const idx = Math.min(this.pausedRetries, this.pausedRetryBackoffMs.length - 1);
    this.pausedRetryTimer = setTimeout(() => {
      this.pausedRetryTimer = null;
      this.pausedRetries += 1;
      void this.attemptUnpause("auto");
    }, this.pausedRetryBackoffMs[idx]);
    (this.pausedRetryTimer as { unref?: () => void }).unref?.();
  }

  private async attemptUnpause(source: "auto" | "gesture" | "foreground"): Promise<void> {
    if (this.disposed || this.fatal || !this.paused) return;
    const h = this.handlers;
    if (!h) return;
    // Safety valve: a wake engine that has NEVER produced a healthy start after
    // this many recovery attempts (auto + at least one gesture) is on a device
    // that genuinely cannot run it — fall back to the browser adapter instead of
    // pausing forever. A session that HAD worked keeps self-healing indefinitely.
    if (!this.everHealthy && this.pausedRetries >= MAX_UNPAUSE_BEFORE_FALLBACK) {
      this.resetConversation("fatal");
      this.paused = false;
      this.fatal = true;
      this.phase = "fatal";
      this.emit();
      this.onUnavailable?.("start-blocked");
      h.onError("start-blocked");
      h.onEnd();
      return;
    }
    // An auto retry while the tab is hidden wastes a getUserMedia attempt (iOS
    // denies it) — hold for the next tick / a foreground event.
    if (source === "auto" && typeof document !== "undefined" && document.visibilityState !== "visible") {
      this.scheduleUnpause();
      return;
    }
    if (this.pausedRetryTimer) {
      clearTimeout(this.pausedRetryTimer);
      this.pausedRetryTimer = null;
    }
    this.paused = false;
    this.audioUp = false;
    this.starting = null;
    this.startAttempts = 0;
    this.phase = "starting";
    this.lastError = null;
    this.emit();
    await this.ensureAudio(h);
    if (!this.disposed && !this.fatal && this.audioUp) {
      this.pausedRetries = 0;
      // An open conversation session survived the pause → resume the in-session
      // capture; otherwise wait for "AYAS".
      this.rearmAfterRecovery();
      this.emit();
    }
    // If `ensureAudio` failed it has already called `enterPaused` again (which
    // re-arms `scheduleUnpause` with a longer backoff) — nothing more to do.
  }

  /**
   * Re-arm after a turn (called from `startListening`). Makes sure the capture
   * pipeline is actually producing frames — this is where the "first turn works,
   * then dead" iOS bug is caught: the AudioContext suspended during TTS is
   * resumed (or the graph rebuilt) here — then flips to the right armed phase:
   * an open conversation session → straight into an in-session capture (NO wake
   * word); otherwise → wait for "AYAS".
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
    this.rearmAfterRecovery();
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

  /**
   * Full, bounded teardown + re-acquire — only when a plain resume was not
   * enough (track ended / context closed). On iOS this fires on most post-TTS
   * re-arms; it is NORMAL churn, NOT a session-ender — an open conversation
   * session is carried straight back into the in-session capture.
   */
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
      if (wasArmed) {
        this.rearmAfterRecovery(); // honours an open conversation session
      } else {
        this.accepting = false;
        this.preRoll = [];
        this.detector.rearm();
        this.detectorAlias?.rearm();
        this.runner.reset();
        this.runnerAlias?.reset();
        this.phase = "idle";
        this.lastFrameAt = Date.now();
        this.armWatchdog();
      }
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
    this.preRollMs = 0;
    this.preRollFrameCount = 0;
    this.postWakeMs = 0;
    this.postWakeSpeechMs = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.sawSpeech = false;
    this.commandStarted = false;
    this.commandMs = 0;
    this.gapMs = 0;
    this.cmdStartFrameCount = 0;
    this.silenceRms = 0.012;
    this.noiseSamples = 0;
    this.noiseSum = 0;
  }

  private onFrame(frame: Float32Array): void {
    this.lastFrameAt = Date.now();
    const handlers = this.handlers;
    if (!handlers) return;
    const ms = (frame.length / 16000) * 1000;

    if (this.phase === "wake") {
      // Keep a short pre-roll so the first command word (spoken right after
      // "AYAS", no gap) isn't lost to the wake-inference lag.
      this.preRoll.push(frame.slice(0));
      if (this.preRoll.length > PREROLL_FRAMES) this.preRoll.shift();

      if (Date.now() < this.cooldownUntil) return;
      // The runner is single-flight AND buffers every frame internally (bounded)
      // so the audio it scores stays contiguous — a gappy stream was missing
      // real "AYAS". We only skip attaching a fresh score-check while one is
      // already pending; that frame's result rides the runner's catch-up.
      //
      // When an alias model is configured (True Hands-Free UYAN sprint) it is
      // an entirely independent runner + detector scored on the SAME frame —
      // no shared mutable state with the primary, so running both concurrently
      // is safe. `Promise.resolve(null)` stands in when there is no alias,
      // which reproduces the original single-model timing/behavior exactly.
      void Promise.all([
        this.runner.accept(frame),
        this.runnerAlias ? this.runnerAlias.accept(frame) : Promise.resolve(null),
      ]).then(([primaryScore, aliasScore]) => {
        if (this.phase !== "wake") return;
        const primaryHit = primaryScore !== null && this.detector.observe(primaryScore);
        const aliasHit = Boolean(this.detectorAlias) && aliasScore !== null && this.detectorAlias!.observe(aliasScore);
        if (primaryHit || aliasHit) {
          this.lastWakeSource = primaryHit ? this.primaryWakeLabel : this.aliasWakeLabel;
          this.tWake = Date.now();
          this.phase = "capturing";
          const carried = this.preRoll;
          this.preRoll = [];
          this.resetCommand();
          // Open the conversation session: follow-up commands now skip the wake
          // word until the idle timeout. This capture IS a real wake hit.
          this.conversationActive = true;
          this.conversationArmed = false;
          this.wokeThisTurn = true;
          this.conversationClosedReason = null;
          this.armConversationTimer();
          // The pre-roll is AUDIO ONLY: it carries the wake word + the command's
          // first syllables past the detection lag so whisper still hears the
          // onset. It does NOT satisfy the end-of-speech test — otherwise a lone
          // "AYAS" pre-roll + the user's natural pause finalises the capture
          // before the command is spoken (the "DİNLİYOR → HAZIR" bug).
          let preRollSpeech = 0;
          for (const f of carried) {
            this.cmd.push(f);
            this.preRollMs += (f.length / 16000) * 1000;
            if (frameRms(f) >= PREROLL_SPEECH_RMS) preRollSpeech += (f.length / 16000) * 1000;
          }
          this.preRollFrameCount = carried.length;
          // One-breath "AYAS kaç proje var": the wake score landed late so the
          // whole command is already in the pre-roll — treat it as begun.
          if (preRollSpeech >= PREROLL_COMMAND_HINT_MS) {
            this.commandStarted = true;
            this.sawSpeech = true;
            this.speechMs = preRollSpeech;
            this.postWakeSpeechMs = COMMAND_MIN_SPEECH_MS;
          }
          this.emit();
          handlers.onFinalTranscript("AYAS");
        }
      });
      return;
    }

    if (this.phase === "capturing") {
      // In-session re-arm: ignore the TTS echo tail before the command window.
      if (this.conversationArmed && !this.commandStarted && Date.now() < this.cooldownUntil) return;
      this.cmd.push(frame.slice(0));
      // In-session, before the command begins: keep only a short rolling tail (as
      // the wake pre-roll does) so a long silence before the user speaks doesn't
      // buffer minutes of dead air. A speech-heavy tail still feeds whisper the
      // onset once `commandStarted` flips.
      if (this.conversationArmed && !this.commandStarted && this.cmd.length > PREROLL_FRAMES) {
        this.cmd.shift();
      }
      this.postWakeMs += ms;
      const rms = frameRms(frame);

      // Estimate the room's noise floor from the quietest of the first few
      // GENUINELY-QUIET frames — a loud frame (the user already talking) must not
      // raise the floor and make later pauses read as speech.
      if (this.noiseSamples < NOISE_CAL_FRAMES && rms < SILENCE_RMS_MAX) {
        this.noiseSum = this.noiseSamples === 0 ? rms : Math.min(this.noiseSum, rms);
        this.noiseSamples += 1;
        this.silenceRms = Math.min(SILENCE_RMS_MAX, Math.max(SILENCE_RMS_MIN, this.noiseSum * 2.2));
      }

      const isSpeech = rms >= this.silenceRms;
      if (isSpeech) {
        this.speechMs += ms;
        this.postWakeSpeechMs += ms;
        this.silenceMs = 0;
        this.sawSpeech = true;
      } else {
        this.silenceMs += ms;
      }

      // The command begins on the first real post-wake speech (or it was already
      // in a speech-heavy pre-roll). Until then only the onset timeout can end it.
      if (!this.commandStarted && this.postWakeSpeechMs >= COMMAND_MIN_SPEECH_MS) {
        this.commandStarted = true;
        this.gapMs = this.postWakeMs;
        const speechFrames = Math.max(1, Math.ceil(this.postWakeSpeechMs / ms));
        this.cmdStartFrameCount = Math.max(0, this.cmd.length - speechFrames);
        // The user is speaking — this counts as activity; restart the idle
        // countdown and leave the "waiting for a command" sub-state.
        this.conversationArmed = false;
        if (this.conversationActive) this.armConversationTimer();
      }

      let done: boolean;
      if (this.commandStarted) {
        this.commandMs += ms;
        const eosSilence =
          this.speechMs >= LONG_UTTERANCE_SPEECH_MS ? EOS_SILENCE_SHORT_MS : EOS_SILENCE_LONG_MS;
        const hasCommand =
          this.sawSpeech &&
          this.postWakeSpeechMs >= COMMAND_MIN_SPEECH_MS &&
          this.commandMs >= COMMAND_MIN_MS;
        done = this.commandMs >= COMMAND_MAX_MS || (hasCommand && this.silenceMs >= eosSilence);
      } else if (this.conversationArmed) {
        // An in-session wait — the conversation idle timer owns the endpoint, not
        // an STT call on dead air.
        done = false;
      } else {
        // Still waiting for the command to start — a bare "AYAS" ends here.
        done = this.postWakeMs >= COMMAND_ONSET_TIMEOUT_MS;
      }

      if (done) {
        this.tCaptureEnd = Date.now();
        this.lastCaptureMs = Math.round(this.preRollMs + this.postWakeMs);
        this.lastWakeToCaptureMs = this.tWake ? this.tCaptureEnd - this.tWake : -1;
        this.phase = "processing";
        void this.finishCommand(handlers);
      }
    }
  }

  private async finishCommand(handlers: AyasListenHandlers): Promise<void> {
    // Choose the audio to transcribe:
    //  - command never started (a bare "AYAS") → the pre-roll only, no dead air
    //    (a long silent tail makes whisper hallucinate);
    //  - long silent gap between "AYAS" and the command → drop the now-stale
    //    pre-roll wake word + the dead air, keep a short lead-in;
    //  - otherwise → the whole clip (the pre-roll wake word helps whisper lock
    //    onto Turkish and `stripLeadingWakeWord` removes it downstream).
    let frames: Float32Array[] = this.cmd;
    if (!this.commandStarted) {
      frames = this.cmd.slice(0, this.preRollFrameCount || this.cmd.length);
    } else if (this.gapMs > COMMAND_GAP_DROP_PREROLL_MS && this.cmdStartFrameCount > 0) {
      frames = this.cmd.slice(Math.max(0, this.cmdStartFrameCount - COMMAND_LEADIN_FRAMES));
    }
    const merged = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
    let off = 0;
    for (const f of frames) {
      merged.set(f, off);
      off += f.length;
    }
    this.resetCommand();
    try {
      const wav = encodeWav16kMono(merged);
      this.tSttStart = Date.now();
      const text = await this.transcribe(wav);
      this.lastSttMs = Date.now() - this.tSttStart;
      if (!text) {
        handlers.onError("no-speech");
      } else if (!this.wokeThisTurn && detectAyasStopConversationIntent(text)) {
        // In-session, the user asked to end the conversation ("tamam AYAS", …).
        // Close the session WITHOUT turning voice input off — the adapter drops
        // back to waiting for the wake word. Do NOT dispatch it as a command.
        this.endConversation();
        handlers.onError("no-speech");
      } else {
        // A conversation follow-up (no real wake this turn) gets the wake word
        // prefixed so the engine dispatches it just like a spoken "AYAS <cmd>".
        handlers.onFinalTranscript(this.wokeThisTurn ? text : this.withSessionWakePrefix(text));
      }
    } catch (error) {
      this.lastSttMs = Date.now() - this.tSttStart;
      handlers.onError((error as Error).message === "stt-503" ? "network" : "unknown");
    } finally {
      // Pause detection + start the re-arm cooldown, but KEEP the mic open — the
      // engine re-arms us via `startListening` after it speaks the reply.
      this.cooldownUntil = Date.now() + this.rearmCooldownMs;
      this.phase = "idle";
      this.wokeThisTurn = false;
      this.cyclesCompleted += 1;
      // STOP the idle timer here: the think + TTS window is NOT the user being
      // silent, so it must not count toward the 15 s timeout (a long reply used
      // to drop the session mid-answer). The timer is re-armed by
      // `rearmAfterRecovery()` once the mic is genuinely back to waiting for the
      // user — that is the only true "user idle" clock.
      this.clearConversationTimer();
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
    this.paused = false;
    this.preRoll = [];
    this.cmd = [];
    this.clearWatchdog();
    this.clearConversationTimer();
    if (this.conversationActive) this.conversationClosedReason = "disposed";
    this.conversationActive = false;
    this.conversationArmed = false;
    if (this.pausedRetryTimer) {
      clearTimeout(this.pausedRetryTimer);
      this.pausedRetryTimer = null;
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    try {
      // Full teardown — the between-turn `stop()` keeps the context warm.
      (this.audio.dispose ?? this.audio.stop).call(this.audio);
    } catch {
      /* ignore */
    }
    try {
      this.runner.dispose();
    } catch {
      /* ignore */
    }
    try {
      this.runnerAlias?.dispose();
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------ real backend --- */

export class MediaStreamWorkletBackend implements WakeAudioBackend {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  /** `addModule` is per-context; loading it twice throws on some engines. */
  private moduleLoaded = false;
  /**
   * Sprint 5 §17 — lifetime resource counters. A healthy multi-turn session
   * creates ONE AudioContext and acquires ONE mic track no matter how many turns
   * run; a rising count here is the iOS ~4-context page-limit / non-gesture
   * `getUserMedia` risk made visible.
   */
  private nCtxCreated = 0;
  private nStreamAcquired = 0;
  private nGraphRebuilds = 0;

  get supported(): boolean {
    return WakeWordVoiceAdapter.isSupported(typeof window === "undefined" ? undefined : window);
  }

  /** Numeric-only resource counters (no audio, no device labels). */
  get resourceStats(): {
    readonly audioContextsCreated: number;
    readonly mediaStreamsAcquired: number;
    readonly graphRebuilds: number;
    readonly audioContextState: string;
    readonly micTrackState: string;
  } {
    return {
      audioContextsCreated: this.nCtxCreated,
      mediaStreamsAcquired: this.nStreamAcquired,
      graphRebuilds: this.nGraphRebuilds,
      audioContextState: this.ctx?.state ?? "none",
      micTrackState: this.stream?.getAudioTracks()[0]?.readyState ?? "none",
    };
  }

  private ctxCtor(): typeof AudioContext | undefined {
    if (typeof window === "undefined") return undefined;
    return (
      (typeof window.AudioContext === "function" ? window.AudioContext : undefined) ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    );
  }

  /**
   * In-gesture AudioContext unlock (see {@link WakeAudioBackend.prime}).
   * Synchronous: create the context (or reuse a non-closed one) and kick off
   * `resume()` without awaiting — so it happens while the mic tap is still a
   * user activation. `start()` then reuses this blessed context.
   */
  prime(): void {
    try {
      if (typeof window === "undefined") return;
      if (!this.ctx || this.ctx.state === "closed") {
        const Ctor = this.ctxCtor();
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.nCtxCreated += 1;
        this.moduleLoaded = false;
      }
      // fire-and-forget — resuming inside the activation blesses the context so
      // the later off-gesture resume() in start() can move it to `running`.
      void this.ctx.resume().catch(() => {});
    } catch {
      /* best-effort — start() surfaces any real failure */
    }
  }

  private liveTrack(): MediaStreamTrack | null {
    const t = this.stream?.getAudioTracks()[0];
    return t && t.readyState === "live" ? t : null;
  }

  /**
   * (Re)build the capture graph. The AudioContext and the mic track are reused
   * whenever iOS has not actually taken them away — a fresh `new AudioContext()`
   * / `getUserMedia` only when the context is `closed` / the track `ended`. This
   * is what keeps a multi-turn session below the iOS ~4-context page limit and
   * off the non-gesture `getUserMedia` path.
   */
  async start(onFrame: (frame: Float32Array) => void): Promise<void> {
    // 1. AudioContext — reuse the (ideally gesture-primed) one unless iOS closed it.
    if (!this.ctx || this.ctx.state === "closed") {
      const Ctor = this.ctxCtor();
      if (!Ctor) throw new Error("no-audiocontext-constructor");
      this.ctx = new Ctor();
      this.nCtxCreated += 1;
      this.moduleLoaded = false;
    }
    try {
      await this.ctx.resume();
    } catch {
      /* resume can reject transiently on iOS — the running check below is authoritative */
    }

    // 2. Mic stream — reuse a live track, acquire only when it is genuinely gone.
    //    openWakeWord was trained on unprocessed audio; keep echo-cancellation on
    //    so AYAS's own TTS can't self-trigger, but no noise-suppression / AGC.
    if (!this.liveTrack()) {
      this.stream?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      });
      this.nStreamAcquired += 1;
    }

    // 3. Worklet module — load once per context.
    if (!this.moduleLoaded) {
      await this.ctx.audioWorklet.addModule("/worklets/d2-wake-lab-processor.js");
      this.moduleLoaded = true;
    }

    if (!this.stream) throw new Error("no-media-stream");

    // 4. (Re)wire src → worklet → silent gain → destination.
    this.teardownGraph();
    this.nGraphRebuilds += 1;
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "d2-wake-lab-processor");
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.node.port.onmessage = (e: MessageEvent<{ type: string; samples?: Float32Array }>) => {
      if (e.data?.type === "frame" && e.data.samples && e.data.samples.length === FRAME) onFrame(e.data.samples);
    };
    this.src.connect(this.node);
    this.node.connect(this.gain);
    this.gain.connect(this.ctx.destination);

    if (this.ctx.state !== "running") {
      try {
        await this.ctx.resume();
      } catch {
        /* fall through to the check */
      }
    }
    if (this.ctx.state !== "running") throw new Error("audiocontext-not-running");
  }

  private teardownGraph(): void {
    try {
      this.node?.port.postMessage("stop");
    } catch {
      /* ignore */
    }
    for (const n of [this.src, this.node, this.gain]) {
      try {
        n?.disconnect();
      } catch {
        /* ignore */
      }
    }
    if (this.node) this.node.port.onmessage = null;
    this.src = null;
    this.node = null;
    this.gain = null;
  }

  state(): string {
    return this.ctx?.state ?? "unknown";
  }

  async recover(): Promise<boolean> {
    if (!this.ctx || this.ctx.state === "closed") return false;
    if (!this.liveTrack()) return false; // track gone → start() must re-getUserMedia
    if (this.ctx.state !== "running") {
      try {
        await this.ctx.resume();
      } catch {
        return false;
      }
    }
    // `muted` is often transient on iOS after an interruption — treat a running
    // context as recovered; the frame-flow watchdog rebuilds if frames stay away.
    return this.ctx.state === "running";
  }

  /** Between-turn pause — disconnect the graph, KEEP the context + mic track warm. */
  stop(): void {
    this.teardownGraph();
  }

  /** Full teardown — only when the adapter itself is disposed. */
  dispose(): void {
    this.teardownGraph();
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
    this.moduleLoaded = false;
  }
}
