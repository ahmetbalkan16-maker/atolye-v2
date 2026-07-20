import { AudioStorage } from "@/lib/assets/storage/AudioStorage";

type RouteContext = {
  params: Promise<{
    slug: string;
    fileName: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { slug, fileName } = await context.params;

  if (!isSafePathSegment(slug) || !isSafeWavFileName(fileName)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = AudioStorage.readStoredWav(
      slug,
      AudioStorage.getAudioPath(slug, fileName),
    );
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
