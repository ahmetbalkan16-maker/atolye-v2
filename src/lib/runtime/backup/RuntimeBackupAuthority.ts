import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import {
  ensureSafeDirectory,
  validateSafeAncestorChain,
  type RuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";

export const runtimeAuthoritySchemaVersion = "runtime-authority-v1" as const;
export const runtimeBackupStorageAuthoritySchemaVersion =
  "runtime-backup-storage-authority-v1" as const;
export const runtimeBackupRootEnvironmentVariable = "ATOLYE_RUNTIME_BACKUP_ROOT" as const;

export interface RuntimeBackupStorageAuthority {
  readonly schemaVersion: typeof runtimeBackupStorageAuthoritySchemaVersion;
  readonly runtimeAuthorityId: string;
  readonly canonicalBackupRoot: string;
  readonly context: RuntimeStorageContext;
}

const trustedAuthorities = new WeakSet<object>();
const authorityMarkerName = "runtime-backup-authority-v1.json";

export function bootstrapRuntimeBackupStorageAuthority(
  context: RuntimeStorageContext,
): RuntimeBackupStorageAuthority {
  const configured = process.env[runtimeBackupRootEnvironmentVariable];
  const backupRoot = configured === undefined
    ? defaultBackupRoot(context)
    : canonicalBackupRoot(configured);
  return bootstrap(context, backupRoot);
}

/** Dedicated operation-owned test bootstrap; never use with production roots. */
export function bootstrapTestRuntimeBackupStorageAuthority(
  context: RuntimeStorageContext,
  backupRoot: string,
): RuntimeBackupStorageAuthority {
  if (process.env.NODE_ENV === "production") throw authorityInvalid();
  const canonical = canonicalBackupRoot(backupRoot);
  for (const target of [canonical, context.runtimeRoot, context.authorityRoot]) {
    if (!inside(path.resolve(os.tmpdir()), path.resolve(target))) throw authorityInvalid();
  }
  return bootstrap(context, canonical);
}

export function assertTrustedRuntimeBackupStorageAuthority(
  value: unknown,
): asserts value is RuntimeBackupStorageAuthority {
  const candidate = value as Partial<RuntimeBackupStorageAuthority> | null;
  if (
    typeof value !== "object" || value === null ||
    !trustedAuthorities.has(value) ||
    candidate?.context === undefined ||
    !validRuntimeAuthorityId(candidate.runtimeAuthorityId) ||
    candidate.schemaVersion !== runtimeBackupStorageAuthoritySchemaVersion ||
    readMarker(path.join(candidate.context.authorityRoot, authorityMarkerName)) !==
      candidate.runtimeAuthorityId ||
    canonicalBackupRoot(candidate.canonicalBackupRoot ?? "") !== candidate.canonicalBackupRoot
  ) throw new Error("Runtime backup storage authority is invalid.");
}

function bootstrap(context: RuntimeStorageContext, backupRoot: string) {
  const runtimeAuthorityId = readOrCreateRuntimeAuthorityId(context);
  const authority = Object.freeze({
    schemaVersion: runtimeBackupStorageAuthoritySchemaVersion,
    runtimeAuthorityId,
    canonicalBackupRoot: backupRoot,
    context,
  });
  trustedAuthorities.add(authority);
  return authority;
}

function readOrCreateRuntimeAuthorityId(context: RuntimeStorageContext) {
  ensureSafeDirectory(context.authorityRoot);
  const marker = path.join(context.authorityRoot, authorityMarkerName);
  if (!fs.existsSync(marker)) {
    const runtimeAuthorityId = `ra-${randomBytes(24).toString("hex")}`;
    const serialized = serializeMarker(runtimeAuthorityId);
    try {
      fs.writeFileSync(marker, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return runtimeAuthorityId;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) ||
        (error as NodeJS.ErrnoException).code !== "EEXIST") throw authorityInvalid();
    }
  }
  return readMarker(marker);
}

function readMarker(marker: string) {
  try {
    const stat = fs.lstatSync(marker);
    const real = fs.realpathSync(marker);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > 512 ||
      !samePath(real, marker)) throw authorityInvalid();
    const serialized = fs.readFileSync(marker, "utf8");
    const value = JSON.parse(serialized) as Record<string, unknown>;
    if (
      Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== 2 ||
      value.schemaVersion !== runtimeAuthoritySchemaVersion ||
      !validRuntimeAuthorityId(value.runtimeAuthorityId) ||
      serialized !== serializeMarker(value.runtimeAuthorityId)
    ) throw authorityInvalid();
    return value.runtimeAuthorityId;
  } catch {
    throw authorityInvalid();
  }
}

function serializeMarker(runtimeAuthorityId: string) {
  return `${JSON.stringify({
    schemaVersion: runtimeAuthoritySchemaVersion,
    runtimeAuthorityId,
  }, null, 2)}\n`;
}

function validRuntimeAuthorityId(value: unknown): value is string {
  return typeof value === "string" && /^ra-[a-f0-9]{48}$/.test(value);
}

function defaultBackupRoot(context: RuntimeStorageContext) {
  return canonicalBackupRoot(path.join(
    path.dirname(context.authorityRoot),
    `${path.basename(context.authorityRoot)}-runtime-backups-v1`,
  ));
}

function canonicalBackupRoot(value: string) {
  if (typeof value !== "string" || value !== value.trim() || !path.isAbsolute(value) ||
    /[\0\r\n]/.test(value)) throw authorityInvalid();
  const canonical = path.resolve(value);
  if (samePath(canonical, path.parse(canonical).root)) throw authorityInvalid();
  validateSafeAncestorChain(canonical);
  if (fs.existsSync(canonical)) {
    const stat = fs.lstatSync(canonical);
    const real = fs.realpathSync(canonical);
    if (stat.isSymbolicLink() || !stat.isDirectory() || !samePath(real, canonical)) {
      throw authorityInvalid();
    }
    return real;
  }
  return canonical;
}

function samePath(left: string, right: string) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

function authorityInvalid() {
  return new Error("Runtime backup authority is invalid.");
}
