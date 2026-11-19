/**
 * The title–thumbnail consistency gate of a YouTube package (owner approval 16 Nov 2026, "Faz 1: Title-Cover
 * Consistency Gate"). Rules from the MIT-licensed youtube-agent-skill (github.com/Jakeschincariol/youtube-agent-skill,
 * a2feb21, skills/yt-package): the title and the thumbnail are ONE unit, so the thumbnail must not repeat the title's
 * words; desktop search cuts a title near 60 characters and a phone feed near 40, so the subject has to come first;
 * more than two all-caps words reads as spam; an adjective like "epic" or "ultimate" says nothing a number, a name or
 * a date would not say better. Two more title rules from the MIT-licensed youtube-skills (github.com/sergebulaev/
 * youtube-skills, f422cea3, skills/yt-title-optimizer/references/title-checklist.md; owner 19 Nov 2026, "content skills —
 * bize yarıyorsa sisteme entegre et"): no AI-sounding phrases or empty reveal bridges ("deep dive", "here's what nobody
 * tells you"), and at most one dash in a title.
 *
 * Measured on the studio's 14 distinct packages up to 19 Nov 2026 (scripts/fixtures/v3-paket-dokuz.json): nine shipped a
 * thumbnail headline that repeated a title word ("POINT OF NO RETURN", "RANSOM" ×3, "SHORTEST WAR" ×2, "ATATÜRK",
 * "BIPLANES", "NIGHT"), although the model had written a non-repeating alternative every time. The gate is deterministic and costs nothing: it only re-orders the three
 * titles and three headlines the model already wrote (no model call, no API) and keeps the model's order on a tie.
 */

/** Desktop search truncation and a phone home feed's, in characters. */
export const TITLE_DESKTOP_CHARS = 60;
export const TITLE_MOBILE_CHARS = 40;
/** All-caps words in a title before it reads as spam. */
export const TITLE_MAX_CAPS_WORDS = 2;
/** Words a thumbnail headline can carry at feed size. */
export const HEADLINE_MAX_WORDS = 3;

export type PackageIssueCode = "tekrar" | "uzunluk" | "bagirma" | "mobil" | "bos-sifat" | "rakam-yok" | "kapak-kalabalik" | "yapay-dil" | "tire" | "kapak-satir" | "giris-yok" | "giris-anahtar" | "giris-yapay" | "giris-uzun";
export interface PackageIssue {
  readonly kod: PackageIssueCode;
  /** HARD issues decide the pair; SOFT ones only break ties between pairs with the same hard count. */
  readonly agirlik: "HARD" | "SOFT";
  readonly metin: string;
}

export interface PackageCheck {
  readonly baslik: string;
  readonly kapak: string;
  /** Hard issues × 10 + soft issues; lower is better. */
  readonly ceza: number;
  readonly sorunlar: readonly PackageIssue[];
  /** Whether the chosen pair differs from the model's first title + first headline. */
  readonly yenidenSiralandi: boolean;
}

const HARD_WEIGHT = 10;

const VAGUE = new Set([
  "amazing", "incredible", "insane", "crazy", "huge", "massive", "ultimate", "best", "powerful", "secret", "secrets",
  "revolutionary", "mindblowing", "epic", "perfect", "complete", "everything", "unbelievable", "legendary", "shocking",
]);
const STOP = new Set([
  "the", "a", "an", "of", "for", "to", "in", "on", "at", "by", "and", "or", "is", "are", "was", "with", "your", "you",
  "my", "i", "this", "that", "it", "how", "what", "why", "who", "vs", "shorts", "his", "her", "their", "from", "into",
]);
const ROMAN = /^[IVXLCDM]+$/;
/** Phrases that read as machine-written or as an empty reveal bridge (youtube-skills title checklist). */
const AI_PHRASES = [
  "game-changer", "game changer", "deep dive", "fundamentally", "leverage", "unlock", "unleash", "delve", "here's what",
  "here’s what", "nobody tells you", "you won't believe", "you won’t believe", "honestly", "real talk", "the truth about",
];

/** Lower-case word stems of a title or headline: possessives and a plural "s" dropped, "#Shorts" and stop words out. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.replace(/#\S+/g, " ").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []) {
    let w = raw.replace(/['’]s$/u, "").replace(/['’]/gu, "");
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    if (w.length >= 3 && !STOP.has(w)) out.add(w);
  }
  return out;
}

/** The title's subject: the part before its colon, else its first three content words. */
function subjectEnd(title: string): number {
  const colon = title.indexOf(":");
  if (colon > 0) return colon;
  const words = [...title.matchAll(/\S+/g)];
  let seen = 0;
  for (const m of words) {
    if (!STOP.has(m[0].toLocaleLowerCase("en-US").replace(/[^\p{L}]/gu, ""))) seen += 1;
    if (seen === 3) return m.index! + m[0].length;
  }
  return title.length;
}

export function lintTitle(title: string): PackageIssue[] {
  const t = title.trim();
  const issues: PackageIssue[] = [];
  if (t.length > TITLE_DESKTOP_CHARS) issues.push({ kod: "uzunluk", agirlik: "HARD", metin: `${t.length} karakter — masaüstü arama ${TITLE_DESKTOP_CHARS} civarında keser` });
  const caps = t.split(/\s+/).filter((w) => { const letters = w.replace(/[^\p{L}]/gu, ""); return letters.length > 2 && letters === letters.toLocaleUpperCase("en-US") && letters !== letters.toLocaleLowerCase("en-US") && !ROMAN.test(letters) && !w.startsWith("#"); });
  if (caps.length > TITLE_MAX_CAPS_WORDS) issues.push({ kod: "bagirma", agirlik: "HARD", metin: `${caps.length} tamamı büyük harfli kelime — ${TITLE_MAX_CAPS_WORDS} tavan, üstü spam gibi okunur` });
  if (t.length > TITLE_MOBILE_CHARS && subjectEnd(t) > TITLE_MOBILE_CHARS) issues.push({ kod: "mobil", agirlik: "SOFT", metin: `konu ilk ${TITLE_MOBILE_CHARS} karakterde bitmiyor — telefon akışında kesilir` });
  const vague = [...new Set((t.toLocaleLowerCase("en-US").match(/\p{L}+/gu) ?? []).filter((w) => VAGUE.has(w)))];
  if (vague.length) issues.push({ kod: "bos-sifat", agirlik: "SOFT", metin: `başlıkta boş sıfat: ${vague.join(", ")} — yerine sayı, ad ya da tarih` });
  const lower = t.toLocaleLowerCase("en-US");
  const phrases = AI_PHRASES.filter((x) => lower.includes(x));
  if (phrases.length) issues.push({ kod: "yapay-dil", agirlik: "SOFT", metin: `yapay zekâ gibi okunan kalıp: ${phrases.join(", ")}` });
  const dashes = (t.match(/—/g) ?? []).length + (t.match(/–|--/g) ?? []).length * 2;
  if (dashes > 1) issues.push({ kod: "tire", agirlik: "SOFT", metin: "başlıkta birden çok tire (— en çok bir kez, – ve -- hiç)" });
  if (!/\d/.test(t.replace(/#\S+/g, ""))) issues.push({ kod: "rakam-yok", agirlik: "SOFT", metin: "başlıkta sayı ya da yıl yok" });
  return issues;
}

export function lintPair(title: string, headline: string): PackageIssue[] {
  const issues = lintTitle(title);
  const shared = [...contentWords(title)].filter((w) => contentWords(headline).has(w));
  if (shared.length) issues.unshift({ kod: "tekrar", agirlik: "HARD", metin: `kapak başlığı tekrarlıyor: ${shared.join(", ")} — kapak başlığın söylemediğini söylemeli` });
  const headWords = headline.split(/\s+/).filter(Boolean).length;
  if (headWords > HEADLINE_MAX_WORDS) issues.push({ kod: "kapak-kalabalik", agirlik: "SOFT", metin: `kapakta ${headWords} kelime — akış boyutunda ${HEADLINE_MAX_WORDS} tavan` });
  const vague = [...new Set((headline.toLocaleLowerCase("en-US").match(/\p{L}+/gu) ?? []).filter((w) => VAGUE.has(w)))];
  if (vague.length) issues.push({ kod: "bos-sifat", agirlik: "SOFT", metin: `kapakta boş sıfat: ${vague.join(", ")}` });
  const lines = headlineLines(headline);
  if (lines > HEADLINE_MAX_LINES) issues.push({ kod: "kapak-satir", agirlik: "SOFT", metin: `kapak yazısı ${lines} satıra taşar — karakterin yüzünü örter` });
  return issues;
}

/**
 * Lines the thumbnail headline wraps into. remotion-v3 TitleCard "kucukresim" draws it at a fixed 150 px (1080p) in a
 * heavy face, so it stays readable when the thumbnail is 120 px wide (youtube-skills thumbnail-principles, f422cea3), in
 * a box 92 % of the width: about HEADLINE_LINE_CHARS capitals a line (measured: the 16 capitals "WHO ASSASSINATED" fill
 * 83 % of the Kosovo thumbnail). A third line covers the top 43 % of the picture.
 */
export const HEADLINE_LINE_CHARS = 17;
export const HEADLINE_MAX_LINES = 2;
export function headlineLines(headline: string): number {
  let lines = 1;
  let used = 0;
  for (const w of headline.trim().split(/\s+/).filter(Boolean)) {
    const need = used ? used + 1 + w.length : w.length;
    if (need <= HEADLINE_LINE_CHARS || !used) used = need;
    else {
      lines += 1;
      used = w.length;
    }
  }
  return lines;
}

/** Characters YouTube shows of a description before "…more" (search, under the player on a phone). */
export const DESCRIPTION_VISIBLE_CHARS = 150;
/** Openers that read as machine-written in a description (youtube-skills description-template, f422cea3). */
const DESCRIPTION_OPENERS = /^(discover|explore|dive into|join us|welcome|in this (video|short)|get ready|uncover|learn how|step into|journey)\b/i;

/**
 * The description's first lines (owner, 19 Nov 2026, youtube-skills description-template): what shows before "…more"
 * must carry the video's subject (a word of the title's subject) and its payoff, open on the story rather than on
 * "Discover…", and end its first sentence before the cut. Advisory: the issues go to the log and youtube.json.
 */
export function lintDescriptionLead(lead: string, title: string): PackageIssue[] {
  const t = lead.trim();
  if (!t) return [{ kod: "giris-yok", agirlik: "HARD", metin: "açıklamanın giriş cümleleri yok — arama ve telefon ilk satırı gösterir" }];
  const issues: PackageIssue[] = [];
  const visible = t.slice(0, DESCRIPTION_VISIBLE_CHARS);
  const clean = title.replace(/#\S+/g, " ");
  const subject = contentWords(clean.slice(0, subjectEnd(clean)));
  const seen = contentWords(visible);
  if (subject.size && ![...subject].some((w) => seen.has(w))) issues.push({ kod: "giris-anahtar", agirlik: "SOFT", metin: `ilk ${DESCRIPTION_VISIBLE_CHARS} karakterde başlığın konusu yok (${[...subject].join(", ")})` });
  const opener = DESCRIPTION_OPENERS.exec(t);
  if (opener) issues.push({ kod: "giris-yapay", agirlik: "SOFT", metin: `açıklama "${opener[0]}" ile açılıyor — doğrudan olayla başlamalı` });
  const firstEnd = t.search(/[.!?](\s|$)/);
  if ((firstEnd < 0 ? t.length : firstEnd + 1) > DESCRIPTION_VISIBLE_CHARS) issues.push({ kod: "giris-uzun", agirlik: "SOFT", metin: `ilk cümle ${DESCRIPTION_VISIBLE_CHARS} karakterde bitmiyor — "…daha fazla"da kesilir` });
  return issues;
}

const penalty = (issues: readonly PackageIssue[]) => issues.reduce((n, i) => n + (i.agirlik === "HARD" ? HARD_WEIGHT : 1), 0);

/**
 * The best title + headline pair among the model's own options, deterministically: least penalty, then the model's
 * title order, then its headline order. The chosen title and headline move to the front; the other headlines stay
 * (in the model's order) only when they do not repeat the chosen title, because the thumbnail designer draws one
 * variant per headline and its judge may pick any of them.
 */
export function choosePackagePair(titles: readonly string[], headlines: readonly string[]): { basliklar: string[]; kapakBasliklari: string[]; denetim: PackageCheck } | undefined {
  if (!titles.length || !headlines.length) return undefined;
  let best: { ti: number; hi: number; issues: PackageIssue[]; p: number } | undefined;
  titles.forEach((title, ti) => headlines.forEach((headline, hi) => {
    const issues = lintPair(title, headline);
    const p = penalty(issues);
    if (!best || p < best.p) best = { ti, hi, issues, p };
  }));
  const { ti, hi, issues, p } = best!;
  const title = titles[ti]!;
  const others = headlines.filter((h, i) => i !== hi && !lintPair(title, h).some((x) => x.kod === "tekrar"));
  return {
    basliklar: [title, ...titles.filter((_, i) => i !== ti)],
    kapakBasliklari: [headlines[hi]!, ...others],
    denetim: { baslik: title, kapak: headlines[hi]!, ceza: p, sorunlar: issues, yenidenSiralandi: ti !== 0 || hi !== 0 },
  };
}
