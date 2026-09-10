"use client";

/**
 * openWakeWord streaming inference in the browser (Voice Closure Sprint).
 *
 * A faithful port of `openwakeword.utils.AudioFeatures` streaming path:
 *
 *   16 kHz PCM (80 ms / 1280-sample chunks)
 *     → melspectrogram.onnx           (chunk + 480-sample lookback → mel frames)
 *     → transform  spec / 10 + 2
 *     → embedding_model.onnx          (last 76 mel frames → one 96-d embedding)
 *     → <wakeword>.onnx               (last 16 embeddings → score in [0, 1])
 *
 * Runs entirely on-device via onnxruntime-web (WASM). No audio leaves the page.
 * The three ONNX models are served from `/wake/` (see AyasWakeAssets); the
 * feature models are openWakeWord's, the wakeword model is `ayas.onnx`.
 *
 * `stats` exposes numeric-only counters (frames / feature frames / embeddings /
 * inferences / dropped frames / last + max score / last error). No audio, ever —
 * it exists so a device can report *where* the streaming chain drops to zero
 * instead of only a post-threshold "0.000".
 *
 * `accept()` is **single-flight**: three sequential WASM ONNX runs per 80 ms
 * frame can exceed 80 ms on a phone, and the callers fire one `accept()` per
 * frame. Without a guard the calls overlap, corrupt the shared rolling buffers,
 * and pile unbounded promise/allocation work onto the microtask queue — which on
 * an installed iOS PWA is enough memory pressure for WebKit to kill and reload
 * the page within ~30 s. A frame that arrives while an inference is in flight is
 * dropped (counted in `stats.dropped`); openWakeWord's sliding windows tolerate
 * the occasional gap, and a device fast enough to keep up drops nothing.
 */

import * as ort from "onnxruntime-web";

const CHUNK = 1280; // 80 ms @ 16 kHz — openWakeWord's fixed streaming step
const MEL_LOOKBACK = 160 * 3; // 480 samples of context per _streaming_melspectrogram
const MEL_WINDOW = 76; // mel frames per embedding
const MEL_BINS = 32;
const EMB_DIM = 96;
const EMB_WINDOW = 16; // embeddings per wakeword inference
const MEL_BUFFER_MAX = 10 * 97;
const EMB_BUFFER_MAX = 120;

export interface WakeRunnerOptions {
  readonly melspectrogramUrl: string;
  readonly embeddingUrl: string;
  readonly wakewordUrl: string;
  /** onnxruntime-web `wasmPaths` (dir that holds ort-*.wasm). */
  readonly wasmPaths?: string;
  /** Test seam — build the three inference sessions (defaults to onnxruntime-web). */
  readonly createSession?: (
    url: string,
    options: ort.InferenceSession.SessionOptions,
  ) => Promise<WakeSession>;
}

/** The slice of `ort.InferenceSession` the runner uses. */
export interface WakeSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, ort.Tensor>): Promise<Record<string, { data: unknown }>>;
  release?(): void | Promise<void>;
}

/** Numeric-only streaming diagnostics. Contains no audio and never will. */
export interface WakeRunnerStats {
  /** `accept()` calls that carried a full 1280-sample chunk. */
  readonly frames: number;
  /** mel frames emitted by melspectrogram.onnx so far. */
  readonly melFrames: number;
  /** embeddings emitted by embedding_model.onnx so far. */
  readonly embeddings: number;
  /** wakeword inferences run so far. */
  readonly inferences: number;
  /** frames dropped because an inference was still in flight (back-pressure). */
  readonly dropped: number;
  /** last wakeword score (any magnitude), or -1 before the first inference. */
  readonly lastScore: number;
  /** highest wakeword score seen this session, or -1 before the first inference. */
  readonly maxScore: number;
  /** message of the last error thrown inside `accept()`, or null. */
  readonly lastError: string | null;
}

export class OpenWakeWordRunner {
  private mel!: WakeSession;
  private emb!: WakeSession;
  private ww!: WakeSession;

  private readonly raw: Float32Array; // int16-scale samples, rolling
  private rawLen = 0;
  private pending: number[] = []; // sub-chunk carry
  private melBuf: Float32Array; // [frames * MEL_BINS]
  private melFrames = 0;
  private embBuf: Float32Array; // [count * EMB_DIM]
  private embCount = 0;
  private _ready = false;
  private disposed = false;
  /** An `accept()` is mid-inference — the runner must not be re-entered. */
  private inFlight = false;

  // numeric-only diagnostics — see WakeRunnerStats. No audio is retained here.
  private nFrames = 0;
  private nMelFrames = 0;
  private nEmb = 0;
  private nInfer = 0;
  private nDropped = 0;
  private lastScore = -1;
  private maxScore = -1;
  private lastError: string | null = null;

  /**
   * Reusable model-input scratch — the wake chain runs ~12×/s for minutes on a
   * phone, so a fresh `Float32Array.from(...)` per model per frame was ~275 KB/s
   * of garbage. Single-flight `accept()` means no call overlaps, and ORT copies
   * inputs into its WASM heap on `run()`, so one buffer per model is safe.
   */
  private readonly melInBuf = new Float32Array(CHUNK + MEL_LOOKBACK);
  private readonly embInBuf = new Float32Array(MEL_WINDOW * MEL_BINS);
  private readonly wwInBuf = new Float32Array(EMB_WINDOW * EMB_DIM);

  constructor(private readonly opts: WakeRunnerOptions) {
    this.raw = new Float32Array((CHUNK + MEL_LOOKBACK) * 2);
    this.melBuf = new Float32Array(MEL_BUFFER_MAX * MEL_BINS);
    this.embBuf = new Float32Array(EMB_BUFFER_MAX * EMB_DIM);
  }

  get ready(): boolean {
    return this._ready;
  }

  /** Numeric-only streaming diagnostics — a fresh snapshot each read. */
  get stats(): WakeRunnerStats {
    return {
      frames: this.nFrames,
      melFrames: this.nMelFrames,
      embeddings: this.nEmb,
      inferences: this.nInfer,
      dropped: this.nDropped,
      lastScore: this.lastScore,
      maxScore: this.maxScore,
      lastError: this.lastError,
    };
  }

  async init(): Promise<void> {
    if (this.opts.wasmPaths) ort.env.wasm.wasmPaths = this.opts.wasmPaths;
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = "error";
    const so: ort.InferenceSession.SessionOptions = {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      // A hands-free session runs the wake models ~12×/s for many minutes on an
      // iPhone. `memPattern` pre-plans a reusable buffer pool per shape — great
      // for throughput, but it holds that WASM heap for the life of the session,
      // and on a memory-capped iOS PWA that steady footprint is a reload risk.
      // These tiny models don't need it; turning it off trades a hair of speed
      // for a materially smaller, flatter heap.
      enableMemPattern: false,
    };
    const create =
      this.opts.createSession ??
      (async (url: string, o: ort.InferenceSession.SessionOptions) =>
        (await ort.InferenceSession.create(url, o)) as unknown as WakeSession);
    [this.mel, this.emb, this.ww] = await Promise.all([
      create(this.opts.melspectrogramUrl, so),
      create(this.opts.embeddingUrl, so),
      create(this.opts.wakewordUrl, so),
    ]);
    this._ready = true;
  }

  reset(): void {
    this.rawLen = 0;
    this.pending = [];
    this.melFrames = 0;
    this.embCount = 0;
    this.inFlight = false;
  }

  dispose(): void {
    this.disposed = true;
    void this.mel?.release?.();
    void this.emb?.release?.();
    void this.ww?.release?.();
  }

  /**
   * Feed one 80 ms (1280-sample) frame of 16 kHz mono PCM in [-1, 1]. Returns
   * the wakeword score for the frame, or `null` if not enough context yet.
   *
   * Never rejects: an inference failure (e.g. an iOS wasm kernel gap) is
   * recorded in `stats.lastError` and surfaced as `null`, so a broken device
   * path shows up as a visible error string rather than an unhandled rejection
   * that silently freezes the pipeline.
   */
  async accept(frame: Float32Array): Promise<number | null> {
    if (!this._ready || this.disposed) return null;
    // Single-flight: a frame that lands while an inference is running is dropped
    // rather than queued — see the class comment. This is the memory-pressure
    // guard for the iOS-PWA "reloads itself after ~30 s" symptom.
    if (this.inFlight) {
      this.nDropped += 1;
      return null;
    }
    for (let i = 0; i < frame.length; i += 1) this.pending.push(frame[i] * 32767);
    if (this.pending.length < CHUNK) return null;
    // Defensive: never let the carry buffer ratchet if a caller over-feeds.
    if (this.pending.length > CHUNK * 4) this.pending.splice(0, this.pending.length - CHUNK);

    const chunk = this.pending.splice(0, CHUNK);
    this.nFrames += 1;
    this.inFlight = true;
    try {
      // roll the raw buffer, keep the last CHUNK + lookback samples
      const keep = CHUNK + MEL_LOOKBACK;
      if (this.rawLen + CHUNK > this.raw.length) {
        this.raw.copyWithin(0, this.rawLen - keep + CHUNK, this.rawLen);
        this.rawLen = keep - CHUNK;
      }
      for (let i = 0; i < CHUNK; i += 1) this.raw[this.rawLen + i] = chunk[i];
      this.rawLen += CHUNK;

      const melSlice = this.raw.subarray(Math.max(0, this.rawLen - (CHUNK + MEL_LOOKBACK)), this.rawLen);
      this.melInBuf.set(melSlice);
      const melOut = await this.mel.run({
        [this.mel.inputNames[0]]: new ort.Tensor(
          "float32",
          this.melInBuf.subarray(0, melSlice.length),
          [1, melSlice.length],
        ),
      });
      const melData = melOut[this.mel.outputNames[0]].data as Float32Array; // (time, 1, ?, 32) row-major
      const newFrames = melData.length / MEL_BINS;
      for (let f = 0; f < newFrames; f += 1) {
        if (this.melFrames >= MEL_BUFFER_MAX) {
          this.melBuf.copyWithin(0, MEL_BINS, this.melFrames * MEL_BINS);
          this.melFrames -= 1;
        }
        for (let b = 0; b < MEL_BINS; b += 1) {
          this.melBuf[this.melFrames * MEL_BINS + b] = melData[f * MEL_BINS + b] / 10 + 2;
        }
        this.melFrames += 1;
        this.nMelFrames += 1;
      }
      if (this.melFrames < MEL_WINDOW) return null;

      // one new embedding from the last 76 mel frames
      this.embInBuf.set(
        this.melBuf.subarray((this.melFrames - MEL_WINDOW) * MEL_BINS, this.melFrames * MEL_BINS),
      );
      const embOut = await this.emb.run({
        [this.emb.inputNames[0]]: new ort.Tensor("float32", this.embInBuf, [1, MEL_WINDOW, MEL_BINS, 1]),
      });
      const embData = embOut[this.emb.outputNames[0]].data as Float32Array; // (1,1,1,96)
      if (this.embCount >= EMB_BUFFER_MAX) {
        this.embBuf.copyWithin(0, EMB_DIM, this.embCount * EMB_DIM);
        this.embCount -= 1;
      }
      for (let d = 0; d < EMB_DIM; d += 1) this.embBuf[this.embCount * EMB_DIM + d] = embData[d];
      this.embCount += 1;
      this.nEmb += 1;
      if (this.embCount < EMB_WINDOW) return null;

      this.wwInBuf.set(this.embBuf.subarray((this.embCount - EMB_WINDOW) * EMB_DIM, this.embCount * EMB_DIM));
      const wwOut = await this.ww.run({
        [this.ww.inputNames[0]]: new ort.Tensor("float32", this.wwInBuf, [1, EMB_WINDOW, EMB_DIM]),
      });
      const score = (wwOut[this.ww.outputNames[0]].data as Float32Array)[0];
      this.nInfer += 1;
      if (Number.isFinite(score)) {
        this.lastScore = score;
        if (score > this.maxScore) this.maxScore = score;
        return score;
      }
      this.lastError = "wakeword output was not finite";
      return null;
    } catch (error) {
      this.lastError = (error as Error)?.message ?? String(error);
      return null;
    } finally {
      this.inFlight = false;
    }
  }
}
