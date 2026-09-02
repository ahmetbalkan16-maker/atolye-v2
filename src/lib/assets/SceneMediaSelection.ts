import type { ResearchMediaCandidate } from "@/types/research";
import type { VisualScene } from "@/types/visual";
import {
  compareResearchMediaCandidates,
  scoreSceneMediaOverlap,
} from "./ResearchMediaDiscovery";
import {
  VisualMediaAiBudgetExceededError,
  visualMediaAdmissionPolicy,
} from "./VisualMediaAdmissionPolicy";

/**
 * Documentary media effort — Faz 3 (ADR-020): the deterministic per-scene media
 * ladder.
 *
 * For each scene, in scene order, pick the best available source:
 *   1. an admissible real **video** candidate that overlaps the scene, else
 *   2. an admissible real **photo/archive** candidate that overlaps the scene, else
 *   3. an AI image.
 *
 * Rules:
 *  - A candidate is assigned to at most one scene (no cross-scene reuse).
 *  - This selector NEVER relaxes the Faz 1 cap. It only decides *which* scenes
 *    fall through to AI; if that count would exceed `maxAiImages` the selection
 *    fails closed with the exact same `VisualMediaAiBudgetExceededError` the
 *    visuals stage throws.
 *  - Pure and deterministic: same scenes + same candidates → same plan.
 *
 * Foundation only — not wired into the pipeline yet (Faz 6). It reuses the Faz 2
 * overlap scorer and candidate ordering so research matching and this ladder
 * rank identically.
 */

export type SceneMediaKind = "real-video" | "real-photo" | "ai-image";

export interface SceneMediaAssignment {
  readonly sceneId: number;
  readonly kind: SceneMediaKind;
  /** The chosen candidate for a `real-video` / `real-photo` scene. */
  readonly candidate?: ResearchMediaCandidate;
  /** Bounded, non-model reason string (mirrors `Asset.selectionReason`). */
  readonly reason: string;
}

export interface SceneMediaPlan {
  readonly assignments: readonly SceneMediaAssignment[];
  readonly realVideoScenes: number;
  readonly realPhotoScenes: number;
  readonly aiImageScenes: number;
  readonly maxAiImages: number;
  /** Ids of every candidate consumed by the plan, in assignment order. */
  readonly usedCandidateIds: readonly string[];
}

export interface SelectSceneMediaInput {
  readonly scenes: readonly VisualScene[];
  readonly candidates: readonly ResearchMediaCandidate[];
  /**
   * AI-image ceiling. Defaults to `visualMediaAdmissionPolicy.maxAiImages` (4) —
   * the same value the production wiring passes to `VisualAssetPipeline`.
   */
  readonly maxAiImages?: number;
}

const REAL_VIDEO_REASON = "archive-video-match";
const REAL_PHOTO_REASON = "archive-photo-match";
const AI_REASON = "no-suitable-real-media-found";

export function selectSceneMedia(input: SelectSceneMediaInput): SceneMediaPlan {
  const maxAiImages = normalizeMax(input.maxAiImages);

  const videoPool = admissiblePool(input.candidates, (candidate) => candidate.mediaType === "video");
  const photoPool = admissiblePool(
    input.candidates,
    (candidate) => candidate.mediaType !== "video" && candidate.mediaType !== "ai-image",
  );

  const used = new Set<string>();
  const usedCandidateIds: string[] = [];
  const assignments: SceneMediaAssignment[] = [];
  const aiSceneIds: number[] = [];

  for (const scene of input.scenes) {
    const video = bestUnusedMatch(scene, videoPool, used);
    if (video) {
      used.add(video.id);
      usedCandidateIds.push(video.id);
      assignments.push({ sceneId: scene.sceneId, kind: "real-video", candidate: video, reason: REAL_VIDEO_REASON });
      continue;
    }

    const photo = bestUnusedMatch(scene, photoPool, used);
    if (photo) {
      used.add(photo.id);
      usedCandidateIds.push(photo.id);
      assignments.push({ sceneId: scene.sceneId, kind: "real-photo", candidate: photo, reason: REAL_PHOTO_REASON });
      continue;
    }

    aiSceneIds.push(scene.sceneId);
    assignments.push({ sceneId: scene.sceneId, kind: "ai-image", reason: AI_REASON });
  }

  if (aiSceneIds.length > maxAiImages) {
    // Fail closed on the first scene that pushes past the ceiling — identical to
    // how `VisualAssetPipeline` reports the budget stop.
    throw new VisualMediaAiBudgetExceededError(maxAiImages, aiSceneIds[maxAiImages]);
  }

  return {
    assignments,
    realVideoScenes: assignments.filter((entry) => entry.kind === "real-video").length,
    realPhotoScenes: assignments.filter((entry) => entry.kind === "real-photo").length,
    aiImageScenes: aiSceneIds.length,
    maxAiImages,
    usedCandidateIds,
  };
}

/**
 * Faz 6: turn a plan into `VisualAssetPipeline` per-scene overrides. A scene the
 * ladder assigned to real media forces the real-photo attempt (`"real"`); a
 * scene with no admissible real media forces the AI path (`"ai"`) so the cap is
 * spent predictably. Explicit operator/studio overrides win over the ladder.
 *
 * (Real *video* scenes also map to `"real"` here — per-scene real-video
 * substitution in the image→animation→video chain is a separate follow-up; until
 * then a real-video-matched scene still tries a real photo, then AI.)
 */
export function sceneMediaSelectionOverrides(
  plan: SceneMediaPlan,
  existing?: Readonly<Record<number, "ai" | "real">>,
  options?: { readonly skipAiImageScenes?: boolean },
): Record<number, "ai" | "real"> {
  const overrides: Record<number, "ai" | "real"> = { ...(existing ?? {}) };
  for (const entry of plan.assignments) {
    if (entry.sceneId in overrides) continue;
    if (entry.kind === "ai-image") {
      // With the local $0 placeholder enabled, an unmatched scene is left
      // un-forced so it still tries a live per-scene archival search before the
      // placeholder stands in — only ladder-matched real scenes are forced.
      if (options?.skipAiImageScenes) continue;
      overrides[entry.sceneId] = "ai";
    } else {
      overrides[entry.sceneId] = "real";
    }
  }
  return overrides;
}

/**
 * Group the plan into a compact per-kind summary — handy for a cost estimate
 * (real media = 0 AI calls, AI images = one image request each).
 */
export function summarizeSceneMediaPlan(plan: SceneMediaPlan): {
  readonly totalScenes: number;
  readonly realMediaScenes: number;
  readonly aiImageScenes: number;
  readonly aiImageBudget: number;
  readonly withinAiBudget: boolean;
} {
  const totalScenes = plan.assignments.length;
  return {
    totalScenes,
    realMediaScenes: plan.realVideoScenes + plan.realPhotoScenes,
    aiImageScenes: plan.aiImageScenes,
    aiImageBudget: plan.maxAiImages,
    withinAiBudget: plan.aiImageScenes <= plan.maxAiImages,
  };
}

// --------------------------------------------------------------------------- internals

function admissiblePool(
  candidates: readonly ResearchMediaCandidate[],
  extra: (candidate: ResearchMediaCandidate) => boolean,
): ResearchMediaCandidate[] {
  return candidates
    .filter((candidate) => candidate.admissible && Boolean(candidate.sourceUrl) && extra(candidate))
    .slice()
    .sort(compareResearchMediaCandidates);
}

function bestUnusedMatch(
  scene: VisualScene,
  pool: readonly ResearchMediaCandidate[],
  used: ReadonlySet<string>,
): ResearchMediaCandidate | undefined {
  let best: { candidate: ResearchMediaCandidate; score: number } | undefined;
  for (const candidate of pool) {
    if (used.has(candidate.id)) continue;
    const score = scoreSceneMediaOverlap(scene, candidate);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { candidate, score };
  }
  return best?.candidate;
}

function normalizeMax(value: number | undefined): number {
  if (value === undefined) return visualMediaAdmissionPolicy.maxAiImages;
  if (value === Number.POSITIVE_INFINITY) return value;
  if (!Number.isFinite(value) || value < 0) return visualMediaAdmissionPolicy.maxAiImages;
  return Math.floor(value);
}
