import { ayasSafePublicFetch } from "../../brain/autonomy/AyasSafePublicFetch";
import { PDF_MAX_BYTES, PDF_MAX_PAGES, pdfText, type PdfTextResult } from "./AyasPdfText";
import {
  applicationGate, brainsOf, canonicalUrl, contentHash, type CostClass, type KnowledgeKind, type KnowledgeRecord,
  knowledgeId, looksLikeInjection, stagesOf,
} from "./AyasSharedKnowledge";

/**
 * AYAS's internet research for any topic and any link the owner gives (owner, 5 Nov 2026). Provider-agnostic: each
 * search provider is an official, key-free public API; every request goes through `ayasSafePublicFetch` (SSRF, DNS
 * rebinding, size, redirect and content-type limits; no cookies, no credentials). Nothing fetched is executed,
 * installed or obeyed; facts are kept as quotes with their source.
 *
 * What it does not do, said plainly rather than faked: no general open-web index without an API key (the key-free
 * official APIs are encyclopedic, code, model, paper and forum search); no audio, image or video bytes (such a link is
 * recorded as ERISILEMEDI with the reason). A PDF's text is read (first pages, `AyasPdfText`); a scanned PDF without a
 * text layer is not OCR'd. A YouTube link's content is studied by the V3 reference study (captions, frames, pace), here
 * only its public oEmbed.
 */

export type FetchText = (url: string) => Promise<{ readonly ok: true; readonly body: string; readonly contentType: string; readonly finalUrl: string } | { readonly ok: false; readonly code: string; readonly message: string }>;

export const safeFetchText: FetchText = async (url) => {
  const r = await ayasSafePublicFetch(url, { timeoutMs: 15_000, maxBodyBytes: 1_500_000, acceptTruncatedBody: true });
  return r.ok ? { ok: true, body: r.body, contentType: r.contentType, finalUrl: r.finalUrl } : { ok: false, code: r.code, message: r.message };
};

/** A document fetch: PDF bytes when the server sends a PDF, else the text body (a `.pdf` link may answer with a page). */
export type FetchDocument = (url: string) => Promise<{ readonly ok: true; readonly bytes?: Buffer; readonly body: string; readonly contentType: string; readonly finalUrl: string } | { readonly ok: false; readonly code: string; readonly message: string }>;

export const safeFetchDocument: FetchDocument = async (url) => {
  const r = await ayasSafePublicFetch(url, { timeoutMs: 30_000, maxBodyBytes: PDF_MAX_BYTES, acceptTruncatedBody: true, binaryContentTypes: ["application/pdf"] });
  return r.ok ? { ok: true, ...(r.bytes ? { bytes: r.bytes } : {}), body: r.body, contentType: r.contentType, finalUrl: r.finalUrl } : { ok: false, code: r.code, message: r.message };
};

export interface SearchHit { readonly url: string; readonly baslik: string; readonly ozet: string; readonly kaynak: SearchProviderId; readonly tarih?: string; readonly lisans?: string }
export type SearchProviderId = "wikipedia" | "github" | "huggingface" | "arxiv" | "hackernews";

interface Provider { readonly id: SearchProviderId; readonly url: (q: string) => string; readonly parse: (body: string) => SearchHit[] }

const strip = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : named[e.toLowerCase()] ?? m));
}

/** Words that say nothing about the topic; the rest must show up in a hit for it to count. */
const STOP = new Set(["the", "and", "for", "with", "best", "free", "open", "source", "model", "models", "tool", "tools", "new", "how", "what", "that", "this", "from", "use", "using", "via", "2025", "2026", "ücretsiz", "için", "nasıl", "yeni", "araç", "model"]);
export const meaningfulTokens = (text: string): string[] => [...new Set(text.toLocaleLowerCase("en-US").replace(/[-_/]/g, " ").split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1 && !STOP.has(t) && !/^(?:to|of|in|on|a|an)$/.test(t)))];

/** A hit counts when it names at least half of the query's meaningful words (all of them for one or two). */
export function relevantHit(hit: Pick<SearchHit, "baslik" | "ozet">, query: string): boolean {
  const want = meaningfulTokens(query);
  if (!want.length) return true;
  const have = new Set(meaningfulTokens(`${hit.baslik} ${hit.ozet}`));
  const found = want.filter((t) => have.has(t) || [...have].some((h) => h.startsWith(t) && h.length - t.length <= 2)).length;
  return found >= (want.length <= 2 ? want.length : Math.ceil(want.length / 2));
}

const HF_TASKS: readonly (readonly [RegExp, string])[] = [
  [/text[\s-]*to[\s-]*video/i, "text-to-video"], [/image[\s-]*to[\s-]*video/i, "image-to-video"], [/text[\s-]*to[\s-]*speech|\btts\b/i, "text-to-speech"],
  [/text[\s-]*to[\s-]*image/i, "text-to-image"], [/text[\s-]*to[\s-]*(?:audio|music)|music generation/i, "text-to-audio"], [/speech[\s-]*recognition|\basr\b|speech[\s-]*to[\s-]*text/i, "automatic-speech-recognition"],
];

/** The key-free official search APIs. */
export const SEARCH_PROVIDERS: readonly Provider[] = [
  {
    id: "wikipedia",
    url: (q) => `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=${encodeURIComponent(q)}`,
    parse: (b) => ((JSON.parse(b) as { query?: { search?: { title: string; snippet: string; timestamp?: string }[] } }).query?.search ?? [])
      .map((s) => ({ url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`, baslik: s.title, ozet: strip(s.snippet), kaynak: "wikipedia" as const, ...(s.timestamp ? { tarih: s.timestamp } : {}), lisans: "CC BY-SA 4.0" })),
  },
  {
    id: "github",
    // GitHub's own best-match order (sorting by stars surfaced keyword-stuffed forks on 5 Nov 2026); forks excluded.
    url: (q) => `https://api.github.com/search/repositories?per_page=8&q=${encodeURIComponent(`${q} fork:false archived:false`)}`,
    parse: (b) => ((JSON.parse(b) as { items?: { html_url: string; full_name: string; description?: string | null; pushed_at?: string; license?: { spdx_id?: string } | null; stargazers_count?: number }[] }).items ?? [])
      .map((r) => ({ url: r.html_url, baslik: r.full_name, ozet: `${r.description ?? ""}${r.stargazers_count !== undefined ? ` (★${r.stargazers_count})` : ""}`.trim(), kaynak: "github" as const, ...(r.pushed_at ? { tarih: r.pushed_at } : {}), ...(r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? { lisans: r.license.spdx_id } : {}) })),
  },
  {
    id: "huggingface",
    // The hub's search is a substring of the model id, so a task phrase becomes its pipeline tag.
    url: (q) => {
      const task = HF_TASKS.find(([pattern]) => pattern.test(q))?.[1];
      return task ? `https://huggingface.co/api/models?limit=5&sort=downloads&pipeline_tag=${task}` : `https://huggingface.co/api/models?limit=5&sort=downloads&search=${encodeURIComponent(meaningfulTokens(q).sort((a, b) => b.length - a.length)[0] ?? q)}`;
    },
    parse: (b) => (JSON.parse(b) as { id: string; lastModified?: string; pipeline_tag?: string; downloads?: number; tags?: string[] }[])
      .map((m) => ({ url: `https://huggingface.co/${m.id}`, baslik: m.id, ozet: `${m.pipeline_tag ?? "model"}${m.downloads !== undefined ? `, ${m.downloads} indirme` : ""}`, kaynak: "huggingface" as const, ...(m.lastModified ? { tarih: m.lastModified } : {}), ...(m.tags?.find((t) => t.startsWith("license:")) ? { lisans: m.tags.find((t) => t.startsWith("license:"))!.slice(8) } : {}) })),
  },
  {
    id: "arxiv",
    // Every meaningful word must appear, best match first (newest-first returned unrelated astronomy on 5 Nov 2026).
    url: (q) => `https://export.arxiv.org/api/query?max_results=5&sortBy=relevance&search_query=${encodeURIComponent((meaningfulTokens(q).length ? meaningfulTokens(q) : [q]).map((t) => `all:${t}`).join(" AND "))}`,
    parse: (b) => [...b.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
      const get = (tag: string) => strip(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(m[1]!)?.[1] ?? "");
      return { url: get("id"), baslik: get("title"), ozet: get("summary").slice(0, 400), kaynak: "arxiv" as const, tarih: get("published") };
    }).filter((h) => h.url.startsWith("http")),
  },
  {
    id: "hackernews",
    url: (q) => `https://hn.algolia.com/api/v1/search?hitsPerPage=5&tags=story&query=${encodeURIComponent(q)}`,
    parse: (b) => ((JSON.parse(b) as { hits?: { objectID: string; title?: string; url?: string | null; created_at?: string; points?: number }[] }).hits ?? [])
      .map((h) => ({ url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, baslik: h.title ?? "", ozet: `Hacker News tartışması${h.points !== undefined ? ` (${h.points} puan)` : ""}: https://news.ycombinator.com/item?id=${h.objectID}`, kaynak: "hackernews" as const, ...(h.created_at ? { tarih: h.created_at } : {}) })),
  },
];

export interface SearchReport {
  readonly sorgu: string;
  readonly hits: readonly SearchHit[];
  readonly saglayicilar: readonly { readonly id: SearchProviderId; readonly ok: boolean; readonly sayi: number; readonly hata?: string }[];
}

/** Searches every key-free provider (or the chosen ones), deduplicated by canonical URL. One failing provider is reported, not fatal. */
/**
 * Wikimedia answers a burst from a shared address with `429` and `retry-after: 4` (x-envoy-ratelimited, seen 5 Nov 2026
 * from the office line): one wait of a few seconds and a single second try, never a loop.
 */
export const SEARCH_RATE_LIMIT_WAIT_MS = 6_000;

export async function searchWeb(query: string, options: { readonly fetchText?: FetchText; readonly providers?: readonly SearchProviderId[]; readonly wait?: (ms: number) => Promise<void> } = {}): Promise<SearchReport> {
  const q = query.trim();
  if (q.length < 2 || q.length > 300) throw new Error("WEB_SEARCH_QUERY_INVALID: 2–300 karakter");
  const fetchText = options.fetchText ?? safeFetchText;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const chosen = SEARCH_PROVIDERS.filter((p) => !options.providers || options.providers.includes(p.id));
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  const saglayicilar: { id: SearchProviderId; ok: boolean; sayi: number; hata?: string }[] = [];
  for (const p of chosen) {
    let r = await fetchText(p.url(q));
    if (!r.ok && r.code === "AYAS_FETCH_RATE_LIMITED") {
      await wait(SEARCH_RATE_LIMIT_WAIT_MS);
      r = await fetchText(p.url(q));
    }
    if (!r.ok) { saglayicilar.push({ id: p.id, ok: false, sayi: 0, hata: `${r.code}: ${r.message}`.slice(0, 160) }); continue; }
    let found: SearchHit[];
    try { found = p.parse(r.body); } catch (e) { saglayicilar.push({ id: p.id, ok: false, sayi: 0, hata: `yanıt okunamadı: ${(e as Error).message.slice(0, 100)}` }); continue; }
    let added = 0;
    // A pipeline-tag listing is relevant by construction; everything else must name the topic.
    const byTask = p.id === "huggingface" && HF_TASKS.some(([pattern]) => pattern.test(q));
    for (const h of found.filter((x) => byTask || relevantHit(x, q))) {
      let key: string;
      try { key = canonicalUrl(h.url); } catch { continue; }
      if (seen.has(key) || !h.baslik) continue;
      seen.add(key);
      hits.push(h);
      added += 1;
    }
    saglayicilar.push({ id: p.id, ok: true, sayi: added });
  }
  return { sorgu: q, hits, saglayicilar };
}

/* ------------------------------------------------------------ link study --- */

export type LinkKind = "youtube" | "github" | "pdf" | "media" | "web";

export function linkKind(url: string): LinkKind {
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return "youtube";
  if (host === "github.com" && u.pathname.split("/").filter(Boolean).length >= 2) return "github";
  if (/\.pdf$/i.test(u.pathname)) return "pdf";
  if (/\.(mp4|mov|webm|mkv|mp3|wav|ogg|m4a|flac|png|jpe?g|gif|webp)$/i.test(u.pathname)) return "media";
  return "web";
}

// The stage words live with the store (pure), so the discovery child can tag Stage 8 findings without this module.
export { brainsOf, stagesOf };

/** Evidence sentences about cost, account, licence and limits — quoted, and a cautious class from them. */
export function costEvidence(text: string, spdx?: string): { readonly sinif: CostClass; readonly kanit: string[] } {
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 20 && s.length < 400);
  const pick = (p: RegExp) => sentences.filter((s) => p.test(s)).slice(0, 3);
  const noAccount = pick(/\b(?:no (?:sign[- ]?up|account|login|registration)(?: required)?|without (?:an )?(?:account|sign[- ]?up|registration))\b/i);
  const trial = pick(/\b(?:free trial|trial credits?|free credits?|limited[- ]time|promo(?:tion)?)\b/i);
  const freeTier = pick(/\b(?:free (?:tier|plan)|free forever|free to use|\$0\b|free of charge)\b/i);
  const paid = pick(/\b(?:per month|\/mo\b|subscription|pricing|paid plan|\$\d)/i);
  const limits = pick(/\b(?:watermark|commercial use|non-commercial|quota|per day|resolution|seconds? (?:long|per)|queue)\b/i);
  const kanit = [...new Set([...noAccount, ...freeTier, ...trial, ...paid, ...limits])].slice(0, 6);
  const openLicence = !!spdx && /^(?:Apache-2\.0|MIT|BSD-[23]-Clause|GPL-[23]\.0|AGPL-3\.0|MPL-2\.0|LGPL|ISC|Unlicense|CC0-1\.0|openrail)/i.test(spdx);
  const sinif: CostClass = openLicence ? "ACIK_KAYNAK_YEREL" : noAccount.length && freeTier.length ? "UCRETSIZ_HESAPSIZ" : trial.length && !freeTier.length ? "DENEME_KREDISI" : freeTier.length ? "UCRETSIZ_HESAPLI" : paid.length ? "UCRETLI" : "BILINMIYOR";
  return { sinif, kanit };
}

const metaContent = (html: string, name: string): string | undefined => {
  const m = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i").exec(html)?.[0];
  return m ? decodeEntities(/content=["']([^"']*)["']/i.exec(m)?.[1] ?? "").trim() || undefined : undefined;
};

/** The readable text of a page: no scripts, styles, navigation or footers; headings kept as their own lines. */
export function readableText(html: string): string {
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, "\n");
  return decodeEntities(body.replace(/<[^>]+>/g, " ")).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 2).join("\n");
}

function record(input: {
  readonly url: string; readonly baslik: string; readonly tur: KnowledgeKind; readonly text: string; readonly ozet: string; readonly istek?: string;
  readonly yayinci?: string; readonly yayinTarihi?: string; readonly spdx?: string; readonly lisansKanit?: string; readonly resmi?: boolean; readonly erisilemedi?: string; readonly now: Date;
  readonly alintilar?: readonly string[]; readonly etiketler?: readonly string[];
}): KnowledgeRecord {
  const asamalar = stagesOf(`${input.baslik}\n${input.ozet}\n${input.text.slice(0, 20_000)}`);
  const cost = costEvidence(input.text, input.spdx);
  const lisans = input.spdx || input.lisansKanit ? { ...(input.spdx ? { spdx: input.spdx } : {}), kanit: input.lisansKanit ?? `SPDX ${input.spdx}` } : undefined;
  const dogrulama = input.erisilemedi
    ? { durum: "ERISILEMEDI" as const, kaynaklar: [] as string[], not: input.erisilemedi }
    : { durum: input.resmi ? "RESMI_KAYNAK" as const : "TEK_KAYNAK" as const, kaynaklar: [canonicalUrl(input.url)] };
  const injected = looksLikeInjection(input.text);
  const base = {
    schemaVersion: 1 as const, id: knowledgeId(input.url), url: canonicalUrl(input.url), baslik: input.baslik.slice(0, 200), tur: input.tur,
    ...(input.yayinci ? { yayinci: input.yayinci } : {}), ...(input.yayinTarihi ? { yayinTarihi: input.yayinTarihi } : {}),
    erisimTarihi: input.now.toISOString(), ...(lisans ? { lisans } : {}), maliyet: cost,
    alintilar: input.alintilar ?? cost.kanit.slice(0, 3), ozet: input.ozet.slice(0, 600),
    kavramlar: [...new Set(asamalar)], dogrulama, asamalar, beyinler: brainsOf(asamalar),
    firsatlar: asamalar.filter((s) => s !== "cost").map((s) => `${s} aşaması için değerlendir`),
    // Tools and prices change fast: a month for a product page, a quarter for code, papers and encyclopedias.
    tekrarKontrol: new Date(input.now.getTime() + (input.tur === "web" ? 30 : 90) * 86_400_000).toISOString(),
    etiketler: [...new Set([input.tur, ...(input.etiketler ?? [])])], icerikHash: contentHash(input.text || input.url), enjeksiyonSuphesi: injected,
    otomatikUygulanabilir: false as const, ...(input.istek ? { istek: input.istek } : {}),
  };
  return { ...base, uygulamaEngeli: applicationGate(base) };
}

export interface LinkStudyResult { readonly record: KnowledgeRecord; readonly tur: LinkKind; readonly not: string }

export interface StudyOptions {
  readonly fetchText?: FetchText;
  readonly fetchDocument?: FetchDocument;
  readonly readPdf?: (bytes: Buffer) => Promise<PdfTextResult>;
  readonly now?: Date;
  readonly istek?: string;
}

interface StudyCommon { readonly url: string; readonly now: Date; readonly istek?: string }

const LICENCE_IN_TEXT = /\b(Creative Commons [A-Za-z -]+\d\.\d|CC BY(?:-SA|-NC|-ND)*(?: \d\.\d)?|Apache License,? Version 2\.0|MIT License)\b/;

/** A fetched HTML/text page as a record: title, publisher, date and licence from the page itself. */
function pageRecord(page: { readonly body: string; readonly contentType: string; readonly finalUrl: string }, common: StudyCommon): LinkStudyResult {
  const html = page.body;
  const title = metaContent(html, "og:title") ?? strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const text = /html/i.test(page.contentType) ? readableText(html) : html;
  const description = metaContent(html, "description") ?? metaContent(html, "og:description") ?? text.split("\n").find((l) => l.length > 60) ?? "";
  const published = metaContent(html, "article:published_time") ?? /<time[^>]+datetime=["']([^"']+)["']/i.exec(html)?.[1];
  const licenceLink = /<a[^>]+rel=["']license["'][^>]*>([\s\S]*?)<\/a>/i.exec(html)?.[1];
  const licenceText = licenceLink ? strip(licenceLink) : LICENCE_IN_TEXT.exec(text)?.[1];
  const host = new URL(page.finalUrl).hostname;
  return {
    tur: "web",
    not: `sayfa okundu (${text.length} karakter metin)`,
    record: record({ ...common, url: page.finalUrl, baslik: title || host, tur: "web", text, ozet: description, yayinci: metaContent(html, "og:site_name") ?? host, ...(published ? { yayinTarihi: published } : {}), ...(licenceText ? { lisansKanit: licenceText } : {}) }),
  };
}

/** A PDF: downloaded through the safe fetch (bounded), its text read by `AyasPdfText`, kept like a page. */
async function studyPdf(url: string, common: StudyCommon, options: StudyOptions): Promise<LinkStudyResult> {
  const u = new URL(url);
  let name = u.pathname.split("/").pop() || u.hostname;
  try { name = decodeURIComponent(name); } catch { /* keep the raw name */ }
  const unread = (why: string): LinkStudyResult => ({ tur: "pdf", not: why, record: record({ ...common, baslik: name, tur: "pdf", text: "", ozet: why, erisilemedi: why }) });
  const doc = await (options.fetchDocument ?? safeFetchDocument)(url);
  if (!doc.ok) return unread(`PDF indirilemedi (${doc.code}: ${doc.message.slice(0, 100)})`);
  // A ".pdf" address that answers with a page (a landing or login page) is read as that page.
  if (!doc.bytes) return pageRecord(doc, common);
  const read = await (options.readPdf ?? pdfText)(doc.bytes);
  if (!read.ok) return unread(read.reason);
  const lines = read.text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  // The title is the first short capitalised line that is not a notice ("Attention Is All You Need" under arXiv's
  // permission line, 5 Nov 2026); the summary is the abstract when there is one.
  const notice = /permission|copyright|©|licen[cs]e|arxiv:|doi\.org|https?:\/\//i;
  const title = lines.find((l) => l.length >= 8 && l.length <= 120 && /^\p{Lu}/u.test(l) && !/[,;:]$/.test(l) && l.split(" ").length <= 16 && !notice.test(l)) ?? name;
  const abstract = /\bAbstract\b[\s.:—-]*([\s\S]{80,1200}?)(?:\n\s*\n|\n\s*(?:1\.?\s+)?Introduction\b|$)/i.exec(read.text)?.[1];
  const ozet = (abstract ? abstract.replace(/\s+/g, " ").trim() : lines.filter((l) => l.length > 60 && !notice.test(l)).slice(0, 3).join(" ") || lines.slice(0, 6).join(" ")).slice(0, 600);
  const licence = LICENCE_IN_TEXT.exec(read.text)?.[1];
  return {
    tur: "pdf",
    not: `PDF okundu (ilk ${PDF_MAX_PAGES} sayfaya kadar, ${read.text.length} karakter metin${read.kesildi ? ", kısaltıldı" : ""})`,
    record: record({ ...common, url: doc.finalUrl, baslik: title, tur: "pdf", text: read.text, ozet, yayinci: new URL(doc.finalUrl).hostname, ...(licence ? { lisansKanit: licence } : {}) }),
  };
}

/** Studies one link: what it is, what it says, under which terms; a link it cannot read is recorded as such. */
export async function studyLink(url: string, options: StudyOptions = {}): Promise<LinkStudyResult> {
  const fetchText = options.fetchText ?? safeFetchText;
  const now = options.now ?? new Date();
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { throw new Error(`LINK_INVALID: ${url}`); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("LINK_INVALID: yalnız http(s)");
  const kind = linkKind(parsed.toString());
  const common = { url: parsed.toString(), now, ...(options.istek ? { istek: options.istek } : {}) };

  if (kind === "pdf") return studyPdf(parsed.toString(), common, options);
  if (kind === "media") {
    const why = "ses/görüntü/video dosyası indirilmedi: güvenli fetch metin türleri ve PDF dışını okumaz";
    return { tur: kind, not: why, record: record({ ...common, baslik: parsed.pathname.split("/").pop() || parsed.hostname, tur: kind, text: "", ozet: why, erisilemedi: why }) };
  }

  if (kind === "youtube") {
    const r = await fetchText(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(parsed.toString())}`);
    if (!r.ok) {
      const why = `video erişilemedi (${r.code}): özel, kaldırılmış ya da bölge kısıtlı olabilir; içeriği izlenmiş gibi davranılmadı`;
      return { tur: kind, not: why, record: record({ ...common, baslik: parsed.toString(), tur: "youtube", text: "", ozet: why, erisilemedi: why }) };
    }
    const o = JSON.parse(r.body) as { title?: string; author_name?: string; author_url?: string };
    const ozet = `YouTube videosu "${o.title ?? "?"}" — ${o.author_name ?? "?"}. Bu kayıt yalnız başlık ve kanaldır; anlatım, kurgu, kamera ve ses incelemesi V3 referans incelemesinde (altyazı, kareler, tempo) yapılır.`;
    return { tur: kind, not: "V3 referans incelemesine bırakılmalı (scripts/v3/referans.ts incele / AYAS'a link)", record: record({ ...common, baslik: o.title ?? parsed.toString(), tur: "youtube", text: `${o.title ?? ""}`, ozet, ...(o.author_name ? { yayinci: o.author_name } : {}), etiketler: ["video-incelemesi-bekliyor"] }) };
  }

  if (kind === "github") {
    const [owner, repo] = parsed.pathname.split("/").filter(Boolean) as [string, string];
    const meta = await fetchText(`https://api.github.com/repos/${owner}/${repo.replace(/\.git$/, "")}`);
    if (!meta.ok) {
      const why = `GitHub deposu okunamadı (${meta.code}: ${meta.message.slice(0, 80)})`;
      return { tur: kind, not: why, record: record({ ...common, baslik: `${owner}/${repo}`, tur: "github", text: "", ozet: why, erisilemedi: why }) };
    }
    const m = JSON.parse(meta.body) as { full_name: string; description?: string | null; license?: { spdx_id?: string; name?: string } | null; pushed_at?: string; stargazers_count?: number; topics?: string[]; homepage?: string | null; archived?: boolean; owner?: { login?: string } };
    const readme = await fetchText(`https://api.github.com/repos/${m.full_name}/readme`);
    const text = readme.ok ? Buffer.from(((JSON.parse(readme.body) as { content?: string }).content ?? "").replace(/\s/g, ""), "base64").toString("utf8") : "";
    const spdx = m.license?.spdx_id && m.license.spdx_id !== "NOASSERTION" ? m.license.spdx_id : undefined;
    const headings = [...text.matchAll(/^#{1,3}\s+(.+)$/gm)].map((h) => h[1]!.trim()).slice(0, 12);
    const ozet = `${m.description ?? ""} — ★${m.stargazers_count ?? "?"}, son push ${m.pushed_at?.slice(0, 10) ?? "?"}${m.archived ? ", ARŞİVLENMİŞ" : ""}; lisans ${spdx ?? m.license?.name ?? "belirtilmemiş"}. README başlıkları: ${headings.join(" · ") || "yok"}. Kod indirilmedi, kurulmadı, çalıştırılmadı.`;
    return { tur: kind, not: readme.ok ? "README ve meta okundu" : "README okunamadı, yalnız meta", record: record({ ...common, baslik: m.full_name, tur: "github", text: `${m.description ?? ""}\n${(m.topics ?? []).join(" ")}\n${text}`, ozet, ...(m.owner?.login ? { yayinci: m.owner.login } : {}), ...(m.pushed_at ? { yayinTarihi: m.pushed_at } : {}), ...(spdx ? { spdx } : {}), ...(m.license?.name && !spdx ? { lisansKanit: m.license.name } : {}), resmi: true, etiketler: m.topics ?? [] }) };
  }

  const page = await fetchText(parsed.toString());
  if (!page.ok) {
    // A PDF behind an address without ".pdf" (arxiv.org/pdf/…, a download link) is read as a PDF.
    if (page.code === "AYAS_FETCH_UNSUPPORTED_CONTENT_TYPE" && /application\/pdf/i.test(page.message)) return studyPdf(parsed.toString(), common, options);
    const why = `sayfa okunamadı (${page.code}: ${page.message.slice(0, 100)})`;
    return { tur: kind, not: why, record: record({ ...common, baslik: parsed.hostname, tur: "web", text: "", ozet: why, erisilemedi: why }) };
  }
  return pageRecord(page, common);
}

/** How many of a topic search's first hits are read in full (a page, a README, a PDF), beside every hit's summary. */
export const TOPIC_STUDY_TOP = 2;

/**
 * A topic the owner asked AYAS to research from the chat: every provider's hits as records, and the first readable
 * hits (not YouTube or media) studied as links. Nothing is saved here; the caller stores `records`.
 */
export async function researchTopic(sorgu: string, options: StudyOptions & { readonly wait?: (ms: number) => Promise<void> } = {}): Promise<{ readonly report: SearchReport; readonly records: readonly KnowledgeRecord[]; readonly okunan: number; readonly ozet: string }> {
  const now = options.now ?? new Date();
  const report = await searchWeb(sorgu, { ...(options.fetchText ? { fetchText: options.fetchText } : {}), ...(options.wait ? { wait: options.wait } : {}) });
  const records = [...hitRecords(report, now)];
  let okunan = 0;
  for (const hit of report.hits.filter((h) => { try { return !["youtube", "media"].includes(linkKind(h.url)); } catch { return false; } }).slice(0, TOPIC_STUDY_TOP)) {
    try {
      const r = await studyLink(hit.url, { ...options, now, istek: sorgu });
      if (r.record.dogrulama.durum === "ERISILEMEDI") continue;
      // The full reading replaces the hit's one-line summary for the same URL.
      const at = records.findIndex((x) => x.id === r.record.id);
      if (at >= 0) records.splice(at, 1);
      records.push({ ...r.record, etiketler: [...new Set([...r.record.etiketler, `arama:${hit.kaynak}`])] });
      okunan += 1;
    } catch { /* the hit's summary stays */ }
  }
  const working = report.saglayicilar.filter((p) => p.ok);
  return { report, records, okunan, ozet: `${report.hits.length} sonuç (${working.map((p) => `${p.id} ${p.sayi}`).join(", ") || "hiçbir sağlayıcı cevap vermedi"}), ${okunan} sayfa tam okundu` };
}

/** Search hits as knowledge records (one per hit, quoting the provider's own summary); the provider is the source. */
export function hitRecords(report: SearchReport, now: Date = new Date()): KnowledgeRecord[] {
  return report.hits.map((h) => record({
    url: h.url, baslik: h.baslik, tur: h.kaynak === "github" ? "github" : h.kaynak === "huggingface" ? "model" : h.kaynak === "arxiv" ? "arxiv" : h.kaynak === "hackernews" ? "forum" : "wikipedia",
    text: `${h.baslik}. ${h.ozet}`, ozet: h.ozet, now, istek: report.sorgu, alintilar: [h.ozet.slice(0, 240)],
    // The repository, model card or paper is the thing's own page (first-party); an encyclopedia or a forum is not.
    ...(h.tarih ? { yayinTarihi: h.tarih } : {}), ...(h.lisans ? (h.kaynak === "wikipedia" ? { lisansKanit: `Wikipedia metni ${h.lisans}` } : { spdx: h.lisans }) : {}),
    resmi: h.kaynak === "github" || h.kaynak === "huggingface" || h.kaynak === "arxiv", etiketler: [`arama:${h.kaynak}`],
  }));
}
