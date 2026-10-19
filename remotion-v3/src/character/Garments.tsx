import React from "react";
import type { V3CharacterStyle, V3Costume, V3Garment } from "../../../src/lib/v3/render/RenderPlanTypes";
import { HIP_X, HIP_Y, INK, INK_W, type Point, type Pose, SHIN, solveLimb, THIGH } from "./rig";

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const STEEL = "#a7b0bc";
const ROBES: readonly V3Garment[] = ["kaftan", "cubbe", "bizans"];
export const isRobe = (g: V3Garment) => ROBES.includes(g);

/** Width (units) of the sleeve for each garment; robes have wide sleeves. */
export function sleeveFor(costume: V3Costume): { color: string; width: number; cuff?: string } {
  switch (costume.garment) {
    case "kaftan":
    case "cubbe":
      return { color: costume.colors.main, width: 40, cuff: costume.colors.trim };
    case "bizans":
      return { color: costume.colors.main, width: 38, cuff: costume.colors.trim };
    case "zirh":
      return { color: shade(STEEL, -0.12), width: 32, cuff: costume.colors.trim };
    case "onluk":
      return { color: costume.colors.inner, width: 30 };
    case "yeniceri":
      return { color: costume.colors.main, width: 34, cuff: costume.colors.second };
    case "sade":
      return { color: costume.colors.main, width: 30 };
  }
}

const outlined = (d: string, fill: string, w = INK_W) => <path d={d} fill={fill} stroke={INK} strokeWidth={w} strokeLinejoin="round" strokeLinecap="round" />;

/** Ermine fur: white band with black tail spots, as on the sultan's robe in the owner's reference. */
function FurStrip({ from, to, width }: { from: Point; to: Point; width: number }) {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  const spots: React.ReactNode[] = [];
  for (let i = 18, k = 0; i < len - 10; i += 30, k++) {
    const off = k % 2 === 0 ? -width * 0.18 : width * 0.18;
    spots.push(<path key={i} d={`M${i} ${off - 4} q3 6 0 9 q-3 -3 0 -9z`} fill={INK} />);
  }
  return (
    <g transform={`translate(${from.x} ${from.y}) rotate(${angle})`}>
      <rect x={-2} y={-width / 2} width={len + 4} height={width} rx={width / 2} fill="#fffdf7" stroke={INK} strokeWidth={4.5} />
      {spots}
    </g>
  );
}

function Tulip({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <path
      d={`M${x} ${y + 12} C${x - 2} ${y + 4} ${x - 10} ${y - 2} ${x - 8} ${y - 12} C${x - 4} ${y - 8} ${x - 2} ${y - 10} ${x} ${y - 14} C${x + 2} ${y - 10} ${x + 4} ${y - 8} ${x + 8} ${y - 12} C${x + 10} ${y - 2} ${x + 2} ${y + 4} ${x} ${y + 12} Z`}
      fill={color}
      opacity={0.9}
    />
  );
}

/** Robe silhouette from the shoulders to `hem`; `k` narrows it for the stick style. */
function robePath(hem: number, k: number, flare: number): string {
  const sx = 88 * k, hx = (98 + flare) * k, nx = 58 * k;
  return `M${-nx} -334 C${-sx + 8} -330 ${-sx + 2} -318 ${-sx} -300 C${-sx - 4} -230 ${-hx + 4} ${hem - 90} ${-hx} ${hem} Q0 ${hem + 14} ${hx} ${hem} C${hx - 4} ${hem - 90} ${sx + 4} -230 ${sx} -300 C${sx - 2} -318 ${sx - 8} -330 ${nx} -334 Q0 -318 ${-nx} -334 Z`;
}

export function GarmentBody({ costume, style, seated }: { costume: V3Costume; style: V3CharacterStyle; seated: boolean }) {
  const c = costume.colors;
  const k = style === "cop" ? 0.62 : 1;
  const parts: React.ReactNode[] = [];
  if (style === "cop") parts.push(<path key="spine" d="M0 -336 L0 -150" stroke={INK} strokeWidth={12} strokeLinecap="round" />);

  switch (costume.garment) {
    case "kaftan":
    case "cubbe":
    case "bizans": {
      const hem = style === "cop" ? -96 : seated ? -126 : -24;
      const flare = costume.garment === "bizans" ? 2 : costume.garment === "cubbe" ? 8 : 6;
      const robe = robePath(hem, k, flare);
      if (costume.garment === "bizans" && style === "kukla") {
        // Imperial cape (chlamys) behind the robe.
        parts.push(<g key="cape">{outlined(`M-70 -330 C-150 -250 -150 -100 -132 ${hem + 6} Q0 ${hem + 24} 132 ${hem + 6} C150 -100 150 -250 70 -330 Z`, c.second)}</g>);
      }
      parts.push(<g key="robe">{outlined(robe, c.main)}</g>);
      // Volume: a darker side panel.
      parts.push(<path key="shade" d={`M${-62 * k} -300 C${-70 * k} -220 ${-80 * k} -110 ${-86 * k} ${hem - 4} L${-60 * k} ${hem + 4} C${-56 * k} -110 ${-50 * k} -220 ${-46 * k} -300 Z`} fill={shade(c.main, -0.18)} />);
      const ow = costume.garment === "cubbe" ? 16 : 24;
      const inner = `M${-ow * k} -330 L${ow * k} -330 L${(ow + 12) * k} ${hem + 4} Q0 ${hem + 10} ${-(ow + 12) * k} ${hem + 4} Z`;
      parts.push(<g key="inner">{outlined(inner, c.inner, 4)}</g>);
      if (costume.garment === "bizans") {
        // Loros: jewelled band across the chest and down the front.
        parts.push(<path key="loros" d={`M${60 * k} -322 L${-46 * k} -236 L${-14 * k} -236 L${-14 * k} ${hem + 2} L${14 * k} ${hem + 2} L${14 * k} -250 L${80 * k} -300 Z`} fill={c.trim} stroke={INK} strokeWidth={4} strokeLinejoin="round" />);
        for (let y = -220; y < hem - 10; y += 34) parts.push(<rect key={`g${y}`} x={-6 * k} y={y} width={12 * k} height={12} rx={3} fill={c.inner} stroke={INK} strokeWidth={2.5} />);
        for (let i = 0; i < 4; i++) parts.push(<circle key={`gd${i}`} cx={(42 - i * 26) * k} cy={-308 + i * 22} r={5} fill={c.inner} stroke={INK} strokeWidth={2} />);
      } else if (costume.collar === "kurk" && style === "kukla") {
        parts.push(<FurStrip key="furL" from={{ x: -28, y: -322 }} to={{ x: -42, y: hem - 2 }} width={26} />);
        parts.push(<FurStrip key="furR" from={{ x: 28, y: -322 }} to={{ x: 42, y: hem - 2 }} width={26} />);
        parts.push(<path key="collar" d="M-86 -306 C-70 -350 70 -350 86 -306 C60 -318 -60 -318 -86 -306 Z" fill="#fffdf7" stroke={INK} strokeWidth={4.5} />);
      } else {
        parts.push(<path key="trimL" d={`M${-ow * k} -326 L${-(ow + 11) * k} ${hem}`} stroke={c.trim} strokeWidth={6} strokeLinecap="round" />);
        parts.push(<path key="trimR" d={`M${ow * k} -326 L${(ow + 11) * k} ${hem}`} stroke={c.trim} strokeWidth={6} strokeLinecap="round" />);
      }
      parts.push(<path key="hem" d={`M${-94 * k} ${hem - 16} Q0 ${hem - 2} ${94 * k} ${hem - 16}`} fill="none" stroke={c.trim} strokeWidth={7} strokeLinecap="round" />);
      if (costume.garment !== "bizans" && style === "kukla" && !seated) {
        parts.push(<Tulip key="t1" x={-64} y={-104} color={c.trim} />, <Tulip key="t2" x={64} y={-104} color={c.trim} />);
      }
      if (costume.garment !== "bizans") {
        parts.push(<g key="belt">{outlined(`M${-91 * k} -216 L${91 * k} -216 L${92 * k} -192 L${-92 * k} -192 Z`, c.second, 4.5)}</g>);
        parts.push(<circle key="buckle" cx={0} cy={-204} r={11} fill={c.trim} stroke={INK} strokeWidth={4} />, <circle key="gem" cx={0} cy={-204} r={5} fill="#c62839" />);
      }
      break;
    }
    case "zirh": {
      parts.push(<g key="skirt">{outlined(`M${-76 * k} -178 L${76 * k} -178 L${90 * k} -92 Q0 -82 ${-90 * k} -92 Z`, c.main)}</g>);
      for (let i = -2; i <= 2; i++) parts.push(<path key={`s${i}`} d={`M${i * 30 * k} -174 L${i * 36 * k} -94`} stroke={shade(c.main, -0.3)} strokeWidth={3} />);
      parts.push(<g key="cuirass">{outlined(`M${-66 * k} -332 Q${-86 * k} -322 ${-86 * k} -296 L${-78 * k} -172 Q0 -152 ${78 * k} -172 L${86 * k} -296 Q${86 * k} -322 ${66 * k} -332 Q0 -316 ${-66 * k} -332 Z`, STEEL)}</g>);
      for (const y of [-280, -248, -216, -188]) parts.push(<path key={`l${y}`} d={`M${-78 * k} ${y} Q0 ${y + 14} ${78 * k} ${y}`} fill="none" stroke={shade(STEEL, -0.35)} strokeWidth={3} />);
      parts.push(<path key="shine" d={`M${18 * k} -312 Q${40 * k} -260 ${30 * k} -200`} fill="none" stroke="#ffffff" strokeWidth={6} strokeLinecap="round" opacity={0.55} />);
      parts.push(<path key="trim" d={`M${-66 * k} -330 Q0 -314 ${66 * k} -330`} fill="none" stroke={c.trim} strokeWidth={7} strokeLinecap="round" />);
      parts.push(<path key="belt" d={`M${-80 * k} -176 Q0 -160 ${80 * k} -176`} fill="none" stroke={c.trim} strokeWidth={9} strokeLinecap="round" />);
      break;
    }
    case "onluk": {
      parts.push(<g key="shirt">{outlined(`M${-58 * k} -334 C${-80 * k} -330 ${-86 * k} -318 ${-86 * k} -300 L${-80 * k} -150 Q0 -138 ${80 * k} -150 L${86 * k} -300 C${86 * k} -318 ${80 * k} -330 ${58 * k} -334 Q0 -318 ${-58 * k} -334 Z`, c.inner)}</g>);
      parts.push(<g key="apron">{outlined(`M${-48 * k} -296 L${48 * k} -296 L${66 * k} -64 Q0 -54 ${-66 * k} -64 Z`, c.main)}</g>);
      parts.push(<path key="strap" d={`M${-48 * k} -296 Q0 -360 ${48 * k} -296`} fill="none" stroke={shade(c.main, -0.3)} strokeWidth={6} />);
      parts.push(<g key="pocket">{outlined(`M${-26 * k} -170 L${26 * k} -170 L${24 * k} -128 L${-24 * k} -128 Z`, shade(c.main, -0.15), 3.5)}</g>);
      parts.push(<path key="tie" d={`M${-62 * k} -206 Q0 -196 ${62 * k} -206`} fill="none" stroke={c.trim} strokeWidth={6} />);
      break;
    }
    case "yeniceri": {
      parts.push(<g key="coat">{outlined(robePath(-64, k, 0), c.main)}</g>);
      parts.push(<g key="inner">{outlined(`M${-20 * k} -330 L${20 * k} -330 L${28 * k} -66 L${-28 * k} -66 Z`, c.inner, 4)}</g>);
      parts.push(<g key="belt">{outlined(`M${-90 * k} -214 L${90 * k} -214 L${92 * k} -186 L${-92 * k} -186 Z`, c.second, 4.5)}</g>);
      parts.push(<path key="flap" d={`M${-30 * k} -186 L${-60 * k} -80 L${-24 * k} -86 Z`} fill={shade(c.main, -0.2)} stroke={INK} strokeWidth={4} strokeLinejoin="round" />);
      break;
    }
    case "sade": {
      parts.push(<g key="tunic">{outlined(robePath(-92, k, -8), c.main)}</g>);
      parts.push(<path key="rope" d={`M${-84 * k} -200 Q0 -188 ${84 * k} -200`} fill="none" stroke={c.second} strokeWidth={8} strokeLinecap="round" />);
      break;
    }
  }
  return <g>{parts}</g>;
}

/** Legs and shoes. Under a robe only the shoes peek out; other garments show trousers. */
export function Legs({ costume, pose, style, seated }: { costume: V3Costume; pose: Pose; style: V3CharacterStyle; seated: boolean }) {
  const robe = isRobe(costume.garment) && style === "kukla" && !seated;
  const trouser = costume.garment === "zirh" ? shade(costume.colors.inner, 0) : costume.colors.inner;
  const limbs = ([[-1, pose.legBack, pose.liftBack], [1, pose.legFront, pose.liftFront]] as const).map(([side, angles, lift]) => {
    const j = solveLimb({ x: side * HIP_X, y: HIP_Y }, angles, [THIGH, SHIN], side);
    return { side, j, foot: { x: j.end.x, y: Math.min(0, j.end.y - lift) } };
  });
  return (
    <g>
      {limbs.map(({ side, j, foot }) => {
        const d = `M${j.root.x} ${j.root.y} L${j.mid.x} ${j.mid.y} L${foot.x} ${foot.y - 8}`;
        return (
          <g key={side}>
            {style === "cop" ? (
              <path d={d} fill="none" stroke={INK} strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
            ) : robe ? null : (
              <g>
                <path d={d} fill="none" stroke={INK} strokeWidth={30 + 2 * INK_W} strokeLinecap="round" strokeLinejoin="round" />
                <path d={d} fill="none" stroke={trouser} strokeWidth={30} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )}
            <Shoe kind={costume.shoes} at={foot} style={style} />
          </g>
        );
      })}
    </g>
  );
}

function Shoe({ kind, at, style }: { kind: string; at: Point; style: V3CharacterStyle }) {
  if (style === "cop") return <ellipse cx={at.x + 8} cy={at.y - 5} rx={16} ry={7} fill={INK} />;
  const color = kind.startsWith("sari") ? "#f2b632" : kind.startsWith("kirmizi") ? "#b8283a" : kind.startsWith("kahve") ? "#6b4428" : kind.startsWith("mor") ? "#5e2a74" : "#2a2630";
  const boot = kind.endsWith("cizme");
  const d = boot
    ? "M-14 -46 L12 -46 L14 -16 Q30 -16 36 -6 Q37 2 28 2 L-15 2 Z"
    : "M-15 -1 Q-18 -16 0 -16 Q16 -16 28 -9 Q36 -10 41 -20 Q44 -2 30 2 L-14 2 Z";
  return (
    <g transform={`translate(${at.x} ${at.y})`}>
      <path d={d} fill={color} stroke={INK} strokeWidth={4.5} strokeLinejoin="round" />
      <path d={boot ? "M-10 -38 L10 -38" : "M-8 -9 Q6 -12 18 -8"} stroke="#ffffff" strokeWidth={3} strokeLinecap="round" opacity={0.45} />
    </g>
  );
}
