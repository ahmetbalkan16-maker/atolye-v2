import { AudioStorage } from "@/lib/assets/storage/AudioStorage";
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

    try {
      this.validateInput(input);
      const config = getOpenAIAudioProviderConfig();
      const apiKey = process.env.OPENAI_API_KEY?.trim() as string;
      model = config.model;
      timeout = setTimeout(() => controller.abort(), config.timeoutMs);

      const response = await fetch("https://api.openai.com/v1/audio/speech", {
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

      if (
        !response.ok ||
        !hasSafeContentType(response.headers.get("content-type"))
      ) {
        controller.abort();
        await cancelBody(response.body);
        return createFailure(input, createdAt, model);
      }

      const body = await readBoundedBody(
        response,
        config.maxResponseBytes,
        controller,
      );
      const saved = AudioStorage.saveAudio({
        projectSlug: input.projectSlug,
        data: body,
      });

      return {
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
      };
    } catch {
      return createFailure(input, createdAt, model);
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
): Promise<Buffer> {
  const contentLength = parseContentLength(
    response.headers.get("content-length"),
  );

  if (contentLength !== null && contentLength > maximumBytes) {
    controller.abort();
    await cancelBody(response.body);
    throw new Error(SAFE_PROVIDER_ERROR);
  }

  if (!response.body) {
    controller.abort();
    throw new Error(SAFE_PROVIDER_ERROR);
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
        throw new Error(SAFE_PROVIDER_ERROR);
      }

      totalBytes += value.byteLength;

      if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumBytes) {
        controller.abort();
        throw new Error(SAFE_PROVIDER_ERROR);
      }

      if (value.byteLength > 0) {
        chunks.push(value);
      }
    }

    if (
      totalBytes <= 0 ||
      (contentLength !== null && totalBytes !== contentLength)
    ) {
      throw new Error(SAFE_PROVIDER_ERROR);
    }

    return Buffer.concat(chunks, totalBytes);
  } catch {
    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // Preserve the normalized provider failure.
    }
    throw new Error(SAFE_PROVIDER_ERROR);
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
  if (!value) {
    return true;
  }

  return ACCEPTED_WAV_CONTENT_TYPES.has(
    value.split(";", 1)[0].trim().toLowerCase(),
  );
}

function createFailure(
  input: AudioGenerationInput,
  createdAt: string,
  model?: string,
): AudioGenerationResult {
  return {
    success: false,
    target: input.target,
    provider: "openai",
    model,
    createdAt,
    error: SAFE_PROVIDER_ERROR,
  };
}
