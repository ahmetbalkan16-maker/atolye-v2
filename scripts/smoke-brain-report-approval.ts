/**
 * Atölye Brain — Report Center operator-approval flow smoke (emir §10 / §11 / §21).
 *
 * The button records a decision; it never applies. Asserts:
 *  - `buildSelfHealDecision` mints a deterministic `operatorApprovalId` + redacts the note;
 *  - `canApplyFromDecision` is true ONLY for APPROVE (REJECT / LATER / none → false);
 *  - the CLI `apply` gate resolves the approval id from an APPROVE decision;
 *  - the report view exposes decision buttons ONLY for a decidable, non-FORBIDDEN incident;
 *  - a FORBIDDEN-area fix is `needsHumanDirect` with no approve path.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  advanceIncident,
  buildBrainIncident,
  type BrainIncidentCheck,
} from "../src/lib/brain/selfheal/BrainIncident";
import {
  buildSelfHealDecision,
  canApplyFromDecision,
  describeSelfHealDecision,
} from "../src/lib/brain/selfheal/BrainSelfHealDecision";
import { buildBrainReportCenterView } from "../src/lib/brain/selfheal/BrainReportCenter";
import { createBrainSelfHealStore } from "../src/lib/brain/selfheal/BrainSelfHealStore";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const NOW = "2026-09-12T13:00:00.000Z";
const GREEN: BrainIncidentCheck[] = [
  { name: "tsc", kind: "typecheck", status: "PASS", detail: "0" },
  { name: "eslint", kind: "lint", status: "PASS", detail: "0" },
  { name: "build", kind: "build", status: "PASS", detail: "0" },
  { name: "smoke", kind: "smoke", status: "PASS", detail: "" },
];

function verified(files: string[], safety: "SAFE" | "REVIEW_REQUIRED" | "FORBIDDEN_AUTONOMOUS" = "SAFE") {
  let i = buildBrainIncident({ category: "voice", severity: "P1", classification: "REAL_INCIDENT", symptom: "erken kapanma", now: NOW });
  i = advanceIncident(i, { kind: "diagnose", now: NOW, hypotheses: [{ statement: "x", confidence: 0.85, evidence: [], counterEvidence: [], suspectFiles: files }] }).incident;
  i = advanceIncident(i, { kind: "sandbox-patch", now: NOW, patch: { patchId: "p", baseCommit: "abc", changedFiles: files, diff: "@@", diffLines: 9, safetyLevel: safety, risk: "LOW", rollbackPlan: "x", attempt: 1 } }).incident;
  i = advanceIncident(i, { kind: "checks", now: NOW, checks: GREEN }).incident;
  i = advanceIncident(i, { kind: "verified", now: NOW }).incident;
  i = advanceIncident(i, { kind: "await-approval", now: NOW }).incident;
  return i;
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sh-appr-"));
}

async function run() {
  await scenario("decision — deterministic approvalId; same inputs → same id", () => {
    const a = buildSelfHealDecision({ incidentId: "sh-1", decision: "APPROVE", now: NOW });
    const b = buildSelfHealDecision({ incidentId: "sh-1", decision: "APPROVE", now: NOW });
    assert.equal(a.operatorApprovalId, b.operatorApprovalId);
    assert.match(a.operatorApprovalId, /^op-[0-9a-f]{8}$/);
    const c = buildSelfHealDecision({ incidentId: "sh-1", decision: "REJECT", now: NOW });
    assert.notEqual(a.operatorApprovalId, c.operatorApprovalId);
  });

  await scenario("decision — a bad incidentId / decision is refused", () => {
    assert.throws(() => buildSelfHealDecision({ incidentId: "../x", decision: "APPROVE", now: NOW }));
    // @ts-expect-error deliberately bad
    assert.throws(() => buildSelfHealDecision({ incidentId: "sh-1", decision: "MAYBE", now: NOW }));
  });

  await scenario("canApplyFromDecision — true ONLY for APPROVE", () => {
    assert.equal(canApplyFromDecision(buildSelfHealDecision({ incidentId: "sh-1", decision: "APPROVE", now: NOW })), true);
    assert.equal(canApplyFromDecision(buildSelfHealDecision({ incidentId: "sh-1", decision: "REJECT", now: NOW })), false);
    assert.equal(canApplyFromDecision(buildSelfHealDecision({ incidentId: "sh-1", decision: "LATER", now: NOW })), false);
    assert.equal(canApplyFromDecision(undefined), false);
    assert.equal(canApplyFromDecision(null), false);
  });

  await scenario("describeSelfHealDecision — human line, Turkish verb", () => {
    const line = describeSelfHealDecision(buildSelfHealDecision({ incidentId: "sh-9", decision: "APPROVE", now: NOW, note: "sandbox yeşil" }));
    assert.match(line, /sh-9/);
    assert.match(line, /ONAYLANDI/);
    assert.match(line, /approvalId op-/);
  });

  await scenario("store — the CLI-gate flow: record APPROVE → apply resolves the approvalId", () => {
    const root = tmp();
    try {
      const store = createBrainSelfHealStore({ rootDir: root });
      const inc = verified(["scripts/smoke-x.ts"]);
      store.saveIncident(inc);
      store.recordSelfHealDecision(buildSelfHealDecision({ incidentId: inc.id, decision: "APPROVE", now: NOW }));
      const d = store.loadSelfHealDecision(inc.id);
      assert.equal(canApplyFromDecision(d), true);
      assert.match(d!.operatorApprovalId, /^op-/);
      // a later REJECT flips it back off
      store.recordSelfHealDecision(buildSelfHealDecision({ incidentId: inc.id, decision: "REJECT", now: "2026-09-12T14:00:00.000Z" }));
      assert.equal(canApplyFromDecision(store.loadSelfHealDecision(inc.id)), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("report view — a SAFE verified incident is decidable (buttons shown)", () => {
    const r = buildBrainReportCenterView({ incidents: [verified(["scripts/smoke-x.ts"])], learned: [], decisions: [], now: NOW }).reports[0];
    assert.equal(r.canDecide, true);
    assert.equal(r.needsHumanDirect, false);
  });

  await scenario("report view — a REVIEW_REQUIRED verified incident is still decidable by the operator", () => {
    const r = buildBrainReportCenterView({ incidents: [verified(["src/components/brain/voice/wakeWordVoiceAdapter.ts"], "REVIEW_REQUIRED")], learned: [], decisions: [], now: NOW }).reports[0];
    assert.equal(r.canDecide, true);
  });

  await scenario("report view — a FORBIDDEN-area fix is needsHumanDirect, NOT decidable", () => {
    const r = buildBrainReportCenterView({ incidents: [verified(["src/lib/brain/selfheal/BrainSelfHealGuards.ts"], "FORBIDDEN_AUTONOMOUS")], learned: [], decisions: [], now: NOW }).reports[0];
    assert.equal(r.needsHumanDirect, true);
    assert.equal(r.canDecide, false);
  });

  await scenario("report view — once APPROVED, no further decision offered", () => {
    const inc = verified(["scripts/smoke-x.ts"]);
    const r = buildBrainReportCenterView({
      incidents: [inc],
      learned: [],
      decisions: [buildSelfHealDecision({ incidentId: inc.id, decision: "APPROVE", now: NOW })],
      now: NOW,
    }).reports[0];
    assert.equal(r.canDecide, false);
    assert.equal(r.operatorDecision?.decision, "APPROVE");
  });

  console.log(`Atölye Brain report-approval smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-report-approval", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
