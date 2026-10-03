/** Pure revision identity; a digest is not a signature, receipt attestation or authority. */
import { createHash } from "node:crypto";
import { canonicalAyasJson } from "../provenance/AyasReleaseProvenance";
import { isAyasRevenueBoundedJson } from "./AyasRevenueRedaction";
export const AYAS_REVENUE_REVISION_MAX_BYTES = 512 * 1024;
export function digestAyasRevenueData(raw: unknown): string | null {
  try { if (!isAyasRevenueBoundedJson(raw, AYAS_REVENUE_REVISION_MAX_BYTES)) return null;
    const copied: unknown = structuredClone(raw); if (!isAyasRevenueBoundedJson(copied, AYAS_REVENUE_REVISION_MAX_BYTES)) return null;
    return createHash("sha256").update(canonicalAyasJson(copied)).digest("hex");
  } catch { return null; }
}
