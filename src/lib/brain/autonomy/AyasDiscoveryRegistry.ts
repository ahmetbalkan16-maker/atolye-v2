import type { AyasDaemonCandidate, AyasDaemonObservation } from "./AyasAutonomyDaemon";
import { isAyasMutationKindRegistered, type AyasMutationImplementation } from "./AyasMutationRegistry";

/**
 * M16 — closed, server-owned, continuous-discovery candidate registry.
 *
 * Every entry pairs a fully-authored `AyasDaemonCandidate` (identical shape
 * to what a human would hand `AyasAutonomyDaemon.discover()` via
 * `scripts/ayas-propose.ts`) with a deterministic, read-only `isApplicable`
 * detector. A detector may only read the repo/observation it is given — it
 * never reads proposal text, never calls a model, never writes anything,
 * and a throwing detector is treated as "not applicable" (fail closed, not
 * fail open). `discoverAyasSafeCandidates` is the ONLY function this module
 * exposes for production use, and it does nothing but filter this static
 * list down to `AyasDaemonCandidate[]` — the actual proposal (and its
 * dedup) is still minted exclusively by the existing, unmodified
 * `AyasAutonomyDaemon.discover()`. This module never imports
 * `AyasApprovalInboxStore`, `AyasExecutionGateStore`, `AyasAutonomyDaemon`'s
 * `decide`/`executeApproved`, or any mutation `run()` — it is structurally
 * incapable of approving, reserving, executing, or opening a gate.
 */
export interface AyasDiscoveryContext {
  readonly repoRoot: string;
  readonly observation: AyasDaemonObservation;
}

export type AyasDiscoveryDetector = (context: AyasDiscoveryContext) => boolean;

export interface AyasDiscoverySource {
  readonly candidate: AyasDaemonCandidate;
  readonly isApplicable: AyasDiscoveryDetector;
}

/**
 * Deliberately empty at M16: this registry ships the discovery MECHANISM
 * (wiring, authority-boundary proofs, tests). Each future entry is added as
 * its own separate, reviewed, source-driven change — never populated
 * dynamically, never derived from an LLM or from proposal text.
 */
export const AYAS_DISCOVERY_SOURCES: readonly AyasDiscoverySource[] = [];

/** `mutationRegistry` defaults to the one real, closed mutation registry; tests pass their own isolated map instead of ever depending on production registrations. */
export function discoverAyasSafeCandidates(
  context: AyasDiscoveryContext,
  sources: readonly AyasDiscoverySource[] = AYAS_DISCOVERY_SOURCES,
  mutationRegistry?: ReadonlyMap<string, AyasMutationImplementation>,
): readonly AyasDaemonCandidate[] {
  return sources
    .filter((source) => mutationRegistry ? isAyasMutationKindRegistered(source.candidate.mutationKind, mutationRegistry) : isAyasMutationKindRegistered(source.candidate.mutationKind))
    .filter((source) => {
      try {
        return source.isApplicable(context);
      } catch {
        return false;
      }
    })
    .map((source) => source.candidate);
}
