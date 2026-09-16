import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { classifyPatchSet } from "../selfheal/BrainPatchSafety";
import type { AyasDaemonCandidate, AyasDaemonObservation } from "./AyasAutonomyDaemon";
import { findAyasErrorCodeContractGaps, generateAyasErrorCodeContractPatch, checkAyasNovelPatchLimits, runAyasDiscoveryFindings, type AyasDiscoveryFinding } from "./AyasPatchDetectors";
import { createAyasPatchSandbox, applyAyasPatchReplacementsInSandbox, runAyasPatchSandboxValidators, captureAyasPatchSandboxDiff, destroyAyasPatchSandbox } from "./AyasPatchSandbox";
import { createAyasPatchArtifactStore, computeAyasPatchHash, type AyasPatchArtifact } from "./AyasPatchArtifact";

/** The one static, reviewed mutationKind every patch-artifact-backed proposal uses — see `AyasPatchArtifactMutation.ts`. Never a per-candidate string; the artifact itself, not the mutationKind, carries the specific content identity. */
export const AYAS_PATCH_ARTIFACT_MUTATION_KIND = "patch-artifact:v1" as const;

export interface AyasNovelPatchCandidate extends AyasDaemonCandidate {
  readonly patchArtifactId: string;
  readonly patchHash: string;
}

export interface AyasNovelPatchRejection {
  readonly candidateId: string;
  readonly reason: string;
}

export interface AyasNovelPatchDiscoveryResult {
  readonly candidates: readonly AyasNovelPatchCandidate[];
  readonly rejections: readonly AyasNovelPatchRejection[];
  readonly findings: readonly AyasDiscoveryFinding[];
}

export interface AyasNovelPatchDiscoveryDeps {
  readonly repoRoot: string;
  readonly observation: AyasDaemonObservation;
  readonly artifactStore?: ReturnType<typeof createAyasPatchArtifactStore>;
  /** Bounded retry budget — at most this many gap candidates are drafted-and-sandbox-validated per tick (server-owned, never proposal-configurable). Each attempt is a genuinely different candidate, never a re-attempt of identical failing content. */
  readonly maxAttemptsPerTick?: number;
}

function writeRejectionLog(repoRoot: string, rejection: AyasNovelPatchRejection & { readonly at: string }): void {
  try {
    const dir = path.join(repoRoot, "data", "brain", "self-improvement", "patch-artifacts", "rejected");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${rejection.candidateId}-${crypto.randomUUID()}.json`), `${JSON.stringify(rejection, null, 2)}\n`, "utf8");
  } catch { /* best-effort audit trail only — never blocks discovery */ }
}

/**
 * Orchestrates M17's sandboxed drafting pipeline for exactly one discovery
 * class today (`error-code-contract-gap`): detect → generate content
 * (pure, in-memory) → policy limits → isolated `git worktree` sandbox →
 * apply → validate (`tsc --noEmit` + the new smoke test itself) → on PASS,
 * freeze an immutable artifact and return one `AyasDaemonCandidate`; on
 * FAIL, log a rejection and try the next candidate (bounded). Never
 * touches the real working tree, never stages/commits/pushes, never opens
 * an execution gate, never reserves or executes anything. The other four
 * discovery classes (`runAyasDiscoveryFindings`) run alongside and are
 * surfaced as informational evidence only — no generator is registered for
 * them yet (see `AyasPatchDetectors.ts`'s own module doc).
 */
export async function discoverAyasNovelPatchCandidates(deps: AyasNovelPatchDiscoveryDeps): Promise<AyasNovelPatchDiscoveryResult> {
  const { repoRoot, observation } = deps;
  const maxAttempts = deps.maxAttemptsPerTick ?? 2;
  const artifactStore = deps.artifactStore ?? createAyasPatchArtifactStore({ rootDir: path.join(repoRoot, "data", "brain", "self-improvement", "patch-artifacts") });
  const findings = runAyasDiscoveryFindings(repoRoot);

  if (!observation.repoClean || observation.machineAction === "PAUSE" || observation.machineAction === "STOP OWN WORKLOAD") {
    return { candidates: [], rejections: [], findings };
  }

  const gaps = findAyasErrorCodeContractGaps(repoRoot).filter((gap) => {
    const patch = generateAyasErrorCodeContractPatch(gap);
    return !fs.existsSync(path.join(repoRoot, patch.exactFiles[0]!));
  });

  const candidates: AyasNovelPatchCandidate[] = [];
  const rejections: AyasNovelPatchRejection[] = [];

  for (const gap of gaps.slice(0, maxAttempts)) {
    const generated = generateAyasErrorCodeContractPatch(gap);
    const limitViolations = checkAyasNovelPatchLimits(generated.replacements);
    if (limitViolations.length > 0) {
      const reason = `blast-radius/domain policy: ${limitViolations.map((v) => `${v.rule}: ${v.detail}`).join("; ")}`;
      rejections.push({ candidateId: generated.candidateId, reason });
      writeRejectionLog(repoRoot, { candidateId: generated.candidateId, reason, at: observation.now });
      continue;
    }

    const sandbox = await createAyasPatchSandbox(repoRoot, observation.head).catch((error) => {
      rejections.push({ candidateId: generated.candidateId, reason: `sandbox create failed: ${error instanceof Error ? error.message : String(error)}` });
      return null;
    });
    if (!sandbox) continue;

    let validatorResults: Awaited<ReturnType<typeof runAyasPatchSandboxValidators>>;
    try {
      await applyAyasPatchReplacementsInSandbox(sandbox, ["scripts/"], generated.replacements);
      // runAyasValidators (via runAyasPatchSandboxValidators) is fail-fast: a
      // failing validator THROWS (AyasValidatorFailedError), it never returns
      // an array containing a failing entry. This must be caught here, not
      // pattern-matched on the return value — an uncaught throw would abort
      // discovery for the whole tick instead of just rejecting this one
      // candidate and trying the next.
      validatorResults = await runAyasPatchSandboxValidators(sandbox, generated.validatorScripts);
    } catch (error) {
      const reason = error instanceof Error ? `sandbox validation failed: ${error.message}` : `sandbox validation failed: ${String(error)}`;
      rejections.push({ candidateId: generated.candidateId, reason });
      writeRejectionLog(repoRoot, { candidateId: generated.candidateId, reason, at: observation.now });
      await destroyAyasPatchSandbox(sandbox);
      continue;
    }

    try {
      const diff = await captureAyasPatchSandboxDiff(sandbox);
      const safety = classifyPatchSet(generated.exactFiles);
      const artifactInput: Omit<AyasPatchArtifact, "schemaVersion" | "patchHash"> = {
        artifactId: `ayas-patch-artifact-${crypto.randomUUID()}`,
        candidateId: generated.candidateId,
        generatorIdentity: generated.generatorIdentity,
        baseBranch: observation.branch,
        baseHead: observation.head,
        exactFiles: generated.exactFiles,
        allowedRoots: ["scripts/"],
        replacements: generated.replacements,
        validatorScripts: generated.validatorScripts,
        graphifyEvidence: generated.graphifyEvidence,
        safetyClassification: safety.level,
        problemStatement: generated.currentProblem,
        rationale: generated.rationale,
        expectedUserBenefit: generated.expectedUserBenefit,
        expectedBehaviorChange: generated.expectedBehaviorChange,
        unchangedBehavior: generated.unchangedBehavior,
        risk: generated.riskIfNotDone,
        productionImpact: generated.productionImpact,
        sandboxValidationSummary: validatorResults.map((r) => `${r.validator}: ${r.pass ? "PASS" : "FAIL"} — ${r.summary}`),
        generatedAt: observation.now,
      };
      const artifact = artifactStore.freeze(artifactInput);

      candidates.push({
        objective: generated.objective,
        currentProblem: generated.currentProblem,
        selectionReason: generated.selectionReason,
        expectedUserBenefit: generated.expectedUserBenefit,
        expectedBehaviorChange: generated.expectedBehaviorChange,
        unchangedBehavior: generated.unchangedBehavior,
        riskIfNotDone: generated.riskIfNotDone,
        technicalRisk: generated.technicalRisk,
        productionImpact: generated.productionImpact,
        rationale: generated.rationale,
        evidence: [...generated.evidence, `sandbox diff (${diff.split("\n").length} lines): validated in isolated git worktree at ${observation.head}`],
        graphifyEvidence: generated.graphifyEvidence,
        exactFiles: generated.exactFiles,
        expectedDiffScope: generated.expectedDiffScope,
        testsPlanned: generated.validatorScripts,
        risk: generated.riskIfNotDone,
        rank: 1,
        mutationKind: AYAS_PATCH_ARTIFACT_MUTATION_KIND,
        patchArtifactId: artifact.artifactId,
        patchHash: artifact.patchHash,
      });
      break; // one frozen, sandbox-validated novel candidate per tick is enough — bounded proposal volume (Phase 18).
    } finally {
      await destroyAyasPatchSandbox(sandbox);
    }
  }

  return { candidates, rejections, findings };
}

export { computeAyasPatchHash };
