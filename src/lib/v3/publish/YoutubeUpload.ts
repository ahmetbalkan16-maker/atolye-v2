import { promises as fs } from "node:fs";
import type { YoutubePackage } from "../thumbnail/YoutubePackage";
import type { Fetcher } from "./YoutubeAuth";

/**
 * One V3 episode onto YouTube (owner, 2 Nov 2026: AYAS uploads, but only a video the owner approved). What is sent is
 * the episode's own package — youtube.json's first title, aciklama.txt (hook, chapters, sources, credits, hashtags),
 * the tags — plus the settings that send it to the right audience: Education, American English title and audio, not
 * made for kids (a cartoon must say so, or YouTube may file it under children's content and switch off comments and
 * recommendations), no realistic altered/synthetic media (V3 draws everything; designed pictures are never
 * photo-real and say so on screen). The upload is resumable: an interrupted one continues from YouTube's last byte.
 * V2's YouTubeDataApiPublishProvider stays V2's: its requests are private-only and bound to a V2 package identity.
 */

export const YOUTUBE_CATEGORY_EDUCATION = "27";

export interface UploadMeta {
  readonly snippet: {
    readonly title: string;
    readonly description: string;
    readonly tags: readonly string[];
    readonly categoryId: string;
    readonly defaultLanguage: string;
    readonly defaultAudioLanguage: string;
  };
  readonly status: {
    readonly privacyStatus: "private" | "public";
    readonly publishAt?: string;
    readonly selfDeclaredMadeForKids: false;
    readonly containsSyntheticMedia: false;
    readonly license: "youtube";
    readonly embeddable: true;
  };
}

const noAngles = (s: string) => s.replace(/[<>]/g, "");

/** Tags within YouTube's 500 characters: the commas count, and a tag with a space counts its two quotes. */
export function fitTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  let used = 0;
  for (const raw of tags) {
    const t = noAngles(raw).replace(/[,#"]/g, "").replace(/\s+/g, " ").trim();
    if (!t || out.some((o) => o.toLowerCase() === t.toLowerCase())) continue;
    const cost = t.length + (t.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
    if (used + cost > 500) break;
    out.push(t);
    used += cost;
  }
  return out;
}

/** YouTube's description limit, in bytes. */
export const DESCRIPTION_MAX_BYTES = 5000;

/**
 * A credit line a licence obliges us to keep (CC BY, CC BY-SA, a Creative Commons music credit, OpenStreetMap's ODbL,
 * the GPL borders): never cut to fit the description.
 */
export const REQUIRED_CREDIT = /\bCC[ -]?BY\b|\bBY-SA\b|Creative Commons|creativecommons\.org\/licenses\/by|\bODbL\b|\bGPL-?\d/i;

export interface DescriptionFit {
  readonly text: string;
  /** Lines cut to fit. */
  readonly dropped: number;
  /** Required credit lines that still had to go: the description cannot be published like this. */
  readonly requiredDropped: readonly string[];
}

/**
 * The description within YouTube's 5000 bytes. aciklama.txt ends with the dramatization note and the hashtags; when a
 * long episode runs over, lines go from the end upward — never the ending, a section heading, a blank line, or a credit
 * line the licence requires (REQUIRED_CREDIT, or one of `required`). Until 12 Nov 2026 the image and voice credits,
 * which come last, were the first to go. If the required lines alone do not fit, they go too and are reported.
 */
export function fitDescriptionReport(text: string, required: readonly string[] = []): DescriptionFit {
  const lines = noAngles(text).trim().split(/\r?\n/);
  const whole = lines.join("\n");
  if (Buffer.byteLength(whole) <= DESCRIPTION_MAX_BYTES) return { text: whole, dropped: 0, requiredDropped: [] };
  const must = new Set(required.map((l) => noAngles(l).trim()));
  const isRequired = (l: string) => must.has(l.trim()) || REQUIRED_CREDIT.test(l);
  const isFrame = (l: string) => !l.trim() || /^[^\s:]{1,30}( [^\s:]{1,30})?:$/.test(l.trim());
  const tail = lines.slice(-3);
  const head = lines.slice(0, -3);
  const keep = head.map(() => true);
  let size = Buffer.byteLength([...head, "…", ...tail].join("\n"));
  const cut = (i: number) => {
    keep[i] = false;
    size -= Buffer.byteLength(head[i]!) + 1;
  };
  for (let i = head.length - 1; i >= 0 && size > DESCRIPTION_MAX_BYTES; i--) if (!isRequired(head[i]!) && !isFrame(head[i]!)) cut(i);
  const requiredDropped: string[] = [];
  for (let i = head.length - 1; i >= 0 && size > DESCRIPTION_MAX_BYTES; i--) {
    if (!keep[i]) continue;
    if (isRequired(head[i]!)) requiredDropped.push(head[i]!);
    cut(i);
  }
  return { text: [...head.filter((_, i) => keep[i]), "…", ...tail].join("\n"), dropped: keep.filter((k) => !k).length, requiredDropped };
}

export function fitDescription(text: string, required: readonly string[] = []): string {
  return fitDescriptionReport(text, required).text;
}

/** A scheduled upload waits private until `publishAt`; without one it is public at once (the owner's "hemen"). */
export function uploadMeta(o: { readonly paket: YoutubePackage; readonly aciklama: string; readonly dil: "tr" | "en"; readonly publishAt?: string }): UploadMeta {
  const first = (o.paket.basliklar[0] ?? "").trim();
  const title = noAngles(first).slice(0, 100).trim();
  if (!title) throw new Error("YOUTUBE_META: paketin başlığı yok");
  // aciklama.txt opens with the title for the owner to copy; the description is what follows it.
  const lines = o.aciklama.split(/\r?\n/);
  const body = lines[0]?.trim() === first ? lines.slice(1).join("\n") : o.aciklama;
  const fixed = { selfDeclaredMadeForKids: false, containsSyntheticMedia: false, license: "youtube", embeddable: true } as const;
  // A video whose required credits do not fit is not uploaded without them (the licence's condition, not a style rule).
  const fit = fitDescriptionReport(body);
  if (fit.requiredDropped.length) throw new Error(`YOUTUBE_META: zorunlu atıf satırları 5000 bayta sığmıyor (${fit.requiredDropped.length} satır) — açıklamayı kısaltın`);
  return {
    snippet: { title, description: fit.text, tags: fitTags(o.paket.etiketler), categoryId: YOUTUBE_CATEGORY_EDUCATION, defaultLanguage: o.dil, defaultAudioLanguage: o.dil === "en" ? "en-US" : "tr" },
    status: o.publishAt ? { privacyStatus: "private", publishAt: o.publishAt, ...fixed } : { privacyStatus: "public", ...fixed },
  };
}

function isTrustedUploadUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "www.googleapis.com" || url.hostname === "youtube.googleapis.com");
  } catch {
    return false;
  }
}

/** YouTube's reason for a refusal ("quotaExceeded", "uploadLimitExceeded", …), read from at most 64 KB. */
async function refusal(r: Response): Promise<string> {
  try {
    const text = (await r.text()).slice(0, 65_536);
    const j = JSON.parse(text) as { error?: { errors?: { reason?: unknown }[]; message?: unknown } };
    const reason = j.error?.errors?.[0]?.reason ?? j.error?.message;
    return typeof reason === "string" ? reason.slice(0, 160) : "";
  } catch {
    return "";
  }
}

class UploadError extends Error {
  constructor(message: string, readonly transient: boolean) {
    super(message);
  }
}

/** Opens a resumable session (`videos.insert`); the session URL is what a resumed upload continues on. */
export async function startUpload(fetcher: Fetcher, token: string, meta: UploadMeta, size: number): Promise<string> {
  const r = await fetcher("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(size), "X-Upload-Content-Type": "video/mp4" },
    body: JSON.stringify(meta),
  });
  if (!r.ok) throw new UploadError(`YOUTUBE_UPLOAD_START: http ${r.status} ${await refusal(r)}`.trim(), r.status >= 500 || r.status === 429);
  const url = r.headers.get("location");
  if (!isTrustedUploadUrl(url)) throw new UploadError("YOUTUBE_UPLOAD_START: güvenilmeyen yükleme adresi", false);
  return url;
}

type ChunkAnswer = { readonly received: number } | { readonly video: Record<string, unknown> };

async function chunkAnswer(r: Response): Promise<ChunkAnswer> {
  if (r.status === 308) {
    await r.body?.cancel().catch(() => undefined);
    const m = /bytes=0-(\d+)/.exec(r.headers.get("range") ?? "");
    return { received: m ? Number(m[1]) + 1 : 0 };
  }
  if (r.status === 200 || r.status === 201) return { video: (await r.json()) as Record<string, unknown> };
  if (r.status === 404 || r.status === 410) throw new UploadError("YOUTUBE_SESSION_GONE: yükleme oturumu kapanmış", false);
  throw new UploadError(`YOUTUBE_UPLOAD: http ${r.status} ${await refusal(r)}`.trim(), r.status >= 500 || r.status === 429);
}

/** Bytes YouTube already holds for the session, or the finished video when it holds them all. */
export async function uploadStatus(fetcher: Fetcher, token: string, url: string, size: number): Promise<ChunkAnswer> {
  return chunkAnswer(await fetcher(url, { method: "PUT", redirect: "manual", headers: { Authorization: `Bearer ${token}`, "Content-Length": "0", "Content-Range": `bytes */${size}` } }));
}

/** 16 MiB: a multiple of the 256 KiB the resumable protocol asks for; a 1.5 GB episode is ~90 requests. */
export const UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_CHUNK_FAILURES = 6;

/**
 * Sends the file from `from` in chunks and returns YouTube's video resource. A dropped connection or a 5xx asks
 * YouTube how much it holds and goes on from there (backing off up to a minute); a refusal (4xx) stops at once.
 */
export async function sendFile(fetcher: Fetcher, token: () => Promise<string>, url: string, file: string, size: number, from: number, o: { readonly sleep?: (ms: number) => Promise<void>; readonly chunkBytes?: number; readonly log?: (line: string) => void } = {}): Promise<Record<string, unknown>> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const chunk = o.chunkBytes ?? UPLOAD_CHUNK_BYTES;
  const handle = await fs.open(file, "r");
  try {
    let offset = from;
    let failures = 0;
    let lastTenth = Math.floor((from / size) * 10);
    for (;;) {
      try {
        let answer: ChunkAnswer;
        if (offset >= size) {
          answer = await uploadStatus(fetcher, await token(), url, size);
          if ("received" in answer && answer.received >= size) throw new UploadError("YOUTUBE_UPLOAD: dosyanın tamamı gitti ama video dönmedi", true);
        } else {
          const len = Math.min(chunk, size - offset);
          const buf = Buffer.alloc(len);
          await handle.read(buf, 0, len, offset);
          answer = await chunkAnswer(await fetcher(url, { method: "PUT", redirect: "manual", headers: { Authorization: `Bearer ${await token()}`, "Content-Length": String(len), "Content-Range": `bytes ${offset}-${offset + len - 1}/${size}` }, body: buf as unknown as BodyInit }));
        }
        if ("video" in answer) return answer.video;
        offset = answer.received;
        failures = 0;
        const tenth = Math.floor((offset / size) * 10);
        if (tenth > lastTenth) o.log?.(`  yükleme %${tenth * 10}`);
        lastTenth = tenth;
      } catch (e) {
        // fetch's own failure (a dropped connection) is a TypeError: as transient as a 5xx.
        if (e instanceof UploadError && !e.transient) throw e;
        if (++failures > MAX_CHUNK_FAILURES) throw new UploadError(`YOUTUBE_UPLOAD: ${MAX_CHUNK_FAILURES} denemede ilerlemedi (${(e as Error).message})`, true);
        await sleep(Math.min(60_000, 2 ** failures * 1000));
        const s = await uploadStatus(fetcher, await token(), url, size).catch((err: unknown) => {
          if (err instanceof UploadError && !err.transient) throw err;
          return undefined;
        });
        if (s && "video" in s) return s.video;
        if (s) offset = s.received;
      }
    }
  } finally {
    await handle.close();
  }
}

export function isTransientUploadError(e: unknown): boolean {
  return !(e instanceof UploadError) || e.transient;
}

/** The thumbnail (`thumbnails.set`); a channel without custom thumbnails refuses it, which never undoes the upload. */
export async function setThumbnail(fetcher: Fetcher, token: string, videoId: string, file: string): Promise<void> {
  const body = await fs.readFile(file);
  const r = await fetcher(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": /\.png$/i.test(file) ? "image/png" : "image/jpeg", "Content-Length": String(body.length) },
    body: body as unknown as BodyInit,
  });
  if (r.ok) return;
  const why = await refusal(r);
  throw new Error(`kapak yüklenemedi (http ${r.status}${why ? `, ${why}` : ""})`);
}

/** The channel's latest 50 uploads, private and scheduled ones included for the owner's token (1 quota unit). */
export async function recentUploads(fetcher: Fetcher, token: string, playlistId: string): Promise<{ readonly videoId: string; readonly title: string }[]> {
  const q = new URLSearchParams({ part: "snippet", maxResults: "50", playlistId });
  const r = await fetcher(`https://www.googleapis.com/youtube/v3/playlistItems?${q.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`YOUTUBE_UPLOADS: kanalın videoları okunamadı (http ${r.status})`);
  const items = ((await r.json()) as { items?: { snippet?: { title?: unknown; resourceId?: { videoId?: unknown } } }[] }).items ?? [];
  return items.flatMap((i) => (typeof i.snippet?.title === "string" && typeof i.snippet.resourceId?.videoId === "string" ? [{ videoId: i.snippet.resourceId.videoId, title: i.snippet.title }] : []));
}

/** Titles compared the way a viewer reads them: case, spacing and punctuation aside. */
export function sameTitle(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return n(a) === n(b);
}
