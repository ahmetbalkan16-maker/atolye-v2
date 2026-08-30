import type { MediaRightsStatus } from "@/types/asset";

/**
 * Deterministic, pure classification of a real-media asset's usage rights from
 * the licence string its source reported (e.g. Wikimedia Commons'
 * `extmetadata.LicenseShortName` / `UsageTerms`). No network, no model.
 *
 * Design goals for the documentary-media effort (Sprint 166):
 *  - Never guess "safe" from an empty / unrecognised licence — that is exactly
 *    the silent-ingest failure mode the effort is meant to remove. Missing or
 *    unrecognised -> `unknown`; an explicit all-rights-reserved / non-free
 *    signal -> `restricted`.
 *  - `verified` is NEVER produced here. It is reserved for an out-of-band human
 *    or provenance confirmation and must be set explicitly by that path.
 *  - Mirrors, and is a superset of, `RealPhotoImageProvider`'s private
 *    `isFreeLicense` gate (public-domain / PD-* / CC0 / CC-BY[-SA]-N); this
 *    module is the canonical, reusable version (production acceptance, cost
 *    reporting, the per-scene media decision all consume it).
 */
export function classifyMediaRightsStatus(
  license: string | null | undefined,
): MediaRightsStatus {
  if (typeof license !== "string") return "unknown";
  const normalized = license.trim().toLowerCase();
  if (!normalized) return "unknown";

  // Explicit non-free / all-rights-reserved signals take precedence.
  if (
    normalized.includes("all rights reserved") ||
    normalized.includes("copyrighted") ||
    normalized.includes("non-free") ||
    normalized.includes("nonfree") ||
    normalized.includes("fair use") ||
    normalized.includes("fair dealing") ||
    /\bcc[\s-]by[\s-]nc\b/.test(normalized) ||
    /\bcc[\s-]by[\s-]nd\b/.test(normalized) ||
    normalized.includes("-nc-") || normalized.endsWith("-nc") ||
    normalized.includes("-nd-") || normalized.endsWith("-nd") ||
    normalized.includes("noncommercial") ||
    normalized.includes("no derivatives") || normalized.includes("noderivatives")
  ) {
    return "restricted";
  }

  // Public domain (no licence required to reuse).
  if (
    normalized.includes("public domain") ||
    normalized.includes("public-domain") ||
    /^pd(?:[\s-]|$)/.test(normalized) ||
    normalized.startsWith("cc0") ||
    normalized.includes("cc-zero") ||
    normalized === "pdm" ||
    normalized.includes("no known copyright") ||
    normalized.includes("no restrictions")
  ) {
    return "public-domain";
  }

  // Free/open licences that permit reuse (with attribution / share-alike).
  if (
    /\bcc[\s-]by(?:[\s-]sa)?(?:[\s-]?\d(?:\.\d)?)?\b/.test(normalized) ||
    normalized.includes("creative commons attribution") ||
    normalized.includes("gfdl") ||
    normalized.includes("free art license") ||
    normalized.includes("free-art-license") ||
    normalized.includes("open government licence") ||
    normalized.includes("open government license") ||
    normalized.includes("ogl") ||
    normalized.includes("etalab") ||
    normalized.startsWith("mit") ||
    normalized.startsWith("apache")
  ) {
    return "open-license";
  }

  return "unknown";
}

/**
 * Deterministic production-admission decision for a rights status. Only
 * confirmed-free media may be pulled into a production render silently;
 * `restricted` and `unknown` fail closed and must be handled explicitly
 * (dropped, replaced, or overridden by an operator).
 */
export function isProductionAdmissibleRightsStatus(
  status: MediaRightsStatus | null | undefined,
): boolean {
  return status === "public-domain" || status === "open-license" || status === "verified";
}
