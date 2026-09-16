import { applyAyasBoundedFileReplacements, type AyasBoundedFileReplacement } from "./AyasBoundedFileWrite";
import { runAyasValidators, createAyasSmokeTestValidator, type AyasValidator } from "./AyasMutationValidators";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "./AyasNovelPatchDiscovery";

/**
 * The closed, server-owned mapping from a proposal's `mutationKind` to the
 * one reviewed implementation it may run. Every entry here is committed,
 * reviewed source code, written and tested BEFORE any proposal referencing
 * it can exist — a proposal's free-text fields are display-only explanation,
 * never a source of executable content or file paths. There is no `eval`,
 * no dynamic `import()`/`require()` of a variable path, no shell, and no
 * client-supplied callback anywhere in this module or its callers.
 */
export class AyasMutationRegistryError extends Error {
  constructor(readonly code: "AYAS_MUTATION_KIND_UNKNOWN" | "AYAS_MUTATION_SCOPE_MISMATCH", message: string) {
    super(message);
    this.name = "AyasMutationRegistryError";
    this.stack = undefined;
  }
}

export interface AyasMutationRunResult {
  readonly changedFiles: readonly string[];
  readonly testsRun: readonly string[];
  readonly testResults: readonly string[];
}

export interface AyasMutationImplementation {
  /** Must equal the referencing proposal's own `exactFiles` exactly (order-sensitive) — checked at resolution time, before anything runs. */
  readonly exactFiles: readonly string[];
  readonly run: (repoRoot: string) => Promise<AyasMutationRunResult>;
}

/**
 * Shared orchestration for the common case (M16): write bounded file
 * replacements, then run this entry's own declared validators, all inside
 * the bounded-write primitive's `after()` hook — so a validator failure (or
 * throw) triggers the SAME automatic rollback `AyasBoundedFileWrite` already
 * proves for any other failure. If a validator fails, this throws
 * `AyasValidatorFailedError` before returning, which propagates out of
 * `applyWhileExecuting` — Package C's own existing, unmodified recovery
 * classification (see `AyasAutonomyDaemon.ts`'s catch block) then handles
 * it: since the throw happens before `MUTATION_COMPLETED` is ever
 * journaled, the last journaled phase is `EXECUTING`, which
 * `classifyExecutionRecovery` conservatively treats as `mutationPossible:
 * true` → `RECOVERY_REQUIRED`, never a false "success", regardless of
 * whether this rollback actually succeeded — Package C never trusts a
 * callback's own self-report.
 */
export async function runAyasBoundedMutationWithValidators(
  repoRoot: string,
  allowedRoots: readonly string[],
  replacements: readonly AyasBoundedFileReplacement[],
  validators: readonly AyasValidator[],
): Promise<AyasMutationRunResult> {
  return applyAyasBoundedFileReplacements(repoRoot, allowedRoots, replacements, async (outcomes) => {
    const results = await runAyasValidators(repoRoot, validators);
    return {
      changedFiles: outcomes.map((o) => o.filePath),
      testsRun: results.map((r) => r.validator),
      testResults: results.map((r) => (r.pass ? "PASS" : "FAIL")),
    };
  });
}

/**
 * `first-safe-smoke-coverage-v1` — M15.1's first reviewed mutation: adds
 * exactly one new test-only file, `scripts/smoke-ayas-proposal-terminal-state-dedup.ts`,
 * proving a previously-uncovered invariant of `AyasApprovalInboxStore.createProposal`'s
 * deduplication boundary: an identical candidate is deduped while a prior
 * instance is still ACTIONABLE (PENDING/APPROVED/REJECTED/DEFERRED/RESERVED),
 * but once a prior instance reaches a TERMINAL outcome (COMPLETED/FAILED/
 * STALE/ABANDONED/RECOVERY_REQUIRED) a fresh proposal is correctly created
 * instead, with the old terminal record preserved untouched in history. The
 * exact file content below was authored, then verified by actually running
 * it (12/12 scenarios passing) before being embedded here — this registry
 * entry only ever reproduces that already-reviewed, already-tested content;
 * it does not generate anything at run time.
 */
const FIRST_SAFE_SMOKE_COVERAGE_V1_CONTENT = [
  'import assert from "node:assert/strict";',
  'import fs from "node:fs";',
  'import os from "node:os";',
  'import path from "node:path";',
  "",
  'import { createAyasApprovalInboxStore, type AyasInboxProposal, type AyasInboxProposalStatus } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";',
  "",
  "/**",
  " * `AyasApprovalInboxStore.createProposal` dedupes an identical candidate",
  " * (same `proposalHash`) only while a prior instance is still in an",
  " * ACTIONABLE status (PENDING/APPROVED/REJECTED/DEFERRED/RESERVED). This",
  " * suite proves the other half of that boundary, which had no coverage: once",
  " * a prior instance has reached a TERMINAL outcome (COMPLETED, ABANDONED,",
  " * RECOVERY_REQUIRED, STALE, FAILED), re-proposing the exact same content",
  " * must create a genuinely NEW, independent proposal — never silently reuse",
  " * or resurrect the old one — while the old terminal record stays intact in",
  " * history. Without this, a real improvement that legitimately recurs after",
  " * a prior execution finished (successfully or not) could never be proposed",
  " * again, or worse, could be silently conflated with a closed case.",
  " */",
  "",
  "let count = 0;",
  'function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(\`PASS ${count}: ${name}\`); }); }',
  'function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-terminal-dedup-")); }',
  "",
  'function proposalInput(overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {',
  "  return {",
  '    createdAt: "2026-09-16T09:00:00.000Z",',
  '    baseBranch: "wip/test",',
  '    baseHead: "abc123",',
  '    objective: "test-only bounded observability",',
  '    currentProblem: "fixture misses one deterministic assertion",',
  '    selectionReason: "the fixture evidence identifies this bounded gap",',
  '    expectedUserBenefit: "the regression is caught before it reaches the user",',
  '    expectedBehaviorChange: "the smoke test checks one additional invariant",',
  '    unchangedBehavior: "production execution and user data do not change",',
  '    riskIfNotDone: "the regression could remain unnoticed",',
  '    technicalRisk: "low; one reversible assertion",',
  '    productionImpact: "none until a separately authorized execution",',
  '    rationale: "a deterministic smoke gap is visible",',
  '    evidence: ["fixture evidence"],',
  '    graphifyEvidence: ["fresh structural graph"],',
  "    candidateRank: 1,",
  '    risk: "low and reversible",',
  '    safetyClassification: "SAFE" as const,',
  '    exactFiles: ["scripts/smoke-ayas-machine-health.ts"],',
  '    expectedDiffScope: "+1 assertion",',
  '    testsPlanned: ["smoke-ayas-proposal-terminal-state-dedup"],',
  '    estimatedCost: "zero-cost" as const,',
  '    mutationKind: "test-fixture-mutation",',
  "    ...overrides,",
  "  };",
  "}",
  "",
  "/** Drives one proposal to the given terminal status via the real, existing durable-state API — never by writing state directly. */",
  'function driveToTerminal(inbox: ReturnType<typeof createAyasApprovalInboxStore>, proposalId: string, proposalHash: string, baseHead: string, exactFiles: readonly string[], status: "COMPLETED" | "FAILED" | "STALE" | "ABANDONED" | "RECOVERY_REQUIRED"): void {',
  '  inbox.decide(proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");',
  '  if (status === "ABANDONED" || status === "RECOVERY_REQUIRED") {',
  '    const reservation = inbox.reserveApproval(proposalId, proposalHash, baseHead, exactFiles, "2026-09-16T09:02:00.000Z");',
  '    inbox.finalizeApproval(reservation.reservationId, status, "2026-09-16T09:03:00.000Z");',
  "    return;",
  "  }",
  '  const reservation = inbox.reserveApproval(proposalId, proposalHash, baseHead, exactFiles, "2026-09-16T09:02:00.000Z");',
  '  inbox.recordResult({ resultId: \`result-${proposalId}\`, proposalId, authorizationId: reservation.authorizationId, startedAt: "2026-09-16T09:02:30.000Z", completedAt: "2026-09-16T09:03:00.000Z", changedFiles: exactFiles, diffFingerprint: "fixture-fingerprint", testsRun: ["fixture"], testResults: ["PASS"], outcome: status, gateAuditIdentity: "fixture", operatorReviewStatus: "WAITING_REVIEW" }, status);',
  '  inbox.finalizeApproval(reservation.reservationId, "EXECUTED", "2026-09-16T09:03:30.000Z");',
  "}",
  "",
  'const ACTIONABLE: readonly AyasInboxProposalStatus[] = ["PENDING", "APPROVED", "REJECTED", "DEFERRED", "RESERVED"];',
  'const TERMINAL: readonly ("COMPLETED" | "FAILED" | "STALE" | "ABANDONED" | "RECOVERY_REQUIRED")[] = ["COMPLETED", "FAILED", "STALE", "ABANDONED", "RECOVERY_REQUIRED"];',
  "",
  "async function main() {",
  '  await scenario("baseline: an identical PENDING candidate is deduped (returns the same instance)", () => {',
  "    const inbox = createAyasApprovalInboxStore({ rootDir: root() });",
  "    const p1 = inbox.createProposal(proposalInput());",
  "    const p2 = inbox.createProposal(proposalInput());",
  "    assert.equal(p2.proposalId, p1.proposalId);",
  "    assert.equal(inbox.load().proposals.length, 1);",
  "  });",
  "",
  "  for (const status of ACTIONABLE) {",
  '    await scenario(\`an identical candidate is deduped while a prior instance is ${status}\`, () => {',
  "      const inbox = createAyasApprovalInboxStore({ rootDir: root() });",
  "      const p1 = inbox.createProposal(proposalInput());",
  '      if (status !== "PENDING") {',
  '        if (status === "APPROVED") inbox.decide(p1.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");',
  '        else if (status === "REJECTED") inbox.decide(p1.proposalId, "REJECT", "2026-09-16T09:01:00.000Z");',
  '        else if (status === "DEFERRED") inbox.decide(p1.proposalId, "LATER", "2026-09-16T09:01:00.000Z");',
  '        else if (status === "RESERVED") { inbox.decide(p1.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z"); inbox.reserveApproval(p1.proposalId, p1.proposalHash, p1.baseHead, p1.exactFiles, "2026-09-16T09:02:00.000Z"); }',
  "      }",
  "      assert.equal(inbox.load().proposals.find((p) => p.proposalId === p1.proposalId)?.status, status);",
  "      const p2 = inbox.createProposal(proposalInput());",
  '      assert.equal(p2.proposalId, p1.proposalId, \`expected dedup while status is ${status}\`);',
  "      assert.equal(inbox.load().proposals.length, 1);",
  "    });",
  "  }",
  "",
  "  for (const status of TERMINAL) {",
  '    await scenario(\`an identical candidate creates a NEW proposal once a prior instance reached ${status}, and history is preserved\`, () => {',
  "      const inbox = createAyasApprovalInboxStore({ rootDir: root() });",
  "      const p1 = inbox.createProposal(proposalInput());",
  "      driveToTerminal(inbox, p1.proposalId, p1.proposalHash, p1.baseHead, p1.exactFiles, status);",
  "      assert.equal(inbox.load().proposals.find((p) => p.proposalId === p1.proposalId)?.status, status);",
  "      const p2 = inbox.createProposal(proposalInput());",
  '      assert.notEqual(p2.proposalId, p1.proposalId, \`expected a fresh proposal once status is ${status}\`);',
  '      assert.equal(p2.status, "PENDING");',
  '      assert.equal(p2.proposalHash, p1.proposalHash, "content is identical, so the hash must still match");',
  "      const state = inbox.load();",
  "      assert.equal(state.proposals.length, 2);",
  '      assert.equal(state.proposals.find((p) => p.proposalId === p1.proposalId)?.status, status, "the old terminal proposal must remain untouched in history");',
  "    });",
  "  }",
  "",
  '  await scenario("a genuinely different candidate (different exactFiles) is never deduped against a PENDING one", () => {',
  "    const inbox = createAyasApprovalInboxStore({ rootDir: root() });",
  "    const p1 = inbox.createProposal(proposalInput());",
  '    const p2 = inbox.createProposal(proposalInput({ exactFiles: ["scripts/smoke-ayas-other.ts"] }));',
  "    assert.notEqual(p2.proposalId, p1.proposalId);",
  "    assert.notEqual(p2.proposalHash, p1.proposalHash);",
  "    assert.equal(inbox.load().proposals.length, 2);",
  "  });",
  "",
  '  console.log(\`AYAS proposal terminal-state dedup smoke: PASS (${count} scenarios)\`);',
  '  console.log(JSON.stringify({ status: "PASS", suite: "ayas-proposal-terminal-state-dedup", scenarios: count }));',
  "}",
  "void main();",
  "",
].join("\n");

/**
 * `second-safe-smoke-coverage-v1` — M16's second reviewed mutation, for the
 * second real governed self-improvement. `evaluateAyasMachineHealth`'s
 * THROTTLE-on-missing-telemetry branch (`AyasMachineHealthGuard.ts`) only
 * requires `gpuPercent` when `workload.stage` is GPU-likely (visuals /
 * animation / video / assembly); every existing smoke test exercises this
 * function with `stage: "video"` only (grep-verified across `scripts/` and
 * `src/`), so a regression that dropped the GPU-likeliness guard (throttling
 * on missing GPU telemetry regardless of stage) would pass every existing
 * test silently. This adds exactly one new test-only file. The exact
 * content below was authored, then verified by actually running it (36/36
 * scenarios passing) before being embedded here — this registry entry only
 * ever reproduces that already-reviewed, already-tested content; it does
 * not generate anything at run time.
 */
const SECOND_SAFE_SMOKE_COVERAGE_V1_CONTENT = [
  'import assert from "node:assert/strict";',
  'import { evaluateAyasMachineHealth } from "../src/lib/ayas/machine/AyasMachineHealthGuard";',
  'import type { AyasMachineTelemetry } from "../src/lib/ayas/machine/AyasMachineTelemetry";',
  'import type { ProductionStepKey } from "../src/types/project";',
  "",
  "/**",
  " * `evaluateAyasMachineHealth`'s THROTTLE-on-missing-telemetry branch only",
  ' * requires `gpuPercent` when `workload.stage` is GPU-likely',
  ' * (`visuals`/`animation`/`video`/`assembly`) — every existing smoke test',
  ' * exercises this function with `stage: "video"` only, so the other half of',
  ' * that condition (a non-GPU stage with `gpuPercent` missing) has never been',
  " * asserted. A regression that dropped the `GPU_LIKELY.has(...)` guard",
  " * (throttling on missing GPU telemetry regardless of stage) would pass",
  " * every existing test silently.",
  " */",
  'const base: AyasMachineTelemetry = { observedAt: "2026-09-16T00:00:00.000Z", cpuPercent: 20, gpuPercent: 10, ramUsedPercent: 30, vramUsedPercent: 20, diskFreePercent: 50, processRssMb: 100, unavailable: [] };',
  'const NON_GPU_STAGES: readonly ProductionStepKey[] = ["research", "script", "scenes", "audio", "thumbnail", "seo", "youtube", "export"];',
  'const GPU_STAGES: readonly ProductionStepKey[] = ["visuals", "animation", "video", "assembly"];',
  "",
  "for (const stage of NON_GPU_STAGES) {",
  '  const decision = evaluateAyasMachineHealth({ ...base, gpuPercent: undefined }, { stage, ownedActive: false });',
  '  assert.equal(decision.action, "ALLOW", \`stage "${stage}" is not GPU-likely — missing gpuPercent must not throttle it\`);',
  '  assert.equal(decision.mayStart, true, \`stage "${stage}" must be allowed to start without GPU telemetry\`);',
  "}",
  "",
  "for (const stage of GPU_STAGES) {",
  '  const decision = evaluateAyasMachineHealth({ ...base, gpuPercent: undefined }, { stage, ownedActive: false });',
  '  assert.equal(decision.action, "THROTTLE", \`stage "${stage}" is GPU-likely — missing gpuPercent must still throttle it\`);',
  '  assert.equal(decision.reasonCode, "MACHINE_HEALTH_TELEMETRY_PARTIAL");',
  "}",
  "",
  "// The OTHER half of the same condition — missing cpuPercent — applies",
  "// unconditionally, regardless of stage, and must still throttle a non-GPU",
  "// stage too.",
  "for (const stage of [...NON_GPU_STAGES, ...GPU_STAGES]) {",
  '  const decision = evaluateAyasMachineHealth({ ...base, cpuPercent: undefined }, { stage, ownedActive: false });',
  '  assert.equal(decision.action, "THROTTLE", \`stage "${stage}" must still throttle on missing cpuPercent regardless of GPU-likeliness\`);',
  "}",
  "",
  'console.log(JSON.stringify({ status: "PASS", suite: "ayas-machine-health-non-gpu-stage", scenarios: NON_GPU_STAGES.length * 2 + GPU_STAGES.length * 2 + (NON_GPU_STAGES.length + GPU_STAGES.length) }));',
  "",
].join("\n");

/**
 * Populated one entry at a time, by hand, only when a specific improvement
 * has already been implemented and reviewed. Never populated programmatically
 * or from any external input.
 */
const AYAS_MUTATION_REGISTRY: ReadonlyMap<string, AyasMutationImplementation> = new Map([
  ["first-safe-smoke-coverage-v1", {
    // M16: retrofitted with a real validator — the mutationKind's own
    // registry entry is static source, so this only affects future
    // (re-)resolution, never the already-COMPLETED historical proposal.
    exactFiles: ["scripts/smoke-ayas-proposal-terminal-state-dedup.ts"],
    run: (repoRoot: string): Promise<AyasMutationRunResult> => runAyasBoundedMutationWithValidators(
      repoRoot,
      ["scripts/"],
      [{ filePath: "scripts/smoke-ayas-proposal-terminal-state-dedup.ts", expectedHash: null, content: FIRST_SAFE_SMOKE_COVERAGE_V1_CONTENT, allowCreate: true }],
      [createAyasSmokeTestValidator("scripts/smoke-ayas-proposal-terminal-state-dedup.ts")],
    ),
  } satisfies AyasMutationImplementation],
  ["second-safe-smoke-coverage-v1", {
    exactFiles: ["scripts/smoke-ayas-machine-health-non-gpu-stage.ts"],
    run: (repoRoot: string): Promise<AyasMutationRunResult> => runAyasBoundedMutationWithValidators(
      repoRoot,
      ["scripts/"],
      [{ filePath: "scripts/smoke-ayas-machine-health-non-gpu-stage.ts", expectedHash: null, content: SECOND_SAFE_SMOKE_COVERAGE_V1_CONTENT, allowCreate: true }],
      [createAyasSmokeTestValidator("scripts/smoke-ayas-machine-health-non-gpu-stage.ts")],
    ),
  } satisfies AyasMutationImplementation],
  // M17 — sentinel-only registration for `isAyasMutationKindRegistered`'s
  // discovery-time invariant ("a candidate can never become
  // execution-eligible without a registered mutationKind"). This entry must
  // never actually run: `AyasProposalExecutionService` always resolves
  // `patch-artifact:v1` proposals through `resolveAyasPatchArtifactMutation`
  // (the frozen-artifact path) BEFORE ever reaching `resolveAyasMutation`.
  // `exactFiles: []` guarantees that even if that branch were ever removed
  // by mistake, `resolveAyasMutation`'s own exactFiles comparison would fail
  // closed (AYAS_MUTATION_SCOPE_MISMATCH) rather than silently matching, and
  // `run` throws unconditionally as a second, independent fail-closed layer.
  [AYAS_PATCH_ARTIFACT_MUTATION_KIND, {
    exactFiles: [],
    run: (): Promise<AyasMutationRunResult> => { throw new AyasMutationRegistryError("AYAS_MUTATION_SCOPE_MISMATCH", "patch-artifact:v1 must resolve via resolveAyasPatchArtifactMutation, never the static registry"); },
  } satisfies AyasMutationImplementation],
]);

function sameFileList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Fails closed before any reservation/gate/mutation activity — an unknown kind or a scope mismatch never reaches Package C's authority chain. `registry` defaults to the one real, closed registry above; tests pass their own isolated map instead of ever mutating the real one. */
export function resolveAyasMutation(mutationKind: string, expectedExactFiles: readonly string[], registry: ReadonlyMap<string, AyasMutationImplementation> = AYAS_MUTATION_REGISTRY): AyasMutationImplementation {
  const impl = registry.get(mutationKind);
  if (!impl) throw new AyasMutationRegistryError("AYAS_MUTATION_KIND_UNKNOWN", `no registered mutation implementation for "${mutationKind}"`);
  if (!sameFileList(impl.exactFiles, expectedExactFiles)) throw new AyasMutationRegistryError("AYAS_MUTATION_SCOPE_MISMATCH", `registered exactFiles for "${mutationKind}" do not match the proposal's exactFiles`);
  return impl;
}

export function isAyasMutationKindRegistered(mutationKind: string, registry: ReadonlyMap<string, AyasMutationImplementation> = AYAS_MUTATION_REGISTRY): boolean {
  return registry.has(mutationKind);
}
