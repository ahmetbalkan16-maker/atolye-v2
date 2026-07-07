import type { ResearchData } from "@/types/research";
import type { SceneData, SceneItem } from "@/types/scene";
import type { ScriptChapter, ScriptData } from "@/types/script";
import { AIRouter } from "./router/AIRouter";

export class AIManager {
  private static router = new AIRouter();

  static async runResearch(topic: string): Promise<ResearchData> {
    const fallback: ResearchData = {
      topic,
      summary: "mock",
      historicalContext: "mock",
      timeline: [],
      characters: [],
      locations: [],
      keyEvents: [],
      strategies: [],
      controversies: [],
      interestingFacts: [],
      documentaryFlow: [],
      sceneIdeas: [],
      imagePrompts: [],
      animationPrompts: [],
      musicIdeas: [],
      soundEffects: [],
      thumbnailIdeas: [],
      youtubeTitles: [],
      sources: [],
      createdAt: new Date().toISOString(),
    };

    const prompt = [
      "You are a documentary research assistant.",
      "Create structured research data for the given topic.",
      "Return only valid JSON. Do not include markdown, comments, or extra text.",
      "The JSON object must match this TypeScript shape:",
      "{",
      '  "topic": "string",',
      '  "summary": "string",',
      '  "historicalContext": "string",',
      '  "timeline": ["string"],',
      '  "characters": ["string"],',
      '  "locations": ["string"],',
      '  "keyEvents": ["string"],',
      '  "strategies": ["string"],',
      '  "controversies": ["string"],',
      '  "interestingFacts": ["string"],',
      '  "documentaryFlow": ["string"],',
      '  "sceneIdeas": ["string"],',
      '  "imagePrompts": ["string"],',
      '  "animationPrompts": ["string"],',
      '  "musicIdeas": ["string"],',
      '  "soundEffects": ["string"],',
      '  "thumbnailIdeas": ["string"],',
      '  "youtubeTitles": ["string"],',
      '  "sources": ["string"],',
      '  "createdAt": "string"',
      "}",
      `Topic: ${topic}`,
    ].join("\n");

    try {
      const provider = this.router.getProvider("openai");
      const response = await provider.generate(prompt);

      if (!response.trim()) {
        console.error("[AIManager.runResearch] Empty provider response.");
        return fallback;
      }

      const jsonText = this.extractJson(response);
      const parsed = JSON.parse(jsonText) as Partial<ResearchData>;

      const getString = (
        value: unknown,
        fallbackValue: string,
      ): string => (typeof value === "string" ? value : fallbackValue);

      const getStringArray = (value: unknown): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : [];

      return {
        topic: getString(parsed.topic, fallback.topic),
        summary: getString(parsed.summary, fallback.summary),
        historicalContext: getString(
          parsed.historicalContext,
          fallback.historicalContext,
        ),
        timeline: getStringArray(parsed.timeline),
        characters: getStringArray(parsed.characters),
        locations: getStringArray(parsed.locations),
        keyEvents: getStringArray(parsed.keyEvents),
        strategies: getStringArray(parsed.strategies),
        controversies: getStringArray(parsed.controversies),
        interestingFacts: getStringArray(parsed.interestingFacts),
        documentaryFlow: getStringArray(parsed.documentaryFlow),
        sceneIdeas: getStringArray(parsed.sceneIdeas),
        imagePrompts: getStringArray(parsed.imagePrompts),
        animationPrompts: getStringArray(parsed.animationPrompts),
        musicIdeas: getStringArray(parsed.musicIdeas),
        soundEffects: getStringArray(parsed.soundEffects),
        thumbnailIdeas: getStringArray(parsed.thumbnailIdeas),
        youtubeTitles: getStringArray(parsed.youtubeTitles),
        sources: getStringArray(parsed.sources),
        createdAt: getString(parsed.createdAt, fallback.createdAt),
      };
    } catch (error) {
      console.error("[AIManager.runResearch] Falling back to mock research:", {
        topic,
        error,
      });

      return fallback;
    }
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

  static async runScript(topic: string): Promise<ScriptData> {
    const fallback: ScriptData = {
      topic,
      title: topic,
      subtitle: "mock",
      hook: "mock",
      introduction: "mock",
      chapters: [],
      conclusion: "mock",
      callToAction: "subscribe",
      estimatedDuration: 0,
      narrationWordCount: 0,
      targetAudience: "general",
      language: "tr",
      voiceStyle: "documentary",
      musicStyle: "cinematic",
      thumbnailIdea: "mock",
      seoKeywords: [],
      createdAt: new Date().toISOString(),
    };

    const prompt = [
      "You are a professional Turkish documentary script writer.",
      "Create a structured YouTube documentary script for the given topic.",
      "Return only valid JSON. Do not include markdown, comments, or extra text.",
      "The JSON object must match this TypeScript shape:",
      "{",
      '  "topic": "string",',
      '  "title": "string",',
      '  "subtitle": "string",',
      '  "hook": "string",',
      '  "introduction": "string",',
      '  "chapters": [',
      "    {",
      '      "id": 1,',
      '      "title": "string",',
      '      "narration": "string",',
      '      "duration": 0,',
      '      "visualGoal": "string",',
      '      "emotion": "string",',
      '      "transition": "string"',
      "    }",
      "  ],",
      '  "conclusion": "string",',
      '  "callToAction": "string",',
      '  "estimatedDuration": 0,',
      '  "narrationWordCount": 0,',
      '  "targetAudience": "string",',
      '  "language": "tr",',
      '  "voiceStyle": "string",',
      '  "musicStyle": "string",',
      '  "thumbnailIdea": "string",',
      '  "seoKeywords": ["string"],',
      '  "createdAt": "string"',
      "}",
      "Rules:",
      "- Write in Turkish.",
      "- Use a cinematic, professional documentary narration style.",
      "- Create 4 to 7 chapters in a logical historical sequence.",
      "- Each chapter narration must be suitable for voice-over.",
      "- duration and estimatedDuration must be in seconds.",
      "- visualGoal must clearly describe the visual scene for production.",
      "- seoKeywords must be Turkish search keywords.",
      `Topic: ${topic}`,
    ].join("\n");

    try {
      const provider = this.router.getProvider("openai");
      const response = await provider.generate(prompt);

      if (!response.trim()) {
        console.error("[AIManager.runScript] Empty provider response.");
        return fallback;
      }

      const jsonText = this.extractJson(response);
      const parsed = JSON.parse(jsonText) as Partial<ScriptData>;

      const getString = (
        value: unknown,
        fallbackValue: string,
      ): string => (typeof value === "string" ? value : fallbackValue);

      const getNumber = (
        value: unknown,
        fallbackValue: number,
      ): number => (typeof value === "number" ? value : fallbackValue);

      const getStringArray = (value: unknown): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : [];

      const chapters: ScriptChapter[] = Array.isArray(parsed.chapters)
        ? parsed.chapters.map((chapter, index) => {
            const item = chapter as Partial<ScriptChapter>;

            return {
              id: getNumber(item.id, index + 1),
              title: getString(item.title, `Bölüm ${index + 1}`),
              narration: getString(item.narration, ""),
              duration: getNumber(item.duration, 0),
              visualGoal: getString(item.visualGoal, ""),
              emotion: getString(item.emotion, ""),
              transition: getString(item.transition, ""),
            };
          })
        : fallback.chapters;

      return {
        topic: getString(parsed.topic, fallback.topic),
        title: getString(parsed.title, fallback.title),
        subtitle: getString(parsed.subtitle, fallback.subtitle),
        hook: getString(parsed.hook, fallback.hook),
        introduction: getString(parsed.introduction, fallback.introduction),
        chapters,
        conclusion: getString(parsed.conclusion, fallback.conclusion),
        callToAction: getString(parsed.callToAction, fallback.callToAction),
        estimatedDuration: getNumber(
          parsed.estimatedDuration,
          fallback.estimatedDuration,
        ),
        narrationWordCount: getNumber(
          parsed.narrationWordCount,
          fallback.narrationWordCount,
        ),
        targetAudience: getString(
          parsed.targetAudience,
          fallback.targetAudience,
        ),
        language: getString(parsed.language, fallback.language),
        voiceStyle: getString(parsed.voiceStyle, fallback.voiceStyle),
        musicStyle: getString(parsed.musicStyle, fallback.musicStyle),
        thumbnailIdea: getString(parsed.thumbnailIdea, fallback.thumbnailIdea),
        seoKeywords: getStringArray(parsed.seoKeywords),
        createdAt: getString(parsed.createdAt, fallback.createdAt),
      };
    } catch (error) {
      console.error("[AIManager.runScript] Falling back to mock script:", {
        topic,
        error,
      });

      return fallback;
    }
  }

  static async runScenes(script: ScriptData): Promise<SceneData> {
    const fallback: SceneData = {
      scenes: [
        {
          id: 1,
          title: "mock scene",
          description: script.title,
        },
      ],
      createdAt: new Date().toISOString(),
    };

    const scriptInput = {
      topic: script.topic,
      title: script.title,
      subtitle: script.subtitle,
      hook: script.hook,
      introduction: script.introduction,
      chapters: script.chapters,
      conclusion: script.conclusion,
      voiceStyle: script.voiceStyle,
      musicStyle: script.musicStyle,
    };

    const prompt = [
      "You are a professional documentary scene planner.",
      "Create production-ready scene data from the given documentary script.",
      "Return only valid JSON. Do not include markdown, comments, or extra text.",
      "The JSON object must match this TypeScript shape:",
      "{",
      '  "scenes": [',
      "    {",
      '      "id": 1,',
      '      "title": "string",',
      '      "description": "string",',
      '      "visualPrompt": "string",',
      '      "duration": 0',
      "    }",
      "  ],",
      '  "createdAt": "string"',
      "}",
      "Rules:",
      "- Write scene titles and descriptions in Turkish.",
      "- Create one opening scene, one scene per script chapter, and one closing scene.",
      "- description must explain what happens in the scene for a production team.",
      "- visualPrompt must be cinematic, historically grounded, and useful for image/video generation.",
      "- duration must be in seconds and should follow the script pacing.",
      "- Keep ids as sequential numbers starting from 1.",
      "Script JSON:",
      JSON.stringify(scriptInput),
    ].join("\n");

    try {
      const provider = this.router.getProvider("openai");
      const response = await provider.generate(prompt);

      if (!response.trim()) {
        console.error("[AIManager.runScenes] Empty provider response.");
        return fallback;
      }

      const jsonText = this.extractJson(response);
      const parsed = JSON.parse(jsonText) as Partial<SceneData>;

      const getString = (
        value: unknown,
        fallbackValue: string,
      ): string => (typeof value === "string" ? value : fallbackValue);

      const getNumber = (
        value: unknown,
        fallbackValue: number,
      ): number => (typeof value === "number" ? value : fallbackValue);

      const scenes: SceneItem[] = Array.isArray(parsed.scenes)
        ? parsed.scenes.map((scene, index) => {
            const item = scene as Partial<SceneItem>;

            return {
              id: getNumber(item.id, index + 1),
              title: getString(item.title, `Scene ${index + 1}`),
              description: getString(item.description, ""),
              visualPrompt: getString(item.visualPrompt, ""),
              duration: getNumber(item.duration, 0),
            };
          })
        : fallback.scenes;

      return {
        scenes,
        createdAt: getString(parsed.createdAt, fallback.createdAt),
      };
    } catch (error) {
      console.error("[AIManager.runScenes] Falling back to mock scenes:", {
        scriptTitle: script.title,
        error,
      });

      return fallback;
    }
  }
}
