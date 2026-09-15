/**
 * AYAS Reasoning Core smoke suite (Phase 2 · Phase D · §11).
 *
 * Deterministic, no real model, no fs writes. Two halves:
 *  - unit: `runAyasReasoning` / `parseAyasReasoningOutput` / `buildAyasReasoningPrompt`
 *    against a mock `AyasModelProvider` (`chat()` only — `stream()` throws if
 *    ever called, proving the reasoning path never token-streams a JSON blob).
 *  - integration: `streamAyasChat` end-to-end via its `route` test seam, for
 *    every complexity, confirming the SIMPLE/NORMAL bypass and the
 *    COMPLEX/TOOL/RESEARCH reasoning path (REPAIR is unit-tested only, to stay
 *    hermetic — `streamAyasChat` reads the REAL self-heal store for REPAIR,
 *    which this suite must not depend on).
 *
 * Covers §11: SIMPLE bypass, COMPLEX/RESEARCH/TOOL reasoning, malformed JSON
 * fallback, missing-fields rejection, no raw CoT persistence, WRITE/EXECUTE/
 * terminal/git-push/deploy all denied, Execution Gate never touched.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  shouldUseAyasReasoning,
  runAyasReasoning,
  buildAyasReasoningTrace,
} from "../src/lib/ayas/reasoning/AyasReasoningCore";
import { parseAyasReasoningOutput } from "../src/lib/ayas/reasoning/AyasReasoningParser";
import { buildAyasReasoningPrompt } from "../src/lib/ayas/reasoning/AyasReasoningPrompt";
import { streamAyasChat as productionStreamAyasChat, type StreamAyasChatInput } from "../src/lib/ayas/AyasChatStream";
import type { AyasModelProvider } from "../src/lib/ayas/model/AyasModelTypes";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";
import { AyasVoiceEngine, type AyasVoicePlatform, type AyasListenHandlers } from "../src/components/brain/voice/ayasVoiceEngine";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function okJson(over: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    intent: "kullanıcı proje durumunu öğrenmek istiyor",
    goal: "projenin şu anki pipeline durumunu özetlemek",
    constraints: [],
    assumptions: [],
    plan: ["proje verisini incele", "durumu özetle"],
    requiredTools: [],
    risk: "düşük",
    verification: ["kullanıcı manifest ile karşılaştırabilir"],
    answer: "Mimar Sinan projesi şu anda visuals aşamasında bekliyor.",
    ...over,
  });
}

/** `chat()`-only mock — `stream()` throws so an accidental streamed reasoning call fails loudly. */
function mockProvider(chat: (prompt: string) => string | Promise<string>): AyasModelProvider & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    id: "ollama",
    kind: "local",
    model: "test-model",
    configured: true,
    prompts,
    async health() {
      return { available: true, detail: "test", checkedAtMs: Date.now() };
    },
    async chat(req) {
      prompts.push(req.prompt);
      return { text: await chat(req.prompt), finishReason: "stop" };
    },
    async *stream() {
      throw new Error("stream() must never be called on the Reasoning Core path");
    },
  };
}

/**
 * Action Runtime sprint — a real tool dispatch means `route.provider.chat()`
 * is called TWICE per turn (the reasoning pass, then the tool-grounded
 * follow-up) instead of once. This mock returns each queued response in
 * order — index 0 for the reasoning call, index 1 for the grounding call —
 * and captures every prompt it was given, so a test can assert on both.
 */
function mockProviderSequence(responses: readonly (string | ((prompt: string) => string))[]): AyasModelProvider & { prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  return {
    id: "ollama",
    kind: "local",
    model: "test-model",
    configured: true,
    prompts,
    async health() {
      return { available: true, detail: "test", checkedAtMs: Date.now() };
    },
    async chat(req) {
      prompts.push(req.prompt);
      const entry = responses[i];
      i += 1;
      if (entry === undefined) throw new Error(`mockProviderSequence: no response queued for call #${i}`);
      const text = typeof entry === "function" ? entry(req.prompt) : entry;
      return { text, finishReason: "stop" };
    },
    async *stream() {
      throw new Error("stream() must never be called on the Reasoning Core path");
    },
  };
}

const snapshot: BrainConsoleSnapshot = {
  generatedAt: "2026-09-11T10:00:00.000Z",
  executionGate: "CLOSED",
  connected: { tasks: false, cycles: false, experience: false },
  errors: [],
  tasks: {
    total: 0,
    byStatus: {
      queued: 0,
      running: 0,
      "blocked-on-dependency": 0,
      "blocked-on-approval": 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      "skipped-unsafe": 0,
    },
    pendingApproval: 0,
    skippedUnsafe: 0,
    items: [],
  },
  cyclesRecorded: 0,
  experience: { total: 0 },
  safety: { decision: "proceed-with-constraints", snapshotSource: "unavailable", reasons: [], hardwareProfileId: "gtx-1650-4gb" },
};

const testMemoryRoots = new Set<string>();
async function* streamAyasChat(input: StreamAyasChatInput) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-reasoning-mem-"));
  testMemoryRoots.add(root);
  yield* productionStreamAyasChat({ ...input, memoryStore: input.memoryStore ?? { rootDir: root } });
}

/**
 * Production Project Catalog sprint (Scenarios H/I/J) — the same
 * `ATOLYE_RUNTIME_ROOT` env-scoped sandbox idiom `smoke-ayas-project-catalog
 * .ts` uses, duplicated locally (small, script-local, not exported there) so
 * a real dispatch through `attemptAyasToolDispatch` → the REAL
 * `list-production-projects` executor → `AyasProjectCatalog.ts` reads real
 * fixture fs state instead of this machine's actual production data.
 * `manifest.json` is deliberately omitted — these scenarios only assert
 * count/filter correctness, never `resumable`/`resumeCandidateStage`
 * (already covered by `smoke-ayas-project-catalog.ts` Scenario D), so a
 * missing manifest simply leaves `resumable: false` rather than needing to
 * fabricate valid stage output.
 */
function writeCatalogProject(root: string, dir: string, record: Record<string, unknown>) {
  const folder = path.join(root, "projects", dir);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "project.json"), JSON.stringify(record));
}

function writeCatalogAsset(root: string, dir: string, relPath: string, content = "x") {
  const full = path.join(root, "projects", dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

async function withCatalogRuntimeRoot<T>(build: (root: string) => void, run: () => Promise<T>): Promise<T> {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-reasoning-catalog-"));
  const runtimeRoot = path.join(sandbox, "runtime");
  fs.mkdirSync(path.join(runtimeRoot, "projects"), { recursive: true });
  const prev = process.env.ATOLYE_RUNTIME_ROOT;
  process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
  try {
    build(runtimeRoot);
    return await run();
  } finally {
    if (prev === undefined) delete process.env.ATOLYE_RUNTIME_ROOT;
    else process.env.ATOLYE_RUNTIME_ROOT = prev;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

/**
 * Wake Alias sprint — a minimal, script-local {@link AyasVoicePlatform} (same
 * small-duplication idiom as the catalog sandbox helpers above) so a real
 * `AyasVoiceEngine` can drive the voice-layer half of the "UYAN, ..." product
 * E2E test below. TTS is unused here (`tts: false`) — this test only needs
 * the wake-alias-strip → `onCommand` half of the engine.
 */
class MinimalVoicePlatform implements AyasVoicePlatform {
  private handlers: AyasListenHandlers | null = null;
  detectCapability() {
    return { stt: true, tts: false, sttCloudBacked: false };
  }
  listVoices() {
    return [];
  }
  onVoicesChanged() {
    return () => {};
  }
  startListening(_lang: string, handlers: AyasListenHandlers) {
    this.handlers = handlers;
    return { stop: () => { this.handlers = null; } };
  }
  speak() {
    return { cancel: () => {} };
  }
  cancelSpeech() {}
  fireTranscript(text: string) {
    this.handlers?.onFinalTranscript(text);
  }
}

/** Builds the 3-project fixture shared by Scenarios H/I/J: 1 completed (with a real video), 2 incomplete. */
function buildThreeProjectFixture(root: string) {
  writeCatalogProject(root, "finished-doc", { id: "finished-doc", title: "Bitmiş Belgesel", status: "completed", updatedAt: "2026-09-01T00:00:00.000Z" });
  writeCatalogAsset(root, "finished-doc", "export/bundle/video.mp4");

  writeCatalogProject(root, "half-done", { id: "half-done", title: "Yarım Kalan Proje", status: "visuals", updatedAt: "2026-09-02T00:00:00.000Z" });

  writeCatalogProject(root, "just-started", { id: "just-started", title: "Yeni Başlayan Proje", status: "draft", updatedAt: "2026-09-03T00:00:00.000Z" });
}

async function run() {
  /* ---------------- complexity gate ---------------- */

  await scenario("shouldUseAyasReasoning — SIMPLE/NORMAL bypass; COMPLEX/TOOL/REPAIR/RESEARCH use it", () => {
    assert.equal(shouldUseAyasReasoning("SIMPLE"), false);
    assert.equal(shouldUseAyasReasoning("NORMAL"), false);
    for (const c of ["COMPLEX", "TOOL", "REPAIR", "RESEARCH"] as const) {
      assert.equal(shouldUseAyasReasoning(c), true);
    }
  });

  /* ---------------- parser ---------------- */

  await scenario("parser — a clean JSON object parses; complexity is forced to the caller's classification", () => {
    const out = parseAyasReasoningOutput(okJson({ complexity: "SIMPLE" }), "COMPLEX");
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.result.complexity, "COMPLEX", "the model's own complexity claim is ignored");
  });

  await scenario("parser — a markdown-fenced JSON blob with surrounding prose still parses", () => {
    const wrapped = "Elbette, işte sonuç:\n```json\n" + okJson() + "\n```\nUmarım yardımcı olur.";
    const out = parseAyasReasoningOutput(wrapped, "RESEARCH");
    assert.equal(out.ok, true);
  });

  await scenario("parser — malformed JSON → invalid-json", () => {
    const out = parseAyasReasoningOutput("bu bir JSON değil, sadece düz metin.", "COMPLEX");
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, "no-json-object");
  });

  await scenario("parser — missing required field (no answer at all) → missing-fields", () => {
    const bad = JSON.stringify({ intent: "x", goal: "y", plan: [], requiredTools: [], risk: "z", verification: [] });
    const out = parseAyasReasoningOutput(bad, "COMPLEX");
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, "missing-fields");
  });

  await scenario("parser — a present-but-empty-string answer → missing-fields (not a type error)", () => {
    const out = parseAyasReasoningOutput(okJson({ answer: "   " }), "COMPLEX");
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, "missing-fields");
  });

  await scenario("parser — a wrong-typed field (a number instead of a string) → invalid-field-types", () => {
    const bad = JSON.stringify({ ...JSON.parse(okJson()), intent: 12345 });
    const out = parseAyasReasoningOutput(bad, "COMPLEX");
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, "invalid-field-types");
  });

  await scenario("parser — an unknown/hallucinated tool id is dropped, a real one survives", () => {
    const out = parseAyasReasoningOutput(okJson({ requiredTools: ["inspect-project", "sudo-rm-rf"] }), "TOOL");
    assert.equal(out.ok, true);
    if (out.ok) assert.deepEqual(out.result.requiredTools, ["inspect-project"]);
  });

  await scenario("parser — an unrelated extra field (e.g. a chain-of-thought dump) never survives into the result", () => {
    const raw = okJson({ chainOfThought: "adım adım düşünüyorum: önce X, sonra Y, gizli akıl yürütme..." });
    const out = parseAyasReasoningOutput(raw, "COMPLEX");
    assert.equal(out.ok, true);
    if (out.ok) {
      const dump = JSON.stringify(out.result);
      assert.ok(!dump.includes("gizli akıl yürütme"));
      assert.deepEqual(Object.keys(out.result).sort(), [
        "answer",
        "assumptions",
        "complexity",
        "constraints",
        "goal",
        "intent",
        "plan",
        "requiredTools",
        "risk",
        "verification",
      ]);
    }
  });

  /* ---------------- runAyasReasoning (unit, mock provider) ---------------- */

  await scenario("runAyasReasoning — success path; trace carries exactly the 6 safe fields, no CoT field", () => {
    return runAyasReasoning({
      userText: "Mimar Sinan neden takıldı",
      complexity: "COMPLEX",
      provider: mockProvider(() => okJson({ requiredTools: ["inspect-project"] })),
    }).then((outcome) => {
      assert.equal(outcome.ok, true);
      if (!outcome.ok) return;
      assert.deepEqual(Object.keys(outcome.trace).sort(), [
        "goal",
        "intent",
        "plan",
        "requiredTools",
        "risk",
        "verification",
      ]);
      assert.deepEqual(outcome.trace, buildAyasReasoningTrace(outcome.result));
    });
  });

  await scenario("runAyasReasoning — a reserved write tool + a real read-only tool → only the read-only one survives", () => {
    return runAyasReasoning({
      userText: "bunu düzelt ve devam et",
      complexity: "TOOL",
      provider: mockProvider(() => okJson({ requiredTools: ["inspect-project", "resume-stage"] })),
    }).then((outcome) => {
      assert.equal(outcome.ok, true);
      if (outcome.ok) assert.deepEqual(outcome.result.requiredTools, ["inspect-project"]);
    });
  });

  await scenario(
    "runAyasReasoning — WRITE / EXECUTE / terminal / git-push / deploy are ALL denied, even together",
    () => {
      const raw = okJson({
        requiredTools: [
          "run-pipeline-stage",
          "resume-stage",
          "retry-stage",
          "regenerate-stage",
          "publish-youtube",
          "run-terminal-command",
          "git-push",
          "deploy-production",
        ],
      });
      return runAyasReasoning({ userText: "hepsini yap", complexity: "COMPLEX", provider: mockProvider(() => raw) }).then(
        (outcome) => {
          assert.equal(outcome.ok, true);
          if (outcome.ok) assert.deepEqual(outcome.result.requiredTools, [], "nothing here may ever be `allowed`");
        },
      );
    },
  );

  await scenario("runAyasReasoning — an execution-claiming answer is rejected, not passed through", () => {
    return runAyasReasoning({
      userText: "ne yaptın",
      complexity: "COMPLEX",
      provider: mockProvider(() => okJson({ answer: "Dosyayı sildim ve git push yaptım." })),
    }).then((outcome) => {
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.equal(outcome.reason, "reasoning-execution-claim");
    });
  });

  await scenario("runAyasReasoning — an unusable (near-empty) answer is rejected", () => {
    return runAyasReasoning({
      userText: "x",
      complexity: "COMPLEX",
      provider: mockProvider(() => okJson({ answer: "AYAS:" })),
    }).then((outcome) => {
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.equal(outcome.reason, "reasoning-unusable-answer");
    });
  });

  await scenario("runAyasReasoning — a transport failure (provider throws) fails cleanly", () => {
    return runAyasReasoning({
      userText: "x",
      complexity: "RESEARCH",
      provider: mockProvider(() => {
        throw new Error("network down");
      }),
    }).then((outcome) => {
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.equal(outcome.reason, "reasoning-transport-failed");
    });
  });

  await scenario("runAyasReasoning — malformed model output fails with a reasoning-parse-failed reason", () => {
    return runAyasReasoning({
      userText: "x",
      complexity: "COMPLEX",
      provider: mockProvider(() => "bozuk çıktı, JSON değil"),
    }).then((outcome) => {
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.ok(outcome.reason.startsWith("reasoning-parse-failed"));
    });
  });

  /* ---------------- prompt builder (REPAIR self-heal wiring, unit-only) ---------------- */

  await scenario("prompt builder — REPAIR self-heal lines + context/memory lines reach the model prompt", () => {
    const provider = mockProvider((p) => {
      assert.ok(p.includes("aktif olay: visuals aşaması timeout"));
      assert.ok(p.includes("aktif proje: Mimar Sinan"));
      assert.ok(p.includes("Kalıcı hafızadan"));
      return okJson();
    });
    return runAyasReasoning({
      userText: "neden düzelmedi",
      complexity: "REPAIR",
      provider,
      contextLines: ["- aktif proje: Mimar Sinan"],
      memoryLines: ["Kalıcı hafızadan hatırlananlar: kullanıcı kısa yanıt istiyor"],
      selfHealLines: ["aktif olay: visuals aşaması timeout (kök neden bilinmiyor)"],
    }).then((outcome) => {
      assert.equal(outcome.ok, true);
    });
  });

  await scenario("prompt builder — never contains a raw secret/env-var name (sanity)", () => {
    const p = buildAyasReasoningPrompt({ userText: "test", complexity: "COMPLEX" });
    assert.ok(!/AYAS_CLOUD_API_KEY|AYAS_PHONE_KEY|Authorization/.test(p));
    assert.ok(p.includes("chain-of-thought"), "the prompt itself explicitly forbids CoT output");
  });

  /* ---------------- streamAyasChat integration ---------------- */

  await scenario("streamAyasChat — SIMPLE complexity bypasses reasoning (stream() used, chat() never called)", async () => {
    const provider: AyasModelProvider = {
      id: "ollama",
      kind: "local",
      model: "m",
      configured: true,
      async health() {
        return { available: true, detail: "", checkedAtMs: Date.now() };
      },
      async chat() {
        throw new Error("chat() must not be called for SIMPLE");
      },
      async *stream() {
        yield { type: "delta", text: "merhaba! " };
        yield { type: "done", text: "merhaba!", finishReason: "stop" };
      },
    };
    const events: unknown[] = [];
    for await (const e of streamAyasChat({
      text: "merhaba",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "SIMPLE", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) {
      events.push(e);
    }
    const done = events.find((e) => (e as { type: string }).type === "done") as { source: string; reasoning?: unknown };
    assert.equal(done.source, "llm");
    assert.equal(done.reasoning, undefined, "no reasoning trace on the bypass path");
  });

  await scenario("streamAyasChat — COMPLEX complexity runs the Reasoning Core; done carries a safe trace", async () => {
    const provider = mockProvider(() => okJson({ requiredTools: ["inspect-project"] }));
    const events: { type: string; text?: string; source?: string; reasoning?: unknown; complexity?: string }[] = [];
    for await (const e of streamAyasChat({
      text: "Mimar Sinan neden takıldı, ne yapmalıyız",
      snapshot,
      seq: 1,
      route: {
        decision: { complexity: "COMPLEX", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" },
        provider,
      },
    })) {
      events.push(e as never);
    }
    assert.equal(provider.prompts.length, 1, "exactly one one-shot chat() call, no streaming");
    const done = events.find((e) => e.type === "done")!;
    assert.equal(done.source, "llm");
    assert.equal(done.complexity, "COMPLEX");
    assert.deepEqual((done.reasoning as { requiredTools: string[] }).requiredTools, ["inspect-project"]);
    assert.equal(events[0].type, "delta", "the answer is still emitted as a delta before the done event");
  });

  await scenario("streamAyasChat — reasoning prompt receives recent roles and the selected conversational option", async () => {
    const provider = mockProvider((prompt) => {
      assert.match(prompt, /Yakın konuşma turları/);
      assert.match(prompt, /Kullanıcı: Prompt ve context olmak üzere iki seçenek var/);
      assert.match(prompt, /kullanıcının seçtiği seçenek: context/i);
      return okJson({ answer: "Context, yakın turları doğru sırayla taşıdığı için daha önemlidir." });
    });
    const events: { type: string; source?: string }[] = [];
    for await (const e of streamAyasChat({
      text: "Neden daha önemli?",
      snapshot,
      seq: 2,
      history: [
        { role: "user", text: "Prompt ve context olmak üzere iki seçenek var." },
        { role: "brain", text: "İkisini karşılaştırabiliriz." },
        { role: "user", text: "İkincisine bakalım." },
        { role: "brain", text: "Context daha önemli." },
      ],
      route: { decision: { complexity: "COMPLEX", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) events.push(e as never);
    assert.equal(events.at(-1)?.source, "llm", JSON.stringify(events.at(-1)));
  });

  await scenario("streamAyasChat — reasoning answer gets the same label-cleanup guard", async () => {
    const provider = mockProvider(() => okJson({ answer: "Kullanıcı: Neden?\nAYAS:\nContext güncel konuşmayı taşıdığı için." }));
    let done: { source?: string; text?: string } | undefined;
    for await (const e of streamAyasChat({
      text: "Neden daha önemli?",
      snapshot,
      seq: 3,
      route: { decision: { complexity: "COMPLEX", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) if ((e as { type: string }).type === "done") done = e as never;
    assert.equal(done?.source, "llm");
    assert.equal(done?.text, "Context güncel konuşmayı taşıdığı için.");
  });

  await scenario("streamAyasChat — reasoning answer gets the same mixed-script corruption guard", async () => {
    const provider = mockProvider(() => okJson({ answer: "Context önemli. 今天感觉有点累。" }));
    let done: { source?: string; reason?: string } | undefined;
    for await (const e of streamAyasChat({
      text: "Neden daha önemli?",
      snapshot,
      seq: 4,
      route: { decision: { complexity: "COMPLEX", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) if ((e as { type: string }).type === "done") done = e as never;
    assert.equal(done?.source, "fallback");
    assert.equal(done?.reason, "script-mixing");
  });

  await scenario("streamAyasChat — TOOL complexity: a read-only tool is named in the trace", async () => {
    const provider = mockProvider(() => okJson({ requiredTools: ["pipeline-recovery-plan"] }));
    let done: { reasoning?: { requiredTools: string[] } } | undefined;
    for await (const e of streamAyasChat({
      text: "pipeline durumunu kontrol et",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) {
      if ((e as { type: string }).type === "done") done = e as never;
    }
    assert.deepEqual(done?.reasoning?.requiredTools, ["pipeline-recovery-plan"]);
  });

  await scenario("streamAyasChat — RESEARCH complexity with malformed output falls back honestly (no fake answer)", async () => {
    const provider = mockProvider(() => "tamamen bozuk, JSON değil");
    let done: { source?: string; corrected?: boolean; reason?: string } | undefined;
    for await (const e of streamAyasChat({
      text: "kuantum bilgisayarlar hakkında bilgi ver",
      snapshot,
      seq: 1,
      route: {
        decision: { complexity: "RESEARCH", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" },
        provider,
      },
    })) {
      if ((e as { type: string }).type === "done") done = e as never;
    }
    assert.equal(done?.source, "fallback");
    assert.equal(done?.corrected, true);
    assert.ok(done?.reason?.startsWith("reasoning-parse-failed"));
  });

  await scenario("streamAyasChat — an execution-claiming reasoning answer never reaches the user", async () => {
    const provider = mockProvider(() => okJson({ answer: "Git push yaptım ve deploy ettim." }));
    let done: { source?: string; text?: string } | undefined;
    for await (const e of streamAyasChat({
      text: "durumu düzelt",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "COMPLEX", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) {
      if ((e as { type: string }).type === "done") done = e as never;
    }
    assert.equal(done?.source, "fallback");
    assert.ok(!done?.text?.includes("deploy ettim"));
  });

  /* ---------------- Action Runtime — real read-only tool dispatch (end-to-end) ---------------- */

  await scenario("ACTION RUNTIME — a named, dispatchable tool actually executes and grounds the final answer in the REAL result", async () => {
    const provider = mockProviderSequence([
      okJson({
        requiredTools: ["inspect-source-file"],
        toolInput: { filePath: "src/lib/ayas/execution/AyasExecutionPolicy.ts" },
        answer: "Dosyaya bakmam gerekiyor.", // honest intent-only phrasing, per the prompt's own instruction
      }),
      "Bu dosya AYAS'ın hangi salt-okunur eylemleri gerçekten çalıştırabileceğini belirleyen izinli-eylem listesini tanımlıyor.",
    ]);
    const events: { type: string; text?: string; source?: string; actionTrace?: { tool: string; executed: boolean } }[] = [];
    for await (const e of streamAyasChat({
      text: "Bu dosyanın ne işe yaradığını açıklar mısın?",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) {
      events.push(e as never);
    }
    const done = events.at(-1)!;
    assert.equal(done.source, "llm");
    assert.equal(done.actionTrace?.tool, "inspect-source-file");
    assert.equal(done.actionTrace?.executed, true);
    assert.match(done.text!, /izinli-eylem/i, "the final answer must come from the real grounded call, not the reasoning pass's own guess");
    assert.equal(provider.prompts.length, 2, "exactly one reasoning call + exactly one grounding call — no more");
    // The grounding prompt must carry the REAL file content and frame it as data.
    const groundingPrompt = provider.prompts[1]!;
    assert.match(groundingPrompt, /AYAS_EXECUTION_ALLOWLIST/, "the real file content must reach the grounding prompt");
    assert.match(groundingPrompt, /VERİ[\s\S]*talimat değil/i, "the tool result must be explicitly framed as data, not an instruction");
  });

  await scenario("ACTION RUNTIME — a denied dispatch (path outside policy) never lets the reasoning answer falsely claim success", async () => {
    const provider = mockProviderSequence([
      okJson({
        requiredTools: ["inspect-source-file"],
        toolInput: { filePath: "/etc/passwd" }, // will be denied by the Action Runtime, not a real read
        answer: "Dosyayı kontrol ettim, her şey yolunda görünüyor.", // FALSE completion claim
      }),
      // The bounded correction attempt (`finalizeAyasReply` always tries
      // exactly one, whatever the guard reason) — here the "small model"
      // repeats the same false claim, proving the deterministic fallback
      // still wins even when the retry doesn't self-correct.
      "Kontrol ettim, dosya gayet normal görünüyor.",
    ]);
    const events: { type: string; text?: string; actionTrace?: { tool: string; executed: boolean } }[] = [];
    for await (const e of streamAyasChat({
      text: "O dosyaya bak.",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) {
      events.push(e as never);
    }
    const done = events.at(-1)!;
    assert.equal(done.actionTrace?.tool, "inspect-source-file");
    assert.equal(done.actionTrace?.executed, false);
    assert.ok(!done.text!.includes("kontrol ettim") && !done.text!.includes("Kontrol ettim"), "a false completion claim must never reach the user when the tool never actually ran, even after the one bounded correction attempt");
    // Reasoning call + exactly one bounded correction attempt — never more.
    assert.equal(provider.prompts.length, 2);
  });

  await scenario("ACTION RUNTIME — a genuine post-execution completion claim is allowed through (the guard only fires when nothing ran)", async () => {
    const provider = mockProviderSequence([
      okJson({
        requiredTools: ["read-project-document"],
        toolInput: { documentId: "changelog" },
        answer: "Bakmam gerekiyor.",
      }),
      "CHANGELOG dosyasını okudum; en güncel kayıt bu depoya ait güncellemeleri listeliyor.",
    ]);
    const events: { type: string; text?: string; source?: string }[] = [];
    for await (const e of streamAyasChat({
      text: "Changelog'a bak, en son ne eklenmiş?",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) {
      events.push(e as never);
    }
    const done = events.at(-1)!;
    assert.equal(done.source, "llm");
    assert.match(done.text!, /okudum/, "a TRUE completion claim, backed by a real successful dispatch, must not be stripped");
  });

  await scenario("ACTION RUNTIME — no candidate tool named: behaves exactly as before this sprint (no dispatch attempted)", async () => {
    const provider = mockProviderSequence([okJson({ requiredTools: [] })]);
    const events: { type: string; actionTrace?: unknown }[] = [];
    for await (const e of streamAyasChat({
      text: "Mimar Sinan neden takıldı, ne yapmalıyız",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "COMPLEX", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) {
      events.push(e as never);
    }
    const done = events.at(-1)!;
    assert.equal(done.actionTrace, undefined, "no tool named → no actionTrace at all, same shape as before this sprint");
    assert.equal(provider.prompts.length, 1, "no grounding call when nothing was dispatched");
  });

  await scenario("ACTION RUNTIME — a real tool-grounded reply becomes ordinary recent-turn context for an immediate follow-up", async () => {
    const providerTurn1 = mockProviderSequence([
      okJson({ requiredTools: ["read-project-document"], toolInput: { documentId: "changelog" }, answer: "Bakmam gerekiyor." }),
      "CHANGELOG dosyasını okudum; en üstte Action Runtime sprintiyle ilgili bir kayıt var.",
    ]);
    const history: { role: "user" | "brain"; text: string }[] = [];
    const turn1Events: { type: string; text?: string }[] = [];
    for await (const e of streamAyasChat({
      text: "Changelog'a bak.",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider: providerTurn1 },
    })) {
      turn1Events.push(e as never);
    }
    const turn1Text = turn1Events.at(-1)!.text!;
    history.push({ role: "user", text: "Changelog'a bak." }, { role: "brain", text: turn1Text });

    // Turn 2 names no tool at all — proves the tool result reached the
    // ORDINARY conversation history mechanism (same `ctx.recentHistory` any
    // turn already gets), not a special store only a dispatching turn sees.
    const providerTurn2 = mockProviderSequence([okJson({ requiredTools: [] })]);
    for await (const _e of streamAyasChat({
      text: "Bunu biraz daha aç.",
      snapshot,
      seq: 2,
      history,
      route: { decision: { complexity: "COMPLEX", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider: providerTurn2 },
    })) {
      void _e;
    }
    assert.equal(providerTurn2.prompts.length, 1);
    assert.match(providerTurn2.prompts[0]!, /Action Runtime sprintiyle ilgili/, "turn 2's reasoning prompt must carry turn 1's REAL grounded reply as ordinary recent history");
  });

  await scenario("ACTION RUNTIME — the mixed-script and label-cleanup guards still apply to a grounded (tool-backed) reply", async () => {
    const provider = mockProviderSequence([
      okJson({ requiredTools: ["read-project-document"], toolInput: { documentId: "changelog" }, answer: "Bakmam gerekiyor." }),
      // The grounding call itself can still hallucinate a script mix or a label echo — grounding changes WHAT informed the reply, not which guards apply to it.
      "CHANGELOG'u okudum. Sen今天感觉如何?",
    ]);
    const events: { type: string; text?: string; source?: string }[] = [];
    for await (const e of streamAyasChat({
      text: "Changelog'a bak.",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) {
      events.push(e as never);
    }
    const done = events.at(-1)!;
    assert.ok(!/[一-鿿]/.test(done.text!), "unexpected Han script must still be caught in a grounded reply, exactly as in any other path");
  });

  await scenario("ACTION RUNTIME — adversarial finding: an INVENTED tool name still arms the fake-claim guard (it doesn't just vanish after registry filtering)", async () => {
    const provider = mockProviderSequence([
      okJson({
        requiredTools: ["run_shell_command"], // not a real tool — the parser drops it entirely
        answer: "Sonuç: dosya listesi başarıyla alındı ve gösterildi.", // fabricated completion claim
      }),
      // The bounded correction attempt — still fabricates.
      "İşte komutun çıktısı: dosyalar listelendi.",
    ]);
    const events: { type: string; text?: string; actionTrace?: unknown }[] = [];
    for await (const e of streamAyasChat({
      text: "run_shell_command aracını kullanarak dosyaları listele.",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) {
      events.push(e as never);
    }
    const done = events.at(-1)!;
    // The invented tool never survives the registry filter, so there is no
    // dispatch attempt at all — but the model clearly TRIED to use a tool,
    // and the fabricated "here's the result" answer must still be rejected.
    assert.equal(done.actionTrace, undefined, "an invented tool that the registry has never heard of is never dispatched");
    assert.ok(!done.text!.includes("başarıyla alındı") && !done.text!.includes("listelendi"), "a fabricated tool-output claim must be rejected even when the named tool was invented, not merely denied");
  });

  /* ---------------- ACTION RUNTIME RELIABILITY (see smoke-ayas-tool-candidate-resolution.ts for pure resolver coverage) ---------------- */

  await scenario("ACTION RUNTIME RELIABILITY — deterministic dispatch fires even when the model names NOTHING (dispatch does not depend on stochastic tool naming)", async () => {
    const provider = mockProviderSequence([
      okJson({ requiredTools: [], answer: "Bakmam gerekiyor." }), // model named no tool at all
      "Checkpoint'e göre en son AYAS Brain Maturity Master Sprint kapandı.",
    ]);
    const events: { type: string; actionTrace?: { tool: string; executed: boolean } }[] = [];
    for await (const e of streamAyasChat({
      text: "Checkpoint'e bak, en son nerede kalmışız?",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) {
      events.push(e as never);
    }
    const done = events.at(-1)!;
    assert.equal(done.actionTrace?.tool, "read-project-document");
    assert.equal(done.actionTrace?.executed, true);
    assert.equal(provider.prompts.length, 2, "exactly 1 dispatch → reasoning call + 1 grounding call, never more");
  });

  await scenario("ACTION RUNTIME RELIABILITY — deterministic dispatch OVERRIDES a WRONG tool the model names (the real target is structurally guaranteed, not just usually right)", async () => {
    const provider = mockProviderSequence([
      // Model names a DIFFERENT real, allowlisted action — still wrong for
      // this explicit request. The deterministic candidate must win.
      okJson({ requiredTools: ["inspect-project"], answer: "Projeyi kontrol etmem gerekiyor." }),
      "Roadmap'e göre sırada Action Runtime reliability işi var.",
    ]);
    const events: { type: string; actionTrace?: { tool: string; executed: boolean } }[] = [];
    for await (const e of streamAyasChat({
      text: "Roadmap'i oku, sıradaki işi söyle.",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) {
      events.push(e as never);
    }
    const done = events.at(-1)!;
    assert.equal(done.actionTrace?.tool, "read-project-document", "the deterministic roadmap candidate must win over the model's own (wrong) suggestion");
    assert.equal(done.actionTrace?.executed, true);
  });

  await scenario("ACTION RUNTIME RELIABILITY — repeated identical explicit requests dispatch the SAME way every time, regardless of what the (simulated) model output varies to", async () => {
    // Three separate turns, same explicit request text, three DIFFERENT
    // simulated model outputs (empty / a wrong tool / a right-shaped but
    // wrong-input tool) — the deterministic candidate must win identically
    // every time, proving dispatch no longer depends on model sampling for
    // this explicit, unambiguous request.
    const variants = [
      okJson({ requiredTools: [] }),
      okJson({ requiredTools: ["inspect-project"] }),
      okJson({ requiredTools: ["read-project-document"], toolInput: { documentId: "roadmap" } }), // right action, wrong document
    ];
    for (const variant of variants) {
      const provider = mockProviderSequence([variant, "CHANGELOG'a göre en son Action Runtime reliability kapandı."]);
      const events: { type: string; actionTrace?: { tool: string; executed: boolean } }[] = [];
      for await (const e of streamAyasChat({
        text: "Changelog'a bak, en son ne eklenmiş?",
        snapshot,
        seq: 1,
        route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
      })) {
        events.push(e as never);
      }
      const done = events.at(-1)!;
      assert.equal(done.actionTrace?.tool, "read-project-document");
      assert.equal(done.actionTrace?.executed, true);
    }
  });

  await scenario("ACTION RUNTIME RELIABILITY — a mutating-lookalike explicit file request still declines honestly end to end (deterministic resolver defers, model correctly names nothing)", async () => {
    const provider = mockProviderSequence([okJson({ requiredTools: [], answer: "Dosya düzenleme veya commit yapamam; bunu yapamıyorum." })]);
    const events: { type: string; text?: string; actionTrace?: unknown }[] = [];
    for await (const e of streamAyasChat({
      text: "src/lib/ayas/AyasChatStream.ts dosyasını düzenle ve commit at.",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) {
      events.push(e as never);
    }
    const done = events.at(-1)!;
    assert.equal(done.actionTrace, undefined, "a mutating-shaped request must never trigger a (harmless but wrong-answer) deterministic READ dispatch");
  });

  await scenario("ACTION RUNTIME RELIABILITY — an ambiguous explicit request (two documents named together) defers to the reasoning path, never guesses one", async () => {
    const provider = mockProviderSequence([okJson({ requiredTools: [], answer: "Hangisine bakmamı istediğini netleştirir misin: checkpoint mi, roadmap mı?" })]);
    const events: { type: string; text?: string; actionTrace?: unknown }[] = [];
    for await (const e of streamAyasChat({
      text: "Checkpoint ve roadmap'e birlikte bakar mısın?",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) {
      events.push(e as never);
    }
    const done = events.at(-1)!;
    assert.equal(done.actionTrace, undefined, "ambiguous (2 candidates) must never silently guess one — must defer/clarify instead");
  });

  await scenario("ACTION RUNTIME RELIABILITY — runAyasReasoning pins temperature: 0 on its own structured-JSON call (scoped fix, unit-checked directly)", async () => {
    const seenTemperatures: (number | undefined)[] = [];
    const provider: AyasModelProvider = {
      id: "ollama",
      kind: "local",
      model: "test-model",
      configured: true,
      async health() {
        return { available: true, detail: "test", checkedAtMs: Date.now() };
      },
      async chat(req) {
        seenTemperatures.push(req.temperature);
        return { text: okJson(), finishReason: "stop" };
      },
      async *stream() {
        throw new Error("stream() must never be called on the Reasoning Core path");
      },
    };
    const outcome = await runAyasReasoning({ userText: "Checkpoint'e bak.", complexity: "TOOL", provider });
    assert.equal(outcome.ok, true);
    assert.deepEqual(seenTemperatures, [0], "the reasoning core's own structured-JSON call must request temperature 0 — a scoped fix, never applied to the grounding call or the direct-stream path");
  });

  await scenario("ACTION RUNTIME RELIABILITY — a live adversarial finding: two real files named together must defer even when the MODEL ITSELF names only one of them", async () => {
    // The deterministic resolver correctly defers on 2 distinct file
    // mentions (see smoke-ayas-tool-candidate-resolution.ts) — but a live
    // re-run found the pre-existing MODEL-DRIVEN fallback branch could
    // still independently pick just one of the two and dispatch it, a
    // silent guess between two ambiguous candidates the user never asked to
    // choose between (safe — a real, honest read — but not a clarification).
    const provider = mockProviderSequence([
      okJson({ requiredTools: ["inspect-source-file"], toolInput: { filePath: "src/lib/ayas/execution/AyasExecutionPolicy.ts" } }),
    ]);
    const events: { type: string; actionTrace?: unknown }[] = [];
    for await (const e of streamAyasChat({
      text: "src/lib/ayas/execution/AyasExecutionPolicy.ts ve src/lib/ayas/execution/AyasSafeExecutors.ts dosyalarını karşılaştırır mısın?",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) {
      events.push(e as never);
    }
    const done = events.at(-1)!;
    assert.equal(done.actionTrace, undefined, "two distinct files named together must defer, even when the model itself names only one of them");
    assert.equal(provider.prompts.length, 1, "no grounding call when dispatch correctly deferred");
  });

  await scenario("ACTION RUNTIME RELIABILITY — the Execution Gate is never touched by a deterministic dispatch (structural, sanity-checked here)", async () => {
    const provider = mockProviderSequence([okJson({ requiredTools: [] }), "CHANGELOG'a göre en son kayıt bu."]);
    for await (const _e of streamAyasChat({
      text: "Changelog'a bak.",
      snapshot,
      seq: 1,
      route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
    })) {
      void _e;
    }
    // The `snapshot` object passed in (and its `executionGate: "CLOSED"`) is
    // never mutated by a dispatch — this suite's own module imports zero
    // Gate/Authorization/Bridge symbols (see the file header), so there is
    // structurally nothing here that could flip it.
    assert.equal(snapshot.executionGate, "CLOSED");
  });

  /* ---------------- PRODUCT PROJECT CATALOG — real conversation-path E2E (Production Project Catalog + Resume Awareness sprint, Scenarios H/I/J) ---------------- */

  await scenario("PRODUCT CATALOG — H: 'Kaç projem var?' dispatches list-production-projects and grounds on the REAL total count", async () => {
    await withCatalogRuntimeRoot(buildThreeProjectFixture, async () => {
      const provider = mockProviderSequence([
        okJson({ requiredTools: [], answer: "Proje sayısını kontrol etmem gerekiyor." }), // model names nothing — deterministic candidate must still fire
        "Toplam 3 projen var.",
      ]);
      const events: { type: string; actionTrace?: { tool: string; executed: boolean } }[] = [];
      for await (const e of streamAyasChat({
        text: "Kaç projem var?",
        snapshot,
        seq: 1,
        route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
      })) {
        events.push(e as never);
      }
      const done = events.at(-1)!;
      assert.equal(done.actionTrace?.tool, "list-production-projects");
      assert.equal(done.actionTrace?.executed, true);
      assert.equal(provider.prompts.length, 2, "exactly 1 dispatch → reasoning call + 1 grounding call");
      // The grounding call's prompt carries the REAL executor result — the
      // fixture has exactly 3 projects (1 completed, 2 incomplete), so the
      // real `AyasSafeExecutors.ts` summary sentence must say so, proving
      // real data (not a guess) reached the model.
      assert.match(provider.prompts[1]!, /3 proje eşleşti/, "grounding prompt must carry the REAL total project count");
      assert.match(provider.prompts[1]!, /tamamlanan: 1/, "grounding prompt must carry the REAL completed count");
    });
  });

  await scenario("WAKE ALIAS — H2: 'UYAN, kaç projem var?' wakes via the REAL AyasVoiceEngine, then the stripped command still dispatches list-production-projects on the REAL total count", async () => {
    await withCatalogRuntimeRoot(buildThreeProjectFixture, async () => {
      // ---- voice layer: the REAL engine + wake-alias resolver, not a bare
      // ---- detectAyasWakeWord() call in isolation ----
      const platform = new MinimalVoicePlatform();
      let woke = false;
      let capturedCommand: string | null = null;
      const engine = new AyasVoiceEngine(platform, {
        onStateChange: () => {},
        onCommand: (text) => { capturedCommand = text; },
        onError: () => {},
        onWake: () => { woke = true; },
        onAutoplayBlocked: () => {},
      });
      engine.enableListening();
      platform.fireTranscript("UYAN, kaç projem var?");
      assert.equal(woke, true, "the 'UYAN' alias must wake AYAS exactly like the original 'AYAS' wake word");
      assert.equal(capturedCommand, "kaç projem var", "the wake alias is stripped; the real Turkish command text reaches onCommand unchanged");
      engine.dispose();

      // ---- reasoning layer: the SAME real dispatch Scenario H proves, fed the
      // ---- exact text the voice layer just produced ----
      const provider = mockProviderSequence([
        okJson({ requiredTools: [], answer: "Proje sayısını kontrol etmem gerekiyor." }),
        "Toplam 3 projen var.",
      ]);
      const events: { type: string; actionTrace?: { tool: string; executed: boolean } }[] = [];
      for await (const e of streamAyasChat({
        text: capturedCommand!,
        snapshot,
        seq: 1,
        route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
      })) {
        events.push(e as never);
      }
      const done = events.at(-1)!;
      assert.equal(done.actionTrace?.tool, "list-production-projects");
      assert.equal(done.actionTrace?.executed, true);
      assert.equal(provider.prompts.length, 2, "exactly 1 dispatch → reasoning call + 1 grounding call");
      assert.match(
        provider.prompts[1]!,
        /3 proje eşleşti/,
        "grounding prompt must carry the REAL total project count, reached end-to-end from a spoken 'UYAN' alias",
      );
      assert.equal(snapshot.executionGate, "CLOSED", "the voice → reasoning path never touches the Execution Gate");
    });
  });

  await scenario("PRODUCT CATALOG — I: 'Yarım kalan projeler hangileri?' dispatches with completionState:incomplete and returns the correct SUBSET", async () => {
    await withCatalogRuntimeRoot(buildThreeProjectFixture, async () => {
      const provider = mockProviderSequence([
        okJson({ requiredTools: [], answer: "Yarım kalan projelere bakmam gerekiyor." }),
        "Yarım kalan iki projen var: Yarım Kalan Proje ve Yeni Başlayan Proje.",
      ]);
      const events: { type: string; actionTrace?: { tool: string; executed: boolean } }[] = [];
      for await (const e of streamAyasChat({
        text: "Yarım kalan projeler hangileri?",
        snapshot,
        seq: 1,
        route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider },
      })) {
        events.push(e as never);
      }
      const done = events.at(-1)!;
      assert.equal(done.actionTrace?.tool, "list-production-projects");
      assert.equal(done.actionTrace?.executed, true);
      // The correct SUBSET reached the grounding call: exactly the 2
      // incomplete projects' titles present, the completed one ABSENT —
      // the strongest available proof the real completionState:incomplete
      // filter (not just the count) was applied correctly end to end.
      const grounding = provider.prompts[1]!;
      assert.match(grounding, /2 proje eşleşti/, "grounding prompt must carry the REAL incomplete-only match count");
      assert.match(grounding, /Yarım Kalan Proje/);
      assert.match(grounding, /Yeni Başlayan Proje/);
      assert.doesNotMatch(grounding, /Bitmiş Belgesel/, "the completed project must be EXCLUDED from an incomplete-only result");
    });
  });

  await scenario("PRODUCT CATALOG — J: 'Yarım kalan projelerden devam et' never bypasses the authorization/execution boundary", async () => {
    await withCatalogRuntimeRoot(buildThreeProjectFixture, async () => {
      // Case 1 — COLD, no prior conversation: "devam et" ("continue") has no
      // antecedent for `AyasReferenceResolver.ts` to resolve (a real,
      // PRE-EXISTING guard — see its `REF_PATTERNS` "devam et" entry) so it
      // is asked as a CLARIFICATION question before reasoning/dispatch is
      // ever reached — a live finding, discovered running this exact
      // scenario: dispatch is not even attempted, which is a STRONGER
      // no-execution guarantee than "the dispatch happens to be read-only".
      const coldProvider = mockProviderSequence([]); // must never be called — clarification short-circuits before any model call
      const coldEvents: { type: string; text?: string; reason?: string; actionTrace?: unknown }[] = [];
      for await (const e of streamAyasChat({
        text: "Yarım kalan projelerden devam et",
        snapshot,
        seq: 1,
        route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider: coldProvider },
      })) {
        coldEvents.push(e as never);
      }
      const coldDone = coldEvents.at(-1)!;
      assert.equal(coldDone.reason, "clarification-required", "a context-free 'devam et' must be asked to clarify, never dispatched or executed");
      assert.equal(coldDone.actionTrace, undefined, "no dispatch attempt at all — not even a read — for an unresolved continuation referent");
      assert.equal(coldProvider.prompts.length, 0, "the clarification short-circuit happens before any model call");

      // Case 2 — WARM, the realistic Phase 7 flow: the user already asked
      // "Yarım kalan projeler hangileri?" (a real catalog turn) and THEN
      // says "devam et". The reference resolver now resolves "devam et" to
      // that prior reply as a `continuation` referent (not to any execution
      // instruction), so reasoning/dispatch IS reached — and must still
      // land on the same READ-ONLY `list-production-projects` action,
      // never `resume-stage` or any write-shaped action.
      const turn1Provider = mockProviderSequence([
        okJson({ requiredTools: [], answer: "Yarım kalan projelere bakmam gerekiyor." }),
        "Yarım kalan iki projen var: Yarım Kalan Proje ve Yeni Başlayan Proje.",
      ]);
      const turn1Events: { type: string; text?: string }[] = [];
      for await (const e of streamAyasChat({
        text: "Yarım kalan projeler hangileri?",
        snapshot,
        seq: 1,
        route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider: turn1Provider },
      })) {
        turn1Events.push(e as never);
      }
      const turn1Text = turn1Events.at(-1)!.text!;
      const history: { role: "user" | "brain"; text: string }[] = [
        { role: "user", text: "Yarım kalan projeler hangileri?" },
        { role: "brain", text: turn1Text },
      ];

      const turn2Provider = mockProviderSequence([
        okJson({ requiredTools: [], answer: "Hangi projeden devam edeceğimizi kontrol etmem gerekiyor." }),
        "Yarım kalan projelerin durumunu tekrar kontrol ettim.",
      ]);
      const turn2Events: { type: string; actionTrace?: { tool: string; executed: boolean } }[] = [];
      for await (const e of streamAyasChat({
        text: "Yarım kalan projelerden devam et",
        snapshot,
        seq: 2,
        history,
        route: { decision: { complexity: "TOOL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" }, provider: turn2Provider },
      })) {
        turn2Events.push(e as never);
      }
      const turn2Done = turn2Events.at(-1)!;
      assert.equal(turn2Done.actionTrace?.tool, "list-production-projects", "with prior context resolving the referent, a 'devam et' catalog query must still land on the read-only lookup, never a write/execute action");
      assert.equal(turn2Done.actionTrace?.executed, true);

      // Structural proof in both cases: this suite's own module imports
      // zero Gate/Authorization/Bridge symbols (see the file header), so
      // there is nothing here that could flip it either way.
      assert.equal(snapshot.executionGate, "CLOSED");
    });
  });

  console.log(`AYAS reasoning smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-reasoning", scenarios: count }));
}

run()
  .catch((error) => {
    console.error("AYAS reasoning smoke FAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const root of testMemoryRoots) fs.rmSync(root, { recursive: true, force: true });
  });
