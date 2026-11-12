import React, { useMemo, useRef } from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import type { V3RenderPlan } from "../../../src/lib/v3/render/RenderPlanTypes";
import { ShotView } from "../scene/ShotView";
import { Captions } from "../scene/Captions";
import { LayoutProbe } from "../scene/LayoutProbe";
import { exitFrames } from "../scene/transitions";
import "../scene/fonts";

export interface EpisodeProps {
  readonly plan: V3RenderPlan;
  [key: string]: unknown;
}

/**
 * Renders a whole render plan: one Sequence per shot, captions and the mixed soundtrack on top. A shot stays drawn for
 * the next shot's transition frames, under it (later Sequences paint over earlier ones), so the next one slides, opens
 * or dissolves over the last picture; the plan's timing and the soundtrack do not change.
 */
export const Episode: React.FC<EpisodeProps> = ({ plan }) => {
  const accessories = useMemo(() => new Map(plan.accessories.map((a) => [a.id, a])), [plan]);
  const cast = useMemo(() => new Map(plan.cast.map((c) => [c.id, c])), [plan]);
  const root = useRef<HTMLDivElement>(null);
  return (
    <AbsoluteFill ref={root} style={{ backgroundColor: "#15121c" }}>
      {plan.shots.map((shot, i) => {
        const next = plan.shots[i + 1];
        const overlap = next ? exitFrames(shot, next, plan.fps) : 0;
        return (
          <Sequence key={shot.id} from={shot.start} durationInFrames={shot.duration + overlap} name={shot.id}>
            <ShotView shot={shot} cast={cast} accessories={accessories} language={plan.language ?? "tr"} {...(plan.stage ? { stage: plan.stage } : {})} {...(next && overlap ? { exit: { kind: next.transitionIn, frames: overlap } } : {})} />
          </Sequence>
        );
      })}
      {plan.showCaptions ? <Captions pages={plan.captions} /> : null}
      {plan.audio ? <Audio src={staticFile(plan.audio)} /> : null}
      {plan.layoutProbe ? <LayoutProbe root={root} every={plan.layoutProbe.every} dir={plan.layoutProbe.dir} /> : null}
    </AbsoluteFill>
  );
};
