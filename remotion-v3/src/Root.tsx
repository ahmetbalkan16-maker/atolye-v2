import React from "react";
import { Composition } from "remotion";
import type { V3RenderPlan } from "../../src/lib/v3/render/RenderPlanTypes";
import { Episode, type EpisodeProps } from "./compositions/Episode";

/** Placeholder until a real plan is passed with `--props` (the V3 CLI always passes one). */
const EMPTY_PLAN: V3RenderPlan = {
  version: 1,
  episodeId: "bos",
  title: "Plan verilmedi",
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 30,
  cast: [],
  accessories: [],
  shots: [],
  captions: [],
  showCaptions: false,
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Episode"
    component={Episode}
    durationInFrames={EMPTY_PLAN.durationInFrames}
    fps={EMPTY_PLAN.fps}
    width={EMPTY_PLAN.width}
    height={EMPTY_PLAN.height}
    defaultProps={{ plan: EMPTY_PLAN } satisfies EpisodeProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: props.plan.durationInFrames,
      fps: props.plan.fps,
      width: props.plan.width,
      height: props.plan.height,
    })}
  />
);
