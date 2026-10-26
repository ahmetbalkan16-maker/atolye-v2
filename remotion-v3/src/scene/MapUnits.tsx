import React from "react";
import { Easing, interpolate } from "remotion";
import type { V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";
import { INK } from "../character/rig";
import { along } from "./mapGeometry";
import { separateTokens } from "./unitLayout";

/**
 * Unit tokens and battle effects on the living map (owner, 22 Oct 2026, after the reference channel's WW2 map
 * narration): each side's round tokens with its emblem form a front, a cluster or a ring round a besieged place and
 * slide to the next formation with the line that tells it; lost tokens fade out with a puff; where two sides' tokens
 * meet, the front flickers with clashes. Battles burst in the era's way: dust and sparks before gunpowder, fire and
 * smoke after. Sizes are screen sizes (`k` = screen px per world px).
 */

/** How long tokens take to reach their next formation (seconds), and how far apart their starts are staggered. */
const SLIDE_S = 2.8;
const STAGGER_S = 0.06;
/** Token radius on a 1080p screen. */
const TOKEN_R = 23;
/** How long a fallen token lies crossed out before it fades (seconds). */
const FALLEN_S = 0.6;
/** How long a routed side's tokens take to scatter (seconds, each a little more or less; at 2.2 s they flew 34 px a frame). */
const ROUT_S = 3;
/** A block on a 1080p screen: its width and depth against the token radius (room for a sign that reads at a glance). */
const BLOCK_W = 2.8;
const BLOCK_H = 1.7;

/**
 * A unit kind's sign in white, in a box of ±1 (the caller scales it), always upright: infantry ✕ (any foot), swordsmen a
 * sword, spearmen a spear, archers a bow and arrow, musketeers and riflemen a gun, cavalry a horse's head (a chess
 * knight), guns a cannon on its wheel (owner, 26 Oct 2026: "okçunun simgesi farklı, tüfekçinin farklı, atlıların
 * farklı, kılıçlıların farklı … askerlerin ne asker olduğu belli olması lazım").
 */
export function KindSign({ kind }: { kind: string }) {
  const W = "#ffffff";
  switch (kind) {
    case "piyade":
      return <path d="M-0.7 -0.7 L0.7 0.7 M0.7 -0.7 L-0.7 0.7" stroke={W} strokeWidth={0.26} strokeLinecap="round" fill="none" />;
    case "kilicli":
      return (
        <g fill={W}>
          <path d="M0 -1.05 L0.26 -0.72 L0.26 0.32 L-0.26 0.32 L-0.26 -0.72 Z" />
          <path d="M-0.72 0.3 L0.72 0.3 L0.72 0.56 L-0.72 0.56 Z" />
          <path d="M-0.14 0.56 L0.14 0.56 L0.14 0.86 L-0.14 0.86 Z" />
          <circle cy={0.96} r={0.17} />
        </g>
      );
    case "mizrakci":
      return (
        <g fill={W}>
          <path d="M-0.08 1 L-0.08 -0.42 L0.08 -0.42 L0.08 1 Z" />
          <path d="M0 -1 Q0.32 -0.62 0 -0.3 Q-0.32 -0.62 0 -1 Z" />
          <path d="M-0.3 -0.36 L0.3 -0.36 L0.3 -0.26 L-0.3 -0.26 Z" />
        </g>
      );
    case "okcu":
      return (
        <g stroke={W} strokeWidth={0.17} strokeLinecap="round" fill="none">
          <path d="M-0.35 -0.95 Q0.55 0 -0.35 0.95" />
          <path d="M-0.35 -0.95 L-0.35 0.95" strokeWidth={0.07} />
          <path d="M-0.75 0 L0.9 0 M0.6 -0.28 L0.92 0 L0.6 0.28" />
        </g>
      );
    case "tufekci":
      return (
        <g fill={W}>
          <path d="M-0.25 -0.34 L1 -0.34 L1 -0.14 L-0.25 -0.14 Z" />
          <path d="M-0.28 -0.34 L-0.28 0.06 L-1 0.6 L-1 0.18 Z" />
          <path d="M-0.1 -0.14 L0.06 -0.14 L0.06 0.16 Q-0.06 0.22 -0.1 0.1 Z" />
        </g>
      );
    case "suvari":
      return <path d="M-0.5 0.95 L-0.42 0.25 Q-0.62 -0.15 -0.22 -0.62 L-0.05 -0.98 L0.1 -0.66 Q0.55 -0.5 0.78 0.02 L0.62 0.26 L0.22 0.08 Q0.16 0.5 0.45 0.95 Z" fill={W} />;
    case "topcu":
      return (
        <g fill={W}>
          <path d="M-0.8 0.1 L0.85 -0.42 L0.95 -0.12 L-0.7 0.4 Z" />
          <circle cx={-0.12} cy={0.42} r={0.42} fill="none" stroke={W} strokeWidth={0.16} />
          <circle cx={-0.12} cy={0.42} r={0.09} />
        </g>
      );
    default:
      return <circle r={0.35} fill={W} />;
  }
}

/**
 * A unit block like the battle maps' (DFT Tarih's Pharsalus): a rectangle in the side's colour with its kind's sign in
 * white and a bright front edge towards the enemy. Drawn about its centre, the front up (the caller turns it by
 * `turn` degrees; the sign stays upright); `r` is the token radius.
 */
export function UnitBlock({ kind, color, r, turn = 0 }: { kind: string; color: string; r: number; turn?: number }) {
  const w = r * BLOCK_W;
  const h = r * BLOCK_H;
  return (
    <g>
      <g transform={`rotate(${turn})`}>
        <rect x={-w / 2 + r * 0.12} y={-h / 2 + r * 0.16} width={w} height={h} rx={r * 0.12} fill="rgba(0,0,0,0.35)" />
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={r * 0.12} fill={color} stroke={INK} strokeWidth={r * 0.1} />
        <rect x={-w / 2 + r * 0.14} y={-h / 2 + r * 0.14} width={w - r * 0.28} height={h - r * 0.28} rx={r * 0.06} fill="none" stroke="#ffffff" strokeOpacity={0.85} strokeWidth={r * 0.07} />
        {/* The front edge, towards the enemy. */}
        <path d={`M${-w / 2 + r * 0.1} ${-h / 2 + r * 0.05} L${w / 2 - r * 0.1} ${-h / 2 + r * 0.05}`} stroke="#ffffff" strokeWidth={r * 0.2} strokeLinecap="round" />
      </g>
      <g transform={`scale(${Math.min(w, h) * 0.36})`}>
        <KindSign kind={kind} />
      </g>
    </g>
  );
}

function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** An emblem drawn in white on the token, in a box of radius 1 (scaled by the caller). */
/** `bg`: the token's own colour (a crescent is a white disc with a disc of the token's colour cut out of it). */
export function Emblem({ kind, letters, bg }: { kind: string; letters?: string; bg: string }) {
  const W = "#ffffff";
  switch (kind) {
    case "kartal":
      return <path d="M0 -0.55 L0.12 -0.3 L0.62 -0.5 L0.4 -0.12 L0.7 -0.05 L0.28 0.12 L0.18 0.55 L0 0.32 L-0.18 0.55 L-0.28 0.12 L-0.7 -0.05 L-0.4 -0.12 L-0.62 -0.5 L-0.12 -0.3 Z" fill={W} />;
    case "hilal":
      return (
        <g>
          <circle cx={-0.12} cy={0} r={0.56} fill={W} />
          <circle cx={0.08} cy={-0.04} r={0.46} fill={bg} />
          <path transform="translate(0.36 0) scale(0.42)" d="M0 -0.66 L0.16 -0.2 L0.64 -0.2 L0.25 0.08 L0.4 0.55 L0 0.27 L-0.4 0.55 L-0.25 0.08 L-0.64 -0.2 L-0.16 -0.2 Z" fill={W} />
        </g>
      );
    case "hac":
      return <path d="M-0.16 -0.62 L0.16 -0.62 L0.16 -0.16 L0.62 -0.16 L0.62 0.16 L0.16 0.16 L0.16 0.62 L-0.16 0.62 L-0.16 0.16 L-0.62 0.16 L-0.62 -0.16 L-0.16 -0.16 Z" fill={W} />;
    case "yildiz":
      return <path d="M0 -0.66 L0.16 -0.2 L0.64 -0.2 L0.25 0.08 L0.4 0.55 L0 0.27 L-0.4 0.55 L-0.25 0.08 L-0.64 -0.2 L-0.16 -0.2 Z" fill={W} />;
    case "aslan":
      return (
        <g fill={W}>
          {Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2;
            return <path key={i} d={`M${Math.cos(a) * 0.36} ${Math.sin(a) * 0.36} L${Math.cos(a + 0.3) * 0.64} ${Math.sin(a + 0.3) * 0.64} L${Math.cos(a + 0.6) * 0.36} ${Math.sin(a + 0.6) * 0.36} Z`} />;
          })}
          <circle r={0.38} />
        </g>
      );
    case "tac":
      return <path d="M-0.6 0.4 L-0.6 -0.35 L-0.3 -0.05 L0 -0.5 L0.3 -0.05 L0.6 -0.35 L0.6 0.4 Z" fill={W} />;
    case "kalkan":
      return <path d="M-0.5 -0.55 L0.5 -0.55 L0.5 0.05 Q0.5 0.45 0 0.65 Q-0.5 0.45 -0.5 0.05 Z" fill={W} />;
    case "kilic":
      return (
        <g fill={W}>
          <path d="M-0.08 -0.68 L0.08 -0.68 L0.08 0.22 L-0.08 0.22 Z" />
          <path d="M-0.36 0.18 L0.36 0.18 L0.36 0.3 L-0.36 0.3 Z" />
          <path d="M-0.07 0.3 L0.07 0.3 L0.07 0.62 L-0.07 0.62 Z" />
        </g>
      );
    case "gunes":
      return (
        <g fill={W}>
          <circle r={0.3} />
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return <path key={i} d={`M${Math.cos(a - 0.12) * 0.38} ${Math.sin(a - 0.12) * 0.38} L${Math.cos(a) * 0.68} ${Math.sin(a) * 0.68} L${Math.cos(a + 0.12) * 0.38} ${Math.sin(a + 0.12) * 0.38} Z`} />;
          })}
        </g>
      );
    case "orak_cekic":
      return (
        <g fill="none" stroke={W} strokeWidth={0.13} strokeLinecap="round">
          <path d="M-0.42 0.5 L0.35 -0.27" />
          <path d="M0.2 -0.45 L0.52 -0.12" />
          <path d="M-0.35 -0.3 A0.45 0.45 0 1 0 0.32 0.32" />
        </g>
      );
    default:
      return (
        <text x={0} y={0.24} textAnchor="middle" fill={W} style={{ font: `900 ${letters && letters.length > 1 ? 0.68 : 0.95}px 'Segoe UI Black', 'Arial Black', sans-serif` }}>
          {(letters ?? "?").toLocaleUpperCase("en-US")}
        </text>
      );
  }
}

type Units = NonNullable<V3GeoMap["units"]>[number];

/** How far apart tokens pouring through a breach start (seconds): one after another, a column through the gap. */
const BREACH_STAGGER_S = 0.3;

/** A token on screen at a frame: where, how visible, and what it is doing. `prog`: how far it is on its way (0..1). */
export interface PlacedToken {
  x: number;
  y: number;
  alpha: number;
  lostAt?: number;
  transit?: boolean;
  rout?: number;
  prog?: number;
}

/**
 * When token `i` sets off for a step and how many frames it takes: one after another; through a breach in a column; a
 * routed side each at its own moment, at its own pace (no column, no order).
 */
function departure(to: Units["steps"][number], i: number, fps: number): { begin: number; frames: number; queue: number } {
  const queue = to.via && to.through ? to.through.indexOf(i) : -1;
  const begin = to.start + Math.round((queue >= 0 ? queue * BREACH_STAGGER_S : to.rout ? rand(i * 7 + 3) * 0.9 : i * STAGGER_S) * fps);
  const slide = to.rout ? ROUT_S * (0.75 + rand(i * 11 + 1) * 0.5) : SLIDE_S;
  return { begin, frames: Math.round(slide * fps), queue };
}

/**
 * Where token `i` is in step `s` at `frame`: from wherever it was when it set off to its place in this formation. A line
 * that comes before the last slide is over takes the token on from mid-way (the Kosovo trial's tokens jumped back to
 * the last formation first); until it sets off it goes on with the last slide.
 */
function slideAt(steps: Units["steps"], s: number, i: number, frame: number, fps: number): { x: number; y: number; t: number; queue: number } {
  const to = steps[s]!;
  const b = to.points[Math.min(i, to.points.length - 1)]!;
  if (s === 0) return { x: b.x, y: b.y, t: 1, queue: -1 };
  const { begin, frames, queue } = departure(to, i, fps);
  const a = slideAt(steps, s - 1, i, Math.min(frame, begin), fps);
  // A routed token breaks into a run within a few frames (an ease-out started at full speed: a 22 px leap) and slows as
  // it gets away.
  const t = interpolate(frame, [begin, begin + frames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: to.rout ? Easing.bezier(0.3, 0, 0.25, 1) : Easing.inOut(Easing.cubic) });
  // Through the breach: to the gap, then on to its place in the new formation.
  const pos = queue >= 0 ? along([a, to.via!, b], t) : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return { ...pos, t, queue };
}

/**
 * Where a side's token `i` is at `frame`, whether it is still standing (with its fade), and whether it is on its way
 * through a breach (it does not turn aside to fight until it is through).
 */
function tokenAt(u: Units, i: number, frame: number, fps: number): PlacedToken | undefined {
  const steps = u.steps;
  if (!steps.length || frame < steps[0]!.start) return undefined;
  let s = 0;
  while (s + 1 < steps.length && steps[s + 1]!.start <= frame) s++;
  const to = steps[s]!;
  const from = steps[Math.max(0, s - 1)]!;
  const { x, y, t, queue } = slideAt(steps, s, i, frame, fps);
  const pos = { x, y };
  const transit = queue >= 0 && t < 1;
  if (to.rout && s > 0 && i < to.alive) return { ...pos, alpha: 1 - 0.35 * t, transit, rout: t, prog: t };
  // A token lost in this step falls at its own moment of the fight (one by one), lies crossed out a moment, then
  // fades; one lost before is gone.
  const lostBefore = s > 0 && i >= from.alive;
  if (lostBefore) return undefined;
  if (i >= to.alive) {
    const lostAt = to.start + Math.round((to.losses?.[i - to.alive] ?? SLIDE_S * 0.6) * fps);
    if (frame < lostAt) return { ...pos, alpha: 1, transit, prog: t };
    const alpha = interpolate(frame, [lostAt + Math.round(fps * FALLEN_S), lostAt + Math.round(fps * (FALLEN_S + 0.5))], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return alpha > 0 ? { ...pos, alpha, lostAt } : undefined;
  }
  const appear = s === 0 ? interpolate(frame, [to.start + Math.round(i * STAGGER_S * fps), to.start + Math.round((i * STAGGER_S + 0.35) * fps)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  return { ...pos, alpha: appear, transit, prog: t };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Smooth 0→1 between 0 and 1 (no corner at either end). */
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** A fight's pull reaches this far (token radii): full within FIGHT_FULL_R, none beyond FIGHT_REACH_R. */
const FIGHT_FULL_R = 8;
const FIGHT_REACH_R = 12;
/** A blow's pace: one lunge in and back every ~0.7 s at 30 fps. */
const STRIKE_RAD_PER_FRAME = 0.3;
/** A fallen token's motion dies away over about this many frames. */
const FALL_STOP_FRAMES = 4;

/**
 * Every side's tokens at `frame` on screen (`k` = screen px per world px): spaced, and in a fight closing in on the
 * enemy and striking at it. Every motion is continuous from frame to frame (owner, 26 Oct 2026, of the Kosovo close
 * battle: "sanki takılarak hareket var, daha akıcı olması lazım" — a token used to leap up to 117 px in one frame when an
 * enemy came within its reach, and its blows stopped dead half the time): the pull fades in with distance, aims at the
 * near enemies together rather than snapping between two, blows are smooth lunges, a fallen token stays where it fell,
 * and a token that dies, appears, routs or goes through a breach lets go of its neighbours and its fight gradually.
 */
export function placeTokens(map: V3GeoMap, frame: number, fps: number, k: number): (PlacedToken | undefined)[][] {
  const units = map.units ?? [];
  const r = TOKEN_R * k;
  const gap = r * (units.some((u) => u.kind) ? 3 : 2.25);
  const spaced = (f: number) => {
    const placed = units.map((u) => Array.from({ length: Math.max(...u.steps.map((s) => s.points.length)) }, (_, i) => tokenAt(u, i, f, fps)));
    const shown = placed.flatMap((side) => side.filter((t): t is PlacedToken => t !== undefined));
    separateTokens(shown, gap, shown.map((t) => t.alpha)).forEach((q, j) => Object.assign(shown[j]!, q));
    return placed;
  };
  const placed = spaced(frame);
  // A fight (owner, 22 Oct 2026: "they move, close in on each other … it must show they fight the enemy"): every
  // standing token goes for the enemy near it until they touch, then strikes at it again and again while the losses
  // fall; when the fight is over they step back into their formation.
  const fight = (map.fights ?? []).find((f) => frame >= f.start && frame < f.start + f.durationS * fps);
  if (!fight) return placed;
  const engageAt = (f: number) => {
    const local = (f - fight.start) / fps;
    return Easing.inOut(Easing.cubic)(clamp01((local - 0.4) / 1.3)) * (1 - clamp01((local - (fight.durationS - 0.7)) / 0.7));
  };
  const movesAt = (f: number, pl: (PlacedToken | undefined)[][], strikes: boolean) =>
    pl.map((side, ui) =>
      side.map((t, ti) => {
        if (!t) return { x: 0, y: 0 };
        // A side's other units (its wings, its reserve) are no enemies.
        const enemies = pl.flatMap((other, oi) => (units[oi]!.side === units[ui]!.side ? [] : other.filter((q): q is PlacedToken => q !== undefined)));
        // A fallen enemy counts as further and further off from the moment it falls until it is gone (out of reach by
        // then, so its going is no jump); one still appearing, as nearer as it shows.
        const dist = enemies.map((q) => {
          const going = q.lostAt !== undefined ? clamp01((f - q.lostAt) / ((FALLEN_S + 0.5) * fps)) : 1 - q.alpha;
          return Math.hypot(q.x - t.x, q.y - t.y) + going * r * (FIGHT_REACH_R + 2);
        });
        const dmin = Math.min(Infinity, ...dist);
        if (!Number.isFinite(dmin)) return { x: 0, y: 0 };
        // Towards the near enemies together, so two at the same distance never make it swing from one to the other.
        let wx = 0;
        let wy = 0;
        let ws = 0;
        enemies.forEach((q, j) => {
          const w = Math.exp(-(dist[j]! - dmin) / (r * 3));
          wx += (q.x - t.x) * w;
          wy += (q.y - t.y) * w;
          ws += w;
        });
        const len = Math.hypot(wx, wy);
        if (ws <= 0 || len < 1e-6) return { x: 0, y: 0 };
        const reach = 1 - smooth((dmin - r * FIGHT_FULL_R) / (r * (FIGHT_REACH_R - FIGHT_FULL_R)));
        // Half the gap each (the enemy comes too), then blow after blow: a smooth lunge in and back.
        const strike = strikes ? ((1 - Math.cos(f * STRIKE_RAD_PER_FRAME + ti * 1.7 + ui)) / 2) * r * 0.35 : 0;
        // Routing, or on its way through a breach: it lets go of the fight as it goes, and takes it up again through.
        const free = t.rout !== undefined ? 1 - clamp01(t.rout * 4) : t.transit ? clamp01(1 - (t.prog ?? 0) * 4) + clamp01(((t.prog ?? 0) - 0.75) * 4) : 1;
        const go = ((Math.max(0, dmin - r * 2.1) / 2) * reach + strike * reach) * engageAt(f) * free;
        return { x: (wx / len) * go, y: (wy / len) * go };
      }),
    );
  const moves = movesAt(frame, placed, true);
  // A fallen token comes to rest where it fell: its own time slows to a stop within a few frames of the blow (a dead
  // stop from full speed read as a jolt), and so does its pull and blow.
  const fell = new Map<number, ReturnType<typeof movesAt>>();
  placed.forEach((side, ui) =>
    side.forEach((t, ti) => {
      if (!t || t.lostAt === undefined) return;
      const at = t.lostAt - 1;
      if (at < fight.start) {
        moves[ui]![ti] = { x: 0, y: 0 };
        return;
      }
      const slowed = at + FALL_STOP_FRAMES * (1 - Math.exp(-(frame - at) / FALL_STOP_FRAMES));
      if (!fell.has(slowed)) fell.set(slowed, movesAt(slowed, spaced(slowed), true));
      moves[ui]![ti] = fell.get(slowed)![ui]![ti] ?? { x: 0, y: 0 };
    }),
  );
  placed.forEach((side, ui) => side.forEach((t, ti) => t && Object.assign(t, { x: t.x + moves[ui]![ti]!.x, y: t.y + moves[ui]![ti]!.y })));
  return placed;
}

/** A burst where fighting happens: dust and sparks before gunpowder, a fireball and smoke after. `p` 0..1. */
export function Burst({ x, y, r, p, era, seed }: { x: number; y: number; r: number; p: number; era: V3GeoMap["era"]; seed: number }) {
  if (p <= 0 || p >= 1) return null;
  const grow = Easing.out(Easing.cubic)(p);
  const fade = 1 - Easing.in(Easing.quad)(p);
  const gun = era === "erken-modern" || era === "modern";
  const puffs = [0, 1, 2, 3].map((j) => ({ a: rand(seed + j) * Math.PI * 2, d: 0.35 + rand(seed + j + 9) * 0.45, s: 0.5 + rand(seed + j + 19) * 0.4 }));
  return (
    <g transform={`translate(${x} ${y})`} opacity={fade}>
      {/* Smoke or dust rising and spreading. */}
      {puffs.map((q, j) => (
        <circle key={j} cx={Math.cos(q.a) * q.d * r * grow} cy={Math.sin(q.a) * q.d * r * grow - p * r * 0.7} r={r * q.s * (0.5 + grow * 0.7)} fill={gun ? "#4a4440" : "#c9b48a"} opacity={0.55} />
      ))}
      {gun ? (
        <g>
          <circle r={r * (0.35 + grow * 0.55)} fill="#ff8c1a" stroke={INK} strokeWidth={r * 0.06} opacity={1 - p * 0.6} />
          <circle r={r * (0.2 + grow * 0.32)} fill="#ffd166" opacity={1 - p} />
        </g>
      ) : (
        <g stroke="#ffffff" strokeWidth={r * 0.08} strokeLinecap="round" opacity={1 - p}>
          {[0, 1, 2, 3, 4, 5].map((j) => {
            const a = (j / 6) * Math.PI * 2 + seed;
            return <path key={j} d={`M${Math.cos(a) * r * 0.15} ${Math.sin(a) * r * 0.15} L${Math.cos(a) * r * (0.3 + grow * 0.5)} ${Math.sin(a) * r * (0.3 + grow * 0.5)}`} />;
          })}
        </g>
      )}
    </g>
  );
}

/** A battle at a place: bursts popping round it for a few seconds (era-dependent), under the crossed swords. */
export function BattleBursts({ x, y, start, frame, fps, k, era, seed }: { x: number; y: number; start: number; frame: number; fps: number; k: number; era: V3GeoMap["era"]; seed: number }) {
  const local = frame - start;
  if (local < 0 || local > fps * 4.2) return null;
  const count = 7;
  return (
    <g>
      {Array.from({ length: count }, (_, j) => {
        const at = Math.round(j * fps * 0.5);
        const dur = Math.round(fps * 0.9);
        const p = (local - at) / dur;
        const a = rand(seed * 7 + j) * Math.PI * 2;
        const d = (30 + rand(seed * 3 + j) * 55) * k;
        return <Burst key={j} x={x + Math.cos(a) * d} y={y + Math.sin(a) * d * 0.7} r={(30 + rand(seed + j * 5) * 18) * k} p={p} era={era} seed={seed * 31 + j} />;
      })}
    </g>
  );
}

/** How long a strength label takes to glide to its place at a new formation (seconds). */
const LABEL_GLIDE_S = 0.8;

/**
 * Where a unit's strength label stands against its formation's middle once the formation of frame `f` has settled (no
 * fight): just behind the formation, away from the enemy; then further back or to the sides, the first place clear of
 * every badge on the map then (Kosovo 1389: Murad's badge stood on his army's label; a badge is ~150 px wide and rises
 * ~140 px over its place); else in front of it. `w`: the label's width, `s`: the screen scale.
 */
function labelOffset(map: V3GeoMap, ui: number, f: number, fps: number, k: number, w: number, s: number): { x: number; y: number } {
  const r = TOKEN_R * k;
  const units = map.units ?? [];
  const pl = placeTokens({ ...map, fights: [] }, f, fps, k);
  const standing = pl.map((side) => side.filter((t): t is PlacedToken => t !== undefined && t.lostAt === undefined));
  const middle = (pts: readonly { x: number; y: number }[]) => (pts.length ? { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length } : undefined);
  const pts = standing[ui] ?? [];
  const own = middle(pts);
  if (!own) return { x: 0, y: r * 3 };
  const foe = middle(standing.flatMap((st, oi) => (units[oi]!.side === units[ui]!.side ? [] : st)));
  const away = foe ? { x: own.x - foe.x, y: own.y - foe.y } : { x: 0, y: 1 };
  const len = Math.hypot(away.x, away.y) || 1;
  const ax = away.x / len;
  const ay = away.y / len;
  // Just behind the formation's rear: its depth along the way away from the enemy (a long front is not that deep).
  const reach = Math.max(0, ...pts.map((p) => (p.x - own.x) * ax + (p.y - own.y) * ay)) + r * 2.4;
  const front = Math.max(0, ...pts.map((p) => -((p.x - own.x) * ax + (p.y - own.y) * ay))) + r * 2.4;
  const badgeBoxes = (map.badges ?? []).filter((b) => f >= b.start && (b.end === undefined || f < b.end)).map((b) => b.path[b.path.length - 1]!).filter(Boolean).map((p) => ({ x0: p.x - 80 * s, x1: p.x + 80 * s, y0: p.y - 145 * s, y1: p.y + 10 * s }));
  const clear = (c: { x: number; y: number }) => badgeBoxes.every((bx) => c.x + w / 2 < bx.x0 || c.x - w / 2 > bx.x1 || c.y + 17 * s < bx.y0 || c.y - 17 * s > bx.y1);
  const spots = [0, 1.6, 3.2].flatMap((more) => [0, 1, -1].map((side) => ({ x: own.x + ax * (reach + more * r) - ay * side * (w / 2 + 90 * s), y: own.y + ay * (reach + more * r) + ax * side * (w / 2 + 90 * s) })));
  const ahead = [0, 1, -1].map((side) => ({ x: own.x - ax * front - ay * side * (w / 2 + 90 * s), y: own.y - ay * front + ax * side * (w / 2 + 90 * s) }));
  const at = [...spots, ...ahead].find(clear) ?? spots[0]!;
  return { x: at.x - own.x, y: at.y - own.y };
}

/** Every side's tokens, the clashes where two sides meet, and the puffs where tokens are lost. */
/** `view`: the world rectangle the camera shows at this frame (MapView); a label at its edge fades. */
export function UnitTokens({ map, frame, fps, k, view }: { map: V3GeoMap; frame: number; fps: number; k: number; view?: { x0: number; y0: number; x1: number; y1: number } }) {
  const units = map.units ?? [];
  if (!units.length) return null;
  const r = TOKEN_R * k;
  // Spaced on screen for this frame's zoom, all sides together, and closing in where they fight.
  const placed = placeTokens(map, frame, fps, k);
  // Where two sides' standing tokens nearly touch, the front flickers with clashes.
  const clashes: { x: number; y: number; seed: number }[] = [];
  for (let a = 0; a < units.length; a++)
    for (let b = a + 1; b < units.length; b++)
      if (units[a]!.side !== units[b]!.side)
        placed[a]!.forEach((p, i) =>
        placed[b]!.forEach((q, j) => {
          if (p && q && p.alpha > 0.8 && q.alpha > 0.8 && Math.hypot(p.x - q.x, p.y - q.y) < r * 3.2) clashes.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, seed: a * 1000 + b * 100 + i * 10 + j });
        }),
      );
  const period = Math.round(fps * 1.1);
  // Each side's middle and its enemies' middle (standing tokens): blocks face the enemy, a label stands behind the side.
  const middle = (pts: readonly { x: number; y: number }[]) => (pts.length ? { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length } : undefined);
  const standing = placed.map((side) => side.filter((t): t is NonNullable<typeof t> => t !== undefined && t.lostAt === undefined));
  const centres = standing.map(middle);
  const enemyOf = (ui: number) => middle(standing.flatMap((s, oi) => (units[oi]!.side === units[ui]!.side ? [] : s)));
  return (
    <g>
      {/* The side the narrator speaks of is framed in light while the line is told (DFT Tarih's highlight). */}
      {units.map((u, ui) => {
        const h = (u.highlights ?? []).find((x) => frame >= x.start && frame < x.end);
        const pts = standing[ui]!;
        if (!h || !pts.length) return null;
        const a = Math.min(interpolate(frame, [h.start, h.start + Math.round(fps * 0.4)], [0, 1], { extrapolateRight: "clamp" }), interpolate(frame, [h.end - Math.round(fps * 0.4), h.end], [1, 0], { extrapolateLeft: "clamp" }));
        const m = r * (u.kind ? 1.9 : 1.6);
        const x0 = Math.min(...pts.map((p) => p.x)) - m;
        const y0 = Math.min(...pts.map((p) => p.y)) - m;
        const w = Math.max(...pts.map((p) => p.x)) + m - x0;
        const hh = Math.max(...pts.map((p) => p.y)) + m - y0;
        const pulse = 0.7 + 0.3 * Math.sin((frame - h.start) * 0.25);
        return (
          <g key={`hl${ui}`} opacity={a}>
            <rect x={x0} y={y0} width={w} height={hh} rx={r * 0.8} fill="#fff3a0" fillOpacity={0.08} stroke="#fff3a0" strokeOpacity={0.5 * pulse} strokeWidth={r * 0.7} style={{ filter: `blur(${r * 0.3}px)` }} />
            <rect x={x0} y={y0} width={w} height={hh} rx={r * 0.8} fill="none" stroke="#fffbe0" strokeWidth={r * 0.14} strokeDasharray={`${r * 0.9} ${r * 0.45}`} strokeDashoffset={-frame * r * 0.08} />
          </g>
        );
      })}
      {units.map((u, ui) =>
        placed[ui]!.map((t, i) => {
          if (!t) return null;
          // A slight shake while it fights, so a front reads as alive (fading in and out as the clash comes near).
          const near = Math.min(Infinity, ...clashes.map((c) => Math.hypot(c.x - t.x, c.y - t.y)));
          const jx = Math.sin(frame * 0.9 + i) * r * 0.08 * clamp01((r * 2.4 - near) / (r * 0.8));
          const lostPuff = t.lostAt !== undefined ? (frame - t.lostAt) / (fps * 0.8) : 0;
          // A block faces the enemy; a routed one turns its back and staggers as it runs.
          const own = centres[ui];
          const foe = enemyOf(ui);
          const facing = own && foe ? (Math.atan2(foe.y - own.y, foe.x - own.x) * 180) / Math.PI + 90 : 0;
          const turn = t.rout !== undefined ? 180 * Math.min(1, t.rout * 2.5) + Math.sin(frame * 0.7 + i * 2) * 14 : 0;
          return (
            <g key={`${ui}-${i}`}>
              <g transform={`translate(${t.x + jx} ${t.y})`} opacity={t.alpha}>
                {u.kind ? (
                  <UnitBlock kind={u.kind} color={u.color} r={r} turn={facing + turn} />
                ) : (
                  <>
                    <circle r={r * 1.12} fill="rgba(0,0,0,0.35)" transform={`translate(${r * 0.12} ${r * 0.16})`} />
                    <circle r={r} fill={u.color} stroke="#ffffff" strokeWidth={r * 0.16} />
                    <circle r={r * 1.08} fill="none" stroke={INK} strokeWidth={r * 0.08} />
                    <g transform={`scale(${r * 0.78}) rotate(${t.rout !== undefined ? Math.sin(frame * 0.7 + i * 2) * 18 : 0})`}>
                      <Emblem kind={u.emblem} bg={u.color} {...(u.letters ? { letters: u.letters } : {})} />
                    </g>
                  </>
                )}
                {/* Fallen: greyed and crossed out, like the reference maps' struck-out tokens. */}
                {t.lostAt !== undefined ? (
                  <g>
                    {u.kind ? <rect x={(-r * BLOCK_W) / 2} y={(-r * BLOCK_H) / 2} width={r * BLOCK_W} height={r * BLOCK_H} rx={r * 0.12} fill="#2a2a2a" opacity={0.45} transform={`rotate(${facing})`} /> : <circle r={r} fill="#2a2a2a" opacity={0.45} />}
                    <path d={`M${-r * 0.55} ${-r * 0.55} L${r * 0.55} ${r * 0.55} M${r * 0.55} ${-r * 0.55} L${-r * 0.55} ${r * 0.55}`} stroke={INK} strokeWidth={r * 0.34} strokeLinecap="round" />
                    <path d={`M${-r * 0.55} ${-r * 0.55} L${r * 0.55} ${r * 0.55} M${r * 0.55} ${-r * 0.55} L${-r * 0.55} ${r * 0.55}`} stroke="#ffffff" strokeWidth={r * 0.18} strokeLinecap="round" />
                  </g>
                ) : null}
              </g>
              {/* Dust kicked up by a routed token as it runs. */}
              {t.rout !== undefined && t.rout > 0.05 && t.rout < 0.95 ? <Burst x={t.x} y={t.y + r * 0.5} r={r * 0.9} p={((frame + i * 9) % 24) / 24} era="orta" seed={ui * 53 + i} /> : null}
              {/* Melee: dust and sword sparks in every age (cannon fire belongs to the guns). */}
              {t.lostAt !== undefined ? <Burst x={t.x} y={t.y} r={r * 1.4} p={lostPuff} era="orta" seed={ui * 97 + i} /> : null}
            </g>
          );
        }),
      )}
      {clashes.map((c) => {
        const phase = (frame + (c.seed % period)) % period;
        return <Burst key={`c${c.seed}`} x={c.x} y={c.y} r={r * 1.1} p={phase / (fps * 0.7)} era="orta" seed={c.seed + Math.floor((frame + (c.seed % period)) / period)} />;
      })}
      {/* Each side's strength beside its formation, on the side away from the enemy ("11 Legions – 47,000 men"). */}
      {units.map((u, ui) => {
        let label = u.label;
        for (const st of u.steps) if (st.start <= frame && st.label) label = st.label;
        const own = centres[ui];
        if (!label || !standing[ui]!.length || !own) return null;
        const s = r / TOKEN_R;
        const w = (label.length * 11.5 + 30) * s;
        // Where it stands against its formation is chosen once a step, from where the step's formation settles, and
        // glides to the next step's place (owner, 26 Oct 2026: "takılarak hareket var" — chosen afresh every frame it
        // leapt from behind the side to beside it and back as the tokens moved).
        const at = (() => {
          let si = 0;
          u.steps.forEach((st, i) => (st.start <= frame ? (si = i) : undefined));
          const settled = (i: number) => Math.min(u.steps[i + 1] ? u.steps[i + 1]!.start - 1 : Infinity, u.steps[i]!.start + Math.round((SLIDE_S + 0.6) * fps));
          const offset = (i: number) => labelOffset(map, ui, settled(i), fps, k, w, s);
          const now = offset(si);
          const blend = si > 0 ? Easing.inOut(Easing.cubic)(clamp01((frame - u.steps[si]!.start) / (fps * LABEL_GLIDE_S))) : 1;
          const before = blend < 1 ? offset(si - 1) : now;
          return { x: own.x + before.x + (now.x - before.x) * blend, y: own.y + before.y + (now.y - before.y) * blend };
        })();
        // Near the picture's edge it fades rather than standing cut (the routed Serbians of Kosovo ran to the top edge).
        const m = 12 * s;
        const inside = view ? Math.min(at.x - w / 2 - view.x0 - m, view.x1 - m - at.x - w / 2, at.y - 17 * s - view.y0 - m, view.y1 - m - at.y - 17 * s) : Infinity;
        const edge = clamp01(inside / (24 * s) + 1);
        const first = u.steps[0]!.start;
        const a = interpolate(frame, [first + Math.round(fps * 0.4), first + Math.round(fps * 0.9)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) * edge;
        if (a <= 0) return null;
        return (
          <g key={`lb${ui}`} transform={`translate(${at.x} ${at.y})`} opacity={a}>
            <rect x={-w / 2} y={-17 * s} width={w} height={34 * s} rx={6 * s} fill="rgba(16,12,20,0.82)" stroke={u.color} strokeWidth={3.5 * s} />
            <text x={0} y={7 * s} textAnchor="middle" style={{ font: `700 ${21 * s}px 'Bahnschrift', 'Segoe UI', sans-serif` }} fill="#ffffff">
              {label}
            </text>
          </g>
        );
      })}
      {/* A unit's own name at it while the narrator speaks of it or it moves ("Bayezid's right wing" as it sweeps). */}
      {units.map((u, ui) => {
        const c = (u.callouts ?? []).find((x) => frame >= x.start - fps * 0.2 && frame < x.end + fps * 0.4);
        const pts = standing[ui]!;
        const own = centres[ui];
        if (!u.name || !c || !pts.length || !own) return null;
        const a = Math.min(clamp01((frame - (c.start - fps * 0.2)) / (fps * 0.4)), clamp01((c.end + fps * 0.4 - frame) / (fps * 0.4)));
        const s = r / TOKEN_R;
        const w = (u.name.length * 10 + 24) * s;
        // Just in front of the unit, towards the enemy, so it never sits on the side's own strength label behind.
        const foe = enemyOf(ui);
        const dir = foe ? { x: foe.x - own.x, y: foe.y - own.y } : { x: 0, y: -1 };
        const d = Math.hypot(dir.x, dir.y) || 1;
        const reach = Math.max(0, ...pts.map((p) => ((p.x - own.x) * dir.x + (p.y - own.y) * dir.y) / d)) + r * 1.9;
        const x = own.x + (dir.x / d) * reach;
        const y = own.y + (dir.y / d) * reach;
        return (
          <g key={`ad${ui}`} transform={`translate(${x} ${y})`} opacity={a}>
            <rect x={-w / 2} y={-14 * s} width={w} height={28 * s} rx={14 * s} fill={u.color} stroke="#ffffff" strokeWidth={2.5 * s} />
            <text x={0} y={6 * s} textAnchor="middle" style={{ font: `700 ${17 * s}px 'Bahnschrift', 'Segoe UI', sans-serif` }} fill="#ffffff">
              {u.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}
