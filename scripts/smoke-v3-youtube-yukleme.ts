/**
 * V3 smoke: the owner-approved YouTube upload — the metadata that picks the audience, the weekly calendar, the
 * approval (AYAS's words and the order), and the watcher's upload against a fake YouTube: a whole upload, a dropped
 * connection resumed from YouTube's last byte, no connection yet, a title already on the channel, another channel, a
 * refusal. No network. Run: npx tsx scripts/smoke-v3-youtube-yukleme.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAyasPreReasoningIntent } from "../src/lib/ayas/AyasIntentRouting";
import { approveFromChat, detectAyasVideoIntent } from "../src/lib/ayas/AyasVideoOrder";
import { listOrders, orderProgress, type ProductionOrder } from "../src/lib/v3/orders/ProductionOrders";
import { approvePublish, awaitingApproval } from "../src/lib/v3/publish/PublishApproval";
import { nextSlot, slotText, videoKind } from "../src/lib/v3/publish/PublishCalendar";
import { MAX_UPLOAD_PASSES, publishApproved } from "../src/lib/v3/publish/PublishOrder";
import { consentUrl, type Fetcher, readClient, tokenSource, YOUTUBE_SCOPES, youtubeSettings } from "../src/lib/v3/publish/YoutubeAuth";
import { fitDescription, fitTags, sameTitle, uploadMeta } from "../src/lib/v3/publish/YoutubeUpload";
import type { YoutubePackage } from "../src/lib/v3/thumbnail/YoutubePackage";

let scenarios = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
  scenarios++;
}

const CHANNEL = "UC3u0Kx_T49g9qdLFOagsN8A";
const paket: YoutubePackage = {
  basliklar: ["Battle of Kosovo: When Leaders Die in Battle", "Battle of Kosovo 1389"],
  kapakBasliklari: ["BOTH KINGS DIE"],
  bolumler: [],
  etiketler: ["Battle of Kosovo", "Sultan Murad I", "#OttomanEmpire", "battle of kosovo", "Prince <Lazar>"],
  hashtagler: ["#BattleOfKosovo"],
  aciklamaGiris: "Two leaders fell in one clash.",
};
const aciklama = "Battle of Kosovo: When Leaders Die in Battle\n\nTwo leaders fell in one clash.\n\nChapters:\n0:00 Dawn\n0:17 March\n0:38 Council\n\nSources:\n• Wikipedia\n\nThis video contains dramatization.\n\n#BattleOfKosovo\n";

function order(id: string, o: Partial<ProductionOrder> = {}): ProductionOrder {
  return { id, konu: "Kosova Savaşı 1389", donem: "1389", sure: "3dk", dil: "en", ton: "mizahi", kaynak: "ayas", olusturuldu: "2026-11-01T10:00:00.000Z", durum: "teslim", bitis: "2026-11-01T18:00:00.000Z", video: `x/${id}/final.mp4`, ...o };
}

/** A work root with orders and their episode folders (youtube.json, aciklama.txt, a video of `bytes`, a thumbnail). */
function workRoot(orders: readonly ProductionOrder[], bytes = 600 * 1024): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "v3-yt-"));
  mkdirSync(path.join(root, "_kutuphane", "siparisler"), { recursive: true });
  for (const o of orders) {
    writeFileSync(path.join(root, "_kutuphane", "siparisler", `${o.id}.json`), JSON.stringify(o));
    const dir = path.join(root, "bolumler", o.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "youtube.json"), JSON.stringify({ paket, kapak: { file: "C:\\elsewhere\\kapak.jpg" }, dosya: "battle-of-kosovo-1389-animated-history.mp4" }));
    writeFileSync(path.join(dir, "aciklama.txt"), aciklama);
    writeFileSync(path.join(dir, "battle-of-kosovo-1389-animated-history.mp4"), Buffer.alloc(bytes, 7));
    writeFileSync(path.join(dir, "kapak.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
  }
  return root;
}

function secrets(token = true, channelId = CHANNEL): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "v3-yt-sec-"));
  writeFileSync(path.join(dir, "client.json"), JSON.stringify({ installed: { client_id: "cid.apps.googleusercontent.com", client_secret: "sec" } }));
  if (token) writeFileSync(path.join(dir, "token.json"), JSON.stringify({ refreshToken: "rt", channelId, channelTitle: "Geschichte entschlüsselt", scope: YOUTUBE_SCOPES.join(" "), baglandi: "2026-11-02T00:00:00.000Z" }));
  return dir;
}

/** A fake YouTube: token, channel, uploads list, resumable session, chunks, thumbnail; `drop` fails chunk PUTs. */
function fakeYoutube(o: { channel?: string; uploads?: { videoId: string; title: string }[]; startStatus?: number; drop?: (start: number) => boolean } = {}) {
  const calls = { start: 0, chunks: [] as string[], status: 0, thumb: 0, meta: undefined as Record<string, unknown> | undefined };
  let received = 0;
  const fetcher: Fetcher = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "at", expires_in: 3599 });
    if (url.startsWith("https://www.googleapis.com/youtube/v3/channels")) return Response.json({ items: [{ id: o.channel ?? CHANNEL, snippet: { title: "Geschichte entschlüsselt" }, status: { longUploadsStatus: "allowed" }, contentDetails: { relatedPlaylists: { uploads: "UU3u0Kx_T49g9qdLFOagsN8A" } } }] });
    if (url.startsWith("https://www.googleapis.com/youtube/v3/playlistItems")) return Response.json({ items: (o.uploads ?? []).map((u) => ({ snippet: { title: u.title, resourceId: { videoId: u.videoId } } })) });
    if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable")) {
      calls.start++;
      calls.meta = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (o.startStatus) return Response.json({ error: { errors: [{ reason: "quotaExceeded" }] } }, { status: o.startStatus });
      return new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=S1" } });
    }
    if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos?upload_id=S1")) {
      const range = headers.get("content-range") ?? "";
      const total = Number(range.split("/")[1]);
      if (range.startsWith("bytes */")) {
        calls.status++;
        return received >= total ? Response.json({ id: "vid123456AB" }, { status: 200 }) : new Response(null, { status: 308, headers: received ? { range: `bytes=0-${received - 1}` } : {} });
      }
      const [a, b] = range.replace("bytes ", "").split("/")[0]!.split("-").map(Number);
      if (o.drop?.(a!)) throw new TypeError("fetch failed");
      calls.chunks.push(range);
      received = b! + 1;
      return received >= total ? Response.json({ id: "vid123456AB" }, { status: 201 }) : new Response(null, { status: 308, headers: { range: `bytes=0-${b}` } });
    }
    if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/thumbnails/set")) {
      calls.thumb++;
      return Response.json({});
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetcher, calls };
}

const noSleep = async () => undefined;

async function main() {
  await scenario("A metadata: the package's title, the description after it, tags within 500, Education, US English, not for kids, not synthetic", () => {
    const m = uploadMeta({ paket, aciklama, dil: "en", publishAt: "2026-11-05T20:00:00.000Z" });
    assert.equal(m.snippet.title, "Battle of Kosovo: When Leaders Die in Battle");
    assert.ok(m.snippet.description.startsWith("Two leaders fell in one clash.\n\nChapters:\n0:00 Dawn"));
    assert.deepEqual(m.snippet.tags, ["Battle of Kosovo", "Sultan Murad I", "OttomanEmpire", "Prince Lazar"]);
    assert.deepEqual([m.snippet.categoryId, m.snippet.defaultLanguage, m.snippet.defaultAudioLanguage], ["27", "en", "en-US"]);
    assert.deepEqual(m.status, { privacyStatus: "private", publishAt: "2026-11-05T20:00:00.000Z", selfDeclaredMadeForKids: false, containsSyntheticMedia: false, license: "youtube", embeddable: true });
    assert.equal(uploadMeta({ paket, aciklama, dil: "tr" }).status.privacyStatus, "public");
    assert.equal(uploadMeta({ paket, aciklama, dil: "tr" }).snippet.defaultAudioLanguage, "tr");
    const many = Array.from({ length: 80 }, (_, i) => `history tag ${i}`);
    const fitted = fitTags(many);
    assert.ok(fitted.reduce((n, t, i) => n + t.length + 2 + (i ? 1 : 0), 0) <= 500);
    assert.ok(fitted.length > 20);
  });

  await scenario("B a long description keeps the hook, the chapters and the ending; only credits go", () => {
    const long = `Hook.\n\nChapters:\n0:00 A\n\nImages:\n${Array.from({ length: 200 }, (_, i) => `"Picture ${i}" — Commons https://commons.wikimedia.org/wiki/File:${i}.png`).join("\n")}\n\nNote.\n\n#Tag`;
    const d = fitDescription(long);
    assert.ok(Buffer.byteLength(d) <= 5000);
    assert.ok(d.startsWith("Hook.\n\nChapters:\n0:00 A"));
    assert.ok(d.endsWith("…\nNote.\n\n#Tag"));
  });

  await scenario("C the weekly calendar: Shorts Tue + Sat, the long video Thu, 15:00 New York (EST and EDT), two hours ahead", () => {
    assert.deepEqual(["60sn", "45sn", "1dk", "3dk", "20dk", "1dk 30"].map(videoKind), ["short", "short", "short", "uzun", "uzun", "uzun"]);
    const monday = new Date("2026-11-02T12:00:00Z");
    assert.equal(nextSlot("short", [], monday), "2026-11-03T20:00:00.000Z");
    assert.equal(nextSlot("uzun", [], monday), "2026-11-05T20:00:00.000Z");
    assert.equal(nextSlot("short", ["2026-11-03T20:00:00.000Z"], monday), "2026-11-07T20:00:00.000Z");
    assert.equal(nextSlot("uzun", ["2026-11-05T20:00:00.000Z"], monday), "2026-11-12T20:00:00.000Z");
    assert.equal(nextSlot("uzun", [], new Date("2026-07-06T12:00:00Z")), "2026-07-09T19:00:00.000Z", "summer: EDT");
    assert.equal(nextSlot("short", [], new Date("2026-11-03T19:00:00Z")), "2026-11-07T20:00:00.000Z", "an hour away is too close");
    assert.equal(slotText("2026-11-05T20:00:00.000Z"), "5 Kasım Perşembe 23:00");
  });

  await scenario("D approval: only a delivered video, the next free slot of its kind, 'hemen' without one, never twice", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    assert.throws(() => approvePublish(order("a", { durum: "calisiyor" }), [], false, now), /YOUTUBE_NOT_DELIVERED/);
    const a = approvePublish(order("a"), [], false, now);
    assert.deepEqual(a.yayin, { durum: "onaylandi", onay: now.toISOString(), yayinZamani: "2026-11-05T20:00:00.000Z" });
    const b = approvePublish(order("b"), [a], false, now);
    assert.equal(b.yayin!.yayinZamani, "2026-11-12T20:00:00.000Z", "the second long video waits a week");
    const s = approvePublish(order("s", { sure: "60sn" }), [a, b], false, now);
    assert.equal(s.yayin!.yayinZamani, "2026-11-03T20:00:00.000Z", "a Short has its own days");
    assert.deepEqual(approvePublish(order("h"), [], true, now).yayin, { durum: "onaylandi", onay: now.toISOString(), hemen: true });
    assert.throws(() => approvePublish(a, [], false, now), /YOUTUBE_ALREADY/);
    const failed = order("f", { yayin: { durum: "hata", onay: now.toISOString(), hata: "x" } });
    assert.equal(approvePublish(failed, [], false, now).yayin!.durum, "onaylandi");
    assert.deepEqual(awaitingApproval([a, order("w"), order("e", { yayin: { durum: "yayinda", onay: "", elle: true } })]).map((o) => o.id), ["w"]);
  });

  await scenario("E AYAS's words: approve, approve now, a question stays a status question, an order stays an order", () => {
    assert.deepEqual(detectAyasVideoIntent("Kosova videosunu yükle"), { kind: "publish", words: "kosova", hemen: false });
    assert.deepEqual(detectAyasVideoIntent("son videoyu hemen yayınla."), { kind: "publish", words: "son", hemen: true });
    assert.deepEqual(detectAyasVideoIntent("video güzel olmuş, yükle"), { kind: "publish", words: "", hemen: false });
    assert.deepEqual(detectAyasVideoIntent("Kosova videosunu YouTube'a yükleyebilirsin"), { kind: "publish", words: "kosova", hemen: false });
    assert.deepEqual(detectAyasVideoIntent("yüklemeyi onaylıyorum"), { kind: "publish", words: "", hemen: false });
    assert.deepEqual(detectAyasVideoIntent("upload the kosovo video now"), { kind: "publish", words: "kosovo", hemen: true });
    assert.deepEqual(detectAyasVideoIntent("Kosova videosu yüklendi mi?"), { kind: "status" });
    assert.equal(detectAyasVideoIntent("youtube'a nasıl video yüklenir"), null);
    assert.equal(detectAyasVideoIntent("Rubicon hakkında video yap")?.kind, "order");
    assert.equal(detectAyasVideoIntent("Kosova hakkında video yap ve yükle")?.kind, "order");
    const routed = resolveAyasPreReasoningIntent("Kosova videosunu yükle");
    assert.equal(routed.kind === "video" && routed.video.kind, "publish");
  });

  await scenario("F AYAS approves the named or only waiting video, lists several, never re-approves one on the channel", async () => {
    const now = new Date("2026-11-02T12:00:00Z");
    const root = workRoot([order("k", { yayin: { durum: "yayinda", onay: "2026-11-01T00:00:00.000Z", videoId: "l11IuUtYQCk", url: "https://youtu.be/l11IuUtYQCk", elle: true } }), order("r", { konu: "Sezar’ın Rubicon’u geçmesi", sure: "60sn" })]);
    assert.match(await approveFromChat(root, { kind: "publish", words: "kosova", hemen: false }, now), /yayında: https:\/\/youtu\.be\/l11IuUtYQCk \(elle yüklenmişti\)/);
    const reply = await approveFromChat(root, { kind: "publish", words: "", hemen: false }, now);
    assert.match(reply, /Onayını aldım: "Sezar’ın Rubicon’u geçmesi" \(Short\).*3 Kasım Salı 23:00 \(New York 15:00\)/);
    const saved = (await listOrders(root)).find((x) => x.order.id === "r")!.order;
    assert.equal(saved.yayin!.durum, "onaylandi");
    assert.match(orderProgress(saved, "", now), /YouTube: onaylandı, yüklenecek; 3 Kasım Salı 23:00 yayına çıkacak/);
    assert.match(await approveFromChat(root, { kind: "publish", words: "sezar", hemen: false }, now), /onaylandı, yüklenecek/);
    const two = workRoot([order("a", { konu: "Kosova Savaşı" }), order("b", { konu: "Mohaç Savaşı" })]);
    assert.match(await approveFromChat(two, { kind: "publish", words: "", hemen: false }, now), /^Hangisini yükleyeyim\?/);
    assert.match(await approveFromChat(two, { kind: "publish", words: "mohaç", hemen: false }, now), /Onayını aldım: "Mohaç Savaşı"/);
    assert.match(await approveFromChat(two, { kind: "publish", words: "lepanto", hemen: false }, now), /"lepanto" adlı teslim edilmiş bir video bulamadım\. Onay bekleyenler: "Kosova Savaşı"/);
    assert.match(orderProgress(order("w"), "", now), /YouTube'a henüz yüklenmedi; izlediysen ve uygunsa "videoyu yükle" de/);
  });

  await scenario("G an approved video is uploaded in chunks with its metadata, the thumbnail set, the order scheduled", async () => {
    const now = new Date("2026-11-02T12:00:00Z");
    const root = workRoot([approvePublish(order("k"), [], false, now)]);
    const dir = secrets();
    const yt = fakeYoutube();
    const n = await publishApproved(root, { fetcher: yt.fetcher, settings: { dir, channelId: CHANNEL }, now: () => now, sleep: noSleep, chunkBytes: 256 * 1024 });
    assert.equal(n, 1);
    assert.equal(yt.calls.start, 1);
    assert.deepEqual(yt.calls.chunks, ["bytes 0-262143/614400", "bytes 262144-524287/614400", "bytes 524288-614399/614400"]);
    assert.deepEqual((yt.calls.meta!.status as Record<string, unknown>).publishAt, "2026-11-05T20:00:00.000Z");
    assert.equal((yt.calls.meta!.snippet as Record<string, unknown>).categoryId, "27");
    assert.equal(yt.calls.thumb, 1);
    const saved = (await listOrders(root))[0]!.order;
    assert.deepEqual([saved.yayin!.durum, saved.yayin!.videoId, saved.yayin!.url], ["planlandi", "vid123456AB", "https://youtu.be/vid123456AB"]);
    assert.ok(!existsSync(path.join(dir, "oturumlar", "k.json")), "the session is gone once done");
    assert.match(orderProgress(saved, "", now), /YouTube: yüklendi, 5 Kasım Perşembe 23:00 yayına çıkacak: https:\/\/youtu\.be\/vid123456AB/);
    assert.match(orderProgress(saved, "", new Date("2026-11-06T00:00:00Z")), /YouTube: yayında: https:\/\/youtu\.be\/vid123456AB/);
    assert.equal(await publishApproved(root, { fetcher: yt.fetcher, settings: { dir }, now: () => now }), 0, "nothing twice");
  });

  await scenario("H a dropped connection keeps the session; the next pass continues from YouTube's last byte, one session only", async () => {
    let t = new Date("2026-11-02T12:00:00Z");
    const root = workRoot([approvePublish(order("k", { sure: "60sn" }), [], false, t)]);
    const dir = secrets();
    let down = true;
    const yt = fakeYoutube({ drop: (start) => down && start > 0 });
    const deps = { fetcher: yt.fetcher, settings: { dir }, now: () => t, sleep: noSleep, chunkBytes: 256 * 1024 };
    assert.equal(await publishApproved(root, deps), 0);
    let saved = (await listOrders(root))[0]!.order;
    assert.equal(saved.yayin!.durum, "yukleniyor");
    assert.match(saved.yayin!.uyari ?? "", /bağlantı koptu, sonra devam edecek/);
    assert.ok(existsSync(path.join(dir, "oturumlar", "k.json")));
    assert.equal(await publishApproved(root, deps), 0, "the next pass waits five minutes");
    down = false;
    t = new Date(t.getTime() + 6 * 60_000);
    assert.equal(await publishApproved(root, deps), 1);
    saved = (await listOrders(root))[0]!.order;
    assert.equal(saved.yayin!.durum, "planlandi");
    assert.equal(yt.calls.start, 1, "one session");
    assert.deepEqual(yt.calls.chunks, ["bytes 0-262143/614400", "bytes 262144-524287/614400", "bytes 524288-614399/614400"]);
    assert.equal(yt.calls.thumb, 0, "a Short has no thumbnail");
  });

  await scenario("I not connected / another channel: the approval waits with the reason, nothing is uploaded", async () => {
    const now = new Date("2026-11-02T12:00:00Z");
    const root = workRoot([approvePublish(order("k"), [], false, now)]);
    const yt = fakeYoutube();
    assert.equal(await publishApproved(root, { fetcher: yt.fetcher, settings: { dir: secrets(false) }, now: () => now }), 0);
    let saved = (await listOrders(root))[0]!.order;
    assert.deepEqual([saved.yayin!.durum, saved.yayin!.uyari], ["onaylandi", "YouTube bağlantısı bekleniyor (npx tsx scripts/v3/youtube.ts baglan)"]);
    assert.equal(await publishApproved(root, { fetcher: fakeYoutube({ channel: "UCxxxxxxxxxxxxxxxxxxxxxx" }).fetcher, settings: { dir: secrets() }, now: () => now }), 0);
    saved = (await listOrders(root))[0]!.order;
    assert.match(saved.yayin!.uyari ?? "", /YOUTUBE_WRONG_CHANNEL/);
    assert.equal(await publishApproved(root, { fetcher: yt.fetcher, settings: { dir: secrets(true, "UCother_other_other_ot"), channelId: CHANNEL }, now: () => now }), 0);
    assert.match((await listOrders(root))[0]!.order.yayin!.uyari ?? "", /YOUTUBE_WRONG_CHANNEL/);
    assert.equal(yt.calls.start, 0);
  });

  await scenario("J a title already on the channel and a refusal stop the upload with the reason; a new approval may retry", async () => {
    const now = new Date("2026-11-02T12:00:00Z");
    const root = workRoot([approvePublish(order("k"), [], false, now)]);
    const dup = fakeYoutube({ uploads: [{ videoId: "l11IuUtYQCk", title: "battle of kosovo — when leaders die in battle" }] });
    assert.equal(await publishApproved(root, { fetcher: dup.fetcher, settings: { dir: secrets() }, now: () => now }), 0);
    let saved = (await listOrders(root))[0]!.order;
    assert.match(saved.yayin!.hata ?? "", /aynı başlıkta bir video zaten var \(l11IuUtYQCk\)/);
    assert.equal(dup.calls.start, 0);
    const root2 = workRoot([approvePublish(order("k"), [], false, now)]);
    const refused = fakeYoutube({ startStatus: 403 });
    assert.equal(await publishApproved(root2, { fetcher: refused.fetcher, settings: { dir: secrets() }, now: () => now }), 0);
    saved = (await listOrders(root2))[0]!.order;
    assert.deepEqual([saved.yayin!.durum, saved.yayin!.hata], ["hata", "YOUTUBE_UPLOAD_START: http 403 quotaExceeded"]);
    assert.equal(approvePublish(saved, [], false, now).yayin!.durum, "onaylandi");
    assert.ok(MAX_UPLOAD_PASSES >= 5);
    assert.ok(sameTitle("Battle of Kosovo: When Leaders Die", "battle of kosovo when leaders die"));
  });

  await scenario("K connection pieces: Desktop client only, upload + read-only scopes with PKCE, a token refreshed once an hour", async () => {
    assert.throws(() => readClient(JSON.stringify({ web: { client_id: "x", client_secret: "y" } })), /YOUTUBE_CLIENT_NOT_DESKTOP/);
    const client = readClient(JSON.stringify({ installed: { client_id: "cid", client_secret: "sec" } }));
    const url = new URL(consentUrl(client, "http://127.0.0.1:5000/", "st", "ch"));
    assert.deepEqual([url.searchParams.get("scope"), url.searchParams.get("code_challenge_method"), url.searchParams.get("access_type"), url.searchParams.get("prompt")], ["https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly", "S256", "offline", "consent"]);
    let refreshes = 0;
    let clock = 0;
    const source = tokenSource(async () => {
      refreshes++;
      return Response.json({ access_token: `at${refreshes}`, expires_in: 3600 });
    }, client, { refreshToken: "rt" }, () => clock);
    assert.equal(await source(), "at1");
    clock = 50 * 60_000;
    assert.equal(await source(), "at1");
    clock = 56 * 60_000;
    assert.equal(await source(), "at2");
    const s = youtubeSettings(mkdtempSync(path.join(os.tmpdir(), "v3-yt-repo-")), { ATOLYE_V3_YOUTUBE_DIR: "D:\\secrets\\yt", ATOLYE_V3_YOUTUBE_CHANNEL_ID: CHANNEL });
    assert.deepEqual(s, { dir: "D:\\secrets\\yt", channelId: CHANNEL });
  });

  console.log(`V3 youtube upload smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
