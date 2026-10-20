import React, { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, Audio, cancelRender, continueRender, delayRender, Sequence, staticFile } from "remotion";
import type { V3RenderPlan } from "../../../src/lib/v3/render/RenderPlanTypes";
import { ShotView } from "../scene/ShotView";
import { Captions } from "../scene/Captions";
import "../scene/fonts";

export interface EpisodeProps {
  readonly plan: V3RenderPlan;
  [key: string]: unknown;
}

/**
 * Portrait faces are SVG <image>s, which Remotion does not wait for: each one is decoded before the first frame, so
 * no frame is captured with an empty head.
 */
function FacePreloader({ srcs }: { srcs: readonly string[] }) {
  const [handle] = useState(() => (srcs.length ? delayRender("Portre yüzleri yükleniyor") : null));
  useEffect(() => {
    if (handle === null) return;
    Promise.all(srcs.map((s) => { const img = new Image(); img.src = staticFile(s); return img.decode(); }))
      .then(() => continueRender(handle))
      .catch((e: unknown) => cancelRender(e));
  }, [handle, srcs]);
  return null;
}

/** Renders a whole render plan: one Sequence per shot, captions and the mixed soundtrack on top. */
export const Episode: React.FC<EpisodeProps> = ({ plan }) => {
  const accessories = useMemo(() => new Map(plan.accessories.map((a) => [a.id, a])), [plan]);
  const cast = useMemo(() => new Map(plan.cast.map((c) => [c.id, c])), [plan]);
  const faces = useMemo(() => [...new Set(plan.cast.flatMap((c) => (c.costume.face ? [c.costume.face.src] : [])))], [plan]);
  return (
    <AbsoluteFill style={{ backgroundColor: "#15121c" }}>
      <FacePreloader srcs={faces} />
      {plan.shots.map((shot) => (
        <Sequence key={shot.id} from={shot.start} durationInFrames={shot.duration} name={shot.id}>
          <ShotView shot={shot} cast={cast} accessories={accessories} language={plan.language ?? "tr"} />
        </Sequence>
      ))}
      {plan.showCaptions ? <Captions pages={plan.captions} /> : null}
      {plan.audio ? <Audio src={staticFile(plan.audio)} /> : null}
    </AbsoluteFill>
  );
};
