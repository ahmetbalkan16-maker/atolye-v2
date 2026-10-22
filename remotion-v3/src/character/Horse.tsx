import React from "react";
import { INK } from "./rig";

/**
 * A riding horse in the characters' flat, outlined style (owner, 22 Oct 2026: "at çizimi"), side view facing +x in
 * character space (hooves on y = 0, the rider's head radius is 100). It breathes, nods and swishes its tail at rest;
 * walking, its four legs step in the diagonal pairs of a walk, the body bobs and the head nods with the stride.
 */

/** Height of the saddle seat above the ground (character units). */
export const SADDLE_Y = -330;
/** How far forward of the horse's centre the rider sits. */
export const SADDLE_X = -20;

const COAT = "#8a5a33";
const COAT_SHADE = "#6e4526";
const MANE = "#2e1d14";
const HOOF = "#2a221e";

const ol = (w = 6) => ({ stroke: INK, strokeWidth: w, strokeLinejoin: "round" as const, strokeLinecap: "round" as const });

/** One leg from the body (hip or shoulder) down to the hoof: upper and lower segment, bent by `swing` (−1..1). */
function Leg({ x, top, swing, lift, near }: { x: number; top: number; swing: number; lift: number; near: boolean }) {
  const knee = { x: x + swing * 34, y: top + 120 - lift * 0.4 };
  const hoof = { x: x + swing * 58 - (lift > 0 ? 14 : 0), y: -lift };
  const fill = near ? COAT : COAT_SHADE;
  return (
    <g>
      <path d={`M${x - 26} ${top} L${knee.x - 16} ${knee.y} L${hoof.x - 13} ${hoof.y - 26} L${hoof.x + 13} ${hoof.y - 26} L${knee.x + 16} ${knee.y} L${x + 26} ${top} Z`} fill={fill} {...ol(5)} />
      <path d={`M${hoof.x - 16} ${hoof.y - 26} L${hoof.x + 16} ${hoof.y - 26} L${hoof.x + 18} ${hoof.y} L${hoof.x - 18} ${hoof.y} Z`} fill={HOOF} {...ol(5)} />
    </g>
  );
}

/**
 * `walk`: stride phase (radians, grows with the distance walked) and how much it walks (0 standing … 1 full stride).
 * `time`: seconds, for the idle life. `cloth`: the saddle cloth's colour (the rider's own).
 */
export function Horse({ walk, time, cloth, seed = 0 }: { walk?: { phase: number; amount: number }; time: number; cloth: string; seed?: number }) {
  const a = walk?.amount ?? 0;
  const ph = walk?.phase ?? 0;
  // A walk moves the legs in diagonal pairs: near-hind with near-fore a quarter cycle apart.
  const legSwing = (offset: number) => Math.sin(ph + offset) * a;
  const legLift = (offset: number) => Math.max(0, Math.sin(ph + offset + Math.PI / 2)) * 34 * a;
  const breathe = 1 + Math.sin(time * 1.6 + seed) * 0.012;
  const bob = -Math.abs(Math.sin(ph)) * 10 * a + Math.sin(time * 1.6 + seed) * 2;
  const nod = Math.sin(ph * 2) * 6 * a + Math.sin(time * 0.8 + seed) * 3;
  const tail = Math.sin(time * 2.3 + seed) * 10 + Math.sin(ph) * 8 * a;
  return (
    <g>
      {/* Far legs (darker), behind the body. */}
      <Leg x={-150} top={-260} swing={legSwing(Math.PI)} lift={legLift(Math.PI)} near={false} />
      <Leg x={150} top={-262} swing={legSwing(Math.PI * 1.5)} lift={legLift(Math.PI * 1.5)} near={false} />
      <g transform={`translate(0 ${bob})`}>
        {/* Tail. */}
        <g transform={`rotate(${tail} -250 -330)`}>
          <path d="M-250 -330 Q-320 -300 -310 -190 Q-300 -150 -280 -170 Q-280 -240 -235 -300 Z" fill={MANE} {...ol(5)} />
        </g>
        {/* Body (barrel), breathing. */}
        <g transform={`translate(0 -300) scale(1 ${breathe}) translate(0 300)`}>
          <path d="M-255 -330 Q-260 -400 -170 -410 L130 -415 Q215 -415 235 -360 Q250 -300 210 -250 Q120 -225 -130 -232 Q-250 -240 -255 -330 Z" fill={COAT} {...ol()} />
          <path d="M-120 -248 Q0 -236 120 -246" fill="none" stroke={COAT_SHADE} strokeWidth={10} strokeLinecap="round" />
        </g>
        {/* Neck and head, nodding. */}
        <g transform={`rotate(${nod} 190 -390)`}>
          <path d="M150 -400 Q210 -520 270 -560 L315 -540 Q300 -470 250 -360 Z" fill={COAT} {...ol()} />
          <path d="M262 -570 Q330 -600 380 -560 Q400 -530 380 -505 Q350 -490 300 -505 Q270 -520 262 -570 Z" fill={COAT} {...ol()} />
          <ellipse cx={372} cy={-532} rx={8} ry={6} fill={INK} />
          <circle cx={318} cy={-556} r={9} fill="#ffffff" {...ol(3)} />
          <circle cx={321} cy={-555} r={4.5} fill={INK} />
          <path d="M280 -578 L292 -615 L302 -575 Z" fill={COAT} {...ol(4)} />
          {/* Mane along the neck. */}
          <path d="M268 -572 Q230 -545 200 -490 Q180 -450 165 -410 Q190 -440 215 -470 Q240 -520 278 -560 Z" fill={MANE} {...ol(4)} />
          {/* Bridle and reins to the saddle. */}
          <path d="M300 -540 L360 -520 M330 -548 L340 -505" stroke="#5a3a22" strokeWidth={6} fill="none" strokeLinecap="round" />
          <path d="M345 -515 Q250 -420 120 -395" stroke="#5a3a22" strokeWidth={5} fill="none" strokeLinecap="round" />
        </g>
        {/* Saddle cloth in the rider's colour, and the saddle. */}
        <path d="M-110 -400 L95 -405 L105 -300 Q0 -290 -120 -300 Z" fill={cloth} {...ol(5)} />
        <path d="M-110 -310 Q0 -298 105 -310" fill="none" stroke="#f3d27a" strokeWidth={8} />
        <path d="M-80 -400 Q-70 -440 -40 -432 L60 -432 Q85 -440 90 -404 Z" fill="#5a3a22" {...ol(5)} />
      </g>
      {/* Near legs (lighter), in front of the body. */}
      <Leg x={-140} top={-255} swing={legSwing(0)} lift={legLift(0)} near />
      <Leg x={160} top={-258} swing={legSwing(Math.PI / 2)} lift={legLift(Math.PI / 2)} near />
    </g>
  );
}

/** The rider's near leg, hanging down the horse's side from the saddle: thigh, shin and boot in the costume's colours. */
export function RiderLeg({ cloth, boot }: { cloth: string; boot: string }) {
  return (
    <g>
      <path d={`M${SADDLE_X - 18} ${SADDLE_Y - 30} Q${SADDLE_X + 40} ${SADDLE_Y + 10} ${SADDLE_X + 30} ${SADDLE_Y + 70} L${SADDLE_X + 6} ${SADDLE_Y + 76} Q${SADDLE_X + 6} ${SADDLE_Y + 20} ${SADDLE_X - 40} ${SADDLE_Y - 6} Z`} fill={cloth} {...ol(5)} />
      <path d={`M${SADDLE_X + 6} ${SADDLE_Y + 70} L${SADDLE_X + 32} ${SADDLE_Y + 66} L${SADDLE_X + 30} ${SADDLE_Y + 130} L${SADDLE_X + 58} ${SADDLE_Y + 140} L${SADDLE_X + 56} ${SADDLE_Y + 158} L${SADDLE_X + 6} ${SADDLE_Y + 156} Z`} fill={boot} {...ol(5)} />
    </g>
  );
}
