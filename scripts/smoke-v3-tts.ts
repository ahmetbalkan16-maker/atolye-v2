/**
 * V3 smoke: a voiced line's post-processing (owner, 13 Nov 2026: "ses kaynağını da düzelt") — the silence trim in Node
 * (Tts.trimVoice) leaves no tick where FFmpeg's silenceremove left one, keeps the length and fades the ends; the cache
 * key changes with the new trim while the take seed stays the old one. Runs the real FFmpeg (no model, no network).
 * Run: npx tsx scripts/smoke-v3-tts.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readWavPcm16 } from "../src/lib/v3/lipsync/LipSync";
import { ticks } from "../src/lib/v3/mix/AudioQuality";
import { LEGACY_TRIM_FILTER, lineKeys, type LineKeyParts, postProcessFilter, postProcessLine, STUCK_MAX_S, stuckSeconds, TRIM_FADE_IN_MIN_S, TRIM_PAD_END_S, TRIM_PAD_START_S, TRIM_SPEC, trimVoice, TTS_RATE, type VoiceProfile } from "../src/lib/v3/tts/Tts";
import { voxcpmDescription } from "../src/lib/v3/tts/Voxcpm";
import { runChecked } from "../src/lib/v3/util/Proc";
import { loadV3Settings, resolveV3Paths } from "../src/lib/v3/V3Paths";

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

/** Deterministic noise in [-1, 1]. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
}

/**
 * Voice-like take: `lead` s of room noise (−60 dBFS), `speech` s of a 140 Hz voice with harmonics and 5 Hz syllables
 * that opens and closes on a soft consonant, `tail` s of room noise; `hard` starts and stops the voice at full level.
 */
function take(rate: number, lead: number, speech: number, tail: number, opts: { hard?: boolean; zeros?: boolean } = {}): Float32Array {
  const rnd = noise(7);
  const nLead = Math.round(lead * rate), nSpeech = Math.round(speech * rate), nTail = Math.round(tail * rate);
  const x = new Float32Array(nLead + nSpeech + nTail);
  for (let i = 0; i < x.length; i++) x[i] = opts.zeros ? 0 : 0.001 * rnd();
  for (let k = 0; k < nSpeech; k++) {
    const t = k / rate;
    const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 5 * t);
    const edge = opts.hard ? 1 : Math.min(1, t / 0.03, (speech - t) / 0.03);
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * 140 * h * t + h) / h;
    x[nLead + k] = 0.25 * syllable * edge * v + 0.004 * rnd();
  }
  return x;
}

function wav16(samples: Float32Array, rate: number): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767))), 44 + i * 2);
  return buf;
}

const plain: VoiceProfile = { saglayici: "voxcpm", perde: 0, hiz: 1, exaggeration: 0.5, cfg: 0.5, sicaklik: 0.8 };
const shifted: VoiceProfile = { ...plain, perde: -2.5, hiz: 0.92, titreme: true };

async function main() {
  await scenario("trimVoice keeps the pads of the take's own quiet and fades over them", () => {
    const rate = TTS_RATE;
    const x = take(rate, 0.5, 2, 0.7);
    const t = trimVoice(x, rate);
    const lead = 0.5 * rate;
    assert.ok(Math.abs(t.soundStart - lead) < 0.012 * rate, `start ${t.soundStart}`);
    assert.ok(Math.abs(t.soundEnd - (lead + 2 * rate)) < 0.012 * rate, `end ${t.soundEnd}`);
    const seconds = t.samples.length / rate;
    assert.ok(Math.abs(seconds - (2 + TRIM_PAD_START_S + TRIM_PAD_END_S)) < 0.025, `length ${seconds}`);
    assert.ok(Math.abs(t.samples[0]!) < 1e-6 && Math.abs(t.samples[t.samples.length - 1]!) < 1e-5, "ends at zero");
    // The sound itself is not touched once the fade-in is over.
    const from = t.soundStart - TRIM_PAD_START_S * rate;
    const into = TRIM_PAD_START_S * rate + 0.05 * rate;
    const offsets = [0, 1, 2, 3, 4, 5].filter((d) => t.samples[into] === x[from + d + into] && t.samples[into + 100] === x[from + d + into + 100]);
    assert.equal(offsets.length, 1, "the voice is copied unchanged");
  });

  await scenario("a take that starts and stops mid-sound gets the shortest fades, not a step", () => {
    const rate = 24_000;
    const x = take(rate, 0, 1, 0, { hard: true });
    const t = trimVoice(x, rate);
    assert.equal(t.samples.length, x.length);
    assert.equal(t.samples[0], 0);
    const halfMs = Math.round(0.0005 * rate);
    for (let k = 0; k <= halfMs; k++) assert.ok(Math.abs(t.samples[k]!) < 0.01 && Math.abs(t.samples[t.samples.length - 1 - k]!) < 0.01, `edge sample ${k}`);
    const fadeEnd = Math.round(TRIM_FADE_IN_MIN_S * rate);
    assert.equal(t.samples[fadeEnd + 5], x[fadeEnd + 5]);
  });

  await scenario("over digital silence in the pad the fade starts on the sound, and the pad keeps its length", () => {
    const rate = TTS_RATE;
    const x = take(rate, 0.3, 1, 0.3, { hard: true, zeros: true });
    const t = trimVoice(x, rate);
    const expected = rate * (1 + TRIM_PAD_START_S + TRIM_PAD_END_S);
    assert.ok(Math.abs(t.samples.length - expected) <= 2, `length ${t.samples.length}`);
    assert.deepEqual(ticks(t.samples, rate), []);
    assert.ok(ticks(x, rate).length >= 2, "the hard take itself has both edges");
  });

  await scenario("a take with no sound is kept whole", () => {
    const x = take(TTS_RATE, 0.4, 0, 0);
    const t = trimVoice(x, TTS_RATE);
    assert.equal(t.samples.length, x.length);
    assert.equal(t.soundStart, -1);
    assert.equal(trimVoice(new Float32Array(0), TTS_RATE).samples.length, 0);
  });

  await scenario("the filter chain no longer trims; the old trim is kept only as text", () => {
    assert.ok(!postProcessFilter(plain, 1).includes("silenceremove"));
    assert.equal(postProcessFilter(plain, 1), "loudnorm=I=-18:TP=-2:LRA=9,aresample=48000,adelay=40,apad=pad_dur=0.04");
    // The vibrato reads 20 ms of zeros first (FFmpeg reads its delay line before writing it), then they are cut off.
    assert.ok(postProcessFilter(shifted, 1).startsWith("rubberband=pitch=0.86554:tempo=0.9200,adelay=delays=960S,vibrato=f=5.5:d=0.06,atrim=start_sample=960,asetpts=PTS-STARTPTS,loudnorm="));
    assert.equal(LEGACY_TRIM_FILTER.split(",").length, 4);
  });

  await scenario("cache key changes with the trim; the take seed is the one the old key gave", () => {
    const parts: LineKeyParts = { model: "voxcpm2-2.0.3", speech: "Ships burn in the dark.", voice: plain, provider: "voxcpm", boost: 0.1, speed: 1, refHash: "", language: "en", emotion: "korkmus", directions: ["whispering"] };
    // The key exactly as Tts.synthesize computed it until 13 Nov 2026 (silenceremove at the head of the filter).
    const oldFilter = "silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.06,areverse,loudnorm=I=-18:TP=-2:LRA=9,aresample=48000,adelay=40,apad=pad_dur=0.04";
    const oldKey = createHash("sha256")
      .update(JSON.stringify({ v: 1, model: parts.model, speech: parts.speech, voice: plain, provider: "voxcpm", boost: 0.1, speed: 1, refHash: "", filter: oldFilter, language: "en", emotion: "korkmus", description: voxcpmDescription(plain) ?? "", directions: ["whispering"] }))
      .digest("hex")
      .slice(0, 32);
    const k = lineKeys(parts);
    assert.equal(k.take, oldKey);
    assert.notEqual(k.cache, oldKey);
    assert.match(k.cache, /^[0-9a-f]{32}$/);
    assert.ok(TRIM_SPEC.startsWith("node-trim-v1:"));
    // A Turkish Chatterbox line (no language/emotion fields) keeps the same rule.
    const tr: LineKeyParts = { ...parts, provider: "chatterbox", language: "tr", refHash: "abc" };
    const oldTr = createHash("sha256").update(JSON.stringify({ v: 1, model: tr.model, speech: tr.speech, voice: plain, provider: "chatterbox", boost: 0.1, speed: 1, refHash: "abc", filter: oldFilter })).digest("hex").slice(0, 32);
    assert.equal(lineKeys(tr).take, oldTr);
    assert.notEqual(lineKeys(tr).cache, oldTr);
    assert.notEqual(lineKeys({ ...tr, speed: 0.95 }).cache, lineKeys(tr).cache);
    // A vibrato voice's take key is its old key too (the old chain had the vibrato without its pre-roll).
    const old = { ...tr, voice: shifted };
    const oldVib = createHash("sha256").update(JSON.stringify({ v: 1, model: tr.model, speech: tr.speech, voice: shifted, provider: "chatterbox", boost: 0.1, speed: 1, refHash: "abc", filter: `${LEGACY_TRIM_FILTER},rubberband=pitch=0.86554:tempo=0.9200,vibrato=f=5.5:d=0.06,loudnorm=I=-18:TP=-2:LRA=9,aresample=48000,adelay=40,apad=pad_dur=0.04` })).digest("hex").slice(0, 32);
    assert.equal(lineKeys(old).take, oldVib);
    assert.notEqual(lineKeys(old).cache, oldVib);
  });

  loadV3Settings();
  const base = resolveV3Paths();
  const dir = mkdtempSync(path.join(os.tmpdir(), "v3-tts-"));
  const paths = { ffmpeg: base.ffmpeg, asciiTemp: dir };
  const legacy = async (raw: string, out: string, voice: VoiceProfile) =>
    runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", raw, "-af", `${LEGACY_TRIM_FILTER},${postProcessFilter(voice, 1)}`, "-ac", "1", "-c:a", "pcm_s16le", out]);
  try {
    let oldTicks = 0;
    for (const [name, rate, x] of [
      ["voice 24 kHz", 24_000, take(24_000, 0.4, 2.5, 0.5)],
      ["voice 48 kHz", 48_000, take(48_000, 0.25, 1.8, 0.35)],
      ["300 Hz sine", 48_000, Float32Array.from({ length: 48_000 * 2 }, (_, i) => (i > 24_000 && i < 72_000 ? 0.3 * Math.sin((2 * Math.PI * 300 * i) / 48_000) : 0))],
    ] as const) {
      for (const voice of [plain, shifted]) {
        await scenario(`FFmpeg: ${name}${voice === shifted ? " (pitch, tempo, vibrato)" : ""} — 0 ticks, length kept, ends faded`, async () => {
          const raw = path.join(dir, "raw.wav"), out = path.join(dir, "new.wav"), old = path.join(dir, "old.wav");
          writeFileSync(raw, wav16(x, rate));
          await legacy(raw, old, voice);
          await postProcessLine(paths, raw, out, voice, 1);
          const before = readWavPcm16(readFileSync(old));
          const after = readWavPcm16(readFileSync(out));
          oldTicks += ticks(before.samples, before.sampleRate).length;
          assert.equal(after.sampleRate, 48_000);
          assert.deepEqual(ticks(after.samples, 48_000), []);
          assert.ok(stuckSeconds(readFileSync(out)) <= STUCK_MAX_S);
          // Same length as the old processing within a few hundredths (lip sync is timed on these clips).
          const dOld = before.samples.length / 48_000, dNew = after.samples.length / 48_000;
          assert.ok(Math.abs(dNew - dOld) < 0.03, `length ${dNew} vs ${dOld}`);
          // 40 ms of digital air, then a fade: quiet for the first half millisecond, rising well below the level 10 ms on.
          let first = 0;
          while (first < after.samples.length && after.samples[first] === 0) first++;
          let last = after.samples.length - 1;
          while (last > 0 && after.samples[last] === 0) last--;
          assert.ok(first >= 0.035 * 48_000 && after.samples.length - 1 - last >= 0.035 * 48_000, `air ${first} / ${after.samples.length - 1 - last}`);
          const peak = (a: number, b: number) => after.samples.slice(a, b).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
          assert.ok(peak(first, first + 24) < 0.01 && peak(last - 23, last + 1) < 0.01, "no step at the ends");
          assert.ok(peak(first, first + 96) < 0.5 * peak(first + 480, first + 1440) && peak(last - 95, last + 1) < 0.5 * peak(last - 1920, last - 960), "ends faded");
          assert.ok(peak(first, last) > 0.1, "the voice is there, level-matched");
        });
      }
    }
    await scenario("FFmpeg: a vibrato voice opens cleanly every time (8 runs of the same take)", async () => {
      const raw = path.join(dir, "raw.wav");
      writeFileSync(raw, wav16(take(48_000, 0.25, 1.8, 0.35), 48_000));
      for (let k = 0; k < 8; k++) {
        const out = path.join(dir, `vib-${k}.wav`);
        await postProcessLine(paths, raw, out, shifted, 1);
        const { samples } = readWavPcm16(readFileSync(out));
        assert.deepEqual(ticks(samples, 48_000), [], `run ${k}`);
        assert.ok(samples.slice(0, 2400).every((v) => Math.abs(v) < 0.05), `run ${k}: burst at the start`);
      }
    });
    await scenario("the old silenceremove trim did tick on the same takes (the measurement sees it)", () => {
      // The sine (the case measured on 12 Nov) ticks at both trim junctions; the noisy takes hide the drop from the measure.
      assert.ok(oldTicks >= 2, `old ticks ${oldTicks}`);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`V3 tts smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
