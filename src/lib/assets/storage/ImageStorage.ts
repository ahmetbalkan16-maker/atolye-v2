import fs from "fs";
import path from "path";
import {
  requireContainedStorageDirectory,
  requireContainedStorageFile,
} from "./StoragePathSecurity";
import {
  acquireProjectWriteAuthority,
  ensureSafeContainedDirectory,
  resolveRuntimeLogicalPath,
  resolveRuntimeLogicalPathForWrite,
  resolveRuntimeStorageContext,
  type RuntimeStorageContext,
  type RuntimeStorageInput,
} from "@/lib/runtime/RuntimeStoragePaths";

type ImageData = string | Buffer;

export interface SaveImageInput {
  projectSlug: string;
  data: ImageData;
  assetId?: string;
  fileName?: string;
  mimeType?: string;
}

export interface SavedImage {
  fileName: string;
  filePath: string;
  url: string;
  mimeType: string;
}

export interface ImageInspection {
  byteLength: number;
}

type ParsedImageData = {
  buffer: Buffer;
  mimeType: string;
};

const DEFAULT_MIME_TYPE = "image/png";

export class ImageStorage {
  static saveImage({
    projectSlug,
    data,
    assetId,
    fileName,
    mimeType,
  }: SaveImageInput, input: RuntimeStorageInput = {}): SavedImage {
    const context = resolveRuntimeStorageContext(input);
    const lease = acquireProjectWriteAuthority(projectSlug, context);
    try {
      const parsed = parseImageData(data, mimeType);
      const resolvedFileName =
        fileName ?? createImageFileName(assetId, parsed.mimeType);
      const relativePath = this.getImagePath(projectSlug, resolvedFileName);
      const absolutePath = resolvePath(relativePath, context, true);

      ensureStorageDirectory(context, path.dirname(absolutePath));
      requireContainedStorageDirectory(path.dirname(absolutePath), context);
      fs.writeFileSync(absolutePath, parsed.buffer);

      return {
        fileName: resolvedFileName,
        filePath: relativePath,
        url: this.getImageUrl(projectSlug, resolvedFileName),
        mimeType: parsed.mimeType,
      };
    } finally {
      lease.release();
    }
  }

  static getImagesDir(projectSlug: string): string {
    return `data/projects/${sanitizePathSegment(projectSlug)}/assets/images`;
  }

  static getImagePath(projectSlug: string, fileName: string): string {
    return `${this.getImagesDir(projectSlug)}/${sanitizeFileName(fileName)}`;
  }

  static getImageUrl(projectSlug: string, fileName: string): string {
    const slug = encodeURIComponent(sanitizePathSegment(projectSlug));
    const imageFileName = encodeURIComponent(sanitizeFileName(fileName));

    return `/api/assets/images/${slug}/${imageFileName}`;
  }

  static inspectStoredImage(
    projectSlug: string,
    filePath: string,
    mimeType: "image/png" | "image/jpeg" | "image/webp",
    input: RuntimeStorageInput = {},
  ): ImageInspection {
    const context = resolveRuntimeStorageContext(input);
    if (!/^[a-zA-Z0-9-_]+$/.test(projectSlug) || filePath.includes("\\")) {
      throw new Error("Invalid image path.");
    }

    const fileName = path.posix.basename(filePath);
    const expected = this.getImagePath(projectSlug, fileName);

    if (filePath !== expected || fileName.includes("..")) {
      throw new Error("Invalid image path.");
    }

    const absolutePath = resolvePath(filePath, context);
    const storageRoot = resolvePath(this.getImagesDir(projectSlug), context);
    const { realPath, stat } = requireContainedStorageFile(
      storageRoot,
      absolutePath,
      context,
    );

    if (stat.size <= 0 || stat.size > 64 * 1024 * 1024) {
      throw new Error("Invalid image file.");
    }

    const buffer = fs.readFileSync(realPath);
    const valid =
      mimeType === "image/png"
        ? buffer.length >= 8 &&
          buffer.subarray(0, 8).equals(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          )
        : mimeType === "image/jpeg"
          ? buffer.length >= 4 &&
            buffer[0] === 0xff &&
            buffer[1] === 0xd8 &&
            buffer.at(-2) === 0xff &&
            buffer.at(-1) === 0xd9
          : buffer.length >= 12 &&
            buffer.toString("ascii", 0, 4) === "RIFF" &&
            buffer.toString("ascii", 8, 12) === "WEBP" &&
            buffer.readUInt32LE(4) + 8 === buffer.length;

    if (!valid) {
      throw new Error("Invalid image file.");
    }

    return { byteLength: buffer.length };
  }
}

function parseImageData(data: ImageData, mimeType?: string): ParsedImageData {
  if (Buffer.isBuffer(data)) {
    return {
      buffer: data,
      mimeType: mimeType ?? DEFAULT_MIME_TYPE,
    };
  }

  const dataUrlMatch = data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (dataUrlMatch) {
    return {
      buffer: Buffer.from(dataUrlMatch[2], "base64"),
      mimeType: dataUrlMatch[1],
    };
  }

  return {
    buffer: Buffer.from(data, "base64"),
    mimeType: mimeType ?? DEFAULT_MIME_TYPE,
  };
}

function createImageFileName(assetId: string | undefined, mimeType: string) {
  const id = sanitizeFileName(assetId ?? crypto.randomUUID());
  const extension = getExtensionFromMimeType(mimeType);

  return `${id}.${extension}`;
}

function getExtensionFromMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

function resolvePath(
  relativePath: string,
  context: RuntimeStorageContext,
  write = false,
) {
  return write
    ? resolveRuntimeLogicalPathForWrite(relativePath, context)
    : resolveRuntimeLogicalPath(relativePath, context);
}

function ensureStorageDirectory(context: RuntimeStorageContext, directory: string) {
  ensureSafeContainedDirectory(context.runtimeRoot, context.projectsRoot);
  ensureSafeContainedDirectory(context.projectsRoot, directory);
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9-_]/g, "-");
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9-_.]/g, "-");
}
