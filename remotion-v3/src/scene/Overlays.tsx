import React from "react";
import { AbsoluteFill, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { V3Bubble, V3Insert, V3NameTag, V3Strip } from "../../../src/lib/v3/render/RenderPlanTypes";
import { drift, INK } from "../character/rig";
import { DepthFilter, depthFilterId, depthShift, useDepthMap } from "./DepthFilter";
import { BUBBLE_FONT } from "./fonts";
import { yer } from "./LayoutProbe";
import { insertOpacity } from "./transitions";
import { wrappedLines } from "./textWrap";

/** Where a speaking character's head is on screen (after camera and shake), in output pixels. */
export interface HeadAnchor {
  readonly x: number;
  /** Top of the headwear. */
  readonly top: number;
  /** Head radius on screen. */
  readonly r: number;
  /** Screen x of the nearest other character on screen, so text leans away from them. */
  readonly neighbourX?: number;
}

const SPEECH_PX = 50;
const SHOUT_PX = 64;
const SPEECH_MAX_W = 760;

/** A short exclamation is lettered as a shout: capitals, bigger. */
export function isShout(text: string): boolean {
  return /!\s*$/.test(text) && text.trim().split(/\s+/).length <= 8;
}

/**
 * The speaker's words floating over their head — white lettering with a heavy ink outline and a small tick
 * toward the speaker, no balloon (the reference channel's look). Pops in, leans away from the nearest other
 * character, stays inside the frame and fades at its end.
 */
export function SpeechBubble({ bubble, anchor, language, size = 1, plate = false }: { bubble: V3Bubble; anchor: HeadAnchor; language: "tr" | "en"; size?: number; plate?: boolean }) {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  if (frame < bubble.start || frame >= bubble.end) return null;
  // `size`: a badge's words on the map are lettered smaller, so they do not cover the battle.
  const k = (Math.min(W, H) / 1080) * size;
  const pop = spring({ frame: frame - bubble.start, fps, config: { damping: 12, stiffness: 220, mass: 0.5 } });
  const out = interpolate(frame, [bubble.end - 5, bubble.end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const shout = isShout(bubble.text);
  // Turkish capitals keep their dots (ŞİMDİ, not ŞIMDI).
  const text = shout ? bubble.text.toLocaleUpperCase(language === "tr" ? "tr-TR" : "en-US") : bubble.text;
  const fs = (shout ? SHOUT_PX : SPEECH_PX) * k;
  const stroke = (shout ? 13 : 11) * k;
  const charW = fs * (shout ? 0.6 : 0.52);
  const guess = Math.max(1, Math.ceil((text.length * charW) / (SPEECH_MAX_W * k)));
  const w = Math.min(SPEECH_MAX_W * k, (text.length * charW) / guess + 24 * k);
  // The lines the words really break into at that width (a long word does not split): the guess from the letter count
  // was one short for "WHY IS THAT DESTROYER DANGEROUSLY CLOSE?!" and the top line stood above the frame (12 Nov 2026).
  const lines = Math.max(guess, wrappedLines(text, w, charW));
  const tick = 30 * k;
  const lean = anchor.neighbourX === undefined ? 0 : anchor.neighbourX < anchor.x ? 0.18 : -0.18;
  const margin = 30 * k;
  const left = Math.min(W - margin - w, Math.max(margin, anchor.x - w / 2 + lean * w));
  const bottom = Math.max(margin + lines * fs * 1.1, anchor.top - tick);
  const tickX = Math.min(left + w - 30 * k, Math.max(left + 30 * k, anchor.x + lean * w * 0.3));
  // `plate`: words over the map stand on a dark see-through plate (owner, 11 Nov 2026: thin white words on the land and
  // sea could not be read), padded outwards so the lines break as before.
  const pad = { x: 16 * k, y: 6 * k };
  const plated = plate ? { left: left - pad.x, padding: `${pad.y}px ${pad.x}px`, backgroundColor: "rgba(14,17,24,0.66)", borderRadius: 14 * k } : { left };
  return (
    <div style={{ position: "absolute", inset: 0, opacity: out, transform: `scale(${0.6 + 0.4 * pop})`, transformOrigin: `${tickX}px ${bottom + tick}px` }}>
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <path d={`M${tickX - 8 * k} ${bottom + 4 * k} L${anchor.x + (tickX - anchor.x) * 0.25} ${bottom + tick - 4 * k}`} stroke={INK} strokeWidth={13 * k} strokeLinecap="round" />
        <path d={`M${tickX - 8 * k} ${bottom + 4 * k} L${anchor.x + (tickX - anchor.x) * 0.25} ${bottom + tick - 4 * k}`} stroke="#ffffff" strokeWidth={5 * k} strokeLinecap="round" />
      </svg>
      <div
        {...yer("balon")}
        style={{
          position: "absolute",
          ...plated,
          bottom: H - bottom,
          width: w,
          textAlign: "center",
          textWrap: "balance",
          font: `700 ${fs}px ${BUBBLE_FONT}`,
          lineHeight: 1.08,
          letterSpacing: (shout ? 1 : 0.3) * k,
          color: "#ffffff",
          WebkitTextStroke: `${stroke}px ${INK}`,
          paintOrder: "stroke fill",
        }}
      >
        {text}
      </div>
    </div>
  );
}

/**
 * Who's who, the first time a character speaks: their name in big outlined capitals beside the head, the role
 * under it, and a red arrow to them — on the side away from their nearest neighbour.
 */
export function NameTag({ tag, anchor, language }: { tag: V3NameTag; anchor: HeadAnchor; language: "tr" | "en" }) {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  if (frame < tag.start || frame >= tag.end) return null;
  const k = Math.min(W, H) / 1080;
  const enter = spring({ frame: frame - tag.start, fps, config: { damping: 13, stiffness: 170 } });
  const out = interpolate(frame, [tag.end - 8, tag.end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const name = tag.name.toLocaleUpperCase(language === "tr" ? "tr-TR" : "en-US");
  // A Short's narrow frame has no room beside a head (the name sat on the turban and the face, 2 Nov 2026): the name
  // stands in the lower third on its own character's body, without the arrow, lettered small enough to stay within
  // about half the frame — two stand side by side in it, and a centred name sat on the other one (3 Nov 2026).
  const narrow = W < H;
  const fs = narrow ? Math.min(54 * k, (W * 0.48) / Math.max(1, name.length * 0.72)) : 54 * k;
  const roleFs = narrow ? Math.max(20 * k, (28 * k * fs) / (54 * k)) : 28 * k;
  const w = Math.max(name.length * fs * 0.72, (tag.role?.length ?? 0) * roleFs * 0.5) + 20 * k;
  const room = { left: anchor.x - anchor.r * 1.3, right: W - anchor.x - anchor.r * 1.3 };
  const preferLeft = anchor.neighbourX !== undefined ? anchor.neighbourX > anchor.x : room.left > room.right;
  const gap = anchor.r * 1.25 + 70 * k;
  const place = (leftSide: boolean) => Math.min(W - 30 * k - w, Math.max(30 * k, leftSide ? anchor.x - gap - w : anchor.x + gap));
  // Squeezed against the frame edge the label would slide onto the face: then it goes to the other side.
  const onFace = (l: number) => l < anchor.x + anchor.r * 1.4 && l + w > anchor.x - anchor.r * 1.4;
  const onLeft = onFace(place(preferLeft)) && !onFace(place(!preferLeft)) ? !preferLeft : preferLeft;
  const left = narrow ? Math.min(W - 20 * k - w, Math.max(20 * k, anchor.x - w / 2)) : place(onLeft);
  // Beside the face (the speech floats above the head).
  const face = anchor.top + 2.05 * anchor.r;
  const top = narrow ? H * 0.72 : Math.min(H - 160 * k, Math.max(40 * k, face - fs * 0.75));
  // Arrow from the label's inner edge to the side of the head.
  const fromX = onLeft ? left + w - 10 * k : left + 10 * k;
  const fromY = top + fs * 1.1;
  const toX = anchor.x + (onLeft ? -1 : 1) * anchor.r * 1.05;
  const toY = face;
  const draw = interpolate(frame - tag.start, [4, 14], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ang = Math.atan2(toY - (fromY + toY) / 2 - 30 * k, toX - (fromX + toX) / 2);
  const d = `M${fromX} ${fromY} Q${(fromX + toX) / 2} ${Math.max(fromY, toY) + 30 * k} ${toX} ${toY}`;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: out }}>
      {narrow ? null : (
        <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <path d={d} fill="none" stroke={INK} strokeWidth={17 * k} strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={draw} />
          <path d={d} fill="none" stroke="#e0283c" strokeWidth={9 * k} strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={draw} />
          {draw < 0.02 ? <path transform={`translate(${toX} ${toY}) rotate(${(ang * 180) / Math.PI})`} d={`M${8 * k} 0 L${-22 * k} ${-17 * k} L${-14 * k} 0 L${-22 * k} ${17 * k} Z`} fill="#e0283c" stroke={INK} strokeWidth={5 * k} strokeLinejoin="round" /> : null}
        </svg>
      )}
      <div {...yer("ad", tag.name)} style={{ position: "absolute", left, top, width: w, textAlign: narrow ? "center" : onLeft ? "right" : "left", transform: `scale(${0.5 + 0.5 * enter})`, transformOrigin: narrow ? "50% 50%" : onLeft ? "100% 50%" : "0% 50%" }}>
        <div style={{ font: `900 ${fs}px 'Segoe UI Black', 'Arial Black', sans-serif`, color: "#ffffff", WebkitTextStroke: `${(12 * fs) / 54}px ${INK}`, paintOrder: "stroke fill", letterSpacing: 1.5 * k, lineHeight: 1.05 }}>{name}</div>
        {tag.role ? <div style={{ font: `800 ${roleFs}px 'Segoe UI', Arial, sans-serif`, color: "#ffe9a8", WebkitTextStroke: `${7 * k * (roleFs / (28 * k))}px ${INK}`, paintOrder: "stroke fill", marginTop: 2 * k }}>{tag.role}</div> : null}
      </div>
    </div>
  );
}

/**
 * A period image cut in over the set: the picture whole (contain) over a blurred, darkened copy of itself, so a
 * portrait miniature or a narrow map is never cropped to a strip; slow Ken Burns; a short crossfade; a source plate.
 */
export function InsertView({ insert }: { insert: V3Insert }) {
  const frame = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();
  // A still with a depth map moves in 2.5D (DepthFilter); a Short's tall frame pans the picture instead, as before.
  const depthHref = useDepthMap(!insert.video && H <= W ? insert.depth : undefined);
  const depthId = depthFilterId("ara", insert.src, insert.start);
  if (frame < insert.start || frame >= insert.end) return null;
  const k = Math.min(W, H) / 1080;
  const len = Math.max(1, insert.end - insert.start);
  // The drift eases in and out gently; the picture fades in and out eased, over 0.4 s (it was 6 frames, linear).
  const p = drift((frame - insert.start) / len);
  const kb = insert.kenBurns;
  const zoom = kb.fromZoom + (kb.toZoom - kb.fromZoom) * p;
  const dx = (kb.fromX + (kb.toX - kb.fromX) * p) * W;
  // A scene that opens on the picture cuts straight to it (the shot transition handles the change).
  const fade = insertOpacity(frame, insert.start, insert.end, fps);
  const src = staticFile(insert.src);
  if (insert.video) {
    // Archive film (DFT Tarih's newsreels): the clip plays muted from the window's start under the narration, with a
    // faint old-film flicker; it is already cut and letterboxed to the frame.
    const flicker = 1 + Math.sin(frame * 1.7) * 0.015 + Math.sin(frame * 0.53) * 0.01;
    return (
      <AbsoluteFill style={{ opacity: fade, backgroundColor: "#0b0a0d", overflow: "hidden" }}>
        <Sequence from={insert.start} durationInFrames={len} layout="none">
          <div style={{ position: "absolute", inset: 0, transform: `scale(${1 + (zoom - 1) * 0.4})`, filter: `brightness(${flicker}) contrast(1.06)` }}>
            <OffthreadVideo src={src} muted style={{ width: W, height: H, objectFit: "contain" }} />
          </div>
        </Sequence>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 58%, rgba(6,4,8,0.55) 100%)" }} />
        {insert.caption ? (
          <div style={{ position: "absolute", left: 48 * k, bottom: 40 * k, maxWidth: W * 0.6, padding: `${8 * k}px ${16 * k}px`, borderRadius: 8 * k, background: "rgba(16,12,22,0.62)", color: "#f3ead7", font: `600 ${22 * k}px 'Segoe UI', Arial, sans-serif`, letterSpacing: 0.3 * k }}>
            {insert.caption}
          </div>
        ) : null}
      </AbsoluteFill>
    );
  }
  // A Short (owner review, 3 Nov 2026: a landscape painting was a thin band across the middle of the phone): the picture
  // fills the frame and travels across its width, the way the Ken Burns drift goes.
  const tall = H > W;
  const pan = kb.toX < kb.fromX ? 15 + 70 * p : 85 - 70 * p;
  return (
    <AbsoluteFill style={{ opacity: fade, backgroundColor: "#100d16", overflow: "hidden" }}>
      {tall ? null : <Img src={src} style={{ position: "absolute", left: -40, top: -40, width: W + 80, height: H + 80, objectFit: "cover", filter: "blur(28px) brightness(0.42) saturate(0.8)" }} />}
      <div style={{ position: "absolute", inset: 0, transform: tall ? `scale(${1 + (zoom - 1) * 0.5})` : `scale(${zoom}) translateX(${dx}px)` }}>
        {depthHref && !tall ? <DepthFilter id={depthId} href={depthHref} width={W} height={H} fit="meet" shift={depthShift(p, kb, W)} /> : null}
        <Img src={src} style={{ width: W, height: H, objectFit: tall ? "cover" : "contain", ...(tall ? { objectPosition: `${pan}% 50%` } : {}), filter: `${depthHref && !tall ? `url(#${depthId}) ` : ""}sepia(0.08) contrast(1.05)` }} />
      </div>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 62%, rgba(10,6,16,0.45) 100%)" }} />
      {insert.caption ? (
        <div style={{ position: "absolute", left: 48 * k, bottom: 40 * k, maxWidth: W * 0.6, padding: `${8 * k}px ${16 * k}px`, borderRadius: 8 * k, background: "rgba(16,12,22,0.62)", color: "#f3ead7", font: `600 ${22 * k}px 'Segoe UI', Arial, sans-serif`, letterSpacing: 0.3 * k }}>
          {insert.caption}
        </div>
      ) : null}
    </AbsoluteFill>
  );
}

/**
 * The photo documentaries' headline strip (DFT Tarih's Saddam: "Kuwait's waters are heating up…"): a red band slides in
 * from the left at the bottom of the screen with the narrator's headline in white capitals, and slides away at its end.
 */
export function TitleStrip({ strip, language }: { strip: V3Strip; language: "tr" | "en" }) {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  if (frame < strip.start || frame >= strip.end) return null;
  const k = Math.min(W, H) / 1080;
  const enter = interpolate(frame, [strip.start, strip.start + Math.round(fps * 0.35)], [0, 1], { extrapolateRight: "clamp" });
  const leave = interpolate(frame, [strip.end - Math.round(fps * 0.3), strip.end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ease = 1 - (1 - enter) ** 3;
  return (
    <div style={{ position: "absolute", left: 0, bottom: 92 * k, width: W, height: 82 * k, opacity: leave, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: W * 0.86, transform: `translateX(${(ease - 1) * W * 0.9}px)`, background: "linear-gradient(90deg, #a51c2a 0%, #c42a37 70%, rgba(196,42,55,0) 100%)", boxShadow: `0 ${4 * k}px ${10 * k}px rgba(0,0,0,0.45)` }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: 14 * k, height: "100%", background: "#f3ead7" }} />
        <div {...yer("serit")} style={{ position: "absolute", left: 48 * k, top: 0, height: "100%", display: "flex", alignItems: "center", maxWidth: W * 0.74, font: `700 ${40 * k}px 'Bahnschrift', 'Segoe UI', sans-serif`, letterSpacing: 1 * k, color: "#ffffff", textShadow: `0 ${2 * k}px ${3 * k}px rgba(0,0,0,0.5)`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: Math.min(1, enter * 1.6) }}>
          {strip.text.toLocaleUpperCase(language === "tr" ? "tr-TR" : "en-US")}
        </div>
      </div>
    </div>
  );
}
