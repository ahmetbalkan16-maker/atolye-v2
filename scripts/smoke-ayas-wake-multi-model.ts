/**
 * AYAS multi-model acoustic wake smoke suite — True Hands-Free UYAN Acoustic
 * Wake Finalization sprint.
 *
 * `WakeWordVoiceAdapter` can now score an OPTIONAL second acoustic model
 * ("alias") alongside the primary one on every "wake" frame — see
 * `wakewordUrlAlias` / `runnerAlias` in `wakeWordVoiceAdapter.ts`. This suite
 * is deterministic / no browser / no real ONNX model: it proves the DECISION
 * LOGIC (which of two independent score streams fires the wake, and what
 * happens once it does) with fake runners, exactly like
 * `smoke-ayas-wake-adapter.ts`'s existing `FakeRunner` pattern.
 *
 * What this suite does NOT prove: real acoustic accuracy of the trained
 * "UYAN" openWakeWord model against real audio. That is a SEPARATE concern —
 * see the "REAL: …" integration scenarios appended to
 * `scripts/smoke-ayas-wake-runner.ts`, which run the actual trained
 * `public/wake/uyan.onnx` through the actual `OpenWakeWordRunner` against
 * Piper-synthesised positive/negative clips. Conflating the two would be
 * exactly the "text matcher correctness" vs "acoustic model correctness"
 * mistake the task explicitly warns against.
 *
 * Covers:
 *  - default (no alias) construction is BYTE-FOR-BYTE unchanged — single
 *    model, `wakeSource` reports the (unchanged) default primary label;
 *  - a wake from EITHER model reaches the exact same canonical wake intent
 *    (`onFinalTranscript("AYAS")`) and the exact same capture/state-machine
 *    path — no second engine, no new execution surface;
 *  - `wakeSource` diagnostics correctly attribute "uyan-acoustic" vs
 *    "ayas-acoustic";
 *  - both runners/detectors are lifecycle-managed together (init / reset /
 *    rearm / dispose) across a full multi-turn session;
 *  - the alias model firing while the primary stays silent (and vice versa)
 *    still wakes exactly once — no double-fire, no missed fire;
 *  - Execution Gate / no-authorization invariants hold across every
 *    wake-source combination.
 */
import assert from "node:assert/strict";

import {
  WakeWordVoiceAdapter,
  type WakeAudioBackend,
  type WakeRunnerLike,
} from "../src/components/brain/voice/wakeWordVoiceAdapter";
import type { AyasListenHandlers, AyasSpeakOptions } from "../src/components/brain/voice/ayasVoiceEngine";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const FRAME = 1280;
const settle = async (n = 15) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0));
};

/** `document` stub — the adapter registers a visibilitychange listener. */
(globalThis as { document?: unknown }).document = {
  visibilityState: "visible" as const,
  addEventListener: () => {},
  removeEventListener: () => {},
};

class FakeBackend implements WakeAudioBackend {
  readonly supported = true;
  onFrame: ((f: Float32Array) => void) | null = null;
  started = 0;
  async start(cb: (f: Float32Array) => void) {
    this.onFrame = cb;
    this.started += 1;
  }
  stop() {
    this.onFrame = null;
  }
  /** Push a frame tagged for a specific model key (or untagged = silence/noise for both). */
  push(tag?: string) {
    if (!this.onFrame) return;
    const f = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i += 1) f[i] = Math.sin(i / 4) * 0.3;
    (f as Float32Array & { __wake?: string }).__wake = tag;
    this.onFrame(f);
  }
}

/** Fires (score 0.97) only for frames tagged with its own model key; else 0.01. */
class TaggedRunner implements WakeRunnerLike {
  ready = false;
  inits = 0;
  resets = 0;
  disposes = 0;
  accepts = 0;
  constructor(private readonly key: string) {}
  async init() {
    this.ready = true;
    this.inits += 1;
  }
  reset() {
    this.resets += 1;
  }
  dispose() {
    this.disposes += 1;
    this.ready = false;
  }
  async accept(frame: Float32Array) {
    this.accepts += 1;
    return (frame as Float32Array & { __wake?: string }).__wake === this.key ? 0.97 : 0.01;
  }
  get stats() {
    return {
      dropped: 0,
      inferences: this.accepts,
      lastError: null,
      pendingSamples: 0,
      maxPendingSamples: 0,
      catchupBatchesTotal: 0,
      maxCatchupInOneAccept: 1,
      maxConcurrentInference: 1,
      frames: this.accepts,
    };
  }
}

function fakeTts() {
  const speak = (_text: string, options: AyasSpeakOptions) => {
    queueMicrotask(() => {
      options.onStart();
      queueMicrotask(() => options.onEnd());
    });
    return { cancel: () => {} };
  };
  return {
    speak,
    cancelSpeech: () => {},
    detectCapability: () => ({ stt: false, tts: true, sttCloudBacked: false }),
    listVoices: () => [],
    onVoicesChanged: () => () => {},
  };
}

function collectHandlers() {
  const finals: string[] = [];
  const errors: string[] = [];
  const handlers: AyasListenHandlers = {
    onFinalTranscript: (t) => finals.push(t),
    onError: (c) => errors.push(c),
    onEnd: () => {},
  };
  return { handlers, finals, errors };
}

const FAST = { rearmCooldownMs: 0, startRetryBackoffMs: 1, threshold: 0.5, tts: fakeTts() } as const;

async function run() {
  /* ============================ backward compatibility ==================== */

  await scenario("default construction (no alias option) is unaffected — single runner, wakeSource uses the unchanged default label", async () => {
    const backend = new FakeBackend();
    const runner = new TaggedRunner("only");
    const adapter = new WakeWordVoiceAdapter({ ...FAST, audioBackend: backend, runner });
    const { handlers, finals } = collectHandlers();
    adapter.startListening("tr-TR", handlers);
    await settle();

    backend.push("only");
    await settle();

    assert.deepEqual(finals, ["AYAS"], "the canonical wake intent is unchanged");
    assert.equal(adapter.getStatus().wakeSource, "ayas-acoustic", "default label is unchanged from before this option existed");
    assert.equal(adapter.getStatus().wakeScoreAlias, null, "no alias configured => no alias diagnostics");
    adapter.dispose();
  });

  /* ============================ dual-model wake ============================ */

  await scenario("PRIMARY (UYAN) model firing wakes AYAS via the exact same canonical path, labeled 'uyan-acoustic'", async () => {
    const backend = new FakeBackend();
    const primary = new TaggedRunner("uyan");
    const alias = new TaggedRunner("ayas");
    const adapter = new WakeWordVoiceAdapter({
      ...FAST,
      audioBackend: backend,
      runner: primary,
      runnerAlias: alias,
      primaryWakeLabel: "uyan-acoustic",
      aliasWakeLabel: "ayas-acoustic",
    });
    const { handlers, finals } = collectHandlers();
    adapter.startListening("tr-TR", handlers);
    await settle();

    backend.push("uyan");
    await settle();

    assert.deepEqual(finals, ["AYAS"], "UYAN and AYAS both normalize into the SAME canonical wake intent");
    assert.equal(adapter.getStatus().wakeSource, "uyan-acoustic");
    adapter.dispose();
  });

  await scenario("ALIAS (AYAS) model firing while the primary (UYAN) stays silent still wakes — backward compatibility for the old wake word", async () => {
    const backend = new FakeBackend();
    const primary = new TaggedRunner("uyan");
    const alias = new TaggedRunner("ayas");
    const adapter = new WakeWordVoiceAdapter({
      ...FAST,
      audioBackend: backend,
      runner: primary,
      runnerAlias: alias,
      primaryWakeLabel: "uyan-acoustic",
      aliasWakeLabel: "ayas-acoustic",
    });
    const { handlers, finals } = collectHandlers();
    adapter.startListening("tr-TR", handlers);
    await settle();

    backend.push("ayas"); // primary "uyan" model does NOT match this tag
    await settle();

    assert.deepEqual(finals, ["AYAS"]);
    assert.equal(adapter.getStatus().wakeSource, "ayas-acoustic");
    adapter.dispose();
  });

  await scenario("neither model's phrase is spoken → no wake, no command, from either detector", async () => {
    const backend = new FakeBackend();
    const primary = new TaggedRunner("uyan");
    const alias = new TaggedRunner("ayas");
    const adapter = new WakeWordVoiceAdapter({
      ...FAST,
      audioBackend: backend,
      runner: primary,
      runnerAlias: alias,
    });
    const { handlers, finals } = collectHandlers();
    adapter.startListening("tr-TR", handlers);
    await settle();

    for (let i = 0; i < 10; i += 1) backend.push(undefined); // silence / unrelated speech
    await settle();

    assert.deepEqual(finals, []);
    assert.equal(adapter.getStatus().wakeSource, null);
    adapter.dispose();
  });

  await scenario("both models score high on the SAME frame (edge case) — fires exactly once, primary wins deterministically", async () => {
    const backend = new FakeBackend();
    class AlwaysHot implements WakeRunnerLike {
      ready = false;
      async init() {
        this.ready = true;
      }
      reset() {}
      dispose() {}
      async accept() {
        return 0.97;
      }
      stats = { dropped: 0, inferences: 0, lastError: null, pendingSamples: 0, maxPendingSamples: 0, catchupBatchesTotal: 0, maxCatchupInOneAccept: 1, maxConcurrentInference: 1, frames: 0 };
    }
    const adapter = new WakeWordVoiceAdapter({
      ...FAST,
      audioBackend: backend,
      runner: new AlwaysHot(),
      runnerAlias: new AlwaysHot(),
      primaryWakeLabel: "uyan-acoustic",
      aliasWakeLabel: "ayas-acoustic",
    });
    const { handlers, finals } = collectHandlers();
    adapter.startListening("tr-TR", handlers);
    await settle();

    backend.push("x");
    await settle();

    assert.deepEqual(finals, ["AYAS"], "exactly one wake, never a double-fire");
    assert.equal(adapter.getStatus().wakeSource, "uyan-acoustic", "primary is checked first — deterministic tie-break");
    adapter.dispose();
  });

  /* ============================ lifecycle ============================ */

  await scenario("both runners are init()'d, reset() together on start, and dispose()'d together on teardown", async () => {
    const backend = new FakeBackend();
    const primary = new TaggedRunner("uyan");
    const alias = new TaggedRunner("ayas");
    const adapter = new WakeWordVoiceAdapter({ ...FAST, audioBackend: backend, runner: primary, runnerAlias: alias });
    const { handlers } = collectHandlers();
    adapter.startListening("tr-TR", handlers);
    await settle();

    assert.equal(primary.inits, 1);
    assert.equal(alias.inits, 1);
    assert.ok(primary.resets >= 1);
    assert.ok(alias.resets >= 1);

    adapter.dispose();
    assert.equal(primary.disposes, 1);
    assert.equal(alias.disposes, 1);
  });

  await scenario("multi-turn: UYAN wakes turn 1, AYAS (alias) wakes turn 2 — both re-arm cleanly, wakeSource updates each time", async () => {
    const backend = new FakeBackend();
    const primary = new TaggedRunner("uyan");
    const alias = new TaggedRunner("ayas");
    const adapter = new WakeWordVoiceAdapter({
      ...FAST,
      audioBackend: backend,
      runner: primary,
      runnerAlias: alias,
      primaryWakeLabel: "uyan-acoustic",
      aliasWakeLabel: "ayas-acoustic",
      conversationIdleMs: 5,
    });
    const { handlers, finals } = collectHandlers();
    adapter.startListening("tr-TR", handlers);
    await settle();

    backend.push("uyan");
    await settle();
    assert.equal(adapter.getStatus().wakeSource, "uyan-acoustic");

    adapter.endConversation();
    adapter.startListening("tr-TR", handlers);
    await settle();

    backend.push("ayas");
    await settle();
    assert.equal(adapter.getStatus().wakeSource, "ayas-acoustic");
    assert.deepEqual(finals, ["AYAS", "AYAS"]);
    adapter.dispose();
  });

  /* ============================ security invariants ============================ */

  await scenario("wakeSource is diagnostic text only — never a method name, never influences the Execution Gate / adapter surface", async () => {
    const backend = new FakeBackend();
    const adapter = new WakeWordVoiceAdapter({
      ...FAST,
      audioBackend: backend,
      runner: new TaggedRunner("uyan"),
      runnerAlias: new TaggedRunner("ayas"),
      primaryWakeLabel: "uyan-acoustic",
      aliasWakeLabel: "ayas-acoustic",
    });
    const { handlers, finals } = collectHandlers();
    adapter.startListening("tr-TR", handlers);
    await settle();
    backend.push("uyan");
    await settle();

    // the ONLY thing a caller ever receives from a wake is the text "AYAS" —
    // never a callable, never an authorization token, never a gate reference.
    assert.equal(typeof finals[0], "string");
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter));
    for (const banned of ["enqueue", "run", "execute", "approve", "startPipeline", "openGate", "authorize"]) {
      assert.ok(!surface.includes(banned), `adapter must not expose "${banned}"`);
    }
    adapter.dispose();
  });

  console.log(`AYAS wake multi-model smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-wake-multi-model", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
