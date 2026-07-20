import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getActiveRuntimeOperationScope } from "./RuntimeOperationScope";

export const runtimeStorageEnvironmentVariable = "ATOLYE_RUNTIME_ROOT";
export const runtimeStoragePolicyVersion = "runtime-storage-v1";
export const runtimeStorageLogicalProjectsRoot = "projects";

const contextKind = "runtime-storage-context-v1";
const authorityPolicyVersion = "runtime-authority-v1";
const trustedRuntimeStorageContexts = new WeakSet<object>();
const authorityLeaseBrand: unique symbol = Symbol("runtime-storage-authority-lease");
const trustedAuthorityLeases = new WeakMap<
  object,
  {
    readonly context: RuntimeStorageContext;
    readonly projectSlug: string;
    readonly lockRoot: string;
    readonly ownerId: string;
    active: boolean;
  }
>();

export type RuntimeStorageClassification =
  | "legacy-repository"
  | "explicit-legacy"
  | "explicit-workspace"
  | "explicit-external";

export interface RuntimeStorageConfiguration {
  readonly policyVersion: typeof runtimeStoragePolicyVersion;
  readonly source: "legacy-default" | "environment";
  readonly classification: RuntimeStorageClassification;
  readonly workspaceRoot: string;
  readonly runtimeRoot: string;
  readonly projectsRoot: string;
  readonly legacyProjectsRoot: string;
  readonly logicalProjectsRoot: typeof runtimeStorageLogicalProjectsRoot;
}

export interface RuntimeStorageContext extends RuntimeStorageConfiguration {
  readonly kind: typeof contextKind;
  readonly machineRoot: string;
  readonly authorityRoot: string;
}

export interface RuntimeStorageResolutionOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly workspaceRoot?: string;
  /** Test/embedding override. This path is machine-local coordination state, never project data. */
  readonly authorityRoot?: string;
}

export type RuntimeStorageInput =
  | RuntimeStorageContext
  | RuntimeStorageResolutionOptions;

export type RuntimeStorageErrorCode =
  | "RUNTIME_STORAGE_CONFIGURATION_INVALID"
  | "RUNTIME_STORAGE_PATH_INVALID"
  | "RUNTIME_STORAGE_LINK_UNSAFE"
  | "RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE"
  | "RUNTIME_STORAGE_AUTHORITY_LOCKED"
  | "RUNTIME_STORAGE_AUTHORITY_CLAIM_INVALID"
  | "RUNTIME_STORAGE_CONTEXT_INVALID"
  | "RUNTIME_STORAGE_OPERATION_CONTEXT_MISMATCH";

export class RuntimeStorageError extends Error {
  constructor(readonly code: RuntimeStorageErrorCode) {
    super(messageFor(code));
    this.name = "RuntimeStorageError";
    this.stack = undefined;
  }
}

export interface RuntimeStorageAuthorityLease {
  readonly context: RuntimeStorageContext;
  readonly projectSlug: string;
  readonly [authorityLeaseBrand]: true;
  release(): void;
}

export function createRuntimeStorageContext(
  options: RuntimeStorageResolutionOptions = {},
): RuntimeStorageContext {
  const activeContext = getActiveRuntimeOperationScope()?.storageContext;
  if (activeContext) {
    assertTrustedRuntimeStorageContext(activeContext);
    if (Object.keys(options).length > 0) {
      throw new RuntimeStorageError("RUNTIME_STORAGE_OPERATION_CONTEXT_MISMATCH");
    }
    return activeContext;
  }
  const environment = options.environment ?? process.env;
  const workspaceRoot = canonicalAbsolutePath(
    options.workspaceRoot ?? process.cwd(),
    "RUNTIME_STORAGE_CONFIGURATION_INVALID",
  );
  const legacyProjectsRoot = getLegacyProjectsRoot(workspaceRoot);
  const explicitlyConfigured = Object.prototype.hasOwnProperty.call(
    environment,
    runtimeStorageEnvironmentVariable,
  );

  let source: RuntimeStorageConfiguration["source"];
  let classification: RuntimeStorageClassification;
  let runtimeRoot: string;

  if (!explicitlyConfigured) {
    source = "legacy-default";
    classification = "legacy-repository";
    runtimeRoot = path.dirname(legacyProjectsRoot);
  } else {
    const rawRoot = environment[runtimeStorageEnvironmentVariable];
    if (!validConfiguredRoot(rawRoot)) {
      throw new RuntimeStorageError("RUNTIME_STORAGE_CONFIGURATION_INVALID");
    }
    runtimeRoot = canonicalAbsolutePath(
      rawRoot,
      "RUNTIME_STORAGE_CONFIGURATION_INVALID",
    );
    if (samePath(runtimeRoot, path.parse(runtimeRoot).root)) {
      throw new RuntimeStorageError("RUNTIME_STORAGE_CONFIGURATION_INVALID");
    }
    const configuredProjectsRoot = containedPath(
      runtimeRoot,
      runtimeStorageLogicalProjectsRoot,
    );
    source = "environment";
    classification = samePath(configuredProjectsRoot, legacyProjectsRoot)
      ? "explicit-legacy"
      : isPathInsideOrEqual(workspaceRoot, runtimeRoot)
        ? "explicit-workspace"
        : "explicit-external";
  }

  const projectsRoot = containedPath(runtimeRoot, runtimeStorageLogicalProjectsRoot);
  const authorityRoot = canonicalAbsolutePath(
    options.authorityRoot ?? path.join(os.tmpdir(), "atolye-runtime-authority-v1"),
    "RUNTIME_STORAGE_CONFIGURATION_INVALID",
  );
  if (samePath(authorityRoot, path.parse(authorityRoot).root)) {
    throw new RuntimeStorageError("RUNTIME_STORAGE_CONFIGURATION_INVALID");
  }

  validateSafeAncestorChain(runtimeRoot);
  validateSafeAncestorChain(projectsRoot);
  validateSafeAncestorChain(authorityRoot);

  const context = Object.freeze({
    kind: contextKind,
    policyVersion: runtimeStoragePolicyVersion,
    source,
    classification,
    workspaceRoot,
    runtimeRoot,
    projectsRoot,
    legacyProjectsRoot,
    logicalProjectsRoot: runtimeStorageLogicalProjectsRoot,
    machineRoot: containedPath(runtimeRoot, "machine"),
    authorityRoot,
  });
  trustedRuntimeStorageContexts.add(context);
  return context;
}

export function resolveRuntimeStorageContext(
  input: RuntimeStorageInput = {},
): RuntimeStorageContext {
  if (!isRuntimeStorageContext(input)) return createRuntimeStorageContext(input);
  assertTrustedRuntimeStorageContext(input);
  const activeContext = getActiveRuntimeOperationScope()?.storageContext;
  if (activeContext) assertTrustedRuntimeStorageContext(activeContext);
  if (activeContext && input !== activeContext) {
    throw new RuntimeStorageError("RUNTIME_STORAGE_OPERATION_CONTEXT_MISMATCH");
  }
  return input;
}

export function assertTrustedRuntimeStorageContext(
  value: unknown,
): asserts value is RuntimeStorageContext {
  if (
    typeof value !== "object" ||
    value === null ||
    !trustedRuntimeStorageContexts.has(value)
  ) {
    throw new RuntimeStorageError("RUNTIME_STORAGE_CONTEXT_INVALID");
  }
}

export function resolveRuntimeStorageConfiguration(
  options: RuntimeStorageResolutionOptions = {},
): RuntimeStorageConfiguration {
  return createRuntimeStorageContext(options);
}

export function getLegacyProjectsRoot(workspaceRoot = process.cwd()): string {
  return path.resolve(workspaceRoot, "data", "projects");
}

export function getProjectsRoot(input: RuntimeStorageInput = {}): string {
  return resolveRuntimeStorageContext(input).projectsRoot;
}

export function getProjectRoot(
  slug: string,
  input: RuntimeStorageInput = {},
): string {
  requireProjectSlug(slug);
  const context = resolveRuntimeStorageContext(input);
  const projectRoot = containedPath(context.projectsRoot, slug);
  validateSafeAncestorChain(projectRoot);
  assertNoDualRootDivergence(context, slug, projectRoot);
  assertAuthorityClaimCompatible(context, slug);
  return projectRoot;
}

export function assertProjectWriteAuthority(
  slug: string,
  input: RuntimeStorageInput = {},
): void {
  requireProjectSlug(slug);
  const context = resolveRuntimeStorageContext(input);
  assertProjectWriteAuthorityWithContext(context, slug);
}

export function acquireProjectWriteAuthority(
  slug: string,
  input: RuntimeStorageInput = {},
): RuntimeStorageAuthorityLease {
  requireProjectSlug(slug);
  const context = resolveRuntimeStorageContext(input);

  // This read-only validation must precede every coordination or runtime mutation.
  validateSafeAncestorChain(context.runtimeRoot);
  validateSafeAncestorChain(context.projectsRoot);
  assertProjectWriteAuthorityWithContext(context, slug);

  ensureSafeDirectory(context.authorityRoot);
  const identity = authorityIdentity(context, slug);
  const lockRoot = path.join(context.authorityRoot, `${identity}.lock`);
  try {
    fs.mkdirSync(lockRoot);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new RuntimeStorageError("RUNTIME_STORAGE_AUTHORITY_LOCKED");
    }
    throw new RuntimeStorageError("RUNTIME_STORAGE_AUTHORITY_CLAIM_INVALID");
  }

  const ownerId = randomUUID();
  let lease: RuntimeStorageAuthorityLease | undefined;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const state = lease ? trustedAuthorityLeases.get(lease) : undefined;
    if (state) state.active = false;
    try {
      validateExistingDirectory(lockRoot);
      const ownerPath = path.join(lockRoot, "owner.json");
      const ownerLink = fs.lstatSync(ownerPath);
      if (!ownerLink.isFile() || ownerLink.isSymbolicLink()) return;
      const owner = readAuthorityOwner(ownerPath);
      if (owner.ownerId !== ownerId || owner.processId !== process.pid) return;
      fs.unlinkSync(ownerPath);
      fs.rmdirSync(lockRoot);
    } catch {
      // A failed release becomes a stale fail-closed lock; never break it automatically.
    }
  };

  try {
    fs.writeFileSync(
      path.join(lockRoot, "owner.json"),
      JSON.stringify({
        policyVersion: authorityPolicyVersion,
        ownerId,
        processId: process.pid,
      }),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    assertProjectWriteAuthorityWithContext(context, slug);
    establishAuthorityClaim(context, slug, identity);
    assertProjectWriteAuthorityWithContext(context, slug);
    lease = Object.freeze({
      context,
      projectSlug: slug,
      [authorityLeaseBrand]: true as const,
      release,
    });
    trustedAuthorityLeases.set(lease, {
      context,
      projectSlug: slug,
      lockRoot,
      ownerId,
      active: true,
    });
    return lease;
  } catch (error) {
    release();
    throw error;
  }
}

export function assertProjectWriteAuthorityLease(
  lease: RuntimeStorageAuthorityLease,
  projectSlug: string,
  input: RuntimeStorageInput = lease?.context,
): void {
  requireProjectSlug(projectSlug);
  const context = resolveRuntimeStorageContext(input);
  const state = lease && typeof lease === "object"
    ? trustedAuthorityLeases.get(lease)
    : undefined;
  if (
    !state?.active ||
    lease.context !== context ||
    lease.projectSlug !== projectSlug ||
    state.context !== context ||
    state.projectSlug !== projectSlug ||
    lease[authorityLeaseBrand] !== true
  ) {
    throw new RuntimeStorageError("RUNTIME_STORAGE_AUTHORITY_CLAIM_INVALID");
  }
  try {
    validateExistingDirectory(state.lockRoot);
    const owner = readAuthorityOwner(path.join(state.lockRoot, "owner.json"));
    if (
      owner.policyVersion !== authorityPolicyVersion ||
      owner.ownerId !== state.ownerId ||
      owner.processId !== process.pid
    ) {
      throw new Error("invalid");
    }
    assertProjectWriteAuthorityWithContext(context, projectSlug);
  } catch {
    state.active = false;
    throw new RuntimeStorageError("RUNTIME_STORAGE_AUTHORITY_CLAIM_INVALID");
  }
}

function readAuthorityOwner(filePath: string): {
  readonly policyVersion: string;
  readonly ownerId: string;
  readonly processId: number;
} {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 1024) {
    throw new RuntimeStorageError("RUNTIME_STORAGE_AUTHORITY_CLAIM_INVALID");
  }
  const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    policyVersion?: unknown;
    ownerId?: unknown;
    processId?: unknown;
  };
  if (
    value.policyVersion !== authorityPolicyVersion ||
    typeof value.ownerId !== "string" ||
    !/^[0-9a-f-]{36}$/.test(value.ownerId) ||
    !Number.isSafeInteger(value.processId) ||
    (value.processId as number) <= 0
  ) {
    throw new RuntimeStorageError("RUNTIME_STORAGE_AUTHORITY_CLAIM_INVALID");
  }
  return value as {
    policyVersion: string;
    ownerId: string;
    processId: number;
  };
}

export function getMachineRuntimeRoot(
  hostId = "local",
  input: RuntimeStorageInput = {},
): string {
  requireMachineSegment(hostId);
  const context = resolveRuntimeStorageContext(input);
  return containedPath(context.machineRoot, hostId);
}

export function getLogicalProjectIdentity(slug: string): string {
  requireProjectSlug(slug);
  return `${runtimeStorageLogicalProjectsRoot}/${slug}`;
}

export function resolveRuntimeLogicalPath(
  logicalPath: string,
  input: RuntimeStorageInput = {},
): string {
  const context = resolveRuntimeStorageContext(input);
  const segments = validateRuntimeLogicalPath(logicalPath);
  const [slug, ...remainder] = segments.slice(2);
  const projectRoot = getProjectRoot(slug, context);
  return remainder.reduce((current, segment) => containedPath(current, segment), projectRoot);
}

export function resolveRuntimeLogicalPathForWrite(
  logicalPath: string,
  input: RuntimeStorageInput = {},
): string {
  const context = resolveRuntimeStorageContext(input);
  const segments = validateRuntimeLogicalPath(logicalPath);
  assertProjectWriteAuthorityWithContext(context, segments[2]);
  const projectRoot = containedPath(context.projectsRoot, segments[2]);
  return segments.slice(3).reduce(
    (current, segment) => containedPath(current, segment),
    projectRoot,
  );
}

export function validateSafeAncestorChain(target: string): string {
  const canonicalTarget = canonicalAbsolutePath(target, "RUNTIME_STORAGE_PATH_INVALID");
  const root = path.parse(canonicalTarget).root;
  const relative = path.relative(root, canonicalTarget);
  let current = root;
  validateExistingDirectory(current);
  if (!relative) return current;

  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) return path.dirname(current);
    validateExistingDirectory(current);
  }
  return current;
}

export function ensureSafeDirectory(target: string): string {
  const canonicalTarget = canonicalAbsolutePath(target, "RUNTIME_STORAGE_PATH_INVALID");
  const nearest = validateSafeAncestorChain(canonicalTarget);
  if (samePath(nearest, canonicalTarget)) return requireExactRealDirectory(canonicalTarget);
  const relative = path.relative(nearest, canonicalTarget);
  if (isOutsideRelative(relative)) {
    throw new RuntimeStorageError("RUNTIME_STORAGE_PATH_INVALID");
  }

  const created: string[] = [];
  let current = nearest;
  try {
    for (const segment of relative.split(path.sep)) {
      const next = path.join(current, segment);
      assertPathContained(current, next);
      try {
        fs.mkdirSync(next);
        created.push(next);
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      }
      const realCurrent = requireExactRealDirectory(current);
      const realNext = requireExactRealDirectory(next);
      if (!isPathInsideOrEqual(realCurrent, realNext) || samePath(realCurrent, realNext)) {
        throw new RuntimeStorageError("RUNTIME_STORAGE_LINK_UNSAFE");
      }
      current = next;
    }
    return requireExactRealDirectory(canonicalTarget);
  } catch (error) {
    for (const directory of created.reverse()) {
      try { fs.rmdirSync(directory); } catch { /* only remove directories created by this call */ }
    }
    if (error instanceof RuntimeStorageError) throw error;
    throw new RuntimeStorageError("RUNTIME_STORAGE_LINK_UNSAFE");
  }
}

export function ensureSafeContainedDirectory(root: string, target: string): string {
  const canonicalRoot = canonicalAbsolutePath(root, "RUNTIME_STORAGE_PATH_INVALID");
  const canonicalTarget = canonicalAbsolutePath(target, "RUNTIME_STORAGE_PATH_INVALID");
  ensureSafeDirectory(canonicalRoot);
  if (!samePath(canonicalRoot, canonicalTarget)) {
    assertPathContained(canonicalRoot, canonicalTarget);
  }
  ensureSafeDirectory(canonicalTarget);
  return requireContainedRealDirectory(canonicalRoot, canonicalTarget, true);
}

export function requireContainedRealDirectory(
  root: string,
  target: string,
  allowEqual = false,
): string {
  const realRoot = requireExactRealDirectory(root);
  const realTarget = requireExactRealDirectory(target);
  if (samePath(realRoot, realTarget)) {
    if (allowEqual) return realTarget;
    throw new RuntimeStorageError("RUNTIME_STORAGE_PATH_INVALID");
  }
  assertPathContained(realRoot, realTarget);
  return realTarget;
}

export function assertPathContained(root: string, candidate: string): void {
  const canonicalRoot = canonicalAbsolutePath(root, "RUNTIME_STORAGE_PATH_INVALID");
  const canonicalCandidate = canonicalAbsolutePath(candidate, "RUNTIME_STORAGE_PATH_INVALID");
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  if (!relative || isOutsideRelative(relative)) {
    throw new RuntimeStorageError("RUNTIME_STORAGE_PATH_INVALID");
  }
}

function assertProjectWriteAuthorityWithContext(
  context: RuntimeStorageContext,
  slug: string,
) {
  validateSafeAncestorChain(context.runtimeRoot);
  validateSafeAncestorChain(context.projectsRoot);
  const projectRoot = containedPath(context.projectsRoot, slug);
  validateSafeAncestorChain(projectRoot);
  if (!samePath(context.projectsRoot, context.legacyProjectsRoot)) {
    const legacyProjectRoot = containedPath(context.legacyProjectsRoot, slug);
    validateSafeAncestorChain(legacyProjectRoot);
    if (fs.existsSync(legacyProjectRoot)) {
      throw new RuntimeStorageError("RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE");
    }
  }
  assertAuthorityClaimCompatible(context, slug);
}

function assertNoDualRootDivergence(
  context: RuntimeStorageContext,
  slug: string,
  configuredProjectRoot: string,
) {
  if (samePath(context.projectsRoot, context.legacyProjectsRoot)) return;
  const legacyProjectRoot = containedPath(context.legacyProjectsRoot, slug);
  validateSafeAncestorChain(legacyProjectRoot);
  if (!fs.existsSync(legacyProjectRoot) || !fs.existsSync(configuredProjectRoot)) return;
  throw new RuntimeStorageError("RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE");
}

function establishAuthorityClaim(
  context: RuntimeStorageContext,
  slug: string,
  identity: string,
) {
  const claimPath = path.join(context.authorityRoot, `${identity}.claim.json`);
  const expected = authorityClaim(context, slug);
  if (fs.existsSync(claimPath)) {
    requireMatchingAuthorityClaim(claimPath, expected);
    return;
  }
  try {
    fs.writeFileSync(claimPath, JSON.stringify(expected), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") {
      throw new RuntimeStorageError("RUNTIME_STORAGE_AUTHORITY_CLAIM_INVALID");
    }
    requireMatchingAuthorityClaim(claimPath, expected);
  }
}

function assertAuthorityClaimCompatible(context: RuntimeStorageContext, slug: string) {
  const claimPath = path.join(
    context.authorityRoot,
    `${authorityIdentity(context, slug)}.claim.json`,
  );
  if (!fs.existsSync(claimPath)) return;
  requireMatchingAuthorityClaim(claimPath, authorityClaim(context, slug));
}

function authorityClaim(context: RuntimeStorageContext, slug: string) {
  return Object.freeze({
    policyVersion: authorityPolicyVersion,
    projectIdentity: getLogicalProjectIdentity(slug),
    authorityFingerprint: digest(normalizedForIdentity(context.projectsRoot)),
  });
}

function requireMatchingAuthorityClaim(
  claimPath: string,
  expected: ReturnType<typeof authorityClaim>,
) {
  let value: unknown;
  try {
    const stat = fs.lstatSync(claimPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > 1024) {
      throw new Error("invalid");
    }
    value = JSON.parse(fs.readFileSync(claimPath, "utf8"));
  } catch {
    throw new RuntimeStorageError("RUNTIME_STORAGE_AUTHORITY_CLAIM_INVALID");
  }
  if (
    !isRecord(value) ||
    value.policyVersion !== expected.policyVersion ||
    value.projectIdentity !== expected.projectIdentity ||
    value.authorityFingerprint !== expected.authorityFingerprint
  ) {
    throw new RuntimeStorageError("RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE");
  }
}

function authorityIdentity(context: RuntimeStorageContext, slug: string) {
  return digest(`${normalizedForIdentity(context.workspaceRoot)}\0${getLogicalProjectIdentity(slug)}`);
}

function validateRuntimeLogicalPath(logicalPath: string) {
  if (
    typeof logicalPath !== "string" ||
    logicalPath.length === 0 ||
    logicalPath.includes("\\") ||
    logicalPath.startsWith("/") ||
    /[\0\r\n]/.test(logicalPath)
  ) {
    throw new RuntimeStorageError("RUNTIME_STORAGE_PATH_INVALID");
  }
  const segments = logicalPath.split("/");
  if (
    segments.length < 3 ||
    segments[0] !== "data" ||
    segments[1] !== "projects" ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new RuntimeStorageError("RUNTIME_STORAGE_PATH_INVALID");
  }
  requireProjectSlug(segments[2]);
  return segments;
}

function validateExistingDirectory(target: string) {
  let stat: fs.Stats;
  let realTarget: string;
  try {
    stat = fs.lstatSync(target);
    realTarget = fs.realpathSync(target);
  } catch {
    throw new RuntimeStorageError("RUNTIME_STORAGE_LINK_UNSAFE");
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || !samePath(realTarget, target)) {
    throw new RuntimeStorageError("RUNTIME_STORAGE_LINK_UNSAFE");
  }
}

function requireExactRealDirectory(target: string) {
  validateExistingDirectory(target);
  return fs.realpathSync(target);
}

function containedPath(root: string, ...segments: string[]) {
  segments.forEach(requireSafeSegment);
  const target = path.resolve(root, ...segments);
  assertPathContained(root, target);
  return target;
}

function requireProjectSlug(slug: string) {
  if (!/^[a-zA-Z0-9-_]+$/.test(slug)) {
    throw new RuntimeStorageError("RUNTIME_STORAGE_PATH_INVALID");
  }
}

function requireSafeSegment(segment: string) {
  if (
    typeof segment !== "string" ||
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    /[\0\r\n]/.test(segment)
  ) {
    throw new RuntimeStorageError("RUNTIME_STORAGE_PATH_INVALID");
  }
}

export function isPortableRuntimePathSegment(segment: unknown): segment is string {
  return typeof segment === "string" &&
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes("/") &&
    !segment.includes("\\") &&
    !segment.includes(":") &&
    !/[\u0000-\u001f\u007f]/.test(segment) &&
    !/[. ]$/.test(segment) &&
    segment === segment.normalize("NFC") &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment);
}

function requireMachineSegment(segment: string) {
  requireSafeSegment(segment);
  if (!isPortableRuntimePathSegment(segment)) {
    throw new RuntimeStorageError("RUNTIME_STORAGE_PATH_INVALID");
  }
}

function validConfiguredRoot(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    !path.isAbsolute(value) ||
    /[\0\r\n]/.test(value)
  ) return false;
  if (process.platform === "win32") {
    const driveAbsolute = /^[a-zA-Z]:[\\/]/.test(value);
    const uncAbsolute = /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value);
    if (!driveAbsolute && !uncAbsolute) return false;
  }
  return true;
}

function canonicalAbsolutePath(value: string, code: RuntimeStorageErrorCode) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) {
    throw new RuntimeStorageError(code);
  }
  return path.normalize(path.resolve(value));
}

function isOutsideRelative(relative: string) {
  return (
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  );
}

function isPathInsideOrEqual(root: string, candidate: string) {
  if (samePath(root, candidate)) return true;
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !isOutsideRelative(relative);
}

function samePath(left: string, right: string) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function normalizedForIdentity(value: string) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isRuntimeStorageContext(value: RuntimeStorageInput): value is RuntimeStorageContext {
  return isRecord(value) && value.kind === contextKind;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function messageFor(code: RuntimeStorageErrorCode) {
  switch (code) {
    case "RUNTIME_STORAGE_CONFIGURATION_INVALID":
      return "Runtime storage configuration is invalid.";
    case "RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE":
      return "Runtime storage authority conflict detected.";
    case "RUNTIME_STORAGE_LINK_UNSAFE":
      return "Runtime storage link policy rejected the path.";
    case "RUNTIME_STORAGE_AUTHORITY_LOCKED":
      return "Runtime storage authority is locked.";
    case "RUNTIME_STORAGE_AUTHORITY_CLAIM_INVALID":
      return "Runtime storage authority claim is invalid.";
    case "RUNTIME_STORAGE_CONTEXT_INVALID":
      return "Runtime storage context is invalid.";
    case "RUNTIME_STORAGE_OPERATION_CONTEXT_MISMATCH":
      return "Runtime storage operation context does not match.";
    default:
      return "Runtime storage path is invalid.";
  }
}
