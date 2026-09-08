/**
 * AYAS — voice helpers (Sprint 186, extended Sprint 187). Pure, no DOM, no React.
 *
 * This module is the platform-agnostic core of the AYAS voice experience:
 *  - the voice state machine (`AyasVoiceState` + `nextAyasVoiceState`);
 *  - the wake-word matcher (`detectAyasWakeWord`, `stripLeadingWakeWord`);
 *  - browser capability detection (`detectAyasVoiceCapability`);
 *  - the male / Turkish voice-selection algorithm (`selectAyasVoice`);
 *  - the TTS parameter profile (`AYAS_TTS_PROFILE`, `resolveAyasSpeechParams`);
 *  - spoken-Turkish text preparation for TTS (`toSpokenAyasText`).
 *
 * The stateful orchestration lives in `voice/ayasVoiceEngine.ts` (also pure —
 * platform-independent, so it can move to a phone / native / always-on node
 * later) and the browser wiring in `voice/browserVoiceAdapter.ts`. No new
 * provider, no API key, no audio ever sent by us to an external service.
 *
 * IMPORTANT browser reality (surfaced in the UI + the sprint report):
 *  - `speechSynthesis` (AYAS speaking) runs locally in the browser — safe.
 *  - `SpeechRecognition` (hearing "AYAS") is only implemented in Chromium
 *    browsers as `webkitSpeechRecognition`, and that implementation streams
 *    audio to the browser vendor's cloud service. It is therefore OFF by
 *    default and only starts after an explicit, informed user opt-in.
 *  - A true always-on OS wake word is not possible from a web page (the tab
 *    must be focused and mic permission granted). "Wake word" here means: while
 *    voice mode is on, saying "AYAS" flips AYAS into active listening.
 */

export type AyasVoiceState =
  | "off"        // voice mode disabled
  | "idle"       // voice mode on, waiting for the wake word
  | "listening"  // woke — capturing a command
  | "thinking"   // command sent to the model
  | "speaking"   // AYAS is reading its reply aloud
  | "error"      // a recoverable voice error (mic denied, synthesis failed, …)
  | "unsupported"; // this browser has no SpeechRecognition

export interface AyasVoiceStateInfo {
  readonly state: AyasVoiceState;
  readonly label: string;
  readonly tr: string;
}

export const AYAS_VOICE_STATES: Readonly<Record<AyasVoiceState, AyasVoiceStateInfo>> = Object.freeze({
  off: { state: "off", label: "Voice off", tr: "Ses kapalı" },
  idle: { state: "idle", label: "Waiting for \"AYAS\"", tr: "\"AYAS\" bekleniyor" },
  listening: { state: "listening", label: "Listening", tr: "Dinliyor" },
  thinking: { state: "thinking", label: "Thinking", tr: "Düşünüyor" },
  speaking: { state: "speaking", label: "Speaking", tr: "Konuşuyor" },
  error: { state: "error", label: "Voice error", tr: "Ses hatası" },
  unsupported: { state: "unsupported", label: "Voice unavailable", tr: "Ses bu tarayıcıda yok" },
});

export function describeAyasVoiceState(state: AyasVoiceState): AyasVoiceStateInfo {
  return AYAS_VOICE_STATES[state] ?? AYAS_VOICE_STATES.off;
}

/* ------------------------------------------------------------------------- *
 * Wake-word matcher (pure)
 * ------------------------------------------------------------------------- */

/** Common ASR spellings/mishears of the wake word "AYAS". */
const WAKE_VARIANTS = ["ayas", "ayaş", "aias", "hayas", "ayes"];

export interface AyasWakeMatch {
  readonly woke: boolean;
  /** The command text that followed the wake word (may be empty — a bare "AYAS"). */
  readonly command: string;
}

function normalize(text: string): string {
  return String(text ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[.,!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does this transcript contain the wake word? If so, return whatever the user
 * said after it as `command`. Deterministic.
 */
export function detectAyasWakeWord(transcript: string): AyasWakeMatch {
  const words = normalize(transcript).split(" ").filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    if (WAKE_VARIANTS.includes(words[i])) {
      return { woke: true, command: words.slice(i + 1).join(" ").trim() };
    }
  }
  return { woke: false, command: "" };
}

/** Strip a leading wake word from a command captured while already listening. */
export function stripLeadingWakeWord(transcript: string): string {
  const match = detectAyasWakeWord(transcript);
  return match.woke ? match.command : normalize(transcript);
}

/* ------------------------------------------------------------------------- *
 * Capability detection (pure — given a window-like object)
 * ------------------------------------------------------------------------- */

export interface AyasVoiceWindowLike {
  readonly SpeechRecognition?: unknown;
  readonly webkitSpeechRecognition?: unknown;
  readonly speechSynthesis?: unknown;
}

export interface AyasVoiceCapability {
  /** Speech-to-text available at all. */
  readonly stt: boolean;
  /** Text-to-speech available (local). */
  readonly tts: boolean;
  /**
   * `true` when the only available STT is a vendor implementation that streams
   * audio to a cloud service (Chromium's `webkitSpeechRecognition`). The UI
   * must disclose this before enabling it.
   */
  readonly sttCloudBacked: boolean;
}

export function detectAyasVoiceCapability(win: AyasVoiceWindowLike | undefined): AyasVoiceCapability {
  if (!win) return { stt: false, tts: false, sttCloudBacked: false };
  const standard = typeof win.SpeechRecognition === "function";
  const webkit = typeof win.webkitSpeechRecognition === "function";
  return {
    stt: standard || webkit,
    tts: typeof win.speechSynthesis === "object" && win.speechSynthesis !== null,
    // The webkit-only path is the cloud-backed one; a future standard, local
    // implementation would clear this.
    sttCloudBacked: !standard && webkit,
  };
}

export const AYAS_VOICE_DISCLOSURE =
  "Tarayıcının konuşma tanıma motoru (Chromium'da webkitSpeechRecognition) " +
  "sesi işlemek için ses verisini tarayıcı sağlayıcısının bulut servisine gönderir. " +
  "Bunu etkinleştirmek tamamen senin seçimin. Metin sohbeti ve AYAS'ın sesli " +
  "yanıtı (yerel) bundan bağımsız çalışır.";

/** Shown when the browser blocked auto-speech until a user gesture. */
export const AYAS_TTS_AUTOPLAY_BLOCKED =
  "Tarayıcı, otomatik sesli yanıtı bir kullanıcı etkileşimi olana kadar engelledi. " +
  "Metin yanıtı hazır; sesli dinlemek için başlat düğmesine dokun.";

/* ------------------------------------------------------------------------- *
 * Voice state machine (pure)
 *
 * The engine (`voice/ayasVoiceEngine.ts`) owns the live state and an epoch
 * counter that rejects stale async callbacks; this reducer is the single
 * declarative source of the *allowed* transitions, so the state model is
 * testable without a browser. Key invariant: a late "wake" callback that
 * arrives while AYAS is already thinking or speaking must NOT knock the
 * machine back to "listening".
 * ------------------------------------------------------------------------- */

export type AyasVoiceEvent =
  | "enable-listen"
  | "disable-listen"
  | "wake"
  | "capture-command"
  | "reply-pending"
  | "speak-start"
  | "speak-end"
  | "error"
  | "clear-error"
  | "unsupported";

export interface AyasVoiceMachineContext {
  /** STT (listening) mode is currently requested by the user. */
  readonly listening: boolean;
  /** This browser can hear at all (`SpeechRecognition` present). */
  readonly hasStt: boolean;
  /** This browser can speak at all (`speechSynthesis` present). */
  readonly hasTts: boolean;
}

/** The base state when nothing transient is happening. */
export function ayasRestingVoiceState(ctx: AyasVoiceMachineContext): AyasVoiceState {
  if (!ctx.hasStt && !ctx.hasTts) return "unsupported";
  if (ctx.listening && ctx.hasStt) return "idle";
  return "off";
}

/** Deterministic transition. Unknown / disallowed events return `current`. */
export function nextAyasVoiceState(
  current: AyasVoiceState,
  event: AyasVoiceEvent,
  ctx: AyasVoiceMachineContext,
): AyasVoiceState {
  switch (event) {
    case "unsupported":
      return "unsupported";
    case "error":
      return "error";
    case "enable-listen":
      return ctx.hasStt ? "idle" : current;
    case "disable-listen":
      return ayasRestingVoiceState({ ...ctx, listening: false });
    case "clear-error":
      return ayasRestingVoiceState(ctx);
    case "wake":
      // A stray wake while AYAS is working or talking must be ignored.
      return current === "speaking" || current === "thinking" ? current : "listening";
    case "capture-command":
      return "thinking";
    case "reply-pending":
      // The reply text arrived; the caller decides whether to speak it.
      return current === "speaking" ? current : "thinking";
    case "speak-start":
      return "speaking";
    case "speak-end":
      return ayasRestingVoiceState(ctx);
    default:
      return current;
  }
}

/* ------------------------------------------------------------------------- *
 * Male / Turkish voice-selection algorithm (pure)
 *
 * `speechSynthesis.getVoices()` returns a platform-specific list. We pick the
 * best AYAS voice by tier — never hard-coding a single OS voice name:
 *   1. Turkish + a male marker
 *   2. Turkish + a natural / high-quality marker
 *   3. exactly `tr-TR`
 *   4. any Turkish voice
 *   5. no Turkish voice → let the browser default answer, but force `tr-TR`
 * ------------------------------------------------------------------------- */

export interface AyasPlatformVoice {
  readonly name: string;
  readonly lang: string;
  /** `true` when the voice is synthesised on-device (preferred: offline + private). */
  readonly localService: boolean;
  readonly default: boolean;
}

export type AyasVoiceTier = "tr-male" | "tr-quality" | "tr-exact" | "tr-any" | "fallback";

export interface AyasVoiceSelection {
  /** `null` → no explicit voice; the browser picks its `tr-TR` default. */
  readonly voiceName: string | null;
  readonly lang: string;
  readonly tier: AyasVoiceTier;
  readonly localService: boolean;
  readonly reason: string;
}

/** Known male Turkish TTS voices + generic male markers (lowercased, tr locale). */
const TR_MALE_VOICE_HINTS = ["tolga", "eddy", "erkek", " male", "male ", "(male", "man)"];
/** Natural / neural / high-quality markers across vendors. */
const TR_QUALITY_VOICE_HINTS = [
  "natural",
  "neural",
  "premium",
  "enhanced",
  "wavenet",
  "studio",
  "online",
  "gelişmiş",
  "doğal",
  "kaliteli",
];

function normalizeLang(lang: string): string {
  return String(lang ?? "").toLowerCase().replace(/_/g, "-");
}

function isTurkishVoice(voice: AyasPlatformVoice): boolean {
  const lang = normalizeLang(voice.lang);
  if (lang === "tr" || lang.startsWith("tr-")) return true;
  return /t[üu]rk|turkish/i.test(voice.name ?? "");
}

function hasHint(haystack: string, hints: readonly string[]): boolean {
  const s = ` ${haystack.toLocaleLowerCase("tr")} `;
  return hints.some((hint) => s.includes(hint));
}

const AYAS_FALLBACK_SELECTION: AyasVoiceSelection = Object.freeze({
  voiceName: null,
  lang: "tr-TR",
  tier: "fallback",
  localService: false,
  reason: "Türkçe ses bulunamadı — tarayıcının tr-TR varsayılanı kullanılacak.",
});

/**
 * Pick the best available AYAS voice. Deterministic for a given voice set
 * (ties break on `localService`, then shorter name, then name ascending).
 */
export function selectAyasVoice(voices: readonly AyasPlatformVoice[] | undefined): AyasVoiceSelection {
  const turkish = (voices ?? []).filter(
    (v) => v && typeof v.name === "string" && isTurkishVoice(v),
  );
  if (turkish.length === 0) return AYAS_FALLBACK_SELECTION;

  const scored = turkish
    .map((voice) => {
      const male = hasHint(voice.name, TR_MALE_VOICE_HINTS);
      const quality = hasHint(voice.name, TR_QUALITY_VOICE_HINTS);
      const exact = normalizeLang(voice.lang) === "tr-tr";
      let score = 0;
      if (male) score += 1000;
      if (quality) score += 100;
      if (exact) score += 40;
      if (voice.localService) score += 10;
      if (voice.default) score += 5;
      const tier: AyasVoiceTier = male
        ? "tr-male"
        : quality
          ? "tr-quality"
          : exact
            ? "tr-exact"
            : "tr-any";
      return { voice, score, tier };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.voice.localService !== b.voice.localService) return a.voice.localService ? -1 : 1;
      if (a.voice.name.length !== b.voice.name.length) return a.voice.name.length - b.voice.name.length;
      return a.voice.name.localeCompare(b.voice.name);
    });

  const best = scored[0];
  const reasonByTier: Record<AyasVoiceTier, string> = {
    "tr-male": "Türkçe + erkek ses işareti.",
    "tr-quality": "Türkçe + doğal/kaliteli ses işareti.",
    "tr-exact": "tr-TR dili.",
    "tr-any": "Mevcut en uygun Türkçe ses.",
    fallback: AYAS_FALLBACK_SELECTION.reason,
  };
  return {
    voiceName: best.voice.name,
    lang: normalizeLang(best.voice.lang) === "tr" ? "tr-TR" : best.voice.lang || "tr-TR",
    tier: best.tier,
    localService: best.voice.localService,
    reason: reasonByTier[best.tier],
  };
}

/* ------------------------------------------------------------------------- *
 * TTS parameter profile (pure)
 *
 * Tuned for a deep, "tok", technological AYAS while staying intelligible.
 * NOTE: `SpeechSynthesis` cannot physically re-voice every engine — on some
 * devices (notably remote neural voices) `pitch` is ignored. This picks the
 * best of what the free browser voices offer; it does not promise a specific
 * timbre.
 * ------------------------------------------------------------------------- */

export interface AyasSpeechParams {
  /** 0–2, 1 = engine default. Lower = deeper. */
  readonly pitch: number;
  /** 0.5–2 (clamped), 1 = engine default. */
  readonly rate: number;
  /** 0–1. */
  readonly volume: number;
}

export const AYAS_TTS_PROFILE: AyasSpeechParams = Object.freeze({
  pitch: 0.82, // deep / "tok" without turning muddy
  rate: 1.03, // close to natural conversational pace
  volume: 1, // present, not clipping
});

function clampNumber(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export function resolveAyasSpeechParams(over: Partial<AyasSpeechParams> = {}): AyasSpeechParams {
  return {
    pitch: clampNumber(over.pitch ?? AYAS_TTS_PROFILE.pitch, 0, 2, AYAS_TTS_PROFILE.pitch),
    rate: clampNumber(over.rate ?? AYAS_TTS_PROFILE.rate, 0.5, 2, AYAS_TTS_PROFILE.rate),
    volume: clampNumber(over.volume ?? AYAS_TTS_PROFILE.volume, 0, 1, AYAS_TTS_PROFILE.volume),
  };
}

/* ------------------------------------------------------------------------- *
 * Spoken-Turkish text preparation (pure)
 *
 * The LLM is already prompted to answer in short, symbol-free spoken Turkish
 * (see `AYAS_SPOKEN_TURKISH_RULE` in `brainCore.ts`). This is the belt-and-
 * braces pass applied ONLY to the TTS utterance — the on-screen text is left
 * exactly as the model wrote it.
 * ------------------------------------------------------------------------- */

export function toSpokenAyasText(raw: string): string {
  let t = String(raw ?? "");

  // fenced + inline code
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/`([^`]*)`/g, "$1");
  // links [text](url) → text
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // list / heading / quote / emphasis markers
  t = t.replace(/^\s{0,3}[-*•]\s+/gm, "");
  t = t.replace(/^\s{0,3}\d+[.)]\s+/gm, "");
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s{0,3}>\s?/gm, "");
  t = t.replace(/\*\*|__|\*|_|~~/g, "");
  // symbols → Turkish words
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*%/g, "yüzde $1");
  t = t.replace(/%/g, " yüzde ");
  t = t.replace(/&/g, " ve ");
  t = t.replace(/[|]/g, ", ");
  t = t.replace(/[→➜▶►·—–]/g, " ");
  // emoji / pictographs / arrows / dingbats
  t = t.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu,
    " ",
  );
  // tidy spacing / punctuation
  t = t.replace(/[ \t]*\n[ \t]*\n[ \t]*/g, ". ");
  t = t.replace(/\s*\n\s*/g, " ");
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  t = t.replace(/([.!?]){2,}/g, "$1");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

/** Whether a successful reply should be auto-spoken. */
export function shouldAutoSpeakAyasReply(input: {
  readonly ttsAvailable: boolean;
  readonly muted: boolean;
}): boolean {
  return input.ttsAvailable && !input.muted;
}

/** Human-readable Turkish description of a `SpeechRecognition` error code. */
export function describeAyasRecognitionError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Mikrofon izni reddedildi. Sesli mod kapatıldı; metin sohbeti çalışıyor.";
    case "no-speech":
      return "Ses algılanmadı — tekrar dener.";
    case "audio-capture":
      return "Mikrofon bulunamadı. Metin sohbeti çalışıyor.";
    case "network":
      return "Konuşma tanıma servisine ulaşılamadı. Metin sohbeti çalışıyor.";
    case "aborted":
      return "Dinleme durduruldu.";
    default:
      return "Konuşma tanıma hatası. Metin sohbeti çalışıyor.";
  }
}
