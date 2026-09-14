/**
 * AYAS phone-off-PC runtime smoke suite (Phase 2 · P0-A.4 · Option A +
 * Phone-LLM Range-blocker closure).
 *
 * Deterministic / $0 / no real network. Three halves:
 *
 *  1. The Cloudflare Worker's chat-stream route (`cloudflare/ayas-phone-gateway/src/worker.ts`)
 *     — exercised directly with Node's built-in `Request`/`Response`/`fetch`
 *     (Cloudflare Workers and Node 18+ share the same Fetch API surface, so
 *     this is a real functional test of the actual deployed code, not a
 *     reimplementation of it). The one external call it can make (the cloud
 *     LLM) is mocked via a temporary `globalThis.fetch` patch, restored after
 *     every scenario.
 *  2. The SAME Worker's model-weight Range-proxy route (added this pass —
 *     see the Worker's own file header for the full real-device rationale).
 *     Same technique: `globalThis.fetch` mocked to stand in for the
 *     Worker's upstream `fetch(MODEL_UPSTREAM_URL, ...)` call to
 *     huggingface.co.
 *  3. The browser-side fallback orchestration (`ayasChatStreamClient.ts` /
 *     `ayasPhoneFallback.ts`) — PC-reachable vs PC-unreachable routing, with a
 *     mock `fetch` injected the normal way (no global patch needed there).
 *
 * Covers the spec's "Phone" test list: PC online → local; PC unavailable +
 * cloud → Worker/cloud; neither → honest failure; no client API key; no
 * secret in response; no secret in trace — PLUS the Range-proxy route's own
 * contract: bounded Range in → 206 streamed through; no Range / bad Range /
 * non-206 upstream / network failure → typed rejection, body never read;
 * only the ONE hardcoded upstream URL is ever fetched, regardless of what a
 * caller sends.
 */

import assert from "node:assert/strict";

import ayasPhoneGatewayWorker, { type AyasWorkerEnv } from "../cloudflare/ayas-phone-gateway/src/worker";
import {
  MODEL_PROXY_PATH,
  MODEL_UPSTREAM_URL,
  SMOLLM2_MODEL_PROXY_PATH,
  SMOLLM2_MODEL_UPSTREAM_URL,
} from "../cloudflare/ayas-phone-gateway/src/modelProxyConfig";
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

const MODEL_ROUTE = `https://ayas-phone-gateway.example.workers.dev${MODEL_PROXY_PATH}`;

function modelReq(over: { path?: string; method?: string; headers?: Record<string, string> } = {}): Request {
  return new Request(over.path ?? MODEL_ROUTE, {
    method: over.method ?? "GET",
    headers: { Origin: ALLOWED_ORIGIN, ...(over.headers ?? {}) },
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

  /* ---------------- Route 2: Phone-LLM model-weight Range proxy ---------------- */

  await scenario("model proxy — wrong method (POST) → 405", async () => {
    const res = await ayasPhoneGatewayWorker.fetch(modelReq({ method: "POST" }), NO_CLOUD_ENV);
    assert.equal(res.status, 405);
  });

  await scenario("model proxy — OPTIONS preflight → 204, Range allow-listed, Content-Range/ETag/etc. exposed", async () => {
    const res = await ayasPhoneGatewayWorker.fetch(modelReq({ method: "OPTIONS" }), NO_CLOUD_ENV);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
    assert.match(res.headers.get("access-control-allow-headers") ?? "", /Range/);
    const exposed = res.headers.get("access-control-expose-headers") ?? "";
    for (const h of ["Content-Range", "Content-Length", "Accept-Ranges", "ETag"]) {
      assert.ok(exposed.includes(h), `Access-Control-Expose-Headers must include ${h}: "${exposed}"`);
    }
  });

  await scenario("model proxy — non-allow-listed Origin → 403", async () => {
    const res = await ayasPhoneGatewayWorker.fetch(
      modelReq({ headers: { Origin: "https://evil.example.com", Authorization: `Bearer ${PHONE_KEY}`, Range: "bytes=0-8388607" } }),
      NO_CLOUD_ENV,
    );
    assert.equal(res.status, 403);
  });

  await scenario("model proxy — no Authorization → 401; wrong key → 401; AYAS_PHONE_KEY unset → fails closed 401", async () => {
    const noAuth = await ayasPhoneGatewayWorker.fetch(modelReq({ headers: { Range: "bytes=0-8388607" } }), NO_CLOUD_ENV);
    assert.equal(noAuth.status, 401);
    const wrongKey = await ayasPhoneGatewayWorker.fetch(
      modelReq({ headers: { Range: "bytes=0-8388607", Authorization: "Bearer wrong-key-wrong-key-000" } }),
      NO_CLOUD_ENV,
    );
    assert.equal(wrongKey.status, 401);
    const unset = await ayasPhoneGatewayWorker.fetch(
      modelReq({ headers: { Range: "bytes=0-8388607", Authorization: `Bearer ${PHONE_KEY}` } }),
      {} as AyasWorkerEnv,
    );
    assert.equal(unset.status, 401);
  });

  await scenario("model proxy — no Range header → 400 range_required (SAFE REJECTION, never a whole-file download)", async () => {
    const res = await ayasPhoneGatewayWorker.fetch(
      modelReq({ headers: { Authorization: `Bearer ${PHONE_KEY}` } }),
      NO_CLOUD_ENV,
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal((body as { error: string }).error, "range_required");
  });

  await scenario("model proxy — EVERY non-206 response (400/401/403/405/502) carries route 2's OWN CORS headers, not route 1's — real bug, real fix: a 401 previously came back with Access-Control-Allow-Headers missing 'Range', which a real device hit after AYAS_PHONE_KEY rotation", async () => {
    const assertRoute2Cors = (res: Response) => {
      assert.equal(res.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
      assert.match(res.headers.get("access-control-allow-headers") ?? "", /Range/, "route 2's error responses must allow-list Range, like its own preflight does");
      assert.match(res.headers.get("access-control-allow-headers") ?? "", /Authorization/);
      const exposed = res.headers.get("access-control-expose-headers") ?? "";
      for (const h of ["Content-Range", "Content-Length", "Accept-Ranges", "ETag"]) {
        assert.ok(exposed.includes(h), `error response must still expose ${h}: "${exposed}"`);
      }
    };

    // 405 — wrong method
    assertRoute2Cors(await ayasPhoneGatewayWorker.fetch(modelReq({ method: "POST" }), NO_CLOUD_ENV));
    // 401 — no auth
    assertRoute2Cors(await ayasPhoneGatewayWorker.fetch(modelReq({ headers: { Range: "bytes=0-8388607" } }), NO_CLOUD_ENV));
    // 401 — wrong key (the exact real-device scenario after a key rotation)
    assertRoute2Cors(
      await ayasPhoneGatewayWorker.fetch(
        modelReq({ headers: { Range: "bytes=0-8388607", Authorization: "Bearer wrong-key-wrong-key-000" } }),
        NO_CLOUD_ENV,
      ),
    );
    // 400 — no Range
    assertRoute2Cors(await ayasPhoneGatewayWorker.fetch(modelReq({ headers: { Authorization: `Bearer ${PHONE_KEY}` } }), NO_CLOUD_ENV));
    // 400 — malformed Range
    assertRoute2Cors(
      await ayasPhoneGatewayWorker.fetch(
        modelReq({ headers: { Authorization: `Bearer ${PHONE_KEY}`, Range: "bytes=not-a-range" } }),
        NO_CLOUD_ENV,
      ),
    );
    // 502 — upstream answers non-206
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response("x", { status: 200 })) as unknown as typeof fetch;
    try {
      assertRoute2Cors(
        await ayasPhoneGatewayWorker.fetch(
          modelReq({ headers: { Authorization: `Bearer ${PHONE_KEY}`, Range: "bytes=0-8388607" } }),
          NO_CLOUD_ENV,
        ),
      );
    } finally {
      globalThis.fetch = real;
    }
  });

  await scenario("model proxy — malformed Range header → 400 invalid_range", async () => {
    const res = await ayasPhoneGatewayWorker.fetch(
      modelReq({ headers: { Authorization: `Bearer ${PHONE_KEY}`, Range: "bytes=not-a-range" } }),
      NO_CLOUD_ENV,
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal((body as { error: string }).error, "invalid_range");
  });

  await scenario("model proxy — arbitrary URL smuggled as a path/query is IGNORED: only MODEL_UPSTREAM_URL is ever fetched", async () => {
    const real = globalThis.fetch;
    let fetchedUrl: string | null = null;
    let fetchedHeaders: Record<string, string> = {};
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      fetchedUrl = url;
      fetchedHeaders = { ...(init?.headers as Record<string, string>) };
      return new Response(new Uint8Array(10), {
        status: 206,
        headers: { "content-range": "bytes 0-9/20", "content-length": "10" },
      });
    }) as unknown as typeof fetch;
    try {
      // The request URL itself carries an attempted path-traversal / extra
      // segment / query string — none of it can reach the upstream fetch,
      // because the handler never reads anything from the URL to build it.
      const res = await ayasPhoneGatewayWorker.fetch(
        modelReq({
          path: `${MODEL_ROUTE}/../../evil?redirect=https://attacker.example.com`,
          headers: { Authorization: `Bearer ${PHONE_KEY}`, Range: "bytes=0-8388607", "X-Smuggled": "should-not-forward" },
        }),
        NO_CLOUD_ENV,
      );
      // A modified path no longer matches MODEL_PROXY_PATH via `===`, so this
      // specific request 404s — which is itself part of the proof (no
      // wildcard/prefix match exists that could be abused). Re-run with the
      // EXACT path instead to prove the upstream call in isolation.
      assert.equal(res.status, 404);

      const res2 = await ayasPhoneGatewayWorker.fetch(
        modelReq({ headers: { Authorization: `Bearer ${PHONE_KEY}`, Range: "bytes=0-8388607", "X-Smuggled": "should-not-forward" } }),
        NO_CLOUD_ENV,
      );
      assert.equal(res2.status, 206);
      assert.equal(fetchedUrl, MODEL_UPSTREAM_URL, "the Worker must fetch ONLY the hardcoded upstream URL, regardless of request input");
      assert.deepEqual(Object.keys(fetchedHeaders), ["Range"], "no header besides Range may reach the upstream fetch — X-Smuggled must never forward");
    } finally {
      globalThis.fetch = real;
    }
  });

  await scenario("model proxy — bytes=0-8388607 → 206, Content-Range/Content-Length/Accept-Ranges/ETag forwarded, body streamed through byte-for-byte", async () => {
    const real = globalThis.fetch;
    const payload = new Uint8Array(8_388_608);
    for (let i = 0; i < payload.length; i += 1) payload[i] = i % 256;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      assert.equal((init?.headers as Record<string, string>).Range, "bytes=0-8388607", "the exact requested Range must be forwarded upstream unchanged");
      return new Response(payload, {
        status: 206,
        headers: {
          "content-range": "bytes 0-8388607/483003582",
          "content-length": "8388608",
          "accept-ranges": "bytes",
          etag: '"927c2ad9b83d24e09f498fe7eb2760a9c07cffd3f86ef24792b13cc14cda6de2"',
        },
      });
    }) as unknown as typeof fetch;
    try {
      const res = await ayasPhoneGatewayWorker.fetch(
        modelReq({ headers: { Authorization: `Bearer ${PHONE_KEY}`, Range: "bytes=0-8388607" } }),
        NO_CLOUD_ENV,
      );
      assert.equal(res.status, 206);
      assert.equal(res.headers.get("content-range"), "bytes 0-8388607/483003582");
      assert.equal(res.headers.get("content-length"), "8388608");
      assert.equal(res.headers.get("accept-ranges"), "bytes");
      assert.equal(res.headers.get("etag"), '"927c2ad9b83d24e09f498fe7eb2760a9c07cffd3f86ef24792b13cc14cda6de2"');
      assert.equal(res.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const bytes = new Uint8Array(await res.arrayBuffer());
      assert.equal(bytes.byteLength, payload.byteLength, "the streamed-through body must be byte-for-byte complete");
      assert.deepEqual(bytes, payload, "the streamed-through body must be byte-for-byte identical to what upstream sent");
    } finally {
      globalThis.fetch = real;
    }
  });

  await scenario("model proxy — bytes=8388608-16777215 (second window) → 206 with the matching Content-Range", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string>).Range;
      assert.equal(range, "bytes=8388608-16777215");
      return new Response(new Uint8Array(8_388_608), {
        status: 206,
        headers: { "content-range": "bytes 8388608-16777215/483003582", "content-length": "8388608" },
      });
    }) as unknown as typeof fetch;
    try {
      const res = await ayasPhoneGatewayWorker.fetch(
        modelReq({ headers: { Authorization: `Bearer ${PHONE_KEY}`, Range: "bytes=8388608-16777215" } }),
        NO_CLOUD_ENV,
      );
      assert.equal(res.status, 206);
      assert.equal(res.headers.get("content-range"), "bytes 8388608-16777215/483003582");
    } finally {
      globalThis.fetch = real;
    }
  });

  await scenario("model proxy — upstream answers 200 instead of 206 → 502, upstream body NEVER read (SAFE ABORT, mirrors fetchOneChunk)", async () => {
    const real = globalThis.fetch;
    let readerReadWasCalled = false;
    let cancelWasCalled = false;
    globalThis.fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024));
          controller.close();
        },
        cancel() {
          cancelWasCalled = true;
        },
      });
      const response = new Response(stream, { status: 200, headers: { "content-length": "483003582" } });
      const body = response.body as unknown as { getReader: (...args: unknown[]) => { read: (...args: unknown[]) => Promise<unknown> } };
      const originalGetReader = body.getReader.bind(body);
      body.getReader = (...args: unknown[]) => {
        const reader = originalGetReader(...args);
        const originalRead = reader.read.bind(reader);
        reader.read = (...readArgs: unknown[]) => {
          readerReadWasCalled = true;
          return originalRead(...readArgs);
        };
        return reader;
      };
      return response;
    }) as unknown as typeof fetch;
    try {
      const res = await ayasPhoneGatewayWorker.fetch(
        modelReq({ headers: { Authorization: `Bearer ${PHONE_KEY}`, Range: "bytes=0-8388607" } }),
        NO_CLOUD_ENV,
      );
      assert.equal(res.status, 502);
      const bodyJson = await res.json();
      assert.equal((bodyJson as { error: string }).error, "upstream_range_not_honored");
      assert.equal(readerReadWasCalled, false, "the gateway must never call reader.read() on a non-206 upstream response — this is the exact bug this whole sprint closed, one hop earlier");
      assert.equal(cancelWasCalled, true, "the gateway must release the unread upstream body via cancel()");
    } finally {
      globalThis.fetch = real;
    }
  });

  await scenario("model proxy — upstream fetch throws (network failure) → 502 upstream_unreachable, never thrown to the caller", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("simulated upstream network failure");
    }) as unknown as typeof fetch;
    try {
      const res = await ayasPhoneGatewayWorker.fetch(
        modelReq({ headers: { Authorization: `Bearer ${PHONE_KEY}`, Range: "bytes=0-8388607" } }),
        NO_CLOUD_ENV,
      );
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal((body as { error: string }).error, "upstream_unreachable");
    } finally {
      globalThis.fetch = real;
    }
  });

  /* ---------------- Route 2, SECOND route: SmolLM2-135M-Instruct weight file (round 5) ---------------- */

  const SMOLLM2_MODEL_ROUTE = `https://ayas-phone-gateway.example.workers.dev${SMOLLM2_MODEL_PROXY_PATH}`;

  await scenario("model proxy (SmolLM2 route) — no Range header → 400 range_required, same as the Qwen route", async () => {
    const res = await ayasPhoneGatewayWorker.fetch(
      modelReq({ path: SMOLLM2_MODEL_ROUTE, headers: { Authorization: `Bearer ${PHONE_KEY}` } }),
      NO_CLOUD_ENV,
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal((body as { error: string }).error, "range_required");
  });

  await scenario("model proxy (SmolLM2 route) — bytes=0-8388607 → 206, fetches SMOLLM2_MODEL_UPSTREAM_URL (NOT the Qwen URL), body streamed through", async () => {
    const real = globalThis.fetch;
    let fetchedUrl: string | null = null;
    const payload = new Uint8Array(8_388_608);
    for (let i = 0; i < payload.length; i += 1) payload[i] = i % 256;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      fetchedUrl = url;
      assert.equal((init?.headers as Record<string, string>).Range, "bytes=0-8388607");
      return new Response(payload, {
        status: 206,
        headers: { "content-range": "bytes 0-8388607/117691126", "content-length": "8388608", "accept-ranges": "bytes" },
      });
    }) as unknown as typeof fetch;
    try {
      const res = await ayasPhoneGatewayWorker.fetch(
        modelReq({ path: SMOLLM2_MODEL_ROUTE, headers: { Authorization: `Bearer ${PHONE_KEY}`, Range: "bytes=0-8388607" } }),
        NO_CLOUD_ENV,
      );
      assert.equal(res.status, 206);
      assert.equal(fetchedUrl, SMOLLM2_MODEL_UPSTREAM_URL, "the SmolLM2 route must fetch its own hardcoded upstream URL, not the Qwen one");
      assert.notEqual(fetchedUrl, MODEL_UPSTREAM_URL);
      assert.equal(res.headers.get("content-range"), "bytes 0-8388607/117691126");
      const bytes = new Uint8Array(await res.arrayBuffer());
      assert.deepEqual(bytes, payload, "the streamed-through body must be byte-for-byte identical to what upstream sent");
    } finally {
      globalThis.fetch = real;
    }
  });

  await scenario("model proxy (SmolLM2 route) — upstream answers 200 instead of 206 → 502, body never read (SAFE ABORT)", async () => {
    const real = globalThis.fetch;
    let cancelWasCalled = false;
    globalThis.fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024));
          controller.close();
        },
        cancel() {
          cancelWasCalled = true;
        },
      });
      return new Response(stream, { status: 200, headers: { "content-length": "117691126" } });
    }) as unknown as typeof fetch;
    try {
      const res = await ayasPhoneGatewayWorker.fetch(
        modelReq({ path: SMOLLM2_MODEL_ROUTE, headers: { Authorization: `Bearer ${PHONE_KEY}`, Range: "bytes=0-8388607" } }),
        NO_CLOUD_ENV,
      );
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal((body as { error: string }).error, "upstream_range_not_honored");
      assert.equal(cancelWasCalled, true);
    } finally {
      globalThis.fetch = real;
    }
  });

  await scenario("model proxy — the Qwen route (MODEL_PROXY_PATH) and the SmolLM2 route (SMOLLM2_MODEL_PROXY_PATH) are distinct paths, both independently reachable", () => {
    assert.notEqual(MODEL_PROXY_PATH, SMOLLM2_MODEL_PROXY_PATH);
    assert.notEqual(MODEL_UPSTREAM_URL, SMOLLM2_MODEL_UPSTREAM_URL);
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
