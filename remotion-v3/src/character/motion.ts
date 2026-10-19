import type { V3Effect, V3Emotion, V3Performer, V3Viseme } from "../../../src/lib/v3/render/RenderPlanTypes";
import { blendPose, easeInOut, gesturePose, HEAD_CY, HIP_Y, type Point, type Pose, REST_POSE, seededRandom, walkPose } from "./rig";

/** One step covers this much of the frame width. */
const STEP = 0.042;

export interface PerformerState {
  readonly visible: boolean;
  readonly x: number;
  readonly facing: "left" | "right";
  readonly pose: Pose;
  readonly emotion: V3Emotion;
  readonly viseme: V3Viseme;
  /** 0 open .. 1 closed. */
  readonly eyesClosed: number;
  readonly effects: readonly { readonly effect: V3Effect; readonly progress: number }[];
  readonly seated: boolean;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

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

function lastAtOrBefore<T extends { readonly frame: number } | { readonly start: number }>(items: readonly T[], frame: number): T | undefined {
  let found: T | undefined;
  for (const item of items) {
    const at = "frame" in item ? item.frame : item.start;
    if (at <= frame) found = item;
    else break;
  }
  return found;
}

export function performerState(p: V3Performer, frame: number, fps: number): PerformerState {
  const visible = !p.visible || (frame >= p.visible.from && frame < p.visible.to);

  // Position and walk cycle.
  let x = p.x;
  let facing = p.facing;
  for (const turn of p.turns ?? []) {
    if (turn.frame <= frame) facing = turn.facing;
    else break;
  }
  let walk: { phase: number; run: boolean } | undefined;
  for (const m of p.moves) {
    if (frame >= m.end) {
      x = m.toX;
      continue;
    }
    if (frame >= m.start) {
      const progress = easeInOut(clamp01((frame - m.start) / Math.max(1, m.end - m.start)));
      x = m.fromX + (m.toX - m.fromX) * progress;
      facing = m.toX >= m.fromX ? "right" : "left";
      walk = { phase: (Math.abs(x - m.fromX) / STEP) * Math.PI, run: !!m.run };
    }
    break;
  }

  // Idle breathing and talking.
  const t = frame / fps;
  const seedPhase = (p.castId.charCodeAt(0) % 7) * 0.9;
  let pose: Pose = {
    ...REST_POSE,
    squash: 1 + 0.012 * Math.sin((2 * Math.PI * t) / 3.1 + seedPhase),
    headTilt: 1.6 * Math.sin((2 * Math.PI * t) / 4.3 + seedPhase),
    armFront: [9 + 1.5 * Math.sin(t * 1.7 + seedPhase), 8],
    armBack: [9 + 1.5 * Math.sin(t * 1.5 + seedPhase + 1), 8],
  };
  if (p.seated) pose = { ...pose, legFront: [24, -24], legBack: [24, -24] };
  const speaking = p.speaking.some((s) => frame >= s.start && frame < s.end);
  if (speaking) pose = { ...pose, headTilt: pose.headTilt + 3.2 * Math.sin(t * 13.5), bob: pose.bob - Math.abs(Math.sin(t * 6.8)) * 2.5 };
  if (walk) pose = walkPose(pose, walk.phase, walk.run);

  // Gestures, each with a short attack and release.
  const attack = Math.max(2, Math.round(fps * 0.2));
  const release = Math.max(2, Math.round(fps * 0.25));
  for (const g of p.gestures) {
    if (frame < g.start || frame > g.end) continue;
    const w = easeInOut(clamp01((frame - g.start) / attack) * clamp01((g.end - frame) / release));
    const aimBack = g.toward !== undefined && g.toward !== facing;
    let target = gesturePose(g.gesture, (frame - g.start) / fps, pose, aimBack);
    if (g.gesture === "sasir") {
      const jump = clamp01((frame - g.start) / (fps * 0.45));
      target = { ...target, bob: target.bob - 34 * Math.sin(Math.PI * jump) };
    }
    pose = blendPose(pose, target, w);
  }

  const face = lastAtOrBefore(p.faces, frame);
  const vis = speaking ? lastAtOrBefore(p.visemes, frame) : undefined;

  // Blinks: 2–6 s apart, five frames each; closed eyes never stick between shots.
  let eyesClosed = 0;
  for (const b of blinkStarts(p.castId, fps, frame)) {
    if (b > frame) break;
    const k = frame - b;
    if (k < 5) eyesClosed = [0.55, 1, 1, 0.6, 0.2][k]!;
  }

  const effects = p.effects
    .filter((e) => frame >= e.start && frame < e.end)
    .map((e) => ({ effect: e.effect, progress: (frame - e.start) / Math.max(1, e.end - e.start) }));

  return { visible, x, facing, pose, emotion: face?.emotion ?? "notr", viseme: vis?.viseme ?? "X", eyesClosed, effects, seated: !!p.seated };
}

/** Head centre in character space after lean/bob/squash, for overlays drawn outside the mirrored group. */
export function headCenter(pose: Pose): Point {
  const a = (pose.lean * Math.PI) / 180;
  const dy = HEAD_CY - HIP_Y;
  const x = -Math.sin(-a) * dy * -1;
  const y = HIP_Y + Math.cos(a) * dy;
  return { x: x * (1 / Math.sqrt(pose.squash)), y: (y + pose.bob) * pose.squash };
}
