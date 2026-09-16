import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * M18 — proves, by static source inspection (not by trusting the design
 * prose), that the always-on observer wrapper (`scripts/ayas-autonomy-daemon.ts`,
 * spawned at boot / auto-started, never restarted under direct human control)
 * has NO path to any M18 batch-authority surface: no accumulation, no
 * batch approval/reservation, no batch execution. Accumulation is allowed
 * only in the child-process-spawned discovery daemon; batch EXECUTION is
 * not wired into any daemon at all yet — it exists purely as a library
 * entrypoint a human-triggered path can call later, exactly mirroring how
 * M17's `executeAyasApprovedProposalWith` was never daemon-wired either.
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

const REPO_ROOT = path.resolve(__dirname, "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

const M18_BATCH_AUTHORITY_SYMBOLS = /AyasMicroBatchExecutionService|executeAyasApprovedMicroBatchWith|AyasMicroBatchAccumulator|accumulateAyasMicroBatchCandidates|createAyasMicroBatchAsInboxAdapter/;

function main(): void {
  scenario("the always-on observer wrapper imports zero M18 batch-authority or accumulation symbols", () => {
    const src = readSrc("scripts/ayas-autonomy-daemon.ts");
    assert.doesNotMatch(src, M18_BATCH_AUTHORITY_SYMBOLS);
  });

  scenario("the always-on observer wrapper still imports only the read-only observer module (M17 invariant, unchanged by M18)", () => {
    const src = readSrc("scripts/ayas-autonomy-daemon.ts");
    assert.match(src, /from ["']\.\.\/src\/lib\/brain\/autonomy\/AyasAutonomyObserver["']/);
    assert.doesNotMatch(src, /from ["']\.\.\/src\/lib\/brain\/autonomy\/AyasAutonomyDaemon["']/);
  });

  scenario("the always-on observer wrapper still has no path to executeApproved, decide, or any reserve/finalize/consume call (M17 invariant, unchanged by M18)", () => {
    const src = readSrc("scripts/ayas-autonomy-daemon.ts");
    assert.doesNotMatch(src, /executeApproved|\.decide\(|reserveApproval|finalizeApproval|consumeApproval|AyasExecutionGateStore|AyasApprovalInboxStore/);
  });

  scenario("the always-on observer wrapper spawns the discovery work as a CHILD PROCESS, never an in-process import of the discovery daemon module", () => {
    const src = readSrc("scripts/ayas-autonomy-daemon.ts");
    assert.doesNotMatch(src, /from ["']\.\.\/scripts\/ayas-discovery-daemon["']|require\(["']\.\.\/scripts\/ayas-discovery-daemon["']\)/);
  });

  scenario("micro-batch ACCUMULATION is wired only into the child-process-spawned discovery daemon, never the observer wrapper", () => {
    const discoverySrc = readSrc("scripts/ayas-discovery-daemon.ts");
    assert.match(discoverySrc, /accumulateAyasMicroBatchCandidates/);
    const observerSrc = readSrc("scripts/ayas-autonomy-daemon.ts");
    assert.doesNotMatch(observerSrc, /accumulateAyasMicroBatchCandidates/);
  });

  scenario("micro-batch EXECUTION is not wired into any daemon script yet — it is a bare library entrypoint only a human-triggered path may call", () => {
    const observerSrc = readSrc("scripts/ayas-autonomy-daemon.ts");
    const discoverySrc = readSrc("scripts/ayas-discovery-daemon.ts");
    assert.doesNotMatch(observerSrc, /executeAyasApprovedMicroBatchWith/);
    assert.doesNotMatch(discoverySrc, /executeAyasApprovedMicroBatchWith/);
  });

  scenario("AyasMicroBatchWorktree (the persistent batch sandbox) is never imported by the observer wrapper — only by the discovery daemon and the accumulator/execution-service library modules", () => {
    const observerSrc = readSrc("scripts/ayas-autonomy-daemon.ts");
    assert.doesNotMatch(observerSrc, /AyasMicroBatchWorktree/);
  });

  scenario("the discovery daemon itself has no path to batch APPROVAL or EXECUTION calls — it may only accumulate to READY_FOR_REVIEW and reconcile staleness", () => {
    const discoverySrc = readSrc("scripts/ayas-discovery-daemon.ts");
    assert.doesNotMatch(discoverySrc, /\.decide\(|reserveApproval|finalizeApproval|executeApproved|executeAyasApprovedMicroBatchWith/);
    assert.match(discoverySrc, /reconcileAyasMicroBatchStaleness/);
  });

  scenario("AyasMicroBatchExecutionService itself never imports the discovery/accumulation modules — execution is strictly downstream of a human APPROVE, never a place that could itself discover or accumulate new work", () => {
    const src = readSrc("src/lib/brain/autonomy/AyasMicroBatchExecutionService.ts");
    assert.doesNotMatch(src, /AyasMicroBatchAccumulator|accumulateAyasMicroBatchCandidates|AyasNovelPatchDiscovery|AyasPatchDetectors/);
  });

  scenario("AyasMicroBatchAccumulator itself never imports the execution service — accumulation is strictly upstream of approval, never a place that could itself execute", () => {
    const src = readSrc("src/lib/brain/autonomy/AyasMicroBatchAccumulator.ts");
    assert.doesNotMatch(src, /AyasMicroBatchExecutionService|executeAyasApprovedMicroBatchWith|executeApproved/);
  });

  console.log(`AYAS micro batch authority firewall smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-micro-batch-authority-firewall", scenarios: count }));
}
main();
