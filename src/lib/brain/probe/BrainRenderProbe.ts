/**
 * Atölye Brain — read-only `ffprobe` render adapter (Sprint 181, PHASE 6).
 *
 * Feeds {@link BrainQualityModel} (`evaluateBrainQuality`) with the technical
 * truth of a finished MP4, by asking `ffprobe` — and only `ffprobe` — about it:
 *
 *   ffprobe -v error -show_format -show_streams -of json <file>
 *
 * Hard rules (from the emir):
 *  - Read-only. No re-encode, no render, no mux, no file mutation, no delete.
 *    The only process spawned is `ffprobe` with read-only flags.
 *  - No fabrication. If the real file is missing / unreadable, the probe returns
 *    `{ available: false }` and {@link buildBrainFinalRenderReport} refuses to
 *    build a report — the quality judge is never handed invented numbers.
 *  - `targetDurationBand` / `targetResolution` / `targetFrameRate` are inputs
 *    (from the quality preset / manifest), never guessed here.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";

import type {
  BrainFinalRenderReport,
  BrainRenderedSceneReport,
} from "@/types/brain";

const DEFAULT_TIMEOUT_MS = 15_000;

/* ------------------------------------------------------------------------- *
 * ffprobe JSON parsing (pure)
 * ------------------------------------------------------------------------- */

export interface FfprobeMediaSummary {
  readonly available: true;
  readonly container: {
    readonly format: string;
    readonly durationSeconds: number;
    readonly sizeBytes: number;
    readonly bitRateKbps?: number;
  };
  readonly video?: {
    readonly codec: string;
    readonly width: number;
    readonly height: number;
    readonly frameRate: number;
  };
  readonly audio?: {
    readonly codec: string;
    readonly sampleRate: number;
    readonly channels: number;
  };
}

export interface FfprobeUnavailable {
  readonly available: false;
  readonly reason: string;
}

export type FfprobeResult = FfprobeMediaSummary | FfprobeUnavailable;

interface RawFfprobeStream {
  readonly codec_type?: string;
  readonly codec_name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly sample_rate?: string;
  readonly channels?: number;
  readonly r_frame_rate?: string;
  readonly avg_frame_rate?: string;
}

interface RawFfprobe {
  readonly streams?: readonly RawFfprobeStream[];
  readonly format?: {
    readonly format_name?: string;
    readonly duration?: string;
    readonly size?: string;
    readonly bit_rate?: string;
  };
}

function ratioToFps(ratio: string | undefined): number | undefined {
  if (!ratio) return undefined;
  const [numerator, denominator] = ratio.split("/").map((part) => Number.parseFloat(part));
  if (!Number.isFinite(numerator)) return undefined;
  const denom = Number.isFinite(denominator) && denominator !== 0 ? denominator : 1;
  const fps = numerator / denom;
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1000) / 1000 : undefined;
}

function toNumber(value: string | number | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parse `ffprobe ... -of json` output. Throws on malformed JSON. */
export function parseFfprobeJson(raw: string): FfprobeResult {
  let parsed: RawFfprobe;
  try {
    parsed = JSON.parse(String(raw ?? "")) as RawFfprobe;
  } catch (error) {
    return {
      available: false,
      reason: `ffprobe output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const durationSeconds = toNumber(parsed.format?.duration);
  if (!parsed.format || durationSeconds === undefined) {
    return { available: false, reason: "ffprobe returned no container/format block" };
  }

  const streams = parsed.streams ?? [];
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const audioStream = streams.find((stream) => stream.codec_type === "audio");

  const summary: FfprobeMediaSummary = {
    available: true,
    container: {
      format: parsed.format.format_name ?? "unknown",
      durationSeconds,
      sizeBytes: toNumber(parsed.format.size) ?? 0,
      ...(toNumber(parsed.format.bit_rate) !== undefined
        ? { bitRateKbps: Math.round((toNumber(parsed.format.bit_rate) as number) / 1000) }
        : {}),
    },
    ...(videoStream
      ? {
          video: {
            codec: videoStream.codec_name ?? "unknown",
            width: toNumber(videoStream.width) ?? 0,
            height: toNumber(videoStream.height) ?? 0,
            frameRate:
              ratioToFps(videoStream.avg_frame_rate) ??
              ratioToFps(videoStream.r_frame_rate) ??
              0,
          },
        }
      : {}),
    ...(audioStream
      ? {
          audio: {
            codec: audioStream.codec_name ?? "unknown",
            sampleRate: toNumber(audioStream.sample_rate) ?? 0,
            channels: toNumber(audioStream.channels) ?? 0,
          },
        }
      : {}),
  };
  return summary;
}

/* ------------------------------------------------------------------------- *
 * Probe (read-only ffprobe invocation)
 * ------------------------------------------------------------------------- */

export interface BrainRenderProbeOptions {
  readonly ffprobePath?: string;
  readonly timeoutMs?: number;
  /** Injectable for tests — receives argv, returns raw stdout or throws. */
  readonly runFfprobe?: (args: readonly string[]) => Promise<string>;
  /** Injectable file-existence check for tests. */
  readonly fileExists?: (filePath: string) => boolean;
}

function defaultRunFfprobe(binPath: string, timeoutMs: number) {
  return (args: readonly string[]): Promise<string> =>
    new Promise((resolve, reject) => {
      execFile(
        binPath,
        [...args],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout) => {
          if (error && !stdout) {
            reject(error);
            return;
          }
          resolve(String(stdout ?? ""));
        },
      );
    });
}

function resolveFfprobePath(explicit?: string): string {
  return (
    explicit ||
    process.env.FFPROBE_PATH ||
    process.env.FFPROBE_EXECUTABLE ||
    "ffprobe"
  );
}

/**
 * Probe a media file. Never throws — a missing binary / missing file / probe
 * failure all resolve to `{ available: false, reason }`.
 */
export async function probeMediaFile(
  filePath: string,
  options: BrainRenderProbeOptions = {},
): Promise<FfprobeResult> {
  const exists = options.fileExists ?? ((candidate: string) => fs.existsSync(candidate));
  if (!filePath || !exists(filePath)) {
    return { available: false, reason: `media file not found: ${filePath || "(empty path)"}` };
  }
  const ffprobePath = resolveFfprobePath(options.ffprobePath);
  const runFfprobe =
    options.runFfprobe ?? defaultRunFfprobe(ffprobePath, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const args = [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    filePath,
  ];
  try {
    const raw = await runFfprobe(args);
    return parseFfprobeJson(raw);
  } catch (error) {
    return {
      available: false,
      reason: `ffprobe failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/* ------------------------------------------------------------------------- *
 * Summary → BrainFinalRenderReport (pure combiner)
 * ------------------------------------------------------------------------- */

export interface BrainFinalRenderReportInput {
  readonly projectSlug: string;
  readonly observedAt: string;
  readonly summary: FfprobeMediaSummary;
  /** Editorial targets — from the quality preset / manifest, not the probe. */
  readonly targetDurationBand: { readonly minSeconds: number; readonly maxSeconds: number };
  readonly targetResolution: { readonly width: number; readonly height: number };
  readonly targetFrameRate: number;
  readonly targetLoudnessLufs?: number;
  /** Per-scene facts from the manifest (planned/rendered seconds, asset ids…). */
  readonly scenes: readonly BrainRenderedSceneReport[];
  readonly expectedAssetKinds: readonly string[];
  readonly presentAssetKinds: readonly string[];
  readonly narrationDurationSeconds?: number;
  readonly leadingSilenceSeconds?: number;
  readonly trailingSilenceSeconds?: number;
  readonly integratedLoudnessLufs?: number;
  readonly subtitleCueCount?: number;
}

/**
 * Build the structured report the quality judge consumes. Requires a real
 * `ffprobe` summary (`summary.available === true`, enforced by the type) — there
 * is no path here that manufactures a container/stream from nothing.
 */
export function buildBrainFinalRenderReport(
  input: BrainFinalRenderReportInput,
): BrainFinalRenderReport {
  const { summary } = input;
  return {
    projectSlug: input.projectSlug,
    observedAt: input.observedAt,
    container: {
      format: summary.container.format,
      durationSeconds: summary.container.durationSeconds,
      sizeBytes: summary.container.sizeBytes,
    },
    ...(summary.video ? { video: summary.video } : {}),
    ...(summary.audio ? { audio: summary.audio } : {}),
    ...(input.narrationDurationSeconds !== undefined
      ? { narrationDurationSeconds: input.narrationDurationSeconds }
      : {}),
    ...(input.leadingSilenceSeconds !== undefined
      ? { leadingSilenceSeconds: input.leadingSilenceSeconds }
      : {}),
    ...(input.trailingSilenceSeconds !== undefined
      ? { trailingSilenceSeconds: input.trailingSilenceSeconds }
      : {}),
    ...(input.integratedLoudnessLufs !== undefined
      ? { integratedLoudnessLufs: input.integratedLoudnessLufs }
      : {}),
    targetDurationBand: input.targetDurationBand,
    targetResolution: input.targetResolution,
    targetFrameRate: input.targetFrameRate,
    ...(input.targetLoudnessLufs !== undefined
      ? { targetLoudnessLufs: input.targetLoudnessLufs }
      : {}),
    scenes: input.scenes,
    expectedAssetKinds: input.expectedAssetKinds,
    presentAssetKinds: input.presentAssetKinds,
    ...(input.subtitleCueCount !== undefined ? { subtitleCueCount: input.subtitleCueCount } : {}),
  };
}
