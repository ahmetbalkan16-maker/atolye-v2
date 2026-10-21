import { promises as fs } from "node:fs";
import path from "node:path";
import type { SceneMap } from "../episode/EpisodeTypes";
import type { V3GeoMap } from "../render/RenderPlanTypes";

/**
 * OverSimplified-style maps from Natural Earth (public domain) vector data: land, lakes and rivers of the view,
 * territories (real historical borders of the period from HistoricalBorders, modern countries by ISO code, or rough
 * lon/lat outlines the script draws — clipped to the coast so they look exact), cities, armies and arrows. Everything is projected here (equirectangular, x scaled by the cosine
 * of the centre latitude) into frame pixels and clipped to the view, so the renderer only draws SVG paths.
 */
export interface MapData {
  readonly land: Polygon[];
  readonly lakes: Polygon[];
  readonly rivers: Line[];
  readonly countries: ReadonlyMap<string, Polygon[]>;
  /** Historical borders by snapshot year → polity name (lower case) → polygons (HistoricalBorders). */
  readonly historical?: ReadonlyMap<number, ReadonlyMap<string, Polygon[]>>;
}

type Ring = readonly (readonly [number, number])[];
export type Polygon = readonly Ring[];
type Line = Ring;

interface GeoJson {
  readonly features: readonly { readonly properties: Record<string, unknown>; readonly geometry: { readonly type: string; readonly coordinates: unknown } | null }[];
}

function polygonsOf(g: { type: string; coordinates: unknown } | null): Polygon[] {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates as Polygon];
  if (g.type === "MultiPolygon") return g.coordinates as Polygon[];
  return [];
}

function linesOf(g: { type: string; coordinates: unknown } | null): Line[] {
  if (!g) return [];
  if (g.type === "LineString") return [g.coordinates as Line];
  if (g.type === "MultiLineString") return g.coordinates as Line[];
  return [];
}

let cached: MapData | undefined;

/** Natural Earth 1:50m files from `dir` (ne_50m_land, _lakes, _rivers_lake_centerlines, _admin_0_countries). */
export async function loadMapData(dir: string): Promise<MapData> {
  if (cached) return cached;
  const read = async (n: string) => JSON.parse(await fs.readFile(path.join(dir, `${n}.geojson`), "utf8")) as GeoJson;
  const [land, lakes, rivers, countries] = await Promise.all([read("ne_50m_land"), read("ne_50m_lakes"), read("ne_50m_rivers_lake_centerlines"), read("ne_50m_admin_0_countries")]);
  const byIso = new Map<string, Polygon[]>();
  for (const f of countries.features) {
    for (const k of ["ISO_A3", "ADM0_A3", "ISO_A3_EH"]) {
      const iso = String(f.properties[k] ?? "");
      if (/^[A-Z]{3}$/.test(iso) && !byIso.has(iso)) byIso.set(iso, polygonsOf(f.geometry));
    }
  }
  cached = {
    land: land.features.flatMap((f) => polygonsOf(f.geometry)),
    lakes: lakes.features.flatMap((f) => polygonsOf(f.geometry)),
    rivers: rivers.features.filter((f) => Number(f.properties.scalerank ?? 9) <= 6).flatMap((f) => linesOf(f.geometry)),
    countries: byIso,
  };
  return cached;
}

export interface MapView {
  readonly lon0: number;
  readonly lat0: number;
  /** Degrees of longitude and latitude the frame spans. */
  readonly spanLon: number;
  readonly spanLat: number;
  readonly width: number;
  readonly height: number;
}

export function mapView(center: readonly [number, number], widthKm: number, width: number, height: number): MapView {
  const [lon0, lat0] = center;
  const kx = Math.max(0.2, Math.cos((lat0 * Math.PI) / 180));
  const spanLon = widthKm / (111.32 * kx);
  const spanLat = (spanLon * kx * height) / width;
  return { lon0, lat0, spanLon, spanLat, width, height };
}

export function project(v: MapView, lon: number, lat: number): [number, number] {
  return [((lon - v.lon0) / v.spanLon + 0.5) * v.width, (0.5 - (lat - v.lat0) / v.spanLat) * v.height];
}

/** Sutherland–Hodgman clip of a closed ring to a rectangle (enough for land and territories in a frame). */
export function clipRing(ring: readonly (readonly [number, number])[], x0: number, y0: number, x1: number, y1: number): [number, number][] {
  let out: [number, number][] = ring.map((p) => [p[0], p[1]]);
  const edges: [(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]][] = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ];
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]!;
      const prev = input[(i + input.length - 1) % input.length]!;
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Projected, clipped polygons as one SVG path (even-odd holes kept). */
function polygonsPath(v: MapView, polys: readonly Polygon[]): string {
  const m = Math.max(v.width, v.height) * 0.1;
  const parts: string[] = [];
  for (const poly of polys) {
    for (const ring of poly) {
      const clipped = clipRing(ring.map(([lon, lat]) => project(v, lon, lat)), -m, -m, v.width + m, v.height + m);
      if (clipped.length < 3) continue;
      // Drop points closer than half a pixel to the previous one.
      const pts: [number, number][] = [];
      for (const p of clipped) {
        const last = pts[pts.length - 1];
        if (!last || Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) > 0.5) pts.push(p);
      }
      if (pts.length >= 3) parts.push(`M${pts.map((p) => `${r1(p[0])} ${r1(p[1])}`).join("L")}Z`);
    }
  }
  return parts.join("");
}

function linesPath(v: MapView, lines: readonly Line[]): string {
  const parts: string[] = [];
  for (const line of lines) {
    let run: string[] = [];
    for (const [lon, lat] of line) {
      const [x, y] = project(v, lon, lat);
      if (x < -50 || y < -50 || x > v.width + 50 || y > v.height + 50) {
        if (run.length > 1) parts.push(`M${run.join("L")}`);
        run = [];
        continue;
      }
      run.push(`${r1(x)} ${r1(y)}`);
    }
    if (run.length > 1) parts.push(`M${run.join("L")}`);
  }
  return parts.join("");
}

/** Centroid of the projected territory outline (label anchor), or undefined when it is off frame. */
function labelPoint(v: MapView, polys: readonly Polygon[]): [number, number] | undefined {
  let sx = 0, sy = 0, n = 0;
  for (const poly of polys) {
    for (const [lon, lat] of poly[0] ?? []) {
      const [x, y] = project(v, lon, lat);
      if (x >= 0 && y >= 0 && x <= v.width && y <= v.height) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  return n ? [sx / n, sy / n] : undefined;
}

/** Half the size of an army block with its name above it, in 1080p pixels (MapView draws 68×44 and the name 48 above). */
const ARMY_HALF_W = 40;
const ARMY_REACH_UP = 70;

/**
 * Keeps a map readable (the Rubicon map showed "CAESAR" twice and an army block on top of "Ariminum"): an arrow whose
 * label repeats an army's name loses its label, and an army standing on a city moves beside it — to the left, since
 * the city's name is written to its right, or above when the left is off the frame.
 */
export function declutterMap(m: V3GeoMap, height: number): V3GeoMap {
  const k = height / 1080;
  const armyNames = new Set(m.armies.map((a) => a.label.trim().toLowerCase()));
  const arrows = m.arrows.map((ar) => (ar.label && armyNames.has(ar.label.trim().toLowerCase()) ? { points: ar.points, color: ar.color, start: ar.start } : ar));
  const armies = m.armies.map((a) => {
    const city = m.cities.find((c) => Math.abs(c.x - a.x) < (ARMY_HALF_W + 30) * k && Math.abs(c.y - a.y) < 50 * k);
    if (!city) return a;
    const left = city.x - (ARMY_HALF_W + 40) * k;
    return left - ARMY_HALF_W * k >= 20 * k ? { ...a, x: r1(left), y: city.y } : { ...a, x: city.x, y: r1(Math.max(ARMY_REACH_UP * k, city.y - 90 * k)) };
  });
  return { ...m, armies, arrows };
}

/**
 * Where a lone character stands on a map (stage x 0..1): the place that hides the fewest names, cities and armies
 * (the Rubicon map's character stood on "Rome"). The figure covers about a fifth of the width and the lower 60% of
 * the frame; the middle wins a tie.
 */
export function mapStageX(m: V3GeoMap, width: number, height: number): number {
  const k = height / 1080;
  const marks: { x0: number; x1: number; y: number }[] = [
    ...m.cities.map((c) => ({ x0: c.x - 12 * k, x1: c.x + (18 + c.label.length * 17) * k, y: c.y })),
    ...m.armies.map((a) => ({ x0: a.x - ARMY_HALF_W * k, x1: a.x + ARMY_HALF_W * k, y: a.y })),
    ...m.territories.flatMap((t) => (t.labelX !== undefined && t.labelY !== undefined ? [{ x0: t.labelX - t.label.length * 14 * k, x1: t.labelX + t.label.length * 14 * k, y: t.labelY }] : [])),
    ...m.arrows.flatMap((ar) => (ar.points.length ? [{ x0: ar.points[ar.points.length - 1]!.x - 20 * k, x1: ar.points[ar.points.length - 1]!.x + 20 * k, y: ar.points[ar.points.length - 1]!.y }] : [])),
  ];
  const hidden = (x: number) => marks.filter((p) => p.y > height * 0.38 && p.x1 > (x - 0.11) * width && p.x0 < (x + 0.11) * width).length;
  let best = 0.5;
  for (const x of [0.5, 0.26, 0.74, 0.16, 0.84]) if (hidden(x) < hidden(best)) best = x;
  return best;
}

/**
 * The render map of a scene's geographic `harita` (needs `merkez` and `genislik_km`). Line indexes (`satir`) become
 * frames through `lineStart`, so a territory or an arrow appears when the narrator mentions it.
 */
export function buildGeoMap(
  map: SceneMap,
  data: MapData,
  width: number,
  height: number,
  lineStart: (index: number | undefined, order: number) => number,
  opts: { readonly relief?: string; readonly castName?: (id: string) => string | undefined } = {},
): V3GeoMap {
  return declutterMap(projectGeoMap(map, data, width, height, lineStart, opts), height);
}

/** The largest world (pixels a side) a moving map is drawn in; a closer view is then enlarged a little. */
const MAX_WORLD_PX = 16_000;

export interface MapWorld {
  /** The world's own view: every feature is projected with it. */
  readonly view: MapView;
  /** The world in degrees (the relief image is cut to exactly this). */
  readonly bounds: { readonly west: number; readonly east: number; readonly south: number; readonly north: number };
  /** The scene's views: the first at `merkez`, then one per `kamera` key. */
  readonly keys: readonly { readonly satir?: number; readonly view: MapView }[];
}

/**
 * The map a scene draws: its own view, or — with `kamera` keys — a world spanning every view (and a margin), at the
 * scale of the closest one, so the camera can move from region to region over one map.
 */
export function mapWorld(map: SceneMap, width: number, height: number): MapWorld {
  const keys = [{ view: mapView(map.merkez!, map.genislik_km!, width, height) }, ...(map.kamera ?? []).map((k) => ({ satir: k.satir, view: mapView(k.merkez, k.genislik_km, width, height) }))];
  if (keys.length === 1) {
    const v = keys[0]!.view;
    return { view: v, bounds: { west: v.lon0 - v.spanLon / 2, east: v.lon0 + v.spanLon / 2, south: v.lat0 - v.spanLat / 2, north: v.lat0 + v.spanLat / 2 }, keys };
  }
  const west0 = Math.min(...keys.map((k) => k.view.lon0 - k.view.spanLon / 2));
  const east0 = Math.max(...keys.map((k) => k.view.lon0 + k.view.spanLon / 2));
  const south0 = Math.min(...keys.map((k) => k.view.lat0 - k.view.spanLat / 2));
  const north0 = Math.max(...keys.map((k) => k.view.lat0 + k.view.spanLat / 2));
  const mx = (east0 - west0) * 0.05;
  const my = (north0 - south0) * 0.05;
  const bounds = { west: Math.max(-180, west0 - mx), east: Math.min(180, east0 + mx), south: Math.max(-85, south0 - my), north: Math.min(85, north0 + my) };
  const lat0 = (bounds.south + bounds.north) / 2;
  const kx = Math.max(0.2, Math.cos((lat0 * Math.PI) / 180));
  const spanLon = bounds.east - bounds.west;
  const spanLat = bounds.north - bounds.south;
  let pxPerLon = Math.max(...keys.map((k) => width / k.view.spanLon));
  pxPerLon = Math.min(pxPerLon, MAX_WORLD_PX / spanLon, (MAX_WORLD_PX * kx) / spanLat);
  const view: MapView = { lon0: (bounds.west + bounds.east) / 2, lat0, spanLon, spanLat, width: Math.round(spanLon * pxPerLon), height: Math.round((spanLat * pxPerLon) / kx) };
  return { view, bounds, keys };
}

function projectGeoMap(
  map: SceneMap,
  data: MapData,
  width: number,
  height: number,
  lineStart: (index: number | undefined, order: number) => number,
  opts: { readonly relief?: string; readonly castName?: (id: string) => string | undefined },
): V3GeoMap {
  const world = mapWorld(map, width, height);
  const v = world.view;
  const moving = world.keys.length > 1;
  const territories = (map.bolgeler ?? []).map((b, i) => {
    const polys: Polygon[] = [
      ...(b.tarihi ? (data.historical?.get(b.tarihi.yil)?.get(b.tarihi.ad.toLowerCase()) ?? []) : []),
      ...(b.ulkeler ?? []).flatMap((iso) => data.countries.get(iso.toUpperCase()) ?? []),
      ...(b.noktalar && b.noktalar.length >= 3 ? [[b.noktalar.map(([lon, lat]) => [lon, lat] as const)]] : []),
    ];
    const at = b.etiket_konum ? project(v, b.etiket_konum[0], b.etiket_konum[1]) : labelPoint(v, polys);
    return { d: polygonsPath(v, polys), color: b.renk, label: b.ad, ...(at ? { labelX: r1(at[0]), labelY: r1(at[1]) } : {}), start: lineStart(b.satir, i), ...(b.bitis_satir !== undefined ? { end: lineStart(b.bitis_satir, i) } : {}) };
  });
  const toPx = (p: readonly [number, number]) => {
    const [x, y] = project(v, p[0], p[1]);
    return { x: r1(x), y: r1(y) };
  };
  // A key's zoom: how much of the world's width its view shows against the frame (the closest view is 1).
  const camera = moving
    ? world.keys
        .map((k, i) => ({ frame: i === 0 ? 0 : lineStart(k.satir, i), ...toPx([k.view.lon0, k.view.lat0]), zoom: Math.round(((width / k.view.spanLon) * v.spanLon * 1000) / v.width) / 1000 }))
        .sort((a, b) => a.frame - b.frame)
    : undefined;
  const badges = (map.rozetler ?? []).map((r, i) => ({ castId: r.karakter, label: opts.castName?.(r.karakter) ?? r.karakter, start: lineStart(r.satir, i), ...(r.bitis_satir !== undefined ? { end: lineStart(r.bitis_satir, i) } : {}), path: [r.konum, ...(r.yol ?? [])].map((p) => toPx(p)) }));
  const battles = (map.savaslar ?? []).map((w, i) => ({ ...toPx(w.konum), label: w.ad, start: lineStart(w.satir, i) }));
  return {
    land: polygonsPath(v, data.land),
    lakes: polygonsPath(v, data.lakes),
    rivers: linesPath(v, data.rivers),
    territories,
    cities: (map.sehirler ?? []).map((c) => ({ ...toPx(c.konum), label: c.ad })),
    armies: (map.ordular ?? []).map((a, i) => ({ ...toPx(a.konum), label: a.ad, color: a.renk, start: lineStart(a.satir, i) })),
    arrows: (map.oklar ?? []).map((o, i) => ({ points: o.noktalar.map((p) => toPx(p)), color: o.renk ?? "#e0283c", ...(o.etiket ? { label: o.etiket } : {}), start: lineStart(o.satir, i) })),
    ...(moving ? { world: { width: v.width, height: v.height }, camera } : {}),
    ...(opts.relief ? { relief: opts.relief } : {}),
    ...(badges.length ? { badges } : {}),
    ...(battles.length ? { battles } : {}),
  };
}
