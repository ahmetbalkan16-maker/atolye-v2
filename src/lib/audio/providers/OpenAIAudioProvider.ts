import { AudioStorage } from "@/lib/assets/storage/AudioStorage";
import {
  AudioAssetRootError,
  createAudioAssetErrorEvidence,
  getAudioAssetErrorEvidence,
} from "@/lib/audio/AudioAssetError";
import type { AudioGenerationResult } from "@/types/audio";
import type {
  AudioGenerationInput,
  AudioProvider,
} from "./AudioProvider";
import {
  AudioProviderConfigurationError,
  getOpenAIAudioProviderConfig,
} from "./AudioProviderConfig";

const SAFE_PROVIDER_ERROR = "Audio generation failed.";
const ACCEPTED_WAV_CONTENT_TYPES = new Set([
  "audio/wav",
  "application/octet-stream",
]);

export class OpenAIAudioProvider implements AudioProvider {
  readonly name = "openai";

  validateInput(input: AudioGenerationInput): void {
    const config = getOpenAIAudioProviderConfig();
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (
      !apiKey ||
      !input.sourceText.trim() ||
      input.sourceText.length > config.maxInputCharacters ||
      !/^[a-zA-Z0-9-_]+$/.test(input.projectSlug)
    ) {
      throw new AudioProviderConfigurationError();
    }
  }

  async generateAudio(
    input: AudioGenerationInput,
  ): Promise<AudioGenerationResult> {
    const createdAt = new Date().toISOString();
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let model: string | undefined;
    let maximumResponseBytes: number | undefined;
    let timedOut = false;

    try {
      this.validateInput(input);
      const config = getOpenAIAudioProviderConfig();
      const apiKey = process.env.OPENAI_API_KEY?.trim() as string;
      model = config.model;
      maximumResponseBytes = config.maxResponseBytes;
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.timeoutMs);

      let response: Response;
      try {
        response = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            voice: config.voice,
            input: input.sourceText,
            response_format: config.responseFormat,
          }),
          signal: controller.signal,
        });
      } catch {
        throw new AudioAssetRootError(
          timedOut
            ? "AUDIO_PROVIDER_TIMEOUT"
            : "AUDIO_PROVIDER_REQUEST_FAILED",
          {
            phase: "request",
            target: input.target,
            provider: "openai",
            model,
            maximumResponseBytes,
          },
        );
      }

      if (!response.ok) {
        await cancelBody(response.body);
        throw new AudioAssetRootError("AUDIO_PROVIDER_REQUEST_FAILED", {
          phase: "response",
          target: input.target,
          provider: "openai",
          model,
          httpStatus: response.status,
          maximumResponseBytes,
        });
      }

      if (!hasSafeContentType(response.headers.get("content-type"))) {
        await cancelBody(response.body);
        throw new AudioAssetRootError(
          "AUDIO_PROVIDER_CONTENT_TYPE_INVALID",
          {
            phase: "response",
            target: input.target,
            provider: "openai",
            model,
            httpStatus: response.status,
            maximumResponseBytes,
          },
        );
      }

      const body = await readBoundedBody(
        response,
        config.maxResponseBytes,
        controller,
        input,
        model,
      );
      try {
        AudioStorage.inspectWav(body);
      } catch {
        throw new AudioAssetRootError("AUDIO_WAV_INVALID", {
          phase: "validation",
          target: input.target,
          provider: "openai",
          model,
          responseBytes: body.length,
          maximumResponseBytes,
        });
      }
      let saved;
      try {
        saved = AudioStorage.saveAudio({
          projectSlug: input.projectSlug,
          data: body,
        });
      } catch (error) {
        throw error instanceof AudioAssetRootError
          ? error
          : new AudioAssetRootError("AUDIO_STORAGE_WRITE_FAILED", {
              phase: "storage",
              target: input.target,
              provider: "openai",
              model,
              responseBytes: body.length,
              maximumResponseBytes,
            });
      }

      return AudioStorage.transferPublicationOwnership(saved, {
        success: true,
        target: input.target,
        provider: "openai",
        model: config.model,
        filePath: saved.filePath,
        url: saved.url,
        mimeType: config.mimeType,
        byteLength: saved.byteLength,
        durationSeconds: saved.durationSeconds,
        createdAt,
      });
    } catch (error) {
      if (timedOut && !getAudioAssetErrorEvidence(error)) {
        return createFailure(
          input,
          createdAt,
          new AudioAssetRootError("AUDIO_PROVIDER_TIMEOUT", {
            phase: "request",
            target: input.target,
            provider: "openai",
            model,
            maximumResponseBytes,
          }),
          model,
        );
      }
      if (error instanceof AudioProviderConfigurationError) {
        return createFailure(
          input,
          createdAt,
          new AudioAssetRootError(
            "AUDIO_PROVIDER_CONFIGURATION_INVALID",
            {
              phase: "configuration",
              target: input.target,
              provider: "openai",
              model,
              maximumResponseBytes,
            },
          ),
          model,
        );
      }
      return createFailure(input, createdAt, error, model);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
  controller: AbortController,
  input: AudioGenerationInput,
  model: string,
): Promise<Buffer> {
  const metadata = {
    phase: "response" as const,
    target: input.target,
    provider: "openai" as const,
    model,
    maximumResponseBytes: maximumBytes,
  };
  let contentLength: number | null;
  try {
    contentLength = parseContentLength(response.headers.get("content-length"));
  } catch {
    controller.abort();
    await cancelBody(response.body);
    throw new AudioAssetRootError("AUDIO_PROVIDER_RESPONSE_INVALID", metadata);
  }

  if (contentLength !== null && contentLength > maximumBytes) {
    controller.abort();
    await cancelBody(response.body);
    throw new AudioAssetRootError("AUDIO_PROVIDER_RESPONSE_TOO_LARGE", {
      ...metadata,
      responseBytes: contentLength,
    });
  }

  if (!response.body) {
    controller.abort();
    throw new AudioAssetRootError("AUDIO_PROVIDER_RESPONSE_INVALID", metadata);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await readWithAbort(reader, controller.signal);

      if (done) {
        break;
      }

      if (!(value instanceof Uint8Array)) {
        throw new AudioAssetRootError(
          "AUDIO_PROVIDER_RESPONSE_INVALID",
          metadata,
        );
      }

      totalBytes += value.byteLength;

      if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumBytes) {
        controller.abort();
        throw new AudioAssetRootError(
          "AUDIO_PROVIDER_RESPONSE_TOO_LARGE",
          {
            ...metadata,
            responseBytes: totalBytes,
          },
        );
      }

      if (value.byteLength > 0) {
        chunks.push(value);
      }
    }

    if (
      totalBytes <= 0 ||
      (contentLength !== null && totalBytes !== contentLength)
    ) {
      throw new AudioAssetRootError("AUDIO_PROVIDER_RESPONSE_INVALID", {
        ...metadata,
        responseBytes: totalBytes,
      });
    }

    return Buffer.concat(chunks, totalBytes);
  } catch (error) {
    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // Preserve the normalized provider failure.
    }
    if (error instanceof AudioAssetRootError) throw error;
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
) {
  if (signal.aborted) {
    return Promise.reject(new Error(SAFE_PROVIDER_ERROR));
  }

  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const onAbort = () => reject(new Error(SAFE_PROVIDER_ERROR));
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function parseContentLength(value: string | null) {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  if (!/^[0-9]+$/.test(normalized)) {
    throw new Error(SAFE_PROVIDER_ERROR);
  }

  const parsed = Number(normalized);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(SAFE_PROVIDER_ERROR);
  }

  return parsed;
}

async function cancelBody(body: ReadableStream<Uint8Array> | null) {
  if (!body) {
    return;
  }

  try {
    await body.cancel();
  } catch {
    // Preserve the normalized provider failure.
  }
}

function hasSafeContentType(value: string | null) {
  if (!value) return false;

  const parts = value.split(";");
  const mediaType = parts.shift()?.trim().toLowerCase();
  if (!mediaType || !ACCEPTED_WAV_CONTENT_TYPES.has(mediaType)) return false;
  return parts.every((part) =>
    /^[a-zA-Z0-9!#$%&'*+.^_`|~-]+=(?:"[^"\r\n]*"|[a-zA-Z0-9!#$%&'*+.^_`|~-]+)$/.test(
      part.trim(),
    )
  );
}

function createFailure(
  input: AudioGenerationInput,
  createdAt: string,
  error: unknown,
  model?: string,
): AudioGenerationResult {
  const existing = getAudioAssetErrorEvidence(error);
  const evidence = createAudioAssetErrorEvidence(
    existing?.rootCode ?? "AUDIO_PROVIDER_RESPONSE_INVALID",
    {
      phase: existing?.phase ?? "response",
      target: input.target,
      provider: existing?.provider ?? "openai",
      model: existing?.model ?? model,
      httpStatus: existing?.httpStatus,
      responseBytes: existing?.responseBytes,
      maximumResponseBytes: existing?.maximumResponseBytes,
      compensation: existing?.compensation,
      compensationRef: existing?.compensationRef,
      cleanup: existing?.cleanup,
    },
  );
  const failure: AudioGenerationResult = {
    success: false,
    target: input.target,
    provider: "openai",
    model,
    createdAt,
    error: SAFE_PROVIDER_ERROR,
    evidence,
  };
  return AudioStorage.transferPublicationOwnership(error, failure);
}
