import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { CharacterArtDirection } from "../../character/SvgSceneRenderer";
import { isCharacterBackdropPng } from "../../character/CharacterSceneRasterizer";
import type { CharacterSceneAssetPayload } from "./CharacterSceneAsset";
import type {VolumeEditorialPlan} from '../../character/volume/VolumeEditorial';

export type CharacterLocalBackdropMode = "off" | "cache";
export function resolveCharacterLocalBackdropMode(): CharacterLocalBackdropMode {
  const mode = process.env.ATOLYE_CHARACTER_LOCAL_BACKDROP ?? "off";
  if (mode !== "off" && mode !== "cache") throw new Error("CHARACTER_LOCAL_BACKDROP_MODE_INVALID");
  return mode;
}

/** Only reviewed local backdrops. Production never downloads a model or opens paid generation. */
export function readCharacterLocalBackdrop(mode: CharacterLocalBackdropMode, art: CharacterArtDirection, time = "DAY",scene?:{readonly editorial:VolumeEditorialPlan;readonly years:readonly number[]}): { png: Buffer; metadata: NonNullable<CharacterSceneAssetPayload["background"]> } | null {
  if (mode === "off" || time !== "DAY") return null;
  let theme:string=art.culture;
  if(scene&&scene.editorial.environment!=='BASE'){
    if(scene.editorial.environment==='FOREST')theme=scene.editorial.season==='WINTER'?'FOREST_WINTER':scene.editorial.season==='AUTUMN'?'FOREST_AUTUMN':'FOREST';
    else if(scene.editorial.environment==='COURTYARD'&&art.culture==='OTTOMAN'&&scene.years.length===1&&scene.years[0]!>=1450&&scene.years[0]!<=1600)theme='COURTYARD_OTTOMAN';
    else if(scene.editorial.environment==='HARBOR'&&scene.years.length===1&&scene.years[0]!>=1450&&scene.years[0]!<=1700)theme='HARBOR_EARLY';
    else return null;
  }else if(art.culture==='UNKNOWN'||!art.roles.some(r=>r.role==='RULER'))return null;
  const root = fs.realpathSync.native(process.cwd());
  const directory = path.join(root, "bin", "ayas-local-visual", "library");
  const stem = theme.toLowerCase();
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
  if (receipt.schema !== 1 || receipt.reviewStatus !== "ENGINEERING_ACCEPTED" || receipt.theme !== theme || receipt.provider !== "sdxl-local" || typeof receipt.modelRevision !== "string" || !/^[0-9a-f]{40}$/.test(receipt.modelRevision) || typeof receipt.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(receipt.sha256)) throw new Error("CHARACTER_LOCAL_BACKDROP_UNREVIEWED");
  const png = fs.readFileSync(pngFile);
  if (!isCharacterBackdropPng(png) || createHash("sha256").update(png).digest("hex") !== receipt.sha256) throw new Error("CHARACTER_LOCAL_BACKDROP_CHANGED");
  return { png, metadata: { provider: "sdxl-local", modelRevision: receipt.modelRevision, sha256: receipt.sha256, stageLayout: "foreground-v1" } };
}
