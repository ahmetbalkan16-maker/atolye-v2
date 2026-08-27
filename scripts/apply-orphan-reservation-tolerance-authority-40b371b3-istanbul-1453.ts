import fs from "node:fs";
import path from "node:path";
import {
  ProductionExecutionFilePersistenceAdapter,
} from "../src/lib/production/ProductionExecutionPersistence";
import { validateProductionGlobalTerminalQuiescence } from
  "../src/lib/production/ProductionGlobalTerminalQuiescence";
import {
  buildProductionOrphanReservationToleranceAuthorityBody,
  writeProductionOrphanReservationToleranceAuthority,
  readProductionOrphanReservationToleranceAuthority,
  validateProductionOrphanReservationToleranceAuthorityBody,
  reservationContentFingerprint,
  findMatchingOrphanReservationToleranceAuthority,
  anyDurableRecordReferencesReservationId,
  resolveOrphanReservationTolerance,
} from "../src/lib/production/ProductionOrphanReservationToleranceAuthority";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import type { ProductionExecutionIdempotencyReservationRequest } from
  "../src/types/productionExecutionIdempotency";

/**
 * APPROVED, ONE-TIME production apply -- sibling of
 * apply-orphan-reservation-tolerance-authority-istanbul-1453.ts (that script
 * is NOT modified by this file). Creates a single, narrowly-scoped orphan
 * reservation tolerance authority for exactly ONE reservation:
 *
 *   data/projects/i-stanbul-un-fethi-1453/production-execution/
 *     reservations/idempotency-identity-40b371b3.json
 *
 * Bound idempotency record: pipeline-record-ca987045bc8dc5fa60a86406342051
 * cbd03eec7aa534fd2b713ea3b36c9828c2 (stage=assembly, attempt=7, latest
 * state=cancelled, zero claim, zero attempt artifact -- see this session's
 * 19-record forensic report). This is a DIFFERENT orphan shape than
 * c1ca1524 (which has zero idempotency record at all): 40b371b3 has a full,
 * well-formed idempotency version history that ends "cancelled" with no
 * claim/attempt ever created for it -- exactly the shape
 * ProductionGlobalTerminalQuiescence.ts's tolerateCancelledOrphanRecord()
 * was built to admit, via the same resolveOrphanReservationTolerance()
 * authority-lookup mechanism c1ca1524 uses.
 *
 * This script accepts ONLY "idempotency-identity-40b371b3" -- the target
 * reservation id, project slug, stage, and expected attempt are all
 * hardcoded constants, not CLI-supplied, so there is no way to point this
 * at any other reservation. It does not touch
 * ProductionOrphanReservationToleranceAuthority.ts,
 * ProductionGlobalTerminalQuiescence.ts, or any other production mechanism
 * file -- it only calls their existing exported functions.
 *
 * Two commands:
 *   preflight -- fully read-only. Never writes. Reports every fresh
 *     eligibility fact this order requires (reservation match, full
 *     idempotency version history + states, disqualifying-state scan,
 *     claim/attempt scan, CAS content fingerprint, existing-authority
 *     check) and a final eligible/not-eligible verdict.
 *   apply -- re-runs the exact same eligibility check fresh (never trusts
 *     an earlier preflight run), aborts on ANY failed condition, and only
 *     if every condition passes writes the single authority artifact, then
 *     reads it back and re-validates it, then re-verifies read-only via
 *     resolveOrphanReservationTolerance() and
 *     validateProductionGlobalTerminalQuiescence() against the real
 *     (otherwise untouched) store.
 *
 * No reservation, idempotency record, claim, attempt, lease, manifest, or
 * pipeline-job file is ever written by this script. No regeneration,
 * prepare, execute, resume, or FFmpeg call is made.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const jobId = `${projectSlug}-${stage}`;
const targetReservationId = "idempotency-identity-40b371b3";
const targetRecordId =
  "pipeline-record-ca987045bc8dc5fa60a86406342051cbd03eec7aa534fd2b713ea3b36c9828c2";
const expectedAttempt = 7;
const expectedOperation = "pipeline.stage.resume";
const disqualifyingStates = new Set(["running", "succeeded", "partially-succeeded"]);
const acceptableLatestState = "cancelled";

const root = path.join(process.cwd(), "data", "projects", projectSlug);
const durableRoot = path.join(root, "production-execution");

interface EligibilityResult {
  eligible: boolean;
  reasonIfNotEligible?: string;
  reservationFound: boolean;
  reservationMatchesTuple: boolean;
  reservation?: ProductionExecutionIdempotencyReservationRequest;
  idempotencyVersions: { file: string; version: number; state: string; recordId: string }[];
  latestState?: string;
  disqualifyingStatesFound: string[];
  matchingClaims: string[];
  matchingAttempts: string[];
  existingAuthorityMatch?: { authorityId: string };
  reservationContentFingerprintValue?: string;
}

function freshEligibilityCheck(): EligibilityResult {
  // A. Exact reservation.
  const reservationPath = path.join(durableRoot, "reservations", `${targetReservationId}.json`);
  if (!fs.existsSync(reservationPath)) {
    return {
      eligible: false, reasonIfNotEligible: "TARGET_RESERVATION_NOT_FOUND",
      reservationFound: false, reservationMatchesTuple: false,
      idempotencyVersions: [], disqualifyingStatesFound: [], matchingClaims: [], matchingAttempts: [],
    };
  }
  let reservation: ProductionExecutionIdempotencyReservationRequest;
  try {
    reservation = JSON.parse(fs.readFileSync(reservationPath, "utf8"));
  } catch {
    return {
      eligible: false, reasonIfNotEligible: "TARGET_RESERVATION_UNREADABLE",
      reservationFound: false, reservationMatchesTuple: false,
      idempotencyVersions: [], disqualifyingStatesFound: [], matchingClaims: [], matchingAttempts: [],
    };
  }
  const reservationMatchesTuple =
    reservation.identity?.identityFingerprint === targetReservationId &&
    reservation.identity?.projectSlug === projectSlug &&
    reservation.identity?.stage === stage &&
    reservation.identity?.operation === expectedOperation &&
    reservation.attempt === expectedAttempt &&
    reservation.schemaVersion === "1" &&
    reservation.identity?.schemaVersion === "1";
  if (!reservationMatchesTuple) {
    return {
      eligible: false, reasonIfNotEligible: "RESERVATION_TUPLE_MISMATCH",
      reservationFound: true, reservationMatchesTuple: false, reservation,
      idempotencyVersions: [], disqualifyingStatesFound: [], matchingClaims: [], matchingAttempts: [],
    };
  }

  // C. Idempotency history -- every version, by content (identityFingerprint), not just
  // the recordId-prefixed filename, exactly mirroring the c1ca1524 script's own scan.
  const idempotencyDir = path.join(durableRoot, "idempotency");
  const idempotencyVersions: EligibilityResult["idempotencyVersions"] = [];
  for (const file of fs.readdirSync(idempotencyDir).sort()) {
    let rec: { identityFingerprint?: string; recordVersion?: number; state?: string; recordId?: string };
    try {
      rec = JSON.parse(fs.readFileSync(path.join(idempotencyDir, file), "utf8"));
    } catch {
      continue;
    }
    if (rec.identityFingerprint !== targetReservationId) continue;
    idempotencyVersions.push({
      file, version: rec.recordVersion ?? -1, state: rec.state ?? "UNKNOWN",
      recordId: rec.recordId ?? "UNKNOWN",
    });
  }
  idempotencyVersions.sort((a, b) => a.version - b.version);

  if (idempotencyVersions.length === 0 ||
    idempotencyVersions.some((v) => v.recordId !== targetRecordId)) {
    return {
      eligible: false, reasonIfNotEligible: "IDEMPOTENCY_HISTORY_MISSING_OR_RECORD_ID_MISMATCH",
      reservationFound: true, reservationMatchesTuple, reservation,
      idempotencyVersions, disqualifyingStatesFound: [], matchingClaims: [], matchingAttempts: [],
    };
  }

  const disqualifyingStatesFound = idempotencyVersions
    .map((v) => v.state)
    .filter((state) => disqualifyingStates.has(state));
  const latestState = idempotencyVersions[idempotencyVersions.length - 1].state;

  if (disqualifyingStatesFound.length > 0) {
    return {
      eligible: false, reasonIfNotEligible: `DISQUALIFYING_STATE_IN_HISTORY:${disqualifyingStatesFound.join(",")}`,
      reservationFound: true, reservationMatchesTuple, reservation,
      idempotencyVersions, latestState, disqualifyingStatesFound,
      matchingClaims: [], matchingAttempts: [],
    };
  }

  // D. Latest state must be exactly "cancelled" -- no other state accepted.
  if (latestState !== acceptableLatestState) {
    return {
      eligible: false, reasonIfNotEligible: `LATEST_STATE_NOT_CANCELLED:${latestState}`,
      reservationFound: true, reservationMatchesTuple, reservation,
      idempotencyVersions, latestState, disqualifyingStatesFound,
      matchingClaims: [], matchingAttempts: [],
    };
  }

  // B. Claim and attempt must not exist anywhere, by content (identity.reservationId),
  // exactly mirroring the c1ca1524 script's own scan.
  const claimsDir = path.join(durableRoot, "claims");
  const matchingClaims = fs.readdirSync(claimsDir).filter((file) => {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(claimsDir, file), "utf8"));
      return rec.identity?.reservationId === targetReservationId;
    } catch {
      return false;
    }
  });
  const attemptsDir = path.join(durableRoot, "attempts");
  const matchingAttempts = fs.readdirSync(attemptsDir).filter((file) => {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(attemptsDir, file), "utf8"));
      return rec.identity?.reservationId === targetReservationId;
    } catch {
      return false;
    }
  });

  if (matchingClaims.length !== 0 || matchingAttempts.length !== 0) {
    return {
      eligible: false, reasonIfNotEligible: "CLAIM_OR_ATTEMPT_FOUND",
      reservationFound: true, reservationMatchesTuple, reservation,
      idempotencyVersions, latestState, disqualifyingStatesFound,
      matchingClaims, matchingAttempts,
    };
  }

  const existingMatch = findMatchingOrphanReservationToleranceAuthority(
    projectSlug, stage, jobId, targetReservationId, reservation.identity.operation, reservation.attempt,
  );
  const reservationContentFingerprintValue = reservationContentFingerprint(reservation);

  return {
    eligible: true,
    reservationFound: true, reservationMatchesTuple, reservation,
    idempotencyVersions, latestState, disqualifyingStatesFound,
    matchingClaims, matchingAttempts,
    existingAuthorityMatch: existingMatch ? { authorityId: existingMatch.authorityId } : undefined,
    reservationContentFingerprintValue,
  };
}

function printEligibilityReport(result: EligibilityResult) {
  console.log("========== fresh eligibility re-check ==========");
  console.log(`target reservation found: ${result.reservationFound}`);
  console.log(`reservation tuple matches (id/projectSlug/stage/operation/attempt/schema): ${result.reservationMatchesTuple}`);
  if (result.reservation) {
    console.log(`  reservation.identity.stage=${result.reservation.identity.stage} ` +
      `reservation.attempt=${result.reservation.attempt} ` +
      `reservation.identity.operation=${result.reservation.identity.operation}`);
  }
  console.log(`\nidempotency version history (${result.idempotencyVersions.length} versions, ` +
    `all must belong to recordId=${targetRecordId}):`);
  for (const v of result.idempotencyVersions) {
    console.log(`  ${v.file} -> version=${v.version} state=${v.state} recordId=${v.recordId} ` +
      `recordIdMatches=${v.recordId === targetRecordId}`);
  }
  console.log(`latest idempotency state: ${result.latestState ?? "N/A"}`);
  console.log(`disqualifying states found in history (running/succeeded/partially-succeeded): ` +
    `${result.disqualifyingStatesFound.length === 0 ? "NONE" : result.disqualifyingStatesFound.join(", ")}`);
  console.log(`\nmatching claim files (by identity.reservationId): ${result.matchingClaims.length} ` +
    `${result.matchingClaims.length > 0 ? JSON.stringify(result.matchingClaims) : ""}`);
  console.log(`matching attempt files (by identity.reservationId): ${result.matchingAttempts.length} ` +
    `${result.matchingAttempts.length > 0 ? JSON.stringify(result.matchingAttempts) : ""}`);
  console.log(`\nexisting matching tolerance authority already present: ` +
    `${result.existingAuthorityMatch ? `YES (${result.existingAuthorityMatch.authorityId})` : "NO"}`);
  console.log(`reservationContentFingerprint (CAS pin to be used): ${result.reservationContentFingerprintValue ?? "N/A"}`);
  console.log(`\nELIGIBLE TO WRITE AUTHORITY: ${result.eligible}` +
    (result.eligible ? "" : ` (reason: ${result.reasonIfNotEligible})`));
}

async function runPlanValidationOnly(context: ReturnType<typeof createRuntimeStorageContext>) {
  const realAdapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: durableRoot, createRootDirectory: false,
  });
  const quiescent = await validateProductionGlobalTerminalQuiescence(
    realAdapter, projectSlug, undefined, context,
  );
  console.log(`\nvalidateProductionGlobalTerminalQuiescence(realStore, ..., context) -> ${quiescent}`);
  return quiescent;
}

async function main() {
  const command = process.argv[2];
  if (command !== "preflight" && command !== "apply") {
    throw new Error("INVALID_COMMAND: expected 'preflight' or 'apply'");
  }
  const context = createRuntimeStorageContext();

  if (command === "preflight") {
    const result = freshEligibilityCheck();
    printEligibilityReport(result);
    console.log("\n(preflight only -- no authority written, no production state touched)");
    return;
  }

  // command === "apply": re-run the exact same eligibility check fresh -- never
  // trust an earlier preflight invocation.
  console.log("========== apply: re-running fresh eligibility check immediately before write ==========");
  const result = freshEligibilityCheck();
  printEligibilityReport(result);
  if (!result.eligible) {
    console.error(`\nABORT: not eligible (${result.reasonIfNotEligible}). No authority written.`);
    process.exitCode = 1;
    return;
  }
  if (result.existingAuthorityMatch) {
    console.log(`\nA matching, unconsumed authority already exists -- nothing to create: ` +
      JSON.stringify(result.existingAuthorityMatch));
  } else {
    console.log("\nAll pre-apply checks passed. Proceeding with the single approved write.");
    console.log("\n========== APPLY: writeProductionOrphanReservationToleranceAuthority ==========");
    const reservation = result.reservation!;
    const authorityId = `orphan-tol-40b371b3-${projectSlug}`;
    const body = buildProductionOrphanReservationToleranceAuthorityBody({
      schemaVersion: "1", policyVersion: "orphan-reservation-tolerance-v1",
      authorityId, issuedAt: new Date().toISOString(),
      projectSlug, stage, jobId,
      reservationId: targetReservationId,
      operation: reservation.identity.operation,
      attempt: reservation.attempt,
      reason: "Orphan reservation tolerance: idempotency record " +
        `${targetRecordId} exists (${result.idempotencyVersions.length} versions) and its latest ` +
        "persisted state is 'cancelled', but no claim and no attempt artifact were ever created for " +
        "it under either the current (v2) or legacy (v1) derivable identity (see this session's " +
        "19-record forensic report). Fresh re-scan at apply time confirmed: latest state cancelled, " +
        "no disqualifying state (running/succeeded/partially-succeeded) anywhere in the full version " +
        "history, zero matching claim records, zero matching attempt records.",
      reservationContentFingerprint: result.reservationContentFingerprintValue!,
    });

    if (!validateProductionOrphanReservationToleranceAuthorityBody(body)) {
      console.error("ABORT: locally-built authority body failed its own schema validation before write.");
      process.exitCode = 1;
      return;
    }

    const writeResult = writeProductionOrphanReservationToleranceAuthority(projectSlug, body);
    console.log("WRITE RESULT:", JSON.stringify(writeResult, null, 2));
    if (!writeResult.ok) {
      console.error(`ABORT: write refused (${writeResult.reasonCode}).`);
      process.exitCode = 1;
      return;
    }

    const readback = readProductionOrphanReservationToleranceAuthority(projectSlug, authorityId);
    console.log("\nREADBACK:", JSON.stringify(readback, null, 2));
    const readbackValid = readback.ok && readback.value &&
      validateProductionOrphanReservationToleranceAuthorityBody(readback.value) &&
      readback.value.reservationId === targetReservationId &&
      readback.value.projectSlug === projectSlug && readback.value.stage === stage &&
      readback.value.jobId === jobId && readback.value.attempt === expectedAttempt;
    console.log(`Readback fully re-validated: ${readbackValid}`);
    if (!readbackValid) {
      console.error("ABORT: readback did not re-validate cleanly.");
      process.exitCode = 1;
      return;
    }
  }

  console.log("\n========== post-apply: read-only re-verification (real store) ==========");
  const realAdapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: durableRoot, createRootDirectory: false,
  });
  const reservationRead = await realAdapter.read("reservation", targetReservationId);
  if (reservationRead.status !== "found") {
    console.error("ABORT: post-apply reservation read failed unexpectedly.");
    process.exitCode = 1;
    return;
  }
  const tolerated = await resolveOrphanReservationTolerance(
    realAdapter, reservationRead.value as ProductionExecutionIdempotencyReservationRequest,
    { projectSlug, stage, jobId, runtimeInput: context },
  );
  console.log(`resolveOrphanReservationTolerance(40b371b3, context) -> ${tolerated}`);

  const claimRef = await anyDurableRecordReferencesReservationId(realAdapter, "claim", targetReservationId);
  const attemptRef = await anyDurableRecordReferencesReservationId(realAdapter, "attempt", targetReservationId);
  console.log(`(sanity, unchanged) claim reference exists: ${claimRef}, attempt reference exists: ${attemptRef}`);

  const quiescent = await runPlanValidationOnly(context);

  console.log(`\nFINAL STATUS: ${tolerated && quiescent ? "APPLIED_AND_TOLERATED_AND_QUIESCENT" : "APPLIED_BUT_INCOMPLETE"}`);
}

void main().catch((error) => {
  console.error("APPLY ERROR:", error);
  process.exitCode = 1;
});
