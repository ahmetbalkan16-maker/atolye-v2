import React from "react";
import { Easing, interpolate } from "remotion";
import type { V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";
import { INK } from "../character/rig";
import { along } from "./mapGeometry";
import { formationOrder, separateTokens, type TokenWay } from "./unitLayout";
import { yer } from "./LayoutProbe";
import { type Box, labelSpot } from "./hudLayout";
import { crowdFigures, crowdGrid, facingDir, type Foe, marching, menOf, thinShare, type UnitKind } from "./unitCrowd";
import type { TiltLayer, Up } from "./tilt";

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
/** A block on a 1080p screen: its width and depth against the token radius (within the 3-radius spacing of blocks, deep enough for five ranks of soldiers). */
const BLOCK_W = 2.9;
const BLOCK_H = 2;

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

/** `#rrggbb` mixed with white by `a` (0..1); any other colour is returned as it is. */
function tint(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const mix = (c: number) => Math.round(c + (255 - c) * a);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

/** `#rrggbb` darkened by `a` (0..1). */
function shade(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const mix = (c: number) => Math.round(c * (1 - a));
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

const HORSES = ["#6b4a2f", "#8a6440", "#4e3624", "#9c7a55"] as const;

/** Whether a side's colour is so light that white or tinted parts on it would not read (Rome's white at Cannae). */
function isLight(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.72;
}

/**
 * One soldier seen from above, front up, in a cell `cw` × `ch`: foot behind its shield, spearmen with their spears
 * forward over the front, archers with a bow, musketeers with a gun, a rider on his horse, a gun with its crew.
 */
function Soldier({ kind, color, cw, ch, seed }: { kind: UnitKind; color: string; cw: number; ch: number; seed: number }) {
  const s = Math.min(cw, ch);
  const head = isLight(color) ? shade(color, 0.32) : tint(color, 0.45);
  const line = s * 0.08;
  switch (kind) {
    case "suvari":
      return (
        <g>
          <ellipse cx={0} cy={0} rx={cw * 0.24} ry={ch * 0.4} fill={HORSES[Math.floor(rand(seed + 3) * HORSES.length)]} stroke={INK} strokeWidth={line} />
          <ellipse cx={0} cy={-ch * 0.42} rx={cw * 0.11} ry={ch * 0.14} fill={HORSES[Math.floor(rand(seed + 3) * HORSES.length)]} stroke={INK} strokeWidth={line} />
          <ellipse cx={0} cy={ch * 0.02} rx={cw * 0.2} ry={ch * 0.11} fill={color} stroke={INK} strokeWidth={line} />
          <circle cx={0} cy={ch * 0.02} r={cw * 0.12} fill={head} stroke={INK} strokeWidth={line} />
        </g>
      );
    case "topcu":
      return (
        <g>
          <rect x={-cw * 0.3} y={-ch * 0.08} width={cw * 0.1} height={ch * 0.3} fill="#5a4630" stroke={INK} strokeWidth={line} />
          <rect x={cw * 0.2} y={-ch * 0.08} width={cw * 0.1} height={ch * 0.3} fill="#5a4630" stroke={INK} strokeWidth={line} />
          <rect x={-cw * 0.09} y={-ch * 0.42} width={cw * 0.18} height={ch * 0.66} rx={cw * 0.06} fill="#3a3532" stroke={INK} strokeWidth={line} />
          <circle cx={-cw * 0.3} cy={ch * 0.36} r={cw * 0.1} fill={head} stroke={INK} strokeWidth={line} />
          <circle cx={cw * 0.3} cy={ch * 0.36} r={cw * 0.1} fill={head} stroke={INK} strokeWidth={line} />
        </g>
      );
    case "mizrakci":
      return (
        <g>
          <path d={`M${s * 0.16} ${s * 0.15} L${s * 0.16} ${-s * 1.15}`} stroke="#eadcbc" strokeWidth={line * 1.1} strokeLinecap="round" />
          <ellipse cx={-s * 0.06} cy={-s * 0.2} rx={s * 0.36} ry={s * 0.16} fill={color} stroke={INK} strokeWidth={line} />
          <circle cx={0} cy={s * 0.07} r={s * 0.29} fill={head} stroke={INK} strokeWidth={line} />
        </g>
      );
    case "okcu":
      return (
        <g>
          <path d={`M${-s * 0.34} ${-s * 0.1} Q0 ${-s * 0.5} ${s * 0.34} ${-s * 0.1}`} fill="none" stroke="#7a5230" strokeWidth={line * 1.2} strokeLinecap="round" />
          <circle cx={0} cy={s * 0.07} r={s * 0.29} fill={head} stroke={INK} strokeWidth={line} />
        </g>
      );
    case "tufekci":
      return (
        <g>
          <path d={`M${s * 0.14} ${s * 0.05} L${s * 0.14} ${-s * 0.62}`} stroke="#2b2420" strokeWidth={line * 1.3} strokeLinecap="round" />
          <ellipse cx={0} cy={s * 0.06} rx={s * 0.3} ry={s * 0.16} fill={color} stroke={INK} strokeWidth={line} />
          <circle cx={0} cy={s * 0.04} r={s * 0.2} fill={shade(color, 0.45)} stroke={INK} strokeWidth={line} />
        </g>
      );
    default:
      // Foot and swordsmen: the shield in front, the head (helmet) behind it.
      return (
        <g>
          <ellipse cx={0} cy={-s * 0.22} rx={s * 0.46} ry={s * 0.2} fill={color} stroke={INK} strokeWidth={line} />
          <circle cx={0} cy={s * 0.08} r={s * 0.3} fill={head} stroke={INK} strokeWidth={line} />
        </g>
      );
  }
}

const KINDS: readonly UnitKind[] = ["piyade", "kilicli", "mizrakci", "okcu", "tufekci", "suvari", "topcu"];

/**
 * A unit block as a regiment seen from above (owner, 12 Nov 2026: "ordu sayısı daha fazla gözüksün"): a patch of
 * ground in the side's colour full of soldiers in ranks and files (unitCrowd), a bright front edge towards the enemy, and
 * the kind's sign on a standard at its rear (owner, 26 Oct 2026: every kind's sign must read at a glance). Drawn about
 * its centre, the front up (the caller turns it by `turn` degrees; the sign stays upright); `r` is the token radius.
 * `thin`: share of figures gone from the ranks; `fallen`: how far the block itself has fallen (its figures drop one by
 * one, its ground fades); `march`: how much it is on the march (the figures bob); `rout`: how far it has broken (the
 * figures scatter, the ranks dissolve).
 */
export function UnitBlock({ kind, color, r, turn = 0, seed = 0, menPerBlock, thin = 0, fallen = 0, march = 0, rout = 0, frame = 0 }: { kind: string; color: string; r: number; turn?: number; seed?: number; menPerBlock?: number; thin?: number; fallen?: number; march?: number; rout?: number; frame?: number }) {
  const w = r * BLOCK_W;
  const h = r * BLOCK_H;
  const k: UnitKind = KINDS.includes(kind as UnitKind) ? (kind as UnitKind) : "piyade";
  const grid = crowdGrid(k, menPerBlock);
  const figs = crowdFigures(k, grid, w * 0.92, h * 0.84, seed);
  const cw = (w * 0.92) / grid.cols;
  const ch = (h * 0.84) / grid.rows;
  const gone = Math.max(thin, fallen);
  const ground = (1 - fallen) * (1 - Math.min(1, rout * 1.4));
  // The standard at the rear, turned with the block; the sign on it upright.
  const a = (turn * Math.PI) / 180;
  const back = h / 2;
  const std = { x: -Math.sin(a) * back, y: Math.cos(a) * back };
  const stdR = r * 0.56;
  const light = isLight(color);
  return (
    <g>
      <g transform={`rotate(${turn})`}>
        {ground > 0 ? (
          <g opacity={ground}>
            <rect x={-w / 2 + r * 0.12} y={-h / 2 + r * 0.16} width={w} height={h} rx={r * 0.12} fill="rgba(0,0,0,0.3)" />
            <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={r * 0.12} fill={shade(color, light ? 0.42 : 0.15)} fillOpacity={0.55} stroke={INK} strokeWidth={r * 0.08} />
            {/* The front edge, towards the enemy. */}
            <path d={`M${-w / 2 + r * 0.1} ${-h / 2 + r * 0.05} L${w / 2 - r * 0.1} ${-h / 2 + r * 0.05}`} stroke="#ffffff" strokeWidth={r * 0.14} strokeLinecap="round" />
          </g>
        ) : null}
        {figs.map((f) => {
          if (f.fall < gone) return null;
          // Broken, each runs its own way (forward in the turned block: its back to the enemy).
          const dx = rout > 0 ? (rand(f.seed + 5) - 0.5) * 2.4 * rout * r : 0;
          const dy = rout > 0 ? -rand(f.seed + 6) * 1.6 * rout * r : 0;
          const bob = march > 0 ? Math.sin(frame * 0.55 + f.seed) * ch * 0.1 * march : 0;
          return (
            <g key={f.seed} transform={`translate(${f.x + dx} ${f.y + dy + bob})`}>
              <Soldier kind={k} color={color} cw={cw} ch={ch} seed={f.seed} />
            </g>
          );
        })}
      </g>
      <g transform={`translate(${std.x} ${std.y})`} opacity={1 - fallen}>
        <circle r={stdR * 1.08} fill="rgba(0,0,0,0.3)" transform={`translate(${r * 0.08} ${r * 0.1})`} />
        <circle r={stdR} fill={light ? shade(color, 0.55) : color} stroke="#ffffff" strokeWidth={r * 0.09} />
        <circle r={stdR * 1.08} fill="none" stroke={INK} strokeWidth={r * 0.06} />
        <g transform={`scale(${stdR * 0.7})`}>
          <KindSign kind={kind} />
        </g>
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
  way?: TokenWay;
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

/** Frames back at which a token's way is sampled for the pass share (the last 12 frames). */
const PASS_SAMPLES = [0, 3, 6, 9, 12] as const;

const spacedCache = new WeakMap<Units["steps"], Map<number, Units["steps"]>>();
/**
 * A unit's steps with each formation's places spaced for tokens `gap` apart (at the gap rounded to half a world pixel,
 * so a zooming camera reuses them). A formation with fewer places than tokens is filled with its last place first, as
 * the tokens stood before (they share it until spaced).
 */
function spacedSteps(steps: Units["steps"], gap: number): Units["steps"] {
  const key = Math.round(gap * 2) / 2;
  let byGap = spacedCache.get(steps);
  if (!byGap) spacedCache.set(steps, (byGap = new Map()));
  const hit = byGap.get(key);
  if (hit) return hit;
  const tokens = Math.max(...steps.map((st) => st.points.length));
  const out = steps.map((st) => {
    if (!st.points.length) return st;
    const full = Array.from({ length: tokens }, (_, i) => st.points[Math.min(i, st.points.length - 1)]!);
    return { ...st, points: separateTokens(full, key) };
  });
  byGap.set(key, out);
  return out;
}

const orders = new WeakMap<Units["steps"], number[][]>();
/** The place token `i` takes in step `s` (unitLayout.formationOrder: least total distance, no crossing paths). */
function placeOf(steps: Units["steps"], s: number, i: number): number {
  let order = orders.get(steps);
  if (!order) {
    order = formationOrder(steps, Math.max(...steps.map((st) => st.points.length)));
    orders.set(steps, order);
  }
  return order[s]?.[i] ?? Math.min(i, steps[s]!.points.length - 1);
}

/** A token's slide to its place in one step: from where it set off, with the speed it had then. */
interface Motion {
  readonly a: { x: number; y: number };
  /** Its speed when it set off (px a frame): a step given mid-slide carries the slide's speed on (KEEP_SPEED_S). */
  readonly v: { x: number; y: number };
  readonly b: { x: number; y: number };
  readonly via?: { x: number; y: number };
  readonly begin: number;
  readonly frames: number;
  readonly rout: boolean;
  readonly queue: number;
}

/**
 * How long a token's speed carries into a step that took it on mid-slide (seconds). It used to stop dead and set off
 * again from rest — a change of speed of a whole slide's pace in one frame, more often now that moves start on the word
 * that tells them (NarratedMoves; Cannae trial, 9 Nov 2026: 19 px a frame).
 */
const KEEP_SPEED_S = 0.4;

const motionCache = new WeakMap<Units["steps"], Map<string, Motion[]>>();

/** Where a slide has the token at `f`, and how far it is on its way (eased). */
function moveAt(m: Motion, f: number, fps: number): { x: number; y: number; t: number } {
  // A routed token breaks into a run within a few frames (an ease-out started at full speed: a 22 px leap) and slows as
  // it gets away.
  const t = interpolate(f, [m.begin, m.begin + m.frames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: m.rout ? Easing.bezier(0.3, 0, 0.25, 1) : Easing.inOut(Easing.cubic) });
  // Through the breach: to the gap, then on to its place in the new formation.
  const base = m.via ? along([m.a, m.via, m.b], t) : { x: m.a.x + (m.b.x - m.a.x) * t, y: m.a.y + (m.b.y - m.a.y) * t };
  // The speed it set off with, dying away over KEEP_SPEED_S: x·(1 − x/τ)² starts at that speed and ends at rest.
  const tau = Math.max(1, Math.round(KEEP_SPEED_S * fps));
  const x = Math.min(tau, Math.max(0, f - m.begin));
  const keep = x * (1 - x / tau) ** 2;
  return { x: base.x + m.v.x * keep, y: base.y + m.v.y * keep, t };
}

/**
 * Token `i`'s slides, step by step (index 0: standing in its first formation). Each sets off from where the token is
 * at its departure under the slides before it, with its speed there. Computed once per token.
 */
function motionsOf(steps: Units["steps"], i: number, fps: number): Motion[] {
  let byToken = motionCache.get(steps);
  if (!byToken) motionCache.set(steps, (byToken = new Map()));
  const key = `${i}|${fps}`;
  const hit = byToken.get(key);
  if (hit) return hit;
  const b0 = steps[0]!.points[placeOf(steps, 0, i)]!;
  const ms: Motion[] = [{ a: b0, v: { x: 0, y: 0 }, b: b0, begin: -Infinity, frames: 1, rout: false, queue: -1 }];
  for (let k = 1; k < steps.length; k++) {
    const to = steps[k]!;
    const { begin, frames, queue } = departure(to, i, fps);
    const p1 = positionAt(ms, k - 1, begin, fps);
    const p0 = positionAt(ms, k - 1, begin - 1, fps);
    ms.push({ a: { x: p1.x, y: p1.y }, v: { x: p1.x - p0.x, y: p1.y - p0.y }, b: to.points[placeOf(steps, k, i)]!, ...(queue >= 0 && to.via ? { via: to.via } : {}), begin, frames, rout: !!to.rout, queue });
  }
  byToken.set(key, ms);
  return ms;
}

/** Where the slides up to step `k` have the token at `f` (a slide not yet set off leaves it on the one before). */
function positionAt(ms: readonly Motion[], k: number, f: number, fps: number): { x: number; y: number; t: number; k: number } {
  let j = k;
  while (j > 0 && f < ms[j]!.begin) j--;
  if (j === 0) return { x: ms[0]!.b.x, y: ms[0]!.b.y, t: 1, k: 0 };
  return { ...moveAt(ms[j]!, f, fps), k: j };
}

/**
 * Where token `i` is in step `s` at `frame`: from wherever it was when it set off to its place in this formation. A line
 * that comes before the last slide is over takes the token on from mid-way (the Kosovo trial's tokens jumped back to
 * the last formation first) at the speed it had; until it sets off it goes on with the last slide — and that way is the
 * one the spacing sees (Cannae trial, 9 Nov 2026: a router still sliding into its last place, its new way reported as
 * not yet begun, was pushed off a token it was passing — 45 px in one frame).
 */
function slideAt(steps: Units["steps"], s: number, i: number, frame: number, fps: number): { x: number; y: number; t: number; queue: number; from: { x: number; y: number }; goal: { x: number; y: number }; wayT: number } {
  const ms = motionsOf(steps, i, fps);
  const m = ms[s]!;
  if (s === 0) return { x: m.b.x, y: m.b.y, t: 1, queue: -1, from: m.b, goal: m.b, wayT: 1 };
  if (frame < m.begin) {
    const p = positionAt(ms, s - 1, frame, fps);
    const on = ms[p.k]!;
    return { x: p.x, y: p.y, t: 0, queue: m.queue, from: p.k === 0 ? on.b : on.a, goal: on.b, wayT: p.t };
  }
  const p = moveAt(m, frame, fps);
  return { x: p.x, y: p.y, t: p.t, queue: m.queue, from: m.a, goal: m.b, wayT: p.t };
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
  const { x, y, t, queue, from: start, goal, wayT } = slideAt(steps, s, i, frame, fps);
  // Its way too: the spacing lets two tokens whose ways swap sides pass each other (unitLayout.passShare).
  const pos = { x, y, way: { from: start, goal, t: wayT } };
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
  // A unit's own tokens are spaced in each of its formations as it stands (once, not frame by frame), and slide between
  // those spaced places: spaced every frame, a line too tight for its tokens (Cannae: 7 tokens 30 px apart, room 123 px)
  // was folded into a zigzag that turned over in one frame as they slid in (150 px). Frame by frame only the different
  // units are kept apart, a pair whose ways swap sides letting each other pass (unitLayout.passShare).
  const steady = units.map((u) => ({ ...u, steps: spacedSteps(u.steps, gap) }));
  const spaced = (f: number) => {
    const placed = steady.map((u) => Array.from({ length: Math.max(...u.steps.map((s) => s.points.length)) }, (_, i) => tokenAt(u, i, f, fps)));
    const shown = placed.flatMap((side) => side.filter((t): t is PlacedToken => t !== undefined));
    const group = placed.flatMap((side, ui) => side.filter((t) => t !== undefined).map(() => ui));
    // Each token's way now and over the last PASS_WINDOW frames: two passing tokens let go of their room gradually,
    // even where a new step sets off mid-slide (unitLayout.passMean).
    const ways = placed.flatMap((side, ui) => side.flatMap((t, ti) => (t ? [PASS_SAMPLES.map((back) => (back ? tokenAt(steady[ui]!, ti, f - back, fps)?.way : t.way))] : [])));
    separateTokens(shown, gap, shown.map((t) => t.alpha), ways, group).forEach((q, j) => Object.assign(shown[j]!, q));
    return placed;
  };
  const placed = spaced(frame);
  // A fallen token comes to lie where it fell, slowing to a stop within a few frames as its blows do below. Its room
  // shrinks as it fades, and the spacing let it slide back towards its formation while fading (Waterloo, 9 Nov 2026:
  // 30 px in one frame).
  const fallen = new Map<number, ReturnType<typeof spaced>>();
  placed.forEach((side, ui) =>
    side.forEach((t, ti) => {
      if (!t || t.lostAt === undefined || frame <= t.lostAt) return;
      const at = t.lostAt;
      const slowed = at + FALL_STOP_FRAMES * (1 - Math.exp(-(frame - at) / FALL_STOP_FRAMES));
      if (!fallen.has(slowed)) fallen.set(slowed, spaced(slowed));
      const then = fallen.get(slowed)![ui]![ti];
      if (then) Object.assign(t, { x: then.x, y: then.y });
    }),
  );
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

let lastPlaced: { map: V3GeoMap; frame: number; fps: number; k: number; placed: ReturnType<typeof placeTokens> } | undefined;

/**
 * placeTokens for a tilted map's two layers (MapView draws the ground and the upright labels apart, at the same frame):
 * the second asks for what the first just placed. One entry (a tab renders one frame at a time); read only.
 */
function placedOnce(map: V3GeoMap, frame: number, fps: number, k: number): ReturnType<typeof placeTokens> {
  if (lastPlaced && lastPlaced.map === map && lastPlaced.frame === frame && lastPlaced.fps === fps && lastPlaced.k === k) return lastPlaced.placed;
  const placed = placeTokens(map, frame, fps, k);
  lastPlaced = { map, frame, fps, k, placed };
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

/** A gun fires every GUN_PERIOD_S (each a little after the last); a musket line fires its volley every VOLLEY_PERIOD_S. */
const GUN_PERIOD_S = 1.7;
const VOLLEY_PERIOD_S = 2.1;
/** How long a shot's flash and smoke last (seconds). */
const GUN_SMOKE_S = 1.2;
const VOLLEY_SMOKE_S = 0.9;

/**
 * The shots of guns and musket lines at `frame` (owner, 26 Oct 2026, after the Mohács trial: "topçu ve tüfekçi birlikleri
 * ateş etmiyor"): while a fight is on, each gun token fires in turn and each musket or rifle unit fires its volley, all
 * its tokens at once. `p`: how far the shot's flash and smoke are (0..1).
 */
export function gunfireAt(map: V3GeoMap, frame: number, fps: number): { ui: number; ti: number; p: number; gun: boolean; shot: number }[] {
  const fight = (map.fights ?? []).find((f) => frame >= f.start && frame < f.start + f.durationS * fps);
  if (!fight) return [];
  const local = frame - fight.start - Math.round(fps * 0.3);
  if (local < 0) return [];
  const out: { ui: number; ti: number; p: number; gun: boolean; shot: number }[] = [];
  (map.units ?? []).forEach((u, ui) => {
    if (u.kind !== "topcu" && u.kind !== "tufekci") return;
    const gun = u.kind === "topcu";
    const count = Math.max(...u.steps.map((s) => s.points.length));
    const period = Math.round(fps * (gun ? GUN_PERIOD_S : VOLLEY_PERIOD_S));
    const life = fps * (gun ? GUN_SMOKE_S : VOLLEY_SMOKE_S);
    for (let ti = 0; ti < count; ti++) {
      // Guns one after another along the battery; a volley together, each unit at its own moment.
      const offset = gun ? Math.round((ti * period) / Math.max(1, count)) : Math.round(fps * 0.45 * ui) % period;
      const since = (((local - offset) % period) + period) % period;
      if (local - offset >= 0 && since < life) out.push({ ui, ti, p: since / life, gun, shot: Math.floor((local - offset) / period) });
    }
  });
  return out;
}

/** An archer unit looses a volley every ARCHER_PERIOD_S; its arrows are in the air ARROW_FLIGHT_S. */
export const ARCHER_PERIOD_S = 2;
export const ARROW_FLIGHT_S = 0.9;

/**
 * The volleys of archer units in the air at `frame` (owner, 12 Nov 2026: tactics must read; archers never shot): while a
 * fight is on, each archer unit's tokens loose together, each unit at its own moment. `p`: how far the arrows are on
 * their flight (0..1).
 */
export function volleysAt(map: V3GeoMap, frame: number, fps: number): { ui: number; ti: number; p: number; shot: number }[] {
  const fight = (map.fights ?? []).find((f) => frame >= f.start && frame < f.start + f.durationS * fps);
  if (!fight) return [];
  const local = frame - fight.start - Math.round(fps * 0.2);
  if (local < 0) return [];
  const out: { ui: number; ti: number; p: number; shot: number }[] = [];
  const period = Math.round(fps * ARCHER_PERIOD_S);
  const life = Math.round(fps * ARROW_FLIGHT_S);
  (map.units ?? []).forEach((u, ui) => {
    if (u.kind !== "okcu") return;
    const count = Math.max(...u.steps.map((s) => s.points.length));
    for (let ti = 0; ti < count; ti++) {
      const offset = (Math.round(fps * 0.6 * ui) % period) + ti * 2;
      const since = (((local - offset) % period) + period) % period;
      if (local - offset >= 0 && since < life) out.push({ ui, ti, p: since / life, shot: Math.floor((local - offset) / period) });
    }
  });
  return out;
}

/**
 * Every block a unit loses and the frame it falls (as tokenAt has it): in each step, the tokens from the step's `alive`
 * up to the last step's fall one by one at their `losses` moments.
 */
export function lostTokens(u: Units, fps: number): { ti: number; at: number; step: number }[] {
  const out: { ti: number; at: number; step: number }[] = [];
  const count = Math.max(...u.steps.map((s) => s.points.length));
  u.steps.forEach((to, s) => {
    const before = s === 0 ? count : u.steps[s - 1]!.alive;
    for (let i = to.alive; i < before; i++) out.push({ ti: i, at: to.start + Math.round((to.losses?.[i - to.alive] ?? SLIDE_S * 0.6) * fps), step: s });
  });
  return out;
}

const restCache = new WeakMap<V3GeoMap, Map<string, { x: number; y: number } | undefined>>();
/**
 * Where a lost block's soldiers lie: where the token came to rest as it faded (placeTokens a moment after its fall, or
 * just before the next step took it away), at this zoom (rounded, so a camera holding still reuses it).
 */
export function fallenRest(map: V3GeoMap, ui: number, l: { ti: number; at: number; step: number }, fps: number, k: number): { x: number; y: number } | undefined {
  let byMap = restCache.get(map);
  if (!byMap) restCache.set(map, (byMap = new Map()));
  const key = `${ui}|${l.ti}|${l.at}|${Math.round(k * 400)}|${fps}`;
  if (byMap.has(key)) return byMap.get(key);
  const next = map.units?.[ui]?.steps[l.step + 1]?.start;
  const rest = l.at + Math.round((FALLEN_S + 0.4) * fps);
  let found: { x: number; y: number } | undefined;
  for (const f of [next !== undefined ? Math.min(rest, next - 1) : rest, l.at]) {
    const t = placeTokens(map, f, fps, Math.round(k * 400) / 400)[ui]?.[l.ti];
    if (t) {
      found = { x: t.x, y: t.y };
      break;
    }
  }
  byMap.set(key, found);
  return found;
}

/**
 * The men behind each block of unit `ui`: its own strength label's number over its blocks, else its side's (one label
 * for the side, over all the side's blocks); none when no label names a number ("Eight legions").
 */
export function menPerBlock(units: readonly Units[], ui: number): number | undefined {
  const blocks = (u: Units) => Math.max(1, ...u.steps.map((s) => s.points.length));
  const labelled = (u: Units) => menOf(u.label) ?? Math.max(0, ...u.steps.map((s) => menOf(s.label) ?? 0));
  const own = labelled(units[ui]!);
  if (own) return own / blocks(units[ui]!);
  const side = units.filter((u) => u.side === units[ui]!.side);
  const men = side.reduce((a, u) => a + labelled(u), 0);
  return men ? men / side.reduce((a, u) => a + blocks(u), 0) : undefined;
}

/**
 * The way each standing token faces at this frame (degrees for SVG `rotate`, the block's front up): unitCrowd.facingDir
 * with every enemy token weighted as it shows (appearing, falling and fading count less and less, so no turn jumps).
 */
export function facingsAt(map: V3GeoMap, placed: readonly (readonly (PlacedToken | undefined)[])[], frame: number, fps: number, r: number): number[][] {
  const units = map.units ?? [];
  // A token just appearing counts from its first frame (at nought the side faced up, and turned to the enemy a frame on).
  const weight = (q: PlacedToken) => (q.lostAt !== undefined ? q.alpha * (1 - clamp01((frame - q.lostAt) / ((FALLEN_S + 0.5) * fps))) : Math.max(0.05, q.alpha));
  const middle = (pts: readonly PlacedToken[]) => {
    const ws = pts.reduce((a, p) => a + weight(p), 0);
    return ws > 1e-6 ? { x: pts.reduce((a, p) => a + p.x * weight(p), 0) / ws, y: pts.reduce((a, p) => a + p.y * weight(p), 0) / ws } : undefined;
  };
  const shown = placed.map((side) => side.filter((t): t is PlacedToken => t !== undefined));
  return placed.map((side, ui) => {
    const foesPts = shown.flatMap((s, oi) => (units[oi]!.side === units[ui]!.side ? [] : s));
    const foes: Foe[] = foesPts.map((q) => ({ x: q.x, y: q.y, w: weight(q) }));
    // The whole side's middle, not the unit's: a wing riding past the enemy's middle swung the way it faced round.
    const own = middle(shown.flatMap((s, oi) => (units[oi]!.side === units[ui]!.side ? s : [])));
    const foe = middle(foesPts);
    const base = own && foe ? { x: foe.x - own.x, y: foe.y - own.y } : undefined;
    return side.map((t) => {
      if (!t) return 0;
      const d = facingDir(t, foes, base, r);
      return (Math.atan2(d.y, d.x) * 180) / Math.PI + 90;
    });
  });
}

/** Frames back at which a block's way is sampled for its turn, and their weights (the latest counts most). */
const TURN_SAMPLES = [0, 3, 6, 9, 12, 15] as const;
const TURN_WEIGHTS = [6, 5, 4, 3, 2, 1] as const;

/**
 * The way each token faces at `frame`, steadied over the last half second (degrees, as facingsAt): a block turns like a
 * body of men, never faster than its last frames allow — a wing that rode past the enemy and faced back at it turned 155°
 * in twelve frames, 32° in one. Each frame is computed from the frames before it afresh (Remotion renders in any order).
 * `placed`: this frame's tokens as UnitTokens has them.
 */
export function steadyFacingsAt(map: V3GeoMap, placed: readonly (readonly (PlacedToken | undefined)[])[], frame: number, fps: number, k: number): number[][] {
  const r = TOKEN_R * k;
  const sums = placed.map((side) => side.map(() => ({ x: 0, y: 0 })));
  TURN_SAMPLES.forEach((back, si) => {
    const f = frame - back;
    const pl = back === 0 ? placed : placeTokens(map, f, fps, k);
    facingsAt(map, pl, f, fps, r).forEach((side, ui) =>
      side.forEach((deg, ti) => {
        if (!pl[ui]?.[ti] || !sums[ui]?.[ti]) return;
        const a = ((deg - 90) * Math.PI) / 180;
        sums[ui]![ti]!.x += Math.cos(a) * TURN_WEIGHTS[si]!;
        sums[ui]![ti]!.y += Math.sin(a) * TURN_WEIGHTS[si]!;
      }),
    );
  });
  return sums.map((side) => side.map((v) => (Math.atan2(v.y, v.x) * 180) / Math.PI + 90));
}

/**
 * A shot seen from above: a muzzle flash, then smoke rolling out in front of the gun and drifting off. `dx, dy`: the way
 * the unit faces; `big`: a gun's (a musket line's is a small puff at each token). `p` 0..1.
 */
function ShotSmoke({ x, y, dx, dy, r, p, big, seed }: { x: number; y: number; dx: number; dy: number; r: number; p: number; big: boolean; seed: number }) {
  const s = big ? 1.5 : 0.8;
  const out = Easing.out(Easing.cubic)(p);
  const fade = 1 - Easing.in(Easing.quad)(p);
  const puffs = [0, 1, 2].map((j) => ({ along: (0.6 + j * 0.45) * out, side: (rand(seed + j) - 0.5) * 0.7, size: (0.45 + rand(seed + j + 7) * 0.3) * (0.6 + out * 0.8) }));
  return (
    <g opacity={fade}>
      {puffs.map((q, j) => (
        <circle key={j} cx={x + (dx * q.along - dy * q.side) * r * s * 1.6 + p * r * 0.6} cy={y + (dy * q.along + dx * q.side) * r * s * 1.6 - p * r * 0.4} r={q.size * r * s} fill="#efece4" stroke="rgba(60,55,50,0.45)" strokeWidth={r * 0.05} />
      ))}
      {p < 0.18 ? <circle cx={x + dx * r * s * 0.5} cy={y + dy * r * s * 0.5} r={r * s * 0.45 * (1 - p / 0.18)} fill="#ffd166" stroke="#ff8c1a" strokeWidth={r * 0.12} /> : null}
    </g>
  );
}

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

/**
 * An archer block's volley seen from above: its arrows rise from the block and drop on the enemy, each a short shaft with
 * its shadow on the ground running under it (the higher the arrow, the further its shadow). `p` 0..1.
 */
function ArrowVolley({ from, to, r, p, seed }: { from: { x: number; y: number }; to: { x: number; y: number }; r: number; p: number; seed: number }) {
  const n = 7;
  return (
    <g opacity={1 - clamp01((p - 0.85) / 0.15)}>
      {Array.from({ length: n }, (_, j) => {
        const sx = from.x + (rand(seed + j) - 0.5) * r * 2;
        const sy = from.y + (rand(seed + j + 11) - 0.5) * r * 1.2;
        const ex = to.x + (rand(seed + j + 23) - 0.5) * r * 2.2;
        const ey = to.y + (rand(seed + j + 37) - 0.5) * r * 1.6;
        const q = clamp01(p * (1 + rand(seed + j + 5) * 0.15));
        const gx = sx + (ex - sx) * q;
        const gy = sy + (ey - sy) * q;
        const lift = Math.sin(Math.PI * q) * Math.hypot(ex - sx, ey - sy) * 0.22;
        // The shaft points along its flight: rising, then falling.
        const vx = ex - sx;
        const vy = ey - sy - Math.cos(Math.PI * q) * Math.hypot(ex - sx, ey - sy) * 0.22 * Math.PI;
        const l = Math.hypot(vx, vy) || 1;
        const ux = (vx / l) * r * 0.42;
        const uy = (vy / l) * r * 0.42;
        const gl = Math.hypot(ex - sx, ey - sy) || 1;
        const hx = ((ex - sx) / gl) * r * 0.42;
        const hy = ((ey - sy) / gl) * r * 0.42;
        return (
          <g key={j}>
            <path d={`M${gx - hx} ${gy - hy} L${gx} ${gy}`} stroke="rgba(0,0,0,0.25)" strokeWidth={r * 0.06} strokeLinecap="round" />
            <path d={`M${gx - ux} ${gy - lift - uy} L${gx} ${gy - lift}`} stroke="#3b2a1a" strokeWidth={r * 0.07} strokeLinecap="round" />
            <path d={`M${gx} ${gy - lift} l${-ux * 0.35 - uy * 0.18} ${-uy * 0.35 + ux * 0.18} M${gx} ${gy - lift} l${-ux * 0.35 + uy * 0.18} ${-uy * 0.35 - ux * 0.18}`} stroke="#3b2a1a" strokeWidth={r * 0.06} strokeLinecap="round" />
          </g>
        );
      })}
    </g>
  );
}

/**
 * The fallen of a lost block, left where it fell for the rest of the scene (owner, 12 Nov 2026: losses must show): its
 * soldiers lying in the trampled ground. `share`: how many have fallen yet (0..1).
 */
function Fallen({ x, y, r, color, seed, share }: { x: number; y: number; r: number; color: string; seed: number; share: number }) {
  const n = 9;
  const body = shade(color, 0.35);
  return (
    <g>
      <ellipse cx={x} cy={y} rx={r * 1.5} ry={r * 1.0} fill="#3a2a18" opacity={0.18 * share} />
      {Array.from({ length: n }, (_, j) => {
        if (rand(seed + j * 3) >= share) return null;
        const a = rand(seed + j) * Math.PI * 2;
        const d = Math.sqrt(rand(seed + j + 7)) * r * 1.2;
        const turn = rand(seed + j + 13) * 180;
        return (
          <g key={j} transform={`translate(${x + Math.cos(a) * d} ${y + Math.sin(a) * d * 0.75}) rotate(${turn})`} opacity={0.85}>
            <ellipse rx={r * 0.22} ry={r * 0.09} fill={body} stroke={INK} strokeWidth={r * 0.03} />
            <circle cx={r * 0.24} r={r * 0.07} fill={tint(color, 0.3)} stroke={INK} strokeWidth={r * 0.03} />
          </g>
        );
      })}
    </g>
  );
}

/** Dust kicked up behind a block on the march: a few puffs trailing it, more and longer behind horse. */
function DustTrail({ x, y, dx, dy, r, amount, horse, frame, seed }: { x: number; y: number; dx: number; dy: number; r: number; amount: number; horse: boolean; frame: number; seed: number }) {
  const n = horse ? 5 : 3;
  return (
    <g>
      {Array.from({ length: n }, (_, j) => {
        const back = r * (1.3 + j * (horse ? 0.6 : 0.5));
        const side = Math.sin(frame * 0.21 + seed + j * 1.7) * r * 0.35;
        const size = r * (0.42 + j * 0.14) * (0.9 + 0.1 * Math.sin(frame * 0.3 + j));
        return <circle key={j} cx={x - dx * back - dy * side} cy={y - dy * back + dx * side} r={size} fill="#c9b48a" opacity={0.32 * amount * (1 - j / (n + 1))} />;
      })}
    </g>
  );
}

/** Every side's tokens, the clashes where two sides meet, and the puffs where tokens are lost. */
/**
 * `up`: a tilted map's layer (MapView) — the labels stand upright over the tilted ground; absent, drawn as they are.
 * `layer`: which of a tilted map's two layers this is — the ground draws the blocks and no labels, the upright one only
 * the labels (each was drawn on both: +45 % render time). `room`: a label's room on the flat picture against its flat
 * size at a world point there (tilt.tiltRoom), so labels kept apart in world px stay apart on the tilted screen; `viewAt`:
 * the world the tilted frame shows at a row (wider at the far rows than `view`, the narrowest).
 * `view`: the world rectangle the camera shows at this frame (MapView); a label stays inside it. `avoid`: the badges and
 * screen marks in world px (MapView), which no label is printed over (labelSpot).
 */
export function UnitTokens({ map, frame, fps, k, view, avoid, up, layer, room, viewAt }: { map: V3GeoMap; frame: number; fps: number; k: number; view?: Box; avoid?: readonly Box[]; up?: Up; layer?: TiltLayer; room?: (x: number, y: number) => { fx: number; fy: number }; viewAt?: (y: number) => Box }) {
  const units = map.units ?? [];
  if (!units.length) return null;
  const r = TOKEN_R * k;
  // Spaced on screen for this frame's zoom, all sides together, and closing in where they fight (a tilted map's two
  // layers ask for the same frame: placedOnce).
  const placed = layer ? placedOnce(map, frame, fps, k) : placeTokens(map, frame, fps, k);
  const labels = layer !== "ground";
  // Where two sides' standing tokens nearly touch, the front flickers with clashes.
  const clashes: { x: number; y: number; seed: number }[] = [];
  for (let a = 0; a < (layer === "upright" ? 0 : units.length); a++)
    for (let b = a + 1; b < units.length; b++)
      if (units[a]!.side !== units[b]!.side)
        placed[a]!.forEach((p, i) =>
        placed[b]!.forEach((q, j) => {
          if (p && q && p.alpha > 0.8 && q.alpha > 0.8 && Math.hypot(p.x - q.x, p.y - q.y) < r * 3.2) clashes.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, seed: a * 1000 + b * 100 + i * 10 + j });
        }),
      );
  const period = Math.round(fps * 1.1);
  // Each block's way, its unit's men behind a block, and how thin its ranks have worn as the unit lost blocks.
  const facings = layer === "upright" ? [] : steadyFacingsAt(map, placed, frame, fps, k);
  const men = units.map((_, ui) => menPerBlock(units, ui));
  const thin = units.map((u) => {
    const count = Math.max(1, ...u.steps.map((st) => st.points.length));
    return thinShare(lostTokens(u, fps).filter((l) => l.at <= frame).length / count);
  });
  const restOf = (ui: number, l: { ti: number; at: number; step: number }) => fallenRest(map, ui, l, fps, k);
  // Where an archer's volley lands: the enemies nearest to it, together (a target that changed with the nearest one
  // made the arrows jump in flight).
  const aimOf = (ui: number, t: { x: number; y: number }) => {
    const foes = placed.flatMap((other, oi) => (units[oi]!.side === units[ui]!.side ? [] : other.filter((q): q is PlacedToken => q !== undefined && q.lostAt === undefined)));
    if (!foes.length) return undefined;
    const d = foes.map((q) => Math.hypot(q.x - t.x, q.y - t.y));
    const dmin = Math.min(...d);
    let sx = 0;
    let sy = 0;
    let sw = 0;
    foes.forEach((q, j) => {
      const w = q.alpha * Math.exp(-(d[j]! - dmin) / (r * 3));
      sx += q.x * w;
      sy += q.y * w;
      sw += w;
    });
    return sw > 1e-6 ? { x: sx / sw, y: sy / sw } : undefined;
  };
  // Each side's middle and its enemies' middle (standing tokens): blocks face the enemy, a label stands behind the side.
  const middle = (pts: readonly { x: number; y: number }[]) => (pts.length ? { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length } : undefined);
  const standing = placed.map((side) => side.filter((t): t is NonNullable<typeof t> => t !== undefined && t.lostAt === undefined));
  const centres = standing.map(middle);
  const enemyOf = (ui: number) => middle(standing.flatMap((s, oi) => (units[oi]!.side === units[ui]!.side ? [] : s)));
  const s = r / TOKEN_R;
  const U = (x: number, y: number, node: React.ReactNode) => (up ? up(x, y, node) : node);
  // The labels of this frame settle in turn — the unit the narrator names first, then each side's strength — each kept
  // inside the frame and off the badges, the screen marks and the labels settled before it (labelSpot).
  const taken: Box[] = [...(avoid ?? [])];
  const settle = (at: { x: number; y: number }, wanted: { x: number; y: number }, anchor: { x: number; y: number }) => {
    if (!view) return { ...at, alpha: 1 };
    const f = room?.(at.x, at.y);
    const half = f ? { x: wanted.x * f.fx, y: wanted.y * f.fy } : wanted;
    const spot = labelSpot(at, half, anchor, viewAt ? viewAt(at.y) : view, taken, { margin: 12 * s, fade: 40 * s, reach: half.y * 8 });
    if (spot.alpha > 0) taken.push({ x0: spot.x - half.x, x1: spot.x + half.x, y0: spot.y - half.y, y1: spot.y + half.y });
    return spot;
  };
  // A unit's own name at it while the narrator speaks of it or it moves ("Bayezid's right wing" as it sweeps).
  const callouts = (labels ? units : []).map((u, ui) => {
    const c = (u.callouts ?? []).find((x) => frame >= x.start - fps * 0.2 && frame < x.end + fps * 0.4);
    const pts = standing[ui]!;
    const own = centres[ui];
    if (!u.name || !c || !pts.length || !own) return undefined;
    const a = Math.min(clamp01((frame - (c.start - fps * 0.2)) / (fps * 0.4)), clamp01((c.end + fps * 0.4 - frame) / (fps * 0.4)));
    const w = (u.name.length * 10 + 24) * s;
    // Just in front of the unit, towards the enemy, so it never sits on the side's own strength label behind.
    const foe = enemyOf(ui);
    const dir = foe ? { x: foe.x - own.x, y: foe.y - own.y } : { x: 0, y: -1 };
    const d = Math.hypot(dir.x, dir.y) || 1;
    const reach = Math.max(0, ...pts.map((p) => ((p.x - own.x) * dir.x + (p.y - own.y) * dir.y) / d)) + r * 1.9;
    if (a <= 0) return undefined;
    const spot = settle({ x: own.x + (dir.x / d) * reach, y: own.y + (dir.y / d) * reach }, { x: w / 2, y: 14 * s }, own);
    return spot.alpha > 0 ? { name: u.name, color: u.color, w, x: spot.x, y: spot.y, a: a * spot.alpha } : undefined;
  });
  // Each side's strength beside its formation, on the side away from the enemy ("11 Legions – 47,000 men").
  const strengths = (labels ? units : []).map((u, ui) => {
    let label = u.label;
    for (const st of u.steps) if (st.start <= frame && st.label) label = st.label;
    const own = centres[ui];
    if (!label || !standing[ui]!.length || !own) return undefined;
    const w = (label.length * 11.5 + 30) * s;
    // Where it stands against its formation is chosen once a step, from where the step's formation settles, and
    // glides to the next step's place (owner, 26 Oct 2026: "takılarak hareket var" — chosen afresh every frame it
    // leapt from behind the side to beside it and back as the tokens moved).
    let si = 0;
    u.steps.forEach((st, i) => (st.start <= frame ? (si = i) : undefined));
    const settled = (i: number) => Math.min(u.steps[i + 1] ? u.steps[i + 1]!.start - 1 : Infinity, u.steps[i]!.start + Math.round((SLIDE_S + 0.6) * fps));
    const offset = (i: number) => labelOffset(map, ui, settled(i), fps, k, w, s);
    const now = offset(si);
    const blend = si > 0 ? Easing.inOut(Easing.cubic)(clamp01((frame - u.steps[si]!.start) / (fps * LABEL_GLIDE_S))) : 1;
    const before = blend < 1 ? offset(si - 1) : now;
    const first = u.steps[0]!.start;
    const a = interpolate(frame, [first + Math.round(fps * 0.4), first + Math.round(fps * 0.9)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    if (a <= 0) return undefined;
    // Near the picture's edge it slides in, and fades as its formation leaves (the routed Serbians of Kosovo ran to the
    // top edge; Waterloo's "74,326 men" stood under the date stamp).
    const spot = settle({ x: own.x + before.x + (now.x - before.x) * blend, y: own.y + before.y + (now.y - before.y) * blend }, { x: w / 2, y: 17 * s }, own);
    return spot.alpha > 0 ? { label, color: u.color, w, x: spot.x, y: spot.y, a: a * spot.alpha } : undefined;
  });
  const strengthNodes = strengths.map((l, ui) =>
    l ? (
      U(l.x, l.y, <g key={`lb${ui}`} {...yer("etiket", l.label)} transform={`translate(${l.x} ${l.y})`} opacity={l.a}>
        <rect x={-l.w / 2} y={-17 * s} width={l.w} height={34 * s} rx={6 * s} fill="rgba(16,12,20,0.82)" stroke={l.color} strokeWidth={3.5 * s} />
        <text x={0} y={7 * s} textAnchor="middle" style={{ font: `700 ${21 * s}px 'Bahnschrift', 'Segoe UI', sans-serif` }} fill="#ffffff">
          {l.label}
        </text>
      </g>)
    ) : null,
  );
  // A unit's own name at it while the narrator speaks of it or it moves.
  const calloutNodes = callouts.map((l, ui) =>
    l ? (
      U(l.x, l.y, <g key={`ad${ui}`} {...yer("etiket", l.name)} transform={`translate(${l.x} ${l.y})`} opacity={l.a}>
        <rect x={-l.w / 2} y={-14 * s} width={l.w} height={28 * s} rx={14 * s} fill={l.color} stroke="#ffffff" strokeWidth={2.5 * s} />
        <text x={0} y={6 * s} textAnchor="middle" style={{ font: `700 ${17 * s}px 'Bahnschrift', 'Segoe UI', sans-serif` }} fill="#ffffff">
          {l.name}
        </text>
      </g>)
    ) : null,
  );
  // A tilted map's upright layer: the labels only.
  if (layer === "upright") return <g>{strengthNodes}{calloutNodes}</g>;
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
      {/* The fallen of every lost block, lying where it fell, under the living. */}
      {units.map((u, ui) =>
        u.kind
          ? lostTokens(u, fps).map((l) => {
              if (frame < l.at) return null;
              const where = restOf(ui, l);
              if (!where) return null;
              return <Fallen key={`f${ui}-${l.ti}`} x={where.x} y={where.y} r={r} color={u.color} seed={ui * 977 + l.ti * 31} share={clamp01((frame - l.at) / (fps * FALLEN_S))} />;
            })
          : null,
      )}
      {/* Dust behind the blocks on the march. */}
      {units.map((u, ui) =>
        u.kind
          ? placed[ui]!.map((t, i) => {
              if (!t || t.lostAt !== undefined || t.rout !== undefined || !t.way) return null;
              const amount = marching(t, r);
              if (amount <= 0.02) return null;
              const len = Math.hypot(t.way.goal.x - t.way.from.x, t.way.goal.y - t.way.from.y) || 1;
              return <DustTrail key={`d${ui}-${i}`} x={t.x} y={t.y} dx={(t.way.goal.x - t.way.from.x) / len} dy={(t.way.goal.y - t.way.from.y) / len} r={r} amount={amount * t.alpha} horse={u.kind === "suvari"} frame={frame} seed={ui * 13 + i} />;
            })
          : null,
      )}
      {units.map((u, ui) =>
        placed[ui]!.map((t, i) => {
          if (!t) return null;
          // A slight shake while it fights, so a front reads as alive (fading in and out as the clash comes near).
          const near = Math.min(Infinity, ...clashes.map((c) => Math.hypot(c.x - t.x, c.y - t.y)));
          const jx = Math.sin(frame * 0.9 + i) * r * 0.08 * clamp01((r * 2.4 - near) / (r * 0.8));
          const lostPuff = t.lostAt !== undefined ? (frame - t.lostAt) / (fps * 0.8) : 0;
          // A block faces the enemies nearest to it (facingsAt); a routed one turns its back and staggers as it runs.
          const facing = facings[ui]![i]!;
          const turn = t.rout !== undefined ? 180 * Math.min(1, t.rout * 2.5) + Math.sin(frame * 0.7 + i * 2) * 14 : 0;
          const fallen = t.lostAt !== undefined ? clamp01((frame - t.lostAt) / (fps * FALLEN_S)) : 0;
          return (
            <g key={`${ui}-${i}`}>
              <g transform={`translate(${t.x + jx} ${t.y})`} opacity={t.alpha}>
                {u.kind ? (
                  <UnitBlock kind={u.kind} color={u.color} r={r} turn={facing + turn} seed={ui * 1009 + i * 7 + 1} menPerBlock={men[ui]} thin={thin[ui]} fallen={fallen} march={marching(t, r)} rout={t.rout ?? 0} frame={frame} />
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
                {/* Fallen: a round token is greyed and crossed out like the reference maps' struck-out tokens; a block's
                    soldiers fall one by one instead (UnitBlock `fallen`) and lie where they fell (Fallen). */}
                {t.lostAt !== undefined && !u.kind ? (
                  <g>
                    <circle r={r} fill="#2a2a2a" opacity={0.45} />
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
      {/* Guns and musket lines firing at the enemy while the fight is on. */}
      {gunfireAt(map, frame, fps).map((g) => {
        const t = placed[g.ui]?.[g.ti];
        const own = centres[g.ui];
        const foe = enemyOf(g.ui);
        if (!t || t.lostAt !== undefined || t.rout !== undefined || !own || !foe) return null;
        const len = Math.hypot(foe.x - own.x, foe.y - own.y) || 1;
        const dx = (foe.x - own.x) / len;
        const dy = (foe.y - own.y) / len;
        const front = r * BLOCK_H * 0.55;
        return <ShotSmoke key={`g${g.ui}-${g.ti}`} x={t.x + dx * front} y={t.y + dy * front} dx={dx} dy={dy} r={r} p={g.p} big={g.gun} seed={g.ui * 131 + g.ti * 17 + g.shot * 7} />;
      })}
      {/* Archer units loosing their volleys on the enemy while the fight is on. */}
      {volleysAt(map, frame, fps).map((v) => {
        const t = placed[v.ui]?.[v.ti];
        if (!t || t.lostAt !== undefined || t.rout !== undefined) return null;
        const aim = aimOf(v.ui, t);
        return aim ? <ArrowVolley key={`v${v.ui}-${v.ti}`} from={t} to={aim} r={r} p={v.p} seed={v.ui * 131 + v.ti * 17 + v.shot * 7} /> : null;
      })}
      {clashes.map((c) => {
        const phase = (frame + (c.seed % period)) % period;
        return <Burst key={`c${c.seed}`} x={c.x} y={c.y} r={r * 1.1} p={phase / (fps * 0.7)} era="orta" seed={c.seed + Math.floor((frame + (c.seed % period)) / period)} />;
      })}
      {/* Each side's strength beside its formation, on the side away from the enemy ("11 Legions – 47,000 men"). */}
      {strengthNodes}
      {/* A unit's own name at it while the narrator speaks of it or it moves. */}
      {calloutNodes}
    </g>
  );
}
