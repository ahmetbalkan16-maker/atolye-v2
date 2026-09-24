/**
 * Run only from a disposable git-archive copy with node_modules linked in.
 * The junction fixture must never be created in the working checkout.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runAyasReadOnlyAction } from "../src/lib/ayas/execution/AyasActionRuntime";

async function main(): Promise<void> {
  const cwd = fs.realpathSync(process.cwd());
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const relative = path.relative(temporaryRoot, cwd);
  if (process.env.AYAS_STAGE9_ISOLATED_CHECKOUT !== "1" || !relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("AYAS_STAGE9_REQUIRES_TEMP_ARCHIVE");
  }
  const outside = fs.mkdtempSync(path.join(temporaryRoot, "ayas-stage9-outside-read-"));
  const link = path.join(cwd, "src", "ayas-stage9-junction");
  try {
    fs.writeFileSync(path.join(outside, "dummy.ts"), "stage9-outside-fixture\n");
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    const result = await runAyasReadOnlyAction({ rawRequest: {
      schemaVersion: "1", action: "inspect-source-file", requestedBy: "stage9-fixture", intent: "read",
      plan: { filePath: "src/ayas-stage9-junction/dummy.ts" },
    } });
    assert.equal(result.executed, false, "a linked source path must not be returned as repository content");
    console.log("AYAS Stage 9 isolated source-read smoke: PASS (1 scenario)");
  } finally {
    if (fs.existsSync(link)) fs.rmdirSync(link);
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

void main();
