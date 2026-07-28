import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addIntegrity, canonicalSmokeChildren, canonicalStringify, sha256 } from "./lib/CanonicalSmokeEvidence";
import { CanonicalEvidenceError, type CanonicalEvidenceErrorCode } from "./lib/CanonicalSmokeEvidence";
import { aggregateEvidence, runEvidenceMatrix, setCanonicalEvidenceValidationHooks,
  writeImmutableJson } from "./lib/CanonicalSmokeEvidenceV2";

type RecordValue = Record<string, unknown>;
const sourceRoot = path.resolve(process.argv[2] ?? "");
assert(process.argv[2] && fs.existsSync(sourceRoot), "Completed v2 evidence root argument is required.");
aggregateEvidence(sourceRoot);
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-evidence-v2-validation-"));
let passed = 0;

try {
  exact("atomic no-clobber", "EVIDENCE_CHILD_INTEGRITY_MISMATCH", () => {
    const target = path.join(testRoot, "no-clobber.json"); writeImmutableJson(target, { kind: "first" });
    writeImmutableJson(target, { kind: "second" });
  });
  writerIntegrityInvariants();
  rootPrewriteInvariants();
  temporaryCleanupInvariants();
  reject("child manifest integrity tamper", "EVIDENCE_CHILD_INTEGRITY_MISMATCH", (root) => fs.appendFileSync(child(root), " "));
  reject("stdout log hash mismatch", "EVIDENCE_CHILD_INTEGRITY_MISMATCH", (root) => fs.appendFileSync(stdout(root), "tamper"));
  reject("terminal duplicate, fully rehashed", "EVIDENCE_CHILD_TERMINAL_MISMATCH", (root) => {
    const target = stdout(root); fs.appendFileSync(target, 'ATOLYE_SMOKE_RESULT {"scenarios":29,"status":"PASS","suite":"canonical-smoke-runtime-foundation"}\n');
    mutate(child(root), (value) => { const meta = record(value.stdout); meta.sha256 = hashFile(target);
      meta.originalByteCount = fs.statSync(target).size; meta.retainedByteCount = fs.statSync(target).size; });
  });
  reject("scenario contract forgery", "EVIDENCE_CHILD_INTEGRITY_MISMATCH", (root) => mutate(child(root), (value) => { value.expectedScenarios = 999; }));
  reject("foreign child matrix", "EVIDENCE_CHILD_INTEGRITY_MISMATCH", (root) => mutate(child(root), (value) => { value.matrixRunId = "foreign-matrix"; }));
  reject("foreign child baseline", "EVIDENCE_CHILD_INTEGRITY_MISMATCH", (root) => mutate(child(root), (value) => { value.baselineFingerprint = "0".repeat(64); }));
  reject("missing child", "EVIDENCE_INCOMPLETE_MATRIX", (root) => fs.unlinkSync(child(root)));
  reject("foreign duplicate child", "EVIDENCE_INCOMPLETE_MATRIX", (root) => fs.copyFileSync(child(root), path.join(root, "children", "foreign.json")));
  reject("missing final", "EVIDENCE_INCOMPLETE_MATRIX", (root) => fs.unlinkSync(path.join(root, "final-integrity.json")));
  reject("matrix HEAD", "EVIDENCE_MATRIX_HEAD_MISMATCH", (root) => mutate(path.join(root, "matrix-manifest.json"), (value) => { value.head = "1".repeat(40); }));
  reject("matrix registry", "EVIDENCE_REGISTRY_MISMATCH", (root) => mutate(path.join(root, "matrix-manifest.json"), (value) => { value.authoritativeSuiteRegistryFingerprint = "2".repeat(64); }));
  reject("matrix hostile policy", "EVIDENCE_HOSTILE_POLICY_MISMATCH", (root) => mutate(path.join(root, "matrix-manifest.json"), (value) => { value.hostileEnvironmentPolicyFingerprint = "3".repeat(64); }));
  reject("matrix timeout policy", "EVIDENCE_TIMEOUT_POLICY_MISMATCH", (root) => mutate(path.join(root, "matrix-manifest.json"), (value) => { value.childTimeoutPolicyFingerprint = "4".repeat(64); }));
  reject("partial evidence", "EVIDENCE_CHILD_INTEGRITY_MISMATCH", (root) => fs.writeFileSync(path.join(root, "children", ".tmp-partial"), "partial"));
  reject("missing partition", "EVIDENCE_INCOMPLETE_MATRIX", (root) => fs.unlinkSync(path.join(root, "partitions", "P5.json")));
  reject("baseline linkage", "EVIDENCE_BASELINE_MISMATCH", (root) => mutate(path.join(root, "baseline.json"), (value) => { value.timestamp = new Date(0).toISOString(); }));
  reject("root identity", "EVIDENCE_ROOT_IDENTITY_MISMATCH", () => undefined, { rebase: false });
  reject("root reparse entry", "EVIDENCE_ROOT_REPARSE_DETECTED", (root) => {
    const target = path.join(root, "reparse-target"); fs.mkdirSync(target); fs.symlinkSync(target, path.join(root, "reparse-entry"), "junction");
  });
  exact("root parent chain", "EVIDENCE_ROOT_PARENT_CHAIN_INVALID", () => {
    const parent = path.join(testRoot, "invalid-parent", "foreign-parent"), root = path.join(parent, path.basename(sourceRoot));
    fs.mkdirSync(parent, { recursive: true }); fs.cpSync(sourceRoot, root, { recursive: true, dereference: false });
    aggregateEvidence(root);
  });
  exact("root parent junction", "EVIDENCE_ROOT_REPARSE_DETECTED", () => {
    const base = path.join(testRoot, "parent-junction"), realParent = path.join(base, "real-parent"),
      linkedParent = path.join(base, "canonical-smoke-evidence"), realRoot = path.join(realParent, path.basename(sourceRoot));
    fs.mkdirSync(realParent, { recursive: true }); fs.cpSync(sourceRoot, realRoot, { recursive: true, dereference: false });
    fs.symlinkSync(realParent, linkedParent, "junction"); aggregateEvidence(path.join(linkedParent, path.basename(sourceRoot)));
  });
  reject("child runtime remainder, rehashed", "EVIDENCE_CHILD_REMAINDER_PRESENT", (root) => mutate(child(root), (value) => { value.runtimeRemainder = ["forged-runtime"]; }));
  reject("child authority remainder, rehashed", "EVIDENCE_CHILD_REMAINDER_PRESENT", (root) => mutate(child(root), (value) => { value.authorityRemainder = ["forged-authority"]; }));
  reject("child temp remainder, rehashed", "EVIDENCE_CHILD_REMAINDER_PRESENT", (root) => mutate(child(root), (value) => { value.tempRemainder = ["forged-temp"]; }));
  reject("data projects before dirty, rehashed", "EVIDENCE_CHILD_DATA_PROJECTS_DIRTY", (root) => mutate(child(root), (value) => { value.dataProjectsBefore = { tracked: "forged", untracked: "" }; }));
  reject("partition completed zero, rehashed", "EVIDENCE_PARTITION_COUNTER_MISMATCH", (root) => mutate(partition(root), (value) => { value.completed = 0; }));
  reject("partition passed zero, rehashed", "EVIDENCE_PARTITION_COUNTER_MISMATCH", (root) => mutate(partition(root), (value) => { value.passed = 0; }));
  reject("partition coverage empty, rehashed", "EVIDENCE_PARTITION_COVERAGE_MISMATCH", (root) => mutate(partition(root), (value) => { value.expectedChildIds = []; value.observedChildIds = []; }));
  reject("matrix expected children empty, rehashed", "EVIDENCE_REGISTRY_MISMATCH", (root) => mutate(path.join(root, "matrix-manifest.json"), (value) => { record(value.expectedContract).children = []; }));
  reject("matrix expected partitions empty, rehashed", "EVIDENCE_REGISTRY_MISMATCH", (root) => mutate(path.join(root, "matrix-manifest.json"), (value) => { record(value.expectedContract).partitions = []; }));
  reject("matrix expected suites empty, rehashed", "EVIDENCE_REGISTRY_MISMATCH", (root) => mutate(path.join(root, "matrix-manifest.json"), (value) => {
    record(value.expectedContract).children = (record(value.expectedContract).children as RecordValue[]).map((item) => ({ ...item, suite: "" }));
  }));
  reject("shared before contradiction, rehashed", "EVIDENCE_CHILD_SHARED_DELTA", (root) => forgeInventory(root, child(root), "sharedBeforeInventory", "forged-shared"));
  reject("shared after contradiction, rehashed", "EVIDENCE_CHILD_SHARED_DELTA", (root) => forgeInventory(root, child(root), "sharedAfterInventory", "forged-shared-after"));
  reject("production before contradiction, rehashed", "EVIDENCE_CHILD_PRODUCTION_DELTA", (root) => forgeInventory(root, child(root), "productionBeforeInventory", "forged-production"));
  reject("production after contradiction, rehashed", "EVIDENCE_CHILD_PRODUCTION_DELTA", (root) => forgeInventory(root, child(root), "productionAfterInventory", "forged-production-after"));
  reject("final shared contradiction, rehashed", "EVIDENCE_CHILD_SHARED_DELTA", (root) => forgeInventory(root, path.join(root, "final-integrity.json"), "sharedFinalInventory", "forged-final-shared"));
  reject("final production contradiction, rehashed", "EVIDENCE_CHILD_PRODUCTION_DELTA", (root) => forgeInventory(root, path.join(root, "final-integrity.json"), "productionFinalInventory", "forged-final-production"));
  reject("environment fingerprint mismatch with true boolean", "EVIDENCE_ENVIRONMENT_RESTORE_MISMATCH", (root) =>
    mutate(path.join(root, "final-integrity.json"), (value) => { record(value.finalEnvironmentEvidence).snapshotFingerprint = "b".repeat(64); value.environmentRestored = true; }));
  reject("registration fingerprint mismatch with true boolean", "EVIDENCE_REGISTRATION_RESTORE_MISMATCH", (root) =>
    mutate(path.join(root, "final-integrity.json"), (value) => { record(value.finalRegistrationEvidence).fingerprint = "c".repeat(64); value.globalRegistrationRestored = true; }));
  reject("registration component fingerprint missing", "EVIDENCE_REGISTRATION_RESTORE_MISMATCH", (root) =>
    mutate(path.join(root, "final-integrity.json"), (value) => { delete record(record(value.finalRegistrationEvidence).components).runner; }));
  reject("registration component fingerprint foreign", "EVIDENCE_REGISTRATION_RESTORE_MISMATCH", (root) =>
    mutate(path.join(root, "final-integrity.json"), (value) => { record(record(value.finalRegistrationEvidence).components).runner = "foreign"; }));
  reject("baseline environment snapshot rehashed", "EVIDENCE_ENVIRONMENT_RESTORE_MISMATCH", (root) => {
    const baseline = mutate(path.join(root, "baseline.json"), (value) => { const environment = record(value.environmentEvidence),
      components = environment.components as RecordValue[]; components[0].valueHash = "d".repeat(64);
      environment.snapshotFingerprint = sha256(canonicalStringify(components)); });
    rebindBaseline(root, String(baseline.integrityHash));
  });
  reject("aggregate counter, rehashed", "EVIDENCE_AGGREGATE_COUNTER_MISMATCH", (root) => mutate(path.join(root, "aggregate.json"), (value) => { value.verifiedChildren = 0; }), { keepAggregate: true });
  reject("aggregate failed counter, rehashed", "EVIDENCE_AGGREGATE_COUNTER_MISMATCH", (root) => mutate(path.join(root, "aggregate.json"), (value) => { value.failed = 1; }), { keepAggregate: true });
  reject("aggregate missing counter, rehashed", "EVIDENCE_AGGREGATE_COUNTER_MISMATCH", (root) => mutate(path.join(root, "aggregate.json"), (value) => { value.missing = 1; }), { keepAggregate: true });
  reject("aggregate suite coverage, rehashed", "EVIDENCE_AGGREGATE_COUNTER_MISMATCH", (root) => mutate(path.join(root, "aggregate.json"), (value) => { value.suiteCoverage = []; }), { keepAggregate: true });
  reject("aggregate scenario coverage, rehashed", "EVIDENCE_AGGREGATE_COUNTER_MISMATCH", (root) => mutate(path.join(root, "aggregate.json"), (value) => { value.scenarioCountCoverage = "forged"; }), { keepAggregate: true });

  provenanceReject("same process identity", (root) => { const files = orchestratorFiles(root);
    const first = read(path.join(root, "orchestrators", files[0])); mutate(path.join(root, "orchestrators", files[1]), (value) => { value.processIdentity = first.processIdentity; }); rechain(root); });
  provenanceReject("missing prior orchestrator", (root) => fs.unlinkSync(path.join(root, "orchestrators", orchestratorFiles(root)[0])));
  provenanceReject("resume event hash mismatch", (root) => mutate(path.join(root, "resume-events", "0001.json"), (value) => { value.previousOrchestratorHash = "5".repeat(64); }));
  provenanceReject("altered preserved child", (root) => fs.appendFileSync(child(root), "tamper"), "EVIDENCE_CHILD_INTEGRITY_MISMATCH");
  provenanceReject("rerun valid P1 child", (root) => { mutate(path.join(root, "orchestrators", orchestratorFiles(root)[1]), (value) => {
    value.scheduledPartitions = ["P1", "P2", "P3", "P4", "P5"]; }); rechain(root); });
  provenanceReject("overwrite attempt", (root) => mutate(path.join(root, "resume-events", "0001.json"), (value) => { value.overwriteAttempts = 1; }));
  provenanceReject("orchestrator baseline mismatch", (root) => { mutate(path.join(root, "orchestrators", orchestratorFiles(root)[1]), (value) => { value.baselineFingerprint = "6".repeat(64); }); rechain(root); });
  provenanceReject("orchestrator registry mismatch", (root) => { mutate(path.join(root, "orchestrators", orchestratorFiles(root)[1]), (value) => { value.registryFingerprint = "7".repeat(64); }); rechain(root); });
  provenanceReject("resume sequence gap", (root) => fs.renameSync(path.join(root, "resume-events", "0001.json"), path.join(root, "resume-events", "0002.json")), "EVIDENCE_RESUME_PROVENANCE_MISSING");
  provenanceReject("foreign orchestrator record", (root) => { const files = orchestratorFiles(root), lastPath = path.join(root, "orchestrators", files.at(-1)!);
    const last = read(lastPath), { integrityHash, ...body } = last;
    const foreign = addIntegrity({ ...body, orchestratorId: "9999-foreign", previousRecordHash: integrityHash, mode: "foreign" });
    writeRaw(path.join(root, "orchestrators", "9999-foreign.json"), foreign); });
  provenanceReject("malformed process identity", (root) => { mutate(path.join(root, "orchestrators", orchestratorFiles(root)[0]),
    (value) => { value.processIdentity = { pid: -1, startedAtEpochMs: 0, executable: "foreign", processStartIdentity: "fake" }; }); rechain(root); });
  provenanceReject("matrix initial process mismatch", (root) => mutate(path.join(root, "matrix-manifest.json"),
    (value) => { value.initialProcessIdentity = { pid: 999, startedAtEpochMs: 1, executable: "C:/foreign.exe",
      processStartIdentity: `999:1:${sha256("C:/foreign.exe").slice(0, 16)}` }; }));
  provenanceReject("lease identity mismatch", (root) => { mutate(path.join(root, "orchestrators", orchestratorFiles(root)[1]),
    (value) => { record(value.leaseReleasedIdentity).inode = "foreign"; }); rechain(root); });
  provenanceReject("observed foreign child", (root) => { mutate(path.join(root, "orchestrators", orchestratorFiles(root)[1]),
    (value) => { value.observedChildren = [...(value.observedChildren as unknown[]), "foreign-child"]; }); rechain(root); });
  provenanceReject("scheduled completed P1 child", (root) => { mutate(path.join(root, "orchestrators", orchestratorFiles(root)[1]),
    (value) => { value.scheduledChildren = [canonicalSmokeChildren[0].childId, ...(value.scheduledChildren as unknown[])]; }); rechain(root); });
  provenanceReject("produced P1 rerun child", (root) => { mutate(path.join(root, "orchestrators", orchestratorFiles(root)[1]),
    (value) => { value.producedChildren = [canonicalSmokeChildren[0].childId, ...(value.producedChildren as unknown[])]; }); rechain(root); });
  provenanceReject("missing scheduled child", (root) => { mutate(path.join(root, "orchestrators", orchestratorFiles(root)[1]),
    (value) => { value.scheduledChildren = (value.scheduledChildren as unknown[]).slice(1); }); rechain(root); });
  provenanceReject("skipped incomplete child", (root) => { mutate(path.join(root, "orchestrators", orchestratorFiles(root)[1]),
    (value) => { value.skippedChildren = [...(value.skippedChildren as unknown[]), canonicalSmokeChildren.at(-1)!.childId]; }); rechain(root); });
  provenanceReject("foreign produced partition", (root) => { mutate(path.join(root, "orchestrators", orchestratorFiles(root)[1]),
    (value) => { value.producedPartitions = [...(value.producedPartitions as unknown[]), "P9"]; }); rechain(root); });
  provenanceReject("duplicate produced child", (root) => { mutate(path.join(root, "orchestrators", orchestratorFiles(root)[1]),
    (value) => { value.producedChildren = [...(value.producedChildren as unknown[]), (value.producedChildren as unknown[])[0]]; }); rechain(root); });
  provenanceReject("resume event child coverage mismatch", (root) => mutate(path.join(root, "resume-events", "0001.json"),
    (value) => { value.verifiedChildIds = []; }));

  resumeReject("resume active lease", "EVIDENCE_ACTIVE_LEASE", (root) => writeRaw(path.join(root, "active-lease.json"), addIntegrity({ active: true })));
  resumeReject("resume missing prior", "EVIDENCE_RESUME_PROVENANCE_MISSING", (root) => fs.unlinkSync(path.join(root, "orchestrators", orchestratorFiles(root)[0])));
  resumeReject("resume altered P1", "EVIDENCE_CHILD_INTEGRITY_MISMATCH", (root) => fs.appendFileSync(child(root), "tamper"));
  resumeReject("resume baseline mismatch", "EVIDENCE_BASELINE_MISMATCH", (root) => mutate(path.join(root, "baseline.json"), (value) => { value.timestamp = new Date(1).toISOString(); }));
  resumeReject("resume registry mismatch", "EVIDENCE_REGISTRY_MISMATCH", (root) => mutate(path.join(root, "matrix-manifest.json"), (value) => { value.authoritativeSuiteRegistryFingerprint = "8".repeat(64); }));

  reject("combined semantic forgery", "EVIDENCE_HOSTILE_POLICY_MISMATCH", (root) => {
    forgeInventory(root, child(root), "sharedBeforeInventory", "combined-shared-forgery");
    mutate(path.join(root, "matrix-manifest.json"), (value) => { record(value.expectedContract).children = [];
      value.hostileEnvironmentPolicyFingerprint = "9".repeat(64); value.childTimeoutPolicyFingerprint = "a".repeat(64);
      value.evidenceRootAuthority = { forged: true }; });
    mutate(child(root), (value) => { value.runtimeRemainder = ["forged"]; value.dataProjectsAfter = { tracked: "dirty", untracked: "" }; });
    mutate(partition(root), (value) => { value.completed = 0; value.passed = 0; });
    mutate(path.join(root, "aggregate.json"), (value) => { value.verifiedChildren = 0; value.failed = 0; });
  }, { keepAggregate: true });
  reject("combined provenance lease child aggregate forgery", "EVIDENCE_RESUME_PROVENANCE_MISMATCH", (root) => {
    const resumePath = path.join(root, "orchestrators", orchestratorFiles(root)[1]);
    mutate(resumePath, (value) => { value.processIdentity = { pid: -9, startedAtEpochMs: 0, executable: "foreign",
      processStartIdentity: "foreign" }; record(value.leaseReleasedIdentity).inode = "foreign";
      value.producedChildren = [canonicalSmokeChildren[0].childId, ...(value.producedChildren as unknown[])]; });
    rechain(root); mutate(path.join(root, "aggregate.json"), (value) => { value.verifiedChildren = 0; });
  }, { keepAggregate: true });
  process.stdout.write(`Canonical semantic evidence validation: PASS (${passed} exact-boundary invariants)\n`);
} finally { fs.rmSync(testRoot, { recursive: true, force: true }); }

function writerIntegrityInvariants(): void {
  for (const [name, value] of [
    ["writer correct supplied hash", addIntegrity({ kind: "correct" })],
    ["writer wrong supplied hash", { kind: "wrong", integrityHash: "0".repeat(64) }],
    ["writer empty supplied hash", { kind: "empty", integrityHash: "" }],
    ["writer non-hex supplied hash", { kind: "format", integrityHash: "not-a-hash" }],
    ["writer uppercase supplied hash", { kind: "case", integrityHash: "A".repeat(64) }],
    ["writer stale supplied hash", { kind: "mutated", integrityHash: sha256(canonicalStringify({ kind: "original" })) }],
  ] as const) {
    const target = path.join(testRoot, `${name.replaceAll(" ", "-")}.json`);
    exact(name, "EVIDENCE_SUPPLIED_INTEGRITY_FORBIDDEN", () => writeImmutableJson(target, value));
    assert(!fs.existsSync(target), `${name}: invalid supplied integrity was published`);
  }
}

function rootPrewriteInvariants(): void {
  const runId = "canonical-closure-prewrite-test";
  const rejectRun = (name: string, root: string, cleanup?: () => void): void => {
    try {
      exact(name, "EVIDENCE_ROOT_PARENT_CHAIN_INVALID", () => runEvidenceMatrix({ matrixRunId: runId, evidenceRoot: root }));
      assert(!fs.existsSync(root), `${name}: evidence root was written before validation`);
    } finally { cleanup?.(); }
  };
  const junctionBase = path.join(testRoot, "new-run-junction"), realParent = path.join(junctionBase, "real-parent"),
    junctionParent = path.join(junctionBase, "canonical-smoke-evidence");
  fs.mkdirSync(realParent, { recursive: true }); fs.symlinkSync(realParent, junctionParent, "junction");
  rejectRun("new run foreign parent junction", path.join(junctionParent, runId));
  fs.unlinkSync(junctionParent); fs.rmSync(junctionBase, { recursive: true, force: true });

  const reparseBase = path.join(testRoot, "new-run-reparse"), reparseTarget = path.join(reparseBase, "target"),
    reparseParent = path.join(reparseBase, "canonical-smoke-evidence");
  fs.mkdirSync(reparseTarget, { recursive: true }); fs.symlinkSync(reparseTarget, reparseParent, "junction");
  rejectRun("new run reparse parent", path.join(reparseParent, runId));
  fs.unlinkSync(reparseParent); fs.rmSync(reparseBase, { recursive: true, force: true });

  rejectRun("new run repository overlap", path.join(process.cwd(), ".evidence-prewrite-review", "canonical-smoke-evidence", runId));
  rejectRun("new run shared overlap", path.join(os.tmpdir(), "atolye-runtime-authority-v1", "canonical-smoke-evidence", runId));
  rejectRun("new run production overlap", path.join(process.cwd(), "data", "projects", "canonical-smoke-evidence", runId));

  const replacementBase = path.join(testRoot, "new-run-parent-replacement"), parent = path.join(replacementBase, "canonical-smoke-evidence"),
    backup = path.join(replacementBase, "validated-parent"), root = path.join(parent, runId);
  fs.mkdirSync(parent, { recursive: true });
  const restore = setCanonicalEvidenceValidationHooks({ beforeCreateSegment: (segment) => {
    if (path.resolve(segment) !== path.resolve(root)) return;
    fs.renameSync(parent, backup); fs.symlinkSync(backup, parent, "junction");
  } });
  try { rejectRun("new run parent replacement", root); }
  finally { restore(); if (fs.existsSync(parent)) fs.unlinkSync(parent); fs.rmSync(replacementBase, { recursive: true, force: true }); }
}

function temporaryCleanupInvariants(): void {
  cleanupReplacementInvariant("temp replacement after identity capture", "after-capture");
  cleanupReplacementInvariant("temp replacement before failure cleanup", "before-cleanup");
  cleanupReplacementInvariant("publish conflict replacement cleanup", "publish-conflict");
  cleanupReplacementInvariant("cleanup AggregateError preserves primary", "aggregate-error");
  sameInodeMutationInvariant("same inode different size mutation", false);
  sameInodeMutationInvariant("same inode same size content mutation", true);
  sameInodeMutationInvariant("same inode primary and cleanup AggregateError", true);
  sameInodeMutationInvariant("same inode foreign content preserved", false);
  ownedTemporaryCleanupInvariant();
  cleanupReadFailureInvariant("size");
  cleanupReadFailureInvariant("hash");
}

function cleanupReplacementInvariant(name: string, mode: string): void {
  const directory = path.join(testRoot, name.replaceAll(" ", "-")); fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, "manifest.json"), foreign = `foreign-${mode}`, primaryConflict = mode === "publish-conflict" || mode === "aggregate-error";
  if (primaryConflict) writeImmutableJson(target, { seed: true });
  let temporary = "", replaced = false;
  const replace = (temporaryPath: string): void => { if (replaced) return; temporary = temporaryPath;
    fs.unlinkSync(temporaryPath); fs.writeFileSync(temporaryPath, foreign); replaced = true; };
  const restore = setCanonicalEvidenceValidationHooks({
    afterTempIdentityCaptured: (_filePath, temporaryPath) => { if (!primaryConflict) replace(temporaryPath); },
    beforeTempCleanup: (_filePath, temporaryPath) => { if (primaryConflict) replace(temporaryPath); },
  });
  let observed: unknown;
  try { writeImmutableJson(target, { value: mode }); } catch (error) { observed = error; } finally { restore(); }
  assert(observed instanceof AggregateError, `${name}: expected AggregateError`);
  const errors = observed.errors as unknown[];
  assert(errors.some((error) => error instanceof CanonicalEvidenceError &&
    error.code === "EVIDENCE_TEMP_CLEANUP_IDENTITY_MISMATCH"), `${name}: missing cleanup identity error`);
  assert(errors.length >= 2, `${name}: primary error was not preserved`);
  assert(temporary && fs.existsSync(temporary), `${name}: foreign replacement was removed`);
  assert.equal(fs.readFileSync(temporary, "utf8"), foreign, `${name}: foreign replacement changed`);
  fs.unlinkSync(temporary); passed += 1;
}

function sameInodeMutationInvariant(name: string, sameLength: boolean): void {
  const directory = path.join(testRoot, name.replaceAll(" ", "-")); fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, "manifest.json"); writeImmutableJson(target, { seed: true });
  let temporary = "", originalLength = -1, foreign = Buffer.alloc(0), before: fs.BigIntStats | undefined, after: fs.BigIntStats | undefined;
  const restore = setCanonicalEvidenceValidationHooks({ beforeTempCleanup: (_filePath, temporaryPath) => {
    temporary = temporaryPath; const original = fs.readFileSync(temporaryPath); originalLength = original.length;
    foreign = sameLength ? Buffer.alloc(original.length, 0x78) : Buffer.concat([Buffer.from("foreign-size-change:"), original]);
    before = fs.lstatSync(temporaryPath, { bigint: true }); fs.writeFileSync(temporaryPath, foreign);
    after = fs.lstatSync(temporaryPath, { bigint: true });
  } });
  let observed: unknown;
  try { writeImmutableJson(target, { value: name }); } catch (error) { observed = error; } finally { restore(); }
  assert(before && after && before.dev === after.dev && before.ino === after.ino, `${name}: mutation replaced the inode`);
  assert.equal(foreign.length === originalLength, sameLength, `${name}: unexpected mutation length relation`);
  assert(observed instanceof AggregateError, `${name}: expected AggregateError`);
  const errors = observed.errors as unknown[];
  assert.equal(errors.length, 2, `${name}: AggregateError must contain exactly primary and cleanup errors`);
  assert(errors.some((error) => error instanceof CanonicalEvidenceError &&
    error.code === "EVIDENCE_CHILD_INTEGRITY_MISMATCH"), `${name}: primary error was not preserved`);
  assert(errors.some((error) => error instanceof CanonicalEvidenceError &&
    error.code === "EVIDENCE_TEMP_CLEANUP_IDENTITY_MISMATCH"), `${name}: cleanup identity error missing`);
  assert(temporary && fs.existsSync(temporary), `${name}: foreign same-inode entry was removed`);
  assert(fs.readFileSync(temporary).equals(foreign), `${name}: foreign same-inode content changed`);
  fs.unlinkSync(temporary); passed += 1;
}

function ownedTemporaryCleanupInvariant(): void {
  const directory = path.join(testRoot, "owned-temp-cleanup"); fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, "manifest.json"); writeImmutableJson(target, { value: "owned" });
  assert(fs.existsSync(target), "owned temp cleanup: final file missing");
  assert.equal(fs.readdirSync(directory).filter((name) => name.startsWith(".tmp-")).length, 0,
    "owned temp cleanup: temporary entry remained");
  passed += 1;
}

function cleanupReadFailureInvariant(kind: "size" | "hash"): void {
  const name = `cleanup ${kind} read failure`, directory = path.join(testRoot, name.replaceAll(" ", "-"));
  fs.mkdirSync(directory, { recursive: true }); const target = path.join(directory, "manifest.json"); let temporary = "";
  const failure = (): never => { throw new Error(`controlled ${kind} read failure`); };
  const restore = setCanonicalEvidenceValidationHooks({ beforeTempCleanup: (_filePath, temporaryPath) => { temporary = temporaryPath; },
    beforeTempCleanupSizeRead: kind === "size" ? failure : undefined,
    beforeTempCleanupHashRead: kind === "hash" ? failure : undefined });
  try { exact(name, "EVIDENCE_TEMP_CLEANUP_IDENTITY_MISMATCH", () => writeImmutableJson(target, { value: kind })); }
  finally { restore(); }
  assert(temporary && fs.existsSync(temporary), `${name}: temp was removed after unreadable authority`);
  assert(fs.existsSync(target), `${name}: successful immutable publish was lost`);
  fs.unlinkSync(temporary);
}

function exact(name: string, code: CanonicalEvidenceErrorCode, action: () => void): void {
  let observed: unknown; try { action(); } catch (error) { observed = error; }
  assert(observed instanceof CanonicalEvidenceError, `${name}: expected CanonicalEvidenceError, got ${String(observed)}`);
  assert.equal(observed.code, code, `${name}: wrong error ${observed.message}`); passed += 1;
}
function reject(name: string, code: CanonicalEvidenceErrorCode, change: (root: string) => void,
  options: { readonly rebase?: boolean; readonly keepAggregate?: boolean } = {}): void {
  const root = copyFixture(name, options.rebase !== false, options.keepAggregate === true); change(root);
  exact(name, code, () => aggregateEvidence(root));
}
function provenanceReject(name: string, change: (root: string) => void,
  code: CanonicalEvidenceErrorCode = "EVIDENCE_RESUME_PROVENANCE_MISMATCH"): void { reject(name, code, change); }
function resumeReject(name: string, code: CanonicalEvidenceErrorCode, change: (root: string) => void): void {
  const root = copyFixture(name, true, false); makeInterrupted(root); change(root);
  const cli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), runId = path.basename(sourceRoot);
  const result = spawnSync(process.execPath, [cli, path.join(process.cwd(), "scripts", "run-canonical-smoke-evidence.ts"),
    "resume", `--matrix-run-id=${runId}`, `--evidence-root=${root}`], { cwd: process.cwd(), encoding: "utf8", timeout: 60_000 });
  assert.notEqual(result.status, 0, `${name}: unexpectedly resumed`);
  const match = result.stderr.match(/CANONICAL_EVIDENCE_ERROR ({.*})/); assert(match, `${name}: missing exact error: ${result.stderr}`);
  assert.equal((JSON.parse(match[1]) as { code: string }).code, code, `${name}: ${result.stderr}`); passed += 1;
}
function copyFixture(name: string, rebase: boolean, keepAggregate: boolean): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const parent = path.join(testRoot, safe, "canonical-smoke-evidence"), root = path.join(parent, path.basename(sourceRoot));
  fs.mkdirSync(parent, { recursive: true }); fs.cpSync(sourceRoot, root, { recursive: true, dereference: false, errorOnExist: true });
  if (!keepAggregate && fs.existsSync(path.join(root, "aggregate.json"))) fs.unlinkSync(path.join(root, "aggregate.json"));
  if (rebase) rebaseRoot(root); return root;
}
function rebaseRoot(root: string): void {
  const authority = authorityFor(root); mutate(path.join(root, "matrix-manifest.json"), (value) => { value.evidenceRootAuthority = authority; });
  const leasePath = normalize(path.join(root, "active-lease.json"));
  for (const name of orchestratorFiles(root)) mutate(path.join(root, "orchestrators", name), (value) => {
    value.rootAuthority = authority; record(value.leaseAcquiredIdentity).canonicalPath = leasePath;
    record(value.leaseReleasedIdentity).canonicalPath = leasePath;
  });
  rechain(root);
}
function rechain(root: string): void {
  let previousHash: string | null = null, previousId: string | null = null; const records: RecordValue[] = [];
  for (const name of orchestratorFiles(root)) { const updated = mutate(path.join(root, "orchestrators", name), (value) => {
    value.previousOrchestratorId = previousId; value.previousRecordHash = previousHash; });
    previousId = String(updated.orchestratorId); previousHash = String(updated.integrityHash); records.push(updated); }
  const eventPath = path.join(root, "resume-events", "0001.json"); if (fs.existsSync(eventPath) && records.length >= 2)
    mutate(eventPath, (value) => { value.previousOrchestratorId = records[0].orchestratorId; value.previousOrchestratorHash = records[0].integrityHash;
      value.newOrchestratorId = records[1].orchestratorId; value.newOrchestratorHash = records[1].integrityHash;
      const p1 = read(path.join(root, "partitions", "P1.json")); value.preservedPartitionHashes = [{ partitionId: "P1", manifestHash: p1.integrityHash }]; });
}
function rebindBaseline(root: string, baselineHash: string): void {
  mutate(path.join(root, "matrix-manifest.json"), (value) => { value.baselineFingerprint = baselineHash; });
  const childHashes = new Map<string, string>();
  for (const spec of canonicalSmokeChildren) { const manifest = mutate(path.join(root, "children", `${spec.childId}.json`),
    (value) => { value.baselineFingerprint = baselineHash; }); childHashes.set(spec.childId, String(manifest.integrityHash)); }
  for (const partitionName of ["P1", "P2", "P3", "P4", "P5"]) mutate(path.join(root, "partitions", `${partitionName}.json`),
    (value) => { value.baselineFingerprint = baselineHash; value.childManifestHashes = (value.childManifestHashes as RecordValue[])
      .map((item) => ({ childId: item.childId, manifestHash: childHashes.get(String(item.childId))! })); });
  mutate(path.join(root, "final-integrity.json"), (value) => { value.baselineFingerprint = baselineHash; });
  for (const name of orchestratorFiles(root)) mutate(path.join(root, "orchestrators", name),
    (value) => { value.baselineFingerprint = baselineHash; });
  rechain(root);
}
function makeInterrupted(root: string): void {
  for (const name of orchestratorFiles(root).slice(1)) fs.unlinkSync(path.join(root, "orchestrators", name));
  if (fs.existsSync(path.join(root, "resume-events", "0001.json"))) fs.unlinkSync(path.join(root, "resume-events", "0001.json"));
  if (fs.existsSync(path.join(root, "final-integrity.json"))) fs.unlinkSync(path.join(root, "final-integrity.json"));
  for (const spec of canonicalSmokeChildren.filter((item) => item.partitionId !== "P1")) {
    for (const suffix of [`.json`]) { const target = path.join(root, "children", `${spec.childId}${suffix}`); if (fs.existsSync(target)) fs.unlinkSync(target); }
    for (const stream of ["stdout", "stderr"]) { const target = path.join(root, "logs", `${spec.childId}.${stream}.log`); if (fs.existsSync(target)) fs.unlinkSync(target); }
  }
  for (const id of ["P2", "P3", "P4", "P5"]) { const target = path.join(root, "partitions", `${id}.json`); if (fs.existsSync(target)) fs.unlinkSync(target); }
}
function forgeInventory(root: string, manifestPath: string, key: string, marker: string): void {
  const manifest = read(manifestPath), ref = record(manifest[key]), inventoryPath = path.join(root, ...String(ref.relativePath).split("/"));
  const inventory = read(inventoryPath), entries = [...(inventory.entries as RecordValue[])]; entries.push({ relativePath: marker,
    type: "file", reparse: false, device: "0", inode: "0", size: "1", mtimeNs: "0", contentHash: sha256(marker) });
  entries.sort((a, b) => String(a.relativePath).localeCompare(String(b.relativePath), "en"));
  const digest = sha256(entries.map((entry) => canonicalStringify(entry)).join("\n"));
  const integrated = addIntegrity({ schemaVersion: inventory.schemaVersion, kind: "inventory", count: entries.length, digest, entries });
  const bytes = Buffer.from(`${canonicalStringify(integrated)}\n`), fileHash = sha256(bytes), relativePath = `inventories/${fileHash}.json`;
  fs.writeFileSync(path.join(root, ...relativePath.split("/")), bytes);
  mutate(manifestPath, (value) => { value[key] = { relativePath, fileHash, count: entries.length, digest }; });
}
function authorityFor(root: string): RecordValue { const temp = path.resolve(os.tmpdir()), relation = path.relative(temp, root), parts = relation.split(path.sep).filter(Boolean);
  const chain: RecordValue[] = [statIdentity(temp)]; let cursor = temp; for (const part of parts) { cursor = path.join(cursor, part); chain.push(statIdentity(cursor)); }
  return { canonicalPath: normalize(root), rootIdentity: chain.at(-1), parentIdentity: chain.at(-2), parentChain: chain }; }
function statIdentity(target: string): RecordValue { const stat = fs.lstatSync(target, { bigint: true }); return { canonicalPath: normalize(path.resolve(target)),
  device: String(stat.dev), inode: String(stat.ino), type: stat.isDirectory() ? "directory" : "file", reparse: stat.isSymbolicLink() }; }
function orchestratorFiles(root: string): string[] { return fs.readdirSync(path.join(root, "orchestrators")).filter((name) => name.endsWith(".json")).sort(); }
function child(root: string): string { return path.join(root, "children", "foundation.json"); }
function partition(root: string): string { return path.join(root, "partitions", "P1.json"); }
function stdout(root: string): string { return path.join(root, "logs", "foundation.stdout.log"); }
function read(filePath: string): RecordValue { return JSON.parse(fs.readFileSync(filePath, "utf8")) as RecordValue; }
function mutate(filePath: string, change: (value: RecordValue) => void): RecordValue { const value = read(filePath); delete value.integrityHash; change(value);
  const integrated = addIntegrity(value); writeRaw(filePath, integrated); return integrated; }
function writeRaw(filePath: string, value: RecordValue): void { fs.writeFileSync(filePath, `${canonicalStringify(value)}\n`); }
function record(value: unknown): RecordValue { assert(value && typeof value === "object" && !Array.isArray(value)); return value as RecordValue; }
function hashFile(filePath: string): string { return sha256(fs.readFileSync(filePath)); }
function normalize(value: string): string { return value.replaceAll("\\", "/"); }
