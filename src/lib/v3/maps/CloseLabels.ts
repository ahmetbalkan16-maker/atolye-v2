import type { V3GeoMap, V3LabelSpot } from "../render/RenderPlanTypes";
import { LABEL_CHAR_W, labelLines } from "./LabelText";

/**
 * Names on the close battle map placed so they stay readable (owner, 23 Oct 2026: on the 1453 map "THEODOSIAN WALLS"
 * sat on "GATE OF ST. ROMANUS" and under the Ottoman tokens, "THE CHAIN" at the foot of "GALATA"): every name — a
 * battle's, a line's, a wall's, a settlement's, a building's, a road's — tries a few places beside its mark, nearest
 * first, and takes the one that covers the least: other names, cities, tokens, ships, battle swords, buildings, the
 * walls, the compass corner, the picture's edge. Each place is tested at every camera stop the name is on screen for,
 * at that stop's zoom (MapView draws names at one screen size, so they cover more of the map when the camera is out).
 * Pure and deterministic; the spot is an anchor on the map plus a screen offset, so the name keeps to its mark.
 */

type XY = { readonly x: number; readonly y: number };
type Rect = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
type Close = NonNullable<V3GeoMap["close"]>;

/** What one camera stop shows from `from` to `to` (frames): the world rectangle, and world px per 1080p screen px. */
type Stop = { readonly from: number; readonly to: number; readonly view: Rect; readonly k: number };

/**
 * Something a name should not cover, from `from` to `to`: a box round `x`,`y` made of a world part (`w`, drawn with the
 * map) and a screen part (`s`, 1080p px, drawn at one screen size). `weight`: how bad covering it is.
 */
type Obstacle = { readonly x: number; readonly y: number; readonly w?: Rect; readonly s?: Rect; readonly from: number; readonly to: number; readonly weight: number };

/** A place to try: the spot, and the name's box there (1080p px round the spot; a rotated road name's upright box). */
type Candidate = { readonly spot: V3LabelSpot; readonly box: { readonly w: number; readonly h: number } };

const ZERO: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
/** Room round a name (1080p px) that another mark should leave free. */
const PAD = 5;
/** The atlas corner MapView draws at the bottom left (compass and scale bar), in 1080p px from that corner. */
const CORNER = { x0: 50, x1: 360, up: 275, down: 30 };
/** Covering another name is far worse than moving a few places from the first choice. */
const NAME_WEIGHT = 40;
const CITY_WEIGHT = 30;
const EDGE_WEIGHT = 25;
const CORNER_WEIGHT = 15;
/** Each step down the list of places costs this much. */
const ORDER_COST = 1;
/** A camera stop's cost counts in full for 6 s on screen (frames at 30 fps), and at most twice that (the last stop runs to the cut). */
const STOP_FULL_FRAMES = 180;
const STOP_MAX_FRAMES = 360;
/** How bad a name hidden under a token is (a moving formation can still cross it). */
const TOKEN_WEIGHT = 8;

const r1 = (n: number) => Math.round(n * 10) / 10;
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** A name's box in 1080p px, as MapView writes it: the relief map's condensed capitals (one or two lines), else the cartoon map's black capitals. */
export function nameBox(text: string, size: number, relief: boolean): { w: number; h: number } {
  const upper = text.toLocaleUpperCase("en-US");
  const lines = relief ? labelLines(upper) : [upper];
  const longest = Math.max(...lines.map((l) => l.length));
  return { w: longest * (relief ? LABEL_CHAR_W : 0.78) * size + PAD * 2, h: lines.length * size * (relief ? 0.98 : 1.1) + PAD * 2 };
}

/** The camera stops of a map: each key until the next one; a map without keys is one stop over the whole frame. */
export function cameraStops(m: V3GeoMap, width: number, height: number): Stop[] {
  const world = m.world ?? { width, height };
  const keys = m.camera?.length ? [...m.camera].sort((a, b) => a.frame - b.frame) : [{ frame: 0, x: world.width / 2, y: world.height / 2, zoom: 1 }];
  return keys.map((c, i) => ({
    from: c.frame,
    to: keys[i + 1]?.frame ?? Infinity,
    k: height / 1080 / c.zoom,
    view: { x0: c.x - width / 2 / c.zoom, x1: c.x + width / 2 / c.zoom, y0: c.y - height / 2 / c.zoom, y1: c.y + height / 2 / c.zoom },
  }));
}

/** A point a fraction of the way along a polyline, with the line's direction there (a unit vector). */
function alongWithDir(points: readonly XY[], f: number): { p: XY; t: XY } {
  const seg = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  let rest = Math.max(0, Math.min(1, f)) * seg.reduce((a, b) => a + b, 0);
  for (let i = 0; i < seg.length; i++) {
    if (rest <= seg[i]! || i === seg.length - 1) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const len = seg[i]! || 1;
      const u = Math.min(1, rest / len);
      return { p: { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }, t: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
    }
    rest -= seg[i]!;
  }
  return { p: points[0]!, t: { x: 1, y: 0 } };
}

/** Points every `gap` along a polyline (a wall, a road, a chain), for obstacles. */
function samples(points: readonly XY[], gap: number): XY[] {
  const out: XY[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / gap));
    for (let j = 0; j < n; j++) out.push({ x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n });
  }
  if (points.length) out.push(points[points.length - 1]!);
  return out;
}

const rectAt = (o: Pick<Obstacle, "x" | "y" | "w" | "s">, k: number): Rect => {
  const w = o.w ?? ZERO;
  const s = o.s ?? ZERO;
  return { x0: o.x + w.x0 + s.x0 * k, y0: o.y + w.y0 + s.y0 * k, x1: o.x + w.x1 + s.x1 * k, y1: o.y + w.y1 + s.y1 * k };
};
const nameRect = (c: Candidate, k: number): Rect => ({ x0: c.spot.x + (c.spot.dx - c.box.w / 2) * k, y0: c.spot.y + (c.spot.dy - c.box.h / 2) * k, x1: c.spot.x + (c.spot.dx + c.box.w / 2) * k, y1: c.spot.y + (c.spot.dy + c.box.h / 2) * k });
const inside = (p: XY, r: Rect) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

/** The upright box of a name turned by `angle` degrees (a road's name). */
function turnedBox(box: { w: number; h: number }, angle: number): { w: number; h: number } {
  const a = (angle * Math.PI) / 180;
  return { w: Math.abs(box.w * Math.cos(a)) + Math.abs(box.h * Math.sin(a)), h: Math.abs(box.w * Math.sin(a)) + Math.abs(box.h * Math.cos(a)) };
}

/** A direction as a readable text angle (degrees, -90..90: never upside down). */
function readableAngle(t: XY): number {
  let a = (Math.atan2(t.y, t.x) * 180) / Math.PI;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return Math.round(a * 10) / 10;
}

/**
 * Picks the candidate covering the least over the stops it is seen in (from `start` on). Off-screen marks do not count
 * at a stop where the name's own anchor is out of the picture (the name leaves with its mark).
 */
function choose(cands: readonly Candidate[], start: number, stops: readonly Stop[], obstacles: readonly Obstacle[]): Candidate {
  let best = cands[0]!;
  let bestCost = Infinity;
  cands.forEach((c, i) => {
    let cost = i * ORDER_COST;
    for (const st of stops) {
      if (st.to <= start) continue;
      if (!inside(c.spot, st.view)) continue;
      const from = Math.max(start, st.from);
      // A stop counts by how long it is on screen: a covered name for a moment matters less than for a whole line.
      const time = Math.min(STOP_MAX_FRAMES, st.to - from) / STOP_FULL_FRAMES;
      const r = nameRect(c, st.k);
      const area = (r.x1 - r.x0) * (r.y1 - r.y0) || 1;
      const margin = 20 * st.k;
      const shown = { x0: st.view.x0 + margin, y0: st.view.y0 + margin, x1: st.view.x1 - margin, y1: st.view.y1 - margin };
      // Cut by the picture's edge only as far as the place pushes it out: a mark at the edge may have its name cut.
      const centred = nameRect({ ...c, spot: { ...c.spot, dx: 0, dy: 0 } }, st.k);
      const cut = 1 - overlap(r, shown) / area - (1 - overlap(centred, shown) / area);
      let here = Math.max(0, cut) * EDGE_WEIGHT;
      const corner = { x0: st.view.x0 + CORNER.x0 * st.k, x1: st.view.x0 + CORNER.x1 * st.k, y0: st.view.y1 - CORNER.up * st.k, y1: st.view.y1 - CORNER.down * st.k };
      if (overlap(r, corner) > 0) here += CORNER_WEIGHT;
      for (const o of obstacles) {
        if (o.to <= from || o.from >= st.to) continue;
        const a = overlap(r, rectAt(o, st.k));
        if (a > 0) here += o.weight * (0.35 + 0.65 * Math.min(1, a / area));
      }
      cost += here * time;
      if (cost >= bestCost) return;
    }
    if (cost < bestCost) [best, bestCost] = [c, cost];
  });
  return best;
}

/** The marks of a close map that names should leave free (other names join as they are placed). */
function marksOf(m: V3GeoMap, close: Close, relief: boolean): Obstacle[] {
  const u = close.unit;
  const out: Obstacle[] = [];
  const always = { from: 0, to: Infinity };
  // A city's dot and its name to the right of it (MapView), on the relief map and the cartoon one.
  for (const c of m.cities) {
    const [dot, gap, char, half] = relief ? [8, 12, 0.52 * 25, 15] : [13, 18, 0.62 * 30, 19];
    out.push({ x: c.x, y: c.y, s: { x0: -dot, y0: -dot, x1: gap + c.label.length * char + PAD, y1: half }, ...always, weight: CITY_WEIGHT });
  }
  for (const t of m.territories) {
    if (t.labelX === undefined || t.labelY === undefined || !t.label) continue;
    const b = nameBox(t.label, t.labelSize ?? 46, relief);
    out.push({ x: t.labelX, y: t.labelY, s: { x0: -b.w / 2, y0: -b.h / 2, x1: b.w / 2, y1: b.h / 2 }, from: t.start, to: t.end ?? Infinity, weight: CITY_WEIGHT });
  }
  // Tokens where each formation stands (MapView spreads them a little more on screen).
  for (const side of m.units ?? [])
    side.steps.forEach((st, i) => {
      for (const p of st.points) out.push({ x: p.x, y: p.y, s: { x0: -28, y0: -28, x1: 28, y1: 28 }, from: st.start, to: side.steps[i + 1]?.start ?? Infinity, weight: TOKEN_WEIGHT });
    });
  // Ships, cannons, riders: where they stand and along their way — a group as wide as its wedge (MapVehicles: a row back
  // every 45 px, 33 px aside; Belgrade's six galleys at the fortress lay over its name), heavier the more there are.
  for (const v of m.vehicles ?? []) {
    const rows = Math.ceil((v.count - 1) / 2);
    const s = { x0: -55 - rows * 45, y0: -40 - rows * 35, x1: 55 + rows * 45, y1: 40 + rows * 35 };
    for (const p of samples(v.path, u * 4)) out.push({ x: p.x, y: p.y, s, from: v.start, to: v.end ?? Infinity, weight: 3 + v.count });
  }
  // A badge's portrait and name scroll count as much as a city's name: the speakers talk from them (Belgrade: the
  // defender's scroll lay over "Belgrade Fortress").
  for (const b of m.badges ?? []) for (const p of [b.path[0], b.path[b.path.length - 1]]) if (p) out.push({ x: p.x, y: p.y, s: { x0: -75, y0: -140, x1: 75, y1: 6 }, from: b.start, to: b.end ?? Infinity, weight: CITY_WEIGHT });
  for (const b of m.battles ?? []) out.push({ x: b.x, y: b.y, s: { x0: -52, y0: -50, x1: 52, y1: 50 }, from: b.start, to: Infinity, weight: 12 });
  // The walls' stone, towers and gates; the story's buildings; chains and lines; roads (cheap: a name may cross one).
  for (const w of close.walls) {
    for (const p of samples(w.points, u * 1.5)) out.push({ x: p.x, y: p.y, w: { x0: -u * 0.75, y0: -u * 0.75, x1: u * 0.75, y1: u * 0.75 }, ...always, weight: 1.2 });
    for (const g of w.gates) out.push({ x: g.x, y: g.y, w: { x0: -u, y0: -u, x1: u, y1: u }, ...always, weight: 2 });
  }
  for (const b of close.buildings) out.push({ x: b.x, y: b.y, w: { x0: -u * 2.1, y0: -u * 3.7, x1: u * 2.1, y1: u * 0.5 }, from: b.start, to: Infinity, weight: 8 });
  for (const ln of m.lines ?? []) for (const p of samples(ln.points, u * 1.5)) out.push({ x: p.x, y: p.y, w: { x0: -u * 0.4, y0: -u * 0.4, x1: u * 0.4, y1: u * 0.4 }, s: { x0: -6, y0: -6, x1: 6, y1: 6 }, from: ln.start, to: Infinity, weight: 1.5 });
  for (const r of close.roads) for (const p of samples(r, u * 2)) out.push({ x: p.x, y: p.y, w: { x0: -u * 0.35, y0: -u * 0.35, x1: u * 0.35, y1: u * 0.35 }, ...always, weight: 0.4 });
  return out;
}

/**
 * Places along a line beside it, both sides (`first` side first), then past its two ends. `lift`: how far off the line
 * (world px, along the side's normal `n`) the anchor sits — a wall's broad stone face.
 */
function besideLine(points: readonly XY[], box: { w: number; h: number }, fractions: readonly number[], gap: number, first: 1 | -1, lift: (n: XY) => XY = () => ({ x: 0, y: 0 })): Candidate[] {
  const out: Candidate[] = [];
  for (const f of fractions)
    for (const side of [first, -first]) {
      const { p, t } = alongWithDir(points, f);
      const n = { x: -t.y * side, y: t.x * side };
      const ext = (Math.abs(n.x) * box.w) / 2 + (Math.abs(n.y) * box.h) / 2;
      const at = lift(n);
      out.push({ spot: { x: r1(p.x + at.x), y: r1(p.y + at.y), dx: Math.round(n.x * (ext + gap)), dy: Math.round(n.y * (ext + gap)) }, box });
    }
  for (const [f, dir] of [[1, 1], [0, -1]] as const) {
    const { p, t } = alongWithDir(points, f);
    const ext = (Math.abs(t.x) * box.w) / 2 + (Math.abs(t.y) * box.h) / 2;
    out.push({ spot: { x: r1(p.x), y: r1(p.y), dx: Math.round(t.x * dir * (ext + gap)), dy: Math.round(t.y * dir * (ext + gap)) }, box });
  }
  return out;
}

/** Writes a `labelSpot` on every named thing of a close map (and a road name's angle); other maps are left as they are. */
export function placeCloseLabels(m: V3GeoMap, width: number, height: number): V3GeoMap {
  const close = m.close;
  if (!close) return m;
  const relief = Boolean(m.relief);
  const u = close.unit;
  const stops = cameraStops(m, width, height);
  const obstacles = marksOf(m, close, relief);
  const place = (cands: readonly Candidate[], start: number): V3LabelSpot => {
    const c = choose(cands, start, stops, obstacles);
    // A placed name is a mark the later names leave free.
    obstacles.push({ x: c.spot.x, y: c.spot.y, s: { x0: c.spot.dx - c.box.w / 2, y0: c.spot.dy - c.box.h / 2, x1: c.spot.dx + c.box.w / 2, y1: c.spot.dy + c.box.h / 2 }, from: start, to: Infinity, weight: NAME_WEIGHT });
    return c.spot;
  };
  // The moment's names first: battles, then the story's lines (the chain), walls, settlements, buildings, roads.
  const battles = (m.battles ?? []).map((b) => {
    const box = nameBox(b.label, 30, relief);
    const [hw, hh] = [box.w / 2, box.h / 2];
    const offsets: [number, number][] = [[0, -70], [0, 50 + hh + 4], [-(52 + hw), 0], [52 + hw, 0], [-(hw + 30), -(hh + 44)], [hw + 30, -(hh + 44)], [-(hw + 30), hh + 44], [hw + 30, hh + 44], [0, -(110 + hh)], [0, 90 + hh]];
    return { ...b, labelSpot: place(offsets.map(([dx, dy]) => ({ spot: { x: b.x, y: b.y, dx: Math.round(dx), dy: Math.round(dy) }, box })), b.start) };
  });
  const lines = m.lines?.map((ln) => {
    if (ln.points.length < 2 || !ln.label) return ln;
    const box = nameBox(ln.label, ln.chain ? 30 : 34, relief);
    return { ...ln, labelSpot: place(besideLine(ln.points, box, [0.5, 0.3, 0.7, 0.12, 0.88], ln.chain ? 14 : 22, 1), ln.start) };
  });
  const walls = close.walls.map((w) => {
    if (!w.label || w.points.length < 2) return w;
    const box = nameBox(w.label, 26, relief);
    // Outside the town it guards first (written over the town it hid among the houses).
    const mid = alongWithDir(w.points, 0.5);
    const town = [...close.settlements].sort((p, q) => Math.hypot(p.x - mid.p.x, p.y - mid.p.y) - Math.hypot(q.x - mid.p.x, q.y - mid.p.y))[0];
    const first = town && (town.x - mid.p.x) * -mid.t.y + (town.y - mid.p.y) * mid.t.x > 0 ? -1 : 1;
    const along = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9];
    // Further out when everything close by is taken (Belgrade: a fleet moored at the small fortress lay over every
    // spot beside it).
    const cands = [10, 80, 150].flatMap((gap) => besideLine(w.points, box, along, gap, first, (n) => ({ x: n.x * u * 0.9, y: n.y * u * 0.9 })));
    return { ...w, labelSpot: place(cands, 0) };
  });
  const settlements = close.settlements.map((s) => {
    if (!s.label) return s;
    const box = nameBox(s.label, 30, relief);
    const offsets: [number, number][] = [[0, 0], [0, -55], [0, 55], [-(box.w / 2 + 30), 0], [box.w / 2 + 30, 0], [0, -110], [0, 110]];
    const centred = offsets.map(([dx, dy]) => ({ spot: { x: s.x, y: s.y, dx: Math.round(dx), dy: Math.round(dy) }, box }));
    // Just outside the town's own edge, which grows with the map like its houses and towers (Galata's name sat on
    // its tower once the camera came close).
    if (!s.items.length) return { ...s, labelSpot: place(centred, s.start) };
    const [x0, x1] = [Math.min(...s.items.map((it) => it.x)) - u, Math.max(...s.items.map((it) => it.x)) + u];
    const [y0, y1] = [Math.min(...s.items.map((it) => it.y)) - u, Math.max(...s.items.map((it) => it.y)) + u];
    const edges: Candidate[] = [
      { spot: { x: s.x, y: r1(y0), dx: 0, dy: -Math.round(box.h / 2 + 4) }, box },
      { spot: { x: s.x, y: r1(y1), dx: 0, dy: Math.round(box.h / 2 + 4) }, box },
      { spot: { x: r1(x1), y: s.y, dx: Math.round(box.w / 2 + 4), dy: 0 }, box },
      { spot: { x: r1(x0), y: s.y, dx: -Math.round(box.w / 2 + 4), dy: 0 }, box },
    ];
    return { ...s, labelSpot: place([centred[0]!, ...edges, ...centred.slice(1)], s.start) };
  });
  const buildings = close.buildings.map((b) => {
    if (!b.label) return b;
    const box = nameBox(b.label, 24, relief);
    // Under the building first (as it was drawn), then over it, beside it, a little further down.
    const cands: Candidate[] = [
      { spot: { x: b.x, y: r1(b.y + u * 0.6), dx: 0, dy: Math.round(box.h / 2 + 2) }, box },
      { spot: { x: b.x, y: r1(b.y - u * 3.8), dx: 0, dy: -Math.round(box.h / 2 + 2) }, box },
      { spot: { x: r1(b.x + u * 2.2), y: r1(b.y - u * 1.5), dx: Math.round(box.w / 2 + 4), dy: 0 }, box },
      { spot: { x: r1(b.x - u * 2.2), y: r1(b.y - u * 1.5), dx: -Math.round(box.w / 2 + 4), dy: 0 }, box },
      { spot: { x: b.x, y: r1(b.y + u * 0.6), dx: 0, dy: Math.round(box.h / 2 + 34) }, box },
    ];
    return { ...b, labelSpot: place(cands, b.start) };
  });
  const roadNames = close.roadNames?.map((rn) => {
    const road = close.roads[rn.road];
    if (!road || road.length < 2) return rn;
    const upright = nameBox(rn.label, 22, relief);
    const cands: (Candidate & { angle: number })[] = [];
    for (const f of [0.5, 0.35, 0.65, 0.22, 0.78, 0.12, 0.88]) {
      const { p, t } = alongWithDir(road, f);
      const angle = readableAngle(t);
      const a = (angle * Math.PI) / 180;
      // Above the road as the name reads, then below it.
      for (const side of [1, -1]) {
        const up = { x: Math.sin(a) * side, y: -Math.cos(a) * side };
        const off = upright.h / 2 + 3;
        cands.push({ angle, spot: { x: r1(p.x + up.x * u * 0.4), y: r1(p.y + up.y * u * 0.4), dx: Math.round(up.x * off), dy: Math.round(up.y * off) }, box: turnedBox(upright, angle) });
      }
    }
    const spot = place(cands, 0);
    const chosen = cands.find((c) => c.spot === spot)!;
    return { ...rn, angle: chosen.angle, labelSpot: spot };
  });
  return {
    ...m,
    ...(m.battles ? { battles } : {}),
    ...(lines ? { lines } : {}),
    close: { ...close, walls, settlements, buildings, ...(roadNames ? { roadNames } : {}) },
  };
}
