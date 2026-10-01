/** Offline model-boundary check over the real frozen cases: no model, container, network or admission. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { buildAyasLocalCodingModelRequest } from "../src/lib/brain/autonomy/AyasLocalCodingModelAdapter";
import { createAyasLocalCodingWorkspace, destroyAyasLocalCodingWorkspace } from "../src/lib/brain/autonomy/AyasLocalCodingWorkspace";
import { AYAS_LOCAL_CODING_QUALIFICATION_VAULT, projectAyasLocalCodingQualificationTask } from "./fixtures/ayas-local-coding-qualification-vault";
import { AYAS_LOCAL_CODING_RETRIEVAL_CASE, projectAyasLocalCodingRetrievalTask } from "./fixtures/ayas-local-coding-qualification-retrieval-case";

const git = (object: string): string => execFileSync("git", ["show", object], { encoding: "utf8", windowsHide: true, maxBuffer: 4_000_000 });
function tree(root: string, dir = root): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? tree(root, path.join(dir, entry.name)) : [path.relative(root, path.join(dir, entry.name)).split(path.sep).join("/")]);
}
let count = 0;
function test(name: string, run: () => void): void { run(); count++; console.log(`PASS ${count}: ${name}`); }

for (const item of [...AYAS_LOCAL_CODING_QUALIFICATION_VAULT, AYAS_LOCAL_CODING_RETRIEVAL_CASE]) {
  const task = item.domain === "MEMORY_RETRIEVAL" ? projectAyasLocalCodingRetrievalTask() : projectAyasLocalCodingQualificationTask(item);
  const workspace = createAyasLocalCodingWorkspace({ repoRoot: process.cwd(), task });
  try {
    const sources = task.exactFiles.map(file => ({ path: file, content: fs.readFileSync(path.join(workspace.root, file), "utf8") }));
    test(`${item.domain} workspace holds only the exact baseline sources`, () => {
      assert.deepEqual(tree(workspace.root).sort(), [...task.exactFiles].sort());
      assert.equal(fs.existsSync(path.join(workspace.root, ".git")), false);
      for (const source of sources) {
        assert.equal(source.content, git(`${item.baseHead}:${source.path}`), "baseline bytes");
        assert.notEqual(source.content, git(`${item.fixHead}:${source.path}`), "the historical fix must not be the workspace");
      }
    });
    test(`${item.domain} request carries no hidden case, evaluator, history or golden-fix content`, () => {
      const request = buildAyasLocalCodingModelRequest(task, sources);
      assert.deepEqual(Object.keys(request).sort(), ["max_tokens", "messages", "model", "response_format", "seed", "stream", "temperature"]);
      const exposed = JSON.stringify(request);
      for (const hidden of [item.fixHead, item.fixHead.slice(0, 7), item.baseHead, item.evaluatorBlob, item.evaluatorScript, item.caseId, item.split, "HELD_OUT", "qualification-vault"])
        assert.ok(!exposed.includes(hidden), `hidden host metadata exposed: ${hidden}`);
      // Golden diff: every substantial line the historical fix adds must be absent from what the model sees.
      const visible = sources.map(source => source.content).join("\n");
      for (const source of sources) {
        const baseline = new Set(source.content.split(/\r?\n/).map(line => line.trim()));
        const added = git(`${item.fixHead}:${source.path}`).split(/\r?\n/).map(line => line.trim()).filter(line => line.length >= 24 && !baseline.has(line));
        assert.ok(added.length > 0, "the historical fix adds substantial lines");
        for (const line of added) assert.ok(!visible.includes(line) && !exposed.includes(JSON.stringify(line).slice(1, -1)), "golden fix line exposed");
      }
    });
  } finally { destroyAyasLocalCodingWorkspace(workspace); }
}
console.log(`Local coding model boundary: PASS (${count} scenarios); real frozen cases, model runs 0.`);
