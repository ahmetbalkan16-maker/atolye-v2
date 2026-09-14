/**
 * AYAS chat-quality smoke suite (Chat Quality Sprint).
 *
 * Deterministic / $0 / no network (Ollama's NDJSON stream is mocked, same
 * convention as `smoke-ayas-chat-stream.ts`). This suite does NOT assert
 * exact model wording — a live LLM's phrasing is not deterministic — it
 * asserts the deterministic MECHANISMS this sprint added/changed:
 *
 *  - `stripAyasReplyLabelEcho` — the "Kullanıcı: … / AYAS: …" history-label
 *    echo backstop (a real qwen2.5:7b failure mode, found via real testing).
 *  - `isUsableAyasReply` — rejects a bare "AYAS" self-label as no real answer.
 *  - the direct-stream prompt's two chat-quality relevance gates: recalled
 *    memory and the studio/project-state block are only surfaced for a
 *    self-referential / project-topical turn, never unconditionally.
 *  - end-to-end (`streamAyasChat` + a capturing mock Ollama fetch): the REAL
 *    prompt sent to the model reflects those gates, with semantic (not
 *    hardcoded) assertions — `contains`/`doesNotMatch`, per the sprint's own
 *    "response contains X" / negative-assertion testing guidance.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { streamAyasChat } from "../src/lib/ayas/AyasChatStream";
import {
  buildAyasChatPrompt,
  isUsableAyasReply,
  stripAyasReplyLabelEcho,
} from "../src/components/brain/brainCore";
import { createAyasMemoryStore } from "../src/lib/ayas/memory/AyasMemoryStore";
import { buildBrainMemoryRecord } from "../src/lib/brain/BrainMemoryModel";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";
import type { AyasStudioContextView } from "../src/components/brain/brainCore";

let count = 0;
async function scenario(name: string, test: () => Promise<void> | void) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function snap(): BrainConsoleSnapshot {
  return {
    generatedAt: "2026-09-14T00:00:00.000Z",
    executionGate: "CLOSED",
    connected: { tasks: false, cycles: false, experience: false },
    errors: [],
    tasks: {
      total: 0,
      byStatus: { queued: 0, running: 0, "blocked-on-dependency": 0, "blocked-on-approval": 0, succeeded: 0, failed: 0, cancelled: 0, "skipped-unsafe": 0 },
      pendingApproval: 0, skippedUnsafe: 0, items: [],
    },
    cyclesRecorded: 0,
    experience: { total: 0 },
    safety: { decision: "proceed-with-constraints", snapshotSource: "unavailable", reasons: [], hardwareProfileId: "gtx-1650-4gb" },
  };
}

function studio(): AyasStudioContextView {
  return {
    available: true,
    runtimeAuthority: {
      runtimeRoot: "D:\\AtolyeRuntime",
      projectsRoot: "D:\\AtolyeRuntime\\projects",
      authorityRoot: "D:\\AtolyeAuthority",
      classification: "external",
      external: true,
    },
    projects: { total: 16, byStatus: [{ status: "completed", count: 6 }], sample: [] },
    notes: [],
  };
}

/** Mocks Ollama's health probe + `/api/chat` NDJSON stream, capturing the real request body — same convention as `smoke-ayas-chat-stream.ts`. */
function capturingMockOllamaStream(pieces: string[], capturedBodies: string[]): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }), { status: 200 });
    }
    if (String(url).includes("/api/chat") && init?.body) capturedBodies.push(String(init.body));
    const lines = [
      ...pieces.map((p) => JSON.stringify({ message: { content: p }, done: false })),
      JSON.stringify({ done: true, done_reason: "stop" }),
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const l of lines) controller.enqueue(enc.encode(l + "\n"));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
  }) as unknown as typeof fetch;
}

function promptFromCapturedBody(body: string): string {
  const parsed = JSON.parse(body) as { messages?: { content?: string }[] };
  return parsed.messages?.[0]?.content ?? "";
}

function tmpMemRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-chat-quality-"));
}

/** Seeds a real identity ("kimlik") record into a fresh tmp store — the exact shape `AyasMemoryCandidate.ts`'s IDENTITY pattern produces. */
function seedIdentityRecord(rootDir: string): void {
  const store = createAyasMemoryStore({ rootDir });
  store.append(
    buildBrainMemoryRecord({
      kind: "user-preference",
      title: "Kullanıcı kimliği / hitap tercihi",
      body: "Beni Ahmet olarak hatırla. Ben Atölye projesinin sahibiyim ve AYAS'ı kişisel yapay zekâ asistanım olarak geliştirmek istiyorum.",
      importance: "durable",
      confidence: "reported",
      tags: ["kimlik"],
      observedAt: "2026-09-14T00:00:00.000Z",
      links: [],
    }),
  );
}

async function collectDone(gen: AsyncGenerator<{ type: string } & Record<string, unknown>>) {
  let done: ({ type: string } & Record<string, unknown>) | undefined;
  for await (const e of gen) if (e.type === "done") done = e;
  return done!;
}

async function run() {
  // --- stripAyasReplyLabelEcho -------------------------------------------

  await scenario("label-strip — pure 'Kullanıcı: X' echo (whole reply) → empty", () => {
    assert.equal(stripAyasReplyLabelEcho("Kullanıcı: Benim adım ne?"), "");
  });

  await scenario("label-strip — leading echo followed by a real answer → keeps only the answer", () => {
    const out = stripAyasReplyLabelEcho("Kullanıcı: Benim adım ne?\n\nAdın Ahmet.");
    assert.equal(out, "Adın Ahmet.");
  });

  await scenario("label-strip — dangling trailing 'Kullanıcı:' → stripped, real answer kept", () => {
    const out = stripAyasReplyLabelEcho("Adın Ahmet, Atölye'nin sahibisin. Kullanıcı:");
    assert.equal(out, "Adın Ahmet, Atölye'nin sahibisin.");
  });

  await scenario("label-strip — ordinary reply with no label artifacts is untouched", () => {
    const text = "Türkiye'nin başkenti Ankara'dır.";
    assert.equal(stripAyasReplyLabelEcho(text), text);
  });

  // --- isUsableAyasReply ---------------------------------------------------

  await scenario("usability — a bare 'AYAS' self-label (with or without punctuation) is not a real answer", () => {
    assert.equal(isUsableAyasReply("AYAS"), false);
    assert.equal(isUsableAyasReply("AYAS."), false);
    assert.equal(isUsableAyasReply("AYAS:"), false);
    assert.equal(isUsableAyasReply("Ankara'dır."), true);
  });

  // --- buildAyasChatPrompt — complexity-gated studio block -----------------

  await scenario("prompt — SIMPLE complexity omits the studio/project-state block", () => {
    const p = buildAyasChatPrompt({
      userText: "merhaba", snapshot: snap(), history: [], format: "text",
      complexity: "SIMPLE", studio: studio(),
    });
    assert.doesNotMatch(p, /Atölye stüdyo bağlamı/);
  });

  await scenario("prompt — NORMAL complexity still allows the studio block (back-compat)", () => {
    const p = buildAyasChatPrompt({
      userText: "kaç proje var", snapshot: snap(), history: [], format: "text",
      complexity: "NORMAL", studio: studio(),
    });
    assert.match(p, /Atölye stüdyo bağlamı/);
  });

  await scenario("prompt — omitting complexity entirely behaves exactly as before this field existed", () => {
    const p = buildAyasChatPrompt({ userText: "merhaba", snapshot: snap(), history: [], format: "text", studio: studio() });
    assert.match(p, /Atölye stüdyo bağlamı/); // no complexity given → always included, unchanged default
  });

  await scenario("prompt — memory block tells the model to flip 'ben/benim' to second person, not read it verbatim", () => {
    const p = buildAyasChatPrompt({
      userText: "benim adım ne", snapshot: snap(), history: [], format: "text",
      memoryLines: ["  · (user-preference) Beni Ahmet olarak hatırla."],
    });
    assert.match(p, /ikinci tekil şahsa çevir/);
    assert.match(p, /birebir kopyalayıp okuma/);
  });

  // --- end-to-end via streamAyasChat (real function, mocked Ollama) --------

  await scenario("e2e — self-referential identity question: memory IS surfaced in the real prompt", async () => {
    const root = tmpMemRoot();
    seedIdentityRecord(root);
    const bodies: string[] = [];
    const done = await collectDone(
      streamAyasChat({
        text: "Benim adım ne?", snapshot: snap(), seq: 1,
        fetcher: capturingMockOllamaStream(["Adın Ahmet."], bodies),
        memoryStore: { rootDir: root },
      }) as never,
    );
    assert.equal(done.corrected, false);
    const prompt = promptFromCapturedBody(bodies[0]!);
    assert.match(prompt, /Kalıcı hafızadan hatırlananlar/);
    assert.match(prompt.toLocaleLowerCase("tr"), /ahmet/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  await scenario("e2e — unrelated simple question: memory NOT surfaced even though an identity record exists", async () => {
    const root = tmpMemRoot();
    seedIdentityRecord(root);
    const bodies: string[] = [];
    const done = await collectDone(
      streamAyasChat({
        text: "2+2 kaç?", snapshot: snap(), seq: 1,
        fetcher: capturingMockOllamaStream(["4'tür."], bodies), // a bare "4" trips the pre-existing min-length usability guard — unrelated to this sprint
        memoryStore: { rootDir: root },
      }) as never,
    );
    assert.equal(done.text, "4'tür.");
    const prompt = promptFromCapturedBody(bodies[0]!);
    assert.doesNotMatch(prompt, /Kalıcı hafızadan hatırlananlar/);
    assert.doesNotMatch(done.text as string, /Atölye/);
    assert.doesNotMatch(done.text as string, /çekirde/); // "çekirdeği/çekirdek" — no persona leakage
    fs.rmSync(root, { recursive: true, force: true });
  });

  await scenario("e2e — project-irrelevant statement: studio block NOT surfaced", async () => {
    const bodies: string[] = [];
    await collectDone(
      streamAyasChat({
        text: "Bugün ne yapabiliriz?", snapshot: snap(), studio: studio(), seq: 1,
        fetcher: capturingMockOllamaStream(["Bugün istediğin bir şeyle başlayabiliriz."], bodies),
      }) as never,
    );
    const prompt = promptFromCapturedBody(bodies[0]!);
    assert.doesNotMatch(prompt, /Atölye stüdyo bağlamı/);
  });

  await scenario("e2e — project-topical question: studio block IS surfaced", async () => {
    const bodies: string[] = [];
    await collectDone(
      streamAyasChat({
        text: "Kaç proje var, hangi aşamada takıldık?", snapshot: snap(), studio: studio(), seq: 1,
        fetcher: capturingMockOllamaStream(["16 proje var."], bodies),
      }) as never,
    );
    const prompt = promptFromCapturedBody(bodies[0]!);
    assert.match(prompt, /Atölye stüdyo bağlamı/);
  });

  await scenario("e2e — a greeting never gets a project-report reply (negative assertion)", async () => {
    const bodies: string[] = [];
    const done = await collectDone(
      streamAyasChat({
        text: "Merhaba", snapshot: snap(), studio: studio(), seq: 1,
        fetcher: capturingMockOllamaStream(["Merhaba! Nasıl yardımcı olabilirim?"], bodies),
      }) as never,
    );
    assert.doesNotMatch(done.text as string, /proje say|toplam proje|pipeline/i);
    const prompt = promptFromCapturedBody(bodies[0]!);
    assert.doesNotMatch(prompt, /Atölye stüdyo bağlamı/);
  });

  await scenario("e2e — a pure label-echo model reply never reaches the user as-is", async () => {
    const bodies: string[] = [];
    const done = await collectDone(
      streamAyasChat({
        text: "Atölye için bir yapay zekâ asistanı geliştiriyorum.", snapshot: snap(), seq: 1,
        fetcher: capturingMockOllamaStream(["Kullanıcı: Atölye için bir yapay zekâ asistanı geliştiriyorum."], bodies),
      }) as never,
    );
    assert.doesNotMatch(done.text as string, /^Kullanıcı:/);
  });

  console.log(`AYAS chat quality smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-chat-quality", scenarios: count }));
}

run().catch((err) => {
  console.error("AYAS chat quality smoke: FAIL");
  console.error(err);
  process.exitCode = 1;
});
