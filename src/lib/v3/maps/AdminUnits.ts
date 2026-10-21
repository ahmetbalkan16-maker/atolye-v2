import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

/**
 * Realistic borders (owner, 21 Oct 2026: "the borders could be drawn more realistically, not straight"): the historical
 * atlas gives a state's outline with few points, so its borders cross the land in long straight lines. Here a state is
 * rebuilt from today's provinces (Natural Earth 1:10m admin-1, public domain) whose centre lies in its atlas outline;
 * province borders follow rivers and ridges, so the state's border does too. The provinces are prepared once by
 * scripts/v3/il-sinirlari-hazirla.ts; without that file the atlas outline is drawn as before.
 */
export const ADMIN_FILE = "admin1-q.json";
/** The grid the provinces' points sit on (~2 km): neighbours share their border point for point. */
export const ADMIN_QUANT_DEG = 0.02;
export const ADMIN_SOURCE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson";
/** Closed border loops smaller than this (square degrees, ~200 km²) are not drawn. */
const MIN_BORDER_LOOP_DEG2 = 0.02;

type Ring = readonly (readonly [number, number])[];

export interface AdminUnit {
  readonly name: string;
  /** Rings on the grid (integer multiples of ADMIN_QUANT_DEG), outer rings only. */
  readonly rings: readonly (readonly number[])[];
  readonly box: { readonly west: number; readonly east: number; readonly south: number; readonly north: number };
  /** The centre of its largest ring (lon, lat). */
  readonly centre: readonly [number, number];
}

let cached: AdminUnit[] | null | undefined;

export function adminUnitsAvailable(mapsDir: string): boolean {
  return existsSync(path.join(mapsDir, ADMIN_FILE));
}

/** The prepared provinces, or undefined when the file is not there. */
export async function loadAdminUnits(mapsDir: string): Promise<AdminUnit[] | undefined> {
  if (cached !== undefined) return cached ?? undefined;
  const file = path.join(mapsDir, ADMIN_FILE);
  if (!existsSync(file)) return undefined;
  const json = JSON.parse(await fs.readFile(file, "utf8")) as { izgara: number; birimler: { n: string; r: number[][] }[] };
  if (json.izgara !== ADMIN_QUANT_DEG) throw new Error(`V3_ADMIN_GRID: ${file} ızgarası ${json.izgara}, beklenen ${ADMIN_QUANT_DEG} (il-sinirlari-hazirla.ts yeniden)`);
  cached = json.birimler.map((u) => {
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    let best: number[] = u.r[0]!;
    let bestArea = -1;
    for (const r of u.r) {
      for (let i = 0; i < r.length; i += 2) {
        west = Math.min(west, r[i]!);
        east = Math.max(east, r[i]!);
        south = Math.min(south, r[i + 1]!);
        north = Math.max(north, r[i + 1]!);
      }
      const a = Math.abs(ringArea(r));
      if (a > bestArea) {
        bestArea = a;
        best = r;
      }
    }
    const q = ADMIN_QUANT_DEG;
    return { name: u.n, rings: u.r, box: { west: west * q, east: east * q, south: south * q, north: north * q }, centre: ringCentre(best).map((v) => v * q) as [number, number] };
  });
  return cached;
}

function ringArea(r: readonly number[]): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += r[2 * i]! * r[2 * j + 1]! - r[2 * j]! * r[2 * i + 1]!;
  }
  return a / 2;
}

function ringCentre(r: readonly number[]): [number, number] {
  let cx = 0, cy = 0, a2 = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const c = r[2 * i]! * r[2 * j + 1]! - r[2 * j]! * r[2 * i + 1]!;
    a2 += c;
    cx += (r[2 * i]! + r[2 * j]!) * c;
    cy += (r[2 * i + 1]! + r[2 * j + 1]!) * c;
  }
  if (Math.abs(a2) < 1e-9) return [r[0]!, r[1]!];
  return [cx / (3 * a2), cy / (3 * a2)];
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a lon/lat point lies in any outer ring of a state's outline. */
export function inOutline(lon: number, lat: number, polys: readonly (readonly Ring[])[]): boolean {
  return polys.some((p) => p[0] !== undefined && inRing(lon, lat, p[0]));
}

/**
 * Which provinces make each state: a province goes to the first group whose outline holds its centre (groups in
 * order — the script's own regions, then the named atlas states, then the rest); within the first group every state
 * holding it gets it (one region told twice as it changes hands). Provinces outside the world are skipped.
 */
export function assignUnits(units: readonly AdminUnit[], groups: readonly (readonly { readonly key: number; readonly polys: readonly (readonly Ring[])[] }[])[], world: { readonly west: number; readonly east: number; readonly south: number; readonly north: number }): Map<number, AdminUnit[]> {
  const out = new Map<number, AdminUnit[]>();
  for (const u of units) {
    // On the globe: a province at 170° W lies in a Pacific world that runs to 200°.
    if (u.box.north < world.south || u.box.south > world.north || ![-360, 0, 360].some((d) => u.box.east + d >= world.west && u.box.west + d <= world.east)) continue;
    const [lon, lat] = u.centre;
    for (const group of groups) {
      const holders = group.filter((s) => inOutline(lon, lat, s.polys));
      if (!holders.length) continue;
      for (const s of holders) out.set(s.key, [...(out.get(s.key) ?? []), u]);
      break;
    }
  }
  return out;
}

/**
 * A state's outline from its provinces: every province edge shared by two of its provinces cancels out, the rest is the
 * state's border, chained into lines. Rings that close are its pieces (for placing the name). Points are lon/lat.
 */
export function dissolve(units: readonly AdminUnit[]): { lines: [number, number][][]; rings: [number, number][][] } {
  const key = (x: number, y: number) => `${x},${y}`;
  const edges = new Map<string, { a: [number, number]; b: [number, number]; n: number }>();
  for (const u of units) {
    for (const r of u.rings) {
      const n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a: [number, number] = [r[2 * i]!, r[2 * i + 1]!];
        const b: [number, number] = [r[2 * j]!, r[2 * j + 1]!];
        const ka = key(a[0], a[1]);
        const kb = key(b[0], b[1]);
        if (ka === kb) continue;
        const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const e = edges.get(k);
        if (e) e.n++;
        else edges.set(k, { a, b, n: 1 });
      }
    }
  }
  // Border edges (used once) chained into lines through their shared points.
  const next = new Map<string, [number, number][]>();
  const add = (p: [number, number], q: [number, number]) => {
    const k = key(p[0], p[1]);
    next.set(k, [...(next.get(k) ?? []), q]);
  };
  for (const e of edges.values()) {
    if (e.n % 2 === 0) continue;
    add(e.a, e.b);
    add(e.b, e.a);
  }
  const used = new Set<string>();
  const edgeKey = (p: readonly number[], q: readonly number[]) => {
    const kp = key(p[0]!, p[1]!);
    const kq = key(q[0]!, q[1]!);
    return kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
  };
  const lines: [number, number][][] = [];
  const rings: [number, number][][] = [];
  const q = ADMIN_QUANT_DEG;
  for (const [start, outs] of next) {
    for (const first of outs) {
      const p0 = start.split(",").map(Number) as [number, number];
      if (used.has(edgeKey(p0, first))) continue;
      const line: [number, number][] = [p0];
      let prev = p0;
      let cur = first;
      used.add(edgeKey(prev, cur));
      for (;;) {
        line.push(cur);
        const nexts = (next.get(key(cur[0], cur[1])) ?? []).filter((n) => !used.has(edgeKey(cur, n)));
        if (!nexts.length) break;
        prev = cur;
        cur = nexts[0]!;
        used.add(edgeKey(prev, cur));
      }
      const closed = line.length > 3 && line[0]![0] === line[line.length - 1]![0] && line[0]![1] === line[line.length - 1]![1];
      const lonLat = line.map(([x, y]) => [x * q, y * q] as [number, number]);
      // A closed loop under ~200 km² is a sliver where neighbours' points did not match, or an enclave like San Marino
      // (the Rome map showed two little squares in Italy): not a border worth drawing.
      if (closed && Math.abs(ringArea(line.flat())) * q * q < MIN_BORDER_LOOP_DEG2) continue;
      lines.push(lonLat);
      if (closed) rings.push(lonLat.slice(0, -1));
    }
  }
  return { lines, rings };
}

/** The provinces' rings in lon/lat, as polygons (one outer ring each) for filling a state. */
export function unitPolygons(units: readonly AdminUnit[]): [number, number][][][] {
  const q = ADMIN_QUANT_DEG;
  return units.flatMap((u) => u.rings.map((r) => [Array.from({ length: r.length / 2 }, (_, i) => [r[2 * i]! * q, r[2 * i + 1]! * q] as [number, number])]));
}
