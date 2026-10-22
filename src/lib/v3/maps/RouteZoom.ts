import type { Episode, SceneMap } from "../episode/EpisodeTypes";
import { distanceKm } from "./PlaceCheck";

/** A route shorter than this share of the view's width is a dot on screen. */
export const MIN_ROUTE_SHARE = 0.08;
/** The share of the view a short route fills once the camera moves in. */
export const ROUTE_SHARE_ZOOMED = 0.3;
/** The closest the camera comes (a city is ~150 km wide, MapBuilder's scale). */
export const MIN_ZOOM_KM = 150;

function routeKm(points: readonly (readonly [number, number])[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += distanceKm(points[i - 1]!, points[i]!);
  return km;
}

/**
 * A map whose arrow is too short to see moves its camera in when the arrow is told. The first AYAS order (22 Oct 2026)
 * drew Caesar's 25 km Rubicon crossing on an 1,800 km map of Italy: a red dot under the army badge. The camera moves to
 * the arrow's middle, wide enough for it to fill about a third of the screen, with the arrow's line; a camera move the
 * writer already put on that line is kept.
 */
export function zoomOnShortRoutes(map: SceneMap): { map: SceneMap; zoomed: number } {
  if (!map.merkez || !map.genislik_km || !map.oklar?.length) return { map, zoomed: 0 };
  const keys = [...(map.kamera ?? [])];
  let zoomed = 0;
  for (const ok of map.oklar) {
    if (ok.noktalar.length < 2) continue;
    const line = ok.satir ?? 0;
    // The view when this arrow appears: the latest camera stop at or before its line, else the map's own.
    const view = [...keys].filter((k) => k.satir <= line).sort((a, b) => b.satir - a.satir)[0]?.genislik_km ?? map.genislik_km;
    const km = routeKm(ok.noktalar);
    if (km >= view * MIN_ROUTE_SHARE || keys.some((k) => k.satir === line)) continue;
    const lons = ok.noktalar.map((p) => p[0]);
    const lats = ok.noktalar.map((p) => p[1]);
    const middle: [number, number] = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
    keys.push({ satir: line, merkez: middle, genislik_km: Math.round(Math.max(MIN_ZOOM_KM, km / ROUTE_SHARE_ZOOMED)) });
    zoomed++;
  }
  return zoomed ? { map: { ...map, kamera: keys.sort((a, b) => a.satir - b.satir) }, zoomed } : { map, zoomed: 0 };
}

/** zoomOnShortRoutes on every map of an episode, with the scenes it moved in on. */
export function withRouteZoom(episode: Episode): { episode: Episode; scenes: string[] } {
  const scenes: string[] = [];
  const sahneler = episode.sahneler.map((s) => {
    if (!s.harita) return s;
    const r = zoomOnShortRoutes(s.harita);
    if (!r.zoomed) return s;
    scenes.push(s.id);
    return { ...s, harita: r.map };
  });
  return { episode: scenes.length ? { ...episode, sahneler } : episode, scenes };
}
