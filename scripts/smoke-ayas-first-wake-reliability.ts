/** Independent bounded first-wake regression. Frozen Stage17 graders stay untouched.
 * Real tests use existing ONNX + Piper/FFmpeg assets, never a provider or microphone.
 * Synthetic speech is not real-phone/real-human acceptance.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { OpenWakeWordRunner, type WakeSession } from "../src/components/brain/voice/wake/openWakeWordRunner";
import { WakeWordVoiceAdapter, WakeScoreDetector, type WakeAudioBackend } from "../src/components/brain/voice/wakeWordVoiceAdapter";
import { BrowserVoiceAdapter } from "../src/components/brain/voice/browserVoiceAdapter";
import { detectAyasWakeWord } from "../src/components/brain/ayasVoice";
import { AyasVoiceEngine, type AyasListenHandlers } from "../src/components/brain/voice/ayasVoiceEngine";

const FRAME = 1280;
const drain = async () => { for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r)); };
const results: string[] = [];
const failures: string[] = [];
async function scenario(name: string, run: () => void | Promise<void>) { try { await run(); results.push(name); } catch (error) { failures.push(name); console.error(`FAILED: ${name}`, error); } }
function gate() { let release = () => {}; const promise = new Promise<void>((r) => { release = r; }); return { promise, release }; }
function fakeRunner() {
  let melCalls = 0, wwCalls = 0;
  let score = 0.01;
  let hold: ReturnType<typeof gate> | null = null;
  let fail = false;
  const mel: WakeSession = { inputNames: ["x"], outputNames: ["y"], async run() {
    melCalls++;
    if (hold) { const h = hold; hold = null; await h.promise; }
    if (fail) throw new Error("warmup-kernel-failed");
    return { y: { data: new Float32Array(8 * 32) } };
  } };
  const emb: WakeSession = { inputNames: ["x"], outputNames: ["y"], async run() { return { y: { data: new Float32Array(96) } }; } };
  let sequence: number[] = [];
  const ww: WakeSession = { inputNames: ["x"], outputNames: ["y"], async run() { wwCalls++; return { y: { data: new Float32Array([sequence.length ? sequence.shift()! : score]) } }; } };
  const runner = new OpenWakeWordRunner({ melspectrogramUrl: "mel", embeddingUrl: "emb", wakewordUrl: "ww", createSession: async (url) => ({ mel, emb, ww })[url as "mel"] });
  return { runner, block: () => { hold = gate(); return hold; }, setScore: (s: number) => { score = s; }, sequence: (s: number[]) => { sequence = [...s]; }, fail: () => { fail = true; }, get melCalls() { return melCalls; }, get wwCalls() { return wwCalls; } };
}
class Backend implements WakeAudioBackend {
  supported = true;
  callback: ((frame: Float32Array) => void) | null = null;
  starts = 0;
  primes = 0;
  prime() { this.primes++; }
  async start(cb: (frame: Float32Array) => void) { this.starts++; this.callback = cb; }
  stop() { this.callback = null; }
  recover = async () => true;
  push(amp = 0) { const f = new Float32Array(FRAME); for (let i = 0; i < FRAME; i++) f[i] = Math.sin(i / 4) * amp; this.callback?.(f); }
}
function harness(runner = fakeRunner()) {
  const backend = new Backend();
  const transcripts: string[] = [], errors: string[] = [];
  const handlers: AyasListenHandlers = { onFinalTranscript: (t) => transcripts.push(t), onError: (e) => errors.push(e), onEnd() {} };
  const adapter = new WakeWordVoiceAdapter({ audioBackend: backend, runner: runner.runner, transcribe: async () => "AYAS test komutu", rearmCooldownMs: 350 });
  return { runner, backend, transcripts, errors, handlers, adapter };
}
async function waitWake(h: ReturnType<typeof harness>) {
  for (let i = 0; i < 100 && h.adapter.getStatus().phase !== "wake"; i++) await drain();
  assert.equal(h.adapter.getStatus().phase, "wake");
}
async function catchup(h: ReturnType<typeof harness>, scores: number[]) {
  h.runner.sequence(scores);
  const g = h.runner.block();
  h.backend.push();
  await drain();
  for (let i = 1; i < scores.length; i++) h.backend.push();
  await drain(); g.release(); await drain();
}

async function main() {
  await scenario("cold control needs 25 chunks / 2000 ms before a score", async () => {
    const f = fakeRunner(); await f.runner.init(); let first = 0;
    for (let n = 1; n <= 30; n++) { if (await f.runner.accept(new Float32Array(FRAME)) !== null) { first = n; break; } }
    assert.equal(first, 25); f.runner.dispose();
  });
  await scenario("warm-up bounded to 25 real feature chunks, synthetic scores excluded", async () => {
    const f = fakeRunner(); await f.runner.init(); await Promise.all([f.runner.warmUp(), f.runner.warmUp()]);
    assert.equal(f.melCalls, 25); assert.equal(f.runner.stats.frames, 0); assert.equal(f.runner.stats.inferences, 0); assert.equal(f.runner.stats.scoreDistribution, null);
    assert.notEqual(await f.runner.accept(new Float32Array(FRAME)), null); assert.equal(f.runner.stats.frames, 1);
    f.runner.reset(); assert.notEqual(await f.runner.accept(new Float32Array(FRAME)), null);
    await f.runner.warmUp(); assert.equal(f.melCalls, 27); f.runner.dispose();
  });
  await scenario("fresh mobile-style startup primes synchronously, awaits model before mic", async () => {
    const h = harness(); const g = h.runner.block();
    h.adapter.startListening("tr-TR", h.handlers);
    assert.equal(h.backend.primes, 1); await drain();
    assert.equal(h.backend.starts, 0); assert.equal(h.adapter.getStatus().phase, "starting");
    g.release(); await waitWake(h);
    h.runner.setScore(0.9); h.backend.push(); await drain();
    assert.deepEqual(h.transcripts, ["AYAS"]); h.adapter.dispose();
  });
  await scenario("catch-up delivers a first hard wake followed by three quiet scores once", async () => {
    const h = harness(); h.adapter.startListening("tr", h.handlers); await waitWake(h);
    await catchup(h, [0.9, 0.01, 0.01, 0.01]);
    assert.deepEqual(h.transcripts, ["AYAS"]); assert.equal(h.runner.runner.stats.maxConcurrentInference, 1); h.adapter.dispose();
  });
  await scenario("catch-up preserves all three soft votes before the last quiet score", async () => {
    const h = harness(); h.adapter.startListening("tr", h.handlers); await waitWake(h);
    await catchup(h, [0.62, 0.62, 0.62, 0.01]); assert.deepEqual(h.transcripts, ["AYAS"]); h.adapter.dispose();
  });
  await scenario("unsupported near-hard blip plus quiet catch-up does not wake", async () => {
    const h = harness(); h.adapter.startListening("tr", h.handlers); await waitWake(h);
    await catchup(h, [0.68, 0.01, 0.01, 0.01]); assert.deepEqual(h.transcripts, []); h.adapter.dispose();
  });
  await scenario("reset during delayed inference drops stale output and retains single-flight", async () => {
    const f = fakeRunner(); await f.runner.init(); await f.runner.warmUp(); f.setScore(0.9);
    const g = f.block(), observed: number[] = [];
    const old = f.runner.accept(new Float32Array(FRAME), (s) => observed.push(s)); await drain(); f.runner.reset();
    assert.equal(await f.runner.accept(new Float32Array(FRAME), (s) => observed.push(s)), null);
    g.release(); assert.equal(await old, null); assert.equal(observed.length, 0);
    await f.runner.accept(new Float32Array(FRAME), (s) => observed.push(s)); assert.equal(observed.length, 2);
    assert.equal(f.runner.stats.maxConcurrentInference, 1); f.runner.dispose();
  });
  await scenario("dispose during delayed inference cannot emit a wake", async () => {
    const f = fakeRunner(); await f.runner.init(); await f.runner.warmUp(); const g = f.block();
    const scores: number[] = []; const pending = f.runner.accept(new Float32Array(FRAME), (s) => scores.push(s)); await drain(); f.runner.dispose(); g.release();
    assert.equal(await pending, null); assert.deepEqual(scores, []);
  });
  await scenario("warm-up failure closes startup before microphone acquisition", async () => {
    const h = harness(); h.runner.fail(); h.adapter.startListening("tr", h.handlers); await drain();
    assert.equal(h.adapter.getStatus().phase, "fatal"); assert.equal(h.backend.starts, 0); assert.deepEqual(h.transcripts, []); h.adapter.dispose();
  });
  await scenario("case normalization AYAS / Ayas / ayas is deterministic", () => {
    for (const word of ["AYAS", "Ayas", "ayas", "  AYAS! "]) assert.equal(detectAyasWakeWord(word).woke, true);
  });
  await scenario("negative and near-match text does not gain wake aliases", () => {
    for (const word of ["yavaş", "hayat", "ayaz", "ayasa", "ayaslı", "merhaba", "bugün AYAS hakkında konuşalım"]) assert.equal(detectAyasWakeWord(word).woke, false, word);
  });
  await scenario("cooldown blocks echo before 350 ms, allows exact boundary; fresh wake unblocked", async () => {
    const realNow = Date.now; let now = 10000; Date.now = () => now;
    const h = harness();
    try {
      h.adapter.startListening("tr", h.handlers); await waitWake(h); h.runner.setScore(0.9); h.backend.push(); await drain();
      h.runner.setScore(0.01);
      for (let i = 0; i < 8; i++) h.backend.push(0.2);
      for (let i = 0; i < 14; i++) h.backend.push();
      await drain(); assert.equal(h.adapter.getStatus().phase, "idle");
      h.adapter.endConversation(); h.adapter.startListening("tr", h.handlers); await waitWake(h); h.runner.setScore(0.9);
      const n = h.transcripts.length; now += 349; h.backend.push(); await drain(); assert.equal(h.transcripts.length, n);
      now += 1; h.backend.push(); await drain(); assert.equal(h.transcripts.length, n + 1);
    } finally { h.adapter.dispose(); Date.now = realNow; }
  });
  await scenario("already capturing does not re-wake on repeated acoustic frames", async () => {
    const h = harness(); h.adapter.startListening("tr", h.handlers); await waitWake(h); h.runner.setScore(0.9);
    h.backend.push(); await drain(); for (let i = 0; i < 5; i++) h.backend.push(0.2); await drain();
    assert.deepEqual(h.transcripts, ["AYAS"]); h.adapter.dispose();
  });

  // Existing single-shot fallback retains the last partial only on end; a partial
  // command never executes provisionally. Main acoustic path has no transcript.
  await scenario("browser partial-only and final wake each arrive once; near-match stays asleep", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const instances: Recognition[] = [];
    class Recognition {
      lang = ""; continuous = false; interimResults = false; maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null; onend: (() => void) | null = null;
      onerror = null; start() { instances.push(this); } abort() {} stop() {}
    }
    Object.defineProperty(globalThis, "window", { configurable: true, value: { SpeechRecognition: Recognition } });
    try {
      for (const [word, final] of [["AYAS", false], ["Ayas", true], ["ayaz", false]] as const) {
        const out: string[] = [], adapter = new BrowserVoiceAdapter();
        const handle = adapter.startListening("tr", { onFinalTranscript: (t) => out.push(t), onError() {}, onEnd() {} }, { singleShot: true });
        instances[instances.length - 1].onresult?.({ resultIndex: 0, results: [{ 0: { transcript: word }, isFinal: final }] });
        assert.equal(out.length, final ? 1 : 0); instances[instances.length - 1].onend?.();
        assert.deepEqual(out, [word]); assert.equal(detectAyasWakeWord(out[0]).woke, word !== "ayaz"); handle.stop();
      }
    } finally { if (descriptor) Object.defineProperty(globalThis, "window", descriptor); else Reflect.deleteProperty(globalThis, "window"); }
  });
  await scenario("speaking self-hearing stays blocked; explicit interrupt still re-arms", async () => {
    let handlers: AyasListenHandlers | null = null;
    const platform = { detectCapability: () => ({ stt: true, tts: true, sttCloudBacked: false }), listVoices: () => [], onVoicesChanged: () => () => {}, startListening: (_: string, h: AyasListenHandlers) => { handlers = h; return { stop() {} }; }, speak: (_: string, o: { onStart(): void }) => { o.onStart(); return { cancel() {} }; }, cancelSpeech() {} };
    let wakes = 0;
    const e = new AyasVoiceEngine(platform, { onStateChange() {}, onCommand() {}, onError() {}, onWake() { wakes++; }, onAutoplayBlocked() {} });
    try { e.enableListening(); const old = handlers!; e.speak("bir yanıt"); old.onFinalTranscript("AYAS"); assert.equal(wakes, 0); e.interruptSpeech(); assert.equal(e.state, "listening"); }
    finally { e.dispose(); }
  });

  const root = process.cwd(); const realAssets = ["bin/piper/piper.exe", "public/wake/ayas.onnx", "public/wake/embedding_model.onnx", "public/wake/melspectrogram.onnx"].every((p) => fs.existsSync(path.join(root, p)));
  const measurements: { text: string; leadMs: number; peak: number; hits: number; firstScoreMs: number }[] = [];
  if (realAssets) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-first-wake-real-"));
    try {
      fs.cpSync(path.join(root, "bin/piper"), path.join(work, "piper"), { recursive: true });
      const synth = (text: string) => {
        const raw = path.join(work, "raw.wav"), wav = path.join(work, "clip.wav");
        execFileSync(path.join(work, "piper/piper.exe"), ["--model", path.join(work, "piper/tr_TR-dfki-medium.onnx"), "--espeak_data", path.join(work, "piper/espeak-ng-data"), "--output_file", raw, "--noise_scale", "0", "--noise_w", "0"], { input: text, cwd: path.join(work, "piper"), stdio: ["pipe", "ignore", "ignore"] });
        execFileSync(process.env.AYAS_FFMPEG_PATH || "ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-i", raw, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { stdio: "ignore" });
        const b = fs.readFileSync(wav); let off = 12;
        while (off + 8 <= b.length) { const n = b.readUInt32LE(off + 4); if (b.toString("ascii", off, off + 4) === "data") { const pcm = new Float32Array(n / 2); for (let i = 0; i < pcm.length; i++) pcm[i] = b.readInt16LE(off + 8 + i * 2) / 32768; return pcm; } off += 8 + n + (n % 2); }
        throw new Error("missing-wav-pcm");
      };
      const models = { melspectrogramUrl: path.join(root, "public/wake/melspectrogram.onnx"), embeddingUrl: path.join(root, "public/wake/embedding_model.onnx"), wakewordUrl: path.join(root, "public/wake/ayas.onnx") };
      const pcmAyas = synth("AYAS");
      const measure = async (r: OpenWakeWordRunner, text: string, source: Float32Array, leadMs: number) => {
        const pcm = new Float32Array(Math.ceil((leadMs * 16 + source.length + 32000) / FRAME) * FRAME); pcm.set(source, leadMs * 16);
        const d = new WakeScoreDetector(); let hits = 0, peak = 0, firstScoreMs = -1;
        for (let i = 0; i < pcm.length; i += FRAME) { const s = await r.accept(pcm.subarray(i, i + FRAME)); if (s !== null) { if (firstScoreMs < 0) firstScoreMs = i / 16 + 80; peak = Math.max(peak, s); if (d.observe(s)) hits++; } }
        const m = { text, leadMs, peak, hits, firstScoreMs }; measurements.push(m); return m;
      };
      await scenario("REAL cold zero-lead control reproduces first utterance miss", async () => {
        const r = new OpenWakeWordRunner(models); try { await r.init(); const m = await measure(r, "AYAS_COLD", pcmAyas, 0); assert.equal(m.firstScoreMs, 2000); assert.equal(m.hits, 0); } finally { r.dispose(); }
      });
      for (let i = 0; i < 10; i++) await scenario(`REAL independent fresh first AYAS ${i + 1}/10`, async () => {
        const r = new OpenWakeWordRunner(models); try { await r.init(); await r.warmUp(); r.reset(); const m = await measure(r, "AYAS", pcmAyas, 0); assert.equal(m.firstScoreMs, 80); assert.ok(m.hits > 0); assert.equal(r.stats.dropped, 0); } finally { r.dispose(); }
      });
      await scenario("REAL reset/repeated wake and 0/80/320/700 ms onset boundaries", async () => {
        const r = new OpenWakeWordRunner(models); try { await r.init(); await r.warmUp(); for (const lead of [0, 80, 320, 700]) { r.reset(); assert.ok((await measure(r, "AYAS_REARM", pcmAyas, lead)).hits > 0); } } finally { r.dispose(); }
      });
      for (const text of ["yavaş", "hayat", "ayaz", "merhaba", "bugün hava çok güzel", "nasılsın", "saat kaç", "teşekkür ederim", "kapıyı kapat", "biraz sonra görüşürüz"]) await scenario(`REAL negative / near-match: ${text}`, async () => {
        const pcm = synth(text), r = new OpenWakeWordRunner(models); try { await r.init(); await r.warmUp(); const current = await measure(r, text, pcm, 0); const baseline = new OpenWakeWordRunner(models); try { await baseline.init(); const previous = await measure(baseline, `${text}_BASELINE`, pcm, 2000); assert.ok(Math.abs(previous.peak - current.peak) < 1e-6, "warm-up must not increase settled-model sensitivity"); } finally { baseline.dispose(); } assert.equal(current.hits, 0); } finally { r.dispose(); }
      });
      await scenario("REAL warm-up plus silence never wakes", async () => {
        const r = new OpenWakeWordRunner(models); try { await r.init(); await r.warmUp(); assert.equal((await measure(r, "SILENCE", new Float32Array(16000), 0)).hits, 0); } finally { r.dispose(); }
      });
    } finally {
      const resolved = path.resolve(work);
      assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("ayas-first-wake-real-"));
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
  console.log(JSON.stringify({ status: failures.length ? "FAIL" : "PASS", suite: "ayas-first-wake-reliability", scenarios: results.length + failures.length, results, failures, real: realAssets ? (failures.length ? "SYNTHETIC_ONNX_FAILURE" : "SYNTHETIC_ONNX_PASS") : "NOT_RUN_ASSETS_ABSENT", measurements, phone: "OWNER_ACTION_NOT_RUN" }));
  if (failures.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
