import { promises as fs } from "node:fs";
import path from "node:path";
import { brainsReportText, loadAtolyeBrainsView } from "@/lib/v3/council/BrainsReport";
import { placeStudyRequest } from "@/lib/v3/council/ReferenceStore";
import { listOrders, orderProgress, ordersSummary, placeOrder, type ProductionOrder, publishLine, saveOrder } from "@/lib/v3/orders/ProductionOrders";
import { approvePublish, awaitingApproval } from "@/lib/v3/publish/PublishApproval";
import { slotText, videoKind } from "@/lib/v3/publish/PublishCalendar";
import { resolveV3Paths } from "@/lib/v3/V3Paths";

/**
 * AYAS as the studio manager (owner decision 20 Oct 2026): "Rubicon hakkında video yap" places a production order for
 * Atölye V3; "video durumu" reports the orders. AYAS only writes the order file — the separate queue runner
 * (`scripts/v3/yapim.ts izle`) makes the video with Atölye's brains, so the live server never starts a production.
 * Detection needs both a video word and a making verb, so ordinary talk about videos is not an order.
 */
export type AyasVideoIntent =
  | { readonly kind: "order"; readonly konu: string; readonly donem: string; readonly dil: "tr" | "en"; readonly sure?: string }
  | { readonly kind: "status" }
  | { readonly kind: "publish"; readonly words: string; readonly hemen: boolean }
  /** "Bu videodan öğren <YouTube bağlantısı>": the brains study it while idle (ReferenceStudy). */
  | { readonly kind: "study"; readonly url: string }
  /** "Beyinler ne öğrendi", "kurul ne dedi": the brains' council, lessons and proposals (BrainsReport). */
  | { readonly kind: "brains" };

// A YouTube link with a learning verb anywhere around it (owner approval, 2 Nov 2026: "you give a link").
const YOUTUBE_LINK = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/)|youtu\.be\/)[A-Za-z0-9_-]{11}[^\s]*/u;
const STUDY_VERB = /(?<!\p{L})(?:öğren\p{L}*|incele\p{L}*|izle\p{L}*|analiz\p{L}*|ders\s+çıkar\p{L}*|study|learn)(?!\p{L})/u;
// The brains' report: a brain/council word and a question about what they did, learned or said.
const BRAINS = /(?<!\p{L})(?:beyin\p{L}*|kurul\p{L}*)(?:\s+\S+){0,4}?\s+(?:ne(?:ler)?\s+öğren\p{L}*|ne\s+dedi\p{L}*|ne(?:ler)?\s+yaptı\p{L}*|ne\s+tartış\p{L}*|rapor\p{L}*|neler\s+oldu)(?!\p{L})|(?<!\p{L})(?:beyin|kurul|gelişim döngüsü)\s+rapor\p{L}*/u;

const VIDEO = "(?:video|videosu|videoyu|bölüm|bölümü|belgesel|belgeseli)";
const MAKE = "(?:yap|yapar mısın|yapsana|hazırla|hazırlar mısın|üret|çek|oluştur)";
const LENGTH_TR = "\\d{1,4}\\s*(?:dakikalık|saniyelik|dk['’]?lık|sn['’]?lik)";
const ORDER_TR = new RegExp(`^(?:bana\\s+)?(.{3,160}?)\\s+(?:hakkında|ile ilgili|konulu|üzerine|anlatan)\\s+(?:(?:bir|türkçe|ingilizce|kısa|uzun|yeni|${LENGTH_TR})\\s+){0,3}${VIDEO}\\s+${MAKE}`, "u");
const ORDER_TR_COLON = new RegExp(`^${VIDEO}\\s+${MAKE}\\s*[:\\-–]\\s*(.{3,160})$`, "u");
const ORDER_EN = /^(?:please\s+)?make\s+(?:me\s+)?an?\s+(?:(?:short|new|\d{1,4}[- ]?(?:minute|min|second|sec)s?)\s+){0,2}(?:video|episode)\s+(?:about|on)\s+(.{3,160})$/u;
// A video/order word in any inflection and a progress question anywhere after it ("videom ne durumda", "Sezar videosu
// ne oldu", "video yapılıyor mu"); until 22 Oct 2026 only "video durumu"-like pairs were seen and the rest went to the
// general model, which knows nothing of the orders.
const STATUS_ASK = "(?:durum\\p{L}*|ne oldu|ne durumda|nerede|hazır mı|bitti mi|yapılıyor mu|yapıldı mı|tamamlandı mı|ne aşamada|hangi aşamada|hangi adımda|ilerleme\\p{L}*|ne yaptın|ne zaman biter|ne kadar kaldı|yüklendi mi|yayınlandı mı|yayında mı|yükledin mi|yüklendi\\p{L}* mi)";
const STATUS = new RegExp(`(?<!\\p{L})(?:video|sipariş|belgesel)\\p{L}*(?:\\s+\\S+){0,4}?\\s+${STATUS_ASK}(?!\\p{L})|video siparişleri|(?<!\\p{L})(?:video status|is my video ready|how(?:'s| is) my video)`, "u");
// The owner's YouTube approval of a delivered video (owner, 2 Nov 2026: no upload without it): "Kosova videosunu yükle",
// "son videoyu hemen yayınla", "video güzel olmuş, yükle", "yüklemeyi onaylıyorum". Only an imperative at the end of
// the sentence counts; "yüklendi mi" is a status question above, "nasıl video yüklenir" matches nothing.
const PUBLISH_VERB = "(?:yükle|yayınla|yayına al)(?:yebilirsin|yabilirsin|r misin|r mısın)?";
const PUBLISH_TR = new RegExp(`^(?:(.{0,80}?)\\s+)?(?:video|short|shorts|bölüm|belgesel)(?:['’]?\\p{L}*)(?:[,\\s]+(?:onaylandı|onaylıyorum|onayladım|tamam|güzel|uygun|iyi|olmuş)){0,2}[,\\s]+(?:(?:hemen|şimdi|youtube['’]?a)\\s+){0,2}${PUBLISH_VERB}$`, "u");
const PUBLISH_APPROVE_TR = /^(?:(.{0,80}?)\s+)?(?:video\p{L}*\s+)?(?:yüklemeyi|yayını|yayınlamayı)\s+onaylıyorum$/u;
const PUBLISH_EN = /^(?:please\s+)?(?:upload|publish)\s+(?:the\s+)?(.{0,80}?)\s*(?:video|short)(?:\s+now)?$/u;
const NOW_WORD = /(?<!\p{L})(?:hemen|şimdi|now)(?!\p{L})/u;

/** A "kısa"/"short" video without a number: a short-form episode (under the long-form line, the $1 cap). */
export const SHORT_ORDER_LENGTH = "3dk";

/** Long episodes run 20–30 minutes (owner, 23 Oct 2026: "maksimum 30 dakika, minimum 20 dakika", no 45 for now). */
export const LONG_ORDER_MIN_MIN = 20;
export const LONG_ORDER_MAX_MIN = 30;
/** Below this many minutes an order is a short trial clip and keeps its length; from it on it is a long episode. */
const SHORT_TRIAL_MAX_MIN = 10;

/**
 * The length the owner asked for in the words around the topic ("3 dakikalık", "90 saniyelik", "a 3-minute", "kısa"):
 * a short trial (under 10 minutes, at least 20 s) keeps it; a long episode is kept within 20–30 minutes. None means the
 * order's default (a long video).
 */
export function lengthOf(words: string): string | undefined {
  const min = /(\d{1,4})\s*(?:dakika|dk|-?\s*min)/u.exec(words);
  if (min) {
    const n = Math.max(1, Number(min[1]));
    return `${n < SHORT_TRIAL_MAX_MIN ? n : Math.min(LONG_ORDER_MAX_MIN, Math.max(LONG_ORDER_MIN_MIN, n))}dk`;
  }
  const sec = /(\d{1,4})\s*(?:saniye|sn|-?\s*sec)/u.exec(words);
  if (sec) {
    const n = Math.max(20, Number(sec[1]));
    return `${n < SHORT_TRIAL_MAX_MIN * 60 ? n : Math.min(LONG_ORDER_MAX_MIN * 60, Math.max(LONG_ORDER_MIN_MIN * 60, n))}sn`;
  }
  return /(?:^|\s)(?:kısa|short)\s/u.test(` ${words} `) ? SHORT_ORDER_LENGTH : undefined;
}

/** Period words in the topic ("MÖ 49", "1452", "1919–1922", "16. yüzyıl"), else left to the script's research. */
export function periodOf(konu: string): string {
  const m = /(?:MÖ|M\.Ö\.)\s*\d{1,4}|\b\d{3,4}\s*[-–]\s*\d{3,4}\b|\b\d{1,2}\.\s*yüzyıl\b|\b\d{3,4}\b/iu.exec(konu);
  return m ? m[0] : "konunun geçtiği dönem";
}

export function detectAyasVideoIntent(text: string): AyasVideoIntent | null {
  const t = String(text ?? "").normalize("NFC").trim().replace(/[.!?]+$/u, "");
  const lower = t.toLocaleLowerCase("tr");
  const link = YOUTUBE_LINK.exec(t);
  if (link && STUDY_VERB.test(lower.replace(link[0].toLocaleLowerCase("tr"), " "))) return { kind: "study", url: link[0] };
  if (BRAINS.test(lower)) return { kind: "brains" };
  if (STATUS.test(lower)) return { kind: "status" };
  const p = PUBLISH_TR.exec(lower) ?? PUBLISH_APPROVE_TR.exec(lower) ?? PUBLISH_EN.exec(t.toLowerCase());
  if (p) {
    const words = (p[1] ?? "").replace(/(?<!\p{L})(?:hemen|şimdi|now|youtube['’]?a)(?!\p{L})/gu, " ").replace(/\s+/g, " ").trim();
    return { kind: "publish", words, hemen: NOW_WORD.test(lower) };
  }
  const m = ORDER_TR.exec(lower) ?? ORDER_TR_COLON.exec(lower) ?? ORDER_EN.exec(t.toLowerCase());
  if (!m?.[1]) return null;
  // The topic in the owner's own casing, cut at the same length as the match.
  const start = lower.indexOf(m[1]);
  const konu = (start >= 0 ? t.slice(start, start + m[1].length) : m[1]).trim();
  const dil: "tr" | "en" = /türkçe/u.test(lower) ? "tr" : "en";
  // The length only from the words around the topic, so "Yüz Yıl Savaşı" or a year in the topic is never a length.
  const sure = lengthOf(start >= 0 ? `${lower.slice(0, start)} ${lower.slice(start + m[1].length)}` : "");
  return { kind: "order", konu: konu.replace(/\s+türkçe\b/iu, "").trim(), donem: periodOf(konu), dil, ...(sure ? { sure } : {}) };
}

/**
 * The latest orders with what their production logs show: steps done, the running one, why one stopped. The log is
 * read from the queue runner's own output folder (`bolumler/<id>`), never from a path written in the order file.
 */
export async function ordersReport(workRoot: string, now = new Date()): Promise<string> {
  const recent = (await listOrders(workRoot)).map((x) => x.order).sort((a, b) => b.olusturuldu.localeCompare(a.olusturuldu)).slice(0, 3);
  if (!recent.length) return ordersSummary([]);
  const lines = await Promise.all(
    recent.map(async (o) => orderProgress(o, /^[\w-]+$/.test(o.id) ? await fs.readFile(path.join(workRoot, "bolumler", o.id, "uret.log"), "utf8").catch(() => "") : "", now)),
  );
  return lines.join("\n");
}

const plain = (s: string) => s.toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/\p{M}/gu, "").replace(/['’]/g, "");
const NOT_TOPIC = new Set(["bu", "su", "o", "son", "en", "yeni", "ilk", "bir", "benim", "hazir", "the", "a", "an", "this", "my", "latest", "last", "new"]);

/** The topic words the owner named ("kosova" from "Kosova videosunu yükle"), as stems that survive Turkish suffixes. */
function topicStems(words: string): string[] {
  return plain(words).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !NOT_TOPIC.has(w)).map((w) => w.slice(0, 5));
}

function namesTopic(order: ProductionOrder, stems: readonly string[]): boolean {
  const words = plain(order.konu).split(/[^a-z0-9]+/);
  return stems.every((s) => words.some((w) => w.startsWith(s)));
}

/**
 * The owner's approval from the conversation: the delivered video they named, or the only one waiting (the newest with
 * "son"). It is only written into the order — the queue runner uploads it; several matches are listed, never guessed.
 */
export async function approveFromChat(workRoot: string, intent: Extract<AyasVideoIntent, { kind: "publish" }>, now = new Date()): Promise<string> {
  const all = await listOrders(workRoot);
  const orders = all.map((x) => x.order);
  const delivered = orders.filter((o) => (o.durum === "teslim" || o.durum === "uyariyla_teslim") && o.video);
  if (!delivered.length) return "YouTube'a yüklenecek teslim edilmiş bir video yok.";
  const waiting = awaitingApproval(orders);
  const stems = topicStems(intent.words);
  const pick = stems.length ? delivered.filter((o) => namesTopic(o, stems)) : /(?<!\p{L})(?:son|latest|last)(?!\p{L})/u.test(intent.words) ? waiting.slice(0, 1) : waiting;
  const list = (os: readonly ProductionOrder[]) => os.map((o) => `"${o.konu}"`).join("; ");
  if (!pick.length) return stems.length ? `"${intent.words}" adlı teslim edilmiş bir video bulamadım.${waiting.length ? ` Onay bekleyenler: ${list(waiting)}.` : ""}` : "Onay bekleyen video yok; teslim edilenler YouTube'da ya da sırada.";
  if (pick.length > 1) return `Hangisini yükleyeyim? ${list(pick)}. Konunun adıyla söyle (ör. "${pick[0]!.konu.split(/\s+/).slice(0, 2).join(" ")} videosunu yükle").`;
  const order = pick[0]!;
  if (order.yayin && order.yayin.durum !== "hata") return `"${order.konu}":${publishLine(order, now)}`;
  approvePublish(order, orders, intent.hemen, now);
  await saveOrder(all.find((x) => x.order === order)!.file, order);
  const when = order.yayin!.yayinZamani ? `${slotText(order.yayin!.yayinZamani)} (New York 15:00) yayına çıkacak; o zamana kadar kanalda özel durur, yalnız sen görürsün` : "yüklenince hemen yayında olacak";
  return `Onayını aldım: "${order.konu}" (${videoKind(order.sure) === "short" ? "Short" : "uzun video"}) YouTube'a yüklenecek ve ${when}.${order.durum === "uyariyla_teslim" ? " Not: kalite beyni bu videoyu uyarıyla teslim etmişti." : ""} Yükleme bitince "video durumu"nda bağlantısı görünür.`;
}

/** AYAS's answer: the order is placed (or the orders are reported, or a video approved); nothing is produced in the server. */
export async function answerAyasVideoIntent(intent: AyasVideoIntent, workRoot = resolveV3Paths().workRoot): Promise<string> {
  if (intent.kind === "status") return ordersReport(workRoot);
  if (intent.kind === "publish") return approveFromChat(workRoot, intent);
  if (intent.kind === "brains") return brainsReportText(await loadAtolyeBrainsView(workRoot));
  if (intent.kind === "study") {
    const r = await placeStudyRequest(workRoot, intent.url, "ayas");
    return `Videoyu inceleme listesine aldım (${r.url}). Atölye'de sipariş yokken beyinler altyazısını ve seçilmiş karelerini inceleyip temposunu ölçecek, derslerini kendi hafızalarına yazacak; videonun hiçbir parçası kullanılmaz, indirilen dosyalar ölçümden sonra silinir. Sonucu "beyinler ne öğrendi" diye sorabilir ya da Gelişim Merkezi'nde görebilirsin.`;
  }
  const order = await placeOrder(workRoot, { konu: intent.konu, donem: intent.donem, dil: intent.dil, ...(intent.sure ? { sure: intent.sure } : {}), kaynak: "ayas" });
  const waiting = (await listOrders(workRoot)).filter((x) => x.order.durum === "bekliyor" || x.order.durum === "calisiyor").length;
  return `Siparişi aldım: "${order.konu}" (${order.dil === "en" ? "İngilizce" : "Türkçe"}, ${order.sure.replace(/dk$/, " dk").replace(/sn$/, " sn")}). Atölye stüdyosunda araştırma, kurgu, kostüm, ortam, ses ve kalite beyinleri sırayla çalışacak; video bitince kalite beyni teslim edecek.${waiting > 1 ? ` Sırada ${waiting - 1} sipariş daha var.` : ""} Durumunu "video durumu" diye sorabilirsin.`;
}
