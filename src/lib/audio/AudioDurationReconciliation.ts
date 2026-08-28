/**
 * F-08/F-02 auditability: duration reconciliation report.
 *
 * Pure, read-only, on-demand report comparing the a-priori duration
 * ESTIMATE that scene/animation/video generation actually used (script
 * chapter `duration`, already reconciled to real narration text by
 * NarrationDurationEstimator.reconcileChapterDurations at script-generation
 * time) against the real, TTS-MEASURED duration the audio stage later
 * produced (`audio.sections[].durationSeconds`) -- the two halves of the
 * SCRIPT DURATION = ESTIMATE / TTS DURATION = MEASURED AUTHORITY contract
 * (see docs/DURATION_AUTHORITY.md).
 *
 * This module deliberately does not persist anything and is not wired into
 * any pipeline stage: it is always derivable, on demand, from the two
 * already-persisted artifacts (script.json, audio.json) that are the real
 * source of truth, so there is no separate cached state to keep in sync, go
 * stale, or need invalidating across retry/resume/regeneration -- calling it
 * again after any of those simply reflects whatever is on disk right now.
 * Operator-facing use: scripts/report-duration-reconciliation.ts (read-only
 * CLI) and VideoDurationCoverageGuard's own report cover the same territory
 * at the individual-render level; this module is the project-wide,
 * script-vs-audio-stage view used for auditing/reporting only.
 */
import type { ScriptData } from "@/types/script";
import type { AudioData } from "@/types/audio";

export interface ChapterDurationReconciliation {
  chapterId: number;
  /** The a-priori estimate used to build scene/animation/video (script.chapters[].duration, post NarrationDurationEstimator correction). */
  estimatedSeconds: number;
  /** The real, TTS-measured duration (audio.sections[].durationSeconds). Absent when the audio stage has not produced this chapter yet. */
  measuredSeconds: number | null;
  divergenceSeconds: number | null;
  divergenceRatio: number | null;
}

export interface ProjectDurationReconciliationReport {
  chapters: ChapterDurationReconciliation[];
  totalEstimatedSeconds: number;
  totalMeasuredSeconds: number | null;
  totalDivergenceRatio: number | null;
  generatedAt: string;
}

/**
 * Computes the reconciliation report from already-persisted script + audio
 * data. `audio` is optional so this can also be run before the audio stage
 * exists (every chapter then reports `measuredSeconds: null`).
 */
export function computeDurationReconciliationReport(
  script: ScriptData,
  audio: AudioData | null | undefined,
  now: () => string = () => new Date().toISOString(),
): ProjectDurationReconciliationReport {
  const measuredByChapter = new Map<number, number>();
  if (audio && Array.isArray(audio.sections)) {
    for (const section of audio.sections) {
      if (
        typeof section.chapterId === "number" &&
        Number.isFinite(section.durationSeconds) &&
        typeof section.durationSeconds === "number" &&
        section.durationSeconds > 0
      ) {
        measuredByChapter.set(section.chapterId, section.durationSeconds);
      }
    }
  }

  const chapters: ChapterDurationReconciliation[] = script.chapters.map((chapter) => {
    const measuredSeconds = measuredByChapter.get(chapter.id) ?? null;
    const divergenceSeconds = measuredSeconds === null ? null : measuredSeconds - chapter.duration;
    const divergenceRatio =
      measuredSeconds === null || chapter.duration <= 0
        ? null
        : divergenceSeconds! / chapter.duration;
    return {
      chapterId: chapter.id,
      estimatedSeconds: chapter.duration,
      measuredSeconds,
      divergenceSeconds,
      divergenceRatio,
    };
  });

  const totalEstimatedSeconds = chapters.reduce((sum, c) => sum + c.estimatedSeconds, 0);
  const measuredChapters = chapters.filter((c) => c.measuredSeconds !== null);
  const totalMeasuredSeconds = measuredChapters.length === chapters.length && chapters.length > 0
    ? measuredChapters.reduce((sum, c) => sum + (c.measuredSeconds as number), 0)
    : null;
  const totalDivergenceRatio =
    totalMeasuredSeconds === null || totalEstimatedSeconds <= 0
      ? null
      : (totalMeasuredSeconds - totalEstimatedSeconds) / totalEstimatedSeconds;

  return {
    chapters,
    totalEstimatedSeconds,
    totalMeasuredSeconds,
    totalDivergenceRatio,
    generatedAt: now(),
  };
}
