/** Fake hashes, signed fixtures and isolated adapters; never real owner/platform authority. */
import { createHash,createHmac } from "node:crypto";
export const RS_AT="2026-10-03T15:00:00.000Z",rsDigest=(s:string)=>createHash("sha256").update(s).digest("hex");
export const rsAccount=(patch:Record<string,unknown>={})=>({schemaVersion:"1",platform:"etsy",accountDigest:rsDigest("account"),storeDigest:rsDigest("store"),mode:"TEST",scopeDigest:rsDigest("scopes"),toolCatalogDigest:rsDigest("tools"),securitySettingsDigest:rsDigest("settings"),credentialState:"ACTIVE",unexpectedWrite:false,unfamiliarDevice:false,mfaChanged:false,observedAt:RS_AT,...patch});
export const rsBinding=(patch:Record<string,unknown>={})=>({platform:"etsy",accountDigest:rsDigest("account"),resourceDigest:rsDigest("resource"),actionDigest:rsDigest("action"),nonceDigest:rsDigest("nonce"),canonicalDigest:rsDigest("canonical"),canonicalObservedAt:RS_AT,...patch});
export const rsRequest=(patch:Record<string,unknown>={})=>({requestId:"security-fixture-request",platform:"etsy",operation:"LISTING_LIST_READ",mode:"READ",accountRef:"fixture-account",requestedAt:RS_AT,...patch});
export function rsEtsy(event="order.paid",shop="1",url="https://openapi.etsy.com/v3/application/shops/1/receipts/2") {
 const secret="whsec_"+Buffer.alloc(32,7).toString("base64"),id="fixture-delivery",ts=String(Date.parse(RS_AT)/1000),rawBody=JSON.stringify({event_type:event,shop_id:Number(shop),resource_url:url});
 const signature=createHmac("sha256",Buffer.alloc(32,7)).update(`${id}.${ts}.${rawBody}`).digest("base64");
 return {headers:{"webhook-id":id,"webhook-timestamp":ts,"webhook-signature":"v1,"+signature},rawBody,signingSecret:secret,expectedShopId:"1",now:RS_AT,seenDeliveryIds:new Set<string>()};
}
