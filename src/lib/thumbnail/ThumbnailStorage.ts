import fs from "node:fs";
import path from "node:path";
import type { ThumbnailMimeType } from "@/types/thumbnail";
import { requireContainedStorageFile } from "@/lib/assets/storage/StoragePathSecurity";

const ROOT_DIR = process.cwd();
const MAX_THUMBNAIL_BYTES = 64 * 1024 * 1024;
const MAX_DIMENSION = 16_384;

export interface SavedThumbnail {
  fileName: string;
  filePath: string;
  url: string;
  mimeType: ThumbnailMimeType;
  width: number;
  height: number;
  byteLength: number;
}

export interface ThumbnailInspection {
  width: number;
  height: number;
  byteLength: number;
}

export class ThumbnailStorage {
  static saveThumbnail(input: {
    projectSlug: string;
    assetId: string;
    data: Buffer;
    mimeType: ThumbnailMimeType;
  }): SavedThumbnail {
    requireSafeSegment(input.projectSlug);
    requireSafeSegment(input.assetId);
    const extension = extensionForMimeType(input.mimeType);
    const fileName = `${input.assetId}.${extension}`;
    const filePath = this.getThumbnailPath(input.projectSlug, fileName);
    const inspection = inspectImageBuffer(input.data, input.mimeType);
    const storageRoot = ensureSafeStorageDirectory(input.projectSlug);
    const absolutePath = path.resolve(storageRoot, fileName);
    const temporaryPath = path.resolve(
      storageRoot,
      `${fileName}.${crypto.randomUUID()}.partial`,
    );

    if (
      !isInside(storageRoot, absolutePath) ||
      !isInside(storageRoot, temporaryPath)
    ) {
      throw new Error("Invalid thumbnail path.");
    }

    let descriptor: number | undefined;
    let published = false;

    try {
      descriptor = fs.openSync(temporaryPath, "wx");
      fs.writeFileSync(descriptor, input.data);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.linkSync(temporaryPath, absolutePath);
      published = true;
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch { /* best effort */ }
      }
      try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
    }

    if (!published) throw new Error("Thumbnail file could not be published.");

    let stored: ThumbnailInspection;
    try {
      stored = this.inspectStoredThumbnail(
        input.projectSlug,
        filePath,
        input.mimeType,
      );
    } catch (error) {
      try { fs.rmSync(absolutePath, { force: true }); } catch { /* best effort */ }
      throw error;
    }

    if (
      stored.byteLength !== inspection.byteLength ||
      stored.width !== inspection.width ||
      stored.height !== inspection.height
    ) {
      throw new Error("Invalid thumbnail file.");
    }

    return {
      fileName,
      filePath,
      url: this.getThumbnailUrl(input.projectSlug, fileName),
      mimeType: input.mimeType,
      ...stored,
    };
  }

  static getThumbnailsDir(projectSlug: string): string {
    requireSafeSegment(projectSlug);
    return `data/projects/${projectSlug}/assets/thumbnails`;
  }

  static getThumbnailPath(projectSlug: string, fileName: string): string {
    requireSafeSegment(projectSlug);
    requireSafeFileName(fileName);
    return `${this.getThumbnailsDir(projectSlug)}/${fileName}`;
  }

  static getThumbnailUrl(projectSlug: string, fileName: string): string {
    requireSafeSegment(projectSlug);
    requireSafeFileName(fileName);
    return `/api/assets/thumbnails/${encodeURIComponent(projectSlug)}/${encodeURIComponent(fileName)}`;
  }

  static inspectStoredThumbnail(
    projectSlug: string,
    filePath: string,
    mimeType: ThumbnailMimeType,
  ): ThumbnailInspection {
    requireSafeSegment(projectSlug);
    if (filePath.includes("\\")) throw new Error("Invalid thumbnail path.");

    const fileName = path.posix.basename(filePath);
    requireSafeFileName(fileName);
    requireMatchingExtension(fileName, mimeType);

    if (filePath !== this.getThumbnailPath(projectSlug, fileName)) {
      throw new Error("Invalid thumbnail path.");
    }

    const storageRoot = path.resolve(
      ROOT_DIR,
      ...this.getThumbnailsDir(projectSlug).split("/"),
    );
    const absolutePath = path.resolve(ROOT_DIR, ...filePath.split("/"));
    const { realPath, stat } = requireContainedStorageFile(
      storageRoot,
      absolutePath,
    );

    if (stat.size <= 0 || stat.size > MAX_THUMBNAIL_BYTES) {
      throw new Error("Invalid thumbnail file.");
    }

    const inspection = inspectImageBuffer(fs.readFileSync(realPath), mimeType);
    if (inspection.byteLength !== stat.size) {
      throw new Error("Invalid thumbnail file.");
    }
    return inspection;
  }

  static readThumbnail(
    projectSlug: string,
    fileName: string,
  ): { data: Buffer; mimeType: ThumbnailMimeType } {
    requireSafeSegment(projectSlug);
    requireSafeFileName(fileName);
    const mimeType = mimeTypeForExtension(fileName);
    const filePath = this.getThumbnailPath(projectSlug, fileName);
    const expected = this.inspectStoredThumbnail(projectSlug, filePath, mimeType);
    const storageRoot = path.resolve(
      ROOT_DIR,
      ...this.getThumbnailsDir(projectSlug).split("/"),
    );
    const absolutePath = path.resolve(ROOT_DIR, ...filePath.split("/"));
    const { realPath } = requireContainedStorageFile(storageRoot, absolutePath);
    const data = fs.readFileSync(realPath);
    const actual = inspectImageBuffer(data, mimeType);
    if (
      actual.byteLength !== expected.byteLength ||
      actual.width !== expected.width ||
      actual.height !== expected.height
    ) throw new Error("Invalid thumbnail file.");
    return { data, mimeType };
  }

  static removeStoredThumbnail(projectSlug: string, filePath: string): void {
    requireSafeSegment(projectSlug);
    if (typeof filePath !== "string" || filePath.includes("\\")) {
      throw new Error("Invalid thumbnail path.");
    }
    const fileName = path.posix.basename(filePath);
    requireSafeFileName(fileName);
    if (filePath !== this.getThumbnailPath(projectSlug, fileName)) {
      throw new Error("Invalid thumbnail path.");
    }
    const storageRoot = path.resolve(
      ROOT_DIR,
      ...this.getThumbnailsDir(projectSlug).split("/"),
    );
    const absolutePath = path.resolve(ROOT_DIR, ...filePath.split("/"));
    if (!fs.existsSync(absolutePath)) return;
    const { realPath } = requireContainedStorageFile(storageRoot, absolutePath);
    fs.rmSync(realPath);
  }
}

function ensureSafeStorageDirectory(projectSlug: string) {
  const workspaceRoot = fs.realpathSync(ROOT_DIR);
  const dataRoot = path.resolve(ROOT_DIR, "data");
  const projectsRoot = path.resolve(dataRoot, "projects");

  requireExistingDirectory(workspaceRoot, dataRoot);
  requireExistingDirectory(dataRoot, projectsRoot);

  const projectRoot = ensureChildDirectory(projectsRoot, projectSlug);
  const assetsRoot = ensureChildDirectory(projectRoot, "assets");
  return ensureChildDirectory(assetsRoot, "thumbnails");
}

function ensureChildDirectory(parent: string, child: string) {
  const target = path.resolve(parent, child);
  if (!isInside(parent, target)) throw new Error("Invalid storage path.");
  if (!fs.existsSync(target)) fs.mkdirSync(target);
  requireExistingDirectory(parent, target);
  return target;
}

function requireExistingDirectory(parent: string, target: string) {
  const link = fs.lstatSync(target);
  if (link.isSymbolicLink() || !link.isDirectory()) {
    throw new Error("Invalid storage path.");
  }
  const realParent = fs.realpathSync(parent);
  const realTarget = fs.realpathSync(target);
  if (!isInside(realParent, realTarget)) throw new Error("Invalid storage path.");
}

function inspectImageBuffer(
  data: Buffer,
  mimeType: ThumbnailMimeType,
): ThumbnailInspection {
  if (data.length <= 0 || data.length > MAX_THUMBNAIL_BYTES) {
    throw new Error("Invalid thumbnail file.");
  }
  const dimensions =
    mimeType === "image/png"
      ? inspectPng(data)
      : mimeType === "image/jpeg"
        ? inspectJpeg(data)
        : inspectWebp(data);
  if (
    !Number.isSafeInteger(dimensions.width) ||
    !Number.isSafeInteger(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width > MAX_DIMENSION ||
    dimensions.height > MAX_DIMENSION
  ) {
    throw new Error("Invalid thumbnail dimensions.");
  }
  return { ...dimensions, byteLength: data.length };
}

function inspectPng(data: Buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    data.length < 45 ||
    !data.subarray(0, 8).equals(signature)
  ) throw new Error("Invalid thumbnail file.");
  let offset = 8;
  let width = 0;
  let height = 0;
  let hasHeader = false;
  let hasData = false;
  let hasEnd = false;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > data.length) throw new Error("Invalid thumbnail file.");
    const content = data.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = data.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([Buffer.from(type, "ascii"), content])) !== expectedCrc) {
      throw new Error("Invalid thumbnail file.");
    }
    if (!hasHeader) {
      if (type !== "IHDR" || length !== 13) throw new Error("Invalid thumbnail file.");
      width = content.readUInt32BE(0);
      height = content.readUInt32BE(4);
      hasHeader = true;
    } else if (type === "IDAT") {
      hasData ||= length > 0;
    } else if (type === "IEND") {
      if (length !== 0 || end !== data.length) throw new Error("Invalid thumbnail file.");
      hasEnd = true;
      break;
    }
    offset = end;
  }
  if (!hasHeader || !hasData || !hasEnd) throw new Error("Invalid thumbnail file.");
  return { width, height };
}

function inspectJpeg(data: Buffer) {
  if (
    data.length < 4 ||
    data[0] !== 0xff ||
    data[1] !== 0xd8 ||
    data.at(-2) !== 0xff ||
    data.at(-1) !== 0xd9
  ) {
    throw new Error("Invalid thumbnail file.");
  }
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) { offset++; continue; }
    const marker = data[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) break;
    if (length >= 7 && [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  throw new Error("Invalid thumbnail file.");
}

function inspectWebp(data: Buffer) {
  if (
    data.length < 30 ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WEBP" ||
    data.readUInt32LE(4) + 8 !== data.length
  ) throw new Error("Invalid thumbnail file.");
  const kind = data.toString("ascii", 12, 16);
  if (kind === "VP8X") {
    return {
      width: 1 + data.readUIntLE(24, 3),
      height: 1 + data.readUIntLE(27, 3),
    };
  }
  if (kind === "VP8 " && data.length >= 30) {
    return {
      width: data.readUInt16LE(26) & 0x3fff,
      height: data.readUInt16LE(28) & 0x3fff,
    };
  }
  if (kind === "VP8L" && data.length >= 25 && data[20] === 0x2f) {
    const bits = data.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  throw new Error("Invalid thumbnail file.");
}

function extensionForMimeType(mimeType: ThumbnailMimeType) {
  return mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : "webp";
}

function mimeTypeForExtension(fileName: string): ThumbnailMimeType {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  throw new Error("Invalid thumbnail file.");
}

function requireMatchingExtension(fileName: string, mimeType: ThumbnailMimeType) {
  if (mimeTypeForExtension(fileName) !== mimeType) {
    throw new Error("Invalid thumbnail file.");
  }
}

function requireSafeSegment(value: string) {
  if (!/^[a-zA-Z0-9-_]+$/.test(value)) throw new Error("Invalid storage path.");
}

function requireSafeFileName(value: string) {
  if (!/^[a-zA-Z0-9-_.]+$/.test(value) || value.includes("..")) {
    throw new Error("Invalid storage path.");
  }
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isInside(directory: string, target: string) {
  const relative = path.relative(directory, target);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}
