import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { resolveAiCostBudgetUsd, summarizeObservedCost } from "../../ai/AiCostBudget";
import { resolveAnimationProviderName } from "../../animation/providers/AnimationProviderConfig";
import { resolveImageProviderName } from "../../assets/providers/ImageProviderConfig";
import { PipelineJobManager } from "../../pipeline/PipelineJobManager";
import { pipelineStageDependencies } from "../../pipeline/PipelineRecoveryPlanner";
import { pipelineRetryMaxAttempts } from "../../pipeline/PipelineRetryAdmission";
import { resolveProductionProviderName, type ProductionProviderDomain } from "../../production/ProductionProviderResolution";
import { ProjectManager } from "../../projects/ProjectManager";
import { ProjectReader } from "../../projects/ProjectReader";
import { resolveRuntimeStorageContext, type RuntimeStorageContext, type RuntimeStorageInput } from "../../runtime/RuntimeStoragePaths";
import type { AIUsageRecord } from "../../../types/aiUsage";
import type { ProductionStepKey, ProjectManifest } from "../../../types/project";
import type { AyasCostClass } from "../policy/AyasZeroCostPolicy";
import { readAyasGit } from "../provenance/AyasBuildStamp";
import { directorTaskFromProjectArtifacts, type DirectorProjectArtifacts } from "./AyasDirectorProjectAdapter";
import { reviewAtolyeDirectorTask } from "./AyasDirectorReadiness";
import {
  AYAS_DIRECTOR_STAGES, buildAyasProductionDirectorSession,
  type AyasDirectorArtifactSummary, type AyasDirectorOwnerRequest, type AyasDirectorProvider, type AyasDirectorReviewFacts, type AyasDirectorSessionFacts,
  type AyasDirectorStageError, type AyasDirectorStageFact, type AyasProductionDirectorSession,
} from "./AyasProductionDirectorSession";

/**
 * Stage 15I — reads the facts a director session binds.
 *
 * Read-only. It reads one project's record, manifest, stage files, job list, usage log and asset registry through
 * the readers the pipeline already has, bound to an explicit storage context, and asks Git one question. It starts
 * no stage, calls no provider, probes no tool and writes nothing.
 *
 * The one thing it does on its own is the first safe class of the design: a read that fails transiently is read again,
 * at most twice.
 */
const HEAD = /^[a-f0-9]{40}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const READ_ATTEMPTS = 3;
const TRANSIENT_READ = new Set(["EBUSY", "EAGAIN", "EMFILE", "ENFILE", "EPERM"]);
const sha256 = (text: string) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

type ReadState<T> = { readonly status: "parsed"; readonly value: T } | { readonly status: "missing" } | { readonly status: "malformed" };

/** Which provider selection a stage runs on. A stage with two is as costly as its costlier one. */
const STAGE_PROVIDERS: Readonly<Record<ProductionStepKey, readonly string[]>> = Object.freeze({
  research: ["AI_PROVIDER"], script: ["AI_PROVIDER"], scenes: ["AI_PROVIDER"], visuals: ["IMAGE_PROVIDER"], animation: ["ANIMATION_PROVIDER"], video: ["VIDEO_PROVIDER"],
  audio: ["AUDIO_PROVIDER"], assembly: ["AI_PROVIDER", "VIDEO_ASSEMBLY_PROVIDER"], thumbnail: ["THUMBNAIL_PROVIDER"], seo: ["AI_PROVIDER"], youtube: ["YOUTUBE_PROVIDER"], export: [],
});
const PRODUCTION_DOMAIN: Readonly<Record<string, ProductionProviderDomain>> = Object.freeze({ AI_PROVIDER: "ai", AUDIO_PROVIDER: "audio", THUMBNAIL_PROVIDER: "thumbnail", YOUTUBE_PROVIDER: "youtube" });
/** The zero-cost provider the production path already recognises for a selection. */
const ZERO_COST_ALTERNATIVE: Readonly<Record<string, string>> = Object.freeze({ AI_PROVIDER: "ollama", AUDIO_PROVIDER: "piper", THUMBNAIL_PROVIDER: "local", YOUTUBE_PROVIDER: "ollama", ANIMATION_PROVIDER: "ollama", IMAGE_PROVIDER: "real" });
const COST_CLASS: Readonly<Record<string, AyasCostClass>> = Object.freeze({ ollama: "local-zero-cost", piper: "local-zero-cost", local: "local-zero-cost", ffmpeg: "local-zero-cost", mock: "local-zero-cost", real: "free-public", openai: "paid", openrouter: "paid" });

/**
 * The provider a production run uses for one selection, and what it costs. The four domains the production path
 * resolves itself are resolved by it (unset there means the paid default). A name this table does not know is
 * unknown-cost, which the zero-cost policy refuses.
 */
export function resolveAyasDirectorProvider(variable: string, env: NodeJS.ProcessEnv): AyasDirectorProvider {
  const domain = PRODUCTION_DOMAIN[variable];
  const raw = env[variable]?.trim().toLowerCase() || null;
  let provider: string | null;
  if (domain) provider = resolveProductionProviderName(domain, env);
  // The image and animation routers resolve their own selection; a name they refuse is not a provider.
  else if (variable === "IMAGE_PROVIDER") { try { provider = resolveImageProviderName(env.IMAGE_PROVIDER); } catch { provider = null; } }
  else if (variable === "ANIMATION_PROVIDER") { try { provider = resolveAnimationProviderName(env.ANIMATION_PROVIDER); } catch { provider = null; } }
  else provider = raw ?? "mock";
  return { variable, provider, costClass: provider === null ? "unknown-cost" : COST_CLASS[provider] ?? "unknown-cost" };
}

export interface AyasDirectorCollectOptions {
  readonly projectSlug: string;
  readonly now: Date;
  /** The repository whose HEAD identifies the code that runs the pipeline. */
  readonly repoRoot: string;
  readonly ownerRequest?: AyasDirectorOwnerRequest | null;
  readonly storage?: RuntimeStorageInput;
  readonly env?: NodeJS.ProcessEnv;
}
export interface AyasDirectorCollection {
  readonly facts: AyasDirectorSessionFacts;
  readonly session: AyasProductionDirectorSession;
  /** How many reads were repeated after a transient failure. */
  readonly readRetries: number;
}

/** A value from the owner is taken only in the shape the session binds; anything else is refused, never repaired. */
export function parseAyasDirectorOwnerRequest(value: unknown): AyasDirectorOwnerRequest {
  const request = value as Partial<AyasDirectorOwnerRequest> | null;
  const keys = ["requestId", "topic", "format", "targetDurationSeconds", "approvedProjectCapUsd"];
  if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).some((key) => !keys.includes(key)) ||
      typeof request.requestId !== "string" || !/^[A-Za-z0-9._:-]{1,80}$/.test(request.requestId) ||
      typeof request.topic !== "string" || request.topic.trim().length === 0 || request.topic.length > 300 ||
      !(request.format === undefined || request.format === null || request.format === "DOCUMENTARY" || request.format === "GENERAL") ||
      !(request.targetDurationSeconds === undefined || request.targetDurationSeconds === null || (Number.isSafeInteger(request.targetDurationSeconds) && request.targetDurationSeconds > 0 && request.targetDurationSeconds <= 6 * 3600)) ||
      !(request.approvedProjectCapUsd === undefined || request.approvedProjectCapUsd === null || (typeof request.approvedProjectCapUsd === "number" && Number.isFinite(request.approvedProjectCapUsd) && request.approvedProjectCapUsd >= 0 && request.approvedProjectCapUsd <= 1000))) {
    throw new Error("AYAS_DIRECTOR_OWNER_REQUEST_INVALID");
  }
  return { requestId: request.requestId, topic: request.topic.trim(), format: request.format ?? null, targetDurationSeconds: request.targetDurationSeconds ?? null, approvedProjectCapUsd: request.approvedProjectCapUsd ?? null };
}

function errorFacts(evidence: unknown, errorCode: unknown): AyasDirectorStageError | null {
  const record = evidence && typeof evidence === "object" && !Array.isArray(evidence) ? (evidence as Record<string, unknown>) : null;
  const text = (value: unknown) => (typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : null);
  const status = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null);
  if (!record) return text(errorCode) ? { kind: null, code: text(errorCode), rootCode: null, phase: null, httpStatus: null, providerErrorCode: null } : null;
  return { kind: text(record.kind), code: text(record.code) ?? text(errorCode), rootCode: text(record.rootCode), phase: text(record.phase), httpStatus: status(record.httpStatus) ?? status(record.providerHttpStatus), providerErrorCode: text(record.providerErrorCode) };
}

function summarize(state: ReadState<unknown>): AyasDirectorArtifactSummary {
  if (state.status !== "parsed") return { state: state.status === "missing" ? "MISSING" : "MALFORMED", digest: null, counts: {} };
  const counts: Record<string, number> = {};
  if (Array.isArray(state.value)) counts.items = state.value.length;
  else if (state.value && typeof state.value === "object") {
    // The size of each top-level list, by name: enough to see a plan grow or shrink without keeping its text.
    for (const key of Object.keys(state.value).sort()) { const item = (state.value as Record<string, unknown>)[key]; if (Array.isArray(item) && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(key) && Object.keys(counts).length < 12) counts[key] = item.length; }
  }
  return { state: "PRESENT", digest: sha256(JSON.stringify(state.value)), counts };
}

export async function collectAyasProductionDirectorSession(options: AyasDirectorCollectOptions): Promise<AyasDirectorCollection> {
  const slug = options.projectSlug;
  if (!SLUG.test(slug)) throw new Error("AYAS_DIRECTOR_PROJECT_SLUG_INVALID");
  const env = options.env ?? process.env;
  const context: RuntimeStorageContext = resolveRuntimeStorageContext(options.storage ?? {});
  let readRetries = 0;
  /** Reads again after a transient failure, at most twice. Anything else, and the third failure, is the caller's to handle. */
  const bounded = async <T>(read: () => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      try { return await read(); } catch (error) {
        if (attempt >= READ_ATTEMPTS || !TRANSIENT_READ.has(String((error as NodeJS.ErrnoException | null)?.code))) throw error;
        readRetries += 1;
      }
    }
  };
  /** A file that cannot be read after the bounded attempts is reported as unreadable, never as absent. */
  const readState = async (fileName: string): Promise<ReadState<unknown>> => {
    try { return (await bounded(() => ProjectReader.readJSONState<unknown>(slug, fileName, context))) as ReadState<unknown>; } catch { return { status: "malformed" }; }
  };

  let repositoryHead: string | null = null;
  try { const head = readAyasGit(options.repoRoot, ["rev-parse", "HEAD"]).trim(); repositoryHead = HEAD.test(head) ? head : null; } catch { repositoryHead = null; }

  const projectState = await readState("project.json");
  const projectRecord = projectState.status === "parsed" && projectState.value && typeof projectState.value === "object" && !Array.isArray(projectState.value) ? (projectState.value as Record<string, unknown>) : null;
  const project: AyasDirectorSessionFacts["project"] = {
    state: projectState.status === "missing" ? "MISSING" : projectRecord ? "PRESENT" : "MALFORMED", slug,
    id: typeof projectRecord?.id === "string" ? projectRecord.id : null, title: typeof projectRecord?.title === "string" ? projectRecord.title.slice(0, 300) : null, status: typeof projectRecord?.status === "string" ? projectRecord.status : null,
  };

  let manifest: ProjectManifest | null = null;
  if (project.state === "PRESENT") { try { manifest = await bounded(() => ProjectManager.getManifest(slug, context)); } catch { manifest = null; } }
  let jobs: Awaited<ReturnType<typeof PipelineJobManager.listJobsReadOnly>>["jobs"] = [];
  if (manifest) { try { jobs = (await bounded(() => PipelineJobManager.listJobsReadOnly(slug, context))).jobs; } catch { jobs = []; } }

  const parsed: Partial<Record<ProductionStepKey, unknown>> = {};
  const fileStates: Partial<Record<ProductionStepKey, ReadState<unknown>>> = {};
  const stages: AyasDirectorStageFact[] = [];
  if (manifest) {
    for (const stage of AYAS_DIRECTOR_STAGES) {
      const entry = manifest.packages[stage];
      if (!entry || typeof entry.fileName !== "string") continue;
      const state = await readState(entry.fileName);
      fileStates[stage] = state;
      if (state.status === "parsed") parsed[stage] = state.value;
      const job = jobs.filter((candidate) => candidate.stage === stage).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
      const providers = STAGE_PROVIDERS[stage].map((variable) => resolveAyasDirectorProvider(variable, env));
      const costly = providers.find((provider) => provider.costClass !== "local-zero-cost" && provider.costClass !== "free-public");
      const provider: AyasDirectorProvider | null = costly ?? providers[0] ?? { variable: "NONE", provider: "local", costClass: "local-zero-cost" };
      const attempts = typeof job?.attempts === "number" ? job.attempts : typeof entry.attempts?.total === "number" ? entry.attempts.total : null;
      stages.push({
        stage, status: ["pending", "running", "completed", "failed", "missing"].includes(entry.status) ? entry.status : "unknown",
        artifact: state.status === "parsed" ? "PRESENT" : state.status === "missing" ? "MISSING" : "MALFORMED",
        artifactDigest: state.status === "parsed" ? sha256(JSON.stringify(state.value)) : null,
        dependsOn: pipelineStageDependencies[stage], attempts, provider,
        zeroCostAlternative: costly && ZERO_COST_ALTERNATIVE[costly.variable] && ZERO_COST_ALTERNATIVE[costly.variable] !== costly.provider ? ZERO_COST_ALTERNATIVE[costly.variable]! : null,
        error: entry.status === "failed" ? errorFacts(job?.errorEvidence ?? entry.errorEvidence, undefined) : null,
      });
    }
  }

  let assetState: ReadState<unknown> = { status: "missing" };
  if (project.state === "PRESENT") {
    try {
      const file = path.join(ProjectReader.getProjectFolder(slug, context), "assets", "assets.json");
      const text = await bounded(() => fs.readFile(file, "utf8"));
      try { assetState = { status: "parsed", value: JSON.parse(text) as unknown }; } catch { assetState = { status: "malformed" }; }
    } catch (error) { assetState = (error as NodeJS.ErrnoException | null)?.code === "ENOENT" ? { status: "missing" } : { status: "malformed" }; }
  }

  let review: AyasDirectorSessionFacts["review"] = null;
  const format = options.ownerRequest?.format ?? null;
  if (format && projectRecord && parsed.scenes !== undefined) {
    try {
      const artifacts = { project: projectRecord, research: parsed.research ?? null, script: parsed.script ?? null, scenes: parsed.scenes ?? null, visuals: parsed.visuals ?? null, animation: parsed.animation ?? null, audio: parsed.audio ?? null, assets: assetState.status === "parsed" ? assetState.value : null } as unknown as DirectorProjectArtifacts;
      // The host's tools and the provider are not probed here: the review says so in its dependency state.
      const result = reviewAtolyeDirectorTask(directorTaskFromProjectArtifacts(artifacts, { format, host: { ffmpeg: "UNKNOWN", ffprobe: "UNKNOWN" }, provider: "UNKNOWN" }));
      const facts: AyasDirectorReviewFacts = {
        readiness: result.readiness, preAssemblyGate: result.preAssemblyGate, postAssemblyGate: result.postAssemblyGate,
        blockers: result.findings.filter((finding) => finding.severity === "BLOCKER").length, majors: result.findings.filter((finding) => finding.severity === "MAJOR").length,
        rightsBlocked: result.readiness === "RIGHTS_BLOCKED" || result.findings.some((finding) => finding.dimension === "RIGHTS_READINESS" && finding.severity === "BLOCKER"),
        findingCodes: [...new Set(result.findings.map((finding) => finding.code))].sort(),
      };
      review = facts;
    } catch { review = "UNREADABLE"; }
  }

  const usage = project.state === "PRESENT" ? await readState("ai-usage.json") : ({ status: "missing" } as const);
  const technicalCeilingUsd = resolveAiCostBudgetUsd(env);
  let cost: AyasDirectorSessionFacts["cost"] = { state: "ABSENT", knownUsd: 0, unknownPricingRecords: 0, technicalCeilingUsd };
  if (usage.status === "malformed") cost = { ...cost, state: "UNREADABLE" };
  else if (usage.status === "parsed") {
    const records = (usage.value as { records?: unknown } | null)?.records;
    if (!Array.isArray(records)) cost = { ...cost, state: "UNREADABLE" };
    else { const summary = summarizeObservedCost(records as readonly AIUsageRecord[]); cost = { state: "READ", knownUsd: summary.knownUsd, unknownPricingRecords: summary.unknownPricingRecordCount, technicalCeilingUsd }; }
  }

  const publish = project.state === "PRESENT" ? await readState("youtube-publish.json") : ({ status: "missing" } as const);
  const publishStatus = publish.status === "parsed" ? (publish.value as { status?: unknown } | null)?.status : null;
  const stageSummary = (stage: ProductionStepKey) => summarize(fileStates[stage] ?? { status: "missing" });
  const facts: AyasDirectorSessionFacts = {
    observedAt: options.now.toISOString(), ownerRequest: options.ownerRequest ?? null, repositoryHead, project, manifest: manifest ? "PRESENT" : "ABSENT", stages,
    factPack: stageSummary("research"), scenePlan: stageSummary("scenes"), assetManifest: summarize(assetState), audio: stageSummary("audio"), assembly: stageSummary("assembly"), review, cost,
    publication: { packageState: stageSummary("youtube").state, publishRecord: publish.status === "parsed" ? "PRESENT" : publish.status === "missing" ? "ABSENT" : "UNREADABLE", publishStatus: typeof publishStatus === "string" && /^[a-z-]{1,40}$/.test(publishStatus) ? publishStatus : null },
    retryMaxAttempts: pipelineRetryMaxAttempts,
  };
  return { facts, session: buildAyasProductionDirectorSession(facts), readRetries };
}
