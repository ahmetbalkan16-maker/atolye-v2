import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import type { V3RenderPlan } from "../../../src/lib/v3/render/RenderPlanTypes";
import { ShotView } from "../scene/ShotView";
import { Captions } from "../scene/Captions";
import "../scene/fonts";

export interface EpisodeProps {
  readonly plan: V3RenderPlan;
  [key: string]: unknown;
}

/** Renders a whole render plan: one Sequence per shot, captions and the mixed soundtrack on top. */
export const Episode: React.FC<EpisodeProps> = ({ plan }) => {
  const accessories = useMemo(() => new Map(plan.accessories.map((a) => [a.id, a])), [plan]);
  const cast = useMemo(() => new Map(plan.cast.map((c) => [c.id, c])), [plan]);
  return (
    <AbsoluteFill style={{ backgroundColor: "#15121c" }}>
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
