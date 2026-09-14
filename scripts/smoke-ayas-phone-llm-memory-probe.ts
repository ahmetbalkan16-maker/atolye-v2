/**
 * AYAS phone-local LLM — memory-pressure probe smoke suite (Cache Storage
 * blocker closure sprint: process-death lifecycle/retention audit).
 *
 * Deterministic — no real GC forcing (V8's GC timing is non-deterministic
 * and not reliably triggerable from a short-lived script without
 * `--expose-gc`, which isn't assumed available here), so this proves the
 * REGISTRATION/counting mechanisms work correctly, not that a real
 * `FinalizationRegistry` callback fires within the test's lifetime —
 * exactly the same honest boundary the module's own header states.
 */

import assert from "node:assert/strict";

import {
  enterChunkInFlight,
  exitChunkInFlight,
  formatMemorySample,
  isFinalizationRegistrySupported,
  sampleMemoryMb,
  trackBufferFinalization,
} from "../src/components/brain/voice/localLlm/phoneLlmMemoryProbe";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

async function run() {
  await scenario("sampleMemoryMb: honestly reports unavailable when performance.memory doesn't exist (Node has no such extension)", () => {
    const sample = sampleMemoryMb();
    // Node's `performance` object has no `.memory` extension (that's a
    // Chrome/Chromium-specific non-standard addition) — this must be
    // reported as unavailable, never fabricated.
    assert.equal(sample.available, false);
    assert.equal(sample.usedMb, null);
    assert.equal(formatMemorySample(sample), "unavailable");
  });

  await scenario("sampleMemoryMb: reports real numbers when performance.memory IS present (simulated)", () => {
    const original = (performance as unknown as { memory?: unknown }).memory;
    (performance as unknown as { memory?: unknown }).memory = {
      usedJSHeapSize: 50 * 1024 * 1024,
      totalJSHeapSize: 80 * 1024 * 1024,
      jsHeapSizeLimit: 384 * 1024 * 1024,
    };
    try {
      const sample = sampleMemoryMb();
      assert.equal(sample.available, true);
      assert.equal(sample.usedMb, 50);
      assert.equal(sample.totalMb, 80);
      assert.equal(sample.limitMb, 384);
      assert.equal(formatMemorySample(sample), "used=50MB total=80MB limit=384MB");
    } finally {
      (performance as unknown as { memory?: unknown }).memory = original;
    }
  });

  await scenario("FinalizationRegistry support is correctly detected (Node supports it natively)", () => {
    assert.equal(isFinalizationRegistrySupported(), true);
  });

  await scenario("trackBufferFinalization: registration never throws, even for many buffers in a row", () => {
    for (let i = 0; i < 20; i += 1) {
      const buffer = new Uint8Array(1024);
      assert.doesNotThrow(() => trackBufferFinalization(buffer, i, () => {}));
    }
  });

  await scenario("trackBufferFinalization: a safe no-op when FinalizationRegistry is unavailable (simulated)", () => {
    const original = globalThis.FinalizationRegistry;
    // @ts-expect-error — deliberately removing it to test the feature-detection path
    delete globalThis.FinalizationRegistry;
    try {
      assert.equal(isFinalizationRegistrySupported(), false);
      assert.doesNotThrow(() => trackBufferFinalization(new Uint8Array(10), 0, () => {}));
    } finally {
      globalThis.FinalizationRegistry = original;
    }
  });

  await scenario("concurrency counter: sequential enter/exit never exceeds 1 in flight", () => {
    for (let i = 0; i < 5; i += 1) {
      const inFlight = enterChunkInFlight();
      assert.equal(inFlight, 1, "strictly sequential usage must never see more than 1 in flight");
      const after = exitChunkInFlight();
      assert.equal(after, 0);
    }
  });

  await scenario("concurrency counter: overlapping enter calls (simulated violation) are correctly detectable", () => {
    const first = enterChunkInFlight();
    const second = enterChunkInFlight(); // simulates a real concurrency bug — enter() called again before the first exit()
    assert.equal(first, 1);
    assert.equal(second, 2, "a second concurrent enter() must report a count > 1 — the violation signal callers check for");
    exitChunkInFlight();
    exitChunkInFlight();
  });

  await scenario("concurrency counter: exit() never goes negative even if called more than entered", () => {
    const after = exitChunkInFlight();
    assert.ok(after >= 0, "must clamp at 0, never go negative");
  });

  console.log(`AYAS phone LLM memory-probe smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-phone-llm-memory-probe", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS phone LLM memory-probe smoke FAILED:", error);
  process.exitCode = 1;
});
