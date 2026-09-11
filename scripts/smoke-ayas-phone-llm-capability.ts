/**
 * AYAS phone-local LLM capability detection smoke suite (Tier 2 prototype).
 *
 * Deterministic, no browser, no GPU — the WebGPU handshake is mocked via the
 * injectable `AyasPhoneLlmCapabilityWindowLike` shape. Covers: insecure
 * context, missing API, null adapter, adapter throwing, device-request
 * failure, and the full success path — every failure path returns a reasoned,
 * non-generic answer (never a silent `false`).
 */

import assert from "node:assert/strict";

import {
  detectAyasPhoneLlmCapability,
  AYAS_PHONE_LLM_UNAVAILABLE_MESSAGE,
  type AyasPhoneLlmCapabilityWindowLike,
} from "../src/components/brain/voice/localLlm/phoneLlmCapability";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function win(over: Partial<AyasPhoneLlmCapabilityWindowLike> = {}): AyasPhoneLlmCapabilityWindowLike {
  return { isSecureContext: true, navigator: { gpu: undefined }, ...over };
}

async function run() {
  await scenario("no window → unknown-error, not capable", async () => {
    const r = await detectAyasPhoneLlmCapability(undefined);
    assert.equal(r.capable, false);
    assert.equal(r.reason, "unknown-error");
  });

  await scenario("insecure context → insecure-context, before even checking navigator.gpu", async () => {
    const r = await detectAyasPhoneLlmCapability(win({ isSecureContext: false }));
    assert.equal(r.capable, false);
    assert.equal(r.reason, "insecure-context");
  });

  await scenario("no navigator.gpu → webgpu-api-missing", async () => {
    const r = await detectAyasPhoneLlmCapability(win({ navigator: {} }));
    assert.equal(r.capable, false);
    assert.equal(r.reason, "webgpu-api-missing");
    assert.equal(r.webgpuApiPresent, false);
  });

  await scenario("requestAdapter() resolves null → no-adapter", async () => {
    const r = await detectAyasPhoneLlmCapability(
      win({ navigator: { gpu: { requestAdapter: async () => null } } }),
    );
    assert.equal(r.capable, false);
    assert.equal(r.reason, "no-adapter");
    assert.equal(r.webgpuApiPresent, true);
  });

  await scenario("requestAdapter() throws → no-adapter, error message captured", async () => {
    const r = await detectAyasPhoneLlmCapability(
      win({ navigator: { gpu: { requestAdapter: async () => { throw new Error("adapter denied"); } } } }),
    );
    assert.equal(r.capable, false);
    assert.equal(r.reason, "no-adapter");
    assert.match(r.detail ?? "", /adapter denied/);
  });

  await scenario("requestDevice() throws → device-request-failed", async () => {
    const r = await detectAyasPhoneLlmCapability(
      win({
        navigator: {
          gpu: {
            requestAdapter: async () => ({
              info: { vendor: "test-vendor" },
              requestDevice: async () => {
                throw new Error("out of memory");
              },
            }),
          },
        },
      }),
    );
    assert.equal(r.capable, false);
    assert.equal(r.reason, "device-request-failed");
    assert.equal(r.adapterObtained, true);
    assert.equal(r.deviceObtained, false);
  });

  await scenario("full success path → capable, adapter vendor + deviceMemory surfaced", async () => {
    const r = await detectAyasPhoneLlmCapability(
      win({
        navigator: {
          deviceMemory: 8,
          gpu: {
            requestAdapter: async () => ({
              info: { vendor: "apple" },
              requestDevice: async () => ({}),
            }),
          },
        },
      }),
    );
    assert.equal(r.capable, true);
    assert.equal(r.reason, null);
    assert.equal(r.adapterVendor, "apple");
    assert.equal(r.deviceMemoryGb, 8);
  });

  await scenario("deviceMemory absent (Safari never exposes it) → null, not a failure", async () => {
    const r = await detectAyasPhoneLlmCapability(
      win({
        navigator: {
          gpu: {
            requestAdapter: async () => ({ requestDevice: async () => ({}) }),
          },
        },
      }),
    );
    assert.equal(r.capable, true);
    assert.equal(r.deviceMemoryGb, null);
  });

  await scenario("the fixed fail-closed message is exported and non-empty", () => {
    assert.ok(AYAS_PHONE_LLM_UNAVAILABLE_MESSAGE.length > 0);
  });

  await scenario("wasmAvailable + userAgent are surfaced (informational, computed before any WebGPU check)", async () => {
    const withWasm = { ...win({ isSecureContext: false }), WebAssembly: {} } as AyasPhoneLlmCapabilityWindowLike;
    const r = await detectAyasPhoneLlmCapability(withWasm);
    assert.equal(r.capable, false, "insecure context still fails capability");
    assert.equal(r.wasmAvailable, true, "but wasmAvailable is still reported — it is informational, not gating");
  });

  await scenario("wasmAvailable is false when WebAssembly is absent (no mock global set)", async () => {
    const r = await detectAyasPhoneLlmCapability(win({ navigator: { userAgent: "TestBrowser/1.0" } }));
    assert.equal(r.wasmAvailable, false);
    assert.equal(r.userAgent, "TestBrowser/1.0");
  });

  console.log(`AYAS phone LLM capability smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-phone-llm-capability", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS phone LLM capability smoke FAILED:", error);
  process.exitCode = 1;
});
