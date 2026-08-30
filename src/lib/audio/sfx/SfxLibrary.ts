import fs from "node:fs";
import path from "node:path";
import {
  classifyMediaRightsStatus,
  isProductionAdmissibleRightsStatus,
} from "@/lib/assets/MediaRightsPolicy";
import type { MediaRightsStatus } from "@/types/asset";

/**
 * Documentary media effort — Faz 4: local, licence-cleared sound-effect /
 * ambience library. Structurally identical to `MusicLibrary` — it only
 * *selects* descriptors from files that already exist on disk, performs no
 * download and no paid API call, and returns `null` / `[]` for every lookup
 * when the library is empty (the default state of a fresh checkout).
 *
 * Expected layout (every file must be licence-cleared for monetised use before
 * being committed):
 *
 *   public/sfx/<category>/<clip>.<ext>
 *   public/sfx/<category>/<clip>.<ext>.license.json   (optional sidecar)
 *
 * where `<category>` is one of `SFX_CATEGORIES`. A `.license.json` sidecar, when
 * present, should contain `{ title, source, sourceUrl, license, attribution }`.
 *
 * Not yet wired into the assembly renderer: the FFmpeg assembly provider mixes
 * exactly one `backgroundMusic` bed today. Wiring an ambience bed or per-scene
 * SFX into its filter graph is a separate, assembly-touching change (Faz 6);
 * this module is the additive abstraction that step will consume — it already
 * enforces the same fail-closed rights gate as music and real media.
 */

export const SFX_CATEGORIES = [
  "ambience",
  "battle",
  "crowd",
  "nature",
  "interior",
  "transition",
] as const;

export type SfxCategory = (typeof SFX_CATEGORIES)[number];

export interface SfxClip {
  category: SfxCategory;
  /** Absolute path to the audio file on disk. */
  absolutePath: string;
  fileName: string;
  title: string;
  source: string | null;
  sourceUrl: string | null;
  license: string | null;
  attribution: string | null;
  /** Deterministic classification of `license` via `MediaRightsPolicy`. */
  rightsStatus: MediaRightsStatus;
  /** `rightsStatus` is production-admissible. Inadmissible clips are never selected. */
  admissible: boolean;
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".ogg", ".wav", ".flac"]);

/** Free-text hints that map a research/plan phrase onto a category bucket. */
const CATEGORY_HINTS: Record<SfxCategory, string[]> = {
  ambience: ["ambience", "ambient", "atmosphere", "atmosfer", "room tone", "oda", "drone", "wind", "rüzgar"],
  battle: ["battle", "savaş", "war", "cannon", "top", "sword", "kılıç", "siege", "kuşatma", "march", "yürüyüş"],
  crowd: ["crowd", "kalabalık", "cheer", "tezahürat", "market", "çarşı", "voices", "sesler"],
  nature: ["nature", "doğa", "forest", "orman", "sea", "deniz", "river", "nehir", "rain", "yağmur", "birds", "kuş"],
  interior: ["interior", "iç mekan", "palace", "saray", "church", "kilise", "mosque", "cami", "hall", "salon", "fire", "ateş"],
  transition: ["transition", "geçiş", "whoosh", "riser", "impact", "hit", "sting", "boom"],
};

/**
 * Maps a free-text description (e.g. a `research.soundEffects[]` entry) onto one
 * of the fixed `SFX_CATEGORIES` buckets. Returns `null` when nothing matches, so
 * a vague entry never forces an unrelated clip.
 */
export function normalizeSfxCategory(value: string | undefined | null): SfxCategory | null {
  const text = (value ?? "").toLocaleLowerCase("tr");
  if (!text.trim()) return null;
  for (const category of SFX_CATEGORIES) {
    if (text.includes(category)) return category;
  }
  for (const category of SFX_CATEGORIES) {
    if (CATEGORY_HINTS[category].some((hint) => text.includes(hint))) return category;
  }
  return null;
}

/** Resolves the library root; overridable via `ATOLYE_SFX_LIBRARY_ROOT` for tests. */
export function sfxLibraryRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ATOLYE_SFX_LIBRARY_ROOT?.trim();
  if (override) return path.resolve(override);
  return path.resolve(process.cwd(), "public", "sfx");
}

function readSidecar(audioPath: string): Partial<SfxClip> {
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

/** Lists every usable clip for a category, sorted by file name for determinism. */
export function listSfxForCategory(
  category: SfxCategory,
  env: NodeJS.ProcessEnv = process.env,
): SfxClip[] {
  const dir = path.join(sfxLibraryRoot(env), category);
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
      const rightsStatus = classifyMediaRightsStatus(sidecar.license);
      return {
        category,
        absolutePath,
        fileName,
        title: sidecar.title ?? path.basename(fileName, path.extname(fileName)),
        source: sidecar.source ?? null,
        sourceUrl: sidecar.sourceUrl ?? null,
        license: sidecar.license ?? null,
        attribution: sidecar.attribution ?? null,
        rightsStatus,
        admissible: isProductionAdmissibleRightsStatus(rightsStatus),
      };
    });
}

/**
 * Deterministically selects one admissible ambience/SFX clip for a free-text
 * description. `seed` (e.g. the project slug or `slug:sceneId`) keeps the choice
 * stable. Returns `null` when the resolved category is empty or the description
 * maps to no category — the caller then renders without that layer.
 */
export function selectSfxClip(
  description: string | undefined | null,
  seed = "",
  env: NodeJS.ProcessEnv = process.env,
): SfxClip | null {
  const category = normalizeSfxCategory(description);
  if (!category) return null;
  const clips = listSfxForCategory(category, env).filter((clip) => clip.admissible);
  if (clips.length === 0) return null;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) & 0x7fffffff;
  }
  return clips[hash % clips.length];
}

/**
 * Convenience: resolve a documentary-wide ambience bed from a list of free-text
 * `soundEffects` / `musicIdeas` hints. Returns the first admissible ambience
 * clip that any hint resolves to, else `null` (no-op — narration + music only).
 */
export function selectAmbienceBed(
  hints: readonly (string | null | undefined)[],
  seed = "",
  env: NodeJS.ProcessEnv = process.env,
): SfxClip | null {
  for (const hint of hints) {
    const direct = selectSfxClip(hint, seed, env);
    if (direct && direct.category === "ambience") return direct;
  }
  // fall back to any ambience clip when hints exist but none mapped cleanly
  if (hints.some((hint) => typeof hint === "string" && hint.trim())) {
    const ambience = listSfxForCategory("ambience", env).filter((clip) => clip.admissible);
    if (ambience.length > 0) {
      let hash = 0;
      for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) & 0x7fffffff;
      return ambience[hash % ambience.length];
    }
  }
  return null;
}
