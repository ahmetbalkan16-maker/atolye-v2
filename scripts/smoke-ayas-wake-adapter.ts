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
  MediaStreamWorkletBackend,
  WakeScoreDetector,
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
/**
 * Fast drain — `setImmediate` has no 15 ms Windows timer granularity, so the
 * conversation-timeout scenarios can use small `conversationIdleMs` values
 * without the settle noise straddling the deadline.
 */
const drain = async (n = 50) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r));
};

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
  disposed = 0;
  recovers = 0;
  /** what recover() returns; and whether it re-enables frame delivery */
  recoverResult = true;
  suspended = false;
  /** fail the next N `start()` calls with `startError`, then succeed */
  failStartsRemaining = 0;
  startError: Error = Object.assign(new Error("AbortError transient"), { name: "AbortError" });
  async start(cb: (f: Float32Array) => void) {
    if (this.failStartsRemaining > 0) {
      this.failStartsRemaining -= 1;
      throw this.startError;
    }
    this.onFrame = cb;
    this.started += 1;
    this.suspended = false;
  }
  stop() {
    this.stopped += 1;
    this.onFrame = null;
  }
  dispose() {
    this.disposed += 1;
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
  /** Push one frame at an explicit amplitude (RMS ≈ amp/√2). */
  pushAmp(amp: number, wake = false) {
    if (this.suspended || !this.onFrame) return;
    const f = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i += 1) f[i] = Math.sin(i / 4) * amp;
    (f as Float32Array & { __wake?: boolean }).__wake = wake;
    this.onFrame(f);
  }
}

class FakeRunner implements WakeRunnerLike {
  ready = false;
  inits = 0;
  resets = 0;
  disposes = 0;
  private nAccept = 0;
  private nInfer = 0;
  private concurrent = 0;
  private maxConcurrent = 0;
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
    this.concurrent += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
    this.nAccept += 1;
    this.nInfer += 1;
    this.concurrent -= 1;
    return (frame as Float32Array & { __wake?: boolean }).__wake ? 0.97 : 0.01;
  }
  get stats() {
    return {
      dropped: 0,
      inferences: this.nInfer,
      lastError: null,
      pendingSamples: 0,
      maxPendingSamples: 0,
      catchupBatchesTotal: 0,
      maxCatchupInOneAccept: 1,
      maxConcurrentInference: this.maxConcurrent,
      frames: this.nAccept,
    };
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

/**
 * One full INDEPENDENT turn: wake → command → STT → onEnd → session lapses →
 * the engine's re-arm. `endConversation()` models the ≥15 s gap (or an explicit
 * stop) between two unrelated turns — so this helper still exercises a fresh
 * wake per call, which is what the lifecycle/resource scenarios assert.
 * `sessionTurn()` covers back-to-back conversation follow-ups.
 */
async function turn(a: WakeWordVoiceAdapter, backend: FakeBackend, h: AyasListenHandlers) {
  backend.push("wake");
  await settle();
  // ~1.2 s of speech, then trailing silence past the ~1 s end-of-speech window.
  for (let i = 0; i < 15; i += 1) backend.push("speech");
  for (let i = 0; i < 16; i += 1) backend.push("silence");
  await settle();
  a.endConversation(); // the conversation session lapses between separate turns
  a.startListening("tr-TR", h); // engine re-arms after speaking the reply
  await settle();
}

/**
 * A conversation follow-up: `wake: true` on the first turn only, then commands
 * with NO wake word while the session is open.
 */
async function sessionTurn(
  a: WakeWordVoiceAdapter,
  backend: FakeBackend,
  h: AyasListenHandlers,
  opts: { wake: boolean },
) {
  if (opts.wake) backend.push("wake");
  await drain();
  for (let i = 0; i < 15; i += 1) backend.push("speech");
  for (let i = 0; i < 16; i += 1) backend.push("silence");
  await drain();
  a.startListening("tr-TR", h); // engine re-arms after the reply — session stays open
  await drain();
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

  await scenario("iOS AudioContext — startListening primes the backend SYNCHRONOUSLY (in the tap gesture, before any await)", () => {
    let primes = 0;
    let primedBeforeStart = false;
    let started = false;
    const backend: WakeAudioBackend = {
      supported: true,
      prime() { primes += 1; if (!started) primedBeforeStart = true; },
      async start(cb: (f: Float32Array) => void) { started = true; void cb; },
      stop() {},
    };
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x", ...FAST });
    a.startListening("tr-TR", collectHandlers().handlers);
    // synchronous check — prime() must have run in startListening's own call frame,
    // NOT deferred to ensureAudio (which runs after `await runner.init()`).
    assert.equal(primes, 1, "prime() called exactly once, synchronously");
    assert.equal(primedBeforeStart, true, "primed while the gesture is still hot — before start()");
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
    // The conversation session is still open → a follow-up needs NO wake word.
    for (let i = 0; i < 14; i += 1) backend.push("speech");
    for (let i = 0; i < 16; i += 1) backend.push("silence");
    await settle();
    assert.equal(
      c.finals.filter((t) => t !== "AYAS").length,
      2,
      "SECOND command captured after TTS (in-session, no wake word)",
    );
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

  await scenario("TEST G — transient first-start failure (non-permission) → PAUSED not fatal; a tap recovers it", async () => {
    // The iOS root cause: the AudioContext is created off-gesture (after the
    // ONNX/WASM load) and stays `suspended` → start() throws
    // `audiocontext-not-running`. That must NOT go fatal (a silent fallback to a
    // browser adapter that on an iOS PWA hears nothing) — it pauses with a
    // "tap to resume", and a tap (fresh activation) recovers it.
    let starts = 0;
    let primes = 0;
    let failsLeft = 3;
    const flaky: WakeAudioBackend = {
      supported: true,
      prime() { primes += 1; },
      async start(cb: (f: Float32Array) => void) {
        starts += 1;
        if (failsLeft > 0) { failsLeft -= 1; throw new Error("audiocontext-not-running"); }
        void cb;
      },
      stop() {},
    };
    let unavailable = 0;
    const a = new WakeWordVoiceAdapter({
      audioBackend: flaky, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x",
      onUnavailable: () => { unavailable += 1; }, startRetryBackoffMs: 1, pausedRetryMs: 10_000,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await wait(30);
    assert.equal(starts, 3, "MAX_START_ATTEMPTS, then pause — not an endless storm");
    assert.equal(unavailable, 0, "NOT fatal / no fallback for a transient non-permission failure");
    assert.equal(a.getStatus().mic, "paused");
    assert.equal(primes >= 1, true, "startListening primed the AudioContext in-gesture");

    // the tap: backend now succeeds, retryNow() drives a fresh start
    a.retryNow();
    await settle(15);
    assert.equal(a.getStatus().mic, "on", "a tap recovered the wake engine");
    a.dispose();
  });

  await scenario("TEST G2 — a never-healthy engine still paused after the safety cap → falls back", async () => {
    fireVisibility("visible");
    let unavailable = 0;
    const dead: WakeAudioBackend = {
      supported: true,
      async start() { throw new Error("audiocontext-not-running"); },
      stop() {},
    };
    const a = new WakeWordVoiceAdapter({
      audioBackend: dead, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x",
      onUnavailable: () => { unavailable += 1; }, startRetryBackoffMs: 1, pausedRetryMs: 1,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    // let the auto-retries run past MAX_UNPAUSE_BEFORE_FALLBACK (6)
    for (let i = 0; i < 40 && a.getStatus().mic !== "fatal"; i += 1) await wait(25);
    assert.equal(a.getStatus().mic, "fatal", "a genuinely incapable device eventually falls back");
    assert.equal(unavailable, 1);
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
    // The session survived the TTS error → a follow-up command needs no wake word.
    for (let i = 0; i < 14; i += 1) backend.push("speech");
    for (let i = 0; i < 16; i += 1) backend.push("silence");
    await settle();
    assert.equal(c.finals.filter((t) => t !== "AYAS").length, 2, "next command still captured after the TTS error");
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
    assert.equal(backend.disposed, 1, "mic fully torn down exactly once");
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

  await scenario("TEST — slow inference: adapter forwards every frame; runner single-flights + catches up", async () => {
    const backend = new FakeBackend();
    // A runner that models the REAL one: single-flight (buffers internally) + a
    // slow first inference. `accept()` returns immediately while an inference
    // runs; the running call catches up on the buffered frames.
    let release: () => void = () => {};
    let concurrent = 0;
    let maxConcurrent = 0;
    let forwarded = 0;
    let processed = 0;
    class RealisticRunner implements WakeRunnerLike {
      ready = false;
      private inFlight = false;
      get stats() {
        return { dropped: Math.max(0, forwarded - processed - 6), inferences: processed, lastError: null };
      }
      async init() {
        this.ready = true;
      }
      reset() {
        this.inFlight = false;
      }
      dispose() {}
      async accept() {
        forwarded += 1;
        if (this.inFlight) return null; // buffered internally — no overlap
        this.inFlight = true;
        try {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise<void>((r) => {
            release = r;
          });
          processed += 1;
          concurrent -= 1;
          return 0.01;
        } finally {
          this.inFlight = false;
        }
      }
    }
    const runner = new RealisticRunner();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend,
      runner,
      tts: fakeTts(),
      transcribe: async () => "x",
      ...FAST,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    for (let i = 0; i < 40; i += 1) backend.push("speech");
    await settle();
    assert.equal(maxConcurrent, 1, "the runner never runs two inferences at once");
    assert.equal(forwarded, 40, "the adapter forwards EVERY frame — the runner keeps the audio contiguous");
    release();
    await settle();
    release();
    await settle();
    a.dispose();
    assert.equal(backend.started, 1, "no extra mic acquisition from the back-pressure");
  });

  await scenario("TEST — re-acquire fails AFTER a healthy session → PAUSED not fatal; self-heals", async () => {
    const backend = new FakeBackend();
    const seen: string[] = [];
    let unavailable = 0;
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x",
      ...FAST, pausedRetryMs: 120, onUnavailable: () => { unavailable += 1; },
      onStatus: (s) => seen.push(s.mic),
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    await turn(a, backend, c.handlers); // one good cycle → everHealthy
    assert.equal(a.getStatus().cyclesCompleted, 1);

    // Now the mic goes away and every re-acquire fails.
    backend.recoverResult = false;
    backend.failStartsRemaining = 99;
    fireVisibility("visible"); // triggers resumeOrRebuild → ensureAudio → fails
    await settle(30);
    const st = a.getStatus();
    assert.equal(st.mic, "paused", `paused, not fatal (got ${st.mic})`);
    assert.equal(unavailable, 0, "NEVER falls back to the browser adapter mid-session");
    assert.ok(seen.includes("paused"));
    assert.ok(!seen.includes("fatal"));
    const startsWhilePaused = backend.started;

    // The backend heals — a scheduled auto-retry brings it back with no tap.
    backend.recoverResult = true;
    backend.failStartsRemaining = 0;
    await wait(400); // a couple of 120 ms backoffs
    await settle(10);
    const st2 = a.getStatus();
    assert.equal(st2.mic, "on", `recovered on its own (got ${st2.mic})`);
    assert.equal(st2.phase, "wake");
    assert.equal(backend.started, startsWhilePaused + 1, "one fresh acquire on recovery, not per retry");
    a.dispose();
  });

  await scenario("TEST — retryNow() from paused re-acquires immediately (a mic tap)", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x",
      ...FAST, pausedRetryMs: 60_000, // long — so only an explicit retry can un-pause
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    await turn(a, backend, c.handlers);

    backend.recoverResult = false;
    backend.failStartsRemaining = 99;
    fireVisibility("visible");
    await settle(20);
    assert.equal(a.getStatus().mic, "paused");

    backend.recoverResult = true;
    backend.failStartsRemaining = 0;
    assert.equal(a.isPaused, true);
    a.retryNow(); // the tap
    await settle(15);
    assert.equal(a.getStatus().mic, "on", "the tap recovered it without waiting for the backoff");
    a.dispose();
  });

  await scenario("TEST — genuine FIRST-start permission denial (0 cycles) → still fatal + fallback", async () => {
    let starts = 0;
    const denying: WakeAudioBackend = {
      supported: true,
      async start() { starts += 1; const e = new Error("Permission denied"); e.name = "NotAllowedError"; throw e; },
      stop() {},
    };
    const reasons: string[] = [];
    const a = new WakeWordVoiceAdapter({
      audioBackend: denying, runner: new FakeRunner(), tts: fakeTts(), transcribe: async () => "x",
      onUnavailable: (r) => reasons.push(r), startRetryBackoffMs: 1,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle(15);
    assert.equal(starts, 1, "a real first-time denial is not retried");
    assert.deepEqual(reasons, ["not-allowed"], "the host falls back to the browser adapter");
    assert.equal(a.getStatus().mic, "fatal");
    a.dispose();
  });

  const LONG_RUN_TURNS = Math.max(100, Number(process.env.WAKE_ADAPTER_TURNS ?? "100") | 0);
  await scenario(`TEST E${LONG_RUN_TURNS} — ${LONG_RUN_TURNS} consecutive turns; mic acquired ONCE, 0 fatal, 0 paused, 0 leak`, async () => {
    const N = LONG_RUN_TURNS;
    const backend = new FakeBackend();
    const runner = new FakeRunner();
    // Push the watchdog out past the run so its periodic emit() doesn't dominate
    // the wall-clock — this scenario is about turn-loop integrity, not the stall net.
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner, tts: fakeTts(), transcribe: async () => "x",
      ...FAST, watchdogIntervalMs: 3_600_000,
    });
    const c = collectHandlers();
    // Leaner settle for the hot loop — the FAST config has 0 cooldown / 1 ms backoff.
    const fastTurn = async () => {
      backend.push("wake");
      await settle(4);
      for (let i = 0; i < 15; i += 1) backend.push("speech");
      for (let i = 0; i < 16; i += 1) backend.push("silence");
      await settle(4);
      a.endConversation(); // independent turns — a fresh wake each time
      a.startListening("tr-TR", c.handlers);
      await settle(4);
    };
    a.startListening("tr-TR", c.handlers);
    await settle();
    for (let i = 0; i < N; i += 1) {
      // Every 10th turn, iOS "suspends" the context between turns — the re-arm's
      // resumeOrRebuild must resume it IN PLACE (no rebuild) before the next wake.
      if (i % 10 === 9) {
        backend.suspended = true;
        a.startListening("tr-TR", c.handlers); // re-arm → recover() resumes the ctx
        await settle(6);
        assert.equal(backend.suspended, false, `turn ${i}: context resumed in place`);
      }
      await fastTurn();
    }
    const wakes = c.finals.filter((t) => t === "AYAS").length;
    assert.equal(wakes, N, `all ${N} wakes fired (got ${wakes})`);
    const st = a.getStatus();
    assert.equal(st.cyclesCompleted, N);
    assert.equal(st.mic, "on", `still healthy after ${N} turns`);
    assert.notEqual(st.phase, "fatal");
    assert.notEqual(st.phase, "paused");
    assert.equal(backend.started, 1, `mic acquired exactly once across ${N} turns`);
    assert.equal(backend.disposed, 0);
    assert.equal(runner.inits, 1, "ONNX runner initialised once");
    assert.equal(runner.disposes, 0);
    assert.equal(st.recoveryCount, 0, "in-place resume — never a rebuild");
    // §16 — runner runtime cost stays bounded & single-flight over the whole run.
    assert.ok(st.runnerCost, "runnerCost surfaced");
    assert.equal(st.runnerCost?.maxConcurrentInference, 1, "§16: wake inference never overlaps");
    assert.equal(st.runnerCost?.pendingSamples, 0, "§16: queue drained");
    // §5 — the wake-score distribution is populated and sane.
    assert.ok(st.wakeScore.n >= N, `§5: a score observed per turn (${st.wakeScore.n})`);
    assert.equal(st.wakeScore.hits, N, `§5: ${N} wake confirmations for ${N} turns`);
    a.dispose();
    assert.equal(backend.disposed, 1, "dispose() (full teardown) called once, not stop()");
    assert.equal(runner.disposes, 1);
  });

  await scenario("BACKEND — MediaStreamWorkletBackend reuses the AudioContext + mic track across rebuilds", async () => {
    let ctxCreated = 0;
    let getUserMediaCalls = 0;
    let moduleAdds = 0;
    const track = { readyState: "live" as "live" | "ended", stop() { this.readyState = "ended"; } };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };

    class MockCtx {
      state: "suspended" | "running" | "closed" = "suspended";
      destination = {};
      audioWorklet = { addModule: async () => { moduleAdds += 1; } };
      constructor() { ctxCreated += 1; }
      async resume() { if (this.state !== "closed") this.state = "running"; }
      async close() { this.state = "closed"; }
      createMediaStreamSource() { return { connect() {} }; }
      createGain() { return { gain: { value: 0 }, connect() {} }; }
    }
    class MockWorkletNode { port = { onmessage: null as unknown, postMessage() {} }; connect() {} disconnect() {} }

    const g = globalThis as Record<string, unknown>;
    const prevNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const prev = { window: g.window, AudioWorkletNode: g.AudioWorkletNode };
    g.window = { AudioContext: MockCtx, isSecureContext: true };
    Object.defineProperty(globalThis, "navigator", {
      value: { mediaDevices: { getUserMedia: async () => { getUserMediaCalls += 1; return stream; } } },
      configurable: true,
      writable: true,
    });
    g.AudioWorkletNode = MockWorkletNode;

    try {
      const backend = new MediaStreamWorkletBackend();
      await backend.start(() => {});
      assert.equal(ctxCreated, 1);
      assert.equal(getUserMediaCalls, 1);
      assert.equal(moduleAdds, 1);

      // 10 between-turn rebuilds with the track still live → NOTHING re-acquired.
      for (let i = 0; i < 10; i += 1) {
        backend.stop();
        await backend.start(() => {});
      }
      assert.equal(ctxCreated, 1, "AudioContext reused (iOS caps a page at ~4)");
      assert.equal(getUserMediaCalls, 1, "live mic track reused — no non-gesture getUserMedia");
      assert.equal(moduleAdds, 1, "worklet module loaded once per context");

      // §17 — the numeric resource counters the Voice Lab surfaces match reality.
      const rs = backend.resourceStats;
      assert.equal(rs.audioContextsCreated, 1, "§17: exactly 1 AudioContext over 11 starts");
      assert.equal(rs.mediaStreamsAcquired, 1, "§17: exactly 1 getUserMedia over 11 starts");
      assert.equal(rs.graphRebuilds, 11, "§17: the graph itself is re-wired each start (cheap)");
      assert.equal(rs.audioContextState, "running");
      assert.equal(rs.micTrackState, "live");

      // The track ends (iOS took it for speechSynthesis) → recover() fails, and
      // the next start() re-getUserMedia but STILL reuses the context.
      track.readyState = "ended";
      assert.equal(await backend.recover(), false);
      backend.stop();
      await backend.start(() => {});
      assert.equal(getUserMediaCalls, 2, "one fresh acquire when the track genuinely ended");
      assert.equal(ctxCreated, 1, "context still reused");

      // Only a CLOSED context forces a new one.
      backend.dispose();
      assert.equal((backend.state()), "unknown");
      await backend.start(() => {});
      assert.equal(ctxCreated, 2);
    } finally {
      g.window = prev.window;
      g.AudioWorkletNode = prev.AudioWorkletNode;
      if (prevNav) Object.defineProperty(globalThis, "navigator", prevNav);
      else delete g.navigator;
    }
  });

  await scenario("VAD — a mid-sentence pause (< end-of-speech window) does NOT cut the user off", async () => {
    const backend = new FakeBackend();
    let sttWavLen = 0;
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend,
      runner: new FakeRunner(),
      tts: fakeTts(),
      transcribe: async (wav) => {
        sttWavLen = wav.byteLength;
        return "atölyede kaç proje var ve bunlardan kaçı bitti";
      },
      ...FAST,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    backend.push("wake");
    await settle();
    // "AYAS kaç proje var ve bunlardan" — 10 frames speech
    for (let i = 0; i < 10; i += 1) backend.pushAmp(0.3);
    // a 720 ms thinking pause (9 silent frames < the ~1 s window) — must NOT finalize
    for (let i = 0; i < 9; i += 1) backend.pushAmp(0);
    await settle();
    assert.equal(c.finals.filter((t) => t !== "AYAS").length, 0, "not cut off during the pause");
    // "...kaçı bitti" — more speech, then a real end-of-speech
    for (let i = 0; i < 6; i += 1) backend.pushAmp(0.3);
    for (let i = 0; i < 16; i += 1) backend.pushAmp(0);
    await settle();
    const cmd = c.finals.find((t) => t !== "AYAS");
    assert.ok(cmd && cmd.includes("bitti"), `the full utterance was captured, got ${JSON.stringify(c.finals)}`);
    // the pre-roll frames make the captured WAV longer than a bare capture
    assert.ok(sttWavLen > 44 + 16000 * 2 * 1.0, `pre-roll + full capture → a substantial clip (${sttWavLen} bytes)`);
    a.dispose();
  });

  await scenario("VAD — a 250 ms blip + long silence is NOT a command (min-speech gate)", async () => {
    const backend = new FakeBackend();
    let transcribed = false;
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend,
      runner: new FakeRunner(),
      tts: fakeTts(),
      transcribe: async () => {
        transcribed = true;
        return "x";
      },
      ...FAST,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    backend.push("wake");
    await settle();
    // a 160 ms blip (2 frames) — below COMMAND_MIN_SPEECH_MS
    backend.pushAmp(0.3);
    backend.pushAmp(0.3);
    // then a LOT of silence
    for (let i = 0; i < 40; i += 1) backend.pushAmp(0);
    await settle();
    // COMMAND_MAX_MS is the only escape — a blip must eventually flush, but not
    // as an early false command on the min-speech gate.
    assert.equal(c.finals.filter((t) => t !== "AYAS").length <= 1, true);
    void transcribed;
    a.dispose();
  });

  await scenario("VAD — adaptive silence floor: a noisy room does not read speech pauses as silence", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend,
      runner: new FakeRunner(),
      tts: fakeTts(),
      transcribe: async () => "komut",
      ...FAST,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    backend.push("wake");
    await settle();
    // room tone ~0.03 for the first frames → the floor calibrates up
    for (let i = 0; i < 3; i += 1) backend.pushAmp(0.03);
    // speech well above the floor
    for (let i = 0; i < 12; i += 1) backend.pushAmp(0.3);
    // "pause" that is still above the OLD fixed 0.012 threshold but below the
    // adaptive floor → correctly treated as end-of-speech room tone
    for (let i = 0; i < 16; i += 1) backend.pushAmp(0.03);
    await settle();
    assert.ok(c.finals.includes("komut"), `the command finalised on the adaptive floor, got ${JSON.stringify(c.finals)}`);
    a.dispose();
  });

  // ── "DİNLİYOR → HAZIR" regression: a natural pause between "AYAS" and the
  //    command must NOT finalise the capture on the pre-roll wake word alone. ──
  {
    /** wake, then `pauseFrames` of silence, then a spoken command, then EOS. */
    const wakePauseCommand = async (pauseFrames: number, commandFrames: number) => {
      const backend = new FakeBackend();
      let capturedMs = 0;
      const a = new WakeWordVoiceAdapter({
        audioBackend: backend,
        runner: new FakeRunner(),
        tts: fakeTts(),
        transcribe: async (wav) => {
          capturedMs = Math.round(((wav.byteLength - 44) / 2 / 16000) * 1000);
          // A clip with real command audio (beyond the wake word) transcribes it;
          // a lone-"AYAS" clip does not.
          return capturedMs >= 2200 ? "AYAS atölyede kaç proje var" : "AYAS";
        },
        ...FAST,
      });
      const c = collectHandlers();
      a.startListening("tr-TR", c.handlers);
      await settle();
      // pre-roll: room tone + a loud "AYAS" + the wake hit
      for (let i = 0; i < 8; i += 1) backend.pushAmp(0);
      for (let i = 0; i < 5; i += 1) backend.pushAmp(0.3);
      backend.push("wake");
      await settle();
      for (let i = 0; i < pauseFrames; i += 1) backend.pushAmp(0);
      await settle();
      const midPauseFinals = c.finals.filter((t) => t !== "AYAS").length;
      for (let i = 0; i < commandFrames; i += 1) backend.pushAmp(0.3);
      for (let i = 0; i < 16; i += 1) backend.pushAmp(0);
      await settle();
      const command = c.finals.find((t) => t.includes("proje"));
      a.dispose();
      return { command, midPauseFinals, capturedMs, finals: c.finals };
    };

    for (const pauseMs of [400, 800, 1200, 2000, 5000]) {
      await scenario(`VAD — "AYAS" + ${pauseMs} ms natural pause + command → the command IS captured`, async () => {
        const r = await wakePauseCommand(Math.round(pauseMs / 80), 16);
        assert.equal(r.midPauseFinals, 0, `nothing finalised during the ${pauseMs} ms pause`);
        assert.ok(
          r.command && r.command.includes("proje"),
          `the command survived the pause, got ${JSON.stringify(r.finals)} (clip ${r.capturedMs} ms)`,
        );
      });
    }

    await scenario('VAD — a bare "AYAS" (no command ever spoken) does not hang; clip is just the wake word', async () => {
      const r = await wakePauseCommand(110, 0); // ~8.8 s of silence, no command
      assert.equal(r.command, undefined, "no phantom command");
      // the finalised clip is the short pre-roll, not ~9 s of dead air
      assert.ok(r.capturedMs > 0 && r.capturedMs < 2000, `bare-AYAS clip stays short (${r.capturedMs} ms)`);
    });

    await scenario("VAD — a long command after a pause is not truncated (COMMAND_MAX from onset, not wake)", async () => {
      const r = await wakePauseCommand(25, 55); // 2 s pause + ~4.4 s command
      assert.ok(r.command && r.command.includes("proje"), `long command captured, got ${JSON.stringify(r.finals)}`);
    });
  }

  await scenario("WakeScoreDetector — near-hard spike + support fires; a lone/low spike does not; defaults (softWindow 7, nearHardPeak 0.67)", () => {
    // DEFAULT config (no args) — real-device recall tuning.
    const d = new WakeScoreDetector();
    // a real "AYAS" that spikes to 0.68 with one supporting 0.64 frame — used to
    // need "say it 3×" because it never sustained 3 soft (>=0.6) frames.
    assert.equal(d.observe(0.40), false);
    assert.equal(d.observe(0.64), false, "one frame >= nearHardSoft, no peak yet");
    assert.equal(d.observe(0.68), true, "near-hard peak (0.68) + a 0.64 support frame → hit");
    // a LONE near-hard spike with no support → NOT a hit
    assert.equal(d.observe(0.10), false, "window cleared after the fire");
    assert.equal(d.observe(0.12), false);
    assert.equal(d.observe(0.69), false, "a single near-hard frame with no >=0.63 support is not a hit");
    // low-but-not-silent chatter never fires
    const q = new WakeScoreDetector();
    for (let i = 0; i < 30; i += 1) assert.equal(q.observe(0.3 + (i % 5) * 0.05), false, "0.30-0.50 chatter never wakes");
    // the wider default window still needs 3 real soft frames for the soft path
    const s = new WakeScoreDetector();
    assert.equal(s.observe(0.61), false);
    assert.equal(s.observe(0.30), false);
    assert.equal(s.observe(0.61), false);
    assert.equal(s.observe(0.30), false);
    assert.equal(s.observe(0.61), true, "3 soft frames within the 7-frame window");
  });

  await scenario("WakeScoreDetector — hard hit, soft sustained hit, single spike rejected, stats", () => {
    const d = new WakeScoreDetector({ hard: 0.7, soft: 0.6, softVotes: 3, softWindow: 5 });
    // a single frame at/above hard → immediate hit
    assert.equal(d.observe(0.72), true);
    // lone spikes below hard → NOT a hit (needs 3 of the last 5 ≥ 0.6)
    assert.equal(d.observe(0.65), false);
    assert.equal(d.observe(0.10), false);
    assert.equal(d.observe(0.15), false);
    assert.equal(d.observe(0.66), false, "only 2 of the last 5 above soft");
    // a third moderate frame within the window → hit (real voice that peaks ~0.66)
    assert.equal(d.observe(0.61), true, "sustained moderate energy is a real 'AYAS'");
    // window resets after a fire
    assert.equal(d.observe(0.61), false);
    assert.equal(d.observe(0.61), false);
    assert.equal(d.observe(0.61), true, "a fresh sustained run fires again");
    const s = d.stats;
    assert.equal(s.hits, 3);
    assert.ok(s.n >= 9 && s.max >= 0.72 && s.mean > 0 && s.min <= 0.1);
  });

  await scenario("adapter — a real 'AYAS' that peaks at 0.64 (under 0.70) is still detected", async () => {
    const backend = new FakeBackend();
    // a runner that scores 0.64 for a wake frame — under the hard threshold
    class SoftRunner implements WakeRunnerLike {
      ready = false;
      get stats() { return { dropped: 0, inferences: 0, lastError: null }; }
      async init() { this.ready = true; }
      reset() {}
      dispose() {}
      async accept(frame: Float32Array) {
        return (frame as Float32Array & { __wake?: boolean }).__wake ? 0.64 : 0.02;
      }
    }
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new SoftRunner(), tts: fakeTts(), transcribe: async () => "kaç proje var",
      ...FAST, threshold: 0.7, wakeDetect: { soft: 0.6, softVotes: 3, softWindow: 5 },
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    // three sustained 0.64 wake frames → soft-tier hit
    backend.push("wake"); backend.push("wake"); backend.push("wake");
    await settle();
    assert.ok(c.finals.includes("AYAS"), `soft-tier detected the real 'AYAS', got ${JSON.stringify(c.finals)}`);
    assert.ok(a.getStatus().wakeScore.max >= 0.64);
    a.dispose();
  });

  /* ─────────────────── Conversation Session Mode ─────────────────── */

  await scenario("CONVERSATION — wake once, then 2 follow-up commands with NO wake word", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(),
      transcribe: async () => "kaç proje var", ...FAST,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    assert.equal(a.getStatus().conversationActive, false, "no session before the wake word");

    await sessionTurn(a, backend, c.handlers, { wake: true }); // "AYAS" + command
    assert.equal(a.getStatus().conversationActive, true, "the wake opened a conversation session");
    await sessionTurn(a, backend, c.handlers, { wake: false }); // command only
    await sessionTurn(a, backend, c.handlers, { wake: false }); // command only

    assert.equal(c.finals.filter((t) => t === "AYAS").length, 1, "the wake word was spoken exactly once");
    const commands = c.finals.filter((t) => t !== "AYAS");
    assert.equal(commands.length, 3, "all three commands were dispatched");
    assert.ok(
      commands.slice(1).every((t) => t.startsWith("AYAS ")),
      `in-session commands carry the synthetic wake prefix for the engine, got ${JSON.stringify(commands)}`,
    );
    assert.equal(backend.started, 1, "the mic was acquired once for the whole session");
    assert.equal(a.getStatus().cyclesCompleted, 3);
    a.dispose();
  });

  await scenario("CONVERSATION — 15 s (here 300 ms) of silence closes the session; next command needs the wake word", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(),
      transcribe: async () => "son değişiklik neydi", ...FAST, conversationIdleMs: 300,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await drain();
    await sessionTurn(a, backend, c.handlers, { wake: true });
    assert.equal(a.getStatus().conversationActive, true);

    await wait(700); // stay silent well past the idle timeout
    assert.equal(a.getStatus().conversationActive, false, "the idle timeout closed the session");
    assert.equal(a.getStatus().phase, "wake", "and the adapter is back to waiting for the wake word");

    const before = c.finals.length;
    for (let i = 0; i < 15; i += 1) backend.push("speech");
    for (let i = 0; i < 16; i += 1) backend.push("silence");
    await drain();
    assert.equal(c.finals.length, before, "a command with no wake word is NOT dispatched after the session closed");

    backend.push("wake"); // re-wake
    await drain();
    for (let i = 0; i < 15; i += 1) backend.push("speech");
    for (let i = 0; i < 16; i += 1) backend.push("silence");
    await drain();
    assert.equal(c.finals.filter((t) => t === "AYAS").length, 2, "re-wake reopened the session");
    assert.equal(a.getStatus().conversationActive, true);
    a.dispose();
  });

  await scenario("CONVERSATION — a successful command resets the idle timer", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(),
      transcribe: async () => "kaç proje var", ...FAST, conversationIdleMs: 400,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await drain();
    await sessionTurn(a, backend, c.handlers, { wake: true });
    const armed1 = Date.now();
    await wait(250); // < 400 ms — still inside the first window
    assert.equal(a.getStatus().conversationActive, true);
    await sessionTurn(a, backend, c.handlers, { wake: false }); // a 2nd command → resets the timer
    // Past the FIRST arm's deadline (armed1 + 400), but the reset moved it out.
    while (Date.now() - armed1 < 480) await wait(20);
    assert.equal(a.getStatus().conversationActive, true, "the 2nd command reset the idle timer");
    await wait(500); // now well past the reset deadline too
    assert.equal(a.getStatus().conversationActive, false, "…and it does eventually lapse on real silence");
    a.dispose();
  });

  await scenario("CONVERSATION — a typed turn's TTS during an open session is not heard as a command", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(),
      transcribe: async () => "kaç proje var", ...FAST,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await drain();
    await sessionTurn(a, backend, c.handlers, { wake: true });
    assert.equal(a.getStatus().phase, "capturing", "re-armed into an in-session capture");
    const before = c.finals.length;

    // The user types instead of speaking; AYAS speaks the reply.
    a.speak("yazılı bir cevap cümlesi", {
      voiceName: null, lang: "tr-TR", pitch: 1, rate: 1, volume: 1,
      onStart: () => {}, onEnd: () => a.startListening("tr-TR", c.handlers), onError: () => {},
    });
    assert.equal(a.getStatus().phase, "speaking", "speak() paused the in-session capture");
    for (let i = 0; i < 25; i += 1) backend.push("speech"); // TTS echo into the mic
    await drain();
    assert.equal(c.finals.length, before, "nothing captured from the TTS echo");
    // …and the session resumed listening after TTS.
    assert.equal(a.getStatus().conversationActive, true);
    for (let i = 0; i < 15; i += 1) backend.push("speech");
    for (let i = 0; i < 16; i += 1) backend.push("silence");
    await drain();
    assert.equal(c.finals.length, before + 1, "a real follow-up IS captured once TTS ends");
    a.dispose();
  });

  await scenario("CONVERSATION — endConversation() closes an open session immediately", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(),
      transcribe: async () => "kaç proje var", ...FAST,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await drain();
    await sessionTurn(a, backend, c.handlers, { wake: true });
    assert.equal(a.getStatus().conversationActive, true);

    a.endConversation();
    assert.equal(a.getStatus().conversationActive, false);
    assert.equal(a.getStatus().phase, "idle", "an idling in-session capture drops to idle, not wake");

    a.startListening("tr-TR", c.handlers); // engine re-arms
    await drain();
    assert.equal(a.getStatus().phase, "wake", "the re-arm needs the wake word again");
    a.dispose();
  });

  await scenario("CONVERSATION — REAL-DEVICE CASE: post-TTS recover() fails → rebuildAudio → session SURVIVES", async () => {
    // The exact regression the fake-backend tests missed: on iOS the capture
    // AudioContext does not always resume off-gesture after speechSynthesis, so
    // `recover()` returns false and `resumeOrRebuild` rebuilds the graph. That
    // rebuild is NORMAL churn — it must NOT drop the conversation session.
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(),
      transcribe: async () => "kaç proje var", ...FAST,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await drain();

    // turn 1 — real wake + command
    backend.push("wake");
    await drain();
    for (let i = 0; i < 12; i += 1) backend.push("speech");
    for (let i = 0; i < 14; i += 1) backend.push("silence");
    await drain();
    assert.equal(a.getStatus().conversationActive, true);

    // iOS: TTS suspends the context; recover() will FAIL → a rebuild is forced.
    backend.suspended = true;
    backend.recoverResult = false;   // resume() doesn't take → rebuild
    backend.failStartsRemaining = 0; // but the rebuild's getUserMedia succeeds
    a.speak("cevap", {
      voiceName: null, lang: "tr-TR", pitch: 1, rate: 1, volume: 1,
      onStart: () => {}, onEnd: () => a.startListening("tr-TR", c.handlers), onError: () => {},
    });
    await settle(20);

    assert.ok(a.getStatus().recoveryCount >= 1, "the post-TTS re-arm rebuilt the pipeline");
    assert.equal(a.getStatus().conversationActive, true, "the rebuild did NOT close the session");
    assert.equal(a.getStatus().phase, "capturing", "re-armed straight into the in-session capture");
    assert.equal(a.getStatus().conversationClosedReason, null, "no close reason — the session never ended");

    // and a follow-up command needs no wake word
    backend.recoverResult = true;
    for (let i = 0; i < 15; i += 1) backend.push("speech");
    for (let i = 0; i < 16; i += 1) backend.push("silence");
    await drain();
    assert.equal(c.finals.filter((t) => t === "AYAS").length, 1, "still exactly one real wake across the rebuild");
    assert.equal(c.finals.filter((t) => t !== "AYAS").length, 2, "second command captured after the rebuild");
    a.dispose();
  });

  await scenario("CONVERSATION — a recoverable `paused` interruption does NOT close the session; it self-heals", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(),
      transcribe: async () => "kaç proje var", ...FAST, pausedRetryMs: 60_000, // long — only an explicit retry un-pauses
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await drain();
    await sessionTurn(a, backend, c.handlers, { wake: true });
    assert.equal(a.getStatus().conversationActive, true);

    // the mic drops and every re-acquire fails → paused
    backend.recoverResult = false;
    backend.failStartsRemaining = 99;
    fireVisibility("visible");
    await settle(20);
    assert.equal(a.getStatus().mic, "paused");
    assert.equal(a.getStatus().conversationActive, true, "a recoverable pause keeps the session open");
    assert.equal(a.getStatus().conversationClosedReason, null, "no close reason — the session is still open");

    // the backend heals; an explicit retry (a mic tap) brings it back
    backend.recoverResult = true;
    backend.failStartsRemaining = 0;
    a.retryNow();
    await settle(20);
    assert.equal(a.getStatus().mic, "on", "self-healed");
    assert.equal(a.getStatus().conversationActive, true, "…and the session resumed");
    assert.equal(a.getStatus().phase, "capturing", "back in the in-session capture, no wake word needed");
    a.dispose();
  });

  await scenario("CONVERSATION — a pause that outlasts the idle timeout DOES lapse the session (via the timer)", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(),
      transcribe: async () => "kaç proje var", ...FAST, pausedRetryMs: 10_000, conversationIdleMs: 150,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await drain();
    await sessionTurn(a, backend, c.handlers, { wake: true });

    backend.recoverResult = false;
    backend.failStartsRemaining = 99;
    fireVisibility("visible");
    await settle(20);
    assert.equal(a.getStatus().mic, "paused");
    // the idle timer keeps running while paused → 150 ms later the session lapses
    await wait(300);
    assert.equal(a.getStatus().conversationActive, false, "15 s (here 150 ms) of no activity lapsed the session even while paused");
    assert.equal(a.getStatus().conversationClosedReason, "idle-timeout");
    a.dispose();
  });

  await scenario("CONVERSATION — dispose() clears the idle timer; no status emit after dispose", async () => {
    const backend = new FakeBackend();
    const seen: boolean[] = [];
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), tts: fakeTts(),
      transcribe: async () => "kaç proje var", ...FAST, conversationIdleMs: 60,
      onStatus: (s) => seen.push(s.conversationActive),
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await drain();
    await sessionTurn(a, backend, c.handlers, { wake: true });
    assert.ok(seen.includes(true), "the session was reported active while open");
    a.dispose();
    const seenAtDispose = seen.length;
    await wait(200); // well past the 60 ms idle timeout
    assert.equal(a.getStatus().phase, "disposed");
    assert.equal(seen.length, seenAtDispose, "the idle timer did not fire (or emit) after dispose");
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
