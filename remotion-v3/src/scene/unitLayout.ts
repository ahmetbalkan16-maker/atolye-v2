/**
 * Unit tokens never sit on each other (map trial, 22 Oct 2026: a siege ring of 6 km round Constantinople was one blob
 * at a wide view, and spread for that view it scattered over the sea once the camera came close). Every frame the
 * standing tokens of all sides are pushed apart until neighbours are `gap` apart on screen: a formation wider than its
 * tokens keeps its shape, a tighter one packs round its place, and two sides' fronts end up touching, not overlapping.
 */

/** Rounds of pushing; a few dozen tokens settle well before this. */
const MAX_ROUNDS = 40;

type XY = { readonly x: number; readonly y: number };

/**
 * Which place of the next formation each token takes: the assignment with the least total squared distance
 * (Hungarian method; owner, 9 Nov 2026, of the Cannae close battle: "askerlerin hareketlerinde biraz atlama var … akıcı
 * hareket etsin"). Token `i` used to go to place `i` whatever the two formations' orders: a block turning into a line
 * sent its tokens across each other, and where two met the spacing pushed them apart one way and, once they had passed,
 * the other way — a leap of a whole gap (277 px in one frame at Cannae). With the least squared distance no two
 * straight paths meet on the way. Formations of different sizes keep the old order (`i`, or the last place).
 */
export function assignPlaces(from: readonly XY[], to: readonly XY[]): number[] {
  const n = from.length;
  if (n !== to.length || n < 2) return from.map((_, i) => Math.min(i, Math.max(0, to.length - 1)));
  const cost = (i: number, j: number) => (from[i]!.x - to[j]!.x) ** 2 + (from[i]!.y - to[j]!.y) ** 2;
  // Potentials and augmenting paths (1-indexed, the classic O(n³) form).
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else minv[j] = minv[j]! - delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }
  const out = new Array<number>(n).fill(0);
  for (let j = 1; j <= n; j++) if (p[j]) out[p[j]! - 1] = j - 1;
  return out;
}

/**
 * For every step of a unit, the place each token takes (`order[s][i]`): from where it stood at the end of the step
 * before, the least-distance assignment. A sweep through a breach keeps its column order (its `through` list).
 */
export function formationOrder(steps: readonly { readonly points: readonly XY[]; readonly via?: XY }[], tokens: number): number[][] {
  const order: number[][] = [];
  steps.forEach((st, s) => {
    const identity = Array.from({ length: tokens }, (_, i) => Math.min(i, Math.max(0, st.points.length - 1)));
    if (s === 0 || st.via || st.points.length !== tokens) {
      order.push(identity);
      return;
    }
    const prev = steps[s - 1]!;
    const rest = Array.from({ length: tokens }, (_, i) => prev.points[order[s - 1]![i]!]!);
    order.push(rest.every(Boolean) ? assignPlaces(rest, st.points) : identity);
  });
  return order;
}

/**
 * `points` pushed apart until no two are closer than `gap` (deterministic, so frames follow each other smoothly).
 * `weights` (0..1, default 1): a token fading in or out needs only that share of the room, so its neighbours ease into
 * the room it leaves instead of jumping when it is gone (owner, 26 Oct 2026: "takılarak hareket var").
 */
/** Where a moving token set off from, where it goes, and how far it is on its way (0..1). */
export interface TokenWay {
  readonly from: XY;
  readonly goal: XY;
  readonly t: number;
}

/** Share of a slide at each end over which a passing pair lets go of its room (and takes it again). */
const PASS_EASE = 0.15;

/**
 * How much two tokens let each other pass now (0 = keep their room, 1 = none): only a pair whose ways swap sides (one
 * set off left of the other and goes to its right), and only while one of them is on its way — easing in after it sets
 * off and out before it arrives. Pushed apart by where they stood, two tokens passing each other were pushed one way
 * and, once past, the other: a leap of a whole gap in one frame (Cannae, 9 Nov 2026: the two cavalries swapping flanks
 * leapt 138 px). Passing through each other for a moment reads as two bodies of troops going by.
 */
export function passShare(a: TokenWay, b: TokenWay): number {
  const swap = (b.from.x - a.from.x) * (b.goal.x - a.goal.x) + (b.from.y - a.from.y) * (b.goal.y - a.goal.y) < 0;
  if (!swap) return 0;
  const moving = (w: TokenWay) => {
    if (w.t <= 0 || w.t >= 1 || (w.from.x === w.goal.x && w.from.y === w.goal.y)) return 0;
    const ramp = (v: number) => {
      const c = Math.min(1, Math.max(0, v / PASS_EASE));
      return c * c * (3 - 2 * c);
    };
    return ramp(w.t) * ramp(1 - w.t);
  };
  return Math.max(moving(a), moving(b));
}

export function separateTokens(points: readonly { x: number; y: number }[], gap: number, weights?: readonly number[], ways?: readonly (TokenWay | undefined)[], groups?: readonly number[]): { x: number; y: number }[] {
  const p = points.map((q) => ({ x: q.x, y: q.y }));
  // A pair's room for this frame: less as their ways pass each other (passShare).
  const room = new Map<number, number>();
  const roomOf = (a: number, b: number) => {
    const key = a * 100_000 + b;
    if (!room.has(key)) room.set(key, 1 - (ways?.[a] && ways?.[b] ? passShare(ways[a]!, ways[b]!) : 0));
    return room.get(key)!;
  };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let moved = false;
    for (let a = 0; a < p.length; a++)
      for (let b = a + 1; b < p.length; b++) {
        // One group's tokens were spaced before (a unit in its formation): only different groups are kept apart here.
        if (groups && groups[a] === groups[b]) continue;
        const g = gap * Math.min(1, weights?.[a] ?? 1, weights?.[b] ?? 1, roomOf(a, b));
        if (g <= 0) continue;
        const dx = p[b]!.x - p[a]!.x;
        const dy = p[b]!.y - p[a]!.y;
        const d = Math.hypot(dx, dy);
        if (d >= g * 0.999) continue;
        // Tokens on one place part in a direction of their own.
        const ux = d > 1e-6 ? dx / d : Math.cos(a * 2.4 + b * 0.9);
        const uy = d > 1e-6 ? dy / d : Math.sin(a * 2.4 + b * 0.9);
        const push = (g - d) / 2;
        p[a]!.x -= ux * push;
        p[a]!.y -= uy * push;
        p[b]!.x += ux * push;
        p[b]!.y += uy * push;
        moved = true;
      }
    if (!moved) break;
  }
  return p;
}
