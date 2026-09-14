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

import fs from "node:fs";
import path from "node:path";

import { ProjectReader } from "@/lib/projects/ProjectReader";
import { PipelineRecoveryPlanner } from "@/lib/pipeline/PipelineRecoveryPlanner";
import type { AyasExecutionActionId, AyasExecutionRequest } from "./AyasExecutionPolicy";
import { AYAS_DEVELOPER_EXECUTORS } from "./AyasDeveloperEvidence";
import { AyasActionValidationError, type AyasExecutor, type AyasExecutorResult } from "./AyasActionContracts";
export { AyasActionValidationError, type AyasExecutor, type AyasExecutorResult } from "./AyasActionContracts";

/**
 * A tool-level (not policy-level) input rejection — thrown by
 * `readProjectDocument` / `inspectSourceFile` for anything their OWN
 * semantic validation refuses (unknown document id, path traversal, a root/
 * extension outside the allowlist, a secret-shaped name). `AyasExecutionPolicy.ts`'s
 * `validateAyasExecutionRequest` already checked the request's generic shape/
 * size/shell-like content — this is the SECOND, tool-specific layer Phase 5
 * requires. The Action Runtime dispatcher catches this by name and reports a
 * clean `denied` outcome instead of a generic `executor-failed`.
 */
function planField(request: AyasExecutionRequest, key: string): unknown {
  return (request.plan as Record<string, unknown> | undefined)?.[key];
}

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

/**
 * A real `src/lib/pipeline/` action — `PipelineRecoveryPlanner` — used
 * READ-ONLY: it reads the project manifest and *computes* a resume plan +
 * failed / next-incomplete stages. It runs no stage, writes nothing. This is
 * the AYAS → PipelineRunner-family connection (spec §12) at its safe entry
 * point; enabling an actual stage run (`resume-stage` / `retry-stage`) is a
 * separate gated sprint.
 */
async function pipelineRecoveryPlan(request: AyasExecutionRequest): Promise<AyasExecutorResult> {
  const slug = request.projectSlug as string;
  const [plan, failedStages, nextStage] = await Promise.all([
    PipelineRecoveryPlanner.createResumePlan(slug),
    PipelineRecoveryPlanner.getFailedStages(slug),
    PipelineRecoveryPlanner.getNextIncompleteStage(slug),
  ]);
  const blockedReason = plan.blocked ? plan.reason ?? "bağımlılık engeli" : null;
  const summary =
    plan.startStage === null
      ? `"${slug}" pipeline'ı tamamlanmış görünüyor — çalıştırılacak aşama yok.`
      : blockedReason
        ? `"${slug}" ${plan.startStage} aşamasından devam edebilir ama engelli: ${blockedReason}.`
        : `"${slug}" ${plan.startStage} aşamasından devam edebilir (${plan.stagesToRun.length} aşama kalan).`;
  return {
    action: "pipeline-recovery-plan",
    write: false,
    summary,
    data: {
      slug,
      startStage: plan.startStage,
      stagesToRun: plan.stagesToRun,
      blocked: plan.blocked,
      blockedReason,
      failedStages,
      nextIncompleteStage: nextStage,
      dependencies: plan.dependencies.map((d) => ({ stage: d.stage, status: d.status, ready: d.ready })),
    },
  };
}

const REPO_ROOT = process.cwd();

/** Closed enum — never an arbitrary path. Newest entries are prepended, so a bounded read from the top is the "current" section. */
const DOCUMENT_PATHS: Readonly<Record<string, string>> = Object.freeze({
  checkpoint: "ATOLYE_CHECKPOINT.md",
  roadmap: "ROADMAP.md",
  changelog: "CHANGELOG.md",
});
const MAX_DOCUMENT_CHARS = 6_000;

const ALLOWED_SOURCE_ROOTS: readonly string[] = Object.freeze(["src/", "scripts/", "app/"]);
const ALLOWED_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".md", ".json"]);
/** Belt-and-suspenders on top of the strict root allowlist below. */
const DENY_SEGMENT_RE = /(^|\/)(node_modules|\.git|data|secrets|\.next|\.env\b|\.claude|\.vscode)(\/|$)/i;
const SECRET_NAME_RE = /secret|credential|\.env(\.|$)|\.pem$|\.key$|\.pfx$/i;
const MAX_SOURCE_FILE_CHARS = 300_000;
const SOURCE_SEARCH_ROOTS = ["src", "scripts", "app"] as const;
const MAX_SEARCH_FILES = 2_000;
const MAX_SEARCH_RESULTS = 8;

function truncateContent(content: string, maxChars: number): { content: string; truncated: boolean; totalChars: number } {
  const totalChars = content.length;
  if (totalChars <= maxChars) return { content, truncated: false, totalChars };
  return {
    content: `${content.slice(0, maxChars)}\n\n… (kesildi, dosyanın geri kalanı gösterilmedi — toplam ${totalChars} karakter)`,
    truncated: true,
    totalChars,
  };
}

/**
 * Reads a fixed, closed-enum document (checkpoint/roadmap/changelog) — never
 * an arbitrary path. Bounded to the first `MAX_DOCUMENT_CHARS` (these files
 * are documented as prepended newest-first, so "the top" IS "what's current").
 */
async function readProjectDocument(request: AyasExecutionRequest): Promise<AyasExecutorResult> {
  const documentId = planField(request, "documentId");
  if (typeof documentId !== "string" || !(documentId in DOCUMENT_PATHS)) {
    throw new AyasActionValidationError("unknown-document", `bilinmeyen belge kimliği: ${String(documentId)}`);
  }
  const relPath = DOCUMENT_PATHS[documentId]!;
  const absPath = path.join(REPO_ROOT, relPath);

  let raw: string;
  try {
    raw = fs.readFileSync(absPath, "utf-8");
  } catch {
    return {
      action: "read-project-document",
      write: false,
      summary: `"${relPath}" bulunamadı veya okunamadı.`,
      data: { documentId, path: relPath, exists: false },
    };
  }
  const { content, truncated, totalChars } = truncateContent(raw, MAX_DOCUMENT_CHARS);
  return {
    action: "read-project-document",
    write: false,
    summary: `"${relPath}" dosyasının en güncel bölümü okundu (${totalChars} karakter${truncated ? ", kesildi" : ""}).`,
    data: { documentId, path: relPath, exists: true, content, truncated, totalChars },
  };
}

function isPathWithinRoot(absPath: string, root: string): boolean {
  const rel = path.relative(root, absPath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Reads one file, strictly bounded: no traversal, no absolute/drive path, no
 * path outside `src/`/`scripts/`/`app/` (or a top-level `.md` file), no
 * disallowed extension, no secret-shaped name/segment (`.env*`, `secrets/`,
 * `data/` — real project/runtime data, never exposed here). Size-capped with
 * a clear truncation marker, never silently cut without saying so.
 */
async function inspectSourceFile(request: AyasExecutionRequest): Promise<AyasExecutorResult> {
  const rawPath = planField(request, "filePath");
  if (typeof rawPath !== "string" || rawPath.length === 0 || rawPath.length > 300) {
    throw new AyasActionValidationError("invalid-path", "filePath eksik veya çok uzun");
  }
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    normalized.includes("..") ||
    path.isAbsolute(normalized) ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.startsWith("~") ||
    normalized.includes("\0")
  ) {
    throw new AyasActionValidationError("path-traversal", "filePath bir traversal / mutlak yol içeriyor");
  }
  if (DENY_SEGMENT_RE.test(normalized) || SECRET_NAME_RE.test(normalized)) {
    throw new AyasActionValidationError("path-denied", "filePath yasaklı bir segment veya gizli-bilgi benzeri isim içeriyor");
  }
  const inAllowedRoot =
    ALLOWED_SOURCE_ROOTS.some((root) => normalized.startsWith(root)) ||
    (!normalized.includes("/") && normalized.toLowerCase().endsWith(".md"));
  if (!inAllowedRoot) {
    throw new AyasActionValidationError(
      "path-not-allowed",
      "filePath izinli köklerin dışında (src/, scripts/, app/ veya üst düzey bir .md dosyası olmalı)",
    );
  }
  const ext = path.extname(normalized).toLowerCase();
  if (!ALLOWED_SOURCE_EXTENSIONS.has(ext)) {
    throw new AyasActionValidationError("extension-not-allowed", `"${ext || "(uzantısız)"}" uzantısına izin verilmiyor`);
  }
  const absPath = path.resolve(REPO_ROOT, normalized);
  if (!isPathWithinRoot(absPath, REPO_ROOT)) {
    throw new AyasActionValidationError("path-traversal", "çözümlenen yol depo kökünün dışında");
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return {
      action: "inspect-source-file",
      write: false,
      summary: `"${normalized}" bulunamadı.`,
      data: { filePath: normalized, exists: false },
    };
  }
  if (!stat.isFile()) {
    return {
      action: "inspect-source-file",
      write: false,
      summary: `"${normalized}" bir dosya değil.`,
      data: { filePath: normalized, exists: false },
    };
  }

  const raw = fs.readFileSync(absPath, "utf-8");
  const { content, truncated, totalChars } = truncateContent(raw, MAX_SOURCE_FILE_CHARS);
  return {
    action: "inspect-source-file",
    write: false,
    summary: `"${normalized}" okundu (${totalChars} karakter${truncated ? ", kesildi" : ""}).`,
    data: { filePath: normalized, exists: true, extension: ext, content, truncated, totalChars },
  };
}

/** Semantic bounded source search; never accepts a command, glob or path. */
async function searchProjectSource(request: AyasExecutionRequest): Promise<AyasExecutorResult> {
  const query = planField(request, "query");
  if (typeof query !== "string" || !/^[A-Za-z_][A-Za-z0-9_.:-]{2,119}$/.test(query)) {
    throw new AyasActionValidationError("invalid-search-query", "query tek bir sınırlı teknik tanımlayıcı olmalı");
  }
  const results: Array<{ filePath: string; line: number; excerpt: string }> = [];
  let visited = 0;
  const extensions = ALLOWED_SOURCE_EXTENSIONS;
  const visit = (dir: string): void => {
    if (results.length >= MAX_SEARCH_RESULTS || visited >= MAX_SEARCH_FILES || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (results.length >= MAX_SEARCH_RESULTS || visited >= MAX_SEARCH_FILES) break;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!DENY_SEGMENT_RE.test(absolute.replace(/\\/g, "/"))) visit(absolute); continue; }
      visited++;
      if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase()) || SECRET_NAME_RE.test(entry.name)) continue;
      const raw = fs.readFileSync(absolute, "utf8");
      if (raw.length > MAX_SOURCE_FILE_CHARS) continue;
      const lines = raw.split(/\r?\n/u);
      for (let index = 0; index < lines.length && results.length < MAX_SEARCH_RESULTS; index++) {
        if (lines[index]!.includes(query)) results.push({ filePath: path.relative(REPO_ROOT, absolute).replace(/\\/g, "/"), line: index + 1, excerpt: lines[index]!.trim().slice(0, 240) });
      }
    }
  };
  for (const root of SOURCE_SEARCH_ROOTS) visit(path.join(REPO_ROOT, root));
  return { action: "search-project-source", write: false, summary: `"${query}" için ${results.length} sınırlı kaynak eşleşmesi bulundu.`, data: { query, results, resultLimit: MAX_SEARCH_RESULTS, visitedFiles: visited, truncated: results.length >= MAX_SEARCH_RESULTS || visited >= MAX_SEARCH_FILES } };
}

const EXECUTORS: Readonly<Record<AyasExecutionActionId, AyasExecutor>> = Object.freeze({
  "inspect-project": inspectProject,
  "pipeline-recovery-plan": pipelineRecoveryPlan,
  "read-project-document": readProjectDocument,
  "inspect-source-file": inspectSourceFile,
  "search-project-source": searchProjectSource,
  ...AYAS_DEVELOPER_EXECUTORS,
});

export function resolveAyasExecutor(action: AyasExecutionActionId): AyasExecutor | undefined {
  return EXECUTORS[action];
}
