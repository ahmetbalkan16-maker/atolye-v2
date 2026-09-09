/**
 * AYAS wake-engine adapter smoke suite.
 *
 * Deterministic / no browser / no model. Drives WakeWordVoiceAdapter with a
 * synchronous fake audio backend + fake wake runner + fake STT transport and
 * asserts the FULL lifecycle: first wake → command → STT → transcript → re-arm →
 * second wake, sustained over many turns, plus start-failure recovery (bounded,
 * no retry storm), foreground recovery of a suspended mic, and clean disposal.
 *
 * The key invariant this suite guards: the mic + worklet + ONNX runner are
 * started ONCE and kept alive across turns — re-arming after a reply is a state
 * flip, never a fresh getUserMedia (which iOS Safari hangs on after TTS).
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
import type { AyasListenHandlers } from "../src/components/brain/voice/ayasVoiceEngine";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const FRAME = 1280;
const REPO_ROOT = path.resolve(__dirname, "..");
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Minimal `document` so the adapter's visibilitychange wiring is exercised. */
const listeners = new Map<string, Set<() => void>>();
(globalThis as { document?: unknown }).document = {
  visibilityState: "visible" as "visible" | "hidden",
  addEventListener: (t: string, fn: () => void) => {
    if (!listeners.has(t)) listeners.set(t, new Set());
    listeners.get(t)!.add(fn);
  },
  removeEventListener: (t: string, fn: () => void) => listeners.get(t)?.delete(fn),
};
const fireVisibility = (state: "visible" | "hidden") => {
  (globalThis as { document: { visibilityState: string } }).document.visibilityState = state;
  for (const fn of listeners.get("visibilitychange") ?? []) fn();
};
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await tick();
};

class FakeBackend implements WakeAudioBackend {
  readonly supported = true;
  onFrame: ((f: Float32Array) => void) | null = null;
  started = 0;
  stopped = 0;
  recovers = 0;
  recoverResult = true;
  async start(cb: (f: Float32Array) => void) {
    this.onFrame = cb;
    this.started += 1;
  }
  stop() {
    this.stopped += 1;
    this.onFrame = null;
  }
  async recover() {
    this.recovers += 1;
    return this.recoverResult;
  }
  push(kind: "silence" | "speech" | "wake") {
    const f = new Float32Array(FRAME);
    if (kind !== "silence") for (let i = 0; i < FRAME; i += 1) f[i] = Math.sin(i / 4) * 0.3;
    (f as Float32Array & { __wake?: boolean }).__wake = kind === "wake";
    this.onFrame?.(f);
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

/** One full turn: wake → command → STT → onEnd, then the engine's re-arm. */
async function turn(a: WakeWordVoiceAdapter, backend: FakeBackend, h: AyasListenHandlers) {
  backend.push("wake");
  await settle();
  for (let i = 0; i < 12; i += 1) backend.push("speech");
  for (let i = 0; i < 14; i += 1) backend.push("silence");
  await settle();
  // engine re-arms after speaking the reply
  a.startListening("tr-TR", h);
  await settle();
}

async function run() {
  await scenario("WAV encoder: 44-byte header, 16 kHz mono s16, correct length", () => {
    const wav = encodeWav16kMono(new Float32Array(16000));
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
    assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
    const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    assert.equal(dv.getUint16(22, true), 1);
    assert.equal(dv.getUint32(24, true), 16000);
    assert.equal(dv.getUint16(34, true), 16);
    assert.equal(wav.length, 44 + 16000 * 2);
  });

  await scenario("recognitionMode() is 'wake-engine'", () => {
    const a = new WakeWordVoiceAdapter({ audioBackend: new FakeBackend(), runner: new FakeRunner(), transcribe: async () => "x" });
    assert.equal(a.recognitionMode(), "wake-engine");
    assert.equal(a.detectCapability().sttCloudBacked, false, "STT is local (whisper), not cloud");
  });

  await scenario("first wake → 'AYAS' → command → transcript → onEnd (re-arm)", async () => {
    const backend = new FakeBackend();
    const runner = new FakeRunner();
    let sttCalls = 0;
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner, threshold: 0.5, rearmCooldownMs: 0,
      transcribe: async () => { sttCalls += 1; return "kaç proje var"; },
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    assert.equal(backend.started, 1);
    assert.equal(runner.inits, 1);

    backend.push("silence");
    await settle();
    assert.deepEqual(c.finals, []);

    backend.push("wake");
    await settle();
    assert.deepEqual(c.finals, ["AYAS"]);

    for (let i = 0; i < 12; i += 1) backend.push("speech");
    for (let i = 0; i < 14; i += 1) backend.push("silence");
    await settle();

    assert.equal(sttCalls, 1);
    assert.deepEqual(c.finals, ["AYAS", "kaç proje var"]);
    assert.ok(c.ended >= 1, "onEnd fired so the engine re-arms");
  });

  await scenario("RE-ARM keeps the mic alive — no second getUserMedia between turns", async () => {
    const backend = new FakeBackend();
    const runner = new FakeRunner();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner, threshold: 0.5, rearmCooldownMs: 0,
      transcribe: async () => "komut",
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();

    await turn(a, backend, c.handlers);
    await turn(a, backend, c.handlers);

    assert.equal(backend.started, 1, "mic started exactly once across turns");
    assert.equal(backend.stopped, 0, "mic never stopped between turns");
    assert.equal(runner.inits, 1, "ONNX runner initialised once");
    assert.ok(runner.resets >= 2, "streaming window reset on each re-arm");
    assert.deepEqual(c.finals, ["AYAS", "komut", "AYAS", "komut"]);
  });

  await scenario("SECOND wake works, and 12 sustained cycles all fire", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), threshold: 0.5, rearmCooldownMs: 0,
      transcribe: async () => "x",
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();

    for (let i = 0; i < 12; i += 1) await turn(a, backend, c.handlers);

    const wakes = c.finals.filter((t) => t === "AYAS").length;
    assert.equal(wakes, 12, `all 12 wakes fired (got ${wakes})`);
    assert.equal(backend.started, 1);
    assert.equal(backend.stopped, 0);
    assert.equal(a.getStatus().cyclesCompleted, 12);
    assert.equal(a.getStatus().mic, "on");
  });

  await scenario("blank STT → onError('no-speech'), still re-arms and hears the next wake", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), threshold: 0.5, rearmCooldownMs: 0,
      transcribe: async () => "",
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    backend.push("wake");
    await settle();
    for (let i = 0; i < 12; i += 1) backend.push("speech");
    for (let i = 0; i < 14; i += 1) backend.push("silence");
    await settle();
    assert.ok(c.errors.includes("no-speech"));
    a.startListening("tr-TR", c.handlers);
    await settle();
    backend.push("wake");
    await settle();
    assert.equal(c.finals.filter((t) => t === "AYAS").length, 2, "re-armed after the blank turn");
    assert.equal(backend.stopped, 0);
  });

  await scenario("STT transport failure → onError, mic stays alive, next turn works", async () => {
    const backend = new FakeBackend();
    let fail = true;
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend, runner: new FakeRunner(), threshold: 0.5, rearmCooldownMs: 0,
      transcribe: async () => { if (fail) throw new Error("stt-500"); return "ok"; },
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    await turn(a, backend, c.handlers);
    assert.ok(c.errors.length >= 1);
    assert.equal(backend.stopped, 0, "a transport error does not tear down the mic");
    fail = false;
    await turn(a, backend, c.handlers);
    assert.ok(c.finals.includes("ok"), "recovered on the next turn");
  });

  await scenario("stop() PAUSES (mic stays); dispose() tears down", async () => {
    const backend = new FakeBackend();
    const runner = new FakeRunner();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner, threshold: 0.5, rearmCooldownMs: 0, transcribe: async () => "x" });
    const c = collectHandlers();
    const handle = a.startListening("tr-TR", c.handlers);
    await settle();
    handle.stop();
    assert.equal(backend.stopped, 0, "stop() is a pause, not a teardown");
    assert.equal(a.getStatus().phase, "idle");
    backend.push("wake");
    await settle();
    assert.deepEqual(c.finals, [], "paused → no detection");

    a.dispose();
    assert.equal(backend.stopped, 1, "dispose() stops the mic");
    assert.equal(runner.disposes, 1, "dispose() releases the ONNX runner");
    a.startListening("tr-TR", c.handlers);
    await settle();
    assert.equal(backend.started, 1, "a disposed adapter does not restart");
  });

  await scenario("mic permission denied → fatal, onUnavailable('not-allowed'), no retry storm", async () => {
    let starts = 0;
    const denying: WakeAudioBackend = {
      supported: true,
      async start() { starts += 1; const e = new Error("Permission denied"); e.name = "NotAllowedError"; throw e; },
      stop() {},
    };
    const reasons: string[] = [];
    const a = new WakeWordVoiceAdapter({
      audioBackend: denying, runner: new FakeRunner(), transcribe: async () => "x",
      onUnavailable: (r) => reasons.push(r), startRetryBackoffMs: 1,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    a.startListening("tr-TR", c.handlers);
    a.startListening("tr-TR", c.handlers);
    await settle();
    assert.equal(starts, 1, "denial is not retried");
    assert.deepEqual(reasons, ["not-allowed"]);
    assert.ok(c.errors.includes("not-allowed"));
    assert.equal(a.getStatus().mic, "fatal");
  });

  await scenario("transient start failure → bounded retry (3) then fatal 'start-blocked'", async () => {
    let starts = 0;
    const flaky: WakeAudioBackend = {
      supported: true,
      async start() { starts += 1; throw new Error("AbortError-ish transient"); },
      stop() {},
    };
    let unavailable = 0;
    const a = new WakeWordVoiceAdapter({
      audioBackend: flaky, runner: new FakeRunner(), transcribe: async () => "x",
      onUnavailable: () => { unavailable += 1; }, startRetryBackoffMs: 1,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    await new Promise((r) => setTimeout(r, 20)); // let the 3 bounded retries elapse
    assert.equal(starts, 3, "exactly MAX_START_ATTEMPTS tries");
    assert.equal(unavailable, 1, "onUnavailable fired once");
    assert.equal(a.getStatus().mic, "fatal");
    // further re-arm attempts do nothing (no storm)
    const before = starts;
    a.startListening("tr-TR", c.handlers);
    a.startListening("tr-TR", c.handlers);
    await settle();
    assert.equal(starts, before, "no further start() calls after fatal");
  });

  await scenario("foreground recovery — suspended AudioContext resumed, no rebuild", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner: new FakeRunner(), threshold: 0.5, rearmCooldownMs: 0, transcribe: async () => "x" });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    backend.recoverResult = true;
    fireVisibility("hidden");
    fireVisibility("visible");
    await settle();
    assert.equal(backend.recovers, 1);
    assert.equal(backend.started, 1, "healthy resume does not rebuild the mic");
    backend.push("wake");
    await settle();
    assert.deepEqual(c.finals, ["AYAS"], "still listening after foreground recovery");
  });

  await scenario("foreground recovery — ended mic track rebuilt once (bounded)", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner: new FakeRunner(), threshold: 0.5, rearmCooldownMs: 0, startRetryBackoffMs: 1, transcribe: async () => "x" });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await settle();
    backend.recoverResult = false; // track ended
    fireVisibility("hidden");
    fireVisibility("visible");
    await settle();
    assert.equal(backend.started, 2, "mic rebuilt exactly once");
    backend.push("wake");
    await settle();
    assert.deepEqual(c.finals, ["AYAS"], "listening again after rebuild");
  });

  await scenario("STATIC — wake capture uses unprocessed audio (no NS / AGC) + keeps echo cancellation", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src/components/brain/voice/wakeWordVoiceAdapter.ts"), "utf8");
    assert.match(src, /noiseSuppression:\s*false/);
    assert.match(src, /autoGainControl:\s*false/);
    assert.match(src, /echoCancellation:\s*true/);
  });

  await scenario("STATIC — the mic is only stopped on dispose(), never in finishCommand", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src/components/brain/voice/wakeWordVoiceAdapter.ts"), "utf8");
    const finishBody = src.slice(src.indexOf("private async finishCommand"), src.indexOf("dispose(): void"));
    assert.ok(!/this\.audio\.stop\(\)/.test(finishBody), "finishCommand must NOT stop the mic (that killed re-arm)");
  });

  console.log(`AYAS wake adapter smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-wake-adapter", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
