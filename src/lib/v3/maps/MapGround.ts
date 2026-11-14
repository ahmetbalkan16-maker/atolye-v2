import { CLOSE_MAP_MAX_KM, type SceneMap } from "../episode/EpisodeTypes";
import type { V3Paths } from "../V3Paths";
import { type CloseCoast, closeCoastFor, closeRiversFor } from "./CloseCoast";
import { closeMapTilt, type MapWorld, mapWorld, type Polygon } from "./MapBuilder";
import { closeReliefFor, reliefFor } from "./Relief";
import { groundOf } from "./UnitFraming";

/**
 * A map scene's ground, for the production and the map preview alike: a close battle map (genislik_km ≤ 120) gets
 * OpenStreetMap's coast and real elevation painted like an atlas's close map; a wider one Natural Earth's relief.
 */
export async function mapGroundFor(paths: V3Paths, map: SceneMap, publicDir: string, baseLand: readonly Polygon[], log: (s: string) => void = () => {}): Promise<{ relief?: string; coast?: CloseCoast }> {
  // The world the director draws this map on (UnitFraming.groundOf: the writer's, widened where the director's camera
  // goes past it), so the ground lies exactly under the map; with ATOLYE_V3_EGIK_HARITA=0 the writer's as before.
  const world = groundOf(map, 1920, 1080)?.world ?? mapWorld(map, 1920, 1080);
  if (map.genislik_km !== undefined && map.genislik_km <= CLOSE_MAP_MAX_KM) {
    // A flat close map (ATOLYE_V3_EGIK_HARITA=0) keeps the coast the library already holds for its box, so its picture
    // stays as it was; a tilted one's wider box is assembled anew.
    const coast = await closeCoastFor(paths, world, baseLand, log, closeMapTilt(map) === undefined);
    // Its rivers and lakes too (an inland battle's front, crossing or fleet road), joined to the coast it has.
    const water = await closeWaterFor(map, world, (w) => closeRiversFor(paths, w, log));
    const relief = await closeReliefFor(paths, world, publicDir, log);
    const ground = coast || water ? { land: coast?.land ?? [], water: [...(coast?.water ?? []), ...(water?.lakes ?? [])], ...(water?.rivers.length ? { rivers: water.rivers } : {}) } : undefined;
    return { ...(relief ? { relief } : {}), ...(ground ? { coast: ground } : {}) };
  }
  const relief = await reliefFor(paths, world, publicDir, log);
  return relief ? { relief } : {};
}

/**
 * A close map's rivers and lakes for its world (`lookup`: CloseCoast.closeRiversFor). A tilted map's wider box Overpass
 * does not answer falls back to the flat map's own box (in the library from an earlier production, else a smaller
 * query), so the framed view keeps its water (Waterloo s2, 14 Nov 2026: the ~200 km Belgian box timed out on every mirror,
 * even at 120 s, and the tilted map lost the Dyle and every lake the flat one showed). A flat map asks its own box only.
 */
export async function closeWaterFor<T>(map: SceneMap, world: Pick<MapWorld, "bounds">, lookup: (world: Pick<MapWorld, "bounds">) => Promise<T | undefined>): Promise<T | undefined> {
  return (await lookup(world)) ?? (closeMapTilt(map) !== undefined ? await lookup(mapWorld(map, 1920, 1080, false)) : undefined);
}
