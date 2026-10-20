import { listOrders, ordersSummary, placeOrder } from "@/lib/v3/orders/ProductionOrders";
import { resolveV3Paths } from "@/lib/v3/V3Paths";

/**
 * AYAS as the studio manager (owner decision 20 Oct 2026): "Rubicon hakkında video yap" places a production order for
 * Atölye V3; "video durumu" reports the orders. AYAS only writes the order file — the separate queue runner
 * (`scripts/v3/yapim.ts izle`) makes the video with Atölye's brains, so the live server never starts a production.
 * Detection needs both a video word and a making verb, so ordinary talk about videos is not an order.
 */
export type AyasVideoIntent =
  | { readonly kind: "order"; readonly konu: string; readonly donem: string; readonly dil: "tr" | "en" }
  | { readonly kind: "status" };

const VIDEO = "(?:video|videosu|videoyu|bölüm|bölümü|belgesel|belgeseli)";
const MAKE = "(?:yap|yapar mısın|yapsana|hazırla|hazırlar mısın|üret|çek|oluştur)";
const ORDER_TR = new RegExp(`^(?:bana\\s+)?(.{3,160}?)\\s+(?:hakkında|ile ilgili|konulu|üzerine|anlatan)\\s+(?:(?:bir|türkçe|ingilizce|kısa|uzun|yeni)\\s+){0,3}${VIDEO}\\s+${MAKE}`, "u");
const ORDER_TR_COLON = new RegExp(`^${VIDEO}\\s+${MAKE}\\s*[:\\-–]\\s*(.{3,160})$`, "u");
const ORDER_EN = /^(?:please\s+)?make\s+(?:me\s+)?an?\s+(?:short\s+|new\s+)?(?:video|episode)\s+(?:about|on)\s+(.{3,160})$/u;
const STATUS = new RegExp(`(?:${VIDEO}|sipariş)(?:lar|ler)?(?:ım|im|in|ın)?\\s+(?:durumu|ne durumda|nerede|hazır mı|bitti mi)|video siparişleri|videom hazır mı`, "u");

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
  return { kind: "order", konu: konu.replace(/\s+türkçe\b/iu, "").trim(), donem: periodOf(konu), dil };
}

/** AYAS's answer: the order is placed (or the orders are summarised); nothing is produced in the server. */
export async function answerAyasVideoIntent(intent: AyasVideoIntent, workRoot = resolveV3Paths().workRoot): Promise<string> {
  if (intent.kind === "status") return ordersSummary((await listOrders(workRoot)).map((x) => x.order));
  const order = await placeOrder(workRoot, { konu: intent.konu, donem: intent.donem, dil: intent.dil, kaynak: "ayas" });
  const waiting = (await listOrders(workRoot)).filter((x) => x.order.durum === "bekliyor" || x.order.durum === "calisiyor").length;
  return `Siparişi aldım: "${order.konu}" (${order.dil === "en" ? "İngilizce" : "Türkçe"}). Atölye stüdyosunda araştırma, kurgu, kostüm, ortam, ses ve kalite beyinleri sırayla çalışacak; video bitince kalite beyni teslim edecek.${waiting > 1 ? ` Sırada ${waiting - 1} sipariş daha var.` : ""} Durumunu "video durumu" diye sorabilirsin.`;
}
