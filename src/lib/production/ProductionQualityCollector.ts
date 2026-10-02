import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonicalAyasJson } from "../ayas/provenance/AyasReleaseProvenance";
import { probeMediaFile, type BrainRenderProbeOptions, type FfprobeResult } from "../brain/probe/BrainRenderProbe";
import { ProjectReader } from "../projects/ProjectReader";
import { requireContainedStorageDirectory, requireContainedStorageFile } from "../assets/storage/StoragePathSecurity";
import { resolveRuntimeStorageContext, type RuntimeStorageContext } from "../runtime/RuntimeStoragePaths";
import { qualityBytesDigest, type ProductionQualityBasis } from "../export/YouTubeReadyPackage";
import { evaluateProductionQualityGate, productionQualityRevision, YOUTUBE_READY_ARTIFACTS,
  type ProductionQualityCriterion, type ProductionQualityGateInput, type ProductionQualityGateReport, type YouTubeReadyArtifactId } from "./ProductionQualityGate";
import type { ExportBundleFileEntry, ExportBundleManifest } from "../../types/export";

const FILES: Readonly<Record<YouTubeReadyArtifactId, readonly string[]>> = Object.freeze({
  MP4: ["video.mp4"], THUMBNAIL: ["thumbnail.png", "thumbnail.jpg", "thumbnail.webp"], TITLE_OPTIONS: ["title_options.json"],
  DESCRIPTION: ["description.txt"], CHAPTERS: ["chapters.txt"], ATTRIBUTION: ["attribution.json"], SUBTITLES: ["subtitles.srt"],
  COST_REPORT: ["cost_report.json"], QUALITY_REPORT: ["quality_report.json"], TAGS: ["tags.json"],
});
const ALLOWED = new Set([...Object.values(FILES).flat(), "subtitles.vtt", "youtube_metadata.json", "production_quality_basis.json"]);
const HASH = /^[a-f0-9]{64}$/;
export interface ProductionBundleQualityResult {
  readonly report: ProductionQualityGateReport;
  readonly probe: FfprobeResult;
  readonly verifiedFiles: readonly string[];
  readonly basisDigest: string;
  readonly receipts: ProductionQualityGateInput["observations"];
}

/** Fixed local paths only, physical bytes verified against the manifest. No render, write or publisher. */
export async function collectProductionBundleQuality(input: {
  readonly projectSlug: string; readonly repositoryHead: string; readonly storageContext?: RuntimeStorageContext;
  readonly probeOptions?: BrainRenderProbeOptions;
}): Promise<ProductionBundleQualityResult> {
  const context = resolveRuntimeStorageContext(input.storageContext ?? {});
  const project = ProjectReader.getProjectFolder(input.projectSlug, context);
  const directory = requireContainedStorageDirectory(path.join(project, "export", "bundle"), context);
  const manifestFile = requireContainedStorageFile(directory, path.join(directory, "export_manifest.json"), context);
  if (manifestFile.stat.size > 2 * 1024 * 1024) throw new Error("Quality manifest exceeds limit.");
  const bytes = fs.readFileSync(manifestFile.realPath);
  const manifest = JSON.parse(bytes.toString("utf8")) as ExportBundleManifest;
  const { checksum, ...body } = manifest;
  if (manifest.schemaVersion !== "1" || manifest.slug !== input.projectSlug || !HASH.test(checksum ?? "")
    || qualityBytesDigest(canonicalAyasJson(body)) !== checksum) throw new Error("Quality manifest identity or checksum is invalid.");
  const result = await collectProductionQualityFromFiles({ directory, files: manifest.files, projectSlug: input.projectSlug,
    repositoryHead: input.repositoryHead, storageContext: context, probeOptions: input.probeOptions });
  if (!fs.readFileSync(manifestFile.realPath).equals(bytes)) throw new Error("Quality manifest changed during collection.");
  return result;
}

/** Internal materializer seam: staging is already covered by its existing project write lease. */
export async function collectProductionQualityFromFiles(input: {
  readonly directory: string; readonly files: readonly ExportBundleFileEntry[];
  readonly projectSlug: string; readonly repositoryHead: string; readonly storageContext: RuntimeStorageContext;
  readonly probeOptions?: BrainRenderProbeOptions;
}): Promise<ProductionBundleQualityResult> {
  const directory = requireContainedStorageDirectory(input.directory, input.storageContext);
  if (!Array.isArray(input.files) || input.files.length > ALLOWED.size) throw new Error("Invalid quality file inventory.");
  const seen = new Set<string>(), verified = new Map<string, { digest: string; realPath: string }>();
  for (const file of input.files) {
    if (!file || !ALLOWED.has(file.fileName) || seen.has(file.fileName) || file.status !== "packaged"
      || !Number.isSafeInteger(file.byteLength) || file.byteLength <= 0 || file.byteLength > 8 * 1024 ** 3 || !HASH.test(file.sha256)) throw new Error("Invalid quality file record.");
    seen.add(file.fileName);
    // A missing/corrupt file stays unavailable; an unsafe path refuses the inventory.
    try {
      const stored = requireContainedStorageFile(directory, path.join(directory, file.fileName), input.storageContext);
      if (stored.stat.size !== file.byteLength) continue;
      const digest = await digestFile(stored.realPath);
      if (digest === file.sha256) verified.set(file.fileName, { digest, realPath: stored.realPath });
    } catch { /* no fabricated VERIFIED entry */ }
  }
  const basisFile = verified.get("production_quality_basis.json");
  if (!basisFile) throw new Error("Current quality basis unavailable.");
  const basis = readSmallJSON(basisFile.realPath) as ProductionQualityBasis;
  if (!validBasis(basis, input.projectSlug, input.repositoryHead)) throw new Error("Quality basis does not match current project and HEAD.");
  const gate: ProductionQualityGateInput = { projectSlug: input.projectSlug, repositoryHead: input.repositoryHead,
    factsDigest: qualityBytesDigest(canonicalAyasJson({ declaredFacts: basis.factsDigest, basisDigest: basisFile.digest })),
    characteristics: basis.characteristics, rightsGate: "UNKNOWN", costGate: "UNKNOWN", observations: [],
    artifacts: YOUTUBE_READY_ARTIFACTS.map((id) => {
      const found = FILES[id].filter((name) => verified.has(name));
      return { id, state: found.length === 1 ? "VERIFIED" : "MISSING", sha256: found.length === 1 ? verified.get(found[0])!.digest : null };
    }) };
  const revision = productionQualityRevision(gate);
  const observations: ProductionQualityGateInput["observations"][number][] = [];
  const record = (criterion: ProductionQualityCriterion, passed: boolean, data: unknown, measurement = false) => observations.push({
    criterion, state: passed ? "PASS" : "FAIL", revision, evidenceClass: measurement ? "MEASUREMENT" : "DETERMINISTIC_CHECK",
    receiptId: `bundle.${criterion}`, receiptDigest: qualityBytesDigest(canonicalAyasJson(data)),
  });
  const video = verified.get("video.mp4");
  const probe: FfprobeResult = video ? await probeMediaFile(video.realPath, input.probeOptions) : { available: false, reason: "Verified MP4 unavailable." };
  if (probe.available) {
    record("FFPROBE_DURATION", Number.isFinite(probe.container.durationSeconds) && probe.container.durationSeconds > 0
      && Math.abs(probe.container.durationSeconds - basis.expectedDurationSeconds) <= Math.max(1, basis.expectedDurationSeconds * .01), probe, true);
    record("CODEC_CONTAINER", probe.container.format.split(",").includes("mp4") && probe.video?.codec === "h264" && probe.audio?.codec === "aac", probe, true);
    record("INTENDED_RESOLUTION", probe.video?.width === basis.intendedResolution.width && probe.video?.height === basis.intendedResolution.height, probe, true);
  }
  const subtitle = verified.get("subtitles.srt");
  if (subtitle && probe.available) {
    const text = readSmallText(subtitle.realPath);
    const timings = [...text.matchAll(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g)];
    let previousEnd = 0;
    const valid = timings.length > 0 && timings.every((match) => {
      const start = subtitleSeconds(match[1]), end = subtitleSeconds(match[2]);
      const ok = start >= previousEnd && end > start && end <= probe.container.durationSeconds + Math.max(1, probe.container.durationSeconds * .01);
      previousEnd = end; return ok;
    });
    record("SUBTITLES", valid, { digest: subtitle.digest, duration: probe.container.durationSeconds, structuralOnly: true });
  }
  // File existence is inventory evidence, not thumbnail aesthetics, rights completeness,
  // fact checking, acoustic measurement or story quality. Packaged PASS reports are ignored.
  // Rehash after probing to refuse evidence about bytes replaced during the observation.
  for (const [name, file] of verified) if (await digestFile(file.realPath) !== file.digest) throw new Error(`Quality input changed during collection: ${name}`);
  return { report: evaluateProductionQualityGate({ ...gate, observations }), probe, verifiedFiles: [...verified.keys()].sort(), basisDigest: basisFile.digest, receipts: observations };
}

/** Receipt hashes and the actual probe travel with the package; no staging path or self-hash is serialized. */
export function serializeProductionBundleQuality(result: ProductionBundleQualityResult): string {
  return JSON.stringify({ ...result.report, evidence: { basisDigest: result.basisDigest, verifiedFiles: result.verifiedFiles,
    receipts: result.receipts, probe: result.probe.available ? result.probe : { available: false, reason: "FFPROBE_OR_VERIFIED_VIDEO_UNAVAILABLE" } } }, null, 2) + "\n";
}

async function digestFile(file: string): Promise<string> {
  const before = fs.statSync(file); const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  const after = fs.statSync(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error("Quality file changed while hashing.");
  return hash.digest("hex");
}
function readSmallText(file: string): string {
  if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error("Quality text exceeds limit.");
  return fs.readFileSync(file, "utf8");
}
const readSmallJSON = (file: string): unknown => JSON.parse(readSmallText(file));
function validBasis(b: ProductionQualityBasis, slug: string, head: string): boolean {
  return !!b && Object.keys(b).sort().join("|") === ["schemaVersion", "projectSlug", "repositoryHead", "factsDigest", "intendedResolution", "expectedDurationSeconds", "characteristics"].sort().join("|")
    && b.schemaVersion === "production-quality-basis-v1" && b.projectSlug === slug && b.repositoryHead === head && /^[a-f0-9]{40}$/.test(head) && HASH.test(b.factsDigest)
    && Number.isFinite(b.expectedDurationSeconds) && b.expectedDurationSeconds > 0 && !!b.intendedResolution
    && Object.keys(b.intendedResolution).sort().join("|") === "height|width" && Number.isSafeInteger(b.intendedResolution.width) && b.intendedResolution.width > 0
    && Number.isSafeInteger(b.intendedResolution.height) && b.intendedResolution.height > 0 && !!b.characteristics
    && Object.keys(b.characteristics).sort().join("|") === "characterScenes|musicBed|syntheticReconstruction" && Object.values(b.characteristics).every((v) => v === null);
}
function subtitleSeconds(value: string): number {
  const [h, m, s] = value.replace(",", ".").split(":").map(Number);
  if (!Number.isFinite(h) || m < 0 || m >= 60 || s < 0 || s >= 60) return NaN;
  return h * 3600 + m * 60 + s;
}
