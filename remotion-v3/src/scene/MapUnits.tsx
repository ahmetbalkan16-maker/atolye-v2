import React from "react";
import { Easing, interpolate } from "remotion";
import type { V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";
import { INK } from "../character/rig";
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

/** Where a side's token `i` is at `frame`, and whether it is still standing (with its fade). */
function tokenAt(u: Units, i: number, frame: number, fps: number): { x: number; y: number; alpha: number; lostAt?: number } | undefined {
  const steps = u.steps;
  if (!steps.length || frame < steps[0]!.start) return undefined;
  let s = 0;
  while (s + 1 < steps.length && steps[s + 1]!.start <= frame) s++;
  const to = steps[s]!;
  const from = steps[Math.max(0, s - 1)]!;
  const begin = to.start + Math.round(i * STAGGER_S * fps);
  const t = s === 0 ? 1 : interpolate(frame, [begin, begin + Math.round(SLIDE_S * fps)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const a = from.points[Math.min(i, from.points.length - 1)]!;
  const b = to.points[Math.min(i, to.points.length - 1)]!;
  const pos = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  // A token lost in this step fades after the slide; one lost before is gone.
  const lostBefore = s > 0 && i >= from.alive;
  if (lostBefore) return undefined;
  if (i >= to.alive) {
    const lostAt = to.start + Math.round(SLIDE_S * 0.6 * fps);
    const alpha = interpolate(frame, [lostAt, lostAt + Math.round(fps * 0.5)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return alpha > 0 ? { ...pos, alpha, lostAt } : undefined;
  }
  const appear = s === 0 ? interpolate(frame, [to.start + Math.round(i * STAGGER_S * fps), to.start + Math.round((i * STAGGER_S + 0.35) * fps)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  return { ...pos, alpha: appear };
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

/** Every side's tokens, the clashes where two sides meet, and the puffs where tokens are lost. */
export function UnitTokens({ map, frame, fps, k }: { map: V3GeoMap; frame: number; fps: number; k: number }) {
  const units = map.units ?? [];
  if (!units.length) return null;
  const r = TOKEN_R * k;
  const placed = units.map((u) => Array.from({ length: Math.max(...u.steps.map((s) => s.points.length)) }, (_, i) => tokenAt(u, i, frame, fps)));
  // Spaced on screen for this frame's zoom, all sides together.
  const shown = placed.flatMap((side) => side.filter((t) => t !== undefined));
  separateTokens(shown, r * 2.25).forEach((q, j) => Object.assign(shown[j]!, q));
  // Where two sides' standing tokens nearly touch, the front flickers with clashes.
  const clashes: { x: number; y: number; seed: number }[] = [];
  for (let a = 0; a < units.length; a++)
    for (let b = a + 1; b < units.length; b++)
      placed[a]!.forEach((p, i) =>
        placed[b]!.forEach((q, j) => {
          if (p && q && p.alpha > 0.8 && q.alpha > 0.8 && Math.hypot(p.x - q.x, p.y - q.y) < r * 3.2) clashes.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, seed: a * 1000 + b * 100 + i * 10 + j });
        }),
      );
  const period = Math.round(fps * 1.1);
  return (
    <g>
      {units.map((u, ui) =>
        placed[ui]!.map((t, i) => {
          if (!t) return null;
          // A slight shake while it fights, so a front reads as alive.
          const fighting = clashes.some((c) => Math.hypot(c.x - t.x, c.y - t.y) < r * 2);
          const jx = fighting ? Math.sin(frame * 0.9 + i) * r * 0.08 : 0;
          const lostPuff = t.lostAt !== undefined ? (frame - t.lostAt) / (fps * 0.8) : 0;
          return (
            <g key={`${ui}-${i}`}>
              <g transform={`translate(${t.x + jx} ${t.y})`} opacity={t.alpha}>
                <circle r={r * 1.12} fill="rgba(0,0,0,0.35)" transform={`translate(${r * 0.12} ${r * 0.16})`} />
                <circle r={r} fill={u.color} stroke="#ffffff" strokeWidth={r * 0.16} />
                <circle r={r * 1.08} fill="none" stroke={INK} strokeWidth={r * 0.08} />
                <g transform={`scale(${r * 0.78})`}>
                  <Emblem kind={u.emblem} bg={u.color} {...(u.letters ? { letters: u.letters } : {})} />
                </g>
              </g>
              {t.lostAt !== undefined ? <Burst x={t.x} y={t.y} r={r * 1.4} p={lostPuff} era={map.era} seed={ui * 97 + i} /> : null}
            </g>
          );
        }),
      )}
      {clashes.map((c) => {
        const phase = (frame + (c.seed % period)) % period;
        return <Burst key={`c${c.seed}`} x={c.x} y={c.y} r={r * 1.1} p={phase / (fps * 0.7)} era={map.era} seed={c.seed + Math.floor((frame + (c.seed % period)) / period)} />;
      })}
    </g>
  );
}
