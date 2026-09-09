/**
 * AYAS safe executors — the actual allowlisted action implementations (spec §9).
 *
 * Every executor here is **read-only**: no writes, no process spawn, no shell,
 * no network. Paths resolve through the runtime storage authority
 * (`ProjectReader` → `resolveRuntimeStorageContext` → `D:\AtolyeRuntime`), never
 * a repo-local root. Arguments are already typed + validated by
 * `AyasExecutionPolicy` before they reach here.
 *
 * `run-pipeline-stage` and friends (real writes via `PipelineRunner`) are
 * deliberately absent — enabling one is its own gated sprint.
 */

import { ProjectReader } from "@/lib/projects/ProjectReader";
import type { AyasExecutionActionId, AyasExecutionRequest } from "./AyasExecutionPolicy";

export interface AyasExecutorResult {
  readonly action: AyasExecutionActionId;
  readonly write: false;
  readonly summary: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export type AyasExecutor = (request: AyasExecutionRequest) => Promise<AyasExecutorResult>;

async function inspectProject(request: AyasExecutionRequest): Promise<AyasExecutorResult> {
  const slug = request.projectSlug as string;
  const state = await ProjectReader.readJSONState<Record<string, unknown>>(slug, "project.json");

  if (state.status === "missing") {
    return {
      action: "inspect-project",
      write: false,
      summary: `"${slug}" için project.json bulunamadı.`,
      data: { slug, exists: false },
    };
  }
  if (state.status === "malformed") {
    return {
      action: "inspect-project",
      write: false,
      summary: `"${slug}" project.json geçersiz JSON.`,
      data: { slug, exists: true, malformed: true },
    };
  }

  const record = state.value;
  const status = typeof record.status === "string" ? record.status : "unknown";
  const title = typeof record.title === "string" ? record.title : slug;
  return {
    action: "inspect-project",
    write: false,
    summary: `"${title}" — aşama: ${status}.`,
    data: {
      slug,
      exists: true,
      id: typeof record.id === "string" ? record.id : null,
      title,
      status,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    },
  };
}

const EXECUTORS: Readonly<Record<AyasExecutionActionId, AyasExecutor>> = Object.freeze({
  "inspect-project": inspectProject,
});

export function resolveAyasExecutor(action: AyasExecutionActionId): AyasExecutor | undefined {
  return EXECUTORS[action];
}
