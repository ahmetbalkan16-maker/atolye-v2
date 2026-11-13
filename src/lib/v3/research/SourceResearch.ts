import path from "node:path";
import { cachedJson } from "../backgrounds/CommonsProvider";
import type { EpisodeSource } from "../episode/EpisodeTypes";
import type { SourceBank } from "../script/ScriptPrompts";
import { LONG_FORM_MIN_S, type V3Budget, V3BudgetError, type V3ModelChoice } from "../script/V3Budget";
import { infoboxFacts, parseInfobox, sectionWikitext } from "./Infobox";
import { cleanUrl, openAIWebSearch, type PageFetch, readWebCache, readWebPage, reputableScore, safePageFetch, WEB_SEARCH_MAX_OUTPUT, WEB_SEARCH_MODELS, webQueries, webRefusal, type WebHit, type WebPage, type WebSearchCall, webSearchCeilingUsd, webSearchCostUsd, webSearchPrompt, webSource, writeWebCache } from "./WebResearch";

/**
 * Builds a verified source bank for any topic, so the script writer never works from memory alone: the topic's
 * Wikipedia articles are fetched (pinned to the revision read), a model lists atomic facts each with a sentence
 * quoted from the article, and a fact is kept only if its quote really is in that article's text. The bank cites
 * the exact revisions. Hand-made banks (`content/v3/kaynaklar/*.json`) still take precedence.
 *
 * Widened on 12 Nov 2026 (owner: "video yapılırken araştırmalar genişletilsin ama telif haklarına dikkat edilsin", before
 * the Naval Battle of Guadalcanal Short — many ships, admirals and exact dates): the main article is read whole up to
 * 40,000 characters (its reference tail dropped, the aftermath kept), the people, ships and places the article names
 * most get their own articles read where they mention the topic, and the topic's Wikidata item (CC0) adds its dates,
 * place and counts. Facts are not anyone's text: the bank keeps each quote (≤300 chars) only as evidence, and the
 * writer is told to tell every fact in its own words.
 */
const WIKI = "https://en.wikipedia.org/w/api.php";
const WIKIDATA = "https://www.wikidata.org/w/api.php";

/** A JSON GET; the studio's is `cachedJson` (24 h cache, Wikimedia's polite fetch and User-Agent), tests pass a fake. */
export type JsonGet = (url: string) => Promise<unknown>;

const wikiGet = (cacheDir: string): JsonGet => (url) => cachedJson(cacheDir, url);

export interface WikiArticle {
  readonly title: string;
  readonly revid: number;
  readonly timestamp: string;
  readonly text: string;
}

/** The best-matching English Wikipedia article titles for a search, in Wikipedia's relevance order. */
export async function searchArticles(cacheDir: string, query: string, limit = 3, get: JsonGet = wikiGet(cacheDir)): Promise<string[]> {
  const params = new URLSearchParams({ action: "query", format: "json", list: "search", srsearch: query, srlimit: String(limit), srnamespace: "0" });
  const json = (await get(`${WIKI}?${params}`)) as { query?: { search?: { title: string }[] } };
  return (json.query?.search ?? []).map((s) => s.title);
}

/** Plain text of an article at its current revision, with the revision id for the citation. */
export async function fetchArticle(cacheDir: string, title: string, get: JsonGet = wikiGet(cacheDir)): Promise<WikiArticle | undefined> {
  const params = new URLSearchParams({ action: "query", format: "json", titles: title, redirects: "1", prop: "extracts|revisions", explaintext: "1", exsectionformat: "plain", rvprop: "ids|timestamp" });
  const json = (await get(`${WIKI}?${params}`)) as { query?: { pages?: Record<string, { title: string; missing?: string; extract?: string; revisions?: { revid: number; timestamp: string }[] }> } };
  const page = Object.values(json.query?.pages ?? {})[0];
  const rev = page?.revisions?.[0];
  if (!page || page.missing !== undefined || !page.extract || !rev) return undefined;
  return { title: page.title, revid: rev.revid, timestamp: rev.timestamp, text: page.extract };
}

/**
 * The battle infobox's facts of an article at the revision read (Infobox.ts), each kept only when its quote stands in the
 * rendered infobox, like any model's quote in its article; none when the article has no battle infobox or it is
 * malformed. One request for section 0's wikitext, pinned to `revid` — its own cache entry, so an extract cached before
 * 13 Nov 2026 reads as it did.
 */
export async function fetchInfoboxFacts(get: JsonGet, article: WikiArticle, dil: "tr" | "en", limit = 16): Promise<ResearchFact[]> {
  const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", prop: "revisions", revids: String(article.revid), rvprop: "ids|content", rvslots: "main", rvsection: "0" });
  const wikitext = sectionWikitext(await get(`${WIKI}?${params}`), article.revid);
  const box = wikitext ? parseInfobox(wikitext) : undefined;
  if (!box) return [];
  const { facts, text } = infoboxFacts(article.title, box, sourceId(article.title), dil, limit);
  return verifyFacts({ olgular: facts }, [{ title: article.title, text }]).kept;
}

/** The article titles an article links to (main namespace), up to `pages` × 500. */
export async function articleLinks(get: JsonGet, title: string, pages = 3): Promise<string[]> {
  const out: string[] = [];
  let cont: string | undefined;
  for (let i = 0; i < pages; i++) {
    const params = new URLSearchParams({ action: "query", format: "json", titles: title, redirects: "1", prop: "links", plnamespace: "0", pllimit: "max", ...(cont ? { plcontinue: cont } : {}) });
    const json = (await get(`${WIKI}?${params}`)) as { continue?: { plcontinue?: string }; query?: { pages?: Record<string, { links?: { title: string }[] }> } };
    for (const p of Object.values(json.query?.pages ?? {})) for (const l of p.links ?? []) out.push(l.title);
    cont = json.continue?.plcontinue;
    if (!cont) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// What of an article is read. A plain-text extract marks a heading by two blank lines before it ("\n\n\nBackground\n").

/** Headings where an article's text ends and its apparatus begins (lists, citations, links). */
const TAIL_HEADING = /^(?:see also|notes|references|citations|sources|bibliography|further reading|external links|footnotes|explanatory notes|works cited|notes and references|general and cited sources)$/i;
/** Sections a short read must not lose to its length: how it ended and what it cost. */
const OUTCOME_HEADING = /aftermath|consequence|significance|legacy|outcome|casualt|losses|result|assessment|analysis/i;

interface Section {
  readonly heading: string;
  readonly text: string;
}

/** The article's lead and its sections up to the reference tail. */
function sectionsOf(text: string): { lead: string; sections: Section[] } {
  const [lead = "", ...rest] = text.split(/\n{3,}/);
  const sections: Section[] = [];
  for (const part of rest) {
    const heading = part.split("\n", 1)[0]!.trim();
    if (TAIL_HEADING.test(heading)) break;
    sections.push({ heading, text: part });
  }
  return { lead: lead.trim(), sections };
}

/** A text cut to `chars` at its last paragraph end before the limit (a sentence's middle only when there is none). */
function cutAt(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const head = text.slice(0, chars);
  const end = head.lastIndexOf("\n");
  return end > chars * 0.5 ? head.slice(0, end) : head;
}

/**
 * What of an article the fact extractor reads, at most `chars`: the lead and the sections in order, without the
 * reference tail. When the body is longer, the outcome sections (aftermath, casualties, significance) are kept before
 * the middle ones — a read cut at 14,000 characters had the opening moves of a battle but never how it ended.
 */
export function articleExcerpt(text: string, chars: number): string {
  const { lead, sections } = sectionsOf(text);
  const whole = [lead, ...sections.map((s) => s.text)].join("\n\n\n");
  if (whole.length <= chars) return whole;
  let left = chars - Math.min(lead.length, Math.round(chars * 0.25));
  const keep = new Map<number, string>();
  const take = (i: number, cap: number) => {
    const t = cutAt(sections[i]!.text, Math.min(cap, left));
    if (t.length < 200) return;
    keep.set(i, t);
    left -= t.length + 3;
  };
  const reserve = Math.round(chars * 0.3);
  let reserved = 0;
  sections.forEach((s, i) => {
    if (OUTCOME_HEADING.test(s.heading) && reserved < reserve && left > 200) {
      const before = left;
      take(i, reserve - reserved);
      reserved += before - left;
    }
  });
  sections.forEach((_, i) => {
    if (!keep.has(i) && left > 200) take(i, left);
  });
  return [cutAt(lead, Math.round(chars * 0.25)), ...sections.flatMap((_, i) => (keep.has(i) ? [keep.get(i)!] : []))].join("\n\n\n");
}

// ---------------------------------------------------------------------------------------------------------------
// The cast: the people, ships and places the main article names most, read where they mention the topic.

/** Words that make an event's title (the topic itself is what is left: "Naval Battle of Guadalcanal" → "Guadalcanal"). */
const EVENT_HEAD = /^(?:(?:first|second|third|naval|air|great|siege|battle|battles|fall|sack|attack|raid|crossing|capture|conquest|bombing|invasion|massacre|defence|defense|relief|evacuation|burning|destruction|treaty|peace|assassination|death|coronation|sinking|landing|landings|liberation|occupation|surrender)\s+)+(?:(?:of|on|at|in|off)\s+)?(?:the\s+)?/i;
const EVENT_TAIL = /\s+(?:war|campaign|rebellion|revolt|uprising|crisis|incident|affair|offensive|expedition|raid)$/i;

/** The name the topic's own article is about ("Attack on Pearl Harbor" → "Pearl Harbor"), to find it in other articles. */
export function topicPhrase(title: string): string {
  const base = title.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const phrase = base.replace(EVENT_HEAD, "").replace(EVENT_TAIL, "").trim();
  return phrase.length >= 3 ? phrase : base;
}

/** Linked articles that name no person, ship or place of the event: wars, units, countries' forces, lists, awards. */
const GENERIC_TITLE = /\b(?:wars?|campaigns?|battles?|operations?|navy|navies|army|armies|air force|corps|fleets?|divisions?|regiments?|brigades?|squadrons?|flotillas?|empire|kingdom|republic|states|list|class|ocean|world|history|order|medal|cross|awards?|theat(?:er|re)|front|forces?|command|timeline|language|people)\b/i;
/** A ship article's type prefix ("Japanese battleship Hiei", "USS South Dakota"): the text calls it by its name. */
const SHIP_PREFIX = /^(?:(?:USS|HMS|HMAS|HMNZS|HMCS|SMS|HNLMS|RMS|SS)\s+|(?:Japanese|German|Italian|French|British|Soviet|Russian|American|Australian|Dutch|Ottoman|Spanish)\s+(?:(?:light|heavy|aircraft|seaplane|escort|armoured|armored|protected|ocean)\s+)?(?:battleship|cruiser|destroyer|carrier|submarine|tender|transport|ship|battlecruiser|frigate|corvette|gunboat|minelayer|minesweeper|ironclad|liner)\s+)/i;
const PLACE_WORD = /\b(?:Island|Islands|River|Sound|Field|Bay|Strait|Point|Cape|Mount|Harbor|Harbour|Sea|Lake|Gulf|Channel|Pass|Valley|Hill|Ridge|Fort|Castle|City)\b/;

/** Links to a rank's or a catalogue's article ("Rear Admiral", "ISBN (identifier)"): no one in the story. */
const NO_ONE = /^(?:(?:(?:rear|vice|fleet|lieutenant|major|brigadier|grand)\s+)?(?:admiral|general|captain|commander|commodore|colonel|lieutenant|ensign|marshal|sultan|king|emperor)|isbn|issn|oclc|doi|jstor|s2cid|pmid|bibcode)$|\bidentifier\b/i;

/** How the main text calls a linked title: its name, and for a person also the surname alone. */
function castKeys(title: string): { keys: string[]; person: boolean } {
  const ship = SHIP_PREFIX.test(title);
  const name = title.replace(/\s*\([^)]*\)\s*$/, "").replace(SHIP_PREFIX, "").trim();
  const words = name.split(/\s+/);
  const person = !ship && words.length >= 2 && words.length <= 4 && words.every((w) => /^\p{Lu}[\p{L}'’.-]*$/u.test(w)) && !PLACE_WORD.test(name);
  return { keys: person ? [name, words.at(-1)!] : [name], person };
}

/** Times `key` stands in `text` as whole words (case kept: "Lee" the admiral, not "lee" the shore). */
function mentions(text: string, key: string): number {
  if (key.length < 3) return 0;
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "gu"))?.length ?? 0;
}

/**
 * The linked articles worth reading for the cast: ranked by how often the main article names them, a person's count
 * doubled (a name in the lead counts five more), at least twice; generic links (wars, navies, ranks, lists, years), the
 * articles already read and the topic's own place are left out. Measured need (Taranto, 11 Nov 2026): the writer
 * invented an admiral because no fact named the real one; on the real Guadalcanal article (12 Nov 2026) ships alone
 * filled the first places until people counted double.
 */
export function castCandidates(main: WikiArticle, links: readonly string[], skip: readonly string[], limit: number): string[] {
  const lead = main.text.split(/\n{3,}/, 1)[0] ?? "";
  const topic = normalizeForMatch(topicPhrase(main.title));
  const skipped = new Set(skip.map(normalizeForMatch));
  const words = new Map<string, number>();
  for (const w of main.text.match(/[\p{L}\p{N}'’.-]+/gu) ?? []) words.set(w, (words.get(w) ?? 0) + 1);
  const scored: { title: string; score: number }[] = [];
  for (const title of new Set(links)) {
    const name = title.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (skipped.has(normalizeForMatch(title)) || /\d/.test(name) || GENERIC_TITLE.test(name) || NO_ONE.test(title) || normalizeForMatch(name).includes(topic)) continue;
    const { keys, person } = castKeys(title);
    // Cheap first look: a key whose first word the text never uses is not counted.
    if (!keys.some((k) => words.has(k.split(/\s+/)[0]!))) continue;
    const count = Math.max(...keys.map((k) => mentions(main.text, k)));
    if (count < 2) continue;
    scored.push({ title, score: count * (person ? 2 : 1) + (keys.some((k) => mentions(lead, k) > 0) ? 5 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit).map((s) => s.title);
}

/**
 * What of a cast article is read: its opening (who or what it is) and the paragraphs that mention the topic, at most
 * `chars`; undefined when the article never mentions it (a country, a namesake — not part of this story).
 */
export function castExcerpt(article: WikiArticle, phrase: string, chars: number): string | undefined {
  const want = normalizeForMatch(phrase);
  const { lead, sections } = sectionsOf(article.text);
  const paragraphs = sections.flatMap((s) => s.text.split(/\n+/).slice(1)).filter((p) => p.length > 80 && normalizeForMatch(p).includes(want));
  if (!paragraphs.length && !normalizeForMatch(lead).includes(want)) return undefined;
  return cutAt([cutAt(lead, 1_500), ...paragraphs].join("\n\n"), chars);
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

/**
 * How deep the research goes for a video of this length: a long one (owner, 3 Nov 2026: "uzun hikâyede konunun derinine
 * kadar inmeli") reads more articles and keeps three times the facts — background, causes, every phase, consequences —
 * so the chapters rest on the story itself instead of padding thirty facts over twenty minutes.
 */
export interface ResearchDepth {
  /** Topic articles read (the first one is the main article). */
  readonly articles: number;
  /** Search hits looked at for them. */
  readonly search: number;
  /** Facts asked of the topic articles. */
  readonly facts: string;
  readonly maxTokens: number;
  readonly long: boolean;
  /** Characters of the main article read (articleExcerpt), and of each other topic article. */
  readonly mainChars: number;
  readonly otherChars: number;
  /** Cast articles read (castCandidates), characters of each (castExcerpt), facts asked of each, and their answer budget. */
  readonly cast: number;
  readonly castChars: number;
  readonly castFacts: string;
  readonly castTokens: number;
  /** Open-web searches (webQueries), pages read from their results, characters of each page, facts asked of each, facts kept of each, and their answer budget. */
  readonly webQueries: number;
  readonly webPages: number;
  readonly webChars: number;
  readonly webFacts: string;
  readonly webPerPage: number;
  readonly webTokens: number;
}

/**
 * Cost at gpt-4.1-mini ($0.40 / $1.60 per million tokens), as V3Budget books its ceiling (prompt chars × 1.4 / 4 plus
 * the whole answer budget): a Short's two calls ≤ ~$0.034 (topic ≤ 84k chars + 9k answer; cast ≤ 32k + 2.5k), a long
 * video's ≤ ~$0.055 — until 12 Nov 2026 a Short read 3 × 14k chars for ≤ ~$0.016. The open web adds per search ≤ ~$0.015
 * (OpenAI's $0.01 fee, its 8,000-token content block, the prompt and a 700-token answer) and one fact call over the pages
 * (a Short's 4 × 8k chars ≤ ~$0.011): a Short's web pass ≤ ~$0.056, a long video's (4 searches, 6 × 10k) ≤ ~$0.08.
 */
export function researchDepth(seconds: number | undefined): ResearchDepth {
  return seconds !== undefined && seconds > LONG_FORM_MIN_S
    ? { articles: 6, search: 8, facts: "40–90", maxTokens: 12_000, long: true, mainChars: 40_000, otherChars: 20_000, cast: 8, castChars: 8_000, castFacts: "2–4", castTokens: 4_500, webQueries: 4, webPages: 6, webChars: 10_000, webFacts: "3–6", webPerPage: 8, webTokens: 6_000 }
    : { articles: 4, search: 6, facts: "25–45", maxTokens: 9_000, long: false, mainChars: 40_000, otherChars: 14_000, cast: 6, castChars: 5_000, castFacts: "1–3", castTokens: 2_500, webQueries: 3, webPages: 4, webChars: 8_000, webFacts: "2–5", webPerPage: 6, webTokens: 3_500 };
}

/** The rule every fact list states: a fact is the source's information, its quote only the evidence for checking. */
const QUOTE_RULE = `- "alinti": a sentence or clause copied EXACTLY, character for character, from that article that supports it (at most 300 characters). It is
  evidence for checking only — "metin" says the fact in your own words, never the article's sentence again.`;

export function factPrompt(konu: string, donem: string, articles: readonly WikiArticle[], dil: "tr" | "en", seconds?: number): string {
  const lang = dil === "tr" ? "Turkish" : "English";
  const depth = researchDepth(seconds);
  return `You are a careful history researcher preparing a fact sheet for a ${depth.long ? `long documentary (${Math.round(seconds! / 60)} minutes, told in chapters)` : "short documentary"}.
TOPIC: ${konu}
PERIOD: ${donem}

From the articles below, list ${depth.facts} atomic facts the documentary could use about this topic: who, what, when, where, numbers,
names, causes, consequences, and colourful verified details (good material for jokes). Only facts the article states.${
    depth.long
      ? `
Cover the WHOLE story in depth, in this order: the background and the causes; the people, their motives and rivalries; every
phase of the events with its places, dates and numbers; the turning points; the consequences and what it changed. A long
documentary that has only the headline facts skips the story between them.`
      : ""
  }
For every fact give:
- "metin": the fact as one short sentence in ${lang};
- "kaynak": the article id it comes from;
${QUOTE_RULE}
Name people with rank and full name, ships with their type, and give exact dates, times and numbers where the article does.
Disputed or legendary accounts: say so in "metin" ("according to tradition…").
Return ONLY JSON: {"olgular":[{"metin":"…","kaynak":"…","alinti":"…"}]}

${articles.map((a, i) => `=== ARTICLE id=${sourceId(a.title)} title="${a.title}" ===\n${articleExcerpt(a.text, i === 0 ? depth.mainChars : depth.otherChars)}`).join("\n\n")}`;
}

/** The cast articles' fact list: each person, ship or place in this topic (their opening and the parts that mention it). */
export function castFactPrompt(konu: string, donem: string, cast: readonly { readonly article: WikiArticle; readonly excerpt: string }[], dil: "tr" | "en", seconds?: number): string {
  const lang = dil === "tr" ? "Turkish" : "English";
  const depth = researchDepth(seconds);
  return `You are a careful history researcher. A documentary is about this topic:
TOPIC: ${konu}
PERIOD: ${donem}

Below are the Wikipedia articles of people, ships and places that took part in it — each article's opening and only the
parts that mention the topic. For EACH article list ${depth.castFacts} atomic facts about that person, ship or place IN
this topic: who or what they were (rank and full name, ship type and navy), what they did or what happened to them in it,
and when. Only facts the article states; nothing about other events.
For every fact give:
- "metin": the fact as one short sentence in ${lang};
- "kaynak": the article id it comes from;
${QUOTE_RULE}
Return ONLY JSON: {"olgular":[{"metin":"…","kaynak":"…","alinti":"…"}]}

${cast.map((c) => `=== ARTICLE id=${sourceId(c.article.title)} title="${c.article.title}" ===\n${c.excerpt}`).join("\n\n")}`;
}

/**
 * The open-web pages' fact list: what each page ADDS to the facts Wikipedia already gave (exact dates, numbers, names,
 * ships and their fates, first-hand details), with the same quote rule — the pages are other authors' writing.
 */
export function webFactPrompt(konu: string, donem: string, pages: readonly WebPage[], known: readonly string[], dil: "tr" | "en", seconds?: number): string {
  const lang = dil === "tr" ? "Turkish" : "English";
  const depth = researchDepth(seconds);
  let left = 5_000;
  const knownLines = known.filter((k) => (left -= k.length + 3) > 0).map((k) => `- ${k}`).join("\n");
  return `You are a careful history researcher. A documentary is about this topic:
TOPIC: ${konu}
PERIOD: ${donem}

Below are pages from history sites on the open web (museums, archives, official histories, universities, encyclopedias).
For EACH page list ${depth.webFacts} atomic facts about this topic that ADD to the known facts below: exact dates and times,
numbers, people with rank and full name, ships with their type and what happened to them, places, first-hand details.
Leave out a fact the known list already has, anything about other events, and the site's menus, ads and comments.
Only facts the page states. For every fact give:
- "metin": the fact as one short sentence in ${lang};
- "kaynak": the page id it comes from;
${QUOTE_RULE}
Return ONLY JSON: {"olgular":[{"metin":"…","kaynak":"…","alinti":"…"}]}

KNOWN FACTS (from Wikipedia — do not repeat them):
${knownLines || "- (none)"}

${pages.map((p) => `=== PAGE id=${p.id} site="${p.site}" title="${p.title}" ===\n${cutAt(p.text, depth.webChars)}`).join("\n\n")}`;
}

/**
 * Whether a page's text is Wikipedia's own (a mirror or a copy site; 12 Nov 2026 dry run: one of four pages found for
 * Guadalcanal was the Wikipedia article again): at least 4 of its first 30 long sentences, and 40 % of them, stand word
 * for word in the Wikipedia texts read. `wiki` is those texts through normalizeForMatch.
 */
export function copiesWikipedia(text: string, wiki: string): boolean {
  const sentences = text.split(/(?<=[.!?])\s+/).map(normalizeForMatch).filter((s) => s.length >= 80).slice(0, 30);
  const copied = sentences.filter((s) => wiki.includes(s)).length;
  return copied >= 4 && copied >= sentences.length * 0.4;
}

/** Content words of a fact, folded, for telling a repeated fact from a new one. */
function factWords(text: string): Set<string> {
  return new Set(normalizeForMatch(text).normalize("NFD").replace(/\p{M}/gu, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 || /\d/.test(w)));
}

/** Whether a fact says what one already in the bank says (most of its words shared, its numbers all the same). */
export function repeatsFact(fact: string, known: readonly string[]): boolean {
  const a = factWords(fact);
  const nums = [...a].filter((w) => /\d/.test(w));
  return known.some((k) => {
    const b = factWords(k);
    const shared = [...a].filter((w) => b.has(w)).length;
    return shared / Math.max(1, Math.min(a.size, b.size)) >= 0.75 && nums.every((n) => b.has(n));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Wikidata (CC0): the topic item's dates, place and counts as facts, cited by item and revision.

interface WikidataSnak {
  readonly snaktype?: string;
  readonly datavalue?: { readonly type?: string; readonly value?: unknown };
}
interface WikidataClaim {
  readonly mainsnak?: WikidataSnak;
  readonly rank?: string;
  readonly qualifiers?: Readonly<Record<string, readonly WikidataSnak[]>>;
}
export interface WikidataEntity {
  readonly id: string;
  readonly lastrevid?: number;
  readonly modified?: string;
  readonly missing?: string;
  readonly labels?: Readonly<Record<string, { readonly value: string }>>;
  readonly claims?: Readonly<Record<string, readonly WikidataClaim[]>>;
}

type Say = (label: string, value: string) => string;
const WIKIDATA_PROPS: Readonly<Record<string, { readonly name: string; readonly kind: "time" | "coord" | "item" | "count"; readonly en: Say; readonly tr: Say }>> = {
  P580: { name: "start time", kind: "time", en: (l, v) => `${l} began on ${v}.`, tr: (l, v) => `${l} ${v} tarihinde başladı.` },
  P582: { name: "end time", kind: "time", en: (l, v) => `${l} ended on ${v}.`, tr: (l, v) => `${l} ${v} tarihinde sona erdi.` },
  P585: { name: "point in time", kind: "time", en: (l, v) => `${l} took place on ${v}.`, tr: (l, v) => `${l} ${v} tarihinde gerçekleşti.` },
  P625: { name: "coordinate location", kind: "coord", en: (l, v) => `${l} is placed at ${v}.`, tr: (l, v) => `${l} şu konumdadır: ${v}.` },
  P276: { name: "location", kind: "item", en: (l, v) => `${l} took place at ${v}.`, tr: (l, v) => `${l} şurada geçti: ${v}.` },
  P361: { name: "part of", kind: "item", en: (l, v) => `${l} was part of ${v}.`, tr: (l, v) => `${l} şunun parçasıydı: ${v}.` },
  P710: { name: "participant", kind: "item", en: (l, v) => `Participants in ${l} included ${v}.`, tr: (l, v) => `${l} katılanları: ${v}.` },
  P1120: { name: "number of deaths", kind: "count", en: (l, v) => `${l}: ${v} deaths.`, tr: (l, v) => `${l}: ${v} ölü.` },
  P1339: { name: "number of injured", kind: "count", en: (l, v) => `${l}: ${v} injured.`, tr: (l, v) => `${l}: ${v} yaralı.` },
  P1446: { name: "number of missing", kind: "count", en: (l, v) => `${l}: ${v} missing.`, tr: (l, v) => `${l}: ${v} kayıp.` },
  P1590: { name: "number of casualties", kind: "count", en: (l, v) => `${l}: ${v} casualties.`, tr: (l, v) => `${l}: ${v} zayiat.` },
  P1132: { name: "number of participants", kind: "count", en: (l, v) => `${l}: ${v} participants.`, tr: (l, v) => `${l}: ${v} katılımcı.` },
};
/** Qualifiers that say whose a count is ("of", "applies to part", "member of"). */
const WHOSE = ["P642", "P518", "P1001", "P710"] as const;
const MONTHS = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  tr: ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"],
} as const;
const MAX_ITEM_VALUES = 12;

/** A Wikidata time as a reader says it, to its precision (day, month or year); undefined below a year. */
export function wikidataTime(value: { readonly time?: string; readonly precision?: number; readonly calendarmodel?: string }, dil: "tr" | "en"): string | undefined {
  const m = /^([+-])(\d+)-(\d\d)-(\d\d)T/.exec(value.time ?? "");
  if (!m || value.precision === undefined || value.precision < 9) return undefined;
  const year = Number(m[2]);
  const y = m[1] === "-" ? (dil === "tr" ? `MÖ ${year}` : `${year} BC`) : String(year);
  const month = MONTHS[dil][Number(m[3]) - 1];
  const text = value.precision >= 11 && month ? `${Number(m[4])} ${month} ${y}` : value.precision === 10 && month ? `${month} ${y}` : y;
  return /Q1985786$/.test(value.calendarmodel ?? "") ? `${text}${dil === "tr" ? " (Jülyen takvimi)" : " (Julian calendar)"}` : text;
}

/** The claims worth reading: deprecated ones never, and the preferred ones alone when there are any. */
function bestClaims(claims: readonly WikidataClaim[] | undefined): WikidataClaim[] {
  const live = (claims ?? []).filter((c) => c.rank !== "deprecated" && c.mainsnak?.snaktype === "value");
  const preferred = live.filter((c) => c.rank === "preferred");
  return preferred.length ? preferred : live;
}

const itemId = (snak: WikidataSnak | undefined): string | undefined => {
  const v = snak?.datavalue?.value as { id?: unknown } | undefined;
  return snak?.datavalue?.type === "wikibase-entityid" && typeof v?.id === "string" && /^Q\d+$/.test(v.id) ? v.id : undefined;
};

/** The items whose English labels the facts need (values and whose-qualifiers). */
export function wikidataItemIds(entity: WikidataEntity): string[] {
  const ids = new Set<string>();
  for (const [pid, prop] of Object.entries(WIKIDATA_PROPS)) {
    for (const c of bestClaims(entity.claims?.[pid]).slice(0, prop.kind === "item" ? MAX_ITEM_VALUES : 6)) {
      const id = itemId(c.mainsnak);
      if (id) ids.add(id);
      for (const q of WHOSE) for (const s of c.qualifiers?.[q] ?? []) if (itemId(s)) ids.add(itemId(s)!);
    }
  }
  return [...ids].slice(0, 50);
}

export function wikidataSource(entity: WikidataEntity): EpisodeSource {
  const label = entity.labels?.en?.value ?? entity.id;
  return {
    id: `wikidata-${entity.id.toLowerCase()}`,
    kunye: `Wikidata, ${entity.id} "${label}" (revision ${entity.lastrevid ?? "?"}${entity.modified ? `, ${entity.modified.slice(0, 10)}` : ""}; CC0)`,
    url: entity.lastrevid ? `https://www.wikidata.org/w/index.php?title=${entity.id}&oldid=${entity.lastrevid}` : `https://www.wikidata.org/wiki/${entity.id}`,
  };
}

/**
 * The item's facts in the bank's shape: "metin" a sentence from the data, "alinti" the statement itself (item, property,
 * raw value) as its evidence. A value without an English label is left out — an item id is never shown as a name.
 */
export function wikidataFacts(entity: WikidataEntity, labels: ReadonlyMap<string, string>, dil: "tr" | "en"): ResearchFact[] {
  const label = entity.labels?.en?.value;
  if (!label) return [];
  const kaynak = wikidataSource(entity).id;
  const out: ResearchFact[] = [];
  const evidence = (pid: string, raw: string) => `${entity.id} ${pid} (${WIKIDATA_PROPS[pid]!.name}): ${raw}`;
  for (const [pid, prop] of Object.entries(WIKIDATA_PROPS)) {
    const claims = bestClaims(entity.claims?.[pid]);
    if (!claims.length) continue;
    if (prop.kind === "item") {
      const names = claims.slice(0, MAX_ITEM_VALUES).map((c) => labels.get(itemId(c.mainsnak) ?? "")).filter((n): n is string => Boolean(n));
      if (names.length) out.push({ metin: prop[dil](label, names.join(", ")), kaynak, alinti: evidence(pid, names.join("; ")) });
      continue;
    }
    for (const c of claims.slice(0, 6)) {
      const v = c.mainsnak?.datavalue?.value as Record<string, unknown> | undefined;
      if (!v) continue;
      if (prop.kind === "time") {
        const said = wikidataTime(v as { time?: string; precision?: number; calendarmodel?: string }, dil);
        if (said) out.push({ metin: prop[dil](label, said), kaynak, alinti: evidence(pid, `${String(v.time)} (precision ${String(v.precision)})`) });
      } else if (prop.kind === "coord") {
        const lat = Number(v.latitude), lon = Number(v.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const [n, s, e, w] = dil === "tr" ? ["K", "G", "D", "B"] : ["N", "S", "E", "W"];
        out.push({ metin: prop[dil](label, `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? s : n}, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? w : e}`), kaynak, alinti: evidence(pid, `${lat}, ${lon}`) });
      } else {
        const amount = Number(v.amount);
        if (!Number.isFinite(amount) || (v.unit !== undefined && v.unit !== "1")) continue;
        const whose = WHOSE.flatMap((q) => (c.qualifiers?.[q] ?? []).map((s) => labels.get(itemId(s) ?? ""))).filter((x): x is string => Boolean(x));
        const count = amount.toLocaleString(dil === "tr" ? "tr-TR" : "en-US");
        const said = whose.length ? `${count} (${dil === "tr" ? "" : "of "}${whose.join(", ")})` : count;
        out.push({ metin: prop[dil](label, said), kaynak, alinti: evidence(pid, `${String(v.amount)}${whose.length ? ` of ${whose.join(", ")}` : ""}`) });
      }
    }
  }
  return out;
}

/** The Wikidata item an article is the sitelink of ("Q…"), or undefined. */
export async function wikidataItem(get: JsonGet, title: string): Promise<string | undefined> {
  const params = new URLSearchParams({ action: "query", format: "json", titles: title, redirects: "1", prop: "pageprops", ppprop: "wikibase_item" });
  const json = (await get(`${WIKI}?${params}`)) as { query?: { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> } };
  const id = Object.values(json.query?.pages ?? {})[0]?.pageprops?.wikibase_item;
  return id && /^Q\d+$/.test(id) ? id : undefined;
}

/** An item's facts with their source, read from Wikidata (two requests); undefined when it has none. */
export async function fetchWikidataFacts(get: JsonGet, qid: string, dil: "tr" | "en"): Promise<{ source: EpisodeSource; facts: ResearchFact[] } | undefined> {
  const entityUrl = `${WIKIDATA}?${new URLSearchParams({ action: "wbgetentities", format: "json", ids: qid, props: "info|claims|labels", languages: "en" })}`;
  const entity = ((await get(entityUrl)) as { entities?: Record<string, WikidataEntity> }).entities?.[qid];
  if (!entity || entity.missing !== undefined) return undefined;
  const ids = wikidataItemIds(entity);
  const labels = new Map<string, string>();
  if (ids.length) {
    const labelUrl = `${WIKIDATA}?${new URLSearchParams({ action: "wbgetentities", format: "json", ids: ids.join("|"), props: "labels", languages: "en" })}`;
    const json = (await get(labelUrl)) as { entities?: Record<string, WikidataEntity> };
    for (const [id, e] of Object.entries(json.entities ?? {})) if (e.labels?.en?.value) labels.set(id, e.labels.en.value);
  }
  const facts = wikidataFacts(entity, labels, dil);
  return facts.length ? { source: wikidataSource(entity), facts } : undefined;
}

/**
 * The topic as English Wikipedia knows it. AYAS orders carry the owner's own words (often Turkish, "Sezar'ın Rubicon'u
 * geçmesi") and, without a year, a placeholder period; searching English Wikipedia with those finds nothing (22 Oct
 * 2026: the first AYAS order stopped in research four times).
 */
export interface TopicResolution {
  /** The topic in English, for the search. */
  readonly konu: string;
  /** The period with a year ("49 BC", "1453", "1914–1918"); empty when the model could not tell. */
  readonly donem: string;
  /** English Wikipedia article titles most about the topic, best first. */
  readonly wiki: readonly string[];
}

export function topicPrompt(konu: string, donem: string): string {
  return `A documentary was ordered with the words below (they may be Turkish or another language).
TOPIC: ${konu}
PERIOD: ${donem}

Name the topic as English Wikipedia knows it. Return ONLY JSON:
{"konu":"the topic in English","donem":"the period with its year, e.g. 49 BC, 1453, 1914–1918","wiki":["exact English Wikipedia article titles most about this topic, best first, at most 3"]}
If PERIOD has no year, give the year of the event itself. Never invent an article title you are not sure exists.
Turkish words mean what Turkish history books mean by them, and a misspelling is read as the name it is closest to: a
battle named without a year is the battle Turkish readers know by that name, not a modern war of the same place —
"Kosova Savaşı" (or "Kosava") is the Battle of Kosovo of 1389 ("II. Kosova" is 1448), "Malazgirt" the Battle of
Manzikert (1071), "Niğbolu" the Battle of Nicopolis (1396), "Mohaç" the Battle of Mohács (1526), "Çanakkale" the
Gallipoli campaign (1915). Choose a modern conflict only when the words say so (a year, "NATO", "1999", "war of 1998").`;
}

/** The model's answer, or undefined when it is not usable (no English topic and no title). */
export function readTopic(content: string): TopicResolution | undefined {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  let raw: { konu?: unknown; donem?: unknown; wiki?: unknown } = {};
  try {
    raw = start >= 0 && end > start ? JSON.parse(content.slice(start, end + 1)) : {};
  } catch {
    return undefined;
  }
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const wiki = (Array.isArray(raw.wiki) ? raw.wiki : []).map((t) => text(t, 120)).filter(Boolean).slice(0, 3);
  const konu = text(raw.konu, 200);
  if (!konu && !wiki.length) return undefined;
  return { konu, donem: /\d/.test(text(raw.donem, 60)) ? text(raw.donem, 60) : "", wiki };
}

export async function resolveTopic(input: { readonly konu: string; readonly donem: string; readonly budget: V3Budget; readonly model: V3ModelChoice }): Promise<TopicResolution | undefined> {
  const out = await input.budget.generate("konu", input.model, topicPrompt(input.konu, input.donem), { maxTokens: 300, jsonSchema: { type: "object" } });
  return readTopic(out.result.content);
}

export interface ResearchFact {
  readonly metin: string;
  readonly kaynak: string;
  readonly alinti: string;
}

/**
 * Facts whose quote is really in the cited article; the rest are counted as rejected. A Wikipedia article is cited by
 * `sourceId(title)`; a web page passes its own id (`idOf`), and the same rule holds for it.
 */
export function verifyFacts<A extends { readonly title: string; readonly text: string }>(raw: unknown, articles: readonly A[], idOf: (a: A) => string = (a) => sourceId(a.title)): { kept: ResearchFact[]; rejected: number } {
  const byId = new Map(articles.map((a) => [idOf(a), normalizeForMatch(a.text)]));
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

/** What the open-web pass may be given (tests pass fakes); by default OpenAI's search and the polite page fetch. */
export interface WebResearchOptions {
  readonly search?: WebSearchCall;
  readonly fetchPage?: PageFetch;
  /** The search model (ATOLYE_V3_WEB_SEARCH_MODEL, default gpt-4.1-mini); only models whose search price is fixed. */
  readonly model?: string;
  /** The 24 h cache of searches, robots.txt and pages; default `_onbellek/web` beside the Wikipedia cache. */
  readonly cacheDir?: string;
  /** The day pages are cited as read (YYYY-MM-DD); default today. */
  readonly today?: string;
}

/** Why the open-web pass does not run for this video, or undefined when it does. */
export function webSkipReason(web: false | WebResearchOptions | undefined, model: V3ModelChoice, env: Readonly<Record<string, string | undefined>>): string | undefined {
  if (web === false) return "bu çağrıda kapalı";
  if (env.ATOLYE_V3_WEB_ARASTIRMA === "0") return "ATOLYE_V3_WEB_ARASTIRMA=0";
  if (model.provider !== "openai") return `sağlayıcı ${model.provider}; web araması yalnız OpenAI hesabıyla yapılır`;
  const searchModel = web?.model ?? env.ATOLYE_V3_WEB_SEARCH_MODEL ?? "gpt-4.1-mini";
  if (!WEB_SEARCH_MODELS.includes(searchModel)) return `"${searchModel}" için web araması fiyatı sabit değil (yalnız ${WEB_SEARCH_MODELS.join(", ")})`;
  return undefined;
}

/**
 * The open-web pass (owner, 12 Nov 2026: research the internet, Wikipedia included, minding copyright): a few searches
 * through OpenAI's web search (each booked through the budget, a cached one free), the reputable results read one per
 * site (no Wikipedia, social media, video, forums, content farms, PDFs; robots.txt honoured), and one fact call over the
 * pages keeping a fact only when its quote is in its page's text, and only when the Wikipedia bank does not have it yet.
 * Nothing it fails at stops the research; a budget stop ends its searches.
 */
export async function researchWeb(input: {
  readonly konu: string;
  readonly donem: string;
  readonly dil: "tr" | "en";
  readonly seconds?: number;
  readonly budget: V3Budget;
  /** The fact model (the research model). */
  readonly model: V3ModelChoice;
  readonly searchModel: string;
  /** The cast the Wikipedia pass named (people, ships), for the third search. */
  readonly names: readonly string[];
  /** The bank's facts so far: told to the model, and a repeat of one is not kept. */
  readonly known: readonly string[];
  /** The Wikipedia texts already read: a page that copies them is a mirror, not another source. */
  readonly wikiTexts?: readonly string[];
  readonly search: WebSearchCall;
  readonly fetchPage: PageFetch;
  readonly cacheDir?: string;
  readonly today: string;
  readonly log: (s: string) => void;
}): Promise<{ pages: WebPage[]; facts: ResearchFact[]; rejected: number }> {
  const { log } = input;
  const depth = researchDepth(input.seconds);
  const queries = webQueries(input.konu, input.donem, input.names, depth.webQueries);
  const hits: WebHit[] = [];
  let searched = 0;
  for (const q of queries) {
    const prompt = webSearchPrompt(q);
    const key = `search\u0000${input.searchModel}\u0000${prompt}`;
    try {
      let found = await readWebCache<WebHit[]>(input.cacheDir, key);
      if (!found) {
        const ceiling = webSearchCeilingUsd(input.searchModel, prompt.length, WEB_SEARCH_MAX_OUTPUT);
        if (ceiling === undefined) throw new Error(`${input.searchModel} fiyat tablosunda yok`);
        found = [
          ...(await input.budget.paid("arastirma-web-arama", { provider: "openai", model: input.searchModel }, ceiling, async () => {
            const answer = await input.search(prompt, { model: input.searchModel, maxOutputTokens: WEB_SEARCH_MAX_OUTPUT });
            const costUsd = webSearchCostUsd(input.searchModel, answer);
            return { value: answer.hits, ...(costUsd !== undefined ? { costUsd } : {}), ...(answer.inputTokens !== undefined ? { promptTokens: answer.inputTokens } : {}), ...(answer.outputTokens !== undefined ? { completionTokens: answer.outputTokens } : {}) };
          })),
        ];
        await writeWebCache(input.cacheDir, key, found).catch(() => {});
      }
      searched++;
      hits.push(...found);
    } catch (e) {
      log(`araştırma: web araması "${q}" yapılamadı (${(e as Error).message.slice(0, 120)}); atlandı`);
      if (e instanceof V3BudgetError) break;
    }
  }
  if (!searched) return { pages: [], facts: [], rejected: 0 };

  // The results: one page a site, the most trusted sites first; refused ones counted by why.
  const refused = new Map<string, number>();
  const candidates: WebHit[] = [];
  const seenUrls = new Set<string>();
  const seenHosts = new Set<string>();
  for (const h of hits) {
    const url = cleanUrl(h.url);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const why = webRefusal(url);
    if (why) {
      refused.set(why, (refused.get(why) ?? 0) + 1);
      continue;
    }
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (seenHosts.has(host)) continue;
    seenHosts.add(host);
    candidates.push({ url, title: h.title });
  }
  candidates.sort((a, b) => reputableScore(b.url) - reputableScore(a.url));
  const pages: WebPage[] = [];
  const skipped: string[] = [];
  const wiki = input.wikiTexts?.length ? normalizeForMatch(input.wikiTexts.join("\n")) : undefined;
  for (const c of candidates.slice(0, depth.webPages * 3)) {
    if (pages.length >= depth.webPages) break;
    const read = await readWebPage(c.url, input.fetchPage, input.cacheDir, input.today).catch((e: Error) => ({ skipped: `ağ: ${e.message.slice(0, 80)}` }));
    if ("skipped" in read) skipped.push(`${new URL(c.url).hostname} (${read.skipped})`);
    else if (wiki && copiesWikipedia(read.text, wiki)) skipped.push(`${new URL(c.url).hostname} (Wikipedia kopyası)`);
    else if (!pages.some((p) => p.id === read.id)) pages.push(read);
  }
  const refusedLine = [...refused].map(([why, n]) => `${why} ${n}`).join(", ");
  log(`araştırma: web — ${searched} arama, ${seenUrls.size} sonuç${refusedLine ? ` (elenen: ${refusedLine})` : ""}; ${pages.length} sayfa okundu${pages.length ? `: ${pages.map((p) => new URL(p.url).hostname).join(", ")}` : ""}${skipped.length ? `; okunamayan: ${skipped.slice(0, 6).join(", ")}` : ""}`);
  if (!pages.length) return { pages: [], facts: [], rejected: 0 };

  const answer = await input.budget.generate("arastirma-web", input.model, webFactPrompt(input.konu, input.donem, pages, input.known, input.dil, input.seconds), { maxTokens: depth.webTokens, jsonSchema: { type: "object" } });
  const verified = verifyFacts(jsonOf(answer.result.content), pages, (p) => p.id);
  const known = [...input.known];
  const perPage = new Map<string, number>();
  const facts: ResearchFact[] = [];
  let repeated = 0;
  for (const f of verified.kept) {
    if (repeatsFact(f.metin, known)) {
      repeated++;
      continue;
    }
    if ((perPage.get(f.kaynak) ?? 0) >= depth.webPerPage) continue;
    perPage.set(f.kaynak, (perPage.get(f.kaynak) ?? 0) + 1);
    known.push(f.metin);
    facts.push(f);
  }
  log(`araştırma: web olguları ${facts.length} (${pages.map((p) => `${new URL(p.url).hostname} ${perPage.get(p.id) ?? 0}`).join(", ")}); ${verified.rejected} olgu alıntısı sayfada bulunamadığı için, ${repeated} olgu Wikipedia'dakini tekrarladığı için atıldı`);
  return { pages: pages.filter((p) => perPage.has(p.id)), facts, rejected: verified.rejected };
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
  /** The video's length: a long one is researched deeper (researchDepth). */
  readonly seconds?: number;
  /** Read the cast's articles (people, ships, places the main article names most); default on. */
  readonly cast?: boolean;
  /** Add the topic articles' battle infobox fields (strength, casualties, commanders, result, date, place); default on. */
  readonly infobox?: boolean;
  /** Add the topic's Wikidata dates, place and counts; default on. */
  readonly wikidata?: boolean;
  /** The JSON GET (tests pass a fake); default the 24 h cache with Wikimedia's polite fetch. */
  readonly fetchJson?: JsonGet;
  /**
   * The open-web pass (researchWeb): on by default when the research model is OpenAI's, off with
   * ATOLYE_V3_WEB_ARASTIRMA=0 or `false`; tests pass fake search and page fetch.
   */
  readonly web?: false | WebResearchOptions;
  /** Where ATOLYE_V3_* settings are read (loadV3Settings puts .env.v3.local into process.env); tests pass their own. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly log?: (s: string) => void;
}): Promise<ResearchResult> {
  const log = input.log ?? (() => {});
  const get = input.fetchJson ?? wikiGet(input.cacheDir);
  const depth = researchDepth(input.seconds);
  const titles = [...new Set([...(input.extraTitles ?? []), ...(await searchArticles(input.cacheDir, `${input.konu} ${input.donem}`, depth.search, get))])];
  const articles: WikiArticle[] = [];
  // A title that does not exist (or redirects to one already read) gives its place to the next candidate.
  for (const t of titles) {
    if (articles.length >= (input.maxArticles ?? depth.articles)) break;
    const a = await fetchArticle(input.cacheDir, t, get);
    if (a && a.text.length > 800 && !articles.some((x) => x.title === a.title)) articles.push(a);
  }
  if (!articles.length) throw new Error(`V3_RESEARCH_NOTHING: "${input.konu}" için okunabilir Wikipedia makalesi bulunamadı`);
  log(`araştırma: ${articles.map((a) => `"${a.title}" (rev ${a.revid})`).join(", ")}`);
  const out = await input.budget.generate("arastirma", input.model, factPrompt(input.konu, input.donem, articles, input.dil, input.seconds), { maxTokens: depth.maxTokens, jsonSchema: { type: "object" } });
  const main = verifyFacts(jsonOf(out.result.content), articles);

  // The topic articles' battle infoboxes (Siege of Baghdad 1638, 13 Nov 2026: the defenders' strength and losses stood
  // only there): free, without a model, the main article's up to 16 fields, each other's up to 8; fail-soft per article.
  const infobox: ResearchFact[] = [];
  if (input.infobox !== false) {
    const seenText = new Set(main.kept.map((f) => f.metin));
    const read: string[] = [];
    for (const [i, a] of articles.entries()) {
      try {
        const facts = (await fetchInfoboxFacts(get, a, input.dil, i === 0 ? 16 : 8)).filter((f) => !seenText.has(f.metin));
        for (const f of facts) seenText.add(f.metin);
        infobox.push(...facts);
        if (facts.length) read.push(`"${a.title}" ${facts.length}`);
      } catch (e) {
        log(`araştırma: "${a.title}" bilgi kutusu okunamadı (${(e as Error).message.slice(0, 120)}); atlandı`);
      }
    }
    log(read.length ? `araştırma: bilgi kutusu olguları (güç, kayıp, komutan, sonuç) ${read.join(", ")}` : "araştırma: konu makalelerinde savaş bilgi kutusu yok; atlandı");
  }

  // The cast: optional, and nothing it fails at stops the research (a missing article, offline, a budget stop).
  const cast: { article: WikiArticle; excerpt: string }[] = [];
  let castKept: ResearchFact[] = [];
  let castRejected = 0;
  if (input.cast !== false && depth.cast > 0) {
    try {
      const phrase = topicPhrase(articles[0]!.title);
      const candidates = castCandidates(articles[0]!, await articleLinks(get, articles[0]!.title), articles.map((a) => a.title), depth.cast + 3);
      for (const t of candidates) {
        if (cast.length >= depth.cast) break;
        const a = await fetchArticle(input.cacheDir, t, get).catch(() => undefined);
        const excerpt = a && !articles.some((x) => x.title === a.title) && !cast.some((c) => c.article.title === a.title) ? castExcerpt(a, phrase, depth.castChars) : undefined;
        if (a && excerpt) cast.push({ article: a, excerpt });
      }
      log(cast.length ? `araştırma: kadro makaleleri ${cast.map((c) => `"${c.article.title}" (rev ${c.article.revid})`).join(", ")}` : "araştırma: konuyu anan kadro makalesi bulunamadı");
    } catch (e) {
      log(`araştırma: kadro makaleleri okunamadı (${(e as Error).message.slice(0, 120)}); yalnız ana makalelerle devam`);
    }
    if (cast.length) {
      try {
        const answer = await input.budget.generate("arastirma-kadro", input.model, castFactPrompt(input.konu, input.donem, cast, input.dil, input.seconds), { maxTokens: depth.castTokens, jsonSchema: { type: "object" } });
        const verified = verifyFacts(jsonOf(answer.result.content), cast.map((c) => c.article));
        const seen = new Set(main.kept.map((f) => f.metin));
        castKept = verified.kept.filter((f) => !seen.has(f.metin));
        castRejected = verified.rejected;
      } catch (e) {
        log(`araştırma: kadro olguları çıkarılamadı (${(e as Error).message.slice(0, 120)}); atlandı`);
      }
    }
  }

  // Wikidata's dates, place and counts (CC0): optional and fail-soft as well.
  let wikidata: { source: EpisodeSource; facts: ResearchFact[] } | undefined;
  if (input.wikidata !== false) {
    try {
      const qid = await wikidataItem(get, articles[0]!.title);
      wikidata = qid ? await fetchWikidataFacts(get, qid, input.dil) : undefined;
      log(wikidata ? `araştırma: Wikidata ${wikidata.source.kunye.split(" (")[0]} — ${wikidata.facts.length} tarih/yer/sayı olgusu` : `araştırma: "${articles[0]!.title}" için Wikidata olgusu yok; atlandı`);
    } catch (e) {
      log(`araştırma: Wikidata okunamadı (${(e as Error).message.slice(0, 120)}); tarih/sayı olguları atlandı`);
    }
  }

  // The open web (owner, 12 Nov 2026): what reputable history sites add to Wikipedia; optional and fail-soft as well.
  let web: { pages: WebPage[]; facts: ResearchFact[]; rejected: number } | undefined;
  const env = input.env ?? process.env;
  const webOff = webSkipReason(input.web, input.model, env);
  if (webOff) log(`araştırma: açık web araştırması atlandı (${webOff})`);
  else {
    const opts = input.web || {};
    try {
      web = await researchWeb({
        konu: input.konu,
        donem: input.donem,
        dil: input.dil,
        ...(input.seconds !== undefined ? { seconds: input.seconds } : {}),
        budget: input.budget,
        model: input.model,
        searchModel: opts.model ?? env.ATOLYE_V3_WEB_SEARCH_MODEL ?? "gpt-4.1-mini",
        names: cast.map((c) => c.article.title),
        known: [...main.kept, ...infobox, ...castKept, ...(wikidata?.facts ?? [])].map((f) => f.metin),
        wikiTexts: [...articles, ...cast.map((c) => c.article)].map((a) => a.text),
        search: opts.search ?? openAIWebSearch(fetch, env),
        fetchPage: opts.fetchPage ?? safePageFetch(),
        cacheDir: opts.cacheDir ?? path.join(path.dirname(input.cacheDir), "web"),
        today: opts.today ?? new Date().toISOString().slice(0, 10),
        log,
      });
    } catch (e) {
      log(`araştırma: açık web olguları çıkarılamadı (${(e as Error).message.slice(0, 120)}); atlandı`);
    }
  }

  const webKept = web?.facts ?? [];
  const rejected = main.rejected + castRejected + (web?.rejected ?? 0);
  const verifiedCount = main.kept.length + castKept.length + webKept.length;
  log(`araştırma: ${verifiedCount} olgu alıntısıyla doğrulandı (ana makaleler ${main.kept.length}, kadro ${castKept.length}${web ? `, web ${webKept.length}` : ""})${wikidata ? ` + Wikidata ${wikidata.facts.length}` : ""}${infobox.length ? ` + bilgi kutusu ${infobox.length}` : ""}, ${rejected} olgu alıntısı kaynağında bulunamadığı için atıldı`);
  if (verifiedCount < 5) throw new Error(`V3_RESEARCH_THIN: yalnız ${verifiedCount} doğrulanmış olgu (en az 5 gerekli)`);
  const seen = new Set([...main.kept, ...infobox, ...castKept].map((f) => f.metin));
  const kept = [...main.kept, ...infobox, ...(wikidata?.facts ?? []).filter((f) => !seen.has(f.metin)), ...castKept, ...webKept];
  const used = new Set(kept.map((f) => f.kaynak));
  return {
    bank: {
      aciklama: `Otomatik kaynak bankası (${new Date().toISOString().slice(0, 10)}): olgular okunan Wikipedia revizyonlarından çıkarıldı; her olgunun alıntısı makale metninde birebir bulundu${infobox.length ? "; güç, kayıp, komutan, sonuç gibi bilgi kutusu (infobox) olguları aynı revizyonun vikimetninden okundu, alıntıları alanın kendi metnidir" : ""}${wikidata ? "; tarih/yer/sayı olguları Wikidata'dan (CC0)" : ""}${webKept.length ? "; açık webdeki tarih sitelerinden okunan sayfaların olguları da aynı kuralla (alıntısı sayfa metninde birebir) alındı, görselleri alınmadı" : ""}. Alıntılar yalnız doğrulama içindir, metne kopyalanmaz.`,
      kaynaklar: [...articles, ...cast.map((c) => c.article)].filter((a) => used.has(sourceId(a.title))).map(articleSource).concat(wikidata && used.has(wikidata.source.id) ? [wikidata.source] : []).concat((web?.pages ?? []).filter((p) => used.has(p.id)).map(webSource)),
      olgular: kept.map((f) => ({ metin: f.metin, kaynak: f.kaynak })),
      reddedilen: rejected,
      alintilar: kept,
    },
    articles: [...articles, ...cast.map((c) => c.article)].map((a) => a.title),
  };
}

/** The first JSON object of a model answer, or {} (an unreadable answer keeps no fact). */
function jsonOf(content: string): unknown {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  try {
    return start >= 0 && end > start ? JSON.parse(content.slice(start, end + 1)) : {};
  } catch {
    return {};
  }
}
