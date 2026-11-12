import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { estimateTokenCost } from "../../ai/AiPricing";
import { USER_AGENT, userAgentFor } from "../backgrounds/CommonsProvider";
import type { EpisodeSource } from "../episode/EpisodeTypes";

/**
 * The open-web part of a video's research (owner, 12 Nov 2026: "sadece wikipedia dahil internetten araştırma yapmasını
 * istiyorum" — the whole internet, Wikipedia included — "telif haklarına dikkat edilsin"). OpenAI's built-in web search
 * (the account the studio already pays for; this machine has no other search key, and search engines' pages are not
 * scraped) finds reputable history pages; each page is read here, politely (robots.txt, a timeout, a size cap, public
 * hosts only), turned into plain text, and SourceResearch keeps a fact from it only when its quote is in that text — the
 * same rule as for Wikipedia. Pages give facts only: no image of theirs is taken, and their sentences stay evidence.
 *
 * This module holds the search call, the page fetch and the pure rules (which hosts, which queries, what a search
 * costs); SourceResearch runs the pass. Only the studio's production process reaches it (not the live AYAS server).
 */

// ---------------------------------------------------------------------------------------------------------------
// The search: OpenAI's Responses API with its `web_search` tool.

export interface WebHit {
  readonly url: string;
  readonly title: string;
}

export interface WebSearchAnswer {
  readonly hits: readonly WebHit[];
  /** Searches the tool ran (each is billed); 1 when the answer does not say. */
  readonly searches: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/** One web search; the studio's is `openAIWebSearch`, tests pass a fake. */
export type WebSearchCall = (prompt: string, opts: { readonly model: string; readonly maxOutputTokens: number }) => Promise<WebSearchAnswer>;

/**
 * OpenAI's price list (developers.openai.com/api/docs/pricing, read 12 Nov 2026): the `web_search` tool costs $10 per
 * 1,000 calls, and for gpt-4o-mini and gpt-4.1-mini its search content is billed as a fixed block of 8,000 input tokens
 * per call. Other models bill search content at their own rates in amounts the list does not fix, so they are not used.
 */
export const WEB_SEARCH_FEE_USD = 0.01;
export const WEB_SEARCH_CONTENT_TOKENS = 8_000;
export const WEB_SEARCH_MODELS: readonly string[] = ["gpt-4.1-mini", "gpt-4o-mini"];
/** The search answer's budget: a list of titles and links. */
export const WEB_SEARCH_MAX_OUTPUT = 700;

/** What a search's tokens and its fee come to; the token part through Atölye's one price table. */
function searchUsd(model: string, searches: number, promptTokens: number, outputTokens: number): number | undefined {
  const tokens = estimateTokenCost({ provider: "openai", model, promptTokens: searches * WEB_SEARCH_CONTENT_TOKENS + promptTokens, completionTokens: outputTokens });
  return tokens.status === "known" ? searches * WEB_SEARCH_FEE_USD + tokens.costUsd : undefined;
}

/**
 * The tool's own instructions OpenAI adds to the input besides the block (12 Nov 2026 dry run: ~490 tokens over a
 * 200-token prompt), rounded up.
 */
const WEB_SEARCH_TOOL_TOKENS = 1_000;

/** A search's worst case (one search, the tool's tokens, the prompt at V3Budget's 1.4 × chars / 4, the whole answer budget). */
export function webSearchCeilingUsd(model: string, promptChars: number, maxOutputTokens: number): number | undefined {
  return searchUsd(model, 1, WEB_SEARCH_TOOL_TOKENS + Math.ceil((promptChars * 1.4) / 4), maxOutputTokens);
}

/**
 * What a search cost: its fee and, per search, at least the 8,000-token content block — the input OpenAI reports already
 * holds it (12 Nov 2026 dry run: 8,663 input tokens for a 200-token prompt), so the larger of the two is booked.
 * Undefined without reported usage: V3Budget then books the ceiling.
 */
export function webSearchCostUsd(model: string, answer: WebSearchAnswer): number | undefined {
  if (answer.inputTokens === undefined || answer.outputTokens === undefined) return undefined;
  const searches = Math.max(1, answer.searches);
  return searchUsd(model, searches, Math.max(0, answer.inputTokens - searches * WEB_SEARCH_CONTENT_TOKENS), answer.outputTokens);
}

/** Asks the search for the sources a historian would trust; the answer is read only for its links. */
export function webSearchPrompt(query: string): string {
  return `Search the web for reputable sources on this history topic: ${query}
Prefer official military and naval history sites, museums, national archives and libraries, universities, encyclopedias
and published histories. Do not use Wikipedia, social media, forums, video sites, shops or AI-written pages.
List up to 8 sources you found, one per line as: title — URL. No other text.`;
}

/** The studio's search: one Responses API call with the `web_search` tool, at most one search, nothing stored. */
export function openAIWebSearch(fetchImpl: typeof fetch = fetch, env: Readonly<Record<string, string | undefined>> = process.env): WebSearchCall {
  return async (prompt, opts) => {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI: OPENAI_API_KEY yok");
    const res = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        input: prompt,
        // No domain filter: OpenAI refuses `filters` with gpt-4.1-mini (HTTP 400, 12 Nov 2026); webRefusal sorts the results.
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        max_tool_calls: 1,
        include: ["web_search_call.action.sources"],
        max_output_tokens: opts.maxOutputTokens,
        store: false,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`OpenAI web araması HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return readSearchAnswer(await res.json());
  };
}

/** The links of a Responses API answer: its citations (with titles), the search's sources, and links in its text. */
export function readSearchAnswer(data: unknown): WebSearchAnswer {
  const d = data as {
    output?: { type?: string; action?: { sources?: { url?: unknown; title?: unknown }[] }; content?: { text?: unknown; annotations?: { type?: string; url?: unknown; title?: unknown }[] }[] }[];
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };
  const hits: WebHit[] = [];
  const add = (url: unknown, title: unknown) => {
    if (typeof url === "string" && /^https?:\/\//.test(url)) hits.push({ url, title: typeof title === "string" ? title.trim() : "" });
  };
  let searches = 0;
  for (const item of d.output ?? []) {
    if (item.type === "web_search_call") {
      searches++;
      for (const s of item.action?.sources ?? []) add(s.url, s.title);
    }
    for (const c of item.content ?? []) {
      for (const a of c.annotations ?? []) if (a.type === "url_citation") add(a.url, a.title);
      if (typeof c.text === "string") for (const m of c.text.matchAll(/https?:\/\/[^\s)\]>"']+/g)) add(m[0].replace(/[.,;]+$/, ""), "");
    }
  }
  const n = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined);
  const byUrl = new Map<string, WebHit>();
  for (const h of hits) {
    const key = cleanUrl(h.url);
    if (!key) continue;
    const had = byUrl.get(key);
    if (!had || (!had.title && h.title)) byUrl.set(key, { url: key, title: h.title || had?.title || "" });
  }
  const inputTokens = n(d.usage?.input_tokens);
  const outputTokens = n(d.usage?.output_tokens);
  return { hits: [...byUrl.values()], searches: Math.max(1, searches), ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}) };
}

/**
 * The searches for a video: the topic, its dates and numbers, its people and ships (the cast the Wikipedia pass named),
 * and for a long video its causes and consequences — `count` of them (a Short three, a long video four).
 */
export function webQueries(konu: string, donem: string, names: readonly string[], count: number): string[] {
  const topic = donem && !konu.includes(donem) ? `${konu} ${donem}` : konu;
  const people = names.map((n) => n.replace(/\s*\([^)]*\)\s*$/, "").trim()).filter(Boolean).slice(0, 3);
  return [...new Set([topic, `${konu} timeline dates numbers losses`, ...(people.length ? [`${konu} ${people.join(", ")}`] : []), `${konu} causes and consequences`])].slice(0, count);
}

// ---------------------------------------------------------------------------------------------------------------
// Which pages are read.

/** Hosts never read: Wikipedia and its copies (read already), social media, video sites, forums, content farms, shops. */
const REFUSED_HOSTS: readonly { readonly why: string; readonly hosts: readonly string[] }[] = [
  { why: "Wikipedia (zaten okundu)", hosts: ["wikipedia.org", "wikimedia.org", "wikidata.org", "wikiwand.com", "wikizero.com", "dbpedia.org", "wiki2.org"] },
  { why: "sosyal medya", hosts: ["facebook.com", "fb.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "reddit.com", "quora.com", "pinterest.com", "linkedin.com", "tumblr.com", "threads.net", "threads.com", "discord.com", "t.me", "vk.com", "bsky.app", "mastodon.social"] },
  { why: "video sitesi", hosts: ["youtube.com", "youtu.be", "vimeo.com", "dailymotion.com", "rumble.com", "twitch.tv", "bilibili.com"] },
  { why: "forum", hosts: ["stackexchange.com", "boards.net", "proboards.com"] },
  {
    why: "içerik çiftliği / ödev / yapay zekâ sitesi",
    hosts: ["answers.com", "ehow.com", "wikihow.com", "ask.com", "reference.com", "medium.com", "quizlet.com", "coursehero.com", "studocu.com", "brainly.com", "chegg.com", "scribd.com", "enotes.com", "gradesaver.com", "ipl.org", "ukessays.com", "bartleby.com", "grokipedia.com", "everybodywiki.com", "fandom.com", "wattpad.com", "slideshare.net", "prezi.com", "academia.edu", "researchgate.net", "kiddle.co", "alchetron.com", "military-history.fandom.com"],
  },
  { why: "mağaza / arama sayfası", hosts: ["amazon.com", "amazon.co.uk", "ebay.com", "etsy.com", "google.com", "bing.com", "duckduckgo.com", "yahoo.com"] },
];


const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const onHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Why a found page is not read (a Turkish reason), or undefined when it may be. */
export function webRefusal(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "geçersiz adres";
  }
  if (u.protocol !== "https:") return "https değil";
  const host = u.hostname.replace(/^www\./, "");
  for (const r of REFUSED_HOSTS) if (r.hosts.some((d) => onHost(host, d))) return r.why;
  if (/^(?:forum|forums|community|boards|discuss)\./.test(host) || /\/(?:forums?|threads?|viewtopic|showthread|community)(?:[/.?]|$)/i.test(u.pathname)) return "forum";
  if (/\.(?:pdf|docx?|pptx?|xlsx?|zip|epub|jpe?g|png|gif|webp|svg|mp4|mp3)$/i.test(u.pathname)) return "belge/medya dosyası (yalnız HTML okunur)";
  return undefined;
}

/** How much a host is trusted for history (official, museum, archive, university, encyclopedia first). */
export function reputableScore(url: string): number {
  const host = hostOf(url);
  if (/\.(?:gov|mil)(?:\.[a-z]{2})?$|\.gov\.[a-z]{2}$|\.mil\.[a-z]{2}$/.test(host)) return 3;
  if (/\.(?:edu|ac\.[a-z]{2}|edu\.[a-z]{2})$/.test(host) || /britannica|encyclopedia/.test(host)) return 2;
  // A word in a host name is a weak sign: anyone can call a site a museum (12 Nov 2026 dry run).
  if (/museum|archive|library|histor|navy|naval|military|war|ww2|wwii/.test(host)) return 1;
  return 0;
}

/** A page's address without fragment and tracking parameters (the key for dedupe and cache). */
export function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(?:utm_|fbclid$|gclid$|ref$|ref_src$)/.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------------------------------------------
// A page as text, and its citation.

export interface WebPage {
  /** The bank's source id ("web-<host>-<hash>"). */
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly site: string;
  readonly text: string;
  /** The day it was read (YYYY-MM-DD). */
  readonly fetched: string;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", deg: "°", eacute: "é", egrave: "è", aacute: "á", uuml: "ü", ouml: "ö", auml: "ä", ccedil: "ç", shy: "" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * A page's readable text: the head, scripts, styles, navigation, headers, footers, side bars and forms dropped; its <main> or
 * <article> when that holds the text; one line per block; lines under 40 characters (menus, buttons, captions) left out.
 */
export function htmlToText(html: string, url: string): { title: string; site: string; text: string } {
  const one = (re: RegExp) => decodeEntities(re.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const title = one(/<title[^>]*>([\s\S]*?)<\/title>/i) || one(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i);
  const site = one(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i) || one(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:site_name["']/i) || hostOf(url);
  let body = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(head|title|script|style|noscript|svg|template|iframe|nav|header|footer|aside|form|button|select|canvas)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const toText = (h: string) =>
    decodeEntities(h.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|blockquote|dd|dt|table|ul|ol|figcaption|main)\s*>/gi, "\n").replace(/<[^>]+>/g, " "))
      .split("\n")
      .map((l) => l.replace(/[ \t ]+/g, " ").trim())
      .filter((l) => l.length >= 40)
      .join("\n");
  for (const tag of ["main", "article"]) {
    const inner = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)<\\/${tag}\\s*>`, "i").exec(body)?.[1];
    if (inner && toText(inner).length >= 1_500) {
      body = inner;
      break;
    }
  }
  return { title: title.slice(0, 200), site: site.slice(0, 120), text: toText(body) };
}

export function webSourceId(url: string): string {
  const host = hostOf(url).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "");
  return `web-${host.toLowerCase() || "sayfa"}-${createHash("sha256").update(cleanUrl(url) || url).digest("hex").slice(0, 8)}`;
}

/** The page's citation: its site, title, host and the day it was read (the description's "Sources" line). */
export function webSource(page: WebPage): EpisodeSource {
  const title = page.title.length > 160 ? `${page.title.slice(0, 157)}…` : page.title || hostOf(page.url);
  return { id: page.id, kunye: `${page.site}, "${title.replace(/"/g, "'")}" (${hostOf(page.url)}, read ${page.fetched})`, url: page.url };
}

// ---------------------------------------------------------------------------------------------------------------
// The polite fetch: robots.txt, public hosts only, a timeout, a size cap.

export type PageFetch = (url: string) => Promise<{ readonly ok: true; readonly body: string; readonly contentType: string; readonly finalUrl: string } | { readonly ok: false; readonly reason: string }>;

/** An address no page from the open web may point the studio at (loopback, private, link-local, reserved). */
export function privateAddress(ip: string): boolean {
  const v4 = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff");
}

/**
 * GET for a page found on the web: https only, the host must resolve to public addresses only (each redirect checked
 * again), text answers only (a PDF or an image is not downloaded), at most `maxBytes` read, `timeoutMs` per request.
 */
export function safePageFetch(opts: { readonly timeoutMs?: number; readonly maxBytes?: number; readonly fetchImpl?: typeof fetch; readonly resolve?: (host: string) => Promise<readonly string[]> } = {}): PageFetch {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const doFetch = opts.fetchImpl ?? fetch;
  if (!opts.fetchImpl) trustSystemRoots();
  const resolve = opts.resolve ?? (async (host: string) => (await lookup(host, { all: true })).map((a) => a.address));
  return async (start) => {
    let url = start;
    for (let hop = 0; hop < 6; hop++) {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        return { ok: false, reason: "geçersiz adres" };
      }
      if (u.protocol !== "https:" || (u.port && u.port !== "443") || u.username || u.password) return { ok: false, reason: "yalnız https (443)" };
      const host = u.hostname.replace(/^\[|\]$/g, "");
      if (/^(?:localhost|.*\.local|.*\.internal|.*\.lan)$/i.test(host)) return { ok: false, reason: "yerel adres" };
      try {
        const addrs = net.isIP(host) ? [host] : await resolve(host);
        if (!addrs.length || addrs.some(privateAddress)) return { ok: false, reason: "özel ağ adresi" };
      } catch (e) {
        return { ok: false, reason: `DNS: ${(e as Error).message.slice(0, 80)}` };
      }
      let res: Response;
      try {
        res = await doFetch(u.toString(), { redirect: "manual", headers: { "User-Agent": userAgentFor(u.toString()), Accept: "text/html,application/xhtml+xml,text/plain;q=0.8" }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        return { ok: false, reason: `ağ: ${(e as Error).message.slice(0, 80)}` };
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel().catch(() => {});
        url = new URL(res.headers.get("location")!, u).toString();
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, reason: `HTTP ${res.status}` };
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!/^(?:text\/(?:html|plain)|application\/xhtml\+xml)/i.test(contentType)) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, reason: `metin değil (${contentType.split(";")[0] || "türsüz"})` };
      }
      const body = await readCapped(res, maxBytes, /charset=["']?([\w-]+)/i.exec(contentType)?.[1]);
      return { ok: true, body, contentType, finalUrl: u.toString() };
    }
    return { ok: false, reason: "çok fazla yönlendirme" };
  };
}

let systemRootsTrusted = false;

/**
 * Verifies web pages against Node's bundled roots AND the operating system's store, once per process. Some official
 * sites send their certificate without its intermediate (history.navy.mil, 12 Nov 2026: "unable to verify the first
 * certificate" in Node, fine in a browser); Windows' store completes the chain. Verification stays on — only roots
 * the machine already trusts are added.
 */
function trustSystemRoots(): void {
  if (systemRootsTrusted) return;
  systemRootsTrusted = true;
  // Node ≥ 22.19 / 24.5 calls the installed @types/node does not describe yet.
  const api = tls as unknown as { getCACertificates?: (kind: "default" | "system") => string[]; setDefaultCACertificates?: (certs: readonly string[]) => void };
  try {
    if (!api.getCACertificates || !api.setDefaultCACertificates) return;
    api.setDefaultCACertificates([...new Set([...api.getCACertificates("default"), ...api.getCACertificates("system")])]);
  } catch {
    // An older Node without these calls keeps its bundled roots.
  }
}

async function readCapped(res: Response, maxBytes: number, charset: string | undefined): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset ?? "utf-8");
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(Buffer.concat(chunks).subarray(0, maxBytes));
}

/** The robots.txt agent token the studio answers to (its User-Agent starts "AtolyeV3/"). */
export const ROBOTS_AGENT = USER_AGENT.split("/")[0]!;

/**
 * Whether robots.txt lets `agent` read `pathname`: the group naming the agent, else the `*` group; the longest matching
 * Allow/Disallow rule wins (`*` and `$` understood), a tie goes to Allow, no rule allows.
 */
export function robotsAllows(robots: string, pathname: string, agent: string = ROBOTS_AGENT): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | undefined;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      if (value) current.rules.push({ allow: key === "allow", path: value });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const want = agent.toLowerCase();
  const group = groups.find((g) => g.agents.includes(want)) ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  let best: { allow: boolean; len: number } | undefined;
  for (const r of group.rules) {
    const anchored = r.path.endsWith("$");
    const body = (anchored ? r.path.slice(0, -1) : r.path).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const re = new RegExp(`^${body}${anchored ? "$" : ""}`);
    if (!re.test(pathname)) continue;
    if (!best || r.path.length > best.len || (r.path.length === best.len && r.allow)) best = { allow: r.allow, len: r.path.length };
  }
  return best?.allow ?? true;
}

// ---------------------------------------------------------------------------------------------------------------
// The 24 h cache (searches cost money, pages are read once a day at most).

const DAY_MS = 24 * 3600_000;

export async function readWebCache<T>(cacheDir: string | undefined, key: string): Promise<T | undefined> {
  if (!cacheDir) return undefined;
  const file = path.join(cacheDir, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
  if (!existsSync(file)) return undefined;
  try {
    const stat = await fs.stat(file);
    return Date.now() - stat.mtimeMs < DAY_MS ? (JSON.parse(await fs.readFile(file, "utf8")) as T) : undefined;
  } catch {
    return undefined;
  }
}

export async function writeWebCache(cacheDir: string | undefined, key: string, value: unknown): Promise<void> {
  if (!cacheDir) return;
  const file = path.join(cacheDir, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(value));
  await fs.rename(`${file}.tmp`, file);
}

/**
 * A found page read as a WebPage, or the reason it was not: a refused host, robots.txt (unreadable for a server error
 * counts as no; missing is yes), a failed fetch, not HTML, a redirect to a refused host, or too little text.
 */
export async function readWebPage(url: string, fetchPage: PageFetch, cacheDir: string | undefined, today: string): Promise<WebPage | { readonly skipped: string }> {
  const refusal = webRefusal(url);
  if (refusal) return { skipped: refusal };
  const cached = await readWebCache<WebPage>(cacheDir, `page\u0000${url}`);
  if (cached) return cached;
  const u = new URL(url);
  const robotsKey = `robots\u0000${u.origin}`;
  let robots = await readWebCache<{ body: string }>(cacheDir, robotsKey);
  if (!robots) {
    const r = await fetchPage(`${u.origin}/robots.txt`);
    if (r.ok) robots = { body: /html/i.test(r.contentType) ? "" : r.body };
    else if (/^HTTP 4\d\d$/.test(r.reason)) robots = { body: "" };
    else return { skipped: `robots.txt okunamadı (${r.reason})` };
    await writeWebCache(cacheDir, robotsKey, robots);
  }
  if (!robotsAllows(robots.body, `${u.pathname}${u.search}`)) return { skipped: "robots.txt izin vermiyor" };
  const res = await fetchPage(url);
  if (!res.ok) return { skipped: res.reason };
  if (!/html/i.test(res.contentType)) return { skipped: "HTML değil" };
  const moved = webRefusal(res.finalUrl);
  if (moved) return { skipped: `yönlendirme: ${moved}` };
  const { title, site, text } = htmlToText(res.body, res.finalUrl);
  if (text.length < 1_200) return { skipped: "okunacak metin çok kısa" };
  const page: WebPage = { id: webSourceId(res.finalUrl), url: res.finalUrl, title, site, text, fetched: today };
  await writeWebCache(cacheDir, `page\u0000${url}`, page);
  return page;
}
