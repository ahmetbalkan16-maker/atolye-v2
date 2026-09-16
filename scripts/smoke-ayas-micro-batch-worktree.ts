import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureAyasMicroBatchWorktree, isAyasMicroBatchWorktreeCurrent, captureAyasMicroBatchWorktreeDiff, destroyAyasMicroBatchWorktree, resolveAyasMicroBatchWorktreeRoot } from "../src/lib/brain/autonomy/AyasMicroBatchWorktree";
import { applyAyasBoundedFileReplacements } from "../src/lib/brain/autonomy/AyasBoundedFileWrite";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) { await fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function makeFixtureRepo(): { readonly repoRoot: string; readonly head: string } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-worktree-fixture-repo-"));
  git(repoRoot, ["init", "-q"]);
  git(repoRoot, ["config", "user.email", "fixture@example.com"]);
  git(repoRoot, ["config", "user.name", "fixture"]);
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "scripts", "existing.ts"), "export const existing = 1;\n");
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "-q", "-m", "initial"]);
  const head = git(repoRoot, ["rev-parse", "HEAD"]);
  return { repoRoot, head };
}

async function main(): Promise<void> {
  // Every scenario destroys the shared, FIXED-path persistent worktree before and after itself, since (unlike M17's per-call ephemeral sandbox) this module intentionally reuses one well-known location.
  await scenario("ensureAyasMicroBatchWorktree creates a real, persistent git worktree at baseHead outside the repo", async () => {
    const fixture = makeFixtureRepo();
    await destroyAyasMicroBatchWorktree(fixture.repoRoot);
    const { handle, rebuilt } = await ensureAyasMicroBatchWorktree(fixture.repoRoot, fixture.head);
    try {
      assert.equal(rebuilt, true, "first call always builds fresh");
      assert.ok(fs.existsSync(handle.worktreeRoot));
      assert.ok(fs.existsSync(path.join(handle.worktreeRoot, "scripts", "existing.ts")));
      assert.notEqual(path.resolve(handle.worktreeRoot), path.resolve(fixture.repoRoot));
      assert.equal(handle.worktreeRoot, resolveAyasMicroBatchWorktreeRoot(), "the worktree lives at the one fixed, well-known path");
    } finally {
      await destroyAyasMicroBatchWorktree(fixture.repoRoot);
    }
  });

  await scenario("a second call at the SAME baseHead reuses the existing worktree (rebuilt: false) — persistence, not ephemeral recreation", async () => {
    const fixture = makeFixtureRepo();
    await destroyAyasMicroBatchWorktree(fixture.repoRoot);
    try {
      const first = await ensureAyasMicroBatchWorktree(fixture.repoRoot, fixture.head);
      await applyAyasBoundedFileReplacements(first.handle.worktreeRoot, ["scripts/"], [{ filePath: "scripts/accumulated.ts", expectedHash: null, content: "export const accumulated = true;\n", allowCreate: true }], async () => undefined);
      const second = await ensureAyasMicroBatchWorktree(fixture.repoRoot, fixture.head);
      assert.equal(second.rebuilt, false);
      assert.ok(fs.existsSync(path.join(second.handle.worktreeRoot, "scripts", "accumulated.ts")), "accumulated content survives across calls — this is the point of persistence");
    } finally {
      await destroyAyasMicroBatchWorktree(fixture.repoRoot);
    }
  });

  await scenario("a call at a DIFFERENT baseHead (real branch moved on) destroys and rebuilds fresh — accumulated content is gone", async () => {
    const fixture = makeFixtureRepo();
    await destroyAyasMicroBatchWorktree(fixture.repoRoot);
    try {
      const first = await ensureAyasMicroBatchWorktree(fixture.repoRoot, fixture.head);
      await applyAyasBoundedFileReplacements(first.handle.worktreeRoot, ["scripts/"], [{ filePath: "scripts/accumulated.ts", expectedHash: null, content: "export const accumulated = true;\n", allowCreate: true }], async () => undefined);
      fs.writeFileSync(path.join(fixture.repoRoot, "scripts", "existing.ts"), "export const existing = 2;\n");
      git(fixture.repoRoot, ["add", "-A"]);
      git(fixture.repoRoot, ["commit", "-q", "-m", "moved on"]);
      const newHead = git(fixture.repoRoot, ["rev-parse", "HEAD"]);
      const second = await ensureAyasMicroBatchWorktree(fixture.repoRoot, newHead);
      assert.equal(second.rebuilt, true);
      assert.equal(fs.existsSync(path.join(second.handle.worktreeRoot, "scripts", "accumulated.ts")), false, "old accumulated content must not survive a baseHead rebuild");
      assert.equal(second.handle.baseHead, newHead);
    } finally {
      await destroyAyasMicroBatchWorktree(fixture.repoRoot);
    }
  });

  await scenario("isAyasMicroBatchWorktreeCurrent correctly reports true/false", async () => {
    const fixture = makeFixtureRepo();
    await destroyAyasMicroBatchWorktree(fixture.repoRoot);
    try {
      const { handle } = await ensureAyasMicroBatchWorktree(fixture.repoRoot, fixture.head);
      assert.equal(await isAyasMicroBatchWorktreeCurrent(handle), true);
      const staleHandle = { ...handle, baseHead: "0000000000000000000000000000000000dead" };
      assert.equal(await isAyasMicroBatchWorktreeCurrent(staleHandle), false);
    } finally {
      await destroyAyasMicroBatchWorktree(fixture.repoRoot);
    }
  });

  await scenario("captureAyasMicroBatchWorktreeDiff reports the combined accumulated diff", async () => {
    const fixture = makeFixtureRepo();
    await destroyAyasMicroBatchWorktree(fixture.repoRoot);
    try {
      const { handle } = await ensureAyasMicroBatchWorktree(fixture.repoRoot, fixture.head);
      await applyAyasBoundedFileReplacements(handle.worktreeRoot, ["scripts/"], [
        { filePath: "scripts/item1.ts", expectedHash: null, content: "export const item1 = true;\n", allowCreate: true },
        { filePath: "scripts/item2.ts", expectedHash: null, content: "export const item2 = true;\n", allowCreate: true },
      ], async () => undefined);
      const diff = await captureAyasMicroBatchWorktreeDiff(handle);
      assert.ok(diff.includes("item1.ts"));
      assert.ok(diff.includes("item2.ts"));
    } finally {
      await destroyAyasMicroBatchWorktree(fixture.repoRoot);
    }
  });

  await scenario("destroyAyasMicroBatchWorktree is idempotent and safe to call when nothing exists", async () => {
    const fixture = makeFixtureRepo();
    await destroyAyasMicroBatchWorktree(fixture.repoRoot);
    await destroyAyasMicroBatchWorktree(fixture.repoRoot); // must not throw
    const worktrees = git(fixture.repoRoot, ["worktree", "list"]);
    assert.equal(worktrees.split("\n").filter(Boolean).length, 1, "only the fixture's own main worktree remains");
  });

  await scenario("the real Atölye repo's own worktree list is unaffected by these fixture-repo operations", async () => {
    const before = git(process.cwd(), ["worktree", "list"]).split("\n").filter(Boolean).length;
    const fixture = makeFixtureRepo();
    await destroyAyasMicroBatchWorktree(fixture.repoRoot);
    await ensureAyasMicroBatchWorktree(fixture.repoRoot, fixture.head);
    await destroyAyasMicroBatchWorktree(fixture.repoRoot);
    const after = git(process.cwd(), ["worktree", "list"]).split("\n").filter(Boolean).length;
    assert.equal(after, before);
  });

  console.log(`AYAS micro batch worktree smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-micro-batch-worktree", scenarios: count }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
