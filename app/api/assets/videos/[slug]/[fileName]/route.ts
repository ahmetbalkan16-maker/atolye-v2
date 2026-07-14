import fs from "node:fs";
import { Readable } from "node:stream";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";

type RouteContext = {
  params: Promise<{ slug: string; fileName: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { slug, fileName } = await context.params;

  try {
    const relativePath = VideoStorage.getVideoPath(slug, fileName);
    const inspection = VideoStorage.inspectStoredMp4(
      slug,
      relativePath,
      8 * 1024 * 1024 * 1024,
    );
    const stream = Readable.toWeb(fs.createReadStream(inspection.realPath));

    return new Response(stream as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(inspection.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
