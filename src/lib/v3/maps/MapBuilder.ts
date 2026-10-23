import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { CLOSE_MAP_MAX_KM, type SceneMap, type UnitFormation } from "../episode/EpisodeTypes";
import type { V3GeoMap } from "../render/RenderPlanTypes";
import { type AdminUnit, assignUnits, coastEdges, dissolve, inOutline, loadAdminUnits, unitPolygons, unitsIn } from "./AdminUnits";
import { placeCloseLabels } from "./CloseLabels";
import { isPolity } from "./HistoricalBorders";
import { LABEL_CHAR_W, labelLines } from "./LabelText";

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
  /** Today's provinces the states are rebuilt from, for realistic borders (AdminUnits); absent: atlas outlines. */
  readonly admin?: readonly AdminUnit[];
  /** Named seas and gulfs (Natural Earth marine polygons, public domain) for the atlas-like sea names. */
  readonly seas?: readonly { readonly name: string; readonly nameTr?: string; readonly polys: Polygon[] }[];
}

/** The sea names file (Natural Earth 1:50m marine polygons; scripts/v3/il-sinirlari-hazirla.ts fetches it). */
export const SEAS_FILE = "ne_50m_geography_marine_polys.geojson";

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

/** The map data with a close map's own coast (OpenStreetMap) in place of Natural Earth's; its enclosed water joins the lakes. */
export function withCoast(data: MapData, coast: { readonly land: Polygon[]; readonly water: Polygon[] } | undefined): MapData {
  return coast?.land.length ? { ...data, land: coast.land, lakes: [...coast.water, ...data.lakes] } : data;
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
  const admin = await loadAdminUnits(dir);
  // Seas and gulfs a viewer knows (scale rank up to 5); oceans are too large to name on a regional map.
  const seas = existsSync(path.join(dir, SEAS_FILE))
    ? (await read(SEAS_FILE.replace(/\.geojson$/, ""))).features
        .filter((f) => ["sea", "gulf"].includes(String(f.properties.featurecla)) && Number(f.properties.scalerank ?? 9) <= 5)
        .map((f) => ({ name: String(f.properties.name ?? ""), ...(f.properties.name_tr ? { nameTr: String(f.properties.name_tr) } : {}), polys: polygonsOf(f.geometry) }))
    : undefined;
  cached = {
    ...(seas?.length ? { seas } : {}),
    land: land.features.flatMap((f) => polygonsOf(f.geometry)),
    lakes: lakes.features.flatMap((f) => polygonsOf(f.geometry)),
    rivers: rivers.features.filter((f) => Number(f.properties.scalerank ?? 9) <= 6).flatMap((f) => linesOf(f.geometry)),
    countries: byIso,
    ...(admin ? { admin } : {}),
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

/**
 * The whole turns of the globe (±360°) that bring a longitude nearest the view's centre: on a Pacific map Hawaii
 * (−158°) is drawn at 202° next to Japan. A shape moves as one, by its first point (Natural Earth cuts shapes at ±180).
 * On a map away from the 180th meridian it is always 0.
 */
export function shiftFor(v: Pick<MapView, "lon0">, lon: number): number {
  return 360 * Math.round((v.lon0 - lon) / 360) || 0;
}

/** A point projected on the copy of the globe nearest the view's centre. */
export function projectNear(v: MapView, lon: number, lat: number): [number, number] {
  return project(v, lon + shiftFor(v, lon), lat);
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
    const s = shiftFor(v, poly[0]?.[0]?.[0] ?? v.lon0);
    for (const ring of poly) {
      const clipped = clipRing(ring.map(([lon, lat]) => project(v, lon + s, lat)), -m, -m, v.width + m, v.height + m);
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
    const s = shiftFor(v, line[0]?.[0] ?? v.lon0);
    for (const [lon, lat] of line) {
      const [x, y] = project(v, lon + s, lat);
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

export { labelLines };

/**
 * Where a state's name goes and how big: the area centre of its largest piece in view (a point inside it: for a
 * crescent the middle of its widest span through that centre), at a height that fits the piece — big for an empire,
 * small for a beylik, like the reference maps. The old anchor, the mean of the outline's points, could fall outside a
 * bent state. `zoom`: the first view's scale against the drawn world, `frameHeight`: the picture's (a moving map's
 * world is far taller) — sizes are for the screen.
 */
export function labelPoint(v: MapView, polys: readonly Polygon[], label: string, zoom = 1, frameHeight = v.height): { x: number; y: number; size: number; ring: readonly (readonly [number, number])[] } | undefined {
  let best: [number, number][] | undefined;
  let bestArea = 0;
  for (const poly of polys) {
    const s = shiftFor(v, poly[0]?.[0]?.[0] ?? v.lon0);
    const ring = clipRing((poly[0] ?? []).map(([lon, lat]) => project(v, lon + s, lat)), 0, 0, v.width, v.height);
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
  // Condensed capitals are a little over half as wide as they are tall; the name takes at most 75% of the span. A bit
  // smaller than at first (owner, 21 Oct 2026: "biraz daha küçük"); placeStateLabels then fits it inside the state.
  const size = Math.round(Math.max(LABEL_MIN, Math.min(50, (Math.sqrt(bestArea) * zoom * 1080) / frameHeight / 6, (across * 0.75) / (longest * LABEL_CHAR_W))));
  return { x: r1(x), y: r1(y), size, ring: best };
}

/** The smallest state name (a condensed capital's width against its height: LABEL_CHAR_W). */
const LABEL_MIN = 20;

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
/** Whether two boxes meet on the globe (a box at 170° W meets a Pacific world running to 200°). */
export const touchesRound = (a: Box, b: Box) => [-360, 0, 360].some((d) => touches({ ...a, west: a.west + d, east: a.east + d }, b));

/**
 * The period's states in the world that the scene does not name: the reference maps colour every state's land, so the
 * named ones stand among their neighbours instead of on bare ground. Nameless (the atlas's own names are not always the
 * period's: "Seljuk Caliphate" in 1400), largest first, each in a colour no touching state has.
 */
export function backgroundStates(snapshot: ReadonlyMap<string, readonly Polygon[]>, world: Box, named: readonly { readonly name: string; readonly color: string; readonly polys: readonly Polygon[] }[], isPolity: (name: string) => boolean): { name: string; color: string; polys: readonly Polygon[] }[] {
  const skip = new Set(named.map((n) => n.name.toLowerCase()));
  const found = [...snapshot]
    .filter(([name, polys]) => !skip.has(name) && isPolity(name) && polys.length && touchesRound(boxOf(polys), world))
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
  // A city with a battle of its name on the same spot is written once, by the battle ("Pearl Harbor" twice on Oahu).
  const bare = (s: string) => s.replace(/\s*\d{3,4}\s*(BC|AD)?\s*$/i, "").replace(/^(battle|siege|attack) (of|on) /i, "").trim().toLowerCase();
  const cities = m.cities.filter((c) => !(m.battles ?? []).some((b) => bare(b.label) === bare(c.label) && Math.hypot(b.x - c.x, b.y - c.y) < 80 * k));
  const armies = m.armies.map((a) => {
    const city = cities.find((c) => Math.abs(c.x - a.x) < (ARMY_HALF_W + 30) * k && Math.abs(c.y - a.y) < 50 * k);
    if (!city) return a;
    const left = city.x - (ARMY_HALF_W + 40) * k;
    return left - ARMY_HALF_W * k >= 20 * k ? { ...a, x: r1(left), y: city.y } : { ...a, x: city.x, y: r1(Math.max(ARMY_REACH_UP * k, city.y - 90 * k)) };
  });
  return { ...m, cities, armies, arrows };
}

type Rect = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Keeps every state's name inside the picture and off the marks near its spot (map still, 21 Oct 2026: "OTTOMAN
 * EMPIRE" covered Bursa, "KINGDOM OF HUNGARY" ran off the top under the crusaders' arrow): the name moves up or down a
 * little, then sideways, to the first place where it covers no city, badge, battle, arrow name or other state's name.
 * `px`: drawn pixels per 1080p screen pixel (MapView keeps names and marks at a constant screen size).
 */
export function placeStateLabels(m: V3GeoMap, width: number, height: number, px: number, inside?: readonly (readonly (readonly [number, number])[] | undefined)[]): V3GeoMap {
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
    // A sea's spaced capitals: about one letter and a half of room per character.
    ...(m.seas ?? []).map((s) => ({ x0: s.x - (s.label.length * s.size * 0.52 * px), y0: s.y - s.size * 0.6 * px, x1: s.x + s.label.length * s.size * 0.52 * px, y1: s.y + s.size * 0.6 * px })),
  ];
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const placed: (Rect & { label: string })[] = [];
  const territories = m.territories.map((t, i) => {
    if (t.labelX === undefined || t.labelY === undefined || !t.label) return t;
    // A state that changes hands is written twice under one name (old colour out, new colour in): same place.
    const same = placed.find((p) => p.label === t.label);
    if (same) return { ...t, labelX: r1((same.x0 + same.x1) / 2), labelY: r1((same.y0 + same.y1) / 2) };
    const lines = labelLines(t.label.toLocaleUpperCase("en-US"));
    const ring = inside?.[i];
    const box = (x: number, y: number, size: number) => {
      const w = Math.max(...lines.map((l) => l.length)) * LABEL_CHAR_W * size * px;
      const h = lines.length * size * px;
      return { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
    };
    // The whole name inside its own state (owner, 21 Oct 2026: "harita sınırına sığdır, başka ülkeye girmesin"): five
    // points along each of three rows of its box must lie in the state's outline.
    const fits = (r: Rect) => !ring || [0, 0.5, 1].every((fy) => [0, 0.25, 0.5, 0.75, 1].every((fx) => insideRing(r.x0 + (r.x1 - r.x0) * fx, r.y0 + (r.y1 - r.y0) * fy, ring)));
    // A place, moved into the picture (40 px from its edges) for this size.
    const placeAt = (x: number, y: number, size: number) => {
      const b = box(0, 0, size);
      const cx = clamp(x, b.x1 + 40 * px, width - b.x1 - 40 * px);
      const cy = clamp(y, b.y1 + 40 * px, height - b.y1 - 40 * px);
      return { x: cx, y: cy, size, r: box(cx, cy, size) };
    };
    const free = (r: Rect) => fits(r) && ![...marks, ...placed].some((o) => overlaps(o, r));
    // Places to try: the state's visual centre first, then a grid over the state nearest the centre first (without an
    // outline: a little up, down and sideways).
    const full = t.labelSize ?? 46;
    const spots: [number, number][] = [[t.labelX, t.labelY]];
    if (!ring) {
      const b = box(0, 0, full);
      const s = (b.y1 - b.y0) * 0.6;
      const w = (b.x1 - b.x0) * 0.45;
      spots.push(...([[0, s], [0, -s], [0, 2 * s], [0, -2 * s], [w, 0], [-w, 0], [w, s], [-w, s], [w, -s], [-w, -s]] as const).map(([dx, dy]): [number, number] => [t.labelX! + dx, t.labelY! + dy]));
    } else {
      const xs = ring.map((p) => p[0]);
      const ys = ring.map((p) => p[1]);
      const [gx0, gx1, gy0, gy1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const step = Math.max(8 * px, Math.min(gx1 - gx0, gy1 - gy0) / 14);
      const grid: [number, number][] = [];
      for (let gy = gy0; gy <= gy1; gy += step) for (let gx = gx0; gx <= gx1; gx += step) grid.push([gx, gy]);
      spots.push(...grid.sort((p, q) => Math.hypot(p[0] - t.labelX!, p[1] - t.labelY!) - Math.hypot(q[0] - t.labelX!, q[1] - t.labelY!)).slice(0, 220));
    }
    // Full size first, then smaller: the first size with a free place inside the state wins.
    const sizes = [...new Set([full, Math.round(full * 0.85), Math.round(full * 0.72), Math.round(full * 0.6), LABEL_MIN].map((s) => Math.max(LABEL_MIN, s)))];
    let spot: { x: number; y: number; size: number; r: Rect } | undefined;
    for (const size of sizes) {
      spot = spots.map(([x, y]) => placeAt(x, y, size)).find((c) => free(c.r));
      if (spot) break;
    }
    // Nowhere inside (a sliver of a state at the frame's edge): the smallest name at the centre, kept in the picture.
    spot ??= placeAt(t.labelX, t.labelY, ring ? LABEL_MIN : full);
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
    // The living map's own marks (the Mongol test's Kublai stood on his badge and the fleet's name): badges where they
    // start and arrive, battles, arrow names.
    ...(m.badges ?? []).flatMap((b) => [b.path[0], b.path[b.path.length - 1]].flatMap((p) => (p ? [{ x0: p.x - 70 * k, x1: p.x + 70 * k, y: p.y }] : []))),
    ...(m.battles ?? []).map((b) => ({ x0: b.x - 60 * k, x1: b.x + 60 * k, y: b.y })),
    ...m.arrows.flatMap((ar) => (ar.label && ar.labelX !== undefined && ar.labelY !== undefined ? [{ x0: ar.labelX - ar.label.length * 10 * k, x1: ar.labelX + ar.label.length * 10 * k, y: ar.labelY }] : [])),
  ];
  const hidden = (x: number) => marks.filter((p) => p.y > height * 0.38 && p.x1 > (x - 0.11) * width && p.x0 < (x + 0.11) * width).length;
  let best = 0.5;
  for (const x of [0.5, 0.26, 0.74, 0.16, 0.84]) if (hidden(x) < hidden(best)) best = x;
  return best;
}

/**
 * A moving map's marks where they stand on the screen at `frame` (the camera stop reached by then), so a character on
 * the map can stand clear of them (mapStageX works on the screen).
 */
export function mapOnScreen(m: V3GeoMap, frame: number, width: number, height: number): V3GeoMap {
  if (!m.world || !m.camera?.length) return m;
  const key = [...m.camera].reverse().find((c) => c.frame <= frame) ?? m.camera[0]!;
  const s = (p: { readonly x: number; readonly y: number }) => ({ x: (p.x - key.x) * key.zoom + width / 2, y: (p.y - key.y) * key.zoom + height / 2 });
  const at = (x: number | undefined, y: number | undefined) => (x !== undefined && y !== undefined ? (({ x: sx, y: sy }) => ({ labelX: sx, labelY: sy }))(s({ x, y })) : {});
  return {
    ...m,
    cities: m.cities.map((c) => ({ ...c, ...s(c) })),
    armies: m.armies.map((a) => ({ ...a, ...s(a) })),
    arrows: m.arrows.map((a) => ({ ...a, points: a.points.map(s), ...at(a.labelX, a.labelY) })),
    territories: m.territories.map((t) => ({ ...t, ...at(t.labelX, t.labelY) })),
    ...(m.badges ? { badges: m.badges.map((b) => ({ ...b, path: b.path.map(s) })) } : {}),
    ...(m.battles ? { battles: m.battles.map((b) => ({ ...b, ...s(b) })) } : {}),
  };
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
  opts: { readonly relief?: string; readonly castName?: (id: string) => string | undefined; readonly language?: "tr" | "en"; readonly era?: V3GeoMap["era"]; readonly year?: number } = {},
): V3GeoMap {
  return placeCloseLabels(declutterMap(projectGeoMap(map, data, width, height, lineStart, opts), height), width, height);
}

/** A point `km` east and `north` km north of `c` (small distances; enough to lay tokens out round a place). */
function offsetKm(c: readonly [number, number], east: number, north: number): [number, number] {
  return [c[0] + east / (111.32 * Math.max(0.2, Math.cos((c[1] * Math.PI) / 180))), c[1] + north / 110.57];
}

/** A settlement's size when the script gives none (km across). */
const SETTLEMENT_KM = { sehir: 2.5, koy: 0.6, ordugah: 1.5 } as const;
/** Ground the script names, when it gives no size (km across). */
const GROUND_KM = { tepe: 1.5, orman: 1, tarla: 0.8 } as const;
/** At most this many houses or tents in a settlement (a big city is drawn a little sparser). */
const MAX_ITEMS = 520;

type XY = { x: number; y: number };

function hash01(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function inPolygonXY(p: XY, ring: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The point of a polyline nearest to `p`, the direction of the line there (radians), and the distance. */
export function nearestOnLine(line: readonly XY[], p: XY): { x: number; y: number; angle: number; d: number } {
  let best = { x: line[0]!.x, y: line[0]!.y, angle: 0, d: Infinity };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
    const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.d) best = { ...q, angle: Math.atan2(b.y - a.y, b.x - a.x), d };
  }
  return best;
}

/** Points every `gap` along a polyline (its ends included). */
function pointsAlong(line: readonly XY[], gap: number): XY[] {
  const out: XY[] = [line[0]!];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let s = gap - carry; s < len; s += gap) out.push({ x: r1(a.x + ((b.x - a.x) * s) / len), y: r1(a.y + ((b.y - a.y) * s) / len) });
    carry = (carry + len) % gap;
  }
  out.push(line[line.length - 1]!);
  return out;
}

/**
 * The close battle map's ground features in world pixels (owner, 22 Oct 2026): the script's walls with towers and
 * gates, its settlements filled with houses or tents (on land only), its buildings, roads and named ground, and woods
 * and fields scattered over the rest of the land so the place reads like a painted battle map (hills come from the
 * real elevation under it). Deterministic: the same map is laid out the same way.
 */
export function closeGround(map: SceneMap, v: MapView, toPx: (p: readonly [number, number]) => XY, onLand: (p: [number, number]) => boolean, lineStart: (index: number | undefined, order: number) => number): NonNullable<V3GeoMap["close"]> {
  const kmPerPx = (v.spanLon * 111.32 * Math.max(0.2, Math.cos((v.lat0 * Math.PI) / 180))) / v.width;
  const km = (n: number) => n / kmPerPx;
  // A house is ~120 m across, but never smaller than 9 px on the closest view.
  const unit = Math.round(Math.max(9, km(0.12)) * 10) / 10;
  const lonLatOf = (p: XY): [number, number] => [v.lon0 - v.spanLon / 2 + (p.x / v.width) * v.spanLon, v.lat0 + v.spanLat / 2 - (p.y / v.height) * v.spanLat];
  const walls = (map.surlar ?? []).map((w, i) => {
    const points = w.noktalar.map((p) => toPx(p));
    return {
      ...(w.ad ? { label: w.ad } : {}),
      points,
      towers: pointsAlong(points, unit * 5.5),
      gates: (w.kapilar ?? []).map((g) => {
        const n = nearestOnLine(points, toPx(g));
        return { x: r1(n.x), y: r1(n.y), angle: Math.round(n.angle * 1000) / 1000 };
      }),
      ...(w.gedik ? { breach: { ...((n) => ({ x: r1(n.x), y: r1(n.y) }))(nearestOnLine(points, toPx(w.gedik.konum))), start: lineStart(w.gedik.satir, i) } } : {}),
    };
  });
  const settlements = (map.yerlesimler ?? []).map((s, i) => {
    const outline = s.noktalar && s.noktalar.length >= 3 ? s.noktalar.map((p) => toPx(p)) : undefined;
    const centre = outline ? { x: outline.reduce((a, p) => a + p.x, 0) / outline.length, y: outline.reduce((a, p) => a + p.y, 0) / outline.length } : toPx(s.konum!);
    const radius = km((s.km ?? SETTLEMENT_KM[s.tur]) / 2);
    const inside = (p: XY) => (outline ? inPolygonXY(p, outline) : Math.hypot(p.x - centre.x, p.y - centre.y) <= radius);
    const box = outline ? { x0: Math.min(...outline.map((p) => p.x)), x1: Math.max(...outline.map((p) => p.x)), y0: Math.min(...outline.map((p) => p.y)), y1: Math.max(...outline.map((p) => p.y)) } : { x0: centre.x - radius, x1: centre.x + radius, y0: centre.y - radius, y1: centre.y + radius };
    // Houses a little apart on a loose grid, tents further; a village is scattered, a camp in rows.
    const area = (box.x1 - box.x0) * (box.y1 - box.y0);
    const spacing = Math.max(unit * (s.tur === "ordugah" ? 2.3 : 1.55), Math.sqrt(area / MAX_ITEMS));
    const items: { x: number; y: number; angle: number; seed: number }[] = [];
    let n = 0;
    for (let y = box.y0 + spacing / 2; y < box.y1; y += spacing)
      for (let x = box.x0 + spacing / 2; x < box.x1; x += spacing) {
        const seed = i * 100_003 + n++;
        if (s.tur === "koy" && hash01(seed * 3) < 0.45) continue;
        const jitter = s.tur === "ordugah" ? 0.12 : 0.35;
        const p = { x: x + (hash01(seed) - 0.5) * spacing * jitter, y: y + (hash01(seed + 7) - 0.5) * spacing * jitter };
        if (!inside(p) || !onLand(lonLatOf(p))) continue;
        items.push({ x: r1(p.x), y: r1(p.y), angle: s.tur === "ordugah" ? 0 : Math.round((hash01(seed + 13) - 0.5) * 50), seed });
      }
    const drawn = { kind: s.tur, ...(s.ad ? { label: s.ad } : {}), x: r1(centre.x), y: r1(centre.y), start: s.satir !== undefined ? lineStart(s.satir, i) : 0, ...(s.yanma_satir !== undefined ? { burn: lineStart(s.yanma_satir, i) } : {}), items };
    return { drawn, x: centre.x, y: centre.y, inside, radius, outline };
  });
  const buildings = (map.yapilar ?? []).map((b, i) => ({ kind: b.tur, ...toPx(b.konum), ...(b.ad ? { label: b.ad } : {}), start: b.satir !== undefined ? lineStart(b.satir, i) : 0 }));
  const roads = (map.yollar ?? []).map((r, i) => windingRoad(r.noktalar.map((p) => toPx(p)), i + 1, unit * 2, (p) => onLand(lonLatOf(p))));
  const roadNames = (map.yollar ?? []).flatMap((r, i) => (r.ad ? [{ road: i, label: r.ad, angle: 0 }] : []));
  // A burning town catches fire where the walls broke (owner, 23 Oct 2026: "the fire should start at the breach and
  // spread"): the breach next to its houses, if there is one.
  const breaches = walls.flatMap((w) => (w.breach ? [w.breach] : []));
  const burnFrom = (items: readonly XY[]) => breaches.find((b) => items.some((it) => Math.hypot(it.x - b.x, it.y - b.y) < km(0.8)));
  // Woods and fields over the free land: none in a settlement, on a wall or a road, or under a building.
  const named = (map.arazi ?? []).map((g, i) => ({ kind: g.tur, ...toPx(g.konum), size: r1(km(g.km ?? GROUND_KM[g.tur])), seed: 9000 + i }));
  const free = (p: XY, margin: number) =>
    !settlements.some((s) => s.inside(p) || (s.outline ? nearestOnLine([...s.outline, s.outline[0]!], p).d < margin : Math.hypot(p.x - s.x, p.y - s.y) < s.radius + margin)) &&
    !walls.some((w) => nearestOnLine(w.points, p).d < margin * 1.5) &&
    !roads.some((r) => nearestOnLine(r, p).d < margin) &&
    !buildings.some((b) => Math.hypot(p.x - b.x, p.y - b.y) < margin * 2) &&
    !named.some((g) => Math.hypot(p.x - g.x, p.y - g.y) < g.size / 2 + margin);
  const cell = unit * 9;
  const scattered: NonNullable<V3GeoMap["close"]>["ground"][number][] = [];
  let k = 0;
  for (let y = cell / 2; y < v.height; y += cell)
    for (let x = cell / 2; x < v.width; x += cell) {
      const seed = k++;
      const roll = hash01(seed * 5 + 1);
      const kind = roll < 0.3 ? "orman" : roll < 0.52 ? "tarla" : undefined;
      if (!kind) continue;
      const p = { x: x + (hash01(seed) - 0.5) * cell * 0.7, y: y + (hash01(seed + 3) - 0.5) * cell * 0.7 };
      const size = unit * (kind === "orman" ? 3 + hash01(seed + 11) * 3 : 3.5 + hash01(seed + 11) * 2.5);
      if (!free(p, size * 0.6 + unit) || !onLand(lonLatOf(p))) continue;
      scattered.push({ kind, x: r1(p.x), y: r1(p.y), size: r1(size), seed });
    }
  return {
    unit,
    ground: [...scattered, ...named],
    roads,
    ...(roadNames.length ? { roadNames } : {}),
    walls,
    settlements: settlements.map((s) => {
      const from = s.drawn.burn !== undefined ? burnFrom(s.drawn.items) : undefined;
      return from ? { ...s.drawn, burnFrom: { x: from.x, y: from.y } } : s.drawn;
    }),
    buildings,
  };
}

/**
 * A road as it runs over the land (owner, 23 Oct 2026, on the 1453 map: "what are those two straight lines?"): between
 * the script's points it bends gently — one or two long bends with a small wobble, about 7% of the stretch at most —
 * fading out at each point, so it still meets the gate it leads to. A bend that would leave the land stays straight.
 */
export function windingRoad(points: readonly XY[], seed: number, step: number, onLand: (p: XY) => boolean = () => true): XY[] {
  const out: XY[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.ceil(len / step);
    if (count < 4) {
      out.push(b);
      continue;
    }
    const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    const [p1, p2] = [hash01(seed * 7 + i) * Math.PI * 2, hash01(seed * 7 + i + 3) * Math.PI * 2];
    const bends = 1 + Math.floor(hash01(seed * 7 + i + 5) * 2);
    for (let j = 1; j < count; j++) {
      const t = j / count;
      const off = Math.sin(Math.PI * t) * len * (0.05 * Math.sin(Math.PI * bends * t + p1) + 0.018 * Math.sin(Math.PI * (bends * 2 + 3) * t + p2));
      const straight = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const bent = { x: straight.x + n.x * off, y: straight.y + n.y * off };
      const p = onLand(bent) ? bent : straight;
      out.push({ x: r1(p.x), y: r1(p.y) });
    }
    out.push(b);
  }
  return out;
}

/** Whether segment a–b crosses segment c–d. */
function segmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const side = (p: XY, q: XY, r: XY) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/**
 * Tokens that cross a wall to their next formation go through its breach, once it is open (owner's 1453 flow: "the
 * wall gives way at the gate and the city falls" — the tokens slid straight through the stone): the breach, and which
 * tokens pass it. A wall without an open breach is crossed as before.
 */
export function throughBreach(from: readonly XY[], to: readonly XY[], start: number, walls: NonNullable<V3GeoMap["close"]>["walls"]): { via?: XY; through?: number[] } {
  for (const w of walls) {
    if (!w.breach || w.breach.start > start) continue;
    const through = to.flatMap((b, i) => {
      const a = from[Math.min(i, from.length - 1)];
      return a && w.points.slice(1).some((p, j) => segmentsCross(a, b, w.points[j]!, p)) ? [i] : [];
    });
    if (through.length) return { via: { x: w.breach.x, y: w.breach.y }, through };
  }
  return {};
}

/** The script's vehicles that float. */
const SHIPS = new Set(["gemi", "kadirga", "yelkenli", "denizalti"]);
/** A stretch of land shorter than this share of the route is the shore it leaves from, not a haul. */
const MIN_OVERLAND_SHARE = 0.04;

/**
 * Where a ship's route crosses land, as fractions of its drawn length (1453: Mehmed's ships hauled from the Bosphorus
 * over the hill behind Galata into the Golden Horn). The route is checked every few dozen metres; a short touch of the
 * shore at its ends or a cape it cuts is left out, and two stretches a little sea apart join.
 */
export function overlandStretches(route: readonly (readonly [number, number])[], toPx: (p: readonly [number, number]) => XY, onLand: (p: [number, number]) => boolean): { from: number; to: number }[] {
  const samples: { d: number; land: boolean }[] = [];
  let run = 0;
  for (let i = 1; i < route.length; i++) {
    const [a, b] = [route[i - 1]!, route[i]!];
    const [pa, pb] = [toPx(a), toPx(b)];
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const n = Math.max(2, Math.ceil(len / 4));
    for (let j = i === 1 ? 0 : 1; j <= n; j++) samples.push({ d: run + (len * j) / n, land: onLand([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]) });
    run += len;
  }
  if (!run) return [];
  const out: { from: number; to: number }[] = [];
  for (const s of samples) {
    const f = s.d / run;
    const last = out[out.length - 1];
    if (!s.land) continue;
    if (last && f - last.to <= MIN_OVERLAND_SHARE) last.to = f;
    else out.push({ from: f, to: f });
  }
  return out.filter((o) => o.to - o.from >= MIN_OVERLAND_SHARE).map((o) => ({ from: Math.round(o.from * 1000) / 1000, to: Math.round(o.to * 1000) / 1000 }));
}

/**
 * A ship as its period built them: an oared galley (the Mediterranean's fleets were galleys till about 1600 — the
 * Ottoman fleet of 1453, Lepanto in 1571), a sailing ship, a steel warship (no year: the last).
 */
export function shipLook(year: number | undefined): "kadirga" | "yelkenli" | "gemi" {
  if (year === undefined) return "gemi";
  return year < 1600 ? "kadirga" : year < 1860 ? "yelkenli" : "gemi";
}

/** How far a state's colour is carried past its provinces' coast (km). */
const COAST_PAD_KM = 3.2;

/** When a fight's first token falls after its line starts (s), and the time between the next ones (the tokens have met by then). */
export const UNIT_LOSS_FIRST_S = 2.4;
export const UNIT_LOSS_GAP_S = 1;

/** The seconds after its line at which each of `lost` tokens falls (shared with the mix: a sword on every one). */
export function unitLossDelaysS(lost: number): number[] {
  return Array.from({ length: lost }, (_, j) => Math.round((UNIT_LOSS_FIRST_S + j * UNIT_LOSS_GAP_S) * 100) / 100);
}

/** Siege rings are tried at this many places round the city, to keep the tokens on the land. */
const RING_SAMPLES = 72;

/**
 * Where `n` tokens of a formation stand ([lon, lat]): spaced evenly along a front line; on a ring round a besieged
 * place; or in a loose hexagonal cluster round a point. Deterministic, so the same formation is laid out the same way.
 * With `onLand`, a siege ring keeps to the land round a coastal city (its sea side is left to ships), and a cluster
 * takes its land places first.
 */
export function formationPoints(f: UnitFormation, n: number, onLand?: (p: [number, number]) => boolean): [number, number][] {
  if ("cephe" in f) {
    const line = f.cephe;
    if (line.length === 1) return Array.from({ length: n }, () => [line[0]![0], line[0]![1]]);
    const seg = line.slice(1).map((p, i) => Math.hypot(p[0] - line[i]![0], p[1] - line[i]![1]));
    const total = seg.reduce((a, b) => a + b, 0) || 1;
    return Array.from({ length: n }, (_, k) => {
      let rest = (n === 1 ? 0.5 : k / (n - 1)) * total;
      for (let i = 0; i < seg.length; i++) {
        if (rest <= seg[i]! || i === seg.length - 1) {
          const u = seg[i]! ? Math.min(1, rest / seg[i]!) : 0;
          return [line[i]![0] + (line[i + 1]![0] - line[i]![0]) * u, line[i]![1] + (line[i + 1]![1] - line[i]![1]) * u];
        }
        rest -= seg[i]!;
      }
      return [line[line.length - 1]![0], line[line.length - 1]![1]];
    });
  }
  if ("kusatma" in f) {
    const r = f.km ?? 40;
    const at = (u: number) => offsetKm(f.kusatma, Math.cos(u * Math.PI * 2 - Math.PI / 2) * r, Math.sin(u * Math.PI * 2 - Math.PI / 2) * r);
    const ring = Array.from({ length: RING_SAMPLES }, (_, k) => ({ p: at(k / RING_SAMPLES), land: onLand?.(at(k / RING_SAMPLES)) ?? true }));
    const land = ring.filter((s) => s.land).length;
    if (land === RING_SAMPLES || land < 3) return Array.from({ length: n }, (_, k) => at(k / n));
    // Round a coast (the reference channel's sieges): the ring's land part, read from just past its widest stretch of
    // sea, so an arc on land is laid out end to end.
    let best = -1;
    let bestLen = 0;
    for (let k = 0; k < RING_SAMPLES; k++) {
      if (ring[k]!.land || !ring[(k + RING_SAMPLES - 1) % RING_SAMPLES]!.land) continue;
      let len = 0;
      while (len < RING_SAMPLES && !ring[(k + len) % RING_SAMPLES]!.land) len++;
      if (len > bestLen) [best, bestLen] = [k, len];
    }
    const arc = Array.from({ length: RING_SAMPLES }, (_, j) => ring[(best + bestLen + j) % RING_SAMPLES]!).filter((s) => s.land);
    return Array.from({ length: n }, (_, k) => arc[Math.min(arc.length - 1, Math.floor(((k + 0.5) / n) * arc.length))]!.p);
  }
  // A cluster: rings of 1, 6, 12 … round the point, about km/2 apart; on the coast the land places come first.
  const step = (f.km ?? 30) / 2;
  const out: [number, number][] = [];
  for (let ring = 0; out.length < n * (onLand ? 3 : 1); ring++) {
    const count = ring === 0 ? 1 : ring * 6;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + ring * 0.4;
      out.push(offsetKm(f.kume, Math.cos(a) * ring * step, Math.sin(a) * ring * step));
    }
  }
  return (onLand ? [...out.filter((p) => onLand(p)), ...out.filter((p) => !onLand(p))] : out).slice(0, n);
}

/** Bands a conquest sweeps in: enough for a front to read, few enough to stay a handful of paths. */
const SPREAD_BANDS = 16;

/**
 * A conquest's front (owner, 22 Oct 2026: "the map shows nothing happening"): the state's provinces grouped by their
 * distance from where the army came, nearest first, each band coming in a little after the one before, so the colour
 * sweeps over the land province by province. Without provinces there are no bands (the state grows from its name).
 */
export function spreadBands(v: MapView, units: readonly AdminUnit[], from: readonly [number, number], bands = SPREAD_BANDS): { d: string; delay: number; rings: [number, number][][] }[] {
  if (units.length < 2) return [];
  const dist = (u: AdminUnit) => Math.hypot((u.centre[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180), u.centre[1] - from[1]);
  const sorted = [...units].sort((a, b) => dist(a) - dist(b));
  const near = dist(sorted[0]!);
  const far = dist(sorted[sorted.length - 1]!);
  const span = Math.max(1e-9, far - near);
  const groups = Array.from({ length: bands }, () => [] as AdminUnit[]);
  for (const u of sorted) groups[Math.min(bands - 1, Math.floor(((dist(u) - near) / span) * bands))]!.push(u);
  return groups.flatMap((g, i) => {
    if (!g.length) return [];
    const polys = unitPolygons(g);
    // The band's land in world pixels too, to tell which state's name the sweep passes over.
    const rings = polys.map((poly) => poly[0]!.map(([lon, lat]) => projectNear(v, lon, lat)));
    return [{ d: polygonsPath(v, polys as Polygon[]), delay: Math.round((i / Math.max(1, bands - 1)) * 1000) / 1000, rings }];
  });
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
  // Camera stops are taken on the side of the 180th meridian nearest the first one: Japan (139° E) to Hawaii (158° W)
  // crosses the Pacific (Hawaii at 202°), not the whole world the other way.
  const lon0 = map.merkez![0];
  const near = (c: readonly [number, number]): [number, number] => [c[0] + 360 * Math.round((lon0 - c[0]) / 360), c[1]];
  const keys = [{ view: mapView(map.merkez!, map.genislik_km!, width, height) }, ...(map.kamera ?? []).map((k) => ({ satir: k.satir, view: mapView(near(k.merkez), k.genislik_km, width, height) }))];
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
  // Longitudes are not cut at ±180: a Pacific world runs past it (the relief and every shape wrap round, see shiftFor).
  const bounds = { west: west0 - mx, east: Math.min(west0 - mx + 360, east0 + mx), south: Math.max(-85, south0 - my), north: Math.min(85, north0 + my) };
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
  opts: { readonly relief?: string; readonly castName?: (id: string) => string | undefined; readonly language?: "tr" | "en"; readonly era?: V3GeoMap["era"]; readonly year?: number },
): V3GeoMap {
  const world = mapWorld(map, width, height);
  const v = world.view;
  const moving = world.keys.length > 1;
  // The widest view's scale against the world: name sizes are for the screen, and a name that fits its state there
  // fits it in every closer view too (MapView keeps names at one screen size, so zooming out makes them relatively larger).
  const zoom0 = moving ? Math.min(...world.keys.map((k) => (width / k.view.spanLon) * (v.spanLon / v.width))) : 1;
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
  // Realistic borders: each state is rebuilt from today's provinces whose centre lies in its outline (AdminUnits) —
  // the script's own regions first, then the named atlas states, then the rest; a state no province falls in keeps its
  // own outline. Modern countries ("ulkeler") are drawn as they are.
  const groups = [
    named.flatMap((n, i) => (n.b.noktalar && n.b.noktalar.length >= 3 && !n.b.tarihi && !n.b.ulkeler?.length ? [{ key: i, polys: n.polys }] : [])),
    named.flatMap((n, i) => (n.b.tarihi && !n.b.ulkeler?.length ? [{ key: i, polys: n.polys }] : [])),
    others.map((o, j) => ({ key: named.length + j, polys: o.polys })),
  ];
  const built = data.admin ? assignUnits(data.admin, groups, world.bounds) : new Map<number, AdminUnit[]>();
  const coast = data.admin ? coastEdges(unitsIn(data.admin, world.bounds)) : new Set<string>();
  const shape = (key: number, polys: readonly Polygon[]) => {
    const units = built.get(key);
    if (!units?.length) return { fill: polys, label: polys, border: undefined, coast: undefined };
    const outline = dissolve(units);
    // The border where it meets other land only; the coastline is drawn by the map, and the colour reaches it.
    const shore = linesPath(v, dissolve(units, (e) => coast.has(e)).lines);
    return { fill: unitPolygons(units) as Polygon[], label: outline.rings.length ? outline.rings.map((r) => [r] as Polygon) : polys, border: linesPath(v, dissolve(units, (e) => !coast.has(e)).lines), coast: shore || undefined };
  };
  // Each named state's largest piece in view: its name must fit inside it (placeStateLabels).
  const rings: (readonly (readonly [number, number])[] | undefined)[] = others.map(() => undefined);
  const sweeps: { territory: number; start: number; bands: ReturnType<typeof spreadBands> }[] = [];
  const territories: V3GeoMap["territories"][number][] = [
    ...others.map((s, j) => {
      const sh = shape(named.length + j, s.polys);
      return { d: polygonsPath(v, sh.fill), ...(sh.border !== undefined ? { border: sh.border } : {}), ...(sh.coast ? { coast: sh.coast } : {}), color: s.color, label: "", start: 0 };
    }),
    ...named.map(({ b, polys }, i) => {
      const sh = shape(i, polys);
      // A state's later land under the same name (its conquest drawn as a second region) carries no second name.
      const again = named.slice(0, i).some((n) => n.b.ad.trim().toLowerCase() === b.ad.trim().toLowerCase());
      const at = again ? undefined : labelPoint(v, sh.label, b.ad, zoom0, height);
      rings.push(at?.ring);
      const pin = b.etiket_konum && !again ? projectNear(v, b.etiket_konum[0], b.etiket_konum[1]) : undefined;
      const anchor = pin ? { labelX: r1(pin[0]), labelY: r1(pin[1]) } : at ? { labelX: at.x, labelY: at.y } : {};
      const spread = b.yayilma ? spreadBands(v, built.get(i) ?? [], b.yayilma.kaynak) : undefined;
      if (spread?.length) sweeps.push({ territory: others.length + i, start: lineStart(b.yayilma!.satir, i), bands: spread });
      // With an army marching on the same line, the front keeps the army's pace: the land beyond where the march ends
      // falls after the army arrives, at the same speed (the Rubicon's red first ran ahead of Caesar to Calabria).
      const army = b.yayilma ? (map.ordular ?? []).find((o) => o.yol?.length && (o.yol_satir ?? o.satir) === b.yayilma!.satir) : undefined;
      const units = built.get(i) ?? [];
      let sweepScale: number | undefined;
      if (army && units.length > 1) {
        const from = b.yayilma!.kaynak;
        const dist = (p: readonly [number, number]) => Math.hypot((p[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180), p[1] - from[1]);
        const ds = units.map((u) => dist(u.centre));
        const reach = dist(army.yol![army.yol!.length - 1]!) - Math.min(...ds);
        // At most a little over twice the march, so the sweep still ends within the scene's next lines.
        if (reach > 0) sweepScale = Math.round(Math.min(2.2, Math.max(1, (Math.max(...ds) - Math.min(...ds)) / reach)) * 100) / 100;
      }
      return {
        d: polygonsPath(v, sh.fill),
        ...(sh.border !== undefined ? { border: sh.border } : {}),
        ...(sh.coast ? { coast: sh.coast } : {}),
        color: b.renk,
        label: again ? "" : b.ad,
        ...anchor,
        ...(at ? { labelSize: at.size } : {}),
        start: b.yayilma ? lineStart(b.yayilma.satir, i) : lineStart(b.satir, i),
        ...(b.bitis_satir !== undefined ? { end: lineStart(b.bitis_satir, i) } : {}),
        ...(spread?.length ? { spread: spread.map(({ d, delay }) => ({ d, delay })), ...(sweepScale && sweepScale > 1 ? { sweepScale } : {}) } : {}),
      };
    }),
  ];
  // A state whose name a later conquest sweeps over loses the name as the front passes it (owner, 22 Oct 2026: the
  // Senate's name stayed on Caesar's red).
  for (const [ti, t] of territories.entries()) {
    if (t.labelX === undefined || t.labelY === undefined || !t.label) continue;
    for (const s of sweeps) {
      if (s.territory === ti || s.start <= t.start) continue;
      const band = s.bands.find((b) => b.rings.some((r) => insideRing(t.labelX!, t.labelY!, r)));
      if (band) territories[ti] = { ...t, covered: { start: s.start, delay: band.delay } };
    }
  }
  const toPx = (p: readonly [number, number]) => {
    const [x, y] = projectNear(v, p[0], p[1]);
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
  const onLand = (p: [number, number]) => inOutline(p[0], p[1], data.land) && !inOutline(p[0], p[1], data.lakes);
  // Tokens are spaced on screen by the renderer (MapUnits), for whatever zoom the camera is at.
  // Vehicles: a script's ship takes its period's look; the rest are drawn as named.
  const vehicles = (map.araclar ?? []).map((a, i) => ({
    kind: a.tur === "gemi" ? shipLook(opts.year) : a.tur,
    color: a.renk,
    count: Math.max(1, Math.min(6, Math.round(a.sayi ?? 1))),
    start: lineStart(a.satir, i),
    ...(a.bitis_satir !== undefined ? { end: lineStart(a.bitis_satir, i) } : {}),
    path: [a.konum, ...(a.yol ?? [])].map((p) => toPx(p)),
    ...(a.yol?.length ? { moveStart: lineStart(a.yol_satir ?? a.satir, i) } : {}),
    ...(a.hedef ? { target: toPx(a.hedef), fireStart: lineStart(a.ates_satir ?? a.yol_satir ?? a.satir, i) } : {}),
    ...((o) => (o.length ? { overland: o } : {}))(SHIPS.has(a.tur) && a.yol?.length ? overlandStretches([a.konum, ...a.yol], toPx, onLand) : []),
  }));
  const close = map.genislik_km !== undefined && map.genislik_km <= CLOSE_MAP_MAX_KM ? closeGround(map, v, toPx, onLand, lineStart) : undefined;
  // Lines where tokens are lost are fights: the two sides close in and strike while the losses fall.
  const fightLines = [...new Set((map.birlikler ?? []).flatMap((u) => u.yerler.filter((y) => (y.kayip ?? 0) > 0).map((y) => y.satir)))];
  const fights = fightLines.map((l, i) => ({ start: lineStart(l, i), durationS: Math.round((UNIT_LOSS_FIRST_S + (Math.max(...(map.birlikler ?? []).flatMap((u) => u.yerler.filter((y) => y.satir === l).map((y) => Math.min(u.sayi, y.kayip ?? 0)))) - 1) * UNIT_LOSS_GAP_S + 1.2) * 10) / 10 }));
  const units = (map.birlikler ?? []).map((u, i) => {
    const count = Math.max(1, Math.min(24, Math.round(u.sayi)));
    let alive = count;
    const steps = [...u.yerler]
      .sort((a, b) => a.satir - b.satir)
      .map((y) => {
        const before = alive;
        alive = Math.max(0, alive - Math.max(0, Math.round(y.kayip ?? 0)));
        // Losses one by one as the fight goes on (owner, 22 Oct 2026: "then wiped out one by one with the narration").
        return { start: lineStart(y.satir, i), points: formationPoints(y, count, onLand).map((p) => toPx(p)), alive, ...(before > alive ? { losses: unitLossDelaysS(before - alive) } : {}) };
      })
      .map((st, si, all) => (si > 0 && close ? { ...st, ...throughBreach(all[si - 1]!.points, st.points, st.start, close.walls) } : st));
    return { side: u.taraf, color: u.renk, emblem: u.amblem, ...(u.harf ? { letters: u.harf.slice(0, 3) } : {}), steps };
  });
  const drawn: V3GeoMap = {
    land: polygonsPath(v, data.land),
    lakes: polygonsPath(v, data.lakes),
    rivers: linesPath(v, data.rivers),
    territories,
    cities: (map.sehirler ?? []).map((c) => ({ ...toPx(c.konum), label: c.ad })),
    armies: (map.ordular ?? []).map((a, i) => ({
      ...toPx(a.konum),
      label: a.ad,
      color: a.renk,
      start: lineStart(a.satir, i),
      ...(a.yol?.length ? { path: [a.konum, ...a.yol].map((p) => toPx(p)), moveStart: lineStart(a.yol_satir ?? a.satir, i) } : {}),
    })),
    ...(map.cizgiler?.length ? { lines: map.cizgiler.map((c, i) => ({ points: c.noktalar.map((p) => toPx(p)), label: c.ad, color: c.renk ?? "#ffd166", start: lineStart(c.satir, i), ...(c.stil === "zincir" ? { chain: true } : {}) })) } : {}),
    arrows: (map.oklar ?? []).map((o, i) => ({ points: o.noktalar.map((p) => toPx(p)), color: o.renk ?? "#e0283c", ...(o.etiket ? { label: o.etiket } : {}), start: lineStart(o.satir, i) })),
    ...(moving ? { world: { width: v.width, height: v.height }, camera } : {}),
    ...(opts.relief ? { relief: opts.relief } : {}),
    ...(badges.length ? { badges } : {}),
    ...(battles.length ? { battles } : {}),
    ...(units.length ? { units } : {}),
    ...(fights.length ? { fights } : {}),
    ...(vehicles.length ? { vehicles } : {}),
    ...(close ? { close } : {}),
    // A province grid step and a bit (0.02° ≈ 2.2 km, ~3 km across the diagonal): the colour then always reaches the coast.
    ...(coast.size ? { coastPad: Math.round((COAST_PAD_KM / ((v.spanLon * 111.32 * Math.max(0.2, Math.cos((v.lat0 * Math.PI) / 180))) / v.width)) * 10) / 10 } : {}),
    ...(opts.era ? { era: opts.era } : {}),
    ...(opts.relief ? atlasMarks(data, v, world.bounds, zoom0, height, opts.language ?? "en") : {}),
    // The story's main state (the script names it first) gets the stronger border, like the main state of an atlas map.
    ...(named.length ? { mainTerritory: others.length } : {}),
  };
  return placeStateLabels(drawn, v.width, v.height, height / 1080 / zoom0, rings);
}

/**
 * An atlas's sea names and scale (owner's example map, 21 Oct 2026): every named sea or gulf with room for its name
 * in the world gets it at its centre, in the narration's language; and kilometres per drawn pixel for the scale bar.
 */
function atlasMarks(data: MapData, v: MapView, bounds: MapWorld["bounds"], zoom: number, frameHeight: number, language: "tr" | "en"): Pick<V3GeoMap, "seas" | "kmPerPx"> {
  const seas = (data.seas ?? []).flatMap((s) => {
    const box = boxOf(s.polys);
    if (!touchesRound(box, bounds)) return [];
    const label = language === "tr" && s.nameTr ? s.nameTr : s.name;
    const at = labelPoint(v, s.polys, label, zoom, frameHeight);
    // Spaced capitals take about twice the room of a state's name: a sea too small for that stays unnamed.
    if (!at || at.size < 28) return [];
    const size = Math.min(30, Math.round(at.size * 0.6));
    // Kept whole inside the picture, 40 px from its edges (a sea at the edge was cut: "…ENIAN SEA").
    const px = frameHeight / 1080 / zoom;
    const halfW = label.length * size * 0.52 * px + 40 * px;
    const halfH = size * 0.6 * px + 40 * px;
    if (2 * halfW > v.width || 2 * halfH > v.height) return [];
    const x = Math.min(Math.max(at.x, halfW), v.width - halfW);
    const y = Math.min(Math.max(at.y, halfH), v.height - halfH);
    return [{ x: r1(x), y: r1(y), label: label.toLocaleUpperCase(language === "tr" ? "tr-TR" : "en-US"), size }];
  });
  const kmPerPx = Math.round(((v.spanLon * 111.32 * Math.max(0.2, Math.cos((v.lat0 * Math.PI) / 180))) / v.width) * 10000) / 10000;
  return { ...(seas.length ? { seas } : {}), kmPerPx };
}
