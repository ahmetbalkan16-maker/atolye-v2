import assert from "node:assert/strict";
import { AyasMicroBatchWorktreeError } from "../src/lib/brain/autonomy/AyasMicroBatchWorktree";

/**
 * AyasMicroBatchWorktreeError's own declared `code` union (src/lib/brain/autonomy/AyasMicroBatchWorktree.ts) had zero direct
 * construction coverage in any scripts/smoke-*.ts file — no test ever
 * asserted that constructing this error with a given code actually
 * carries that exact code, name, and Error/subclass identity. A typo in
 * `this.code = code` or `this.name = "..."` (or a dropped code from the
 * union) would pass every existing test silently.
 */
const CODES = ["AYAS_MICRO_BATCH_WORKTREE_CREATE_FAILED", "AYAS_MICRO_BATCH_WORKTREE_REBUILD_FAILED"] as const;

for (const code of CODES) {
  const error = new AyasMicroBatchWorktreeError(code, `test message for ${code}`);
  assert.equal(error.code, code, `constructing with code "${code}" must carry that exact code`);
  assert.equal(error.name, "AyasMicroBatchWorktreeError", "error.name must equal the class name");
  assert.ok(error instanceof Error, "must be a real Error instance");
  assert.ok(error instanceof AyasMicroBatchWorktreeError, "must be an instance of its own class");
}

console.log(JSON.stringify({ status: "PASS", suite: "ayas-error-code-contract-ayas-micro-batch-worktree", scenarios: CODES.length * 4 }));
