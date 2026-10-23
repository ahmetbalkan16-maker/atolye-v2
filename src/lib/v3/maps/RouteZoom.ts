import { CLOSE_MAP_MAX_KM, type Episode, type SceneMap } from "../episode/EpisodeTypes";
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

/** The closest the camera comes on the close battle map (a few streets across). */
export const CLOSE_MIN_ZOOM_KM = 4;
/** A fight further than this share of the view from where the camera looks gets the camera on it. */
export const FIGHT_FOLLOW_SHARE = 0.18;

/** Where the side losing tokens on a line stands (a front's middle, a cluster's or a siege's centre). */
function fightAt(map: SceneMap, line: number): [number, number] | undefined {
  const battle = (map.savaslar ?? []).find((s) => s.satir === line);
  if (battle) return [battle.konum[0], battle.konum[1]];
  for (const u of map.birlikler ?? [])
    for (const y of u.yerler) {
      if (y.satir !== line || !(y.kayip ?? 0)) continue;
      if ("kume" in y) return [y.kume[0], y.kume[1]];
      if ("kusatma" in y) return [y.kusatma[0], y.kusatma[1]];
      if ("cephe" in y && y.cephe.length) {
        const mid = y.cephe[Math.floor((y.cephe.length - 1) / 2)]!;
        const next = y.cephe[Math.ceil((y.cephe.length - 1) / 2)]!;
        return [Math.round(((mid[0] + next[0]) / 2) * 1e5) / 1e5, Math.round(((mid[1] + next[1]) / 2) * 1e5) / 1e5];
      }
    }
  return undefined;
}

export function zoomOnShortRoutes(map: SceneMap): { map: SceneMap; zoomed: number } {
  if (!map.merkez || !map.genislik_km) return { map, zoomed: 0 };
  const close = map.genislik_km <= CLOSE_MAP_MAX_KM;
  // Arrows too short to see, and marches the camera should follow (owner, 22 Oct 2026: "the camera follows the army").
  const routes = [
    ...(map.oklar ?? []).map((o) => ({ points: o.noktalar, line: o.satir ?? 0, share: MIN_ROUTE_SHARE, fill: ROUTE_SHARE_ZOOMED })),
    ...(map.ordular ?? []).filter((o) => o.yol?.length).map((o) => ({ points: [o.konum, ...o.yol!], line: o.yol_satir ?? o.satir ?? 0, share: MARCH_FOLLOW_SHARE, fill: MARCH_SHARE_ZOOMED })),
    ...(map.rozetler ?? []).filter((r) => r.yol?.length).map((r) => ({ points: [r.konum, ...r.yol!], line: r.yol_satir ?? r.satir ?? 0, share: MARCH_FOLLOW_SHARE, fill: MARCH_SHARE_ZOOMED })),
    // A fleet or a column on its way (the 1453 haul over the hill behind Galata was a speck on a 12 km view).
    ...(map.araclar ?? []).filter((a) => a.yol?.length).map((a) => ({ points: [a.konum, ...a.yol!], line: a.yol_satir ?? a.satir ?? 0, share: MARCH_FOLLOW_SHARE, fill: MARCH_SHARE_ZOOMED })),
  ];
  const fightLines = [...new Set((map.birlikler ?? []).flatMap((u) => u.yerler.filter((y) => (y.kayip ?? 0) > 0).map((y) => y.satir)))].sort((a, b) => a - b);
  if (!routes.length && !fightLines.length) return { map, zoomed: 0 };
  const keys = [...(map.kamera ?? [])];
  // The view when a line is told: the latest camera stop at or before it, else the map's own.
  const viewAt = (line: number) => {
    const last = [...keys].filter((k) => k.satir <= line).sort((a, b) => b.satir - a.satir)[0];
    return { km: last?.genislik_km ?? map.genislik_km!, centre: last?.merkez ?? map.merkez! };
  };
  let zoomed = 0;
  for (const r of routes) {
    if (r.points.length < 2) continue;
    const { km: view, centre } = viewAt(r.line);
    const km = routeKm(r.points);
    const lons = r.points.map((p) => p[0]);
    const lats = r.points.map((p) => p[1]);
    const middle: [number, number] = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
    // A march is followed when it is small in the view, larger than the view, or away from where the camera looks
    // (Pompey's flight to Brundisium went off-screen while the camera stayed on Caesar).
    const seen = km >= view * r.share && (r.fill !== MARCH_SHARE_ZOOMED || (km <= view * 0.8 && distanceKm(middle, centre) <= view * 0.25));
    if (seen || keys.some((k) => k.satir === r.line)) continue;
    keys.push({ satir: r.line, merkez: middle, genislik_km: Math.round(Math.max(close ? CLOSE_MIN_ZOOM_KM : MIN_ZOOM_KM, km / r.fill)) });
    zoomed++;
  }
  // A fight the camera is not looking at (the 1453 map, 23 Oct 2026: the defenders fell at the walls while the camera
  // stayed on the Golden Horn): the camera pans to it at the same width with its line.
  for (const line of fightLines) {
    const at = fightAt(map, line);
    if (!at || keys.some((k) => k.satir === line)) continue;
    const { km: view, centre } = viewAt(line);
    if (distanceKm(at, centre) <= view * FIGHT_FOLLOW_SHARE) continue;
    keys.push({ satir: line, merkez: at, genislik_km: view });
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
