import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { collectAyasMachineTelemetry } from "../src/lib/ayas/machine/AyasMachineTelemetry";
import { evaluateAyasMachineHealth } from "../src/lib/ayas/machine/AyasMachineHealthGuard";
import { loadBrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";
import { createAyasAutonomyObserver } from "../src/lib/brain/autonomy/AyasAutonomyObserver";
import { acquireAyasObserverLock, releaseAyasObserverLock } from "../src/lib/brain/autonomy/AyasObserverSingletonLock";

const root = process.cwd();
const autonomyDir = path.join(root, "data", "brain", "autonomy");
const lockFile = path.join(autonomyDir, "daemon.lock");
const stateFile = path.join(autonomyDir, "daemon-state.json");

function git(args: readonly string[]): string { return execFileSync("git", [...args], { cwd: root, encoding: "utf8", windowsHide: true }).trim(); }
function graphifyFresh(head: string): boolean {
  try {
    if (!fs.statSync(path.join(root, ".graphify", "graph.json")).isFile()) return false;
    const branch = JSON.parse(fs.readFileSync(path.join(root, ".graphify", "branch.json"), "utf8")) as { readonly lastAnalyzedHead?: unknown; readonly stale?: unknown };
    return branch.lastAnalyzedHead === head && branch.stale === false;
  } catch { return false; }
}

// M16 — the discovery/staleness companion runs as an arm's-length child
// process (the same pattern already used above for `git`), NEVER an
// in-process import: this file's own module graph stays free of every
// approval/execution authority surface — a separately tested invariant
// (see smoke-ayas-observer-autostart.ts) — regardless of what the spawned
// script does internally. A failure here never crashes the observer's own
// tick — it is folded into `gaps` exactly like the existing
// loadBrainConsoleSnapshot() failure path below.
function runAyasDiscoveryDaemon(nextExpectedAt?: string): { readonly ok: boolean; readonly summary: string } {
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const script = path.join(root, "scripts", "ayas-discovery-daemon.ts");
  try {
    // M17 — bumped from 60_000: sandboxed novel-patch discovery (git worktree
    // create + apply + a project-wide `tsc --noEmit` + the generated smoke
    // test itself) can legitimately take longer than the old static-only
    // discovery step did. Still well inside one 300_000ms tick interval, so
    // a slow discovery step can never overlap the next tick.
    const stdout = execFileSync(process.execPath, [tsxCli, script, ...(nextExpectedAt ? ["--next-expected-at", nextExpectedAt] : [])], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 240_000, maxBuffer: 2_000_000, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, summary: stdout.trim() };
  } catch (error) {
    return { ok: false, summary: error instanceof Error ? error.message : String(error) };
  }
}

async function tick(observer: ReturnType<typeof createAyasAutonomyObserver>, intervalMs: number, continuous: boolean): Promise<void> {
  const now = new Date().toISOString();
  const telemetry = await collectAyasMachineTelemetry({ cwd: root, now: () => now });
  const health = evaluateAyasMachineHealth(telemetry, { stage: "video", ownedActive: false });
  const head = git(["rev-parse", "HEAD"]);
  const observation = { now, branch: git(["branch", "--show-current"]), head, repoClean: git(["status", "--porcelain"]).length === 0, graphifyFresh: graphifyFresh(head), machineAction: health.action, gaps: [] as string[] };
  try {
    const snapshot = await loadBrainConsoleSnapshot();
    observation.gaps.push(...snapshot.errors.slice(0, 8));
    if (snapshot.tasks.pendingApproval > 0) observation.gaps.push(`${snapshot.tasks.pendingApproval} task(s) await operator approval`);
  } catch (error) { observation.gaps.push(error instanceof Error ? error.message : String(error)); }
  observer.observe(observation);
  const nextExpectedAt = continuous ? new Date(Date.parse(now) + intervalMs).toISOString() : undefined;
  const discovery = runAyasDiscoveryDaemon(nextExpectedAt);
  if (!discovery.ok) observation.gaps.push(`discovery daemon failed: ${discovery.summary}`);
  console.log(JSON.stringify({ status: "OBSERVED", phase: observer.state.phase, branch: observation.branch, head: observation.head, repoClean: observation.repoClean, graphifyFresh: observation.graphifyFresh, machineAction: observation.machineAction, gaps: observation.gaps.length, discovery: discovery.ok ? discovery.summary : "FAILED" }));
}

async function main(): Promise<void> {
  const continuous = process.argv.includes("--continuous");
  const intervalArg = process.argv.indexOf("--interval-ms");
  const requestedInterval = intervalArg >= 0 ? Number(process.argv[intervalArg + 1] ?? "300000") : 5 * 60_000;
  if (!Number.isFinite(requestedInterval) || requestedInterval <= 0) throw new Error("AYAS_OBSERVER_INTERVAL_INVALID");
  const intervalMs = Math.max(1_000, requestedInterval);
  await acquireAyasObserverLock(autonomyDir, lockFile);
  process.on("exit", () => releaseAyasObserverLock(lockFile));
  const observer = createAyasAutonomyObserver({ stateFile, now: () => new Date().toISOString() });
  try {
    do { await tick(observer, intervalMs, continuous); if (continuous) await new Promise((resolve) => setTimeout(resolve, intervalMs)); } while (continuous);
    console.log(JSON.stringify({ status: observer.state.phase, stateFile }));
  } finally { releaseAyasObserverLock(lockFile); }
}
main().catch((error) => { console.error("AYAS autonomy daemon FAILED:", error); process.exitCode = 1; });
