/** Stage 15P offline read-only query: file.json USE [ISO-time]. No model, fetch, store write or action. */
import fs from "node:fs";
import { assessAyasSourceEvidence, AYAS_SOURCE_USES, type AyasSourceUse } from "../src/lib/ayas/trust/AyasSourceEvidence";
import { assessAyasFindingSourceTrust } from "../src/lib/ayas/trust/AyasSourceEvidenceIntegration";

function main() {
  const [file, use, suppliedTime, ...rest] = process.argv.slice(2);
  if (!file || !use || !(AYAS_SOURCE_USES as readonly string[]).includes(use) || rest.length) throw new Error("ARGUMENT_INVALID");
  const limit = 2_000_000; const fd = fs.openSync(file, "r"); const buffer = Buffer.alloc(limit + 1); let received = 0;
  try {
    const info = fs.fstatSync(fd); if (!info.isFile() || info.size > limit) throw new Error("SOURCE_INPUT_TOO_LARGE_OR_NOT_FILE");
    while (received < buffer.length) { const count = fs.readSync(fd, buffer, received, buffer.length - received, null); if (!count) break; received += count; }
    if (received > limit) throw new Error("SOURCE_INPUT_TOO_LARGE");
  } finally { fs.closeSync(fd); }
  const value: unknown = JSON.parse(buffer.subarray(0, received).toString("utf8")); const now = suppliedTime ?? new Date().toISOString();
  const finding = value && typeof value === "object" && "findingId" in value ? value : null;
  const report = finding ? assessAyasFindingSourceTrust(finding as unknown as Parameters<typeof assessAyasFindingSourceTrust>[0], use as AyasSourceUse, now)
    : assessAyasSourceEvidence(value, use as AyasSourceUse, now);
  console.log(JSON.stringify(report, null, 2));
  if (report.state === "BLOCKED") process.exitCode = 2;
}
try { main(); } catch { console.error("AYAS_SOURCE_EVIDENCE_QUERY_REFUSED"); process.exitCode = 2; }
