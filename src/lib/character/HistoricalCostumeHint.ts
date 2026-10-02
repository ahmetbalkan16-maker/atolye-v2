/**
 * Stage 15J — costume hints.
 *
 * A hint is a few simple shapes that say what kind of figure this is: a ruler, a soldier, a scholar. It is not a
 * depiction of historical dress and makes no claim about what anyone wore; the scene stays a labelled reenactment.
 */
export const HISTORICAL_COSTUME_HINTS = Object.freeze(["NONE", "TURBAN", "HELMET", "CROWN", "HOOD", "CAPE", "ROBE", "ARMOR"] as const);
export type HistoricalCostumeHint = (typeof HISTORICAL_COSTUME_HINTS)[number];

/** Where a hint is drawn. */
export const COSTUME_HINT_PLACEMENT: Readonly<Record<HistoricalCostumeHint, "NONE" | "HEAD" | "BODY">> = Object.freeze({
  NONE: "NONE", TURBAN: "HEAD", HELMET: "HEAD", CROWN: "HEAD", HOOD: "HEAD", CAPE: "BODY", ROBE: "BODY", ARMOR: "BODY",
});

export function isHistoricalCostumeHint(value: unknown): value is HistoricalCostumeHint {
  return typeof value === "string" && (HISTORICAL_COSTUME_HINTS as readonly string[]).includes(value);
}
