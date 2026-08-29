import type { ResearchData } from "@/types/research";
import type { SceneData, SceneItem } from "@/types/scene";
import type { ScriptChapter, ScriptData } from "@/types/script";
import type { AIRequestContext } from "@/types/aiUsage";
import type { AIProvider } from "./providers";
import {
  failClosedOrReturn,
  type GenerationExecutionPolicy,
} from "./GenerationExecutionPolicy";
import { runObservedAIRequest } from "./runObservedAIRequest";
import { AIResponseError } from "./AIResponseError";
import { getResearchMaxTokens, ResearchAIConfigError } from "./ResearchAIConfig";
import { getScriptMaxTokens, ScriptAIConfigError } from "./ScriptAIConfig";
import { parseStrictScriptResponse } from "./ScriptStructuredOutput";
import { createScenesPrompt, parseStrictScenesResponse } from "./SceneStructuredOutput";
import {
  countNarrationWords,
  DEFAULT_CHARACTERS_PER_SECOND,
  estimateNarrationSeconds,
  reconcileChapterDurations,
} from "./NarrationDurationEstimator";
import { ApplicationTimestampError } from "./CanonicalTimestamp";
import {
  createResearchPrompt,
  parseStrictResearchResponse,
} from "./ResearchStructuredOutput";
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
    policy?: GenerationExecutionPolicy,
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

    const prompt = createResearchPrompt(topic);

    try {
      const observed = await runObservedAIRequest({
        prompt,
        provider,
        maxTokens: getResearchMaxTokens(),
        context: {
          ...context,
          operation: context?.operation ?? "research",
          stage: context?.stage ?? "research",
        },
      });
      if (observed.errorCode) throw new AIResponseError(observed.errorCode);
      const { response } = observed;

      if (!response.trim()) {
        console.error("[AIManager.runResearch] Empty provider response.");
        return failClosedOrReturn(fallback, policy);
      }

      if (policy?.failClosed) return parseStrictResearchResponse(response);
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
      if (
        policy?.failClosed &&
        (error instanceof AIResponseError || error instanceof ResearchAIConfigError || error instanceof ApplicationTimestampError)
      ) throw error;
      if (policy?.failClosed) return failClosedOrReturn(fallback, policy);
      console.error("[AIManager.runResearch] Falling back to mock research:", {
        topic,
        error,
      });

      return failClosedOrReturn(fallback, policy);
    }
  }

  static async runScript(
    topic: string,
    context?: Partial<AIRequestContext>,
    provider?: AIProvider,
    policy?: GenerationExecutionPolicy,
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
      '  "seoKeywords": ["string"]',
      "}",
      "Rules:",
      "- Use exactly the keys shown above. Every key is required and additional fields are forbidden.",
      "- Every string must be non-empty.",
      "- Do not include createdAt; the application adds it after provider validation.",
      "- Write in Turkish.",
      "- Use a cinematic, professional documentary narration style.",
      "- Create 4 to 7 chapters in a logical historical sequence.",
      "- Each chapter narration must be suitable for voice-over.",
      "- duration and estimatedDuration must be in seconds.",
      "- visualGoal must clearly describe the visual scene for production.",
      "- seoKeywords must be Turkish search keywords.",
      "- Use 1 to 20 seoKeywords; each keyword must be at most 100 characters.",
      "- Field limits: topic/title 300, subtitle 500, hook 1500, introduction 2500, conclusion 2000, callToAction 1000 characters.",
      "- Chapter limits: title 300, narration 1200, visualGoal 1200, emotion 300, transition 500 characters.",
      "- Chapter id, chapter duration, estimatedDuration, and narrationWordCount must be positive integers; chapter ids must be unique.",
      `- Narration length is what sets the final video length: the application measures each chapter's narration at about ${DEFAULT_CHARACTERS_PER_SECOND.toFixed(1)} characters per second and derives that chapter's duration (and estimatedDuration) from it. Size each chapter's narration so its character count is close to its intended duration in seconds multiplied by ${DEFAULT_CHARACTERS_PER_SECOND.toFixed(1)}; the per-chapter duration you write is only honoured to the extent your narration text supports it.`,
      ...(policy?.failClosed ? [
        "- Override the chapter-count range above: create exactly 5 chapters (this is a short, ~90 second documentary).",
        "- Production acceptance estimatedDuration must be between 60 and 120 seconds; target 90 seconds.",
        "- The sum of chapter durations must match estimatedDuration within 5 seconds.",
        `- Narration budget (strict - it directly sets the final video length, and a script whose narration does not fit 60-120 seconds at ${DEFAULT_CHARACTERS_PER_SECOND.toFixed(1)} chars/sec is rejected): every chapter's narration must be at least 260 characters (this is a hard minimum - shorter narration produces a video that is too short and is rejected) and at most 340 characters; the five chapters' narration combined should total roughly 1300 to 1450 characters (about 92-103 seconds). Write full, detailed documentary paragraphs, not one-liners.`,
      ] : []),
      `Topic: ${topic}`,
    ].join("\n");
    try {
      const observed = await runObservedAIRequest({
        prompt,
        provider,
        maxTokens: getScriptMaxTokens(),
        context: {
          ...context,
          operation: context?.operation ?? "script",
          stage: context?.stage ?? "script",
        },
      });
      if (observed.errorCode) throw new AIResponseError(observed.errorCode);
      const { response } = observed;

      if (!response.trim()) {
        console.error("[AIManager.runScript] Empty provider response.");
        return failClosedOrReturn(fallback, policy);
      }

      const parsed = policy?.failClosed
        ? parseStrictScriptResponse(response)
        : parseAIJsonResponse<Partial<ScriptData>>(response);

      const rawChapters: ScriptChapter[] = Array.isArray(parsed.chapters)
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

      const estimatedDuration = getNumber(
        parsed.estimatedDuration,
        fallback.estimatedDuration,
      );

      // F-08 fix: `duration`/`estimatedDuration` above are the model's own
      // free-form picks, structurally disconnected from the narration text it
      // wrote in the very same response (see NarrationDurationEstimator.ts for
      // the root-cause evidence). Two corrections:
      //  - legacy path: redistribute the model's own total across chapters by
      //    actual narration length, leaving the total untouched.
      //  - strict/production-acceptance path: the model reliably picks an
      //    `estimatedDuration` ~30-60% longer than the narration it actually
      //    wrote takes to speak (empirically confirmed again on the Fatih runs
      //    2026-08-29: narration ~60-82s vs picked 95-110). Downstream
      //    scene/video clips are then built at that inflated a-priori number
      //    while assembly targets the real, much shorter TTS narration, and
      //    VideoDurationCoverageGuard fails closed. So here the *estimate* is
      //    made honest -- set to the calibrated char-rate estimate of the real
      //    narration and redistributed across chapters accordingly. The
      //    [60,120]s acceptance policy still applies unchanged
      //    (ProductionAcceptancePreflight), and real TTS-measured duration
      //    (audio stage) remains the only authoritative duration downstream.
      const measuredNarrationSeconds = rawChapters.reduce(
        (sum, chapter) => sum + estimateNarrationSeconds(chapter.narration),
        0,
      );
      const effectiveEstimatedDuration =
        policy?.failClosed && rawChapters.length > 0 && measuredNarrationSeconds > 0
          ? Math.round(measuredNarrationSeconds)
          : estimatedDuration;
      const reconciledDurations = rawChapters.length > 0
        ? new Map(
            reconcileChapterDurations(rawChapters, effectiveEstimatedDuration).map(
              (entry) => [entry.id, entry.duration] as const,
            ),
          )
        : new Map<number, number>();
      const chapters: ScriptChapter[] = rawChapters.map((chapter) => ({
        ...chapter,
        duration: reconciledDurations.get(chapter.id) ?? chapter.duration,
      }));

      // Same family of bug as estimatedDuration: the model's own
      // narrationWordCount is an independent free-form guess with no
      // structural link to the narration text (observed 1200 vs an actual
      // 284 on the real i-stanbul-un-fethi-1453 script). Recomputed here from
      // the same chapters actually returned, so it is always honest.
      const narrationWordCount = chapters.reduce(
        (sum, chapter) => sum + countNarrationWords(chapter.narration),
        0,
      );

      return {
        topic: getStringAllowEmpty(parsed.topic, fallback.topic),
        title: getStringAllowEmpty(parsed.title, fallback.title),
        subtitle: getStringAllowEmpty(parsed.subtitle, fallback.subtitle),
        hook: getStringAllowEmpty(parsed.hook, fallback.hook),
        introduction: getStringAllowEmpty(parsed.introduction, fallback.introduction),
        chapters,
        conclusion: getStringAllowEmpty(parsed.conclusion, fallback.conclusion),
        callToAction: getStringAllowEmpty(parsed.callToAction, fallback.callToAction),
        estimatedDuration: chapters.length > 0 ? effectiveEstimatedDuration : estimatedDuration,
        narrationWordCount: chapters.length > 0
          ? narrationWordCount
          : getNumber(parsed.narrationWordCount, fallback.narrationWordCount),
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
      if (
        policy?.failClosed &&
        (error instanceof AIResponseError || error instanceof ScriptAIConfigError || error instanceof ApplicationTimestampError)
      ) throw error;
      if (policy?.failClosed) return failClosedOrReturn(fallback, policy);
      console.error("[AIManager.runScript] Falling back to mock script:", {
        topic,
        error,
      });

      return failClosedOrReturn(fallback, policy);
    }
  }

  static async runScenes(
    script: ScriptData,
    context?: Partial<AIRequestContext>,
    provider?: AIProvider,
    policy?: GenerationExecutionPolicy,
  ): Promise<SceneData> {
    const fallback: SceneData = {
      scenes: [
        {
          id: 1,
          ...(policy?.failClosed
            ? { chapterId: script.chapters[0]?.id ?? 1 }
            : {}),
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

    const legacyPrompt = [
      "You are a professional documentary scene planner.",
      "Create production-ready scene data from the given documentary script.",
      "Return only valid JSON. Do not include markdown, comments, or extra text.",
      "The JSON object must match this TypeScript shape:",
      "{",
      '  "scenes": [',
      "    {",
      '      "id": 1,',
      ...(policy?.failClosed ? ['      "chapterId": 1,'] : []),
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
      ...(policy?.failClosed ? [
        "- Create one or more scenes for every script chapter.",
        "- chapterId must reference an existing script chapter id.",
        "- Keep scenes grouped in script chapter order.",
        "- Integrate opening and closing beats into chapter-owned scenes; do not create ownerless scenes.",
      ] : [
        "- Create one opening scene, one scene per script chapter, and one closing scene.",
      ]),
      "- description must explain what happens in the scene for a production team.",
      "- visualPrompt must be cinematic, historically grounded, and useful for image/video generation.",
      "- duration must be in seconds and should follow the script pacing.",
      "- Keep ids as sequential numbers starting from 1.",
      ...(policy?.failClosed ? [
        "- The sum of scene durations for each chapter must match that chapter duration within 5 seconds.",
        "- The total scene duration must be between 60 and 120 seconds and match script estimatedDuration within 5 seconds.",
      ] : []),
      "Script JSON:",
      JSON.stringify(scriptInput),
    ].join("\n");
    const prompt = policy?.failClosed ? createScenesPrompt(script) : legacyPrompt;

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
        return failClosedOrReturn(fallback, policy);
      }

      if (policy?.failClosed) return parseStrictScenesResponse(response, script);
      const parsed = parseAIJsonResponse<Partial<SceneData>>(response);

      const scenes: SceneItem[] = Array.isArray(parsed.scenes)
        ? parsed.scenes.map((scene, index) => {
            const item = scene as Partial<SceneItem>;

            return {
              id: getNumber(item.id, index + 1),
              ...(policy?.failClosed
                ? {
                    chapterId: getNumber(
                      item.chapterId,
                      script.chapters[0]?.id ?? index + 1,
                    ),
                  }
                : {}),
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
      if (
        policy?.failClosed &&
        (error instanceof AIResponseError || error instanceof ApplicationTimestampError)
      ) throw error;
      if (policy?.failClosed) return failClosedOrReturn(fallback, policy);
      console.error("[AIManager.runScenes] Falling back to mock scenes:", {
        scriptTitle: script.title,
        error,
      });

      return failClosedOrReturn(fallback, policy);
    }
  }
}
