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
