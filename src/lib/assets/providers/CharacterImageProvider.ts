import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import {
  CHARACTER_SCENE_ASSET_SCHEMA_VERSION,
  CHARACTER_SCENE_FONT_FAMILY,
  CHARACTER_SCENE_STILL_SECONDS,
  embedCharacterScenePayload,
  type CharacterSceneAssetPayload,
} from "@/lib/animation/character/CharacterSceneAsset";
import { CHARACTER_SCENE_HEIGHT, CHARACTER_SCENE_WIDTH } from "@/lib/character/SvgSceneRenderer";
import { rasterizeCharacterSceneAssetFrame } from "@/lib/animation/character/CharacterSceneRasterFrame";
import { createVolumeScenePlan,extractCostumeSceneYears } from "@/lib/character/volume/VolumeScenePlan";
import {periodUnitFromScene} from "@/lib/character/volume/PeriodDesign";
import {CharacterDesignLibrary,characterDesignSpec} from "@/lib/character/volume/CharacterDesignLibrary";
import { planCharacterScene } from "@/lib/animation/character/CharacterScenePlanner";
import { EDITORIAL_RENDER_STYLE } from "@/lib/character/SvgSceneRenderer";
import { planCharacterSceneDirection } from "@/lib/animation/character/CharacterSceneDirection";
import { resolveCharacterLocalBackdropMode, readCharacterLocalBackdrop } from "@/lib/animation/character/CharacterLocalBackdrop";
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
  // Capture once on the existing immutable provider dispatch adapter's instance.
  private readonly backdropMode = resolveCharacterLocalBackdropMode();
  // Capture with the existing immutable dispatch instance, not per-frame env.
  private readonly volumeMode = resolveCharacterVolumeMode();
  private readonly designLibrary=this.volumeMode?new CharacterDesignLibrary():null;

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
        contextualDirection: true,
      });
      const unit=periodUnitFromScene(input.prompt);
      const plannedDirection = planCharacterSceneDirection(this.volumeMode?input.prompt:[input.prompt, ...(input.searchKeywords ?? [])].join(" "), plan.request.blocking);
      const direction=this.volumeMode&&unit.startsWith('JANISSARY')&&plannedDirection.art.culture==='UNKNOWN'?{...plannedDirection,art:{...plannedDirection.art,culture:'OTTOMAN' as const}}:plannedDirection;
      const words=input.prompt.slice(0,8192).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu,'').replace(/ı/g,'i');
      const explicitTravel=/\b(yuru\w*|kos\w*|ilerle\w*|march\w*|walk\w*|run\w*|advanc\w*)\b/.test(words);
      const speaking=/\b(konus\w*|anlat\w*|speak\w*|talk\w*|explain\w*)\b/.test(words);
      const gesture=direction.beats.find(b=>b.action==='TALK'||b.action==='POINT');
      // A soldier noun can select MARCH; an explicit stationary speech must not
      // inherit that inferred walk. Existing 2D plans and explicit travel stay intact.
      const animation=this.volumeMode&&!explicitTravel&&gesture?{...plan.animation,actors:plan.animation.actors.map((a,index)=>a.action==='WALK'||a.action==='RUN'?{...a,action:index===0?(speaking?'TALK' as const:gesture.action):'IDLE' as const,toX:null,delaySeconds:0}:a)}:plan.animation;
      const background = readCharacterLocalBackdrop(this.backdropMode, direction.art, plan.request.blocking.time);
      let volume=this.volumeMode?createVolumeScenePlan(plan.request.blocking,direction.art,extractCostumeSceneYears(input.prompt),unit):undefined;
      const templateIds:string[]=[];
      if(volume?.design&&this.designLibrary) {
        const storedActors=volume.design.actors.map(actor=>{
          const c=plan.request.blocking.characters.find(c=>c.id===actor.actorId)!,brief=volume!.wardrobes.find(w=>w.actorId===c.id)!.brief;
          const selected=this.designLibrary!.ensure(characterDesignSpec(c,direction.art,brief,volume!.design!,this.designLibrary!.geometryFingerprint));
          if(selected.record.previewSha256===null)templateIds.push(selected.record.id);
          return {...actor,profile:selected.record.spec.profile};
        });
        volume={...volume,design:{...volume.design,actors:storedActors}};
      }
      const payload: CharacterSceneAssetPayload = {
        schemaVersion: CHARACTER_SCENE_ASSET_SCHEMA_VERSION,
        request: plan.request,
        animation,
        fontFamily: CHARACTER_SCENE_FONT_FAMILY,
        renderStyle: EDITORIAL_RENDER_STYLE,
        direction,
        ...(volume?{volume}:{}),
        ...(background ? { background: background.metadata } : {}),
      };
      const raster = await rasterizeCharacterSceneAssetFrame(payload, CHARACTER_SCENE_STILL_SECONDS,6,{ backgroundPng: background?.png });
      if (!raster.ok) return failure(input.sceneId, createdAt);
      if(this.designLibrary&&templateIds.length){const sharp=(await import('sharp')).default;const preview=await sharp(raster.png).resize(640,360).png().toBuffer();for(const id of new Set(templateIds))this.designLibrary.savePreviewOnce(id,preview);}
      const data = embedCharacterScenePayload(raster.png, payload, background?.png);
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

export function resolveCharacterVolumeMode(): boolean {
  const mode=process.env.ATOLYE_CHARACTER_RENDER_MODE??"3d";
  if(mode==="3d") return true;
  if(mode==="2d") return false;
  throw new Error("CHARACTER_RENDER_MODE_INVALID");
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
