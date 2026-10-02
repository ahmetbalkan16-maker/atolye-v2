/** Stage 15F operator baseline. Serial, bounded, Git/TEMP only; no live root or model. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import manifestJson from "../docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15F/EVAL_MANIFEST.json";
import { gradeAyasEvalTrial, isAyasEvalManifest, summarizeAyasEvalTrials, verifyAyasEvalPins, type AyasEvalTrial } from "../src/lib/ayas/observability/AyasEvalGovernance";

const repo = process.cwd();
const hash = (bytes: Uint8Array | string) => crypto.createHash("sha256").update(bytes).digest("hex");
const git = (args: string[], cwd = repo, env: NodeJS.ProcessEnv = process.env) => execFileSync("git", ["-c", `safe.directory=${path.resolve(cwd)}`, "-c", `core.excludesFile=${env.GIT_CONFIG_GLOBAL ?? os.devNull}`, ...args], { cwd, env, encoding: "utf8", windowsHide: true, maxBuffer: 4_000_000 }).trim();

function sourceDigest(root: string, env: NodeJS.ProcessEnv) {
  const tracked = git(["ls-files", "-z"], root, env).split("\0").filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"], root, env).split("\0").filter(Boolean);
  return hash([...new Set([...tracked, ...untracked])].sort().map((file) => `${file}\n${hash(fs.readFileSync(path.join(root, file)))}\n`).join(""));
}

function main() {
  const args = process.argv.slice(2); let trials = 1; let reportFile: string | undefined; let onlySuite: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--trials" && /^[1-3]$/.test(args[i + 1] ?? "")) trials = Number(args[++i]);
    else if (args[i] === "--report" && args[i + 1] && !args[i + 1]!.startsWith("--")) reportFile = path.resolve(args[++i]!);
    else if (args[i] === "--suite" && args[i + 1] && !args[i + 1]!.startsWith("--")) onlySuite = args[++i];
    else throw new Error("ARGUMENT_INVALID");
  }
  const candidate: unknown = manifestJson;
  assert.ok(isAyasEvalManifest(candidate), "AYAS_EVAL_MANIFEST_INVALID"); const manifest = candidate;
  assert.deepEqual(verifyAyasEvalPins(manifest, (file) => fs.readFileSync(path.join(repo, file))), [], "AYAS_EVAL_PIN_DRIFT");
  const selected = manifest.suites.filter((suite) => onlySuite === undefined || suite.id === onlySuite);
  assert.ok(selected.length, "AYAS_EVAL_SUITE_UNKNOWN");
  if (reportFile) assert.ok(reportFile.endsWith(".json") && !fs.existsSync(reportFile), "AYAS_EVAL_REPORT_MUST_BE_NEW_JSON");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-eval-baseline-")); const checkout = path.join(temp, "repo");
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "SMOKE_TRACE"]) if (process.env[key]) env[key] = process.env[key];
  const emptyConfig = path.join(temp, "empty.gitconfig"); fs.writeFileSync(emptyConfig, ""); env.GIT_CONFIG_GLOBAL = emptyConfig; env.GIT_CONFIG_SYSTEM = emptyConfig; env.GIT_CONFIG_NOSYSTEM = "1";
  const results: { id: string; kind: string; trials: AyasEvalTrial[]; summary: ReturnType<typeof summarizeAyasEvalTrials> }[] = [];
  let resourceAbort = false;
  let timedOut = false;
  const resourceSamples: { totalBytes: number; freeBytes: number }[] = [];
  try {
    const head = git(["rev-parse", "HEAD"]); const originalDigest = sourceDigest(repo, env); const originalStatus = git(["status", "--porcelain=v1", "-z"], repo, env);
    git(["clone", "--quiet", "--shared", "--no-hardlinks", "--local", repo, checkout], repo, env);
    assert.notEqual(fs.realpathSync(path.join(checkout, ".git")), fs.realpathSync(path.join(repo, ".git")));
    git(["remote", "remove", "origin"], checkout, env); // A fixture cannot publish to the source checkout.
    fs.symlinkSync(path.join(repo, "node_modules"), path.join(checkout, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const overlays = [...new Set([...git(["diff", "--name-only", "HEAD"], repo, env).split("\n"), ...git(["ls-files", "--others", "--exclude-standard"], repo, env).split("\n")])].filter(Boolean);
    for (const file of overlays) {
      assert.ok(/^(?:src|app|scripts|docs)\/.+\.(?:ts|tsx|json|md)$/.test(file) || file === "ATOLYE_CHECKPOINT.md", "AYAS_EVAL_OVERLAY_UNEXPECTED");
      const from = path.join(repo, file); const to = path.join(checkout, file); fs.mkdirSync(path.dirname(to), { recursive: true });
      if (fs.existsSync(from)) fs.copyFileSync(from, to); else fs.rmSync(to, { force: true });
    }
    // Git's checkout EOL policy must not alter pinned graders or the source under evaluation.
    for (const file of git(["ls-files", "-z"], repo, env).split("\0").filter(Boolean)) {
      const from = path.join(repo, file); const to = path.join(checkout, file);
      if (fs.existsSync(from)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
      else fs.rmSync(to, { force: true });
    }
    if (fs.existsSync(path.join(repo, ".graphify", "graph.json"))) {
      const graphDir = path.join(checkout, ".graphify"); fs.mkdirSync(graphDir);
      for (const file of ["graph.json", "branch.json", "worktree.json", "manifest.json", ".graphify_describe_pending"]) {
        const from = path.join(repo, ".graphify", file); if (fs.existsSync(from)) fs.copyFileSync(from, path.join(graphDir, file));
      }
    }
    assert.deepEqual(verifyAyasEvalPins(manifest, (file) => fs.readFileSync(path.join(checkout, file))), []);
    const snapshot = sourceDigest(checkout, env); const fixtureStatus = git(["status", "--porcelain=v1", "-z"], checkout, env);
    for (const suite of selected) {
      const observed: AyasEvalTrial[] = [];
      for (let trial = 0; trial < trials; trial++) {
        const memory = { totalBytes: os.totalmem(), freeBytes: os.freemem() }; resourceSamples.push(memory);
        if (memory.totalBytes > 0 && memory.freeBytes / memory.totalBytes <= 0.1) { resourceAbort = true; break; }
        const started = performance.now();
        // A complete suite contains multiple internally bounded operations (e.g. 180s validation).
        // The constitution negative-control suites contain many separate 30/60s-bounded TEMP trials.
        const timeoutMs = ["proposal-approval-service", "research-improvement-loop"].includes(suite.id) ? 600_000
          : ["owner-constitution-mutations", "constitution-run-binding-mutations"].includes(suite.id) ? 300_000 : 120_000;
        const run = spawnSync(process.execPath, ["--import", "tsx", suite.script, ...suite.args], { cwd: checkout, env, encoding: "utf8", windowsHide: true, timeout: timeoutMs, maxBuffer: 2_000_000 });
        timedOut = (run.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
        const result = gradeAyasEvalTrial(suite, { exitCode: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "", durationMs: performance.now() - started });
        observed.push(result);
        if (result.outcome === "FAIL") {
          fs.writeFileSync(path.join(temp, `${suite.id}-${trial}.stdout.txt`), run.stdout ?? "");
          fs.writeFileSync(path.join(temp, `${suite.id}-${trial}.stderr.txt`), run.stderr ?? "");
        }
        assert.equal(git(["rev-parse", "HEAD"], checkout, env), head, "AYAS_EVAL_FIXTURE_HEAD_MUTATED");
        assert.equal(sourceDigest(checkout, env), snapshot, "AYAS_EVAL_FIXTURE_SOURCE_MUTATED");
        assert.equal(git(["status", "--porcelain=v1", "-z"], checkout, env), fixtureStatus, "AYAS_EVAL_FIXTURE_STATUS_MUTATED");
        assert.deepEqual(verifyAyasEvalPins(manifest, (file) => fs.readFileSync(path.join(checkout, file))), []);
        if (timedOut) break; // Do not admit another workload while a timed-out suite's children may still be settling.
      }
      const summary = summarizeAyasEvalTrials(observed, trials); results.push({ id: suite.id, kind: suite.kind, trials: observed, summary });
      console.log(`${suite.id}: ${summary.status} (${observed.reduce((n, t) => n + t.durationMs, 0)}ms)`);
      if (resourceAbort || timedOut) break;
    }
    assert.equal(sourceDigest(repo, env), originalDigest, "AYAS_EVAL_SOURCE_REPO_MUTATED"); assert.equal(git(["status", "--porcelain=v1", "-z"], repo, env), originalStatus);
    const failed = results.filter((r) => r.summary.status === "FAIL");
    const report = { schemaVersion: "1", manifestVersion: manifest.version, manifestDigest: hash(JSON.stringify(manifest)), sourceHead: head, sourceWorktreeDigest: originalDigest,
      evidenceClass: "DETERMINISTIC_TEST", fixture: "TEMP_LOCAL_CLONE_NO_REMOTE_NO_MODEL_OR_CREDENTIAL_ENV", selectedSuites: results.length, declaredSuites: manifest.suites.length,
      completeDeclaredBaseline: results.length === manifest.suites.length && !resourceAbort && !timedOut, trials, failed: failed.map((r) => r.id), knownLimitationSuites: results.filter((r) => r.summary.status === "PASS_WITH_KNOWN_LIMITATIONS").map((r) => r.id),
      outcome: resourceAbort ? "RESOURCE_ABORT" : timedOut ? "INCOMPLETE_TIMEOUT" : failed.length ? "FAIL" : results.some((r) => r.summary.status === "PASS_WITH_KNOWN_LIMITATIONS") ? "PASS_WITH_KNOWN_LIMITATIONS" : "PASS", results, resourceSamples,
      ownerCalibration: "PENDING", grantsAuthority: false, excluded: manifest.excluded };
    const destination = reportFile ?? path.join(os.tmpdir(), `ayas-eval-result-${crypto.randomUUID()}.json`); fs.writeFileSync(destination, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ outcome: report.outcome, suites: results.length, failed: report.failed, report: destination }));
    if (failed.length || resourceAbort || timedOut) {
      // Keep only this isolated fixture and failure diagnostics for the developer's root-cause inspection.
      console.error(`AYAS_EVAL_FAILED_TEMP_FIXTURE:${temp}`); process.exitCode = 1; return;
    }
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-eval-baseline-"));
    if (process.exitCode !== 1) fs.rmSync(temp, { recursive: true, force: true });
  }
}
try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
