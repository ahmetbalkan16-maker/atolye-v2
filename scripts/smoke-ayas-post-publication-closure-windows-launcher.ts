import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AyasPostPublicationClosureError, closeAyasPostPublication } from "../src/lib/brain/autonomy/AyasPostPublicationClosure";

let count = 0;
function scenario(name: string, fn: () => void): void {
  fn(); count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}
function fixture(): { readonly repoRoot: string; readonly remoteRoot: string; readonly head: string } {
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-closure-windows-remote-"));
  git(remoteRoot, "init", "-q", "--bare");
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-closure-windows-repo-"));
  git(repoRoot, "init", "-q"); git(repoRoot, "config", "user.email", "fixture@example.test"); git(repoRoot, "config", "user.name", "fixture");
  fs.writeFileSync(path.join(repoRoot, "README.md"), "fixture\n");
  git(repoRoot, "add", "README.md"); git(repoRoot, "commit", "-q", "-m", "fixture");
  git(repoRoot, "remote", "add", "origin", remoteRoot); git(repoRoot, "push", "-q", "-u", "origin", "master");
  return { repoRoot, remoteRoot, head: git(repoRoot, "rev-parse", "HEAD") };
}

function closeWithRealRefresh(repoRoot: string, head: string): void {
  closeAyasPostPublication(head, {
    repoRoot,
    readGraphifyBranch: () => ({ lastAnalyzedHead: head, stale: false }),
    readIntegrity: () => ({ duplicateIds: 0, danglingEdges: 0, selfLoops: 0 }),
    runHealth: () => ({ verdict: "HEALTHY", ownerActionRecommended: false }),
  });
}

function main(): void {
  if (process.platform !== "win32") {
    console.log(JSON.stringify({ status: "PASS", suite: "ayas-post-publication-closure-windows-launcher", scenarios: 0, skipped: "Windows-only launcher contract" }));
    return;
  }

  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-fake-npx-"));
  const invocationLog = path.join(bin, "invocation.txt");
  const fakeNpx = path.join(bin, "npx.cmd");
  fs.writeFileSync(fakeNpx, "@echo off\r\n> \"%AYAS_FAKE_NPX_LOG%\" echo %*\r\nexit /b %AYAS_FAKE_NPX_EXIT%\r\n", "utf8");
  const originalPath = process.env.PATH;
  const originalLog = process.env.AYAS_FAKE_NPX_LOG;
  const originalExit = process.env.AYAS_FAKE_NPX_EXIT;
  process.env.PATH = `${bin}${path.delimiter}${originalPath ?? ""}`;
  process.env.AYAS_FAKE_NPX_LOG = invocationLog;

  try {
    scenario("the incident is reproducible: direct Node execution of the PATH-provided npx.cmd fails with EINVAL", () => {
      process.env.AYAS_FAKE_NPX_EXIT = "0";
      assert.throws(() => execFileSync("npx.cmd", ["--version"], { encoding: "utf8", windowsHide: true }),
        (error: unknown) => (error as NodeJS.ErrnoException).code === "EINVAL");
    });

    scenario("the production default refresh routes through ComSpec and preserves the exact fixed Graphify arguments", () => {
      process.env.AYAS_FAKE_NPX_EXIT = "0";
      const f = fixture();
      closeWithRealRefresh(f.repoRoot, f.head);
      assert.equal(fs.readFileSync(invocationLog, "utf8").trim(), "graphify update --scope all --no-description --no-label .");
      assert.equal(git(f.repoRoot, "status", "--porcelain"), "");
    });

    scenario("a non-zero ComSpec child remains a refresh failure and cannot report terminal closure success", () => {
      process.env.AYAS_FAKE_NPX_EXIT = "7";
      const f = fixture();
      assert.throws(() => closeWithRealRefresh(f.repoRoot, f.head),
        (error: unknown) => error instanceof AyasPostPublicationClosureError && error.code === "AYAS_POST_PUBLICATION_GRAPHIFY_REFRESH_FAILED");
      assert.equal(git(f.repoRoot, "status", "--porcelain"), "");
    });
  } finally {
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    if (originalLog === undefined) delete process.env.AYAS_FAKE_NPX_LOG; else process.env.AYAS_FAKE_NPX_LOG = originalLog;
    if (originalExit === undefined) delete process.env.AYAS_FAKE_NPX_EXIT; else process.env.AYAS_FAKE_NPX_EXIT = originalExit;
  }
  console.log(`AYAS post-publication Windows launcher smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-post-publication-closure-windows-launcher", scenarios: count }));
}

main();
