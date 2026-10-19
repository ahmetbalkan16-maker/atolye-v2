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
