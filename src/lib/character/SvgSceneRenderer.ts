import { EXPRESSION_SHAPES } from "./CharacterExpression";
import { POSE_ANGLES } from "./CharacterPose";
import { computeCharacterJoints, STICK_FIGURE_RIG, type CharacterJoints, type Point } from "./CharacterRig";
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
export interface SvgSceneOptions { readonly reenactmentLabel: ReenactmentLabelLanguage | null }

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

function costume(hint: HistoricalCostumeHint, joints: CharacterJoints, scale: number, behind: boolean): string {
  const r = STICK_FIGURE_RIG.headRadius * scale; const head = joints.head; const w = STICK_FIGURE_RIG.stroke * scale;
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

function character(item: BlockedCharacter): string {
  const scale = scaleAt(item.depth);
  const ground: Point = { x: item.x * CHARACTER_SCENE_WIDTH, y: groundY(item.depth) };
  const pose = POSE_ANGLES[item.pose];
  const joints = computeCharacterJoints(STICK_FIGURE_RIG, pose, ground, scale);
  const w = STICK_FIGURE_RIG.stroke * scale; const r = STICK_FIGURE_RIG.headRadius * scale;
  const face = EXPRESSION_SHAPES[item.expression];
  const eyeY = joints.head.y - r * 0.12; const eyeDx = r * 0.36; const browY = eyeY - r * (0.3 + face.browRaise); const tilt = Math.tan((face.browTilt * Math.PI) / 180) * r * 0.22;
  const mouthY = joints.head.y + r * 0.42;
  const parts = [
    costume(item.costume, joints, scale, true),
    line(joints.hip, joints.kneeBack, w), line(joints.kneeBack, joints.footBack, w), line(joints.shoulder, joints.elbowBack, w), line(joints.elbowBack, joints.handBack, w),
    line(joints.hip, joints.shoulder, w), line(joints.shoulder, joints.neck, w),
    // Armour sits on the torso, under the near leg and the head; a head hint is drawn over the head, further down.
    item.costume === "ARMOR" ? costume(item.costume, joints, scale, false) : "",
    line(joints.hip, joints.kneeFront, w), line(joints.kneeFront, joints.footFront, w),
    circle(joints.head, r, "#f6f1e7", w),
    // The eye nearer the facing side is drawn a little forward, so the face reads as turned.
    circle({ x: joints.head.x - eyeDx + r * 0.14, y: eyeY }, r * 0.09, INK), circle({ x: joints.head.x + eyeDx + r * 0.14, y: eyeY }, r * 0.09, INK),
    line({ x: joints.head.x - eyeDx - r * 0.1, y: browY - tilt }, { x: joints.head.x - eyeDx + r * 0.36, y: browY + tilt }, w * 0.45), line({ x: joints.head.x + eyeDx - r * 0.1, y: browY + tilt }, { x: joints.head.x + eyeDx + r * 0.36, y: browY - tilt }, w * 0.45),
    face.mouthOpen ? circle({ x: joints.head.x + r * 0.14, y: mouthY }, r * 0.16, INK)
      : `<path d="M ${n(joints.head.x - r * 0.3 + r * 0.14)} ${n(mouthY)} Q ${n(joints.head.x + r * 0.14)} ${n(mouthY + face.mouthCurve * r * 2)} ${n(joints.head.x + r * 0.3 + r * 0.14)} ${n(mouthY)}" fill="none" stroke="${INK}" stroke-width="${n(w * 0.45)}" stroke-linecap="round"/>`,
    item.costume !== "ARMOR" ? costume(item.costume, joints, scale, false) : "",
    line(joints.shoulder, joints.elbowFront, w), line(joints.elbowFront, joints.handFront, w),
    item.handProp ? handProp(item.handProp, joints.handFront, scale) : "",
  ].join("");
  const transforms: string[] = [];
  if (item.facing === "LEFT") transforms.push(`translate(${n(ground.x * 2)} 0) scale(-1 1)`);
  if (pose.bodyRotation) transforms.push(`rotate(${n(pose.bodyRotation)} ${n(ground.x)} ${n(ground.y)})`);
  return `<g data-character="${xml(item.id)}"${transforms.length ? ` transform="${transforms.join(" ")}"` : ""}>${parts}</g>`;
}

function stageProp(prop: StageProp, x: number, depth: number, facing: "LEFT" | "RIGHT"): string {
  const scale = scaleAt(depth); const size = STAGE_PROP_SIZE[prop]; const w = size.width * scale; const h = size.height * scale;
  const cx = x * CHARACTER_SCENE_WIDTH; const base = groundY(depth); const left = cx - w / 2; const s = 6 * scale;
  const at = (fx: number, fy: number): Point => ({ x: left + fx * w, y: base - fy * h });
  let body = "";
  switch (prop) {
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
  const problems = findSceneBlockingProblems(blocking);
  if (problems.length) throw new Error(`CHARACTER_SCENE_BLOCKING_INVALID: ${problems.join(", ")}`);
  if (!(options.reenactmentLabel === null || Object.hasOwn(REENACTMENT_LABELS, options.reenactmentLabel))) throw new Error("CHARACTER_SCENE_LABEL_INVALID");
  const W = CHARACTER_SCENE_WIDTH; const H = CHARACTER_SCENE_HEIGHT;
  const drawn = [
    ...blocking.props.map((prop, index) => ({ depth: prop.depth, order: index, svg: stageProp(prop.prop, prop.x, prop.depth, prop.facing) })),
    ...blocking.characters.map((item, index) => ({ depth: item.depth, order: 100 + index, svg: character(item) })),
  ].sort((a, b) => b.depth - a.depth || a.order - b.order);
  const arrows = blocking.arrows.map((arrow) => {
    const from: Point = { x: arrow.fromX * W, y: arrow.fromY * H }; const to: Point = { x: arrow.toX * W, y: arrow.toY * H };
    const angle = Math.atan2(to.y - from.y, to.x - from.x); const head = 34;
    const wing = (turn: number): Point => ({ x: to.x - head * Math.cos(angle + turn), y: to.y - head * Math.sin(angle + turn) });
    return line(from, to, 12, "#8b2e2e") + polygon([to, wing(0.45), wing(-0.45)], "#8b2e2e");
  });
  const caption = blocking.caption === null ? "" : `<rect x="60" y="60" width="${n(Math.min(W - 120, 60 + blocking.caption.length * 30))}" height="84" rx="10" fill="#1c1c1c" opacity="0.72"/><text x="90" y="118" font-family="sans-serif" font-size="46" fill="#ffffff">${xml(blocking.caption)}</text>`;
  const label = options.reenactmentLabel === null ? "" : `<g data-reenactment-label="${options.reenactmentLabel}"><rect x="60" y="${H - 132}" width="420" height="72" rx="8" fill="#1c1c1c" opacity="0.8"/><text x="84" y="${H - 82}" font-family="sans-serif" font-size="40" font-weight="bold" letter-spacing="4" fill="#ffffff">${REENACTMENT_LABELS[options.reenactmentLabel]}</text></g>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${backdrop(blocking.backdrop, blocking.time)}${drawn.map((item) => item.svg).join("")}${arrows.join("")}${caption}${label}</svg>\n`;
}
