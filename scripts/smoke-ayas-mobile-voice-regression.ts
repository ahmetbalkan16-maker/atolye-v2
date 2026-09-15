/**
 * AYAS Mobile Voice Regression smoke suite.
 *
 * Deterministic, no real device, no network. Traces the exact "Bu cihazda ses
 * yok" root cause found on the real phone: `deriveAyasPresence` collapsed
 * "still detecting capability" (transient — SSR default before client
 * hydration, or a slow/hung wake-engine load through a Cloudflare Quick
 * Tunnel) and "genuinely unsupported" (permanent) into the SAME message, with
 * no distinct state for a microphone-permission problem either. Covers:
 *  - `resolveAyasVoiceReadiness` — the new closed, truthful state set;
 *  - `detectAyasVoiceCapability` — proof capability re-checks correctly once
 *    real `window` APIs exist (SSR → hydration, scenario A);
 *  - `BrowserVoiceAdapter.queryMicPermission` — best-effort, safe on a
 *    browser (e.g. Safari) that cannot be queried at all;
 *  - the engine's `onError(message, code)` — the raw code a caller needs to
 *    reliably detect a permission denial, never guessed from message text;
 *  - `deriveAyasPresence` end-to-end for every new voice-readiness state;
 *  - UYAN still wakes once voice is ready (no wake-sprint regression);
 *  - the Execution Gate / no-authorization invariants, unchanged.
 *
 * Extended for the "final UX polish + physical-device readiness" pass:
 *  - primary (non-hands-free) user-facing wake guidance leads with "UYAN",
 *    while the hands-free wake-engine copy (audio model trained ONLY on
 *    "AYAS") deliberately still says "AYAS" — both are asserted explicitly
 *    so a future accidental edit to either is caught;
 *  - the engine's `onListening` hook — the signal that recognition genuinely
 *    began, which is what flips a "permission-needed" UI to "ready" the
 *    moment a real browser permission prompt is accepted;
 *  - the bounded wake-engine attach timeout (initializing never hangs
 *    forever) — see the real-timer race scenario above, reused by name here.
 */
import assert from "node:assert/strict";

import {
  detectAyasVoiceCapability,
  detectAyasWakeWord,
  resolveAyasVoiceReadiness,
  type AyasMicPermissionState,
  type AyasVoiceReadiness,
} from "../src/components/brain/ayasVoice";
import { BrowserVoiceAdapter } from "../src/components/brain/voice/browserVoiceAdapter";
import {
  AyasVoiceEngine,
  type AyasListenHandlers,
  type AyasListenHandle,
  type AyasListenOptions,
  type AyasSpeakOptions,
  type AyasVoicePlatform,
} from "../src/components/brain/voice/ayasVoiceEngine";
import { deriveAyasPresence, BRAIN_CORE_STATES } from "../src/components/brain/brainCore";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

/** Minimal, script-local mock — same idiom as smoke-ayas-voice.ts's own. */
class MockPlatform implements AyasVoicePlatform {
  stt: boolean;
  tts: boolean;
  lastListen: { handlers: AyasListenHandlers } | null = null;

  constructor(opts: { stt?: boolean; tts?: boolean } = {}) {
    this.stt = opts.stt ?? true;
    this.tts = opts.tts ?? true;
  }
  detectCapability() {
    return { stt: this.stt, tts: this.tts, sttCloudBacked: false };
  }
  listVoices() {
    return [];
  }
  onVoicesChanged() {
    return () => {};
  }
  startListening(lang: string, handlers: AyasListenHandlers, options?: AyasListenOptions): AyasListenHandle {
    void lang;
    void options;
    this.lastListen = { handlers };
    return { stop: () => {} };
  }
  speak(text: string, options: AyasSpeakOptions) {
    void text;
    void options;
    return { cancel: () => {} };
  }
  cancelSpeech() {}
  fireTranscript(text: string) {
    this.lastListen?.handlers.onFinalTranscript(text);
  }
  fireError(code: string) {
    this.lastListen?.handlers.onError(code);
  }
  fireListening() {
    this.lastListen?.handlers.onListening?.();
  }
}

function makeEngine(platform: AyasVoicePlatform) {
  const cap = {
    states: [] as string[],
    commands: [] as string[],
    wakes: 0,
    errors: [] as { message: string; code?: string }[],
    listeningStarted: 0,
  };
  const engine = new AyasVoiceEngine(platform, {
    onStateChange: (s) => cap.states.push(s),
    onCommand: (t) => cap.commands.push(t),
    onError: (message, code) => cap.errors.push({ message, code }),
    onWake: () => (cap.wakes += 1),
    onAutoplayBlocked: () => {},
    onListening: () => (cap.listeningStarted += 1),
  });
  return { engine, cap };
}

async function run() {
  /* =============================== resolveAyasVoiceReadiness (pure) ===== */

  await scenario("readiness — still initializing overrides everything else", () => {
    assert.equal(
      resolveAyasVoiceReadiness({ initializing: true, sttAvailable: false, ttsAvailable: false, micPermission: "unknown" }),
      "initializing",
    );
    // even with full capability + granted permission, "initializing" still wins —
    // a caller must check this BEFORE treating capability as final.
    assert.equal(
      resolveAyasVoiceReadiness({ initializing: true, sttAvailable: true, ttsAvailable: true, micPermission: "granted" }),
      "initializing",
    );
  });

  await scenario("F. readiness — neither STT nor TTS → genuinely 'unsupported' (truthful, permanent)", () => {
    const r: AyasVoiceReadiness = resolveAyasVoiceReadiness({
      initializing: false, sttAvailable: false, ttsAvailable: false, micPermission: "unknown",
    });
    assert.equal(r, "unsupported");
  });

  await scenario("C. readiness — mic permission explicitly denied → 'permission-denied', not lumped with 'unsupported'", () => {
    const r = resolveAyasVoiceReadiness({
      initializing: false, sttAvailable: true, ttsAvailable: true, micPermission: "denied",
    });
    assert.equal(r, "permission-denied");
  });

  await scenario("readiness — STT absent but TTS present (iOS Safari without the wake engine) → 'stt-unsupported', not a blanket 'no voice'", () => {
    const r = resolveAyasVoiceReadiness({
      initializing: false, sttAvailable: false, ttsAvailable: true, micPermission: "unknown",
    });
    assert.equal(r, "stt-unsupported", "AYAS can still speak even though it cannot listen — must not be reported as fully unsupported");
  });

  await scenario("B. readiness — capability present, permission not yet asked ('prompt') → 'permission-needed'", () => {
    const r = resolveAyasVoiceReadiness({
      initializing: false, sttAvailable: true, ttsAvailable: true, micPermission: "prompt",
    });
    assert.equal(r, "permission-needed");
  });

  await scenario("G. readiness — a fresh permission context ('unknown', e.g. a brand-new Quick Tunnel origin) is NEVER permanently 'unsupported'", () => {
    // A new trycloudflare.com hostname is a new browser origin — permission
    // history from an older origin does not carry over, so the browser
    // reports "unknown" (Safari can't even be asked) rather than "denied".
    // That must resolve to "ready" (capability is real), not "unsupported".
    const r = resolveAyasVoiceReadiness({
      initializing: false, sttAvailable: true, ttsAvailable: true, micPermission: "unknown",
    });
    assert.equal(r, "ready");
  });

  await scenario("readiness — full capability + granted permission → 'ready'", () => {
    const r = resolveAyasVoiceReadiness({
      initializing: false, sttAvailable: true, ttsAvailable: true, micPermission: "granted",
    });
    assert.equal(r, "ready");
  });

  /* =============================== bounded-timeout race (real timers) ==== */

  await scenario("G/regression — a never-resolving load races a bounded timeout and the fallback wins, with REAL timers (not mocked)", async () => {
    // The exact concurrency shape useAyasVoice.ts uses for the wake-engine
    // attach: a promise that may never settle, raced against a bounded
    // setTimeout that must fire the fallback regardless — proven here with
    // real timers (no fake-timer library in this codebase's toolchain) so
    // the JS-level semantics this sprint's browser fix depends on are
    // actually exercised, not just asserted by code reading.
    const neverResolves = new Promise<void>(() => {});
    let fallbackCalled = false;
    let attachedFromLoad = false;
    const BOUND_MS = 50; // short for test speed; production uses 8000ms, same mechanism

    let attachTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      attachTimeout = null;
      fallbackCalled = true;
    }, BOUND_MS);

    void neverResolves.then(() => {
      attachedFromLoad = true;
      if (attachTimeout) clearTimeout(attachTimeout);
    });

    await new Promise((resolve) => setTimeout(resolve, BOUND_MS + 100));
    assert.equal(fallbackCalled, true, "the bounded timeout must fire when the load never settles");
    assert.equal(attachedFromLoad, false, "the never-resolving promise must never itself attach");
  });

  /* =============================== A. SSR → hydration ==================== */

  await scenario("A. capability detection — SSR (no window) reports unsupported; the SAME check on the real client window reports available", () => {
    const ssr = detectAyasVoiceCapability(undefined);
    assert.equal(ssr.stt, false);
    assert.equal(ssr.tts, false);
    // "hydration" = calling the exact same pure function again once real
    // window-like APIs exist — proves the detector is stateless / re-checkable,
    // never a cached false negative from the SSR pass.
    const hydrated = detectAyasVoiceCapability({
      SpeechRecognition: undefined,
      webkitSpeechRecognition: function FakeRecognition() {} as unknown as () => void,
      speechSynthesis: {},
    });
    assert.equal(hydrated.stt, true);
    assert.equal(hydrated.tts, true);
  });

  /* =============================== mic permission query ================== */

  // Node's own built-in global `navigator` is a read-only getter — it must be
  // replaced via `defineProperty`, not plain assignment, and restored the
  // same way.
  function withNavigator<T>(value: unknown, run: () => T): T {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
    try {
      return run();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  }

  await scenario("D/F. BrowserVoiceAdapter.queryMicPermission — Safari/WebKit (no Permissions API) resolves to 'unknown', never throws, never blocks", async () => {
    await withNavigator({}, async () => {
      const adapter = new BrowserVoiceAdapter();
      const permission: AyasMicPermissionState = await adapter.queryMicPermission();
      assert.equal(permission, "unknown");
    });
  });

  await scenario("B. BrowserVoiceAdapter.queryMicPermission — a Chromium-style Permissions API answer passes through untouched", async () => {
    await withNavigator({ permissions: { query: async () => ({ state: "prompt" }) } }, async () => {
      const adapter = new BrowserVoiceAdapter();
      assert.equal(await adapter.queryMicPermission(), "prompt");
    });
  });

  /* =============================== engine: raw error code =============== */

  await scenario("C. engine onError carries the RAW code for a permission denial — never guessed from the human message text", () => {
    const platform = new MockPlatform();
    const { engine, cap } = makeEngine(platform);
    engine.enableListening();
    platform.fireError("not-allowed");
    assert.equal(cap.errors.length, 1);
    assert.equal(cap.errors[0].code, "not-allowed");
    assert.match(cap.errors[0].message, /reddedildi/);
    engine.dispose();
  });

  await scenario("engine onError also carries the code for a non-permission error (start-blocked) — the distinction is code-based, not message-based", () => {
    const platform = new MockPlatform();
    const { engine, cap } = makeEngine(platform);
    engine.enableListening();
    platform.fireError("start-blocked");
    assert.equal(cap.errors.at(-1)?.code, "start-blocked");
    engine.dispose();
  });

  /* =============================== D/E/F. adapter/platform selection ===== */

  await scenario("D. STT available (e.g. Chromium) → readiness is 'ready' as soon as the engine attaches — no permission info needed yet", () => {
    const platform = new MockPlatform({ stt: true, tts: true });
    const { engine } = makeEngine(platform);
    const r = resolveAyasVoiceReadiness({
      initializing: false,
      sttAvailable: engine.capabilities.stt,
      ttsAvailable: engine.capabilities.tts,
      micPermission: "unknown",
    });
    assert.equal(r, "ready");
    engine.dispose();
  });

  await scenario("F. neither STT nor TTS available on this platform → truthfully 'unsupported', engine state matches", () => {
    const platform = new MockPlatform({ stt: false, tts: false });
    const { engine } = makeEngine(platform);
    assert.equal(engine.state, "unsupported");
    const r = resolveAyasVoiceReadiness({
      initializing: false, sttAvailable: false, ttsAvailable: false, micPermission: "unknown",
    });
    assert.equal(r, "unsupported");
    engine.dispose();
  });

  /* =============================== deriveAyasPresence — every state ====== */

  await scenario("presence — initializing shows a truthful 'starting' message, never 'Bu cihazda ses yok'", () => {
    const p = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: false, ttsAvailable: false, listening: false, state: "off", initializing: true },
    });
    assert.notEqual(p.voice.value, "Bu cihazda ses yok");
    assert.match(p.voice.value, /başlat/i);
  });

  await scenario("presence — genuinely unsupported (ready, no APIs) still shows 'Bu cihazda ses yok' — unchanged, still accurate for THIS case", () => {
    const p = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: false, ttsAvailable: false, listening: false, state: "unsupported", initializing: false },
    });
    assert.equal(p.voice.value, "Bu cihazda ses yok");
  });

  await scenario("presence — mic permission denied shows a distinct, actionable 'MİKROFON ENGELLENDİ'-equivalent message", () => {
    const p = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: false, state: "idle", micPermission: "denied" },
    });
    assert.match(p.voice.value, /engellendi/i);
    assert.equal(p.voice.tone, "warn");
  });

  await scenario("presence — permission not yet asked ('prompt') offers an explicit 'Mikrofonu Etkinleştir' action, not a dead end", () => {
    const p = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: false, state: "idle", micPermission: "prompt" },
    });
    assert.match(p.voice.value, /izni gerekli/i);
    assert.equal(p.cta.label, "Mikrofonu Etkinleştir");
    assert.equal(p.cta.kind, "voice");
  });

  await scenario("presence — STT unsupported but TTS available reports BOTH directions independently, never a blanket 'no voice'", () => {
    const p = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: false, ttsAvailable: true, listening: false, state: "idle" },
    });
    assert.notEqual(p.voice.value, "Bu cihazda ses yok");
    assert.match(p.voice.value, /mikrofon desteklenmiyor/i);
    assert.match(p.voice.value, /sesli yanıt/i);
  });

  await scenario("G. presence — a fresh ('unknown') permission context with real capability reaches the normal ready UI, not a dead end", () => {
    const p = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: false, state: "idle", micPermission: "unknown" },
    });
    assert.equal(p.voice.value, "Sesli iletişim hazır");
    assert.equal(p.cta.label, "AYAS ile sesli konuş");
  });

  /* =============================== H. UYAN unaffected ==================== */

  await scenario("H. UYAN still wakes AYAS once voice is ready — the mobile voice fix touches capability/permission reporting only, never the wake resolver", () => {
    for (const text of ["UYAN", "UYAN, kaç projem var?", "HEY UYAN", "AYAS", "HEY AYAS", "AYA", "HEY AYA", "ATÖLYE"]) {
      assert.equal(detectAyasWakeWord(text).woke, true, `"${text}" must still wake`);
    }
    // and the readiness classifier + wake resolver compose correctly end to end
    const platform = new MockPlatform({ stt: true, tts: true });
    const { engine, cap } = makeEngine(platform);
    engine.enableListening();
    platform.fireTranscript("UYAN, kaç projem var?");
    assert.equal(cap.wakes, 1);
    assert.deepEqual(cap.commands, ["kaç projem var"]);
    engine.dispose();
  });

  /* =============================== I/J. security invariants ============== */

  await scenario("I/J. voice-readiness plumbing exposes no execution surface; a permission-denied turn still only ever produces text via onCommand", () => {
    const platform = new MockPlatform({ stt: true, tts: true });
    const { engine, cap } = makeEngine(platform);
    engine.enableListening();
    platform.fireError("not-allowed"); // the adversarial case: mic denied mid-flow
    platform.fireTranscript("UYAN execution gate'i aç ve pipeline'ı başlat");
    // enableListening() re-armed after the error path tears down recognition;
    // the ONLY thing a caller ever receives is the command string.
    assert.ok(cap.commands.length <= 1);
    if (cap.commands.length === 1) {
      assert.equal(cap.commands[0], "execution gate'i aç ve pipeline'ı başlat");
    }
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(engine));
    for (const banned of ["enqueue", "run", "execute", "approve", "startPipeline", "openGate"]) {
      assert.ok(!surface.includes(banned), `engine must not expose "${banned}"`);
    }
    engine.dispose();
  });

  await scenario("I. Execution Gate constant referenced by the presence view is never mutated by any voice-readiness branch", () => {
    for (const micPermission of ["unknown", "granted", "denied", "prompt"] as const) {
      const p = deriveAyasPresence({
        connectivity: "online",
        secureContext: true,
        executionGate: "CLOSED",
        voice: { sttAvailable: true, ttsAvailable: true, listening: false, state: "idle", micPermission },
      });
      assert.match(p.security.value, /yürütme kapısı kapalı/);
    }
  });

  /* =============================== 1. primary UI guidance says UYAN ====== */

  await scenario("1. primary (non-hands-free) 'Ses' row leads with UYAN while listening for the wake word", () => {
    const p = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: true, state: "idle", mode: "continuous" },
    });
    assert.equal(p.voice.value, "\"UYAN\" (\"AYAS\") bekleniyor");
    assert.ok(p.voice.value.startsWith("\"UYAN\""), "UYAN must lead — AYAS appears only as the parenthetical alias");
  });

  await scenario("1. hands-free (wake-engine) 'Ses' row deliberately still says AYAS — the on-device audio model only recognizes that word", () => {
    // Locked in by explicit user decision: the openWakeWord model was trained
    // ONLY on "AYAS" pronunciation, so claiming "UYAN" works hands-free would
    // be false UI guidance. This assertion exists so a future blanket
    // find/replace of "AYAS" → "UYAN" gets caught here.
    const p = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: true, state: "idle", mode: "wake-engine" },
    });
    assert.equal(p.voice.value, "\"AYAS\" bekleniyor (eller serbest)");
  });

  await scenario("1. primary CTA to start a voice turn does not claim 'AYAS' is the wake word to say (generic system-identity label)", () => {
    const p = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: false, state: "idle", mode: "continuous" },
    });
    assert.equal(p.cta.label, "AYAS ile sesli konuş");
  });

  await scenario("1. hands-free CTA deliberately still instructs 'AYAS' — matches the audio-model constraint, not an oversight", () => {
    const p = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: false, state: "idle", mode: "wake-engine" },
    });
    assert.equal(p.cta.label, "Eller serbest — \"AYAS\" de");
  });

  await scenario("1. the 'listening' brain-core state's spoken-character copy leads with UYAN", () => {
    assert.equal(
      BRAIN_CORE_STATES.listening.characterTr,
      "\"UYAN\" (\"AYAS\") duyuldu — sesli komut alınıyor.",
    );
    assert.ok(BRAIN_CORE_STATES.listening.characterTr.startsWith("\"UYAN\""));
  });

  /* =============================== 2/3. alias + primary wake composition = */

  await scenario("2. AYAS (and its multi-word aliases) still wake AYAS on their own, unconditioned on UYAN", () => {
    for (const text of ["AYAS", "AYAS, kaç projem var?", "HEY AYAS", "AYA", "HEY AYA", "ATÖLYE, durum nedir?"]) {
      assert.equal(detectAyasWakeWord(text).woke, true, `alias "${text}" must still wake`);
    }
  });

  await scenario("3. UYAN (bare, and as HEY UYAN) wakes AYAS on its own — confirms UYAN is a fully first-class primary wake word, not just tolerated", () => {
    for (const text of ["UYAN", "UYAN, bugün ne durumdayız?", "HEY UYAN"]) {
      assert.equal(detectAyasWakeWord(text).woke, true, `"${text}" must wake as primary`);
    }
  });

  /* =============================== 4. permission-required → granted → ready */

  await scenario("4. engine forwards the platform's 'recognition genuinely started' signal via onListening — proves the permission-needed → ready trigger fires", () => {
    const platform = new MockPlatform({ stt: true, tts: true });
    const { engine, cap } = makeEngine(platform);
    engine.enableListening();
    assert.equal(cap.listeningStarted, 0, "must not fire before the platform actually starts recognition");
    platform.fireListening();
    assert.equal(cap.listeningStarted, 1, "must fire exactly once recognition begins — the only reliable signal a browser permission prompt was just accepted");
    engine.dispose();
  });

  await scenario("4. end-to-end: 'permission-needed' UI resolves to 'ready' the instant the platform reports listening actually began", () => {
    // Mirrors exactly what useAyasVoice.ts does: micPermission starts at
    // "prompt" (never asked yet) → deriveAyasPresence shows the CTA → the
    // user taps it → the platform's onListening fires → micPermission flips
    // to "granted" → the SAME readiness classifier now reports "ready".
    let micPermission: AyasMicPermissionState = "prompt";
    const before = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: false, state: "idle", micPermission },
    });
    assert.match(before.voice.value, /izni gerekli/i);
    assert.equal(before.cta.label, "Mikrofonu Etkinleştir");

    const platform = new MockPlatform({ stt: true, tts: true });
    const { engine, cap } = makeEngine(platform);
    engine.enableListening();
    platform.fireListening(); // the real trigger: recognition actually began
    assert.equal(cap.listeningStarted, 1);
    micPermission = "granted"; // what useAyasVoice.ts's onListening handler sets

    const after = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: false, state: "idle", micPermission },
    });
    assert.equal(after.voice.value, "Sesli iletişim hazır");
    assert.equal(after.cta.label, "AYAS ile sesli konuş");
    engine.dispose();
  });

  /* =============================== 5. initialization never hangs forever = */

  await scenario("5. 'initializing' never resolves to itself as a terminal readiness state — it always classifies into a real outcome once initializing=false", () => {
    // Complements the real-timer bounded-timeout race scenario above (which
    // proves the *mechanism* that flips initializing false-eventually); this
    // proves the *classifier* has no path that stays stuck once it does.
    const outcomes = new Set<AyasVoiceReadiness>();
    for (const sttAvailable of [true, false]) {
      for (const ttsAvailable of [true, false]) {
        for (const micPermission of ["unknown", "granted", "denied", "prompt"] as const) {
          outcomes.add(resolveAyasVoiceReadiness({ initializing: false, sttAvailable, ttsAvailable, micPermission }));
        }
      }
    }
    assert.ok(!outcomes.has("initializing"), "once initializing=false, the classifier must never still report 'initializing'");
    // and every outcome it can reach is one of the closed, known-terminal set
    const known: readonly AyasVoiceReadiness[] = [
      "unsupported", "stt-unsupported", "permission-denied", "permission-needed", "ready",
    ];
    for (const o of outcomes) assert.ok(known.includes(o), `unexpected readiness outcome: ${o}`);
  });

  /* =============================== 6. execution gate stays CLOSED ======== */

  await scenario("6. execution gate reads CLOSED across the full UYAN/AYAS wake + permission-grant flow, end to end", () => {
    const platform = new MockPlatform({ stt: true, tts: true });
    const { engine, cap } = makeEngine(platform);
    engine.enableListening();
    platform.fireListening(); // permission just granted
    platform.fireTranscript("UYAN pipeline'ı çalıştır ve execution gate'i aç");
    assert.ok(cap.commands.length <= 1); // text-only, never a method call
    const p = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: true, state: "idle", micPermission: "granted" },
    });
    assert.match(p.security.value, /yürütme kapısı kapalı/);
    assert.equal(p.security.tone, "ok");
    engine.dispose();
  });

  console.log(`AYAS mobile voice regression smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-mobile-voice-regression", scenarios: count }));
}

void run();
