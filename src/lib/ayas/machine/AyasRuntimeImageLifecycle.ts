/** Read-only dependency classification. No CLI, deletion, prune, registry mutation or authority. */
export const AYAS_RUNTIME_IMAGE_CLASSES = ["REFERENCED_REQUIRED", "REBUILDABLE_REQUIRED", "STALE_REBUILDABLE", "RECLAIMABLE", "UNKNOWN"] as const;
export type AyasRuntimeImageClass = typeof AYAS_RUNTIME_IMAGE_CLASSES[number];
export interface AyasRuntimeImageFacts {
  readonly contentId: string;
  readonly managedByAyas: boolean | null;
  readonly currentRuntimeRequired: boolean | null;
  readonly dependentContainerCount: number | null;
  /** Complete union of all current/historical qualification, provenance, rollback and durable task dependencies. */
  readonly evidenceReferences: readonly { readonly purpose: "QUALIFICATION" | "PROVENANCE" | "ROLLBACK" | "DURABLE_TASK"; readonly digest: string }[] | null;
  readonly dependencyInventoryComplete: boolean;
  /** Verified recipe and locally verified pinned input bytes; a tag or reproducibility claim is insufficient. */
  readonly rebuild: { readonly recipeDigest: string; readonly pinnedInputsVerified: boolean } | null;
}
export function classifyAyasRuntimeImage(value: AyasRuntimeImageFacts): Readonly<{ class: AyasRuntimeImageClass; cleanupEligible: boolean; authority: "NONE"; reason: string }> {
  const give = (kind: AyasRuntimeImageClass, reason: string) => Object.freeze({ class: kind, cleanupEligible: kind === "RECLAIMABLE", authority: "NONE" as const, reason });
  const hex = /^[a-f0-9]{64}$/;
  if (!value || !/^sha256:[a-f0-9]{64}$/.test(value.contentId) || ![value.managedByAyas, value.currentRuntimeRequired].every(v => v === null || typeof v === "boolean")
    || typeof value.dependencyInventoryComplete !== "boolean" || value.dependentContainerCount !== null && (!Number.isSafeInteger(value.dependentContainerCount) || value.dependentContainerCount < 0)
    || value.evidenceReferences !== null && (!Array.isArray(value.evidenceReferences) || value.evidenceReferences.length > 10_000 || !Array.from(value.evidenceReferences).every(r => r && ["QUALIFICATION", "PROVENANCE", "ROLLBACK", "DURABLE_TASK"].includes(r.purpose) && hex.test(r.digest)))
    || value.rebuild !== null && (!value.rebuild || !hex.test(value.rebuild.recipeDigest) || typeof value.rebuild.pinnedInputsVerified !== "boolean")) return give("UNKNOWN", "INVALID_OR_UNMEASURED_IDENTITY");
  // Any known protected dependency wins even when the rest of the inventory is incomplete.
  if ((value.evidenceReferences?.length ?? 0) > 0 || (value.dependentContainerCount ?? 0) > 0) return give("REFERENCED_REQUIRED", "PROTECTED_DEPENDENCY");
  if (!value.dependencyInventoryComplete || value.evidenceReferences === null || value.dependentContainerCount === null || value.managedByAyas !== true || value.currentRuntimeRequired === null) return give("UNKNOWN", "INCOMPLETE_DEPENDENCIES_OR_FOREIGN_IMAGE");
  const reproducible = value.rebuild !== null && value.rebuild.pinnedInputsVerified;
  if (value.currentRuntimeRequired) return give(reproducible ? "REBUILDABLE_REQUIRED" : "REFERENCED_REQUIRED", "CURRENT_RUNTIME_REQUIRED");
  if (reproducible) return give("STALE_REBUILDABLE", "VERIFIED_REBUILD_KEEP_UNTIL_REVIEWED");
  return give("RECLAIMABLE", "COMPLETE_UNUSED_AYAS_IMAGE_ONLY");
}
