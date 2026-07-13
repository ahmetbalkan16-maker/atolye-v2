import fs from "node:fs";
import path from "node:path";
import { AudioStorage } from "@/lib/assets/storage/AudioStorage";

type RouteContext = {
  params: Promise<{
    slug: string;
    fileName: string;
  }>;
};

const ROOT_DIR = process.cwd();

export async function GET(_request: Request, context: RouteContext) {
  const { slug, fileName } = await context.params;

  if (!isSafePathSegment(slug) || !isSafeWavFileName(fileName)) {
    return new Response("Not found", { status: 404 });
  }

  const audioDir = path.resolve(
    ROOT_DIR,
    "data",
    "projects",
    slug,
    "assets",
    "audio",
  );
  const audioPath = path.resolve(audioDir, fileName);

  if (!isInsideDirectory(audioDir, audioPath) || !fs.existsSync(audioPath)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = fs.readFileSync(audioPath);
    AudioStorage.inspectWav(file);

    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(file.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function isSafePathSegment(value: string) {
  return /^[a-zA-Z0-9-_]+$/.test(value);
}

function isSafeWavFileName(value: string) {
  return /^[a-zA-Z0-9-_.]+\.wav$/i.test(value) && !value.includes("..");
}

function isInsideDirectory(directory: string, targetPath: string) {
  const relativePath = path.relative(directory, targetPath);

  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}
