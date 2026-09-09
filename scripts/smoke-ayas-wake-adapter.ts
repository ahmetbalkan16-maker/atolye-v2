/**
 * AYAS wake-engine adapter smoke suite — long-term lifecycle hardening.
 *
 * Deterministic / no browser / no model. Drives WakeWordVoiceAdapter with a
 * synchronous fake audio backend + fake runner + fake STT and asserts the full
 * lifecycle over many turns:
 *   first wake → command → STT → reply → TTS → re-arm → second wake → … (50×)
 * plus every failure/interruption path — an iOS-suspended AudioContext, an
 * ended mic track, a frame-flow stall, getUserMedia failure, STT/transport/TTS
 * failure — each recovered (bounded, no storm) with the mic kept warm.
 *
 * The invariant this guards: in normal multi-turn use the mic is acquired
 * ONCE — `backend.started` must NOT grow with the turn count.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { encodeWav16kMono } from "../src/components/brain/voice/wake/wav";
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
const REPO_ROOT = path.resolve(__dirname, "..");
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 10) => {
  for (let i = 0; i < n; i += 1) await tick();
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `document` stub so the visibilitychange wiring is exercised. */
const listeners = new Map<string, Set<() => void>>();
(globalThis as { document?: unknown }).document = {
  visibilityState: "visible" as "visible" | "hidden",
  addEventListener: (t: string, fn: () => void) => {
    (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(fn);
  },
  removeEventListener: (t: string, fn: () => void) => listeners.get(t)?.delete(fn),
};
const fireVisibility = (state: "visible" | "hidden") => {
  (globalThis as { document: { visibilityState: string } }).document.visibilityState = state;
  for (const fn of listeners.get("visibilitychange") ?? []) fn();
};

class FakeBackend implements WakeAudioBackend {
  readonly supported = true;
  onFrame: ((f: Float32Array) => void) | null = null;
  started = 0;
  stopped = 0;
  recovers = 0;
  /** what recover() returns; and whether it re-enables frame delivery */
  recoverResult = true;
  suspended = false;
  async start(cb: (f: Float32Array) => void) {
    this.onFrame = cb;
    this.started += 1;
    this.suspended = false;
  }
  stop() {
    this.stopped += 1;
    this.onFrame = null;
  }
  async recover() {
    this.recovers += 1;
    if (this.recoverResult) this.suspended = false;
    return this.recoverResult;
  }
  push(kind: "silence" | "speech" | "wake") {
    if (this.suspended || !this.onFrame) return; // a suspended context delivers nothing
    const f = new Float32Array(FRAME);
    if (kind !== "silence") for (let i = 0; i < FRAME; i += 1) f[i] = Math.sin(i / 4) * 0.3;
    (f as Float32Array & { __wake?: boolean }).__wake = kind === "wake";
    this.onFrame(f);
  }
}

class FakeRunner implements WakeRunnerLike {
  ready = false;
  inits = 0;
  resets = 0;
  disposes = 0;
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
    return (frame as Float32Array & { __wake?: boolean }).__wake ? 0.97 : 0.01;
  }
}

/** Fake TTS so speak() → afterSpeak() (post-TTS recovery) is exercised. */
function fakeTts() {
  let calls = 0;
  const speak = (_text: string, options: AyasSpeakOptions) => {
    calls += 1;
    queueMicrotask(() => {
      options.onStart();
      queueMicrotask(() => options.onEnd());
    });
    return { cancel: () => {} };
  };
  return {
    get calls() {
      return calls;
    },
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
  let ended = 0;
  const handlers: AyasListenHandlers = {
    onFinalTranscript: (t) => finals.push(t),
    onError: (c) => errors.push(c),
    onEnd: () => {
      ended += 1;
    },
  };
  return { handlers, finals, errors, get ended() { return ended; } };
}

const FAST = { rearmCooldownMs: 0, startRetryBackoffMs: 1, threshold: 0.5 } as const;

/** One full turn: wake → command → STT → onEnd, then the engine's re-arm. */
async function turn(a: WakeWordVoiceAdapter, backend: FakeBackend, h: AyasListenHandlers) {
  backend.push("wake");
  await settle();
  for (let i = 0; i < 12; i += 1) backend.push("speech");
  for (let i = 0; i < 14; i += 1) backend.push("silence");
  await settle();
  a.startListening("tr-TR", h); // engine re-arms after speaking the reply
  await settle();
}

async function run() {
  await scenario("WAV encoder — 44-byte header, 16 kHz mono s16", () => {
    const wav = encodeWav16kMono(new Float32Array(16000));
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
    const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    assert.equal(dv.getUint32(24, true), 16000);
    assert.equal(wav.length, 44 + 16000 * 2);
  });

  await scenario("recognitionMode() is 'wake-engine'; STT reported local", () => {
    const a = new WakeWordVoiceAdapter({ audioBackend: new FakeBackend(), runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x" });
    assert.equal(a.recognitionMode(), "wake-engine");
    assert.equal(a.detectCapability().sttCloudBacked, false);
    a.dispose();
  });

  await scenario("TEST A — first wake → response → SECOND wake", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "kaç proje var", ...FAST });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    assert.equal(backend.started, 1);
    await turn(a, backend, c.handlers);
    backend.push("wake");
    await settle();
    assert.deepEqual(c.finals, ["AYAS", "kaç proje var", "AYAS"]);
    a.dispose();
  });

  await scenario("TEST B/C — 50 consecutive cycles; mic acquired ONCE, no leak", async () => {
    const backend = new FakeBackend();
    const runner = new FakeRunner();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner, tts: fakeTts(), transcribe: async () => "x", ...FAST });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    for (let i = 0; i < 50; i += 1) await turn(a, backend, c.handlers);
    const wakes = c.finals.filter((t) => t === "AYAS").length;
    assert.equal(wakes, 50, `all 50 wakes fired (got ${wakes})`);
    assert.equal(backend.started, 1, "mic acquired exactly once across 50 turns");
    assert.equal(backend.stopped, 0, "mic never stopped between turns");
    assert.equal(runner.inits, 1, "ONNX runner initialised once");
    assert.equal(runner.disposes, 0);
    assert.equal(a.getStatus().cyclesCompleted, 50);
    assert.equal(a.getStatus().recoveryCount, 0, "no rebuilds needed in a healthy session");
    a.dispose();
  });

  await scenario("TEST D — TTS completion resumes a suspended AudioContext, then re-arm works", async () => {
    const backend = new FakeBackend();
    const tts = fakeTts();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner: new FakeRunner(), tts, transcribe: async () => "x", ...FAST });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();

    // wake + command
    backend.push("wake");
    await settle();
    for (let i = 0; i < 12; i += 1) backend.push("speech");
    for (let i = 0; i < 14; i += 1) backend.push("silence");
    await settle();

    // iOS suspends the capture context while speechSynthesis plays
    backend.suspended = true;
    // AYAS speaks the reply; the engine's afterOutput re-arms in onEnd
    a.speak("cevap", {
      voiceName: null, lang: "tr-TR", pitch: 1, rate: 1, volume: 1,
      onStart: () => {}, onEnd: () => a.startListening("tr-TR", c.handlers), onError: () => {},
    });
    await settle(20);

    assert.ok(backend.recovers >= 1, "recover() was called after TTS / on re-arm");
    assert.equal(backend.suspended, false, "context resumed");
    assert.equal(backend.started, 1, "no rebuild — a resume was enough");
    backend.push("wake");
    await settle();
    assert.equal(c.finals.filter((t) => t === "AYAS").length, 2, "SECOND wake heard after TTS");
    a.dispose();
  });

  await scenario("TEST E — AudioContext suspended, recover() succeeds → no rebuild", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x", ...FAST });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    backend.suspended = true;
    backend.recoverResult = true;
    fireVisibility("hidden");
    fireVisibility("visible");
    await settle(15);
    assert.equal(backend.recovers, 1);
    assert.equal(backend.started, 1, "resume, not rebuild");
    assert.equal(backend.suspended, false);
    a.dispose();
  });

  await scenario("TEST F — mic track ended → recover() fails → ONE bounded rebuild", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x", ...FAST });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    backend.recoverResult = false; // track ended
    fireVisibility("hidden");
    fireVisibility("visible");
    await settle(15);
    assert.equal(backend.started, 2, "mic rebuilt exactly once");
    assert.equal(a.getStatus().recoveryCount, 1);
    backend.recoverResult = true;
    backend.push("wake");
    await settle();
    assert.deepEqual(c.finals, ["AYAS"], "listening again after the rebuild");
    a.dispose();
  });

  await scenario("TEST — frame-flow WATCHDOG rebuilds a silent stalled pipeline", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x",
      ...FAST, watchdogIntervalMs: 15, frameStallMs: 30,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    // context silently dies — recover() would lie ("running") but no frames come
    backend.suspended = true;
    backend.recoverResult = true;
    await wait(120); // several watchdog ticks past the stall threshold
    // resume claimed health but frames never returned → watchdog forces a rebuild
    assert.ok(backend.started >= 2, `pipeline rebuilt by the watchdog (started=${backend.started})`);
    assert.ok(a.getStatus().recoveryCount >= 1);
    backend.suspended = false;
    backend.push("wake");
    await settle();
    assert.deepEqual(c.finals, ["AYAS"]);
    a.dispose();
  });

  await scenario("TEST G — transient getUserMedia failure → bounded retry (3) then fatal", async () => {
    let starts = 0;
    const flaky: WakeAudioBackend = {
      supported: true,
      async start() { starts += 1; throw new Error("AbortError transient"); },
      stop() {},
    };
    let unavailable = 0;
    const a = new WakeWordVoiceAdapter({
      audioBackend: flaky, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x",
      onUnavailable: () => { unavailable += 1; }, startRetryBackoffMs: 1,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await wait(30);
    assert.equal(starts, 3);
    assert.equal(unavailable, 1);
    assert.equal(a.getStatus().mic, "fatal");
    const before = starts;
    a.startListening("tr-TR", c.handlers);
    a.startListening("tr-TR", c.handlers);
    await settle();
    assert.equal(starts, before, "no further start() after fatal — no storm");
    a.dispose();
  });

  await scenario("TEST — permission denied → fatal immediately (no retry)", async () => {
    let starts = 0;
    const denying: WakeAudioBackend = {
      supported: true,
      async start() { starts += 1; const e = new Error("Permission denied"); e.name = "NotAllowedError"; throw e; },
      stop() {},
    };
    const reasons: string[] = [];
    const a = new WakeWordVoiceAdapter({ audioBackend: denying, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x", onUnavailable: (r) => reasons.push(r), startRetryBackoffMs: 1 });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle(15);
    assert.equal(starts, 1);
    assert.deepEqual(reasons, ["not-allowed"]);
    a.dispose();
  });

  await scenario("TEST H — STT failure → wake stays alive, next turn works", async () => {
    const backend = new FakeBackend();
    let fail = true;
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => { if (fail) throw new Error("stt-500"); return "ok"; }, ...FAST });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    await turn(a, backend, c.handlers);
    assert.ok(c.errors.length >= 1);
    assert.equal(backend.stopped, 0, "STT failure does not tear down the mic");
    fail = false;
    await turn(a, backend, c.handlers);
    assert.ok(c.finals.includes("ok"));
    a.dispose();
  });

  await scenario("TEST I — blank STT → onError('no-speech'), wake stays alive", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "", ...FAST });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    await turn(a, backend, c.handlers);
    assert.ok(c.errors.includes("no-speech"));
    backend.push("wake");
    await settle();
    assert.equal(c.finals.filter((t) => t === "AYAS").length, 2);
    assert.equal(backend.stopped, 0);
    a.dispose();
  });

  await scenario("TEST J — TTS error → afterSpeak still recovers, wake stays alive", async () => {
    const backend = new FakeBackend();
    const badTts = fakeTts();
    (badTts as { speak: unknown }).speak = (_t: string, o: AyasSpeakOptions) => {
      queueMicrotask(() => o.onError());
      return { cancel: () => {} };
    };
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner: new FakeRunner(), tts: badTts, transcribe: async () => "x", ...FAST });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    backend.push("wake");
    await settle();
    for (let i = 0; i < 12; i += 1) backend.push("speech");
    for (let i = 0; i < 14; i += 1) backend.push("silence");
    await settle();
    backend.suspended = true;
    a.speak("cevap", { voiceName: null, lang: "tr-TR", pitch: 1, rate: 1, volume: 1, onStart: () => {}, onEnd: () => {}, onError: () => a.startListening("tr-TR", c.handlers) });
    await settle(15);
    assert.equal(backend.suspended, false, "recovered even though TTS errored");
    backend.push("wake");
    await settle();
    assert.equal(c.finals.filter((t) => t === "AYAS").length, 2);
    a.dispose();
  });

  await scenario("TEST K — visibility hidden → visible restores wake", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x", ...FAST });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    backend.suspended = true;
    fireVisibility("hidden");
    await settle();
    fireVisibility("visible");
    await settle(15);
    backend.push("wake");
    await settle();
    assert.deepEqual(c.finals, ["AYAS"]);
    a.dispose();
  });

  await scenario("TEST L — rapid start/stop churn → no duplicate resources", async () => {
    const backend = new FakeBackend();
    const runner = new FakeRunner();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner, tts: fakeTts(), transcribe: async () => "x", ...FAST });
    const c = collectHandlers();
    for (let i = 0; i < 30; i += 1) {
      const h = a.startListening("tr-TR", c.handlers);
      h.stop();
    }
    await settle(20);
    assert.equal(backend.started, 1, "still one mic despite 30 start/stop calls");
    assert.equal(runner.inits, 1);
    a.dispose();
  });

  await scenario("TEST M — two recoveries triggered at once → only one runs", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x", ...FAST });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    backend.recoverResult = false; // both attempts want a rebuild
    fireVisibility("visible");
    fireVisibility("visible");
    (a as unknown as { resumeOrRebuild(r: string): Promise<void> }).resumeOrRebuild("stall");
    await settle(20);
    assert.equal(backend.started, 2, "exactly one rebuild despite 3 concurrent triggers");
    assert.equal(a.getStatus().recoveryCount, 1);
    a.dispose();
  });

  await scenario("TEST N — dispose() releases mic + runner + watchdog; no leak", async () => {
    const backend = new FakeBackend();
    const runner = new FakeRunner();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner, tts: fakeTts(), transcribe: async () => "x", ...FAST, watchdogIntervalMs: 50, frameStallMs: 100 });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle(6);
    a.dispose();
    assert.equal(backend.stopped, 1, "mic stopped exactly once");
    assert.equal(runner.disposes, 1, "ONNX runner released");
    assert.equal(a.getStatus().phase, "disposed");
    const startsAfter = backend.started;
    backend.suspended = true;
    await wait(260); // ~5 watchdog intervals — it must be dead
    assert.equal(backend.started, startsAfter, "no watchdog activity after dispose");
    assert.equal(backend.recovers, 0, "no recovery after dispose");
    a.startListening("tr-TR", c.handlers);
    await settle();
    assert.equal(backend.started, startsAfter, "a disposed adapter does not restart");
  });

  await scenario("TEST O — remount (new instance) → clean fresh session", async () => {
    const b1 = new FakeBackend();
    const a1 = new WakeWordVoiceAdapter({ audioBackend: b1, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x", ...FAST });
    const c1 = collectHandlers();
    a1.startListening("tr-TR", c1.handlers);
    await settle();
    await turn(a1, b1, c1.handlers);
    a1.dispose();

    const b2 = new FakeBackend();
    const a2 = new WakeWordVoiceAdapter({ audioBackend: b2, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x", ...FAST });
    const c2 = collectHandlers();
    a2.startListening("tr-TR", c2.handlers);
    await settle();
    b2.push("wake");
    await settle();
    assert.deepEqual(c2.finals, ["AYAS"]);
    assert.equal(b2.started, 1);
    a2.dispose();
  });

  await scenario("TEST P — long session (20 turns) with an interruption every 5th turn", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x", ...FAST });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    let expectedRebuilds = 0;
    for (let i = 0; i < 20; i += 1) {
      if (i > 0 && i % 5 === 0) {
        backend.recoverResult = false; // track ended
        fireVisibility("visible");
        await settle(15);
        backend.recoverResult = true;
        expectedRebuilds += 1;
      }
      await turn(a, backend, c.handlers);
    }
    assert.equal(c.finals.filter((t) => t === "AYAS").length, 20, "all 20 wakes fired");
    assert.equal(a.getStatus().recoveryCount, expectedRebuilds, "exactly the injected number of rebuilds");
    assert.equal(backend.started, 1 + expectedRebuilds, "mic acquisitions = 1 + rebuilds (not turns)");
    a.dispose();
  });

  await scenario("onStatus — emits 'recovering' during a rebuild, clears it after; carries counters", async () => {
    const backend = new FakeBackend();
    const seen: string[] = [];
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x",
      ...FAST, onStatus: (s) => seen.push(s.mic),
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    backend.recoverResult = false; // force a rebuild
    fireVisibility("visible");
    await settle(15);
    assert.ok(seen.includes("recovering"), "UI is told the pipeline is recovering");
    assert.equal(seen[seen.length - 1], "on", "and that it recovered");
    const st = a.getStatus();
    assert.equal(st.recoveryCount, 1);
    assert.ok(st.frameAgeMs >= 0);
    a.dispose();
  });

  await scenario("TEST — slow inference: frames are DROPPED single-flight, never queued (iOS memory guard)", async () => {
    const backend = new FakeBackend();
    // A runner whose accept() parks until released — models a phone that can't
    // keep up with the 80 ms frame rate.
    let release: () => void = () => {};
    let concurrent = 0;
    let maxConcurrent = 0;
    let accepts = 0;
    class SlowRunner implements WakeRunnerLike {
      ready = false;
      async init() {
        this.ready = true;
      }
      reset() {}
      dispose() {}
      async accept() {
        accepts += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise<void>((r) => {
          release = r;
        });
        concurrent -= 1;
        return 0.01;
      }
    }
    const slowRunner = new SlowRunner();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend,
      runner: slowRunner,
      tts: fakeTts(),
      transcribe: async () => "x",
      ...FAST,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    // Fire 40 frames while the first inference is parked.
    for (let i = 0; i < 40; i += 1) backend.push("speech");
    await settle();
    assert.equal(maxConcurrent, 1, "the adapter never runs two inferences at once");
    assert.ok(accepts <= 2, `only the in-flight frame reached the runner, got ${accepts}`);
    const st = a.getStatus();
    assert.ok(st.droppedFrames >= 35, `dropped frames are counted, got ${st.droppedFrames}`);
    // Release the parked inference — the pipeline keeps working.
    release();
    await settle();
    backend.push("wake");
    await settle();
    release();
    await settle();
    a.dispose();
    assert.equal(backend.started, 1, "no extra mic acquisition from the back-pressure");
  });

  await scenario("STATIC — wake capture uses unprocessed audio; mic stopped only on dispose", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src/components/brain/voice/wakeWordVoiceAdapter.ts"), "utf8");
    assert.match(src, /noiseSuppression:\s*false/);
    assert.match(src, /autoGainControl:\s*false/);
    assert.match(src, /echoCancellation:\s*true/);
    const finishBody = src.slice(src.indexOf("private async finishCommand"), src.indexOf("dispose(): void"));
    assert.ok(!/this\.audio\.stop\(\)/.test(finishBody), "finishCommand must NOT stop the mic");
    assert.match(src, /unref\?\.\(\)/, "the watchdog timer is unref'd so it never wedges a process");
  });

  console.log(`AYAS wake adapter smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-wake-adapter", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
