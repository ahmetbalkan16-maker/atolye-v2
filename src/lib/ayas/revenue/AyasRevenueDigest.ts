/** Pure revision identity; a digest is not a signature, receipt attestation or authority. */
import { createHash } from "node:crypto";
import { canonicalAyasJson } from "../provenance/AyasReleaseProvenance";
import { isAyasRevenueBoundedJson } from "./AyasRevenueRedaction";
import { AYAS_REVENUE_LEDGER_MAX_BYTES, AyasRevenueLedgerError, validateAyasRevenueLedgerState } from "./AyasRevenueLedger";
export const AYAS_REVENUE_REVISION_MAX_BYTES = 512 * 1024;
export function digestAyasRevenueData(raw: unknown): string | null {
  try { if (!isAyasRevenueBoundedJson(raw, AYAS_REVENUE_REVISION_MAX_BYTES)) return null;
    const copied: unknown = structuredClone(raw); if (!isAyasRevenueBoundedJson(copied, AYAS_REVENUE_REVISION_MAX_BYTES)) return null;
    return createHash("sha256").update(canonicalAyasJson(copied)).digest("hex");
  } catch { return null; }
}
/** Ledger identity retains16.2's capacity without widening the generic small-object contract. */
export function digestAyasRevenueLedgerData(raw: unknown): string {
  if (!isAyasRevenueBoundedJson(raw, AYAS_REVENUE_LEDGER_MAX_BYTES)) throw new AyasRevenueLedgerError("INVALID_LEDGER");
  return createHash("sha256").update(canonicalAyasJson(validateAyasRevenueLedgerState(raw))).digest("hex");
}
