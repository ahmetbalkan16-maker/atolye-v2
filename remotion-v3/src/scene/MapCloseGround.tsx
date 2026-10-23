import React from "react";
import { interpolate } from "remotion";
import type { V3GeoMap, V3LabelSpot } from "../../../src/lib/v3/render/RenderPlanTypes";
import { Burst } from "./MapUnits";

/**
 * The close battle map's ground (owner, 22 Oct 2026, after DFT Tarih's Osman Bey documentary: "the ground there, the
 * walls, the castle, the cannons, the ships"): woods and fields over the real elevation, roads, a city's roofs, a
 * village, an army camp's tents, the walls with their towers and gates — which break open at the breach when its line
 * comes — and the story's buildings, drawn like a painted battle map. World pixels, everything sized from `unit`
 * (a house); the camera's zoom enlarges it like the ground itself.
 */

type Close = NonNullable<V3GeoMap["close"]>;
type Label = (text: string, size: number) => React.ReactNode;
type Spot = V3LabelSpot | undefined;

/** How long a town's fire takes to spread from where it caught to its far side (seconds). */
const FIRE_SPREAD_S = 6;

const STONE = "#c2b79f";
const STONE_DARK = "#4a4237";
const ROOFS = ["#b5563a", "#a0482f", "#c46a45", "#8e5a3a", "#b9a68c", "#a8623f"];

function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 4.1414) * 43758.5453;
  return x - Math.floor(x);
}

/** A clump of trees: shadows first, then crowns with a lit side. */
function Woods({ x, y, size, seed, u }: { x: number; y: number; size: number; seed: number; u: number }) {
  const n = 5 + Math.floor(rand(seed) * 5);
  const trees = Array.from({ length: n }, (_, i) => {
    const a = rand(seed + i * 3) * Math.PI * 2;
    const d = Math.sqrt(rand(seed + i * 5)) * size * 0.42;
    return { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.8, r: u * (0.45 + rand(seed + i * 7) * 0.3) };
  }).sort((a, b) => a.y - b.y);
  return (
    <g>
      {trees.map((t, i) => (
        <ellipse key={`s${i}`} cx={t.x + t.r * 0.35} cy={t.y + t.r * 0.45} rx={t.r} ry={t.r * 0.7} fill="#1f2a12" opacity={0.3} />
      ))}
      {trees.map((t, i) => (
        <g key={i}>
          <circle cx={t.x} cy={t.y} r={t.r} fill={i % 3 ? "#4b6a2c" : "#3e5a24"} stroke="#26361a" strokeWidth={u * 0.06} />
          <circle cx={t.x - t.r * 0.3} cy={t.y - t.r * 0.32} r={t.r * 0.45} fill="#6f9440" opacity={0.85} />
        </g>
      ))}
    </g>
  );
}

/** A patch of fields: strips in two or three crops with their furrows. */
function Fields({ x, y, size, seed, u }: { x: number; y: number; size: number; seed: number; u: number }) {
  const angle = (rand(seed) - 0.5) * 50;
  const strips = 3 + Math.floor(rand(seed + 1) * 3);
  const w = size;
  const h = size * 0.68;
  const tones = ["#cdb96c", "#b9a85c", "#a3b061", "#d6c47f"];
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`} opacity={0.82}>
      {Array.from({ length: strips }, (_, i) => (
        <g key={i}>
          <rect x={-w / 2 + (w / strips) * i} y={-h / 2} width={w / strips} height={h} fill={tones[(i + Math.floor(rand(seed + 2) * 4)) % 4]} stroke="#7c6d3c" strokeWidth={u * 0.05} />
          {[0.25, 0.5, 0.75].map((f) => (
            <path key={f} d={`M${-w / 2 + (w / strips) * i + u * 0.12} ${-h / 2 + h * f} h${w / strips - u * 0.24}`} stroke="#8a7a45" strokeWidth={u * 0.04} opacity={0.6} />
          ))}
        </g>
      ))}
    </g>
  );
}

/** A named hill: brown mounds lit from the north-west, like the painted maps' hills. */
function Hill({ x, y, size, seed, u }: { x: number; y: number; size: number; seed: number; u: number }) {
  const mounds = [0, 1, 2].map((i) => ({ dx: (rand(seed + i) - 0.5) * size * 0.6, dy: (rand(seed + i + 9) - 0.5) * size * 0.25, w: size * (0.35 + rand(seed + i + 4) * 0.2) }));
  return (
    <g>
      {mounds.map((m, i) => (
        <g key={i} transform={`translate(${x + m.dx} ${y + m.dy})`}>
          <ellipse cx={m.w * 0.12} cy={m.w * 0.05} rx={m.w} ry={m.w * 0.42} fill="#2a1d12" opacity={0.25} />
          <path d={`M${-m.w} 0 Q${-m.w * 0.4} ${-m.w * 0.9} 0 ${-m.w * 0.62} Q${m.w * 0.5} ${-m.w * 0.8} ${m.w} 0 Z`} fill="#7a5a3c" stroke="#3d2a1a" strokeWidth={u * 0.06} />
          <path d={`M${-m.w * 0.85} ${-m.w * 0.05} Q${-m.w * 0.4} ${-m.w * 0.8} 0 ${-m.w * 0.58} Q${-m.w * 0.25} ${-m.w * 0.3} ${-m.w * 0.5} 0 Z`} fill="#a07a52" opacity={0.75} />
        </g>
      ))}
    </g>
  );
}

/** One house seen from above: its yard, a pitched roof with the ridge's shade. */
function House({ x, y, angle, seed, u }: { x: number; y: number; angle: number; seed: number; u: number }) {
  const w = u * (0.7 + rand(seed) * 0.35);
  const h = u * (0.5 + rand(seed + 1) * 0.25);
  const roof = ROOFS[Math.floor(rand(seed + 2) * ROOFS.length)]!;
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <rect x={-w / 2 - u * 0.25} y={-h / 2 - u * 0.25} width={w + u * 0.5} height={h + u * 0.5} fill="#d8ccad" opacity={0.55} />
      <rect x={-w / 2 + u * 0.08} y={-h / 2 + u * 0.1} width={w} height={h} fill="#1c140c" opacity={0.3} />
      <rect x={-w / 2} y={-h / 2} width={w} height={h} fill={roof} stroke="#3a2618" strokeWidth={u * 0.06} />
      <rect x={-w / 2} y={0} width={w} height={h / 2} fill="#000000" opacity={0.18} />
      <path d={`M${-w / 2} 0 H${w / 2}`} stroke="#3a2618" strokeWidth={u * 0.05} />
    </g>
  );
}

/** A tent of the camp in the painted maps' side view: a bell tent with its door, shadow and now and then a pennant. */
function Tent({ x, y, seed, u }: { x: number; y: number; seed: number; u: number }) {
  const w = u * (0.55 + rand(seed) * 0.15);
  const h = w * 1.05;
  const cloth = rand(seed + 3) < 0.25 ? "#d9c7a0" : "#f1e9d6";
  const band = rand(seed + 5) < 0.35 ? "#b83a2e" : undefined;
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={w * 0.25} cy={0} rx={w * 0.85} ry={w * 0.28} fill="#1c140c" opacity={0.3} />
      <path d={`M${-w * 0.7} 0 Q${-w * 0.55} ${-h * 0.45} 0 ${-h} Q${w * 0.55} ${-h * 0.45} ${w * 0.7} 0 Z`} fill={cloth} stroke="#5a4a32" strokeWidth={u * 0.06} strokeLinejoin="round" />
      <path d={`M0 ${-h} Q${w * 0.55} ${-h * 0.45} ${w * 0.7} 0 L${w * 0.1} 0 Z`} fill="#000000" opacity={0.13} />
      {band ? <path d={`M${-w * 0.5} ${-h * 0.32} Q0 ${-h * 0.38} ${w * 0.5} ${-h * 0.32}`} stroke={band} strokeWidth={u * 0.1} fill="none" /> : null}
      <path d={`M${-w * 0.12} 0 L0 ${-h * 0.42} L${w * 0.12} 0 Z`} fill="#4a3a26" />
      {rand(seed + 9) < 0.2 ? <path d={`M0 ${-h} V${-h - u * 0.45} L${u * 0.32} ${-h - u * 0.36} L0 ${-h - u * 0.27}`} stroke="#5a4a32" strokeWidth={u * 0.05} fill="#b83a2e" /> : null}
    </g>
  );
}

/** Fire and smoke on a burning house (from `p` 0: catching). */
function Flames({ x, y, u, frame, seed, grow }: { x: number; y: number; u: number; frame: number; seed: number; grow: number }) {
  const flick = 0.75 + Math.sin(frame * 0.7 + seed) * 0.15 + Math.sin(frame * 1.9 + seed * 2) * 0.1;
  const rise = ((frame * 0.03 + rand(seed)) % 1 + 1) % 1;
  return (
    <g opacity={grow}>
      <circle cx={x + u * 0.4 * rise} cy={y - u * (0.8 + rise * 2.6)} r={u * (0.5 + rise * 1.1)} fill="#3b3631" opacity={0.5 * (1 - rise)} />
      <path d={`M${x - u * 0.45} ${y + u * 0.2} Q${x - u * 0.5} ${y - u * 0.6 * flick} ${x} ${y - u * 1.2 * flick} Q${x + u * 0.5} ${y - u * 0.6 * flick} ${x + u * 0.45} ${y + u * 0.2} Z`} fill="#ff8c1a" />
      <path d={`M${x - u * 0.22} ${y + u * 0.15} Q${x - u * 0.25} ${y - u * 0.3 * flick} ${x} ${y - u * 0.7 * flick} Q${x + u * 0.25} ${y - u * 0.3 * flick} ${x + u * 0.22} ${y + u * 0.15} Z`} fill="#ffd166" />
    </g>
  );
}

/** A building of the story in the painted maps' oblique view, standing on its place. */
function Building({ kind, u }: { kind: Close["buildings"][number]["kind"]; u: number }) {
  const s = { stroke: STONE_DARK, strokeWidth: u * 0.08, strokeLinejoin: "round" as const };
  const merlons = (x0: number, x1: number, y: number) => {
    const n = Math.max(2, Math.round((x1 - x0) / (u * 0.45)));
    return Array.from({ length: n }, (_, i) => <rect key={i} x={x0 + ((x1 - x0) / n) * i} y={y - u * 0.22} width={((x1 - x0) / n) * 0.55} height={u * 0.24} fill={STONE} {...s} strokeWidth={u * 0.05} />);
  };
  switch (kind) {
    case "kale":
      return (
        <g>
          <rect x={-u * 1.6} y={-u * 1.6} width={u * 3.2} height={u * 1.6} fill={STONE} {...s} />
          {merlons(-u * 1.6, u * 1.6, -u * 1.6)}
          {[-1.6, 1.0].map((tx) => (
            <g key={tx}>
              <rect x={u * tx} y={-u * 2.4} width={u * 0.6} height={u * 2.4} fill="#b0a58c" {...s} />
              {merlons(u * tx, u * (tx + 0.6), -u * 2.4)}
            </g>
          ))}
          <rect x={-u * 0.5} y={-u * 2.9} width={u * 1} height={u * 1.5} fill="#cbbfa6" {...s} />
          {merlons(-u * 0.5, u * 0.5, -u * 2.9)}
          <path d={`M${-u * 0.3} 0 V${-u * 0.6} A${u * 0.3} ${u * 0.3} 0 0 1 ${u * 0.3} ${-u * 0.6} V0 Z`} fill="#2b231b" />
        </g>
      );
    case "saray":
      return (
        <g>
          <rect x={-u * 2.2} y={-u * 1.1} width={u * 4.4} height={u * 1.1} fill="#e2d6bb" {...s} />
          {[-1.4, 0, 1.4].map((dx) => (
            <path key={dx} d={`M${u * (dx - 0.45)} ${-u * 1.1} A${u * 0.45} ${u * 0.42} 0 0 1 ${u * (dx + 0.45)} ${-u * 1.1} Z`} fill="#8d9ba5" {...s} />
          ))}
          {Array.from({ length: 7 }, (_, i) => (
            <rect key={i} x={-u * 1.95 + i * u * 0.6} y={-u * 0.75} width={u * 0.22} height={u * 0.4} fill="#4a3a2a" />
          ))}
        </g>
      );
    case "kilise":
      // A great church like Hagia Sophia: a broad dome over half-domes and a heavy block.
      return (
        <g>
          <rect x={-u * 2} y={-u * 1.2} width={u * 4} height={u * 1.2} fill="#c99a83" {...s} />
          <path d={`M${-u * 1.7} ${-u * 1.2} A${u * 0.8} ${u * 0.55} 0 0 1 ${-u * 0.4} ${-u * 1.2} Z M${u * 0.4} ${-u * 1.2} A${u * 0.8} ${u * 0.55} 0 0 1 ${u * 1.7} ${-u * 1.2} Z`} fill="#8d9ba5" {...s} />
          <rect x={-u * 0.9} y={-u * 1.7} width={u * 1.8} height={u * 0.5} fill="#c99a83" {...s} />
          <path d={`M${-u * 1.05} ${-u * 1.7} A${u * 1.05} ${u * 0.95} 0 0 1 ${u * 1.05} ${-u * 1.7} Z`} fill="#9aa8b2" {...s} />
          <path d={`M0 ${-u * 2.65} V${-u * 3.1} M${-u * 0.15} ${-u * 2.95} H${u * 0.15}`} stroke={STONE_DARK} strokeWidth={u * 0.08} />
        </g>
      );
    case "cami":
      return (
        <g>
          <rect x={-u * 1.4} y={-u * 1} width={u * 2.8} height={u * 1} fill="#ece2cc" {...s} />
          <path d={`M${-u * 0.95} ${-u * 1} A${u * 0.95} ${u * 0.9} 0 0 1 ${u * 0.95} ${-u * 1} Z`} fill="#8d9ba5" {...s} />
          {[-1.7, 1.5].map((dx) => (
            <g key={dx}>
              <rect x={u * dx} y={-u * 3} width={u * 0.22} height={u * 3} fill="#ece2cc" {...s} strokeWidth={u * 0.05} />
              <path d={`M${u * dx - u * 0.04} ${-u * 3} L${u * (dx + 0.11)} ${-u * 3.6} L${u * (dx + 0.26)} ${-u * 3} Z`} fill="#8d9ba5" {...s} strokeWidth={u * 0.05} />
            </g>
          ))}
        </g>
      );
    case "kule":
      return (
        <g>
          <rect x={-u * 0.55} y={-u * 2.6} width={u * 1.1} height={u * 2.6} fill={STONE} {...s} />
          <path d={`M${-u * 0.75} ${-u * 2.6} L0 ${-u * 3.7} L${u * 0.75} ${-u * 2.6} Z`} fill="#7d5a44" {...s} />
          {[-1.9, -1.2].map((dy) => (
            <rect key={dy} x={-u * 0.12} y={u * dy} width={u * 0.24} height={u * 0.36} fill="#2b231b" />
          ))}
        </g>
      );
    case "otag":
      return (
        <g>
          <path d={`M${-u * 1.8} 0 L${-u * 1.2} ${-u * 1.3} L0 ${-u * 2} L${u * 1.2} ${-u * 1.3} L${u * 1.8} 0 Z`} fill="#c0392b" {...s} />
          <path d={`M${-u * 1.2} ${-u * 1.3} L0 ${-u * 2} L${u * 1.2} ${-u * 1.3} Z`} fill="#e8c25a" {...s} />
          <path d={`M${-u * 0.35} 0 V${-u * 0.8} H${u * 0.35} V0 Z`} fill="#4a1f17" />
          <path d={`M0 ${-u * 2} V${-u * 2.9}`} stroke={STONE_DARK} strokeWidth={u * 0.07} />
          <path d={`M0 ${-u * 2.9} L${u * 0.75} ${-u * 2.7} L0 ${-u * 2.5} Z`} fill="#c0392b" {...s} strokeWidth={u * 0.05} />
        </g>
      );
  }
}

/**
 * Where a wall's name goes: beside its middle, on the side away from the town it guards (written over the town it hid
 * among the houses and under the defenders' tokens).
 */
function wallLabelAt(w: Close["walls"][number], towns: Close["settlements"], u: number): { x: number; y: number } {
  const i = Math.max(1, Math.floor(w.points.length / 2));
  const a = w.points[i - 1]!;
  const b = w.points[i]!;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const normal = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const town = [...towns].sort((p, q) => Math.hypot(p.x - mid.x, p.y - mid.y) - Math.hypot(q.x - mid.x, q.y - mid.y))[0];
  const side = town && (town.x - mid.x) * normal.x + (town.y - mid.y) * normal.y > 0 ? -1 : 1;
  return { x: mid.x + normal.x * side * u * 5, y: mid.y + normal.y * side * u * 5 };
}

/**
 * Houses on fire at a frame: the fire catches where it started (the breach, else the town's middle) and spreads to the
 * far side in FIRE_SPREAD_S — dense where it caught, sparser further on — each house taking a second to blaze up.
 */
function burning(s: Close["settlements"][number], frame: number, fps: number): { it: Close["settlements"][number]["items"][number]; grow: number }[] {
  if (s.burn === undefined || frame < s.burn || !s.items.length) return [];
  const from = s.burnFrom ?? { x: s.x, y: s.y };
  const dist = s.items.map((it) => Math.hypot(it.x - from.x, it.y - from.y));
  const far = Math.max(...dist) || 1;
  const out: { it: Close["settlements"][number]["items"][number]; grow: number }[] = [];
  s.items.forEach((it, i) => {
    const f = dist[i]! / far;
    if (rand(it.seed + 31) >= 0.5 - 0.33 * f) return;
    const at = s.burn! + Math.round(f * FIRE_SPREAD_S * fps);
    const grow = interpolate(frame, [at, at + fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    if (grow > 0) out.push({ it, grow });
  });
  return out;
}

/** A road's name along it, like an atlas's: small parchment italics. */
function RoadName({ text, k }: { text: string; k: number }) {
  return (
    <text x={0} y={7 * k} textAnchor="middle" style={{ font: `italic 700 ${22 * k}px Georgia, 'Palatino Linotype', serif`, letterSpacing: 1 * k }} fill="#f1e0b5" stroke="rgba(20,12,4,0.75)" strokeWidth={3.5 * k} paintOrder="stroke fill" strokeLinejoin="round">
      {text}
    </text>
  );
}

/**
 * The close map's ground features, between the coloured states and the cities, tokens and ships. `k`: world px per
 * 1080p screen px at this frame, for the names' places (placeCloseLabels' spots: an anchor plus a screen offset).
 */
export function CloseGround({ close, frame, fps, era, label, k }: { close: Close; frame: number; fps: number; era: V3GeoMap["era"]; label: Label; k: number }) {
  const u = close.unit;
  const at = (spot: Spot, x: number, y: number) => (spot ? `translate(${spot.x + spot.dx * k} ${spot.y + spot.dy * k})` : `translate(${x} ${y})`);
  return (
    <g>
      {close.ground.map((g, i) => (g.kind === "orman" ? <Woods key={`g${i}`} {...g} u={u} /> : g.kind === "tarla" ? <Fields key={`g${i}`} {...g} u={u} /> : <Hill key={`g${i}`} {...g} u={u} />))}
      {close.roads.map((r, i) => {
        const d = `M${r.map((p) => `${p.x} ${p.y}`).join(" L")}`;
        return (
          <g key={`r${i}`}>
            <path d={d} fill="none" stroke="#8c7a55" strokeWidth={u * 0.7} strokeLinecap="round" strokeLinejoin="round" />
            <path d={d} fill="none" stroke="#e1d4ad" strokeWidth={u * 0.45} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      })}
      {(close.roadNames ?? []).map((rn, i) => {
        const p = rn.labelSpot ?? close.roads[rn.road]?.[Math.floor((close.roads[rn.road]?.length ?? 1) / 2)];
        if (!p) return null;
        return (
          <g key={`rn${i}`} transform={`${at(rn.labelSpot, p.x, p.y)} rotate(${rn.angle})`}>
            <RoadName text={rn.label} k={k} />
          </g>
        );
      })}
      {close.settlements.map((s, si) => {
        const a = interpolate(frame, [s.start, s.start + Math.round(fps * 0.8)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        if (a <= 0) return null;
        return (
          <g key={`s${si}`} opacity={a}>
            {s.items.map((it) => (s.kind === "ordugah" ? <Tent key={it.seed} {...it} u={u} /> : <House key={it.seed} {...it} u={u} />))}
            {burning(s, frame, fps).map(({ it, grow }) => (
              <Flames key={`f${it.seed}`} x={it.x} y={it.y} u={u} frame={frame} seed={it.seed} grow={grow} />
            ))}
            {s.label ? <g transform={at(s.labelSpot, s.x, s.y)}>{label(s.label, 30)}</g> : null}
          </g>
        );
      })}
      {close.walls.map((w, wi) => {
        const d = `M${w.points.map((p) => `${p.x} ${p.y}`).join(" L")}`;
        const broken = w.breach !== undefined && frame >= w.breach.start;
        const id = `wall-breach-${wi}`;
        return (
          <g key={`w${wi}`}>
            {broken ? (
              <defs>
                <mask id={id} maskUnits="userSpaceOnUse" x={-1e5} y={-1e5} width={2e5} height={2e5}>
                  <rect x={-1e5} y={-1e5} width={2e5} height={2e5} fill="#ffffff" />
                  <circle cx={w.breach!.x} cy={w.breach!.y} r={u * 1.5} fill="#000000" />
                </mask>
              </defs>
            ) : null}
            <g mask={broken ? `url(#${id})` : undefined}>
              {/* A wall a city stood behind for a thousand years: broad, with a dark face and a walkway of merlons. */}
              <path d={d} fill="none" stroke="#000000" strokeOpacity={0.35} strokeWidth={u * 1.3} strokeLinejoin="round" transform={`translate(${u * 0.2} ${u * 0.28})`} />
              <path d={d} fill="none" stroke={STONE_DARK} strokeWidth={u * 1.0} strokeLinejoin="round" strokeLinecap="round" />
              <path d={d} fill="none" stroke={STONE} strokeWidth={u * 0.72} strokeLinejoin="round" strokeLinecap="round" />
              <path d={d} fill="none" stroke={STONE_DARK} strokeWidth={u * 0.2} strokeDasharray={`${u * 0.26} ${u * 0.24}`} />
              {w.towers.map((t, ti) => (
                <g key={ti}>
                  <rect x={t.x - u * 0.68 + u * 0.15} y={t.y - u * 0.68 + u * 0.2} width={u * 1.36} height={u * 1.36} fill="#000000" opacity={0.3} />
                  <rect x={t.x - u * 0.68} y={t.y - u * 0.68} width={u * 1.36} height={u * 1.36} fill={STONE} stroke={STONE_DARK} strokeWidth={u * 0.14} />
                  <rect x={t.x - u * 0.36} y={t.y - u * 0.36} width={u * 0.72} height={u * 0.72} fill="#a69b83" />
                </g>
              ))}
              {w.gates.map((g, gi) => (
                <g key={gi} transform={`translate(${g.x} ${g.y}) rotate(${(g.angle * 180) / Math.PI})`}>
                  <rect x={-u * 0.85} y={-u * 0.85} width={u * 1.7} height={u * 1.7} fill={STONE} stroke={STONE_DARK} strokeWidth={u * 0.14} />
                  <rect x={-u * 0.3} y={-u * 0.95} width={u * 0.6} height={u * 1.9} fill="#2b231b" />
                </g>
              ))}
            </g>
            {broken ? (
              <g>
                {Array.from({ length: 9 }, (_, j) => (
                  <rect key={j} x={w.breach!.x + (rand(wi * 50 + j) - 0.5) * u * 2.4} y={w.breach!.y + (rand(wi * 50 + j + 20) - 0.5) * u * 1.6} width={u * (0.2 + rand(j + 3) * 0.25)} height={u * (0.18 + rand(j + 9) * 0.2)} fill={j % 2 ? STONE : "#9b907a"} stroke={STONE_DARK} strokeWidth={u * 0.04} transform={`rotate(${rand(j + 7) * 90} ${w.breach!.x} ${w.breach!.y})`} />
                ))}
                <Burst x={w.breach!.x} y={w.breach!.y} r={u * 2.2} p={(frame - w.breach!.start) / (fps * 1.6)} era={era} seed={wi + 77} />
              </g>
            ) : null}
            {w.label ? <g transform={w.labelSpot ? at(w.labelSpot, 0, 0) : `translate(${wallLabelAt(w, close.settlements, u).x} ${wallLabelAt(w, close.settlements, u).y})`}>{label(w.label, 26)}</g> : null}
          </g>
        );
      })}
      {close.buildings.map((b, i) => {
        const a = interpolate(frame, [b.start, b.start + Math.round(fps * 0.6)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return a > 0 ? (
          <g key={`b${i}`} opacity={a}>
            <ellipse cx={b.x + u * 0.3} cy={b.y + u * 0.15} rx={u * 2} ry={u * 0.45} fill="#1c140c" opacity={0.3} />
            <g transform={`translate(${b.x} ${b.y})`}>
              <Building kind={b.kind} u={u} />
            </g>
            {b.label ? <g transform={at(b.labelSpot, b.x, b.y + u * 1.1)}>{label(b.label, 24)}</g> : null}
          </g>
        ) : null;
      })}
    </g>
  );
}
