/**
 * An episode's period read from its `donem` text: its last year and the age it belongs to. Shared by the validator
 * (what may stand on the map in that year), the director and mix (battle effects and sounds by age) and the background
 * search (period images).
 */

/** Last year of an episode period ("1452", "1451–1453", "MÖ 44", "44 BC", "1919-1922"); BCE years are negative. */
export function periodEndYear(donem: string): number | undefined {
  // \b is ASCII-only in JavaScript, so it would never see the edge of "MÖ".
  const bce = /(^|[^\p{L}])(MÖ|M\.Ö\.|BC|BCE)(?!\p{L})/iu.test(donem);
  const years = [...donem.matchAll(/\b(\d{1,4})\b/g)].map((m) => Number(m[1])).filter((y) => y > 0);
  if (!years.length) return undefined;
  return bce ? -Math.min(...years) : Math.max(...years);
}

/** The age a period belongs to (sound effects, battle effects, vehicles on the map): before gunpowder warfare or after. */
export type Era = "antik" | "orta" | "erken-modern" | "modern";

export function eraOf(donem: string): Era {
  const year = periodEndYear(donem);
  if (year === undefined || year >= 1800) return "modern";
  if (year < 500) return "antik";
  if (year < 1450) return "orta";
  return "erken-modern";
}
