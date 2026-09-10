/**
 * Atölye Brain — Self-Healing durable store smoke suite.
 *
 * Temp dir only. Asserts: atomic round-trip, deterministic listing, corrupt /
 * wrong-schema files throw (never a silent fresh start), a secret that survives
 * redaction is REJECTED (not masked-and-kept), and the signature mute-history.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildBrainIncident, advanceIncident, type BrainIncident } from "../src/lib/brain/selfheal/BrainIncident";
import { buildLearnedPattern } from "../src/lib/brain/selfheal/BrainLearnedPattern";
import {
  createBrainSelfHealStore,
  BrainSelfHealStoreError,
} from "../src/lib/brain/selfheal/BrainSelfHealStore";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const NOW = "2026-09-11T12:00:00.000Z";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sh-store-"));
}

function inc(over: Partial<Parameters<typeof buildBrainIncident>[0]> = {}): BrainIncident {
  return buildBrainIncident({
    category: "voice",
    severity: "P1",
    classification: "REAL_INCIDENT",
    symptom: "wake pipeline stalled after 3 recoveries",
    now: NOW,
    ...over,
  });
}

async function run() {
  await scenario("incident — save → load round-trips exactly; listing is newest-first", () => {
    const root = tmp();
    try {
      const store = createBrainSelfHealStore({ rootDir: root });
      const a = store.saveIncident(inc({ symptom: "alpha" }));
      const b = advanceIncident(inc({ symptom: "beta" }), { kind: "diagnose", now: "2026-09-11T13:00:00.000Z", hypotheses: [] }).incident;
      store.saveIncident(b);
      assert.deepEqual(store.loadIncident(a.id), a);
      const list = store.listIncidents();
      assert.equal(list.length, 2);
      assert.equal(list[0].updatedAt >= list[1].updatedAt, true, "newest first");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("incident — a corrupt JSON file throws SELFHEAL_STORE_CORRUPT (never an empty read)", () => {
    const root = tmp();
    try {
      const store = createBrainSelfHealStore({ rootDir: root });
      const i = store.saveIncident(inc());
      fs.writeFileSync(path.join(store.dir, "incidents", `${i.id}.json`), "{ not json");
      assert.throws(() => store.loadIncident(i.id), (e) => e instanceof BrainSelfHealStoreError && e.code === "SELFHEAL_STORE_CORRUPT");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("incident — a wrong schemaVersion throws SELFHEAL_STORE_SCHEMA_MISMATCH", () => {
    const root = tmp();
    try {
      const store = createBrainSelfHealStore({ rootDir: root });
      const i = store.saveIncident(inc());
      const raw = JSON.parse(fs.readFileSync(path.join(store.dir, "incidents", `${i.id}.json`), "utf-8"));
      raw.schemaVersion = "999";
      fs.writeFileSync(path.join(store.dir, "incidents", `${i.id}.json`), JSON.stringify(raw));
      assert.throws(() => store.loadIncident(i.id), (e) => e instanceof BrainSelfHealStoreError && e.code === "SELFHEAL_STORE_SCHEMA_MISMATCH");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("incident — a string that still matches a secret pattern is REJECTED, not stored", () => {
    const root = tmp();
    try {
      const store = createBrainSelfHealStore({ rootDir: root });
      // craft an incident object whose evidence bypassed the build-time scrub
      const bad = { ...inc(), evidence: [{ at: NOW, source: "log", note: "AKIA" + "IOSFODNN7EXAMPLE aws key" }] } as unknown as BrainIncident;
      assert.throws(() => store.saveIncident(bad), (e) => e instanceof BrainSelfHealStoreError && e.code === "SELFHEAL_STORE_SECRET_LEAK");
      assert.equal(fs.existsSync(path.join(store.dir, "incidents", `${bad.id}.json`)), false, "nothing written");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("learned-pattern — save → load → list", () => {
    const root = tmp();
    try {
      const store = createBrainSelfHealStore({ rootDir: root });
      const p = buildLearnedPattern(inc(), { successfulFix: "persistent AudioContext + stream reuse", regressionResult: "200-turn PASS", risk: "MEDIUM", status: "APPLIED", now: NOW });
      store.saveLearnedPattern(p);
      assert.deepEqual(store.loadLearnedPattern(p.id), p);
      assert.equal(store.listLearnedPatterns().length, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("signature history — recorded + windowed; old entries pruned", () => {
    const root = tmp();
    try {
      const store = createBrainSelfHealStore({ rootDir: root });
      const t0 = Date.parse(NOW);
      store.recordSignature({ signature: "voice:x y z", openedAt: t0 });
      store.recordSignature({ signature: "voice:x y z", openedAt: t0 - 30 * 24 * 3600_000 }); // > 7 d old
      const hist = store.loadSignatureHistory();
      assert.equal(hist.length, 1, "old entry pruned on write");
      assert.equal(hist[0].signature, "voice:x y z");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("store — an unknown incident id is `undefined` (not a throw) when the file is simply absent", () => {
    const root = tmp();
    try {
      const store = createBrainSelfHealStore({ rootDir: root });
      assert.equal(store.loadIncident("sh-deadbeef"), undefined);
      assert.equal(store.listIncidents().length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  console.log(`Atölye Brain self-heal store smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-selfheal-store", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
