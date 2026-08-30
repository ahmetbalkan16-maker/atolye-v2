import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { AssetManager } from "@/lib/assets/AssetManager";
import { AudioStorage } from "@/lib/assets/storage/AudioStorage";
import {
  classifyMediaRightsStatus,
  isProductionAdmissibleRightsStatus,
} from "@/lib/assets/MediaRightsPolicy";
import {
  SpawnRunner,
  type VideoAssemblyProcessRunner,
} from "@/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import {
  getFFmpegSceneVideoConfig,
  type FFmpegSceneVideoConfig,
} from "@/lib/video/providers/VideoProviderConfig";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import type { Asset, MediaRightsStatus } from "@/types/asset";
import type { AudioData } from "@/types/audio";
import { selectMusicTrack, type MusicTrack } from "./MusicLibrary";
import { selectAmbienceBed, type SfxClip } from "@/lib/audio/sfx/SfxLibrary";

/**
 * Documentary media effort — Faz 4: wire the license-cleared local music library
 * into the pipeline as a real, rights-gated background-music bed.
 *
 * The assembly stage already knows how to duck a `bgm` audio asset under the
 * narration (`VideoAssemblyManager.resolveBackgroundMusic` +
 * `FFmpegVideoAssemblyProvider.appendBgmFilterGraph`, sidechain compression).
 * The only missing link was a step that actually *stages* that asset. This
 * module is that step.
 *
 * Guarantees:
 *  - **Rights fail-closed**: a track whose licence does not classify as
 *    `public-domain` / `open-license` / `verified` (via `MediaRightsPolicy`) is
 *    never staged — the render stays narration-only.
 *  - **Best-effort**: every failure path returns `{ staged: false, reason }`
 *    and the unchanged `AudioData`. Music is optional; it never fails the audio
 *    stage.
 *  - **Deterministic**: selection is seeded by the project slug
 *    (`MusicLibrary.selectMusicTrack`), so the same project + same library
 *    always picks the same track.
 *  - **Provenance preserved**: the staged asset carries
 *    `mediaOrigin/"real"`, `mediaType/"music"`, `rightsStatus`, `sourceName`,
 *    `sourceUrl`, `license`, `attribution`, `checksum` — same shape as every
 *    other real-media asset in Faz 1-3.
 *  - Staging goes through the canonical `AudioStorage.saveAudio` +
 *    `AssetManager.addAssetAtomically` path (identical to
 *    `AudioCanonicalMixRebuilder`), so the audio publication-intent machinery
 *    stays consistent. The staged bed is always a validated WAV
 *    (`bgm.wav`); a compressed library track is transcoded with ffmpeg first
 *    when ffmpeg is configured, otherwise the step is skipped.
 */

/** `resolveBackgroundMusic` matches an asset whose id is exactly "bgm". */
export const BACKGROUND_MUSIC_ASSET_ID = "bgm";
const BACKGROUND_MUSIC_FILE_NAME = "bgm.wav";
const MAX_SOURCE_TRACK_BYTES = 96 * 1024 * 1024;

export type MusicStagingSkipReason =
  | "no-track-in-library"
  | "rights-not-admissible"
  | "source-file-unreadable"
  | "source-file-too-large"
  | "transcode-unavailable"
  | "transcode-failed"
  | "wav-invalid"
  | "registry-failed";

export interface StagedAmbienceInfo {
  readonly title: string;
  readonly category: string;
  readonly source: string | null;
  readonly sourceUrl: string | null;
  readonly license: string | null;
  readonly rightsStatus: MediaRightsStatus;
  readonly attribution: string | null;
}

export type MusicStagingOutcome =
  | {
      readonly staged: true;
      readonly asset: Asset;
      readonly track: MusicTrack | null;
      readonly rightsStatus: MediaRightsStatus;
      /** Present when an ambience bed was mixed under the music (or used alone). */
      readonly ambience?: StagedAmbienceInfo;
      readonly audio: AudioData;
    }
  | {
      readonly staged: false;
      readonly reason: MusicStagingSkipReason;
      readonly audio: AudioData;
    };

export interface StageProjectBackgroundMusicInput {
  readonly projectId: string;
  readonly projectSlug: string;
  readonly audio: AudioData;
  /** Free-text music-style hint from the script, folded into the mood text. */
  readonly musicStyleHint?: string | null;
  /**
   * Free-text hints (e.g. `research.soundEffects` + dominant scene themes) used
   * to deterministically pick one licence-cleared ambience bed to mix under the
   * music. A `null` result (empty SFX library, or inadmissible clip) leaves the
   * bed music-only. Faz 4.
   */
  readonly ambienceHints?: readonly (string | null | undefined)[];
  readonly storageContext: RuntimeStorageContext;
  readonly now?: () => string;
  readonly env?: NodeJS.ProcessEnv;
  /** Injectable for tests. */
  readonly runner?: VideoAssemblyProcessRunner;
  readonly loadFFmpegConfig?: () => FFmpegSceneVideoConfig;
  readonly musicSelector?: typeof selectMusicTrack;
  readonly ambienceSelector?: typeof selectAmbienceBed;
}

export async function stageProjectBackgroundMusic(
  input: StageProjectBackgroundMusicInput,
): Promise<MusicStagingOutcome> {
  const now = input.now ?? (() => new Date().toISOString());
  const env = input.env ?? process.env;
  const select = input.musicSelector ?? selectMusicTrack;

  const moodText = [
    input.audio?.music?.mood,
    input.audio?.music?.suggestion,
    input.musicStyleHint,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .trim();

  const rawTrack = select(moodText || undefined, input.projectSlug, env);
  const selectAmbience = input.ambienceSelector ?? selectAmbienceBed;
  const rawAmbience = (input.ambienceHints && input.ambienceHints.length > 0)
    ? selectAmbience(input.ambienceHints, input.projectSlug, env)
    : null;

  // Rights fail-closed for each layer independently — an inadmissible source is
  // simply dropped, never staged.
  const track = rawTrack && isProductionAdmissibleRightsStatus(classifyMediaRightsStatus(rawTrack.license))
    ? rawTrack
    : null;
  const ambience = rawAmbience && rawAmbience.admissible ? rawAmbience : null;

  if (!track && !ambience) {
    // A track existed but its licence failed the gate -> report that explicitly.
    if (rawTrack) return skip("rights-not-admissible", input.audio);
    return skip("no-track-in-library", input.audio);
  }

  const rightsStatus = track
    ? classifyMediaRightsStatus(track.license)
    : (ambience as SfxClip).rightsStatus;

  const ambienceInfo: StagedAmbienceInfo | undefined = ambience
    ? {
        title: ambience.title,
        category: ambience.category,
        source: ambience.source,
        sourceUrl: ambience.sourceUrl,
        license: ambience.license,
        rightsStatus: ambience.rightsStatus,
        attribution: ambience.attribution,
      }
    : undefined;

  // Idempotent: a prior run already staged the bed. Deterministic selection means
  // reusing it is safe (avoids the no-clobber writer).
  const existing = findStagedBackgroundMusicAsset(input);
  if (existing) {
    return {
      staged: true,
      asset: existing,
      track,
      rightsStatus,
      ...(ambienceInfo ? { ambience: ambienceInfo } : {}),
      audio: withSelectedBed(input.audio, existing, track, rightsStatus),
    };
  }

  // Resolve each layer to WAV bytes.
  const primary = track ?? undefined;
  const primaryPath = primary?.absolutePath ?? ambience!.absolutePath;
  const primaryBytes = await resolveWavBytes(primaryPath, input);
  if (!primaryBytes.ok) return skip(primaryBytes.reason, input.audio);

  let bedBytes = primaryBytes.bytes;
  let mixedAmbience = false;
  if (track && ambience) {
    const ambienceBytes = await resolveWavBytes(ambience.absolutePath, input);
    if (ambienceBytes.ok) {
      const mixed = await mixMusicAndAmbience(primaryBytes.bytes, ambienceBytes.bytes, input);
      if (mixed.ok) {
        bedBytes = mixed.bytes;
        mixedAmbience = true;
      }
      // ffmpeg unavailable / failed -> gracefully fall back to music-only bed.
    }
  }

  let saved: ReturnType<typeof AudioStorage.saveAudio>;
  try {
    saved = AudioStorage.saveAudio(
      { projectSlug: input.projectSlug, data: bedBytes, fileName: BACKGROUND_MUSIC_FILE_NAME },
      input.storageContext,
    );
  } catch {
    return skip("wav-invalid", input.audio);
  }

  const createdAt = now();
  const checksum = createHash("sha256").update(bedBytes).digest("hex");
  const layers = [
    track ? `music/${track.mood}` : null,
    (mixedAmbience || (!track && ambience)) ? `ambience/${ambience!.category}` : null,
  ].filter((value): value is string => value !== null);
  const attributionParts = [
    track?.attribution ?? (track ? `${track.title}` : null),
    (mixedAmbience || (!track && ambience)) ? (ambience!.attribution ?? ambience!.title) : null,
  ].filter((value): value is string => Boolean(value));

  const asset = AssetManager.createAsset({
    id: BACKGROUND_MUSIC_ASSET_ID,
    projectId: input.projectId,
    projectSlug: input.projectSlug,
    type: "audio",
    status: "generated",
    provider: "music-library",
    model: (track?.fileName ?? ambience!.fileName).slice(0, 120),
    prompt: `Background audio bed (${layers.join(" + ") || "documentary"}) selected from the licence-cleared local libraries.`,
    filePath: saved.filePath,
    url: saved.url,
    mimeType: saved.mimeType,
    byteLength: saved.byteLength,
    durationSeconds: saved.durationSeconds,
    mediaOrigin: "real",
    mediaType: track ? "music" : "ambience",
    rightsStatus,
    sourceName: track?.source ?? ambience?.source ?? "local-audio-library",
    sourceUrl: track?.sourceUrl ?? ambience?.sourceUrl ?? undefined,
    license: track?.license ?? ambience?.license ?? undefined,
    attribution: attributionParts.length > 0 ? attributionParts.join("; ").slice(0, 300) : undefined,
    selectionReason: mixedAmbience
      ? "library-mood-match+ambience"
      : track
        ? "library-mood-match"
        : "library-ambience-match",
    checksum,
    discoveredAt: createdAt,
    createdAt,
  });

  try {
    AssetManager.addAssetAtomically(input.projectSlug, input.projectId, asset, input.storageContext);
  } catch {
    return skip("registry-failed", input.audio);
  }

  return {
    staged: true,
    asset,
    track,
    rightsStatus,
    ...(ambienceInfo && (mixedAmbience || !track) ? { ambience: ambienceInfo } : {}),
    audio: withSelectedBed(input.audio, asset, track, rightsStatus),
  };
}

// --------------------------------------------------------------------------- internals

function skip(reason: MusicStagingSkipReason, audio: AudioData): MusicStagingOutcome {
  return { staged: false, reason, audio };
}

function withSelectedBed(
  audio: AudioData,
  asset: Asset,
  track: MusicTrack | null,
  rightsStatus: MediaRightsStatus,
): AudioData {
  return {
    ...audio,
    music: {
      ...audio.music,
      selected: {
        assetId: asset.id,
        mood: track?.mood ?? "ambience",
        title: track?.title ?? asset.model ?? "ambience bed",
        source: track?.source ?? asset.sourceName ?? null,
        sourceUrl: track?.sourceUrl ?? asset.sourceUrl ?? null,
        license: track?.license ?? asset.license ?? null,
        rightsStatus,
        attribution: track?.attribution ?? asset.attribution ?? null,
      },
    },
  };
}

/** `.wav` -> read as-is; anything else -> transcode via ffmpeg when available. */
async function resolveWavBytes(
  sourcePath: string,
  input: StageProjectBackgroundMusicInput,
): Promise<
  | { readonly ok: true; readonly bytes: Buffer }
  | { readonly ok: false; readonly reason: MusicStagingSkipReason }
> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(sourcePath);
  } catch {
    return { ok: false, reason: "source-file-unreadable" };
  }
  if (!stat.isFile() || stat.size <= 0) return { ok: false, reason: "source-file-unreadable" };
  if (stat.size > MAX_SOURCE_TRACK_BYTES) return { ok: false, reason: "source-file-too-large" };

  if (path.extname(sourcePath).toLowerCase() === ".wav") {
    try {
      return { ok: true, bytes: fs.readFileSync(sourcePath) };
    } catch {
      return { ok: false, reason: "source-file-unreadable" };
    }
  }
  return transcodeToWav(sourcePath, input);
}

/**
 * Mix a music WAV (full level) and an ambience WAV (low, -12 dB) into one
 * documentary bed, trimmed to the shorter input. Returns `{ok:false}` when
 * ffmpeg is unavailable/fails so the caller can fall back to a music-only bed.
 */
async function mixMusicAndAmbience(
  musicWav: Buffer,
  ambienceWav: Buffer,
  input: StageProjectBackgroundMusicInput,
): Promise<{ readonly ok: true; readonly bytes: Buffer } | { readonly ok: false }> {
  let config: FFmpegSceneVideoConfig;
  try {
    config = (input.loadFFmpegConfig ?? getFFmpegSceneVideoConfig)();
    if (!fs.statSync(config.ffmpegPath).isFile()) return { ok: false };
  } catch {
    return { ok: false };
  }

  const runner = input.runner ?? new SpawnRunner();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const musicPath = path.join(os.tmpdir(), `atolye-bed-music-${stamp}.wav`);
  const ambiencePath = path.join(os.tmpdir(), `atolye-bed-amb-${stamp}.wav`);
  const outPath = path.join(os.tmpdir(), `atolye-bed-mix-${stamp}.wav`);
  try {
    fs.writeFileSync(musicPath, musicWav);
    fs.writeFileSync(ambiencePath, ambienceWav);
    const result = await runner.run(
      config.ffmpegPath,
      [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-i", musicPath,
        "-i", ambiencePath,
        "-filter_complex",
        "[0:a]aresample=44100,aformat=sample_fmts=s16:channel_layouts=stereo[m];" +
          "[1:a]aresample=44100,aformat=sample_fmts=s16:channel_layouts=stereo,volume=0.25[a];" +
          "[m][a]amix=inputs=2:duration=shortest:normalize=0[bed]",
        "-map", "[bed]",
        "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", "-f", "wav",
        outPath,
      ],
      { timeoutMs: config.timeoutMs, maxOutputBytes: config.maxStdioBytes },
    );
    if (
      result.exitCode !== 0 ||
      result.signal !== null ||
      result.timedOut ||
      result.failed === true
    ) {
      return { ok: false };
    }
    const bytes = fs.readFileSync(outPath);
    return bytes.length > 0 ? { ok: true, bytes } : { ok: false };
  } catch {
    return { ok: false };
  } finally {
    for (const p of [musicPath, ambiencePath, outPath]) {
      try {
        fs.rmSync(p, { force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}

/**
 * Returns the already-staged `bgm` asset when a prior run left one whose file is
 * still a valid WAV on disk; otherwise `undefined`. Any inspection failure is
 * treated as "not staged" so a fresh staging attempt runs.
 */
function findStagedBackgroundMusicAsset(
  input: StageProjectBackgroundMusicInput,
): Asset | undefined {
  let assets;
  try {
    assets = AssetManager.getProjectAssets(input.projectSlug, input.projectId, input.storageContext);
  } catch {
    return undefined;
  }
  const asset = assets.assets.find(
    (candidate) =>
      candidate.id === BACKGROUND_MUSIC_ASSET_ID &&
      candidate.type === "audio" &&
      candidate.status === "generated" &&
      typeof candidate.filePath === "string",
  );
  if (!asset || typeof asset.filePath !== "string") return undefined;
  try {
    AudioStorage.inspectStoredWav(input.projectSlug, asset.filePath, input.storageContext);
    return asset;
  } catch {
    return undefined;
  }
}

async function transcodeToWav(
  sourcePath: string,
  input: StageProjectBackgroundMusicInput,
): Promise<
  | { readonly ok: true; readonly bytes: Buffer }
  | { readonly ok: false; readonly reason: "transcode-unavailable" | "transcode-failed" }
> {
  let config: FFmpegSceneVideoConfig;
  try {
    config = (input.loadFFmpegConfig ?? getFFmpegSceneVideoConfig)();
    const stat = fs.statSync(config.ffmpegPath);
    if (!stat.isFile()) return { ok: false, reason: "transcode-unavailable" };
  } catch {
    return { ok: false, reason: "transcode-unavailable" };
  }

  const runner = input.runner ?? new SpawnRunner();
  const outPath = `${sourcePath}.atolye-bgm-${Date.now()}.wav`;
  try {
    const result = await runner.run(
      config.ffmpegPath,
      [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-i", sourcePath,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "44100",
        "-ac", "2",
        "-f", "wav",
        outPath,
      ],
      { timeoutMs: config.timeoutMs, maxOutputBytes: config.maxStdioBytes },
    );
    if (
      result.exitCode !== 0 ||
      result.signal !== null ||
      result.timedOut ||
      result.failed === true
    ) {
      return { ok: false, reason: "transcode-failed" };
    }
    const bytes = fs.readFileSync(outPath);
    if (bytes.length === 0) return { ok: false, reason: "transcode-failed" };
    return { ok: true, bytes };
  } catch {
    return { ok: false, reason: "transcode-failed" };
  } finally {
    try {
      fs.rmSync(outPath, { force: true });
    } catch {
      // best-effort temp cleanup
    }
  }
}
