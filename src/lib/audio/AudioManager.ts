import { runObservedAIRequest } from "@/lib/ai/runObservedAIRequest";
import { AudioAIConfigError, getAudioMaxTokens } from "@/lib/ai/AudioAIConfig";
import { AIResponseError } from "@/lib/ai/AIResponseError";
import { failClosedOrReturn, type GenerationExecutionPolicy } from "@/lib/ai/GenerationExecutionPolicy";
import type { AIProvider } from "@/lib/ai/providers";
import {
  getCreatedAt,
  getNumber,
  getOptionalString,
  getStringAllowEmpty,
  getStringArray,
  isRecord,
  parseAIJsonResponse,
} from "@/lib/ai/utils";
import type { AIRequestContext } from "@/types/aiUsage";
import type {
  AudioData,
  AudioMusicPlan,
  AudioNarrator,
  AudioProductionInfo,
  AudioSection,
} from "@/types/audio";
import type { ScriptChapter, ScriptData } from "@/types/script";
import { createAudioPrompt } from "./prompts/audioPrompt";

export class AudioManager {
  static async generateAudioData(
    script: ScriptData,
    context?: Partial<AIRequestContext>,
    options: { aiProvider?: AIProvider; generationPolicy?: GenerationExecutionPolicy } = {},
  ): Promise<AudioData> {
    const fallback = this.createFallbackAudioData(script);
    const prompt = createAudioPrompt(script);

    try {
      const observed = await runObservedAIRequest({
        prompt,
        provider: options.aiProvider,
        maxTokens: getAudioMaxTokens(),
        context: {
          ...context,
          operation: context?.operation ?? "audio-plan",
          stage: context?.stage ?? "audio",
        },
      });
      if (observed.errorCode) throw new AIResponseError(observed.errorCode);
      const { response } = observed;

      if (!response.trim()) {
        console.error("[AudioManager] Empty provider response.");
        return failClosedOrReturn(fallback, options.generationPolicy);
      }

      const parsed = parseAIJsonResponse<Partial<AudioData>>(response);
      if (
        options.generationPolicy?.failClosed &&
        !isStrictAudioResponse(parsed, script.chapters.length)
      ) throw new Error("invalid");

      return {
        narrator: this.mapNarrator(parsed.narrator, fallback.narrator),
        sections: this.mapSections(parsed.sections, script.chapters),
        music: this.mapMusic(parsed.music, fallback.music),
        production: this.mapProduction(parsed.production, fallback.production),
        createdAt: getCreatedAt(parsed.createdAt, fallback.createdAt),
      };
    } catch (error) {
      if (options.generationPolicy?.failClosed && error instanceof AudioAIConfigError) {
        throw error;
      }
      if (options.generationPolicy?.failClosed) return failClosedOrReturn(fallback, options.generationPolicy);
      console.error("[AudioManager] Falling back to local audio plan:", error);
      return failClosedOrReturn(fallback, options.generationPolicy);
    }
  }

  private static createFallbackAudioData(script: ScriptData): AudioData {
    const sections = script.chapters.map((chapter) =>
      this.createFallbackSection(chapter),
    );

    return {
      narrator: {
        style: script.voiceStyle || "deep documentary",
        tone: "serious",
        language: script.language || "tr",
        voiceProvider: "planned",
      },
      sections,
      music: {
        mood: "cinematic",
        suggestion: script.musicStyle || "dark orchestral documentary bed",
        intensity: "medium",
      },
      production: {
        targetFormat: "mp3",
        sampleRate: 44100,
        estimatedTotalDuration: this.formatDuration(script.estimatedDuration),
        generationStatus: "planned",
      },
      createdAt: new Date().toISOString(),
    };
  }

  private static createFallbackSection(chapter: ScriptChapter): AudioSection {
    return {
      chapterId: chapter.id,
      title: chapter.title,
      duration: this.formatDuration(chapter.duration),
      emotion: chapter.emotion || "serious",
      emphasis: this.extractEmphasis(chapter.narration),
      narrationNotes:
        "Belgesel anlatımı, net diksiyon, kontrollü vurgu ve sinematik tempo.",
      pacing: "medium",
      sourceText: chapter.narration,
    };
  }

  private static mapNarrator(
    value: unknown,
    fallback: AudioNarrator,
  ): AudioNarrator {
    const narrator = value as Partial<AudioNarrator>;

    if (!isRecord(narrator)) {
      return fallback;
    }

    return {
      style: getStringAllowEmpty(narrator.style, fallback.style),
      tone: getStringAllowEmpty(narrator.tone, fallback.tone),
      language: getStringAllowEmpty(narrator.language, fallback.language),
      voiceProvider: getOptionalString(narrator.voiceProvider),
      voiceId: getOptionalString(narrator.voiceId),
    };
  }

  private static mapSections(
    value: unknown,
    chapters: ScriptChapter[],
  ): AudioSection[] {
    if (!Array.isArray(value)) {
      return chapters.map((chapter) => this.createFallbackSection(chapter));
    }

    return value.map((item, index) => {
      const section = item as Partial<AudioSection>;
      const chapter = chapters[index];
      const fallback = chapter
        ? this.createFallbackSection(chapter)
        : {
            chapterId: index + 1,
            title: `Bölüm ${index + 1}`,
            duration: "00:30",
            emotion: "serious",
            emphasis: [],
            narrationNotes: "",
            pacing: "medium",
            sourceText: "",
          };

      return {
        chapterId:
          getNumber(section.chapterId, fallback.chapterId),
        title: getStringAllowEmpty(section.title, fallback.title),
        duration: getStringAllowEmpty(section.duration, fallback.duration),
        emotion: getStringAllowEmpty(section.emotion, fallback.emotion),
        emphasis: getStringArray(section.emphasis, fallback.emphasis),
        narrationNotes: getStringAllowEmpty(
          section.narrationNotes,
          fallback.narrationNotes,
        ),
        pacing: getStringAllowEmpty(section.pacing, fallback.pacing),
        sourceText: getStringAllowEmpty(section.sourceText, fallback.sourceText),
        audioFileUrl: getOptionalString(section.audioFileUrl),
      };
    });
  }

  private static mapMusic(
    value: unknown,
    fallback: AudioMusicPlan,
  ): AudioMusicPlan {
    const music = value as Partial<AudioMusicPlan>;

    if (!isRecord(music)) {
      return fallback;
    }

    return {
      mood: getStringAllowEmpty(music.mood, fallback.mood),
      suggestion: getStringAllowEmpty(music.suggestion, fallback.suggestion),
      intensity: getStringAllowEmpty(music.intensity, fallback.intensity),
    };
  }

  private static mapProduction(
    value: unknown,
    fallback: AudioProductionInfo,
  ): AudioProductionInfo {
    const production = value as Partial<AudioProductionInfo>;

    if (!isRecord(production)) {
      return fallback;
    }

    return {
      targetFormat:
        production.targetFormat === "wav" || production.targetFormat === "mp3"
          ? production.targetFormat
          : fallback.targetFormat,
      sampleRate:
        getNumber(production.sampleRate, fallback.sampleRate),
      estimatedTotalDuration: getStringAllowEmpty(
        production.estimatedTotalDuration,
        fallback.estimatedTotalDuration,
      ),
      generationStatus:
        production.generationStatus === "generated" ||
        production.generationStatus === "failed" ||
        production.generationStatus === "planned"
          ? production.generationStatus
          : fallback.generationStatus,
      audioFileUrl: getOptionalString(production.audioFileUrl),
    };
  }

  private static formatDuration(seconds: number): string {
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = Math.round(safeSeconds % 60);

    return `${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds,
    ).padStart(2, "0")}`;
  }

  private static extractEmphasis(text: string): string[] {
    return text
      .split(/\s+/)
      .filter((word) => word.length > 6)
      .slice(0, 5);
  }

}

function isStrictAudioResponse(value: Partial<AudioData>, expectedSectionCount: number) {
  const narrator = value.narrator as Partial<AudioNarrator> | undefined;
  const music = value.music as Partial<AudioMusicPlan> | undefined;
  const production = value.production as Partial<AudioProductionInfo> | undefined;
  return Boolean(narrator) && [narrator?.style, narrator?.tone, narrator?.language]
    .every(nonEmptyString) &&
    Array.isArray(value.sections) && value.sections.length === expectedSectionCount &&
    value.sections.every((section) => typeof section?.chapterId === "number" &&
      [section.title, section.duration, section.emotion, section.narrationNotes, section.pacing, section.sourceText]
        .every(nonEmptyString) && Array.isArray(section.emphasis) && section.emphasis.every((item) => typeof item === "string")) &&
    Boolean(music) && [music?.mood, music?.suggestion, music?.intensity].every(nonEmptyString) &&
    Boolean(production) && (production?.targetFormat === "mp3" || production?.targetFormat === "wav") &&
    typeof production?.sampleRate === "number" && Number.isFinite(production.sampleRate) &&
    nonEmptyString(production.estimatedTotalDuration) &&
    ["planned", "generating", "generated", "failed"].includes(production.generationStatus ?? "") &&
    validTimestamp(value.createdAt);
}

function nonEmptyString(value: unknown): value is string { return typeof value === "string" && Boolean(value.trim()); }
function validTimestamp(value: unknown) { if (typeof value !== "string") return false; const parsed = Date.parse(value); return Number.isFinite(parsed) && new Date(parsed).toISOString() === value; }
