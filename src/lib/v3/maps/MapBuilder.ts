import { promises as fs } from "node:fs";
import path from "node:path";
import type { SceneMap } from "../episode/EpisodeTypes";
import type { V3GeoMap } from "../render/RenderPlanTypes";
import { isPolity } from "./HistoricalBorders";

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

function insideRing(x: number, y: number, ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The two lines a long state name is written on (the reference's "SIRP / İMPARATORLUĞU"); MapView splits alike. */
export function labelLines(text: string): string[] {
  const t = text.trim();
  if (t.length <= 12 || !t.includes(" ")) return [t];
  const spaces = [...t.matchAll(/ /g)].map((m) => m.index!);
  const cut = spaces.reduce((a, b) => (Math.abs(b - t.length / 2) < Math.abs(a - t.length / 2) ? b : a));
  return [t.slice(0, cut), t.slice(cut + 1)];
}

/**
 * Where a state's name goes and how big: the area centre of its largest piece in view (a point inside it: for a
 * crescent the middle of its widest span through that centre), at a height that fits the piece — big for an empire,
 * small for a beylik, like the reference maps. The old anchor, the mean of the outline's points, could fall outside a
 * bent state. `zoom`: the first view's scale against the drawn world, `frameHeight`: the picture's (a moving map's
 * world is far taller) — sizes are for the screen.
 */
export function labelPoint(v: MapView, polys: readonly Polygon[], label: string, zoom = 1, frameHeight = v.height): { x: number; y: number; size: number } | undefined {
  let best: [number, number][] | undefined;
  let bestArea = 0;
  for (const poly of polys) {
    const ring = clipRing((poly[0] ?? []).map(([lon, lat]) => project(v, lon, lat)), 0, 0, v.width, v.height);
    if (ring.length < 3) continue;
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i]!;
      const [x1, y1] = ring[(i + 1) % ring.length]!;
      a += x0 * y1 - x1 * y0;
    }
    if (Math.abs(a / 2) > bestArea) {
      bestArea = Math.abs(a / 2);
      best = ring;
    }
  }
  if (!best || bestArea < 1) return undefined;
  let cx = 0, cy = 0, a2 = 0;
  for (let i = 0; i < best.length; i++) {
    const [x0, y0] = best[i]!;
    const [x1, y1] = best[(i + 1) % best.length]!;
    const c = x0 * y1 - x1 * y0;
    a2 += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
  }
  let x = cx / (3 * a2);
  const y = cy / (3 * a2);
  // The widest span of the piece along the centre's row: its middle when the centre falls outside, and the room the
  // name has across.
  const hits: number[] = [];
  for (let i = 0; i < best.length; i++) {
    const [x0, y0] = best[i]!;
    const [x1, y1] = best[(i + 1) % best.length]!;
    if (y0 > y !== y1 > y) hits.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
  }
  hits.sort((p, q) => p - q);
  let span: [number, number] | undefined;
  for (let i = 0; i + 1 < hits.length; i += 2) if (!span || hits[i + 1]! - hits[i]! > span[1] - span[0]) span = [hits[i]!, hits[i + 1]!];
  if (span && !insideRing(x, y, best)) x = (span[0] + span[1]) / 2;
  const across = ((span ? span[1] - span[0] : Math.sqrt(bestArea)) * zoom * 1080) / frameHeight;
  const lines = labelLines(label);
  const longest = Math.max(...lines.map((l) => l.length));
  // Condensed capitals are about half as wide as they are tall; the name takes at most 80% of the span.
  const size = Math.round(Math.max(24, Math.min(64, (Math.sqrt(bestArea) * zoom * 1080) / frameHeight / 5, (across * 0.8) / (longest * 0.55))));
  return { x: r1(x), y: r1(y), size };
}

/**
 * Colours of the period's other states: strong and distinct like the reference maps (teal Byzantium, green Ottomans,
 * orange and pink beyliks, brown Serbia, purple Bulgaria), never the colour of a neighbour.
 */
export const STATE_COLOURS: readonly string[] = ["#3a9e9a", "#3fae3a", "#e07b24", "#9a6a34", "#7a64b8", "#d27fb0", "#a9be3a", "#8a9cbc", "#c9a227", "#b85450", "#4f86c6", "#6fa36b"];

type Box = { readonly west: number; readonly east: number; readonly south: number; readonly north: number };

function boxOf(polys: readonly Polygon[]): Box {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const p of polys)
    for (const [lon, lat] of p[0] ?? []) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  return { west, east, south, north };
}

const touches = (a: Box, b: Box, pad = 0) => a.west - pad <= b.east && b.west - pad <= a.east && a.south - pad <= b.north && b.south - pad <= a.north;

/**
 * The period's states in the world that the scene does not name: the reference maps colour every state's land, so the
 * named ones stand among their neighbours instead of on bare ground. Nameless (the atlas's own names are not always the
 * period's: "Seljuk Caliphate" in 1400), largest first, each in a colour no touching state has.
 */
export function backgroundStates(snapshot: ReadonlyMap<string, readonly Polygon[]>, world: Box, named: readonly { readonly name: string; readonly color: string; readonly polys: readonly Polygon[] }[], isPolity: (name: string) => boolean): { name: string; color: string; polys: readonly Polygon[] }[] {
  const skip = new Set(named.map((n) => n.name.toLowerCase()));
  const found = [...snapshot]
    .filter(([name, polys]) => !skip.has(name) && isPolity(name) && polys.length && touches(boxOf(polys), world))
    .map(([name, polys]) => ({ name, polys, box: boxOf(polys) }))
    .sort((a, b) => (b.box.east - b.box.west) * (b.box.north - b.box.south) - (a.box.east - a.box.west) * (a.box.north - a.box.south));
  const placed: { box: Box; color: string }[] = named.map((n) => ({ box: boxOf(n.polys), color: n.color.toLowerCase() }));
  return found.map((s) => {
    const near = new Set(placed.filter((p) => touches(p.box, s.box, 0.5)).map((p) => p.color));
    let h = 0;
    for (let i = 0; i < s.name.length; i++) h = (h * 31 + s.name.charCodeAt(i)) >>> 0;
    const color = STATE_COLOURS.map((_, j) => STATE_COLOURS[(h + j) % STATE_COLOURS.length]!).find((c) => !near.has(c)) ?? STATE_COLOURS[h % STATE_COLOURS.length]!;
    placed.push({ box: s.box, color });
    return { name: s.name, color, polys: s.polys };
  });
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

type Rect = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Keeps every state's name inside the picture and off the marks near its spot (map still, 21 Oct 2026: "OTTOMAN
 * EMPIRE" covered Bursa, "KINGDOM OF HUNGARY" ran off the top under the crusaders' arrow): the name moves up or down a
 * little, then sideways, to the first place where it covers no city, badge, battle, arrow name or other state's name.
 * `px`: drawn pixels per 1080p screen pixel (MapView keeps names and marks at a constant screen size).
 */
export function placeStateLabels(m: V3GeoMap, width: number, height: number, px: number): V3GeoMap {
  const cityMarks: Rect[] = m.cities.map((c) => ({ x0: c.x - 10 * px, y0: c.y - 16 * px, x1: c.x + (16 + c.label.length * 13) * px, y1: c.y + 16 * px }));
  // An arrow's name goes above the first point along it (middle first) where it covers no city ("CRUSADERS" sat on
  // "Belgrade" in the Nicopolis map trial).
  const arrowRect = (x: number, y: number, label: string) => ({ x0: x - label.length * 10 * px, y0: y - 22 * px, x1: x + label.length * 10 * px, y1: y + 22 * px });
  const arrows = m.arrows.map((ar) => {
    if (!ar.label || ar.points.length < 2) return ar;
    // Above the line first, then below it.
    const spots = [-40, 40].flatMap((dy) =>
      [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8].map((f) => {
        const p = alongPoints(ar.points, f);
        return { x: p.x, y: p.y + dy * px };
      }),
    );
    const spot = spots.find((s) => !cityMarks.some((r) => overlaps(r, arrowRect(s.x, s.y, ar.label!)))) ?? spots[0]!;
    return { ...ar, labelX: r1(spot.x), labelY: r1(spot.y) };
  });
  const marks: Rect[] = [
    ...cityMarks,
    // A badge: the portrait with its name scroll under it stands up to 131 px above its place (MapView, relief map).
    ...(m.badges ?? []).flatMap((b) => (b.path[0] ? [{ x0: b.path[0].x - 75 * px, y0: b.path[0].y - 140 * px, x1: b.path[0].x + 75 * px, y1: b.path[0].y + 6 * px }] : [])),
    ...(m.battles ?? []).map((b) => ({ x0: b.x - (40 + b.label.length * 8) * px, y0: b.y - 92 * px, x1: b.x + (40 + b.label.length * 8) * px, y1: b.y + 50 * px })),
    ...arrows.flatMap((ar) => (ar.label && ar.labelX !== undefined && ar.labelY !== undefined ? [arrowRect(ar.labelX, ar.labelY, ar.label)] : [])),
  ];
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const placed: (Rect & { label: string })[] = [];
  const territories = m.territories.map((t) => {
    if (t.labelX === undefined || t.labelY === undefined || !t.label) return t;
    // A state that changes hands is written twice under one name (old colour out, new colour in): same place.
    const same = placed.find((p) => p.label === t.label);
    if (same) return { ...t, labelX: r1((same.x0 + same.x1) / 2), labelY: r1((same.y0 + same.y1) / 2) };
    const lines = labelLines(t.label.toLocaleUpperCase("en-US"));
    // Full size first; where there is no free place, a smaller name (map still: "HUNGARY" under "CRUSADERS").
    const free = (size: number) => {
      const w = Math.max(...lines.map((l) => l.length)) * 0.52 * size * px;
      const h = lines.length * size * px;
      const at = (dx: number, dy: number) => {
        const x = clamp(t.labelX! + dx, w / 2 + 40 * px, width - w / 2 - 40 * px);
        const y = clamp(t.labelY! + dy, h / 2 + 40 * px, height - h / 2 - 40 * px);
        return { x, y, size, r: { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 } };
      };
      const s = h * 0.6;
      const tries = [[0, 0], [0, s], [0, -s], [0, 2 * s], [0, -2 * s], [w * 0.45, 0], [-w * 0.45, 0], [w * 0.45, s], [-w * 0.45, s], [w * 0.45, -s], [-w * 0.45, -s]] as const;
      return { spot: tries.map(([dx, dy]) => at(dx, dy)).find((c) => ![...marks, ...placed].some((r) => overlaps(r, c.r))), first: at(0, 0) };
    };
    const full = t.labelSize ?? 46;
    const tried = [full, Math.max(24, Math.round(full * 0.75)), Math.max(22, Math.round(full * 0.55))].map((sz) => free(sz));
    const spot = tried.find((x) => x.spot)?.spot ?? tried[0]!.first;
    placed.push({ ...spot.r, label: t.label });
    return { ...t, labelX: r1(spot.x), labelY: r1(spot.y), ...(spot.size !== full ? { labelSize: spot.size } : {}) };
  });
  return { ...m, territories, arrows };
}

/** The point a fraction of the way along a polyline (MapView's `along`, for placing names). */
function alongPoints(points: readonly { x: number; y: number }[], f: number): { x: number; y: number } {
  const seg = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  let rest = Math.max(0, Math.min(1, f)) * seg.reduce((a, b) => a + b, 0);
  for (let i = 0; i < seg.length; i++) {
    if (rest <= seg[i]! || i === seg.length - 1) {
      const u = seg[i]! ? Math.min(1, rest / seg[i]!) : 1;
      return { x: points[i]!.x + (points[i + 1]!.x - points[i]!.x) * u, y: points[i]!.y + (points[i + 1]!.y - points[i]!.y) * u };
    }
    rest -= seg[i]!;
  }
  return points[points.length - 1]!;
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
  // The first view's scale against the world: name sizes are for the screen.
  const zoom0 = moving ? (width / world.keys[0]!.view.spanLon) * (v.spanLon / v.width) : 1;
  const named = (map.bolgeler ?? []).map((b) => ({
    b,
    polys: [
      ...(b.tarihi ? (data.historical?.get(b.tarihi.yil)?.get(b.tarihi.ad.toLowerCase()) ?? []) : []),
      ...(b.ulkeler ?? []).flatMap((iso) => data.countries.get(iso.toUpperCase()) ?? []),
      ...(b.noktalar && b.noktalar.length >= 3 ? [[b.noktalar.map(([lon, lat]) => [lon, lat] as const)]] : []),
    ] as Polygon[],
  }));
  // The period of the scene's first atlas state colours the rest of its map.
  const year = named.find((n) => n.b.tarihi)?.b.tarihi?.yil;
  const snapshot = year !== undefined ? data.historical?.get(year) : undefined;
  const others = snapshot ? backgroundStates(snapshot, world.bounds, named.flatMap((n) => (n.b.tarihi ? [{ name: n.b.tarihi.ad, color: n.b.renk, polys: n.polys }] : [])), isPolity) : [];
  const territories = [
    ...others.map((s) => ({ d: polygonsPath(v, s.polys), color: s.color, label: "", start: 0 })),
    ...named.map(({ b, polys }, i) => {
      const at = labelPoint(v, polys, b.ad, zoom0, height);
      const pin = b.etiket_konum ? project(v, b.etiket_konum[0], b.etiket_konum[1]) : undefined;
      const anchor = pin ? { labelX: r1(pin[0]), labelY: r1(pin[1]) } : at ? { labelX: at.x, labelY: at.y } : {};
      return { d: polygonsPath(v, polys), color: b.renk, label: b.ad, ...anchor, ...(at ? { labelSize: at.size } : {}), start: lineStart(b.satir, i), ...(b.bitis_satir !== undefined ? { end: lineStart(b.bitis_satir, i) } : {}) };
    }),
  ];
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
  const badges = (map.rozetler ?? []).map((r, i) => ({ castId: r.karakter, label: opts.castName?.(r.karakter) ?? r.karakter, start: lineStart(r.satir, i), ...(r.bitis_satir !== undefined ? { end: lineStart(r.bitis_satir, i) } : {}), ...(r.yol_satir !== undefined && r.yol?.length ? { moveStart: lineStart(r.yol_satir, i) } : {}), path: [r.konum, ...(r.yol ?? [])].map((p) => toPx(p)) }));
  const battles = (map.savaslar ?? []).map((w, i) => ({ ...toPx(w.konum), label: w.ad, start: lineStart(w.satir, i) }));
  const drawn: V3GeoMap = {
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
  return placeStateLabels(drawn, v.width, v.height, height / 1080 / zoom0);
}
