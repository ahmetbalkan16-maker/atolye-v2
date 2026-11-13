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
/**
 * Where a moving token set off from, where it goes, and how far it is on its way (0..1). `via`: the breach it goes
 * through on the way (its slide runs from → via → goal, `t` a share of that whole length).
 */
export interface TokenWay {
  readonly from: XY;
  readonly goal: XY;
  readonly t: number;
  readonly via?: XY;
}

/** The point a share `u` (0..1) of the way along a token's way, by length (as MapUnits' slide runs it). */
function wayPoint(w: TokenWay, u: number): XY {
  if (!w.via) return { x: w.from.x + (w.goal.x - w.from.x) * u, y: w.from.y + (w.goal.y - w.from.y) * u };
  const l1 = Math.hypot(w.via.x - w.from.x, w.via.y - w.from.y);
  const l2 = Math.hypot(w.goal.x - w.via.x, w.goal.y - w.via.y);
  const at = u * (l1 + l2);
  if (at <= l1) {
    const s = l1 > 1e-9 ? at / l1 : 1;
    return { x: w.from.x + (w.via.x - w.from.x) * s, y: w.from.y + (w.via.y - w.from.y) * s };
  }
  const s = l2 > 1e-9 ? (at - l1) / l2 : 1;
  return { x: w.via.x + (w.goal.x - w.via.x) * s, y: w.via.y + (w.goal.y - w.via.y) * s };
}

/** The share of a way's length at its breach (absent: none). */
function viaShare(w: TokenWay): number | undefined {
  if (!w.via) return undefined;
  const l1 = Math.hypot(w.via.x - w.from.x, w.via.y - w.from.y);
  const l2 = Math.hypot(w.goal.x - w.via.x, w.goal.y - w.via.y);
  return l1 + l2 > 1e-9 ? l1 / (l1 + l2) : undefined;
}

/**
 * Whether two ways swap sides: the line from one token to the other turns by more than a right angle from where they
 * set off to where they arrive, followed along both ways together (each straight piece between the ways' corners turns
 * it by the angle it sweeps). For two straight ways that is the old test (the start and end lines point apart). A way
 * through a breach is followed through its breach (Siege of Baghdad trial, 13 Nov 2026: tested from start to goal in a
 * straight line, a Janissary going through the breach and a unit standing at the breach were never let pass — the
 * spacing pushed them apart one way, then the other: 72 px in one frame).
 */
export function waysSwap(a: TokenWay, b: TokenWay): boolean {
  if (!a.via && !b.via) return (b.from.x - a.from.x) * (b.goal.x - a.goal.x) + (b.from.y - a.from.y) * (b.goal.y - a.goal.y) < 0;
  const cuts = [0, viaShare(a), viaShare(b), 1].filter((u): u is number => u !== undefined).sort((p, q) => p - q);
  let turn = 0;
  let last: XY | undefined;
  for (const u of cuts) {
    const pa = wayPoint(a, u);
    const pb = wayPoint(b, u);
    const d = { x: pb.x - pa.x, y: pb.y - pa.y };
    // The two ways meet at a corner: they pass through each other.
    if (Math.hypot(d.x, d.y) < 1e-6) return true;
    if (last) turn += Math.atan2(last.x * d.y - last.y * d.x, last.x * d.x + last.y * d.y);
    last = d;
  }
  return Math.abs(turn) > Math.PI / 2;
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
  if (!waysSwap(a, b)) return 0;
  const moving = (w: TokenWay) => {
    if (w.t <= 0 || w.t >= 1 || (w.from.x === w.goal.x && w.from.y === w.goal.y && !w.via)) return 0;
    const ramp = (v: number) => {
      const c = Math.min(1, Math.max(0, v / PASS_EASE));
      return c * c * (3 - 2 * c);
    };
    return ramp(w.t) * ramp(1 - w.t);
  };
  return Math.max(moving(a), moving(b));
}

/**
 * A pair's pass share over their ways sampled across the last frames (one way, or the same number of samples each):
 * the mean, so it changes gradually even where a token's way changes — a new step setting off mid-slide reset it from
 * full to none in one frame and pushed two crossing cavalries 153 px apart (Cannae trial, 9 Nov 2026).
 */
export function passMean(a: TokenWay | readonly (TokenWay | undefined)[] | undefined, b: TokenWay | readonly (TokenWay | undefined)[] | undefined): number {
  const list = (w: typeof a): readonly (TokenWay | undefined)[] => (w === undefined ? [] : Array.isArray(w) ? w : [w as TokenWay]);
  const [sa, sb] = [list(a), list(b)];
  const n = Math.min(sa.length, sb.length);
  if (!n) return 0;
  let sum = 0;
  for (let j = 0; j < n; j++) if (sa[j] && sb[j]) sum += passShare(sa[j]!, sb[j]!);
  return sum / n;
}

/**
 * `ids` (a stable number per token, ascending with its place in `points`): given, two tokens are pushed apart along the
 * line between the places they were asked to stand at — not between where the pushing has moved them — until they are
 * `gap` apart along it. The result then follows the places and the room continuously from frame to frame: pushed along
 * where the rounds had moved them, overlapping formations fading in (their room growing with their fade) were sorted
 * one way on one frame and another on the next — 0.3 s of shaking as a map opened (Siege of Baghdad trial, 13 Nov 2026:
 * 15.6 px a frame among guns, horse and garrison that never moved). Two tokens asked to stand on one spot part in a
 * direction of their own ids, the same every frame.
 */
export function separateTokens(points: readonly { x: number; y: number }[], gap: number, weights?: readonly number[], ways?: readonly (TokenWay | readonly (TokenWay | undefined)[] | undefined)[], groups?: readonly number[], ids?: readonly number[]): { x: number; y: number }[] {
  const p = points.map((q) => ({ x: q.x, y: q.y }));
  // The fixed line of each pair (ids given): from the asked places, or the pair's own direction on one spot.
  const axis = (a: number, b: number) => {
    const dx = points[b]!.x - points[a]!.x;
    const dy = points[b]!.y - points[a]!.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-6) return { x: dx / d, y: dy / d };
    const turn = ids![a]! * 2.4 + ids![b]! * 0.9;
    return { x: Math.cos(turn), y: Math.sin(turn) };
  };
  // A pair's room for this frame: less as their ways pass each other (passShare).
  const room = new Map<number, number>();
  const roomOf = (a: number, b: number) => {
    const key = a * 100_000 + b;
    if (!room.has(key)) room.set(key, 1 - passMean(ways?.[a], ways?.[b]));
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
        if (ids) {
          const u = axis(a, b);
          const along = (p[b]!.x - p[a]!.x) * u.x + (p[b]!.y - p[a]!.y) * u.y;
          if (along >= g * 0.999) continue;
          const push = (g - along) / 2;
          p[a]!.x -= u.x * push;
          p[a]!.y -= u.y * push;
          p[b]!.x += u.x * push;
          p[b]!.y += u.y * push;
          moved = true;
          continue;
        }
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
