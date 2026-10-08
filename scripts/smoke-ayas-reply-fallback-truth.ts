/**
 * AYAS reply fallback truth smoke suite (2026-10-08 live finding).
 *
 * Live, "merhaba" after earlier turns ended as `fallback / context-quality`
 * with the reply "Anladım.", and the chat note said the local model was
 * unreachable although Ollama had answered. Covers:
 *  - a greeting reply to the user's own greeting is accepted with history;
 *  - a re-greeting the user did not ask for is still rejected;
 *  - a greeting turn whose reply is rejected falls back to a greeting, while
 *    safety fallbacks and plain acknowledgments keep their existing text;
 *  - `classifyAyasReplyFallback` separates guarded / deterministic /
 *    unreachable, and every reason literal the pipeline emits is classified;
 *  - the chat note states unreachability only for the unreachable kind.
 *
 * Deterministic / $0 / no network: the Ollama transport is a mock and every
 * turn uses an OS-temp memory and execution-audit root removed at the end.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { streamAyasChat, type StreamAyasChatInput } from "../src/lib/ayas/AyasChatStream";
import { withAyasExecutionAuditRoot } from "../src/lib/ayas/execution/AyasExecutionAuditContext";
import {
  AYAS_GUARDED_FALLBACK_REASONS,
  brainWelcomeMessage,
  classifyAyasReplyFallback,
  deriveBrainCoreState,
  type AyasReplyFallbackKind,
} from "../src/components/brain/brainCore";
import { BrainConsoleView } from "../src/components/brain/BrainConsoleView";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";

let count = 0;
async function scenario(name: string, test: () => Promise<void> | void) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function snap(): BrainConsoleSnapshot {
  return {
    generatedAt: "2026-10-08T08:00:00.000Z",
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

/** Healthy `/api/tags`; every `/api/chat` call streams the same reply (a non-stream correction call cannot parse it and fails). */
function mockOllama(pieces: string[]): typeof fetch {
  return (async (url: string) => {
    if (String(url).includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }), { status: 200 });
    }
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

// A turn reaches the local transport only when its context window is declared.
process.env.OLLAMA_NUM_CTX = "8192";

const memoryRoots: string[] = [];

interface Done { type: "done"; text: string; source: "llm" | "fallback"; reason?: string }

async function turn(input: Omit<StreamAyasChatInput, "snapshot" | "seq" | "memoryStore"> & { seq?: number }): Promise<Done> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-fallback-truth-"));
  memoryRoots.push(root);
  let done: Done | undefined;
  await withAyasExecutionAuditRoot(root, async () => {
    for await (const event of streamAyasChat({ ...input, snapshot: snap(), seq: input.seq ?? 3, memoryStore: { rootDir: root } })) {
      if (event.type === "done") done = event as Done;
    }
  });
  assert.ok(done, "a terminal done event");
  return done;
}

const HISTORY = [
  { role: "user" as const, text: "Bugün AYAS'ın durumuna bakalım." },
  { role: "brain" as const, text: "Tamam, sistem durumunu birlikte gözden geçirebiliriz." },
];

function renderNote(lastReplySource: "llm" | "fallback" | undefined, lastReplyFallbackKind?: AyasReplyFallbackKind): string {
  const snapshot = snap();
  const html = renderToStaticMarkup(
    createElement(BrainConsoleView, {
      snapshot,
      coreState: deriveBrainCoreState(snapshot),
      activePanel: "chat",
      messages: [brainWelcomeMessage(snapshot)],
      modelConfigured: true,
      ...(lastReplySource ? { lastReplySource } : {}),
      ...(lastReplyFallbackKind ? { lastReplyFallbackKind } : {}),
    }),
  );
  const note = html.match(/data-testid="bc-chat-note"[^>]*>([^<]*)/)?.[1];
  assert.ok(note, "chat note rendered");
  return note.replace(/&#x27;/g, "'");
}

async function run() {
  await scenario("greeting after history — a greeting back is the model's accepted reply", async () => {
    const done = await turn({ text: "merhaba", history: HISTORY, fetcher: mockOllama(["Merhaba! ", "Nasıl yardımcı olabilirim?"]) });
    assert.equal(done.source, "llm");
    assert.equal(done.text, "Merhaba! Nasıl yardımcı olabilirim?");
  });

  await scenario("selam after history — a greeting reply with content is accepted", async () => {
    const done = await turn({ text: "selam", history: HISTORY, fetcher: mockOllama(["Selam, iyiyim. ", "Sen nasılsın?"]) });
    assert.equal(done.source, "llm");
    assert.match(done.text, /^Selam, iyiyim/);
  });

  await scenario("non-greeting after history — an unprompted re-greeting is still rejected", async () => {
    const done = await turn({ text: "Yanıtları kısa tutalım.", history: HISTORY, fetcher: mockOllama(["Merhaba! ", "Tabii."]) });
    assert.equal(done.source, "fallback");
    assert.equal(done.reason, "context-quality");
    assert.doesNotMatch(done.text, /^Merhaba/);
  });

  await scenario("non-greeting after history — a bare help offer is still rejected", async () => {
    const done = await turn({ text: "Yanıtları kısa tutalım.", history: HISTORY, fetcher: mockOllama(["Nasıl yardımcı olabilirim?"]) });
    assert.equal(done.source, "fallback");
    assert.equal(done.reason, "context-quality");
  });

  await scenario("greeting with a rejected self-introduction — falls back to a greeting, never 'Anladım.'", async () => {
    const done = await turn({ text: "merhaba", history: HISTORY, fetcher: mockOllama(["Merhaba, ben AYAS."]) });
    assert.equal(done.source, "fallback");
    assert.equal(done.reason, "context-quality");
    assert.equal(done.text, "Merhaba.");
  });

  await scenario("greeting fallbacks mirror the user's greeting", async () => {
    for (const [text, expected] of [["Selam", "Selam."], ["Günaydın", "Günaydın."], ["İyi akşamlar", "İyi akşamlar."], ["iyi geceler", "İyi geceler."]] as const) {
      const done = await turn({ text, history: HISTORY, fetcher: mockOllama(["Benim adım AYAS."]) });
      assert.equal(done.source, "fallback", text);
      assert.equal(done.text, expected, text);
    }
  });

  await scenario("greeting turn with an execution claim keeps the safety fallback", async () => {
    const done = await turn({ text: "merhaba", history: HISTORY, fetcher: mockOllama(["Merhaba, ", "yürütme kapısını ", "açıyorum ", "ve başlatıyorum."]) });
    assert.equal(done.source, "fallback");
    assert.equal(done.reason, "execution-claim");
    assert.match(done.text, /kapalı/i);
  });

  await scenario("a non-greeting acknowledgment keeps the existing 'Anladım.' fallback", async () => {
    const done = await turn({
      text: "Elbette.",
      history: [
        { role: "user", text: "Yanıtları daha kısa tutalım." },
        { role: "brain", text: "Yanıtları kısa ve doğrudan tutacağım." },
      ],
      fetcher: mockOllama([" "]),
    });
    assert.equal(done.source, "fallback");
    assert.equal(done.text, "Anladım.");
  });

  await scenario("classifier — guarded, deterministic and unreachable reasons", () => {
    const expected: [string | undefined, AyasReplyFallbackKind][] = [
      [undefined, "deterministic"],
      ["context-quality", "guarded"],
      ["execution-claim", "guarded"],
      ["unusable-reply", "guarded"],
      ["reasoning-unusable-answer", "guarded"],
      ["reasoning-parse-failed:invalid-json", "guarded"],
      ["clarification-required", "deterministic"],
      ["CONTEXT_BUDGET_UNSAFE", "deterministic"],
      ["unknown-identity", "deterministic"],
      ["ollama-fetch-failed", "unreachable"],
      ["reasoning-transport-failed", "unreachable"],
      ["stream-error", "unreachable"],
      ["cloud-fetch-failed:TypeError", "unreachable"],
      ["cloud-not-configured", "unreachable"],
      ["server-action-failed", "unreachable"],
      ["no-terminal-event", "unreachable"],
      ["yerel model yapılandırılmamış; ücretli veya maliyeti belirsiz fallback sıfır-maliyet politikasıyla kapalı", "unreachable"],
      ["some-future-reason", "unreachable"],
    ];
    for (const [reason, kind] of expected) assert.equal(classifyAyasReplyFallback(reason), kind, String(reason));
  });

  await scenario("classifier covers every reason literal the pipeline emits", () => {
    const stream = fs.readFileSync(path.join(process.cwd(), "src/lib/ayas/AyasChatStream.ts"), "utf8");
    const issueBody = stream.slice(stream.indexOf("function replyIssue("), stream.indexOf("async function finalizeAyasReply("));
    const issues = [...issueBody.matchAll(/return "([a-z-]+)";/g)].map((m) => m[1]);
    assert.ok(issues.length >= 9, "finalizer issues found");
    for (const issue of issues) assert.ok(AYAS_GUARDED_FALLBACK_REASONS.includes(issue), `finalizer issue ${issue} is guarded`);

    const llmOnly = new Set(["label-cleanup", "context-retry"]);
    const literals = [...stream.matchAll(/reason: "([^"]+)"/g)].map((m) => m[1]).filter((r) => !llmOnly.has(r));
    assert.ok(literals.length >= 6, "fallback reason literals found");
    for (const reason of literals) assert.notEqual(classifyAyasReplyFallback(reason), "unreachable", `stream reason ${reason} is not a transport failure`);

    const reasoning = fs.readFileSync(path.join(process.cwd(), "src/lib/ayas/reasoning/AyasReasoningCore.ts"), "utf8");
    for (const [, reason] of reasoning.matchAll(/ok: false, reason: "([^"]+)"/g)) {
      assert.equal(classifyAyasReplyFallback(reason), reason === "reasoning-transport-failed" ? "unreachable" : reason === "CONTEXT_BUDGET_UNSAFE" ? "deterministic" : "guarded", reason);
    }
  });

  await scenario("chat note — states unreachability only for the unreachable kind", () => {
    assert.match(renderNote("llm"), /yerel model \(Ollama\) üzerinden yanıtlıyor/);
    assert.match(renderNote("fallback", "unreachable"), /^Yerel modele ulaşılamadı/);
    assert.match(renderNote("fallback"), /^Yerel modele ulaşılamadı/, "callers without a kind keep the previous note");
    const guarded = renderNote("fallback", "guarded");
    assert.match(guarded, /^Yerel model yanıt verdi/);
    assert.doesNotMatch(guarded, /ulaşılamadı/);
    const deterministic = renderNote("fallback", "deterministic");
    assert.match(deterministic, /kural\/rapor katmanından/);
    assert.doesNotMatch(deterministic, /ulaşılamadı/);
  });
}

run()
  .then(() => {
    console.log(`PASS (${count} scenarios)`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const root of memoryRoots) fs.rmSync(root, { recursive: true, force: true });
  });
