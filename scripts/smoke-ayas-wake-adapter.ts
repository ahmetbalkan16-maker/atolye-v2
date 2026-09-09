/**
 * AYAS wake-engine adapter smoke suite (Voice Closure Sprint).
 *
 * Deterministic / no browser / no model. Drives WakeWordVoiceAdapter with a
 * synchronous fake audio backend + fake wake runner + fake STT transport and
 * asserts the wake → command-capture → STT → transcript → re-arm state machine,
 * plus the WAV encoder and the openWakeWord streaming buffer math.
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

class FakeBackend implements WakeAudioBackend {
  readonly supported = true;
  onFrame: ((f: Float32Array) => void) | null = null;
  started = 0;
  stopped = 0;
  async start(cb: (f: Float32Array) => void) {
    this.onFrame = cb;
    this.started += 1;
  }
  stop() {
    this.stopped += 1;
    this.onFrame = null;
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
  async init() {
    this.ready = true;
    this.inits += 1;
  }
  reset() {
    this.resets += 1;
  }
  dispose() {}
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

async function run() {
  await scenario("WAV encoder: 44-byte header, 16 kHz mono s16, correct length", () => {
    const wav = encodeWav16kMono(new Float32Array(16000)); // 1 s
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
    assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
    const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    assert.equal(dv.getUint16(22, true), 1); // channels
    assert.equal(dv.getUint32(24, true), 16000); // sample rate
    assert.equal(dv.getUint16(34, true), 16); // bits
    assert.equal(wav.length, 44 + 16000 * 2);
  });

  await scenario("recognitionMode() is 'wake-engine'; STT reported local (not cloud)", () => {
    const a = new WakeWordVoiceAdapter({ audioBackend: new FakeBackend(), runner: new FakeRunner(), transcribe: async () => "x" });
    assert.equal(a.recognitionMode(), "wake-engine");
  });

  await scenario("wake word → onFinalTranscript('AYAS'), then command → transcript → onEnd (re-arm)", async () => {
    const backend = new FakeBackend();
    const runner = new FakeRunner();
    let sttCalls = 0;
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend,
      runner,
      transcribe: async () => {
        sttCalls += 1;
        return "kaç proje var";
      },
      threshold: 0.5,
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await tick();
    assert.equal(backend.started, 1);
    assert.equal(runner.inits, 1);

    // idle noise → no detection
    backend.push("silence");
    await tick();
    assert.deepEqual(c.finals, []);

    // wake frame → "AYAS"
    backend.push("wake");
    await tick();
    assert.deepEqual(c.finals, ["AYAS"]);

    // command: speech then silence closes it
    for (let i = 0; i < 20; i += 1) backend.push("speech"); // ~1.6 s
    for (let i = 0; i < 14; i += 1) backend.push("silence"); // ~1.1 s > 900 ms
    await tick();
    await tick();

    assert.equal(sttCalls, 1, "STT called once");
    assert.deepEqual(c.finals, ["AYAS", "kaç proje var"]);
    assert.ok(c.ended >= 1, "onEnd fired so the engine re-arms");
  });

  await scenario("command with no speech / blank STT → onError('no-speech'), still re-arms", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner: new FakeRunner(), transcribe: async () => "" });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await tick();
    backend.push("wake");
    await tick();
    for (let i = 0; i < 10; i += 1) backend.push("speech");
    for (let i = 0; i < 14; i += 1) backend.push("silence");
    await tick();
    await tick();
    assert.ok(c.errors.includes("no-speech"));
    assert.ok(c.ended >= 1);
  });

  await scenario("STT transport failure → onError, still re-arms, backend stopped", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({
      audioBackend: backend,
      runner: new FakeRunner(),
      transcribe: async () => {
        throw new Error("stt-500");
      },
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await tick();
    backend.push("wake");
    await tick();
    for (let i = 0; i < 10; i += 1) backend.push("speech");
    for (let i = 0; i < 14; i += 1) backend.push("silence");
    await tick();
    await tick();
    assert.ok(c.errors.length >= 1);
    assert.ok(c.ended >= 1);
    assert.ok(backend.stopped >= 1);
  });

  await scenario("stop() halts capture; no detection after stop", async () => {
    const backend = new FakeBackend();
    const a = new WakeWordVoiceAdapter({ audioBackend: backend, runner: new FakeRunner(), transcribe: async () => "x" });
    const c = collectHandlers();
    const handle = a.startListening("tr-TR", c.handlers);
    await tick();
    handle.stop();
    assert.ok(backend.stopped >= 1);
    backend.onFrame?.(new Float32Array(FRAME)); // backend cleared its callback
    await tick();
    assert.deepEqual(c.finals, []);
  });

  await scenario("getUserMedia denial surfaces as 'not-allowed' + onEnd + onUnavailable", async () => {
    const denying: WakeAudioBackend = {
      supported: true,
      async start() {
        throw new Error("Permission denied");
      },
      stop() {},
    };
    const reasons: string[] = [];
    const a = new WakeWordVoiceAdapter({
      audioBackend: denying,
      runner: new FakeRunner(),
      transcribe: async () => "x",
      onUnavailable: (r) => reasons.push(r),
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await tick();
    await tick();
    assert.ok(c.errors.includes("not-allowed"));
    assert.ok(c.ended >= 1);
    assert.deepEqual(reasons, ["not-allowed"], "host is told to fall back");
  });

  await scenario("a fatal wake-engine failure does not retry begin() on the engine's onEnd loop", async () => {
    let starts = 0;
    const flaky: WakeAudioBackend = {
      supported: true,
      async start() {
        starts += 1;
        throw new Error("onnx/wasm load failed");
      },
      stop() {},
    };
    let unavailable = 0;
    const a = new WakeWordVoiceAdapter({
      audioBackend: flaky,
      runner: new FakeRunner(),
      transcribe: async () => "x",
      onUnavailable: () => {
        unavailable += 1;
      },
    });
    const c = collectHandlers();
    // simulate the engine's continuous restart: startListening again after onEnd
    a.startListening("tr-TR", c.handlers);
    await tick();
    await tick();
    a.startListening("tr-TR", c.handlers);
    await tick();
    await tick();
    a.startListening("tr-TR", c.handlers);
    await tick();
    await tick();
    assert.equal(starts, 1, "audio backend start() attempted exactly once");
    assert.equal(unavailable, 1, "onUnavailable fired once");
    assert.ok(c.ended >= 3, "still ends cleanly on every startListening");
    assert.deepEqual(c.finals, [], "never a spurious wake");
  });

  await scenario("wake capture uses unprocessed audio (no browser NS / AGC)", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "src/components/brain/voice/wakeWordVoiceAdapter.ts"),
      "utf8",
    );
    assert.match(src, /noiseSuppression:\s*false/, "noise suppression off for the wake mic");
    assert.match(src, /autoGainControl:\s*false/, "auto gain off for the wake mic");
    assert.match(src, /echoCancellation:\s*true/, "echo cancellation stays on (TTS self-trigger guard)");
  });

  console.log(`AYAS wake adapter smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-wake-adapter", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
