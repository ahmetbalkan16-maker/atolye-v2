import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  AYAS_LOST_RESPONSE_RECHECK_DELAYS_MS,
  ayasLostResponseErrorCode,
  ayasMicroBatchProgress,
  ayasProposalProgress,
  recheckAyasAfterLostResponse,
} from "../src/components/brain/ayasLostResponseRecheck";
import type { AyasApprovalInboxView, AyasDevelopmentProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxView";
import type { AyasMicroBatchDevelopmentEntry, AyasMicroBatchDevelopmentView } from "../src/lib/brain/autonomy/AyasMicroBatchDevelopmentView";

/**
 * Lost-response recheck for the one-click owner actions (ONAYLA VE UYGULA,
 * BATCH ONAYLA VE UYGULA, owner-recommendation ONAYLA). On 2026-10-10 two
 * ONAYLA VE UYGULA runs each took ~145 s and completed (commits c60aace,
 * 63f36e6), but the page kept the proposal as pending: the long request's
 * response was dropped on the way back, the client showed "Bağlantı hatası —
 * tekrar dene" and never re-read durable state.
 *
 * Pure and in memory: no filesystem writes, no server, no real timer (the
 * wait is injected and recorded).
 */
let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const ID = "ayas-proposal-fixture";
const proposal = (status: string, extra: Record<string, unknown> = {}): AyasDevelopmentProposal =>
  ({ proposalId: ID, status, ownerApprovedPendingExecution: false, ...extra }) as unknown as AyasDevelopmentProposal;
const inbox = (where: "pending" | "today" | "history" | "none", p?: AyasDevelopmentProposal, connected = true): AyasApprovalInboxView => ({
  connected,
  pending: where === "pending" && p ? [p] : [],
  today: where === "today" && p ? [p] : [],
  history: where === "history" && p ? [p] : [],
});
const BATCH = "ayas-micro-batch-fixture";
const batch = (status: string): AyasMicroBatchDevelopmentEntry => ({ batchId: BATCH, status }) as unknown as AyasMicroBatchDevelopmentEntry;
const microView = (entry: AyasMicroBatchDevelopmentEntry | null, place: "active" | "history", connected = true): AyasMicroBatchDevelopmentView => ({
  connected,
  active: place === "active" ? entry : null,
  history: place === "history" && entry ? [entry] : [],
});

/** A read that replays fixed steps (the last one repeats); an `Error` step is a lost read. */
function scripted<T>(steps: readonly (T | Error)[]) {
  let calls = 0;
  const read = async (): Promise<T> => {
    const step = steps[Math.min(calls, steps.length - 1)]!;
    calls += 1;
    if (step instanceof Error) throw step;
    return step;
  };
  return { read, calls: () => calls };
}
function recorder() {
  const waits: number[] = [];
  return { waits, wait: async (ms: number) => { waits.push(ms); } };
}

async function main(): Promise<void> {
  await scenario("proposal: PENDING/DEFERRED is NOT_STARTED, APPROVED/RESERVED is RUNNING, every terminal status is SETTLED", () => {
    assert.equal(ayasProposalProgress(inbox("pending", proposal("PENDING")), ID), "NOT_STARTED");
    assert.equal(ayasProposalProgress(inbox("pending", proposal("DEFERRED")), ID), "NOT_STARTED");
    assert.equal(ayasProposalProgress(inbox("history", proposal("APPROVED")), ID), "RUNNING");
    assert.equal(ayasProposalProgress(inbox("history", proposal("RESERVED")), ID), "RUNNING");
    for (const status of ["COMPLETED", "FAILED", "STALE", "ABANDONED", "RECOVERY_REQUIRED", "REJECTED"]) {
      assert.equal(ayasProposalProgress(inbox("today", proposal(status)), ID), "SETTLED", status);
    }
  });

  await scenario("proposal: an owner-model APPROVE recorded without executing waits for YÜRÜT, so it is SETTLED, not RUNNING", () => {
    assert.equal(ayasProposalProgress(inbox("history", proposal("APPROVED", { ownerApprovedPendingExecution: true })), ID), "SETTLED");
  });

  await scenario("proposal: missing from a connected view is SETTLED; a disconnected view is UNKNOWN", () => {
    assert.equal(ayasProposalProgress(inbox("none"), ID), "SETTLED");
    assert.equal(ayasProposalProgress(inbox("pending", proposal("COMPLETED"), false), ID), "UNKNOWN");
    assert.equal(ayasProposalProgress(inbox("history", proposal("RESERVED")), "some-other-proposal"), "SETTLED");
  });

  await scenario("batch: ACCUMULATING/READY_FOR_REVIEW is NOT_STARTED, APPROVED/RESERVED is RUNNING, terminal or missing is SETTLED", () => {
    assert.equal(ayasMicroBatchProgress(microView(batch("READY_FOR_REVIEW"), "active"), BATCH), "NOT_STARTED");
    assert.equal(ayasMicroBatchProgress(microView(batch("ACCUMULATING"), "active"), BATCH), "NOT_STARTED");
    assert.equal(ayasMicroBatchProgress(microView(batch("APPROVED"), "history"), BATCH), "RUNNING");
    assert.equal(ayasMicroBatchProgress(microView(batch("RESERVED"), "history"), BATCH), "RUNNING");
    for (const status of ["COMPLETED", "FAILED", "STALE", "ABANDONED", "RECOVERY_REQUIRED"]) {
      assert.equal(ayasMicroBatchProgress(microView(batch(status), "history"), BATCH), "SETTLED", status);
    }
    assert.equal(ayasMicroBatchProgress(microView(null, "active"), BATCH), "SETTLED");
    assert.equal(ayasMicroBatchProgress(microView(batch("RESERVED"), "history", false), BATCH), "UNKNOWN");
  });

  await scenario("the incident: a lost read, then RUNNING, then COMPLETED ends SETTLED, applies both usable reads and stops reading", async () => {
    const running = inbox("history", proposal("RESERVED"));
    const done = inbox("today", proposal("COMPLETED"));
    const source = scripted<AyasApprovalInboxView>([new Error("524"), running, done, inbox("pending", proposal("PENDING"))]);
    const applied: AyasApprovalInboxView[] = [];
    const { waits, wait } = recorder();
    const progress = await recheckAyasAfterLostResponse({ read: source.read, progress: (view) => ayasProposalProgress(view, ID), apply: (view) => applied.push(view), wait });
    assert.equal(progress, "SETTLED");
    assert.equal(source.calls(), 3, "no read after the settled one");
    assert.deepEqual(applied, [running, done]);
    assert.deepEqual(waits, AYAS_LOST_RESPONSE_RECHECK_DELAYS_MS.slice(1, 3), "the first read is immediate; later ones follow the fixed schedule");
    assert.equal(ayasLostResponseErrorCode(progress), null, "a finished run leaves no error; its card shows the outcome");
  });

  await scenario("a click that never reached the server (still PENDING) ends NOT_STARTED after one read and keeps the plain transport error", async () => {
    const source = scripted<AyasApprovalInboxView>([inbox("pending", proposal("PENDING"))]);
    const progress = await recheckAyasAfterLostResponse({ read: source.read, progress: (view) => ayasProposalProgress(view, ID), apply: () => undefined, wait: recorder().wait });
    assert.equal(progress, "NOT_STARTED");
    assert.equal(source.calls(), 1);
    assert.equal(ayasLostResponseErrorCode(progress), "NETWORK_ERROR");
  });

  await scenario("every read lost: UNKNOWN after exactly the scheduled number of reads, nothing applied, RESULT_UNKNOWN shown", async () => {
    const source = scripted<AyasApprovalInboxView>([new Error("lost")]);
    let applied = 0;
    const progress = await recheckAyasAfterLostResponse({ read: source.read, progress: (view) => ayasProposalProgress(view, ID), apply: () => { applied += 1; }, wait: recorder().wait });
    assert.equal(progress, "UNKNOWN");
    assert.equal(source.calls(), AYAS_LOST_RESPONSE_RECHECK_DELAYS_MS.length);
    assert.equal(applied, 0);
    assert.equal(ayasLostResponseErrorCode(progress), "RESULT_UNKNOWN");
  });

  await scenario("a run that outlasts the schedule ends RUNNING (bounded), keeps the last durable view, and asks the owner to check before retrying", async () => {
    const source = scripted<AyasApprovalInboxView>([inbox("history", proposal("RESERVED"))]);
    let applied = 0;
    const progress = await recheckAyasAfterLostResponse({ read: source.read, progress: (view) => ayasProposalProgress(view, ID), apply: () => { applied += 1; }, wait: recorder().wait });
    assert.equal(progress, "RUNNING");
    assert.equal(source.calls(), AYAS_LOST_RESPONSE_RECHECK_DELAYS_MS.length);
    assert.equal(applied, AYAS_LOST_RESPONSE_RECHECK_DELAYS_MS.length);
    assert.equal(ayasLostResponseErrorCode(progress), "RESULT_UNKNOWN");
  });

  await scenario("a disconnected read is neither applied nor trusted; the next usable read decides", async () => {
    const source = scripted<AyasApprovalInboxView>([inbox("none", undefined, false), inbox("today", proposal("FAILED"))]);
    const applied: AyasApprovalInboxView[] = [];
    const progress = await recheckAyasAfterLostResponse({ read: source.read, progress: (view) => ayasProposalProgress(view, ID), apply: (view) => applied.push(view), wait: recorder().wait });
    assert.equal(progress, "SETTLED");
    assert.equal(applied.length, 1);
    assert.equal(applied[0]!.connected, true);
  });

  await scenario("the batch lane settles the same way", async () => {
    const source = scripted<AyasMicroBatchDevelopmentView>([new Error("524"), microView(batch("COMPLETED"), "history")]);
    const progress = await recheckAyasAfterLostResponse({ read: source.read, progress: (view) => ayasMicroBatchProgress(view, BATCH), apply: () => undefined, wait: recorder().wait });
    assert.equal(progress, "SETTLED");
    assert.equal(source.calls(), 2);
  });

  await scenario("the schedule is a fixed, bounded array: immediate first read, at most 10 reads, under 5 minutes of waiting", () => {
    assert.equal(AYAS_LOST_RESPONSE_RECHECK_DELAYS_MS[0], 0);
    assert.ok(AYAS_LOST_RESPONSE_RECHECK_DELAYS_MS.length <= 10);
    assert.ok(AYAS_LOST_RESPONSE_RECHECK_DELAYS_MS.reduce<number>((sum, ms) => sum + ms, 0) < 5 * 60_000);
    const src = fs.readFileSync(path.join(process.cwd(), "src", "components", "brain", "ayasLostResponseRecheck.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const banned of ["setInterval(", "fetch(", "XMLHttpRequest", "child_process"]) assert.ok(!src.includes(banned), `the recheck must not use ${banned}`);
    assert.match(src, /AYAS_LOST_RESPONSE_RECHECK_DELAYS_MS\s*=\s*\[[^\]]*\]\s*as const/);
  });

  await scenario("BrainCoreConsole: each one-click handler sends its action once, rechecks on a lost response, and re-reads every panel when done", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "components", "brain", "BrainCoreConsole.tsx"), "utf8");
    for (const [handler, action, read, progress] of [
      ["onBatchOnaylaVeUygula", "batchOnaylaVeUygula", "refreshMicroBatch", "ayasMicroBatchProgress"],
      ["onProposalOnaylaVeUygula", "proposalOnaylaVeUygula", "refreshApprovalInbox", "ayasProposalProgress"],
      ["onOwnerApprovalDecision", "ownerApprovalDecision", "refreshApprovalInbox", "ayasProposalProgress"],
    ] as const) {
      const start = src.indexOf(`const ${handler} = useCallback(`);
      assert.ok(start >= 0, `${handler} exists`);
      const body = src.slice(start, src.indexOf("}, [", start));
      assert.equal(body.split(`await ${action}(`).length - 1, 1, `${handler} sends ${action} exactly once`);
      assert.match(body, new RegExp(`recheckAyasAfterLostResponse\\(\\{ read: ${read}, progress: \\(view\\) => ${progress}\\(`), `${handler} rechecks through ${read}`);
      assert.match(body, /finally \{[\s\S]*doRefresh\(\);/, `${handler} re-reads every panel when done`);
    }
    assert.match(src, /const doRefresh = useCallback\(/);
  });

  await scenario("AyasDevelopmentCenter: every one-click error map explains RESULT_UNKNOWN", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "components", "brain", "AyasDevelopmentCenter.tsx"), "utf8");
    for (const map of ["proposalOnaylaErrorLabel", "ayasOwnerDecisionErrorLabel", "batchOnaylaErrorLabel"]) {
      const start = src.indexOf(`const ${map}: Record<string, string> = {`);
      assert.ok(start >= 0, `${map} exists`);
      assert.match(src.slice(start, src.indexOf("};", start)), /RESULT_UNKNOWN: "Sunucudan yanıt alınamadı/, `${map} has RESULT_UNKNOWN`);
    }
  });

  console.log(`PASS (${count} scenarios)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
