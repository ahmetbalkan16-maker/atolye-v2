import type { ReactNode } from "react";

/**
 * The close battle map seen from a tilted camera (owner's trial, 12 Nov 2026: "Kings and Generals"-like — the ground
 * and the armies in slight perspective, the far side smaller, the names and badges upright and readable — sized by
 * their depth like the ground under them, 0.77 far to 1 near, so what stands apart on the flat map stays apart). Pure
 * geometry for MapView and the smoke: a point of the flat map picture (the picture MapView draws without tilt, W×H,
 * after the map's own camera) goes to the screen through the same 4×4 matrix the browser applies to the tilted ground
 * (`tiltMatrix`), so an upright name lands exactly on its place on the tilted ground.
 *
 * The camera turns about the picture's middle; the whole picture the director framed (the acting area) stays in the
 * frame — its near edge as wide as the frame — and the ground beyond it fills the rest, never showing a sky.
 */

/** Perspective distance in frame heights: the far edge of the framed picture about 0.75× the near edge's size at 30°. */
export const TILT_PERSPECTIVE_H = 1.6;
/** A steeper camera shows the ground too flat and needs far too much land beyond the framed picture. */
export const MAX_TILT_DEG = 40;

export interface Tilt {
  /** The frame (= the flat picture) size. */
  readonly W: number;
  readonly H: number;
  /** The ground's turn from straight down (degrees, 0..MAX_TILT_DEG). */
  readonly deg: number;
  /** Perspective distance (px). */
  readonly P: number;
  /** The plane's scale before the turn, so the framed picture's near edge is as wide as the frame. */
  readonly s: number;
  /** The screen height the picture's middle row lands on (the framed picture centred in the frame). */
  readonly ys: number;
}

type Pt = { x: number; y: number };
type Box = { x0: number; y0: number; x1: number; y1: number };

/** The tilt for a frame: the scale and height that keep the whole framed picture in the frame, centred. */
export function tiltFor(deg: number, W: number, H: number): Tilt {
  const d = Math.max(0, Math.min(MAX_TILT_DEG, deg));
  const th = (d * Math.PI) / 180;
  const P = TILT_PERSPECTIVE_H * H;
  const a0 = ((H / 2) * Math.sin(th)) / P;
  // The near edge (the picture's bottom, nearest the eye) is the widest: s/(1 − s·a0) = 1 there.
  const s = 1 / (1 + a0);
  const half = (s * Math.cos(th) * H) / 2;
  const top = half / (1 + s * a0);
  const bottom = half / (1 - s * a0);
  return { W, H, deg: d, P, s, ys: H / 2 - (bottom - top) / 2 };
}

/** The homogeneous divisor at a picture row (> 0 everywhere on the drawn ground: the horizon lies far above). */
function depth(t: Tilt, y: number): number {
  return 1 - (t.s * Math.sin((t.deg * Math.PI) / 180) * (y - t.H / 2)) / t.P;
}

/**
 * A flat-picture point on the screen through the tilted camera, how large things there look across (`scale`, 1 = as
 * flat) and how much a short upward or downward step on the ground shortens there (`scaleY`: the foreshortening too).
 */
export function tiltProject(t: Tilt, x: number, y: number): Pt & { scale: number; scaleY: number } {
  const w = depth(t, y);
  const c = Math.cos((t.deg * Math.PI) / 180);
  return { x: t.W / 2 + (t.s * (x - t.W / 2)) / w, y: t.ys + (t.s * c * (y - t.H / 2)) / w, scale: t.s / w, scaleY: (t.s * c) / (w * w) };
}

/** The flat-picture point a screen point shows on the tilted ground (tiltProject's inverse). */
export function tiltUnproject(t: Tilt, X: number, Y: number): Pt {
  const th = (t.deg * Math.PI) / 180;
  const dy = Y - t.ys;
  const yc = dy / (t.s * Math.cos(th) + (dy * t.s * Math.sin(th)) / t.P);
  const w = 1 - (t.s * Math.sin(th) * yc) / t.P;
  return { x: t.W / 2 + ((X - t.W / 2) * w) / t.s, y: t.H / 2 + yc };
}

/**
 * The flat-picture rectangle a screen rectangle shows of the tilted ground, both ways: `cover` holds every point seen
 * (the ground to draw), `inside` is surely seen whole (names slid into it stay in the frame). The far (top) row of the
 * screen shows the widest strip of ground, the near (bottom) row the narrowest.
 */
export function tiltSeen(t: Tilt, r: Box): { cover: Box; inside: Box } {
  const tl = tiltUnproject(t, r.x0, r.y0);
  const tr = tiltUnproject(t, r.x1, r.y0);
  const bl = tiltUnproject(t, r.x0, r.y1);
  const br = tiltUnproject(t, r.x1, r.y1);
  // Surely seen: no lower than the rectangle's own bottom row of the flat picture (the frame's ground below the framed
  // picture is a narrow strip), as wide as the screen shows that row.
  const y1 = Math.min(bl.y, r.y1);
  const Y = tiltProject(t, t.W / 2, y1).y;
  const l = tiltUnproject(t, r.x0, Y);
  const rr = tiltUnproject(t, r.x1, Y);
  return {
    cover: { x0: Math.min(tl.x, bl.x), x1: Math.max(tr.x, br.x), y0: tl.y, y1: bl.y },
    inside: { x0: Math.max(tl.x, l.x), x1: Math.min(tr.x, rr.x), y0: tl.y, y1 },
  };
}

/**
 * The CSS `matrix3d` of the tilted ground: an element whose own (0, 0) is the flat picture's (−ox, −oy), drawn with
 * `transform-origin: 0 0`. The same mapping as tiltProject (z = 0), as a full invertible 4×4 (rotation about x, uniform
 * scale, perspective), column-major as CSS wants it.
 */
export function tiltMatrix(t: Tilt, ox: number, oy: number): number[] {
  const th = (t.deg * Math.PI) / 180;
  const sin = Math.sin(th);
  const cos = Math.cos(th);
  const A = (t.s * sin) / t.P;
  const B = (t.s * cos) / t.P;
  const cx = ox + t.W / 2;
  const cy = oy + t.H / 2;
  const w0 = 1 + A * cy;
  // Rows acting on (x, y, z, 1): screen x·w, screen y·w, depth, w.
  const rx = [t.s, -(t.W / 2) * A, -(t.W / 2) * B, -t.s * cx + (t.W / 2) * w0];
  const ry = [0, t.s * cos - t.ys * A, -t.s * sin - t.ys * B, -t.s * cos * cy + t.ys * w0];
  const rz = [0, t.s * sin, t.s * cos, -t.s * sin * cy];
  const rw = [0, -A, -B, w0];
  return [0, 1, 2, 3].flatMap((j) => [rx[j]!, ry[j]!, rz[j]!, rw[j]!]);
}

/** A point through a column-major 4×4 (z = 0), as the browser does: for the smoke's check that matrix and projection agree. */
export function applyMatrix(m: readonly number[], x: number, y: number): Pt {
  const X = m[0]! * x + m[4]! * y + m[12]!;
  const Y = m[1]! * x + m[5]! * y + m[13]!;
  const w = m[3]! * x + m[7]! * y + m[15]!;
  return { x: X / w, y: Y / w };
}

/**
 * How a name, a badge or a flag is drawn on the tilted map: given its place (world px) and its drawing, the drawing
 * moved upright to where the place lands on the tilted ground (MapView's upright layer), nothing (the tilted ground
 * layer), or — absent — the drawing as it is (the flat map, unchanged).
 */
export type Up = (x: number, y: number, node: ReactNode) => ReactNode;
