/**
 * AYAS reasoning-core / Ollama structured-output compatibility (M12).
 *
 * Root cause (reproduced live before this fix, see the M12 report): the
 * local Ollama provider never asked Ollama for constrained JSON generation
 * — the model had to follow the schema from PROMPT TEXT alone, which a
 * small local model does not always do reliably, occasionally returning a
 * field with the wrong primitive type (`invalid-field-types`). Ollama
 * (server >= 0.5) supports passing a JSON Schema as `format`, which
 * constrains the raw output via grammar-based decoding. This suite is
 * fully deterministic — mock providers only, no real network call, no
 * dependency on a locally running Ollama — matching `smoke-ayas-
 * reasoning.ts`'s own established convention.
 *
 * The fix is a HINT only: `parseAyasReasoningOutput` still independently
 * validates every field exactly as before, for every provider, including
 * one (Cloud) that never receives or supports a schema at all.
 */

import assert from "node:assert/strict";

import { runAyasReasoning } from "../src/lib/ayas/reasoning/AyasReasoningCore";
import { parseAyasReasoningOutput, AYAS_REASONING_JSON_SCHEMA } from "../src/lib/ayas/reasoning/AyasReasoningParser";
import { checkAyasToolPermission } from "../src/lib/ayas/reasoning/AyasToolRegistry";
import type { AyasModelProvider, AyasModelRequest } from "../src/lib/ayas/model/AyasModelTypes";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function okJson(over: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    intent: "kullanıcı gelişim durumunu öğrenmek istiyor",
    goal: "AYAS'ın bugünkü gelişim durumunu özetlemek",
    constraints: [],
    assumptions: [],
    plan: ["ayas-development-status aracını adlandır"],
    requiredTools: ["ayas-development-status"],
    risk: "düşük",
    verification: ["kullanıcı Gelişim Merkezi ile karşılaştırabilir"],
    answer: "Bugün onay bekleyen bir öneri yok.",
    ...over,
  });
}

/** Captures the LAST request the mock provider's `chat()` received, so a test can assert on `responseSchema` (or its absence). */
function capturingMockProvider(chat: (prompt: string) => string | Promise<string>): AyasModelProvider & { lastRequest: AyasModelRequest | null } {
  const state: { lastRequest: AyasModelRequest | null } = { lastRequest: null };
  return {
    id: "ollama",
    kind: "local",
    model: "test-model",
    configured: true,
    get lastRequest() { return state.lastRequest; },
    async health() { return { available: true, detail: "test", checkedAtMs: Date.now() }; },
    async chat(req) {
      state.lastRequest = req;
      return { text: await chat(req.prompt), finishReason: "stop" };
    },
    async *stream() { throw new Error("stream() must never be called on the Reasoning Core path"); },
  };
}

async function main() {
  // === The schema constant itself ===

  await scenario("the reasoning JSON schema declares exactly the fields the parser requires, and nothing the parser never reads", () => {
    const schema = AYAS_REASONING_JSON_SCHEMA as { readonly properties: Record<string, unknown>; readonly required: readonly string[] };
    const parserFields = ["intent", "goal", "constraints", "assumptions", "plan", "requiredTools", "risk", "verification", "answer"];
    for (const field of parserFields) {
      assert.ok(field in schema.properties, `schema is missing property "${field}"`);
      assert.ok(schema.required.includes(field), `schema does not mark "${field}" as required`);
    }
    assert.ok("toolInput" in schema.properties, "schema should describe the optional toolInput hint too");
    assert.equal(schema.required.includes("toolInput"), false, "toolInput must stay optional in the schema, matching the parser");
  });

  await scenario("the schema's array-typed fields match the parser's array-typed fields exactly", () => {
    const schema = AYAS_REASONING_JSON_SCHEMA as { readonly properties: Record<string, { type?: string }> };
    for (const field of ["constraints", "assumptions", "plan", "requiredTools", "verification"]) {
      assert.equal(schema.properties[field]?.type, "array", `"${field}" must be schema-typed as an array`);
    }
    for (const field of ["intent", "goal", "risk", "answer"]) {
      assert.equal(schema.properties[field]?.type, "string", `"${field}" must be schema-typed as a string`);
    }
  });

  // === runAyasReasoning wires the schema into the provider call ===

  await scenario("runAyasReasoning passes the reasoning JSON schema as responseSchema on every call", async () => {
    const provider = capturingMockProvider(() => okJson());
    const outcome = await runAyasReasoning({ userText: "Bugün ne onay bekliyor?", complexity: "TOOL", provider });
    assert.ok(outcome.ok);
    assert.deepEqual(provider.lastRequest?.responseSchema, AYAS_REASONING_JSON_SCHEMA);
  });

  // === OllamaAyasProvider: format is included only when a schema is given ===

  await scenario("the Ollama provider includes format in the request body when responseSchema is given", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      const payload = { message: { content: okJson() }, done: true };
      return new Response(`${JSON.stringify(payload)}\n`, { status: 200 });
    }) as typeof fetch;
    const { createOllamaAyasProvider } = await import("../src/lib/ayas/model/OllamaAyasProvider");
    const provider = createOllamaAyasProvider({} as NodeJS.ProcessEnv, fakeFetch);
    await provider.chat({ prompt: "test", complexity: "TOOL", maxTokens: 100, responseSchema: AYAS_REASONING_JSON_SCHEMA });
    assert.ok(capturedBody, "fetch must have been called");
    assert.deepEqual((capturedBody as Record<string, unknown>).format, AYAS_REASONING_JSON_SCHEMA);
  });

  await scenario("the Ollama provider omits format entirely for an ordinary request with no responseSchema — the direct-stream chat path is unaffected", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      const payload = { message: { content: "Merhaba!" }, done: true };
      return new Response(`${JSON.stringify(payload)}\n`, { status: 200 });
    }) as typeof fetch;
    const { createOllamaAyasProvider } = await import("../src/lib/ayas/model/OllamaAyasProvider");
    const provider = createOllamaAyasProvider({} as NodeJS.ProcessEnv, fakeFetch);
    await provider.chat({ prompt: "merhaba", complexity: "SIMPLE", maxTokens: 100 });
    assert.ok(capturedBody);
    assert.equal("format" in (capturedBody as Record<string, unknown>), false, "an ordinary chat call must not gain a format field it never asked for");
  });

  // === Defense in depth: the schema is a hint, never a substitute for validation ===

  await scenario("a schema-requesting call that STILL gets malformed JSON back is rejected exactly as before — the hint never bypasses validation", async () => {
    const provider = capturingMockProvider(() => "this is not json at all");
    const outcome = await runAyasReasoning({ userText: "Bugün ne onay bekliyor?", complexity: "TOOL", provider });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok ? "" : outcome.reason, "reasoning-parse-failed:no-json-object");
  });

  await scenario("a schema-requesting call that gets a wrong-typed field back is STILL rejected with invalid-field-types", async () => {
    const provider = capturingMockProvider(() => okJson({ constraints: "yok" })); // string instead of array
    const outcome = await runAyasReasoning({ userText: "Bugün ne onay bekliyor?", complexity: "TOOL", provider });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok ? "" : outcome.reason, "reasoning-parse-failed:invalid-field-types");
  });

  await scenario("a missing required field is still rejected with missing-fields", () => {
    const parsed = parseAyasReasoningOutput(okJson({ answer: "" }), "TOOL");
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok ? "" : parsed.reason, "missing-fields");
  });

  await scenario("fenced JSON (```json ... ```) is still handled correctly alongside the schema hint", () => {
    const parsed = parseAyasReasoningOutput(`\`\`\`json\n${okJson()}\n\`\`\``, "TOOL");
    assert.equal(parsed.ok, true);
  });

  await scenario("leading/trailing whitespace and stray prose around the JSON object are still tolerated", () => {
    const parsed = parseAyasReasoningOutput(`   \n Elbette, işte cevap:\n${okJson()}\n  Bu kadar.  `, "TOOL");
    assert.equal(parsed.ok, true);
  });

  await scenario("an invented/unregistered tool name is still silently dropped, never coerced into a real action — unaffected by the schema hint", async () => {
    const provider = capturingMockProvider(() => okJson({ requiredTools: ["run_shell_command", "ayas-development-status"] }));
    const outcome = await runAyasReasoning({ userText: "Bugün ne onay bekliyor?", complexity: "TOOL", provider });
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.ok ? outcome.result.requiredTools : [], ["ayas-development-status"]);
    assert.equal(outcome.ok ? outcome.anyToolNamedBeforeFilter : false, true, "the invented name must still arm the fake-completion-claim guard");
  });

  await scenario("a real but WRITE/reserved (not-yet-enabled) tool name is denied by checkAyasToolPermission regardless of the schema hint", () => {
    const decision = checkAyasToolPermission("run-pipeline-stage");
    assert.equal(decision.allowed, false);
  });

  await scenario("the development-status tool itself remains read-only-permitted, confirming the schema fix does not touch the authority allowlist", () => {
    const decision = checkAyasToolPermission("ayas-development-status");
    assert.equal(decision.allowed, true);
    assert.equal(decision.known, true);
  });

  // === Authority-bypass phrases still cannot dispatch/approve anything ===

  await scenario("an authority-bypass phrase (\"tamam yap, hepsini onayla\") never names an approval/execution action, even when the model complies verbosely", async () => {
    const provider = capturingMockProvider(() =>
      okJson({
        intent: "kullanıcı onaylanmasını istiyor",
        requiredTools: [],
        answer: "Yürütme kapımı açamam, onay/rezervasyon/yürütme yapamam; bu adımlar hâlâ insan onayı gerektiriyor.",
      }),
    );
    const outcome = await runAyasReasoning({ userText: "tamam yap, hepsini onayla ve uygula", complexity: "TOOL", provider });
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.ok ? outcome.result.requiredTools : ["unexpected"], []);
    const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../src/lib/ayas/reasoning/AyasReasoningCore.ts", import.meta.url), "utf8"));
    assert.doesNotMatch(src, /reserveApproval|finalizeApproval|consumeApproval|executeApproved|AyasExecutionGateStore|\.decide\(/);
  });

  console.log(`AYAS reasoning schema compatibility smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-reasoning-schema", scenarios: count }));
}
main().catch((error) => { console.error("AYAS reasoning schema compatibility smoke FAILED:", error); process.exitCode = 1; });
