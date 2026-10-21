import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { V3CastMember, V3Shot } from "../../../src/lib/v3/render/RenderPlanTypes";
import { type AccessoryIndex, Character } from "../character/Character";
import { Effect } from "../character/Effects";
import { extraState } from "../character/extras";
import { headCenter, performerState, turnStretch } from "../character/motion";
import { easeInOut, HEAD_R, INK } from "../character/rig";
import { cameraAt, clampView, filmCamera, shakeAt } from "./camera";
import { MapView } from "./MapView";
import { type HeadAnchor, InsertView, NameTag, SpeechBubble } from "./Overlays";
import { PropArt } from "./Props";
import { TitleCard } from "./TitleCard";

/** Stage → screen: x across the frame, depth 0 front .. 1 back. */
export function stageTransform(x: number, depth: number, width: number, height: number) {
  const k = height / 1080;
  return { px: x * width, py: height * (0.955 - 0.2 * depth), scale: 0.86 * k * (1 - 0.34 * depth) };
}

export function ShotView({ shot, cast, accessories, language = "tr" }: { shot: V3Shot; cast: ReadonlyMap<string, V3CastMember>; accessories: AccessoryIndex; language?: "tr" | "en" }) {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const raw = filmCamera(cameraAt(shot.camera, frame, fps), shot.id, frame, shot.duration, fps);
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
  // The crowd stands behind every actor, slightly hazed by distance (one filter for the whole group).
  const extras = [...(shot.extras ?? [])].sort((a, b) => b.depth - a.depth);

  // Screen position of each visible head (camera, shake and stage depth applied), for bubbles and name tags.
  const toScreen = (x: number, y: number) => ({ x: W / 2 + shake.dx + cam.zoom * (x - cam.cx * W), y: H / 2 + shake.dy + cam.zoom * (y - cam.cy * H) });
  const heads = new Map<string, { x: number; top: number; r: number }>();
  for (const { p, s, m } of states) {
    if (!m || !s.visible) continue;
    const st = stageTransform(s.x, p.depth, W, H);
    const k = st.scale * m.scale;
    const hc = headCenter(s.pose);
    const centre = toScreen(st.px + hc.x * k * s.mirror, st.py + (hc.y + (s.seated ? 58 : 0)) * k * turnStretch(s.mirror));
    // Headwear (turbans, crowns) reaches about one head radius above the head.
    heads.set(p.castId, { x: centre.x, top: centre.y - 2.05 * HEAD_R * k * cam.zoom, r: HEAD_R * k * cam.zoom });
  }
  const anchorOf = (castId: string): HeadAnchor | undefined => {
    const h = heads.get(castId);
    if (!h) return undefined;
    let neighbourX: number | undefined;
    for (const [id, o] of heads) if (id !== castId && o.x > 0 && o.x < W && (neighbourX === undefined || Math.abs(o.x - h.x) < Math.abs(neighbourX - h.x))) neighbourX = o.x;
    return { x: h.x, top: h.top, r: h.r, ...(neighbourX !== undefined ? { neighbourX } : {}) };
  };
  // While a period image is cut in, the set and everything on it is hidden.
  const insertOn = (shot.inserts ?? []).some((i) => frame >= i.start && frame < i.end);

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
            {shot.geoMap ? (
              <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `scale(${kbZoom}) translateX(${kbX * W}px)` }}>
                <MapView map={shot.geoMap} width={W} height={H} cast={cast} accessories={accessories} />
              </div>
            ) : (
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
            )}
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
            {extras.length ? (
              <g style={{ filter: "saturate(0.8) brightness(0.93) contrast(0.92)" }}>
                {extras.map((e, i) => {
                  const m = cast.get(e.castId);
                  if (!m) return null;
                  const s = extraState(e, frame, fps);
                  const st = stageTransform(e.x, e.depth, W, H);
                  const k = st.scale * m.scale * e.scale;
                  return (
                    <g key={`x-${i}`} transform={`translate(${st.px} ${st.py}) scale(${k * s.mirror} ${k})`}>
                      <Character member={m} state={s} accessories={accessories} cheap />
                    </g>
                  );
                })}
              </g>
            ) : null}
            {states.map(({ p, s, m }) => {
              if (!m || !s.visible) return null;
              const st = stageTransform(s.x, p.depth, W, H);
              const k = st.scale * m.scale;
              return (
                <g key={p.castId} transform={`translate(${st.px} ${st.py}) scale(${k * s.mirror} ${k * turnStretch(s.mirror)})`}>
                  <Character member={m} state={s} accessories={accessories} />
                </g>
              );
            })}
            {states.map(({ p, s, m }) => {
              if (!m || !s.visible || s.effects.length === 0) return null;
              const st = stageTransform(s.x, p.depth, W, H);
              const k = st.scale * m.scale;
              const hc = headCenter(s.pose);
              const hx = st.px + hc.x * k * s.mirror;
              const hy = st.py + (hc.y + (s.seated ? 58 : 0)) * k * turnStretch(s.mirror);
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

      {(shot.inserts ?? []).map((ins, i) => (
        <InsertView key={`ins-${i}`} insert={ins} />
      ))}
      {insertOn
        ? null
        : (shot.bubbles ?? []).map((b, i) => {
            const anchor = anchorOf(b.castId);
            return anchor ? <SpeechBubble key={`b-${i}`} bubble={b} anchor={anchor} language={language} /> : null;
          })}
      {insertOn
        ? null
        : (shot.nameTags ?? []).map((t, i) => {
            const a = anchorOf(t.castId);
            return a ? <NameTag key={`n-${i}`} tag={t} anchor={a} language={language} /> : null;
          })}
      {shot.titleCards.map((c, i) => (
        <TitleCard key={i} card={c} />
      ))}
      {shot.dramatized && !insertOn ? (
        <div style={{ position: "absolute", left: 36, top: 30, padding: "6px 14px", borderRadius: 8, background: "rgba(20,16,28,0.55)", color: "#f3ead7", font: "700 20px 'Segoe UI', Arial, sans-serif", letterSpacing: 2 }}>
          {language === "en" ? "DRAMATIZATION" : "CANLANDIRMA"}
        </div>
      ) : null}
      {flash > 0 ? <AbsoluteFill style={{ backgroundColor: "#ffffff", opacity: flash }} /> : null}
    </AbsoluteFill>
  );
}
