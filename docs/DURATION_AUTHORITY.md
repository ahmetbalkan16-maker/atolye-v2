# Duration authority (F-08 / F-02)

## The contract

- **SCRIPT DURATION = ESTIMATE.** `script.json`'s `estimatedDuration` and each
  chapter's `duration` are an a-priori planning number, computed (not
  guessed) from the chapter's actual narration text via
  `src/lib/ai/NarrationDurationEstimator.ts`. It exists before any audio has
  been synthesized and is never authoritative.
- **TTS DURATION = MEASURED AUTHORITY.** `audio.json`'s
  `sections[].durationSeconds` (and the audio asset's own `durationSeconds`)
  is the real, ffprobe/WAV-header-measured length of the synthesized
  narration. This is the only authoritative duration for any narration, for
  every stage, always.
- **DOWNSTREAM VIDEO DURATION = RECONCILED TARGET.** At assembly time,
  `allocateProductionSceneAudioSegments` (`src/lib/production/ProductionAcceptancePreflight.ts`)
  distributes each chapter's *real* measured audio duration across its
  scenes, producing `narrationDurationSeconds` per scene
  (`VideoAssemblySceneVideoInput.narrationDurationSeconds`). That -- never
  the pre-existing video clip's own `durationSeconds` -- is the target every
  scene's final on-screen length is retimed to.
- **ASSEMBLY TPAD = SMALL ROUNDING SAFETY NET.** `tpad=stop_mode=clone` in
  `FFmpegVideoAssemblyProvider.ts` (`buildRetimedConcatArgs` /
  `buildTransitionedConcatArgs`) still exists and still runs. It is not
  removed. What changed is that assembly no longer treats a render as
  successful when tpad is covering a *large* estimate/reality gap instead of
  genuine sub-frame rounding drift -- see the quality gate below.

## Why this was broken (root cause)

Pipeline stage order (`research -> script -> scenes -> visuals -> animation
-> video -> audio -> assembly -> ...`) runs **video generation before
audio**, so at the point scene-video clips are rendered, the real narration
length is not yet knowable -- some a-priori estimate is unavoidable there.
The bug was never that an estimate existed; it's that the estimate had **no
structural connection** to the narration text it accompanied:

- `AIManager.runScript`'s prompt asked the model for `estimatedDuration` and
  each chapter's `duration` as free-form numbers ("target ~90 seconds"),
  with no link to the narration text in the same response. Confirmed on the
  real, protected `i-stanbul-un-fethi-1453` project: claimed total 90s vs.
  real TTS-measured total 155.4s (+72%); claimed `narrationWordCount: 1200`
  vs. the chapters' real word count of 284 (same bug, different field).
- That (fictional) `estimatedDuration`/chapter `duration` is then the
  **schema-enforced** target for scene generation
  (`SceneStructuredOutput.validateProviderScenes`: each chapter's scene
  durations must sum within 5s of `chapter.duration`; total within 5s of
  `estimatedDuration`), then flows unchanged through
  `AnimationPromptGenerator` (`durationSeconds: sourceScene?.duration ?? 6`),
  `AnimationAssetPipeline` (the animation provider must echo back exactly
  the duration it was given), to `VideoPipeline` (`video.durationSeconds =
  motionPlan.durationSeconds`). No stage recomputes it from anything real.
- Assembly then targets the real `narrationDurationSeconds` (correctly) but
  the scene-video clip is fixed at the stale estimate, so
  `buildRetimedConcatArgs`/`buildTransitionedConcatArgs` bridge the gap with
  `tpad`, freezing the last frame for the shortfall -- measured at ~36-48%
  of several scenes' final duration on the real project.

## The fix

**Layer 1 -- honest a-priori estimate** (`NarrationDurationEstimator.ts`,
wired into `AIManager.runScript`): after the script response is parsed, each
chapter's `duration` is redistributed across chapters in proportion to how
long its *actual* narration text takes to read (character-rate model,
calibrated at ~14.12 chars/sec against the real i-stanbul-un-fethi-1453
project's own chapters -- see the module's docstring for the full data).
`estimatedDuration`'s *total* is deliberately left unchanged: the [60,120]s
"target 90s" range is a content-length product policy
(`productionAcceptanceDuration` in `ProductionAcceptancePreflight.ts`), not
a duration-measurement bug, and changing it is out of scope. `narrationWordCount`
is recomputed the same way (real count, not the model's independent guess).
This mainly fixes the *relative* per-chapter/per-scene accuracy (directly
addressing "one scene far too long/short"); a prompt-side pacing hint
(also added to `AIManager.runScript`'s prompt, using the same calibrated
rate) nudges the *absolute* total to be more realistic too, but is guidance
for the model's own content generation, never a downstream authority.

**Layer 2 -- auditability** (`src/lib/audio/AudioDurationReconciliation.ts`):
a pure, on-demand report comparing the estimate that was actually used to
build video/animation against the real measured audio duration, for
operator/regeneration tooling. Not wired into any pipeline stage or
persisted state -- always derived fresh from `script.json` + `audio.json`,
so it is automatically retry/resume/regeneration-safe.

**Layer 3 -- fail-closed quality gate** (`src/lib/assembly/VideoDurationCoverageGuard.ts`,
wired into `VideoAssemblyManager.renderExistingAssets`): computes, from the
exact same per-scene `durationSeconds`/`narrationDurationSeconds` pairs the
FFmpeg provider consumes, how much of the final output would be real
footage vs. frozen tpad padding, and throws `VideoDurationCoverageError`
(`code: "VIDEO_DURATION_COVERAGE_FAILED"`) before rendering when either the
aggregate or any single scene's padding ratio exceeds what the render
pipeline's own tolerance architecture -- `frameRoundingAllowance()` +
`durationTolerance()` (`FFmpegVideoAssemblyProvider.ts`) plus the existing
`productionAcceptanceDuration.toleranceSeconds/targetSeconds` acceptance
ratio -- already treats as legitimate. None of the three threshold
components is a number invented for this gate; see the module's docstring
for the full derivation. On success, the same metrics
(`narrationDurationSeconds`, `videoDurationSeconds`, `coverageRatio`,
`paddingDurationSeconds`, `paddingRatio`) are persisted into
`assembly.json`'s `render.quality`.

**Layer 4 -- multi-shot scene-duration reconciliation**
(`src/lib/ai/SceneStructuredOutput.ts`: `reconcileSceneDurations` +
`validateScriptDurationAuthority`, wired into `parseStrictScenesResponse`,
which `AIManager.runScenes` calls). When a chapter is broken into several
short shots (documentary pacing, one scene = one shot), the model cannot
reliably make ~15 per-shot durations sum to *both* every chapter's
`duration` *and* the grand `estimatedDuration`. Same principle as Layer 1's
`reconcileChapterDurations`: the model's per-scene `duration` numbers are
treated as **relative weights only**, and each chapter's authoritative
`script.chapters[].duration` (already narration-reconciled by Layer 1) is
redistributed deterministically across its scenes -- integer seconds,
per-chapter sum exact (rounding remainder absorbed by the chapter's largest
scene), a final pass aligns the grand total with `estimatedDuration`, never
`<1s`. Order inside `parseStrictScenesResponse` is deliberate and mirrors
F-08: (1) structural/schema validation (shape, ids, ordering, string
limits, per-scene duration RANGE) gates first so reconciliation can never
mask a real defect; (2) `validateScriptDurationAuthority` -- **fail-closed**
`AI_RESPONSE_SCHEMA_INVALID` if the authoritative input itself is unusable
(no chapters, non-integer/non-positive chapter id, or a chapter
`duration`/`estimatedDuration` that is missing, non-finite (NaN/Infinity),
or `<= 0`); (3) deterministic reconciliation; (4) authoritative
per-chapter-sum + grand-total validation against the reconciled values.
`reconcileSceneDurations` is itself **fail-SAFE** (returns the input
unchanged when it cannot reconcile safely) so step 4 still fails closed on
the real defect. This does not touch `ProductionAcceptancePreflight`,
`VideoDurationCoverageGuard`, `NarrationDurationEstimator`, or any
persistence contract.

## What did not change

- The pipeline stage order (still `... -> video -> audio -> assembly -> ...`).
- The [60,120]s / "target 90s" script-length acceptance policy.
- `tpad` itself, or its use for genuine sub-frame rounding drift.
- Any already-rendered project's persisted assets (this fix changes what
  future generation/assembly runs do; it does not retroactively touch
  anything on disk).

## Tests

- `scripts/smoke-narration-duration-estimator.ts` -- Layer 1, pure functions.
- `scripts/smoke-multi-shot-duration-reconciliation.ts` -- Layer 4, pure
  functions + `parseStrictScenesResponse` (reconciliation never masks a
  structural defect; fail-closed on a non-finite/negative/missing
  authoritative duration; model durations are not the authority).
- `scripts/smoke-script-duration-reconciliation-wiring.ts` -- Layer 1, wired
  through `AIManager.runScript`'s real strict/legacy response parsing.
- `scripts/smoke-video-duration-coverage-guard.ts` -- Layer 3, pure
  functions, the full lettered scenario list (A-N) plus remaining edge
  cases.
- `scripts/smoke-assembly-scene-video-consumption.ts` (scenario 8) -- Layer
  3 wired into `VideoAssemblyManager` with a real FFmpeg retime/tpad render.
- `scripts/diagnose-istanbul-1453-assembly-render-readonly.ts` -- read-only,
  against a temp copy of the real project: confirms the gate would now
  reject that project's exact historical assembly render.
