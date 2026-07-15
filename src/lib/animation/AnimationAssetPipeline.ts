import path from "node:path";
import { AIUsageManager } from "@/lib/ai/AIUsageManager";
import { AssetManager } from "@/lib/assets/AssetManager";
import { ImageStorage } from "@/lib/assets/storage/ImageStorage";
import type { Asset, ImageMimeType, ProjectAssets } from "@/types/asset";
import {
  animationMotionTypes,
  animationTransitionTypes,
  type AnimationMotionPlanScene,
  type AnimationScene,
} from "@/types/animation";
import {
  isValidAnimationDuration,
  isValidAnimationMotionFrame,
} from "./AnimationMotionPlanValidation";
import type {
  AnimationGenerationResult,
  AnimationGenerationSuccess,
  AnimationProvider,
  AnimationRequestIdentity,
} from "./providers/AnimationProvider";
import { AnimationProviderRouter } from "./providers/AnimationProviderRouter";
import { AnimationStorage } from "./AnimationStorage";
import {
  AnimationMotionPlanError,
  sanitizeAnimationProviderDiagnosticMetadata,
} from "./AnimationMotionPlanError";
import type { AnimationFailurePhase } from "@/types/animationError";

const MOTION_PLAN_MIME_TYPE = "application/vnd.atolye.motion-plan+json";
const DEFAULT_DURATION_SECONDS = 6;
const IMAGE_MIME_TYPES = new Set<ImageMimeType>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export { AnimationMotionPlanError } from "./AnimationMotionPlanError";

type GenerateAnimationAssetsInput = {
  projectId: string;
  projectSlug: string;
  scenes: AnimationScene[];
  provider?: AnimationProvider;
};

export type AnimationAssetPipelineResult = {
  projectAssets: ProjectAssets;
  updatedScenes: AnimationMotionPlanScene[];
};

type PreparedScene = {
  scene: AnimationScene;
  sourceImageAssetId: string;
  durationSeconds: number;
};

export class AnimationAssetPipeline {
  static async generateAnimationAssets({
    projectId,
    projectSlug,
    scenes,
    provider,
  }: GenerateAnimationAssetsInput): Promise<AnimationAssetPipelineResult> {
    const storedPaths: string[] = [];
    let activeSceneId = 0;
    let activePhase: AnimationFailurePhase = "input-validation";
    try {
      validateSceneBatch(scenes);
      activePhase = "asset-preflight";
      const selectedProvider = provider ?? AnimationProviderRouter.getProvider();
      const providerName = requireProviderName(selectedProvider);
      const generationMode: "mock" | "production" =
        providerName === "mock" ? "mock" : "production";
      const currentAssets = AssetManager.getProjectAssets(projectSlug, projectId);
      const preparedScenes = prepareScenes(
        scenes,
        currentAssets.assets,
        projectId,
        projectSlug,
        providerName,
      );
      const plans: AnimationGenerationSuccess[] = [];
      const identities: Array<AnimationRequestIdentity | null> = [];
      const replayAssets: Array<Asset | null> = [];
      const identityIds = new Set<string>();

      for (const prepared of preparedScenes) {
        activeSceneId = prepared.scene.sceneId;
        activePhase = "provider-request";
        const input = {
          sceneId: prepared.scene.sceneId,
          animationPrompt: prepared.scene.animationPrompt,
          sourceImageAssetId: prepared.sourceImageAssetId,
          durationSeconds: prepared.durationSeconds,
        };
        const identity = generationMode === "production"
          ? selectedProvider.getRequestIdentity?.(input)
          : null;
        if (
          generationMode === "production" &&
          (!identity || identityIds.has(identity.assetId))
        ) throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
          sceneId: activeSceneId,
          phase: "provider-request",
          provider: providerName,
          reason: "REQUEST_IDENTITY_INVALID",
        });
        if (identity) identityIds.add(identity.assetId);
        identities.push(identity ?? null);
        const matches = identity
          ? currentAssets.assets.filter((asset) => asset.id === identity.assetId)
          : [];
        if (matches.length > 1) throw new AnimationMotionPlanError(
          "ANIMATION_MOTION_PLAN_FAILED",
          { sceneId: activeSceneId, phase: "asset-preflight", provider: providerName, reason: "REPLAY_ASSET_DUPLICATE" },
        );
        if (matches.length === 1 && identity) {
          plans.push(requireReplayPlan(
            matches[0], identity, prepared, projectId, projectSlug,
          ));
          replayAssets.push(matches[0]);
          continue;
        }
        if (identity && AnimationStorage.motionPlanTargetExists(projectSlug, identity.assetId)) {
          throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
            sceneId: activeSceneId,
            phase: "asset-preflight",
            provider: providerName,
            reason: "MOTION_PLAN_TARGET_CONFLICT",
          });
        }
        const result = await selectedProvider.generateAnimation(input);
        if (providerName === "openai") {
          await persistProviderUsage(projectSlug, prepared.scene, result);
        }
        activePhase = "plan-validation";
        plans.push(
          requireValidPlan(
            result,
            providerName,
            generationMode,
            prepared.scene.sceneId,
            prepared.sourceImageAssetId,
            prepared.durationSeconds,
            identity,
          ),
        );
        replayAssets.push(null);
      }

      const createdAssets: Asset[] = [];
      const locators = new Set<string>();
      const updatedScenes = preparedScenes.map((prepared, index) => {
        activeSceneId = prepared.scene.sceneId;
        activePhase = "persistence";
        const plan = plans[index];
        const identity = identities[index];
        const replayAsset = replayAssets[index];
        if (replayAsset) {
          return updatedScene(prepared, plan, replayAsset, generationMode);
        }
        let asset = AssetManager.createAsset({
          id: identity?.assetId,
          projectId,
          projectSlug,
          sceneId: prepared.scene.sceneId,
          type: "animation",
          status: "generated",
          provider: plan.provider,
          model: plan.model,
          prompt: prepared.scene.animationPrompt,
          mimeType: MOTION_PLAN_MIME_TYPE,
          durationSeconds: plan.durationSeconds,
          artifactType: "motion-plan",
          sourceAssetId: plan.sourceImageAssetId,
          generationMode,
        });
        if (generationMode === "production") {
          const stored = AnimationStorage.saveMotionPlan(projectSlug, {
            schemaVersion: "1",
            artifactType: "motion-plan",
            assetId: asset.id,
            sceneId: prepared.scene.sceneId,
            sourceImageAssetId: plan.sourceImageAssetId,
            durationSeconds: plan.durationSeconds,
            provider: "openai",
            model: plan.model as string,
            generationMode: "production",
            requestIdentity: identity?.requestIdentity as string,
            promptDigest: identity?.promptDigest as string,
            motionType: plan.motionType,
            start: plan.start,
            end: plan.end,
            transition: plan.transition,
          });
          if (locators.has(stored.filePath)) throw new AnimationMotionPlanError(
            "ANIMATION_MOTION_PLAN_FAILED",
            { sceneId: activeSceneId, phase: "persistence", provider: providerName, reason: "MOTION_PLAN_LOCATOR_DUPLICATE" },
          );
          locators.add(stored.filePath);
          storedPaths.push(stored.filePath);
          asset = {
            ...asset,
            filePath: stored.filePath,
            mimeType: stored.mimeType,
            byteLength: stored.byteLength,
          };
        }
        createdAssets.push(asset);
        return updatedScene(prepared, plan, asset, generationMode);
      });
      const projectAssets = createdAssets.length === 0
        ? currentAssets
        : (generationMode === "production"
          ? AssetManager.saveProjectAssetsAtomically(projectSlug, {
            ...currentAssets,
            projectId,
            projectSlug: currentAssets.projectSlug ?? projectSlug,
            assets: [...currentAssets.assets, ...createdAssets],
            updatedAt: new Date().toISOString(),
          })
          : AssetManager.saveProjectAssets(projectSlug, {
              ...currentAssets,
              projectId,
              projectSlug: currentAssets.projectSlug ?? projectSlug,
              assets: [...currentAssets.assets, ...createdAssets],
              updatedAt: new Date().toISOString(),
            }));

      return { projectAssets, updatedScenes };
    } catch (error) {
      for (const filePath of storedPaths) {
        AnimationStorage.removeMotionPlanIfExists(projectSlug, filePath);
      }
      if (error instanceof AnimationMotionPlanError) throw error;
      throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
        sceneId: activeSceneId,
        phase: activePhase,
        reason: "UNKNOWN_EXCEPTION",
      });
    }
  }
}

function updatedScene(
  prepared: PreparedScene,
  plan: AnimationGenerationSuccess,
  asset: Asset,
  generationMode: "mock" | "production",
): AnimationMotionPlanScene {
  return {
    ...prepared.scene,
    sourceImageAssetId: plan.sourceImageAssetId,
    outputAssetId: asset.id,
    animationAssetId: asset.id,
    durationSeconds: plan.durationSeconds,
    motionType: plan.motionType,
    start: plan.start,
    end: plan.end,
    transition: plan.transition,
    provider: plan.provider,
    model: plan.model,
    generationMode,
    artifactType: "motion-plan",
    status: "generated",
  };
}

function requireReplayPlan(
  asset: Asset,
  identity: AnimationRequestIdentity,
  prepared: PreparedScene,
  projectId: string,
  projectSlug: string,
): AnimationGenerationSuccess {
  if (
    asset.id !== identity.assetId || asset.projectId !== projectId ||
    asset.projectSlug !== projectSlug || asset.sceneId !== prepared.scene.sceneId ||
    asset.type !== "animation" || asset.status !== "generated" ||
    asset.artifactType !== "motion-plan" || asset.mimeType !== MOTION_PLAN_MIME_TYPE ||
    asset.sourceAssetId !== prepared.sourceImageAssetId ||
    asset.prompt !== prepared.scene.animationPrompt || asset.durationSeconds !== prepared.durationSeconds ||
    asset.provider !== "openai" || asset.model !== identity.model ||
    asset.generationMode !== "production" || typeof asset.filePath !== "string" ||
    asset.url !== undefined || !Number.isSafeInteger(asset.byteLength) || (asset.byteLength as number) <= 0
  ) throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
    sceneId: prepared.scene.sceneId,
    phase: "asset-preflight",
    provider: "openai",
    model: identity.model,
    reason: "REPLAY_ASSET_CONTRACT_INVALID",
  });
  let inspection: ReturnType<typeof AnimationStorage.inspectStoredMotionPlan>;
  try {
    inspection = AnimationStorage.inspectStoredMotionPlan(projectSlug, asset.filePath);
  } catch {
    throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
      sceneId: prepared.scene.sceneId,
      phase: "asset-preflight",
      provider: "openai",
      model: identity.model,
      reason: "REPLAY_ASSET_INSPECTION_FAILED",
    });
  }
  const stored = inspection.artifact;
  if (
    inspection.byteLength !== asset.byteLength || stored.assetId !== identity.assetId ||
    stored.requestIdentity !== identity.requestIdentity ||
    stored.promptDigest !== identity.promptDigest || stored.sceneId !== prepared.scene.sceneId ||
    stored.sourceImageAssetId !== prepared.sourceImageAssetId ||
    stored.durationSeconds !== prepared.durationSeconds || stored.model !== identity.model
  ) throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
    sceneId: prepared.scene.sceneId,
    phase: "asset-preflight",
    provider: "openai",
    model: identity.model,
    reason: "REPLAY_ARTIFACT_MISMATCH",
  });
  return {
    success: true,
    sceneId: stored.sceneId,
    sourceImageAssetId: stored.sourceImageAssetId,
    provider: "openai",
    model: stored.model,
    generationMode: "production",
    requestIdentity: stored.requestIdentity,
    artifactType: "motion-plan",
    status: "generated",
    durationSeconds: stored.durationSeconds,
    motionType: stored.motionType,
    start: stored.start,
    end: stored.end,
    transition: stored.transition,
  };
}

export async function generateAnimationAssets(
  input: GenerateAnimationAssetsInput,
): Promise<AnimationAssetPipelineResult> {
  return AnimationAssetPipeline.generateAnimationAssets(input);
}

function validateSceneBatch(scenes: AnimationScene[]) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
      sceneId: 0,
      phase: "input-validation",
      reason: "SCENE_BATCH_INVALID",
    });
  }

  const sceneIds = new Set<number>();

  for (const scene of scenes) {
    const sceneId = (scene as { sceneId?: unknown } | null)?.sceneId;
    const prompt = (scene as { animationPrompt?: unknown } | null)
      ?.animationPrompt;

    if (
      !Number.isSafeInteger(sceneId) ||
      (sceneId as number) <= 0 ||
      sceneIds.has(sceneId as number) ||
      typeof prompt !== "string" ||
      !prompt.trim()
    ) {
      throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
        sceneId: Number.isSafeInteger(sceneId) && (sceneId as number) > 0 ? sceneId as number : 0,
        phase: "input-validation",
        reason: "SCENE_INPUT_INVALID",
      });
    }

    const duration = (scene as { durationSeconds?: unknown }).durationSeconds;
    if (duration !== undefined && !isValidAnimationDuration(duration)) {
      throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
        sceneId: sceneId as number,
        phase: "input-validation",
        reason: "SCENE_DURATION_INVALID",
      });
    }
    sceneIds.add(sceneId as number);
  }
}

function prepareScenes(
  scenes: AnimationScene[],
  assets: Asset[],
  projectId: string,
  projectSlug: string,
  providerName: string,
): PreparedScene[] {
  const sourceIds = new Set<string>();

  return scenes.map((scene) => {
    const candidates = assets.filter(
      (asset) =>
        asset.projectId === projectId &&
        asset.projectSlug === projectSlug &&
        asset.sceneId === scene.sceneId &&
        asset.type === "image" &&
        asset.status === "generated",
    );

    if (candidates.length === 0) {
      throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
        sceneId: scene.sceneId,
        phase: "asset-preflight",
        provider: providerName,
        reason: "SOURCE_IMAGE_MISSING",
      });
    }

    const source = candidates[candidates.length - 1];
    validateSourceImage(source, projectSlug, providerName);

    if (!source.id || sourceIds.has(source.id)) {
      throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
        sceneId: scene.sceneId,
        phase: "asset-preflight",
        provider: providerName,
        reason: "SOURCE_IMAGE_IDENTITY_INVALID",
      });
    }
    sourceIds.add(source.id);

    return {
      scene,
      sourceImageAssetId: source.id,
      durationSeconds: scene.durationSeconds ?? DEFAULT_DURATION_SECONDS,
    };
  });
}

function validateSourceImage(asset: Asset, projectSlug: string, providerName: string) {
  const metadata = {
    sceneId: asset.sceneId ?? 0,
    phase: "asset-preflight" as const,
    provider: providerName,
  };
  if (asset.provider === "mock") {
    if (
      asset.mimeType !== "image/mock" ||
      asset.filePath !== "" ||
      asset.url !== ""
    ) {
      throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
        ...metadata,
        reason: "MOCK_SOURCE_IMAGE_INVALID",
      });
    }
    return;
  }

  if (
    typeof asset.mimeType !== "string" ||
    !IMAGE_MIME_TYPES.has(asset.mimeType as ImageMimeType) ||
    typeof asset.filePath !== "string" ||
    typeof asset.url !== "string"
  ) {
    throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
      ...metadata,
      reason: "SOURCE_IMAGE_CONTRACT_INVALID",
    });
  }

  const fileName = path.posix.basename(asset.filePath);
  let inspection: ReturnType<typeof ImageStorage.inspectStoredImage>;
  try {
    inspection = ImageStorage.inspectStoredImage(
      projectSlug,
      asset.filePath,
      asset.mimeType as ImageMimeType,
    );
  } catch {
    throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
      ...metadata,
      reason: "SOURCE_IMAGE_INSPECTION_FAILED",
    });
  }

  if (
    inspection.byteLength <= 0 ||
    asset.url !== ImageStorage.getImageUrl(projectSlug, fileName)
  ) {
    throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
      ...metadata,
      reason: "SOURCE_IMAGE_ASSET_MISMATCH",
    });
  }
}

function requireProviderName(provider: AnimationProvider) {
  const name = provider.name;

  if (name !== "mock" && name !== "openai") {
    throw new AnimationMotionPlanError("ANIMATION_MOTION_PLAN_FAILED", {
      sceneId: 0,
      phase: "input-validation",
      reason: "PROVIDER_IDENTITY_INVALID",
    });
  }
  return name;
}

function requireValidPlan(
  value: unknown,
  providerName: string,
  generationMode: "mock" | "production",
  sceneId: number,
  sourceImageAssetId: string,
  durationSeconds: number,
  identity: AnimationRequestIdentity | null = null,
): AnimationGenerationSuccess {
  const result = value as AnimationGenerationResult;
  if (result && typeof result === "object" && result.success === false) {
    throw new AnimationMotionPlanError(result.error, {
      sceneId,
      phase: result.diagnostic?.phase ?? "provider-response",
      provider: result.provider || providerName,
      ...(result.model ? { model: result.model } : {}),
      ...(result.diagnostic ?? {}),
      reason: result.diagnostic?.reason ?? result.error,
    });
  }
  const plan = value as AnimationGenerationSuccess & Record<string, unknown>;

  if (
    !plan ||
    typeof plan !== "object" ||
    plan.success !== true ||
    plan.artifactType !== "motion-plan" ||
    plan.status !== "generated" ||
    plan.sceneId !== sceneId ||
    plan.sourceImageAssetId !== sourceImageAssetId ||
    plan.provider !== providerName ||
    plan.durationSeconds !== durationSeconds ||
    !isValidAnimationDuration(plan.durationSeconds) ||
    !animationMotionTypes.includes(plan.motionType) ||
    !animationTransitionTypes.includes(plan.transition) ||
    !isValidAnimationMotionFrame(plan.start) ||
    !isValidAnimationMotionFrame(plan.end) ||
    plan.filePath !== undefined ||
    plan.url !== undefined ||
    plan.mimeType !== undefined ||
    plan.error !== undefined ||
    plan.generationMode !== generationMode
  ) {
    throw new AnimationMotionPlanError("ANIMATION_RESPONSE_SCHEMA_INVALID", {
      sceneId,
      phase: "plan-validation",
      provider: providerName,
      ...(typeof plan?.model === "string" ? { model: plan.model } : {}),
      reason: "PROVIDER_RESULT_CONTRACT_INVALID",
      ...(plan?.diagnostic ?? {}),
    });
  }

  if (
    generationMode === "production" &&
    (
      !identity ||
      plan.requestIdentity !== identity.requestIdentity ||
      plan.model !== identity.model ||
      typeof plan.model !== "string" ||
      !/^[a-zA-Z0-9._:-]{1,200}$/.test(plan.model)
    )
  ) throw new AnimationMotionPlanError("ANIMATION_RESPONSE_SCHEMA_INVALID", {
    sceneId,
    phase: "plan-validation",
    provider: providerName,
    ...(typeof plan?.model === "string" ? { model: plan.model } : {}),
    reason: "PROVIDER_IDENTITY_INVALID",
    ...(plan?.diagnostic ?? {}),
  });

  return plan;
}

async function persistProviderUsage(
  projectSlug: string,
  scene: AnimationScene,
  result: AnimationGenerationResult,
) {
  const metadata = sanitizeAnimationProviderDiagnosticMetadata({
    sceneId: scene.sceneId,
    phase: result.diagnostic?.phase ?? (result.success ? "provider-response" : "unknown"),
    provider: "openai",
    ...(result.model ? { model: result.model } : {}),
    ...(result.diagnostic ?? {}),
  });
  await AIUsageManager.appendRecord({
    id: crypto.randomUUID(),
    projectSlug,
    stage: "animation",
    operation: `animation-motion-plan-scene-${scene.sceneId}`,
    provider: "openai",
    model: metadata.model,
    status: result.success ? "success" : "failed",
    fallbackUsed: false,
    durationMs: metadata?.durationMs ?? 0,
    promptLength: scene.animationPrompt.length,
    responseLength: metadata?.responseLength,
    finishReason: metadata?.finishReason,
    promptTokens: metadata?.promptTokens,
    completionTokens: metadata?.completionTokens,
    totalTokens: metadata?.totalTokens,
    error: result.success ? undefined : result.error,
    errorCode: result.success ? undefined : result.error,
    sceneId: scene.sceneId,
    phase: metadata?.phase ?? (result.success ? "provider-response" : "unknown"),
    httpStatus: metadata?.httpStatus,
    retryCount: metadata?.retryCount,
    issueCount: metadata?.issueCount,
    schemaIssues: metadata?.schemaIssues,
    createdAt: new Date().toISOString(),
  });
}
