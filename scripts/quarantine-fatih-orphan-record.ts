/**
 * Generalized, still-fail-closed quarantine of a single orphaned durable
 * execution record chain for the fatih-...-cfe77fd8 project. Parameterized
 * sibling of scripts/quarantine-fatih-thumbnail-orphan-record.ts and
 * scripts/quarantine-fatih-seo-orphan-record.ts, for the identical Aug-2026
 * crash-consistency incident (docs/DURABLE_REPLAY_MANIFEST_DESYNC.md) that left
 * empty-output "succeeded" ordinal-1 orphans on the seo / youtube / export
 * stages (research through assembly committed; thumbnail..export did not).
 *
 * Usage: tsx scripts/quarantine-fatih-orphan-record.ts --stage=<seo|youtube|export> --record-id=<8-hex>
 *
 * Only accepts the exact (stage, recordId) pairs this incident produced. For
 * each, asserts BEFORE touching anything: exactly 7 idempotency versions + 3
 * attempts + 2 claims + 1 reservation (the reservation filename == the record's
 * own identityFingerprint), nothing more/less; latest record is
 * projectSlug-bound, stage-bound, state "succeeded", lease "released",
 * attempt 1, and result.outputReferences is an empty array. MOVES (never
 * deletes) the 13 files into production-execution/quarantine/<label>/ (outside
 * the kind-to-folder scan), sha256-verified before AND after each move, with a
 * manifest. Pure file-move -- no code path, no persistence format change.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SLUG = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";

/** The exact orphan (stage -> recordId, reservationFingerprint) pairs this incident produced. */
const KNOWN_ORPHANS: Record<string, { recordId: string; reservationFingerprint: string }> = {
  seo: { recordId: "pipeline-record-4a167f7a", reservationFingerprint: "idempotency-identity-58884a7c" },
  youtube: { recordId: "pipeline-record-820de5fa", reservationFingerprint: "idempotency-identity-e742a3ad" },
  export: { recordId: "pipeline-record-e9053dd4", reservationFingerprint: "idempotency-identity-288f84a9" },
};

function parseArgs() {
  const values = new Map<string, string>();
  for (const raw of process.argv.slice(2)) {
    const m = /^--([a-z-]+)=(.+)$/.exec(raw);
    if (!m || !["stage", "record-id"].includes(m[1]) || values.has(m[1])) {
      throw new Error(`INVALID_ARGUMENTS: ${raw}`);
    }
    values.set(m[1], m[2]);
  }
  const stage = values.get("stage");
  const recordId = values.get("record-id");
  if (!stage || !recordId || values.size !== 2) throw new Error("INVALID_ARGUMENTS");
  return { stage, recordId };
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function main() {
  const { stage, recordId } = parseArgs();
  const known = KNOWN_ORPHANS[stage];
  if (!known || known.recordId !== recordId) {
    throw new Error(`Scope assertion failed: (${stage}, ${recordId}) is not one of the known incident orphans ` +
      `${JSON.stringify(KNOWN_ORPHANS)}. Aborting, nothing touched.`);
  }
  const shortId = recordId.replace(/^pipeline-record-/, "");
  const claimPrefix = `pipeline-claim-${shortId}-v`;
  const attemptPrefix = `pipeline-attempt-${shortId}-v`;
  const reservationFile = `${known.reservationFingerprint}.json`;

  const projectRoot = path.resolve("data", "projects", SLUG);
  const durableRoot = path.join(projectRoot, "production-execution");
  const quarantineDir = path.join(durableRoot, "quarantine",
    `${stage}-orphan-${shortId}-${new Date().toISOString().replace(/[:.]/g, "-")}`);

  const idempotencyDir = path.join(durableRoot, "idempotency");
  const attemptsDir = path.join(durableRoot, "attempts");
  const claimsDir = path.join(durableRoot, "claims");
  const reservationsDir = path.join(durableRoot, "reservations");

  const idempotencyFiles = (await fs.readdir(idempotencyDir))
    .filter((n) => n.startsWith(`${recordId}-v`) && n.endsWith(".json"));
  const attemptFiles = (await fs.readdir(attemptsDir))
    .filter((n) => n.startsWith(attemptPrefix) && n.endsWith(".json"));
  const claimFiles = (await fs.readdir(claimsDir))
    .filter((n) => n.startsWith(claimPrefix) && n.endsWith(".json"));
  const reservationFiles = (await fs.readdir(reservationsDir)).filter((n) => n === reservationFile);

  const expectedIdempotency = ["v1", "v2", "v3", "v4", "v5", "v6", "v7"].map((v) => `${recordId}-${v}.json`);
  const expectedAttempts = ["1", "2", "3"].map((v) => `${attemptPrefix}${v}.json`);
  const expectedClaims = ["1", "2"].map((v) => `${claimPrefix}${v}.json`);
  const same = (a: readonly string[], e: readonly string[]) => a.length === e.length && e.every((n) => a.includes(n));

  if (!same(idempotencyFiles, expectedIdempotency)) {
    throw new Error(`Scope assertion failed: idempotency file set for ${recordId}: ${JSON.stringify(idempotencyFiles)}. Aborting.`);
  }
  if (!same(attemptFiles, expectedAttempts)) {
    throw new Error(`Scope assertion failed: attempt file set: ${JSON.stringify(attemptFiles)}. Aborting.`);
  }
  if (!same(claimFiles, expectedClaims)) {
    throw new Error(`Scope assertion failed: claim file set: ${JSON.stringify(claimFiles)}. Aborting.`);
  }
  if (!same(reservationFiles, [reservationFile])) {
    throw new Error(`Scope assertion failed: reservation file: ${JSON.stringify(reservationFiles)}. Aborting.`);
  }

  const latest = JSON.parse(await fs.readFile(path.join(idempotencyDir, `${recordId}-v7.json`), "utf8"));
  if (latest.projectSlug !== SLUG || latest.stage !== stage || latest.recordId !== recordId ||
    latest.state !== "succeeded" || latest.durableLease?.status !== "released" || latest.attempt !== 1 ||
    latest.identityFingerprint !== known.reservationFingerprint ||
    !Array.isArray(latest.result?.outputReferences) || latest.result.outputReferences.length !== 0) {
    throw new Error(`Content assertion failed: ${JSON.stringify(latest)}. Aborting, nothing touched.`);
  }

  const entries = [
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
      throw new Error(`CHECKSUM MISMATCH after move ${originalPath}: before=${sha256Before} after=${sha256After}.`);
    }
    moves.push({ recordFile: entry.fileName, kindDir: entry.kindDir, originalPath, newPath, sha256Before, sha256After });
  }

  const remain = [
    ...(await fs.readdir(idempotencyDir)).filter((n) => n.startsWith(`${recordId}-v`)),
    ...(await fs.readdir(attemptsDir)).filter((n) => n.startsWith(attemptPrefix)),
    ...(await fs.readdir(claimsDir)).filter((n) => n.startsWith(claimPrefix)),
    ...(await fs.readdir(reservationsDir)).filter((n) => n === reservationFile),
  ];
  if (remain.length) throw new Error(`POST-MOVE VERIFICATION FAILED: files remain: ${JSON.stringify(remain)}`);

  await fs.writeFile(path.join(quarantineDir, "quarantine-manifest.json"), `${JSON.stringify({
    schemaVersion: "1", quarantinedAt: new Date().toISOString(), projectSlug: SLUG, stage, recordId,
    reason: "PIPELINE_DURABLE_REPLAY_MANIFEST_DESYNC / PIPELINE_RETRY_DURABLE_CONFLICT -- orphaned succeeded " +
      "durable record with zero output references (2026-08-18 crash before project-level commit). " +
      "See docs/DURABLE_REPLAY_MANIFEST_DESYNC.md.",
    originalRecordSnapshot: latest, moves,
  }, null, 2)}\n`, "utf8");

  console.log(`=== QUARANTINE COMPLETE (${stage} / ${recordId}) ===`);
  console.log(`quarantineDir: ${quarantineDir}`);
  console.log(`files moved: ${moves.length}`);
  for (const m of moves) console.log(`  ${m.originalPath} (sha256=${m.sha256Before})`);
}

main().catch((error) => {
  console.error("=== QUARANTINE FAILED (nothing further attempted) ===");
  console.error(error);
  process.exitCode = 1;
});
