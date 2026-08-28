/**
 * One-time, narrowly-scoped quarantine of a single orphaned durable execution
 * record chain: pipeline-record-4a167f7a (SEO stage,
 * fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-...).
 *
 * SEO counterpart of scripts/quarantine-fatih-thumbnail-orphan-record.ts. Root
 * cause: see docs/DURABLE_REPLAY_MANIFEST_DESYNC.md. This record reached durable
 * state:"succeeded" on 2026-08-18T19:36:24Z with an EMPTY result.outputReferences
 * (no real SEO asset was ever produced -- the summary is the generic "Pipeline
 * stage completed and durably settled."), while the process crashed before the
 * separate project-level manifest/job commit ran. Every later resume then either
 * replays it forever, or -- once the ProductionPipelineExecutionFactory.ts
 * crash-consistency guard converts that loop into one clean
 * PIPELINE_DURABLE_REPLAY_MANIFEST_DESYNC failure -- is blocked at
 * reconcileFailedPipelineExecution, which refuses to reconcile a "succeeded"
 * orphan attempt (ProductionPipelineRetryReconciliation.ts ~L185).
 *
 * This script MOVES (never deletes) the exact 13 files belonging to this one
 * recordId out of production-execution/{idempotency,attempts,claims,
 * reservations}/ into production-execution/quarantine/<label>/, preserving
 * every byte and filename, and writes a manifest recording old path, new
 * path, and a SHA-256 checksum for each file taken before AND re-verified
 * after the move. The quarantine directory name is deliberately outside the
 * "idempotency"/"reservations"/"claims"/"attempts" kind-to-folder mapping
 * ProductionExecutionFilePersistenceAdapter.listKeys() scans, so this is a
 * pure file-move -- no code change, no new persistence format, nothing else
 * in the durable store is read, written, or even listed.
 *
 * Scope lock: hard-codes this exact project slug, this exact recordId, and
 * this exact 13-file list. Refuses to run (throws before touching anything)
 * if any expected file is missing, if any unexpected sibling file for the
 * same recordId is found, or if the record's own content doesn't match the
 * exact state this script was written against (stage, state, attempt,
 * lease status, empty outputReferences). Never touches any other project,
 * any other stage, or any other record.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SLUG = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const RECORD_ID = "pipeline-record-4a167f7a";
const CLAIM_PREFIX = "pipeline-claim-4a167f7a-v";
const ATTEMPT_PREFIX = "pipeline-attempt-4a167f7a-v";
const RESERVATION_FILE = "idempotency-identity-58884a7c.json";
const EXPECTED_STAGE = "seo";

const projectRoot = path.resolve("data", "projects", SLUG);
const durableRoot = path.join(projectRoot, "production-execution");
const quarantineLabel = `seo-orphan-4a167f7a-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const quarantineDir = path.join(durableRoot, "quarantine", quarantineLabel);

interface FileEntry {
  readonly kindDir: "idempotency" | "attempts" | "claims" | "reservations";
  readonly fileName: string;
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function main() {
  const idempotencyDir = path.join(durableRoot, "idempotency");
  const attemptsDir = path.join(durableRoot, "attempts");
  const claimsDir = path.join(durableRoot, "claims");
  const reservationsDir = path.join(durableRoot, "reservations");

  const idempotencyFiles = (await fs.readdir(idempotencyDir))
    .filter((name) => name.startsWith(`${RECORD_ID}-v`) && name.endsWith(".json"));
  const attemptFiles = (await fs.readdir(attemptsDir))
    .filter((name) => name.startsWith(ATTEMPT_PREFIX) && name.endsWith(".json"));
  const claimFiles = (await fs.readdir(claimsDir))
    .filter((name) => name.startsWith(CLAIM_PREFIX) && name.endsWith(".json"));
  const reservationFiles = (await fs.readdir(reservationsDir))
    .filter((name) => name === RESERVATION_FILE);

  const expectedIdempotency = ["v1", "v2", "v3", "v4", "v5", "v6", "v7"].map((v) => `${RECORD_ID}-${v}.json`);
  const expectedAttempts = ["v1", "v2", "v3"].map((v) => `${ATTEMPT_PREFIX}${v.slice(1)}.json`);
  const expectedClaims = ["v1", "v2"].map((v) => `${CLAIM_PREFIX}${v.slice(1)}.json`);
  const expectedReservations = [RESERVATION_FILE];

  const sameSet = (actual: readonly string[], expected: readonly string[]) =>
    actual.length === expected.length && expected.every((name) => actual.includes(name));

  if (!sameSet(idempotencyFiles, expectedIdempotency)) {
    throw new Error(`Scope assertion failed: idempotency files for ${RECORD_ID} do not match the exact expected set. ` +
      `Found: ${JSON.stringify(idempotencyFiles)}, expected: ${JSON.stringify(expectedIdempotency)}. Aborting, nothing touched.`);
  }
  if (!sameSet(attemptFiles, expectedAttempts)) {
    throw new Error(`Scope assertion failed: attempt files do not match. Found: ${JSON.stringify(attemptFiles)}. Aborting, nothing touched.`);
  }
  if (!sameSet(claimFiles, expectedClaims)) {
    throw new Error(`Scope assertion failed: claim files do not match. Found: ${JSON.stringify(claimFiles)}. Aborting, nothing touched.`);
  }
  if (!sameSet(reservationFiles, expectedReservations)) {
    throw new Error(`Scope assertion failed: reservation file does not match. Found: ${JSON.stringify(reservationFiles)}. Aborting, nothing touched.`);
  }

  const latest = JSON.parse(await fs.readFile(path.join(idempotencyDir, `${RECORD_ID}-v7.json`), "utf8"));
  if (latest.projectSlug !== SLUG || latest.stage !== EXPECTED_STAGE || latest.recordId !== RECORD_ID ||
    latest.state !== "succeeded" || latest.durableLease?.status !== "released" ||
    latest.attempt !== 1 || latest.identityFingerprint !== "idempotency-identity-58884a7c" ||
    !Array.isArray(latest.result?.outputReferences) || latest.result.outputReferences.length !== 0) {
    throw new Error(`Content assertion failed: latest record does not match the expected orphan signature. ` +
      `Record: ${JSON.stringify(latest)}. Aborting, nothing touched.`);
  }

  const entries: FileEntry[] = [
    ...idempotencyFiles.map((fileName) => ({ kindDir: "idempotency" as const, fileName })),
    ...attemptFiles.map((fileName) => ({ kindDir: "attempts" as const, fileName })),
    ...claimFiles.map((fileName) => ({ kindDir: "claims" as const, fileName })),
    ...reservationFiles.map((fileName) => ({ kindDir: "reservations" as const, fileName })),
  ];

  await fs.mkdir(quarantineDir, { recursive: true });

  const moves: Array<{ recordFile: string; kindDir: string; originalPath: string; newPath: string;
    sha256Before: string; sha256After: string }> = [];

  for (const entry of entries) {
    const originalPath = path.join(durableRoot, entry.kindDir, entry.fileName);
    const newPath = path.join(quarantineDir, `${entry.kindDir}__${entry.fileName}`);
    const sha256Before = await sha256(originalPath);
    await fs.rename(originalPath, newPath);
    const sha256After = await sha256(newPath);
    if (sha256Before !== sha256After) {
      throw new Error(`CHECKSUM MISMATCH after move for ${originalPath} -> ${newPath}: ` +
        `before=${sha256Before} after=${sha256After}. STOP -- manual inspection required.`);
    }
    moves.push({ recordFile: entry.fileName, kindDir: entry.kindDir, originalPath, newPath, sha256Before, sha256After });
  }

  const remainingIdempotency = (await fs.readdir(idempotencyDir)).filter((n) => n.startsWith(`${RECORD_ID}-v`));
  const remainingAttempts = (await fs.readdir(attemptsDir)).filter((n) => n.startsWith(ATTEMPT_PREFIX));
  const remainingClaims = (await fs.readdir(claimsDir)).filter((n) => n.startsWith(CLAIM_PREFIX));
  const remainingReservations = (await fs.readdir(reservationsDir)).filter((n) => n === RESERVATION_FILE);
  if (remainingIdempotency.length || remainingAttempts.length || remainingClaims.length || remainingReservations.length) {
    throw new Error("POST-MOVE VERIFICATION FAILED: some files remain in the active store. " +
      `idempotency=${JSON.stringify(remainingIdempotency)} attempts=${JSON.stringify(remainingAttempts)} ` +
      `claims=${JSON.stringify(remainingClaims)} reservations=${JSON.stringify(remainingReservations)}`);
  }

  const manifest = {
    schemaVersion: "1",
    quarantinedAt: new Date().toISOString(),
    projectSlug: SLUG,
    stage: EXPECTED_STAGE,
    recordId: RECORD_ID,
    reason: "PIPELINE_DURABLE_REPLAY_MANIFEST_DESYNC / PIPELINE_RETRY_DURABLE_CONFLICT -- orphaned succeeded " +
      "durable record (2026-08-18T19:36:24Z) with zero output references (no real SEO asset was ever produced); " +
      "process crashed before the project-level manifest/job commit ran. See docs/DURABLE_REPLAY_MANIFEST_DESYNC.md.",
    originalRecordSnapshot: latest,
    moves,
  };
  await fs.writeFile(path.join(quarantineDir, "quarantine-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log("=== QUARANTINE COMPLETE ===");
  console.log(`recordId: ${RECORD_ID}`);
  console.log(`quarantineDir: ${quarantineDir}`);
  console.log(`files moved: ${moves.length}`);
  for (const move of moves) {
    console.log(`  ${move.originalPath} -> ${move.newPath} (sha256=${move.sha256Before})`);
  }
  console.log("Active production-execution/{idempotency,attempts,claims,reservations}/ verified clean of this record.");
}

main().catch((error) => {
  console.error("=== QUARANTINE FAILED (nothing further attempted) ===");
  console.error(error);
  process.exitCode = 1;
});
