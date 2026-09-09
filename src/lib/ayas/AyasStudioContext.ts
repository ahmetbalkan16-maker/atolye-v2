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
import type {
  AyasStudioContextView,
  AyasStudioProjectView,
} from "@/components/brain/brainCore";

/** How many sample projects to carry into the prompt. */
export const AYAS_STUDIO_SAMPLE_LIMIT = 6;

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

  const sample = [...records]
    .sort(
      (a, b) =>
        Date.parse(asString(b.updatedAt) || asString(b.createdAt) || "") -
          Date.parse(asString(a.updatedAt) || asString(a.createdAt) || "") ||
        asString(a.slug).localeCompare(asString(b.slug)),
    )
    .slice(0, AYAS_STUDIO_SAMPLE_LIMIT)
    .map(toProjectView);

  return {
    available: true,
    runtimeAuthority: {
      runtimeRoot: context.runtimeRoot,
      projectsRoot: context.projectsRoot,
      authorityRoot: context.authorityRoot,
      classification: context.classification,
      external: context.source === "environment" && context.classification === "explicit-external",
    },
    projects: { total: records.length, byStatus, sample },
    notes,
  };
}
