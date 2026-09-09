/**
 * AYAS STT service (Voice Closure Sprint).
 *
 * audio bytes → ffmpeg decode to 16 kHz mono s16 WAV → whisper.cpp CLI (`-oj`)
 * → `{ text, language, ... }`. Read-only w.r.t. the studio: it produces text and
 * nothing else — the transcript then flows through the EXISTING AYAS chat path,
 * which already refuses to open the gate / run a pipeline. The execution gate is
 * never touched here.
 *
 * Safety:
 *  - executables (whisper, ffmpeg) come only from {@link AyasSttConfig} (env),
 *    never from the request; `execFile`, never a shell; argv is a fixed template
 *    with only temp-file paths interpolated;
 *  - the request audio lands in an `os.tmpdir()` mkdtemp dir, deleted in `finally`;
 *  - a hard timeout kills the whole pipeline; a binary crash is caught and
 *    surfaced, never propagated as an unhandled rejection;
 *  - an optional thermal guard refuses to spawn when the GPU hard-stop is tripped.
 */

import { execFile } from "node:child_process";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveAyasSttConfig, type AyasSttConfig } from "./AyasSttConfig";
import { sniffAudioContainer } from "./AyasSttAudio";

export type AyasSttFailureCode =
  | "stt-not-configured"
  | "audio-too-large"
  | "audio-unsupported"
  | "audio-empty"
  | "audio-too-long"
  | "decode-failed"
  | "transcribe-failed"
  | "transcribe-timeout"
  | "thermal-hold"
  | "stt-path-encoding"
  | "empty-transcript";

export type AyasSttResult =
  | {
      readonly ok: true;
      readonly text: string;
      readonly language: string;
      readonly audioSeconds: number;
      readonly processingMs: number;
      readonly realTimeFactor: number;
    }
  | { readonly ok: false; readonly code: AyasSttFailureCode; readonly detail?: string };

interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

const ASCII_ONLY = /^[\x20-\x7e]*$/;

/**
 * Node's Windows `execFile` hands argv to the child as the ANSI code page, so a
 * non-ASCII path in argv (this repo is under `…\Atölye\…`) reaches whisper.cpp
 * mangled. The executable path and `cwd` go through as UTF-16 and are fine — so
 * run the child from its own directory and pass every *argument* path either as
 * an already-ASCII absolute path or as an ASCII path relative to that cwd.
 * Returns `null` when neither form is ASCII (surfaced as `stt-path-encoding`).
 */
function asciiArgPath(absolute: string, cwd: string): string | null {
  if (ASCII_ONLY.test(absolute)) return absolute;
  const rel = path.relative(cwd, absolute);
  return rel && ASCII_ONLY.test(rel) && !rel.startsWith("..\\..\\..\\..") ? rel : null;
}

export interface AyasSttDeps {
  readonly config?: AyasSttConfig;
  /** Injectable process runner (tests). */
  readonly run?: (
    executable: string,
    args: readonly string[],
    timeoutMs: number,
    cwd?: string,
  ) => Promise<RunResult>;
  /** Injectable thermal guard — returns a reason string when transcription must be held. */
  readonly thermalHold?: () => Promise<string | null> | string | null;
  readonly now?: () => number;
}

function defaultRun(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  cwd?: string,
): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      executable,
      [...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, killSignal: "SIGKILL", ...(cwd ? { cwd } : {}) },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        resolve({
          code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          timedOut: Boolean(err?.killed) || /ETIMEDOUT/.test(String(err?.code ?? "")),
        });
      },
    );
  });
}

/**
 * Bias whisper toward the studio's proper nouns (the dfki TR voice says "AYAS"
 * as "ayaz"; whisper then transcribes the sound, not the name). Kept short —
 * a long initial prompt hurts more than it helps.
 */
// ASCII-only: Node's Windows execFile mangles non-ASCII argv (see AyasSttConfig).
const AYAS_STT_PROMPT =
  "AYAS, Atolye, Graphify, pipeline, runtime, render, proje, asama, visuals, script.";

/**
 * Normalise the few predictable mis-hears back to studio terms. The dfki TR
 * voice says "AYAS" as "ayaz", and whisper renders the English loanword
 * "runtime" as "Grundtime" (not a Turkish word). Both are deterministic.
 */
export function normaliseAyasTranscript(text: string): string {
  return text
    .replace(/\b[Aa]ya[zsş]\b/g, "AYAS")
    .replace(/\b[Aa]yas\b/g, "AYAS")
    .replace(/\bhayas\b/gi, "AYAS")
    .replace(/\bgrundtime\b/gi, "runtime")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse whisper.cpp `-oj` JSON (written next to `-of <base>` as `<base>.json`). */
function parseWhisperJson(raw: string): { text: string; language: string } | null {
  try {
    const doc = JSON.parse(raw) as {
      transcription?: { text?: string }[];
      result?: { language?: string };
    };
    const text = (doc.transcription ?? [])
      .map((seg) => (typeof seg.text === "string" ? seg.text : ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    return { text, language: doc.result?.language ?? "" };
  } catch {
    return null;
  }
}

export async function transcribeAyasAudio(
  audio: Uint8Array,
  deps: AyasSttDeps = {},
): Promise<AyasSttResult> {
  const config = deps.config ?? resolveAyasSttConfig();
  const run = deps.run ?? defaultRun;
  const now = deps.now ?? (() => Date.now());

  if (!config.enabled) return { ok: false, code: "stt-not-configured", detail: config.reason };
  if (audio.byteLength === 0) return { ok: false, code: "audio-empty" };
  if (audio.byteLength > config.maxAudioBytes) return { ok: false, code: "audio-too-large" };

  const container = sniffAudioContainer(audio);
  if (!container) return { ok: false, code: "audio-unsupported" };

  const hold = deps.thermalHold ? await deps.thermalHold() : null;
  if (hold) return { ok: false, code: "thermal-hold", detail: hold };

  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ayas-stt-"));
  const inPath = path.join(workDir, `in.${container.ext}`);
  const wavPath = path.join(workDir, "audio.wav");
  const outBase = path.join(workDir, "out");
  const started = now();

  try {
    await fsp.writeFile(inPath, audio);

    // 1 — decode to canonical 16 kHz mono s16 WAV, hard-capped in duration.
    const decode = await run(
      config.ffmpegPath,
      ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", inPath, "-t", String(config.maxSeconds), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath],
      Math.min(config.timeoutMs, 15_000),
    );
    if (decode.timedOut) return { ok: false, code: "decode-failed", detail: "ffmpeg timeout" };
    if (decode.code !== 0) return { ok: false, code: "decode-failed", detail: decode.stderr.slice(0, 400) };

    const wavStat = await fsp.stat(wavPath).catch(() => null);
    if (!wavStat || wavStat.size <= 44) return { ok: false, code: "decode-failed", detail: "empty wav" };
    const audioSeconds = Math.max(0, (wavStat.size - 44) / (16000 * 2));
    if (audioSeconds < 0.15) return { ok: false, code: "audio-empty" };
    if (audioSeconds > config.maxSeconds + 1) return { ok: false, code: "audio-too-long" };

    // 2 — transcribe. Run whisper from its own dir so no non-ASCII path lands
    // on argv (Node's Windows execFile would mangle it); pass every path arg as
    // an ASCII absolute (temp dir) or ASCII cwd-relative form.
    const whisperCwd = path.dirname(config.whisperExecutable as string);
    const modelArg = asciiArgPath(config.whisperModel as string, whisperCwd);
    const fileArg = asciiArgPath(wavPath, whisperCwd);
    const ofArg = asciiArgPath(outBase, whisperCwd);
    if (!modelArg || !fileArg || !ofArg) {
      return { ok: false, code: "stt-path-encoding", detail: "whisper model / temp path is not ASCII-safe" };
    }
    const elapsedForWhisper = config.timeoutMs - (now() - started);
    if (elapsedForWhisper < 1_000) return { ok: false, code: "transcribe-timeout", detail: "no time budget left" };
    const whisper = await run(
      config.whisperExecutable as string,
      [
        "-m", modelArg,
        "-f", fileArg,
        "-l", config.language,
        "-t", String(config.threads),
        "--prompt", AYAS_STT_PROMPT,
        "-nt", "-oj", "-of", ofArg,
      ],
      elapsedForWhisper,
      whisperCwd,
    );
    if (whisper.timedOut) return { ok: false, code: "transcribe-timeout" };
    if (whisper.code !== 0) return { ok: false, code: "transcribe-failed", detail: whisper.stderr.slice(0, 400) };

    const jsonRaw = await fsp.readFile(`${outBase}.json`, "utf-8").catch(() => "");
    const parsed = jsonRaw ? parseWhisperJson(jsonRaw) : null;
    const text = normaliseAyasTranscript((parsed?.text ?? "").trim());
    if (!text) return { ok: false, code: "empty-transcript" };

    const processingMs = now() - started;
    return {
      ok: true,
      text,
      language: parsed?.language || config.language,
      audioSeconds: Math.round(audioSeconds * 100) / 100,
      processingMs,
      realTimeFactor: audioSeconds > 0 ? Math.round((processingMs / 1000 / audioSeconds) * 100) / 100 : 0,
    };
  } catch (error) {
    return { ok: false, code: "transcribe-failed", detail: (error as Error).message.slice(0, 200) };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
