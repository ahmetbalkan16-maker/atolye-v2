import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { userAgentFor } from "../backgrounds/CommonsProvider";
import { CLOSE_MAP_MAX_KM, type Episode, type MapWall, type SceneMap } from "../episode/EpisodeTypes";
import type { V3Paths } from "../V3Paths";
import { castleStyleFor, fitWall, joinPieces, kmBetween, lineKm, type Pt, roundness, stripCentreline } from "./CastleShapes";
import { type Box, chainWays, ohmOverpass, type OsmElement, overpass, simplifyLine } from "./CloseCoast";
import { mapTilt, mapWorld } from "./MapBuilder";
import { fillSiegeMap, isSiegeMap, siegePlaceKey } from "./SiegeMap";
import { groundOf } from "./UnitFraming";

/**
 * The close battle map's site from open data (owner, 23 Oct 2026: "our helper brains must make these maps for any
 * event anywhere on Earth — the close map, the castle"). The writer names the walls and castles of its story and gives
 * their rough line or centre; here they get their real trace where OpenStreetMap has it (© OpenStreetMap contributors,
 * ODbL), in layers that each step in when the one before has nothing:
 *   1. the library (a box or a name fetched once is kept, append-only);
 *   2. Overpass — every city wall, castle and fort outline and city gate in the map's box;
 *   3. Nominatim — the wall or castle looked up by its name inside the map's box (Overpass is often down: on
 *      23 Oct 2026 all four of its servers failed while Nominatim answered);
 *   4. the writer's own line, or for a castle a ring drawn in its period's manner (CastleShapes.castleRing).
 * Walls mapped as thin building strips get their centre line; pieces are joined across gates and gaps; a wall line is
 * the part of the real walls that runs along the writer's line. Pure apart from the fetching.
 */

export interface SiteData {
  /** Wall lines (centre lines), longitude/latitude. */
  readonly walls: Pt[][];
  /** Closed outlines of castles and forts, with their names. */
  readonly castles: { readonly ring: Pt[]; readonly name?: string }[];
  readonly gates: { readonly at: Pt; readonly name?: string }[];
  /**
   * Wall ways that carry a name, unchained (Constantinople: 12 ways "Theodosian Wall", "Walls of Blachernai", the
   * Galata walls). A guessed wall is moved onto the real wall of its own name, never onto a sea wall it meets.
   */
  readonly namedWalls?: { readonly name: string; readonly line: Pt[] }[];
}

/**
 * A close map whose box the library holds Overpass's answer for (its walls; the production that drew it fetched its
 * coast too). Kept so a later map of the same place can stand on the same box when Overpass is down.
 */
export interface LibraryBox {
  readonly merkez: readonly [number, number];
  readonly genislik_km: number;
  readonly box: Box;
}

/** The library's boxes (closeSiteLookup's index): read them, record one. */
export interface SiteLibrary {
  boxes(): Promise<LibraryBox[]>;
  keep(entry: LibraryBox): Promise<void>;
}

/**
 * The site of a box, with the names of its walls and castles to look up; undefined when no source answered.
 * `library`: the boxes it holds, for a map to be set on one when Overpass does not answer for its own.
 */
export type SiteLookup = ((box: Box, names: readonly string[], year?: number) => Promise<{ site: SiteData; sources: string[] } | undefined>) & { readonly library?: SiteLibrary };

/** A date tag's year ("1453", "1453-05-29", "-0049", "~1450"); undefined when there is none. */
export function tagYear(v: string | undefined): number | undefined {
  const m = /^~?\s*(-?)(\d{1,4})/.exec(v?.trim() ?? "");
  return m ? (m[1] ? -1 : 1) * Number(m[2]) : undefined;
}

/**
 * Whether an OpenHistoricalMap feature stood in `year`: built by then (or no start date) and not yet gone (or no end
 * date). A wall pulled down in 1868 stands in 1453; a castle built in 1500 does not.
 */
export function standingIn(tags: Readonly<Record<string, string>> | undefined, year: number): boolean {
  const start = tagYear(tags?.start_date);
  const end = tagYear(tags?.end_date);
  return (start === undefined || start <= year) && (end === undefined || end >= year);
}

/** Bump when the parsing changes, so the library fetches and parses again. */
const SITE_VERSION = 1;
/** A ring rounder than this is a castle's outline; thinner, a strip of wall (OSM's walls as long narrow buildings). */
const STRIP_ROUNDNESS = 0.08;
/** Wall pieces this close (km) join into one line (a gate, a tower, a short missing stretch). */
const JOIN_GAP_KM = 0.25;
/** Points closer than this to the simplified wall are dropped (~9 m). */
const WALL_SIMPLIFY_DEG = 0.00008;

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const WALL_TAGS = /^(city_wall|citywalls|castle_wall|fortification)$/;
const CASTLE_TAGS = /^(castle|fort|fortress|citadel|castle_wall)$/;

const closed = (r: readonly Pt[]) => r.length > 3 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1];
const pts = (g: readonly { lat: number; lon: number }[] | undefined): Pt[] => (g ?? []).map((p) => [p.lon, p.lat]);

/** A closed piece of geometry: a castle's outline when round enough, else a thin strip of wall to its centre line. */
function sortRing(ring: Pt[], name: string | undefined, out: { walls: Pt[][]; castles: { ring: Pt[]; name?: string }[] }) {
  if (roundness(ring) >= STRIP_ROUNDNESS) out.castles.push({ ring, ...(name ? { name } : {}) });
  else out.walls.push(stripCentreline(ring));
}

/** The walls, castles and gates in an Overpass answer. */
export function siteFromOverpass(elements: readonly OsmElement[]): SiteData {
  const out = { walls: [] as Pt[][], castles: [] as { ring: Pt[]; name?: string }[], gates: [] as { at: Pt; name?: string }[], namedWalls: [] as { name: string; line: Pt[] }[] };
  const lines: Pt[][] = [];
  for (const e of elements) {
    const nt = e.tags ?? {};
    const nm = nt["name:en"] ?? nt.name;
    if (e.type === "way" && nm && (WALL_TAGS.test(nt.barrier ?? "") || WALL_TAGS.test(nt.historic ?? "")) && (e.geometry?.length ?? 0) >= 2) out.namedWalls.push({ name: nm, line: pts(e.geometry) });
    const t = e.tags ?? {};
    const name = t["name:en"] ?? t.name;
    if (e.type === "node" && e.lon !== undefined && e.lat !== undefined) {
      out.gates.push({ at: [e.lon, e.lat], ...(name ? { name } : {}) });
      continue;
    }
    const wall = WALL_TAGS.test(t.barrier ?? "") || WALL_TAGS.test(t.historic ?? "") || WALL_TAGS.test(t.wall ?? "");
    const castle = CASTLE_TAGS.test(t.historic ?? "") || CASTLE_TAGS.test(t.building ?? "") || t.castle_type !== undefined;
    const rings = e.type === "relation" ? chainWays((e.members ?? []).filter((m) => m.role !== "inner" && m.geometry?.length).map((m) => pts(m.geometry))) : [pts(e.geometry)];
    for (const r of rings) {
      if (r.length < 2) continue;
      if (closed(r) && (castle || wall)) sortRing(r, name, out);
      else if (wall) lines.push(r);
    }
  }
  out.walls.push(...chainWays(lines));
  return out;
}

/** The walls and castles among Nominatim's answers for a name: only fortifications and buildings, never a town or a district of the same name. */
export function siteFromNominatim(results: readonly { category?: string; type?: string; name?: string; geojson?: { type: string; coordinates: unknown } }[]): SiteData {
  const out = { walls: [] as Pt[][], castles: [] as { ring: Pt[]; name?: string }[], gates: [] as { at: Pt; name?: string }[] };
  for (const r of results) {
    const fort = r.category === "historic" || r.category === "building" || r.category === "barrier" || r.category === "military" || (r.category === "tourism" && /castle|fortress|fort|wall|hisar|kale/i.test(r.name ?? ""));
    if (!fort || !r.geojson) continue;
    const g = r.geojson;
    const polygons = g.type === "Polygon" ? [g.coordinates as Pt[][]] : g.type === "MultiPolygon" ? (g.coordinates as Pt[][][]) : [];
    for (const p of polygons) if (p[0] && p[0].length > 3) sortRing(p[0], r.name, out);
    const lines = g.type === "LineString" ? [g.coordinates as Pt[]] : g.type === "MultiLineString" ? (g.coordinates as Pt[][]) : [];
    out.walls.push(...lines.filter((l) => l.length >= 2));
  }
  return { ...out, walls: joinPieces(out.walls, JOIN_GAP_KM) };
}

/** Two sites as one. */
function merge(a: SiteData, b: SiteData): SiteData {
  const named = [...(a.namedWalls ?? []), ...(b.namedWalls ?? [])];
  return { walls: [...a.walls, ...b.walls], castles: [...a.castles, ...b.castles], gates: [...a.gates, ...b.gates], ...(named.length ? { namedWalls: named } : {}) };
}

/** A closed outline's middle (its points' mean, enough for a castle). */
function middle(ring: readonly Pt[]): Pt {
  const r = closed(ring) ? ring.slice(0, -1) : ring;
  return [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length];
}

function insideRing(p: readonly [number, number], ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** What the preparer did with one wall (for the log and the council). */
export interface WallNote {
  readonly sahne: string;
  readonly ad: string;
  readonly kaynak: "osm" | "yazar" | "kale" | "kutuphane" | "kusatma";
  readonly ayrinti: string;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * One wall of a close map with its real trace from the site where there is one: a castle by its outline round (or
 * containing) its centre, a wall by the real walls along the writer's line; real gates on it are added when the writer
 * gave fewer than two. Without a trace the writer's line stays, and a castle is drawn in its period's manner.
 */
export function placeWall(w: MapWall, site: SiteData | undefined, year: number | undefined): { wall: MapWall; extra?: MapWall[]; note: Omit<WallNote, "sahne"> } {
  const ad = w.ad ?? w.osm_ad ?? "wall";
  if (w.kale) {
    const c = w.kale.merkez;
    const found = site?.castles
      .map((k) => ({ k, km: kmBetween(c, middle(k.ring)) }))
      .filter((x) => insideRing(c, x.k.ring) || x.km <= Math.max(0.6, w.kale!.km))
      .sort((a, b) => a.km - b.km)[0];
    // The castle's own walls where OSM maps them (Belgrade: 147 wall pieces, its upper and lower town, seven named
    // gates): every wall line in its area, the longest one carrying the name and the breach, the gates on each.
    const reach = Math.max(0.5, w.kale.km * 0.75, found ? Math.max(...found.k.ring.map((p) => kmBetween(c, p))) * 1.3 : 0);
    const near = (site?.walls ?? [])
      .flatMap((l) => joinPieces([l], 0.05))
      .filter((l) => l.filter((p) => kmBetween(c, p) <= reach).length >= l.length * 0.6)
      .map((l) => simplifyLine(l, WALL_SIMPLIFY_DEG).map((p): Pt => [r6(p[0]), r6(p[1])]))
      .filter((l) => l.length >= 2 && lineKm(l) >= 0.06)
      .sort((a, b) => lineKm(b) - lineKm(a))
      .slice(0, 12);
    const wallKm = near.reduce((a, l) => a + lineKm(l), 0);
    if (near.length && wallKm >= Math.max(0.3, w.kale.km * 1.2)) {
      const gatesOn = (l: readonly Pt[]) => (site?.gates ?? []).filter((g) => l.some((p, i) => i > 0 && segmentKm(l[i - 1]!, p, g.at) <= 0.03)).map((g) => g.at);
      const [main, ...rest] = near;
      const mainGates = [...(w.kapilar ?? []), ...gatesOn(main!)].slice(0, 8);
      const extra: MapWall[] = rest.map((l) => ({ noktalar: l, ...((g) => (g.length ? { kapilar: g.slice(0, 6) } : {}))(gatesOn(l)) }));
      return { wall: { ...w, noktalar: main!, ...(mainGates.length ? { kapilar: mainGates } : {}) }, extra, note: { ad, kaynak: "osm", ayrinti: `kalenin surları OpenStreetMap'ten (${near.length} hat, ${Math.round(wallKm * 10) / 10} km, ${(site?.gates ?? []).filter((g) => kmBetween(c, g.at) <= reach).length} kapı)` } };
    }
    if (found) {
      const ring = simplifyLine(found.k.ring, WALL_SIMPLIFY_DEG).map((p): Pt => [r6(p[0]), r6(p[1])]);
      return { wall: { ...w, noktalar: ring }, note: { ad, kaynak: "osm", ayrinti: `kale çevresi OpenStreetMap'ten (${found.k.name ?? "adsız"}, ${ring.length} nokta)` } };
    }
    return { wall: w, note: { ad, kaynak: "kale", ayrinti: `OpenStreetMap'te çevresi yok: ${w.kale.bicim ?? castleStyleFor(year)} biçiminde ${w.kale.km} km'lik kale çizildi` } };
  }
  const script = (w.noktalar ?? []).map((p): Pt => [p[0], p[1]]);
  const fit = site ? fitWall(script, [...site.walls, ...site.castles.map((k) => k.ring)]) : undefined;
  if (!fit) return { wall: w, note: { ad, kaynak: "yazar", ayrinti: site ? "OpenStreetMap'te bu çizgi boyunca sur yok: yazarın çizgisi kaldı" : "açık veri alınamadı: yazarın çizgisi kaldı" } };
  const noktalar = simplifyLine(fit, WALL_SIMPLIFY_DEG).map((p): Pt => [r6(p[0]), r6(p[1])]);
  // The real gates standing on the wall, when the writer marked fewer than two.
  const onWall = (site?.gates ?? []).filter((g) => noktalar.some((p, i) => i > 0 && segmentKm(noktalar[i - 1]!, p, g.at) <= 0.06));
  const kapilar = (w.kapilar?.length ?? 0) >= 2 || !onWall.length ? w.kapilar : [...(w.kapilar ?? []), ...onWall.slice(0, 8).map((g) => g.at)];
  return { wall: { ...w, noktalar, ...(kapilar ? { kapilar } : {}) }, note: { ad, kaynak: "osm", ayrinti: `sur izi OpenStreetMap'ten (${noktalar.length} nokta${onWall.length && kapilar !== w.kapilar ? `, ${Math.min(8, onWall.length)} gerçek kapı` : ""})` } };
}

/** A guessed wall is moved onto a real one at most this far away (km). */
const SNAP_MAX_KM = 2.5;
/** Only a real wall at least this long (km) is worth moving a battle onto. */
const SNAP_MIN_WALL_KM = 0.8;
/**
 * The stretch of the real wall kept round the snap point (km each way): a city's whole land wall (Constantinople's runs
 * 6.5 km from the Marmara to the Golden Horn; owner, 20 Nov 2026: "the walls must be in their real place, like the real
 * walls" — a 3 km stub in open fields was not).
 */
const SNAP_REACH_KM = 4.5;
/** Real wall pieces this close (km) are one wall when moving a map (a gate tower or a missing stretch between them). */
const SNAP_JOIN_KM = 0.5;
/** Other real walls in the map (sea walls, a citadel) at least this long (km) are drawn too. */
const SNAP_EXTRA_MIN_KM = 0.3;
/** A moved map is widened to show its whole wall, up to this width (km). */
const SNAP_MAX_WIDTH_KM = 16;

/** Where on a line the point `p` is closest: the point, the distance (km), the line's direction there (radians, km space) and the distance along the line. */
function nearestOnLine(line: readonly Pt[], p: Pt): { at: Pt; km: number; angle: number; along: number } {
  const k = { x: 111.32 * Math.cos((p[1] * Math.PI) / 180), y: 110.57 };
  let best = { at: line[0]!, km: Infinity, angle: 0, along: 0 };
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1]!, line[i]!];
    const [ax, ay, bx, by] = [(a[0] - p[0]) * k.x, (a[1] - p[1]) * k.y, (b[0] - p[0]) * k.x, (b[1] - p[1]) * k.y];
    const [dx, dy] = [bx - ax, by - ay];
    const len = Math.hypot(dx, dy);
    const u = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1e-12)));
    const km = Math.hypot(ax + dx * u, ay + dy * u);
    if (km < best.km) best = { at: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], km, angle: Math.atan2(dy, dx), along: walked + len * u };
    walked += len;
  }
  return best;
}

/**
 * A close map whose writer drew its wall where no real wall runs, moved onto the nearest real one. The Constantinople
 * Short (20 Nov 2026, owner: "the close battle scenes are very bad"): the writer guessed the Theodosian Walls as a
 * 1.5 km east–west line inside the old city, OpenStreetMap has them 1.7 km west running north–south, `fitWall` rightly
 * refused, and the writer's line stayed — armies on empty hills, the walls a short grey stroke. The whole map content
 * (every longitude/latitude pair: centre, units, badges, the breach) is moved and turned as one body about the writer's
 * wall, so the sides keep their places along it, and the wall becomes the real trace round that point. Undefined when
 * the map has not exactly one wall with points, the site has no real wall of length near, or the line already fits.
 */
export function snapMapToRealWall(map: SceneMap, site: SiteData | undefined): { map: SceneMap; detail: string } | undefined {
  const w = map.surlar?.length === 1 ? map.surlar[0]! : undefined;
  const script = (w?.noktalar ?? []).map((p): Pt => [p[0], p[1]]);
  if (!w || w.kale || script.length < 2 || !site) return undefined;
  const joined = joinPieces(site.walls, JOIN_GAP_KM);
  // The real wall of the writer's own name when OSM names it ("Theodosian Walls" → the ways "Theodosian Wall"): a land
  // wall meets the sea walls at its ends, and a chain of every wall turned the land wall into an L along the coast.
  const words = (s: string | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z]+/).filter((x) => x.length >= 5 && !/^(walls?|city|citywalls?)$/.test(x));
  const own = new Set([...words(w.ad), ...words(w.osm_ad)]);
  const namedLines = joinPieces((site.namedWalls ?? []).filter((n) => words(n.name).some((x) => own.has(x) || own.has(x.replace(/s$/, "")) || own.has(`${x}s`))).map((n) => n.line), SNAP_JOIN_KM);
  const lines = (namedLines.some((l) => lineKm(l) >= SNAP_MIN_WALL_KM) ? namedLines : joined).filter((l) => lineKm(l) >= SNAP_MIN_WALL_KM);
  // A line that already follows the real wall: nothing moves, but a wall OSM names still gets its whole length, the
  // city's other walls and the city behind it (the Constantinople remake, 20 Nov 2026: a fitting line kept a 3.5 km
  // stretch and no city).
  const fits = lines.length > 0 && Boolean(fitWall(script, lines));
  if (!lines.length || (fits && !namedLines.some((l) => lineKm(l) >= SNAP_MIN_WALL_KM))) return undefined;
  const c: Pt = [script.reduce((a, p) => a + p[0], 0) / script.length, script.reduce((a, p) => a + p[1], 0) / script.length];
  const hit = lines.map((line) => ({ line, ...nearestOnLine(line, c) })).sort((a, b) => a.km - b.km)[0]!;
  if (hit.km > SNAP_MAX_KM) return undefined;
  const k = { x: 111.32 * Math.cos((c[1] * Math.PI) / 180), y: 110.57 };
  const first = script[0]!;
  const last = script[script.length - 1]!;
  const writerAngle = Math.atan2((last[1] - first[1]) * k.y, (last[0] - first[0]) * k.x);
  // Lines have no direction: the smaller turn (at most a quarter) keeps the sides as drawn.
  let turn = hit.angle - writerAngle;
  while (turn > Math.PI / 2) turn -= Math.PI;
  while (turn <= -Math.PI / 2) turn += Math.PI;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  const near = (v: number, from: number) => Math.abs(v - from) < 1;
  const move = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      if (value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number" && near(value[0], c[0]) && near(value[1], c[1])) {
        const [x, y] = [(value[0] - c[0]) * k.x, (value[1] - c[1]) * k.y];
        const [rx, ry] = [x * cos - y * sin, x * sin + y * cos];
        return [Math.round((hit.at[0] + rx / k.x) * 1e6) / 1e6, Math.round((hit.at[1] + ry / k.y) * 1e6) / 1e6];
      }
      return value.map(move);
    }
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, move(v)]));
    return value;
  };
  const moved = fits ? map : (move(map) as SceneMap);
  if (fits) turn = 0;
  // The real trace round the snap point: a stretch of the line, its gates on it.
  let walked = 0;
  const run: Pt[] = [];
  for (let i = 0; i < hit.line.length; i++) {
    if (i > 0) walked += kmBetween(hit.line[i - 1]!, hit.line[i]!);
    if (Math.abs(walked - hit.along) <= SNAP_REACH_KM) run.push(hit.line[i]!);
  }
  const noktalar = (run.length >= 2 ? simplifyLine(run, WALL_SIMPLIFY_DEG) : hit.line).map((p): Pt => [r6(p[0]), r6(p[1])]);
  const gates = site.gates.filter((g) => noktalar.some((p, i) => i > 0 && segmentKm(noktalar[i - 1]!, p, g.at) <= 0.06)).slice(0, 8).map((g) => g.at);
  const wall = { ...moved.surlar![0]!, noktalar, ...(gates.length ? { kapilar: gates } : {}) };
  // The other real walls round it (a city's sea walls, its citadel), without names, with their gates.
  const reachKm = Math.max(map.genislik_km ?? 10, lineKm(noktalar)) * 0.75;
  // Cut away what lies on the land wall itself (the same stones mapped twice would let the city's houses through it).
  const onMain = (p: Pt) => noktalar.some((q, i) => i > 0 && segmentKm(noktalar[i - 1]!, q, p) <= 0.15);
  const pieces = joined.flatMap((l) => {
    const out: Pt[][] = [[]];
    for (const p of l) {
      if (onMain(p)) out.push([]);
      else out[out.length - 1]!.push(p);
    }
    return out;
  });
  const extras = pieces
    .filter((l) => l.length >= 2 && lineKm(l) >= SNAP_EXTRA_MIN_KM && l.some((p) => kmBetween(p, hit.at) <= reachKm))
    .map((l) => simplifyLine(l, WALL_SIMPLIFY_DEG).map((p): Pt => [r6(p[0]), r6(p[1])]))
    .slice(0, 12);
  const extraWalls = extras.map((l) => ((g) => ({ noktalar: l, ...(g.length ? { kapilar: g.slice(0, 6) } : {}) }))(site.gates.filter((g) => l.some((p, i) => i > 0 && segmentKm(l[i - 1]!, p, g.at) <= 0.06)).map((g) => g.at)));
  // The walled city behind its land wall, on the side its other walls stand (the sea walls close the city's far side).
  const side = (p: Pt) => {
    const [a, b] = [noktalar[0]!, noktalar[noktalar.length - 1]!];
    return Math.sign((b[0] - a[0]) * k.x * (p[1] - a[1]) * k.y - (b[1] - a[1]) * k.y * (p[0] - a[0]) * k.x);
  };
  const extraPts = extras.flat();
  const cityWard = extraPts.length ? Math.sign(extraPts.reduce((n, p) => n + side(p), 0)) : 0;
  const wallMid = noktalar[Math.floor(noktalar.length / 2)]!;
  const cityPts = extraPts.filter((p) => side(p) === cityWard);
  const city: Pt | undefined = cityWard && cityPts.length ? [(wallMid[0] + cityPts.reduce((a, p) => a + p[0], 0) / cityPts.length) / 2, (wallMid[1] + cityPts.reduce((a, p) => a + p[1], 0) / cityPts.length) / 2] : undefined;
  const cityName = /^Walls of (.+)$/i.exec(w.osm_ad ?? "")?.[1] ?? /^(.+?) (?:city )?walls$/i.exec(w.osm_ad ?? "")?.[1];
  const cityKm = city ? Math.min(12, 2 * Math.max(...[...noktalar, ...cityPts].map((p) => kmBetween(p, city)))) : 0;
  const yerlesimler = city && !moved.yerlesimler?.length ? [{ tur: "sehir" as const, ...(cityName ? { ad: cityName } : {}), konum: [r6(city[0]), r6(city[1])] as [number, number], km: Math.round(cityKm * 10) / 10, sur_ici: true }] : moved.yerlesimler;
  // Wide enough for the whole land wall (16:9: its height is 9/16 of the width).
  const lats = noktalar.map((p) => p[1]);
  const lons = noktalar.map((p) => p[0]);
  const spanKm = Math.max((Math.max(...lons) - Math.min(...lons)) * k.x * 1.15, (Math.max(...lats) - Math.min(...lats)) * k.y * 1.15 * (16 / 9));
  // The writer's frame is kept when the real wall stands in it: its coast is already in the library (Overpass is often
  // down; a new box then gets Natural Earth's coarse coast — a straight line with the sea walls in the water).
  const half = { lon: (map.genislik_km ?? 10) / 2 / k.x, lat: ((map.genislik_km ?? 10) * 9) / 16 / 2 / k.y };
  const inFrame = map.merkez !== undefined && Math.abs(hit.at[0] - map.merkez[0]) <= half.lon && Math.abs(hit.at[1] - map.merkez[1]) <= half.lat;
  const genislik_km = inFrame ? map.genislik_km! : Math.min(SNAP_MAX_WIDTH_KM, Math.max(map.genislik_km ?? 0, Math.round(spanKm * 10) / 10));
  const centre: [number, number] = inFrame ? [map.merkez![0], map.merkez![1]] : [r6((Math.max(...lons) + Math.min(...lons)) / 2), r6((Math.max(...lats) + Math.min(...lats)) / 2)];
  return {
    map: { ...moved, merkez: centre, genislik_km, surlar: [wall, ...extraWalls], ...(yerlesimler ? { yerlesimler } : {}) },
    detail: `${fits ? "yazarın çizgisi gerçek sura uyuyordu: surun tamamı alındı;" : `yazarın çizgisi gerçek surlara uymuyordu: harita ${Math.round(hit.km * 10) / 10} km taşındı, ${Math.round((turn * 180) / Math.PI)}° döndürüldü;`} sur izi OpenStreetMap'ten (${noktalar.length} nokta, ${Math.round(lineKm(noktalar) * 10) / 10} km${extras.length ? `, ${extras.length} başka sur` : ""}${city ? `, sur içinde şehir${cityName ? ` "${cityName}"` : ""}` : ""}), harita ${genislik_km} km`,
  };
}

/** Distance (km) from `p` to the segment a–b. */
function segmentKm(a: Pt, b: Pt, p: Pt): number {
  const k = { x: 111.32 * Math.cos((p[1] * Math.PI) / 180), y: 110.57 };
  const [ax, ay, bx, by] = [(a[0] - p[0]) * k.x, (a[1] - p[1]) * k.y, (b[0] - p[0]) * k.x, (b[1] - p[1]) * k.y];
  const [dx, dy] = [bx - ax, by - ay];
  const u = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1e-12)));
  return Math.hypot(ax + dx * u, ay + dy * u);
}

/** The box a close map's world covers (every camera view and a margin), in longitude/latitude. */
export function closeBox(map: SceneMap): Box {
  const b = mapWorld(map, 1920, 1080).bounds;
  return { west: b.west, east: b.east, south: b.south, north: b.north };
}

/** Whether an episode has a close battle map (the preparer's work: its walls, or a siege's castle left out). */
export function hasCloseMap(episode: Episode): boolean {
  return episode.sahneler.some((s) => s.harita?.merkez && s.harita.genislik_km !== undefined && s.harita.genislik_km <= CLOSE_MAP_MAX_KM);
}

/** A fortress's name in a scene's place ("Close battle map: Belgrade Fortress and Danube" → "Belgrade Fortress"). */
const FORTRESS_NAME = /((?:[A-ZÀ-Ý][\p{L}'’.-]*\s){1,3}(?:Fortress|Castle|Citadel|Kalesi|Hisarı|Fort|Walls))|((?:Fortress|Castle|Citadel|Walls) of (?:[A-ZÀ-Ý][\p{L}'’.-]*\s?){1,3})/u;
/** A drawn castle's size when the siege ring gives none (km across). */
const SIEGED_CASTLE_KM = 0.8;

/**
 * The castle a close map's siege is about, when the writer drew no walls (the Belgrade run, 23 Oct 2026: the walls
 * were asked for twice and never given): at the centre of a siege ring, else at a castle the map stands as a single
 * building, named from the scene's place or that building. Undefined for a field battle.
 */
export function impliedCastle(s: Episode["sahneler"][number]): MapWall | undefined {
  const h = s.harita;
  if (!h || h.surlar?.length) return undefined;
  const ring = (h.birlikler ?? []).flatMap((u) => u.yerler).find((y) => "kusatma" in y) as { kusatma: readonly [number, number]; km?: number } | undefined;
  const keep = (h.yapilar ?? []).find((b) => b.tur === "kale");
  const centre = ring?.kusatma ?? keep?.konum;
  if (!centre) return undefined;
  const named = (s.mekan ?? "").match(FORTRESS_NAME);
  const ad = (named?.[1] ?? named?.[2])?.trim() ?? keep?.ad;
  const km = ring?.km ? Math.min(2, Math.max(0.3, ring.km * 0.45)) : SIEGED_CASTLE_KM;
  return { ...(ad ? { ad } : {}), kale: { merkez: [centre[0], centre[1]], km: Math.round(km * 100) / 100 } };
}

/**
 * Every close map of an episode with its walls and castles on their real traces (and a siege's castle the writer left
 * out). The episode's year picks the style of a drawn castle. Without the internet every wall stays as written (and
 * the notes say so).
 */
export async function prepareCloseMaps(episode: Episode, lookup: SiteLookup, year: number | undefined): Promise<{ episode: Episode; notes: WallNote[]; sources: string[] }> {
  const notes: WallNote[] = [];
  const sources = new Set<string>();
  const sahneler = [];
  const places = new Set<string>();
  for (const original of episode.sahneler) {
    const close = original.harita?.genislik_km !== undefined && original.harita.genislik_km <= CLOSE_MAP_MAX_KM;
    const implied = close ? impliedCastle(original) : undefined;
    if (implied) notes.push({ sahne: original.id, ad: implied.ad ?? "kale", kaynak: "kale", ayrinti: `yazar suru çizmemişti: kuşatmanın merkezine ${implied.kale!.km} km'lik kale kondu` });
    const s = implied ? { ...original, harita: { ...original.harita!, surlar: [implied] } } : original;
    let h = s.harita;
    const walls = h?.surlar;
    if (!h?.merkez || !h.genislik_km || !close || !walls?.length) {
      sahneler.push(s);
      continue;
    }
    // The writer's names, then the names OSM often gives a town's walls ("Walls of Constantinople").
    const towns = (h.sehirler ?? []).map((c) => c.ad).slice(0, 2);
    const names = [...new Set([...walls.flatMap((w) => [w.osm_ad, w.ad].filter((n): n is string => Boolean(n))), ...towns.flatMap((t) => [`Walls of ${t}`, `${t} city walls`])])].slice(0, 6);
    let got = await lookup(closeBox(h), names, year).catch(() => undefined);
    if (got?.sources.includes("overpass")) await lookup.library?.keep({ merkez: [h.merkez[0], h.merkez[1]], genislik_km: h.genislik_km, box: closeBox(h) }).catch(() => undefined);
    else if (lookup.library) {
      // Overpass did not answer for a new box: a box of the same place in the library is taken instead (same centre and
      // width), so the map gets its real coast and walls rather than Natural Earth's straight coast (the Constantinople
      // remake, 20 Nov 2026, set its close maps on the first run's box by hand).
      const lib = libraryBoxFor(h, await lookup.library.boxes().catch(() => []));
      const onLib = lib ? { ...h, merkez: lib.merkez, genislik_km: lib.genislik_km } : undefined;
      const again = onLib && sameBox(closeBox(onLib), lib!.box) ? await lookup(lib!.box, names, year).catch(() => undefined) : undefined;
      if (onLib && again?.sources.includes("overpass")) {
        notes.push({ sahne: s.id, ad: walls[0]!.ad ?? walls[0]!.osm_ad ?? "wall", kaynak: "kutuphane", ayrinti: `Overpass bu kutu için yanıt vermedi: harita kütüphanedeki kutuya oturtuldu ([${lib!.merkez.join(", ")}], ${lib!.genislik_km} km; gerçek kıyı ve surlar)` });
        h = onLib;
        got = again;
      }
    }
    for (const src of got?.sources ?? []) sources.add(src);
    // A wall the writer drew where no real one runs: the whole map moves onto the nearest real wall.
    const snapped = snapMapToRealWall(h, got?.site);
    if (snapped) notes.push({ sahne: s.id, ad: walls[0]!.ad ?? walls[0]!.osm_ad ?? "wall", kaynak: "osm", ayrinti: snapped.detail });
    const site = got?.site;
    const placed: SceneMap = snapped?.map ?? {
      ...h,
      surlar: walls.flatMap((w) => {
        const r = placeWall(w, site, year);
        notes.push({ sahne: s.id, ...r.note });
        return [r.wall, ...(r.extra ?? [])];
      }),
    };
    // The siege's camp, guns, breach and lines along the real wall (SiegeMap; the hand patch of 20 Nov 2026 as rules).
    const place = siegePlaceKey(placed);
    // A front that would widen the world shortens (a map already widened by the writer's own action is not held to it).
    const ownWorld = drawnOnOwnWorld(placed);
    const filled = fillSiegeMap(placed, !places.has(place), (m) => !ownWorld || drawnOnOwnWorld(m));
    if (isSiegeMap(placed)) places.add(place);
    for (const fix of filled.fixes) notes.push({ sahne: s.id, ad: placed.surlar?.[0]?.ad ?? placed.surlar?.[0]?.osm_ad ?? "wall", kaynak: "kusatma", ayrinti: fix });
    sahneler.push({ ...s, harita: filled.map });
  }
  return { episode: { ...episode, sahneler }, notes, sources: [...sources] };
}

/**
 * Whether the director draws this map on its own world: no camera stop of its framing (over the whole stage or a
 * Short's window, groundOf) reaches past it. A world widened past the box loses the box's cached coast and walls.
 */
function drawnOnOwnWorld(map: SceneMap): boolean {
  const ground = groundOf(map, 1920, 1080);
  if (!ground) return true;
  const own = mapWorld(map, 1920, 1080, mapTilt(map) !== undefined).bounds;
  const b = ground.world.bounds;
  return [b.west - own.west, b.east - own.east, b.south - own.south, b.north - own.north].every((d) => Math.abs(d) < 1e-9);
}

const sameBox = (a: Box, b: Box) => [a.west - b.west, a.east - b.east, a.south - b.south, a.north - b.north].every((d) => Math.abs(d) < 1e-4);

/**
 * The library box a new close map can stand on: one whose frame holds the map's centre, of a width between half and
 * twice its own, the nearest such. Undefined when none is near.
 */
export function libraryBoxFor(map: SceneMap, boxes: readonly LibraryBox[]): LibraryBox | undefined {
  if (!map.merkez || !map.genislik_km) return undefined;
  const c = map.merkez;
  const kx = 111.32 * Math.cos((c[1] * Math.PI) / 180);
  return boxes
    .filter((b) => b.genislik_km >= map.genislik_km! / 2 && b.genislik_km <= map.genislik_km! * 2)
    .filter((b) => Math.abs(b.merkez[0] - c[0]) * kx <= b.genislik_km / 2 && Math.abs(b.merkez[1] - c[1]) * 110.57 <= (b.genislik_km * 9) / 32)
    .sort((a, b) => kmBetween(a.merkez, c) - kmBetween(b.merkez, c))[0];
}

/**
 * The site lookup over the library, Overpass and Nominatim (one request a second to Nominatim, as its policy asks).
 * Each answer is kept under its box (and name), so a later run reads it back; a source that does not answer is tried
 * again next time.
 */
export function closeSiteLookup(paths: Pick<V3Paths, "workRoot">, log: (s: string) => void = () => {}): SiteLookup {
  const dir = path.join(paths.workRoot, "_kutuphane", "osm-sur");
  const keyOf = (o: unknown) => createHash("sha256").update(JSON.stringify({ v: SITE_VERSION, o })).digest("hex").slice(0, 20);
  const kept = async <T>(key: string, fetchIt: () => Promise<T>): Promise<T> => {
    const file = path.join(dir, `${key}.json`);
    if (existsSync(file)) return JSON.parse(await fs.readFile(file, "utf8")) as T;
    const value = await fetchIt();
    await fs.mkdir(dir, { recursive: true });
    if (!existsSync(file)) await fs.writeFile(file, JSON.stringify(value));
    return value;
  };
  const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
  // Overpass down once in a run is not asked again for the next scene (each try waits on four servers).
  let overpassDown = false;
  // The boxes Overpass answered for, one JSON a line (append-only, like the answers themselves).
  const index = path.join(dir, "kutular.jsonl");
  const library: SiteLibrary = {
    async boxes() {
      if (!existsSync(index)) return [];
      return (await fs.readFile(index, "utf8")).split(/\r?\n/).flatMap((line) => {
        try {
          const b = JSON.parse(line) as LibraryBox;
          return Array.isArray(b?.merkez) && typeof b.genislik_km === "number" && b.box ? [b] : [];
        } catch {
          return [];
        }
      });
    },
    async keep(entry) {
      const box = { west: r4(entry.box.west), east: r4(entry.box.east), south: r4(entry.box.south), north: r4(entry.box.north) };
      if ((await library.boxes()).some((b) => b.merkez[0] === entry.merkez[0] && b.merkez[1] === entry.merkez[1] && b.genislik_km === entry.genislik_km)) return;
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(index, `${JSON.stringify({ merkez: entry.merkez, genislik_km: entry.genislik_km, box })}\n`);
    },
  };
  const lookup = async (box: Box, names: readonly string[], year?: number) => {
    const b = { west: r4(box.west), east: r4(box.east), south: r4(box.south), north: r4(box.north) };
    const bbox = `${b.south},${b.west},${b.north},${b.east}`;
    let site: SiteData = { walls: [], castles: [], gates: [] };
    const sources: string[] = [];
    try {
      if (overpassDown && !existsSync(path.join(dir, `${keyOf({ overpass: b })}.json`))) throw new Error("bu çalıştırmada yanıt vermemişti");
      const query = `[out:json][timeout:40];(way["barrier"="city_wall"](${bbox});way["historic"="citywalls"](${bbox});way["historic"~"^(castle|fort|fortress|citadel)$"](${bbox});relation["historic"~"^(castle|fort|fortress|citadel)$"](${bbox});node["barrier"="city_gate"](${bbox});node["historic"="city_gate"](${bbox}););out tags geom;`;
      const elements = await kept(keyOf({ overpass: b }), async () => (await overpass(query, 45_000)).elements ?? []);
      site = merge(site, siteFromOverpass(elements));
      sources.push("overpass");
    } catch (e) {
      overpassDown = true;
      log(`  yakın harita: Overpass yanıt vermedi (${(e as Error).message.slice(0, 100)}); Nominatim denenir`);
    }
    // OpenHistoricalMap when OSM gave no wall or castle (down, or the walls are long gone): the same tags, only what
    // stood in the episode's year.
    if (year !== undefined && !site.walls.length && !site.castles.length) {
      try {
        const query = `[out:json][timeout:40];(way["barrier"="city_wall"](${bbox});way["historic"="citywalls"](${bbox});way["historic"~"^(castle|fort|fortress|citadel)$"](${bbox});relation["historic"~"^(castle|fort|fortress|citadel)$"](${bbox});node["barrier"="city_gate"](${bbox});node["historic"="city_gate"](${bbox}););out tags geom;`;
        const elements = await kept(keyOf({ ohm: b }), async () => (await ohmOverpass(query, 45_000)).elements ?? []);
        const standing = elements.filter((el) => standingIn(el.tags, year));
        const found = siteFromOverpass(standing);
        if (found.walls.length || found.castles.length || found.gates.length) {
          site = merge(site, found);
          sources.push("ohm");
          log(`  yakın harita: OpenHistoricalMap ${year} yılında ayakta ${found.walls.length} sur, ${found.castles.length} kale, ${found.gates.length} kapı verdi`);
        }
      } catch (e) {
        log(`  yakın harita: OpenHistoricalMap yanıt vermedi (${(e as Error).message.slice(0, 80)})`);
      }
    }
    for (const name of names) {
      try {
        const results = await kept(keyOf({ nominatim: name, b }), async () => {
          await new Promise((r) => setTimeout(r, 1100));
          const params = new URLSearchParams({ q: name, format: "jsonv2", polygon_geojson: "1", polygon_threshold: "0.00003", limit: "5", "accept-language": "en", viewbox: `${b.west},${b.north},${b.east},${b.south}`, bounded: "1" });
          const res = await fetch(`${NOMINATIM}?${params}`, { headers: { "User-Agent": userAgentFor(NOMINATIM), Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
          if (!res.ok) throw new Error(`NOMINATIM_HTTP_${res.status}`);
          return (await res.json()) as Parameters<typeof siteFromNominatim>[0];
        });
        site = merge(site, siteFromNominatim(results));
        if (!sources.includes("nominatim")) sources.push("nominatim");
      } catch (e) {
        log(`  yakın harita: "${name}" Nominatim'de aranamadı (${(e as Error).message.slice(0, 80)})`);
      }
    }
    return sources.length ? { site, sources } : undefined;
  };
  return Object.assign(lookup, { library });
}

