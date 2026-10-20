/** Native Graphify state chat: structural selection, facts and unchanged authority. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyAyasComplexity, isAyasGraphifyStateQuery } from "../src/lib/ayas/model/AyasComplexityRouter";
import { selectAyasAgenticRoute } from "../src/lib/ayas/routing/AyasAgenticRouting";
import { buildAyasGraphifyStateReply, resolveDeterministicToolCandidate, streamAyasChat, type AyasChatStreamEvent } from "../src/lib/ayas/AyasChatStream";
import { withAyasActionRuntimeAuthorizationStore } from "../src/lib/ayas/execution/AyasActionRuntime";
import { AyasExecutionAuthorizationStore } from "../src/lib/ayas/execution/AyasExecutionAuthorization";
import { AYAS_EXECUTION_ALLOWLIST } from "../src/lib/ayas/execution/AyasExecutionPolicy";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";
import type { AyasModelProvider } from "../src/lib/ayas/model/AyasModelTypes";

const positive = ["Graphify durumunu göster. Sadece incele, değişiklik yapma.", "Graphify durumunu raporla",
  "AYAS Graphify durumuna bak", "Graphify status", "GRAPHIFY DURUMU NEDİR?", "Graphify durumunu sadece oku"];
const negative = ["Graphify'i kur", "Graphify komutunu güncelle", "Graphify ile modül bağımlılıklarını açıkla",
  "Graphify nedir?", "Git durumunu göster", "AYAS gelişim durumunu göster"];
let count = 0;
for (const text of positive) {
  assert.equal(isAyasGraphifyStateQuery(text), true, "assert.equal(isAyasGraphifyStateQuery(text), true)"); assert.equal(classifyAyasComplexity(text), "TOOL", "assert.equal(classifyAyasComplexity(text), \"TOOL\")");
  const candidate = resolveDeterministicToolCandidate(text);
  assert.equal(candidate?.action, "query-graphify", "assert.equal(candidate?.action, \"query-graphify\")"); assert.deepEqual(candidate?.toolInput, { operation: "state" }, "assert.deepEqual(candidate?.toolInput, { operation: \"state\" })");
  const selection = selectAyasAgenticRoute({ text, availableModelIds: ["ollama"] });
  assert.equal(selection.selectedToolId, "query-graphify", "assert.equal(selection.selectedToolId, \"query-graphify\")"); assert.equal(selection.blocked, false, "assert.equal(selection.blocked, false)"); count++;
}
for (const text of negative) { assert.equal(isAyasGraphifyStateQuery(text), false, "assert.equal(isAyasGraphifyStateQuery(text), false)"); assert.notEqual(resolveDeterministicToolCandidate(text)?.action, "query-graphify"); count++; }
for (const text of ["Graphify durumunu güncelle", "Graphify durumunu göster ve commit yap",
  "Graphify durumunu ve checkpoint'i göster", "Graphify durumunu ve git durumunu göster"]) {
  const selection = selectAyasAgenticRoute({ text, availableModelIds: ["ollama"] });
  assert.equal(selection.selectedToolId, null, text); assert.equal(selection.blocked, true, text); count++;
}
const unavailable = selectAyasAgenticRoute({ text: positive[0]!, availableModelIds: ["ollama"], unavailableToolIds: ["query-graphify"] });
assert.equal(unavailable.selectedToolId, null, "assert.equal(unavailable.selectedToolId, null)"); assert.equal(unavailable.blocked, true, "assert.equal(unavailable.blocked, true)"); count++;
const canonical = buildAyasGraphifyStateReply({ sourceHead: "source", lastAnalyzedHead: "source", structuralStatus: "PARTIAL",
  semanticStatus: "PENDING", classification: "GRAPH_PARTIAL", incompleteCodeFiles: 10, worktreeState: "CLEAN" });
assert.ok(canonical.includes("PARTIAL") && canonical.includes("PENDING") && canonical.includes("10"), "assert.ok(canonical.includes(\"PARTIAL\") && canonical.includes(\"PENDING\") && canonical.includes(\"10\"))"); assert.ok(!canonical.includes("FULL"), "assert.ok(!canonical.includes(\"FULL\"))"); count++;
assert.ok(buildAyasGraphifyStateReply({}).includes("bilinmiyor"), "assert.ok(buildAyasGraphifyStateReply({}).includes(\"bilinmiyor\"))"); count++;
assert.equal(AYAS_EXECUTION_ALLOWLIST["query-graphify"].write, false, "assert.equal(AYAS_EXECUTION_ALLOWLIST[\"query-graphify\"].write, false)");
assert.equal(AYAS_EXECUTION_ALLOWLIST["query-graphify"].destructive, false, "assert.equal(AYAS_EXECUTION_ALLOWLIST[\"query-graphify\"].destructive, false)");

async function streamTruth() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-graph-state-chat-"));
  let calls = 0;
  const provider: AyasModelProvider = { id: "ollama", kind: "local", model: "fixture", configured: true,
    async health() { return { available: true, detail: "fixture", checkedAtMs: Date.now() }; },
    async chat() { calls++; return { finishReason: "stop", text: JSON.stringify({ intent: "graphify durumunu oku", goal: "gerçek durum",
      constraints: [], assumptions: [], plan: ["durumu oku"], requiredTools: [], risk: "düşük", verification: ["kaynak"],
      answer: "Graphify tam ve güncel; yapısal FULL ve anlamsal FULL; eksik dosya sıfır." }) }; },
    async *stream() { throw new Error("state cannot stream a model draft"); } };
  const snapshot: BrainConsoleSnapshot = { generatedAt: new Date().toISOString(), executionGate: "CLOSED",
    connected: { tasks: false, cycles: false, experience: false }, errors: [],
    tasks: { total: 0, byStatus: { queued: 0, running: 0, "blocked-on-dependency": 0, "blocked-on-approval": 0, succeeded: 0,
      failed: 0, cancelled: 0, "skipped-unsafe": 0 }, pendingApproval: 0, skippedUnsafe: 0, items: [] },
    cyclesRecorded: 0, experience: { total: 0 }, safety: { decision: "proceed-with-constraints", snapshotSource: "unavailable", reasons: [], hardwareProfileId: "fixture" } };
  const events: AyasChatStreamEvent[] = [];
  await withAyasActionRuntimeAuthorizationStore(new AyasExecutionAuthorizationStore({ rootDir: path.join(root, "audit") }), async () => {
    for await (const event of streamAyasChat({ text: positive[0]!, seq: 0, snapshot, env: { NODE_ENV: "test" },
      route: { provider, decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "fixture", reason: "fixture" } },
      memoryStore: { rootDir: path.join(root, "memory") } })) events.push(event);
  });
  const done = events.find(event => event.type === "done"); assert.ok(done?.type === "done", "assert.ok(done?.type === \"done\")");
  assert.equal(done.actionTrace?.tool, "query-graphify", "assert.equal(done.actionTrace?.tool, \"query-graphify\")"); assert.equal(done.actionTrace?.executed, true, "assert.equal(done.actionTrace?.executed, true)");
  assert.equal(done.source, "fallback", "assert.equal(done.source, \"fallback\")"); assert.equal(calls, 1, "assert.equal(calls, 1)");
  assert.ok(done.text.startsWith("Graphify durumu salt okunur incelendi."), "assert.ok(done.text.startsWith(\"Graphify durumu salt okunur incelendi.\"))"); assert.ok(done.text.includes("Yapısal durum:"), "assert.ok(done.text.includes(\"Yapısal durum:\"))");
  assert.ok(!done.text.includes("Graphify tam ve güncel"), "assert.ok(!done.text.includes(\"Graphify tam ve güncel\"))");
  assert.equal(events.filter(event => event.type === "delta").map(event => event.type === "delta" ? event.text : "").join(""), done.text, "assert.equal(events.filter(event => event.type === \"delta\").map(event => event.type === \"delta\" ? event.text : \"\").join(\"\"), done.text)");
  count++;
  const history = [{ role: "user" as const, text: positive[0]! }, { role: "brain" as const, text: done.text }];
  const checkFollowup = async (text: string, answer: string) => {
    let modelCalls = 0;
    const followupProvider: AyasModelProvider = { ...provider,
      async chat() { modelCalls++; return { finishReason: "stop", text: answer }; },
      async *stream() { modelCalls++; yield { type: "delta", text: answer }; yield { type: "done", text: answer, finishReason: "stop" }; } };
    const followup: AyasChatStreamEvent[] = [];
    for await (const event of streamAyasChat({ text, seq: count, snapshot, history,
      env: { NODE_ENV: "test", AYAS_CONVERSATION_V2: "1", OLLAMA_NUM_CTX: "8192" },
      route: { provider: followupProvider, decision: { complexity: "SIMPLE", providerId: "ollama", providerKind: "local", model: "fixture", reason: "fixture" } },
      memoryStore: { rootDir: path.join(root, "followup-memory") } })) followup.push(event);
    const result = followup.find(event => event.type === "done"); assert.ok(result?.type === "done", "assert.ok(result?.type === \"done\")");
    return { result, modelCalls };
  };
  const math = await checkFollowup("37 ile 48 toplam kaç eder? Kısa Türkçe cevap ver.", "85 eder.");
  assert.equal(math.result.text, "85 eder.", "assert.equal(math.result.text, \"85 eder.\")"); assert.equal(math.result.source, "llm", "assert.equal(math.result.source, \"llm\")"); assert.equal(math.modelCalls, 1, "assert.equal(math.modelCalls, 1)"); count++;
  const ownerConstraint = await checkFollowup("Salt okunur kal. 37 ile 48 toplam kaç eder?", "85 eder.");
  assert.equal(ownerConstraint.result.reason, "read-only-constraint", "assert.equal(ownerConstraint.result.reason, \"read-only-constraint\")"); assert.equal(ownerConstraint.result.source, "fallback", "assert.equal(ownerConstraint.result.source, \"fallback\")"); count++;
  const mutation = await checkFollowup("Bu kod için kısa öneri ver.", "Dosyayı değiştir, gerekli düzenlemeleri yap.");
  assert.equal(mutation.result.reason, "execution-claim", "assert.equal(mutation.result.reason, \"execution-claim\")"); assert.equal(mutation.result.source, "fallback", "assert.equal(mutation.result.source, \"fallback\")"); count++;
  console.log(`AYAS Graphify state chat smoke: PASS (${count} scenarios)`);
}
streamTruth().catch(error => { console.error(error); process.exitCode = 1; });
