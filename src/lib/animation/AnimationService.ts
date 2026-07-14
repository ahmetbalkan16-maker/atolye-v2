import type { AnimationData, AnimationScene } from "@/types/animation";
import { isCompatibleAnimationData } from "./AnimationMotionPlanValidation";
import type { Asset } from "@/types/asset";
import type { SceneData } from "@/types/scene";
import type { VisualData } from "@/types/visual";

type AnimationServiceOptions = {
  endpoint?: string;
  fetcher?: typeof fetch;
};

type AnimationServiceBaseInput = AnimationServiceOptions & {
  projectId: string;
  projectSlug: string;
};

export type GenerateAnimationsFromSceneVisualInput =
  AnimationServiceBaseInput & {
    scenes: SceneData;
    visuals: VisualData;
    style?: string;
  };

export type GenerateAnimationsFromAnimationDataInput =
  AnimationServiceBaseInput & {
    animationData: AnimationData;
  };

export type GenerateAnimationsFromScenesInput =
  AnimationServiceBaseInput & {
    scenes: AnimationScene[];
    sceneId?: number;
  };

export type RegenerateSceneAnimationInput = AnimationServiceBaseInput & {
  scenes: SceneData;
  visuals: VisualData;
  sceneId: number;
  style?: string;
};

export type AnimationServiceResult = {
  animationData: AnimationData | null;
  assets: Asset[];
};

type AnimationApiResponse = {
  success?: boolean;
  animationData?: AnimationData | null;
  assets?: Asset[];
  error?: string;
};

type AnimationApiPayload =
  | {
      projectId: string;
      projectSlug: string;
      scenes: SceneData;
      visuals: VisualData;
      style?: string;
      sceneId?: number;
    }
  | {
      projectId: string;
      projectSlug: string;
      animationData: AnimationData;
      sceneId?: number;
    }
  | {
      projectId: string;
      projectSlug: string;
      scenes: AnimationScene[];
      sceneId?: number;
    };

const defaultEndpoint = "/api/animations";

export class AnimationService {
  /** Generates animation prompts from SceneData + VisualData through the animation API. */
  static async generateFromSceneVisualData({
    projectId,
    projectSlug,
    scenes,
    visuals,
    style,
    endpoint,
    fetcher,
  }: GenerateAnimationsFromSceneVisualInput): Promise<AnimationServiceResult> {
    return this.requestAnimations(
      {
        projectId,
        projectSlug,
        scenes,
        visuals,
        style,
      },
      {
        endpoint,
        fetcher,
      },
    );
  }

  /** Sends prepared AnimationData to the animation API and returns generated assets. */
  static async generateFromAnimationData({
    projectId,
    projectSlug,
    animationData,
    endpoint,
    fetcher,
  }: GenerateAnimationsFromAnimationDataInput): Promise<AnimationServiceResult> {
    return this.requestAnimations(
      {
        projectId,
        projectSlug,
        animationData,
      },
      {
        endpoint,
        fetcher,
      },
    );
  }

  /** Sends prepared AnimationScene items to the animation API using the legacy-compatible flow. */
  static async generateFromAnimationScenes({
    projectId,
    projectSlug,
    scenes,
    sceneId,
    endpoint,
    fetcher,
  }: GenerateAnimationsFromScenesInput): Promise<AnimationServiceResult> {
    return this.requestAnimations(
      {
        projectId,
        projectSlug,
        scenes,
        sceneId,
      },
      {
        endpoint,
        fetcher,
      },
    );
  }

  /** Regenerates animation for a single scene through the animation API. */
  static async regenerateSceneAnimation({
    projectId,
    projectSlug,
    scenes,
    visuals,
    sceneId,
    style,
    endpoint,
    fetcher,
  }: RegenerateSceneAnimationInput): Promise<AnimationServiceResult> {
    return this.requestAnimations(
      {
        projectId,
        projectSlug,
        scenes,
        visuals,
        sceneId,
        style,
      },
      {
        endpoint,
        fetcher,
      },
    );
  }

  private static async requestAnimations(
    payload: AnimationApiPayload,
    options: AnimationServiceOptions = {},
  ): Promise<AnimationServiceResult> {
    const request = options.fetcher ?? fetch;
    const response = await request(options.endpoint ?? defaultEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as AnimationApiResponse;

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Animation service request failed.");
    }

    return {
      animationData: isCompatibleAnimationData(data.animationData)
        ? data.animationData
        : null,
      assets: isAssets(data.assets) ? data.assets : [],
    };
  }
}

/** Generates animations from SceneData + VisualData through the shared animation service. */
export async function generateAnimationsFromSceneVisualData(
  input: GenerateAnimationsFromSceneVisualInput,
): Promise<AnimationServiceResult> {
  return AnimationService.generateFromSceneVisualData(input);
}

/** Sends prepared AnimationData through the shared animation service. */
export async function generateAnimationsFromAnimationData(
  input: GenerateAnimationsFromAnimationDataInput,
): Promise<AnimationServiceResult> {
  return AnimationService.generateFromAnimationData(input);
}

/** Sends prepared AnimationScene items through the shared animation service. */
export async function generateAnimationsFromAnimationScenes(
  input: GenerateAnimationsFromScenesInput,
): Promise<AnimationServiceResult> {
  return AnimationService.generateFromAnimationScenes(input);
}

/** Regenerates animation for a single scene through the shared animation service. */
export async function regenerateSceneAnimation(
  input: RegenerateSceneAnimationInput,
): Promise<AnimationServiceResult> {
  return AnimationService.regenerateSceneAnimation(input);
}

function isAssets(value: unknown): value is Asset[] {
  return (
    Array.isArray(value) &&
    value.every(
      (asset) =>
        Boolean(asset) &&
        typeof asset === "object" &&
        typeof (asset as Asset).id === "string" &&
        typeof (asset as Asset).projectId === "string" &&
        typeof (asset as Asset).type === "string" &&
        typeof (asset as Asset).status === "string" &&
        typeof (asset as Asset).provider === "string" &&
        typeof (asset as Asset).prompt === "string" &&
        typeof (asset as Asset).createdAt === "string",
    )
  );
}
