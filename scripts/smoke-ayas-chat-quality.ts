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
  ayasReplyHasUnexpectedScriptMixing,
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

const testMemoryRoots = new Set<string>();

function tmpMemRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-chat-quality-"));
  testMemoryRoots.add(root);
  return root;
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
  const isolatedMemoryRoot = tmpMemRoot();
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

  await scenario("label-strip — leading user echo preserves the labeled real answer", () => {
    assert.equal(stripAyasReplyLabelEcho("\r\nKullanıcı: Adım ne?\r\n\r\nAYAS: Adın Ahmet.\r\n"), "Adın Ahmet.");
  });

  await scenario("label-strip — mid-reply fabricated exchange is removed, surrounding answer survives", () => {
    assert.equal(stripAyasReplyLabelEcho("Tabii, bunu yapabiliriz.\n\nKullanıcı: Nasıl?\nAYAS: Sahte yanıt.\n\nİlk adımı seçelim."), "Tabii, bunu yapabiliriz.\n\nİlk adımı seçelim.");
  });

  await scenario("label-strip — own leading label survives while a later fabricated exchange does not", () => {
    assert.equal(stripAyasReplyLabelEcho("AYAS: Hazırım.\nKullanıcı: Başlayalım mı?\nAYAS: Sahte yanıt."), "Hazırım.");
  });

  await scenario("label-strip — ordinary mentions and multiline content survive", () => {
    const text = "AYAS ile sohbet ediyoruz.\nKullanıcı tercihlerini dikkate alıyorum.\n\nSonraki adımı seçelim.";
    assert.equal(stripAyasReplyLabelEcho(text), text);
  });

  await scenario("label-strip — empty and whitespace-only input stays empty", () => {
    assert.equal(stripAyasReplyLabelEcho(""), "");
    assert.equal(stripAyasReplyLabelEcho(" \r\n\t"), "");
  });

  // --- stripAyasReplyLabelEcho — remediation: label + content split across lines ---

  await scenario("label-strip — standalone Kullanıcı label + next-line echo + standalone AYAS label + answer", () => {
    const out = stripAyasReplyLabelEcho("Kullanıcı:\nBugün beynin konuşma tarafını geliştireceğiz.\n\nAYAS:\nİyiyim, hazırım. Ne yapabiliriz?");
    assert.equal(out, "İyiyim, hazırım. Ne yapabiliriz?");
  });

  await scenario("label-strip — same case with blank lines between role and content", () => {
    const out = stripAyasReplyLabelEcho("Kullanıcı:\n\nBugün beynin konuşma tarafını geliştireceğiz.\n\nAYAS:\n\nİyiyim, hazırım. Ne yapabiliriz?");
    assert.equal(out, "İyiyim, hazırım. Ne yapabiliriz?");
  });

  await scenario("label-strip — multiline user echo under standalone Kullanıcı label is entirely discarded", () => {
    const out = stripAyasReplyLabelEcho("Kullanıcı:\nBirinci satır.\nİkinci satır.\nAYAS:\nGerçek cevap.");
    assert.equal(out, "Gerçek cevap.");
  });

  await scenario("label-strip — genuine leading standalone AYAS label preserves its (possibly multi-paragraph) answer", () => {
    const out = stripAyasReplyLabelEcho("AYAS:\nİlk paragraf.\n\nİkinci paragraf devam ediyor.");
    assert.equal(out, "İlk paragraf.\n\nİkinci paragraf devam ediyor.");
  });

  await scenario("label-strip — fabricated standalone Kullanıcı/AYAS block in the middle of a valid answer is removed safely", () => {
    const out = stripAyasReplyLabelEcho(
      "Gerçek başlangıç cümlesi.\n\nKullanıcı:\nSahte soru burada.\n\nAYAS:\nSahte cevap burada.\n\nGerçek devam cümlesi.",
    );
    assert.equal(out, "Gerçek başlangıç cümlesi.\n\nGerçek devam cümlesi.");
  });

  await scenario("label-strip — literal explanatory sentence naming both labels remains untouched", () => {
    const text = "Kullanıcı: ve AYAS: etiketleri konuşmadaki rolleri gösterir.";
    assert.equal(stripAyasReplyLabelEcho(text), text);
  });

  await scenario("label-strip — remediation: a verbatim echo of the user's OWN question is stripped even when that question names both labels", () => {
    // Real live-model finding: when the user's literal question itself names
    // both labels, the model can echo it verbatim as a first line that ALSO
    // (coincidentally) matches the both-labels-mentioned prose shape. Passing
    // the actual userText disambiguates a genuine echo from genuine prose.
    const userText = "Kullanıcı: ve AYAS: etiketleri ne işe yarıyor?";
    const raw = "Kullanıcı: ve AYAS: etiketleri ne işe yarıyor?\nAYAS: Bu etiketler konuşmadaki rolleri belirtir.";
    assert.equal(stripAyasReplyLabelEcho(raw, userText), "Bu etiketler konuşmadaki rolleri belirtir.");
  });

  await scenario("label-strip — genuine explanatory prose naming both labels still survives when userText is supplied but doesn't match", () => {
    const userText = "Bu etiketler ne işe yarıyor?";
    const text = "Kullanıcı: ve AYAS: etiketleri konuşmadaki rolleri gösterir.";
    assert.equal(stripAyasReplyLabelEcho(text, userText), text);
  });

  await scenario("usability — a bare 'AYAS' self-label (with or without punctuation) is not a real answer", () => {
    assert.equal(isUsableAyasReply("AYAS"), false);
    assert.equal(isUsableAyasReply("AYAS."), false);
    assert.equal(isUsableAyasReply("AYAS:"), false);
    assert.equal(isUsableAyasReply("Ankara'dır."), true);
  });

  // --- ayasReplyHasUnexpectedScriptMixing (remediation: live mixed-script finding) ---

  await scenario("script-guard — unexpected CJK corruption in an otherwise Turkish conversation is blocked", () => {
    assert.equal(
      ayasReplyHasUnexpectedScriptMixing("İyiyim, hazırım. Sen今天感觉有点累。", "Bugün biraz yoruldum."),
      true,
    );
  });

  await scenario("script-guard — legitimate CJK is never blocked when the user's own turn introduced it", () => {
    assert.equal(ayasReplyHasUnexpectedScriptMixing("好的，谢谢。", "你好吗？"), false);
    assert.equal(
      ayasReplyHasUnexpectedScriptMixing("Merhaba anlamı 你好 demektir.", "你好 ne demek?"),
      false,
    );
    // and a plain Turkish reply to a plain Turkish turn never trips it
    assert.equal(ayasReplyHasUnexpectedScriptMixing("Anladım, devam edelim.", "Tamam güzel."), false);
  });

  await scenario("script-guard — Brain Maturity adversarial-sweep finding: unexpected Cyrillic corruption is blocked too", () => {
    // Real live finding: a single Cyrillic syllable embedded mid-word in an
    // otherwise Turkish reply ("tanıдавasınuz") — the original guard only
    // covered Han/Kana/Hangul; this proves the failure class recurs with a
    // different script and the guard must generalize, not just patch one case.
    assert.equal(
      ayasReplyHasUnexpectedScriptMixing("Beni tanıдавasınuz, kullanıcı.", "Benim adım ne?"),
      true,
    );
    // and legitimate Cyrillic stays unblocked when the user introduced it
    assert.equal(ayasReplyHasUnexpectedScriptMixing("Привет anlamı merhaba demektir.", "Привет ne demek?"), false);
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

  await scenario("prompt — remediation: greeting guidance no longer embeds the literal canned 'İyiyim, hazırım.' example", () => {
    const p = buildAyasChatPrompt({ userText: "selam", snapshot: snap(), history: [], format: "text" });
    assert.doesNotMatch(p, /İyiyim,?\s*hazırım/i);
  });

  await scenario("prompt — declarative/social prompt guidance remains present after the remediation rewrite", () => {
    const p = buildAyasChatPrompt({ userText: "merhaba", snapshot: snap(), history: [], format: "text" });
    // social-opener guidance (rewritten, but still present in spirit)
    assert.match(p, /gerçek bir sohbet/);
    assert.match(p, /[Nn]as[ıi]ls[ıi]n/);
    // acknowledgment guidance (new, remediation-added)
    assert.match(p, /onay\/teyit/);
    // declarative-statement acceptance guidance (untouched by this remediation)
    assert.match(p, /KABUL ET/);
  });

  await scenario("prompt — general comprehension keeps personal statements and literal terminology on-topic", () => {
    const prompt = buildAyasChatPrompt({ userText: "Bugün biraz yoruldum.", snapshot: snap(), history: [], format: "text" });
    assert.match(prompt, /kişisel bir durum veya duygu/i);
    assert.match(prompt, /Atölye, proje, pipeline veya görev durumuna atlama/i);
    assert.match(prompt, /literal terimler/i);
  });

  await scenario("prompt — recent conversation outranks memory and ambiguity must be clarified", () => {
    const prompt = buildAyasChatPrompt({ userText: "Onu düzelt.", snapshot: snap(), history: [], format: "text" });
    assert.match(prompt, /Güncel konuşma ile kalıcı hafıza çatışırsa güncel konuşma önceliklidir/i);
    assert.match(prompt, /birden çok makul karşılık varsa tahmin etme/i);
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
        memoryStore: { rootDir: isolatedMemoryRoot },
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
        memoryStore: { rootDir: isolatedMemoryRoot },
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
        memoryStore: { rootDir: isolatedMemoryRoot },
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
        memoryStore: { rootDir: isolatedMemoryRoot },
        fetcher: capturingMockOllamaStream(["Kullanıcı: Atölye için bir yapay zekâ asistanı geliştiriyorum."], bodies),
      }) as never,
    );
    assert.doesNotMatch(done.text as string, /^Kullanıcı:/);
  });

  console.log(`AYAS chat quality smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-chat-quality", scenarios: count }));
}

run()
  .catch((err) => {
    console.error("AYAS chat quality smoke: FAIL");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const root of testMemoryRoots) fs.rmSync(root, { recursive: true, force: true });
  });
