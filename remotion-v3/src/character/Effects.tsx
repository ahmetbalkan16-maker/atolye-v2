import React from "react";
import type { V3Effect } from "../../../src/lib/v3/render/RenderPlanTypes";
import { easeOutBack, INK } from "./rig";

/** Screen-space overlays above a head (never mirrored, so "?" stays readable). `r` is the head radius in px. */
export function Effect({ effect, progress, x, y, r }: { effect: V3Effect; progress: number; x: number; y: number; r: number }) {
  const pop = easeOutBack(Math.min(1, progress * 5));
  const fade = progress > 0.85 ? (1 - progress) / 0.15 : 1;
  switch (effect) {
    case "unlem":
    case "soru": {
      const cx = x + r * 0.95, cy = y - r * 1.55;
      return (
        <g opacity={fade} transform={`translate(${cx} ${cy}) scale(${pop * (r / 100)}) rotate(${effect === "unlem" ? 8 : -8})`}>
          <path d="M0 -64 L18 -40 L46 -48 L34 -20 L60 0 L34 16 L44 46 L14 32 L0 60 L-14 32 L-44 46 L-34 16 L-60 0 L-34 -20 L-46 -48 L-18 -40 Z" fill={effect === "unlem" ? "#ffd23f" : "#9ad1ff"} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
          <text x={0} y={22} textAnchor="middle" fontFamily="Arial Black, Segoe UI Black, sans-serif" fontWeight={900} fontSize={66} fill={INK}>
            {effect === "unlem" ? "!" : "?"}
          </text>
        </g>
      );
    }
    case "ter": {
      const drift = progress * r * 0.5;
      return (
        <g opacity={fade} transform={`translate(${x + r * 0.92} ${y - r * 0.45 + drift}) scale(${r / 100})`}>
          <path d="M0 -26 C10 -10 16 0 16 8 C16 18 8 24 0 24 C-8 24 -16 18 -16 8 C-16 0 -10 -10 0 -26 Z" fill="#7cc8ff" stroke={INK} strokeWidth={4.5} />
          <path d="M-6 6 Q-6 14 0 16" stroke="#ffffff" strokeWidth={4} fill="none" strokeLinecap="round" />
        </g>
      );
    }
    case "ofke": {
      const pulse = 1 + 0.12 * Math.sin(progress * 40);
      return (
        <g opacity={fade} transform={`translate(${x + r * 0.7} ${y - r * 0.85}) scale(${(r / 100) * pulse * pop})`}>
          {[0, 90, 180, 270].map((a) => (
            <path key={a} transform={`rotate(${a})`} d="M6 -26 Q8 -10 24 -8" fill="none" stroke="#e0283c" strokeWidth={9} strokeLinecap="round" />
          ))}
        </g>
      );
    }
    case "parilti": {
      const stars = [
        [-1.15, -0.9, 1],
        [1.2, -1.05, 0.8],
        [1.35, 0.1, 0.6],
        [-1.3, 0.2, 0.7],
      ];
      return (
        <g opacity={fade}>
          {stars.map(([sx, sy, s], i) => {
            const tw = 0.6 + 0.4 * Math.sin(progress * 30 + i * 1.7);
            return (
              <path
                key={i}
                transform={`translate(${x + sx! * r} ${y + sy! * r}) scale(${(r / 100) * s! * tw})`}
                d="M0 -26 Q4 -4 26 0 Q4 4 0 26 Q-4 4 -26 0 Q-4 -4 0 -26 Z"
                fill="#ffe066"
                stroke={INK}
                strokeWidth={4}
              />
            );
          })}
        </g>
      );
    }
    case "kalp": {
      const rise = progress * r * 0.8;
      return (
        <g opacity={fade} transform={`translate(${x + r * 0.9} ${y - r * 1.1 - rise}) scale(${(r / 100) * pop})`}>
          <path d="M0 22 C-30 0 -30 -24 -12 -24 C-4 -24 0 -16 0 -12 C0 -16 4 -24 12 -24 C30 -24 30 0 0 22 Z" fill="#ff5d73" stroke={INK} strokeWidth={4.5} />
        </g>
      );
    }
  }
}
