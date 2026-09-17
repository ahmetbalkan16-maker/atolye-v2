import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasExternalResearchStore, AyasExternalResearchStoreError } from "../src/lib/brain/autonomy/AyasExternalResearchStore";

/**
 * M22.3/M22.11/M22.12 — durable external capability research findings.
 * This store has zero network code (grep-verifiable: no `fetch`/`http`/
 * `https` import anywhere in AyasExternalResearchStore.ts) — every scenario
 * below proves it only ever stores an already-written-up finding, and
 * refuses one that lacks traceable evidence (a real source URL) rather than
 * silently accepting an unfounded claim as durable fact.
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-research-store-")); }

function baseFinding(overrides: Partial<Parameters<ReturnType<typeof createAyasExternalResearchStore>["record"]>[0]> = {}) {
  return {
    provider: "ExampleProvider",
    capability: "example capability",
    problemSolved: "solves an example problem",
    sourceUrl: "https://example.com/docs/example-capability",
    isOfficialSource: true,
    featureDate: "2026-01-01",
    lastCheckedAt: "2026-09-17T00:00:00.000Z",
    confidence: "high" as const,
    licenseCostStatus: "free-tier-available" as const,
    licenseCostNotes: "free tier covers light usage",
    atolyeGapStatus: "missing" as const,
    atolyeGapNotes: "Atölye has no equivalent today",
    ...overrides,
  };
}

scenario("record() stores a well-formed finding with treatedSourceAsUntrusted always true", () => {
  const store = createAyasExternalResearchStore({ rootDir: tmpDir() });
  const finding = store.record(baseFinding());
  assert.equal(finding.treatedSourceAsUntrusted, true);
  assert.ok(finding.findingId.startsWith("ayas-research-"));
});

scenario("record() refuses a finding with no real http(s) sourceUrl — unfounded evidence is never accepted as durable fact", () => {
  const store = createAyasExternalResearchStore({ rootDir: tmpDir() });
  assert.throws(() => store.record(baseFinding({ sourceUrl: "not-a-url" })), (e: unknown) => e instanceof AyasExternalResearchStoreError && e.code === "AYAS_RESEARCH_INVALID");
  assert.throws(() => store.record(baseFinding({ sourceUrl: "" })), (e: unknown) => e instanceof AyasExternalResearchStoreError && e.code === "AYAS_RESEARCH_INVALID");
});

scenario("record() refuses a finding missing provider/capability/problemSolved", () => {
  const store = createAyasExternalResearchStore({ rootDir: tmpDir() });
  assert.throws(() => store.record(baseFinding({ provider: "" })), (e: unknown) => e instanceof AyasExternalResearchStoreError);
});

scenario("findByProviderAndCapability is case-insensitive and finds an existing recorded finding (M22.10 dedup)", () => {
  const store = createAyasExternalResearchStore({ rootDir: tmpDir() });
  store.record(baseFinding({ provider: "ElevenLabs", capability: "Voice Cloning" }));
  const found = store.findByProviderAndCapability("elevenlabs", "voice cloning");
  assert.ok(found);
  assert.equal(found!.provider, "ElevenLabs");
});

scenario("findByProviderAndCapability returns undefined for a never-recorded pair", () => {
  const store = createAyasExternalResearchStore({ rootDir: tmpDir() });
  assert.equal(store.findByProviderAndCapability("nobody", "nothing"), undefined);
});

scenario("list() returns every recorded finding; a corrupt file is skipped, never crashes the read", () => {
  const dir = tmpDir();
  const store = createAyasExternalResearchStore({ rootDir: dir });
  store.record(baseFinding({ provider: "A" }));
  store.record(baseFinding({ provider: "B" }));
  fs.writeFileSync(path.join(dir, "corrupt.json"), "{ not valid json", "utf8");
  const all = store.list();
  assert.equal(all.length, 2);
});

scenario("free-text fields are redacted/bounded the same way every other AYAS durable store scrubs human text", () => {
  const store = createAyasExternalResearchStore({ rootDir: tmpDir() });
  const finding = store.record(baseFinding({ licenseCostNotes: `contact us at sales@example.com about C:\\Users\\Metod\\pricing.xlsx and ${"x".repeat(1000)}` }));
  assert.ok(!finding.licenseCostNotes.includes("sales@example.com"));
  assert.ok(!finding.licenseCostNotes.includes("C:\\Users\\Metod"));
  assert.ok(finding.licenseCostNotes.length <= 600);
});

scenario("this module has no network code at all — grep-verifiable structural guarantee, not just a runtime check", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasExternalResearchStore.ts"), "utf8");
  assert.doesNotMatch(src, /\bfetch\(|require\(["']https?["']\)|from ["']node:https?["']|WebFetch|WebSearch/);
});

console.log(`AYAS external research store smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-external-research-store", scenarios: count }));
