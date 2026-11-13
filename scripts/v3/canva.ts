/**
 * Atölye V3 — Canva kapağı (owner, 13 Nov 2026: "o iki fikri işleme al, yaptır"; guide: docs/v3/CANVA.md).
 *
 *   npx tsx scripts/v3/canva.ts durum                      # ayarlı mı, izin geçerli mi, şablonlara ulaşılıyor mu
 *   npx tsx scripts/v3/canva.ts baglan                     # bir kez tarayıcıda Canva izni; anahtar ATOLYE_V3_CANVA_DIR'e
 *   npx tsx scripts/v3/canva.ts sablonlar                  # marka şablonları ve otomatik doldurma alanları
 *   npx tsx scripts/v3/canva.ts dene --bolum <bölüm klasörü>   # o klasöre kapak-canva.jpg (kapak.jpg'ye dokunmaz)
 *
 * `baglan` listens only on the registered 127.0.0.1 redirect address, for ten minutes. Production uses Canva only with
 * `ATOLYE_V3_CANVA=1`; `dene` tries it regardless, for one episode.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { assertEpisode } from "../../src/lib/v3/episode/EpisodeValidator";
import { isShorts } from "../../src/lib/v3/render/Format";
import { CanvaApi, canvaCoverFor, type CanvaCoverSource, exchangeCanvaCode, loadCanvaToken, saveCanvaToken } from "../../src/lib/v3/thumbnail/CanvaClient";
import { canvaAuthorizeUrl, canvaProblems, canvaSettings, loopbackRedirect, missingScopes, newPkce } from "../../src/lib/v3/thumbnail/CanvaThumbnail";
import { loadV3Settings, resolveV3Paths } from "../../src/lib/v3/V3Paths";

const CONSENT_WAIT_MS = 10 * 60_000;

async function connect(): Promise<void> {
  const s = canvaSettings();
  const problems = canvaProblems(s);
  if (problems.length) throw new Error(`Canva ayarı eksik: ${problems.join("; ")} (docs/v3/CANVA.md)`);
  const loop = loopbackRedirect(s.redirectUri)!;
  const { verifier, challenge } = newPkce();
  const state = randomBytes(16).toString("hex");
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", (e) => reject(new Error(`CANVA_PORT: 127.0.0.1:${loop.port} dinlenemedi (${e.message}); ATOLYE_V3_CANVA_REDIRECT ile başka bir port kaydet`)));
    server.listen(loop.port, "127.0.0.1", resolve);
  });
  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CANVA_CONSENT_TIMEOUT: 10 dakikada onay gelmedi")), CONSENT_WAIT_MS);
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", s.redirectUri);
      if (url.pathname !== loop.pathname) return void res.writeHead(404).end();
      const page = (text: string) => res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html><meta charset="utf-8"><title>AYAS Canva</title><p style="font:18px sans-serif;margin:3em">${text}</p>`);
      if (url.searchParams.get("state") !== state) return void page("Bu yanıt bu bağlantı isteğine ait değil.");
      clearTimeout(timer);
      const error = url.searchParams.get("error");
      const got = url.searchParams.get("code");
      if (error || !got) {
        page("İzin verilmedi. Sekmeyi kapatabilirsin.");
        return reject(new Error(`CANVA_CONSENT: ${error ?? "kod yok"}`));
      }
      page("AYAS Canva hesabına bağlandı. Bu sekmeyi kapatabilirsin.");
      resolve(got);
    });
    const consent = canvaAuthorizeUrl(s, state, challenge);
    console.log(`Tarayıcıda Canva izin ekranı açılıyor. Açılmazsa bu adresi kendin aç:\n${consent}\n`);
    console.log(`Yanıt ${s.redirectUri} adresinde bekleniyor (yalnız bu bilgisayar, 10 dakika).`);
    // No shell: the URL's "&" would split a cmd line.
    spawn("rundll32", ["url.dll,FileProtocolHandler", consent], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }).finally(() => server.close());
  const token = await exchangeCanvaCode(s, code, verifier);
  await saveCanvaToken(s, token);
  console.log(`Bağlandı. İzin ${s.dir} klasöründe (git dışı).`);
  const missing = missingScopes(token.scope);
  if (missing.length) console.log(`UYARI: şu izinler verilmedi: ${missing.join(", ")} — geliştirici portalında Scopes'ta işaretleyip yeniden bağlan.`);
}

async function status(): Promise<void> {
  const s = canvaSettings();
  console.log(`Üretimde Canva: ${s.enabled ? "AÇIK (ATOLYE_V3_CANVA=1)" : "kapalı (ATOLYE_V3_CANVA=1 değil)"}`);
  const problems = canvaProblems(s);
  console.log(problems.length ? `Ayar eksik: ${problems.join("; ")}` : `İstemci ayarlı; yönlendirme ${s.redirectUri}`);
  for (const f of ["uzun", "kisa"] as const) {
    const t = s.templates[f];
    console.log(`Şablon (${f === "uzun" ? "16:9 uzun" : "dikey Shorts"}): ${t ? `${t.id} → ${t.width}×${t.height}` : "yok"}`);
  }
  console.log(`Resim alanına: ${s.resim === "temiz" ? "başlıksız temiz kare" : "bitmiş kapağımız"}; alanlar: ${Object.entries(s.fields).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  const token = await loadCanvaToken(s);
  if (!token) return void console.log(`Canva bağlı değil (${s.dir}\\token.json yok). Bağlamak için: npx tsx scripts/v3/canva.ts baglan`);
  if (problems.length) return;
  const api = new CanvaApi(s);
  await api.accessToken();
  console.log(`Bağlı (${token.baglandi.slice(0, 10)}); erişim anahtarı geçerli.`);
  const missing = missingScopes(token.scope);
  if (missing.length) console.log(`UYARI: eksik izinler: ${missing.join(", ")}`);
  for (const f of ["uzun", "kisa"] as const) {
    const t = s.templates[f];
    if (!t) continue;
    try {
      const ds = await api.templateDataset(t.id);
      const ours = Object.values(s.fields);
      console.log(`  ${f}: ulaşılıyor; alanlar ${Object.entries(ds).map(([k, v]) => `${k}(${v.type})${ours.includes(k) ? "" : "?"}`).join(", ") || "yok"}`);
    } catch (e) {
      console.log(`  ${f}: ULAŞILAMIYOR — ${(e as Error).message}`);
    }
  }
}

async function templates(): Promise<void> {
  const s = canvaSettings();
  const api = new CanvaApi(s);
  const list = await api.listTemplates(true);
  if (!list.length) return void console.log("Otomatik doldurma alanı olan marka şablonu yok (Canva'da şablona 'Data autofill' ile alan ekle).");
  for (const t of list) {
    const ds = await api.templateDataset(t.id).catch(() => ({}) as Record<string, { type: string }>);
    console.log(`${t.id}  ${t.title}\n    alanlar: ${Object.entries(ds).map(([k, v]) => `${k} (${v.type})`).join(", ") || "yok"}`);
  }
}

async function tryOne(folder: string | undefined): Promise<void> {
  if (!folder) throw new Error("Kullanım: canva.ts dene --bolum <bölüm klasörü>");
  const dir = path.resolve(folder);
  const episode = assertEpisode(JSON.parse(await fs.readFile(path.join(dir, "episode.json"), "utf8")));
  const ytFile = path.join(dir, "youtube.json");
  if (!existsSync(ytFile)) throw new Error(`${ytFile} yok (bölümün kapak adımı çalışmamış)`);
  const yt = JSON.parse(await fs.readFile(ytFile, "utf8")) as { paket?: { basliklar?: string[]; kapakBasliklari?: string[] }; kapak?: CanvaCoverSource };
  if (!yt.kapak) throw new Error("youtube.json'da kapak yok");
  // The folder may have moved since the production: every file is looked up in this folder by name.
  const cover: CanvaCoverSource = { file: path.join(dir, path.basename(yt.kapak.file)), varyantlar: yt.kapak.varyantlar.map((v) => ({ ...v, file: path.join(dir, "kapak-varyantlar", path.basename(v.file)) })) };
  const out = await canvaCoverFor({ paths: resolveV3Paths(), episode, workDir: dir, publicDir: path.join(dir, "public"), cover, headline: yt.paket?.kapakBasliklari?.[0], title: yt.paket?.basliklar?.[0], shorts: isShorts(episode.hedef_sure_sn), log: (l) => console.log(l), force: true });
  if (!out) throw new Error("Canva kapağı yapılamadı (yukarıdaki satıra bak); kapak.jpg olduğu gibi duruyor");
  console.log(`Hazır: ${out}`);
}

loadV3Settings();
const cmd = process.argv[2];
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const run = cmd === "baglan" ? connect() : cmd === "durum" ? status() : cmd === "sablonlar" ? templates() : cmd === "dene" ? tryOne(arg("--bolum")) : Promise.reject(new Error("Kullanım: canva.ts durum | baglan | sablonlar | dene --bolum <bölüm klasörü>"));
run.catch((e: Error) => {
  console.error(e.message);
  process.exitCode = 1;
});
