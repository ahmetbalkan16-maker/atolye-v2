import type { MediaOrigin, MediaRightsStatus, MediaType } from "@/types/asset";
import {
  classifyMediaRightsStatus,
  isProductionAdmissibleRightsStatus,
} from "./MediaRightsPolicy";

/**
 * Documentary media effort, Faz 1 — the single, explicit policy point for how
 * many AI-generated images a production visuals batch may contain.
 *
 * This is NOT scene-count-relative: for ANY number of scenes, at most
 * `maxAiImages` of them may fall back to an AI image. Every other scene must be
 * covered by admissible real media, or the visuals stage fails closed
 * (`VisualMediaAiBudgetExceededError`) — the pipeline never silently generates
 * unbounded AI images. For a 16-scene run this means <= 4 AI images and >= 12
 * real-media scenes (or the run fails).
 *
 * The default ceiling (`4`) is deliberately strict. An operator running a real
 * documentary render whose topic has limited archival coverage can raise it for
 * that render with `ATOLYE_MAX_AI_IMAGES` (a non-negative integer, or
 * `unbounded`) — see `resolveMaxAiImages`. The env value is conditional in the
 * acceptance configuration fingerprint, exactly like the other `ATOLYE_*`
 * real-media knobs.
 */
export const visualMediaAdmissionPolicy = Object.freeze({
  maxAiImages: 4,
});

/**
 * Explicit "no cap" sentinel. The batch cap is deliberately opt-in per call site
 * (`VisualAssetPipeline.generateAssets`'s `maxAiImages` input defaults to this):
 * the production wiring in `PipelineStageExecutor` passes
 * `visualMediaAdmissionPolicy.maxAiImages`, while the studio UI's single-scene
 * regeneration and the smoke fixtures - neither of which runs a large AI batch -
 * stay uncapped.
 */
export const UNBOUNDED_AI_IMAGES = Number.POSITIVE_INFINITY;

/**
 * The effective per-render AI-image ceiling. Defaults to
 * `visualMediaAdmissionPolicy.maxAiImages` (4); an operator overrides it for a
 * specific render with `ATOLYE_MAX_AI_IMAGES`:
 *  - a non-negative integer — that many AI images are allowed, or
 *  - `unbounded` / `off` — no cap (`UNBOUNDED_AI_IMAGES`); every scene without
 *    admissible real media falls back to AI instead of failing the stage.
 *
 * An unset, empty, or malformed value falls back to the strict default — the
 * override never loosens the cap by accident.
 */
export function resolveMaxAiImages(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ATOLYE_MAX_AI_IMAGES?.trim().toLowerCase();
  if (!raw) return visualMediaAdmissionPolicy.maxAiImages;
  if (raw === "unbounded" || raw === "off" || raw === "none") return UNBOUNDED_AI_IMAGES;
  if (!/^[0-9]+$/.test(raw)) return visualMediaAdmissionPolicy.maxAiImages;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : visualMediaAdmissionPolicy.maxAiImages;
}

const SAFE_AI_BUDGET_ERROR =
  "The production AI-image budget was reached and no admissible real media was available for the remaining scene.";

/**
 * Deterministic, fail-closed stop: a scene needed an AI image (no admissible
 * real media, or an operator "ai" override) but the production AI-image budget
 * (`visualMediaAdmissionPolicy.maxAiImages`) was already spent. The visuals
 * stage — and, from Faz 3, `selectSceneMedia` — fails loudly here rather than
 * silently generating an unbounded number of AI images.
 *
 * Lives in the policy module (not `VisualAssetPipeline`) so the scene-media
 * selector can throw the exact same error without importing the whole pipeline;
 * `VisualAssetPipeline` re-exports it for backward compatibility.
 */
export class VisualMediaAiBudgetExceededError extends Error {
  readonly code = "VISUAL_AI_IMAGE_BUDGET_EXCEEDED";
  readonly reasonCode = "VISUAL_AI_IMAGE_BUDGET_EXCEEDED";

  constructor(readonly maxAiImages: number, readonly sceneId: number) {
    super(SAFE_AI_BUDGET_ERROR);
    this.name = "VisualMediaAiBudgetExceededError";
    this.stack = undefined;
  }
}

/**
 * Is a real-media candidate usable for a production render? Only confirmed-free
 * licences (`public-domain` / `open-license` / `verified`) pass; anything
 * `unknown` / `restricted` is treated as "no real media found" so it falls back
 * to AI (subject to the cap) or fails the scene - never pulled in silently.
 * Reuses `MediaRightsPolicy` - no duplicate licence logic here.
 */
export function isRealMediaAdmissible(license: string | null | undefined): boolean {
  return isProductionAdmissibleRightsStatus(classifyMediaRightsStatus(license));
}

export type ResolvedMediaProvenance = {
  readonly mediaOrigin: MediaOrigin;
  readonly mediaType: MediaType;
  readonly rightsStatus?: MediaRightsStatus;
  readonly selectionReason: string;
};

export type VisualMediaSelectionReason =
  | "archive-photo-match"
  | "no-suitable-real-media-found"
  | "operator-forced-ai"
  | "local-generated-placeholder"
  | "mock";

/**
 * Honest provenance for a persisted visual asset, derived from what actually
 * produced it - never model-authored, never guessed.
 *
 *  - real provider  -> `mediaOrigin: "real"`, `mediaType: "photo"`,
 *    `rightsStatus` classified from the source licence (so a candidate that
 *    arrived without usable licence metadata is honestly `unknown`, never
 *    auto-`verified`).
 *  - openai / mock / local -> `mediaOrigin: "ai"`, `mediaType: "ai-image"`,
 *    `rightsStatus` left undefined. A `local` placeholder is a synthesised
 *    (non-photographic, self-generated) image with no real-media source licence,
 *    so it shares the "not real media" bucket; its `selectionReason` records that
 *    it is specifically a local placeholder.
 */
export function resolveMediaProvenance(input: {
  readonly provider: "real" | "openai" | "mock" | "local";
  readonly license?: string | null;
  readonly reason: VisualMediaSelectionReason;
}): ResolvedMediaProvenance {
  if (input.provider === "real") {
    return {
      mediaOrigin: "real",
      mediaType: "photo",
      rightsStatus: classifyMediaRightsStatus(input.license),
      selectionReason: input.reason,
    };
  }
  return {
    mediaOrigin: "ai",
    mediaType: "ai-image",
    selectionReason: input.reason,
  };
}
