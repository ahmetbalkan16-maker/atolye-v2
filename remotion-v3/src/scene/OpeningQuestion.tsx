import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { yer } from "./LayoutProbe";

/** How long the opening question stays on screen, and its fade (seconds). */
export const OPENING_QUESTION_S = 3.6;
const FADE_S = 0.35;

/**
 * The native vertical Short's question on screen from frame 0 (owner, 26 Nov 2026, review of the Stalingrad Short
 * bolGvK1B9m0: the question was read out first but shown only in the stage bands at the very end; the opening was a bare
 * map). Knowledgia's Shorts show the question in big letters while it is spoken. Drawn above every shot — a tall map or a
 * stage — in the upper third, under the place card and date stamp, then faded out so the map is free again.
 */
export function OpeningQuestion({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const end = Math.round(OPENING_QUESTION_S * fps);
  if (frame >= end) return null;
  const fade = Math.round(FADE_S * fps);
  const opacity = interpolate(frame, [0, 4, end - fade, end], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const lift = interpolate(frame, [0, 8], [18, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const chars = text.trim().length;
  const size = Math.round(width * (chars > 70 ? 0.062 : chars > 45 ? 0.072 : 0.084));
  return (
    <div style={{ position: "absolute", left: width * 0.05, width: width * 0.9, top: height * 0.1, height: height * 0.2, display: "flex", alignItems: "center", justifyContent: "center", opacity, transform: `translateY(${lift}px)`, pointerEvents: "none" }}>
      <div {...yer("baslik", "acilis-soru")} style={{ textAlign: "center", font: `900 ${size}px 'Segoe UI Black', 'Arial Black', 'Segoe UI', sans-serif`, lineHeight: 1.06, color: "#fffaf0", textTransform: "uppercase", WebkitTextStroke: `${Math.max(4, size / 6.5)}px #1d1b26`, paintOrder: "stroke fill", textWrap: "balance", filter: "drop-shadow(0 6px 10px rgba(0,0,0,.45))" }}>{text.trim()}</div>
    </div>
  );
}
