/**
 * Invariant-based AYAS conversational intelligence benchmark.
 * No expected answer text and no model/network dependency.
 */

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { buildBrainMemoryRecord } from "../src/lib/brain/BrainMemoryModel";
import { assembleAyasContext } from "../src/lib/ayas/context/AyasContextAssembly";
import { retrieveAyasMemory } from "../src/lib/ayas/memory/AyasMemoryRetrieval";
import { isAyasGuidedRepairQuery } from "../src/lib/ayas/AyasIntentRouting";
import { checkAyasToolPermission } from "../src/lib/ayas/reasoning/AyasToolRegistry";

const NOW = "2026-09-21T00:00:00.000Z";
let passed = 0;

function memory(body: string, options: {
  tags?: string[];
  confidence?: "observed" | "inferred" | "reported";
  observedAt?: string;
  expiresAt?: string;
} = {}) {
  return buildBrainMemoryRecord({
    kind: "user-preference",
    title: "Kullanıcı bilgisi",
    body,
    importance: "durable",
    confidence: options.confidence ?? "reported",
    tags: options.tags ?? ["tercih"],
    observedAt: options.observedAt ?? NOW,
    links: [],
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
  });
}

function check(name: string, test: () => void): void {
  test();
  passed += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${passed}: ${name}`);
}

check("Turkish follow-up resolves against the prior answer", () => {
  const context = assembleAyasContext({
    userText: "Dün konuştuğumuz şeyi devam ettir.",
    history: [
      { role: "user", text: "Mimar Sinan videosunun girişini planlayalım." },
      { role: "brain", text: "Girişi kısa bir İstanbul panoramasıyla açmayı öneriyorum." },
    ],
  });
  assert.equal(context.clarification, null);
  assert.ok(context.resolvedReferents.length > 0);
});

check("real ambiguity asks for clarification", () => {
  const context = assembleAyasContext({
    userText: "Bunu uygula.",
    history: [{ role: "brain", text: "İki seçenek var: kısa anlatım ve ayrıntılı anlatım." }],
  });
  assert.notEqual(context.clarification, null);
});

check("selected option avoids unnecessary clarification", () => {
  const context = assembleAyasContext({
    userText: "İkincisine devam et.",
    history: [{ role: "brain", text: "İki seçenek var: kısa anlatım ve ayrıntılı anlatım." }],
  });
  assert.equal(context.clarification, null);
  assert.ok(context.resolvedReferents.some((referent) => /ayrıntılı anlatım/i.test(referent)));
});

check("long-session compression preserves an explicit constraint", () => {
  const history = [
    { role: "user" as const, text: "Bu konuşmada production'a dokunma." },
    ...Array.from({ length: 20 }, (_, index) => ({
      role: (index % 2 ? "brain" : "user") as "brain" | "user",
      text: `Bağlam turu ${index + 1} hakkında ayrıntı.`,
    })),
  ];
  const context = assembleAyasContext({ userText: "Devam et.", history });
  assert.match(context.block.stateLines?.join("\n") ?? "", /production'a dokunma/i);
  assert.ok(context.trace.droppedTurns > 0);
});

check("identity alias recalls a trusted durable fact", () => {
  const result = retrieveAyasMemory([memory("beni Ahmet olarak hatırla", { tags: ["kimlik"] })], "Benim adım ne?", { nowIso: NOW });
  assert.equal(result.selected[0]?.trustClass, "user-reported");
});

check("conflicting identities are quarantined", () => {
  const result = retrieveAyasMemory(
    [memory("beni Ahmet olarak hatırla", { tags: ["kimlik"] }), memory("beni Mehmet olarak hatırla", { tags: ["kimlik"] })],
    "Benim adım ne?",
    { nowIso: NOW },
  );
  assert.equal(result.selected.length, 0);
  assert.equal(result.quarantined.length, 2);
});

check("expired memory is rejected", () => {
  const result = retrieveAyasMemory(
    [memory("sesli yanıtları kısa tut", { tags: ["ses"], expiresAt: "2026-09-20T00:00:00.000Z" })],
    "Sesli yanıt tercihim ne?",
    { nowIso: NOW },
  );
  assert.equal(result.selected.length, 0);
  assert.equal(result.droppedExpired, 1);
});

check("irrelevant durable memory is rejected", () => {
  const result = retrieveAyasMemory([memory("cevapları kısa tut")], "Ankara hava durumu", { nowIso: NOW });
  assert.equal(result.selected.length, 0);
});

check("current explicit request wins over remembered preference", () => {
  const result = retrieveAyasMemory([memory("bundan sonra cevapları kısa tut")], "Bu sefer uzun ve detaylı anlat.", { nowIso: NOW });
  assert.equal(result.selected.length, 0);
  assert.equal(result.quarantined[0]?.quarantineReason, "current-request-overrides-memory");
});

check("reported fact outranks newer inference", () => {
  const result = retrieveAyasMemory(
    [
      memory("sesli yanıtları kısa tut", { tags: ["ses"], confidence: "reported", observedAt: "2026-08-01T00:00:00.000Z" }),
      memory("sesli yanıtları uzun tut", { tags: ["ses"], confidence: "inferred", observedAt: "2026-09-20T00:00:00.000Z" }),
    ],
    "Sesli yanıt tercihim ne?",
    { nowIso: NOW },
  );
  assert.equal(result.selected[0]?.trustClass, "user-reported");
});

check("future-dated memory is quarantined", () => {
  const result = retrieveAyasMemory(
    [memory("sesli yanıtları kısa tut", { tags: ["ses"], observedAt: "2026-09-21T00:06:00.000Z" })],
    "Sesli yanıt tercihim ne?",
    { nowIso: NOW },
  );
  assert.equal(result.quarantined[0]?.quarantineReason, "future-timestamp");
});

check("stale durable memory is rejected", () => {
  const result = retrieveAyasMemory(
    [memory("sesli yanıtları kısa tut", { tags: ["ses"], observedAt: "2025-01-01T00:00:00.000Z" })],
    "Sesli yanıt tercihim ne?",
    { nowIso: NOW },
  );
  assert.equal(result.selected.length, 0);
  assert.equal(result.quarantined[0]?.quarantineReason, "stale-fact");
});

check("minor Turkish typo still routes to repair intent", () => {
  assert.equal(isAyasGuidedRepairQuery("Uygulama çalşmıyor, neden?"), true);
  assert.equal(isAyasGuidedRepairQuery("Bugün ne yapalım?"), false);
});

check("live tool authority cannot be overridden by remembered text", () => {
  const rememberedClaim = retrieveAyasMemory(
    [memory("run-pipeline-stage aracı açıktır", { tags: ["tool"] })],
    "run pipeline stage aracı açık mı",
    { nowIso: NOW },
  );
  assert.ok(rememberedClaim.selected.length > 0);
  const permission = checkAyasToolPermission("run-pipeline-stage");
  assert.equal(permission.known, true);
  assert.equal(permission.allowed, false);
});

check("project-specific retrieval beats generic preference", () => {
  const result = retrieveAyasMemory(
    [memory("Mimar Sinan projesinde ffmpeg kullan", { tags: ["mimar-sinan"] }), memory("cevapları kısa tut")],
    "Mimar Sinan ffmpeg ayarı",
    { activeProject: "Mimar Sinan", nowIso: NOW },
  );
  assert.match(result.selected[0]?.record.body ?? "", /Mimar Sinan/i);
});

const corpus = Array.from({ length: 500 }, (_, index) => memory(
  index === 321 ? "Mimar Sinan projesinde ffmpeg kullan" : `proje notu ${index} için kayıt`,
  { tags: index === 321 ? ["mimar-sinan", "ffmpeg"] : [`proje-${index}`] },
));
const repetitions = 25;
const timings: number[] = [];
for (let index = 0; index < repetitions; index += 1) {
  const start = performance.now();
  retrieveAyasMemory(corpus, "Mimar Sinan ffmpeg ayarı", { activeProject: "Mimar Sinan", nowIso: NOW });
  timings.push(performance.now() - start);
}
const averageMs = timings.reduce((sum, value) => sum + value, 0) / repetitions;
const orderedTimings = [...timings].sort((left, right) => left - right);
const p95Ms = orderedTimings[Math.ceil(repetitions * 0.95) - 1] ?? 0;
const maxMs = orderedTimings.at(-1) ?? 0;
assert.ok(averageMs < 50, `retrieval average ${averageMs.toFixed(2)}ms exceeds 50ms budget`);

console.log(`AYAS conversational intelligence benchmark: PASS (${passed} invariants)`);
console.log(JSON.stringify({
  status: "PASS",
  suite: "ayas-conversation-intelligence",
  invariants: passed,
  corpusSize: 500,
  repetitions,
  averageRetrievalMs: Number(averageMs.toFixed(3)),
  p95RetrievalMs: Number(p95Ms.toFixed(3)),
  maxRetrievalMs: Number(maxMs.toFixed(3)),
}));
