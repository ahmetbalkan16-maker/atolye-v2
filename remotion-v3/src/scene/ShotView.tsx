import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { V3CameraKey, V3CastMember, V3Shot } from "../../../src/lib/v3/render/RenderPlanTypes";
import { type AccessoryIndex, Character } from "../character/Character";
import { Effect } from "../character/Effects";
import { headCenter, performerState } from "../character/motion";
import { easeInOut, HEAD_R, INK } from "../character/rig";
import { PropArt } from "./Props";
import { TitleCard } from "./TitleCard";

/** Stage → screen: x across the frame, depth 0 front .. 1 back. */
export function stageTransform(x: number, depth: number, width: number, height: number) {
  const k = height / 1080;
  return { px: x * width, py: height * (0.955 - 0.2 * depth), scale: 0.86 * k * (1 - 0.34 * depth) };
}

function cameraAt(keys: readonly V3CameraKey[], frame: number, fps: number): { zoom: number; cx: number; cy: number } {
  if (keys.length === 0) return { zoom: 1, cx: 0.5, cy: 0.5 };
  let prev = keys[0]!;
  for (let i = 1; i < keys.length; i++) {
    const next = keys[i]!;
    if (frame < next.frame) {
      if (next.ease === "cut") return { zoom: prev.zoom, cx: prev.cx, cy: prev.cy };
      const span = next.ease === "snap" ? Math.min(next.frame - prev.frame, Math.round(fps * 0.22)) : next.frame - prev.frame;
      const begin = next.frame - span;
      const t = frame <= begin ? 0 : easeInOut(Math.min(1, (frame - begin) / Math.max(1, span)));
      return { zoom: prev.zoom + (next.zoom - prev.zoom) * t, cx: prev.cx + (next.cx - prev.cx) * t, cy: prev.cy + (next.cy - prev.cy) * t };
    }
    prev = next;
  }
  return { zoom: prev.zoom, cx: prev.cx, cy: prev.cy };
}

/** Keeps the view inside the stage so no edge of the set is ever shown. */
function clampView(zoom: number, cx: number, cy: number) {
  const z = Math.max(1, zoom);
  const half = 0.5 / z;
  return { zoom: z, cx: Math.min(1 - half, Math.max(half, cx)), cy: Math.min(1 - half, Math.max(half, cy)) };
}

function shakeAt(shot: V3Shot, frame: number): { dx: number; dy: number; rot: number } {
  let dx = 0, dy = 0, rot = 0;
  for (const s of shot.shakes) {
    if (frame < s.start || frame >= s.end) continue;
    const decay = 1 - (frame - s.start) / Math.max(1, s.end - s.start);
    const a = s.amplitude * decay;
    dx += a * Math.sin(frame * 2.3 + 1.1) * Math.cos(frame * 0.7);
    dy += a * Math.sin(frame * 3.1 + 0.4);
    rot += a * 0.04 * Math.sin(frame * 1.9);
  }
  return { dx, dy, rot };
}

export function ShotView({ shot, cast, accessories }: { shot: V3Shot; cast: ReadonlyMap<string, V3CastMember>; accessories: AccessoryIndex }) {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const raw = cameraAt(shot.camera, frame, fps);
  const cam = clampView(raw.zoom, raw.cx, raw.cy);
  const shake = shakeAt(shot, frame);
  // Parallax: the set moves less than the characters; 3% overscan hides the edges during shakes.
  const bgCam = clampView((1 + (cam.zoom - 1) * 0.72) * 1.03, cam.cx, cam.cy);

  const view = (v: { zoom: number; cx: number; cy: number }) =>
    `translate(${W / 2 + shake.dx}px, ${H / 2 + shake.dy}px) rotate(${shake.rot}deg) scale(${v.zoom}) translate(${-v.cx * W}px, ${-v.cy * H}px)`;

  // Background: sets are graded so outlined characters read in front; archival images drift (Ken Burns).
  const bg = shot.background;
  const kb = bg.kenBurns;
  const progress = frame / Math.max(1, shot.duration);
  const kbZoom = kb ? kb.fromZoom + (kb.toZoom - kb.fromZoom) * progress : 1;
  const kbX = kb ? kb.fromX + (kb.toX - kb.fromX) * progress : 0;

  const performers = [...shot.performers].sort((a, b) => b.depth - a.depth);
  const states = performers.map((p) => ({ p, s: performerState(p, frame, fps), m: cast.get(p.castId) }));

  // Transition in.
  let wrapStyle: React.CSSProperties = {};
  let flash = 0;
  const tf = Math.round(fps * 0.32);
  if (frame < tf) {
    const t = easeInOut(frame / tf);
    if (shot.transitionIn === "kaydir") wrapStyle = { transform: `translateX(${(1 - t) * W * 0.35}px)`, filter: `blur(${(1 - t) * 18}px)` };
    if (shot.transitionIn === "murekkep") wrapStyle = { clipPath: `circle(${t * 120}% at 50% 55%)` };
    if (shot.transitionIn === "beyaz") flash = 1 - t;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#15121c", overflow: "hidden" }}>
      <AbsoluteFill style={wrapStyle}>
        <AbsoluteFill style={{ transform: view(bgCam), transformOrigin: "0 0" }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, overflow: "hidden" }}>
            <Img
              src={staticFile(bg.src)}
              style={{
                width: W,
                height: H,
                objectFit: "cover",
                transform: `scale(${kbZoom}) translateX(${kbX * W}px)`,
                filter: bg.kind === "set" ? "saturate(0.88) contrast(1.04) brightness(1.03) blur(1.6px)" : "sepia(0.12) contrast(1.06)",
              }}
            />
            {shot.mapArrows.length ? (
              <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, transform: `scale(${kbZoom}) translateX(${kbX * W}px)` }}>
                {shot.mapArrows.map((a, i) => {
                  const draw = interpolate(frame, [a.start, a.end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                  const d = a.points.map((pt, k) => `${k === 0 ? "M" : "L"}${pt.x * W} ${pt.y * H}`).join(" ");
                  const last = a.points[a.points.length - 1]!;
                  const prev = a.points[a.points.length - 2] ?? last;
                  const ang = (Math.atan2((last.y - prev.y) * H, (last.x - prev.x) * W) * 180) / Math.PI;
                  return (
                    <g key={i}>
                      <path d={d} fill="none" stroke={INK} strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={draw} />
                      <path d={d} fill="none" stroke={a.color} strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={draw} />
                      {draw < 0.02 ? <path transform={`translate(${last.x * W} ${last.y * H}) rotate(${ang})`} d="M18 0 L-22 -24 L-12 0 L-22 24 Z" fill={a.color} stroke={INK} strokeWidth={5} strokeLinejoin="round" /> : null}
                    </g>
                  );
                })}
              </svg>
            ) : null}
          </div>
          {bg.kind === "set" ? (
            <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(20,10,30,0.38) 100%)" }} />
          ) : null}
          {bg.kind === "set" ? (
            // Floor grade: the lower band darkens slightly so characters read as standing on a surface.
            <div style={{ position: "absolute", left: 0, top: H * 0.7, width: W, height: H * 0.3, background: "linear-gradient(rgba(30,18,24,0), rgba(30,18,24,0.22))" }} />
          ) : null}
        </AbsoluteFill>

        <AbsoluteFill style={{ transform: view(cam), transformOrigin: "0 0" }}>
          <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            <defs>
              <filter id="v3-golge" x="-60%" y="-200%" width="220%" height="500%">
                <feGaussianBlur stdDeviation="9" />
              </filter>
            </defs>
            {shot.props.map((pr, i) => {
              const st = stageTransform(pr.x, pr.depth, W, H);
              const s = st.scale * (pr.scale ?? 1);
              return (
                <g key={i} transform={`translate(${st.px} ${st.py}) scale(${pr.flip ? -s : s} ${s})`}>
                  <PropArt kind={pr.kind} />
                </g>
              );
            })}
            {states.map(({ p, s, m }) => {
              if (!m || !s.visible) return null;
              const st = stageTransform(s.x, p.depth, W, H);
              const k = st.scale * m.scale;
              const mirror = s.facing === "left" ? -1 : 1;
              return (
                <g key={p.castId} transform={`translate(${st.px} ${st.py}) scale(${k * mirror} ${k})`}>
                  <Character member={m} state={s} accessories={accessories} />
                </g>
              );
            })}
            {states.map(({ p, s, m }) => {
              if (!m || !s.visible || s.effects.length === 0) return null;
              const st = stageTransform(s.x, p.depth, W, H);
              const k = st.scale * m.scale;
              const hc = headCenter(s.pose);
              const mirror = s.facing === "left" ? -1 : 1;
              const hx = st.px + hc.x * k * mirror;
              const hy = st.py + (hc.y + (s.seated ? 58 : 0)) * k;
              return (
                <g key={`fx-${p.castId}`}>
                  {s.effects.map((e, i) => (
                    <Effect key={i} effect={e.effect} progress={e.progress} x={hx} y={hy} r={HEAD_R * k} />
                  ))}
                </g>
              );
            })}
          </svg>
        </AbsoluteFill>
      </AbsoluteFill>

      {shot.titleCards.map((c, i) => (
        <TitleCard key={i} card={c} />
      ))}
      {shot.dramatized ? (
        <div style={{ position: "absolute", left: 36, top: 30, padding: "6px 14px", borderRadius: 8, background: "rgba(20,16,28,0.55)", color: "#f3ead7", font: "700 20px 'Segoe UI', Arial, sans-serif", letterSpacing: 2 }}>
          CANLANDIRMA
        </div>
      ) : null}
      {flash > 0 ? <AbsoluteFill style={{ backgroundColor: "#ffffff", opacity: flash }} /> : null}
    </AbsoluteFill>
  );
}
