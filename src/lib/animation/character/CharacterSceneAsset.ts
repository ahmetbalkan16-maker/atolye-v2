import {
  CHARACTER_ANIMATION_FPS,
  characterAnimationFrame,
  findCharacterAnimationProblems,
  type CharacterAnimationPlan,
} from "./CharacterAnimation";
import { findCharacterSceneRequestProblems, type CharacterSceneRequest } from "../../character/CharacterSceneManifest";
import { renderCharacterSceneFrameSvg } from "../../character/SvgSceneRenderer";
import { EDITORIAL_RENDER_STYLE, findCharacterArtDirectionProblems } from "../../character/SvgSceneRenderer";
import { characterDirectedFrame, findCharacterStoryBeatProblems, type CharacterSceneDirection } from "./CharacterSceneDirection";

/**
 * Atölye stick-figure scene asset — the PNG the visuals stage stores for a character scene, and how the video stage
 * gets the animation back out of it.
 *
 * The stored image is an ordinary 1920x1080 PNG (one frame of the scene), so every existing consumer — the gallery,
 * the thumbnail, the motion plan — reads it as before. The scene's blocking and animation plan ride inside the same
 * file as one `tEXt` chunk, so the asset stays a single file in the existing image storage and the video stage can
 * draw every frame of exactly the scene that was planned. A PNG without the chunk is any other image.
 *
 * The payload is fixed to a documentary reenactment: the label is drawn in every frame.
 */
export const CHARACTER_SCENE_ASSET_SCHEMA_VERSION = "1" as const;
export const CHARACTER_SCENE_PNG_KEYWORD = "atolye:character-scene";
/** Real fonts first: the rasterizer on Windows resolves the generic `sans-serif` to a serif face. */
export const CHARACTER_SCENE_FONT_FAMILY = "Segoe UI, Arial, DejaVu Sans, sans-serif";
/** The moment of the scene the stored still shows: far enough in that the figures are already moving. */
export const CHARACTER_SCENE_STILL_SECONDS = 1.2;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface CharacterSceneAssetPayload {
  readonly schemaVersion: typeof CHARACTER_SCENE_ASSET_SCHEMA_VERSION;
  readonly request: CharacterSceneRequest;
  readonly animation: CharacterAnimationPlan;
  readonly fontFamily: string;
  /** Absent on historical assets; their original appearance stays unchanged. */
  readonly renderStyle?: typeof EDITORIAL_RENDER_STYLE;
  readonly direction?: CharacterSceneDirection;
}

export type CharacterScenePayloadRead =
  | { readonly status: "ABSENT" }
  | { readonly status: "VALID"; readonly payload: CharacterSceneAssetPayload }
  | { readonly status: "INVALID"; readonly reason: string };

export function findCharacterSceneAssetPayloadProblems(value: unknown): string[] {
  const payload = value as Partial<CharacterSceneAssetPayload> | null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      Object.keys(payload).some((key) => !["schemaVersion", "request", "animation", "fontFamily", "renderStyle", "direction"].includes(key))) return ["PAYLOAD_SHAPE"];
  const problems: string[] = [];
  if (payload.schemaVersion !== CHARACTER_SCENE_ASSET_SCHEMA_VERSION) problems.push("PAYLOAD_SCHEMA_VERSION");
  if (payload.fontFamily !== CHARACTER_SCENE_FONT_FAMILY) problems.push("PAYLOAD_FONT");
  if (payload.renderStyle !== undefined && payload.renderStyle !== EDITORIAL_RENDER_STYLE) problems.push("PAYLOAD_RENDER_STYLE");
  const requestProblems = findCharacterSceneRequestProblems(payload.request);
  problems.push(...requestProblems);
  // A drawn scene in a documentary always says what it is.
  if (!requestProblems.length && payload.request!.format !== "DOCUMENTARY") problems.push("PAYLOAD_FORMAT");
  if (!requestProblems.length) problems.push(...findCharacterAnimationProblems(payload.animation, payload.request!.blocking));
  if (payload.direction !== undefined) {
    const d = payload.direction;
    if (payload.renderStyle !== EDITORIAL_RENDER_STYLE || !d || typeof d !== "object" || Array.isArray(d) || Object.keys(d).length !== 3 || Object.keys(d).some(k => !["art", "timing", "beats"].includes(k)) || d.timing !== "SCENE_TEXT_ESTIMATE") problems.push("PAYLOAD_DIRECTION");
    else {
      problems.push(...findCharacterArtDirectionProblems(d.art));
      if (!requestProblems.length) {
        const ids = new Set(payload.request!.blocking.characters.map(c => c.id));
        if (!findCharacterArtDirectionProblems(d.art).length && (d.art.roles.length !== ids.size || d.art.roles.some(r => !ids.has(r.id)))) problems.push("PAYLOAD_DIRECTION_ROLES");
        problems.push(...findCharacterStoryBeatProblems(d.beats, payload.request!.blocking));
      }
    }
  }
  return problems;
}

/** The SVG of the scene at `t` seconds. */
export function renderCharacterSceneAssetFrame(payload: CharacterSceneAssetPayload, t: number, durationSeconds = 6): string {
  return renderCharacterSceneFrameSvg(
    payload.request.blocking,
    payload.direction ? characterDirectedFrame(payload.request.blocking, payload.animation, payload.direction.beats, t, durationSeconds) : characterAnimationFrame(payload.request.blocking, payload.animation, t),
    { reenactmentLabel: payload.request.language, fontFamily: payload.fontFamily, renderStyle: payload.renderStyle, artDirection: payload.direction?.art },
  );
}

/** The time of frame `index`. */
export function characterSceneFrameSeconds(index: number): number {
  return index / CHARACTER_ANIMATION_FPS;
}

/** A copy of `png` with the payload added just before its end. */
export function embedCharacterScenePayload(png: Buffer, payload: CharacterSceneAssetPayload): Buffer {
  const problems = findCharacterSceneAssetPayloadProblems(payload);
  if (problems.length) throw new Error(`CHARACTER_SCENE_PAYLOAD_INVALID: ${problems.join(", ")}`);
  const chunks = readChunks(png);
  if (!chunks || chunks.some((chunk) => chunk.type === "tEXt" && keywordOf(png, chunk) === CHARACTER_SCENE_PNG_KEYWORD)) {
    throw new Error("CHARACTER_SCENE_PNG_INVALID");
  }
  const text = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  if (text.length > MAX_PAYLOAD_BYTES) throw new Error("CHARACTER_SCENE_PAYLOAD_TOO_LARGE");
  const data = Buffer.concat([Buffer.from(CHARACTER_SCENE_PNG_KEYWORD, "latin1"), Buffer.from([0]), Buffer.from(text, "latin1")]);
  const end = chunks[chunks.length - 1]!;
  return Buffer.concat([png.subarray(0, end.offset), chunk("tEXt", data), png.subarray(end.offset)]);
}

/** The payload inside a stored PNG, if there is one. A damaged or edited payload is INVALID, never ignored. */
export function readCharacterScenePayload(png: Buffer): CharacterScenePayloadRead {
  const chunks = readChunks(png);
  if (!chunks) return { status: "ABSENT" };
  const ours = chunks.filter((item) => item.type === "tEXt" && keywordOf(png, item) === CHARACTER_SCENE_PNG_KEYWORD);
  if (ours.length === 0) return { status: "ABSENT" };
  if (ours.length > 1) return { status: "INVALID", reason: "PAYLOAD_DUPLICATED" };
  const found = ours[0]!;
  if (!found.crcValid) return { status: "INVALID", reason: "PAYLOAD_CRC" };
  const text = png.subarray(found.dataOffset + CHARACTER_SCENE_PNG_KEYWORD.length + 1, found.dataOffset + found.length).toString("latin1");
  if (text.length > MAX_PAYLOAD_BYTES || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return { status: "INVALID", reason: "PAYLOAD_ENCODING" };
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(text, "base64").toString("utf8")); } catch { return { status: "INVALID", reason: "PAYLOAD_JSON" }; }
  const problems = findCharacterSceneAssetPayloadProblems(payload);
  return problems.length ? { status: "INVALID", reason: problems.join(", ") } : { status: "VALID", payload: payload as CharacterSceneAssetPayload };
}

interface PngChunk { readonly type: string; readonly offset: number; readonly dataOffset: number; readonly length: number; readonly crcValid: boolean }

/** The chunks of a well-formed PNG, ending with IEND; `null` for anything else. */
function readChunks(png: Buffer): PngChunk[] | null {
  if (!Buffer.isBuffer(png) || png.length < PNG_SIGNATURE.length + 12 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (length > 0x7fffffff || end > png.length || !/^[A-Za-z]{4}$/.test(type)) return null;
    const crcValid = crc32(png.subarray(offset + 4, offset + 8 + length)) === png.readUInt32BE(offset + 8 + length);
    chunks.push({ type, offset, dataOffset: offset + 8, length, crcValid });
    offset = end;
    if (type === "IEND") return chunks[0]?.type === "IHDR" && offset === png.length ? chunks : null;
  }
  return null;
}

function keywordOf(png: Buffer, item: PngChunk): string {
  const data = png.subarray(item.dataOffset, item.dataOffset + item.length);
  const nul = data.indexOf(0);
  return nul > 0 ? data.toString("latin1", 0, nul) : "";
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
