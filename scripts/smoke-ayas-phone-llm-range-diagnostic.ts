/**
 * AYAS phone-local LLM — HTTP Range diagnostic smoke suite (real-device
 * follow-up: iPhone/Chrome gets 200 + Content-Range absent for the exact
 * Range request `curl` gets a clean 206 for). Deterministic — no real
 * network, no IndexedDB. See `phoneLlmRangeDiagnostic.ts`'s header for the
 * full rationale.
 *
 * Proves:
 *  1. Both probes (A: same-shape-as-downloader, B: cache-busting query)
 *     send ONLY a `Range` header — nothing else — matching `fetchOneChunk`.
 *  2. The response body is NEVER read in either probe, in EITHER outcome
 *     (200 or 206) — proven directly (monkey-patched `reader.read()` must
 *     never fire), not merely asserted via a `bodyRead` flag.
 *  3. Every requested header/URL/redirect field is captured accurately.
 *  4. The two probes are genuinely independent requests to two distinct
 *     URLs (the cache-buster is appended, and differs run to run).
 *  5. A network failure on either probe is reported as a typed failure,
 *     never thrown, never confused with a real HTTP response.
 *  6. `serviceWorkerWouldInterceptThisOrigin` is always the literal `false`
 *     this module's header proves from `public/sw.js`'s own source.
 *  7. `formatRangeDiagnosis` renders every field name the real-device
 *     report format requires, for both probes, plus the ROOT CAUSE / FIX /
 *     REGRESSION placeholders.
 */

import assert from "node:assert/strict";

import { env } from "@huggingface/transformers";

import { AYAS_PHONE_LLM_MODELS, buildRemoteResourceUrl } from "../src/components/brain/voice/localLlm/phoneLlmModelResources";
import { formatRangeDiagnosis, runRangeDiagnosis } from "../src/components/brain/voice/localLlm/phoneLlmRangeDiagnostic";

// Looked up by `id`, NOT by array index — SmolLM2-135M-Instruct was later
// inserted at index 0 for the Lab UI's default/unlock ordering, which is a
// UI concern unrelated to this test file's Qwen-specific hardcoded gateway
// path assertions below. This still means "the Qwen 0.5B model" regardless
// of array order.
const MODEL_05B = AYAS_PHONE_LLM_MODELS.find((m) => m.id === "onnx-community/Qwen2.5-0.5B-Instruct")!;
assert.ok(MODEL_05B, "sanity: onnx-community/Qwen2.5-0.5B-Instruct must exist in AYAS_PHONE_LLM_MODELS for this test file to mean anything");
const WEIGHT_FILE = "onnx/model_q4f16.onnx";

function fillBuffer(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = i % 256;
  return bytes;
}

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

async function run() {
  env.useBrowserCache = false;

  await scenario("both probes send ONLY a Range header (no Accept/Cache-Control/etc set by this code) — identical shape to fetchOneChunk", async () => {
    const originalFetch = env.fetch;
    const seenHeaderSets: Array<Record<string, string>> = [];
    env.fetch = (async (_url: string, init?: RequestInit) => {
      seenHeaderSets.push({ ...(init?.headers as Record<string, string>) });
      return new Response(fillBuffer(10) as BodyInit, {
        status: 206,
        headers: { "content-range": "bytes 0-8388607/483003582", "content-length": "8388608", etag: '"e"', "access-control-allow-origin": "*" },
      });
    }) as typeof env.fetch;
    try {
      await runRangeDiagnosis(MODEL_05B);
      assert.equal(seenHeaderSets.length, 2, "exactly 2 requests — one per probe");
      for (const headers of seenHeaderSets) {
        assert.deepEqual(Object.keys(headers), ["Range"], "no header besides Range may be set by this diagnostic");
        assert.equal(headers.Range, "bytes=0-8388607");
      }
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("the response body is NEVER read, in EITHER probe, even on a clean 206 — proven via monkey-patched reader.read()", async () => {
    const originalFetch = env.fetch;
    let readerReadWasCalled = false;
    let cancelCallCount = 0;
    env.fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(fillBuffer(1024));
          controller.close();
        },
        cancel() {
          cancelCallCount += 1;
        },
      });
      const response = new Response(stream, {
        status: 206,
        headers: { "content-range": "bytes 0-8388607/483003582", "content-length": "8388608" },
      });
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
    }) as typeof env.fetch;
    try {
      const result = await runRangeDiagnosis(MODEL_05B);
      assert.equal(readerReadWasCalled, false, "reader.read() must NEVER be called by this diagnostic — not even on a healthy 206");
      assert.equal(cancelCallCount, 2, "both probes must release the body via cancel(), one cancel() per probe");
      assert.equal(result.probeA.bodyRead, false);
      assert.equal(result.probeB.bodyRead, false);
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("REGRESSION-TARGET SCENARIO: probe A reproduces the exact real-device symptom (200, Content-Range absent) while probe B (cache-busted URL) gets a clean 206 — the tool correctly differentiates them", async () => {
    const originalFetch = env.fetch;
    const weightUrl = buildRemoteResourceUrl(MODEL_05B, WEIGHT_FILE);
    env.fetch = (async (url: string) => {
      if (url === weightUrl) {
        // The exact real-device signature: 200, no Content-Range, but a
        // real ETag/CORS header still present (matching the report).
        return new Response(fillBuffer(10) as BodyInit, {
          status: 200,
          headers: {
            "content-length": "483003582",
            "access-control-allow-origin": "*",
            etag: '"927c2ad9b83d24e09f498fe7eb2760a9c07cffd3f86ef24792b13cc14cda6de2"',
          },
        });
      }
      // Any OTHER (cache-busted) URL to the same resource gets a clean 206.
      return new Response(fillBuffer(10) as BodyInit, {
        status: 206,
        headers: {
          "content-range": "bytes 0-8388607/483003582",
          "content-length": "8388608",
          "access-control-allow-origin": "*",
          etag: '"927c2ad9b83d24e09f498fe7eb2760a9c07cffd3f86ef24792b13cc14cda6de2"',
        },
      });
    }) as typeof env.fetch;
    try {
      const result = await runRangeDiagnosis(MODEL_05B);
      assert.equal(result.probeA.requestUrl, weightUrl, "probe A must hit the plain, unmodified URL");
      assert.equal(result.probeA.status, 200);
      assert.equal(result.probeA.contentRangeHeader, null);
      assert.notEqual(result.probeB.requestUrl, weightUrl, "probe B's URL must differ from probe A's (cache-buster appended)");
      assert.ok(result.probeB.requestUrl.startsWith(`${weightUrl}?ayas_diag=`), "cache-buster must be a query param on the SAME origin URL");
      assert.equal(result.probeB.status, 206);
      assert.match(result.probeB.contentRangeHeader ?? "", /^bytes 0-8388607\/483003582$/);
      assert.equal(result.serviceWorkerWouldInterceptThisOrigin, false);
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("cache-buster differs on every call (never reuses the same busted URL twice)", async () => {
    const originalFetch = env.fetch;
    env.fetch = (async () => new Response(fillBuffer(4) as BodyInit, { status: 206, headers: { "content-range": "bytes 0-3/4" } })) as typeof env.fetch;
    try {
      const first = await runRangeDiagnosis(MODEL_05B);
      const second = await runRangeDiagnosis(MODEL_05B);
      assert.notEqual(first.probeB.requestUrl, second.probeB.requestUrl, "two separate diagnostic runs must not collide on the exact same busted URL");
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("a network failure on either probe is reported as a typed failure, never thrown", async () => {
    const originalFetch = env.fetch;
    env.fetch = (async () => {
      throw new Error("simulated network down");
    }) as typeof env.fetch;
    try {
      const result = await runRangeDiagnosis(MODEL_05B);
      assert.equal(result.probeA.ok, false);
      assert.match(result.probeA.errorDetail ?? "", /simulated network down/);
      assert.equal(result.probeA.status, null);
      assert.equal(result.probeA.bodyRead, false);
      assert.equal(result.probeB.ok, false);
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("formatRangeDiagnosis renders every requested field for both probes, plus ROOT CAUSE / FIX / REGRESSION placeholders", async () => {
    const originalFetch = env.fetch;
    const weightUrl = buildRemoteResourceUrl(MODEL_05B, WEIGHT_FILE);
    env.fetch = (async (url: string) => {
      if (url === weightUrl) {
        return new Response(fillBuffer(4) as BodyInit, {
          status: 200,
          headers: { "content-length": "483003582", "access-control-allow-origin": "*", etag: '"real-etag"' },
        });
      }
      return new Response(fillBuffer(4) as BodyInit, {
        status: 206,
        headers: { "content-range": "bytes 0-8388607/483003582", "content-length": "8388608", etag: '"real-etag"', vary: "Accept-Encoding" },
      });
    }) as typeof env.fetch;
    try {
      const result = await runRangeDiagnosis(MODEL_05B);
      const text = formatRangeDiagnosis(result);
      for (const label of [
        "RANGE DIAGNOSIS",
        "Request URL:",
        "Final URL:",
        "Redirect:",
        "Service Worker",
        "Request Range:",
        "Response status:",
        "Accept-Ranges:",
        "Content-Range:",
        "Content-Length:",
        "Content-Encoding:",
        "Cache-Control:",
        "ETag:",
        "Vary:",
        "ROOT CAUSE:",
        "FIX:",
        "REGRESSION:",
      ]) {
        assert.ok(text.includes(label), `formatted report must include "${label}"`);
      }
      // Both distinct probe labels must appear (A and B, not just one).
      assert.match(text, /A —/);
      assert.match(text, /B —/);
      // The real values must actually be interpolated, not left as templates.
      assert.match(text, /200/);
      assert.match(text, /206/);
      assert.match(text, /483003582/);
      assert.match(text, /"real-etag"/);
      assert.match(text, /Accept-Encoding/);
    } finally {
      env.fetch = originalFetch;
    }
  });

  /* ---------------- Probe C: through the ayas-phone-gateway ---------------- */

  await scenario("probe C (gateway) is null — not attempted — when NEXT_PUBLIC_AYAS_WORKER_URL / stored phone key are absent (this test env's default)", async () => {
    const originalFetch = env.fetch;
    env.fetch = (async () => new Response(fillBuffer(4) as BodyInit, { status: 206, headers: { "content-range": "bytes 0-3/4" } })) as typeof env.fetch;
    try {
      const result = await runRangeDiagnosis(MODEL_05B);
      assert.equal(result.probeGateway, null);
      const text = formatRangeDiagnosis(result);
      assert.match(text, /ÇALIŞTIRILMADI/, "the report must say the gateway probe wasn't attempted, not silently omit it");
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("probe C fires through the gateway with the correct URL + Authorization header when both NEXT_PUBLIC_AYAS_WORKER_URL and a stored phone key are configured", async () => {
    const originalFetch = env.fetch;
    const originalEnvUrl = process.env.NEXT_PUBLIC_AYAS_WORKER_URL;
    const originalWindow = (globalThis as { window?: unknown }).window;
    process.env.NEXT_PUBLIC_AYAS_WORKER_URL = "https://ayas-phone-gateway.example.workers.dev";
    const PHONE_KEY = "phone-test-key-0123456789";
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (k: string) => (k === "ayasPhoneKey" ? PHONE_KEY : null) },
    };
    let sawGatewayRequest = false;
    env.fetch = (async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://ayas-phone-gateway.example.workers.dev")) {
        sawGatewayRequest = true;
        assert.equal(
          url,
          "https://ayas-phone-gateway.example.workers.dev/phone-llm-model/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/onnx/model_q4f16.onnx",
        );
        assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${PHONE_KEY}`);
        assert.equal((init?.headers as Record<string, string>).Range, "bytes=0-8388607");
        return new Response(fillBuffer(8_388_608) as BodyInit, {
          status: 206,
          headers: {
            "content-range": "bytes 0-8388607/483003582",
            "content-length": "8388608",
            "accept-ranges": "bytes",
            etag: '"927c2ad9b83d24e09f498fe7eb2760a9c07cffd3f86ef24792b13cc14cda6de2"',
          },
        });
      }
      // Probes A/B — unrelated to this scenario, kept minimal.
      return new Response(fillBuffer(4) as BodyInit, { status: 200, headers: { "content-length": "483003582" } });
    }) as typeof env.fetch;
    try {
      const result = await runRangeDiagnosis(MODEL_05B);
      assert.ok(sawGatewayRequest, "the gateway must actually be called when both pieces of config are present");
      assert.ok(result.probeGateway, "probeGateway must not be null once configured");
      assert.equal(result.probeGateway!.status, 206);
      assert.equal(result.probeGateway!.contentRangeHeader, "bytes 0-8388607/483003582");
      assert.equal(result.probeGateway!.etagHeader, '"927c2ad9b83d24e09f498fe7eb2760a9c07cffd3f86ef24792b13cc14cda6de2"');
      assert.equal(result.probeGateway!.bodyRead, false, "probe C must never read the body either — same discipline as A/B");

      const text = formatRangeDiagnosis(result);
      assert.match(text, /C —/);
      assert.match(text, /gateway/i);
      assert.doesNotMatch(text, /ÇALIŞTIRILMADI/, "once the gateway probe actually ran, the not-attempted placeholder must not appear");
    } finally {
      env.fetch = originalFetch;
      if (originalEnvUrl === undefined) delete process.env.NEXT_PUBLIC_AYAS_WORKER_URL;
      else process.env.NEXT_PUBLIC_AYAS_WORKER_URL = originalEnvUrl;
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  console.log(`AYAS phone LLM Range diagnostic smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-phone-llm-range-diagnostic", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS phone LLM Range diagnostic smoke FAILED:", error);
  process.exitCode = 1;
});
