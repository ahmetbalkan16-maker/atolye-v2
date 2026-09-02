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
import { getSceneMaxTokens, SceneAIConfigError } from "./SceneAIConfig";
import { parseStrictScriptResponse } from "./ScriptStructuredOutput";
import { createScenesPrompt, parseStrictScenesResponse } from "./SceneStructuredOutput";
import { formatResearchForPrompt } from "./ResearchPromptContext";
import { resolveProductionAcceptanceDuration } from "@/lib/production/ProductionAcceptancePreflight";
import {
  isExplicitQualityPreset,
  resolveScriptChapterCount,
} from "@/lib/production/QualityPreset";
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

/**
 * Downstream stages (animation, video, assembly) accept a per-scene duration of
 * 1–300 s and fail closed outside it. Keep a parsed non-strict scene duration
 * inside that window: 0 / negative / NaN -> 1 s, absurd -> 300 s. Never widens a
 * valid value.
 */
const SCENE_DURATION_MIN_SECONDS = 1;
const SCENE_DURATION_MAX_SECONDS = 300;
function clampSceneDurationSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < SCENE_DURATION_MIN_SECONDS) {
    return SCENE_DURATION_MIN_SECONDS;
  }
  return Math.min(SCENE_DURATION_MAX_SECONDS, seconds);
}

/**
 * Non-strict scenes carry no `chapterId`, so the proper strict-path
 * `reconcileSceneDurations` cannot run. This is the lightweight equivalent: when
 * the parsed scene durations sum to something wildly off from the script's own
 * (already F-08-reconciled) `estimatedDuration` — a weaker model routinely
 * writes near-zero or wildly inflated per-scene durations — rescale them to that
 * total so the downstream video / assembly coverage guard is not handed a
 * per-scene clip budget that cannot cover the narration. A sane set of durations
 * is left untouched.
 */
function normalizeNonStrictSceneDurations(
  scenes: SceneItem[],
  script: ScriptData,
): SceneItem[] {
  if (scenes.length === 0) return scenes;
  const target = getNumber(script.estimatedDuration, 0);
  if (!Number.isFinite(target) || target < scenes.length) return scenes;

  const total = scenes.reduce((sum, scene) => sum + getNumber(scene.duration, 0), 0);
  if (total > 0 && total >= target * 0.6 && total <= target * 1.6) return scenes;

  // The parsed durations are untrustworthy as a whole — spread the script's
  // narration-derived total evenly across the scenes.
  const perScene = clampSceneDurationSeconds(Math.round(target / scenes.length));
  return scenes.map((scene) => ({ ...scene, duration: perScene }));
}

/**
 * P2: the strict (production-acceptance) script prompt's duration / chapter /
 * narration-budget lines. With no EXPLICIT `ATOLYE_QUALITY_PRESET` these are the
 * historical "exactly 5 chapters, ~90 s" lines verbatim; an explicit preset
 * scales the chapter count, the acceptance band and the per-chapter narration
 * character budget from the resolved band.
 */
function strictScriptDurationPromptLines(env: NodeJS.ProcessEnv = process.env): string[] {
  const cps = DEFAULT_CHARACTERS_PER_SECOND;
  if (!isExplicitQualityPreset(env)) {
    return [
      "- Override the chapter-count range above: create exactly 5 chapters (this is a short, ~90 second documentary).",
      "- Production acceptance estimatedDuration must be between 60 and 120 seconds; target 90 seconds.",
      "- The sum of chapter durations must match estimatedDuration within 5 seconds.",
      `- Narration budget (strict - it directly sets the final video length, and a script whose narration does not fit 60-120 seconds at ${cps.toFixed(1)} chars/sec is rejected): every chapter's narration must be at least 260 characters (this is a hard minimum - shorter narration produces a video that is too short and is rejected) and at most 340 characters; the five chapters' narration combined should total roughly 1300 to 1450 characters (about 92-103 seconds). Write full, detailed documentary paragraphs, not one-liners.`,
    ];
  }
  const band = resolveProductionAcceptanceDuration(env);
  const chapters = resolveScriptChapterCount(env);
  const perChapterSeconds = band.targetSeconds / chapters;
  const perChapterChars = Math.round(perChapterSeconds * cps);
  const minChars = Math.round(perChapterChars * 0.82);
  const maxChars = Math.round(perChapterChars * 1.2);
  const totalLow = Math.round(band.minimumSeconds * cps);
  const totalHigh = Math.round(band.maximumSeconds * cps);
  return [
    `- Override the chapter-count range above: create exactly ${chapters} chapters (this is an ~${Math.round(band.targetSeconds / 60)} minute documentary).`,
    `- Production acceptance estimatedDuration must be between ${band.minimumSeconds} and ${band.maximumSeconds} seconds; target ${band.targetSeconds} seconds.`,
    `- The sum of chapter durations must match estimatedDuration within ${band.toleranceSeconds} seconds.`,
    `- Narration budget (strict - it directly sets the final video length, and a script whose narration does not fit ${band.minimumSeconds}-${band.maximumSeconds} seconds at ${cps.toFixed(1)} chars/sec is rejected): every chapter's narration must be between about ${minChars} and ${maxChars} characters; the ${chapters} chapters' narration combined should total roughly ${totalLow} to ${totalHigh} characters. Write full, detailed documentary paragraphs, not one-liners.`,
  ];
}

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
    research?: ResearchData | null,
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
      "Documentary storytelling (shape the script like a short film, not an encyclopedia entry):",
      "- hook: open on the single most striking concrete image or the highest-stakes moment - a specific scene, not a thesis statement. Make the viewer need to know what happens next in the first sentence.",
      "- introduction: one or two sentences of context only - who, when, why it matters.",
      "- Order the chapters as rising action: context -> build-up / preparation -> the central confrontation -> the climax (the decisive turning point, told with the most vivid detail and shortest sentences) -> consequences -> legacy.",
      "- Narration craft: concrete sensory detail over abstract summary; prefer active voice over passive constructions; vary sentence length; name the key people and places explicitly; build cause and effect between chapters. Avoid vague filler ('with great vision', 'will be examined in detail', 'played an important role').",
      "- transition: end each chapter on a forward pull into the next, not a summary.",
      "- conclusion: land the meaning in one or two lines. callToAction: one short, natural line.",
      "Historical accuracy (non-negotiable):",
      "- Never invent or approximate ages, dates, names, or numbers. If the research block below states a fact, use it exactly and do not contradict it.",
      "- Prefer the specific, well-attested, visually rich beats of this topic over generic ones. Do not omit the events the topic is famous for.",
      "- Do not present uncertain or disputed claims as settled fact.",
      ...(research ? [
        "Research findings to ground this script in (authoritative - do not contradict; draw the concrete facts, names, dates, places and events from here):",
        formatResearchForPrompt(research),
      ] : []),
      ...(policy?.failClosed ? strictScriptDurationPromptLines() : []),
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
    research?: ResearchData | null,
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
    const prompt = policy?.failClosed
      ? createScenesPrompt(script, research ?? undefined)
      : legacyPrompt;

    try {
      const { response } = await runObservedAIRequest({
        prompt,
        provider,
        maxTokens: getSceneMaxTokens(),
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
        ? normalizeNonStrictSceneDurations(
            parsed.scenes.map((scene, index) => {
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
                // Clamp into the downstream-valid window [1, 300]s. A weaker
                // model occasionally emits a 0 / negative / absurd scene
                // duration, which would otherwise fail the animation stage
                // closed (`SCENE_DURATION_INVALID`) and sink the whole render.
                duration: clampSceneDurationSeconds(getNumber(item.duration, 0)),
              };
            }),
            script,
          )
        : fallback.scenes;

      return {
        scenes,
        createdAt: getCreatedAt(parsed.createdAt, fallback.createdAt),
      };
    } catch (error) {
      if (
        policy?.failClosed &&
        (error instanceof AIResponseError ||
          error instanceof ApplicationTimestampError ||
          error instanceof SceneAIConfigError)
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
