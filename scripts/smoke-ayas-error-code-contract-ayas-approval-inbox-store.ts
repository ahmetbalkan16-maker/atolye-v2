import assert from "node:assert/strict";
import { AyasApprovalInboxStoreError } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";

/**
 * AyasApprovalInboxStoreError's own declared `code` union (src/lib/brain/autonomy/AyasApprovalInboxStore.ts) had zero direct
 * construction coverage in any scripts/smoke-*.ts file — no test ever
 * asserted that constructing this error with a given code actually
 * carries that exact code, name, and Error/subclass identity. A typo in
 * `this.code = code` or `this.name = "..."` (or a dropped code from the
 * union) would pass every existing test silently.
 */
const CODES = ["AYAS_INBOX_CORRUPT", "AYAS_INBOX_SCHEMA_MISMATCH", "AYAS_INBOX_IO", "AYAS_INBOX_SECRET_LEAK", "AYAS_INBOX_INVALID", "AYAS_INBOX_UNSAFE_APPROVAL"] as const;

for (const code of CODES) {
  const error = new AyasApprovalInboxStoreError(code, `test message for ${code}`);
  assert.equal(error.code, code, `constructing with code "${code}" must carry that exact code`);
  assert.equal(error.name, "AyasApprovalInboxStoreError", "error.name must equal the class name");
  assert.ok(error instanceof Error, "must be a real Error instance");
  assert.ok(error instanceof AyasApprovalInboxStoreError, "must be an instance of its own class");
}

console.log(JSON.stringify({ status: "PASS", suite: "ayas-error-code-contract-ayas-approval-inbox-store", scenarios: CODES.length * 4 }));
