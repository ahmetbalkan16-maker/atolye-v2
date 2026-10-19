import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { type CreditRecord, judgeLicense } from "./LicenseFilter";

/**
 * Wikimedia Commons search with license metadata (extmetadata). Responses are cached on disk; images are
 * downloaded once and kept as local assets (never hotlinked). Only whitelisted licenses are returned.
 */
const API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "AtolyeV3/0.1 (personal documentary studio; local tool)";

export interface CommonsCandidate {
  readonly title: string;
  readonly url: string;
  /** Standard-size rendition (Commons refuses arbitrary thumbnail widths). */
  readonly downloadUrl: string;
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

async function cachedJson(cacheDir: string, url: string): Promise<unknown> {
  const key = createHash("sha256").update(url).digest("hex").slice(0, 24);
  const file = path.join(cacheDir, `${key}.json`);
  if (existsSync(file)) {
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs < 24 * 3600_000) return JSON.parse(await fs.readFile(file, "utf8"));
  }
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`COMMONS_HTTP_${res.status}`);
  const json = await res.json();
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(json));
  return json;
}

function toCandidate(title: string, info: ImageInfo): CommonsCandidate | undefined {
  const m = info.extmetadata ?? {};
  const verdict = judgeLicense(stripHtml(m.LicenseShortName?.value), stripHtml(m.UsageTerms?.value));
  if (!verdict.ok) return undefined;
  return {
    title,
    url: info.url,
    downloadUrl: info.thumburl ?? info.url,
    width: info.width,
    height: info.height,
    mime: info.mime,
    descriptionUrl: info.descriptionurl,
    credit: {
      title: stripHtml(m.ObjectName?.value) || title.replace(/^File:/, ""),
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
    iiextmetadatafilter: "LicenseShortName|UsageTerms|Artist|Credit|AttributionRequired|LicenseUrl|ObjectName",
    iiurlwidth: "3840",
  });
  const json = (await cachedJson(cacheDir, `${API}?${params}`)) as { query?: { pages?: Record<string, { title: string; imageinfo?: ImageInfo[] }> } };
  const out: CommonsCandidate[] = [];
  for (const page of Object.values(json.query?.pages ?? {})) {
    const info = page.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png)$/.test(info.mime)) continue;
    if (info.width < (opts.minWidth ?? 1600)) continue;
    if (opts.landscape !== false && info.width < info.height * 1.15) continue;
    const c = toCandidate(page.title, info);
    if (c) out.push(c);
  }
  return out.sort((a, b) => b.width - a.width);
}

/** One file by its exact title ("File:…"), or undefined when missing or not freely licensed. */
export async function commonsByTitle(cacheDir: string, title: string): Promise<CommonsCandidate | undefined> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    titles: title,
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiextmetadatafilter: "LicenseShortName|UsageTerms|Artist|Credit|AttributionRequired|LicenseUrl|ObjectName",
    iiurlwidth: "3840",
  });
  const json = (await cachedJson(cacheDir, `${API}?${params}`)) as { query?: { pages?: Record<string, { title: string; imageinfo?: ImageInfo[] }> } };
  const page = Object.values(json.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  return page && info ? toCandidate(page.title, info) : undefined;
}

/** Downloads a candidate (standard rendition, at most 3840 px wide) as a local asset with its credit. */
export async function downloadCommons(c: CommonsCandidate, outFile: string): Promise<CreditRecord> {
  const res = await fetch(c.downloadUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`COMMONS_DOWNLOAD_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, buf);
  return { ...c.credit, assetId: path.basename(outFile), kind: "image", sha256: createHash("sha256").update(buf).digest("hex") };
}
