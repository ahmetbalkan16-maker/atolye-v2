import fs from "node:fs";
import path from "node:path";
import {
  validateSafeAncestorChain,
  type RuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import { RuntimeMutationError } from "./RuntimeMutationError";

export type RuntimeProtectedRootRole =
  | "repository"
  | "runtime"
  | "live-projects"
  | "machine"
  | "authority"
  | "backup"
  | "restore-verification"
  | "candidate"
  // SEC1 (C.2B.10a) — additive migration roles. Not in `requiredRoles`; only the
  // consume factory supplies them, so existing constructions are unaffected.
  | "relocation-target"
  | "quarantine";

/**
 * SEC1 — the migration roles that must never share a physical path with each
 * other during a consume/relocation. `assertMigrationRolesDisjoint()` enforces
 * every pair; `runtime`/`machine`/`authority` are deliberately excluded here
 * because the live model legitimately nests `live-projects` inside `runtime`.
 */
export const migrationDisjointRoles: readonly RuntimeProtectedRootRole[] = Object.freeze([
  "live-projects",
  "candidate",
  "backup",
  "relocation-target",
  "quarantine",
]);

export interface RuntimeProtectedRootInput {
  readonly role: RuntimeProtectedRootRole;
  readonly path: string;
}

const requiredRoles: readonly RuntimeProtectedRootRole[] = Object.freeze([
  "repository",
  "runtime",
  "live-projects",
  "machine",
  "authority",
  "backup",
  "restore-verification",
]);

interface RuntimeProtectedRootEntry extends RuntimeProtectedRootInput {
  readonly canonicalPath: string;
}

export class RuntimeProtectedRoots {
  readonly entries: readonly RuntimeProtectedRootEntry[];

  constructor(inputs: readonly RuntimeProtectedRootInput[]) {
    const roles = new Set<RuntimeProtectedRootRole>();
    this.entries = Object.freeze(inputs.map((input) => {
      if (roles.has(input.role)) throw invalidPath();
      roles.add(input.role);
      return Object.freeze({ ...input, canonicalPath: canonicalRoot(input.path) });
    }));
    this.assertComplete();
  }

  assertComplete(): void {
    if (requiredRoles.some((role) => !this.root(role))) throw invalidPath();
  }

  root(role: RuntimeProtectedRootRole): string | undefined {
    return this.entries.find((entry) => entry.role === role)?.canonicalPath;
  }

  assertWritableRoot(value: string, allowedRole: RuntimeProtectedRootRole): string {
    const canonical = canonicalRoot(value);
    const allowed = this.root(allowedRole);
    if (!allowed || !samePath(canonical, allowed)) throw overlap();
    for (const entry of this.entries) {
      if (entry.role === allowedRole) continue;
      if (overlaps(canonical, entry.canonicalPath)) throw overlap();
    }
    return canonical;
  }

  /**
   * SEC1 — every pair of migration roles present in this set must be physically
   * disjoint (no equal path, no ancestor/descendant). Roles not present are
   * skipped. Throws `RUNTIME_MUTATION_PROTECTED_ROOT_OVERLAP` on any overlap.
   */
  assertMigrationRolesDisjoint(): void {
    const present = migrationDisjointRoles
      .map((role) => ({ role, path: this.root(role) }))
      .filter((entry): entry is { role: RuntimeProtectedRootRole; path: string } =>
        typeof entry.path === "string");
    for (let i = 0; i < present.length; i += 1) {
      for (let j = i + 1; j < present.length; j += 1) {
        if (overlaps(present[i].path, present[j].path)) throw overlap();
      }
    }
  }
}

export function runtimeProtectedRootsFromContext(input: {
  readonly context: RuntimeStorageContext;
  readonly repositoryRoot: string;
  readonly backupRoot: string;
  readonly restoreVerificationRoot: string;
}): RuntimeProtectedRoots {
  const entries: RuntimeProtectedRootInput[] = [
    { role: "repository", path: input.repositoryRoot },
    { role: "runtime", path: input.context.runtimeRoot },
    { role: "live-projects", path: input.context.projectsRoot },
    { role: "machine", path: input.context.machineRoot },
    { role: "authority", path: input.context.authorityRoot },
  ];
  entries.push({ role: "backup", path: input.backupRoot });
  entries.push({ role: "restore-verification", path: input.restoreVerificationRoot });
  return new RuntimeProtectedRoots(entries);
}

export function runtimeCandidateProtectedRootsFromContext(input: {
  readonly context: RuntimeStorageContext;
  readonly repositoryRoot: string;
  readonly backupRoot: string;
  readonly restoreVerificationRoot: string;
  readonly candidateRoot: string;
}): RuntimeProtectedRoots {
  return new RuntimeProtectedRoots([
    { role: "repository", path: input.repositoryRoot },
    { role: "runtime", path: input.context.runtimeRoot },
    { role: "live-projects", path: input.context.projectsRoot },
    { role: "machine", path: input.context.machineRoot },
    { role: "authority", path: input.context.authorityRoot },
    { role: "backup", path: input.backupRoot },
    { role: "restore-verification", path: input.restoreVerificationRoot },
    { role: "candidate", path: input.candidateRoot },
  ]);
}

/**
 * SEC1 (C.2B.10a) — the physical-disjointness contract for a verified candidate
 * consume / offline materialization. `liveProjects`, `candidate`, `backup`,
 * `relocationTarget` and (when present) `quarantine` must be pairwise disjoint
 * real paths — no equal path, no ancestor/descendant. Symlink / junction / drive
 * root / relative paths are rejected by `canonicalRoot`.
 */
export function assertMigrationConsumeRootsDisjoint(roots: {
  readonly liveProjects: string;
  readonly candidate: string;
  readonly relocationTarget: string;
  readonly backup?: string;
  readonly quarantine?: string;
}): {
  readonly liveProjects: string;
  readonly candidate: string;
  readonly relocationTarget: string;
  readonly backup?: string;
  readonly quarantine?: string;
} {
  const named: [string, string][] = [
    ["live-projects", roots.liveProjects],
    ["candidate", roots.candidate],
    ["relocation-target", roots.relocationTarget],
    ...(roots.backup ? ([["backup", roots.backup]] as [string, string][]) : []),
    ...(roots.quarantine ? ([["quarantine", roots.quarantine]] as [string, string][]) : []),
  ];
  const canonical = named.map(([role, value]) => {
    try {
      return [role, canonicalRoot(value)] as const;
    } catch {
      throw overlap();
    }
  });
  for (let i = 0; i < canonical.length; i += 1) {
    for (let j = i + 1; j < canonical.length; j += 1) {
      if (overlaps(canonical[i][1], canonical[j][1])) throw overlap();
    }
  }
  const byRole = Object.fromEntries(canonical) as Record<string, string>;
  return Object.freeze({
    liveProjects: byRole["live-projects"],
    candidate: byRole.candidate,
    relocationTarget: byRole["relocation-target"],
    ...(byRole.backup ? { backup: byRole.backup } : {}),
    ...(byRole.quarantine ? { quarantine: byRole.quarantine } : {}),
  });
}

export function canonicalRuntimePath(value: string): string {
  return canonicalRoot(value);
}

export function sameRuntimePath(left: string, right: string): boolean {
  return samePath(left, right);
}

export function runtimePathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

function canonicalRoot(value: string) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    !path.isAbsolute(value) ||
    /[\0\r\n]/.test(value)
  ) throw invalidPath();
  const canonical = path.resolve(value);
  if (samePath(canonical, path.parse(canonical).root)) throw invalidPath();
  try {
    validateSafeAncestorChain(canonical);
    if (fs.existsSync(canonical)) {
      const link = fs.lstatSync(canonical);
      const real = fs.realpathSync(canonical);
      if (link.isSymbolicLink() || !link.isDirectory() || !samePath(real, canonical)) {
        throw invalidPath();
      }
      return real;
    }
    return canonical;
  } catch (error) {
    if (error instanceof RuntimeMutationError) throw error;
    throw invalidPath();
  }
}

function overlaps(left: string, right: string) {
  return samePath(left, right) || runtimePathInside(left, right) || runtimePathInside(right, left);
}

function samePath(left: string, right: string) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function invalidPath() {
  return new RuntimeMutationError("RUNTIME_MUTATION_PATH_INVALID");
}

function overlap() {
  return new RuntimeMutationError("RUNTIME_MUTATION_PROTECTED_ROOT_OVERLAP");
}
