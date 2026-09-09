/*
 * D2 AUDIO LAB — throwaway AudioWorklet processor.
 *
 * Branch: research/ayas-d2-audio-lab. NOT part of AYAS. NOT merged to any
 * production branch. This runs in AudioWorkletGlobalScope (globals: sampleRate,
 * currentTime, AudioWorkletProcessor, registerProcessor).
 *
 * Purpose: prove that microphone PCM flows through an AudioWorklet on a real
 * iPhone installed PWA, and that a 16 kHz mono downsample runs. It computes a
 * running RMS and sample counters and posts a LOW-RATE telemetry message to the
 * main thread.
 *
 * It NEVER buffers audio for playback/transport, NEVER stores anything, NEVER
 * posts raw audio frames. The only data that leaves this scope is
 * { inSamples, outSamples, inRate, outRate, rms } every ~200 ms.
 */

const TARGET_RATE = 16000;
const TELEMETRY_INTERVAL_S = 0.2;

class D2AudioLabProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE; // e.g. 48000 / 16000 = 3
    this.pos = 0; // fractional read cursor carried across render quanta
    this.inSamples = 0; // raw input samples seen (context rate)
    this.outSamples = 0; // 16 kHz samples produced
    this.sumSq = 0; // running sum of squares of the 16 kHz signal (for RMS)
    this.sumSqCount = 0;
    this.lastPost = 0;
    this.alive = true;
    this.port.onmessage = (event) => {
      if (event.data === "stop") this.alive = false;
    };
  }

  process(inputs) {
    if (!this.alive) return false; // let the node be collected on explicit stop
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch || ch.length === 0) return true; // no mic frame yet — keep alive

    this.inSamples += ch.length;

    // Linear-interpolated downsample to 16 kHz. The output value feeds the RMS
    // so the resample is exercised on real samples, not just counted.
    let pos = this.pos;
    while (pos < ch.length) {
      const i0 = pos | 0;
      const i1 = i0 + 1 < ch.length ? i0 + 1 : ch.length - 1;
      const frac = pos - i0;
      const s = ch[i0] * (1 - frac) + ch[i1] * frac;
      this.sumSq += s * s;
      this.sumSqCount += 1;
      this.outSamples += 1;
      pos += this.ratio;
    }
    this.pos = pos - ch.length;

    if (currentTime - this.lastPost >= TELEMETRY_INTERVAL_S) {
      const rms = this.sumSqCount > 0 ? Math.sqrt(this.sumSq / this.sumSqCount) : 0;
      this.port.postMessage({
        inSamples: this.inSamples,
        outSamples: this.outSamples,
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

registerProcessor("d2-audio-lab-processor", D2AudioLabProcessor);
