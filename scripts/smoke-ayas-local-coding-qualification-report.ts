import assert from "node:assert/strict";

import { summarizeAyasLocalCodingQualification, AyasLocalCodingQualificationReportError,
  type AyasLocalCodingQualificationAttempt } from "../src/lib/brain/autonomy/AyasLocalCodingQualificationReport";
import { AYAS_LOCAL_CODING_QUALIFICATION_VAULT } from "./fixtures/ayas-local-coding-qualification-vault";

const cases = AYAS_LOCAL_CODING_QUALIFICATION_VAULT.map(({ caseId, split, baseHead, evaluatorBlob, exactFiles, maxChangedLines }) =>
  ({ caseId, split, baseHead, evaluatorBlob, exactFiles, maxChangedLines }));
const attempt = (index: number, repeatIndex: number): AyasLocalCodingQualificationAttempt => {
  const item = cases[index]!;
  return { caseId: item.caseId, repeatIndex, baseHead: item.baseHead, evaluatorBlob: item.evaluatorBlob,
    engineBinarySha256: "a".repeat(64), imageDigest: `local/ayas-probe@sha256:${"b".repeat(64)}`,
    modelDigest: "c".repeat(64), candidateSha256: "d".repeat(64), changedFiles: [item.exactFiles[0]!],
    changedLines: 10, outcome: "PASS", regressionsPass: true, negativeControlRejected: true,
    toolMisuseCount: 0, unauthorizedFileAccessCount: 0, unauthorizedShellAttemptCount: 0,
    unauthorizedNetworkAttemptCount: 0, elapsedMs: 1200, cpuMs: 800, peakRamBytes: 10_000_000, peakVramBytes: null };
};
const attempts = cases.flatMap((_, index) => [attempt(index, 1), attempt(index, 2)]);
const run = (rows: readonly unknown[] = attempts) => summarizeAyasLocalCodingQualification({ cases, attempts: rows, repeatCount: 2 });
const report = run();
assert.equal(report.status, "UNVERIFIED_HOST_DIAGNOSTIC");
assert.equal(report.modelRunsClaimed, 6);
assert.equal(report.passAt1Claimed, 1);
assert.equal(report.passPowerKClaimed, 1);
assert.equal(report.heldOutPassAt1Claimed, 1);
assert.deepEqual(report.peakVramBytes, Array(6).fill(null));

let scenarios = 1;
function denied(rows: readonly unknown[]): void {
  assert.throws(() => run(rows), AyasLocalCodingQualificationReportError);
  scenarios += 1;
}
denied(attempts.slice(1));
denied([...attempts.slice(0, 5), attempts[0]]);
denied(attempts.map((row, index) => index === 0 ? { ...row, evaluatorBlob: "f".repeat(40) } : row));
denied(attempts.map((row, index) => index === 0 ? { ...row, imageDigest: `local/other@sha256:${"b".repeat(64)}` } : row));
denied(attempts.map((row, index) => index === 0 ? { ...row, approval: true } : row));
denied(attempts.map((row, index) => index === 0 ? { ...row, elapsedMs: Number.NaN } : row));
denied(attempts.map((row, index) => index === 0 ? { ...row, changedFiles: ["../private.ts"] } : row));
denied(attempts.map((row, index) => index === 0 ? { ...row, changedFiles: ["src/../private.ts"] } : row));
denied(attempts.map((row, index) => index === 0 ? { ...row, outcome: { toString: (): string => "PASS" } } : row));
denied(attempts.map((row, index) => index === 0 ? { ...row, repeatIndex: 3 } : row));

const unsafe = run(attempts.map((row, index) => index === 0 ? { ...row, changedFiles: ["src/lib/other.ts"],
  unauthorizedNetworkAttemptCount: 1 } : row));
assert.equal(unsafe.status, "UNVERIFIED_HOST_DIAGNOSTIC");
assert.equal(unsafe.scopeViolations, 1);
assert.equal(unsafe.unauthorizedNetworkAttempts, 1);
assert.equal(unsafe.passAt1Claimed, 2 / 3);
assert.equal(unsafe.passPowerKClaimed, 2 / 3);
scenarios += 1;
const incompleteMetrics = run(attempts.map((row, index) => index === 0 ? { ...row, cpuMs: null, peakRamBytes: null } : row));
assert.equal(incompleteMetrics.cpuMs[0], null);
assert.equal(incompleteMetrics.peakRamBytes[0], null);
scenarios += 1;
console.log(JSON.stringify({ status: "PASS", suite: "ayas-local-coding-qualification-report", scenarios,
  evidence: "synthetic observations only; no model/engine execution or readiness" }));
