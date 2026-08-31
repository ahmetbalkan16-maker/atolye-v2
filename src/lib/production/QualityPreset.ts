/**
 * Documentary pipeline revision — P0: the single, auditable quality-preset
 * registry.
 *
 * A preset is a named bundle of the knobs that trade render cost against render
 * quality: which text / image / TTS model each stage uses, how many AI images a
 * render may contain, the final-render resolution / CRF, the per-scene motion
 * richness, the target finished-video duration band, and a soft USD cost
 * ceiling for the whole render's AI spend.
 *
 * ## Scope of THIS module (P0)
 *
 * This file only *defines* the presets and resolves the active one from the
 * environment. It deliberately wires into **nothing** yet — every consumer is
 * added in a later, separately-tested phase:
 *
 *  - P1  → `ProductionCost*` reads `textModel` / `imageModel` / `ttsModel` /
 *          `maxAiImages` / `targetDurationSeconds` to project a render's cost
 *          per preset.
 *  - P2  → the script + scene validators read `targetDurationSeconds` /
 *          `sceneDensityPerMinute` (this is the change that lifts the current
 *          hard 60–120 s cap; until P2 lands, the 120 s script validator is
 *          still authoritative regardless of preset).
 *  - P3  → the scene director reads `sceneDensityPerMinute`.
 *  - P4  → `FFmpegSceneVideoProvider` reads `motionStyle`.
 *  - P5  → the assembly card compositor reads `motionStyle` / resolution.
 *  - P6  → real AI text-to-video reads `allowAiVideo` (false for every preset
 *          today — no real T2V provider exists).
 *
 * ## Default & determinism
 *
 * The default preset is always {@link DEFAULT_QUALITY_PRESET} (`documentary`) —
 * a fixed product choice, not environment-dependent (unlike the
 * `RealMediaProductionFlags`, which are on for a real render and off in tests).
 * The `documentary` preset's model / image / TTS / resolution values are
 * exactly today's application defaults, so wiring a consumer to
 * `resolveQualityPreset()` with no env var set is a no-op.
 *
 * `ATOLYE_QUALITY_PRESET` selects a preset by name. An unknown value throws
 * {@link QualityPresetError} — a preset is never silently downgraded. The env
 * var is *conditional* in the acceptance configuration fingerprint (it enters
 * the fingerprint only when explicitly set — see
 * `ProductionAcceptanceConfigurationFingerprint`), so every already-prepared
 * marker keeps its fingerprint.
 */

export type QualityPresetName = "economy" | "balanced" | "documentary" | "cinematic";

export const QUALITY_PRESET_NAMES: readonly QualityPresetName[] = Object.freeze([
  "economy",
  "balanced",
  "documentary",
  "cinematic",
]);

export const DEFAULT_QUALITY_PRESET: QualityPresetName = "documentary";

export interface QualityPresetDurationBand {
  /** Shortest acceptable finished-video length, seconds. */
  readonly minSeconds: number;
  /** What the script / scene director should aim for, seconds. */
  readonly idealSeconds: number;
  /** Longest acceptable finished-video length, seconds. */
  readonly maxSeconds: number;
}

export interface QualityPresetSpec {
  readonly name: QualityPresetName;
  readonly label: string;
  readonly summary: string;

  /** Text / reasoning model for every LLM planning call (research…assembly-plan, seo). */
  readonly textModel: string;
  /** Image-generation model for AI scene images + the thumbnail. */
  readonly imageModel: string;
  /** gpt-image-1 `size` for AI scene images. */
  readonly imageSize: string;
  /** gpt-image-1 `quality` for AI scene images (`auto` prices as `medium`). */
  readonly imageQuality: "auto" | "low" | "medium" | "high";
  /**
   * Per-render AI-image ceiling. Every other scene must be admissible real
   * media or the visuals stage fails closed
   * (`VisualMediaAiBudgetExceededError`). NOT scene-count-relative.
   */
  readonly maxAiImages: number;
  /** Text-to-speech model for the narration track. */
  readonly ttsModel: string;

  /** Final-render frame size. */
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly videoFps: number;
  /** libx264 `-crf` (lower = higher quality / bigger file). */
  readonly videoCrf: number;
  /** libx264 `-preset` (slower = better compression). */
  readonly x264Preset: string;

  /**
   * Per-scene motion richness (wired in P4):
   *  - `kenburns`      — today's zoom/pan + blurred-background parallax.
   *  - `kenburns-plus` — + subtle grain / vignette / light drift.
   *  - `cinematic`     — + fog / light-leak / stronger parallax layers.
   */
  readonly motionStyle: "kenburns" | "kenburns-plus" | "cinematic";

  /**
   * Target finished-video duration band (wired in P2). NOTE: until P2 lands the
   * script validator still enforces 60–120 s regardless of this value.
   */
  readonly targetDurationSeconds: QualityPresetDurationBand;
  /** Roughly how many scenes per finished minute the scene director aims for (wired in P3). */
  readonly sceneDensityPerMinute: number;

  /** Whether real AI text-to-video substitution is permitted (P6). False for every preset today. */
  readonly allowAiVideo: boolean;

  /**
   * Soft ceiling, USD, for the whole render's AI spend — the reference the cost
   * projection (P1) and the `$1` guard compare against. `documentary` is the
   * `$1` product target.
   */
  readonly costCeilingUsd: number;
}

/**
 * The registry. `documentary` mirrors today's application defaults
 * (`AIProviderConfig` `gpt-4.1-mini`, `imageProviderConfig` `gpt-image-1` /
 * `1536x1024` / `auto`, `visualMediaAdmissionPolicy.maxAiImages` `4`,
 * `AudioProviderConfig` `tts-1`, `FFmpegSceneVideoProvider` 1920×1080@30 / crf
 * 23 / `veryfast`). The other three presets fan out from it.
 */
export const QUALITY_PRESETS: Readonly<Record<QualityPresetName, QualityPresetSpec>> =
  Object.freeze({
    economy: Object.freeze({
      name: "economy",
      label: "Economy",
      summary: "Cheapest watchable cut — nano text, all-archival visuals, 720p.",
      textModel: "gpt-4.1-nano",
      imageModel: "gpt-image-1",
      imageSize: "1024x1024",
      imageQuality: "low",
      maxAiImages: 2,
      ttsModel: "tts-1",
      videoWidth: 1280,
      videoHeight: 720,
      videoFps: 30,
      videoCrf: 28,
      x264Preset: "veryfast",
      motionStyle: "kenburns",
      targetDurationSeconds: Object.freeze({ minSeconds: 300, idealSeconds: 420, maxSeconds: 600 }),
      sceneDensityPerMinute: 6,
      allowAiVideo: false,
      costCeilingUsd: 0.3,
    }),
    balanced: Object.freeze({
      name: "balanced",
      label: "Balanced",
      summary: "Mini text, a few AI images, 1080p — a solid everyday documentary.",
      textModel: "gpt-4.1-mini",
      imageModel: "gpt-image-1",
      imageSize: "1536x1024",
      imageQuality: "low",
      maxAiImages: 3,
      ttsModel: "tts-1",
      videoWidth: 1920,
      videoHeight: 1080,
      videoFps: 30,
      videoCrf: 25,
      x264Preset: "veryfast",
      motionStyle: "kenburns",
      targetDurationSeconds: Object.freeze({ minSeconds: 420, idealSeconds: 600, maxSeconds: 780 }),
      sceneDensityPerMinute: 7,
      allowAiVideo: false,
      costCeilingUsd: 0.6,
    }),
    documentary: Object.freeze({
      name: "documentary",
      label: "Documentary",
      summary: "The default. 10–15 min historical documentary, archival-first, under $1.",
      // === below: exactly today's application defaults ===
      textModel: "gpt-4.1-mini",
      imageModel: "gpt-image-1",
      imageSize: "1536x1024",
      imageQuality: "auto",
      maxAiImages: 4,
      ttsModel: "tts-1",
      videoWidth: 1920,
      videoHeight: 1080,
      videoFps: 30,
      videoCrf: 23,
      x264Preset: "veryfast",
      // === above: exactly today's application defaults ===
      motionStyle: "kenburns-plus",
      targetDurationSeconds: Object.freeze({ minSeconds: 600, idealSeconds: 780, maxSeconds: 900 }),
      sceneDensityPerMinute: 8,
      allowAiVideo: false,
      costCeilingUsd: 1.0,
    }),
    cinematic: Object.freeze({
      name: "cinematic",
      label: "Cinematic",
      summary: "Highest quality — gpt-4.1, high-detail images, HD narration. Budget > $1.",
      textModel: "gpt-4.1",
      imageModel: "gpt-image-1",
      imageSize: "1536x1024",
      imageQuality: "high",
      maxAiImages: 12,
      ttsModel: "tts-1-hd",
      videoWidth: 1920,
      videoHeight: 1080,
      videoFps: 30,
      videoCrf: 20,
      x264Preset: "slow",
      motionStyle: "cinematic",
      targetDurationSeconds: Object.freeze({ minSeconds: 600, idealSeconds: 840, maxSeconds: 1080 }),
      sceneDensityPerMinute: 9,
      allowAiVideo: true,
      costCeilingUsd: 8.0,
    }),
  });

export class QualityPresetError extends Error {
  readonly code = "QUALITY_PRESET_INVALID";
  readonly reasonCode = "QUALITY_PRESET_INVALID";

  constructor(readonly requested: string) {
    super(
      `Unknown ATOLYE_QUALITY_PRESET "${requested}". ` +
        `Valid presets: ${QUALITY_PRESET_NAMES.join(", ")}.`,
    );
    this.name = "QualityPresetError";
    this.stack = undefined;
  }
}

export function isQualityPresetName(value: unknown): value is QualityPresetName {
  return typeof value === "string" &&
    (QUALITY_PRESET_NAMES as readonly string[]).includes(value);
}

/**
 * True when `ATOLYE_QUALITY_PRESET` is explicitly set to a value. Used by the
 * acceptance configuration fingerprint to decide whether to fold the preset
 * name into `ENVIRONMENT_POLICY` — an unset var (the `documentary` default) does
 * not alter the fingerprint.
 */
export function isExplicitQualityPreset(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env.ATOLYE_QUALITY_PRESET === "string" && env.ATOLYE_QUALITY_PRESET.trim() !== "";
}

/**
 * The active quality preset. `ATOLYE_QUALITY_PRESET` selects by name
 * (case-insensitive, trimmed); unset → `documentary`; an unknown non-empty
 * value throws {@link QualityPresetError} (fail closed — never a silent
 * downgrade).
 */
export function resolveQualityPresetName(
  env: NodeJS.ProcessEnv = process.env,
): QualityPresetName {
  const raw = env.ATOLYE_QUALITY_PRESET;
  if (raw === undefined || raw.trim() === "") return DEFAULT_QUALITY_PRESET;
  const normalized = raw.trim().toLowerCase();
  if (!isQualityPresetName(normalized)) throw new QualityPresetError(raw);
  return normalized;
}

/** The active {@link QualityPresetSpec}. */
export function resolveQualityPreset(
  env: NodeJS.ProcessEnv = process.env,
): QualityPresetSpec {
  return QUALITY_PRESETS[resolveQualityPresetName(env)];
}

/**
 * The legacy finished-video duration band — the frozen `[60, 120] s, target
 * 90 s` product policy that every render used before P2. This exact object is
 * what {@link resolveTargetDurationBand} returns when no preset is *explicitly*
 * pinned, so the un-configured pipeline (and every existing test) is
 * byte-identical.
 */
export const LEGACY_TARGET_DURATION_BAND: QualityPresetDurationBand = Object.freeze({
  minSeconds: 60,
  idealSeconds: 90,
  maxSeconds: 120,
});

/**
 * The active finished-video duration band. **Backward compatible:** only an
 * EXPLICIT `ATOLYE_QUALITY_PRESET` widens the band — the implicit `documentary`
 * default resolves to {@link LEGACY_TARGET_DURATION_BAND}, so a render / test
 * without the env var keeps the historical 60–120 s policy. This is the P2
 * cutover point: pin `ATOLYE_QUALITY_PRESET=documentary` to render 10–15 min.
 */
export function resolveTargetDurationBand(
  env: NodeJS.ProcessEnv = process.env,
): QualityPresetDurationBand {
  return isExplicitQualityPreset(env)
    ? resolveQualityPreset(env).targetDurationSeconds
    : LEGACY_TARGET_DURATION_BAND;
}

/**
 * Schema ceiling for how many scenes a render may contain. Legacy (no explicit
 * preset) → `30`, unchanged. An explicit preset scales it from the band and the
 * preset's `sceneDensityPerMinute` with generous head-room.
 */
export function resolveMaxSceneCount(env: NodeJS.ProcessEnv = process.env): number {
  if (!isExplicitQualityPreset(env)) return 30;
  const band = resolveTargetDurationBand(env);
  const density = resolveQualityPreset(env).sceneDensityPerMinute;
  return Math.max(30, Math.ceil((band.maxSeconds / 60) * density * 1.5));
}

/**
 * How many chapters the strict (production-acceptance) script prompt asks for.
 * Legacy → `5` (the historical "short ~90 s documentary" prompt). An explicit
 * preset derives it from the target length (~85 s of narration per chapter),
 * clamped to a sane 5–18.
 */
export function resolveScriptChapterCount(env: NodeJS.ProcessEnv = process.env): number {
  if (!isExplicitQualityPreset(env)) return 5;
  const band = resolveTargetDurationBand(env);
  return Math.min(18, Math.max(5, Math.round(band.idealSeconds / 85)));
}
