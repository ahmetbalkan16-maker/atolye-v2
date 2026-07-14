export const ANIMATION_PROVIDER_CONFIGURATION_ERROR =
  "Animation provider configuration is invalid.";

export class AnimationProviderConfigurationError extends Error {
  readonly code = "ANIMATION_PROVIDER_CONFIGURATION_INVALID";

  constructor() {
    super(ANIMATION_PROVIDER_CONFIGURATION_ERROR);
    this.name = "AnimationProviderConfigurationError";
    this.stack = undefined;
  }
}

export interface OpenAIAnimationProviderConfig {
  readonly model: string;
  readonly endpoint: string;
  readonly timeoutMs: number;
  readonly retryCount: number;
  readonly maximumResponseBytes: number;
}

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const SAFE_MODEL = /^[a-zA-Z0-9._:-]{1,200}$/;

export function resolveAnimationProviderName(
  value: string | undefined = process.env.ANIMATION_PROVIDER,
) {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || normalized === "mock") return "mock" as const;
  if (normalized === "openai") return "openai" as const;
  throw new AnimationProviderConfigurationError();
}

export function getOpenAIAnimationProviderConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OpenAIAnimationProviderConfig {
  const model = environment.ANIMATION_OPENAI_MODEL?.trim();
  const endpoint = environment.ANIMATION_OPENAI_ENDPOINT?.trim();
  if (!model || !SAFE_MODEL.test(model) || !validOpenAIEndpoint(endpoint)) {
    throw new AnimationProviderConfigurationError();
  }
  return Object.freeze({
    model,
    endpoint,
    timeoutMs: integer(environment.ANIMATION_OPENAI_TIMEOUT_MS, 30_000, 100, 300_000),
    retryCount: integer(environment.ANIMATION_OPENAI_RETRY_COUNT, 1, 0, 2),
    maximumResponseBytes: integer(
      environment.ANIMATION_OPENAI_MAX_RESPONSE_BYTES,
      256 * 1024,
      1_024,
      1024 * 1024,
    ),
  });
}

function validOpenAIEndpoint(value: string | undefined): value is string {
  if (value !== OPENAI_ENDPOINT) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "" &&
      parsed.hostname === "api.openai.com" && parsed.port === "" &&
      parsed.pathname === "/v1/chat/completions" && parsed.search === "" && parsed.hash === "";
  } catch {
    return false;
  }
}

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) return fallback;
  const normalized = value.trim();
  if (!/^[0-9]+$/.test(normalized)) throw new AnimationProviderConfigurationError();
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AnimationProviderConfigurationError();
  }
  return parsed;
}
