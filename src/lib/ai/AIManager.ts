import type { ResearchData } from "@/types/research";
import type { SceneData, SceneItem } from "@/types/scene";
import type { ScriptChapter, ScriptData } from "@/types/script";
import type { AIRequestContext } from "@/types/aiUsage";
import type { AIProvider } from "./providers";
import { runObservedAIRequest } from "./runObservedAIRequest";
import {
  getCreatedAt,
  getNumber,
  getStringAllowEmpty,
  getStringArray,
  parseAIJsonResponse,
} from "./utils";

export class AIManager {
  static async runResearch(
    topic: string,
    context?: Partial<AIRequestContext>,
    provider?: AIProvider,
  ): Promise<ResearchData> {
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
      const { response } = await runObservedAIRequest({
        prompt,
        provider,
        context: {
          ...context,
          operation: context?.operation ?? "research",
          stage: context?.stage ?? "research",
        },
      });

      if (!response.trim()) {
        console.error("[AIManager.runResearch] Empty provider response.");
        return fallback;
      }

      const parsed = parseAIJsonResponse<Partial<ResearchData>>(response);

      return {
        topic: getStringAllowEmpty(parsed.topic, fallback.topic),
        summary: getStringAllowEmpty(parsed.summary, fallback.summary),
        historicalContext: getStringAllowEmpty(
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
        createdAt: getCreatedAt(parsed.createdAt, fallback.createdAt),
      };
    } catch (error) {
      console.error("[AIManager.runResearch] Falling back to mock research:", {
        topic,
        error,
      });

      return fallback;
    }
  }

  static async runScript(
    topic: string,
    context?: Partial<AIRequestContext>,
    provider?: AIProvider,
  ): Promise<ScriptData> {
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
      const { response } = await runObservedAIRequest({
        prompt,
        provider,
        context: {
          ...context,
          operation: context?.operation ?? "script",
          stage: context?.stage ?? "script",
        },
      });

      if (!response.trim()) {
        console.error("[AIManager.runScript] Empty provider response.");
        return fallback;
      }

      const parsed = parseAIJsonResponse<Partial<ScriptData>>(response);

      const chapters: ScriptChapter[] = Array.isArray(parsed.chapters)
        ? parsed.chapters.map((chapter, index) => {
            const item = chapter as Partial<ScriptChapter>;

            return {
              id: getNumber(item.id, index + 1),
              title: getStringAllowEmpty(item.title, `Bölüm ${index + 1}`),
              narration: getStringAllowEmpty(item.narration, ""),
              duration: getNumber(item.duration, 0),
              visualGoal: getStringAllowEmpty(item.visualGoal, ""),
              emotion: getStringAllowEmpty(item.emotion, ""),
              transition: getStringAllowEmpty(item.transition, ""),
            };
          })
        : fallback.chapters;

      return {
        topic: getStringAllowEmpty(parsed.topic, fallback.topic),
        title: getStringAllowEmpty(parsed.title, fallback.title),
        subtitle: getStringAllowEmpty(parsed.subtitle, fallback.subtitle),
        hook: getStringAllowEmpty(parsed.hook, fallback.hook),
        introduction: getStringAllowEmpty(parsed.introduction, fallback.introduction),
        chapters,
        conclusion: getStringAllowEmpty(parsed.conclusion, fallback.conclusion),
        callToAction: getStringAllowEmpty(parsed.callToAction, fallback.callToAction),
        estimatedDuration: getNumber(
          parsed.estimatedDuration,
          fallback.estimatedDuration,
        ),
        narrationWordCount: getNumber(
          parsed.narrationWordCount,
          fallback.narrationWordCount,
        ),
        targetAudience: getStringAllowEmpty(
          parsed.targetAudience,
          fallback.targetAudience,
        ),
        language: getStringAllowEmpty(parsed.language, fallback.language),
        voiceStyle: getStringAllowEmpty(parsed.voiceStyle, fallback.voiceStyle),
        musicStyle: getStringAllowEmpty(parsed.musicStyle, fallback.musicStyle),
        thumbnailIdea: getStringAllowEmpty(parsed.thumbnailIdea, fallback.thumbnailIdea),
        seoKeywords: getStringArray(parsed.seoKeywords),
        createdAt: getCreatedAt(parsed.createdAt, fallback.createdAt),
      };
    } catch (error) {
      console.error("[AIManager.runScript] Falling back to mock script:", {
        topic,
        error,
      });

      return fallback;
    }
  }

  static async runScenes(
    script: ScriptData,
    context?: Partial<AIRequestContext>,
    provider?: AIProvider,
  ): Promise<SceneData> {
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
      const { response } = await runObservedAIRequest({
        prompt,
        provider,
        context: {
          ...context,
          operation: context?.operation ?? "scenes",
          stage: context?.stage ?? "scenes",
        },
      });

      if (!response.trim()) {
        console.error("[AIManager.runScenes] Empty provider response.");
        return fallback;
      }

      const parsed = parseAIJsonResponse<Partial<SceneData>>(response);

      const scenes: SceneItem[] = Array.isArray(parsed.scenes)
        ? parsed.scenes.map((scene, index) => {
            const item = scene as Partial<SceneItem>;

            return {
              id: getNumber(item.id, index + 1),
              title: getStringAllowEmpty(item.title, `Scene ${index + 1}`),
              description: getStringAllowEmpty(item.description, ""),
              visualPrompt: getStringAllowEmpty(item.visualPrompt, ""),
              duration: getNumber(item.duration, 0),
            };
          })
        : fallback.scenes;

      return {
        scenes,
        createdAt: getCreatedAt(parsed.createdAt, fallback.createdAt),
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
