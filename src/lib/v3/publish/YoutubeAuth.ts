import { createHash, randomBytes } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "../V3Paths";

/**
 * The owner's permission for AYAS to upload to their YouTube channel (owner, 2 Nov 2026: "yükleme iznini ayarlayalım").
 * A Desktop-app OAuth client the owner creates in Google Cloud (`client.json`, Google's own download) and one consent in
 * the owner's browser give a refresh token (`token.json`); both live in the secrets folder `ATOLYE_V3_YOUTUBE_DIR`,
 * never in git. The scopes are upload (video + thumbnail) and read-only (to prove the channel and see its uploads):
 * nothing here can delete or edit a video. The token is bound to one channel id; another channel is refused.
 */
export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"] as const;

export type Fetcher = (input: string, init?: RequestInit & { duplex?: "half" }) => Promise<Response>;

export interface YoutubeClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface YoutubeToken {
  readonly refreshToken: string;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly scope: string;
  readonly baglandi: string;
}

export interface YoutubeSettings {
  /** The secrets folder: client.json, token.json and the open upload sessions. */
  readonly dir: string;
  /** The owner's channel (UC…); a consent or token for another channel is refused. */
  readonly channelId?: string;
}

/** The environment first, then the repository's `.env.v3.local`; the default stays in the git-ignored output folder. */
export function youtubeSettings(repoRoot = process.cwd(), env: Readonly<Record<string, string | undefined>> = process.env): YoutubeSettings {
  const file = loadEnvFile(path.join(repoRoot, ".env.v3.local"));
  const get = (key: string) => env[key] || file[key] || undefined;
  const channelId = get("ATOLYE_V3_YOUTUBE_CHANNEL_ID");
  return { dir: get("ATOLYE_V3_YOUTUBE_DIR") ?? path.join(repoRoot, "output", "v3-youtube"), ...(channelId ? { channelId } : {}) };
}

/** Google's client download; only a Desktop-app client ("installed") may be used, as the consent ends on 127.0.0.1. */
export function readClient(json: string): YoutubeClient {
  const c = (JSON.parse(json) as { installed?: { client_id?: unknown; client_secret?: unknown } }).installed;
  if (!c || typeof c.client_id !== "string" || typeof c.client_secret !== "string") {
    throw new Error("YOUTUBE_CLIENT_NOT_DESKTOP: client.json bir Masaüstü uygulaması (Desktop app) OAuth istemcisi değil");
  }
  return { clientId: c.client_id, clientSecret: c.client_secret };
}

export async function loadClient(settings: YoutubeSettings): Promise<YoutubeClient> {
  const file = path.join(settings.dir, "client.json");
  if (!existsSync(file)) throw new Error(`YOUTUBE_NOT_CONNECTED: ${file} yok (Google Cloud'dan indirilen OAuth istemcisi)`);
  return readClient(await fs.readFile(file, "utf8"));
}

export async function loadToken(settings: YoutubeSettings): Promise<YoutubeToken | undefined> {
  const file = path.join(settings.dir, "token.json");
  if (!existsSync(file)) return undefined;
  const t = JSON.parse(await fs.readFile(file, "utf8")) as YoutubeToken;
  if (typeof t.refreshToken !== "string" || typeof t.channelId !== "string") throw new Error(`YOUTUBE_TOKEN_UNREADABLE: ${file}`);
  if (settings.channelId && t.channelId !== settings.channelId) throw new Error(`YOUTUBE_WRONG_CHANNEL: izin ${t.channelId} kanalına verilmiş, beklenen ${settings.channelId}`);
  return t;
}

export async function saveToken(settings: YoutubeSettings, token: YoutubeToken): Promise<void> {
  await fs.mkdir(settings.dir, { recursive: true });
  const file = path.join(settings.dir, "token.json");
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(token, null, 2)}\n`);
  await fs.rename(`${file}.tmp`, file);
}

/** PKCE (S256): the code the browser brings back is useless without the verifier this process keeps. */
export function pkce(): { readonly verifier: string; readonly challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** `prompt=consent` + `access_type=offline` make Google return a refresh token even on a second consent. */
export function consentUrl(client: YoutubeClient, redirectUri: string, state: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

async function tokenRequest(fetcher: Fetcher, body: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await fetcher("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const error = typeof j.error === "string" ? j.error : `http ${r.status}`;
    // A revoked consent, a changed Google password or six unused months: only the owner can give it again.
    throw new Error(error === "invalid_grant" ? "YOUTUBE_RECONNECT: YouTube izni geri alınmış ya da süresi dolmuş; `npx tsx scripts/v3/youtube.ts baglan` ile yeniden bağlan" : `YOUTUBE_TOKEN: ${error}`);
  }
  return j;
}

export async function exchangeCode(fetcher: Fetcher, client: YoutubeClient, code: string, verifier: string, redirectUri: string): Promise<{ readonly accessToken: string; readonly refreshToken: string; readonly scope: string }> {
  const j = await tokenRequest(fetcher, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri, client_id: client.clientId, client_secret: client.clientSecret });
  if (typeof j.access_token !== "string" || typeof j.refresh_token !== "string") throw new Error("YOUTUBE_TOKEN: Google yenileme anahtarı vermedi");
  const scope = typeof j.scope === "string" ? j.scope : "";
  // The owner may untick a scope on the consent screen; without upload the connection is useless.
  if (!scope.split(/\s+/).includes(YOUTUBE_SCOPES[0])) throw new Error("YOUTUBE_SCOPE_MISSING: onay ekranında video yükleme izni verilmedi");
  return { accessToken: j.access_token, refreshToken: j.refresh_token, scope };
}

/** An access token for the next hour; the caller asks again for long uploads (see `tokenSource`). */
export async function refreshAccessToken(fetcher: Fetcher, client: YoutubeClient, token: Pick<YoutubeToken, "refreshToken">): Promise<{ readonly accessToken: string; readonly expiresInS: number }> {
  const j = await tokenRequest(fetcher, { grant_type: "refresh_token", refresh_token: token.refreshToken, client_id: client.clientId, client_secret: client.clientSecret });
  if (typeof j.access_token !== "string") throw new Error("YOUTUBE_TOKEN: Google erişim anahtarı vermedi");
  return { accessToken: j.access_token, expiresInS: typeof j.expires_in === "number" ? j.expires_in : 3600 };
}

/** A token supplier that refreshes five minutes before the hour runs out (a 1.5 GB upload can outlast one token). */
export function tokenSource(fetcher: Fetcher, client: YoutubeClient, token: Pick<YoutubeToken, "refreshToken">, now = () => Date.now()): () => Promise<string> {
  let cached: { value: string; until: number } | undefined;
  return async () => {
    if (cached && now() < cached.until) return cached.value;
    const fresh = await refreshAccessToken(fetcher, client, token);
    cached = { value: fresh.accessToken, until: now() + Math.max(60, fresh.expiresInS - 300) * 1000 };
    return cached.value;
  };
}

export interface YoutubeChannelInfo {
  readonly id: string;
  readonly title: string;
  readonly uploadsPlaylist?: string;
  readonly country?: string;
  readonly defaultLanguage?: string;
  readonly keywords?: string;
  readonly madeForKids?: boolean;
  readonly selfDeclaredMadeForKids?: boolean;
  /** "allowed" lets videos over 15 minutes in (a phone-verified channel); the 20–30 min episodes need it. */
  readonly longUploadsStatus?: string;
  readonly privacyStatus?: string;
}

/** The channel the token belongs to (`channels.list mine=true`, 1 quota unit). */
export async function myChannel(fetcher: Fetcher, accessToken: string): Promise<YoutubeChannelInfo> {
  const r = await fetcher("https://www.googleapis.com/youtube/v3/channels?part=id,snippet,status,brandingSettings,contentDetails&mine=true", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`YOUTUBE_CHANNEL: kanal okunamadı (http ${r.status})`);
  const items = ((await r.json()) as { items?: Record<string, Record<string, unknown> | string>[] }).items ?? [];
  if (items.length !== 1) throw new Error(`YOUTUBE_CHANNEL: bu Google hesabında ${items.length} kanal seçili; onay ekranında tek kanal seçilmeli`);
  const c = items[0]!;
  const sub = (k: string) => (typeof c[k] === "object" && c[k] ? (c[k] as Record<string, unknown>) : {});
  const snippet = sub("snippet");
  const status = sub("status");
  const branding = (sub("brandingSettings").channel ?? {}) as Record<string, unknown>;
  const uploads = ((sub("contentDetails").relatedPlaylists ?? {}) as Record<string, unknown>).uploads;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
  const id = str(c.id);
  if (!id || !/^UC[\w-]{20,30}$/.test(id)) throw new Error("YOUTUBE_CHANNEL: kanal kimliği okunamadı");
  const info = {
    id,
    title: str(snippet.title) ?? "",
    uploadsPlaylist: str(uploads),
    country: str(snippet.country) ?? str(branding.country),
    defaultLanguage: str(snippet.defaultLanguage) ?? str(branding.defaultLanguage),
    keywords: str(branding.keywords),
    madeForKids: bool(status.madeForKids),
    selfDeclaredMadeForKids: bool(status.selfDeclaredMadeForKids),
    longUploadsStatus: str(status.longUploadsStatus),
    privacyStatus: str(status.privacyStatus),
  };
  return Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined)) as unknown as YoutubeChannelInfo;
}
