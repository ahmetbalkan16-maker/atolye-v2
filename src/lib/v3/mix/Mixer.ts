import { existsSync, readdirSync, promises as fs } from "node:fs";
import path from "node:path";
import { type MusicMood, type MusicTrack, normalizeMusicMood } from "../../audio/music/MusicLibrary";
import type { Episode, SceneMood, SfxId } from "../episode/EpisodeTypes";
import { armsOf } from "../episode/Period";
import { fitLossDelaysS, unitLossDelaysS } from "../maps/MapBuilder";
import { readWavPcm16 } from "../lipsync/LipSync";
import type { EpisodeTimeline } from "../timeline/Timeline";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";
import { cleanAudioFile, declickClip, EFFECT_FADE_IN_S, EFFECT_FADE_OUT_S, fadeClipEdges, ticks } from "./AudioQuality";

/**
 * V3 audio mix: dialogue and effects are placed sample-exactly in Node, music beds are cut, looped and
 * cross-faded with FFmpeg and ducked under the dialogue (sidechain compression), every bed gives way a little under
 * the effects (mixGraph), and the whole mix is brought to
 * −14 LUFS / −1 dBTP in two loudnorm passes (measure, then apply), 48 kHz stereo. Music, effects and ambience go in
 * without the generators' whine lines (AudioQuality.cleanAudioFile); voiced lines and effects go in without ticks
 * (AudioQuality.declickClip, fadeClipEdges).
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
 * MAX_SCENES_PER_TRACK hands over to the next track of that mood, and a track never follows itself. A long episode's
 * chapter (`chapter`, from its chapter cards) opens on a bed of its own: a bed never carries over a chapter card.
 */
export function planMusic(scenes: readonly { readonly start: number; readonly end: number; readonly mood: MusicMood; readonly chapter?: number }[], tracksFor: (mood: MusicMood) => readonly MusicTrack[], seed = ""): MusicSegment[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) & 0x7fffffff;
  const turn = new Map<MusicMood, number>();
  const out: MusicSegment[] = [];
  let i = 0;
  while (i < scenes.length) {
    const mood = scenes[i]!.mood;
    let j = i;
    while (j + 1 < scenes.length && scenes[j + 1]!.mood === mood && scenes[j + 1]!.chapter === scenes[i]!.chapter && j + 1 - i < MAX_SCENES_PER_TRACK) j++;
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
const SFX_GAIN: Readonly<Record<SfxId, number>> = { whoosh: 0.45, pop: 0.55, boing: 0.55, kilic: 0.6, top_atisi: 0.85, davul: 0.6, kalabalik: 0.3, cekic: 0.55, dalga: 0.35, su: 0.55, zil: 0.45, yumruk: 0.6, dusus: 0.6, adim: 0.4, kapi: 0.5, para: 0.5, kagit: 0.45, basari: 0.4, hata: 0.4 };

/** Folder of each effect in Atölye's SFX library (`public/sfx/<category>/`). */
export const SFX_CATEGORY: Readonly<Record<SfxId, string>> = { whoosh: "transition", pop: "transition", boing: "transition", kilic: "battle", top_atisi: "battle", davul: "battle", kalabalik: "crowd", cekic: "interior", zil: "interior", dalga: "nature", su: "nature", yumruk: "battle", dusus: "transition", adim: "interior", kapi: "interior", para: "interior", kagit: "interior", basari: "transition", hata: "transition" };

/**
 * The library file for an effect: a recording (Kenney CC0, scripts/v3/sfx-kenney.ts) before the synthesised sound
 * (scripts/v3/sfx-uret.ts); undefined when neither is installed.
 */
export function sfxLibraryFile(sfxDir: string, id: SfxId): string | undefined {
  return sfxLibraryFiles(sfxDir, id)[0];
}

/**
 * Every recording of an effect, best first: several takes of one sound (`atolye-v3-<id>-<source>-NN.wav`, e.g. the 16
 * sword hits of scripts/v3/sfx-savas.ts) before the single Kenney recording before the synthesis. The mixer plays the
 * takes in turn, so twelve clashes in a battle are twelve different swords, not one hammer (owner, 26 Oct 2026).
 */
export function sfxLibraryFiles(sfxDir: string, id: SfxId): string[] {
  const dir = path.join(sfxDir, SFX_CATEGORY[id]);
  const takes = existsSync(dir) ? readdirSync(dir).filter((n) => new RegExp(`^atolye-v3-${id}-[a-z]+-\\d{2}\\.wav$`).test(n)).sort().map((n) => path.join(dir, n)) : [];
  if (takes.length) return takes;
  return [`atolye-v3-${id}-kenney.wav`, `atolye-v3-${id}-01.wav`].map((n) => path.join(dir, n)).filter((p) => existsSync(p)).slice(0, 1);
}

/**
 * Effects from the script (`sfx` on a line, at its start) and automatic ones, so the picture never moves in
 * silence even when the writer gave none (the reference channel lands a sound on almost every beat): a whoosh into
 * every scene the script opens with a slide, an ink iris or a white flash (none on a cut or a soft dissolve), a thud under
 * a one-word card, footsteps when someone walks in, a
 * whoosh when someone runs, a pop on a surprise or an exclamation mark over the head, a boing on a question mark, and
 * the success sting under the closing subscribe invitation. A line's own effect replaces its automatic one.
 */
export function sfxCues(episode: Episode, timeline: EpisodeTimeline): SfxCue[] {
  const cues: SfxCue[] = [];
  const lastScene = episode.sahneler.length - 1;
  episode.sahneler.forEach((scene, si) => {
    const st = timeline.scenes[si];
    if (si > 0 && st && scene.gecis && scene.gecis !== "kes" && scene.gecis !== "cozul") cues.push({ t: Math.max(0, st.start - 0.12), id: "whoosh" });
    const lineAt = (li: number) => timeline.lines.find((l) => l.sceneIndex === si && l.lineIndex === li);
    const sceneEnd = si === lastScene ? timeline.duration : (timeline.scenes[si + 1]?.start ?? timeline.duration);
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
      // In a living set a run is heard as running feet, not a cartoon whoosh (owner, 22 Oct 2026: "a strange sound
      // behind the characters while they move").
      else if (line.hareket === "kos") cues.push({ t: lt.start, id: scene.ortam ? "adim" : "whoosh" });
      else if (line.hareket === "gir" || line.hareket === "yuru") cues.push({ t: lt.start, id: "adim" });
      // Wading into the crossing's river: the splash as the walk reaches the water.
      if ((line.hareket === "yuru" || line.hareket === "kos") && typeof line.hedef === "number" && scene.ortam?.manzara === "nehir_gecidi") {
        const [a, b] = scene.ortam.nehir ?? [0.52, 0.8];
        if (line.hedef > a && line.hedef < b) cues.push({ t: lt.start + 0.9, id: "su" });
      }
    });
    // What the crowd does is heard too (owner, 22 Oct 2026: no meaningless sound): a march's footfalls, a charge's or a
    // flight's roar, the water as the column wades in.
    for (const g of scene.kalabalik ?? []) {
      const m = g.hareket;
      const lt = m ? lineAt(m.satir) : undefined;
      if (!m || !lt) continue;
      cues.push({ t: lt.start + 0.2, id: m.tur === "yuru" ? "adim" : "kalabalik" });
      if (m.tur === "hucum") cues.push({ t: lt.start + 0.4, id: "davul" });
      if (scene.ortam?.manzara === "nehir_gecidi") cues.push({ t: lt.start + 1.6, id: "su" });
    }
    // On the living map: a drum as an army sets off, swords where a battle flashes.
    for (const o of scene.harita?.ordular ?? []) {
      const lt = o.yol?.length ? lineAt(o.yol_satir ?? o.satir ?? 0) : undefined;
      if (lt) cues.push({ t: lt.start + 0.1, id: "davul" });
    }
    // A battle sounds like its age: swords before gunpowder, cannon fire after (and the swords still in the melee until
    // 1900; a 20th-century battle has no swords, a token falls to a shell).
    const arms = scene.harita ? armsOf(episode.donem) : undefined;
    const gun = arms === "barut" || arms === "modern";
    const blow: SfxId = arms === "modern" ? "top_atisi" : "kilic";
    for (const w of scene.harita?.savaslar ?? []) {
      const lt = lineAt(w.satir ?? 0);
      if (lt && arms !== "modern") cues.push({ t: lt.start + 0.2, id: "kilic" });
      if (lt && gun) cues.push({ t: lt.start + 0.6, id: "top_atisi" });
    }
    // A fight between the tokens (owner, 22 Oct 2026): swords as the sides meet and with every token that falls.
    for (const u of scene.harita?.birlikler ?? []) {
      let alive = Math.max(1, Math.min(24, Math.round(u.sayi)));
      for (const y of [...u.yerler].sort((a, b) => a.satir - b.satir)) {
        const lost = Math.min(alive, Math.max(0, Math.round(y.kayip ?? 0)));
        alive -= lost;
        const lt = lost > 0 ? lineAt(y.satir) : undefined;
        // Pressed into the scene as the map presses its falls (MapBuilder.fitLossDelaysS, the same scene end as the Director's).
        if (lt) cues.push({ t: lt.start + 1.4, id: blow }, ...fitLossDelaysS(unitLossDelaysS(lost), sceneEnd - lt.start).map((d) => ({ t: lt.start + d, id: blow })));
      }
    }
    // Vehicles: the sea as a fleet sets out, the roar of a cavalry or elephant charge, a plane's rush; their fire.
    for (const a of scene.harita?.araclar ?? []) {
      const go = a.yol?.length ? lineAt(a.yol_satir ?? a.satir) : undefined;
      const sound = ({ gemi: "dalga", kadirga: "dalga", yelkenli: "dalga", denizalti: "dalga", suvari: "kalabalik", fil: "kalabalik", ucak: "whoosh" } as Partial<Record<string, SfxId>>)[a.tur];
      if (go && sound) cues.push({ t: go.start + 0.2, id: sound });
      const fire = a.hedef && gun ? lineAt(a.ates_satir ?? a.yol_satir ?? a.satir) : undefined;
      if (fire) cues.push({ t: fire.start + 0.4, id: "top_atisi" }, { t: fire.start + 2.6, id: "top_atisi" });
      // Each one lost goes down with its sound, at the tokens' pace: a ship's splash, a blast (a fall before gunpowder).
      const lost = a.kayip_satir !== undefined ? Math.min(Math.max(1, Math.min(6, Math.round(a.sayi ?? 1))), Math.max(0, Math.round(a.kayip ?? 0))) : 0;
      const sunk = lost ? lineAt(a.kayip_satir!) : undefined;
      const down: SfxId = ["gemi", "kadirga", "yelkenli", "denizalti"].includes(a.tur) ? "su" : gun ? "top_atisi" : "dusus";
      if (sunk) cues.push(...unitLossDelaysS(lost).map((d) => ({ t: sunk.start + d, id: down })));
    }
  });
  // The same effect twice within a second is one sound (two footstep runs 0.2 s apart doubled into a clatter).
  const sorted = cues.sort((a, b) => a.t - b.t);
  return sorted.filter((c, i) => !sorted.slice(0, i).some((p) => p.id === c.id && c.t - p.t < 1));
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

/**
 * Whine lines are measured from here up in effects and ambience: under it a bell's partials, a sword's ring and
 * crickets are the sound itself; above it MOSS left its 14 and 16 kHz whine.
 */
export const EFFECT_LINE_MIN_HZ = 12_000;

export interface MixCleanup {
  readonly kaynak: string;
  readonly once: number;
  readonly sonra: number;
}

export interface MixInput {
  readonly duration: number;
  readonly dialogue: readonly { readonly file: string; readonly start: number }[];
  readonly music: readonly MusicSegment[];
  readonly sfx: readonly { readonly file: string; readonly t: number; readonly id: SfxId }[];
  /** Quiet ambience of each scene's place (SfxDesigner), looped over the scene, under everything. */
  readonly ambience?: readonly { readonly start: number; readonly end: number; readonly file: string }[];
  /** The battle bed (BattleBed.renderBattleBed): one stereo file as long as the episode, ducked gently under speech. */
  readonly battle?: string;
}

/** The battle bed gives way to speech less than the music does: the fight goes on behind the narrator. */
export const BATTLE_DUCK_RATIO = 3;

/** How fast the music ducks under speech and comes back. */
export const DUCK_ATTACK_MS = 20;
export const DUCK_RELEASE_MS = 400;

/**
 * The beds give way under the effects too (Ses beyni's proposal from the Waterloo Short, approved 6 Nov 2026:
 * "efektlerin doğru ve net çıkması için otomatik ses miksaj ve efekt kontrol sistemi"): music, ambience and battle dip a
 * few dB while an effect sounds and come back after it, so a footstep or a cannon between two lines is not lost under a
 * bed at full level. Gentler than under speech: the bed goes on under the hit.
 */
export const EFFECT_DUCK_RATIO = 2;
/** The effects' key threshold (−30 dBFS, under the speech key's −26): a quiet footstep moves the beds a little too. */
export const EFFECT_DUCK_THRESHOLD = 0.03;

/** Level of the ambience beds (well under the music's −26 before the final loudness pass). */
export const AMBIENCE_LUFS = -38;
/** How long one place's ambience takes to give way to the next one's (both heard, equal power). */
export const AMBIENCE_FADE_S = 0.8;
/**
 * Fades between beds and at a loop's seam are equal-power (a quarter sine in and out): two beds crossing keep their
 * loudness, where the triangular default dipped by 3 dB in the middle of every crossfade.
 */
export const FADE_CURVE = "qsin";

/** FFmpeg chain of one ambience bed (input `input`), looped to its time, faded at both ends, delayed to its start. */
export function ambienceChain(input: number, label: string, start: number, end: number): string {
  const len = Math.max(0.5, end - start);
  const ms = Math.round(start * 1000);
  const d = Math.min(AMBIENCE_FADE_S, len / 2);
  return `[${input}:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo,loudnorm=I=${AMBIENCE_LUFS}:TP=-9:LRA=11,afade=t=in:d=${d}:curve=${FADE_CURVE},afade=t=out:st=${Math.max(0, len - d).toFixed(3)}:d=${d}:curve=${FADE_CURVE},adelay=${ms}|${ms}[${label}]`;
}

/**
 * The ambience beds as they are played: scenes in a row with one bed (the same place) carry it on as one, never dipping
 * to silence at the cut between them; each bed overhangs its time by half a fade on both sides (within the episode), so
 * one place's sound crosses into the next one's instead of each fading out alone.
 */
export function ambienceRuns(beds: readonly { readonly start: number; readonly end: number; readonly file: string }[], duration: number): { start: number; end: number; file: string }[] {
  const runs: { start: number; end: number; file: string }[] = [];
  for (const b of [...beds].sort((a, c) => a.start - c.start)) {
    const last = runs[runs.length - 1];
    if (last && last.file === b.file && b.start - last.end <= 0.05) last.end = Math.max(last.end, b.end);
    else runs.push({ start: b.start, end: b.end, file: b.file });
  }
  return runs.map((r) => ({ ...r, start: Math.max(0, r.start - AMBIENCE_FADE_S / 2), end: Math.min(duration, r.end + AMBIENCE_FADE_S / 2) }));
}

/** The crossfade at a looped bed's seam (seconds). */
export const LOOP_SEAM_S = 1.2;

/**
 * FFmpeg graph that makes a file loop without a jump: its first `seam` seconds are crossed (equal power) into its end,
 * so played again and again the end runs into the start (from `seam` s in) with no click and no restart heard.
 */
export function loopSeamFilter(seam: number): string {
  const s = seam.toFixed(3);
  return `[0:a]asplit=2[a][b];[a]atrim=start=${s},asetpts=PTS-STARTPTS[body];[b]atrim=end=${s},asetpts=PTS-STARTPTS[head];[body][head]acrossfade=d=${s}:c1=${FADE_CURVE}:c2=${FADE_CURVE}[loop]`;
}

/** `[main]` ducked under `[key]` into `[out]` (sidechain compression with the music's attack and release). */
function duckChain(main: string, key: string, ratio: number, out: string, threshold = 0.05): string {
  return `[${main}][${key}]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${DUCK_ATTACK_MS}:release=${DUCK_RELEASE_MS}[${out}]`;
}

/**
 * The mix graph around its inputs (0 = dialogue, 1 = effects; the music beds' chains end in `[m<i>]`, the ambience
 * beds' in `[o<i>]`, the battle bed's in `[bt0]`): speech ducks the music (8:1) and the battle (BATTLE_DUCK_RATIO), the
 * effects duck every bed (EFFECT_DUCK_RATIO), and the ambience stays steady under speech (a place does not breathe
 * with the narrator). Each key is split once per bed it moves, so no FFmpeg link is left open.
 */
export function mixGraph(g: { readonly beds: readonly string[]; readonly ambience: readonly string[]; readonly battle?: string; readonly duration: number }): string[] {
  const dur = g.duration.toFixed(3);
  const speechKeys = [...(g.beds.length ? ["km"] : []), ...(g.battle ? ["kb"] : [])];
  const effectKeys = [...(g.beds.length ? ["fm"] : []), ...(g.ambience.length ? ["fa"] : []), ...(g.battle ? ["fb"] : [])];
  const split = (first: string, keys: readonly string[]) => (keys.length ? `,asplit=${keys.length + 1}[${first}]${keys.map((k) => `[${k}]`).join("")}` : `[${first}]`);
  const chains = [`[0:a]aformat=channel_layouts=stereo${split("dlg", speechKeys)}`, `[1:a]aformat=channel_layouts=stereo${split("fx", effectKeys)}`, ...g.beds, ...g.ambience];
  const under: string[] = [];
  if (g.ambience.length) {
    chains.push(`${g.ambience.map((_, i) => `[o${i}]`).join("")}amix=inputs=${g.ambience.length}:normalize=0:duration=longest,apad=whole_dur=${dur}[amb0]`, duckChain("amb0", "fa", EFFECT_DUCK_RATIO, "amb", EFFECT_DUCK_THRESHOLD));
    under.push("[amb]");
  }
  if (g.battle) {
    // The battle: under the narrator, but still heard (3:1 where the music gives way 8:1).
    chains.push(g.battle, duckChain("bt0", "kb", BATTLE_DUCK_RATIO, "bt1"), duckChain("bt1", "fb", EFFECT_DUCK_RATIO, "bt", EFFECT_DUCK_THRESHOLD));
    under.push("[bt]");
  }
  if (!g.beds.length) return [...chains, `[dlg][fx]${under.join("")}amix=inputs=${2 + under.length}:normalize=0:duration=first[mix]`];
  chains.push(`${g.beds.map((_, i) => `[m${i}]`).join("")}amix=inputs=${g.beds.length}:normalize=0:duration=longest,apad=whole_dur=${dur}[bed]`);
  // Duck the bed under speech. A 5 ms attack moved the gain within one cycle of a low horn and added 7 dB more
  // distortion above 1.5 kHz than 20 ms (measured 26 Oct 2026); 20 ms still lands before the first syllable is heard.
  chains.push(duckChain("bed", "km", 8, "bed1"), duckChain("bed1", "fm", EFFECT_DUCK_RATIO, "ducked", EFFECT_DUCK_THRESHOLD));
  return [...chains, `[dlg][ducked][fx]${under.join("")}amix=inputs=${3 + under.length}:normalize=0:duration=first[mix]`];
}

export interface MixResult {
  readonly file: string;
  readonly integratedLufs: number;
  readonly truePeakDb: number;
  /** Credits for every bed used, de-duplicated (CREDITS.md, video description). */
  readonly credits: readonly string[];
  /** Sources that had whine lines, with how many before and after the cleaning. */
  readonly cleanup: readonly MixCleanup[];
  /** Ticks in the dialogue (AudioQuality.ticks) before and after the repair; `sonra` above 0 is a fault before delivery. */
  readonly declick: MixDeclick;
}

/** Lines that had ticks, and the dialogue's ticks as voiced (`once`) and as mixed (`sonra`). */
export interface MixDeclick {
  readonly satir: number;
  readonly once: number;
  readonly sonra: number;
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
  // Every music bed, effect and ambience bed goes in without its whine (AudioQuality); each file is cleaned once.
  const cleanup: MixCleanup[] = [];
  const cleaned = new Map<string, string>();
  const clean = async (file: string, kind: "muzik" | "efekt" | "ortam"): Promise<string> => {
    const known = cleaned.get(`${kind}#${file}`);
    if (known) return known;
    const out = path.join(tmp, `temiz-${cleaned.size}.wav`);
    const outArgs = kind === "efekt" ? ["-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le"] : ["-ar", String(SAMPLE_RATE), "-c:a", "pcm_f32le"];
    const r = await cleanAudioFile(paths, file, out, { outArgs, ...(kind === "muzik" ? {} : { minHz: EFFECT_LINE_MIN_HZ }) });
    cleaned.set(`${kind}#${file}`, out);
    if (r.before.length) cleanup.push({ kaynak: `${kind} ${path.basename(file)}`, once: r.before.length, sonra: r.after.length });
    return out;
  };

  // Voiced lines go in without their ticks (AudioQuality.declickClip): measured on the dialogue before and after.
  const dialogue = new Float32Array(total);
  const asVoiced = new Float32Array(total);
  let ticked = 0;
  for (const d of input.dialogue) {
    const voice = await monoAt48k(paths, d.file, tmp);
    placeSamples(asVoiced, voice, d.start);
    const fixed = declickClip(voice, SAMPLE_RATE);
    if (ticks(voice, SAMPLE_RATE).length) ticked++;
    placeSamples(dialogue, fixed.samples, d.start);
  }
  const declick: MixDeclick = { satir: ticked, once: ticks(asVoiced, SAMPLE_RATE).length, sonra: ticks(dialogue, SAMPLE_RATE).length };
  // An effect never steps out of or into silence either (a boing began at −2 dBFS on its first sample).
  const effects = new Float32Array(total);
  for (const s of input.sfx) placeSamples(effects, fadeClipEdges(await monoAt48k(paths, await clean(s.file, "efekt"), tmp), SAMPLE_RATE, EFFECT_FADE_IN_S, EFFECT_FADE_OUT_S), s.t, SFX_GAIN[s.id]);
  const dlgFile = path.join(tmp, "dialogue.wav");
  const sfxFile = path.join(tmp, "sfx.wav");
  await fs.writeFile(dlgFile, wavFloat32(dialogue));
  await fs.writeFile(sfxFile, wavFloat32(effects));

  const args: string[] = ["-v", "error", "-y", "-i", dlgFile, "-i", sfxFile];
  // A bed longer than its file loops: through a seamless copy (loopSeamFilter), made once per file. A file too short for
  // the seam, or one FFmpeg cannot read the length of, loops as before.
  const seamless = new Map<string, string>();
  const loopable = async (file: string, len: number): Promise<string> => {
    const probe = await runChecked(paths.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).catch(() => undefined);
    const own = Number(probe?.stdout.trim());
    if (!(own > 4 * LOOP_SEAM_S) || own >= len) return file;
    const known = seamless.get(file);
    if (known) return known;
    const out = path.join(tmp, `dongu-${seamless.size}.wav`);
    const made = await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", file, "-filter_complex", loopSeamFilter(LOOP_SEAM_S), "-map", "[loop]", "-c:a", "pcm_f32le", out]).then(() => true, () => false);
    seamless.set(file, made ? out : file);
    return made ? out : file;
  };
  const beds: string[] = [];
  for (const [i, m] of input.music.entries()) {
    // Each bed overhangs its scenes by half a crossfade on both sides, so neighbours overlap by a full one.
    const from = Math.max(0, m.start - CROSSFADE_S / 2);
    const to = Math.min(input.duration, m.end + CROSSFADE_S / 2);
    const len = Math.max(0.5, to - from);
    const fadeIn = i === 0 ? 0.8 : CROSSFADE_S;
    args.push("-stream_loop", "-1", "-t", len.toFixed(3), "-i", await loopable(await clean(m.track.absolutePath, "muzik"), len));
    const ms = Math.round(from * 1000);
    beds.push(
      `[${i + 2}:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo,loudnorm=I=-26:TP=-8:LRA=11,afade=t=in:d=${fadeIn}:curve=${FADE_CURVE},afade=t=out:st=${Math.max(0, len - CROSSFADE_S).toFixed(3)}:d=${CROSSFADE_S}:curve=${FADE_CURVE},adelay=${ms}|${ms}[m${i}]`,
    );
  }
  const ambience = ambienceRuns(input.ambience ?? [], input.duration);
  const places: string[] = [];
  for (const [i, a] of ambience.entries()) {
    const len = Math.max(0.5, a.end - a.start);
    args.push("-stream_loop", "-1", "-t", len.toFixed(3), "-i", await loopable(await clean(a.file, "ortam"), len));
    places.push(ambienceChain(input.music.length + 2 + i, `o${i}`, a.start, a.end));
  }
  let battle: string | undefined;
  if (input.battle) {
    args.push("-i", input.battle);
    battle = `[${input.music.length + ambience.length + 2}:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo,apad=whole_dur=${input.duration.toFixed(3)}[bt0]`;
  }
  const chains = mixGraph({ beds, ambience: places, ...(battle ? { battle } : {}), duration: input.duration });
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
  return { file: out, ...loud, credits, cleanup, declick };
}
