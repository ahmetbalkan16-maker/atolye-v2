import fs from "node:fs";
import path from "node:path";
import { requireContainedStorageFile } from "./StoragePathSecurity";

const ROOT_DIR = process.cwd();

export interface VideoInspection {
  byteLength: number;
}

export interface StoredVideoInspection extends VideoInspection {
  realPath: string;
}

export class VideoStorage {
  static getVideoDir(projectSlug: string) {
    return `data/projects/${safeSegment(projectSlug)}/assets/videos`;
  }

  static getVideoPath(projectSlug: string, fileName: string) {
    return `${this.getVideoDir(projectSlug)}/${safeMp4FileName(fileName)}`;
  }

  static getVideoUrl(projectSlug: string, fileName: string) {
    return `/api/assets/videos/${encodeURIComponent(
      safeSegment(projectSlug),
    )}/${encodeURIComponent(safeMp4FileName(fileName))}`;
  }

  static createRenderPaths(projectSlug: string) {
    return this.createPaths(projectSlug, crypto.randomUUID());
  }

  static createSceneRenderPaths(projectSlug: string, sceneId: number) {
    if (!Number.isSafeInteger(sceneId) || sceneId <= 0) {
      throw new Error("Invalid scene id.");
    }
    return this.createPaths(projectSlug, `scene-${sceneId}-${crypto.randomUUID()}`);
  }

  private static createPaths(projectSlug: string, id: string) {
    const fileName = `${id}.mp4`;
    const temporaryFileName = `${id}.partial.mp4`;
    const directory = resolveRelative(this.getVideoDir(projectSlug));

    fs.mkdirSync(directory, { recursive: true });

    return {
      fileName,
      filePath: this.getVideoPath(projectSlug, fileName),
      url: this.getVideoUrl(projectSlug, fileName),
      absolutePath: resolveRelative(this.getVideoPath(projectSlug, fileName)),
      temporaryAbsolutePath: path.join(directory, temporaryFileName),
    };
  }

  static finalize(temporaryAbsolutePath: string, absolutePath: string) {
    const videoRoot = resolveRelative("data/projects");

    if (
      !inside(videoRoot, temporaryAbsolutePath) ||
      !inside(videoRoot, absolutePath) ||
      fs.existsSync(absolutePath)
    ) {
      throw new Error("Invalid video output path.");
    }

    fs.renameSync(temporaryAbsolutePath, absolutePath);
  }

  static inspectMp4(filePath: string, maximumBytes: number): VideoInspection {
    const stat = fs.statSync(filePath);

    if (
      !stat.isFile() ||
      stat.size <= 0 ||
      !Number.isSafeInteger(stat.size) ||
      stat.size > maximumBytes
    ) {
      throw new Error("Invalid MP4 file.");
    }

    const descriptor = fs.openSync(filePath, "r");
    let offset = 0;
    let first = true;
    let hasFtyp = false;
    let hasMoov = false;
    let hasMdat = false;

    try {
      while (offset < stat.size) {
        const header = Buffer.alloc(16);
        const bytesRead = fs.readSync(descriptor, header, 0, 8, offset);

        if (bytesRead !== 8) {
          throw new Error("Invalid MP4 file.");
        }

        let boxSize = header.readUInt32BE(0);
        const boxType = header.toString("ascii", 4, 8);
        let headerSize = 8;

        if (boxSize === 1) {
          if (fs.readSync(descriptor, header, 8, 8, offset + 8) !== 8) {
            throw new Error("Invalid MP4 file.");
          }
          const extendedSize = header.readBigUInt64BE(8);

          if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error("Invalid MP4 file.");
          }
          boxSize = Number(extendedSize);
          headerSize = 16;
        } else if (boxSize === 0) {
          boxSize = stat.size - offset;
        }

        if (
          boxSize < headerSize ||
          !Number.isSafeInteger(boxSize) ||
          offset + boxSize > stat.size
        ) {
          throw new Error("Invalid MP4 file.");
        }

        if (first && boxType !== "ftyp") {
          throw new Error("Invalid MP4 file.");
        }

        hasFtyp ||= boxType === "ftyp";
        hasMoov ||= boxType === "moov";
        hasMdat ||= boxType === "mdat";
        first = false;
        offset += boxSize;
      }
    } finally {
      fs.closeSync(descriptor);
    }

    if (offset !== stat.size || !hasFtyp || !hasMoov || !hasMdat) {
      throw new Error("Invalid MP4 file.");
    }

    return { byteLength: stat.size };
  }

  static inspectStoredMp4(
    projectSlug: string,
    filePath: string,
    maximumBytes: number,
  ): StoredVideoInspection {
    const fileName = path.posix.basename(filePath);
    const expectedPath = this.getVideoPath(projectSlug, fileName);

    if (filePath !== expectedPath) {
      throw new Error("Invalid MP4 path.");
    }

    const storageRoot = resolveRelative(this.getVideoDir(projectSlug));
    const absolutePath = resolveRelative(filePath);
    const contained = requireContainedStorageFile(storageRoot, absolutePath);
    const inspection = this.inspectMp4(contained.realPath, maximumBytes);

    return { ...inspection, realPath: contained.realPath };
  }

  static removeIfExists(filePath: string) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Best-effort cleanup must not replace the normalized render failure.
    }
  }
}

function resolveRelative(relativePath: string) {
  return path.resolve(ROOT_DIR, ...relativePath.split("/"));
}

function safeSegment(value: string) {
  if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
    throw new Error("Invalid project slug.");
  }
  return value;
}

function safeMp4FileName(value: string) {
  if (
    !/^[a-zA-Z0-9-_.]+\.mp4$/i.test(value) ||
    value.includes("..") ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new Error("Invalid MP4 file name.");
  }
  return value;
}

function inside(directory: string, target: string) {
  const relative = path.relative(directory, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
