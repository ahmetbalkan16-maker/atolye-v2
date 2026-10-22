import { type CommonsCandidate, cachedJson, commonsByTitles, searchCommons } from "./CommonsProvider";
import { judgeLicense } from "./LicenseFilter";

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

interface AicArtwork {
  readonly id: number;
  readonly title?: string | null;
  readonly image_id?: string | null;
  readonly artist_display?: string | null;
  readonly date_end?: number | null;
  readonly is_public_domain?: boolean;
}

/**
 * Public-domain artworks from the Art Institute of Chicago (CC0, no key; owner 21 Oct 2026: "search the internet more
 * widely, never an unrelated picture"). Images come through its IIIF server; 843 px wide is the size it recommends.
 */
export async function aicCandidates(cacheDir: string, query: string, limit = 6): Promise<CommonsCandidate[]> {
  const params = new URLSearchParams({ q: query, "query[term][is_public_domain]": "true", fields: "id,title,image_id,artist_display,date_end,is_public_domain", limit: String(limit) });
  const json = (await cachedJson(cacheDir, `https://api.artic.edu/api/v1/artworks/search?${params}`)) as { data?: readonly AicArtwork[] };
  return (json.data ?? [])
    .filter((a) => a.is_public_domain && a.image_id)
    .map((a) => {
      const page = `https://www.artic.edu/artworks/${a.id}`;
      const artist = (a.artist_display ?? "").split("\n")[0]?.trim() || "Art Institute of Chicago";
      return {
        title: `AIC ${a.id}: ${a.title ?? "untitled"}`,
        source: "aic" as const,
        ...(a.date_end ? { year: a.date_end } : {}),
        url: `https://www.artic.edu/iiif/2/${a.image_id}/full/843,/0/default.jpg`,
        downloadUrl: `https://www.artic.edu/iiif/2/${a.image_id}/full/1686,/0/default.jpg`,
        previewUrl: `https://www.artic.edu/iiif/2/${a.image_id}/full/843,/0/default.jpg`,
        description: [a.title, a.date_end, a.artist_display?.replace(/\n/g, ", ")].filter(Boolean).join(" · ").slice(0, 400),
        width: 0,
        height: 0,
        mime: "image/jpeg",
        descriptionUrl: page,
        credit: { title: a.title ?? `AIC ${a.id}`, author: `${artist} — Art Institute of Chicago`, license: "CC0 (Art Institute of Chicago, public domain)", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", sourceUrl: page, attributionRequired: false },
      };
    });
}

interface ClevelandArtwork {
  readonly id: number;
  readonly title?: string | null;
  readonly creation_date_latest?: number | null;
  readonly creators?: readonly { readonly description?: string | null }[] | null;
  readonly url?: string | null;
  readonly share_license_status?: string | null;
  readonly images?: { readonly web?: { readonly url?: string } | null; readonly print?: { readonly url?: string } | null } | null;
}

/** CC0 artworks with an image from the Cleveland Museum of Art's Open Access API (no key). */
export async function clevelandCandidates(cacheDir: string, query: string, limit = 6): Promise<CommonsCandidate[]> {
  const params = new URLSearchParams({ q: query, cc0: "1", has_image: "1", limit: String(limit) });
  const json = (await cachedJson(cacheDir, `https://openaccess-api.clevelandart.org/api/artworks/?${params}`)) as { data?: readonly ClevelandArtwork[] };
  return (json.data ?? [])
    .filter((a) => a.share_license_status === "CC0" && a.images?.web?.url)
    .map((a) => {
      const page = a.url ?? `https://clevelandart.org/art/${a.id}`;
      const by = a.creators?.[0]?.description?.trim() || "Cleveland Museum of Art";
      return {
        title: `Cleveland ${a.id}: ${a.title ?? "untitled"}`,
        source: "cleveland" as const,
        ...(a.creation_date_latest ? { year: a.creation_date_latest } : {}),
        url: a.images!.web!.url!,
        downloadUrl: a.images?.print?.url ?? a.images!.web!.url!,
        previewUrl: a.images!.web!.url!,
        description: [a.title, a.creation_date_latest, by].filter(Boolean).join(" · ").slice(0, 400),
        width: 0,
        height: 0,
        mime: "image/jpeg",
        descriptionUrl: page,
        credit: { title: a.title ?? `Cleveland ${a.id}`, author: `${by} — Cleveland Museum of Art`, license: "CC0 (Cleveland Museum of Art Open Access)", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", sourceUrl: page, attributionRequired: false },
      };
    });
}

interface OpenverseImage {
  readonly id: string;
  readonly title?: string | null;
  readonly creator?: string | null;
  readonly url?: string | null;
  readonly thumbnail?: string | null;
  readonly foreign_landing_url?: string | null;
  readonly license?: string | null;
  readonly license_version?: string | null;
  readonly license_url?: string | null;
  readonly source?: string | null;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly tags?: readonly { readonly name: string }[] | null;
}

/**
 * Openly licensed images from Openverse (owner approval 20 Oct 2026: WordPress's search engine for CC and public-domain
 * media — Flickr manuscripts, museum photos, libraries — beyond Wikipedia, The Met and Commons). Only licences that allow
 * commercial use and changes are asked for, and every result passes the same licence judge (no NC, no ND, nothing
 * unknown). Wikimedia results are left out (Commons is searched directly). Anonymous use: 20 requests a minute, 200 a
 * day — one cached query per search.
 */
export async function openverseCandidates(cacheDir: string, query: string, limit = 8): Promise<CommonsCandidate[]> {
  const params = new URLSearchParams({ q: query, license_type: "commercial,modification", page_size: String(limit), mature: "false" });
  const json = (await cachedJson(cacheDir, `https://api.openverse.org/v1/images/?${params}`)) as { results?: readonly OpenverseImage[] };
  const out: CommonsCandidate[] = [];
  for (const r of json.results ?? []) {
    if (!r.url || !r.thumbnail || /wikimedia/i.test(r.source ?? "")) continue;
    const licence = judgeLicense(`${r.license ?? ""} ${r.license_version ?? ""}`.trim());
    if (!licence.ok) continue;
    const name = r.license === "pdm" ? "Public domain" : r.license === "cc0" ? "CC0" : `CC ${(r.license ?? "").toUpperCase()} ${r.license_version ?? ""}`.trim();
    out.push({
      title: `Openverse ${r.source ?? ""}: ${(r.title ?? "untitled").slice(0, 120)}`,
      source: "openverse",
      url: r.url,
      downloadUrl: r.url,
      previewUrl: r.thumbnail,
      description: [r.title, r.creator, (r.tags ?? []).slice(0, 8).map((t) => t.name).join(", ")].filter(Boolean).join(" · ").slice(0, 400),
      width: r.width ?? 0,
      height: r.height ?? 0,
      mime: "image/jpeg",
      descriptionUrl: r.foreign_landing_url ?? r.url,
      credit: { title: r.title ?? "untitled", author: `${r.creator ?? "unknown"} (${r.source ?? "Openverse"})`, license: name, ...(r.license_url ? { licenseUrl: r.license_url } : {}), sourceUrl: r.foreign_landing_url ?? r.url, attributionRequired: licence.attributionRequired },
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
  /**
   * Photos of today an ancient period's search also found (the place or its ruins as they stand now): never judged
   * as period images, kept for the subject-photo fallback when no set can be drawn (owner, 21 Oct 2026).
   */
  readonly later: readonly CommonsCandidate[];
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
  await take(`Openverse "${s.query}"`, () => openverseCandidates(cacheDir, s.query));
  await take(`Chicago "${s.query}"`, () => aicCandidates(cacheDir, s.query));
  await take(`Cleveland "${s.query}"`, () => clevelandCandidates(cacheDir, s.query));
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
  // Before photography a photo taken after 1900 cannot be a period image: such candidates are not even judged (the
  // Rubicon run spent minutes on 43 photos of modern Rimini, each preview hitting Wikimedia's rate limit).
  const ancient = periodEnd !== undefined && periodEnd < 1850;
  const ranked = all.map((c, i) => ({ c, i, r: periodRank(c.year, periodEnd) }));
  const candidates = ranked
    .filter((x) => !(ancient && x.r === 2))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c);
  return { candidates, later: ranked.filter((x) => ancient && x.r === 2).map((x) => x.c), report };
}

/** Last year of an episode period ("1452", "1451–1453", "MÖ 44", "44 BC", "1919-1922"); BCE years are negative. */
export function periodEndYear(donem: string): number | undefined {
  // \b is ASCII-only in JavaScript, so it would never see the edge of "MÖ".
  const bce = /(^|[^\p{L}])(MÖ|M\.Ö\.|BC|BCE)(?!\p{L})/iu.test(donem);
  const years = [...donem.matchAll(/\b(\d{1,4})\b/g)].map((m) => Number(m[1])).filter((y) => y > 0);
  if (!years.length) return undefined;
  return bce ? -Math.min(...years) : Math.max(...years);
}

/** The age a period belongs to (sound effects, battle effects, vehicles on the map): before gunpowder warfare or after. */
export type Era = "antik" | "orta" | "erken-modern" | "modern";

export function eraOf(donem: string): Era {
  const year = periodEndYear(donem);
  if (year === undefined || year >= 1800) return "modern";
  if (year < 500) return "antik";
  if (year < 1450) return "orta";
  return "erken-modern";
}

/** Short source plate for a cutaway: title, author/year, where it is from. */
export function insertCaption(c: CommonsCandidate, language: "tr" | "en"): string {
  const where = c.source === "met" ? "The Met" : "Wikimedia Commons";
  const author = c.credit.author.replace(/\s*—\s*The Metropolitan Museum of Art$/, "").replace(/\s+/g, " ").trim();
  const head = c.credit.title.replace(/^File:/, "").replace(/\.(jpe?g|png)$/i, "").replace(/\s*\(\d{6,}\)\s*$/, "").trim();
  // A title that already names the artist or the year ("Jules-César arrivé au Rubicon, 1854, Musée Picardie, Gustave
  // Boulanger, 1854") does not get them again.
  const named = (s: string) => head.toLowerCase().includes(s.toLowerCase());
  const parts = [head.slice(0, 70), author && author.length <= 50 && !/wikimedia/i.test(author) && !named(author) ? author : "", c.year && !named(String(c.year)) ? String(c.year) : ""].filter(Boolean);
  return `${parts.join(", ")} · ${language === "en" ? "Source" : "Kaynak"}: ${where}`;
}
