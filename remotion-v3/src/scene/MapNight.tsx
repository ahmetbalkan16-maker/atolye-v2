import React from "react";
import type { V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";
import { searchlights } from "./mapEffects";

/**
 * A night map (the script's `harita.zaman: "gece"`; owner, 11 Nov 2026: Taranto's night raid was shown in daylight): the
 * land, sea, states and routes under a dark blue grade, and searchlights sweeping over the harbour. Drawn under the
 * tokens, vehicles and badges, so what the story moves stays readable and its fire glows against the dark.
 */
export function MapNight({ map, frame, fps, k, id, view }: { map: V3GeoMap; frame: number; fps: number; k: number; id: string; view: { x0: number; y0: number; x1: number; y1: number } }) {
  const world = map.world ?? { width: view.x1 - view.x0, height: view.y1 - view.y0 };
  const L = 620 * k;
  return (
    <g pointerEvents="none">
      <defs>
        <linearGradient id={`${id}-beam`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fff6d2" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#fff6d2" stopOpacity={0} />
        </linearGradient>
      </defs>
      <rect x={-world.width} y={-world.height} width={world.width * 3} height={world.height * 3} fill="#06112a" opacity={0.58} />
      {searchlights(map, view, frame, fps).map((b, i) => (
        <g key={i} transform={`translate(${b.x} ${b.y}) rotate(${(b.angle * 180) / Math.PI})`}>
          <path d={`M0 ${-5 * k} L${L} ${-L * 0.11} L${L} ${L * 0.11} L0 ${5 * k} Z`} fill={`url(#${id}-beam)`} style={{ mixBlendMode: "screen" }} />
          <circle r={6 * k} fill="#fff6d2" />
        </g>
      ))}
    </g>
  );
}
