/**
 * AYAS Production Project Catalog (Production Project Catalog + Resume
 * Awareness sprint).
 *
 * A **read-only** normalized view of the real Atölye production project
 * history, so AYAS can answer "kaç projem var?" / "yarım kalanlar hangileri?"
 * / "İstanbul'un Fethi ne durumda?" from fact, not invention.
 *
 * Sibling to `AyasStudioContext.ts` (which builds the prompt-injected studio
 * summary for the direct-stream path) — this module instead produces a
 * normalized, tool-dispatchable catalog for the reasoning/Action Runtime
 * path. Both share the SAME underlying primitives and must never diverge on
 * "which root is authoritative":
 *
 *  - `resolveRuntimeStorageContext({})` — the one authoritative resolver
 *    (`ATOLYE_RUNTIME_ROOT`, else the in-repo legacy default). Never a
 *    hard-coded path. Whatever this resolves to is read; nothing else is
 *    ever additionally consulted, so a legacy/authoritative double-count is
 *    structurally impossible — there is only ever one root per call.
 *  - `ProjectReader.listProjects()` / `.getProjectFolder()` — the existing,
 *    already id-or-slug-safe (`ProjectFolderIndex`) project storage reader.
 *    Reused, not reimplemented.
 *  - `PipelineRecoveryPlanner.createResumePlan()` — the existing, already
 *    read-only resume-stage computation (the SAME one `pipeline-recovery-plan`
 *    already dispatches). Reused for `resumable`/`resumeCandidateStage`
 *    rather than a second, competing notion of "what stage is next."
 *
 * Runs nothing, writes nothing, spawns nothing. A project whose `project.json`
 * is missing/corrupt is represented as a `status: "unknown"` catalog entry
 * (with an explicit `note`), never silently dropped and never guessed at.
 */

import fs from "node:fs";
import path from "node:path";

import { resolveRuntimeStorageContext, getProjectsRoot, type RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import { PipelineRecoveryPlanner } from "@/lib/pipeline/PipelineRecoveryPlanner";
import type { ProjectStatus } from "@/types/project";

export type AyasCatalogProjectStatus = ProjectStatus | "unknown";

export interface AyasProductionProjectSummary {
  readonly projectId: string;
  readonly title: string;
  readonly slug?: string;
  readonly status: AyasCatalogProjectStatus;
  /** The manifest's own next-incomplete-or-failed stage, when readable. */
  readonly currentStage?: string;
  readonly hasFinalVideo: boolean;
  /** Repository/runtime-relative, never an absolute filesystem path (never leaves the catalog boundary). */
  readonly finalVideoPath?: string;
  readonly sceneVideoCount: number;
  readonly audioAssetCount: number;
  readonly visualAssetCount: number;
  /** Derived ONLY from a real, successfully-read `PipelineRecoveryPlanner.createResumePlan()` result — never guessed. */
  readonly resumable: boolean;
  readonly resumeCandidateStage?: string;
  readonly updatedAt?: string;
  /** Present only for `status: "unknown"` / partially-unreadable entries — explains why, never hidden. */
  readonly note?: string;
}

export interface AyasProjectCatalogQuery {
  readonly status?: AyasCatalogProjectStatus;
  /** `"completed"` = exactly `status === "completed"`; `"incomplete"` = neither completed nor unknown — a computed grouping, not a literal `ProjectStatus` value, so it is a separate field from `status` rather than overloading it. */
  readonly completionState?: "completed" | "incomplete";
  readonly resumableOnly?: boolean;
  /** Case-insensitive substring match against `title` (and `slug`) — the only "find by name" mechanism; never a raw filesystem path. */
  readonly titleContains?: string;
  readonly projectId?: string;
}

export interface AyasProjectCatalogSummary {
  readonly totalProjects: number;
  readonly completedCount: number;
  readonly incompleteCount: number;
  readonly unknownCount: number;
  readonly statusDistribution: readonly { readonly status: string; readonly count: number }[];
  readonly resumableCount: number;
}

export interface AyasProjectCatalogView {
  readonly available: boolean;
  readonly runtimeClassification: RuntimeStorageContext["classification"] | "unavailable";
  readonly external: boolean;
  readonly projects: readonly AyasProductionProjectSummary[];
  readonly notes: readonly string[];
}

const ASSET_DIRS = { videos: "assets/videos", audio: "assets/audio", images: "assets/images" } as const;
const FINAL_VIDEO_RELATIVE = "export/bundle/video.mp4";
const SCENE_VIDEO_RE = /^scene-\d+-/i;

function countFiles(dir: string): number {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).length;
  } catch {
    return 0;
  }
}

function countSceneVideos(dir: string): number {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && SCENE_VIDEO_RE.test(e.name) && e.name.toLowerCase().endsWith(".mp4")).length;
  } catch {
    return 0;
  }
}

interface ProjectRecordLike {
  readonly id?: unknown;
  readonly slug?: unknown;
  readonly title?: unknown;
  readonly topic?: unknown;
  readonly status?: unknown;
  readonly updatedAt?: unknown;
  readonly createdAt?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set<AyasCatalogProjectStatus>([
  "draft", "research", "script", "scenes", "visuals", "animation", "video", "audio",
  "assembly", "thumbnail", "seo", "voice", "youtube", "export", "completed", "unknown",
]);
function normalizeStatus(value: unknown): AyasCatalogProjectStatus {
  const s = asString(value);
  return KNOWN_STATUSES.has(s) ? (s as AyasCatalogProjectStatus) : "unknown";
}

/** Builds one project's normalized summary. Pure read — never mutates anything. */
async function buildProjectSummary(record: ProjectRecordLike, folderName: string, context: RuntimeStorageContext): Promise<AyasProductionProjectSummary> {
  const projectId = asString(record.id) || folderName;
  const title = asString(record.title) || asString(record.topic) || asString(record.slug) || folderName;
  const status = normalizeStatus(record.status);
  const updatedAt = asString(record.updatedAt) || asString(record.createdAt) || undefined;

  let folder: string;
  try {
    folder = ProjectReader.getProjectFolder(folderName, context);
  } catch {
    return { projectId, title, status: "unknown", updatedAt, hasFinalVideo: false, sceneVideoCount: 0, audioAssetCount: 0, visualAssetCount: 0, resumable: false, note: "proje klasörü güvenli biçimde çözülemedi" };
  }

  const hasFinalVideo = fs.existsSync(path.join(folder, FINAL_VIDEO_RELATIVE));
  const sceneVideoCount = countSceneVideos(path.join(folder, ASSET_DIRS.videos));
  const audioAssetCount = countFiles(path.join(folder, ASSET_DIRS.audio));
  const visualAssetCount = countFiles(path.join(folder, ASSET_DIRS.images));

  // Resumability is derived ONLY from a real, successful PipelineRecoveryPlanner
  // read — the SAME computation `pipeline-recovery-plan` already dispatches.
  // A failed/unreadable read means `resumable: false`, never a guess. Uses
  // `folderName` (the CONFIRMED real directory), not `projectId` (a
  // `project.json`-internal field that is not always the folder's own
  // name) — this takes the resolver's exact-match fast path, with no
  // possibility of a wrong-project resolution via an id/slug collision.
  let resumable = false;
  let resumeCandidateStage: string | undefined;
  let currentStage: string | undefined;
  try {
    const plan = await PipelineRecoveryPlanner.createResumePlan(folderName);
    if (plan.startStage) {
      currentStage = plan.startStage;
      if (!plan.blocked) {
        resumable = true;
        resumeCandidateStage = plan.startStage;
      }
    }
  } catch {
    /* leave resumable: false, currentStage undefined — never guessed */
  }

  return {
    projectId,
    title,
    ...(asString(record.slug) ? { slug: asString(record.slug) } : {}),
    status,
    ...(currentStage ? { currentStage } : {}),
    hasFinalVideo,
    ...(hasFinalVideo ? { finalVideoPath: `${folderName}/${FINAL_VIDEO_RELATIVE}` } : {}),
    sceneVideoCount,
    audioAssetCount,
    visualAssetCount,
    resumable,
    ...(resumeCandidateStage ? { resumeCandidateStage } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

/**
 * Full catalog view: authoritative-root resolution, every project folder
 * normalized exactly once.
 *
 * Deliberately does NOT use `ProjectReader.listProjects()` + a separate
 * id/slug reconciliation pass: a project's `project.json`-internal `id`
 * field (assigned once at creation, a UUID) does not always equal the
 * folder it is currently stored under (e.g. a legacy slug-named folder
 * whose `project.json` content still carries the original UUID `id`) —
 * cross-matching on that content field against the real directory listing
 * produced a real, caught-before-shipping bug: a spurious SECOND "unknown"
 * catalog entry for the very same folder that had already been correctly
 * summarized. Iterating the REAL directory listing directly and reading
 * each folder's OWN `project.json` by its OWN folder name (exactly what
 * `ProjectReader.listProjects()` does internally, and how `ProjectReader
 * .getProjectFolder`'s "already exists at `<root>/<name>`" fast path is
 * designed to be used) makes one-folder-equals-one-catalog-entry a
 * structural guarantee instead of something reconciled after the fact.
 * A folder whose `project.json` is missing/corrupt is still surfaced as an
 * explicit `status: "unknown"` entry — never silently dropped.
 */
export async function loadAyasProjectCatalog(): Promise<AyasProjectCatalogView> {
  const unavailable: AyasProjectCatalogView = { available: false, runtimeClassification: "unavailable", external: false, projects: [], notes: [] };

  let context: RuntimeStorageContext;
  try {
    context = resolveRuntimeStorageContext({});
  } catch {
    return unavailable;
  }

  const notes: string[] = [];
  let folderNames: string[] = [];
  try {
    folderNames = fs.readdirSync(getProjectsRoot(context), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    notes.push("proje envanteri okunamadı");
  }

  const summaries: AyasProductionProjectSummary[] = [];
  for (const folderName of folderNames) {
    let state: Awaited<ReturnType<typeof ProjectReader.readJSONState<ProjectRecordLike>>>;
    try {
      state = await ProjectReader.readJSONState<ProjectRecordLike>(folderName, "project.json", context);
    } catch {
      state = { status: "missing" };
    }
    if (state.status !== "parsed") {
      summaries.push({
        projectId: folderName, title: folderName, status: "unknown",
        hasFinalVideo: false, sceneVideoCount: 0, audioAssetCount: 0, visualAssetCount: 0, resumable: false,
        note: state.status === "malformed" ? "project.json geçersiz JSON" : "geçerli project.json bulunamadı",
      });
      continue;
    }
    summaries.push(await buildProjectSummary(state.value, folderName, context));
  }

  return {
    available: true,
    runtimeClassification: context.classification,
    external: context.source === "environment" && context.classification === "explicit-external",
    projects: summaries,
    notes,
  };
}

export async function listAyasProductionProjects(): Promise<readonly AyasProductionProjectSummary[]> {
  return (await loadAyasProjectCatalog()).projects;
}

export async function getAyasProductionProject(projectId: string): Promise<AyasProductionProjectSummary | null> {
  const catalog = await loadAyasProjectCatalog();
  return catalog.projects.find((p) => p.projectId === projectId || p.slug === projectId) ?? null;
}

export async function findAyasProductionProjects(query: AyasProjectCatalogQuery): Promise<readonly AyasProductionProjectSummary[]> {
  const projects = await listAyasProductionProjects();
  const needle = query.titleContains?.trim().toLocaleLowerCase("tr");
  return projects.filter((p) => {
    if (query.projectId && p.projectId !== query.projectId && p.slug !== query.projectId) return false;
    if (query.status && p.status !== query.status) return false;
    if (query.completionState === "completed" && p.status !== "completed") return false;
    if (query.completionState === "incomplete" && (p.status === "completed" || p.status === "unknown")) return false;
    if (query.resumableOnly && !p.resumable) return false;
    if (needle && !p.title.toLocaleLowerCase("tr").includes(needle) && !(p.slug ?? "").toLocaleLowerCase("tr").includes(needle)) return false;
    return true;
  });
}

export function summarizeAyasProductionProjects(projects: readonly AyasProductionProjectSummary[]): AyasProjectCatalogSummary {
  const byStatus = new Map<string, number>();
  let completedCount = 0;
  let unknownCount = 0;
  let resumableCount = 0;
  for (const p of projects) {
    byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
    if (p.status === "completed") completedCount += 1;
    if (p.status === "unknown") unknownCount += 1;
    if (p.resumable) resumableCount += 1;
  }
  return {
    totalProjects: projects.length,
    completedCount,
    incompleteCount: projects.length - completedCount - unknownCount,
    unknownCount,
    statusDistribution: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    resumableCount,
  };
}
