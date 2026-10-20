import { type CommonsCandidate, cachedJson, commonsByTitles, searchCommons } from "./CommonsProvider";

/**
 * Where V3 looks for a period image of a scene, in order: the images of the subject's Wikipedia article (the
 * "history page"), The Met's Open Access collection (CC0 artworks with dates), then a Commons search. Every
 * candidate carries its license (whitelist only) and, when known, the year it was made; the vision judge decides.
 */
const WIKI_API = (lang: string) => `https://${lang}.wikipedia.org/w/api.php`;
const MET_API = "https://collectionapi.metmuseum.org/public/collection/v1";

/** Icons, flags, maps of the modern country and other chrome every article carries. */
const ARTICLE_CHROME = /\.svg$|commons-logo|flag of|location map|question book|edit-ltr|symbol category|red pog|wiki letter|padlock|ambox|crystal clear|nuvola|disambig|portal/i;

/** File titles used on a Wikipedia article, minus page chrome; follows redirects. */
export async function wikipediaFileTitles(cacheDir: string, article: string, lang = "en"): Promise<string[]> {
  const params = new URLSearchParams({ action: "query", format: "json", titles: article, prop: "images", imlimit: "100", redirects: "1" });
  const json = (await cachedJson(cacheDir, `${WIKI_API(lang)}?${params}`)) as { query?: { pages?: Record<string, { images?: { title: string }[] }> } };
  const titles = Object.values(json.query?.pages ?? {}).flatMap((p) => p.images ?? []).map((i) => i.title);
  return titles.filter((t) => !ARTICLE_CHROME.test(t));
}

/** The article's images that live on Commons with a free license (local fair-use files simply do not resolve). */
export async function wikipediaCandidates(cacheDir: string, article: string, lang = "en"): Promise<CommonsCandidate[]> {
  return commonsByTitles(cacheDir, await wikipediaFileTitles(cacheDir, article, lang), "wikipedia");
}

interface MetObject {
  readonly objectID: number;
  readonly isPublicDomain?: boolean;
  readonly primaryImage?: string;
  readonly primaryImageSmall?: string;
  readonly title?: string;
  readonly objectDate?: string;
  readonly objectEndDate?: number;
  readonly culture?: string;
  readonly artistDisplayName?: string;
  readonly classification?: string;
  readonly medium?: string;
  readonly objectURL?: string;
}

/** Public-domain objects with an image from The Met (Open Access, CC0); the search returns at most `limit` ids. */
export async function metCandidates(cacheDir: string, query: string, limit = 6): Promise<CommonsCandidate[]> {
  const search = (await cachedJson(cacheDir, `${MET_API}.1/search?${new URLSearchParams({ q: query, hasImages: "true", limit: String(limit) })}`)) as { objectIDs?: number[] | null };
  const out: CommonsCandidate[] = [];
  for (const id of (search.objectIDs ?? []).slice(0, limit)) {
    let o: MetObject;
    try {
      o = (await cachedJson(cacheDir, `${MET_API}/objects/${id}`)) as MetObject;
    } catch {
      continue;
    }
    if (!o.isPublicDomain || !o.primaryImage) continue;
    const by = o.artistDisplayName || o.culture || "The Metropolitan Museum of Art";
    out.push({
      title: `Met ${o.objectID}: ${o.title ?? "untitled"}`,
      source: "met",
      ...(o.objectEndDate ? { year: o.objectEndDate } : {}),
      url: o.primaryImage,
      downloadUrl: o.primaryImage,
      previewUrl: o.primaryImageSmall || o.primaryImage,
      description: [o.title, o.objectDate, o.culture, o.artistDisplayName, o.classification, o.medium].filter(Boolean).join(" · ").slice(0, 400),
      width: 0,
      height: 0,
      mime: "image/jpeg",
      descriptionUrl: o.objectURL ?? `https://www.metmuseum.org/art/collection/search/${o.objectID}`,
      credit: {
        title: o.title ?? `The Met ${o.objectID}`,
        author: `${by} — The Metropolitan Museum of Art`,
        license: "CC0 (The Met Open Access)",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        sourceUrl: o.objectURL ?? `https://www.metmuseum.org/art/collection/search/${o.objectID}`,
        attributionRequired: false,
      },
    });
  }
  return out;
}

export interface PeriodSearch {
  /** English Wikipedia article of the scene's place or subject. */
  readonly wiki?: string;
  /** Search words for a period image ("Rumelihisarı engraving"). */
  readonly query: string;
  /** More searches: historical spellings and the names travellers and artists used ("Roumeli Hissar"). */
  readonly alternatives?: readonly string[];
  readonly commonsCategory?: string;
}

export interface PeriodCandidates {
  readonly candidates: readonly CommonsCandidate[];
  /** Per source: how many usable candidates it gave, or why it failed. */
  readonly report: readonly string[];
}

/** Other names of a Wikipedia article (its redirects): old spellings like "Roumeli Hissar Castle". */
export async function wikipediaAliases(cacheDir: string, article: string, lang = "en"): Promise<string[]> {
  const params = new URLSearchParams({ action: "query", format: "json", titles: article, prop: "redirects", rdlimit: "50", redirects: "1" });
  const json = (await cachedJson(cacheDir, `${WIKI_API(lang)}?${params}`)) as { query?: { pages?: Record<string, { redirects?: { title: string }[] }> } };
  return Object.values(json.query?.pages ?? {}).flatMap((p) => p.redirects ?? []).map((r) => r.title);
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Up to `max` alias searches that are really different spellings of the title (generic words like "Castle" dropped). */
export function aliasQueries(title: string, aliases: readonly string[], max = 2): string[] {
  const seen = new Set([fold(title)]);
  const out: string[] = [];
  for (const a of aliases) {
    const trimmed = a.replace(/\s+(castle|fortress|fort|palace|tower|citadel)$/i, "").trim();
    const name = trimmed.split(/\s+/).length >= 2 || trimmed.length >= 8 ? trimmed : a;
    const key = fold(name);
    // A spelling that only drops a space or a diacritic finds the same files.
    if (seen.has(key) || [...seen].some((k) => k.startsWith(key) || key.startsWith(k))) continue;
    seen.add(key);
    out.push(name);
  }
  // Most different from the title first: those reach the old travel books and engravings.
  const distance = (x: string) => [...fold(x)].filter((ch, i) => fold(title)[i] !== ch).length;
  return out.sort((a, b) => distance(b) - distance(a)).slice(0, max);
}

/**
 * Judging priority by the year an image was made: made in or near the period first, then undated works and later
 * historical depictions (an 1838 engraving of a 1452 fortress), photos of today last.
 */
export function periodRank(year: number | undefined, periodEnd: number | undefined): number {
  if (periodEnd === undefined || year === undefined) return 1;
  // "Of the period": within a lifetime for older periods, within a decade once photography exists.
  if (year <= periodEnd + (periodEnd >= 1800 ? 10 : 50)) return 0;
  return year < Math.max(1900, periodEnd + 30) ? 1 : 2;
}

/**
 * Candidates from every source, de-duplicated, in judging order (see periodRank), so the judge's limited looks go
 * to period works first.
 */
export async function findPeriodCandidates(cacheDir: string, s: PeriodSearch, periodEnd?: number): Promise<PeriodCandidates> {
  const report: string[] = [];
  const lists: CommonsCandidate[][] = [];
  const take = async (name: string, run: () => Promise<CommonsCandidate[]>) => {
    try {
      const got = await run();
      report.push(`${name}: ${got.length}`);
      lists.push(got);
    } catch (e) {
      report.push(`${name}: hata (${(e as Error).message.slice(0, 80)})`);
    }
  };
  const commons = (q: string) => searchCommons(cacheDir, q, { minWidth: 900, landscape: false, limit: 12 });
  if (s.wiki) await take(`Wikipedia "${s.wiki}"`, () => wikipediaCandidates(cacheDir, s.wiki!));
  await take(`The Met "${s.query}"`, () => metCandidates(cacheDir, s.query));
  await take(`Commons "${s.query}"`, async () => {
    let found = await commons(s.commonsCategory ? `${s.query} incategory:"${s.commonsCategory}"` : s.query);
    if (!found.length && s.commonsCategory) found = await commons(s.query);
    return found;
  });
  const extra = [...(s.alternatives ?? []).slice(0, 3)];
  if (s.wiki) {
    try {
      extra.push(...aliasQueries(s.wiki, await wikipediaAliases(cacheDir, s.wiki)));
    } catch (e) {
      report.push(`Wikipedia adları: hata (${(e as Error).message.slice(0, 80)})`);
    }
  }
  for (const q of [...new Set(extra)].filter((q) => fold(q) !== fold(s.query)).slice(0, 4)) await take(`Commons "${q}"`, () => commons(q));
  const seen = new Set<string>();
  const all = lists.flat().filter((c) => {
    const key = c.url;
    if (seen.has(key)) return false;
    seen.add(key);
    // Too small to fill a 1080p frame even as a framed cutaway.
    return c.width === 0 || c.width >= 900 || c.height >= 900;
  });
  const candidates = all
    .map((c, i) => ({ c, i, r: periodRank(c.year, periodEnd) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c);
  return { candidates, report };
}

/** Last year of an episode period ("1452", "1451–1453", "MÖ 44", "44 BC", "1919-1922"); BCE years are negative. */
export function periodEndYear(donem: string): number | undefined {
  // \b is ASCII-only in JavaScript, so it would never see the edge of "MÖ".
  const bce = /(^|[^\p{L}])(MÖ|M\.Ö\.|BC|BCE)(?!\p{L})/iu.test(donem);
  const years = [...donem.matchAll(/\b(\d{1,4})\b/g)].map((m) => Number(m[1])).filter((y) => y > 0);
  if (!years.length) return undefined;
  return bce ? -Math.min(...years) : Math.max(...years);
}

/** Short source plate for a cutaway: title, author/year, where it is from. */
export function insertCaption(c: CommonsCandidate, language: "tr" | "en"): string {
  const where = c.source === "met" ? "The Met" : "Wikimedia Commons";
  const author = c.credit.author.replace(/\s*—\s*The Metropolitan Museum of Art$/, "").replace(/\s+/g, " ").trim();
  const head = c.credit.title.replace(/^File:/, "").replace(/\.(jpe?g|png)$/i, "").replace(/\s*\(\d{6,}\)\s*$/, "").trim();
  const parts = [head.slice(0, 70), author && author.length <= 50 && !/wikimedia/i.test(author) ? author : "", c.year ? String(c.year) : ""].filter(Boolean);
  return `${parts.join(", ")} · ${language === "en" ? "Source" : "Kaynak"}: ${where}`;
}
