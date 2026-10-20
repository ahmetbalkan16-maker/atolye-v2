import React, { useId } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";
import { INK } from "../character/rig";

const OCEAN = "#22406a";
const OCEAN_DEEP = "#172e4f";
const LAND = "#cfd9a6";
const LAND_SHADE = "#b9c78d";
const COAST = "#f6f2e4";
const RIVER = "#4f8cc2";
const LABEL_FONT = "'Segoe UI Black', 'Arial Black', sans-serif";

/**
 * A drawn map in the reference channel's manner: deep blue sea, flat green land with a pale coastline, rivers;
 * territories fade in over the land (clipped to the coast) with their names, armies pop in as coloured blocks, arrows
 * draw themselves along their path. Coordinates arrive in frame pixels.
 */
export function MapView({ map, width: W, height: H }: { map: V3GeoMap; width: number; height: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const k = H / 1080;
  const label = (text: string, x: number, y: number, size: number, opacity = 1) => (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" opacity={opacity} style={{ font: `900 ${size * k}px ${LABEL_FONT}`, letterSpacing: 1.5 * k }} fill="#ffffff" stroke={INK} strokeWidth={8 * k} paintOrder="stroke fill" strokeLinejoin="round">
      {text.toLocaleUpperCase("en-US")}
    </text>
  );
  return (
    <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
      <defs>
        <radialGradient id={`${id}-sea`} cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor={OCEAN} />
          <stop offset="100%" stopColor={OCEAN_DEEP} />
        </radialGradient>
        <clipPath id={`${id}-land`}>
          <path d={map.land} clipRule="evenodd" />
        </clipPath>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill={`url(#${id}-sea)`} />
      {/* A soft shadow under the land lifts it off the sea. */}
      <path d={map.land} transform={`translate(${5 * k} ${7 * k})`} fill="#0d1b30" opacity={0.35} fillRule="evenodd" />
      <path d={map.land} fill={LAND} fillRule="evenodd" />
      <g clipPath={`url(#${id}-land)`}>
        <path d={map.land} fill="none" stroke={LAND_SHADE} strokeWidth={26 * k} opacity={0.6} />
        {map.territories.map((t, i) => {
          const a = interpolate(frame, [t.start, t.start + Math.round(fps * 0.6)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return a > 0 ? <path key={i} d={t.d} fill={t.color} fillOpacity={0.78 * a} stroke="#ffffff" strokeOpacity={a} strokeWidth={4 * k} strokeLinejoin="round" fillRule="evenodd" /> : null;
        })}
      </g>
      <path d={map.lakes} fill={OCEAN} stroke={COAST} strokeWidth={2 * k} fillRule="evenodd" />
      <path d={map.rivers} fill="none" stroke={RIVER} strokeWidth={3 * k} strokeLinecap="round" strokeLinejoin="round" />
      <path d={map.land} fill="none" stroke={COAST} strokeWidth={3.5 * k} strokeLinejoin="round" />
      {map.cities.map((c, i) => (
        <g key={`c${i}`}>
          <circle cx={c.x} cy={c.y} r={11 * k} fill="#ffffff" stroke={INK} strokeWidth={5 * k} />
          <text x={c.x + 18 * k} y={c.y + 2 * k} dominantBaseline="middle" style={{ font: `800 ${30 * k}px 'Segoe UI', Arial, sans-serif` }} fill="#ffffff" stroke={INK} strokeWidth={7 * k} paintOrder="stroke fill">
            {c.label}
          </text>
        </g>
      ))}
      {map.territories.map((t, i) => {
        if (t.labelX === undefined || t.labelY === undefined) return null;
        const a = interpolate(frame, [t.start + 6, t.start + Math.round(fps * 0.8)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return a > 0 ? <g key={`tl${i}`}>{label(t.label, t.labelX, t.labelY, 46, a)}</g> : null;
      })}
      {map.armies.map((a, i) => {
        if (frame < a.start) return null;
        const pop = spring({ frame: frame - a.start, fps, config: { damping: 11, stiffness: 200 } });
        return (
          <g key={`a${i}`} transform={`translate(${a.x} ${a.y}) scale(${pop})`}>
            <rect x={-34 * k} y={-22 * k} width={68 * k} height={44 * k} rx={6 * k} fill={a.color} stroke="#ffffff" strokeWidth={5 * k} />
            <path d={`M${-34 * k} ${-22 * k} L${34 * k} ${22 * k} M${34 * k} ${-22 * k} L${-34 * k} ${22 * k}`} stroke="#ffffff" strokeWidth={4 * k} opacity={0.85} />
            <g transform={`translate(0 ${-48 * k})`}>{label(a.label, 0, 0, 30)}</g>
          </g>
        );
      })}
      {map.arrows.map((ar, i) => {
        if (frame < ar.start || ar.points.length < 2) return null;
        const draw = interpolate(frame, [ar.start, ar.start + Math.round(fps * 1.2)], [1, 0], { extrapolateRight: "clamp" });
        // A smooth path through the points (quadratic midpoints), so marches curve like the reference maps.
        const p = ar.points;
        let d = `M${p[0]!.x} ${p[0]!.y}`;
        for (let j = 1; j < p.length - 1; j++) d += ` Q${p[j]!.x} ${p[j]!.y} ${(p[j]!.x + p[j + 1]!.x) / 2} ${(p[j]!.y + p[j + 1]!.y) / 2}`;
        const last = p[p.length - 1]!;
        const prev = p[p.length - 2]!;
        d += ` L${last.x} ${last.y}`;
        const ang = (Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI;
        const mid = p[Math.floor((p.length - 1) / 2)]!;
        return (
          <g key={`r${i}`}>
            <path d={d} fill="none" stroke={INK} strokeWidth={24 * k} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={draw} />
            <path d={d} fill="none" stroke={ar.color} strokeWidth={14 * k} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={draw} />
            {draw < 0.02 ? <path transform={`translate(${last.x} ${last.y}) rotate(${ang})`} d={`M${22 * k} 0 L${-24 * k} ${-28 * k} L${-12 * k} 0 L${-24 * k} ${28 * k} Z`} fill={ar.color} stroke={INK} strokeWidth={5 * k} strokeLinejoin="round" /> : null}
            {ar.label && draw < 0.5 ? <g transform={`translate(${mid.x} ${mid.y - 40 * k})`}>{label(ar.label, 0, 0, 32)}</g> : null}
          </g>
        );
      })}
    </svg>
  );
}
