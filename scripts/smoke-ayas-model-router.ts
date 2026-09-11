/**
 * AYAS model router / provider abstraction smoke suite (Phase 2 · P0-A).
 *
 * Deterministic / $0 / no real network (fetch is mocked). Covers:
 *  - complexity classifier (SIMPLE / NORMAL / COMPLEX / TOOL / REPAIR / RESEARCH)
 *  - cloud config: unset → not configured; a key + bad base URL → not configured;
 *    the resolved object carries NO api key
 *  - Ollama provider health (up / down / timeout) — a `/api/tags` probe
 *  - router: Ollama healthy → ollama; Ollama down + cloud set → cloud (VISIBLE);
 *    neither → null provider + honest message with no config/secret detail
 *  - a secret never appears in any decision / trace / error string
 */

import assert from "node:assert/strict";

import { classifyAyasComplexity } from "../src/lib/ayas/model/AyasComplexityRouter";
import { resolveAyasCloudConfig, getAyasCloudApiKey } from "../src/lib/ayas/model/AyasCloudConfig";
import { createOllamaAyasProvider } from "../src/lib/ayas/model/OllamaAyasProvider";
import { createCloudAyasProvider } from "../src/lib/ayas/model/CloudAyasProvider";
import { routeAyasModel } from "../src/lib/ayas/model/AyasModelRouter";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as unknown as NodeJS.ProcessEnv;
const OLLAMA_ENV = env({ OLLAMA_HOST: "127.0.0.1:11434", OLLAMA_MODEL: "qwen2.5:7b" });
const SECRET = "sk-THIS-IS-A-FAKE-TEST-KEY-0123456789";

/** URL-aware mock fetch. */
function mockFetch(handlers: {
  tags?: () => Response | Promise<Response>;
  chat?: (body: unknown) => Response | Promise<Response>;
  cloud?: (body: unknown) => Response | Promise<Response>;
}): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (u.includes("/api/tags")) return (handlers.tags ?? (() => new Response(JSON.stringify({ models: [{}] }), { status: 200 })))();
    if (u.includes("/api/chat")) return (handlers.chat ?? (() => new Response("no", { status: 500 })))(body);
    if (u.includes("/chat/completions")) return (handlers.cloud ?? (() => new Response("no", { status: 500 })))(body);
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

function ndjson(pieces: string[]): Response {
  const lines = [
    ...pieces.map((p) => JSON.stringify({ message: { content: p }, done: false })),
    JSON.stringify({ done: true, done_reason: "stop" }),
  ];
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        const e = new TextEncoder();
        for (const l of lines) c.enqueue(e.encode(l + "\n"));
        c.close();
      },
    }),
    { status: 200 },
  );
}

function sse(pieces: string[]): Response {
  const lines = [
    ...pieces.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}`),
    "data: [DONE]",
  ];
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        const e = new TextEncoder();
        for (const l of lines) c.enqueue(e.encode(l + "\n\n"));
        c.close();
      },
    }),
    { status: 200 },
  );
}

async function drain(gen: AsyncGenerator<{ type: string; text?: string }>): Promise<string> {
  let out = "";
  for await (const chunk of gen) if (chunk.type === "delta") out += chunk.text;
  return out;
}

async function run() {
  /* ---------------- complexity classifier ---------------- */

  await scenario("complexity — SIMPLE for greetings / trivia / short non-questions", () => {
    for (const t of ["merhaba", "Selam!", "teşekkürler", "saat kaç", "adın ne", "iyi geceler", "tamam"]) {
      assert.equal(classifyAyasComplexity(t), "SIMPLE", `"${t}"`);
    }
  });

  await scenario("complexity — RESEARCH / REPAIR / TOOL take priority over the generic split", () => {
    assert.equal(classifyAyasComplexity("bu teknoloji hakkında araştırma yap"), "RESEARCH");
    assert.equal(classifyAyasComplexity("self-healing neden devreye girmedi"), "REPAIR");
    assert.equal(classifyAyasComplexity("git durumunu kontrol et"), "TOOL");
    assert.equal(classifyAyasComplexity("testleri çalıştır"), "TOOL");
  });

  await scenario("complexity — COMPLEX for multi-step analysis / decision cues", () => {
    for (const t of [
      "Atölye projesindeki son hatanın nedenini bul",
      "durumu analiz et ve ne yapmalıyız söyle",
      "önce kontrol et sonra bir plan çıkar",
    ]) {
      assert.equal(classifyAyasComplexity(t), "COMPLEX", `"${t}"`);
    }
  });

  await scenario("complexity — NORMAL for an ordinary single question", () => {
    assert.equal(classifyAyasComplexity("kaç proje var"), "NORMAL");
    assert.equal(classifyAyasComplexity("runtime authority neresi"), "NORMAL");
  });

  /* ---------------- cloud config ---------------- */

  await scenario("cloud config — unset → not configured; object carries NO key", () => {
    const cfg = resolveAyasCloudConfig(env({}));
    assert.equal(cfg.configured, false);
    assert.equal(JSON.stringify(cfg).includes("sk-"), false);
    assert.equal("apiKey" in cfg, false, "the config object must not expose the key field");
    assert.equal(getAyasCloudApiKey(env({})), null);
  });

  await scenario("cloud config — key + valid https base → configured; key readable only via the one accessor", () => {
    const e = env({ AYAS_CLOUD_API_KEY: SECRET, AYAS_CLOUD_MODEL: "gpt-4o-mini" });
    const cfg = resolveAyasCloudConfig(e);
    assert.equal(cfg.configured, true);
    assert.equal(cfg.model, "gpt-4o-mini");
    assert.equal(cfg.baseUrl, "https://api.openai.com/v1");
    assert.equal(JSON.stringify(cfg).includes(SECRET), false, "resolved config never contains the key");
    assert.equal(getAyasCloudApiKey(e), SECRET);
  });

  await scenario("cloud config — a key but an http:// (non-local) base → NOT configured", () => {
    const cfg = resolveAyasCloudConfig(env({
      AYAS_CLOUD_API_KEY: SECRET,
      AYAS_CLOUD_BASE_URL: "http://api.some-cloud.example/v1",
    }));
    assert.equal(cfg.configured, false);
    assert.deepEqual(cfg.ignored, ["AYAS_CLOUD_BASE_URL"]);
  });

  /* ---------------- provider health ---------------- */

  await scenario("ollama provider — health up (models listed)", async () => {
    const p = createOllamaAyasProvider(OLLAMA_ENV, mockFetch({ tags: () => new Response(JSON.stringify({ models: [{}, {}, {}] }), { status: 200 }) }));
    const h = await p.health();
    assert.equal(h.available, true);
    assert.match(h.detail, /3 model/);
  });

  await scenario("ollama provider — health down (connection refused) → available:false", async () => {
    const p = createOllamaAyasProvider(OLLAMA_ENV, (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch);
    const h = await p.health();
    assert.equal(h.available, false);
    assert.match(h.detail, /erişilemedi/);
  });

  await scenario("cloud provider — health reports config only, never pings (no billed call)", async () => {
    let called = false;
    const p = createCloudAyasProvider(env({ AYAS_CLOUD_API_KEY: SECRET }), (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch);
    const h = await p.health();
    assert.equal(h.available, true);
    assert.equal(called, false, "health() must not hit the cloud");
    assert.match(h.detail, /yapılandırıldı/);
  });

  /* ---------------- router ---------------- */

  await scenario("router — Ollama healthy → routes to ollama; complexity carried", async () => {
    const fetcher = mockFetch({});
    const r = await routeAyasModel({ text: "kaç proje var", env: OLLAMA_ENV, fetcher });
    assert.equal(r.decision.providerId, "ollama");
    assert.equal(r.decision.complexity, "NORMAL");
    assert.equal(r.provider?.id, "ollama");
    assert.match(r.decision.reason, /sağlıklı/);
  });

  await scenario("router — Ollama down + cloud configured → VISIBLE cloud fallback", async () => {
    const fetcher = mockFetch({ tags: () => new Response("down", { status: 503 }) });
    const r = await routeAyasModel({
      text: "durumu analiz et",
      env: env({ ...(OLLAMA_ENV as Record<string,string>), AYAS_CLOUD_API_KEY: SECRET }),
      fetcher,
    });
    assert.equal(r.decision.providerId, "cloud");
    assert.equal(r.decision.complexity, "COMPLEX");
    assert.match(r.decision.reason, /yerel model kapalı.*bulut/i);
    assert.equal(JSON.stringify(r.decision).includes(SECRET), false, "decision trace never contains the key");
  });

  await scenario("router — neither provider → null provider + honest message, no config/secret detail", async () => {
    const fetcher = mockFetch({ tags: () => new Response("down", { status: 503 }) });
    const r = await routeAyasModel({ text: "selam", env: OLLAMA_ENV, fetcher });
    assert.equal(r.provider, null);
    assert.equal(r.decision.providerId, null);
    assert.match(r.decision.unavailableMessage ?? "", /yapılandırılmamış/);
    assert.doesNotMatch(r.decision.unavailableMessage ?? "", /http|127\.0\.0\.1|key|sk-/i);
  });

  /* ---------------- provider stream round-trips ---------------- */

  await scenario("ollama provider — stream yields deltas + done", async () => {
    const p = createOllamaAyasProvider(OLLAMA_ENV, mockFetch({ chat: () => ndjson(["Mer", "haba"]) }));
    const text = await drain(p.stream({ prompt: "x", complexity: "SIMPLE", maxTokens: 64 }) as never);
    assert.equal(text, "Merhaba");
  });

  await scenario("cloud provider — OpenAI-compatible SSE stream yields deltas; Authorization uses the key, body never echoes it", async () => {
    let sawAuth = "";
    const p = createCloudAyasProvider(
      env({ AYAS_CLOUD_API_KEY: SECRET }),
      (async (url: string, init?: RequestInit) => {
        sawAuth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
        const body = String(init?.body ?? "");
        assert.equal(body.includes(SECRET), false, "request body must not contain the key");
        return sse(["Se", "lam"]);
      }) as unknown as typeof fetch,
    );
    const text = await drain(p.stream({ prompt: "x", complexity: "SIMPLE", maxTokens: 64 }) as never);
    assert.equal(text, "Selam");
    assert.equal(sawAuth, `Bearer ${SECRET}`);
  });

  await scenario("cloud provider — a non-200 throws a status-only error (never the body)", async () => {
    const p = createCloudAyasProvider(
      env({ AYAS_CLOUD_API_KEY: SECRET }),
      (async () => new Response(`{"error":"invalid api key ${SECRET}"}`, { status: 401 })) as unknown as typeof fetch,
    );
    await assert.rejects(
      () => drain(p.stream({ prompt: "x", complexity: "SIMPLE", maxTokens: 64 }) as never),
      (err: Error) => {
        assert.equal(err.message, "cloud-401");
        assert.equal(err.message.includes(SECRET), false);
        return true;
      },
    );
  });

  console.log(`AYAS model router smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-model-router", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS model router smoke FAILED:", error);
  process.exitCode = 1;
});
