import { splitDirections } from "../tts/StageDirections";

/**
 * The line right after a Short's hook (owner, 19 Nov 2026: "nerede kişi kaybediyoruz, ne geliştirmemiz gerekiyor bul ve
 * yap; bundan sonra Shorts videosu yapacağız"). YouTube Analytics' organic curves of the channel's 45–56 s Shorts (Caesar,
 * Zanzibar, Waterloo, Cannae) all kept their hook — relative retention 0.43–0.53 at 3 s — and then lost 43–56 % of those
 * viewers by 12 s, the steepest slope falling on the narrator's line after the hook: 14–18 words opening on a date or a
 * place ("Around 75 BC, Julius Caesar was kidnapped…", "On August 2nd, 216 BC, Rome fields…"), while the "yer_tarih"
 * card already showed where and when. All eight Shorts made so far open their second line this way. The rule: that
 * line, when the narrator's, is at most HOOK_FOLLOW_MAX_WORDS words and does not open on a date or a time. Measured,
 * not guessed, by ChannelAnalyticsMap.holdAfterHook on the next Shorts. No model, no files.
 */

/** Words the narrator's line after the hook may have: ~5 s at the channel's 2.3–2.5 spoken words a second. */
export const HOOK_FOLLOW_MAX_WORDS = 12;
/** The opening words searched for a date or a time ("Baghdad, December 1638." is a date opener too). */
const OPENING_WORDS = 6;

export type HookFollowFault = "uzun" | "tarih";

const MONTHS = /\b(january|february|march|april|june|july|august|september|october|november|december|ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\b/;

const fold = (text: string) => text.replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const words = (text: string) => text.split(/\s+/).filter((w) => /\p{L}|\d/u.test(w));

/**
 * The date or time a line opens with (within its first OPENING_WORDS words), or undefined. A year (3–4 digits standing
 * alone: "1638", not "108,589"), a number with an era ("75 BC", "MÖ 216"), a clock time ("1:25 a.m.") or a month with a
 * number ("November 11", "2 Ağustos").
 */
export function dateOpener(text: string): string | undefined {
  const head = words(splitDirections(text).speech).slice(0, OPENING_WORDS).join(" ");
  const f = fold(head);
  const hits = [
    /(?<!\d)(?<!\d[,.])\d{3,4}(?!\d)(?![,.]\d)/,
    /\b\d+(st|nd|rd|th)?\s*(bc|bce|ad|ce|b\.c\.|a\.d\.)(?![a-z])/,
    /\b(mo|ms|m\.o\.|m\.s\.)\s*\d+/,
    /\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/,
    /\b\d{1,2}:\d{2}\b/,
  ];
  for (const re of hits) {
    const m = re.exec(f);
    if (m) return m[0];
  }
  const month = MONTHS.exec(f);
  return month && /\d/.test(f) ? month[0] : undefined;
}

/** What is wrong with a narrator's line after the hook: too long, opening on a date — or nothing. */
export function hookFollowFaults(text: string): HookFollowFault[] {
  const out: HookFollowFault[] = [];
  if (words(splitDirections(text).speech).length > HOOK_FOLLOW_MAX_WORDS) out.push("uzun");
  if (dateOpener(text)) out.push("tarih");
  return out;
}

interface Scene { readonly id?: string; readonly satirlar?: readonly { readonly karakter?: string; readonly metin?: string }[] }
interface EpisodeLike { readonly oyuncu_kadrosu?: readonly { readonly id?: string; readonly gorunur?: boolean }[]; readonly sahneler?: readonly Scene[] }

/**
 * The episode's second spoken line, the one after the hook, with whether the narrator (an invisible cast member) says
 * it. Undefined when the episode has fewer than two spoken lines.
 */
export function hookFollowLine(episode: EpisodeLike): { readonly sahne: string; readonly satir: number; readonly metin: string; readonly anlatici: boolean } | undefined {
  const narrators = new Set((episode.oyuncu_kadrosu ?? []).filter((c) => c.gorunur === false).map((c) => c.id));
  let seen = 0;
  for (const s of episode.sahneler ?? []) {
    for (const [i, l] of (s.satirlar ?? []).entries()) {
      if (typeof l.metin !== "string" || !splitDirections(l.metin).speech) continue;
      if (++seen === 2) return { sahne: s.id ?? "?", satir: i + 1, metin: l.metin, anlatici: narrators.has(l.karakter) };
    }
  }
  return undefined;
}

/**
 * The writer's repair asks for a Short's line after the hook (ScriptEngine asks them in its repair rounds beside the map
 * shares, from SHORT_SHARES_FROM_S; a valid script is never lost over them). Only the narrator's line is judged: a
 * character answering the hook keeps the scene going.
 */
export function hookFollowProblems(episode: EpisodeLike): string[] {
  const line = hookFollowLine(episode);
  if (!line?.anlatici) return [];
  const faults = hookFollowFaults(line.metin);
  if (!faults.length) return [];
  const n = words(splitDirections(line.metin).speech).length;
  const what = [
    ...(faults.includes("tarih") ? [`opens on a date or a time ("${dateOpener(line.metin)}")`] : []),
    ...(faults.includes("uzun") ? [`has ${n} words (at most ${HOOK_FOLLOW_MAX_WORDS})`] : []),
  ].join(" and ");
  return [`scene "${line.sahne}" line ${line.satir}, the narrator's line right after the hook, ${what}: feed viewers swipe away here — say the stakes in at most ${HOOK_FOLLOW_MAX_WORDS} words (who wants what, what is about to go wrong); the "yer_tarih" card already shows where and when, so a date that matters goes in a later line — HOOK FOLLOW-UP`];
}
