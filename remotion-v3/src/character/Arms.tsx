import React from "react";
import type { V3CharacterStyle } from "../../../src/lib/v3/render/RenderPlanTypes";
import { FORE_ARM, type HandShape, INK, INK_W, type LimbJoints, SHOULDER_X, SHOULDER_Y, solveLimb, UPPER_ARM } from "./rig";

const GLOVE = "#ffffff";

/**
 * Cartoon glove in hand space: origin at the wrist, +y along the forearm. Every finger is drawn as an ink
 * stroke first and a white stroke second, so the whole glove reads as one outlined silhouette.
 */
function Glove({ shape }: { shape: HandShape }) {
  const fingers: { d: string; w: number }[] = [];
  if (shape === "acik") {
    fingers.push(
      { d: "M-13 30 L-17 48", w: 11 },
      { d: "M-4 33 L-5 54", w: 11 },
      { d: "M5 33 L7 53", w: 11 },
      { d: "M13 30 L18 46", w: 10 },
      { d: "M-15 16 L-30 8", w: 11 },
    );
  } else if (shape === "isaret") {
    fingers.push({ d: "M5 30 L6 62", w: 11 }, { d: "M-16 18 L-24 10", w: 11 });
  }
  const palmR = shape === "acik" ? 19 : 21;
  return (
    <g>
      <ellipse cx={0} cy={4} rx={18} ry={9} fill={GLOVE} stroke={INK} strokeWidth={4.5} />
      {fingers.map((f, i) => (
        <path key={`o${i}`} d={f.d} stroke={INK} strokeWidth={f.w + 9} strokeLinecap="round" />
      ))}
      <circle cx={0} cy={23} r={palmR + 4.5} fill={INK} />
      {fingers.map((f, i) => (
        <path key={`f${i}`} d={f.d} stroke={GLOVE} strokeWidth={f.w} strokeLinecap="round" />
      ))}
      <circle cx={0} cy={23} r={palmR} fill={GLOVE} />
      {shape === "yumruk" || shape === "isaret" ? (
        <g stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none">
          <path d="M-12 34 Q-8 40 -3 36" />
          <path d="M-2 37 Q3 43 8 38" />
        </g>
      ) : (
        <path d="M-6 16 Q0 22 6 16" stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.5} />
      )}
    </g>
  );
}

export function armJoints(side: 1 | -1, angles: readonly [number, number]): LimbJoints {
  return solveLimb({ x: side * SHOULDER_X, y: SHOULDER_Y }, angles, [UPPER_ARM, FORE_ARM], side);
}

export function Arm({
  side,
  angles,
  hand,
  sleeve,
  style,
  item,
  grip,
}: {
  side: 1 | -1;
  angles: readonly [number, number];
  hand: HandShape;
  sleeve: { color: string; width: number; cuff?: string };
  style: V3CharacterStyle;
  item?: string;
  grip?: boolean;
}) {
  const j = armJoints(side, angles);
  const d = `M${j.root.x} ${j.root.y} L${j.mid.x} ${j.mid.y} L${j.end.x} ${j.end.y}`;
  const handTransform = `translate(${j.end.x} ${j.end.y}) rotate(${j.endAngle - 90}) scale(${side} 1)`;
  // Held items are drawn around the palm centre, behind the glove, so a fist reads as closed around a grip.
  const palmY = style === "cop" ? 10 : 23;
  const held = item ? <g transform={`translate(0 ${palmY})`} dangerouslySetInnerHTML={{ __html: item }} /> : null;
  // An open-hand gesture would drop a gripped item, so the holding hand stays a fist.
  const shape: HandShape = item && grip ? "yumruk" : hand;
  if (style === "cop") {
    return (
      <g>
        <path d={d} fill="none" stroke={INK} strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
        <g transform={handTransform}>
          {held}
          <circle cx={0} cy={10} r={13} fill={GLOVE} stroke={INK} strokeWidth={5} />
        </g>
      </g>
    );
  }
  // Cuff band over the last part of the forearm.
  const ux = (j.end.x - j.mid.x) / FORE_ARM, uy = (j.end.y - j.mid.y) / FORE_ARM;
  const cuffStart = { x: j.end.x - ux * 14, y: j.end.y - uy * 14 };
  return (
    <g>
      <path d={d} fill="none" stroke={INK} strokeWidth={sleeve.width + 2 * INK_W} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={sleeve.color} strokeWidth={sleeve.width} strokeLinecap="round" strokeLinejoin="round" />
      {sleeve.cuff ? <path d={`M${cuffStart.x} ${cuffStart.y} L${j.end.x - ux * 2} ${j.end.y - uy * 2}`} stroke={sleeve.cuff} strokeWidth={sleeve.width - 2} strokeLinecap="butt" /> : null}
      <g transform={handTransform}>
        {held}
        <Glove shape={shape} />
      </g>
    </g>
  );
}
