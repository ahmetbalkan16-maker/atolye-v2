/*
 * D2 WAKE LAB — throwaway AudioWorklet frame pump.
 *
 * Branch: research/ayas-d2-audio-lab. NOT part of AYAS. NOT merged to any
 * production branch. Runs in AudioWorkletGlobalScope (globals: sampleRate,
 * currentTime, AudioWorkletProcessor, registerProcessor).
 *
 * Reuses the Phase 0 chain that a real iPhone already verified (context-rate
 * mono in -> linear-interpolated 16 kHz mono downsample). Instead of only
 * telemetry it ALSO assembles fixed 80 ms (1280-sample) frames of 16 kHz mono
 * Float32 and copies them to the main thread, where a pluggable WakeDetector
 * consumes them.
 *
 * It NEVER stores audio, NEVER uploads, NEVER calls a server. A frame lives
 * only for the duration of one detector.accept() call on the main thread.
 * Telemetry ({inSamples,outSamples,frames,rms}) every ~200 ms.
 */

const TARGET_RATE = 16000;
const FRAME = 1280; // 80 ms @ 16 kHz — a typical wake-engine hop
const TELEMETRY_INTERVAL_S = 0.2;

class D2WakeLabProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.pos = 0;
    this.inSamples = 0;
    this.outSamples = 0;
    this.frames = 0;
    this.sumSq = 0;
    this.sumSqCount = 0;
    this.lastPost = 0;
    this.alive = true;
    this.buf = new Float32Array(FRAME);
    this.fill = 0;
    this.port.onmessage = (event) => {
      if (event.data === "stop") this.alive = false;
    };
  }

  process(inputs) {
    if (!this.alive) return false;
    const ch = inputs[0] && inputs[0][0];
    if (!ch || ch.length === 0) return true;

    this.inSamples += ch.length;

    let pos = this.pos;
    while (pos < ch.length) {
      const i0 = pos | 0;
      const i1 = i0 + 1 < ch.length ? i0 + 1 : ch.length - 1;
      const frac = pos - i0;
      const s = ch[i0] * (1 - frac) + ch[i1] * frac;
      this.sumSq += s * s;
      this.sumSqCount += 1;
      this.outSamples += 1;
      this.buf[this.fill] = s;
      this.fill += 1;
      if (this.fill === FRAME) {
        this.frames += 1;
        // copy (not transfer) — cheap (~5 KB, ~12/s) and dodges any iOS
        // transferable edge case in a probe.
        this.port.postMessage({ type: "frame", samples: this.buf.slice(0) });
        this.fill = 0;
      }
      pos += this.ratio;
    }
    this.pos = pos - ch.length;

    if (currentTime - this.lastPost >= TELEMETRY_INTERVAL_S) {
      const rms = this.sumSqCount > 0 ? Math.sqrt(this.sumSq / this.sumSqCount) : 0;
      this.port.postMessage({
        type: "telemetry",
        inSamples: this.inSamples,
        outSamples: this.outSamples,
        frames: this.frames,
        inRate: sampleRate,
        outRate: TARGET_RATE,
        rms,
      });
      this.sumSq = 0;
      this.sumSqCount = 0;
      this.lastPost = currentTime;
    }

    return true;
  }
}

registerProcessor("d2-wake-lab-processor", D2WakeLabProcessor);
