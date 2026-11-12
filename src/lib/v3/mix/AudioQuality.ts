import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";

/**
 * The sound brain's ear: measured, never guessed (owner, 26 Oct 2026, on the Kosovo 1389 video: "arka planda savaş
 * borazanı falan kötü bir cızırtı yapıyor"). The local generators leave a whine at fixed frequencies that does not
 * follow the music: ACE-Step turbo left 4–71 narrow lines between 4 and 18 kHz in every Kosovo bed (5.93, 7.93, 11.8 and
 * 17.75 kHz in several of them), MOSS-SoundEffect a +23 dB line at 16 kHz on the sword clash. The reference documentary
 * (DFT Tarih, R20LHhaJhO8, ten minutes) has none: real instruments change pitch, so above 4 kHz their long-term
 * spectrum is smooth. A line counts only when it stands out in the whole file and in most of its quarters (a held note
 * moves on; an artifact stays), and is cut with a narrow notch down to its neighbours.
 */
export const LINE_MIN_HZ = 4000;
export const LINE_MAX_HZ = 18000;
/** How far a line stands over the median of its ±470 Hz neighbourhood in the long-term spectrum. */
export const LINE_PROMINENCE_DB = 8;
/** In each quarter a fixed line still stands this far out. */
export const QUARTER_PROMINENCE_DB = 5;
/** A line this far under the file's loudest band is not counted. */
export const AUDIBLE_RANGE_DB = 70;
/** Generated sound above this is whine and aliasing, not air (the reference is −36 dB there). */
export const CLEAN_LOWPASS_HZ = 16_000;
/** At most this many notches per file (the strongest lines; a shift-1.0 bed had 49 lines). */
export const MAX_NOTCHES = 60;

export interface WhineLine {
  readonly hz: number;
  /** Height over its neighbourhood in the long-term spectrum, dB. */
  readonly db: number;
}

const FFT_N = 4096;

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    const wr = Math.cos(a);
    const wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k;
        const q = p + len / 2;
        const vr = re[q]! * cr - im[q]! * ci;
        const vi = re[q]! * ci + im[q]! * cr;
        re[q] = re[p]! - vr;
        im[q] = im[p]! - vi;
        re[p] = re[p]! + vr;
        im[p] = im[p]! + vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Long-term average power spectrum (Hann, 4096, half overlap) of `samples[from, to)` in dB; silent frames skipped. */
export function averageSpectrumDb(samples: Float32Array, from = 0, to = samples.length): Float64Array {
  const hann = Float64Array.from({ length: FFT_N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_N - 1)));
  const sum = new Float64Array(FFT_N / 2);
  let frames = 0;
  for (let off = from; off + FFT_N <= to; off += FFT_N / 2) {
    const re = new Float64Array(FFT_N);
    const im = new Float64Array(FFT_N);
    let energy = 0;
    for (let i = 0; i < FFT_N; i++) {
      const v = samples[off + i]!;
      energy += v * v;
      re[i] = v * hann[i]!;
    }
    // Under −70 dBFS: silence carries no spectrum worth averaging.
    if (energy / FFT_N < 1e-7) continue;
    fft(re, im);
    for (let k = 0; k < FFT_N / 2; k++) sum[k] += re[k]! * re[k]! + im[k]! * im[k]!;
    frames++;
  }
  return sum.map((v) => 10 * Math.log10((frames ? v / frames : 0) + 1e-30));
}

const NEIGHBOURS = 40;

function prominence(spec: Float64Array, k: number): number {
  const around = Array.from(spec.subarray(Math.max(0, k - NEIGHBOURS), k + NEIGHBOURS + 1)).sort((a, b) => a - b);
  return spec[k]! - around[Math.floor(around.length / 2)]!;
}

/**
 * Narrow lines between `minHz` and `maxHz` that stand LINE_PROMINENCE_DB over their neighbourhood in the whole file and
 * QUARTER_PROMINENCE_DB in at least three of its four quarters; strongest first.
 */
export function whineLines(samples: Float32Array, rate: number, opts: { minHz?: number; maxHz?: number } = {}): WhineLine[] {
  const binHz = rate / FFT_N;
  const lo = Math.max(NEIGHBOURS + 1, Math.round((opts.minHz ?? LINE_MIN_HZ) / binHz));
  const hi = Math.min(FFT_N / 2 - NEIGHBOURS - 1, Math.round(Math.min(opts.maxHz ?? LINE_MAX_HZ, rate / 2) / binHz));
  if (samples.length < FFT_N * 2 || hi <= lo) return [];
  const whole = averageSpectrumDb(samples);
  const q = Math.floor(samples.length / 4);
  // A quarter shorter than two frames says nothing about steadiness: then the whole file decides alone.
  const quarters = q >= FFT_N * 2 ? [0, 1, 2, 3].map((i) => averageSpectrumDb(samples, i * q, (i + 1) * q)) : [];
  // Peaks far under the loudest band are noise of a short file, not something anyone hears (a synthesised drum
  // low-passed at 2.5 kHz showed four "lines" at −90 dB).
  const floor = Math.max(...whole) - AUDIBLE_RANGE_DB;
  const out: WhineLine[] = [];
  for (let k = lo; k <= hi; k++) {
    if (whole[k]! < floor || whole[k]! < whole[k - 1]! || whole[k]! < whole[k + 1]!) continue;
    const db = prominence(whole, k);
    if (db <= LINE_PROMINENCE_DB) continue;
    // Within ±2 bins the quarter's own peak counts (a line may sit one bin over in a shorter average).
    const steady = quarters.filter((s) => Math.max(...[-2, -1, 0, 1, 2].map((d) => prominence(s, k + d))) > QUARTER_PROMINENCE_DB).length;
    if (quarters.length && steady < 3) continue;
    out.push({ hz: Math.round(k * binHz), db: Math.round(db * 10) / 10 });
  }
  return out.sort((a, b) => b.db - a.db);
}

/**
 * The FFmpeg chain that takes the lines out: a narrow cut down to the neighbourhood at each (the strongest
 * MAX_NOTCHES), and a low-pass at CLEAN_LOWPASS_HZ. Empty when there is nothing to cut and no low-pass is asked.
 */
export function cleanupFilter(lines: readonly WhineLine[], opts: { lowpass?: boolean } = {}): string {
  const notches = lines.slice(0, MAX_NOTCHES).map((l) => `equalizer=f=${l.hz}:t=h:w=60:g=-${Math.min(30, Math.ceil(l.db + 2))}`);
  return [...notches, ...(opts.lowpass === false ? [] : [`lowpass=f=${CLEAN_LOWPASS_HZ}:p=2`, `lowpass=f=${CLEAN_LOWPASS_HZ}:p=2`])].join(",");
}

/** A file as mono floats at `rate` (FFmpeg decodes anything; raw floats go through a temp file). */
export async function decodeMono(paths: Pick<V3Paths, "ffmpeg" | "asciiTemp">, file: string, rate = 48_000): Promise<Float32Array> {
  await fs.mkdir(paths.asciiTemp, { recursive: true });
  const raw = path.join(paths.asciiTemp, `ses-olcum-${randomUUID()}.f32`);
  try {
    await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", file, "-ac", "1", "-ar", String(rate), "-f", "f32le", raw], { timeoutMs: 10 * 60_000 });
    const buf = await fs.readFile(raw);
    return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + (buf.byteLength & ~3)));
  } finally {
    await fs.rm(raw, { force: true });
  }
}

/** The whine lines of a file (generated pieces: 4–18 kHz; effects: from `minHz`). */
export async function measureWhine(paths: Pick<V3Paths, "ffmpeg" | "asciiTemp">, file: string, opts: { minHz?: number } = {}): Promise<WhineLine[]> {
  return whineLines(await decodeMono(paths, file), 48_000, opts);
}

/** Rounds of measure → cut: a cut line lowers its neighbourhood, so a weaker one beside it may stand out next. */
export const CLEAN_ROUNDS = 3;

export interface CleanResult {
  readonly file: string;
  readonly before: readonly WhineLine[];
  readonly after: readonly WhineLine[];
}

/**
 * Writes `src` to `out` (with `outArgs`, e.g. mono 16-bit for an effect) without its whine lines: every round cuts what
 * the last measurement still found, always from the original, at most CLEAN_ROUNDS times; the low-pass always applies.
 */
export async function cleanAudioFile(paths: Pick<V3Paths, "ffmpeg" | "asciiTemp">, src: string, out: string, opts: { minHz?: number; outArgs: readonly string[] }): Promise<CleanResult> {
  const before = await measureWhine(paths, src, opts);
  let cut: WhineLine[] = [];
  let after = before;
  for (let round = 0; round < CLEAN_ROUNDS && (round === 0 || after.length); round++) {
    cut = [...cut, ...after];
    await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", src, "-af", cleanupFilter(cut), ...opts.outArgs, out], { timeoutMs: 10 * 60_000 });
    after = await measureWhine(paths, out, opts);
  }
  return { file: out, before, after };
}

/** One line for reports: "3 çizgi (16,0 kHz +20 dB, …)". */
export function whineLine(lines: readonly WhineLine[]): string {
  if (!lines.length) return "sabit tiz çizgi yok";
  return `${lines.length} sabit tiz çizgi (${lines
    .slice(0, 4)
    .map((l) => `${(l.hz / 1000).toFixed(1).replace(".", ",")} kHz +${Math.round(l.db)} dB`)
    .join(", ")}${lines.length > 4 ? ", …" : ""})`;
}

/** A stretch of the mix that is a stuck signal or a drone, not sound (start/end in seconds, its level and crest). */
export interface BrokenStretch {
  readonly start: number;
  readonly end: number;
  readonly rmsDb: number;
  readonly crestDb: number;
}

/** Windows of this length are measured; a broken stretch is at least BROKEN_MIN_S long. */
export const BROKEN_WINDOW_S = 0.25;
export const BROKEN_MIN_S = 1;
/** Peak over RMS of a window: speech, music and effects stay far above this; a sine is 3 dB, DC or a clipped drone 0–2. */
export const BROKEN_CREST_DB = 4;
/** Only loud windows count (a quiet hum under the narration is the whine check's business). */
export const BROKEN_MIN_RMS_DB = -20;

/**
 * The ear's check before delivery (Guadalcanal, 12 Nov 2026): a voiced line that came back as a full-scale constant
 * became 3.5 s of a loud low roar with a click at each end, 12 dB over the rest of the mix, and the delivery checks
 * passed it (loudness and whine were fine). Loud windows whose peak hardly rises over their RMS, for a second or more.
 */
export function brokenStretches(samples: Float32Array, rate: number): BrokenStretch[] {
  const win = Math.max(1, Math.round(rate * BROKEN_WINDOW_S));
  const out: BrokenStretch[] = [];
  let run: { from: number; rms: number[]; crest: number[] } | undefined;
  const close = (at: number) => {
    if (run && (at - run.from) * BROKEN_WINDOW_S >= BROKEN_MIN_S) {
      out.push({ start: run.from * BROKEN_WINDOW_S, end: at * BROKEN_WINDOW_S, rmsDb: Math.max(...run.rms), crestDb: Math.min(...run.crest) });
    }
    run = undefined;
  };
  const n = Math.floor(samples.length / win);
  for (let w = 0; w < n; w++) {
    let sq = 0, peak = 0;
    for (let i = w * win; i < (w + 1) * win; i++) {
      const x = samples[i]!;
      sq += x * x;
      if (Math.abs(x) > peak) peak = Math.abs(x);
    }
    const rms = Math.sqrt(sq / win);
    const rmsDb = 20 * Math.log10(Math.max(rms, 1e-9));
    const crestDb = 20 * Math.log10(Math.max(peak, 1e-9) / Math.max(rms, 1e-9));
    if (rmsDb >= BROKEN_MIN_RMS_DB && crestDb < BROKEN_CREST_DB) {
      run ??= { from: w, rms: [], crest: [] };
      run.rms.push(rmsDb);
      run.crest.push(crestDb);
    } else close(w);
  }
  close(n);
  return out;
}

/** The broken stretches of a file (the mix before delivery). */
export async function measureBroken(paths: Pick<V3Paths, "ffmpeg" | "asciiTemp">, file: string): Promise<BrokenStretch[]> {
  return brokenStretches(await decodeMono(paths, file), 48_000);
}

/**
 * Ticks in the voiced lines (owner, 12 Nov 2026, on the Guadalcanal Short: "arkada bazı yerlerde cızıltı duyuyorum …
 * sonraki videolarda olmasın"). Measured, two kinds, both made by the voice clips' post-processing and not by the voice:
 * - "dusme": FFmpeg's silenceremove with start_silence puts one sample at 0 where the kept silence meets the sound
 *   (FFmpeg 9, reproduced on a plain sine; Tts.postProcessFilter uses it at both ends), so about 80 ms into a line and
 *   100 ms before its end one sample falls out of the voice (the loudness pass after it smears the zero into a dip);
 * - "kenar": a clip that starts or stops loud right next to digital silence (the trim cut mid-sound, the loudness pass
 *   raised it), heard as a tick in the pause after the line.
 * Guadalcanal: 17 ticks in 12 of 18 lines (drops up to −19 dBFS, a line opening at −6 dBFS within half a millisecond);
 * Taranto 20 in 15 of 23 lines, Çanakkale 24 in 19 of 25. A drop is a sample at least GLITCH_MIN off the line through its two
 * neighbours and towards zero, the neighbours agreeing with each other and the waveform around it smooth (the drop
 * GLITCH_RATIO times the local median step): a gunshot's crack or a sibilant moves its neighbours too and is not one
 * (in 66 lines of three videos every drop found sat at a trim junction).
 */
export const GLITCH_MIN = 0.01;
export const GLITCH_RATIO = 6;
/** Sound reaching −40 dBFS within half a millisecond of digital silence is heard as a tick. */
export const EDGE_STEP_MIN = 0.01;
export const EDGE_WINDOW_S = 0.0005;
/** Digital silence is at least this long: speech touches zero on its way through, never for a millisecond. */
export const EDGE_SILENCE_S = 0.001;
/** Fades at a voiced line's ends (inside the trim's kept quiet, so no word is touched) and at an effect's ends. */
export const LINE_FADE_IN_S = 0.01;
export const LINE_FADE_OUT_S = 0.02;
export const EFFECT_FADE_IN_S = 0.002;
export const EFFECT_FADE_OUT_S = 0.01;

export interface Tick {
  /** Seconds into the signal. */
  readonly t: number;
  readonly kind: "dusme" | "kenar";
  /** How far the sample is off (a drop) or how big the step is (an edge), dBFS. */
  readonly db: number;
}

const GLITCH_SPAN = 16;
/** Samples redrawn on each side of a drop (declickClip). */
const GLITCH_FIX = 3;

function isDrop(x: Float32Array, i: number): number {
  const a = x[i - 1]!, b = x[i + 1]!, v = x[i]!;
  const mid = (a + b) / 2;
  const dev = Math.abs(v - mid);
  if (dev < GLITCH_MIN || a * b <= 0 || Math.abs(v) >= Math.abs(mid) || Math.abs(b - a) > dev) return 0;
  const steps: number[] = [];
  for (let j = Math.max(1, i - GLITCH_SPAN); j <= Math.min(x.length - 1, i + GLITCH_SPAN); j++) if (j !== i && j !== i + 1) steps.push(Math.abs(x[j]! - x[j - 1]!));
  steps.sort((p, q) => p - q);
  return dev > GLITCH_RATIO * (steps[steps.length >> 1] ?? 0) ? dev : 0;
}

/** The ticks of a signal (a voiced line, the dialogue of a mix), in time order. */
export function ticks(samples: Float32Array, rate: number): Tick[] {
  const out: Tick[] = [];
  const db = (v: number) => Math.round(20 * Math.log10(Math.max(v, 1e-9)));
  // Silence is EDGE_SILENCE_S of zero samples (or the signal's own end); a wave touching zero on its way is not.
  const silent = (i: number) => i < 0 || i >= samples.length || samples[i] === 0;
  const quiet = Math.max(2, Math.round(EDGE_SILENCE_S * rate));
  const silenceFrom = (i: number, dir: 1 | -1) => {
    for (let k = 0; k < quiet; k++) {
      const j = i + dir * k;
      if (j < 0 || j >= samples.length) return true;
      if (samples[j] !== 0) return false;
    }
    return true;
  };
  const w = Math.max(1, Math.round(EDGE_WINDOW_S * rate));
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    if (v === 0 && silent(i - 1)) continue;
    const onset = v !== 0 && silent(i - 1) && silenceFrom(i - 1, -1);
    const offset = v !== 0 && silent(i + 1) && silenceFrom(i + 1, 1);
    if (onset || offset) {
      // The level reached within EDGE_WINDOW_S of the silence: a fade takes far longer to get there.
      let level = 0;
      for (let k = 0; k < w; k++) {
        const j = onset ? i + k : i - k;
        if (silent(j) && k > 0) break;
        level = Math.max(level, Math.abs(samples[j]!));
      }
      if (level >= EDGE_STEP_MIN) out.push({ t: i / rate, kind: "kenar", db: db(level) });
    } else if (i > 0 && i < samples.length - 1) {
      const dev = isDrop(samples, i);
      if (dev) out.push({ t: i / rate, kind: "dusme", db: db(dev) });
    }
  }
  return out;
}

/**
 * A voiced line made safe to place (Mixer.renderMix): every dropped sample is put back on the line through its
 * neighbours, and the sound fades in over `fadeIn` s from its first non-zero sample and out over `fadeOut` s to its last,
 * so it never steps out of or into silence. A copy; the clip file is left as it is (the TTS cache keeps its takes).
 */
export function declickClip(samples: Float32Array, rate: number, fadeIn = LINE_FADE_IN_S, fadeOut = LINE_FADE_OUT_S): { samples: Float32Array; repaired: number } {
  const x = Float32Array.from(samples);
  let repaired = 0;
  // The loudness pass after the trim rings around the dropped sample, so a few samples on both sides are drawn again
  // on the straight line between their outer neighbours (a seventh of a millisecond: under any vowel's period); a drop
  // smeared wider shows again once its middle is back, so a few passes until none is left.
  for (let pass = 0, found = 1; pass < 4 && found; pass++) {
    found = 0;
    for (let i = 1; i < x.length - 1; i++) {
      if (!isDrop(x, i)) continue;
      const from = Math.max(0, i - GLITCH_FIX - 1), to = Math.min(x.length - 1, i + GLITCH_FIX + 1);
      for (let j = from + 1; j < to; j++) x[j] = x[from]! + ((x[to]! - x[from]!) * (j - from)) / (to - from);
      found++;
      i = to;
    }
    repaired += found;
  }
  return { samples: fadeClipEdges(x, rate, fadeIn, fadeOut), repaired };
}

/** `samples` (a copy) faded in from its first non-zero sample and out to its last, raised-cosine. */
export function fadeClipEdges(samples: Float32Array, rate: number, fadeIn: number, fadeOut: number): Float32Array {
  const x = Float32Array.from(samples);
  let first = 0;
  while (first < x.length && x[first] === 0) first++;
  let last = x.length - 1;
  while (last > first && x[last] === 0) last--;
  if (first >= x.length) return x;
  const span = last - first + 1;
  const nIn = Math.min(Math.round(fadeIn * rate), Math.floor(span / 2));
  const nOut = Math.min(Math.round(fadeOut * rate), Math.floor(span / 2));
  for (let k = 0; k < nIn; k++) x[first + k]! *= 0.5 - 0.5 * Math.cos((Math.PI * k) / nIn);
  for (let k = 0; k < nOut; k++) x[last - k]! *= 0.5 - 0.5 * Math.cos((Math.PI * k) / nOut);
  return x;
}
