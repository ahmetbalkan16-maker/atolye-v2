/** Stage 15.7 candidate-only acceptance; intentionally fails on the old temporal source. */
import assert from "node:assert/strict";

import { AYAS_MEMORY_TEMPORAL_CASES } from "./fixtures/ayas-memory-temporal-cases";
import { buildBrainMemoryRecord } from "../src/lib/brain/BrainMemoryModel";
import { ayasMemoryRecordFact, resolveAyasMemoryTemporal } from "../src/lib/ayas/memory/AyasMemoryTemporal";
import { retrieveAyasMemory } from "../src/lib/ayas/memory/AyasMemoryRetrieval";

const entry = AYAS_MEMORY_TEMPORAL_CASES.find((item) => item.invariantContract === "render-tool-history-preserved");
assert.ok(entry);
const records = entry.records.map((item) => buildBrainMemoryRecord(item.input));
const original = JSON.stringify(records);
const [ffmpeg, remotion] = records;
assert.ok(ffmpeg && remotion);

const resolved = resolveAyasMemoryTemporal(records, { nowIso: entry.nowIso }).views;
assert.equal(ayasMemoryRecordFact(ffmpeg)?.key, "user.decision.render-tool");
assert.equal(ayasMemoryRecordFact(remotion)?.key, "user.decision.render-tool");
assert.equal(resolved.get(ffmpeg.recordId)?.state, "superseded");
assert.equal(resolved.get(ffmpeg.recordId)?.supersededBy, remotion.recordId);
assert.equal(resolved.get(remotion.recordId)?.state, "current");

const current = retrieveAyasMemory(records, entry.query.text, { nowIso: entry.nowIso });
assert.ok(current.selected.some((item) => item.record.recordId === remotion.recordId));
assert.ok(!current.selected.some((item) => item.record.recordId === ffmpeg.recordId));
const historical = retrieveAyasMemory(records, entry.query.text, { nowIso: entry.nowIso, temporal: { mode: "as-of", at: "2026-08-20T00:00:00.000Z" } });
assert.ok(historical.selected.some((item) => item.record.recordId === ffmpeg.recordId));
assert.equal(JSON.stringify(records), original, "read-side derivation must not rewrite records");
console.log("Stage 15.7 render-tool supersession acceptance PASS");
