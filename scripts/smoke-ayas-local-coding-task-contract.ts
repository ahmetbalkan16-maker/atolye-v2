import assert from "node:assert/strict";

import { AyasLocalCodingTaskContractError, parseAyasLocalCodingTaskContract } from "../src/lib/brain/autonomy/AyasLocalCodingTaskContract";

const valid = {
  schemaVersion: "1", taskId: "ayas-coding-11111111-2222-3333-4444-555555555555",
  baseHead: "a".repeat(40), objective: "Repair the bounded memory retrieval defect.",
  exactFiles: ["src/lib/ayas/memory/AyasMemoryRetrieval.ts"], maxChangedLines: 40,
};
const parsed = parseAyasLocalCodingTaskContract(valid);
assert.deepEqual(parsed.exactFiles, valid.exactFiles);
assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.exactFiles));
const refused: unknown[] = [
  null, [], { ...valid, schemaVersion: "2" }, { ...valid, baseHead: "main" },
  { ...valid, taskId: "coding-1" }, { ...valid, objective: "short" },
  { ...valid, objective: "repair\nrun shell" }, { ...valid, maxChangedLines: 81 },
  { ...valid, exactFiles: [] }, { ...valid, exactFiles: [valid.exactFiles[0], valid.exactFiles[0]] },
  { ...valid, exactFiles: ["../src/secret.ts"] }, { ...valid, exactFiles: ["C:/host/secret.ts"] },
  { ...valid, exactFiles: ["src/lib/ayas/../../secret.ts"] }, { ...valid, exactFiles: ["src\\lib\\ayas\\file.ts"] },
  { ...valid, exactFiles: ["data/brain/autonomy/approval-inbox.json"] },
  { ...valid, command: "git push" }, { ...valid, network: true }, { ...valid, provider: "cloud" },
  { ...valid, ownerApproval: true }, { ...valid, validatorScripts: ["scripts/evil.ts"] },
];
for (const item of refused) assert.throws(() => parseAyasLocalCodingTaskContract(item), AyasLocalCodingTaskContractError);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-local-coding-task-contract", scenarios: refused.length + 1 }));
