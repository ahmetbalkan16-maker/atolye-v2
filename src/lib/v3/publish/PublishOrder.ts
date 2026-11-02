import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { listOrders, type ProductionOrder, saveOrder } from "../orders/ProductionOrders";
import type { YoutubePackage } from "../thumbnail/YoutubePackage";
import { type Fetcher, loadClient, loadToken, myChannel, tokenSource, type YoutubeSettings } from "./YoutubeAuth";
import { takenSlots } from "./PublishApproval";
import { nextSlot, videoKind } from "./PublishCalendar";
import { isTransientUploadError, recentUploads, sameTitle, sendFile, setThumbnail, startUpload, uploadMeta, uploadStatus } from "./YoutubeUpload";

/**
 * The owner's approval and the upload of an approved V3 video (owner, 2 Nov 2026: "ilk videolarda yükleme yapmasın,
 * kalite kontrolünü biz yapalım, onay verirsek yüklemeyi yapsın"). AYAS (the live server) only writes the approval
 * into the order; the queue runner (`scripts/v3/yapim.ts izle`), which also makes the videos, does the uploading — the
 * live server never talks to YouTube. Files are read from the runner's own output folder (`bolumler/<id>`), never from
 * a path written in the order file. The approval itself is PublishApproval (network-free, for the live server).
 */

/** Passes before a stopped upload is reported; each waits longer (5, 10, 15 … minutes) for a dropped network. */
export const MAX_UPLOAD_PASSES = 8;
const PASS_WAIT_MS = 5 * 60_000;

export interface PublishDeps {
  readonly fetcher: Fetcher;
  readonly settings: YoutubeSettings;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly chunkBytes?: number;
}

/** One pass over the approved orders; returns how many reached the channel. */
export async function publishApproved(workRoot: string, deps: PublishDeps): Promise<number> {
  const now = deps.now ?? (() => new Date());
  const all = await listOrders(workRoot);
  const due = all.filter(({ order: o }) => {
    const y = o.yayin;
    if (!y || (y.durum !== "onaylandi" && y.durum !== "yukleniyor")) return false;
    return !y.sonDeneme || now().getTime() - Date.parse(y.sonDeneme) >= (y.deneme ?? 0) * PASS_WAIT_MS;
  });
  if (!due.length) return 0;
  const hold = async (why: string) => {
    for (const { file, order } of due) {
      if (order.yayin!.uyari === why) continue;
      order.yayin!.uyari = why;
      await saveOrder(file, order);
    }
    deps.log?.(`YouTube bekliyor: ${why}`);
  };
  let token: Awaited<ReturnType<typeof loadToken>>;
  try {
    token = await loadToken(deps.settings);
  } catch (e) {
    await hold((e as Error).message);
    return 0;
  }
  // Not connected yet: the approval is kept and the upload starts once the owner connects the channel.
  if (!token) {
    await hold("YouTube bağlantısı bekleniyor (npx tsx scripts/v3/youtube.ts baglan)");
    return 0;
  }
  let access: () => Promise<string>;
  let uploadsPlaylist: string | undefined;
  try {
    access = tokenSource(deps.fetcher, await loadClient(deps.settings), token);
    const channel = await myChannel(deps.fetcher, await access());
    if (channel.id !== token.channelId || (deps.settings.channelId && channel.id !== deps.settings.channelId)) throw new Error(`YOUTUBE_WRONG_CHANNEL: izin ${channel.id} kanalını açıyor`);
    uploadsPlaylist = channel.uploadsPlaylist;
  } catch (e) {
    await hold((e as Error).message.slice(0, 200));
    return 0;
  }
  let done = 0;
  for (const { file, order } of due) {
    if (await publishOne(workRoot, file, order, all.map((x) => x.order), access, uploadsPlaylist, deps, now)) done++;
  }
  return done;
}

async function publishOne(workRoot: string, file: string, order: ProductionOrder, all: readonly ProductionOrder[], access: () => Promise<string>, uploadsPlaylist: string | undefined, deps: PublishDeps, now: () => Date): Promise<boolean> {
  const y = order.yayin!;
  const sessionFile = path.join(deps.settings.dir, "oturumlar", `${order.id}.json`);
  const stop = async (why: string) => {
    Object.assign(y, { durum: "hata", hata: why.slice(0, 300), bitis: now().toISOString() });
    delete y.uyari;
    await saveOrder(file, order);
    deps.log?.(`YouTube yüklemesi durdu: ${order.id}: ${why}`);
    return false;
  };
  if (!/^[\w-]+$/.test(order.id)) return stop("sipariş kimliği okunamadı");
  const dir = path.join(workRoot, "bolumler", order.id);
  if (!existsSync(path.join(dir, "youtube.json")) || !existsSync(path.join(dir, "aciklama.txt"))) return stop("youtube.json ya da aciklama.txt yok (kapak adımı çalışmamış)");
  const yt = JSON.parse(await fs.readFile(path.join(dir, "youtube.json"), "utf8")) as { paket: YoutubePackage; kapak?: { file?: string }; dosya?: string };
  const named = yt.dosya ? path.join(dir, path.basename(yt.dosya)) : "";
  const video = named && existsSync(named) ? named : path.join(dir, "final.mp4");
  if (!existsSync(video)) return stop("video dosyası yok");
  const kind = videoKind(order.sure);
  // A slot that went by while the approval waited (no connection yet) moves to the next free one before the upload.
  if (!y.hemen && y.durum === "onaylandi" && (!y.yayinZamani || Date.parse(y.yayinZamani) < now().getTime() + 30 * 60_000)) {
    y.yayinZamani = nextSlot(kind, takenSlots(kind, all.filter((o) => o.id !== order.id)), now());
  }
  const meta = uploadMeta({ paket: yt.paket, aciklama: await fs.readFile(path.join(dir, "aciklama.txt"), "utf8"), dil: order.dil, ...(y.hemen ? {} : { publishAt: y.yayinZamani! }) });
  const size = (await fs.stat(video)).size;

  let videoId: string | undefined;
  try {
    const token = await access();
    // Never twice: a video of this title already on the channel is this one when our own upload was under way (the
    // last pass ended before writing it down), and someone else's upload otherwise.
    const same = uploadsPlaylist ? (await recentUploads(deps.fetcher, token, uploadsPlaylist)).find((u) => sameTitle(u.title, meta.snippet.title)) : undefined;
    if (same && y.durum !== "yukleniyor") return stop(`kanalda aynı başlıkta bir video zaten var (${same.videoId}); iki kez yüklenmez`);
    if (same) videoId = same.videoId;
    if (!videoId) {
      Object.assign(y, { durum: "yukleniyor", deneme: (y.deneme ?? 0) + 1, sonDeneme: now().toISOString() });
      await saveOrder(file, order);
      if ((y.deneme ?? 0) > MAX_UPLOAD_PASSES) return stop(`${MAX_UPLOAD_PASSES} denemede yüklenemedi; ${y.uyari ?? ""}`.trim());
      deps.log?.(`YouTube yükleme: ${order.id} (${(size / 1e6).toFixed(0)} MB${y.yayinZamani && !y.hemen ? `, yayın ${y.yayinZamani}` : ", hemen yayında"})`);
      let url: string | undefined;
      let from = 0;
      let finished: Record<string, unknown> | undefined;
      if (existsSync(sessionFile)) {
        const saved = JSON.parse(await fs.readFile(sessionFile, "utf8")) as { url: string; size: number };
        if (saved.size === size) {
          try {
            const s = await uploadStatus(deps.fetcher, await access(), saved.url, size);
            if ("video" in s) finished = s.video;
            else from = s.received;
            url = saved.url;
          } catch (e) {
            if (isTransientUploadError(e)) throw e;
            // The session closed (a week old, or refused): a fresh one; the title check above rules out a double.
          }
        }
      }
      if (!finished && !url) {
        url = await startUpload(deps.fetcher, await access(), meta, size);
        await fs.mkdir(path.dirname(sessionFile), { recursive: true });
        await fs.writeFile(sessionFile, `${JSON.stringify({ url, size, baslangic: now().toISOString() })}\n`);
        from = 0;
      }
      finished ??= await sendFile(deps.fetcher, access, url!, video, size, from, { ...(deps.sleep ? { sleep: deps.sleep } : {}), ...(deps.chunkBytes ? { chunkBytes: deps.chunkBytes } : {}), ...(deps.log ? { log: deps.log } : {}) });
      const id = finished.id;
      if (typeof id !== "string" || !/^[\w-]{6,20}$/.test(id)) throw new Error("YOUTUBE_UPLOAD: YouTube video kimliği dönmedi");
      videoId = id;
    }
  } catch (e) {
    const message = (e as Error).message.slice(0, 200);
    if (isTransientUploadError(e) && y.durum === "yukleniyor") {
      // A dropped network: the session is kept and the next pass continues from YouTube's last byte.
      y.uyari = `bağlantı koptu, sonra devam edecek: ${message}`;
      await saveOrder(file, order);
      deps.log?.(`YouTube yükleme bekliyor: ${order.id}: ${message}`);
      return false;
    }
    await fs.rm(sessionFile, { force: true });
    return stop(message);
  }

  Object.assign(y, { durum: y.hemen ? "yayinda" : "planlandi", videoId, url: `https://youtu.be/${videoId}`, bitis: now().toISOString() });
  delete y.uyari;
  delete y.hata;
  await saveOrder(file, order);
  await fs.rm(sessionFile, { force: true });
  deps.log?.(`YouTube'a yüklendi: ${order.id} → https://youtu.be/${videoId}`);
  // The thumbnail of a long video (Shorts have none: owner, 2 Nov 2026); a refusal is a warning, the video stays.
  const thumb = yt.kapak?.file ? path.join(dir, path.basename(yt.kapak.file)) : "";
  if (kind === "uzun" && thumb && existsSync(thumb)) {
    try {
      await setThumbnail(deps.fetcher, await access(), videoId, thumb);
    } catch (e) {
      y.uyari = `${(e as Error).message.slice(0, 160)}; kapağı YouTube Studio'dan elle koy`;
      await saveOrder(file, order);
    }
  }
  return true;
}
