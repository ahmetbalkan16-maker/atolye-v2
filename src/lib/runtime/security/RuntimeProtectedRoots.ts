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
  | "restore-verification";

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
