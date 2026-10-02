import type { PoseAngles } from "./CharacterRig";

/** Stage 15J — the poses a character can take. A closed set: a scene names one, it never supplies raw angles. */
export const CHARACTER_POSES = Object.freeze(["STAND", "WALK", "RUN", "POINT", "ARMS_RAISED", "SWORD_RAISED", "BOW", "KNEEL", "SIT", "FALLEN"] as const);
export type CharacterPose = (typeof CHARACTER_POSES)[number];

const limb = (upper: number, bend = 0) => ({ upper, bend });

export const POSE_ANGLES: Readonly<Record<CharacterPose, PoseAngles>> = Object.freeze({
  STAND: { torsoLean: 0, armFront: limb(8), armBack: limb(-8), legFront: limb(6), legBack: limb(-6), bodyRotation: 0 },
  WALK: { torsoLean: 4, armFront: limb(-24, 12), armBack: limb(26, 14), legFront: limb(24, -10), legBack: limb(-22, 18), bodyRotation: 0 },
  RUN: { torsoLean: 16, armFront: limb(-50, 70), armBack: limb(48, 60), legFront: limb(52, -40), legBack: limb(-40, 60), bodyRotation: 0 },
  POINT: { torsoLean: 2, armFront: limb(88, 4), armBack: limb(-10), legFront: limb(8), legBack: limb(-8), bodyRotation: 0 },
  ARMS_RAISED: { torsoLean: 0, armFront: limb(150, 12), armBack: limb(-150, -12), legFront: limb(10), legBack: limb(-10), bodyRotation: 0 },
  SWORD_RAISED: { torsoLean: 6, armFront: limb(140, 20), armBack: limb(-30, -20), legFront: limb(26, -8), legBack: limb(-24, 10), bodyRotation: 0 },
  BOW: { torsoLean: 48, armFront: limb(30, 10), armBack: limb(20, 10), legFront: limb(4), legBack: limb(-4), bodyRotation: 0 },
  KNEEL: { torsoLean: 6, armFront: limb(20, 30), armBack: limb(-6, 10), legFront: limb(84, -84), legBack: limb(-4, -86), bodyRotation: 0 },
  SIT: { torsoLean: -4, armFront: limb(30, 40), armBack: limb(10, 30), legFront: limb(86, -84), legBack: limb(80, -80), bodyRotation: 0 },
  FALLEN: { torsoLean: 0, armFront: limb(30, 10), armBack: limb(-40, -10), legFront: limb(14), legBack: limb(-10), bodyRotation: 88 },
});

export function isCharacterPose(value: unknown): value is CharacterPose {
  return typeof value === "string" && (CHARACTER_POSES as readonly string[]).includes(value);
}
