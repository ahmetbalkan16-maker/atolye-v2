/**
 * Stage 15J — the stick-figure rig: the bones of one character and their lengths.
 *
 * One rig, in pixels at scale 1 on a 1920x1080 stage. A pose turns the bones; the renderer draws them. Everything
 * here is plain numbers, so the same rig, pose and position always give the same joints.
 */
export interface CharacterRig {
  readonly id: string;
  readonly headRadius: number;
  readonly neck: number;
  readonly torso: number;
  readonly upperArm: number;
  readonly lowerArm: number;
  readonly upperLeg: number;
  readonly lowerLeg: number;
  readonly stroke: number;
}

export const STICK_FIGURE_RIG: CharacterRig = Object.freeze({ id: "stick-figure-v1", headRadius: 38, neck: 14, torso: 150, upperArm: 70, lowerArm: 68, upperLeg: 92, lowerLeg: 92, stroke: 10 });

export interface Point { readonly x: number; readonly y: number }
export interface CharacterJoints {
  readonly head: Point; readonly neck: Point; readonly shoulder: Point; readonly hip: Point;
  readonly elbowFront: Point; readonly handFront: Point; readonly elbowBack: Point; readonly handBack: Point;
  readonly kneeFront: Point; readonly footFront: Point; readonly kneeBack: Point; readonly footBack: Point;
}

/** Angles in degrees. 0 points straight down; a positive angle swings the bone towards the way the character faces. */
export interface LimbAngles { readonly upper: number; readonly bend: number }
export interface PoseAngles {
  /** Lean of the torso from upright; positive leans the way the character faces. */
  readonly torsoLean: number;
  readonly armFront: LimbAngles; readonly armBack: LimbAngles;
  readonly legFront: LimbAngles; readonly legBack: LimbAngles;
  /** Turn of the whole figure around its ground point: 90 lays it on the ground. */
  readonly bodyRotation: number;
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const step = (from: Point, length: number, angle: number): Point => ({ x: from.x + length * Math.sin(radians(angle)), y: from.y + length * Math.cos(radians(angle)) });

/**
 * The joints of a character standing at `ground` (its ground point), facing right, at `scale`. The lower foot rests
 * on the ground line: a kneeling or sitting pose lowers the hip instead of sinking the feet.
 */
export function computeCharacterJoints(rig: CharacterRig, pose: PoseAngles, ground: Point, scale: number): CharacterJoints {
  const leg = (angles: LimbAngles) => {
    const knee = step({ x: 0, y: 0 }, rig.upperLeg * scale, angles.upper);
    const foot = step(knee, rig.lowerLeg * scale, angles.upper + angles.bend);
    return { knee, foot };
  };
  const front = leg(pose.legFront); const back = leg(pose.legBack);
  const drop = Math.max(front.foot.y, back.foot.y, 0);
  const hip: Point = { x: ground.x, y: ground.y - drop };
  const at = (point: Point): Point => ({ x: hip.x + point.x, y: hip.y + point.y });
  // The torso rises from the hip: straight up is 180 degrees.
  const shoulder = step(hip, rig.torso * scale, 180 - pose.torsoLean);
  const neck = step(shoulder, rig.neck * scale, 180 - pose.torsoLean);
  const head = step(neck, rig.headRadius * scale, 180 - pose.torsoLean);
  const arm = (angles: LimbAngles) => {
    const elbow = step(shoulder, rig.upperArm * scale, angles.upper);
    return { elbow, hand: step(elbow, rig.lowerArm * scale, angles.upper + angles.bend) };
  };
  const armFront = arm(pose.armFront); const armBack = arm(pose.armBack);
  return {
    head, neck, shoulder, hip,
    elbowFront: armFront.elbow, handFront: armFront.hand, elbowBack: armBack.elbow, handBack: armBack.hand,
    kneeFront: at(front.knee), footFront: at(front.foot), kneeBack: at(back.knee), footBack: at(back.foot),
  };
}
