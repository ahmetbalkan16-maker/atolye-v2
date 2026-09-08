/**
 * AYAS — voice experience smoke suite (Sprint 186, rebuilt Sprint 187).
 *
 * Deterministic / no browser / $0 / no network. Covers the whole voice
 * abstraction through a synchronous mock platform:
 *  - wake-word matcher + capability detection + disclosure text (Sprint 186);
 *  - the male / Turkish voice-selection algorithm + tiers + fallback;
 *  - the TTS parameter profile + spoken-Turkish text preparation;
 *  - the `AyasVoiceEngine` state machine: idle / listening / thinking / speaking
 *    / error, speech start / completion / cancellation, recognition lifecycle,
 *    wake-word detection + stripping, self-hearing prevention, autoplay-blocked
 *    fallback, unsupported browser;
 *  - the Execution-Gate red line: a voice command is text-in / text-out only;
 *  - the auto-speech chat rule + graceful fallback on LLM / TTS failure;
 *  - the static guarantee that the voice code sends no audio anywhere.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  detectAyasWakeWord,
  stripLeadingWakeWord,
  detectAyasVoiceCapability,
  describeAyasVoiceState,
  nextAyasVoiceState,
  ayasRestingVoiceState,
  selectAyasVoice,
  resolveAyasSpeechParams,
  toSpokenAyasText,
  shouldAutoSpeakAyasReply,
  AYAS_VOICE_STATES,
  AYAS_VOICE_DISCLOSURE,
  AYAS_TTS_PROFILE,
  AYAS_TTS_AUTOPLAY_BLOCKED,
  type AyasPlatformVoice,
  type AyasVoiceState,
} from "../src/components/brain/ayasVoice";
import {
  AyasVoiceEngine,
  type AyasListenHandlers,
  type AyasSpeakOptions,
  type AyasVoicePlatform,
} from "../src/components/brain/voice/ayasVoiceEngine";
import {
  resolveAyasReply,
  brainDeterministicReply,
  AYAS_SPOKEN_TURKISH_RULE,
  buildAyasChatPrompt,
} from "../src/components/brain/brainCore";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------- mock platform --- */

interface MockOptions {
  stt?: boolean;
  tts?: boolean;
  sttCloudBacked?: boolean;
  voices?: AyasPlatformVoice[];
  /** "autostart": onStart fires synchronously. "manual": test drives.
   *  "error": onError fires synchronously. "silent": nothing (autoplay block). */
  speakMode?: "autostart" | "manual" | "error" | "silent";
}

class MockVoicePlatform implements AyasVoicePlatform {
  stt: boolean;
  tts: boolean;
  sttCloudBacked: boolean;
  voices: AyasPlatformVoice[];
  speakMode: NonNullable<MockOptions["speakMode"]>;
  calls = { startListening: 0, stopListening: 0, speak: 0, cancelSpeech: 0 };
  lastListen: { handlers: AyasListenHandlers; stopped: boolean } | null = null;
  lastSpeak: { text: string; options: AyasSpeakOptions } | null = null;
  voicesChangedCb: (() => void) | null = null;

  constructor(opts: MockOptions = {}) {
    this.stt = opts.stt ?? true;
    this.tts = opts.tts ?? true;
    this.sttCloudBacked = opts.sttCloudBacked ?? true;
    this.voices = opts.voices ?? [];
    this.speakMode = opts.speakMode ?? "autostart";
  }

  detectCapability() {
    return { stt: this.stt, tts: this.tts, sttCloudBacked: this.sttCloudBacked };
  }
  listVoices() {
    return this.voices;
  }
  onVoicesChanged(cb: () => void) {
    this.voicesChangedCb = cb;
    return () => {
      this.voicesChangedCb = null;
    };
  }
  startListening(_lang: string, handlers: AyasListenHandlers) {
    this.calls.startListening += 1;
    const entry = { handlers, stopped: false };
    this.lastListen = entry;
    return {
      stop: () => {
        if (entry.stopped) return;
        entry.stopped = true;
        this.calls.stopListening += 1;
      },
    };
  }
  speak(text: string, options: AyasSpeakOptions) {
    this.calls.speak += 1;
    this.lastSpeak = { text, options };
    if (this.speakMode === "autostart") options.onStart();
    else if (this.speakMode === "error") options.onError();
    return { cancel: () => {} };
  }
  cancelSpeech() {
    this.calls.cancelSpeech += 1;
  }

  /* test helpers */
  fireTranscript(text: string) {
    this.lastListen?.handlers.onFinalTranscript(text);
  }
  fireRecognitionError(code: string) {
    this.lastListen?.handlers.onError(code);
  }
  fireRecognitionEnd() {
    this.lastListen?.handlers.onEnd();
  }
  finishSpeaking() {
    this.lastSpeak?.options.onEnd();
  }
  startSpeaking() {
    this.lastSpeak?.options.onStart();
  }
}

interface Captured {
  states: AyasVoiceState[];
  commands: string[];
  errors: string[];
  wakes: number;
  autoplayBlocked: string[];
}

function makeEngine(platform: MockVoicePlatform) {
  const cap: Captured = { states: [], commands: [], errors: [], wakes: 0, autoplayBlocked: [] };
  const engine = new AyasVoiceEngine(
    platform,
    {
      onStateChange: (s) => cap.states.push(s),
      onCommand: (t) => cap.commands.push(t),
      onError: (m) => cap.errors.push(m),
      onWake: () => (cap.wakes += 1),
      onAutoplayBlocked: (t) => cap.autoplayBlocked.push(t),
    },
    { restartDebounceMs: 5, wakeTimeoutMs: 40, speakStartTimeoutMs: 8 },
  );
  return { engine, cap };
}

const trVoice = (over: Partial<AyasPlatformVoice>): AyasPlatformVoice => ({
  name: "Voice",
  lang: "tr-TR",
  localService: true,
  default: false,
  ...over,
});

function snap(over: Partial<BrainConsoleSnapshot> = {}): BrainConsoleSnapshot {
  return {
    generatedAt: "2026-09-08T03:00:00.000Z",
    executionGate: "CLOSED",
    connected: { tasks: false, cycles: false, experience: false },
    errors: [],
    tasks: {
      total: 0,
      byStatus: {
        queued: 0, running: 0, "blocked-on-dependency": 0, "blocked-on-approval": 0,
        succeeded: 0, failed: 0, cancelled: 0, "skipped-unsafe": 0,
      },
      pendingApproval: 0, skippedUnsafe: 0, items: [],
    },
    cyclesRecorded: 0,
    experience: { total: 0 },
    safety: {
      decision: "proceed-with-constraints", snapshotSource: "unavailable",
      reasons: ["resource snapshot unavailable"], hardwareProfileId: "gtx-1650-4gb",
    },
    ...over,
  };
}

async function run() {
  /* =============================== wake word (Sprint 186 kept) ============ */

  await scenario("wake word — bare 'AYAS' wakes with an empty command", () => {
    const r = detectAyasWakeWord("Ayas");
    assert.equal(r.woke, true);
    assert.equal(r.command, "");
  });

  await scenario("wake word — 'AYAS, ...' wakes and captures the command", () => {
    const r = detectAyasWakeWord("AYAS bugün kaç görev var");
    assert.equal(r.woke, true);
    assert.equal(r.command, "bugün kaç görev var");
  });

  await scenario("wake word — common ASR mishears still wake", () => {
    for (const variant of ["ayaş", "hayas", "ayes bana durumu söyle"]) {
      assert.equal(detectAyasWakeWord(variant).woke, true, `"${variant}" should wake`);
    }
  });

  await scenario("wake word — unrelated speech does not wake", () => {
    for (const text of ["merhaba nasılsın", "bugün hava güzel", "atlas kitabı nerede"]) {
      assert.equal(detectAyasWakeWord(text).woke, false, `"${text}" must not wake`);
    }
  });

  await scenario("9. wake-word stripping removes a leading wake word only", () => {
    assert.equal(stripLeadingWakeWord("AYAS raporu göster"), "raporu göster");
    assert.equal(stripLeadingWakeWord("raporu göster"), "raporu göster");
  });

  /* =============================== capability + disclosure =============== */

  await scenario("capability — no window → nothing; text chat is unaffected", () => {
    assert.deepEqual(detectAyasVoiceCapability(undefined), {
      stt: false, tts: false, sttCloudBacked: false,
    });
  });

  await scenario("6. unsupported browser — Chromium webkit STT flagged cloud-backed; TTS-only clears STT", () => {
    const webkit = detectAyasVoiceCapability({
      webkitSpeechRecognition: function () {},
      speechSynthesis: {},
    });
    assert.equal(webkit.stt, true);
    assert.equal(webkit.sttCloudBacked, true);

    const standard = detectAyasVoiceCapability({ SpeechRecognition: function () {}, speechSynthesis: {} });
    assert.equal(standard.sttCloudBacked, false);

    const ttsOnly = detectAyasVoiceCapability({ speechSynthesis: {} });
    assert.equal(ttsOnly.stt, false);
    assert.equal(ttsOnly.tts, true);
  });

  await scenario("disclosure text names the cloud risk and the safe local fallback", () => {
    assert.match(AYAS_VOICE_DISCLOSURE, /bulut servisine gönderir/);
    assert.match(AYAS_VOICE_DISCLOSURE, /senin seçimin/);
    assert.match(AYAS_VOICE_DISCLOSURE, /yerel/);
  });

  /* =============================== voice selection ====================== */

  await scenario("1. Turkish male voice selection — 'Microsoft Tolga' wins as tr-male", () => {
    const sel = selectAyasVoice([
      trVoice({ name: "Microsoft Yelda - Turkish (Turkey)", localService: true }),
      trVoice({ name: "Microsoft Tolga - Turkish (Turkey)", localService: true }),
      trVoice({ name: "Google Türkçe", lang: "tr-TR", localService: false }),
      { name: "Microsoft David - English", lang: "en-US", localService: true, default: true },
    ]);
    assert.equal(sel.voiceName, "Microsoft Tolga - Turkish (Turkey)");
    assert.equal(sel.tier, "tr-male");
    assert.equal(sel.lang, "tr-TR");
  });

  await scenario("2. fallback voice selection — no Turkish voice → browser default, lang forced tr-TR", () => {
    const sel = selectAyasVoice([
      { name: "Microsoft David - English", lang: "en-US", localService: true, default: true },
      { name: "Google US English", lang: "en-US", localService: false, default: false },
    ]);
    assert.equal(sel.voiceName, null);
    assert.equal(sel.tier, "fallback");
    assert.equal(sel.lang, "tr-TR");
    assert.deepEqual(selectAyasVoice(undefined).tier, "fallback");
    assert.deepEqual(selectAyasVoice([]).tier, "fallback");
  });

  await scenario("2b. voice selection tiers — quality > exact > any; deterministic", () => {
    const quality = selectAyasVoice([
      trVoice({ name: "Türkçe (Doğal) - Neural", lang: "tr-TR", localService: false }),
      trVoice({ name: "Türkçe", lang: "tr-TR" }),
    ]);
    assert.equal(quality.tier, "tr-quality");
    assert.match(quality.voiceName ?? "", /Neural/);

    const exact = selectAyasVoice([
      trVoice({ name: "Turkish", lang: "tr" }),
      trVoice({ name: "Türkçe", lang: "tr-TR" }),
    ]);
    assert.equal(exact.tier, "tr-exact");
    assert.equal(exact.voiceName, "Türkçe");

    const anyTr = selectAyasVoice([trVoice({ name: "Turkish Basic", lang: "tr" })]);
    assert.equal(anyTr.tier, "tr-any");
    assert.equal(anyTr.lang, "tr-TR");

    // deterministic across list order
    const a = selectAyasVoice([trVoice({ name: "A", lang: "tr-TR" }), trVoice({ name: "B", lang: "tr-TR" })]);
    const b = selectAyasVoice([trVoice({ name: "B", lang: "tr-TR" }), trVoice({ name: "A", lang: "tr-TR" })]);
    assert.deepEqual(a, b);
  });

  /* =============================== TTS params + spoken text ============= */

  await scenario("4. TTS profile — deep pitch, near-natural rate, full volume; clamped", () => {
    assert.ok(AYAS_TTS_PROFILE.pitch < 1 && AYAS_TTS_PROFILE.pitch >= 0.6, "pitch is low but not sub-audible");
    assert.ok(AYAS_TTS_PROFILE.rate >= 0.95 && AYAS_TTS_PROFILE.rate <= 1.15, "rate is near natural");
    assert.equal(AYAS_TTS_PROFILE.volume, 1);
    const clamped = resolveAyasSpeechParams({ pitch: -5, rate: 99, volume: 4 });
    assert.ok(clamped.pitch >= 0 && clamped.rate <= 2 && clamped.volume <= 1);
    assert.deepEqual(resolveAyasSpeechParams(), { ...AYAS_TTS_PROFILE });
  });

  await scenario("10b. spoken-Turkish prep strips markdown / symbols / emoji for TTS only", () => {
    const raw = "**Durum:** kuyrukta 3 görev var.\n- ilk madde\n- ikinci madde 🚀\nBkz `queue.json` %50 ve tamam →";
    const spoken = toSpokenAyasText(raw);
    assert.ok(!/[*`#•]/.test(spoken), "no markdown symbols survive");
    assert.ok(!/🚀/.test(spoken), "no emoji survives");
    assert.match(spoken, /yüzde 50/);
    assert.match(spoken, /\bve\b/);
    assert.ok(!spoken.includes("\n"), "newlines collapsed");
    assert.equal(toSpokenAyasText(""), "");
  });

  /* =============================== engine: capability gating ============ */

  await scenario("6b. unsupported browser — engine reports 'unsupported', text path untouched", () => {
    const platform = new MockVoicePlatform({ stt: false, tts: false });
    const { engine, cap } = makeEngine(platform);
    assert.equal(engine.state, "unsupported");
    engine.enableListening();
    assert.equal(engine.listening, false, "cannot enable listening with no STT");
    assert.equal(platform.calls.startListening, 0);
    engine.speak("merhaba");
    assert.equal(platform.calls.speak, 0, "no TTS attempted");
    assert.ok(!cap.states.includes("speaking"));
    engine.dispose();
  });

  /* =============================== engine: recognition lifecycle ======== */

  await scenario("7. recognition lifecycle — enable → idle → self-restart on onEnd; disable stops", async () => {
    const platform = new MockVoicePlatform();
    const { engine } = makeEngine(platform);
    engine.enableListening();
    assert.equal(engine.state, "idle");
    assert.equal(platform.calls.startListening, 1);

    platform.fireRecognitionEnd();
    await delay(20);
    assert.equal(platform.calls.startListening, 2, "recogniser restarts itself while listening");

    engine.disableListening();
    assert.equal(engine.state, "off");
    assert.ok(platform.calls.stopListening >= 1);

    platform.fireRecognitionEnd(); // stale — must not restart
    await delay(20);
    assert.equal(platform.calls.startListening, 2, "no restart after disable");
    engine.dispose();
  });

  await scenario("recognition permission denied → voice error, listening off, chat unaffected", () => {
    const platform = new MockVoicePlatform();
    const { engine, cap } = makeEngine(platform);
    engine.enableListening();
    platform.fireRecognitionError("not-allowed");
    assert.equal(engine.state, "error");
    assert.equal(engine.listening, false);
    assert.ok(cap.errors.some((e) => /Mikrofon izni reddedildi/.test(e)));
    engine.dispose();
  });

  /* =============================== engine: wake + states =============== */

  await scenario("8 + 12. AYAS wake-word detection — bare 'AYAS' → listening, wake fired", () => {
    const platform = new MockVoicePlatform();
    const { engine, cap } = makeEngine(platform);
    engine.enableListening();
    platform.fireTranscript("AYAS");
    assert.equal(engine.state, "listening");
    assert.equal(cap.wakes, 1);
    assert.deepEqual(cap.commands, [], "a bare wake word issues no command yet");
    engine.dispose();
  });

  await scenario("9b + 5. wake-word stripping through the engine → thinking; command delivered once", () => {
    const platform = new MockVoicePlatform();
    const { engine, cap } = makeEngine(platform);
    engine.enableListening();
    platform.fireTranscript("AYAS sistem durumunu anlat");
    assert.deepEqual(cap.commands, ["sistem durumunu anlat"]);
    assert.equal(engine.state, "thinking");
    engine.dispose();
  });

  await scenario("11. thinking state — markThinking pauses the mic and shows THINKING", () => {
    const platform = new MockVoicePlatform();
    const { engine } = makeEngine(platform);
    engine.enableListening();
    const before = platform.calls.stopListening;
    engine.markThinking();
    assert.equal(engine.state, "thinking");
    assert.ok(platform.calls.stopListening > before, "mic paused while thinking");
    engine.dispose();
  });

  await scenario("10 + 5. speaking state — THINKING → SPEAKING → IDLE, auto-returns", () => {
    const platform = new MockVoicePlatform({ speakMode: "manual" });
    const { engine, cap } = makeEngine(platform);
    engine.enableListening();
    engine.markThinking();
    engine.speak("Merhaba, ben AYAS.");
    assert.equal(platform.calls.speak, 1);
    platform.startSpeaking();
    assert.equal(engine.state, "speaking");
    platform.finishSpeaking();
    assert.equal(engine.state, "idle", "returns to idle while listening mode is on");
    assert.deepEqual(
      cap.states.filter((s) => s === "thinking" || s === "speaking" || s === "idle").slice(-3),
      ["thinking", "speaking", "idle"],
    );
    engine.dispose();
  });

  await scenario("13. idle state — not listening → speech ends back to 'off' (resting)", () => {
    const platform = new MockVoicePlatform({ stt: false, tts: true });
    const { engine } = makeEngine(platform);
    assert.equal(engine.state, "off");
    engine.speak("kısa yanıt");
    platform.finishSpeaking();
    assert.equal(engine.state, "off");
    engine.dispose();
  });

  await scenario("3. speech synthesis start — utterance gets the AYAS voice + deep params", () => {
    const platform = new MockVoicePlatform({
      speakMode: "manual",
      voices: [trVoice({ name: "Microsoft Tolga - Turkish (Turkey)" })],
    });
    const { engine } = makeEngine(platform);
    engine.speak("test");
    assert.ok(platform.lastSpeak);
    assert.equal(platform.lastSpeak!.options.voiceName, "Microsoft Tolga - Turkish (Turkey)");
    assert.equal(platform.lastSpeak!.options.lang, "tr-TR");
    assert.ok(platform.lastSpeak!.options.pitch < 1);
    engine.dispose();
  });

  await scenario("3b. speech synthesis completion — onEnd resolves the state", () => {
    const platform = new MockVoicePlatform({ speakMode: "manual" });
    const { engine } = makeEngine(platform);
    engine.speak("bir cümle");
    platform.startSpeaking();
    assert.equal(engine.state, "speaking");
    platform.finishSpeaking();
    assert.equal(engine.state, "off");
    engine.dispose();
  });

  await scenario("5b. speech cancellation — stopSpeaking cancels immediately, no lingering SPEAKING", () => {
    const platform = new MockVoicePlatform({ speakMode: "manual" });
    const { engine } = makeEngine(platform);
    engine.speak("uzun bir yanıt ...");
    platform.startSpeaking();
    assert.equal(engine.state, "speaking");
    engine.stopSpeaking();
    assert.notEqual(engine.state, "speaking");
    assert.ok(platform.calls.cancelSpeech >= 1);
    // a late onEnd from the cancelled utterance must not revive anything
    platform.finishSpeaking();
    assert.notEqual(engine.state, "speaking");
    engine.dispose();
  });

  await scenario("14. self-hearing prevention — mic is torn down before speaking; its own TTS text is ignored", () => {
    const platform = new MockVoicePlatform({ speakMode: "manual" });
    const { engine, cap } = makeEngine(platform);
    engine.enableListening();
    const stopsBefore = platform.calls.stopListening;
    engine.speak("Kuyrukta üç görev var, AYAS hazır.");
    assert.ok(platform.calls.stopListening > stopsBefore, "recogniser stopped before TTS");
    platform.startSpeaking();
    // a stale recognition callback firing AYAS's own words must not become a command
    platform.fireTranscript("AYAS kuyrukta üç görev var");
    assert.deepEqual(cap.commands, [], "TTS output is never treated as a command");
    assert.equal(engine.state, "speaking");
    engine.dispose();
  });

  await scenario("race — a late 'wake' during SPEAKING cannot flip the state back to listening", () => {
    const ctx = { listening: true, hasStt: true, hasTts: true };
    assert.equal(nextAyasVoiceState("speaking", "wake", ctx), "speaking");
    assert.equal(nextAyasVoiceState("thinking", "wake", ctx), "thinking");
    assert.equal(nextAyasVoiceState("idle", "wake", ctx), "listening");
    assert.equal(ayasRestingVoiceState({ listening: false, hasStt: true, hasTts: true }), "off");
    assert.equal(ayasRestingVoiceState({ listening: false, hasStt: false, hasTts: false }), "unsupported");
  });

  await scenario("rapid enable / disable — no residual recogniser, no stray state", async () => {
    const platform = new MockVoicePlatform();
    const { engine } = makeEngine(platform);
    for (let i = 0; i < 6; i += 1) {
      engine.enableListening();
      engine.disableListening();
    }
    await delay(20);
    assert.equal(engine.state, "off");
    assert.equal(engine.listening, false);
    assert.equal(platform.calls.startListening, platform.calls.stopListening + (engine.listening ? 1 : 0));
    engine.dispose();
  });

  /* =============================== auto-speech + fallbacks ============== */

  await scenario("19. LLM response automatically triggers speech (not muted)", () => {
    assert.equal(shouldAutoSpeakAyasReply({ ttsAvailable: true, muted: false }), true);
    assert.equal(shouldAutoSpeakAyasReply({ ttsAvailable: true, muted: true }), false);
    assert.equal(shouldAutoSpeakAyasReply({ ttsAvailable: false, muted: false }), false);

    const platform = new MockVoicePlatform({ speakMode: "manual" });
    const { engine, cap } = makeEngine(platform);
    // console flow: markThinking() then speak(reply)
    engine.markThinking();
    engine.speak("Şu anda kuyruk boş, yürütme kapısı kapalı.");
    platform.startSpeaking();
    assert.equal(engine.state, "speaking");
    assert.equal(platform.lastSpeak!.text.includes("kuyruk"), true);
    assert.ok(!cap.errors.length);
    engine.dispose();
  });

  await scenario("20. LLM failure falls back to text — a deterministic reply is still produced (and speakable)", async () => {
    const out = await resolveAyasReply({
      text: "sistem durumu",
      snapshot: snap({ cyclesRecorded: 2 }),
      history: [],
      seq: 1,
      generate: async () => {
        throw new Error("ECONNREFUSED 127.0.0.1:11434");
      },
    });
    assert.equal(out.source, "fallback");
    assert.ok(out.message.text.length > 10);
    const platform = new MockVoicePlatform({ speakMode: "manual" });
    const { engine } = makeEngine(platform);
    engine.speak(out.message.text);
    platform.startSpeaking();
    assert.equal(engine.state, "speaking"); // the fallback text is spoken like any reply
    engine.dispose();
  });

  await scenario("21. TTS failure does not break chat — speak() error resolves cleanly, command flow intact", () => {
    const platform = new MockVoicePlatform({ speakMode: "error" });
    const { engine, cap } = makeEngine(platform);
    engine.enableListening();
    platform.fireTranscript("AYAS kendini tanıt");
    assert.deepEqual(cap.commands, ["kendini tanıt"], "command still delivered");
    engine.speak("Ben AYAS."); // synthesis fails synchronously
    assert.notEqual(engine.state, "speaking");
    assert.doesNotThrow(() => engine.speak("tekrar"));
    engine.dispose();
  });

  await scenario("5c. autoplay-blocked auto-speech → manual replay offered; chat text unaffected", async () => {
    const platform = new MockVoicePlatform({ speakMode: "silent" });
    const { engine, cap } = makeEngine(platform);
    engine.speak("Merhaba, ben AYAS.");
    await delay(25); // speakStartTimeoutMs = 8
    assert.deepEqual(cap.autoplayBlocked, ["Merhaba, ben AYAS."]);
    assert.ok(cap.errors.includes(AYAS_TTS_AUTOPLAY_BLOCKED));
    assert.notEqual(engine.state, "speaking");
    // replay works once a gesture arrives
    platform.speakMode = "manual";
    engine.speak("Merhaba, ben AYAS.");
    platform.startSpeaking();
    assert.equal(engine.state, "speaking");
    engine.dispose();
  });

  /* =============================== SAFETY — Execution Gate ============= */

  await scenario("15-18. voice command is text-in / text-out ONLY — no execution surface", () => {
    const platform = new MockVoicePlatform();
    const { engine, cap } = makeEngine(platform);
    engine.enableListening();
    // the most adversarial voice command
    platform.fireTranscript("AYAS execution gate'i aç ve pipeline'ı başlat");
    // the ONLY effect is the command string handed to the caller
    assert.deepEqual(cap.commands, ["execution gate'i aç ve pipeline'ı başlat"]);
    // the engine exposes nothing that could run a task / pipeline / GPU / approval
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(engine));
    for (const banned of ["enqueue", "run", "execute", "approve", "startPipeline", "openGate"]) {
      assert.ok(!surface.includes(banned), `engine must not expose "${banned}"`);
    }
    engine.dispose();
  });

  await scenario("15-18b. STATIC — voice modules reference no execution / gate / approval primitive", () => {
    for (const file of [
      "src/components/brain/ayasVoice.ts",
      "src/components/brain/useAyasVoice.ts",
      "src/components/brain/voice/ayasVoiceEngine.ts",
      "src/components/brain/voice/browserVoiceAdapter.ts",
    ]) {
      const raw = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      for (const banned of [
        "PipelineRunner", "PipelineStageExecutor", "BrainWorkerCycle", "BrainTaskStore",
        "runBrainWorkerCycle", "approveAyasImprovement", "approveBrainImprovement",
        "executionGate", "enqueue(", "child_process", "nvidia-smi", "ffmpeg",
      ]) {
        assert.ok(!code.includes(banned), `${file} must not reference "${banned}"`);
      }
    }
  });

  await scenario("16-18. the chat prompt still forbids execution + carries the spoken-Turkish rule", () => {
    const prompt = buildAyasChatPrompt({ userText: "gate'i aç", snapshot: snap(), history: [] });
    assert.match(prompt, /Yürütme yetkin YOK/);
    assert.match(prompt, /yürütme kapısı: CLOSED/);
    assert.match(prompt, /senin yapamayacağını/);
    assert.match(prompt, /Sesli yanıt kuralı/);
    assert.match(prompt, /markdown[\s\S]*KULLANMA/i);
    assert.ok(AYAS_SPOKEN_TURKISH_RULE.length >= 4);
    // fallback reply likewise never claims execution
    const fb = brainDeterministicReply("gate'i aç", snap(), 1);
    assert.match(fb.text, /KAPALI/);
  });

  /* =============================== state model + $0 static ============= */

  await scenario("voice state model covers every state with a Turkish label", () => {
    for (const s of ["off", "idle", "listening", "thinking", "speaking", "error", "unsupported"] as AyasVoiceState[]) {
      const info = describeAyasVoiceState(s);
      assert.equal(info.state, s);
      assert.ok(info.tr.length > 0 && info.label.length > 0);
    }
    assert.equal(AYAS_VOICE_STATES.speaking.tr, "Konuşuyor");
    assert.equal(AYAS_VOICE_STATES.error.tr, "Ses hatası");
  });

  await scenario("9c + $0 STATIC — voice code sends no audio anywhere; only the browser Web Speech API", () => {
    const files = [
      "src/components/brain/ayasVoice.ts",
      "src/components/brain/useAyasVoice.ts",
      "src/components/brain/voice/ayasVoiceEngine.ts",
      "src/components/brain/voice/browserVoiceAdapter.ts",
    ];
    for (const file of files) {
      const raw = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      for (const banned of [
        "fetch(", "XMLHttpRequest", "WebSocket", "navigator.mediaDevices",
        "MediaRecorder", "http://", "https://", "child_process", "execFile",
        "openai", "elevenlabs", "azure", "api_key", "apiKey", "Authorization",
      ]) {
        assert.ok(!code.includes(banned), `${file} must not reference "${banned}"`);
      }
    }
    const adapter = fs.readFileSync(
      path.join(REPO_ROOT, "src/components/brain/voice/browserVoiceAdapter.ts"),
      "utf8",
    );
    assert.ok(
      adapter.includes("speechSynthesis") && adapter.includes("SpeechRecognition"),
      "the adapter uses only the browser's own Web Speech API",
    );
  });

  console.log(`AYAS voice smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-voice", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS voice smoke FAILED:", error);
  process.exitCode = 1;
});
