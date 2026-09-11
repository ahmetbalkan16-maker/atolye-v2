/**
 * AYAS phone-off-PC runtime smoke suite (Phase 2 · P0-A.4 · Option A).
 *
 * Deterministic / $0 / no real network. Two halves:
 *
 *  1. The Cloudflare Worker handler (`cloudflare/ayas-phone-gateway/src/worker.ts`)
 *     — exercised directly with Node's built-in `Request`/`Response`/`fetch`
 *     (Cloudflare Workers and Node 18+ share the same Fetch API surface, so
 *     this is a real functional test of the actual deployed code, not a
 *     reimplementation of it). The one external call it can make (the cloud
 *     LLM) is mocked via a temporary `globalThis.fetch` patch, restored after
 *     every scenario.
 *  2. The browser-side fallback orchestration (`ayasChatStreamClient.ts` /
 *     `ayasPhoneFallback.ts`) — PC-reachable vs PC-unreachable routing, with a
 *     mock `fetch` injected the normal way (no global patch needed there).
 *
 * Covers the spec's "Phone" test list: PC online → local; PC unavailable +
 * cloud → Worker/cloud; neither → honest failure; no client API key; no
 * secret in response; no secret in trace.
 */

import assert from "node:assert/strict";

import ayasPhoneGatewayWorker, { type AyasWorkerEnv } from "../cloudflare/ayas-phone-gateway/src/worker";
import {
  runAyasChatStream,
  runAyasChatStreamWithPhoneFallback,
} from "../src/components/brain/ayasChatStreamClient";
import {
  resolveAyasWorkerUrl,
  getStoredAyasPhoneKey,
  bootstrapAyasPhoneKeyFromUrl,
} from "../src/components/brain/ayasPhoneFallback";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const ROUTE = "https://ayas-phone-gateway.example.workers.dev/api/ayas/chat/stream";
const ALLOWED_ORIGIN = "https://192.168.2.74";
const PHONE_KEY = "phone-test-key-0123456789";
const CLOUD_KEY = "sk-FAKE-CLOUD-KEY-FOR-TEST-0123456789";

function req(over: { path?: string; method?: string; headers?: Record<string, string>; body?: unknown } = {}): Request {
  return new Request(over.path ?? ROUTE, {
    method: over.method ?? "POST",
    headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGIN, ...(over.headers ?? {}) },
    ...(over.body !== undefined ? { body: JSON.stringify(over.body) } : {}),
  });
}

async function readSse(response: Response): Promise<{ deltas: string[]; done: Record<string, unknown> | null; raw: string }> {
  const raw = await response.text();
  const deltas: string[] = [];
  let done: Record<string, unknown> | null = null;
  for (const frame of raw.split("\n\n")) {
    const line = frame.split("\n").find((l) => l.startsWith("data:"));
    if (!line) continue;
    const evt = JSON.parse(line.slice(5).trim());
    if (evt.type === "delta") deltas.push(evt.text);
    else if (evt.type === "done") done = evt;
  }
  return { deltas, done, raw };
}

function sse(pieces: string[]): Response {
  const lines = [...pieces.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}`), "data: [DONE]"];
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

const NO_CLOUD_ENV: AyasWorkerEnv = { AYAS_PHONE_KEY: PHONE_KEY };
const CLOUD_ENV: AyasWorkerEnv = { AYAS_PHONE_KEY: PHONE_KEY, AYAS_CLOUD_API_KEY: CLOUD_KEY };

async function run() {
  /* ---------------- routing / method / path ---------------- */

  await scenario("worker — wrong path → 404, generic body", async () => {
    const res = await ayasPhoneGatewayWorker.fetch(req({ path: "https://x.workers.dev/anything" }), NO_CLOUD_ENV);
    assert.equal(res.status, 404);
  });

  await scenario("worker — GET on the route → 405", async () => {
    const res = await ayasPhoneGatewayWorker.fetch(req({ method: "GET" }), NO_CLOUD_ENV);
    assert.equal(res.status, 405);
  });

  await scenario("worker — OPTIONS preflight → 204 with CORS only for an allowed origin", async () => {
    const ok = await ayasPhoneGatewayWorker.fetch(req({ method: "OPTIONS" }), NO_CLOUD_ENV);
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);

    const bad = await ayasPhoneGatewayWorker.fetch(
      req({ method: "OPTIONS", headers: { Origin: "https://evil.example.com" } }),
      NO_CLOUD_ENV,
    );
    assert.equal(bad.status, 204);
    assert.equal(bad.headers.get("access-control-allow-origin"), null);
  });

  await scenario("worker — a non-allow-listed Origin is refused server-side (403), not just CORS-silent", async () => {
    const res = await ayasPhoneGatewayWorker.fetch(
      req({ headers: { Origin: "https://evil.example.com", Authorization: `Bearer ${PHONE_KEY}` } }),
      NO_CLOUD_ENV,
    );
    assert.equal(res.status, 403);
  });

  /* ---------------- auth ---------------- */

  await scenario("worker — no Authorization header → 401", async () => {
    const res = await ayasPhoneGatewayWorker.fetch(req({ body: { text: "merhaba" } }), NO_CLOUD_ENV);
    assert.equal(res.status, 401);
  });

  await scenario("worker — wrong phone key → 401", async () => {
    const res = await ayasPhoneGatewayWorker.fetch(
      req({ headers: { Authorization: "Bearer wrong-key-wrong-key-000" }, body: { text: "merhaba" } }),
      NO_CLOUD_ENV,
    );
    assert.equal(res.status, 401);
  });

  await scenario("worker — AYAS_PHONE_KEY unset on the Worker itself → fails closed (401), not open", async () => {
    const res = await ayasPhoneGatewayWorker.fetch(
      req({ headers: { Authorization: `Bearer ${PHONE_KEY}` }, body: { text: "merhaba" } }),
      {} as AyasWorkerEnv,
    );
    assert.equal(res.status, 401);
  });

  /* ---------------- body validation ---------------- */

  await scenario("worker — invalid JSON → 400", async () => {
    const bad = new Request(ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGIN, Authorization: `Bearer ${PHONE_KEY}` },
      body: "{not json",
    });
    const res = await ayasPhoneGatewayWorker.fetch(bad, NO_CLOUD_ENV);
    assert.equal(res.status, 400);
  });

  await scenario("worker — empty / oversized text → 400", async () => {
    const empty = await ayasPhoneGatewayWorker.fetch(
      req({ headers: { Authorization: `Bearer ${PHONE_KEY}` }, body: { text: "" } }),
      NO_CLOUD_ENV,
    );
    assert.equal(empty.status, 400);
    const huge = await ayasPhoneGatewayWorker.fetch(
      req({ headers: { Authorization: `Bearer ${PHONE_KEY}` }, body: { text: "a".repeat(5000) } }),
      NO_CLOUD_ENV,
    );
    assert.equal(huge.status, 400);
  });

  await scenario("worker — oversized declared Content-Length → 413", async () => {
    const res = await ayasPhoneGatewayWorker.fetch(
      req({
        headers: { Authorization: `Bearer ${PHONE_KEY}`, "Content-Length": String(64 * 1024) },
        body: { text: "merhaba" },
      }),
      NO_CLOUD_ENV,
    );
    assert.equal(res.status, 413);
  });

  await scenario("worker — client-supplied provider/baseUrl/apiKey/model fields are silently ignored", async () => {
    // cloud not configured on the Worker → still the honest not-configured reply,
    // proving the client's fields never substitute for server-side config.
    const res = await ayasPhoneGatewayWorker.fetch(
      req({
        headers: { Authorization: `Bearer ${PHONE_KEY}` },
        body: { text: "merhaba", provider: "ollama", baseUrl: "http://attacker.example", apiKey: "sk-attacker", model: "gpt-4o" },
      }),
      NO_CLOUD_ENV,
    );
    const { done, raw } = await readSse(res);
    assert.equal(done?.reason, "cloud-not-configured");
    assert.ok(!raw.includes("attacker"));
  });

  /* ---------------- honest no-cloud reply ---------------- */

  await scenario("worker — cloud not configured → honest done event, no secret, no config detail", async () => {
    const res = await ayasPhoneGatewayWorker.fetch(
      req({ headers: { Authorization: `Bearer ${PHONE_KEY}` }, body: { text: "merhaba" } }),
      NO_CLOUD_ENV,
    );
    assert.equal(res.status, 200);
    const { done, raw } = await readSse(res);
    assert.equal(done?.source, "fallback");
    assert.equal(done?.corrected, true);
    assert.ok(!raw.includes(PHONE_KEY));
    assert.ok(!/AYAS_CLOUD_API_KEY|AYAS_PHONE_KEY/.test(raw));
  });

  /* ---------------- real cloud stream (mocked transport) ---------------- */

  await scenario("worker — cloud configured → streams deltas + a usable done; the key never appears anywhere", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => sse(["Merhaba", ", ben AYAS."])) as unknown as typeof fetch;
    try {
      const res = await ayasPhoneGatewayWorker.fetch(
        req({ headers: { Authorization: `Bearer ${PHONE_KEY}` }, body: { text: "merhaba" } }),
        CLOUD_ENV,
      );
      const { deltas, done, raw } = await readSse(res);
      assert.equal(deltas.join(""), "Merhaba, ben AYAS.");
      assert.equal(done?.source, "llm");
      assert.equal(done?.provider, "cloud");
      assert.ok(!raw.includes(CLOUD_KEY));
      assert.ok(!raw.toLowerCase().includes("authorization"));
    } finally {
      globalThis.fetch = real;
    }
  });

  await scenario("worker — an execution-claiming cloud reply is replaced, not passed through", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => sse(["Dosyayı sildim ve pipeline'ı başlattım."])) as unknown as typeof fetch;
    try {
      const res = await ayasPhoneGatewayWorker.fetch(
        req({ headers: { Authorization: `Bearer ${PHONE_KEY}` }, body: { text: "ne yaptın" } }),
        CLOUD_ENV,
      );
      const { done } = await readSse(res);
      assert.equal(done?.source, "fallback");
      assert.equal(done?.reason, "execution-claim");
    } finally {
      globalThis.fetch = real;
    }
  });

  await scenario("worker — a provider transport failure never surfaces the error body", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response("sk-leaked-secret-in-error-body", { status: 500 })) as unknown as typeof fetch;
    try {
      const res = await ayasPhoneGatewayWorker.fetch(
        req({ headers: { Authorization: `Bearer ${PHONE_KEY}` }, body: { text: "merhaba" } }),
        CLOUD_ENV,
      );
      const { done, raw } = await readSse(res);
      assert.equal(done?.source, "fallback");
      assert.ok(!raw.includes("sk-leaked-secret-in-error-body"));
    } finally {
      globalThis.fetch = real;
    }
  });

  /* ---------------- client-side fallback orchestration ---------------- */

  await scenario("client fallback — PC reachable (ok) → Worker never called", async () => {
    let workerCalled = false;
    const fetcher = (async (url: string) => {
      if (String(url).includes("workers.dev")) workerCalled = true;
      return new Response(
        "data: " + JSON.stringify({ type: "done", text: "yerelden", source: "llm", corrected: false }) + "\n\n",
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const result = await runAyasChatStreamWithPhoneFallback({
      text: "merhaba",
      history: [],
      seq: 1,
      fetcher,
      onDelta: () => {},
    });
    assert.equal(result.ok, true);
    assert.equal(workerCalled, false);
  });

  await scenario("client fallback — PC unreachable + no Worker URL configured → plain network failure, unchanged", async () => {
    delete process.env.NEXT_PUBLIC_AYAS_WORKER_URL;
    const fetcher = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await runAyasChatStreamWithPhoneFallback({ text: "merhaba", history: [], seq: 1, fetcher, onDelta: () => {} });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "network");
  });

  await scenario("client fallback — PC unreachable + Worker URL but no stored phone key → no fallback attempt", async () => {
    process.env.NEXT_PUBLIC_AYAS_WORKER_URL = "https://ayas-phone-gateway.example.workers.dev";
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await runAyasChatStreamWithPhoneFallback({ text: "merhaba", history: [], seq: 1, fetcher, onDelta: () => {} });
    assert.equal(result.ok, false);
    assert.equal(calls, 1, "only the primary attempt — resolveAyasWorkerUrl()+no key means no retry");
    delete process.env.NEXT_PUBLIC_AYAS_WORKER_URL;
  });

  await scenario("client fallback — PC unavailable + Worker URL + stored key → retries the Worker with Bearer auth, succeeds", async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null });
      if (String(url).includes("workers.dev")) {
        return new Response(
          "data: " + JSON.stringify({ type: "done", text: "buluttan", source: "llm", corrected: false, provider: "cloud" }) + "\n\n",
          { status: 200 },
        );
      }
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await runAyasChatStreamWithPhoneFallback({
      text: "merhaba",
      history: [],
      seq: 1,
      fetcher,
      onDelta: () => {},
      resolveWorkerUrl: () => "https://ayas-phone-gateway.example.workers.dev",
      getPhoneKey: () => PHONE_KEY,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.text, "buluttan");
    assert.equal(calls.length, 2, "primary attempt + one Worker retry");
    assert.equal(calls[1].url, "https://ayas-phone-gateway.example.workers.dev/api/ayas/chat/stream");
    assert.equal(calls[1].auth, `Bearer ${PHONE_KEY}`);
  });

  await scenario("client fallback — an HTTP error from a REACHABLE PC server never triggers the Worker retry", async () => {
    process.env.NEXT_PUBLIC_AYAS_WORKER_URL = "https://ayas-phone-gateway.example.workers.dev";
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response("err", { status: 500 });
    }) as unknown as typeof fetch;
    const result = await runAyasChatStreamWithPhoneFallback({ text: "merhaba", history: [], seq: 1, fetcher, onDelta: () => {} });
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
    delete process.env.NEXT_PUBLIC_AYAS_WORKER_URL;
  });

  /* ---------------- phone-key bootstrap + storage (pure helpers) ---------------- */

  await scenario("resolveAyasWorkerUrl — unset / non-https / malformed → null; a valid https URL → its origin", () => {
    delete process.env.NEXT_PUBLIC_AYAS_WORKER_URL;
    assert.equal(resolveAyasWorkerUrl(), null);
    process.env.NEXT_PUBLIC_AYAS_WORKER_URL = "http://not-https.example";
    assert.equal(resolveAyasWorkerUrl(), null);
    process.env.NEXT_PUBLIC_AYAS_WORKER_URL = "not a url";
    assert.equal(resolveAyasWorkerUrl(), null);
    process.env.NEXT_PUBLIC_AYAS_WORKER_URL = "https://ayas-phone-gateway.example.workers.dev/";
    assert.equal(resolveAyasWorkerUrl(), "https://ayas-phone-gateway.example.workers.dev");
    delete process.env.NEXT_PUBLIC_AYAS_WORKER_URL;
  });

  await scenario("getStoredAyasPhoneKey — short/missing → null; a plausible key → trimmed value", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null };
    assert.equal(getStoredAyasPhoneKey(storage), null);
    store.set("ayasPhoneKey", "short");
    assert.equal(getStoredAyasPhoneKey(storage), null);
    store.set("ayasPhoneKey", "  a-real-phone-key-012345  ");
    assert.equal(getStoredAyasPhoneKey(storage), "a-real-phone-key-012345");
  });

  await scenario("bootstrapAyasPhoneKeyFromUrl — captures the query param, strips it, ignores a short/absent one", () => {
    const store = new Map<string, string>();
    const fakeWin = {
      location: { href: `https://192.168.2.74/brain?ayasPhoneKey=${PHONE_KEY}&x=1` },
      localStorage: {
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
      history: {
        state: null,
        replaceState: (_s: unknown, _t: string, url: string) => {
          fakeWin.location.href = url;
        },
      },
    } as unknown as Window;
    bootstrapAyasPhoneKeyFromUrl(fakeWin);
    assert.equal(store.get("ayasPhoneKey"), PHONE_KEY);
    assert.ok(!fakeWin.location.href.includes("ayasPhoneKey"));
    assert.ok(fakeWin.location.href.includes("x=1"), "unrelated params are preserved");

    const store2 = new Map<string, string>();
    const noParamWin = {
      location: { href: "https://192.168.2.74/brain" },
      localStorage: { setItem: (k: string, v: string) => store2.set(k, v) },
      history: { state: null, replaceState: () => {} },
    } as unknown as Window;
    bootstrapAyasPhoneKeyFromUrl(noParamWin);
    assert.equal(store2.size, 0);
  });

  /* ---------------- plain runAyasChatStream is unaffected (regression) ---------------- */

  await scenario("runAyasChatStream (no fallback wrapper) behaves exactly as before", async () => {
    const fetcher = (async () => {
      throw new Error("net");
    }) as unknown as typeof fetch;
    const result = await runAyasChatStream({ text: "merhaba", history: [], seq: 1, fetcher, onDelta: () => {} });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "network");
  });

  console.log(`AYAS phone runtime smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-phone-runtime", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS phone runtime smoke FAILED:", error);
  process.exitCode = 1;
});
