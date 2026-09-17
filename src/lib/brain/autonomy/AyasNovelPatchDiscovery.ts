import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { classifyPatchSet } from "../selfheal/BrainPatchSafety";
import type { AyasDaemonCandidate, AyasDaemonObservation } from "./AyasAutonomyDaemon";
import { AYAS_GENERATOR_SOURCES, checkAyasNovelPatchLimits, runAyasDiscoveryFindings, type AyasDiscoveryFinding, type AyasGeneratedNovelPatch } from "./AyasPatchDetectors";
import { classifyAyasMicroCandidate } from "./AyasMicroClassifier";
import { createAyasPatchSandbox, applyAyasPatchReplacementsInSandbox, runAyasPatchSandboxValidators, captureAyasPatchSandboxDiff, destroyAyasPatchSandbox } from "./AyasPatchSandbox";
import { createAyasPatchArtifactStore, computeAyasPatchHash, type AyasPatchArtifact } from "./AyasPatchArtifact";
import { createAyasSandboxUnvalidatableStore, contentFingerprintOf, type AyasSandboxUnvalidatableStore } from "./AyasSandboxUnvalidatableStore";

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
  readonly sandboxUnvalidatableStore?: AyasSandboxUnvalidatableStore;
}

function writeRejectionLog(repoRoot: string, rejection: AyasNovelPatchRejection & { readonly at: string }): void {
  try {
    const dir = path.join(repoRoot, "data", "brain", "self-improvement", "patch-artifacts", "rejected");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${rejection.candidateId}-${crypto.randomUUID()}.json`), `${JSON.stringify(rejection, null, 2)}\n`, "utf8");
  } catch { /* best-effort audit trail only — never blocks discovery */ }
}

/**
 * Deterministic round-robin over every registered generator source
 * (M19.4 — "batch diversity"): pulls one candidate from each source in turn
 * until every source is exhausted, so a tick's bounded attempt budget is
 * never monopolized by whichever class happens to have the most gaps.
 * Never randomized — order is always source-registration order, then
 * within-source discovery order.
 */
function interleaveAyasGeneratorSources(repoRoot: string): readonly AyasGeneratedNovelPatch[] {
  const queues = AYAS_GENERATOR_SOURCES.map((source) => [...source.discover(repoRoot)]);
  const interleaved: AyasGeneratedNovelPatch[] = [];
  for (let more = true; more; ) {
    more = false;
    for (const queue of queues) {
      const next = queue.shift();
      if (next) { interleaved.push(next); more = true; }
    }
  }
  return interleaved;
}

/**
 * Orchestrates M17/M19's sandboxed drafting pipeline across every
 * registered generator source (`AyasPatchDetectors.AYAS_GENERATOR_SOURCES`):
 * detect → generate content (pure, in-memory) → policy limits → isolated
 * `git worktree` sandbox → apply → validate (`tsc --noEmit` + the new/edited
 * smoke test itself) → on PASS, freeze an immutable artifact and return one
 * `AyasDaemonCandidate`; on FAIL, log a rejection and try the next candidate
 * (bounded). Never touches the real working tree, never stages/commits/
 * pushes, never opens an execution gate, never reserves or executes
 * anything. The remaining detect-only classes (`runAyasDiscoveryFindings`)
 * run alongside and are surfaced as informational evidence only — no
 * generator is registered for them (see `AyasPatchDetectors.ts`'s own
 * module doc for why).
 */
export async function discoverAyasNovelPatchCandidates(deps: AyasNovelPatchDiscoveryDeps): Promise<AyasNovelPatchDiscoveryResult> {
  const { repoRoot, observation } = deps;
  const maxAttempts = deps.maxAttemptsPerTick ?? 2;
  const artifactStore = deps.artifactStore ?? createAyasPatchArtifactStore({ rootDir: path.join(repoRoot, "data", "brain", "self-improvement", "patch-artifacts") });
  const sandboxUnvalidatableStore = deps.sandboxUnvalidatableStore ?? createAyasSandboxUnvalidatableStore({ rootDir: path.join(repoRoot, "data", "brain", "self-improvement", "sandbox-unvalidatable") });
  const findings = runAyasDiscoveryFindings(repoRoot);

  if (!observation.repoClean || observation.machineAction === "PAUSE" || observation.machineAction === "STOP OWN WORKLOAD") {
    return { candidates: [], rejections: [], findings };
  }

  const generatedCandidates = interleaveAyasGeneratorSources(repoRoot);

  const candidates: AyasNovelPatchCandidate[] = [];
  const rejections: AyasNovelPatchRejection[] = [];

  let attempts = 0;
  for (const generated of generatedCandidates) {
    if (attempts >= maxAttempts) break;

    // Gap 4 (M21.4) — this EXACT semantic key may already have failed real
    // sandbox validation with this EXACT generated content (source hash +
    // generator identity are baked into the fingerprint). Nothing relevant
    // has changed, so skip it WITHOUT spending an attempt — a suppressed
    // candidate is not an "attempt," exactly like a MICRO_SAFE candidate
    // below isn't; both are cheap, deterministic skips before any real
    // sandbox work happens.
    const contentFingerprint = contentFingerprintOf(generated.replacements.map((r) => r.content).join("|"));
    if (sandboxUnvalidatableStore.shouldSkip(generated.candidateId, contentFingerprint)) continue;

    // M18: a candidate classified MICRO_SAFE belongs to the batch lane
    // (AyasMicroBatchAccumulator), never an individual human-facing
    // proposal — skip it here so the two lanes never both propose the same
    // opportunity. Anything else (PRIORITY_SAFE — the two M19 generators,
    // today, since they are not yet on the micro-eligible allowlist) keeps
    // flowing through this unmodified individual-proposal pipeline.
    const microClassification = classifyAyasMicroCandidate({ exactFiles: generated.exactFiles, totalLines: generated.replacements[0]!.content.split("\n").length, generatorIdentity: generated.generatorIdentity });
    if (microClassification.classification === "MICRO_SAFE") continue;

    const limitViolations = checkAyasNovelPatchLimits(generated.replacements);
    if (limitViolations.length > 0) {
      attempts += 1;
      const reason = `blast-radius/domain policy: ${limitViolations.map((v) => `${v.rule}: ${v.detail}`).join("; ")}`;
      rejections.push({ candidateId: generated.candidateId, reason });
      writeRejectionLog(repoRoot, { candidateId: generated.candidateId, reason, at: observation.now });
      continue;
    }

    attempts += 1;
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
      // Gap 4 (M21.4) — remember this EXACT (semanticKey, content) pairing
      // failed real sandbox validation, so a future tick with unchanged
      // source skips it instead of repeating the same doomed attempt
      // forever. A source change (new fingerprint) naturally lifts the
      // suppression on its own next tick.
      try {
        sandboxUnvalidatableStore.record({ semanticKey: generated.candidateId, generatorIdentity: generated.generatorIdentity, contentFingerprint, reason, requiredCapability: "unknown — validator failed for a reason not necessarily related to the generated content itself; see reason", now: observation.now });
      } catch { /* best-effort suppression only — never blocks discovery */ }
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
        graphifyImportCounts: generated.expectedGraphifyImportCounts,
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
    } catch (error) {
      // A candidate can fail AFTER passing its own validators — e.g. the
      // artifact store's own secret-scan rejects content that merely
      // LOOKS secret-like (a real, live example: diagnostic-quality-gap
      // echoing back a failing assert's own source text as a message can
      // incidentally embed something matching the absolute-path/env-secret
      // redaction rules). This must be treated exactly like a validator
      // failure — a rejection for THIS candidate, never an uncaught
      // exception that aborts the whole tick's discovery.
      const reason = error instanceof Error ? `post-validation artifact freeze failed: ${error.message}` : `post-validation artifact freeze failed: ${String(error)}`;
      rejections.push({ candidateId: generated.candidateId, reason });
      writeRejectionLog(repoRoot, { candidateId: generated.candidateId, reason, at: observation.now });
      try {
        sandboxUnvalidatableStore.record({ semanticKey: generated.candidateId, generatorIdentity: generated.generatorIdentity, contentFingerprint, reason, requiredCapability: "unknown — freeze failed after sandbox validation already passed; see reason", now: observation.now });
      } catch { /* best-effort suppression only — never blocks discovery */ }
    } finally {
      await destroyAyasPatchSandbox(sandbox);
    }
  }

  return { candidates, rejections, findings };
}

export { computeAyasPatchHash };
