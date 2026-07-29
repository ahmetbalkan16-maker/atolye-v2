import assert from "node:assert/strict";
import { emitSmokeResult } from "./lib/SmokeResult";
import fs, { promises as fsp } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { AudioPipeline, AudioAssetGenerationError } from "../src/lib/audio/AudioPipeline";
import {
  AudioAssetRootError,
  AudioCanonicalAdmissionConflictError,
  createAudioAssetErrorEvidence,
  getAudioAssetErrorEvidence,
  serializeAudioAssetErrorEvidence,
} from "../src/lib/audio/AudioAssetError";
import { OpenAIAudioProvider } from "../src/lib/audio/providers/OpenAIAudioProvider";
import { MockAudioProvider } from "../src/lib/audio/providers/MockAudioProvider";
import { AudioProviderRouter } from "../src/lib/audio/providers/AudioProviderRouter";
import { getOpenAIAudioProviderConfig } from "../src/lib/audio/providers/AudioProviderConfig";
import {
  getAudioPublicationLifecycleState,
  getCommittedAudioPublicationAssets,
  getPreparedAudioPublicationIntent,
} from
  "../src/lib/audio/AudioPublicationIntentStore";
import {
  AUDIO_IDENTIFIER_MAX_LENGTH,
  isSafeAudioIdentifier,
} from "../src/lib/audio/AudioIdentifierPolicy";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import { VideoStorage } from "../src/lib/assets/storage/VideoStorage";
import { GET as getAudioAsset } from "../app/api/assets/audio/[slug]/[fileName]/route";
import { publishFilePortableNoClobber } from "../src/lib/runtime/security/PortableNoClobberFilePublisher";
import {
  getDeferredAudioCompensationBacklogStatus,
  isSafeAudioCompensationRef,
  removeRegistryOwnedAudioCompensationRecord as removeRegistryRecordWithAuthority,
} from "../src/lib/audio/AudioCompensationStore";
import { AssetManager } from "../src/lib/assets/AssetManager";
import {
  VideoAssemblyError,
  VideoAssemblyManager,
} from "../src/lib/assembly/VideoAssemblyManager";
import type { VideoAssemblyProvider } from "../src/lib/assembly/providers/VideoAssemblyProvider";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { prepareFailedStageRetry } from "../src/lib/pipeline/PipelineFailedStageRetry";
import { PipelineStageExecutor } from "../src/lib/pipeline/PipelineStageExecutor";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { MockAIProvider } from "../src/lib/ai/providers/MockAIProvider";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import {
  acquireProjectWriteAuthority,
  createRuntimeStorageContext,
  type RuntimeStorageAuthorityLease,
  type RuntimeStorageContext,
} from "../src/lib/runtime/RuntimeStoragePaths";
import {
  ProductionPipelineExecutionAdapter,
  ProductionPipelineDurableExecutionError,
} from "../src/lib/production/ProductionPipelineExecutionAdapter";
import { prepareProductionPipelineExecution } from "../src/lib/production/ProductionPipelineExecutionFactory";
import { validateProductionExecutionWorkerResult } from "../src/lib/production/ProductionExecutionWorker";
import type { AudioData } from "../src/types/audio";
import {
  audioAssetRootErrorCodes,
  type AudioAssetFailurePhase,
  type AudioAssetRootErrorCode,
} from "../src/types/audioError";
import type {
  AudioGenerationInput,
  AudioProvider,
} from "../src/lib/audio/providers/AudioProvider";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";

const originalEnvironment = {
  provider: process.env.AUDIO_PROVIDER,
  apiKey: process.env.OPENAI_API_KEY,
  timeout: process.env.OPENAI_TTS_TIMEOUT_MS,
  responseBytes: process.env.OPENAI_TTS_MAX_RESPONSE_BYTES,
  model: process.env.OPENAI_TTS_MODEL,
  voice: process.env.OPENAI_TTS_VOICE,
};
const originalFetch = globalThis.fetch;
let scenarios = 0;

function wav(dataBytes = 1600): Buffer {
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

function mp4Box(type: string, payload = Buffer.alloc(0)): Buffer {
  const result = Buffer.alloc(8 + payload.length);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, "ascii");
  payload.copy(result, 8);
  return result;
}

function minimalMp4(): Buffer {
  return Buffer.concat([
    mp4Box("ftyp", Buffer.from("isom0000")),
    mp4Box("moov"),
    mp4Box("mdat", Buffer.from([0, 1, 2, 3])),
  ]);
}

function customWav({
  format = 1,
  channels = 1,
  sampleRate = 8000,
  bitsPerSample = 16,
  dataBytes = 1600,
  blockAlign = channels * (bitsPerSample / 8),
  byteRate = sampleRate * blockAlign,
  declaredDataBytes = dataBytes,
  fmtSize = 16,
  cbSize = 0,
}: {
  format?: number;
  channels?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  dataBytes?: number;
  blockAlign?: number;
  byteRate?: number;
  declaredDataBytes?: number;
  fmtSize?: number;
  cbSize?: number;
} = {}): Buffer {
  const fmtPadding = fmtSize % 2;
  const padding = dataBytes % 2;
  const dataOffset = 12 + 8 + fmtSize + fmtPadding;
  const buffer = Buffer.alloc(dataOffset + 8 + dataBytes + padding);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(fmtSize, 16);
  buffer.writeUInt16LE(format, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  if (fmtSize >= 18) {
    buffer.writeUInt16LE(cbSize, 36);
    buffer.fill(0xa5, 38, 20 + fmtSize);
  } else if (fmtSize === 17) {
    buffer[36] = 0xa5;
  }
  buffer.write("data", dataOffset, "ascii");
  buffer.writeUInt32LE(declaredDataBytes, dataOffset + 4);
  return buffer;
}

function logicalFileBytes(root: string): number {
  let total = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    assert(current);
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      const stat = fs.lstatSync(candidate);
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) pending.push(candidate);
      else if (stat.isFile()) total += stat.size;
      else assert.fail("unexpected deferred workspace entry");
    }
  }
  return total;
}

function compensationWorkspacePath(
  context: RuntimeStorageContext,
  projectSlug: string,
  compensationRef: string,
): string {
  return path.join(
    context.projectsRoot,
    projectSlug,
    "production-execution",
    "audio-compensation-cleanup",
    compensationRef,
  );
}

function compensationQuarantinePath(
  context: RuntimeStorageContext,
  projectSlug: string,
  compensationRef: string,
): string {
  return path.join(
    compensationWorkspacePath(context, projectSlug, compensationRef),
    "quarantine",
    "owned.wav",
  );
}

function directoryByteSnapshot(root: string): ReadonlyArray<{
  readonly relativePath: string;
  readonly bytes: string;
}> {
  const files: Array<{ relativePath: string; bytes: string }> = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    assert(current);
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(candidate);
        continue;
      }
      assert.equal(entry.isFile(), true);
      files.push({
        relativePath: path.relative(root, candidate).replaceAll("\\", "/"),
        bytes: fs.readFileSync(candidate).toString("base64"),
      });
    }
  }
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

function chunkedWav(chunks: Array<{ id: string; bytes: Buffer }>): Buffer {
  const encoded = chunks.map(({ id, bytes }) => {
    const chunk = Buffer.alloc(8 + bytes.length + (bytes.length % 2));
    chunk.write(id, 0, "ascii");
    chunk.writeUInt32LE(bytes.length, 4);
    bytes.copy(chunk, 8);
    return chunk;
  });
  const body = Buffer.concat(encoded);
  const buffer = Buffer.alloc(12 + body.length);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8, "ascii");
  body.copy(buffer, 12);
  return buffer;
}

function basicFmtBytes(): Buffer {
  return customWav().subarray(20, 36);
}

function audioData(sourceText = "Bounded narration fixture."): AudioData {
  return {
    narrator: { style: "documentary", tone: "calm", language: "tr" },
    sections: [{
      chapterId: 1,
      title: "Fixture",
      duration: "00:01",
      emotion: "calm",
      emphasis: [],
      narrationNotes: "fixture",
      pacing: "medium",
      sourceText,
    }],
    music: { mood: "none", suggestion: "none", intensity: "none" },
    production: {
      targetFormat: "wav",
      sampleRate: 8000,
      estimatedTotalDuration: "00:01",
      generationStatus: "planned",
    },
    createdAt: "2026-07-18T00:00:00.000Z",
  };
}

async function scenario(name: string, test: () => unknown | Promise<unknown>) {
  await test();
  scenarios += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarios}: ${name}`);
}

function withProjectAuthority<T>(
  projectSlug: string,
  context: RuntimeStorageContext,
  action: (authority: RuntimeStorageAuthorityLease) => T,
): T {
  const authority = acquireProjectWriteAuthority(projectSlug, context);
  try {
    return action(authority);
  } finally {
    authority.release();
  }
}

function removeRegistryRecord(
  projectSlug: string,
  compensationRef: string,
  context: RuntimeStorageContext,
): void {
  withProjectAuthority(projectSlug, context, (authority) =>
    removeRegistryRecordWithAuthority(
      projectSlug,
      compensationRef,
      authority,
      context,
    )
  );
}

function response(
  bytes: Buffer,
  options: { status?: number; contentType?: string | null; contentLength?: string } = {},
): Response {
  const headers = new Headers();
  if (options.contentType !== null) {
    headers.set("Content-Type", options.contentType ?? "audio/wav");
  }
  if (options.contentLength !== undefined) {
    headers.set("Content-Length", options.contentLength);
  }
  return new Response(new Uint8Array(bytes), {
    status: options.status ?? 200,
    headers,
  });
}

async function providerFailure(
  slug: string,
  expected: AudioAssetRootErrorCode,
  fetchImplementation: typeof fetch,
) {
  globalThis.fetch = fetchImplementation;
  const result = await new OpenAIAudioProvider().generateAudio({
    target: { kind: "section", chapterId: 1 },
    sourceText: "Fixture narration.",
    projectSlug: slug,
  });
  assert.equal(result.success, false);
  assert.equal(result.evidence?.rootCode, expected);
  assert.equal(result.error, "Audio generation failed.");
  assert.equal(result.evidence?.code, "AUDIO_ASSET_GENERATION_FAILED");
  assert.equal(result.evidence?.target, "section");
  assert.equal(result.evidence?.chapterId, 1);
  return result;
}

function assertAudioRoot(error: unknown, rootCode: AudioAssetRootErrorCode) {
  assert(error instanceof AudioAssetGenerationError || error instanceof AudioAssetRootError);
  const evidence = getAudioAssetErrorEvidence(error);
  assert.equal(evidence?.rootCode, rootCode);
  assert.equal(error.stack, undefined);
  return true;
}

async function latestAttemptEvidence(
  prepared: Awaited<ReturnType<typeof prepareProductionPipelineExecution>>,
) {
  const attemptId = prepared.request.coordinator.attempt.attemptId;
  const listed = await prepared.adapter.listKeys("attempt");
  assert.equal(listed.ok, true);
  const key = listed.ok
    ? listed.keys
        .filter((candidate) => candidate.startsWith(`${attemptId}-v`))
        .sort((left, right) =>
          Number(right.slice(right.lastIndexOf("-v") + 2)) -
          Number(left.slice(left.lastIndexOf("-v") + 2)))[0]
    : undefined;
  assert(key);
  const read = await prepared.adapter.read("attempt", key);
  assert.equal(read.status, "found");
  return read.status === "found" ? read.value : undefined;
}

function providerForSavedAudio(
  saved: ReturnType<typeof AudioStorage.saveAudio>,
): AudioProvider {
  return {
    name: "openai",
    validateInput(): void {},
    async generateAudio(input: AudioGenerationInput) {
      return AudioStorage.transferPublicationOwnership(saved, {
        success: true as const,
        target: input.target,
        provider: "openai" as const,
        model: "mock-tts-model",
        filePath: saved.filePath,
        url: saved.url,
        mimeType: "audio/wav" as const,
        byteLength: saved.byteLength,
        durationSeconds: saved.durationSeconds,
        createdAt: new Date().toISOString(),
      });
    },
  };
}

type AudioRunnerHarness = {
  runPipelineStage(
    projectSlug: string,
    stage: "audio",
    state: ReturnType<typeof PipelineStageExecutor.createInitialState>,
    runType?: "initial" | "retry",
    onClaimConflict?: () => void,
    stageExecution?: {
      aiProvider?: MockAIProvider;
      audioProvider?: OpenAIAudioProvider;
    },
  ): Promise<boolean>;
};

const audioRunner = PipelineRunner as unknown as AudioRunnerHarness;

function scriptFixture() {
  return {
    topic: "fixture",
    title: "Fixture",
    subtitle: "Fixture",
    hook: "Fixture",
    introduction: "Fixture",
    chapters: [{
      id: 1,
      title: "Fixture",
      narration: "Bounded narration fixture.",
      duration: 1,
      visualGoal: "Fixture",
      emotion: "calm",
      transition: "cut",
    }],
    conclusion: "Fixture",
    callToAction: "Fixture",
    estimatedDuration: 1,
    narrationWordCount: 3,
    targetAudience: "test",
    language: "tr",
    voiceStyle: "documentary",
    musicStyle: "none",
    thumbnailIdea: "fixture",
    seoKeywords: ["fixture"],
    createdAt: "2026-07-18T00:00:00.000Z",
  };
}

function latestDurableAttempt(projectsRoot: string, projectSlug: string) {
  const directory = path.join(
    projectsRoot,
    projectSlug,
    "production-execution",
    "attempts",
  );
  const records = fs.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")) as {
      state: string;
      attemptVersion: number;
      identity: { attemptId: string };
      journal: Array<{ entryType: string; evidence: string[] }>;
    });
  assert(records.length > 0);
  return records.sort((left, right) => right.attemptVersion - left.attemptVersion)[0];
}

async function assertFullAudioFailureChain(input: {
  name: string;
  projectsRoot: string;
  rootCode: AudioAssetRootErrorCode;
  phase: string;
  cleanup?: ReturnType<typeof createAudioAssetErrorEvidence>["cleanup"];
  compensation?: ReturnType<typeof createAudioAssetErrorEvidence>["compensation"];
  configure: (project: Awaited<ReturnType<typeof ProjectManager.createProject>>) =>
    void | (() => void);
  afterFailure?: (context: {
    project: Awaited<ReturnType<typeof ProjectManager.createProject>>;
    evidence: NonNullable<ReturnType<typeof getAudioAssetErrorEvidence>>;
  }) => void | Promise<void>;
}) {
  const project = await ProjectManager.createProject(`Sprint 129 27 e2e ${input.name}`);
  await PipelineJobManager.listJobs(project.slug);
  const state = PipelineStageExecutor.createInitialState(project);
  state.script = scriptFixture();
  const restore = input.configure(project);
  let failure: unknown;
  let stageFailure: unknown;
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => {
    const detail = values[1] as { slug?: unknown; stage?: unknown; error?: unknown } | undefined;
    if (detail?.slug === project.slug && detail.stage === "audio") {
      stageFailure = detail.error;
    }
  };
  try {
    await audioRunner.runPipelineStage(
      project.slug,
      "audio",
      state,
      "initial",
      undefined,
      { aiProvider: new MockAIProvider(), audioProvider: new OpenAIAudioProvider() },
    );
    assert.fail("audio stage must fail");
  } catch (error) {
    failure = error;
  } finally {
    console.error = originalConsoleError;
    restore?.();
  }

  assert(
    failure instanceof ProductionPipelineDurableExecutionError,
    `unexpected durable failure ${JSON.stringify({
      name: failure instanceof Error ? failure.name : typeof failure,
      message: failure instanceof Error ? failure.message : String(failure),
      code: (failure as { code?: unknown })?.code,
      reasonCode: (failure as { reasonCode?: unknown })?.reasonCode,
    })}`,
  );
  assert.equal(failure.reasonCode, "WORKER_EXECUTION_FAILED");
  assert.equal(getAudioAssetErrorEvidence(failure), undefined);
  assert(stageFailure instanceof AudioAssetGenerationError);
  assert.equal(stageFailure.code, "AUDIO_ASSET_GENERATION_FAILED");
  const evidence = getAudioAssetErrorEvidence(stageFailure);
  assert(evidence);
  assert.equal(evidence.rootCode, input.rootCode, input.name);
  assert.equal(evidence.phase, input.phase);
  assert.equal(evidence.cleanup, input.cleanup);
  assert.equal(evidence.compensation, input.compensation);

  const job = await PipelineJobManager.getJobForStageReadOnly(project.slug, "audio");
  const manifest = await ProjectManager.getManifest(project.slug);
  const history = await PipelineJobManager.listHistory(project.slug);
  assert.equal(job?.error, stageFailure.code);
  assert.deepEqual(job?.errorEvidence, evidence);
  assert.equal(manifest?.packages.audio.error, stageFailure.code);
  assert.deepEqual(manifest?.packages.audio.errorEvidence, evidence);
  const historyFailure = history.events.at(-1);
  assert.equal(historyFailure?.errorCode, stageFailure.code);
  assert.deepEqual(historyFailure?.errorEvidence, evidence);

  const attempt = latestDurableAttempt(input.projectsRoot, project.slug);
  assert.equal(attempt.state, "failed");
  const terminal = attempt.journal.at(-1);
  assert(terminal);
  assert(
    terminal.evidence.includes(`audio-root:${input.rootCode}`),
    `${input.name} terminal evidence ${JSON.stringify(terminal.evidence)}`,
  );
  assert(
    terminal.evidence.includes(`audio-phase:${input.phase}`),
    `${input.name} terminal evidence ${JSON.stringify(terminal.evidence)}`,
  );
  if (input.cleanup) assert(terminal.evidence.includes(`audio-cleanup:${input.cleanup}`));
  if (input.compensation) {
    assert(terminal.evidence.includes(`audio-compensation:${input.compensation}`));
  }
  const serialized = JSON.stringify({ failure, stageFailure, job, manifest, history, attempt });
  assert.doesNotMatch(
    serialized,
    /Authorization|API_KEY|mock-key-never-sent|[a-zA-Z]:[\\/]|stack|narration|network fixture failure|not-a-wav|aborted fixture/i,
  );

  const projectRoot = path.join(input.projectsRoot, project.slug);
  const audioRoot = path.join(projectRoot, "assets", "audio");
  await input.afterFailure?.({ project, evidence });
  const assets = AssetManager.getProjectAssets(project.slug, project.id);
  assert.equal(
    assets.assets.some((asset) => asset.type === "audio" && asset.status === "generated"),
    false,
  );
  assert.equal(fs.existsSync(path.join(projectRoot, "audio.json")), false);
  if (fs.existsSync(audioRoot)) {
    const residue = fs.readdirSync(audioRoot, { recursive: true });
    assert.deepEqual(residue, []);
  }
  return { project, failure, stageFailure, evidence, attempt };
}

function createRegistryOwnedFixture(
  projectSlug: string,
  fileName: string,
  sceneId?: number,
) {
  const projectId = `${projectSlug}-id`;
  const saved = AudioStorage.saveAudio({
    projectSlug,
    fileName,
    data: wav(),
  });
  const asset = AudioStorage.transferPublicationOwnership(
    saved,
    AssetManager.createAsset({
      projectId,
      projectSlug,
      type: "audio",
      status: "generated",
      provider: "openai",
      model: "mock-tts-model",
      prompt: "audio-generation-request",
      ...(sceneId === undefined ? {} : { sceneId }),
      ...saved,
    }),
  );
  AssetManager.addAssetAtomically(projectSlug, projectId, asset);
  const handoff = AudioStorage.handoffPublishedAudio(asset, projectId);
  assert(
    handoff.status === "registry-owned-confirmed" ||
      handoff.status === "registry-ownership-completed",
  );
  const compensationRef = AudioStorage.getCompensationRef(asset);
  assert(compensationRef);
  return { compensationRef, projectId, saved, asset };
}

function createTwoPhaseRegistryOwnedFixture(
  projectSlug: string,
  fileName: string,
  sceneId?: number,
) {
  const projectId = `${projectSlug}-id`;
  const saved = AudioStorage.prepareAudio({
    projectSlug,
    fileName,
    data: wav(),
  });
  const asset = AudioStorage.transferPublicationOwnership(
    saved,
    AssetManager.createAsset({
      projectId,
      projectSlug,
      type: "audio",
      status: "generated",
      provider: "openai",
      model: "mock-tts-model",
      prompt: "audio-generation-request",
      ...(sceneId === undefined ? {} : { sceneId }),
      filePath: saved.filePath,
      url: saved.url,
      mimeType: saved.mimeType,
      byteLength: saved.byteLength,
      durationSeconds: saved.durationSeconds,
    }),
  );
  const committed = AudioStorage.commitPreparedAudio(asset, projectId);
  const compensationRef = AudioStorage.getCompensationRef(asset);
  assert(compensationRef);
  assert.equal(committed.assets.some((candidate) => candidate.id === asset.id), true);
  return { compensationRef, projectId, saved, asset };
}

function audioIntentRoot(context: RuntimeStorageContext, projectSlug: string): string {
  return path.join(
    context.projectsRoot,
    projectSlug,
    "production-execution",
    "audio-publication-intents",
  );
}

function rewriteIntent(
  filePath: string,
  mutate: (intent: Record<string, unknown>) => void,
): void {
  const intent = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  mutate(intent);
  delete intent.integrity;
  intent.integrity = createHash("sha256")
    .update(JSON.stringify(intent))
    .digest("hex");
  fs.writeFileSync(filePath, JSON.stringify(intent));
}

function replaceCanonicalWithForeignCopy(
  context: RuntimeStorageContext,
  saved: ReturnType<typeof AudioStorage.saveAudio>,
) {
  const canonicalPath = path.join(
    context.runtimeRoot,
    saved.filePath.slice("data/".length),
  );
  const ownedPath = `${canonicalPath}.owned-${crypto.randomUUID()}`;
  const bytes = fs.readFileSync(canonicalPath);
  const owned = fs.statSync(canonicalPath);
  fs.renameSync(canonicalPath, ownedPath);
  fs.writeFileSync(canonicalPath, bytes, { flag: "wx" });
  const foreign = fs.statSync(canonicalPath);
  assert(
    foreign.dev !== owned.dev || foreign.ino !== owned.ino,
    "foreign replacement must have a distinct filesystem identity",
  );
  return { canonicalPath, ownedPath, bytes, foreign };
}

async function renderWithRealAssemblyConsumer(input: {
  projectId: string;
  projectSlug: string;
  asset: ReturnType<typeof AssetManager.createAsset>;
  mixAsset?: ReturnType<typeof AssetManager.createAsset>;
  onProviderAdmission?: () => void;
}) {
  const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const savedImage = ImageStorage.saveImage({
    projectSlug: input.projectSlug,
    fileName: "assembly-fixture.png",
    mimeType: "image/png",
    data: imageBytes,
  });
  AssetManager.addAssetAtomically(
    input.projectSlug,
    input.projectId,
    AssetManager.createAsset({
      projectId: input.projectId,
      projectSlug: input.projectSlug,
      type: "image",
      status: "generated",
      provider: "openai",
      prompt: "assembly-fixture",
      sceneId: 1,
      byteLength: imageBytes.length,
      ...savedImage,
    }),
  );
  const section = {
    ...audioData().sections[0],
    outputAssetId: input.asset.id,
    status: "generated" as const,
    provider: "openai" as const,
  };
  const provider: VideoAssemblyProvider = {
    name: "ffmpeg",
    async assemble() {
      input.onProviderAdmission?.();
      const paths = VideoStorage.createRenderPaths(input.projectSlug);
      const bytes = minimalMp4();
      fs.writeFileSync(paths.temporaryAbsolutePath, bytes, { flag: "wx" });
      VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath);
      return {
        success: true,
        provider: "ffmpeg",
        status: "rendered",
        model: "ffmpeg-h264-aac",
        filePath: paths.filePath,
        url: paths.url,
        mimeType: "video/mp4",
        byteLength: bytes.length,
        durationSeconds: 1,
        width: 1920,
        height: 1080,
        videoCodec: "h264",
        audioCodec: "aac",
        createdAt: "2026-07-20T00:00:00.000Z",
      };
    },
  };
  return VideoAssemblyManager.renderExistingAssets({
    projectId: input.projectId,
    projectSlug: input.projectSlug,
    scenes: {
      scenes: [{ id: 1, title: "Fixture", description: "Fixture", duration: 1 }],
      createdAt: "2026-07-20T00:00:00.000Z",
    },
    visuals: {
      projectId: input.projectId,
      scenes: [{
        sceneId: 1,
        visualPrompt: "Fixture",
        animationPrompt: "",
        style: "cinematic",
      }],
      thumbnail: {
        title: "Fixture",
        prompt: "Fixture",
        composition: "Fixture",
        mood: "Fixture",
      },
      createdAt: "2026-07-20T00:00:00.000Z",
    },
    audio: {
      ...audioData(),
      outputAssetId: input.mixAsset?.id ?? input.asset.id,
      status: "generated",
      provider: "openai",
      sections: [section],
    },
    assembly: {
      projectId: input.projectId,
      slug: input.projectSlug,
      status: "assembled",
      scenes: [{
        sceneId: 1,
        duration: "00:01",
        visualReference: "visual-1",
        audioAssetId: input.asset.id,
        audioReference: "section-1",
        transition: "cut",
        cameraMovement: "none",
        effects: [],
      }],
      totalDuration: "00:01",
      style: "documentary",
      render: { status: "planned", format: "mp4" },
      createdAt: "2026-07-20T00:00:00.000Z",
    },
    provider,
  });
}

async function runRecoveryChild(input: {
  root: string;
  runtimeRoot: string;
  authorityRoot: string;
  projectSlug: string;
  compensationRef: string;
  operationId: string;
}) {
  const scriptPath = path.join(
    input.root,
    `audio-recovery-${crypto.randomUUID()}.ts`,
  );
  const storageModule = pathToFileURL(
    path.resolve("src/lib/assets/storage/AudioStorage.ts"),
  ).href;
  const pathsModule = pathToFileURL(
    path.resolve("src/lib/runtime/RuntimeStoragePaths.ts"),
  ).href;
  const operationModule = pathToFileURL(
    path.resolve("src/lib/runtime/ProductionRuntimeOperationContext.ts"),
  ).href;
  await fsp.writeFile(scriptPath, `
import { AudioStorage } from ${JSON.stringify(storageModule)};
import { createRuntimeStorageContext } from ${JSON.stringify(pathsModule)};
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext,
} from ${JSON.stringify(operationModule)};
const storage = createRuntimeStorageContext({
  workspaceRoot: ${JSON.stringify(process.cwd())},
  authorityRoot: ${JSON.stringify(input.authorityRoot)},
  environment: { ATOLYE_RUNTIME_ROOT: ${JSON.stringify(input.runtimeRoot)} },
});
const operation = createProductionRuntimeOperationContext({
  operationId: ${JSON.stringify(input.operationId)},
  operationType: "audio-remediation-test",
  authorityGeneration: initialRuntimeAuthorityGeneration,
  storageContext: storage,
});
const result = runWithProductionRuntimeOperationContext(operation, () =>
  AudioStorage.recoverPublishedAudio(
    ${JSON.stringify(input.projectSlug)},
    ${JSON.stringify(input.compensationRef)},
  )
);
console.log(JSON.stringify(result));
`, "utf8");
  try {
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", scriptPath],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, ATOLYE_RUNTIME_ROOT: input.runtimeRoot },
      },
    );
    assert.equal(child.status, 0, child.stderr);
    const output = child.stdout.trim().split(/\r?\n/).at(-1);
    assert(output);
    return JSON.parse(output) as {
      status: "completed" | "failed" | "rejected";
      compensated: boolean;
      retryable: boolean;
      compensationRef?: string;
      cleanup?: "completed" | "not-required" | "failed" | "deferred";
    };
  } finally {
    await fsp.rm(scriptPath, { force: true });
  }
}

async function runSaveChild(input: {
  root: string;
  runtimeRoot: string;
  authorityRoot: string;
  projectSlug: string;
  operationId: string;
  fileName: string;
}) {
  const scriptPath = path.join(
    input.root,
    `audio-save-${crypto.randomUUID()}.ts`,
  );
  const storageModule = pathToFileURL(
    path.resolve("src/lib/assets/storage/AudioStorage.ts"),
  ).href;
  const pathsModule = pathToFileURL(
    path.resolve("src/lib/runtime/RuntimeStoragePaths.ts"),
  ).href;
  const operationModule = pathToFileURL(
    path.resolve("src/lib/runtime/ProductionRuntimeOperationContext.ts"),
  ).href;
  await fsp.writeFile(scriptPath, `
import fs from "node:fs";
import path from "node:path";
import { AudioStorage } from ${JSON.stringify(storageModule)};
import { createRuntimeStorageContext } from ${JSON.stringify(pathsModule)};
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext,
} from ${JSON.stringify(operationModule)};
const storage = createRuntimeStorageContext({
  workspaceRoot: ${JSON.stringify(process.cwd())},
  authorityRoot: ${JSON.stringify(input.authorityRoot)},
  environment: { ATOLYE_RUNTIME_ROOT: ${JSON.stringify(input.runtimeRoot)} },
});
const operation = createProductionRuntimeOperationContext({
  operationId: ${JSON.stringify(input.operationId)},
  operationType: "audio-remediation-test",
  authorityGeneration: initialRuntimeAuthorityGeneration,
  storageContext: storage,
});
const saved = runWithProductionRuntimeOperationContext(operation, () =>
  AudioStorage.saveAudio({
    projectSlug: ${JSON.stringify(input.projectSlug)},
    fileName: ${JSON.stringify(input.fileName)},
    data: Buffer.from(${JSON.stringify(wav().toString("base64"))}, "base64"),
  })
);
const compensationRef = AudioStorage.getCompensationRef(saved);
const recordRoot = path.join(
  storage.projectsRoot,
  ${JSON.stringify(input.projectSlug)},
  "production-execution",
  "audio-compensation-cleanup",
);
console.log(JSON.stringify({
  compensationRef,
  recordCount: fs.existsSync(recordRoot) ? fs.readdirSync(recordRoot).length : 0,
}));
`, "utf8");
  try {
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", scriptPath],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, ATOLYE_RUNTIME_ROOT: input.runtimeRoot },
      },
    );
    assert.equal(child.status, 0, child.stderr);
    const output = child.stdout.trim().split(/\r?\n/).at(-1);
    assert(output);
    return JSON.parse(output) as {
      compensationRef: string;
      recordCount: number;
    };
  } finally {
    await fsp.rm(scriptPath, { force: true });
  }
}

type ConcurrentSaveResult = {
  readonly index: number;
  readonly processId: number;
  readonly startedAtNs: string;
  readonly finishedAtNs: string;
  readonly success: boolean;
  readonly compensationRef?: string;
  readonly evidence?: {
    readonly rootCode?: string;
    readonly cleanup?: string;
    readonly compensation?: string;
  };
};

async function runConcurrentSaveChildren(input: {
  root: string;
  runtimeRoot: string;
  authorityRoot: string;
  projectSlug: string;
  operationPrefix: string;
  filePrefix: string;
  wavBytes?: Buffer;
}): Promise<{
  readonly results: readonly ConcurrentSaveResult[];
  readonly readyHandshakes: readonly {
    readonly index: number;
    readonly processId: number;
    readonly readyAtNs: string;
  }[];
}> {
  const barrier = path.join(
    input.root,
    `audio-barrier-${crypto.randomUUID()}`,
  );
  const scriptPath = path.join(barrier, "concurrent-save.ts");
  await fsp.mkdir(barrier);
  const storageModule = pathToFileURL(
    path.resolve("src/lib/assets/storage/AudioStorage.ts"),
  ).href;
  const errorModule = pathToFileURL(
    path.resolve("src/lib/audio/AudioAssetError.ts"),
  ).href;
  const pathsModule = pathToFileURL(
    path.resolve("src/lib/runtime/RuntimeStoragePaths.ts"),
  ).href;
  const operationModule = pathToFileURL(
    path.resolve("src/lib/runtime/ProductionRuntimeOperationContext.ts"),
  ).href;
  await fsp.writeFile(scriptPath, `
import fs from "node:fs";
import path from "node:path";
import { AudioStorage } from ${JSON.stringify(storageModule)};
import { getAudioAssetErrorEvidence } from ${JSON.stringify(errorModule)};
import { createRuntimeStorageContext } from ${JSON.stringify(pathsModule)};
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext,
} from ${JSON.stringify(operationModule)};
(async () => {
const index = Number(process.argv[2]);
const barrier = ${JSON.stringify(barrier)};
const storage = createRuntimeStorageContext({
  workspaceRoot: ${JSON.stringify(process.cwd())},
  authorityRoot: ${JSON.stringify(input.authorityRoot)},
  environment: { ATOLYE_RUNTIME_ROOT: ${JSON.stringify(input.runtimeRoot)} },
});
const operation = createProductionRuntimeOperationContext({
  operationId: ${JSON.stringify(input.operationPrefix)} + "-" + index,
  operationType: "audio-remediation-test",
  authorityGeneration: initialRuntimeAuthorityGeneration,
  storageContext: storage,
});
fs.writeFileSync(
  path.join(barrier, "ready-" + index + ".json"),
  JSON.stringify({
    index,
    processId: process.pid,
    readyAtNs: process.hrtime.bigint().toString(),
  }),
  { flag: "wx" },
);
while (!fs.existsSync(path.join(barrier, "release"))) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
const startedAtNs = process.hrtime.bigint().toString();
let output;
try {
  const saved = runWithProductionRuntimeOperationContext(operation, () =>
    AudioStorage.saveAudio({
      projectSlug: ${JSON.stringify(input.projectSlug)},
      fileName: ${JSON.stringify(input.filePrefix)} + "-" + index + ".wav",
      data: Buffer.from(${JSON.stringify(
        (input.wavBytes ?? wav()).toString("base64"),
      )}, "base64"),
    })
  );
  output = {
    index,
    processId: process.pid,
    startedAtNs,
    finishedAtNs: process.hrtime.bigint().toString(),
    success: true,
    compensationRef: AudioStorage.getCompensationRef(saved),
  };
} catch (error) {
  output = {
    index,
    processId: process.pid,
    startedAtNs,
    finishedAtNs: process.hrtime.bigint().toString(),
    success: false,
    evidence: getAudioAssetErrorEvidence(error),
  };
}
console.log(JSON.stringify(output));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`, "utf8");

  const children = [0, 1].map((index) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", scriptPath, String(index)],
      {
        cwd: process.cwd(),
        env: { ...process.env, ATOLYE_RUNTIME_ROOT: input.runtimeRoot },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const completed = new Promise<ConcurrentSaveResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`concurrent child ${index} timed out`));
      }, 30_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`concurrent child ${index} failed: ${stderr}`));
          return;
        }
        const output = stdout.trim().split(/\r?\n/).at(-1);
        if (!output) {
          reject(new Error(`concurrent child ${index} produced no result`));
          return;
        }
        resolve(JSON.parse(output) as ConcurrentSaveResult);
      });
    });
    return { child, completed };
  });

  try {
    const deadline = Date.now() + 15_000;
    while (
      !(fs.existsSync(path.join(barrier, "ready-0.json")) &&
        fs.existsSync(path.join(barrier, "ready-1.json")))
    ) {
      if (Date.now() >= deadline) {
        throw new Error("concurrent child barrier handshake timed out");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const readyHandshakes = [0, 1].map((index) =>
      JSON.parse(
        fs.readFileSync(path.join(barrier, `ready-${index}.json`), "utf8"),
      ) as {
        index: number;
        processId: number;
        readyAtNs: string;
      }
    );
    fs.writeFileSync(path.join(barrier, "release"), "release", { flag: "wx" });
    const results = await Promise.all(children.map(({ completed }) => completed));
    return { results, readyHandshakes };
  } finally {
    for (const { child } of children) {
      if (child.exitCode === null) child.kill();
    }
    await fsp.rm(barrier, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await withCanonicalSmokeRuntime({ name: "sprint-129-27", enterOperationContext: false,
    operationType: "audio-remediation-test",
    environment: {
      AUDIO_PROVIDER: "openai", OPENAI_API_KEY: "mock-key-never-sent",
      OPENAI_TTS_MODEL: "mock-tts-model", OPENAI_TTS_VOICE: "alloy",
      OPENAI_TTS_TIMEOUT_MS: "50", OPENAI_TTS_MAX_RESPONSE_BYTES: "4096",
    } }, async (canonicalRuntime) => {
  const root = canonicalRuntime.workspaceRoot;
  const runtimeRoot = canonicalRuntime.runtimeRoot;
  const authorityRoot = canonicalRuntime.authorityRoot;
  const storageContext = canonicalRuntime.runtimeStorageContext;
  const mismatchedStorageContext = createRuntimeStorageContext({
    workspaceRoot: process.cwd(),
    authorityRoot,
    environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
  });
  const operationContext = canonicalRuntime.operationContext;

  canonicalRuntime.deferRestore(() => { globalThis.fetch = originalFetch; });
  try {
    await runWithProductionRuntimeOperationContext(operationContext, async () => {
      await scenario("every canonical audio root and phase survives bounded serialization", () => {
        const phases: Record<AudioAssetRootErrorCode, AudioAssetFailurePhase> = {
          AUDIO_PROVIDER_CONFIGURATION_INVALID: "configuration",
          AUDIO_PROVIDER_REQUEST_FAILED: "request",
          AUDIO_PROVIDER_TIMEOUT: "request",
          AUDIO_PROVIDER_CONTENT_TYPE_INVALID: "response",
          AUDIO_PROVIDER_RESPONSE_INVALID: "response",
          AUDIO_PROVIDER_RESPONSE_TOO_LARGE: "response",
          AUDIO_WAV_INVALID: "validation",
          AUDIO_STORAGE_WRITE_FAILED: "storage",
          AUDIO_ASSET_REGISTRY_FAILED: "registry",
        };
        for (const rootCode of audioAssetRootErrorCodes) {
          const evidence = createAudioAssetErrorEvidence(rootCode, {
            phase: phases[rootCode],
            target: { kind: "section", chapterId: 1 },
            provider: "openai",
            model: "mock-tts-model",
            cleanup: "completed",
            compensation: "completed",
            compensationRef: "audio-comp-00000000-0000-4000-8000-000000000001",
            httpStatus: 503,
            responseBytes: 4096,
            maximumResponseBytes: 4096,
          });
          const serialized = serializeAudioAssetErrorEvidence(evidence);
          assert.equal(serialized[0], `audio-root:${rootCode}`);
          assert.equal(serialized[1], `audio-phase:${phases[rootCode]}`);
          assert(serialized.includes("audio-cleanup:completed"));
          assert(serialized.includes("audio-compensation:completed"));
          assert(serialized.length <= 10);
          assert.doesNotMatch(JSON.stringify(serialized), /Authorization|API_KEY|[a-zA-Z]:[\\/]|stack/i);
        }
        const valid = createAudioAssetErrorEvidence("AUDIO_WAV_INVALID", {
          phase: "validation",
        });
        assert.deepEqual(serializeAudioAssetErrorEvidence({
          ...valid,
          rootCode: "AUDIO_UNKNOWN_ROOT",
        }), []);
        assert.deepEqual(serializeAudioAssetErrorEvidence({
          ...valid,
          phase: "unknown-provider-phase",
        }), []);
        assert.deepEqual(serializeAudioAssetErrorEvidence({
          ...valid,
          model: "Authorization-secret-C:\\private",
        }), []);
      });

      const providerRootCases: Array<{
        name: string;
        rootCode: AudioAssetRootErrorCode;
        phase: string;
        configure: () => void | (() => void);
      }> = [
        {
          name: "configuration",
          rootCode: "AUDIO_PROVIDER_CONFIGURATION_INVALID",
          phase: "configuration",
          configure: () => {
            const previous = process.env.OPENAI_API_KEY;
            delete process.env.OPENAI_API_KEY;
            globalThis.fetch = async () => assert.fail("configuration must fail before fetch");
            return () => restoreEnvironment("OPENAI_API_KEY", previous);
          },
        },
        {
          name: "network-request",
          rootCode: "AUDIO_PROVIDER_REQUEST_FAILED",
          phase: "request",
          configure: () => {
            globalThis.fetch = async () => { throw new Error("network fixture failure"); };
          },
        },
        {
          name: "http-non-success",
          rootCode: "AUDIO_PROVIDER_REQUEST_FAILED",
          phase: "response",
          configure: () => { globalThis.fetch = async () => response(Buffer.alloc(0), { status: 503 }); },
        },
        {
          name: "timeout-abort",
          rootCode: "AUDIO_PROVIDER_TIMEOUT",
          phase: "request",
          configure: () => {
            const previous = process.env.OPENAI_TTS_TIMEOUT_MS;
            process.env.OPENAI_TTS_TIMEOUT_MS = "10";
            globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted fixture", "AbortError")), { once: true });
            });
            return () => restoreEnvironment("OPENAI_TTS_TIMEOUT_MS", previous);
          },
        },
        {
          name: "content-type",
          rootCode: "AUDIO_PROVIDER_CONTENT_TYPE_INVALID",
          phase: "response",
          configure: () => { globalThis.fetch = async () => response(wav(), { contentType: "text/plain" }); },
        },
        {
          name: "empty-response",
          rootCode: "AUDIO_PROVIDER_RESPONSE_INVALID",
          phase: "response",
          configure: () => { globalThis.fetch = async () => response(Buffer.alloc(0)); },
        },
        {
          name: "oversized-response",
          rootCode: "AUDIO_PROVIDER_RESPONSE_TOO_LARGE",
          phase: "response",
          configure: () => {
            const previous = process.env.OPENAI_TTS_MAX_RESPONSE_BYTES;
            process.env.OPENAI_TTS_MAX_RESPONSE_BYTES = "1024";
            globalThis.fetch = async () => response(Buffer.alloc(1025), { contentLength: "1025" });
            return () => restoreEnvironment("OPENAI_TTS_MAX_RESPONSE_BYTES", previous);
          },
        },
        {
          name: "malformed-wav",
          rootCode: "AUDIO_WAV_INVALID",
          phase: "validation",
          configure: () => { globalThis.fetch = async () => response(Buffer.from("not-a-wav")); },
        },
        {
          name: "unsupported-wav",
          rootCode: "AUDIO_WAV_INVALID",
          phase: "validation",
          configure: () => { globalThis.fetch = async () => response(customWav({ format: 6 })); },
        },
      ];
      for (const rootCase of providerRootCases) {
        await scenario(`full runner evidence ${rootCase.name}`, () =>
          assertFullAudioFailureChain({
            ...rootCase,
            projectsRoot: storageContext.projectsRoot,
          }));
      }

      let collisionPath: string | undefined;
      const storageRootCases: Array<Parameters<typeof assertFullAudioFailureChain>[0]> = [
        {
          name: "storage-authority-context",
          projectsRoot: storageContext.projectsRoot,
          rootCode: "AUDIO_STORAGE_WRITE_FAILED",
          phase: "storage",
          configure: (project) => {
            fs.writeFileSync(
              path.join(storageContext.projectsRoot, project.slug, "assets"),
              "fixture containment collision",
              { flag: "wx" },
            );
          },
        },
        {
          name: "temp-publication",
          projectsRoot: storageContext.projectsRoot,
          rootCode: "AUDIO_STORAGE_WRITE_FAILED",
          phase: "storage",
          cleanup: "completed",
          compensation: "not-required",
          configure: () => {
            const original = fs.linkSync;
            let injected = false;
            fs.linkSync = ((source: fs.PathLike, destination: fs.PathLike) => {
              if (!injected && path.basename(String(source)) === "temporary.wav") {
                injected = true;
                throw new Error("controlled publication failure");
              }
              return original(source, destination);
            }) as typeof fs.linkSync;
            return () => { fs.linkSync = original; };
          },
        },
        {
          name: "no-clobber-collision",
          projectsRoot: storageContext.projectsRoot,
          rootCode: "AUDIO_STORAGE_WRITE_FAILED",
          phase: "storage",
          configure: (project) => {
            const original = fs.linkSync;
            let injected = false;
            collisionPath = undefined;
            const canonicalAudioRoot = path.join(
              storageContext.projectsRoot,
              project.slug,
              "assets",
              "audio",
            );
            fs.linkSync = ((source: fs.PathLike, destination: fs.PathLike) => {
              if (
                !injected &&
                path.basename(String(source)) === "publication-staging.wav" &&
                path.resolve(String(destination)).startsWith(`${canonicalAudioRoot}${path.sep}`)
              ) {
                injected = true;
                collisionPath = String(destination);
                fs.writeFileSync(collisionPath, "foreign no-clobber fixture", { flag: "wx" });
              }
              return original(source, destination);
            }) as typeof fs.linkSync;
            return () => { fs.linkSync = original; };
          },
          afterFailure: ({ project }) => {
            assert(collisionPath);
            assert.equal(fs.readFileSync(collisionPath, "utf8"), "foreign no-clobber fixture");
            const intentRoot = path.join(
              storageContext.projectsRoot,
              project.slug,
              "production-execution",
              "audio-publication-intents",
            );
            const intentFiles = fs.readdirSync(intentRoot);
            assert.equal(intentFiles.length, 1);
            const intent = JSON.parse(fs.readFileSync(
              path.join(intentRoot, intentFiles[0]), "utf8",
            )) as { compensationRef: string };
            assert.equal(
              getAudioPublicationLifecycleState(
                project.slug, intent.compensationRef, storageContext,
              ),
              "conflict",
            );
            const recovery = AudioStorage.recoverPublishedAudio(
              project.slug, intent.compensationRef, storageContext,
            );
            assert.equal(recovery.status, "rejected");
            assert.equal(recovery.compensated, false);
            const replay = AudioStorage.recoverPublishedAudio(
              project.slug, intent.compensationRef, storageContext,
            );
            assert.deepEqual(replay, recovery);
            assert.equal(fs.readFileSync(collisionPath, "utf8"), "foreign no-clobber fixture");
            fs.unlinkSync(collisionPath);
          },
        },
        {
          name: "readback-verification",
          projectsRoot: storageContext.projectsRoot,
          rootCode: "AUDIO_STORAGE_WRITE_FAILED",
          phase: "storage",
          cleanup: "completed",
          compensation: "not-required",
          configure: () => {
            const original = fs.readFileSync;
            let injected = false;
            fs.readFileSync = ((candidate: fs.PathOrFileDescriptor, ...args: unknown[]) => {
              if (
                !injected &&
                typeof candidate !== "number" &&
                path.basename(String(candidate)) === "temporary.wav"
              ) {
                injected = true;
                throw new Error("controlled readback failure");
              }
              return (original as (...values: unknown[]) => ReturnType<typeof fs.readFileSync>)(
                candidate,
                ...args,
              );
            }) as typeof fs.readFileSync;
            return () => { fs.readFileSync = original; };
          },
        },
        {
          name: "cleanup-compensation",
          projectsRoot: storageContext.projectsRoot,
          rootCode: "AUDIO_STORAGE_WRITE_FAILED",
          phase: "storage",
          cleanup: "deferred",
          compensation: "failed",
          configure: () => {
            const originalRead = fs.readFileSync;
            const originalOpen = fs.openSync;
            let readbackInjected = false;
            fs.readFileSync = ((candidate: fs.PathOrFileDescriptor, ...args: unknown[]) => {
              if (!readbackInjected && typeof candidate !== "number" &&
                path.basename(String(candidate)) === "temporary.wav") {
                readbackInjected = true;
                throw new Error("controlled precommit readback failure");
              }
              return (originalRead as (...values: unknown[]) => ReturnType<typeof fs.readFileSync>)(
                candidate, ...args,
              );
            }) as typeof fs.readFileSync;
            fs.openSync = ((candidate: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
              if (readbackInjected && path.basename(String(candidate)).startsWith("state-") &&
                String(candidate).endsWith(".partial") && String(flags).includes("x")) {
                throw new Error("controlled workspace retirement failure");
              }
              return originalOpen(candidate, flags, mode);
            }) as typeof fs.openSync;
            return () => {
              fs.openSync = originalOpen;
              fs.readFileSync = originalRead;
            };
          },
        },
        {
          name: "registry-persistence",
          projectsRoot: storageContext.projectsRoot,
          rootCode: "AUDIO_ASSET_REGISTRY_FAILED",
          phase: "registry",
          cleanup: "completed",
          compensation: "not-required",
          configure: () => {
            const original = fs.openSync;
            fs.openSync = ((candidate: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
              if (String(candidate).includes("audio-publication-intents") &&
                String(flags).includes("x")) {
                throw new Error("controlled registry intent failure");
              }
              return original(candidate, flags, mode);
            }) as typeof fs.openSync;
            return () => { fs.openSync = original; };
          },
        },
      ];
      for (const rootCase of storageRootCases) {
        await scenario(`full runner evidence ${rootCase.name}`, async () => {
          globalThis.fetch = async () => response(wav());
          await assertFullAudioFailureChain(rootCase);
        });
      }

      const runRetryFactoryFixture = async (
        name: string,
        secondResponse: () => Response,
        expectedSuccess: boolean,
        expectedRoots: readonly AudioAssetRootErrorCode[],
      ) => {
        const project = await ProjectManager.createProject(`Sprint 129 27 retry ${name}`);
        await PipelineJobManager.listJobs(project.slug);
        await ProjectManager.saveScript(project.slug, scriptFixture());
        const state = PipelineStageExecutor.createInitialState(project);
        state.script = scriptFixture();
        const originalGetProvider = AudioProviderRouter.getProvider;
        const providerInstances: AudioProvider[] = [];
        let fetchCalls = 0;
        AudioProviderRouter.getProvider = (() => {
          const provider = new OpenAIAudioProvider();
          providerInstances.push(provider);
          return provider;
        }) as typeof AudioProviderRouter.getProvider;
        globalThis.fetch = async () => {
          fetchCalls += 1;
          return fetchCalls === 1 ? response(Buffer.alloc(0)) : secondResponse();
        };
        try {
          await assert.rejects(audioRunner.runPipelineStage(
            project.slug,
            "audio",
            state,
            "initial",
            undefined,
            { aiProvider: new MockAIProvider() },
          ));
          const failedJob = await PipelineJobManager.getJobForStageReadOnly(project.slug, "audio");
          assert(failedJob);
          const preparedRetry = await prepareFailedStageRetry(project.slug, failedJob.id);
          assert.equal(preparedRetry.success, true);
          if (expectedSuccess) {
            assert.equal(await audioRunner.runPipelineStage(
              project.slug,
              "audio",
              state,
              "retry",
              undefined,
              { aiProvider: new MockAIProvider() },
            ), true);
          } else {
            await assert.rejects(audioRunner.runPipelineStage(
              project.slug,
              "audio",
              state,
              "retry",
              undefined,
              { aiProvider: new MockAIProvider() },
            ));
          }
        } finally {
          AudioProviderRouter.getProvider = originalGetProvider;
        }
        assert.equal(providerInstances.length, 2);
        assert.notEqual(providerInstances[0], providerInstances[1]);
        const attemptDirectory = path.join(
          storageContext.projectsRoot,
          project.slug,
          "production-execution",
          "attempts",
        );
        const all = fs.readdirSync(attemptDirectory).filter((entry) => entry.endsWith(".json"))
          .map((entry) => JSON.parse(fs.readFileSync(path.join(attemptDirectory, entry), "utf8")) as {
            state: string;
            attemptVersion: number;
            openedAt: string;
            identity: { attemptId: string };
            journal: Array<{ evidence: string[] }>;
          });
        const latest = [...new Set(all.map((entry) => entry.identity.attemptId))]
          .map((attemptId) => all.filter((entry) => entry.identity.attemptId === attemptId)
            .sort((left, right) => right.attemptVersion - left.attemptVersion)[0])
          .sort((left, right) => left.openedAt.localeCompare(right.openedAt));
        assert.equal(latest.length, 2);
        assert.equal(latest[0].state, "failed");
        assert.equal(latest[1].state, expectedSuccess ? "succeeded" : "failed");
        const observedRoots = latest.map((attempt) => {
          const terminal = attempt.journal.at(-1);
          return terminal?.evidence.find((entry) => entry.startsWith("audio-root:"))
            ?.slice("audio-root:".length);
        }).filter((value): value is string => Boolean(value));
        assert.deepEqual(observedRoots, expectedRoots);
        const generated = AssetManager.getProjectAssets(project.slug, project.id, storageContext)
          .assets.filter((asset) => asset.type === "audio" && asset.status === "generated");
        assert.equal(generated.length, expectedSuccess ? 2 : 0);
        assert.equal(new Set(generated.map((asset) => asset.filePath)).size, generated.length);
        assert.doesNotMatch(JSON.stringify({ latest, generated }),
          /Authorization|API_KEY|[a-zA-Z]:[\\/]|stack|Bounded narration fixture/i);
      };

      await scenario("retry factory failure to success creates a fresh provider and lineage", async () => {
        await runRetryFactoryFixture(
          "success",
          () => response(wav()),
          true,
          ["AUDIO_PROVIDER_RESPONSE_INVALID"],
        );
      });

      await scenario("retry factory preserves distinct roots across two failed attempts", async () => {
        await runRetryFactoryFixture(
          "different-root",
          () => response(Buffer.from("not-a-wav")),
          false,
          ["AUDIO_PROVIDER_RESPONSE_INVALID", "AUDIO_WAV_INVALID"],
        );
      });

      await scenario("successful WAV generation persists fsynced canonical assets", async () => {
        let calls = 0;
        globalThis.fetch = async () => {
          calls += 1;
          return response(wav());
        };
        const result = await AudioPipeline.generateAudio({
          projectId: "project-success",
          projectSlug: "sprint-129-27-success",
          audio: audioData("NARRATION_SHOULD_NOT_BE_PERSISTED"),
          provider: new OpenAIAudioProvider(),
        });
        assert.equal(calls, 2);
        assert.equal(result.projectAssets.assets.length, 2);
        assert.equal(
          result.projectAssets.assets[0].prompt,
          "Audio generation request.",
        );
        assert.doesNotMatch(JSON.stringify(result.projectAssets), /NARRATION_SHOULD/);
        for (const asset of result.projectAssets.assets) {
          assert(asset.filePath);
          assert.equal(AudioStorage.inspectStoredWav(
            "sprint-129-27-success",
            asset.filePath,
          ).byteLength, asset.byteLength);
        }
      });

      await scenario("configuration failure is distinct and write-free", async () => {
        delete process.env.OPENAI_API_KEY;
        let calls = 0;
        const result = await providerFailure(
          "sprint-129-27-config",
          "AUDIO_PROVIDER_CONFIGURATION_INVALID",
          async () => {
            calls += 1;
            throw new Error("must not fetch");
          },
        );
        assert.equal(calls, 0);
        assert.equal(result.evidence?.phase, "configuration");
        process.env.OPENAI_API_KEY = "mock-key-never-sent";
      });

      await scenario("shared model and voice policy rejects unsafe values before fetch", async () => {
        const invalidValues = [
          "api_key",
          "api-key",
          "api.key",
          "api:key",
          "apikey",
          "a.p.i.k.e.y",
          "a-p-i_k:e.y",
          "model-api.key-v1",
          "authorization",
          "bearer-token",
          "access_token",
          "auth-token",
          "client-secret",
          "provider-response",
          "password",
          "credential",
          "",
          "   ",
          " tts-1 ",
          "x".repeat(AUDIO_IDENTIFIER_MAX_LENGTH + 1),
        ];
        for (const [environmentName, values] of [
          ["OPENAI_TTS_MODEL", invalidValues],
          ["OPENAI_TTS_VOICE", invalidValues],
        ] as const) {
          for (const invalid of values) {
            process.env[environmentName] = invalid;
            let calls = 0;
            const failure = await providerFailure(
              `sprint-129-27-identifier-${calls}`,
              "AUDIO_PROVIDER_CONFIGURATION_INVALID",
              async () => {
                calls += 1;
                throw new Error("fetch must remain unreachable");
              },
            );
            assert.equal(calls, 0);
            assert.equal(failure.evidence?.phase, "configuration");
            assert.equal(failure.evidence?.model, undefined);
          }
          process.env[environmentName] = environmentName === "OPENAI_TTS_MODEL"
            ? "mock-tts-model"
            : "alloy";
        }
        assert.equal(getOpenAIAudioProviderConfig().model, "mock-tts-model");
        assert.equal(getOpenAIAudioProviderConfig().voice, "alloy");
        assert.equal(isSafeAudioIdentifier("mock-tts-model"), true);
        assert.throws(() =>
          createAudioAssetErrorEvidence("AUDIO_PROVIDER_REQUEST_FAILED", {
            phase: "request",
            model: "api_key",
          })
        );
      });

      await scenario("undefined identifier fallback and worker policy stay aligned", () => {
        delete process.env.OPENAI_TTS_MODEL;
        delete process.env.OPENAI_TTS_VOICE;
        assert.equal(getOpenAIAudioProviderConfig().model, "tts-1");
        assert.equal(getOpenAIAudioProviderConfig().voice, "alloy");
        process.env.OPENAI_TTS_MODEL = "mock-tts-model";
        process.env.OPENAI_TTS_VOICE = "alloy";

        const workerResult = (safeSummary: string) =>
          validateProductionExecutionWorkerResult({
            status: "succeeded",
            operationId: "operation-1",
            transactionId: "transaction-1",
            claimId: "claim-1",
            workerId: "worker-1",
            attempt: 1,
            startedAt: "2026-07-18T00:00:00.000Z",
            finishedAt: "2026-07-18T00:00:01.000Z",
            completedSteps: [],
            resultFingerprint: "fingerprint",
            partial: false,
            safeSummary,
            evidence: [],
            integrity: {
              algorithm: "stable-production-id-v1",
              fingerprint: "integrity",
            },
          });

        for (const value of [
          "api.key",
          "api:key",
          "a.p.i.k.e.y",
          "access_token",
          "client-secret",
          "provider-response",
        ]) {
          assert.equal(isSafeAudioIdentifier(value), false);
          assert.equal(workerResult(value).valid, false);
        }
        for (const value of ["tts-1", "alloy", "mock-tts-model"]) {
          assert.equal(isSafeAudioIdentifier(value), true);
          assert.equal(workerResult(value).valid, true);
        }
      });

      await scenario("accepted model evidence is durable-safe and preserves root first", () => {
        const evidence = createAudioAssetErrorEvidence(
          "AUDIO_PROVIDER_REQUEST_FAILED",
          {
            phase: "request",
            provider: "openai",
            model: "mock-tts-model",
          },
        );
        const serialized = serializeAudioAssetErrorEvidence(evidence);
        assert.equal(serialized[0], "audio-root:AUDIO_PROVIDER_REQUEST_FAILED");
        assert(serialized.includes("audio-model:mock-tts-model"));
        assert.doesNotMatch(
          serialized.join("|"),
          /api_?key|apikey|authorization|bearer|secret|token|password|credential|stack|provider.?response/i,
        );
      });

      await scenario("network/request failure is distinct and not retried", async () => {
        let calls = 0;
        await providerFailure(
          "sprint-129-27-network",
          "AUDIO_PROVIDER_REQUEST_FAILED",
          async () => {
            calls += 1;
            throw new Error("Authorization: Bearer secret C:\\private stack");
          },
        );
        assert.equal(calls, 1);
      });

      await scenario("timeout abort is distinct and not retried", async () => {
        process.env.OPENAI_TTS_TIMEOUT_MS = "10";
        let calls = 0;
        let observed: AbortSignal | undefined;
        await providerFailure(
          "sprint-129-27-timeout",
          "AUDIO_PROVIDER_TIMEOUT",
          async (_url, init) => {
            calls += 1;
            observed = init?.signal as AbortSignal;
            return await new Promise<Response>((_resolve, reject) => {
              observed?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")), { once: true });
            });
          },
        );
        assert.equal(calls, 1);
        assert.equal(observed?.aborted, true);
        process.env.OPENAI_TTS_TIMEOUT_MS = "50";
      });

      await scenario("non-success HTTP response has bounded status-only evidence", async () => {
        const failure = await providerFailure(
          "sprint-129-27-http",
          "AUDIO_PROVIDER_REQUEST_FAILED",
          async () => response(
            Buffer.from("RAW_PROVIDER_BODY Authorization API_KEY stack C:\\private"),
            { status: 503, contentType: "text/plain" },
          ),
        );
        assert.equal(failure.evidence?.httpStatus, 503);
        assert.doesNotMatch(JSON.stringify(failure), /RAW_PROVIDER|Authorization|API_KEY|private|stack/i);
      });

      for (const [name, contentType] of [
        ["missing", null],
        ["invalid", "audio/wav; invalid parameter"],
      ] as const) {
        await scenario(`${name} Content-Type is rejected`, async () => {
          await providerFailure(
            `sprint-129-27-content-${name}`,
            "AUDIO_PROVIDER_CONTENT_TYPE_INVALID",
            async () => response(wav(), { contentType }),
          );
        });
      }

      await scenario("empty response is distinct", async () => {
        await providerFailure(
          "sprint-129-27-empty",
          "AUDIO_PROVIDER_RESPONSE_INVALID",
          async () => response(Buffer.alloc(0)),
        );
      });

      await scenario("oversized response is rejected before persistence", async () => {
        process.env.OPENAI_TTS_MAX_RESPONSE_BYTES = "1024";
        const failure = await providerFailure(
          "sprint-129-27-oversize",
          "AUDIO_PROVIDER_RESPONSE_TOO_LARGE",
          async () => response(wav(), { contentLength: "1025" }),
        );
        assert.equal(failure.evidence?.responseBytes, 1025);
        assert.equal(failure.evidence?.maximumResponseBytes, 1024);
        process.env.OPENAI_TTS_MAX_RESPONSE_BYTES = "4096";
      });

      await scenario("malformed WAV is distinct and path-free", async () => {
        const failure = await providerFailure(
          "sprint-129-27-wav",
          "AUDIO_WAV_INVALID",
          async () => response(Buffer.from("not a wav C:\\private API_KEY stack")),
        );
        assert.doesNotMatch(JSON.stringify(failure), /not a wav|private|API_KEY|stack/i);
      });

      await scenario("precise WAV contract rejects unsupported and partial frames", () => {
        const invalidWavs = [
          customWav({ format: 1, bitsPerSample: 16, dataBytes: 3 }),
          customWav({ format: 3, bitsPerSample: 8, dataBytes: 2 }),
          customWav({ format: 1, bitsPerSample: 40, dataBytes: 5 }),
          customWav({ format: 3, bitsPerSample: 16, dataBytes: 2 }),
          customWav({ format: 6, bitsPerSample: 16 }),
          customWav({ format: 1, bitsPerSample: 24, dataBytes: 4 }),
          customWav({ blockAlign: 4 }),
          customWav({ byteRate: 8001 }),
          customWav({ declaredDataBytes: 4096 }),
          customWav({ channels: 3 }),
          customWav({ sampleRate: 7999 }),
          customWav({ sampleRate: 192001 }),
        ];
        for (const candidate of invalidWavs) {
          assert.throws(() => AudioStorage.inspectWav(candidate));
        }
        for (const candidate of [
          customWav({ format: 1, bitsPerSample: 8, dataBytes: 800 }),
          customWav({ format: 1, bitsPerSample: 16 }),
          customWav({ format: 1, bitsPerSample: 24, dataBytes: 1599 }),
          customWav({ format: 1, bitsPerSample: 32 }),
          customWav({ format: 3, bitsPerSample: 32 }),
          customWav({ format: 3, bitsPerSample: 64 }),
        ]) {
          assert.ok(AudioStorage.inspectWav(candidate).durationSeconds > 0);
        }
      });

      await scenario("WAV fmt extension and cbSize contract is exact", () => {
        for (const candidate of [
          customWav({ format: 1, bitsPerSample: 16, fmtSize: 16 }),
          customWav({ format: 3, bitsPerSample: 32, fmtSize: 16 }),
          customWav({ format: 1, bitsPerSample: 16, fmtSize: 18, cbSize: 0 }),
          customWav({ format: 3, bitsPerSample: 32, fmtSize: 18, cbSize: 0 }),
        ]) {
          assert.ok(AudioStorage.inspectWav(candidate).durationSeconds > 0);
        }

        const truncatedCbSize = customWav({
          format: 1,
          bitsPerSample: 16,
          fmtSize: 18,
          cbSize: 0,
        }).subarray(0, 37);
        for (const candidate of [
          customWav({ fmtSize: 17 }),
          customWav({ fmtSize: 18, cbSize: 1 }),
          customWav({ fmtSize: 18, cbSize: 22 }),
          customWav({ fmtSize: 19, cbSize: 1 }),
          customWav({ fmtSize: 40, cbSize: 22 }),
          truncatedCbSize,
        ]) {
          assert.throws(() => AudioStorage.inspectWav(candidate));
        }
      });

      await scenario("WAV requires fmt before data with bounded ancillary chunks", () => {
        const fmt = basicFmtBytes();
        const data = Buffer.alloc(1600);
        const unknown = Buffer.from([1, 2, 3]);
        AudioStorage.inspectWav(chunkedWav([
          { id: "fmt ", bytes: fmt },
          { id: "data", bytes: data },
        ]));
        AudioStorage.inspectWav(chunkedWav([
          { id: "JUNK", bytes: unknown },
          { id: "fmt ", bytes: fmt },
          { id: "LIST", bytes: unknown },
          { id: "data", bytes: data },
        ]));
        assert.throws(() => AudioStorage.inspectWav(chunkedWav([
          { id: "data", bytes: data },
          { id: "fmt ", bytes: fmt },
        ])));
        assert.throws(() => AudioStorage.inspectWav(chunkedWav([
          { id: "fmt ", bytes: fmt },
          { id: "data", bytes: data },
          { id: "fmt ", bytes: fmt },
        ])));
        assert.throws(() => AudioStorage.inspectWav(chunkedWav([
          { id: "fmt ", bytes: fmt },
          { id: "data", bytes: data },
          { id: "data", bytes: data },
        ])));
        const malformedPadding = chunkedWav([
          { id: "JUNK", bytes: Buffer.from([1]) },
          { id: "fmt ", bytes: fmt },
          { id: "data", bytes: data },
        ]).subarray(0, -1);
        malformedPadding.writeUInt32LE(malformedPadding.length - 8, 4);
        assert.throws(() => AudioStorage.inspectWav(malformedPadding));
      });

      await scenario("storage preparation failure is normalized", async () => {
        const slug = "sprint-129-27-prepare";
        const projectRoot = path.join(storageContext.projectsRoot, slug);
        await fsp.mkdir(projectRoot, { recursive: true });
        await fsp.writeFile(path.join(projectRoot, "assets"), "collision");
        assert.throws(
          () => AudioStorage.saveAudio({ projectSlug: slug, data: wav() }),
          (error) => {
            const evidence = getAudioAssetErrorEvidence(error);
            assert.equal(evidence?.rootCode, "AUDIO_STORAGE_WRITE_FAILED");
            return true;
          },
        );
      });

      for (const [name, method] of [
        ["write", "writeSync"],
        ["fsync", "fsyncSync"],
        ["publish", "linkSync"],
      ] as const) {
        await scenario(`storage ${name} failure defers its owned workspace`, async () => {
          const original = fs[method] as (...args: never[]) => unknown;
          (fs as unknown as Record<string, unknown>)[method] = () => {
            throw new Error(`C:\\private ${name} API_KEY stack`);
          };
          const slug = `sprint-129-27-storage-${name}`;
          try {
            assert.throws(
              () => AudioStorage.saveAudio({
                projectSlug: slug,
                fileName: "canonical.wav",
                data: wav(),
              }),
              (error) => {
                const evidence = getAudioAssetErrorEvidence(error);
                assert.equal(evidence?.rootCode, "AUDIO_STORAGE_WRITE_FAILED");
                assert.equal(evidence?.cleanup, "deferred");
                assert.equal(evidence?.compensation, "not-required");
                return true;
              },
            );
          } finally {
            (fs as unknown as Record<string, unknown>)[method] = original;
          }
          const audioRoot = path.join(
            storageContext.projectsRoot,
            slug,
            "assets",
            "audio",
          );
          const entries = await fsp.readdir(audioRoot).catch(() => []);
          assert.deepEqual(entries, []);
          const cleanupRoot = path.join(
            storageContext.projectsRoot,
            slug,
            "production-execution",
            "audio-compensation-cleanup",
          );
          assert.equal((await fsp.readdir(cleanupRoot)).length, 1);
        });
      }

      await scenario("foreign deferred temp replacement is preserved without path deletion", async () => {
        const slug = "sprint-129-27-temp-replacement";
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "canonical.wav",
          data: wav(),
        });
        const compensationRef = AudioStorage.getCompensationRef(saved);
        assert(compensationRef);
        const workspace = path.join(
          storageContext.projectsRoot,
          slug,
          "production-execution",
          "audio-compensation-cleanup",
          compensationRef,
        );
        const temporary = path.join(workspace, "temporary.wav");
        const ownedBackup = path.join(workspace, "owned-temporary.wav");
        const foreign = Buffer.from("foreign-temporary-entry");
        fs.renameSync(temporary, ownedBackup);
        fs.writeFileSync(temporary, foreign);
        const originalUnlink = fs.unlinkSync;
        const originalRm = fs.rmSync;
        const originalRmdir = fs.rmdirSync;
        let destructiveCalls = 0;
        fs.unlinkSync = ((...args: Parameters<typeof fs.unlinkSync>) => {
          if (path.resolve(String(args[0])).startsWith(path.resolve(workspace))) {
            destructiveCalls += 1;
          }
          return originalUnlink(...args);
        }) as typeof fs.unlinkSync;
        fs.rmSync = ((...args: Parameters<typeof fs.rmSync>) => {
          if (path.resolve(String(args[0])).startsWith(path.resolve(workspace))) {
            destructiveCalls += 1;
          }
          return originalRm(...args);
        }) as typeof fs.rmSync;
        fs.rmdirSync = ((...args: Parameters<typeof fs.rmdirSync>) => {
          if (path.resolve(String(args[0])).startsWith(path.resolve(workspace))) {
            destructiveCalls += 1;
          }
          return originalRmdir(...args);
        }) as typeof fs.rmdirSync;
        let result;
        let replay;
        try {
          result = AudioStorage.compensatePublishedAudioResult(saved);
          replay = AudioStorage.compensatePublishedAudioResult(saved);
        } finally {
          fs.unlinkSync = originalUnlink;
          fs.rmSync = originalRm;
          fs.rmdirSync = originalRmdir;
        }
        assert.equal(destructiveCalls, 0);
        assert.equal(result.compensated, true);
        assert.equal(result.cleanup, "deferred");
        assert.equal(replay.compensated, true);
        assert.equal(replay.cleanup, "deferred");
        assert.deepEqual(fs.readFileSync(temporary), foreign);
        assert.equal(fs.existsSync(ownedBackup), true);
      });

      await scenario("AudioStorage production source has no destructive path delete", () => {
        const source = fs.readFileSync(
          path.resolve("src/lib/assets/storage/AudioStorage.ts"),
          "utf8",
        );
        assert.doesNotMatch(
          source,
          /\b(?:unlinkSync|rmSync|rmdirSync)\s*\(/,
        );
        assert.doesNotMatch(source, /recursive\s*:\s*true/);
      });

      await scenario("atomic publish never clobbers canonical assets", async () => {
        const slug = "sprint-129-27-no-clobber";
        const first = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "canonical.wav",
          data: wav(1600),
        });
        const absolute = path.join(storageContext.runtimeRoot, first.filePath.slice("data/".length));
        const before = await fsp.readFile(absolute);
        assert.throws(
          () => AudioStorage.saveAudio({
            projectSlug: slug,
            fileName: "canonical.wav",
            data: wav(800),
          }),
          (error) => {
            assert.equal(
              getAudioAssetErrorEvidence(error)?.rootCode,
              "AUDIO_STORAGE_WRITE_FAILED",
            );
            return true;
          },
        );
        assert.deepEqual(await fsp.readFile(absolute), before);

        const portableRoot = path.join(root, "portable-publisher");
        fs.mkdirSync(portableRoot);
        const source = path.join(portableRoot, "source.wav");
        const sourceBytes = wav();
        fs.writeFileSync(source, sourceBytes);
        const expectedSha256 = createHash("sha256")
          .update(sourceBytes)
          .digest("hex");
        const originalLink = fs.linkSync;
        let fallbackLinkCalls = 0;
        fs.linkSync = ((source: fs.PathLike, destination: fs.PathLike) => {
          fallbackLinkCalls += 1;
          if (fallbackLinkCalls === 1) {
            throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
          }
          return originalLink(source, destination);
        }) as typeof fs.linkSync;
        try {
          const copied = publishFilePortableNoClobber({
            sourcePath: source,
            destinationPath: path.join(portableRoot, "copied.wav"),
            expectedByteLength: sourceBytes.length,
            expectedSha256,
          });
          assert.equal(copied.mode, "exclusive-copy");
          assert.deepEqual(
            fs.readFileSync(path.join(portableRoot, "copied.wav")),
            sourceBytes,
          );
        } finally {
          fs.linkSync = originalLink;
        }

        const originalOpen = fs.openSync;
        let fallbackOpens = 0;
        fs.linkSync = (() => {
          throw Object.assign(new Error("permission"), { code: "EACCES" });
        }) as typeof fs.linkSync;
        fs.openSync = ((...args: Parameters<typeof fs.openSync>) => {
          if (args[1] === "wx+") fallbackOpens += 1;
          return originalOpen(...args);
        }) as typeof fs.openSync;
        try {
          assert.throws(() => publishFilePortableNoClobber({
            sourcePath: source,
            destinationPath: path.join(portableRoot, "permission.wav"),
            expectedByteLength: sourceBytes.length,
            expectedSha256,
          }));
        } finally {
          fs.linkSync = originalLink;
          fs.openSync = originalOpen;
        }
        assert.equal(fallbackOpens, 0);

        const existing = path.join(portableRoot, "existing.wav");
        fs.writeFileSync(existing, "foreign");
        assert.throws(() => publishFilePortableNoClobber({
          sourcePath: source,
          destinationPath: existing,
          expectedByteLength: sourceBytes.length,
          expectedSha256,
        }));
        assert.equal(fs.readFileSync(existing, "utf8"), "foreign");

        const partial = path.join(portableRoot, "partial.wav");
        const originalWrite = fs.writeSync;
        let lifecycleLinkCalls = 0;
        fs.linkSync = ((source: fs.PathLike, destination: fs.PathLike) => {
          lifecycleLinkCalls += 1;
          if (lifecycleLinkCalls === 1) {
            throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
          }
          return originalLink(source, destination);
        }) as typeof fs.linkSync;
        fs.writeSync = (() => {
          throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        }) as typeof fs.writeSync;
        try {
          assert.throws(() => publishFilePortableNoClobber({
            sourcePath: source,
            destinationPath: partial,
            expectedByteLength: sourceBytes.length,
            expectedSha256,
          }));
        } finally {
          fs.linkSync = originalLink;
          fs.writeSync = originalWrite;
        }
        assert.equal(fs.existsSync(partial), false);
        const failedStaging = fs.readdirSync(portableRoot)
          .filter((entry) => entry.startsWith(".atolye-publish-"))
          .map((entry) => path.join(portableRoot, entry))
          .filter((entry) => fs.statSync(entry).size === 0);
        assert.equal(failedStaging.length, 1);
      });

      await scenario("publish crash before binding recovers exact reserved canonical", () => {
        const slug = "sprint-129-27-binding-crash-recovery";
        const originalLink = fs.linkSync;
        let interrupted = false;
        fs.linkSync = ((source: fs.PathLike, destination: fs.PathLike) => {
          if (path.basename(String(destination)) === "publication.json") {
            interrupted = true;
            throw new Error("simulated hard crash before binding");
          }
          return originalLink(source, destination);
        }) as typeof fs.linkSync;
        let failure: unknown;
        try {
          assert.throws(() => AudioStorage.saveAudio({
            projectSlug: slug,
            fileName: "canonical.wav",
            data: wav(),
          }), (error) => {
            failure = error;
            return true;
          });
        } finally {
          fs.linkSync = originalLink;
        }
        assert.equal(interrupted, true);
        const compensationRef = AudioStorage.getCompensationRef(failure);
        assert(compensationRef);
        const record = path.join(
          compensationWorkspacePath(storageContext, slug, compensationRef),
          "record",
        );
        assert.equal(fs.existsSync(path.join(record, "publication-reservation.json")), true);
        assert.equal(fs.existsSync(path.join(record, "publication.json")), false);
        const recovered = AudioStorage.recoverPublishedAudio(slug, compensationRef);
        assert.equal(recovered.status, "completed");
        assert.equal(recovered.compensated, true);
        assert.equal(fs.existsSync(path.join(record, "publication.json")), true);
      });

      await scenario("publish intent never owns a foreign canonical mismatch", () => {
        const slug = "sprint-129-27-binding-foreign";
        const originalLink = fs.linkSync;
        let interrupted = false;
        fs.linkSync = ((source: fs.PathLike, destination: fs.PathLike) => {
          if (path.basename(String(destination)) === "publication.json") {
            interrupted = true;
            throw new Error("simulated binding crash");
          }
          return originalLink(source, destination);
        }) as typeof fs.linkSync;
        let failure: unknown;
        try {
          assert.throws(() => AudioStorage.saveAudio({
            projectSlug: slug,
            fileName: "canonical.wav",
            data: wav(),
          }), (error) => {
            failure = error;
            return true;
          });
        } finally {
          fs.linkSync = originalLink;
        }
        assert.equal(interrupted, true);
        const compensationRef = AudioStorage.getCompensationRef(failure);
        assert(compensationRef);
        const canonical = path.join(
          storageContext.projectsRoot,
          slug,
          "assets",
          "audio",
          "canonical.wav",
        );
        const ownedBackup = `${canonical}.owned-backup`;
        fs.renameSync(canonical, ownedBackup);
        fs.writeFileSync(canonical, "foreign-canonical");
        const recovery = AudioStorage.recoverPublishedAudio(slug, compensationRef);
        assert.equal(recovery.status, "rejected");
        assert.equal(recovery.compensated, false);
        assert.equal(fs.readFileSync(canonical, "utf8"), "foreign-canonical");
        assert.deepEqual(fs.readFileSync(ownedBackup), wav());
      });

      await scenario("binding corruption and missing canonical fail closed", () => {
        const missingSlug = "sprint-129-27-binding-missing-canonical";
        const missing = AudioStorage.saveAudio({
          projectSlug: missingSlug,
          fileName: "canonical.wav",
          data: wav(),
        });
        const missingRef = AudioStorage.getCompensationRef(missing);
        assert(missingRef);
        const canonical = path.join(
          storageContext.projectsRoot,
          missingSlug,
          "assets",
          "audio",
          "canonical.wav",
        );
        fs.renameSync(canonical, `${canonical}.owned-backup`);
        const missingRecovery = AudioStorage.recoverPublishedAudio(
          missingSlug,
          missingRef,
        );
        assert.equal(missingRecovery.status, "failed");
        assert.equal(missingRecovery.retryable, true);

        const corruptSlug = "sprint-129-27-contradictory-binding";
        const corrupt = AudioStorage.saveAudio({
          projectSlug: corruptSlug,
          fileName: "canonical.wav",
          data: wav(),
        });
        const corruptRef = AudioStorage.getCompensationRef(corrupt);
        assert(corruptRef);
        const reservationPath = path.join(
          compensationWorkspacePath(storageContext, corruptSlug, corruptRef),
          "record",
          "publication-reservation.json",
        );
        const reservation = JSON.parse(fs.readFileSync(reservationPath, "utf8"));
        fs.writeFileSync(reservationPath, JSON.stringify({
          ...reservation,
          sha256: "0".repeat(64),
        }));
        const corruptRecovery = AudioStorage.recoverPublishedAudio(
          corruptSlug,
          corruptRef,
        );
        assert.equal(corruptRecovery.status, "rejected");
        assert.equal(corruptRecovery.compensated, false);
      });

      await scenario("EXDEV exclusive-copy completes journal registry and recovery lifecycle", () => {
        const slug = "sprint-129-27-exdev-lifecycle";
        const originalLink = fs.linkSync;
        let lifecyclePublishLinks = 0;
        fs.linkSync = ((source: fs.PathLike, destination: fs.PathLike) => {
          if (path.basename(String(destination)) === "publication-staging.wav") {
            lifecyclePublishLinks += 1;
          }
          if (
            lifecyclePublishLinks === 1 &&
            path.basename(String(destination)) === "publication-staging.wav"
          ) {
            throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
          }
          return originalLink(source, destination);
        }) as typeof fs.linkSync;
        let saved;
        try {
          saved = AudioStorage.saveAudio({
            projectSlug: slug,
            fileName: "exclusive.wav",
            data: wav(),
          });
        } finally {
          fs.linkSync = originalLink;
        }
        const compensationRef = AudioStorage.getCompensationRef(saved);
        assert(compensationRef);
        const record = path.join(
          compensationWorkspacePath(storageContext, slug, compensationRef),
          "record",
        );
        const reservation = JSON.parse(
          fs.readFileSync(path.join(record, "publication-reservation.json"), "utf8"),
        );
        const binding = JSON.parse(
          fs.readFileSync(path.join(record, "publication.json"), "utf8"),
        );
        assert.equal(reservation.mode, "exclusive-copy");
        assert.equal(binding.mode, "exclusive-copy");
        const projectId = `${slug}-id`;
        const asset = AudioStorage.transferPublicationOwnership(
          saved,
          AssetManager.createAsset({
            projectId,
            projectSlug: slug,
            type: "audio",
            status: "generated",
            provider: "openai",
            model: "mock-tts-model",
            prompt: "audio-generation-request",
            ...saved,
          }),
        );
        AssetManager.addAssetAtomically(slug, projectId, asset);
        const handoff = AudioStorage.handoffPublishedAudio(asset, projectId);
        assert(
          handoff.status === "registry-owned-confirmed" ||
            handoff.status === "registry-ownership-completed",
        );
        const recovery = AudioStorage.recoverPublishedAudio(slug, compensationRef);
        assert.equal(recovery.status, "completed");
        assert.equal(recovery.compensated, false);
        assert.equal(AudioStorage.isPublishedAudioRegistryOwned(asset), true);
      });

      await scenario("logical tombstone rejects storage and public route resolution", async () => {
        const slug = "sprint-129-27-tombstone-admission";
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "tombstoned.wav",
          data: wav(),
        });
        assert.equal(AudioStorage.compensatePublishedAudio(saved), true);
        assert.throws(() => AudioStorage.inspectStoredWav(slug, saved.filePath));
        assert.throws(() => AudioStorage.readStoredWav(slug, saved.filePath));
        const response = await getAudioAsset(new Request("http://local/audio"), {
          params: Promise.resolve({ slug, fileName: saved.fileName }),
        });
        assert.equal(response.status, 404);
      });

      await scenario("hard-link reservation failure cannot publish canonical", () => {
        const slug = "sprint-129-27-hard-link-reservation-failure";
        const originalLink = fs.linkSync;
        let reservationFailure = false;
        fs.linkSync = ((source: fs.PathLike, destination: fs.PathLike) => {
          if (path.basename(String(destination)) === "publication-reservation.json") {
            reservationFailure = true;
            throw new Error("reservation durability failure");
          }
          return originalLink(source, destination);
        }) as typeof fs.linkSync;
        try {
          assert.throws(() => AudioStorage.saveAudio({
            projectSlug: slug,
            fileName: "canonical.wav",
            data: wav(),
          }));
        } finally {
          fs.linkSync = originalLink;
        }
        assert.equal(reservationFailure, true);
        assert.equal(fs.existsSync(path.join(
          storageContext.projectsRoot,
          slug,
          "assets",
          "audio",
          "canonical.wav",
        )), false);
      });

      await scenario("publication journal mid-write crash leaves no poison final", () => {
        const slug = "sprint-129-27-publication-mid-write";
        const originalOpen = fs.openSync;
        const originalWrite = fs.writeSync;
        let publicationDescriptor: number | undefined;
        fs.openSync = ((candidate: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
          const descriptor = originalOpen(candidate, flags, mode);
          const name = path.basename(String(candidate));
          if (name.startsWith("publication.json.") && name.endsWith(".partial")) {
            publicationDescriptor = descriptor;
          }
          return descriptor;
        }) as typeof fs.openSync;
        fs.writeSync = ((descriptor: number, ...args: unknown[]) => {
          if (descriptor === publicationDescriptor) {
            throw new Error("publication mid-write crash");
          }
          return originalWrite(descriptor, ...(args as [
            buffer: Uint8Array,
            offset?: number,
            length?: number,
            position?: number | null,
          ]));
        }) as typeof fs.writeSync;
        let failure: unknown;
        try {
          assert.throws(() => AudioStorage.saveAudio({
            projectSlug: slug,
            fileName: "canonical.wav",
            data: wav(),
          }), (error) => {
            failure = error;
            return true;
          });
        } finally {
          fs.openSync = originalOpen;
          fs.writeSync = originalWrite;
        }
        const compensationRef = AudioStorage.getCompensationRef(failure);
        assert(compensationRef);
        const record = path.join(
          compensationWorkspacePath(storageContext, slug, compensationRef),
          "record",
        );
        assert.equal(fs.existsSync(path.join(record, "publication.json")), false);
        assert(fs.readdirSync(path.join(record, ".audio-journal-staging"))
          .some((entry) => entry.startsWith("publication.json.")));
        const recovered = AudioStorage.recoverPublishedAudio(slug, compensationRef);
        assert.equal(recovered.status, "completed");
        assert.equal(recovered.compensated, true);
        assert.equal(fs.existsSync(path.join(record, "publication.json")), true);
      });

      await scenario("EXDEV reservation without canonical resumes from receipt staging", () => {
        const slug = "sprint-129-27-exdev-crash-recovery";
        const originalLink = fs.linkSync;
        let forcedExdev = false;
        let interruptedCanonical = false;
        fs.linkSync = ((source: fs.PathLike, destination: fs.PathLike) => {
          const name = path.basename(String(destination));
          if (!forcedExdev && name === "publication-staging.wav") {
            forcedExdev = true;
            throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
          }
          if (name === "canonical.wav") {
            interruptedCanonical = true;
            throw new Error("crash after reservation");
          }
          return originalLink(source, destination);
        }) as typeof fs.linkSync;
        let failure: unknown;
        try {
          assert.throws(() => AudioStorage.saveAudio({
            projectSlug: slug,
            fileName: "canonical.wav",
            data: wav(),
          }), (error) => {
            failure = error;
            return true;
          });
        } finally {
          fs.linkSync = originalLink;
        }
        assert.equal(forcedExdev, true);
        assert.equal(interruptedCanonical, true);
        const compensationRef = AudioStorage.getCompensationRef(failure);
        assert(compensationRef);
        const canonical = path.join(
          storageContext.projectsRoot,
          slug,
          "assets",
          "audio",
          "canonical.wav",
        );
        assert.equal(fs.existsSync(canonical), false);
        const recovered = AudioStorage.recoverPublishedAudio(slug, compensationRef);
        assert.equal(recovered.status, "completed");
        assert.equal(recovered.compensated, true);
        assert.deepEqual(fs.readFileSync(canonical), wav());
      });

      await scenario("zero device and inode capability fails before publication", () => {
        const slug = "sprint-129-27-zero-identity";
        const originalOpen = fs.openSync;
        const originalFstat = fs.fstatSync;
        let temporaryDescriptor: number | undefined;
        fs.openSync = ((candidate: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
          const descriptor = originalOpen(candidate, flags, mode);
          if (path.basename(String(candidate)) === "temporary.wav") {
            temporaryDescriptor = descriptor;
          }
          return descriptor;
        }) as typeof fs.openSync;
        fs.fstatSync = ((descriptor: number, options?: fs.StatOptions) => {
          const stat = originalFstat(descriptor, options as never);
          if (descriptor !== temporaryDescriptor) return stat;
          return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
            dev: 0,
            ino: 0,
          });
        }) as typeof fs.fstatSync;
        try {
          assert.throws(() => AudioStorage.saveAudio({
            projectSlug: slug,
            fileName: "canonical.wav",
            data: wav(),
          }));
        } finally {
          fs.openSync = originalOpen;
          fs.fstatSync = originalFstat;
        }
        assert.equal(fs.existsSync(path.join(
          storageContext.projectsRoot,
          slug,
          "assets",
          "audio",
          "canonical.wav",
        )), false);
      });

      await scenario("same-content foreign canonical is never adopted without reservation", () => {
        const slug = "sprint-129-27-same-content-foreign";
        const originalLink = fs.linkSync;
        fs.linkSync = ((source: fs.PathLike, destination: fs.PathLike) => {
          if (path.basename(String(destination)) === "publication-reservation.json") {
            throw new Error("reservation unavailable");
          }
          return originalLink(source, destination);
        }) as typeof fs.linkSync;
        try {
          assert.throws(() => AudioStorage.saveAudio({
            projectSlug: slug,
            fileName: "canonical.wav",
            data: wav(),
          }));
        } finally {
          fs.linkSync = originalLink;
        }
        const cleanup = path.join(
          storageContext.projectsRoot,
          slug,
          "production-execution",
          "audio-compensation-cleanup",
        );
        const compensationRef = fs.readdirSync(cleanup)
          .find((entry) => entry.startsWith("audio-comp-"));
        assert(compensationRef);
        const canonical = path.join(
          storageContext.projectsRoot,
          slug,
          "assets",
          "audio",
          "canonical.wav",
        );
        fs.writeFileSync(canonical, wav());
        const recovered = AudioStorage.recoverPublishedAudio(slug, compensationRef);
        assert.equal(recovered.status, "rejected");
        assert.deepEqual(fs.readFileSync(canonical), wav());
      });

      await scenario("contradictory reservation and publication fail closed with valid digests", () => {
        const slug = "sprint-129-27-valid-contradiction";
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "canonical.wav",
          data: wav(),
        });
        const compensationRef = AudioStorage.getCompensationRef(saved);
        assert(compensationRef);
        const record = path.join(
          compensationWorkspacePath(storageContext, slug, compensationRef),
          "record",
        );
        const receipt = JSON.parse(fs.readFileSync(
          path.join(record, "receipt.json"),
          "utf8",
        ));
        const reservation = JSON.parse(fs.readFileSync(
          path.join(record, "publication-reservation.json"),
          "utf8",
        ));
        const publicationPath = path.join(record, "publication.json");
        const publication = JSON.parse(fs.readFileSync(publicationPath, "utf8"));
        assert.equal(publication.operationId, receipt.operationId);
        assert.equal(publication.receiptIntegrity, receipt.integrity);
        assert.equal(publication.reservationIntegrity, reservation.integrity);
        const publicationBody = { ...publication };
        delete publicationBody.integrity;
        publicationBody.device += 1;
        fs.writeFileSync(publicationPath, JSON.stringify({
          ...publicationBody,
          integrity: createHash("sha256")
            .update(JSON.stringify(publicationBody))
            .digest("hex"),
        }));
        const recovered = AudioStorage.recoverPublishedAudio(slug, compensationRef);
        assert.equal(recovered.status, "rejected");
        assert.equal(recovered.compensated, false);
      });

      await scenario("registry-owned foreign inode swap is rejected by storage and public route", async () => {
        const slug = "sprint-129-27-read-identity-route";
        const fixture = createRegistryOwnedFixture(slug, "canonical.wav", 1);
        const replacement = replaceCanonicalWithForeignCopy(
          storageContext,
          fixture.saved,
        );
        assert.throws(() => AudioStorage.readStoredWav(slug, fixture.saved.filePath));
        assert.throws(() => AudioStorage.inspectStoredWav(slug, fixture.saved.filePath));
        const response = await getAudioAsset(new Request("http://local/audio"), {
          params: Promise.resolve({ slug, fileName: fixture.saved.fileName }),
        });
        assert.notEqual(response.status, 200);
        assert.deepEqual(fs.readFileSync(replacement.canonicalPath), replacement.bytes);
        const preserved = fs.statSync(replacement.canonicalPath);
        assert.equal(preserved.dev, replacement.foreign.dev);
        assert.equal(preserved.ino, replacement.foreign.ino);
      });

      await scenario("assembly rejects a registry-owned foreign inode swap", async () => {
        const slug = "sprint-129-27-read-identity-assembly";
        const fixture = createRegistryOwnedFixture(slug, "canonical.wav", 1);
        const replacement = replaceCanonicalWithForeignCopy(
          storageContext,
          fixture.saved,
        );
        await assert.rejects(
          renderWithRealAssemblyConsumer({ ...fixture, projectSlug: slug }),
          (error) => error instanceof VideoAssemblyError,
        );
        assert.deepEqual(fs.readFileSync(replacement.canonicalPath), replacement.bytes);
      });

      await scenario("pipeline foreign inode rejection and replay are mutation-free", async () => {
        const slug = "sprint-129-27-read-identity-pipeline";
        const fixture = createRegistryOwnedFixture(slug, "canonical.wav");
        const replacement = replaceCanonicalWithForeignCopy(
          storageContext,
          fixture.saved,
        );
        const registryPath = path.join(
          storageContext.projectsRoot,
          slug,
          "assets",
          "assets.json",
        );
        const recordPath = compensationWorkspacePath(
          storageContext,
          slug,
          fixture.compensationRef,
        );
        const registryBefore = fs.readFileSync(registryPath);
        const recordBefore = directoryByteSnapshot(recordPath);
        const recordFiles = new Set(
          recordBefore.map((entry) => entry.relativePath),
        );
        assert.equal(recordFiles.has("record/receipt.json"), true);
        assert.equal(recordFiles.has("record/publication-reservation.json"), true);
        assert.equal(recordFiles.has("record/publication.json"), true);
        assert.equal(
          [...recordFiles].some((entry) =>
            /^record\/state-[0-9]{6}\.json$/.test(entry)
          ),
          true,
        );
        const assetsBefore = AssetManager.getProjectAssets(slug, fixture.projectId);

        for (let attempt = 0; attempt < 2; attempt += 1) {
          await assert.rejects(
            AudioPipeline.generateAudio({
              projectId: fixture.projectId,
              projectSlug: slug,
              audio: audioData(),
              provider: providerForSavedAudio(fixture.saved),
            }),
            (error) => {
              assertAudioRoot(error, "AUDIO_STORAGE_WRITE_FAILED");
              assert.equal(error instanceof Error ? error.message : "", "Audio asset generation failed.");
              assert.doesNotMatch(
                JSON.stringify(error),
                /canonical\.wav|audio-compensation-cleanup|read-identity-pipeline|owned-/i,
              );
              return true;
            },
          );
          assert.deepEqual(fs.readFileSync(registryPath), registryBefore);
          assert.deepEqual(directoryByteSnapshot(recordPath), recordBefore);
          const assetsAfter = AssetManager.getProjectAssets(slug, fixture.projectId);
          assert.equal(assetsAfter.assets.length, assetsBefore.assets.length);
          assert.equal(
            assetsAfter.assets.some((asset) => asset.status === "failed"),
            false,
          );
          assert.deepEqual(
            fs.readFileSync(replacement.canonicalPath),
            replacement.bytes,
          );
          const preserved = fs.statSync(replacement.canonicalPath);
          assert.equal(preserved.dev, replacement.foreign.dev);
          assert.equal(preserved.ino, replacement.foreign.ino);
        }
      });

      await scenario("normal provider failure still persists a failed asset", async () => {
        const slug = "sprint-129-27-normal-failure-persistence";
        const projectId = `${slug}-id`;
        const provider: AudioProvider = {
          name: "openai",
          validateInput(): void {},
          async generateAudio(input: AudioGenerationInput) {
            return {
              success: false as const,
              target: input.target,
              provider: "openai" as const,
              model: "mock-tts-model",
              createdAt: new Date().toISOString(),
              error: "Audio generation failed.",
              evidence: createAudioAssetErrorEvidence(
                "AUDIO_PROVIDER_REQUEST_FAILED",
                {
                  phase: "request",
                  target: input.target,
                  provider: "openai",
                },
              ),
            };
          },
        };
        await assert.rejects(
          AudioPipeline.generateAudio({
            projectId,
            projectSlug: slug,
            audio: audioData(),
            provider,
          }),
          (error) => assertAudioRoot(error, "AUDIO_PROVIDER_REQUEST_FAILED"),
        );
        const assets = AssetManager.getProjectAssets(slug, projectId);
        assert.equal(assets.assets.length, 1);
        assert.equal(assets.assets[0]?.status, "failed");
      });

      await scenario("malformed provider WAV remains persisted validation failure", async () => {
        const slug = "sprint-129-27-malformed-pipeline-persistence";
        const projectId = `${slug}-id`;
        const previousFetch = globalThis.fetch;
        globalThis.fetch = async () => response(Buffer.from("not a wav"));
        try {
          await assert.rejects(
            AudioPipeline.generateAudio({
              projectId,
              projectSlug: slug,
              audio: audioData(),
              provider: new OpenAIAudioProvider(),
            }),
            (error) => assertAudioRoot(error, "AUDIO_WAV_INVALID"),
          );
        } finally {
          globalThis.fetch = previousFetch;
        }
        const assets = AssetManager.getProjectAssets(slug, projectId);
        assert.equal(assets.assets.length, 1);
        assert.equal(assets.assets[0]?.status, "failed");
      });

      await scenario("recovery never adopts a same-content foreign canonical identity", () => {
        const slug = "sprint-129-27-read-identity-recovery";
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "canonical.wav",
          data: wav(),
        });
        const compensationRef = AudioStorage.getCompensationRef(saved);
        assert(compensationRef);
        const replacement = replaceCanonicalWithForeignCopy(storageContext, saved);
        const recovery = AudioStorage.recoverPublishedAudio(slug, compensationRef);
        assert.equal(recovery.compensated, false);
        assert(recovery.status === "failed" || recovery.status === "rejected");
        assert.deepEqual(fs.readFileSync(replacement.canonicalPath), replacement.bytes);
        const preserved = fs.statSync(replacement.canonicalPath);
        assert.equal(preserved.ino, replacement.foreign.ino);
      });

      await scenario("identity-preserving canonical remains valid for every consumer", async () => {
        const slug = "sprint-129-27-read-identity-valid";
        const projectId = `${slug}-id`;
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "canonical.wav",
          data: wav(),
        });
        assert.deepEqual(AudioStorage.readStoredWav(slug, saved.filePath), wav());
        assert.equal(
          AudioStorage.inspectStoredWav(slug, saved.filePath).byteLength,
          saved.byteLength,
        );
        const routeResponse = await getAudioAsset(new Request("http://local/audio"), {
          params: Promise.resolve({ slug, fileName: saved.fileName }),
        });
        assert.equal(routeResponse.status, 200);
        const generated = await AudioPipeline.generateAudio({
          projectId,
          projectSlug: slug,
          audio: audioData(),
          provider: providerForSavedAudio(saved),
        });
        const sectionId = generated.audio.sections[0].outputAssetId;
        const sectionAsset = generated.projectAssets.assets.find(
          (asset) => asset.id === sectionId,
        );
        const mixAsset = generated.projectAssets.assets.find(
          (asset) => asset.id === generated.audio.outputAssetId,
        );
        assert(sectionAsset);
        assert(mixAsset);
        let providerAdmissions = 0;
        const assemblyResult = await renderWithRealAssemblyConsumer({
          projectId,
          projectSlug: slug,
          asset: sectionAsset,
          mixAsset,
          onProviderAdmission: () => {
            providerAdmissions += 1;
          },
        });
        assert.equal(providerAdmissions, 1);
        assert.equal(assemblyResult.render?.status, "rendered");
      });

      await scenario("mid-read identity change fails closed and preserves replacement", () => {
        const slug = "sprint-129-27-read-identity-mid-read";
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "canonical.wav",
          data: wav(),
        });
        const canonicalPath = path.join(
          storageContext.runtimeRoot,
          saved.filePath.slice("data/".length),
        );
        const ownedPath = `${canonicalPath}.owned-${crypto.randomUUID()}`;
        const originalOpen = fs.openSync;
        const originalFstat = fs.fstatSync;
        const originalRead = fs.readFileSync;
        let canonicalDescriptor: number | undefined;
        let descriptorReadDuringSwap: number | undefined;
        let foreignIdentity: fs.Stats | undefined;
        fs.openSync = ((candidate: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
          const descriptor = originalOpen(candidate, flags, mode);
          if (path.resolve(String(candidate)) === path.resolve(canonicalPath)) {
            canonicalDescriptor = descriptor;
          }
          return descriptor;
        }) as typeof fs.openSync;
        fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
          const bytes = originalRead(...args);
          if (args[0] === canonicalDescriptor && !foreignIdentity) {
            descriptorReadDuringSwap = args[0];
            fs.renameSync(canonicalPath, ownedPath);
            fs.writeFileSync(canonicalPath, bytes, { flag: "wx" });
            foreignIdentity = fs.statSync(canonicalPath);
          }
          return bytes;
        }) as typeof fs.readFileSync;
        fs.fstatSync = ((descriptor: number, options?: fs.StatOptions) => {
          const stat = originalFstat(descriptor, options as never);
          if (descriptor !== descriptorReadDuringSwap) return stat;
          return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
            ino: stat.ino === 1 ? 2 : 1,
          });
        }) as typeof fs.fstatSync;
        try {
          assert.throws(() => AudioStorage.readStoredWav(slug, saved.filePath));
        } finally {
          fs.openSync = originalOpen;
          fs.fstatSync = originalFstat;
          fs.readFileSync = originalRead;
        }
        assert(foreignIdentity);
        assert.deepEqual(fs.readFileSync(canonicalPath), wav());
        assert.equal(fs.statSync(canonicalPath).ino, foreignIdentity.ino);
      });

      await scenario("zero canonical descriptor identity fails before byte read", () => {
        const slug = "sprint-129-27-read-identity-zero";
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "canonical.wav",
          data: wav(),
        });
        const canonicalPath = path.join(
          storageContext.runtimeRoot,
          saved.filePath.slice("data/".length),
        );
        const originalOpen = fs.openSync;
        const originalFstat = fs.fstatSync;
        const originalRead = fs.readFileSync;
        let canonicalDescriptor: number | undefined;
        let descriptorReads = 0;
        fs.openSync = ((candidate: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
          const descriptor = originalOpen(candidate, flags, mode);
          if (path.resolve(String(candidate)) === path.resolve(canonicalPath)) {
            canonicalDescriptor = descriptor;
          }
          return descriptor;
        }) as typeof fs.openSync;
        fs.fstatSync = ((descriptor: number, options?: fs.StatOptions) => {
          const stat = originalFstat(descriptor, options as never);
          if (descriptor !== canonicalDescriptor) return stat;
          return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
            dev: 0,
            ino: 0,
          });
        }) as typeof fs.fstatSync;
        fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
          if (args[0] === canonicalDescriptor) descriptorReads += 1;
          return originalRead(...args);
        }) as typeof fs.readFileSync;
        try {
          assert.throws(() => AudioStorage.readStoredWav(slug, saved.filePath));
        } finally {
          fs.openSync = originalOpen;
          fs.fstatSync = originalFstat;
          fs.readFileSync = originalRead;
        }
        assert.equal(descriptorReads, 0);
        assert.deepEqual(fs.readFileSync(canonicalPath), wav());
      });

      await scenario("registry ownership rejects a same-content pre-open path swap", () => {
        const slug = "sprint-129-27-registry-pre-open-swap";
        const fixture = createTwoPhaseRegistryOwnedFixture(slug, "canonical.wav", 1);
        const canonicalPath = path.join(
          storageContext.runtimeRoot,
          fixture.saved.filePath.slice("data/".length),
        );
        const ownedPath = `${canonicalPath}.owned`;
        const bytes = wav();
        const originalStat = fs.statSync;
        let foreign: fs.Stats | undefined;
        (fs as unknown as { statSync: typeof fs.statSync }).statSync = ((
          candidate: fs.PathLike,
          ...args: unknown[]
        ) => {
          const stat = (originalStat as (...values: unknown[]) => fs.Stats)(candidate, ...args);
          if (!foreign && path.resolve(String(candidate)) === path.resolve(canonicalPath)) {
            fs.renameSync(canonicalPath, ownedPath);
            fs.writeFileSync(canonicalPath, bytes, { flag: "wx" });
            foreign = originalStat(canonicalPath);
          }
          return stat;
        }) as typeof fs.statSync;
        try {
          assert.throws(() => getCommittedAudioPublicationAssets(
            slug,
            fixture.projectId,
            storageContext,
          ));
        } finally {
          (fs as unknown as { statSync: typeof fs.statSync }).statSync = originalStat;
        }
        assert(foreign);
        assert.deepEqual(fs.readFileSync(canonicalPath), bytes);
        assert.equal(fs.statSync(canonicalPath).ino, foreign.ino);
      });

      await scenario("canonical reconciliation rejects and preserves a same-content replacement", () => {
        const slug = "sprint-129-27-reconciliation-swap";
        const projectId = `${slug}-id`;
        const saved = AudioStorage.prepareAudio({
          projectSlug: slug,
          fileName: "canonical.wav",
          data: wav(),
        });
        const asset = AudioStorage.transferPublicationOwnership(
          saved,
          AssetManager.createAsset({
            projectId,
            projectSlug: slug,
            type: "audio",
            status: "generated",
            provider: "openai",
            model: "mock-tts-model",
            prompt: "audio-generation-request",
            filePath: saved.filePath,
            url: saved.url,
            mimeType: saved.mimeType,
            byteLength: saved.byteLength,
            durationSeconds: saved.durationSeconds,
          }),
        );
        const canonicalPath = path.join(
          storageContext.runtimeRoot,
          saved.filePath.slice("data/".length),
        );
        const originalLink = fs.linkSync;
        let foreign: fs.Stats | undefined;
        fs.linkSync = ((source: fs.PathLike, destination: fs.PathLike) => {
          const result = originalLink(source, destination);
          if (path.resolve(String(destination)) === path.resolve(canonicalPath)) {
            const bytes = fs.readFileSync(canonicalPath);
            fs.renameSync(canonicalPath, `${canonicalPath}.owned`);
            fs.writeFileSync(canonicalPath, bytes, { flag: "wx" });
            foreign = fs.statSync(canonicalPath);
            throw new Error("controlled post-publication replacement");
          }
          return result;
        }) as typeof fs.linkSync;
        try {
          assert.throws(
            () => AudioStorage.commitPreparedAudio(asset, projectId),
            (error) => error instanceof AudioCanonicalAdmissionConflictError,
          );
        } finally {
          fs.linkSync = originalLink;
        }
        assert(foreign);
        assert.deepEqual(fs.readFileSync(canonicalPath), wav());
        assert.equal(fs.statSync(canonicalPath).ino, foreign.ino);
        const compensationRef = AudioStorage.getCompensationRef(asset);
        assert(compensationRef);
        assert.equal(
          getAudioPublicationLifecycleState(slug, compensationRef, storageContext),
          "conflict",
        );
      });

      await scenario("intent read rejects a same-content replacement between lstat and open", () => {
        const slug = "sprint-129-27-intent-read-swap";
        const fixture = createTwoPhaseRegistryOwnedFixture(slug, "canonical.wav", 1);
        const intentRoot = audioIntentRoot(storageContext, slug);
        const intentPath = path.join(intentRoot, fs.readdirSync(intentRoot)[0]);
        const bytes = fs.readFileSync(intentPath);
        const originalLstat = fs.lstatSync;
        let foreign: fs.Stats | undefined;
        (fs as unknown as { lstatSync: typeof fs.lstatSync }).lstatSync = ((candidate: fs.PathLike, ...args: unknown[]) => {
          const stat = (originalLstat as (...values: unknown[]) => fs.Stats)(candidate, ...args);
          if (!foreign && path.resolve(String(candidate)) === path.resolve(intentPath)) {
            fs.renameSync(intentPath, `${intentPath}.owned`);
            fs.writeFileSync(intentPath, bytes, { flag: "wx" });
            foreign = originalLstat(intentPath);
          }
          return stat;
        }) as typeof fs.lstatSync;
        try {
          assert.throws(() => getCommittedAudioPublicationAssets(
            slug,
            fixture.projectId,
            storageContext,
          ));
        } finally {
          (fs as unknown as { lstatSync: typeof fs.lstatSync }).lstatSync = originalLstat;
        }
        assert(foreign);
        assert.deepEqual(fs.readFileSync(intentPath), bytes);
        assert.equal(fs.statSync(intentPath).ino, foreign.ino);
      });

      await scenario("publication receipts reject mismatch reuse replacement and forgery", () => {
        const contextBound = AudioStorage.saveAudio({
          projectSlug: "sprint-129-27-receipt-context",
          fileName: "canonical.wav",
          data: wav(),
        });
        assert.equal(
          AudioStorage.compensatePublishedAudio(
            contextBound,
            mismatchedStorageContext,
          ),
          false,
        );
        assert.equal(AudioStorage.compensatePublishedAudio(contextBound), true);
        assert.equal(AudioStorage.compensatePublishedAudio(contextBound), true);

        const replacement = AudioStorage.saveAudio({
          projectSlug: "sprint-129-27-receipt-replacement",
          fileName: "canonical.wav",
          data: wav(),
        });
        const replacementRef = AudioStorage.getCompensationRef(replacement);
        assert(replacementRef);
        const replacementPath = path.join(
          storageContext.runtimeRoot,
          replacement.filePath.slice("data/".length),
        );
        fs.unlinkSync(replacementPath);
        fs.writeFileSync(replacementPath, wav(800));
        assert.equal(AudioStorage.compensatePublishedAudio(replacement), false);
        assert.deepEqual(fs.readFileSync(replacementPath), wav(800));
        assert.equal(
          fs.existsSync(compensationQuarantinePath(
            storageContext,
            "sprint-129-27-receipt-replacement",
            replacementRef,
          )),
          false,
        );

        const genuine = AudioStorage.saveAudio({
          projectSlug: "sprint-129-27-receipt-forgery",
          fileName: "canonical.wav",
          data: wav(),
        });
        assert.equal(AudioStorage.compensatePublishedAudio({ ...genuine }), false);
        assert.equal(AudioStorage.compensatePublishedAudio(genuine), true);
      });

      await scenario("canonical path swap preserves the foreign entry and fails closed", () => {
        const slug = "sprint-129-27-quarantine-swap";
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "canonical.wav",
          data: wav(),
        });
        const compensationRef = AudioStorage.getCompensationRef(saved);
        assert(compensationRef);
        const canonicalPath = path.join(
          storageContext.runtimeRoot,
          saved.filePath.slice("data/".length),
        );
        const foreign = Buffer.from("foreign-canonical-must-survive");
        const originalRegistry = AssetManager.addAssetAtomically;
        let registryCalls = 0;
        AssetManager.addAssetAtomically = (...args) => {
          registryCalls += 1;
          return originalRegistry.apply(AssetManager, args);
        };
        fs.unlinkSync(canonicalPath);
        fs.writeFileSync(canonicalPath, foreign);
        try {
          assert.equal(AudioStorage.compensatePublishedAudio(saved), false);
        } finally {
          AssetManager.addAssetAtomically = originalRegistry;
        }
        assert.deepEqual(fs.readFileSync(canonicalPath), foreign);
        assert.equal(
          fs.existsSync(compensationQuarantinePath(
            storageContext,
            slug,
            compensationRef,
          )),
          false,
        );
        assert.equal(registryCalls, 0);
        const recovery = AudioStorage.recoverPublishedAudio(
          slug,
          compensationRef,
        );
        assert.equal(recovery.status, "failed");
        assert.equal(recovery.compensated, false);
        assert.equal(recovery.compensationRef, compensationRef);
      });

      await scenario("logical compensation supports restart idempotency and context binding", async () => {
        const slug = "sprint-129-27-restart-recovery";
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "canonical.wav",
          data: wav(),
        });
        const compensationRef = AudioStorage.getCompensationRef(saved);
        assert(compensationRef);
        const originalFtruncate = fs.ftruncateSync;
        fs.ftruncateSync = (() => {
          throw new Error("quarantine destruction unavailable");
        }) as typeof fs.ftruncateSync;
        try {
          assert.equal(AudioStorage.compensatePublishedAudio(saved), true);
        } finally {
          fs.ftruncateSync = originalFtruncate;
        }
        const common = {
          root,
          runtimeRoot,
          authorityRoot,
          projectSlug: slug,
          compensationRef,
        };
        const rejected = await runRecoveryChild({
          ...common,
          operationId: "different-operation",
        });
        assert.equal(rejected.status, "rejected");
        assert.equal(rejected.compensated, false);
        const recovered = await runRecoveryChild({
          ...common,
          operationId: operationContext.operationId,
        });
        assert.equal(recovered.status, "completed");
        assert.equal(recovered.compensated, true);
        const replayed = await runRecoveryChild({
          ...common,
          operationId: operationContext.operationId,
        });
        assert.equal(replayed.status, "completed");
        assert.equal(replayed.compensated, true);
        const canonicalPath = path.join(
          storageContext.runtimeRoot,
          saved.filePath.slice("data/".length),
        );
        assert.equal(fs.existsSync(canonicalPath), true);
        assert.deepEqual(fs.readFileSync(canonicalPath), wav());
        assert.equal(
          fs.existsSync(compensationQuarantinePath(
            storageContext,
            slug,
            compensationRef,
          )),
          false,
        );
      });

      await scenario("canonical descriptor-close swap fails closed and preserves foreign entry", () => {
        const slug = "sprint-129-27-quarantine-destruction-swap";
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "canonical.wav",
          data: wav(),
        });
        const compensationRef = AudioStorage.getCompensationRef(saved);
        assert(compensationRef);
        const canonicalPath = path.join(
          storageContext.runtimeRoot,
          saved.filePath.slice("data/".length),
        );
        const ownedBackup = path.join(path.dirname(canonicalPath), "owned-backup.wav");
        const foreign = Buffer.from("foreign-canonical-must-survive");
        const ownedStat = fs.statSync(canonicalPath);
        const originalClose = fs.closeSync;
        const originalRename = fs.renameSync;
        let swapped = false;
        let productionRenames = 0;
        fs.renameSync = ((...args: Parameters<typeof fs.renameSync>) => {
          productionRenames += 1;
          return originalRename(...args);
        }) as typeof fs.renameSync;
        fs.closeSync = ((descriptor: number) => {
          const stat = fs.fstatSync(descriptor);
          const result = originalClose(descriptor);
          if (!swapped && stat.dev === ownedStat.dev && stat.ino === ownedStat.ino) {
            swapped = true;
            originalRename(canonicalPath, ownedBackup);
            fs.writeFileSync(canonicalPath, foreign);
          }
          return result;
        }) as typeof fs.closeSync;
        let swappedResult;
        try {
          swappedResult = AudioStorage.compensatePublishedAudioResult(saved);
        } finally {
          fs.closeSync = originalClose;
          fs.renameSync = originalRename;
        }
        assert.equal(swapped, true);
        assert.equal(productionRenames, 0);
        assert.equal(swappedResult.status, "failed");
        assert.equal(swappedResult.compensated, false);
        assert.equal(swappedResult.retryable, true);
        assert.deepEqual(fs.readFileSync(canonicalPath), foreign);
        assert.deepEqual(fs.readFileSync(ownedBackup), wav());
        const replay = AudioStorage.recoverPublishedAudio(slug, compensationRef);
        assert.equal(replay.status, "failed");
        assert.equal(replay.compensated, false);
        assert.deepEqual(fs.readFileSync(canonicalPath), foreign);
      });

      await scenario("foreign quarantine destination is preserved without canonical rename", () => {
        const slug = "sprint-129-27-quarantine-replay-swap";
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "canonical.wav",
          data: wav(),
        });
        const compensationRef = AudioStorage.getCompensationRef(saved);
        assert(compensationRef);
        const canonicalPath = path.join(
          storageContext.runtimeRoot,
          saved.filePath.slice("data/".length),
        );
        const quarantinePath = compensationQuarantinePath(
          storageContext,
          slug,
          compensationRef,
        );
        const foreign = Buffer.from("foreign-quarantine-replay");
        fs.mkdirSync(path.dirname(quarantinePath), { recursive: true });
        fs.writeFileSync(quarantinePath, foreign);
        const originalUnlink = fs.unlinkSync;
        const originalRm = fs.rmSync;
        const originalRmdir = fs.rmdirSync;
        let destructiveCalls = 0;
        const observe = (candidate: fs.PathLike) => {
          if (
            path.resolve(String(candidate)) === path.resolve(quarantinePath)
          ) {
            destructiveCalls += 1;
          }
        };
        fs.unlinkSync = ((...args: Parameters<typeof fs.unlinkSync>) => {
          observe(args[0]);
          return originalUnlink(...args);
        }) as typeof fs.unlinkSync;
        fs.rmSync = ((...args: Parameters<typeof fs.rmSync>) => {
          observe(args[0]);
          return originalRm(...args);
        }) as typeof fs.rmSync;
        fs.rmdirSync = ((...args: Parameters<typeof fs.rmdirSync>) => {
          observe(args[0]);
          return originalRmdir(...args);
        }) as typeof fs.rmdirSync;
        let replay;
        let restarted;
        try {
          replay = AudioStorage.recoverPublishedAudio(slug, compensationRef);
          restarted = AudioStorage.recoverPublishedAudio(slug, compensationRef);
        } finally {
          fs.unlinkSync = originalUnlink;
          fs.rmSync = originalRm;
          fs.rmdirSync = originalRmdir;
        }
        assert.equal(destructiveCalls, 0);
        assert.equal(replay.compensated, true);
        assert.equal(replay.cleanup, "deferred");
        assert.equal(restarted.compensated, true);
        assert.equal(restarted.cleanup, "deferred");
        assert.deepEqual(fs.readFileSync(quarantinePath), foreign);
        assert.equal(fs.existsSync(canonicalPath), true);
      });

      await scenario("receipt-bound terminal retirement is exact and idempotent", () => {
        const slug = "sprint-129-27-record-finalization";
        const { compensationRef } = createRegistryOwnedFixture(
          slug,
          "finalization.wav",
        );
        const workspace = compensationWorkspacePath(
          storageContext,
          slug,
          compensationRef,
        );
        const recordDirectory = path.join(workspace, "record");
        const legacyRecord = path.join(
          storageContext.projectsRoot,
          slug,
          "production-execution",
          "audio-compensation",
          compensationRef,
        );
        assert.equal(fs.existsSync(recordDirectory), true);
        assert.equal(fs.existsSync(legacyRecord), false);
        const originalRename = fs.renameSync;
        const originalRm = fs.rmSync;
        const originalUnlink = fs.unlinkSync;
        let destructiveCalls = 0;
        fs.renameSync = ((...args: Parameters<typeof fs.renameSync>) => {
          if (path.resolve(String(args[0])).startsWith(path.resolve(workspace))) {
            destructiveCalls += 1;
          }
          return originalRename(...args);
        }) as typeof fs.renameSync;
        fs.rmSync = ((...args: Parameters<typeof fs.rmSync>) => {
          if (path.resolve(String(args[0])).startsWith(path.resolve(workspace))) {
            destructiveCalls += 1;
          }
          return originalRm(...args);
        }) as typeof fs.rmSync;
        fs.unlinkSync = ((...args: Parameters<typeof fs.unlinkSync>) => {
          if (path.resolve(String(args[0])).startsWith(path.resolve(workspace))) {
            destructiveCalls += 1;
          }
          return originalUnlink(...args);
        }) as typeof fs.unlinkSync;
        try {
          removeRegistryRecord(slug, compensationRef, storageContext);
          removeRegistryRecord(slug, compensationRef, storageContext);
        } finally {
          fs.renameSync = originalRename;
          fs.rmSync = originalRm;
          fs.unlinkSync = originalUnlink;
        }
        assert.equal(destructiveCalls, 0);
        assert.equal(fs.existsSync(recordDirectory), true);
        assert.equal(fs.existsSync(workspace), true);
        assert.equal(
          fs.readdirSync(path.dirname(workspace)).some((entry) =>
            entry === `retirement-${compensationRef}.json`
          ),
          true,
        );
      });

      await scenario("foreign receipt-bound record replacement is preserved fail closed", () => {
        const slug = "sprint-129-27-post-validation-deferred";
        const { compensationRef } = createRegistryOwnedFixture(
          slug,
          "post-validation.wav",
        );
        const cleanupRecord = path.join(
          compensationWorkspacePath(
            storageContext,
            slug,
            compensationRef,
          ),
          "record",
        );
        const latestState = fs.readdirSync(cleanupRecord)
          .filter((entry) => /^state-[0-9]{6}\.json$/.test(entry))
          .sort()
          .at(-1);
        assert(latestState);
        const detachedState = path.join(cleanupRecord, latestState);
        const backup = path.join(
          storageContext.projectsRoot,
          slug,
          "owned-post-validation-state",
        );
        const foreign = Buffer.from("foreign-post-validation-state");
        fs.renameSync(detachedState, backup);
        fs.writeFileSync(detachedState, foreign);
        assert.throws(() =>
          removeRegistryRecord(
            slug,
            compensationRef,
            storageContext,
          )
        );
        assert.deepEqual(fs.readFileSync(detachedState), foreign);
        assert.throws(() =>
          removeRegistryRecord(
            slug,
            compensationRef,
            storageContext,
          )
        );
        assert.deepEqual(fs.readFileSync(detachedState), foreign);
        const backlog = getDeferredAudioCompensationBacklogStatus(
          slug,
          storageContext,
        );
        assert.equal(backlog.status, "saturated");
        assert.equal(backlog.failedRecords, 1);
        assert.equal(backlog.acceptingWrites, false);
      });

      await scenario("partial receipt and state failures detach without path deletion", () => {
        for (const failureKind of ["receipt", "state"] as const) {
          const slug = `sprint-129-27-partial-${failureKind}`;
          const originalOpen = fs.openSync;
          const originalWrite = fs.writeSync;
          const originalRename = fs.renameSync;
          const originalRm = fs.rmSync;
          const originalUnlink = fs.unlinkSync;
          let failingDescriptor: number | undefined;
          let durableFailureInjected = false;
          let destructiveCalls = 0;
          fs.openSync = ((candidate: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
            const descriptor = originalOpen(candidate, flags, mode);
            const name = path.basename(String(candidate));
            if (
              !durableFailureInjected &&
              (failureKind === "receipt" &&
                name.startsWith("receipt.json.") &&
                name.endsWith(".partial")) ||
              (!durableFailureInjected &&
                failureKind === "state" &&
                name.startsWith("state-000001.json.") &&
                name.endsWith(".partial"))
            ) {
              failingDescriptor = descriptor;
            }
            return descriptor;
          }) as typeof fs.openSync;
          fs.writeSync = ((descriptor: number, ...args: unknown[]) => {
            if (descriptor === failingDescriptor) {
              durableFailureInjected = true;
              throw new Error("durable partial write");
            }
            return originalWrite(descriptor, ...(args as [
              buffer: Uint8Array,
              offset?: number,
              length?: number,
              position?: number | null,
            ]));
          }) as typeof fs.writeSync;
          fs.rmSync = ((...args: Parameters<typeof fs.rmSync>) => {
            if (String(args[0]).includes("audio-compensation")) {
              destructiveCalls += 1;
            }
            return originalRm(...args);
          }) as typeof fs.rmSync;
          fs.unlinkSync = ((...args: Parameters<typeof fs.unlinkSync>) => {
            if (String(args[0]).includes("audio-compensation")) {
              destructiveCalls += 1;
            }
            return originalUnlink(...args);
          }) as typeof fs.unlinkSync;
          try {
            assert.throws(() => AudioStorage.saveAudio({
              projectSlug: slug,
              fileName: `${failureKind}.wav`,
              data: wav(),
            }));
          } finally {
            fs.openSync = originalOpen;
            fs.writeSync = originalWrite;
            fs.renameSync = originalRename;
            fs.rmSync = originalRm;
            fs.unlinkSync = originalUnlink;
          }
          assert.equal(destructiveCalls, 0);
          const activeRoot = path.join(
            storageContext.projectsRoot,
            slug,
            "production-execution",
            "audio-compensation",
          );
          const cleanupRoot = path.join(
            storageContext.projectsRoot,
            slug,
            "production-execution",
            "audio-compensation-cleanup",
          );
          assert.deepEqual(
            fs.existsSync(activeRoot) ? fs.readdirSync(activeRoot) : [],
            [],
          );
          const deferredRecords = fs.readdirSync(cleanupRoot);
          assert.equal(deferredRecords.length, 1);
          const finalEntry = path.join(
            cleanupRoot,
            deferredRecords[0],
            "record",
            failureKind === "receipt"
              ? "receipt.json"
              : "state-000001.json",
          );
          assert.equal(fs.existsSync(finalEntry), false);
          const stagingDirectory = path.join(
            path.dirname(finalEntry),
            ".audio-journal-staging",
          );
          const partialEntries = fs.readdirSync(stagingDirectory).filter(
            (entry) => entry.startsWith(`${path.basename(finalEntry)}.`),
          );
          assert.equal(partialEntries.length, 1);
          const partial = fs.lstatSync(path.join(
            stagingDirectory,
            partialEntries[0],
          ));
          assert.equal(partial.isFile(), true);
          assert.equal(partial.size, 0);
        }
      });

      await scenario("foreign receipt destination blocks creation without clobber", () => {
        for (const kind of ["directory", "file"] as const) {
          const slug = `sprint-129-27-record-foreign-${kind}`;
          const originalMkdir = fs.mkdirSync;
          let destination = "";
          fs.mkdirSync = ((candidate: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
            if (!destination && path.basename(String(candidate)) === "record") {
              destination = String(candidate);
              if (kind === "directory") {
                originalMkdir(destination);
                fs.writeFileSync(path.join(destination, "foreign.keep"), "foreign");
              } else {
                fs.writeFileSync(destination, "foreign");
              }
            }
            return originalMkdir(candidate, options);
          }) as typeof fs.mkdirSync;
          try {
            assert.throws(() =>
              AudioStorage.saveAudio({
                projectSlug: slug,
                fileName: `${kind}.wav`,
                data: wav(),
              })
            );
          } finally {
            fs.mkdirSync = originalMkdir;
          }
          assert(destination);
          assert.equal(fs.existsSync(destination), true);
          assert.equal(
            kind === "directory"
              ? fs.readFileSync(path.join(destination, "foreign.keep"), "utf8")
              : fs.readFileSync(destination, "utf8"),
            "foreign",
          );
        }
      });

      await scenario("duplicate record finalization replay is idempotent", () => {
        const slug = "sprint-129-27-parallel-detach";
        const { compensationRef } = createRegistryOwnedFixture(
          slug,
          "parallel.wav",
        );
        const detach = () =>
          removeRegistryRecord(
            slug,
            compensationRef,
            storageContext,
          );
        detach();
        detach();
        const workspace = compensationWorkspacePath(
          storageContext,
          slug,
          compensationRef,
        );
        assert.equal(fs.existsSync(workspace), true);
        assert.equal(
          fs.existsSync(path.join(
            path.dirname(workspace),
            `retirement-${compensationRef}.json`,
          )),
          true,
        );
      });

      await scenario("compensation store uses exact non-recursive retirement", () => {
        const source = fs.readFileSync(
          path.resolve("src/lib/audio/AudioCompensationStore.ts"),
          "utf8",
        );
        assert.doesNotMatch(source, /\brmSync\s*\(/);
        assert.doesNotMatch(source, /recursive\s*:\s*true/);
        assert.match(source, /function unlinkExactFile\s*\(/);
        assert.doesNotMatch(source, /fs\.rmdirSync\s*\(/);
        assert.doesNotMatch(source, /fs\.unlinkSync\s*\(/);
        assert.doesNotMatch(source, /\.receipt-tmp/);
        assert.match(source, /path\.join\(workspace, "record"\)/);
        assert.doesNotMatch(source, /validated and removed/);
      });

      await scenario("protected receipt storage rejects collisions links corruption and tampering", () => {
        assert.equal(
          AudioStorage.recoverPublishedAudio(
            "safe-project",
            "../receipt.json",
          ).status,
          "rejected",
        );

        const fixture = (suffix: string) => {
          const projectSlug = `sprint-129-27-receipt-security-${suffix}`;
          const saved = AudioStorage.saveAudio({
            projectSlug,
            fileName: "canonical.wav",
            data: wav(),
          });
          const compensationRef = AudioStorage.getCompensationRef(saved);
          assert(compensationRef);
          const recordDirectory = path.join(
            compensationWorkspacePath(
              storageContext,
              projectSlug,
              compensationRef,
            ),
            "record",
          );
          return {
            projectSlug,
            saved,
            compensationRef,
            recordDirectory,
            receiptPath: path.join(recordDirectory, "receipt.json"),
          };
        };

        const truncated = fixture("truncated");
        fs.writeFileSync(truncated.receiptPath, "{\"schemaVersion\":");
        assert.equal(
          AudioStorage.recoverPublishedAudio(
            truncated.projectSlug,
            truncated.compensationRef,
          ).status,
          "rejected",
        );

        for (const [name, mutate] of [
          ["unsupported", (value: Record<string, unknown>) => {
            value.schemaVersion = "unsupported";
          }],
          ["hash", (value: Record<string, unknown>) => {
            value.sha256 = "0".repeat(64);
          }],
          ["size", (value: Record<string, unknown>) => {
            value.byteLength = -1;
          }],
          ["integrity", (value: Record<string, unknown>) => {
            value.integrity = "0".repeat(64);
          }],
        ] as const) {
          const current = fixture(name);
          const value = JSON.parse(
            fs.readFileSync(current.receiptPath, "utf8"),
          ) as Record<string, unknown>;
          mutate(value);
          fs.writeFileSync(current.receiptPath, JSON.stringify(value));
          assert.equal(
            AudioStorage.recoverPublishedAudio(
              current.projectSlug,
              current.compensationRef,
            ).status,
            "rejected",
          );
        }

        const malformedState = fixture("malformed-state");
        fs.writeFileSync(
          path.join(malformedState.recordDirectory, "state-000002.json"),
          "{}",
          { flag: "wx" },
        );
        assert.equal(
          AudioStorage.recoverPublishedAudio(
            malformedState.projectSlug,
            malformedState.compensationRef,
          ).status,
          "rejected",
        );

        const linked = fixture("linked");
        const recordBackup = `${linked.recordDirectory}-backup`;
        fs.renameSync(linked.recordDirectory, recordBackup);
        fs.symlinkSync(
          recordBackup,
          linked.recordDirectory,
          process.platform === "win32" ? "junction" : "dir",
        );
        assert.equal(
          AudioStorage.recoverPublishedAudio(
            linked.projectSlug,
            linked.compensationRef,
          ).status,
          "rejected",
        );

        const quarantineCollision = fixture("quarantine-collision");
        const canonicalPath = path.join(
          storageContext.runtimeRoot,
          quarantineCollision.saved.filePath.slice("data/".length),
        );
        fs.writeFileSync(
          compensationQuarantinePath(
            storageContext,
            quarantineCollision.projectSlug,
            quarantineCollision.compensationRef,
          ),
          "foreign-quarantine-collision",
        );
        const quarantineCollisionRecovery = AudioStorage.recoverPublishedAudio(
          quarantineCollision.projectSlug,
          quarantineCollision.compensationRef,
        );
        assert.equal(quarantineCollisionRecovery.status, "completed");
        assert.equal(quarantineCollisionRecovery.compensated, true);
        assert.equal(
          fs.readFileSync(compensationQuarantinePath(
            storageContext,
            quarantineCollision.projectSlug,
            quarantineCollision.compensationRef,
          ), "utf8"),
          "foreign-quarantine-collision",
        );
        assert.equal(fs.existsSync(canonicalPath), true);

        const originalMkdir = fs.mkdirSync;
        let collided = false;
        let foreignDestination = "";
        fs.mkdirSync = ((candidate: fs.PathLike, ...args: unknown[]) => {
          if (
            !collided &&
            String(candidate).includes("audio-compensation") &&
            path.basename(String(candidate)).startsWith("audio-comp-")
          ) {
            collided = true;
            foreignDestination = String(candidate);
            originalMkdir(candidate, ...(args as []));
            fs.writeFileSync(
              path.join(foreignDestination, "foreign.keep"),
              "foreign-destination",
            );
          }
          return originalMkdir(candidate, ...(args as []));
        }) as typeof fs.mkdirSync;
        try {
          assert.throws(() =>
            AudioStorage.saveAudio({
              projectSlug: "sprint-129-27-receipt-security-collision",
              fileName: "canonical.wav",
              data: wav(),
            })
          );
        } finally {
          fs.mkdirSync = originalMkdir;
        }
        assert.equal(collided, true);
        assert.equal(
          fs.readFileSync(path.join(foreignDestination, "foreign.keep"), "utf8"),
          "foreign-destination",
        );
      });

      await scenario("real pipeline failure preserves durable compensation ref", async () => {
        const project = await ProjectManager.createProject(
          "Sprint 129 27 durable compensation",
        );
        await PipelineJobManager.listJobs(project.slug);
        const executionContext = {
          projectSlug: project.slug,
          stage: "audio" as const,
          runType: "initial" as const,
        };
        const prepared = await prepareProductionPipelineExecution(executionContext);
        const adapter = new ProductionPipelineExecutionAdapter(
          prepared.adapter,
          () => prepared.request,
        );
        globalThis.fetch = async () => response(wav());
        const originalOpen = fs.openSync;
        let registryCalls = 0;
        let pipelineFailure: unknown;
        fs.openSync = ((candidate: fs.PathLike, ...args: unknown[]) => {
          if (String(candidate).includes("audio-publication-intents") &&
            String(args[0]).includes("x")) {
            registryCalls += 1;
            throw new Error("C:\\private authorization stack");
          }
          return (originalOpen as (...values: unknown[]) => number)(
            candidate,
            ...args,
          );
        }) as typeof fs.openSync;
        try {
          await adapter.execute(executionContext, async () => {
            try {
              await AudioPipeline.generateAudio({
                projectId: project.id,
                projectSlug: project.slug,
                audio: audioData(),
                provider: new OpenAIAudioProvider(),
              });
              return true;
            } catch (error) {
              pipelineFailure = error;
              throw error;
            }
          });
          assert.fail("pipeline execution must fail");
        } catch {
          assert(pipelineFailure);
        } finally {
          fs.openSync = originalOpen;
        }
        const evidence = getAudioAssetErrorEvidence(pipelineFailure);
        assert.equal(evidence?.rootCode, "AUDIO_ASSET_REGISTRY_FAILED");
        assert.equal(evidence?.phase, "registry");
        assert.equal(evidence?.compensation, "not-required");
        assert.equal(evidence?.cleanup, "completed");
        assert.equal(evidence?.compensationRef, undefined);
        assert.equal(registryCalls, 1);
        const attempt = await latestAttemptEvidence(prepared);
        const serializedAttempt = JSON.stringify(attempt);
        assert(serializedAttempt.includes("audio-compensation:not-required"));
        assert(serializedAttempt.includes("audio-cleanup:completed"));
        assert.doesNotMatch(
          serializedAttempt,
          /API_KEY|Authorization|C:\\|stack|narration|[0-9a-f]{64}/i,
        );
      });

      let actualReadbackFailure: AudioAssetGenerationError | undefined;
      for (const [name, code] of [
        ["stat", "EACCES"],
        ["open", "EACCES"],
        ["read", "EIO"],
      ] as const) {
        await scenario(`stored readback ${name} failure is classified as storage`, async () => {
          const slug = `sprint-129-27-readback-${name}`;
          const saved = AudioStorage.saveAudio({
            projectSlug: slug,
            fileName: "canonical.wav",
            data: wav(),
          });
          const canonical = path.join(
            storageContext.runtimeRoot,
            saved.filePath.slice("data/".length),
          );
          const originalStat = fs.statSync;
          const originalOpen = fs.openSync;
          const originalRead = fs.readFileSync;
          let injected = false;
          let canonicalDescriptor: number | undefined;
          const failure = () => {
            injected = true;
            const error = new Error("C:\\private API_KEY stack") as NodeJS.ErrnoException;
            error.code = code;
            return error;
          };
          (fs as unknown as { statSync: typeof fs.statSync }).statSync = ((candidate: fs.PathLike, ...args: unknown[]) => {
            if (name === "stat" && !injected &&
              path.resolve(String(candidate)) === path.resolve(canonical)) {
              throw failure();
            }
            return (originalStat as (...values: unknown[]) => fs.Stats)(candidate, ...args);
          }) as typeof fs.statSync;
          fs.openSync = ((candidate: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
            if (path.resolve(String(candidate)) === path.resolve(canonical)) {
              if (name === "open" && !injected) throw failure();
              const descriptor = originalOpen(candidate, flags, mode);
              canonicalDescriptor = descriptor;
              return descriptor;
            }
            return originalOpen(candidate, flags, mode);
          }) as typeof fs.openSync;
          fs.readFileSync = ((candidate: fs.PathOrFileDescriptor, ...args: unknown[]) => {
            if (name === "read" && !injected && candidate === canonicalDescriptor) {
              throw failure();
            }
            return (originalRead as (...values: unknown[]) => ReturnType<typeof fs.readFileSync>)(
              candidate,
              ...args,
            );
          }) as typeof fs.readFileSync;
          try {
            await assert.rejects(
              AudioPipeline.generateAudio({
                projectId: `project-readback-${name}`,
                projectSlug: slug,
                audio: audioData(),
                provider: providerForSavedAudio(saved),
              }),
              (error) => {
                assertAudioRoot(error, "AUDIO_STORAGE_WRITE_FAILED");
                assert.equal(getAudioAssetErrorEvidence(error)?.phase, "storage");
                assert.doesNotMatch(JSON.stringify(error), /private|API_KEY|stack/i);
                if (name === "stat" && error instanceof AudioAssetGenerationError) {
                  actualReadbackFailure = error;
                }
                return true;
              },
            );
          } finally {
            (fs as unknown as { statSync: typeof fs.statSync }).statSync = originalStat;
            fs.openSync = originalOpen;
            fs.readFileSync = originalRead;
          }
          assert.equal(injected, true);
        });
      }

      await scenario("stored readback containment rejection is classified as storage", async () => {
        const slug = "sprint-129-27-readback-containment";
        const projectId = "project-readback-containment";
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "canonical.wav",
          data: wav(),
        });
        const canonical = path.join(
          storageContext.runtimeRoot,
          saved.filePath.slice("data/".length),
        );
        const originalRealpath = fs.realpathSync;
        let injected = false;
        fs.realpathSync = ((candidate: fs.PathLike, ...args: unknown[]) => {
          if (!injected && path.resolve(String(candidate)) === path.resolve(canonical)) {
            injected = true;
            return path.join(root, "outside.wav");
          }
          return originalRealpath(candidate, ...(args as []));
        }) as typeof fs.realpathSync;
        try {
          await assert.rejects(
            AudioPipeline.generateAudio({
              projectId,
              projectSlug: slug,
              audio: audioData(),
              provider: providerForSavedAudio(saved),
            }),
            (error) => {
              assertAudioRoot(error, "AUDIO_STORAGE_WRITE_FAILED");
              assert.equal(getAudioAssetErrorEvidence(error)?.phase, "storage");
              return true;
            },
          );
        } finally {
          fs.realpathSync = originalRealpath;
        }
        assert.equal(injected, true);
        const assets = AssetManager.getProjectAssets(slug, projectId);
        assert.equal(assets.assets.length, 1);
        assert.equal(assets.assets[0]?.status, "failed");
      });

      await scenario("durably mismatched malformed stored WAV fails at admission", async () => {
        const slug = "sprint-129-27-readback-malformed";
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "canonical.wav",
          data: wav(),
        });
        const canonical = path.join(
          storageContext.runtimeRoot,
          saved.filePath.slice("data/".length),
        );
        fs.writeFileSync(canonical, Buffer.from("malformed"));
        await assert.rejects(
          AudioPipeline.generateAudio({
            projectId: "project-readback-malformed",
            projectSlug: slug,
            audio: audioData(),
            provider: providerForSavedAudio(saved),
          }),
          (error) => {
            assertAudioRoot(error, "AUDIO_STORAGE_WRITE_FAILED");
            assert.equal(getAudioAssetErrorEvidence(error)?.phase, "storage");
            return true;
          },
        );
      });

      await scenario("actual readback failure reaches durable serialized evidence", async () => {
        assert(actualReadbackFailure);
        const project = await ProjectManager.createProject(
          "Sprint 129 27 actual readback durable",
        );
        await PipelineJobManager.listJobs(project.slug);
        const context = {
          projectSlug: project.slug,
          stage: "audio" as const,
          runType: "initial" as const,
        };
        const prepared = await prepareProductionPipelineExecution(context);
        const adapter = new ProductionPipelineExecutionAdapter(
          prepared.adapter,
          () => prepared.request,
        );
        await assert.rejects(adapter.execute(context, async () => {
          throw actualReadbackFailure;
        }));
        const attempt = await latestAttemptEvidence(prepared);
        const terminal = attempt?.journal.find((entry) =>
          entry.entryId === prepared.request.terminalEventId);
        assert(terminal);
        assert(terminal.evidence.includes(
          "audio-root:AUDIO_STORAGE_WRITE_FAILED",
        ));
        assert(terminal.evidence.includes("audio-phase:storage"));
      });

      let actualRegistryPreparationFailure:
        | AudioAssetGenerationError
        | undefined;
      await scenario("registry preparation failure retires workspace before canonical commit", async () => {
        const original = fs.openSync;
        fs.openSync = ((candidate: fs.PathLike, ...args: unknown[]) => {
          if (String(candidate).includes("audio-publication-intents") &&
            String(args[0]).includes("x")) {
            throw new Error("registry C:\\private API_KEY stack");
          }
          return (original as (...values: unknown[]) => number)(candidate, ...args);
        }) as typeof fs.openSync;
        globalThis.fetch = async () => response(wav());
        const slug = "sprint-129-27-registry";
        try {
          await assert.rejects(
            AudioPipeline.generateAudio({
              projectId: "project-registry",
              projectSlug: slug,
              audio: audioData(),
              provider: new OpenAIAudioProvider(),
            }),
            (error) => {
              assertAudioRoot(error, "AUDIO_ASSET_REGISTRY_FAILED");
              actualRegistryPreparationFailure =
                error as AudioAssetGenerationError;
              assert.equal(
                getAudioAssetErrorEvidence(error)?.compensation,
                "not-required",
              );
              assert.equal(
                getAudioAssetErrorEvidence(error)?.cleanup,
                "completed",
              );
              assert(
                serializeAudioAssetErrorEvidence(
                  getAudioAssetErrorEvidence(error),
                ).includes("audio-cleanup:completed"),
              );
              return true;
            },
          );
        } finally {
          fs.openSync = original;
        }
        const audioRoot = path.join(storageContext.projectsRoot, slug, "assets", "audio");
        const entries = fs.existsSync(audioRoot) ? await fsp.readdir(audioRoot) : [];
        assert.equal(entries.filter((entry) => entry.endsWith(".wav")).length, 0);
        assert.equal(entries.filter((entry) => entry.startsWith(".audio-quarantine-")).length, 0);
      });

      await scenario("real registry cleanup reaches durable job history and manifest evidence", async () => {
        assert(actualRegistryPreparationFailure);
        const project = await ProjectManager.createProject(
          "Sprint 129 27 real deferred evidence",
        );
        await PipelineJobManager.listJobs(project.slug);
        await PipelineJobManager.startStage(
          project.slug,
          "audio",
          () => ProjectManager.updatePackageStatus(
            project.slug,
            "audio",
            "running",
            undefined,
            { runType: "initial" },
          ).then(() => undefined),
        );
        await PipelineJobManager.persistStageFailure(
          project.slug,
          "audio",
          () => ProjectManager.updatePackageStatus(
            project.slug,
            "audio",
            "failed",
            actualRegistryPreparationFailure?.code,
            { errorEvidence: actualRegistryPreparationFailure?.evidence },
          ).then(() => undefined),
          actualRegistryPreparationFailure.code,
          actualRegistryPreparationFailure.evidence,
        );
        const job = await PipelineJobManager.getJobForStageReadOnly(
          project.slug,
          "audio",
        );
        const manifest = await ProjectManager.getManifest(project.slug);
        const history = await PipelineJobManager.listHistory(project.slug);
        assert.equal(
          (job?.errorEvidence as { cleanup?: unknown } | undefined)?.cleanup,
          "completed",
        );
        assert.equal(
          (manifest?.packages.audio.errorEvidence as
            | { cleanup?: unknown }
            | undefined)?.cleanup,
          "completed",
        );
        assert.equal(
          (history.events.at(-1)?.errorEvidence as
            | { cleanup?: unknown }
            | undefined)?.cleanup,
          "completed",
        );

        const durableProject = await ProjectManager.createProject(
          "Sprint 129 27 real deferred durable",
        );
        await PipelineJobManager.listJobs(durableProject.slug);
        const executionContext = {
          projectSlug: durableProject.slug,
          stage: "audio" as const,
          runType: "initial" as const,
        };
        const prepared = await prepareProductionPipelineExecution(
          executionContext,
        );
        const adapter = new ProductionPipelineExecutionAdapter(
          prepared.adapter,
          () => prepared.request,
        );
        await assert.rejects(adapter.execute(executionContext, async () => {
          throw actualRegistryPreparationFailure;
        }));
        const terminal = (await latestAttemptEvidence(prepared))?.journal.find(
          (entry) => entry.entryId === prepared.request.terminalEventId,
        );
        assert(terminal);
        assert(terminal.evidence.includes("audio-cleanup:completed"));
        assert.doesNotMatch(
          JSON.stringify({ job, manifest, history, terminal }),
          /Authorization|API_KEY|C:\\|stack|narration|inode|device/i,
        );
      });

      await scenario("failed precommit workspace retirement remains deferred in durable evidence", async () => {
        const project = await ProjectManager.createProject(
          "Sprint 129 27 real cleanup evidence",
        );
        await PipelineJobManager.listJobs(project.slug);
        const executionContext = {
          projectSlug: project.slug,
          stage: "audio" as const,
          runType: "initial" as const,
        };
        const prepared = await prepareProductionPipelineExecution(
          executionContext,
        );
        const adapter = new ProductionPipelineExecutionAdapter(
          prepared.adapter,
          () => prepared.request,
        );
        const originalOpen = fs.openSync;
        let registryFailed = false;
        let retirementFailed = false;
        let pipelineFailure: unknown;
        fs.openSync = ((candidate: fs.PathLike, ...args: unknown[]) => {
          const candidatePath = String(candidate);
          const flags = String(args[0]);
          if (candidatePath.includes("audio-publication-intents") && flags.includes("x")) {
            registryFailed = true;
            throw new Error("registry Authorization C:\\private stack");
          }
          if (registryFailed && path.basename(candidatePath).startsWith("state-") &&
            candidatePath.endsWith(".partial") && flags.includes("x")) {
            retirementFailed = true;
            throw new Error("workspace retirement failure");
          }
          return (originalOpen as (...values: unknown[]) => number)(candidate, ...args);
        }) as typeof fs.openSync;
        globalThis.fetch = async () => response(wav());
        try {
          await assert.rejects(adapter.execute(executionContext, async () => {
            try {
              await AudioPipeline.generateAudio({
                projectId: project.id,
                projectSlug: project.slug,
                audio: audioData(),
                provider: new OpenAIAudioProvider(),
              });
              return true;
            } catch (error) {
              pipelineFailure = error;
              throw error;
            }
          }));
        } finally {
          fs.openSync = originalOpen;
        }
        assert.equal(registryFailed, true);
        assert.equal(retirementFailed, true);
        const evidence = getAudioAssetErrorEvidence(pipelineFailure);
        assert.equal(evidence?.rootCode, "AUDIO_ASSET_REGISTRY_FAILED");
        assert.equal(evidence?.compensation, "failed");
        assert.equal(evidence?.cleanup, "deferred");
        assert.equal(isSafeAudioCompensationRef(evidence?.compensationRef), true);
        const terminal = (await latestAttemptEvidence(prepared))?.journal.find(
          (entry) => entry.entryId === prepared.request.terminalEventId,
        );
        assert(terminal);
        assert(terminal.evidence.includes("audio-cleanup:deferred"));
        assert(terminal.evidence.includes("audio-compensation:failed"));
        const audioRoot = path.join(
          storageContext.projectsRoot, project.slug, "assets", "audio",
        );
        assert.equal(fs.existsSync(audioRoot) ? fs.readdirSync(audioRoot).length : 0, 0);
        assert.doesNotMatch(
          JSON.stringify({ evidence, terminal }),
          /Authorization|API_KEY|C:\\|stack|narration|workspace retirement/i,
        );
      });

      for (const malformedCase of [
        ["hyphen-only", `audio-comp-${"-".repeat(36)}`],
        ["non-uuid-hex", `audio-comp-${"0".repeat(36)}`],
        ["uuid-v1", "audio-comp-123e4567-e89b-12d3-a456-426614174000"],
        ["invalid-variant", "audio-comp-123e4567-e89b-42d3-7456-426614174000"],
        ["uppercase-uuid", "audio-comp-123E4567-E89B-42D3-A456-426614174000"],
        ["missing-character", "audio-comp-123e4567-e89b-42d3-a456-42661417400"],
        ["extra-character", "audio-comp-123e4567-e89b-42d3-a456-4266141740000"],
        ["malformed-uuid-shape", "audio-comp-123e4567-e89b-42d3-a456-42661417400-"],
      ] as const) {
        await scenario(`publication intent rejects malformed compensation ref ${malformedCase[0]}`, () => {
          const slug = `sprint-129-27-malformed-ref-${malformedCase[0]}`;
          const fixture = createTwoPhaseRegistryOwnedFixture(slug, "committed.wav", 1);
          const root = audioIntentRoot(storageContext, slug);
          const files = fs.readdirSync(root).map((entry) => path.join(root, entry));
          assert.equal(files.length, 1);
          assert.equal(isSafeAudioCompensationRef(fixture.compensationRef), true);
          assert.equal(isSafeAudioCompensationRef(malformedCase[1]), false);
          AssetManager.saveProjectAssets(
            slug,
            {
              ...AssetManager.createDefaultAssets(fixture.projectId, slug),
              assets: [fixture.asset],
            },
            storageContext,
          );
          rewriteIntent(files[0], (candidate) => {
            candidate.compensationRef = malformedCase[1];
          });

          const assertFailClosed = (read: () => unknown) => {
            let result: unknown;
            let caught: unknown;
            try {
              result = read();
            } catch (error) {
              caught = error;
            }
            assert.equal(result, undefined);
            assert(caught instanceof Error);
            const error = caught;
            assert.equal(error.name, "AudioPublicationIntentError");
            assert.equal(error.message, "Audio publication intent is invalid.");
            assert.equal(error.stack, undefined);
            const evidence = JSON.stringify({ name: error.name, message: error.message });
            assert.equal(evidence.includes(malformedCase[1]), false);
            assert.equal(evidence.includes(storageContext.runtimeRoot), false);
            assert.doesNotMatch(evidence, /secret|authorization|api[_-]?key|stack/i);
          };

          assertFailClosed(() => getPreparedAudioPublicationIntent(
            slug,
            fixture.compensationRef,
            storageContext,
          ));
          assertFailClosed(() => getCommittedAudioPublicationAssets(
            slug,
            fixture.projectId,
            storageContext,
          ));
          let registryAssetCount = 0;
          assertFailClosed(() => {
            const assets = AssetManager.getProjectAssets(
              slug,
              fixture.projectId,
              storageContext,
            );
            registryAssetCount = assets.assets.length;
            return assets;
          });
          assert.equal(registryAssetCount, 0);
        });
      }

      await scenario("canonical UUIDv4 compensation ref remains deterministic", () => {
        const slug = "sprint-129-27-canonical-compensation-ref";
        const fixture = createTwoPhaseRegistryOwnedFixture(slug, "committed.wav", 1);
        assert.equal(isSafeAudioCompensationRef(fixture.compensationRef), true);
        assert.equal(
          getPreparedAudioPublicationIntent(slug, fixture.compensationRef, storageContext)
            ?.compensationRef,
          fixture.compensationRef,
        );
        const first = getCommittedAudioPublicationAssets(
          slug,
          fixture.projectId,
          storageContext,
        );
        const registry = AssetManager.getProjectAssets(
          slug,
          fixture.projectId,
          storageContext,
        );
        const replay = getCommittedAudioPublicationAssets(
          slug,
          fixture.projectId,
          storageContext,
        );
        assert.equal(first.length, 1);
        assert.equal(registry.assets.length, 1);
        assert.deepEqual(replay, first);
      });

      for (const duplicateCase of [
        "intent-id",
        "compensation-ref",
        "asset-id",
        "canonical-path",
        "exact-copy",
        "prepared-committed-asset-id",
        "distinct-intent-canonical-path",
        "distinct-path-asset-id",
      ] as const) {
        await scenario(`publication intent collection rejects duplicate ${duplicateCase}`, () => {
          const slug = `sprint-129-27-duplicate-${duplicateCase}`;
          const first = createTwoPhaseRegistryOwnedFixture(slug, "first.wav", 1);
          const second = createTwoPhaseRegistryOwnedFixture(slug, "second.wav", 2);
          const root = audioIntentRoot(storageContext, slug);
          const files = fs.readdirSync(root).sort().map((entry) => path.join(root, entry));
          assert.equal(files.length, 2);
          const firstIntent = JSON.parse(fs.readFileSync(files[0], "utf8")) as {
            intentId: string;
            compensationRef: string;
            canonicalRelativePath: string;
            asset: { id: string; filePath: string };
          };
          if (duplicateCase === "exact-copy") {
            fs.copyFileSync(files[0], path.join(root, "safe-duplicate-copy.json"));
          } else {
            rewriteIntent(files[1], (candidate) => {
              const asset = candidate.asset as Record<string, unknown>;
              if (duplicateCase === "intent-id") candidate.intentId = firstIntent.intentId;
              if (duplicateCase === "compensation-ref") {
                candidate.compensationRef = firstIntent.compensationRef;
              }
              if (duplicateCase === "asset-id" ||
                duplicateCase === "prepared-committed-asset-id" ||
                duplicateCase === "distinct-path-asset-id") {
                asset.id = firstIntent.asset.id;
                candidate.registryPayloadFingerprint = createHash("sha256")
                  .update(JSON.stringify(asset))
                  .digest("hex");
              }
              if (duplicateCase === "canonical-path" ||
                duplicateCase === "distinct-intent-canonical-path") {
                candidate.canonicalRelativePath = firstIntent.canonicalRelativePath;
                asset.filePath = firstIntent.asset.filePath;
                candidate.registryPayloadFingerprint = createHash("sha256")
                  .update(JSON.stringify(asset))
                  .digest("hex");
              }
            });
          }
          if (duplicateCase === "prepared-committed-asset-id") {
            const canonical = path.join(
              storageContext.runtimeRoot,
              second.saved.filePath.slice("data/".length),
            );
            fs.renameSync(canonical, `${canonical}.prepared-fixture`);
          }

          let isolatedCount = 0;
          assert.throws(() => {
            isolatedCount = getCommittedAudioPublicationAssets(
              slug,
              first.projectId,
              storageContext,
            ).length;
          });
          assert.equal(isolatedCount, 0);
          let registryCount = 0;
          assert.throws(() => {
            registryCount = AssetManager.getProjectAssets(
              slug,
              first.projectId,
              storageContext,
            ).assets.length;
          });
          assert.equal(registryCount, 0);
          assert.throws(() => getCommittedAudioPublicationAssets(
            slug,
            first.projectId,
            storageContext,
          ));
        });
      }

      await scenario("two unique committed publication intents remain deterministic", () => {
        const slug = "sprint-129-27-unique-intents";
        const first = createTwoPhaseRegistryOwnedFixture(slug, "first.wav", 1);
        createTwoPhaseRegistryOwnedFixture(slug, "second.wav", 2);
        const isolated = getCommittedAudioPublicationAssets(
          slug,
          first.projectId,
          storageContext,
        );
        const registry = AssetManager.getProjectAssets(
          slug,
          first.projectId,
          storageContext,
        );
        const replay = getCommittedAudioPublicationAssets(
          slug,
          first.projectId,
          storageContext,
        );
        assert.equal(isolated.length, 2);
        assert.equal(registry.assets.length, 2);
        assert.deepEqual(replay, isolated);
      });

      await scenario("prepared intent recovers crash before canonical publish exactly once", async () => {
        const originalCommit = AudioStorage.commitPreparedAudio;
        const originalLink = fs.linkSync;
        const slug = "sprint-129-27-prepared-recovery";
        const projectId = "project-prepared-recovery";
        let compensationRef: string | undefined;
        let providerCalls = 0;
        let publishAttempts = 0;
        AudioStorage.commitPreparedAudio = ((value: unknown, candidateProjectId: string) => {
          compensationRef = AudioStorage.getCompensationRef(value);
          return originalCommit.call(AudioStorage, value, candidateProjectId);
        }) as typeof AudioStorage.commitPreparedAudio;
        fs.linkSync = ((source: fs.PathLike, destination: fs.PathLike) => {
          if (path.basename(String(source)) === "publication-staging.wav" &&
            String(destination).includes(`${path.sep}assets${path.sep}audio${path.sep}`)) {
            publishAttempts += 1;
            throw new Error("simulated crash before canonical link");
          }
          return originalLink(source, destination);
        }) as typeof fs.linkSync;
        globalThis.fetch = async () => {
          providerCalls += 1;
          return response(wav());
        };
        try {
          await assert.rejects(AudioPipeline.generateAudio({
            projectId,
            projectSlug: slug,
            audio: audioData(),
            provider: new OpenAIAudioProvider(),
          }));
        } finally {
          fs.linkSync = originalLink;
          AudioStorage.commitPreparedAudio = originalCommit;
        }
        assert.equal(providerCalls, 1);
        assert.equal(publishAttempts, 1);
        assert(compensationRef);
        assert.equal(
          getAudioPublicationLifecycleState(slug, compensationRef, storageContext),
          "prepared",
        );
        const audioRoot = path.join(storageContext.projectsRoot, slug, "assets", "audio");
        assert.equal(fs.existsSync(audioRoot) ? fs.readdirSync(audioRoot).length : 0, 0);
        assert.equal(AssetManager.getProjectAssets(slug, projectId, storageContext).assets.length, 0);
        const recovery = AudioStorage.recoverPublishedAudio(slug, compensationRef);
        assert.equal(recovery.status, "completed");
        assert.equal(recovery.compensated, false);
        assert.equal(providerCalls, 1);
        assert.equal(fs.readdirSync(audioRoot).filter((entry) => entry.endsWith(".wav")).length, 1);
        assert.equal(AssetManager.getProjectAssets(slug, projectId, storageContext).assets.length, 1);
        assert.equal(
          getAudioPublicationLifecycleState(slug, compensationRef, storageContext),
          "committed",
        );
        const replay = AudioStorage.recoverPublishedAudio(slug, compensationRef);
        assert.equal(replay.status, "completed");
        assert.equal(replay.compensated, false);
        assert.equal(fs.readdirSync(audioRoot).filter((entry) => entry.endsWith(".wav")).length, 1);
        assert.equal(AssetManager.getProjectAssets(slug, projectId, storageContext).assets.length, 1);
      });

      await scenario("prepared intent recovers crash after canonical publish without provider replay", async () => {
        const originalHandoff = AudioStorage.handoffPublishedAudio;
        let crashInjected = false;
        let providerCalls = 0;
        const compensationRefs: string[] = [];
        AudioStorage.handoffPublishedAudio = ((value: unknown, projectId: string) => {
          const compensationRef = AudioStorage.getCompensationRef(value);
          if (compensationRef) compensationRefs.push(compensationRef);
          if (!crashInjected) {
            crashInjected = true;
            throw new Error("simulated crash after canonical publish");
          }
          return originalHandoff.call(AudioStorage, value, projectId);
        }) as typeof AudioStorage.handoffPublishedAudio;
        globalThis.fetch = async () => {
          providerCalls += 1;
          return response(wav());
        };
        const slug = "sprint-129-27-registry-reconcile";
        try {
          await assert.rejects(AudioPipeline.generateAudio({
              projectId: "project-registry-reconcile",
              projectSlug: slug,
              audio: audioData(),
              provider: new OpenAIAudioProvider(),
            }));
        } finally {
          AudioStorage.handoffPublishedAudio = originalHandoff;
        }
        assert.equal(crashInjected, true);
        assert.equal(providerCalls, 1);
        const committed = AssetManager.getProjectAssets(
          slug, "project-registry-reconcile", storageContext,
        );
        assert.equal(committed.assets.length, 1);
        assert.equal(compensationRefs.length, 1);
        for (const compensationRef of new Set(compensationRefs)) {
          const recovery = AudioStorage.recoverPublishedAudio(
            slug,
            compensationRef,
          );
          assert.equal(recovery.status, "completed");
          assert.equal(recovery.compensated, false);
          const replay = AudioStorage.recoverPublishedAudio(
            slug,
            compensationRef,
          );
          assert.equal(replay.status, "completed");
          assert.equal(replay.compensated, false);
        }
        assert.equal(providerCalls, 1);
        const replayed = AssetManager.getProjectAssets(
          slug, "project-registry-reconcile", storageContext,
        );
        assert.equal(replayed.assets.length, 1);
        for (const asset of replayed.assets) {
          assert(asset.filePath);
          assert.equal(
            fs.existsSync(path.join(
              storageContext.runtimeRoot,
              asset.filePath.slice("data/".length),
            )),
            true,
          );
        }
      });

      await scenario("registry authority change fails closed without compensating canonical", async () => {
        const slug = "sprint-129-27-registry-authority-change";
        const projectId = "project-registry-authority-change";
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "authority-change.wav",
          data: wav(),
        });
        const asset = AudioStorage.transferPublicationOwnership(
          saved,
          AssetManager.createAsset({
            projectId,
            projectSlug: slug,
            type: "audio",
            status: "generated",
            provider: "openai",
            model: "mock-tts-model",
            prompt: "audio-generation-request",
            ...saved,
          }),
        );
        AssetManager.addAssetAtomically(slug, projectId, asset);
        const originalGet = AssetManager.getProjectAssets;
        let ownershipReads = 0;
        let authorityChanged = false;
        AssetManager.getProjectAssets = ((...args: Parameters<
          typeof AssetManager.getProjectAssets
        >) => {
          const current = originalGet.apply(AssetManager, args);
          if (
            args[0] === slug &&
            current.assets.some((asset) => asset.type === "audio")
          ) {
            ownershipReads += 1;
            if (ownershipReads === 2) {
              authorityChanged = true;
              const changed = {
                ...current,
                assets: current.assets.filter((asset) =>
                  asset.type !== "audio"
                ),
                updatedAt: new Date().toISOString(),
              };
              fs.writeFileSync(
                path.join(
                  storageContext.runtimeRoot,
                  AssetManager.getAssetsPath(slug).slice("data/".length),
                ),
                JSON.stringify(changed, null, 2),
                "utf8",
              );
              return originalGet.apply(AssetManager, args);
            }
          }
          return current;
        }) as typeof AssetManager.getProjectAssets;
        let handoff;
        try {
          handoff = AudioStorage.handoffPublishedAudio(asset, projectId);
        } finally {
          AssetManager.getProjectAssets = originalGet;
        }
        assert.equal(authorityChanged, true);
        assert.equal(handoff.status, "conflict");
        const compensationRef = AudioStorage.getCompensationRef(asset);
        assert(compensationRef);
        const canonicalPath = path.join(
          storageContext.runtimeRoot,
          asset.filePath?.slice("data/".length) ?? "",
        );
        assert.equal(fs.existsSync(canonicalPath), true);
        assert.equal(
          AssetManager.getProjectAssets(slug, projectId, storageContext)
            .assets.some((asset) =>
              asset.type === "audio" &&
              asset.status === "generated" &&
              asset.filePath === saved.filePath
            ),
          false,
        );
        const compensation = AudioStorage.compensatePublishedAudioResult(asset);
        assert.equal(compensation.status, "failed");
        assert.equal(compensation.compensated, false);
        assert.equal(compensation.retryable, true);
        assert.equal(fs.existsSync(canonicalPath), true);
      });

      const propagated = new AudioAssetGenerationError(
        createAudioAssetErrorEvidence("AUDIO_STORAGE_WRITE_FAILED", {
          phase: "storage",
          target: { kind: "section", chapterId: 1 },
          provider: "openai",
          model: "mock-tts-model",
          responseBytes: 4096,
          maximumResponseBytes: 4096,
          cleanup: "failed",
          compensation: "failed",
          compensationRef:
            "audio-comp-00000000-0000-4000-8000-000000000001",
        }),
      );

      await scenario("bounded evidence reaches job history and manifest", async () => {
        const project = await ProjectManager.createProject("Sprint 129 27 evidence");
        await PipelineJobManager.listJobs(project.slug);
        await PipelineJobManager.startStage(
          project.slug,
          "audio",
          () => ProjectManager.updatePackageStatus(
            project.slug,
            "audio",
            "running",
            undefined,
            { runType: "initial" },
          ).then(() => undefined),
        );
        await PipelineJobManager.persistStageFailure(
          project.slug,
          "audio",
          () => ProjectManager.updatePackageStatus(
            project.slug,
            "audio",
            "failed",
            propagated.code,
            { errorEvidence: propagated.evidence },
          ).then(() => undefined),
          propagated.code,
          propagated.evidence,
        );
        const job = await PipelineJobManager.getJobForStageReadOnly(project.slug, "audio");
        const manifest = await ProjectManager.getManifest(project.slug);
        const history = await PipelineJobManager.listHistory(project.slug);
        assert.deepEqual(job?.errorEvidence, propagated.evidence);
        assert.deepEqual(manifest?.packages.audio.errorEvidence, propagated.evidence);
        assert.deepEqual(history.events.at(-1)?.errorEvidence, propagated.evidence);
        const serialized = JSON.stringify({ job, manifest, history });
        assert.doesNotMatch(serialized, /Authorization|API_KEY|C:\\|stack|narration/i);
      });

      await scenario("bounded evidence reaches durable terminal attempt", async () => {
        const project = await ProjectManager.createProject("Sprint 129 27 durable");
        await PipelineJobManager.listJobs(project.slug);
        const context = {
          projectSlug: project.slug,
          stage: "audio" as const,
          runType: "initial" as const,
        };
        const prepared = await prepareProductionPipelineExecution(context);
        const adapter = new ProductionPipelineExecutionAdapter(
          prepared.adapter,
          () => prepared.request,
        );
        await assert.rejects(adapter.execute(context, async () => {
          throw propagated;
        }));
        const attempt = await latestAttemptEvidence(prepared);
        assert.equal(attempt?.state, "failed");
        const terminal = attempt?.journal.find((entry) =>
          entry.entryId === prepared.request.terminalEventId);
        assert(terminal);
        assert.ok(terminal.evidence.includes("failure:AUDIO_ASSET_GENERATION_FAILED"));
        assert.ok(terminal.evidence.includes("audio-root:AUDIO_STORAGE_WRITE_FAILED"));
        assert.ok(terminal.evidence.includes("audio-phase:storage"));
        assert.ok(terminal.evidence.includes("audio-cleanup:failed"));
        assert.ok(terminal.evidence.includes("audio-compensation:failed"));
        assert.ok(terminal.evidence.includes(
          "audio-compensation-ref:audio-comp-00000000-0000-4000-8000-000000000001",
        ));
        assert.doesNotMatch(
          JSON.stringify(attempt),
          /Authorization|API_KEY|C:\\|stack|narration|provider.?response/i,
        );
      });

      await scenario("evidence schema is bounded and path-free", () => {
        const serialized = serializeAudioAssetErrorEvidence(propagated.evidence);
        assert.ok(serialized.length <= 10);
        assert.ok(serialized.every((item) => item.length <= 160));
        assert.doesNotMatch(JSON.stringify(propagated), /Authorization|API_KEY|C:\\|stack|narration/i);
      });

      await scenario("provider router selects OpenAI once with no retry or mock fallback", async () => {
        const originalOpenAIGenerate = OpenAIAudioProvider.prototype.generateAudio;
        const originalMockGenerate = MockAudioProvider.prototype.generateAudio;
        let openAICalls = 0;
        let mockCalls = 0;
        process.env.AUDIO_PROVIDER = "openai";
        OpenAIAudioProvider.prototype.generateAudio = async function (
          input: AudioGenerationInput,
        ) {
          openAICalls += 1;
          throw new AudioAssetRootError("AUDIO_PROVIDER_REQUEST_FAILED", {
            phase: "request",
            target: input.target,
            provider: "openai",
            model: "mock-tts-model",
          });
        };
        MockAudioProvider.prototype.generateAudio = async function (
          input: AudioGenerationInput,
        ) {
          mockCalls += 1;
          return {
            success: true,
            target: input.target,
            provider: "mock",
            model: "mock-audio-model",
            filePath: "",
            url: "",
            mimeType: "audio/mock",
            byteLength: 0,
            durationSeconds: 0,
            createdAt: new Date().toISOString(),
          };
        };
        try {
          assert(AudioProviderRouter.getProvider() instanceof OpenAIAudioProvider);
          await assert.rejects(
            AudioPipeline.generateAudio({
              projectId: "project-router",
              projectSlug: "sprint-129-27-router",
              audio: audioData(),
            }),
            (error) => assertAudioRoot(
              error,
              "AUDIO_PROVIDER_REQUEST_FAILED",
            ),
          );
          assert.equal(openAICalls, 1);
          assert.equal(mockCalls, 0);
        } finally {
          OpenAIAudioProvider.prototype.generateAudio = originalOpenAIGenerate;
          MockAudioProvider.prototype.generateAudio = originalMockGenerate;
          restoreEnvironment("AUDIO_PROVIDER", originalEnvironment.provider);
        }
      });
    });

    await scenario("cross-operation terminal backlog remains bounded after restart", async () => {
      const slug = "sprint-129-27-cross-operation-retention";
      const compensationRefs: string[] = [];
      let boundedBacklogCovered = false;
      for (let index = 0; index < 39; index += 1) {
        const operation = createProductionRuntimeOperationContext({
          operationId: `round7-terminal-${index.toString().padStart(2, "0")}`,
          operationType: "audio-remediation-test",
          authorityGeneration: initialRuntimeAuthorityGeneration,
          storageContext,
        });
        await runWithProductionRuntimeOperationContext(operation, () => {
          const saved = AudioStorage.saveAudio({
            projectSlug: slug,
            fileName: `terminal-${index.toString().padStart(2, "0")}.wav`,
            data: wav(),
          });
          const compensationRef = AudioStorage.getCompensationRef(saved);
          assert(compensationRef);
          compensationRefs.push(compensationRef);
          const result = AudioStorage.compensatePublishedAudioResult(saved);
          assert.equal(result.compensated, true);
          assert.equal(result.cleanup, "deferred");
          if (index === 38) {
            const backlog = getDeferredAudioCompensationBacklogStatus(
              slug,
              storageContext,
            );
            assert.equal(backlog.status, "deferred");
            assert.equal(backlog.observedRecords, 16);
            assert.equal(backlog.failedRecords, 0);
            assert.equal(backlog.acceptingWrites, true);
            boundedBacklogCovered = true;
          }
        });
      }
      assert.equal(boundedBacklogCovered, true);
      const compensationRoot = path.join(
        storageContext.projectsRoot,
        slug,
        "production-execution",
        "audio-compensation-cleanup",
      );
      const physicalEntries = fs.readdirSync(compensationRoot).sort();
      const retainedBeforeRestart = physicalEntries.filter((entry) =>
        entry.startsWith("audio-comp-") &&
        !physicalEntries.includes(`retirement-${entry}.json`)
      );
      assert.equal(retainedBeforeRestart.length, 16);
      assert.equal(
        physicalEntries.filter((entry) => entry.startsWith("retirement-")).length,
        23,
      );
      assert.equal(retainedBeforeRestart.includes(compensationRefs[0]), false);
      assert.equal(
        retainedBeforeRestart.includes(compensationRefs.at(-1) ?? ""),
        true,
      );

    });

    await scenario("real child admission excludes retired terminals from quota", async () => {
      const slug = "sprint-129-27-cross-operation-retention";
      const operation = createProductionRuntimeOperationContext({
        operationId: "round10-count-quota",
        operationType: "audio-remediation-test",
        authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext,
      });
      await runWithProductionRuntimeOperationContext(operation, async () => {
      const before = getDeferredAudioCompensationBacklogStatus(
        slug,
        storageContext,
      );
      assert.equal(before.status, "deferred");
      assert.equal(before.acceptingWrites, true);
      assert.equal(before.observedRecords, 16);
      assert.equal(before.maximumRecords, 40);
      const concurrent = await runConcurrentSaveChildren({
        root,
        runtimeRoot,
        authorityRoot,
        projectSlug: slug,
        operationPrefix: "convergence-count-race",
        filePrefix: "quota-race",
      });
      assert.equal(concurrent.readyHandshakes.length, 2);
      assert.notEqual(
        concurrent.readyHandshakes[0].processId,
        concurrent.readyHandshakes[1].processId,
      );
      const winners = concurrent.results.filter((attempt) => attempt.success);
      const losers = concurrent.results.filter((attempt) => !attempt.success);
      assert.equal(winners.length, 2);
      assert.equal(losers.length, 0);
      assert(
        concurrent.results.every((attempt) =>
          BigInt(attempt.startedAtNs) < BigInt(attempt.finishedAtNs)
        ),
      );
      const audioRoot = path.join(
        storageContext.projectsRoot,
        slug,
        "assets",
        "audio",
      );
      assert.equal(
        fs.readdirSync(audioRoot)
          .filter((entry) => entry.startsWith("quota-race-")).length,
        2,
      );
      const after = getDeferredAudioCompensationBacklogStatus(
        slug,
        storageContext,
      );
      assert.equal(after.status, "deferred");
      assert.equal(after.acceptingWrites, true);
      assert.equal(after.observedRecords, 18);
      const cleanupEntries = fs.readdirSync(path.join(
        storageContext.projectsRoot,
        slug,
        "production-execution",
        "audio-compensation-cleanup",
      )).filter((entry) => entry !== ".audio-journal-staging");
      assert.equal(cleanupEntries.length, 64);
      assert.equal(
        cleanupEntries.filter((entry) =>
          entry.startsWith("audio-comp-") &&
          !cleanupEntries.includes(`retirement-${entry}.json`)
        ).length,
        18,
      );
      });
    });

    await scenario("real child byte admission race has one winner", async () => {
      const slug = "sprint-129-27-byte-quota";
      const projectId = "sprint-129-27-byte-quota-id";
      const operation = createProductionRuntimeOperationContext({
        operationId: "round10-byte-quota",
        operationType: "audio-remediation-test",
        authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext,
      });
      await runWithProductionRuntimeOperationContext(operation, async () => {
      const saved = AudioStorage.saveAudio({
        projectSlug: slug,
        fileName: "registered.wav",
        data: wav(),
      });
      const asset = AudioStorage.transferPublicationOwnership(
        saved,
        AssetManager.createAsset({
          projectId,
          projectSlug: slug,
          type: "audio",
          status: "generated",
          provider: "openai",
          model: "mock-tts-model",
          prompt: "audio-generation-request",
          ...saved,
        }),
      );
      AssetManager.addAssetAtomically(slug, projectId, asset);
      const handoff = AudioStorage.handoffPublishedAudio(asset, projectId);
      assert(
        handoff.status === "registry-owned-confirmed" ||
          handoff.status === "registry-ownership-completed",
      );
      const compensationRef = AudioStorage.getCompensationRef(asset);
      assert(compensationRef);
      const before = getDeferredAudioCompensationBacklogStatus(
        slug,
        storageContext,
      );
      assert.equal(before.acceptingWrites, true);
      const workspace = compensationWorkspacePath(
        storageContext,
        slug,
        compensationRef,
      );
      assert.equal(fs.existsSync(path.join(workspace, "temporary.wav")), true);
      const marker = JSON.parse(
        fs.readFileSync(path.join(workspace, "workspace.json"), "utf8"),
      ) as { reservedBytes: number };
      assert(Number.isSafeInteger(marker.reservedBytes));
      const filler = path.join(workspace, "quota-reservation.fixture");
      fs.writeFileSync(filler, "");
      const fillerBytes =
        before.maximumBytes -
        marker.reservedBytes -
        logicalFileBytes(workspace);
      assert(fillerBytes > 0);
      fs.truncateSync(filler, fillerBytes);
      const available = getDeferredAudioCompensationBacklogStatus(
        slug,
        storageContext,
      );
      assert.equal(available.acceptingWrites, true);
      assert.equal(
        available.totalBytes,
        available.maximumBytes - marker.reservedBytes,
      );
      const concurrent = await runConcurrentSaveChildren({
        root,
        runtimeRoot,
        authorityRoot,
        projectSlug: slug,
        operationPrefix: "convergence-byte-race",
        filePrefix: "byte-race",
      });
      assert.equal(concurrent.readyHandshakes.length, 2);
      const winners = concurrent.results.filter((attempt) => attempt.success);
      const losers = concurrent.results.filter((attempt) => !attempt.success);
      assert.equal(winners.length, 1);
      assert.equal(losers.length, 1);
      assert.equal(losers[0].evidence?.cleanup, "backlog-saturated");
      assert.equal(losers[0].evidence?.compensation, "not-required");
      const saturated = getDeferredAudioCompensationBacklogStatus(
        slug,
        storageContext,
      );
      assert.equal(saturated.status, "saturated");
      assert.equal(saturated.acceptingWrites, false);
      assert.equal(saturated.totalBytes, saturated.maximumBytes);
      assert.equal(
        fs.readdirSync(path.join(
          storageContext.projectsRoot,
          slug,
          "assets",
          "audio",
        )).filter((entry) => entry.startsWith("byte-race-")).length,
        1,
      );
      assert.equal(AudioStorage.isPublishedAudioRegistryOwned(asset), true);
      });
    });

    await scenario("mixed active capacity remains separate from terminal backlog", async () => {
      const slug = "sprint-129-27-mixed-capacity-restart";
      let terminalRef = "";
      const terminalOperation = createProductionRuntimeOperationContext({
        operationId: "round8-mixed-terminal",
        operationType: "audio-remediation-test",
        authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext,
      });
      await runWithProductionRuntimeOperationContext(terminalOperation, () => {
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "terminal.wav",
          data: wav(),
        });
        terminalRef = AudioStorage.getCompensationRef(saved) ?? "";
        assert(terminalRef);
        assert.equal(
          AudioStorage.compensatePublishedAudioResult(saved).compensated,
          true,
        );
      });

      let retryableRef = "";
      const retryableOperation = createProductionRuntimeOperationContext({
        operationId: "round8-mixed-retryable",
        operationType: "audio-remediation-test",
        authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext,
      });
      await runWithProductionRuntimeOperationContext(retryableOperation, () => {
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "retryable.wav",
          data: wav(),
        });
        retryableRef = AudioStorage.getCompensationRef(saved) ?? "";
        assert(retryableRef);
        const originalOpen = fs.openSync;
        fs.openSync = ((candidate: fs.PathLike, ...args: unknown[]) => {
          const name = path.basename(String(candidate));
          if (
            name.startsWith("state-000003.json.") &&
            name.endsWith(".partial")
          ) {
            throw new Error("retryable compensation");
          }
          return (originalOpen as (...values: unknown[]) => number)(
            candidate,
            ...args,
          );
        }) as typeof fs.openSync;
        try {
          assert.equal(
            AudioStorage.compensatePublishedAudioResult(saved).retryable,
            true,
          );
        } finally {
          fs.openSync = originalOpen;
        }
      });

      let conflictRef = "";
      const conflictOperation = createProductionRuntimeOperationContext({
        operationId: "round8-mixed-conflict",
        operationType: "audio-remediation-test",
        authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext,
      });
      await runWithProductionRuntimeOperationContext(conflictOperation, () => {
        const projectId = `${slug}-id`;
        const saved = AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "conflict.wav",
          data: wav(),
        });
        conflictRef = AudioStorage.getCompensationRef(saved) ?? "";
        assert(conflictRef);
        const conflicting = AssetManager.createAsset({
          projectId,
          projectSlug: slug,
          type: "audio",
          status: "generated",
          provider: "openai",
          model: "mock-tts-model",
          prompt: "audio-generation-request",
          ...saved,
          byteLength: saved.byteLength + 1,
        });
        AssetManager.addAssetAtomically(slug, projectId, conflicting);
        const conflict = AudioStorage.compensatePublishedAudioResult(saved);
        assert.equal(conflict.compensated, false);
        assert.equal(conflict.retryable, true);
      });

      for (let index = 0; index < 29; index += 1) {
        const operation = createProductionRuntimeOperationContext({
          operationId: `round8-mixed-pending-${index.toString().padStart(2, "0")}`,
          operationType: "audio-remediation-test",
          authorityGeneration: initialRuntimeAuthorityGeneration,
          storageContext,
        });
        await runWithProductionRuntimeOperationContext(operation, () => {
          AudioStorage.saveAudio({
            projectSlug: slug,
            fileName: `pending-${index.toString().padStart(2, "0")}.wav`,
            data: wav(),
          });
        });
      }

      const restarted = await runSaveChild({
        root,
        runtimeRoot,
        authorityRoot,
        projectSlug: slug,
        operationId: "round8-mixed-child",
        fileName: "child-pending.wav",
      });
      assert(restarted.compensationRef);
      assert.equal(restarted.recordCount, 33);
      const recordRoot = path.join(
        storageContext.projectsRoot,
        slug,
        "production-execution",
        "audio-compensation-cleanup",
      );
      const retained = fs.readdirSync(recordRoot);
      assert.equal(retained.includes(terminalRef), true);
      assert.equal(retained.includes(retryableRef), true);
      assert.equal(retained.includes(conflictRef), true);
      assert.equal(
        fs.existsSync(path.join(
          storageContext.projectsRoot,
          slug,
          "production-execution",
          "audio-compensation-cleanup",
        )),
        true,
      );
    });

    await scenario("equal terminal timestamps preserve deterministic receipt identities", async () => {
      const slug = "sprint-129-27-retention-tie-break";
      const fixedTimestamp = "2026-01-01T00:00:00.000Z";
      const OriginalDate = Date;
      class FixedDate extends OriginalDate {
        constructor(value?: string | number) {
          super(value === undefined ? fixedTimestamp : value);
        }
        static override now() {
          return OriginalDate.parse(fixedTimestamp);
        }
      }
      const terminalRefs: string[] = [];
      globalThis.Date = FixedDate as DateConstructor;
      try {
        for (let index = 0; index < 2; index += 1) {
          const operation = createProductionRuntimeOperationContext({
            operationId: `round8-tie-terminal-${index}`,
            operationType: "audio-remediation-test",
            authorityGeneration: initialRuntimeAuthorityGeneration,
            storageContext,
          });
          await runWithProductionRuntimeOperationContext(operation, () => {
            const saved = AudioStorage.saveAudio({
              projectSlug: slug,
              fileName: `terminal-${index}.wav`,
              data: wav(),
            });
            const compensationRef = AudioStorage.getCompensationRef(saved);
            assert(compensationRef);
            terminalRefs.push(compensationRef);
            assert.equal(
              AudioStorage.compensatePublishedAudioResult(saved).compensated,
              true,
            );
          });
        }
      } finally {
        globalThis.Date = OriginalDate;
      }
      for (let index = 0; index < 30; index += 1) {
        const operation = createProductionRuntimeOperationContext({
          operationId: `round8-tie-pending-${index.toString().padStart(2, "0")}`,
          operationType: "audio-remediation-test",
          authorityGeneration: initialRuntimeAuthorityGeneration,
          storageContext,
        });
        await runWithProductionRuntimeOperationContext(operation, () => {
          AudioStorage.saveAudio({
            projectSlug: slug,
            fileName: `pending-${index.toString().padStart(2, "0")}.wav`,
            data: wav(),
          });
        });
      }
      await runSaveChild({
        root,
        runtimeRoot,
        authorityRoot,
        projectSlug: slug,
        operationId: "round8-tie-child",
        fileName: "child-pending.wav",
      });
      const retained = fs.readdirSync(path.join(
        storageContext.projectsRoot,
        slug,
        "production-execution",
        "audio-compensation-cleanup",
      ));
      const ordered = [...terminalRefs].sort();
      assert.equal(retained.includes(ordered[0]), true);
      assert.equal(retained.includes(ordered[1]), true);
      assert.equal(retained.length, 33);
    });

    await scenario("non-terminal retention capacity remains fail closed", async () => {
      const slug = "sprint-129-27-non-terminal-retention";
      const compensationRefs: string[] = [];
      for (let index = 0; index < 32; index += 1) {
        const operation = createProductionRuntimeOperationContext({
          operationId: `round7-pending-${index.toString().padStart(2, "0")}`,
          operationType: "audio-remediation-test",
          authorityGeneration: initialRuntimeAuthorityGeneration,
          storageContext,
        });
        await runWithProductionRuntimeOperationContext(operation, () => {
          const saved = AudioStorage.saveAudio({
            projectSlug: slug,
            fileName: `pending-${index.toString().padStart(2, "0")}.wav`,
            data: wav(),
          });
          const compensationRef = AudioStorage.getCompensationRef(saved);
          assert(compensationRef);
          compensationRefs.push(compensationRef);
        });
      }
      const overflowOperation = createProductionRuntimeOperationContext({
        operationId: "round7-pending-overflow",
        operationType: "audio-remediation-test",
        authorityGeneration: initialRuntimeAuthorityGeneration,
        storageContext,
      });
      await runWithProductionRuntimeOperationContext(overflowOperation, () => {
        assert.throws(() => AudioStorage.saveAudio({
          projectSlug: slug,
          fileName: "pending-overflow.wav",
          data: wav(),
        }));
      });
      const compensationRoot = path.join(
        storageContext.projectsRoot,
        slug,
        "production-execution",
        "audio-compensation-cleanup",
      );
      const retained = fs.readdirSync(compensationRoot).sort();
      assert.equal(retained.length, 32);
      assert(compensationRefs.every((ref) => retained.includes(ref)));
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  });
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

void run().then(() => {
  console.log(`Sprint 129.27 audio remediation smoke: PASS (${scenarios} scenarios)`);
  emitSmokeResult("sprint-129-27-audio-remediation", scenarios);
});
