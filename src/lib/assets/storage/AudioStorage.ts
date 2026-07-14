import fs from "node:fs";
import path from "node:path";
import { requireContainedStorageFile } from "./StoragePathSecurity";

export interface SaveAudioInput {
  projectSlug: string;
  data: ArrayBuffer | Buffer;
  assetId?: string;
  fileName?: string;
}

export interface AudioInspection {
  byteLength: number;
  durationSeconds: number;
}

export interface SavedAudio extends AudioInspection {
  fileName: string;
  filePath: string;
  url: string;
  mimeType: "audio/wav";
}

const ROOT_DIR = process.cwd();
export const AUDIO_STORAGE_MAX_BYTES = 256 * 1024 * 1024;
const MAX_AUDIO_DURATION_SECONDS = 4 * 60 * 60;

export class AudioStorage {
  static saveAudio({
    projectSlug,
    data,
    assetId,
    fileName,
  }: SaveAudioInput): SavedAudio {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const inspection = this.inspectWav(buffer);
    const resolvedFileName = fileName
      ? requireSafeWavFileName(fileName)
      : `${sanitizeFileName(assetId ?? crypto.randomUUID())}.wav`;
    const relativePath = this.getAudioPath(projectSlug, resolvedFileName);
    const absolutePath = resolvePath(relativePath);

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, buffer);

    return {
      fileName: resolvedFileName,
      filePath: relativePath,
      url: this.getAudioUrl(projectSlug, resolvedFileName),
      mimeType: "audio/wav",
      ...inspection,
    };
  }

  static getAudioDir(projectSlug: string): string {
    return `data/projects/${requireSafePathSegment(projectSlug)}/assets/audio`;
  }

  static getAudioPath(projectSlug: string, fileName: string): string {
    return `${this.getAudioDir(projectSlug)}/${requireSafeWavFileName(fileName)}`;
  }

  static getAudioUrl(projectSlug: string, fileName: string): string {
    const slug = encodeURIComponent(requireSafePathSegment(projectSlug));
    const audioFileName = encodeURIComponent(requireSafeWavFileName(fileName));

    return `/api/assets/audio/${slug}/${audioFileName}`;
  }

  static inspectStoredWav(
    projectSlug: string,
    filePath: string,
  ): AudioInspection {
    const fileName = path.posix.basename(filePath);
    const expectedPath = this.getAudioPath(projectSlug, fileName);

    if (filePath !== expectedPath) {
      throw new Error("Invalid WAV path.");
    }

    const absolutePath = resolvePath(filePath);
    const storageRoot = resolvePath(this.getAudioDir(projectSlug));
    const { realPath, stat } = requireContainedStorageFile(
      storageRoot,
      absolutePath,
    );

    if (stat.size <= 0 || stat.size > AUDIO_STORAGE_MAX_BYTES) {
      throw new Error("Invalid WAV file.");
    }

    return this.inspectWav(fs.readFileSync(realPath));
  }

  static inspectWav(buffer: Buffer): AudioInspection {
    if (buffer.length < 12 || buffer.length > AUDIO_STORAGE_MAX_BYTES) {
      throw new Error("Invalid WAV file.");
    }

    if (
      buffer.toString("ascii", 0, 4) !== "RIFF" ||
      buffer.toString("ascii", 8, 12) !== "WAVE" ||
      buffer.readUInt32LE(4) + 8 !== buffer.length
    ) {
      throw new Error("Invalid WAV file.");
    }

    let offset = 12;
    let byteRate: number | null = null;
    let dataByteLength = 0;
    let hasFormatChunk = false;
    let hasDataChunk = false;

    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString("ascii", offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const chunkStart = offset + 8;
      const chunkEnd = chunkStart + chunkSize;

      if (chunkEnd > buffer.length) {
        throw new Error("Invalid WAV file.");
      }

      if (chunkId === "fmt ") {
        if (hasFormatChunk || chunkSize < 16) {
          throw new Error("Invalid WAV file.");
        }

        const audioFormat = buffer.readUInt16LE(chunkStart);
        const channels = buffer.readUInt16LE(chunkStart + 2);
        const sampleRate = buffer.readUInt32LE(chunkStart + 4);
        const parsedByteRate = buffer.readUInt32LE(chunkStart + 8);
        const blockAlign = buffer.readUInt16LE(chunkStart + 12);
        const bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
        const expectedBlockAlign = channels * (bitsPerSample / 8);
        const expectedByteRate = sampleRate * blockAlign;

        if (
          (audioFormat !== 1 && audioFormat !== 3) ||
          channels === 0 ||
          sampleRate === 0 ||
          parsedByteRate === 0 ||
          blockAlign === 0 ||
          bitsPerSample === 0 ||
          bitsPerSample % 8 !== 0 ||
          blockAlign !== expectedBlockAlign ||
          parsedByteRate !== expectedByteRate
        ) {
          throw new Error("Invalid WAV file.");
        }

        byteRate = parsedByteRate;
        hasFormatChunk = true;
      } else if (chunkId === "data") {
        if (hasDataChunk || chunkSize === 0) {
          throw new Error("Invalid WAV file.");
        }

        dataByteLength = chunkSize;
        hasDataChunk = true;
      }

      offset = chunkEnd + (chunkSize % 2);
    }

    if (
      offset !== buffer.length ||
      !hasFormatChunk ||
      !hasDataChunk ||
      byteRate === null ||
      dataByteLength <= 0
    ) {
      throw new Error("Invalid WAV file.");
    }

    const durationSeconds = dataByteLength / byteRate;

    if (
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      durationSeconds > MAX_AUDIO_DURATION_SECONDS
    ) {
      throw new Error("Invalid WAV file.");
    }

    return {
      byteLength: buffer.length,
      durationSeconds,
    };
  }
}

function resolvePath(relativePath: string) {
  return path.resolve(ROOT_DIR, ...relativePath.split("/"));
}

function requireSafePathSegment(value: string) {
  if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
    throw new Error("Invalid project slug.");
  }

  return value;
}

function sanitizeFileName(value: string) {
  const sanitized = value.replace(/[^a-zA-Z0-9-_.]/g, "-");
  return sanitized === "." || sanitized === ".." ? crypto.randomUUID() : sanitized;
}

function requireSafeWavFileName(value: string) {
  if (
    !/^[a-zA-Z0-9-_.]+\.wav$/i.test(value) ||
    value.includes("..") ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new Error("Invalid WAV file name.");
  }

  return value;
}
