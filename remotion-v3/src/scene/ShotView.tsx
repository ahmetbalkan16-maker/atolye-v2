import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { transitionFrames, type V3CastMember, type V3Performer, type V3Shot, type V3Transition } from "../../../src/lib/v3/render/RenderPlanTypes";
import { type AccessoryIndex, Character } from "../character/Character";
import { Effect } from "../character/Effects";
import { extraState } from "../character/extras";
import { Horse, RiderLeg, SADDLE_X, SADDLE_Y } from "../character/Horse";
import { headCenter, type PerformerState, performerState, turnStretch } from "../character/motion";
import { drift, HEAD_R, HIP_Y, INK } from "../character/rig";
import { cameraAt, clampView, coverShake, filmCamera, shakeAt } from "./camera";
import { DepthFilter, depthFilterId, depthShift, useDepthMap } from "./DepthFilter";
import { DrawnSetBack, DrawnSetFront, FIGURE_COVER, InWater, inRiver, riverDepth, type SetCover } from "./DrawnSet";
import { InfoCardView } from "./InfoCard";
import { mapBubbleSize } from "./mapEffects";
import { MapHud } from "./MapMarks";
import { AtlasCorner, badgeAnchor, badgeAt, cameraAt as mapCameraAt, MapView } from "./MapView";
import { tiltAt } from "./tilt";
import { type HeadAnchor, InsertView, NameTag, SpeechBubble, TitleStrip } from "./Overlays";
import { PropArt } from "./Props";
import { TitleCard } from "./TitleCard";
import { type AimX, beatAim, beatAt, BODY_PER_HEAD, MAP_BEAT_ID, mapBeats, pairAim, windowAims, windowArrival, windowCentre, windowDeparture, withMapBeats } from "./verticalWindow";
import { layerStyle, transitionLook, transitionProgress } from "./transitions";

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

/** Stage → screen: x across the frame, depth 0 front .. 1 back. */
export function stageTransform(x: number, depth: number, width: number, height: number) {
  const k = height / 1080;
  return { px: x * width, py: height * (0.955 - 0.2 * depth), scale: 0.86 * k * (1 - 0.34 * depth) };
}

/**
 * One shot. `exit`: the next shot's transition, for the frames past this shot's end that it stays drawn under the next
 * one (Episode) — pushed aside by a slide, dimmed under an iris.
 */
export function ShotView({ shot, cast, accessories, language = "tr", stage, exit }: { shot: V3Shot; cast: ReadonlyMap<string, V3CastMember>; accessories: AccessoryIndex; language?: "tr" | "en"; stage?: { width: number; height: number }; exit?: { kind: V3Transition; frames: number } }) {
  const frame = useCurrentFrame();
  const { fps, width: OW, height: OH } = useVideoConfig();
  // W × H: the stage the shot is laid out on — the frame itself, or for a Short (OW × OH = 1080 × 1920) the 16:9 stage
  // under a vertical window. Titles, cards and speech are laid out on the frame.
  const W = stage?.width ?? OW;
  const H = stage?.height ?? OH;
  const raw = filmCamera(cameraAt(shot.camera, frame, fps), shot.id, frame, shot.duration, fps);
  const cam = clampView(raw.zoom, raw.cx, raw.cy);
  const shake = shakeAt(shot, frame);
  // Parallax: the set moves less than the characters; 3% overscan, and as much more as a strong shake needs, hides the
  // stage's edges (coverShake).
  const bgCam = coverShake({ zoom: (1 + (cam.zoom - 1) * 0.72) * 1.03, cx: cam.cx, cy: cam.cy }, shake, W, H);

  const view = (v: { zoom: number; cx: number; cy: number }) =>
    `translate(${W / 2 + shake.dx}px, ${H / 2 + shake.dy}px) rotate(${shake.rot}deg) scale(${v.zoom}) translate(${-v.cx * W}px, ${-v.cy * H}px)`;

  // Background: sets are graded so outlined characters read in front; archival images drift (Ken Burns).
  const bg = shot.background;
  // A drawn living set (no image): composed and animated here; while a period image is cut in it is not drawn at all.
  const drawn = bg.kind === "drawn" ? bg.drawn : undefined;
  const kb = bg.kenBurns;
  // The drift eases in and out gently (a linear one started and stopped with a jolt at every cut).
  const progress = drift(frame / Math.max(1, shot.duration));
  const kbZoom = kb ? kb.fromZoom + (kb.toZoom - kb.fromZoom) * progress : 1;
  const kbX = kb ? kb.fromX + (kb.toX - kb.fromX) * progress : 0;
  // An archival picture with a depth map moves in 2.5D along its drift (DepthFilter); without one, as before.
  const depthHref = useDepthMap(bg.kind === "archival" && !shot.geoMap ? bg.depth : undefined);
  const depthId = depthFilterId("arka", shot.id);
  // The part of the map's own picture that ends up in the frame, back through the set's camera and the slow push about
  // the middle (shake left out): a map keeps its labels inside this, not inside its own picture (Kosovo 1389: a routed
  // side's label stood inside the map's view but was cut at the top edge of the frame).
  const unview = (q: { x: number; y: number }) => {
    const pushed = { x: bgCam.cx * W + (q.x - W / 2) / bgCam.zoom, y: bgCam.cy * H + (q.y - H / 2) / bgCam.zoom };
    return { x: W / 2 + (pushed.x - W / 2) / kbZoom - kbX * W, y: H / 2 + (pushed.y - H / 2) / kbZoom };
  };
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
    const hc = headCenter(s.pose, s.fallen);
    const ride = p.mount ? { x: SADDLE_X, y: SADDLE_Y - HIP_Y } : { x: 0, y: 0 };
    const centre = toScreen(st.px + (hc.x + ride.x) * k * s.mirror, st.py + (hc.y + ride.y + (s.seated ? 58 : 0)) * k * turnStretch(s.mirror));
    // Headwear (turbans, crowns) reaches about one head radius above the head.
    heads.set(p.castId, { x: centre.x, top: centre.y - 2.05 * HEAD_R * k * cam.zoom, r: HEAD_R * k * cam.zoom });
  }
  // What stands in front of the set's torches, in the set's own (parallax) space: a torch hidden behind an actor or an
  // extra gives no glow (Siege of Baghdad Short, 13 Nov 2026: "1 tane meşale gözüküyor, 2 tane parlıyor ekranda").
  const toSet = (q: { x: number; y: number }) => ({ x: (q.x - W / 2 - shake.dx) / bgCam.zoom + bgCam.cx * W, y: (q.y - H / 2 - shake.dy) / bgCam.zoom + bgCam.cy * H });
  const covers: SetCover[] = [];
  const cover = (x: number, depth: number, k: number, lift: number) => {
    const st = stageTransform(x, depth, W, H);
    const a = toSet(toScreen(st.px - FIGURE_COVER.half * k, st.py + (FIGURE_COVER.top + lift) * k));
    const b = toSet(toScreen(st.px + FIGURE_COVER.half * k, st.py));
    covers.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
  };
  if (drawn) {
    for (const { p, s, m } of states) if (m && s.visible && (s.fallen ?? 0) < 0.5) cover(s.x, p.depth, stageTransform(s.x, p.depth, W, H).scale * m.scale, p.mount ? SADDLE_Y - HIP_Y : 0);
    for (const e of extras) {
      const m = cast.get(e.castId);
      const s = m ? extraState(e, frame, fps) : undefined;
      if (m && s?.visible && (s.fallen ?? 0) < 0.5) cover(s.x, e.depth, stageTransform(s.x, e.depth, W, H).scale * m.scale * e.scale, 0);
    }
  }
  // A badge speaking on the map (MapSpeakers): its place on the map's screen, through the map layer's own transforms —
  // the slow push about the frame's middle, then the set's camera.
  const geo = shot.geoMap;
  const push = (x: number, y: number) => ({ x: W / 2 + kbZoom * (x + kbX * W - W / 2), y: H / 2 + kbZoom * (y - H / 2) });
  const onSet = (p: { x: number; y: number }) => ({ x: W / 2 + shake.dx + bgCam.zoom * (p.x - bgCam.cx * W), y: H / 2 + shake.dy + bgCam.zoom * (p.y - bgCam.cy * H) });
  const badgeHeads = new Set<string>();
  for (const b of geo?.badges ?? []) {
    if (!b.talk || heads.has(b.castId) || frame < b.start || (b.end !== undefined && frame >= b.end)) continue;
    const a = badgeAnchor(geo!, b, frame, fps, W, H, shot.duration);
    const at = onSet(push(a.x, a.top));
    heads.set(b.castId, { x: at.x, top: at.y, r: a.r * kbZoom * bgCam.zoom });
    badgeHeads.add(b.castId);
  }
  // A Short (owner, 2 Nov 2026): the stage's full height fills the frame, so about a third of its width shows; the
  // window follows whoever speaks (their bubble), gliding to a new speaker, and while no one speaks holds the shot's
  // lead (else the middle of the actors on stage; the middle of the stage on a map).
  const fit = OH / H;
  const winW = OW / fit;
  const vertical = winW < W - 1;
  let winX = 0;
  // The window turns to a speaker's words, and to whom the narration acts out (`focus`); on a map with no one on its
  // stage, to what happens on the map as well (and back to it after a badge's words).
  const turns = vertical ? [...(shot.bubbles ?? []), ...(shot.focus ?? [])].filter((b) => heads.has(b.castId)) : [];
  const onStage = states.some(({ p }) => heads.has(p.castId) && !badgeHeads.has(p.castId));
  const beats = vertical && geo ? mapBeats(geo, fps) : [];
  // With someone on the stage the window stays on them; the map's beats only pull it (a lone character, below).
  const aims = vertical ? withMapBeats(windowAims(turns, fps), onStage ? [] : beats, turns, fps) : [];
  let aimX: AimX = (id) => (id ? heads.get(id)?.x : undefined) ?? W / 2;
  if (vertical) {
    const actors = states.flatMap(({ p }) => (heads.has(p.castId) && !badgeHeads.has(p.castId) ? [{ id: p.castId, ...heads.get(p.castId)! }] : []));
    // A map beat's place on the stage now: the map's own camera, then the slow push and the set's camera.
    const mapCam = geo ? mapCameraAt(geo.camera, frame, fps, W, H) : undefined;
    const stageX = (wx: number) => (mapCam ? onSet(push(W / 2 + mapCam.zoom * (wx - mapCam.x), 0)).x : wx);
    // A marching badge is followed where it is now; anything else is framed whole, its end kept in.
    const beatX = (i: number) => {
      const b = beats[i]!;
      const badge = b.badge !== undefined ? geo?.badges?.[b.badge] : undefined;
      return badge ? stageX(badgeAt(geo!, badge, frame, fps, H, shot.duration).at.x) : beatAim(b.xs.map(stageX), stageX(b.last), winW);
    };
    // A lone character over a Short's map is seen with what happens on the map then, beside them (the Taranto Short's
    // sailor stood in front of empty sea for 15 s while the ships went down off the window, 11 Nov 2026).
    const mapPartner = actors.length === 1 && beats.length ? { x: beatX(beatAt(beats, frame, fps)) } : undefined;
    const lone = actors.length === 1 ? actors[0]! : undefined;
    const middle = lone && mapPartner ? pairAim(lone.x, lone.r * BODY_PER_HEAD, [mapPartner], winW) : actors.length ? actors.reduce((a, b) => a + b.x, 0) / actors.length : beats.length ? beatX(beatAt(beats, frame, fps)) : W / 2;
    const restId = shot.lead && !badgeHeads.has(shot.lead) && heads.has(shot.lead) ? shot.lead : undefined;
    // On a speaker (or the resting lead), and the one they talk with beside them when both fit; with no partner, the
    // nearest — a near tie settled by name, so the window never flips between two neighbours as a head turns.
    const withPartner = (id: string | undefined, partner: string | undefined) => {
      const h = id ? actors.find((a) => a.id === id) : undefined;
      if (!h) return undefined;
      const p = partner && partner !== id ? actors.find((a) => a.id === partner) : undefined;
      const others = actors.filter((a) => a.id !== id);
      const near = Math.min(...others.map((a) => Math.abs(a.x - h.x)));
      const nearest = others.filter((a) => Math.abs(a.x - h.x) <= near * 1.1 + 1).sort((a, b) => a.id.localeCompare(b.id))[0];
      return pairAim(h.x, h.r * BODY_PER_HEAD, p ? [p] : nearest ? [nearest] : mapPartner ? [mapPartner] : [], winW);
    };
    aimX = (id, partner) => (id?.startsWith(MAP_BEAT_ID) ? beatX(Number(id.slice(MAP_BEAT_ID.length))) : id ? (badgeHeads.has(id) ? heads.get(id)?.x : withPartner(id, partner)) : undefined) ?? withPartner(restId, partner) ?? middle;
    winX = Math.min(W - winW, Math.max(0, windowCentre(aims, frame, fps, aimX) - winW / 2));
  }
  // The part of the map's own picture in the frame (the window's, for a Short).
  const [seenA, seenB] = [unview({ x: winX, y: 0 }), unview({ x: winX + (vertical ? winW : W), y: H })];
  const mapVisible = { x0: Math.max(0, seenA.x), y0: Math.max(0, seenA.y), x1: Math.min(W, seenB.x), y1: Math.min(H, seenB.y) };
  // Stage → frame (identity unless a Short).
  const toFrameX = (x: number) => (x - winX) * fit;
  const anchorOf = (castId: string): HeadAnchor | undefined => {
    const h = heads.get(castId);
    if (!h) return undefined;
    let neighbourX: number | undefined;
    for (const [id, o] of heads) if (id !== castId && toFrameX(o.x) > 0 && toFrameX(o.x) < OW && (neighbourX === undefined || Math.abs(o.x - h.x) < Math.abs(neighbourX - h.x))) neighbourX = o.x;
    return { x: toFrameX(h.x), top: h.top * fit, r: h.r * fit, ...(neighbourX !== undefined ? { neighbourX: toFrameX(neighbourX) } : {}) };
  };
  // While a period image is cut in, the set and everything on it is hidden.
  const insertOn = (shot.inserts ?? []).some((i) => frame >= i.start && frame < i.end);

  // The transition in, over the last shot still drawn underneath (Episode); or this shot's own exit under the next one.
  // The whole frame moves (a Short's window with it), its words and cards too.
  const tf = transitionFrames(shot, fps);
  const entering = frame < tf ? transitionLook(shot.transitionIn, transitionProgress(frame, tf), OW, OH) : undefined;
  const look = entering ? entering.incoming : exit && frame >= shot.duration ? transitionLook(exit.kind, transitionProgress(frame - shot.duration, exit.frames), OW, OH).outgoing : undefined;
  const flash = entering?.flash ?? 0;

  return (
    <AbsoluteFill>
    <AbsoluteFill style={{ backgroundColor: "#15121c", overflow: "hidden", ...(look ? layerStyle(look) : {}) }}>
      {/* The stage; for a Short, scaled to the frame's height and slid to the window. */}
      <div style={vertical ? { position: "absolute", left: 0, top: 0, width: W, height: H, transform: `translate(${-winX * fit}px, 0px) scale(${fit})`, transformOrigin: "0 0" } : { position: "absolute", inset: 0 }}>
      <AbsoluteFill>
        <AbsoluteFill style={{ transform: view(bgCam), transformOrigin: "0 0" }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, overflow: "hidden" }}>
            {shot.geoMap ? (
              <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `scale(${kbZoom}) translateX(${kbX * W}px)` }}>
                <MapView map={shot.geoMap} width={W} height={H} cast={cast} accessories={accessories} duration={shot.duration} seen={mapVisible} screen={{ width: OW, height: OH }} />
              </div>
            ) : drawn ? (
              <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "hidden" }}>
                <DrawnSetBack spec={drawn} W={W} H={H} frame={frame} />
              </svg>
            ) : (
            <>
            {depthHref ? <DepthFilter id={depthId} href={depthHref} width={W} height={H} fit="slice" shift={depthShift(progress, kb, W)} /> : null}
            <Img
              src={staticFile(bg.src)}
              style={{
                width: W,
                height: H,
                objectFit: "cover",
                transform: `scale(${kbZoom}) translateX(${kbX * W}px)`,
                filter: bg.kind === "set" ? "saturate(0.88) contrast(1.04) brightness(1.03) blur(1.6px)" : `${depthHref ? `url(#${depthId}) ` : ""}sepia(0.12) contrast(1.06)`,
              }}
            />
            </>
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
              const hc = headCenter(s.pose, s.fallen);
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
              <DrawnSetFront spec={drawn} W={W} H={H} frame={frame} covers={covers} />
            </svg>
          </AbsoluteFill>
        ) : null}
      </AbsoluteFill>
      </div>

      {(shot.inserts ?? []).map((ins, i) => (
        <InsertView key={`ins-${i}`} insert={ins} />
      ))}
      {insertOn
        ? null
        : (shot.bubbles ?? []).map((b, i) => {
            const anchor = anchorOf(b.castId);
            // In a Short the words wait for the window to reach their speaker (they floated over the set before).
            const from = vertical ? Math.min(b.end - 1, windowArrival(aims, b.castId, b.start, fps, aimX)) : b.start;
            const bubble = from > b.start ? { ...b, start: from } : b;
            // A badge's words on the map (MapBuilder leaves room for them over the badge): smaller than a character's on a
            // wide frame, full size in a Short, on a dark plate so they read over the land and sea.
            const onMap = badgeHeads.has(b.castId);
            return anchor ? <SpeechBubble key={`b-${i}`} bubble={bubble} anchor={anchor} language={language} size={onMap ? mapBubbleSize(vertical) : 1} plate={onMap} /> : null;
          })}
      {insertOn
        ? null
        : (shot.nameTags ?? []).map((t, i) => {
            const a = anchorOf(t.castId);
            // In a Short the tag waits for the window to reach its speaker, stays as long, and goes when the window
            // leaves them (shown at least 0.8 s).
            const from = vertical ? windowArrival(aims, t.castId, t.start, fps, aimX) : t.start;
            const leaves = vertical ? Math.max(from + Math.round(fps * 0.8), windowDeparture(aims, t.castId, t.start, fps, aimX)) : Infinity;
            const tag = from > t.start || leaves < t.end ? { ...t, start: from, end: Math.min(t.end + (from - t.start), leaves) } : t;
            return a ? <NameTag key={`n-${i}`} tag={tag} anchor={a} language={language} /> : null;
          })}
      {/* The relief map's compass and km scale stay fixed on the screen (inside the cameras they drifted to the edge); the
          scale counts every zoom the map is seen through: its own camera, the shot camera, the slow push and a tilted
          map's camera (its scale at the picture's middle row). */}
      {shot.geoMap?.relief && shot.geoMap.kmPerPx && !insertOn ? (
        <svg width={OW} height={OH} style={{ position: "absolute", left: 0, top: 0 }}>
          <AtlasCorner kmPerScreenPx={shot.geoMap.kmPerPx / (mapCameraAt(shot.geoMap.camera, frame, fps, W, H).zoom * bgCam.zoom * kbZoom * fit * (shot.geoMap.tilt ? tiltAt(shot.geoMap, frame, fps, W, H)!.s : 1))} height={OH} width={OW} />
        </svg>
      ) : null}
      {/* The narrator's headline strips (photo documentaries), over the pictures. */}
      {(shot.strips ?? []).map((s, i) => (
        <TitleStrip key={`st-${i}`} strip={s} language={language} />
      ))}
      {/* The strength bar and the date stamp stay fixed on the screen over the moving map. */}
      {shot.geoMap && !insertOn ? <MapHud map={shot.geoMap} frame={frame} fps={fps} W={OW} H={OH} /> : null}
      {/* Info cards dim everything under them (DFT Tarih's charts, lists and counters over the map). */}
      {(shot.infoCards ?? []).map((c, i) => (
        <InfoCardView key={`ic-${i}`} card={c} cast={cast} accessories={accessories} language={language} />
      ))}
      {/* Words float over the heads, high in the frame, where the place-and-date stamp stands: on a stage where a
          character speaks while the stamp is up, it goes bottom-left (Guadalcanal, 12 Nov 2026: the stamp covered Abe's
          opening line for its first 2.7 s). Decided once per card, so it never jumps. */}
      {shot.titleCards.map((c, i) => (
        <TitleCard key={i} card={c} low={c.style === "yer_tarih" && !shot.geoMap && (shot.bubbles ?? []).some((b) => !badgeHeads.has(b.castId) && b.start < c.end && b.end > c.start)} />
      ))}
      {/* No "DRAMATIZATION" corner label (owner, 23 Oct 2026: "kaldır o yazılar gözükmesin"); the plan still marks it. */}
    </AbsoluteFill>
      {/* The white flash lies over this shot and the last one under it, also while this one is still hidden. */}
      {flash > 0 ? <AbsoluteFill style={{ backgroundColor: "#ffffff", opacity: flash }} /> : null}
    </AbsoluteFill>
  );
}
