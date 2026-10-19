/**
 * Follow-through for the rig. Each channel chases its acted target like a damped spring, so a limb thrown into
 * a gesture overshoots a little and settles, and softer channels (forearm, head) trail stiffer ones
 * (overlapping action) instead of every joint arriving on the same frame.
 *
 * Remotion renders frames in parallel and in any order, so there is no previous frame to carry state from:
 * the state at a frame is re-simulated from a warm-up window before it, starting at rest on the target. The
 * window is long enough that this starting error has decayed below a thousandth of a degree, so neighbouring
 * frames agree and every frame is a pure function of its number.
 */
export interface SpringSpec {
  /** Natural frequency; higher follows tighter. */
  readonly hz: number;
  /** Damping ratio; below 1 overshoots once and settles. */
  readonly zeta: number;
}

const SUBSTEPS = 4;

export function followThrough(
  targetAt: (frame: number) => readonly number[],
  frame: number,
  fps: number,
  springs: readonly SpringSpec[],
  warmup: number,
): { value: number[]; velocity: number[] } {
  // Frames before the shot start (and frame 0) are at rest on their target.
  const from = Math.max(0, frame - warmup);
  let a = targetAt(Math.min(from, frame));
  const x = [...a];
  const v = x.map(() => 0);
  if (frame <= from) return { value: x, velocity: v };
  const dt = 1 / (fps * SUBSTEPS);
  const omega = springs.map((s) => 2 * Math.PI * s.hz);
  for (let f = from; f < frame; f++) {
    const b = targetAt(f + 1);
    for (let k = 1; k <= SUBSTEPS; k++) {
      const u = k / SUBSTEPS;
      for (let i = 0; i < x.length; i++) {
        const w = omega[i]!;
        const target = a[i]! + (b[i]! - a[i]!) * u;
        // Semi-implicit Euler: stable for these frequencies at 4 substeps per frame.
        v[i] = v[i]! + (w * w * (target - x[i]!) - 2 * springs[i]!.zeta * w * v[i]!) * dt;
        x[i] = x[i]! + v[i]! * dt;
      }
    }
    a = b;
  }
  return { value: x, velocity: v };
}
