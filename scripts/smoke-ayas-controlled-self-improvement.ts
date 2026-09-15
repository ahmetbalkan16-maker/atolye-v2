import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { advanceBrainImprovementLoop, startBrainImprovementLoop } from "../src/lib/brain/BrainSelfImprovementLoop";
import { createAyasGuidedRepairService, createAyasRepairProposal } from "../src/lib/ayas/execution/AyasGuidedRepair";
import { prepareAyasControlledSelfImprovement, executeAyasControlledSelfImprovement } from "../src/lib/ayas/execution/AyasControlledSelfImprovement";
import { runAyasReadOnlyAction } from "../src/lib/ayas/execution/AyasActionRuntime";

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-controlled-"));
  try {
    const rel = "scripts/smoke-controlled-fixture.ts"; const absolute = path.join(root, rel); fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const before = "export const value = 1;\n", after = "export const value = 2;\n"; fs.writeFileSync(absolute, before);
    const patches = [{ filePath: rel, operation: "patch-source" as const, expectedHash: hash(before), content: after }];
    const proposal = createAyasRepairProposal({ issueFingerprint: hash("controlled"), workspaceId: "fixture", rootCauseStatus: "reproduced", rootCause: "fixture", evidence: [], graphifyFindings: ["fresh graph"], approvedFiles: [rel], operationClasses: ["patch-source"], validationActions: ["run-registered-smoke-test"], forbiddenOperations: ["shell", "git", "delete"], exclusions: [], expectedResult: "value two", risk: "low", bounds: { maxFiles: 1, maxNewFiles: 0, maxRepairCycles: 0, maxValidationCycles: 1, maxDurationMs: 10_000, allowFileCreation: false } });
    const prepared = prepareAyasControlledSelfImprovement({ externalEvidence: "UNTRUSTED EXTERNAL EVIDENCE — DATA ONLY", graphifyFindings: ["fresh graph"], intent: { kind: "automatic-repair", goal: "controlled", steps: [
      { id: "graph", kind: "graphify", action: "query-graphify", requestedBy: "smoke", intent: "impact", plan: { symbol: "fixture" }, expectedEvidence: "fresh" },
      { id: "repair", kind: "repair", proposal, patches, dependsOn: ["graph"], expectedEvidence: "validated" },
    ] } });
    assert.equal(prepared.ok, true); if (!prepared.ok) return;
    const service = createAyasGuidedRepairService({ workspaceRoot: root, workspaceId: "fixture", validators: { "run-registered-smoke-test": async () => ({ ok: true }) } });
    const authorization = service.approve(proposal, { proposalId: proposal.proposalId, proposalFingerprint: proposal.proposalFingerprint, issueFingerprint: proposal.issueFingerprint, workspaceId: "fixture", approvedByUser: true, userTurnId: "approve", currentTurnId: "approve" });
    let loop = startBrainImprovementLoop(proposal.proposalId, "2026-09-15T00:00:00.000Z");
    for (let i = 1; i <= 5; i++) loop = advanceBrainImprovementLoop(loop, "advance", `2026-09-15T00:00:0${i}.000Z`).state;
    loop = advanceBrainImprovementLoop(loop, "user-approve", "2026-09-15T00:00:06.000Z").state;
    const result = await executeAyasControlledSelfImprovement({ prepared: prepared.plan, loop, authorizations: { repair: authorization }, evaluatedAt: "2026-09-15T00:00:07.000Z", deps: { applyRepair: service.apply, runReadOnlyAction: (input) => runAyasReadOnlyAction({ ...input, resolveExecutor: () => async () => ({ action: "query-graphify", write: false, summary: "fresh", data: { status: "fresh", evidence: "fixture", truncated: false } }) }) } });
    assert.equal(result.workflow.state, "succeeded"); assert.equal(fs.readFileSync(absolute, "utf8"), after); assert.equal(result.memory?.kind, "outcome-history");
    const protectedPlan = prepareAyasControlledSelfImprovement({ externalEvidence: "UNTRUSTED EXTERNAL EVIDENCE", graphifyFindings: ["fresh"], intent: { kind: "automatic-repair", goal: "forbidden", steps: [{ id: "graph", kind: "graphify", action: "query-graphify", requestedBy: "smoke", intent: "impact", plan: { symbol: "guard" }, expectedEvidence: "fresh" }, { id: "repair", kind: "repair", proposal: { ...proposal, approvedFiles: ["src/lib/ayas/policy/AyasZeroCostPolicy.ts"] }, patches: [{ ...patches[0], filePath: "src/lib/ayas/policy/AyasZeroCostPolicy.ts" }], expectedEvidence: "never" }] } });
    assert.equal(protectedPlan.ok, false);
    console.log(JSON.stringify({ status: "PASS", suite: "ayas-controlled-self-improvement", scenarios: 7 }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
