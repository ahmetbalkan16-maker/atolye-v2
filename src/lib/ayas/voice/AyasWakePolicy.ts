/** Owner decisions 2026-10-07. Versioning preserves V1 and V2 evidence/API.
 * Production hook and STT route explicitly select V3; it grants only wake,
 * never tool/execution authority. Acoustic negatives require separate proof.
 */
export const AYAS_OWNER_WAKE_POLICY_V2 = "owner-v2" as const;
export const AYAS_OWNER_WAKE_POLICY_V3 = "owner-v3" as const;
export type AyasWakePolicyVersion = "legacy-v1" | typeof AYAS_OWNER_WAKE_POLICY_V2 | typeof AYAS_OWNER_WAKE_POLICY_V3;
export const AYAS_WAKE_POLICY_V2_ALIASES: readonly string[] = Object.freeze(["ayas", "ayaz"]);
export const AYAS_WAKE_POLICY_V3_ALIASES: readonly string[] = Object.freeze(["ayas", "ayaz", "hayas"]);

/** Whole Unicode words only: neither HAYAS nor AYAZ'ın suffix becomes AYAS. */
export function normaliseOwnerWakeNames(text: string): string {
  return text
    .replace(/(?<![\p{L}\p{N}_'’])(?:ayas|ayaz)(?![\p{L}\p{N}_'’])/giu, "AYAS")
    .replace(/\s+/g, " ")
    .trim();
}

/** Owner V3 adds only HAYAS; the V2 normalizer/evidence stays reproducible. */
export function normaliseOwnerWakeNamesV3(text: string): string {
  return text
    .replace(/(?<![\p{L}\p{N}_'’])(?:ayas|ayaz|hayas)(?![\p{L}\p{N}_'’])/giu, "AYAS")
    .replace(/\s+/g, " ")
    .trim();
}
