import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { Episode } from "../episode/EpisodeTypes";
import type { V3RenderPlan } from "../render/RenderPlanTypes";
import { renderWithRemotion } from "../render/RemotionRunner";
import { seriesLabel } from "../script/Series";
import type { V3Paths } from "../V3Paths";
import {
  assetUploadMetadata,
  buildAutofillData,
  CANVA_API,
  CANVA_COVER_FILE,
  type CanvaAutofillValue,
  type CanvaDataset,
  canvaFormat,
  canvaProblems,
  type CanvaSettings,
  canvaSettings,
  type CanvaTemplate,
  type CanvaToken,
  readCanvaToken,
  retryAfterMs,
  YOUTUBE_THUMBNAIL_MAX_BYTES,
} from "./CanvaThumbnail";

/**
 * The network half of the Canva thumbnail (owner, 13 Nov 2026): OAuth tokens, asset upload, autofill, export and the
 * download. Only the production (`scripts/atolye-v3.ts`) and the owner's CLI (`scripts/v3/canva.ts`) import it — never
 * the live AYAS server (it reaches the network and starts the Remotion renderer). Every call has a timeout, a 429 or
 * 5xx is retried after `Retry-After` (or a growing pause), and `canvaCoverFor` turns any failure into `undefined` so
 * the episode keeps our own cover.
 */
export type CanvaFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface CanvaDeps {
  readonly fetch: CanvaFetch;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

const defaultDeps = (): CanvaDeps => ({ fetch: (u, i) => fetch(u, i), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() });

export class CanvaError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 4;
const JOB_TIMEOUT_MS = 180_000;

export async function loadCanvaToken(s: Pick<CanvaSettings, "dir">): Promise<CanvaToken | undefined> {
  const file = path.join(s.dir, "token.json");
  if (!existsSync(file)) return undefined;
  const t = JSON.parse(await fs.readFile(file, "utf8")) as CanvaToken;
  if (typeof t.refreshToken !== "string" || typeof t.accessToken !== "string") throw new Error(`CANVA_TOKEN_UNREADABLE: ${file}`);
  return t;
}

/** Atomic: a refresh token is single use, so a half-written file would lose the connection. */
export async function saveCanvaToken(s: Pick<CanvaSettings, "dir">, token: CanvaToken): Promise<void> {
  await fs.mkdir(s.dir, { recursive: true });
  const file = path.join(s.dir, "token.json");
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
}

async function errorOf(r: Response, what: string): Promise<CanvaError> {
  const j = (await r.json().catch(() => ({}))) as { code?: unknown; message?: unknown; error?: unknown };
  const code = typeof j.code === "string" ? j.code : typeof j.error === "string" ? j.error : `http_${r.status}`;
  const msg = typeof j.message === "string" ? j.message.slice(0, 200) : "";
  return new CanvaError(r.status, code, `${what}: http ${r.status} ${code}${msg ? ` — ${msg}` : ""}`);
}

/** One call with a timeout; 429 and 5xx wait (Retry-After first) and try again, at most MAX_RETRIES times. */
async function send(deps: CanvaDeps, url: string, init: RequestInit, what: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try {
      r = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (attempt >= MAX_RETRIES) throw new CanvaError(0, "network", `${what}: ${(e as Error).message}`);
      await deps.sleep(1000 * 2 ** attempt);
      continue;
    }
    if ((r.status === 429 || r.status >= 500) && attempt < MAX_RETRIES) {
      // Not awaited: cancelling a teed (cloned) body waits for its twin and would hang the retry.
      void r.body?.cancel().catch(() => undefined);
      await deps.sleep(retryAfterMs(r.headers.get("retry-after"), deps.now()) ?? 1000 * 2 ** (attempt + 1));
      continue;
    }
    return r;
  }
}

async function tokenCall(deps: CanvaDeps, s: CanvaSettings, body: Record<string, string>): Promise<Record<string, unknown>> {
  if (!s.clientId || !s.clientSecret) throw new Error("CANVA_NOT_CONFIGURED: ATOLYE_V3_CANVA_CLIENT_ID / _SECRET yok");
  const r = await send(deps, `${CANVA_API}/oauth/token`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${s.clientId}:${s.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() }, "Canva anahtarı");
  if (!r.ok) {
    const e = await errorOf(r, "Canva anahtarı");
    // A revoked link or a refresh token already used: only the owner can connect again.
    if (e.code === "invalid_grant") throw new Error("CANVA_RECONNECT: Canva izni geri alınmış ya da yenileme anahtarı geçersiz; `npx tsx scripts/v3/canva.ts baglan` ile yeniden bağlan");
    throw e;
  }
  return (await r.json()) as Record<string, unknown>;
}

/** The code the browser brought back (with this process's PKCE verifier) for the first tokens. */
export async function exchangeCanvaCode(s: CanvaSettings, code: string, verifier: string, deps: CanvaDeps = defaultDeps()): Promise<CanvaToken> {
  return readCanvaToken(await tokenCall(deps, s, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: s.redirectUri }), deps.now());
}

/** The Connect API as the owner's integration: refreshes the token by itself and saves the rotated refresh token. */
export class CanvaApi {
  private token: CanvaToken | undefined;
  private refreshing: Promise<CanvaToken> | undefined;
  readonly deps: CanvaDeps;

  constructor(
    readonly settings: CanvaSettings,
    deps: Partial<CanvaDeps> = {},
  ) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  /** A fresh access token; refreshed five minutes before it runs out (Canva's tokens live about 4 hours). */
  async accessToken(force = false): Promise<string> {
    this.token ??= await loadCanvaToken(this.settings);
    if (!this.token) throw new Error("CANVA_NOT_CONNECTED: Canva bağlı değil; `npx tsx scripts/v3/canva.ts baglan`");
    if (!force && this.deps.now() < this.token.expiresAt - 5 * 60_000) return this.token.accessToken;
    // One refresh at a time: a second use of the same refresh token would be refused.
    this.refreshing ??= (async () => {
      const old = this.token!;
      const fresh = readCanvaToken(await tokenCall(this.deps, this.settings, { grant_type: "refresh_token", refresh_token: old.refreshToken }), this.deps.now(), old);
      await saveCanvaToken(this.settings, fresh);
      return fresh;
    })().finally(() => (this.refreshing = undefined));
    this.token = await this.refreshing;
    return this.token.accessToken;
  }

  /** A Connect API call; a 401 on a token we thought valid refreshes once and tries again. */
  async call<T>(method: string, route: string, what: string, opts: { json?: unknown; body?: BodyInit; headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<T> {
    for (let again = false; ; again = true) {
      const headers: Record<string, string> = { Authorization: `Bearer ${await this.accessToken(again)}`, ...(opts.json !== undefined ? { "Content-Type": "application/json" } : {}), ...opts.headers };
      const r = await send(this.deps, `${CANVA_API}${route}`, { method, headers, ...(opts.json !== undefined ? { body: JSON.stringify(opts.json) } : opts.body !== undefined ? { body: opts.body } : {}) }, what, opts.timeoutMs);
      if (r.status === 401 && !again) {
        void r.body?.cancel().catch(() => undefined);
        continue;
      }
      if (!r.ok) throw await errorOf(r, what);
      return (await r.json()) as T;
    }
  }

  /** An asynchronous job polled with a growing pause (1 s → 8 s, Canva's advice) until success, failure or 3 minutes. */
  async poll<J extends { status?: string; error?: { code?: string; message?: string } }>(route: string, what: string, pick: (body: { job?: J }) => J | undefined): Promise<J> {
    const until = this.deps.now() + JOB_TIMEOUT_MS;
    for (let wait = 1000; ; wait = Math.min(8000, wait * 2)) {
      const job = pick(await this.call<{ job?: J }>("GET", route, what));
      if (job?.status === "success") return job;
      if (job?.status === "failed") throw new CanvaError(200, job.error?.code ?? "failed", `${what}: ${job.error?.code ?? "başarısız"}${job.error?.message ? ` — ${job.error.message.slice(0, 200)}` : ""}`);
      if (this.deps.now() + wait > until) throw new CanvaError(0, "timeout", `${what}: ${JOB_TIMEOUT_MS / 1000} sn içinde bitmedi`);
      await this.deps.sleep(wait);
    }
  }

  async uploadAsset(file: string, name: string): Promise<string> {
    type Job = { id?: string; status?: string; asset?: { id?: string }; error?: { code?: string; message?: string } };
    const bytes = await fs.readFile(file);
    const first = (await this.call<{ job?: Job }>("POST", "/asset-uploads", "Canva resim yükleme", { body: new Uint8Array(bytes), headers: { "Content-Type": "application/octet-stream", "Asset-Upload-Metadata": assetUploadMetadata(name) }, timeoutMs: UPLOAD_TIMEOUT_MS })).job;
    if (first?.status === "failed") throw new CanvaError(200, first.error?.code ?? "failed", `Canva resim yükleme: ${first.error?.code ?? "başarısız"}`);
    const job = first?.status === "success" ? first : first?.id ? await this.poll<Job>(`/asset-uploads/${encodeURIComponent(first.id)}`, "Canva resim yükleme", (b) => b.job) : undefined;
    const id = job?.asset?.id;
    if (!id) throw new CanvaError(200, "no_asset", "Canva resim yükleme: varlık kimliği gelmedi");
    return id;
  }

  /** The owner's brand templates (all pages); `withFields` keeps only those with autofill data fields. */
  async listTemplates(withFields = true): Promise<{ id: string; title: string; view_url?: string }[]> {
    const out: { id: string; title: string; view_url?: string }[] = [];
    let continuation: string | undefined;
    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams({ limit: "100", ...(withFields ? { dataset: "non_empty" } : {}), ...(continuation ? { continuation } : {}) });
      const r = await this.call<{ items?: { id: string; title: string; view_url?: string }[]; continuation?: string }>("GET", `/brand-templates?${q.toString()}`, "Canva şablon listesi");
      out.push(...(r.items ?? []));
      continuation = r.continuation;
      if (!continuation) break;
    }
    return out;
  }

  async templateDataset(id: string): Promise<CanvaDataset> {
    return (await this.call<{ dataset?: CanvaDataset }>("GET", `/brand-templates/${encodeURIComponent(id)}/dataset`, "Canva şablon alanları")).dataset ?? {};
  }

  async autofill(templateId: string, title: string, data: Record<string, CanvaAutofillValue>): Promise<{ id: string; editUrl?: string }> {
    type Job = { id?: string; status?: string; result?: { design?: { id?: string; urls?: { edit_url?: string } } }; error?: { code?: string; message?: string } };
    const first = (await this.call<{ job?: Job }>("POST", "/autofills", "Canva şablon doldurma", { json: { brand_template_id: templateId, title: [...title].slice(0, 255).join(""), data } })).job;
    if (first?.status === "failed") throw new CanvaError(200, first.error?.code ?? "failed", `Canva şablon doldurma: ${first.error?.code ?? "başarısız"}`);
    const job = first?.status === "success" ? first : first?.id ? await this.poll<Job>(`/autofills/${encodeURIComponent(first.id)}`, "Canva şablon doldurma", (b) => b.job) : undefined;
    const design = job?.result?.design;
    if (!design?.id) throw new CanvaError(200, "no_design", "Canva şablon doldurma: tasarım kimliği gelmedi");
    return { id: design.id, ...(design.urls?.edit_url ? { editUrl: design.urls.edit_url } : {}) };
  }

  async exportJpg(designId: string, t: Pick<CanvaTemplate, "width" | "height">, quality: number): Promise<string> {
    type Job = { id?: string; status?: string; urls?: string[]; error?: { code?: string; message?: string } };
    const first = (await this.call<{ job?: Job }>("POST", "/exports", "Canva dışa aktarma", { json: { design_id: designId, format: { type: "jpg", quality, width: t.width, height: t.height, pages: [1] } } })).job;
    if (first?.status === "failed") throw new CanvaError(200, first.error?.code ?? "failed", `Canva dışa aktarma: ${first.error?.code ?? "başarısız"}`);
    const job = first?.status === "success" ? first : first?.id ? await this.poll<Job>(`/exports/${encodeURIComponent(first.id)}`, "Canva dışa aktarma", (b) => b.job) : undefined;
    const url = job?.urls?.[0];
    if (!url) throw new CanvaError(200, "no_url", "Canva dışa aktarma: indirme adresi gelmedi");
    return url;
  }

  /** The export link is a signed address (valid 24 h): no Canva token is sent to it. */
  async download(url: string, out: string): Promise<number> {
    if (!/^https:\/\//.test(url)) throw new CanvaError(0, "bad_url", "Canva indirme: https olmayan adres");
    const r = await send(this.deps, url, { method: "GET" }, "Canva indirme", UPLOAD_TIMEOUT_MS);
    if (!r.ok) throw await errorOf(r, "Canva indirme");
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length < 1000) throw new CanvaError(0, "too_small", `Canva indirme: ${bytes.length} bayt, resim değil`);
    if (bytes.length > YOUTUBE_THUMBNAIL_MAX_BYTES) throw new CanvaError(0, "too_big", `Canva indirme: ${(bytes.length / 1048576).toFixed(1)} MB, YouTube kapağı 2 MB'ı aşamaz (content/v3/canva.json "kalite" düşür)`);
    await fs.writeFile(`${out}.tmp`, bytes);
    await fs.rename(`${out}.tmp`, out);
    return bytes.length;
  }
}

/** Our cover's variants as `designThumbnail` returns them (kapak.jpg is a copy of the chosen one). */
export interface CanvaCoverSource {
  readonly file: string;
  readonly varyantlar: readonly { readonly ad: string; readonly baslik?: string; readonly file: string }[];
}

const sha = async (file: string) => createHash("sha256").update(await fs.readFile(file)).digest("hex");

/** The variant `kapak.jpg` was copied from, found by its bytes (the judge's order is not repeated here). */
export async function chosenVariant(cover: CanvaCoverSource): Promise<CanvaCoverSource["varyantlar"][number] | undefined> {
  if (!existsSync(cover.file)) return undefined;
  const want = await sha(cover.file);
  for (const v of cover.varyantlar) if (existsSync(v.file) && (await sha(v.file)) === want) return v;
  return undefined;
}

export type StillRender = (planFile: string, out: string) => Promise<void>;

/**
 * The chosen cover drawn again without our headline (the Canva template writes its own): the variant's render plan
 * with its title cards removed, rendered as one still.
 */
export async function cleanCoverPicture(workDir: string, variant: { readonly ad: string }, render: StillRender): Promise<string> {
  const dir = path.join(workDir, "kapak-varyantlar");
  const planFile = path.join(dir, `${variant.ad}-plan.json`);
  const { plan } = JSON.parse(await fs.readFile(planFile, "utf8")) as { plan: V3RenderPlan };
  const clean: V3RenderPlan = { ...plan, shots: plan.shots.map((s) => ({ ...s, titleCards: [] })) };
  const cleanPlan = path.join(dir, `${variant.ad}-temiz-plan.json`);
  await fs.writeFile(cleanPlan, JSON.stringify({ plan: clean }));
  const out = path.join(dir, `${variant.ad}-temiz.png`);
  await render(cleanPlan, out);
  if (!existsSync(out)) throw new Error("temiz kare çizilemedi");
  return out;
}

export interface CanvaCoverInput {
  readonly paths: V3Paths;
  readonly episode: Episode;
  readonly workDir: string;
  /** The episode's public dir (the render plan's assets). */
  readonly publicDir: string;
  /** What `designThumbnail` returned. */
  readonly cover: CanvaCoverSource;
  /** The YouTube package's first thumbnail headline and title. */
  readonly headline?: string;
  readonly title?: string;
  readonly shorts: boolean;
  readonly log: (s: string) => void;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly deps?: Partial<CanvaDeps> & { readonly render?: StillRender };
  /** Ignore `ATOLYE_V3_CANVA` (the owner's `dene` command). */
  readonly force?: boolean;
}

/**
 * The production's one call at its thumbnail step: `kapak-canva.jpg` in `workDir` from the owner's brand template, or
 * undefined — when `ATOLYE_V3_CANVA` is not 1 (silently), when Canva is not configured or connected, or on any
 * failure (one log line) — and the episode keeps our own `kapak.jpg`, which this never overwrites.
 */
export async function canvaCoverFor(input: CanvaCoverInput): Promise<string | undefined> {
  const env = input.env ?? process.env;
  if (!input.force && env.ATOLYE_V3_CANVA !== "1") return undefined;
  const { log, episode } = input;
  const s = canvaSettings(input.paths.repoRoot, env);
  const format = canvaFormat(input.shorts);
  const problems = canvaProblems(s, format);
  const template = s.templates[format];
  if (problems.length || !template) {
    log(`  kapak: Canva atlandı — ${problems.join("; ")}`);
    return undefined;
  }
  try {
    const api = new CanvaApi(s, input.deps);
    const variant = await chosenVariant(input.cover);
    let picture = input.cover.file;
    if (s.resim === "temiz") {
      if (!variant) throw new Error("seçilen kapak çeşidi bulunamadı (temiz kare çizilemez)");
      const render: StillRender = input.deps?.render ?? ((planFile, out) => renderWithRemotion(input.paths, { planFile, publicDir: input.publicDir, out, kind: "still", frame: 26 }));
      picture = await cleanCoverPicture(input.workDir, variant, render);
    }
    const dataset = await api.templateDataset(template.id);
    const assetId = await api.uploadAsset(picture, `${episode.id}-kapak`);
    const text = { kapakBasligi: variant?.baslik ?? input.headline, videoBasligi: input.title ?? episode.baslik, donem: episode.donem, ...(episode.dizi ? { dizi: seriesLabel(episode.dizi) } : {}) };
    const { data, filled, missing } = buildAutofillData(text, assetId, s.fields, dataset);
    if (!filled.length) throw new Error(`şablonda bizim alanlarımızdan hiçbiri yok (${Object.values(s.fields).join(", ")})`);
    if (missing.length) log(`  kapak: Canva şablonunda olmayan alanlar: ${missing.join(", ")}`);
    const design = await api.autofill(template.id, `${episode.baslik} — kapak`, data);
    const url = await api.exportJpg(design.id, template, s.quality);
    const out = path.join(input.workDir, CANVA_COVER_FILE);
    const bytes = await api.download(url, out);
    log(`  kapak: Canva şablonundan ${CANVA_COVER_FILE} (${filled.join(", ")}; ${(bytes / 1024).toFixed(0)} KB)${design.editUrl ? ` — Canva'da düzenle: ${design.editUrl}` : ""}`);
    return out;
  } catch (e) {
    log(`  kapak: Canva kapağı yapılamadı (${(e as Error).message}); kendi kapağımız kalır`);
    return undefined;
  }
}
