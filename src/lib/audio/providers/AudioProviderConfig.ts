import type { AudioProviderName } from "@/types/audio";
import { AUDIO_STORAGE_MAX_BYTES } from "@/lib/assets/storage/AudioStorage";
import {
  AudioIdentifierPolicyError,
  requireSafeAudioIdentifier,
} from "@/lib/audio/AudioIdentifierPolicy";

export const AUDIO_PROVIDER_CONFIGURATION_ERROR =
  "Audio provider configuration is invalid.";

export class AudioProviderConfigurationError extends Error {
  readonly code = "AUDIO_PROVIDER_CONFIGURATION_INVALID";

  constructor() {
    super(AUDIO_PROVIDER_CONFIGURATION_ERROR);
    this.name = "AudioProviderConfigurationError";
    this.stack = undefined;
  }
}

export interface OpenAIAudioProviderConfig {
  model: string;
  voice: string;
  responseFormat: "wav";
  mimeType: "audio/wav";
  maxInputCharacters: number;
  timeoutMs: number;
  maxResponseBytes: number;
}

const DEFAULT_OPENAI_TTS_MODEL = "tts-1";
const DEFAULT_OPENAI_TTS_VOICE = "alloy";
const DEFAULT_OPENAI_TTS_TIMEOUT_MS = 60_000;
const DEFAULT_OPENAI_TTS_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MIN_OPENAI_TTS_TIMEOUT_MS = 10;
const MAX_OPENAI_TTS_TIMEOUT_MS = 300_000;
const MIN_OPENAI_TTS_MAX_RESPONSE_BYTES = 1_024;
export function resolveAudioProviderName(
  value: string | undefined = process.env.AUDIO_PROVIDER,
): AudioProviderName {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return "mock";
  }

  switch (normalized) {
    case "mock":
    case "openai":
    case "piper":
      return normalized;
    default:
      throw new AudioProviderConfigurationError();
  }
}

/**
 * Local, $0 TTS — Piper (CPU, ONNX). `AUDIO_PROVIDER=piper` runs narration
 * through a local `piper` binary + a voice model instead of `api.openai.com`.
 * Turkish voice: `tr_TR-dfki-medium`.
 *
 * Env:
 *  - `PIPER_EXECUTABLE`  path to the piper binary (default `bin/piper/piper.exe`
 *                        on win32, else `bin/piper/piper`)
 *  - `PIPER_VOICE_MODEL` path to the `.onnx` voice (default
 *                        `bin/piper/tr_TR-dfki-medium.onnx`)
 *  - `PIPER_TIMEOUT_MS`  per-section synthesis timeout (default 120 000)
 *  - `PIPER_SPEAKER`     multi-speaker voice index (optional integer)
 */
export interface PiperAudioProviderConfig {
  readonly executablePath: string;
  readonly voiceModelPath: string;
  readonly mimeType: "audio/wav";
  readonly maxInputCharacters: number;
  readonly timeoutMs: number;
  readonly speaker?: number;
}

export function getPiperAudioProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): PiperAudioProviderConfig {
  const isWindows = process.platform === "win32";
  const executablePath = env.PIPER_EXECUTABLE?.trim() ||
    (isWindows ? "bin/piper/piper.exe" : "bin/piper/piper");
  const voiceModelPath = env.PIPER_VOICE_MODEL?.trim() ||
    "bin/piper/tr_TR-dfki-medium.onnx";
  const timeoutMs = resolveIntegerConfigValue(
    env.PIPER_TIMEOUT_MS, 120_000, 1_000, 900_000,
  );
  const speakerRaw = env.PIPER_SPEAKER?.trim();
  const speaker = speakerRaw && /^[0-9]+$/.test(speakerRaw) ? Number(speakerRaw) : undefined;
  return Object.freeze({
    executablePath,
    voiceModelPath,
    mimeType: "audio/wav",
    maxInputCharacters: 20_000,
    timeoutMs,
    ...(speaker !== undefined ? { speaker } : {}),
  });
}

export function getOpenAIAudioProviderConfig(): OpenAIAudioProviderConfig {
  const model = resolveSafeConfigValue(
    process.env.OPENAI_TTS_MODEL,
    DEFAULT_OPENAI_TTS_MODEL,
  );
  const voice = resolveSafeConfigValue(
    process.env.OPENAI_TTS_VOICE,
    DEFAULT_OPENAI_TTS_VOICE,
  );
  const timeoutMs = resolveIntegerConfigValue(
    process.env.OPENAI_TTS_TIMEOUT_MS,
    DEFAULT_OPENAI_TTS_TIMEOUT_MS,
    MIN_OPENAI_TTS_TIMEOUT_MS,
    MAX_OPENAI_TTS_TIMEOUT_MS,
  );
  const maxResponseBytes = resolveIntegerConfigValue(
    process.env.OPENAI_TTS_MAX_RESPONSE_BYTES,
    DEFAULT_OPENAI_TTS_MAX_RESPONSE_BYTES,
    MIN_OPENAI_TTS_MAX_RESPONSE_BYTES,
    AUDIO_STORAGE_MAX_BYTES,
  );

  return {
    model,
    voice,
    responseFormat: "wav",
    mimeType: "audio/wav",
    maxInputCharacters: 4096,
    timeoutMs,
    maxResponseBytes,
  };
}

function resolveIntegerConfigValue(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim();

  if (!/^[0-9]+$/.test(normalized)) {
    throw new AudioProviderConfigurationError();
  }

  const parsed = Number(normalized);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new AudioProviderConfigurationError();
  }

  return parsed;
}

function resolveSafeConfigValue(value: string | undefined, fallback: string) {
  const candidate = value === undefined ? fallback : value;

  try {
    return requireSafeAudioIdentifier(candidate);
  } catch (error) {
    if (!(error instanceof AudioIdentifierPolicyError)) throw error;
    throw new AudioProviderConfigurationError();
  }
}
