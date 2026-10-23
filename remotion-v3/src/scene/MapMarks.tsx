import React from "react";
import { Easing, interpolate, spring } from "remotion";
import type { V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";
import { INK } from "../character/rig";

/**
 * Marks over the living map (owner, 23 Oct 2026, after DFT Tarih's Belgrade 1521): white flags of surrender, flames over
 * burning places, a state's border glowing while the narrator names it or a white ring round a place, a red X struck
 * over a beaten ruler's badge — and, fixed on the screen, the two sides' strength bar and the date stamp in the corner.
 * World marks are drawn inside the map's camera; `k` = world px per 1080p screen px, so they keep their screen size.
 */

const FLAG_POLE = "#6b4523";
const GLOW = "#fff3a0";
const X_RED = "#d7263d";
const PARCHMENT = "#f1e0b5";
const SEPIA = "#5a3d1a";
const HUD_FONT = "'Bahnschrift', 'Arial Narrow', sans-serif";

function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 7.233) * 43758.5453;
  return x - Math.floor(x);
}

/** One flame tongue (base at 0, `h` tall, `w` wide), flickering with `phase`. */
function Flame({ x, y, w, h, phase }: { x: number; y: number; w: number; h: number; phase: number }) {
  const f = 1 + 0.16 * Math.sin(phase) + 0.08 * Math.sin(phase * 2.3 + 1);
  const sway = 0.12 * Math.sin(phase * 0.7 + 2);
  const tongue = (sx: number, sy: number) =>
    `M0 0 C${-0.5 * sx} ${-0.05 * sy} ${-0.55 * sx} ${-0.45 * sy} ${(-0.15 + sway) * sx} ${-0.72 * sy} C${(-0.1 + sway) * sx} ${-0.52 * sy} ${0.05 * sx} ${-0.5 * sy} ${(0.04 + sway * 1.6) * sx} ${-1 * sy} C${(0.38 + sway) * sx} ${-0.68 * sy} ${0.58 * sx} ${-0.34 * sy} ${0.46 * sx} ${-0.1 * sy} C${0.4 * sx} ${0.03 * sy} ${0.2 * sx} ${0.04 * sy} 0 0 Z`;
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={tongue(w, h * f)} fill="#e2481f" stroke={INK} strokeWidth={w * 0.05} strokeLinejoin="round" />
      <path d={tongue(w * 0.66, h * f * 0.72)} fill="#ff9d2e" />
      <path d={tongue(w * 0.36, h * f * 0.44)} fill="#ffe066" />
    </g>
  );
}

/** Flames over a burning place: a few tongues spread over it, smoke rising from them. */
function Fire({ x, y, size, alpha, frame, k, seed }: { x: number; y: number; size: number; alpha: number; frame: number; k: number; seed: number }) {
  const s = Math.max(size, 46 * k);
  const count = Math.max(1, Math.min(5, Math.round(s / (60 * k))));
  const spots = Array.from({ length: count }, (_, j) => (j === 0 ? { dx: 0, dy: 0 } : { dx: (rand(seed + j) - 0.5) * s * 0.8, dy: (rand(seed + j + 9) - 0.5) * s * 0.4 }));
  const h = Math.min(s, 70 * k) * (count > 1 ? 0.9 : 1.1);
  return (
    <g opacity={alpha}>
      {spots.map((p, j) =>
        [0, 1, 2].map((m) => {
          // Smoke puffs rise, grow and fade on a loop of their own.
          const t = ((frame + j * 17 + m * 23) % 60) / 60;
          return <circle key={`s${j}-${m}`} cx={x + p.dx + Math.sin(t * 4 + j) * 6 * k} cy={y + p.dy - h * (0.9 + t * 1.6)} r={h * (0.18 + t * 0.32)} fill="#3d3a38" opacity={0.42 * (1 - t)} />;
        }),
      )}
      <ellipse cx={x} cy={y + 4 * k} rx={s * 0.55} ry={s * 0.2} fill="#ff7a1a" opacity={0.25 + 0.1 * Math.sin(frame * 0.4 + seed)} style={{ filter: `blur(${6 * k}px)` }} />
      {spots.map((p, j) => (
        <Flame key={`f${j}`} x={x + p.dx} y={y + p.dy} w={h * 0.62} h={h} phase={frame * 0.55 + seed * 3 + j * 1.9} />
      ))}
    </g>
  );
}

/** A white flag raised up its pole where a side gives up, waving. */
function WhiteFlag({ x, y, start, frame, fps, k, label }: { x: number; y: number; start: number; frame: number; fps: number; k: number; label?: React.ReactNode }) {
  const pole = 78 * k;
  const raise = interpolate(frame, [start, start + Math.round(fps * 1.1)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const appear = interpolate(frame, [start, start + Math.round(fps * 0.3)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const w = 46 * k;
  const h = 30 * k;
  const top = -pole * (0.3 + 0.7 * raise);
  // The cloth waves: its free edge and its middle move on a travelling sine.
  const wave = (u: number) => Math.sin(frame * 0.35 - u * 4) * 5 * k * u;
  const cloth = `M0 ${top} C${w * 0.33} ${top + wave(0.33)} ${w * 0.66} ${top + wave(0.66)} ${w} ${top + wave(1)} L${w} ${top + h + wave(1)} C${w * 0.66} ${top + h + wave(0.66)} ${w * 0.33} ${top + h + wave(0.33)} 0 ${top + h} Z`;
  return (
    <g transform={`translate(${x} ${y})`} opacity={appear} style={{ filter: `drop-shadow(0 ${3 * k}px ${3 * k}px rgba(0,0,0,0.5))` }}>
      <path d={`M0 0 L0 ${-pole}`} stroke={INK} strokeWidth={7 * k} strokeLinecap="round" />
      <path d={`M0 0 L0 ${-pole}`} stroke={FLAG_POLE} strokeWidth={4 * k} strokeLinecap="round" />
      <circle cy={-pole} r={4.5 * k} fill="#d9b44a" stroke={INK} strokeWidth={2 * k} />
      <path d={cloth} fill="#ffffff" stroke={INK} strokeWidth={3 * k} strokeLinejoin="round" />
      {label ? <g transform={`translate(${w * 0.5} ${-pole - 30 * k})`}>{label}</g> : null}
    </g>
  );
}

/** How long a glow takes to come and go (seconds). */
const GLOW_FADE_S = 0.5;

/** Flags, flames and glows of a map, in world pixels (drawn over the territories, under the tokens and badges). */
export function MapMarks({ map, frame, fps, k, label }: { map: V3GeoMap; frame: number; fps: number; k: number; label: (text: string, size: number) => React.ReactNode }) {
  const fade = (start: number, end: number | undefined) => {
    const a = interpolate(frame, [start, start + Math.round(fps * GLOW_FADE_S)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return end === undefined ? a : a * interpolate(frame, [end - Math.round(fps * GLOW_FADE_S), end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  };
  return (
    <g>
      {(map.glows ?? []).map((g, i) => {
        if (frame < g.start || frame >= g.end) return null;
        const a = fade(g.start, g.end);
        const pulse = 0.7 + 0.3 * Math.sin((frame - g.start) * 0.22);
        if (g.territory !== undefined) {
          const t = map.territories[g.territory];
          if (!t) return null;
          // The state's own outline: its border with other land and its coast (a state built from provinces), else its fill's edge.
          const d = t.border !== undefined ? `${t.border}${t.coast ?? ""}` : t.d;
          return (
            <g key={`gl${i}`} opacity={a}>
              <path d={d} fill="none" stroke={GLOW} strokeOpacity={0.55 * pulse} strokeWidth={22 * k} strokeLinejoin="round" strokeLinecap="round" style={{ filter: `blur(${7 * k}px)` }} />
              <path d={d} fill="none" stroke={GLOW} strokeWidth={5 * k} strokeLinejoin="round" strokeLinecap="round" />
              <path d={d} fill="none" stroke="#ffffff" strokeWidth={2 * k} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        }
        if (g.x === undefined || g.y === undefined) return null;
        // A white ring drawn round the place, as the reference channel rings a name.
        const rx = Math.max(g.r ?? 0, 56 * k);
        const ry = rx * 0.64;
        const draw = interpolate(frame, [g.start, g.start + Math.round(fps * 0.7)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
        const d = `M${g.x - rx} ${g.y} A${rx} ${ry} 0 1 1 ${g.x + rx} ${g.y} A${rx} ${ry} 0 1 1 ${g.x - rx} ${g.y}`;
        return (
          <g key={`gl${i}`} opacity={a} transform={`rotate(-8 ${g.x} ${g.y})`}>
            <path d={d} fill="none" stroke={INK} strokeOpacity={0.6} strokeWidth={10 * k} pathLength={1} strokeDasharray="1" strokeDashoffset={draw} strokeLinecap="round" />
            <path d={d} fill="none" stroke="#ffffff" strokeWidth={5.5 * k} pathLength={1} strokeDasharray="1" strokeDashoffset={draw} strokeLinecap="round" />
          </g>
        );
      })}
      {(map.fires ?? []).map((f, i) => (frame < f.start ? null : <Fire key={`fi${i}`} x={f.x} y={f.y} size={f.size} alpha={fade(f.start, f.end)} frame={frame} k={k} seed={i * 13 + 5} />))}
      {(map.flags ?? []).map((f, i) => (frame < f.start ? null : <WhiteFlag key={`fl${i}`} x={f.x} y={f.y} start={f.start} frame={frame} fps={fps} k={k} {...(f.label ? { label: label(f.label, 26) } : {})} />))}
    </g>
  );
}

/** A red X struck over a beaten ruler's badge (ring centre `cy`, radius `r`, in the badge's own units). */
export function BadgeCross({ crossed, frame, fps, cy, r, k }: { crossed: number; frame: number; fps: number; cy: number; r: number; k: number }) {
  if (frame < crossed) return null;
  const one = interpolate(frame, [crossed, crossed + Math.round(fps * 0.22)], [0, 1], { extrapolateRight: "clamp" });
  const two = interpolate(frame, [crossed + Math.round(fps * 0.18), crossed + Math.round(fps * 0.4)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const e = r * 1.05;
  const stroke = (x0: number, y0: number, x1: number, y1: number, p: number, key: string) =>
    p > 0 ? (
      <g key={key}>
        <path d={`M${x0} ${y0} L${x0 + (x1 - x0) * p} ${y0 + (y1 - y0) * p}`} stroke={INK} strokeWidth={17 * k} strokeLinecap="round" />
        <path d={`M${x0} ${y0} L${x0 + (x1 - x0) * p} ${y0 + (y1 - y0) * p}`} stroke={X_RED} strokeWidth={10 * k} strokeLinecap="round" />
      </g>
    ) : null;
  return (
    <g>
      {stroke(-e, cy - e, e, cy + e, one, "a")}
      {stroke(e, cy - e, -e, cy + e, two, "b")}
    </g>
  );
}

/** The grey a crossed-out badge's portrait fades to. */
export function crossedFilter(crossed: number | undefined, frame: number, fps: number): string | undefined {
  if (crossed === undefined || frame < crossed) return undefined;
  const g = interpolate(frame, [crossed, crossed + Math.round(fps * 0.5)], [0, 1], { extrapolateRight: "clamp" });
  return `grayscale(${g}) brightness(${1 - 0.25 * g})`;
}

/** The numbers of a count ("15,000–25,000", "1.000", "c. 80,000 men"): the one number it holds, else none. */
function singleNumber(text: string): { match: string; value: number; sep: string } | undefined {
  const all = [...text.matchAll(/\d[\d.,\s  ]*\d|\d/g)];
  if (all.length !== 1) return undefined;
  const raw = all[0]![0].trim();
  const grouped = /^\d{1,3}([.,\s  ]\d{3})+$/.test(raw);
  if (!grouped && !/^\d+$/.test(raw)) return undefined;
  return { match: raw, value: Number(raw.replace(/[.,\s  ]/g, "")), sep: grouped ? raw.replace(/\d/g, "")[0]! : "" };
}

/** `text` with its one number counted to `value`, grouped the way it was written. */
function countedText(text: string, value: number): string {
  const n = singleNumber(text);
  if (!n) return text;
  const digits = String(Math.round(value));
  const grouped = n.sep ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, n.sep) : digits;
  return text.replace(n.match, grouped);
}

type Strength = NonNullable<V3GeoMap["strength"]>[number];

/**
 * The two sides' strength bar at the top of the screen (DFT Tarih: "15.000–25.000" against "1.000"): names above, the
 * bar split by their numbers, the numbers under it. It opens out from the split and the numbers count up; a later
 * entry slides the split and counts to the new numbers (after the losses).
 */
function StrengthBar({ list, frame, fps, W, H }: { list: readonly Strength[]; frame: number; fps: number; W: number; H: number }) {
  let i = -1;
  for (let j = 0; j < list.length; j++) if (list[j]!.start <= frame) i = j;
  if (i < 0) return null;
  const cur = list[i]!;
  const prev = i > 0 && (list[i - 1]!.end === undefined || list[i - 1]!.end! > cur.start) ? list[i - 1] : undefined;
  if (cur.end !== undefined && frame >= cur.end) return null;
  const u = H / 1080;
  const open = prev ? 1 : interpolate(frame, [cur.start, cur.start + Math.round(fps * 0.8)], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const move = prev ? interpolate(frame, [cur.start, cur.start + Math.round(fps * 1.2)], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) }) : 1;
  const count = interpolate(frame, [cur.start, cur.start + Math.round(fps * 1.4)], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
  const out = cur.end !== undefined ? interpolate(frame, [cur.end - Math.round(fps * 0.4), cur.end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  // Each side keeps at least a sliver of the bar, so 80,000 against 7,000 still shows both colours.
  const share = (s: Strength) => Math.min(0.92, Math.max(0.08, s.sides[0].value / Math.max(1, s.sides[0].value + s.sides[1].value)));
  const split = prev ? share(prev) + (share(cur) - share(prev)) * move : share(cur);
  const width = 860 * u;
  const barH = 30 * u;
  const x0 = (W - width) / 2;
  const top = 66 * u;
  const mid = x0 + width * split;
  const number = (side: 0 | 1) => {
    const to = cur.sides[side];
    const from = prev?.sides[side];
    const target = singleNumber(to.count);
    if (!target) return to.count;
    const start = from && singleNumber(from.count) ? singleNumber(from.count)!.value : 0;
    return countedText(to.count, start + (target.value - start) * count);
  };
  const text = (s: string, x: number, y: number, size: number, anchor: "start" | "end", color = "#ffffff") => (
    <text x={x} y={y} textAnchor={anchor} style={{ font: `700 ${size * u}px ${HUD_FONT}`, fontStretch: "condensed", letterSpacing: 1 * u }} fill={color} stroke="rgba(10,10,14,0.85)" strokeWidth={5 * u} paintOrder="stroke fill" strokeLinejoin="round">
      {s}
    </text>
  );
  return (
    <g opacity={out * Math.min(1, open * 1.5)} style={{ filter: `drop-shadow(0 ${3 * u}px ${4 * u}px rgba(0,0,0,0.55))` }}>
      {text(cur.sides[0].label.toLocaleUpperCase("en-US"), x0, top - 10 * u, 30, "start")}
      {text(cur.sides[1].label.toLocaleUpperCase("en-US"), x0 + width, top - 10 * u, 30, "end")}
      <rect x={x0 - 4 * u} y={top - 4 * u} width={width + 8 * u} height={barH + 8 * u} rx={9 * u} fill="rgba(12,10,18,0.85)" />
      <g transform={`translate(${mid} 0) scale(${open} 1) translate(${-mid} 0)`}>
        <rect x={x0} y={top} width={mid - x0} height={barH} rx={6 * u} fill={cur.sides[0].color} />
        <rect x={mid} y={top} width={x0 + width - mid} height={barH} rx={6 * u} fill={cur.sides[1].color} />
        <rect x={x0} y={top} width={width} height={barH * 0.42} rx={6 * u} fill="#ffffff" opacity={0.18} />
      </g>
      <path d={`M${mid} ${top - 8 * u} L${mid} ${top + barH + 8 * u}`} stroke="#ffffff" strokeWidth={4 * u} opacity={open} />
      {text(number(0), x0 + 4 * u, top + barH + 40 * u, 38, "start", "#fff3d6")}
      {text(number(1), x0 + width - 4 * u, top + barH + 40 * u, 38, "end", "#fff3d6")}
    </g>
  );
}

/** The date stamp in the top right corner: each new date drops in as the last one lifts away. */
function DateStamp({ dates, frame, fps, W, H }: { dates: NonNullable<V3GeoMap["dates"]>; frame: number; fps: number; W: number; H: number }) {
  let i = -1;
  for (let j = 0; j < dates.length; j++) if (dates[j]!.start <= frame) i = j;
  if (i < 0) return null;
  const u = H / 1080;
  const cur = dates[i]!;
  const enter = spring({ frame: frame - cur.start, fps, config: { damping: 13, stiffness: 160 } });
  const prev = i > 0 ? dates[i - 1] : undefined;
  const leave = prev ? interpolate(frame - cur.start, [0, Math.round(fps * 0.35)], [1, 0], { extrapolateRight: "clamp" }) : 0;
  const plate = (text: string, dy: number, alpha: number, key: string) => {
    const w = Math.max(150, text.length * 25 + 56) * u;
    const x = W - 46 * u - w;
    const y = 30 * u + dy;
    return (
      <g key={key} opacity={alpha}>
        <rect x={x} y={y} width={w} height={64 * u} rx={8 * u} fill={PARCHMENT} stroke={SEPIA} strokeWidth={3 * u} />
        <rect x={x + 6 * u} y={y + 6 * u} width={w - 12 * u} height={52 * u} rx={5 * u} fill="none" stroke={SEPIA} strokeWidth={1.2 * u} opacity={0.6} />
        <text x={x + w / 2} y={y + 44 * u} textAnchor="middle" style={{ font: `italic 700 ${36 * u}px Georgia, 'Palatino Linotype', serif` }} fill="#3a2410">
          {text}
        </text>
      </g>
    );
  };
  return (
    <g style={{ filter: `drop-shadow(0 ${3 * u}px ${4 * u}px rgba(0,0,0,0.5))` }}>
      {prev && leave > 0 ? plate(prev.text, -(1 - leave) * 40 * u, leave, "p") : null}
      {plate(cur.text, (1 - enter) * -50 * u, Math.min(1, enter * 1.4), "c")}
    </g>
  );
}

/** The map's screen marks (strength bar, date stamp), fixed on the screen over the moving map. */
export function MapHud({ map, frame, fps, W, H }: { map: V3GeoMap; frame: number; fps: number; W: number; H: number }) {
  if (!map.strength?.length && !map.dates?.length) return null;
  return (
    <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
      {map.strength?.length ? <StrengthBar list={map.strength} frame={frame} fps={fps} W={W} H={H} /> : null}
      {map.dates?.length ? <DateStamp dates={map.dates} frame={frame} fps={fps} W={W} H={H} /> : null}
    </svg>
  );
}
