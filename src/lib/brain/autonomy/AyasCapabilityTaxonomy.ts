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
};
