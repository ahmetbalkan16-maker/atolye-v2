import fs from "node:fs";
import path from "node:path";
import {
  canonicalJson,
  sha256Bytes,
} from "./ProductionAcceptanceLegacyReauthorization";

export const productionAcceptanceMarkerIdentityPolicyVersion =
  "production-acceptance-marker-identity-v1" as const;

const MAX_MARKER_BYTES = 1024 * 1024;

export interface DescriptorBoundFileSnapshot {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly byteLength: number;
  readonly deviceIdentity: string;
  readonly inodeIdentity: string;
  readonly identityPolicyVersion: typeof productionAcceptanceMarkerIdentityPolicyVersion;
  readonly fileType: "regular-file";
  readonly descriptorIdentity: DescriptorBoundFileIdentity;
  readonly pathnameIdentityBefore: DescriptorBoundFileIdentity;
  readonly pathnameIdentityAfter: DescriptorBoundFileIdentity;
  readonly containmentEvidence: {
    readonly policyVersion: "production-acceptance-file-containment-v1";
    readonly logicalLocator: string;
    readonly contained: true;
  };
}

export interface DescriptorBoundFileIdentity {
  readonly device: bigint;
  readonly inode: bigint;
  readonly size: bigint;
  readonly deviceIdentity: string;
  readonly inodeIdentity: string;
}

export interface CanonicalProductionAcceptanceMarkerDescriptorSnapshot {
  readonly parsedMarker: Record<string, unknown>;
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly byteLength: number;
  readonly deviceIdentity: string;
  readonly inodeIdentity: string;
  readonly identityPolicyVersion: typeof productionAcceptanceMarkerIdentityPolicyVersion;
  readonly fileType: "regular-file";
  readonly descriptorIdentity: DescriptorBoundFileIdentity;
  readonly pathnameIdentityBefore: DescriptorBoundFileIdentity;
  readonly pathnameIdentityAfter: DescriptorBoundFileIdentity;
  readonly containmentEvidence: {
    readonly policyVersion: "production-acceptance-marker-containment-v1";
    readonly logicalLocator: "production-acceptance.json";
    readonly contained: true;
  };
}

export function readCanonicalProductionAcceptanceMarkerDescriptorBound(input: {
  readonly projectFolder: string;
  readonly markerPath?: string;
}): CanonicalProductionAcceptanceMarkerDescriptorSnapshot {
  const markerPath = input.markerPath ?? path.join(input.projectFolder, "production-acceptance.json");
  const generic = readProductionAcceptanceFileDescriptorBound({
    projectFolder: input.projectFolder,
    filePath: markerPath,
    logicalLocator: "production-acceptance.json",
    maxBytes: MAX_MARKER_BYTES,
  });
  if (path.dirname(fs.realpathSync(markerPath)) !== requirePlainDirectory(input.projectFolder)) {
    throw new Error("PRODUCTION_ACCEPTANCE_MARKER_CONTAINMENT_INVALID");
  }
  const parsed = JSON.parse(generic.bytes.toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PRODUCTION_ACCEPTANCE_MARKER_JSON_INVALID");
  }
  return Object.freeze({
    ...generic,
    parsedMarker: parsed as Record<string, unknown>,
    containmentEvidence: Object.freeze({
      policyVersion: "production-acceptance-marker-containment-v1" as const,
      logicalLocator: "production-acceptance.json" as const,
      contained: true as const,
    }),
  });
}

export function readProductionAcceptanceFileDescriptorBound(input: {
  readonly projectFolder: string;
  readonly filePath: string;
  readonly logicalLocator: string;
  readonly maxBytes?: number;
}): DescriptorBoundFileSnapshot {
  const projectReal = requirePlainDirectory(input.projectFolder);
  const resolved = path.resolve(input.filePath);
  const logical = input.logicalLocator.replaceAll("\\", "/");
  if (!logical || logical.startsWith("/") || logical.split("/").some((part) => !part || part === "." || part === "..") ||
    path.resolve(input.projectFolder, ...logical.split("/")) !== resolved || !insideOrEqual(projectReal, fs.realpathSync(resolved))) {
    throw new Error("PRODUCTION_ACCEPTANCE_FILE_CONTAINMENT_INVALID");
  }
  const pathnameBefore = requireRegularPathIdentity(resolved);
  const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow);
  try {
    const descriptorBefore = requireRegularDescriptorIdentity(fs.fstatSync(descriptor, { bigint: true }));
    requireExactIdentity(pathnameBefore, descriptorBefore);
    if (descriptorBefore.size > BigInt(input.maxBytes ?? MAX_MARKER_BYTES)) {
      throw new Error("PRODUCTION_ACCEPTANCE_FILE_TOO_LARGE");
    }
    const bytes = fs.readFileSync(descriptor);
    const descriptorAfter = requireRegularDescriptorIdentity(fs.fstatSync(descriptor, { bigint: true }));
    requireExactIdentity(descriptorBefore, descriptorAfter);
    if (BigInt(bytes.length) !== descriptorBefore.size) {
      throw new Error("PRODUCTION_ACCEPTANCE_MARKER_SHORT_READ");
    }
    const pathnameAfter = requireRegularPathIdentity(resolved);
    requireExactIdentity(descriptorBefore, pathnameAfter);
    if (fs.realpathSync(resolved) !== resolved) throw new Error("PRODUCTION_ACCEPTANCE_FILE_PATH_REPLACED");
    return Object.freeze({
      bytes,
      sha256: sha256Bytes(bytes),
      byteLength: bytes.length,
      deviceIdentity: descriptorBefore.deviceIdentity,
      inodeIdentity: descriptorBefore.inodeIdentity,
      identityPolicyVersion: productionAcceptanceMarkerIdentityPolicyVersion,
      fileType: "regular-file" as const,
      descriptorIdentity: descriptorBefore,
      pathnameIdentityBefore: pathnameBefore,
      pathnameIdentityAfter: pathnameAfter,
      containmentEvidence: Object.freeze({
        policyVersion: "production-acceptance-file-containment-v1" as const,
        logicalLocator: logical,
        contained: true as const,
      }),
    });
  } finally {
    fs.closeSync(descriptor);
  }
}

function insideOrEqual(directory: string, candidate: string) {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function normalizedFilesystemIdentity(
  kind: "device" | "inode",
  value: bigint,
): string {
  if (value <= BigInt(0)) throw new Error("PRODUCTION_ACCEPTANCE_FILESYSTEM_IDENTITY_INVALID");
  return sha256Bytes(canonicalJson({
    policyVersion: productionAcceptanceMarkerIdentityPolicyVersion,
    kind,
    unsignedDecimalValue: value.toString(10),
  }));
}

function requirePlainDirectory(directory: string): string {
  const link = fs.lstatSync(directory, { bigint: true });
  if (!link.isDirectory() || link.isSymbolicLink()) throw new Error("invalid-directory");
  return fs.realpathSync(directory);
}

function requireRegularPathIdentity(filePath: string): DescriptorBoundFileIdentity {
  const stat = fs.lstatSync(filePath, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("invalid-marker-path");
  return identity(stat);
}

function requireRegularDescriptorIdentity(stat: fs.BigIntStats): DescriptorBoundFileIdentity {
  if (!stat.isFile()) throw new Error("invalid-marker-descriptor");
  return identity(stat);
}

function identity(stat: fs.BigIntStats): DescriptorBoundFileIdentity {
  if (stat.dev <= BigInt(0) || stat.ino <= BigInt(0) || stat.size < BigInt(0)) {
    throw new Error("invalid-identity");
  }
  return Object.freeze({
    device: stat.dev,
    inode: stat.ino,
    size: stat.size,
    deviceIdentity: normalizedFilesystemIdentity("device", stat.dev),
    inodeIdentity: normalizedFilesystemIdentity("inode", stat.ino),
  });
}

function requireExactIdentity(left: DescriptorBoundFileIdentity, right: DescriptorBoundFileIdentity) {
  if (left.device !== right.device || left.inode !== right.inode || left.size !== right.size) {
    throw new Error("PRODUCTION_ACCEPTANCE_MARKER_CONCURRENT_CHANGE");
  }
}
