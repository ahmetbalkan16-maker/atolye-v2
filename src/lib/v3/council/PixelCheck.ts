import { spawn } from "node:child_process";

/**
 * The quality brain's pixel check: every frame of the finished video, shrunk to PIXEL_W × PIXEL_H, measured for the two
 * pixel faults of the quality exam (2 Nov 2026) — a dark band down an edge where the picture does not fill the frame
 * (a shot sliding in) and a moment of land painted as sea (a terrain picture not loaded on a render piece's first
 * frames). Both are counted, not seen: no model, no GPU.
 */
export const PIXEL_W = 160;
export const PIXEL_H = 90;

export type Side = "sol" | "sag" | "ust" | "alt";

export interface PixelStats {
  /** Share of the frame in sea blue (the maps' OCEAN/OCEAN_DEEP, rivers). */
  readonly sea: number;
  /** Share of the frame near black. */
  readonly dark: number;
  /** A flat dark band along one edge, and how wide it is in output pixels. */
  readonly band?: { readonly side: Side; readonly px: number };
}

/** A frame line this dark and this flat is empty frame, not drawing (the empty frame's #15121c is luma ~20). */
const DARK_LINE = 32;
const FLAT_LINE = 10;
/** The band ends in a step up: a vignette or a night sky darkens gradually. */
const BAND_STEP = 28;
/** At least two lines (~24 output px). */
const MIN_BAND_LINES = 2;

const lumaOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
/** The maps' sea (#22406a, #172e4f) and rivers (#4f8cc2); a day sky is lighter and greyer. */
const seaLike = (r: number, g: number, b: number) => b > r + 30 && b > g + 15 && b >= 60 && r < 110;

/** One shrunk frame (RGB24, `w` × `h`) measured; `outW`/`outH`: the video's size, for the band's width. */
export function frameStats(rgb: Uint8Array, w = PIXEL_W, h = PIXEL_H, outW = 1920, outH = 1080): PixelStats {
  const luma = new Float32Array(w * h);
  let sea = 0;
  let dark = 0;
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = [rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!];
    const l = lumaOf(r, g, b);
    luma[i] = l;
    if (l < DARK_LINE) dark++;
    if (seaLike(r, g, b)) sea++;
  }
  // Mean and spread of the n-th column/row in from a side.
  const line = (side: Side, n: number) => {
    const across = side === "sol" || side === "sag" ? h : w;
    let sum = 0;
    let sq = 0;
    for (let j = 0; j < across; j++) {
      const v = side === "sol" ? luma[j * w + n]! : side === "sag" ? luma[j * w + (w - 1 - n)]! : side === "ust" ? luma[n * w + j]! : luma[(h - 1 - n) * w + j]!;
      sum += v;
      sq += v * v;
    }
    const mean = sum / across;
    return { mean, sd: Math.sqrt(Math.max(0, sq / across - mean * mean)) };
  };
  let band: PixelStats["band"];
  for (const side of ["sol", "sag", "ust", "alt"] as const) {
    const lines = side === "sol" || side === "sag" ? w : h;
    let n = 0;
    let sum = 0;
    for (; n < lines * 0.4; n++) {
      const l = line(side, n);
      if (l.mean >= DARK_LINE || l.sd >= FLAT_LINE) break;
      sum += l.mean;
    }
    // A frame dark nearly all over is no band (a night, a fade): the flash check sees a sudden one.
    if (n < MIN_BAND_LINES || n >= lines * 0.4) continue;
    if (line(side, n).mean < sum / n + BAND_STEP) continue;
    const px = Math.round((n * (side === "sol" || side === "sag" ? outW : outH)) / lines);
    if (!band || px > band.px) band = { side, px };
  }
  return { sea: sea / (w * h), dark: dark / (w * h), ...(band ? { band } : {}) };
}

/** Every frame of `video` (or of `from`–`to` seconds) at `fps`, measured. */
export async function scanVideo(ffmpeg: string, video: string, opts: { readonly fps: number; readonly width?: number; readonly height?: number; readonly from?: number; readonly to?: number }): Promise<{ t: number; s: PixelStats }[]> {
  const from = opts.from ?? 0;
  const args = ["-v", "error", ...(opts.from !== undefined ? ["-ss", from.toFixed(3)] : []), ...(opts.to !== undefined ? ["-t", (opts.to - from).toFixed(3)] : []), "-i", video, "-vf", `fps=${opts.fps},scale=${PIXEL_W}:${PIXEL_H}:flags=area,format=rgb24`, "-f", "rawvideo", "pipe:1"];
  const size = PIXEL_W * PIXEL_H * 3;
  const out: { t: number; s: PixelStats }[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let pending: Buffer = Buffer.alloc(0);
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, d]) : d;
      while (pending.length >= size) {
        out.push({ t: from + out.length / opts.fps, s: frameStats(pending.subarray(0, size), PIXEL_W, PIXEL_H, opts.width, opts.height) });
        pending = pending.subarray(size);
      }
    });
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`V3_PIXEL_SCAN: ffmpeg ${code}: ${err.slice(0, 200)}`))));
  });
  return out;
}

export interface PixelFault {
  readonly tur: "serit" | "zemin" | "karanlik";
  readonly from: number;
  readonly to: number;
  readonly ayrinti: string;
}

/** A band seen on fewer frames in a row is a single bad frame of a transition's blur. */
export const BAND_MIN_FRAMES = 2;
/** A sudden change of this share of the frame (sea or near black) that is gone again is a flash, not the story. */
export const FLASH_DELTA = 0.3;
/** Longer than this it is what the picture shows. */
export const FLASH_MAX_S = 0.6;

const SIDE_TR: Readonly<Record<Side, string>> = { sol: "sol", sag: "sağ", ust: "üst", alt: "alt" };

function median(values: number[]): number | undefined {
  if (values.length < 3) return undefined;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}

/**
 * The pixel faults of a scanned video: a dark band along an edge (BAND_MIN_FRAMES in a row), and a flash — sea or near
 * black jumping by FLASH_DELTA of the frame against both the second before and the second after, for at most
 * FLASH_MAX_S. `skip(t)`: moments that are dark or change by design (a white or ink transition, a full-screen word).
 */
export function pixelFaults(frames: readonly { t: number; s: PixelStats }[], skip?: (t: number) => boolean): PixelFault[] {
  const faults: PixelFault[] = [];
  const judged = frames.filter((f) => !skip?.(f.t));
  const step = frames.length > 1 ? frames[1]!.t - frames[0]!.t : 1 / 30;
  // Bands: runs of frames (in a row) with a band on the same side.
  let run: { t: number; side: Side; px: number }[] = [];
  const closeBand = () => {
    if (run.length >= BAND_MIN_FRAMES) faults.push({ tur: "serit", from: run[0]!.t, to: run[run.length - 1]!.t + step, ayrinti: `${SIDE_TR[run[0]!.side]} kenarda koyu şerit (${Math.max(...run.map((r) => r.px))} px, görüntü kareyi doldurmuyor)` });
    run = [];
  };
  for (const f of judged) {
    const b = f.s.band;
    const last = run[run.length - 1];
    if (!b || (last && (b.side !== last.side || f.t - last.t > step * 1.5))) closeBand();
    if (b) run.push({ t: f.t, side: b.side, px: b.px });
  }
  closeBand();
  // Flashes: each measure against the medians of [t−1.2, t−0.6] and [t+0.6, t+1.2] seconds.
  for (const key of ["sea", "dark"] as const) {
    let flash: { t: number; v: number; was: number }[] = [];
    const closeFlash = () => {
      if (flash.length && flash[flash.length - 1]!.t - flash[0]!.t + step <= FLASH_MAX_S) {
        const peak = flash.reduce((a, b) => (Math.abs(b.v - b.was) > Math.abs(a.v - a.was) ? b : a));
        const pct = (x: number) => `%${Math.round(x * 100)}`;
        faults.push({
          tur: key === "sea" ? "zemin" : "karanlik",
          from: flash[0]!.t,
          to: flash[flash.length - 1]!.t + step,
          ayrinti: key === "sea" ? (peak.v > peak.was ? `zemin bir an deniz rengine boyandı (deniz rengi ${pct(peak.was)} → ${pct(peak.v)})` : `deniz bir an başka renge boyandı (deniz rengi ${pct(peak.was)} → ${pct(peak.v)})`) : `görüntü bir an karardı (koyu alan ${pct(peak.was)} → ${pct(peak.v)})`,
        });
      }
      flash = [];
    };
    let lo = 0;
    for (let i = 0; i < judged.length; i++) {
      const f = judged[i]!;
      while (judged[lo]!.t < f.t - 1.2) lo++;
      const before: number[] = [];
      const after: number[] = [];
      for (let j = lo; j < judged.length && judged[j]!.t <= f.t + 1.2; j++) {
        const d = judged[j]!.t - f.t;
        if (d <= -0.6) before.push(judged[j]!.s[key]);
        else if (d >= 0.6) after.push(judged[j]!.s[key]);
      }
      const [mb, ma] = [median(before), median(after)];
      const v = f.s[key];
      const sudden = mb !== undefined && ma !== undefined && Math.sign(v - mb) === Math.sign(v - ma) && Math.min(Math.abs(v - mb), Math.abs(v - ma)) > FLASH_DELTA;
      const last = flash[flash.length - 1];
      if (!sudden || (last && f.t - last.t > step * 1.5)) closeFlash();
      if (sudden) flash.push({ t: f.t, v, was: (mb! + ma!) / 2 });
    }
    closeFlash();
  }
  return faults.sort((a, b) => a.from - b.from);
}
