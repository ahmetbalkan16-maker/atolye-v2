import { detectAyasWakeWord } from "../../ayasVoice";
import { AYAS_OWNER_WAKE_POLICY_V3 } from "@/lib/ayas/voice/AyasWakePolicy";
import { encodeWav16kMono } from "./wav";

export interface LocalWakeTranscript {
  readonly text: string;
  readonly confidence: { readonly minTokenP: number; readonly meanTokenP: number } | null;
}
export interface LocalWakeSnapshot {
  readonly phase: "listening" | "capturing" | "checking" | "stopped";
  readonly frames: number;
  readonly maxRms: number;
  readonly requests: number;
  readonly hits: number;
  readonly lastTranscript: string;
  readonly lastReason: string;
  readonly processingMs: number;
}

/** Text wake only; no command dispatch or execution. Existing owner aliases only. */
export function qualifyLocalWakeTranscript(result: LocalWakeTranscript): boolean {
  const c = result.confidence;
  return Boolean(c && Number.isFinite(c.minTokenP) && Number.isFinite(c.meanTokenP)
    && c.minTokenP >= 0.3 && c.minTokenP <= 1 && c.meanTokenP >= 0.65 && c.meanTokenP <= 1
    && detectAyasWakeWord(result.text, AYAS_OWNER_WAKE_POLICY_V3).woke);
}

/** Bounded speech clips -> existing own-PC STT. Never uploads continuous silence.
 * One request in flight; no backlog. stop/reset invalidates and aborts old work.
 * This is a qualification candidate, not an acoustic score replacement.
 */
export class LocalWhisperWakeListener {
  private epoch = 0;
  private stopped = false;
  private controller: AbortController | null = null;
  private preRoll: Float32Array[] = [];
  private clip: Float32Array[] | null = null;
  private speechFrames = 0;
  private silentFrames = 0;
  private nextRequestAt = 0;
  private snapshot: LocalWakeSnapshot = { phase: "listening", frames: 0, maxRms: 0, requests: 0, hits: 0, lastTranscript: "", lastReason: "", processingMs: 0 };

  constructor(private readonly o: {
    transcribe(wav: Uint8Array, signal: AbortSignal): Promise<LocalWakeTranscript>;
    onChange(snapshot: LocalWakeSnapshot): void;
    onWake(result: LocalWakeTranscript): void;
    now?: () => number;
  }) {}

  get status(): LocalWakeSnapshot { return { ...this.snapshot }; }
  private now(): number { return this.o.now?.() ?? Date.now(); }
  private emit(patch: Partial<LocalWakeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.o.onChange(this.status);
  }
  stop(): void {
    this.stopped = true;
    this.epoch++;
    this.controller?.abort();
    this.controller = null;
    this.clip = null;
    this.preRoll = [];
    this.emit({ phase: "stopped" });
  }

  accept(frame: Float32Array): void {
    if (this.stopped || frame.length !== 1280) return;
    const rms = Math.sqrt(frame.reduce((sum, x) => sum + x * x, 0) / frame.length);
    if (!Number.isFinite(rms)) return;
    this.snapshot = { ...this.snapshot, frames: this.snapshot.frames + 1, maxRms: Math.max(this.snapshot.maxRms, rms) };
    if (this.snapshot.frames % 12 === 0) this.emit({});
    if (this.controller || this.now() < this.nextRequestAt) return;
    const speech = rms >= 0.006;
    if (!this.clip) {
      this.preRoll.push(frame.slice());
      if (this.preRoll.length > 3) this.preRoll.shift();
      if (!speech) return;
      this.clip = this.preRoll;
      this.preRoll = [];
      this.speechFrames = 1;
      this.silentFrames = 0;
      this.emit({ phase: "capturing" });
      return;
    }
    this.clip.push(frame.slice());
    if (speech) { this.speechFrames++; this.silentFrames = 0; }
    else this.silentFrames++;
    // At most 8 seconds/100 frames (~512 KB PCM, 256 KB WAV).
    if (this.clip.length < 100 && this.silentFrames < 6) return;
    const clip = this.clip;
    this.clip = null;
    if (this.speechFrames < 2) { this.emit({ phase: "listening", lastReason: "speech-too-short" }); return; }
    const pcm = new Float32Array(clip.length * 1280);
    clip.forEach((f, i) => pcm.set(f, i * 1280));
    const wav = encodeWav16kMono(pcm);
    const controller = new AbortController();
    this.controller = controller;
    this.nextRequestAt = this.now() + 4000; // <=15 requests/min; existing API limit is 30.
    const epoch = this.epoch, started = this.now();
    this.emit({ phase: "checking", requests: this.snapshot.requests + 1 });
    // The transport may ignore AbortSignal; logical progress is also bounded.
    let timeout: ReturnType<typeof setTimeout>;
    const expiry = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new Error("wake-stt-timeout")); }, 20000);
    });
    void Promise.race([Promise.resolve().then(() => this.o.transcribe(wav, controller.signal)), expiry])
      .then(result => {
        if (this.stopped || epoch !== this.epoch) return;
        const hit = qualifyLocalWakeTranscript(result);
        this.emit({ lastTranscript: result.text, hits: this.snapshot.hits + Number(hit), lastReason: hit ? "owner-alias-confirmed" : "wake-not-confirmed", processingMs: this.now() - started });
        if (hit) this.o.onWake(result);
      }).catch(error => {
        if (this.stopped || epoch !== this.epoch) return;
        this.emit({ lastReason: error instanceof Error ? error.message : "wake-stt-failed", processingMs: this.now() - started });
      }).finally(() => {
        clearTimeout(timeout!);
        if (this.stopped || epoch !== this.epoch) return;
        this.controller = null;
        this.emit({ phase: "listening" });
      });
  }
}
