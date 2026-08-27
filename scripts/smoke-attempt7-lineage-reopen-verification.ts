import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emitSmokeResult } from "./lib/SmokeResult";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";
import { createIsolatedRuntimeStorageContext, getProjectRoot } from
  "../src/lib/runtime/RuntimeStoragePaths";

/**
 * Verifies the CORRECTED Remediation C cardinality invariant against a TEMP COPY of
 * the real i-stanbul-un-fethi-1453 project's production-execution/ directory — never
 * the original. The real project is only ever read here (fs.cp), never written.
 *
 * Ground truth, re-derived directly from the real durable store:
 *   - assembly durable attempts 1-6 and 8 are genuine, fully-paired, closed-out
 *     executions (claim=abandoned, attempt=failed), one recordId each.
 *   - assembly durable attempt 7 exists TWICE, under two different historical
 *     identity derivations for the same ordinal: `1ab478279f9a...` (real, fully
 *     paired, claim=abandoned/attempt=failed) and `ca987045...` (an orphan
 *     reservation — cancelled by reconcileOrphanedReservationWithoutClaim(), no
 *     claim, no attempt ever opened, covered by the real, on-disk tolerance
 *     authority tolerance-orphan-tol-40b371b3-i-stanbul-un-fethi-1453.json).
 *   - Total: 9 idempotency records for 8 ordinals (1-8) — a genuine DUPLICATE at
 *     ordinal 7, not a single hole.
 *
 * A prior version of this smoke asserted this resolves to `valid` (durableOrdinal 8).
 * That assertion was WRONG: it was built on a since-reverted cardinality check
 * (`distinctOrdinals.size === requiredOrdinalCount`) that silently tolerated a
 * duplicate ordinal whenever exactly one of the two competing records was
 * authority-excludable — indistinguishable, from the proof's point of view, from
 * genuinely resolving an identity conflict via the orphan-tolerance mechanism,
 * which is NOT what that mechanism is scoped to decide. The corrected invariant
 * (`recordValues.length === requiredOrdinalCount`, checked on the RAW, pre-exclusion
 * record set) rejects ANY duplicate ordinal unconditionally, authority or not — see
 * ProductionDurableAttemptLineageClassifier.ts and the "duplicate ordinal (one
 * valid, one authority-tolerated orphan)" scenario in
 * smoke-durable-attempt-lineage-orphan-tolerance.ts, which locks in the same
 * invariant against a synthetic fixture of the identical shape.
 *
 * `classifyProductionDurableAttemptLineage(...)` must therefore resolve to
 * `invalid`/`lineage-cardinality` for the real data, for ANY `expectedJobAttempt` —
 * this project's assembly stage remains blocked pending a SEPARATE, explicit
 * reconciliation of which of `1ab478279f9a...`/`ca987045...` is canonical (out of
 * scope for Remediation C, and NOT performed by this read-only verification).
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;

let scenarios = 0;
async function scenario(name: string, action: () => Promise<void>): Promise<void> {
  await action();
  scenarios += 1;
  process.stdout.write(`PASS ${scenarios}: ${name}\n`);
}

async function main() {
  const realProductionExecutionRoot = path.join(
    process.cwd(), "data", "projects", projectSlug, "production-execution",
  );
  const before = await fs.stat(realProductionExecutionRoot).catch(() => undefined);
  if (!before) {
    process.stdout.write(
      "SKIP: real project production-execution/ directory not present in this environment " +
      "(nothing to verify against) — this is expected outside the session where the real " +
      "project exists, and is not a failure of the cardinality invariant itself.\n",
    );
    emitSmokeResult("attempt7-lineage-reopen-verification", 0);
    return;
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "atolye-attempt7-verify-"));
  try {
    // workspaceRoot is ALSO pointed at the isolated temp root (not
    // process.cwd()) so RuntimeStoragePaths' dual-root-divergence guard
    // never sees the real repo's data/projects/i-stanbul-un-fethi-1453 as a
    // second, conflicting location for this slug — this context is fully
    // disjoint from the real repo.
    const storageContext = createIsolatedRuntimeStorageContext({
      workspaceRoot: tempRoot,
      environment: { ATOLYE_RUNTIME_ROOT: tempRoot },
    });
    const copyRoot = path.join(getProjectRoot(projectSlug, storageContext), "production-execution");
    await fs.cp(realProductionExecutionRoot, copyRoot, { recursive: true });

    const adapter = new ProductionExecutionFilePersistenceAdapter({
      trustedRootDirectory: copyRoot, createRootDirectory: false,
    });

    for (const expectedJobAttempt of [6, 7, 8]) {
      await scenario(
        `classifyProductionDurableAttemptLineage (preparation, expected=${expectedJobAttempt}) rejects the real duplicate at ordinal 7`,
        async () => {
          const result = await classifyProductionDurableAttemptLineage(
            adapter, projectSlug, stage, expectedJobAttempt, "preparation", storageContext,
          );
          assert.equal(result.status, "invalid");
          if (result.status === "invalid") assert.equal(result.boundary, "lineage-cardinality");
        },
      );
    }

    await scenario(
      "exact mode (reconcileFailedPipelineExecution's own mode) also rejects the real duplicate at ordinal 7",
      async () => {
        const result = await classifyProductionDurableAttemptLineage(
          adapter, projectSlug, stage, 7, "exact", storageContext,
        );
        assert.equal(result.status, "invalid");
        if (result.status === "invalid") assert.equal(result.boundary, "lineage-cardinality");
      },
    );

    await scenario("real project directory is untouched by this verification (read-only)", async () => {
      const after = await fs.stat(realProductionExecutionRoot);
      assert.equal(after.mtimeMs, before.mtimeMs);
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  assert.ok(scenarios >= 5);
  process.stdout.write(`Attempt-7 lineage reopen verification smoke: PASS (${scenarios} scenarios)\n`);
  emitSmokeResult("attempt7-lineage-reopen-verification", scenarios);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
