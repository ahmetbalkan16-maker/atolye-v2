import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { sideProcessEnv } from "../tts/Tts";
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
const RELIEF_VERSION = 1;
const SOURCE_PX_PER_DEG = 60;
const MAX_WIDTH = 4096;
const MIN_WIDTH = 960;

export function reliefTilesDir(paths: Pick<V3Paths, "mapsDir">): string {
  return path.join(paths.mapsDir, "relief");
}

export function reliefAvailable(paths: Pick<V3Paths, "mapsDir">): boolean {
  return existsSync(path.join(reliefTilesDir(paths), "00_00.jpg"));
}

/**
 * The image size for a world: the source's own resolution across it (no detail is invented), the width shrunk by the
 * cosine of its latitude like the map's projection, kept to the world's aspect.
 */
export function reliefSize(world: Pick<MapWorld, "view" | "bounds">): { width: number; height: number } {
  const kx = Math.max(0.2, Math.cos((world.view.lat0 * Math.PI) / 180));
  const width = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, (world.bounds.east - world.bounds.west) * SOURCE_PX_PER_DEG * kx)));
  return { width, height: Math.max(1, Math.round((width * world.view.height) / world.view.width)) };
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
