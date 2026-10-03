/**
 * Stage 16.4 — Etsy webhook verification. A verified delivery is only a pointer to re-read.
 *
 * Etsy signs `webhook-id + "." + webhook-timestamp + "." + raw body` with HMAC-SHA256 under the endpoint's signing
 * secret (`whsec_` + base64) and sends the base64 result in `webhook-signature`. The payload names an event, a shop
 * and a `resource_url`. Here: signature first, then a five-minute timestamp window, then de-duplication by
 * `webhook-id`, then a closed event set and a resource URL that must be an Etsy receipt of the connected shop.
 * The result carries ids only: no raw body, no secret, no ledger write and no authority. Order truth comes from the
 * canonical API reads it names.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { deepFreezeAyasRevenueValue, isAyasRevenuePlainRecord, isAyasRevenueTimestamp } from "../../AyasRevenueRedaction";
import { AYAS_ETSY_RESOURCE_HOSTS, ayasEtsyIdOf, isAyasEtsyId } from "./AyasEtsySchemas";

export const AYAS_ETSY_WEBHOOK_EVENTS = Object.freeze(["order.paid", "order.canceled", "order.shipped", "order.delivered"] as const);
export const AYAS_ETSY_WEBHOOK_TOLERANCE_SECONDS = 300;
export const AYAS_ETSY_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
export type AyasEtsyWebhookStatus = "VERIFIED_POINTER" | "DUPLICATE" | "REJECTED";
export interface AyasEtsyWebhookResult {
  readonly status: AyasEtsyWebhookStatus; readonly reason: string; readonly deliveryId: string | null;
  readonly pointer: { readonly eventType: typeof AYAS_ETSY_WEBHOOK_EVENTS[number]; readonly shopRef: string; readonly receiptRef: string } | null;
  /** The reads that establish what happened; nothing is updated from the delivery itself. */
  readonly canonicalReads: readonly ({ readonly operation: "ORDER_LIST_READ"; readonly payload: { readonly receiptId: string } }
    | { readonly operation: "PAYOUT_LIST_READ"; readonly payload: { readonly kind: "RECEIPT_PAYMENTS"; readonly receiptId: string } })[];
  readonly authority: "NONE"; readonly writesLedger: false; readonly keepsRawBody: false;
}
export interface AyasEtsyWebhookInput {
  /** Header names in any case. */
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
  /** Held by the connector or server secret store and passed for this call only; never stored or returned. */
  readonly signingSecret: string;
  readonly expectedShopId: string;
  readonly now: string;
  readonly seenDeliveryIds: ReadonlySet<string>;
}
const out = (status: AyasEtsyWebhookStatus, reason: string, deliveryId: string | null = null, pointer: AyasEtsyWebhookResult["pointer"] = null): AyasEtsyWebhookResult =>
  deepFreezeAyasRevenueValue({ status, reason, deliveryId, pointer, authority: "NONE" as const, writesLedger: false as const, keepsRawBody: false as const,
    canonicalReads: pointer ? [{ operation: "ORDER_LIST_READ" as const, payload: { receiptId: pointer.receiptRef } },
      { operation: "PAYOUT_LIST_READ" as const, payload: { kind: "RECEIPT_PAYMENTS" as const, receiptId: pointer.receiptRef } }] : [] });

function signatureMatches(secret: string, signed: string, header: string): boolean {
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) return false;
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  if (key.length < 16) return false;
  const expected = createHmac("sha256", key).update(signed, "utf8").digest();
  // One or more space-separated values, each optionally prefixed `v1,`.
  return header.split(" ").filter(Boolean).slice(0, 8).some((token) => {
    const value = token.startsWith("v1,") ? token.slice(3) : token;
    if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export function verifyAyasEtsyWebhook(input: AyasEtsyWebhookInput): AyasEtsyWebhookResult {
  try {
    if (!isAyasRevenuePlainRecord(input) || !isAyasRevenuePlainRecord(input.headers) || typeof input.rawBody !== "string" || typeof input.signingSecret !== "string"
      || !isAyasEtsyId(input.expectedShopId) || !isAyasRevenueTimestamp(input.now) || !(input.seenDeliveryIds instanceof Set)) return out("REJECTED", "INVALID_INPUT");
    const header = (name: string): string | null => { const hits = Object.entries(input.headers).filter(([k]) => k.toLowerCase() === name); return hits.length === 1 && typeof hits[0]![1] === "string" ? hits[0]![1] : null; };
    const id = header("webhook-id"), ts = header("webhook-timestamp"), signature = header("webhook-signature");
    if (id === null || ts === null || signature === null || !/^[A-Za-z0-9_.:-]{1,128}$/.test(id) || !/^\d{1,12}$/.test(ts) || signature.length > 1024) return out("REJECTED", "MISSING_OR_MALFORMED_HEADERS");
    if (Buffer.byteLength(input.rawBody, "utf8") > AYAS_ETSY_WEBHOOK_MAX_BODY_BYTES) return out("REJECTED", "BODY_TOO_LARGE");
    if (!signatureMatches(input.signingSecret, `${id}.${ts}.${input.rawBody}`, signature)) return out("REJECTED", "SIGNATURE_INVALID");
    if (Math.abs(Date.parse(input.now) / 1000 - Number(ts)) > AYAS_ETSY_WEBHOOK_TOLERANCE_SECONDS) return out("REJECTED", "TIMESTAMP_OUTSIDE_WINDOW", id);
    if (input.seenDeliveryIds.has(id)) return out("DUPLICATE", "DELIVERY_ALREADY_SEEN", id);
    const body: unknown = JSON.parse(input.rawBody);
    if (!isAyasRevenuePlainRecord(body)) return out("REJECTED", "PAYLOAD_INVALID", id);
    if (!(AYAS_ETSY_WEBHOOK_EVENTS as readonly unknown[]).includes(body.event_type)) return out("REJECTED", "UNKNOWN_EVENT", id);
    const shopRef = ayasEtsyIdOf(body.shop_id);
    if (shopRef === null || shopRef !== input.expectedShopId) return out("REJECTED", "SHOP_MISMATCH", id);
    if (typeof body.resource_url !== "string" || body.resource_url.length > 512) return out("REJECTED", "RESOURCE_URL_INVALID", id);
    const url = new URL(body.resource_url);
    const match = /^\/v3\/application\/shops\/([1-9]\d{0,18})\/receipts\/([1-9]\d{0,18})$/.exec(url.pathname);
    if (url.protocol !== "https:" || !(AYAS_ETSY_RESOURCE_HOSTS as readonly string[]).includes(url.hostname) || url.port !== "" || url.username !== "" || url.password !== ""
      || url.search !== "" || url.hash !== "" || match === null || match[1] !== shopRef) return out("REJECTED", "RESOURCE_URL_INVALID", id);
    return out("VERIFIED_POINTER", "CANONICAL_READ_REQUIRED", id, { eventType: body.event_type as typeof AYAS_ETSY_WEBHOOK_EVENTS[number], shopRef, receiptRef: match[2]! });
  } catch { return out("REJECTED", "INVALID_INPUT"); }
}
