import fs from "node:fs";
import { AssetManager } from "@/lib/assets/AssetManager";
import { AudioStorage } from "@/lib/assets/storage/AudioStorage";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import { ProjectWriter } from "@/lib/projects/ProjectWriter";
import { resolveRuntimeLogicalPath, type RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import type { AssemblyPlanData } from "@/types/assembly";
import type { AudioData } from "@/types/audio";
import type { Asset } from "@/types/asset";

/**
 * Rebuilds the project's single "mix" audio asset (the whole-narration track
 * `VideoAssemblyManager.requireMixAsset()` requires to exist and be non-mock, even
 * though the per-scene render path sources actual narration PCM from the individual
 * chapter sections) by concatenating the *currently bound* authoritative chapter WAVs
 * — i.e. call `updateAudioSectionBinding` for every chapter first, then this.
 *
 * Writes the new WAV through `AudioStorage.saveAudio` — the same hardened,
 * quarantine-safe, exactly-once publication path every other real audio asset in this
 * codebase goes through (no raw `fs.writeFileSync` into asset storage) — and registers
 * it via `AssetManager.createAsset`/`addAssetAtomically`, exactly like every other
 * asset-producing stage does. Never invokes ffmpeg or any subprocess: WAV
 * concatenation for a single, already-validated PCM format is simple enough to do
 * as plain buffer arithmetic, and doing so keeps this one-off/library-scale utility
 * free of an external process dependency.
 */
export class AudioMixRebuildError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AudioMixRebuildError";
    this.stack = undefined;
  }
}

export async function rebuildAudioMixFromCanonicalSections(input: {
  readonly projectSlug: string;
  readonly projectId: string;
  readonly context?: RuntimeStorageContext;
}): Promise<AudioData> {
  const audio = await ProjectManager.getAudio(input.projectSlug, input.context) as AudioData | null;
  if (!audio || !Array.isArray(audio.sections) || audio.sections.length < 1) {
    throw new AudioMixRebuildError("AUDIO_MIX_REBUILD_SOURCE_INVALID");
  }
  const orderedSections = [...audio.sections].sort((a, b) => a.chapterId - b.chapterId);
  const projectAssets = AssetManager.getProjectAssets(input.projectSlug, input.projectId, input.context);

  const pcmChunks: { readonly format: WavPcmFormat; readonly data: Buffer }[] = [];
  for (const section of orderedSections) {
    const asset = requireBoundSectionAsset(projectAssets.assets, input, section.chapterId, section.outputAssetId);
    const bytes = fs.readFileSync(resolveRuntimeLogicalPath(asset.filePath as string, input.context ?? {}));
    pcmChunks.push({ format: parseWavPcmFormat(bytes), data: extractWavData(bytes) });
  }
  const format = pcmChunks[0].format;
  if (pcmChunks.some((chunk) =>
    chunk.format.audioFormat !== format.audioFormat ||
    chunk.format.numChannels !== format.numChannels ||
    chunk.format.sampleRate !== format.sampleRate ||
    chunk.format.bitsPerSample !== format.bitsPerSample)) {
    throw new AudioMixRebuildError("AUDIO_MIX_REBUILD_FORMAT_MISMATCH");
  }
  const mixBuffer = buildWavFile(format, Buffer.concat(pcmChunks.map((chunk) => chunk.data)));

  const existingMixAsset = projectAssets.assets.find((asset) =>
    asset.id === audio.outputAssetId &&
    asset.model === "audio-mix-canonical-concat-v1" &&
    asset.byteLength === mixBuffer.length &&
    typeof asset.filePath === "string" &&
    fs.existsSync(asset.filePath)
  );
  if (existingMixAsset) {
    const assembly = await ProjectReader.readJSON<AssemblyPlanData>(input.projectSlug, "assembly.json", input.context);
    if (assembly && assembly.sourceAudioAssetId !== existingMixAsset.id) {
      const updatedAssembly: AssemblyPlanData = {
        ...assembly,
        sourceAudioAssetId: existingMixAsset.id,
      };
      await ProjectWriter.writeJSON(input.projectSlug, "assembly.json", updatedAssembly, input.context);
    }
    return audio;
  }

  const mixFilePath = `data/projects/${input.projectSlug}/assets/audio/mix.wav`;
  if (fs.existsSync(mixFilePath)) {
    fs.unlinkSync(mixFilePath);
  }

  const saved = AudioStorage.saveAudio(
    { projectSlug: input.projectSlug, data: mixBuffer, fileName: "mix.wav" },
    input.context ?? {},
  );
  const provider = orderedSections
    .map((section) => projectAssets.assets.find((asset) => asset.id === section.outputAssetId)?.provider)
    .find((value): value is string => typeof value === "string" && value !== "mock") ?? "unknown";
  const mixAsset = AssetManager.createAsset({
    projectId: input.projectId,
    projectSlug: input.projectSlug,
    type: "audio",
    status: "generated",
    provider,
    model: "audio-mix-canonical-concat-v1",
    prompt: "Canonical narration mix rebuilt from authoritative chapter sections.",
    filePath: saved.filePath,
    url: saved.url,
    mimeType: saved.mimeType,
    byteLength: saved.byteLength,
    durationSeconds: saved.durationSeconds,
  });
  AssetManager.addAssetAtomically(input.projectSlug, input.projectId, mixAsset, input.context ?? {});

  const updatedAudio: AudioData = {
    ...audio,
    outputAssetId: mixAsset.id,
    status: "generated",
    provider,
    model: mixAsset.model,
    production: {
      ...audio.production,
      generationStatus: "generated",
      audioFileUrl: saved.url,
      byteLength: saved.byteLength,
      durationSeconds: saved.durationSeconds,
    },
  };
  await ProjectManager.saveAudio(input.projectSlug, updatedAudio, input.context);

  const assembly = await ProjectReader.readJSON<AssemblyPlanData>(input.projectSlug, "assembly.json", input.context);
  if (assembly && assembly.sourceAudioAssetId !== mixAsset.id) {
    const updatedAssembly: AssemblyPlanData = {
      ...assembly,
      sourceAudioAssetId: mixAsset.id,
    };
    await ProjectWriter.writeJSON(input.projectSlug, "assembly.json", updatedAssembly, input.context);
  }

  return updatedAudio;
}

function requireBoundSectionAsset(
  assets: readonly Asset[],
  input: { readonly projectId: string; readonly projectSlug: string },
  chapterId: number,
  assetId: string | undefined,
): Asset {
  const candidates = assets.filter((asset) => asset.id === assetId);
  if (typeof assetId !== "string" || candidates.length !== 1) {
    throw new AudioMixRebuildError("AUDIO_MIX_REBUILD_CHAPTER_UNBOUND");
  }
  const asset = candidates[0];
  if (
    asset.projectId !== input.projectId || asset.projectSlug !== input.projectSlug ||
    asset.type !== "audio" || asset.status !== "generated" ||
    asset.provider === "mock" || asset.model === "mock" ||
    asset.sceneId !== chapterId || asset.mimeType !== "audio/wav" ||
    typeof asset.filePath !== "string"
  ) {
    throw new AudioMixRebuildError("AUDIO_MIX_REBUILD_CHAPTER_NOT_AUTHORITATIVE");
  }
  return asset;
}

interface WavPcmFormat {
  readonly audioFormat: number;
  readonly numChannels: number;
  readonly sampleRate: number;
  readonly bitsPerSample: number;
}

function parseWavPcmFormat(bytes: Buffer): WavPcmFormat {
  const fmt = findChunk(bytes, "fmt ");
  if (!fmt || fmt.length < 16) throw new AudioMixRebuildError("AUDIO_MIX_REBUILD_WAV_INVALID");
  return Object.freeze({
    audioFormat: fmt.readUInt16LE(0),
    numChannels: fmt.readUInt16LE(2),
    sampleRate: fmt.readUInt32LE(4),
    bitsPerSample: fmt.readUInt16LE(14),
  });
}

function extractWavData(bytes: Buffer): Buffer {
  const data = findChunk(bytes, "data");
  if (!data || data.length < 1) throw new AudioMixRebuildError("AUDIO_MIX_REBUILD_WAV_INVALID");
  return data;
}

function findChunk(bytes: Buffer, chunkId: string): Buffer | null {
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new AudioMixRebuildError("AUDIO_MIX_REBUILD_WAV_INVALID");
  }
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const rawSize = bytes.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;
    const size = rawSize === 0xffffffff ? bytes.length - payloadStart : rawSize;
    const payloadEnd = payloadStart + size;
    if (payloadEnd > bytes.length) break;
    if (id === chunkId) return bytes.subarray(payloadStart, payloadEnd);
    offset = payloadEnd + (size % 2); // chunks are word-aligned
  }
  return null;
}

function buildWavFile(format: WavPcmFormat, data: Buffer): Buffer {
  const blockAlign = format.numChannels * (format.bitsPerSample / 8);
  const byteRate = format.sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(format.audioFormat, 20);
  header.writeUInt16LE(format.numChannels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(format.bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
