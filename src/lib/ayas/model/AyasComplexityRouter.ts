/**
 * Atölye Brain — AYAS complexity classifier (Phase 2 · P0-A.2 / D.1).
 *
 * Decides, from the user's text alone, the coarse shape of the turn BEFORE any
 * model call — so a trivial "saat kaç" never pays for a reasoning pass and a
 * "son hatanın nedenini bul, ne yapmalıyız" one does.
 *
 * PURE + deterministic. Turkish-aware (accent folding). No model, no fs. A
 * later phase may add an optional model-assisted second opinion for the
 * ambiguous middle — the hook is the `assist` option, unused for now.
 *
 * The output is advisory: this phase it only tags the turn and (in Phase D)
 * gates whether the reasoning core runs. It never changes which PROVIDER
 * answers — that is availability-driven in `AyasModelRouter`.
 */

import type { AyasChatComplexity } from "./AyasModelTypes";

function fold(text: string): string {
  return String(text ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[İıI]/g, "i")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/[.,!?;:()"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "araştır", "araştırma yap", "hakkında bilgi", "incele" (bilgi anlamında). */
const RESEARCH = /\b(arastir|arastirma yap|hakkinda (bilgi|arastirma)|kaynak bul|literatur|derle bilgi)\b/;

/** About a failure / self-heal recovery. */
const REPAIR = /\b(self ?heal|self-?healing|kendini (iyilestir|onar)|neden (duzelmedi|calismadi|devreye girmedi)|onar|iyilestir|watchdog|rollback|regresyon)\b/;

/** Asks for a read-only inspection of the machine/repo — Phase F prep, NO execution here. */
const TOOL = /\b(git (durum\w*|status|diff|log|degisiklik\w*)|(dosya|klasor|repo|belge)\w* ?(kontrol et|incele|goster|bak\w*|oku\w*)|test\w* ?(et|calistir)|build\w* ?(al|et)|tsc ?calistir|lint ?et|calisan (servis|process|node)|port\w*( acik)?|hangi dosyalar degisti|checkpoint\w*|roadmap\w*|changelog\w*)\b/;

/**
 * Action Runtime sprint — a real, generalizable STRUCTURAL signal (not verb
 * guessing): the message mentions something that looks like a repo-relative
 * file path (`src/lib/foo/Bar.ts`, `scripts/x.ts`, a top-level `.md`). A live
 * acceptance run found the verb-proximity `TOOL` patterns above miss this
 * entirely — "AyasExecutionPolicy.ts dosyasının ne işe yaradığını açıklar
 * mısın?" has the trigger noun and verb several words apart, which no
 * bounded-proximity regex reliably covers, but a literal path being named is
 * itself a strong, deterministic, phrasing-independent signal on its own.
 * Checked on the RAW (unfolded) text — folding lowercases path segments,
 * which is harmless, but also strips the extension-separating dot's meaning
 * only if punctuation stripping ran first, so this runs before `fold()`.
 */
const FILE_PATH_MENTION = /\b(?:src|scripts|app)\/[\w./-]+\.(ts|tsx|js|jsx|mjs|cjs|md|json)\b|\b[\w-]+\.md\b/i;

/**
 * Action Runtime RELIABILITY sprint — exported for `AyasChatStream.ts`'s
 * deterministic tool-candidate resolver. A live acceptance report found that
 * relying on the reasoning core's stochastic structured-JSON tool naming
 * means the SAME explicit, unambiguous request ("Checkpoint'e bak…") can
 * dispatch on one run and honestly decline on the next, purely from model
 * sampling — for these fully unambiguous cases, dispatch selection should
 * not depend on the model naming the tool at all. These are deliberately the
 * SAME keyword/structural signals the `TOOL` classification above already
 * uses (not a new parser) — reused here as extraction, not just detection.
 */
export const CHECKPOINT_MENTION = /\bcheckpoint\w*\b/i;
export const ROADMAP_MENTION = /\broadmap\w*\b/i;
export const CHANGELOG_MENTION = /\bchangelog\w*\b/i;

/** Extracts the matched repo-relative path/filename `FILE_PATH_MENTION` finds, or null. Checked on RAW (unfolded) text — see that const's own doc comment for why. */
export function extractAyasFilePathMention(text: string): string | null {
  const match = FILE_PATH_MENTION.exec(String(text ?? ""));
  return match ? match[0] : null;
}

/**
 * True when the text names MORE THAN ONE DISTINCT file/path mention — e.g.
 * "A.ts ve B.ts dosyalarını karşılaştır". `extractAyasFilePathMention` only
 * ever returns the FIRST match (a plain `.exec()`, not "find all"), so a
 * caller that used its non-null result alone as an unambiguity signal would
 * silently treat a two-file request as if only one file had been named —
 * found via this sprint's own regression coverage. Naming the SAME file
 * twice ("X.ts'i incele, X.ts'teki fonksiyonlara bak") is not ambiguous —
 * deduped case-insensitively before counting. A fresh `g`-flagged copy of
 * the same pattern is used here so the shared, non-global `FILE_PATH_
 * MENTION` (an `.exec()`/`.test()` instance shared across calls) keeps its
 * own `lastIndex` semantics untouched.
 */
export function hasMultipleAyasFilePathMentions(text: string): boolean {
  const global = new RegExp(FILE_PATH_MENTION.source, "gi");
  const matches = String(text ?? "").match(global);
  if (!matches) return false;
  return new Set(matches.map((m) => m.toLowerCase())).size > 1;
}

/**
 * Adversarial-sweep findings, both checked on RAW (unfolded) text:
 *  - a literal `.env` mention — sensitive regardless of which verb (if any)
 *    surrounds it; routing it through reasoning (where a real dispatch
 *    attempt would be DENIED by `AyasSafeExecutors.ts`'s own secret-name
 *    check, and the fake-completion-claim guard then applies to the answer)
 *    is safer than leaving it on the direct-stream path, which has no tool
 *    concept at all and, live-tested, happily fabricated fake `.env` content.
 *  - "araç" (tool) and "çalıştır" (run/execute) both present ANYWHERE in the
 *    message, not required to be adjacent — a bounded-proximity regex missed
 *    a real "run_shell_command aracını kullanarak 'ls -la' çalıştır" turn
 *    because 3 words sat between "kullanarak" and "çalıştır". Broader on
 *    purpose: the cost of a false positive here is one extra reasoning pass,
 *    never an unsafe action (dispatch is still fully policy-gated below).
 */
const ENV_MENTION = /\.env\b/i;
const TOOL_RUN_WORDS = /\barac\w*\b/i;
const RUN_VERB_WORDS = /\bcalistir\w*\b/;

/** Multi-step analysis / decision cues. */
const COMPLEX = /\b(neden(ini)? bul|kok neden|analiz et|degerlendir|karsilastir|ne yapmali(yiz|yim)?|nasil ilerleyelim|plan(la| yap| cikar)|adim adim|once .* sonra|hem .* hem|tespit et .* coz)\b/;

/** Trivial cues — a direct answer, no context/memory/reasoning needed. */
const SIMPLE_EXACT = new Set([
  "merhaba", "selam", "gunaydin", "iyi aksamlar", "iyi geceler", "nasilsin",
  "tesekkurler", "tesekkur ederim", "sagol", "eyvallah", "tamam", "peki",
  "evet", "hayir", "olur", "anladim", "harika", "super",
  "saat kac", "bugun gunlerden ne", "adin ne", "sen kimsin", "kimsin",
]);

/**
 * Reserved — an optional model-assisted classifier for the ambiguous middle,
 * wired in a later phase. Kept as a type so the call sites can adopt it without
 * a signature change.
 */
export interface ClassifyOptions {
  readonly assist?: (text: string) => Promise<AyasChatComplexity | null>;
}

/**
 * Deterministic first pass. Order matters: the most specific intents
 * (research / repair / tool) win over the generic COMPLEX/NORMAL split.
 */
export function classifyAyasComplexity(text: string): AyasChatComplexity {
  const t = fold(text);
  if (!t) return "SIMPLE";

  if (SIMPLE_EXACT.has(t)) return "SIMPLE";

  if (RESEARCH.test(t)) return "RESEARCH";
  if (REPAIR.test(t)) return "REPAIR";
  if (TOOL.test(t)) return "TOOL";
  // Checked against the RAW text, not `t` — `fold()` replaces `.` with a
  // space, which would destroy the extension separator these patterns need.
  if (FILE_PATH_MENTION.test(text) || ENV_MENTION.test(text)) return "TOOL";
  if (TOOL_RUN_WORDS.test(t) && RUN_VERB_WORDS.test(t)) return "TOOL";
  if (COMPLEX.test(t)) return "COMPLEX";

  const words = t.split(" ").filter(Boolean);
  // `t` is already accent-folded (mı/mi/mu/mü → mi/mu) by `fold()`.
  const hasQuestion =
    /(^| )(mi|mu|neden|nasil|nere\w*|hangi|kac\w*|kim\w*|niye|nicin|ne)( |$)/.test(t) ||
    /\?/.test(text);

  // Very short and not a question → SIMPLE. Anything longer, or any question,
  // is at least NORMAL (context + memory + a plain answer).
  if (words.length <= 2 && !hasQuestion) return "SIMPLE";
  return "NORMAL";
}
