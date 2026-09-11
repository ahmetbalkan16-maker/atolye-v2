/**
 * AYAS long-term memory smoke suite (Phase 2 · Phase C).
 *
 * Deterministic. Uses a temp `data/brain` root — nothing touches the real store.
 * Covers: candidate extraction, governance (accept / reject / secret / transient),
 * the fs store (append / dedupe / prune / secret-leak refusal), recall ranking +
 * top-K + char cap, and the fire-and-forget write path.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { extractAyasMemoryCandidates } from "../src/lib/ayas/memory/AyasMemoryCandidate";
import { scoreAyasMemoryCandidate } from "../src/lib/ayas/memory/AyasMemoryGovernance";
import { createAyasMemoryStore } from "../src/lib/ayas/memory/AyasMemoryStore";
import { rankAyasMemory, recallAyasMemoryLines, persistAyasMemoryFromTurn } from "../src/lib/ayas/memory/AyasMemoryRecall";
import { buildBrainMemoryRecord } from "../src/lib/brain/BrainMemoryModel";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-mem-"));
}
const NOW = "2026-09-11T10:00:00.000Z";

function rec(over: Partial<Parameters<typeof buildBrainMemoryRecord>[0]> = {}) {
  return buildBrainMemoryRecord({
    kind: "user-preference",
    title: "t",
    body: "kullanıcı sesli yanıtları kısa istiyor",
    importance: "durable",
    confidence: "reported",
    tags: ["tercih"],
    observedAt: NOW,
    links: [],
    ...over,
  });
}

async function run() {
  /* ---------------- candidate extraction ---------------- */

  await scenario("candidate — an explicit preference is extracted; small talk is not", () => {
    assert.equal(
      extractAyasMemoryCandidates({ userText: "bundan sonra yanıtları hep kısa tut lütfen", ayasReply: "Tamam." }).length,
      1,
    );
    assert.equal(extractAyasMemoryCandidates({ userText: "bugün hava çok güzel değil mi", ayasReply: "Evet." }).length, 0);
    assert.equal(extractAyasMemoryCandidates({ userText: "selam", ayasReply: "Merhaba." }).length, 0);
  });

  await scenario("candidate — a decision and an environment fact are distinct candidates", () => {
    const dec = extractAyasMemoryCandidates({ userText: "video başına 3 sahne kullanmaya karar verdik", ayasReply: "Not aldım." });
    assert.equal(dec[0]?.kind, "decision");
    const env = extractAyasMemoryCandidates({ userText: "benim makinem RTX A2000 12GB kullanıyorum", ayasReply: "Anladım." });
    assert.equal(env[0]?.kind, "environment-note");
  });

  /* ---------------- governance ---------------- */

  await scenario("governance — a user-stated preference → store as durable/reported", () => {
    const d = scoreAyasMemoryCandidate({
      kind: "user-preference",
      title: "Kullanıcı tercihi",
      body: "yanıtları kısa tut",
      tags: ["tercih"],
      source: "user-stated",
    });
    assert.equal(d.store, true);
    assert.equal(d.importance, "durable");
    assert.equal(d.confidence, "reported");
  });

  await scenario("governance — an ayas-inferred non-durable candidate → rejected (transient)", () => {
    const d = scoreAyasMemoryCandidate({
      kind: "outcome-history",
      title: "x",
      body: "kullanıcı bugün iyi görünüyordu",
      tags: [],
      source: "ayas-inferred",
    });
    assert.equal(d.store, false);
    assert.match(d.reason, /geçici/);
  });

  await scenario("governance — a candidate carrying a secret → rejected outright", () => {
    const d = scoreAyasMemoryCandidate({
      kind: "environment-note",
      title: "x",
      body: "api anahtarı sk-abcdefghijklmnopqrstuvwxyz012345",
      tags: [],
      source: "user-stated",
    });
    assert.equal(d.store, false);
    assert.match(d.reason, /sır|anahtar/i);
  });

  await scenario("governance — security-policy kind never stored", () => {
    const d = scoreAyasMemoryCandidate({
      kind: "security-policy",
      title: "x",
      body: "yürütme kapısı kapalı kalmalı",
      tags: [],
      source: "user-decision",
    });
    assert.equal(d.store, false);
  });

  /* ---------------- store ---------------- */

  await scenario("store — append + dedupe on contentFingerprint; load reads back", () => {
    const root = tmpRoot();
    const store = createAyasMemoryStore({ rootDir: root });
    assert.equal(store.append(rec()), "stored");
    assert.equal(store.append(rec()), "duplicate", "same content → not stored twice");
    assert.equal(store.append(rec({ body: "kullanıcı görsel tercihini belirtti" })), "stored");
    assert.equal(store.load().length, 2);
    assert.ok(fs.existsSync(store.file));
  });

  await scenario("store — a record that still holds a secret is refused (not scrubbed-and-stored)", () => {
    const root = tmpRoot();
    const store = createAyasMemoryStore({ rootDir: root });
    // build a record whose body defeats the redactor pattern but a broad check flags
    const leaky = { ...rec(), body: "token sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", title: "sızıntı" };
    assert.equal(store.append(leaky as never), "rejected");
    assert.equal(store.load().length, 0);
  });

  await scenario("store — prune drops expired non-pinned; keeps pinned", () => {
    const root = tmpRoot();
    const store = createAyasMemoryStore({ rootDir: root });
    store.append(rec({ importance: "normal", body: "geçici not bir iki", expiresAt: "2026-09-11T09:00:00.000Z" }));
    store.append(rec({ importance: "pinned", body: "kalıcı kural bir iki", expiresAt: "2026-09-11T09:00:00.000Z" }));
    const removed = store.prune("2026-09-11T12:00:00.000Z");
    assert.equal(removed, 1);
    assert.equal(store.load().length, 1);
    assert.equal(store.load()[0].importance, "pinned");
  });

  /* ---------------- recall ---------------- */

  await scenario("recall — ranks by importance + query/project overlap; top-K only", () => {
    const records = [
      rec({ body: "kullanıcı Mimar Sinan projesinde kısa metin istiyor", tags: ["mimar-sinan"], importance: "durable" }),
      rec({ body: "genel olarak emoji kullanma", tags: ["tercih"], importance: "normal" }),
      rec({ kind: "known-bug", body: "visuals aşaması ara sıra timeout veriyor", tags: ["bug"], importance: "normal" }),
      rec({ body: "alakasız eski not bir iki üç", tags: ["misc"], importance: "transient" }),
    ];
    const top = rankAyasMemory(records, "Mimar Sinan visuals neden takıldı", { activeProject: "Mimar Sinan", nowIso: NOW });
    assert.ok(top.length > 0 && top.length <= 4);
    assert.ok(top.some((r) => r.body.includes("Mimar Sinan")));
    assert.ok(!top.some((r) => r.body.includes("alakasız eski not")), "irrelevant transient excluded");
  });

  await scenario("recall — empty store → [] ; no error", async () => {
    const root = tmpRoot();
    const lines = await recallAyasMemoryLines("herhangi bir soru", { store: { rootDir: root } });
    assert.deepEqual(lines, []);
  });

  await scenario("recall lines — capped, formatted, kind-tagged", async () => {
    const root = tmpRoot();
    const store = createAyasMemoryStore({ rootDir: root });
    store.append(rec({ body: "kullanıcı sesli yanıtları 2-3 cümle istiyor", tags: ["ses", "tercih"], importance: "durable" }));
    const lines = await recallAyasMemoryLines("sesli yanıt ne kadar uzun olsun", { store: { rootDir: root } });
    assert.equal(lines.length >= 1, true);
    assert.match(lines[0], /\(user-preference\)/);
    assert.ok(lines.join("\n").length <= 800);
  });

  /* ---------------- write path ---------------- */

  await scenario("persistAyasMemoryFromTurn — extracts, gates, stores; a plain turn stores nothing", async () => {
    const root = tmpRoot();
    const a = await persistAyasMemoryFromTurn({
      userText: "bundan sonra bana her zaman önce riskleri söyle",
      ayasReply: "Tamam, aklımda tutuyorum.",
      nowIso: NOW,
      store: { rootDir: root },
    });
    assert.equal(a.candidates, 1);
    assert.equal(a.stored, 1);
    assert.equal(createAyasMemoryStore({ rootDir: root }).load().length, 1);

    const b = await persistAyasMemoryFromTurn({
      userText: "peki teşekkürler",
      ayasReply: "Rica ederim.",
      nowIso: NOW,
      store: { rootDir: root },
    });
    assert.equal(b.stored, 0);
    assert.equal(createAyasMemoryStore({ rootDir: root }).load().length, 1);
  });

  await scenario("persistAyasMemoryFromTurn — never throws on a bad store path", async () => {
    const a = await persistAyasMemoryFromTurn({
      userText: "bundan sonra kısa yaz",
      ayasReply: "ok",
      store: { rootDir: " ::invalid::" },
    });
    assert.equal(typeof a.stored, "number");
  });

  console.log(`AYAS memory smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-memory", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS memory smoke FAILED:", error);
  process.exitCode = 1;
});
