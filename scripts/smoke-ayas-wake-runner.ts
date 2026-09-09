/**
 * AYAS wake RUNNER smoke suite (D2 Faz 1B — wake detection closure).
 *
 * Proves the browser streaming path that turns 16 kHz frames into a wakeword
 * score, at three levels:
 *
 *   1. resampling math — the worklet's 48k→16k linear-interp downsample is
 *      render-quantum independent and rate-correct;
 *   2. OpenWakeWordRunner buffer/tensor math — fake ONNX sessions assert the
 *      exact input shapes, the streaming windows, the numeric `stats`, score
 *      extraction, and that an inference failure is captured (never thrown);
 *   3. integration (real ONNX, skipped if assets absent) — a synthesised "AYAS"
 *      clip scores high and a non-wake phrase scores low through the real
 *      `public/wake/*.onnx` models.
 *
 * No framework — node:assert/strict, like every other scripts/smoke-*.ts.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  OpenWakeWordRunner,
  type WakeSession,
} from "../src/components/brain/voice/wake/openWakeWordRunner";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const REPO = process.cwd();
const CHUNK = 1280;

/* ------------------------------------------------------------------ 1. resample */

/**
 * Reference port of `public/worklets/d2-wake-lab-processor.js` — the exact
 * downsample + 1280-frame assembly, but driven block-by-block so tests can vary
 * the render quantum. Kept in lock-step with the worklet by the assertions below.
 */
function workletResample(input: Float32Array, inRate: number, blockSize: number): Float32Array[] {
  const TARGET = 16000;
  const FRAME = 1280;
  const ratio = inRate / TARGET;
  const frames: Float32Array[] = [];
  const buf = new Float32Array(FRAME);
  let fill = 0;
  let pos = 0;
  for (let start = 0; start < input.length; start += blockSize) {
    const ch = input.subarray(start, Math.min(start + blockSize, input.length));
    let p = pos;
    while (p < ch.length) {
      const i0 = p | 0;
      const i1 = i0 + 1 < ch.length ? i0 + 1 : ch.length - 1;
      const frac = p - i0;
      buf[fill] = ch[i0] * (1 - frac) + ch[i1] * frac;
      fill += 1;
      if (fill === FRAME) {
        frames.push(buf.slice(0));
        fill = 0;
      }
      p += ratio;
    }
    pos = p - ch.length;
  }
  return frames;
}

function flat(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.length * CHUNK);
  frames.forEach((f, i) => out.set(f, i * CHUNK));
  return out;
}

function sine(seconds: number, rate: number, hz: number): Float32Array {
  const x = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < x.length; i += 1) x[i] = Math.sin((2 * Math.PI * hz * i) / rate) * 0.5;
  return x;
}

/* -------------------------------------------------------------- 2. fake sessions */

interface Recorder {
  readonly melDims: number[][];
  readonly embDims: number[][];
  readonly wwDims: number[][];
}

/** mel: [1,N] float → [1,1,8,32] (8 new mel frames per call, like a 1280+lookback chunk). */
function fakeMel(rec: Recorder, opts: { throwOnCall?: number } = {}): WakeSession {
  let calls = 0;
  return {
    inputNames: ["input"],
    outputNames: ["output"],
    async run(feeds) {
      calls += 1;
      const t = feeds.input as { dims: readonly number[]; data: unknown };
      rec.melDims.push([...t.dims]);
      if (opts.throwOnCall && calls >= opts.throwOnCall) throw new Error("simulated mel kernel failure");
      const data = new Float32Array(8 * 32);
      for (let i = 0; i < data.length; i += 1) data[i] = ((i % 7) - 3) * 2; // arbitrary non-zero
      return { output: { data } };
    },
  };
}

/** embedding: [1,76,32,1] → [1,1,1,96]. */
function fakeEmb(rec: Recorder): WakeSession {
  return {
    inputNames: ["input_1"],
    outputNames: ["conv2d_19"],
    async run(feeds) {
      const t = feeds.input_1 as { dims: readonly number[]; data: unknown };
      rec.embDims.push([...t.dims]);
      const data = new Float32Array(96).fill(0.1);
      return { conv2d_19: { data } };
    },
  };
}

/** wakeword: [1,16,96] → [1,1] with a caller-chosen score. */
function fakeWw(rec: Recorder, score: () => number): WakeSession {
  return {
    inputNames: ["x"],
    outputNames: ["ayas"],
    async run(feeds) {
      const t = feeds.x as { dims: readonly number[]; data: unknown };
      rec.wwDims.push([...t.dims]);
      return { ayas: { data: new Float32Array([score()]) } };
    },
  };
}

function makeRunner(sessions: { mel: WakeSession; emb: WakeSession; ww: WakeSession }): OpenWakeWordRunner {
  const order = [sessions.mel, sessions.emb, sessions.ww];
  let i = 0;
  return new OpenWakeWordRunner({
    melspectrogramUrl: "mel",
    embeddingUrl: "emb",
    wakewordUrl: "ww",
    createSession: async () => order[i++],
  });
}

/* ------------------------------------------------------------- 3. real integration */

function synth(text: string, outWav: string, work: string): boolean {
  const piperSrc = path.join(REPO, "bin/piper");
  const ff = process.env.AYAS_FFMPEG_PATH || "ffmpeg";
  if (!fs.existsSync(piperSrc) || !fs.existsSync(path.join(REPO, "public/wake/ayas.onnx"))) return false;
  try {
    const ap = path.join(work, "piper");
    fs.cpSync(piperSrc, ap, { recursive: true });
    const raw = path.join(work, "raw.wav");
    execFileSync(
      path.join(ap, "piper.exe"),
      ["--model", path.join(ap, "tr_TR-dfki-medium.onnx"), "--espeak_data", path.join(ap, "espeak-ng-data"), "--output_file", raw],
      { input: text, cwd: ap, stdio: ["pipe", "ignore", "ignore"] },
    );
    execFileSync(ff, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-af", "adelay=700,apad=pad_dur=1.3", outWav], { stdio: "ignore" });
    return fs.existsSync(outWav);
  } catch {
    return false;
  }
}

function readWav16(p: string): Float32Array {
  const b = fs.readFileSync(p);
  const n = (b.length - 44) / 2;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i += 1) x[i] = b.readInt16LE(44 + i * 2) / 32768;
  return x;
}

async function peakScore(runner: OpenWakeWordRunner, pcm: Float32Array): Promise<number> {
  let max = 0;
  for (let i = 0; i + CHUNK <= pcm.length; i += CHUNK) {
    const s = await runner.accept(pcm.subarray(i, i + CHUNK));
    if (s !== null) max = Math.max(max, s);
  }
  return max;
}

/* ------------------------------------------------------------------------- run */

async function run() {
  // ---- 1. resample math -----------------------------------------------------

  await scenario("48k→16k downsample is rate-correct (3 s → ~3 s of 16 kHz frames)", () => {
    const frames = workletResample(sine(3, 48000, 440), 48000, 128);
    // 3 s @ 16 kHz = 48000 samples = 37.5 frames → 37 complete frames
    assert.equal(frames.length, 37, `got ${frames.length}`);
  });

  await scenario("downsample is render-quantum independent (128/256/512/999/2048 identical)", () => {
    const input = sine(2, 48000, 440);
    const ref = flat(workletResample(input, 48000, 128));
    for (const block of [256, 512, 999, 2048, 4096]) {
      const got = flat(workletResample(input, 48000, block));
      assert.equal(got.length, ref.length, `length differs at block ${block}`);
      let maxDiff = 0;
      for (let i = 0; i < ref.length; i += 1) maxDiff = Math.max(maxDiff, Math.abs(ref[i] - got[i]));
      assert.ok(maxDiff < 1e-6, `block ${block} diverges by ${maxDiff}`);
    }
  });

  await scenario("downsample handles 44.1 kHz and a no-op 16 kHz input", () => {
    assert.equal(workletResample(sine(1, 44100, 300), 44100, 128).length, 12); // 16000/1280 = 12.5 → 12
    const passthru = workletResample(sine(1, 16000, 300), 16000, 128);
    assert.equal(passthru.length, 12);
  });

  await scenario("downsample preserves a 1 kHz tone (energy stays in band)", () => {
    const out = flat(workletResample(sine(1, 48000, 1000), 48000, 128));
    let sumSq = 0;
    for (const v of out) sumSq += v * v;
    const rms = Math.sqrt(sumSq / out.length);
    assert.ok(rms > 0.3 && rms < 0.4, `rms ${rms.toFixed(3)} — a 0.5-amp sine should be ~0.354`);
  });

  // ---- 2. runner buffer / tensor / stats math -----------------------------

  await scenario("runner feeds exact ONNX input shapes: [1,N] / [1,76,32,1] / [1,16,96]", async () => {
    const rec: Recorder = { melDims: [], embDims: [], wwDims: [] };
    const runner = makeRunner({ mel: fakeMel(rec), emb: fakeEmb(rec), ww: fakeWw(rec, () => 0.5) });
    await runner.init();
    for (let i = 0; i < 40; i += 1) await runner.accept(new Float32Array(CHUNK).fill(0.1));

    assert.ok(rec.melDims.length > 0);
    for (const d of rec.melDims) {
      assert.equal(d.length, 2);
      assert.equal(d[0], 1);
      assert.ok(d[1] === CHUNK || d[1] === CHUNK + 480, `mel input width ${d[1]}`);
    }
    assert.ok(rec.embDims.length > 0, "embeddings ran");
    for (const d of rec.embDims) assert.deepEqual(d, [1, 76, 32, 1]);
    assert.ok(rec.wwDims.length > 0, "wakeword ran");
    for (const d of rec.wwDims) assert.deepEqual(d, [1, 16, 96]);
  });

  await scenario("runner returns null until 16 embeddings, then the wakeword score", async () => {
    const rec: Recorder = { melDims: [], embDims: [], wwDims: [] };
    const runner = makeRunner({ mel: fakeMel(rec), emb: fakeEmb(rec), ww: fakeWw(rec, () => 0.73) });
    await runner.init();
    const scores: (number | null)[] = [];
    for (let i = 0; i < 30; i += 1) scores.push(await runner.accept(new Float32Array(CHUNK).fill(0.05)));

    const firstScoreAt = scores.findIndex((s) => s !== null);
    assert.ok(firstScoreAt >= 16, `first score at call ${firstScoreAt} — needs ≥16 embeddings (8 mel frames/call, 76-frame window)`);
    assert.ok(Math.abs((scores[scores.length - 1] ?? 0) - 0.73) < 1e-5, `last score ${scores[scores.length - 1]}`);
  });

  await scenario("stats counters advance (frames / melFrames / embeddings / inferences / max)", async () => {
    const rec: Recorder = { melDims: [], embDims: [], wwDims: [] };
    let n = 0;
    const runner = makeRunner({ mel: fakeMel(rec), emb: fakeEmb(rec), ww: fakeWw(rec, () => [0.1, 0.9, 0.4][n++ % 3]) });
    await runner.init();
    for (let i = 0; i < 40; i += 1) await runner.accept(new Float32Array(CHUNK).fill(0.05));

    const s = runner.stats;
    assert.equal(s.frames, 40, "one full chunk consumed per accept()");
    assert.equal(s.melFrames, 40 * 8, "8 mel frames per call");
    assert.ok(s.embeddings >= 24 && s.embeddings <= 31, `embeddings ${s.embeddings}`);
    assert.equal(s.inferences, s.embeddings - 15, "an inference once ≥16 embeddings, then one per call");
    assert.ok(Math.abs(s.maxScore - 0.9) < 1e-6, `maxScore ${s.maxScore}`);
    assert.equal(s.lastError, null);
  });

  await scenario("sub-chunk frames are buffered — 320-sample frames still produce chunks", async () => {
    const rec: Recorder = { melDims: [], embDims: [], wwDims: [] };
    const runner = makeRunner({ mel: fakeMel(rec), emb: fakeEmb(rec), ww: fakeWw(rec, () => 0.5) });
    await runner.init();
    let full = 0;
    for (let i = 0; i < 4 * 40; i += 1) {
      await runner.accept(new Float32Array(320).fill(0.05)); // 4 sub-frames = 1 chunk
    }
    full = runner.stats.frames;
    assert.equal(full, 40, `expected 40 chunks from 160 × 320-sample frames, got ${full}`);
  });

  await scenario("an inference failure is captured in stats.lastError, never thrown", async () => {
    const rec: Recorder = { melDims: [], embDims: [], wwDims: [] };
    const runner = makeRunner({ mel: fakeMel(rec, { throwOnCall: 5 }), emb: fakeEmb(rec), ww: fakeWw(rec, () => 0.5) });
    await runner.init();
    let threw = false;
    let lastReturn: number | null = 0;
    try {
      for (let i = 0; i < 20; i += 1) lastReturn = await runner.accept(new Float32Array(CHUNK).fill(0.05));
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "accept() must never reject");
    assert.equal(lastReturn, null);
    assert.match(runner.stats.lastError ?? "", /simulated mel kernel failure/);
  });

  await scenario("disposed / uninitialised runner yields null (no throw)", async () => {
    const rec: Recorder = { melDims: [], embDims: [], wwDims: [] };
    const runner = makeRunner({ mel: fakeMel(rec), emb: fakeEmb(rec), ww: fakeWw(rec, () => 0.5) });
    assert.equal(await runner.accept(new Float32Array(CHUNK)), null); // not init()'d
    await runner.init();
    runner.dispose();
    assert.equal(await runner.accept(new Float32Array(CHUNK)), null);
  });

  // ---- 3. real ONNX integration (skipped without assets) -------------------

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "wake-runner-"));
  try {
    const posWav = path.join(work, "ayas.wav");
    const negWav = path.join(work, "neg.wav");
    const havePos = synth("AYAS", posWav, work);
    const haveNeg = synth("bugün hava çok güzel", negWav, work);

    if (havePos && haveNeg) {
      const models = {
        melspectrogramUrl: path.join(REPO, "public/wake/melspectrogram.onnx"),
        embeddingUrl: path.join(REPO, "public/wake/embedding_model.onnx"),
        wakewordUrl: path.join(REPO, "public/wake/ayas.onnx"),
      };

      await scenario("REAL: synthesised 'AYAS' peaks well above the 0.70 wake threshold", async () => {
        const runner = new OpenWakeWordRunner(models);
        await runner.init();
        const peak = await peakScore(runner, readWav16(posWav));
        assert.ok(peak >= 0.9, `peak ${peak.toFixed(4)} — pipeline should fire on the wake word`);
        assert.ok(runner.stats.inferences > 5 && runner.stats.melFrames > 76);
      });

      await scenario("REAL: a non-wake Turkish phrase stays far below threshold", async () => {
        const runner = new OpenWakeWordRunner(models);
        await runner.init();
        const peak = await peakScore(runner, readWav16(negWav));
        assert.ok(peak < 0.5, `peak ${peak.toFixed(4)} — must not fire on non-wake speech`);
      });
    } else {
      console.log("SKIP real-ONNX integration (bin/piper, ffmpeg, or public/wake/ayas.onnx absent)");
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  console.log(`AYAS wake runner smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-wake-runner", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
