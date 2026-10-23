import React from "react";
import { Easing, interpolate } from "remotion";
import type { V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";
import { INK } from "../character/rig";
import { Burst } from "./MapUnits";
import { along, pathLength, smoothPoints } from "./mapGeometry";

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
const WATER = new Set(["kadirga", "yelkenli", "gemi", "denizalti"]);

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

/**
 * All the map's vehicles, with their wakes, dust and shots. `travelS(path, from)`: how long a route takes on screen
 * (the armies' marching pace, so a fleet and an army sent together arrive together).
 */
export function MapVehicles({ map, frame, fps, k, travelS }: { map: V3GeoMap; frame: number; fps: number; k: number; travelS: (path: readonly P[], from: number) => number }) {
  const vehicles = map.vehicles ?? [];
  if (!vehicles.length) return null;
  const S = SIZE * k;
  const gun = map.era === "erken-modern" || map.era === "modern";
  return (
    <g>
      {vehicles.map((v, vi) => {
        if (frame < v.start) return null;
        const appear = interpolate(frame, [v.start, v.start + Math.round(fps * 0.4)], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.6)) });
        const gone = v.end === undefined ? 1 : interpolate(frame, [v.end, v.end + Math.round(fps * 0.5)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        if (gone <= 0) return null;
        const route = smoothPoints(v.path, 10);
        const plane = v.kind === "ucak";
        const travel = v.moveStart === undefined ? 0 : travelS(route, v.moveStart) * (plane ? 0.6 : 1);
        const { p, heading, moving, t } = placeAt(v, route, frame, fps, travel);
        const dir = { x: Math.cos(heading), y: Math.sin(heading) };
        // Waiting or arrived, a small group stands in a wedge behind the first. Under way the others follow in single
        // file along the route (owner, 23 Oct 2026: the fleet hauled over the hill must read as a column on its way),
        // further apart when they are hauled, for the team pulling each.
        const length = pathLength(route);
        const gap = v.moveStart !== undefined && length > 0 ? (S * (v.overland?.length ? 3.6 : 2.4)) / length : 0;
        const span = 1 + (v.count - 1) * gap;
        const members = Array.from({ length: v.count }, (_, i) => {
          const ti = gap ? t * span - i * gap : t;
          const f = Math.max(0, Math.min(1, ti));
          const q = gap ? along(route, f) : p;
          const h = gap && f > 0 && f < 1 ? headingAt(route, f) : heading;
          const d = { x: Math.cos(h), y: Math.sin(h) };
          const row = Math.ceil(i / 2);
          const side = i === 0 ? 0 : i % 2 ? 1 : -1;
          const w = !gap || ti <= 0 || ti >= 1 ? 1 : Math.max(0, 1 - Math.min(ti, 1 - ti) / 0.08);
          const hauled = (v.overland ?? []).some((o) => f > o.from && f < o.to) && f > 0 && f < 1;
          return { x: q.x - (d.x * row * S * 1.5 + d.y * side * row * S * 1.1) * w, y: q.y - (d.y * row * S * 1.5 - d.x * side * row * S * 1.1) * w, heading: h, hauled, going: gap ? f > 0 && f < 1 : moving };
        });
        const firing = v.target && v.fireStart !== undefined && frame >= v.fireStart && frame < v.fireStart + Math.round(fps * FIRE_S) && !moving;
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
              // Afloat a ship bobs; hauled it bumps over the rollers.
              const bob = m.hauled ? Math.sin(frame * 0.5 + mi * 2) * 0.6 : WATER.has(v.kind) ? Math.sin(frame * 0.12 + mi) : 0;
              const body = plane ? (
                <g transform={`translate(${m.x} ${m.y}) rotate(${(m.heading * 180) / Math.PI}) scale(${S * appear})`}>
                  <VehicleIcon kind={v.kind} color={v.color} frame={frame} moving={m.going} />
                </g>
              ) : (
                <g transform={`translate(${m.x} ${m.y + bob * S * 0.04}) rotate(${bob * 2.5}) scale(${(left ? -1 : 1) * S * appear} ${S * appear})`}>
                  {m.hauled ? <Haul frame={frame + mi * 5} color={v.color} /> : null}
                  <VehicleIcon kind={v.kind} color={v.color} frame={frame + mi * 7} moving={m.going && !m.hauled} />
                </g>
              );
              const md = { x: Math.cos(m.heading), y: Math.sin(m.heading) };
              return (
                <g key={mi}>
                  {/* Wake behind a ship under way; dust behind cavalry, elephants, tanks and a hauled ship. */}
                  {m.going && WATER.has(v.kind) && !m.hauled ? (
                    <path d={`M${m.x - md.x * S * 0.9} ${m.y + S * 0.28} l${-md.x * S * 1.4 - md.y * S * 0.5} ${-md.y * S * 1.4 + md.x * S * 0.5} M${m.x - md.x * S * 0.9} ${m.y + S * 0.28} l${-md.x * S * 1.4 + md.y * S * 0.5} ${-md.y * S * 1.4 - md.x * S * 0.5}`} stroke="#ffffff" strokeOpacity={0.55} strokeWidth={S * 0.08} strokeLinecap="round" fill="none" />
                  ) : null}
                  {m.going && (!WATER.has(v.kind) || m.hauled) && !plane
                    ? [0, 1, 2].map((j) => {
                        const tt = ((frame * 0.05 + j / 3 + mi * 0.17) % 1 + 1) % 1;
                        return <circle key={j} cx={m.x - md.x * S * (0.8 + tt * 1.2)} cy={m.y + S * (0.2 - tt * 0.3)} r={S * (0.18 + tt * 0.3)} fill="#c9b48a" opacity={0.5 * (1 - tt)} />;
                      })
                    : null}
                  {/* A plane's shadow on the ground below it. */}
                  {plane ? (
                    <g transform={`translate(${m.x + S * 0.5} ${m.y + S * 0.9}) rotate(${(m.heading * 180) / Math.PI}) scale(${S * appear * 0.9})`} opacity={0.25}>
                      <path d="M-0.95 0 L0.9 0 M0 -0.95 L-0.3 0 L0 0.95" stroke="#000000" strokeWidth={0.35} strokeLinecap="round" />
                    </g>
                  ) : null}
                  {body}
                </g>
              );
            })}
            {firing
              ? members.map((m, mi) => {
                  const local = (frame - v.fireStart!) / fps - mi * 0.37 - rand(vi * 13 + mi) * 0.3;
                  if (local < 0) return null;
                  const shot = Math.floor(local / SHOT_EVERY_S);
                  const since = local - shot * SHOT_EVERY_S;
                  const muzzle = { x: m.x + dir.x * S * 1.05, y: m.y + dir.y * S * 1.05 - (plane ? 0 : S * 0.35) };
                  const spread = { x: (rand(vi * 31 + mi * 7 + shot) - 0.5) * S * 2.2, y: (rand(vi * 17 + mi * 3 + shot) - 0.5) * S * 1.4 };
                  const hit = { x: v.target!.x + spread.x, y: v.target!.y + spread.y };
                  const fly = since / SHOT_FLIGHT_S;
                  // The shot arcs over (a bomb falls straight), then bursts where it lands.
                  const arc = plane ? 0 : Math.hypot(hit.x - muzzle.x, hit.y - muzzle.y) * 0.25;
                  const ball = fly < 1 ? { x: muzzle.x + (hit.x - muzzle.x) * fly, y: muzzle.y + (hit.y - muzzle.y) * fly - Math.sin(fly * Math.PI) * arc } : undefined;
                  return (
                    <g key={`f${mi}`}>
                      {gun && !plane && since < 0.35 ? (
                        <g opacity={1 - since / 0.35}>
                          <circle cx={muzzle.x} cy={muzzle.y} r={S * (0.25 + since)} fill="#ffd166" />
                          <circle cx={muzzle.x - dir.x * S * 0.2} cy={muzzle.y - S * 0.1} r={S * (0.35 + since * 1.4)} fill="#d9d4cc" opacity={0.7} />
                        </g>
                      ) : null}
                      {ball ? <circle cx={ball.x} cy={ball.y} r={S * 0.1} fill={INK} /> : null}
                      <Burst x={hit.x} y={hit.y} r={S * 0.9} p={(since - SHOT_FLIGHT_S) / 0.9} era={map.era} seed={vi * 101 + mi * 11 + shot} />
                    </g>
                  );
                })
              : null}
          </g>
        );
      })}
    </g>
  );
}

