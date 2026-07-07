import { ResearchData } from "@/types/research";
import { ScriptData } from "@/types/script";
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
    return {
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
  }

  static async runScenes(script: ScriptData) {
    return {
      scenes: [
        {
          id: 1,
          title: "mock scene",
          description: script.title,
        },
      ],
    };
  }
}
