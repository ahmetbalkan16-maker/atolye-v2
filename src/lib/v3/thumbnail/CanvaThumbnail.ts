import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvFile, v3Secret } from "../V3Paths";

/**
 * An optional Canva thumbnail (owner, 13 Nov 2026: "o iki fikri işleme al, yaptır"): the owner's own Canva brand
 * templates are autofilled through the Canva Connect API with the episode's headline, title, period and a clean frame
 * of our chosen cover, and exported as a JPG next to our own cover (`kapak-canva.jpg`; `kapak.jpg` is never touched).
 * It does not replace the Remotion video or our own thumbnail: off unless `ATOLYE_V3_CANVA=1`, and any failure leaves
 * our own cover in place. This file is the pure part (settings, PKCE, the consent URL, the autofill data); the
 * network part is `CanvaClient.ts`, which the live AYAS server must never import.
 */

/**
 * The Connect API scopes the integration needs (canva.dev API reference, checked 13 Nov 2026): upload and read the
 * cover asset, list brand templates and read their data fields, autofill (write) and read the design job, export it.
 * Scopes do not imply each other (`asset:write` does not grant `asset:read`).
 */
export const CANVA_SCOPES = ["asset:read", "asset:write", "brandtemplate:content:read", "brandtemplate:meta:read", "design:content:read", "design:content:write", "design:meta:read"] as const;

export const CANVA_AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
export const CANVA_API = "https://api.canva.com/rest/v1";
/** The Canva starter kit's loopback shape; Canva matches the registered redirect URL, so the port is fixed. */
export const CANVA_DEFAULT_REDIRECT = "http://127.0.0.1:3917/oauth/redirect";
/** Our own cover stays `kapak.jpg`; the Canva one is always written beside it under this name. */
export const CANVA_COVER_FILE = "kapak-canva.jpg";
/** YouTube refuses a custom thumbnail over 2 MB. */
export const YOUTUBE_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

export type CanvaFormat = "uzun" | "kisa";

/** Our roles → the data field names the owner gave them in the brand template (Canva's "Data autofill" panel). */
export interface CanvaFieldNames {
  /** Text: the 2–4 word thumbnail headline ("HE DID WHAT?"). */
  readonly kapakBasligi: string;
  /** Text: the video title. */
  readonly videoBasligi: string;
  /** Text: the period ("49 BC"). */
  readonly donem: string;
  /** Text: the series line ("Fatih 06"); left empty for a single episode. */
  readonly dizi: string;
  /** Image: the cover picture (see `resim`). */
  readonly resim: string;
}

export interface CanvaTemplate {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

export interface CanvaSettings {
  /** `ATOLYE_V3_CANVA=1`; production tries Canva only then. */
  readonly enabled: boolean;
  readonly clientId?: string;
  readonly clientSecret?: string;
  /** Git-ignored folder of `token.json` (`ATOLYE_V3_CANVA_DIR`, default `output/v3-canva`). */
  readonly dir: string;
  readonly redirectUri: string;
  readonly templates: Readonly<Partial<Record<CanvaFormat, CanvaTemplate>>>;
  readonly fields: CanvaFieldNames;
  /**
   * What goes into the image field: "temiz" = the chosen cover drawn again without our headline (the template writes
   * its own), "kapak" = our finished cover as it is (a template that only frames it with the channel's branding).
   */
  readonly resim: "temiz" | "kapak";
  /** JPG quality of the export (1–100). */
  readonly quality: number;
}

export interface CanvaToken {
  readonly accessToken: string;
  /** Canva refresh tokens are single use: every refresh returns a new one, saved at once. */
  readonly refreshToken: string;
  /** Epoch ms. */
  readonly expiresAt: number;
  readonly scope: string;
  readonly baglandi: string;
}

const DEFAULT_FIELDS: CanvaFieldNames = { kapakBasligi: "kapak_basligi", videoBasligi: "video_basligi", donem: "donem", dizi: "dizi", resim: "resim" };
const DEFAULT_SIZE: Record<CanvaFormat, { width: number; height: number }> = { uzun: { width: 1280, height: 720 }, kisa: { width: 1080, height: 1920 } };

interface CanvaJson {
  readonly sablonlar?: Partial<Record<CanvaFormat, { id?: unknown; genislik?: unknown; yukseklik?: unknown }>>;
  readonly alanlar?: Partial<Record<keyof CanvaFieldNames, unknown>>;
  readonly resim?: unknown;
  readonly kalite?: unknown;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const size = (v: unknown, fallback: number) => (typeof v === "number" && Number.isInteger(v) && v >= 40 && v <= 25000 ? v : fallback);

/**
 * The environment first, then the repository's `.env.v3.local`; the client secret may also come from the env file
 * named by `ATOLYE_V3_SECRETS_ENV`. Template ids come from `ATOLYE_V3_CANVA_TEMPLATE_UZUN/_KISA` or
 * `content/v3/canva.json` (ids and field names only — never a secret).
 */
export function canvaSettings(repoRoot = process.cwd(), env: Readonly<Record<string, string | undefined>> = process.env): CanvaSettings {
  const file = loadEnvFile(path.join(repoRoot, ".env.v3.local"));
  const get = (key: string) => str(env[key]) ?? str(file[key]);
  const secret = (key: string) => get(key) ?? str(v3Secret(key, repoRoot, env));
  const jsonFile = path.join(repoRoot, "content", "v3", "canva.json");
  let json: CanvaJson = {};
  if (existsSync(jsonFile)) {
    try {
      json = JSON.parse(readFileSync(jsonFile, "utf8")) as CanvaJson;
    } catch {
      json = {};
    }
  }
  const templates: Partial<Record<CanvaFormat, CanvaTemplate>> = {};
  for (const f of ["uzun", "kisa"] as const) {
    const t = json.sablonlar?.[f];
    const id = get(`ATOLYE_V3_CANVA_TEMPLATE_${f.toUpperCase()}`) ?? str(t?.id);
    if (id) templates[f] = { id, width: size(t?.genislik, DEFAULT_SIZE[f].width), height: size(t?.yukseklik, DEFAULT_SIZE[f].height) };
  }
  const fields = Object.fromEntries((Object.keys(DEFAULT_FIELDS) as (keyof CanvaFieldNames)[]).map((k) => [k, str(json.alanlar?.[k]) ?? DEFAULT_FIELDS[k]])) as unknown as CanvaFieldNames;
  const quality = typeof json.kalite === "number" && json.kalite >= 1 && json.kalite <= 100 ? Math.round(json.kalite) : 90;
  const clientId = secret("ATOLYE_V3_CANVA_CLIENT_ID");
  const clientSecret = secret("ATOLYE_V3_CANVA_CLIENT_SECRET");
  return {
    enabled: get("ATOLYE_V3_CANVA") === "1",
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    dir: get("ATOLYE_V3_CANVA_DIR") ?? path.join(repoRoot, "output", "v3-canva"),
    redirectUri: get("ATOLYE_V3_CANVA_REDIRECT") ?? CANVA_DEFAULT_REDIRECT,
    templates,
    fields,
    resim: json.resim === "kapak" ? "kapak" : "temiz",
    quality,
  };
}

/** What still stops a Canva cover of this format, in the owner's words; empty = ready to try. */
export function canvaProblems(s: CanvaSettings, format?: CanvaFormat): string[] {
  const out: string[] = [];
  if (!s.clientId) out.push("ATOLYE_V3_CANVA_CLIENT_ID yok");
  if (!s.clientSecret) out.push("ATOLYE_V3_CANVA_CLIENT_SECRET yok");
  if (!loopbackRedirect(s.redirectUri)) out.push(`yönlendirme adresi ${s.redirectUri} 127.0.0.1 üzerinde bir http adresi değil`);
  if (format && !s.templates[format]) out.push(`${format === "uzun" ? "16:9 uzun video" : "dikey Shorts"} için marka şablonu kimliği yok (content/v3/canva.json ya da ATOLYE_V3_CANVA_TEMPLATE_${format.toUpperCase()})`);
  return out;
}

/** Only a plain-http 127.0.0.1 address with an explicit port: the consent answer must never leave this machine. */
export function loopbackRedirect(uri: string): { port: number; pathname: string } | undefined {
  try {
    const u = new URL(uri);
    if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || !u.port) return undefined;
    return { port: Number(u.port), pathname: u.pathname };
  } catch {
    return undefined;
  }
}

/** PKCE S256 (RFC 7636): the challenge is the URL-safe base64 of the verifier's SHA-256, without padding. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** A new verifier (86 characters of [A-Za-z0-9_-], inside Canva's 43–128) and its challenge. */
export function newPkce(random: (n: number) => Buffer = randomBytes): { readonly verifier: string; readonly challenge: string } {
  const verifier = random(64).toString("base64url");
  return { verifier, challenge: pkceChallenge(verifier) };
}

/** Canva's consent page; scopes are joined with %20 as in Canva's own example (not "+"). */
export function canvaAuthorizeUrl(s: Pick<CanvaSettings, "clientId" | "redirectUri">, state: string, challenge: string): string {
  if (!s.clientId) throw new Error("CANVA_NOT_CONFIGURED: ATOLYE_V3_CANVA_CLIENT_ID yok");
  const q: [string, string][] = [
    ["code_challenge", challenge],
    ["code_challenge_method", "s256"],
    ["scope", CANVA_SCOPES.join(" ")],
    ["response_type", "code"],
    ["client_id", s.clientId],
    ["state", state],
    ["redirect_uri", s.redirectUri],
  ];
  return `${CANVA_AUTHORIZE_URL}?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

/** Canva's token answer as we keep it; a missing refresh token is refused (without it the link dies in 4 hours). */
export function readCanvaToken(j: Record<string, unknown>, now: number, previous?: Pick<CanvaToken, "baglandi">): CanvaToken {
  if (typeof j.access_token !== "string" || !j.access_token) throw new Error("CANVA_TOKEN: Canva erişim anahtarı vermedi");
  if (typeof j.refresh_token !== "string" || !j.refresh_token) throw new Error("CANVA_TOKEN: Canva yenileme anahtarı vermedi");
  const expiresIn = typeof j.expires_in === "number" && j.expires_in > 0 ? j.expires_in : 14400;
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: now + expiresIn * 1000, scope: typeof j.scope === "string" ? j.scope : "", baglandi: previous?.baglandi ?? new Date(now).toISOString() };
}

/** The scopes the owner left unticked on the consent screen (Canva may grant fewer than asked). */
export function missingScopes(scope: string): string[] {
  const granted = new Set(scope.split(/\s+/).filter(Boolean));
  return granted.size ? CANVA_SCOPES.filter((s) => !granted.has(s)) : [];
}

/** A `Retry-After` header (seconds or an HTTP date) as a wait in ms, capped; undefined when absent or unreadable. */
export function retryAfterMs(header: string | null | undefined, now: number, capMs = 120_000): number | undefined {
  if (!header) return undefined;
  const s = Number(header.trim());
  const ms = Number.isFinite(s) ? s * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) ? Math.min(capMs, Math.max(0, ms)) : undefined;
}

export const canvaFormat = (shorts: boolean): CanvaFormat => (shorts ? "kisa" : "uzun");

/** What the episode gives the template. */
export interface CanvaCoverText {
  readonly kapakBasligi?: string;
  readonly videoBasligi?: string;
  readonly donem?: string;
  readonly dizi?: string;
}

export type CanvaDataset = Readonly<Record<string, { readonly type: string }>>;
export type CanvaAutofillValue = { readonly type: "text"; readonly text: string } | { readonly type: "image"; readonly asset_id: string };

/**
 * The autofill `data` for one template: only fields the template really has with the right type (Canva silently skips
 * an unknown name, and an image sent to a text field fails the job). `missing` names our roles the template lacks.
 */
export function buildAutofillData(text: CanvaCoverText, assetId: string | undefined, names: CanvaFieldNames, dataset: CanvaDataset): { data: Record<string, CanvaAutofillValue>; filled: string[]; missing: string[] } {
  const data: Record<string, CanvaAutofillValue> = {};
  const filled: string[] = [];
  const missing: string[] = [];
  const put = (role: keyof CanvaFieldNames, value: CanvaAutofillValue | undefined) => {
    const name = names[role];
    const field = dataset[name];
    if (!field || field.type !== (role === "resim" ? "image" : "text")) {
      missing.push(name);
      return;
    }
    if (!value) return;
    data[name] = value;
    filled.push(name);
  };
  const t = (v: string | undefined): CanvaAutofillValue | undefined => {
    const s = v?.replace(/\s+/g, " ").trim();
    return s ? { type: "text", text: s.slice(0, 500) } : undefined;
  };
  put("kapakBasligi", t(text.kapakBasligi));
  put("videoBasligi", t(text.videoBasligi));
  put("donem", t(text.donem));
  // A single episode has no series line: nothing is sent and nothing is missing (docs/v3/CANVA.md: keep that field
  // out of a template that single episodes use).
  if (text.dizi) put("dizi", t(text.dizi));
  put("resim", assetId ? { type: "image", asset_id: assetId } : undefined);
  return { data, filled, missing };
}

/** The asset's name in Canva: at most 50 characters before base64 (Asset-Upload-Metadata). */
export function assetUploadMetadata(name: string): string {
  const clipped = [...name].slice(0, 50).join("") || "kapak";
  return JSON.stringify({ name_base64: Buffer.from(clipped, "utf8").toString("base64") });
}
