// Read-only supplemental review. Synthetic credentials and in-memory seams only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = process.argv[2];
const auth = require(path.join(root, 'src/lib/auth/accessGate.ts'));
const k3 = require(path.join(root, 'src/lib/brain/autonomy/AyasOwnerApprovalAdmission.ts'));
const key = 'synthetic-codex-owner-review-key';
const gate = auth.resolveAccessGate({ AYAS_ACCESS_KEY: key, NODE_ENV: 'production' });
const observations = [];
async function main() {
  const now = Math.floor(Date.now() / 1000) * 1000;
  const subject = { kind: 'proposal', proposalId: 'ayas-proposal-synthetic', proposalHash: 'synthetic-proposal-digest', decision: 'APPROVE' };
  const tokenA = await auth.issueSession(key, now);
  const tokenSameSecond = await auth.issueSession(key, now + 500);
  assert.equal(tokenA, tokenSameSecond);
  observations.push({ id: 'P1', finding: 'SAME_SECOND_LOGINS_HAVE_IDENTICAL_SESSION_REFERENCE', reproduced: true });
  const admission = await k3.admitAyasOwnerApproval({ gate, token: tokenA, action: 'decideAyasApproval', subject, now });
  assert.equal(await k3.verifyAyasOwnerAdmissionSeal(admission, key), true);
  const expected = { subject, at: new Date(now).toISOString(), usedActionRefs: new Set() };
  assert.equal(k3.checkAyasOwnerAdmissionBinding(admission, expected).ok, true);
  observations.push({ id: 'P2', control: 'VALID_ADMISSION_AND_SEAL_ACCEPTED', passed: true });
  const tampered = { ...admission, seal: '0'.repeat(64) };
  assert.equal(await k3.verifyAyasOwnerAdmissionSeal(tampered, key), false);
  assert.equal(k3.checkAyasOwnerAdmissionBinding(tampered, expected).ok, true);
  observations.push({ id: 'P3', finding: 'BINDING_ACCEPTS_INVALID_SEAL', reproduced: true, scope: 'persisted/in-process record; no browser identity injection demonstrated' });
  const decision = { decision: 'APPROVE', decidedAt: expected.at, proposalId: subject.proposalId, proposalHash: subject.proposalHash, ownerAdmission: tampered };
  assert.equal(k3.isAyasApprovalDecisionOwnerAdmitted(decision, subject), true);
  observations.push({ id: 'P4', finding: 'RESUME_EXECUTE_ELIGIBILITY_ACCEPTS_INVALID_SEAL', reproduced: true });
  const nearExpiryToken = await auth.issueSession(key, now - auth.AYAS_SESSION_TTL_SECONDS * 1000 + 1000);
  const nearExpiry = await k3.admitAyasOwnerApproval({ gate, token: nearExpiryToken, action: 'decideAyasApproval', subject, now });
  assert.equal(await auth.verifySession(nearExpiryToken, key, now + 2000), false);
  assert.equal(k3.checkAyasOwnerAdmissionBinding(nearExpiry, { ...expected, at: new Date(now + 2000).toISOString() }).ok, true);
  observations.push({ id: 'P5', finding: 'DECISION_BOUNDARY_ACCEPTS_EXPIRED_SESSION_WITHIN_FIVE_MINUTES', reproduced: true });
  assert.equal(k3.checkAyasOwnerAdmissionBinding(admission, { ...expected, usedActionRefs: new Set([admission.actionRef]) }).reason, 'ACTION_REF_REUSED');
  assert.equal(k3.checkAyasOwnerAdmissionBinding(admission, { ...expected, subject: { ...subject, proposalHash: 'different' } }).reason, 'SUBJECT_MISMATCH');
  observations.push({ id: 'P6', control: 'REPLAY_AND_STALE_SUBJECT_REFUSED', passed: true });
  const tokenB = await auth.issueSession(key, now - 5000);
  const executionAdmission = await k3.admitAyasOwnerApproval({ gate, token: tokenB, action: 'executeAyasApprovedProposal', subject: { ...subject, decision: 'EXECUTE' }, now });
  assert.notEqual(executionAdmission.sessionRef, admission.sessionRef);
  const source = ts.createSourceFile('actions.ts', fs.readFileSync(path.join(root, 'app/brain/actions.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'executeAyasApprovedProposal');
  const js = ts.transpileModule(fn.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let executed = 0, captured;
  const deps = { synthetic: true };
  const validDecision = { ...decision, ownerAdmission: admission };
  const state = { proposals: [{ proposalId: subject.proposalId, proposalHash: subject.proposalHash }], decisions: [validDecision] };
  const action = vm.runInNewContext(js + '\nexports.executeAyasApprovedProposal', {
    exports: {}, requireBrainSession: async () => {},
    createAyasApprovalInboxStore: () => ({ load: () => state }),
    requireOwnerApprovalAdmission: async () => executionAdmission,
    isAyasApprovalDecisionOwnerAdmitted: k3.isAyasApprovalDecisionOwnerAdmitted,
    executeAyasApprovedProposalWith: async (...args) => { executed++; captured = args; },
    defaultAyasProposalExecutionDeps: () => deps,
    loadAyasApprovalInboxView: () => ({ synthetic: true }),
    AyasProposalExecutionError: class extends Error {},
  });
  const result = await action({ proposalId: subject.proposalId });
  assert.equal(result.ok, true); assert.equal(executed, 1);
  assert.equal(captured[1], deps); assert.equal(captured[1].ownerAdmission, undefined);
  observations.push({ id: 'P7', finding: 'CROSS_SESSION_EXECUTE_ALLOWED_AND_EXECUTE_ADMISSION_DISCARDED', reproduced: true, scope: 'real action body with stubbed executor; no live execution' });
  state.decisions = [{ ...validDecision, ownerAdmission: undefined }];
  const denied = await action({ proposalId: subject.proposalId });
  assert.equal(denied.ok, false); assert.equal(executed, 1);
  observations.push({ id: 'P8', control: 'UNATTRIBUTED_APPROVAL_REFUSED_BEFORE_EXECUTOR', passed: true });
  // Durable consent is evaluated at original decision time, not resume time.
  assert.equal(await auth.verifySession(tokenA, key, now + (auth.AYAS_SESSION_TTL_SECONDS + 1) * 1000), false);
  assert.equal(k3.isAyasApprovalDecisionOwnerAdmitted(validDecision, subject), true);
  observations.push({ id: 'P9', observation: 'DURABLE_APPROVAL_HAS_NO_CURRENT_SESSION_EXPIRY_CHECK', confirmed: true, policyDecisionRequired: true });
  console.log(JSON.stringify({ schemaVersion: '1', candidate: 'bc9f5fd9ad77d14d14c1a09da28a845015b50f15', observedAt: new Date().toISOString(), method: 'PURE_FUNCTIONS_AND_REAL_ACTION_VM_WITH_NOOP_EXECUTOR', findingsAreNotSecurityPass: true, observations }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
