import { CLOSE_MAP_MAX_KM, type SceneMap } from "../episode/EpisodeTypes";
import type { V3Paths } from "../V3Paths";
import { type CloseCoast, closeCoastFor, closeRiversFor } from "./CloseCoast";
import { mapWorld, type Polygon } from "./MapBuilder";
import { closeReliefFor, reliefFor } from "./Relief";

/**
 * A map scene's ground, for the production and the map preview alike: a close battle map (genislik_km ≤ 120) gets
 * OpenStreetMap's coast and real elevation painted like an atlas's close map; a wider one Natural Earth's relief.
 */
export async function mapGroundFor(paths: V3Paths, map: SceneMap, publicDir: string, baseLand: readonly Polygon[], log: (s: string) => void = () => {}): Promise<{ relief?: string; coast?: CloseCoast }> {
  const world = mapWorld(map, 1920, 1080);
  if (map.genislik_km !== undefined && map.genislik_km <= CLOSE_MAP_MAX_KM) {
    const coast = await closeCoastFor(paths, world, baseLand, log);
    // Its rivers and lakes too (an inland battle's front, crossing or fleet road), joined to the coast it has.
    const water = await closeRiversFor(paths, world, log);
    const relief = await closeReliefFor(paths, world, publicDir, log);
    const ground = coast || water ? { land: coast?.land ?? [], water: [...(coast?.water ?? []), ...(water?.lakes ?? [])], ...(water?.rivers.length ? { rivers: water.rivers } : {}) } : undefined;
    return { ...(relief ? { relief } : {}), ...(ground ? { coast: ground } : {}) };
  }
  const relief = await reliefFor(paths, world, publicDir, log);
  return relief ? { relief } : {};
}
