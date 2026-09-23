/**
 * Regression for the 2026-09-23 legacy-ledger incident: with no runtime root in
 * the environment (tsx does not load `.env.local`),
 * smoke-script-duration-reconciliation-wiring.ts resolved the legacy default and
 * appended three mock `script` records to the repository's
 * `data/projects/unknown/ai-usage.json`. It must now run entirely inside its
 * run-owned TEMP workspace: repository `data/projects` — and any runtime or
 * authority root configured in this process — stays byte-for-byte unchanged.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const target = path.join(repoRoot, "scripts", "smoke-script-duration-reconciliation-wiring.ts");
const rootKeys = ["ATOLYE_RUNTIME_ROOT", "ATOLYE_RUNTIME_AUTHORITY_ROOT", "ATOLYE_WORKSPACE_ROOT"] as const;
// Roots the child must never touch: the legacy-default runtime (projects and
// machine) and authority roots it used to fall back to, plus whatever live
// runtime/authority roots the caller has configured (removed from the child).
const guardedRoots = [path.join(repoRoot, "data", "projects"), path.join(repoRoot, "data", "machine"),
  path.join(os.tmpdir(), "atolye-runtime-authority-v1"),
  ...[process.env.ATOLYE_RUNTIME_ROOT, process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT]
    .filter((value): value is string => Boolean(value))];

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

/** Path, type, size and mtime of every entry: any create, delete or rewrite changes it. */
function treeFingerprint(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const entries: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute, { bigint: true });
      const relative = path.relative(root, absolute);
      if (stat.isDirectory()) {
        entries.push(`D ${relative}`);
        visit(absolute);
      } else entries.push(`F ${relative} ${stat.size} ${stat.mtimeNs}`);
    }
  };
  visit(root);
  return entries.sort();
}

function insideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function run() {
  await scenario("the smoke keeps its three runScript calls behind a run-owned canonical runtime", () => {
    const source = fs.readFileSync(target, "utf8");
    assert.equal(source.match(/AIManager\.runScript\(/g)?.length, 3);
    assert.match(source, /withCanonicalSmokeRuntime\(/);
    assert.match(source, /enterOperationContext:\s*false/);
    assert.match(source, /process\.env\.ATOLYE_WORKSPACE_ROOT\s*=/);
  });

  await scenario("with every runtime root unset it runs in TEMP and leaves guarded roots untouched", () => {
    const before = guardedRoots.map(treeFingerprint);
    const environment: NodeJS.ProcessEnv = { ...process.env };
    for (const key of rootKeys) delete environment[key];
    const child = spawnSync(process.execPath, [tsxCli, target], { cwd: repoRoot, encoding: "utf8",
      windowsHide: true, timeout: 120_000, env: environment });
    assert.deepEqual(guardedRoots.map(treeFingerprint), before, "a guarded root changed");
    assert.equal(child.status, 0, `duration smoke failed:\n${child.stdout}\n${child.stderr}`);
    assert.match(child.stdout, /PASS \(3 scenarios\)/);
    const evidenceLine = child.stdout.split(/\r?\n/).find((line) => line.includes("\"isolation\""));
    assert.ok(evidenceLine, "duration smoke printed no isolation evidence");
    const isolation = (JSON.parse(evidenceLine) as { isolation: Record<string, string | number> }).isolation;
    const workspaceRoot = String(isolation.workspaceRoot);
    // Native realpath, as CanonicalSmokeRuntime uses: expands 8.3 short names.
    assert.ok(insideRoot(fs.realpathSync.native(os.tmpdir()), workspaceRoot), `workspace is not in TEMP: ${workspaceRoot}`);
    for (const key of ["runtimeRoot", "projectsRoot", "legacyProjectsRoot", "authorityRoot"]) {
      assert.ok(insideRoot(workspaceRoot, String(isolation[key])), `${key} escaped TEMP: ${isolation[key]}`);
    }
    assert.equal(isolation.unknownLedgerRecords, 3);
    assert.equal(fs.existsSync(workspaceRoot), false, "run-owned workspace was not removed");
  });

  console.log(`Script duration reconciliation isolation smoke: PASS (${count} scenarios, ${guardedRoots.length} guarded roots)`);
  console.log(JSON.stringify({ status: "PASS", suite: "script-duration-reconciliation-isolation",
    scenarios: count, guardedRoots: guardedRoots.length }));
}

run().catch((error) => {
  console.error("Script duration reconciliation isolation smoke FAILED:", error);
  process.exitCode = 1;
});
