import type { V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";

/**
 * Where a map's screen marks stand (MapMarks' StrengthBar and DateStamp), shared with MapView, which writes no map name
 * under them. Sizes are 1080p pixels, scaled by the frame's short side.
 */

/** The strength bar's width. */
export const BAR_W = 860;

/**
 * The bar's top: under the date stamp in a Short's narrow frame, where the two meet (the Kosovo march as a Short: the
 * second side's name "SERBS" ran under "June 1389").
 */
export const barTop = (W: number, H: number) => (W < H ? 150 : 66);

/** The date plate's width for a date's text. */
export const plateWidth = (text: string) => Math.max(150, text.length * 25 + 56);

/**
 * The marks' boxes on a frame of W×H (its own pixels): the date stamp's corner and, while it is on, the strength bar with
 * its names and numbers.
 */
export function hudBoxes(map: Pick<V3GeoMap, "dates" | "strength">, frame: number, W: number, H: number): { x0: number; y0: number; x1: number; y1: number }[] {
  const u = Math.min(W, H) / 1080;
  return [
    ...(map.dates?.length ? [{ x0: W - 56 * u - plateWidth(map.dates.reduce((a, d) => (d.text.length > a.length ? d.text : a), "")) * u, y0: 0, x1: W, y1: 110 * u }] : []),
    ...((map.strength ?? []).some((s) => s.start <= frame && (s.end === undefined || frame < s.end)) ? [{ x0: (W - BAR_W * u) / 2 - 12 * u, y0: 0, x1: (W + BAR_W * u) / 2 + 12 * u, y1: (barTop(W, H) + 84) * u }] : []),
  ];
}

/**
 * A map badge's size round its place, in screen px at 1080p (multiply by the map's k): half its width and how far it
 * reaches up from the place. Relief: the portrait ring over a parchment scroll as wide as the name, a point down to
 * the place; cartoon: the ring with the name plate on top. (src/lib/v3/maps/CloseLabels.badgeBox is the same shape,
 * with room for the talking swell.)
 */
export function badgeExtent(label: string, relief: boolean): { half: number; up: number } {
  return relief ? { half: Math.max(49, (label.length * 11.5 + 34) / 2 + 12), up: 131 } : { half: Math.max(54, label.length * 9 + 18), up: 175 };
}

/**
 * Where a map badge stands so the frame shows it whole (Zanzibar Short, 3 Nov 2026: in the vertical window "Sultan
 * Khalid bin Barghash" stood 310 px past the right edge, "Rawson" cut on the left): slid in from an edge (`dx`, `dy`,
 * world px) while its place is in view — its point still reaches the place — and fading out (`alpha`) as its place
 * leaves the view, gone `fade` px past the edge. `half`/`up`: the badge's size in world px; `view`: the world the frame
 * shows; `margin`: room kept from the edge.
 */
export function badgeEdgeFit(
  at: { x: number; y: number },
  size: { half: number; up: number },
  view: { x0: number; y0: number; x1: number; y1: number },
  margin: number,
  fade: number,
): { dx: number; dy: number; alpha: number } {
  const outside = Math.max(view.x0 - at.x, at.x - view.x1, view.y0 - at.y, at.y - view.y1, 0);
  const alpha = Math.max(0, Math.min(1, 1 - outside / Math.max(1e-6, fade)));
  const lo = view.x0 + margin;
  const hi = view.x1 - margin;
  const dx = hi - lo < 2 * size.half ? (lo + hi) / 2 - at.x : at.x - size.half < lo ? lo - (at.x - size.half) : at.x + size.half > hi ? hi - (at.x + size.half) : 0;
  const dy = at.y - size.up < view.y0 + margin ? view.y0 + margin - (at.y - size.up) : 0;
  return { dx, dy, alpha };
}

export type Box = { x0: number; y0: number; x1: number; y1: number };
const boxOf =(at: { x: number; y: number }, size: { half: number; up: number }, d = { dx: 0, dy: 0 }): Box => ({ x0: at.x + d.dx - size.half, x1: at.x + d.dx + size.half, y0: at.y + d.dy - size.up, y1: at.y + d.dy });
const meets = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * All the badges on a map frame at once (badgeEdgeFit each), so a badge slid in from the edge never lands on another:
 * the Zanzibar remake (4 Nov 2026) slid Rawson's scroll, cut by the window's left edge, onto Khalid's beside it —
 * spaceBadges had set them apart, wider than a Short's window. Badges are settled in turn — the one speaking
 * (`priority`) first, then the least cut — and each keeps its slide unless it would land on one already settled; then
 * it stays and is gone as soon as the edge cuts into it (a tenth). Two half-cut, half-faded badges read worse than
 * one whole. `shown`: each badge's own visibility now (0 = not on the map). `view`: the world the frame shows, or each
 * badge's own (a tilted map shows a wider strip at its far rows: MapView's viewAt).
 */
export function badgeEdgeFits(
  badges: readonly { readonly at: { x: number; y: number }; readonly size: { half: number; up: number }; readonly shown: number; readonly priority?: number }[],
  views: Box | readonly Box[],
  margin: number,
  fade: number,
): { dx: number; dy: number; alpha: number }[] {
  const viewOf = (i: number): Box => (Array.isArray(views) ? (views as readonly Box[])[i]! : (views as Box));
  const first = badges.map((b, i) => badgeEdgeFit(b.at, b.size, viewOf(i), margin, fade));
  const cutOf = (i: number) => {
    const own = boxOf(badges[i]!.at, badges[i]!.size);
    const view = viewOf(i);
    return Math.max(0, view.x0 - own.x0, own.x1 - view.x1, view.y0 - own.y0) / Math.max(1e-6, 2 * badges[i]!.size.half);
  };
  const order = badges.map((_, i) => i).sort((a, b) => (badges[b]!.priority ?? 0) - (badges[a]!.priority ?? 0) || cutOf(a) - cutOf(b) || a - b);
  const settled: Box[] = [];
  const out: { dx: number; dy: number; alpha: number }[] = badges.map(() => ({ dx: 0, dy: 0, alpha: 0 }));
  for (const i of order) {
    const b = badges[i]!;
    const f = first[i]!;
    const slid = boxOf(b.at, b.size, f);
    const fits = (!f.dx && !f.dy) || !settled.some((s) => meets(slid, s));
    const r = fits ? f : { dx: 0, dy: 0, alpha: f.alpha * Math.max(0, 1 - cutOf(i) * 10) };
    out[i] = r;
    if (b.shown > 0 && r.alpha > 0) settled.push(boxOf(b.at, b.size, r));
  }
  return out;
}

/**
 * Where a label on a battle map stands so it is read whole (Waterloo Short, 6 Nov 2026: "French infantry" stood 173 px
 * and "French cavalry" 309 px past the left edge, "Prussian infantry" lay wholly inside Blücher's badge, "74,326 men"
 * under the date stamp, "BATTLE OF WATERLOO" cut by the left edge as the camera moved on): slid inside the view, then,
 * when it lands on a badge, a screen mark or a label settled before it (`avoid`), moved the shortest way — above, below
 * or beside a box it meets — to a place in the view free of all of them. With no such place within `reach` it fades out
 * rather than print over them; it fades too as what it names (`anchor`) leaves the view, gone `fade` past the edge.
 * World px: `at` the label's centre, `half` its half size, `margin` room kept from the edge.
 */
export function labelSpot(
  at: { x: number; y: number },
  half: { x: number; y: number },
  anchor: { x: number; y: number },
  view: Box,
  avoid: readonly Box[],
  o: { readonly margin: number; readonly fade: number; readonly reach: number },
): { x: number; y: number; alpha: number } {
  const outside = Math.max(view.x0 - anchor.x, anchor.x - view.x1, view.y0 - anchor.y, anchor.y - view.y1, 0);
  const alpha = Math.max(0, Math.min(1, 1 - outside / Math.max(1e-6, o.fade)));
  const lo = { x: view.x0 + o.margin, y: view.y0 + o.margin };
  const hi = { x: view.x1 - o.margin, y: view.y1 - o.margin };
  // Inside on one axis: centred when the view is narrower than the label.
  const into = (c: number, h: number, a: number, b: number) => (b - a < 2 * h ? (a + b) / 2 : Math.min(b - h, Math.max(a + h, c)));
  const start = { x: into(at.x, half.x, lo.x, hi.x), y: into(at.y, half.y, lo.y, hi.y) };
  const own = (p: { x: number; y: number }): Box => ({ x0: p.x - half.x, x1: p.x + half.x, y0: p.y - half.y, y1: p.y + half.y });
  const free = (p: { x: number; y: number }) => !avoid.some((b) => meets(own(p), b));
  if (free(start)) return { ...start, alpha };
  const fits = (p: { x: number; y: number }) => p.x - half.x >= lo.x - 0.5 && p.x + half.x <= hi.x + 0.5 && p.y - half.y >= lo.y - 0.5 && p.y + half.y <= hi.y + 0.5;
  const gap = half.y * 0.25;
  const tries = avoid.flatMap((b) => [
    { x: start.x, y: b.y0 - half.y - gap },
    { x: start.x, y: b.y1 + half.y + gap },
    { x: b.x0 - half.x - gap, y: start.y },
    { x: b.x1 + half.x + gap, y: start.y },
  ]);
  let best: { x: number; y: number } | undefined;
  let bestD = Infinity;
  for (const p of tries) {
    const d = Math.hypot(p.x - start.x, p.y - start.y);
    if (d < bestD && d <= o.reach && fits(p) && free(p)) [best, bestD] = [p, d];
  }
  return best ? { ...best, alpha } : { ...start, alpha: 0 };
}
