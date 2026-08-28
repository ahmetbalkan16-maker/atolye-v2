import fs from "node:fs";
import { Readable } from "node:stream";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";

type RouteContext = {
  params: Promise<{ slug: string; fileName: string }>;
};

/**
 * Parses a single-range `Range: bytes=start-end` header against a known total
 * size. Returns null for an absent/unparseable/multi-range header (caller
 * serves the full body), or `{ satisfiable: false }` when the range lies
 * entirely outside the file (caller returns 416). Open-ended (`bytes=500-`)
 * and suffix (`bytes=-1024`) forms are both supported.
 */
function parseByteRange(
  header: string | null,
  totalSize: number,
): { start: number; end: number } | { satisfiable: false } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;
  if (rawStart === "") {
    const suffixLength = Number(rawEnd);
    if (suffixLength <= 0) return { satisfiable: false };
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? totalSize - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= totalSize) return { satisfiable: false };
  return { start, end: Math.min(end, totalSize - 1) };
}

export async function GET(request: Request, context: RouteContext) {
  const { slug, fileName } = await context.params;

  try {
    const relativePath = VideoStorage.getVideoPath(slug, fileName);
    const inspection = VideoStorage.inspectStoredMp4(
      slug,
      relativePath,
      8 * 1024 * 1024 * 1024,
    );
    const totalSize = inspection.byteLength;
    const range = parseByteRange(request.headers.get("range"), totalSize);

    const baseHeaders: Record<string, string> = {
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    };

    if (range && "satisfiable" in range) {
      return new Response("Range not satisfiable", {
        status: 416,
        headers: { ...baseHeaders, "Content-Range": `bytes */${totalSize}` },
      });
    }

    if (range) {
      const { start, end } = range;
      const stream = Readable.toWeb(
        fs.createReadStream(inspection.realPath, { start, end }),
      );
      return new Response(stream as ReadableStream<Uint8Array>, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${totalSize}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }

    const stream = Readable.toWeb(fs.createReadStream(inspection.realPath));
    return new Response(stream as ReadableStream<Uint8Array>, {
      headers: { ...baseHeaders, "Content-Length": String(totalSize) },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
