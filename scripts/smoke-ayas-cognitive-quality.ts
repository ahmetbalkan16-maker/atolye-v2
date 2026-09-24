/**
 * Deterministic AYAS cognitive quality baseline. No provider, network, or live
 * storage is used. Each metric names an observable contract; prompt/guard
 * checks do not claim to measure an uncalled language model's prose quality.
 *
 * Run against the trusted pre-remediation archive before changing production.
 * --baseline reports failures without gating; --report accepts only an OS-TEMP
 * JSON path. The default command exits nonzero for any failed non-limit case.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildBrainMemoryRecord } from "../src/lib/brain/BrainMemoryModel";
import { buildAyasChatPrompt, ayasReplyClaimsExecution } from "../src/components/brain/brainCore";
import { resolveAyasPreReasoningIntent } from "../src/lib/ayas/AyasIntentRouting";
import { resolveDeterministicToolCandidate, streamAyasChat } from "../src/lib/ayas/AyasChatStream";
import { assembleAyasContext } from "../src/lib/ayas/context/AyasContextAssembly";
import { compressAyasHistory } from "../src/lib/ayas/context/AyasContextCompression";
import { detectAyasMemoryTemporalQuery } from "../src/lib/ayas/memory/AyasMemoryTemporal";
import { retrieveAyasMemory } from "../src/lib/ayas/memory/AyasMemoryRetrieval";
import { extractAyasMemoryCandidates } from "../src/lib/ayas/memory/AyasMemoryCandidate";
import { scoreAyasMemoryCandidate } from "../src/lib/ayas/memory/AyasMemoryGovernance";
import { persistAyasMemoryFromTurn } from "../src/lib/ayas/memory/AyasMemoryRecall";
import { createAyasMemoryStore } from "../src/lib/ayas/memory/AyasMemoryStore";
import { parseAyasReasoningOutput } from "../src/lib/ayas/reasoning/AyasReasoningParser";
import { runAyasReasoning } from "../src/lib/ayas/reasoning/AyasReasoningCore";
import { AYAS_RETRIEVAL_EVALUATION_CASES } from "./fixtures/ayas-retrieval-evaluation-cases";
import { createAyasRetrievalRunRoot, evaluateAyasRetrievalCase, removeAyasRetrievalRunRoot, withAyasRetrievalNetworkGuard } from "./lib/AyasRetrievalEvaluation";
import type { AyasModelProvider } from "../src/lib/ayas/model/AyasModelTypes";
import type { AyasModelRoute } from "../src/lib/ayas/model/AyasModelRouter";
import { routeAyasModel } from "../src/lib/ayas/model/AyasModelRouter";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";

type Turn = { role: "user" | "brain"; text: string };
type Dimension =
  | "INTENT_ACCURACY" | "CONTEXT_CONTINUITY" | "REFERENCE_RESOLUTION"
  | "MEMORY_RELEVANCE" | "TEMPORAL_CORRECTNESS" | "RETRIEVAL_USEFULNESS"
  | "STALE_CONTEXT_LEAKAGE" | "CLARIFICATION_QUALITY" | "REASONING_CONSISTENCY"
  | "ANSWER_RELEVANCE" | "ANSWER_COMPLETENESS" | "INSTRUCTION_FOLLOWING"
  | "TURKISH_NATURALNESS" | "CONTRADICTION_AVOIDANCE" | "UNCERTAINTY_CALIBRATION"
  | "TOOL_DECISION_CORRECTNESS" | "VERBOSITY_CALIBRATION";
type Category =
  | "INTENT_MISCLASSIFIED" | "CONTEXT_DROPPED" | "REFERENT_UNRESOLVED"
  | "WRONG_REFERENT" | "RELEVANT_MEMORY_MISSED" | "STALE_MEMORY_USED"
  | "HISTORICAL_CURRENT_CONFUSION" | "REQUIRED_CLARIFICATION_MISSED"
  | "UNNECESSARY_CLARIFICATION" | "ANSWER_OFF_TOPIC" | "ANSWER_INCOMPLETE"
  | "USER_CONSTRAINT_MISSED" | "TURKISH_NUANCE_LOSS" | "CONTRADICTION"
  | "UNSUPPORTED_CERTAINTY" | "TOOL_USED_UNNECESSARILY" | "REQUIRED_TOOL_NOT_USED"
  | "ANSWER_OVERLONG" | "ANSWER_TOO_SHORT" | "TEMPORARY_FACT_PERSISTED";
interface Probe {
  readonly id: string;
  readonly dimension: Dimension;
  readonly category: Category;
  readonly heldOut?: true;
  /** A measured pre-existing debt, reviewed separately from regression failures. */
  readonly knownLimitation?: true;
  readonly layer: "decision" | "context" | "prompt" | "guard";
  readonly run: () => boolean | Promise<boolean>;
}
const COMPONENT_BY_DIMENSION: Readonly<Record<Dimension, string>> = {
  INTENT_ACCURACY: "AyasIntentRouting", CONTEXT_CONTINUITY: "AyasContextCompression/AyasConversationState",
  REFERENCE_RESOLUTION: "AyasReferenceResolver", MEMORY_RELEVANCE: "AyasMemoryRetrieval",
  TEMPORAL_CORRECTNESS: "AyasMemoryTemporal", RETRIEVAL_USEFULNESS: "AyasMemoryRetrieval",
  STALE_CONTEXT_LEAKAGE: "AyasMemoryRetrieval/AyasContextAssembly",
  CLARIFICATION_QUALITY: "AyasReferenceResolver/AyasChatStream",
  REASONING_CONSISTENCY: "AyasReasoningParser", ANSWER_RELEVANCE: "AyasChatStream",
  ANSWER_COMPLETENESS: "AyasChatStream", INSTRUCTION_FOLLOWING: "AyasChatStream",
  TURKISH_NATURALNESS: "AyasChatStream", CONTRADICTION_AVOIDANCE: "AyasChatStream",
  UNCERTAINTY_CALIBRATION: "AyasChatStream/AyasModelRouter",
  TOOL_DECISION_CORRECTNESS: "AyasChatStream", VERBOSITY_CALIBRATION: "AyasChatStream",
};
const BOUNDED_IMPROVEMENT: Readonly<Record<Category, string>> = {
  INTENT_MISCLASSIFIED: "Niyet önceliğini dar bir kural ve negatif vakayla incele.",
  CONTEXT_DROPPED: "Bağlam özetleme veya durum projeksiyonunda yeni bilgiyi koru.",
  REFERENT_UNRESOLVED: "Tekil referansı çözümle veya belirsizlikte soru sor.",
  WRONG_REFERENT: "Seçenek eşlemesini ve düzeltme önceliğini incele.",
  RELEVANT_MEMORY_MISSED: "Hafıza seçimi ile istem bağlamına teslimi ayrı ölç.",
  STALE_MEMORY_USED: "Zamansal ve güncellik filtresini dar bir vakayla incele.",
  HISTORICAL_CURRENT_CONFUSION: "Tarihsel sorgunun zaman kipini açıkça koru.",
  REQUIRED_CLARIFICATION_MISSED: "Maddi belirsizlikte kısa netleştirme ekle.",
  UNNECESSARY_CLARIFICATION: "Yeterli bağlamda doğrudan yanıtı koru.",
  ANSWER_OFF_TOPIC: "Son kullanıcı isteğinin yanıt denetimini incele.",
  ANSWER_INCOMPLETE: "Gerekli bilgi ve bölüm teslimini dar kapsamda denetle.",
  USER_CONSTRAINT_MISSED: "Açık biçim veya kısıtın isteme teslimini incele.",
  TURKISH_NUANCE_LOSS: "Türkçe kip ve gönderim çözümünü genellenebilir vakayla incele.",
  CONTRADICTION: "Yanıt güvenlik ve tutarlılık denetimini incele.",
  UNSUPPORTED_CERTAINTY: "Sağlayıcı yokluğu ve bilinmeyen bilgi yanıtını dürüst tut.",
  TOOL_USED_UNNECESSARILY: "Araç adayının olumlu ve olumsuz sinyallerini ayır.",
  REQUIRED_TOOL_NOT_USED: "Mevcut izinli araç adayının karar yolunu incele.",
  ANSWER_OVERLONG: "Açık kısalık isteğini yanıt biçimine taşı.",
  ANSWER_TOO_SHORT: "Açık ayrıntı isteğini yanıt biçimine taşı.",
  TEMPORARY_FACT_PERSISTED: "Açıkça geçici kapsamlı bir isteğin kalıcı hafızaya yazılmasını durdur.",
};
const NOW = "2026-09-24T12:00:00.000Z";
const FIXTURE_VERSION = 1;
const h = (...turns: [Turn["role"], string][]): Turn[] => turns.map(([role, text]) => ({ role, text }));
const context = (text: string, history: readonly Turn[] = []) => assembleAyasContext({ userText: text, history });
const memory = (body: string, observedAt = NOW, tags: string[] = ["tercih"]) => buildBrainMemoryRecord({
  kind: "user-preference", title: "Kullanıcı bilgisi", body, importance: "durable",
  confidence: "reported", tags, observedAt, links: [],
});
const snapshot: BrainConsoleSnapshot = {
  generatedAt: NOW, executionGate: "CLOSED",
  connected: { tasks: false, cycles: false, experience: false }, errors: [],
  tasks: { total: 0, byStatus: { queued: 0, running: 0, "blocked-on-dependency": 0,
    "blocked-on-approval": 0, succeeded: 0, failed: 0, cancelled: 0, "skipped-unsafe": 0 },
    pendingApproval: 0, skippedUnsafe: 0, items: [] },
  cyclesRecorded: 0, experience: { total: 0 },
  safety: { decision: "proceed-with-constraints", snapshotSource: "unavailable", reasons: [], hardwareProfileId: "gtx-1650-4gb" },
};
function prompt(text: string, history: readonly Turn[] = []): string {
  const ctx = context(text, history);
  return buildAyasChatPrompt({ userText: text, snapshot, history: ctx.recentHistory,
    conversation: ctx.block, complexity: "SIMPLE", format: "text" });
}
async function streamWithFakeProvider(text: string, replies: string | readonly [string, string], history: readonly Turn[] = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-cognitive-memory-"));
  const canonicalTemp = fs.realpathSync(os.tmpdir());
  assert.ok(root.startsWith(canonicalTemp + path.sep));
  const prompts: string[] = [];
  const initial = typeof replies === "string" ? replies : replies[0];
  const correction = typeof replies === "string" ? replies : replies[1];
  const provider: AyasModelProvider = {
    id: "ollama", kind: "local", model: "deterministic-fixture", configured: true,
    async health() { return { available: true, detail: "fixture", checkedAtMs: 0 }; },
    async chat(req) { prompts.push(req.prompt); return { text: correction, finishReason: "stop" }; },
    async *stream(req) { prompts.push(req.prompt); yield { type: "delta" as const, text: initial }; yield { type: "done" as const, text: initial, finishReason: "stop" }; },
  };
  const route: AyasModelRoute = { provider, decision: { complexity: "SIMPLE", providerId: "ollama", providerKind: "local", model: provider.model, reason: "fixture" } };
  try {
    const events = [];
    for await (const event of streamAyasChat({ text, snapshot, history, seq: 1, route,
      memoryStore: { rootDir: root }, env: { NODE_ENV: "test" }, fetcher: (async () => { throw new Error("network disabled"); }) as typeof fetch })) {
      events.push(event);
    }
    return { done: events.findLast((event) => event.type === "done"), prompts };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
async function reasonWithFakeProvider(answer: string) {
  const provider: AyasModelProvider = {
    id: "ollama", kind: "local", model: "deterministic-fixture", configured: true,
    async health() { return { available: true, detail: "fixture", checkedAtMs: 0 }; },
    async chat() { return { text: JSON.stringify({
      intent: "iki riski açıklamak", goal: "güvenli öneri sunmak",
      constraints: ["dosyalara dokunma"], assumptions: [],
      plan: ["önce iki riski sırala", "sonra öneriyi açıkla"],
      requiredTools: [], risk: "düşük", verification: ["kullanıcı doğrulasın"], answer,
    }), finishReason: "stop" }; },
    async *stream() { throw new Error("reasoning must not stream"); },
  };
  return runAyasReasoning({ userText: "Önce iki riski sırala, sonra öneriyi açıkla; dosyalara dokunma.",
    complexity: "COMPLEX", provider });
}
async function noProviderResult(): Promise<boolean> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-cognitive-no-provider-"));
  assert.ok(root.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
  const route: AyasModelRoute = { provider: null, decision: {
    complexity: "NORMAL", providerId: null, providerKind: null, model: null,
    reason: "no-provider", unavailableMessage: "Yerel model kullanılamıyor.",
  } };
  try {
    const events = [];
    for await (const event of streamAyasChat({ text: "Bir açıklama yap.", snapshot, seq: 1,
      route, memoryStore: { rootDir: root }, env: { NODE_ENV: "test" },
      fetcher: (async () => { throw new Error("network disabled"); }) as typeof fetch })) events.push(event);
    const done = events.findLast((event) => event.type === "done");
    return done?.type === "done" && done.source === "fallback" && done.text === "Yerel model kullanılamıyor.";
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
async function freeTextStaleExcluded(caseId: string): Promise<boolean> {
  const testCase = AYAS_RETRIEVAL_EVALUATION_CASES.find((item) => item.id === caseId);
  assert.ok(testCase, `missing retrieval fixture ${caseId}`);
  const root = createAyasRetrievalRunRoot("cognitive");
  try {
    const { value, networkAttempts } = await withAyasRetrievalNetworkGuard(() => evaluateAyasRetrievalCase(testCase, root));
    assert.equal(networkAttempts, 0, "retrieval fixture attempted network access");
    assert.ok(Object.values(value.forbiddenLabels).includes("stale-free-text"), "fixture no longer labels free-text debt");
    assert.ok(value.chatContext, "retrieval fixture did not reach the chat context layer");
    return !value.forbiddenSelected.some((item) => item.reason === "stale-free-text")
      && !value.chatContext.forbidden.some((item) => item.reason === "stale-free-text");
  } finally {
    removeAyasRetrievalRunRoot(root);
  }
}
function longCorrectionHistory(): Turn[] {
  const turns: Turn[] = h(["user", "Görsel palet bronz olacak."], ["brain", "Not ettim."]);
  for (let i = 0; i < 18; i++) turns.push(...h(["user", `Sahne ${i} için ayrıntılı kompozisyon ve kamera hareketi üzerine konuşalım.`], ["brain", `Sahne ${i} için kompozisyon notları hazır.`]));
  turns.push(...h(["user", "Düzeltme: görsel palet artık yeşil olacak, bronz olmayacak."], ["brain", "Yeşil paleti not ettim."]));
  for (let i = 18; i < 25; i++) turns.push(...h(["user", `Sahne ${i} için ayrıntılı kompozisyon ve kamera hareketi üzerine konuşalım.`], ["brain", `Sahne ${i} için kompozisyon notları hazır.`]));
  return turns;
}
const correctionHistory = longCorrectionHistory();
function isHistoricalQuery(text: string): boolean {
  const query = detectAyasMemoryTemporalQuery(text, NOW);
  return query.mode === "as-of" || (query.mode === "current" && query.includeHistory === true);
}
function temporaryMemoryRejected(text: string): boolean {
  const candidates = extractAyasMemoryCandidates({ userText: text, ayasReply: "Anladım." });
  return candidates.length > 0 && candidates.every((candidate) => !scoreAyasMemoryCandidate(candidate).store);
}
async function temporaryMemoryNotPersisted(text: string): Promise<boolean> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-cognitive-temporary-"));
  assert.ok(root.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
  try {
    const outcome = await persistAyasMemoryFromTurn({ userText: text, ayasReply: "Anladım.", nowIso: NOW, store: { rootDir: root } });
    return outcome.candidates > 0 && outcome.stored === 0 && outcome.rejected === outcome.candidates
      && createAyasMemoryStore({ rootDir: root }).load().length === 0;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const probes: readonly Probe[] = [
  { id: "intent-repair", dimension: "INTENT_ACCURACY", category: "INTENT_MISCLASSIFIED", layer: "decision", run: () => resolveAyasPreReasoningIntent("Bu özellik çalışmıyor").kind === "guided-repair" },
  { id: "intent-report", dimension: "INTENT_ACCURACY", category: "INTENT_MISCLASSIFIED", layer: "decision", run: () => resolveAyasPreReasoningIntent("Bug raporunu göster").kind === "report-center" },
  { id: "intent-today", dimension: "INTENT_ACCURACY", category: "INTENT_MISCLASSIFIED", layer: "decision", run: () => resolveAyasPreReasoningIntent("Bugünü raporla").kind === "reasoning" },
  { id: "context-topic", dimension: "CONTEXT_CONTINUITY", category: "CONTEXT_DROPPED", layer: "context", run: () => /thumbnail/i.test(context("Devam et", h(["user", "Ses tasarımını konuşalım."], ["brain", "Tamam."], ["user", "Şimdi thumbnail tarafını konuşalım."], ["brain", "Başlıkla devam edelim."])).trace.activeTopic ?? "") },
  { id: "context-old-correction", dimension: "CONTEXT_CONTINUITY", category: "CONTEXT_DROPPED", layer: "context", run: () => {
    const c = compressAyasHistory(correctionHistory);
    return c.droppedTurns > 0 && /yeşil/i.test(c.summary.join(" "));
  } },
  { id: "context-selected-option", dimension: "CONTEXT_CONTINUITY", category: "CONTEXT_DROPPED", layer: "context", run: () => /ayrintili anlatim/i.test(context("Devam et", h(["brain", "İki seçenek var: kısa anlatım ve ayrıntılı anlatım."], ["user", "İkincisini seçiyorum."], ["brain", "Ayrıntılı anlatımla devam edelim."])).trace.selectedOption ?? "") },
  { id: "context-temporary-constraint", dimension: "CONTEXT_CONTINUITY", category: "USER_CONSTRAINT_MISSED", layer: "context", run: () => /thumbnail/i.test(context("Bunun dışında başlığı öner.", h(["user", "Şimdilik thumbnail'e dokunma."], ["brain", "Tamam, dokunmam."], ["user", "Video başlığını konuşalım."], ["brain", "Başlık seçenekleri hazırlayabilirim."])).block.stateLines?.join(" ") ?? "") },
  { id: "context-explicit-correction", dimension: "CONTEXT_CONTINUITY", category: "CONTEXT_DROPPED", layer: "context", run: () => /thumbnail/i.test(context("Devam et.", h(["user", "Önce ses tasarımını konuşalım."], ["brain", "Sesle başlayalım."], ["user", "Hayır, thumbnail tarafını konuşalım."], ["brain", "Thumbnail ile devam edelim."])).trace.activeTopic ?? "") },
  { id: "reference-pronoun", dimension: "REFERENCE_RESOLUTION", category: "REFERENT_UNRESOLVED", layer: "context", run: () => /giriş metnini/i.test(context("Buna kapanış ekle.", h(["user", "Giriş metnini sadeleştir."], ["brain", "Giriş metnini sadeleştirdim."])).resolvedReferents.join(" ")) },
  { id: "reference-alternative", dimension: "REFERENCE_RESOLUTION", category: "WRONG_REFERENT", layer: "context", run: () => /ayrintili anlatim/i.test(context("Bunu değil diğerini seç.", h(["brain", "İki seçenek var: kısa anlatım ve ayrıntılı anlatım."], ["user", "İlkini seçelim."], ["brain", "Kısa anlatımı seçtim."])).resolvedReferents.join(" ")) },
  { id: "memory-overridden", dimension: "MEMORY_RELEVANCE", category: "STALE_MEMORY_USED", layer: "decision", run: () => retrieveAyasMemory([memory("cevapları kısa tut")], "Bu sefer uzun anlat.", { nowIso: NOW }).selected.length === 0 },
  { id: "memory-unrelated", dimension: "MEMORY_RELEVANCE", category: "STALE_MEMORY_USED", layer: "decision", run: () => retrieveAyasMemory([memory("cevapları kısa tut")], "İstanbul ne zaman kuruldu?", { nowIso: NOW }).selected.length === 0 },
  { id: "temporal-past", dimension: "TEMPORAL_CORRECTNESS", category: "HISTORICAL_CURRENT_CONFUSION", layer: "decision", run: () => isHistoricalQuery("Eskiden adım neydi?") },
  { id: "temporal-now", dimension: "TEMPORAL_CORRECTNESS", category: "HISTORICAL_CURRENT_CONFUSION", layer: "decision", run: () => detectAyasMemoryTemporalQuery("Şu anda adım ne?", NOW).mode === "current" },
  { id: "temporal-temporary-preference", dimension: "TEMPORAL_CORRECTNESS", category: "TEMPORARY_FACT_PERSISTED", layer: "decision", run: () => temporaryMemoryRejected("Şimdilik kısa cevapları tercih ederim.") },
  { id: "temporal-this-turn-preference", dimension: "TEMPORAL_CORRECTNESS", category: "TEMPORARY_FACT_PERSISTED", layer: "decision", run: () => temporaryMemoryRejected("Bu sefer kısa cevapları tercih ederim.") },
  { id: "temporal-durable-control", dimension: "TEMPORAL_CORRECTNESS", category: "HISTORICAL_CURRENT_CONFUSION", layer: "decision", run: () => {
    const candidates = extractAyasMemoryCandidates({ userText: "Bundan sonra kısa cevapları tercih ederim.", ayasReply: "Anladım." });
    return candidates.length > 0 && candidates.every((candidate) => scoreAyasMemoryCandidate(candidate).store);
  } },
  { id: "temporal-temporary-write", dimension: "TEMPORAL_CORRECTNESS", category: "TEMPORARY_FACT_PERSISTED", layer: "guard", run: () => temporaryMemoryNotPersisted("Şimdilik kısa cevapları tercih ederim.") },
  { id: "retrieval-identity", dimension: "RETRIEVAL_USEFULNESS", category: "RELEVANT_MEMORY_MISSED", layer: "decision", run: () => retrieveAyasMemory([memory("beni Eylül olarak hatırla", NOW, ["kimlik"])], "Adım ne?", { nowIso: NOW }).selected.some((x) => /Eylül/.test(x.record.body)) },
  { id: "stale-project", dimension: "STALE_CONTEXT_LEAKAGE", category: "STALE_MEMORY_USED", layer: "decision", run: () => retrieveAyasMemory([memory("aktif proje eski-belgesel", "2025-01-01T00:00:00.000Z")], "aktif projem ne", { nowIso: NOW }).selected.length === 0 },
  { id: "stale-opt-out", dimension: "STALE_CONTEXT_LEAKAGE", category: "CONTEXT_DROPPED", layer: "context", run: () => context("Önceki bağlamı kullanma; renk teorisini anlat.", h(["user", "Render ayarlarını konuşalım."], ["brain", "Bitrate ile başlayalım."])).resolvedReferents.length === 0 },
  { id: "stale-free-text-seed", dimension: "STALE_CONTEXT_LEAKAGE", category: "STALE_MEMORY_USED", knownLimitation: true, layer: "decision", run: () => freeTextStaleExcluded("seed:project-decision-free-text") },
  { id: "clarify-required", dimension: "CLARIFICATION_QUALITY", category: "REQUIRED_CLARIFICATION_MISSED", layer: "decision", run: () => Boolean(context("Bunu yap.").clarification) },
  { id: "clarify-not-needed", dimension: "CLARIFICATION_QUALITY", category: "UNNECESSARY_CLARIFICATION", layer: "decision", run: () => context("Metni 120 kelimeye indir.").clarification === null },
  { id: "reasoning-malformed", dimension: "REASONING_CONSISTENCY", category: "CONTRADICTION", layer: "guard", run: () => !parseAyasReasoningOutput("{bad", "COMPLEX").ok },
  { id: "reasoning-sequence", dimension: "REASONING_CONSISTENCY", category: "CONTRADICTION", layer: "guard", run: async () => {
    const result = await reasonWithFakeProvider("İlk risk gecikmedir; ikinci risk tutarsızlıktır. Önce ölçüm yapmayı öneririm; dosyalara dokunmayacağım.");
    return result.ok && result.result.plan[0]?.startsWith("önce") === true && result.result.plan[1]?.startsWith("sonra") === true
      && result.result.constraints.includes("dosyalara dokunma") && /ilk risk|ikinci risk/i.test(result.result.answer);
  } },
  { id: "reasoning-write-claim", dimension: "REASONING_CONSISTENCY", category: "CONTRADICTION", layer: "guard", run: async () => {
    const result = await reasonWithFakeProvider("Dosyaları değiştirdim ve öneriyi uyguladım.");
    return !result.ok && result.reason === "reasoning-execution-claim";
  } },
  { id: "answer-topic", dimension: "ANSWER_RELEVANCE", category: "ANSWER_OFF_TOPIC", layer: "prompt", run: () => prompt("Sahnenin ışığını açıkla.").includes("Sahnenin ışığını açıkla.") },
  { id: "answer-off-topic-retry", dimension: "ANSWER_RELEVANCE", category: "ANSWER_OFF_TOPIC", layer: "guard", run: async () => {
    const result = await streamWithFakeProvider("Sahnedeki ana ışığı açıkla.", ["Merhaba, nasıl yardımcı olabilirim?", "Ana ışık sahnedeki konuyu öne çıkarır."]);
    return result.done?.type === "done" && result.done.source === "llm" && /Ana ışık/.test(result.done.text)
      && result.done.correctionAttempts === 1;
  } },
  { id: "answer-multipart", dimension: "ANSWER_COMPLETENESS", category: "ANSWER_INCOMPLETE", layer: "prompt", run: () => prompt("İki başlık öner ve her birinin nedenini açıkla.").includes("İki başlık öner ve her birinin nedenini açıkla.") },
  { id: "answer-final-two-facts", dimension: "ANSWER_COMPLETENESS", category: "ANSWER_INCOMPLETE", layer: "guard", run: async () => {
    const result = await streamWithFakeProvider("Işık düzenini iki cümleyle açıkla.", "Ana ışık konuyu öne çıkarır. Dolgu ışığı gölgeleri yumuşatır.");
    return result.done?.type === "done" && /Ana ışık/.test(result.done.text) && /Dolgu ışığı/.test(result.done.text);
  } },
  { id: "instruction-format", dimension: "INSTRUCTION_FOLLOWING", category: "USER_CONSTRAINT_MISSED", layer: "prompt", run: () => prompt("Yanıtı üç maddeyle ver, tablo kullanma.").includes("Yanıtı üç maddeyle ver, tablo kullanma.") },
  { id: "instruction-read-only-final", dimension: "INSTRUCTION_FOLLOWING", category: "USER_CONSTRAINT_MISSED", layer: "guard", run: async () => {
    const result = await streamWithFakeProvider("Sadece yöntemi açıkla, dosyalara dokunma.", ["Dosyaları değiştirdim ve yöntemi uyguladım.", "Yalnızca yöntemi açıklayacağım; dosyaları değiştirmeyeceğim."]);
    return result.done?.type === "done" && result.done.source === "llm" && !/değiştirdim|uyguladım/i.test(result.done.text);
  } },
  { id: "instruction-format-final", dimension: "INSTRUCTION_FOLLOWING", category: "USER_CONSTRAINT_MISSED", layer: "guard", run: async () => {
    const result = await streamWithFakeProvider("Üç kısa maddeyle ışık önerisi ver.", "- Ana ışığı ayarla.\n- Dolgu ışığını azalt.\n- Arka ışığı dengele.");
    return result.done?.type === "done" && result.done.source === "llm" && result.done.text.split("\n").filter((line) => line.startsWith("- ")).length === 3;
  } },
  { id: "turkish-colloquial", dimension: "TURKISH_NATURALNESS", category: "TURKISH_NUANCE_LOSS", layer: "context", run: () => context("simdi ne yapcaz", h(["user", "Ses temizliğini bitirdik."], ["brain", "Sırada miks kontrolü var."])).trace.resolvedReferences > 0 },
  { id: "turkish-script-final", dimension: "TURKISH_NATURALNESS", category: "TURKISH_NUANCE_LOSS", layer: "guard", run: async () => {
    const result = await streamWithFakeProvider("Işık düzenini açıkla.", ["这是无关的回答。", "Ana ışık konuyu aydınlatır; dolgu ışığı gölgeleri dengeler."]);
    return result.done?.type === "done" && result.done.source === "llm" && !/\p{Script=Han}/u.test(result.done.text);
  } },
  { id: "contradiction-execution", dimension: "CONTRADICTION_AVOIDANCE", category: "CONTRADICTION", layer: "guard", run: () => ayasReplyClaimsExecution("Pipeline'ı çalıştırdım ve dosyaları değiştirdim.") },
  { id: "contradiction-file-write-claim", dimension: "CONTRADICTION_AVOIDANCE", category: "CONTRADICTION", layer: "guard", run: () => ayasReplyClaimsExecution("Dosyaları değiştirdim.") },
  { id: "contradiction-negated-file-write", dimension: "CONTRADICTION_AVOIDANCE", category: "CONTRADICTION", layer: "guard", run: () => !ayasReplyClaimsExecution("Dosyaları değiştirmedim; yalnızca öneri sundum.") },
  { id: "contradiction-final-guard", dimension: "CONTRADICTION_AVOIDANCE", category: "CONTRADICTION", layer: "guard", run: async () => {
    const result = await streamWithFakeProvider("Işık düzeni nasıl?", "Pipeline'ı çalıştırdım ve dosyaları değiştirdim.");
    return result.done?.type === "done" && !/çalıştırdım|değiştirdim/i.test(result.done.text);
  } },
  { id: "uncertainty-unknown", dimension: "UNCERTAINTY_CALIBRATION", category: "UNSUPPORTED_CERTAINTY", layer: "prompt", run: () => /Bilmediğin[^\n]+uydurma/i.test(prompt("Bu özel sistemin seri numarası ne?")) },
  { id: "uncertainty-identity-echo", dimension: "UNCERTAINTY_CALIBRATION", category: "UNSUPPORTED_CERTAINTY", layer: "guard", run: async () => {
    const result = await streamWithFakeProvider("Adım ne?", "Adın ne.");
    return result.done?.type === "done" && result.done.source === "fallback" && /bilmiyorum/i.test(result.done.text);
  } },
  { id: "uncertainty-no-provider", dimension: "UNCERTAINTY_CALIBRATION", category: "UNSUPPORTED_CERTAINTY", layer: "guard", run: noProviderResult },
  { id: "uncertainty-no-paid-fallback", dimension: "UNCERTAINTY_CALIBRATION", category: "UNSUPPORTED_CERTAINTY", layer: "decision", run: async () => {
    const unavailable: AyasModelProvider = { id: "ollama", kind: "local", model: "fixture", configured: true,
      async health() { return { available: false, detail: "fixture-down", checkedAtMs: 0 }; },
      async chat() { throw new Error("model disabled"); }, async *stream() { throw new Error("model disabled"); } };
    const cloud: AyasModelProvider = { ...unavailable, id: "cloud", kind: "cloud", configured: true,
      async health() { throw new Error("cloud health must not be called"); } };
    const route = await routeAyasModel({ text: "Açıkla.", env: { NODE_ENV: "test" }, providers: { ollama: unavailable, cloud } });
    return route.provider === null && route.decision.providerId === null;
  } },
  { id: "tool-required", dimension: "TOOL_DECISION_CORRECTNESS", category: "REQUIRED_TOOL_NOT_USED", layer: "decision", run: () => resolveDeterministicToolCandidate("Checkpoint'e bak.")?.action === "read-project-document" },
  { id: "tool-not-required", dimension: "TOOL_DECISION_CORRECTNESS", category: "TOOL_USED_UNNECESSARILY", layer: "decision", run: () => resolveDeterministicToolCandidate("Kısa bir şiir yaz.") === null },
  { id: "verbosity-short", dimension: "VERBOSITY_CALIBRATION", category: "ANSWER_OVERLONG", layer: "prompt", run: () => prompt("Kısa söyle: ışık neden yetersiz?").includes("Kısa söyle: ışık neden yetersiz?") },
  { id: "verbosity-detail", dimension: "VERBOSITY_CALIBRATION", category: "ANSWER_TOO_SHORT", layer: "prompt", run: () => prompt("Ayrıntılı teknik açıklama ver: ışık dağılımı nasıl çalışır?").includes("Ayrıntılı teknik açıklama ver: ışık dağılımı nasıl çalışır?") },
  { id: "verbosity-short-final", dimension: "VERBOSITY_CALIBRATION", category: "ANSWER_OVERLONG", layer: "guard", run: async () => {
    const result = await streamWithFakeProvider("Kısa söyle: dolgu ışığı ne yapar?", "Dolgu ışığı sert gölgeleri yumuşatır.");
    return result.done?.type === "done" && result.done.source === "llm" && result.done.text.length < 100;
  } },
  { id: "verbosity-detail-final", dimension: "VERBOSITY_CALIBRATION", category: "ANSWER_TOO_SHORT", layer: "guard", run: async () => {
    const result = await streamWithFakeProvider("Ayrıntılı açıkla: ışık düzeni nasıl çalışır?", "Ana ışık konuyu belirginleştirir. Dolgu ışığı gölgeleri dengeler. Arka ışık konuyu arka plandan ayırır.");
    return result.done?.type === "done" && result.done.source === "llm" && result.done.text.length > 80;
  } },
  { id: "heldout-pronoun", dimension: "REFERENCE_RESOLUTION", category: "REFERENT_UNRESOLVED", heldOut: true, layer: "context", run: () => /ses tasarımını/i.test(context("Onu da sadeleştir.", h(["user", "Ses tasarımını üç cümleye indir."], ["brain", "Ses tasarımını kısalttım."])).resolvedReferents.join(" ")) },
  { id: "heldout-temporal", dimension: "TEMPORAL_CORRECTNESS", category: "HISTORICAL_CURRENT_CONFUSION", heldOut: true, layer: "decision", run: () => isHistoricalQuery("Eskiden nasıl hitap ediyordum?") },
  { id: "heldout-ambiguous", dimension: "CLARIFICATION_QUALITY", category: "REQUIRED_CLARIFICATION_MISSED", heldOut: true, layer: "decision", run: () => Boolean(context("İkincisini seç.").clarification) },
  { id: "heldout-free-text", dimension: "STALE_CONTEXT_LEAKAGE", category: "STALE_MEMORY_USED", heldOut: true, knownLimitation: true, layer: "decision", run: () => freeTextStaleExcluded("heldout-pc-switch") },
  { id: "heldout-format", dimension: "INSTRUCTION_FOLLOWING", category: "USER_CONSTRAINT_MISSED", heldOut: true, layer: "prompt", run: () => prompt("Yanıtı kısa bir tablo yerine üç cümlede ver.").includes("Yanıtı kısa bir tablo yerine üç cümlede ver.") },
];

function reportPath(): string | null {
  const i = process.argv.indexOf("--report");
  if (i < 0) return null;
  const value = process.argv[i + 1];
  assert.ok(value, "--report requires an OS-TEMP JSON file path");
  const resolved = path.resolve(value);
  const root = fs.realpathSync(os.tmpdir());
  const parent = fs.realpathSync(path.dirname(resolved));
  assert.ok((parent === root || parent.startsWith(root + path.sep)) && resolved.endsWith(".json"), "report must be a new JSON file under OS TEMP");
  assert.ok(!fs.existsSync(resolved), "report path must not exist");
  return resolved;
}
async function main(): Promise<void> {
  const output = reportPath();
  const rows: { id: string; dimension: Dimension; category: Category | null; heldOut: boolean; knownLimitation: boolean; layer: Probe["layer"]; pass: boolean; error: boolean }[] = [];
  for (const { id, dimension, category, heldOut, knownLimitation, layer, run } of probes) {
    let pass = false;
    let error = false;
    try { pass = await run(); } catch { error = true; }
    rows.push({ id, dimension, category: pass ? null : category, heldOut: heldOut === true, knownLimitation: knownLimitation === true, layer, pass, error });
  }
  const dimensions = Object.fromEntries([...new Set(probes.map((probe) => probe.dimension))].map((name) => {
    const subset = rows.filter((row) => row.dimension === name);
    return [name, { passed: subset.filter((row) => row.pass).length, total: subset.length }];
  }));
  const evaluatorSha256 = createHash("sha256").update(fs.readFileSync(path.join(process.cwd(), "scripts/smoke-ayas-cognitive-quality.ts"))).digest("hex");
  const failures = rows.filter((row) => !row.pass).map(({ id, dimension, category, heldOut, knownLimitation, layer, error }) => ({ id, dimension, category, heldOut, knownLimitation, layer, error }));
  const unexpectedFailures = failures.filter((failure) => !failure.knownLimitation || failure.error);
  const knownLimitations = failures.filter((failure) => failure.knownLimitation && !failure.error);
  const qualityGaps = failures.map((failure) => ({
    category: failure.category!,
    component: failure.id.includes("free-text") ? "AyasMemoryTemporal free-text representation"
      : failure.category === "TEMPORARY_FACT_PERSISTED" ? "AyasMemoryGovernance"
      : COMPONENT_BY_DIMENSION[failure.dimension],
    evidence: { caseId: failure.id, dimension: failure.dimension, layer: failure.layer },
    possibleBoundedImprovement: failure.id.includes("free-text")
      ? "Yalnızca açıkça türlenmiş kararlar için güvenli supersession tasarımını incele; keyfi serbest metni karşılıklı dışlayıcı sayma."
      : BOUNDED_IMPROVEMENT[failure.category!],
    authority: "advisory-only" as const,
  }));
  const result = { schemaVersion: 1, fixtureVersion: FIXTURE_VERSION, evaluatorSha256,
    caseCount: rows.length, passed: rows.filter((row) => row.pass).length,
    heldOut: { passed: rows.filter((row) => row.heldOut && row.pass).length, total: rows.filter((row) => row.heldOut).length },
    dimensions, failures, unexpectedFailures, knownLimitations, qualityGaps,
    layers: { decision: "real deterministic decision", context: "real context assembly", prompt: "prompt delivery only", guard: "output safety guard only" } };
  if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(result));
  if (!process.argv.includes("--baseline") && unexpectedFailures.length > 0) process.exitCode = 1;
}
void main();
