import { ThumbnailStorage } from "@/lib/thumbnail/ThumbnailStorage";

type RouteContext = {
  params: Promise<{ slug: string; fileName: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { slug, fileName } = await context.params;
    const thumbnail = ThumbnailStorage.readThumbnail(slug, fileName);

    return new Response(new Uint8Array(thumbnail.data), {
      headers: {
        "Content-Type": thumbnail.mimeType,
        "Content-Length": String(thumbnail.data.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
