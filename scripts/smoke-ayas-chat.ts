/**
 * AYAS — real LLM chat wiring smoke suite (Sprint 186).
 *
 * Deterministic / GPU-free / $0 / no network (the model call is injected).
 * Covers: prompt construction, LLM success, LLM failure/empty → deterministic
 * fallback, AYAS identity, and the telemetry guarantee (no
 * `data/projects/unknown/ai-usage.json`).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildAyasChatPrompt,
  resolveAyasReply,
  isUsableAyasReply,
  extractAyasReplyText,
  brainDeterministicReply,
  AYAS_NAME,
  AYAS_CHAT_JSON_SCHEMA,
  type BrainChatMessage,
} from "../src/components/brain/brainCore";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");

function snap(over: Partial<BrainConsoleSnapshot> = {}): BrainConsoleSnapshot {
  return {
    generatedAt: "2026-09-08T03:00:00.000Z",
    executionGate: "CLOSED",
    connected: { tasks: false, cycles: false, experience: false },
    errors: [],
    tasks: {
      total: 0,
      byStatus: {
        queued: 0, running: 0, "blocked-on-dependency": 0, "blocked-on-approval": 0,
        succeeded: 0, failed: 0, cancelled: 0, "skipped-unsafe": 0,
      },
      pendingApproval: 0, skippedUnsafe: 0, items: [],
    },
    cyclesRecorded: 0,
    experience: { total: 0 },
    safety: {
      decision: "proceed-with-constraints", snapshotSource: "unavailable",
      reasons: ["resource snapshot unavailable"], hardwareProfileId: "gtx-1650-4gb",
    },
    ...over,
  };
}

const history = (turns: [BrainChatMessage["role"], string][]) =>
  turns.map(([role, text]) => ({ role, text }));

async function run() {
  await scenario("prompt — AYAS identity + hard limits + snapshot context", () => {
    const prompt = buildAyasChatPrompt({
      userText: "Merhaba, sen kimsin?",
      snapshot: snap({ tasks: { ...snap().tasks, total: 3, pendingApproval: 1 } }),
      history: [],
    });
    assert.match(prompt, /Sen AYAS'sın/);
    assert.match(prompt, /Yürütme yetkin YOK/);
    assert.match(prompt, /uydurma/i);
    assert.match(prompt, /yürütme kapısı: CLOSED/);
    assert.match(prompt, /3 görev, 1 onay bekliyor/);
    assert.match(prompt, /Kullanıcı: Merhaba, sen kimsin\?/);
    assert.match(prompt, /"reply":/);
  });

  await scenario("prompt — includes the last few conversation turns, drops system", () => {
    const prompt = buildAyasChatPrompt({
      userText: "Devam et",
      snapshot: snap(),
      history: history([
        ["system", "hoş geldin"],
        ["user", "İstanbul'un fethi hakkında"],
        ["brain", "1453 yılında..."],
      ]),
    });
    assert.match(prompt, /Kullanıcı: İstanbul'un fethi hakkında/);
    assert.match(prompt, /AYAS: 1453 yılında/);
    assert.ok(!prompt.includes("hoş geldin"), "system turns are not fed to the model");
  });

  await scenario("prompt ends with the { reply } JSON envelope instruction", () => {
    const prompt = buildAyasChatPrompt({ userText: "x", snapshot: snap(), history: [] });
    assert.match(prompt, /"reply":/);
    assert.equal(AYAS_CHAT_JSON_SCHEMA.type, "object");
  });

  await scenario("extractAyasReplyText unwraps the envelope; tolerates raw prose; drops empty {}", () => {
    assert.equal(extractAyasReplyText('{"reply":"Ben AYAS."}'), "Ben AYAS.");
    assert.equal(extractAyasReplyText('  {"reply": "  boşluklu  "}  '), "boşluklu");
    assert.equal(extractAyasReplyText("Zarfsız düz metin yanıt."), "Zarfsız düz metin yanıt.");
    assert.equal(extractAyasReplyText("{}"), "");
    assert.equal(extractAyasReplyText('{ "" }'), "");
    assert.equal(extractAyasReplyText(""), "");
  });

  await scenario("A. LLM success (JSON envelope) → the model's reply is used", async () => {
    const out = await resolveAyasReply({
      text: "selam", snapshot: snap(), history: [], seq: 1,
      generate: async () => extractAyasReplyText('{"reply":"Merhaba! Ben AYAS."}'),
    });
    assert.equal(out.source, "llm");
    assert.match(out.message.text, /Ben AYAS/);
  });

  await scenario("A2. LLM success → the model's reply is used", async () => {
    const out = await resolveAyasReply({
      text: "selam",
      snapshot: snap(),
      history: [],
      seq: 1,
      generate: async () => "Merhaba! Ben AYAS, Atölye'nin yapay zekâ çekirdeğiyim. Nasıl yardımcı olabilirim?",
    });
    assert.equal(out.source, "llm");
    assert.equal(out.message.role, "brain");
    assert.match(out.message.text, /Ben AYAS/);
  });

  await scenario("B. LLM failure (throws) → deterministic fallback", async () => {
    const out = await resolveAyasReply({
      text: "selam",
      snapshot: snap({ cyclesRecorded: 2 }),
      history: [],
      seq: 1,
      generate: async () => {
        throw new Error("ECONNREFUSED 127.0.0.1:11434");
      },
    });
    assert.equal(out.source, "fallback");
    assert.match(out.message.text, /konuşma katmanı .* henüz bağlı değil/i);
    assert.match(out.message.text, /KAPALI/);
  });

  await scenario("C. empty / unusable LLM response → deterministic fallback", async () => {
    for (const reply of ["", "   ", "AYAS:"]) {
      const out = await resolveAyasReply({
        text: "selam", snapshot: snap(), history: [], seq: 1,
        generate: async () => reply,
      });
      assert.equal(out.source, "fallback", `reply ${JSON.stringify(reply)} should fall back`);
    }
    assert.equal(isUsableAyasReply("Gerçek bir yanıt."), true);
    assert.equal(isUsableAyasReply(""), false);
  });

  await scenario("D. AYAS identity — name is AYAS in prompt, welcome and fallback", () => {
    assert.equal(AYAS_NAME, "AYAS");
    const prompt = buildAyasChatPrompt({ userText: "x", snapshot: snap(), history: [] });
    assert.match(prompt, /Adın AYAS/);
    const fb = brainDeterministicReply("x", snap(), 1);
    assert.match(fb.text, /çekirde/i); // "beyin çekirdeği" / AYAS core
  });

  await scenario("K. no telemetry: actions.ts does not touch AIUsageManager / runObservedAIRequest", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "app/brain/actions.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const banned of ["AIUsageManager", "runObservedAIRequest", "ProjectWriter", "AIManager"]) {
      assert.ok(!code.includes(banned), `actions.ts must not reference ${banned} (telemetry to data/projects/unknown)`);
    }
    // it does use the existing router + local provider, pinned to ollama
    assert.ok(code.includes('getProvider("ollama")'), "AYAS chat must use the existing ollama provider");
    assert.ok(!/getProvider\(\s*[^"'）)]*aiProviderConfig/.test(code), "provider must be pinned, not resolved from AI_PROVIDER");
  });

  await scenario("K2. resolveAyasReply performs no filesystem write (in-memory only)", async () => {
    const before = fs.existsSync(path.join(REPO_ROOT, "data/projects/unknown/ai-usage.json"))
      ? fs.statSync(path.join(REPO_ROOT, "data/projects/unknown/ai-usage.json")).mtimeMs
      : null;
    await resolveAyasReply({
      text: "test", snapshot: snap(), history: [], seq: 1,
      generate: async () => "yanıt",
    });
    const after = fs.existsSync(path.join(REPO_ROOT, "data/projects/unknown/ai-usage.json"))
      ? fs.statSync(path.join(REPO_ROOT, "data/projects/unknown/ai-usage.json")).mtimeMs
      : null;
    assert.equal(after, before, "AYAS chat must not create/modify data/projects/unknown/ai-usage.json");
  });

  await scenario("execution gate stays CLOSED — the reply never claims to have executed", async () => {
    const out = await resolveAyasReply({
      text: "pipeline'ı çalıştır", snapshot: snap(), history: [], seq: 1,
      // a well-behaved model reply
      generate: async () => "Bunu ben yapamam — yürütme kapısı kapalı. Bu ayrı bir onay adımı gerektirir.",
    });
    assert.equal(out.source, "llm");
    // the prompt instructs the model to refuse execution; the wiring itself
    // runs nothing regardless of what the text says.
    const prompt = buildAyasChatPrompt({ userText: "pipeline'ı çalıştır", snapshot: snap(), history: [] });
    assert.match(prompt, /senin yapamayacağını/);
  });

  console.log(`AYAS chat smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-chat", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS chat smoke FAILED:", error);
  process.exitCode = 1;
});
