/**
 * V3 smoke: lip-sync parsing, the RMS fallback's timing and word alignment. Pure (no Rhubarb/whisper run).
 * Run: npx tsx scripts/smoke-v3-lipsync.ts
 */
import assert from "node:assert/strict";
import { alignWords, firstOpen, parseRhubarb, parseWhisperWords, readWavPcm16, rmsVisemes } from "../src/lib/v3/lipsync/LipSync";

let scenarios = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
  scenarios++;
}

/** 16-bit mono WAV: silence, a voiced-like tone, silence. */
function wav(sampleRate: number, parts: readonly [seconds: number, amplitude: number][]): Buffer {
  const total = parts.reduce((n, [s]) => n + Math.round(s * sampleRate), 0);
  const buf = Buffer.alloc(44 + total * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + total * 2, 4);
  buf.write("WAVEfmt ", 8, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(total * 2, 40);
  let i = 0;
  for (const [s, a] of parts) {
    for (let k = 0; k < Math.round(s * sampleRate); k++, i++) {
      // Speech-like: a 180 Hz tone with a 6 Hz syllable wobble.
      const v = a * Math.sin((2 * Math.PI * 180 * i) / sampleRate) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 6 * k) / sampleRate));
      buf.writeInt16LE(Math.round(v * 32000), 44 + i * 2);
    }
  }
  return buf;
}

async function main() {
  const FRAME = 1 / 30;

  await scenario("A the RMS fallback opens the mouth with the sound and closes it after, within 2 frames", () => {
    const { samples, sampleRate } = readWavPcm16(wav(48000, [[0.5, 0], [0.6, 0.8], [0.4, 0]]));
    assert.equal(sampleRate, 48000);
    const cues = rmsVisemes(samples, sampleRate);
    const open = firstOpen(cues)!;
    assert.ok(Math.abs(open - 0.5) <= 2 * FRAME, `ağız ${open.toFixed(3)} sn'de açıldı (ses 0,5 sn'de başlıyor)`);
    const closed = cues.find((c) => c.t > open && c.v === "X")!;
    assert.ok(Math.abs(closed.t - 1.1) <= 2 * FRAME, `ağız ${closed.t.toFixed(3)} sn'de kapandı (ses 1,1 sn'de bitiyor)`);
    for (let i = 1; i < cues.length; i++) assert.ok(cues[i]!.t - cues[i - 1]!.t >= 2 * FRAME - 1e-9, "ağız şekli 2 kareden kısa tutuldu");
  });

  await scenario("B silence stays closed", () => {
    const { samples, sampleRate } = readWavPcm16(wav(16000, [[1, 0]]));
    assert.deepEqual(rmsVisemes(samples, sampleRate).map((c) => c.v), ["X"]);
  });

  await scenario("C Rhubarb JSON becomes cues; unknown shapes are dropped", () => {
    const cues = parseRhubarb({ mouthCues: [{ start: 0, end: 0.1, value: "X" }, { start: 0.1, end: 0.2, value: "D" }, { start: 0.2, end: 0.3, value: "Q" }] });
    assert.deepEqual(cues, [{ t: 0, v: "X" }, { t: 0.1, v: "D" }]);
    assert.throws(() => parseRhubarb({}), /LIPSYNC_RHUBARB_SHAPE/);
  });

  await scenario("D whisper words: punctuation-only segments go, milliseconds become seconds", () => {
    const words = parseWhisperWords({ transcription: [{ offsets: { from: 120, to: 480 }, text: " Boğazı" }, { offsets: { from: 480, to: 500 }, text: "," }, { offsets: { from: 500, to: 900 }, text: " keseceğiz" }] });
    assert.deepEqual(words, [{ text: "Boğazı", start: 0.12, end: 0.48 }, { text: "keseceğiz", start: 0.5, end: 0.9 }]);
  });

  await scenario("E captions keep the script's words: one-to-one when counts agree, proportional otherwise", () => {
    const heard = [{ text: "bogazi", start: 0.1, end: 0.5 }, { text: "keseceğiz", start: 0.6, end: 1.0 }];
    assert.deepEqual(alignWords("Boğazı keseceğiz!", heard, 1.2).map((w) => [w.text, w.start]), [["Boğazı", 0.1], ["keseceğiz!", 0.6]]);
    const spread = alignWords("Boğazı hemen keseceğiz", heard, 1.2);
    assert.equal(spread.length, 3);
    assert.equal(spread[0]!.start, 0.1);
    assert.ok(Math.abs(spread[2]!.end - 1.0) < 1e-9);
    for (let i = 1; i < spread.length; i++) assert.ok(spread[i]!.start >= spread[i - 1]!.end - 1e-9);
    // Nothing heard: the whole line duration is used.
    assert.ok(Math.abs(alignWords("tek söz", [], 2).at(-1)!.end - 2) < 1e-9);
  });

  console.log(`V3 lipsync smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
