import { ResearchData } from "@/types/research";
import { ScriptData } from "@/types/script";

export class AIManager {
  static async runResearch(topic: string): Promise<ResearchData> {
    return {
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