import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { planAyasLocalCodingContainer, AyasLocalCodingContainerPlanError } from "../src/lib/brain/autonomy/AyasLocalCodingContainerPlan";
import { AyasLocalCodingTaskContractError, parseAyasLocalCodingTaskContract } from "../src/lib/brain/autonomy/AyasLocalCodingTaskContract";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-local-coding-"));
const file = "src/lib/example.ts";
fs.mkdirSync(path.join(root, "src", "lib"), { recursive: true });
fs.writeFileSync(path.join(root, file), "export const answer = 42;\n");
const task = parseAyasLocalCodingTaskContract({
  schemaVersion: "1", taskId: "ayas-coding-11111111-2222-3333-4444-555555555555",
  baseHead: "a".repeat(40), objective: "Repair the bounded TypeScript fixture.", exactFiles: [file], maxChangedLines: 20,
});
const image = `local/ayas-coder@sha256:${"b".repeat(64)}`;
const adapter = { adapterId: "local-coder", image };
const input = { engine: "docker" as const, adapter, task, workspaceRoot: root };
try {
  const plan = planAyasLocalCodingContainer(input);
  assert.equal(plan.executable, "docker");
  assert.equal(plan.image, image);
  for (const required of ["--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--entrypoint=/ayas-sandbox-probe"]) {
    assert.ok(plan.args.includes(required), `missing containment flag ${required}`);
  }
  assert.ok(plan.args.includes(`type=bind,src=${root},dst=/workspace,readonly`));
  assert.ok(!plan.args.some((arg) => arg.includes("--privileged") || arg.includes("host.docker.internal") || arg.includes("/data/brain")));
  const denied = [
    { ...input, engine: "cloud" as never },
    { ...input, adapter: { adapterId: "local-coder", image: "local/ayas-coder:latest" } },
    { ...input, workspaceRoot: os.tmpdir() },
  ];
  for (const candidate of denied) assert.throws(() => planAyasLocalCodingContainer(candidate), AyasLocalCodingContainerPlanError);
  assert.throws(() => planAyasLocalCodingContainer({ ...input, task: { ...task, exactFiles: ["../data/brain/secret.ts"] } }), AyasLocalCodingTaskContractError);
  fs.symlinkSync(path.join(root, "src", "lib"), path.join(root, "linked"), "junction");
  assert.throws(() => planAyasLocalCodingContainer(input), AyasLocalCodingContainerPlanError);
  fs.unlinkSync(path.join(root, "linked"));
  fs.mkdirSync(path.join(root, ".git"));
  assert.throws(() => planAyasLocalCodingContainer(input), AyasLocalCodingContainerPlanError);
  fs.rmdirSync(path.join(root, ".git"));
  fs.rmSync(path.join(root, file));
  assert.throws(() => planAyasLocalCodingContainer(input), AyasLocalCodingContainerPlanError);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-local-coding-container-plan", scenarios: 2 + denied.length + 3 }));
} finally {
  const safe = path.dirname(root).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(root).startsWith("ayas-local-coding-");
  if (safe) fs.rmSync(root, { recursive: true, force: false });
}
