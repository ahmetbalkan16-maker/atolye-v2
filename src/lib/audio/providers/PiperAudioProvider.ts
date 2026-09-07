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

const ESPEAK_DATA_SENTINEL = "phontab";
const ASCII_STAGE_DIRNAME = "atolye-piper";

/** `true` when every character is printable ASCII (space … tilde). */
function isAsciiPath(value: string): boolean {
  return !/[^ -~]/.test(value);
}

function fileExists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

/**
 * A path to `absolutePath` that this piper build can actually open.
 *
 * piper corrupts non-ASCII characters that appear literally in an argv path
 * (a non-ASCII voice-model path crashes it with 0xC0000409; non-ASCII espeak-ng
 * data throws "Illegal byte sequence"). It resolves a *relative* argument
 * against its own cwd correctly, though. So for a path that sits under a
 * directory with a non-ASCII name (e.g. a checkout under `.../Atölye/...`):
 *   1. already ASCII            → unchanged
 *   2. ASCII once made relative → the cwd-relative form (no copy)
 *   3. otherwise                → `stage()` copies it somewhere ASCII
 * Returns `undefined` only when nothing usable could be produced.
 */
function asciiPiperPath(
  absolutePath: string,
  stage: (source: string) => string | undefined,
): string | undefined {
  if (isAsciiPath(absolutePath)) return absolutePath;
  const relative = path.relative(process.cwd(), absolutePath);
  if (
    relative &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative) &&
    isAsciiPath(relative)
  ) {
    return relative;
  }
  return stage(absolutePath);
}

/**
 * Materialise `target` once via `copy` (skipped when `readyMarker` already
 * exists), then return `target` when it is on an ASCII path. `copy` must build
 * `target` atomically — write elsewhere and rename last — so a killed process
 * never leaves a half-copy that the sentinel check would then trust.
 */
function stageOnce(
  target: string,
  readyMarker: string,
  copy: () => void,
): string | undefined {
  try {
    if (!fileExists(readyMarker)) copy();
    return isAsciiPath(path.resolve(target)) ? target : undefined;
  } catch {
    return undefined;
  }
}

/** Stage the espeak-ng data directory (~18 MB) into an ASCII temp location. */
function stageEspeakData(source: string): string | undefined {
  if (!fileExists(path.join(source, ESPEAK_DATA_SENTINEL))) return undefined;
  const target = path.join(os.tmpdir(), ASCII_STAGE_DIRNAME, "espeak-ng-data");
  return stageOnce(target, path.join(target, ESPEAK_DATA_SENTINEL), () => {
    const staging = `${target}.staging-${process.pid}`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.cpSync(source, staging, { recursive: true });
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
  });
}

/** Stage the voice model + its `.json` sidecar into an ASCII temp location. */
function stageVoiceModel(source: string): string | undefined {
  if (!fileExists(source)) return undefined;
  const target = path.join(
    os.tmpdir(), ASCII_STAGE_DIRNAME, "voice", path.basename(source),
  );
  return stageOnce(target, target, () => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fileExists(`${source}.json`)) fs.copyFileSync(`${source}.json`, `${target}.json`);
    const staging = `${target}.staging-${process.pid}`;
    fs.copyFileSync(source, staging);
    fs.renameSync(staging, target);
  });
}

/**
 * The espeak-ng data directory to hand piper, or `undefined` to leave piper's
 * own zero-arg discovery in place (byte-identical to the legacy call).
 */
export function resolveSpawnableEspeakDataDir(
  configuredDir: string | undefined,
): string | undefined {
  if (!configuredDir) return undefined;
  const resolved = asciiPiperPath(path.resolve(configuredDir), stageEspeakData);
  if (!resolved) return undefined;
  return fileExists(path.join(resolved, ESPEAK_DATA_SENTINEL)) ? resolved : undefined;
}

/** The voice-model path to hand piper — ASCII-safe (see {@link asciiPiperPath}). */
export function resolveSpawnableVoiceModelPath(voiceModelPath: string): string {
  return (
    asciiPiperPath(path.resolve(voiceModelPath), stageVoiceModel) ?? voiceModelPath
  );
}

function synthesize(
  config: PiperAudioProviderConfig,
  text: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const modelArg = resolveSpawnableVoiceModelPath(config.voiceModelPath);
    const espeakDataDir = resolveSpawnableEspeakDataDir(config.espeakDataDir);
    const args = [
      "--model", modelArg,
      "--output_file", outputPath,
      ...(espeakDataDir ? ["--espeak_data", espeakDataDir] : []),
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
