/**
 * AYAS Memory Temporal v2 — DRY-RUN migration analyzer (read-only).
 *
 *   npx tsx scripts/ayas-memory-temporal-dry-run.ts [--root <data/brain root>]
 *
 * Copies `<root>/memory/records.json` into a fresh TEMP directory and analyzes
 * only the copy; the source is read once and verified byte-identical after.
 * Prints counts only — never a memory body, name or fact value. Nothing is
 * migrated: v1 records stay readable through lazy compatibility and new
 * writes are v2 ("write-v2-forward").
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasMemoryStore } from "../src/lib/ayas/memory/AyasMemoryStore";
import { ayasMemoryRecordFact, resolveAyasMemoryTemporal } from "../src/lib/ayas/memory/AyasMemoryTemporal";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sourceRoot = path.resolve(argValue("--root") ?? path.join(process.cwd(), "data", "brain"));
const sourceFile = path.join(sourceRoot, "memory", "records.json");
const sha256 = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

if (!fs.existsSync(sourceFile)) {
  console.log(JSON.stringify({ status: "EMPTY", reason: "no memory store at the given root" }));
  process.exit(0);
}

const sourceHashBefore = sha256(sourceFile);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-memory-dry-run-"));
try {
  fs.mkdirSync(path.join(tempRoot, "memory"));
  fs.copyFileSync(sourceFile, path.join(tempRoot, "memory", "records.json"));

  const snapshot = createAyasMemoryStore({ rootDir: tempRoot }).snapshot();
  const records = snapshot.records;
  const nowIso = new Date().toISOString();
  const { views } = resolveAyasMemoryTemporal(records, { nowIso });

  const groups = new Map<string, typeof records>();
  for (const record of records) {
    const fact = ayasMemoryRecordFact(record);
    if (!fact) continue;
    groups.set(fact.key, [...(groups.get(fact.key) ?? []), record]);
  }

  const stateCounts: Record<string, number> = {};
  for (const view of views.values()) stateCounts[view.state] = (stateCounts[view.state] ?? 0) + 1;

  const factGroups = [...groups.entries()].map(([key, group]) => {
    const ordered = [...group].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
    let versions = 0;
    let previous: string | null = null;
    for (const record of ordered) {
      const value = ayasMemoryRecordFact(record)!.value;
      if (value !== previous) versions += 1;
      previous = value;
    }
    const states = group.map((record) => views.get(record.recordId)!.state);
    return {
      key,
      records: group.length,
      distinctValues: new Set(group.map((record) => ayasMemoryRecordFact(record)!.value)).size,
      versions,
      // Restatements of the value already current — v2 writes would not have added them.
      sameValueRestatements: group.length - versions,
      current: states.filter((state) => state === "current").length,
      superseded: states.filter((state) => state === "superseded").length,
      disputed: states.filter((state) => state === "disputed").length,
      conflicting: states.filter((state) => state === "conflicting").length,
      supersessionCandidate: versions > 1,
    };
  });

  const v1 = records.filter((record) => !record.temporal);
  const ambiguous = [...views.values()].filter((view) => view.state === "disputed" || view.state === "conflicting").length;
  const report = {
    status: "DRY_RUN",
    liveMutation: false,
    revision: snapshot.revision,
    total: records.length,
    v1: v1.length,
    v2: records.length - v1.length,
    missingTemporalFields: {
      recordedAt: v1.length,
      effectiveFrom: records.filter((record) => record.temporal?.effectiveFrom === undefined).length,
      effectiveUntil: records.filter((record) => record.temporal?.effectiveUntil === undefined).length,
      assertionAndProvenance: v1.length,
    },
    states: stateCounts,
    factGroups,
    keyedRecords: [...groups.values()].reduce((sum, group) => sum + group.length, 0),
    independentRecords: records.length - [...groups.values()].reduce((sum, group) => sum + group.length, 0),
    ambiguousConflicts: ambiguous,
    ownerDecisionRequired: ambiguous,
    safelyReadableWithoutMigration: v1.filter((record) => {
      const state = views.get(record.recordId)!.state;
      return state !== "invalid" && state !== "disputed" && state !== "conflicting";
    }).length,
    liveMigrationRequired: false,
    reason: "v1 records resolve through lazy compatibility (effective time unknown, recordedAt = observedAt); new writes are v2.",
  };
  if (sha256(sourceFile) !== sourceHashBefore) throw new Error("source store changed during the dry run");
  console.log(JSON.stringify({ ...report, sourceUnchanged: true }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
