import { createHash } from "node:crypto";
import {
  animationMotionTypes,
  animationTransitionTypes,
} from "@/types/animation";
import { isValidAnimationDuration } from "../AnimationMotionPlanValidation";
import {
  canonicalAnimationProviderSchema,
  createAnimationMotionPlanSystemPrompt,
  validateAnimationProviderPlan,
  type CanonicalAnimationProviderPlan,
} from "../AnimationStructuredOutput";
import type {
  AnimationGenerationInput,
  AnimationGenerationResult,
  AnimationProvider,
  AnimationRequestIdentity,
} from "./AnimationProvider";
import {
  getOpenAIAnimationProviderConfig,
  type OpenAIAnimationProviderConfig,
} from "./AnimationProviderConfig";
import type {
  AnimationFinishReason,
  AnimationMotionPlanErrorCode,
  AnimationProviderDiagnosticMetadata,
} from "@/types/animationError";

type Fetcher = typeof fetch;
type FailureCode = Extract<AnimationGenerationResult, { success: false }>["error"];
const MAXIMUM_REQUEST_BYTES = 32 * 1024;

export class OpenAIAnimationProvider implements AnimationProvider {
  readonly name = "openai";

  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly loadConfig: () => OpenAIAnimationProviderConfig =
      getOpenAIAnimationProviderConfig,
  ) {}

  getRequestIdentity(input: AnimationGenerationInput): AnimationRequestIdentity {
    validateInput(input);
    return requestIdentity(input, this.loadConfig());
  }

  async generateAnimation(
    input: AnimationGenerationInput,
  ): Promise<AnimationGenerationResult> {
    const startedAt = Date.now();
    let model: string | undefined;
    try {
      validateInput(input);
      const config = this.loadConfig();
      model = config.model;
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) {
        return failure(input, model, "ANIMATION_MOTION_PLAN_FAILED", {
          sceneId: input.sceneId,
          phase: "provider-request",
          provider: "openai",
          model,
          reason: "PROVIDER_NOT_CONFIGURED",
          durationMs: Date.now() - startedAt,
          retryCount: 0,
        });
      }
      const body = deterministicRequest(input, config.model);
      const identity = requestIdentity(input, config, body);

      for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
        const result = await this.request(
          input,
          config,
          apiKey,
          body,
          identity.requestIdentity,
        );
        if (result.success || !result.retryable || attempt === config.retryCount) {
          const metadata = {
            ...result.metadata,
            durationMs: Date.now() - startedAt,
            retryCount: attempt,
          };
          return result.success
            ? success(input, config.model, identity.requestIdentity, result.plan, metadata)
            : failure(
                input,
                config.model,
                result.retryable && attempt > 0
                  ? "ANIMATION_PROVIDER_RETRY_EXHAUSTED"
                  : result.code,
                {
                  ...metadata,
                  ...(result.retryable && attempt > 0 ? { reason: result.code } : {}),
                },
              );
        }
      }
    } catch {
      // Normalize all configuration, transport and validation details.
    }
    return failure(input, model, "ANIMATION_MOTION_PLAN_FAILED", {
      sceneId: validSceneId(input.sceneId) ? input.sceneId : 0,
      phase: "input-validation",
      provider: "openai",
      ...(model ? { model } : {}),
      reason: "UNKNOWN_PROVIDER_FAILURE",
      durationMs: Date.now() - startedAt,
      retryCount: 0,
    });
  }

  private async request(
    input: AnimationGenerationInput,
    config: OpenAIAnimationProviderConfig,
    apiKey: string,
    body: string,
    idempotencyKey: string,
  ): Promise<RequestResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchWithAbort(this.fetcher(config.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body,
        signal: controller.signal,
        redirect: "error",
      }), controller.signal);
      if (!response.ok) {
        await cancelBody(response.body);
        return {
          success: false,
          code: "ANIMATION_PROVIDER_HTTP_FAILED",
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
          metadata: diagnostic(input, "provider-request", {
            httpStatus: response.status,
            reason: "HTTP_STATUS_FAILED",
          }),
        };
      }
      const bounded = await readBoundedJson(response, config.maximumResponseBytes, controller);
      if (controller.signal.aborted) {
        return timeoutFailure(input);
      }
      const payload = bounded.payload;
      const choice = payload?.choices?.[0];
      const content = choice?.message?.content;
      const finishReason = normalizeFinishReason(choice?.finish_reason);
      const responseMetadata = {
        finishReason,
        responseLength: typeof content === "string" ? content.length : 0,
        ...usage(payload?.usage),
      };
      if (typeof choice?.message?.refusal === "string" && choice.message.refusal.trim()) {
        return invalid(input, "ANIMATION_PROVIDER_REFUSAL", {
          ...responseMetadata,
          reason: "PROVIDER_REFUSAL",
        });
      }
      if (finishReason === "length") {
        return invalid(input, "ANIMATION_RESPONSE_TRUNCATED", {
          ...responseMetadata,
          reason: "COMPLETION_LENGTH_LIMIT",
        });
      }
      if (finishReason !== "stop") {
        return invalid(input, "ANIMATION_RESPONSE_INCOMPLETE", {
          ...responseMetadata,
          reason: "COMPLETION_NOT_STOPPED",
        });
      }
      if (typeof content !== "string") {
        return invalid(input, "ANIMATION_RESPONSE_INCOMPLETE", {
          ...responseMetadata,
          reason: "RESPONSE_CONTENT_SHAPE_INVALID",
        });
      }
      if (typeof content !== "string" || !content.trim()) {
        return invalid(input, "ANIMATION_RESPONSE_EMPTY", {
          ...responseMetadata,
        });
      }
      let plan: unknown;
      try {
        plan = JSON.parse(content);
      } catch {
        return invalid(input, "ANIMATION_RESPONSE_INVALID_JSON", {
          ...responseMetadata,
        });
      }
      const metadata = diagnostic(input, "provider-response", {
        ...responseMetadata,
      });
      const validation = validateAnimationProviderPlan(plan);
      return validation.success
        ? { success: true, plan: validation.plan, metadata }
        : invalid(input, "ANIMATION_RESPONSE_SCHEMA_INVALID", {
            ...metadata,
            reason: "MOTION_PLAN_SCHEMA_INVALID",
            issueCount: validation.issueCount,
            schemaIssues: validation.issues,
          });
    } catch (error) {
      if (error instanceof ResponseValidationError) {
        return invalid(input, error.code, {
          responseLength: error.responseLength,
          reason: error.reason,
        });
      }
      return controller.signal.aborted || isAbort(error)
        ? timeoutFailure(input)
        : {
            success: false,
            code: "ANIMATION_PROVIDER_HTTP_FAILED",
            retryable: true,
            metadata: diagnostic(input, "provider-request", {
              reason: "NETWORK_REQUEST_FAILED",
            }),
          };
    } finally {
      clearTimeout(timeout);
    }
  }
}

type RequestResult =
  | {
      success: true;
      plan: CanonicalAnimationProviderPlan;
      metadata: AnimationProviderDiagnosticMetadata;
    }
  | {
      success: false;
      code: FailureCode;
      retryable: boolean;
      metadata: AnimationProviderDiagnosticMetadata;
    };

type ProviderPayload = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type BoundedProviderResponse = {
  payload: ProviderPayload;
  responseLength: number;
};

function deterministicRequest(input: AnimationGenerationInput, model: string) {
  const body = JSON.stringify({
    model,
    messages: [
      {
        role: "system",
        content: createAnimationMotionPlanSystemPrompt(),
      },
      {
        role: "user",
        content: JSON.stringify({
          animationPrompt: input.animationPrompt.trim(),
          durationSeconds: input.durationSeconds,
          allowedMotionTypes: animationMotionTypes,
          allowedTransitionTypes: animationTransitionTypes,
        }),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "animation_motion_plan",
        strict: true,
        schema: canonicalAnimationProviderSchema.jsonSchema,
      },
    },
    temperature: 0,
  });
  if (Buffer.byteLength(body, "utf8") > MAXIMUM_REQUEST_BYTES) {
    throw new Error("invalid");
  }
  return body;
}

function requestIdentity(
  input: AnimationGenerationInput,
  config: OpenAIAnimationProviderConfig,
  body = deterministicRequest(input, config.model),
): AnimationRequestIdentity {
  const requestIdentity = createHash("sha256").update(body).digest("hex");
  return Object.freeze({
    assetId: `animation-${requestIdentity}`,
    requestIdentity,
    promptDigest: createHash("sha256").update(input.animationPrompt.trim()).digest("hex"),
    model: config.model,
  });
}

function validateInput(input: AnimationGenerationInput) {
  if (
    !Number.isSafeInteger(input.sceneId) || input.sceneId <= 0 ||
    !/^[a-zA-Z0-9-_]{1,200}$/.test(input.sourceImageAssetId) ||
    typeof input.animationPrompt !== "string" || !input.animationPrompt.trim() ||
    input.animationPrompt.length > 8_000 ||
    !isValidAnimationDuration(input.durationSeconds)
  ) throw new Error("invalid");
}

function success(
  input: AnimationGenerationInput,
  model: string,
  requestIdentity: string,
  plan: CanonicalAnimationProviderPlan,
  diagnostic: AnimationProviderDiagnosticMetadata,
): AnimationGenerationResult {
  return {
    success: true,
    sceneId: input.sceneId,
    sourceImageAssetId: input.sourceImageAssetId,
    provider: "openai",
    model,
    generationMode: "production",
    requestIdentity,
    artifactType: "motion-plan",
    status: "generated",
    durationSeconds: input.durationSeconds,
    motionType: plan.motionType,
    start: plan.start,
    end: plan.end,
    transition: plan.transition,
    diagnostic,
  };
}

function failure(
  input: AnimationGenerationInput,
  model: string | undefined,
  error: FailureCode,
  diagnostic: AnimationProviderDiagnosticMetadata,
): AnimationGenerationResult {
  return {
    success: false,
    sceneId: input.sceneId,
    sourceImageAssetId: input.sourceImageAssetId,
    provider: "openai",
    model,
    generationMode: "production",
    error,
    diagnostic,
  };
}

function invalid(
  input: AnimationGenerationInput,
  code: Extract<AnimationMotionPlanErrorCode,
    | "ANIMATION_RESPONSE_EMPTY"
    | "ANIMATION_RESPONSE_INVALID_JSON"
    | "ANIMATION_RESPONSE_SCHEMA_INVALID"
    | "ANIMATION_RESPONSE_TRUNCATED"
    | "ANIMATION_RESPONSE_INCOMPLETE"
    | "ANIMATION_PROVIDER_REFUSAL"
    | "ANIMATION_RESPONSE_TOO_LARGE">,
  metadata: Partial<AnimationProviderDiagnosticMetadata> = {},
): RequestResult {
  return {
    success: false,
    code,
    retryable: false,
    metadata: diagnostic(input, "provider-response", metadata),
  };
}

function timeoutFailure(input: AnimationGenerationInput): RequestResult {
  return {
    success: false,
    code: "ANIMATION_PROVIDER_TIMEOUT",
    retryable: true,
    metadata: diagnostic(input, "provider-request", { reason: "REQUEST_TIMEOUT" }),
  };
}

function diagnostic(
  input: AnimationGenerationInput,
  phase: AnimationProviderDiagnosticMetadata["phase"],
  metadata: Partial<AnimationProviderDiagnosticMetadata> = {},
): AnimationProviderDiagnosticMetadata {
  return {
    sceneId: validSceneId(input.sceneId) ? input.sceneId : 0,
    phase,
    provider: "openai",
    ...metadata,
  };
}

function usage(value: ProviderPayload["usage"]) {
  return {
    ...(safeCount(value?.prompt_tokens) !== undefined
      ? { promptTokens: safeCount(value?.prompt_tokens) }
      : {}),
    ...(safeCount(value?.completion_tokens) !== undefined
      ? { completionTokens: safeCount(value?.completion_tokens) }
      : {}),
    ...(safeCount(value?.total_tokens) !== undefined
      ? { totalTokens: safeCount(value?.total_tokens) }
      : {}),
  };
}

function normalizeFinishReason(value: string | null | undefined): AnimationFinishReason {
  if (value === "stop" || value === "length") return value;
  if (value === "content_filter") return "content-filter";
  if (value === "tool_calls" || value === "function_call") return "tool-calls";
  return "unknown";
}

function safeCount(value: number | undefined) {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value : undefined;
}

function validSceneId(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
  controller: AbortController,
): Promise<BoundedProviderResponse> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    controller.abort();
    await cancelBody(response.body);
    throw new ResponseValidationError(
      "ANIMATION_RESPONSE_TOO_LARGE",
      "RESPONSE_BYTE_LIMIT_EXCEEDED",
      /^\d+$/.test(length) ? Number(length) : undefined,
    );
  }
  if (!response.body) {
    throw new ResponseValidationError("ANIMATION_RESPONSE_EMPTY", "RESPONSE_BODY_EMPTY", 0);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await readWithAbort(reader, controller.signal);
      if (done) break;
      total += value.byteLength;
      if (!Number.isSafeInteger(total) || total > maximumBytes) {
        controller.abort();
        await reader.cancel();
        throw new ResponseValidationError(
          "ANIMATION_RESPONSE_TOO_LARGE",
          "RESPONSE_BYTE_LIMIT_EXCEEDED",
          total,
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    controller.abort();
    try { await reader.cancel(); } catch { /* Preserve normalized failure. */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (total <= 0) {
    throw new ResponseValidationError("ANIMATION_RESPONSE_EMPTY", "RESPONSE_BODY_EMPTY", 0);
  }
  try {
    return {
      payload: JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8")),
      responseLength: total,
    };
  } catch {
    throw new ResponseValidationError(
      "ANIMATION_RESPONSE_INVALID_JSON",
      "PROVIDER_ENVELOPE_INVALID_JSON",
      total,
    );
  }
}

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
) {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function fetchWithAbort(request: Promise<Response>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("Aborted", "AbortError"));
      void request.then((response) => cancelBody(response.body), () => undefined);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    request.then(
      (response) => signal.aborted ? void cancelBody(response.body).then(() => reject(new DOMException("Aborted", "AbortError"))) : resolve(response),
      reject,
    ).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function cancelBody(body: ReadableStream<Uint8Array> | null) {
  try { await body?.cancel(); } catch { /* Preserve normalized failure. */ }
}

function isAbort(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

class ResponseValidationError extends Error {
  constructor(
    readonly code: Extract<AnimationMotionPlanErrorCode,
      | "ANIMATION_RESPONSE_EMPTY"
      | "ANIMATION_RESPONSE_INVALID_JSON"
      | "ANIMATION_RESPONSE_TOO_LARGE">,
    readonly reason: string,
    readonly responseLength?: number,
  ) {
    super("Animation provider response validation failed.");
    this.name = "ResponseValidationError";
    this.stack = undefined;
  }
}
