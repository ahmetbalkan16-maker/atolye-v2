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
