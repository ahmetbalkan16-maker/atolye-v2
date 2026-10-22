import type { V3Effect, V3Emotion, V3Performer, V3Viseme } from "../../../src/lib/v3/render/RenderPlanTypes";
import { followThrough, type SpringSpec } from "./dynamics";
import { blendPose, gesturePose, HEAD_CY, HIP_Y, type Point, type Pose, REST_POSE, seededRandom, smootherstep, walkPose, wave } from "./rig";

/** One step covers this much of the frame width. */
/** Stage x covered by half a stride (one footfall). */
export const STEP = 0.042;

export interface PerformerState {
  readonly visible: boolean;
  readonly x: number;
  readonly facing: "left" | "right";
  /** Horizontal mirror, -1 facing left .. 1 facing right; passes through 0 in the frames of a turn. */
  readonly mirror: number;
  readonly pose: Pose;
  readonly emotion: V3Emotion;
  /** Brows slide from one expression to the next around a change instead of jumping. */
  readonly brows: { readonly from: V3Emotion; readonly to: V3Emotion; readonly mix: number };
  readonly viseme: V3Viseme;
  /** 0 open .. 1 closed. */
  readonly eyesClosed: number;
  readonly effects: readonly { readonly effect: V3Effect; readonly progress: number }[];
  readonly seated: boolean;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (t: number) => t * t * (3 - 2 * t);
/** Smooth 0 → 1 → 0 hump over u in 0..1. */
const bump = (u: number) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) ** 2);

/** Eyelid closure over the five frames of a blink. */
const BLINK = [0.55, 1, 1, 0.6, 0.2] as const;

const blinkCache = new Map<string, number[]>();

function blinkStarts(seed: string, fps: number, untilFrame: number): number[] {
  let list = blinkCache.get(seed);
  if (!list) {
    list = [];
    blinkCache.set(seed, list);
  }
  if (list.length === 0 || list[list.length - 1]! < untilFrame) {
    const rnd = seededRandom(`${seed}:${list.length}`);
    let at = list.length ? list[list.length - 1]! : Math.round(fps * (0.6 + rnd() * 1.8));
    if (!list.length) list.push(at);
    while (at < untilFrame + fps * 8) {
      at += Math.round(fps * (2 + rnd() * 4));
      list.push(at);
    }
  }
  return list;
}

/** Index of the last item at or before `frame` (items are sorted by time), or -1. */
function lastAtOrBefore(items: readonly ({ readonly frame: number } | { readonly start: number })[], frame: number): number {
  let lo = 0, hi = items.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const item = items[mid]!;
    if (("frame" in item ? item.frame : item.start) <= frame) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

const isSpeaking = (p: V3Performer, frame: number) => p.speaking.some((s) => frame >= s.start && frame < s.end);

/** A walk faces where it goes; otherwise the latest turn counts. */
function facingAt(p: V3Performer, frame: number): "left" | "right" {
  for (const m of p.moves) {
    if (frame >= m.end) continue;
    if (frame >= m.start) return m.toX >= m.fromX ? "right" : "left";
    break;
  }
  let facing = p.facing;
  for (const turn of p.turns ?? []) {
    if (turn.frame <= frame) facing = turn.facing;
    else break;
  }
  return facing;
}

/**
 * Share of a move covered at `u` (0..1): a steady cruising speed with short smooth accelerations at each end,
 * so the stride stays even instead of racing through the middle of an eased move.
 */
function travel(u: number, ramp: number): number {
  const peak = 1 / (1 - ramp);
  const rampArea = (x: number) => x * x * x - (x * x * x * x) / 2; // ∫ smoothstep
  if (u <= ramp) return peak * ramp * rampArea(u / ramp);
  if (u >= 1 - ramp) return 1 - peak * ramp * rampArea((1 - u) / ramp);
  return peak * (ramp / 2 + u - ramp);
}

function placeAt(p: V3Performer, frame: number, fps: number): { x: number; walk?: { phase: number; run: boolean; amount: number } } {
  let x = p.x;
  for (const m of p.moves) {
    if (frame >= m.end) {
      x = m.toX;
      continue;
    }
    if (frame >= m.start) {
      const span = Math.max(1, m.end - m.start);
      x = m.fromX + (m.toX - m.fromX) * travel(clamp01((frame - m.start) / span), Math.min(0.35, (fps * 0.3) / span));
      const ease = fps * 0.3;
      const amount = smootherstep(clamp01((frame - m.start) / ease)) * smootherstep(clamp01((m.end - frame) / ease));
      return { x, walk: { phase: (Math.abs(x - m.fromX) / STEP) * Math.PI, run: !!m.run, amount } };
    }
    break;
  }
  return { x };
}

/** How open each Rhubarb mouth shape is; speech nods ride on it. */
const OPEN: Record<V3Viseme, number> = { A: 0.05, B: 0.35, C: 0.6, D: 1, E: 0.55, F: 0.3, G: 0.2, H: 0.45, X: 0 };

const ANTICIPATION_S = 0.15;

/** Largest joint travel between two poses, in degrees: bigger moves are given more time. */
function reachOf(a: Pose, b: Pose): number {
  return Math.max(
    Math.abs(b.armFront[0] - a.armFront[0]),
    Math.abs(b.armFront[1] - a.armFront[1]),
    Math.abs(b.armBack[0] - a.armBack[0]),
    Math.abs(b.armBack[1] - a.armBack[1]),
    3 * Math.abs(b.lean - a.lean),
  );
}

/** Pulls a pose a little away from where a gesture is heading (k 0..1), with a slight crouch. */
function anticipate(pose: Pose, from: Pose, to: Pose, k: number): Pose {
  const away = (a: number, b: number) => Math.max(-18, Math.min(18, (a - b) * 0.12)) * k;
  return {
    ...pose,
    lean: pose.lean + 2 * away(from.lean, to.lean),
    squash: pose.squash - 0.03 * k,
    armFront: [pose.armFront[0] + away(from.armFront[0], to.armFront[0]), pose.armFront[1] + away(from.armFront[1], to.armFront[1])],
    armBack: [pose.armBack[0] + away(from.armBack[0], to.armBack[0]), pose.armBack[1] + away(from.armBack[1], to.armBack[1])],
  };
}

/** The acted pose at a frame, before follow-through: idle life, speech, walking and gestures. */
function actedPose(p: V3Performer, frame: number, fps: number): Pose {
  const facing = facingAt(p, frame);
  const { walk } = placeAt(p, frame, fps);
  const t = frame / fps;
  const seed = (p.castId.charCodeAt(0) % 7) * 0.9;
  // Idle: breathing, a slow weight shift and drifting arms.
  let pose: Pose = {
    ...REST_POSE,
    lean: 0.8 * wave(t, 0.9, seed),
    squash: 1 + 0.012 * Math.sin((2 * Math.PI * t) / 3.1 + seed),
    headTilt: 1.6 * wave(t, 1.45, seed),
    armFront: [9 + 1.5 * wave(t, 1.7, seed), 8 + wave(t, 1.3, seed + 2)],
    armBack: [9 + 1.5 * wave(t, 1.5, seed + 1), 8 + wave(t, 1.1, seed + 3)],
  };
  if (p.seated) pose = { ...pose, legFront: [24, -24], legBack: [24, -24] };
  if (isSpeaking(p, frame)) {
    // The head rides the syllables: an open mouth lifts the chin, and the springs round the steps into nods.
    const i = lastAtOrBefore(p.visemes, frame);
    const open = OPEN[i >= 0 ? p.visemes[i]!.viseme : "X"];
    pose = { ...pose, headTilt: pose.headTilt - 3 * open + 1.4 * wave(t, 2.3, seed), bob: pose.bob - 2.4 * open };
  }
  if (walk) pose = walkPose(pose, walk.phase, walk.run, walk.amount);

  // Gestures: an anticipation against the coming move, a quintic ease in timed by how far the limbs travel and
  // a softer ease out. The follow-through springs add the overshoot and the settle.
  const antic = Math.max(2, Math.round(fps * ANTICIPATION_S));
  for (const g of p.gestures) {
    if (frame < g.start - antic || frame > g.end) continue;
    const aimBack = g.toward !== undefined && g.toward !== facing;
    const target = gesturePose(g.gesture, Math.max(0, frame - g.start) / fps, pose, aimBack);
    const reach = reachOf(pose, target);
    const attack = fps * Math.min(0.6, Math.max(0.28, 0.2 + reach / 400));
    const release = fps * Math.min(0.6, Math.max(0.3, 0.22 + reach / 450));
    const w = smootherstep(clamp01((frame - g.start) / attack)) * smootherstep(clamp01((g.end - frame) / release));
    const before = pose;
    pose = blendPose(pose, target, w);
    const k = bump((frame - (g.start - antic)) / (2 * antic));
    if (k > 0) pose = anticipate(pose, before, target, k);
    if (g.gesture === "sasir" && frame >= g.start) {
      // The jump is its own arc on top of the pose, so the slower arm ease does not flatten it.
      pose = { ...pose, bob: pose.bob - 34 * Math.sin(Math.PI * clamp01((frame - g.start) / (fps * 0.45))) };
    }
  }
  return pose;
}

/** Follow-through channels: lean, bob, squash, head, upper arms (back, front), forearms (back, front). */
const SPRINGS: readonly SpringSpec[] = [
  { hz: 2.6, zeta: 0.75 },
  { hz: 6, zeta: 0.85 },
  // A little jelly: a crouch springs back into a stretch.
  { hz: 3.5, zeta: 0.45 },
  // The head trails the body.
  { hz: 2.2, zeta: 0.5 },
  // Upper arms lead, forearms follow through and overshoot a touch more.
  { hz: 2.8, zeta: 0.62 },
  { hz: 2.8, zeta: 0.62 },
  { hz: 2.1, zeta: 0.5 },
  { hz: 2.1, zeta: 0.5 },
];
const channels = (q: Pose): number[] => [q.lean, q.bob, q.squash, q.headTilt, q.armBack[0], q.armFront[0], q.armBack[1], q.armFront[1]];
const WARMUP_S = 1.5;
/** Frames on each side of a facing change: a turn is a seven-frame in-between. */
const TURN = 3;

export function performerState(p: V3Performer, frame: number, fps: number): PerformerState {
  const visible = !p.visible || (frame >= p.visible.from && frame < p.visible.to);
  const facing = facingAt(p, frame);
  const { x } = placeAt(p, frame, fps);

  const acted = actedPose(p, frame, fps);
  const sim = followThrough((f) => channels(f === frame ? acted : actedPose(p, f, fps)), frame, fps, SPRINGS, Math.round(fps * WARMUP_S));
  const [lean, bob, squash, headTilt, backUpper, frontUpper, backFore, frontFore] = sim.value as [number, number, number, number, number, number, number, number];
  // A quick lean leaves the head a little behind.
  const pose: Pose = {
    ...acted,
    lean,
    bob,
    squash,
    headTilt: headTilt - sim.velocity[0]! * 0.03,
    armBack: [backUpper, backFore],
    armFront: [frontUpper, frontFore],
  };

  let mirror = 0;
  for (let f = frame - TURN; f <= frame + TURN; f++) mirror += facingAt(p, f) === "left" ? -1 : 1;
  mirror /= 2 * TURN + 1;

  const fi = lastAtOrBefore(p.faces, frame);
  const emotion = fi >= 0 ? p.faces[fi]!.emotion : "notr";
  const speaking = isSpeaking(p, frame);
  const vi = speaking ? lastAtOrBefore(p.visemes, frame) : -1;

  // Expression changes: the brows slide over six frames around the change, and the eyes blink through it so the
  // eye and mouth shapes swap while the eyes are closed.
  let brows: PerformerState["brows"] = { from: emotion, to: emotion, mix: 1 };
  let eyesClosed = 0;
  for (let i = Math.max(1, fi); i <= fi + 1 && i < p.faces.length; i++) {
    const change = p.faces[i]!, prev = p.faces[i - 1]!;
    if (change.emotion === prev.emotion) continue;
    const k = frame - (change.start - 2);
    if (k >= 0 && k < 6) brows = { from: prev.emotion, to: change.emotion, mix: smoothstep(k / 5) };
    if (k >= 0 && k < BLINK.length) eyesClosed = Math.max(eyesClosed, BLINK[k]!);
  }

  // Blinks: 2–6 s apart, five frames each; closed eyes never stick between shots.
  for (const b of blinkStarts(p.castId, fps, frame)) {
    if (b > frame) break;
    const k = frame - b;
    if (k < BLINK.length) eyesClosed = Math.max(eyesClosed, BLINK[k]!);
  }

  const effects = p.effects
    .filter((e) => frame >= e.start && frame < e.end)
    .map((e) => ({ effect: e.effect, progress: (frame - e.start) / Math.max(1, e.end - e.start) }));

  return {
    visible,
    x,
    facing,
    mirror,
    pose,
    emotion,
    brows,
    viseme: vi >= 0 ? p.visemes[vi]!.viseme : "X",
    eyesClosed,
    effects,
    seated: !!p.seated,
  };
}

/** Vertical stretch while a turn squeezes through its in-between, like a drawn turnaround. */
export const turnStretch = (mirror: number) => 1 + 0.05 * (1 - Math.abs(mirror));

/** Head centre in character space after lean/bob/squash, for overlays drawn outside the mirrored group. */
export function headCenter(pose: Pose): Point {
  const a = (pose.lean * Math.PI) / 180;
  const dy = HEAD_CY - HIP_Y;
  const x = -Math.sin(-a) * dy * -1;
  const y = HIP_Y + Math.cos(a) * dy;
  return { x: x * (1 / Math.sqrt(pose.squash)), y: (y + pose.bob) * pose.squash };
}
