import { createHash } from "node:crypto";
import {
  animationMotionTypes,
  animationTransitionTypes,
  type AnimationMotionFrame,
} from "@/types/animation";
import {
  isValidAnimationDuration,
  isValidAnimationMotionFrame,
} from "../AnimationMotionPlanValidation";
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
    let model: string | undefined;
    try {
      validateInput(input);
      const config = this.loadConfig();
      model = config.model;
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) return failure(input, model, "ANIMATION_PROVIDER_REQUEST_FAILED");
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
          return result.success
            ? success(input, config.model, identity.requestIdentity, result.plan)
            : failure(input, config.model, result.code);
        }
      }
    } catch {
      // Normalize all configuration, transport and validation details.
    }
    return failure(input, model, "ANIMATION_PROVIDER_REQUEST_FAILED");
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
          code: "ANIMATION_PROVIDER_REQUEST_FAILED",
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        };
      }
      const payload = await readBoundedJson(response, config.maximumResponseBytes, controller);
      if (controller.signal.aborted) {
        return { success: false, code: "ANIMATION_PROVIDER_TIMEOUT", retryable: true };
      }
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        return invalid();
      }
      let plan: unknown;
      try {
        plan = JSON.parse(content);
      } catch {
        return invalid();
      }
      if (!safeJsonTree(plan, 4)) return invalid();
      return validPlan(plan, input)
        ? { success: true, plan }
        : invalid();
    } catch (error) {
      if (error instanceof ResponseInvalidError) return invalid();
      return controller.signal.aborted || isAbort(error)
        ? { success: false, code: "ANIMATION_PROVIDER_TIMEOUT", retryable: true }
        : { success: false, code: "ANIMATION_PROVIDER_REQUEST_FAILED", retryable: true };
    } finally {
      clearTimeout(timeout);
    }
  }
}

type MotionPlan = {
  sceneId: number;
  sourceImageAssetId: string;
  durationSeconds: number;
  motionType: (typeof animationMotionTypes)[number];
  start: AnimationMotionFrame;
  end: AnimationMotionFrame;
  transition: (typeof animationTransitionTypes)[number];
};

type RequestResult =
  | { success: true; plan: MotionPlan }
  | { success: false; code: FailureCode; retryable: boolean };

function deterministicRequest(input: AnimationGenerationInput, model: string) {
  const body = JSON.stringify({
    model,
    messages: [
      {
        role: "system",
        content: "Return only a JSON motion plan using allowed motion and transition values. Preserve all input identity and duration fields exactly.",
      },
      {
        role: "user",
        content: JSON.stringify({
          sceneId: input.sceneId,
          sourceImageAssetId: input.sourceImageAssetId,
          animationPrompt: input.animationPrompt.trim(),
          durationSeconds: input.durationSeconds,
          allowedMotionTypes: animationMotionTypes,
          allowedTransitionTypes: animationTransitionTypes,
        }),
      },
    ],
    response_format: { type: "json_object" },
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

function validPlan(value: unknown, input: AnimationGenerationInput): value is MotionPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as MotionPlan & Record<string, unknown>;
  return exactObject(plan, ["sceneId", "sourceImageAssetId", "durationSeconds", "motionType", "start", "end", "transition"]) &&
    plan.sceneId === input.sceneId &&
    plan.sourceImageAssetId === input.sourceImageAssetId &&
    plan.durationSeconds === input.durationSeconds &&
    animationMotionTypes.includes(plan.motionType) &&
    animationTransitionTypes.includes(plan.transition) && exactFrame(plan.start) && exactFrame(plan.end) &&
    isValidAnimationMotionFrame(plan.start) &&
    isValidAnimationMotionFrame(plan.end);
}

function exactFrame(value: unknown): value is AnimationMotionFrame {
  if (!exactObject(value, ["crop", "transform"])) return false;
  const frame = value as AnimationMotionFrame;
  return exactObject(frame.crop, ["x", "y", "width", "height"]) &&
    exactObject(frame.transform, ["scale", "translateX", "translateY"]);
}

function exactObject(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function safeJsonTree(value: unknown, maximumDepth: number) {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > maximumDepth) return false;
    if (!current.value || typeof current.value !== "object") continue;
    if (Object.getPrototypeOf(current.value) !== Object.prototype && !Array.isArray(current.value)) return false;
    for (const [key, nested] of Object.entries(current.value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") return false;
      if (nested && typeof nested === "object") stack.push({ value: nested, depth: current.depth + 1 });
    }
  }
  return true;
}

function success(
  input: AnimationGenerationInput,
  model: string,
  requestIdentity: string,
  plan: MotionPlan,
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
  };
}

function failure(
  input: AnimationGenerationInput,
  model: string | undefined,
  error: FailureCode,
): AnimationGenerationResult {
  return {
    success: false,
    sceneId: input.sceneId,
    sourceImageAssetId: input.sourceImageAssetId,
    provider: "openai",
    model,
    generationMode: "production",
    error,
  };
}

function invalid(): RequestResult {
  return { success: false, code: "ANIMATION_PROVIDER_RESPONSE_INVALID", retryable: false };
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
  controller: AbortController,
): Promise<{ choices?: Array<{ message?: { content?: string } }> }> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    controller.abort();
    await cancelBody(response.body);
    throw new ResponseInvalidError();
  }
  if (!response.body) throw new ResponseInvalidError();
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
        throw new ResponseInvalidError();
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
  if (total <= 0) throw new ResponseInvalidError();
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8"));
  } catch {
    throw new ResponseInvalidError();
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

class ResponseInvalidError extends Error {}
