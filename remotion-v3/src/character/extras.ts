import type { V3Emotion, V3Extra } from "../../../src/lib/v3/render/RenderPlanTypes";
import { type PerformerState, STEP } from "./motion";
import { type Pose, REST_POSE, smootherstep, walkPose } from "./rig";

/**
 * Where a marching extra is at a frame, and its stride: a steady pace with short eases at both ends (the same feel as
 * an actor's walk). Off the stage it is no longer drawn.
 */
function marching(e: V3Extra, frame: number, fps: number): { x: number; walk?: { phase: number; run: boolean; amount: number } } {
  const m = e.move;
  if (!m || frame < m.start) return { x: e.x };
  if (frame >= m.end) return { x: m.toX };
  const u = (frame - m.start) / Math.max(1, m.end - m.start);
  const x = e.x + (m.toX - e.x) * u;
  const ease = fps * 0.3;
  const amount = smootherstep(Math.min(1, (frame - m.start) / ease)) * smootherstep(Math.min(1, (m.end - frame) / ease));
  return { x, walk: { phase: (Math.abs(x - e.x) / STEP) * Math.PI + (e.seed % 7), run: m.run, amount } };
}

/**
 * A crowd member's state for one frame, computed directly (no motion history: a crowd of forty must stay cheap).
 * Idle: a slow sway and breath; cheering: arms up, bouncing; scared: a cower and a tremble. Blinks are seeded per
 * extra so the crowd never blinks in step.
 */
/** Faces of a calm crowd, so copies of one costume do not look like clones (picked by each extra's seed). */
const CALM_FACES: readonly V3Emotion[] = ["notr", "notr", "kararli", "mutlu", "notr", "saskin", "kararli", "notr"];

/** How far into a cheer window a frame is (0 outside, easing up to 1 and back down at its ends). */
function cheering(e: V3Extra, frame: number, fps: number): number {
  for (const c of e.cheers ?? []) {
    if (frame < c.start || frame >= c.end) continue;
    const ease = fps * 0.25;
    return smootherstep(Math.min(1, (frame - c.start) / ease)) * smootherstep(Math.min(1, (c.end - frame) / ease));
  }
  return 0;
}

export function extraState(e: V3Extra, frame: number, fps: number): PerformerState {
  const t = frame / fps;
  const ph = ((e.seed % 1000) / 1000) * Math.PI * 2;
  const sway = Math.sin(t * 1.2 + ph);
  // Each extra stands a little differently: arms a few degrees apart, a slow weight shift at its own pace, an
  // occasional look around (owner, 22 Oct 2026: the legion stood like identical stiff copies).
  const armVar = ((e.seed >> 3) % 9) - 4;
  const hand = e.grip ? "yumruk" : "acik";
  let pose: Pose = {
    ...REST_POSE,
    lean: sway * 1.4 + Math.sin(t * 0.37 + ph * 2.3) * 1.2,
    headTilt: Math.sin(t * 0.9 + ph * 1.7) * 3.5 + (Math.sin(t * 0.21 + ph * 3.1) > 0.92 ? 6 : 0),
    bob: Math.sin(t * 2.1 + ph) * 1.5,
    armFront: [REST_POSE.armFront[0] + armVar, REST_POSE.armFront[1] + Math.abs(armVar)],
    armBack: [REST_POSE.armBack[0] - armVar / 2, REST_POSE.armBack[1]],
    handFront: hand,
    handBack: hand,
  };
  let emotion: V3Emotion = e.mood === "notr" ? CALM_FACES[e.seed % CALM_FACES.length]! : "notr";
  // A rallying cry: the crowd cheers for a moment, fists up, then settles back.
  const cheer = e.mood === "korkmus" ? 0 : cheering(e, frame, fps);
  if (cheer > 0 && e.mood !== "coskulu") {
    const wave = Math.sin(t * 7 + ph);
    const up: Pose = { ...pose, armFront: [150 + wave * 12, 14], armBack: [140 - wave * 10, 14], handFront: "yumruk", handBack: "yumruk", bob: -Math.abs(Math.sin(t * 6 + ph)) * 12 };
    pose = cheer >= 1 ? up : { ...pose, armFront: [pose.armFront[0] + (up.armFront[0] - pose.armFront[0]) * cheer, pose.armFront[1]], armBack: [pose.armBack[0] + (up.armBack[0] - pose.armBack[0]) * cheer, pose.armBack[1]], handFront: cheer > 0.5 ? "yumruk" : pose.handFront, handBack: cheer > 0.5 ? "yumruk" : pose.handBack, bob: up.bob * cheer };
    if (cheer > 0.3) emotion = "mutlu";
  }
  if (e.mood === "coskulu") {
    const wave = Math.sin(t * 7 + ph);
    pose = { ...pose, armFront: [155 + wave * 10, 12], armBack: [150 - wave * 10, 12], handFront: "yumruk", handBack: "yumruk", bob: -Math.abs(Math.sin(t * 5.5 + ph)) * 12 };
    emotion = "mutlu";
  } else if (e.mood === "korkmus") {
    pose = { ...pose, lean: -6 + Math.sin(t * 22 + ph) * 1.2, armFront: [40, 70], armBack: [40, 70], squash: 0.97 };
    emotion = "korkmus";
  }
  // On the march: legs and arms swing, the body leans into the step and faces where it goes.
  const go = marching(e, frame, fps);
  let facing = e.facing;
  if (go.walk) {
    pose = walkPose(pose, go.walk.phase, go.walk.run, go.walk.amount);
    facing = e.move!.toX >= e.x ? "right" : "left";
  }
  // A blink of four frames every 3–5 seconds.
  const period = Math.round(fps * (3 + (e.seed % 200) / 100));
  const k = (frame + (e.seed % period)) % period;
  const mirror = facing === "right" ? 1 : -1;
  return {
    visible: go.x > -0.2 && go.x < 1.2,
    x: go.x,
    facing,
    mirror,
    pose,
    emotion,
    brows: { from: emotion, to: emotion, mix: 1 },
    viseme: e.mood === "coskulu" ? "D" : "X",
    eyesClosed: k < 4 ? [0.5, 1, 1, 0.5][k]! : 0,
    effects: [],
    seated: false,
  };
}
