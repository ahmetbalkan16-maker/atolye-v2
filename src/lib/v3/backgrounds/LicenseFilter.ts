/**
 * Which licenses V3 may publish on a monetised channel. Public domain, CC0, CC BY and CC BY-SA pass;
 * NonCommercial, NoDerivatives, "fair use", and anything unrecognised are refused.
 */
export type LicenseVerdict =
  | { readonly ok: true; readonly family: "PD" | "CC0" | "CC-BY" | "CC-BY-SA"; readonly attributionRequired: boolean }
  | { readonly ok: false; readonly reason: "NC" | "ND" | "FAIR_USE" | "UNKNOWN" | "EMPTY" };

export function judgeLicense(shortName: string | undefined, usageTerms?: string): LicenseVerdict {
  const raw = `${shortName ?? ""} ${usageTerms ?? ""}`.trim();
  if (!raw) return { ok: false, reason: "EMPTY" };
  const s = raw.toLowerCase();
  if (/\bnc\b|non-?commercial/.test(s)) return { ok: false, reason: "NC" };
  if (/\bnd\b|no-?deriv/.test(s)) return { ok: false, reason: "ND" };
  if (/fair use|non-free|copyrighted/.test(s)) return { ok: false, reason: "FAIR_USE" };
  if (/public domain|^pd\b|\bpd-|pdm|no restrictions/.test(s)) return { ok: true, family: "PD", attributionRequired: false };
  if (/\bcc0\b|cc-zero|cc zero/.test(s)) return { ok: true, family: "CC0", attributionRequired: false };
  if (/cc[ -]by[ -]sa|by-sa/.test(s)) return { ok: true, family: "CC-BY-SA", attributionRequired: true };
  if (/cc[ -]by\b|cc-by-\d|attribution/.test(s)) return { ok: true, family: "CC-BY", attributionRequired: true };
  return { ok: false, reason: "UNKNOWN" };
}

export interface CreditRecord {
  readonly assetId: string;
  readonly kind: "image" | "music" | "sfx" | "voice" | "model";
  readonly title: string;
  readonly author: string;
  readonly license: string;
  readonly licenseUrl?: string;
  readonly sourceUrl?: string;
  readonly attributionRequired: boolean;
  readonly sha256?: string;
  readonly note?: string;
}

/** Plain-text attribution line for the YouTube description and CREDITS.md. */
export function attributionLine(c: CreditRecord): string {
  const parts = [`"${c.title}"`, c.author ? `— ${c.author}` : "", `(${c.license}${c.licenseUrl ? `, ${c.licenseUrl}` : ""})`, c.sourceUrl ? c.sourceUrl : ""];
  return parts.filter(Boolean).join(" ");
}
