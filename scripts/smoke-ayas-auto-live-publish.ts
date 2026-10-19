import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AYAS_OWNER_CHAT_ACTIVITY_FILE, markAyasOwnerChatActivity, readAyasOwnerChatActivityAt } from "../src/lib/ayas/AyasOwnerChatActivity";
import {
  AYAS_AUTO_LIVE_MAX_ATTEMPTS, AYAS_AUTO_LIVE_OWNER_QUIET_MS, AYAS_AUTO_LIVE_STATE_FILE, AYAS_LIVE_APP_PATHS, decideAyasAutoLivePublish, readAyasAutoLiveAttempts,
  recordAyasAutoLiveAttempt, type AyasAutoLiveAttempt, type AyasAutoLiveFacts,
} from "../src/lib/brain/autonomy/AyasAutoLivePublish";
import { runAyasAutoLivePublish } from "../src/lib/brain/autonomy/AyasUpdateApplyRunner";
import { createAyasUpdateTrialStore } from "../src/lib/brain/autonomy/AyasUpdateTrialStore";

/**
 * Owner decision 2026-10-19: a finished task (the pushed HEAD) goes live by itself. The decision, the attempt record,
 * the owner-chat quiet window and the executor/route wiring. The live publish itself is a stub: no PowerShell, network,
 * port, live copy or production state.
 */
const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-auto-live-"));
let count = 0;
const scenario = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  try { await fn(); } catch (error) { console.error(`FAIL: ${name}`); throw error; }
  count += 1;
};
const read = (relative: string): string => fs.readFileSync(path.join(repo, relative), "utf8");

const HEAD = "a".repeat(40), LIVE = "b".repeat(40), OTHER = "c".repeat(40);
const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const facts = (over: Partial<AyasAutoLiveFacts> = {}): AyasAutoLiveFacts => ({
  enabled: true, head: HEAD, upstreamHead: HEAD, liveHead: LIVE, liveIsAncestor: () => true, appChanged: () => true, nowMs: NOW, attempts: [], ...over,
});
const attempt = (status: AyasAutoLiveAttempt["status"], commitSha = HEAD, startedAt = "2026-10-19T11:00:00.000Z"): AyasAutoLiveAttempt => ({ commitSha, status, startedAt });

async function main(): Promise<void> {
  await scenario("a pushed HEAD with an application change the live copy lacks is published", () => {
    assert.deepEqual(decideAyasAutoLivePublish(facts()), { kind: "PUBLISH", commitSha: HEAD, liveHead: LIVE });
  });

  await scenario("every refusal has its own reason, checked in order", () => {
    const reason = (over: Partial<AyasAutoLiveFacts>): string => { const d = decideAyasAutoLivePublish(facts(over)); return d.kind === "NONE" ? d.reason : d.kind; };
    assert.equal(reason({ enabled: false }), "DISABLED");
    assert.equal(reason({ liveHead: undefined }), "LIVE_UNKNOWN");
    assert.equal(reason({ liveHead: HEAD }), "CURRENT");
    assert.equal(reason({ upstreamHead: undefined }), "NOT_PUSHED");
    assert.equal(reason({ upstreamHead: OTHER }), "NOT_PUSHED");
    assert.equal(reason({ attempts: [attempt("ROLLED_BACK")] }), "ROLLED_BACK_BEFORE");
    assert.equal(reason({ liveIsAncestor: () => false }), "NOT_DESCENDANT");
    assert.equal(reason({ appChanged: () => false }), "NO_APP_CHANGE");
  });

  await scenario("attempts are bounded per commit; an interrupted (RUNNING) attempt counts, another commit's does not", () => {
    assert.equal(AYAS_AUTO_LIVE_MAX_ATTEMPTS, 2);
    const failed = [attempt("FAILED"), attempt("RUNNING", HEAD, "2026-10-19T11:30:00.000Z")];
    assert.deepEqual(decideAyasAutoLivePublish(facts({ attempts: failed })), { kind: "NONE", reason: "ATTEMPTS_EXHAUSTED" });
    assert.equal(decideAyasAutoLivePublish(facts({ attempts: [attempt("FAILED")] })).kind, "PUBLISH");
    assert.equal(decideAyasAutoLivePublish(facts({ attempts: [attempt("ROLLED_BACK", OTHER), attempt("FAILED", OTHER), attempt("FAILED", OTHER)] })).kind, "PUBLISH");
  });

  await scenario("it waits while the owner chatted in the last five minutes", () => {
    assert.equal(AYAS_AUTO_LIVE_OWNER_QUIET_MS, 5 * 60_000);
    const at = (msAgo: number): string => new Date(NOW - msAgo).toISOString();
    assert.deepEqual(decideAyasAutoLivePublish(facts({ ownerChatAt: at(4 * 60_000) })), { kind: "NONE", reason: "OWNER_ACTIVE" });
    assert.equal(decideAyasAutoLivePublish(facts({ ownerChatAt: at(6 * 60_000) })).kind, "PUBLISH");
    assert.equal(decideAyasAutoLivePublish(facts({ ownerChatAt: "not a time" })).kind, "PUBLISH");
  });

  await scenario("git facts are read only when the cheaper facts already allow a publish", () => {
    let calls = 0;
    const lazy = { liveIsAncestor: () => { calls += 1; return true; }, appChanged: () => { calls += 1; return true; } };
    for (const over of [{ enabled: false }, { liveHead: HEAD }, { upstreamHead: OTHER }, { attempts: [attempt("ROLLED_BACK")] }]) decideAyasAutoLivePublish(facts({ ...lazy, ...over }));
    assert.equal(calls, 0);
  });

  await scenario("the application paths are the publish script's own list", () => {
    const line = read("scripts/ayas-publish-live.ps1").split(/\r?\n/).find((entry) => entry.startsWith("$appPaths = @("));
    assert.ok(line, "$appPaths line");
    assert.deepEqual([...line.matchAll(/'([^']+)'/g)].map((match) => match[1]), [...AYAS_LIVE_APP_PATHS]);
  });

  await scenario("the attempt record replaces RUNNING with the outcome, keeps the latest 50 and reads garbage as none", () => {
    const root = path.join(temp, "record");
    recordAyasAutoLiveAttempt(root, attempt("RUNNING"));
    recordAyasAutoLiveAttempt(root, { ...attempt("PUBLISHED"), finishedAt: "2026-10-19T11:05:00.000Z", summary: "ok" });
    assert.deepEqual(readAyasAutoLiveAttempts(root).map((entry) => entry.status), ["PUBLISHED"]);
    for (let index = 0; index < 60; index += 1) recordAyasAutoLiveAttempt(root, attempt("FAILED", HEAD, new Date(NOW + index * 1000).toISOString()));
    assert.equal(readAyasAutoLiveAttempts(root).length, 50);
    fs.writeFileSync(path.join(root, AYAS_AUTO_LIVE_STATE_FILE), "{broken");
    assert.deepEqual(readAyasAutoLiveAttempts(root), []);
    fs.writeFileSync(path.join(root, AYAS_AUTO_LIVE_STATE_FILE), JSON.stringify({ attempts: [{ commitSha: "x", status: "PUBLISHED", startedAt: "t" }, attempt("FAILED")] }));
    assert.equal(readAyasAutoLiveAttempts(root).length, 1);
  });

  await scenario("the publish is recorded as RUNNING before it starts, then with its outcome; a throwing publish is FAILED", async () => {
    const store = createAyasUpdateTrialStore({ rootDir: path.join(temp, "publish") });
    let seenBefore: string[] = [];
    let clock = 0;
    const now = (): string => new Date(NOW + (clock += 1000)).toISOString();
    const done = await runAyasAutoLivePublish(HEAD, {
      repoRoot: repo, store, now,
      publishLive: async (commit) => { assert.equal(commit, HEAD); seenBefore = readAyasAutoLiveAttempts(store.rootDir).map((entry) => entry.status); return { status: "ROLLED_BACK", summary: "[TAMAM] Onceki surum yeniden yayinda" }; },
    });
    assert.deepEqual(seenBefore, ["RUNNING"]);
    assert.equal(done.status, "ROLLED_BACK");
    assert.deepEqual(readAyasAutoLiveAttempts(store.rootDir).map((entry) => entry.status), ["ROLLED_BACK"]);
    assert.deepEqual(decideAyasAutoLivePublish(facts({ attempts: readAyasAutoLiveAttempts(store.rootDir) })), { kind: "NONE", reason: "ROLLED_BACK_BEFORE" });
    const thrown = await runAyasAutoLivePublish(OTHER, { repoRoot: repo, store, now, publishLive: async () => { throw new Error("powershell missing"); } });
    assert.equal(thrown.status, "FAILED");
    assert.match(thrown.summary ?? "", /powershell missing/);
  });

  await scenario("the owner's chat time is a timestamp only, and a failed write never throws", () => {
    const root = path.join(temp, "activity");
    assert.equal(readAyasOwnerChatActivityAt(root), undefined);
    markAyasOwnerChatActivity(root, new Date(NOW));
    assert.equal(readAyasOwnerChatActivityAt(root), new Date(NOW).toISOString());
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(root, AYAS_OWNER_CHAT_ACTIVITY_FILE), "utf8"))).sort(), ["lastChatAt", "schemaVersion"]);
    const blocked = path.join(temp, "blocked-root");
    fs.writeFileSync(blocked, "a file where the directory would be");
    assert.doesNotThrow(() => markAyasOwnerChatActivity(blocked));
  });

  await scenario("the chat route marks the owner's turn after authentication and text validation, before any answer", () => {
    const route = read("app/api/ayas/chat/stream/route.ts");
    const mark = route.indexOf("markAyasOwnerChatActivity();");
    assert.ok(mark > route.indexOf("authentication_required") && mark > route.indexOf("invalid_text"));
    assert.ok(mark < route.indexOf("startAyasTrace(") && mark < route.indexOf("answerAyasLiveInfo("));
  });

  await scenario("the executor runs it after the owner's own jobs and before the background trials, with an off switch", () => {
    const executor = read("scripts/ayas-update-executor.ts");
    const decide = executor.indexOf("decideAyasAutoLivePublish(autoLiveFacts(");
    assert.ok(decide > executor.indexOf('report("MODEL_SWITCH_"') && decide < executor.indexOf("selectAyasUpdateTrialJob("));
    assert.ok(decide > executor.indexOf('return report("SKIPPED_DIRTY_TREE")'));
    assert.ok(executor.includes('enabled: process.env.AYAS_AUTO_LIVE_PUBLISH !== "0"'));
    assert.ok(executor.includes("runAyasAutoLivePublish(autoLive.commitSha"));
  });

  await scenario("both new records live outside Git, so the observer never sees them as a dirty tree", () => {
    for (const relative of [AYAS_OWNER_CHAT_ACTIVITY_FILE, path.join("data", "brain", "self-improvement", "update-trials", AYAS_AUTO_LIVE_STATE_FILE)]) {
      const posix = relative.split(path.sep).join("/");
      assert.equal(spawnSync("git", ["check-ignore", "-q", "--no-index", posix], { cwd: repo, windowsHide: true }).status, 0, `${posix} must be ignored`);
    }
  });

  console.log(JSON.stringify({ status: "PASS", suite: "ayas-auto-live-publish", scenarios: count, livePublishes: 0, networkCalls: 0 }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { fs.rmSync(temp, { recursive: true, force: true }); });
