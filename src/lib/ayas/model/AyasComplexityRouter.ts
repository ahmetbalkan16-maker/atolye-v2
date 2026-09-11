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
const TOOL = /\b(git (durum\w*|status|diff|log|degisiklik\w*)|(dosya|klasor|repo)\w* ?(kontrol et|incele|goster)|test\w* ?(et|calistir)|build\w* ?(al|et)|tsc ?calistir|lint ?et|calisan (servis|process|node)|port\w*( acik)?|hangi dosyalar degisti)\b/;

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
