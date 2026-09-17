/**
 * M22.6 — capability taxonomy: a fixed, durable classification of the KIND
 * of video/audio-production capability an external research finding or an
 * internal goal is about. Deliberately vendor-neutral: no category here
 * names a specific provider or product, so the taxonomy itself never
 * hardcodes a vendor-specific implementation choice — that decision stays
 * in each individual research finding's own `provider` field.
 */
export const AYAS_CAPABILITY_CATEGORIES = [
  "VIDEO_EDITING",
  "BROLL",
  "MEDIA_DISCOVERY",
  "SUBTITLES",
  "TRANSCRIPTION",
  "TTS",
  "AUDIO_CLEANUP",
  "VOICE_CONTROL",
  "SCENE_ASSEMBLY",
  "MOTION",
  "TRANSITIONS",
  "QUALITY_ASSURANCE",
  "EXPORT",
  "THUMBNAILS",
  "WORKFLOW_RESILIENCE",
  "DIAGNOSTICS",
  "PERFORMANCE",
  // AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint (Part C/J) — research is no
  // longer scoped only to Atölye video/audio production; it must also cover
  // AYAS's OWN self-improvement/engineering-intelligence capability. These 16
  // categories are deliberately vendor-neutral (same rule as the original 17
  // above) and, unlike the video/audio set, mostly relate to AYAS's own
  // `src/lib/ayas/` + `src/lib/brain/` subsystems rather than a pipeline stage.
  "AI_ASSISTANTS",
  "CODING_AGENTS",
  "RESEARCH_AGENTS",
  "MULTIMODAL_AI",
  "VOICE_AI",
  "AUDIO_AI",
  "VIDEO_AI",
  "IMAGE_AI",
  "MEMORY_CONTEXT",
  "TOOL_USE",
  "AGENT_ORCHESTRATION",
  "AUTOMATION_WORKFLOW",
  "DEVELOPER_PLATFORMS",
  "OPEN_SOURCE_AI",
  "SECURITY_RELIABILITY",
  "UI_UX",
] as const;

export type AyasCapabilityCategory = typeof AYAS_CAPABILITY_CATEGORIES[number];

export function isAyasCapabilityCategory(value: string): value is AyasCapabilityCategory {
  return (AYAS_CAPABILITY_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The Atölye pipeline module(s) a category most directly maps to — used
 * only to help a human orient ("this SUBTITLES finding relates to
 * src/lib/export/"), never as an authority/routing decision. Several
 * categories legitimately have no single obvious module (e.g. MEDIA_DISCOVERY
 * has no current Atölye equivalent at all) — those map to an empty list,
 * which is itself informative (a capability gap with no existing home).
 */
export const AYAS_CAPABILITY_CATEGORY_RELATED_PATHS: Readonly<Record<AyasCapabilityCategory, readonly string[]>> = {
  VIDEO_EDITING: ["src/lib/assembly/", "src/lib/video/"],
  BROLL: [],
  MEDIA_DISCOVERY: [],
  SUBTITLES: ["src/lib/export/"],
  TRANSCRIPTION: ["src/lib/ayas/stt/"],
  TTS: ["src/lib/audio/"],
  AUDIO_CLEANUP: ["src/lib/audio/"],
  VOICE_CONTROL: ["src/lib/ayas/stt/", "src/components/brain/voice/"],
  SCENE_ASSEMBLY: ["src/lib/assembly/", "src/lib/ai/steps/sceneStep.ts"],
  MOTION: ["src/lib/animation/"],
  TRANSITIONS: ["src/lib/assembly/", "src/lib/video/"],
  QUALITY_ASSURANCE: ["src/lib/brain/probe/", "src/lib/production/"],
  EXPORT: ["src/lib/export/"],
  THUMBNAILS: ["src/lib/thumbnail/"],
  WORKFLOW_RESILIENCE: ["src/lib/pipeline/", "src/lib/production/"],
  DIAGNOSTICS: ["src/lib/brain/probe/", "src/lib/brain/selfheal/"],
  PERFORMANCE: [],
  AI_ASSISTANTS: ["src/lib/ayas/"],
  CODING_AGENTS: ["src/lib/brain/autonomy/"],
  RESEARCH_AGENTS: ["src/lib/brain/autonomy/"],
  MULTIMODAL_AI: ["src/lib/ai/"],
  VOICE_AI: ["src/lib/ayas/stt/", "src/components/brain/voice/"],
  AUDIO_AI: ["src/lib/audio/"],
  VIDEO_AI: ["src/lib/video/", "src/lib/animation/"],
  IMAGE_AI: ["src/lib/visuals/"],
  MEMORY_CONTEXT: ["src/lib/ayas/context/"],
  TOOL_USE: ["src/lib/ayas/"],
  AGENT_ORCHESTRATION: ["src/lib/brain/autonomy/"],
  AUTOMATION_WORKFLOW: ["src/lib/pipeline/"],
  DEVELOPER_PLATFORMS: [],
  OPEN_SOURCE_AI: ["src/lib/ai/providers/"],
  SECURITY_RELIABILITY: ["src/lib/brain/selfheal/", "src/lib/production/"],
  UI_UX: ["src/components/"],
};
