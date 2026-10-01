import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createAyasLocalCodingWorkspace, destroyAyasLocalCodingWorkspace, AyasLocalCodingWorkspaceError } from "../src/lib/brain/autonomy/AyasLocalCodingWorkspace";
import { planAyasLocalCodingContainer } from "../src/lib/brain/autonomy/AyasLocalCodingContainerPlan";
import { parseAyasLocalCodingTaskContract } from "../src/lib/brain/autonomy/AyasLocalCodingTaskContract";
import { AYAS_LOCAL_CODING_QUALIFICATION_VAULT, projectAyasLocalCodingQualificationTask } from "./fixtures/ayas-local-coding-qualification-vault";

const repoRoot = path.resolve(__dirname, "..");
const git = (object: string): Buffer => execFileSync("git", ["show", object], { cwd: repoRoot, windowsHide: true });
const files = (root: string): string[] => fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
  .sort();

let cases = 0;
for (const item of AYAS_LOCAL_CODING_QUALIFICATION_VAULT) {
  const task = projectAyasLocalCodingQualificationTask(item);
  const workspace = createAyasLocalCodingWorkspace({ repoRoot, task });
  try {
    assert.deepEqual(files(workspace.root), [...task.exactFiles].sort(), "only exact source files may be exposed");
    assert.ok(!fs.existsSync(path.join(workspace.root, ".git")));
    assert.ok(!fs.existsSync(path.join(workspace.root, item.evaluatorScript)));
    assert.ok(!fs.existsSync(path.join(workspace.root, "scripts", "fixtures")));
    for (const file of task.exactFiles) {
      const projected = fs.readFileSync(path.join(workspace.root, file));
      assert.deepEqual(projected, git(`${item.baseHead}:${file}`), "workspace must hold exact baseline bytes");
      assert.notDeepEqual(projected, git(`${item.fixHead}:${file}`), "historical fix must not leak into workspace");
      const text = projected.toString("utf8");
      for (const hidden of [item.fixHead, item.evaluatorBlob, item.evaluatorScript, item.caseId]) {
        assert.ok(!text.includes(hidden), "workspace source must not embed hidden qualification identity");
      }
    }
    assert.ok(!JSON.stringify(files(workspace.root)).includes(item.fixHead));
    assert.equal(planAyasLocalCodingContainer({ engine: "docker", adapter: {
      adapterId: "local-probe", image: `local/ayas-probe@sha256:${"a".repeat(64)}`,
    }, task, workspaceRoot: workspace.root }).workspaceRoot, workspace.root);
    cases += 1;
  } finally { destroyAyasLocalCodingWorkspace(workspace); }
  assert.ok(!fs.existsSync(workspace.root), "owned TEMP workspace must be removed");
}

for (const forbidden of ["scripts/smoke-ayas-memory-temporal.ts", "scripts/fixtures/ayas-local-coding-qualification-vault.ts",
  "scripts/ayas-local-coding-qualification-vault.ts"]) {
  const task = parseAyasLocalCodingTaskContract({ ...projectAyasLocalCodingQualificationTask(AYAS_LOCAL_CODING_QUALIFICATION_VAULT[0]!),
    exactFiles: [forbidden] });
  assert.throws(() => createAyasLocalCodingWorkspace({ repoRoot, task }), AyasLocalCodingWorkspaceError);
  cases += 1;
}
const missing = parseAyasLocalCodingTaskContract({ ...projectAyasLocalCodingQualificationTask(AYAS_LOCAL_CODING_QUALIFICATION_VAULT[0]!),
  baseHead: "f".repeat(40) });
assert.throws(() => createAyasLocalCodingWorkspace({ repoRoot, task: missing }), AyasLocalCodingWorkspaceError);
cases += 1;
assert.throws(() => destroyAyasLocalCodingWorkspace({ root: repoRoot }), AyasLocalCodingWorkspaceError);
cases += 1;
console.log(JSON.stringify({ status: "PASS", suite: "ayas-local-coding-workspace", cases, modelRuns: 0, engineRuns: 0 }));
