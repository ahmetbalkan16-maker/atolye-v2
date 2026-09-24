import assert from "node:assert/strict";

import { readAyasBoundedJsonBody } from "../src/lib/ayas/security/AyasBoundedRequestBody";

async function main(): Promise<void> {
  const valid = await readAyasBoundedJsonBody(new Request("http://localhost/", { method: "POST", body: '{"x":1}' }), 7);
  assert.deepEqual(valid, { ok: true, value: { x: 1 } });

  const oversized = await readAyasBoundedJsonBody(new Request("http://localhost/", { method: "POST", body: '{"x":1} ' }), 7);
  assert.deepEqual(oversized, { ok: false, reason: "payload_too_large" });

  const malformed = await readAyasBoundedJsonBody(new Request("http://localhost/", { method: "POST", body: '{"x":' }), 7);
  assert.deepEqual(malformed, { ok: false, reason: "invalid_json" });

  console.log("AYAS bounded request body smoke: PASS (3 scenarios)");
}

void main();
