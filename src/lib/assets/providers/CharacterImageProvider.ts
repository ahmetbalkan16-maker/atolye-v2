import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import {
  CHARACTER_SCENE_ASSET_SCHEMA_VERSION,
  CHARACTER_SCENE_FONT_FAMILY,
  CHARACTER_SCENE_STILL_SECONDS,
  embedCharacterScenePayload,
  renderCharacterSceneAssetFrame,
  type CharacterSceneAssetPayload,
} from "@/lib/animation/character/CharacterSceneAsset";
import { CHARACTER_SCENE_HEIGHT, CHARACTER_SCENE_WIDTH } from "@/lib/character/SvgSceneRenderer";
import { rasterizeCharacterSceneSvg } from "@/lib/character/CharacterSceneRasterizer";
import { planCharacterScene } from "@/lib/animation/character/CharacterScenePlanner";
import { EDITORIAL_RENDER_STYLE } from "@/lib/character/SvgSceneRenderer";
import type { ImageGenerationResult } from "@/types/asset";
import { ImageStorage } from "../storage/ImageStorage";
import type { ConfiguredImageProvider, ImageGenerationInput } from "./ImageProvider";

const MODEL = "svg-stick-figure-animated-v1";
const GENERIC_ERROR = "Character scene generation failed.";

/**
 * Local, $0 stick-figure reenactment provider (`IMAGE_PROVIDER=character`).
 *
 * Each scene's own words (the visual prompt and search keywords the visuals stage wrote) are planned into a
 * stick-figure blocking and an animation plan by the deterministic planner, drawn with the Stage 15J engine and
 * stored as an ordinary 1920x1080 PNG through the existing image storage. The plan rides inside the PNG, so the
 * scene-video stage animates exactly this scene; every other consumer sees a normal image.
 *
 * No model, no network, no API cost: it never consumes the AI-image cap or the cost budget. A scene is always a
 * labelled reenactment ("CANLANDIRMA" in the image) and is classified downstream as a synthesised image with
 * `selectionReason: "local-character-reenactment"`, never as a photo or evidence.
 */
export class CharacterImageProvider implements ConfiguredImageProvider {
  readonly name = "character" as const;

  createImmutableImageDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name },
      requiredMethods: ["generateImage"],
    });
  }

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const createdAt = new Date().toISOString();
    if (!Number.isSafeInteger(input.sceneId) || input.sceneId <= 0 || !input.projectSlug) {
      return failure(input.sceneId, createdAt);
    }

    try {
      const plan = planCharacterScene({
        sceneId: input.sceneId,
        text: typeof input.prompt === "string" ? input.prompt : "",
        keywords: input.searchKeywords,
        language: "tr",
      });
      const payload: CharacterSceneAssetPayload = {
        schemaVersion: CHARACTER_SCENE_ASSET_SCHEMA_VERSION,
        request: plan.request,
        animation: plan.animation,
        fontFamily: CHARACTER_SCENE_FONT_FAMILY,
        renderStyle: EDITORIAL_RENDER_STYLE,
      };
      const raster = await rasterizeCharacterSceneSvg(renderCharacterSceneAssetFrame(payload, CHARACTER_SCENE_STILL_SECONDS));
      if (!raster.ok) return failure(input.sceneId, createdAt);
      const data = embedCharacterScenePayload(raster.png, payload);
      const saved = trySaveImage(input.projectSlug, data);
      if (!saved) return failure(input.sceneId, createdAt);

      return {
        success: true,
        sceneId: input.sceneId,
        provider: "character",
        model: MODEL,
        filePath: saved.filePath,
        url: saved.url,
        mimeType: "image/png",
        width: CHARACTER_SCENE_WIDTH,
        height: CHARACTER_SCENE_HEIGHT,
        createdAt,
      };
    } catch {
      return failure(input.sceneId, createdAt);
    }
  }
}

function trySaveImage(
  projectSlug: string,
  bytes: Buffer,
): { filePath: string; url: string } | null {
  try {
    const savedImage = ImageStorage.saveImage({ projectSlug, data: bytes, mimeType: "image/png" });
    const inspection = ImageStorage.inspectStoredImage(projectSlug, savedImage.filePath, "image/png");
    if (
      inspection.byteLength !== bytes.byteLength ||
      savedImage.url !== ImageStorage.getImageUrl(projectSlug, savedImage.fileName) ||
      savedImage.filePath !== ImageStorage.getImagePath(projectSlug, savedImage.fileName)
    ) {
      return null;
    }
    return { filePath: savedImage.filePath, url: savedImage.url };
  } catch {
    return null;
  }
}

function failure(sceneId: number, createdAt: string): ImageGenerationResult {
  return {
    success: false,
    sceneId: Number.isSafeInteger(sceneId) && sceneId > 0 ? sceneId : 0,
    provider: "character",
    model: MODEL,
    createdAt,
    error: GENERIC_ERROR,
  };
}
