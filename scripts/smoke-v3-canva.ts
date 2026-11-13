/**
 * V3 smoke: the optional Canva thumbnail (owner, 13 Nov 2026). No network: a fake fetch plays Canva's Connect API
 * (token, asset upload, brand template dataset, autofill, export, download); a fake render stands in for Remotion.
 * Run: npx tsx scripts/smoke-v3-canva.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Episode } from "../src/lib/v3/episode/EpisodeTypes";
import { CanvaApi, canvaCoverFor, type CanvaCoverSource, type CanvaFetch, exchangeCanvaCode, loadCanvaToken, saveCanvaToken } from "../src/lib/v3/thumbnail/CanvaClient";
import { buildAutofillData, CANVA_SCOPES, canvaAuthorizeUrl, canvaProblems, canvaSettings, loopbackRedirect, missingScopes, newPkce, pkceChallenge, retryAfterMs } from "../src/lib/v3/thumbnail/CanvaThumbnail";
import { resolveV3Paths } from "../src/lib/v3/V3Paths";

let scenarios = 0;
async function scenario(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
  scenarios++;
}

const episode = {
  id: "rubicon",
  baslik: "Julius Caesar Crosses the Rubicon",
  konu: "Caesar crosses the Rubicon",
  donem: "49 BC",
  hedef_sure_sn: 600,
  dizi: { ad: "Rome", no: 6 },
  sahneler: [],
} as unknown as Episode;

const JPG = Buffer.alloc(40_000, 7);

/** A temp repository with canva.json and an episode folder whose kapak.jpg is a copy of the "catisma" variant. */
function fixture(json: Record<string, unknown> = { sablonlar: { uzun: { id: "BT-long" } } }) {
  const root = mkdtempSync(path.join(os.tmpdir(), "v3-canva-"));
  mkdirSync(path.join(root, "content", "v3"), { recursive: true });
  writeFileSync(path.join(root, "content", "v3", "canva.json"), JSON.stringify(json));
  const work = path.join(root, "bolum");
  const vdir = path.join(work, "kapak-varyantlar");
  mkdirSync(vdir, { recursive: true });
  writeFileSync(path.join(vdir, "portre.jpg"), Buffer.alloc(3000, 1));
  writeFileSync(path.join(vdir, "catisma.jpg"), Buffer.alloc(3000, 2));
  writeFileSync(path.join(work, "kapak.jpg"), Buffer.alloc(3000, 2));
  writeFileSync(path.join(vdir, "catisma-plan.json"), JSON.stringify({ plan: { shots: [{ id: "kapak", titleCards: [{ text: "HE DID WHAT?", start: 0, end: 30, style: "kucukresim" }] }] } }));
  const cover: CanvaCoverSource = { file: path.join(work, "kapak.jpg"), varyantlar: [{ ad: "portre", baslik: "POINT OF NO RETURN", file: path.join(vdir, "portre.jpg") }, { ad: "catisma", baslik: "HE DID WHAT?", file: path.join(vdir, "catisma.jpg") }] };
  const tokens = path.join(root, "gizli");
  const env = { ATOLYE_V3_CANVA: "1", ATOLYE_V3_CANVA_CLIENT_ID: "OC-test", ATOLYE_V3_CANVA_CLIENT_SECRET: "cnvca-test", ATOLYE_V3_CANVA_DIR: tokens };
  return { root, work, cover, tokens, env, paths: resolveV3Paths(root, {} as NodeJS.ProcessEnv) };
}

interface Call {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** Canva as a script: each route answers from its own queue (the last answer repeats). */
function fakeCanva(routes: Record<string, (Response | (() => Response))[]>) {
  const calls: Call[] = [];
  const fetch: CanvaFetch = async (url, init) => {
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ method, url, headers, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    const key = Object.keys(routes).find((k) => `${method} ${url}`.startsWith(k));
    if (!key) throw new Error(`unexpected ${method} ${url}`);
    const queue = routes[key]!;
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    return typeof next === "function" ? next() : next.clone();
  };
  return { fetch, calls };
}

const API = "https://api.canva.com/rest/v1";
const DOWNLOAD = "https://export-download.canva.com/x/kapak.jpg?sig=1";
const happyRoutes = (): Record<string, (Response | (() => Response))[]> => ({
  [`GET ${API}/brand-templates/BT-long/dataset`]: [reply(200, { dataset: { kapak_basligi: { type: "text" }, video_basligi: { type: "text" }, donem: { type: "text" }, dizi: { type: "text" }, resim: { type: "image" } } })],
  [`POST ${API}/asset-uploads`]: [reply(200, { job: { id: "AU1", status: "in_progress" } })],
  [`GET ${API}/asset-uploads/AU1`]: [reply(200, { job: { id: "AU1", status: "in_progress" } }), reply(200, { job: { id: "AU1", status: "success", asset: { id: "ASSET9", type: "image" } } })],
  [`POST ${API}/autofills`]: [reply(200, { job: { id: "AF1", status: "in_progress" } })],
  [`GET ${API}/autofills/AF1`]: [reply(200, { job: { id: "AF1", status: "success", result: { type: "create_design", design: { id: "DES1", urls: { edit_url: "https://www.canva.com/d/edit", view_url: "v" }, created_at: 1, updated_at: 1 } } } })],
  [`POST ${API}/exports`]: [reply(200, { job: { id: "EX1", status: "in_progress" } })],
  [`GET ${API}/exports/EX1`]: [reply(200, { job: { id: "EX1", status: "success", urls: [DOWNLOAD] } })],
  [`GET ${DOWNLOAD}`]: [() => new Response(JPG, { status: 200, headers: { "Content-Type": "image/jpeg" } })],
});

const fresh = (now: number) => ({ accessToken: "AT-ok", refreshToken: "RT-1", expiresAt: now + 3_600_000, scope: CANVA_SCOPES.join(" "), baglandi: "2026-11-13T00:00:00.000Z" });

async function main() {
  await scenario("A PKCE: verifier 43–128 URL-safe chars, S256 challenge (RFC 7636 vector), consent URL with %20 scopes and s256", () => {
    assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const p = newPkce();
    assert.match(p.verifier, /^[A-Za-z0-9\-._~]{43,128}$/);
    assert.equal(p.challenge, pkceChallenge(p.verifier));
    assert.notEqual(newPkce().verifier, p.verifier);
    const u = new URL(canvaAuthorizeUrl({ clientId: "OC-x", redirectUri: "http://127.0.0.1:3917/oauth/redirect" }, "st4te", p.challenge));
    assert.equal(u.origin + u.pathname, "https://www.canva.com/api/oauth/authorize");
    assert.equal(u.searchParams.get("code_challenge"), p.challenge);
    assert.equal(u.searchParams.get("code_challenge_method"), "s256");
    assert.equal(u.searchParams.get("response_type"), "code");
    assert.equal(u.searchParams.get("state"), "st4te");
    assert.equal(u.searchParams.get("redirect_uri"), "http://127.0.0.1:3917/oauth/redirect");
    assert.deepEqual(u.searchParams.get("scope")!.split(" "), [...CANVA_SCOPES]);
    assert.ok(!u.search.includes("+") && u.search.includes("asset%3Aread%20asset%3Awrite"), "scopes joined with %20");
    assert.ok(!u.search.includes(p.verifier), "the verifier never goes to the browser");
  });

  await scenario("B settings: canva.json + env, secret borrowed via ATOLYE_V3_SECRETS_ENV, loopback-only redirect, problems in Turkish", () => {
    const { root } = fixture({ sablonlar: { uzun: { id: "BT-json" }, kisa: { id: "" } }, alanlar: { resim: "foto" }, resim: "kapak", kalite: 80 });
    const secrets = path.join(root, "baska.env");
    writeFileSync(secrets, "ATOLYE_V3_CANVA_CLIENT_SECRET=cnvca-borrowed\nOTHER=x\n");
    const s = canvaSettings(root, { ATOLYE_V3_CANVA_CLIENT_ID: "OC-1", ATOLYE_V3_SECRETS_ENV: secrets, ATOLYE_V3_CANVA_TEMPLATE_KISA: "BT-env" });
    assert.equal(s.enabled, false);
    assert.equal(s.clientSecret, "cnvca-borrowed");
    assert.deepEqual(s.templates, { uzun: { id: "BT-json", width: 1280, height: 720 }, kisa: { id: "BT-env", width: 1080, height: 1920 } });
    assert.equal(s.fields.resim, "foto");
    assert.equal(s.fields.kapakBasligi, "kapak_basligi");
    assert.equal(s.resim, "kapak");
    assert.equal(s.quality, 80);
    assert.equal(s.dir, path.join(root, "output", "v3-canva"), "tokens default to the git-ignored output folder");
    assert.deepEqual(canvaProblems(s, "uzun"), []);
    const bare = canvaSettings(root, { ATOLYE_V3_CANVA_REDIRECT: "http://localhost:3917/cb" });
    assert.equal(canvaProblems(bare, "kisa").length, 4);
    assert.equal(loopbackRedirect("http://127.0.0.1:3917/oauth/redirect")?.port, 3917);
    for (const bad of ["http://localhost:3917/x", "https://127.0.0.1:3917/x", "http://127.0.0.1/x", "http://192.168.1.2:3917/x"]) assert.equal(loopbackRedirect(bad), undefined, bad);
    assert.deepEqual(missingScopes("asset:read asset:write"), CANVA_SCOPES.filter((x) => !x.startsWith("asset:")));
  });

  await scenario("C dataset from the episode: headline, title, period, series line, image asset — only fields of the right type", () => {
    const names = canvaSettings(fixture().root, {}).fields;
    const r = buildAutofillData({ kapakBasligi: "HE DID  WHAT?", videoBasligi: "Caesar Crosses the Rubicon", donem: "49 BC", dizi: "Rome 06" }, "ASSET9", names, { kapak_basligi: { type: "text" }, donem: { type: "text" }, dizi: { type: "text" }, resim: { type: "image" }, video_basligi: { type: "image" } });
    assert.deepEqual(r.data, { kapak_basligi: { type: "text", text: "HE DID WHAT?" }, donem: { type: "text", text: "49 BC" }, dizi: { type: "text", text: "Rome 06" }, resim: { type: "image", asset_id: "ASSET9" } });
    assert.deepEqual(r.missing, ["video_basligi"], "a text sent to an image field would fail the job");
    const single = buildAutofillData({ kapakBasligi: "X", donem: "1453" }, undefined, names, { kapak_basligi: { type: "text" }, resim: { type: "image" } });
    assert.deepEqual(Object.keys(single.data), ["kapak_basligi"]);
    assert.ok(!single.missing.includes("dizi"), "a single episode does not miss the series field");
  });

  await scenario("D Retry-After: seconds or an HTTP date, capped; absent = undefined", () => {
    assert.equal(retryAfterMs("7", 0), 7000);
    assert.equal(retryAfterMs(new Date(30_000).toUTCString(), 0), 30_000);
    assert.equal(retryAfterMs("9999", 0), 120_000);
    assert.equal(retryAfterMs(null, 0), undefined);
    assert.equal(retryAfterMs("soon", 0), undefined);
  });

  await scenario("E production off unless ATOLYE_V3_CANVA=1; on but without a template it is skipped — no request either way", async () => {
    const fx = fixture({});
    const { fetch, calls } = fakeCanva({});
    const logs: string[] = [];
    const base = { paths: fx.paths, episode, workDir: fx.work, publicDir: fx.work, cover: fx.cover, shorts: false, log: (l: string) => logs.push(l), deps: { fetch } };
    assert.equal(await canvaCoverFor({ ...base, env: { ...fx.env, ATOLYE_V3_CANVA: "" } }), undefined);
    assert.equal(await canvaCoverFor({ ...base, env: { ...fx.env, ATOLYE_V3_CANVA: "true" } }), undefined);
    assert.deepEqual(logs, [], "off is silent");
    assert.equal(await canvaCoverFor({ ...base, env: fx.env }), undefined);
    assert.match(logs.join("\n"), /Canva atlandı — .*16:9 uzun video için marka şablonu kimliği yok/);
    assert.equal(calls.length, 0);
  });

  await scenario("F upload → autofill → export → download: kapak-canva.jpg from a clean frame, kapak.jpg untouched, no token to the download host", async () => {
    const fx = fixture();
    await saveCanvaToken({ dir: fx.tokens }, fresh(Date.now()));
    const { fetch, calls } = fakeCanva(happyRoutes());
    const rendered: string[] = [];
    const render = async (planFile: string, out: string) => {
      rendered.push(planFile);
      writeFileSync(out, Buffer.alloc(5000, 3));
    };
    const logs: string[] = [];
    const out = await canvaCoverFor({ paths: fx.paths, episode, workDir: fx.work, publicDir: fx.work, cover: fx.cover, headline: "POINT OF NO RETURN", title: "Caesar Crosses the Rubicon", shorts: false, log: (l) => logs.push(l), env: fx.env, deps: { fetch, sleep: async () => undefined, render } });
    assert.equal(out, path.join(fx.work, "kapak-canva.jpg"), logs.join("\n"));
    assert.deepEqual(readFileSync(out!), JPG);
    assert.deepEqual(readFileSync(path.join(fx.work, "kapak.jpg")), Buffer.alloc(3000, 2), "our own cover is never overwritten");
    assert.equal(path.basename(rendered[0]!), "catisma-temiz-plan.json", "the variant kapak.jpg was copied from, found by its bytes");
    assert.deepEqual(JSON.parse(readFileSync(rendered[0]!, "utf8")).plan.shots[0].titleCards, [], "drawn again without our headline");
    const upload = calls.find((c) => c.method === "POST" && c.url.endsWith("/asset-uploads"))!;
    assert.equal(upload.headers.authorization, "Bearer AT-ok");
    assert.equal(upload.headers["content-type"], "application/octet-stream");
    assert.equal(Buffer.from(JSON.parse(upload.headers["asset-upload-metadata"]!).name_base64, "base64").toString(), "rubicon-kapak");
    const autofill = JSON.parse(calls.find((c) => c.url.endsWith("/autofills"))!.body!);
    assert.equal(autofill.brand_template_id, "BT-long");
    assert.deepEqual(autofill.data, { kapak_basligi: { type: "text", text: "HE DID WHAT?" }, video_basligi: { type: "text", text: "Caesar Crosses the Rubicon" }, donem: { type: "text", text: "49 BC" }, dizi: { type: "text", text: "Rome 06" }, resim: { type: "image", asset_id: "ASSET9" } });
    assert.deepEqual(JSON.parse(calls.find((c) => c.url.endsWith("/exports"))!.body!), { design_id: "DES1", format: { type: "jpg", quality: 90, width: 1280, height: 720, pages: [1] } });
    const dl = calls.find((c) => c.url === DOWNLOAD)!;
    assert.equal(dl.headers.authorization, undefined);
    assert.equal(calls.filter((c) => c.url.includes("/oauth/token")).length, 0, "a valid token is not refreshed");
    assert.match(logs.join("\n"), /Canva şablonundan kapak-canva\.jpg/);
  });

  await scenario("G a 429 waits for Retry-After and tries again", async () => {
    const fx = fixture();
    await saveCanvaToken({ dir: fx.tokens }, fresh(Date.now()));
    const routes = happyRoutes();
    routes[`POST ${API}/autofills`] = [reply(429, { code: "too_many_requests", message: "slow down" }, { "Retry-After": "7" }), reply(200, { job: { id: "AF1", status: "in_progress" } })];
    const { fetch, calls } = fakeCanva(routes);
    const slept: number[] = [];
    const out = await canvaCoverFor({ paths: fx.paths, episode, workDir: fx.work, publicDir: fx.work, cover: fx.cover, shorts: false, log: () => undefined, env: fx.env, deps: { fetch, sleep: async (ms) => void slept.push(ms), render: async (_p, o) => writeFileSync(o, "png") } });
    assert.ok(out);
    assert.equal(calls.filter((c) => c.url.endsWith("/autofills")).length, 2);
    assert.ok(slept.includes(7000), `slept ${slept.join(",")}`);
  });

  await scenario("H an expired token is refreshed (Basic auth, refresh grant) and the rotated refresh token saved; a 401 refreshes once", async () => {
    const fx = fixture();
    const now = Date.now();
    await saveCanvaToken({ dir: fx.tokens }, { ...fresh(now), accessToken: "AT-old", expiresAt: now - 1000 });
    const routes = happyRoutes();
    routes[`POST ${API}/oauth/token`] = [reply(200, { access_token: "AT-new", refresh_token: "RT-2", token_type: "Bearer", expires_in: 14400, scope: CANVA_SCOPES.join(" ") })];
    const { fetch, calls } = fakeCanva(routes);
    const out = await canvaCoverFor({ paths: fx.paths, episode, workDir: fx.work, publicDir: fx.work, cover: fx.cover, shorts: false, log: () => undefined, env: fx.env, deps: { fetch, sleep: async () => undefined, render: async (_p, o) => writeFileSync(o, "png") } });
    assert.ok(out);
    const tok = calls.filter((c) => c.url.endsWith("/oauth/token"));
    assert.equal(tok.length, 1);
    assert.equal(tok[0]!.headers.authorization, `Basic ${Buffer.from("OC-test:cnvca-test").toString("base64")}`);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(tok[0]!.body)), { grant_type: "refresh_token", refresh_token: "RT-1" });
    assert.ok(calls.filter((c) => !c.url.includes("/oauth/") && c.url.startsWith(API)).every((c) => c.headers.authorization === "Bearer AT-new"));
    const saved = await loadCanvaToken({ dir: fx.tokens });
    assert.equal(saved?.refreshToken, "RT-2");
    assert.equal(saved?.baglandi, "2026-11-13T00:00:00.000Z");
    assert.ok(saved!.expiresAt > now + 14_000_000);
    // A token Canva no longer accepts before its time: one refresh, then the call again.
    const r2 = happyRoutes();
    r2[`GET ${API}/brand-templates?`] = [reply(401, { code: "invalid_access_token", message: "expired" }), reply(200, { items: [{ id: "BT-long", title: "Kapak" }] })];
    r2[`POST ${API}/oauth/token`] = [reply(200, { access_token: "AT-3", refresh_token: "RT-3", expires_in: 14400 })];
    const f2 = fakeCanva(r2);
    const api = new CanvaApi(canvaSettings(fx.root, fx.env), { fetch: f2.fetch, sleep: async () => undefined });
    assert.deepEqual((await api.listTemplates()).map((t) => t.id), ["BT-long"]);
    assert.equal(f2.calls.filter((c) => c.url.endsWith("/oauth/token")).length, 1);
    assert.equal((await loadCanvaToken({ dir: fx.tokens }))?.refreshToken, "RT-3");
  });

  await scenario("I failures fall back to undefined: a failed export, a revoked refresh token; kapak.jpg stays, no kapak-canva.jpg", async () => {
    const fx = fixture();
    await saveCanvaToken({ dir: fx.tokens }, fresh(Date.now()));
    const routes = happyRoutes();
    routes[`GET ${API}/exports/EX1`] = [reply(200, { job: { id: "EX1", status: "failed", error: { code: "license_required", message: "premium element" } } })];
    const { fetch } = fakeCanva(routes);
    const logs: string[] = [];
    const deps = { fetch, sleep: async () => undefined, render: async (_p: string, o: string) => writeFileSync(o, "png") };
    assert.equal(await canvaCoverFor({ paths: fx.paths, episode, workDir: fx.work, publicDir: fx.work, cover: fx.cover, shorts: false, log: (l) => logs.push(l), env: fx.env, deps }), undefined);
    assert.match(logs.join("\n"), /Canva kapağı yapılamadı \(Canva dışa aktarma: license_required.*kendi kapağımız kalır/);
    assert.ok(!existsSync(path.join(fx.work, "kapak-canva.jpg")));
    assert.deepEqual(readFileSync(path.join(fx.work, "kapak.jpg")), Buffer.alloc(3000, 2));
    await saveCanvaToken({ dir: fx.tokens }, { ...fresh(Date.now()), expiresAt: 0 });
    const revoked = fakeCanva({ [`POST ${API}/oauth/token`]: [reply(400, { code: "invalid_grant", message: "Invalid refresh token" })] });
    logs.length = 0;
    assert.equal(await canvaCoverFor({ paths: fx.paths, episode, workDir: fx.work, publicDir: fx.work, cover: fx.cover, shorts: false, log: (l) => logs.push(l), env: fx.env, deps: { ...deps, fetch: revoked.fetch } }), undefined);
    assert.match(logs.join("\n"), /CANVA_RECONNECT/);
    // Network down: retried with a pause, then the fallback.
    const down: CanvaFetch = async () => {
      throw new Error("ECONNRESET");
    };
    const slept: number[] = [];
    assert.equal(await new CanvaApi(canvaSettings(fx.root, fx.env), { fetch: down, sleep: async (ms) => void slept.push(ms) }).listTemplates().catch(() => undefined), undefined);
    assert.equal(slept.length, 4);
  });

  await scenario("J the first tokens: authorization code + PKCE verifier + redirect, Basic auth; no refresh token is refused", async () => {
    const fx = fixture();
    const s = canvaSettings(fx.root, fx.env);
    const { fetch, calls } = fakeCanva({ [`POST ${API}/oauth/token`]: [reply(200, { access_token: "AT", refresh_token: "RT", expires_in: 14400, scope: "asset:read" }), reply(200, { access_token: "AT" })] });
    const t = await exchangeCanvaCode(s, "CODE1", "VERIFIER1", { fetch, sleep: async () => undefined, now: () => 1000 });
    assert.equal(t.expiresAt, 1000 + 14_400_000);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0]!.body)), { grant_type: "authorization_code", code: "CODE1", code_verifier: "VERIFIER1", redirect_uri: "http://127.0.0.1:3917/oauth/redirect" });
    await assert.rejects(exchangeCanvaCode(s, "CODE2", "V", { fetch, sleep: async () => undefined, now: () => 1000 }), /yenileme anahtarı vermedi/);
  });

  console.log(`V3 canva smoke: PASS (${scenarios} scenarios)`);
}

let finished = false;
// A promise that never settles empties the event loop and would end the run with exit 0 and no PASS line.
process.on("exit", (code) => {
  if (!finished && code === 0) {
    console.error("FAIL: a scenario never finished (a hung promise)");
    process.exitCode = 1;
  }
});
main()
  .then(() => (finished = true))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
