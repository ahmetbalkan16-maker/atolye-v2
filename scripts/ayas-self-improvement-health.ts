import { readAyasSelfImprovementHealth } from "../src/lib/brain/autonomy/AyasSelfImprovementHealthCollector";
import type { AyasHealthVerdict } from "../src/lib/brain/autonomy/AyasSelfImprovementHealth";

/**
 * AYAS M26 (Phase 1) — read-only Self-Improvement Health check. Answers "is
 * the loop alive, and is it making progress?" in one command instead of a
 * manual forensic chain. Reads durable state and process liveness only; it
 * writes nothing, takes no lock and restarts nothing.
 *
 *   npx tsx scripts/ayas-self-improvement-health.ts [--interval-ms <n>]
 *
 * Prints one JSON document. Exit code follows the usual monitoring
 * convention so a scheduler or script can act on it without parsing:
 * 0 HEALTHY · 1 DEGRADED · 2 STALLED or DOWN · 3 UNKNOWN.
 */
const EXIT_CODE: Readonly<Record<AyasHealthVerdict, number>> = { HEALTHY: 0, DEGRADED: 1, STALLED: 2, DOWN: 2, UNKNOWN: 3 };

async function main(): Promise<void> {
  const intervalArg = process.argv.indexOf("--interval-ms");
  const intervalMs = intervalArg >= 0 ? Number(process.argv[intervalArg + 1]) : undefined;
  if (intervalMs !== undefined && (!Number.isFinite(intervalMs) || intervalMs < 1_000)) {
    console.error("--interval-ms must be a number of at least 1000");
    process.exitCode = 3;
    return;
  }
  const health = await readAyasSelfImprovementHealth({ ...(intervalMs !== undefined ? { observerIntervalMs: intervalMs } : {}) });
  console.log(JSON.stringify({ status: "AYAS_SELF_IMPROVEMENT_HEALTH", checkedAt: new Date().toISOString(), ...health }, null, 2));
  process.exitCode = EXIT_CODE[health.verdict];
}

main().catch((error) => {
  console.error("AYAS self-improvement health check FAILED:", error instanceof Error ? error.message : String(error));
  process.exitCode = 3;
});
