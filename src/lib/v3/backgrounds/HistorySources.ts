import { type CommonsCandidate, cachedJson, commonsByTitles, searchCommons, wikiFilesByTitles } from "./CommonsProvider";
import { type Era, eraOf, periodEndYear } from "../episode/Period";
import { judgeLicense, shareAlikeAllowed } from "./LicenseFilter";

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

/**
 * The article's images with a free license: on Commons, or uploaded to the Wikipedia itself (a local fair-use file fails
 * the licence check like any other non-free one).
 */
export async function wikipediaCandidates(cacheDir: string, article: string, lang = "en"): Promise<CommonsCandidate[]> {
  return wikiFilesByTitles(cacheDir, await wikipediaFileTitles(cacheDir, article, lang), lang);
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
 * Openverse sources that are museums, archives and libraries publishing their own collections, with the name shown in
 * the caption. A user upload site (Flickr, WordPress photos, DeviantArt) is not among them: an uploader can mark another
 * person's work as free, and Openverse only passes the licence on.
 */
export const OPENVERSE_INSTITUTIONS: Readonly<Record<string, string>> = {
  smithsonian: "Smithsonian Institution",
  nypl: "New York Public Library",
  rijksmuseum: "Rijksmuseum",
  brooklynmuseum: "Brooklyn Museum",
  clevelandmuseum: "Cleveland Museum of Art",
  met: "The Met",
  museumsvictoria: "Museums Victoria",
  sciencemuseum: "Science Museum Group",
  statensmuseum: "SMK – National Gallery of Denmark",
  europeana: "Europeana",
  wellcome_collection: "Wellcome Collection",
  digitaltmuseum: "DigitaltMuseum",
  finnish_museums: "Finnish Heritage Agency",
  mccordmuseum: "McCord Stewart Museum",
  thorvaldsensmuseum: "Thorvaldsens Museum",
  biodiversity: "Biodiversity Heritage Library",
  nasa: "NASA",
};

/** The institution behind an Openverse source id ("smithsonian_american_art_museum" is the Smithsonian's), or undefined. */
export function openverseInstitution(source: string | null | undefined): string | undefined {
  const s = (source ?? "").toLowerCase();
  return OPENVERSE_INSTITUTIONS[s] ?? (s.startsWith("smithsonian_") ? OPENVERSE_INSTITUTIONS.smithsonian : undefined);
}

/**
 * Openly licensed images from Openverse (owner approval 20 Oct 2026: WordPress's search engine for CC and public-domain
 * media — museum photos, libraries — beyond Wikipedia, The Met and Commons). Openverse is an aggregator: it repeats the
 * licence its source gave, and a Flickr user's upload can carry a wrong one with an "unknown" creator. Since 12 Nov 2026
 * only CC0 and the public-domain mark are asked for, and only from an institution of OPENVERSE_INSTITUTIONS (owner:
 * "araştırmalar genişletilsin ama telif haklarına dikkat edilsin"); every result passes the licence judge too.
 * Wikimedia results are left out (Commons is searched directly). Anonymous use: 20 requests a minute, 200 a day — one
 * cached query per search.
 */
export async function openverseCandidates(cacheDir: string, query: string, limit = 8): Promise<CommonsCandidate[]> {
  const params = new URLSearchParams({ q: query, license: "cc0,pdm", page_size: String(limit), mature: "false" });
  const json = (await cachedJson(cacheDir, `https://api.openverse.org/v1/images/?${params}`)) as { results?: readonly OpenverseImage[] };
  const out: CommonsCandidate[] = [];
  for (const r of json.results ?? []) {
    const provider = openverseInstitution(r.source);
    if (!r.url || !r.thumbnail || !provider || (r.license !== "cc0" && r.license !== "pdm")) continue;
    const licence = judgeLicense(`${r.license} ${r.license_version ?? ""}`.trim());
    if (!licence.ok) continue;
    const name = r.license === "pdm" ? "Public domain" : "CC0";
    out.push({
      title: `Openverse ${r.source ?? ""}: ${(r.title ?? "untitled").slice(0, 120)}`,
      source: "openverse",
      provider,
      url: r.url,
      downloadUrl: r.url,
      previewUrl: r.thumbnail,
      description: [r.title, r.creator, (r.tags ?? []).slice(0, 8).map((t) => t.name).join(", ")].filter(Boolean).join(" · ").slice(0, 400),
      width: r.width ?? 0,
      height: r.height ?? 0,
      mime: "image/jpeg",
      descriptionUrl: r.foreign_landing_url ?? r.url,
      credit: { title: r.title ?? "untitled", author: `${r.creator?.trim() || "unknown"} — ${provider}`, license: name, ...(r.license_url ? { licenseUrl: r.license_url } : {}), sourceUrl: r.foreign_landing_url ?? r.url, attributionRequired: false },
    });
  }
  return out;
}

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";
const EUROPEANA_API = "https://api.europeana.eu/record/v2/search.json";

/**
 * Wikipedias asked besides the English one, in this order (at most OTHER_WIKIS of those the subject has): where the
 * history happened often has the article with the pictures (owner, 21 Nov 2026: "bütün ülkelerin resmi kaynaklarına
 * baksın … ingilizce dışında bile varsa çeviri yapsın").
 */
export const OTHER_WIKI_LANGS: readonly string[] = ["it", "fr", "de", "es", "la", "el", "pt", "nl", "pl", "ru", "tr", "ar", "fa", "zh", "ja"];
const OTHER_WIKIS = 4;

/** A subject's Wikidata item: its id, its Commons category and its article title in every Wikipedia. */
export interface WikiSubject {
  readonly qid: string;
  readonly commonsCategory?: string;
  readonly titles: Readonly<Record<string, string>>;
}

/** The Wikidata item of a Wikipedia article (undefined when it has none). */
export async function wikiSubject(cacheDir: string, article: string, lang = "en"): Promise<WikiSubject | undefined> {
  const pp = (await cachedJson(cacheDir, `${WIKI_API(lang)}?${new URLSearchParams({ action: "query", format: "json", titles: article, prop: "pageprops", ppprop: "wikibase_item", redirects: "1" })}`)) as { query?: { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> } };
  const qid = Object.values(pp.query?.pages ?? {})[0]?.pageprops?.wikibase_item;
  if (!qid || !/^Q\d+$/.test(qid)) return undefined;
  const ent = (await cachedJson(cacheDir, `${WIKIDATA_API}?${new URLSearchParams({ action: "wbgetentities", format: "json", ids: qid, props: "claims|sitelinks" })}`)) as {
    entities?: Record<string, { claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]>; sitelinks?: Record<string, { title: string }> }>;
  };
  const e = ent.entities?.[qid];
  const cat = e?.claims?.P373?.[0]?.mainsnak?.datavalue?.value;
  const titles: Record<string, string> = {};
  for (const [k, v] of Object.entries(e?.sitelinks ?? {})) {
    const m = /^([a-z]{2,3})wiki$/.exec(k);
    if (m) titles[m[1]!] = v.title;
  }
  return { qid, ...(typeof cat === "string" && cat ? { commonsCategory: cat } : {}), titles };
}

/**
 * The files of a Commons category and, while short of `limit`, of its first subcategories. The subject's own category
 * holds what no English search finds: for Lake Trasimene (21 Nov 2026) Sylvestre's "Ducar décapite Flaminius", the
 * battle frescoes of Palazzo della Corgna and an 18th-century Polybius plate, all titled in French, Italian or German.
 */
export async function categoryFileTitles(cacheDir: string, category: string, limit = 40): Promise<string[]> {
  const members = async (cmtype: "file" | "subcat", cmtitle: string, n: number): Promise<string[]> => {
    const json = (await cachedJson(cacheDir, `${COMMONS_API}?${new URLSearchParams({ action: "query", format: "json", list: "categorymembers", cmtitle, cmtype, cmlimit: String(n) })}`)) as { query?: { categorymembers?: { title: string }[] } };
    return (json.query?.categorymembers ?? []).map((m) => m.title);
  };
  const title = `Category:${category.replace(/^Category:/, "")}`;
  const files = await members("file", title, limit);
  if (files.length < limit)
    for (const sub of await members("subcat", title, 6)) {
      if (files.length >= limit) break;
      files.push(...(await members("file", sub, 15)));
    }
  return [...new Set(files)].filter((t) => !ARTICLE_CHROME.test(t)).slice(0, limit);
}

/** Free images of a Commons category (see categoryFileTitles). */
export async function commonsCategoryCandidates(cacheDir: string, category: string, limit = 40): Promise<CommonsCandidate[]> {
  const titles = await categoryFileTitles(cacheDir, category, limit);
  const out: CommonsCandidate[] = [];
  for (let i = 0; i < titles.length; i += 50) out.push(...(await commonsByTitles(cacheDir, titles.slice(i, i + 50))));
  return out;
}

/**
 * Works Wikidata records as depicting the subject or about it (P180 depicts, P921 main subject, P1269 facet of) with
 * an image: every national museum that publishes to Wikidata is asked at once.
 */
export async function depictionCandidates(cacheDir: string, qid: string, limit = 30): Promise<CommonsCandidate[]> {
  if (!/^Q\d+$/.test(qid)) return [];
  const query = `SELECT DISTINCT ?image WHERE { ?w wdt:P180|wdt:P921|wdt:P1269 wd:${qid} . ?w wdt:P18 ?image . } LIMIT ${limit}`;
  const json = (await cachedJson(cacheDir, `${WIKIDATA_SPARQL}?${new URLSearchParams({ format: "json", query })}`)) as { results?: { bindings?: { image?: { value?: string } }[] } };
  const titles = (json.results?.bindings ?? [])
    .map((b) => b.image?.value ?? "")
    .filter(Boolean)
    .map((u) => `File:${decodeURIComponent(u.split("/").pop() ?? "").replace(/_/g, " ")}`);
  const out: CommonsCandidate[] = [];
  for (let i = 0; i < titles.length; i += 50) out.push(...(await commonsByTitles(cacheDir, titles.slice(i, i + 50))));
  return out;
}

/** A Europeana rights statement as the licence filter reads it; undefined when it is not open. */
export function europeanaLicense(rights: string): string | undefined {
  if (/publicdomain\/mark/.test(rights)) return "Public domain";
  if (/publicdomain\/zero/.test(rights)) return "CC0";
  const m = /licenses\/(by(?:-sa)?)\/(\d\.\d)/.exec(rights);
  return m ? `CC ${m[1]!.toUpperCase()} ${m[2]}` : undefined;
}

interface EuropeanaItem {
  readonly title?: readonly string[];
  readonly year?: readonly string[];
  readonly rights?: readonly string[];
  readonly dataProvider?: readonly string[];
  readonly dcCreator?: readonly string[];
  readonly edmIsShownBy?: readonly string[];
  readonly edmPreview?: readonly string[];
  readonly guid?: string;
  readonly dcDescription?: readonly string[];
}

/**
 * Openly licensed images from Europeana — the joint portal of Europe's national museums, libraries and archives (owner,
 * 21 Nov 2026: "bütün ülkelerin resmi kaynaklarına baksın"). Key: ATOLYE_V3_EUROPEANA_KEY, else Europeana's public demo key.
 */
export async function europeanaCandidates(cacheDir: string, query: string, limit = 8, env: Readonly<Record<string, string | undefined>> = process.env): Promise<CommonsCandidate[]> {
  const params = new URLSearchParams({ wskey: env.ATOLYE_V3_EUROPEANA_KEY || "api2demo", query, reusability: "open", media: "true", qf: "TYPE:IMAGE", rows: String(limit), profile: "rich" });
  const json = (await cachedJson(cacheDir, `${EUROPEANA_API}?${params}`)) as { items?: readonly EuropeanaItem[] };
  const out: CommonsCandidate[] = [];
  for (const i of json.items ?? []) {
    const url = i.edmIsShownBy?.[0];
    const license = europeanaLicense(i.rights?.[0] ?? "");
    if (!url || !/^https?:\/\//.test(url) || !license) continue;
    const verdict = judgeLicense(license);
    if (!verdict.ok) continue;
    const title = (i.title?.[0] ?? "untitled").replace(/\s+/g, " ").trim();
    const provider = i.dataProvider?.[0] ?? "Europeana";
    const year = Number(/-?\d{3,4}/.exec(i.year?.[0] ?? "")?.[0]);
    const page = i.guid ?? "https://www.europeana.eu";
    out.push({
      title: `Europeana: ${title}`.slice(0, 200),
      source: "europeana",
      provider,
      ...(Number.isFinite(year) ? { year } : {}),
      url,
      downloadUrl: url,
      previewUrl: i.edmPreview?.[0] ?? url,
      description: [title, i.year?.[0], i.dcCreator?.[0], provider, i.dcDescription?.[0]].filter(Boolean).join(" · ").slice(0, 400),
      width: 0,
      height: 0,
      mime: "image/jpeg",
      descriptionUrl: page,
      credit: { title, author: `${i.dcCreator?.[0] ?? provider} — ${provider}`, license, licenseUrl: i.rights?.[0] ?? "", sourceUrl: page, attributionRequired: verdict.attributionRequired },
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

/** Whether a CC BY-SA candidate stays: in a reference (only looked at for drawing, never shown) always, on screen only with the owner's yes. */
export function keepShareAlike(c: CommonsCandidate, use: "screen" | "reference", env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (use === "reference" || shareAlikeAllowed(env)) return true;
  const v = judgeLicense(c.credit.license);
  return !(v.ok && v.family === "CC-BY-SA");
}

/**
 * Candidates from every source, de-duplicated, in judging order (see periodRank), so the judge's limited looks go
 * to period works first. `use` "screen" (the default: the picture is shown in the video) leaves CC BY-SA out unless
 * ATOLYE_V3_BYSA_IZIN=1 — ShareAlike could bind the whole video; "reference" (a costume piece looked at for drawing) keeps it.
 */
export async function findPeriodCandidates(
  cacheDir: string,
  s: PeriodSearch,
  periodEnd?: number,
  opts: { readonly use?: "screen" | "reference"; readonly env?: Readonly<Record<string, string | undefined>>; /** false: only the English article and the searches (tests, offline). */ readonly wide?: boolean } = {},
): Promise<PeriodCandidates> {
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
  // The subject everywhere (owner, 21 Nov 2026): its Commons category, the works Wikidata says depict it, its articles in
  // other languages, and Europe's national collections under its names there — titles in any language; the caption is
  // put into English when the picture is chosen (BackgroundJudge.englishTitle).
  const subject = s.wiki && (opts.wide ?? true) ? await wikiSubject(cacheDir, s.wiki).catch((e: Error) => (report.push(`Wikidata: hata (${e.message.slice(0, 80)})`), undefined)) : undefined;
  const otherNames: string[] = [];
  if (subject) {
    const category = s.commonsCategory ?? subject.commonsCategory;
    if (category) await take(`Commons kategorisi "${category}"`, () => commonsCategoryCandidates(cacheDir, category));
    await take(`Wikidata eserleri ${subject.qid}`, () => depictionCandidates(cacheDir, subject.qid));
    for (const lang of OTHER_WIKI_LANGS.filter((l) => subject.titles[l]).slice(0, OTHER_WIKIS)) {
      const title = subject.titles[lang]!;
      otherNames.push(title);
      await take(`Wikipedia ${lang} "${title}"`, () => wikipediaCandidates(cacheDir, title, lang));
    }
  }
  for (const q of [s.query, ...otherNames.slice(0, 2)].filter((q, i, all) => all.findIndex((x) => fold(x) === fold(q)) === i)) await take(`Europeana "${q}"`, () => europeanaCandidates(cacheDir, q, 8, opts.env));
  await take(`The Met "${s.query}"`, () => metCandidates(cacheDir, s.query));
  await take(`Openverse "${s.query}"`, () => openverseCandidates(cacheDir, s.query));
  await take(`Chicago "${s.query}"`, () => aicCandidates(cacheDir, s.query));
  await take(`Cleveland "${s.query}"`, () => clevelandCandidates(cacheDir, s.query));
  await take(`Commons "${s.query}"`, async () => {
    let found = await commons(s.commonsCategory ? `${s.query} incategory:"${s.commonsCategory}"` : s.query);
    if (!found.length && s.commonsCategory) found = await commons(s.query);
    return found;
  });
  const extra = [...(s.alternatives ?? []).slice(0, 3), ...otherNames.slice(0, 2)];
  if (s.wiki) {
    try {
      extra.push(...aliasQueries(s.wiki, await wikipediaAliases(cacheDir, s.wiki)));
    } catch (e) {
      report.push(`Wikipedia adları: hata (${(e as Error).message.slice(0, 80)})`);
    }
  }
  for (const q of [...new Set(extra)].filter((q) => fold(q) !== fold(s.query)).slice(0, 6)) await take(`Commons "${q}"`, () => commons(q));
  const seen = new Set<string>();
  const use = opts.use ?? "screen";
  const shareAlike = lists.flat().filter((c) => !keepShareAlike(c, use, opts.env));
  if (shareAlike.length) report.push(`CC BY-SA: ${new Set(shareAlike.map((c) => c.url)).size} aday gösterilmez (owner onayı: ATOLYE_V3_BYSA_IZIN=1)`);
  const all = lists.flat().filter((c) => {
    if (!keepShareAlike(c, use, opts.env)) return false;
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

// The period readers live with the episode (the validator needs them too); re-exported for the existing importers.
export { type Era, eraOf, periodEndYear };

/** Where a candidate really comes from, as its caption names it (until 12 Nov 2026 every non-Met picture said Commons). */
export function sourceName(c: CommonsCandidate): string {
  if (c.source === "met") return "The Met";
  if (c.source === "aic") return "Art Institute of Chicago";
  if (c.source === "cleveland") return "Cleveland Museum of Art";
  if (c.source === "openverse") return c.provider ? `${c.provider} via Openverse` : "Openverse";
  if (c.source === "europeana") return c.provider && c.provider !== "Europeana" ? `${c.provider} via Europeana` : "Europeana";
  // A Wikipedia's own upload, not a Commons file the article shows.
  let host = "";
  try {
    host = new URL(c.descriptionUrl).hostname;
  } catch {
    // no address: Commons, as before
  }
  return /(^|\.)wikipedia\.org$/.test(host) ? "Wikipedia" : "Wikimedia Commons";
}

/** Short source plate for a cutaway: title, author/year, where it is from. */
export function insertCaption(c: CommonsCandidate, language: "tr" | "en", title?: string): string {
  const where = sourceName(c);
  // A museum's or Openverse's author ends with the institution ("Gentile Bellini — The Metropolitan Museum of Art"): the
  // plate names it as the source, the author keeps the artist alone.
  const museum = c.source === "met" || c.source === "aic" || c.source === "cleveland" || c.source === "openverse" || c.source === "europeana";
  const author = (museum ? c.credit.author.replace(/\s*—\s*[^—]+$/, "") : c.credit.author).replace(/\s+/g, " ").trim();
  // `title`: the work's title put into the video's language (a French, Italian or German file name; englishTitle).
  const head = (title?.trim() || c.credit.title).replace(/^File:/, "").replace(/\.(jpe?g|png)$/i, "").replace(/\s*\(\d{6,}\)\s*$/, "").trim();
  // A title that already names the artist or the year ("Jules-César arrivé au Rubicon, 1854, Musée Picardie, Gustave
  // Boulanger, 1854") does not get them again.
  const named = (s: string) => head.toLowerCase().includes(s.toLowerCase());
  const parts = [head.slice(0, 70), author && author.length <= 50 && !/wikimedia|^unknown$/i.test(author) && !named(author) ? author : "", c.year && !named(String(c.year)) ? String(c.year) : ""].filter(Boolean);
  return `${parts.join(", ")} · ${language === "en" ? "Source" : "Kaynak"}: ${where}`;
}
