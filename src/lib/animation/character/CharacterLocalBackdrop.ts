import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { CharacterArtDirection } from "../../character/SvgSceneRenderer";
import { isCharacterBackdropPng } from "../../character/CharacterSceneRasterizer";
import type { CharacterSceneAssetPayload } from "./CharacterSceneAsset";

export type CharacterLocalBackdropMode = "off" | "cache";
export function resolveCharacterLocalBackdropMode(): CharacterLocalBackdropMode {
  const mode = process.env.ATOLYE_CHARACTER_LOCAL_BACKDROP ?? "off";
  if (mode !== "off" && mode !== "cache") throw new Error("CHARACTER_LOCAL_BACKDROP_MODE_INVALID");
  return mode;
}

/** Only reviewed local backdrops. Production never downloads a model or opens paid generation. */
export function readCharacterLocalBackdrop(mode: CharacterLocalBackdropMode, art: CharacterArtDirection): { png: Buffer; metadata: NonNullable<CharacterSceneAssetPayload["background"]> } | null {
  if (mode === "off" || art.culture === "UNKNOWN") return null;
  const root = fs.realpathSync.native(process.cwd());
  const directory = path.join(root, "bin", "ayas-local-visual", "library");
  const stem = art.culture.toLowerCase();
  const receiptFile = path.join(directory, `${stem}.json`);
  const pngFile = path.join(directory, `${stem}.png`);
  if (!fs.existsSync(receiptFile) && !fs.existsSync(pngFile)) return null;
  const contained = (file: string) => {
    const actual = fs.realpathSync.native(file); const relative = path.relative(root, actual);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.statSync(actual).isFile()) throw new Error("CHARACTER_LOCAL_BACKDROP_PATH_REFUSED");
    return actual;
  };
  if (fs.statSync(contained(receiptFile)).size > 8192 || fs.statSync(contained(pngFile)).size > 2 * 1024 * 1024) throw new Error("CHARACTER_LOCAL_BACKDROP_SIZE_REFUSED");
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8")) as Record<string, unknown>;
  if (receipt.schema !== 1 || receipt.reviewStatus !== "ENGINEERING_ACCEPTED" || receipt.theme !== art.culture || receipt.provider !== "sdxl-local" || typeof receipt.modelRevision !== "string" || !/^[0-9a-f]{40}$/.test(receipt.modelRevision) || typeof receipt.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(receipt.sha256)) throw new Error("CHARACTER_LOCAL_BACKDROP_UNREVIEWED");
  const png = fs.readFileSync(pngFile);
  if (!isCharacterBackdropPng(png) || createHash("sha256").update(png).digest("hex") !== receipt.sha256) throw new Error("CHARACTER_LOCAL_BACKDROP_CHANGED");
  return { png, metadata: { provider: "sdxl-local", modelRevision: receipt.modelRevision, sha256: receipt.sha256 } };
}
