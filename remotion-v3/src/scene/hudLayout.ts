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
