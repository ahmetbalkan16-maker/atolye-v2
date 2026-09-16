import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasPatchSandbox, applyAyasPatchReplacementsInSandbox, runAyasPatchSandboxValidators, captureAyasPatchSandboxDiff, destroyAyasPatchSandbox, AyasPatchSandboxError } from "../src/lib/brain/autonomy/AyasPatchSandbox";
import { AyasValidatorFailedError } from "../src/lib/brain/autonomy/AyasMutationValidators";

let count = 0;
async function scenario(name: string, fn: () => Promise<void> | void) { await fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true }).trim();
}

/** A real, tiny, isolated git repo — never the real Atölye repo — so every sandbox test is a genuine `git worktree` operation with zero risk to the actual working tree. */
function makeFixtureRepo(): { readonly repoRoot: string; readonly head: string } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-sandbox-fixture-repo-"));
  git(repoRoot, ["init", "-q"]);
  git(repoRoot, ["config", "user.email", "fixture@example.com"]);
  git(repoRoot, ["config", "user.name", "fixture"]);
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "scripts", "existing.ts"), "export const existing = 1;\n", "utf8");
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "-q", "-m", "initial"]);
  const head = git(repoRoot, ["rev-parse", "HEAD"]);
  return { repoRoot, head };
}

async function main(): Promise<void> {
  await scenario("createAyasPatchSandbox checks out a real, isolated git worktree at baseHead", async () => {
    const fixture = makeFixtureRepo();
    const sandbox = await createAyasPatchSandbox(fixture.repoRoot, fixture.head);
    try {
      assert.ok(fs.existsSync(sandbox.sandboxRoot));
      assert.ok(fs.existsSync(path.join(sandbox.sandboxRoot, "scripts", "existing.ts")));
      assert.equal(sandbox.baseHead, fixture.head);
      assert.notEqual(path.resolve(sandbox.sandboxRoot), path.resolve(fixture.repoRoot), "sandbox must never be the real repo root");
    } finally {
      await destroyAyasPatchSandbox(sandbox);
    }
  });

  await scenario("destroyAyasPatchSandbox removes the worktree directory and its git registration", async () => {
    const fixture = makeFixtureRepo();
    const sandbox = await createAyasPatchSandbox(fixture.repoRoot, fixture.head);
    await destroyAyasPatchSandbox(sandbox);
    assert.equal(fs.existsSync(sandbox.sandboxRoot), false);
    const worktrees = git(fixture.repoRoot, ["worktree", "list"]);
    assert.ok(!worktrees.includes(sandbox.sandboxRoot), "destroyed worktree must not remain registered");
  });

  await scenario("destroyAyasPatchSandbox is safe to call twice (idempotent cleanup)", async () => {
    const fixture = makeFixtureRepo();
    const sandbox = await createAyasPatchSandbox(fixture.repoRoot, fixture.head);
    await destroyAyasPatchSandbox(sandbox);
    await destroyAyasPatchSandbox(sandbox); // must not throw
  });

  await scenario("applyAyasPatchReplacementsInSandbox writes a new file inside the sandbox only, never the real repo", async () => {
    const fixture = makeFixtureRepo();
    const sandbox = await createAyasPatchSandbox(fixture.repoRoot, fixture.head);
    try {
      await applyAyasPatchReplacementsInSandbox(sandbox, ["scripts/"], [{ filePath: "scripts/new-file.ts", expectedHash: null, content: "export const created = true;\n", allowCreate: true }]);
      assert.ok(fs.existsSync(path.join(sandbox.sandboxRoot, "scripts", "new-file.ts")));
      assert.equal(fs.existsSync(path.join(fixture.repoRoot, "scripts", "new-file.ts")), false, "the real (fixture) repo must be untouched");
    } finally {
      await destroyAyasPatchSandbox(sandbox);
    }
  });

  await scenario("applyAyasPatchReplacementsInSandbox respects the same precondition-hash + allowlist rules as AyasBoundedFileWrite (path outside allowlist rejected)", async () => {
    const fixture = makeFixtureRepo();
    const sandbox = await createAyasPatchSandbox(fixture.repoRoot, fixture.head);
    try {
      await assert.rejects(applyAyasPatchReplacementsInSandbox(sandbox, ["scripts/"], [{ filePath: "src/outside-allowlist.ts", expectedHash: null, content: "x", allowCreate: true }]));
    } finally {
      await destroyAyasPatchSandbox(sandbox);
    }
  });

  await scenario("applyAyasPatchReplacementsInSandbox rejects path traversal even inside the sandbox", async () => {
    const fixture = makeFixtureRepo();
    const sandbox = await createAyasPatchSandbox(fixture.repoRoot, fixture.head);
    try {
      await assert.rejects(applyAyasPatchReplacementsInSandbox(sandbox, ["scripts/"], [{ filePath: "scripts/../../../etc/passwd", expectedHash: null, content: "x", allowCreate: true }]));
    } finally {
      await destroyAyasPatchSandbox(sandbox);
    }
  });

  await scenario("captureAyasPatchSandboxDiff reports the applied change relative to baseHead", async () => {
    const fixture = makeFixtureRepo();
    const sandbox = await createAyasPatchSandbox(fixture.repoRoot, fixture.head);
    try {
      await applyAyasPatchReplacementsInSandbox(sandbox, ["scripts/"], [{ filePath: "scripts/new-file.ts", expectedHash: null, content: "export const created = true;\n", allowCreate: true }]);
      const diff = await captureAyasPatchSandboxDiff(sandbox);
      assert.ok(diff.includes("new-file.ts"));
      assert.ok(diff.includes("created"));
    } finally {
      await destroyAyasPatchSandbox(sandbox);
    }
  });

  await scenario("createAyasPatchSandbox throws AyasPatchSandboxError for an unknown baseHead", async () => {
    const fixture = makeFixtureRepo();
    await assert.rejects(createAyasPatchSandbox(fixture.repoRoot, "0000000000000000000000000000000000dead"), (error: unknown) => error instanceof AyasPatchSandboxError && error.code === "AYAS_SANDBOX_CREATE_FAILED");
  });

  await scenario("runAyasPatchSandboxValidators fails closed (throws AyasValidatorFailedError, never crashes with a raw exception) when the sandbox has no local tsc", async () => {
    const fixture = makeFixtureRepo();
    const sandbox = await createAyasPatchSandbox(fixture.repoRoot, fixture.head);
    try {
      await applyAyasPatchReplacementsInSandbox(sandbox, ["scripts/"], [{ filePath: "scripts/broken.ts", expectedHash: null, content: "throw new Error('boom');\n", allowCreate: true }]);
      // No local tsc/typescript exists in this bare fixture repo (no node_modules), so the typecheck validator itself must report a graceful FAIL — surfaced as AyasValidatorFailedError, matching runAyasValidators' own documented fail-fast contract, never an unhandled/raw exception.
      await assert.rejects(runAyasPatchSandboxValidators(sandbox, ["scripts/broken.ts"]), (error: unknown) => {
        assert.ok(error instanceof AyasValidatorFailedError);
        assert.equal(error.results[0]?.validator, "typecheck-project");
        assert.equal(error.results[0]?.pass, false);
        return true;
      });
    } finally {
      await destroyAyasPatchSandbox(sandbox);
    }
  });

  await scenario("end-to-end against the REAL Atölye repo: sandbox validates a genuinely passing smoke test (tsc + the test itself)", async () => {
    const repoRoot = process.cwd();
    const head = git(repoRoot, ["rev-parse", "HEAD"]);
    const sandbox = await createAyasPatchSandbox(repoRoot, head);
    try {
      const content = [
        'import assert from "node:assert/strict";',
        "assert.equal(1 + 1, 2);",
        'console.log(JSON.stringify({ status: "PASS", suite: "sandbox-fixture-probe", scenarios: 1 }));',
        "",
      ].join("\n");
      await applyAyasPatchReplacementsInSandbox(sandbox, ["scripts/"], [{ filePath: "scripts/zzz-sandbox-fixture-probe.ts", expectedHash: null, content, allowCreate: true }]);
      const results = await runAyasPatchSandboxValidators(sandbox, ["scripts/zzz-sandbox-fixture-probe.ts"]);
      assert.equal(results.every((r) => r.pass), true, JSON.stringify(results));
      assert.equal(fs.existsSync(path.join(repoRoot, "scripts", "zzz-sandbox-fixture-probe.ts")), false, "the real repo must never see this file");
    } finally {
      await destroyAyasPatchSandbox(sandbox);
    }
  });

  await scenario("sandbox cleanup succeeds even when applyAyasPatchReplacementsInSandbox itself threw (precondition mismatch mid-apply)", async () => {
    const fixture = makeFixtureRepo();
    const sandbox = await createAyasPatchSandbox(fixture.repoRoot, fixture.head);
    try {
      await assert.rejects(applyAyasPatchReplacementsInSandbox(sandbox, ["scripts/"], [{ filePath: "scripts/existing.ts", expectedHash: "wrong-hash-does-not-match-real-content", content: "export const existing = 999;\n", allowCreate: false }]));
      // The precondition-mismatch write must never have landed, in the sandbox or the real fixture repo.
      // Normalize line endings — git's own core.autocrlf checkout behavior is environment-specific, not part of what this assertion is testing.
      assert.equal(fs.readFileSync(path.join(sandbox.sandboxRoot, "scripts", "existing.ts"), "utf8").replace(/\r\n/g, "\n"), "export const existing = 1;\n");
    } finally {
      await destroyAyasPatchSandbox(sandbox);
    }
    const worktrees = git(fixture.repoRoot, ["worktree", "list"]);
    assert.equal(worktrees.split("\n").length, 1, "a failed apply must still leave the sandbox fully torn down, no leaked worktree");
  });

  await scenario("execution-time precondition staleness: a file the artifact expects to be absent (null precondition) but that now exists out-of-band is rejected, not silently overwritten", async () => {
    const fixture = makeFixtureRepo();
    const sandbox = await createAyasPatchSandbox(fixture.repoRoot, fixture.head);
    try {
      // Simulate "out-of-band" drift: something else created this file inside the sandbox before the bounded write runs (e.g. a race, or a bug elsewhere) — the artifact's own recorded precondition (null = must not exist yet) must still be honored.
      fs.writeFileSync(path.join(sandbox.sandboxRoot, "scripts", "unexpected-already-there.ts"), "export const driftedIn = true;\n", "utf8");
      await assert.rejects(applyAyasPatchReplacementsInSandbox(sandbox, ["scripts/"], [{ filePath: "scripts/unexpected-already-there.ts", expectedHash: null, content: "export const intended = true;\n", allowCreate: true }]));
      assert.equal(fs.readFileSync(path.join(sandbox.sandboxRoot, "scripts", "unexpected-already-there.ts"), "utf8"), "export const driftedIn = true;\n", "the out-of-band file must be left exactly as found, never clobbered");
    } finally {
      await destroyAyasPatchSandbox(sandbox);
    }
  });

  console.log(`AYAS patch sandbox smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-patch-sandbox", scenarios: count }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
