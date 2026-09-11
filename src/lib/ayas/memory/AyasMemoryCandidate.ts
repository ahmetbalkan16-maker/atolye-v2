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

function fold(text: string): string {
  return String(text ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[İıI]/g, "i")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g");
}

function clean(s: string, max = 400): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** "bundan sonra … / her zaman … / lütfen … yapma / … tercih ederim / şunu unutma" */
const PREFERENCE = /\b(bundan sonra|her (zaman|seferinde)|artik|surekli|lutfen .* (yap|yapma|kullan|kullanma)|tercih ederim|istemiyorum|istiyorum ki|sunu (unutma|hatirla|not al)|kural olarak|varsayilan olarak)\b/;

/** "… karar verdik / … yapmaya karar / … kullanacagiz / … olsun dedik" */
const DECISION = /\b(karar (verdik|verildi)|karar aldik|yapmaya karar|kullanacagiz|kullanmayacagiz|.* olsun dedik|kesinlestirdik|uzerinde anlastik)\b/;

/** "benim … / … kullaniyorum / makinemde … / repo(m) … / ortam(im) …" — an environment/structure fact. */
const ENV_FACT = /\b(benim (makinem|bilgisayarim|gpu'?m|kurulumum)|.* kullaniyorum|makinemde|repo(m|mda|da)|ortam(im|imda)|projelerim .* disk(te|inde)|.* yolunu kullaniyorum)\b/;

/** "… bug var / … hata veriyor / … calismiyor / bilinen sorun …" */
const BUG = /\b(bug var|hata (veriyor|aliyorum|var)|calismiyor|bilinen (sorun|hata)|surekli patliyor|bozuk)\b/;

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

  // de-dupe by kind+body
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = `${c.kind}:${fold(c.body)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
