import { promises as fs } from "node:fs";
import path from "node:path";
import { listOrders, orderProgress, ordersSummary, placeOrder } from "@/lib/v3/orders/ProductionOrders";
import { resolveV3Paths } from "@/lib/v3/V3Paths";

/**
 * AYAS as the studio manager (owner decision 20 Oct 2026): "Rubicon hakkında video yap" places a production order for
 * Atölye V3; "video durumu" reports the orders. AYAS only writes the order file — the separate queue runner
 * (`scripts/v3/yapim.ts izle`) makes the video with Atölye's brains, so the live server never starts a production.
 * Detection needs both a video word and a making verb, so ordinary talk about videos is not an order.
 */
export type AyasVideoIntent =
  | { readonly kind: "order"; readonly konu: string; readonly donem: string; readonly dil: "tr" | "en"; readonly sure?: string }
  | { readonly kind: "status" };

const VIDEO = "(?:video|videosu|videoyu|bölüm|bölümü|belgesel|belgeseli)";
const MAKE = "(?:yap|yapar mısın|yapsana|hazırla|hazırlar mısın|üret|çek|oluştur)";
const LENGTH_TR = "\\d{1,4}\\s*(?:dakikalık|saniyelik|dk['’]?lık|sn['’]?lik)";
const ORDER_TR = new RegExp(`^(?:bana\\s+)?(.{3,160}?)\\s+(?:hakkında|ile ilgili|konulu|üzerine|anlatan)\\s+(?:(?:bir|türkçe|ingilizce|kısa|uzun|yeni|${LENGTH_TR})\\s+){0,3}${VIDEO}\\s+${MAKE}`, "u");
const ORDER_TR_COLON = new RegExp(`^${VIDEO}\\s+${MAKE}\\s*[:\\-–]\\s*(.{3,160})$`, "u");
const ORDER_EN = /^(?:please\s+)?make\s+(?:me\s+)?an?\s+(?:(?:short|new|\d{1,4}[- ]?(?:minute|min|second|sec)s?)\s+){0,2}(?:video|episode)\s+(?:about|on)\s+(.{3,160})$/u;
// A video/order word in any inflection and a progress question anywhere after it ("videom ne durumda", "Sezar videosu
// ne oldu", "video yapılıyor mu"); until 22 Oct 2026 only "video durumu"-like pairs were seen and the rest went to the
// general model, which knows nothing of the orders.
const STATUS_ASK = "(?:durum\\p{L}*|ne oldu|ne durumda|nerede|hazır mı|bitti mi|yapılıyor mu|yapıldı mı|tamamlandı mı|ne aşamada|hangi aşamada|hangi adımda|ilerleme\\p{L}*|ne yaptın|ne zaman biter|ne kadar kaldı)";
const STATUS = new RegExp(`(?<!\\p{L})(?:video|sipariş|belgesel)\\p{L}*(?:\\s+\\S+){0,4}?\\s+${STATUS_ASK}(?!\\p{L})|video siparişleri|(?<!\\p{L})(?:video status|is my video ready|how(?:'s| is) my video)`, "u");

/** A "kısa"/"short" video without a number: a short-form episode (under the long-form line, the $1 cap). */
export const SHORT_ORDER_LENGTH = "3dk";

/**
 * The length the owner asked for in the words around the topic ("3 dakikalık", "90 saniyelik", "a 3-minute", "kısa"),
 * kept inside the producer's 20 s – 30 min range; none means the order's default (a long video).
 */
export function lengthOf(words: string): string | undefined {
  const min = /(\d{1,4})\s*(?:dakika|dk|-?\s*min)/u.exec(words);
  if (min) return `${Math.min(30, Math.max(1, Number(min[1])))}dk`;
  const sec = /(\d{1,4})\s*(?:saniye|sn|-?\s*sec)/u.exec(words);
  if (sec) return `${Math.min(1800, Math.max(20, Number(sec[1])))}sn`;
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
  if (STATUS.test(lower)) return { kind: "status" };
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

/** AYAS's answer: the order is placed (or the orders are reported); nothing is produced in the server. */
export async function answerAyasVideoIntent(intent: AyasVideoIntent, workRoot = resolveV3Paths().workRoot): Promise<string> {
  if (intent.kind === "status") return ordersReport(workRoot);
  const order = await placeOrder(workRoot, { konu: intent.konu, donem: intent.donem, dil: intent.dil, ...(intent.sure ? { sure: intent.sure } : {}), kaynak: "ayas" });
  const waiting = (await listOrders(workRoot)).filter((x) => x.order.durum === "bekliyor" || x.order.durum === "calisiyor").length;
  return `Siparişi aldım: "${order.konu}" (${order.dil === "en" ? "İngilizce" : "Türkçe"}, ${order.sure.replace(/dk$/, " dk").replace(/sn$/, " sn")}). Atölye stüdyosunda araştırma, kurgu, kostüm, ortam, ses ve kalite beyinleri sırayla çalışacak; video bitince kalite beyni teslim edecek.${waiting > 1 ? ` Sırada ${waiting - 1} sipariş daha var.` : ""} Durumunu "video durumu" diye sorabilirsin.`;
}
