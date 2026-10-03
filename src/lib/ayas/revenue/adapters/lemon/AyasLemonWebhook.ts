/** Raw HMAC verification before parsing. Notification pointers only; no HTTP route, store, queue or ledger write. */
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import { isAyasRevenueDigest } from "../../AyasRevenueOpportunity";
import { deepFreezeAyasRevenueValue, isAyasRevenuePlainRecord } from "../../AyasRevenueRedaction";
import { lemonId, snapshotAyasLemonValue, type AyasLemonMode, type AyasLemonType } from "./AyasLemonSchemas";
import { runAyasRevenueReadOrDraft, type AyasRevenuePlatformRegistry } from "../../AyasRevenuePlatformRegistry";
import { mapAyasLemonReadToLedger } from "./AyasLemonMapper";
import { isAyasRevenueTimestamp } from "../../AyasRevenueRedaction";

export const AYAS_LEMON_WEBHOOK_EVENT_TYPE: Readonly<Record<string, AyasLemonType>> = Object.freeze({ order_created: "orders", order_refunded: "orders",
  subscription_created: "subscriptions", subscription_updated: "subscriptions", subscription_cancelled: "subscriptions", subscription_resumed: "subscriptions", subscription_expired: "subscriptions",
  subscription_paused: "subscriptions", subscription_unpaused: "subscriptions", subscription_payment_success: "subscription-invoices", subscription_payment_failed: "subscription-invoices",
  subscription_payment_recovered: "subscription-invoices", subscription_payment_refunded: "subscription-invoices", license_key_created: "license-keys", license_key_updated: "license-keys" });
export function verifyAyasLemonWebhook(rawBody: unknown, headers: unknown, serverSecret: string, binding: { storeRef: string; mode: AyasLemonMode }, seen: readonly string[] = []): Readonly<Record<string, unknown>> | null {
  try {
    if (!Buffer.isBuffer(rawBody) || rawBody.byteLength === 0 || rawBody.byteLength > 262_144 || typeof serverSecret !== "string" || serverSecret.length < 16 || serverSecret.length > 128
      || !isAyasRevenuePlainRecord(binding) || lemonId(binding.storeRef) !== binding.storeRef || !["TEST", "LIVE"].includes(binding.mode)
      || !Array.isArray(seen) || seen.length > 1000 || !seen.every(isAyasRevenueDigest) || new Set(seen).size !== seen.length) return null;
    const h = snapshotAyasLemonValue(headers, 8192); if (!isAyasRevenuePlainRecord(h) || !Object.values(h).every(v => typeof v === "string")) return null;
    const entries = Object.entries(h).map(([k, v]) => [k.toLowerCase(), v] as const); if (new Set(entries.map(x => x[0])).size !== entries.length) return null;
    const normalized = Object.fromEntries(entries), signature = normalized["x-signature"], event = normalized["x-event-name"];
    if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature) || typeof event !== "string" || !Object.hasOwn(AYAS_LEMON_WEBHOOK_EVENT_TYPE, event)) return null;
    const bytes = Buffer.from(rawBody), expected = createHmac("sha256", serverSecret).update(bytes).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return null;
    // Lemon documents neither a signed delivery timestamp nor a unique delivery ID. Do not invent freshness.
    const body = snapshotAyasLemonValue(JSON.parse(bytes.toString("utf8")));
    if (!isAyasRevenuePlainRecord(body) || !isAyasRevenuePlainRecord(body.meta) || body.meta.event_name !== event || !isAyasRevenuePlainRecord(body.data)
      || body.data.type !== AYAS_LEMON_WEBHOOK_EVENT_TYPE[event] || lemonId(body.data.id) === null || !isAyasRevenuePlainRecord(body.data.attributes)) return null;
    const a = body.data.attributes;
    if (lemonId(a.store_id) !== binding.storeRef || (body.data.type !== "license-keys" && a.test_mode !== (binding.mode === "TEST"))
      || (body.data.type === "license-keys" && Object.hasOwn(a, "test_mode") && a.test_mode !== (binding.mode === "TEST"))) return null;
    const resourceRef = lemonId(body.data.id)!, bodyDigest = createHash("sha256").update(bytes).digest("hex"), eventDigest = digestAyasRevenueData({ event, bodyDigest, storeRef: binding.storeRef, mode: binding.mode })!;
    return deepFreezeAyasRevenueValue({ state: seen.includes(eventDigest) ? "REPLAY" : "VERIFIED_POINTER", eventDigest, eventCode: event, resourceType: body.data.type, resourceRef,
      storeRefDigest: digestAyasRevenueData({ storeRef: binding.storeRef }), mode: binding.mode, modeQualification: body.data.type === "license-keys" ? "CANONICAL_ORDER_PARENT_REQUIRED" : "SIGNED_NOTIFICATION_ONLY",
      canonicalApiReadRequired: true, replayProtection: "BODY_DIGEST_NO_SIGNED_TIME_NO_DURABLE_BINDING", rawRetention: "DISCARDED", economicEvidence: "NONE", writesLedger: false, externalWrite: false, authority: "NONE" });
  } catch { return null; }
}

/** Trusted caller selects the registry/journal scope. This performs a gated GET and returns inert inputs only.
 * A durable notification receipt and explicit16.2 append remain caller responsibilities; no HTTP ACK is issued. */
export async function refreshAyasLemonVerifiedNotification(rawBody: unknown, headers: unknown, serverSecret: string, binding: { storeRef: string; mode: AyasLemonMode },
  context: { registry: AyasRevenuePlatformRegistry; accountRef: string; requestId: string; now: () => string; seen?: readonly string[] }): Promise<Readonly<Record<string, unknown>>> {
  const closed = (reason: string) => Object.freeze({ state: "REFUSED", reason, authority: "NONE", writesLedger: false, externalWrite: false });
  try {
    const pointer = verifyAyasLemonWebhook(rawBody, headers, serverSecret, binding, context.seen ?? []);
    if (pointer === null) return closed("NOT_VERIFIED");
    if (pointer.state === "REPLAY") return deepFreezeAyasRevenueValue({ state: "REPLAY", eventDigest: pointer.eventDigest, authority: "NONE", writesLedger: false, externalWrite: false });
    const at = context.now(); if (!isAyasRevenueTimestamp(at)) return closed("CLOCK_INVALID");
    const read = await runAyasRevenueReadOrDraft(context.registry, { requestId: context.requestId, accountRef: context.accountRef, requestedAt: at, platform: "lemon-squeezy", mode: "READ", operation: "ORDER_LIST_READ",
      payload: { kind: pointer.resourceType, resourceRef: pointer.resourceRef } }, { now: context.now });
    const r = snapshotAyasLemonValue(read.result);
    if (!isAyasRevenuePlainRecord(r) || r.status !== "OK" || !isAyasRevenueTimestamp(r.observedAt) || r.observedAt < at || !isAyasRevenuePlainRecord(r.data)) return closed("CANONICAL_READ_UNAVAILABLE");
    const d = r.data;
    if (d.kind !== "LEMON_CANONICAL_READ" || d.resourceType !== pointer.resourceType || d.mode !== pointer.mode || d.storeRefDigest !== pointer.storeRefDigest || !Array.isArray(d.items) || d.items.length !== 1
      || !isAyasRevenuePlainRecord(d.items[0]) || d.items[0].type !== pointer.resourceType || d.items[0].resourceRef !== pointer.resourceRef || d.items[0].storeRefDigest !== pointer.storeRefDigest || d.items[0].mode !== pointer.mode) return closed("CANONICAL_POINTER_MISMATCH");
    return deepFreezeAyasRevenueValue({ state: "CANONICAL_FACTS_READY", eventDigest: pointer.eventDigest, canonicalReadDigest: digestAyasRevenueData(r), ledgerMapping: mapAyasLemonReadToLedger(r),
      durableDedupe: "PENDING_TRUSTED_CALLER", ledgerCommit: "PENDING_EXPLICIT_STAGE16_2_CALLER", rawRetention: "DISCARDED", authority: "NONE", writesLedger: false, externalWrite: false });
  } catch { return closed("REFRESH_FAILED"); }
}
