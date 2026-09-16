import { runAyasBoundedMutationWithValidators } from "./AyasMutationRegistry";
import type { AyasMutationImplementation } from "./AyasMutationRegistry";
import { createAyasSmokeTestValidator } from "./AyasMutationValidators";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "./AyasPatchArtifact";
import type { AyasInboxProposal } from "./AyasApprovalInboxStore";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "./AyasNovelPatchDiscovery";

/**
 * M17 — the one, generic resolution path for every `mutationKind:
 * "patch-artifact:v1"` proposal. Unlike `AyasMutationRegistry`'s static
 * `Map` (whose `exactFiles` is fixed per entry, reviewed at author time),
 * a patch-artifact proposal's content varies per artifact — so instead of
 * a registry lookup, this re-derives the frozen artifact from durable
 * storage and cross-checks every binding (`patchHash`, `baseHead`,
 * `exactFiles`, safety) before ever returning something Package C can run.
 * `AyasProposalExecutionService` calls this INSTEAD of `resolveAyasMutation`
 * only when `proposal.mutationKind === AYAS_PATCH_ARTIFACT_MUTATION_KIND` —
 * every other mutationKind keeps using the static registry, completely
 * unchanged. Same downstream authority: `daemon.executeApproved()` remains
 * the sole reservation/journal/gate/finalization authority either way.
 */
export class AyasPatchArtifactMutationError extends Error {
  constructor(readonly code:
    | "AYAS_PATCH_ARTIFACT_MUTATION_NOT_REFERENCED"
    | "AYAS_PATCH_ARTIFACT_MUTATION_HASH_MISMATCH"
    | "AYAS_PATCH_ARTIFACT_MUTATION_HEAD_MISMATCH"
    | "AYAS_PATCH_ARTIFACT_MUTATION_SCOPE_MISMATCH"
    | "AYAS_PATCH_ARTIFACT_MUTATION_UNSAFE", message: string) {
    super(message);
    this.name = "AyasPatchArtifactMutationError";
    this.stack = undefined;
  }
}

function sameOrderedFiles(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function resolveAyasPatchArtifactMutation(proposal: AyasInboxProposal, store?: AyasPatchArtifactStore): AyasMutationImplementation {
  if (proposal.mutationKind !== AYAS_PATCH_ARTIFACT_MUTATION_KIND) {
    throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_NOT_REFERENCED", `not a patch-artifact proposal: ${proposal.mutationKind ?? "(none)"}`);
  }
  if (!proposal.patchArtifactId || !proposal.patchHash) {
    throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_NOT_REFERENCED", "proposal is missing patchArtifactId/patchHash");
  }
  const artifactStore = store ?? createAyasPatchArtifactStore();
  // `loadVerified` already re-derives the artifact's own hash from its own
  // content and throws on tamper/corruption — this is the SECOND, independent
  // check that the proposal's recorded `patchHash` still matches that
  // artifact, so neither the artifact file nor the proposal record can be
  // swapped without detection.
  const artifact = artifactStore.loadVerified(proposal.patchArtifactId);
  if (artifact.patchHash !== proposal.patchHash) {
    throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_HASH_MISMATCH", "artifact patchHash does not match the proposal's recorded patchHash");
  }
  if (artifact.baseHead !== proposal.baseHead) {
    throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_HEAD_MISMATCH", "artifact baseHead does not match the proposal's baseHead");
  }
  if (!sameOrderedFiles(artifact.exactFiles, proposal.exactFiles)) {
    throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_SCOPE_MISMATCH", "artifact exactFiles does not match the proposal's exactFiles");
  }
  if (artifact.safetyClassification !== "SAFE") {
    throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_UNSAFE", `artifact safety classification is not SAFE: ${artifact.safetyClassification}`);
  }
  return {
    exactFiles: artifact.exactFiles,
    run: (repoRoot: string) => runAyasBoundedMutationWithValidators(
      repoRoot,
      artifact.allowedRoots,
      artifact.replacements,
      artifact.validatorScripts.map((script) => createAyasSmokeTestValidator(script)),
    ),
  };
}
