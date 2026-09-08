import { ImageStorage } from "@/lib/assets/storage/ImageStorage";

type RouteContext = {
  params: Promise<{
    slug: string;
    fileName: string;
  }>;
};

/**
 * Serves a stored project image.
 *
 * Reads exclusively through `ImageStorage`, which resolves the logical
 * `data/projects/<slug>/assets/images/<file>` path against the canonical
 * runtime storage context (`ATOLYE_RUNTIME_ROOT`, else the legacy in-repo
 * default) with containment + symlink/junction rejection. There is no
 * `process.cwd()` / physical `data/projects` access here — this route is no
 * longer a storage-relocation bypass (sub-sprint C.2B.5).
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const { slug, fileName } = await context.params;
    const image = ImageStorage.readImage(slug, fileName);

    const headers: Record<string, string> = {
      "Content-Type": image.mimeType,
      "Content-Length": String(image.data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    };
    if (image.mimeType === "image/svg+xml") {
      // Same-origin SVG can carry inline script; serve it inert.
      headers["Content-Security-Policy"] =
        "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    }

    return new Response(new Uint8Array(image.data), { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
