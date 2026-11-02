/**
 * AYAS first wake from the phone — the first start must not lose the first "AYAS".
 *
 * Deterministic / no browser / no model. Guards the 2026-10-19 diagnosis:
 *  - The wake runtime + models (~17 MB) loaded only AFTER the mic tap, under the 12 s audio bound. Through the home
 *    tunnel the 14 MB WASM alone took 47 s, so a cold first start timed out, latched `fatal` and dropped to the
 *    browser adapter: the first "AYAS" of that session never woke.
 *  - During that load the UI already said "AYAS" was awaited.
 *  - The service worker did not keep these assets, so every HTTP-cache eviction repeated the 47 s download.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { WakeWordVoiceAdapter, type WakeAudioBackend, type WakeRunnerLike } from "../src/components/brain/voice/wakeWordVoiceAdapter";
import type { AyasListenHandlers, AyasSpeakOptions } from "../src/components/brain/voice/ayasVoiceEngine";
import { deriveAyasPresence } from "../src/components/brain/brainCore";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const FRAME = 1280;
const REPO_ROOT = path.resolve(__dirname, "..");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (check: () => boolean, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await wait(5);
};

(globalThis as { document?: unknown }).document = {
  visibilityState: "visible",
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
  dispose() {
    this.onFrame = null;
  }
  async recover() {
    return true;
  }
  push(wake: boolean) {
    const f = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i += 1) f[i] = Math.sin(i / 4) * 0.3;
    (f as Float32Array & { __wake?: boolean }).__wake = wake;
    this.onFrame?.(f);
  }
}

/** A runner whose load takes `loadMs` and can be told to fail its first `failLoads` loads. */
class SlowRunner implements WakeRunnerLike {
  ready = false;
  inits = 0;
  warmUps = 0;
  constructor(private readonly loadMs: number, private failLoads = 0) {}
  async init() {
    this.inits += 1;
    await wait(this.loadMs);
    if (this.failLoads > 0) {
      this.failLoads -= 1;
      throw new Error("wake-model-fetch-failed");
    }
    this.ready = true;
  }
  async warmUp() {
    this.warmUps += 1;
  }
  reset() {}
  dispose() {
    this.ready = false;
  }
  async accept(frame: Float32Array) {
    return (frame as Float32Array & { __wake?: boolean }).__wake ? 0.97 : 0.01;
  }
}

function fakeTts() {
  return {
    speak: (_text: string, options: AyasSpeakOptions) => {
      queueMicrotask(() => {
        options.onStart();
        queueMicrotask(() => options.onEnd());
      });
      return { cancel: () => {} };
    },
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

const FAST = { rearmCooldownMs: 0, startRetryBackoffMs: 1, threshold: 0.5 } as const;

async function run() {
  await scenario("the model-load bound is its own, sized for the measured 47 s cold download — not the 12 s audio bound", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src/components/brain/voice/wakeWordVoiceAdapter.ts"), "utf8");
    const bound = Number(/const MODEL_LOAD_TIMEOUT_MS = ([\d_]+);/.exec(src)?.[1].replace(/_/g, ""));
    assert.ok(bound >= 120_000, `model load bound ${bound} ms must clear a 47 s WASM + 3.3 MB models download with margin`);
    assert.match(src, /withTimeout\(this\.prepareRunners\(\), this\.modelLoadTimeoutMs, "runner-init"\)/);
    assert.doesNotMatch(src, /withTimeout\([^)]*inits[^)]*AUDIO_START_TIMEOUT_MS, "runner-init"\)/, "the old 12 s runner-init bound is gone");
  });

  await scenario("a model load slower than before still arms the wake engine — no fatal, no browser fallback", async () => {
    const backend = new FakeBackend();
    const runner = new SlowRunner(150);
    const unavailable: string[] = [];
    const a = new WakeWordVoiceAdapter({
      ...FAST, audioBackend: backend, runner, tts: fakeTts(), transcribe: async () => "x",
      modelLoadTimeoutMs: 2_000, onUnavailable: (r) => unavailable.push(r),
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await waitFor(() => a.getStatus().mic === "on");
    assert.equal(a.getStatus().mic, "on", "assert.equal(a.getStatus().mic, \"on\")");
    assert.deepEqual(unavailable, [], "assert.deepEqual(unavailable, [])");
    backend.push(true);
    await waitFor(() => c.finals.length > 0);
    assert.deepEqual(c.finals, ["AYAS"], "the very first AYAS after a slow load wakes");
    a.dispose();
  });

  await scenario("the reported bug, default settings: a first load slower than 12 s still wakes on the first AYAS", async () => {
    const backend = new FakeBackend();
    const unavailable: string[] = [];
    const a = new WakeWordVoiceAdapter({
      ...FAST, audioBackend: backend, runner: new SlowRunner(12_500), tts: fakeTts(), transcribe: async () => "x",
      onUnavailable: (r) => unavailable.push(r),
    });
    const c = collectHandlers();
    a.startListening("tr-TR", c.handlers);
    await waitFor(() => a.getStatus().mic === "on" || unavailable.length > 0, 15_000);
    assert.deepEqual(unavailable, [], "a slow cold download must not drop the session to the browser adapter");
    assert.equal(a.getStatus().mic, "on", "assert.equal(a.getStatus().mic, \"on\")");
    backend.push(true);
    await waitFor(() => c.finals.length > 0);
    assert.deepEqual(c.finals, ["AYAS"], "assert.deepEqual(c.finals, [\"AYAS\"])");
    a.dispose();
  });

  await scenario("a load that genuinely hangs past the bound still falls back (fail-closed preserved)", async () => {
    const unavailable: string[] = [];
    const a = new WakeWordVoiceAdapter({
      ...FAST, audioBackend: new FakeBackend(), runner: new SlowRunner(300), tts: fakeTts(), transcribe: async () => "x",
      modelLoadTimeoutMs: 40, onUnavailable: (r) => unavailable.push(r),
    });
    a.startListening("tr-TR", collectHandlers().handlers);
    await waitFor(() => unavailable.length > 0);
    assert.deepEqual(unavailable, ["runner-init"], "assert.deepEqual(unavailable, [\"runner-init\"])");
    assert.equal(a.getStatus().mic, "fatal", "assert.equal(a.getStatus().mic, \"fatal\")");
    a.dispose();
  });

  await scenario("preload loads the models before the tap; the tap only opens the mic; one load in total", async () => {
    const backend = new FakeBackend();
    const runner = new SlowRunner(60);
    const a = new WakeWordVoiceAdapter({ ...FAST, audioBackend: backend, runner, tts: fakeTts(), transcribe: async () => "x" });
    a.preload();
    assert.equal(runner.inits, 1, "preload starts the load immediately, without a mic or a gesture");
    assert.equal(backend.started, 0, "preload never opens the microphone");
    a.preload();
    await waitFor(() => runner.ready);
    assert.equal(runner.warmUps, 1, "silence warm-up ran during preload");

    const c = collectHandlers();
    const tappedAt = Date.now();
    a.startListening("tr-TR", c.handlers);
    await waitFor(() => a.getStatus().mic === "on");
    assert.ok(Date.now() - tappedAt < 50, "armed right after the tap, not after another model load");
    assert.equal(runner.inits, 1, "no second load");
    assert.equal(runner.warmUps, 1, "no second warm-up");
    a.dispose();
  });

  await scenario("a tap during an unfinished preload joins it instead of downloading twice", async () => {
    const backend = new FakeBackend();
    const runner = new SlowRunner(120);
    const a = new WakeWordVoiceAdapter({ ...FAST, audioBackend: backend, runner, tts: fakeTts(), transcribe: async () => "x" });
    a.preload();
    await wait(20);
    a.startListening("tr-TR", collectHandlers().handlers);
    await waitFor(() => a.getStatus().mic === "on");
    assert.equal(a.getStatus().mic, "on", "assert.equal(a.getStatus().mic, \"on\")");
    assert.equal(runner.inits, 1, "assert.equal(runner.inits, 1)");
    a.dispose();
  });

  await scenario("a failed preload is retried by the tap, not remembered as a failure", async () => {
    const runner = new SlowRunner(10, 1);
    const unavailable: string[] = [];
    const a = new WakeWordVoiceAdapter({
      ...FAST, audioBackend: new FakeBackend(), runner, tts: fakeTts(), transcribe: async () => "x",
      onUnavailable: (r) => unavailable.push(r),
    });
    a.preload();
    await wait(40);
    assert.equal(runner.ready, false, "the first load failed");
    a.startListening("tr-TR", collectHandlers().handlers);
    await waitFor(() => a.getStatus().mic === "on");
    assert.equal(a.getStatus().mic, "on", "assert.equal(a.getStatus().mic, \"on\")");
    assert.equal(runner.inits, 2, "assert.equal(runner.inits, 2)");
    assert.deepEqual(unavailable, [], "assert.deepEqual(unavailable, [])");
    a.dispose();
  });

  await scenario("the tap reports 'starting' before 'on', so the UI can stop claiming it is listening", async () => {
    const seen: string[] = [];
    const a = new WakeWordVoiceAdapter({
      ...FAST, audioBackend: new FakeBackend(), runner: new SlowRunner(40), tts: fakeTts(), transcribe: async () => "x",
      onStatus: (s) => seen.push(s.mic),
    });
    a.startListening("tr-TR", collectHandlers().handlers);
    assert.equal(seen[0], "starting", "emitted synchronously inside the tap");
    await waitFor(() => a.getStatus().mic === "on");
    assert.equal(seen[seen.length - 1], "on", "assert.equal(seen[seen.length - 1], \"on\")");
    a.dispose();
  });

  await scenario("presence: 'AYAS' is awaited only once the pipeline is armed", () => {
    const base = { connectivity: "online" as const, secureContext: true, executionGate: "CLOSED" as const };
    const voice = { sttAvailable: true, ttsAvailable: true, listening: true, state: "idle" as const, mode: "wake-engine" as const, micPermission: "granted" as const };
    const starting = deriveAyasPresence({ ...base, voice: { ...voice, starting: true } }).voice.value;
    assert.match(starting, /hazırlanıyor/);
    assert.doesNotMatch(starting, /bekleniyor/);
    assert.equal(deriveAyasPresence({ ...base, voice: { ...voice, starting: false } }).voice.value, "\"AYAS\" bekleniyor (eller serbest)", "assert.equal(deriveAyasPresence({ ...base, voice: { ...voice, starting: false } }).voice.value, \"\\\"AYAS\\\" bekleniyor (eller serbest)\")");
    assert.equal(deriveAyasPresence({ ...base, voice: { ...voice, listening: false, starting: true } }).voice.value === starting, false, "voice off is not 'starting'");
  });

  await runServiceWorkerScenarios();
  console.log(`PASS (${count} scenarios)`);
}

/* ---- service worker: the wake assets are kept and revalidated, never re-downloaded unchanged ---- */

const swSource = fs.readFileSync(path.join(REPO_ROOT, "public/sw.js"), "utf8");

type Init = { headers?: Record<string, string>; cache?: string } | undefined;
function loadSw(network: (url: string, init: Init) => Promise<Response>) {
  const stores = new Map<string, Map<string, Response>>();
  const calls: Array<{ url: string; init: Init }> = [];
  const handlers = new Map<string, (event: unknown) => void>();
  const store = (name: string) => stores.get(name) ?? stores.set(name, new Map()).get(name)!;
  const key = (req: { url: string } | string) => (typeof req === "string" ? req : req.url);
  const sandbox = {
    self: {
      addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn),
      skipWaiting: () => {},
      clients: { claim: () => Promise.resolve() },
      location: { origin: "https://example.test" },
    },
    caches: {
      open: (name: string) => Promise.resolve({
        match: (req: { url: string } | string) => Promise.resolve(store(name).get(key(req))?.clone()),
        put: (req: { url: string } | string, res: Response) => {
          store(name).set(key(req), res);
          return Promise.resolve();
        },
        add: () => Promise.resolve(),
      }),
      keys: () => Promise.resolve([...stores.keys()]),
      delete: (name: string) => Promise.resolve(stores.delete(name)),
      match: () => Promise.resolve(undefined),
    },
    fetch: (req: { url: string } | string, init?: Init) => {
      calls.push({ url: key(req), init });
      return network(key(req), init);
    },
    URL,
    Response,
    Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(swSource, sandbox);
  const get = (url: string) =>
    new Promise<Response | undefined>((resolve) => {
      let responded = false;
      handlers.get("fetch")!({
        request: { method: "GET", url, mode: "cors", destination: "" },
        respondWith: (p: Promise<Response>) => {
          responded = true;
          void p.then(resolve);
        },
      });
      if (!responded) resolve(undefined);
    });
  const activate = () => new Promise<void>((resolve) => {
    handlers.get("activate")!({ waitUntil: (p: Promise<unknown>) => void p.then(() => resolve()) });
  });
  return { get, calls, stores, activate };
}

const WASM = "https://example.test/ort/ort-wasm-simd-threaded.wasm";

async function runServiceWorkerScenarios() {
  await scenario("sw: first wake-asset request fetches normally and keeps the copy", async () => {
    const sw = loadSw(async () => new Response("wasm-v1", { status: 200, headers: { ETag: 'W/"v1"' } }));
    const res = await sw.get(WASM);
    assert.equal(await res!.text(), "wasm-v1", "assert.equal(await res!.text(), \"wasm-v1\")");
    await wait(0);
    assert.equal(sw.calls.length, 1, "assert.equal(sw.calls.length, 1)");
    assert.equal(sw.calls[0].init, undefined, "the first fill may use the browser's own HTTP cache");
    assert.ok([...sw.stores.values()].some((s) => s.has(WASM)), "copy kept for the next session");
  });

  await scenario("sw: an unchanged asset costs a conditional 304 and is served from the kept copy", async () => {
    let version = "v1";
    const sw = loadSw(async (_url, init) => {
      if (init?.headers?.["If-None-Match"] === `W/"${version}"`) return new Response(null, { status: 304 });
      return new Response(`wasm-${version}`, { status: 200, headers: { ETag: `W/"${version}"` } });
    });
    await sw.get(WASM);
    await wait(0);
    const again = await sw.get(WASM);
    assert.equal(await again!.text(), "wasm-v1", "assert.equal(await again!.text(), \"wasm-v1\")");
    assert.equal(sw.calls[1].init?.headers?.["If-None-Match"], 'W/"v1"', "assert.equal(sw.calls[1].init?.headers?.[\"If-None-Match\"], 'W/\"v1\"')");
    assert.equal(sw.calls[1].init?.cache, "no-store", "the revalidation reaches the server, not a stale HTTP cache");

    version = "v2"; // a changed runtime/model is never served stale while online
    const changed = await sw.get(WASM);
    assert.equal(await changed!.text(), "wasm-v2", "assert.equal(await changed!.text(), \"wasm-v2\")");
    await wait(0);
    const after = await sw.get(WASM);
    assert.equal(await after!.text(), "wasm-v2", "the new copy replaced the old one");
  });

  await scenario("sw: offline, the kept copy still serves; models, worklet and runtime are all covered", async () => {
    let online = true;
    const sw = loadSw(async () => {
      if (!online) throw new Error("offline");
      return new Response("asset", { status: 200, headers: { ETag: 'W/"a"' } });
    });
    for (const p of ["/wake/ayas.onnx", "/wake/melspectrogram.onnx", "/wake/embedding_model.onnx", "/worklets/d2-wake-lab-processor.js", "/ort/ort-wasm-simd-threaded.mjs"]) {
      assert.ok(await sw.get(`https://example.test${p}`), `${p} is handled`);
    }
    await wait(0);
    online = false;
    const res = await sw.get("https://example.test/wake/ayas.onnx");
    assert.equal(await res!.text(), "asset", "assert.equal(await res!.text(), \"asset\")");
    assert.equal(await sw.get("https://example.test/worklets/d2-audio-lab-processor.js"), undefined, "unrelated worklets untouched");
    assert.equal(await sw.get("https://example.test/api/ayas/stt"), undefined, "/api is never intercepted");
  });

  await scenario("sw: activate keeps the wake cache and still purges stale shell caches", async () => {
    const sw = loadSw(async () => new Response("x", { status: 200, headers: { ETag: 'W/"x"' } }));
    await sw.get(WASM);
    await wait(0);
    sw.stores.set("ayas-shell-v3", new Map());
    const wakeCache = [...sw.stores.keys()].find((k) => k.startsWith("ayas-wake-"));
    assert.ok(wakeCache, "assert.ok(wakeCache)");
    await sw.activate();
    assert.ok(sw.stores.has(wakeCache!), "the 17 MB wake copy survives a worker update");
    assert.ok(!sw.stores.has("ayas-shell-v3"), "assert.ok(!sw.stores.has(\"ayas-shell-v3\"))");
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
