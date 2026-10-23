import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { USER_AGENT } from "../backgrounds/CommonsProvider";
import { CLOSE_MAP_MAX_KM, type Episode, type MapWall, type SceneMap } from "../episode/EpisodeTypes";
import type { V3Paths } from "../V3Paths";
import { castleStyleFor, fitWall, joinPieces, kmBetween, lineKm, type Pt, roundness, stripCentreline } from "./CastleShapes";
import { type Box, chainWays, type OsmElement, overpass, simplifyLine } from "./CloseCoast";
import { mapWorld } from "./MapBuilder";

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
}

/** The site of a box, with the names of its walls and castles to look up; undefined when no source answered. */
export type SiteLookup = (box: Box, names: readonly string[]) => Promise<{ site: SiteData; sources: string[] } | undefined>;

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
  const out = { walls: [] as Pt[][], castles: [] as { ring: Pt[]; name?: string }[], gates: [] as { at: Pt; name?: string }[] };
  const lines: Pt[][] = [];
  for (const e of elements) {
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
  return { walls: [...a.walls, ...b.walls], castles: [...a.castles, ...b.castles], gates: [...a.gates, ...b.gates] };
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
  readonly kaynak: "osm" | "yazar" | "kale";
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
  for (const original of episode.sahneler) {
    const close = original.harita?.genislik_km !== undefined && original.harita.genislik_km <= CLOSE_MAP_MAX_KM;
    const implied = close ? impliedCastle(original) : undefined;
    if (implied) notes.push({ sahne: original.id, ad: implied.ad ?? "kale", kaynak: "kale", ayrinti: `yazar suru çizmemişti: kuşatmanın merkezine ${implied.kale!.km} km'lik kale kondu` });
    const s = implied ? { ...original, harita: { ...original.harita!, surlar: [implied] } } : original;
    const h = s.harita;
    if (!h?.merkez || !h.genislik_km || !close || !h.surlar?.length) {
      sahneler.push(s);
      continue;
    }
    // The writer's names, then the names OSM often gives a town's walls ("Walls of Constantinople").
    const towns = (h.sehirler ?? []).map((c) => c.ad).slice(0, 2);
    const names = [...new Set([...h.surlar.flatMap((w) => [w.osm_ad, w.ad].filter((n): n is string => Boolean(n))), ...towns.flatMap((t) => [`Walls of ${t}`, `${t} city walls`])])].slice(0, 6);
    const got = await lookup(closeBox(h), names).catch(() => undefined);
    for (const src of got?.sources ?? []) sources.add(src);
    const surlar = h.surlar.flatMap((w) => {
      const r = placeWall(w, got?.site, year);
      notes.push({ sahne: s.id, ...r.note });
      return [r.wall, ...(r.extra ?? [])];
    });
    sahneler.push({ ...s, harita: { ...h, surlar } });
  }
  return { episode: { ...episode, sahneler }, notes, sources: [...sources] };
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
  return async (box, names) => {
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
    for (const name of names) {
      try {
        const results = await kept(keyOf({ nominatim: name, b }), async () => {
          await new Promise((r) => setTimeout(r, 1100));
          const params = new URLSearchParams({ q: name, format: "jsonv2", polygon_geojson: "1", polygon_threshold: "0.00003", limit: "5", "accept-language": "en", viewbox: `${b.west},${b.north},${b.east},${b.south}`, bounded: "1" });
          const res = await fetch(`${NOMINATIM}?${params}`, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
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
}

