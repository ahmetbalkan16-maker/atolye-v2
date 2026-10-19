import type { V3CameraKey, V3Shot } from "../../../src/lib/v3/render/RenderPlanTypes";
import { easeInOut, wave } from "../character/rig";

export interface View {
  readonly zoom: number;
  readonly cx: number;
  readonly cy: number;
}

type Axis = keyof View;

const flows = (key: V3CameraKey) => key.ease === undefined || key.ease === "smooth";
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const viewOf = (k: V3CameraKey): View => ({ zoom: k.zoom, cx: k.cx, cy: k.cy });

function hermite(p0: number, p1: number, m0: number, m1: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
}

/**
 * Slope through key `i` on one axis, per frame. Non-zero only inside a run of smooth segments and only where
 * the path keeps going the same way (harmonic mean of the neighbouring slopes), so the camera glides through a
 * key but never overshoots a hold or a turn-around.
 */
function slope(keys: readonly V3CameraKey[], i: number, axis: Axis): number {
  if (i <= 0 || i >= keys.length - 1) return 0;
  const a = keys[i - 1]!, k = keys[i]!, b = keys[i + 1]!;
  if (!flows(k) || !flows(b)) return 0;
  const d0 = (k[axis] - a[axis]) / Math.max(1, k.frame - a.frame);
  const d1 = (b[axis] - k[axis]) / Math.max(1, b.frame - k.frame);
  return d0 * d1 > 0 ? 2 / (1 / d0 + 1 / d1) : 0;
}

/**
 * Camera at a frame. Smooth keys are joined by a monotone cubic spline: the camera eases out where it starts,
 * flows through intermediate keys without stopping and eases in where it comes to rest. A snap key moves in
 * its last 0.22 s; a cut key reframes instantly.
 */
export function cameraAt(keys: readonly V3CameraKey[], frame: number, fps: number): View {
  if (keys.length === 0) return { zoom: 1, cx: 0.5, cy: 0.5 };
  for (let i = 1; i < keys.length; i++) {
    const prev = keys[i - 1]!, next = keys[i]!;
    if (frame >= next.frame) continue;
    if (frame <= prev.frame || next.ease === "cut") return viewOf(prev);
    if (next.ease === "snap") {
      const span = Math.min(next.frame - prev.frame, Math.round(fps * 0.22));
      const t = easeInOut(Math.max(0, (frame - (next.frame - span)) / Math.max(1, span)));
      return { zoom: lerp(prev.zoom, next.zoom, t), cx: lerp(prev.cx, next.cx, t), cy: lerp(prev.cy, next.cy, t) };
    }
    const h = next.frame - prev.frame;
    const t = (frame - prev.frame) / h;
    const at = (axis: Axis) => hermite(prev[axis], next[axis], slope(keys, i - 1, axis) * h, slope(keys, i, axis) * h, t);
    return { zoom: at("zoom"), cx: at("cx"), cy: at("cy") };
  }
  return viewOf(keys[keys.length - 1]!);
}

/**
 * A filmed feel for every shot: a slow push-in over the whole shot and a faint hand-held drift. Both are small
 * (2% zoom, a few pixels) so they read as a living camera rather than a move; seeded by shot id so neighbouring
 * shots do not drift in step.
 */
export function filmCamera(raw: View, shotId: string, frame: number, duration: number, fps: number): View {
  let seed = 0;
  for (let i = 0; i < shotId.length; i++) seed = (seed * 31 + shotId.charCodeAt(i)) % 997;
  const t = frame / fps;
  const u = Math.max(0, Math.min(1, frame / Math.max(1, duration)));
  const push = 1.006 + 0.02 * u * u * (3 - 2 * u);
  return { zoom: raw.zoom * push, cx: raw.cx + 0.0022 * wave(t, 0.8, seed), cy: raw.cy + 0.0016 * wave(t, 0.6, seed + 1.7) };
}

/** Keeps the view inside the stage so no edge of the set is ever shown. */
export function clampView(zoom: number, cx: number, cy: number): View {
  const z = Math.max(1, zoom);
  const half = 0.5 / z;
  return { zoom: z, cx: Math.min(1 - half, Math.max(half, cx)), cy: Math.min(1 - half, Math.max(half, cy)) };
}

export function shakeAt(shot: V3Shot, frame: number): { dx: number; dy: number; rot: number } {
  let dx = 0, dy = 0, rot = 0;
  for (const s of shot.shakes) {
    if (frame < s.start || frame >= s.end) continue;
    const u = (frame - s.start) / Math.max(1, s.end - s.start);
    // Hits within two frames and dies away; a linear fade reads as switching off.
    const a = s.amplitude * Math.min(1, (frame - s.start + 1) / 2) * (1 - u) * (1 - u);
    dx += a * Math.sin(frame * 2.3 + 1.1) * Math.cos(frame * 0.7);
    dy += a * Math.sin(frame * 3.1 + 0.4);
    rot += a * 0.04 * Math.sin(frame * 1.9);
  }
  return { dx, dy, rot };
}
