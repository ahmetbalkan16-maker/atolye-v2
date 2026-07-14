import fs from "node:fs";
import path from "node:path";
import { AIRouter, type ProviderName } from "@/lib/ai/router/AIRouter";
import { aiProviderConfig } from "@/lib/ai/AIProviderConfig";
import { ImageProviderRouter } from "@/lib/assets/providers/ImageProviderRouter";
import { requireContainedStorageFile } from "@/lib/assets/storage/StoragePathSecurity";
import { ImageStorage } from "@/lib/assets/storage/ImageStorage";
import { AudioStorage } from "@/lib/assets/storage/AudioStorage";
import { VideoStorage } from "@/lib/assets/storage/VideoStorage";
import { ThumbnailStorage } from "@/lib/thumbnail/ThumbnailStorage";
import { FileStorage } from "@/lib/storage/FileStorage";
import {
  getOpenAIImageProviderConfig,
  resolveImageProviderName,
} from "@/lib/assets/providers/ImageProviderConfig";
import { AudioProviderRouter } from "@/lib/audio/providers/AudioProviderRouter";
import {
  getOpenAIAudioProviderConfig,
  resolveAudioProviderName,
} from "@/lib/audio/providers/AudioProviderConfig";
import {
  getOpenAIAnimationProviderConfig,
  resolveAnimationProviderName,
} from "@/lib/animation/providers/AnimationProviderConfig";
import { AnimationProviderRouter } from "@/lib/animation/providers/AnimationProviderRouter";
import { VideoProviderRouter } from "@/lib/video/providers/VideoProviderRouter";
import {
  getFFmpegSceneVideoConfig,
  resolveVideoProviderName,
} from "@/lib/video/providers/VideoProviderConfig";
import { VideoAssemblyProviderRouter } from "@/lib/assembly/providers/VideoAssemblyProviderRouter";
import {
  getFFmpegVideoAssemblyConfig,
  resolveVideoAssemblyProviderName,
} from "@/lib/assembly/providers/VideoAssemblyProviderConfig";
import { ThumbnailProviderRouter } from "@/lib/thumbnail/ThumbnailProviderRouter";
import { resolveThumbnailProviderName } from "@/lib/thumbnail/ThumbnailProviderConfig";
import { YouTubeProviderRouter } from "@/lib/youtube/YouTubeProviderRouter";
import {
  resolveYouTubeProviderName,
  youtubeProviderConfig,
} from "@/lib/youtube/YouTubeProviderConfig";
import {
  SpawnRunner,
  type VideoAssemblyProcessRunner,
} from "@/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import { getProductionRuntimeStatus } from "@/lib/runtime/ProductionRuntimeCompositionRoot";
import type { ProductionRuntimeStatus } from "@/types/productionRuntimeStatus";
import {
  productionReadinessSchemaVersion,
  productionReadinessCheckIds,
  type ProductionReadinessCheck,
  type ProductionReadinessCheckId,
  type ProductionReadinessReport,
  type ProductionReadinessStatus,
} from "@/types/productionReadiness";

const PROBE_PREFIX = "sprint-126-readiness-";
const SENTINEL_FILE = ".atolye-readiness-sentinel";
const SENTINEL_VALUE = "atolye-production-readiness-v1";
const PROCESS_TIMEOUT_MS = 10_000;
const PROCESS_OUTPUT_LIMIT = 1024 * 1024;

export interface ProductionReadinessDependencies {
  readonly cwd?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly processRunner?: VideoAssemblyProcessRunner;
  readonly runtimeStatus?: () => ProductionRuntimeStatus;
  readonly now?: () => string;
  readonly beforeProbeCleanup?: (probeRoot: string) => void;
}

export class ProductionReadinessService {
  private readonly cwd: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly runner: VideoAssemblyProcessRunner;
  private readonly runtimeStatus: () => ProductionRuntimeStatus;
  private readonly now: () => string;
  private readonly beforeProbeCleanup?: (probeRoot: string) => void;

  constructor(dependencies: ProductionReadinessDependencies = {}) {
    this.cwd = path.resolve(dependencies.cwd ?? process.cwd());
    this.environment = dependencies.environment ?? process.env;
    this.runner = dependencies.processRunner ?? new SpawnRunner();
    this.runtimeStatus = dependencies.runtimeStatus ?? getProductionRuntimeStatus;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.beforeProbeCleanup = dependencies.beforeProbeCleanup;
  }

  async evaluate(): Promise<ProductionReadinessReport> {
    const checks: ProductionReadinessCheck[] = [];
    const providerChecks = this.providerChecks();
    checks.push(...providerChecks);
    checks.push(this.environmentCheck(providerChecks));
    checks.push(this.apiKeyCheck());
    checks.push(this.modelConfigurationCheck());
    checks.push(this.providerSelectionCheck(providerChecks));
    checks.push(this.providerEndpointCheck(providerChecks));
    checks.push(...this.runtimeChecks());

    let workspace: ProbeWorkspace | undefined;
    try {
      workspace = createProbeWorkspace(this.cwd);
      checks.push(...probeStorage(workspace));
      checks.push(...await this.probeMedia(workspace));
    } catch {
      checks.push(...missingProbeChecks(checks));
      if (!checks.some((item) => item.id === "ffmpeg" || item.id === "ffprobe")) {
        checks.push(...mediaChecksWithoutWorkspace(this.environment));
      }
    } finally {
      if (workspace) {
        try {
          this.beforeProbeCleanup?.(workspace.root);
          removeProbeWorkspace(workspace);
        } catch {
          replaceCheck(checks, check("filesystem-permission", "UNAVAILABLE", "PROBE_CLEANUP_FAILED"));
        }
      }
    }

    const validCheckSet = validateProductionReadinessChecks(checks);
    const ordered = normalizeChecks(checks, validCheckSet);
    return Object.freeze({
      schemaVersion: productionReadinessSchemaVersion,
      generatedAt: safeTimestamp(this.now),
      ready: validCheckSet && ordered.every((item) => !item.critical || item.status === "READY"),
      checks: Object.freeze(ordered),
    });
  }

  private providerChecks(): ProductionReadinessCheck[] {
    return [
      providerCheck("image-provider", this.environment.IMAGE_PROVIDER, "openai", () =>
        ImageProviderRouter.getProvider(resolveImageProviderName(this.environment.IMAGE_PROVIDER))),
      providerCheck("audio-provider", this.environment.AUDIO_PROVIDER, "openai", () =>
        AudioProviderRouter.getProvider(resolveAudioProviderName(this.environment.AUDIO_PROVIDER))),
      animationProviderCheck(this.environment),
      providerCheck("video-provider", this.environment.VIDEO_PROVIDER, "ffmpeg", () =>
        VideoProviderRouter.getProvider(resolveVideoProviderName(this.environment.VIDEO_PROVIDER))),
      providerCheck("assembly-provider", this.environment.VIDEO_ASSEMBLY_PROVIDER, "ffmpeg", () =>
        VideoAssemblyProviderRouter.getProvider(resolveVideoAssemblyProviderName(this.environment.VIDEO_ASSEMBLY_PROVIDER))),
      providerCheck("thumbnail-provider", this.environment.THUMBNAIL_PROVIDER, "openai", () =>
        new ThumbnailProviderRouter().getProvider(resolveThumbnailProviderName(this.environment.THUMBNAIL_PROVIDER))),
      providerCheck("publish-package-provider", this.environment.YOUTUBE_PROVIDER, "openai", () =>
        new YouTubeProviderRouter().getProvider(resolveYouTubeProviderName(this.environment.YOUTUBE_PROVIDER))),
      check("publish-provider", "READY", "PUBLISH_PACKAGE_ONLY_ENFORCED"),
    ];
  }

  private environmentCheck(providerChecks: readonly ProductionReadinessCheck[]) {
    const required = ["AI_PROVIDER", "IMAGE_PROVIDER", "AUDIO_PROVIDER", "ANIMATION_PROVIDER", "VIDEO_PROVIDER", "VIDEO_ASSEMBLY_PROVIDER", "THUMBNAIL_PROVIDER", "YOUTUBE_PROVIDER", "ATOLYE_DURABLE_PIPELINE_EXECUTION"];
    if (required.some((name) => !readValue(this.environment[name]))) {
      return check("environment", "NOT_CONFIGURED", "REQUIRED_ENVIRONMENT_MISSING");
    }
    if (providerChecks.some((item) => item.status === "INVALID")) {
      return check("environment", "INVALID", "ENVIRONMENT_VALUE_INVALID");
    }
    return check("environment", "READY", "ENVIRONMENT_CONFIGURED");
  }

  private apiKeyCheck() {
    return readValue(this.environment.OPENAI_API_KEY)
      ? check("api-key", "READY", "API_KEY_CONFIGURED")
      : check("api-key", "NOT_CONFIGURED", "API_KEY_MISSING");
  }

  private modelConfigurationCheck() {
    try {
      const provider = normalize(this.environment.AI_PROVIDER);
      if (provider !== "openai") {
        return check(
          "model-configuration",
          provider === "mock" ? "BLOCKED" : provider ? "INVALID" : "NOT_CONFIGURED",
          provider === "mock" ? "AI_MODEL_MOCK_BLOCKED" : provider ? "AI_MODEL_PROVIDER_INVALID" : "AI_MODEL_NOT_CONFIGURED",
        );
      }
      const model = readValue(this.environment.OPENAI_MODEL) ?? aiProviderConfig.openai.model;
      if (!safeConfig(model)) return check("model-configuration", "INVALID", "AI_MODEL_INVALID");
      if (
        aiProviderConfig.provider !== "openai" ||
        aiProviderConfig.openai.model !== model
      ) {
        return check("model-configuration", "INVALID", "AI_CONFIG_SNAPSHOT_MISMATCH");
      }
      if (!validInteger(this.environment.OPENAI_MAX_TOKENS, 1, 100_000)) {
        return check("model-configuration", "INVALID", "AI_MAX_TOKENS_INVALID");
      }
      if (!validNumber(this.environment.OPENAI_TEMPERATURE, 0, 2)) {
        return check("model-configuration", "INVALID", "AI_TEMPERATURE_INVALID");
      }
      const expectedMaxTokens = Number(this.environment.OPENAI_MAX_TOKENS ?? "1200");
      const expectedTemperature = Number(this.environment.OPENAI_TEMPERATURE ?? "0.4");
      if (
        aiProviderConfig.openai.maxTokens !== expectedMaxTokens ||
        aiProviderConfig.openai.temperature !== expectedTemperature
      ) {
        return check("model-configuration", "INVALID", "AI_CONFIG_SNAPSHOT_MISMATCH");
      }
      getOpenAIAudioProviderConfig();
      getOpenAIImageProviderConfig(this.environment);
      const expectedYouTubeModel = readValue(this.environment.YOUTUBE_OPENAI_MODEL) ?? "gpt-4.1-mini";
      if (
        !safeConfig(youtubeProviderConfig.openai.model) ||
        youtubeProviderConfig.openai.model !== expectedYouTubeModel
      ) {
        return check("model-configuration", "INVALID", "PUBLISH_MODEL_INVALID");
      }
      if (normalize(this.environment.ANIMATION_PROVIDER) === "openai") {
        const animationModel = readValue(this.environment.ANIMATION_OPENAI_MODEL);
        if (!animationModel) {
          return check("model-configuration", "NOT_CONFIGURED", "ANIMATION_MODEL_NOT_CONFIGURED");
        }
        if (!safeConfig(animationModel)) {
          return check("model-configuration", "INVALID", "ANIMATION_MODEL_INVALID");
        }
      }
      return check("model-configuration", "READY", "MODELS_CONFIGURED");
    } catch {
      return check("model-configuration", "INVALID", "MODEL_CONFIGURATION_INVALID");
    }
  }

  private providerSelectionCheck(providerChecks: readonly ProductionReadinessCheck[]) {
    const ai = normalize(this.environment.AI_PROVIDER);
    if (!ai) return check("provider-selection", "NOT_CONFIGURED", "AI_PROVIDER_MISSING");
    if (ai === "mock") return check("provider-selection", "BLOCKED", "AI_PROVIDER_MOCK_BLOCKED");
    if (ai !== "openai") return check("provider-selection", "INVALID", "AI_PROVIDER_INVALID");
    if (aiProviderConfig.provider !== ai) {
      return check("provider-selection", "INVALID", "AI_PROVIDER_SNAPSHOT_MISMATCH");
    }
    try {
      new AIRouter().getProvider(ai as ProviderName);
    } catch {
      return check("provider-selection", "INVALID", "AI_ROUTER_INVALID");
    }
    if (providerChecks.some((item) => item.status === "INVALID")) return check("provider-selection", "INVALID", "PROVIDER_SELECTION_INVALID");
    if (providerChecks.some((item) => item.status === "NOT_CONFIGURED")) return check("provider-selection", "NOT_CONFIGURED", "PROVIDER_SELECTION_NOT_CONFIGURED");
    if (providerChecks.some((item) => item.status !== "READY")) return check("provider-selection", "BLOCKED", "PROVIDER_SELECTION_BLOCKED");
    return check("provider-selection", "READY", "PROVIDERS_SELECTED");
  }

  private providerEndpointCheck(providerChecks: readonly ProductionReadinessCheck[]) {
    const endpointProviders = providerChecks.filter((item) =>
      item.id === "image-provider" || item.id === "audio-provider" || item.id === "animation-provider" || item.id === "thumbnail-provider" || item.id === "publish-package-provider");
    if (endpointProviders.some((item) => item.status === "INVALID")) {
      return check("provider-endpoint", "INVALID", "PROVIDER_ENDPOINT_SELECTION_INVALID");
    }
    if (endpointProviders.some((item) => item.status === "BLOCKED")) {
      return check("provider-endpoint", "BLOCKED", "PROVIDER_ENDPOINT_BLOCKED");
    }
    if (endpointProviders.some((item) => item.status !== "READY")) {
      return check("provider-endpoint", "NOT_CONFIGURED", "PROVIDER_ENDPOINT_NOT_CONFIGURED");
    }
    return check("provider-endpoint", "READY", "PROVIDER_ENDPOINTS_FIXED");
  }

  private runtimeChecks(): ProductionReadinessCheck[] {
    try {
      const status = this.runtimeStatus();
      const runtimeReady = status.initialized && status.workerReady && status.acceptingExecutions && status.lifecycleState === "ready";
      const durableConfigured = this.environment.ATOLYE_DURABLE_PIPELINE_EXECUTION === "enabled";
      const durableReady = status.initialized && status.recoveryCompleted && durableConfigured;
      return [
        check("runtime", runtimeReady ? "READY" : "BLOCKED", runtimeReady ? "RUNTIME_ACCEPTING_EXECUTIONS" : "RUNTIME_NOT_ACCEPTING_EXECUTIONS"),
        check("durable-execution", durableReady ? "READY" : "BLOCKED", durableReady ? "DURABLE_EXECUTION_READY" : durableConfigured ? "RECOVERY_NOT_COMPLETED" : "DURABLE_EXECUTION_NOT_CONFIGURED"),
        check("health", runtimeReady && !status.draining ? "READY" : "BLOCKED", runtimeReady && !status.draining ? "RUNTIME_HEALTHY" : "RUNTIME_HEALTH_BLOCKED"),
      ];
    } catch {
      return [
        check("runtime", "UNAVAILABLE", "RUNTIME_STATUS_UNAVAILABLE"),
        check("durable-execution", "UNAVAILABLE", "DURABLE_STATUS_UNAVAILABLE"),
        check("health", "UNAVAILABLE", "HEALTH_STATUS_UNAVAILABLE"),
      ];
    }
  }

  private async probeMedia(workspace: ProbeWorkspace): Promise<ProductionReadinessCheck[]> {
    let config: ReturnType<typeof getFFmpegVideoAssemblyConfig>;
    try {
      const videoProvider = normalize(this.environment.VIDEO_PROVIDER);
      const assemblyProvider = normalize(this.environment.VIDEO_ASSEMBLY_PROVIDER);
      if (videoProvider !== "ffmpeg" || assemblyProvider !== "ffmpeg") {
        const status: ProductionReadinessStatus =
          !videoProvider || !assemblyProvider
            ? "NOT_CONFIGURED"
            : videoProvider === "mock" || assemblyProvider === "mock"
              ? "BLOCKED"
              : "INVALID";
        return [
          check("ffmpeg", status, status === "BLOCKED" ? "FFMPEG_PROVIDER_BLOCKED" : status === "INVALID" ? "FFMPEG_PROVIDER_INVALID" : "FFMPEG_PROVIDER_NOT_CONFIGURED"),
          check("ffprobe", status, status === "BLOCKED" ? "FFPROBE_PROVIDER_BLOCKED" : status === "INVALID" ? "FFPROBE_PROVIDER_INVALID" : "FFPROBE_PROVIDER_NOT_CONFIGURED"),
        ];
      }
      config = this.environment === process.env
        ? resolveCurrentProcessFFmpegConfig()
        : resolveFFmpegConfig(this.environment);
      if (!isExecutableFile(config.ffmpegPath) || !isExecutableFile(config.ffprobePath)) {
        return [
          check("ffmpeg", "UNAVAILABLE", "FFMPEG_EXECUTABLE_UNAVAILABLE"),
          check("ffprobe", "UNAVAILABLE", "FFPROBE_EXECUTABLE_UNAVAILABLE"),
        ];
      }
    } catch {
      const ffmpegMissing = !readValue(this.environment.FFMPEG_PATH);
      const ffprobeMissing = !readValue(this.environment.FFPROBE_PATH);
      if (ffmpegMissing || ffprobeMissing) return [
        check("ffmpeg", ffmpegMissing ? "NOT_CONFIGURED" : "BLOCKED", ffmpegMissing ? "FFMPEG_PATH_MISSING" : "FFMPEG_BLOCKED_BY_FFPROBE_CONFIGURATION"),
        check("ffprobe", ffprobeMissing ? "NOT_CONFIGURED" : "BLOCKED", ffprobeMissing ? "FFPROBE_PATH_MISSING" : "FFPROBE_BLOCKED_BY_FFMPEG_CONFIGURATION"),
      ];
      return [
        check("ffmpeg", "INVALID", "FFMPEG_CONFIGURATION_INVALID"),
        check("ffprobe", "INVALID", "FFPROBE_CONFIGURATION_INVALID"),
      ];
    }

    const version = await safeRun(this.runner, config.ffmpegPath, ["-version"]);
    if (!successful(version)) return [
      check("ffmpeg", "UNAVAILABLE", version?.timedOut ? "FFMPEG_VERSION_TIMEOUT" : "FFMPEG_VERSION_FAILED"),
      check("ffprobe", "BLOCKED", "FFPROBE_BLOCKED_BY_FFMPEG"),
    ];
    if (!version!.stdout.toLowerCase().includes("ffmpeg version")) return [
      check("ffmpeg", "INVALID", "FFMPEG_VERSION_INVALID"),
      check("ffprobe", "BLOCKED", "FFPROBE_BLOCKED_BY_FFMPEG"),
    ];
    const probeVersion = await safeRun(this.runner, config.ffprobePath, ["-version"]);
    if (!successful(probeVersion)) return [
      check("ffmpeg", "BLOCKED", "FFMPEG_PROBE_VALIDATION_BLOCKED"),
      check("ffprobe", "UNAVAILABLE", probeVersion?.timedOut ? "FFPROBE_VERSION_TIMEOUT" : "FFPROBE_VERSION_FAILED"),
    ];
    if (!probeVersion!.stdout.toLowerCase().includes("ffprobe version")) return [
      check("ffmpeg", "BLOCKED", "FFMPEG_PROBE_VALIDATION_BLOCKED"),
      check("ffprobe", "INVALID", "FFPROBE_VERSION_INVALID"),
    ];

    const output = path.join(workspace.mediaRoot, "readiness.mp4");
    const encode = await safeRun(this.runner, config.ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=320x180:d=1",
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest", "-c:v", "libx264",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-y", output,
    ]);
    if (!successful(encode) || !fs.existsSync(output)) return [
      check("ffmpeg", "UNAVAILABLE", encode?.timedOut ? "FFMPEG_ENCODE_TIMEOUT" : "FFMPEG_ENCODE_FAILED"),
      check("ffprobe", "BLOCKED", "FFPROBE_BLOCKED_BY_ENCODE"),
    ];
    const probe = await safeRun(this.runner, config.ffprobePath, [
      "-v", "error", "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height",
      "-of", "json", output,
    ]);
    if (!successful(probe)) return [
      check("ffmpeg", "READY", "FFMPEG_ENCODE_READY"),
      check("ffprobe", "UNAVAILABLE", probe?.timedOut ? "FFPROBE_MEDIA_TIMEOUT" : "FFPROBE_MEDIA_FAILED"),
    ];
    return validProbe(probe!.stdout)
      ? [check("ffmpeg", "READY", "FFMPEG_ENCODE_READY"), check("ffprobe", "READY", "FFPROBE_MEDIA_READY")]
      : [check("ffmpeg", "READY", "FFMPEG_ENCODE_READY"), check("ffprobe", "INVALID", "FFPROBE_MEDIA_INVALID")];
  }
}

interface ProbeWorkspace { projectsRoot: string; root: string; mediaRoot: string; roots: Record<"images-storage" | "audio-storage" | "video-storage" | "thumbnail-storage" | "assembly-storage", string>; }

function createProbeWorkspace(cwd: string): ProbeWorkspace {
  const projectsRoot = path.join(cwd, "data", "projects");
  if (!fs.existsSync(projectsRoot) || !fs.statSync(projectsRoot).isDirectory() || fs.lstatSync(projectsRoot).isSymbolicLink()) throw new Error("unavailable");
  const realCwd = fs.realpathSync(cwd);
  const realProjects = fs.realpathSync(projectsRoot);
  if (!isInside(realCwd, realProjects)) throw new Error("invalid");
  const root = path.join(realProjects, `${PROBE_PREFIX}${crypto.randomUUID()}`);
  fs.mkdirSync(root, { recursive: false });
  const sentinel = path.join(root, SENTINEL_FILE);
  try {
    fs.writeFileSync(sentinel, SENTINEL_VALUE, { encoding: "utf8", flag: "wx" });
    const assets = path.join(root, "assets");
    const roots = {
      "images-storage": path.join(assets, "images"),
      "audio-storage": path.join(assets, "audio"),
      "video-storage": path.join(assets, "videos"),
      "thumbnail-storage": path.join(assets, "thumbnails"),
      "assembly-storage": path.join(assets, "assembly"),
    } as const;
    Object.values(roots).forEach((directory) => fs.mkdirSync(directory, { recursive: true }));
    const mediaRoot = path.join(root, "media-probe");
    fs.mkdirSync(mediaRoot);
    return { projectsRoot: realProjects, root, mediaRoot, roots };
  } catch {
    try {
      if (fs.readFileSync(sentinel, "utf8") === SENTINEL_VALUE) {
        removeSafeProbeRoot(realProjects, root);
      }
    } catch {
      // A missing or invalid sentinel deliberately prevents cleanup.
    }
    throw new Error("unavailable");
  }
}

function probeStorage(workspace: ProbeWorkspace): ProductionReadinessCheck[] {
  const checks: ProductionReadinessCheck[] = [
    check("projects-root", "READY", "PROJECTS_ROOT_READY"),
    check("assets-root", "READY", "ASSETS_ROOT_READY"),
  ];
  for (const [id, directory] of Object.entries(workspace.roots) as Array<[keyof ProbeWorkspace["roots"], string]>) {
    try {
      if (!isInside(workspace.root, fs.realpathSync(directory))) throw new Error("invalid");
      const file = path.join(directory, "probe.bin");
      const bytes = Buffer.from("atolye-readiness");
      fs.writeFileSync(file, bytes, { flag: "wx" });
      if (!fs.readFileSync(file).equals(bytes)) throw new Error("invalid");
      requireContainedStorageFile(directory, file);
      checks.push(check(id, "READY", `${id.replace(/-/g, "_").toUpperCase()}_READY`));
    } catch {
      checks.push(check(id, "UNAVAILABLE", `${id.replace(/-/g, "_").toUpperCase()}_UNAVAILABLE`));
    }
  }
  const adapterResults = probeStorageAdapters(workspace);
  for (const [id, ready] of Object.entries(adapterResults) as Array<[keyof ProbeWorkspace["roots"], boolean]>) {
    if (!ready) replaceCheck(checks, check(id, "UNAVAILABLE", `${id.replace(/-/g, "_").toUpperCase()}_ADAPTER_UNAVAILABLE`));
  }
  const storageReady = checks.slice(2).every((item) => item.status === "READY");
  checks.push(check("filesystem-permission", storageReady ? "READY" : "UNAVAILABLE", storageReady ? "FILESYSTEM_READ_WRITE_READY" : "FILESYSTEM_READ_WRITE_FAILED"));
  let containmentReady = false;
  try {
    requireContainedStorageFile(workspace.roots["images-storage"], path.join(workspace.root, SENTINEL_FILE));
  } catch {
    containmentReady = true;
  }
  checks.push(check("storage-containment", containmentReady ? "READY" : "INVALID", containmentReady ? "STORAGE_CONTAINMENT_READY" : "STORAGE_CONTAINMENT_INVALID"));
  return checks;
}

function probeStorageAdapters(workspace: ProbeWorkspace): Record<keyof ProbeWorkspace["roots"], boolean> {
  const projectSlug = path.basename(workspace.root);
  const results: Record<keyof ProbeWorkspace["roots"], boolean> = {
    "images-storage": false,
    "audio-storage": false,
    "video-storage": false,
    "thumbnail-storage": false,
    "assembly-storage": false,
  };
  try {
    const saved = ImageStorage.saveImage({ projectSlug, assetId: "readiness-image", data: readinessPng(), mimeType: "image/png" });
    ImageStorage.inspectStoredImage(projectSlug, saved.filePath, "image/png");
    results["images-storage"] = true;
  } catch { /* reported by the caller */ }
  try {
    const saved = AudioStorage.saveAudio({ projectSlug, assetId: "readiness-audio", data: readinessWav() });
    AudioStorage.inspectStoredWav(projectSlug, saved.filePath);
    results["audio-storage"] = true;
  } catch { /* reported by the caller */ }
  try {
    const paths = VideoStorage.createRenderPaths(projectSlug);
    fs.writeFileSync(paths.temporaryAbsolutePath, Buffer.from("readiness-video-storage"), { flag: "wx" });
    VideoStorage.finalize(paths.temporaryAbsolutePath, paths.absolutePath);
    requireContainedStorageFile(workspace.roots["video-storage"], paths.absolutePath);
    results["video-storage"] = true;
  } catch { /* reported by the caller */ }
  try {
    const saved = ThumbnailStorage.saveThumbnail({ projectSlug, assetId: "readiness-thumbnail", data: readinessPng(), mimeType: "image/png" });
    ThumbnailStorage.inspectStoredThumbnail(projectSlug, saved.filePath, "image/png");
    results["thumbnail-storage"] = true;
  } catch { /* reported by the caller */ }
  try {
    const relativePath = `data/projects/${projectSlug}/assets/assembly/readiness.json`;
    FileStorage.saveJsonAtomically(relativePath, { sentinel: SENTINEL_VALUE });
    const stored = FileStorage.loadJson<{ sentinel?: unknown }>(relativePath);
    results["assembly-storage"] = stored?.sentinel === SENTINEL_VALUE;
  } catch { /* reported by the caller */ }
  return results;
}

function readinessPng() {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
}

function readinessWav() {
  const samples = 800;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8_000, 24);
  buffer.writeUInt32LE(16_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

function removeProbeWorkspace(workspace: ProbeWorkspace) {
  removeSafeProbeRoot(workspace.projectsRoot, workspace.root);
}

function removeSafeProbeRoot(projectsRoot: string, root: string) {
  requireSafeProbeRoot(projectsRoot, root);
  const cleanupRoot = `${root}.cleanup-${crypto.randomUUID()}`;
  fs.renameSync(root, cleanupRoot);
  requireSafeProbeRoot(projectsRoot, cleanupRoot);
  fs.rmSync(cleanupRoot, { recursive: true, force: false });
}

function requireSafeProbeRoot(projectsRoot: string, root: string) {
  const projectsLink = fs.lstatSync(projectsRoot);
  const rootLink = fs.lstatSync(root);
  if (
    projectsLink.isSymbolicLink() || !projectsLink.isDirectory() ||
    rootLink.isSymbolicLink() || !rootLink.isDirectory() ||
    !path.basename(root).startsWith(PROBE_PREFIX)
  ) throw new Error("unsafe cleanup");
  const realProjects = fs.realpathSync(projectsRoot);
  const realRoot = fs.realpathSync(root);
  if (
    comparablePath(realProjects) !== comparablePath(projectsRoot) ||
    !isInside(realProjects, realRoot) ||
    comparablePath(realRoot) !== comparablePath(root)
  ) throw new Error("unsafe cleanup");
  const sentinel = path.join(realRoot, SENTINEL_FILE);
  const sentinelLink = fs.lstatSync(sentinel);
  if (
    sentinelLink.isSymbolicLink() || !sentinelLink.isFile() ||
    fs.readFileSync(sentinel, "utf8") !== SENTINEL_VALUE
  ) throw new Error("unsafe cleanup");
}

function missingProbeChecks(existing: readonly ProductionReadinessCheck[]) {
  const ids: ProductionReadinessCheckId[] = ["projects-root", "assets-root", "images-storage", "audio-storage", "video-storage", "thumbnail-storage", "assembly-storage", "filesystem-permission", "storage-containment"];
  return ids.filter((id) => !existing.some((item) => item.id === id)).map((id) => check(id, "UNAVAILABLE", `${id.replace(/-/g, "_").toUpperCase()}_UNAVAILABLE`));
}

function mediaChecksWithoutWorkspace(environment: NodeJS.ProcessEnv): ProductionReadinessCheck[] {
  const videoProvider = normalize(environment.VIDEO_PROVIDER);
  const assemblyProvider = normalize(environment.VIDEO_ASSEMBLY_PROVIDER);
  if (!videoProvider || !assemblyProvider) return [
    check("ffmpeg", "NOT_CONFIGURED", "FFMPEG_PROVIDER_NOT_CONFIGURED"),
    check("ffprobe", "NOT_CONFIGURED", "FFPROBE_PROVIDER_NOT_CONFIGURED"),
  ];
  if (videoProvider === "mock" || assemblyProvider === "mock") return [
    check("ffmpeg", "BLOCKED", "FFMPEG_PROVIDER_BLOCKED"),
    check("ffprobe", "BLOCKED", "FFPROBE_PROVIDER_BLOCKED"),
  ];
  if (videoProvider !== "ffmpeg" || assemblyProvider !== "ffmpeg") return [
    check("ffmpeg", "INVALID", "FFMPEG_PROVIDER_INVALID"),
    check("ffprobe", "INVALID", "FFPROBE_PROVIDER_INVALID"),
  ];
  return [
    check("ffmpeg", "BLOCKED", "FFMPEG_BLOCKED_BY_STORAGE"),
    check("ffprobe", "BLOCKED", "FFPROBE_BLOCKED_BY_STORAGE"),
  ];
}

function providerCheck(id: ProductionReadinessCheckId, raw: string | undefined, expected: string, create: () => { name: string }): ProductionReadinessCheck {
  const selected = normalize(raw);
  if (!selected) return check(id, "NOT_CONFIGURED", `${id.replace(/-/g, "_").toUpperCase()}_MISSING`);
  if (selected === "mock") return check(id, "BLOCKED", `${id.replace(/-/g, "_").toUpperCase()}_MOCK_BLOCKED`);
  if (selected !== expected) return check(id, "INVALID", `${id.replace(/-/g, "_").toUpperCase()}_INVALID`);
  try {
    return create().name === expected
      ? check(id, "READY", `${id.replace(/-/g, "_").toUpperCase()}_READY`)
      : check(id, "INVALID", `${id.replace(/-/g, "_").toUpperCase()}_ROUTER_INVALID`);
  } catch {
    return check(id, "INVALID", `${id.replace(/-/g, "_").toUpperCase()}_CONFIGURATION_INVALID`);
  }
}

function animationProviderCheck(environment: NodeJS.ProcessEnv): ProductionReadinessCheck {
  const raw = environment.ANIMATION_PROVIDER;
  if (!readValue(raw)) return check("animation-provider", "NOT_CONFIGURED", "ANIMATION_PROVIDER_MISSING");
  const selected = normalize(raw);
  if (selected === "mock") return check("animation-provider", "BLOCKED", "ANIMATION_PROVIDER_MOCK_ONLY");
  if (selected !== "openai") return check("animation-provider", "INVALID", "ANIMATION_PROVIDER_INVALID");
  if (!readValue(environment.OPENAI_API_KEY)) {
    return check("animation-provider", "NOT_CONFIGURED", "ANIMATION_PROVIDER_API_KEY_MISSING");
  }
  if (!readValue(environment.ANIMATION_OPENAI_MODEL)) {
    return check("animation-provider", "NOT_CONFIGURED", "ANIMATION_PROVIDER_MODEL_MISSING");
  }
  if (!readValue(environment.ANIMATION_OPENAI_ENDPOINT)) {
    return check("animation-provider", "NOT_CONFIGURED", "ANIMATION_PROVIDER_ENDPOINT_MISSING");
  }
  try {
    resolveAnimationProviderName(raw);
    getOpenAIAnimationProviderConfig(environment);
    return AnimationProviderRouter.getProvider("openai").name === "openai"
      ? check("animation-provider", "READY", "ANIMATION_PROVIDER_READY")
      : check("animation-provider", "INVALID", "ANIMATION_PROVIDER_ROUTER_INVALID");
  } catch {
    return check("animation-provider", "INVALID", "ANIMATION_PROVIDER_CONFIGURATION_INVALID");
  }
}

function check(id: ProductionReadinessCheckId, status: ProductionReadinessStatus, reasonCode: string): ProductionReadinessCheck {
  return Object.freeze({ id, status, reasonCode, critical: true });
}

function replaceCheck(checks: ProductionReadinessCheck[], replacement: ProductionReadinessCheck) {
  const index = checks.findIndex((item) => item.id === replacement.id);
  if (index >= 0) checks[index] = replacement; else checks.push(replacement);
}

function normalizeChecks(checks: readonly ProductionReadinessCheck[], valid: boolean) {
  const unique = new Map<ProductionReadinessCheckId, ProductionReadinessCheck>();
  for (const item of checks) {
    if (productionReadinessCheckIds.includes(item.id) && !unique.has(item.id)) {
      unique.set(item.id, item);
    }
  }
  for (const id of productionReadinessCheckIds) {
    if (!unique.has(id)) unique.set(id, check(id, "BLOCKED", "READINESS_CHECK_SET_INVALID"));
  }
  if (!valid) unique.set("environment", check("environment", "INVALID", "READINESS_CHECK_SET_INVALID"));
  return productionReadinessCheckIds.map((id) => unique.get(id)!);
}

export function validateProductionReadinessChecks(checks: readonly unknown[]): boolean {
  if (checks.length !== productionReadinessCheckIds.length) return false;
  const seen = new Set<string>();
  const statuses = new Set<ProductionReadinessStatus>(["READY", "NOT_CONFIGURED", "INVALID", "UNAVAILABLE", "BLOCKED"]);
  for (const value of checks) {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<ProductionReadinessCheck>;
    if (
      typeof item.id !== "string" ||
      !productionReadinessCheckIds.includes(item.id as ProductionReadinessCheckId) ||
      seen.has(item.id) ||
      typeof item.status !== "string" ||
      !statuses.has(item.status as ProductionReadinessStatus) ||
      typeof item.reasonCode !== "string" ||
      !/^[A-Z0-9_]+$/.test(item.reasonCode) ||
      item.critical !== true
    ) return false;
    seen.add(item.id);
  }
  return seen.size === productionReadinessCheckIds.length;
}

async function safeRun(runner: VideoAssemblyProcessRunner, executable: string, args: readonly string[]) {
  try { return await runner.run(executable, args, { timeoutMs: PROCESS_TIMEOUT_MS, maxOutputBytes: PROCESS_OUTPUT_LIMIT }); } catch { return undefined; }
}

function successful(result: Awaited<ReturnType<typeof safeRun>>) { return Boolean(result && result.exitCode === 0 && !result.failed && !result.timedOut); }
function isExecutableFile(value: string) { try { return fs.statSync(value).isFile(); } catch { return false; } }
function normalize(value: string | undefined) { return value?.trim().toLowerCase() ?? ""; }
function readValue(value: string | undefined) { const normalized = value?.trim(); return normalized || undefined; }
function safeConfig(value: string) { return /^[a-zA-Z0-9._:-]{1,200}$/.test(value); }
function validInteger(value: string | undefined, minimum: number, maximum: number) { if (value === undefined) return true; return /^[0-9]+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) && Number(value) >= minimum && Number(value) <= maximum; }
function validNumber(value: string | undefined, minimum: number, maximum: number) { if (value === undefined) return true; const normalized = value.trim(); if (!/^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(normalized)) return false; const parsed = Number(normalized); return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum; }
function isInside(directory: string, target: string) { const relative = path.relative(directory, target); return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative); }
function comparablePath(value: string) { const resolved = path.resolve(value); return process.platform === "win32" ? resolved.toLowerCase() : resolved; }
function safeTimestamp(now: () => string) { try { const value = now(); return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : new Date().toISOString(); } catch { return new Date().toISOString(); } }

function validProbe(stdout: string) {
  try {
    const value = JSON.parse(stdout) as { format?: { format_name?: unknown; duration?: unknown }; streams?: Array<{ codec_type?: unknown; codec_name?: unknown; width?: unknown; height?: unknown }> };
    const duration = Number(value.format?.duration);
    const formats = typeof value.format?.format_name === "string" ? value.format.format_name.split(",") : [];
    const video = value.streams?.find((stream) => stream.codec_type === "video");
    const audio = value.streams?.find((stream) => stream.codec_type === "audio");
    return formats.includes("mov") || formats.includes("mp4")
      ? duration >= 0.5 && duration <= 2 && video?.codec_name === "h264" && video.width === 320 && video.height === 180 && audio?.codec_name === "aac"
      : false;
  } catch { return false; }
}

function resolveCurrentProcessFFmpegConfig() {
  const scene = getFFmpegSceneVideoConfig();
  const assembly = getFFmpegVideoAssemblyConfig();
  if (scene.ffmpegPath !== assembly.ffmpegPath || scene.ffprobePath !== assembly.ffprobePath) throw new Error("invalid");
  return assembly;
}

function resolveFFmpegConfig(environment: NodeJS.ProcessEnv): ReturnType<typeof getFFmpegVideoAssemblyConfig> {
  const ffmpegPath = readValue(environment.FFMPEG_PATH);
  const ffprobePath = readValue(environment.FFPROBE_PATH);
  if (!ffmpegPath || !ffprobePath || !path.isAbsolute(ffmpegPath) || !path.isAbsolute(ffprobePath) || /[\0\r\n]/.test(ffmpegPath + ffprobePath)) throw new Error("invalid");
  const left = process.platform === "win32" ? path.resolve(ffmpegPath).toLowerCase() : path.resolve(ffmpegPath);
  const right = process.platform === "win32" ? path.resolve(ffprobePath).toLowerCase() : path.resolve(ffprobePath);
  if (left === right) throw new Error("invalid");
  return {
    ffmpegPath: path.normalize(ffmpegPath),
    ffprobePath: path.normalize(ffprobePath),
    timeoutMs: 15 * 60 * 1000,
    maxOutputBytes: 4 * 1024 * 1024 * 1024,
    maxStdioBytes: PROCESS_OUTPUT_LIMIT,
  };
}
