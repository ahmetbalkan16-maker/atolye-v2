/**
 * F-08 fix: script/chapter duration ESTIMATION.
 *
 * Root cause (see docs/DURATION_AUTHORITY.md): `AIManager.runScript`'s prompt
 * asked the model for `estimatedDuration` and per-chapter `duration` as
 * free-form numbers ("target ~90 seconds"), with zero structural link to the
 * narration TEXT the same response also contains. The model reliably picked
 * plausible-looking, in-range numbers (e.g. 20/20/15/20/15 summing to a
 * "target 90") that were disconnected from how long that narration actually
 * takes to speak -- confirmed empirically against the real, TTS-measured
 * `i-stanbul-un-fethi-1453` project: LLM-picked total 90s vs real narrated
 * total 155.4s (+72%), and LLM-picked `narrationWordCount: 1200` vs the
 * chapters' real word count of 284 (a >4x hallucination in the same field
 * family).
 *
 * This module estimates narration duration from actual narration TEXT using
 * a character-rate model, calibrated against that same real production data
 * point (5 chapters, one TTS voice/model, Turkish):
 *
 *   chapter  chars  realSeconds  chars/sec
 *   1        532    37.737       14.10
 *   2        437    31.063       14.07
 *   3        393    26.813       14.66
 *   4        418    31.150       13.42
 *   5        414    28.650       14.45
 *   ------------------------------------
 *   total    2194   155.412      14.12  (avg, coefficient of variation ~3%)
 *
 * Character rate is used instead of a words-per-second constant because (a)
 * it was empirically far more stable across these 5 chapters than any fixed
 * "words/sec" assumption would have been (the *observed* words/sec here is
 * ~1.83, i.e. ~110 wpm -- well below a naive "2.5-3 words/sec" assumption,
 * which would itself have underestimated real duration by ~40-60%), and (b)
 * word length varies enormously across languages (agglutinative Turkish vs.
 * analytic English), so a words/sec constant is inherently language-coupled
 * in a way a characters/sec constant is not.
 *
 * IMPORTANT: this is an ESTIMATE, used only for a-priori planning (script
 * chapter duration redistribution -- see reconcileChapterDurations below).
 * It is never treated as authoritative: the only authoritative duration for
 * any narration is the real, measured TTS output length produced by the
 * audio stage (see AudioPipeline.ts / AudioDurationReconciliation.ts). This
 * module must never be imported by anything that treats its output as a
 * final/rendered duration.
 */

/** Empirically-calibrated default narration rate (characters per second). */
export const DEFAULT_CHARACTERS_PER_SECOND = 14.12;

/**
 * How much a single chapter's real TTS duration can legitimately exceed this
 * module's char-rate estimate of that same chapter, as a fraction. Derived
 * directly from the calibration table above: the slowest observed chapter ran
 * at 13.42 chars/sec against the 14.12 mean, i.e. 14.12 / 13.42 - 1 ~= 0.052,
 * so its real duration was ~5.2% longer than the char-rate estimate would
 * predict. The *aggregate* over a whole script is far tighter (coefficient of
 * variation ~3%), but any one scene-video clip -- rendered at the per-chapter
 * char-rate estimate, before any TTS exists -- can be this much shorter than
 * the real per-chapter narration purely from calibrated per-chapter variance,
 * with no estimate/reality bug involved. Consumed by
 * VideoDurationCoverageGuard's per-scene tolerance so that variance alone does
 * not trip the frozen-frame-padding gate.
 */
export const ESTIMATOR_PER_CHAPTER_VARIANCE_RATIO = 0.053;

/** A narration this short (or shorter) is almost certainly a data error, not legitimate content. */
export const MINIMUM_NARRATION_SECONDS = 1;

export interface NarrationDurationEstimateOptions {
  /** Overrides DEFAULT_CHARACTERS_PER_SECOND (e.g. a future per-voice/per-language calibration). Must be a finite number > 0. */
  charactersPerSecond?: number;
}

/**
 * Estimates how long `text` would take to narrate aloud, from its character
 * count alone. Deterministic, pure, and language-agnostic (no per-language
 * word-rate table). Never authoritative -- see module docs above.
 */
export function estimateNarrationSeconds(
  text: string,
  options: NarrationDurationEstimateOptions = {},
): number {
  const rate = options.charactersPerSecond ?? DEFAULT_CHARACTERS_PER_SECOND;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError("charactersPerSecond must be a finite number greater than 0.");
  }
  const characters = typeof text === "string" ? text.trim().length : 0;
  if (characters <= 0) return 0;
  return characters / rate;
}

/** Real (not hallucinated) word count for a narration string, using the same whitespace-split convention as the rest of the codebase. */
export function countNarrationWords(text: string): number {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export interface ChapterNarrationInput {
  id: number;
  narration: string;
  /** The model's own (unreliable) per-chapter duration pick, in seconds. */
  duration: number;
}

export interface ReconciledChapterDuration {
  id: number;
  /** Redistributed duration, in seconds -- see reconcileChapterDurations. */
  duration: number;
}

/**
 * Redistributes an already-accepted total duration (`estimatedDurationTotal`
 * -- the script's own `estimatedDuration`, which has already cleared the
 * product's length-policy checks) across chapters IN PROPORTION TO how long
 * each chapter's narration actually takes to read, instead of the model's
 * arbitrary per-chapter picks.
 *
 * Deliberately does NOT change the total: the [60,120]s / "target 90s"
 * acceptance range enforced later by
 * `ProductionAcceptancePreflight.validateProductionAcceptanceScriptDuration`
 * is a content-length product policy, not a duration-measurement bug, and is
 * out of scope here. What this function fixes is the RELATIVE split: today
 * that split is a free LLM guess with no connection to the text it wrote (a
 * scene whose narration is 2x as long as another's chapter can still be
 * assigned the same nominal duration); after this, the split matches actual
 * narration length, which materially shrinks the per-scene padding/tpad gap
 * that `VideoDurationCoverageGuard` and `buildRetimedConcatArgs`/
 * `buildTransitionedConcatArgs` (FFmpegVideoAssemblyProvider.ts) must later
 * bridge for each individual scene -- directly addressing the "one scene far
 * too long/short" class of edge case, on top of the aggregate improvement.
 *
 * Pure and deterministic: same inputs always produce the same outputs, so
 * calling this again on retry/resume/regeneration is always safe (no drift,
 * no hidden state).
 *
 * Fail-safe (not fail-closed): if narration text yields a non-finite or
 * non-positive measured estimate for any chapter (unreachable in practice,
 * since upstream schema validation already requires non-empty narration
 * strings) or the total measured estimate is not a finite positive number,
 * the original per-chapter durations are returned unchanged rather than
 * risking a corrupt redistribution.
 */
export function reconcileChapterDurations(
  chapters: readonly ChapterNarrationInput[],
  estimatedDurationTotal: number,
  options: NarrationDurationEstimateOptions = {},
): ReconciledChapterDuration[] {
  const original = chapters.map((chapter) => ({ id: chapter.id, duration: chapter.duration }));

  if (
    !Array.isArray(chapters) ||
    chapters.length === 0 ||
    !Number.isFinite(estimatedDurationTotal) ||
    estimatedDurationTotal <= 0
  ) {
    return original;
  }

  const measured = chapters.map((chapter) => estimateNarrationSeconds(chapter.narration, options));
  const measuredTotal = measured.reduce((sum, value) => sum + value, 0);

  if (!Number.isFinite(measuredTotal) || measuredTotal <= 0 || measured.some((value) => !Number.isFinite(value) || value <= 0)) {
    return original;
  }

  const redistributed = chapters.map((chapter, index) => {
    const share = measured[index] / measuredTotal;
    return {
      id: chapter.id,
      duration: estimatedDurationTotal * share,
    };
  });

  // Rounding: keep whole-second values (matches the existing schema, which
  // requires positive-integer chapter durations) while preserving the exact
  // original total -- any remainder from per-chapter flooring/rounding is
  // absorbed by the single largest chapter, so
  // sum(redistributed.duration) === round(estimatedDurationTotal) exactly.
  const roundedTotal = Math.round(estimatedDurationTotal);
  const rounded = redistributed.map((entry) => ({
    id: entry.id,
    duration: Math.max(1, Math.round(entry.duration)),
  }));
  const roundedSum = rounded.reduce((sum, entry) => sum + entry.duration, 0);
  const remainder = roundedTotal - roundedSum;
  if (remainder !== 0) {
    let largestIndex = 0;
    for (let i = 1; i < redistributed.length; i += 1) {
      if (redistributed[i].duration > redistributed[largestIndex].duration) largestIndex = i;
    }
    rounded[largestIndex] = {
      id: rounded[largestIndex].id,
      duration: Math.max(1, rounded[largestIndex].duration + remainder),
    };
  }

  return rounded;
}
