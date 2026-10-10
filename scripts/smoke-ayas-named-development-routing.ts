/** Live general-audit regression: named AYAS status must use the durable inbox. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAyasPreReasoningIntent } from "../src/lib/ayas/AyasIntentRouting";
import { classifyAyasComplexity } from "../src/lib/ayas/model/AyasComplexityRouter";
import { resolveDeterministicToolCandidate, streamAyasChat, type AyasChatStreamEvent } from "../src/lib/ayas/AyasChatStream";
import { AYAS_EXECUTION_ALLOWLIST } from "../src/lib/ayas/execution/AyasExecutionPolicy";
import { computeAyasDevelopmentStatusData, buildAyasDevelopmentStatusSummary } from "../src/lib/ayas/execution/AyasDevelopmentStatus";
import { withAyasActionRuntimeAuthorizationStore } from "../src/lib/ayas/execution/AyasActionRuntime";
import { AyasExecutionAuthorizationStore } from "../src/lib/ayas/execution/AyasExecutionAuthorization";
import { classifyAyasReplyFallback } from "../src/components/brain/brainCore";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";
import type { AyasModelProvider } from "../src/lib/ayas/model/AyasModelTypes";

const statusQueries = [
  "AYAS gelişim durumunu raporla. Son gerçek tarama ve bekleyen onaylar neler?",
  "Ayas gelişim durumunu göster",
  "AYAS'ın gelişim durumunu raporla",
  "AYAS gelisim durumunu goster",
  "AYAS gelişimini anlat",
  "AYAS gelişim önerilerini listele",
  "AYAS'ta gelişim durumu nedir?",
  "Ayas geliştirme merkezini kontrol et",
  "Ayas gelişim durumunda hata var mı?",
  "AYAS GELİŞİM DURUMUNU RAPORLA",
  "AYAS, gelişim durumunu raporla",
  "AYAS gelişim durumunu raporla; onay verip yayınlama",
];
const otherQueries = [
  "AYAS bu videoyu geliştir",
  "AYAS projeyi geliştirebilir miyiz?",
  "AYAS çocuk gelişimi konusunda bir video planla",
  "AYAS Türkçe konuşmanı geliştir",
  "AYAS gelişmiş bir içerik planı hazırla",
  "AYAS videoları nasıl geliştirebilirim?",
  "Bu projenin gelişim durumunu raporla",
  "AYAS bugün kaç projem var?",
  "AYAS son videoyu göster",
  "AYAS rapor ver",
  "Bugün nasılsın?",
  "AYAS Git durumunu göster",
];
for (const query of statusQueries) {
  assert.equal(resolveAyasPreReasoningIntent(query).kind, "development-status", query);
  assert.equal(classifyAyasComplexity(query), "TOOL", query);
  assert.equal(resolveDeterministicToolCandidate(query)?.action, "ayas-development-status", query);
}
for (const query of otherQueries) {
  assert.notEqual(resolveAyasPreReasoningIntent(query).kind, "development-status", query);
  assert.notEqual(resolveDeterministicToolCandidate(query)?.action, "ayas-development-status", query);
}
assert.equal(AYAS_EXECUTION_ALLOWLIST["ayas-development-status"].write, false);
assert.equal(AYAS_EXECUTION_ALLOWLIST["ayas-development-status"].destructive, false);
async function verifyStatusTruth(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-status-truth-"));
  // The inbox is only read. Audit leases and conversational memory are private.
  fs.mkdirSync(path.join(process.cwd(), "data", "brain"), { recursive: true });
  const query = statusQueries[0]!;
  const expected = buildAyasDevelopmentStatusSummary(computeAyasDevelopmentStatusData(query, new Date().toISOString()));
  let calls = 0;
  const provider: AyasModelProvider = {
    id: "ollama", kind: "local", model: "fixture", configured: true,
    async health() { return { available: true, detail: "fixture", checkedAtMs: Date.now() }; },
    async chat() {
      calls++;
      return { finishReason: "stop", text: calls === 1 ? JSON.stringify({
        intent: "gelişim durumunu oku", goal: "gerçek onay durumunu göster", constraints: [], assumptions: [],
        plan: ["kalıcı durumu oku"], requiredTools: ["ayas-development-status"], risk: "düşük",
        verification: ["kalıcı kayıt ile karşılaştır"], answer: "Onay bekleyen hiçbir öneri yok, son tarama geçen hafta yapıldı.",
      }) : "Onay bekleyen hiçbir öneri yok, son tarama geçen hafta yapıldı." };
    },
    async *stream() { throw new Error("status must never stream a model draft"); },
  };
  const snapshot: BrainConsoleSnapshot = { generatedAt: new Date().toISOString(), executionGate: "CLOSED",
    connected: { tasks: false, cycles: false, experience: false }, errors: [],
    tasks: { total: 0, byStatus: { queued: 0, running: 0, "blocked-on-dependency": 0, "blocked-on-approval": 0, succeeded: 0, failed: 0, cancelled: 0, "skipped-unsafe": 0 }, pendingApproval: 0, skippedUnsafe: 0, items: [] },
    cyclesRecorded: 0, experience: { total: 0 }, safety: { decision: "proceed-with-constraints", snapshotSource: "unavailable", reasons: [], hardwareProfileId: "fixture" } };
  const events: AyasChatStreamEvent[] = [];
  await withAyasActionRuntimeAuthorizationStore(new AyasExecutionAuthorizationStore({ rootDir: path.join(root, "audit") }), async () => {
    for await (const event of streamAyasChat({ text: query, seq: 0, snapshot, env: { NODE_ENV: "test" },
      route: { provider, decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "fixture", reason: "fixture" } },
      memoryStore: { rootDir: path.join(root, "memory") } })) events.push(event);
  });
  const done = events.find((event) => event.type === "done");
  assert.ok(done?.type === "done");
  assert.equal(done.actionTrace?.tool, "ayas-development-status"); assert.equal(done.actionTrace?.executed, true);
  assert.equal(done.text, expected, "model guesses must never replace durable development facts");
  assert.equal(done.source, "fallback"); assert.equal(classifyAyasReplyFallback(done.reason), "deterministic");
  assert.equal(calls, 1, "no second model call may invent dates or approval counts");
  assert.equal(events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join(""), done.text);
}
verifyStatusTruth().then(() => console.log(`AYAS named development routing smoke: PASS (${statusQueries.length + otherQueries.length + 1} scenarios)`))
  .catch((error) => { console.error(error); process.exitCode = 1; });
