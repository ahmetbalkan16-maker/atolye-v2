import { POSE_ANGLES } from "../../character/CharacterPose";
import type { LimbAngles, PoseAngles } from "../../character/CharacterRig";
import type { BlockedCharacter, SceneBlocking } from "../../character/SceneBlocking";
import type { CharacterFrameOverride } from "../../character/SvgSceneRenderer";

/**
 * Atölye stick-figure animation — what each figure does while its scene is on screen.
 *
 * A plan names one action per figure from a closed set. Each action is a short loop or a one-way move between the
 * engine's own poses, interpolated as joint angles, so a figure walks, talks, points, swings a sword or falls instead
 * of standing still. Everything here is plain arithmetic on the time of the frame: the same plan, blocking and time
 * always give the same frame, whatever the scene's length.
 *
 * Walking and running move a figure towards `toX` at a fixed pace, so the motion looks the same in a short scene and a
 * long one; a figure that arrives stops and stands.
 */
export const CHARACTER_ANIMATION_SCHEMA_VERSION = "1" as const;
/** Frames drawn per second. 15 doubles evenly into the 30 fps scene video. */
export const CHARACTER_ANIMATION_FPS = 15 as const;

export const CHARACTER_ACTIONS = Object.freeze([
  "IDLE", "WALK", "RUN", "TALK", "POINT", "CHEER", "FIGHT", "BOW", "KNEEL_DOWN", "FALL", "SIT",
] as const);
export type CharacterAction = (typeof CHARACTER_ACTIONS)[number];
const MOVING_ACTIONS: ReadonlySet<CharacterAction> = new Set(["WALK", "RUN"]);

export interface CharacterActorPlan {
  readonly id: string;
  readonly action: CharacterAction;
  /** Where a walking or running figure stops, as a fraction of the stage width. `null` for every other action. */
  readonly toX: number | null;
  /** Seconds before the action begins. For FALL it is the moment of the fall. */
  readonly delaySeconds: number;
}

export interface CharacterAnimationPlan {
  readonly schemaVersion: typeof CHARACTER_ANIMATION_SCHEMA_VERSION;
  readonly fps: typeof CHARACTER_ANIMATION_FPS;
  readonly actors: readonly CharacterActorPlan[];
}

export const CHARACTER_ANIMATION_LIMITS = Object.freeze({ maxDelaySeconds: 30, maxSceneSeconds: 600 });

/** Stage widths per second. */
const PACE: Readonly<Record<"WALK" | "RUN", number>> = Object.freeze({ WALK: 0.075, RUN: 0.2 });
/** Seconds per full stride. */
const STRIDE: Readonly<Record<"WALK" | "RUN", number>> = Object.freeze({ WALK: 0.9, RUN: 0.5 });

const STRIKE: PoseAngles = Object.freeze({
  torsoLean: 16, armFront: { upper: 70, bend: 8 }, armBack: { upper: -30, bend: -20 },
  legFront: { upper: 30, bend: -10 }, legBack: { upper: -26, bend: 12 }, bodyRotation: 0,
});

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const fraction = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

export function isCharacterAction(value: unknown): value is CharacterAction {
  return typeof value === "string" && (CHARACTER_ACTIONS as readonly string[]).includes(value);
}

/** Every problem with a plan for this blocking. An empty list means every frame of it can be drawn. */
export function findCharacterAnimationProblems(value: unknown, blocking: SceneBlocking): string[] {
  if (!plain(value) || Object.keys(value).some((key) => !["schemaVersion", "fps", "actors"].includes(key))) return ["ANIMATION_SHAPE"];
  const problems: string[] = [];
  if (value.schemaVersion !== CHARACTER_ANIMATION_SCHEMA_VERSION) problems.push("ANIMATION_SCHEMA_VERSION");
  if (value.fps !== CHARACTER_ANIMATION_FPS) problems.push("ANIMATION_FPS");
  if (!Array.isArray(value.actors) || value.actors.length > blocking.characters.length) return [...problems, "ANIMATION_ACTORS"];
  const characters = new Map(blocking.characters.map((item) => [item.id, item]));
  const seen = new Set<string>();
  for (const [index, actor] of value.actors.entries()) {
    const character = plain(actor) && typeof actor.id === "string" ? characters.get(actor.id) : undefined;
    const keysOk = plain(actor) && Object.keys(actor).length === 4 && ["id", "action", "toX", "delaySeconds"].every((key) => Object.hasOwn(actor, key));
    if (!keysOk || !character || seen.has(character.id) || !isCharacterAction(actor.action) ||
        typeof actor.delaySeconds !== "number" || !Number.isFinite(actor.delaySeconds) || actor.delaySeconds < 0 || actor.delaySeconds > CHARACTER_ANIMATION_LIMITS.maxDelaySeconds) {
      problems.push(`ACTOR:${index}`);
      continue;
    }
    seen.add(character.id);
    const moving = MOVING_ACTIONS.has(actor.action as CharacterAction);
    if (moving ? !fraction(actor.toX) : actor.toX !== null) { problems.push(`ACTOR_TARGET:${index}`); continue; }
    // A figure walks the way it faces: a mirrored walk would read as moonwalking.
    if (moving && (actor.toX as number) !== character.x && ((actor.toX as number) > character.x) !== (character.facing === "RIGHT")) problems.push(`ACTOR_DIRECTION:${index}`);
  }
  return problems;
}

/** How many frames a scene of this length needs so the frames cover it to the end. */
export function characterAnimationFrameCount(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > CHARACTER_ANIMATION_LIMITS.maxSceneSeconds) {
    throw new Error("CHARACTER_ANIMATION_DURATION_INVALID");
  }
  return Math.ceil(durationSeconds * CHARACTER_ANIMATION_FPS) + 1;
}

/** Each figure's frame at time `t` seconds. A figure without a plan entry breathes in its blocked pose. */
export function characterAnimationFrame(
  blocking: SceneBlocking,
  plan: CharacterAnimationPlan,
  t: number,
): Record<string, CharacterFrameOverride> {
  const actors = new Map(plan.actors.map((actor) => [actor.id, actor]));
  const frames: Record<string, CharacterFrameOverride> = {};
  for (const character of blocking.characters) frames[character.id] = frameOf(character, actors.get(character.id), t);
  return frames;
}

function frameOf(character: BlockedCharacter, actor: CharacterActorPlan | undefined, t: number): CharacterFrameOverride {
  const base = POSE_ANGLES[character.pose];
  const phase = phaseOf(character.id);
  const still = (pose: PoseAngles, x = character.x): CharacterFrameOverride => ({ pose: breathe(pose, t, phase), x, mouthOpen: false });
  if (!actor || actor.action === "IDLE") return still(base);
  const u = t - actor.delaySeconds;
  const standing = uprightPose(base);
  switch (actor.action) {
    case "WALK":
    case "RUN": {
      const kind = actor.action;
      const target = actor.toX ?? character.x;
      const travel = Math.abs(target - character.x) / PACE[kind];
      if (u <= 0) return still(standing);
      if (u >= travel) return still(standing, target);
      const x = character.x + (target - character.x) * (u / travel);
      const stride = POSE_ANGLES[kind];
      // Half a stride per swing: the stride pose, then its mirror, then back.
      return { pose: mix(stride, mirror(stride), swing(u / STRIDE[kind])), x, mouthOpen: false };
    }
    case "TALK": {
      if (u <= 0) return still(standing);
      // Speech comes in phrases: about two seconds of syllables, then a short pause.
      const speaking = u % 2.4 < 2.0 && Math.floor(u * 7) % 2 === 0;
      const gesture = swing(u / 1.8 + phase);
      const pose = breathe(standing, t, phase);
      return {
        pose: { ...pose, armFront: { upper: pose.armFront.upper + 34 * gesture, bend: pose.armFront.bend + 24 * gesture } },
        x: character.x, mouthOpen: speaking,
      };
    }
    case "POINT":
      return { pose: breathe(mix(standing, POSE_ANGLES.POINT, ease(u / 0.6)), t, phase), x: character.x, mouthOpen: false };
    case "CHEER":
      return { pose: mix(standing, POSE_ANGLES.ARMS_RAISED, u <= 0 ? 0 : swing(u / 1.1)), x: character.x, mouthOpen: u > 0 };
    case "FIGHT":
      return { pose: mix(POSE_ANGLES.SWORD_RAISED, STRIKE, u <= 0 ? 0 : swing(u / 0.9)), x: character.x, mouthOpen: false };
    case "BOW": {
      // Down, hold, up, rest: one bow every 3.2 seconds.
      const cycle = u <= 0 ? 3.1 : u % 3.2;
      const k = cycle < 0.8 ? ease(cycle / 0.8) : cycle < 2.0 ? 1 : cycle < 2.8 ? 1 - ease((cycle - 2.0) / 0.8) : 0;
      return { pose: mix(standing, POSE_ANGLES.BOW, k), x: character.x, mouthOpen: false };
    }
    case "KNEEL_DOWN":
      return u <= 0 ? still(standing) : { pose: breathe(mix(standing, POSE_ANGLES.KNEEL, ease(u / 1.0)), t, phase), x: character.x, mouthOpen: false };
    case "FALL":
      // The fall is a drop, not a glide: it accelerates into the ground and then lies still.
      return u <= 0 ? still(standing) : { pose: mix(standing, POSE_ANGLES.FALLEN, Math.min(1, (u / 0.7) ** 2)), x: character.x, mouthOpen: false };
    case "SIT":
      return still(POSE_ANGLES.SIT);
  }
}

/** A walking or running blocked pose stands up straight when the figure is not on the move. */
function uprightPose(pose: PoseAngles): PoseAngles {
  return pose === POSE_ANGLES.WALK || pose === POSE_ANGLES.RUN || pose === POSE_ANGLES.FALLEN ? POSE_ANGLES.STAND : pose;
}

/** A gentle rise and fall of the chest and arms, so a figure at rest is still alive. A fallen figure stays still. */
function breathe(pose: PoseAngles, t: number, phase: number): PoseAngles {
  if (pose.bodyRotation) return pose;
  const b = Math.sin(2 * Math.PI * (t / 3.2 + phase));
  return { ...pose, torsoLean: pose.torsoLean + 1.2 * b, armFront: limb(pose.armFront, 2.5 * b, 0), armBack: limb(pose.armBack, -2.5 * b, 0) };
}

function mirror(pose: PoseAngles): PoseAngles {
  return { ...pose, armFront: pose.armBack, armBack: pose.armFront, legFront: pose.legBack, legBack: pose.legFront };
}

function mix(a: PoseAngles, b: PoseAngles, k: number): PoseAngles {
  const at = (x: number, y: number) => x + (y - x) * k;
  const limbMix = (p: LimbAngles, q: LimbAngles): LimbAngles => ({ upper: at(p.upper, q.upper), bend: at(p.bend, q.bend) });
  return {
    torsoLean: at(a.torsoLean, b.torsoLean), bodyRotation: at(a.bodyRotation, b.bodyRotation),
    armFront: limbMix(a.armFront, b.armFront), armBack: limbMix(a.armBack, b.armBack),
    legFront: limbMix(a.legFront, b.legFront), legBack: limbMix(a.legBack, b.legBack),
  };
}

function limb(value: LimbAngles, upper: number, bend: number): LimbAngles {
  return { upper: value.upper + upper, bend: value.bend + bend };
}

/** 0 → 1 → 0 once per unit of `cycles`, smooth at both ends. */
function swing(cycles: number): number {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * cycles);
}

function ease(k: number): number {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
}

/** A fixed offset per figure, so two idle figures do not breathe in step. */
function phaseOf(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % 1000) / 1000;
}
