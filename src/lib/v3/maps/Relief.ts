import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { sideProcessEnv } from "../tts/Tts";
import { USER_AGENT } from "../backgrounds/CommonsProvider";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";
import type { MapWorld } from "./MapBuilder";

/**
 * Terrain relief under drawn maps (owner, 21 Oct 2026: narration over maps like the reference channel Hayalhanem
 * Ankara). The image is Natural Earth I with shaded relief, water and drainages (public domain), cut once into tiles by
 * `scripts/v3/relief_crop.py prepare`; a map gets the part its world spans, coloured towards the reference (olive land,
 * deep blue sea), kept in the library by its bounds and given to the episode. No tiles, or a cut that fails: undefined,
 * and the map is drawn flat as before.
 */
export const RELIEF_CREDIT = "Terrain relief: Natural Earth I with Shaded Relief, Water and Drainages (public domain, naturalearthdata.com)";
/** Bump when the colouring of scripts/v3/relief_crop.py changes, so the library cuts again. */
const RELIEF_VERSION = 3;
const SOURCE_PX_PER_DEG = 60;
const MAX_WIDTH = 8192;
const MIN_WIDTH = 960;
/** How far past the source's own resolution the cut is enlarged (Lanczos + a light sharpening in relief_crop.py). */
const MAX_UPSCALE = 2.5;

export function reliefTilesDir(paths: Pick<V3Paths, "mapsDir">): string {
  return path.join(paths.mapsDir, "relief");
}

export function reliefAvailable(paths: Pick<V3Paths, "mapsDir">): boolean {
  return existsSync(path.join(reliefTilesDir(paths), "00_00.jpg"));
}

/**
 * The image size for a world: the size it is drawn at (its closest view), at most MAX_UPSCALE times the source's own
 * resolution across it, the width shrunk by the cosine of its latitude like the map's projection, kept to the world's
 * aspect. Enlarged here with Lanczos and a light sharpening, the terrain stays crisper on a close view than when
 * Chrome stretched the source-sized image (owner, 21 Oct 2026: "raise the quality as far as you can").
 */
export function reliefSize(world: Pick<MapWorld, "view" | "bounds">): { width: number; height: number } {
  const kx = Math.max(0.2, Math.cos((world.view.lat0 * Math.PI) / 180));
  const source = (world.bounds.east - world.bounds.west) * SOURCE_PX_PER_DEG * kx;
  const width = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, source, Math.min(world.view.width, source * MAX_UPSCALE))));
  return { width, height: Math.max(1, Math.round((width * world.view.height) / world.view.width)) };
}

export const CLOSE_RELIEF_CREDIT = "Elevation: Terrain Tiles on AWS Open Data (Mapzen; SRTM, GMTED, ETOPO1 and others)";
const TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const CLOSE_RELIEF_VERSION = 1;
/** SRTM's ~30 m: closer tiles add nothing. */
const MAX_TILE_ZOOM = 13;
const MAX_TILES = 160;

/** The Terrarium tiles covering a box at the zoom whose detail matches `width` px across it (at most 2.5× enlarged). */
export function closeTiles(b: { west: number; east: number; south: number; north: number }, width: number): { z: number; x0: number; y0: number; x1: number; y1: number } {
  const tile = (z: number) => {
    const n = 2 ** z;
    const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n);
    const ty = (lat: number) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
    return { z, x0: tx(b.west), x1: tx(b.east), y0: ty(b.north), y1: ty(b.south) };
  };
  let z = 1;
  while (z < MAX_TILE_ZOOM && (256 * 2 ** z * (b.east - b.west)) / 360 < width / 2.5) z++;
  let t = tile(z);
  while (t.z > 1 && (t.x1 - t.x0 + 1) * (t.y1 - t.y0 + 1) > MAX_TILES) t = tile(t.z - 1);
  return t;
}

/**
 * The close battle map's ground (owner, 22 Oct 2026): real elevation from the Terrain Tiles on AWS (open data), the
 * tiles kept under the maps dir, painted with atlas colours and hillshade by `scripts/v3/terrain_close.py`, kept in the
 * library by bounds and size. Undefined when tiles cannot be had (the map then has no terrain under it).
 */
export async function closeReliefFor(paths: V3Paths, world: MapWorld, publicDir: string, log: (s: string) => void = () => {}): Promise<string | undefined> {
  const b = world.bounds;
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, world.view.width));
  const size = { width, height: Math.max(1, Math.round((width * world.view.height) / world.view.width)) };
  const t = closeTiles(b, width);
  const key = createHash("sha256").update(JSON.stringify({ v: CLOSE_RELIEF_VERSION, b: [b.west, b.east, b.south, b.north].map((n) => Math.round(n * 10_000) / 10_000), size, t })).digest("hex").slice(0, 20);
  const lib = path.join(paths.workRoot, "_kutuphane", "harita-zemin", `yakin-${key}.jpg`);
  if (!existsSync(lib)) {
    const dir = path.join(paths.mapsDir, "terrarium");
    const want: [number, number][] = [];
    for (let x = t.x0; x <= t.x1; x++) for (let y = t.y0; y <= t.y1; y++) if (!existsSync(path.join(dir, String(t.z), String(x), `${y}.png`))) want.push([x, y]);
    try {
      // A few at a time, politely; tiles once fetched are kept for good.
      for (let i = 0; i < want.length; i += 4)
        await Promise.all(
          want.slice(i, i + 4).map(async ([x, y]) => {
            const res = await fetch(`${TERRARIUM}/${t.z}/${x}/${y}.png`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
            if (!res.ok) throw new Error(`TERRARIUM_HTTP_${res.status}`);
            const file = path.join(dir, String(t.z), String(x), `${y}.png`);
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
          }),
        );
      await fs.mkdir(path.dirname(lib), { recursive: true });
      await fs.mkdir(paths.asciiTemp, { recursive: true });
      const tmp = path.join(paths.asciiTemp, `yakin-${key}.jpg`);
      try {
        await runChecked(paths.genPython, ["-I", path.join(paths.repoRoot, "scripts", "v3", "terrain_close.py"), dir, ...[t.z, t.x0, t.y0, t.x1, t.y1, b.west, b.east, b.south, b.north, size.width, size.height].map(String), tmp], { env: sideProcessEnv(paths), timeoutMs: 180_000 });
        if (!existsSync(lib)) await fs.copyFile(tmp, lib);
      } finally {
        await fs.rm(tmp, { force: true });
      }
    } catch (e) {
      log(`⚠ yakın harita zemini kurulamadı (${(e as Error).message.slice(0, 120)}); zeminsiz çizilir`);
      return undefined;
    }
  }
  const name = `harita-yakin-${key}.jpg`;
  await fs.mkdir(path.join(publicDir, "bg"), { recursive: true });
  await fs.copyFile(lib, path.join(publicDir, "bg", name));
  return `bg/${name}`;
}

/** The relief for a map world, copied into the episode's public dir; returns its `src`, or undefined (flat map). */
export async function reliefFor(paths: V3Paths, world: MapWorld, publicDir: string, log: (s: string) => void = () => {}): Promise<string | undefined> {
  if (!reliefAvailable(paths)) return undefined;
  const b = world.bounds;
  const size = reliefSize(world);
  const key = createHash("sha256").update(JSON.stringify({ v: RELIEF_VERSION, b: [b.west, b.east, b.south, b.north].map((n) => Math.round(n * 1000) / 1000), size })).digest("hex").slice(0, 20);
  const lib = path.join(paths.workRoot, "_kutuphane", "harita-zemin", `${key}.jpg`);
  if (!existsSync(lib)) {
    await fs.mkdir(path.dirname(lib), { recursive: true });
    await fs.mkdir(paths.asciiTemp, { recursive: true });
    const tmp = path.join(paths.asciiTemp, `zemin-${key}.jpg`);
    try {
      await runChecked(paths.genPython, ["-I", path.join(paths.repoRoot, "scripts", "v3", "relief_crop.py"), "crop", reliefTilesDir(paths), String(b.west), String(b.east), String(b.south), String(b.north), String(size.width), String(size.height), tmp], { env: sideProcessEnv(paths), timeoutMs: 120_000 });
      // Append-only library: a cut is never replaced (same bounds, same colouring, same image).
      if (!existsSync(lib)) await fs.copyFile(tmp, lib);
    } catch (e) {
      log(`⚠ harita zemini kesilemedi (${(e as Error).message.slice(0, 120)}); düz harita çizilir`);
      return undefined;
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
  const name = `harita-zemin-${key}.jpg`;
  await fs.mkdir(path.join(publicDir, "bg"), { recursive: true });
  await fs.copyFile(lib, path.join(publicDir, "bg", name));
  return `bg/${name}`;
}
