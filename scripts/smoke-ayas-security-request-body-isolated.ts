/** Run only in a disposable archive; route imports must not touch live state. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

import { POST as chatPost } from "../app/api/ayas/chat/stream/route";
import { POST as intakePost } from "../app/api/ayas/intake/route";

async function main(): Promise<void> {
  const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(process.cwd()));
  if (process.env.AYAS_STAGE9_ISOLATED_CHECKOUT !== "1" || !relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("AYAS_STAGE9_REQUIRES_TEMP_ARCHIVE");
  }
  const request = new NextRequest("http://localhost/api/ayas/chat/stream", {
    method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ text: "", padding: "x".repeat(33 * 1024) }),
  });
  assert.equal(request.headers.get("content-length"), null, "fixture must exercise an absent length header");
  const response = await chatPost(request);
  const intakeRequest = new NextRequest("http://localhost/api/ayas/intake", {
    method: "POST", headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ intents: null, padding: "x".repeat(257 * 1024) }),
  });
  assert.equal(intakeRequest.headers.get("content-length"), null);
  const intakeResponse = await intakePost(intakeRequest);
  const passed = Number(response.status === 413) + Number(intakeResponse.status === 413);
  console.log(`AYAS Stage 9 isolated request-body smoke: ${passed === 2 ? "PASS" : "FAIL"} (${passed}/2 scenarios; status ${response.status}/${intakeResponse.status})`);
  assert.equal(passed, 2, "oversized unadvertised requests must stop before JSON parsing");
}

void main();
