/**
 * Stage 15B — durable task recovery scan and sweep.
 *
 *   npx tsx scripts/ayas-durable-task-recovery.ts [--root <dir>] [--apply] [--enqueue-head-check]
 *
 * Without --apply this is a dry run: it reads the journal and prints what a
 * sweep would do. It takes no lock, records nothing and runs no activity.
 *
 * --apply runs one sweep with the first activity set (one read-only
 * activity). The default journal is the live one under data/brain/autonomy;
 * it is refused (exit 2) whenever the live binding is not owner-approved.
 * Pass --root to use another journal directory.
 *
 * --enqueue-head-check (with --apply) first creates the task that
 * records the Graphify state of the current HEAD, if it does not exist.
 *
 * The autonomy observer's tick runs this script as a child process with
 * --apply --enqueue-head-check (owner-approved on 2026-10-01). Nothing
 * else runs it.
 */
import { execFileSync } from "node:child_process";

import { AyasDurableTaskError } from "../src/lib/brain/autonomy/AyasDurableTask";
import { ayasGraphifyStateTaskInput, createAyasFirstDurableActivitySet } from "../src/lib/brain/autonomy/AyasDurableTaskActivities";
import { createAyasDurableTaskJournal } from "../src/lib/brain/autonomy/AyasDurableTaskJournal";
import { ayasDurableTaskLiveBinding, isAyasDurableTaskLiveJournal, sweepAyasDurableTasks } from "../src/lib/brain/autonomy/AyasDurableTaskRecovery";
import { createAyasDurableTask, createAyasDurableTaskOwner } from "../src/lib/brain/autonomy/AyasDurableTaskRuntime";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const known = new Set(["--root", "--apply", "--enqueue-head-check"]);
  const rootIndex = args.indexOf("--root");
  const rootDir = rootIndex >= 0 ? args[rootIndex + 1] : undefined;
  const isRootValue = (index: number): boolean => rootIndex >= 0 && index === rootIndex + 1;
  if (args.some((arg, index) => !known.has(arg) && !isRootValue(index)) || (rootIndex >= 0 && (!rootDir || rootDir.startsWith("--")))) throw new Error("AYAS_DURABLE_TASK_RECOVERY_ARGUMENTS_INVALID");
  const apply = args.includes("--apply");
  const enqueue = args.includes("--enqueue-head-check");
  if (enqueue && !apply) throw new Error("AYAS_DURABLE_TASK_RECOVERY_ENQUEUE_NEEDS_APPLY");

  const journal = createAyasDurableTaskJournal(rootDir ? { rootDir } : {});
  if (apply && ayasDurableTaskLiveBinding() !== "OWNER_APPROVED" && isAyasDurableTaskLiveJournal(journal.dir)) {
    console.log(JSON.stringify({ status: "REQUIRE_OWNER", code: "AYAS_DURABLE_TASK_LIVE_BINDING_REQUIRES_OWNER" }));
    process.exitCode = 2;
    return;
  }
  const repoRoot = process.cwd();
  if (enqueue) {
    const head = execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 15_000 }).trim();
    createAyasDurableTask(journal, ayasGraphifyStateTaskInput(head));
  }
  const report = await sweepAyasDurableTasks({ journal, activities: createAyasFirstDurableActivitySet({ repoRoot }), owner: await createAyasDurableTaskOwner() }, { dryRun: !apply });
  console.log(JSON.stringify({ status: "OK", liveBinding: ayasDurableTaskLiveBinding(), report }, null, 2));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: "FAILED", code: error instanceof AyasDurableTaskError ? error.code : "UNEXPECTED", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
