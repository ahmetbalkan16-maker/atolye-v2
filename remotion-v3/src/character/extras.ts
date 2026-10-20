import type { V3Emotion, V3Extra } from "../../../src/lib/v3/render/RenderPlanTypes";
import type { PerformerState } from "./motion";
import { type Pose, REST_POSE } from "./rig";

/**
 * A crowd member's state for one frame, computed directly (no motion history: a crowd of forty must stay cheap).
 * Idle: a slow sway and breath; cheering: arms up, bouncing; scared: a cower and a tremble. Blinks are seeded per
 * extra so the crowd never blinks in step.
 */
export function extraState(e: V3Extra, frame: number, fps: number): PerformerState {
  const t = frame / fps;
  const ph = ((e.seed % 1000) / 1000) * Math.PI * 2;
  const sway = Math.sin(t * 1.2 + ph);
  let pose: Pose = { ...REST_POSE, lean: sway * 1.4, headTilt: Math.sin(t * 0.9 + ph * 1.7) * 3.5, bob: Math.sin(t * 2.1 + ph) * 1.5 };
  let emotion: V3Emotion = "notr";
  if (e.mood === "coskulu") {
    const wave = Math.sin(t * 7 + ph);
    pose = { ...pose, armFront: [155 + wave * 10, 12], armBack: [150 - wave * 10, 12], handFront: "yumruk", handBack: "yumruk", bob: -Math.abs(Math.sin(t * 5.5 + ph)) * 12 };
    emotion = "mutlu";
  } else if (e.mood === "korkmus") {
    pose = { ...pose, lean: -6 + Math.sin(t * 22 + ph) * 1.2, armFront: [40, 70], armBack: [40, 70], squash: 0.97 };
    emotion = "korkmus";
  }
  // A blink of four frames every 3–5 seconds.
  const period = Math.round(fps * (3 + (e.seed % 200) / 100));
  const k = (frame + (e.seed % period)) % period;
  const mirror = e.facing === "right" ? 1 : -1;
  return {
    visible: true,
    x: e.x,
    facing: e.facing,
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
