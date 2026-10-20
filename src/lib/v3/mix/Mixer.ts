import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { type MusicMood, type MusicTrack, normalizeMusicMood } from "../../audio/music/MusicLibrary";
import type { Episode, SceneMood, SfxId } from "../episode/EpisodeTypes";
import { readWavPcm16 } from "../lipsync/LipSync";
import type { EpisodeTimeline } from "../timeline/Timeline";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";

/**
 * V3 audio mix: dialogue and effects are placed sample-exactly in Node, music beds are cut, looped and
 * cross-faded with FFmpeg and ducked under the dialogue (sidechain compression), and the whole mix is brought to
 * −14 LUFS / −1 dBTP in two loudnorm passes (measure, then apply), 48 kHz stereo.
 */
export const SAMPLE_RATE = 48_000;
/** Overlap between two music beds. */
export const CROSSFADE_S = 1.5;
/** A bed may carry at most this many consecutive scenes before another track takes over. */
export const MAX_SCENES_PER_TRACK = 3;

/** Scene mood → music bucket (Atölye's MusicLibrary moods). */
const SCENE_TO_MUSIC: Readonly<Record<SceneMood, MusicMood>> = {
  gerilim: "tense",
  komik: "comedic",
  huzun: "calm",
  zafer: "epic",
  gizem: "tense",
  merak: "historical",
};

export function sceneMusicMood(duygu: SceneMood | undefined, freeText?: string): MusicMood {
  return duygu ? SCENE_TO_MUSIC[duygu] : normalizeMusicMood(freeText);
}

export interface MusicSegment {
  readonly start: number;
  readonly end: number;
  readonly mood: MusicMood;
  readonly track: MusicTrack;
  readonly scenes: readonly number[];
}

/**
 * Beds over the scenes: consecutive scenes of one mood share a track (no restart), a run longer than
 * MAX_SCENES_PER_TRACK hands over to the next track of that mood, and a track never follows itself.
 */
export function planMusic(scenes: readonly { readonly start: number; readonly end: number; readonly mood: MusicMood }[], tracksFor: (mood: MusicMood) => readonly MusicTrack[], seed = ""): MusicSegment[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) & 0x7fffffff;
  const turn = new Map<MusicMood, number>();
  const out: MusicSegment[] = [];
  let i = 0;
  while (i < scenes.length) {
    const mood = scenes[i]!.mood;
    let j = i;
    while (j + 1 < scenes.length && scenes[j + 1]!.mood === mood && j + 1 - i < MAX_SCENES_PER_TRACK) j++;
    const all = tracksFor(mood);
    if (all.length) {
      const top = Math.max(...all.map((t) => t.priority ?? 0));
      const pool = all.filter((t) => (t.priority ?? 0) === top);
      const prev = out[out.length - 1]?.track.absolutePath;
      let k = (hash + (turn.get(mood) ?? 0)) % pool.length;
      if (pool.length > 1 && pool[k]!.absolutePath === prev) k = (k + 1) % pool.length;
      turn.set(mood, (turn.get(mood) ?? 0) + 1);
      out.push({ start: scenes[i]!.start, end: scenes[j]!.end, mood, track: pool[k]!, scenes: scenes.slice(i, j + 1).map((_, n) => i + n) });
    }
    i = j + 1;
  }
  return out;
}

export interface SfxCue {
  readonly t: number;
  readonly id: SfxId;
}

/** Relative level of each effect under the dialogue. */
const SFX_GAIN: Readonly<Record<SfxId, number>> = { whoosh: 0.45, pop: 0.55, boing: 0.55, kilic: 0.6, top_atisi: 0.85, davul: 0.6, kalabalik: 0.3, cekic: 0.55, dalga: 0.35, zil: 0.45, yumruk: 0.6, dusus: 0.6, adim: 0.4, kapi: 0.5, para: 0.5, kagit: 0.45, basari: 0.4, hata: 0.4 };

/** Folder of each effect in Atölye's SFX library (`public/sfx/<category>/`). */
export const SFX_CATEGORY: Readonly<Record<SfxId, string>> = { whoosh: "transition", pop: "transition", boing: "transition", kilic: "battle", top_atisi: "battle", davul: "battle", kalabalik: "crowd", cekic: "interior", zil: "interior", dalga: "nature", yumruk: "battle", dusus: "transition", adim: "interior", kapi: "interior", para: "interior", kagit: "interior", basari: "transition", hata: "transition" };

/**
 * The library file for an effect: a recording (Kenney CC0, scripts/v3/sfx-kenney.ts) before the synthesised sound
 * (scripts/v3/sfx-uret.ts); undefined when neither is installed.
 */
export function sfxLibraryFile(sfxDir: string, id: SfxId): string | undefined {
  const dir = path.join(sfxDir, SFX_CATEGORY[id]);
  return [`atolye-v3-${id}-kenney.wav`, `atolye-v3-${id}-01.wav`].map((n) => path.join(dir, n)).find((p) => existsSync(p));
}

/**
 * Effects from the script (`sfx` on a line, at its start) and automatic ones, so the picture never moves in
 * silence even when the writer gave none (the reference channel lands a sound on almost every beat): a whoosh into
 * every scene that does not open on a hard cut, a thud under a one-word card, footsteps when someone walks in, a
 * whoosh when someone runs, a pop on a surprise or an exclamation mark over the head, a boing on a question mark, and
 * the success sting under the closing subscribe invitation. A line's own effect replaces its automatic one.
 */
export function sfxCues(episode: Episode, timeline: EpisodeTimeline): SfxCue[] {
  const cues: SfxCue[] = [];
  const lastScene = episode.sahneler.length - 1;
  episode.sahneler.forEach((scene, si) => {
    const st = timeline.scenes[si];
    if (si > 0 && st && scene.gecis && scene.gecis !== "kes") cues.push({ t: Math.max(0, st.start - 0.12), id: "whoosh" });
    const lineAt = (li: number) => timeline.lines.find((l) => l.sceneIndex === si && l.lineIndex === li);
    for (const card of scene.yazi_karti ?? []) {
      const lt = lineAt(Math.min(card.satir ?? 0, scene.satirlar.length - 1));
      if (card.stil === "kelime" && lt) cues.push({ t: lt.start, id: "dusus" });
    }
    scene.satirlar.forEach((line, li) => {
      const lt = lineAt(li);
      if (!lt) return;
      if (line.sfx) cues.push({ t: lt.start, id: line.sfx });
      else if (si === lastScene && li === scene.satirlar.length - 1) cues.push({ t: lt.start, id: "basari" });
      else if (line.jest === "sasir" || line.efekt === "unlem") cues.push({ t: lt.start, id: "pop" });
      else if (line.efekt === "soru") cues.push({ t: lt.start, id: "boing" });
      else if (line.hareket === "kos") cues.push({ t: lt.start, id: "whoosh" });
      else if (line.hareket === "gir" || line.hareket === "yuru") cues.push({ t: lt.start, id: "adim" });
    });
  });
  return cues.sort((a, b) => a.t - b.t);
}

/** Adds `src` (mono, SAMPLE_RATE) into `dst` at `at` seconds with `gain`; samples past the end are dropped. */
export function placeSamples(dst: Float32Array, src: Float32Array, at: number, gain = 1): void {
  const off = Math.round(at * SAMPLE_RATE);
  const n = Math.min(src.length, dst.length - off);
  for (let i = Math.max(0, -off); i < n; i++) dst[off + i]! += src[i]! * gain;
}

function wavFloat32(samples: Float32Array): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 4);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + samples.length * 4, 4);
  buf.write("WAVEfmt ", 8, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); // IEEE float
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(32, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(samples.length * 4, 40);
  for (let i = 0; i < samples.length; i++) buf.writeFloatLE(samples[i]!, 44 + i * 4);
  return buf;
}

async function monoAt48k(paths: V3Paths, file: string, tmp: string): Promise<Float32Array> {
  const pcm = readWavPcm16(await fs.readFile(file));
  if (pcm.sampleRate === SAMPLE_RATE) return pcm.samples;
  const out = path.join(tmp, `rs-${path.basename(file)}`);
  await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", file, "-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", out]);
  return readWavPcm16(await fs.readFile(out)).samples;
}

export interface MixInput {
  readonly duration: number;
  readonly dialogue: readonly { readonly file: string; readonly start: number }[];
  readonly music: readonly MusicSegment[];
  readonly sfx: readonly { readonly file: string; readonly t: number; readonly id: SfxId }[];
  /** Quiet ambience of each scene's place (SfxDesigner), looped over the scene, under everything. */
  readonly ambience?: readonly { readonly start: number; readonly end: number; readonly file: string }[];
}

/** Level of the ambience beds (well under the music's −26 before the final loudness pass). */
export const AMBIENCE_LUFS = -38;

/** FFmpeg chain of one ambience bed (input `input`), looped to the scene, faded at both ends, delayed to its start. */
export function ambienceChain(input: number, label: string, start: number, end: number): string {
  const len = Math.max(0.5, end - start);
  const ms = Math.round(start * 1000);
  return `[${input}:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo,loudnorm=I=${AMBIENCE_LUFS}:TP=-9:LRA=11,afade=t=in:d=0.6,afade=t=out:st=${Math.max(0, len - 0.6).toFixed(3)}:d=0.6,adelay=${ms}|${ms}[${label}]`;
}

export interface MixResult {
  readonly file: string;
  readonly integratedLufs: number;
  readonly truePeakDb: number;
  /** Credits for every bed used, de-duplicated (CREDITS.md, video description). */
  readonly credits: readonly string[];
}

function loudnormStats(stderr: string): Record<string, string> {
  const m = /\{[\s\S]*"input_i"[\s\S]*?\}/.exec(stderr);
  if (!m) throw new Error("MIX_LOUDNORM_STATS: ölçüm okunamadı");
  return JSON.parse(m[0]) as Record<string, string>;
}

export async function measureLoudness(paths: V3Paths, file: string): Promise<{ integratedLufs: number; truePeakDb: number }> {
  const r = await runChecked(paths.ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const summary = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  const i = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  const tp = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
  return { integratedLufs: i, truePeakDb: tp };
}

/** Renders the mix to `out` (48 kHz stereo 24-bit WAV) and measures it. */
export async function renderMix(paths: V3Paths, input: MixInput, out: string): Promise<MixResult> {
  const tmp = path.join(paths.asciiTemp, "mix");
  await fs.mkdir(tmp, { recursive: true });
  const total = Math.ceil(input.duration * SAMPLE_RATE);

  const dialogue = new Float32Array(total);
  for (const d of input.dialogue) placeSamples(dialogue, await monoAt48k(paths, d.file, tmp), d.start);
  const effects = new Float32Array(total);
  for (const s of input.sfx) placeSamples(effects, await monoAt48k(paths, s.file, tmp), s.t, SFX_GAIN[s.id]);
  const dlgFile = path.join(tmp, "dialogue.wav");
  const sfxFile = path.join(tmp, "sfx.wav");
  await fs.writeFile(dlgFile, wavFloat32(dialogue));
  await fs.writeFile(sfxFile, wavFloat32(effects));

  const args: string[] = ["-v", "error", "-y", "-i", dlgFile, "-i", sfxFile];
  const chains: string[] = ["[0:a]aformat=channel_layouts=stereo,asplit=2[dlg][key]", "[1:a]aformat=channel_layouts=stereo[fx]"];
  const beds: string[] = [];
  input.music.forEach((m, i) => {
    // Each bed overhangs its scenes by half a crossfade on both sides, so neighbours overlap by a full one.
    const from = Math.max(0, m.start - CROSSFADE_S / 2);
    const to = Math.min(input.duration, m.end + CROSSFADE_S / 2);
    const len = Math.max(0.5, to - from);
    const fadeIn = i === 0 ? 0.8 : CROSSFADE_S;
    args.push("-stream_loop", "-1", "-t", len.toFixed(3), "-i", m.track.absolutePath);
    const ms = Math.round(from * 1000);
    chains.push(
      `[${i + 2}:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo,loudnorm=I=-26:TP=-8:LRA=11,afade=t=in:d=${fadeIn},afade=t=out:st=${Math.max(0, len - CROSSFADE_S).toFixed(3)}:d=${CROSSFADE_S},adelay=${ms}|${ms}[m${i}]`,
    );
    beds.push(`[m${i}]`);
  });
  const ambience = input.ambience ?? [];
  ambience.forEach((a, i) => {
    args.push("-stream_loop", "-1", "-t", Math.max(0.5, a.end - a.start).toFixed(3), "-i", a.file);
    chains.push(ambienceChain(input.music.length + 2 + i, `o${i}`, a.start, a.end));
  });
  const amb = ambience.length ? ["[amb]"] : [];
  if (ambience.length) chains.push(`${ambience.map((_, i) => `[o${i}]`).join("")}amix=inputs=${ambience.length}:normalize=0:duration=longest,apad=whole_dur=${input.duration.toFixed(3)}[amb]`);
  if (beds.length) {
    chains.push(`${beds.join("")}amix=inputs=${beds.length}:normalize=0:duration=longest,apad=whole_dur=${input.duration.toFixed(3)}[bed]`);
    // Duck the bed under speech: fast attack, gentle release.
    chains.push("[bed][key]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=200[ducked]");
    chains.push(`[dlg][ducked][fx]${amb.join("")}amix=inputs=${3 + amb.length}:normalize=0:duration=first[mix]`);
  } else {
    chains.push("[key]anullsink", `[dlg][fx]${amb.join("")}amix=inputs=${2 + amb.length}:normalize=0:duration=first[mix]`);
  }
  const raw = path.join(tmp, "mix-raw.wav");
  await runChecked(paths.ffmpeg, [...args, "-filter_complex", chains.join(";"), "-map", "[mix]", "-t", input.duration.toFixed(3), "-ar", String(SAMPLE_RATE), "-c:a", "pcm_f32le", raw], { timeoutMs: 30 * 60_000 });

  // Two-pass loudness: measure, then apply with the measured values (linear when possible). The true-peak target
  // keeps 0.5 dB of headroom: AAC encoding of the final file lifts inter-sample peaks (−1.0 here became −0.9).
  const target = "I=-14:TP=-1.5:LRA=11";
  const pass1 = await runChecked(paths.ffmpeg, ["-hide_banner", "-nostats", "-i", raw, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"]);
  const s = loudnormStats(pass1.stderr);
  const pass2 = `loudnorm=${target}:measured_I=${s.input_i}:measured_TP=${s.input_tp}:measured_LRA=${s.input_lra}:measured_thresh=${s.input_thresh}:offset=${s.target_offset}:linear=true`;
  await fs.mkdir(path.dirname(out), { recursive: true });
  await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", raw, "-af", `${pass2},aresample=${SAMPLE_RATE}`, "-ac", "2", "-c:a", "pcm_s24le", out], { timeoutMs: 30 * 60_000 });
  const loud = await measureLoudness(paths, out);
  await fs.rm(tmp, { recursive: true, force: true });
  const credits = [...new Set(input.music.map((m) => m.track.attribution ?? `${m.track.title} — ${m.track.license ?? "lisans bilinmiyor"}`))];
  return { file: out, ...loud, credits };
}
