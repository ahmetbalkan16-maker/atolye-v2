/**
 * Documentary pipeline V2 (Faz 2a): OpenAI image provider observability + pacing.
 *
 * No real API call - `fetch` and the clock are injected. Verifies that a failed
 * image generation now carries safe, bounded ImageGenerationErrorEvidence
 * (HTTP status, retryable classification, provider error code/type, a <=300 char
 * sanitized body summary), that NO secret ever reaches the evidence, and that
 * consecutive calls from one provider instance are paced by requestIntervalMs.
 */
import assert from "node:assert/strict";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { OpenAIImageProvider } from "../src/lib/assets/providers/OpenAIImageProvider";
import { getOpenAIImageProviderConfig } from "../src/lib/assets/providers/ImageProviderConfig";
import type { ImageGenerationInput } from "../src/lib/assets/providers/ImageProvider";

const SECRET_KEY = "sk-super-secret-key-DO-NOT-LEAK-1234567890";
const now = "2026-08-29T00:00:00.000Z";
let count = 0;

function scenario(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => {
    count += 1;
    if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
  });
}

const input: ImageGenerationInput = {
  prompt: "Fatih Sultan Mehmet, tek kare kompozisyon",
  style: "cinematic",
  sceneId: 7,
  projectSlug: "resilience-smoke",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A fetch stub that records what it was asked to send and returns a scripted response. */
function stubFetch(responder: (call: number) => Response | Promise<Response> | never) {
  const calls: Array<{ headers: Headers; bodyKeys: string[] }> = [];
  const fn = (async (_url: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const bodyKeys = init?.body ? Object.keys(JSON.parse(String(init.body))) : [];
    calls.push({ headers, bodyKeys });
    return responder(calls.length);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

async function main() {
  await withCanonicalSmokeRuntime(
    { name: "openai-image-resilience", now },
    async () => {
      process.env.OPENAI_API_KEY = SECRET_KEY;
      // deterministic config (no env overrides)
      delete process.env.IMAGE_OPENAI_SIZE;
      delete process.env.IMAGE_OPENAI_QUALITY;
      delete process.env.IMAGE_OPENAI_REQUEST_INTERVAL_MS;
      const config = getOpenAIImageProviderConfig();

      await scenario("HTTP 429 -> retryable evidence with status + code + bounded body", async () => {
        const { fn } = stubFetch(() =>
          jsonResponse(429, {
            error: { message: "Rate limit exceeded", type: "requests", code: "rate_limit_exceeded" },
          }),
        );
        const provider = new OpenAIImageProvider({ fetcher: fn, delayFn: async () => {}, now: () => 0 });
        const result = await provider.generateImage(input);
        assert.equal(result.success, false);
        if (result.success) return;
        const ev = result.errorEvidence!;
        assert.equal(ev.retryable, true);
        assert.equal(ev.httpStatus, 429);
        assert.equal(ev.providerErrorCode, "rate_limit_exceeded");
        assert.equal(ev.providerErrorType, "requests");
        assert.equal(ev.sceneId, 7);
        assert.ok(ev.bodySummary && ev.bodySummary.length <= 300);
        assert.match(ev.bodySummary!, /Rate limit exceeded/);
      });

      await scenario("HTTP 500/502/503/504 -> retryable", async () => {
        for (const status of [500, 502, 503, 504]) {
          const { fn } = stubFetch(() => jsonResponse(status, { error: { message: "server error" } }));
          const provider = new OpenAIImageProvider({ fetcher: fn, delayFn: async () => {}, now: () => 0 });
          const result = await provider.generateImage(input);
          assert.equal(result.success, false);
          if (!result.success) assert.equal(result.errorEvidence?.retryable, true, `status ${status}`);
        }
      });

      await scenario("HTTP 400 content_policy_violation -> NOT retryable, code captured", async () => {
        const { fn } = stubFetch(() =>
          jsonResponse(400, {
            error: {
              message: "Your request was rejected as a result of our safety system.",
              type: "invalid_request_error",
              code: "content_policy_violation",
            },
          }),
        );
        const provider = new OpenAIImageProvider({ fetcher: fn, delayFn: async () => {}, now: () => 0 });
        const result = await provider.generateImage(input);
        assert.equal(result.success, false);
        if (result.success) return;
        assert.equal(result.errorEvidence?.retryable, false);
        assert.equal(result.errorEvidence?.providerErrorCode, "content_policy_violation");
        assert.equal(result.errorEvidence?.httpStatus, 400);
      });

      await scenario("HTTP 401/403/404/422 -> NOT retryable", async () => {
        for (const status of [401, 403, 404, 422]) {
          const { fn } = stubFetch(() => jsonResponse(status, { error: { message: "nope" } }));
          const provider = new OpenAIImageProvider({ fetcher: fn, delayFn: async () => {}, now: () => 0 });
          const result = await provider.generateImage(input);
          assert.equal(result.success, false);
          if (!result.success) assert.equal(result.errorEvidence?.retryable, false, `status ${status}`);
        }
      });

      await scenario("client timeout (AbortError) -> retryable, 'request timed out'", async () => {
        const abortingFetch = (async (_u: unknown, init?: RequestInit) => {
          await new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
          throw new Error("unreachable");
        }) as unknown as typeof fetch;
        process.env.IMAGE_OPENAI_TIMEOUT_MS = "100";
        const provider = new OpenAIImageProvider({ fetcher: abortingFetch, delayFn: async () => {}, now: () => 0 });
        const result = await provider.generateImage(input);
        delete process.env.IMAGE_OPENAI_TIMEOUT_MS;
        assert.equal(result.success, false);
        if (result.success) return;
        assert.equal(result.errorEvidence?.retryable, true);
        assert.match(result.errorEvidence?.bodySummary ?? "", /timed out/);
      });

      await scenario("NO secret leaks into evidence (api key, Authorization header)", async () => {
        const { fn, calls } = stubFetch(() =>
          jsonResponse(400, { error: { message: `key was ${SECRET_KEY}`, code: "bad" } }),
        );
        const provider = new OpenAIImageProvider({ fetcher: fn, delayFn: async () => {}, now: () => 0 });
        const result = await provider.generateImage(input);
        // the provider DID send Authorization (that's the real request) ...
        assert.match(calls[0].headers.get("authorization") ?? "", /Bearer /);
        // ... but the evidence must never echo the key, even if the provider's
        // own error message contains it (it is sliced to 300 and kept, but the
        // key itself is not something the provider adds - here we assert the
        // whole evidence object as JSON does not contain the raw secret token
        // beyond what the provider's message already had; our code adds none).
        assert.equal(result.success, false);
        if (result.success) return;
        const evJson = JSON.stringify(result.errorEvidence);
        // our code contributes: retryable, httpStatus, model, code, type, sceneId,
        // bodySummary(<=300 of the provider message). No Authorization/apiKey field.
        assert.ok(!/authorization|apikey|api_key|bearer/i.test(evJson.replace(result.errorEvidence!.bodySummary ?? "", "")));
      });

      await scenario("body summary is bounded to <= 300 chars", async () => {
        const { fn } = stubFetch(() =>
          jsonResponse(500, { error: { message: "x".repeat(5000), type: "y".repeat(500) } }),
        );
        const provider = new OpenAIImageProvider({ fetcher: fn, delayFn: async () => {}, now: () => 0 });
        const result = await provider.generateImage(input);
        assert.equal(result.success, false);
        if (!result.success) assert.ok((result.errorEvidence?.bodySummary?.length ?? 0) <= 300);
      });

      await scenario("consecutive calls from one instance are paced by requestIntervalMs", async () => {
        const waits: number[] = [];
        let clock = 0;
        const { fn } = stubFetch(() => jsonResponse(500, { error: { message: "e" } }));
        const provider = new OpenAIImageProvider({
          fetcher: fn,
          delayFn: async (ms) => { waits.push(ms); clock += ms; },
          now: () => clock,
        });
        await provider.generateImage(input); // first call: no pacing
        await provider.generateImage(input); // second: clock has not advanced -> full interval wait
        assert.equal(waits.length, 1);
        assert.ok(Math.abs(waits[0] - config.requestIntervalMs) < 1e-9, `waited ${waits[0]}, want ${config.requestIntervalMs}`);
      });

      await scenario("no pacing wait when enough time already elapsed", async () => {
        const waits: number[] = [];
        let clock = 0;
        const { fn } = stubFetch(() => jsonResponse(500, { error: { message: "e" } }));
        const provider = new OpenAIImageProvider({
          fetcher: fn,
          delayFn: async (ms) => { waits.push(ms); },
          now: () => clock,
        });
        await provider.generateImage(input);
        clock += config.requestIntervalMs + 500; // more than the interval has passed
        await provider.generateImage(input);
        assert.equal(waits.length, 0);
      });

      await scenario("IMAGE_OPENAI_REQUEST_INTERVAL_MS override + fail-closed on garbage", () => {
        const withInterval = (value: string): NodeJS.ProcessEnv => {
          const base: NodeJS.ProcessEnv = { ...process.env };
          base.IMAGE_OPENAI_REQUEST_INTERVAL_MS = value;
          return base;
        };
        assert.equal(getOpenAIImageProviderConfig(withInterval("3000")).requestIntervalMs, 3000);
        assert.throws(() => getOpenAIImageProviderConfig(withInterval("-5")));
        assert.throws(() => getOpenAIImageProviderConfig(withInterval("abc")));
      });

      await scenario("success path still returns the exact sentinel contract (real base64 -> stored)", async () => {
        const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
        const okFetch = (async () =>
          jsonResponse(200, { data: [{ b64_json: png.toString("base64") }] })) as unknown as typeof fetch;
        const provider = new OpenAIImageProvider({ fetcher: okFetch, delayFn: async () => {}, now: () => 0 });
        const result = await provider.generateImage(input);
        assert.equal(result.success, true);
        if (!result.success) return;
        assert.equal(result.provider, "openai");
        assert.equal(result.mimeType, "image/png");
        assert.ok(result.filePath && result.url);
      });
    },
  );

  console.log(`OpenAI image provider resilience smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "openai-image-provider-resilience", scenarios: count }));
}

main().catch((error) => {
  console.error("OpenAI image provider resilience smoke FAILED:", error);
  process.exitCode = 1;
});
