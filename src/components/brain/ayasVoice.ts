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
 *  - `SpeechRecognition` (hearing the wake word) is only implemented in
 *    Chromium browsers as `webkitSpeechRecognition`, and that implementation
 *    streams audio to the browser vendor's cloud service. It is therefore OFF
 *    by default and only starts after an explicit, informed user opt-in.
 *  - A true always-on OS wake word is not possible from a web page (the tab
 *    must be focused and mic permission granted). "Wake word" here means:
 *    while voice mode is on, saying a wake alias flips AYAS into active
 *    listening.
 *  - Wake Alias sprint: "UYAN" is now the primary/preferred wake alias — the
 *    easiest first try for a Turkish speaker. AYAS's own identity is
 *    unchanged, and every alias below (see `detectAyasWakeWord`) resolves to
 *    the exact same canonical wake intent — none is a separate identity, and
 *    none by itself grants any execution authority.
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
  idle: { state: "idle", label: "Waiting for \"UYAN\" (\"AYAS\")", tr: "\"UYAN\" (\"AYAS\") bekleniyor" },
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
 * Wake-alias resolver (pure)
 *
 * Every alias below resolves to exactly ONE canonical wake intent
 * (`AYAS_WAKE_INTENT`) — no alias is a separate identity, and AYAS's own name
 * does not change. `"uyan"` is the primary/preferred alias (the easiest
 * first-try word for a Turkish speaker); `"ayas"` + its known ASR mishears
 * are the original (Sprint 186) wake word, kept verbatim for backward
 * compatibility, alongside the newer `"aya"` / `"atölye"` aliases and their
 * "HEY …" forms.
 *
 * Matching is EXACT on whole, case/punctuation/whitespace-normalized words
 * (or adjacent word PAIRS for a "HEY …" alias) AND positional: an alias only
 * wakes AYAS as the LEADING invocation of the utterance (leading whitespace/
 * punctuation is tolerated and skipped first) — never a word that merely
 * appears somewhere later in an unrelated sentence. Deliberately NOT fuzzy /
 * edit-distance either. This is a real, disclosed trade-off for the two
 * short, plain-Turkish-word aliases: "uyan" ("wake up") and "aya" ("to the
 * moon") are both real words that, spoken as the very FIRST word to someone/
 * something else ("Uyan artık…" said to a person), can still coincidentally
 * satisfy "leading position." Exact whole-word + leading-only matching (no
 * substring/fuzzy expansion, no mid-sentence trigger) is the mitigation
 * actually applied; it narrows that false-positive class to a real address-
 * shaped opener, it cannot eliminate it for a common word chosen as an alias.
 * ------------------------------------------------------------------------- */

/** The single canonical wake intent every alias below resolves to. */
export const AYAS_WAKE_INTENT = "AYAS_WAKE" as const;
export type AyasWakeIntent = typeof AYAS_WAKE_INTENT;

/**
 * Single-word wake aliases — matched as the LEADING word of the (leading-
 * filler-trimmed) transcript, case/punctuation-insensitive via `normalize()`.
 * Order is documentation only.
 */
const WAKE_SINGLE_WORD_ALIASES: readonly string[] = [
  "uyan", // primary / preferred
  "ayas", "ayaş", "aias", "hayas", "ayes", // AYAS + known ASR mishears (Sprint 186, unchanged)
  "aya",
  "atölye", "atolye", // the dictionary word + a plain-ASCII ASR spelling
];

/**
 * `"atölye"` (either spelling) is by far the most ordinary Turkish word in
 * the alias set — it is literally the studio's own name, constantly used to
 * talk ABOUT it ("Atölye bugün kapalı," "Atölye çok yoğun"), not just to
 * address it. Leading-position alone cannot tell "ATÖLYE, ..." (an address)
 * apart from "Atölye bugün kapalı." (an ordinary sentence that happens to
 * start with the word) — both have "atölye" as the first word. Requiring a
 * comma right after it (or nothing else at all — a bare "ATÖLYE") is the
 * cheapest reliable disambiguator without any grammar/NLP. The other
 * aliases (an imperative "uyan," the short "aya"/"ayas") don't carry this
 * same everyday-statement risk and are not restricted this way.
 */
const ATOLYE_LEADING_TOKENS: readonly string[] = ["atölye", "atolye"];

function hasAtolyeLeadingBoundary(leadingText: string): boolean {
  const trimmed = leadingText.trimStart();
  const firstToken = trimmed.split(/\s+/, 1)[0] ?? "";
  const rest = trimmed.slice(firstToken.length).trim();
  return rest === "" || firstToken.endsWith(",");
}

/**
 * Two-word ("HEY …") wake aliases — matched as an exact ADJACENT word pair.
 * Only the pairs explicitly supported are listed here; a bare "hey" alone
 * never wakes AYAS.
 */
const WAKE_TWO_WORD_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["hey", "uyan"],
  ["hey", "ayas"],
  ["hey", "aya"],
];

export interface AyasWakeMatch {
  readonly woke: boolean;
  /** The command text that followed the wake word (may be empty — a bare wake alias). */
  readonly command: string;
  /**
   * The literal alias text that matched (e.g. `"uyan"`, `"hey ayas"`); `null`
   * when `woke` is false. Diagnostic only — every alias maps to the SAME
   * `intent`, so this never branches AYAS's behaviour.
   */
  readonly alias: string | null;
  /** {@link AYAS_WAKE_INTENT} when `woke`, else `null`. */
  readonly intent: AyasWakeIntent | null;
}

function normalize(text: string): string {
  return String(text ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[.,!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strips LEADING whitespace and stray leading punctuation only — never
 * touches interior content — so a transcript with an incidental leading
 * pause/mark still recognizes its wake alias as "the leading invocation."
 */
function trimLeadingFiller(text: string): string {
  return String(text ?? "").replace(/^[\s.,!?;:¡¿'"“”‘’()\-–—]+/, "");
}

const NO_WAKE_MATCH: AyasWakeMatch = Object.freeze({ woke: false, command: "", alias: null, intent: null });

/**
 * Does this transcript OPEN with a wake alias? If so, return whatever the
 * user said after it as `command` — taken from the ORIGINAL normalized words
 * (not accent-folded), so Turkish characters in the command reach the
 * downstream reasoning path exactly as spoken. Deterministic and POSITIONAL:
 * only the leading word (or leading word pair, for a "HEY …" alias) is ever
 * checked — a real alias word appearing later in an unrelated sentence never
 * wakes AYAS.
 */
export function detectAyasWakeWord(transcript: string): AyasWakeMatch {
  const leading = trimLeadingFiller(transcript);
  const words = normalize(leading).split(" ").filter(Boolean);
  if (words.length === 0) return NO_WAKE_MATCH;

  const pair = WAKE_TWO_WORD_ALIASES.find(([a, b]) => words[0] === a && words[1] === b);
  if (pair) {
    return {
      woke: true,
      command: words.slice(2).join(" ").trim(),
      alias: `${pair[0]} ${pair[1]}`,
      intent: AYAS_WAKE_INTENT,
    };
  }

  if (WAKE_SINGLE_WORD_ALIASES.includes(words[0])) {
    if (ATOLYE_LEADING_TOKENS.includes(words[0]) && !hasAtolyeLeadingBoundary(leading)) {
      return NO_WAKE_MATCH;
    }
    return { woke: true, command: words.slice(1).join(" ").trim(), alias: words[0], intent: AYAS_WAKE_INTENT };
  }

  return NO_WAKE_MATCH;
}

/** Strip a leading wake word from a command captured while already listening. */
export function stripLeadingWakeWord(transcript: string): string {
  const match = detectAyasWakeWord(transcript);
  return match.woke ? match.command : normalize(transcript);
}

/* ------------------------------------------------------------------------- *
 * Push-to-talk fallback (pure hotkey predicate)
 *
 * Ctrl+Space is a keyboard alternative to saying a wake alias — pressing it
 * has the SAME effect as the wake word being heard (see
 * `AyasVoiceEngine.activatePushToTalk`): AYAS starts listening directly, no
 * wake word needed for the very next utterance. It grants no execution
 * authority of its own — identical security posture to a spoken wake word.
 * ------------------------------------------------------------------------- */

export interface AyasHotkeyLike {
  readonly code?: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  /** Auto-repeat while the key is held — a real DOM `KeyboardEvent` sets this. */
  readonly repeat?: boolean;
}

/**
 * `true` only for a clean Ctrl+Space press — no other modifier, not a
 * key-repeat — so it does not fire inside an unrelated combo
 * (Ctrl+Shift+Space, Ctrl+Alt+Space, …) or repeatedly while held.
 */
export function isAyasPushToTalkHotkey(event: AyasHotkeyLike | undefined): boolean {
  if (!event || event.repeat) return false;
  return event.code === "Space" && Boolean(event.ctrlKey) && !event.altKey && !event.shiftKey && !event.metaKey;
}

/**
 * A short, EXACT phrase the user says to end an open conversation session (go
 * back to waiting for "AYAS"). Deliberately exact-match only — a fuzzy match
 * would silently eat a real command, and the 15 s idle timeout + the on-screen
 * "dinlemeyi kapat" link are the primary ways to close a session. Turkish accent
 * chars are folded first (`ç→c`, `ş→s`, `ı/İ→i`, …) so ASR spelling variance
 * still matches.
 */
const STOP_CONVERSATION_PHRASES = new Set([
  "tamam ayas",
  "ayas tamam",
  "ayas dur",
  "ayas kapat",
  "ayas bitir",
  "ayas sessiz",
  "ayas sessiz mod",
  "ayas sessiz moda gec",
  "sessiz moda gec",
  "konusmayi bitir",
  "sohbeti bitir",
]);

export function detectAyasStopConversationIntent(transcript: string): boolean {
  const folded = normalize(transcript)
    .replace(/[İıI]/g, "i")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g");
  return STOP_CONVERSATION_PHRASES.has(folded);
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

/* ------------------------------------------------------------------------- *
 * Recognition mode (pure)
 *
 * iOS (Safari + every iOS browser — all WebKit) implements
 * `webkitSpeechRecognition` as a SINGLE-SHOT recogniser and blocks
 * `recognition.start()` unless it is called inside a user activation. The
 * engine's default flow keeps recognition alive by auto-restarting it from a
 * `setTimeout` in `onend` — a non-gesture call iOS rejects (silently), so after
 * the wake word the command is never heard.
 *
 * `"single-shot"` → one recognition session per user tap; no non-gesture
 * restart; capture interim results too (iOS often never marks a result final).
 * `"continuous"` → the existing Chrome/Chromium behaviour (continuous + self-
 * restart) — unchanged.
 * ------------------------------------------------------------------------- */

/**
 * `"wake-engine"` (Voice Closure Sprint): a local openWakeWord detector holds
 * the mic open, fires on "AYAS", then captures the command and sends it to the
 * whisper STT route. Unlike `webkitSpeechRecognition` it needs no per-utterance
 * gesture, so — like `"continuous"` — the engine may re-arm it without a tap.
 */
export type AyasRecognitionMode = "continuous" | "single-shot" | "wake-engine";

export interface AyasNavigatorLike {
  readonly userAgent?: string;
  readonly platform?: string;
  readonly maxTouchPoints?: number;
}

/** iPhone / iPad (incl. iPadOS 13+ which reports as "MacIntel" + touch). */
export function isAppleTouchDevice(nav: AyasNavigatorLike | undefined): boolean {
  if (!nav) return false;
  const ua = nav.userAgent ?? "";
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return true;
  const platform = nav.platform ?? "";
  const touch = typeof nav.maxTouchPoints === "number" ? nav.maxTouchPoints : 0;
  return (platform === "MacIntel" || /Mac/.test(ua)) && touch > 1;
}

export function detectAyasSpeechRecognitionMode(input: {
  readonly win?: AyasVoiceWindowLike;
  readonly nav?: AyasNavigatorLike;
}): AyasRecognitionMode {
  return isAppleTouchDevice(input.nav) ? "single-shot" : "continuous";
}

/* User-facing prompts for the single-shot flow (not errors — instructions). */
export const AYAS_VOICE_TAP_FOR_COMMAND =
  "Uyandım. Şimdi mikrofona tekrar dokunup komutunu söyle.";
export const AYAS_VOICE_TAP_TO_SPEAK =
  "Mikrofona dokun ve tek nefeste \"UYAN, ...\" diyerek söyle.";

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

/**
 * Whether AYAS should hold a screen wake lock right now. True while a
 * hands-free voice session is armed (`listening`) or AYAS is mid-turn
 * (capturing / thinking / speaking) — so an iOS phone does not auto-lock and
 * then evict + reload the page in the middle of a spoken exchange. Pure.
 */
export function ayasVoiceHoldsScreenAwake(state: AyasVoiceState, listening: boolean): boolean {
  if (listening) return true;
  return state === "listening" || state === "thinking" || state === "speaking";
}

/** Window-ish shape needed to decide whether the on-device wake engine can run. */
export interface AyasWakeCapableWindowLike extends AyasVoiceWindowLike {
  readonly isSecureContext?: boolean;
  readonly AudioWorkletNode?: unknown;
  readonly navigator?: { readonly mediaDevices?: { readonly getUserMedia?: unknown } };
}

/**
 * Can this browser run the openWakeWord + AudioWorklet capture path at all?
 * (TTS present, `AudioWorkletNode`, `getUserMedia`, and a secure context for the
 * mic.) Pure — `WakeWordVoiceAdapter.isSupported` delegates here.
 */
export function isWakeEngineCapable(win: AyasWakeCapableWindowLike | undefined): boolean {
  if (!win) return false;
  const cap = detectAyasVoiceCapability(win);
  return (
    cap.tts &&
    typeof win.AudioWorkletNode !== "undefined" &&
    typeof win.navigator?.mediaDevices?.getUserMedia === "function" &&
    win.isSecureContext === true
  );
}

/**
 * Which voice platform the Brain home page should drive:
 *  - `"wake-engine"` → the on-device openWakeWord "AYAS" detector + local
 *    whisper STT (`WakeWordVoiceAdapter`) — a true hands-free wake word, no
 *    per-utterance tap, no vendor cloud. Requires the operator opt-in
 *    (`NEXT_PUBLIC_ATOLYE_WAKE_ENGINE=on`, assets staged) AND a capable browser.
 *  - `"browser"` → `webkitSpeechRecognition` + local `speechSynthesis` — the
 *    always-available fallback (single-shot on iOS).
 * Pure; the caller supplies the two facts.
 */
export function selectAyasVoicePlatform(input: {
  readonly wakeEngineOptIn: boolean;
  readonly wakeEngineSupported: boolean;
}): "wake-engine" | "browser" {
  return input.wakeEngineOptIn && input.wakeEngineSupported ? "wake-engine" : "browser";
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
    case "start-blocked":
      return "Mikrofon yeniden başlatılamadı. Mikrofona tekrar dokun.";
    case "mic-interrupted":
      return "AYAS ses bağlantısını yeniden kuruyor. Hemen sürdürmek için mikrofona dokun.";
    case "language-not-supported":
      return "Türkçe konuşma tanıma bu cihazda etkin değil (Ayarlar › Dikte dilleri). Metin sohbeti çalışıyor.";
    default:
      return "Konuşma tanıma hatası. Metin sohbeti çalışıyor.";
  }
}
