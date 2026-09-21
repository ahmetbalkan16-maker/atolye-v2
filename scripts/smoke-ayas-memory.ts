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
import { AyasMemoryStoreError, createAyasMemoryStore } from "../src/lib/ayas/memory/AyasMemoryStore";
import { rankAyasMemory, recallAyasMemoryLines, recallAyasMemoryWithTrace, persistAyasMemoryFromTurn } from "../src/lib/ayas/memory/AyasMemoryRecall";
import { retrieveAyasMemory } from "../src/lib/ayas/memory/AyasMemoryRetrieval";
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

  /* ---------------- identity / "remember me as X" (real-user-test bug fix) ---------------- */

  await scenario('candidate — TEST 1: "beni Ahmet olarak hatırla ben Atölye projesinin sahibiyim…" (the EXACT real-user-test message) is extracted as a "kimlik"-tagged user-preference', () => {
    const cands = extractAyasMemoryCandidates({
      userText:
        "beni ahmet olarak hatırla ben atölye projesinin sahibiyim ve ayısı kişisel yapay zeka asistanım olarak geliştirmek istiyorum",
      ayasReply: "Anladım, Ahmet.",
    });
    assert.equal(cands.length, 1, "exactly one candidate — no double-fire against PREFERENCE/DECISION/ENV_FACT/BUG");
    assert.equal(cands[0].kind, "user-preference");
    assert.equal(cands[0].source, "user-stated");
    assert.ok(cands[0].tags.includes("kimlik"));
    assert.match(cands[0].body, /ahmet/i);
  });

  await scenario('candidate — TEST 3: "Bana Ahmet diye hitap et" is also extracted as a "kimlik" candidate', () => {
    const cands = extractAyasMemoryCandidates({ userText: "Bana Ahmet diye hitap et lütfen", ayasReply: "Tamam, Ahmet." });
    assert.equal(cands.length, 1);
    assert.equal(cands[0].kind, "user-preference");
    assert.ok(cands[0].tags.includes("kimlik"));
  });

  await scenario('candidate — "adım Ahmet" and "ben Ahmet\'im" (apostrophe form) are both caught', () => {
    assert.equal(extractAyasMemoryCandidates({ userText: "merhaba, adım Ahmet, memnun oldum", ayasReply: "Ben de." })[0]?.tags.includes("kimlik"), true);
    assert.equal(extractAyasMemoryCandidates({ userText: "ben Ahmet'im, Atölye'yi ben kurdum", ayasReply: "Anladım." })[0]?.tags.includes("kimlik"), true);
  });

  await scenario(
    'candidate — ROUND 2 fix (found by a real end-to-end run): asking "Benim adım ne ve benimle ilgili ne hatırlıyorsun?" must NOT itself be extracted as an identity statement — it is a QUESTION about the name, not a statement of it',
    () => {
      const cands = extractAyasMemoryCandidates({
        userText: "Benim adım ne ve benimle ilgili ne hatırlıyorsun?",
        ayasReply: "Adın Ahmet.",
      });
      assert.equal(cands.length, 0, "a question about one's own name must never itself become a stored memory candidate");
    },
  );

  await scenario(
    'candidate — TEST 5: plain conjugated Turkish sentences that merely END IN "-im"/"-yim" (no apostrophe, not a proper noun) do NOT false-positive as an identity statement',
    () => {
      // "ben değilim" / "ben yorgunum" are ordinary negation/adjective conjugations,
      // not identity statements — the REQUIRED apostrophe before im/yim is what
      // tells them apart from "ben Ahmet'im".
      assert.equal(extractAyasMemoryCandidates({ userText: "hayır ben değilim, o yaptı bence", ayasReply: "Anladım." }).length, 0);
      assert.equal(extractAyasMemoryCandidates({ userText: "ben bugün gerçekten çok yorgunum", ayasReply: "Dinlenmelisin." }).length, 0);
      assert.equal(extractAyasMemoryCandidates({ userText: "naber, bugün hava çok güzel değil mi", ayasReply: "Evet." }).length, 0);
    },
  );

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

  await scenario("store — structurally invalid records fail closed with a typed error", () => {
    const root = tmpRoot();
    const dir = path.join(root, "memory");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "records.json"),
      JSON.stringify({ schemaVersion: "1", records: [{ schemaVersion: "1", body: 42 }] }),
      "utf-8",
    );
    assert.throws(
      () => createAyasMemoryStore({ rootDir: root }).load(),
      (error: unknown) => error instanceof AyasMemoryStoreError && error.code === "AYAS_MEMORY_STORE_INVALID",
    );
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

  await scenario(
    'recall — TEST 4: a "kimlik"-tagged identity record outranks an unrelated "visuals" project-status note for an identity question, even with ZERO literal keyword overlap',
    () => {
      const records = [
        rec({
          kind: "known-bug",
          title: "Bilinen sorun",
          body: "visuals aşamasında bir proje başarısız oldu ve kuyrukta o görev var",
          tags: ["bug", "visuals"],
          importance: "normal",
        }),
        rec({
          kind: "user-preference",
          title: "Kullanıcı kimliği / hitap tercihi",
          body: "beni ahmet olarak hatırla ben atölye projesinin sahibiyim",
          tags: ["kimlik"],
          importance: "durable",
        }),
      ];
      // The real query has NO literal token overlap with either record's body
      // ("adım"/"ne"/"ilgili" vs "ahmet"/"visuals") — this is the exact
      // structural gap the identity bonus exists to close.
      const top = rankAyasMemory(records, "benim adım ne ve benimle ilgili ne hatırlıyorsun", { nowIso: NOW });
      assert.ok(top.length > 0, "the identity record must still surface with zero keyword overlap");
      assert.ok(top[0].tags.includes("kimlik"), "the identity record must rank FIRST, ahead of the irrelevant visuals note");
    },
  );

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

  await scenario("retrieval — irrelevant durable memory is not selected solely because it is durable", () => {
    const result = retrieveAyasMemory(
      [rec({ body: "bundan sonra cevapları kısa tut", tags: ["tercih"] })],
      "Ankara hava durumu nasıl",
      { nowIso: NOW },
    );
    assert.equal(result.selected.length, 0);
  });

  await scenario("retrieval — reported memory outranks a newer inferred memory", () => {
    const result = retrieveAyasMemory(
      [
        rec({ body: "sesli yanıtları kısa tut", tags: ["ses"], confidence: "reported", observedAt: "2026-08-01T10:00:00.000Z" }),
        rec({ body: "sesli yanıtları uzun tut", tags: ["ses"], confidence: "inferred", observedAt: "2026-09-10T10:00:00.000Z" }),
      ],
      "sesli yanıt tercihim",
      { nowIso: NOW },
    );
    assert.equal(result.selected[0]?.trustClass, "user-reported");
  });

  await scenario("retrieval — conflicting identity facts are quarantined instead of guessed", () => {
    const result = retrieveAyasMemory(
      [
        rec({ body: "beni Ahmet olarak hatırla", tags: ["kimlik"] }),
        rec({ body: "beni Mehmet olarak hatırla", tags: ["kimlik"] }),
      ],
      "benim adım ne",
      { nowIso: NOW },
    );
    assert.equal(result.selected.length, 0);
    assert.equal(result.quarantined.length, 2);
    assert.ok(result.quarantined.every((decision) => decision.conflictState === "conflicting"));
    assert.ok(result.quarantined.every((decision) => decision.quarantineReason === "conflicting-fact"));
  });

  await scenario("retrieval — a future-dated fact is quarantined", () => {
    const result = retrieveAyasMemory(
      [rec({ body: "sesli yanıtları kısa tut", tags: ["ses"], observedAt: "2026-09-12T10:06:00.000Z" })],
      "sesli yanıt tercihim",
      { nowIso: NOW },
    );
    assert.equal(result.selected.length, 0);
    assert.equal(result.quarantined[0]?.quarantineReason, "future-timestamp");
  });

  await scenario("retrieval — explicit current request overrides a conflicting remembered preference", () => {
    const result = retrieveAyasMemory(
      [rec({ body: "bundan sonra cevapları kısa tut", tags: ["tercih"] })],
      "Bu sefer uzun ve detaylı anlat",
      { nowIso: NOW },
    );
    assert.equal(result.selected.length, 0);
    assert.equal(result.quarantined[0]?.quarantineReason, "current-request-overrides-memory");
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

  await scenario(
    "TEST 2 (end-to-end, exact real-user-test flow): turn 1 persists the identity statement; a SEPARATE, later turn's recall finds it by name",
    async () => {
      const root = tmpRoot();
      const turn1 = await persistAyasMemoryFromTurn({
        userText:
          "beni ahmet olarak hatırla ben atölye projesinin sahibiyim ve ayısı kişisel yapay zeka asistanım olarak geliştirmek istiyorum",
        ayasReply: "Anladım, Ahmet.",
        nowIso: NOW,
        store: { rootDir: root },
      });
      assert.equal(turn1.candidates, 1);
      assert.equal(turn1.stored, 1, "the identity statement must actually reach AyasMemoryStore.append");
      const stored = createAyasMemoryStore({ rootDir: root }).load();
      assert.equal(stored.length, 1);
      assert.equal(stored[0].importance, "durable");
      assert.ok(stored[0].tags.includes("kimlik"));

      const lines = await recallAyasMemoryLines("benim adım ne ve benimle ilgili ne hatırlıyorsun", {
        store: { rootDir: root },
      });
      assert.equal(lines.length >= 1, true, "the recalled-memory block must not be empty on turn 2");
      assert.ok(lines.some((l) => /ahmet/i.test(l)), "Ahmet must actually appear in what would be injected into memoryLines");
    },
  );

  await scenario(
    "TEST 6: a genuinely CORRUPT memory store (malformed JSON on disk, not just a missing file) never throws",
    async () => {
      const root = tmpRoot();
      const dir = path.join(root, "memory");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "records.json"), "{ this is not valid JSON ][", "utf-8");

      const lines = await recallAyasMemoryLines("benim adım ne", { store: { rootDir: root } });
      assert.deepEqual(lines, [], "a corrupt store degrades to an empty memory block, never throws");
      const trace = await recallAyasMemoryWithTrace("benim adım ne", { store: { rootDir: root } });
      assert.equal(trace.status, "unreadable", "corrupt is explicitly distinguishable from an empty store");
      assert.throws(
        () => createAyasMemoryStore({ rootDir: root }).load(),
        (error: unknown) => error instanceof AyasMemoryStoreError && error.code === "AYAS_MEMORY_STORE_MALFORMED",
      );

      const outcome = await persistAyasMemoryFromTurn({
        userText: "bundan sonra kısa yaz",
        ayasReply: "ok",
        store: { rootDir: root },
      });
      assert.equal(typeof outcome.stored, "number", "the write side still resolves normally against a corrupt file");
      assert.equal(fs.readFileSync(path.join(dir, "records.json"), "utf-8"), "{ this is not valid JSON ][", "corrupt state is never overwritten");
    },
  );

  console.log(`AYAS memory smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-memory", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS memory smoke FAILED:", error);
  process.exitCode = 1;
});
