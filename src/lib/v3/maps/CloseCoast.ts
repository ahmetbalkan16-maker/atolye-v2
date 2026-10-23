import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { USER_AGENT } from "../backgrounds/CommonsProvider";
import { CLOSE_MAP_MAX_KM } from "../episode/EpisodeTypes";
import type { V3Paths } from "../V3Paths";
import { inOutline } from "./AdminUnits";
import type { MapWorld, Polygon } from "./MapBuilder";

/**
 * The close battle map's coast (owner, 22 Oct 2026, after DFT Tarih's Osman Bey documentary: "after the outer map a
 * closer map, the ground there, the walls, the cannons, the ships"). Natural Earth has no Golden Horn even at 1:10m, so
 * a map this narrow takes its coastline from OpenStreetMap (© OpenStreetMap contributors, ODbL): the coastline ways in
 * the world's box, joined, cut to the box and closed into land along the box's edge (OSM keeps the land on the left of
 * a coastline). Fetched once per box and kept in the library; no answer: the map keeps Natural Earth's coast.
 */
export { CLOSE_MAP_MAX_KM };
export const OSM_CREDIT = "Map data (coast, walls, castles): © OpenStreetMap contributors (ODbL)";
/** The main Overpass server and public mirrors, tried in turn (the main one answers 502/504 when busy; on 23 Oct 2026 only VK's mirror answered at all). */
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
/** Bump when the assembly changes, so the library builds the coast again. */
const COAST_VERSION = 1;
/** Coast points closer than this to the simplified line are dropped (~13 m). */
const SIMPLIFY_DEG = 0.00012;

type Pt = [number, number];
export interface Box {
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
}
export interface CloseCoast {
  readonly land: Polygon[];
  /** Water the coastline encloses inside the land (a lagoon): drawn over the land like a lake. */
  readonly water: Polygon[];
  /** Rivers and canals as wide as they are (`km`), from OpenStreetMap (CloseCoast.closeRiversFor). */
  readonly rivers?: readonly CloseRiver[];
}

/** A river or canal on the close map: its centre line and width. */
export interface CloseRiver {
  readonly line: Pt[];
  readonly km: number;
  readonly name?: string;
}

/** Bump when the river parsing changes. */
const RIVER_VERSION = 1;
/** The smallest lake drawn on the close map (km²). */
const MIN_LAKE_KM2 = 0.02;

/** A ring's area in km² (local, for a lake). */
function ringKm2(ring: readonly (readonly [number, number])[]): number {
  const kx = 111.32 * Math.max(0.05, Math.cos(((ring[0]?.[1] ?? 0) * Math.PI) / 180));
  return Math.abs(ringArea(ring)) * kx * 110.57;
}

/**
 * A waterway's width: its `width` tag (metres), a navigable river's (a ship or barge class tagged: a great river like
 * the Danube) or an ordinary river's, a canal's.
 */
function riverKm(tags: Readonly<Record<string, string>>): number {
  const w = Number.parseFloat(tags.width ?? "");
  if (Number.isFinite(w) && w > 2) return Math.min(2, w / 1000);
  if (tags.waterway === "canal") return 0.03;
  return tags.CEMT || tags.ship === "yes" || tags.boat === "yes" ? 0.35 : 0.12;
}

/** The rivers, canals and lakes in an Overpass answer, cut to the box (lakes: closed water ways). */
export function riversFromOverpass(elements: readonly OsmElement[], box: Box): { rivers: CloseRiver[]; lakes: Polygon[] } {
  const rivers: CloseRiver[] = [];
  const lakes: Polygon[] = [];
  const byName = new Map<string, { lines: Pt[][]; km: number }>();
  for (const e of elements) {
    const t = e.tags ?? {};
    const line = (e.geometry ?? []).map((g): Pt => [g.lon, g.lat]);
    if (line.length < 2) continue;
    if (t.natural === "water" || t.waterway === "riverbank") {
      if (line.length > 3 && same(line[0]!, line[line.length - 1]!)) lakes.push([line]);
      continue;
    }
    if (t.waterway !== "river" && t.waterway !== "canal") continue;
    // A river's ways joined under its name (OSM splits a river every few kilometres).
    const key = `${t.name ?? ""}|${t.waterway}`;
    const entry = byName.get(key) ?? { lines: [], km: 0 };
    entry.lines.push(line);
    entry.km = Math.max(entry.km, riverKm(t));
    byName.set(key, entry);
  }
  for (const [key, entry] of byName)
    for (const chain of chainWays(entry.lines))
      for (const run of clipChain(simplifyLine(chain, SIMPLIFY_DEG), box)) rivers.push({ line: run, km: entry.km, ...(key.split("|")[0] ? { name: key.split("|")[0]! } : {}) });
  return { rivers, lakes };
}

/**
 * The close map's rivers and lakes from OpenStreetMap for a world's box (most battles are inland: a river is a front,
 * a crossing, a fleet's road); kept in the library; undefined when Overpass does not answer (Natural Earth's rivers are
 * drawn then).
 */
export async function closeRiversFor(paths: Pick<V3Paths, "workRoot">, world: Pick<MapWorld, "bounds">, log: (s: string) => void = () => {}): Promise<{ rivers: CloseRiver[]; lakes: Polygon[] } | undefined> {
  const b = world.bounds;
  const box: Box = { west: round(b.west), east: round(b.east), south: round(b.south), north: round(b.north) };
  const key = createHash("sha256").update(JSON.stringify({ v: RIVER_VERSION, box })).digest("hex").slice(0, 20);
  const lib = path.join(paths.workRoot, "_kutuphane", "osm-nehir", `${key}.json`);
  // Ponds and pools are specks at this scale (the 1453 map trial): lakes from about 150 m across.
  const big = (got: { rivers: CloseRiver[]; lakes: Polygon[] }) => ({ ...got, lakes: got.lakes.filter((p) => p[0] && ringKm2(p[0]) >= MIN_LAKE_KM2) });
  if (existsSync(lib)) return big(JSON.parse(await fs.readFile(lib, "utf8")) as { rivers: CloseRiver[]; lakes: Polygon[] });
  const bbox = `${box.south},${box.west},${box.north},${box.east}`;
  try {
    const json = await overpass(`[out:json][timeout:40];(way["waterway"~"^(river|canal)$"](${bbox});way["natural"="water"](${bbox});way["waterway"="riverbank"](${bbox}););out tags geom;`, 45_000);
    const got = riversFromOverpass(json.elements ?? [], box);
    await fs.mkdir(path.dirname(lib), { recursive: true });
    if (!existsSync(lib)) await fs.writeFile(lib, JSON.stringify(got));
    return big(got);
  } catch (e) {
    log(`⚠ yakın harita nehirleri alınamadı (${(e as Error).message.slice(0, 120)}); Natural Earth nehirleri çizilir`);
    return undefined;
  }
}

const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/** Coastline ways joined end to start into the longest chains they make (a closed island comes out closed). */
export function chainWays(ways: readonly (readonly Pt[])[]): Pt[][] {
  const chains = ways.filter((w) => w.length >= 2).map((w) => [...w]);
  for (let joined = true; joined; ) {
    joined = false;
    for (let a = 0; a < chains.length && !joined; a++)
      for (let b = 0; b < chains.length && !joined; b++) {
        if (a === b || same(chains[a]![0]!, chains[a]![chains[a]!.length - 1]!)) continue;
        if (same(chains[a]![chains[a]!.length - 1]!, chains[b]![0]!)) {
          chains[a] = [...chains[a]!, ...chains[b]!.slice(1)];
          chains.splice(b, 1);
          joined = true;
        }
      }
  }
  return chains;
}

/** Douglas–Peucker: the line with points closer than `tol` to it dropped (ends kept). */
export function simplifyLine(line: readonly Pt[], tol: number): Pt[] {
  if (line.length < 3) return [...line];
  const keep = new Array<boolean>(line.length).fill(false);
  keep[0] = keep[line.length - 1] = true;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = line[i]!;
    const [bx, by] = line[j]!;
    const len = Math.hypot(bx - ax, by - ay);
    let far = -1;
    let dist = tol;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = line[k]!;
      const d = len ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
      if (d > dist) [far, dist] = [k, d];
    }
    if (far >= 0) {
      keep[far] = true;
      stack.push([i, far], [far, j]);
    }
  }
  return line.filter((_, k) => keep[k]);
}

const inside = (p: Pt, b: Box) => p[0] >= b.west && p[0] <= b.east && p[1] >= b.south && p[1] <= b.north;

/** The part of segment a→b inside the box (Liang–Barsky), or undefined. */
function clipSegment(a: Pt, b: Pt, box: Box): [Pt, Pt] | undefined {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  for (const [p, q] of [
    [-dx, a[0] - box.west],
    [dx, box.east - a[0]],
    [-dy, a[1] - box.south],
    [dy, box.north - a[1]],
  ] as const) {
    if (p === 0) {
      if (q < 0) return undefined;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return undefined;
  }
  return [
    [a[0] + dx * t0, a[1] + dy * t0],
    [a[0] + dx * t1, a[1] + dy * t1],
  ];
}

/** A chain cut to the box: the runs inside it (an open run starts and ends on the box's edge). */
export function clipChain(chain: readonly Pt[], box: Box): Pt[][] {
  if (chain.every((p) => inside(p, box))) return [[...chain]];
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  for (let i = 1; i < chain.length; i++) {
    const seg = clipSegment(chain[i - 1]!, chain[i]!, box);
    if (!seg) {
      if (run.length > 1) runs.push(run);
      run = [];
      continue;
    }
    if (!run.length) run.push(seg[0]);
    else if (!same(run[run.length - 1]!, seg[0])) {
      if (run.length > 1) runs.push(run);
      run = [seg[0]];
    }
    run.push(seg[1]);
    // Leaving the box ends the run.
    if (!inside(chain[i]!, box)) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** Where a point on the box's edge lies going round it anticlockwise from the south-west corner (0..4). */
function edgeT(p: Pt, b: Box): number {
  const fx = (p[0] - b.west) / (b.east - b.west);
  const fy = (p[1] - b.south) / (b.north - b.south);
  const d = [Math.abs(fy), Math.abs(1 - fx), Math.abs(1 - fy), Math.abs(fx)];
  const side = d.indexOf(Math.min(...d));
  return side === 0 ? fx : side === 1 ? 1 + fy : side === 2 ? 2 + (1 - fx) : 3 + (1 - fy);
}

const CORNERS = (b: Box): Pt[] => [
  [b.east, b.south],
  [b.east, b.north],
  [b.west, b.north],
  [b.west, b.south],
];

function ringArea(r: readonly (readonly [number, number])[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % r.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * Land polygons in the box from coastline ways (land on each way's left). Runs that cross the box are joined along its
 * edge anticlockwise into land; closed rings are islands (anticlockwise) or enclosed water (clockwise). With no run
 * crossing the box, `centreIsLand` says whether the box itself is land or sea.
 */
export function assembleLand(ways: readonly (readonly Pt[])[], box: Box, centreIsLand: boolean): CloseCoast {
  const runs = chainWays(ways).flatMap((c) => clipChain(simplifyLine(c, SIMPLIFY_DEG), box));
  const closed = runs.filter((r) => r.length > 3 && same(r[0]!, r[r.length - 1]!));
  const open = runs.filter((r) => !(r.length > 3 && same(r[0]!, r[r.length - 1]!))).map((r) => ({ pts: r, from: edgeT(r[0]!, box), to: edgeT(r[r.length - 1]!, box) }));
  const land: Polygon[] = [];
  const water: Polygon[] = [];
  const used = new Set<number>();
  for (let s = 0; s < open.length; s++) {
    if (used.has(s)) continue;
    const ring: Pt[] = [];
    let cur = s;
    for (let guard = 0; guard <= open.length; guard++) {
      used.add(cur);
      ring.push(...open[cur]!.pts);
      // Along the edge anticlockwise to the next run that starts there (the land keeps to the left).
      const exit = open[cur]!.to;
      let next = s;
      let best = Infinity;
      open.forEach((o, i) => {
        if (used.has(i) && i !== s) return;
        const gap = (((o.from - exit) % 4) + 4) % 4;
        if (gap < best) [best, next] = [gap, i];
      });
      for (let c = Math.floor(exit) + 1; c <= exit + best; c++) ring.push(CORNERS(box)[(c - 1 + 4) % 4]!);
      if (next === s) break;
      cur = next;
    }
    if (ring.length >= 3) land.push([ring]);
  }
  if (!open.length && centreIsLand) land.push([[[box.west, box.south], [box.east, box.south], [box.east, box.north], [box.west, box.north]]]);
  for (const r of closed) (ringArea(r) > 0 ? land : water).push([r]);
  return { land, water };
}

/**
 * The close map's coast from OpenStreetMap for a world's box, from the library or fetched once; undefined when the
 * map is wider than a close map or Overpass does not answer (the map then keeps Natural Earth's coast).
 */
export async function closeCoastFor(paths: Pick<V3Paths, "workRoot">, world: Pick<MapWorld, "bounds">, fallbackLand: readonly Polygon[], log: (s: string) => void = () => {}): Promise<CloseCoast | undefined> {
  // A little past the world on every side: where the land is closed along the box's edge, that edge (no coast) is
  // never in sight (a straight "shore" ran along the top of the first Constantinople map).
  const b = world.bounds;
  const mx = (b.east - b.west) * 0.05;
  const my = (b.north - b.south) * 0.05;
  const box: Box = { west: round(b.west - mx), east: round(b.east + mx), south: round(b.south - my), north: round(b.north + my) };
  const key = createHash("sha256").update(JSON.stringify({ v: COAST_VERSION, box })).digest("hex").slice(0, 20);
  const lib = path.join(paths.workRoot, "_kutuphane", "osm-kiyi", `${key}.json`);
  if (existsSync(lib)) return JSON.parse(await fs.readFile(lib, "utf8")) as CloseCoast;
  // Far from any sea (the Kosovo field, 1389): no coast to fetch — Natural Earth's land covers the box and ~20 km round it.
  if (inland(box, fallbackLand)) return undefined;
  const query = `[out:json][timeout:90];way["natural"="coastline"](${box.south},${box.west},${box.north},${box.east});out geom;`;
  try {
    const json = await overpass(query);
    const ways = (json.elements ?? []).filter((e) => e.type === "way" && e.geometry?.length).map((e) => e.geometry!.map((g): Pt => [g.lon, g.lat]));
    const centre: Pt = [(box.west + box.east) / 2, (box.south + box.north) / 2];
    const coast = assembleLand(ways, box, inOutline(centre[0], centre[1], fallbackLand));
    // Append-only library: a box's coast is never replaced.
    await fs.mkdir(path.dirname(lib), { recursive: true });
    if (!existsSync(lib)) await fs.writeFile(lib, JSON.stringify(coast));
    return coast;
  } catch (e) {
    log(`⚠ yakın harita kıyısı alınamadı (${(e as Error).message.slice(0, 120)}); Natural Earth kıyısı kullanılır`);
    return undefined;
  }
}

/** An element of an Overpass answer (`out tags geom`): a way's or relation member's points, a node's place, its tags. */
export interface OsmElement {
  readonly type: string;
  readonly lat?: number;
  readonly lon?: number;
  readonly tags?: Readonly<Record<string, string>>;
  readonly geometry?: readonly { readonly lat: number; readonly lon: number }[];
  readonly members?: readonly { readonly type: string; readonly role?: string; readonly geometry?: readonly { readonly lat: number; readonly lon: number }[] }[];
}

/** How far past a close map's box land must reach on every side (km) for it to have no coast worth fetching. */
const INLAND_MARGIN_KM = 20;

/** Whether Natural Earth's land covers the box and INLAND_MARGIN_KM round it (a 9×9 grid of points, all on land). */
export function inland(box: Box, land: readonly Polygon[]): boolean {
  if (!land.length) return false;
  const lat = (box.south + box.north) / 2;
  const mx = INLAND_MARGIN_KM / (111.32 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const my = INLAND_MARGIN_KM / 110.57;
  for (let i = 0; i <= 8; i++)
    for (let j = 0; j <= 8; j++) {
      const lon = box.west - mx + ((box.east - box.west + 2 * mx) * i) / 8;
      const la = box.south - my + ((box.north - box.south + 2 * my) * j) / 8;
      if (!inOutline(lon, la, land)) return false;
    }
  return true;
}

/**
 * When every server failed, how long the rest of the run goes without asking again (the Kosovo 1389 trial: each close
 * map's coast, rivers and site waited out three servers' timeouts in turn while Overpass was down).
 */
export const OVERPASS_REST_MS = 15 * 60_000;
let overpassDownUntil = 0;

/** The query's answer from the first server that gives one (a busy server answers HTML, not JSON). */
export async function overpass(query: string, timeoutMs = 120_000): Promise<{ elements?: OsmElement[] }> {
  if (Date.now() < overpassDownUntil) throw new Error(`OVERPASS hiçbir sunucu yanıt vermedi; ${Math.ceil((overpassDownUntil - Date.now()) / 60_000)} dk sorulmayacak`);
  const failures: string[] = [];
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      return (await res.json()) as { elements?: OsmElement[] };
    } catch (e) {
      failures.push(`${new URL(url).hostname}: ${(e as Error).message.slice(0, 60)}`);
    }
  }
  overpassDownUntil = Date.now() + OVERPASS_REST_MS;
  throw new Error(`OVERPASS ${failures.join("; ")}`);
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;
