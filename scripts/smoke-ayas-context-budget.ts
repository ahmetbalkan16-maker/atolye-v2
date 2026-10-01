/** Deterministic post-freeze 15C regression: TEMP memory root only, fake transports, no model or network. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertAyasMeasuredPromptFits, budgetAyasContext, buildBudgetedAyasPrompt, estimateAyasContextLineTokens, estimateAyasContextTextTokens, estimateAyasContextTokens,
  resolveAyasContextCeiling, type AyasContextCandidate,
} from "../src/lib/ayas/context/AyasContextBudget";
import { AYAS_HISTORY_TURNS, AYAS_MAX_REPLY_TOKENS, buildAyasChatPrompt, buildBudgetedAyasChatPrompt } from "../src/components/brain/brainCore";
import { ayasRetrievalEvalSnapshot } from "./lib/AyasRetrievalEvaluation";
import { createOllamaAyasProvider } from "../src/lib/ayas/model/OllamaAyasProvider";
import { createCloudAyasProvider } from "../src/lib/ayas/model/CloudAyasProvider";
import { runAyasReasoning } from "../src/lib/ayas/reasoning/AyasReasoningCore";
import { AYAS_CONTEXT_OVERFLOW_REPLY, AYAS_CONTEXT_WINDOW_UNKNOWN_REPLY, streamAyasChat, type AyasChatStreamEvent } from "../src/lib/ayas/AyasChatStream";
import { BoundedAyasTraceStore, startAyasTrace } from "../src/lib/ayas/trace/AyasUnifiedTrace";
import { createAyasMemoryStore } from "../src/lib/ayas/memory/AyasMemoryStore";
import { buildBrainMemoryRecord } from "../src/lib/brain/BrainMemoryModel";
import type { AyasModelProvider, AyasModelRequest } from "../src/lib/ayas/model/AyasModelTypes";

let count = 0;
async function scenario(name: string, run: () => void | Promise<void>) { await run(); count++; console.log(`PASS ${count}: ${name}`); }
const candidate = (id: string, over: Partial<AyasContextCandidate> = {}): AyasContextCandidate => ({ id, class: "TRUSTED_MEMORY", trust: "TRUSTED", provenance: "MEMORY", protected: false, tokenEstimate: 100, relevance: 1, recency: 1, ...over });

/** The window this workstation runs the local chat model with, and the reply reserve of a chat turn. */
const REAL_WINDOW = 8192;
const snapshot = ayasRetrievalEvalSnapshot();
const turn = (role: "user" | "brain", text: string) => ({ role, text });
const sentence = "Mimar Sinan projesinin görsel aşaması neden başarısız oldu, açıklar mısın? ";
const base = { userText: "Bugün hangi proje takıldı?", snapshot, format: "text" as const };

/** A fake Ollama server: answers `/api/tags` and streams one reply, optionally reporting an evaluated prompt size. */
function fakeOllama(reply: string, promptEvalCount: unknown, seen: { chats: number; prompts: string[] }): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "qwen2.5:3b" }] }), { status: 200 });
    seen.chats++;
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    seen.prompts.push(body.messages.map((message) => message.content).join("\n"));
    const lines = [JSON.stringify({ message: { content: reply }, done: false }), JSON.stringify({ done: true, done_reason: "stop", ...(promptEvalCount !== undefined ? { prompt_eval_count: promptEvalCount } : {}) })];
    return new Response(lines.map((line) => `${line}\n`).join(""), { status: 200 });
  }) as unknown as typeof fetch;
}

async function chatTurn(root: string, env: NodeJS.ProcessEnv, fetcher: typeof fetch, options: { text?: string; history?: { role: "user" | "brain"; text: string }[]; trace?: ReturnType<typeof startAyasTrace> } = {}) {
  let done: Extract<AyasChatStreamEvent, { type: "done" }> | undefined;
  for await (const event of streamAyasChat({ text: options.text ?? "Kısa bir teşekkür cümlesi yazar mısın?", snapshot, seq: 1, env, fetcher, memoryStore: { rootDir: root }, ...(options.history ? { history: options.history } : {}), ...(options.trace ? { trace: options.trace } : {}) })) {
    if (event.type === "done") done = event;
  }
  assert(done, "chat turn ended without a terminal event");
  return done;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-context-budget-"));
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()), "the memory root of every chat turn below is a TEMP directory");
  try {
    await scenario("reserve output first; mandatory overflow never sheds authority", () => {
      const evidence = budgetAyasContext({ ceiling: 2048, outputReserve: 900, mandatoryTokens: 1000, candidates: [candidate("owner", { class: "SYSTEM_OWNER_SECURITY", protected: true, tokenEstimate: 149 })] });
      assert.equal(evidence.status, "CONTEXT_BUDGET_UNSAFE"); assert.equal(evidence.protectedRetained, false); assert.deepEqual(evidence.selected, []);
    });
    await scenario("protected memory outranks lexically relevant ordinary memory and external data", () => {
      const items = [candidate("poison", { class: "EXTERNAL_DATA", trust: "LOW_TRUST", provenance: "EXTERNAL", relevance: 999 }), candidate("fact", { class: "PROTECTED_MEMORY", protected: true, relevance: -1 }), candidate("trusted")];
      const evidence = budgetAyasContext({ ceiling: 2048, outputReserve: 900, mandatoryTokens: 1000, candidates: items });
      assert.deepEqual(evidence.selected, ["fact"]); assert.equal(evidence.protectedRetained, true); assert.equal(evidence.excluded.length, 2);
    });
    await scenario("quarantine excluded; low trust cannot promote itself to protected authority; a shorter low-trust entry gains nothing", () => {
      const held = budgetAyasContext({ ceiling: 2048, outputReserve: 1, mandatoryTokens: 1, candidates: [candidate("bad", { trust: "QUARANTINED" })] });
      assert.deepEqual(held.selected, []); assert.deepEqual(held.excluded.map((item) => item.reason), ["QUARANTINED"]);
      assert.equal(budgetAyasContext({ ceiling: 2048, outputReserve: 1, mandatoryTokens: 1, candidates: [candidate("bad", { class: "SYSTEM_OWNER_SECURITY", trust: "LOW_TRUST", protected: true })] }).status, "CONTEXT_BUDGET_UNSAFE");
      // Each rule alone: a quarantined entry cannot be mandatory, and low trust is external data or nothing.
      assert.equal(budgetAyasContext({ ceiling: 2048, outputReserve: 1, mandatoryTokens: 1, candidates: [candidate("held", { class: "PROTECTED_MEMORY", trust: "QUARANTINED", protected: true })] }).status, "CONTEXT_BUDGET_UNSAFE");
      assert.equal(budgetAyasContext({ ceiling: 2048, outputReserve: 1, mandatoryTokens: 1, candidates: [candidate("posing", { class: "TRUSTED_MEMORY", trust: "LOW_TRUST" })] }).status, "CONTEXT_BUDGET_UNSAFE");
      const short = budgetAyasContext({ ceiling: 2048, outputReserve: 900, mandatoryTokens: 1000, candidates: [candidate("tiny", { class: "EXTERNAL_DATA", trust: "LOW_TRUST", provenance: "EXTERNAL", tokenEstimate: 60 }), candidate("trusted", { tokenEstimate: 100 })] });
      assert.deepEqual(short.selected, ["trusted"], "trusted memory is admitted first even though the external entry is smaller");
    });
    await scenario("equal-score deterministic order independent of candidate enumeration", () => {
      const fixed = { ceiling: 2048, outputReserve: 900, mandatoryTokens: 1000 };
      assert.deepEqual(budgetAyasContext({ ...fixed, candidates: [candidate("b"), candidate("a")] }), budgetAyasContext({ ...fixed, candidates: [candidate("a"), candidate("b")] }));
    });
    await scenario("huge candidate set bounded by window; duplicate or invalid estimates fail closed", () => {
      const items = Array.from({ length: 1000 }, (_, i) => candidate(`memory:${i}`));
      const evidence = budgetAyasContext({ ceiling: 2048, outputReserve: 900, mandatoryTokens: 100, candidates: items });
      assert.equal(evidence.selected.length, 10); assert.equal(evidence.excluded.length, 990);
      for (const candidates of [[candidate("a"), candidate("a")], [candidate("a", { tokenEstimate: NaN })]]) assert.equal(budgetAyasContext({ ceiling: 2048, outputReserve: 1, mandatoryTokens: 1, candidates }).status, "CONTEXT_BUDGET_UNSAFE");
    });
    await scenario("body-free budget evidence and no state leak across reset", () => {
      const result = buildBudgetedAyasPrompt({ ceiling: 2048, outputReserve: 500, candidates: [candidate("memory")], render: (ids) => "owner SECRET_PRIVATE_BODY" + (ids.has("memory") ? " remembered SECRET_MEMORY_BODY" : "") });
      assert(!JSON.stringify(result.evidence).includes("SECRET")); assert(result.prompt.includes("SECRET_PRIVATE_BODY")); assert(result.prompt.includes("SECRET_MEMORY_BODY"));
      assert.deepEqual(budgetAyasContext({ ceiling: 2048, outputReserve: 1, mandatoryTokens: 1, candidates: [] }).selected, []);
    });
    await scenario("an under-estimated optional entry is shed after the exact rendering is checked; mandatory text that does not fit refuses", () => {
      const result = buildBudgetedAyasPrompt({ ceiling: 2048, outputReserve: 500, candidates: [candidate("memory", { tokenEstimate: 1 })], render: (ids) => ids.has("memory") ? "x".repeat(5000) : "owner" });
      assert.equal(result.prompt, "owner"); assert.deepEqual(result.evidence.selected, []); assert.deepEqual(result.evidence.excluded.map((item) => item.reason), ["BUDGET"]);
      assert.equal(result.evidence.estimatedPromptTokens, estimateAyasContextTokens("owner"));
      assert.throws(() => buildBudgetedAyasPrompt({ ceiling: 2048, outputReserve: 500, candidates: [candidate("memory")], render: () => "x".repeat(5000) }), /CONTEXT_BUDGET_UNSAFE/);
    });
    await scenario("estimate: dense characters count one each, letters one per two bytes, parts never below the whole", () => {
      assert.equal(estimateAyasContextTextTokens("12345"), 5); assert.equal(estimateAyasContextTextTokens("...\n"), 4);
      assert.equal(estimateAyasContextTextTokens("ab"), 1); assert.equal(estimateAyasContextTextTokens("abc"), 2); assert.equal(estimateAyasContextTextTokens("ş"), 1);
      assert.equal(estimateAyasContextTextTokens("😀"), 2); assert.equal(estimateAyasContextTextTokens(""), 0);
      const parts = [sentence, "a1b2c3d4", "ığüşöç İĞÜŞÖÇ", "deadbeef0123456789", "x"];
      assert(parts.reduce((sum, part) => sum + estimateAyasContextLineTokens(part), 0) >= estimateAyasContextTextTokens(parts.join("\n")));
      for (const part of parts) {
        const bytes = new TextEncoder().encode(part).length;
        assert(estimateAyasContextTextTokens(part) >= Math.ceil(bytes / 2) && estimateAyasContextTextTokens(part) <= bytes, part);
      }
      assert.equal(estimateAyasContextTokens(sentence), estimateAyasContextTokens(sentence));
    });
    await scenario("real window: an ordinary 12-turn conversation with recalled memory is admitted whole and unchanged", () => {
      const history = Array.from({ length: AYAS_HISTORY_TURNS }, (_, i) => turn(i % 2 ? "brain" : "user", sentence.trim()));
      const memoryLines = Array.from({ length: 5 }, (_, i) => `  · (preference) Kullanıcı kısa ve net Türkçe yanıt ister, madde ${i}.`);
      const budgeted = buildBudgetedAyasChatPrompt({ ...base, history, memoryLines, contextBudget: { ceiling: REAL_WINDOW, outputReserve: AYAS_MAX_REPLY_TOKENS } });
      assert.deepEqual(budgeted.evidence.excluded, []); assert.equal(budgeted.evidence.selected.length, history.length + memoryLines.length);
      assert.equal(budgeted.prompt, buildAyasChatPrompt({ ...base, history, memoryLines }), "nothing shed: byte-identical to the prompt without a budget");
      assert(budgeted.evidence.estimatedPromptTokens + AYAS_MAX_REPLY_TOKENS <= REAL_WINDOW);
    });
    await scenario("real window: the largest history the context assembly produces sheds only the oldest AYAS replies", () => {
      const history = Array.from({ length: AYAS_HISTORY_TURNS }, (_, i) => turn(i % 2 ? "brain" : "user", `${i}. ${sentence.repeat(6).trim()}`)); // about 6000 characters
      const memoryLines = Array.from({ length: 5 }, (_, i) => `  · (preference) ${"Kullanıcı kısa ve net Türkçe yanıt ister. ".repeat(3)}${i}`);
      const { prompt, evidence } = buildBudgetedAyasChatPrompt({ ...base, history, memoryLines, contextBudget: { ceiling: REAL_WINDOW, outputReserve: AYAS_MAX_REPLY_TOKENS } });
      assert.equal(evidence.status, "ALLOW"); assert(evidence.estimatedPromptTokens + AYAS_MAX_REPLY_TOKENS <= REAL_WINDOW);
      for (const item of evidence.excluded) { assert.equal(item.provenance, "RUNTIME", "only AYAS's own earlier replies are shed here"); assert.equal(item.reason, "BUDGET"); }
      const shed = evidence.excluded.map((item) => Number(item.id.split(":")[1])).sort((a, b) => a - b);
      const keptReplies = history.map((_, i) => i).filter((i) => i % 2 === 1 && !shed.includes(i));
      assert(shed.every((index) => keptReplies.every((kept) => kept > index)), "older replies go before newer ones");
      for (let i = 0; i < history.length; i += 2) assert(prompt.includes(`Kullanıcı: ${history[i]!.text}`), `owner turn ${i} retained`);
      for (const line of memoryLines) assert(prompt.includes(line));
    });
    await scenario("pressure order: AYAS replies, then ordinary memory, then the owner's oldest turns; protected memory, limits and the request stay", () => {
      const history = Array.from({ length: 8 }, (_, i) => turn(i % 2 ? "brain" : "user", `${i % 2 ? "YANIT" : "SAHİP"}_${i} ${sentence.repeat(3).trim()}`));
      const memoryLines = ["  · (identity) Kullanıcının adı Deneme.", `  · (preference) ${"sıradan tercih ".repeat(20)}`];
      const input = { ...base, history, memoryLines };
      const fixed = estimateAyasContextTokens(buildAyasChatPrompt({ ...base, history: [], memoryLines: [memoryLines[0]!] }));
      // Exactly the room for the mandatory prompt and the two newest owner turns.
      const ceiling = estimateAyasContextTokens(buildAyasChatPrompt({ ...base, history: [history[4]!, history[6]!], memoryLines: [memoryLines[0]!] })) + AYAS_MAX_REPLY_TOKENS;
      const { prompt, evidence } = buildBudgetedAyasChatPrompt({ ...input, contextBudget: { ceiling, outputReserve: AYAS_MAX_REPLY_TOKENS, protectedMemoryLines: [memoryLines[0]!] } });
      assert.deepEqual([...evidence.selected].sort(), ["history:4", "history:6"]);
      assert.deepEqual(evidence.excluded.map((item) => item.id).sort(), ["history:0", "history:1", "history:2", "history:3", "history:5", "history:7", "memory:1"]);
      assert(prompt.includes("SAHİP_6") && prompt.includes("SAHİP_4") && !prompt.includes("SAHİP_0") && !prompt.includes("YANIT_"));
      assert(prompt.includes(memoryLines[0]!) && !prompt.includes("sıradan tercih"));
      assert(prompt.includes("Katı sınırlar:") && prompt.includes("yürütme kapısı: CLOSED") && prompt.includes(base.userText));
      assert.equal(evidence.protectedRetained, true); assert(!JSON.stringify(evidence).includes("SAHİP"), "evidence carries no turn text");
      // One token less than the mandatory prompt needs: refused, never trimmed below the mandatory text.
      assert.throws(() => buildBudgetedAyasChatPrompt({ ...input, contextBudget: { ceiling: fixed + AYAS_MAX_REPLY_TOKENS - 1, outputReserve: AYAS_MAX_REPLY_TOKENS, protectedMemoryLines: [memoryLines[0]!] } }), /CONTEXT_BUDGET_UNSAFE/);
      assert.throws(() => buildAyasChatPrompt({ ...base, userText: "x".repeat(40000), history: [], contextBudget: { ceiling: 16384, outputReserve: AYAS_MAX_REPLY_TOKENS } }), /CONTEXT_BUDGET_UNSAFE/);
    });
    await scenario("unknown ceilings and invalid configuration never guessed", () => {
      for (const env of [{}, { OLLAMA_NUM_CTX: "" }, { OLLAMA_NUM_CTX: "NaN" }, { OLLAMA_NUM_CTX: "1024" }, { OLLAMA_NUM_CTX: "99999999" }, { OLLAMA_NUM_CTX: "8192.5" }]) assert.equal(resolveAyasContextCeiling("local", { NODE_ENV: "test", ...env }), null);
      assert.equal(resolveAyasContextCeiling("local", { NODE_ENV: "test", OLLAMA_NUM_CTX: "32768" }), 32768);
      assert.equal(resolveAyasContextCeiling("cloud", { NODE_ENV: "test", OLLAMA_NUM_CTX: "32768" }), null, "the local window says nothing about a cloud model");
      assert.throws(() => buildAyasChatPrompt({ ...base, history: [], contextBudget: { ceiling: null, outputReserve: AYAS_MAX_REPLY_TOKENS } }), /CONTEXT_BUDGET_UNSAFE/);
      // Both real transports declare their window: a known number, or null. Neither leaves it undeclared.
      assert.equal(createOllamaAyasProvider({ NODE_ENV: "test" }).contextWindowTokens, null); assert.equal(createOllamaAyasProvider({ NODE_ENV: "test", OLLAMA_NUM_CTX: "8192" }).contextWindowTokens, 8192);
      assert.equal(createCloudAyasProvider({ NODE_ENV: "test" }).contextWindowTokens, null); assert.equal(createCloudAyasProvider({ NODE_ENV: "test", AYAS_CLOUD_CONTEXT_TOKENS: "16384" }).contextWindowTokens, 16384);
    });
    await scenario("real local transport rejects unknown/overflow BEFORE fetch", async () => {
      let calls = 0; const fetcher = (async () => { calls++; throw Error("unexpected fetch"); }) as typeof fetch;
      for (const env of [{}, { OLLAMA_NUM_CTX: "2048" }]) await assert.rejects(() => createOllamaAyasProvider({ NODE_ENV: "test", ...env }, fetcher).chat({ prompt: "x".repeat(4000), complexity: "NORMAL", maxTokens: 420 }), /CONTEXT_BUDGET_UNSAFE/);
      assert.equal(calls, 0);
    });
    await scenario("cloud transport rejects missing window before any billed call", async () => {
      let calls = 0; const fetcher = (async () => { calls++; throw Error("unexpected fetch"); }) as typeof fetch;
      await assert.rejects(() => createCloudAyasProvider({ NODE_ENV: "test", AYAS_CLOUD_API_KEY: "synthetic-test-key" }, fetcher).chat({ prompt: "owner", complexity: "NORMAL", maxTokens: 420 }), /CONTEXT_BUDGET_UNSAFE/); assert.equal(calls, 0);
    });
    await scenario("measured prompt size decides: within the window is reported, past it the reply is withheld, absent leaves the estimate", async () => {
      const env = { NODE_ENV: "test", OLLAMA_NUM_CTX: String(REAL_WINDOW) } as NodeJS.ProcessEnv; const request: AyasModelRequest = { prompt: "merhaba", complexity: "NORMAL", maxTokens: 420 };
      const run = async (promptEvalCount: unknown) => {
        const seen = { chats: 0, prompts: [] as string[] }; const chunks = [];
        for await (const chunk of createOllamaAyasProvider(env, fakeOllama("MODEL_YANITI", promptEvalCount, seen)).stream(request)) chunks.push(chunk);
        return chunks.at(-1)!;
      };
      assert.deepEqual(await run(1800), { type: "done", text: "MODEL_YANITI", finishReason: "stop", promptTokens: 1800 });
      assert.deepEqual(await run(REAL_WINDOW - 420), { type: "done", text: "MODEL_YANITI", finishReason: "stop", promptTokens: REAL_WINDOW - 420 });
      for (const reported of [undefined, "1800", -1, 1.5, null]) assert.deepEqual(await run(reported), { type: "done", text: "MODEL_YANITI", finishReason: "stop" });
      for (const over of [REAL_WINDOW - 419, REAL_WINDOW, REAL_WINDOW * 4]) {
        await assert.rejects(() => run(over), /CONTEXT_BUDGET_UNSAFE/);
        await assert.rejects(() => createOllamaAyasProvider(env, fakeOllama("MODEL_YANITI", over, { chats: 0, prompts: [] })).chat(request), /CONTEXT_BUDGET_UNSAFE/);
      }
      assert.equal(assertAyasMeasuredPromptFits(100, 2048, 420), 100); assert.equal(assertAyasMeasuredPromptFits("100", 2048, 420), undefined);
      assert.throws(() => assertAyasMeasuredPromptFits(100, null, 420), /CONTEXT_BUDGET_UNSAFE/);
    });
    await scenario("reasoning sheds earlier turns before refusing; mandatory overflow and an unknown window block the model call", async () => {
      const prompts: string[] = []; const provider = { chat: async (req: AyasModelRequest) => { prompts.push(req.prompt); return { text: "geçersiz", finishReason: "stop" }; } } as unknown as AyasModelProvider;
      const historyTurns = Array.from({ length: 8 }, (_, i) => turn(i % 2 ? "brain" : "user", `${i % 2 ? "YANIT" : "SAHİP"}_${i} ${sentence.repeat(4).trim()}`));
      const whole = await runAyasReasoning({ userText: "neden?", complexity: "COMPLEX", provider, contextLines: ["- aktif proje: Deneme"], historyTurns, contextCeiling: 32768 });
      assert.equal(whole.ok, false); assert.equal(prompts.length, 1);
      const legacy = await runAyasReasoning({ userText: "neden?", complexity: "COMPLEX", provider, contextLines: ["- aktif proje: Deneme"], historyTurns });
      assert.equal(legacy.ok, false); assert.equal(prompts[1], prompts[0], "nothing shed: same prompt as without a window");
      for (let i = 0; i < historyTurns.length; i++) assert(prompts[0]!.includes(`_${i} `));
      // Exactly the room for the fixed prompt and the two newest owner turns (900 is the reasoning reply reserve).
      await runAyasReasoning({ userText: "neden?", complexity: "COMPLEX", provider, contextLines: ["- aktif proje: Deneme"], historyTurns: [historyTurns[4]!, historyTurns[6]!] });
      await runAyasReasoning({ userText: "neden?", complexity: "COMPLEX", provider, contextLines: ["- aktif proje: Deneme"], historyTurns, contextCeiling: estimateAyasContextTokens(prompts.at(-1)!) + 900 });
      const trimmed = prompts.at(-1)!;
      assert.equal(trimmed, prompts.at(-2), "the shed prompt is the prompt of the two kept turns");
      assert(trimmed.includes("SAHİP_6") && trimmed.includes("SAHİP_4") && !trimmed.includes("YANIT_") && !trimmed.includes("SAHİP_0"));
      assert(trimmed.includes("KESİN KURALLAR:") && trimmed.includes("- aktif proje: Deneme") && trimmed.includes("Kullanıcı: neden?"));
      const before = prompts.length;
      const overflow = await runAyasReasoning({ userText: "x".repeat(20000), complexity: "TOOL", provider, contextCeiling: 2048 });
      assert.equal(overflow.ok, false); assert.equal(overflow.ok === false && overflow.reason, "CONTEXT_BUDGET_UNSAFE"); assert.equal(overflow.contextBudget?.status, "CONTEXT_BUDGET_UNSAFE");
      const unknown = await runAyasReasoning({ userText: "neden?", complexity: "TOOL", provider, contextCeiling: null });
      assert.equal(unknown.ok === false && unknown.reason, "CONTEXT_BUDGET_UNSAFE"); assert.equal(prompts.length, before, "no model call for either refusal");
    });
    await scenario("chat turn: an unknown local window sends nothing and says so; the deterministic identity answer still works", async () => {
      const seen = { chats: 0, prompts: [] as string[] };
      const done = await chatTurn(root, { NODE_ENV: "test" }, fakeOllama("MODEL_YANITI", 100, seen));
      assert.equal(done.reason, "CONTEXT_BUDGET_UNSAFE"); assert.equal(done.text, AYAS_CONTEXT_WINDOW_UNKNOWN_REPLY); assert.equal(done.source, "fallback"); assert.equal(seen.chats, 0);
      const identity = await chatTurn(root, { NODE_ENV: "test" }, fakeOllama("MODEL_YANITI", 100, seen), { text: "Benim adım ne?", history: [turn("user", "Benim adım Zeynep."), turn("brain", "Memnun oldum Zeynep.")] });
      assert.equal(seen.chats, 0); assert.match(identity.text, /Zeynep/);
    });
    await scenario("chat turn: at the real window an ordinary turn reaches the model with its limits intact and records the budget", async () => {
      const seen = { chats: 0, prompts: [] as string[] }; const store = new BoundedAyasTraceStore(); const trace = startAyasTrace({ rootKind: "chat-turn", scope: "budget", store });
      const history = Array.from({ length: 6 }, (_, i) => turn(i % 2 ? "brain" : "user", sentence.trim()));
      const done = await chatTurn(root, { NODE_ENV: "test", OLLAMA_NUM_CTX: String(REAL_WINDOW) }, fakeOllama("Elbette, çok teşekkür ederim.", 2100, seen), { history, trace });
      assert.equal(done.source, "llm"); assert.equal(done.text, "Elbette, çok teşekkür ederim."); assert.equal(seen.chats, 1);
      assert(seen.prompts[0]!.includes("Katı sınırlar:") && seen.prompts[0]!.includes("yürütme kapısı: CLOSED"));
      for (const item of history) assert(seen.prompts[0]!.includes(item.text));
      trace.finish("ok");
      const span = store.get(trace.traceId, "budget")!.spans.find((item) => item.operation === "stream")!;
      assert.equal(span.status, "ok");
      assert.deepEqual({ ...span.metadata, contextEstimate: 0 }, { contextCeiling: REAL_WINDOW, outputReserve: AYAS_MAX_REPLY_TOKENS, contextEstimate: 0, selectedCount: 6, excludedCount: 0, protectedRetained: true, promptTokens: 2100 });
      assert.equal(span.metadata!.contextEstimate, estimateAyasContextTokens(seen.prompts[0]!));
      assert(!JSON.stringify(store.get(trace.traceId, "budget")).includes("Mimar"), "the trace holds numbers, never the conversation");
    });
    await scenario("chat turn: a prompt the server measured past the window never becomes the reply", async () => {
      const seen = { chats: 0, prompts: [] as string[] }; const store = new BoundedAyasTraceStore(); const trace = startAyasTrace({ rootKind: "chat-turn", scope: "budget", store });
      const done = await chatTurn(root, { NODE_ENV: "test", OLLAMA_NUM_CTX: String(REAL_WINDOW) }, fakeOllama("KESİLMİŞ_İSTEMDEN_ÜRETİLEN_YANIT", REAL_WINDOW, seen), { trace });
      assert.equal(seen.chats, 1); assert.equal(done.reason, "CONTEXT_BUDGET_UNSAFE"); assert.equal(done.text, AYAS_CONTEXT_OVERFLOW_REPLY); assert.equal(done.source, "fallback");
      trace.finish("fallback");
      const span = store.get(trace.traceId, "budget")!.spans.find((item) => item.operation === "stream")!;
      assert.equal(span.status, "denied"); assert.equal(span.errorCode, "CONTEXT_BUDGET_UNSAFE"); assert.equal(span.metadata!.contextEstimate, REAL_WINDOW);
    });
    await scenario("chat turn: the Stage 15C recalled-memory envelope still shrinks as the conversation fills it", async () => {
      const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-context-budget-"));
      try {
        createAyasMemoryStore({ rootDir: memoryRoot }).append(buildBrainMemoryRecord({
          kind: "decision", title: "Memory çalışması", body: "Memory katmanını bugün genişletmek planlanıyor.", importance: "durable", confidence: "reported",
          tags: ["memory"], observedAt: "2026-09-20T00:00:00.000Z", links: [],
        }));
        const env = { NODE_ENV: "test", OLLAMA_NUM_CTX: "32768" } as NodeJS.ProcessEnv; const question = "Memory katmanını genişletme planı neydi?";
        const empty = { chats: 0, prompts: [] as string[] };
        await chatTurn(memoryRoot, env, fakeOllama("MODEL_YANITI", undefined, empty), { text: question });
        assert(empty.prompts[0]!.includes("Memory katmanını bugün genişletmek planlanıyor."), "with room to spare the relevant memory is recalled");
        // About 6000 characters of recent turns and a 2100-character request leave no room in the 8000-character envelope.
        const full = { chats: 0, prompts: [] as string[] };
        const history = Array.from({ length: AYAS_HISTORY_TURNS }, (_, i) => turn(i % 2 ? "brain" : "user", sentence.repeat(6).trim()));
        await chatTurn(memoryRoot, env, fakeOllama("MODEL_YANITI", undefined, full), { text: `${question} ${"Bunu ayrıntılı ve adım adım anlat. ".repeat(62)}`.trim(), history });
        assert(full.chats >= 1 && !full.prompts.some((prompt) => prompt.includes("Memory katmanını bugün genişletmek planlanıyor.")), "a full envelope recalls nothing");
      } finally { fs.rmSync(memoryRoot, { recursive: true, force: true }); }
    });
    await scenario("chat turn: a request too large for the window is refused before any model call", async () => {
      const seen = { chats: 0, prompts: [] as string[] };
      const done = await chatTurn(root, { NODE_ENV: "test", OLLAMA_NUM_CTX: "2048" }, fakeOllama("MODEL_YANITI", 100, seen));
      assert.equal(done.reason, "CONTEXT_BUDGET_UNSAFE"); assert.equal(done.text, AYAS_CONTEXT_OVERFLOW_REPLY); assert.equal(seen.chats, 0);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(`PASS ${count}/${count}; model/network calls 0`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
