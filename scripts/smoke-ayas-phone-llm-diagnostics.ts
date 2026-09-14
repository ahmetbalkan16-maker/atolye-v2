/**
 * AYAS phone-local LLM — full-chain diagnostics smoke suite (closure
 * sprint item 6: sessionStorage checkpoint breadcrumb + visibility
 * tracking).
 *
 * No browser: mocks a minimal `sessionStorage` (Node has no global one) and
 * a minimal `document` with `visibilityState` + `addEventListener` for the
 * `watchPhoneLlmVisibility` scenarios.
 *
 * Proves:
 *  1. Every checkpoint name in the closure-sprint spec round-trips through
 *     record → read-and-clear exactly.
 *  2. The rolling history is bounded (doesn't grow unboundedly) and is in
 *     chronological order.
 *  3. A clean end (`clearPhoneLlmCheckpoints`) leaves nothing for the next
 *     mount to find — the "stale means abrupt" contract.
 *  4. `wasLikelyBackgrounded` correctly distinguishes a stall that happened
 *     while the tab was hidden from one that didn't — this is what lets a
 *     future stall be explained instead of guessed at.
 *  5. `watchPhoneLlmVisibility` actually records real `visibilitychange`
 *     events, and its cleanup function actually detaches the listener.
 *  6. Every function is a documented no-op (never throws) when
 *     `sessionStorage`/`document` are unavailable.
 */

import assert from "node:assert/strict";

import {
  clearPhoneLlmCheckpoints,
  readAndClearStalePhoneLlmCheckpoints,
  recordPhoneLlmCheckpoint,
  wasLikelyBackgrounded,
  watchPhoneLlmVisibility,
  type PhoneLlmCheckpointName,
} from "../src/components/brain/voice/localLlm/phoneLlmDiagnostics";

/** Minimal in-memory `Storage` — enough for `getItem`/`setItem`/`removeItem`, which is all this module uses. */
function fakeSessionStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

async function run() {
  (globalThis as { sessionStorage?: Storage }).sessionStorage = fakeSessionStorage();

  await scenario("record → read-and-clear round-trips every field, and clears both keys", () => {
    recordPhoneLlmCheckpoint("download:start", { modelId: "onnx-community/Qwen2.5-0.5B-Instruct", file: "config.json", percent: null });
    const stale = readAndClearStalePhoneLlmCheckpoints();
    assert.ok(stale);
    assert.equal(stale!.latest.name, "download:start");
    assert.equal(stale!.latest.modelId, "onnx-community/Qwen2.5-0.5B-Instruct");
    assert.equal(stale!.latest.file, "config.json");
    assert.equal(typeof stale!.latest.at, "number");

    // A second read finds nothing — the first read cleared it.
    assert.equal(readAndClearStalePhoneLlmCheckpoints(), null);
  });

  await scenario("every closure-sprint checkpoint name (file-level and chunk-level) is accepted and recorded in order — chunk:bytes_progress excluded from the milestone history on purpose (see next scenario)", () => {
    const milestoneNames: PhoneLlmCheckpointName[] = [
      "download:start",
      "chunk:start",
      "chunk:fetch_start",
      "chunk:response_received",
      "chunk:response_status",
      "chunk:content_range",
      "chunk:aborted_unexpected_status",
      "chunk:reader_start",
      "chunk:first_bytes",
      "chunk:reader_complete",
      "chunk:idb_write_start",
      "chunk:idb_write_complete",
      "chunk:complete",
      "download:end",
      "persist:start",
      "persist:end",
      "verify:start",
      "verify:end",
      "runtime:start",
      "runtime:end",
      "generation:start",
      "generation:first-token",
      "generation:end",
    ];
    for (const name of milestoneNames) recordPhoneLlmCheckpoint(name, { modelId: "m" });
    const stale = readAndClearStalePhoneLlmCheckpoints();
    assert.ok(stale);
    assert.equal(stale!.latest.name, "generation:end", "latest must be the last one recorded");
    assert.deepEqual(
      stale!.history.map((e) => e.name),
      milestoneNames,
      "every milestone name must appear in the history, in exact chronological order",
    );
  });

  await scenario("clearPhoneLlmCheckpoints leaves nothing for the next mount — the clean-end contract", () => {
    recordPhoneLlmCheckpoint("runtime:start", { modelId: "m" });
    recordPhoneLlmCheckpoint("runtime:end", { modelId: "m" });
    clearPhoneLlmCheckpoints();
    assert.equal(readAndClearStalePhoneLlmCheckpoints(), null);
  });

  await scenario("chunk:bytes_progress is routed to its own small, bounded tail — never the milestone history", () => {
    for (let i = 0; i < 250; i += 1) recordPhoneLlmCheckpoint("chunk:bytes_progress", { modelId: "m", chunkIndex: 0, percent: i });
    const stale = readAndClearStalePhoneLlmCheckpoints();
    assert.ok(stale);
    assert.equal(stale!.history.length, 0, "a pure progress flood must leave the milestone history untouched");
    assert.ok(stale!.progressTail.length <= 5, `progress tail must be small and bounded, was ${stale!.progressTail.length}`);
    // The most recent entries must be the ones kept, not the oldest.
    assert.equal(stale!.progressTail[stale!.progressTail.length - 1].percent, 249);
  });

  await scenario("REGRESSION FIX PROOF: a real-device-scale flood of chunk:bytes_progress (480+ ticks, as an unbounded ~483MB read produced) never evicts milestone checkpoints from EARLIER in the SAME chunk or from other chunks", () => {
    // Reproduces the exact real-device report: chunk:start/fetch_start/
    // response_status/content_range for chunk 0, THEN ~480 bytes_progress
    // ticks (one per throttled MB of an unbounded read), THEN
    // reader_complete — before the fix, the flood alone would have evicted
    // everything before it out of the (then-shared) 100-slot history.
    recordPhoneLlmCheckpoint("download:start", { modelId: "m", file: "onnx/model_q4f16.onnx" });
    recordPhoneLlmCheckpoint("chunk:start", { modelId: "m", chunkIndex: 0 });
    recordPhoneLlmCheckpoint("chunk:fetch_start", { modelId: "m", chunkIndex: 0, detail: "bytes=0-8388607" });
    recordPhoneLlmCheckpoint("chunk:response_status", { modelId: "m", chunkIndex: 0, detail: "200" });
    recordPhoneLlmCheckpoint("chunk:content_range", { modelId: "m", chunkIndex: 0, detail: "absent" });
    for (let mb = 1; mb <= 483; mb += 1) {
      recordPhoneLlmCheckpoint("chunk:bytes_progress", { modelId: "m", chunkIndex: 0, detail: String(mb * 1024 * 1024) });
    }
    recordPhoneLlmCheckpoint("chunk:reader_complete", { modelId: "m", chunkIndex: 0, detail: "483003582" });

    const stale = readAndClearStalePhoneLlmCheckpoints();
    assert.ok(stale);
    const names = stale!.history.map((e) => e.name);
    assert.deepEqual(
      names,
      ["download:start", "chunk:start", "chunk:fetch_start", "chunk:response_status", "chunk:content_range", "chunk:reader_complete"],
      "all 6 milestones must survive, in order, despite 483 progress ticks in between — none evicted",
    );
    // And the crash-recovery banner still gets SOME visibility into how
    // far the read got, from the separate tail — just not all 483 ticks.
    assert.ok(stale!.progressTail.length > 0 && stale!.progressTail.length <= 5);
    assert.equal(stale!.progressTail[stale!.progressTail.length - 1].detail, String(483 * 1024 * 1024));
  });

  await scenario("chunk-level detail (status/content-range/byte counts) round-trips through the checkpoint entry", () => {
    recordPhoneLlmCheckpoint("chunk:response_status", { modelId: "m", file: "onnx/model_q4f16.onnx", chunkIndex: 3, detail: "206" });
    recordPhoneLlmCheckpoint("chunk:content_range", { modelId: "m", file: "onnx/model_q4f16.onnx", chunkIndex: 3, detail: "bytes 25165824-33554431/483003582" });
    const stale = readAndClearStalePhoneLlmCheckpoints();
    assert.ok(stale);
    assert.equal(stale!.history[0].chunkIndex, 3);
    assert.equal(stale!.history[0].detail, "206");
    assert.equal(stale!.history[1].detail, "bytes 25165824-33554431/483003582");
  });

  await scenario("wasLikelyBackgrounded: true when the most recent visibility event before the stall was 'hidden'", () => {
    recordPhoneLlmCheckpoint("download:start", { modelId: "m" });
    recordPhoneLlmCheckpoint("visibility:hidden", { modelId: "m" });
    recordPhoneLlmCheckpoint("chunk:start", { modelId: "m", chunkIndex: 5 }); // stall happens here, mid-background
    const stale = readAndClearStalePhoneLlmCheckpoints();
    assert.ok(stale);
    assert.equal(wasLikelyBackgrounded(stale!), true);
  });

  await scenario("wasLikelyBackgrounded: false when the most recent visibility event was 'visible' (or none at all)", () => {
    recordPhoneLlmCheckpoint("visibility:hidden", { modelId: "m" });
    recordPhoneLlmCheckpoint("visibility:visible", { modelId: "m" });
    recordPhoneLlmCheckpoint("persist:start", { modelId: "m" });
    const stale = readAndClearStalePhoneLlmCheckpoints();
    assert.ok(stale);
    assert.equal(wasLikelyBackgrounded(stale!), false, "foregrounded again before the stall — not a backgrounding-caused stall");

    recordPhoneLlmCheckpoint("verify:start", { modelId: "m" }); // no visibility event at all in this run
    const stale2 = readAndClearStalePhoneLlmCheckpoints();
    assert.ok(stale2);
    assert.equal(wasLikelyBackgrounded(stale2!), false, "no visibility evidence → do not claim backgrounding");
  });

  await scenario("watchPhoneLlmVisibility records real visibilitychange events and its cleanup detaches the listener", () => {
    // An object-property holder (not a bare `let`) so TS's control-flow
    // narrowing across the closures below stays simple and predictable.
    const captured: { visibilityState: "visible" | "hidden"; handler: (() => void) | null } = {
      visibilityState: "visible",
      handler: null,
    };
    const fakeDocument = {
      get visibilityState() {
        return captured.visibilityState;
      },
      addEventListener: (event: string, cb: () => void) => {
        if (event === "visibilitychange") captured.handler = cb;
      },
      removeEventListener: (event: string, cb: () => void) => {
        if (event === "visibilitychange" && captured.handler === cb) captured.handler = null;
      },
    };
    (globalThis as { document?: typeof fakeDocument }).document = fakeDocument;

    const stop = watchPhoneLlmVisibility("model-x");
    assert.ok(captured.handler, "must attach a visibilitychange listener");

    captured.visibilityState = "hidden";
    captured.handler?.();
    captured.visibilityState = "visible";
    captured.handler?.();

    const stale = readAndClearStalePhoneLlmCheckpoints();
    assert.ok(stale);
    assert.deepEqual(
      stale!.history.map((e) => e.name),
      ["visibility:hidden", "visibility:visible"],
    );
    assert.ok(stale!.history.every((e) => e.modelId === "model-x"));

    stop();
    assert.equal(captured.handler, null, "cleanup must detach the listener");
    delete (globalThis as { document?: unknown }).document;
  });

  await scenario("no sessionStorage available → every function is a safe no-op, never throws", () => {
    const saved = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
    try {
      recordPhoneLlmCheckpoint("download:start", { modelId: "m" }); // must not throw
      clearPhoneLlmCheckpoints(); // must not throw
      assert.equal(readAndClearStalePhoneLlmCheckpoints(), null);
    } finally {
      (globalThis as { sessionStorage?: Storage }).sessionStorage = saved;
    }
  });

  await scenario("no document available → watchPhoneLlmVisibility returns a harmless no-op cleanup", () => {
    delete (globalThis as { document?: unknown }).document;
    const stop = watchPhoneLlmVisibility("m");
    assert.doesNotThrow(() => stop());
  });

  console.log(`AYAS phone LLM diagnostics smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-phone-llm-diagnostics", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS phone LLM diagnostics smoke FAILED:", error);
  process.exitCode = 1;
});
