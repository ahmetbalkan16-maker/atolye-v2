import fs from "fs";
import path from "path";

type RouteContext = {
  params: Promise<{
    slug: string;
    fileName: string;
  }>;
};

const ROOT_DIR = process.cwd();

export async function GET(_req: Request, context: RouteContext) {
  const { slug, fileName } = await context.params;

  if (!isSafePathSegment(slug) || !isSafeFileName(fileName)) {
    return new Response("Not found", { status: 404 });
  }

  const imagesDir = path.resolve(
    ROOT_DIR,
    "data",
    "projects",
    slug,
    "assets",
    "images",
  );
  const imagePath = path.resolve(imagesDir, fileName);

  if (!isInsideDirectory(imagesDir, imagePath) || !fs.existsSync(imagePath)) {
    return new Response("Not found", { status: 404 });
  }

  const stat = fs.statSync(imagePath);

  if (!stat.isFile()) {
    return new Response("Not found", { status: 404 });
  }

  const file = fs.readFileSync(imagePath);

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": getContentType(fileName),
      "Content-Length": String(file.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

function isSafePathSegment(value: string) {
  return /^[a-zA-Z0-9-_]+$/.test(value);
}

function isSafeFileName(value: string) {
  return /^[a-zA-Z0-9-_.]+$/.test(value) && !value.includes("..");
}

function isInsideDirectory(directory: string, targetPath: string) {
  const relativePath = path.relative(directory, targetPath);

  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}

function getContentType(fileName: string) {
  switch (path.extname(fileName).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".png":
    default:
      return "image/png";
  }
}
