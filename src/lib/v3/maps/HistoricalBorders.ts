import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { Episode } from "../episode/EpisodeTypes";
import type { Polygon } from "./MapBuilder";

/**
 * Real historical borders for the maps (owner approval 20 Oct 2026, "find what helps our system"): the world's states
 * and cultural regions at 54 moments from 123000 BC to 2010 (aourednik/historical-basemaps, GPL-3.0 data, pinned to
 * one commit). The writer is told the polity names of the snapshots nearest the episode's year and picks one
 * ("tarihi": {"ad": "Roman Republic", "yil": -100}); the map then draws its real outline instead of a rough one.
 * Files are downloaded on first use into the tools folder (outside git) and credited in CREDITS.md.
 */
export const HISTORICAL_BASEMAPS_COMMIT = "da7a4b735ecef70aebdc9c73e409d8a2500d50f3";
export const HISTORICAL_BASEMAPS_CREDIT = "Historical borders: aourednik/historical-basemaps (GPL-3.0), https://github.com/aourednik/historical-basemaps";

/** Years with a snapshot (negative = BC). */
export const SNAPSHOT_YEARS: readonly number[] = [
  -123000, -10000, -8000, -5000, -4000, -3000, -2000, -1500, -1000, -700, -500, -400, -323, -300, -200, -100, -1, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1279, 1300,
  1400, 1492, 1500, 1530, 1600, 1650, 1700, 1715, 1783, 1800, 1815, 1878, 1880, 1900, 1914, 1920, 1930, 1938, 1945, 1960, 1994, 2000, 2010,
];

export function snapshotFile(year: number): string {
  return year < 0 ? `world_bc${-year}.geojson` : `world_${year}.geojson`;
}

export function yearLabel(year: number): string {
  return year < 0 ? `${-year} BC` : `AD ${year}`;
}

/** The snapshot at or before `year` and the one after it (one when the year is at either end or exact). */
export function nearestSnapshots(year: number): number[] {
  const before = [...SNAPSHOT_YEARS].reverse().find((y) => y <= year);
  const after = SNAPSHOT_YEARS.find((y) => y > year);
  if (before === year) return [year];
  return [before, after].filter((y): y is number => y !== undefined);
}

/** Names that are not polities a viewer would recognise on a map. */
const NOT_A_STATE = /hunter|gatherer|minor states|chiefdom|tribes|nomad|pastoral|farmers|cultures?$|^\s*$/i;

/** A state a map colours (not a culture area, a people or the atlas's "minor states"). */
export function isPolity(name: string): boolean {
  return !NOT_A_STATE.test(name);
}

const loaded = new Map<number, Map<string, Polygon[]>>();

interface GeoJson {
  readonly features: readonly { readonly properties: Record<string, unknown>; readonly geometry: { readonly type: string; readonly coordinates: unknown } | null }[];
}

/** One snapshot: polity name (lower case) → its polygons. Downloaded once into `dir`. */
export async function loadSnapshot(dir: string, year: number): Promise<Map<string, Polygon[]>> {
  const hit = loaded.get(year);
  if (hit) return hit;
  if (!SNAPSHOT_YEARS.includes(year)) throw new Error(`V3_BORDERS_YEAR: ${year} için tarihî sınır dosyası yok`);
  const file = path.join(dir, snapshotFile(year));
  if (!existsSync(file)) {
    const res = await fetch(`https://raw.githubusercontent.com/aourednik/historical-basemaps/${HISTORICAL_BASEMAPS_COMMIT}/geojson/${snapshotFile(year)}`);
    if (!res.ok) throw new Error(`V3_BORDERS_DOWNLOAD_${res.status}: ${snapshotFile(year)}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  const json = JSON.parse(await fs.readFile(file, "utf8")) as GeoJson;
  const map = new Map<string, Polygon[]>();
  for (const f of json.features) {
    const name = String(f.properties.NAME ?? "").trim();
    const g = f.geometry;
    if (!name || !g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates as Polygon] : g.type === "MultiPolygon" ? (g.coordinates as Polygon[]) : [];
    const key = name.toLowerCase();
    map.set(key, [...(map.get(key) ?? []), ...polys]);
  }
  loaded.set(year, map);
  return map;
}

/**
 * The snapshot a writer's atlas year stands for: itself when the atlas has it, else the nearest snapshot that has the
 * state (closest first), else the nearest one. The first AYAS order (22 Oct 2026) wrote "Roman Republic" at -49, which
 * has no snapshot: the state lost its outline and, since a map's other states come from the same snapshot, every other
 * state its colour. `has` answers whether a snapshot year has a state of that (lower-case) name.
 */
export async function atlasYear(year: number, name: string, has: (year: number, name: string) => Promise<boolean>): Promise<number> {
  if (SNAPSHOT_YEARS.includes(year)) return year;
  const near = [...SNAPSHOT_YEARS].sort((a, b) => Math.abs(a - year) - Math.abs(b - year) || a - b).slice(0, 4);
  for (const y of near) if (await has(y, name.toLowerCase()).catch(() => false)) return y;
  return near[0]!;
}

/** Every map's atlas states moved to a snapshot the atlas has (see atlasYear), with what moved for the log. */
export async function withAtlasYears(episode: Episode, has: (year: number, name: string) => Promise<boolean>): Promise<{ episode: Episode; moved: { sahne: string; ad: string; from: number; to: number }[] }> {
  const moved: { sahne: string; ad: string; from: number; to: number }[] = [];
  const sahneler = [];
  for (const s of episode.sahneler) {
    if (!s.harita?.bolgeler?.some((b) => b.tarihi && !SNAPSHOT_YEARS.includes(b.tarihi.yil))) {
      sahneler.push(s);
      continue;
    }
    const bolgeler = [];
    for (const b of s.harita.bolgeler) {
      if (!b.tarihi || SNAPSHOT_YEARS.includes(b.tarihi.yil)) {
        bolgeler.push(b);
        continue;
      }
      const to = await atlasYear(b.tarihi.yil, b.tarihi.ad, has);
      moved.push({ sahne: s.id, ad: b.tarihi.ad, from: b.tarihi.yil, to });
      bolgeler.push({ ...b, tarihi: { ...b.tarihi, yil: to } });
    }
    sahneler.push({ ...s, harita: { ...s.harita, bolgeler } });
  }
  return { episode: moved.length ? { ...episode, sahneler } : episode, moved };
}

/** The polity names of a snapshot a writer may pick from (proper states and peoples, original spelling, sorted). */
export async function snapshotNames(dir: string, year: number): Promise<string[]> {
  await loadSnapshot(dir, year);
  const json = JSON.parse(await fs.readFile(path.join(dir, snapshotFile(year)), "utf8")) as GeoJson;
  const names = new Set(json.features.map((f) => String(f.properties.NAME ?? "").trim()).filter((n) => n && isPolity(n)));
  return [...names].sort();
}
