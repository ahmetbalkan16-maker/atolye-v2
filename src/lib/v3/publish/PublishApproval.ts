import type { ProductionOrder } from "../orders/ProductionOrders";
import { nextSlot, type VideoKind, videoKind } from "./PublishCalendar";

/**
 * The owner's YouTube approval of a delivered V3 video (owner, 2 Nov 2026: "ilk videolarda yükleme yapmasın, kalite
 * kontrolünü biz yapalım, onay verirsek yüklemeyi yapsın"). Only the order changes here; the queue runner's
 * PublishOrder does the upload. Network-free, so AYAS's conversation (the live server) may call it.
 */

export const isDelivered = (o: ProductionOrder): boolean => (o.durum === "teslim" || o.durum === "uyariyla_teslim") && Boolean(o.video);

/** Slots the other videos of the kind hold (approved, uploading, scheduled or public). */
export function takenSlots(kind: VideoKind, others: readonly ProductionOrder[]): string[] {
  return others.flatMap((o) => (o.yayin?.yayinZamani && o.yayin.durum !== "hata" && videoKind(o.sure) === kind ? [o.yayin.yayinZamani] : []));
}

/**
 * Approves a delivered video: it takes the next free weekly slot of its kind (or none with `hemen`). A video already
 * approved, uploading or on the channel is left alone; a stopped one ("hata") may be approved again.
 */
export function approvePublish(order: ProductionOrder, others: readonly ProductionOrder[], hemen: boolean, now = new Date()): ProductionOrder {
  if (!isDelivered(order)) throw new Error("YOUTUBE_NOT_DELIVERED: video teslim edilmeden yüklenmez");
  if (order.yayin && order.yayin.durum !== "hata") throw new Error(`YOUTUBE_ALREADY: bu videonun yayını zaten "${order.yayin.durum}"`);
  const kind = videoKind(order.sure);
  order.yayin = hemen ? { durum: "onaylandi", onay: now.toISOString(), hemen: true } : { durum: "onaylandi", onay: now.toISOString(), yayinZamani: nextSlot(kind, takenSlots(kind, others.filter((o) => o.id !== order.id)), now) };
  return order;
}

/** Delivered videos still waiting for the owner, newest first. */
export function awaitingApproval(orders: readonly ProductionOrder[]): ProductionOrder[] {
  return orders.filter((o) => isDelivered(o) && (!o.yayin || o.yayin.durum === "hata")).sort((a, b) => (b.bitis ?? b.olusturuldu).localeCompare(a.bitis ?? a.olusturuldu));
}
