import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { V3TitleCard } from "../../../src/lib/v3/render/RenderPlanTypes";

const FONT = "'Segoe UI Black', 'Arial Black', 'Segoe UI', sans-serif";

/** Place/date stamps, chapter cards and info boxes; frames are relative to the shot. */
export function TitleCard({ card }: { card: V3TitleCard }) {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  if (frame < card.start || frame >= card.end) return null;
  const local = frame - card.start;
  const enter = spring({ frame: local, fps, config: { damping: 12, stiffness: 140 } });
  const exit = interpolate(frame, [card.end - Math.round(fps * 0.3), card.end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const k = H / 1080;

  if (card.style === "bolum") {
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `rgba(16,10,24,${0.45 * exit})` }}>
        <div style={{ transform: `scale(${0.6 + 0.4 * enter})`, opacity: exit, textAlign: "center" }}>
          {card.subtext ? <div style={{ font: `900 ${40 * k}px ${FONT}`, color: "#ffd66b", letterSpacing: 6, WebkitTextStroke: `${8 * k}px #1d1b26`, paintOrder: "stroke fill" }}>{card.subtext}</div> : null}
          <div style={{ font: `900 ${110 * k}px ${FONT}`, color: "#fffaf0", WebkitTextStroke: `${16 * k}px #1d1b26`, paintOrder: "stroke fill", letterSpacing: 2 }}>{card.text}</div>
        </div>
      </div>
    );
  }

  if (card.style === "kapak") {
    // Opening cover: the title in big outlined letters over the darkened period picture, the period under it.
    const rise = spring({ frame: local, fps, config: { damping: 14, stiffness: 120 } });
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "radial-gradient(ellipse at 50% 55%, rgba(10,8,16,0.35) 0%, rgba(10,8,16,0.75) 100%)", opacity: exit }}>
        <div style={{ transform: `translateY(${(1 - rise) * 60 * k}px) scale(${0.85 + 0.15 * rise})`, textAlign: "center", maxWidth: W * 0.84, font: `900 ${104 * k}px ${FONT}`, lineHeight: 1.04, color: "#fffaf0", WebkitTextStroke: `${16 * k}px #1d1b26`, paintOrder: "stroke fill", letterSpacing: 1 * k, textWrap: "balance" }}>
          {card.text}
        </div>
        {card.subtext ? (
          <div style={{ marginTop: 26 * k, padding: `${8 * k}px ${28 * k}px`, borderRadius: 10 * k, background: "#b8283a", border: `${5 * k}px solid #1d1b26`, font: `900 ${40 * k}px ${FONT}`, color: "#fffaf0", letterSpacing: 4 * k, opacity: Math.min(1, Math.max(0, (local - 8) / 8)) }}>
            {card.subtext.toLocaleUpperCase("en-US")}
          </div>
        ) : null}
      </div>
    );
  }

  if (card.style === "kucukresim") {
    // The YouTube thumbnail's headline: 2–4 words, huge white letters with a heavy outline across the top, readable
    // when the thumbnail is 120 px wide in a feed (still frame: no animation).
    return (
      <div style={{ position: "absolute", left: 0, right: 0, top: 28 * k, display: "flex", justifyContent: "center" }}>
        <div style={{ maxWidth: W * 0.92, textAlign: "center", font: `900 ${150 * k}px ${FONT}`, lineHeight: 0.98, color: "#fffaf0", WebkitTextStroke: `${24 * k}px #1d1b26`, paintOrder: "stroke fill", letterSpacing: 1 * k, textWrap: "balance" }}>
          {card.text.toLocaleUpperCase("en-US")}
        </div>
      </div>
    );
  }

  if (card.style === "abone") {
    // Closing card under the narrator's invitation: a subscribe button that pops, a bell that rings, thanks.
    const pop = spring({ frame: local, fps, config: { damping: 10, stiffness: 180 } });
    const ring = Math.sin(local / 2.2) * Math.max(0, 18 - local / 3);
    return (
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 90 * k, display: "flex", flexDirection: "column", alignItems: "center", opacity: exit }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 * k, transform: `scale(${0.4 + 0.6 * pop})` }}>
          <div style={{ padding: `${18 * k}px ${48 * k}px`, borderRadius: 14 * k, background: "#e0262f", border: `${6 * k}px solid #1d1b26`, boxShadow: `${8 * k}px ${8 * k}px 0 rgba(29,27,38,0.85)`, font: `900 ${62 * k}px ${FONT}`, color: "#ffffff", letterSpacing: 2 * k }}>{card.text}</div>
          <svg width={92 * k} height={92 * k} viewBox="-50 -50 100 100" style={{ transform: `rotate(${ring}deg)`, transformOrigin: "50% 15%" }}>
            <path d="M-30 18 Q-30 -32 0 -34 Q30 -32 30 18 L38 26 L-38 26 Z" fill="#ffd23f" stroke="#1d1b26" strokeWidth={7} strokeLinejoin="round" />
            <circle cx={0} cy={34} r={9} fill="#ffd23f" stroke="#1d1b26" strokeWidth={6} />
          </svg>
        </div>
        {card.subtext ? <div style={{ marginTop: 22 * k, font: `800 ${40 * k}px 'Segoe UI', Arial, sans-serif`, color: "#ffffff", WebkitTextStroke: `${9 * k}px #1d1b26`, paintOrder: "stroke fill" }}>{card.subtext}</div> : null}
      </div>
    );
  }

  if (card.style === "kelime") {
    // One word, full screen, hard cut in and out: the emphasis beat.
    const punch = interpolate(local, [0, 4], [1.12, 1], { extrapolateRight: "clamp" });
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#0d0c12" }}>
        <div style={{ transform: `scale(${punch})`, textAlign: "center", color: "#ffffff", font: `600 ${230 * k}px 'Bahnschrift', 'Arial Narrow', sans-serif`, fontStretch: "condensed", letterSpacing: 6 * k, lineHeight: 1 }}>
          {card.text.toLocaleUpperCase("en-US")}
          {card.subtext ? <div style={{ font: `600 ${44 * k}px 'Bahnschrift', 'Segoe UI', sans-serif`, letterSpacing: 2 * k, color: "#cfc8d8", marginTop: 18 * k }}>{card.subtext}</div> : null}
        </div>
      </div>
    );
  }

  if (card.style === "bilgi") {
    return (
      <div
        style={{
          position: "absolute",
          right: 50 * k,
          top: 120 * k,
          maxWidth: W * 0.32,
          padding: `${18 * k}px ${24 * k}px`,
          borderRadius: 18 * k,
          border: `${6 * k}px solid #1d1b26`,
          background: "#fff6dc",
          boxShadow: `${8 * k}px ${8 * k}px 0 rgba(29,27,38,0.85)`,
          transform: `translateX(${(1 - enter) * 120 * k}px) rotate(${(1 - enter) * 6}deg)`,
          opacity: exit,
          font: `800 ${34 * k}px 'Segoe UI', Arial, sans-serif`,
          color: "#1d1b26",
          lineHeight: 1.2,
        }}
      >
        {card.text}
        {card.subtext ? <div style={{ marginTop: 6 * k, font: `600 ${24 * k}px 'Segoe UI', Arial, sans-serif`, color: "#5b4a3a" }}>{card.subtext}</div> : null}
      </div>
    );
  }

  // yer_tarih: parchment stamp, top-left.
  return (
    <div
      style={{
        position: "absolute",
        left: 60 * k,
        top: 80 * k,
        padding: `${14 * k}px ${30 * k}px`,
        borderRadius: 14 * k,
        border: `${6 * k}px solid #1d1b26`,
        background: "linear-gradient(#f6e6bd, #ecd49c)",
        boxShadow: `${8 * k}px ${8 * k}px 0 rgba(29,27,38,0.85)`,
        transform: `translateY(${(1 - enter) * -90 * k}px) rotate(${-2 + (1 - enter) * -8}deg)`,
        opacity: exit,
      }}
    >
      <div style={{ font: `900 ${54 * k}px ${FONT}`, color: "#7a1f2b", lineHeight: 1 }}>{card.text}</div>
      {card.subtext ? <div style={{ font: `800 ${30 * k}px 'Segoe UI', Arial, sans-serif`, color: "#3b2a22", marginTop: 4 * k }}>{card.subtext}</div> : null}
    </div>
  );
}
