/** Versioned owner contract. Frozen V1 suites/evidence are untouched. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { AYAS_OWNER_WAKE_POLICY_V2 as V2, AYAS_OWNER_WAKE_POLICY_V3 as V3, normaliseOwnerWakeNamesV3 } from "../src/lib/ayas/voice/AyasWakePolicy";
import { detectAyasWakeWord, stripLeadingWakeWord, AYAS_WAKE_INTENT } from "../src/components/brain/ayasVoice";
import { AyasVoiceEngine, type AyasListenHandlers, type AyasVoicePlatform } from "../src/components/brain/voice/ayasVoiceEngine";
import { normaliseAyasTranscript, transcribeAyasAudio } from "../src/lib/ayas/stt/AyasSttService";

let scenarios = 0;
async function scenario(name: string, run: () => void | Promise<void>) { await run(); scenarios++; console.log(`PASS: ${name}`); }
function engineHarness() {
  let handlers: AyasListenHandlers | null = null;
  const commands: string[] = [];
  let wakes = 0;
  const platform: AyasVoicePlatform = {
    detectCapability: () => ({ stt: true, tts: false, sttCloudBacked: false }), listVoices: () => [], onVoicesChanged: () => () => {},
    startListening: (_language, h) => { handlers = h; return { stop() {} }; },
    speak: () => ({ cancel() {} }), cancelSpeech() {},
  };
  const engine = new AyasVoiceEngine(platform, { onStateChange() {}, onCommand: (text) => commands.push(text), onError() {}, onWake: () => wakes++, onAutoplayBlocked() {} }, { wakePolicy: V3 });
  engine.enableListening();
  return { engine, commands, get wakes() { return wakes; }, emit: (text: string) => { assert.ok(handlers); handlers.onFinalTranscript(text); } };
}
async function main() {
  for (const text of ["AYAS", "Ayas", "ayas", "AYAZ", "Ayaz", "ayaz", "HAYAS", "Hayas", "hayas"]) {
    await scenario(`V3 exact positive ${text}`, () => {
      const match = detectAyasWakeWord(text, V3);
      assert.equal(match.woke, true); assert.equal(match.intent, AYAS_WAKE_INTENT); assert.equal(match.command, "");
      assert.equal(stripLeadingWakeWord(`${text}, kaç proje var?`, V3), "kaç proje var");
      assert.equal(normaliseOwnerWakeNamesV3(text), "AYAS");
    });
    await scenario(`V3 engine positive ${text}`, () => { const h = engineHarness(); try { h.emit(`${text} kaç proje var`); assert.equal(h.wakes, 1); assert.deepEqual(h.commands, ["kaç proje var"]); } finally { h.engine.dispose(); } });
  }
  for (const text of ["HAYAZ", "hayaz", "ayaş", "aias", "ayes", "uyan", "aya", "atölye", "atolye", "hey ayas", "hey ayaz", "xayas", "ayasa", "ayaslı", "ayazlı", "AYAZ'ın", "AYAS’ın", "ayas_", "_ayas", "1ayas", "ayas1", "yavaş", "hayat", "ayak", "a", "ya", "ay", "as", "merhaba", "bugün AYAS hakkında konuşalım", "merhaba merhaba merhaba"]) {
    await scenario(`V3 negative ${text}`, () => {
      assert.equal(detectAyasWakeWord(text, V3).woke, false);
      const h = engineHarness(); try { h.emit(text); assert.equal(h.wakes, 0); assert.deepEqual(h.commands, []); } finally { h.engine.dispose(); }
    });
  }
  await scenario("V3 normalization preserves non-alias Unicode words and speech", () => {
    for (const text of ["hayaslı", "hayasa", "hayaz", "ayaş", "aias", "ayes", "ayaslı", "ayazlı", "AYAZ'ın", "AYAS’ın", "xayas", "_ayas", "ayas1"]) assert.equal(normaliseAyasTranscript(text, V3), text);
    assert.equal(normaliseAyasTranscript("Ayaz, projeleri göster", V3), "AYAS, projeleri göster");
    assert.equal(normaliseAyasTranscript("Grundtime çalışıyor", V3), "runtime çalışıyor");
  });
  await scenario("V1 is an explicit compatibility contract, never V3 acceptance", () => {
    assert.equal(detectAyasWakeWord("hayas", "legacy-v1").woke, true);
    assert.equal(normaliseAyasTranscript("hayas", "legacy-v1"), "AYAS");
    assert.equal(detectAyasWakeWord("hayas", V3).woke, true);
    assert.equal(normaliseAyasTranscript("hayas", V3), "AYAS");
  });
  await scenario("invalid policy fails closed", () => {
    const invalid = "unknown" as typeof V3;
    assert.equal(detectAyasWakeWord("AYAS", invalid).woke, false);
    assert.equal(normaliseAyasTranscript("AYAS", invalid), "");
  });
  await scenario("V2 HAYAS-negative contract remains reproducible", () => {
    assert.equal(detectAyasWakeWord("hayas", V2).woke, false);
    assert.equal(normaliseAyasTranscript("Hayas ne durumda", V2), "Hayas ne durumda");
  });
  for (const text of ["hayaslı", "hayasa", "hayasız", "hayas1", "1hayas", "hayas_", "_hayas", "HAYAS'ın", "HAYAS’ın", "xhayas", "hayasmerhaba", "hayas hayat"]) {
    await scenario(`V3 Unicode/exact boundary ${text}`, () => {
      const accepted = text === "hayas hayat";
      assert.equal(detectAyasWakeWord(text, V3).woke, accepted);
      assert.equal(normaliseAyasTranscript(text, V3), accepted ? "AYAS hayat" : text);
    });
  }
  await scenario("already awake non-wake command is ordinary command text", () => {
    const h = engineHarness(); try { h.emit("AYAZ"); assert.equal(h.wakes, 1); h.emit("hayat kelimesini açıkla"); assert.deepEqual(h.commands, ["hayat kelimesini açıkla"]); } finally { h.engine.dispose(); }
  });
  await scenario("production hook and authenticated STT route select V3 explicitly", () => {
    const hook = fs.readFileSync("src/components/brain/useAyasVoice.ts", "utf8"), route = fs.readFileSync("app/api/ayas/stt/route.ts", "utf8");
    assert.equal((hook.match(/wakePolicy: AYAS_OWNER_WAKE_POLICY_V3/g) ?? []).length, 2);
    assert.match(route, /transcribeAyasAudio\(audio, \{ config, thermalHold: ayasSttThermalHold, wakePolicy: AYAS_OWNER_WAKE_POLICY_V3 \}\)/);
  });
  for (const text of ["Ayaz kaç proje var", "Hayas ne durumda", "ayazlı bir gün", "ayaslı proje"]) {
    await scenario(`V3 STT service ${text}`, async () => {
      const config = { enabled: true, whisperExecutable: "C:/fake/whisper.exe", whisperModel: "C:/fake/model.bin", ffmpegPath: "ffmpeg", language: "tr", threads: 1, maxAudioBytes: 1000000, maxSeconds: 20, timeoutMs: 30000 };
      const result = await transcribeAyasAudio(new Uint8Array([82,73,70,70,0,0,0,0,87,65,86,69,0,0,0,0]), {
        config, wakePolicy: V3,
        run: async (_exe, args) => {
          if (args.includes("pcm_s16le")) fs.writeFileSync(args[args.length - 1], Buffer.alloc(44 + 96000));
          else fs.writeFileSync(`${args[args.indexOf("-of") + 1]}.json`, JSON.stringify({ transcription: [{ text }], result: { language: "tr" } }));
          return { code: 0, stdout: "", stderr: "", timedOut: false };
        },
      });
      assert.equal(result.ok, true); if (result.ok) assert.equal(result.text, normaliseAyasTranscript(text, V3));
    });
  }
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-wake-policy-v3-text", policy: V3, scenarios, acousticGate: "SEPARATE_REQUIRED", historicalPolicy: "AYAZ_AND_HAYAS_NEGATIVE_EVIDENCE_UNCHANGED", phone: "OWNER_ACTION_NOT_RUN" }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
