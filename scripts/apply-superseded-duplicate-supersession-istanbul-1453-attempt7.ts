import { ProductionExecutionFilePersistenceAdapter } from "../src/lib/production/ProductionExecutionPersistence";
import { classifyProductionDurableAttemptLineage } from "../src/lib/production/ProductionDurableAttemptLineageClassifier";
import {
  evaluateAndPublishSupersededDuplicateReservationDecision,
  findSupersessionDecisionForCandidate,
  readProductionSupersededDuplicateReservationAuthority,
  validateProductionSupersededDuplicateReservationAuthorityBody,
} from "../src/lib/production/ProductionSupersededDuplicateReservationAuthority";
import { getProjectRoot } from "../src/lib/runtime/RuntimeStoragePaths";
import path from "node:path";
import fs from "node:fs";

/**
 * ONE-TIME, EXPLICITLY OPERATOR-APPROVED apply for the real
 * i-stanbul-un-fethi-1453 / assembly duplicate-ordinal-7 case, per the
 * user's explicit, scoped production-apply approval. Publishes exactly ONE
 * ProductionSupersededDuplicateReservationAuthority decision naming:
 *   candidate  = pipeline-record-ca987045... (Gen 2, orphaned before claim)
 *   canonical  = pipeline-record-1ab478279f9a... (Gen 3, genuinely executed)
 * Then performs READ-ONLY verification: read-back + structural/integrity
 * check, and a real classifyProductionDurableAttemptLineage() call against
 * the REAL adapter to confirm the duplicate now resolves to `valid`.
 *
 * This script never mutates any existing idempotency/reservation/claim/
 * attempt record, never touches ProductionOrphanReservationToleranceAuthority,
 * never calls retry/resume/execute/render/FFmpeg/AI, and never runs
 * reconcileFailedPipelineExecution or any retry-admission path -- it writes
 * exactly one new, append-only sibling file and then only reads.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const candidateRecordId = "pipeline-record-ca987045bc8dc5fa60a86406342051cbd03eec7aa534fd2b713ea3b36c9828c2";
const canonicalRecordId = "pipeline-record-1ab478279f9a4b508f5187ee6f822c996972d548d8b56e816f3f8d1e25b3206f";

async function main() {
  const trustedRootDirectory = path.join(getProjectRoot(projectSlug), "production-execution");
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory, createRootDirectory: false,
  });

  console.log("=== PRE-APPLY: confirm no decision exists yet ===");
  const preExisting = findSupersessionDecisionForCandidate(projectSlug, stage, candidateRecordId);
  console.log("pre-existing discovery:", JSON.stringify(preExisting));
  if (preExisting.status !== "none") {
    console.log("ABORT: a decision already exists or is ambiguous/invalid -- not proceeding.");
    return;
  }

  console.log("\n=== APPLY: evaluateAndPublishSupersededDuplicateReservationDecision (REAL production adapter) ===");
  const result = await evaluateAndPublishSupersededDuplicateReservationDecision(
    adapter, { projectSlug, stage, candidateRecordId, canonicalRecordId },
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.log("\nAPPLY REFUSED (fail-closed) -- no decision was published. STOPPING.");
    return;
  }

  console.log("\n=== POST-APPLY VERIFICATION (read-only) ===");

  console.log("--- 1) Read-back via findSupersessionDecisionForCandidate ---");
  const discovery = findSupersessionDecisionForCandidate(projectSlug, stage, candidateRecordId);
  console.log(JSON.stringify(discovery, null, 2));
  if (discovery.status !== "found") {
    console.log("UNEXPECTED: discovery does not report 'found' immediately after a successful publish.");
    return;
  }

  console.log("--- 2) Structural/integrity re-validation of the read-back body ---");
  const structurallyValid = validateProductionSupersededDuplicateReservationAuthorityBody(discovery.decision);
  console.log("structurally valid:", structurallyValid);

  console.log("--- 3) Direct file read-back via readProductionSupersededDuplicateReservationAuthority ---");
  const directRead = readProductionSupersededDuplicateReservationAuthority(projectSlug, discovery.decision.decisionId);
  console.log(JSON.stringify({ ok: directRead.ok, status: directRead.status, reasonCode: directRead.reasonCode }));

  console.log("--- 4) Classifier consumption check (REAL adapter, REAL data, preparation mode expected=8) ---");
  const classified = await classifyProductionDurableAttemptLineage(adapter, projectSlug, stage, 8, "preparation");
  console.log(JSON.stringify(classified, (k, v) => (k === "journal" ? undefined : v), 2));

  console.log("--- 5) Classifier consumption check (exact mode, expected=7 -- targets canonical's own ordinal) ---");
  const classifiedExact = await classifyProductionDurableAttemptLineage(adapter, projectSlug, stage, 7, "exact");
  console.log(JSON.stringify(classifiedExact, (k, v) => (k === "journal" ? undefined : v), 2));

  console.log("--- 6) Confirm no existing durable record was physically touched: raw idempotency file count ---");
  const idempotencyDir = path.join(trustedRootDirectory, "idempotency");
  const idempotencyFiles = fs.readdirSync(idempotencyDir).filter((f) => f.endsWith(".json"));
  console.log("total idempotency version-files on disk:", idempotencyFiles.length);

  console.log("--- 7) Confirm the ONLY new artifact is the single decision file ---");
  const decisionsDir = path.join(trustedRootDirectory, "superseded-duplicate-reservations");
  const decisionFiles = fs.existsSync(decisionsDir) ? fs.readdirSync(decisionsDir) : [];
  console.log("files in superseded-duplicate-reservations/:", JSON.stringify(decisionFiles));

  console.log("\n=== DONE ===");
}

void main();
