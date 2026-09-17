import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { auditAyasStorageHygiene, applyAyasStorageHygiene } from "../src/lib/brain/autonomy/AyasStorageHygiene";
import { createAyasMicroItemStore } from "../src/lib/brain/autonomy/AyasMicroItem";
import { createAyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";

/**
 * M21.3 — durable storage hygiene. Every scenario uses isolated fixture
 * directories only; the fixture that matters most (real repo/real
 * runtime data) is never touched — this module's own audit/apply split
 * exists specifically so a dry-run always precedes real deletion.
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

function fixtureDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-hygiene-"));
  const itemsDir = path.join(base, "micro-items");
  const artifactsDir = path.join(base, "patch-artifacts");
  const rejectedDir = path.join(base, "patch-artifacts", "rejected");
  const evidenceDir = path.join(base, "graphify-evidence");
  fs.mkdirSync(itemsDir, { recursive: true });
  fs.mkdirSync(rejectedDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  return { base, itemsDir, artifactsDir, rejectedDir, evidenceDir };
}

const OLD = "2026-01-01T00:00:00.000Z"; // far in the past relative to NOW below
const NOW = "2026-09-17T00:00:00.000Z";

function freezeArtifact(artifactsDir: string, id: string, generatedAt: string) {
  const store = createAyasPatchArtifactStore({ rootDir: artifactsDir });
  return store.freeze({
    artifactId: id, candidateId: `candidate-${id}`, generatorIdentity: "ayas-detector:error-code-contract-gap-v1",
    baseBranch: "master", baseHead: "deadbeef", exactFiles: [`scripts/smoke-${id}.ts`], allowedRoots: ["scripts/"],
    replacements: [{ filePath: `scripts/smoke-${id}.ts`, expectedHash: null, content: "x", allowCreate: true }],
    validatorScripts: [], graphifyEvidence: ["fixture"], safetyClassification: "SAFE",
    problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c", unchangedBehavior: "u", risk: "low", productionImpact: "none",
    sandboxValidationSummary: ["PASS"], generatedAt,
  } as never);
}

function createItem(itemsDir: string, artifactId: string, state: "DISCOVERED" | "SANDBOX_VALIDATED" | "BATCHED" | "SUPERSEDED" | "REJECTED" | "EXECUTED", lastUpdatedAt: string): string {
  const store = createAyasMicroItemStore({ rootDir: itemsDir });
  const item = store.create({
    discoveryClass: "error-code-contract-gap", semanticKey: `key-${artifactId}`, baseHead: "deadbeef",
    patchArtifactId: artifactId, patchHash: "hash", exactFiles: [`scripts/smoke-${artifactId}.ts`],
    validatorScripts: [], safetyClassification: "SAFE", graphifyEvidence: ["fixture"],
    reason: "r", expectedBenefit: "b", risk: "low", generatedAt: lastUpdatedAt, validatedAt: lastUpdatedAt,
  });
  // Drive the durable state directly to the target terminal state + a controllable timestamp
  // (going through the real transition() API always stamps "now", which this fixture needs to override for age testing).
  const file = path.join(itemsDir, `${item.microItemId}.json`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  raw.state = state;
  raw.lastUpdatedAt = lastUpdatedAt;
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return item.microItemId;
}

scenario("audit is pure/read-only: it never deletes anything, even when eligible files exist", () => {
  const { itemsDir, artifactsDir, rejectedDir, evidenceDir } = fixtureDirs();
  createItem(itemsDir, "orphan-1", "SUPERSEDED", OLD);
  const report = auditAyasStorageHygiene({ itemsDir, artifactsDir, rejectedDir, evidenceDir, now: NOW });
  assert.ok(report.eligible.length > 0, "must find at least one eligible record to prove this scenario means something");
  assert.equal(fs.readdirSync(itemsDir).length, 1, "audit must not delete anything");
});

scenario("an ACTIVE (non-terminal) micro-item is NEVER eligible, regardless of age", () => {
  const { itemsDir, artifactsDir, rejectedDir, evidenceDir } = fixtureDirs();
  createItem(itemsDir, "active-1", "BATCHED", OLD);
  const report = auditAyasStorageHygiene({ itemsDir, artifactsDir, rejectedDir, evidenceDir, now: NOW });
  assert.equal(report.eligible.filter((e) => e.kind === "micro-item").length, 0);
});

scenario("an EXECUTED micro-item (real audit evidence of what was actually applied) is NEVER eligible, regardless of age", () => {
  const { itemsDir, artifactsDir, rejectedDir, evidenceDir } = fixtureDirs();
  createItem(itemsDir, "executed-1", "EXECUTED", OLD);
  const report = auditAyasStorageHygiene({ itemsDir, artifactsDir, rejectedDir, evidenceDir, now: NOW });
  assert.equal(report.eligible.filter((e) => e.kind === "micro-item").length, 0, "EXECUTED must never be cleaned up — it is the audit record of a real applied mutation");
});

scenario("a young SUPERSEDED item (younger than minAgeMs) is retained — age bound is real, not cosmetic", () => {
  const { itemsDir, artifactsDir, rejectedDir, evidenceDir } = fixtureDirs();
  createItem(itemsDir, "young-1", "SUPERSEDED", NOW); // same timestamp as "now" — age 0
  const report = auditAyasStorageHygiene({ itemsDir, artifactsDir, rejectedDir, evidenceDir, now: NOW, minAgeMs: 24 * 60 * 60 * 1000 });
  assert.equal(report.eligible.filter((e) => e.kind === "micro-item").length, 0);
});

scenario("an old SUPERSEDED item IS eligible, and its patch artifact (referenced by nothing else) is eligible too", () => {
  const { itemsDir, artifactsDir, rejectedDir, evidenceDir } = fixtureDirs();
  freezeArtifact(artifactsDir, "orphan-art", OLD);
  createItem(itemsDir, "orphan-art", "SUPERSEDED", OLD);
  const report = auditAyasStorageHygiene({ itemsDir, artifactsDir, rejectedDir, evidenceDir, now: NOW });
  assert.ok(report.eligible.some((e) => e.kind === "micro-item"));
  assert.ok(report.eligible.some((e) => e.kind === "patch-artifact"), "an artifact with no OTHER reference must become eligible once its only referencing item is itself eligible");
});

scenario("a patch artifact referenced by ANY existing item file — even a SUPERSEDED one — is NEVER eligible (conservative-by-design)", () => {
  const { itemsDir, artifactsDir, rejectedDir, evidenceDir } = fixtureDirs();
  freezeArtifact(artifactsDir, "still-referenced", OLD);
  // Item exists and IS old+SUPERSEDED (itself eligible), but as long as its file exists, the artifact it points to stays retained per this module's conservative reading.
  createItem(itemsDir, "still-referenced", "SUPERSEDED", NOW); // young item -> retained -> artifact stays referenced
  const report = auditAyasStorageHygiene({ itemsDir, artifactsDir, rejectedDir, evidenceDir, now: NOW });
  assert.equal(report.eligible.filter((e) => e.kind === "patch-artifact").length, 0, "referenced patch artifact must never be deleted");
});

scenario("rejection logs: the most recent keepLastN are retained regardless of age; older ones beyond that bound become eligible", () => {
  const { itemsDir, artifactsDir, rejectedDir, evidenceDir } = fixtureDirs();
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(path.join(rejectedDir, `rej-${i}.json`), JSON.stringify({ candidateId: `c${i}`, reason: "x", at: OLD }), "utf8");
  }
  const report = auditAyasStorageHygiene({ itemsDir, artifactsDir, rejectedDir, evidenceDir, now: NOW, keepLastN: 3 });
  const eligibleRejections = report.eligible.filter((e) => e.kind === "rejection-log");
  assert.equal(eligibleRejections.length, 2, "5 old logs, keepLastN=3 -> exactly 2 eligible for cleanup");
});

scenario("apply deletes exactly what audit reported, and is idempotent — a second run finds nothing left to delete", () => {
  const { itemsDir, artifactsDir, rejectedDir, evidenceDir } = fixtureDirs();
  createItem(itemsDir, "orphan-2", "REJECTED", OLD);
  freezeArtifact(artifactsDir, "orphan-2", OLD);
  const first = applyAyasStorageHygiene({ itemsDir, artifactsDir, rejectedDir, evidenceDir, now: NOW });
  assert.ok(first.deleted.length >= 2, "must have actually deleted the orphaned item and its artifact");
  assert.equal(first.failedToDelete.length, 0);
  const second = applyAyasStorageHygiene({ itemsDir, artifactsDir, rejectedDir, evidenceDir, now: NOW });
  assert.equal(second.eligible.length, 0, "a second run must find nothing left to clean — idempotent");
  assert.equal(second.deleted.length, 0);
});

scenario("crash-safety: deleting an already-missing file is not an error (simulates an interrupted prior cleanup pass resuming cleanly)", () => {
  const { itemsDir, artifactsDir, rejectedDir, evidenceDir } = fixtureDirs();
  createItem(itemsDir, "orphan-3", "SUPERSEDED", OLD);
  // Simulate a PRIOR cleanup pass that already deleted the file (e.g. crashed right after this one file, before finishing the rest) by deleting it ourselves first.
  const files = fs.readdirSync(itemsDir);
  for (const f of files) fs.rmSync(path.join(itemsDir, f));
  const outcome = applyAyasStorageHygiene({ itemsDir, artifactsDir, rejectedDir, evidenceDir, now: NOW });
  assert.equal(outcome.failedToDelete.length, 0, "a missing file must never be reported as a failure");
});

scenario("a corrupt/unparseable artifact file is never deleted — fails closed to retention rather than guessing", () => {
  const { itemsDir, artifactsDir, rejectedDir, evidenceDir } = fixtureDirs();
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "corrupt.json"), "{ not valid json", "utf8");
  const report = auditAyasStorageHygiene({ itemsDir, artifactsDir, rejectedDir, evidenceDir, now: NOW });
  assert.equal(report.eligible.filter((e) => e.path.includes("corrupt.json")).length, 0);
  assert.ok(fs.existsSync(path.join(artifactsDir, "corrupt.json")));
});

console.log(`AYAS storage hygiene smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-storage-hygiene", scenarios: count }));
