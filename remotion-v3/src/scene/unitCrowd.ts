/**
 * The soldiers inside a unit block (owner, 12 Nov 2026: "yakın çekim haritalandırmada askerlerin hareketleri taktikler
 * harita ortamı daha gerçekçi, ordu sayısı daha fazla gözüksün"). A block used to be an empty tile with one sign: 86,000
 * Romans at Cannae read as nine coloured cards. Now each block is a regiment of small figures seen from above, in ranks
 * and files, as many as the unit's strength allows; its sign rides on a standard at its rear. Pure: no Remotion, no
 * React — the renderer (MapUnits) and the smoke tests share it.
 */

export type UnitKind = "piyade" | "kilicli" | "mizrakci" | "okcu" | "tufekci" | "suvari" | "topcu";

type XY = { readonly x: number; readonly y: number };

function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The men a strength label names ("11 Legions – 47,000 men" → 47,000; "Eight legions" → none): its largest number of at
 * least 100, thousands separated by a comma, a dot or a space.
 */
export function menOf(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const nums = [...label.matchAll(/\d{1,3}(?:[,.  ]\d{3})+|\d+/g)].map((m) => Number(m[0].replace(/[,.  ]/g, "")));
  const best = Math.max(0, ...nums.filter((n) => Number.isFinite(n)));
  return best >= 100 ? best : undefined;
}

/** A block with fewer men than this behind it is drawn thinner (a raiding party, a garrison), never as a dense regiment. */
export const SPARSE_MEN_PER_BLOCK = 300;

/**
 * Files across and ranks deep of a block's figures: foot in five ranks, archers in four, musketeers in three (a firing
 * line), horse in three, a battery of three guns. A block standing for few men is thinner.
 */
export function crowdGrid(kind: UnitKind, menPerBlock?: number): { cols: number; rows: number } {
  const sparse = menPerBlock !== undefined && menPerBlock < SPARSE_MEN_PER_BLOCK;
  switch (kind) {
    case "suvari":
      return sparse ? { cols: 4, rows: 2 } : { cols: 5, rows: 3 };
    case "topcu":
      return { cols: 3, rows: 1 };
    case "okcu":
      return sparse ? { cols: 5, rows: 3 } : { cols: 7, rows: 4 };
    case "tufekci":
      return sparse ? { cols: 6, rows: 2 } : { cols: 8, rows: 3 };
    default:
      return sparse ? { cols: 6, rows: 3 } : { cols: 8, rows: 5 };
  }
}

/** A figure in its block, block-local (the front is −y); `fall` (0..1) is its turn to fall or to drop out of the ranks. */
export interface Figure {
  readonly x: number;
  readonly y: number;
  readonly seed: number;
  readonly fall: number;
}

const figureCache = new Map<string, Figure[]>();

/**
 * The figures of a block `w` wide and `h` deep: one a cell, every other rank of foot half a file over (a crowd, not a
 * grid), each a little off its cell's middle. The same block always gets the same figures (Remotion renders frames in
 * any order).
 */
export function crowdFigures(kind: UnitKind, grid: { cols: number; rows: number }, w: number, h: number, seed: number): Figure[] {
  const key = `${kind}|${grid.cols}|${grid.rows}|${w.toFixed(2)}|${h.toFixed(2)}|${seed}`;
  const hit = figureCache.get(key);
  if (hit) return hit;
  const cw = w / grid.cols;
  const ch = h / grid.rows;
  const stagger = kind !== "suvari" && kind !== "topcu";
  const out: Figure[] = [];
  for (let r = 0; r < grid.rows; r++) {
    // A staggered rank has one file fewer, so it stays inside the block.
    const shift = stagger && r % 2 === 1 ? 0.5 : 0;
    const cols = shift ? grid.cols - 1 : grid.cols;
    for (let c = 0; c < cols; c++) {
      const s = seed * 131 + r * 17 + c * 7;
      out.push({ x: -w / 2 + (c + 0.5 + shift) * cw + (rand(s) - 0.5) * cw * 0.22, y: -h / 2 + (r + 0.5) * ch + (rand(s + 1) - 0.5) * ch * 0.18, seed: s, fall: rand(s + 2) });
    }
  }
  if (figureCache.size > 2000) figureCache.clear();
  figureCache.set(key, out);
  return out;
}

/** The most of a standing block that drops out of its ranks as its unit loses blocks (the wounded, the stragglers). */
export const THIN_MAX = 0.35;

/** The share of a standing block's figures gone when its unit has lost `lostShare` of its blocks. */
export function thinShare(lostShare: number): number {
  return Math.min(THIN_MAX, Math.max(0, lostShare) * 0.5);
}

const smooth01 = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  return c * c * (3 - 2 * c);
};
const unit = (v: XY): XY | undefined => {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : undefined;
};

/** An enemy a block may face: where it is and how much it counts (fading in, falling, gone). */
export interface Foe {
  readonly x: number;
  readonly y: number;
  readonly w: number;
}

/**
 * The way a block faces (a unit vector): towards the enemies nearest to it (together, so two at the same distance never
 * make it swing), steadied by the way its whole side faces (`base`); while it marches far, the way it goes — never
 * turning its back on the enemy for it (a line falling back keeps its face to the enemy; a rout turns it round
 * elsewhere). Every weight changes smoothly, so a block turns, never flips. Before, every block of a side faced its
 * enemy's middle: Cannae's wings stood askew to the Africans closing on them.
 */
export function facingDir(t: XY & { readonly way?: { readonly from: XY; readonly goal: XY; readonly t: number } }, foes: readonly Foe[], base: XY | undefined, r: number): XY {
  const live = foes.filter((f) => f.w > 0);
  let dir: XY | undefined;
  let aim: XY | undefined;
  if (live.length) {
    const dist = live.map((f) => Math.hypot(f.x - t.x, f.y - t.y));
    const dmin = Math.min(...dist);
    let sx = 0;
    let sy = 0;
    // Not the bearing of each enemy (passing close by one, it swings round in a few frames) but of the point among the
    // near enemies, an enemy close at hand counting no more than one a little further off.
    let px = 0;
    let py = 0;
    let pw = 0;
    live.forEach((f, j) => {
      const wt = f.w * Math.exp(-(dist[j]! - dmin) / (r * 10));
      px += f.x * wt;
      py += f.y * wt;
      pw += wt;
    });
    if (pw > 1e-9) {
      aim = { x: px / pw, y: py / pw };
      const to = { x: aim.x - t.x, y: aim.y - t.y };
      // Nearer than a block's reach, the bearing is the side's: a foe right on it says little about the way to face.
      const l = Math.hypot(to.x, to.y);
      const sure = smooth01((l - r * 1.5) / (r * 3));
      dir = l > 1e-9 ? { x: (to.x / l) * sure, y: (to.y / l) * sure } : undefined;
    }
  }
  const b = base ? unit(base) : undefined;
  const mixed = dir && b ? unit({ x: dir.x * 0.55 + b.x * 0.45, y: dir.y * 0.55 + b.y * 0.45 }) : dir ? unit(dir) : undefined;
  let out = mixed ?? b ?? { x: 0, y: -1 };
  const way = t.way;
  if (way) {
    const m = unit({ x: way.goal.x - way.from.x, y: way.goal.y - way.from.y });
    const far = Math.hypot(way.goal.x - way.from.x, way.goal.y - way.from.y) > r * 1.5;
    if (m && far) {
      // A march that ends nearer the enemy than it began goes at it (a charge, a sweep round its flank): the block faces
      // its way. One that ends further off is a falling back: it keeps its face to the enemy. Judged on the way's two
      // ends, not on the bearing now, which swings as the block rides past an enemy (a sweep turned 66° in one frame).
      const gain = aim ? Math.hypot(way.from.x - aim.x, way.from.y - aim.y) - Math.hypot(way.goal.x - aim.x, way.goal.y - aim.y) : r * 4;
      const s = smooth01(Math.min(way.t, 1 - way.t) * 2.5) * smooth01(gain / (r * 4) + 0.5);
      out = unit({ x: out.x * (1 - s) + m.x * s, y: out.y * (1 - s) + m.y * s }) ?? out;
    }
  }
  return out;
}

/** How much a token is on the march now (0..1): far on its way and between setting off and arriving. */
export function marching(t: { readonly way?: { readonly from: XY; readonly goal: XY; readonly t: number } }, r: number): number {
  const w = t.way;
  if (!w || Math.hypot(w.goal.x - w.from.x, w.goal.y - w.from.y) <= r * 1.5) return 0;
  return smooth01(Math.min(w.t, 1 - w.t) * 5);
}

/*
 * The army of dots (owner, 13 Nov 2026, of the Siege of Baghdad Short: "kaleden askerler taşıyor; öyle yapacağına
 * askerleri küçük yuvarlak halinde yapılsa hem daha fazla asker görüntüsü olur hem daha güzel görünür … her yuvarlak birlik
 * 1000 askere denk gelsin", after DFT Tarih's close battle maps: many small round tokens in the side's colour, packed in
 * tight formations, closing in and falling one by one). On a dotted map (`V3GeoMap.unitStyle` "nokta") each block of a
 * unit is drawn as small filled circles instead of a regiment of figures; the blocks keep their places and motion
 * (MapUnits.placeTokens), so only the look changes.
 */

/**
 * Men one circle stands for. A period's company size could replace it per era (a Roman century's 80, a Janissary orta's
 * ~100, a Napoleonic battalion's ~700); one round number keeps the legend ("● = 1,000 men") readable at a glance.
 */
export const MEN_PER_DOT = 1000;
/**
 * The scales a map steps up through when one of its units would need more circles than read — one scale for the whole
 * map, never one per unit, so the legend's single line is true of every unit on it.
 */
export const DOT_SCALES = [MEN_PER_DOT, 2000, 2500, 5000, 10_000, 20_000, 25_000, 50_000, 100_000] as const;
/**
 * A unit's circles: at least DOTS_MIN (a raiding party must still read as a body of men, not a stray dot — the scale
 * then flatters it, the only place it does), at most DOTS_MAX, and at most DOTS_PER_BLOCK_MAX in one block (more and the
 * circles shrink below what reads on a phone).
 */
export const DOTS_MIN = 4;
export const DOTS_MAX = 80;
export const DOTS_PER_BLOCK_MAX = 24;
/**
 * The men behind a block when no number is written anywhere on the map (a legion with its allies, a large regiment):
 * eight circles, a tight two-rank block — at 5,000 Cannae's unnumbered legions stood as sparse fives.
 */
export const DEFAULT_MEN_PER_BLOCK = 8000;

/** Folded for comparing names written by hand ("Osmanlılar" / "OSMANLILAR"; Turkish dotless and dotted i). */
const foldName = (s: string) => s.replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** A unit as armyDots reads it (MapUnits passes V3GeoMap units). */
export interface DotUnit {
  readonly side: string;
  readonly kind?: string;
  readonly label?: string;
  readonly steps: readonly { readonly points: readonly XY[]; readonly label?: string }[];
}

/** Each unit's men and circles on a dotted map, at the map's one scale. */
export interface ArmyDots {
  /** Men one circle stands for on this map (MEN_PER_DOT unless an army needed a larger scale). */
  readonly menPerDot: number;
  /** Each unit's men, written or estimated (0 for a unit drawn without circles: guns, emblem tokens). */
  readonly men: readonly number[];
  /** Each unit's circles (0 for a unit drawn without circles). */
  readonly dots: readonly number[];
  /** Whether a unit's men came from a written number (its label, a step's label, or its side's strength bar). */
  readonly written: readonly boolean[];
}

/** Whether a unit is drawn as circles: a kind of foot or horse (guns keep their gun icons, kindless tokens their emblem). */
export const dottedKind = (kind: string | undefined) => kind !== undefined && kind !== "topcu";

/**
 * How many circles each unit gets: its men — its own label's number ("35,000 infantry"), else what its side's strength
 * bar leaves after the side's labelled units, shared by blocks; else its blocks × the men behind a labelled block of its
 * side (or of the map, or DEFAULT_MEN_PER_BLOCK) — over the map's scale, rounded up, kept to DOTS_MIN..DOTS_MAX.
 */
export function armyDots(units: readonly DotUnit[], strength?: readonly { readonly sides: readonly { readonly label: string; readonly value: number }[] }[]): ArmyDots {
  const drawn = units.map((u) => dottedKind(u.kind));
  const blocks = units.map((u) => Math.max(1, ...u.steps.map((s) => s.points.length)));
  const own = units.map((u, i) => (drawn[i] ? menOf(u.label) ?? (Math.max(0, ...u.steps.map((s) => menOf(s.label) ?? 0)) || undefined) : undefined));
  const men = own.map((m) => m ?? 0);
  const written = own.map((m) => m !== undefined);
  // The strength bar's opening numbers (later entries come after the losses).
  for (const s of strength?.[0]?.sides ?? []) {
    const ids = units.flatMap((u, i) => (drawn[i] && foldName(u.side) === foldName(s.label) ? [i] : []));
    const open = ids.filter((i) => own[i] === undefined);
    const rest = s.value - ids.reduce((a, i) => a + (own[i] ?? 0), 0);
    const b = open.reduce((a, i) => a + blocks[i]!, 0);
    if (rest > 0 && b) for (const i of open) [men[i], written[i]] = [(rest * blocks[i]!) / b, true];
  }
  const known = written.slice();
  const perBlock = (ids: readonly number[]) => {
    const w = ids.filter((i) => known[i]);
    const b = w.reduce((a, i) => a + blocks[i]!, 0);
    return b ? w.reduce((a, i) => a + men[i]!, 0) / b : undefined;
  };
  const all = units.map((_, i) => i).filter((i) => drawn[i]);
  for (const i of all) if (!known[i]) men[i] = blocks[i]! * (perBlock(all.filter((j) => units[j]!.side === units[i]!.side)) ?? perBlock(all) ?? DEFAULT_MEN_PER_BLOCK);
  const fits = (scale: number) => all.every((i) => Math.ceil(men[i]! / scale) <= DOTS_MAX && Math.ceil(men[i]! / scale) <= DOTS_PER_BLOCK_MAX * blocks[i]!);
  const menPerDot = DOT_SCALES.find(fits) ?? DOT_SCALES[DOT_SCALES.length - 1]!;
  const dots = units.map((_, i) => (drawn[i] ? Math.min(DOTS_MAX, DOTS_PER_BLOCK_MAX * blocks[i]!, Math.max(DOTS_MIN, blocks[i]!, Math.ceil(men[i]! / menPerDot))) : 0));
  return { menPerDot, men: men.map((m, i) => (drawn[i] ? Math.round(m) : 0)), dots, written: written.map((w, i) => drawn[i]! && w) };
}

/** How many of a unit's `total` circles block `b` of `blocks` holds (the first blocks one more; they fall last). */
export function blockDotCount(total: number, blocks: number, b: number): number {
  return Math.floor(total / blocks) + (b < total % blocks ? 1 : 0);
}

/** A circle in its block, block-local (the front is −y): its radius, and `fall` (0..1), its turn to fall. */
export interface Dot {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly seed: number;
  readonly fall: number;
}

const dotCache = new Map<string, Dot[]>();
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * The `n` circles of a block `w` wide and `h` deep, each of radius `maxR` where they fit (one size over the whole map, as
 * each stands for the same men), packed tight about the block's middle like DFT Tarih's tokens: on a front, in ranks along
 * it — as many ranks as keep them largest, the fewest on a tie (foot at most five, horse and musketeers three), every other
 * rank of foot a little over, the last rank's few centred at the rear; in a heap (`heap`, a writer's `kume`), a disc. A
 * block too full for that size packs them smaller. Horse stand looser (further apart, the same size). The same block always
 * gets the same circles (Remotion renders frames in any order).
 */
export function blockDots(kind: UnitKind, n: number, w: number, h: number, maxR: number, heap: boolean, seed: number): Dot[] {
  const key = `${kind}|${n}|${w.toFixed(2)}|${h.toFixed(2)}|${maxR.toFixed(2)}|${heap ? 1 : 0}|${seed}`;
  const hit = dotCache.get(key);
  if (hit) return hit;
  const loose = kind === "suvari" ? 0.34 : 0.42;
  // The spacing that gives full-size circles; a block's ranks may run a little past its depth (its front edge is a line).
  const full = maxR / loose;
  const deep = h * 1.15;
  const out: Dot[] = [];
  if (n <= 0) return out;
  if (heap) {
    const pitch = Math.min(full, (Math.min(w, h) * 0.62) / (0.56 * Math.sqrt(n)));
    for (let j = 0; j < n; j++) {
      const s = seed * 131 + j * 17;
      const p = packedDot(j, pitch);
      out.push({ x: p.x, y: p.y, r: pitch * loose, seed: s, fall: rand(s + 2) });
    }
  } else {
    const maxRows = kind === "suvari" || kind === "tufekci" ? 3 : 5;
    let best = { rows: 1, cols: n, pitch: 0 };
    for (let rows = 1; rows <= Math.min(maxRows, n); rows++) {
      const cols = Math.ceil(n / rows);
      const pitch = Math.min(full, w / cols, deep / rows);
      if (pitch > best.pitch + 1e-9) best = { rows, cols, pitch };
    }
    const p = best.pitch;
    const stagger = kind !== "suvari";
    for (let row = 0, j = 0; row < best.rows; row++) {
      const inRow = Math.min(best.cols, n - j);
      const shift = stagger && row % 2 === 1 ? p * 0.22 : 0;
      for (let c = 0; c < inRow; c++, j++) {
        const s = seed * 131 + row * 17 + c * 7;
        out.push({ x: (c - (inRow - 1) / 2) * p + shift + (rand(s) - 0.5) * p * 0.12, y: (row - (best.rows - 1) / 2) * p + (rand(s + 1) - 0.5) * p * 0.1, r: p * loose, seed: s, fall: rand(s + 2) });
      }
    }
  }
  if (dotCache.size > 2000) dotCache.clear();
  dotCache.set(key, out);
  return out;
}

/** Circle `j` of a garrison packed in a disc about its middle, `pitch` apart (a sunflower: the first ones innermost). */
export function packedDot(j: number, pitch: number): XY {
  const d = 0.56 * pitch * Math.sqrt(j + 0.5);
  return { x: Math.cos(j * GOLDEN) * d, y: Math.sin(j * GOLDEN) * d };
}

/** The radius of `n` circles packed `pitch` apart (packedDot), to their outer edge. */
export const packedRadius = (n: number, pitch: number) => 0.56 * pitch * Math.sqrt(Math.max(1, n)) + pitch * 0.5;

/** Whether a wall's line closes into a ring (MapBuilder's `walled` asks the same: first and last point within 1 px). */
export function closedRing(points: readonly XY[]): boolean {
  return points.length >= 4 && Math.hypot(points[0]!.x - points[points.length - 1]!.x, points[0]!.y - points[points.length - 1]!.y) < 1;
}

function inRing(p: XY, ring: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function edgeDistance(p: XY, ring: readonly XY[]): number {
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!;
    const b = ring[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
  }
  return best;
}

/** How far inside a ring a point is (negative: outside), in its own px. */
export function ringDepth(p: XY, ring: readonly XY[]): number {
  return (inRing(p, ring) ? 1 : -1) * edgeDistance(p, ring);
}

const poles = new WeakMap<readonly XY[], { x: number; y: number; d: number }>();
/** The point deepest inside a ring and its depth (a grid search refined twice; once per ring). */
export function ringPole(ring: readonly XY[]): { x: number; y: number; d: number } {
  const hit = poles.get(ring);
  if (hit) return hit;
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  let box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  const mid = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  let best = { ...mid, d: ringDepth(mid, ring) };
  for (let round = 0; round < 3; round++) {
    const N = 16;
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N; j++) {
        const p = { x: box.x0 + ((box.x1 - box.x0) * i) / N, y: box.y0 + ((box.y1 - box.y0) * j) / N };
        const d = ringDepth(p, ring);
        if (d > best.d) best = { ...p, d };
      }
    const hw = (box.x1 - box.x0) / 8;
    const hh = (box.y1 - box.y0) / 8;
    box = { x0: best.x - hw, x1: best.x + hw, y0: best.y - hh, y1: best.y + hh };
  }
  poles.set(ring, best);
  return best;
}

/**
 * Where a disc of radius `R` about `c` stands inside a ring: `c` itself when it fits, else the nearest place towards the
 * ring's deepest point where it does (found by halving, so it moves smoothly as `c` does); a disc wider than the ring
 * allows is shrunk to fit at that deepest point (its circles packed closer: `R` returned smaller).
 */
export function fitInRing(c: XY, R: number, ring: readonly XY[]): { x: number; y: number; R: number } {
  const pole = ringPole(ring);
  const room = Math.min(R, pole.d * 0.92);
  if (ringDepth(c, ring) >= room) return { x: c.x, y: c.y, R: room };
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 24; k++) {
    const t = (lo + hi) / 2;
    if (ringDepth({ x: c.x + (pole.x - c.x) * t, y: c.y + (pole.y - c.y) * t }, ring) >= room) hi = t;
    else lo = t;
  }
  return { x: c.x + (pole.x - c.x) * hi, y: c.y + (pole.y - c.y) * hi, R: room };
}

/** How near a ring's edge (a share of its own radius) a formation's middle still counts as standing in it (on the wall). */
export const GARRISON_REACH = 0.25;

/**
 * Which wall ring each step of each unit stands inside, as its garrison (−1: none): the ring's defending side is the one
 * whose units stand deepest in it at first (the Siege of Baghdad Short: the writer put the garrison's front right on the
 * northern wall, the besiegers' assault column too — the side decides, not one formation), within GARRISON_REACH; its
 * steps standing in the ring (or on its wall) are its garrison's, never a rout. Walls that do not close are no ring.
 */
export function garrisonSteps(units: readonly { readonly side: string; readonly steps: readonly { readonly points: readonly XY[]; readonly rout?: boolean }[] }[], walls: readonly { readonly points: readonly XY[] }[]): number[][] {
  const out = units.map((u) => u.steps.map(() => -1));
  const centre = (pts: readonly XY[]) => (pts.length ? { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length } : undefined);
  const rings = walls.flatMap((w, wi) => {
    if (!closedRing(w.points)) return [];
    let area = 0;
    for (let i = 1; i < w.points.length; i++) area += w.points[i - 1]!.x * w.points[i]!.y - w.points[i]!.x * w.points[i - 1]!.y;
    const size = Math.sqrt(Math.abs(area) / 2 / Math.PI);
    return size > 0 ? [{ wi, ring: w.points, size }] : [];
  });
  const sides = [...new Set(units.map((u) => u.side))];
  // The smallest ring first: a citadel's garrison is the citadel's, not the town's.
  for (const { wi, ring, size } of rings.sort((a, b) => a.size - b.size)) {
    const depthOf = (side: string) => {
      const ds = units.flatMap((u) => {
        const c = u.side === side ? centre(u.steps[0]?.points ?? []) : undefined;
        return c ? [ringDepth(c, ring) / size] : [];
      });
      return ds.length ? ds.reduce((a, d) => a + d, 0) / ds.length : -Infinity;
    };
    const defender = sides.map((s) => ({ s, d: depthOf(s) })).sort((a, b) => b.d - a.d)[0];
    if (!defender || defender.d < -GARRISON_REACH) continue;
    units.forEach((u, ui) => {
      if (u.side !== defender.s) return;
      u.steps.forEach((st, si) => {
        const c = centre(st.points);
        if (out[ui]![si]! < 0 && !st.rout && c && ringDepth(c, ring) / size >= -GARRISON_REACH) out[ui]![si] = wi;
      });
    });
  }
  return out;
}
