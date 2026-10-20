import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { type CreditRecord, judgeLicense } from "./LicenseFilter";

/**
 * Wikimedia Commons search with license metadata (extmetadata). Responses are cached on disk; images are
 * downloaded once and kept as local assets (never hotlinked). Only whitelisted licenses are returned.
 */
const API = "https://commons.wikimedia.org/w/api.php";
export const USER_AGENT = "AtolyeV3/0.1 (personal documentary studio; local tool)";

export interface CommonsCandidate {
  readonly title: string;
  /** Where it was found: a Wikipedia article about the subject, a Commons search, or a museum collection. */
  readonly source?: "wikipedia" | "commons" | "met" | "openverse";
  /** Year the image was made, when the metadata says (a 2013 photo of a 1452 fortress is not a period image). */
  readonly year?: number;
  readonly url: string;
  /** Standard-size rendition (Commons refuses arbitrary thumbnail widths). */
  readonly downloadUrl: string;
  /** A small standard rendition (960 px) for judging a candidate before downloading it in full. */
  readonly previewUrl: string;
  /** Commons description and date, plain text (for judging relevance). */
  readonly description: string;
  readonly width: number;
  readonly height: number;
  readonly mime: string;
  readonly descriptionUrl: string;
  readonly credit: Omit<CreditRecord, "assetId" | "kind" | "sha256">;
}

interface ImageInfo {
  url: string;
  thumburl?: string;
  width: number;
  height: number;
  mime: string;
  descriptionurl: string;
  extmetadata?: Record<string, { value?: string }>;
}

const stripHtml = (s: string | undefined) => (s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

export async function cachedJson(cacheDir: string, url: string): Promise<unknown> {
  const key = createHash("sha256").update(url).digest("hex").slice(0, 24);
  const file = path.join(cacheDir, `${key}.json`);
  if (existsSync(file)) {
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs < 24 * 3600_000) return JSON.parse(await fs.readFile(file, "utf8"));
  }
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`COMMONS_HTTP_${res.status}`);
  const json = await res.json();
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(json));
  return json;
}

/**
 * GET with Wikimedia's manners: our User-Agent, and on 429/503 (rate limit, the Rubicon run hit it while judging
 * dozens of previews) a wait — Retry-After when given, else 2, 4, 8, 16 s — before up to four more tries.
 */
let lastWikimedia = 0;

export async function politeFetch(url: string, tries = 5): Promise<Response> {
  for (let i = 0; ; i++) {
    // At most one request a second to Wikimedia (its thumbnail servers rate-limit bursts).
    if (/wikimedia\.org|wikipedia\.org/.test(url)) {
      const wait = lastWikimedia + 1_000 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastWikimedia = Date.now();
    }
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if ((res.status !== 429 && res.status !== 503) || i >= tries - 1) return res;
    const after = Number(res.headers.get("retry-after"));
    await new Promise((r) => setTimeout(r, Number.isFinite(after) && after > 0 ? Math.min(after, 60) * 1000 : 2000 * 2 ** i));
  }
}

/**
 * Artwork titles often carry Wikidata QuickStatements (`title QS:P1476,en:"The Sultan Mehmet II" label QS:…`):
 * the English title is kept, the machinery dropped.
 */
export function cleanObjectName(raw: string): string {
  if (!/QS:/.test(raw)) return raw;
  const en = /en:"([^"]+)"/.exec(raw);
  return (en ? en[1]! : raw.replace(/\b(title|label)?\s*QS:\S+/g, "")).replace(/\s+/g, " ").trim();
}

/** First plausible year (1000–2099, or a three-digit one) in a metadata date such as "circa 1838" or "2013-09-21". */
export function yearOf(text: string | undefined): number | undefined {
  const m = /\b(1\d{3}|20\d{2}|[1-9]\d{2})\b/.exec(text ?? "");
  return m ? Number(m[1]) : undefined;
}

function toCandidate(title: string, info: ImageInfo, source: CommonsCandidate["source"] = "commons"): CommonsCandidate | undefined {
  const m = info.extmetadata ?? {};
  const verdict = judgeLicense(stripHtml(m.LicenseShortName?.value), stripHtml(m.UsageTerms?.value));
  if (!verdict.ok) return undefined;
  const year = yearOf(stripHtml(m.DateTimeOriginal?.value));
  return {
    title,
    source,
    ...(year ? { year } : {}),
    url: info.url,
    downloadUrl: info.thumburl ?? info.url,
    // 500 is one of Commons' standard thumbnail steps, enough for the vision judge, and the most often pre-rendered (the
    // 960 step hit the rate limit on long judging runs); an original smaller than the requested width has no thumb.
    previewUrl: info.thumburl ? info.thumburl.replace(/\/\d+px-/, "/500px-") : info.url,
    description: [stripHtml(m.ImageDescription?.value), stripHtml(m.DateTimeOriginal?.value)].filter(Boolean).join(" · ").slice(0, 400),
    width: info.width,
    height: info.height,
    mime: info.mime,
    descriptionUrl: info.descriptionurl,
    credit: {
      title: cleanObjectName(stripHtml(m.ObjectName?.value)) || title.replace(/^File:/, ""),
      author: stripHtml(m.Artist?.value) || stripHtml(m.Credit?.value) || "Wikimedia Commons",
      license: stripHtml(m.LicenseShortName?.value) || verdict.family,
      ...(m.LicenseUrl?.value ? { licenseUrl: stripHtml(m.LicenseUrl.value) } : {}),
      sourceUrl: info.descriptionurl,
      attributionRequired: verdict.attributionRequired || m.AttributionRequired?.value === "true",
    },
  };
}

/** Full-text file search; keeps raster images at least `minWidth` wide with a whitelisted license. */
export async function searchCommons(cacheDir: string, query: string, opts: { minWidth?: number; limit?: number; landscape?: boolean } = {}): Promise<CommonsCandidate[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: "6",
    gsrlimit: String(opts.limit ?? 30),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiextmetadatafilter: "LicenseShortName|UsageTerms|Artist|Credit|AttributionRequired|LicenseUrl|ObjectName|ImageDescription|DateTimeOriginal",
    iiurlwidth: "3840",
  });
  const json = (await cachedJson(cacheDir, `${API}?${params}`)) as { query?: { pages?: Record<string, { title: string; index?: number; imageinfo?: ImageInfo[] }> } };
  const out: { c: CommonsCandidate; rank: number }[] = [];
  for (const page of Object.values(json.query?.pages ?? {})) {
    const info = page.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png)$/.test(info.mime)) continue;
    if (info.width < (opts.minWidth ?? 1600)) continue;
    if (opts.landscape !== false && info.width < info.height * 1.15) continue;
    const c = toCandidate(page.title, info);
    if (c) out.push({ c, rank: page.index ?? out.length });
  }
  // Commons' relevance order (pages arrive keyed by id): the first candidates are the ones worth judging.
  return out.sort((a, b) => a.rank - b.rank).map((x) => x.c);
}

/** One file by its exact title ("File:…"), or undefined when missing or not freely licensed. */
export async function commonsByTitle(cacheDir: string, title: string): Promise<CommonsCandidate | undefined> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    titles: title,
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiextmetadatafilter: "LicenseShortName|UsageTerms|Artist|Credit|AttributionRequired|LicenseUrl|ObjectName|ImageDescription|DateTimeOriginal",
    iiurlwidth: "3840",
  });
  const json = (await cachedJson(cacheDir, `${API}?${params}`)) as { query?: { pages?: Record<string, { title: string; imageinfo?: ImageInfo[] }> } };
  const page = Object.values(json.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  return page && info ? toCandidate(page.title, info) : undefined;
}

/** Several files by exact title (≤ 50, any order kept), skipping missing and non-free ones. */
export async function commonsByTitles(cacheDir: string, titles: readonly string[], source: CommonsCandidate["source"] = "commons"): Promise<CommonsCandidate[]> {
  if (!titles.length) return [];
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    titles: titles.slice(0, 50).join("|"),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiextmetadatafilter: "LicenseShortName|UsageTerms|Artist|Credit|AttributionRequired|LicenseUrl|ObjectName|ImageDescription|DateTimeOriginal",
    iiurlwidth: "3840",
  });
  const json = (await cachedJson(cacheDir, `${API}?${params}`)) as { query?: { normalized?: { from: string; to: string }[]; pages?: Record<string, { title: string; imageinfo?: ImageInfo[] }> } };
  const byTitle = new Map(Object.values(json.query?.pages ?? {}).map((p) => [p.title, p]));
  const norm = new Map((json.query?.normalized ?? []).map((n) => [n.from, n.to]));
  const out: CommonsCandidate[] = [];
  for (const t of titles.slice(0, 50)) {
    const page = byTitle.get(norm.get(t) ?? t);
    const info = page?.imageinfo?.[0];
    if (!page || !info || !/^image\/(jpeg|png)$/.test(info.mime)) continue;
    const c = toCandidate(page.title, info, source);
    if (c) out.push(c);
  }
  return out;
}

/** Downloads a candidate (standard rendition, at most 3840 px wide) as a local asset with its credit. */
export async function downloadCommons(c: CommonsCandidate, outFile: string): Promise<CreditRecord> {
  // The big rendition is generated on demand and is the first to be rate-limited: then a smaller standard step,
  // then the original file (the Rubicon run lost its chosen painting to a 429 on the 3840 px thumbnail).
  const urls = [...new Set([c.downloadUrl, c.downloadUrl.replace(/\/3840px-/, "/1920px-"), c.url])];
  let res: Response | undefined;
  for (const url of urls) {
    res = await politeFetch(url);
    if (res.ok) break;
  }
  if (!res?.ok) throw new Error(`COMMONS_DOWNLOAD_${res?.status ?? "?"}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, buf);
  return { ...c.credit, assetId: path.basename(outFile), kind: "image", sha256: createHash("sha256").update(buf).digest("hex") };
}

/** The candidate's small preview (for judging), downloaded once into the cache. */
export async function commonsPreview(cacheDir: string, c: CommonsCandidate): Promise<Buffer> {
  const file = path.join(cacheDir, "onizleme", `${createHash("sha256").update(c.previewUrl).digest("hex").slice(0, 24)}${path.extname(new URL(c.previewUrl).pathname) || ".jpg"}`);
  if (existsSync(file)) return fs.readFile(file);
  const res = await politeFetch(c.previewUrl);
  if (!res.ok) throw new Error(`COMMONS_PREVIEW_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buf);
  return buf;
}
