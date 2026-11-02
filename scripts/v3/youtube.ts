/**
 * Atölye V3 — the owner's YouTube channel (owner, 2 Nov 2026: "youtube kanalımı AYAS'a bağlayabiliriz").
 *
 *   npx tsx scripts/v3/youtube.ts baglan    # one consent in the browser; the token goes into ATOLYE_V3_YOUTUBE_DIR
 *   npx tsx scripts/v3/youtube.ts durum     # the connected channel and the settings that decide its audience
 *
 * `baglan` listens on 127.0.0.1 only (a random port) for Google's answer, for ten minutes; the consent asks for upload
 * and read-only access, nothing that edits or deletes. Uploading itself is the order watcher's (`yapim.ts izle`), and
 * only for videos the owner approved.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { consentUrl, exchangeCode, loadClient, loadToken, myChannel, pkce, refreshAccessToken, saveToken, type YoutubeChannelInfo, youtubeSettings } from "../../src/lib/v3/publish/YoutubeAuth";
import { recentUploads } from "../../src/lib/v3/publish/YoutubeUpload";

const CONSENT_WAIT_MS = 10 * 60_000;

/** The channel settings that send videos to the right audience, in the owner's words. */
function audit(c: YoutubeChannelInfo): string[] {
  const out = [`Kanal: ${c.title} (${c.id})`];
  out.push(c.country ? `Ülke: ${c.country}` : "Ülke boş: Studio > Ayarlar > Kanal > Temel bilgiler > Ülke (ikamet ettiğin ülke; gelir ve vergi buna bağlı).");
  out.push(c.defaultLanguage ? `Kanal dili: ${c.defaultLanguage}` : "Kanal dili boş: Studio > Ayarlar > Yükleme varsayılanları > Gelişmiş > Video dili: İngilizce (ABD).");
  out.push(c.keywords ? `Anahtar kelimeler: ${c.keywords}` : "Kanal anahtar kelimesi yok.");
  if (c.madeForKids || c.selfDeclaredMadeForKids) out.push("UYARI: kanal 'çocuklara özel' işaretli — yorumlar, bildirimler ve öneriler kısılır. Studio > Ayarlar > Kanal > Gelişmiş: 'Hayır, çocuklara özel değil'.");
  else out.push("Kitle: çocuklara özel değil (doğru).");
  if (c.longUploadsStatus === "allowed") out.push("15 dakikadan uzun video: açık (20–30 dk bölümler yüklenebilir).");
  else out.push(`15 dakikadan uzun video KAPALI (${c.longUploadsStatus ?? "bilinmiyor"}): youtube.com/verify ile telefon doğrulaması gerekir; uzun bölümler yüklenemez.`);
  return out;
}

async function connect(): Promise<void> {
  const settings = youtubeSettings();
  const client = await loadClient(settings);
  const { verifier, challenge } = pkce();
  const state = randomBytes(16).toString("hex");
  const server = http.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("YOUTUBE_CONSENT_TIMEOUT: 10 dakikada onay gelmedi")), CONSENT_WAIT_MS);
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      if (url.pathname !== "/") return void res.writeHead(404).end();
      const page = (text: string) => res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html><meta charset="utf-8"><title>AYAS YouTube</title><p style="font:18px sans-serif;margin:3em">${text}</p>`);
      if (url.searchParams.get("state") !== state) return void page("Bu yanıt bu bağlantı isteğine ait değil.");
      clearTimeout(timer);
      const error = url.searchParams.get("error");
      const got = url.searchParams.get("code");
      if (error || !got) {
        page("İzin verilmedi. Sekmeyi kapatabilirsin.");
        return reject(new Error(`YOUTUBE_CONSENT: ${error ?? "kod yok"}`));
      }
      page("AYAS YouTube kanalına bağlandı. Bu sekmeyi kapatabilirsin.");
      resolve(got);
    });
    const consent = consentUrl(client, redirectUri, state, challenge);
    console.log(`Tarayıcıda Google onay ekranı açılıyor. Açılmazsa bu adresi kendin aç:\n${consent}\n`);
    console.log("Onay ekranında 'Geschichte entschlüsselt' kanalını seç; 'Google bu uygulamayı doğrulamadı' uyarısında Gelişmiş > devam et (uygulama senin).");
    // No shell: the URL's "&" would split a cmd line.
    spawn("rundll32", ["url.dll,FileProtocolHandler", consent], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }).finally(() => server.close());
  const granted = await exchangeCode(fetch, client, code, verifier, redirectUri);
  const channel = await myChannel(fetch, granted.accessToken);
  if (settings.channelId && channel.id !== settings.channelId) throw new Error(`YOUTUBE_WRONG_CHANNEL: "${channel.title}" (${channel.id}) seçildi, beklenen ${settings.channelId}; yeniden bağlan ve doğru kanalı seç`);
  await saveToken(settings, { refreshToken: granted.refreshToken, channelId: channel.id, channelTitle: channel.title, scope: granted.scope, baglandi: new Date().toISOString() });
  console.log(`Bağlandı. İzin ${settings.dir} klasöründe.\n`);
  for (const line of audit(channel)) console.log(line);
}

async function status(): Promise<void> {
  const settings = youtubeSettings();
  const token = await loadToken(settings);
  if (!token) {
    console.log(`YouTube bağlı değil (${settings.dir}\\token.json yok). Bağlamak için: npx tsx scripts/v3/youtube.ts baglan`);
    return;
  }
  const { accessToken } = await refreshAccessToken(fetch, await loadClient(settings), token);
  const channel = await myChannel(fetch, accessToken);
  console.log(`Bağlı (${token.baglandi.slice(0, 10)}).`);
  for (const line of audit(channel)) console.log(line);
  if (channel.uploadsPlaylist) {
    const uploads = await recentUploads(fetch, accessToken, channel.uploadsPlaylist);
    console.log(`\nSon yüklemeler (${uploads.length}):`);
    for (const u of uploads.slice(0, 10)) console.log(`  https://youtu.be/${u.videoId}  ${u.title}`);
  }
}

const cmd = process.argv[2];
(cmd === "baglan" ? connect() : cmd === "durum" ? status() : Promise.reject(new Error("Kullanım: youtube.ts baglan | durum"))).catch((e: Error) => {
  console.error(e.message);
  process.exitCode = 1;
});
