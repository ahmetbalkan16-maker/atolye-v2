import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withAyasActionRuntimeAuthorizationStore } from "../../src/lib/ayas/execution/AyasActionRuntime";
import { AyasExecutionAuthorizationStore } from "../../src/lib/ayas/execution/AyasExecutionAuthorization";

/** Real durable grants in TEMP. Scope propagates through indirect/async read callers; production audit is untouched. */
export async function withAyasActionRuntimeFixture<T>(operation: () => T | Promise<T>): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-action-audit-"));
  try { return await withAyasActionRuntimeAuthorizationStore(new AyasExecutionAuthorizationStore({ rootDir: root }), operation); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
