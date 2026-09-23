/**
 * Project folder identity index (Final Execution Sprint — Graphify real-data closure).
 *
 * WHY: `ProjectReader` / `ProjectManager` / `PipelineRecoveryPlanner` all address
 * a project by a single "slug" segment that is joined straight onto
 * `<projectsRoot>/<slug>/`. New projects are written to `<humanSlug>/`, but the
 * post-cutover data on `D:\AtolyeRuntime\projects\` names every folder by the
 * project **id** (a UUID). So `getManifest(humanSlug)` / `getProject(humanSlug)`
 * and every consumer that carries the human slug forward (the dashboard's
 * `/project/<slug>` link, `getProgressSummary`, the AYAS `pipeline-recovery-plan`
 * executor, …) currently miss every migrated project.
 *
 * This module is a **read-only** resolver: given any identifier (a folder name,
 * a project `id`, or a `project.json` `slug`), it returns the name of the folder
 * that actually holds that project — or `null`. It:
 *   - never writes, never moves a file, never touches a manifest;
 *   - is a pure fallback: a directory that already exists at
 *     `<projectsRoot>/<identifier>/` is returned unchanged, so every case that
 *     works today keeps working byte-for-byte;
 *   - only scans when the direct path is absent (exactly the cases that return
 *     `null` today);
 *   - caches the scan per `projectsRoot`, invalidated by that directory's mtime.
 */

import fs from "node:fs";
import path from "node:path";

const SAFE_SEGMENT = /^[a-zA-Z0-9-_]+$/;

interface FolderIndexEntry {
  readonly folder: string;
  readonly id: string;
  readonly slug: string;
}

interface CachedIndex {
  readonly mtimeMs: number;
  /** id → folder and slug → folder; folder → folder (identity). */
  readonly byId: Map<string, string>;
  readonly bySlug: Map<string, string>;
  readonly folders: ReadonlySet<string>;
}

const cache = new Map<string, CachedIndex>();

function readIndex(projectsRoot: string): CachedIndex {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(projectsRoot).mtimeMs;
  } catch {
    const empty: CachedIndex = { mtimeMs: -1, byId: new Map(), bySlug: new Map(), folders: new Set() };
    return empty;
  }

  const cached = cache.get(projectsRoot);
  if (cached && cached.mtimeMs === mtimeMs) return cached;

  const byId = new Map<string, string>();
  const bySlug = new Map<string, string>();
  const { folders, found } = scanFolders(projectsRoot);

  // Deterministic: sort by folder name so a slug collision resolves the same way
  // every call; an exact id match is unique (UUID) and always wins.
  found.sort((a, b) => a.folder.localeCompare(b.folder));
  for (const f of found) {
    if (f.id && !byId.has(f.id)) byId.set(f.id, f.folder);
    if (f.slug && !bySlug.has(f.slug)) bySlug.set(f.slug, f.folder);
  }

  const next: CachedIndex = { mtimeMs, byId, bySlug, folders };
  cache.set(projectsRoot, next);
  return next;
}

function scanFolders(projectsRoot: string): { folders: Set<string>; found: FolderIndexEntry[] } {
  const folders = new Set<string>();
  const found: FolderIndexEntry[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    /* leave empty */
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !SAFE_SEGMENT.test(entry.name)) continue;
    folders.add(entry.name);
    try {
      const raw = fs.readFileSync(path.join(projectsRoot, entry.name, "project.json"), "utf-8");
      const record = JSON.parse(raw) as { id?: unknown; slug?: unknown };
      const id = typeof record.id === "string" ? record.id : "";
      const slug = typeof record.slug === "string" ? record.slug : "";
      found.push({ folder: entry.name, id, slug });
    } catch {
      /* a folder with no readable project.json is not indexable — skip */
    }
  }
  return { folders, found };
}

/**
 * Folders other than `<identifier>/` whose `project.json` id or slug is
 * `identifier`. Unlike `resolveProjectFolderSegment` this never takes the
 * direct-folder fast path and never uses the cache (a fresh read-only scan),
 * so a new project cannot be created under a slug another folder already owns.
 */
export function findOtherFoldersOwningIdentity(
  identifier: string,
  projectsRoot: string,
): string[] {
  if (typeof identifier !== "string" || !SAFE_SEGMENT.test(identifier)) return [];
  return scanFolders(projectsRoot).found
    .filter((entry) => entry.folder !== identifier && (entry.id === identifier || entry.slug === identifier))
    .map((entry) => entry.folder)
    .sort();
}

/**
 * Resolve `identifier` to the folder segment that actually holds the project,
 * or `null`. `projectsRoot` must be the already-resolved absolute projects root
 * (`context.projectsRoot`). Read-only.
 */
export function resolveProjectFolderSegment(
  identifier: string,
  projectsRoot: string,
): string | null {
  if (typeof identifier !== "string" || !SAFE_SEGMENT.test(identifier)) return null;

  // Fast path: a folder already exists at this exact segment — unchanged behaviour.
  try {
    if (fs.statSync(path.join(projectsRoot, identifier)).isDirectory()) return identifier;
  } catch {
    /* fall through to the index */
  }

  const index = readIndex(projectsRoot);
  if (index.folders.has(identifier)) return identifier;
  return index.byId.get(identifier) ?? index.bySlug.get(identifier) ?? null;
}

/**
 * Drop the cached scan for one projects root. The cache is keyed on the root's
 * mtime, which a `project.json` rewritten inside an existing folder does not
 * change; the write-side resolver (`RuntimeStoragePaths`) calls this when its
 * fresh scan disagrees with the cached answer, so reads see what writes see.
 */
export function invalidateProjectFolderIndex(projectsRoot: string): void {
  cache.delete(projectsRoot);
}

/** Test seam — drop the per-root scan cache. */
export function clearProjectFolderIndexCache(): void {
  cache.clear();
}
