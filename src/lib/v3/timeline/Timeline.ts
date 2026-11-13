import type { Episode } from "../episode/EpisodeTypes";
import type { V3Viseme } from "../render/RenderPlanTypes";

/** Seconds, measured on the real synthesized audio: the voice track is the timing authority. */
export interface LineAudio {
  readonly file: string;
  readonly duration: number;
  /** Mouth shapes relative to the line start. */
  readonly visemes: readonly { readonly t: number; readonly v: V3Viseme }[];
  /** Word timings relative to the line start (whisper.cpp, or proportional fallback). */
  readonly words: readonly { readonly text: string; readonly start: number; readonly end: number }[];
  readonly lipSync: "rhubarb" | "rms";
}

export interface LineTiming extends LineAudio {
  readonly sceneIndex: number;
  readonly lineIndex: number;
  readonly speaker: string;
  readonly start: number;
  readonly end: number;
}

export interface SceneTiming {
  readonly sceneIndex: number;
  readonly start: number;
  readonly end: number;
}

export interface EpisodeTimeline {
  readonly lines: readonly LineTiming[];
  readonly scenes: readonly SceneTiming[];
  readonly duration: number;
  /** Seconds of title cover before the first scene (0 = none). */
  readonly intro?: number;
}

export interface TimelineOptions {
  /** Silence before the first line of a scene. */
  readonly sceneLead: number;
  /** Silence after the last line of a scene. */
  readonly sceneTail: number;
  /** Gap when the speaker changes (a reply). */
  readonly replyGap: number;
  /** Gap between two lines of the same speaker. */
  readonly sameSpeakerGap: number;
  /** Title cover before the first scene, seconds (the owner's opening cover; 0 = none). */
  readonly introS?: number;
}

export const DEFAULT_TIMELINE: TimelineOptions = { sceneLead: 0.3, sceneTail: 0.45, replyGap: 0.28, sameSpeakerGap: 0.16 };

/** Lays every line end to end with natural 150–400 ms gaps. `audio[s][l]` is scene s, line l. */
export function buildTimeline(episode: Episode, audio: readonly (readonly LineAudio[])[], opts: TimelineOptions = DEFAULT_TIMELINE): EpisodeTimeline {
  const lines: LineTiming[] = [];
  const scenes: SceneTiming[] = [];
  const intro = Math.max(0, opts.introS ?? 0);
  let t = intro;
  episode.sahneler.forEach((scene, si) => {
    const sceneStart = t;
    t += opts.sceneLead;
    let prevSpeaker: string | undefined;
    scene.satirlar.forEach((line, li) => {
      const a = audio[si]?.[li];
      if (!a) throw new Error(`TIMELINE_AUDIO_MISSING: sahne ${scene.id} satır ${li}`);
      if (prevSpeaker !== undefined) t += prevSpeaker === line.karakter ? opts.sameSpeakerGap : opts.replyGap;
      lines.push({ ...a, sceneIndex: si, lineIndex: li, speaker: line.karakter, start: t, end: t + a.duration });
      t += a.duration;
      prevSpeaker = line.karakter;
    });
    t += opts.sceneTail;
    scenes.push({ sceneIndex: si, start: sceneStart, end: t });
  });
  return { lines, scenes, duration: t, ...(intro ? { intro } : {}) };
}

/** The tightest a fitted timeline's pauses get, as a share of their own length: below it the lines run together. */
export const MIN_PAUSE_SHARE = 0.4;

/**
 * buildTimeline with its pauses tightened just enough that it ends by `maxS` (a Short's ceiling: past 180 s YouTube
 * no longer shows it as a Short). The script's top length (405 words for 180 s, ScriptEngine's band) is ≤ 179 s only at
 * the slowest measured pace with pauses, 2.26 words/s; a slower voice or more, shorter lines — a reply gap each — ran
 * past it with nothing but a warning. Never tighter than MIN_PAUSE_SHARE; a timeline already in time is unchanged.
 */
export function fitTimeline(episode: Episode, audio: readonly (readonly LineAudio[])[], opts: TimelineOptions, maxS: number): EpisodeTimeline {
  const timeline = buildTimeline(episode, audio, opts);
  if (timeline.duration <= maxS) return timeline;
  const speech = timeline.lines.reduce((a, l) => a + (l.end - l.start), 0);
  const pauses = timeline.duration - (timeline.intro ?? 0) - speech;
  if (pauses <= 0) return timeline;
  const k = Math.max(MIN_PAUSE_SHARE, 1 - (timeline.duration - maxS) / pauses);
  return buildTimeline(episode, audio, { ...opts, sceneLead: opts.sceneLead * k, sceneTail: opts.sceneTail * k, replyGap: opts.replyGap * k, sameSpeakerGap: opts.sameSpeakerGap * k });
}
