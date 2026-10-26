import { createHash } from "node:crypto";
import { existsSync, readdirSync, promises as fs } from "node:fs";
import path from "node:path";
import type { Episode } from "../episode/EpisodeTypes";
import { type Arms, armsOf } from "../episode/Period";
import { readWavPcm16 } from "../lipsync/LipSync";
import type { EpisodeTimeline } from "../timeline/Timeline";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";

/**
 * The sound of a battle (owner, 26 Oct 2026, after the Kosovo video: one clash "sounds like a hammer, not a sword, and
 * is not what a mass battle sounds like — many swords and men shouting in the background"): while the tokens fight on
 * the map, or a crowd charges on the stage, a bed of real recordings plays under the narration, fought with the
 * weapons of its age (Period.armsOf; owner, same day: "top ve tüfek seslerini de bul, başka bir video yapıldığında
 * otomatik onu kullansın") — swords clashing at random from many recorded hits; from 1450 musket shots, volleys and
 * cannon among them; from 1900 rifles, machine-gun bursts, cannon and shell bursts and no swords — with men's efforts and
 * cries now and then and the roar of a distant crowd. Free recordings (CC0, U.S. public domain), built into the SFX
 * library by scripts/v3/sfx-savas.ts (swords, cries, roar) and scripts/v3/sfx-barut.ts (guns, cannon, shell bursts).
 */
export const SAMPLE_RATE = 48_000;
/** Loudness of the bed while it plays (between the music's −26 and the ambience's −38, before the final pass). */
export const BATTLE_LUFS = -27;
/** Fade into and out of a battle. */
export const BATTLE_FADE_IN_S = 1.5;
export const BATTLE_FADE_OUT_S = 2.5;

/** The recorded sounds of a bed: `battle/atolye-v3-<sound>-<source>-NN.wav` in the SFX library. */
export const BED_SOUNDS = ["kilic", "nara", "misket", "tufek", "makineli", "top_atisi", "patlama"] as const;
export type BedSound = (typeof BED_SOUNDS)[number];
/** A musket volley: a line of muskets firing together, played as this many musket shots within VOLLEY_SPREAD_S. */
export const VOLLEY_SHOTS = 8;
export const VOLLEY_SPREAD_S = 0.4;

/**
 * How many of each sound per second, by the weapons of the age, in a close fight and on a distant battle marker. The
 * sword age is the Kosovo bed the owner approved ("evet bu daha iyi olmuş"), unchanged; a gunpowder battle is mostly
 * gunfire with a few swords in the melee (owner, after the first gunpowder bed: "top ve tüfek sesleri az, çok kılıç sesi
 * var"); a modern battle has no swords at all.
 */
export const BED_RATES: Readonly<Record<Arms, Readonly<Record<BattleWindow["kind"], Readonly<Partial<Record<BedSound | "yaylim", number>>>>>>> = {
  kilic: { yakin: { kilic: 4, nara: 0.7 }, uzak: { kilic: 1.5, nara: 0.2 } },
  barut: { yakin: { kilic: 0.9, nara: 0.5, misket: 1.8, yaylim: 0.15, top_atisi: 0.3 }, uzak: { kilic: 0.2, nara: 0.12, misket: 0.9, yaylim: 0.1, top_atisi: 0.45 } },
  modern: { yakin: { tufek: 2, nara: 0.3, makineli: 0.3, top_atisi: 0.1, patlama: 0.12 }, uzak: { tufek: 0.8, nara: 0.1, makineli: 0.15, top_atisi: 0.2, patlama: 0.2 } },
};
/** Each sound's level in the bed before distance (the bed as a whole is brought to BATTLE_LUFS). */
const BED_GAIN: Readonly<Record<BedSound, number>> = { kilic: 0.7, nara: 0.45, misket: 0.5, tufek: 0.5, makineli: 0.45, top_atisi: 0.9, patlama: 0.8 };
/** The sounds without which an age has no bed (cries and the roar alone are no battle). */
const MAIN_SOUNDS: Readonly<Record<Arms, readonly BedSound[]>> = { kilic: ["kilic"], barut: ["kilic", "misket", "top_atisi"], modern: ["tufek", "makineli", "top_atisi"] };
/** The distant roar under a battle: quieter in a modern one (an assault's shout, not a melee). */
const ROAR_GAIN: Readonly<Record<Arms, number>> = { kilic: 0.55, barut: 0.55, modern: 0.35 };

/** A recorded hit from a longer take: where it starts and ends (samples). */
export interface Hit {
  readonly from: number;
  readonly to: number;
  /** Its loudest 10 ms, dB. */
  readonly peakDb: number;
}

/**
 * The separate hits of a take of many (a library's "Sabre on Norse Sword, blade on blade" holds 9–30 of them): a hit
 * starts where the 10 ms level jumps 25 dB over the quiet before it within 50 ms of at least 150 ms of quiet (the bolt of
 * an open-bolt gun slams 20–40 ms before its first shot), and lasts until the next one or at most `maxS`, its quiet tail
 * cut at −50 dB under its peak.
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
  // 10 ms windows of quiet before this one (a take may open on its first hit), and windows since such a quiet stretch
  // ended without a hit yet (−1: none open).
  let quiet = 15;
  let lead = -1;
  for (let k = 0; k < env.length; k++) {
    const still = env[k]! < floor + 12;
    if (!still && quiet >= 15) lead = 0;
    if (env[k]! > floor + 25 && lead >= 0 && lead < 5) {
      starts.push(k);
      lead = -1;
    } else if (lead >= 0) lead++;
    quiet = still ? quiet + 1 : 0;
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
 * (a close fight wins over a marker). None when the period has no year (its weapons are unknown).
 */
export function battleWindows(episode: Pick<Episode, "donem" | "sahneler">, timeline: Pick<EpisodeTimeline, "scenes" | "lines">): BattleWindow[] {
  if (!armsOf(episode.donem)) return [];
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
  readonly what: BedSound;
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
 * The sounds of the windows, at random times (exponential gaps around the age's rate for the window), quieter the
 * further off they are meant to be, spread left and right; nothing in a window's first half second of fade. A volley
 * is a line of muskets side by side, fired within VOLLEY_SPREAD_S.
 */
export function battleEvents(windows: readonly BattleWindow[], seed: string, arms: Arms = "kilic"): BattleEvent[] {
  const rnd = random(seed);
  const out: BattleEvent[] = [];
  for (const w of windows) {
    for (const [what, rate] of Object.entries(BED_RATES[arms][w.kind]) as [BedSound | "yaylim", number][]) {
      let t = w.start + 0.5 + -Math.log(1 - rnd() * 0.999) / rate;
      while (t < w.end - 0.8) {
        const near = w.kind === "yakin" ? 0.35 + 0.65 * rnd() : 0.15 + 0.3 * rnd();
        if (what === "yaylim") {
          const line = rnd() * 1.2 - 0.6;
          for (let i = 0; i < VOLLEY_SHOTS; i++) out.push({ t: t + rnd() * VOLLEY_SPREAD_S, what: "misket", variant: Math.floor(rnd() * 1000), gain: BED_GAIN.misket * 0.6 * near, pan: Math.max(-0.9, Math.min(0.9, line + rnd() * 0.5 - 0.25)) });
        } else out.push({ t, what, variant: Math.floor(rnd() * 1000), gain: BED_GAIN[what] * near, pan: rnd() * 1.6 - 0.8 });
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

/** The library's recordings for the bed (empty lists when sfx-savas.ts / sfx-barut.ts have not been run). */
export function battleLibrary(sfxDir: string): Record<BedSound, string[]> & { ugultu?: string } {
  const list = (dir: string, re: RegExp) => (existsSync(dir) ? readdirSync(dir).filter((n) => re.test(n)).sort().map((n) => path.join(dir, n)) : []);
  const ugultu = list(path.join(sfxDir, "crowd"), /^atolye-v3-savas-ugultu-[a-z]+\.wav$/)[0];
  const sounds = Object.fromEntries(BED_SOUNDS.map((s) => [s, list(path.join(sfxDir, "battle"), new RegExp(`^atolye-v3-${s}-[a-z]+-\\d{2}\\.wav$`))])) as Record<BedSound, string[]>;
  return { ...sounds, ...(ugultu ? { ugultu } : {}) };
}

/** The recordings' makers for the credits, by the weapons of the age (all CC0 or U.S. public domain, no credit owed). */
export function battleCredit(arms: Arms, en: boolean): string {
  const swords = "StillNorthMedia, qubodup, StarNinjas (OpenGameArt, CC0)";
  const guns = `The Free Firearm Sound Library, Thimras, NenadSimic (OpenGameArt, CC0); ${en ? "U.S. Military Academy salute cannon (Wikimedia Commons, public domain)" : "ABD Askerî Akademisi selam topu (Wikimedia Commons, kamu malı)"}`;
  return arms === "kilic" ? swords : arms === "barut" ? `${swords}; ${guns}` : `qubodup, StarNinjas (OpenGameArt, CC0); ${guns}`;
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
  readonly arms: Arms;
  /** How many of each recording were laid in. */
  readonly counts: Readonly<Partial<Record<BedSound, number>>>;
}

/**
 * The bed as one stereo file as long as the episode (silent outside the windows), brought to BATTLE_LUFS while it
 * plays; undefined when there is no battle or the library has none of the age's weapons.
 */
export async function renderBattleBed(paths: Pick<V3Paths, "ffmpeg" | "asciiTemp">, sfxDir: string, windows: readonly BattleWindow[], duration: number, seed: string, out: string, arms: Arms = "kilic"): Promise<BattleBedResult | undefined> {
  const lib = battleLibrary(sfxDir);
  if (!windows.length || !MAIN_SOUNDS[arms].some((s) => lib[s].length)) return undefined;
  const total = Math.ceil(duration * SAMPLE_RATE);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const load = async (f: string) => readWavPcm16(await fs.readFile(f)).samples;
  const loaded = new Map<BedSound, Float32Array[]>();
  const counts: Partial<Record<BedSound, number>> = {};
  const events = battleEvents(windows, seed, arms);
  for (const e of events) {
    if (!loaded.has(e.what)) loaded.set(e.what, await Promise.all(lib[e.what].map(load)));
    const pool = loaded.get(e.what)!;
    if (!pool.length) continue;
    counts[e.what] = (counts[e.what] ?? 0) + 1;
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
        const g = ROAR_GAIN[arms] * windowGain(windows, i / SAMPLE_RATE);
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
  return { file: out, windows, arms, counts };
}
