import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CastCostume } from "../episode/EpisodeTypes";
import { periodEndYear } from "../episode/Period";

/**
 * The period atlas (owner, 6 Nov 2026: "her dönemi askeri kıyafetlerini her ülkenin giyim kuşam tarzını … oraya
 * depolayalım; bir video istediğimde video tarihine bakar ülkeye bakar giyim kuşamlarına bakar … giydirir"): for an era,
 * each side's costumes by rank, ready to copy into a script. Its headwear and facial hair are worded so PartFamilies
 * draws them for free. The Waterloo Short had to be stopped three times over a green-coated Blücher, dome-shaped
 * bicornes and a borrowed beard — the writer now starts from the right uniform instead of guessing one.
 * Seed: `content/v3/donem-atlasi.json` (curated); pure reading and text, no model.
 */

export interface AtlasRole {
  readonly rol: string;
  readonly kostum: CastCostume;
}

export interface AtlasSide {
  readonly ad: string;
  readonly roller: readonly AtlasRole[];
}

export interface AtlasEra {
  readonly id: string;
  readonly ad: string;
  /** First and last year (BC negative), inclusive. */
  readonly yillar: readonly [number, number];
  readonly not?: string;
  readonly taraflar: readonly AtlasSide[];
}

export interface PeriodAtlas {
  readonly schemaVersion: 1;
  readonly donemler: readonly AtlasEra[];
}

export function atlasFile(repoRoot: string): string {
  return path.join(repoRoot, "content", "v3", "donem-atlasi.json");
}

/** The atlas, or an empty one when the file is missing or unreadable (a script is still written without it). */
export function readAtlas(repoRoot: string): PeriodAtlas {
  const file = atlasFile(repoRoot);
  if (!existsSync(file)) return { schemaVersion: 1, donemler: [] };
  try {
    return JSON.parse(readFileSync(file, "utf8")) as PeriodAtlas;
  } catch {
    return { schemaVersion: 1, donemler: [] };
  }
}

/** The eras an episode's period falls in (by its end year: "1812–1815" is 1815). */
export function erasFor(atlas: PeriodAtlas, donem: string): AtlasEra[] {
  const year = periodEndYear(donem);
  if (year === undefined) return [];
  return atlas.donemler.filter((e) => year >= e.yillar[0] && year <= e.yillar[1]);
}

const yearText = (y: number) => (y < 0 ? `${-y} BC` : `${y}`);

/**
 * The writer's period dress block: every side of the matching eras with a costume per rank, as JSON to copy. Undefined
 * when the atlas has no era for the period (the writer chooses as before).
 */
export function periodDressBlock(atlas: PeriodAtlas, donem: string): string | undefined {
  const eras = erasFor(atlas, donem);
  if (!eras.length) return undefined;
  return eras
    .map((e) =>
      [
        `PERIOD DRESS — ${e.ad} (${yearText(e.yillar[0])}–${yearText(e.yillar[1])}), from Atölye's period atlas. Dress every soldier, crowd and side in the story with these costumes for its side and rank (copy the "kostum" and change only what the story needs); a real person's face, beard and own items are designed later from their portrait.`,
        ...e.taraflar.map((s) => `- ${s.ad}: ${s.roller.map((r) => `${r.rol} ${JSON.stringify(r.kostum)}`).join("; ")}`),
        ...(e.not ? [`Note: ${e.not}`] : []),
      ].join("\n"),
    )
    .join("\n\n");
}
