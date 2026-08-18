import { ExportEngine, type GenerateExportPackageInput } from "./ExportEngine";
import {
  ExportBundleMaterializationError,
  materializeExportBundle,
} from "./ExportBundleMaterializer";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import type { ExportPackageData } from "@/types/export";

export { ExportBundleMaterializationError };

export type PackageExportInput = GenerateExportPackageInput & {
  storageContext?: RuntimeStorageContext;
};

/**
 * Produces the export plan via the existing, unmodified ExportEngine
 * (including its mock-fallback contract for the plan itself), then - only
 * when a real persisted project is present (a non-empty projectSlug that
 * resolves to a real projectId, plus real assembly/thumbnail/audio/youtube
 * stage data) - materializes it into a physical, checksum-verified
 * distribution bundle under data/projects/<slug>/export/bundle/.
 *
 * When projectSlug (or a resolvable projectId) is absent - the ad-hoc
 * inline-body path through app/api/export/route.ts - this returns the plan
 * unchanged. Physical bundling is never forced onto a caller that never had
 * a persisted project to bundle from.
 *
 * Materialization failures are NOT caught here: they propagate to the
 * caller, so a partial/incomplete bundle can never be reported as a
 * successful export (see ExportBundleMaterializer's fail-closed contract).
 */
export async function packageExport(
  input: PackageExportInput,
): Promise<ExportPackageData> {
  const plan = await new ExportEngine().generateExportPackage(input);

  const projectSlug = input.projectSlug;
  const projectId = input.projectId ?? input.project?.id;

  if (!projectSlug || !projectId) {
    return plan;
  }
  if (!input.assembly || !input.thumbnail || !input.audio || !input.youtube) {
    return plan;
  }

  const bundle = await materializeExportBundle({
    projectId,
    projectSlug,
    assembly: input.assembly,
    thumbnail: input.thumbnail,
    audio: input.audio,
    youtube: input.youtube,
    storageContext: input.storageContext,
  });

  return {
    ...plan,
    bundle,
    outputPath: bundle.path ?? plan.outputPath,
    checksum: bundle.manifestChecksum ?? plan.checksum,
  };
}
