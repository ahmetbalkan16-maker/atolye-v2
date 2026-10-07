/** Owner policy V3 synthetic qualification; never real-human or phone acceptance.
 * Keep the original first-wake suite, model weights and detector unchanged.
 * Missing assets and any false wake are failures, never skipped/expected-fail.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { OpenWakeWordRunner } from "../src/components/brain/voice/wake/openWakeWordRunner";
import { WakeScoreDetector } from "../src/components/brain/voice/wakeWordVoiceAdapter";

const FRAME = 1280;
const root = process.cwd();
const modelIndex = process.argv.indexOf('--model');
const modelFile = modelIndex >= 0 ? path.resolve(process.argv[modelIndex + 1]) : path.join(root, 'public/wake/ayas.onnx');
const prototype = modelIndex >= 0;
const models = {
  melspectrogramUrl: path.join(root, "public/wake/melspectrogram.onnx"),
  embeddingUrl: path.join(root, "public/wake/embedding_model.onnx"),
  wakewordUrl: modelFile,
};
const failures: string[] = [];
const checks: { name: string; status: "PASS" | "FAIL" }[] = [];
const measurements: Awaited<ReturnType<typeof measure>>[] = [];
function check(name: string, ok: boolean) {
  checks.push({ name, status: ok ? "PASS" : "FAIL" });
  if (!ok) failures.push(name);
  console.error(`${ok ? "PASS" : "FAIL"}: ${name}`);
}
async function measure(text: string, kind: string, source: Float32Array, baseline = false) {
  const runner = new OpenWakeWordRunner(models);
  const lead = baseline ? 32000 : 0;
  const pcm = new Float32Array(Math.ceil((lead + source.length + 32000) / FRAME) * FRAME);
  pcm.set(source, lead);
  const detector = new WakeScoreDetector();
  const scores: number[] = [];
  let decisions = 0, firstDecisionMs: number | null = null, firstScoreMs: number | null = null;
  const started = performance.now();
  try {
    await runner.init();
    const warmStart = performance.now();
    if (!baseline) await runner.warmUp();
    const warmUpMs = performance.now() - warmStart;
    runner.reset();
    for (let off = 0; off < pcm.length; off += FRAME) {
      const score = await runner.accept(pcm.subarray(off, off + FRAME));
      if (score === null) continue;
      if (firstScoreMs === null) firstScoreMs = off / 16 + 80;
      scores.push(score);
      if (detector.observe(score)) {
        decisions++;
        if (firstDecisionMs === null) firstDecisionMs = off / 16 + 80 - lead / 16;
      }
    }
    assert.equal(runner.stats.dropped, 0);
    return {
      text, kind, baseline, samples: source.length,
      pcmSha256: createHash("sha256").update(Buffer.from(source.buffer, source.byteOffset, source.byteLength)).digest("hex"),
      peak: Math.max(0, ...scores), decisions, firstScoreMs, firstDecisionMs,
      hardFrames: scores.filter((s) => s >= 0.7).length,
      softFrames: scores.filter((s) => s >= 0.6).length,
      scoreArea: scores.reduce((a, b) => a + b, 0), scores,
      warmUpMs, totalMs: performance.now() - started,
    };
  } finally { runner.dispose(); }
}
function decodeWav(wav: string) {
  const b = fs.readFileSync(wav);
  for (let off = 12; off + 8 <= b.length;) {
    const n = b.readUInt32LE(off + 4);
    if (b.toString("ascii", off, off + 4) === "data") {
      const pcm = new Float32Array(n / 2);
      for (let i = 0; i < pcm.length; i++) pcm[i] = b.readInt16LE(off + 8 + i * 2) / 32768;
      return pcm;
    }
    off += 8 + n + n % 2;
  }
  throw new Error("missing-wav-pcm");
}
function noise(amplitude: number) {
  let seed = 0x51a7;
  return Float32Array.from({ length: 32000 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 0x100000000 * 2 - 1) * amplitude;
  });
}
async function main() {
  for (const file of [...Object.values(models), path.join(root, "bin/piper/piper.exe")]) assert.ok(fs.existsSync(file), `required asset: ${file}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-ayaz-qualification-"));
  try {
    fs.cpSync(path.join(root, "bin/piper"), path.join(work, "piper"), { recursive: true });
    const synth = (text: string, deterministic: boolean) => {
      const raw = path.join(work, "raw.wav"), wav = path.join(work, "clip.wav");
      execFileSync(path.join(work, "piper/piper.exe"), [
        "--model", path.join(work, "piper/tr_TR-dfki-medium.onnx"),
        "--espeak_data", path.join(work, "piper/espeak-ng-data"), "--output_file", raw,
        ...(deterministic ? ["--noise_scale", "0", "--noise_w", "0"] : []),
      ], { input: text, cwd: path.join(work, "piper"), windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
      execFileSync(process.env.AYAS_FFMPEG_PATH || "ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-i", raw, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { windowsHide: true, stdio: "ignore" });
      return decodeWav(wav);
    };
    for (const text of ['AYAS', 'AYAZ', 'HAYAS']) {
      const positive = synth(text, true);
      for (let i = 1; i <= 10; i++) {
        const m = await measure(text, `deterministic-independent-${i}`, positive); measurements.push(m);
        check(`first-wake independent ${text} ${i}/10`, m.decisions > 0 && m.firstScoreMs === 80);
      }
    }
    for (let i = 1; i <= 10; i++) {
      for (const text of ["AYAS", "AYAZ", "HAYAS"]) {
        const pcm = synth(text, false);
        const m = await measure(text, `stochastic-pair-${i}`, pcm);
        const b = await measure(text, `stochastic-pair-${i}`, pcm, true);
        measurements.push(m, b);
        check(`stochastic pair ${i} ${text}`, m.decisions > 0);
        check(`same-PCM baseline/candidate ${i} ${text}`, Math.abs(b.peak - m.peak) < 1e-6 && b.decisions === m.decisions);
      }
    }
    for (const text of ["merhaba", "teşekkür ederim", "kapıyı kapat", "bugün hava çok güzel", "nasılsın", "saat kaç", "yavaş", "hayat", "beyaz", "yaz", "ayak", "ayran", "hayaz", "a", "ya", "ay", "as", "merhaba merhaba merhaba", "hayat hayat hayat", "HAYAZ", "ayazlı", "ayaslı", "ayasa", "hayaslı", "hayasa", "hayasız", "ayasız", "HAYAZ HAYAZ HAYAZ"]) {
      const m = await measure(text, "additional-negative", synth(text, true));
      measurements.push(m); check(`additional negative: ${text}`, m.decisions === 0);
    }
    for (const [text, pcm] of [
      ["silence", new Float32Array(32000)], ["noise-low", noise(0.01)], ["noise-medium", noise(0.1)],
      ["noise-loud", noise(0.5)],
    ] as const) {
      const m = await measure(text, "additional-negative", pcm);
      measurements.push(m); check(`additional negative: ${text}`, m.decisions === 0);
    }
    const digest = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    console.log(JSON.stringify({
      status: failures.length ? "FAIL" : "PASS", suite: "ayas-wake-policy-v3-acoustic", policy: "owner-v3", previousPolicy: "AYAZ/HAYAS-negative historical evidence unchanged", prototype, modelFile, checks, failures,
      scenarios: checks.length, measurements,
      assets: [...Object.values(models), path.join(root, "bin/piper/tr_TR-dfki-medium.onnx")].map((file) => ({ file: path.relative(root, file), sha256: digest(file) })),
      synthesis: "one existing Turkish Piper voice; independent sessions reuse one deterministic AYAS PCM; stochastic pairs use freshly generated PCM per utterance",
      thresholds: "UNCHANGED", productionChange: prototype ? "NOT_DEPLOYED_PROTOTYPE" : "V3_TEXT_BINDING_ONLY", phone: "OWNER_ACTION_NOT_RUN",
    }));
    if (failures.length) process.exitCode = 1;
  } finally {
    const resolved = path.resolve(work);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("ayas-ayaz-qualification-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
