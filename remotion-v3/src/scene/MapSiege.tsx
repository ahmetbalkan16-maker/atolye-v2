import React from "react";
import { interpolate } from "remotion";
import type { V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";

/**
 * What a siege looks like on the close map (owner, 27 Nov 2026: "şehir, kale kuşatmalarını daha kaliteli yap —
 * konumlandırmaları, efektleri, hareketleri; bundan sonraki videolarda kullanalım"), seen in the Constantinople and Baghdad
 * Shorts: guns that fired into a bare wall with nothing to show it was being hit, a breach that was a 25-px gap, a falling
 * town with no smoke over it. Here: the guns' earthwork (`SiegeWorks`), the powder smoke hanging over the battery and the
 * dust and stone chips where each shot lands on the wall (`SiegeSmoke`), the wall cracking under the pounding until it gives
 * way (`WallDamage`), the rubble, scorch and dust cloud of the breach (`BreachRuin`) and the smoke over a burning town
 * (`FirePall`). Everything is a pure function of the frame (Remotion renders frames in any order) and made of plain shapes
 * (no blur filter). The numbers behind the shots are exported so a smoke proves them without a render. Sizes: `u` is the
 * walls' own unit in world px, `S` a gun's size (MapVehicles' 30 screen px × k).
 */

type Close = NonNullable<V3GeoMap["close"]>;
type Vehicle = NonNullable<V3GeoMap["vehicles"]>[number];
type P = { x: number; y: number };

/** The guns' timing, as remotion-v3's MapVehicles has it (a smoke pins each to that file's source). */
export const GUN_SIZE = 30;
export const SHOT_EVERY_S = 1.1;
export const SHOT_FLIGHT_S = 0.7;
export const FIRE_S = 6;
const MEMBER_GAP_S = 0.37;
const MEMBER_JITTER_S = 0.3;

/** How long powder smoke hangs over a battery, and a shot's dust over the wall (seconds). */
export const SMOKE_LIFE_S = 4.2;
export const DUST_LIFE_S = 1.8;
/** How long a breach's own dust cloud lasts (seconds). */
export const COLLAPSE_S = 4.5;
/** How long a town's fire takes to spread to its far side (MapCloseGround's FIRE_SPREAD_S). */
const FIRE_SPREAD_S = 6;

const STONE = "#c2b79f";
const STONE_DARK = "#4a4237";
const RUBBLE = ["#c2b79f", "#9b907a", "#b0a58c", "#8a7f69"];
/** The wind on the map: smoke and dust drift this way (up the screen and to the right). */
const WIND: P = { x: 0.62, y: -0.78 };

/** MapVehicles' own random: the same shot gets the same moment here. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => 1 - (1 - clamp01(n)) ** 2;

/** The nearest point of any wall to `p`: the point, its distance and the wall segment's angle (radians) and wall index. */
export function nearestWallPoint(walls: Close["walls"], p: P): { x: number; y: number; d: number; angle: number; wall: number } | undefined {
  let best: { x: number; y: number; d: number; angle: number; wall: number } | undefined;
  walls.forEach((w, wi) => {
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1]!;
      const b = w.points[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (!len2) continue;
      const t = clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2);
      const q = { x: a.x + dx * t, y: a.y + dy * t };
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!best || d < best.d) best = { ...q, d, angle: Math.atan2(dy, dx), wall: wi };
    }
  });
  return best;
}

/** A gun group that fires at a wall: its vehicle index, the vehicle and the wall point it pounds. */
export interface Battery {
  readonly vi: number;
  readonly v: Vehicle;
  readonly wall: { x: number; y: number; d: number; angle: number; wall: number };
}

/** How near a gun's target must lie to a wall (world px) for the shot to strike that wall. */
export function strikeReach(close: Close): number {
  return Math.max(40, (close.wallUnit ?? close.unit) * 4);
}

/** The guns of a close map that fire at a wall (a target on or within a few wall units of it, fired from a frame). */
export function batteries(map: V3GeoMap): Battery[] {
  const close = map.close;
  if (!close) return [];
  const reach = strikeReach(close);
  return (map.vehicles ?? []).flatMap((v, vi) => {
    if (v.kind !== "top" || !v.target || v.fireStart === undefined) return [];
    const wall = nearestWallPoint(close.walls, v.target);
    return wall && wall.d <= reach ? [{ vi, v, wall }] : [];
  });
}

/** Whether the map's guns fire powder (the era of MapVehicles' muzzle flash): the siege guns of 1450 on. */
export const firesPowder = (map: V3GeoMap) => map.era === "erken-modern" || map.era === "modern";

/** One shot of a gun group: which gun, which shot, the frame it is fired at and the frame it lands at. */
export interface Shot {
  readonly mi: number;
  readonly shot: number;
  readonly fired: number;
  readonly lands: number;
}

/**
 * Every shot a gun group fires (MapVehicles' schedule: each gun a little after the last and a little off, one shot every
 * SHOT_EVERY_S, for FIRE_S from `fireStart`, the shot landing SHOT_FLIGHT_S later), in order of frame.
 */
export function gunShots(v: Vehicle, vi: number, fps: number): Shot[] {
  if (v.fireStart === undefined) return [];
  const window = v.fireStart + Math.round(fps * FIRE_S);
  const out: Shot[] = [];
  for (let mi = 0; mi < v.count; mi++) {
    const base = v.fireStart / fps + mi * MEMBER_GAP_S + rand(vi * 13 + mi) * MEMBER_JITTER_S;
    for (let shot = 0; base * fps + shot * SHOT_EVERY_S * fps < window; shot++) {
      const fired = Math.round((base + shot * SHOT_EVERY_S) * fps);
      out.push({ mi, shot, fired, lands: fired + Math.round(SHOT_FLIGHT_S * fps) });
    }
  }
  return out.sort((a, b) => a.fired - b.fired);
}

/**
 * Where a standing group of guns stands and which way it faces at gun size `S` (MapVehicles' wedge: the leader at the
 * route's start, the rest behind it, two to a row); undefined for a group that moves, or has no target.
 */
export function battery(v: Vehicle, S: number): { members: (P & { heading: number })[]; heading: number } | undefined {
  if (!v.target || v.moveStart !== undefined || !v.path.length) return undefined;
  const p = v.path[0]!;
  const heading = Math.atan2(v.target.y - p.y, v.target.x - p.x);
  const d = { x: Math.cos(heading), y: Math.sin(heading) };
  const members = Array.from({ length: v.count }, (_, i) => {
    const row = Math.ceil(i / 2);
    const side = i === 0 ? 0 : i % 2 ? 1 : -1;
    return { x: p.x - (d.x * row * S * 1.5 + d.y * side * row * S * 1.1), y: p.y - (d.y * row * S * 1.5 - d.x * side * row * S * 1.1), heading };
  });
  return { members, heading };
}

/**
 * How far a wall's breach has been pounded at `frame`, 0 (whole) to 1 (about to give way): from the first shot of the
 * guns aimed at it landing to the frame it opens. 0 with no guns on it, or when it opened before the first shot (the
 * writer's own order); 1 from the breach's frame on.
 */
export function breachDamage(close: Close, vehicles: readonly Vehicle[], wi: number, fps: number, frame: number): number {
  const b = close.walls[wi]?.breach;
  if (!b) return 0;
  if (frame >= b.start) return 1;
  const reach = strikeReach(close);
  const lands = vehicles.filter((v) => v.kind === "top" && v.target && v.fireStart !== undefined && Math.hypot(v.target.x - b.x, v.target.y - b.y) <= reach).map((v) => v.fireStart! + Math.round(SHOT_FLIGHT_S * fps));
  if (!lands.length) return 0;
  const first = Math.min(...lands);
  return first >= b.start ? 0 : clamp01((frame - first) / (b.start - first));
}

/** The side of a wall at its breach that faces the besiegers: +1 or −1 along the wall's left normal, 0 when nothing tells. */
export function outsideSide(close: Close, vehicles: readonly Vehicle[], wi: number): number {
  const w = close.walls[wi];
  const b = w?.breach;
  const near = b ? nearestWallPoint([w!], b) : undefined;
  if (!b || !near) return 0;
  const n = { x: -Math.sin(near.angle), y: Math.cos(near.angle) };
  const side = (p: P) => Math.sign((p.x - b.x) * n.x + (p.y - b.y) * n.y);
  const guns = vehicles.filter((v) => v.kind === "top" && v.path.length).map((v) => v.path[0]!);
  if (guns.length) return side({ x: guns.reduce((a, g) => a + g.x, 0) / guns.length, y: guns.reduce((a, g) => a + g.y, 0) / guns.length });
  const towns = close.settlements.filter((s) => s.kind === "sehir").sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y));
  if (towns[0]) return -side(towns[0]);
  const closed = w!.points.length > 3 && Math.hypot(w!.points[0]!.x - w!.points[w!.points.length - 1]!.x, w!.points[0]!.y - w!.points[w!.points.length - 1]!.y) < 1;
  return closed ? -side({ x: w!.points.reduce((a, p) => a + p.x, 0) / w!.points.length, y: w!.points.reduce((a, p) => a + p.y, 0) / w!.points.length }) : 0;
}

/** The earth bank in front of a standing battery of guns, with its wicker gabions: drawn under the guns. */
export function SiegeWorks({ map, frame, fps, k }: { map: V3GeoMap; frame: number; fps: number; k: number }) {
  const S = GUN_SIZE * k;
  const banks = batteries(map).flatMap(({ vi, v }) => {
    const b = battery(v, S);
    if (!b) return [];
    const appear = interpolate(frame, [v.start, v.start + Math.round(fps * 0.8)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const gone = v.end === undefined ? 1 : interpolate(frame, [v.end, v.end + Math.round(fps * 0.5)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    if (appear * gone <= 0) return [];
    return [{ vi, v, b, alpha: appear * gone }];
  });
  if (!banks.length) return null;
  return (
    <g pointerEvents="none">
      {banks.map(({ vi, v, b, alpha }) => {
        const d = { x: Math.cos(b.heading), y: Math.sin(b.heading) };
        const n = { x: -d.y, y: d.x };
        const lead = v.path[0]!;
        const rows = Math.ceil((v.count - 1) / 2);
        const half = S * (0.95 + rows * 0.8);
        // A shallow arc across the front of the group, a little ahead of the muzzles.
        const at = (t: number): P => ({ x: lead.x + d.x * (S * 1.55 - Math.abs(t) * S * 0.35) + n.x * t * half, y: lead.y + d.y * (S * 1.55 - Math.abs(t) * S * 0.35) + n.y * t * half });
        const steps = Array.from({ length: 9 }, (_, i) => at(i / 4 - 1));
        const path = `M${steps.map((p) => `${p.x} ${p.y}`).join(" L")}`;
        const gabions = Math.max(5, Math.round((half * 2) / (S * 0.42)));
        return (
          <g key={`bank${vi}`} opacity={alpha}>
            <path d={path} fill="none" stroke="#000000" strokeOpacity={0.28} strokeWidth={S * 0.62} strokeLinecap="round" transform={`translate(${S * 0.1} ${S * 0.16})`} />
            <path d={path} fill="none" stroke="#5a4328" strokeWidth={S * 0.46} strokeLinecap="round" strokeLinejoin="round" />
            <path d={path} fill="none" stroke="#a08058" strokeWidth={S * 0.3} strokeLinecap="round" strokeLinejoin="round" />
            {Array.from({ length: gabions }, (_, i) => {
              const p = at((i / (gabions - 1)) * 2 - 1);
              return <circle key={i} cx={p.x} cy={p.y} r={S * 0.15} fill="#c4a06a" stroke="#4a3622" strokeWidth={S * 0.04} />;
            })}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Over the guns and the wall: the powder smoke hanging and drifting over each firing battery after every shot, and where
 * each shot lands on the wall, a plume of dust and a spray of stone chips. Only for powder guns firing at a wall.
 */
export function SiegeSmoke({ map, frame, fps, k }: { map: V3GeoMap; frame: number; fps: number; k: number }) {
  const close = map.close;
  const list = close ? batteries(map) : [];
  if (!close || !list.length) return null;
  const S = GUN_SIZE * k;
  const u = close.wallUnit ?? close.unit;
  const powder = firesPowder(map);
  const nodes: React.ReactNode[] = [];
  list.forEach(({ vi, v, wall }) => {
    const stand = battery(v, S);
    const heading = stand?.heading ?? Math.atan2(v.target!.y - v.path[0]!.y, v.target!.x - v.path[0]!.x);
    const dir = { x: Math.cos(heading), y: Math.sin(heading) };
    gunShots(v, vi, fps).forEach(({ mi, shot, fired, lands }) => {
      // The smoke over the battery.
      const sAge = (frame - fired) / fps;
      if (powder && stand && sAge > 0 && sAge < SMOKE_LIFE_S) {
        const m = stand.members[mi]!;
        const f = sAge / SMOKE_LIFE_S;
        const grow = S * (0.5 + 0.3 * sAge);
        const out = S * (0.6 + 0.7 * ease(sAge / 1.4));
        const x = m.x + dir.x * (S * 1.05 + out) + WIND.x * S * 0.55 * sAge;
        const y = m.y + dir.y * (S * 1.05 + out) - S * 0.35 + WIND.y * S * 0.55 * sAge;
        const a = 0.36 * Math.min(1, sAge * 7) * (1 - f) ** 1.4;
        nodes.push(
          <g key={`sm${vi}-${mi}-${shot}`} opacity={a}>
            <circle cx={x + S * 0.12} cy={y + S * 0.1} r={grow} fill="#8f8a80" />
            <circle cx={x} cy={y} r={grow * 0.86} fill="#d9d4cc" />
          </g>,
        );
      }
      // Where it lands on the wall.
      const a = (frame - lands) / fps;
      if (a < 0 || a >= DUST_LIFE_S) return;
      const hx = wall.x + (rand(vi * 31 + mi * 7 + shot) - 0.5) * u * 2.2;
      const hy = wall.y + (rand(vi * 17 + mi * 3 + shot) - 0.5) * u * 1.4;
      const seed = vi * 101 + mi * 11 + shot;
      const f = a / DUST_LIFE_S;
      nodes.push(
        <g key={`im${vi}-${mi}-${shot}`}>
          {[0, 1, 2].map((i) => {
            const r = u * (0.8 + 2.0 * ease(f)) * (0.8 + rand(seed + i) * 0.5);
            return <circle key={i} cx={hx + (rand(seed + i * 3) - 0.5) * u * 1.2 + WIND.x * u * 1.1 * a} cy={hy + (rand(seed + i * 5) - 0.5) * u * 0.6 + WIND.y * u * 1.1 * a - u * 0.5 * a} r={r} fill="#cfc2a4" opacity={0.55 * Math.min(1, a * 9) * (1 - f) ** 1.2} />;
          })}
          {Array.from({ length: 6 }, (_, i) => {
            // Chips fly back towards the guns and sideways, rise and fall.
            const ang = heading + Math.PI + (rand(seed + i * 7) - 0.5) * 2.6;
            const speed = u * (3.2 + rand(seed + i * 9) * 3.4);
            const t = Math.min(a, 1);
            const px = hx + Math.cos(ang) * speed * t * 0.55;
            const py = hy + Math.sin(ang) * speed * t * 0.55 - (u * 3.4 * t - u * 4.6 * t * t);
            const size = u * (0.16 + rand(seed + i * 11) * 0.14);
            return <rect key={i} x={px - size / 2} y={py - size / 2} width={size} height={size * 0.8} fill={RUBBLE[i % RUBBLE.length]} stroke={STONE_DARK} strokeWidth={u * 0.03} opacity={1 - clamp01((a - 0.8) / 0.7)} transform={`rotate(${rand(seed + i) * 360 + a * 300} ${px} ${py})`} />;
          })}
        </g>,
      );
    });
  });
  return <g pointerEvents="none">{nodes}</g>;
}

/**
 * The wall at its breach cracking under the pounding (`p` from `breachDamage`): pits and rubble at its foot first, then
 * cracks running along it. Drawn inside the wall's own group (the gap's mask takes it with the stone).
 */
export function WallDamage({ x, y, angle, u, p, out, seed }: { x: number; y: number; angle: number; u: number; p: number; out: number; seed: number }) {
  if (p <= 0) return null;
  const pits = Math.floor(p * 9);
  const cracks = Math.ceil(p * 4);
  const stones = Math.floor(p * 12);
  return (
    <g transform={`translate(${x} ${y}) rotate(${(angle * 180) / Math.PI})`} pointerEvents="none">
      {Array.from({ length: pits }, (_, i) => (
        <ellipse key={`p${i}`} cx={(rand(seed + i) - 0.5) * u * 4.2} cy={(rand(seed + i + 9) - 0.5) * u * 0.5} rx={u * (0.2 + rand(seed + i + 4) * 0.22)} ry={u * (0.14 + rand(seed + i + 6) * 0.14)} fill="#2b241b" opacity={0.62} />
      ))}
      {Array.from({ length: cracks }, (_, i) => {
        const full = u * (1.2 + rand(seed + i * 5) * 1.3);
        const reach = clamp01(p * 1.4 - i * 0.18);
        const dir = i % 2 ? 1 : -1;
        const x0 = (rand(seed + i * 3) - 0.5) * u * 1.4;
        const pts = Array.from({ length: 5 }, (_, j) => {
          const f = (j / 4) * reach;
          return `${x0 + dir * f * full} ${(rand(seed + i * 17 + j) - 0.5) * u * 0.55 * (j ? 1 : 0.3)}`;
        });
        return <path key={`c${i}`} d={`M${pts.join(" L")}`} fill="none" stroke="#2b241b" strokeWidth={u * 0.08} strokeLinecap="round" strokeLinejoin="round" opacity={0.75} />;
      })}
      {Array.from({ length: stones }, (_, i) => {
        const s = out || (i % 2 ? 1 : -1);
        const w = u * (0.14 + rand(seed + i * 2) * 0.16);
        return <rect key={`s${i}`} x={(rand(seed + i * 4) - 0.5) * u * 3.2} y={s * (u * 0.55 + rand(seed + i * 6) * u * 0.9)} width={w} height={w * 0.8} fill={RUBBLE[i % RUBBLE.length]} stroke={STONE_DARK} strokeWidth={u * 0.035} transform={`rotate(${rand(seed + i) * 90})`} />;
      })}
    </g>
  );
}

/**
 * The breach once it is open (`age` seconds): a scorched patch, a fan of fallen stone running out from the gap on the
 * besiegers' side and a smaller heap on the town's, and the dust cloud of the collapse rising and drifting off. Larger
 * than the wall's own unit so it reads from the whole siege (the 25-px gap of the Constantinople Short did not).
 */
export function BreachRuin({ x, y, angle, u, age, out, seed }: { x: number; y: number; angle: number; u: number; age: number; out: number; seed: number }) {
  if (age < 0) return null;
  const R = u * 2.3;
  const settle = ease(age / 0.7);
  const stones = Array.from({ length: 22 }, (_, i) => {
    const outer = i < 14;
    const s = out === 0 ? (i % 2 ? 1 : -1) : outer ? out : -out;
    const reach = (outer ? 2.6 : 1.7) * R;
    const r = reach * Math.sqrt(rand(seed + i * 3));
    const a = (rand(seed + i * 7) - 0.5) * 2.2;
    return { lx: Math.sin(a) * r * 1.1, ly: s * (R * 0.25 + Math.cos(a) * r * 0.8), size: u * (0.16 + rand(seed + i * 5) * 0.24), spin: rand(seed + i) * 90, tone: i % RUBBLE.length };
  });
  const dust = Array.from({ length: 6 }, (_, i) => {
    const t = age - i * 0.18;
    return { t, f: clamp01(t / COLLAPSE_S), i };
  }).filter((d) => d.t > 0 && d.f < 1);
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      <g transform={`rotate(${(angle * 180) / Math.PI})`}>
        <ellipse cx={0} cy={out * R * 0.5} rx={R * 2.6} ry={R * 1.6} fill="#1f1912" opacity={0.3 * settle} />
        {stones.map((st, i) => (
          <rect key={i} x={st.lx * settle - st.size / 2} y={st.ly * settle - st.size * 0.4} width={st.size} height={st.size * 0.8} fill={RUBBLE[st.tone]} stroke={STONE_DARK} strokeWidth={u * 0.035} transform={`rotate(${st.spin} ${st.lx * settle} ${st.ly * settle})`} />
        ))}
      </g>
      {dust.map(({ t, f, i }) => {
        const r = R * (0.9 + 2.4 * ease(f)) * (0.85 + rand(seed + i) * 0.3);
        return <circle key={`d${i}`} cx={(rand(seed + i * 3) - 0.5) * R * 1.6 + WIND.x * R * 0.7 * t} cy={(rand(seed + i * 5) - 0.5) * R * 0.8 + WIND.y * R * 0.7 * t - R * 0.5 * ease(f)} r={r} fill="#cdbf9f" opacity={0.5 * Math.min(1, t * 6) * (1 - f) ** 1.5} />;
      })}
    </g>
  );
}

/**
 * The smoke over a burning town (`since`: seconds since it caught): a few columns rising from where the fire started and
 * from houses further in, each starting when the fire reaches it (the spread of MapCloseGround's flames), made of puffs
 * that grow, darken and thin as they climb and lean with the wind. The flames' own small puffs stay.
 */
export function FirePall({ anchors, u, since, seed }: { anchors: readonly { x: number; y: number; delay: number }[]; u: number; since: number; seed: number }) {
  return (
    <g pointerEvents="none">
      {anchors.map((c, ci) => {
        const g = clamp01((since - c.delay) / 3);
        if (g <= 0) return null;
        return (
          <g key={ci}>
            {Array.from({ length: 8 }, (_, j) => {
              const phase = (since * 0.32 + j / 8 + rand(seed + ci * 5)) % 1;
              const rise = phase * u * 6.5 * g;
              const lean = phase * phase * u * 3.2;
              const r = u * (0.32 + phase * 1.05) * (0.8 + 0.4 * g);
              const shade = Math.round(44 + phase * 70);
              const cx = c.x + WIND.x * lean + Math.sin(phase * 7 + j + ci) * u * 0.25;
              const cy = c.y - u * 0.7 + WIND.y * lean * 0.6 - rise;
              const a = 0.5 * g * Math.min(1, phase * 7) * (1 - phase) ** 1.1;
              return (
                <g key={j} opacity={a}>
                  <circle cx={cx + r * 0.12} cy={cy + r * 0.15} r={r} fill={`rgb(${shade - 14},${shade - 16},${shade - 18})`} />
                  <circle cx={cx - r * 0.1} cy={cy - r * 0.12} r={r * 0.78} fill={`rgb(${shade + 22},${shade + 18},${shade + 14})`} />
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

/** The columns of a burning settlement: where its fire started, then houses further in, each from when the fire reaches it. */
export function pallAnchors(s: Close["settlements"][number]): { x: number; y: number; delay: number }[] {
  if (s.burn === undefined || !s.items.length) return [];
  const from = s.burnFrom ?? { x: s.x, y: s.y };
  const dist = (p: P) => Math.hypot(p.x - from.x, p.y - from.y);
  const far = Math.max(...s.items.map(dist)) || 1;
  const picks = [0.35, 0.7].map((f) => s.items[Math.min(s.items.length - 1, Math.floor(s.items.length * f))]!);
  return [{ x: from.x, y: from.y, delay: 0 }, ...picks.map((p) => ({ x: p.x, y: p.y, delay: (dist(p) / far) * FIRE_SPREAD_S }))];
}
