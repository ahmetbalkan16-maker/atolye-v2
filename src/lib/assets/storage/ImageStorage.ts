import fs from "fs";
import path from "path";

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

type ParsedImageData = {
  buffer: Buffer;
  mimeType: string;
};

const ROOT_DIR = process.cwd();
const DEFAULT_MIME_TYPE = "image/png";

export class ImageStorage {
  static saveImage({
    projectSlug,
    data,
    assetId,
    fileName,
    mimeType,
  }: SaveImageInput): SavedImage {
    const parsed = parseImageData(data, mimeType);
    const resolvedFileName =
      fileName ?? createImageFileName(assetId, parsed.mimeType);
    const relativePath = this.getImagePath(projectSlug, resolvedFileName);
    const absolutePath = resolvePath(relativePath);

    ensureDir(absolutePath);
    fs.writeFileSync(absolutePath, parsed.buffer);

    return {
      fileName: resolvedFileName,
      filePath: relativePath,
      url: this.getImageUrl(projectSlug, resolvedFileName),
      mimeType: parsed.mimeType,
    };
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

function resolvePath(relativePath: string) {
  return path.join(ROOT_DIR, relativePath);
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9-_]/g, "-");
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9-_.]/g, "-");
}
