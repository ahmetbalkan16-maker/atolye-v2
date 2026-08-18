import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { emitSmokeResult } from "./lib/SmokeResult";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import { ThumbnailStorage } from "../src/lib/thumbnail/ThumbnailStorage";
import {
  ExportBundleMaterializationError,
  packageExport,
} from "../src/lib/export/ExportPackager";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import type { RuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import type { AudioData } from "../src/types/audio";
import type { AssemblyPlanData } from "../src/types/assembly";
import type { ThumbnailData } from "../src/types/thumbnail";
import type { YouTubePublishingPackage } from "../src/types/youtube";
import { POST as exportPost } from "../app/api/export/route";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

// ---- Fixture builders (real, valid physical files) ----

function wav(dataLength: number) {
  const value = Buffer.alloc(44 + dataLength);
  value.write("RIFF", 0);
  value.writeUInt32LE(value.length - 8, 4);
  value.write("WAVE", 8);
  value.write("fmt ", 12);
  value.writeUInt32LE(16, 16);
  value.writeUInt16LE(1, 20);
  value.writeUInt16LE(1, 22);
  value.writeUInt32LE(8000, 24);
  value.writeUInt32LE(16000, 28);
  value.writeUInt16LE(2, 32);
  value.writeUInt16LE(16, 34);
  value.write("data", 36);
  value.writeUInt32LE(dataLength, 40);
  return value;
}

function box(type: string, payload = Buffer.alloc(0)) {
  const value = Buffer.alloc(8 + payload.length);
  value.writeUInt32BE(value.length, 0);
  value.write(type, 4, 4, "ascii");
  payload.copy(value, 8);
  return value;
}

function mp4() {
  return Buffer.concat([
    box("ftyp", Buffer.from("isom0000")),
    box("moov"),
    box("mdat", Buffer.from([0, 1, 2, 3])),
  ]);
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, content: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(content.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, content])), 0);
  return Buffer.concat([length, typeBuffer, content, crc]);
}

function png() {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(4, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", Buffer.from([0, 1, 2, 3, 4])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

interface Fixture {
  audio: AudioData;
  assembly: AssemblyPlanData;
  thumbnail: ThumbnailData;
  youtube: YouTubePublishingPackage;
}

async function buildFixture(slug: string, projectId: string): Promise<Fixture> {
  const now = "2026-08-18T00:00:00.000Z";

  const wavOne = AudioStorage.saveAudio({ projectSlug: slug, data: wav(16000) }); // 1.0s
  const wavTwo = AudioStorage.saveAudio({ projectSlug: slug, data: wav(32000) }); // 2.0s

  const chapterOne = AssetManager.createAsset({
    projectId, projectSlug: slug, type: "audio", status: "generated",
    provider: "openai", model: "mock-tts", prompt: "narration chapter 1",
    filePath: wavOne.filePath, url: wavOne.url, mimeType: wavOne.mimeType,
    byteLength: wavOne.byteLength, durationSeconds: wavOne.durationSeconds,
  });
  AssetManager.addAsset(slug, projectId, chapterOne);

  const chapterTwo = AssetManager.createAsset({
    projectId, projectSlug: slug, type: "audio", status: "generated",
    provider: "openai", model: "mock-tts", prompt: "narration chapter 2",
    filePath: wavTwo.filePath, url: wavTwo.url, mimeType: wavTwo.mimeType,
    byteLength: wavTwo.byteLength, durationSeconds: wavTwo.durationSeconds,
  });
  AssetManager.addAsset(slug, projectId, chapterTwo);

  const videoPaths = VideoStorage.createRenderPaths(slug);
  const videoBytes = mp4();
  await fs.promises.writeFile(videoPaths.temporaryAbsolutePath, videoBytes);
  VideoStorage.finalize(videoPaths.temporaryAbsolutePath, videoPaths.absolutePath);
  const videoAsset = AssetManager.createAsset({
    projectId, projectSlug: slug, type: "video", status: "generated",
    provider: "ffmpeg", model: "ffmpeg-h264-aac", prompt: "final assembly render",
    filePath: videoPaths.filePath, url: videoPaths.url, mimeType: "video/mp4",
    byteLength: videoBytes.length, durationSeconds: 3,
  });
  AssetManager.addAsset(slug, projectId, videoAsset);

  const thumbnailAssetId = randomUUID();
  const thumbnailBytes = png();
  const savedThumbnail = ThumbnailStorage.saveThumbnail({
    projectSlug: slug, assetId: thumbnailAssetId, data: thumbnailBytes, mimeType: "image/png",
  });
  const thumbnailAsset = AssetManager.createAsset({
    id: thumbnailAssetId, projectId, projectSlug: slug, type: "thumbnail", status: "generated",
    provider: "openai", model: "mock-thumbnail", prompt: "thumbnail",
    filePath: savedThumbnail.filePath, url: savedThumbnail.url, mimeType: savedThumbnail.mimeType,
    byteLength: savedThumbnail.byteLength,
  });
  AssetManager.addAsset(slug, projectId, thumbnailAsset);

  const audio: AudioData = {
    narrator: { style: "documentary", tone: "serious", language: "tr" },
    sections: [
      {
        chapterId: 1, title: "Bolum Bir", duration: "00:01", emotion: "serious",
        emphasis: [], narrationNotes: "", pacing: "medium",
        sourceText: "Istanbul'un fethine hazirlik basladi; ordular sehrin surlarina yaklasti. Turkce karakterler: igusoc.",
        outputAssetId: chapterOne.id, status: "generated", provider: "openai", model: "mock-tts",
        audioFileUrl: wavOne.url, byteLength: wavOne.byteLength, durationSeconds: wavOne.durationSeconds,
      },
      {
        chapterId: 2, title: "Bolum Iki", duration: "00:02", emotion: "serious",
        emphasis: [], narrationNotes: "", pacing: "medium",
        sourceText: "Toplarin gurlemesiyle Konstantinopolis kusatmasi sertlesti.",
        outputAssetId: chapterTwo.id, status: "generated", provider: "openai", model: "mock-tts",
        audioFileUrl: wavTwo.url, byteLength: wavTwo.byteLength, durationSeconds: wavTwo.durationSeconds,
      },
    ],
    music: { mood: "cinematic", suggestion: "dark orchestral", intensity: "medium" },
    production: {
      targetFormat: "wav", sampleRate: 8000, estimatedTotalDuration: "00:03",
      generationStatus: "generated",
    },
    createdAt: now,
  };

  const assembly: AssemblyPlanData = {
    projectId, slug, title: "Fetih", status: "assembled", outputAssetId: videoAsset.id,
    scenes: [], totalDuration: "3", style: "cinematic",
    render: {
      status: "rendered", outputUrl: videoPaths.url, filePath: videoPaths.filePath,
      format: "mp4", mimeType: "video/mp4", byteLength: videoBytes.length,
      durationSeconds: (wavOne.durationSeconds ?? 0) + (wavTwo.durationSeconds ?? 0),
      width: 1920, height: 1080, videoCodec: "h264", audioCodec: "aac",
    },
    createdAt: now,
  };

  const thumbnail: ThumbnailData = {
    projectId, slug, provider: "openai", status: "generated",
    sourceAssemblyAssetId: videoAsset.id, outputAssetId: thumbnailAsset.id,
    variants: [], titleIdea: "Fetih", concept: "c", mainSubject: "s", composition: "c",
    colorStyle: "c", textSuggestion: "t", imagePrompt: "p", clickReason: "r",
    generation: {
      provider: "openai", model: "mock-thumbnail", assetId: thumbnailAsset.id,
      fileName: savedThumbnail.fileName, filePath: savedThumbnail.filePath,
      imageUrl: savedThumbnail.url, mimeType: "image/png",
      width: savedThumbnail.width, height: savedThumbnail.height,
      byteLength: savedThumbnail.byteLength, status: "generated",
    },
    createdAt: now,
  };

  const youtube: YouTubePublishingPackage = {
    schemaVersion: "1", projectId, slug, provider: "mock", status: "generated",
    videoAssetId: videoAsset.id, thumbnailAssetId: thumbnailAsset.id, generatedAt: now,
    title: "Fatih Sultan Mehmet'in Istanbul'un Fethine Hazirlanisi",
    description: "Belgesel aciklama metni.",
    tags: ["tarih", "istanbul", "fetih"],
    hashtags: ["#tarih", "#istanbul"],
    chapters: [{ startSeconds: 0, title: "Giris" }],
    pinnedComment: "Sabitlenmis yorum.",
    thumbnailText: "FETIH",
  };

  return { audio, assembly, thumbnail, youtube };
}

function bundleDir(context: RuntimeStorageContext, slug: string): string {
  return path.join(context.projectsRoot, slug, "export", "bundle");
}
function exportDir(context: RuntimeStorageContext, slug: string): string {
  return path.join(context.projectsRoot, slug, "export");
}

async function main() {
  await withCanonicalSmokeRuntime({ name: "sprint-132-export-packaging" }, async (runtime) => {
    const storageContext = runtime.runtimeStorageContext;

    const project = await ProjectManager.createProject("Sprint 132 Export Bundling Fixture");
    const fixture = await buildFixture(project.slug, project.id);
    const bundle = bundleDir(storageContext, project.slug);

    const call = () =>
      packageExport({
        projectId: project.id, projectSlug: project.slug, project,
        audio: fixture.audio, assembly: fixture.assembly, thumbnail: fixture.thumbnail,
        youtube: fixture.youtube, storageContext,
      });

    let firstResult: Awaited<ReturnType<typeof call>>;

    await scenario("A: physical bundle creation", async () => {
      firstResult = await call();
      assert.equal(firstResult.bundle?.status, "packaged");
      for (const name of [
        "video.mp4", "thumbnail.png", "youtube_metadata.json",
        "subtitles.srt", "subtitles.vtt", "export_manifest.json",
      ]) {
        assert.equal(fs.existsSync(path.join(bundle, name)), true, `${name} missing`);
      }
    });

    await scenario("B: video authority", async () => {
      const bundled = fs.readFileSync(path.join(bundle, "video.mp4"));
      const canonical = fs.readFileSync(
        path.join(storageContext.projectsRoot, ...fixture.assembly.render!.filePath!
          .replace(/^data\/projects\//, "").split("/")),
      );
      assert.deepEqual(bundled, canonical);
      const manifest = JSON.parse(fs.readFileSync(path.join(bundle, "export_manifest.json"), "utf-8"));
      const entry = manifest.files.find((f: { fileName: string }) => f.fileName === "video.mp4");
      assert.equal(entry.sourceAssetId, fixture.assembly.outputAssetId);
    });

    await scenario("C: thumbnail authority", async () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(bundle, "export_manifest.json"), "utf-8"));
      const entry = manifest.files.find((f: { fileName: string }) => f.fileName === "thumbnail.png");
      assert.equal(entry.sourceAssetId, fixture.thumbnail.outputAssetId);
      assert.equal(entry.byteLength, fs.statSync(path.join(bundle, "thumbnail.png")).size);
    });

    await scenario("D: youtube metadata", async () => {
      const written = JSON.parse(fs.readFileSync(path.join(bundle, "youtube_metadata.json"), "utf-8"));
      assert.deepEqual(written, fixture.youtube);
    });

    await scenario("E: SRT formatting", async () => {
      const srt = fs.readFileSync(path.join(bundle, "subtitles.srt"), "utf-8");
      const blocks = srt.split("\r\n\r\n").filter(Boolean);
      assert.equal(blocks.length, 2);
      assert.match(blocks[0], /^1\r\n00:00:00,000 --> 00:00:01,000\r\n/);
      assert.match(blocks[1], /^2\r\n00:00:01,000 --> 00:00:03,000\r\n/);
      assert.match(srt, /igusoc/);
    });

    await scenario("F: VTT formatting", async () => {
      const vtt = fs.readFileSync(path.join(bundle, "subtitles.vtt"), "utf-8");
      assert.equal(vtt.startsWith("WEBVTT\n\n"), true);
      assert.match(vtt, /00:00:00\.000 --> 00:00:01\.000/);
      assert.match(vtt, /00:00:01\.000 --> 00:00:03\.000/);
    });

    await scenario("G: checksum verification", async () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(bundle, "export_manifest.json"), "utf-8"));
      const { createHash } = await import("node:crypto");
      for (const file of manifest.files) {
        const bytes = fs.readFileSync(path.join(bundle, file.fileName));
        const actual = createHash("sha256").update(bytes).digest("hex");
        assert.equal(actual, file.sha256, `${file.fileName} checksum mismatch`);
      }
      assert.equal(typeof manifest.checksum, "string");
      assert.equal(manifest.checksum.length, 64);
      assert.equal(manifest.checksum, firstResult.bundle?.manifestChecksum);
    });

    await scenario("H: byte length", async () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(bundle, "export_manifest.json"), "utf-8"));
      for (const file of manifest.files) {
        const stat = fs.statSync(path.join(bundle, file.fileName));
        assert.equal(stat.size, file.byteLength);
      }
    });

    let videoInodeBefore = "";
    await scenario("I: idempotent re-export", async () => {
      videoInodeBefore = String(fs.statSync(path.join(bundle, "video.mp4")).ino);
      const second = await call();
      assert.equal(second.bundle?.manifestChecksum, firstResult.bundle?.manifestChecksum);
      const videoInodeAfter = String(fs.statSync(path.join(bundle, "video.mp4")).ino);
      assert.equal(videoInodeAfter, videoInodeBefore, "video.mp4 was rewritten on an idempotent re-export");
      const stagingLeftovers = fs.readdirSync(exportDir(storageContext, project.slug))
        .filter((name) => name.startsWith(".staging-"));
      assert.equal(stagingLeftovers.length, 0);
    });

    await scenario("J: corrupted bundle recovery", async () => {
      const srtPath = path.join(bundle, "subtitles.srt");
      const original = fs.readFileSync(srtPath);
      fs.writeFileSync(srtPath, Buffer.from("corrupted"));
      const recovered = await call();
      assert.equal(recovered.bundle?.status, "packaged");
      const restored = fs.readFileSync(srtPath);
      assert.deepEqual(restored, original);
      const superseded = fs.readdirSync(exportDir(storageContext, project.slug))
        .filter((name) => name.startsWith(".superseded-"));
      assert.equal(superseded.length > 0, true, "corrupted bundle was not superseded");
    });

    await scenario("M: promotion failure triggers rollback of the previous canonical bundle", async () => {
      const srtPath = path.join(bundle, "subtitles.srt");
      // Force a non-idempotent regeneration attempt (same trigger as scenario J), then
      // capture what canonical holds right before the (about to fail) promotion.
      fs.writeFileSync(srtPath, Buffer.from("corrupted-again"));
      const beforeManifest = fs.readFileSync(path.join(bundle, "export_manifest.json"));
      const beforeSrt = fs.readFileSync(srtPath);

      const originalRename = fs.renameSync;
      let failNext = true;
      Reflect.set(fs, "renameSync", (...args: unknown[]) => {
        const [, dest] = args as [unknown, unknown];
        if (failNext && dest === bundle) {
          failNext = false;
          throw Object.assign(new Error("Injected promote rename failure"), { code: "EPERM" });
        }
        return Reflect.apply(originalRename, fs, args);
      });

      try {
        await assert.rejects(() => call(), ExportBundleMaterializationError);
      } finally {
        Reflect.set(fs, "renameSync", originalRename);
      }

      // Rollback must restore the exact previous canonical bundle - byte for byte.
      assert.deepEqual(fs.readFileSync(path.join(bundle, "export_manifest.json")), beforeManifest);
      assert.deepEqual(fs.readFileSync(srtPath), beforeSrt);

      // No orphaned staging directory left behind by the failed promotion.
      const leftovers = fs.readdirSync(exportDir(storageContext, project.slug))
        .filter((name) => name.startsWith(".staging-"));
      assert.equal(leftovers.length, 0);

      // The system must not be wedged: a follow-up export succeeds and repairs the corruption.
      const recovered = await call();
      assert.equal(recovered.bundle?.status, "packaged");
      assert.notDeepEqual(fs.readFileSync(srtPath), beforeSrt);
    });

    await scenario("N: EXDEV fallback streams the copy instead of buffering the whole file", async () => {
      const projectFour = await ProjectManager.createProject("Sprint 132 EXDEV Fixture");
      const fixtureFour = await buildFixture(projectFour.slug, projectFour.id);

      const originalLink = fs.linkSync;
      const originalCreateReadStream = fs.createReadStream;
      const originalReadFileSync = fs.readFileSync;
      const createReadStreamCalls: string[] = [];
      const readFileSyncCalls: string[] = [];

      Reflect.set(fs, "linkSync", () => {
        throw Object.assign(new Error("Injected EXDEV"), { code: "EXDEV" });
      });
      Reflect.set(fs, "createReadStream", (...args: unknown[]) => {
        createReadStreamCalls.push(String(args[0]));
        return Reflect.apply(originalCreateReadStream, fs, args);
      });
      Reflect.set(fs, "readFileSync", (...args: unknown[]) => {
        readFileSyncCalls.push(String(args[0]));
        return Reflect.apply(originalReadFileSync, fs, args);
      });

      let result;
      try {
        result = await packageExport({
          projectId: projectFour.id, projectSlug: projectFour.slug, project: projectFour,
          audio: fixtureFour.audio, assembly: fixtureFour.assembly, thumbnail: fixtureFour.thumbnail,
          youtube: fixtureFour.youtube, storageContext,
        });
      } finally {
        Reflect.set(fs, "linkSync", originalLink);
        Reflect.set(fs, "createReadStream", originalCreateReadStream);
        Reflect.set(fs, "readFileSync", originalReadFileSync);
      }

      assert.equal(result.bundle?.status, "packaged");
      const bundleFour = bundleDir(storageContext, projectFour.slug);
      const videoSourceAbsolute = path.join(
        storageContext.projectsRoot,
        ...fixtureFour.assembly.render!.filePath!
          .replace(/^data\/projects\//, "").split("/"),
      );

      // Streaming proof: the source was read via createReadStream, never via a whole-file
      // readFileSync (which is exactly what the streaming fallback replaced).
      assert.equal(createReadStreamCalls.includes(videoSourceAbsolute), true);
      assert.equal(readFileSyncCalls.includes(videoSourceAbsolute), false);

      // Byte-for-byte + checksum correctness of the streamed copy.
      const bundledVideo = fs.readFileSync(path.join(bundleFour, "video.mp4"));
      const sourceVideo = fs.readFileSync(videoSourceAbsolute);
      assert.deepEqual(bundledVideo, sourceVideo);
      const manifestFour = JSON.parse(
        fs.readFileSync(path.join(bundleFour, "export_manifest.json"), "utf-8"),
      );
      const { createHash } = await import("node:crypto");
      const videoEntry = manifestFour.files.find(
        (entry: { fileName: string }) => entry.fileName === "video.mp4",
      );
      assert.equal(createHash("sha256").update(bundledVideo).digest("hex"), videoEntry.sha256);
      assert.equal(bundledVideo.length, videoEntry.byteLength);
    });

    await scenario("K: missing source fail-closed", async () => {
      const projectTwo = await ProjectManager.createProject("Sprint 132 Missing Source Fixture");
      const fixtureTwo = await buildFixture(projectTwo.slug, projectTwo.id);
      const broken: AssemblyPlanData = { ...fixtureTwo.assembly, outputAssetId: "does-not-exist" };
      await assert.rejects(
        () =>
          packageExport({
            projectId: projectTwo.id, projectSlug: projectTwo.slug, project: projectTwo,
            audio: fixtureTwo.audio, assembly: broken, thumbnail: fixtureTwo.thumbnail,
            youtube: fixtureTwo.youtube, storageContext,
          }),
        ExportBundleMaterializationError,
      );
      assert.equal(fs.existsSync(bundleDir(storageContext, projectTwo.slug)), false);
    });

    await scenario("L: inline API compatibility (no projectSlug stays plan-only)", async () => {
      const inlineAudio: AudioData = {
        narrator: { style: "s", tone: "t", language: "tr" },
        sections: [], music: { mood: "m", suggestion: "s", intensity: "i" },
        production: { targetFormat: "wav", sampleRate: 8000, estimatedTotalDuration: "00:00", generationStatus: "planned" },
        createdAt: "2026-08-18T00:00:00.000Z",
      };
      const response = await exportPost(
        new Request("http://localhost/api/export", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ audio: inlineAudio }),
        }),
      );
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.success, true);
      assert.equal(body.export.bundle, undefined);
    });

    await scenario("L: inline API compatibility (real projectSlug gets physically bundled)", async () => {
      const projectThree = await ProjectManager.createProject("Sprint 132 Route API Fixture");
      const fixtureThree = await buildFixture(projectThree.slug, projectThree.id);
      const response = await exportPost(
        new Request("http://localhost/api/export", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectSlug: projectThree.slug,
            audio: fixtureThree.audio, assembly: fixtureThree.assembly,
            thumbnail: fixtureThree.thumbnail, youtube: fixtureThree.youtube,
          }),
        }),
      );
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.export.bundle?.status, "packaged");
      assert.equal(fs.existsSync(bundleDir(storageContext, projectThree.slug)), true);
    });

    emitSmokeResult("sprint-132-export-packaging", count);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
