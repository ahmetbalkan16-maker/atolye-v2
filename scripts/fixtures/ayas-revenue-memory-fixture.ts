/** Frozen synthetic source receipts. They are neither actual owner decisions nor authenticated platform observations. */
import { digestAyasRevenueExternalId } from "../../src/lib/ayas/revenue/AyasRevenueLedger";
import { createAyasRevenueMemoryRecord, validateAyasRevenueMemoryState, type AyasRevenueMemoryInput, type AyasRevenueMemoryRecord } from "../../src/lib/ayas/revenue/AyasRevenueMemory";
export const RM_AT="2026-10-03T12:00:00.000Z",RM_NOW="2026-10-03T13:00:00.000Z",RM_OLD="2026-09-01T12:00:00.000Z";
export const rmDigest=digestAyasRevenueExternalId;
export function rmInput(tag="primary",patch:Partial<AyasRevenueMemoryInput>={}):AyasRevenueMemoryInput {
  return {schemaVersion:"1",eventDigest:rmDigest("memory-"+tag),kind:"OFFER",factClass:"OWNER_DECISION",source:"OWNER_IMPORT",evidenceDigest:rmDigest("observation-"+tag),reviewEvidenceDigest:rmDigest("review-"+tag),platform:"etsy",offerDigest:rmDigest("offer-one"),entityId:null,slot:"PRIMARY_OFFER",
    value:{state:"ACTIVE",code:null,plannedPrice:null,relatedDigest:null,dueAt:null,activityCount:null},ledgerRef:null,observedAt:RM_AT,effectiveFrom:RM_AT,effectiveUntil:null,supersedesRecordId:null,...patch};
}
export const rmRecord=(tag="primary",patch:Partial<AyasRevenueMemoryInput>={},at=RM_AT)=>createAyasRevenueMemoryRecord(rmInput(tag,patch),at);
export const rmState=(...records:AyasRevenueMemoryRecord[])=>validateAyasRevenueMemoryState({schemaVersion:"1",revision:records.length,records});
export const rmQuery=(at=RM_NOW)=>({mode:"current" as const,at,knownAt:RM_NOW,from:null,until:null});
