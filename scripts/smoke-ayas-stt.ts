/**
 * AYAS STT smoke suite (Voice Closure Sprint).
 *
 * Deterministic core (injected process runner) + an OPTIONAL real integration
 * test against a configured whisper.cpp binary + model + ffmpeg. The real test
 * is skipped (not failed) when the sidecar is not installed.
 *
 * Covers: config resolution (disabled by default), audio container sniffing,
 * the transcription state machine (size / type / thermal / decode / timeout /
 * empty), "AYAS" transcript normalisation, and — when installed — a real
 * Turkish transcription of a Piper-synthesised clip.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveAyasSttConfig, AYAS_STT_DEFAULTS } from "../src/lib/ayas/stt/AyasSttConfig";
import { sniffAudioContainer } from "../src/lib/ayas/stt/AyasSttAudio";
import { transcribeAyasAudio, normaliseAyasTranscript } from "../src/lib/ayas/stt/AyasSttService";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0, 0, 0, 0]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
const GARBAGE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

const enabledConfig = {
  enabled: true as const,
  whisperExecutable: "C:/fake/whisper-cli.exe",
  whisperModel: "C:/fake/model.bin",
  ffmpegPath: "ffmpeg",
  language: "tr",
  threads: 4,
  maxAudioBytes: 1_000_000,
  maxSeconds: 20,
  timeoutMs: 30_000,
};

/** A run() double: ffmpeg call → make a fake wav; whisper call → write the json. */
function fakeRun(opts: {
  decodeSeconds?: number;
  decodeFail?: boolean;
  whisperTimeout?: boolean;
  whisperFail?: boolean;
  transcript?: string;
  tokenProbs?: number[];
}) {
  return async (executable: string, args: readonly string[]) => {
    if (executable === enabledConfig.ffmpegPath || args.includes("pcm_s16le")) {
      if (opts.decodeFail) return { code: 1, stdout: "", stderr: "bad input", timedOut: false };
      const wavPath = args[args.length - 1];
      const seconds = opts.decodeSeconds ?? 3;
      fs.writeFileSync(wavPath, Buffer.alloc(44 + Math.round(seconds * 16000 * 2)));
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    }
    // whisper
    lastWhisperArgs = [...args];
    if (opts.whisperTimeout) return { code: null, stdout: "", stderr: "", timedOut: true };
    if (opts.whisperFail) return { code: 1, stdout: "", stderr: "whisper boom", timedOut: false };
    const ofIndex = args.indexOf("-of");
    const outBase = args[ofIndex + 1];
    const transcript = opts.transcript ?? " Ayaz kaç proje var";
    // -ojf (full) shape: per-token `p`. Emit tokens only when asked so the
    // "backward-compatible with plain -oj" path is also exercised.
    const tokens = opts.tokenProbs
      ? opts.tokenProbs.map((p, i) => ({ text: i === 0 ? transcript.trim().split(" ")[0] : "x", p }))
      : undefined;
    fs.writeFileSync(
      `${outBase}.json`,
      JSON.stringify({
        result: { language: "tr" },
        transcription: [{ text: transcript, ...(tokens ? { tokens } : {}) }],
      }),
    );
    return { code: 0, stdout: "", stderr: "", timedOut: false };
  };
}

let lastWhisperArgs: string[] = [];

async function run() {
  /* ---- config ---- */
  await scenario("config: disabled by default (no env)", () => {
    const c = resolveAyasSttConfig({});
    assert.equal(c.enabled, false);
    assert.match(c.reason ?? "", /not set/);
    assert.equal(c.language, "tr");
    assert.equal(c.maxAudioBytes, AYAS_STT_DEFAULTS.maxAudioBytes);
  });
  await scenario("config: disabled when the executable path does not exist", () => {
    const c = resolveAyasSttConfig({ AYAS_WHISPER_EXECUTABLE: "C:/nope/whisper.exe", AYAS_WHISPER_MODEL: "C:/nope/m.bin" });
    assert.equal(c.enabled, false);
    assert.match(c.reason ?? "", /not found/);
  });

  /* ---- audio sniffing ---- */
  await scenario("audio sniff: wav / webm / mp4 recognised, garbage rejected", () => {
    assert.equal(sniffAudioContainer(WAV)?.kind, "wav");
    assert.equal(sniffAudioContainer(WEBM)?.kind, "webm");
    assert.equal(sniffAudioContainer(MP4)?.kind, "mp4");
    assert.equal(sniffAudioContainer(GARBAGE), null);
    assert.equal(sniffAudioContainer(new Uint8Array(4)), null);
  });

  /* ---- normalisation ---- */
  await scenario("normalise: AYAS mis-hears mapped back", () => {
    assert.equal(normaliseAyasTranscript("Ayaz kaç proje var"), "AYAS kaç proje var");
    assert.equal(normaliseAyasTranscript("ayas, projeleri göster"), "AYAS, projeleri göster");
    assert.equal(normaliseAyasTranscript("hayas ne durumda"), "AYAS ne durumda");
    assert.equal(normaliseAyasTranscript("kaç proje var"), "kaç proje var"); // untouched
  });

  /* ---- service state machine (injected run) ---- */
  await scenario("service: not configured → stt-not-configured", async () => {
    const r = await transcribeAyasAudio(WAV, { config: resolveAyasSttConfig({}) });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.code, "stt-not-configured");
  });
  await scenario("service: empty audio → audio-empty", async () => {
    const r = await transcribeAyasAudio(new Uint8Array(0), { config: enabledConfig, run: fakeRun({}) });
    assert.equal(r.ok === false && r.code, "audio-empty");
  });
  await scenario("service: oversize audio → audio-too-large", async () => {
    const big = new Uint8Array(enabledConfig.maxAudioBytes + 1);
    big.set(WAV);
    const r = await transcribeAyasAudio(big, { config: enabledConfig, run: fakeRun({}) });
    assert.equal(r.ok === false && r.code, "audio-too-large");
  });
  await scenario("service: non-audio bytes → audio-unsupported", async () => {
    const r = await transcribeAyasAudio(GARBAGE, { config: enabledConfig, run: fakeRun({}) });
    assert.equal(r.ok === false && r.code, "audio-unsupported");
  });
  await scenario("service: thermal hold → thermal-hold, nothing spawned", async () => {
    let ran = false;
    const r = await transcribeAyasAudio(WAV, {
      config: enabledConfig,
      thermalHold: () => "GPU 61 °C ≥ 60 °C hard stop",
      run: async () => {
        ran = true;
        return { code: 0, stdout: "", stderr: "", timedOut: false };
      },
    });
    assert.equal(r.ok === false && r.code, "thermal-hold");
    assert.equal(ran, false);
  });
  await scenario("service: ffmpeg decode failure → decode-failed", async () => {
    const r = await transcribeAyasAudio(WAV, { config: enabledConfig, run: fakeRun({ decodeFail: true }) });
    assert.equal(r.ok === false && r.code, "decode-failed");
  });
  await scenario("service: whisper timeout → transcribe-timeout", async () => {
    const r = await transcribeAyasAudio(WAV, { config: enabledConfig, run: fakeRun({ whisperTimeout: true }) });
    assert.equal(r.ok === false && r.code, "transcribe-timeout");
  });
  await scenario("service: whisper crash → transcribe-failed (no throw)", async () => {
    const r = await transcribeAyasAudio(WAV, { config: enabledConfig, run: fakeRun({ whisperFail: true }) });
    assert.equal(r.ok === false && r.code, "transcribe-failed");
  });
  await scenario("service: happy path → ok, normalised text, RTF computed", async () => {
    const r = await transcribeAyasAudio(WAV, {
      config: enabledConfig,
      run: fakeRun({ decodeSeconds: 4, transcript: " Ayaz kaç proje var" }),
      now: (() => {
        let t = 0;
        return () => (t += 500);
      })(),
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.text, "AYAS kaç proje var");
      assert.equal(r.language, "tr");
      assert.equal(r.audioSeconds, 4);
      assert.ok(r.realTimeFactor >= 0);
      assert.equal(r.confidence, null); // plain -oj shape (no tokens) → null
    }
  });

  /* ---- Sprint 5 §7 — anti-hallucination guards + confidence ---- */
  await scenario("service: whisper argv carries the §7 hallucination guards", async () => {
    await transcribeAyasAudio(WAV, { config: enabledConfig, run: fakeRun({}) });
    const a = lastWhisperArgs;
    const pair = (flag: string) => a[a.indexOf(flag) + 1];
    assert.ok(a.includes("-tp") && pair("-tp") === "0", "-tp 0 (deterministic first pass)");
    assert.ok(a.includes("-mc") && pair("-mc") === "0", "-mc 0 (no cross-window text context)");
    assert.ok(a.includes("-sns"), "-sns (suppress non-speech tokens)");
    assert.ok(a.includes("-ojf"), "-ojf (full JSON with token probs)");
    assert.ok(!a.includes("-nf"), "temperature fallback stays enabled (no -nf)");
    assert.ok(!a.includes("-oj"), "plain -oj replaced by -ojf");
    const prompt = pair("--prompt");
    assert.equal(prompt, "AYAS, Atolye, Graphify.", "prompt trimmed to the three proper nouns");
  });
  await scenario("service: -ojf token probs → confidence { minTokenP, meanTokenP }", async () => {
    const r = await transcribeAyasAudio(WAV, {
      config: enabledConfig,
      run: fakeRun({ transcript: " Ayaz kaç proje var", tokenProbs: [0.9, 0.4, 0.8, 0.95] }),
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.ok(r.confidence, "confidence present");
      assert.equal(r.confidence?.minTokenP, 0.4);
      assert.equal(r.confidence?.meanTokenP, 0.763); // (0.9+0.4+0.8+0.95)/4 = 0.7625 → 0.763
    }
  });
  await scenario("service: punctuation-only tokens excluded from confidence", async () => {
    const r = await transcribeAyasAudio(WAV, {
      config: enabledConfig,
      // fakeRun marks non-first tokens as "x" (a letter) — inject a comma token
      // by hand via a transcript whose first word is punctuation.
      run: async (executable: string, args: readonly string[]) => {
        if (executable === enabledConfig.ffmpegPath || args.includes("pcm_s16le")) {
          fs.writeFileSync(args[args.length - 1], Buffer.alloc(44 + 3 * 16000 * 2));
          return { code: 0, stdout: "", stderr: "", timedOut: false };
        }
        const outBase = args[args.indexOf("-of") + 1];
        fs.writeFileSync(
          `${outBase}.json`,
          JSON.stringify({
            result: { language: "tr" },
            transcription: [
              { text: " Ayaz var", tokens: [
                { text: " Ay", p: 0.8 },
                { text: ",", p: 0.02 },
                { text: " var", p: 0.9 },
              ] },
            ],
          }),
        );
        return { code: 0, stdout: "", stderr: "", timedOut: false };
      },
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.confidence?.minTokenP, 0.8, "comma (p=0.02) ignored");
      assert.equal(r.confidence?.meanTokenP, 0.85);
    }
  });
  await scenario("service: blank transcript → empty-transcript", async () => {
    const r = await transcribeAyasAudio(WAV, { config: enabledConfig, run: fakeRun({ transcript: "   " }) });
    assert.equal(r.ok === false && r.code, "empty-transcript");
  });

  /* ---- OPTIONAL real integration ---- */
  const realExe = process.env.AYAS_WHISPER_EXECUTABLE;
  const realModel = process.env.AYAS_WHISPER_MODEL;
  const piperExe = path.resolve("bin/piper", process.platform === "win32" ? "piper.exe" : "piper");
  const piperVoice = path.resolve("bin/piper/tr_TR-dfki-medium.onnx");
  const realConfig = resolveAyasSttConfig(process.env);

  if (realConfig.enabled && fs.existsSync(piperExe) && fs.existsSync(piperVoice)) {
    await scenario("REAL: Piper Turkish clip → whisper transcript contains 'proje'", async () => {
      const work = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-stt-real-"));
      try {
        // Piper needs an ASCII working dir + explicit espeak data.
        const asciiPiper = path.join(work, "piper");
        fs.cpSync(path.resolve("bin/piper"), asciiPiper, { recursive: true });
        const clip = path.join(work, "clip.wav");
        execFileSync(path.join(asciiPiper, "piper.exe"), [
          "--model", path.join(asciiPiper, "tr_TR-dfki-medium.onnx"),
          "--espeak_data", path.join(asciiPiper, "espeak-ng-data"),
          "--output_file", clip,
        ], { input: "AYAS, atölyede kaç proje var?", cwd: asciiPiper, timeout: 60_000 });
        const audio = new Uint8Array(fs.readFileSync(clip));
        const r = await transcribeAyasAudio(audio, { config: realConfig });
        assert.equal(r.ok, true, r.ok ? "" : `stt failed: ${JSON.stringify(r)}`);
        if (r.ok) {
          assert.match(r.text.toLowerCase(), /proje/, `transcript: "${r.text}"`);
          assert.ok(r.confidence && r.confidence.minTokenP > 0, "real -ojf run surfaces token confidence");
          console.log(
            `   real transcript: "${r.text}"  (${r.audioSeconds}s audio, ${r.processingMs}ms, RTF ${r.realTimeFactor}, ` +
              `conf min ${r.confidence?.minTokenP} / mean ${r.confidence?.meanTokenP})`,
          );
        }
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
    });
  } else {
    console.log(`   SKIP real integration (AYAS_WHISPER_EXECUTABLE=${realExe ? "set" : "unset"}, model=${realModel ? "set" : "unset"}, config.enabled=${realConfig.enabled})`);
  }

  console.log(`AYAS STT smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-stt", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
