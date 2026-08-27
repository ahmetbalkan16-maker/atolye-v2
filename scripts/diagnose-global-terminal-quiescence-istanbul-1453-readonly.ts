import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { validateProductionGlobalTerminalQuiescence } from
  "../src/lib/production/ProductionGlobalTerminalQuiescence";
import { validateProductionExecutionPersistencePayload } from
  "../src/lib/production/ProductionExecutionPersistence";

/**
 * READ-ONLY diagnostic: runs validateProductionGlobalTerminalQuiescence (unmodified)
 * against a temp fs.cp() COPY of the real i-stanbul-un-fethi-1453 production-execution/
 * store to reconfirm the false result, then dumps the raw reservation/idempotency/
 * claim/attempt record shapes it inspects (state, stage, operation, attempt,
 * identityFingerprint, recordVersion) so the specific failing invariant can be reasoned
 * about without touching or modifying the real store or the audited source file.
 */

const projectSlug = "i-stanbul-un-fethi-1453";

function parseVersionedKey(key: string) {
  const match = /^(.*)-v([1-9][0-9]*)$/.exec(key);
  if (!match) return undefined;
  return { identity: match[1], version: Number(match[2]) };
}

async function main() {
  const realRoot = path.join(process.cwd(), "data", "projects", projectSlug, "production-execution");
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-quiescence-diagnosis-"));
  const copyRoot = path.join(tempRoot, "production-execution");
  try {
    await fsp.cp(realRoot, copyRoot, { recursive: true });
    const adapter = new ProductionExecutionFilePersistenceAdapter({
      trustedRootDirectory: copyRoot, createRootDirectory: false,
    });

    const result = await validateProductionGlobalTerminalQuiescence(adapter, projectSlug);
    console.log(`validateProductionGlobalTerminalQuiescence(...) -> ${result}\n`);

    for (const kind of ["reservation", "idempotency", "claim", "attempt"] as const) {
      const listed = await adapter.listKeys(kind);
      console.log(`========== ${kind} (${listed.ok ? listed.keys.length : "LIST_FAILED"}) ==========`);
      if (!listed.ok) continue;
      for (const key of [...listed.keys].sort()) {
        const read = await adapter.read(kind, key);
        if (read.status !== "found") {
          console.log(`  ${key} -> NOT FOUND (status=${read.status})`);
          continue;
        }
        const valid = validateProductionExecutionPersistencePayload(kind, read.value);
        const value = read.value as unknown as Record<string, unknown>;
        const identity = value.identity as Record<string, unknown> | undefined;
        const parsedKey = parseVersionedKey(key);
        if (kind === "reservation") {
          console.log(`  ${key} valid=${valid} identityFingerprint=${identity?.identityFingerprint} ` +
            `stage=${identity?.stage} operation=${identity?.operation} projectSlug=${identity?.projectSlug} ` +
            `attempt=${value.attempt}`);
        } else if (kind === "idempotency") {
          console.log(`  ${key} valid=${valid} parsedVersion=${parsedKey?.version} ` +
            `recordVersion=${value.recordVersion} recordId=${value.recordId} stage=${value.stage} ` +
            `operation=${value.operation} attempt=${value.attempt} state=${value.state} ` +
            `identityFingerprint=${value.identityFingerprint} projectSlug=${value.projectSlug}`);
        } else if (kind === "claim") {
          console.log(`  ${key} valid=${valid} claimId=${identity?.claimId} ` +
            `recordId=${identity?.recordId} reservationId=${identity?.reservationId} state=${value.state} ` +
            `claimVersion=${value.claimVersion}`);
        } else {
          console.log(`  ${key} valid=${valid} attemptId=${identity?.attemptId} ` +
            `recordId=${identity?.recordId} reservationId=${identity?.reservationId} state=${value.state} ` +
            `attemptVersion=${value.attemptVersion}`);
        }
      }
    }
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("DIAGNOSTIC ERROR:", error);
  process.exitCode = 1;
});
