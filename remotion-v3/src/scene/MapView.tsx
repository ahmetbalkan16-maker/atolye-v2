import React, { useId } from "react";
import { Easing, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { V3CastMember, V3Extra, V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";
import { type AccessoryIndex, Character } from "../character/Character";
import { extraState } from "../character/extras";
import { HEAD_CY, INK } from "../character/rig";

const OCEAN = "#22406a";
const OCEAN_DEEP = "#172e4f";
const LAND = "#cfd9a6";
const LAND_SHADE = "#b9c78d";
const COAST = "#f6f2e4";
const RIVER = "#4f8cc2";
const LABEL_FONT = "'Segoe UI Black', 'Arial Black', sans-serif";
/** How long the camera takes to reach a new view (seconds), and a badge to travel its route. */
const CAMERA_MOVE_S = 1.4;
const BADGE_TRAVEL_S = 3;

type Key = NonNullable<V3GeoMap["camera"]>[number];

/** The camera at a frame: it rests on the last key reached and glides to a new one as its line begins. */
export function cameraAt(keys: readonly Key[] | undefined, frame: number, fps: number, width: number, height: number): { x: number; y: number; zoom: number } {
  if (!keys?.length) return { x: width / 2, y: height / 2, zoom: 1 };
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1]!.frame <= frame) i++;
  const to = keys[i]!;
  const from = keys[Math.max(0, i - 1)]!;
  if (i === 0) return { x: to.x, y: to.y, zoom: to.zoom };
  const t = interpolate(frame, [to.frame, to.frame + fps * CAMERA_MOVE_S], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  // Zoom in log space, so zooming out and in feel equally fast.
  const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * t);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, zoom };
}

/** The point a fraction of the way along a polyline. */
function along(points: readonly { x: number; y: number }[], f: number): { x: number; y: number } {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const seg = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  let rest = Math.max(0, Math.min(1, f)) * seg.reduce((a, b) => a + b, 0);
  for (let i = 0; i < seg.length; i++) {
    if (rest <= seg[i]! || i === seg.length - 1) {
      const u = seg[i]! ? Math.min(1, rest / seg[i]!) : 1;
      return { x: points[i]!.x + (points[i + 1]!.x - points[i]!.x) * u, y: points[i]!.y + (points[i + 1]!.y - points[i]!.y) * u };
    }
    rest -= seg[i]!;
  }
  return points[points.length - 1]!;
}

/**
 * A drawn map in the reference channels' manner: OverSimplified's flat blue sea and green land, or — with a relief
 * image — Hayalhanem's terrain map with see-through state colours. Territories fade in (and out at a border change)
 * with their names, armies pop in, arrows draw themselves, rulers' badges sit on their capitals and travel their
 * routes, battles flash. With a world and camera keys the camera glides from region to region; names, marks and badges
 * keep their size on screen at every zoom. Coordinates arrive in world (or frame) pixels.
 */
export function MapView({ map, width: W, height: H, cast, accessories }: { map: V3GeoMap; width: number; height: number; cast?: ReadonlyMap<string, V3CastMember>; accessories?: AccessoryIndex }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const world = map.world ?? { width: W, height: H };
  const cam = cameraAt(map.camera, frame, fps, W, H);
  // Screen sizes: 1 at 1080p, divided by the zoom so marks keep their size on screen.
  const k = H / 1080 / cam.zoom;
  const relief = Boolean(map.relief);
  const label = (text: string, x: number, y: number, size: number, opacity = 1) => (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" opacity={opacity} style={{ font: `900 ${size * k}px ${LABEL_FONT}`, letterSpacing: 1.5 * k }} fill="#ffffff" stroke={INK} strokeWidth={8 * k} paintOrder="stroke fill" strokeLinejoin="round">
      {text.toLocaleUpperCase("en-US")}
    </text>
  );
  const visible = (start: number, end: number | undefined) => {
    const a = interpolate(frame, [start, start + Math.round(fps * 0.6)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return end === undefined ? a : a * interpolate(frame, [end, end + Math.round(fps * 0.6)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  };
  return (
    <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
      <defs>
        <radialGradient id={`${id}-sea`} cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor={OCEAN} />
          <stop offset="100%" stopColor={OCEAN_DEEP} />
        </radialGradient>
        {/* Territories stay on land. A mask in the world's own coordinates: a clip path inside the moving camera let
            Byzantium's colour spill over the Marmara and the Aegean (map trial, 21 Oct 2026). */}
        <mask id={`${id}-land`} maskUnits="userSpaceOnUse" x={0} y={0} width={world.width} height={world.height}>
          <path d={map.land} fill="#ffffff" fillRule="evenodd" />
        </mask>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill={`url(#${id}-sea)`} />
      <g transform={`translate(${W / 2} ${H / 2}) scale(${cam.zoom}) translate(${-cam.x} ${-cam.y})`}>
        {relief ? (
          <image href={staticFile(map.relief!)} x={0} y={0} width={world.width} height={world.height} preserveAspectRatio="none" />
        ) : (
          <>
            {/* A soft shadow under the land lifts it off the sea. */}
            <path d={map.land} transform={`translate(${5 * k} ${7 * k})`} fill="#0d1b30" opacity={0.35} fillRule="evenodd" />
            <path d={map.land} fill={LAND} fillRule="evenodd" />
          </>
        )}
        <g mask={`url(#${id}-land)`}>
          {relief ? null : <path d={map.land} fill="none" stroke={LAND_SHADE} strokeWidth={26 * k} opacity={0.6} />}
          {map.territories.map((t, i) => {
            const a = visible(t.start, t.end);
            return a > 0 ? <path key={i} d={t.d} fill={t.color} fillOpacity={(relief ? 0.55 : 0.78) * a} stroke="#ffffff" strokeOpacity={a} strokeWidth={(relief ? 3 : 4) * k} strokeLinejoin="round" fillRule="evenodd" /> : null;
          })}
        </g>
        {relief ? null : (
          <>
            <path d={map.lakes} fill={OCEAN} stroke={COAST} strokeWidth={2 * k} fillRule="evenodd" />
            <path d={map.rivers} fill="none" stroke={RIVER} strokeWidth={3 * k} strokeLinecap="round" strokeLinejoin="round" />
            <path d={map.land} fill="none" stroke={COAST} strokeWidth={3.5 * k} strokeLinejoin="round" />
          </>
        )}
        {map.cities.map((c, i) => (
          <g key={`c${i}`}>
            <circle cx={c.x} cy={c.y} r={11 * k} fill="#ffffff" stroke={INK} strokeWidth={5 * k} />
            <text x={c.x + 18 * k} y={c.y + 2 * k} dominantBaseline="middle" style={{ font: `800 ${30 * k}px 'Segoe UI', Arial, sans-serif` }} fill="#ffffff" stroke={INK} strokeWidth={7 * k} paintOrder="stroke fill">
              {c.label}
            </text>
          </g>
        ))}
        {map.territories.map((t, i) => {
          if (t.labelX === undefined || t.labelY === undefined) return null;
          const a = visible(t.start + 6, t.end);
          return a > 0 ? <g key={`tl${i}`}>{label(t.label, t.labelX, t.labelY, 46, a)}</g> : null;
        })}
        {map.armies.map((a, i) => {
          if (frame < a.start) return null;
          const pop = spring({ frame: frame - a.start, fps, config: { damping: 11, stiffness: 200 } });
          return (
            <g key={`a${i}`} transform={`translate(${a.x} ${a.y}) scale(${pop})`}>
              <rect x={-34 * k} y={-22 * k} width={68 * k} height={44 * k} rx={6 * k} fill={a.color} stroke="#ffffff" strokeWidth={5 * k} />
              <path d={`M${-34 * k} ${-22 * k} L${34 * k} ${22 * k} M${34 * k} ${-22 * k} L${-34 * k} ${22 * k}`} stroke="#ffffff" strokeWidth={4 * k} opacity={0.85} />
              <g transform={`translate(0 ${-48 * k})`}>{label(a.label, 0, 0, 30)}</g>
            </g>
          );
        })}
        {map.arrows.map((ar, i) => {
          if (frame < ar.start || ar.points.length < 2) return null;
          const draw = interpolate(frame, [ar.start, ar.start + Math.round(fps * 1.2)], [1, 0], { extrapolateRight: "clamp" });
          // A smooth path through the points (quadratic midpoints), so marches curve like the reference maps.
          const p = ar.points;
          let d = `M${p[0]!.x} ${p[0]!.y}`;
          for (let j = 1; j < p.length - 1; j++) d += ` Q${p[j]!.x} ${p[j]!.y} ${(p[j]!.x + p[j + 1]!.x) / 2} ${(p[j]!.y + p[j + 1]!.y) / 2}`;
          const last = p[p.length - 1]!;
          const prev = p[p.length - 2]!;
          d += ` L${last.x} ${last.y}`;
          const ang = (Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI;
          const mid = p[Math.floor((p.length - 1) / 2)]!;
          return (
            <g key={`r${i}`}>
              <path d={d} fill="none" stroke={INK} strokeWidth={24 * k} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={draw} />
              <path d={d} fill="none" stroke={ar.color} strokeWidth={14 * k} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={draw} />
              {draw < 0.02 ? <path transform={`translate(${last.x} ${last.y}) rotate(${ang})`} d={`M${22 * k} 0 L${-24 * k} ${-28 * k} L${-12 * k} 0 L${-24 * k} ${28 * k} Z`} fill={ar.color} stroke={INK} strokeWidth={5 * k} strokeLinejoin="round" /> : null}
              {ar.label && draw < 0.5 ? <g transform={`translate(${mid.x} ${mid.y - 40 * k})`}>{label(ar.label, 0, 0, 32)}</g> : null}
            </g>
          );
        })}
        {(map.battles ?? []).map((b, i) => {
          if (frame < b.start) return null;
          const pop = spring({ frame: frame - b.start, fps, config: { damping: 9, stiffness: 220 } });
          const flash = interpolate(frame - b.start, [0, Math.round(fps * 0.5)], [1, 0], { extrapolateRight: "clamp" });
          const blade = (rot: number) => (
            <g transform={`rotate(${rot})`}>
              <path d={`M0 ${-46 * k} L${7 * k} ${-36 * k} L${5 * k} ${22 * k} L${-5 * k} ${22 * k} L${-7 * k} ${-36 * k} Z`} fill="#e9edf2" stroke={INK} strokeWidth={4 * k} strokeLinejoin="round" />
              <rect x={-17 * k} y={20 * k} width={34 * k} height={8 * k} rx={3 * k} fill="#c99a2e" stroke={INK} strokeWidth={4 * k} />
              <rect x={-4.5 * k} y={28 * k} width={9 * k} height={20 * k} rx={3 * k} fill="#6b3f1d" stroke={INK} strokeWidth={4 * k} />
            </g>
          );
          return (
            <g key={`b${i}`} transform={`translate(${b.x} ${b.y})`}>
              {flash > 0 ? <circle r={70 * k * (1.4 - flash * 0.4)} fill="#ffd34d" opacity={0.55 * flash} /> : null}
              <g transform={`scale(${pop})`}>
                {blade(-38)}
                {blade(38)}
              </g>
              <g transform={`translate(0 ${-70 * k})`}>{label(b.label, 0, 0, 30, Math.min(1, pop))}</g>
            </g>
          );
        })}
        {(map.badges ?? []).map((b, i) => {
          const a = visible(b.start, b.end);
          const m = cast?.get(b.castId);
          if (a <= 0) return null;
          const at = along(b.path, interpolate(frame, [b.start, b.start + fps * BADGE_TRAVEL_S], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) }));
          const r = 48 * k;
          const pop = spring({ frame: frame - b.start, fps, config: { damping: 12, stiffness: 180 } });
          // The head (radius 100, centre HEAD_CY in character space) fills the ring with the shoulders below it.
          const s = (r * 0.62) / 100;
          const extra: V3Extra = { castId: b.castId, x: 0, depth: 0, facing: "right", scale: 1, mood: "notr", seed: i * 97 + 13 };
          // A pin: the badge stands above its place with a point down to it and the name plate on top, so the place's
          // own name and the territory's stay readable (the map trial's badge sat on "Söğüt" and "OTTOMANS").
          const cy = -(r + 34 * k);
          return (
            <g key={`g${i}`} transform={`translate(${at.x} ${at.y}) scale(${pop})`} opacity={a}>
              <defs>
                <clipPath id={`${id}-badge${i}`}>
                  <circle cy={cy} r={r} />
                </clipPath>
              </defs>
              <path d={`M${-14 * k} ${cy + r} L0 0 L${14 * k} ${cy + r} Z`} fill="#ffffff" stroke={INK} strokeWidth={4 * k} strokeLinejoin="round" />
              <circle cy={cy} r={r + 6 * k} fill="#ffffff" stroke={INK} strokeWidth={5 * k} />
              <circle cy={cy} r={r} fill="#d9c9a3" />
              {m && accessories ? (
                <g clipPath={`url(#${id}-badge${i})`}>
                  <g transform={`translate(0 ${cy - HEAD_CY * s + r * 0.18}) scale(${s})`}>
                    <Character member={m} state={extraState(extra, frame, fps)} accessories={accessories} cheap />
                  </g>
                </g>
              ) : null}
              <g transform={`translate(0 ${cy - r - 28 * k})`}>
                <rect x={(-b.label.length * 9 - 18) * k} y={-17 * k} width={(b.label.length * 18 + 36) * k} height={34 * k} rx={6 * k} fill="#2a1f14" stroke="#c99a2e" strokeWidth={3 * k} />
                <text x={0} y={1 * k} textAnchor="middle" dominantBaseline="middle" style={{ font: `800 ${22 * k}px 'Segoe UI', Arial, sans-serif` }} fill="#f6e7c1">
                  {b.label}
                </text>
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
