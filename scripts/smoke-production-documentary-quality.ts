import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateProductionDocumentaryQuality } from "../src/lib/production/ProductionDocumentaryQuality";
import type { ProductionSnapshot } from "../src/types/productionSnapshot";

async function main() {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-quality-"));
 try {
  const snapshot = { generatedAt: "2026-09-15T00:00:00.000Z", project: { projectSlug: "fixture" }, stages: [] } as unknown as ProductionSnapshot;
  const missing = await evaluateProductionDocumentaryQuality(snapshot, { fileExists: () => false });
  assert.deepEqual(missing, { available: false, reasonCode: "FINAL_EXPORT_UNAVAILABLE" });
  const real = await evaluateProductionDocumentaryQuality(snapshot, { fileExists: () => true, runFfprobe: async () => JSON.stringify({ format: { format_name: "mp4", duration: "780", size: "10000" }, streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30/1", duration: "780" }, { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, duration: "780" }] }) });
  assert.equal(real.available, true); assert.equal(real.verdict?.observations.some((item) => item.dimension === "container-integrity" && item.status === "pass"), true);
  const service = fs.readFileSync("src/lib/production/ProductionHealthService.ts", "utf8");
  assert.match(service, /evaluateProductionDocumentaryQuality/);
  console.log(JSON.stringify({ status: "PASS", suite: "production-documentary-quality", scenarios: 4 }));
 } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
