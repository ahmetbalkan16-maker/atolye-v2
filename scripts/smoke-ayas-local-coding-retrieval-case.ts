/** Complete frozen two-file host oracle. No evaluator change, model run or sandbox qualification. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { AYAS_LOCAL_CODING_RETRIEVAL_CASE as item, projectAyasLocalCodingRetrievalTask } from "./fixtures/ayas-local-coding-qualification-retrieval-case";
import { createAyasResearchExperimentSandbox, destroyAyasResearchExperimentSandbox, buildAyasExperimentChildEnv } from "../src/lib/brain/autonomy/AyasResearchExperimentSandbox";
import { createAyasLocalCodingWorkspace, destroyAyasLocalCodingWorkspace } from "../src/lib/brain/autonomy/AyasLocalCodingWorkspace";
import { buildAyasLocalCodingModelRequest } from "../src/lib/brain/autonomy/AyasLocalCodingModelAdapter";

const repoRoot = path.resolve(__dirname, "..");
const git = (args: readonly string[]): Buffer => execFileSync("git", [...args], { cwd: repoRoot, windowsHide: true, maxBuffer: 4000000 });
const hash = (bytes: Buffer): string => crypto.createHash("sha256").update(bytes).digest("hex");
async function main(): Promise<void> {
  assert.equal(git(["rev-parse", `${item.fixHead}^`]).toString().trim(), item.baseHead);
  assert.equal(git(["rev-parse", `${item.fixHead}:${item.evaluatorScript}`]).toString().trim(), item.evaluatorBlob);
  const lines = git(["diff", "--numstat", item.baseHead, item.fixHead, "--", ...item.exactFiles]).toString().trim().split("\n")
    .reduce((sum, row) => { const [added, removed] = row.split("\t"); assert.match(added!, /^\d+$/); assert.match(removed!, /^\d+$/); return sum + Number(added) + Number(removed); }, 0);
  assert.equal(lines, 49); assert.ok(lines <= item.maxChangedLines);
  const task = projectAyasLocalCodingRetrievalTask();
  const baselines = item.exactFiles.map((file) => git(["show", `${item.baseHead}:${file}`]));
  const fixes = item.exactFiles.map((file) => git(["show", `${item.fixHead}:${file}`]));
  const evaluator = git(["show", item.evaluatorBlob]);
  const workspace = createAyasLocalCodingWorkspace({ repoRoot, task });
  try {
    const sources = item.exactFiles.map((file, index) => {
      const bytes = fs.readFileSync(path.join(workspace.root, file)); assert.deepEqual(bytes, baselines[index]);
      assert.notDeepEqual(bytes, fixes[index]); return { path: file, content: bytes.toString("utf8") };
    });
    const exposed = JSON.stringify(buildAyasLocalCodingModelRequest(task, sources));
    for (const hidden of [item.fixHead, item.evaluatorBlob, item.evaluatorScript, item.caseId, item.split]) assert.ok(!exposed.includes(hidden));
    assert.ok(!fs.existsSync(path.join(workspace.root, ".git")) && !fs.existsSync(path.join(workspace.root, item.evaluatorScript)));
  } finally { destroyAyasLocalCodingWorkspace(workspace); }
  const sandbox = await createAyasResearchExperimentSandbox({ repoRoot, baseHead: item.baseHead,
    nodeModulesDir: path.join(repoRoot, "node_modules"), timeoutMs: 120000 });
  const results: { mode: string; exit: number | null; elapsedMs: number }[] = [];
  try {
    const evaluatorPath = path.join(sandbox.repoDir, item.evaluatorScript);
    fs.writeFileSync(evaluatorPath, evaluator);
    for (const mode of ["BASELINE", "RETRIEVAL_ONLY", "IDENTITY_ONLY", "EXACT_TWO_FILE_FIX", "WRONG_NO_OP"]) {
      item.exactFiles.forEach((file, index) => {
        const fixed = mode === "EXACT_TWO_FILE_FIX" || (mode === "RETRIEVAL_ONLY" && index === 0) || (mode === "IDENTITY_ONLY" && index === 1);
        const bytes = fixed ? fixes[index]! : baselines[index]!;
        fs.writeFileSync(path.join(sandbox.repoDir, file), mode === "WRONG_NO_OP" ? Buffer.concat([bytes, Buffer.from("\n// Host-only unrelated no-op.\n")]) : bytes);
      });
      assert.equal(hash(fs.readFileSync(evaluatorPath)), hash(evaluator), "full frozen evaluator must remain byte-identical");
      const started = performance.now();
      const run = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(sandbox.repoDir, "node_modules/tsx/dist/loader.mjs")).href, item.evaluatorScript], {
        cwd: sandbox.repoDir, env: buildAyasExperimentChildEnv(sandbox.runRoot), windowsHide: true,
        encoding: "utf8", timeout: 60000, maxBuffer: 1000000,
      });
      assert.ok(!run.error && run.signal === null, `evaluator timeout/crash refused: ${String(run.error)}`);
      if (mode === "EXACT_TWO_FILE_FIX") {
        assert.equal(run.status, 0, run.stderr); assert.ok(run.stdout.includes('"scenarios":29'));
      } else {
        assert.equal(run.status, 1, run.stderr); assert.match(run.stderr, /AssertionError \[ERR_ASSERTION\]/);
        assert.match(run.stderr, mode === "IDENTITY_ONLY" ? /smoke-ayas-memory\.ts:317:12/ : /smoke-ayas-memory\.ts:92:12/);
        if (mode === "IDENTITY_ONLY") {
          assert.match(run.stderr, /actual: 0,/); assert.match(run.stderr, /expected: 1,/);
        }
      }
      results.push({ mode, exit: run.status, elapsedMs: Math.round(performance.now() - started) });
    }
  } finally { await destroyAyasResearchExperimentSandbox(sandbox); }
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-local-coding-retrieval-case", changedLines: lines,
    evaluatorScenarios: 29, evaluatorSha256: hash(evaluator), results, modelRuns: 0, hardSandboxRuns: 0,
    evidence: "HOST_ORACLE_ONLY; original five cases and frozen evaluator unchanged" }));
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
