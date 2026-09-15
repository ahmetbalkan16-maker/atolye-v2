import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasAutonomyObserver } from "../src/lib/brain/autonomy/AyasAutonomyObserver";
import { readAyasApprovalInboxProposals, AyasApprovalInboxReaderError } from "../src/lib/brain/autonomy/AyasApprovalInboxReader";
import { loadAyasApprovalInboxView } from "../src/lib/brain/autonomy/AyasApprovalInboxView";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-observer-")); }
function read(relPath: string): string { return fs.readFileSync(path.join(process.cwd(), relPath), "utf8"); }

async function main() {
  await scenario("normal observation reaches OBSERVING", () => {
    const observer = createAyasAutonomyObserver({ now: () => "2026-09-15T12:00:00.000Z" });
    assert.equal(observer.state.phase, "STARTING");
    observer.observe({ now: "2026-09-15T12:00:00.000Z", branch: "wip/test", head: "abc", repoClean: true, graphifyFresh: true, machineAction: "ALLOW", gaps: [] });
    assert.equal(observer.state.phase, "OBSERVING");
  });

  await scenario("machine health PAUSE pauses the observer", () => {
    const observer = createAyasAutonomyObserver();
    observer.observe({ now: "2026-09-15T12:00:00.000Z", branch: "wip/test", head: "abc", repoClean: true, graphifyFresh: true, machineAction: "PAUSE", gaps: [] });
    assert.equal(observer.state.phase, "PAUSED_MACHINE_HEALTH");
    assert.match(observer.state.lastError ?? "", /PAUSE/);
  });

  await scenario("machine health STOP OWN WORKLOAD pauses the observer", () => {
    const observer = createAyasAutonomyObserver();
    observer.observe({ now: "2026-09-15T12:00:00.000Z", branch: "wip/test", head: "abc", repoClean: true, graphifyFresh: true, machineAction: "STOP OWN WORKLOAD", gaps: [] });
    assert.equal(observer.state.phase, "PAUSED_MACHINE_HEALTH");
    assert.match(observer.state.lastError ?? "", /STOP OWN WORKLOAD/);
  });

  await scenario("dirty repo pauses the observer", () => {
    const observer = createAyasAutonomyObserver();
    observer.observe({ now: "2026-09-15T12:00:00.000Z", branch: "wip/test", head: "abc", repoClean: false, graphifyFresh: true, machineAction: "ALLOW", gaps: [] });
    assert.equal(observer.state.phase, "PAUSED_DIRTY_REPO");
  });

  await scenario("observer state survives restart via an isolated state file", () => {
    const workspace = root();
    const stateFile = path.join(workspace, "observer-state.json");
    const first = createAyasAutonomyObserver({ stateFile, now: () => "2026-09-15T12:00:00.000Z" });
    first.observe({ now: "2026-09-15T12:00:00.000Z", branch: "wip/test", head: "abc", repoClean: true, graphifyFresh: true, machineAction: "ALLOW", gaps: [] });
    const second = createAyasAutonomyObserver({ stateFile });
    assert.equal(second.state.phase, "OBSERVING");
  });

  await scenario("corrupt observer state file fails loudly", () => {
    const workspace = root();
    const stateFile = path.join(workspace, "observer-state.json");
    fs.writeFileSync(stateFile, "not json");
    assert.throws(() => createAyasAutonomyObserver({ stateFile }));
  });

  await scenario("observer module has no import of the execution gate, approval store, or any mutation API", () => {
    const src = read("src/lib/brain/autonomy/AyasAutonomyObserver.ts");
    assert.doesNotMatch(src, /AyasExecutionGateStore|AyasApprovalInboxStore|consumeApproval|executeApproved|createProposal|\bdiscover\s*\(|\bdecide\s*\(/);
  });

  await scenario("observer factory exposes no discover/decide/executeApproved/inbox surface", () => {
    const observer = createAyasAutonomyObserver() as unknown as Record<string, unknown>;
    for (const key of ["discover", "decide", "executeApproved", "inbox", "transition"]) {
      assert.equal(key in observer, false, `observer must not expose "${key}"`);
    }
  });

  await scenario("runner imports only the observer module — no daemon, no approval store, no execution gate", () => {
    const src = read("scripts/ayas-autonomy-daemon.ts");
    assert.doesNotMatch(src, /AyasAutonomyDaemon\b|AyasApprovalInboxStore|AyasExecutionGateStore|approval-inbox/);
    assert.match(src, /createAyasAutonomyObserver/);
  });

  await scenario("runner never calls discover(), decide(), or executeApproved()", () => {
    const src = read("scripts/ayas-autonomy-daemon.ts");
    assert.doesNotMatch(src, /\.discover\s*\(|\.decide\s*\(|\.executeApproved\s*\(/);
  });

  await scenario("runner cannot write production/pipeline state", () => {
    const src = read("scripts/ayas-autonomy-daemon.ts");
    assert.doesNotMatch(src, /git\s+(add|commit|push)|production:acceptance:(execute|resume)|writeFileSync\([^)]*data[\\/]projects/i);
  });

  await scenario("/brain approval panel is display-only: no ONAYLA, REDDET, or DAHA SONRA control", () => {
    const src = read("src/components/brain/AyasApprovalInboxPanel.tsx");
    assert.doesNotMatch(src, /ONAYLA|REDDET|DAHA SONRA|onClick|onDecision/);
    assert.match(src, /inbox\.pending\.map/);
  });

  await scenario("decideAyasApproval is not reachable from the Stage 7A /brain UI path", () => {
    const pageSrc = read("app/brain/page.tsx");
    const consoleSrc = read("src/components/brain/BrainCoreConsole.tsx");
    assert.doesNotMatch(pageSrc, /decideAyasApproval/);
    assert.doesNotMatch(consoleSrc, /decideApproval/);
  });

  await scenario("no Stage 7A file references the execution gate — it cannot be reached from this sprint's code", () => {
    const files = [
      "src/lib/brain/autonomy/AyasAutonomyObserver.ts",
      "scripts/ayas-autonomy-daemon.ts",
      "src/components/brain/AyasApprovalInboxPanel.tsx",
      "src/components/brain/BrainCoreConsole.tsx",
      "app/brain/page.tsx",
    ];
    for (const file of files) {
      assert.doesNotMatch(read(file), /AyasExecutionGateStore/, `${file} must not reference the execution gate`);
    }
  });

  await scenario("missing inbox file returns a safe empty/display state", () => {
    const workspace = root();
    assert.deepEqual(readAyasApprovalInboxProposals({ rootDir: workspace }), []);
  });

  await scenario("corrupt inbox JSON fails loudly at the reader boundary (not silently reinterpreted)", () => {
    const workspace = root();
    fs.mkdirSync(path.join(workspace, "autonomy"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "autonomy", "approval-inbox.json"), "not json");
    assert.throws(() => readAyasApprovalInboxProposals({ rootDir: workspace }), AyasApprovalInboxReaderError);
  });

  await scenario("wrong-schema inbox JSON fails loudly at the reader boundary", () => {
    const workspace = root();
    fs.mkdirSync(path.join(workspace, "autonomy"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "autonomy", "approval-inbox.json"), JSON.stringify({ schemaVersion: "99", proposals: [] }));
    assert.throws(() => readAyasApprovalInboxProposals({ rootDir: workspace }), AyasApprovalInboxReaderError);
  });

  await scenario("loadAyasApprovalInboxView degrades to disconnected (never throws) on a corrupt real-path inbox file", () => {
    const workspace = root();
    const cwd = process.cwd();
    fs.mkdirSync(path.join(workspace, "data", "brain", "autonomy"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "data", "brain", "autonomy", "approval-inbox.json"), "not json");
    process.chdir(workspace);
    try {
      const view = loadAyasApprovalInboxView();
      assert.equal(view.connected, false);
      assert.deepEqual(view.pending, []);
      assert.ok(view.error);
    } finally {
      process.chdir(cwd);
    }
  });

  await scenario("read-only inbox reader and view import no Store/Daemon/Gate module", () => {
    for (const file of ["src/lib/brain/autonomy/AyasApprovalInboxReader.ts", "src/lib/brain/autonomy/AyasApprovalInboxView.ts"]) {
      assert.doesNotMatch(read(file), /AyasApprovalInboxStore|AyasAutonomyDaemon|AyasExecutionGateStore|consumeApproval|createProposal|\.decide\s*\(|executeApproved|authorizationId/, `${file} must stay authority-free`);
    }
  });

  await scenario("read-only inbox reader exposes no mutating API", () => {
    const src = read("src/lib/brain/autonomy/AyasApprovalInboxReader.ts");
    assert.doesNotMatch(src, /export function (createProposal|decide|consumeApproval|recordResult|save)\b/);
  });

  await scenario("app/brain/observerActions.ts imports no Package B module and is the sole source of refreshAyasApprovalInbox for the UI", () => {
    const src = read("app/brain/observerActions.ts");
    assert.doesNotMatch(src, /AyasApprovalInboxStore|decideAyasApproval|\bfrom\s+"\.\/actions"/);
    assert.match(src, /refreshAyasApprovalInbox/);
  });

  await scenario("app/brain/page.tsx sources the inbox refresh from observerActions, not from ./actions", () => {
    const src = read("app/brain/page.tsx");
    assert.match(src, /from\s+"\.\/observerActions"/);
    const actionsImportBlock = src.slice(src.indexOf('from "./actions"') - 400, src.indexOf('from "./actions"'));
    assert.doesNotMatch(actionsImportBlock, /refreshAyasApprovalInbox/);
    assert.doesNotMatch(src, /decideAyasApproval/);
  });

  await scenario("no Stage 7A-reachable file can mint or consume authorization", () => {
    const files = [
      "src/lib/brain/autonomy/AyasAutonomyObserver.ts",
      "src/lib/brain/autonomy/AyasApprovalInboxReader.ts",
      "src/lib/brain/autonomy/AyasApprovalInboxView.ts",
      "app/brain/observerActions.ts",
      "app/brain/page.tsx",
      "src/components/brain/AyasApprovalInboxPanel.tsx",
      "src/components/brain/BrainCoreConsole.tsx",
      "scripts/ayas-autonomy-daemon.ts",
    ];
    for (const file of files) {
      assert.doesNotMatch(read(file), /consumeApproval|createProposal|authorizationId|AyasExecutionGateStore/, `${file} must not reach authorization/execution APIs`);
    }
  });

  console.log(`AYAS autonomy observer smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-autonomy-observer", scenarios: count }));
}
main().catch((error) => { console.error("AYAS autonomy observer smoke FAILED:", error); process.exitCode = 1; });
