import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { OpenAIImageProvider } from "../src/lib/assets/providers/OpenAIImageProvider";
import { AIManager } from "../src/lib/ai/AIManager";
import { strictGenerationExecutionPolicy } from "../src/lib/ai/GenerationExecutionPolicy";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import {
  FFmpegVideoAssemblyProvider,
  type ProcessRunResult,
  type VideoAssemblyProcessRunner,
} from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import {
  ProductionDurationPreflightError,
  ProductionSceneMappingError,
  allocateProductionSceneAudioSegments,
  validateProductionAcceptancePreflight,
  validateProductionSceneAudioMapping,
} from "../src/lib/production/ProductionAcceptancePreflight";
import { runProductionAcceptanceCommand } from "../src/lib/production/ProductionAcceptanceCommand";
import {
  createProductionAcceptanceMarker,
  markProductionAcceptanceValidated,
  productionAcceptanceConfigurationFingerprint,
  readProductionAcceptanceMarker,
} from "../src/lib/production/ProductionAcceptancePolicy";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import type { ScriptData } from "../src/types/script";
import type { SceneData } from "../src/types/scene";
import type { AudioData } from "../src/types/audio";
import type { AssemblyPlanData } from "../src/types/assembly";
import type { ProductionReadinessReport } from "../src/types/productionReadiness";
import type { ProductionAcceptanceResult } from "../src/lib/production/ProductionAcceptanceOrchestrator";
import {
  requiresProductionAcceptanceResume,
  resumeProductionAcceptanceIfNeeded,
  validateProductionAcceptanceRegistryAssets,
} from "../src/lib/production/ProductionAcceptanceOrchestrator";
import { validateStrictProductionResumeState } from "../src/lib/pipeline/PipelineRunner";
import { readProductionAcceptancePolicy } from "../src/lib/production/ProductionAcceptancePolicy";
import type { Asset } from "../src/types/asset";

let passed = 0;
const test = async (name: string, action: () => void | Promise<void>) => {
  await action();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
};

const now = "2026-07-15T00:00:00.000Z";
function script(chapters: Array<{ id: number; duration: number }>, estimatedDuration = 90): ScriptData {
  return {
    topic: "fixture", title: "fixture", subtitle: "fixture", hook: "fixture",
    introduction: "fixture", conclusion: "fixture", callToAction: "fixture",
    chapters: chapters.map((chapter) => ({
      ...chapter, title: `chapter-${chapter.id}`, narration: "fixture narration",
      visualGoal: "fixture", emotion: "fixture", transition: "fade",
    })),
    estimatedDuration, narrationWordCount: 10, targetAudience: "general", language: "tr",
    voiceStyle: "documentary", musicStyle: "cinematic", thumbnailIdea: "fixture",
    seoKeywords: [], createdAt: now,
  };
}
function scenes(items: Array<{ id: number; chapterId?: number; duration: number }>): SceneData {
  return { scenes: items.map((item) => ({ ...item, title: "scene", description: "scene", visualPrompt: "scene" })), createdAt: now };
}
function audio(chapterIds: number[]): AudioData {
  return {
    narrator: { style: "fixture", tone: "fixture", language: "tr" },
    sections: chapterIds.map((chapterId) => ({ chapterId, title: "fixture", duration: "00:45", emotion: "fixture", emphasis: [], narrationNotes: "fixture", pacing: "fixture", sourceText: "fixture" })),
    music: { mood: "fixture", suggestion: "fixture", intensity: "fixture" },
    production: { targetFormat: "wav", sampleRate: 44100, estimatedTotalDuration: "01:30", generationStatus: "planned" },
    createdAt: now,
  };
}
function assembly(items: Array<{ sceneId: number; chapterId?: number }>): AssemblyPlanData {
  return {
    scenes: items.map((item) => ({ ...item, duration: "00:45", visualReference: "fixture", audioReference: "fixture", transition: "fade", cameraMovement: "zoom", effects: [] })),
    totalDuration: "01:30", style: "fixture", createdAt: now,
  };
}

function wav(dataLength = 16_000) {
  const value = Buffer.alloc(44 + dataLength);
  value.write("RIFF", 0); value.writeUInt32LE(value.length - 8, 4);
  value.write("WAVE", 8); value.write("fmt ", 12); value.writeUInt32LE(16, 16);
  value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22);
  value.writeUInt32LE(8_000, 24); value.writeUInt32LE(16_000, 28);
  value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34);
  value.write("data", 36); value.writeUInt32LE(dataLength, 40);
  return value;
}

function box(type: string, payload = Buffer.alloc(0)) {
  const value = Buffer.alloc(8 + payload.length);
  value.writeUInt32BE(value.length, 0); value.write(type, 4, 4, "ascii");
  payload.copy(value, 8);
  return value;
}

function mp4() {
  return Buffer.concat([
    box("ftyp", Buffer.from("isom0000")), box("moov"),
    box("mdat", Buffer.from([0, 1, 2, 3])),
  ]);
}

async function main() {
await test("one chapter one scene", () => {
  validateProductionAcceptancePreflight(script([{ id: 1, duration: 90 }]), scenes([{ id: 10, chapterId: 1, duration: 90 }]));
});
await test("one chapter multiple ordered scenes", () => {
  validateProductionAcceptancePreflight(script([{ id: 1, duration: 90 }]), scenes([{ id: 10, chapterId: 1, duration: 40 }, { id: 11, chapterId: 1, duration: 50 }]));
});
await test("multiple chapters different scene counts", () => {
  validateProductionAcceptancePreflight(script([{ id: 1, duration: 40 }, { id: 2, duration: 50 }]), scenes([{ id: 10, chapterId: 1, duration: 40 }, { id: 20, chapterId: 2, duration: 20 }, { id: 21, chapterId: 2, duration: 30 }]));
});
await test("unknown chapter rejected", () => assert.throws(() => validateProductionAcceptancePreflight(script([{ id: 1, duration: 90 }]), scenes([{ id: 1, chapterId: 2, duration: 90 }])), ProductionSceneMappingError));
await test("ownerless scene rejected", () => assert.throws(() => validateProductionAcceptancePreflight(script([{ id: 1, duration: 90 }]), scenes([{ id: 1, duration: 90 }])), ProductionSceneMappingError));
await test("chapter without scene rejected", () => assert.throws(() => validateProductionAcceptancePreflight(script([{ id: 1, duration: 45 }, { id: 2, duration: 45 }]), scenes([{ id: 1, chapterId: 1, duration: 45 }])), ProductionSceneMappingError));
await test("duplicate scene id rejected", () => assert.throws(() => validateProductionAcceptancePreflight(script([{ id: 1, duration: 90 }]), scenes([{ id: 1, chapterId: 1, duration: 45 }, { id: 1, chapterId: 1, duration: 45 }])), ProductionSceneMappingError));
await test("duplicate audio chapter rejected", () => assert.throws(() => validateProductionSceneAudioMapping(scenes([{ id: 1, chapterId: 1, duration: 90 }]), audio([1, 1])), ProductionSceneMappingError));
await test("scene audio assembly mapping accepts one-to-many", () => validateProductionSceneAudioMapping(scenes([{ id: 1, chapterId: 1, duration: 45 }, { id: 2, chapterId: 1, duration: 45 }]), audio([1]), assembly([{ sceneId: 1, chapterId: 1 }, { sceneId: 2, chapterId: 1 }])));
await test("chapter audio is split into ordered scene segments", () => {
  const segments = allocateProductionSceneAudioSegments(
    scenes([{ id: 1, chapterId: 1, duration: 30 }, { id: 2, chapterId: 1, duration: 60 }]),
    new Map([[1, 45]]),
  );
  assert.deepEqual(segments.get(1), { chapterId: 1, sceneId: 1, startSeconds: 0, durationSeconds: 15 });
  assert.deepEqual(segments.get(2), { chapterId: 1, sceneId: 2, startSeconds: 15, durationSeconds: 30 });
});
await test("duration below 60 rejected", () => assert.throws(() => validateProductionAcceptancePreflight(script([{ id: 1, duration: 59 }], 59), scenes([{ id: 1, chapterId: 1, duration: 59 }])), ProductionDurationPreflightError));
await test("duration above 120 rejected", () => assert.throws(() => validateProductionAcceptancePreflight(script([{ id: 1, duration: 121 }], 121), scenes([{ id: 1, chapterId: 1, duration: 121 }])), ProductionDurationPreflightError));
await test("negative and NaN durations rejected", () => {
  assert.throws(() => validateProductionAcceptancePreflight(script([{ id: 1, duration: -1 }]), scenes([{ id: 1, chapterId: 1, duration: 90 }])), ProductionDurationPreflightError);
  assert.throws(() => validateProductionAcceptancePreflight(script([{ id: 1, duration: Number.NaN }]), scenes([{ id: 1, chapterId: 1, duration: 90 }])), ProductionDurationPreflightError);
});

const originalKey = process.env.OPENAI_API_KEY;
const originalTimeout = process.env.IMAGE_OPENAI_TIMEOUT_MS;
const originalLimit = process.env.IMAGE_OPENAI_MAX_RESPONSE_BYTES;
process.env.OPENAI_API_KEY = "fixture-key";
const imageSlug = `sprint-128-1-image-${crypto.randomUUID()}`;
try {
  await test("URL-only production image rejected", async () => {
    const provider = new OpenAIImageProvider({ fetcher: async () => Response.json({ data: [{ url: "https://example.invalid/image.png" }] }) });
    const result = await provider.generateImage({ sceneId: 1, prompt: "fixture", projectSlug: imageSlug });
    assert.equal(result.success, false);
  });
  await test("image timeout normalized", async () => {
    process.env.IMAGE_OPENAI_TIMEOUT_MS = "100";
    const provider = new OpenAIImageProvider({ fetcher: ((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("secret timeout")), { once: true }))) as typeof fetch });
    const result = await provider.generateImage({ sceneId: 1, prompt: "fixture", projectSlug: imageSlug });
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error, "Image generation failed.");
  });
  await test("image response limit normalized", async () => {
    process.env.IMAGE_OPENAI_MAX_RESPONSE_BYTES = "1024";
    const provider = new OpenAIImageProvider({ fetcher: async () => new Response("{}", { headers: { "content-length": "2048" } }) });
    const result = await provider.generateImage({ sceneId: 1, prompt: "fixture", projectSlug: imageSlug });
    assert.equal(result.success, false);
  });
} finally {
  restore("OPENAI_API_KEY", originalKey); restore("IMAGE_OPENAI_TIMEOUT_MS", originalTimeout); restore("IMAGE_OPENAI_MAX_RESPONSE_BYTES", originalLimit);
  safeRemoveProject(imageSlug);
}

const blockedReadiness = { schemaVersion: "1", generatedAt: now, ready: false, checks: [{ id: "environment", status: "NOT_CONFIGURED", reasonCode: "REQUIRED_ENVIRONMENT_MISSING", critical: true }] } as unknown as ProductionReadinessReport;
const fakeCompletion = { completion: { projectSlug: "acceptance-fixture", published: false, productionReady: true } } as unknown as ProductionAcceptanceResult;
await test("readiness-only performs no execution", async () => {
  let executions = 0;
  const result = await runProductionAcceptanceCommand(["readiness-only"], { readiness: async () => blockedReadiness, execute: async () => { executions += 1; return fakeCompletion; }, resume: async () => { executions += 1; return fakeCompletion; } });
  assert.equal(result.exitCode, 1); assert.equal(executions, 0);
});
await test("execute requires explicit confirmation", async () => {
  let executions = 0;
  const result = await runProductionAcceptanceCommand(["execute"], { readiness: async () => blockedReadiness, execute: async () => { executions += 1; return fakeCompletion; }, resume: async () => fakeCompletion });
  assert.equal(result.exitCode, 2); assert.equal(executions, 0);
});
await test("resume-finalize preserves project slug", async () => {
  let resumed = "";
  const slug = "acceptance-fixture";
  const result = await runProductionAcceptanceCommand(["resume-finalize", `--project-slug=${slug}`, "--confirm-production-acceptance"], { readiness: async () => blockedReadiness, execute: async () => fakeCompletion, resume: async (value) => { resumed = value; return fakeCompletion; } });
  assert.equal(result.exitCode, 0); assert.equal(resumed, slug);
});

const markerSlug = `sprint-128-1-marker-${crypto.randomUUID()}`;
try {
  await test("prepared marker is not production-ready and remains package-only unpublished", async () => {
    await createProductionAcceptanceMarker(markerSlug, crypto.randomUUID(), productionAcceptanceConfigurationFingerprint());
    const marker = await readProductionAcceptanceMarker(markerSlug);
    assert.equal(marker.productionReady, false);
    assert.equal(marker.acceptanceStatus, "prepared");
    assert.equal(marker.published, false);
  });
} finally { safeRemoveProject(markerSlug); }

await test("completed finalize replay skips pipeline resume", async () => {
  let resumeCalls = 0;
  await resumeProductionAcceptanceIfNeeded(
    { blocked: false, startStage: null },
    "acceptance-fixture",
    async () => {
      resumeCalls += 1;
      return { success: false, blocked: false };
    },
  );
  assert.equal(resumeCalls, 0);
  assert.equal(requiresProductionAcceptanceResume({ blocked: false, startStage: null }, "acceptance-fixture"), false);
  assert.equal(requiresProductionAcceptanceResume({ blocked: false, startStage: "assembly" }, "acceptance-fixture"), true);
});

const strictResumeSlug = `sprint-128-2-strict-resume-${crypto.randomUUID()}`;
try {
  await test("strict resume rejects legacy scene identity before provider invocation", async () => {
    await createProductionAcceptanceMarker(strictResumeSlug, crypto.randomUUID(), productionAcceptanceConfigurationFingerprint());
    const policy = await readProductionAcceptancePolicy(strictResumeSlug);
    assert.throws(() => validateStrictProductionResumeState({
      project: { id: "fixture", slug: strictResumeSlug, title: "fixture", status: "draft", createdAt: now, updatedAt: now },
      research: null,
      script: script([{ id: 1, duration: 90 }]),
      scenes: scenes([{ id: 1, duration: 90 }]),
      visuals: null, animation: null, video: null, audio: null, assembly: null,
      thumbnail: null, seo: null, youtube: null, exportPackage: null,
    }, "visuals", policy?.strictProductionAcceptance === true), ProductionSceneMappingError);
  });
} finally { safeRemoveProject(strictResumeSlug); }

const registrySlug = "sprint-128-2-registry";
const registryProjectId = "registry-project";
const registryVideo = {
  id: "assembly-video", projectId: registryProjectId, projectSlug: registrySlug,
  type: "video", status: "generated", provider: "ffmpeg", prompt: "fixture",
  filePath: `data/projects/${registrySlug}/assets/videos/final.mp4`,
  url: `/api/assets/videos/${registrySlug}/final.mp4`, mimeType: "video/mp4",
  byteLength: 100, createdAt: now,
} as Asset;
const registryInput = {
  projectId: registryProjectId, projectSlug: registrySlug,
  assemblyAssetId: "assembly-video",
  assemblyFilePath: registryVideo.filePath,
  assemblyUrl: registryVideo.url,
  assemblyByteLength: registryVideo.byteLength,
  thumbnailAssetId: "thumbnail-id",
  youtubeVideoAssetId: "assembly-video",
  youtubeThumbnailAssetId: "thumbnail-id",
};
await test("missing registry asset rejects finalization", () => {
  assert.throws(() => validateProductionAcceptanceRegistryAssets({ ...registryInput, assets: [] }));
});
await test("wrong registry asset type rejects finalization", () => {
  assert.throws(() => validateProductionAcceptanceRegistryAssets({
    ...registryInput,
    assets: [{ ...registryVideo, type: "audio" }],
  }));
});
await test("duplicate registry asset rejects finalization", () => {
  assert.throws(() => validateProductionAcceptanceRegistryAssets({
    ...registryInput,
    assets: [registryVideo, { ...registryVideo }],
  }));
});

const imageAssemblySlug = `sprint-128-2-image-assembly-${crypto.randomUUID()}`;
const previousFFmpeg = process.env.FFMPEG_PATH;
const previousFFprobe = process.env.FFPROBE_PATH;
try {
  await test("image assembly applies chapter audio offset and PTS reset", async () => {
    process.env.FFMPEG_PATH = process.execPath;
    process.env.FFPROBE_PATH = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
    const image = ImageStorage.saveImage({
      projectSlug: imageAssemblySlug,
      data: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(4)]),
      mimeType: "image/png",
    });
    const audioFile = AudioStorage.saveAudio({ projectSlug: imageAssemblySlug, data: wav() });
    class OffsetRunner implements VideoAssemblyProcessRunner {
      filter = "";
      calls: readonly string[][] = [];
      async run(_executable: string, args: readonly string[]): Promise<ProcessRunResult> {
        this.calls = [...this.calls, [...args]];
        const filterIndex = args.indexOf("-filter_complex");
        if (filterIndex >= 0) {
          this.filter = args[filterIndex + 1] ?? "";
          fs.writeFileSync(args.at(-1) as string, mp4());
          return { exitCode: 0, signal: null, stdout: "", timedOut: false };
        }
        return {
          exitCode: 0, signal: null, timedOut: false,
          stdout: JSON.stringify({
            format: { format_name: "mov,mp4", duration: "0.5" },
            streams: [
              { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, pix_fmt: "yuv420p", avg_frame_rate: "30/1", duration: "0.5", disposition: { attached_pic: 0 } },
              { codec_type: "audio", codec_name: "aac", duration: "0.5" },
            ],
          }),
        };
      }
    }
    const runner = new OffsetRunner();
    const result = await new FFmpegVideoAssemblyProvider(runner).assemble({
      projectSlug: imageAssemblySlug,
      scenes: [{
        inputType: "image", sceneId: 1, chapterId: 1,
        imageFilePath: image.filePath, audioFilePath: audioFile.filePath,
        audioStartSeconds: 0.25, durationSeconds: 0.5,
      }],
    });
    assert.equal(result.success, true, JSON.stringify({ result, calls: runner.calls }));
    assert.match(runner.filter, /atrim=start=0\.250000:end=0\.750000,atrim=duration=0\.500000,asetpts=PTS-STARTPTS/);
  });
} finally {
  restore("FFMPEG_PATH", previousFFmpeg);
  restore("FFPROBE_PATH", previousFFprobe);
  safeRemoveProject(imageAssemblySlug);
}

await test("non-strict legacy JSON preserves opening and closing contract", async () => {
  let prompt = "";
  const usageSlug = `sprint-128-2-non-strict-ai-${crypto.randomUUID()}`;
  const result = await AIManager.runScenes(script([{ id: 1, duration: 90 }]), {
    projectSlug: usageSlug, stage: "scenes", operation: "scenes",
  }, {
    generate: async (value) => {
      prompt = value;
      return JSON.stringify({
        scenes: [{ id: 1, title: "opening", description: "legacy", visualPrompt: "legacy", duration: 90 }],
        createdAt: now,
      });
    },
  });
  assert.equal(result.scenes[0].chapterId, undefined);
  assert.match(prompt, /one opening scene, one scene per script chapter, and one closing scene/);
  assert.doesNotMatch(prompt, /"chapterId": 1/);
  safeRemoveProject(usageSlug);
});

await test("production strict JSON requires chapter identity", async () => {
  let prompt = "";
  const usageSlug = `sprint-128-2-strict-ai-${crypto.randomUUID()}`;
  const result = await AIManager.runScenes(script([{ id: 1, duration: 90 }]), {
    projectSlug: usageSlug, stage: "scenes", operation: "scenes",
  }, {
    generate: async (value) => {
      prompt = value;
      return JSON.stringify({
        scenes: [{ id: 1, chapterId: 1, title: "strict", description: "strict", visualPrompt: "strict", duration: 90 }],
        createdAt: now,
      });
    },
  }, strictGenerationExecutionPolicy);
  assert.equal(result.scenes[0].chapterId, 1);
  assert.match(prompt, /"chapterId": 1/);
  assert.match(prompt, /chapterId must reference an existing script chapter id/);
  safeRemoveProject(usageSlug);
});

const replaySlug = `sprint-128-2-replay-${crypto.randomUUID()}`;
try {
  await test("finalize marker replay is idempotent", async () => {
    const fingerprint = productionAcceptanceConfigurationFingerprint();
    await createProductionAcceptanceMarker(replaySlug, crypto.randomUUID(), fingerprint);
    await markProductionAcceptanceValidated(replaySlug, fingerprint);
    const first = JSON.parse(fs.readFileSync(path.join(ProjectReader.getProjectFolder(replaySlug), "production-acceptance.json"), "utf8"));
    await markProductionAcceptanceValidated(replaySlug, fingerprint);
    const second = JSON.parse(fs.readFileSync(path.join(ProjectReader.getProjectFolder(replaySlug), "production-acceptance.json"), "utf8"));
    assert.deepEqual(second, first);
  });
  await test("productionReady duplicate transition remains protected", async () => {
    const marker = await readProductionAcceptanceMarker(replaySlug);
    assert.equal(marker.acceptanceStatus, "validated");
    assert.equal(marker.productionReady, true);
    assert.equal(marker.published, false);
  });
} finally { safeRemoveProject(replaySlug); }

process.stdout.write(`Sprint 128.2 P1 hardening smoke PASS: ${passed} scenarios.\n`);
}

void main().catch((error) => {
  process.stderr.write(`Sprint 128.2 P1 hardening smoke FAILED: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
});

function restore(name: string, value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
function safeRemoveProject(slug: string) {
  const root = path.resolve(ProjectReader.getProjectsRoot());
  const target = path.resolve(ProjectReader.getProjectFolder(slug));
  if (target.startsWith(`${root}${path.sep}`) && path.basename(target) === slug) fs.rmSync(target, { recursive: true, force: true });
}
