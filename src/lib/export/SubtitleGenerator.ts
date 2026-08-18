import type { AudioData } from "@/types/audio";

/**
 * Chapter/section-level SRT + VTT generation.
 *
 * Scope (Sprint 132, deliberate): this repository has no word- or scene-level
 * speech timing or per-scene narration text anywhere in its data model (see
 * Sprint 132 architectural review). The only real, non-estimated timing +
 * text pairing available is at chapter (AudioSection) granularity: each
 * chapter's real narration duration (measured from its stored WAV file) and
 * that chapter's full narration text (AudioSection.sourceText). This module
 * therefore produces exactly one cue per chapter, never a finer grain.
 *
 * Cue boundaries are the cumulative sum of prior chapters' real durations, in
 * `audio.sections` array order - the same order FFmpegVideoAssemblyProvider
 * concatenates scenes/chapters into the final rendered video, so a chapter's
 * cue window matches where that chapter's narration actually sits in the
 * physical output.
 */

export class SubtitleGenerationError extends Error {
  readonly code = "SUBTITLE_GENERATION_FAILED";

  constructor(reason: string) {
    super(`Subtitle generation failed: ${reason}`);
    this.name = "SubtitleGenerationError";
    this.stack = undefined;
  }
}

export interface ChapterSubtitleCue {
  index: number;
  chapterId: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface ChapterSubtitleResult {
  cues: ChapterSubtitleCue[];
  totalDurationSeconds: number;
  srt: string;
  vtt: string;
}

/** Cues shorter than this are rejected rather than silently rounded to zero width. */
const MIN_CUE_DURATION_SECONDS = 0.05;

/**
 * Builds chapter-level cues from real audio data. `chapterDurationSeconds`
 * must carry one verified, physically-measured (non-estimated) duration per
 * chapter id referenced in `audio.sections` - callers are responsible for
 * resolving those from the real stored narration WAV files (never a planned/
 * estimated duration) before calling this function.
 */
export function buildChapterSubtitles(
  audio: AudioData,
  chapterDurationSeconds: ReadonlyMap<number, number>,
): ChapterSubtitleResult {
  const sections = audio?.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new SubtitleGenerationError("no audio sections available");
  }

  const seenChapterIds = new Set<number>();
  let cursor = 0;
  const cues: ChapterSubtitleCue[] = [];

  sections.forEach((section, index) => {
    const chapterId = section?.chapterId;
    if (!Number.isSafeInteger(chapterId) || chapterId <= 0) {
      throw new SubtitleGenerationError(`section ${index + 1} has an invalid chapterId`);
    }
    if (seenChapterIds.has(chapterId)) {
      throw new SubtitleGenerationError(`chapter id ${chapterId} is duplicated`);
    }
    seenChapterIds.add(chapterId);

    const duration = chapterDurationSeconds.get(chapterId);
    if (!Number.isFinite(duration) || (duration as number) < MIN_CUE_DURATION_SECONDS) {
      throw new SubtitleGenerationError(
        `chapter ${chapterId} has no real, non-zero narration duration`,
      );
    }

    const text = sanitizeCueText(section.sourceText);
    if (!text) {
      throw new SubtitleGenerationError(`chapter ${chapterId} has no narration text`);
    }

    const start = cursor;
    const end = cursor + (duration as number);
    cues.push({ index: index + 1, chapterId, startSeconds: start, endSeconds: end, text });
    cursor = end;
  });

  if (chapterDurationSeconds.size !== seenChapterIds.size) {
    throw new SubtitleGenerationError(
      "chapter duration set does not match the chapters referenced by audio.sections",
    );
  }

  return {
    cues,
    totalDurationSeconds: cursor,
    srt: renderSrt(cues),
    vtt: renderVtt(cues),
  };
}

/**
 * Collapses a chapter's narration text to one safe cue paragraph: strips C0
 * control codes and DEL (Turkish Unicode letters are untouched - they are all
 * above the control-code range), neutralizes any literal "-->" sequence so it
 * can never be mistaken for a cue timing separator, and joins wrapped lines
 * with single spaces.
 */
function sanitizeCueText(value: string | undefined): string {
  if (typeof value !== "string") return "";
  const withoutControlCharacters = stripControlCharacters(value);
  return withoutControlCharacters
    .replace(/-->/g, "→")
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .trim();
}

/**
 * Removes C0 control codes (keeping CR/LF, which the caller splits on) and
 * DEL. Implemented as an explicit char-code filter rather than a regex
 * literal containing raw control bytes, so the pattern can't be
 * mis-transcribed by any text-handling step.
 */
function stripControlCharacters(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const isC0Control = code <= 0x1f && code !== 0x0a && code !== 0x0d;
    const isDelete = code === 0x7f;
    result += isC0Control || isDelete ? " " : char;
  }
  return result;
}

function renderSrt(cues: readonly ChapterSubtitleCue[]): string {
  return cues
    .map((cue) =>
      [
        String(cue.index),
        `${formatTimestamp(cue.startSeconds, ",")} --> ${formatTimestamp(cue.endSeconds, ",")}`,
        cue.text,
        "",
      ].join("\r\n"),
    )
    .join("\r\n");
}

function renderVtt(cues: readonly ChapterSubtitleCue[]): string {
  const body = cues
    .map((cue) =>
      [
        String(cue.index),
        `${formatTimestamp(cue.startSeconds, ".")} --> ${formatTimestamp(cue.endSeconds, ".")}`,
        cue.text,
        "",
      ].join("\n"),
    )
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

/**
 * Both cue boundaries are rounded independently with the same function, so a
 * shared real-valued boundary (end of cue N === start of cue N+1) always
 * rounds to the identical millisecond on both sides: cues are contiguous,
 * never overlapping.
 */
function formatTimestamp(seconds: number, separator: "," | "."): string {
  const totalMilliseconds = Math.round(seconds * 1000);
  const ms = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${separator}${pad(ms, 3)}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
