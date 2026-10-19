import React from "react";
import type { V3Prop } from "../../../src/lib/v3/render/RenderPlanTypes";
import { INK } from "../character/rig";

const GOLD = "#e3b23c";
const outline = { stroke: INK, strokeWidth: 6, strokeLinejoin: "round" as const };

/** Set pieces drawn in the same flat, outlined style as the characters. Units match character space. */
export function PropArt({ kind }: { kind: V3Prop["kind"] }) {
  switch (kind) {
    case "taht":
      return (
        <g>
          <path d="M-150 0 L-150 -40 L150 -40 L150 0 Z" fill="#8f2232" {...outline} />
          <path d="M-170 -40 L-170 -70 L170 -70 L170 -40 Z" fill="#b3263a" {...outline} />
          <path d="M-120 -70 L-120 -150 L120 -150 L120 -70 Z" fill="#b3263a" {...outline} />
          <path d="M-128 -150 L-128 -470 Q0 -560 128 -470 L128 -150 Z" fill={GOLD} {...outline} />
          <path d="M-100 -160 L-100 -450 Q0 -520 100 -450 L100 -160 Z" fill="#9f1f33" {...outline} />
          <path d="M-70 -200 Q0 -240 70 -200 M-70 -300 Q0 -340 70 -300 M-70 -400 Q0 -440 70 -400" fill="none" stroke={GOLD} strokeWidth={5} />
          <path d="M-16 -512 Q0 -566 16 -512 Q0 -524 -16 -512 Z" fill={GOLD} {...outline} />
          <path d="M-150 -150 L-150 -330 L-120 -330 L-120 -150 Z M120 -150 L120 -330 L150 -330 L150 -150 Z" fill={GOLD} {...outline} />
          <circle cx={-135} cy={-345} r={18} fill={GOLD} {...outline} />
          <circle cx={135} cy={-345} r={18} fill={GOLD} {...outline} />
        </g>
      );
    case "top":
      return (
        <g>
          <path d="M-210 -40 L190 -96 L210 -40 L-190 16 Z" fill="none" />
          <path d="M-220 -70 L180 -150 Q214 -150 220 -110 Q222 -76 196 -62 L-200 -10 Q-232 -14 -232 -42 Q-232 -66 -220 -70 Z" fill="#8b6d3f" {...outline} />
          <path d="M-150 -86 L-140 -22 M-60 -104 L-50 -38 M40 -124 L50 -56 M130 -142 L140 -72" stroke="#5f4a2b" strokeWidth={10} />
          <ellipse cx={204} cy={-106} rx={24} ry={46} fill="#3b2f22" {...outline} />
          <circle cx={-120} cy={-6} r={44} fill="#6b4428" {...outline} />
          <circle cx={-120} cy={-6} r={12} fill={INK} />
          <circle cx={100} cy={-26} r={44} fill="#6b4428" {...outline} />
          <circle cx={100} cy={-26} r={12} fill={INK} />
          <circle cx={290} cy={-30} r={28} fill="#9e9a92" {...outline} />
        </g>
      );
    case "kule_iskelesi":
      return (
        <g>
          <path d="M-160 0 L-150 -520 L150 -520 L160 0 Z" fill="#cdbb98" {...outline} />
          {[-430, -340, -250, -160, -70].map((y) => (
            <path key={y} d={`M-155 ${y} L155 ${y}`} stroke="#a8936d" strokeWidth={5} />
          ))}
          {[-110, -30, 50, 130].map((x) => (
            <path key={x} d={`M${x} -520 L${x} 0`} stroke="#a8936d" strokeWidth={4} />
          ))}
          <path d="M-150 -520 L-150 -560 L-110 -560 L-110 -530 L-70 -530 L-70 -560 L-30 -560 L-30 -530 L10 -530 L10 -560 L50 -560 L50 -530 L90 -530 L90 -560 L150 -560 L150 -520 Z" fill="#cdbb98" {...outline} />
          <path d="M-200 0 L-200 -380 M200 0 L200 -380 M-200 -120 L-160 -120 M-200 -250 L-155 -250 M200 -120 L160 -120 M200 -250 L155 -250 M-200 -380 L-160 -320 M200 -380 L160 -320" stroke="#7a5233" strokeWidth={14} strokeLinecap="round" />
          <path d="M-200 0 L-200 -380 M200 0 L200 -380" stroke={INK} strokeWidth={3} />
        </g>
      );
    case "gemi":
      return (
        <g>
          <path d="M-260 -90 L260 -90 Q230 0 140 10 L-160 10 Q-240 0 -260 -90 Z" fill="#7a5233" {...outline} />
          <path d="M-240 -70 L240 -70" stroke="#5a3a22" strokeWidth={8} />
          <path d="M-10 -90 L-10 -420" stroke={INK} strokeWidth={14} />
          <path d="M-10 -90 L-10 -420" stroke="#8a5a34" strokeWidth={8} />
          <path d="M0 -400 Q120 -320 0 -150 Z" fill="#f4ecd6" {...outline} />
          <path d="M-20 -380 Q-120 -300 -20 -170 Z" fill="#efe4c8" {...outline} />
        </g>
      );
    case "masa":
      return (
        <g>
          <path d="M-170 -120 L170 -120 L180 -96 L-180 -96 Z" fill="#8a5a34" {...outline} />
          <path d="M-150 -96 L-150 0 M150 -96 L150 0" stroke={INK} strokeWidth={22} />
          <path d="M-150 -96 L-150 0 M150 -96 L150 0" stroke="#6b4428" strokeWidth={12} />
          <path d="M-90 -126 L60 -134 L70 -122 L-80 -120 Z" fill="#f1dfb0" stroke={INK} strokeWidth={4} />
        </g>
      );
    case "sancak":
      return (
        <g>
          <path d="M-5 0 L-5 -520 L5 -520 L5 0 Z" fill="#7a5233" {...outline} />
          <circle cx={0} cy={-528} r={14} fill={GOLD} {...outline} />
          <path d="M5 -510 Q90 -490 170 -505 L150 -440 L170 -380 Q90 -365 5 -385 Z" fill="#b3263a" {...outline} />
          <path d="M5 -500 Q90 -480 160 -495" fill="none" stroke={GOLD} strokeWidth={5} />
        </g>
      );
  }
}
