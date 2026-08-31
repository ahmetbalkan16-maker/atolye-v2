import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AudioStorage } from "@/lib/assets/storage/AudioStorage";
import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import {
  AudioAssetRootError,
  createAudioAssetErrorEvidence,
  getAudioAssetErrorEvidence,
} from "@/lib/audio/AudioAssetError";
import type { AudioGenerationResult } from "@/types/audio";
import type { AudioGenerationInput, ConfiguredAudioProvider } from "./AudioProvider";
import {
  AudioProviderConfigurationError,
  getPiperAudioProviderConfig,
  type PiperAudioProviderConfig,
} from "./AudioProviderConfig";

const SAFE_PROVIDER_ERROR = "Audio generation failed.";

/**
 * Local, $0 TTS via a bundled `piper` binary (CPU, ONNX). Produces a 16-bit PCM
 * WAV — the same shape `OpenAIAudioProvider` returns — so `AudioStorage` and
 * every downstream stage are unchanged. Opt-in via `AUDIO_PROVIDER=piper`.
 */
export class PiperAudioProvider implements ConfiguredAudioProvider {
  readonly name = "piper";

  constructor(
    private readonly loadConfig: (env?: NodeJS.ProcessEnv) => PiperAudioProviderConfig =
      getPiperAudioProviderConfig,
  ) {}

  createImmutableAudioDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name }, requiredMethods: ["validateInput", "generateAudio"],
    });
  }

  validateInput(input: AudioGenerationInput): void {
    const config = this.loadConfig();
    if (
      !input.sourceText.trim() ||
      input.sourceText.length > config.maxInputCharacters ||
      !/^[a-zA-Z0-9-_]+$/.test(input.projectSlug)
    ) {
      throw new AudioProviderConfigurationError();
    }
    if (!fs.existsSync(config.executablePath)) {
      throw new AudioProviderConfigurationError();
    }
    if (!fs.existsSync(config.voiceModelPath)) {
      throw new AudioProviderConfigurationError();
    }
  }

  async generateAudio(input: AudioGenerationInput): Promise<AudioGenerationResult> {
    const createdAt = new Date().toISOString();
    const model = path.basename(this.safeConfig()?.voiceModelPath ?? "piper");
    let workdir: string | undefined;
    try {
      this.validateInput(input);
      const config = this.loadConfig();
      workdir = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-piper-"));
      const outputPath = path.join(workdir, "narration.wav");

      await synthesize(config, input.sourceText, outputPath);

      const body = fs.readFileSync(outputPath);
      try {
        AudioStorage.inspectWav(body);
      } catch {
        throw new AudioAssetRootError("AUDIO_WAV_INVALID", {
          phase: "validation",
          target: input.target,
          provider: "piper",
          model,
          responseBytes: body.length,
        });
      }

      let saved;
      try {
        saved = AudioStorage.prepareAudio({ projectSlug: input.projectSlug, data: body });
      } catch (error) {
        throw error instanceof AudioAssetRootError
          ? error
          : new AudioAssetRootError("AUDIO_STORAGE_WRITE_FAILED", {
              phase: "storage",
              target: input.target,
              provider: "piper",
              model,
              responseBytes: body.length,
            });
      }

      return AudioStorage.transferPublicationOwnership(saved, {
        success: true,
        target: input.target,
        provider: "piper",
        model,
        filePath: saved.filePath,
        url: saved.url,
        mimeType: "audio/wav",
        byteLength: saved.byteLength,
        durationSeconds: saved.durationSeconds,
        createdAt,
      });
    } catch (error) {
      if (error instanceof AudioProviderConfigurationError) {
        return createFailure(
          input,
          createdAt,
          new AudioAssetRootError("AUDIO_PROVIDER_CONFIGURATION_INVALID", {
            phase: "configuration",
            target: input.target,
            provider: "piper",
            model,
          }),
          model,
        );
      }
      return createFailure(input, createdAt, error, model);
    } finally {
      if (workdir) {
        try { fs.rmSync(workdir, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    }
  }

  private safeConfig(): PiperAudioProviderConfig | undefined {
    try {
      return this.loadConfig();
    } catch {
      return undefined;
    }
  }
}

function synthesize(
  config: PiperAudioProviderConfig,
  text: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "--model", config.voiceModelPath,
      "--output_file", outputPath,
      ...(config.speaker !== undefined ? ["--speaker", String(config.speaker)] : []),
    ];
    const child = spawn(config.executablePath, args, {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new AudioAssetRootError("AUDIO_PROVIDER_TIMEOUT", {
          phase: "request",
          provider: "piper",
        }),
      );
    }, config.timeoutMs);

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4_096) stderr += chunk.toString("utf8");
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new AudioAssetRootError("AUDIO_PROVIDER_REQUEST_FAILED", {
          phase: "request",
          provider: "piper",
        }),
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 44) {
        resolve();
        return;
      }
      void stderr;
      reject(
        new AudioAssetRootError("AUDIO_PROVIDER_REQUEST_FAILED", {
          phase: "response",
          provider: "piper",
        }),
      );
    });

    child.stdin?.write(text);
    child.stdin?.end();
  });
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
      provider: "piper",
      model: existing?.model ?? model,
      responseBytes: existing?.responseBytes,
    },
  );
  const failure: AudioGenerationResult = {
    success: false,
    target: input.target,
    provider: "piper",
    model,
    createdAt,
    error: SAFE_PROVIDER_ERROR,
    evidence,
  };
  return AudioStorage.transferPublicationOwnership(error, failure);
}
