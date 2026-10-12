import { EXPRESSION_SHAPES } from "./CharacterExpression";
import { renderIllustratedCharacter, renderIllustratedThrone } from "./IllustratedCharacter";
import { POSE_ANGLES } from "./CharacterPose";
import { computeCharacterJoints, STICK_FIGURE_RIG, type CharacterJoints, type Point, type PoseAngles } from "./CharacterRig";
import type { HistoricalCostumeHint } from "./HistoricalCostumeHint";
import { STAGE_PROP_SIZE, type HandProp, type StageProp } from "./PropLibrary";
import { findSceneBlockingProblems, type BlockedCharacter, type SceneBlocking, type StageBackdrop, type StageTime } from "./SceneBlocking";

/**
 * Stage 15J — the SVG scene renderer.
 *
 * Draws one character scene as one SVG document from primitives: lines, circles, polygons, text. No image file, no
 * font file, no model and no network. The same blocking always gives the same bytes.
 *
 * A scene of drawn figures can be mistaken for a record of what happened. So the renderer writes a reenactment label
 * into the image itself unless the caller says the scene needs none, and it is the manifest, not the caller, that
 * decides that for a documentary.
 */
export const CHARACTER_SCENE_WIDTH = 1920;
export const CHARACTER_SCENE_HEIGHT = 1080;
const GROUND_FRONT = 900;
const GROUND_BACK = 640;
/** Where the sea backdrop's water ends and its shore begins. */
const SEA_SHORE = 760;
const INK = "#1c1c1c";

export const REENACTMENT_LABELS = Object.freeze({ tr: "CANLANDIRMA", en: "REENACTMENT" });
export type ReenactmentLabelLanguage = keyof typeof REENACTMENT_LABELS;
export interface SvgSceneOptions {
  readonly reenactmentLabel: ReenactmentLabelLanguage | null;
  /**
   * Font family for the caption and the label. Omitted, the text asks for the generic `sans-serif`, exactly as
   * before; production frames name real fonts because the rasterizer on Windows resolves `sans-serif` to a serif.
   */
  readonly fontFamily?: string;
  /** Low-cost recurring mascot details; absent preserves the original renderer. */
  readonly mascot?: boolean;
  readonly renderStyle?: typeof EDITORIAL_RENDER_STYLE;
  readonly artDirection?: CharacterArtDirection;
  /** Used only when a verified local PNG backdrop is composited outside SVG. */
  readonly transparentBackdrop?: boolean;
  readonly floorLayout?: "foreground-v1";
}

/**
 * One character as it stands in one animation frame: a pose given as angles instead of a named pose, a position,
 * and whether the mouth is open. The renderer draws it with the character's own costume, prop and expression.
 */
export interface CharacterFrameOverride {
  readonly pose: PoseAngles;
  readonly x: number;
  readonly mouthOpen: boolean;
}

const DEFAULT_FONT_FAMILY = "sans-serif";
const FONT_FAMILY_PATTERN = /^[A-Za-z0-9 ,'-]{1,80}$/;

const PALETTE: Readonly<Record<StageTime, { readonly sky: string; readonly far: string; readonly ground: string; readonly accent: string }>> = Object.freeze({
  DAY: { sky: "#d9e6f2", far: "#b7c9b0", ground: "#c9b48a", accent: "#8a6f4d" },
  DUSK: { sky: "#f0c9a0", far: "#a98f86", ground: "#a8875f", accent: "#6e5239" },
  NIGHT: { sky: "#27304a", far: "#3c4660", ground: "#4a4a55", accent: "#2f2f38" },
});

const n = (value: number) => String(Math.round(value * 10) / 10);
const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const line = (a: Point, b: Point, width: number, color = INK) => `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round"/>`;
const polygon = (points: readonly Point[], fill: string, stroke = INK, width = 0) => `<polygon points="${points.map((point) => `${n(point.x)},${n(point.y)}`).join(" ")}" fill="${fill}"${width ? ` stroke="${stroke}" stroke-width="${n(width)}" stroke-linejoin="round"` : ""}/>`;
const circle = (center: Point, radius: number, fill: string, width = 0) => `<circle cx="${n(center.x)}" cy="${n(center.y)}" r="${n(radius)}" fill="${fill}"${width ? ` stroke="${INK}" stroke-width="${n(width)}"` : ""}/>`;
const groundY = (depth: number) => GROUND_FRONT - (GROUND_FRONT - GROUND_BACK) * depth;
const scaleAt = (depth: number) => 1 - 0.5 * depth;

function backdrop(kind: StageBackdrop, time: StageTime): string {
  const colors = PALETTE[time];
  const W = CHARACTER_SCENE_WIDTH; const H = CHARACTER_SCENE_HEIGHT;
  const parts = [`<rect x="0" y="0" width="${W}" height="${H}" fill="${colors.sky}"/>`];
  if (time === "NIGHT") parts.push(circle({ x: 1560, y: 170 }, 60, "#e8e4c8"));
  else parts.push(circle({ x: 1560, y: time === "DUSK" ? 520 : 170 }, 70, time === "DUSK" ? "#e2783c" : "#f5e7a8"));
  if (kind === "MOUNTAINS") parts.push(polygon([{ x: 0, y: GROUND_BACK }, { x: 300, y: 300 }, { x: 560, y: 520 }, { x: 860, y: 240 }, { x: 1180, y: 540 }, { x: 1480, y: 320 }, { x: W, y: 560 }, { x: W, y: GROUND_BACK }], colors.far));
  if (kind === "FIELD") parts.push(`<path d="M0 ${GROUND_BACK} Q 480 ${GROUND_BACK - 150} 960 ${GROUND_BACK} T ${W} ${GROUND_BACK} L ${W} ${GROUND_BACK + 20} L 0 ${GROUND_BACK + 20} Z" fill="${colors.far}"/>`);
  if (kind === "CITY_WALLS") {
    const top = GROUND_BACK - 220; const points: Point[] = [{ x: 0, y: GROUND_BACK }, { x: 0, y: top }];
    for (let x = 0; x < W; x += 120) points.push({ x, y: top }, { x, y: top - 50 }, { x: x + 60, y: top - 50 }, { x: x + 60, y: top });
    points.push({ x: W, y: top }, { x: W, y: GROUND_BACK });
    parts.push(polygon(points, colors.far, colors.accent, 4));
    for (const x of [360, 960, 1560]) parts.push(`<rect x="${x - 90}" y="${top - 170}" width="180" height="${220 + 170}" fill="${colors.far}" stroke="${colors.accent}" stroke-width="4"/>`);
  }
  if (kind === "INTERIOR") {
    parts.push(`<rect x="0" y="0" width="${W}" height="${GROUND_BACK}" fill="${colors.far}"/>`);
    for (const x of [240, 720, 1200, 1680]) parts.push(`<rect x="${x - 34}" y="120" width="68" height="${GROUND_BACK - 120}" fill="${colors.sky}" stroke="${colors.accent}" stroke-width="4"/>`);
  }
  parts.push(`<rect x="0" y="${GROUND_BACK}" width="${W}" height="${H - GROUND_BACK}" fill="${colors.ground}"/>`);
  if (kind === "SEA") {
    // The sea lies behind the stage: the far third is water, so a ship at the back floats and figures at the front stand on the shore.
    const shore = SEA_SHORE;
    parts.push(`<rect x="0" y="${GROUND_BACK - 80}" width="${W}" height="${shore - GROUND_BACK + 80}" fill="${time === "NIGHT" ? "#1f2f4f" : "#5b8fb0"}"/>`);
    for (let row = 0; row < 3; row++) parts.push(`<path d="M0 ${GROUND_BACK - 30 + row * 60} q 60 -24 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0" fill="none" stroke="#dbe9f2" stroke-width="5" opacity="0.6"/>`);
  }
  return parts.join("");
}

function costume(hint: HistoricalCostumeHint, joints: CharacterJoints, scale: number, behind: boolean, mascot = false): string {
  const r = STICK_FIGURE_RIG.headRadius * scale * (mascot ? 1.5 : 1); const head = joints.head; const w = STICK_FIGURE_RIG.stroke * scale;
  if (behind) {
    if (hint === "CAPE") return polygon([joints.shoulder, { x: joints.shoulder.x - 70 * scale, y: joints.hip.y + 60 * scale }, { x: joints.hip.x - 10 * scale, y: joints.hip.y + 70 * scale }], "#8b2e2e", INK, w * 0.5);
    if (hint === "ROBE") return polygon([{ x: joints.shoulder.x - 34 * scale, y: joints.shoulder.y }, { x: joints.shoulder.x + 34 * scale, y: joints.shoulder.y }, { x: joints.hip.x + 62 * scale, y: joints.hip.y + 150 * scale }, { x: joints.hip.x - 62 * scale, y: joints.hip.y + 150 * scale }], "#4d5b7c", INK, w * 0.5);
    return "";
  }
  if (hint === "TURBAN") return `<ellipse cx="${n(head.x)}" cy="${n(head.y - r * 0.75)}" rx="${n(r * 1.15)}" ry="${n(r * 0.62)}" fill="#f2efe6" stroke="${INK}" stroke-width="${n(w * 0.5)}"/>`;
  if (hint === "HELMET") return `<path d="M ${n(head.x - r * 1.05)} ${n(head.y - r * 0.1)} A ${n(r * 1.05)} ${n(r * 1.05)} 0 0 1 ${n(head.x + r * 1.05)} ${n(head.y - r * 0.1)} Z" fill="#8f9aa3" stroke="${INK}" stroke-width="${n(w * 0.5)}"/>` + line({ x: head.x, y: head.y - r * 1.05 }, { x: head.x, y: head.y - r * 1.6 }, w * 0.6);
  if (hint === "CROWN") return polygon([{ x: head.x - r * 0.9, y: head.y - r * 0.7 }, { x: head.x - r * 0.9, y: head.y - r * 1.5 }, { x: head.x - r * 0.45, y: head.y - r * 1.05 }, { x: head.x, y: head.y - r * 1.6 }, { x: head.x + r * 0.45, y: head.y - r * 1.05 }, { x: head.x + r * 0.9, y: head.y - r * 1.5 }, { x: head.x + r * 0.9, y: head.y - r * 0.7 }], "#d9b23c", INK, w * 0.5);
  if (hint === "HOOD") return `<path d="M ${n(head.x - r * 1.2)} ${n(head.y + r * 0.9)} Q ${n(head.x - r * 1.3)} ${n(head.y - r * 1.5)} ${n(head.x)} ${n(head.y - r * 1.45)} Q ${n(head.x + r * 1.3)} ${n(head.y - r * 1.5)} ${n(head.x + r * 1.2)} ${n(head.y + r * 0.9)}" fill="none" stroke="#5a4632" stroke-width="${n(w * 1.4)}" stroke-linecap="round"/>`;
  if (hint === "ARMOR") return polygon([{ x: joints.shoulder.x - 30 * scale, y: joints.shoulder.y + 6 * scale }, { x: joints.shoulder.x + 30 * scale, y: joints.shoulder.y + 6 * scale }, { x: joints.hip.x + 22 * scale, y: joints.hip.y - 10 * scale }, { x: joints.hip.x - 22 * scale, y: joints.hip.y - 10 * scale }], "#9aa4ad", INK, w * 0.5);
  return "";
}

function handProp(prop: HandProp, hand: Point, scale: number): string {
  const w = STICK_FIGURE_RIG.stroke * scale * 0.7;
  const up = (length: number, lean = 0): Point => ({ x: hand.x + lean * scale, y: hand.y - length * scale });
  switch (prop) {
    case "SWORD": return line(hand, up(150, 26), w, "#9aa4ad") + line({ x: hand.x - 22 * scale, y: hand.y - 16 * scale }, { x: hand.x + 26 * scale, y: hand.y - 24 * scale }, w, "#6e5239");
    case "SPEAR": return line({ x: hand.x - 10 * scale, y: hand.y + 150 * scale }, up(260, 18), w, "#6e5239") + polygon([up(300, 21), { x: up(250, 18).x - 14 * scale, y: up(250, 18).y }, { x: up(250, 18).x + 14 * scale, y: up(250, 18).y }], "#9aa4ad", INK, w * 0.4);
    case "SHIELD": return circle({ x: hand.x + 8 * scale, y: hand.y }, 62 * scale, "#8b2e2e", w) + circle({ x: hand.x + 8 * scale, y: hand.y }, 14 * scale, "#d9b23c");
    case "FLAG": return line({ x: hand.x, y: hand.y + 120 * scale }, up(300), w, "#6e5239") + polygon([up(300), { x: hand.x + 170 * scale, y: hand.y - 262 * scale }, up(220)], "#8b2e2e", INK, w * 0.4);
    case "SCROLL": return `<rect x="${n(hand.x - 12 * scale)}" y="${n(hand.y - 46 * scale)}" width="${n(92 * scale)}" height="${n(64 * scale)}" fill="#f2efe6" stroke="${INK}" stroke-width="${n(w * 0.5)}"/>`;
    case "BOW": return `<path d="M ${n(hand.x)} ${n(hand.y - 120 * scale)} Q ${n(hand.x + 90 * scale)} ${n(hand.y)} ${n(hand.x)} ${n(hand.y + 120 * scale)}" fill="none" stroke="#6e5239" stroke-width="${n(w)}"/>` + line({ x: hand.x, y: hand.y - 120 * scale }, { x: hand.x, y: hand.y + 120 * scale }, w * 0.3);
    case "TORCH": return line({ x: hand.x, y: hand.y + 40 * scale }, up(110), w, "#6e5239") + polygon([up(190), { x: hand.x - 26 * scale, y: hand.y - 112 * scale }, { x: hand.x + 26 * scale, y: hand.y - 112 * scale }], "#e2783c");
  }
}

function character(item: BlockedCharacter, frame?: CharacterFrameOverride, mascot = false): string {
  const scale = scaleAt(item.depth);
  const ground: Point = { x: (frame ? frame.x : item.x) * CHARACTER_SCENE_WIDTH, y: groundY(item.depth) };
  const pose = frame ? frame.pose : POSE_ANGLES[item.pose];
  const joints = computeCharacterJoints(STICK_FIGURE_RIG, pose, ground, scale);
  const w = STICK_FIGURE_RIG.stroke * scale; const r = STICK_FIGURE_RIG.headRadius * scale * (mascot ? 1.5 : 1);
  const face = frame ? { ...EXPRESSION_SHAPES[item.expression], mouthOpen: frame.mouthOpen || (mascot && EXPRESSION_SHAPES[item.expression].mouthOpen) } : EXPRESSION_SHAPES[item.expression];
  const eyeY = joints.head.y - r * 0.12; const eyeDx = r * 0.36; const browY = eyeY - r * (0.3 + face.browRaise); const tilt = Math.tan((face.browTilt * Math.PI) / 180) * r * 0.22;
  const mouthY = joints.head.y + r * 0.42;
  const parts = [
    mascot ? mascotClothing(item.costume, joints, scale) : "",
    costume(item.costume, joints, scale, true, mascot),
    line(joints.hip, joints.kneeBack, w), line(joints.kneeBack, joints.footBack, w), line(joints.shoulder, joints.elbowBack, w), line(joints.elbowBack, joints.handBack, w),
    line(joints.hip, joints.shoulder, w), line(joints.shoulder, joints.neck, w),
    // Armour sits on the torso, under the near leg and the head; a head hint is drawn over the head, further down.
    item.costume === "ARMOR" ? costume(item.costume, joints, scale, false, mascot) : "",
    line(joints.hip, joints.kneeFront, w), line(joints.kneeFront, joints.footFront, w),
    circle(joints.head, r, mascot ? "#ffffff" : "#f6f1e7", w),
    // The eye nearer the facing side is drawn a little forward, so the face reads as turned.
    mascot ? `<ellipse cx="${n(joints.head.x - eyeDx + r * 0.14)}" cy="${n(eyeY)}" rx="${n(r * 0.11)}" ry="${n(r * 0.17)}" fill="${INK}"/>` : circle({ x: joints.head.x - eyeDx + r * 0.14, y: eyeY }, r * 0.09, INK),
    mascot ? `<ellipse cx="${n(joints.head.x + eyeDx + r * 0.14)}" cy="${n(eyeY)}" rx="${n(r * 0.11)}" ry="${n(r * 0.17)}" fill="${INK}"/>` : circle({ x: joints.head.x + eyeDx + r * 0.14, y: eyeY }, r * 0.09, INK),
    line({ x: joints.head.x - eyeDx - r * 0.1, y: browY - tilt }, { x: joints.head.x - eyeDx + r * 0.36, y: browY + tilt }, w * 0.45), line({ x: joints.head.x + eyeDx - r * 0.1, y: browY + tilt }, { x: joints.head.x + eyeDx + r * 0.36, y: browY - tilt }, w * 0.45),
    face.mouthOpen ? (mascot && item.expression === "HAPPY"
      ? `<path d="M ${n(joints.head.x - r * 0.25)} ${n(mouthY - r * 0.12)} Q ${n(joints.head.x + r * 0.14)} ${n(mouthY)} ${n(joints.head.x + r * 0.53)} ${n(mouthY - r * 0.12)} Q ${n(joints.head.x + r * 0.14)} ${n(mouthY + r * 0.55)} ${n(joints.head.x - r * 0.25)} ${n(mouthY - r * 0.12)} Z" fill="${INK}"/>` + circle({ x: joints.head.x + r * 0.14, y: mouthY + r * 0.15 }, r * 0.08, "#e8564f")
      : circle({ x: joints.head.x + r * 0.14, y: mouthY }, r * 0.16, INK))
      : `<path d="M ${n(joints.head.x - r * 0.3 + r * 0.14)} ${n(mouthY)} Q ${n(joints.head.x + r * 0.14)} ${n(mouthY + face.mouthCurve * r * 2)} ${n(joints.head.x + r * 0.3 + r * 0.14)} ${n(mouthY)}" fill="none" stroke="${INK}" stroke-width="${n(w * 0.45)}" stroke-linecap="round"/>`,
    item.costume !== "ARMOR" ? costume(item.costume, joints, scale, false, mascot) : "",
    line(joints.shoulder, joints.elbowFront, w), line(joints.elbowFront, joints.handFront, w),
    mascot ? mascotDetails(joints, scale, item.costume) : "",
    item.handProp ? handProp(item.handProp, joints.handFront, scale) : "",
  ].join("");
  const transforms: string[] = [];
  if (item.facing === "LEFT") transforms.push(`translate(${n(ground.x * 2)} 0) scale(-1 1)`);
  if (pose.bodyRotation) transforms.push(`rotate(${n(pose.bodyRotation)} ${n(ground.x)} ${n(ground.y)})`);
  return `<g data-character="${xml(item.id)}"${transforms.length ? ` transform="${transforms.join(" ")}"` : ""}>${parts}</g>`;
}

function mascotClothing(hint: HistoricalCostumeHint, joints: CharacterJoints, scale: number): string {
  const color = hint === "TURBAN" ? "#ad2936" : hint === "CROWN" ? "#354b8b" : hint === "HELMET" ? "#9aa4ad" : null;
  if (!color) return "";
  return `<g data-mascot-costume="${hint}">` + polygon([
    { x: joints.shoulder.x - 28 * scale, y: joints.shoulder.y + 4 * scale },
    { x: joints.shoulder.x + 28 * scale, y: joints.shoulder.y + 4 * scale },
    { x: joints.hip.x + 37 * scale, y: joints.hip.y + 25 * scale },
    { x: joints.hip.x - 37 * scale, y: joints.hip.y + 25 * scale },
  ], color, INK, 4 * scale) + line({ x: joints.hip.x - 32 * scale, y: joints.hip.y }, { x: joints.hip.x + 32 * scale, y: joints.hip.y }, 10 * scale, "#e7bd3c") + `</g>`;
}

/** A shared scarf, gloves and shoes made of SVG primitives, with no model or network work. */
function mascotDetails(joints: CharacterJoints, scale: number, hint: HistoricalCostumeHint): string {
  const p = (origin: Point, x: number, y: number): Point => ({ x: origin.x + x * scale, y: origin.y + y * scale });
  const stroke = 4 * scale;
  const scarf = polygon([p(joints.neck, -18, -5), p(joints.neck, 23, -2), p(joints.neck, 17, 16), p(joints.neck, -20, 10)], "#ffc629", INK, stroke) +
    polygon([p(joints.neck, 8, 9), p(joints.neck, 25, 10), p(joints.neck, 42, 68), p(joints.neck, 16, 57)], "#ffc629", INK, stroke);
  const gloves = [joints.handBack, joints.handFront].map(hand => circle(hand, 13 * scale, "#ffffff", stroke)).join("");
  const shoes = [joints.footBack, joints.footFront].map(foot => `<ellipse cx="${n(foot.x + 9 * scale)}" cy="${n(foot.y)}" rx="${n(24 * scale)}" ry="${n(11 * scale)}" fill="#ffffff" stroke="${INK}" stroke-width="${n(stroke)}"/>`).join("");
  const hair = hint === "NONE" || hint === "ROBE" || hint === "CAPE" || hint === "ARMOR"
    ? [-18, 0, 18].map(x => line(p(joints.head, x, -STICK_FIGURE_RIG.headRadius * 1.5 + 5), p(joints.head, x + 20, -STICK_FIGURE_RIG.headRadius * 1.5 - 20), stroke)).join("") : "";
  return `<g data-mascot="yellow-scarf-v1">${scarf}${gloves}${shoes}${hair}</g>`;
}

function stageProp(prop: StageProp, x: number, depth: number, facing: "LEFT" | "RIGHT"): string {
  const scale = scaleAt(depth); const size = STAGE_PROP_SIZE[prop]; const w = size.width * scale; const h = size.height * scale;
  const cx = x * CHARACTER_SCENE_WIDTH; const base = groundY(depth); const left = cx - w / 2; const s = 6 * scale;
  const at = (fx: number, fy: number): Point => ({ x: left + fx * w, y: base - fy * h });
  let body = "";
  switch (prop) {
    case "MONITOR": body = `<rect x="${n(left)}" y="${n(base - h)}" width="${n(w)}" height="${n(h * 0.72)}" rx="12" fill="#26364a" stroke="${INK}" stroke-width="${n(s)}"/><rect x="${n(left + w * 0.08)}" y="${n(base - h * 0.92)}" width="${n(w * 0.84)}" height="${n(h * 0.53)}" fill="#d9eff7"/>` + line(at(0.5, 0.28), at(0.5, 0.05), s * 3) + line(at(0.25, 0), at(0.75, 0), s * 2); break;
    case "CHART": body = `<rect x="${n(left)}" y="${n(base - h)}" width="${n(w)}" height="${n(h)}" rx="10" fill="#ffffff" stroke="${INK}" stroke-width="${n(s)}"/>` + [0.25, 0.45, 0.7].map((level, index) => `<rect x="${n(left + w * (0.17 + index * 0.25))}" y="${n(base - h * (0.1 + level))}" width="${n(w * 0.16)}" height="${n(h * level)}" fill="${["#5b8fb0", "#e2783c", "#d9b23c"][index]}"/>`).join("") + `<text x="${n(left + w * 0.1)}" y="${n(base - h * 0.87)}" font-family="sans-serif" font-size="${n(22 * scale)}" fill="${INK}">ŞEMA</text>`; break;
    case "MICROPHONE": body = line(at(0.5, 0.08), at(0.5, 0.76), s * 2) + circle(at(0.5, 0.88), w * 0.28, "#3c3c3c", s) + line(at(0.08, 0), at(0.92, 0), s * 2); break;
    case "CANNON": body = `<rect x="${n(left + w * 0.15)}" y="${n(base - h * 0.85)}" width="${n(w * 0.85)}" height="${n(h * 0.34)}" rx="${n(h * 0.17)}" fill="#3c3c3c"/>` + circle(at(0.3, 0.3), h * 0.3, "#6e5239", s); break;
    case "TENT": body = polygon([at(0, 0), at(0.5, 1), at(1, 0)], "#e6dcc3", INK, s) + polygon([at(0.42, 0), at(0.5, 0.55), at(0.58, 0)], "#6e5239"); break;
    case "THRONE": body = `<rect x="${n(left + w * 0.1)}" y="${n(base - h)}" width="${n(w * 0.8)}" height="${n(h)}" fill="#8b2e2e" stroke="${INK}" stroke-width="${n(s)}"/><rect x="${n(left)}" y="${n(base - h * 0.42)}" width="${n(w)}" height="${n(h * 0.14)}" fill="#d9b23c" stroke="${INK}" stroke-width="${n(s)}"/>`; break;
    case "TREE": body = `<rect x="${n(cx - w * 0.07)}" y="${n(base - h * 0.5)}" width="${n(w * 0.14)}" height="${n(h * 0.5)}" fill="#6e5239"/>` + circle(at(0.5, 0.72), w * 0.42, "#5f7f4f", s); break;
    case "SHIP": body = polygon([at(0.02, 0.28), at(0.98, 0.28), at(0.84, 0), at(0.16, 0)], "#6e5239", INK, s) + line(at(0.5, 0.28), at(0.5, 1), s * 1.4, "#3c3c3c") + polygon([at(0.52, 0.95), at(0.9, 0.42), at(0.52, 0.42)], "#f2efe6", INK, s); break;
    case "TOWER": body = `<rect x="${n(left + w * 0.12)}" y="${n(base - h * 0.9)}" width="${n(w * 0.76)}" height="${n(h * 0.9)}" fill="#b9ab94" stroke="${INK}" stroke-width="${n(s)}"/>` + polygon([at(0, 0.9), at(0, 1), at(0.25, 1), at(0.25, 0.95), at(0.5, 0.95), at(0.5, 1), at(0.75, 1), at(0.75, 0.95), at(1, 0.95), at(1, 0.9)], "#b9ab94", INK, s); break;
    case "HORSE": body = `<ellipse cx="${n(cx)}" cy="${n(base - h * 0.55)}" rx="${n(w * 0.34)}" ry="${n(h * 0.2)}" fill="#7a5a3c" stroke="${INK}" stroke-width="${n(s)}"/>` + line(at(0.26, 0.4), at(0.22, 0), s * 2, "#7a5a3c") + line(at(0.4, 0.4), at(0.42, 0), s * 2, "#7a5a3c") + line(at(0.62, 0.4), at(0.6, 0), s * 2, "#7a5a3c") + line(at(0.76, 0.4), at(0.8, 0), s * 2, "#7a5a3c")
      + polygon([at(0.76, 0.62), at(0.92, 1), at(1, 0.9), at(0.9, 0.56)], "#7a5a3c", INK, s) + line(at(0.18, 0.62), at(0.04, 0.3), s * 1.6, "#3c2c1c"); break;
    case "TABLE": body = `<rect x="${n(left)}" y="${n(base - h)}" width="${n(w)}" height="${n(h * 0.16)}" fill="#6e5239" stroke="${INK}" stroke-width="${n(s)}"/>` + line(at(0.1, 0.84), at(0.1, 0), s * 2, "#6e5239") + line(at(0.9, 0.84), at(0.9, 0), s * 2, "#6e5239"); break;
  }
  return `<g data-prop="${prop}"${facing === "LEFT" ? ` transform="translate(${n(cx * 2)} 0) scale(-1 1)"` : ""}>${body}</g>`;
}

/**
 * One scene as an SVG document. The blocking has to be valid: a blocking with a problem is refused, never drawn as
 * far as it goes. Farther figures and props are drawn first.
 */
export function renderCharacterSceneSvg(blocking: SceneBlocking, options: SvgSceneOptions): string {
  return renderSceneDocument(blocking, options, () => undefined);
}

/**
 * One frame of an animated scene. The blocking places the props, the backdrop and each figure's costume, prop and
 * face; `frames` moves a figure by id. A figure with no entry stands as the blocking draws it. Every frame carries the
 * same reenactment label as the still.
 */
export function renderCharacterSceneFrameSvg(
  blocking: SceneBlocking,
  frames: Readonly<Record<string, CharacterFrameOverride>>,
  options: SvgSceneOptions,
): string {
  const ids = new Set(blocking.characters.map((item) => item.id));
  for (const [id, frame] of Object.entries(frames)) {
    if (!ids.has(id) || !isRenderableFrame(frame)) throw new Error("CHARACTER_SCENE_FRAME_INVALID");
  }
  return renderSceneDocument(blocking, options, (item) => (Object.hasOwn(frames, item.id) ? frames[item.id] : undefined));
}

function isRenderableFrame(frame: CharacterFrameOverride): boolean {
  const pose = frame?.pose;
  const limbs = pose ? [pose.armFront, pose.armBack, pose.legFront, pose.legBack] : [];
  const angles = pose ? [pose.torsoLean, pose.bodyRotation, ...limbs.flatMap((limb) => [limb?.upper, limb?.bend])] : [];
  return !!pose && limbs.every(Boolean) && angles.every((value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 360) &&
    typeof frame.x === "number" && Number.isFinite(frame.x) && frame.x >= 0 && frame.x <= 1 && typeof frame.mouthOpen === "boolean";
}

function renderSceneDocument(
  blocking: SceneBlocking,
  options: SvgSceneOptions,
  frameFor: (item: BlockedCharacter) => CharacterFrameOverride | undefined,
): string {
  const problems = findSceneBlockingProblems(blocking);
  if (problems.length) throw new Error(`CHARACTER_SCENE_BLOCKING_INVALID: ${problems.join(", ")}`);
  if (!(options.reenactmentLabel === null || Object.hasOwn(REENACTMENT_LABELS, options.reenactmentLabel))) throw new Error("CHARACTER_SCENE_LABEL_INVALID");
  if (options.fontFamily !== undefined && !FONT_FAMILY_PATTERN.test(options.fontFamily)) throw new Error("CHARACTER_SCENE_FONT_INVALID");
  if (options.mascot !== undefined && typeof options.mascot !== "boolean") throw new Error("CHARACTER_SCENE_MASCOT_INVALID");
  if (options.renderStyle !== undefined && options.renderStyle !== EDITORIAL_RENDER_STYLE) throw new Error("CHARACTER_SCENE_STYLE_INVALID");
  if (options.artDirection !== undefined && findCharacterArtDirectionProblems(options.artDirection).length) throw new Error("CHARACTER_SCENE_ART_DIRECTION_INVALID");
  if (options.transparentBackdrop !== undefined && typeof options.transparentBackdrop !== "boolean") throw new Error("CHARACTER_SCENE_BACKDROP_INVALID");
  if (options.floorLayout !== undefined && (options.floorLayout !== "foreground-v1" || !options.transparentBackdrop)) throw new Error("CHARACTER_SCENE_FLOOR_INVALID");
  const font = xml(options.fontFamily ?? DEFAULT_FONT_FAMILY);
  const W = CHARACTER_SCENE_WIDTH; const H = CHARACTER_SCENE_HEIGHT;
  const drawn = [
    ...blocking.props.map((prop, index) => ({ depth: prop.depth, order: index, svg: prop.prop === "THRONE" && options.artDirection
      ? options.artDirection.version === "4" ? renderIllustratedThrone(prop.x, prop.depth, options.artDirection.culture) : renderDirectedThrone(prop.x, prop.depth, options.artDirection.culture)
      : stageProp(prop.prop, prop.x, prop.depth, prop.facing) })),
    ...blocking.characters.map((item, index) => ({ depth: item.depth, order: 100 + index, svg: options.renderStyle === EDITORIAL_RENDER_STYLE
      ? renderEditorialCharacter(item, frameFor(item), (joints, scale) => item.handProp ? handProp(item.handProp, joints.handFront, scale) : "", options.artDirection)
      : character(item, frameFor(item), options.mascot) })),
  ].sort((a, b) => b.depth - a.depth || a.order - b.order);
  const sceneArt = drawn.map(item => options.floorLayout === "foreground-v1" ? `<g transform="translate(0 ${n(140 + 160 * item.depth)})">${item.svg}</g>` : item.svg).join("");
  const arrows = blocking.arrows.map((arrow) => {
    const from: Point = { x: arrow.fromX * W, y: arrow.fromY * H }; const to: Point = { x: arrow.toX * W, y: arrow.toY * H };
    const angle = Math.atan2(to.y - from.y, to.x - from.x); const head = 34;
    const wing = (turn: number): Point => ({ x: to.x - head * Math.cos(angle + turn), y: to.y - head * Math.sin(angle + turn) });
    return line(from, to, 12, "#8b2e2e") + polygon([to, wing(0.45), wing(-0.45)], "#8b2e2e");
  });
  const caption = blocking.caption === null ? "" : `<rect x="60" y="60" width="${n(Math.min(W - 120, 60 + blocking.caption.length * 30))}" height="84" rx="10" fill="#1c1c1c" opacity="0.72"/><text x="90" y="118" font-family="${font}" font-size="46" fill="#ffffff">${xml(blocking.caption)}</text>`;
  const label = options.reenactmentLabel === null ? "" : `<g data-reenactment-label="${options.reenactmentLabel}"><rect x="60" y="${H - 132}" width="420" height="72" rx="8" fill="#1c1c1c" opacity="0.8"/><text x="84" y="${H - 82}" font-family="${font}" font-size="40" font-weight="bold" letter-spacing="4" fill="#ffffff">${REENACTMENT_LABELS[options.reenactmentLabel]}</text></g>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${options.transparentBackdrop ? "" : options.renderStyle === EDITORIAL_RENDER_STYLE ? renderEditorialBackdrop(blocking, options.artDirection) : backdrop(blocking.backdrop, blocking.time)}${sceneArt}${arrows.join("")}${caption}${label}</svg>\n`;
}

/** Permanent local art direction. Bounded SVG primitives, no downloads or image model. */
export const EDITORIAL_RENDER_STYLE = "editorial-v2" as const;
export const CHARACTER_ART_CULTURES = ["UNKNOWN", "OTTOMAN", "BYZANTINE", "ROMAN", "WESTERN", "STEPPE", "EGYPTIAN"] as const;
export interface CharacterArtDirection {
  readonly version: "1" | "2" | "3" | "4";
  /** Explicit scene context, not an inferred ethnic identity from appearance. */
  readonly culture: (typeof CHARACTER_ART_CULTURES)[number];
  readonly faith: "UNSPECIFIED" | "ISLAM" | "CHRISTIANITY" | "ANCIENT_EGYPT";
  readonly roles: readonly { readonly id: string; readonly role: "RULER" | "ADVISOR" | "GUARD" | "NARRATOR" | "CITIZEN" }[];
}
export function findCharacterArtDirectionProblems(value: unknown): string[] {
  const v = value as Partial<CharacterArtDirection> | null;
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !["version", "culture", "faith", "roles"].includes(k)) || !["1", "2", "3", "4"].includes(v.version ?? "") || !(CHARACTER_ART_CULTURES as readonly unknown[]).includes(v.culture) || !["UNSPECIFIED", "ISLAM", "CHRISTIANITY", "ANCIENT_EGYPT"].includes(v.faith ?? "") || !Array.isArray(v.roles) || v.roles.length > 8) return ["ART_DIRECTION_SHAPE"];
  const seen = new Set<string>();
  for (const role of v.roles) {
    if (!role || Object.keys(role).length !== 2 || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(role.id) || seen.has(role.id) || !["RULER", "ADVISOR", "GUARD", "NARRATOR", "CITIZEN"].includes(role.role)) return ["ART_DIRECTION_ROLES"];
    seen.add(role.id);
  }
  return [];
}
const ART_INK = "#243044";
const num = (v: number) => String(Math.round(v * 10) / 10);
const rect = (x: number, y: number, w: number, h: number, fill: string, radius = 0, stroke = "none") => `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(radius)}" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
const path = (d: string, fill: string, stroke = ART_INK, width = 3) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, stroke = "none", width = 3) => `<ellipse cx="${num(x)}" cy="${num(y)}" rx="${num(rx)}" ry="${num(ry)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
const seg = (a: Point, b: Point, width: number, color = ART_INK) => path(`M${num(a.x)} ${num(a.y)} L${num(b.x)} ${num(b.y)}`, "none", color, width);

export function editorialSceneTheme(blocking: SceneBlocking): string {
  if (blocking.props.some(p => p.prop === "MONITOR")) return "studio";
  if (blocking.props.some(p => p.prop === "CHART")) return "economy";
  if (blocking.props.some(p => p.prop === "MICROPHONE")) return "forum";
  return blocking.backdrop === "INTERIOR" ? (blocking.characters.some(c => c.costume === "CROWN" || c.costume === "TURBAN") ? "palace" : "library") : blocking.backdrop.toLowerCase();
}

/** Layered illustrative settings are scenery, not photographs or historical evidence. */
export function renderEditorialBackdrop(blocking: SceneBlocking, direction?: CharacterArtDirection): string {
  const theme = editorialSceneTheme(blocking);
  if (theme === "palace" && direction && ["2", "3", "4"].includes(direction.version) && direction.culture !== "UNKNOWN") return renderCulturalPalace(direction.culture, blocking.time);
  const night = blocking.time === "NIGHT";
  const dusk = blocking.time === "DUSK";
  const sky = night ? "#243550" : dusk ? "#ffe0bf" : "#e6f1f3";
  const parts = [`<g data-art-environment="${theme}">`, rect(0, 0, 1920, 1080, sky), rect(0, 500, 1920, 220, night ? "#4b617a" : "#edf1e6")];
  const inside = ["palace", "library", "studio", "economy", "forum"].includes(theme);
  if (inside) {
    parts.push(rect(0, 0, 1920, 665, theme === "palace" ? "#ecdab9" : theme === "studio" ? "#d4e2ea" : theme === "economy" ? "#e9e2d2" : "#e4e9e5"));
    // Deep windows, wall mouldings and layered columns create depth without filters.
    for (const x of [100, 570, 1040, 1510]) {
      const arch = theme === "palace" || theme === "library" || theme === "forum";
      parts.push(rect(x, 100, 310, 455, arch ? "#c5b89b" : "#a9bcc5", arch ? 150 : 14), rect(x + 14, 114, 282, 427, night ? "#3a5573" : "#9dbcc9", arch ? 140 : 8), rect(x + 30, 138, 250, 390, night ? "#54718e" : "#d4e6e9", arch ? 125 : 4));
      parts.push(rect(x + 146, 205, 12, 320, "#f7eedc"), rect(x + 20, 330, 270, 10, "#f7eedc"));
    }
    parts.push(rect(0, 574, 1920, 18, "#b8a486"), rect(0, 600, 1920, 65, "#d0bfa2"));
    if (theme === "palace") {
      for (const x of [40, 440, 940, 1440, 1830]) parts.push(rect(x, 82, 48, 553, "#f8efda", 8), rect(x - 14, 80, 76, 25, "#b89854", 6), rect(x - 10, 614, 68, 27, "#b89854", 4));
      for (const x of [470, 1390]) parts.push(path(`M${x} 90 L${x + 145} 90 L${x + 135} 340 L${x + 72} 380 L${x + 10} 340 Z`, "#763d46", "#b89854", 5));
      if (direction?.culture === "OTTOMAN") {
        // Tile bands and pointed decorative arches; no invented inscription or holy text.
        for (let col = 0; col < 24; col++) parts.push(rect(col * 80, 545, 75, 36, col % 2 ? "#608f99" : "#b8d0c5", 4));
        parts.push(path("M790 175 Q960 -5 1130 175 L1130 400 L790 400Z", "#d4c298", "#ac8b55", 5));
      } else if (direction?.culture === "BYZANTINE") {
        for (let col = 0; col < 24; col++) parts.push(rect(col * 80, 545, 72, 33, col % 2 ? "#c3a05e" : "#947b65", 3));
        parts.push(ellipse(960, 260, 104, 104, "#d3b674", "#ad8e54", 6));
      } else if (direction?.culture === "EGYPTIAN") {
        for (const x of [440, 940, 1440]) parts.push(rect(x - 25, 180, 88, 405, "#d2b66f", 3), rect(x - 46, 170, 130, 36, "#b7a373", 4));
      }
    } else if (theme === "library") {
      for (const x of [45, 1350]) {
        parts.push(rect(x, 210, 525, 405, "#715b4e", 12));
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 12; col++) parts.push(rect(x + 18 + col * 41, 240 + row * 115, 29, 83, ["#ab6460", "#b8a36b", "#657f88", "#797092"][col % 4]!, 3));
          parts.push(rect(x + 10, 327 + row * 115, 505, 12, "#c6ac80"));
        }
      }
    } else {
      parts.push(rect(900, 175, 425, 220, "#fbfcf8", 22, "#9aa9ac"));
      if (theme === "studio") {
        for (let row = 0; row < 5; row++) parts.push(rect(935, 205 + row * 32, 140 + (row % 3) * 52, 9, ["#70a2a9", "#b49b67", "#8582a5"][row % 3]!, 4));
        for (const x of [95, 1570]) {
          parts.push(rect(x, 340, 205, 274, "#344d65", 18));
          for (let row = 0; row < 5; row++) parts.push(rect(x + 18, 360 + row * 44, 169, 30, "#567186", 7), ellipse(x + 162, 375 + row * 44, 4, 4, "#b7d69a"));
        }
      } else if (theme === "economy") {
        parts.push(path("M940 350 L1000 310 L1060 335 L1125 245 L1215 270 L1280 220", "none", "#5b9091", 8));
        // Schematic unlabeled line: never invent market prices or financial statistics.
        for (const x of [130, 1510]) parts.push(rect(x, 430, 230, 184, "#798b86", 8), rect(x + 15, 445, 200, 18, "#eadcc2", 4));
      } else {
        for (let row = 0; row < 3; row++) for (let col = 0; col < 7; col++) parts.push(rect(130 + col * 240, 475 + row * 44, 195, 27, "#8895a4", 14));
        parts.push(ellipse(1110, 278, 65, 65, "#c9b37c"), path("M1090 278 L1107 295 L1140 252", "none", "#faf7ef", 10));
      }
    }
  } else {
    parts.push(ellipse(1540, 165, 80, 80, night ? "#eee9d3" : "#f6d98a"));
    for (const x of [80, 610, 1150]) parts.push(ellipse(x + 60, 180, 100, 27, night ? "#647389" : "#ffffff"), ellipse(x + 122, 165, 75, 34, night ? "#647389" : "#ffffff"));
    const mountains = theme === "mountains";
    parts.push(path(mountains ? "M0 655 L190 320 L390 540 L730 200 L1030 570 L1420 290 L1920 600 L1920 750 L0 750Z" : "M0 590 Q270 420 580 590 T1150 570 T1920 530 L1920 780 L0 780Z", night ? "#50627b" : "#a1b7ad", "none"));
    parts.push(path("M0 645 Q440 530 820 650 T1920 620 L1920 770 L0 770Z", night ? "#647269" : "#c0cdb4", "none"));
    if (theme === "city_walls") {
      parts.push(rect(0, 445, 1920, 250, "#b5afa3"));
      for (let x = 0; x < 1920; x += 180) parts.push(rect(x, 410, 90, 65, "#a29b90"));
      for (let row = 0; row < 4; row++) for (let col = 0; col < 13; col++) parts.push(rect(col * 155 + (row % 2) * 70, 490 + row * 47, 145, 38, "#c9c1b1", 4));
      parts.push(path("M835 695 L835 550 A125 125 0 0 1 1085 550 L1085 695Z", "#69716c", "#8b857c", 8));
    }
  }
  const ground = theme === "sea" ? 760 : 665;
  parts.push(rect(0, ground, 1920, 1080 - ground, "#e4d9c4"));
  for (let band = 0; band < 8; band++) parts.push(rect(0, ground + band * (1080 - ground) / 8, 1920, (1080 - ground) / 8 + 1, ["#d6c7ad", "#daceb7", "#dfd3bd", "#e3d8c5", "#e7decd", "#ece4d5", "#f0e8dc", "#f5ecdc"][band]!));
  if (theme === "sea") {
    parts.push(rect(0, 560, 1920, 200, night ? "#44647c" : "#7caabb"));
    for (let row = 0; row < 4; row++) parts.push(path(`M0 ${590 + row * 42} q80 -16 160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0`, "none", "#d6e8e8", 4));
  }
  if (inside) {
    for (const x of [-600, 0, 600, 1200, 1800, 2400]) parts.push(path(`M960 665 L${x} 1080`, "none", "#d9cdb8", 2));
    for (const y of [724, 820, 975]) parts.push(rect(0, y, 1920, 2, "#d9cdb8"));
    if (theme === "palace") parts.push(path("M735 666 L1185 666 L1390 1080 L530 1080Z", "#a96062", "#dfbb80", 7));
  }
  parts.push("</g>");
  return parts.join("");
}

/** Identity stays attached to actor id, never to the current pose or time. */
export function editorialActorVariant(id: string): number {
  const ordinal = /^c([1-8])$/.exec(id);
  if (ordinal) return Number(ordinal[1]) - 1;
  let hash = 0; for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return hash % 8;
}

function renderDirectedThrone(x: number, depth: number, culture: CharacterArtDirection["culture"]): string {
  const scale = scaleAt(depth); const cx = x * 1920; const base = groundY(depth);
  const wood = culture === "EGYPTIAN" ? "#c6a25c" : culture === "OTTOMAN" ? "#765544" : "#aa8a4b";
  const cushion = culture === "BYZANTINE" ? "#70436f" : culture === "OTTOMAN" ? "#6b9499" : "#a4545c";
  const w = 245 * scale; const h = 375 * scale;
  const body = [rect(cx - w / 2, base - h, w, h * 0.77, wood, 28 * scale, ART_INK), rect(cx - w * 0.4, base - h * 0.92, w * 0.8, h * 0.53, cushion, 20 * scale), rect(cx - w * 0.62, base - h * 0.36, w * 1.24, h * 0.12, wood, 9 * scale, ART_INK), rect(cx - w * 0.49, base - h * 0.33, w * 0.98, h * 0.13, cushion, 9 * scale), rect(cx - w * 0.42, base - h * 0.2, w * 0.1, h * 0.2, wood, 4), rect(cx + w * 0.32, base - h * 0.2, w * 0.1, h * 0.2, wood, 4)];
  for (const side of [-1, 1]) body.push(ellipse(cx + side * w * 0.52, base - h * 0.43, 14 * scale, 14 * scale, "#dfc27d", ART_INK));
  body.push(ellipse(cx, base - h * 0.97, 29 * scale, 17 * scale, "#dfc27d", ART_INK));
  return `<g data-prop="THRONE" data-throne-culture="${culture}">${body.join("")}</g>`;
}

/** Version 2 scenery families. Stylised architecture; not a claim about a specific surviving palace. */
function renderCulturalPalace(culture: CharacterArtDirection["culture"], time: StageTime): string {
  const night = time === "NIGHT";
  const wall = culture === "EGYPTIAN" ? "#d5b77a" : culture === "BYZANTINE" ? "#bea98e" : culture === "WESTERN" ? "#b5b9ba" : culture === "STEPPE" ? "#d8c7a8" : "#eee2cb";
  const parts = [`<g data-art-environment="palace" data-palace-culture="${culture}" data-palace-version="2">`, rect(0, 0, 1920, 1080, wall)];
  if (culture === "OTTOMAN") {
    // Pointed arch windows, decorative tile panels and timber ceiling: visually distinct from a European court.
    parts.push(rect(0, 0, 1920, 74, "#795d46"), rect(0, 82, 1920, 16, "#c7a469"));
    for (const x of [70, 445, 1075, 1450]) {
      parts.push(path(`M${x} 575 L${x} 275 Q${x + 150} 80 ${x + 300} 275 L${x + 300} 575Z`, night ? "#385b75" : "#a5c7d2", "#c8ad78", 16));
      parts.push(seg({ x: x + 150, y: 195 }, { x: x + 150, y: 572 }, 8, "#efdfbd"), seg({ x, y: 405 }, { x: x + 300, y: 405 }, 8, "#efdfbd"));
      parts.push(path(`M${x + 8} 570 Q${x + 100} 510 ${x + 190} 555 Q${x + 240} 445 ${x + 292} 570Z`, night ? "#607c85" : "#7caaac", "none"));
    }
    for (let col = 0; col < 24; col++) for (let row = 0; row < 3; row++) {
      const x = col * 80; const y = 580 + row * 28;
      parts.push(rect(x, y, 78, 26, (row + col) % 2 ? "#587e90" : "#e8ead6"), path(`M${x + 39} ${y + 3} L${x + 53} ${y + 13} L${x + 39} ${y + 23} L${x + 25} ${y + 13}Z`, "#a3bdb2", "none"));
    }
    parts.push(path("M800 105 Q960 0 1120 105 L1120 550 L800 550Z", "#ead5ad", "#c19b5c", 9));
    parts.push(rect(874, 130, 172, 350, "#abc3b6", 22));
  } else if (culture === "BYZANTINE") {
    // Vaults, warm brick and mosaic-like geometric bands; no invented saint portraits.
    for (let row = 0; row < 9; row++) for (let col = 0; col < 12; col++) parts.push(rect(col * 168 + (row % 2) * 84, 80 + row * 58, 155, 46, (row + col) % 3 ? "#c5aa8f" : "#b99a80", 3));
    parts.push(path("M0 120 Q480 -170 960 120 Q1440 -170 1920 120 L1920 210 Q1440 -40 960 210 Q480 -40 0 210Z", "#d5bd88", "#b4955b", 8));
    for (const x of [90, 645, 1200, 1755]) parts.push(rect(x, 270, 70, 355, "#e8dfca", 12), rect(x - 20, 250, 110, 34, "#c4a465", 8), rect(x - 14, 615, 98, 42, "#c4a465", 5));
    for (const x of [240, 805, 1360]) parts.push(path(`M${x} 525 L${x} 370 A145 145 0 0 1 ${x + 290} 370 L${x + 290} 525Z`, night ? "#485c70" : "#c9d5ca", "#9e8155", 9));
    for (let col = 0; col < 24; col++) parts.push(rect(col * 80, 574, 76, 54, col % 2 ? "#b88b54" : "#e0c17d", 3));
  } else if (culture === "ROMAN") {
    // Open atrium and classical column spacing, rather than medieval pointed windows.
    parts.push(rect(120, 100, 1680, 430, night ? "#405875" : "#b7d6df"));
    parts.push(path("M180 525 Q500 380 760 525 T1730 490 L1730 570 L180 570Z", "#879d83", "none"));
    parts.push(rect(0, 58, 1920, 67, "#b49e7d"), rect(0, 126, 1920, 28, "#f7efdd"), rect(0, 562, 1920, 105, "#b67e6a"));
    for (const x of [60, 420, 780, 1140, 1500, 1845]) {
      parts.push(rect(x, 184, 58, 417, "#f1e9d5", 10), rect(x - 18, 160, 96, 40, "#d6c5a5", 6), rect(x - 14, 587, 86, 42, "#d6c5a5", 5));
      for (const dx of [13, 29, 45]) parts.push(rect(x + dx, 212, 3, 351, "#d6c5a5"));
    }
  } else if (culture === "EGYPTIAN") {
    // Flat lintels and broad lotus-like capitals, unlike the arched court families.
    for (let row = 0; row < 8; row++) for (let col = 0; col < 14; col++) parts.push(rect(col * 142 + (row % 2) * 71, 110 + row * 60, 137, 55, (row + col) % 3 ? "#d6bb85" : "#d0b17b", 2));
    parts.push(rect(0, 80, 1920, 54, "#607a8e"), rect(0, 136, 1920, 17, "#d5ac4c"));
    for (const x of [140, 620, 1100, 1580]) {
      parts.push(rect(x, 250, 88, 380, "#dfc792", 8), path(`M${x - 35} 230 L${x + 123} 230 L${x + 95} 290 L${x - 7} 290Z`, "#819a90", "#657b71", 4), rect(x - 15, 618, 118, 36, "#ba9957", 3));
      for (const y of [300, 330, 580]) parts.push(rect(x, y, 88, 16, "#59778e"));
    }
    parts.push(rect(795, 200, 330, 340, "#867051", 3), rect(824, 222, 272, 318, night ? "#4e667c" : "#bdd0ca", 1), rect(776, 185, 368, 38, "#c8aa62", 2));
  } else if (culture === "WESTERN") {
    parts.push(rect(0, 0, 1920, 115, "#67594e"));
    for (const x of [80, 470, 1170, 1560]) {
      parts.push(path(`M${x} 540 L${x} 240 Q${x + 140} 90 ${x + 280} 240 L${x + 280} 540Z`, night ? "#4b5b7c" : "#bfd2d9", "#7a7a75", 13));
      parts.push(seg({ x: x + 140, y: 175 }, { x: x + 140, y: 536 }, 9, "#f0e6cf"), seg({ x, y: 390 }, { x: x + 280, y: 390 }, 9, "#f0e6cf"));
    }
    for (const x of [385, 1000, 1775]) parts.push(path(`M${x} 133 L${x + 100} 133 L${x + 90} 430 L${x + 50} 468 L${x + 10} 430Z`, "#95636f", "#c3a269", 6));
    parts.push(rect(0, 568, 1920, 96, "#887262"));
    for (let x = 0; x < 1920; x += 110) parts.push(rect(x + 10, 582, 85, 64, "#a08873", 5));
  } else {
    // Steppe court concept: felt, timber lattice and a central roof ring.
    parts.push(ellipse(960, 92, 820, 78, "#9c7e5d"), ellipse(960, 92, 210, 43, night ? "#405671" : "#aac5cd"));
    for (let x = -600; x < 2400; x += 180) { parts.push(path(`M${x} 205 L${x + 540} 650`, "none", "#ad9474", 5), path(`M${x} 650 L${x + 540} 205`, "none", "#ad9474", 5)); }
    parts.push(rect(805, 234, 310, 430, "#967657", 65), rect(835, 270, 250, 394, night ? "#586880" : "#bbc5ac", 55));
  }
  parts.push(rect(0, 665, 1920, 415, culture === "ROMAN" || culture === "BYZANTINE" ? "#e4ddd0" : "#e5d6ba"));
  for (const x of [-600, 0, 600, 1200, 1800, 2400]) parts.push(path(`M960 665 L${x} 1080`, "none", "#c7baa3", 2));
  for (const y of [740, 845, 1000]) parts.push(rect(0, y, 1920, 2, "#c7baa3"));
  if (!["ROMAN", "EGYPTIAN"].includes(culture)) {
    parts.push(path("M690 665 L1230 665 L1540 1080 L380 1080Z", culture === "OTTOMAN" ? "#9c6764" : culture === "BYZANTINE" ? "#826484" : "#9d686a", "#d4b97f", 7));
    for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) parts.push(path(`M${770 + col * 78 - row * 18} ${705 + row * 88} l18 16 l-18 16 l-18 -16Z`, "#c4a777", "none"));
  }
  parts.push("</g>");
  return parts.join("");
}

export function renderEditorialCharacter(item: BlockedCharacter, frame: CharacterFrameOverride | undefined, prop: (joints: CharacterJoints, scale: number) => string, direction?: CharacterArtDirection): string {
  if (direction?.version === "4") {
    const role = direction.roles.find(r => r.id === item.id)?.role;
    // Keep non-court historical gear on the established renderer until a
    // reviewed illustrated costume exists; never strip a warrior's armour.
    if (["RULER", "ADVISOR", "GUARD"].includes(role ?? "") || item.costume === "NONE" || item.costume === "ROBE") return renderIllustratedCharacter(item, frame, prop, direction);
    return renderEditorialCharacter(item, frame, prop, { ...direction, version: "3" });
  }
  const variant = editorialActorVariant(item.id);
  const scale = 1.28 * (1 - 0.5 * item.depth);
  const ground = { x: (frame?.x ?? item.x) * 1920, y: 900 - 260 * item.depth };
  const pose = frame?.pose ?? POSE_ANGLES[item.pose];
  const joints = computeCharacterJoints({ id: EDITORIAL_RENDER_STYLE, headRadius: 58, neck: 12, torso: 112, upperArm: 65, lowerArm: 62, upperLeg: 72, lowerLeg: 72, stroke: 12 }, pose, ground, scale);
  const p = (point: Point, x: number, y: number) => ({ x: point.x + x * scale, y: point.y + y * scale });
  const e = (point: Point, x: number, y: number, rx: number, ry: number, fill: string, stroke = ART_INK) => ellipse(point.x + x * scale, point.y + y * scale, rx * scale, ry * scale, fill, stroke, 3 * scale);
  const poly = (points: Point[], fill: string, stroke = ART_INK) => path(`M${points.map(a => `${num(a.x)} ${num(a.y)}`).join(" L")}Z`, fill, stroke, 3 * scale);
  const colors = ["#d5a83e", "#527f91", "#a66568", "#778b66", "#8c7199", "#be8257", "#4d7285", "#927655"];
  const color = colors[variant]!;
  const role = direction?.roles.find(r => r.id === item.id)?.role;
  const culture = direction?.culture ?? "UNKNOWN";
  const wardrobe = direction !== undefined && ["2", "3"].includes(direction.version);
  const detailed = direction?.version === "3";
  const coat = role === "RULER" && culture === "BYZANTINE" ? "#65385c" : role === "RULER" && culture === "EGYPTIAN" ? "#eddfb5" : item.costume === "TURBAN" ? ["#9c3947", "#3c6475", "#706047"][variant % 3]! : item.costume === "CROWN" ? "#514c83" : item.costume === "HELMET" || item.costume === "ARMOR" ? "#7b8997" : color;
  const parts = [e(ground, 0, 6, 61, 10, "#b9ad98", "none")];
  if (role === "RULER" && (culture === "WESTERN" || culture === "BYZANTINE")) parts.push(poly([p(joints.shoulder, -32, -1), p(joints.hip, -75, 49), p(joints.hip, 52, 49), p(joints.shoulder, 25, 0)], "#793d51"));
  // Black limbs, colored tunics, cuffs and shoes keep the mascot language without identical silhouettes.
  for (const [a, b, c] of [[joints.hip, joints.kneeBack, joints.footBack], [joints.hip, joints.kneeFront, joints.footFront], [joints.shoulder, joints.elbowBack, joints.handBack]] as const) parts.push(seg(a, b, 15 * scale), seg(b, c, 15 * scale));
  parts.push(poly([p(joints.shoulder, -33, 0), p(joints.shoulder, 33, 0), p(joints.hip, 42, item.costume === "NONE" ? 8 : 35), p(joints.hip, -42, item.costume === "NONE" ? 8 : 35)], coat));
  parts.push(seg(p(joints.shoulder, 0, 10), p(joints.hip, 0, 9), 3 * scale, "#e8d3a4"));
  if (item.costume !== "NONE") parts.push(seg(p(joints.hip, -34, -8), p(joints.hip, 34, -8), 12 * scale, "#d6b574"));
  for (const y of [28, 53, 78]) parts.push(e(joints.shoulder, 13, y, 3, 3, "#f6de9e", "none"));
  if (role === "RULER") for (const y of [20, 47, 74]) for (const x of [-19, 23]) parts.push(e(joints.shoulder, x, y, 4, 6, "#d7ba76", "none"));
  if (wardrobe) {
    const advisor = role === "ADVISOR";
    if (culture === "ROMAN") {
      parts.push(poly([p(joints.shoulder, -35, -3), p(joints.shoulder, 32, 10), p(joints.hip, 42, 55), p(joints.hip, -37, 55)], advisor ? "#e3d5b7" : role === "GUARD" ? "#b36952" : "#f3e4c4"));
      parts.push(seg(p(joints.shoulder, -29, 0), p(joints.hip, 25, 42), 12 * scale, role === "RULER" ? "#886083" : "#9c5850"));
    } else if (culture === "EGYPTIAN") {
      parts.push(poly([p(joints.hip, -30, -8), p(joints.hip, 31, -8), p(joints.hip, 48, 67), p(joints.hip, -44, 67)], "#f4e9ca"));
      parts.push(seg(p(joints.shoulder, -29, 8), p(joints.shoulder, 30, 8), 16 * scale, role === "RULER" ? "#547e9a" : "#c6a766"), seg(p(joints.hip, -31, 0), p(joints.hip, 31, 0), 9 * scale, "#c8a85d"));
    } else if (culture === "OTTOMAN") {
      const cloth = role === "GUARD" ? "#ede2c4" : advisor ? "#426e71" : "#9c3947";
      parts.push(poly([p(joints.shoulder, -32, 0), p(joints.shoulder, 31, 0), p(joints.hip, 48, advisor ? 78 : 59), p(joints.hip, -46, advisor ? 78 : 59)], cloth));
      parts.push(seg(p(joints.shoulder, -27, 6), p(joints.hip, -10, 48), 7 * scale, "#d7bd82"), seg(p(joints.shoulder, 26, 6), p(joints.hip, 11, 48), 7 * scale, "#d7bd82"));
      if (role === "RULER") for (const x of [-24, 24]) parts.push(e(joints.shoulder, x, 6, 13, 19, "#e8ddc5", "none"));
      parts.push(seg(p(joints.hip, -35, 1), p(joints.hip, 34, 1), 13 * scale, role === "GUARD" ? "#9a4f50" : "#c3a36a"));
    } else if (culture === "BYZANTINE") {
      const cloth = role === "GUARD" ? "#84909b" : advisor ? "#9c8560" : "#65385c";
      parts.push(poly([p(joints.shoulder, -33, 0), p(joints.shoulder, 33, 0), p(joints.hip, 42, advisor ? 78 : 47), p(joints.hip, -42, advisor ? 78 : 47)], cloth));
      if (role === "RULER") for (let y = 12; y < 148; y += 22) parts.push(e(joints.shoulder, 2, y, 9, 7, "#d8bc75", "none"));
      else parts.push(seg(p(joints.shoulder, -23, 7), p(joints.hip, 24, 34), 8 * scale, "#d0b17c"));
    } else if (culture === "WESTERN") {
      parts.push(poly([p(joints.shoulder, -30, 0), p(joints.shoulder, 30, 0), p(joints.hip, 38, 40), p(joints.hip, -38, 40)], role === "RULER" ? "#496288" : advisor ? "#93605e" : "#929ca6"));
      parts.push(seg(p(joints.shoulder, 0, 10), p(joints.hip, 0, 32), 9 * scale, "#d9c493"));
      if (role === "RULER") for (const x of [-24, 24]) parts.push(e(joints.shoulder, x, 5, 13, 16, "#f0e6d3", "none"));
    } else if (culture === "STEPPE") {
      parts.push(poly([p(joints.shoulder, -30, 0), p(joints.shoulder, 32, 0), p(joints.hip, 43, 54), p(joints.hip, -43, 54)], role === "RULER" ? "#946649" : advisor ? "#5f795e" : "#746049"));
      parts.push(seg(p(joints.shoulder, -22, 5), p(joints.hip, 22, 43), 7 * scale, "#cbb997"));
    }
  }
  parts.push(seg(joints.shoulder, joints.elbowFront, 17 * scale, coat), seg(joints.elbowFront, joints.handFront, 13 * scale));
  if (detailed && role) parts.push(renderWardrobeDetails(joints, scale, role, culture));
  parts.push(e(joints.head, 0, 0, 58, variant === 2 || variant === 5 ? 62 : 57, "#fffaf1"));
  const face = EXPRESSION_SHAPES[item.expression];
  for (const x of [-19, 22]) {
    parts.push(e(joints.head, x, -7, 7, 11, ART_INK, "none"), e(joints.head, x - 1, -10, 2.2, 3, "white", "none"));
    const tilt = face.browTilt * 0.17 * (x < 0 ? 1 : -1);
    parts.push(seg(p(joints.head, x - 10, -29 + tilt - face.browRaise * 50), p(joints.head, x + 11, -29 - tilt - face.browRaise * 50), 4 * scale));
  }
  parts.push(e(joints.head, -34, 19, 8, 4, "#edb5a3", "none"), e(joints.head, 36, 19, 8, 4, "#edb5a3", "none"));
  const mouth = frame?.mouthOpen ?? face.mouthOpen;
  if (mouth && item.expression === "SURPRISED") parts.push(e(joints.head, 2, 29, 10, 14, ART_INK, "none"));
  else if (mouth) parts.push(poly([p(joints.head, -20, 22), p(joints.head, 24, 22), p(joints.head, 15, 42), p(joints.head, -8, 43)], ART_INK), seg(p(joints.head, -14, 25), p(joints.head, 19, 25), 5 * scale, "white"), e(joints.head, 6, 38, 10, 4, "#e97879", "none"));
  else parts.push(path(`M${num(joints.head.x - 19 * scale)} ${num(joints.head.y + 29 * scale)} q${22 * scale} ${face.mouthCurve * 70 * scale} ${39 * scale} 0`, "none", ART_INK, 4 * scale));
  // Full headwear and secondary identity details, positioned from animated head joints.
  if (wardrobe && culture === "EGYPTIAN" && role !== "RULER") {
    parts.push(poly([p(joints.head, -53, -37), p(joints.head, -42, -64), p(joints.head, 43, -64), p(joints.head, 52, -37)], "#3d3c36"), seg(p(joints.head, -47, -38), p(joints.head, 47, -38), 8 * scale, "#bda263"));
  } else if (wardrobe && culture === "ROMAN" && role === "ADVISOR") {
    parts.push(path(`M${num(joints.head.x - 44 * scale)} ${num(joints.head.y - 40 * scale)} Q${num(joints.head.x)} ${num(joints.head.y - 75 * scale)} ${num(joints.head.x + 44 * scale)} ${num(joints.head.y - 40 * scale)}`, "none", "#605247", 9 * scale));
  } else if (wardrobe && culture === "STEPPE") {
    parts.push(e(joints.head, 0, -48, 63, 27, "#785b46"), seg(p(joints.head, -52, -32), p(joints.head, 52, -32), 12 * scale, "#c4b59a"));
  } else if (role === "RULER" && culture === "EGYPTIAN") {
    parts.push(poly([p(joints.head, -60, -40), p(joints.head, -52, -74), p(joints.head, 52, -74), p(joints.head, 60, -40), p(joints.head, 77, 53), p(joints.head, 48, 50), p(joints.head, 42, -32), p(joints.head, -42, -32), p(joints.head, -48, 50), p(joints.head, -77, 53)], "#d9ba63"));
    for (const x of [-62, 60]) for (const y of [-25, -7, 11, 29]) parts.push(seg(p(joints.head, x - 7, y), p(joints.head, x + 7, y), 7 * scale, "#47617f"));
    parts.push(e(joints.head, 0, -55, 6, 12, "#45627a", "none"));
  } else if (role === "RULER" && culture === "ROMAN") {
    for (const side of [-1, 1]) for (let leaf = 0; leaf < 5; leaf++) parts.push(e(joints.head, side * (47 - leaf * 8), -16 - leaf * 9, 9, 5, "#879960", "#526c47"));
  } else if (role === "RULER" && culture === "BYZANTINE") {
    parts.push(rect(joints.head.x - 54 * scale, joints.head.y - 67 * scale, 108 * scale, 34 * scale, "#d7b257", 8 * scale, ART_INK), path(`M${num(joints.head.x - 48 * scale)} ${num(joints.head.y - 65 * scale)} Q${num(joints.head.x)} ${num(joints.head.y - 110 * scale)} ${num(joints.head.x + 48 * scale)} ${num(joints.head.y - 65 * scale)}`, "#b85362", "#d7b257", 5 * scale));
    for (const x of [-50, 50]) { parts.push(seg(p(joints.head, x, -34), p(joints.head, x, 20), 3 * scale, "#d7b257")); for (const y of [-22, -8, 7, 22]) parts.push(e(joints.head, x, y, 4, 5, "#fff7dc", "none")); }
    if (direction?.faith === "CHRISTIANITY") parts.push(seg(p(joints.head, 0, -83), p(joints.head, 0, -107), 5 * scale, "#d7b257"), seg(p(joints.head, -9, -98), p(joints.head, 9, -98), 5 * scale, "#d7b257"));
  } else if (item.costume === "TURBAN" || (role === "RULER" && culture === "OTTOMAN")) {
    parts.push(e(joints.head, 0, -49, 68, 31, "#fcf3dc"));
    for (const y of [-66, -52, -38]) parts.push(seg(p(joints.head, -51, y + 8), p(joints.head, 52, y - 8), 4 * scale, "#d5c3a1"));
    parts.push(e(joints.head, 25, -43, 11, 14, "#d7b35e"), e(joints.head, 25, -43, 5, 8, "#af4850", "none"));
  } else if (item.costume === "CROWN") {
    parts.push(poly([p(joints.head, -51, -34), p(joints.head, -59, -80), p(joints.head, -30, -62), p(joints.head, 0, -94), p(joints.head, 28, -62), p(joints.head, 58, -80), p(joints.head, 50, -34)], "#e1b756"));
    for (const x of [-30, 0, 30]) parts.push(e(joints.head, x, -45, 5, 7, x === 0 ? "#be595b" : "#5c91a5", "none"));
  } else if (item.costume === "HELMET" || item.costume === "ARMOR") {
    parts.push(path(`M${num(joints.head.x - 61 * scale)} ${num(joints.head.y - 9 * scale)} a${61 * scale} ${61 * scale} 0 0 1 ${122 * scale} 0 Z`, "#99a8b5", ART_INK, 4 * scale));
    parts.push(seg(p(joints.head, 0, -58), p(joints.head, 16, -92), 16 * scale, "#b14f58"));
  } else if (item.costume === "HOOD") parts.push(path(`M${num(joints.head.x - 63 * scale)} ${num(joints.head.y + 37 * scale)} Q${num(joints.head.x - 84 * scale)} ${num(joints.head.y - 86 * scale)} ${num(joints.head.x)} ${num(joints.head.y - 70 * scale)} Q${num(joints.head.x + 84 * scale)} ${num(joints.head.y - 86 * scale)} ${num(joints.head.x + 63 * scale)} ${num(joints.head.y + 37 * scale)}`, "none", "#7b6758", 12 * scale));
  else if (variant % 3 === 0) parts.push(poly([p(joints.head, -39, -44), p(joints.head, -25, -71), p(joints.head, -4, -60), p(joints.head, 13, -79), p(joints.head, 25, -56), p(joints.head, 39, -67), p(joints.head, 43, -44)], "#39404c"));
  else if (variant % 3 === 1) parts.push(path(`M${num(joints.head.x - 46 * scale)} ${num(joints.head.y - 36 * scale)} Q${num(joints.head.x - 20 * scale)} ${num(joints.head.y - 87 * scale)} ${num(joints.head.x + 47 * scale)} ${num(joints.head.y - 41 * scale)}`, "none", "#77594b", 11 * scale));
  if (variant % 3 === 1 || item.costume === "ROBE") {
    parts.push(e(joints.head, -19, -7, 16, 19, "none"), e(joints.head, 22, -7, 16, 19, "none"), seg(p(joints.head, -3, -7), p(joints.head, 6, -7), 3 * scale));
  }
  if (variant % 3 === 2) parts.push(path(`M${num(joints.head.x - 26 * scale)} ${num(joints.head.y + 45 * scale)} q${26 * scale} ${32 * scale} ${54 * scale} 0`, "none", "#776251", 11 * scale));
  // Only the lead mascot wears yellow; supporting actors keep their own color identity.
  const scarf = variant === 0 ? "#f3c549" : ["#88b5ba", "#d7a7a1", "#bec597"][variant % 3]!;
  parts.push(poly([p(joints.neck, -25, -3), p(joints.neck, 29, -3), p(joints.neck, 23, 17), p(joints.neck, -24, 12)], scarf));
  parts.push(poly([p(joints.neck, 12, 12), p(joints.neck, 28, 14), p(joints.neck, 38, 68), p(joints.neck, 15, 57)], scarf));
  for (const h of [joints.handBack, joints.handFront]) parts.push(e(h, 0, 0, 14, 16, "#fffaf1"));
  if (detailed) for (const h of [joints.handBack, joints.handFront]) parts.push(e(h, -9, -4, 7, 9, "#fffaf1"));
  for (const foot of [joints.footBack, joints.footFront]) parts.push(e(foot, 10, -2, 28, 13, "#fffaf1"), seg(p(foot, -15, 4), p(foot, 34, 4), 3 * scale));
  parts.push(prop(joints, scale));
  const transforms = [];
  if (item.facing === "LEFT") transforms.push(`translate(${num(ground.x * 2)} 0) scale(-1 1)`);
  if (pose.bodyRotation) transforms.push(`rotate(${num(pose.bodyRotation)} ${num(ground.x)} ${num(ground.y)})`);
  return `<g data-character="${item.id}" data-art-identity="${variant}"${direction ? ` data-art-culture="${culture}" data-art-role="${role ?? "CITIZEN"}"` : ""} data-mascot="yellow-scarf-v1"${transforms.length ? ` transform="${transforms.join(" ")}"` : ""}>${parts.join("")}</g>`;
}

/** Local version3 embroidery and tailored sleeves, attached to animated joints. */
function renderWardrobeDetails(j: CharacterJoints, scale: number, role: string, culture: CharacterArtDirection["culture"]): string {
  if (!["RULER", "ADVISOR", "GUARD"].includes(role)) return "";
  const p = (a: Point, x: number, y: number) => ({ x: a.x + x * scale, y: a.y + y * scale });
  const parts: string[] = [];
  if (role === "RULER" && ["OTTOMAN", "BYZANTINE", "WESTERN"].includes(culture)) {
    for (const x of [-25, 25]) for (const y of [28, 59, 90, 121]) {
      const a = p(j.shoulder, x, y);
      parts.push(path(`M${num(a.x)} ${num(a.y + 9 * scale)} q${-9 * scale} ${-11 * scale} 0 ${-18 * scale} q${9 * scale} ${9 * scale} 0 ${18 * scale}`, "none", "#edcf79", 2.5 * scale));
    }
    parts.push(seg(p(j.hip, -41, 52), p(j.hip, 41, 52), 7 * scale, "#e7c76d"));
  }
  if (role === "GUARD" && ["ROMAN", "BYZANTINE", "WESTERN"].includes(culture)) for (const y of [23, 44, 65, 86]) parts.push(seg(p(j.shoulder, -25, y), p(j.shoulder, 25, y), 5 * scale, "#b9c3c9"));
  parts.push(seg(p(j.hip, -36, 0), p(j.hip, 35, 0), 13 * scale, "#d5ad57"), ellipse(j.hip.x, j.hip.y, 14 * scale, 13 * scale, "#e8c76a", ART_INK), ellipse(j.hip.x, j.hip.y, 6 * scale, 7 * scale, "#a45052"));
  const sleeve = culture === "OTTOMAN" ? role === "RULER" ? "#9c3947" : role === "ADVISOR" ? "#426e71" : "#ede2c4" : culture === "ROMAN" || culture === "EGYPTIAN" ? "#f0e5c9" : culture === "BYZANTINE" ? "#65385c" : "#496288";
  parts.push(seg(j.shoulder, j.elbowFront, 24 * scale, sleeve));
  const cuff = { x: j.elbowFront.x + (j.handFront.x - j.elbowFront.x) * 0.22, y: j.elbowFront.y + (j.handFront.y - j.elbowFront.y) * 0.22 };
  parts.push(seg(j.elbowFront, cuff, 22 * scale, sleeve), ellipse(cuff.x, cuff.y, 9 * scale, 9 * scale, "#dcb967"));
  return `<g data-wardrobe-detail="3">${parts.join("")}</g>`;
}
