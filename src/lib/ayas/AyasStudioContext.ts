/**
 * AYAS studio context loader (Sprint 208).
 *
 * A **read-only** projection of the ACTIVE runtime storage authority and the
 * real project inventory, so AYAS chat can answer "where is the runtime
 * authority" / "how many projects are there" from fact instead of guessing off
 * the Brain task queue.
 *
 *  - Resolves the runtime storage context the same way every read path does
 *    (`resolveRuntimeStorageContext` → `ATOLYE_RUNTIME_ROOT`, else the in-repo
 *    default) — so post-cutover this reports `D:\AtolyeRuntime`.
 *  - Lists projects through `ProjectReader.listProjects()`, which is already
 *    bound to that context. It reads `project.json` files only.
 *  - Never throws: any failure returns `{ available: false }` and the prompt
 *    tells AYAS to say it cannot see that information rather than invent it.
 *  - Writes nothing, runs nothing, opens no gate.
 */

import fs from "node:fs";

import {
  resolveRuntimeStorageContext,
  getProjectsRoot,
} from "@/lib/runtime/RuntimeStoragePaths";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import {
  pipelineRecoveryStageOrder,
  pipelineStageDependencies,
} from "@/lib/pipeline/PipelineRecoveryPlanner";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import type {
  AyasStudioContextView,
  AyasStudioProjectView,
} from "@/components/brain/brainCore";

/** How many sample projects to carry into the prompt. */
export const AYAS_STUDIO_SAMPLE_LIMIT = 6;

/** Read-only pipeline facts for one project — no stage is run. Fail-soft. */
interface ProjectPipelineProbe {
  readonly nextStage: string | null;
  readonly failedStages: readonly string[];
  readonly blocked: boolean;
  /** The `error` string of the last failed stage, if any. */
  readonly rootCause: string | null;
  /** `false` when `manifest.json` could not be read for this project. */
  readonly probed: boolean;
}

const NOT_PROBED: ProjectPipelineProbe = {
  nextStage: null,
  failedStages: [],
  blocked: false,
  rootCause: null,
  probed: false,
};

interface ManifestPackageLike {
  readonly status?: unknown;
  readonly error?: unknown;
}
interface ManifestLike {
  readonly packages?: Record<string, ManifestPackageLike>;
}

/**
 * Reads `<folder>/manifest.json` directly through the context-bound
 * `ProjectReader`. Post-cutover the project folder is named by project id, not
 * slug (so `ProjectManager.getManifest(slug)` / `PipelineRecoveryPlanner` miss
 * it) — try the id first, then the slug. Pure computation over
 * `manifest.packages` using the recovery planner's declarative stage order +
 * dependency table. Runs nothing.
 */
async function probeProjectPipeline(
  keys: readonly string[],
  context: RuntimeStorageContext,
): Promise<ProjectPipelineProbe> {
  let packages: Record<string, ManifestPackageLike> | undefined;
  for (const key of keys) {
    if (!key) continue;
    try {
      const manifest = await ProjectReader.readJSON<ManifestLike>(key, "manifest.json", context);
      if (manifest?.packages && typeof manifest.packages === "object") {
        packages = manifest.packages;
        break;
      }
    } catch {
      /* try the next key */
    }
  }
  if (!packages) return NOT_PROBED;
  const pkgs = packages;

  const statusOf = (stage: string): string => {
    const raw = pkgs[stage]?.status;
    return typeof raw === "string" ? raw : "missing";
  };

  const failedStages = pipelineRecoveryStageOrder.filter((s) => statusOf(s) === "failed");
  const nextStage =
    pipelineRecoveryStageOrder.find((s) => statusOf(s) !== "completed") ?? null;
  const blocked =
    nextStage !== null &&
    (pipelineStageDependencies[nextStage] ?? []).some((dep) => statusOf(dep) !== "completed");
  const lastFailed = failedStages[failedStages.length - 1];
  const rawErr = lastFailed ? pkgs[lastFailed]?.error : undefined;
  const rootCause = typeof rawErr === "string" && rawErr.trim() ? rawErr.trim() : null;

  return { nextStage, failedStages, blocked, rootCause, probed: true };
}

interface ProjectRecordLike {
  readonly slug?: unknown;
  readonly id?: unknown;
  readonly title?: unknown;
  readonly topic?: unknown;
  readonly status?: unknown;
  readonly updatedAt?: unknown;
  readonly createdAt?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toProjectView(record: ProjectRecordLike): AyasStudioProjectView {
  return {
    slug: asString(record.slug) || asString(record.id) || "?",
    title: asString(record.title) || asString(record.topic) || asString(record.slug) || "?",
    status: asString(record.status) || "unknown",
  };
}

export async function loadAyasStudioContext(): Promise<AyasStudioContextView> {
  const unavailable: AyasStudioContextView = {
    available: false,
    runtimeAuthority: {
      runtimeRoot: "",
      projectsRoot: "",
      authorityRoot: "",
      classification: "unknown",
      external: false,
    },
    projects: { total: 0, byStatus: [], sample: [] },
    notes: [],
  };

  let context;
  try {
    context = resolveRuntimeStorageContext({});
  } catch {
    return unavailable;
  }

  const notes: string[] = [];
  let records: ProjectRecordLike[] = [];
  try {
    records = (await ProjectReader.listProjects(context)) as ProjectRecordLike[];
  } catch {
    notes.push("proje envanteri okunamadı");
  }

  // A directory with no readable project.json is silently skipped by
  // listProjects — surface that so a count question stays honest.
  try {
    const dirs = fs
      .readdirSync(getProjectsRoot(context), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).length;
    if (dirs > records.length) {
      notes.push(`${dirs - records.length} klasörde geçerli project.json yok (sayıma dahil değil)`);
    }
  } catch {
    /* projectsRoot missing — records will already be empty */
  }

  const byStatusMap = new Map<string, number>();
  for (const record of records) {
    const status = asString(record.status) || "unknown";
    byStatusMap.set(status, (byStatusMap.get(status) ?? 0) + 1);
  }
  const byStatus = [...byStatusMap.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));

  const sortedRecords = [...records].sort(
    (a, b) =>
      Date.parse(asString(b.updatedAt) || asString(b.createdAt) || "") -
        Date.parse(asString(a.updatedAt) || asString(a.createdAt) || "") ||
      asString(a.slug).localeCompare(asString(b.slug)),
  );

  // Read-only pipeline probe for every project — reads `<id>/manifest.json`
  // through the context-bound reader, computes over `packages`, runs nothing.
  const keyOf = (r: ProjectRecordLike): string => asString(r.id) || asString(r.slug);
  const probeEntries = await Promise.all(
    sortedRecords.map(async (record) => {
      const key = keyOf(record);
      if (!key) return null;
      return [key, await probeProjectPipeline([asString(record.id), asString(record.slug)], context)] as const;
    }),
  );
  const probes = new Map<string, ProjectPipelineProbe>();
  for (const entry of probeEntries) if (entry) probes.set(entry[0], entry[1]);

  const viewOf = (record: ProjectRecordLike): AyasStudioProjectView => {
    const base = toProjectView(record);
    const probe = probes.get(keyOf(record));
    if (!probe || !probe.probed) return base;
    return { ...base, nextStage: probe.nextStage, failedStages: probe.failedStages, blocked: probe.blocked };
  };

  const sample = sortedRecords.slice(0, AYAS_STUDIO_SAMPLE_LIMIT).map(viewOf);

  // Pipeline roll-up over ALL probed projects (sortedRecords stays newest-first).
  const probedList = [...probes.values()].filter((p) => p.probed);
  const failedRecords = sortedRecords.filter((r) => {
    const p = probes.get(keyOf(r));
    return p?.probed && p.failedStages.length > 0;
  });
  const stalledMap = new Map<string, number>();
  for (const p of probedList) {
    if (p.nextStage) stalledMap.set(p.nextStage, (stalledMap.get(p.nextStage) ?? 0) + 1);
  }
  const latestFailureRecord = failedRecords[0];
  const latestFailureProbe = latestFailureRecord ? probes.get(keyOf(latestFailureRecord)) : undefined;
  const latestFailure = latestFailureRecord
    ? {
        slug: asString(latestFailureRecord.slug) || asString(latestFailureRecord.id) || "?",
        title:
          asString(latestFailureRecord.title) ||
          asString(latestFailureRecord.topic) ||
          asString(latestFailureRecord.slug) ||
          "?",
        failedStages: latestFailureProbe?.failedStages ?? [],
        rootCause: latestFailureProbe?.rootCause ?? null,
      }
    : null;

  const unprobed = sortedRecords.length - probedList.length;
  if (unprobed > 0 && probedList.length > 0) {
    notes.push(`${unprobed} projede pipeline manifesti okunamadı (pipeline özetine dahil değil)`);
  }
  const pipeline =
    probedList.length > 0
      ? {
          withFailedStage: failedRecords.length,
          blocked: probedList.filter((p) => p.blocked).length,
          stalledAtStage: [...stalledMap.entries()]
            .map(([stage, count]) => ({ stage, count }))
            .sort((a, b) => b.count - a.count || a.stage.localeCompare(b.stage)),
          latestFailure,
        }
      : undefined;

  return {
    available: true,
    runtimeAuthority: {
      runtimeRoot: context.runtimeRoot,
      projectsRoot: context.projectsRoot,
      authorityRoot: context.authorityRoot,
      classification: context.classification,
      external: context.source === "environment" && context.classification === "explicit-external",
    },
    projects: { total: records.length, byStatus, sample, ...(pipeline ? { pipeline } : {}) },
    notes,
  };
}
