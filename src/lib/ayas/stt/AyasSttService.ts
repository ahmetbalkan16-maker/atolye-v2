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
      /**
       * Whisper's own per-token probability, collapsed to the weakest and the
       * mean token in the utterance (0..1, `null` when the build emits no token
       * probs). A low `minTokenP` means whisper itself is unsure — the caller can
       * distinguish "AYAS mis-heard the words" from "AYAS heard the words but the
       * model misunderstood". Never gates the transcript; observability only.
       */
      readonly confidence: { readonly minTokenP: number; readonly meanTokenP: number } | null;
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
 * as "ayaz"; whisper then transcribes the sound, not the name). Kept to the
 * three names only: on a short command clip a longer initial prompt measurably
 * pulls the decode toward its own vocabulary — Sprint 5 §7 forensic showed the
 * long list added nothing on clean audio and risks priming on noisy audio.
 */
// ASCII-only: Node's Windows execFile mangles non-ASCII argv (see AyasSttConfig).
const AYAS_STT_PROMPT = "AYAS, Atolye, Graphify.";

/**
 * Normalise the few predictable mis-hears back to studio terms. The dfki TR
 * voice says "AYAS" as "ayaz", and whisper renders the English loanword
 * "runtime" as "Grundtime" (not a Turkish word). Both are deterministic.
 */
export function normaliseAyasTranscript(text: string): string {
  return text
    .replace(/\b(?:aya[zsş]|ayes|aias|hayas)\b/gi, "AYAS")
    .replace(/\bgrundtime\b/gi, "runtime")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse whisper.cpp `-ojf` (full) JSON (written next to `-of <base>` as
 * `<base>.json`). `-ojf` adds `tokens[].p` (per-token probability) on top of the
 * plain `-oj` shape, so this stays backward-compatible with a plain `-oj` file
 * (confidence just comes back `null`).
 */
function parseWhisperJson(
  raw: string,
): { text: string; language: string; confidence: { minTokenP: number; meanTokenP: number } | null } | null {
  try {
    const doc = JSON.parse(raw) as {
      transcription?: { text?: string; tokens?: { text?: string; p?: number }[] }[];
      result?: { language?: string };
    };
    const segments = doc.transcription ?? [];
    const text = segments
      .map((seg) => (typeof seg.text === "string" ? seg.text : ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();

    // Per-token probabilities — skip whisper's punctuation-only / whitespace
    // tokens, they carry no acoustic signal and drag the mean around.
    const probs: number[] = [];
    for (const seg of segments) {
      for (const tok of seg.tokens ?? []) {
        if (typeof tok.p !== "number" || !Number.isFinite(tok.p)) continue;
        if (typeof tok.text === "string" && !/[\p{L}\p{N}]/u.test(tok.text)) continue;
        probs.push(tok.p);
      }
    }
    const confidence =
      probs.length > 0
        ? {
            minTokenP: Math.round(Math.min(...probs) * 1000) / 1000,
            meanTokenP: Math.round((probs.reduce((a, b) => a + b, 0) / probs.length) * 1000) / 1000,
          }
        : null;

    return { text, language: doc.result?.language ?? "", confidence };
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
        // Sprint 5 §7 anti-hallucination guards for short command clips:
        //  -tp 0   deterministic first decode pass (fallback still escalates on a
        //          genuinely failed decode — we do NOT pass -nf).
        //  -mc 0   store no decoded-text context between windows, so an 8 s clip's
        //          later segments can't be primed by an earlier mis-hear
        //          ("conversation restart" style drift).
        //  -sns    suppress non-speech tokens — kills "[BLANK_AUDIO]" / "(music)" /
        //          "♪" hallucinations on a silent or breath-only lead-in, which is
        //          exactly what an over-eager capture hands us.
        // beam-size / best-of are left at the whisper defaults (5/5): dropping them
        // to 1 measurably regressed "AYAS" → "ayes" in the forensic.
        "-tp", "0",
        "-mc", "0",
        "-sns",
        "-nt", "-ojf", "-of", ofArg,
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
      confidence: parsed?.confidence ?? null,
    };
  } catch (error) {
    return { ok: false, code: "transcribe-failed", detail: (error as Error).message.slice(0, 200) };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
