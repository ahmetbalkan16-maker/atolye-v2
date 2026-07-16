import path from "node:path";
import { RuntimeMutationError } from "./RuntimeMutationError";

export const runtimePortablePathPolicyVersion = "windows-portable-path-v1" as const;
export const runtimePortablePathLimits = Object.freeze({
  segmentUtf16: 120,
  segmentUtf8: 180,
  logicalPathUtf16: 180,
  logicalPathUtf8: 240,
  projectSlugUtf16: 100,
  projectSlugUtf8: 150,
  fileNameUtf16: 96,
  fileNameUtf8: 144,
  mutationRelativeUtf16: 220,
  mutationRelativeUtf8: 300,
  materializedPathUtf16: 240,
});

const reservedWindowsNames = /^(?:con|prn|aux|nul|com(?:[1-9]|[¹²³])|lpt(?:[1-9]|[¹²³]))(?:\..*)?$/i;
const controlCharacters = /[\u0000-\u001f\u007f]/;

export function validateRuntimeLogicalPath(value: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    value !== value.normalize("NFC") ||
    controlCharacters.test(value) ||
    value.length > runtimePortablePathLimits.logicalPathUtf16 ||
    utf8Length(value) > runtimePortablePathLimits.logicalPathUtf8
  ) throw invalidPath();

  const segments = value.split("/");
  if (segments.some((segment) => !isPortableRuntimeSegment(segment))) {
    throw invalidPath();
  }
  const slug = segments[0];
  const fileName = segments.at(-1) ?? "";
  if (
    slug.length > runtimePortablePathLimits.projectSlugUtf16 ||
    utf8Length(slug) > runtimePortablePathLimits.projectSlugUtf8 ||
    fileName.length > runtimePortablePathLimits.fileNameUtf16 ||
    utf8Length(fileName) > runtimePortablePathLimits.fileNameUtf8
  ) throw invalidPath();
  return value;
}

export function isPortableRuntimeSegment(value: string): boolean {
  return Boolean(value) &&
    value !== "." &&
    value !== ".." &&
    value === value.normalize("NFC") &&
    !value.includes(":") &&
    !controlCharacters.test(value) &&
    !/[. ]$/.test(value) &&
    !reservedWindowsNames.test(value) &&
    value.length <= runtimePortablePathLimits.segmentUtf16 &&
    utf8Length(value) <= runtimePortablePathLimits.segmentUtf8;
}

export function runtimePortableCollisionKey(value: string): string {
  validateRuntimeLogicalPath(value);
  return value.normalize("NFC").toUpperCase();
}

export function assertNoRuntimePathCollisions(values: readonly string[]): void {
  const keys = new Set<string>();
  for (const value of values) {
    const key = runtimePortableCollisionKey(value);
    if (keys.has(key)) throw invalidPath();
    keys.add(key);
  }
}

export function assertRuntimeMaterializedPath(
  root: string,
  logicalRelativePath: string,
): string {
  validateRuntimeLogicalPath(logicalRelativePath);
  const target = path.resolve(root, ...logicalRelativePath.split("/"));
  if (target.length > runtimePortablePathLimits.materializedPathUtf16) {
    throw invalidPath();
  }
  return target;
}

export function validateMutationRelativePath(
  value: string,
  materializationRoot?: string,
): readonly string[] {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    value !== value.normalize("NFC") ||
    controlCharacters.test(value) ||
    value.length > runtimePortablePathLimits.mutationRelativeUtf16 ||
    utf8Length(value) > runtimePortablePathLimits.mutationRelativeUtf8
  ) throw invalidPath();
  const segments = value.split("/");
  if (segments.some((segment) => !isPortableRuntimeSegment(segment))) {
    throw invalidPath();
  }
  const firstSegment = segments[0] ?? "";
  const fileName = segments.at(-1) ?? "";
  if (
    firstSegment.length > runtimePortablePathLimits.projectSlugUtf16 ||
    utf8Length(firstSegment) > runtimePortablePathLimits.projectSlugUtf8 ||
    fileName.length > runtimePortablePathLimits.fileNameUtf16 ||
    utf8Length(fileName) > runtimePortablePathLimits.fileNameUtf8
  ) throw invalidPath();
  if (materializationRoot) {
    const target = path.resolve(materializationRoot, ...segments);
    if (target.length > runtimePortablePathLimits.materializedPathUtf16) throw invalidPath();
  }
  return segments;
}

function utf8Length(value: string) {
  return Buffer.byteLength(value, "utf8");
}

function invalidPath() {
  return new RuntimeMutationError("RUNTIME_MUTATION_PATH_INVALID");
}
