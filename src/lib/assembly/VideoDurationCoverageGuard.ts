/**
 * F-02 fix: fail-closed video/narration coverage gate.
 *
 * Root cause (see docs/DURATION_AUTHORITY.md and NarrationDurationEstimator.ts):
 * scene-video clips are rendered (VideoPipeline.ts) at the a-priori, pre-TTS
 * estimated duration (script chapter duration -> scene duration -> animation
 * motion-plan durationSeconds -> video clip durationSeconds), while assembly
 * targets the REAL, TTS-measured narration length
 * (`scene.narrationDurationSeconds`, from
 * `allocateProductionSceneAudioSegments` in ProductionAcceptancePreflight.ts).
 * When the estimate undershoots reality by a lot, `buildRetimedConcatArgs`/
 * `buildTransitionedConcatArgs` (FFmpegVideoAssemblyProvider.ts) bridge the
 * gap with `tpad=stop_mode=clone`, freezing the scene's last frame for the
 * shortfall -- individually confirmed on the real, protected
 * `i-stanbul-un-fethi-1453` project to run ~36-48% of several scenes' final
 * duration. `tpad` itself is legitimate and stays as a small-rounding safety
 * net (frame-quantization, see frameRoundingAllowance() in
 * FFmpegVideoAssemblyProvider.ts); what must not happen is a render being
 * accepted as "successful" when tpad is doing the heavy lifting of covering
 * a real estimate/reality gap instead.
 *
 * This module computes, from the exact same per-scene
 * durationSeconds/narrationDurationSeconds pairs the FFmpeg provider itself
 * consumes, how much of the final output is real rendered footage vs. frozen
 * padding, and fails closed (`VideoDurationCoverageError`,
 * code `VIDEO_DURATION_COVERAGE_FAILED`) when that padding exceeds what the
 * render pipeline's own, already-reviewed tolerance architecture would call
 * legitimate. It deliberately reuses -- never reimplements -- that
 * architecture's exported building blocks (`frameRoundingAllowance`,
 * `durationTolerance`, `narrationDuration`, `FPS`), so the two can never
 * silently drift apart, and it additionally reuses the existing
 * `productionAcceptanceDuration.toleranceSeconds/targetSeconds` acceptance
 * ratio (ProductionAcceptancePreflight.ts) -- the codebase's own,
 * already-justified answer to "how much may a duration estimate legitimately
 * diverge from reality" -- as the third, dominant term of the threshold. None
 * of the three terms is a number invented for this gate.
 */
import {
  durationTolerance,
  FPS,
  frameRoundingAllowance,
  narrationDuration,
} from "./providers/FFmpegVideoAssemblyProvider";
import { productionAcceptanceDuration } from "@/lib/production/ProductionAcceptancePreflight";
import type { VideoAssemblyInput } from "@/types/videoAssembly";

export const VIDEO_DURATION_COVERAGE_FAILED = "VIDEO_DURATION_COVERAGE_FAILED";

/**
 * See NarrationDurationEstimator.ts's MINIMUM_NARRATION_SECONDS for the same
 * reasoning, scoped to assembly's own per-scene allocation. Applied only to
 * "scene-video" (tpad/retiming) inputs -- see computeVideoDurationCoverage.
 */
export const MINIMUM_SCENE_NARRATION_SECONDS = 1;

/**
 * `productionAcceptanceDuration.toleranceSeconds / .targetSeconds`, expressed
 * as a ratio: the fraction of a scene's narration length that the system's
 * own existing script-duration acceptance policy already treats as a
 * legitimate estimate/reality gap. Reused verbatim (not re-derived) as the
 * dominant term of this gate's legitimate-padding ratio.
 */
export const ACCEPTANCE_POLICY_PADDING_RATIO =
  productionAcceptanceDuration.toleranceSeconds / productionAcceptanceDuration.targetSeconds;

export interface VideoDurationCoverageSceneMetric {
  sceneId: number;
  narrationDurationSeconds: number;
  sourceDurationSeconds: number;
  paddingSeconds: number;
  paddingRatio: number;
  legitimatePaddingSeconds: number;
  legitimatePaddingRatio: number;
  withinTolerance: boolean;
}

export interface VideoDurationCoverageReport {
  narrationDurationSeconds: number;
  videoDurationSeconds: number;
  coverageRatio: number;
  paddingDurationSeconds: number;
  paddingRatio: number;
  legitimatePaddingSeconds: number;
  legitimatePaddingRatio: number;
  scenes: VideoDurationCoverageSceneMetric[];
  worstScene: VideoDurationCoverageSceneMetric | null;
  passed: boolean;
}

export class VideoDurationCoverageError extends Error {
  readonly code = VIDEO_DURATION_COVERAGE_FAILED;
  readonly report: VideoDurationCoverageReport;

  constructor(report: VideoDurationCoverageReport) {
    super(
      "Video duration coverage below quality threshold: rendered footage " +
        "would need too much frozen-frame padding to cover the real " +
        "narration length.",
    );
    this.name = "VideoDurationCoverageError";
    this.report = report;
    this.stack = undefined;
  }
}

/**
 * A scene's own source footage length before tpad/trim. Mirrors
 * FFmpegVideoAssemblyProvider.ts's `padding = max(0, narration - duration)`
 * computation exactly (buildRetimedConcatArgs / buildTransitionedConcatArgs):
 * for "scene-video" scenes this is the pre-existing rendered clip's own
 * durationSeconds; "image" (Ken Burns) scenes are synthesized directly at
 * the narration-derived target length (VideoAssemblyManager.ts passes
 * `durationSeconds: segment.durationSeconds`), so they have no separate
 * source-length constraint and always fully cover their own target.
 */
function sourceDuration(scene: VideoAssemblyInput["scenes"][number]): number {
  return scene.inputType === "scene-video" ? scene.durationSeconds : narrationDuration(scene);
}

function perSceneLegitimatePaddingSeconds(narrationSeconds: number): number {
  return (
    1 / FPS +
    durationTolerance(narrationSeconds) +
    narrationSeconds * ACCEPTANCE_POLICY_PADDING_RATIO
  );
}

/**
 * Computes the coverage/padding report for a resolved scene list. Pure and
 * side-effect-free: always derived fresh from the scene inputs actually
 * being assembled, so it is automatically retry/resume/regeneration-safe --
 * there is no separate cached state to go stale or need invalidating.
 *
 * `concatManifestPath` should be passed exactly as it will be to the FFmpeg
 * provider's own `frameRoundingAllowance`/`expectedRenderedDuration` calls
 * when known; passing `null` (the zero-re-encode "copy" path is never known
 * at the point VideoAssemblyManager calls this, before the provider runs)
 * only ever makes the legitimate allowance slightly more generous, and that
 * path's own `canCopySceneVideos` precondition already guarantees near-zero
 * padding for every scene, so the distinction is immaterial there.
 */
export function computeVideoDurationCoverage(
  scenes: VideoAssemblyInput["scenes"],
  concatManifestPath: string | null,
): VideoDurationCoverageReport {
  const aggregateLegitimatePaddingSeconds =
    frameRoundingAllowance(scenes, concatManifestPath) +
    durationTolerance(scenes.reduce((sum, scene) => sum + narrationDuration(scene), 0)) +
    scenes.reduce((sum, scene) => sum + narrationDuration(scene), 0) * ACCEPTANCE_POLICY_PADDING_RATIO;

  const sceneMetrics: VideoDurationCoverageSceneMetric[] = scenes.map((scene) => {
    const narration = narrationDuration(scene);
    const source = sourceDuration(scene);
    // Non-finite narration/source durations (NaN/Infinity) are malformed
    // data, not a "large but real" mismatch; both the ratio and
    // seconds-based comparisons below can otherwise degrade into vacuously
    // true Infinity<=Infinity comparisons, so this is checked explicitly
    // rather than relying on the arithmetic to fail closed on its own.
    const finite = Number.isFinite(narration) && Number.isFinite(source);
    const padding = finite ? Math.max(0, narration - source) : Number.NaN;
    const legitimateSeconds = finite ? perSceneLegitimatePaddingSeconds(narration) : 0;
    const paddingRatio = finite && narration > 0 ? padding / narration : 0;
    const legitimateRatio = finite && narration > 0 ? legitimateSeconds / narration : 0;
    return {
      sceneId: scene.sceneId,
      narrationDurationSeconds: narration,
      sourceDurationSeconds: source,
      paddingSeconds: padding,
      paddingRatio,
      legitimatePaddingSeconds: legitimateSeconds,
      legitimatePaddingRatio: legitimateRatio,
      withinTolerance: finite && padding <= legitimateSeconds,
    };
  });

  const narrationDurationSeconds = sceneMetrics.reduce((sum, s) => sum + s.narrationDurationSeconds, 0);
  const videoDurationSeconds = sceneMetrics.reduce((sum, s) => sum + s.sourceDurationSeconds, 0);
  const paddingDurationSeconds = sceneMetrics.reduce((sum, s) => sum + s.paddingSeconds, 0);
  const coverageRatio = narrationDurationSeconds > 0 ? videoDurationSeconds / narrationDurationSeconds : 1;
  const paddingRatio = narrationDurationSeconds > 0 ? paddingDurationSeconds / narrationDurationSeconds : 0;
  const legitimatePaddingRatio =
    narrationDurationSeconds > 0 ? aggregateLegitimatePaddingSeconds / narrationDurationSeconds : 0;

  const worstScene = sceneMetrics.reduce<VideoDurationCoverageSceneMetric | null>((worst, current) => {
    if (!worst) return current;
    return current.paddingRatio - current.legitimatePaddingRatio > worst.paddingRatio - worst.legitimatePaddingRatio
      ? current
      : worst;
  }, null);

  const aggregatePassed = paddingDurationSeconds <= aggregateLegitimatePaddingSeconds;
  const perScenePassed = sceneMetrics.every((s) => s.withinTolerance);
  // The minimum-duration floor only guards the tpad/retiming path
  // ("scene-video" inputs, where an absurdly short real narration combined
  // with a pre-existing, differently-sized clip is the actual risk this
  // policy targets). "image" (Ken Burns) scenes are synthesized directly at
  // their target length with no separate source-clip constraint, so a short
  // one is just a short scene, not a coverage/quality problem this gate is
  // about.
  const minimumDurationSatisfied = scenes.every(
    (scene, index) =>
      scene.inputType !== "scene-video" ||
      sceneMetrics[index].narrationDurationSeconds >= MINIMUM_SCENE_NARRATION_SECONDS,
  );

  return {
    narrationDurationSeconds,
    videoDurationSeconds,
    coverageRatio,
    paddingDurationSeconds,
    paddingRatio,
    legitimatePaddingSeconds: aggregateLegitimatePaddingSeconds,
    legitimatePaddingRatio,
    scenes: sceneMetrics,
    worstScene,
    passed: aggregatePassed && perScenePassed && minimumDurationSatisfied,
  };
}

/**
 * Computes the coverage report and throws `VideoDurationCoverageError`
 * (code VIDEO_DURATION_COVERAGE_FAILED) when it does not pass -- either the
 * aggregate padding ratio or any single scene's own padding ratio exceeds
 * what the render pipeline's tolerance architecture treats as legitimate, or
 * any scene's real narration allocation is below MINIMUM_SCENE_NARRATION_SECONDS.
 * Returns the report on success so callers can persist it for auditability
 * (AssemblyPlanData.render.quality).
 */
export function assertVideoDurationCoverage(
  scenes: VideoAssemblyInput["scenes"],
  concatManifestPath: string | null,
): VideoDurationCoverageReport {
  const report = computeVideoDurationCoverage(scenes, concatManifestPath);
  if (!report.passed) throw new VideoDurationCoverageError(report);
  return report;
}
