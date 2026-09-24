/**
 * Atölye Brain — AYAS memory candidate extraction (Phase 2 · Phase C.1).
 *
 * From a completed turn (the user's message + AYAS's reply), produce zero or
 * more memory *candidates* — DETERMINISTICALLY, pattern-based, Turkish-aware. No
 * model. The governance gate (`scoreAyasMemoryCandidate`) then decides which get
 * stored, so this can be a little generous.
 *
 * Only a handful of shapes qualify: an explicit preference / instruction, a
 * decision, a stated fact about how the user works, a named bug. Small talk
 * produces nothing.
 */

import type { AyasMemoryCandidate } from "./AyasMemoryGovernance";
import { deriveAyasMemoryFact } from "./AyasMemoryTemporal";

function fold(text: string): string {
  return String(text ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[İıI]/g, "i")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    // Phone keyboards type a curly apostrophe ("Mehmet’im").
    .replace(/[’‘ʼ´`]/g, "'");
}

function clean(s: string, max = 400): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** "bundan sonra … / her zaman … / lütfen … yapma / … tercih ederim / bunu/şunu unutma" */
const PREFERENCE = /\b(bundan sonra|her (zaman|seferinde)|artik|surekli|lutfen .* (yap|yapma|kullan|kullanma)|tercih ederim|istemiyorum|istiyorum ki|(bu|su)nu (unutma|hatirla|not al)|kural olarak|varsayilan olarak)\b/;

/** "… karar verdik / … yapmaya karar / … kullanacagiz / … olsun dedik" */
const DECISION = /\b(karar (verdik|verildi)|karar aldik|yapmaya karar|kullanacagiz|kullanmayacagiz|.* olsun dedik|kesinlestirdik|uzerinde anlastik)\b/;

/** "benim … / … kullaniyorum / makinemde … / repo(m) … / ortam(im) …" — an environment/structure fact. */
const ENV_FACT = /\b(benim (makinem|bilgisayarim|gpu'?m|kurulumum)|.* kullaniyorum|makinemde|repo(m|mda|da)|ortam(im|imda)|projelerim .* disk(te|inde)|.* yolunu kullaniyorum)\b/;

/** "… bug var / … hata veriyor / … calismiyor / bilinen sorun …" */
const BUG = /\b(bug var|hata (veriyor|aliyorum|var)|calismiyor|bilinen (sorun|hata)|surekli patliyor|bozuk)\b/;

/**
 * ROOT-CAUSE FIX (real-user-test bug): explicit self-identification / naming /
 * how-to-address-me instructions — none of the four patterns above ever
 * caught "beni Ahmet olarak hatırla", "adım Ahmet", "ben Ahmet'im", "bana
 * Ahmet diye hitap et" — a user stating their own name/preferred address was
 * SILENTLY DROPPED before it ever reached governance scoring, not rejected
 * by it. This is the ONLY new pattern added; every existing pattern's
 * matching behavior is unchanged (verified: this message still does not
 * match PREFERENCE/DECISION/ENV_FACT/BUG on its own).
 *
 * "ben X'im" REQUIRES the apostrophe (Turkish orthography convention: a
 * suffix on a proper noun takes an apostrophe — "Ahmet'im" — while an
 * ordinary conjugated verb/adjective like "yorgunum"/"değilim" normally does
 * not) — this is what keeps it from false-matching "ben değilim" / "ben
 * yorgunum" as if they were identity statements.
 *
 * ROUND 2 (found by a REAL end-to-end execution, not a guess): "adim
 * [a-z]+" originally also matched "adım **ne**?" — a QUESTION about the
 * name, not a statement of it — because "ne" is just as valid a lowercase
 * word as "Ahmet" to a bare `[a-z]+`. The negative lookahead excludes the
 * common Turkish interrogatives that can immediately follow "adım" in a
 * question ("adım ne", "adım nedir", "adım neydi", "adım kim" — the last a
 * malformed-but-real way people sometimes ask).
 *
 * ROUND 3 (Memory Temporal v2 review): "adım" is also the noun "step"
 * ("sonraki adım testleri çalıştırmak", "ilk adım olarak …"), so it names
 * someone only at the start of the message or a clause, after a greeting or
 * "hayır", or as "benim adım".
 */
const IDENTITY = /\b(beni .* olarak hatirla|(?:^|[,.;!?]\s*|\bbenim |\b(?:merhaba|selam|hayir|evet|tamam|aslinda|yani|peki|bu arada|ama|fakat|ancak|artik|ve|eskiden|onceden|gecmiste|bir zamanlar|o zamanlar) )adim (?!ne\b|nedir\b|neydi\b|kim\b)[a-z][a-z0-9'-]*|ben [a-z][a-z0-9'-]*'(im|yim)\b|bana .* diye (hitap et|cagir))\b/;

/** The extractor's identity gate, for callers that read a user turn as an identity statement (the chat identity guard). */
export function isAyasIdentityStatement(text: string): boolean {
  return IDENTITY.test(fold(String(text ?? "").trim()));
}

export function extractAyasMemoryCandidates(input: {
  readonly userText: string;
  readonly ayasReply: string;
  readonly tags?: readonly string[];
}): AyasMemoryCandidate[] {
  const user = String(input.userText ?? "").trim();
  if (!user || user.length < 12) return [];
  const f = fold(user);
  const baseTags = [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))];

  const out: AyasMemoryCandidate[] = [];

  if (PREFERENCE.test(f)) {
    out.push({
      kind: "user-preference",
      title: "Kullanıcı tercihi",
      body: clean(user),
      tags: [...baseTags, "tercih"],
      source: "user-stated",
    });
  }
  if (DECISION.test(f)) {
    out.push({
      kind: "decision",
      title: "Alınan karar",
      body: clean(user),
      tags: [...baseTags, "karar"],
      source: "user-decision",
    });
  }
  if (ENV_FACT.test(f) && !PREFERENCE.test(f)) {
    out.push({
      kind: "environment-note",
      title: "Çalışma ortamı bilgisi",
      body: clean(user),
      tags: [...baseTags, "ortam"],
      source: "user-stated",
    });
  }
  if (BUG.test(f)) {
    out.push({
      kind: "known-bug",
      title: "Bilinen sorun",
      body: clean(user),
      tags: [...baseTags, "hata"],
      source: "user-stated",
    });
  }
  if (IDENTITY.test(f)) {
    // `kind: "user-preference"` + `source: "user-stated"` — reuses the
    // EXISTING governance rule that already scores exactly this shape as
    // `durable` (see `AyasMemoryGovernance.ts`); no governance change
    // needed. The "kimlik" tag is what `rankAyasMemory` gives a recall
    // priority bonus to (see `AyasMemoryRecall.ts`) so an unrelated
    // project-status note can never outrank the user's own stated identity.
    out.push({
      kind: "user-preference",
      title: "Kullanıcı kimliği / hitap tercihi",
      body: clean(user),
      tags: [...baseTags, "kimlik"],
      source: "user-stated",
    });
  }

  // de-dupe by kind+body — but never across two different exclusive fact
  // slots (Memory Temporal v2). "Artık kısa cevap ver, adım Ahmet" states a
  // response length AND a name: both are kept. When only one reading fills a
  // slot ("artık beni X olarak hatırla" is also a generic preference), that
  // one wins, so a correction can supersede the old value.
  const kept: { candidate: AyasMemoryCandidate; key: string; slot: string | null }[] = [];
  for (const candidate of out) {
    const key = `${candidate.kind}:${fold(candidate.body)}`;
    const slot = deriveAyasMemoryFact(candidate)?.key ?? null;
    const same = kept.findIndex((entry) => entry.key === key && (entry.slot === slot || entry.slot === null || slot === null));
    if (same < 0) kept.push({ candidate, key, slot });
    else if (kept[same].slot === null && slot !== null) kept[same] = { candidate, key, slot };
  }
  return kept.map((entry) => entry.candidate);
}
