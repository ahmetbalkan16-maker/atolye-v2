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
