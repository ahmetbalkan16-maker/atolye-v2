import fs from "node:fs";

import { approveAndExecuteAyasMicroBatch } from "../src/lib/brain/autonomy/AyasMicroBatchApprovalService";
import { createAyasMicroBatchStore } from "../src/lib/brain/autonomy/AyasMicroBatch";
import { createAyasMicroItemStore } from "../src/lib/brain/autonomy/AyasMicroItem";
import { createAyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { approveAndExecuteAyasProposal } from "../src/lib/brain/autonomy/AyasProposalApprovalService";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import type { AyasExecutionJournalPhase } from "../src/lib/brain/autonomy/AyasExecutionJournal";

/**
 * M21.1/M21.8 — the real crash-injection worker. Spawned as a genuine,
 * separate OS process by scripts/smoke-ayas-crash-injection.ts (never
 * imported in-process) so that "crashing" here means the worker's own hook
 * callback calls `process.exit(137)` — an immediate, unwind-free process
 * death, exactly like `SIGKILL` — never a caught exception the SAME
 * process's own try/catch could still clean up after. Everything after
 * this file's kill point (finalizeApproval/gate-fault/RECOVERY_REQUIRED
 * classification in AyasAutonomyDaemon's catch block) never runs; recovery
 * is proven separately, in a FRESH process, by the smoke test.
 *
 * Config is a JSON file (path in argv[2]) so this worker takes no
 * unbounded/interpreted input from the command line itself — only a
 * filesystem path the test itself wrote.
 */
interface CrashInjectionConfig {
  readonly lane: "batch" | "proposal";
  readonly repoRoot: string;
  readonly gateRoot: string;
  readonly remoteName?: string;
  readonly storeRoots: { readonly batch?: string; readonly items?: string; readonly artifacts?: string; readonly inbox?: string };
  readonly batchId?: string;
  readonly batchHash?: string;
  readonly proposalId?: string;
  readonly proposalHash?: string;
  /** One of the real AyasExecutionJournalPhase names, or "BEFORE_COMMIT" / "AFTER_COMMIT_BEFORE_PUSH" (this codebase's own two extra crash points, outside the journal). "" means: run to completion, no crash (the harness's own control scenario). */
  readonly crashAt: AyasExecutionJournalPhase | "BEFORE_COMMIT" | "AFTER_COMMIT_BEFORE_PUSH" | "";
}

function crashIfMatch(config: CrashInjectionConfig, point: string): void {
  if (config.crashAt === point) {
    // A real, immediate, unwind-free process death — no flush, no finally
    // blocks upstream of this call get to run. This is the entire point.
    process.exit(137);
  }
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) { console.error("usage: ayas-crash-injection-worker.ts <configPath>"); process.exit(2); }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as CrashInjectionConfig;

  const onJournalPhase = (phase: AyasExecutionJournalPhase): void => crashIfMatch(config, phase);
  const onBeforeCommit = (): void => crashIfMatch(config, "BEFORE_COMMIT");
  const onAfterCommitBeforePush = (): void => crashIfMatch(config, "AFTER_COMMIT_BEFORE_PUSH");

  if (config.lane === "batch") {
    const batchStore = createAyasMicroBatchStore({ rootDir: config.storeRoots.batch! });
    const itemStore = createAyasMicroItemStore({ rootDir: config.storeRoots.items! });
    const artifactStore = createAyasPatchArtifactStore({ rootDir: config.storeRoots.artifacts! });
    const result = await approveAndExecuteAyasMicroBatch(config.batchId!, config.batchHash!, {
      repoRoot: config.repoRoot, gateRoot: config.gateRoot, remoteName: config.remoteName,
      batchStore, itemStore, artifactStore, onJournalPhase, onBeforeCommit, onAfterCommitBeforePush,
    });
    console.log(JSON.stringify({ crashed: false, result }));
  } else {
    const inbox = createAyasApprovalInboxStore({ rootDir: config.storeRoots.inbox! });
    const artifactStore = createAyasPatchArtifactStore({ rootDir: config.storeRoots.artifacts! });
    const result = await approveAndExecuteAyasProposal(config.proposalId!, config.proposalHash!, {
      repoRoot: config.repoRoot, gateRoot: config.gateRoot, remoteName: config.remoteName,
      inbox, artifactStore, onJournalPhase, onBeforeCommit, onAfterCommitBeforePush,
    });
    console.log(JSON.stringify({ crashed: false, result }));
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ crashed: false, threw: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
