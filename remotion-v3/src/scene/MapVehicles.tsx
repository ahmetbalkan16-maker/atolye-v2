import React from "react";
import { Easing, interpolate } from "remotion";
import type { V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";
import { INK } from "../character/rig";
import { Burst } from "./MapUnits";
import { along, pathLength, smoothPoints } from "./mapGeometry";
import { fleetLeader, fleetMembers, isFleet } from "./mapFleet";
import { bankOf, COLUMN_S, flakAt, flakWindow, flaresAt, isNightMap, landRings, muzzleFx, oilSlick, onLand, planeSlot, raidOf, shellOutcome, shipTargeted, SHIP_SINK_S, sinkPose, TORPEDO_EVERY_S, TORPEDO_RUN_S, torpedoAt, torpedoAttacker, torpedoDropAt, torpedoStart, torpedoTarget, WATER_KINDS, waterColumn, WRECK_S, wreckSmoke } from "./mapEffects";

/**
 * Vehicles on the living map (owner, 22 Oct 2026, after the reference channel's WW2 map narration): galleys rowing,
 * sailing ships and steel warships with their wake, cavalry galloping in a cloud of dust, elephants, cannons, tanks and
 * planes, a side's few travelling together along their route. With a target they fire at it: a muzzle flash and smoke,
 * the shot arcing over, a burst where it lands (stones before gunpowder). Sizes are screen sizes (`k`).
 */

type Vehicle = NonNullable<V3GeoMap["vehicles"]>[number];
type P = { x: number; y: number };

/** A vehicle's half length on a 1080p screen. */
const SIZE = 30;
/** How long a firing goes on (seconds), and the time between one vehicle's shots. */
const FIRE_S = 6;
const SHOT_EVERY_S = 1.1;
const SHOT_FLIGHT_S = 0.7;
/** How long a lost vehicle takes to go down (seconds). */
const SINK_S = 1.6;
const WATER = WATER_KINDS;

function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** A vehicle drawn facing right in a box of half length 1, on its waterline/ground at y = 0.3. */
export function VehicleIcon({ kind, color, frame, moving }: { kind: Vehicle["kind"]; color: string; frame: number; moving: boolean }) {
  const s = { stroke: INK, strokeWidth: 0.06, strokeLinejoin: "round" as const };
  switch (kind) {
    case "kadirga": {
      // Oars sweep while it rows.
      const sweep = moving ? Math.sin(frame * 0.35) * 0.18 : 0;
      return (
        <g>
          {[-0.6, -0.35, -0.1, 0.15, 0.4].map((x, i) => (
            <path key={i} d={`M${x} 0.12 L${x - 0.18 + sweep} 0.5`} stroke="#3a2412" strokeWidth={0.06} strokeLinecap="round" />
          ))}
          <path d="M-1 -0.12 Q-0.95 0.22 -0.6 0.24 L0.7 0.24 Q0.95 0.2 1.12 -0.16 L0.9 -0.04 L-0.85 -0.04 Z" fill="#6b4423" {...s} />
          <path d="M0.05 -0.04 L0.05 -0.95" stroke="#3a2412" strokeWidth={0.07} />
          <path d="M0.05 -0.95 L0.62 -0.22 L-0.55 -0.16 Z" fill={color} {...s} />
          <path d="M0.05 -0.95 L0.32 -0.86 L0.05 -0.78 Z" fill={color} {...s} />
        </g>
      );
    }
    case "yelkenli":
      return (
        <g>
          <path d="M-1 -0.22 L-0.86 0.24 L0.78 0.24 L1.08 -0.26 Z" fill="#6b4423" {...s} />
          <path d="M-0.9 -0.06 L0.95 -0.06" stroke="#f1e0b5" strokeWidth={0.05} />
          {[-0.45, 0.1, 0.6].map((x, i) => {
            const h = i === 1 ? 1.05 : 0.85;
            return (
              <g key={i}>
                <path d={`M${x} -0.2 L${x} ${-h - 0.05}`} stroke="#3a2412" strokeWidth={0.06} />
                <path d={`M${x - 0.26} ${-h + 0.08} Q${x} ${-h + 0.02} ${x + 0.26} ${-h + 0.08} L${x + 0.24} ${-0.32} Q${x} ${-0.26} ${x - 0.24} ${-0.32} Z`} fill="#f3ead2" {...s} />
                <path d={`M${x} ${-h - 0.05} L${x + 0.24} ${-h + 0.02} L${x} ${-h + 0.08} Z`} fill={color} {...s} />
              </g>
            );
          })}
          <path d="M-0.18 -0.62 L0.38 -0.62" stroke={color} strokeWidth={0.12} />
        </g>
      );
    case "gemi":
      return (
        <g>
          <path d="M-1.05 -0.06 L-0.9 0.22 L0.86 0.22 L1.12 -0.06 Z" fill="#59626b" {...s} />
          <path d="M-0.55 -0.06 L-0.55 -0.3 L0.4 -0.3 L0.4 -0.06 Z" fill="#7b858f" {...s} />
          <path d="M-0.15 -0.3 L-0.15 -0.58 L0.12 -0.58 L0.12 -0.3 Z" fill="#3d444b" {...s} />
          <path d="M-0.15 -0.5 L0.12 -0.5" stroke={color} strokeWidth={0.1} />
          <path d="M0.55 -0.12 L0.95 -0.18" stroke="#3d444b" strokeWidth={0.07} strokeLinecap="round" />
          <path d="M-0.75 -0.12 L-1.05 -0.18" stroke="#3d444b" strokeWidth={0.07} strokeLinecap="round" />
          {/* Smoke from the funnel, drifting back. */}
          {[0, 1, 2].map((j) => {
            const t = ((frame * 0.02 + j / 3) % 1 + 1) % 1;
            return <circle key={j} cx={-0.02 - t * 0.7} cy={-0.66 - t * 0.35} r={0.1 + t * 0.14} fill="#55595e" opacity={0.55 * (1 - t)} />;
          })}
        </g>
      );
    case "denizalti":
      return (
        <g>
          <ellipse cx={0} cy={0.1} rx={1} ry={0.17} fill="#4a5058" {...s} />
          <path d="M-0.15 -0.07 L-0.12 -0.36 L0.22 -0.36 L0.26 -0.07 Z" fill="#5c636b" {...s} />
          <path d="M0.05 -0.36 L0.05 -0.55 L0.16 -0.55" fill="none" stroke={INK} strokeWidth={0.05} />
          <path d="M-0.12 -0.22 L0.22 -0.22" stroke={color} strokeWidth={0.08} />
          {/* The sea over its lower half. */}
          <rect x={-1.1} y={0.14} width={2.2} height={0.3} fill="#22406a" opacity={0.75} />
        </g>
      );
    case "suvari": {
      // A gallop: the body rises and falls, the legs scissor.
      const g = moving ? Math.sin(frame * 0.6) : 0;
      const leg = (x: number, phase: number) => {
        const a = moving ? Math.sin(frame * 0.6 + phase) * 0.35 : 0;
        return <path d={`M${x} -0.02 L${x + Math.sin(a) * 0.32} 0.3`} stroke="#5a3a20" strokeWidth={0.1} strokeLinecap="round" />;
      };
      return (
        <g transform={`translate(0 ${-Math.abs(g) * 0.06})`}>
          {leg(-0.45, 0)}
          {leg(-0.3, 1.6)}
          {leg(0.3, 3.1)}
          {leg(0.45, 4.7)}
          <ellipse cx={0} cy={-0.1} rx={0.6} ry={0.22} fill="#7a4e2a" {...s} />
          <path d="M0.42 -0.2 L0.72 -0.6 L0.95 -0.52 L0.68 -0.12 Z" fill="#7a4e2a" {...s} />
          <path d="M-0.58 -0.16 Q-0.82 -0.1 -0.86 0.12" fill="none" stroke="#3a2412" strokeWidth={0.08} strokeLinecap="round" />
          <path d="M-0.12 -0.3 L-0.08 -0.72 L0.16 -0.72 L0.18 -0.3 Z" fill={color} {...s} />
          <circle cx={0.04} cy={-0.86} r={0.14} fill="#f1d3b3" {...s} />
          <path d="M-0.3 -0.2 L0.55 -1.1" stroke="#3a2412" strokeWidth={0.05} />
          <path d="M0.55 -1.1 L0.25 -1.02 L0.42 -0.9 Z" fill={color} {...s} />
        </g>
      );
    }
    case "fil":
      return (
        <g>
          {[-0.45, -0.2, 0.25, 0.45].map((x, i) => (
            <rect key={i} x={x - 0.08} y={0} width={0.16} height={0.3} fill="#8a8f96" {...s} />
          ))}
          <ellipse cx={0} cy={-0.1} rx={0.62} ry={0.36} fill="#8a8f96" {...s} />
          <circle cx={0.62} cy={-0.24} r={0.24} fill="#8a8f96" {...s} />
          <path d="M0.8 -0.18 Q0.98 0.05 0.86 0.28" fill="none" stroke="#8a8f96" strokeWidth={0.12} strokeLinecap="round" />
          <path d="M0.72 -0.08 L0.95 -0.02" stroke="#f3ead2" strokeWidth={0.06} strokeLinecap="round" />
          <path d="M-0.32 -0.42 L-0.32 -0.72 L0.28 -0.72 L0.28 -0.42 Z" fill={color} {...s} />
        </g>
      );
    case "top":
      return (
        <g>
          <path d="M-0.55 0.12 L0.2 0.12 L0.05 -0.1 L-0.6 -0.05 Z" fill="#6b4423" {...s} />
          <path d="M-0.7 -0.18 L0.9 -0.48 L0.95 -0.28 L-0.62 0.02 Z" fill="#3d444b" {...s} />
          <path d="M-0.2 -0.2 L-0.12 0" stroke={color} strokeWidth={0.12} />
          <circle cx={-0.2} cy={0.12} r={0.24} fill="#8a5a2b" {...s} />
          <circle cx={-0.2} cy={0.12} r={0.05} fill={INK} />
        </g>
      );
    case "tank": {
      const turn = moving ? frame * 0.3 : 0;
      return (
        <g>
          <rect x={-0.95} y={-0.02} width={1.9} height={0.32} rx={0.16} fill="#3d444b" {...s} />
          {[-0.68, -0.34, 0, 0.34, 0.68].map((x, i) => (
            <g key={i} transform={`translate(${x} 0.14) rotate(${(turn * 57) % 360})`}>
              <circle r={0.11} fill="#59626b" stroke={INK} strokeWidth={0.04} />
              <path d="M-0.1 0 L0.1 0" stroke={INK} strokeWidth={0.03} />
            </g>
          ))}
          <path d="M-0.85 -0.02 L-0.75 -0.3 L0.8 -0.3 L0.9 -0.02 Z" fill={color} {...s} />
          <path d="M-0.35 -0.3 Q-0.3 -0.6 0.05 -0.6 Q0.35 -0.6 0.38 -0.3 Z" fill={color} {...s} />
          <path d="M0.3 -0.46 L1.15 -0.5" stroke={INK} strokeWidth={0.1} strokeLinecap="round" />
        </g>
      );
    }
    case "ucak":
      // Seen from above, nose to the right; the caller turns it along its course.
      return (
        <g>
          <path d="M-0.95 0 Q-0.7 -0.12 0.8 -0.1 Q1.05 0 0.8 0.1 Q-0.7 0.12 -0.95 0 Z" fill="#7b858f" {...s} />
          <path d="M0.1 -0.08 L-0.25 -1 L-0.48 -1 L-0.3 -0.08 Z" fill="#7b858f" {...s} />
          <path d="M0.1 0.08 L-0.25 1 L-0.48 1 L-0.3 0.08 Z" fill="#7b858f" {...s} />
          <path d="M-0.72 -0.06 L-0.92 -0.4 L-1.02 -0.4 L-0.9 -0.04 Z M-0.72 0.06 L-0.92 0.4 L-1.02 0.4 L-0.9 0.04 Z" fill="#7b858f" {...s} />
          <circle cx={-0.32} cy={-0.62} r={0.14} fill={color} stroke="#ffffff" strokeWidth={0.04} />
          <circle cx={-0.32} cy={0.62} r={0.14} fill={color} stroke="#ffffff" strokeWidth={0.04} />
          <ellipse cx={0.98} cy={0} rx={0.03} ry={0.3} fill="#ffffff" opacity={0.5} />
        </g>
      );
  }
}

/** The route's direction at a fraction of its length (radians). */
function headingAt(route: readonly P[], f: number): number {
  const a = along(route, Math.max(0, f - 0.01));
  const b = along(route, Math.min(1, f + 0.01));
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Where a vehicle is at `frame`, which way it heads (radians), whether it is under way, and how far along (0..1). */
function placeAt(v: Vehicle, route: readonly P[], frame: number, fps: number, travelS: number): { p: P; heading: number; moving: boolean; t: number } {
  if (route.length < 2 || v.moveStart === undefined) {
    const face = v.target ? Math.atan2(v.target.y - route[0]!.y, v.target.x - route[0]!.x) : 0;
    return { p: route[0]!, heading: face, moving: false, t: 0 };
  }
  const t = interpolate(frame, [v.moveStart, v.moveStart + Math.round(travelS * fps)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
  const moving = t > 0 && t < 1;
  const p = along(route, t);
  // Arrived with a target: it turns to face it.
  const heading = t >= 1 && v.target ? Math.atan2(v.target.y - p.y, v.target.x - p.x) : headingAt(route, t);
  return { p, heading, moving, t };
}

/** The part of a route between two fractions of its length. */
function stretch(route: readonly P[], from: number, to: number): P[] {
  const n = Math.max(2, Math.ceil((to - from) * 60));
  return Array.from({ length: n + 1 }, (_, j) => along(route, from + ((to - from) * j) / n));
}

/**
 * A ship hauled over land, under its hull and ahead of it, in the icon's box (facing right): a wooden cradle on three
 * greased logs that turn as it goes, and two ropes to a team of men leaning into them, stepping.
 */
function Haul({ frame, color }: { frame: number; color: string }) {
  const turn = (frame * 9) % 360;
  return (
    <g>
      <rect x={-0.85} y={0.22} width={1.7} height={0.1} rx={0.03} fill="#5b3b1c" stroke={INK} strokeWidth={0.04} />
      {[-0.6, 0, 0.6].map((x) => (
        <g key={x} transform={`translate(${x} 0.42) rotate(${turn})`}>
          <circle r={0.1} fill="#a4773f" stroke={INK} strokeWidth={0.04} />
          <path d="M-0.09 0 L0.09 0" stroke={INK} strokeWidth={0.03} />
        </g>
      ))}
      <path d="M1.02 -0.02 L1.55 0.12 M1.0 0.1 L1.55 0.3" stroke="#c9a46a" strokeWidth={0.035} fill="none" />
      {[0, 1, 2, 3].map((j) => {
        const x = 1.6 + (j % 2) * 0.32 + Math.floor(j / 2) * 0.62;
        const y = j % 2 ? 0.3 : 0.12;
        const step = Math.sin(frame * 0.45 + j * 1.7) * 0.07;
        return (
          <g key={j} transform={`translate(${x} ${y - 0.3})`}>
            <path d={`M0 -0.08 L-0.1 0.18 M-0.1 0.18 L${-0.16 + step} 0.36 M-0.1 0.18 L${-0.02 - step} 0.36 M-0.04 0.0 L-0.22 0.08`} stroke={INK} strokeWidth={0.045} strokeLinecap="round" fill="none" />
            <circle cx={0.02} cy={-0.14} r={0.07} fill="#f1d3b3" stroke={INK} strokeWidth={0.03} />
            <path d="M-0.05 -0.2 L0.09 -0.2 L0.02 -0.28 Z" fill={color} />
          </g>
        );
      })}
    </g>
  );
}

/** The white column a torpedo throws up out of the sea where it strikes a ship (`impact` 0..1, from the waterline). */
function WaterColumn({ x, y, S, impact }: { x: number; y: number; S: number; impact: number }) {
  const c = waterColumn(impact);
  if (!c) return null;
  const [h, w] = [c.h * S, c.w * S];
  return (
    <g opacity={c.alpha}>
      <path d={`M${x - w} ${y} Q${x - w * 0.45} ${y - h * 0.55} ${x - w * 0.35} ${y - h} Q${x} ${y - h * 1.15} ${x + w * 0.35} ${y - h} Q${x + w * 0.45} ${y - h * 0.55} ${x + w} ${y} Z`} fill="#f4f8fb" stroke="#8fa9be" strokeWidth={S * 0.05} />
      {[-1, -0.45, 0.45, 1].map((s, j) => (
        <circle key={j} cx={x + s * w * (1 + impact)} cy={y - h * (0.75 + 0.2 * Math.abs(s)) + impact * h * 0.7} r={S * 0.13} fill="#f4f8fb" />
      ))}
    </g>
  );
}

/** A torpedo's run: its white wake from where it entered the water to its head, and the splash where it went in. */
function TorpedoWake({ from, hit, since, S }: { from: P; hit: P; since: number; S: number }) {
  const run = torpedoAt(since, from, hit);
  if (!run) return null;
  const d = `M${from.x} ${from.y} L${run.head.x} ${run.head.y}`;
  return (
    <g>
      <path d={d} stroke="#ffffff" strokeOpacity={run.wake * 0.45} strokeWidth={S * 0.2} strokeLinecap="round" fill="none" />
      <path d={d} stroke="#ffffff" strokeOpacity={run.wake} strokeWidth={S * 0.06} strokeDasharray={`${S * 0.3} ${S * 0.16}`} fill="none" />
      {run.impact === undefined ? <circle cx={run.head.x} cy={run.head.y} r={S * 0.13} fill="#ffffff" /> : null}
      {since < 0.4 ? <ellipse cx={from.x} cy={from.y} rx={S * (0.3 + since * 1.5)} ry={S * (0.12 + since * 0.5)} fill="none" stroke="#ffffff" strokeWidth={S * 0.06} opacity={1 - since / 0.4} /> : null}
    </g>
  );
}

/** Flames on a hit ship's deck, in the icon's box (facing right): three tongues flickering on their own beat. */
function DeckFire({ frame, power }: { frame: number; power: number }) {
  if (power <= 0) return null;
  return (
    <g opacity={power}>
      {[-0.35, 0.05, 0.5].map((x, i) => {
        const h = (0.34 + 0.16 * Math.sin(frame * 0.9 + i * 2.3)) * (i === 1 ? 1.2 : 1);
        return (
          <g key={i}>
            <path d={`M${x - 0.13} -0.05 Q${x - 0.14} ${-h * 0.6} ${x + 0.02 + 0.05 * Math.sin(frame * 0.7 + i)} ${-h - 0.06} Q${x + 0.14} ${-h * 0.5} ${x + 0.13} -0.05 Z`} fill="#ff7b1c" />
            <path d={`M${x - 0.06} -0.05 Q${x - 0.06} ${-h * 0.45} ${x} ${-h * 0.7} Q${x + 0.07} ${-h * 0.4} ${x + 0.06} -0.05 Z`} fill="#ffd166" />
          </g>
        );
      })}
    </g>
  );
}

/** A ship's wake: the bow wave, foam arms that widen and thin out astern, and the churned water between them. */
function Wake({ x, y, d, S }: { x: number; y: number; d: P; S: number }) {
  const [ox, oy] = [x - d.x * S * 0.9, y + S * 0.28];
  const [bx, by] = [x + d.x * S * 1.0, y + S * 0.26];
  // A line from (px, py) going back `len` along the course and out `spread` to the side (`side` ±1).
  const back = (px: number, py: number, len: number, spread: number, side: number) => `M${px} ${py} l${-d.x * S * len - d.y * S * spread * side} ${-d.y * S * len + d.x * S * spread * side}`;
  return (
    <g fill="none" stroke="#ffffff" strokeLinecap="round">
      <path d={back(ox, oy, 1.4, 0.5, 1) + back(ox, oy, 1.4, 0.5, -1)} strokeOpacity={0.55} strokeWidth={S * 0.08} />
      <path d={back(ox, oy, 3.0, 1.2, 1) + back(ox, oy, 3.0, 1.2, -1)} strokeOpacity={0.22} strokeWidth={S * 0.05} />
      <path d={back(ox, oy, 2.4, 0, 1)} strokeOpacity={0.3} strokeWidth={S * 0.16} strokeDasharray={`${S * 0.12} ${S * 0.3}`} />
      <path d={back(bx, by, 0.5, 0.35, 1) + back(bx, by, 0.5, 0.35, -1)} strokeOpacity={0.5} strokeWidth={S * 0.06} />
    </g>
  );
}

/** What a ship leaves where she went down: the smoke column drifting up from her, and the oil slick spreading on the sea. */
function Wreck({ x, y, S, since, seed }: { x: number; y: number; S: number; since: number; seed: number }) {
  const slick = oilSlick(since);
  return (
    <g>
      {slick ? <ellipse cx={x} cy={y + S * 0.05} rx={S * slick.r} ry={S * slick.r * 0.32} fill="#14181d" opacity={slick.a} /> : null}
      {wreckSmoke(since, seed).map((c, k) => (
        <circle key={k} cx={x + c.dx * S} cy={y + c.dy * S} r={S * c.r} fill="#3a3d42" opacity={c.a} />
      ))}
    </g>
  );
}

/** A flare at night under its little parachute, lighting the sea round it (`glow` 0..1). */
function Flare({ x, y, S, glow, light }: { x: number; y: number; S: number; glow: number; light: string }) {
  return (
    <g opacity={glow}>
      <circle cx={x} cy={y} r={S * 2.4} fill={`url(#${light})`} style={{ mixBlendMode: "screen" }} />
      <path d={`M${x - S * 0.32} ${y - S * 0.55} Q${x} ${y - S * 0.9} ${x + S * 0.32} ${y - S * 0.55} M${x - S * 0.32} ${y - S * 0.55} L${x} ${y} L${x + S * 0.32} ${y - S * 0.55}`} fill="none" stroke="#e8e2d0" strokeWidth={S * 0.04} />
      <circle cx={x} cy={y} r={S * 0.17} fill="#ffffff" />
    </g>
  );
}

/**
 * All the map's vehicles, with their wakes, dust and shots. `travelS(path, from)`: how long a route takes on screen
 * (the armies' marching pace, so a fleet and an army sent together arrive together).
 */
export function MapVehicles({ map, frame, fps, k, travelS }: { map: V3GeoMap; frame: number; fps: number; k: number; travelS: (path: readonly P[], from: number) => number }) {
  const vehicles = map.vehicles ?? [];
  if (!vehicles.length) return null;
  const S = SIZE * k;
  const gun = map.era === "erken-modern" || map.era === "modern";
  const night = isNightMap(map);
  const land = landRings(map.land);
  return (
    <g>
      {vehicles.map((v, vi) => {
        if (frame < v.start) return null;
        const appear = interpolate(frame, [v.start, v.start + Math.round(fps * 0.4)], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.6)) });
        const gone = v.end === undefined ? 1 : interpolate(frame, [v.end, v.end + Math.round(fps * 0.5)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        if (gone <= 0) return null;
        const route = smoothPoints(v.path, 10);
        const plane = v.kind === "ucak";
        // Planes sent at a ship drop torpedoes (Taranto, 11 Nov 2026): a wake runs to it instead of a bomb falling.
        // A group with an arrangement or later steps (SceneMap araclar[].dizilis / yerler) is placed by mapFleet; the rest as ever.
        const fleet = isFleet(v);
        const speed = plane ? 0.6 : 1;
        const fl = fleet ? fleetLeader(v, route, frame, fps, travelS, speed) : undefined;
        // What it aims at now: the target of the step in effect.
        const aimed = fl ? fl.target : v.target;
        const aimedFrom = fl ? fl.fireStart : v.fireStart;
        const torpedo = plane && torpedoTarget(map, vi, S * 6, aimed);
        // Shells and bombs at a ship: some strike it, the rest fall in the sea beside it (shellOutcome).
        const shipShot = !torpedo && shipTargeted(map, vi, S * 6, aimed);
        const travel = v.moveStart === undefined ? 0 : travelS(route, v.moveStart) * (plane ? 0.6 : 1);
        const { p, heading, moving, t } = fl ? { p: fl.p, heading: fl.heading, moving: fl.moving, t: fl.t } : placeAt(v, route, frame, fps, travel);
        const dir = { x: Math.cos(heading), y: Math.sin(heading) };
        // Torpedo planes hold off the ship they attack and drop from there (Taranto, 27 Nov 2026 audit: the group came to a stop
        // on top of the battleships it was attacking), easing back as they arrive; the others are where the route puts them.
        const course = headingAt(route, t);
        const standoff = torpedo ? S * 3.5 * (t * t * (3 - 2 * t)) : 0;
        const lead = { x: p.x - Math.cos(course) * standoff, y: p.y - Math.sin(course) * standoff };
        // A plane banks into a turn.
        const bank = plane && moving ? bankOf(headingAt(route, Math.max(0, t - 0.05)), headingAt(route, Math.min(1, t + 0.05))) : 0;
        // Waiting or arrived, a small group stands in a wedge behind the first. Under way the others follow in single
        // file along the route (owner, 23 Oct 2026: the fleet hauled over the hill must read as a column on its way),
        // further apart when they are hauled, for the team pulling each.
        const length = pathLength(route);
        const gap = v.moveStart !== undefined && length > 0 ? (S * (v.overland?.length ? 3.6 : 2.4)) / length : 0;
        const span = 1 + (v.count - 1) * gap;
        // Torpedo planes hold off their ship in every step that has one, as the first route's do.
        const led = (f: number) => {
          const st = fleetLeader(v, route, f, fps, travelS, speed);
          const off = torpedo && st.target ? S * 3.5 * (st.t * st.t * (3 - 2 * st.t)) : 0;
          return off ? { ...st, p: { x: st.p.x - Math.cos(st.heading) * off, y: st.p.y - Math.sin(st.heading) * off } } : st;
        };
        const fleetBank = fleet && plane && moving ? bankOf(led(frame - 4).heading, led(frame + 4).heading) : 0;
        const members = fleet
          ? fleetMembers(v, led, frame, fps, S).map((m) => ({ x: m.x, y: m.y, heading: m.heading, hauled: m.leg === 0 && m.t > 0 && m.t < 1 && (v.overland ?? []).some((o) => m.t > o.from && m.t < o.to), going: m.going, bank: fleetBank }))
          : Array.from({ length: v.count }, (_, i) => {
          // Planes fly abreast in a V behind their leader, waiting, under way or arrived — not in the one file ships keep
          // (27 Nov 2026 audit: the Swordfish crossed the map nose to tail like a train, then piled on the ships).
          if (plane) {
            const slot = planeSlot(i);
            return { x: lead.x - dir.x * slot.back * S - dir.y * slot.across * S, y: lead.y - dir.y * slot.back * S + dir.x * slot.across * S, heading, hauled: false, going: moving, bank };
          }
          const ti = gap ? t * span - i * gap : t;
          const f = Math.max(0, Math.min(1, ti));
          const q = gap ? along(route, f) : p;
          const h = gap && f > 0 && f < 1 ? headingAt(route, f) : heading;
          const d = { x: Math.cos(h), y: Math.sin(h) };
          const row = Math.ceil(i / 2);
          const side = i === 0 ? 0 : i % 2 ? 1 : -1;
          const w = !gap || ti <= 0 || ti >= 1 ? 1 : Math.max(0, 1 - Math.min(ti, 1 - ti) / 0.08);
          const hauled = (v.overland ?? []).some((o) => f > o.from && f < o.to) && f > 0 && f < 1;
          return { x: q.x - (d.x * row * S * 1.5 + d.y * side * row * S * 1.1) * w, y: q.y - (d.y * row * S * 1.5 - d.x * side * row * S * 1.1) * w, heading: h, hauled, going: gap ? f > 0 && f < 1 : moving, bank: 0 };
          });
        const firing = aimed && aimedFrom !== undefined && frame >= aimedFrom && frame < aimedFrom + Math.round(fps * (FIRE_S + (torpedo ? TORPEDO_RUN_S + COLUMN_S : 0))) && !moving;
        const flak = plane && gun ? flakWindow(map, vi, fps) : undefined;
        // The frame a member is lost at: the group's last ones first.
        const downAt = (mi: number) => {
          const j = v.count - 1 - mi;
          return v.losses && v.lossStart !== undefined && j < v.losses.length ? v.lossStart + Math.round(v.losses[j]! * fps) : undefined;
        };
        const track = interpolate(frame, [v.start, v.start + Math.round(fps * 0.8)], [0, 1], { extrapolateRight: "clamp" });
        return (
          <g key={vi} opacity={gone}>
            {/* The track laid over the land for a haul: greased logs side by side, ready before the ships come. */}
            {(v.overland ?? []).map((o, oi) => {
              const d = `M${stretch(route, o.from, o.to).map((q) => `${q.x} ${q.y}`).join(" L")}`;
              return (
                <g key={`t${oi}`} opacity={track}>
                  <path d={d} fill="none" stroke="#3b2a17" strokeOpacity={0.45} strokeWidth={S * 0.95} strokeLinecap="round" strokeLinejoin="round" />
                  <path d={d} fill="none" stroke="#8a6234" strokeWidth={S * 0.7} strokeDasharray={`${S * 0.14} ${S * 0.2}`} strokeLinejoin="round" />
                  <path d={d} fill="none" stroke="#5b3b1c" strokeWidth={S * 0.06} strokeLinejoin="round" transform={`translate(0 ${S * 0.3})`} />
                </g>
              );
            })}
            {members.map((m, mi) => {
              const left = Math.cos(m.heading) < 0;
              // Lost (MapBuilder.unitLossDelaysS, the tokens' timing): a ship burns, heels over and settles into the sea
              // (SHIP_SINK_S) and leaves a smoke column and an oil slick, a gun, rider or tank bursts and tips over, a
              // plane falls trailing smoke.
              const down = downAt(mi);
              const water = WATER.has(v.kind);
              const sinkS = water ? SHIP_SINK_S : SINK_S;
              const q = down === undefined ? 0 : interpolate(frame, [down, down + Math.round(fps * sinkS)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", ...(water ? {} : { easing: Easing.in(Easing.quad) }) });
              const lost = down !== undefined && frame >= down;
              const since = lost ? (frame - down!) / fps : 0;
              // A ship under water leaves its wreck's smoke and slick for a few seconds; the others are gone.
              if (q >= 1 && !(water && since < WRECK_S)) return null;
              const waterline = { x: m.x, y: m.y + S * 0.25 };
              const md = { x: Math.cos(m.heading), y: Math.sin(m.heading) };
              if (q >= 1) return <Wreck key={mi} x={waterline.x} y={waterline.y} S={S} since={since} seed={vi * 53 + mi * 7} />;
              // A ship sunk while another side's planes or submarine are on the map: their torpedo's wake runs into it and
              // a water column stands up where it strikes (Taranto, 11 Nov 2026: the ship went down with nothing hitting it).
              const attacker = water && down !== undefined ? torpedoAttacker(map, vi, down) : undefined;
              const torpedoIn = attacker ? { from: torpedoStart(waterline, attacker, S * 5, land), since: (frame - down!) / fps + TORPEDO_RUN_S } : undefined;
              // Afloat a ship bobs; hauled it bumps over the rollers.
              const bob = m.hauled ? Math.sin(frame * 0.5 + mi * 2) * 0.6 : water ? Math.sin(frame * 0.12 + mi) : 0;
              const pose = water && lost ? sinkPose(q) : undefined;
              const fall = pose ? { y: pose.drop * S, turn: pose.list * (mi % 2 ? -1 : 1) * (left ? -1 : 1), fade: pose.fade } : { y: 0, turn: 80 * q, fade: 1 - Math.max(0, (q - 0.35) / 0.65) };
              const clipId = `v3-sink-${vi}-${mi}-${Math.round(m.x)}-${Math.round(m.y)}`;
              const body = plane ? (
                <g transform={`translate(${m.x} ${m.y + q * S * 3}) rotate(${(m.heading * 180) / Math.PI + q * 70}) scale(${S * appear} ${S * appear * (1 - 0.3 * Math.abs(m.bank))})`} opacity={fall.fade}>
                  <VehicleIcon kind={v.kind} color={v.color} frame={frame} moving={m.going} />
                </g>
              ) : (
                <g {...(pose ? { clipPath: `url(#${clipId})` } : {})}>
                <g transform={`translate(${m.x} ${m.y + bob * S * 0.04 + fall.y}) rotate(${bob * 2.5 + fall.turn}) scale(${(left ? -1 : 1) * S * appear} ${S * appear})`} opacity={fall.fade}>
                  {m.hauled ? <Haul frame={frame + mi * 5} color={v.color} /> : null}
                  <VehicleIcon kind={v.kind} color={v.color} frame={frame + mi * 7} moving={m.going && !m.hauled && !lost} />
                  {pose ? <DeckFire frame={frame + mi * 11} power={pose.fire} /> : null}
                </g>
                </g>
              );
              return (
                <g key={mi}>
                  {pose ? (
                    <defs>
                      {/* The sea's surface: what has settled below it is not drawn. */}
                      <clipPath id={clipId}>
                        <rect x={m.x - S * 4} y={m.y - S * 6} width={S * 8} height={S * 6.3} />
                      </clipPath>
                    </defs>
                  ) : null}
                  {lost ? (
                    <g>
                      {/* The hit, then rings of splashes round a sinking ship, or smoke behind a falling plane. */}
                      <Burst x={m.x} y={m.y} r={S * 1.2} p={since / 0.9} era={map.era} seed={vi * 53 + mi * 7} />
                      {water
                        ? [0, 0.35].map((d) => {
                            const g = Math.max(0, Math.min(1, (since - d) / SINK_S));
                            return g > 0 && g < 1 ? <ellipse key={d} cx={m.x} cy={m.y + S * 0.3} rx={S * (0.6 + g * 1.5)} ry={S * (0.2 + g * 0.45)} fill="none" stroke="#ffffff" strokeWidth={S * 0.08} opacity={0.8 * (1 - g)} /> : null;
                          })
                        : null}
                      {plane ? [0, 1, 2].map((j) => <circle key={j} cx={m.x - md.x * S * j * 0.6} cy={m.y + q * S * 3 - S * (0.4 + j * 0.5)} r={S * (0.22 + j * 0.1)} fill="#55595e" opacity={0.5 * fall.fade} />) : null}
                    </g>
                  ) : null}
                  {lost && water ? <Wreck x={waterline.x} y={waterline.y} S={S} since={since} seed={vi * 53 + mi * 7} /> : null}
                  {/* Wake behind a ship under way; dust behind cavalry, elephants, tanks and a hauled ship. */}
                  {m.going && !lost && WATER.has(v.kind) && !m.hauled ? <Wake x={m.x} y={m.y} d={md} S={S} /> : null}
                  {m.going && !lost && (!WATER.has(v.kind) || m.hauled) && !plane
                    ? [0, 1, 2].map((j) => {
                        const tt = ((frame * 0.05 + j / 3 + mi * 0.17) % 1 + 1) % 1;
                        return <circle key={j} cx={m.x - md.x * S * (0.8 + tt * 1.2)} cy={m.y + S * (0.2 - tt * 0.3)} r={S * (0.18 + tt * 0.3)} fill="#c9b48a" opacity={0.5 * (1 - tt)} />;
                      })
                    : null}
                  {/* A plane's contrail behind it while it flies, and its shadow on the ground below it. */}
                  {plane && m.going && !lost
                    ? [0, 1, 2].map((j) => <path key={`c${j}`} d={`M${m.x - md.x * S * (1 + j * 1.3)} ${m.y - md.y * S * (1 + j * 1.3)} L${m.x - md.x * S * (2.3 + j * 1.3)} ${m.y - md.y * S * (2.3 + j * 1.3)}`} stroke="#ffffff" strokeWidth={S * 0.14} strokeLinecap="round" opacity={0.32 - j * 0.1} />)
                    : null}
                  {plane ? (
                    <g transform={`translate(${m.x + S * (0.5 + 0.2 * Math.abs(m.bank))} ${m.y + S * 0.9}) rotate(${(m.heading * 180) / Math.PI}) scale(${S * appear * 0.9})`} opacity={0.25}>
                      <path d="M-0.95 0 L0.9 0 M0 -0.95 L-0.3 0 L0 0.95" stroke="#000000" strokeWidth={0.35} strokeLinecap="round" />
                    </g>
                  ) : null}
                  {torpedoIn ? <TorpedoWake from={torpedoIn.from} hit={waterline} since={torpedoIn.since} S={S} /> : null}
                  {body}
                  {lost && water ? <WaterColumn x={waterline.x} y={waterline.y} S={S} impact={since / COLUMN_S} /> : null}
                </g>
              );
            })}
            {firing
              ? members.map((m, mi) => {
                  const local = (frame - aimedFrom!) / fps - mi * 0.37 - rand(vi * 13 + mi) * 0.3;
                  if (local < 0 || (downAt(mi) ?? Infinity) <= frame) return null;
                  const every = torpedo ? TORPEDO_EVERY_S : SHOT_EVERY_S;
                  const shot = Math.floor(local / every);
                  const since = local - shot * every;
                  if (torpedo && local - since >= FIRE_S) return null;
                  const muzzle = { x: m.x + dir.x * S * 1.05, y: m.y + dir.y * S * 1.05 - (plane ? 0 : S * 0.35) };
                  const aim = torpedo ? 0.45 : 1;
                  // A shot at a ship strikes it or falls short or over beside it (shellOutcome); at the shore it falls where it falls.
                  const outcome = shipShot ? shellOutcome(vi * 101 + mi * 11 + shot) : undefined;
                  const spread = outcome ? { x: outcome.dx * S, y: outcome.dy * S } : { x: (rand(vi * 31 + mi * 7 + shot) - 0.5) * S * 2.2 * aim, y: (rand(vi * 17 + mi * 3 + shot) - 0.5) * S * 1.4 * aim };
                  const hit = { x: aimed!.x + spread.x, y: aimed!.y + spread.y };
                  if (torpedo) {
                    // Dropped short of the ship, the torpedo runs in; where it strikes, a burst and a water column.
                    const from = torpedoStart(hit, muzzle, S * 5, land);
                    const impact = torpedoAt(since, from, hit)?.impact;
                    const drop = torpedoDropAt(since, muzzle, from);
                    return (
                      <g key={`f${mi}`}>
                        {drop ? <ellipse cx={drop.x} cy={drop.y} rx={S * 0.2} ry={S * 0.07} fill={INK} transform={`rotate(${(Math.atan2(from.y - muzzle.y, from.x - muzzle.x) * 180) / Math.PI} ${drop.x} ${drop.y})`} /> : null}
                        <TorpedoWake from={from} hit={hit} since={since} S={S} />
                        {impact !== undefined ? <Burst x={hit.x} y={hit.y} r={S * 0.9} p={impact / 0.8} era={map.era} seed={vi * 101 + mi * 11 + shot} /> : null}
                        {impact !== undefined ? <WaterColumn x={hit.x} y={hit.y} S={S} impact={impact} /> : null}
                      </g>
                    );
                  }
                  const fly = since / SHOT_FLIGHT_S;
                  // The shot arcs over (a bomb falls straight), then bursts where it lands, or throws up a column of sea.
                  const arc = plane ? 0 : Math.hypot(hit.x - muzzle.x, hit.y - muzzle.y) * 0.25;
                  const ball = fly < 1 ? { x: muzzle.x + (hit.x - muzzle.x) * fly, y: muzzle.y + (hit.y - muzzle.y) * fly - Math.sin(fly * Math.PI) * arc } : undefined;
                  const landed = (since - SHOT_FLIGHT_S) / 0.9;
                  const splash = land.length > 0 && !outcome?.hit && !onLand(land, hit);
                  // The gun's flash, and its smoke staying and climbing after it (this shot's and the one before).
                  const puffs = gun && !plane ? [0, 1].flatMap((k) => (shot - k >= 0 ? [muzzleFx(since + k * every)] : [])) : [];
                  return (
                    <g key={`f${mi}`}>
                      {puffs.map((fx, k) => (
                        <g key={`m${k}`}>
                          {fx.flash > 0 ? (
                            <g opacity={fx.flash}>
                              <circle cx={muzzle.x} cy={muzzle.y} r={S * (0.25 + since)} fill="#ffd166" />
                            </g>
                          ) : null}
                          {fx.smoke ? <circle cx={muzzle.x - dir.x * S * 0.2} cy={muzzle.y - S * (0.1 + fx.smoke.rise)} r={S * fx.smoke.r} fill="#d9d4cc" opacity={fx.smoke.a} /> : null}
                        </g>
                      ))}
                      {ball ? <circle cx={ball.x} cy={ball.y} r={S * 0.1} fill={INK} /> : null}
                      {splash ? (
                        <g>
                          <WaterColumn x={hit.x} y={hit.y} S={S * 0.55} impact={landed} />
                          {landed > 0 && landed < 1 ? <ellipse cx={hit.x} cy={hit.y} rx={S * (0.2 + landed * 0.9)} ry={S * (0.08 + landed * 0.35)} fill="none" stroke="#ffffff" strokeWidth={S * 0.05} opacity={0.7 * (1 - landed)} /> : null}
                        </g>
                      ) : (
                        <Burst x={hit.x} y={hit.y} r={S * 0.9} p={landed} era={map.era} seed={vi * 101 + mi * 11 + shot} />
                      )}
                    </g>
                  );
                })
              : null}
            {/* Anti-aircraft fire bursts round an air raid on a fleet: a flash, then a black puff that swells and fades. */}
            {flak && frame >= flak.from && frame < flak.to
              ? flakAt((frame - flak.from) / fps, vi * 41 + 3).map((b, k) => {
                  const edge = Math.min(1, (frame - flak.from) / (fps * 0.5), (flak.to - frame) / fps);
                  const [bx, by] = [lead.x + b.dx * S, lead.y + b.dy * S];
                  return (
                    <g key={`k${k}`} opacity={edge}>
                      {b.age < 0.2 ? <circle cx={bx} cy={by} r={S * (0.25 + b.age * 2)} fill="#ffb703" opacity={1 - b.age / 0.2} /> : null}
                      <circle cx={bx} cy={by} r={S * (0.28 + 0.4 * b.age)} fill="#2b2d31" opacity={0.62 * (1 - b.age)} />
                    </g>
                  );
                })
              : null}
          </g>
        );
      })}
      {/* At night an air raid drops flares over its target, drifting down and lighting the sea. */}
      {night ? (
        <defs>
          {/* One fixed id: two maps in a transition define the same light. */}
          <radialGradient id="v3-flare-light">
            <stop offset="0%" stopColor="#fff2b8" stopOpacity={0.55} />
            <stop offset="35%" stopColor="#fff2b8" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#fff2b8" stopOpacity={0} />
          </radialGradient>
        </defs>
      ) : null}
      {night
        ? vehicles.map((v, vi) => {
            const raid = frame >= v.start ? raidOf(map, vi, fps) : undefined;
            return raid ? flaresAt(frame, raid.frame, fps, vi * 29).map((f, j) => <Flare key={`fl${vi}-${j}`} x={raid.at.x + f.dx * S} y={raid.at.y + f.dy * S} S={S} glow={f.glow} light="v3-flare-light" />) : null;
          })
        : null}
    </g>
  );
}

