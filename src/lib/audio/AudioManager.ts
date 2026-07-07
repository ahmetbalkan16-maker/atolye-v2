import { AIRouter } from "@/lib/ai/router/AIRouter";
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
  private static router = new AIRouter();

  static async generateAudioData(script: ScriptData): Promise<AudioData> {
    const fallback = this.createFallbackAudioData(script);
    const prompt = createAudioPrompt(script);

    try {
      const provider = this.router.getProvider("openai");
      const response = await provider.generate(prompt);

      if (!response.trim()) {
        console.error("[AudioManager] Empty provider response.");
        return fallback;
      }

      const parsed = JSON.parse(this.extractJson(response)) as Partial<AudioData>;

      return {
        narrator: this.mapNarrator(parsed.narrator, fallback.narrator),
        sections: this.mapSections(parsed.sections, script.chapters),
        music: this.mapMusic(parsed.music, fallback.music),
        production: this.mapProduction(parsed.production, fallback.production),
        createdAt:
          typeof parsed.createdAt === "string"
            ? parsed.createdAt
            : fallback.createdAt,
      };
    } catch (error) {
      console.error("[AudioManager] Falling back to local audio plan:", error);
      return fallback;
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

    if (!narrator || typeof narrator !== "object") {
      return fallback;
    }

    return {
      style: this.getString(narrator.style, fallback.style),
      tone: this.getString(narrator.tone, fallback.tone),
      language: this.getString(narrator.language, fallback.language),
      voiceProvider: this.getOptionalString(narrator.voiceProvider),
      voiceId: this.getOptionalString(narrator.voiceId),
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
          typeof section.chapterId === "number"
            ? section.chapterId
            : fallback.chapterId,
        title: this.getString(section.title, fallback.title),
        duration: this.getString(section.duration, fallback.duration),
        emotion: this.getString(section.emotion, fallback.emotion),
        emphasis: this.getStringArray(section.emphasis, fallback.emphasis),
        narrationNotes: this.getString(
          section.narrationNotes,
          fallback.narrationNotes,
        ),
        pacing: this.getString(section.pacing, fallback.pacing),
        sourceText: this.getString(section.sourceText, fallback.sourceText),
        audioFileUrl: this.getOptionalString(section.audioFileUrl),
      };
    });
  }

  private static mapMusic(
    value: unknown,
    fallback: AudioMusicPlan,
  ): AudioMusicPlan {
    const music = value as Partial<AudioMusicPlan>;

    if (!music || typeof music !== "object") {
      return fallback;
    }

    return {
      mood: this.getString(music.mood, fallback.mood),
      suggestion: this.getString(music.suggestion, fallback.suggestion),
      intensity: this.getString(music.intensity, fallback.intensity),
    };
  }

  private static mapProduction(
    value: unknown,
    fallback: AudioProductionInfo,
  ): AudioProductionInfo {
    const production = value as Partial<AudioProductionInfo>;

    if (!production || typeof production !== "object") {
      return fallback;
    }

    return {
      targetFormat:
        production.targetFormat === "wav" || production.targetFormat === "mp3"
          ? production.targetFormat
          : fallback.targetFormat,
      sampleRate:
        typeof production.sampleRate === "number"
          ? production.sampleRate
          : fallback.sampleRate,
      estimatedTotalDuration: this.getString(
        production.estimatedTotalDuration,
        fallback.estimatedTotalDuration,
      ),
      generationStatus:
        production.generationStatus === "generated" ||
        production.generationStatus === "failed" ||
        production.generationStatus === "planned"
          ? production.generationStatus
          : fallback.generationStatus,
      audioFileUrl: this.getOptionalString(production.audioFileUrl),
    };
  }

  private static extractJson(response: string): string {
    const trimmed = response.trim();
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);

    if (fencedMatch?.[1]) {
      return fencedMatch[1].trim();
    }

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start !== -1 && end !== -1 && end > start) {
      return trimmed.slice(start, end + 1);
    }

    return trimmed;
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

  private static getString(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
  }

  private static getOptionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  private static getStringArray(
    value: unknown,
    fallback: string[],
  ): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : fallback;
  }
}
