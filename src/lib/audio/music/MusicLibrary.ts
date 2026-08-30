import fs from "node:fs";
import path from "node:path";

/**
 * Mood-based background-music selection over a local, license-cleared track
 * library.
 *
 * This module only *selects* a track descriptor from files that already exist
 * on disk under the library root. It performs no download and no paid API
 * call. When the library is empty (the default state of a fresh checkout) every
 * lookup returns `null`, so the assembly stage keeps its current
 * narration-only behaviour until real, licensed tracks are added.
 *
 * Expected layout (all files must be license-cleared - CC0, public domain, or a
 * license that permits monetised YouTube use - before being committed):
 *
 *   public/music/<mood>/<track>.mp3
 *   public/music/<mood>/<track>.mp3.license.json   (optional sidecar metadata)
 *
 * where <mood> is one of MUSIC_MOODS. A `.license.json` sidecar, when present,
 * should contain: { title, source, sourceUrl, license, attribution }.
 */

export const MUSIC_MOODS = [
  "epic",
  "dramatic",
  "tense",
  "calm",
  "historical",
] as const;

export type MusicMood = (typeof MUSIC_MOODS)[number];

export interface MusicTrack {
  mood: MusicMood;
  /** Absolute path to the audio file on disk. */
  absolutePath: string;
  fileName: string;
  title: string;
  source: string | null;
  sourceUrl: string | null;
  license: string | null;
  attribution: string | null;
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".ogg", ".wav", ".flac"]);

/** Words that hint at each mood, used to map a free-text plan mood onto a bucket. */
const MOOD_HINTS: Record<MusicMood, string[]> = {
  epic: ["epic", "epik", "heroic", "kahraman", "grand", "görkem", "trailer"],
  dramatic: ["dramatic", "dramatik", "emotional", "duygusal", "cinematic", "sinematik", "orchestral", "orkestra"],
  tense: ["tense", "gergin", "suspense", "gerilim", "dark", "karanlık", "battle", "savaş", "war"],
  calm: ["calm", "sakin", "ambient", "soft", "yumuşak", "reflective", "huzur", "peaceful"],
  historical: ["historical", "tarihi", "tarihî", "ancient", "antik", "medieval", "ortaçağ", "folk", "period"],
};

/**
 * Maps a free-text mood description (e.g. `script.musicStyle` or
 * `audio.music.mood`) onto one of the fixed MUSIC_MOODS buckets. Falls back to
 * "dramatic" - the safest general documentary bed - when nothing matches.
 */
export function normalizeMusicMood(value: string | undefined | null): MusicMood {
  const text = (value ?? "").toLocaleLowerCase("tr");
  if (!text.trim()) return "dramatic";
  for (const mood of MUSIC_MOODS) {
    if (text.includes(mood)) return mood;
  }
  for (const mood of MUSIC_MOODS) {
    if (MOOD_HINTS[mood].some((hint) => text.includes(hint))) return mood;
  }
  return "dramatic";
}

/** Resolves the library root; overridable via ATOLYE_MUSIC_LIBRARY_ROOT for tests. */
export function musicLibraryRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ATOLYE_MUSIC_LIBRARY_ROOT?.trim();
  if (override) return path.resolve(override);
  return path.resolve(process.cwd(), "public", "music");
}

function readSidecar(audioPath: string): Partial<MusicTrack> {
  try {
    const raw = fs.readFileSync(`${audioPath}.license.json`, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const str = (key: string): string | null =>
      typeof parsed[key] === "string" && (parsed[key] as string).trim()
        ? (parsed[key] as string).trim()
        : null;
    return {
      title: str("title") ?? undefined,
      source: str("source"),
      sourceUrl: str("sourceUrl"),
      license: str("license"),
      attribution: str("attribution"),
    };
  } catch {
    return {};
  }
}

/** Lists every usable track for a mood bucket, sorted by file name for determinism. */
export function listTracksForMood(
  mood: MusicMood,
  env: NodeJS.ProcessEnv = process.env,
): MusicTrack[] {
  const dir = path.join(musicLibraryRoot(env), mood);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => AUDIO_EXTENSIONS.has(path.extname(name).toLocaleLowerCase("en")))
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => {
      const absolutePath = path.join(dir, fileName);
      const sidecar = readSidecar(absolutePath);
      return {
        mood,
        absolutePath,
        fileName,
        title: sidecar.title ?? path.basename(fileName, path.extname(fileName)),
        source: sidecar.source ?? null,
        sourceUrl: sidecar.sourceUrl ?? null,
        license: sidecar.license ?? null,
        attribution: sidecar.attribution ?? null,
      };
    });
}

/**
 * Selects a single track for a free-text mood. `seed` (e.g. the project slug)
 * makes the choice stable per project while still varying across projects.
 * Returns `null` when the library has no track for the resolved mood and no
 * track for any other mood either.
 */
export function selectMusicTrack(
  moodText: string | undefined | null,
  seed = "",
  env: NodeJS.ProcessEnv = process.env,
): MusicTrack | null {
  const preferred = normalizeMusicMood(moodText);
  const order: MusicMood[] = [preferred, ...MUSIC_MOODS.filter((m) => m !== preferred)];
  for (const mood of order) {
    const tracks = listTracksForMood(mood, env);
    if (tracks.length === 0) continue;
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) & 0x7fffffff;
    }
    return tracks[hash % tracks.length];
  }
  return null;
}
