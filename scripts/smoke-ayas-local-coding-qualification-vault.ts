import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { AYAS_LOCAL_CODING_QUALIFICATION_VAULT, projectAyasLocalCodingQualificationTask } from "./fixtures/ayas-local-coding-qualification-vault";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
assert.equal(AYAS_LOCAL_CODING_QUALIFICATION_VAULT.length, 3);
assert.deepEqual(AYAS_LOCAL_CODING_QUALIFICATION_VAULT.map((item) => item.split), ["PRIMARY", "HELD_OUT", "PRIMARY"]);
const seenIds = new Set<string>();
for (const item of AYAS_LOCAL_CODING_QUALIFICATION_VAULT) {
  assert.ok(Object.isFrozen(item) && Object.isFrozen(item.exactFiles));
  assert.ok(!seenIds.has(item.taskId));
  seenIds.add(item.taskId);
  assert.equal(git("rev-parse", `${item.fixHead}^`), item.baseHead, "fix must directly follow frozen base");
  assert.equal(git("rev-parse", `${item.fixHead}:${item.evaluatorScript}`), item.evaluatorBlob, "evaluator blob must be immutable");
  const changed = git("diff", "--numstat", item.baseHead, item.fixHead, "--", ...item.exactFiles)
    .split("\n").filter(Boolean);
  assert.equal(changed.length, item.exactFiles.length);
  const lines = changed.reduce((total, row) => {
    const [added, removed] = row.split("\t");
    assert.ok(/^\d+$/.test(added ?? "") && /^\d+$/.test(removed ?? ""));
    return total + Number(added) + Number(removed);
  }, 0);
  assert.ok(lines > 0 && lines <= item.maxChangedLines, "historical fix must fit bounded task scope");
  const task = projectAyasLocalCodingQualificationTask(item);
  assert.deepEqual(Object.keys(task).sort(), ["baseHead", "exactFiles", "maxChangedLines", "objective", "schemaVersion", "taskId"]);
  const exposed = JSON.stringify(task);
  assert.ok(!exposed.includes(item.fixHead) && !exposed.includes(item.evaluatorBlob)
    && !exposed.includes(item.evaluatorScript) && !exposed.includes(item.caseId), "model request must not leak answer/evaluator identity");
}
console.log(JSON.stringify({ status: "PASS", suite: "ayas-local-coding-qualification-vault",
  cases: AYAS_LOCAL_CODING_QUALIFICATION_VAULT.length, splits: ["PRIMARY", "HELD_OUT"], modelRuns: 0 }));
