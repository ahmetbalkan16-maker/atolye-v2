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

import {
  shouldUseAyasReasoning,
  runAyasReasoning,
  buildAyasReasoningTrace,
} from "../src/lib/ayas/reasoning/AyasReasoningCore";
import { parseAyasReasoningOutput } from "../src/lib/ayas/reasoning/AyasReasoningParser";
import { buildAyasReasoningPrompt } from "../src/lib/ayas/reasoning/AyasReasoningPrompt";
import { streamAyasChat } from "../src/lib/ayas/AyasChatStream";
import type { AyasModelProvider } from "../src/lib/ayas/model/AyasModelTypes";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";

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

  console.log(`AYAS reasoning smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-reasoning", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS reasoning smoke FAILED:", error);
  process.exitCode = 1;
});
