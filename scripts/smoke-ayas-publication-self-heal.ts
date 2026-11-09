import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { classifyAyasGitPushFailure, fetchAyasRemoteBranch, pushAyasBranchWithRetry } from "../src/lib/brain/autonomy/AyasGitPushRetry";
import {
  AYAS_GRAPH_HEAL_GRACE_MS, AYAS_GRAPH_HEAL_MAX_ATTEMPTS_PER_HEAD, AYAS_GRAPH_HEAL_RETRY_SPACING_MS,
  collectAyasGraphHealFacts, decideAyasGraphHeal, readAyasGraphHealAttempts, runAyasGraphHeal, type AyasGraphHealFacts,
} from "../src/lib/brain/autonomy/AyasPublicationSelfHeal";

/**
 * Owner, 2026-11-05: "böyle hatalarda sistemin kendi kendini düzeltmesini istiyorum". The 2026-11-04 publication
 * failed on GitHub's "Internal Server Error" and Graphify stayed stale for 21 hours. This suite pins the two pieces
 * outside the recovery proof (that one is in smoke-ayas-recovery-reconciliation): the lanes' bounded push retry and
 * the update executor's Graphify self-heal. TEMP repositories only; Graphify itself is a test seam.
 */
let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-publication-self-heal-"));
const git = (repo: string, args: readonly string[], env: Record<string, string> = {}): string =>
  execFileSync("git", ["-c", "user.name=AYAS Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.autocrlf=false", ...args],
    { cwd: repo, encoding: "utf8", windowsHide: true, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }).trim();

/** The exact text `git push` printed on 2026-11-04 (from the RECOVERY_REQUIRED journal entry). */
const INCIDENT = [
  "Command failed: git push origin wip/ayas-graphify-final-execution",
  "remote: Internal Server Error        ",
  "remote: Request ID 224E:13F02B:481F6D2:652FD9A:6AEB03B1        ",
  "remote: Time 2026-11-04T10:06:42Z",
  "To https://github.com/ahmetbalkan16-maker/atolye-v2.git",
  " ! [remote rejected]   wip/ayas-graphify-final-execution -> wip/ayas-graphify-final-execution (Internal Server Error)",
  "error: failed to push some refs to 'https://github.com/ahmetbalkan16-maker/atolye-v2.git'",
].join("\n");

function repoWithRemote(name: string): { readonly repo: string; readonly remote: string } {
  const root = path.join(base, name);
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", remote], { windowsHide: true });
  git(repo, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  git(repo, ["add", "--", "a.txt"]);
  git(repo, ["commit", "-q", "-m", "base"]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "-q", "origin", "main"]);
  return { repo, remote };
}

function facts(overrides: Partial<AyasGraphHealFacts> = {}): AyasGraphHealFacts {
  const nowMs = Date.parse("2026-11-05T12:00:00.000Z");
  return { enabled: true, head: "a".repeat(40), graphFresh: false, treeClean: true, publicationInFlight: false, headCommittedAtMs: nowMs - AYAS_GRAPH_HEAL_GRACE_MS - 1, nowMs, attempts: [], ...overrides };
}

async function main(): Promise<void> {
  try {
    await scenario("the 2026-11-04 failure is TRANSIENT even though Git calls it [remote rejected]; real answers are PERMANENT", () => {
      assert.equal(classifyAyasGitPushFailure(INCIDENT), "TRANSIENT");
      for (const transient of [
        "fatal: unable to access 'https://github.com/x/y.git/': The requested URL returned error: 502",
        "error: RPC failed; HTTP 500 curl 22 The requested URL returned error: 500",
        "fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com",
        "fatal: the remote end hung up unexpectedly",
        "fatal: unable to access 'https://github.com/x/y.git/': Failed to connect to github.com port 443 after 21045 ms: Timed out",
        " ! [remote rejected] main -> main (failed to update ref)",
        "something nobody has seen before",
      ]) assert.equal(classifyAyasGitPushFailure(transient), "TRANSIENT", transient);
      for (const permanent of [
        " ! [rejected]        main -> main (non-fast-forward)\nhint: Updates were rejected because the tip of your current branch is behind",
        " ! [rejected]        main -> main (fetch first)",
        "remote: error: GH006: Protected branch update failed for refs/heads/main.\n ! [remote rejected] main -> main (protected branch hook declined)",
        " ! [remote rejected] main -> main (pre-receive hook declined)",
        "remote: Permission to x/y.git denied to someone.\nfatal: unable to access 'https://github.com/x/y.git/': The requested URL returned error: 403",
        "fatal: Authentication failed for 'https://github.com/x/y.git/'",
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        "remote: Repository not found.\nfatal: repository 'https://github.com/x/y.git/' not found",
        "fatal: 'nowhere' does not appear to be a git repository",
        "error: src refspec main does not match any",
      ]) assert.equal(classifyAyasGitPushFailure(permanent), "PERMANENT", permanent);
    });

    await scenario("a TRANSIENT failure is retried with the backoff and the same arguments; success ends it", () => {
      const calls: string[][] = []; const slept: number[] = []; let left = 2;
      const result = pushAyasBranchWithRetry("D:/repo", "origin", "main", {
        run: (_root, args) => { calls.push([...args]); if (left-- > 0) throw new Error(INCIDENT); },
        sleep: (ms) => { slept.push(ms); },
      });
      assert.deepEqual(result, { attempts: 3 });
      assert.deepEqual(calls, [["push", "origin", "main"], ["push", "origin", "main"], ["push", "origin", "main"]], "never --force, never a +refspec");
      assert.deepEqual(slept, [2_000, 8_000]);
    });

    await scenario("a PERMANENT failure is not retried; giving up rethrows the last failure unchanged", () => {
      let calls = 0;
      const nonFastForward = new Error(" ! [rejected]        main -> main (non-fast-forward)");
      assert.throws(() => pushAyasBranchWithRetry("D:/repo", "origin", "main", { run: () => { calls += 1; throw nonFastForward; }, sleep: () => undefined }), (error) => error === nonFastForward);
      assert.equal(calls, 1);
      calls = 0;
      const slept: number[] = [];
      assert.throws(() => pushAyasBranchWithRetry("D:/repo", "origin", "main", { run: () => { calls += 1; throw new Error(`${INCIDENT} #${calls}`); }, sleep: (ms) => { slept.push(ms); } }), /#4$/);
      assert.equal(calls, 4, "bounded: four attempts in all");
      assert.deepEqual(slept, [2_000, 8_000, 20_000]);
    });

    await scenario("anything but a plain remote and branch is refused before Git runs", () => {
      for (const [remote, branch] of [["origin", "+main"], ["origin", "--force"], ["origin", "main:other"], ["--mirror", "main"], ["", "main"]] as const) {
        assert.throws(() => pushAyasBranchWithRetry("D:/repo", remote, branch, { run: () => assert.fail("git must not run") }), /AYAS_GIT_PUSH_REFUSED/);
      }
    });

    await scenario("real Git: the push publishes the branch; fetch updates the tracking ref and reports an unreachable remote as false", () => {
      const { repo } = repoWithRemote("real-git");
      fs.writeFileSync(path.join(repo, "a.txt"), "two\n");
      git(repo, ["commit", "-q", "-am", "next"]);
      const head = git(repo, ["rev-parse", "HEAD"]);
      assert.deepEqual(pushAyasBranchWithRetry(repo, "origin", "main", { run: (root, args) => { git(root, args); } }), { attempts: 1 });
      assert.equal(git(repo, ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0], head);
      assert.equal(fetchAyasRemoteBranch(repo, "origin", "main", (root, args) => { git(root, args); }), true);
      assert.equal(git(repo, ["rev-parse", "origin/main"]), head);
      git(repo, ["remote", "add", "gone", path.join(base, "does-not-exist.git")]);
      assert.equal(fetchAyasRemoteBranch(repo, "gone", "main", (root, args) => { git(root, args); }), false);
    });

    await scenario("Graphify heal decision: only a stale graph on a clean, quiet tree, well after the commit, a bounded number of times", () => {
      assert.deepEqual(decideAyasGraphHeal(facts()), { kind: "HEAL" });
      assert.deepEqual(decideAyasGraphHeal(facts({ enabled: false })), { kind: "NONE", reason: "DISABLED" });
      assert.deepEqual(decideAyasGraphHeal(facts({ graphFresh: true })), { kind: "NONE", reason: "GRAPH_FRESH" });
      assert.deepEqual(decideAyasGraphHeal(facts({ treeClean: false })), { kind: "NONE", reason: "DIRTY_TREE" });
      assert.deepEqual(decideAyasGraphHeal(facts({ publicationInFlight: true })), { kind: "NONE", reason: "PUBLICATION_IN_FLIGHT" });
      const f = facts();
      assert.deepEqual(decideAyasGraphHeal({ ...f, headCommittedAtMs: f.nowMs - 60_000 }), { kind: "NONE", reason: "WITHIN_CLOSURE_WINDOW" }, "a publication's own closure gets its window");
      assert.deepEqual(decideAyasGraphHeal({ ...f, headCommittedAtMs: undefined }), { kind: "NONE", reason: "WITHIN_CLOSURE_WINDOW" });
      const recent = { head: f.head, at: new Date(f.nowMs - 60_000).toISOString(), ok: false, detail: "x" };
      assert.deepEqual(decideAyasGraphHeal({ ...f, attempts: [recent] }), { kind: "NONE", reason: "RETRY_SPACING" });
      const old = { ...recent, at: new Date(f.nowMs - AYAS_GRAPH_HEAL_RETRY_SPACING_MS - 1).toISOString() };
      assert.deepEqual(decideAyasGraphHeal({ ...f, attempts: [old] }), { kind: "HEAL" });
      assert.deepEqual(decideAyasGraphHeal({ ...f, attempts: Array.from({ length: AYAS_GRAPH_HEAL_MAX_ATTEMPTS_PER_HEAD }, () => old) }), { kind: "NONE", reason: "ATTEMPTS_EXHAUSTED" });
      assert.deepEqual(decideAyasGraphHeal({ ...f, attempts: Array.from({ length: 5 }, () => ({ ...old, head: "b".repeat(40) })) }), { kind: "HEAL" }, "another HEAD's attempts do not count");
      // 9 Nov 2026: the grace counts from when HEAD arrived here (reflog), not from its commit time.
      const pulledJustNow = { ...f, headCommittedAtMs: f.nowMs - 3 * 24 * 60 * 60_000, headArrivedAtMs: f.nowMs - 60_000 };
      assert.deepEqual(decideAyasGraphHeal(pulledJustNow), { kind: "NONE", reason: "WITHIN_CLOSURE_WINDOW" }, "a commit pulled a minute ago gets the session's own refresh first");
      assert.deepEqual(decideAyasGraphHeal({ ...pulledJustNow, headArrivedAtMs: f.nowMs - AYAS_GRAPH_HEAL_GRACE_MS - 1 }), { kind: "HEAL" });
      assert.deepEqual(decideAyasGraphHeal({ ...f, headCommittedAtMs: f.nowMs - 60_000, headArrivedAtMs: f.nowMs - AYAS_GRAPH_HEAL_GRACE_MS - 1 }), { kind: "HEAL" },
        "a fresh commit time does not hold back a heal once the arrival grace passed");
      assert.ok(AYAS_GRAPH_HEAL_GRACE_MS <= 5 * 60_000, "the heal comes within minutes, inside the control center's 30-minute 'refreshing' window");
    });

    await scenario("facts are read from the real tree: stale vs fresh graph, dirty tree, an open gate", () => {
      const { repo } = repoWithRemote("facts");
      const store = path.join(base, "facts-store");
      const head = git(repo, ["rev-parse", "HEAD"]);
      const later = new Date(Date.now() + AYAS_GRAPH_HEAL_GRACE_MS + 60_000);
      let read = collectAyasGraphHealFacts(repo, store, later);
      assert.equal(read.head, head);
      assert.ok(read.headArrivedAtMs !== undefined && Math.abs(read.headArrivedAtMs - Date.now()) < 10 * 60_000, "HEAD's arrival is read from the reflog");
      assert.equal(read.graphFresh, false, "no graph at all is not fresh");
      assert.equal(read.treeClean, true);
      assert.equal(read.publicationInFlight, false);
      assert.deepEqual(decideAyasGraphHeal(read), { kind: "HEAL" });
      fs.mkdirSync(path.join(repo, ".graphify"));
      fs.writeFileSync(path.join(repo, ".git", "info", "exclude"), ".graphify/\n");
      fs.writeFileSync(path.join(repo, ".graphify", "graph.json"), "{}");
      fs.writeFileSync(path.join(repo, ".graphify", "branch.json"), JSON.stringify({ lastAnalyzedHead: head, stale: false }));
      read = collectAyasGraphHealFacts(repo, store, later);
      assert.equal(read.graphFresh, true);
      fs.writeFileSync(path.join(repo, ".graphify", "needs_update"), "");
      assert.equal(collectAyasGraphHealFacts(repo, store, later).graphFresh, false, "a pending update marker is not fresh");
      fs.writeFileSync(path.join(repo, "wip.txt"), "x");
      assert.equal(collectAyasGraphHealFacts(repo, store, later).treeClean, false);
      fs.rmSync(path.join(repo, "wip.txt"));
      const gate = path.join(repo, "data", "brain", "self-improvement", "execution");
      fs.mkdirSync(gate, { recursive: true });
      fs.writeFileSync(path.join(repo, ".git", "info", "exclude"), ".graphify/\ndata/\n");
      fs.writeFileSync(path.join(gate, "gate.json"), JSON.stringify({ state: "OPEN", updatedAt: later.toISOString() }));
      assert.equal(collectAyasGraphHealFacts(repo, store, later).publicationInFlight, true);
    });

    await scenario("a heal records its outcome: success, a failed refresh, and a HEAD that moved during the refresh", () => {
      const { repo } = repoWithRemote("heal-run");
      const store = path.join(base, "heal-store");
      const head = git(repo, ["rev-parse", "HEAD"]);
      const refreshed: string[] = [];
      assert.equal(runAyasGraphHeal(head, { repoRoot: repo, storeRoot: store, refresh: (h) => { refreshed.push(h); } }).ok, true);
      assert.deepEqual(refreshed, [head]);
      const failed = runAyasGraphHeal(head, { repoRoot: repo, storeRoot: store, refresh: () => { throw Object.assign(new Error("Graphify did not become fresh"), { code: "AYAS_POST_PUBLICATION_GRAPHIFY_STALE" }); } });
      assert.equal(failed.ok, false);
      assert.match(failed.detail, /^AYAS_POST_PUBLICATION_GRAPHIFY_STALE: /);
      const moved = runAyasGraphHeal(head, { repoRoot: repo, storeRoot: store, refresh: () => { fs.writeFileSync(path.join(repo, "a.txt"), "moved\n"); git(repo, ["commit", "-q", "-am", "moved"]); } });
      assert.equal(moved.ok, false);
      assert.match(moved.detail, /^HEAD moved to /);
      assert.deepEqual(readAyasGraphHealAttempts(store).map((a) => a.ok), [true, false, false]);
    });

    console.log(`PASS (${count} scenarios)`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
