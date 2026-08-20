import path from "node:path";
import {
  isPortableRuntimeSegment,
  runtimePortablePathLimits,
  validateRuntimeLogicalPath,
} from "@/lib/runtime/security/RuntimePathPolicy";
import { RuntimeMutationError } from "@/lib/runtime/security/RuntimeMutationError";

export const runtimeBackupPathPolicyVersionV1 = "runtime-backup-relative-path-v1" as const;
export const runtimeBackupPathPolicyVersionV2 = "runtime-backup-relative-path-v2" as const;
export const runtimeBackupPathPolicyVersionV3 = "runtime-backup-relative-path-v3" as const;
export const runtimeBackupPathPolicyVersion = runtimeBackupPathPolicyVersionV3;

export type RuntimeBackupPathPolicyVersion =
  | typeof runtimeBackupPathPolicyVersionV1
  | typeof runtimeBackupPathPolicyVersionV2
  | typeof runtimeBackupPathPolicyVersionV3;

export const runtimeBackupPathLimits = Object.freeze({
  relativePathUtf16: 220,
  relativePathUtf8: 300,
  mutationRelativeUtf16: 237,
  mutationRelativeUtf8: 317,
  materializedPathUtf16: 259,
});

const controlCharacters = /[\u0000-\u001f\u007f]/;

export function validateRuntimeBackupRelativePath(
  value: string,
  policyVersion: RuntimeBackupPathPolicyVersion = runtimeBackupPathPolicyVersion,
): string {
  if (policyVersion === runtimeBackupPathPolicyVersionV1) {
    return validateRuntimeLogicalPath(value);
  }
  if (
    policyVersion !== runtimeBackupPathPolicyVersionV2 &&
    policyVersion !== runtimeBackupPathPolicyVersionV3
  ) throw invalidPath();
  const segments = validateV2Segments(value);
  const slug = segments[0] ?? "";
  const fileName = segments.at(-1) ?? "";
  if (
    slug.length > runtimePortablePathLimits.projectSlugUtf16 ||
    utf8Length(slug) > runtimePortablePathLimits.projectSlugUtf8 ||
    fileName.length > runtimePortablePathLimits.fileNameUtf16 ||
    utf8Length(fileName) > runtimePortablePathLimits.fileNameUtf8
  ) throw invalidPath();
  return value;
}

export function runtimeBackupPortableCollisionKey(
  value: string,
  policyVersion: RuntimeBackupPathPolicyVersion = runtimeBackupPathPolicyVersion,
): string {
  validateRuntimeBackupRelativePath(value, policyVersion);
  return value.normalize("NFC").toUpperCase();
}

export function validateRuntimeBackupMutationRelativePath(
  value: string,
  materializationRoot?: string,
): readonly string[] {
  const segments = validateV2Segments(
    value,
    runtimeBackupPathLimits.mutationRelativeUtf16,
    runtimeBackupPathLimits.mutationRelativeUtf8,
  );
  const firstSegment = segments[0] ?? "";
  const fileName = segments.at(-1) ?? "";
  if (
    firstSegment.length > runtimePortablePathLimits.projectSlugUtf16 ||
    utf8Length(firstSegment) > runtimePortablePathLimits.projectSlugUtf8 ||
    fileName.length > runtimePortablePathLimits.fileNameUtf16 ||
    utf8Length(fileName) > runtimePortablePathLimits.fileNameUtf8
  ) throw invalidPath();
  if (materializationRoot) {
    assertRuntimeBackupMaterializedPath(materializationRoot, value);
  }
  return segments;
}

export function assertRuntimeBackupMaterializedPath(
  root: string,
  relativePath: string,
): string {
  const segments = validateV2Segments(
    relativePath,
    runtimeBackupPathLimits.mutationRelativeUtf16,
    runtimeBackupPathLimits.mutationRelativeUtf8,
  );
  const target = path.resolve(root, ...segments);
  if (target.length > runtimeBackupPathLimits.materializedPathUtf16) throw invalidPath();
  return target;
}

function validateV2Segments(
  value: string,
  maximumUtf16: number = runtimeBackupPathLimits.relativePathUtf16,
  maximumUtf8: number = runtimeBackupPathLimits.relativePathUtf8,
): readonly string[] {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    value !== value.normalize("NFC") ||
    controlCharacters.test(value) ||
    value.length > maximumUtf16 ||
    utf8Length(value) > maximumUtf8
  ) throw invalidPath();
  const segments = value.split("/");
  if (segments.some((segment) => !isPortableRuntimeSegment(segment))) throw invalidPath();
  return segments;
}

function utf8Length(value: string) {
  return Buffer.byteLength(value, "utf8");
}

function invalidPath() {
  return new RuntimeMutationError("RUNTIME_MUTATION_PATH_INVALID");
}
