import { cachedJson } from "../backgrounds/CommonsProvider";
import type { EpisodeSource } from "../episode/EpisodeTypes";
import type { SourceBank } from "../script/ScriptPrompts";
import type { V3Budget, V3ModelChoice } from "../script/V3Budget";

/**
 * Builds a verified source bank for any topic, so the script writer never works from memory alone: the topic's
 * Wikipedia articles are fetched (pinned to the revision read), a model lists atomic facts each with a sentence
 * quoted from the article, and a fact is kept only if its quote really is in that article's text. The bank cites
 * the exact revisions. Hand-made banks (`content/v3/kaynaklar/*.json`) still take precedence.
 */
const WIKI = "https://en.wikipedia.org/w/api.php";
/** Characters of each article the fact extractor reads (the lead and the first sections hold the core facts). */
const ARTICLE_CHARS = 14_000;

export interface WikiArticle {
  readonly title: string;
  readonly revid: number;
  readonly timestamp: string;
  readonly text: string;
}

/** The best-matching English Wikipedia article titles for a search, in Wikipedia's relevance order. */
export async function searchArticles(cacheDir: string, query: string, limit = 3): Promise<string[]> {
  const params = new URLSearchParams({ action: "query", format: "json", list: "search", srsearch: query, srlimit: String(limit), srnamespace: "0" });
  const json = (await cachedJson(cacheDir, `${WIKI}?${params}`)) as { query?: { search?: { title: string }[] } };
  return (json.query?.search ?? []).map((s) => s.title);
}

/** Plain text of an article at its current revision, with the revision id for the citation. */
export async function fetchArticle(cacheDir: string, title: string): Promise<WikiArticle | undefined> {
  const params = new URLSearchParams({ action: "query", format: "json", titles: title, redirects: "1", prop: "extracts|revisions", explaintext: "1", exsectionformat: "plain", rvprop: "ids|timestamp" });
  const json = (await cachedJson(cacheDir, `${WIKI}?${params}`)) as { query?: { pages?: Record<string, { title: string; missing?: string; extract?: string; revisions?: { revid: number; timestamp: string }[] }> } };
  const page = Object.values(json.query?.pages ?? {})[0];
  const rev = page?.revisions?.[0];
  if (!page || page.missing !== undefined || !page.extract || !rev) return undefined;
  return { title: page.title, revid: rev.revid, timestamp: rev.timestamp, text: page.extract };
}

export function sourceId(title: string): string {
  const slug = title.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `wikipedia-${slug || "makale"}`;
}

export function articleSource(a: WikiArticle): EpisodeSource {
  return {
    id: sourceId(a.title),
    kunye: `Wikipedia, "${a.title}" (revision ${a.revid}, ${a.timestamp.slice(0, 10)})`,
    url: `https://en.wikipedia.org/w/index.php?oldid=${a.revid}`,
  };
}

/** Whitespace, quotes, dashes and case folded, so a faithful quote matches the article text. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function factPrompt(konu: string, donem: string, articles: readonly WikiArticle[], dil: "tr" | "en"): string {
  const lang = dil === "tr" ? "Turkish" : "English";
  return `You are a careful history researcher preparing a fact sheet for a short documentary.
TOPIC: ${konu}
PERIOD: ${donem}

From the articles below, list 15–30 atomic facts the documentary could use about this topic: who, what, when, where, numbers,
names, causes, consequences, and colourful verified details (good material for jokes). Only facts the article states.
For every fact give:
- "metin": the fact as one short sentence in ${lang};
- "kaynak": the article id it comes from;
- "alinti": a sentence or clause copied EXACTLY, character for character, from that article that supports it (at most 300 characters).
Disputed or legendary accounts: say so in "metin" ("according to tradition…").
Return ONLY JSON: {"olgular":[{"metin":"…","kaynak":"…","alinti":"…"}]}

${articles.map((a) => `=== ARTICLE id=${sourceId(a.title)} title="${a.title}" ===\n${a.text.slice(0, ARTICLE_CHARS)}`).join("\n\n")}`;
}

export interface ResearchFact {
  readonly metin: string;
  readonly kaynak: string;
  readonly alinti: string;
}

/** Facts whose quote is really in the cited article; the rest are counted as rejected. */
export function verifyFacts(raw: unknown, articles: readonly WikiArticle[]): { kept: ResearchFact[]; rejected: number } {
  const byId = new Map(articles.map((a) => [sourceId(a.title), normalizeForMatch(a.text)]));
  const list = typeof raw === "object" && raw !== null && Array.isArray((raw as { olgular?: unknown }).olgular) ? ((raw as { olgular: unknown[] }).olgular) : [];
  const kept: ResearchFact[] = [];
  let rejected = 0;
  const seen = new Set<string>();
  for (const item of list) {
    const f = item as Partial<ResearchFact>;
    const text = typeof f.metin === "string" ? f.metin.trim() : "";
    const quote = typeof f.alinti === "string" ? normalizeForMatch(f.alinti).replace(/^["'\s]+|["'\s.…]+$/g, "") : "";
    const article = typeof f.kaynak === "string" ? byId.get(f.kaynak) : undefined;
    if (!text || quote.length < 20 || !article || !article.includes(quote) || seen.has(text)) {
      rejected++;
      continue;
    }
    seen.add(text);
    kept.push({ metin: text, kaynak: f.kaynak!, alinti: f.alinti!.trim() });
  }
  return { kept, rejected };
}

export interface ResearchResult {
  readonly bank: SourceBank & { readonly aciklama: string; readonly reddedilen: number; readonly alintilar: readonly ResearchFact[] };
  readonly articles: readonly string[];
}

/**
 * Searches the topic (and any extra article titles), reads up to `maxArticles` articles and returns a bank with
 * only quote-verified facts. Throws when nothing verifiable was found (the writer must not run blind).
 */
export async function researchTopic(input: {
  readonly cacheDir: string;
  readonly konu: string;
  readonly donem: string;
  readonly dil: "tr" | "en";
  readonly budget: V3Budget;
  readonly model: V3ModelChoice;
  readonly extraTitles?: readonly string[];
  readonly maxArticles?: number;
  readonly log?: (s: string) => void;
}): Promise<ResearchResult> {
  const log = input.log ?? (() => {});
  const titles = [...new Set([...(input.extraTitles ?? []), ...(await searchArticles(input.cacheDir, `${input.konu} ${input.donem}`, 4))])].slice(0, input.maxArticles ?? 3);
  const articles: WikiArticle[] = [];
  for (const t of titles) {
    const a = await fetchArticle(input.cacheDir, t);
    if (a && a.text.length > 800) articles.push(a);
  }
  if (!articles.length) throw new Error(`V3_RESEARCH_NOTHING: "${input.konu}" için okunabilir Wikipedia makalesi bulunamadı`);
  log(`araştırma: ${articles.map((a) => `"${a.title}" (rev ${a.revid})`).join(", ")}`);
  const out = await input.budget.generate("arastirma", input.model, factPrompt(input.konu, input.donem, articles, input.dil), { maxTokens: 6_000, jsonSchema: { type: "object" } });
  const start = out.result.content.indexOf("{");
  const end = out.result.content.lastIndexOf("}");
  let raw: unknown = {};
  try {
    raw = start >= 0 && end > start ? JSON.parse(out.result.content.slice(start, end + 1)) : {};
  } catch {
    raw = {};
  }
  const { kept, rejected } = verifyFacts(raw, articles);
  log(`araştırma: ${kept.length} olgu alıntısıyla doğrulandı, ${rejected} olgu alıntısı makalede bulunamadığı için atıldı`);
  if (kept.length < 5) throw new Error(`V3_RESEARCH_THIN: yalnız ${kept.length} doğrulanmış olgu (en az 5 gerekli)`);
  const used = new Set(kept.map((f) => f.kaynak));
  return {
    bank: {
      aciklama: `Otomatik kaynak bankası (${new Date().toISOString().slice(0, 10)}): olgular okunan Wikipedia revizyonlarından çıkarıldı; her olgunun alıntısı makale metninde birebir bulundu.`,
      kaynaklar: articles.filter((a) => used.has(sourceId(a.title))).map(articleSource),
      olgular: kept.map((f) => ({ metin: f.metin, kaynak: f.kaynak })),
      reddedilen: rejected,
      alintilar: kept,
    },
    articles: articles.map((a) => a.title),
  };
}
