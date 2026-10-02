import { CHARACTER_SCENE_HEIGHT, CHARACTER_SCENE_WIDTH } from "./SvgSceneRenderer";

/**
 * Stage 15J — turns a character scene's SVG into the PNG the FFmpeg scene pipeline reads.
 *
 * It uses the image library that is already installed with the framework (`sharp`); nothing is installed for it. On
 * a machine without that library the answer is `RASTERIZER_UNAVAILABLE`: no other renderer is tried and no
 * placeholder is returned in its place.
 *
 * Only an SVG of the shape the scene renderer writes is accepted. An SVG that could make the rasterizer read another
 * file or a network address is refused before the library sees it.
 */
export type CharacterSceneRasterResult =
  | { readonly ok: true; readonly png: Buffer; readonly width: number; readonly height: number; readonly rasterizer: "sharp" }
  | { readonly ok: false; readonly reason: "SVG_REJECTED" | "RASTERIZER_UNAVAILABLE" | "RASTERIZE_FAILED" };

const HEADER = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${CHARACTER_SCENE_WIDTH}" height="${CHARACTER_SCENE_HEIGHT}" viewBox="0 0 ${CHARACTER_SCENE_WIDTH} ${CHARACTER_SCENE_HEIGHT}">`;
/** Anything that could reach outside the document, or run. The scene renderer writes none of these. */
const OUTSIDE = /<image\b|<use\b|<script\b|<foreignObject\b|<style\b|<!DOCTYPE|<!ENTITY|\bhref\s*=|url\s*\(|@import|javascript:|\bon[a-z]+\s*=/i;
const MAX_SVG_BYTES = 512 * 1024;

export function isRasterizableCharacterSceneSvg(svg: string): boolean {
  return typeof svg === "string" && svg.startsWith(HEADER) && svg.trimEnd().endsWith("</svg>") && Buffer.byteLength(svg, "utf8") <= MAX_SVG_BYTES && !OUTSIDE.test(svg);
}

export async function rasterizeCharacterSceneSvg(svg: string): Promise<CharacterSceneRasterResult> {
  if (!isRasterizableCharacterSceneSvg(svg)) return { ok: false, reason: "SVG_REJECTED" };
  let sharp: typeof import("sharp");
  try { sharp = (await import("sharp")).default; } catch { return { ok: false, reason: "RASTERIZER_UNAVAILABLE" }; }
  try {
    const png = await sharp(Buffer.from(svg, "utf8")).resize(CHARACTER_SCENE_WIDTH, CHARACTER_SCENE_HEIGHT, { fit: "fill" }).png().toBuffer();
    // PNG signature, then the IHDR chunk's width and height.
    if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(4) !== 0x0d0a1a0a || png.readUInt32BE(16) !== CHARACTER_SCENE_WIDTH || png.readUInt32BE(20) !== CHARACTER_SCENE_HEIGHT) return { ok: false, reason: "RASTERIZE_FAILED" };
    return { ok: true, png, width: CHARACTER_SCENE_WIDTH, height: CHARACTER_SCENE_HEIGHT, rasterizer: "sharp" };
  } catch { return { ok: false, reason: "RASTERIZE_FAILED" }; }
}
