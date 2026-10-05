import assert from "node:assert/strict";import fs from "node:fs";import crypto from "node:crypto";
import cases from "./ayas-system-audit-held.json";
assert.equal(crypto.createHash("sha256").update(fs.readFileSync("scripts/fixtures/ayas-system-audit-held.json")).digest("hex"),"f89c75c6111099f189d26622b091a885700a939fc05888eedb1402afe24474cc");
export default cases;
