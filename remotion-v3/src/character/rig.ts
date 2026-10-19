import type { V3Gesture } from "../../../src/lib/v3/render/RenderPlanTypes";

/**
 * Character space: feet centre at (0, 0), y grows downwards, head radius = 100.
 * The character always faces +x here; facing left is a mirror applied by the caller.
 */
export const INK = "#1d1b26";
export const INK_W = 6;
export const SKIN = "#fbfaf5";
export const SKIN_SHADE = "#e4e0d4";

export const HIP_Y = -150;
export const SHOULDER_Y = -318;
export const NECK_Y = -336;
export const HEAD_CY = -430;
export const HEAD_R = 100;
export const SHOULDER_X = 62;
export const HIP_X = 26;
export const UPPER_ARM = 74;
export const FORE_ARM = 66;
export const THIGH = 80;
export const SHIN = 72;

export type HandShape = "acik" | "yumruk" | "isaret";

export interface Pose {
  /** Degrees, rotation of everything above the hips; positive leans forward (+x). */
  readonly lean: number;
  /** Root offset, negative is up. */
  readonly bob: number;
  /** 1 = rest, >1 stretched tall, <1 squashed. */
  readonly squash: number;
  readonly headTilt: number;
  /** [upper, fore] degrees. Upper is measured from straight down, outward positive; fore is relative to upper. */
  readonly armBack: readonly [number, number];
  readonly armFront: readonly [number, number];
  readonly handBack: HandShape;
  readonly handFront: HandShape;
  /** [thigh, knee] degrees, same convention as arms (outward positive). */
  readonly legBack: readonly [number, number];
  readonly legFront: readonly [number, number];
  /** Extra foot lift for walking under a robe (units, positive lifts). */
  readonly liftBack: number;
  readonly liftFront: number;
}

export const REST_POSE: Pose = {
  lean: 0,
  bob: 0,
  squash: 1,
  headTilt: 0,
  armBack: [9, 8],
  armFront: [9, 8],
  handBack: "acik",
  handFront: "acik",
  legBack: [4, 0],
  legFront: [4, 0],
  liftBack: 0,
  liftFront: 0,
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix2 = (a: readonly [number, number], b: readonly [number, number], t: number): [number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t)];

export function blendPose(a: Pose, b: Pose, t: number): Pose {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return {
    lean: mix(a.lean, b.lean, t),
    bob: mix(a.bob, b.bob, t),
    squash: mix(a.squash, b.squash, t),
    headTilt: mix(a.headTilt, b.headTilt, t),
    armBack: mix2(a.armBack, b.armBack, t),
    armFront: mix2(a.armFront, b.armFront, t),
    handBack: t < 0.5 ? a.handBack : b.handBack,
    handFront: t < 0.5 ? a.handFront : b.handFront,
    legBack: mix2(a.legBack, b.legBack, t),
    legFront: mix2(a.legFront, b.legFront, t),
    liftBack: mix(a.liftBack, b.liftBack, t),
    liftFront: mix(a.liftFront, b.liftFront, t),
  };
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Limb direction for an angle measured from straight down; side -1 is the back (left) limb. */
export function limbDir(angle: number, side: 1 | -1): Point {
  return { x: side * Math.sin(rad(angle)), y: Math.cos(rad(angle)) };
}

export interface LimbJoints {
  readonly root: Point;
  readonly mid: Point;
  readonly end: Point;
  /** Screen angle (degrees) of the lower segment, for orienting hands/feet. */
  readonly endAngle: number;
}

export function solveLimb(root: Point, angles: readonly [number, number], lengths: readonly [number, number], side: 1 | -1): LimbJoints {
  const d1 = limbDir(angles[0], side);
  const mid = { x: root.x + d1.x * lengths[0], y: root.y + d1.y * lengths[0] };
  const d2 = limbDir(angles[0] + angles[1], side);
  const end = { x: mid.x + d2.x * lengths[1], y: mid.y + d2.y * lengths[1] };
  return { root, mid, end, endAngle: (Math.atan2(d2.y, d2.x) * 180) / Math.PI };
}

/**
 * Gesture targets. "front" is the arm on the facing side; gestures aimed at the other side
 * swap arms in `gesturePose`.
 */
export function gesturePose(g: V3Gesture, t: number, base: Pose, aimBack: boolean): Pose {
  const wob = (speed: number, amp: number) => wave(t, speed, 0) * amp;
  let p: Pose;
  switch (g) {
    case "konus":
      p = { ...base, armFront: [34 + wob(5.1, 6), 70 + wob(7.3, 14)], handFront: "acik", armBack: [14, 18] };
      break;
    case "isaret_et":
      p = { ...base, lean: 4, armFront: [93, -4], handFront: "isaret", armBack: [10, 12] };
      break;
    case "el_salla":
      p = { ...base, armFront: [150, 14 + wob(13, 26)], handFront: "acik" };
      break;
    case "sasir":
      p = { ...base, armFront: [128, 32], armBack: [128, 32], handFront: "acik", handBack: "acik", squash: 1.06, headTilt: -4 };
      break;
    case "egil":
      p = { ...base, lean: 20, headTilt: 12, armFront: [12, -70], armBack: [8, 30], handFront: "acik", bob: 6 };
      break;
    case "kollari_kavustur":
      p = { ...base, armFront: [14, -118], armBack: [14, -118], handFront: "yumruk", handBack: "yumruk", headTilt: -3 };
      break;
    case "dusun":
      p = { ...base, armFront: [10, -150], handFront: "yumruk", armBack: [-16, -98], handBack: "yumruk", headTilt: 9 };
      break;
    case "omuz_silk":
      p = { ...base, armFront: [42, 68], armBack: [42, 68], handFront: "acik", handBack: "acik", headTilt: 8, bob: -5 };
      break;
    case "yumruk_kaldir":
      p = { ...base, armFront: [165, -14], handFront: "yumruk", lean: -3 };
      break;
    case "elleri_belde":
      p = { ...base, armFront: [30, -76], armBack: [30, -76], handFront: "yumruk", handBack: "yumruk", lean: -3 };
      break;
    case "yuz_avucla":
      p = { ...base, armFront: [170, 62], handFront: "acik", headTilt: 12, lean: 5 };
      break;
    case "kutla":
      p = { ...base, armFront: [160, 10 + wob(9, 12)], armBack: [160, 10 + wob(9, 12)], handFront: "yumruk", handBack: "yumruk", bob: -10 - Math.abs(wob(9, 16)) };
      break;
  }
  if (!aimBack) return p;
  return { ...p, armFront: p.armBack, armBack: p.armFront, handFront: p.handBack, handBack: p.handFront };
}

/**
 * Walk/run cycle layered over a pose; `phase` advances by π per step and `amount` (0..1) eases the cycle in at
 * the first step and out at the last, so the feet never pop between standing and walking.
 */
export function walkPose(base: Pose, phase: number, run: boolean, amount = 1): Pose {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  // Squared half-waves: knees and feet leave and return to rest smoothly instead of kinking at zero.
  const up = (v: number) => (v > 0 ? v * v : 0);
  const legAmp = (run ? 34 : 22) * amount;
  const armAmp = (run ? 30 : 16) * amount;
  const knee = (run ? 40 : 22) * amount;
  const lift = (run ? 18 : 9) * amount;
  return {
    ...base,
    lean: base.lean + (run ? 9 : 4) * amount,
    bob: base.bob - s * s * (run ? 12 : 6) * amount,
    legFront: [base.legFront[0] + s * legAmp, base.legFront[1] + up(-s) * knee],
    legBack: [base.legBack[0] - s * legAmp, base.legBack[1] + up(s) * knee],
    liftFront: base.liftFront + up(c) * lift,
    liftBack: base.liftBack + up(-c) * lift,
    armFront: [base.armFront[0] - s * armAmp, base.armFront[1] + (run ? 40 : 6) * amount],
    armBack: [base.armBack[0] + s * armAmp, base.armBack[1] + (run ? 40 : 6) * amount],
  };
}

/** Two incommensurate sines: an organic sway that never visibly loops. Range about ±1. */
export function wave(t: number, speed: number, seed: number): number {
  return Math.sin(t * speed + seed) * 0.65 + Math.sin(t * speed * 1.618 + seed * 2.3 + 1.3) * 0.35;
}

/** Deterministic PRNG so every render of a frame is identical (Remotion renders frames in parallel). */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Quintic ease: zero velocity and acceleration at both ends, half the peak acceleration of `easeInOut`. */
export const smootherstep = (t: number) => t * t * t * (t * (6 * t - 15) + 10);
export const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
