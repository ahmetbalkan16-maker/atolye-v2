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
}

export class OpenWakeWordRunner {
  private mel!: ort.InferenceSession;
  private emb!: ort.InferenceSession;
  private ww!: ort.InferenceSession;

  private readonly raw: Float32Array; // int16-scale samples, rolling
  private rawLen = 0;
  private pending: number[] = []; // sub-chunk carry
  private melBuf: Float32Array; // [frames * MEL_BINS]
  private melFrames = 0;
  private embBuf: Float32Array; // [count * EMB_DIM]
  private embCount = 0;
  private _ready = false;
  private disposed = false;

  constructor(private readonly opts: WakeRunnerOptions) {
    this.raw = new Float32Array((CHUNK + MEL_LOOKBACK) * 2);
    this.melBuf = new Float32Array(MEL_BUFFER_MAX * MEL_BINS);
    this.embBuf = new Float32Array(EMB_BUFFER_MAX * EMB_DIM);
  }

  get ready(): boolean {
    return this._ready;
  }

  async init(): Promise<void> {
    if (this.opts.wasmPaths) ort.env.wasm.wasmPaths = this.opts.wasmPaths;
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = "error";
    const so: ort.InferenceSession.SessionOptions = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
    [this.mel, this.emb, this.ww] = await Promise.all([
      ort.InferenceSession.create(this.opts.melspectrogramUrl, so),
      ort.InferenceSession.create(this.opts.embeddingUrl, so),
      ort.InferenceSession.create(this.opts.wakewordUrl, so),
    ]);
    this._ready = true;
  }

  reset(): void {
    this.rawLen = 0;
    this.pending = [];
    this.melFrames = 0;
    this.embCount = 0;
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
   */
  async accept(frame: Float32Array): Promise<number | null> {
    if (!this._ready || this.disposed) return null;
    for (let i = 0; i < frame.length; i += 1) this.pending.push(frame[i] * 32767);
    if (this.pending.length < CHUNK) return null;

    const chunk = this.pending.splice(0, CHUNK);
    // roll the raw buffer, keep the last CHUNK + lookback samples
    const keep = CHUNK + MEL_LOOKBACK;
    if (this.rawLen + CHUNK > this.raw.length) {
      this.raw.copyWithin(0, this.rawLen - keep + CHUNK, this.rawLen);
      this.rawLen = keep - CHUNK;
    }
    for (let i = 0; i < CHUNK; i += 1) this.raw[this.rawLen + i] = chunk[i];
    this.rawLen += CHUNK;

    const melSlice = this.raw.subarray(Math.max(0, this.rawLen - (CHUNK + MEL_LOOKBACK)), this.rawLen);
    const melOut = await this.mel.run({
      [this.mel.inputNames[0]]: new ort.Tensor("float32", Float32Array.from(melSlice), [1, melSlice.length]),
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
    }
    if (this.melFrames < MEL_WINDOW) return null;

    // one new embedding from the last 76 mel frames
    const embIn = this.melBuf.subarray((this.melFrames - MEL_WINDOW) * MEL_BINS, this.melFrames * MEL_BINS);
    const embOut = await this.emb.run({
      [this.emb.inputNames[0]]: new ort.Tensor("float32", Float32Array.from(embIn), [1, MEL_WINDOW, MEL_BINS, 1]),
    });
    const embData = embOut[this.emb.outputNames[0]].data as Float32Array; // (1,1,1,96)
    if (this.embCount >= EMB_BUFFER_MAX) {
      this.embBuf.copyWithin(0, EMB_DIM, this.embCount * EMB_DIM);
      this.embCount -= 1;
    }
    for (let d = 0; d < EMB_DIM; d += 1) this.embBuf[this.embCount * EMB_DIM + d] = embData[d];
    this.embCount += 1;
    if (this.embCount < EMB_WINDOW) return null;

    const wwIn = this.embBuf.subarray((this.embCount - EMB_WINDOW) * EMB_DIM, this.embCount * EMB_DIM);
    const wwOut = await this.ww.run({
      [this.ww.inputNames[0]]: new ort.Tensor("float32", Float32Array.from(wwIn), [1, EMB_WINDOW, EMB_DIM]),
    });
    const score = (wwOut[this.ww.outputNames[0]].data as Float32Array)[0];
    return Number.isFinite(score) ? score : null;
  }
}
