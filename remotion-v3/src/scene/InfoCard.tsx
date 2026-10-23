import React from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { V3CastMember, V3InfoCard } from "../../../src/lib/v3/render/RenderPlanTypes";
import { type AccessoryIndex, Character } from "../character/Character";
import { extraState } from "../character/extras";
import { HEAD_CY } from "../character/rig";
import { chartLayout } from "./chartLayout";

/**
 * Info cards over the darkened picture (owner, 23 Oct 2026, after DFT Tarih's Pharsalus): the map dims and a political
 * chart builds box by box with arrows and portraits, a titled list comes in line by line, or a number counts up. Frames
 * are the shot's; sizes are for a 1080p screen.
 */

const TITLE_FONT = "Georgia, 'Palatino Linotype', serif";
const TEXT_FONT = "'Bahnschrift', 'Segoe UI', sans-serif";
const PARCHMENT = "#f1e0b5";
const SEPIA = "#2a1f14";
const RED = "#b8283a";
const FADE_S = 0.35;

/** Whether a #RRGGBB colour is light (dark lettering on it). */
function light(hex: string): boolean {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150;
}

/** A cast member's head in a ring (the map badges' portrait). */
function Portrait({ member, accessories, x, y, r, frame, fps, seed }: { member: V3CastMember; accessories: AccessoryIndex; x: number; y: number; r: number; frame: number; fps: number; seed: number }) {
  const s = (r * 0.62) / 100;
  const id = `ic-portrait-${member.id}-${seed}`;
  const state = extraState({ castId: member.id, x: 0, depth: 0, facing: "right", scale: 1, mood: "notr", seed }, frame, fps);
  return (
    <g transform={`translate(${x} ${y})`}>
      <defs>
        <clipPath id={id}>
          <circle r={r} />
        </clipPath>
      </defs>
      <circle r={r + 5} fill={PARCHMENT} stroke={SEPIA} strokeWidth={3} />
      <circle r={r} fill="#d9c9a3" />
      <g clipPath={`url(#${id})`}>
        <g transform={`translate(0 ${-HEAD_CY * s + r * 0.18}) scale(${s})`}>
          <Character member={member} state={state} accessories={accessories} cheap />
        </g>
      </g>
    </g>
  );
}

function Chart({ card, frame, fps, W, H, cast, accessories }: { card: V3InfoCard; frame: number; fps: number; W: number; H: number; cast?: ReadonlyMap<string, V3CastMember>; accessories?: AccessoryIndex }) {
  const nodes = card.nodes ?? [];
  const u = H / 1080;
  const withPortraits = nodes.some((n) => n.castIds?.length);
  const at = chartLayout(nodes, W, (card.title ? 300 : 220) * u, (withPortraits ? 720 : 840) * u);
  const boxH = 78 * u;
  const pr = 46 * u;
  // Where an arrow leaves a box: under its portraits when it has them.
  const below = (i: number) => at[i]!.y + boxH / 2 + (nodes[i]!.castIds?.length ? pr * 2 + 26 * u : 8 * u);
  return (
    <g>
      {nodes.map((n, i) => {
        if (n.parent === undefined || !at[n.parent] || frame < n.start) return null;
        const draw = interpolate(frame, [n.start, n.start + Math.round(fps * 0.5)], [1, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
        const p = at[n.parent]!;
        const c = at[i]!;
        const y0 = below(n.parent);
        const y1 = c.y - boxH / 2 - 12 * u;
        const mid = (y0 + y1) / 2;
        const d = `M${p.x} ${y0} L${p.x} ${mid} L${c.x} ${mid} L${c.x} ${y1}`;
        return (
          <g key={`a${i}`}>
            <path d={d} fill="none" stroke={PARCHMENT} strokeWidth={5 * u} strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={draw} />
            {draw < 0.05 ? <path d={`M${c.x - 12 * u} ${y1 - 14 * u} L${c.x} ${y1 + 2 * u} L${c.x + 12 * u} ${y1 - 14 * u} Z`} fill={PARCHMENT} /> : null}
          </g>
        );
      })}
      {nodes.map((n, i) => {
        if (frame < n.start) return null;
        const pop = spring({ frame: frame - n.start, fps, config: { damping: 12, stiffness: 170 } });
        const c = at[i]!;
        const fill = n.color ?? PARCHMENT;
        const ids = (n.castIds ?? []).filter((id) => cast?.has(id));
        return (
          <g key={`n${i}`} transform={`translate(${c.x} ${c.y}) scale(${0.6 + 0.4 * pop})`} opacity={Math.min(1, pop * 1.4)}>
            <rect x={-c.w / 2} y={-boxH / 2} width={c.w} height={boxH} rx={12 * u} fill={fill} stroke={SEPIA} strokeWidth={4 * u} />
            <text x={0} y={13 * u} textAnchor="middle" style={{ font: `700 ${38 * u}px ${TEXT_FONT}`, fontStretch: "condensed" }} fill={light(fill) ? "#2a1f14" : "#ffffff"}>
              {n.label}
            </text>
            {ids.map((id, j) => (
              <Portrait key={id} member={cast!.get(id)!} accessories={accessories!} x={(j - (ids.length - 1) / 2) * (pr * 2 + 18 * u)} y={boxH / 2 + pr + 18 * u} r={pr} frame={frame} fps={fps} seed={i * 10 + j} />
            ))}
          </g>
        );
      })}
    </g>
  );
}

function List({ card, frame, fps, W, H }: { card: V3InfoCard; frame: number; fps: number; W: number; H: number }) {
  const u = H / 1080;
  const items = card.items ?? [];
  const gap = Math.min(116, 560 / Math.max(1, items.length)) * u;
  const x0 = W * 0.2;
  const y0 = (card.title ? 360 : 300) * u;
  return (
    <g>
      {items.map((it, i) => {
        if (frame < it.start) return null;
        const t = interpolate(frame, [it.start, it.start + Math.round(fps * 0.45)], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
        const y = y0 + i * gap;
        return (
          <g key={i} transform={`translate(${(1 - t) * -60 * u} 0)`} opacity={t}>
            <circle cx={x0} cy={y} r={34 * u} fill={RED} stroke={SEPIA} strokeWidth={4 * u} />
            <text x={x0} y={y + 13 * u} textAnchor="middle" style={{ font: `800 ${38 * u}px ${TEXT_FONT}` }} fill="#ffffff">
              {i + 1}
            </text>
            <text x={x0 + 66 * u} y={y + 17 * u} style={{ font: `600 ${50 * u}px ${TEXT_FONT}` }} fill="#ffffff" stroke="rgba(10,8,14,0.8)" strokeWidth={5 * u} paintOrder="stroke fill">
              {it.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Counter({ card, frame, fps, W, H, language }: { card: V3InfoCard; frame: number; fps: number; W: number; H: number; language: "tr" | "en" }) {
  const u = H / 1080;
  const span = Math.min(2.6, Math.max(1, ((card.end - card.start) / fps) * 0.6));
  const t = interpolate(frame, [card.start + Math.round(fps * 0.3), card.start + Math.round(fps * (0.3 + span))], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const from = card.from ?? 0;
  const value = Math.round(from + ((card.value ?? 0) - from) * t);
  const text = value.toLocaleString(language === "tr" ? "tr-TR" : "en-US");
  const done = t >= 1 ? spring({ frame: frame - card.start - Math.round(fps * (0.3 + span)), fps, config: { damping: 8, stiffness: 220 } }) : 0;
  return (
    <g>
      <text x={W / 2} y={H * 0.52} textAnchor="middle" transform={`translate(${W / 2} ${H * 0.48}) scale(${1 + 0.06 * Math.sin(done * Math.PI)}) translate(${-W / 2} ${-H * 0.48})`} style={{ font: `800 ${190 * u}px ${TEXT_FONT}`, fontStretch: "condensed", fontVariantNumeric: "tabular-nums" }} fill="#ffffff" stroke="rgba(10,8,14,0.85)" strokeWidth={12 * u} paintOrder="stroke fill">
        {text}
      </text>
      {card.label ? (
        <text x={W / 2} y={H * 0.52 + 96 * u} textAnchor="middle" style={{ font: `600 ${54 * u}px ${TEXT_FONT}` }} fill={PARCHMENT} stroke="rgba(10,8,14,0.8)" strokeWidth={5 * u} paintOrder="stroke fill">
          {card.label}
        </text>
      ) : null}
    </g>
  );
}

/** One info card: the picture dims, the title comes in, then the chart, the list or the counter. */
export function InfoCardView({ card, cast, accessories, language = "en" }: { card: V3InfoCard; cast?: ReadonlyMap<string, V3CastMember>; accessories?: AccessoryIndex; language?: "tr" | "en" }) {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  if (frame < card.start || frame >= card.end) return null;
  const u = H / 1080;
  const fade = Math.min(
    interpolate(frame, [card.start, card.start + Math.round(fps * FADE_S)], [0, 1], { extrapolateRight: "clamp" }),
    interpolate(frame, [card.end - Math.round(fps * FADE_S), card.end], [1, 0], { extrapolateLeft: "clamp" }),
  );
  const rise = spring({ frame: frame - card.start, fps, config: { damping: 14, stiffness: 140 } });
  return (
    <>
    {/* The picture under the card blurs a little and darkens, so its names never compete with the card's. */}
    <div style={{ position: "absolute", inset: 0, opacity: fade, backdropFilter: `blur(${5 * u}px)`, background: "radial-gradient(ellipse at 50% 50%, rgba(11,9,18,0.72) 0%, rgba(5,4,10,0.9) 100%)" }} />
    <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, opacity: fade }}>
      {card.title ? (
        <g transform={`translate(0 ${(1 - rise) * -30 * u})`}>
          <text x={W / 2} y={(card.kind === "sayac" ? 300 : 190) * u} textAnchor="middle" style={{ font: `700 ${62 * u}px ${TITLE_FONT}` }} fill={PARCHMENT} stroke="rgba(10,8,14,0.85)" strokeWidth={6 * u} paintOrder="stroke fill">
            {card.title}
          </text>
          <path d={`M${W / 2 - 220 * u} ${(card.kind === "sayac" ? 326 : 216) * u} L${W / 2 + 220 * u} ${(card.kind === "sayac" ? 326 : 216) * u}`} stroke={RED} strokeWidth={4 * u} strokeLinecap="round" />
        </g>
      ) : null}
      {card.kind === "sema" ? <Chart card={card} frame={frame} fps={fps} W={W} H={H} {...(cast ? { cast } : {})} {...(accessories ? { accessories } : {})} /> : null}
      {card.kind === "liste" ? <List card={card} frame={frame} fps={fps} W={W} H={H} /> : null}
      {card.kind === "sayac" ? <Counter card={card} frame={frame} fps={fps} W={W} H={H} language={language} /> : null}
    </svg>
    </>
  );
}
