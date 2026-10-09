import { buildAyasOwnerPreviewInboxView } from "../src/lib/brain/autonomy/AyasOwnerExactPreviewInbox";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { issueSession, resolveAccessGate } from "../src/lib/auth/accessGate";
import { admitAyasOwnerApproval, type AyasOwnerAdmissionAction } from "../src/lib/brain/autonomy/AyasOwnerApprovalAdmission";
import { createAyasApprovalInboxStore, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { loadAyasOwnerExactPreview, assertAyasOwnerExactPreview } from "../src/lib/brain/autonomy/AyasOwnerExactPreview";
import { readAyasExactPreviewSource } from "../src/lib/brain/autonomy/AyasExactProposalSafety";
import { ayasOwnerExactPreviewAcknowledged } from "../src/lib/brain/autonomy/AyasOwnerExactPreviewContract";
import type { AyasDevelopmentProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxView";
import { readAyasApprovalInboxState } from "../src/lib/brain/autonomy/AyasApprovalInboxReader";
import { loadAyasOwnerRecommendationsView } from "../src/lib/brain/autonomy/AyasOwnerRecommendationsView";
import { executeAyasApprovedProposalWith } from "../src/lib/brain/autonomy/AyasProposalExecutionService";
import { createAyasExecutionJournal } from "../src/lib/brain/autonomy/AyasExecutionJournal";
import { AyasDevelopmentCenter } from "../src/components/brain/AyasDevelopmentCenter";
import { createOwnerExactReviewedPreviewFixture } from "./fixtures/ayas-owner-exact-preview-fixture";

const key = "synthetic-owner-exact-preview-key-no-credential";
process.env.AYAS_ACCESS_KEY = key;
const rows: { id: string; status: string }[] = [];
const sha = (bytes: string | Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
async function admission(proposal: AyasInboxProposal, decision: "APPROVE" | "EXECUTE", action: AyasOwnerAdmissionAction = decision === "APPROVE" ? "ayasOwnerApprovalDecision" : "executeAyasApprovedProposal") {
  const now = Date.now();
  return admitAyasOwnerApproval({ gate: resolveAccessGate(), token: await issueSession(key, now - 1000), action,
    subject: { kind: "proposal", proposalId: proposal.proposalId, proposalHash: proposal.proposalHash, decision }, now });
}
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-owner-preview-"));
  git(root, "init", "-q"); git(root, "config", "user.name", "Preview smoke"); git(root, "config", "user.email", "preview@example.invalid");
  fs.mkdirSync(path.join(root, "scripts"));
  const content = 'console.log(JSON.stringify({status:"PASS",suite:"fixture-generated",scenarios:1}));\n';
  fs.writeFileSync(path.join(root, "scripts/smoke-validator.ts"), content);
  fs.writeFileSync(path.join(root, ".gitignore"), "data/\nnode_modules/\n");
  fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  git(root, "add", "-A"); git(root, "commit", "-qm", "synthetic base");
  const baseHead = git(root, "rev-parse", "HEAD");
  const artifactStore = createAyasPatchArtifactStore({ rootDir: path.join(root, "data/artifacts") });
  const exactFiles = ["scripts/smoke-fixture-generated.ts"];
  const artifact = artifactStore.freeze({ artifactId: `ayas-patch-artifact-${crypto.randomUUID()}`, candidateId: "fixture", generatorIdentity: "fixture",
    baseBranch: "fixture", baseHead, exactFiles, allowedRoots: ["scripts/"], replacements: [{ filePath: exactFiles[0]!, expectedHash: null, content, allowCreate: true }],
    validatorScripts: ["scripts/smoke-validator.ts"], graphifyEvidence: ["synthetic graph"], safetyClassification: "SAFE",
    problemStatement: "fixture", rationale: "fixture", expectedUserBenefit: "fixture", expectedBehaviorChange: "fixture", unchangedBehavior: "fixture",
    risk: "bounded", productionImpact: "none", sandboxValidationSummary: ["fixture validator: PASS"], generatedAt: new Date().toISOString() });
  const inbox = createAyasApprovalInboxStore({ rootDir: path.join(root, "data/inbox"), requireOwnerAdmission: true });
  const proposal = inbox.createProposal({ createdAt: new Date().toISOString(), baseBranch: "fixture", baseHead, objective: "synthetic preview",
    currentProblem: "fixture", selectionReason: "fixture", expectedUserBenefit: "fixture", expectedBehaviorChange: "fixture", unchangedBehavior: "fixture",
    riskIfNotDone: "fixture", technicalRisk: "bounded", productionImpact: "none", rationale: "fixture", evidence: ["fixture"], graphifyEvidence: artifact.graphifyEvidence,
    candidateRank: 1, risk: "bounded", safetyClassification: "SAFE", exactFiles, expectedDiffScope: "one synthetic new test", testsPlanned: artifact.validatorScripts,
    estimatedCost: "zero-cost", mutationKind: "patch-artifact:v1", patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash });
  inbox.decide(proposal.proposalId, "APPROVE", new Date().toISOString(), "owner-approved: pending execution enablement", await admission(proposal, "APPROVE"));
  const approved = inbox.load().proposals[0]!;
  const approval = inbox.load().decisions[0]!;
  const options = { repoRoot: root, artifactStore };
  const preview = loadAyasOwnerExactPreview(approved, approval, options);
  assert.ok(preview, "positive verified artifact fixture must produce a preview");
  const artifactPath = path.join(artifactStore.dir, `${artifact.artifactId}.json`);
  return { root, inbox, proposal: approved, approval, artifactStore, artifact, artifactPath, options, preview, gateRoot: path.join(root, "data/gate") };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function render(f: Fixture, preview = loadAyasOwnerExactPreview(f.proposal, f.approval, f.options)) {
  const view = buildAyasOwnerPreviewInboxView(readAyasApprovalInboxState({ rootDir: path.dirname(path.dirname(f.inbox.stateFile)) }), new Date().toISOString(), undefined, f.options);
  const projected = { ...view.today[0]!, exactPreview: preview } as AyasDevelopmentProposal;
  const inbox = { ...view, today: [projected], history: [projected] };
  return renderToStaticMarkup(createElement(AyasDevelopmentCenter, { inbox, ownerApprovalPendingExecution: loadAyasOwnerRecommendationsView(f.inbox).pendingExecution, onExecute: () => undefined }));
}
function noYurut(f: Fixture, preview = loadAyasOwnerExactPreview(f.proposal, f.approval, f.options)) {
  assert.equal(preview, undefined);
  assert.doesNotMatch(render(f, preview), />YÜRÜT</);
}
function snapshot(f: Fixture) { return { head: git(f.root, "rev-parse", "HEAD"), worktree: git(f.root, "status", "--porcelain"), inbox: sha(fs.readFileSync(f.inbox.stateFile)), journal: createAyasExecutionJournal({ rootDir: f.gateRoot }).list().length }; }
async function execute(f: Fixture, extra: Record<string, unknown> = {}) {
  return executeAyasApprovedProposalWith(f.proposal.proposalId, { repoRoot: f.root, gateRoot: f.gateRoot, inbox: f.inbox, patchArtifactStore: f.artifactStore,
    executionOwnerAdmission: await admission(f.proposal, "EXECUTE"), ownerPreview: f.preview.binding, ...extra });
}
async function scenario(id: string, test: () => Promise<void> | void) { await test(); rows.push({ id, status: "PASS" }); console.log(`PASS ${id}`); }
async function main() {
  await scenario("A-missing", async () => { const f = await fixture(); fs.renameSync(f.artifactPath, `${f.artifactPath}.held`); noYurut(f); });
  await scenario("B-corrupt", async () => { const f = await fixture(); fs.writeFileSync(f.artifactPath, "invalid JSON"); noYurut(f); });
  await scenario("C-digest", async () => { const f = await fixture(); noYurut({ ...f, proposal: { ...f.proposal, patchHash: "f".repeat(64) } }); });
  await scenario("D-baseHead", async () => { const f = await fixture(); noYurut({ ...f, proposal: { ...f.proposal, baseHead: "f".repeat(40) } }); });
  await scenario("E-stale", async () => { const f = await fixture(); noYurut({ ...f, proposal: { ...f.proposal, status: "STALE" } });
    assert.equal(ayasOwnerExactPreviewAcknowledged(f.preview, f.preview.binding.seal, f.proposal, Date.parse(f.preview.binding.expiresAt)), false);
    assert.throws(() => assertAyasOwnerExactPreview(f.preview.binding, f.proposal, f.approval, { ...f.options, now: Date.parse(f.preview.binding.expiresAt) }), /EXACT_PREVIEW_REQUIRED/); });
  await scenario("F-artifact-after-view", async () => { const f = await fixture(); fs.writeFileSync(f.artifactPath, JSON.stringify({ ...f.artifact, sandboxValidationSummary: ["replacement summary"] }));
    assert.equal(f.artifactStore.loadVerified(f.artifact.artifactId).patchHash, f.artifact.patchHash, "patchHash excludes this owner-visible field");
    const before = snapshot(f); await assert.rejects(() => execute(f), /EXACT_PREVIEW_CHANGED/); assert.deepEqual(snapshot(f), before); });
  await scenario("G-valid-reviewed-exact", async () => { const f = createOwnerExactReviewedPreviewFixture();
    f.inbox.decide(f.proposal.proposalId, "APPROVE", new Date().toISOString(), "owner-approved: pending execution enablement", await admission(f.proposal, "APPROVE"));
    const p = f.inbox.load().proposals[0]!, decision = f.inbox.load().decisions[0]!;
    const preview = loadAyasOwnerExactPreview(p, decision, f.options); assert.ok(preview, "actual REVIEW_REQUIRED exact proof + golden-held evidence");
    assert.equal(preview.files[0]?.before, f.before); assert.equal(preview.files[0]?.after, f.after); assert.equal(preview.evidenceIdentity, p.exactPatchSafetyProof?.evidenceHash);
    assert.equal(ayasOwnerExactPreviewAcknowledged(preview, null, p), false); assert.equal(ayasOwnerExactPreviewAcknowledged(preview, preview.binding.seal, p), true);
    assertAyasOwnerExactPreview(preview.binding, p, decision, f.options);
  });
  await scenario("H-pre-write-mismatch-zero-source-effect", async () => { const f = await fixture(); const head = git(f.root, "rev-parse", "HEAD");
    await assert.rejects(() => execute(f, { onJournalPhase: (phase: string) => { if (phase === "EXECUTING") fs.writeFileSync(f.artifactPath, JSON.stringify({ ...f.artifact, sandboxValidationSummary: ["changed during reservation"] })); } }), /EXACT_PREVIEW_CHANGED/);
    assert.equal(fs.existsSync(path.join(f.root, f.proposal.exactFiles[0]!)), false); assert.equal(git(f.root, "rev-parse", "HEAD"), head);
    assert.equal(git(f.root, "status", "--porcelain"), ""); assert.equal(f.inbox.load().proposals[0]?.status, "RECOVERY_REQUIRED"); });
  await scenario("no-snapshot-zero-reservation", async () => { const f = await fixture(); const before = snapshot(f); await assert.rejects(() => execute(f, { ownerPreview: undefined }), /EXACT_PREVIEW_REQUIRED/); assert.deepEqual(snapshot(f), before); });
  await scenario("unsigned-or-tampered-snapshot", async () => { const f = await fixture(); const before = snapshot(f); await assert.rejects(() => execute(f, { ownerPreview: { ...f.preview.binding, snapshotDigest: "f".repeat(64) } }), /EXACT_PREVIEW_CHANGED/); assert.deepEqual(snapshot(f), before); });
  await scenario("unreviewed-identity-replacement", async () => { const f = await fixture(); fs.writeFileSync(f.artifactPath, JSON.stringify({ ...f.artifact, artifactId: "ayas-patch-artifact-replacement" })); noYurut(f); });
  await scenario("scope-evidence-mismatch", async () => { const f = await fixture(); noYurut({ ...f, proposal: { ...f.proposal, exactFiles: ["scripts/other.ts"] } }); noYurut({ ...f, proposal: { ...f.proposal, graphifyEvidence: [] } }); });
  await scenario("dirty-source", async () => { const f = await fixture(); fs.writeFileSync(path.join(f.root, "dirty.txt"), "unexpected"); noYurut(f); });
  await scenario("existing-file-cannot-preview-as-create", async () => { const f = await fixture();
    assert.throws(() => readAyasExactPreviewSource(f.root, f.proposal.baseHead, [{ filePath: "scripts/smoke-validator.ts", expectedHash: null }]), /EXACT_PREVIEW_UNAVAILABLE/); });
  await scenario("current-head-advanced", async () => { const f = await fixture(); fs.writeFileSync(path.join(f.root, "advance.txt"), "new head"); git(f.root, "add", "advance.txt"); git(f.root, "commit", "-qm", "synthetic head advance"); noYurut(f); });
  await scenario("unattributed-approve", async () => { const f = await fixture(); noYurut({ ...f, approval: { ...f.approval, ownerAdmission: undefined } }); });
  await scenario("render-exact-before-ack", async () => { const f = await fixture(); const html = render(f); assert.match(html, /ayas-exact-preview/); assert.match(html, /type="checkbox"/); assert.match(html, new RegExp(f.artifact.patchHash)); assert.match(html, new RegExp(f.proposal.baseHead)); assert.match(html, /Uygulanacak tam içerik/); assert.doesNotMatch(html, />YÜRÜT</); });
  await scenario("ack-does-not-transfer", async () => { const f = await fixture(); assert.equal(ayasOwnerExactPreviewAcknowledged(f.preview, f.preview.binding.seal, f.proposal), true);
    assert.equal(ayasOwnerExactPreviewAcknowledged({ ...f.preview, binding: { ...f.preview.binding, seal: "f".repeat(64) } }, f.preview.binding.seal, f.proposal), false); });
  await scenario("no-fresh-execute", async () => { const f = await fixture(); const before = snapshot(f); await assert.rejects(() => execute(f, { executionOwnerAdmission: undefined }), /OWNER_ADMISSION_REQUIRED/); assert.deepEqual(snapshot(f), before); });
  await scenario("valid-local-once-no-publication", async () => { const f = await fixture(); const head = git(f.root, "rev-parse", "HEAD"); await execute(f);
    assert.equal(fs.readFileSync(path.join(f.root, f.proposal.exactFiles[0]!), "utf8"), f.artifact.replacements[0]?.content);
    assert.equal(git(f.root, "rev-parse", "HEAD"), head); assert.equal(f.inbox.load().proposals[0]?.status, "COMPLETED");
    assert.equal(createAyasExecutionJournal({ rootDir: f.gateRoot }).list().length, 1); await assert.rejects(() => execute(f)); assert.equal(createAyasExecutionJournal({ rootDir: f.gateRoot }).list().length, 1); });
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-owner-exact-preview", scenarios: rows.length, rows, actualRestart: "NOT_RUN", crossProcessRace: "NOT_RUN", reviewedExactExecution: "NOT_RUN" }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
