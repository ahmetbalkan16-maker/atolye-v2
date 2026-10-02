/** Synthetic probe results and TEMP bytes; never evidence of a real production's quality. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { canonicalAyasJson } from "../src/lib/ayas/provenance/AyasReleaseProvenance";
import { buildYouTubeReadyCompanions, qualityBytesDigest } from "../src/lib/export/YouTubeReadyPackage";
import { collectProductionBundleQuality, collectProductionQualityFromFiles } from "../src/lib/production/ProductionQualityCollector";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { emitSmokeResult } from "./lib/SmokeResult";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import type { ExportBundleFileEntry } from "../src/types/export";
import type { MaterializeExportBundleInput } from "../src/lib/export/ExportBundleMaterializer";
let count = 0;
const head = "a".repeat(40);
const rawProbe = { format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3", size: "5" },
  streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30/1" }, { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 }] };
async function scenario(name: string, run: () => Promise<void> | void) { await run(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
async function main() {
  await withCanonicalSmokeRuntime({ name: "production-quality-collector" }, async (runtime) => {
    const project = await ProjectManager.createProject("Quality TEMP fixture");
    const directory = path.join(runtime.runtimeStorageContext.projectsRoot, project.slug, "export", "bundle");
    fs.mkdirSync(directory, { recursive: true });
    const metadata = { schemaVersion: "1", projectId: project.id, slug: project.slug, provider: "mock", status: "generated", videoAssetId: "v", thumbnailAssetId: "t",
      generatedAt: "2026-10-02T00:00:00Z", title: "Tarih", description: "Açıklama", tags: ["tarih"], hashtags: ["#tarih"], chapters: [{ startSeconds: 0, title: "Giriş" }], pinnedComment: "Yorum", thumbnailText: "Tarih" };
    const builderInput = { projectId: project.id, projectSlug: project.slug, assembly: { outputAssetId: "v", render: { durationSeconds: 3 }, scenes: [], totalDuration: "3", style: "documentary", createdAt: metadata.generatedAt },
      audio: { sections: [] }, youtube: metadata, assets: [], options: { repositoryHead: head, titleOptions: ["Tarih seçeneği"] } } as unknown as Parameters<typeof buildYouTubeReadyCompanions>[0];
    const companions = buildYouTubeReadyCompanions(builderInput);
    const original: Record<string, string> = { ...companions.files, "video.mp4": "video", "thumbnail.png": "thumbnail", "subtitles.srt": "1\n00:00:00,000 --> 00:00:03,000\nAnlatım\n", "subtitles.vtt": "WEBVTT\n",
      "youtube_metadata.json": JSON.stringify(metadata), "quality_report.json": JSON.stringify({ outcome: "YOUTUBE_READY_OWNER_REVIEW", authority: "PUBLISH", counts: { PASS: 29 } }) };
    let files: ExportBundleFileEntry[] = [];
    const write = (name: string, bytes: string) => { fs.writeFileSync(path.join(directory, name), bytes); return { fileName: name, byteLength: Buffer.byteLength(bytes), sha256: qualityBytesDigest(bytes), status: "packaged" as const }; };
    const reset = () => { files = Object.entries(original).map(([name, bytes]) => write(name, bytes)); manifest(); };
    const manifest = () => { const body = { schemaVersion: "1", projectId: project.id, slug: project.slug, createdAt: metadata.generatedAt, files }; fs.writeFileSync(path.join(directory, "export_manifest.json"), JSON.stringify({ ...body, checksum: qualityBytesDigest(canonicalAyasJson(body)) })); };
    let probe = structuredClone(rawProbe), calls = 0;
    const probeOptions = { runFfprobe: async (argv: readonly string[]) => { calls++; assert.deepEqual(argv.slice(0, -1), ["-v", "error", "-show_format", "-show_streams", "-of", "json"]); return JSON.stringify(probe); } };
    const collect = () => collectProductionBundleQuality({ projectSlug: project.slug, repositoryHead: head, storageContext: runtime.runtimeStorageContext, probeOptions });
    const check = async (criterion: string, state: string) => assert.equal((await collect()).report.checks.find((c) => c.criterion === criterion)?.state, state);
    reset();
    await scenario("canonical companions retain metadata and report unknown evidence", () => {
      assert.deepEqual(Object.keys(companions.files).sort(), ["attribution.json", "chapters.txt", "cost_report.json", "description.txt", "production_quality_basis.json", "tags.json", "title_options.json"]);
      assert.match(companions.files["chapters.txt"], /00:00:00 Giriş/); assert.deepEqual(JSON.parse(companions.files["title_options.json"]).titles, ["Tarih", "Tarih seçeneği"]);
      assert.equal(JSON.parse(companions.files["cost_report.json"]).costGate, "UNKNOWN"); assert.equal(JSON.parse(companions.files["attribution.json"]).rightsGate, "UNKNOWN");
      for (const options of [{ repositoryHead: "main" }, { repositoryHead: head, titleOptions: [" bad "] }, { repositoryHead: head, titleOptions: ["bad\nvalue"] }]) assert.throws(() => buildYouTubeReadyCompanions({ ...builderInput, options }));
      assert.throws(() => buildYouTubeReadyCompanions({ ...builderInput, youtube: { ...builderInput.youtube, slug: "other-project" } }));
      assert.throws(() => buildYouTubeReadyCompanions({ ...builderInput, options: { repositoryHead: head, costReceipt: { schemaVersion: "production-cost-receipt-v1", projectSlug: "other-project",
        budgetUsd: 1, observedUsd: 0, retryUsd: 0, duplicateUsd: 0, unknownCostCount: 0 } as never } }));
    });
    await scenario("current physical inventory and four measured checks; packaged PASS ignored", async () => {
      const before = fs.readdirSync(directory).map((name) => [name, fs.readFileSync(path.join(directory, name)).toString("hex")]);
      const r = await collect(); assert.equal(r.report.outcome, "QUALITY_REVIEW_REQUIRED"); assert.equal(r.report.authority, "NONE"); assert.equal(r.report.publication, "OWNER_ONLY");
      assert.equal(r.report.counts.PASS, 4); assert.equal(r.report.counts.UNMEASURED, 25); assert.deepEqual(r.report.missingArtifacts, []); assert.deepEqual(r.report.problems, ["RIGHTS_UNKNOWN", "COST_UNKNOWN"]);
      assert.equal(r.report.checks.find((c) => c.criterion === "NO_CLIPPING")?.state, "UNMEASURED"); assert.equal(r.report.checks.find((c) => c.criterion === "CLAIM_REFERENCES")?.state, "UNMEASURED");
      assert.deepEqual(fs.readdirSync(directory).map((name) => [name, fs.readFileSync(path.join(directory, name)).toString("hex")]), before);
    });
    await scenario("every delivery's absent bytes stay unavailable", async () => {
      for (const [name, id] of [["video.mp4", "MP4"], ["thumbnail.png", "THUMBNAIL"], ["title_options.json", "TITLE_OPTIONS"], ["description.txt", "DESCRIPTION"], ["chapters.txt", "CHAPTERS"], ["attribution.json", "ATTRIBUTION"], ["subtitles.srt", "SUBTITLES"], ["cost_report.json", "COST_REPORT"], ["quality_report.json", "QUALITY_REPORT"], ["tags.json", "TAGS"]]) {
        reset(); fs.unlinkSync(path.join(directory, name)); assert.ok((await collect()).report.missingArtifacts.includes(id as never), id);
      } reset();
    });
    await scenario("same-length corruption and wrong byte-length refuse verification", async () => {
      fs.writeFileSync(path.join(directory, "video.mp4"), "other"); assert.ok((await collect()).report.missingArtifacts.includes("MP4")); reset();
      files[0] = { ...files[0], byteLength: files[0].byteLength + 1 }; manifest(); assert.ok((await collect()).report.missingArtifacts.includes("TITLE_OPTIONS")); reset();
    });
    await scenario("head, project, manifest checksum and basis drift refuse collection", async () => {
      await assert.rejects(collectProductionBundleQuality({ projectSlug: project.slug, repositoryHead: "b".repeat(40), storageContext: runtime.runtimeStorageContext, probeOptions }));
      const bytes = fs.readFileSync(path.join(directory, "export_manifest.json"), "utf8");
      for (const mutate of [(m: Record<string, unknown>) => m.checksum = "f".repeat(64), (m: Record<string, unknown>) => {
        m.slug = "other"; const { checksum: ignored, ...body } = m; void ignored; m.checksum = qualityBytesDigest(canonicalAyasJson(body));
      }]) { const m = JSON.parse(bytes); mutate(m); fs.writeFileSync(path.join(directory, "export_manifest.json"), JSON.stringify(m)); await assert.rejects(collect()); } reset();
      fs.writeFileSync(path.join(directory, "production_quality_basis.json"), "{}"); await assert.rejects(collect()); reset();
    });
    await scenario("unsafe names, duplicate records and ambiguous thumbnails refuse readiness", async () => {
      for (const file of [{ ...files[0], fileName: "../project.json" }, { ...files[0], fileName: "C:/private.json" }, { ...files[0], sha256: "wrong" }]) await assert.rejects(collectProductionQualityFromFiles({ directory, files: [file, ...files.slice(1)], projectSlug: project.slug, repositoryHead: head, storageContext: runtime.runtimeStorageContext, probeOptions }));
      files.push(files[0]); manifest(); await assert.rejects(collect()); reset(); files.push(write("thumbnail.jpg", "other thumbnail")); manifest(); assert.ok((await collect()).report.missingArtifacts.includes("THUMBNAIL")); reset();
    });
    await scenario("probe duration is measured and canonical mismatch blocks", async () => { probe.format.duration = "100"; await check("FFPROBE_DURATION", "FAIL"); assert.equal((await collect()).report.outcome, "BLOCKED"); probe = structuredClone(rawProbe); });
    await scenario("container, video and audio codecs each checked", async () => {
      probe.format.format_name = "matroska"; await check("CODEC_CONTAINER", "FAIL"); probe = structuredClone(rawProbe);
      probe.streams[0].codec_name = "vp9"; await check("CODEC_CONTAINER", "FAIL"); probe = structuredClone(rawProbe);
      probe.streams[1].codec_name = "opus"; await check("CODEC_CONTAINER", "FAIL"); probe = structuredClone(rawProbe);
    });
    await scenario("preset intent cannot be downgraded to actual resolution", async () => { probe.streams[0].height = 720; await check("INTENDED_RESOLUTION", "FAIL"); probe = structuredClone(rawProbe); });
    await scenario("subtitle ordering and render alignment checked, not narration semantics", async () => {
      for (const text of ["invalid", "1\n00:00:00,000 --> 00:00:00,000\ntext", "1\n00:00:00,000 --> 00:00:30,000\ntext", "1\n00:00:01,000 --> 00:00:03,000\ntext\n2\n00:00:02,000 --> 00:00:03,000\ntext"]) { files = files.filter((f) => f.fileName !== "subtitles.srt"); files.push(write("subtitles.srt", text)); manifest(); await check("SUBTITLES", "FAIL"); } reset();
      probe.format.duration = "4000"; files = files.filter((f) => f.fileName !== "subtitles.srt"); files.push(write("subtitles.srt", "1\n00:60:00,000 --> 00:60:01,000\ntext")); manifest(); await check("SUBTITLES", "FAIL"); probe = structuredClone(rawProbe); reset();
    });
    await scenario("probe failure leaves technical evidence unmeasured", async () => {
      const r = await collectProductionBundleQuality({ projectSlug: project.slug, repositoryHead: head, storageContext: runtime.runtimeStorageContext, probeOptions: { runFfprobe: async () => { throw new Error("unavailable"); } } });
      assert.equal(r.report.counts.PASS, 0); assert.equal(r.report.counts.UNMEASURED, 29); assert.equal(r.report.outcome, "QUALITY_REVIEW_REQUIRED");
    });
    await scenario("file or manifest replacement during probe refuses stale evidence", async () => {
      await assert.rejects(collectProductionBundleQuality({ projectSlug: project.slug, repositoryHead: head, storageContext: runtime.runtimeStorageContext, probeOptions: { runFfprobe: async () => { fs.writeFileSync(path.join(directory, "video.mp4"), "other"); return JSON.stringify(rawProbe); } } })); reset();
      await assert.rejects(collectProductionBundleQuality({ projectSlug: project.slug, repositoryHead: head, storageContext: runtime.runtimeStorageContext, probeOptions: { runFfprobe: async () => { fs.appendFileSync(path.join(directory, "export_manifest.json"), " "); return JSON.stringify(rawProbe); } } })); reset();
    });
    await scenario("quality intent and declared facts bind the observed revision", async () => {
      const revision = (await collect()).report.revision;
      const basis = JSON.parse(original["production_quality_basis.json"]);
      for (const modified of [{ ...basis, factsDigest: "c".repeat(64) }, { ...basis, intendedResolution: { width: 1280, height: 720 } }, { ...basis, expectedDurationSeconds: 4 }]) {
        files = files.filter((f) => f.fileName !== "production_quality_basis.json"); files.push(write("production_quality_basis.json", JSON.stringify(modified))); manifest(); assert.notEqual((await collect()).report.revision, revision); reset();
      }
    });
    // Import shape is a type-only dependency, never a new write surface.
    const compatibility: Pick<MaterializeExportBundleInput, "youtubeReady"> = { youtubeReady: { repositoryHead: head } }; assert.ok(compatibility.youtubeReady);
    assert.ok(calls > 0); emitSmokeResult("ayas-production-quality-collector", count);
  });
}
main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
