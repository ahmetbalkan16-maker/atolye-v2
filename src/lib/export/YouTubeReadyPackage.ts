import { createHash } from "node:crypto";
import { canonicalAyasJson } from "../ayas/provenance/AyasReleaseProvenance";
import { validateYouTubePublishingPackage } from "../youtube/YouTubePackageValidation";
import { resolveQualityPreset } from "../production/QualityPreset";
import type { ProductionCostReceipt } from "../production/ProductionCostReceipt";
import type { Asset } from "../../types/asset";
import type { AssemblyPlanData } from "../../types/assembly";
import type { AudioData } from "../../types/audio";
import type { YouTubePublishingPackage } from "../../types/youtube";

/** Opt-in additive delivery files; uses the existing materializer and write lease. */
export interface YouTubeReadyPackageOptions {
  readonly repositoryHead: string;
  readonly titleOptions?: readonly string[];
  readonly costReceipt?: ProductionCostReceipt | null;
}
export interface ProductionQualityBasis {
  readonly schemaVersion: "production-quality-basis-v1";
  readonly projectSlug: string;
  readonly repositoryHead: string;
  readonly factsDigest: string;
  readonly intendedResolution: { readonly width: number; readonly height: number };
  readonly expectedDurationSeconds: number;
  readonly characteristics: { readonly syntheticReconstruction: null; readonly characterScenes: null; readonly musicBed: null };
}
export const qualityBytesDigest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

/** No generation/provider call. Existing metadata is validated, never silently regenerated. */
export function buildYouTubeReadyCompanions(input: {
  readonly projectId: string; readonly projectSlug: string;
  readonly assembly: AssemblyPlanData; readonly audio: AudioData;
  readonly youtube: YouTubePublishingPackage; readonly assets: readonly Asset[];
  readonly options: YouTubeReadyPackageOptions;
}): { basis: ProductionQualityBasis; files: Readonly<Record<string, string>> } {
  const { options, youtube } = input;
  if (!/^[a-f0-9]{40}$/.test(options.repositoryHead)) throw new Error("Quality package requires an exact repository HEAD.");
  const duration = input.assembly.render?.durationSeconds;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) throw new Error("Quality package requires a canonical rendered duration.");
  validateYouTubePublishingPackage(youtube, { projectId: input.projectId, slug: input.projectSlug,
    videoAssetId: input.assembly.outputAssetId, videoDurationSeconds: duration });
  const titles = [...new Set([youtube.title, ...(options.titleOptions ?? [])])];
  if (titles.length > 10 || titles.some((title) => typeof title !== "string" || title !== title.normalize("NFC").trim()
    || !title || title.length > 100 || /[\u0000-\u001f\u007f-\u009f]/u.test(title))) throw new Error("Invalid title options.");
  const receipt = options.costReceipt;
  if (receipt && (receipt.schemaVersion !== "production-cost-receipt-v1" || receipt.projectSlug !== input.projectSlug
    || [receipt.budgetUsd, receipt.observedUsd, receipt.retryUsd, receipt.duplicateUsd, receipt.unknownCostCount].some((n) => !Number.isFinite(n) || n < 0))) throw new Error("Invalid project cost receipt.");
  const preset = resolveQualityPreset();
  const basis: ProductionQualityBasis = { schemaVersion: "production-quality-basis-v1", projectSlug: input.projectSlug,
    repositoryHead: options.repositoryHead, factsDigest: qualityBytesDigest(canonicalAyasJson({ assembly: input.assembly, audio: input.audio, youtube, assets: input.assets, titleOptions: titles, costReceipt: receipt ?? null })),
    intendedResolution: { width: preset.videoWidth, height: preset.videoHeight }, expectedDurationSeconds: duration,
    characteristics: { syntheticReconstruction: null, characterScenes: null, musicBed: null } };
  return { basis, files: {
    "title_options.json": json({ titles, selectedTitle: youtube.title }),
    "description.txt": youtube.description + "\n",
    "chapters.txt": youtube.chapters.map((c) => `${timestamp(c.startSeconds)} ${c.title}`).join("\n") + "\n",
    "attribution.json": json({ schemaVersion: "1", scope: "ASSET_REGISTRY_INVENTORY_NOT_RENDER_COMPLETENESS", rightsGate: "UNKNOWN",
      entries: input.assets.map((a) => ({ assetId: a.id, provider: a.provider, mediaOrigin: a.mediaOrigin ?? "unknown", sourceUrl: a.sourceUrl ?? null,
        sourceName: a.sourceName ?? null, license: a.license ?? null, attribution: a.attribution ?? null })) }),
    "tags.json": json({ tags: youtube.tags, hashtags: youtube.hashtags }),
    "cost_report.json": json({ schemaVersion: "1", projectSlug: input.projectSlug, attestation: "REPORTED_NOT_ATTESTED", costGate: "UNKNOWN",
      receipt: receipt ?? null, reason: receipt ? "Receipt exported for review; no project-cap/reservation attestation is inferred." : "No current cost receipt supplied." }),
    "production_quality_basis.json": json(basis),
  } };
}
function timestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}
