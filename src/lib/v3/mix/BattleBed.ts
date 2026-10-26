import { createHash } from "node:crypto";
import { existsSync, readdirSync, promises as fs } from "node:fs";
import path from "node:path";
import type { Episode } from "../episode/EpisodeTypes";
import { eraOf } from "../episode/Period";
import { readWavPcm16 } from "../lipsync/LipSync";
import type { EpisodeTimeline } from "../timeline/Timeline";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";

/**
 * The sound of a battle (owner, 26 Oct 2026, after the Kosovo video: one clash "sounds like a hammer, not a sword, and
 * is not what a mass battle sounds like — many swords and men shouting in the background"): while the tokens fight on
 * the map, or a crowd charges on the stage, a bed of real recordings plays under the narration — swords clashing at
 * random from many recorded hits, men's efforts and cries now and then, and the roar of a distant crowd. All CC0, built
 * into the SFX library by scripts/v3/sfx-savas.ts. Swords belong to battles before the machine gun: a modern-era
 * episode gets no bed (no gunfire recordings yet).
 */
export const SAMPLE_RATE = 48_000;
/** Loudness of the bed while it plays (between the music's −26 and the ambience's −38, before the final pass). */
export const BATTLE_LUFS = -27;
/** Fade into and out of a battle. */
export const BATTLE_FADE_IN_S = 1.5;
export const BATTLE_FADE_OUT_S = 2.5;
/** Clashes per second in a close fight and on a distant battle marker. */
export const CLASHES_PER_S = { yakin: 4, uzak: 1.5 } as const;
/** Men's cries and efforts per second. */
export const CRIES_PER_S = { yakin: 0.7, uzak: 0.2 } as const;

/** A recorded hit from a longer take: where it starts and ends (samples). */
export interface Hit {
  readonly from: number;
  readonly to: number;
  /** Its loudest 10 ms, dB. */
  readonly peakDb: number;
}

/**
 * The separate hits of a take of many (a library's "Sabre on Norse Sword, blade on blade" holds 9–30 of them): a hit
 * starts where the 10 ms level jumps 25 dB over the quiet before it after at least 150 ms of quiet, and lasts until the
 * next one or at most `maxS`, its quiet tail cut at −50 dB under its peak.
 */
export function splitHits(samples: Float32Array, rate: number, maxS = 1.2): Hit[] {
  const win = Math.max(1, Math.round(rate * 0.01));
  const env: number[] = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += samples[j]! * samples[j]!;
    env.push(10 * Math.log10(sum / win + 1e-12));
  }
  const floor = [...env].sort((a, b) => a - b)[Math.floor(env.length * 0.2)] ?? -120;
  const starts: number[] = [];
  // 10 ms windows of quiet before this one (a take may open on its first hit).
  let quiet = 15;
  for (let k = 0; k < env.length; k++) {
    if (env[k]! > floor + 25 && quiet >= 15) starts.push(k);
    quiet = env[k]! < floor + 12 ? quiet + 1 : 0;
  }
  return starts.map((k, n) => {
    const limit = Math.min(starts[n + 1] ?? env.length, k + Math.round(maxS / 0.01));
    const peakDb = Math.max(...env.slice(k, limit));
    let end = limit;
    while (end > k + 5 && env[end - 1]! < peakDb - 50) end--;
    return { from: Math.max(0, (k - 1) * win), to: Math.min(samples.length, end * win), peakDb };
  });
}

export interface BattleWindow {
  readonly start: number;
  readonly end: number;
  /** yakin: tokens fighting on a close map, a crowd charging; uzak: a battle marker on a wide map. */
  readonly kind: "yakin" | "uzak";
}

/**
 * Where a battle is heard: a close map from the line on which a side first loses tokens to the scene's end, a stage
 * from a crowd's charge to the scene's end, a wide map's battle marker for eight seconds from its line. Overlaps merge
 * (a close fight wins over a marker). None in a modern-era episode.
 */
export function battleWindows(episode: Pick<Episode, "donem" | "sahneler">, timeline: Pick<EpisodeTimeline, "scenes" | "lines">): BattleWindow[] {
  if (eraOf(episode.donem) === "modern") return [];
  const raw: BattleWindow[] = [];
  episode.sahneler.forEach((scene, si) => {
    const st = timeline.scenes.find((s) => s.sceneIndex === si);
    if (!st) return;
    const lineStart = (li: number) => timeline.lines.find((l) => l.sceneIndex === si && l.lineIndex === li)?.start;
    const lossLines = (scene.harita?.birlikler ?? []).flatMap((u) => u.yerler.filter((y) => (y.kayip ?? 0) > 0).map((y) => y.satir));
    const charge = (scene.kalabalik ?? []).flatMap((g) => (g.hareket?.tur === "hucum" ? [g.hareket.satir] : []));
    const first = Math.min(...lossLines, ...charge);
    const at = Number.isFinite(first) ? lineStart(first) : undefined;
    // The sides close in just before the first token falls.
    if (at !== undefined) raw.push({ start: Math.max(st.start, at - 1), end: st.end, kind: "yakin" });
    for (const w of scene.harita?.savaslar ?? []) {
      const t = lineStart(w.satir ?? 0);
      if (t !== undefined) raw.push({ start: t, end: Math.min(st.end, t + 8), kind: "uzak" });
    }
  });
  const merged: BattleWindow[] = [];
  for (const w of raw.sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end + 1) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, w.end), kind: last.kind === "yakin" || w.kind === "yakin" ? "yakin" : "uzak" };
    else merged.push(w);
  }
  return merged;
}

export interface BattleEvent {
  readonly t: number;
  readonly what: "kilic" | "nara";
  /** Which recording of its kind (an index; taken modulo the library's count). */
  readonly variant: number;
  readonly gain: number;
  /** −1 left … 1 right. */
  readonly pan: number;
}

/** A steady random sequence from a text (the same episode always gets the same battle). */
function random(seed: string): () => number {
  let h = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) || 1;
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1_000_000) / 1_000_000;
  };
}

/**
 * The clashes and cries of the windows, at random times (exponential gaps around the window's rate), quieter the
 * further off they are meant to be, spread left and right; nothing in a window's first half second of fade.
 */
export function battleEvents(windows: readonly BattleWindow[], seed: string): BattleEvent[] {
  const rnd = random(seed);
  const out: BattleEvent[] = [];
  for (const w of windows) {
    for (const [what, rate] of [["kilic", CLASHES_PER_S[w.kind]], ["nara", CRIES_PER_S[w.kind]]] as const) {
      let t = w.start + 0.5 + -Math.log(1 - rnd() * 0.999) / rate;
      while (t < w.end - 0.8) {
        const near = w.kind === "yakin" ? 0.35 + 0.65 * rnd() : 0.15 + 0.3 * rnd();
        out.push({ t, what, variant: Math.floor(rnd() * 1000), gain: (what === "kilic" ? 0.7 : 0.45) * near, pan: rnd() * 1.6 - 0.8 });
        t += -Math.log(1 - rnd() * 0.999) / rate;
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** The gain of a window at time `t` (fades at both ends; 0 outside), uzak at half level. */
export function windowGain(windows: readonly BattleWindow[], t: number): number {
  for (const w of windows) {
    if (t < w.start || t > w.end) continue;
    const g = Math.min(1, (t - w.start) / BATTLE_FADE_IN_S, (w.end - t) / BATTLE_FADE_OUT_S);
    return Math.max(0, g) * (w.kind === "yakin" ? 1 : 0.5);
  }
  return 0;
}

/** The library's recordings for the bed (empty lists when sfx-savas.ts has not been run). */
export function battleLibrary(sfxDir: string): { kilic: string[]; nara: string[]; ugultu?: string } {
  const list = (dir: string, re: RegExp) => (existsSync(dir) ? readdirSync(dir).filter((n) => re.test(n)).sort().map((n) => path.join(dir, n)) : []);
  const ugultu = list(path.join(sfxDir, "crowd"), /^atolye-v3-savas-ugultu-[a-z]+\.wav$/)[0];
  return { kilic: list(path.join(sfxDir, "battle"), /^atolye-v3-kilic-[a-z]+-\d{2}\.wav$/), nara: list(path.join(sfxDir, "battle"), /^atolye-v3-nara-[a-z]+-\d{2}\.wav$/), ...(ugultu ? { ugultu } : {}) };
}

function wavStereoFloat(left: Float32Array, right: Float32Array): Buffer {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 8);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + n * 8, 4);
  buf.write("WAVEfmt ", 8, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 8, 28);
  buf.writeUInt16LE(8, 32);
  buf.writeUInt16LE(32, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) {
    buf.writeFloatLE(left[i]!, 44 + i * 8);
    buf.writeFloatLE(right[i]!, 48 + i * 8);
  }
  return buf;
}

export interface BattleBedResult {
  readonly file: string;
  readonly windows: readonly BattleWindow[];
  readonly clashes: number;
  readonly cries: number;
}

/**
 * The bed as one stereo file as long as the episode (silent outside the windows), brought to BATTLE_LUFS while it
 * plays; undefined when there is no battle or the library has no sword recordings.
 */
export async function renderBattleBed(paths: Pick<V3Paths, "ffmpeg" | "asciiTemp">, sfxDir: string, windows: readonly BattleWindow[], duration: number, seed: string, out: string): Promise<BattleBedResult | undefined> {
  const lib = battleLibrary(sfxDir);
  if (!windows.length || !lib.kilic.length) return undefined;
  const total = Math.ceil(duration * SAMPLE_RATE);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const load = async (f: string) => readWavPcm16(await fs.readFile(f)).samples;
  const swords = await Promise.all(lib.kilic.map(load));
  const cries = await Promise.all(lib.nara.map(load));
  const events = battleEvents(windows, seed);
  for (const e of events) {
    const pool = e.what === "kilic" ? swords : cries;
    if (!pool.length) continue;
    const src = pool[e.variant % pool.length]!;
    const off = Math.round(e.t * SAMPLE_RATE);
    const g = e.gain * windowGain(windows, e.t);
    // Constant-power pan.
    const a = ((e.pan + 1) * Math.PI) / 4;
    const gl = g * Math.cos(a);
    const gr = g * Math.sin(a);
    for (let i = 0; i < src.length && off + i < total; i++) {
      left[off + i] += src[i]! * gl;
      right[off + i] += src[i]! * gr;
    }
  }
  // The distant roar: looped through each window, its two halves a little apart so it sounds wide.
  if (lib.ugultu) {
    const roar = await load(lib.ugultu);
    const shift = Math.floor(roar.length / 2);
    for (const w of windows) {
      for (let i = Math.floor(w.start * SAMPLE_RATE); i < Math.min(total, Math.ceil(w.end * SAMPLE_RATE)); i++) {
        const g = 0.55 * windowGain(windows, i / SAMPLE_RATE);
        left[i] += roar[i % roar.length]! * g;
        right[i] += roar[(i + shift) % roar.length]! * g;
      }
    }
  }
  await fs.mkdir(paths.asciiTemp, { recursive: true });
  const raw = path.join(paths.asciiTemp, `savas-ham-${path.basename(out)}`);
  await fs.writeFile(raw, wavStereoFloat(left, right));
  // Silence outside the windows is gated out of the measurement: the level is the battle's own.
  const target = `I=${BATTLE_LUFS}:TP=-6:LRA=15`;
  const pass1 = await runChecked(paths.ffmpeg, ["-hide_banner", "-nostats", "-i", raw, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"]);
  const m = /\{[\s\S]*"input_i"[\s\S]*?\}/.exec(pass1.stderr);
  const s = m ? (JSON.parse(m[0]) as Record<string, string>) : undefined;
  const norm = s ? `loudnorm=${target}:measured_I=${s.input_i}:measured_TP=${s.input_tp}:measured_LRA=${s.input_lra}:measured_thresh=${s.input_thresh}:offset=${s.target_offset}:linear=true` : `loudnorm=${target}`;
  await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", raw, "-af", `${norm},aresample=${SAMPLE_RATE}`, "-c:a", "pcm_f32le", out], { timeoutMs: 10 * 60_000 });
  await fs.rm(raw, { force: true });
  return { file: out, windows, clashes: events.filter((e) => e.what === "kilic").length, cries: events.filter((e) => e.what === "nara").length };
}
