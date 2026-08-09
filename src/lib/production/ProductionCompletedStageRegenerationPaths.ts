import path from "node:path";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";

export const regenerationRootName = "production-regeneration" as const;

export function regenerationProjectFolder(
  projectSlug: string,
  context?: RuntimeStorageContext,
) {
  return ProjectReader.getProjectFolder(projectSlug, context ?? {});
}

export function regenerationRoot(projectSlug: string, context?: RuntimeStorageContext) {
  return path.join(regenerationProjectFolder(projectSlug, context), regenerationRootName);
}

export function regenerationDirectory(
  projectSlug: string,
  regenerationId: string,
  context?: RuntimeStorageContext,
) {
  return path.join(regenerationRoot(projectSlug, context), "regenerations", regenerationId);
}
