import React, { useId } from "react";
import type { V3Age, V3Emotion, V3FaceShape, V3Hair, V3Look, V3Nose, V3Viseme } from "../../../src/lib/v3/render/RenderPlanTypes";
import { shade } from "./Garments";
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

function Brow({ side, set, color, width }: { side: 1 | -1; set: { inner: number; outer: number }; color: string; width: number }) {
  const ix = LOOK + side * 14;
  const ox = LOOK + side * 50;
  const mx = (ix + ox) / 2;
  const my = Math.min(set.inner, set.outer) - 8;
  return <path d={`M${ix} ${set.inner} Q${mx} ${my} ${ox} ${set.outer}`} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" />;
}

function Eye({ side, emotion, closed, skin }: { side: 1 | -1; emotion: V3Emotion; closed: number; skin: string }) {
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
          <path d={`M${cx - 18} ${top - 4} L${cx + 18} ${top - 4} L${cx + 18} ${top + cover[1]} L${cx - 18} ${top + cover[0]} Z`} fill={skin} />
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

/**
 * Head outlines for a likeness. Every shape keeps the crown near y = -98 and the temples near x = ±100, so hats and
 * hair parts fit any face; they differ below the eyes (a long chin, heavy jowls, a square jaw). The chin leans a
 * little towards +x, where the face looks.
 */
const FACE_PATHS: Readonly<Record<Exclude<V3FaceShape, "yuvarlak">, string>> = {
  oval: "M0 -100 C60 -100 98 -62 98 -8 C98 56 64 112 6 114 C-56 112 -98 56 -98 -8 C-98 -62 -60 -100 0 -100 Z",
  uzun: "M0 -100 C58 -100 96 -64 96 -12 C96 52 72 120 10 128 C-54 124 -96 58 -96 -12 C-96 -64 -58 -100 0 -100 Z",
  genis: "M0 -98 C60 -98 100 -66 102 -16 C106 28 118 70 98 98 C74 126 -58 128 -88 102 C-114 76 -106 28 -102 -16 C-100 -66 -60 -98 0 -98 Z",
  kare: "M0 -98 C62 -98 100 -64 100 -14 L98 72 C96 102 74 116 40 118 L-28 118 C-70 116 -96 102 -98 72 L-100 -14 C-100 -64 -62 -98 0 -98 Z",
};

function FaceShape({ shape, skin, shadeColor }: { shape: V3FaceShape; skin: string; shadeColor: string }) {
  if (shape === "yuvarlak") {
    return (
      <g>
        <ellipse cx={0} cy={0} rx={102} ry={98} fill={shadeColor} />
        <ellipse cx={8} cy={-8} rx={90} ry={86} fill={skin} />
        <ellipse cx={0} cy={0} rx={102} ry={98} fill="none" stroke={INK} strokeWidth={6.5} />
      </g>
    );
  }
  const d = FACE_PATHS[shape];
  // The lit side of the face: the same outline shrunk towards the upper front.
  return (
    <g>
      <path d={d} fill={shadeColor} />
      <path d={d} fill={skin} transform="translate(9 -7) scale(0.88)" />
      <path d={d} fill="none" stroke={INK} strokeWidth={6.5} strokeLinejoin="round" />
    </g>
  );
}

/** Noses of a likeness, between the eyes (y ≈ -4) and the mouth (y ≈ 46), pointing towards +x. */
function Nose({ kind, skin }: { kind: V3Nose; skin: string }) {
  const line = { fill: "none", stroke: INK, strokeWidth: 4.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "yok":
      return null;
    case "kucuk":
      return <path d="M16 12 Q28 22 16 28" {...line} />;
    case "duz":
      return <path d="M14 -2 L24 24 Q26 31 16 31 L11 30" {...line} />;
    case "iri":
      return <path d="M12 2 Q14 16 22 19 Q36 21 34 31 Q30 39 16 36 Q8 34 9 28" fill={skin} stroke={INK} strokeWidth={4.5} strokeLinejoin="round" />;
    case "kemerli":
      return <path d="M10 -8 Q30 4 32 24 Q33 33 20 33 L12 31" {...line} />;
    case "kalkik":
      return <path d="M14 6 Q18 22 30 21 Q33 28 23 30 L14 29" {...line} />;
  }
}

/**
 * The likeness eye (the reference channel's main characters): a white almond with a small pupil looking ahead and a
 * heavy upper lid, so the face reads as a person rather than a mascot. Emotions move the lids and the pupil.
 */
function DetailedEye({ side, emotion, closed, skin, clip }: { side: 1 | -1; emotion: V3Emotion; closed: number; skin: string; clip: string }) {
  const cx = LOOK + side * 31;
  const cy = -4;
  if (closed > 0.75) {
    return <path d={`M${cx - 15} ${cy + 1} Q${cx} ${cy + 8} ${cx + 15} ${cy + 1}`} fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />;
  }
  const big = emotion === "saskin" || emotion === "korkmus" ? 1.25 : 1;
  const w = 16 * big;
  const top = 13 * big * (1 - closed * 0.8);
  const bottom = 9 * big * (1 - closed * 0.8);
  const almond = `M${cx - w} ${cy} Q${cx} ${cy - top * 1.6} ${cx + w} ${cy} Q${cx} ${cy + bottom * 1.6} ${cx - w} ${cy} Z`;
  const pupil = emotion === "korkmus" ? 3.5 : emotion === "saskin" ? 4.5 : 6;
  // Lid cover from the top of the eye: [back corner, front corner] as a share of the eye's height.
  const cover: readonly [number, number] | undefined =
    emotion === "kizgin" ? (side === 1 ? [0.75, 0.15] : [0.15, 0.75]) : emotion === "kararli" ? [0.45, 0.45] : emotion === "sinsi" ? [0.6, 0.6] : emotion === "uzgun" ? (side === 1 ? [0.1, 0.5] : [0.5, 0.1]) : undefined;
  const h = top + bottom;
  const y0 = cy - top;
  const id = `${clip}${side === 1 ? "f" : "b"}`;
  return (
    <g>
      <defs>
        <clipPath id={id}>
          <path d={almond} />
        </clipPath>
      </defs>
      <path d={almond} fill="#ffffff" />
      <g clipPath={`url(#${id})`}>
        <circle cx={cx + 4} cy={cy + 1} r={pupil} fill={INK} />
        {cover ? <path d={`M${cx - w - 2} ${y0 - 6} L${cx + w + 2} ${y0 - 6} L${cx + w + 2} ${y0 + h * cover[1]} L${cx - w - 2} ${y0 + h * cover[0]} Z`} fill={skin} /> : null}
        {emotion === "mutlu" ? <ellipse cx={cx} cy={cy + bottom * 1.6} rx={w + 2} ry={bottom * 0.9} fill={skin} /> : null}
      </g>
      <path d={almond} fill="none" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      {cover ? (
        <path d={`M${cx - w} ${y0 + h * cover[0]} L${cx + w} ${y0 + h * cover[1]}`} stroke={INK} strokeWidth={5} strokeLinecap="round" />
      ) : (
        <path d={`M${cx - w - 1} ${cy - 1} Q${cx} ${cy - top * 1.7} ${cx + w + 1} ${cy - 1}`} fill="none" stroke={INK} strokeWidth={5.5} strokeLinecap="round" />
      )}
    </g>
  );
}

/** Age lines: bags under the eyes from middle age; forehead lines and cheek folds for the old. */
function AgeLines({ age }: { age: V3Age }) {
  if (age === "genc") return null;
  const line = { fill: "none", stroke: INK, strokeWidth: 2.8, strokeLinecap: "round" as const, opacity: 0.5 };
  return (
    <g>
      {[1, -1].map((side) => {
        const cx = LOOK + side * 31;
        return <path key={side} d={`M${cx - 11} 14 Q${cx} 20 ${cx + 11} 14`} {...line} />;
      })}
      {age === "yasli" ? (
        <g>
          <path d={`M${LOOK - 34} -64 Q${LOOK} -70 ${LOOK + 38} -64`} {...line} />
          <path d={`M${LOOK - 26} -56 Q${LOOK} -61 ${LOOK + 30} -56`} {...line} />
          <path d={`M${LOOK + 38} 26 Q${LOOK + 44} 40 ${LOOK + 38} 52`} {...line} />
          <path d={`M${LOOK - 22} 26 Q${LOOK - 28} 40 ${LOOK - 22} 52`} {...line} />
        </g>
      ) : null}
    </g>
  );
}

export function Head({
  emotion,
  viseme,
  eyesClosed,
  brows: browBlend,
  beard,
  mustache,
  look,
}: {
  emotion: V3Emotion;
  viseme: V3Viseme;
  eyesClosed: number;
  brows?: { from: V3Emotion; to: V3Emotion; mix: number };
  beard?: string;
  mustache?: string;
  look?: V3Look;
}) {
  const clip = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const brows = browBlend && browBlend.mix < 1 ? mixBrows(BROWS[browBlend.from], BROWS[browBlend.to], browBlend.mix) : BROWS[emotion];
  const skin = look?.skin ?? SKIN;
  const skinShade = look?.skin ? shade(look.skin, -0.12) : SKIN_SHADE;
  const brow = { color: look?.browColor ?? INK, width: look?.eyes === "detayli" ? 9 : 10 };
  const detailed = look?.eyes === "detayli";
  return (
    <g>
      <FaceShape shape={look?.faceShape ?? "yuvarlak"} skin={skin} shadeColor={skinShade} />
      {emotion === "mutlu" ? (
        <g opacity={0.28}>
          <ellipse cx={LOOK + 56} cy={24} rx={14} ry={8} fill="#ff7f8f" />
          <ellipse cx={LOOK - 56} cy={24} rx={14} ry={8} fill="#ff7f8f" />
        </g>
      ) : null}
      {look?.age ? <AgeLines age={look.age} /> : null}
      {detailed ? (
        <g>
          <DetailedEye side={1} emotion={emotion} closed={eyesClosed} skin={skin} clip={clip} />
          <DetailedEye side={-1} emotion={emotion} closed={eyesClosed} skin={skin} clip={clip} />
        </g>
      ) : (
        <g>
          <Eye side={1} emotion={emotion} closed={eyesClosed} skin={skin} />
          <Eye side={-1} emotion={emotion} closed={eyesClosed} skin={skin} />
        </g>
      )}
      <Brow side={1} set={brows} color={brow.color} width={brow.width} />
      <Brow side={-1} set={brows.back ?? brows} color={brow.color} width={brow.width} />
      {look?.nose ? <Nose kind={look.nose} skin={skin} /> : null}
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
  const strand = { fill: "none", stroke: INK, strokeWidth: 4, strokeLinecap: "round" as const };
  // Skull cap from the back of the neck over the crown to a hairline above the forehead.
  const cap = "M-104 10 C-118 -70 -60 -114 8 -110 C66 -106 100 -72 100 -34 C84 -52 56 -62 28 -60 C0 -58 -30 -48 -54 -26 C-70 -12 -84 4 -104 10 Z";
  switch (hair.style) {
    case "seyrek":
      // Receding: a bald crown with hair left at the back and over the ear, a thin wisp at the front.
      return (
        <g>
          <path d="M-104 22 C-116 -24 -100 -62 -72 -78 C-64 -52 -66 -20 -74 6 C-82 16 -94 22 -104 22 Z" {...line} />
          <path d="M-20 -98 Q6 -92 24 -100" fill="none" stroke={c} strokeWidth={7} strokeLinecap="round" />
        </g>
      );
    case "kivircik": {
      // Curls: a ring of round tufts along the cap edge, the cap drawn over their inner halves.
      const tufts: [number, number][] = [[-104, 2], [-110, -34], [-98, -70], [-70, -98], [-34, -114], [6, -116], [44, -106], [76, -84], [96, -52]];
      return (
        <g>
          {tufts.map(([x, y]) => (
            <circle key={`${x}${y}`} cx={x} cy={y} r={24} {...line} />
          ))}
          <path d={cap} fill={c} />
          <path d="M-60 -76 q8 -10 16 0 M-10 -92 q8 -10 16 0 M36 -82 q8 -10 16 0" {...strand} />
        </g>
      );
    }
    case "kakul":
      // A fringe: the hairline comes down over the forehead in points.
      return (
        <g>
          <path d="M-104 10 C-118 -70 -60 -114 8 -110 C66 -106 100 -72 100 -30 L82 -40 L74 -24 L58 -42 L44 -26 L32 -46 L16 -30 L4 -50 C-24 -46 -52 -30 -70 -10 C-84 0 -94 6 -104 10 Z" {...line} />
          <path d="M-10 -96 L4 -56 M30 -98 L36 -48 M60 -88 L64 -44" {...strand} />
        </g>
      );
    case "geriye":
      // Combed back: a high, smooth hairline and strands running towards the back of the head.
      return (
        <g>
          <path d="M-104 10 C-118 -74 -56 -116 14 -112 C64 -108 94 -84 96 -60 C70 -70 40 -74 14 -70 C-20 -64 -52 -46 -72 -22 C-86 -6 -96 6 -104 10 Z" {...line} />
          <path d="M70 -78 C30 -96 -20 -96 -70 -66 M60 -90 C20 -106 -30 -102 -84 -56" {...strand} />
        </g>
      );
    default:
      break;
  }
  return (
    <g>
      <path d={cap} {...line} />
      {hair.style === "dalgali" ? <path d="M-80 -70 Q-60 -90 -40 -70 Q-20 -90 0 -72 Q20 -92 40 -74" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" /> : null}
      {hair.style === "yan_ayrik" ? <path d="M30 -104 C20 -86 12 -70 6 -60" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" /> : null}
      {hair.style === "kisa" || hair.style === "yan_ayrik" ? <path d="M-30 -96 Q10 -104 50 -88" fill="none" stroke="#ffffff" strokeWidth={5} strokeLinecap="round" opacity={0.35} /> : null}
    </g>
  );
}
