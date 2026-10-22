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
/** A march (an army's or a ruler's route) smaller than this share of the view gets the camera to follow it. */
export const MARCH_FOLLOW_SHARE = 0.45;
/** The share of the view a followed march fills. */
export const MARCH_SHARE_ZOOMED = 0.55;

export function zoomOnShortRoutes(map: SceneMap): { map: SceneMap; zoomed: number } {
  if (!map.merkez || !map.genislik_km) return { map, zoomed: 0 };
  // Arrows too short to see, and marches the camera should follow (owner, 22 Oct 2026: "the camera follows the army").
  const routes = [
    ...(map.oklar ?? []).map((o) => ({ points: o.noktalar, line: o.satir ?? 0, share: MIN_ROUTE_SHARE, fill: ROUTE_SHARE_ZOOMED })),
    ...(map.ordular ?? []).filter((o) => o.yol?.length).map((o) => ({ points: [o.konum, ...o.yol!], line: o.yol_satir ?? o.satir ?? 0, share: MARCH_FOLLOW_SHARE, fill: MARCH_SHARE_ZOOMED })),
    ...(map.rozetler ?? []).filter((r) => r.yol?.length).map((r) => ({ points: [r.konum, ...r.yol!], line: r.yol_satir ?? r.satir ?? 0, share: MARCH_FOLLOW_SHARE, fill: MARCH_SHARE_ZOOMED })),
  ];
  if (!routes.length) return { map, zoomed: 0 };
  const keys = [...(map.kamera ?? [])];
  let zoomed = 0;
  for (const r of routes) {
    if (r.points.length < 2) continue;
    // The view when this route is told: the latest camera stop at or before its line, else the map's own.
    const last = [...keys].filter((k) => k.satir <= r.line).sort((a, b) => b.satir - a.satir)[0];
    const view = last?.genislik_km ?? map.genislik_km;
    const centre = last?.merkez ?? map.merkez;
    const km = routeKm(r.points);
    const lons = r.points.map((p) => p[0]);
    const lats = r.points.map((p) => p[1]);
    const middle: [number, number] = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
    // A march is followed when it is small in the view, larger than the view, or away from where the camera looks
    // (Pompey's flight to Brundisium went off-screen while the camera stayed on Caesar).
    const seen = km >= view * r.share && (r.fill !== MARCH_SHARE_ZOOMED || (km <= view * 0.8 && distanceKm(middle, centre) <= view * 0.25));
    if (seen || keys.some((k) => k.satir === r.line)) continue;
    keys.push({ satir: r.line, merkez: middle, genislik_km: Math.round(Math.max(MIN_ZOOM_KM, km / r.fill)) });
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
