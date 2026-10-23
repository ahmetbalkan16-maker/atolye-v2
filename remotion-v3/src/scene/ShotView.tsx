import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { V3CastMember, V3Performer, V3Shot } from "../../../src/lib/v3/render/RenderPlanTypes";
import { type AccessoryIndex, Character } from "../character/Character";
import { Effect } from "../character/Effects";
import { extraState } from "../character/extras";
import { Horse, RiderLeg, SADDLE_X, SADDLE_Y } from "../character/Horse";
import { headCenter, type PerformerState, performerState, turnStretch } from "../character/motion";
import { easeInOut, HEAD_R, HIP_Y, INK } from "../character/rig";
import { cameraAt, clampView, filmCamera, shakeAt } from "./camera";
import { DrawnSetBack, DrawnSetFront, InWater, inRiver, riverDepth } from "./DrawnSet";
import { AtlasCorner, badgeAnchor, cameraAt as mapCameraAt, MapView } from "./MapView";
import { type HeadAnchor, InsertView, NameTag, SpeechBubble } from "./Overlays";
import { PropArt } from "./Props";
import { TitleCard } from "./TitleCard";

/** A mounted performer: the horse (walking while the rider's x changes), the rider from the hips up, the near leg. */
function Rider({ p, s, m, frame, fps, accessories }: { p: V3Performer; s: PerformerState; m: V3CastMember; frame: number; fps: number; accessories: AccessoryIndex }) {
  const before = frame > 0 ? performerState(p, frame - 1, fps).x : s.x;
  const speed = Math.abs(s.x - before) * fps;
  const walk = { phase: (s.x / 0.05) * Math.PI, amount: Math.min(1, speed / 0.12) };
  const id = `rider-cut-${p.castId}`;
  return (
    <g>
      <Horse walk={walk} time={frame / fps} cloth={m.costume.colors.second} seed={p.castId.length} />
      <defs>
        <clipPath id={id}>
          <rect x={-900} y={-4000} width={1800} height={4000 + HIP_Y + 24} />
        </clipPath>
      </defs>
      <g transform={`translate(${SADDLE_X} ${SADDLE_Y - HIP_Y})`}>
        <g clipPath={`url(#${id})`}>
          <Character member={m} state={{ ...s, seated: false }} accessories={accessories} cheap />
        </g>
      </g>
      <RiderLeg cloth={m.costume.colors.main} boot="#5a3a22" />
    </g>
  );
}

/** A badge's words on the map, against a character's on the stage (MapBuilder leaves room for them over the badge). */
const MAP_BUBBLE = 0.72;

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
  // A drawn living set (no image): composed and animated here; while a period image is cut in it is not drawn at all.
  const drawn = bg.kind === "drawn" ? bg.drawn : undefined;
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
    const ride = p.mount ? { x: SADDLE_X, y: SADDLE_Y - HIP_Y } : { x: 0, y: 0 };
    const centre = toScreen(st.px + (hc.x + ride.x) * k * s.mirror, st.py + (hc.y + ride.y + (s.seated ? 58 : 0)) * k * turnStretch(s.mirror));
    // Headwear (turbans, crowns) reaches about one head radius above the head.
    heads.set(p.castId, { x: centre.x, top: centre.y - 2.05 * HEAD_R * k * cam.zoom, r: HEAD_R * k * cam.zoom });
  }
  // A badge speaking on the map (MapSpeakers): its place on the map's screen, through the map layer's own transforms —
  // the slow push about the frame's middle, then the set's camera.
  const geo = shot.geoMap;
  const badgeHeads = new Set<string>();
  for (const b of geo?.badges ?? []) {
    if (!b.talk || heads.has(b.castId) || frame < b.start || (b.end !== undefined && frame >= b.end)) continue;
    const a = badgeAnchor(geo!, b, frame, fps, W, H, shot.duration);
    const push = (x: number, y: number) => ({ x: W / 2 + kbZoom * (x + kbX * W - W / 2), y: H / 2 + kbZoom * (y - H / 2) });
    const onSet = (p: { x: number; y: number }) => ({ x: W / 2 + shake.dx + bgCam.zoom * (p.x - bgCam.cx * W), y: H / 2 + shake.dy + bgCam.zoom * (p.y - bgCam.cy * H) });
    const at = onSet(push(a.x, a.top));
    heads.set(b.castId, { x: at.x, top: at.y, r: a.r * kbZoom * bgCam.zoom });
    badgeHeads.add(b.castId);
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
                <MapView map={shot.geoMap} width={W} height={H} cast={cast} accessories={accessories} duration={shot.duration} />
              </div>
            ) : drawn ? (
              <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "hidden" }}>
                <DrawnSetBack spec={drawn} W={W} H={H} frame={frame} />
              </svg>
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
                  if (!s.visible) return null;
                  const st = stageTransform(s.x, e.depth, W, H);
                  const k = st.scale * m.scale * e.scale;
                  return (
                    <g key={`x-${i}`} transform={`translate(${st.px} ${st.py}) scale(${k * s.mirror} ${k})`}>
                      {drawn && inRiver(drawn, s.x, e.depth) ? (
                        <InWater spec={drawn} depth={riverDepth(drawn, s.x, e.depth)} frame={frame} phase={i}>
                          <Character member={m} state={s} accessories={accessories} cheap />
                        </InWater>
                      ) : (
                        <Character member={m} state={s} accessories={accessories} cheap />
                      )}
                    </g>
                  );
                })}
              </g>
            ) : null}
            {states.map(({ p, s, m }) => {
              if (!m || !s.visible) return null;
              const st = stageTransform(s.x, p.depth, W, H);
              const k = st.scale * m.scale;
              // A rider: the horse walks with the rider's own moves; the rider sits in the saddle, seen from the hips up,
              // with the near leg hanging down the horse's side (owner, 22 Oct 2026: horses).
              const figure = p.mount ? <Rider p={p} s={s} m={m} frame={frame} fps={fps} accessories={accessories} /> : <Character member={m} state={s} accessories={accessories} />;
              return (
                <g key={p.castId} transform={`translate(${st.px} ${st.py}) scale(${k * s.mirror} ${k * turnStretch(s.mirror)})`}>
                  {drawn && inRiver(drawn, s.x, p.depth) ? (
                    <InWater spec={drawn} depth={riverDepth(drawn, s.x, p.depth)} frame={frame} phase={100 + performers.indexOf(p)}>
                      {figure}
                    </InWater>
                  ) : (
                    figure
                  )}
                </g>
              );
            })}
            {states.map(({ p, s, m }) => {
              if (!m || !s.visible || s.effects.length === 0) return null;
              const st = stageTransform(s.x, p.depth, W, H);
              const k = st.scale * m.scale;
              const hc = headCenter(s.pose);
              const hx = st.px + hc.x * k * s.mirror;
              const hy = st.py + (hc.y + (p.mount ? SADDLE_Y - HIP_Y : 0) + (s.seated ? 58 : 0)) * k * turnStretch(s.mirror);
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
        {drawn ? (
          // Night grade, torch light, near fog, rain: over the actors, in the set's own (parallax) space.
          <AbsoluteFill style={{ transform: view(bgCam), transformOrigin: "0 0", pointerEvents: "none" }}>
            <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
              <DrawnSetFront spec={drawn} W={W} H={H} frame={frame} />
            </svg>
          </AbsoluteFill>
        ) : null}
      </AbsoluteFill>

      {(shot.inserts ?? []).map((ins, i) => (
        <InsertView key={`ins-${i}`} insert={ins} />
      ))}
      {insertOn
        ? null
        : (shot.bubbles ?? []).map((b, i) => {
            const anchor = anchorOf(b.castId);
            return anchor ? <SpeechBubble key={`b-${i}`} bubble={b} anchor={anchor} language={language} size={badgeHeads.has(b.castId) ? MAP_BUBBLE : 1} /> : null;
          })}
      {insertOn
        ? null
        : (shot.nameTags ?? []).map((t, i) => {
            const a = anchorOf(t.castId);
            return a ? <NameTag key={`n-${i}`} tag={t} anchor={a} language={language} /> : null;
          })}
      {/* The relief map's compass and km scale stay fixed on the screen (inside the cameras they drifted to the edge); the
          scale counts every zoom the map is seen through: its own camera, the shot camera and the slow push. */}
      {shot.geoMap?.relief && shot.geoMap.kmPerPx ? (
        <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
          <AtlasCorner kmPerScreenPx={shot.geoMap.kmPerPx / (mapCameraAt(shot.geoMap.camera, frame, fps, W, H).zoom * bgCam.zoom * kbZoom)} height={H} />
        </svg>
      ) : null}
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
