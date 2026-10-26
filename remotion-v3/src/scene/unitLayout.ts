/**
 * Unit tokens never sit on each other (map trial, 22 Oct 2026: a siege ring of 6 km round Constantinople was one blob
 * at a wide view, and spread for that view it scattered over the sea once the camera came close). Every frame the
 * standing tokens of all sides are pushed apart until neighbours are `gap` apart on screen: a formation wider than its
 * tokens keeps its shape, a tighter one packs round its place, and two sides' fronts end up touching, not overlapping.
 */

/** Rounds of pushing; a few dozen tokens settle well before this. */
const MAX_ROUNDS = 40;

/**
 * `points` pushed apart until no two are closer than `gap` (deterministic, so frames follow each other smoothly).
 * `weights` (0..1, default 1): a token fading in or out needs only that share of the room, so its neighbours ease into
 * the room it leaves instead of jumping when it is gone (owner, 26 Oct 2026: "takılarak hareket var").
 */
export function separateTokens(points: readonly { x: number; y: number }[], gap: number, weights?: readonly number[]): { x: number; y: number }[] {
  const p = points.map((q) => ({ x: q.x, y: q.y }));
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let moved = false;
    for (let a = 0; a < p.length; a++)
      for (let b = a + 1; b < p.length; b++) {
        const g = gap * Math.min(1, weights?.[a] ?? 1, weights?.[b] ?? 1);
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
