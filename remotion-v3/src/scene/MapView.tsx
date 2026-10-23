import React, { useId } from "react";
import { Easing, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { V3CastMember, V3Extra, V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";
import { type AccessoryIndex, Character } from "../character/Character";
import { extraState } from "../character/extras";
import { HEAD_CY, INK } from "../character/rig";
import { along, pathLength, smoothPoints } from "./mapGeometry";
import { BattleBursts, UnitTokens } from "./MapUnits";
import { CloseGround } from "./MapCloseGround";
import { MapVehicles } from "./MapVehicles";

const OCEAN = "#22406a";
const OCEAN_DEEP = "#172e4f";
const LAND = "#cfd9a6";
const LAND_SHADE = "#b9c78d";
const COAST = "#f6f2e4";
const RIVER = "#4f8cc2";
const LABEL_FONT = "'Segoe UI Black', 'Arial Black', sans-serif";
/** State names on the relief map: tall condensed capitals like the reference channel's (Windows' Bahnschrift). */
const STATE_FONT = "'Bahnschrift', 'Arial Narrow', sans-serif";

/** Campaign routes and trails on the relief map, and the badges' parchment (the reference maps' look). */
const ROUTE_RED = "#d7263d";
const PARCHMENT = "#f1e0b5";
const SEPIA = "#5a3d1a";

/** The part of a polyline from its start to a fraction of its length, as an SVG path (a travelling badge's trail). */
function partialPath(points: readonly { x: number; y: number }[], f: number): string {
  const end = along(points, f);
  let rest = Math.max(0, Math.min(1, f)) * pathLength(points);
  let d = `M${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    if (rest <= seg) break;
    d += ` L${points[i]!.x} ${points[i]!.y}`;
    rest -= seg;
  }
  return `${d} L${end.x} ${end.y}`;
}

/** The polyline from its start to a fraction of its length (a growing arrow's body). */
function partialPoints(points: readonly { x: number; y: number }[], f: number): { x: number; y: number }[] {
  if (points.length < 2) return [...points];
  const out = [points[0]!];
  let rest = Math.max(0, Math.min(1, f)) * pathLength(points);
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    if (rest <= seg) {
      const u = seg ? rest / seg : 0;
      out.push({ x: points[i - 1]!.x + (points[i]!.x - points[i - 1]!.x) * u, y: points[i - 1]!.y + (points[i]!.y - points[i - 1]!.y) * u });
      return out;
    }
    out.push(points[i]!);
    rest -= seg;
  }
  return out;
}

/**
 * A campaign arrow like the history channels' (Kings and Generals, Hayalhanem): a body that tapers from its base to a
 * broad head, growing along the route as the line is told. `pts` is the part drawn so far; widths are in screen units.
 */
function taperedArrow(pts: readonly { x: number; y: number }[], base: number, neck: number, head: number, headLen: number): string {
  if (pts.length < 2) return "";
  const total = pathLength(pts);
  if (total < headLen * 0.6) return "";
  const body = partialPoints(pts, Math.max(0, (total - headLen) / total));
  const left: string[] = [];
  const right: string[] = [];
  let run = 0;
  body.forEach((p, i) => {
    const q = body[Math.min(body.length - 1, i + 1)]!;
    const o = body[Math.max(0, i - 1)]!;
    const dx = (i < body.length - 1 ? q.x - p.x : p.x - o.x) || 1e-6;
    const dy = i < body.length - 1 ? q.y - p.y : p.y - o.y;
    const len = Math.hypot(dx, dy) || 1;
    if (i > 0) run += Math.hypot(p.x - o.x, p.y - o.y);
    const w = (base + (neck - base) * (run / Math.max(1, total - headLen))) / 2;
    left.push(`${p.x - (dy / len) * w} ${p.y + (dx / len) * w}`);
    right.push(`${p.x + (dy / len) * w} ${p.y - (dx / len) * w}`);
  });
  const tip = pts[pts.length - 1]!;
  const neckP = body[body.length - 1]!;
  const dx = tip.x - neckP.x;
  const dy = tip.y - neckP.y;
  const len = Math.hypot(dx, dy) || 1;
  const hl = `${neckP.x - (dy / len) * (head / 2)} ${neckP.y + (dx / len) * (head / 2)}`;
  const hr = `${neckP.x + (dy / len) * (head / 2)} ${neckP.y - (dx / len) * (head / 2)}`;
  return `M${left.join(" L")} L${hl} L${tip.x} ${tip.y} L${hr} L${right.reverse().join(" L")} Z`;
}

/**
 * How long a conquest takes to sweep over its land, and an army to march (screen seconds per 1000 px of route). Owner,
 * 22 Oct 2026: "the map's progress should be a little slower, clearer and smoother" — the first pace (2.6 s, 2.4 s)
 * rushed; both are now about twice as slow, and never longer than what is left of the shot.
 */
const SPREAD_S = 4.5;
const MARCH_S_PER_1000PX = 4.6;
const MARCH_MIN_S = 4.5;
const MARCH_MAX_S = 12;
/** How long one band of a sweeping conquest takes to fade in: short, so the half-blended red over blue never shows as a grey band (benchmark 3, 22 Oct 2026); 16 bands keep the front smooth. */
const BAND_FADE_S = 0.6;

/** Scale bar lengths a map would print. */
const SCALE_STEPS_KM = [1, 2, 5, 10, 25, 50, 100, 150, 200, 250, 300, 500, 750, 1000, 1500, 2000, 2500, 5000];

/**
 * An atlas's corner (owner's example map, 21 Oct 2026): a compass rose and a scale bar in kilometres that follows the
 * camera's zoom, in the badges' parchment and sepia, at the bottom left of the screen.
 */
export function AtlasCorner({ kmPerScreenPx, height: H }: { kmPerScreenPx: number; height: number }) {
  const u = H / 1080;
  const target = 230 * u * kmPerScreenPx;
  const km = [...SCALE_STEPS_KM].reverse().find((s) => s <= target) ?? SCALE_STEPS_KM[0]!;
  const bar = km / kmPerScreenPx;
  // Drawn fixed on the screen by ShotView, a comfortable margin from the picture's edge.
  const x0 = 96 * u;
  const y0 = H - 84 * u;
  const cx = x0 + 52 * u;
  const cy = H - 210 * u;
  const r = 44 * u;
  const point = (ang: number, len: number, half: "l" | "r") => {
    const a = (ang * Math.PI) / 180;
    const side = ((ang + (half === "l" ? -90 : 90)) * Math.PI) / 180;
    return `M${cx} ${cy} L${cx + Math.sin(a) * len} ${cy - Math.cos(a) * len} L${cx + Math.sin(side) * len * 0.18} ${cy - Math.cos(side) * len * 0.18} Z`;
  };
  const text = (s: string, x: number, y: number, size: number, anchor: "start" | "middle" = "middle") => (
    <text x={x} y={y} textAnchor={anchor} style={{ font: `700 ${size * u}px Georgia, 'Palatino Linotype', serif` }} fill={PARCHMENT} stroke="rgba(20,12,4,0.7)" strokeWidth={3 * u} paintOrder="stroke fill">
      {s}
    </text>
  );
  return (
    <g style={{ filter: `drop-shadow(0 ${2 * u}px ${3 * u}px rgba(0,0,0,0.5))` }}>
      <circle cx={cx} cy={cy} r={r * 0.62} fill="none" stroke={PARCHMENT} strokeWidth={2 * u} opacity={0.85} />
      {[45, 135, 225, 315].flatMap((ang) => [<path key={`d${ang}l`} d={point(ang, r * 0.62, "l")} fill={SEPIA} />, <path key={`d${ang}r`} d={point(ang, r * 0.62, "r")} fill={PARCHMENT} />])}
      {[0, 90, 180, 270].flatMap((ang) => [<path key={`m${ang}l`} d={point(ang, r, "l")} fill={PARCHMENT} stroke={SEPIA} strokeWidth={1.2 * u} />, <path key={`m${ang}r`} d={point(ang, r, "r")} fill={SEPIA} stroke={SEPIA} strokeWidth={1.2 * u} />])}
      {text("N", cx, cy - r - 8 * u, 22)}
      {[0, 1, 2, 3].map((j) => (
        <rect key={`b${j}`} x={x0 + (bar / 4) * j} y={y0 - 7 * u} width={bar / 4} height={9 * u} fill={j % 2 ? PARCHMENT : SEPIA} stroke={SEPIA} strokeWidth={1.5 * u} />
      ))}
      {text("0", x0, y0 + 24 * u, 18)}
      {text(`${km / 2}`, x0 + bar / 2, y0 + 24 * u, 18)}
      {text(`${km} km`, x0 + bar, y0 + 24 * u, 18)}
    </g>
  );
}

/** A colour darkened towards black (`f` = how much of it stays). */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.replace("#", "").slice(0, 6).padEnd(6, "0"), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** The two lines a long name is written on (same rule as MapBuilder.labelLines, which sizes it). */
function labelLines(text: string): string[] {
  const t = text.trim();
  if (t.length <= 12 || !t.includes(" ")) return [t];
  const spaces = [...t.matchAll(/ /g)].map((m) => m.index!);
  const cut = spaces.reduce((a, b) => (Math.abs(b - t.length / 2) < Math.abs(a - t.length / 2) ? b : a));
  return [t.slice(0, cut), t.slice(cut + 1)];
}
/** How long the camera takes to reach a new view (seconds), and a badge to travel its route. */
const CAMERA_MOVE_S = 2.4;
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

/**
 * A drawn map in the reference channels' manner: OverSimplified's flat blue sea and green land, or — with a relief
 * image — Hayalhanem's terrain map with see-through state colours. Territories fade in (and out at a border change)
 * with their names, armies pop in, arrows draw themselves, rulers' badges sit on their capitals and travel their
 * routes, battles flash. With a world and camera keys the camera glides from region to region; names, marks and badges
 * keep their size on screen at every zoom. Coordinates arrive in world (or frame) pixels.
 */
export function MapView({ map, width: W, height: H, cast, accessories, duration }: { map: V3GeoMap; width: number; height: number; cast?: ReadonlyMap<string, V3CastMember>; accessories?: AccessoryIndex; duration?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const world = map.world ?? { width: W, height: H };
  const cam = cameraAt(map.camera, frame, fps, W, H);
  // Screen sizes: 1 at 1080p, divided by the zoom so marks keep their size on screen.
  const k = H / 1080 / cam.zoom;
  const relief = Boolean(map.relief);
  // On the close battle map the states are only tinted: the ground, the walls and the houses must show through.
  const fillK = map.close ? 0.35 : 0.9;
  const label = (text: string, x: number, y: number, size: number, opacity = 1) => (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" opacity={opacity} style={{ font: `900 ${size * k}px ${LABEL_FONT}`, letterSpacing: 1.5 * k }} fill="#ffffff" stroke={INK} strokeWidth={8 * k} paintOrder="stroke fill" strokeLinejoin="round">
      {text.toLocaleUpperCase("en-US")}
    </text>
  );
  // A state's name on the relief map (owner, 21 Oct 2026: "nothing like that video"): white condensed capitals on one or
  // two lines with a soft shadow instead of the cartoon map's thick black outline.
  const stateLabel = (text: string, x: number, y: number, size: number, opacity: number) => {
    const lines = labelLines(text.toLocaleUpperCase("en-US"));
    const lh = size * 0.98 * k;
    // One <text> per line at its own height: tspans with dy under a middle baseline landed ~70 px off their anchor in
    // Remotion's Chrome (map still, 21 Oct 2026).
    return (
      <g opacity={opacity} style={{ filter: `drop-shadow(0 ${2 * k}px ${3 * k}px rgba(0,0,0,0.55))` }}>
        {lines.map((l, i) => (
          <text key={i} x={x} y={y + (i - (lines.length - 1) / 2) * lh + size * 0.36 * k} textAnchor="middle" style={{ font: `700 ${size * k}px ${STATE_FONT}`, fontStretch: "condensed", fontVariationSettings: "'wdth' 75, 'wght' 700", letterSpacing: 0.5 * k }} fill="#ffffff" stroke="rgba(20,20,20,0.5)" strokeWidth={2.5 * k} paintOrder="stroke fill" strokeLinejoin="round">
            {l}
          </text>
        ))}
      </g>
    );
  };
  // Names of armies, arrows and battles: the relief map's style there too, the cartoon map's on the flat one.
  const markLabel = (text: string, size: number, opacity = 1) => (relief ? stateLabel(text, 0, 0, size, opacity) : label(text, 0, 0, size, opacity));
  const battleMarks = (map.battles ?? []).map((b, i) => {
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
        {/* The fighting itself (owner, 22 Oct 2026): bursts round the place for a few seconds, in the era's way. */}
        <BattleBursts x={0} y={0} start={b.start} frame={frame} fps={fps} k={k} era={map.era} seed={i + 1} />
        {flash > 0 ? <circle r={70 * k * (1.4 - flash * 0.4)} fill="#ffd34d" opacity={0.55 * flash} /> : null}
        <g transform={`scale(${pop})`}>
          {blade(-38)}
          {blade(38)}
        </g>
        {/* Above the swords, or where placeCloseLabels found room on the close map. */}
        <g transform={b.labelSpot ? `translate(${b.labelSpot.x - b.x + b.labelSpot.dx * k} ${b.labelSpot.y - b.y + b.labelSpot.dy * k})` : `translate(0 ${-70 * k})`}>{markLabel(b.label, 30, Math.min(1, pop))}</g>
      </g>
    );
  });
  // What is left of the shot after a frame (an animation must end on screen, before the cut).
  const leftS = (from: number) => (duration === undefined ? Infinity : Math.max(1.5, (duration - from) / fps - 0.6));
  // How long an army's march takes on screen (by its route's length as seen at the camera's zoom then).
  const marchSeconds = (path: readonly { x: number; y: number }[], from: number) =>
    Math.min(leftS(from), MARCH_MAX_S, Math.max(MARCH_MIN_S, ((pathLength(path) * 1080 * cameraAt(map.camera, from + Math.round(fps * CAMERA_MOVE_S), fps, W, H).zoom) / H / 1000) * MARCH_S_PER_1000PX));
  // A conquest told with a march sweeps as fast as the army goes (town after town as it passes), else in SPREAD_S.
  const sweepSeconds = (start: number) => {
    const army = map.armies.find((a) => a.path && a.path.length > 1 && Math.abs((a.moveStart ?? a.start) - start) <= 1);
    // Land beyond the march's end falls after the army arrives, at its pace.
    const scale = map.territories.find((t) => t.spread?.length && t.start === start)?.sweepScale ?? 1;
    return Math.min(leftS(start) - BAND_FADE_S, army ? marchSeconds(army.path!, start) * scale : SPREAD_S);
  };
  const visible = (start: number, end: number | undefined) => {
    const a = interpolate(frame, [start, start + Math.round(fps * 0.6)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return end === undefined ? a : a * interpolate(frame, [end, end + Math.round(fps * 0.6)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  };
  // A sweeping conquest gets its border (and its colour to the coast) once the sweep has covered the land.
  const borderAlpha = (t: V3GeoMap["territories"][number]) =>
    t.spread?.length ? visible(t.start + Math.round(sweepSeconds(t.start) * fps), t.end) : t.start > 0 ? visible(t.start - Math.round(fps * 0.6), t.end) : visible(t.start, t.end);
  // Everything but a state's own fill: its colour carried to the coast never doubles over the fill.
  // `edge`: the fill's own edge stroke (world px), left out too so no thin seam shows where the two meet.
  const outsideMask = (d: string, i: number, edge = 0) => (
    <mask key={`o${i}`} id={`${id}-out${i}`} maskUnits="userSpaceOnUse" x={0} y={0} width={world.width} height={world.height}>
      <rect x={0} y={0} width={world.width} height={world.height} fill="#ffffff" />
      <path d={d} fill="#000000" {...(edge ? { stroke: "#000000", strokeWidth: edge, strokeLinejoin: "round" as const } : {})} />
    </mask>
  );
  const coastPadOf = (t: V3GeoMap["territories"][number], i: number, opacity: number, growing: boolean) =>
    t.coast && opacity > 0 && frame >= t.start ? (
      <g key={`p${i}`} mask={`url(#${id}-out${i})`}>
        <path d={t.coast} fill="none" stroke={t.color} strokeOpacity={opacity} strokeWidth={map.coastPad! * 2} strokeLinejoin="round" strokeLinecap="butt" mask={growing ? `url(#${id}-grow${i})` : undefined} />
      </g>
    ) : null;
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
        <mask id={`${id}-sea`} maskUnits="userSpaceOnUse" x={0} y={0} width={world.width} height={world.height}>
          <rect x={0} y={0} width={world.width} height={world.height} fill="#ffffff" />
          <path d={map.land} fill="#000000" fillRule="evenodd" />
        </mask>
        <radialGradient id={`${id}-vignette`} cx="50%" cy="50%" r="72%">
          <stop offset="62%" stopColor="#000000" stopOpacity={0} />
          <stop offset="100%" stopColor="#000000" stopOpacity={0.38} />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill={`url(#${id}-sea)`} />
      <g transform={`translate(${W / 2} ${H / 2}) scale(${cam.zoom}) translate(${-cam.x} ${-cam.y})`}>
        {relief ? (
          <>
            {/* The terrain on the vector land only (its water filled with land by relief_crop.py): on a close view the
                image's own coarse coast showed as steps of sea in the land (map trial, 22 Oct 2026). */}
            <g mask={`url(#${id}-land)`}>
              <image href={staticFile(map.relief!)} x={0} y={0} width={world.width} height={world.height} preserveAspectRatio="none" />
            </g>
            {/* Shallow water: a light band along every coast on the sea side, like the reference maps' bright shores. */}
            <g mask={`url(#${id}-sea)`}>
              <path d={map.land} fill="none" stroke="#7fc4d8" strokeOpacity={0.16} strokeWidth={(map.close ? 12 : 34) * k} strokeLinejoin="round" />
              <path d={map.land} fill="none" stroke="#a6dcea" strokeOpacity={0.22} strokeWidth={(map.close ? 5 : 14) * k} strokeLinejoin="round" />
            </g>
          </>
        ) : (
          <>
            {/* A soft shadow under the land lifts it off the sea. */}
            <path d={map.land} transform={`translate(${5 * k} ${7 * k})`} fill="#0d1b30" opacity={0.35} fillRule="evenodd" />
            <path d={map.land} fill={LAND} fillRule="evenodd" />
          </>
        )}
        {relief ? (
          <>
            {/* On the relief (owner, 21 Oct 2026: the 55% fill with white lines looked washed out; a plain 84% fill hid
                the terrain — "only paint, nothing like a map"): the states' colours are laid on in hard-light, so each
                is strong yet the mountains and valleys show through it like the reference maps; the border is a dark
                shade of each state's own colour on top, so where two states meet it reads sharp. */}
            {/* A state that comes in during the scene (a conquest, a new border) spreads out from its name instead of
                fading in, so the map shows it growing. */}
            <defs>
              {map.territories.map((t, i) => {
                const grow = t.start > 0 ? interpolate(frame, [t.start, t.start + Math.round(fps * 1.6)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }) : 1;
                return grow < 1 ? (
                  <mask key={i} id={`${id}-grow${i}`} maskUnits="userSpaceOnUse" x={0} y={0} width={world.width} height={world.height}>
                    <circle cx={t.labelX ?? world.width / 2} cy={t.labelY ?? world.height / 2} r={Math.max(1, grow * Math.hypot(world.width, world.height))} fill="#ffffff" />
                  </mask>
                ) : null;
              })}
              {map.coastPad ? map.territories.map((t, i) => (t.coast ? outsideMask(t.d, i, t.border !== undefined && !t.spread?.length ? 5 * k : 0) : null)) : null}
            </defs>
            <g mask={`url(#${id}-land)`} style={{ mixBlendMode: "hard-light" }}>
              {/* Each state's colour carried from its provinces' stepped coast to the coastline, outside its own fill
                  (map trial, 22 Oct 2026: bare steps of land along every coast on a close view). */}
              {map.coastPad ? map.territories.map((t, i) => coastPadOf(t, i, fillK * borderAlpha(t), !t.spread?.length && t.start > 0 && frame < t.start + Math.round(fps * 1.6))) : null}
              {map.territories.map((t, i) => {
                // A conquest sweeps over its land band by band from where the army came (owner, 22 Oct 2026).
                if (t.spread?.length) {
                  const fade = t.end === undefined ? 1 : visible(t.end - 1, t.end);
                  const sweep = sweepSeconds(t.start);
                  return (
                    <g key={i} opacity={fade}>
                      {t.spread.map((b, j) => {
                        const at = t.start + Math.round(b.delay * sweep * fps);
                        const a = interpolate(frame, [at, at + Math.round(fps * BAND_FADE_S)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
                        return a > 0 ? <path key={j} d={b.d} fill={t.color} fillRule="evenodd" stroke={t.color} strokeWidth={5 * k} strokeLinejoin="round" opacity={fillK * a} /> : null;
                      })}
                    </g>
                  );
                }
                const a = t.start > 0 ? visible(t.start - Math.round(fps * 0.6), t.end) : visible(t.start, t.end);
                const growing = t.start > 0 && frame < t.start + Math.round(fps * 1.6);
                // A state built from provinces is drawn opaque with a 5 px edge in its own colour and faded as a whole:
                // the edge closes the slivers between provinces, and no inner edge shows darker.
                return a > 0 && frame >= t.start ? <path key={i} d={t.d} fill={t.color} fillRule="evenodd" {...(t.border !== undefined ? { stroke: t.color, strokeWidth: 5 * k, strokeLinejoin: "round" as const, opacity: fillK * a } : { fillOpacity: fillK * a })} mask={growing ? `url(#${id}-grow${i})` : undefined} /> : null;
              })}
            </g>
            <g mask={`url(#${id}-land)`}>
              {map.territories.map((t, i) => {
                const a = borderAlpha(t);
                const growing = !t.spread?.length && t.start > 0 && frame < t.start + Math.round(fps * 1.6);
                return a > 0 && frame >= t.start ? <path key={i} d={t.border ?? t.d} fill="none" stroke={shade(t.color, i === map.mainTerritory ? 0.4 : 0.5)} strokeOpacity={0.95 * a} strokeWidth={(i === map.mainTerritory ? 4.4 : 2.6) * k} strokeLinejoin="round" mask={growing ? `url(#${id}-grow${i})` : undefined} /> : null;
              })}
            </g>
            {/* Rivers over the colours (the reference maps name and draw them), thin and light. */}
            <path d={map.rivers} fill="none" stroke="#7cc3ea" strokeOpacity={0.85} strokeWidth={2.2 * k} strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : (
          <g mask={`url(#${id}-land)`}>
            <path d={map.land} fill="none" stroke={LAND_SHADE} strokeWidth={26 * k} opacity={0.6} />
            {map.coastPad ? (
              <defs>{map.territories.map((t, i) => (t.coast ? outsideMask(t.d, i) : null))}</defs>
            ) : null}
            {map.coastPad ? map.territories.map((t, i) => coastPadOf(t, i, 0.78 * visible(t.start, t.end), false)) : null}
            {map.territories.map((t, i) => {
              const a = visible(t.start, t.end);
              if (a <= 0) return null;
              // A state built from provinces: its fill has their inner edges, so only its own outline is stroked.
              return t.border !== undefined ? (
                <g key={i}>
                  <path d={t.d} fill={t.color} fillOpacity={0.78 * a} fillRule="evenodd" />
                  <path d={t.border} fill="none" stroke="#ffffff" strokeOpacity={a} strokeWidth={4 * k} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              ) : (
                <path key={i} d={t.d} fill={t.color} fillOpacity={0.78 * a} stroke="#ffffff" strokeOpacity={a} strokeWidth={4 * k} strokeLinejoin="round" fillRule="evenodd" />
              );
            })}
          </g>
        )}
        {relief ? (
          <>
            {/* Lakes drawn too, now that the terrain image carries no water of its own. */}
            <path d={map.lakes} fill={OCEAN} stroke="rgba(8,20,38,0.75)" strokeWidth={1.8 * k} fillRule="evenodd" />
            {/* A thin dark coastline: the coloured states end cleanly at the sea. */}
            <path d={map.land} fill="none" stroke="rgba(8,20,38,0.75)" strokeWidth={1.8 * k} strokeLinejoin="round" />
            {/* Sea names like an atlas (owner's example map): pale spaced italic capitals. */}
            {(map.seas ?? []).map((s, i) => (
              <text key={`s${i}`} x={s.x} y={s.y + s.size * 0.36 * k} textAnchor="middle" style={{ font: `italic 400 ${s.size * k}px Georgia, 'Palatino Linotype', serif`, letterSpacing: s.size * 0.45 * k }} fill="#cfe4f0" fillOpacity={0.78}>
                {s.label}
              </text>
            ))}
          </>
        ) : (
          <>
            <path d={map.lakes} fill={OCEAN} stroke={COAST} strokeWidth={2 * k} fillRule="evenodd" />
            <path d={map.rivers} fill="none" stroke={RIVER} strokeWidth={3 * k} strokeLinecap="round" strokeLinejoin="round" />
            <path d={map.land} fill="none" stroke={COAST} strokeWidth={3.5 * k} strokeLinejoin="round" />
          </>
        )}
        {/* The close battle map's ground: woods, fields, roads, the city's roofs, the camp, the walls and the buildings. */}
        {map.close ? <CloseGround close={map.close} frame={frame} fps={fps} era={map.era} label={(t, s) => markLabel(t, s)} k={k} /> : null}
        {map.cities.map((c, i) =>
          relief ? null : (
            <g key={`c${i}`}>
              <circle cx={c.x} cy={c.y} r={11 * k} fill="#ffffff" stroke={INK} strokeWidth={5 * k} />
              <text x={c.x + 18 * k} y={c.y + 2 * k} dominantBaseline="middle" style={{ font: `800 ${30 * k}px 'Segoe UI', Arial, sans-serif` }} fill="#ffffff" stroke={INK} strokeWidth={7 * k} paintOrder="stroke fill">
                {c.label}
              </text>
            </g>
          ),
        )}
        {map.territories.map((t, i) => {
          if (t.labelX === undefined || t.labelY === undefined) return null;
          // A name a later conquest sweeps over goes as the front reaches it.
          const gone = t.covered ? t.covered.start + Math.round(t.covered.delay * sweepSeconds(t.covered.start) * fps) : undefined;
          const a = visible(t.start + 6, gone !== undefined && (t.end === undefined || gone < t.end) ? gone : t.end);
          if (a <= 0) return null;
          return <g key={`tl${i}`}>{relief ? stateLabel(t.label, t.labelX, t.labelY, t.labelSize ?? 46, a) : label(t.label, t.labelX, t.labelY, 46, a)}</g>;
        })}
        {/* Lines the story is about (the Rubicon, a wall): a soft glow and a bright core drawing along, then the name. */}
        {(map.lines ?? []).map((ln, i) => {
          if (frame < ln.start || ln.points.length < 2) return null;
          const pts = smoothPoints(ln.points);
          const grow = interpolate(frame, [ln.start, ln.start + Math.round(fps * 1.4)], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
          const part = partialPoints(pts, grow);
          const d = `M${part.map((p) => `${p.x} ${p.y}`).join(" L")}`;
          const pulse = 0.75 + 0.25 * Math.sin((frame - ln.start) * 0.18);
          // The name beside the line on the side farthest from any town (the Rubicon's name first sat on Ariminum's).
          const c = along(pts, 0.5);
          const sides = [
            { x: c.x - 95 * k, y: c.y },
            { x: c.x + 95 * k, y: c.y },
            { x: c.x, y: c.y - 60 * k },
            { x: c.x, y: c.y + 60 * k },
          ];
          const room = (s: { x: number; y: number }) => Math.min(Infinity, ...map.cities.map((t) => Math.hypot((t.x + 60 * k - s.x) / 2, t.y - s.y)));
          // On the close map placeCloseLabels has found the name a place clear of every other mark.
          const mid = ln.labelSpot ? { x: ln.labelSpot.x + ln.labelSpot.dx * k, y: ln.labelSpot.y + ln.labelSpot.dy * k } : sides.reduce((best, s) => (room(s) > room(best) ? s : best), sides[0]!);
          // A chain across the water (the Golden Horn's): dark iron links on wooden floats, rocking a little.
          if (ln.chain) {
            const links = Math.max(4, Math.round(pathLength(part) / (9 * k)));
            return (
              <g key={`ln${i}`}>
                <path d={d} fill="none" stroke="#1d1b18" strokeOpacity={0.5} strokeWidth={5 * k} strokeLinecap="round" transform={`translate(${2 * k} ${3 * k})`} />
                {Array.from({ length: links }, (_, j) => {
                  const p = along(part, (j + 0.5) / links);
                  const q = along(part, Math.min(1, (j + 1) / links));
                  const ang = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
                  return <ellipse key={j} cx={p.x} cy={p.y + Math.sin(frame * 0.12 + j * 0.6) * 0.8 * k} rx={5.5 * k} ry={(j % 2 ? 1.6 : 3) * k} transform={`rotate(${ang} ${p.x} ${p.y})`} fill="none" stroke={j % 2 ? "#3a3632" : "#55504a"} strokeWidth={2.2 * k} />;
                })}
                {Array.from({ length: Math.max(2, Math.round(links / 6)) }, (_, j, ) => {
                  const p = along(part, (j + 0.5) / Math.max(2, Math.round(links / 6)));
                  return <rect key={`f${j}`} x={p.x - 5 * k} y={p.y - 3.5 * k + Math.sin(frame * 0.12 + j) * 1.2 * k} width={10 * k} height={7 * k} rx={2 * k} fill="#8a5a2b" stroke="#2b1d10" strokeWidth={1.5 * k} />;
                })}
                {grow > 0.6 ? <g transform={`translate(${mid.x} ${mid.y})`}>{markLabel(ln.label, 30, Math.min(1, (grow - 0.6) / 0.3))}</g> : null}
              </g>
            );
          }
          return (
            <g key={`ln${i}`}>
              <path d={d} fill="none" stroke={ln.color} strokeOpacity={0.35 * pulse} strokeWidth={26 * k} strokeLinecap="round" strokeLinejoin="round" style={{ filter: `blur(${6 * k}px)` }} />
              <path d={d} fill="none" stroke={ln.color} strokeWidth={7 * k} strokeLinecap="round" strokeLinejoin="round" />
              <path d={d} fill="none" stroke="#fffbe6" strokeWidth={2.5 * k} strokeLinecap="round" strokeLinejoin="round" />
              {grow > 0.6 ? <g transform={`translate(${mid.x} ${mid.y})`}>{markLabel(ln.label, 34, Math.min(1, (grow - 0.6) / 0.3))}</g> : null}
            </g>
          );
        })}
        {map.armies.map((a, i) => {
          if (frame < a.start) return null;
          const pop = spring({ frame: frame - a.start, fps, config: { damping: 11, stiffness: 200 } });
          // On the march (owner, 22 Oct 2026: "no animation on the map"): the unit goes along its route at a pace by
          // its length, a dotted trail behind it, bobbing a little with the step; it points the way it goes.
          const path = a.path && a.path.length > 1 ? a.path : undefined;
          const from = a.moveStart ?? a.start;
          const travel = path ? marchSeconds(path, from) : 0;
          const progress = path ? interpolate(frame, [from, from + fps * travel], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) }) : 0;
          const at = path ? along(path, progress) : { x: a.x, y: a.y };
          const marching = path && progress > 0 && progress < 1;
          const ahead = path ? along(path, Math.min(1, progress + 0.02)) : at;
          const dir = marching && ahead.x < at.x ? -1 : 1;
          const bob = marching ? Math.abs(Math.sin((frame - from) * 0.45)) * -5 * k : 0;
          // Behind the army, the campaign arrow grows as it advances (the history channels' march): broad at its base,
          // tapering to the unit, translucent so towns and terrain show through. On the flat map, a dotted trail.
          const smooth = path ? smoothPoints(path) : undefined;
          const body = smooth && progress > 0.01 ? taperedArrow(partialPoints(smooth, progress), 30 * k, 16 * k, 0, 1) : "";
          return (
            <g key={`a${i}`}>
              {relief && body ? <path d={body} fill={a.color} fillOpacity={0.72} stroke="rgba(40,8,12,0.75)" strokeWidth={2.5 * k} strokeLinejoin="round" style={{ filter: `drop-shadow(0 ${3 * k}px ${4 * k}px rgba(0,0,0,0.45))` }} /> : null}
              {!relief && path && progress > 0 ? <path d={partialPath(path, progress)} fill="none" stroke={a.color} strokeWidth={7 * k} strokeLinecap="round" strokeDasharray={`0.1 ${16 * k}`} /> : null}
              {/* The unit stands just above its place, so the town's dot and name under it stay readable. */}
              <g transform={`translate(${at.x} ${at.y - 46 * k + bob}) scale(${pop})`} style={{ filter: `drop-shadow(0 ${3 * k}px ${4 * k}px rgba(0,0,0,0.5))` }}>
                <path d={`M0 ${27 * k} L0 ${46 * k}`} stroke="#ffffff" strokeWidth={3.5 * k} />
                <rect x={-42 * k} y={-27 * k} width={84 * k} height={54 * k} rx={7 * k} fill={a.color} stroke="#ffffff" strokeWidth={5.5 * k} />
                <path d={`M${-42 * k} ${-27 * k} L${42 * k} ${27 * k} M${42 * k} ${-27 * k} L${-42 * k} ${27 * k}`} stroke="#ffffff" strokeWidth={4.5 * k} opacity={0.85} />
                {marching ? <path d={`M${dir * 48 * k} ${-12 * k} L${dir * 64 * k} 0 L${dir * 48 * k} ${12 * k} Z`} fill="#ffffff" stroke={INK} strokeWidth={2 * k} /> : null}
                <g transform={`translate(0 ${-56 * k})`}>{markLabel(a.label, 34)}</g>
              </g>
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
          // On the relief map a campaign is a broad red arrow that tapers to its head and grows along the route as it is
          // told (the history channels' arrow; owner, 22 Oct 2026). Semi-opaque, so cities and terrain show through.
          if (relief) {
            const grown = smoothPoints(p);
            const shape = taperedArrow(partialPoints(grown, 1 - draw), 34 * k, 22 * k, 62 * k, 52 * k);
            return (
              <g key={`r${i}`}>
                {shape ? <path d={shape} fill={ar.color} fillOpacity={0.82} stroke="rgba(40,8,12,0.85)" strokeWidth={3 * k} strokeLinejoin="round" style={{ filter: `drop-shadow(0 ${3 * k}px ${4 * k}px rgba(0,0,0,0.5))` }} /> : null}
                {ar.label && draw < 0.5 ? <g transform={`translate(${ar.labelX ?? mid.x} ${ar.labelY ?? mid.y - 40 * k})`}>{markLabel(ar.label, 32)}</g> : null}
              </g>
            );
          }
          return (
            <g key={`r${i}`}>
              <path d={d} fill="none" stroke={INK} strokeWidth={24 * k} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={draw} />
              <path d={d} fill="none" stroke={ar.color} strokeWidth={14 * k} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={draw} />
              {draw < 0.02 ? <path transform={`translate(${last.x} ${last.y}) rotate(${ang})`} d={`M${22 * k} 0 L${-24 * k} ${-28 * k} L${-12 * k} 0 L${-24 * k} ${28 * k} Z`} fill={ar.color} stroke={INK} strokeWidth={5 * k} strokeLinejoin="round" /> : null}
              {ar.label && draw < 0.5 ? <g transform={`translate(${ar.labelX ?? mid.x} ${ar.labelY ?? mid.y - 40 * k})`}>{markLabel(ar.label, 32)}</g> : null}
            </g>
          );
        })}
        {/* Each side's unit tokens: fronts, clusters, sieges, sliding with the lines; clashes where they meet. */}
        <UnitTokens map={map} frame={frame} fps={fps} k={k} />
        <MapVehicles map={map} frame={frame} fps={fps} k={k} travelS={marchSeconds} />
        {/* On the relief map cities are written over the routes: a dotted march through Belgrade cut its name. */}
        {relief
          ? map.cities.map((c, i) => (
              <g key={`c${i}`}>
                <circle cx={c.x} cy={c.y} r={6 * k} fill="#ffffff" stroke="rgba(20,20,20,0.7)" strokeWidth={2.5 * k} />
                <text x={c.x + 12 * k} y={c.y + 1 * k} dominantBaseline="middle" style={{ font: `700 ${25 * k}px ${STATE_FONT}`, filter: `drop-shadow(0 ${1.5 * k}px ${2 * k}px rgba(0,0,0,0.6))` }} fill="#ffffff" stroke="rgba(20,20,20,0.55)" strokeWidth={2.5 * k} paintOrder="stroke fill">
                  {c.label}
                </text>
              </g>
            ))
          : battleMarks}
        {(map.badges ?? []).map((b, i) => {
          const a = visible(b.start, b.end);
          const m = cast?.get(b.castId);
          if (a <= 0) return null;
          // A campaign (owner, 21 Oct 2026: "Bayezid sets out, the badge moves showing where he goes"): the badge sets off
          // with its line, takes longer on a longer road, and leaves a dotted trail behind it.
          const moveFrom = b.moveStart ?? b.start;
          // A ruler's journey keeps the marches' unhurried pace (owner, 22 Oct 2026), ending before the cut.
          const travelS = relief ? Math.min(leftS(moveFrom), MARCH_MAX_S, Math.max(MARCH_MIN_S, (pathLength(b.path) * 1080) / H / 150)) : BADGE_TRAVEL_S;
          const progress = interpolate(frame, [moveFrom, moveFrom + fps * travelS], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
          const at = along(b.path, progress);
          const pop = spring({ frame: frame - b.start, fps, config: { damping: 12, stiffness: 180 } });
          const extra: V3Extra = { castId: b.castId, x: 0, depth: 0, facing: progress > 0 && progress < 1 && b.path.length > 1 && b.path[b.path.length - 1]!.x < b.path[0]!.x ? "left" : "right", scale: 1, mood: "notr", seed: i * 97 + 13 };
          if (relief) {
            // The reference maps' badge: a portrait in a parchment ring, the name on a scroll under it touching only the
            // ring's rim (owner, 21 Oct 2026: a scroll across the ring's lower half covered the face), a short point
            // down to the place (about 130 px).
            const r = 44 * k;
            const s = (r * 0.62) / 100;
            const scrollY = -27 * k;
            const cy = scrollY - r - 11 * k;
            const sw = (b.label.length * 11.5 + 34) * k;
            const trail = progress > 0 && b.path.length > 1 ? partialPath(b.path, progress) : undefined;
            return (
              <g key={`g${i}`}>
                {trail ? <path d={trail} fill="none" stroke={ROUTE_RED} strokeWidth={9 * k} strokeLinecap="round" strokeDasharray={`0.1 ${17 * k}`} opacity={a} style={{ filter: `drop-shadow(0 ${1.5 * k}px ${1.5 * k}px rgba(0,0,0,0.55))` }} /> : null}
                <g transform={`translate(${at.x} ${at.y}) scale(${pop})`} opacity={a}>
                  <defs>
                    <clipPath id={`${id}-badge${i}`}>
                      <circle cy={cy} r={r} />
                    </clipPath>
                  </defs>
                  <g style={{ filter: `drop-shadow(0 ${3 * k}px ${4 * k}px rgba(0,0,0,0.5))` }}>
                    <path d={`M${-10 * k} ${scrollY} L0 0 L${10 * k} ${scrollY} Z`} fill={PARCHMENT} stroke={SEPIA} strokeWidth={2.5 * k} strokeLinejoin="round" />
                    <circle cy={cy} r={r + 5 * k} fill={PARCHMENT} stroke={SEPIA} strokeWidth={3 * k} />
                  </g>
                  <circle cy={cy} r={r} fill="#d9c9a3" />
                  {m && accessories ? (
                    <g clipPath={`url(#${id}-badge${i})`}>
                      <g transform={`translate(0 ${cy - HEAD_CY * s + r * 0.18}) scale(${s})`}>
                        <Character member={m} state={extraState(extra, frame, fps)} accessories={accessories} cheap />
                      </g>
                    </g>
                  ) : null}
                  <g transform={`translate(0 ${scrollY})`}>
                    <path d={`M${-sw / 2 - 12 * k} ${-9 * k} L${-sw / 2 + 4 * k} ${-9 * k} L${-sw / 2 + 4 * k} ${15 * k} L${-sw / 2 - 12 * k} ${15 * k} L${-sw / 2 - 6 * k} ${3 * k} Z M${sw / 2 + 12 * k} ${-9 * k} L${sw / 2 - 4 * k} ${-9 * k} L${sw / 2 - 4 * k} ${15 * k} L${sw / 2 + 12 * k} ${15 * k} L${sw / 2 + 6 * k} ${3 * k} Z`} fill="#c9a46a" stroke={SEPIA} strokeWidth={2 * k} strokeLinejoin="round" />
                    <rect x={-sw / 2} y={-15 * k} width={sw} height={28 * k} rx={4 * k} fill={PARCHMENT} stroke={SEPIA} strokeWidth={2 * k} />
                    <text x={0} y={6 * k} textAnchor="middle" style={{ font: `italic 700 ${20 * k}px Georgia, 'Times New Roman', serif` }} fill="#3a2410">
                      {b.label}
                    </text>
                  </g>
                </g>
              </g>
            );
          }
          const r = 48 * k;
          // The head (radius 100, centre HEAD_CY in character space) fills the ring with the shoulders below it.
          const s = (r * 0.62) / 100;
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
        {/* On the relief map a battle is drawn over the badges: a ruler arriving there must not hide its name. */}
        {relief ? battleMarks : null}
      </g>
      {/* A soft dark edge holds the eye in the middle of the relief map (cinematic, like the reference). */}
      {relief ? <rect x={0} y={0} width={W} height={H} fill={`url(#${id}-vignette)`} pointerEvents="none" /> : null}
    </svg>
  );
}
