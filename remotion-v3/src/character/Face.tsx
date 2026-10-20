import React, { useId } from "react";
import { staticFile } from "remotion";
import type { V3Emotion, V3Face, V3Hair, V3Viseme } from "../../../src/lib/v3/render/RenderPlanTypes";
import { INK, SKIN, SKIN_SHADE } from "./rig";

/** Head-local space: origin at the head centre, head radius 100, facing +x. */
const LOOK = 10;
const MOUTH_INSIDE = "#6e1a26";
const TONGUE = "#e46e7e";
const TEETH = "#ffffff";

interface BrowSet {
  readonly inner: number;
  readonly outer: number;
  /** Optional different set for the back brow (asymmetric expressions). */
  readonly back?: { readonly inner: number; readonly outer: number };
}

const BROWS: Record<V3Emotion, BrowSet> = {
  notr: { inner: -42, outer: -46 },
  mutlu: { inner: -50, outer: -48 },
  kizgin: { inner: -30, outer: -52 },
  saskin: { inner: -60, outer: -56 },
  korkmus: { inner: -58, outer: -42 },
  uzgun: { inner: -54, outer: -38 },
  kararli: { inner: -33, outer: -46 },
  sinsi: { inner: -54, outer: -52, back: { inner: -33, outer: -40 } },
};

/** Brows between two expressions (t 0..1), back brow included, so a change of mood slides instead of jumping. */
function mixBrows(a: BrowSet, b: BrowSet, t: number): BrowSet {
  const m = (x: number, y: number) => x + (y - x) * t;
  const ab = a.back ?? a, bb = b.back ?? b;
  return { inner: m(a.inner, b.inner), outer: m(a.outer, b.outer), back: { inner: m(ab.inner, bb.inner), outer: m(ab.outer, bb.outer) } };
}

function Brow({ side, set }: { side: 1 | -1; set: { inner: number; outer: number } }) {
  const ix = LOOK + side * 14;
  const ox = LOOK + side * 50;
  const mx = (ix + ox) / 2;
  const my = Math.min(set.inner, set.outer) - 8;
  return <path d={`M${ix} ${set.inner} Q${mx} ${my} ${ox} ${set.outer}`} fill="none" stroke={INK} strokeWidth={10} strokeLinecap="round" />;
}

function Eye({ side, emotion, closed }: { side: 1 | -1; emotion: V3Emotion; closed: number }) {
  const cx = LOOK + side * 31;
  const cy = -4;
  if (closed > 0.75) {
    return <path d={`M${cx - 13} ${cy + 2} Q${cx} ${cy + 9} ${cx + 13} ${cy + 2}`} fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" />;
  }
  if (emotion === "korkmus") {
    return (
      <g>
        <ellipse cx={cx} cy={cy} rx={15} ry={19 * (1 - closed * 0.7)} fill={TEETH} stroke={INK} strokeWidth={4.5} />
        <circle cx={cx + 2} cy={cy + 1} r={6} fill={INK} />
      </g>
    );
  }
  const big = emotion === "saskin" ? 1.22 : emotion === "mutlu" ? 0.95 : 1;
  const rx = 11 * big;
  const ry = 17 * big * (1 - closed * 0.8);
  // Lids: a skin-coloured cut over the top of the eye gives squint/half-lidded looks.
  // [cover at the left edge, cover at the right edge], measured down from the top of the eye.
  const cover: readonly [number, number] | undefined =
    emotion === "kizgin" ? (side === 1 ? [18, 4] : [4, 18]) : emotion === "kararli" ? [13, 13] : emotion === "sinsi" ? [19, 19] : undefined;
  const top = cy - 22;
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={INK} />
      <circle cx={cx + 3.5} cy={cy - ry * 0.42} r={4.2 * big} fill="#ffffff" />
      {cover ? (
        <g>
          <path d={`M${cx - 18} ${top - 4} L${cx + 18} ${top - 4} L${cx + 18} ${top + cover[1]} L${cx - 18} ${top + cover[0]} Z`} fill={SKIN} />
          <path d={`M${cx - 15} ${top + cover[0] - 1} L${cx + 15} ${top + cover[1] - 1}`} stroke={INK} strokeWidth={4.5} strokeLinecap="round" />
        </g>
      ) : null}
    </g>
  );
}

function openMouth(w: number, h: number, opts: { teeth?: number; tongue?: number; tongueUp?: boolean }) {
  const top = -h * 0.35;
  const bottom = h * 0.65;
  const d = `M${-w / 2} ${top} Q0 ${top - 4} ${w / 2} ${top} Q${w / 2 + 2} ${bottom} 0 ${bottom} Q${-w / 2 - 2} ${bottom} ${-w / 2} ${top} Z`;
  const clipId = `m${w}x${h}${opts.teeth ?? 0}${opts.tongue ?? 0}${opts.tongueUp ? "u" : ""}`.replace(/\./g, "_");
  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <path d={d} />
        </clipPath>
      </defs>
      <path d={d} fill={MOUTH_INSIDE} />
      <g clipPath={`url(#${clipId})`}>
        {opts.teeth ? <rect x={-w / 2} y={top - 6} width={w} height={opts.teeth + 6} fill={TEETH} /> : null}
        {opts.tongue ? <ellipse cx={0} cy={opts.tongueUp ? top + h * 0.3 : bottom} rx={w * 0.32} ry={opts.tongue} fill={TONGUE} /> : null}
      </g>
      <path d={d} fill="none" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
    </g>
  );
}

function Mouth({ viseme, emotion }: { viseme: V3Viseme; emotion: V3Emotion }) {
  switch (viseme) {
    case "A":
      return <path d="M-20 0 Q0 5 20 0" fill="none" stroke={INK} strokeWidth={5.5} strokeLinecap="round" />;
    case "B":
      return openMouth(40, 15, { teeth: 5 });
    case "C":
      return openMouth(42, 25, { teeth: 4, tongue: 6 });
    case "D":
      return openMouth(50, 40, { teeth: 6, tongue: 10 });
    case "E":
      return openMouth(34, 28, { tongue: 7 });
    case "F":
      return (
        <g>
          <ellipse cx={0} cy={4} rx={10} ry={10} fill={MOUTH_INSIDE} stroke={INK} strokeWidth={6} />
        </g>
      );
    case "G":
      return openMouth(38, 17, { teeth: 9 });
    case "H":
      return openMouth(42, 30, { tongue: 8, tongueUp: true });
    case "X":
      break;
  }
  switch (emotion) {
    case "mutlu":
      return (
        <g>
          <path d="M-28 -6 Q0 -1 28 -6 Q24 26 0 28 Q-24 26 -28 -6 Z" fill={MOUTH_INSIDE} />
          <path d="M-16 20 Q0 10 16 20 Q8 28 0 28 Q-8 28 -16 20 Z" fill={TONGUE} />
          <path d="M-28 -6 Q0 -1 28 -6 Q24 26 0 28 Q-24 26 -28 -6 Z" fill="none" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
        </g>
      );
    case "kizgin":
      return (
        <g>
          <path d="M-22 6 Q0 -4 22 6 L20 16 Q0 10 -20 16 Z" fill={TEETH} stroke={INK} strokeWidth={4.5} strokeLinejoin="round" />
          <path d="M-20 11 L20 11" stroke={INK} strokeWidth={2.5} />
        </g>
      );
    case "saskin":
      return <ellipse cx={0} cy={6} rx={11} ry={14} fill={MOUTH_INSIDE} stroke={INK} strokeWidth={5} />;
    case "korkmus":
      return <path d="M-22 6 Q-14 0 -7 6 Q0 12 7 6 Q14 0 22 6" fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />;
    case "uzgun":
      return <path d="M-20 12 Q0 -4 20 12" fill="none" stroke={INK} strokeWidth={5.5} strokeLinecap="round" />;
    case "kararli":
      return <path d="M-18 4 Q2 6 20 0" fill="none" stroke={INK} strokeWidth={5.5} strokeLinecap="round" />;
    case "sinsi":
      return <path d="M-18 2 Q4 8 22 -6" fill="none" stroke={INK} strokeWidth={5.5} strokeLinecap="round" />;
    case "notr":
      return <path d="M-18 0 Q0 10 18 0" fill="none" stroke={INK} strokeWidth={5.5} strokeLinecap="round" />;
  }
}

export function Head({
  emotion,
  viseme,
  eyesClosed,
  brows: browBlend,
  beard,
  mustache,
}: {
  emotion: V3Emotion;
  viseme: V3Viseme;
  eyesClosed: number;
  brows?: { from: V3Emotion; to: V3Emotion; mix: number };
  beard?: string;
  mustache?: string;
}) {
  const brows = browBlend && browBlend.mix < 1 ? mixBrows(BROWS[browBlend.from], BROWS[browBlend.to], browBlend.mix) : BROWS[emotion];
  return (
    <g>
      <ellipse cx={0} cy={0} rx={102} ry={98} fill={SKIN_SHADE} />
      <ellipse cx={8} cy={-8} rx={90} ry={86} fill={SKIN} />
      <ellipse cx={0} cy={0} rx={102} ry={98} fill="none" stroke={INK} strokeWidth={6.5} />
      {emotion === "mutlu" ? (
        <g opacity={0.28}>
          <ellipse cx={LOOK + 56} cy={24} rx={14} ry={8} fill="#ff7f8f" />
          <ellipse cx={LOOK - 56} cy={24} rx={14} ry={8} fill="#ff7f8f" />
        </g>
      ) : null}
      <Eye side={1} emotion={emotion} closed={eyesClosed} />
      <Eye side={-1} emotion={emotion} closed={eyesClosed} />
      <Brow side={1} set={brows} />
      <Brow side={-1} set={brows.back ?? brows} />
      {beard ? <g dangerouslySetInnerHTML={{ __html: beard }} /> : null}
      <g transform={`translate(${LOOK - 2} 46)`}>
        <Mouth viseme={viseme} emotion={emotion} />
      </g>
      {mustache ? <g dangerouslySetInnerHTML={{ __html: mustache }} /> : null}
    </g>
  );
}

/**
 * Parametric hair for characters without headwear (or with a hat that leaves it showing): the back layer is drawn
 * behind the head, the cap over the skull. The face looks towards +x, so the hairline sits higher at the front.
 */
export function HairBack({ hair }: { hair: V3Hair }) {
  const c = hair.color;
  const line = { fill: c, stroke: INK, strokeWidth: 6, strokeLinejoin: "round" as const };
  switch (hair.style) {
    case "uzun":
      return <path d="M-96 -40 C-130 40 -126 150 -96 196 Q-40 214 -10 190 C-30 140 -40 60 -20 0 Z" {...line} />;
    case "orgu":
      return (
        <g>
          <path d="M-96 -30 C-118 30 -110 90 -84 120 L-50 110 C-60 60 -50 10 -30 -10 Z" {...line} />
          {[0, 1, 2, 3].map((i) => (
            <ellipse key={i} cx={-74 + i * 2} cy={130 + i * 34} rx={20} ry={20} {...line} />
          ))}
        </g>
      );
    case "topuz":
      return <circle cx={-78} cy={-74} r={38} {...line} />;
    default:
      return null;
  }
}

export function HairTop({ hair }: { hair: V3Hair }) {
  if (hair.style === "kel") return null;
  const c = hair.color;
  const line = { fill: c, stroke: INK, strokeWidth: 6, strokeLinejoin: "round" as const };
  // Skull cap from the back of the neck over the crown to a hairline above the forehead.
  const cap = "M-104 10 C-118 -70 -60 -114 8 -110 C66 -106 100 -72 100 -34 C84 -52 56 -62 28 -60 C0 -58 -30 -48 -54 -26 C-70 -12 -84 4 -104 10 Z";
  return (
    <g>
      <path d={cap} {...line} />
      {hair.style === "dalgali" ? <path d="M-80 -70 Q-60 -90 -40 -70 Q-20 -90 0 -72 Q20 -92 40 -74" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" /> : null}
      {hair.style === "yan_ayrik" ? <path d="M30 -104 C20 -86 12 -70 6 -60" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" /> : null}
      {hair.style === "kisa" || hair.style === "yan_ayrik" ? <path d="M-30 -96 Q10 -104 50 -88" fill="none" stroke="#ffffff" strokeWidth={5} strokeLinecap="round" opacity={0.35} /> : null}
    </g>
  );
}

/** How far the jaw drops for each mouth shape (0 closed .. 1 wide open). */
const JAW_OPEN: Readonly<Record<V3Viseme, number>> = { X: 0, A: 0, B: 0.3, C: 0.65, D: 1, E: 0.55, F: 0.35, G: 0.2, H: 0.45 };

/**
 * A portrait face on the puppet head: the photo clipped to the head oval, split at the mouth line; the lower part
 * drops with the speech (a dark mouth shows in the gap), the classic cut-out puppet. The ink outline follows both
 * halves. Head size and coordinates are the drawn head's (rx 102, ry 98), so hats and the body fit unchanged.
 */
export function PhotoHead({ face, viseme }: { face: V3Face; viseme: V3Viseme }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const RX = 102, RY = 98;
  const my = -RY + face.mouthY * 2 * RY;
  const mx = -RX + face.mouthX * 2 * RX;
  const drop = JAW_OPEN[viseme] * 15;
  const half = RX * Math.sqrt(Math.max(0, 1 - (my / RY) ** 2));
  // Below the centre the upper part is the larger arc of the oval (large-arc flag), above it the smaller.
  const big = my > 0 ? 1 : 0;
  const upperArc = `M${-half} ${my} A${RX} ${RY} 0 ${big} 1 ${half} ${my}`;
  const lowerArc = `M${half} ${my} A${RX} ${RY} 0 ${1 - big} 1 ${-half} ${my}`;
  // The jaw's clip starts 2 units above the mouth line, so no seam shows while the mouth is closed.
  const ml = my - 2;
  const halfL = RX * Math.sqrt(Math.max(0, 1 - (ml / RY) ** 2));
  const jawClip = `M${halfL} ${ml} A${RX} ${RY} 0 ${ml > 0 ? 0 : 1} 1 ${-halfL} ${ml} Z`;
  const src = staticFile(face.src);
  return (
    <g>
      <defs>
        <clipPath id={`${id}-u`}>
          <path d={`${upperArc} Z`} />
        </clipPath>
        <clipPath id={`${id}-l`}>
          <path d={jawClip} />
        </clipPath>
      </defs>
      <ellipse cx={0} cy={0} rx={RX} ry={RY} fill={SKIN_SHADE} />
      {drop > 0.5 ? <ellipse cx={mx} cy={my + drop / 2} rx={RX * 0.3} ry={drop / 2 + 3} fill="#3a1418" stroke={INK} strokeWidth={3} /> : null}
      <g clipPath={`url(#${id}-u)`}>
        <image href={src} x={-RX} y={-RY} width={2 * RX} height={2 * RY} preserveAspectRatio="none" />
      </g>
      <g transform={`translate(0 ${drop})`}>
        <g clipPath={`url(#${id}-l)`}>
          <image href={src} x={-RX} y={-RY} width={2 * RX} height={2 * RY} preserveAspectRatio="none" />
        </g>
        <path d={lowerArc} fill="none" stroke={INK} strokeWidth={6.5} strokeLinecap="round" />
      </g>
      <path d={upperArc} fill="none" stroke={INK} strokeWidth={6.5} strokeLinecap="round" />
    </g>
  );
}
