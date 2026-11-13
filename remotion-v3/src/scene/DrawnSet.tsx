import React from "react";
import type { V3ArchStyle, V3DrawnSet, V3TimeOfDay } from "../../../src/lib/v3/render/RenderPlanTypes";
import { INK } from "../character/rig";

/**
 * Drawn living sets (owner, 22 Oct 2026: "the viewer must live the moment"): the scene's place composed in flat,
 * outlined layers — sky, far hills, the period's buildings or trees, the ground the actors stand on — with what lives
 * in it: water that flows, torches that flicker, stars, drifting cloud and fog, rain or snow. The back layers sit behind
 * the actors; `DrawnSetFront` (rain, near fog, the night grade and torch light) sits over them, and `WaterSkirt` covers
 * the legs of whoever stands in a river.
 */

/** Stage floor at depth 0 (front) .. 1 (back), as ShotView's stageTransform. */
const stageY = (depth: number, H: number) => H * (0.955 - 0.2 * depth);
/** Where the far land meets the sky band. */
const HORIZON = 0.6;

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** a → b by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [hex(a), hex(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

interface Palette {
  readonly sky: readonly [string, string, string];
  readonly far: string;
  readonly mid: string;
  readonly ground: string;
  readonly groundFar: string;
  readonly water: string;
  readonly waterLight: string;
  readonly foliage: string;
  readonly foliageDark: string;
  readonly trunk: string;
  /** How much the period's colours sink toward the night (0 day .. 1). */
  readonly dim: number;
  readonly dimTo: string;
}

const PALETTES: Readonly<Record<V3TimeOfDay, Palette>> = {
  gun: { sky: ["#3f9be6", "#7cc4f2", "#d4f0fb"], far: "#9cc7c9", mid: "#7fb86a", ground: "#86c95b", groundFar: "#9fd06e", water: "#3f9ad8", waterLight: "#bfe6fa", foliage: "#5aa845", foliageDark: "#3f8436", trunk: "#7a5534", dim: 0, dimTo: "#000000" },
  aksam: { sky: ["#3c3f86", "#d9735a", "#ffcf7a"], far: "#8a6a8c", mid: "#6f7a4a", ground: "#7d8f45", groundFar: "#93964e", water: "#c9776a", waterLight: "#ffd9a0", foliage: "#56743a", foliageDark: "#3d5a2c", trunk: "#5a3e2a", dim: 0.18, dimTo: "#5a2a4a" },
  gece: { sky: ["#070d24", "#142251", "#2b3f78"], far: "#1d2a52", mid: "#1c3047", ground: "#24394a", groundFar: "#2a4153", water: "#173d6e", waterLight: "#9fc3f0", foliage: "#1f3e3c", foliageDark: "#142a2c", trunk: "#2c2430", dim: 0.55, dimTo: "#101a3c" },
  safak: { sky: ["#36407e", "#c98aa0", "#ffd7a6"], far: "#7d7ba6", mid: "#5f7a63", ground: "#6f9653", groundFar: "#86a465", water: "#7f8fc0", waterLight: "#ffe2c2", foliage: "#4a7a4a", foliageDark: "#335a3a", trunk: "#5a4232", dim: 0.22, dimTo: "#3a3060" },
};

interface StyleColours {
  readonly wall: string;
  readonly wallShade: string;
  readonly roof: string;
  readonly trim: string;
}

const STYLES: Readonly<Record<V3ArchStyle, StyleColours>> = {
  roma: { wall: "#ecd5a4", wallShade: "#d3b37e", roof: "#c8573a", trim: "#f6ecd2" },
  yunan: { wall: "#f1ede2", wallShade: "#d9d2c0", roof: "#c76a4c", trim: "#ffffff" },
  misir: { wall: "#e6c27a", wallShade: "#c9a05a", roof: "#e6c27a", trim: "#3f74b8" },
  pers: { wall: "#dcbc8c", wallShade: "#bf9b68", roof: "#3a6db3", trim: "#e3b23c" },
  bizans: { wall: "#c98466", wallShade: "#a8664c", roof: "#c9a24a", trim: "#f0e2c4" },
  osmanli: { wall: "#e7d2ae", wallShade: "#c9ad82", roof: "#8f3d2e", trim: "#9aa6b2" },
  ortacag: { wall: "#bdb5a6", wallShade: "#9b9384", roof: "#7c4b3a", trim: "#efe3c8" },
  cin: { wall: "#ead9bb", wallShade: "#cdb791", roof: "#3c5161", trim: "#b8392e" },
  japon: { wall: "#efe4cc", wallShade: "#d2c3a2", roof: "#3a4652", trim: "#a8322a" },
  erken_modern: { wall: "#c06a4c", wallShade: "#9e5139", roof: "#4c5866", trim: "#efe6d6" },
  modern: { wall: "#cfd3d6", wallShade: "#aab0b5", roof: "#6c757d", trim: "#ffffff" },
};

const outline = (w = 5) => ({ stroke: INK, strokeWidth: w, strokeLinejoin: "round" as const, strokeLinecap: "round" as const });

/** A row of rolling hills between two heights, as one closed path across the frame. */
function hillPath(W: number, H: number, top: number, bottom: number, bumps: number, seed: number): string {
  const r = rng(seed);
  const n = bumps * 2 + 2;
  const pts = Array.from({ length: n + 1 }, (_, i) => [(i / n) * W * 1.2 - W * 0.1, top * H + (i % 2 ? r() * 0.5 : 0.5 + r() * 0.5) * (bottom - top) * H] as const);
  let d = `M${-W * 0.1} ${H} L${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1]!;
    const [x, y] = pts[i]!;
    d += ` Q${px + (x - px) / 2} ${i % 2 ? Math.min(py, y) - 18 : py} ${x} ${y}`;
  }
  return `${d} L${W * 1.1} ${H} Z`;
}

function Sky({ p, spec, W, H, frame, seed }: { p: Palette; spec: V3DrawnSet; W: number; H: number; frame: number; seed: number }) {
  const r = rng(seed + 11);
  const night = spec.zaman === "gece";
  const stars = night ? Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H * 0.5, s: 1 + r() * 2.4, ph: r() * 6.28 })) : [];
  const clouds = spec.hava === "yagmur" || spec.hava === "bulutlu" ? 6 : night ? 2 : 4;
  const cloudColour = spec.hava === "yagmur" ? "#8a93a6" : night ? "#2a3766" : spec.zaman === "aksam" ? "#ffd2b0" : "#ffffff";
  const sunX = spec.zaman === "aksam" ? 0.78 : spec.zaman === "safak" ? 0.2 : 0.82;
  return (
    <g>
      <defs>
        <linearGradient id="ds-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={spec.hava === "yagmur" ? mix(p.sky[0], "#5a6378", 0.6) : p.sky[0]} />
          <stop offset="0.55" stopColor={spec.hava === "yagmur" ? mix(p.sky[1], "#7a8294", 0.6) : p.sky[1]} />
          <stop offset="1" stopColor={spec.hava === "yagmur" ? mix(p.sky[2], "#a0a7b5", 0.6) : p.sky[2]} />
        </linearGradient>
        <radialGradient id="ds-moon">
          <stop offset="0" stopColor="#fffbe6" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fffbe6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x={-W * 0.1} y={-H * 0.1} width={W * 1.2} height={H * 1.2} fill="url(#ds-sky)" />
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.s} fill="#fff8dc" opacity={0.45 + 0.45 * Math.sin(frame * 0.09 + s.ph)} />
      ))}
      {night ? (
        <g>
          <circle cx={W * 0.8} cy={H * 0.16} r={150} fill="url(#ds-moon)" />
          <circle cx={W * 0.8} cy={H * 0.16} r={52} fill="#fdf3cf" {...outline(4)} />
          <circle cx={W * 0.8 + 16} cy={H * 0.16 - 10} r={10} fill="#ebddb0" />
          <circle cx={W * 0.8 - 18} cy={H * 0.16 + 14} r={7} fill="#ebddb0" />
        </g>
      ) : spec.hava !== "yagmur" && spec.hava !== "bulutlu" ? (
        <g>
          <circle cx={W * sunX} cy={H * (spec.zaman === "gun" ? 0.15 : 0.4)} r={spec.zaman === "gun" ? 70 : 95} fill={spec.zaman === "gun" ? "#fff3b0" : "#ffd27a"} opacity={0.95} />
        </g>
      ) : null}
      {Array.from({ length: clouds }, (_, i) => {
        const y = H * (0.08 + r() * 0.28);
        const w = 160 + r() * 220;
        const x = ((r() * W * 1.4 + frame * (0.25 + r() * 0.35)) % (W * 1.4)) - W * 0.2;
        return (
          <g key={`c${i}`} opacity={night ? 0.55 : 0.92} transform={`translate(${x} ${y})`}>
            <ellipse cx={0} cy={0} rx={w * 0.5} ry={w * 0.16} fill={cloudColour} />
            <ellipse cx={-w * 0.16} cy={-w * 0.1} rx={w * 0.22} ry={w * 0.17} fill={cloudColour} />
            <ellipse cx={w * 0.12} cy={-w * 0.13} rx={w * 0.25} ry={w * 0.2} fill={cloudColour} />
          </g>
        );
      })}
    </g>
  );
}

/** A tree in the period's landscape: cypress and umbrella pine for the Mediterranean, round crowns elsewhere. */
function Tree({ x, y, s, kind, p, sway }: { x: number; y: number; s: number; kind: "selvi" | "fistik" | "yuvarlak" | "palmiye"; p: Palette; sway: number }) {
  const t = `translate(${x} ${y}) scale(${s}) rotate(${sway})`;
  if (kind === "selvi")
    return (
      <g transform={t}>
        <rect x={-6} y={-30} width={12} height={30} fill={p.trunk} {...outline(4)} />
        <path d="M0 -250 Q30 -170 26 -80 Q22 -28 0 -26 Q-22 -28 -26 -80 Q-30 -170 0 -250 Z" fill={p.foliageDark} {...outline(4)} />
      </g>
    );
  if (kind === "fistik")
    return (
      <g transform={t}>
        <path d="M-5 0 Q-8 -90 4 -150 L12 -150 Q2 -90 7 0 Z" fill={p.trunk} {...outline(4)} />
        <path d="M-95 -150 Q-80 -205 0 -210 Q85 -205 100 -150 Q60 -128 0 -132 Q-60 -128 -95 -150 Z" fill={p.foliage} {...outline(4)} />
      </g>
    );
  if (kind === "palmiye")
    return (
      <g transform={t}>
        <path d="M-6 0 Q-14 -110 6 -220 L16 -218 Q0 -110 8 0 Z" fill={p.trunk} {...outline(4)} />
        {[-150, -110, -60, -20, 30].map((a, i) => (
          <path key={i} transform={`translate(10 -220) rotate(${a})`} d="M0 0 Q50 -18 110 8 Q55 -2 0 8 Z" fill={p.foliage} {...outline(3)} />
        ))}
      </g>
    );
  return (
    <g transform={t}>
      <rect x={-8} y={-60} width={16} height={60} fill={p.trunk} {...outline(4)} />
      <circle cx={0} cy={-110} r={62} fill={p.foliage} {...outline(4)} />
      <circle cx={-38} cy={-82} r={36} fill={p.foliage} {...outline(4)} />
      <circle cx={34} cy={-86} r={40} fill={p.foliage} {...outline(4)} />
    </g>
  );
}

const treeKind = (style: V3ArchStyle): "selvi" | "fistik" | "yuvarlak" | "palmiye" => (style === "misir" || style === "pers" ? "palmiye" : style === "roma" || style === "yunan" || style === "bizans" || style === "osmanli" ? "selvi" : "yuvarlak");

/** A building of the period, its base at (x, y), about `h` tall. */
function Building({ x, y, w, h, style, c, seed, lit }: { x: number; y: number; w: number; h: number; style: V3ArchStyle; c: StyleColours; seed: number; lit: boolean }) {
  const r = rng(seed);
  const win = lit ? "#ffcf6a" : "#3a2f2a";
  const windows = Array.from({ length: Math.max(1, Math.floor(w / 46)) }, (_, i) => x + 18 + i * 46).filter((wx) => wx < x + w - 24);
  const floors = h > 150 ? 2 : 1;
  const body = <rect x={x} y={y - h} width={w} height={h} fill={c.wall} {...outline(4)} />;
  const winRow = (wy: number) => windows.map((wx, i) => (r() < 0.75 ? <rect key={`${wy}-${i}`} x={wx} y={wy} width={16} height={24} rx={style === "roma" || style === "bizans" ? 8 : 2} fill={win} {...outline(3)} /> : null));
  const rows = Array.from({ length: floors }, (_, f) => winRow(y - h + 26 + f * 70));
  if (style === "misir")
    return (
      <g>
        <path d={`M${x} ${y} L${x + 10} ${y - h} L${x + w - 10} ${y - h} L${x + w} ${y} Z`} fill={c.wall} {...outline(4)} />
        <rect x={x + 6} y={y - h - 10} width={w - 12} height={12} fill={c.wallShade} {...outline(3)} />
        {rows}
      </g>
    );
  if (style === "cin" || style === "japon")
    return (
      <g>
        {body}
        <path d={`M${x - 26} ${y - h} Q${x + w / 2} ${y - h - 30} ${x + w + 26} ${y - h} L${x + w - 8} ${y - h - 34} L${x + 8} ${y - h - 34} Z`} fill={c.roof} {...outline(4)} />
        <rect x={x + 8} y={y - h * 0.7} width={10} height={h * 0.7} fill={c.trim} {...outline(3)} />
        <rect x={x + w - 18} y={y - h * 0.7} width={10} height={h * 0.7} fill={c.trim} {...outline(3)} />
        {rows}
      </g>
    );
  const roofH = style === "ortacag" || style === "erken_modern" ? 60 : 26;
  return (
    <g>
      {body}
      {style === "ortacag" ? <path d={`M${x} ${y - h * 0.5} L${x + w} ${y - h * 0.5} M${x + w * 0.33} ${y - h} L${x + w * 0.33} ${y} M${x + w * 0.66} ${y - h} L${x + w * 0.66} ${y}`} stroke="#5a3a2a" strokeWidth={6} /> : null}
      <path d={`M${x - 12} ${y - h} L${x + w / 2} ${y - h - roofH} L${x + w + 12} ${y - h} Z`} fill={c.roof} {...outline(4)} />
      {rows}
      {style === "osmanli" && r() < 0.5 ? <rect x={x + w * 0.3} y={y - h + 10} width={w * 0.4} height={34} fill={c.wallShade} {...outline(3)} /> : null}
    </g>
  );
}

/** The period's landmark on a skyline: a temple, a domed church, a mosque with minarets, a pyramid, a pagoda, a castle. */
function Landmark({ x, y, s, style, c }: { x: number; y: number; s: number; style: V3ArchStyle; c: StyleColours }) {
  const t = `translate(${x} ${y}) scale(${s})`;
  switch (style) {
    case "roma":
    case "yunan":
      return (
        <g transform={t}>
          <rect x={-170} y={-24} width={340} height={24} fill={c.wallShade} {...outline(4)} />
          {[-140, -84, -28, 28, 84, 140].map((cx) => (
            <rect key={cx} x={cx - 14} y={-170} width={28} height={146} fill={c.trim} {...outline(4)} />
          ))}
          <rect x={-180} y={-196} width={360} height={26} fill={c.wall} {...outline(4)} />
          <path d="M-190 -196 L0 -262 L190 -196 Z" fill={style === "roma" ? c.roof : c.wall} {...outline(4)} />
        </g>
      );
    case "bizans":
    case "osmanli":
      return (
        <g transform={t}>
          <rect x={-150} y={-120} width={300} height={120} fill={c.wall} {...outline(4)} />
          <path d="M-110 -120 Q0 -260 110 -120 Z" fill={style === "osmanli" ? "#9aa6b2" : c.roof} {...outline(4)} />
          <rect x={-4} y={-232} width={8} height={30} fill={c.trim} {...outline(3)} />
          {style === "osmanli"
            ? [-190, 190].map((mx) => (
                <g key={mx}>
                  <rect x={mx - 10} y={-300} width={20} height={300} fill={c.wall} {...outline(4)} />
                  <path d={`M${mx - 12} -300 L${mx} -350 L${mx + 12} -300 Z`} fill="#9aa6b2" {...outline(3)} />
                </g>
              ))
            : null}
        </g>
      );
    case "misir":
      return <path transform={t} d="M-200 0 L0 -230 L200 0 Z" fill={c.wall} {...outline(4)} />;
    case "cin":
    case "japon":
      return (
        <g transform={t}>
          {[0, 1, 2].map((k) => (
            <g key={k}>
              <rect x={-70 + k * 14} y={-70 - k * 70} width={140 - k * 28} height={70} fill={c.wall} {...outline(4)} />
              <path d={`M${-110 + k * 16} ${-70 - k * 70} Q0 ${-96 - k * 70} ${110 - k * 16} ${-70 - k * 70} L${80 - k * 14} ${-96 - k * 70} L${-80 + k * 14} ${-96 - k * 70} Z`} fill={c.roof} {...outline(4)} />
            </g>
          ))}
        </g>
      );
    default:
      return (
        <g transform={t}>
          <rect x={-160} y={-150} width={320} height={150} fill={c.wall} {...outline(4)} />
          {[-160, -40, 80].map((bx) => (
            <rect key={bx} x={bx} y={-176} width={40} height={26} fill={c.wall} {...outline(4)} />
          ))}
          <rect x={-60} y={-230} width={120} height={230} fill={c.wallShade} {...outline(4)} />
          <path d="M-30 0 L-30 -60 Q0 -90 30 -60 L30 0 Z" fill="#3a2f2a" {...outline(3)} />
        </g>
      );
  }
}

/** Flowing water: a band (or a river polygon) with ripples that move with the current. */
function Water({ d, p, frame, y0, y1, x0, x1, flow, id }: { d: string; p: Palette; frame: number; y0: number; y1: number; x0: number; x1: number; flow: number; id: string }) {
  const r = rng(y0 * 7 + x0);
  const ripples = Array.from({ length: Math.round(((x1 - x0) * (y1 - y0)) / 9000) + 8 }, () => ({ x: r(), y: r(), w: 26 + r() * 50, ph: r() * 6.28 }));
  return (
    <g>
      <defs>
        <clipPath id={`ds-w-${id}`}>
          <path d={d} />
        </clipPath>
      </defs>
      <path d={d} fill={p.water} {...outline(4)} />
      <g clipPath={`url(#ds-w-${id})`}>
        {ripples.map((q, i) => {
          const span = x1 - x0;
          const x = x0 + ((q.x * span + frame * flow * (0.6 + q.y)) % span);
          const y = y0 + q.y * (y1 - y0);
          return <path key={i} d={`M${x} ${y} q${q.w / 2} -6 ${q.w} 0`} fill="none" stroke={p.waterLight} strokeWidth={4} strokeLinecap="round" opacity={0.35 + 0.35 * Math.sin(frame * 0.12 + q.ph)} />;
        })}
      </g>
    </g>
  );
}

/** A torch on a pole, base at (x, y): the flame flickers frame by frame. */
function Torch({ x, y, s, frame, i }: { x: number; y: number; s: number; frame: number; i: number }) {
  const f = 1 + 0.14 * Math.sin(frame * 0.9 + i * 2.1) + 0.08 * Math.sin(frame * 2.3 + i);
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={-6} y={-230} width={12} height={230} fill="#5a3e2a" {...outline(4)} />
      <path d="M-18 -230 L18 -230 L12 -250 L-12 -250 Z" fill="#3a2f2a" {...outline(3)} />
      <g transform={`translate(0 -250) scale(${1 / f + 0.05} ${f})`}>
        <path d="M0 -70 Q30 -30 18 -6 Q0 6 -18 -6 Q-30 -30 0 -70 Z" fill="#ff9f1c" {...outline(3)} />
        <path d="M0 -42 Q14 -20 8 -6 Q0 0 -8 -6 Q-14 -20 0 -42 Z" fill="#ffe066" />
      </g>
    </g>
  );
}

/**
 * Where the torches stand (stage x): on dry ground only — the first crossing set planted one in the middle of the
 * Rubicon (owner, 22 Oct 2026: "suyun içindeki meşale çok saçma"). Spots in the river or on its edge are dropped.
 */
export function torchXs(spec: V3DrawnSet): number[] {
  const spots = [0.06, 0.32, 0.68, 0.94];
  if (spec.manzara !== "nehir_gecidi") return spots;
  const [a, b] = spec.nehir ?? [0.52, 0.8];
  return spots.filter((x) => x < a - 0.05 || x > b + 0.05);
}

/** A torch the set draws: its pole's foot (x, y) in set space and its size. */
export interface TorchSpot {
  readonly x: number;
  readonly y: number;
  readonly s: number;
}

/**
 * Every torch a set draws, from one list — the set draws its torches from it and `lightSpots` lights them from it
 * (Siege of Baghdad Short, 13 Nov 2026, owner: "1 tane meşale gözüküyor, 2 tane parlıyor ekranda": the glows came from a
 * separate list of four outdoor spots, so the command tent and the palace, which draw two torches at their walls, glowed
 * where no torch stood). A tent lit by any light has its two torches (no open fire inside a tent); a palace or council
 * hall has two when torch-lit; aboard there are only the ship's lanterns.
 */
export function torchSpots(spec: V3DrawnSet, W: number, H: number): TorchSpot[] {
  const m = spec.manzara;
  if (m === "gemi_guvertesi" || m === "gemi_kamarasi") return [];
  if (m === "cadir_ici") return spec.isik && spec.isik !== "yok" ? [0.07, 0.93].map((tx) => ({ x: tx * W, y: stageY(0.7, H), s: 0.6 })) : [];
  if (spec.isik !== "mesale") return [];
  if (m === "saray_ici" || m === "meclis") return [0.06, 0.94].map((tx) => ({ x: tx * W, y: stageY(0.7, H), s: 0.6 }));
  return torchXs(spec).map((tx) => ({ x: tx * W, y: stageY(0.62, H), s: 0.62 }));
}

/** The flame of a torch as a box in set space (Torch's flame: 70 high, 36 wide above the pole's 250-high cup). */
export function flameBox(t: TorchSpot): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: t.x - 18 * t.s, x1: t.x + 18 * t.s, y0: t.y - 320 * t.s, y1: t.y - 244 * t.s };
}

/** Something drawn over the set (an actor, an extra) as a box in set space: what stands there hides the torch behind it. */
export interface SetCover {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * A standing figure's box in character space (feet at 0, head radius 100): a robe's or a coat's width either side and
 * up to the top of a tall headdress — kept a little inside the drawing, so a flame peeking past a shoulder still glows.
 */
export const FIGURE_COVER = { half: 120, top: -620 } as const;

/**
 * How much of a torch's flame shows past the actors standing in front of it (0 hidden .. 1 all seen), sampled on an 8×8
 * grid of the flame so the glow fades as someone walks across it instead of popping. The walls set of the Siege of
 * Baghdad Short (13 Nov 2026) put two of its four torches right behind the two actors (auto slots 0.27/0.73 against
 * torches at 0.32/0.68): the torches were hidden, their glows painted over the actors' faces.
 */
export function flameShown(t: TorchSpot, covers: readonly SetCover[]): number {
  if (!covers.length) return 1;
  const f = flameBox(t);
  const N = 8;
  let seen = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = f.x0 + ((i + 0.5) / N) * (f.x1 - f.x0);
      const y = f.y0 + ((j + 0.5) / N) * (f.y1 - f.y0);
      if (!covers.some((c) => x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1)) seen++;
    }
  }
  return seen / (N * N);
}

/**
 * Where the drawn set lights the night (for the glow over the actors): each torch the set draws, as strong as its flame
 * is seen past `covers`; the camp fire where it burns; a ship's lanterns. A glow always belongs to a drawn, visible light.
 */
export function lightSpots(spec: V3DrawnSet, W: number, H: number, covers: readonly SetCover[] = []): { x: number; y: number; r: number; a: number }[] {
  // Aboard, any light is the ship's lanterns (no torch or open fire on a wooden deck).
  const ship = spec.manzara === "gemi_guvertesi" ? DECK_LAMPS : spec.manzara === "gemi_kamarasi" ? CABIN_LAMPS : undefined;
  if (ship) return spec.isik && spec.isik !== "yok" ? ship.map((l) => ({ x: l.x * W, y: l.y * H + 36, r: 300, a: 1 })) : [];
  const torches = torchSpots(spec, W, H).map((t) => ({ x: t.x, y: t.y - 250 * t.s, r: 330, a: flameShown(t, covers) }));
  // The camp fire burns only outdoors (DrawnSetBack draws none in a tent, a palace or a council hall).
  const outdoors = spec.manzara !== "cadir_ici" && spec.manzara !== "saray_ici" && spec.manzara !== "meclis";
  const fire = spec.isik === "kamp_atesi" && outdoors ? [{ x: 0.5 * W, y: stageY(0.9, H) - 40, r: 520, a: 1 }] : [];
  return [...torches, ...fire];
}

/** The river's banks at a screen height (crossing set): it widens toward the viewer. */
function riverAt(spec: V3DrawnSet, W: number, y: number, H: number): [number, number] {
  const [a, b] = spec.nehir ?? [0.52, 0.8];
  const t = Math.max(0, Math.min(1, (y - HORIZON * H) / (H - HORIZON * H)));
  // Gentle perspective: at the crowd's depth the river must still hold several wading soldiers side by side (at
  // 0.32 + 0.68t only one fitted, and the legion seemed to hop from bank to bank).
  const narrow = 0.5 + 0.5 * t;
  const mid = (a + b) / 2;
  return [(mid - ((b - a) / 2) * narrow) * W, (mid + ((b - a) / 2) * narrow) * W];
}

/** False where a screen point falls in (or right at the edge of) the crossing's river: nothing is planted there. */
function onLand(spec: V3DrawnSet, x: number, y: number, W: number, H: number): boolean {
  if (spec.manzara !== "nehir_gecidi") return true;
  const [l, r] = riverAt(spec, W, y, H);
  return x < l - 40 || x > r + 40;
}

/** Half an actor's width on the stage (x units): a body is in the water only when all of it is past the bank. */
const HALF_BODY = 0.045;

/**
 * How deep an actor at stage x and depth stands in the crossing's river: 0 on the bank, rising to 1 a little way in.
 * The banks are the river's own at that depth (it narrows toward the horizon), and the whole body must be past the
 * bank — the first crossing cut a legionary at the waist while half of him still stood on land (owner, 22 Oct 2026).
 */
export function riverDepth(spec: V3DrawnSet | undefined, x: number, depth: number): number {
  if (!spec || spec.manzara !== "nehir_gecidi") return 0;
  const [l, r] = riverAt(spec, 1, stageY(depth, 1), 1);
  const inside = Math.min(x - l, r - x) - HALF_BODY;
  return Math.max(0, Math.min(1, inside / 0.035));
}

/** True when an actor at stage x and depth stands in the crossing's river. */
export function inRiver(spec: V3DrawnSet | undefined, x: number, depth: number): boolean {
  return riverDepth(spec, x, depth) > 0;
}

/** Waist height in character space (feet at 0, head radius 100): the water line of someone standing chest-deep. */
const WAIST = -250;

/** The water line of an actor `depth` (0..1) into the river, in character space. */
export const waterLine = (depth: number) => WAIST * depth;

/** A tent's canvas colours by the period: an Ottoman otağ red and cream, a Persian or Mongol blue, else a field tent's. */
const TENT_CLOTH: Partial<Record<V3ArchStyle, readonly [string, string]>> = {
  osmanli: ["#b3263a", "#f1e3c4"],
  pers: ["#2f5d9e", "#efe0bd"],
  cin: ["#b8392e", "#f0e2c0"],
  japon: ["#2f3f55", "#ece2c8"],
  roma: ["#a8743f", "#e9d6ab"],
  yunan: ["#9b7a52", "#ece0c4"],
  bizans: ["#6d2f6e", "#efdcb8"],
};

/**
 * Inside a commander's tent (owner, 23 Oct 2026: the war council in the otağ; the Kosovo 1389 trial drew "Murad's tent"
 * as a sunny camp): striped canvas walls rising to the roof, the centre pole, the door flap open on the camp at the
 * back, a carpet on the ground, a hanging lamp that sways, braziers when the scene is lit.
 */
function TentInterior({ spec, p, c, W, H, frame }: { spec: V3DrawnSet; p: Palette; c: StyleColours; W: number; H: number; frame: number }) {
  const cloth = TENT_CLOTH[spec.uslup] ?? (["#8a6a45", "#e6d5b0"] as const);
  const deep = mix(cloth[0], p.dimTo, p.dim);
  const light = mix(cloth[1], p.dimTo, p.dim);
  const floorTop = H * 0.72;
  const stripes = 12;
  const sway = Math.sin(frame * 0.04) * 6;
  const flap = { x0: W * 0.43, x1: W * 0.57, top: H * 0.3 };
  return (
    <g>
      {/* What is seen through the open flap: the sky of the hour and the camp's far tents. */}
      <rect x={flap.x0} y={flap.top} width={flap.x1 - flap.x0} height={floorTop - flap.top} fill={p.sky[2]} />
      <rect x={flap.x0} y={floorTop - 70} width={flap.x1 - flap.x0} height={70} fill={p.groundFar} />
      {[0.46, 0.53].map((tx) => (
        <path key={tx} d={`M${tx * W - 30} ${floorTop - 40} L${tx * W} ${floorTop - 92} L${tx * W + 30} ${floorTop - 40} Z`} fill={mix("#e8dcc0", p.dimTo, p.dim)} {...outline(3)} />
      ))}
      {/* The back wall: vertical stripes of the two cloths, a scalloped valance under the roof. */}
      {Array.from({ length: stripes }, (_, i) => {
        const x = (i / stripes) * W * 1.2 - W * 0.1;
        const w = (W * 1.2) / stripes;
        // Over the door the canvas comes down to the top of the opening.
        const bottom = x + w > flap.x0 && x < flap.x1 ? flap.top : floorTop;
        return <rect key={i} x={x} y={H * 0.12} width={w + 1} height={bottom - H * 0.12} fill={i % 2 ? light : deep} />;
      })}
      {/* The flap itself, drawn back to both sides. */}
      <path d={`M${flap.x0} ${H * 0.12} Q${flap.x0 + 40} ${H * 0.4} ${flap.x0 - 30} ${floorTop}`} fill="none" {...outline(5)} />
      <path d={`M${flap.x0 - 40} ${H * 0.12} L${flap.x0} ${H * 0.12} Q${flap.x0 + 40} ${H * 0.4} ${flap.x0 - 30} ${floorTop} L${flap.x0 - 90} ${floorTop} Z`} fill={deep} {...outline(5)} />
      <path d={`M${flap.x1 + 40} ${H * 0.12} L${flap.x1} ${H * 0.12} Q${flap.x1 - 40} ${H * 0.4} ${flap.x1 + 30} ${floorTop} L${flap.x1 + 90} ${floorTop} Z`} fill={deep} {...outline(5)} />
      {/* The roof: the canvas sloping up to the pole's top, with a scalloped valance and a gold trim. */}
      <rect x={-W * 0.1} y={-H * 0.1} width={W * 1.2} height={H * 0.24} fill={mix(deep, "#000000", 0.25)} />
      {/* The roof's seams, running out from the pole's top. */}
      {[-0.6, -0.3, 0.3, 0.6].map((k) => (
        <path key={k} d={`M${W * 0.5} ${H * 0.02} L${W * 0.5 + k * W} ${H * 0.12}`} stroke={mix(light, "#000000", 0.2)} strokeWidth={4} opacity={0.6} />
      ))}
      {Array.from({ length: 16 }, (_, i) => {
        const x = (i / 16) * W * 1.2 - W * 0.1;
        const w = (W * 1.2) / 16;
        return <path key={`v${i}`} d={`M${x} ${H * 0.12} L${x + w} ${H * 0.12} Q${x + w / 2} ${H * 0.21} ${x} ${H * 0.12} Z`} fill={i % 2 ? deep : light} {...outline(3)} />;
      })}
      <rect x={-W * 0.1} y={H * 0.1} width={W * 1.2} height={14} fill={mix("#d9a63a", p.dimTo, p.dim)} {...outline(3)} />
      {/* The centre pole, behind the actors. */}
      <rect x={W * 0.5 - 14} y={-H * 0.1} width={28} height={flap.top + H * 0.1} fill={mix("#7a5232", p.dimTo, p.dim)} {...outline(4)} />
      <circle cx={W * 0.5} cy={H * 0.02} r={22} fill={mix("#d9a63a", p.dimTo, p.dim)} {...outline(4)} />
      {/* The carpet on the ground. */}
      <rect x={-W * 0.1} y={floorTop} width={W * 1.2} height={H} fill={mix("#8a5a35", p.dimTo, p.dim)} {...outline(5)} />
      <path d={`M${W * 0.08} ${floorTop + 40} L${W * 0.92} ${floorTop + 40} L${W * 1.04} ${H * 1.02} L${-W * 0.04} ${H * 1.02} Z`} fill={mix("#9e2a2a", p.dimTo, p.dim)} {...outline(4)} />
      <path d={`M${W * 0.14} ${floorTop + 62} L${W * 0.86} ${floorTop + 62} L${W * 0.96} ${H} L${W * 0.04} ${H} Z`} fill="none" stroke={mix("#e3b23c", p.dimTo, p.dim)} strokeWidth={6} />
      {/* A lamp on a chain from the roof, swaying a little, glowing. */}
      <g transform={`translate(${W * 0.3 + sway} 0)`}>
        <path d={`M0 0 L0 ${H * 0.24}`} stroke={INK} strokeWidth={3} />
        <circle cx={0} cy={H * 0.27} r={60} fill="#ffd27a" opacity={0.18 + 0.05 * Math.sin(frame * 0.3)} />
        <path d={`M-18 ${H * 0.24} L18 ${H * 0.24} L12 ${H * 0.29} L-12 ${H * 0.29} Z`} fill={mix("#d9a63a", p.dimTo, p.dim)} {...outline(3)} />
      </g>
      {torchSpots(spec, W, H).map((t, i) => <Torch key={i} x={t.x} y={t.y} s={t.s} frame={frame} i={i} />)}
    </g>
  );
}

/** The sea's slow roll against a ship (degrees, and a small rise and fall in px): the world outside moves, the ship holds. */
const shipRoll = (frame: number) => ({ deg: 1.4 * Math.sin(frame * 0.032), bob: 7 * Math.sin(frame * 0.032 + 1.2) });

/** A sail's cloth and its stripe by the period: Roman red-striped linen, Greek blue, a Chinese junk's ochre. */
const SAIL_CLOTH: Partial<Record<V3ArchStyle, readonly [string, string]>> = {
  roma: ["#f2e4c4", "#b8402e"],
  yunan: ["#f4ead2", "#3f6aa8"],
  misir: ["#f1e2bc", "#3f74b8"],
  pers: ["#efe0bd", "#2f5d9e"],
  bizans: ["#efdcb8", "#6d2f6e"],
  osmanli: ["#f1e3c4", "#b3263a"],
  cin: ["#d9a560", "#8a4a2a"],
  japon: ["#ece2c8", "#2f3f55"],
};

/** Where a ship's lanterns hang (stage x, frame height): on the mast and the stern post on deck, from the beams in a cabin. */
const DECK_LAMPS = [
  { x: 0.4, y: 0.53 },
  { x: 0.93, y: 0.53 },
] as const;
/** Where the deck's lanterns hang from (frame height): under the sail. */
const DECK_HOOK_Y = 0.47;
const CABIN_LAMPS = [
  { x: 0.275, y: 0.26 },
  { x: 0.725, y: 0.26 },
] as const;
const DECK_MAST_X = 0.4;

/** A planked floor (deck or cabin) from y0 down past the frame: seams along the ship, wider toward the viewer, staggered joints. */
function Planks({ y0, W, H, fill, seam, seed }: { y0: number; W: number; H: number; fill: string; seam: string; seed: number }) {
  const r = rng(seed);
  const rows = 7;
  const ys = Array.from({ length: rows }, (_, k) => y0 + (H * 1.05 - y0) * ((k + 1) / rows) ** 1.35);
  return (
    <g>
      <rect x={-W * 0.1} y={y0} width={W * 1.2} height={H * 1.1 - y0} fill={fill} {...outline(5)} />
      {ys.map((y, k) => (
        <path key={`p${k}`} d={`M${-W * 0.1} ${y} L${W * 1.1} ${y}`} stroke={seam} strokeWidth={3} />
      ))}
      {ys.map((y, k) => {
        const top = k ? ys[k - 1]! : y0;
        const step = 260 + k * 60;
        const off = r() * step;
        return Array.from({ length: Math.ceil((W * 1.2) / step) + 1 }, (_, j) => <path key={`j${k}-${j}`} d={`M${-W * 0.1 + off + j * step} ${top} L${-W * 0.1 + off + j * step} ${y}`} stroke={seam} strokeWidth={3} />);
      })}
    </g>
  );
}

function Barrel({ x, y, s, wood, hoop }: { x: number; y: number; s: number; wood: string; hoop: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-44 0 Q-56 -60 -44 -120 L44 -120 Q56 -60 44 0 Z" fill={wood} {...outline(4)} />
      <path d="M-50 -28 L50 -28 M-50 -92 L50 -92" stroke={hoop} strokeWidth={8} />
      <ellipse cx={0} cy={-120} rx={44} ry={10} fill={mix(wood, "#000000", 0.15)} {...outline(3)} />
    </g>
  );
}

/** A ship's lantern on its hook at (x, y): swings by `swing` degrees, glows. */
function ShipLantern({ x, y, len, swing, frame, i, lit }: { x: number; y: number; len: number; swing: number; frame: number; i: number; lit: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${swing})`}>
      <path d={`M0 0 L0 ${len}`} stroke={INK} strokeWidth={3} />
      {lit ? <circle cx={0} cy={len + 34} r={70} fill="#ffd27a" opacity={0.2 + 0.05 * Math.sin(frame * 0.3 + i)} /> : null}
      <path d={`M-16 ${len} L16 ${len} L22 ${len + 14} L-22 ${len + 14} Z`} fill="#3a2f2a" {...outline(3)} />
      <rect x={-18} y={len + 14} width={36} height={44} rx={6} fill={lit ? "#ffe08a" : "#b9c4c8"} {...outline(4)} />
      <path d={`M0 ${len + 14} L0 ${len + 58}`} stroke={INK} strokeWidth={3} />
      <path d={`M-22 ${len + 58} L22 ${len + 58} L14 ${len + 70} L-14 ${len + 70} Z`} fill="#3a2f2a" {...outline(3)} />
    </g>
  );
}

/**
 * On a ship's deck at sea (Caesar and the pirates, 2 Nov 2026: "Pirate ship cabin" drawn as a field with a village):
 * the open sea to the horizon rolling slowly against the ship, a far coast or sail, the mast with its yard and a full
 * sail of the period, rigging, the far rail, a planked deck with barrels and rope; lanterns when the scene is lit.
 */
function ShipDeck({ spec, p, W, H, frame }: { spec: V3DrawnSet; p: Palette; W: number; H: number; frame: number }) {
  if (spec.uslup === "modern") return <SteelDeck spec={spec} p={p} W={W} H={H} frame={frame} />;
  const r = rng(spec.tohum + 3);
  const d = (col: string) => mix(col, p.dimTo, p.dim);
  const [cloth, stripe] = SAIL_CLOTH[spec.uslup] ?? (["#efe3c8", "#9e2a2a"] as const);
  const railTop = H * 0.6;
  const railBase = stageY(1.15, H);
  const horizon = H * 0.43;
  const roll = shipRoll(frame);
  const coastLeft = r() < 0.5;
  const coast = r() < 0.65;
  const mastX = W * DECK_MAST_X;
  const belly = 34 + 10 * Math.sin(frame * 0.05);
  const sail = { x0: mastX - W * 0.19, x1: mastX + W * 0.19, top: H * 0.08, bottom: H * 0.42 };
  const junk = spec.uslup === "cin" || spec.uslup === "japon";
  const sailPath = `M${sail.x0} ${sail.top} L${sail.x1} ${sail.top} Q${sail.x1 + belly} ${(sail.top + sail.bottom) / 2} ${sail.x1 - 12} ${sail.bottom} Q${mastX} ${sail.bottom + belly * 0.7} ${sail.x0 + 12} ${sail.bottom} Q${sail.x0 - belly} ${(sail.top + sail.bottom) / 2} ${sail.x0} ${sail.top} Z`;
  const lit = (spec.isik !== undefined && spec.isik !== "yok") || spec.zaman === "gece";
  const sway = (i: number) => 4 * Math.sin(frame * 0.032 + 0.6 + i);
  return (
    <g>
      {/* Beyond the ship: the sky, a far coast, the sea to the horizon, rolling a little. */}
      <g transform={`translate(0 ${roll.bob}) rotate(${roll.deg} ${W / 2} ${railTop})`}>
        <Sky p={p} spec={spec} W={W} H={H} frame={frame} seed={spec.tohum} />
        {coast ? <path d={coastLeft ? `M${-W * 0.2} ${horizon + 4} L${-W * 0.2} ${horizon - 70} Q${W * 0.08} ${horizon - 120} ${W * 0.22} ${horizon - 40} Q${W * 0.3} ${horizon - 10} ${W * 0.36} ${horizon + 4} Z` : `M${W * 1.2} ${horizon + 4} L${W * 1.2} ${horizon - 80} Q${W * 0.95} ${horizon - 130} ${W * 0.8} ${horizon - 44} Q${W * 0.72} ${horizon - 12} ${W * 0.64} ${horizon + 4} Z`} fill={p.far} {...outline(4)} /> : null}
        <Water d={`M${-W * 0.2} ${horizon} L${W * 1.2} ${horizon} L${W * 1.2} ${railBase} L${-W * 0.2} ${railBase} Z`} p={p} frame={frame} y0={horizon} y1={railBase} x0={-W * 0.2} x1={W * 1.2} flow={-0.8} id="guverte" />
        {/* A far sail on the horizon, drifting. */}
        <g transform={`translate(${W * (0.15 + ((r() + frame * 0.0004) % 0.75))} ${horizon + 6}) scale(0.5)`}>
          <path d="M-60 0 L60 0 L44 22 L-44 22 Z" fill={d("#6b4226")} {...outline(4)} />
          <path d="M0 0 L0 -110 M-40 -100 L40 -100" stroke={INK} strokeWidth={6} />
          <path d="M-40 -100 L40 -100 Q52 -60 36 -14 L-36 -14 Q-52 -60 -40 -100 Z" fill={d(cloth)} {...outline(4)} />
        </g>
      </g>
      {/* Gulls over the water by day. */}
      {spec.zaman === "gece"
        ? null
        : [0, 1, 2].map((i) => {
            const x = ((W * (0.2 + i * 0.31) + frame * (0.9 + i * 0.25)) % (W * 1.2)) - W * 0.1;
            const y = H * (0.2 + 0.07 * i) + 10 * Math.sin(frame * 0.04 + i);
            const flap = Math.sin(frame * 0.32 + i * 2);
            return <path key={`g${i}`} d={`M${x - 22} ${y} Q${x - 11} ${y - 12 * flap} ${x} ${y} Q${x + 11} ${y - 12 * flap} ${x + 22} ${y}`} fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />;
          })}
      {/* Rigging: stays from the masthead down to the rail. */}
      {[-0.32, -0.16, 0.18, 0.34].map((k) => (
        <path key={`st${k}`} d={`M${mastX} ${H * 0.02} L${mastX + k * W} ${railTop - 8}`} stroke={d("#4a3626")} strokeWidth={4} />
      ))}
      {/* The mast, standing on the deck behind the actors, and its yard. */}
      <rect x={mastX - 17} y={-H * 0.1} width={34} height={stageY(0.6, H) + H * 0.1} fill={d("#7a5232")} {...outline(5)} />
      <rect x={sail.x0 - 24} y={sail.top - 16} width={sail.x1 - sail.x0 + 48} height={20} rx={8} fill={d("#6b4226")} {...outline(4)} />
      <defs>
        <clipPath id="ds-yelken">
          <path d={sailPath} />
        </clipPath>
      </defs>
      <path d={sailPath} fill={d(cloth)} {...outline(5)} />
      <g clipPath="url(#ds-yelken)">
        {junk
          ? [0.2, 0.4, 0.6, 0.8].map((k) => <path key={k} d={`M${sail.x0 - 60} ${sail.top + k * (sail.bottom - sail.top)} L${sail.x1 + 60} ${sail.top + k * (sail.bottom - sail.top)}`} stroke={d(stripe)} strokeWidth={8} />)
          : [-0.11, 0.11].map((k) => <rect key={k} x={mastX + k * W - 28} y={sail.top} width={56} height={sail.bottom - sail.top + belly} fill={d(stripe)} />)}
      </g>
      {/* The far rail: planked bulwark, a cap rail, posts, a painted band of the period. */}
      <rect x={-W * 0.1} y={railTop} width={W * 1.2} height={railBase - railTop} fill={d("#8a5a35")} {...outline(5)} />
      <rect x={-W * 0.1} y={railTop + (railBase - railTop) * 0.45} width={W * 1.2} height={16} fill={d(stripe)} />
      {Array.from({ length: 15 }, (_, i) => (
        <rect key={`po${i}`} x={-W * 0.1 + i * (W / 12) - 10} y={railTop - 8} width={20} height={railBase - railTop + 8} fill={d("#6b4226")} {...outline(3)} />
      ))}
      <rect x={-W * 0.1} y={railTop - 20} width={W * 1.2} height={24} rx={8} fill={d("#5e3b22")} {...outline(4)} />
      <Planks y0={railBase} W={W} H={H} fill={d("#c48f58")} seam={d("#8f6238")} seed={spec.tohum + 7} />
      {/* On the deck: barrels, a coil of rope, a crate. */}
      <Barrel x={W * 0.06} y={stageY(0.7, H)} s={0.95} wood={d("#9b6a3c")} hoop={d("#4a3626")} />
      <Barrel x={W * 0.12} y={stageY(0.8, H)} s={0.8} wood={d("#9b6a3c")} hoop={d("#4a3626")} />
      <g transform={`translate(${W * 0.9} ${stageY(0.75, H)})`}>
        <rect x={-70} y={-110} width={140} height={110} fill={d("#a9783f")} {...outline(4)} />
        <path d="M-70 -110 L70 0 M70 -110 L-70 0" stroke={d("#7a5232")} strokeWidth={6} />
      </g>
      <g transform={`translate(${W * 0.62} ${stageY(0.75, H)})`}>
        {[54, 40, 26].map((rr) => (
          <g key={rr}>
            <ellipse cx={0} cy={-12} rx={rr} ry={rr * 0.36} fill="none" stroke={INK} strokeWidth={14} />
            <ellipse cx={0} cy={-12} rx={rr} ry={rr * 0.36} fill="none" stroke={d("#c9a66b")} strokeWidth={8} />
          </g>
        ))}
      </g>
      {/* Lanterns on the mast and the stern post. */}
      <rect x={W * DECK_LAMPS[1].x - 9} y={H * DECK_HOOK_Y} width={18} height={stageY(0.6, H) - H * DECK_HOOK_Y} fill={d("#6b4226")} {...outline(3)} />
      {DECK_LAMPS.map((l, i) => (
        <ShipLantern key={`l${i}`} x={l.x * W + (i ? 0 : 17)} y={H * DECK_HOOK_Y} len={(l.y - DECK_HOOK_Y) * H} swing={sway(i)} frame={frame} i={i} lit={lit} />
      ))}
    </g>
  );
}

/**
 * A steel warship's deck for the modern age: the Taranto Short (11 Nov 2026) put its 1940 sailor and Swordfish pilot
 * on a wooden deck under a big sail, and the Gallipoli video's 1915 ships came out as sailing ships too. Here a grey
 * bridge with a funnel and a radio mast stands behind the actors, a gun turret at the side, a steel guard rail with
 * a grey hull side, and a far steamer on the horizon; the teak deck, a rope coil and the lanterns stay.
 */
function SteelDeck({ spec, p, W, H, frame }: { spec: V3DrawnSet; p: Palette; W: number; H: number; frame: number }) {
  const r = rng(spec.tohum + 3);
  const d = (col: string) => mix(col, p.dimTo, p.dim);
  const railTop = H * 0.6;
  const railBase = stageY(1.15, H);
  const horizon = H * 0.43;
  const roll = shipRoll(frame);
  const coastLeft = r() < 0.5;
  const coast = r() < 0.65;
  const lit = (spec.isik !== undefined && spec.isik !== "yok") || spec.zaman === "gece";
  const sway = (i: number) => 4 * Math.sin(frame * 0.032 + 0.6 + i);
  const steel = d("#8b939c");
  const steelDark = d("#5f666e");
  const bridge = { x0: W * 0.22, x1: W * 0.52, top: H * 0.2 };
  const funnelX = W * 0.6;
  const smoke = (i: number) => ({ x: funnelX + 30 + i * 70 + frame * 0.6 * (i + 1) % 140, y: H * 0.06 - i * 40 - ((frame * 0.4 * (i + 1)) % 60), r: 40 + i * 18 });
  return (
    <g>
      {/* Beyond the ship: the sky, a far coast, the sea to the horizon, rolling a little. */}
      <g transform={`translate(0 ${roll.bob}) rotate(${roll.deg} ${W / 2} ${railTop})`}>
        <Sky p={p} spec={spec} W={W} H={H} frame={frame} seed={spec.tohum} />
        {coast ? <path d={coastLeft ? `M${-W * 0.2} ${horizon + 4} L${-W * 0.2} ${horizon - 70} Q${W * 0.08} ${horizon - 120} ${W * 0.22} ${horizon - 40} Q${W * 0.3} ${horizon - 10} ${W * 0.36} ${horizon + 4} Z` : `M${W * 1.2} ${horizon + 4} L${W * 1.2} ${horizon - 80} Q${W * 0.95} ${horizon - 130} ${W * 0.8} ${horizon - 44} Q${W * 0.72} ${horizon - 12} ${W * 0.64} ${horizon + 4} Z`} fill={p.far} {...outline(4)} /> : null}
        <Water d={`M${-W * 0.2} ${horizon} L${W * 1.2} ${horizon} L${W * 1.2} ${railBase} L${-W * 0.2} ${railBase} Z`} p={p} frame={frame} y0={horizon} y1={railBase} x0={-W * 0.2} x1={W * 1.2} flow={-0.8} id="celik-guverte" />
        {/* A far grey steamer on the horizon, drifting: hull, superstructure, one funnel. */}
        <g transform={`translate(${W * (0.15 + ((r() + frame * 0.0004) % 0.75))} ${horizon + 6}) scale(0.5)`}>
          <path d="M-90 0 L90 0 L72 22 L-80 22 Z" fill={steelDark} {...outline(4)} />
          <rect x={-34} y={-30} width={60} height={30} fill={steel} {...outline(4)} />
          <rect x={4} y={-58} width={16} height={28} fill={steelDark} {...outline(4)} />
        </g>
      </g>
      {/* Funnel smoke drifting astern. */}
      {[0, 1, 2].map((i) => {
        const s = smoke(i);
        return <circle key={`sm${i}`} cx={s.x} cy={s.y} r={s.r} fill={d("#6d6d6d")} opacity={0.55 - i * 0.12} />;
      })}
      {/* The radio mast with its yard and aerial wires, behind the bridge. */}
      <rect x={W * 0.37 - 9} y={-H * 0.05} width={18} height={bridge.top + H * 0.05} fill={steelDark} {...outline(4)} />
      <rect x={W * 0.37 - 90} y={H * 0.04} width={180} height={12} rx={4} fill={steelDark} {...outline(3)} />
      <path d={`M${W * 0.37 - 90} ${H * 0.05} L${W * 0.12} ${railTop - 10} M${W * 0.37 + 90} ${H * 0.05} L${funnelX} ${H * 0.12}`} stroke={d("#3a3f45")} strokeWidth={3} fill="none" />
      {/* The funnel, with a dark cap band. */}
      <path d={`M${funnelX - 55} ${railTop} L${funnelX - 45} ${H * 0.12} L${funnelX + 45} ${H * 0.12} L${funnelX + 55} ${railTop} Z`} fill={steel} {...outline(5)} />
      <rect x={funnelX - 47} y={H * 0.12} width={94} height={28} fill={d("#2b2f33")} {...outline(4)} />
      {/* The bridge: two decks of grey steel with a row of square windows each. */}
      <rect x={bridge.x0} y={bridge.top} width={bridge.x1 - bridge.x0} height={railTop - bridge.top} fill={steel} {...outline(5)} />
      <rect x={bridge.x0 - 24} y={bridge.top + (railTop - bridge.top) * 0.42} width={bridge.x1 - bridge.x0 + 48} height={18} fill={steelDark} {...outline(4)} />
      {[0.12, 0.6].map((k) =>
        Array.from({ length: 6 }, (_, i) => (
          <rect key={`w${k}${i}`} x={bridge.x0 + 26 + i * ((bridge.x1 - bridge.x0 - 52) / 6)} y={bridge.top + (railTop - bridge.top) * k} width={(bridge.x1 - bridge.x0 - 52) / 6 - 18} height={30} fill={lit ? "#f3d27a" : d("#2f3a46")} {...outline(3)} />
        )),
      )}
      {/* A gun turret at the side, its two barrels over the rail. */}
      <g transform={`translate(${W * 0.84} ${railTop})`}>
        <rect x={-150} y={-40} width={300} height={22} rx={6} fill={steelDark} {...outline(4)} />
        <rect x={-170} y={-24} width={18} height={18} fill={steelDark} {...outline(3)} />
        <path d="M-110 0 L-90 -110 L110 -110 L130 0 Z" fill={steel} {...outline(5)} />
        <rect x={-20} y={-96} width={260} height={18} rx={8} fill={steelDark} {...outline(4)} transform="rotate(-8 -20 -96)" />
        <rect x={-20} y={-62} width={260} height={18} rx={8} fill={steelDark} {...outline(4)} transform="rotate(-8 -20 -62)" />
      </g>
      {/* The hull side up to the deck edge, and a steel guard rail: stanchions and two wires. */}
      <rect x={-W * 0.1} y={railTop} width={W * 1.2} height={railBase - railTop} fill={d("#6f7780")} {...outline(5)} />
      <rect x={-W * 0.1} y={railTop + (railBase - railTop) * 0.55} width={W * 1.2} height={10} fill={d("#4c535a")} />
      {Array.from({ length: 15 }, (_, i) => (
        <rect key={`po${i}`} x={-W * 0.1 + i * (W / 12) - 5} y={railTop - 70} width={10} height={70} fill={d("#4c535a")} {...outline(2)} />
      ))}
      {[railTop - 66, railTop - 34].map((y) => (
        <rect key={`wi${y}`} x={-W * 0.1} y={y} width={W * 1.2} height={6} fill={d("#4c535a")} />
      ))}
      <Planks y0={railBase} W={W} H={H} fill={d("#b98d5e")} seam={d("#7f5a36")} seed={spec.tohum + 7} />
      {/* On the deck: two ventilator cowls and a coil of rope. */}
      {[0.06, 0.13].map((x, i) => (
        <g key={`v${x}`} transform={`translate(${W * x} ${stageY(0.7 + i * 0.1, H)}) scale(${0.95 - i * 0.15})`}>
          <rect x={-22} y={-120} width={44} height={120} fill={steel} {...outline(4)} />
          <ellipse cx={-8} cy={-130} rx={46} ry={38} fill={steel} {...outline(4)} />
          <ellipse cx={-22} cy={-130} rx={26} ry={24} fill={d("#2b2f33")} />
        </g>
      ))}
      <g transform={`translate(${W * 0.62} ${stageY(0.75, H)})`}>
        {[54, 40, 26].map((rr) => (
          <g key={rr}>
            <ellipse cx={0} cy={-12} rx={rr} ry={rr * 0.36} fill="none" stroke={INK} strokeWidth={14} />
            <ellipse cx={0} cy={-12} rx={rr} ry={rr * 0.36} fill="none" stroke={d("#c9a66b")} strokeWidth={8} />
          </g>
        ))}
      </g>
      {/* Lanterns on the bridge front and the stern post (the shared light spots expect them there). */}
      <rect x={W * DECK_LAMPS[1].x - 9} y={H * DECK_HOOK_Y} width={18} height={stageY(0.6, H) - H * DECK_HOOK_Y} fill={steelDark} {...outline(3)} />
      {DECK_LAMPS.map((l, i) => (
        <ShipLantern key={`l${i}`} x={l.x * W} y={H * DECK_HOOK_Y} len={(l.y - DECK_HOOK_Y) * H} swing={sway(i)} frame={frame} i={i} lit={lit} />
      ))}
    </g>
  );
}

/**
 * Inside a ship's cabin: planked walls between the hull's ribs, deck beams overhead, three portholes on the rolling sea,
 * lanterns swinging from the beams with the roll, a sea chest, barrels and a chart table, a planked floor.
 */
function ShipCabin({ spec, p, W, H, frame }: { spec: V3DrawnSet; p: Palette; W: number; H: number; frame: number }) {
  const d = (col: string) => mix(col, p.dimTo, p.dim);
  const floorTop = stageY(1.15, H);
  const roll = shipRoll(frame);
  const swing = (i: number) => 5 * Math.sin(frame * 0.032 + 0.6 + i * 0.3);
  const ports = [0.2, 0.5, 0.8];
  const portY = H * 0.38;
  const lit = (spec.isik !== undefined && spec.isik !== "yok") || spec.zaman === "gece" || spec.zaman === "aksam";
  const boardH = 54;
  return (
    <g>
      {/* The back wall: planks along the ship. */}
      {Array.from({ length: Math.ceil((floorTop + H * 0.1) / boardH) }, (_, i) => (
        <rect key={`w${i}`} x={-W * 0.1} y={-H * 0.1 + i * boardH} width={W * 1.2} height={boardH + 1} fill={i % 2 ? d("#a8713f") : d("#9a6535")} />
      ))}
      {Array.from({ length: Math.ceil((floorTop + H * 0.1) / boardH) }, (_, i) => (
        <path key={`ws${i}`} d={`M${-W * 0.1} ${-H * 0.1 + i * boardH} L${W * 1.1} ${-H * 0.1 + i * boardH}`} stroke={d("#6b4226")} strokeWidth={3} />
      ))}
      {/* Portholes on the sea outside, its horizon rolling. */}
      {ports.map((px, i) => {
        const cx = px * W;
        const rr = i === 1 ? 92 : 74;
        return (
          <g key={`ph${i}`}>
            <defs>
              <clipPath id={`ds-lomboz-${i}`}>
                <circle cx={cx} cy={portY} r={rr} />
              </clipPath>
            </defs>
            <g clipPath={`url(#ds-lomboz-${i})`}>
              <rect x={cx - rr * 2} y={portY - rr * 2} width={rr * 4} height={rr * 4} fill={p.sky[1]} />
              <g transform={`translate(0 ${roll.bob * 0.6}) rotate(${roll.deg * 3} ${cx} ${portY})`}>
                <rect x={cx - rr * 2} y={portY - rr * 2} width={rr * 4} height={rr * 1.75} fill={p.sky[2]} />
                <rect x={cx - rr * 2} y={portY - rr * 0.25} width={rr * 4} height={rr * 3} fill={p.water} />
                {[0.2, 0.5, 0.8].map((k) => (
                  <path key={k} d={`M${cx - rr + ((k * rr * 2 + frame * 0.8) % (rr * 2))} ${portY + k * rr * 0.8} q14 -5 28 0`} stroke={p.waterLight} strokeWidth={4} fill="none" strokeLinecap="round" />
                ))}
              </g>
            </g>
            <circle cx={cx} cy={portY} r={rr} fill="none" stroke={d("#c9a24a")} strokeWidth={16} />
            <circle cx={cx} cy={portY} r={rr + 8} fill="none" {...outline(4)} />
            <circle cx={cx} cy={portY} r={rr - 8} fill="none" {...outline(3)} />
            {[0, 90, 180, 270].map((a) => (
              <circle key={a} cx={cx + (rr + 0) * Math.cos((a * Math.PI) / 180)} cy={portY + rr * Math.sin((a * Math.PI) / 180)} r={4} fill={INK} />
            ))}
          </g>
        );
      })}
      {/* The hull's ribs between the portholes, curving in toward the floor. */}
      {[0.035, 0.35, 0.65, 0.965].map((k) => {
        const x = k * W;
        const lean = k < 0.5 ? 18 : -18;
        return <path key={`rb${k}`} d={`M${x - 20} ${H * 0.08} Q${x - 20 + lean} ${H * 0.4} ${x - 20 + lean * 1.6} ${floorTop} L${x + 20 + lean * 1.6} ${floorTop} Q${x + 20 + lean} ${H * 0.4} ${x + 20} ${H * 0.08} Z`} fill={d("#6b4226")} {...outline(4)} />;
      })}
      {/* Deck beams overhead. */}
      <rect x={-W * 0.1} y={-H * 0.1} width={W * 1.2} height={H * 0.19} fill={d("#5e3b22")} {...outline(5)} />
      {[0.035, 0.35, 0.65, 0.965].map((k) => (
        <rect key={`bm${k}`} x={k * W - 30} y={H * 0.06} width={60} height={30} fill={d("#4a3020")} {...outline(3)} />
      ))}
      <Planks y0={floorTop} W={W} H={H} fill={d("#6a4428")} seam={d("#452a16")} seed={spec.tohum + 7} />
      {/* A chart table under the middle porthole, a sea chest, barrels. */}
      <g transform={`translate(${W * 0.5} ${stageY(0.75, H)})`}>
        <rect x={-150} y={-120} width={300} height={22} fill={d("#7a5232")} {...outline(4)} />
        <path d="M-130 -98 L-130 0 M130 -98 L130 0" stroke={INK} strokeWidth={14} />
        <path d="M-130 -98 L-130 0 M130 -98 L130 0" stroke={d("#7a5232")} strokeWidth={8} />
        <path d="M-90 -122 L70 -128 L84 -120 L-76 -114 Z" fill={d("#efe0bd")} {...outline(3)} />
      </g>
      <g transform={`translate(${W * 0.12} ${stageY(0.7, H)})`}>
        <rect x={-95} y={-90} width={190} height={90} fill={d("#8a5a35")} {...outline(4)} />
        <path d="M-95 -90 Q0 -140 95 -90 Z" fill={d("#9b6a3c")} {...outline(4)} />
        <rect x={-14} y={-80} width={28} height={30} fill={d("#c9a24a")} {...outline(3)} />
      </g>
      <Barrel x={W * 0.87} y={stageY(0.7, H)} s={0.9} wood={d("#9b6a3c")} hoop={d("#4a3626")} />
      <Barrel x={W * 0.94} y={stageY(0.8, H)} s={0.75} wood={d("#9b6a3c")} hoop={d("#4a3626")} />
      {/* Lanterns from the beams, swinging with the roll. */}
      {CABIN_LAMPS.map((l, i) => (
        <ShipLantern key={`cl${i}`} x={l.x * W} y={H * 0.09} len={l.y * H - H * 0.09} swing={swing(i)} frame={frame} i={i} lit={lit} />
      ))}
    </g>
  );
}

export function DrawnSetBack({ spec, W, H, frame }: { spec: V3DrawnSet; W: number; H: number; frame: number }) {
  const p = PALETTES[spec.zaman];
  const c0 = STYLES[spec.uslup];
  const c: StyleColours = { wall: mix(c0.wall, p.dimTo, p.dim), wallShade: mix(c0.wallShade, p.dimTo, p.dim), roof: mix(c0.roof, p.dimTo, p.dim), trim: mix(c0.trim, p.dimTo, p.dim) };
  const seed = spec.tohum;
  const r = rng(seed);
  const night = spec.zaman === "gece";
  const m = spec.manzara;
  const horizon = HORIZON * H;
  const tree = treeKind(spec.uslup);
  const sway = (i: number) => 1.2 * Math.sin(frame * 0.05 + i);
  const interior = m === "saray_ici" || m === "meclis";

  if (interior) {
    const floorTop = H * 0.7;
    return (
      <g>
        <rect x={-W * 0.1} y={-H * 0.1} width={W * 1.2} height={floorTop + H * 0.1} fill={mix(c.wall, "#000000", 0.08)} />
        {Array.from({ length: 7 }, (_, i) => {
          const cx = (i + 0.5) * (W / 7);
          return (
            <g key={i}>
              <rect x={cx - 34} y={H * 0.08} width={68} height={floorTop - H * 0.08} fill={c.trim} {...outline(5)} />
              <rect x={cx - 48} y={H * 0.05} width={96} height={26} fill={c.wallShade} {...outline(4)} />
              <rect x={cx - 48} y={floorTop - 26} width={96} height={26} fill={c.wallShade} {...outline(4)} />
            </g>
          );
        })}
        <rect x={-W * 0.1} y={-H * 0.1} width={W * 1.2} height={H * 0.15} fill={c.wallShade} {...outline(5)} />
        {m === "meclis"
          ? [0, 1, 2].map((k) => <path key={k} d={`M${-W * 0.1} ${floorTop - 150 + k * 50} Q${W / 2} ${floorTop - 230 + k * 50} ${W * 1.1} ${floorTop - 150 + k * 50} L${W * 1.1} ${floorTop - 112 + k * 50} Q${W / 2} ${floorTop - 192 + k * 50} ${-W * 0.1} ${floorTop - 112 + k * 50} Z`} fill={mix("#8a5a3a", p.dimTo, p.dim)} {...outline(4)} />)
          : [0.18, 0.82].map((tx) => <path key={tx} d={`M${tx * W - 90} ${H * 0.1} Q${tx * W} ${H * 0.18} ${tx * W + 90} ${H * 0.1} L${tx * W + 70} ${floorTop} L${tx * W - 70} ${floorTop} Z`} fill={mix("#a3263a", p.dimTo, p.dim)} {...outline(4)} />)}
        <rect x={-W * 0.1} y={floorTop} width={W * 1.2} height={H} fill={mix(spec.uslup === "roma" || spec.uslup === "yunan" ? "#d8cdb8" : "#b98d5e", p.dimTo, p.dim)} {...outline(5)} />
        {Array.from({ length: 9 }, (_, i) => (
          <path key={i} d={`M${(i / 8) * W} ${floorTop} L${W / 2 + ((i / 8) * W - W / 2) * 2.2} ${H}`} stroke={mix("#a89c86", p.dimTo, p.dim)} strokeWidth={3} />
        ))}
        {torchSpots(spec, W, H).map((t, i) => <Torch key={i} x={t.x} y={t.y} s={t.s} frame={frame} i={i} />)}
      </g>
    );
  }

  if (m === "cadir_ici") return <TentInterior spec={spec} p={p} c={c} W={W} H={H} frame={frame} />;
  if (m === "gemi_guvertesi") return <ShipDeck spec={spec} p={p} W={W} H={H} frame={frame} />;
  if (m === "gemi_kamarasi") return <ShipCabin spec={spec} p={p} W={W} H={H} frame={frame} />;

  // Outdoors: far hills, mid layer of the place, ground.
  const farHills = hillPath(W, H, 0.42, 0.58, 4, seed + 1);
  const midHills = hillPath(W, H, 0.5, 0.63, 6, seed + 2);
  const sea = m === "sahil";
  const town = m === "sokak" || m === "meydan" || m === "sur_onu";
  return (
    <g>
      <Sky p={p} spec={spec} W={W} H={H} frame={frame} seed={seed} />
      {sea ? null : <path d={farHills} fill={p.far} />}
      {!sea && m !== "ova" ? <path d={midHills} fill={p.mid} {...outline(4)} /> : null}
      {sea ? (
        <Water d={`M${-W * 0.1} ${horizon - 30} L${W * 1.1} ${horizon - 30} L${W * 1.1} ${H * 0.74} L${-W * 0.1} ${H * 0.74} Z`} p={p} frame={frame} y0={horizon - 30} y1={H * 0.74} x0={-W * 0.1} x1={W * 1.1} flow={-0.6} id="deniz" />
      ) : null}

      {/* The far skyline of the period. */}
      {town || m === "ordugah" || m === "nehir_kiyisi" || m === "ova" ? (
        <g opacity={m === "ova" || m === "nehir_kiyisi" || m === "ordugah" ? 0.9 : 1}>
          {Array.from({ length: town ? 9 : 4 }, (_, i) => {
            const bw = 90 + r() * 90;
            const bx = town ? i * (W / 8.5) - 40 : W * (0.06 + r() * 0.8);
            return <Building key={i} x={bx} y={horizon + 30} w={town ? bw + 40 : bw * 0.6} h={town ? 150 + r() * 120 : 50 + r() * 40} style={spec.uslup} c={c} seed={seed + i * 13} lit={night} />;
          })}
          <Landmark x={W * (town ? 0.5 : 0.7)} y={horizon + 34} s={town ? 1.05 : 0.45} style={spec.uslup} c={c} />
        </g>
      ) : null}

      {/* Ground. */}
      <path d={`M${-W * 0.1} ${horizon + 20} Q${W * 0.5} ${horizon - 6} ${W * 1.1} ${horizon + 20} L${W * 1.1} ${H * 1.1} L${-W * 0.1} ${H * 1.1} Z`} fill={sea ? mix("#f0d79a", p.dimTo, p.dim) : town ? mix(c.wallShade, "#6b6b6b", 0.35) : p.groundFar} {...outline(5)} />
      <rect x={-W * 0.1} y={stageY(1.15, H)} width={W * 1.2} height={H} fill={sea ? mix("#e9cc88", p.dimTo, p.dim) : town ? mix(c.wallShade, "#5f5f5f", 0.45) : p.ground} />
      {town
        ? Array.from({ length: 40 }, (_, i) => {
            const y = stageY(1.1, H) + (i % 5) * ((H - stageY(1.1, H)) / 5);
            const x = ((Math.floor(i / 5) + (i % 2) * 0.5) / 8) * W;
            return <rect key={i} x={x} y={y + 8} width={W / 9} height={(H - stageY(1.1, H)) / 5 - 10} rx={10} fill="none" stroke={mix("#4a4a4a", p.dimTo, p.dim)} strokeWidth={2} opacity={0.45} />;
          })
        : null}

      {/* Town sides: the street's houses at the edges, nearer and bigger. */}
      {m === "sokak"
        ? [
            { x: -W * 0.06, w: W * 0.2 },
            { x: W * 0.86, w: W * 0.2 },
          ].map((b, i) => <Building key={`s${i}`} x={b.x} y={stageY(1.1, H)} w={b.w} h={H * 0.48} style={spec.uslup} c={c} seed={seed + 90 + i} lit={night} />)
        : null}
      {m === "sur_onu" ? (
        <g>
          <rect x={-W * 0.1} y={horizon - 170} width={W * 1.2} height={200} fill={c.wallShade} {...outline(5)} />
          {Array.from({ length: 26 }, (_, i) => (
            <rect key={i} x={-W * 0.1 + i * 90} y={horizon - 196} width={50} height={28} fill={c.wallShade} {...outline(4)} />
          ))}
          {[0.15, 0.5, 0.85].map((tx) => (
            <g key={tx}>
              <rect x={tx * W - 80} y={horizon - 290} width={160} height={320} fill={c.wall} {...outline(5)} />
              {[-80, -20, 40].map((dx) => (
                <rect key={dx} x={tx * W + dx} y={horizon - 318} width={40} height={30} fill={c.wall} {...outline(4)} />
              ))}
            </g>
          ))}
          <path d={`M${W * 0.5 - 60} ${horizon + 30} L${W * 0.5 - 60} ${horizon - 120} Q${W * 0.5} ${horizon - 190} ${W * 0.5 + 60} ${horizon - 120} L${W * 0.5 + 60} ${horizon + 30} Z`} fill="#3a2f2a" {...outline(4)} />
        </g>
      ) : null}

      {/* River behind the actors. */}
      {m === "nehir_kiyisi" ? (
        <Water d={`M${-W * 0.1} ${stageY(1.5, H)} Q${W * 0.5} ${stageY(1.62, H)} ${W * 1.1} ${stageY(1.48, H)} L${W * 1.1} ${stageY(1.1, H)} Q${W * 0.5} ${stageY(1.2, H)} ${-W * 0.1} ${stageY(1.08, H)} Z`} p={p} frame={frame} y0={stageY(1.62, H)} y1={stageY(1.08, H)} x0={-W * 0.1} x1={W * 1.1} flow={0.9} id="kiyi" />
      ) : null}
      {/* The crossing: the river runs toward the viewer between the two banks. */}
      {m === "nehir_gecidi"
        ? (() => {
            const top = horizon + 14;
            const [ta, tb] = riverAt(spec, W, top, H);
            const [ba, bb] = riverAt(spec, W, H * 1.1, H);
            const d = `M${ta} ${top} Q${(ta + ba) / 2 - 30} ${(top + H) / 2} ${ba} ${H * 1.1} L${bb} ${H * 1.1} Q${(tb + bb) / 2 + 30} ${(top + H) / 2} ${tb} ${top} Z`;
            return <Water d={d} p={p} frame={frame} y0={top} y1={H * 1.1} x0={ba} x1={bb} flow={0.5} id="gecit" />;
          })()
        : null}

      {/* Camp: tents in rows and the legion's standards. */}
      {m === "ordugah"
        ? Array.from({ length: 7 }, (_, i) => {
            const tx = W * (0.04 + i * 0.15) + (r() - 0.5) * 40;
            const ty = stageY(1.25, H);
            const tent = mix(i % 2 ? "#e8dcc0" : "#d8c49c", p.dimTo, p.dim);
            return (
              <g key={`t${i}`} transform={`translate(${tx} ${ty})`}>
                <path d="M-90 0 L0 -110 L90 0 Z" fill={tent} {...outline(4)} />
                <path d="M-24 0 L0 -56 L24 0 Z" fill={mix("#5a4632", p.dimTo, p.dim)} {...outline(3)} />
              </g>
            );
          })
        : null}

      {/* Trees: a back row and a few framing the stage. */}
      {m === "orman"
        ? Array.from({ length: 16 }, (_, i) => {
            const tx = (i / 15) * W * 1.1 - W * 0.05;
            const ty = stageY(1.2 + r() * 0.3, H);
            const ts = 0.9 + r() * 0.6;
            return onLand(spec, tx, ty, W, H) ? <Tree key={`o${i}`} x={tx} y={ty} s={ts} kind={tree === "palmiye" ? "yuvarlak" : tree === "selvi" ? (i % 2 ? "fistik" : "selvi") : "yuvarlak"} p={p} sway={sway(i)} /> : null;
          })
        : !town && !sea
          ? Array.from({ length: 6 }, (_, i) => {
              const tx = (r() < 0.5 ? r() * 0.22 : 0.78 + r() * 0.22) * W;
              const ty = stageY(1.18 + r() * 0.2, H);
              const ts = 0.6 + r() * 0.5;
              return onLand(spec, tx, ty, W, H) ? <Tree key={`a${i}`} x={tx} y={ty} s={ts} kind={i % 3 === 2 && tree === "selvi" ? "fistik" : tree} p={p} sway={sway(i)} /> : null;
            })
          : null}
      {sea ? <Tree x={W * 0.08} y={stageY(1.05, H)} s={1.1} kind={tree === "selvi" ? "fistik" : tree} p={p} sway={sway(1)} /> : null}

      {/* Reeds and stones on the near bank. */}
      {m === "nehir_kiyisi" || m === "nehir_gecidi"
        ? Array.from({ length: 14 }, (_, i) => {
            const rx = (i / 13) * W;
            if (!onLand(spec, rx, stageY(1.06, H), W, H)) return null;
            return (
              <g key={`r${i}`} transform={`translate(${rx} ${stageY(1.06, H)}) rotate(${1.5 * Math.sin(frame * 0.07 + i)})`}>
                <path d="M0 0 Q-6 -50 -2 -90 M8 0 Q10 -40 18 -70 M-8 0 Q-16 -36 -24 -60" stroke={p.foliageDark} strokeWidth={5} fill="none" strokeLinecap="round" />
              </g>
            );
          })
        : null}

      {/* Torches behind the actors, or the camp fire. */}
      {torchSpots(spec, W, H).map((t, i) => <Torch key={`m${i}`} x={t.x} y={t.y} s={t.s} frame={frame} i={i} />)}
      {spec.isik === "kamp_atesi" ? (
        <g transform={`translate(${W * 0.5} ${stageY(0.9, H)})`}>
          <path d="M-60 0 L60 -14 M-56 -14 L58 0" stroke="#5a3e2a" strokeWidth={14} strokeLinecap="round" />
          {[0, 1, 2].map((k) => {
            const f = 1 + 0.18 * Math.sin(frame * (0.8 + k * 0.3) + k);
            return <path key={k} transform={`translate(${(k - 1) * 22} -6) scale(${1 / f} ${f})`} d="M0 -90 Q36 -40 22 -8 Q0 6 -22 -8 Q-36 -40 0 -90 Z" fill={k === 1 ? "#ffd166" : "#ff8c1a"} {...outline(3)} />;
          })}
        </g>
      ) : null}

      {/* Back fog. */}
      {spec.hava === "sis" ? <Fog W={W} H={H} frame={frame} y={horizon} opacity={0.5} /> : null}
    </g>
  );
}

/** Drifting mist: soft-edged banks (blurred, so they never read as grey stripes) sliding slowly across. */
function Fog({ W, H, frame, y, opacity }: { W: number; H: number; frame: number; y: number; opacity: number }) {
  const id = `ds-fog-${Math.round(y)}`;
  return (
    <g opacity={opacity}>
      <defs>
        <filter id={id} x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="28" />
        </filter>
      </defs>
      <g filter={`url(#${id})`}>
        {[0, 1, 2, 3, 4].map((k) => {
          const x = ((k * W * 0.37 + frame * (0.4 + k * 0.12)) % (W * 1.6)) - W * 0.3;
          return <ellipse key={k} cx={x} cy={y + (k % 3) * 22} rx={W * (0.18 + (k % 2) * 0.08)} ry={34 + (k % 2) * 14} fill="#e6ecf5" opacity={0.6} />;
        })}
      </g>
      <rect x={-W * 0.1} y={y} width={W * 1.2} height={H * 0.08} fill="#dfe6f0" opacity={0.12} filter={`url(#${id})`} />
    </g>
  );
}

/**
 * Over the actors: near fog, rain or snow, the night's grade and the torches' warm light. `covers`: the actors and
 * extras in set space this frame — a torch hidden behind them gives no glow (`flameShown`).
 */
export function DrawnSetFront({ spec, W, H, frame, covers = [] }: { spec: V3DrawnSet; W: number; H: number; frame: number; covers?: readonly SetCover[] }) {
  const r = rng(spec.tohum + 5);
  const lights = lightSpots(spec, W, H, covers).filter((l) => l.a > 0.01);
  // Indoors no rain, snow or ground fog falls on the actors (a tent, a palace, a council hall, a ship's cabin).
  if (spec.manzara === "cadir_ici" || spec.manzara === "saray_ici" || spec.manzara === "meclis" || spec.manzara === "gemi_kamarasi") spec = { ...spec, hava: "acik" };
  // Light enough that the actors keep their colours (the first try at 0.42 turned everyone grey).
  const grade = spec.zaman === "gece" ? { c: "#2a3a78", o: 0.26 } : spec.zaman === "aksam" ? { c: "#b0603a", o: 0.12 } : spec.zaman === "safak" ? { c: "#6a5a9a", o: 0.1 } : undefined;
  return (
    <g>
      <defs>
        <radialGradient id="ds-light">
          <stop offset="0" stopColor="#ffb347" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#ff9a3c" stopOpacity="0.18" />
          <stop offset="1" stopColor="#ff9a3c" stopOpacity="0" />
        </radialGradient>
      </defs>
      {grade ? <rect x={-W * 0.1} y={-H * 0.1} width={W * 1.2} height={H * 1.2} fill={grade.c} opacity={grade.o} style={{ mixBlendMode: "multiply" }} /> : null}
      {lights.map((l, i) => (
        <circle key={i} cx={l.x} cy={l.y} r={l.r * (1 + 0.05 * Math.sin(frame * 0.7 + i * 2))} fill="url(#ds-light)" opacity={l.a} style={{ mixBlendMode: "screen" }} />
      ))}
      {/* Near fog creeps along the ground only: over the feet, never across the faces. */}
      {spec.hava === "sis" ? <Fog W={W} H={H} frame={frame + 400} y={H * 1.0} opacity={0.2} /> : null}
      {spec.hava === "yagmur"
        ? Array.from({ length: 90 }, (_, i) => {
            const x = (r() * W * 1.2 + frame * 6) % (W * 1.2);
            const y = (r() * H + frame * 38) % H;
            return <path key={i} d={`M${x} ${y} l-8 34`} stroke="#c9d6ec" strokeWidth={3} opacity={0.55} strokeLinecap="round" />;
          })
        : null}
      {spec.hava === "kar"
        ? Array.from({ length: 80 }, (_, i) => {
            const x = (r() * W + Math.sin(frame * 0.05 + i) * 30 + W) % W;
            const y = (r() * H + frame * (2 + r() * 2)) % H;
            return <circle key={i} cx={x} cy={y} r={3 + r() * 4} fill="#ffffff" opacity={0.85} />;
          })
        : null}
    </g>
  );
}

/**
 * An actor standing in the river: drawn only above the water line (the river of the set shows below it), with the
 * ripples the body makes at the surface. Character space (feet at 0, head radius 100).
 */
export function InWater({ spec, depth, frame, phase, children }: { spec: V3DrawnSet; depth: number; frame: number; phase: number; children: React.ReactNode }) {
  if (depth <= 0) return <>{children}</>;
  const p = PALETTES[spec.zaman];
  const line = waterLine(depth);
  const wave = 5 * Math.sin(frame * 0.18 + phase);
  const id = `ds-cut-${phase}`;
  return (
    <g>
      <defs>
        <clipPath id={id}>
          <rect x={-900} y={-4000} width={1800} height={4000 + line + 4} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>{children}</g>
      {/* Ripples stay about as wide as the body, so they never spill onto the bank. */}
      <ellipse cx={0} cy={line + 2} rx={120 + wave * 2} ry={18} fill="none" stroke={p.waterLight} strokeWidth={7} opacity={0.85 * depth} />
      <ellipse cx={0} cy={line + 6} rx={165 + wave * 3} ry={26} fill="none" stroke={p.waterLight} strokeWidth={4} opacity={0.4 * depth} />
      <path d={`M-100 ${line + 4} q-24 -14 -46 -5 M100 ${line + 4} q24 -14 46 -5`} fill="none" stroke="#ffffff" strokeWidth={5} strokeLinecap="round" opacity={(0.6 + 0.3 * Math.sin(frame * 0.3 + phase)) * depth} />
    </g>
  );
}
