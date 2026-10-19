import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { V3CaptionPage } from "../../../src/lib/v3/render/RenderPlanTypes";

/** Word-timed burned-in captions: at most two lines, current word highlighted, keywords tinted. */
export function Captions({ pages }: { pages: readonly V3CaptionPage[] }) {
  const frame = useCurrentFrame();
  const { height: H, width: W } = useVideoConfig();
  const page = pages.find((p) => frame >= p.start && frame < p.end);
  if (!page) return null;
  const k = H / 1080;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 54 * k, display: "flex", justifyContent: "center" }}>
      <div
        style={{
          maxWidth: W * 0.78,
          textAlign: "center",
          // Two even lines instead of a long one and an orphan word.
          textWrap: "balance",
          font: `900 ${52 * k}px 'Segoe UI Black', 'Arial Black', 'Segoe UI', sans-serif`,
          lineHeight: 1.18,
          color: "#ffffff",
          WebkitTextStroke: `${11 * k}px #15121c`,
          paintOrder: "stroke fill",
        }}
      >
        {page.words.map((w, i) => {
          const active = frame >= w.start && frame < w.end;
          const color = active ? "#ffd23f" : w.emphasis ? "#ffb18a" : "#ffffff";
          // The gap is a space (~13 px at this weight) plus the 11 px stroke both neighbours paint into it: at 14 px
          // the words read as glued together ("Boğazkesenhisar"), at 32 px as double spaces.
          return (
            <span key={i} style={{ color, display: "inline-block", transform: active ? "scale(1.07)" : undefined, margin: `0 ${12 * k}px` }}>
              {w.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
