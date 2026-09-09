/**
 * AYAS STT configuration (Voice Closure Sprint).
 *
 * Resolves the local whisper.cpp sidecar + ffmpeg decoder from env. STT is
 * OFF by default: with no `AYAS_WHISPER_EXECUTABLE` / `AYAS_WHISPER_MODEL` the
 * route answers `503 stt-not-configured` and nothing spawns.
 *
 * Every path here comes from the environment (operator-controlled), NEVER from
 * a request. `POST /api/ayas/stt` passes a request-supplied audio blob to a
 * temp file and these fixed executables — it never puts request bytes on an
 * argv, never runs a shell, never resolves an executable name from the body.
 *
 *   AYAS_WHISPER_EXECUTABLE   abs path to whisper-cli.exe (bin/whisper/…)
 *   AYAS_WHISPER_MODEL        abs path to a ggml-*.bin model (large-v3-turbo)
 *   AYAS_WHISPER_LANGUAGE     forced language (default "tr")
 *   AYAS_WHISPER_THREADS      -t (default 4)
 *   AYAS_FFMPEG_PATH          abs path to ffmpeg (else "ffmpeg" on PATH)
 *   AYAS_STT_MAX_AUDIO_BYTES  request cap (default 4_000_000)
 *   AYAS_STT_MAX_SECONDS      decoded-audio duration cap (default 20)
 *   AYAS_STT_TIMEOUT_MS       whole-pipeline timeout (default 30_000)
 */

import fs from "node:fs";
import path from "node:path";

/*
 * NOTE on Windows + non-ASCII paths: Node's `execFile` hands argv to the child
 * as the ANSI code page, so a path under `…\Atölye\…` reaches whisper.cpp
 * mangled. `AyasSttService` handles this at spawn time (runs whisper from its
 * own dir, passes ASCII cwd-relative arg paths); config just stores the real
 * absolute paths.
 */

export const AYAS_STT_DEFAULTS = Object.freeze({
  language: "tr",
  threads: 4,
  maxAudioBytes: 4_000_000,
  maxSeconds: 20,
  timeoutMs: 30_000,
});

export interface AyasSttConfig {
  readonly enabled: boolean;
  /** Present only when `enabled`. */
  readonly whisperExecutable?: string;
  readonly whisperModel?: string;
  readonly ffmpegPath: string;
  readonly language: string;
  readonly threads: number;
  readonly maxAudioBytes: number;
  readonly maxSeconds: number;
  readonly timeoutMs: number;
  /** Why STT is disabled, when `enabled` is false. */
  readonly reason?: string;
}

type Env = Readonly<Record<string, string | undefined>>;

function intEnv(raw: string | undefined, fallback: number, lo: number, hi: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw.trim());
  return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
}

/** Absolute path that exists and is a regular file. */
function resolveExistingFile(raw: string | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const p = path.resolve(raw.trim());
  try {
    return fs.statSync(p).isFile() ? p : null;
  } catch {
    return null;
  }
}

export function resolveAyasSttConfig(env: Env = process.env): AyasSttConfig {
  const ffmpegPath = resolveExistingFile(env.AYAS_FFMPEG_PATH) ?? env.AYAS_FFMPEG_PATH?.trim() ?? "ffmpeg";
  const language = env.AYAS_WHISPER_LANGUAGE?.trim() || AYAS_STT_DEFAULTS.language;
  const threads = intEnv(env.AYAS_WHISPER_THREADS, AYAS_STT_DEFAULTS.threads, 1, 32);
  const maxAudioBytes = intEnv(env.AYAS_STT_MAX_AUDIO_BYTES, AYAS_STT_DEFAULTS.maxAudioBytes, 4_096, 32_000_000);
  const maxSeconds = intEnv(env.AYAS_STT_MAX_SECONDS, AYAS_STT_DEFAULTS.maxSeconds, 2, 120);
  const timeoutMs = intEnv(env.AYAS_STT_TIMEOUT_MS, AYAS_STT_DEFAULTS.timeoutMs, 2_000, 300_000);

  const base = { ffmpegPath, language, threads, maxAudioBytes, maxSeconds, timeoutMs };

  const rawExe = env.AYAS_WHISPER_EXECUTABLE?.trim();
  const rawModel = env.AYAS_WHISPER_MODEL?.trim();
  if (!rawExe && !rawModel) {
    return { ...base, enabled: false, reason: "AYAS_WHISPER_EXECUTABLE / AYAS_WHISPER_MODEL not set" };
  }

  const whisperExecutable = resolveExistingFile(rawExe);
  const whisperModel = resolveExistingFile(rawModel);
  if (!whisperExecutable) {
    return { ...base, enabled: false, reason: `whisper executable not found: ${rawExe ?? "(unset)"}` };
  }
  if (!whisperModel) {
    return { ...base, enabled: false, reason: `whisper model not found: ${rawModel ?? "(unset)"}` };
  }
  return { ...base, enabled: true, whisperExecutable, whisperModel };
}
