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
      return normalized;
    default:
      throw new AudioProviderConfigurationError();
  }
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
