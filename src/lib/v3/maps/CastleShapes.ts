/**
 * Walls and castles as lines on the close battle map (owner, 23 Oct 2026: "we must make these maps for any event
 * anywhere on Earth — the close map, the castle"). Pure geometry in longitude/latitude:
 *  - a castle drawn in its period's manner round a centre, where no real trace is known (a wall long gone): a
 *    medieval ring of curtain walls, a square castle or Roman camp, or a bastioned star fort (the trace italienne,
 *    from about 1500);
 *  - OpenStreetMap's pieces made into wall lines: a wall mapped as thin building strips gets its centre line, pieces
 *    are joined across small gaps (gates, towers), and the trace is fitted to the writer's rough line — the part of
 *    the real walls running along it, in its order.
 */

export type Pt = [number, number];
export type CastleStyle = "halka" | "kare" | "yildiz";

/** The castle style a period built (bastioned forts spread from Italy after about 1500 and lasted to the 1860s). */
export function castleStyleFor(year: number | undefined): CastleStyle {
  return year !== undefined && year >= 1500 && year <= 1870 ? "yildiz" : "halka";
}

/** Kilometres per degree of longitude and of latitude at a latitude (enough for a few kilometres). */
function kmPerDeg(lat: number): { x: number; y: number } {
  return { x: 111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)), y: 110.57 };
}

function hash01(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * A castle's closed wall line round `centre`, `km` across: a medieval ring a little irregular like walls that follow
 * the ground, a square with its corners set off, or a star fort with five or six arrowhead bastions. Deterministic
 * (the same place gives the same castle).
 */
export function castleRing(centre: readonly [number, number], km: number, style: CastleStyle): Pt[] {
  const k = kmPerDeg(centre[1]);
  const seed = Math.round(Math.abs(centre[0] * 1000) + Math.abs(centre[1] * 7000));
  const R = km / 2;
  const toLonLat = (x: number, y: number): Pt => [r6(centre[0] + x / k.x), r6(centre[1] + y / k.y)];
  const tilt = hash01(seed) * Math.PI;
  const turn = (x: number, y: number): [number, number] => [x * Math.cos(tilt) - y * Math.sin(tilt), x * Math.sin(tilt) + y * Math.cos(tilt)];
  let local: [number, number][];
  if (style === "yildiz") {
    const n = R < 0.4 ? 5 : 6;
    const corners = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [Math.cos(a) * R, Math.sin(a) * R] as [number, number];
    });
    local = corners.flatMap((v, i) => {
      const prev = corners[(i + n - 1) % n]!;
      const next = corners[(i + 1) % n]!;
      const f = 0.2;
      const len = Math.hypot(v[0], v[1]) || 1;
      const out = [v[0] / len, v[1] / len];
      const p1: [number, number] = [v[0] + (prev[0] - v[0]) * f, v[1] + (prev[1] - v[1]) * f];
      const p2: [number, number] = [v[0] + (next[0] - v[0]) * f, v[1] + (next[1] - v[1]) * f];
      // Curtain, flank out to the shoulder, the bastion's two faces meeting at its point, the other flank.
      return [p1, [p1[0] + out[0]! * R * 0.12, p1[1] + out[1]! * R * 0.12], [v[0] * 1.32, v[1] * 1.32], [p2[0] + out[0]! * R * 0.12, p2[1] + out[1]! * R * 0.12], p2] as [number, number][];
    });
  } else if (style === "kare") {
    const s = R * 0.9;
    local = [
      [-s, -s * 0.92],
      [-s * 0.2, -s],
      [s, -s * 0.95],
      [s * 1.02, -s * 0.1],
      [s * 0.96, s],
      [s * 0.1, s * 1.02],
      [-s, s * 0.94],
      [-s * 1.03, s * 0.05],
    ];
  } else {
    const n = 28;
    const [p1, p2] = [hash01(seed + 1) * Math.PI * 2, hash01(seed + 2) * Math.PI * 2];
    const stretch = 1 + hash01(seed + 3) * 0.25;
    local = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const r = R * (1 + 0.07 * Math.sin(2 * a + p1) + 0.05 * Math.sin(3 * a + p2));
      return [Math.cos(a) * r * stretch, Math.sin(a) * r];
    });
  }
  const ring = local.map(([x, y]) => toLonLat(...turn(x, y)));
  return [...ring, ring[0]!];
}

/** A ring's area against a circle of its perimeter (1 for a circle, near 0 for a thin strip) — in local km. */
export function roundness(ring: readonly Pt[]): number {
  if (ring.length < 3) return 0;
  const k = kmPerDeg(ring[0]![1]);
  let a = 0;
  let per = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p[0] * k.x * (q[1] * k.y) - q[0] * k.x * (p[1] * k.y);
    per += Math.hypot((q[0] - p[0]) * k.x, (q[1] - p[1]) * k.y);
  }
  return per ? (4 * Math.PI * Math.abs(a / 2)) / per ** 2 : 0;
}

/** Distance in km between two points (local, for a few kilometres). */
export function kmBetween(a: readonly [number, number], b: readonly [number, number]): number {
  const k = kmPerDeg((a[1] + b[1]) / 2);
  return Math.hypot((b[0] - a[0]) * k.x, (b[1] - a[1]) * k.y);
}

/** A line's length in km. */
export function lineKm(line: readonly Pt[]): number {
  let km = 0;
  for (let i = 1; i < line.length; i++) km += kmBetween(line[i - 1]!, line[i]!);
  return km;
}

/** A line resampled to `n` points evenly by length. */
function resample(line: readonly Pt[], n: number): Pt[] {
  const total = lineKm(line);
  if (!total || line.length < 2) return Array.from({ length: n }, () => [...line[0]!] as Pt);
  const out: Pt[] = [];
  let i = 1;
  let run = 0;
  for (let j = 0; j < n; j++) {
    const want = (total * j) / (n - 1);
    while (i < line.length - 1 && run + kmBetween(line[i - 1]!, line[i]!) < want) {
      run += kmBetween(line[i - 1]!, line[i]!);
      i++;
    }
    const seg = kmBetween(line[i - 1]!, line[i]!) || 1;
    const u = Math.max(0, Math.min(1, (want - run) / seg));
    out.push([line[i - 1]![0] + (line[i]![0] - line[i - 1]![0]) * u, line[i - 1]![1] + (line[i]![1] - line[i - 1]![1]) * u]);
  }
  return out;
}

/**
 * The centre line of a wall mapped as a thin strip (OSM draws many walls as long narrow buildings): the strip's two
 * long sides between its farthest-apart corners, walked together, their middles.
 */
export function stripCentreline(ring: readonly Pt[]): Pt[] {
  const pts = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : [...ring];
  if (pts.length < 4) return pts;
  let [ia, ib, far] = [0, 0, -1];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = kmBetween(pts[i]!, pts[j]!);
      if (d > far) [ia, ib, far] = [i, j, d];
    }
  const walk = (from: number, to: number) => {
    const out: Pt[] = [];
    for (let i = from; ; i = (i + 1) % pts.length) {
      out.push(pts[i]!);
      if (i === to) break;
    }
    return out;
  };
  const one = walk(ia, ib);
  const two = walk(ib, ia).reverse();
  const n = Math.max(3, Math.min(60, Math.round(far / 0.05) + 1));
  const a = resample(one, n);
  const b = resample(two, n);
  const line = a.map((p, i) => [r6((p[0] + b[i]![0]) / 2), r6((p[1] + b[i]![1]) / 2)] as Pt);
  // Each end in the middle of the strip's short end (the farthest corners are on its sides).
  const endOf = (i: number): Pt => {
    const [prev, next] = [pts[(i + pts.length - 1) % pts.length]!, pts[(i + 1) % pts.length]!];
    const q = kmBetween(pts[i]!, prev) < kmBetween(pts[i]!, next) ? prev : next;
    return [r6((pts[i]![0] + q[0]) / 2), r6((pts[i]![1] + q[1]) / 2)];
  };
  line[0] = endOf(ia);
  line[line.length - 1] = endOf(ib);
  return line;
}

/** Wall pieces joined end to end across gaps shorter than `maxGapKm` (a gate, a tower, a missing stretch), longest first. */
export function joinPieces(pieces: readonly (readonly Pt[])[], maxGapKm: number): Pt[][] {
  const left = pieces.filter((p) => p.length >= 2).map((p) => [...p]);
  left.sort((a, b) => lineKm(b) - lineKm(a));
  const out: Pt[][] = [];
  while (left.length) {
    let line = left.shift()!;
    for (let grew = true; grew; ) {
      grew = false;
      let best: { i: number; d: number; head: boolean; flip: boolean } | undefined;
      left.forEach((p, i) => {
        const options = [
          { d: kmBetween(line[line.length - 1]!, p[0]!), head: false, flip: false },
          { d: kmBetween(line[line.length - 1]!, p[p.length - 1]!), head: false, flip: true },
          { d: kmBetween(line[0]!, p[p.length - 1]!), head: true, flip: false },
          { d: kmBetween(line[0]!, p[0]!), head: true, flip: true },
        ];
        for (const o of options) if (o.d <= maxGapKm && (!best || o.d < best.d)) best = { i, ...o };
      });
      if (best) {
        const piece = left.splice(best.i, 1)[0]!;
        const p = best.flip ? [...piece].reverse() : piece;
        line = best.head ? [...p, ...line] : [...line, ...p];
        grew = true;
      }
    }
    out.push(line);
  }
  return out;
}

/** The nearest point of a polyline to `p`: distance (km) and how far along the line it falls (0..1). */
function nearestOn(line: readonly Pt[], p: Pt): { km: number; t: number } {
  const total = lineKm(line) || 1;
  let best = { km: Infinity, t: 0 };
  let run = 0;
  const k = kmPerDeg(p[1]);
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const ax = (a[0] - p[0]) * k.x, ay = (a[1] - p[1]) * k.y;
    const bx = (b[0] - p[0]) * k.x, by = (b[1] - p[1]) * k.y;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    const u = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const d = Math.hypot(ax + dx * u, ay + dy * u);
    const seg = Math.sqrt(len2);
    if (d < best.km) best = { km: d, t: (run + seg * u) / total };
    run += seg;
  }
  return best;
}

/**
 * The real walls running along the writer's rough line: every point of the given wall lines within the corridor round
 * it (a few hundred metres, more for a long wall), in runs; the runs ordered along the writer's line and joined. None
 * when the real walls cover less than half of the writer's line (then the writer's own line stays).
 */
export function fitWall(script: readonly Pt[], lines: readonly (readonly Pt[])[]): Pt[] | undefined {
  if (script.length < 2) return undefined;
  const length = lineKm(script);
  const tol = Math.min(1.5, Math.max(0.35, length * 0.12));
  const runs: { pts: Pt[]; t0: number; t1: number }[] = [];
  for (const line of lines) {
    let run: { pts: Pt[]; ts: number[] } = { pts: [], ts: [] };
    const flush = () => {
      if (run.pts.length >= 2) {
        // Each run goes the writer's way.
        const forward = run.ts[run.ts.length - 1]! >= run.ts[0]!;
        runs.push({ pts: forward ? run.pts : [...run.pts].reverse(), t0: Math.min(...run.ts), t1: Math.max(...run.ts) });
      }
      run = { pts: [], ts: [] };
    };
    for (const p of resampleDense(line)) {
      const n = nearestOn(script, p);
      if (n.km <= tol) {
        run.pts.push(p);
        run.ts.push(n.t);
      } else flush();
    }
    flush();
  }
  if (!runs.length) return undefined;
  // Overlapping runs (both faces of a double wall): the longer one in each stretch.
  runs.sort((a, b) => b.t1 - b.t0 - (a.t1 - a.t0));
  const kept: typeof runs = [];
  for (const r of runs) if (!kept.some((k) => Math.min(k.t1, r.t1) - Math.max(k.t0, r.t0) > 0.5 * (r.t1 - r.t0))) kept.push(r);
  kept.sort((a, b) => a.t0 - b.t0);
  const covered = kept.reduce((a, r) => a + (r.t1 - r.t0), 0);
  if (covered < 0.5) return undefined;
  return kept.flatMap((r) => r.pts);
}

/** A line with points at least every 50 m (so a long straight OSM segment is checked along its length). */
function resampleDense(line: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const n = Math.max(1, Math.ceil(kmBetween(a, b) / 0.05));
    for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  if (line.length) out.push([...line[line.length - 1]!] as Pt);
  return out;
}
