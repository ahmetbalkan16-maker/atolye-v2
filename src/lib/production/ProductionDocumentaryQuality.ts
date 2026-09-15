import path from "node:path";
import { evaluateBrainQuality } from "@/lib/brain/BrainQualityModel";
import { buildBrainFinalRenderReport, probeMediaFile, type BrainRenderProbeOptions } from "@/lib/brain/probe/BrainRenderProbe";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import type { BrainQualityVerdict } from "@/types/brain";
import type { ProductionSnapshot } from "@/types/productionSnapshot";
import { resolveQualityPreset } from "./QualityPreset";

export interface ProductionDocumentaryQualityResult { readonly available: boolean; readonly verdict?: BrainQualityVerdict; readonly reasonCode?: "FINAL_EXPORT_UNAVAILABLE" | "FFPROBE_UNAVAILABLE"; }

/** Real, read-only quality integration. Never calls readiness or creates sentinels. */
export async function evaluateProductionDocumentaryQuality(snapshot: ProductionSnapshot, options: BrainRenderProbeOptions = {}): Promise<ProductionDocumentaryQualityResult> {
  const finalVideo = path.join(ProjectReader.getProjectFolder(snapshot.project.projectSlug), "export", "bundle", "video.mp4");
  const probed = await probeMediaFile(finalVideo, options);
  if (!probed.available) return { available: false, reasonCode: probed.reason.startsWith("media file not found") ? "FINAL_EXPORT_UNAVAILABLE" : "FFPROBE_UNAVAILABLE" };
  const preset = resolveQualityPreset();
  const expectedAssetKinds = ["research", "script", "scenes", "visuals", "animation", "video", "audio", "assembly", "thumbnail", "seo", "export"];
  const presentAssetKinds = snapshot.stages.filter((stage) => stage.outputReady.state === "known" && stage.outputReady.value).map((stage) => stage.stage);
  const report = buildBrainFinalRenderReport({
    projectSlug: snapshot.project.projectSlug, observedAt: snapshot.generatedAt, summary: probed,
    targetDurationBand: preset.targetDurationSeconds,
    targetResolution: { width: preset.videoWidth, height: preset.videoHeight }, targetFrameRate: preset.videoFps,
    scenes: [], expectedAssetKinds, presentAssetKinds,
  });
  return { available: true, verdict: evaluateBrainQuality(report) };
}
