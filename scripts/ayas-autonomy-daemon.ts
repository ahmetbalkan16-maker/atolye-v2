import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { collectAyasMachineTelemetry } from "../src/lib/ayas/machine/AyasMachineTelemetry";
import { evaluateAyasMachineHealth } from "../src/lib/ayas/machine/AyasMachineHealthGuard";
import { loadBrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";
import { createAyasAutonomyObserver } from "../src/lib/brain/autonomy/AyasAutonomyObserver";

const root = process.cwd();
const autonomyDir = path.join(root, "data", "brain", "autonomy");
const lockFile = path.join(autonomyDir, "daemon.lock");
const stateFile = path.join(autonomyDir, "daemon-state.json");

function git(args: readonly string[]): string { return execFileSync("git", [...args], { cwd: root, encoding: "utf8", windowsHide: true }).trim(); }
function acquireLock(): void {
  fs.mkdirSync(autonomyDir, { recursive: true });
  try { const fd = fs.openSync(lockFile, "wx"); fs.writeFileSync(fd, `${process.pid}\n`, "utf8"); fs.closeSync(fd); }
  catch (error) {
    try {
      const age = Date.now() - fs.statSync(lockFile).mtimeMs;
      if (age > 30 * 60_000) { fs.rmSync(lockFile); acquireLock(); return; }
    } catch { /* unreadable lock remains a block */ }
    throw new Error(`AYAS_AUTONOMY_ALREADY_RUNNING: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function releaseLock(): void { try { fs.rmSync(lockFile, { force: true }); } catch { /* best effort */ } }
function graphifyFresh(): boolean { return fs.existsSync(path.join(root, ".graphify", "graph.json")); }

async function tick(observer: ReturnType<typeof createAyasAutonomyObserver>): Promise<void> {
  const now = new Date().toISOString();
  const telemetry = await collectAyasMachineTelemetry({ cwd: root, now: () => now });
  const health = evaluateAyasMachineHealth(telemetry, { stage: "video", ownedActive: false });
  const observation = { now, branch: git(["branch", "--show-current"]), head: git(["rev-parse", "HEAD"]), repoClean: git(["status", "--porcelain"]).length === 0, graphifyFresh: graphifyFresh(), machineAction: health.action, gaps: [] as string[] };
  try {
    const snapshot = await loadBrainConsoleSnapshot();
    observation.gaps.push(...snapshot.errors.slice(0, 8));
    if (snapshot.tasks.pendingApproval > 0) observation.gaps.push(`${snapshot.tasks.pendingApproval} task(s) await operator approval`);
  } catch (error) { observation.gaps.push(error instanceof Error ? error.message : String(error)); }
  observer.observe(observation);
  console.log(JSON.stringify({ status: "OBSERVED", phase: observer.state.phase, branch: observation.branch, head: observation.head, repoClean: observation.repoClean, graphifyFresh: observation.graphifyFresh, machineAction: observation.machineAction, gaps: observation.gaps.length }));
}

async function main(): Promise<void> {
  const continuous = process.argv.includes("--continuous");
  const intervalArg = process.argv.indexOf("--interval-ms");
  const intervalMs = intervalArg >= 0 ? Math.max(1_000, Number(process.argv[intervalArg + 1] ?? "300000")) : 5 * 60_000;
  acquireLock();
  process.on("exit", releaseLock);
  const observer = createAyasAutonomyObserver({ stateFile, now: () => new Date().toISOString() });
  try {
    do { await tick(observer); if (continuous) await new Promise((resolve) => setTimeout(resolve, intervalMs)); } while (continuous);
    console.log(JSON.stringify({ status: observer.state.phase, stateFile }));
  } finally { releaseLock(); }
}
main().catch((error) => { console.error("AYAS autonomy daemon FAILED:", error); process.exitCode = 1; });
