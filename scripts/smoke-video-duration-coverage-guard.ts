/**
 * F-08 + F-02: VideoDurationCoverageGuard smoke suite.
 *
 * Pure-function-level coverage of src/lib/assembly/VideoDurationCoverageGuard.ts
 * against the emir's lettered scenarios (A-N) plus the remaining edge cases
 * from the same family (TTS shorter than expected / truncation, maximum
 * scene duration, malformed/zero duration robustness, blended-transition
 * accounting). FFmpeg-level integration (the guard wired into
 * VideoAssemblyManager.renderExistingAssets, including a real retime/tpad
 * render) is covered separately by scripts/smoke-assembly-scene-video-consumption.ts
 * (scenario 8, "duration mismatch uses safe retime and re-encode path") and
 * scripts/diagnose-istanbul-1453-assembly-render-readonly.ts (read-only,
 * against a temp copy of the real project).
 *
 * No I/O, no FFmpeg, no runtime storage context required: every scenario
 * calls computeVideoDurationCoverage/assertVideoDurationCoverage directly on
 * in-memory VideoAssemblyInput["scenes"] fixtures.
 */
import assert from "node:assert/strict";
import {
  ACCEPTANCE_POLICY_PADDING_RATIO,
  computeVideoDurationCoverage,
  assertVideoDurationCoverage,
  VideoDurationCoverageError,
  MINIMUM_SCENE_NARRATION_SECONDS,
} from "../src/lib/assembly/VideoDurationCoverageGuard";
import type { VideoAssemblySceneVideoInput } from "../src/types/videoAssembly";

let count = 0;
function scenario(name: string, test: () => void) {
  test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

/** Builds a single "scene-video" input scene with the given narration/source split. */
function sceneVideo(
  sceneId: number,
  narrationDurationSeconds: number,
  durationSeconds: number,
  transition: VideoAssemblySceneVideoInput["transition"] = "cut",
): VideoAssemblySceneVideoInput {
  return {
    inputType: "scene-video",
    sceneId,
    videoAssetId: `video-${sceneId}`,
    sourceImageAssetId: `image-${sceneId}`,
    animationAssetId: `animation-${sceneId}`,
    filePath: `assets/videos/${sceneId}.mp4`,
    url: `/api/assets/videos/x/${sceneId}.mp4`,
    durationSeconds,
    narrationDurationSeconds,
    byteLength: 1000,
    provider: "ffmpeg",
    generationMode: "production",
    status: "generated",
    audioFilePath: `assets/audio/${sceneId}.wav`,
    transition,
  };
}

/** A single chapter/scene whose *video* was rendered at `estimatedSeconds` and whose *real narration* turned out to be `realSeconds`. */
function scenarioScenes(estimatedSeconds: number, realSeconds: number) {
  return [sceneVideo(1, realSeconds, estimatedSeconds)];
}

function run() {
  // === A-C: aggregate estimate/reality mismatch ratios, anchored to the
  // real i-stanbul-un-fethi-1453 numbers (90s estimate; 94s/153s/155s real). ===
  scenario("A: 90s->155s large mismatch is rejected, no large tpad accepted", () => {
    const report = computeVideoDurationCoverage(scenarioScenes(90, 155.4), null);
    assert.equal(report.passed, false);
    assert.ok(report.paddingRatio > 0.4, `expected large padding ratio, got ${report.paddingRatio}`);
    assert.throws(
      () => assertVideoDurationCoverage(scenarioScenes(90, 155.4), null),
      (error: unknown) =>
        error instanceof VideoDurationCoverageError && error.code === "VIDEO_DURATION_COVERAGE_FAILED",
    );
  });

  scenario("B: 90s->94s small mismatch behaves normally (passes)", () => {
    const report = computeVideoDurationCoverage(scenarioScenes(90, 94), null);
    assert.equal(report.passed, true, JSON.stringify(report));
    assert.doesNotThrow(() => assertVideoDurationCoverage(scenarioScenes(90, 94), null));
  });

  scenario("C: 90s->153s reconciliation-scale mismatch is rejected", () => {
    const report = computeVideoDurationCoverage(scenarioScenes(90, 153), null);
    assert.equal(report.passed, false);
  });

  // === explicit 5% / 20% / 70% tiered mismatch behavior ===
  scenario("TTS 5% longer than estimate passes (within the legitimate acceptance-policy allowance)", () => {
    const report = computeVideoDurationCoverage(scenarioScenes(90, 90 * 1.05), null);
    assert.equal(report.passed, true, JSON.stringify(report));
  });
  scenario("TTS 20% longer than estimate is rejected (a real, noticeable freeze, not rounding noise)", () => {
    const report = computeVideoDurationCoverage(scenarioScenes(90, 90 * 1.2), null);
    assert.equal(report.passed, false, JSON.stringify(report));
  });
  scenario("TTS 70% longer than estimate is rejected (the historical i-stanbul-scale mismatch)", () => {
    const report = computeVideoDurationCoverage(scenarioScenes(90, 90 * 1.7), null);
    assert.equal(report.passed, false, JSON.stringify(report));
  });

  // === malformed numeric input robustness ===
  scenario("NaN/Infinity narration or source duration never crashes the guard (fails closed instead)", () => {
    const nanScenes: VideoAssemblySceneVideoInput[] = [sceneVideo(1, Number.NaN, 20)];
    assert.doesNotThrow(() => computeVideoDurationCoverage(nanScenes, null));
    assert.equal(computeVideoDurationCoverage(nanScenes, null).passed, false);
    const infScenes: VideoAssemblySceneVideoInput[] = [sceneVideo(1, Number.POSITIVE_INFINITY, 20)];
    assert.doesNotThrow(() => computeVideoDurationCoverage(infScenes, null));
    assert.equal(computeVideoDurationCoverage(infScenes, null).passed, false);
  });

  // === D: minimum scene duration policy ===
  scenario("D: extremely short TTS triggers the minimum-duration policy", () => {
    const scenes = [sceneVideo(1, 0.5, 0.5)]; // below MINIMUM_SCENE_NARRATION_SECONDS, exact coverage otherwise
    const report = computeVideoDurationCoverage(scenes, null);
    assert.equal(report.passed, false, "a scene entirely below the minimum narration floor must fail closed even with perfect coverage");
    assert.ok(report.scenes[0].narrationDurationSeconds < MINIMUM_SCENE_NARRATION_SECONDS);
  });

  // === E: one extremely long scene does not corrupt other scenes' own metrics ===
  scenario("E: one extremely long scene is isolated and does not corrupt sibling scene metrics", () => {
    const scenes = [
      sceneVideo(1, 118, 20), // wildly under-covered outlier (near the 120s scene cap)
      sceneVideo(2, 20, 20), // perfectly covered sibling
    ];
    const report = computeVideoDurationCoverage(scenes, null);
    assert.equal(report.passed, false);
    assert.equal(report.worstScene?.sceneId, 1);
    const sibling = report.scenes.find((s) => s.sceneId === 2)!;
    assert.equal(sibling.paddingSeconds, 0);
    assert.equal(sibling.withinTolerance, true, "the well-covered sibling scene must still read as within tolerance on its own");
  });

  // === one scene far too SHORT relative to its own narration, aggregate still small ===
  scenario("one badly under-covered scene fails even when blended into an otherwise-fine aggregate", () => {
    const scenes = [
      sceneVideo(1, 30, 10), // 20s short on a 30s scene: 66% padding
      sceneVideo(2, 30, 30),
      sceneVideo(3, 30, 30),
      sceneVideo(4, 30, 30),
    ];
    const report = computeVideoDurationCoverage(scenes, null);
    // Aggregate padding ratio (20 / 120 ~ 16.7%) could look tolerable in isolation,
    // but the guard must still fail on the single scene's own ratio.
    assert.equal(report.passed, false);
    assert.equal(report.worstScene?.sceneId, 1);
  });

  // === TTS shorter than expected: video longer than narration is truncated, never "negative padding" ===
  scenario("TTS shorter than expected (video longer than narration) never produces negative padding and always passes", () => {
    const scenes = [sceneVideo(1, 18, 25)]; // source footage longer than the real narration -> gets trimmed downstream, not padded
    const report = computeVideoDurationCoverage(scenes, null);
    assert.equal(report.paddingDurationSeconds, 0);
    assert.equal(report.passed, true);
    assert.ok(report.coverageRatio > 1, `expected coverageRatio > 1 (excess footage), got ${report.coverageRatio}`);
  });

  // === maximum scene duration (schema ceiling is 120s) does not break the math ===
  scenario("maximum scene duration (120s) is handled without overflow/precision issues", () => {
    const report = computeVideoDurationCoverage(scenarioScenes(120, 124), null);
    assert.equal(report.passed, true, JSON.stringify(report));
    assert.ok(Number.isFinite(report.paddingRatio));
  });

  // === malformed / zero duration robustness (should never crash; upstream normally prevents these) ===
  scenario("zero narration duration is rejected via the minimum-duration policy, not a division crash", () => {
    const scenes = [sceneVideo(1, 0, 0)];
    assert.doesNotThrow(() => computeVideoDurationCoverage(scenes, null));
    const report = computeVideoDurationCoverage(scenes, null);
    assert.equal(report.passed, false);
  });

  // === H/I: retry/resume are safe because the guard is a pure recomputation, never cached state ===
  scenario("H/I: repeated calls on the same input are deterministic (no hidden state, retry/resume-safe)", () => {
    const scenes = scenarioScenes(90, 155.4);
    const first = computeVideoDurationCoverage(scenes, null);
    const second = computeVideoDurationCoverage(scenes, null);
    assert.deepEqual(first, second);
  });

  scenario("I: mutating input between calls changes the output on the next call (always reads current state, never stale)", () => {
    const before = computeVideoDurationCoverage(scenarioScenes(90, 155.4), null);
    assert.equal(before.passed, false);
    // Simulates a video-stage regeneration correcting the scene's own
    // durationSeconds to the real narration length.
    const after = computeVideoDurationCoverage(scenarioScenes(155.4, 155.4), null);
    assert.equal(after.passed, true);
  });

  // === J: regeneration propagating a corrected TTS duration downstream turns a failing render into a passing one ===
  scenario("J: regenerating the video clip at the corrected narration length turns FAIL into PASS", () => {
    const stale = [sceneVideo(1, 37.7375, 20)]; // i-stanbul chapter 1's real numbers
    assert.throws(() => assertVideoDurationCoverage(stale, null), VideoDurationCoverageError);
    const regenerated = [sceneVideo(1, 37.7375, 37.7375)];
    assert.doesNotThrow(() => assertVideoDurationCoverage(regenerated, null));
  });

  // === L: transition/blend durations are included in the legitimate-padding accounting ===
  scenario("L: blended transitions widen the legitimate padding allowance (junction quantization is real, not ignored)", () => {
    const cutScenes = [
      sceneVideo(1, 20, 20, "cut"),
      sceneVideo(2, 20, 20, "cut"),
      sceneVideo(3, 20, 20, "cut"),
    ];
    const blendedScenes = [
      sceneVideo(1, 20, 20, "cut"),
      sceneVideo(2, 20, 20, "fade"),
      sceneVideo(3, 20, 20, "crossfade"),
    ];
    const cutReport = computeVideoDurationCoverage(cutScenes, null);
    const blendedReport = computeVideoDurationCoverage(blendedScenes, null);
    assert.ok(
      blendedReport.legitimatePaddingSeconds > cutReport.legitimatePaddingSeconds,
      `blended-junction allowance (${blendedReport.legitimatePaddingSeconds}) should exceed the all-cut allowance (${cutReport.legitimatePaddingSeconds})`,
    );
  });

  // === M: the guard actually blocks large frozen-frame production end to end (pure-function level; FFmpeg-level proof lives in the two files named at the top of this suite) ===
  scenario("M: the exact real i-stanbul-un-fethi-1453 per-chapter numbers all fail the gate", () => {
    // chapter -> [plannedSeconds, realSeconds]
    const chapters: Array<[number, number]> = [
      [20, 37.7375], [20, 31.0625], [15, 26.8125], [20, 31.15], [15, 28.65],
    ];
    for (const [planned, real] of chapters) {
      const report = computeVideoDurationCoverage(scenarioScenes(planned, real), null);
      assert.equal(report.passed, false, `chapter ${planned}->${real} should fail the gate`);
    }
  });

  // === N: normal small frame-rounding-only padding still works exactly as before ===
  scenario("N: legitimate small frame-rounding padding across a realistic multi-scene, multi-transition assembly still passes", () => {
    // Non-frame-aligned narration lengths on purpose (30fps grid): each scene's
    // source clip is off by a fraction of a frame from its narration target,
    // the kind of sub-frame drift frameRoundingAllowance() exists to tolerate.
    const scenes = [
      sceneVideo(1, 22.017, 22.0, "cut"),
      sceneVideo(2, 18.983, 19.0, "fade"),
      sceneVideo(3, 25.011, 25.0, "cut"),
    ];
    const report = computeVideoDurationCoverage(scenes, null);
    assert.equal(report.passed, true, JSON.stringify(report));
    assert.ok(report.paddingRatio < 0.01, `expected near-zero padding ratio, got ${report.paddingRatio}`);
  });

  // === sanity on the reused, not reinvented, threshold source ===
  scenario("the acceptance-policy padding ratio constant matches productionAcceptanceDuration (5/90), not an arbitrary number", () => {
    assert.ok(Math.abs(ACCEPTANCE_POLICY_PADDING_RATIO - 5 / 90) < 1e-9);
  });

  console.log(`Video duration coverage guard smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "video-duration-coverage-guard", scenarios: count }));
}

try {
  run();
} catch (error) {
  console.error("Video duration coverage guard smoke FAILED:", error);
  process.exitCode = 1;
}
