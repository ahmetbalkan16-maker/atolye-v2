/**
 * Graphify consistency scan (read-only) — Final Production Master Sprint §13/§14.
 *
 * Post-cutover, `D:\AtolyeRuntime\projects\` folders are named by project **id**
 * (a UUID), not a human slug. `ProjectReader.getProjectFolder` resolves either
 * (via `ProjectFolderIndex`), and AYAS chat reads project / pipeline facts
 * through that path. This module audits how consistent the on-disk reality is
 * for READ:
 *
 *   - orphan folders (no `project.json` at all);
 *   - folders whose `project.json` has no readable `manifest.json`;
 *   - folders whose `project.json.id` !== folder name (cosmetic — the index
 *     still resolves both, but any FUTURE gated write path must not assume it);
 *   - the real breakage signal: a project whose own folder / id / slug does
 *     NOT resolve back to its folder through the resolver Graphify actually uses;
 *   - the in-repo `data/projects/` legacy root — authoritative only when the
 *     runtime is NOT external; otherwise a quarantine note, never a failure.
 *
 * It NEVER writes, NEVER runs a stage, NEVER opens the execution gate, and it
 * does not touch `D:\AtolyeAuthority`. It reads `project.json` / `manifest.json`
 * only, from whatever `resolveRuntimeStorageContext` resolved to.
 */

import fs from "node:fs";
import path from "node:path";

export interface GraphifyFolderRow {
  readonly folder: string;
  readonly hasProjectJson: boolean;
  readonly hasManifest: boolean;
  /** `project.json.id` — `null` when unreadable. */
  readonly id: string | null;
  readonly slug: string | null;
  readonly status: string | null;
  /** `project.json` present but its `id` does not equal the folder name. */
  readonly idFolderMismatch: boolean;
  /** Identifiers (folder / id / slug) that the resolver fails to map to this folder. */
  readonly unresolvedIdentifiers: readonly string[];
}

export interface GraphifyConsistencyReport {
  readonly projectsRoot: string;
  readonly runtimeExternal: boolean;
  readonly folderCount: number;
  readonly withProjectJson: number;
  readonly withManifest: number;
  /** Folders with no `project.json` at all. */
  readonly orphanFolders: readonly string[];
  /** Folders where `project.json.id` !== folder name (cosmetic if it still resolves). */
  readonly idFolderMismatches: readonly string[];
  /** Folders that have `project.json` but no `manifest.json` (no pipeline state). */
  readonly missingManifests: readonly string[];
  /**
   * REAL breakage: `{ folder, identifiers }` for any project whose own
   * folder/id/slug does not resolve back to it. Empty === every project is
   * reachable by every name Graphify might carry.
   */
  readonly unresolvableProjects: readonly { readonly folder: string; readonly identifiers: readonly string[] }[];
  /** In-repo `data/projects/*.json` records. */
  readonly legacyRecordCount: number;
  /** In-repo records whose folder cannot be resolved against the ACTIVE runtime root. */
  readonly legacyUnresolved: readonly string[];
  /** True when the in-repo `data/projects` is a non-authoritative quarantine (runtime is external). */
  readonly legacyRootIsQuarantine: boolean;
  readonly rows: readonly GraphifyFolderRow[];
  readonly notes: readonly string[];
  /** Known, un-fixed risk for any FUTURE gated write path. */
  readonly writePathRisk: string;
  readonly verdict: "consistent" | "consistent-with-notes" | "inconsistent";
}

export interface GraphifyConsistencyDeps {
  /** Absolute path to `…/projects` (the ACTIVE runtime projects root). */
  readonly projectsRoot: string;
  /** True when the runtime authority is an explicit external root (post-cutover). */
  readonly runtimeExternal: boolean;
  /** Absolute path to the repo's in-repo `data/projects`. */
  readonly legacyDataProjectsDir: string;
  /** Resolve an identifier to an on-disk folder segment against `projectsRoot`, or `null`. */
  readonly resolveFolder: (identifier: string, projectsRoot: string) => string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function safeResolve(
  resolveFolder: GraphifyConsistencyDeps["resolveFolder"],
  identifier: string,
  projectsRoot: string,
): string | null {
  try {
    return resolveFolder(identifier, projectsRoot);
  } catch {
    return null;
  }
}

export function scanGraphifyConsistency(deps: GraphifyConsistencyDeps): GraphifyConsistencyReport {
  let folders: string[] = [];
  try {
    folders = fs
      .readdirSync(deps.projectsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    folders = [];
  }

  const rows: GraphifyFolderRow[] = folders.map((folder) => {
    const dir = path.join(deps.projectsRoot, folder);
    const pj = readJson(path.join(dir, "project.json"));
    const hasProjectJson = pj !== null;
    const hasManifest = fs.existsSync(path.join(dir, "manifest.json"));
    const id = typeof pj?.id === "string" ? (pj.id as string) : null;
    const slug = typeof pj?.slug === "string" ? (pj.slug as string) : null;
    const status = typeof pj?.status === "string" ? (pj.status as string) : null;

    // Every name Graphify might carry for this project must resolve back to it.
    const unresolvedIdentifiers: string[] = [];
    if (hasProjectJson) {
      for (const identifier of new Set([folder, id, slug].filter((v): v is string => Boolean(v)))) {
        if (safeResolve(deps.resolveFolder, identifier, deps.projectsRoot) !== folder) {
          unresolvedIdentifiers.push(identifier);
        }
      }
    }

    return {
      folder,
      hasProjectJson,
      hasManifest,
      id,
      slug,
      status,
      idFolderMismatch: hasProjectJson && id !== null && id !== folder,
      unresolvedIdentifiers,
    };
  });

  const orphanFolders = rows.filter((r) => !r.hasProjectJson).map((r) => r.folder);
  const idFolderMismatches = rows.filter((r) => r.idFolderMismatch).map((r) => r.folder);
  const missingManifests = rows.filter((r) => r.hasProjectJson && !r.hasManifest).map((r) => r.folder);
  const unresolvableProjects = rows
    .filter((r) => r.unresolvedIdentifiers.length > 0)
    .map((r) => ({ folder: r.folder, identifiers: r.unresolvedIdentifiers }));

  // In-repo data/projects — authoritative ONLY when the runtime is not external.
  let legacyIds: string[] = [];
  try {
    legacyIds = fs
      .readdirSync(deps.legacyDataProjectsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => e.name.replace(/\.json$/, ""));
  } catch {
    legacyIds = [];
  }
  const legacyUnresolved = legacyIds.filter(
    (identifier) => safeResolve(deps.resolveFolder, identifier, deps.projectsRoot) === null,
  );
  const legacyRootIsQuarantine = deps.runtimeExternal;

  const notes: string[] = [];
  if (orphanFolders.length > 0) {
    notes.push(
      `${orphanFolders.length} klasörde project.json yok — listProjects bunları zaten atlıyor (${orphanFolders.join(", ")})`,
    );
  }
  if (idFolderMismatches.length > 0) {
    notes.push(
      `${idFolderMismatches.length} klasörde project.json.id folder adına eşit değil — okuma ProjectFolderIndex ile çözülüyor, yalnız gelecekteki write-path bunu varsaymamalı`,
    );
  }
  if (missingManifests.length > 0) {
    notes.push(`${missingManifests.length} projede manifest.json yok — pipeline durumu okunamaz`);
  }
  if (legacyRootIsQuarantine && legacyIds.length > 0) {
    notes.push(
      `in-repo data/projects/ karantina eski kök (git-ignored, otorite değil); ${legacyIds.length} eski kayıt, ${legacyUnresolved.length} aktif runtime'da karşılığı yok — beklenen`,
    );
  }

  const allFoldersAreUuid = folders.length > 0 && folders.every((f) => UUID_RE.test(f));

  // A project no name resolves to === Graphify genuinely can't see it. So does a
  // legacy record that can't be resolved WHILE the in-repo root is authoritative.
  const hardBreak =
    unresolvableProjects.length > 0 || (!legacyRootIsQuarantine && legacyUnresolved.length > 0);
  const softNotes =
    orphanFolders.length +
    idFolderMismatches.length +
    missingManifests.length +
    (legacyRootIsQuarantine ? Math.min(legacyUnresolved.length, 1) : 0);
  const verdict: GraphifyConsistencyReport["verdict"] = hardBreak
    ? "inconsistent"
    : softNotes > 0
      ? "consistent-with-notes"
      : "consistent";

  return {
    projectsRoot: deps.projectsRoot,
    runtimeExternal: deps.runtimeExternal,
    folderCount: folders.length,
    withProjectJson: rows.filter((r) => r.hasProjectJson).length,
    withManifest: rows.filter((r) => r.hasManifest).length,
    orphanFolders,
    idFolderMismatches,
    missingManifests,
    unresolvableProjects,
    legacyRecordCount: legacyIds.length,
    legacyUnresolved,
    legacyRootIsQuarantine,
    rows,
    notes,
    writePathRisk: allFoldersAreUuid
      ? "ProjectWriter / ProjectManager.updatePackageStatus still assume a `<slug>/` folder. " +
        "All runtime folders are UUID-named, so a future GATED write would target the wrong path. " +
        "READ paths are fixed (ProjectFolderIndex); WRITE remains a separate, explicitly-gated task. " +
        "Execution Gate is CLOSED so no write runs today."
      : "Runtime folders are mixed slug/UUID — verify the ProjectWriter `<slug>/` assumption before any gated write. " +
        "Execution Gate is CLOSED so no write runs today.",
    verdict,
  };
}
