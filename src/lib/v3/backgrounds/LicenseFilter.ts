/**
 * Which licenses V3 may publish on a monetised channel. Public domain, CC0, CC BY and CC BY-SA are recognised;
 * NonCommercial, NoDerivatives, "fair use", non-free, and anything unrecognised are refused. A picture shown in the video
 * must also pass `shareAlikeAllowed` (owner, 12 Nov 2026, "araştırmalar genişletilsin ama telif haklarına dikkat
 * edilsin"): ShareAlike could bind the whole video, so CC BY-SA is not shown without the owner's yes.
 */
export type LicenseVerdict =
  | { readonly ok: true; readonly family: "PD" | "CC0" | "CC-BY" | "CC-BY-SA"; readonly attributionRequired: boolean }
  | { readonly ok: false; readonly reason: "NC" | "ND" | "FAIR_USE" | "UNKNOWN" | "EMPTY" };

/**
 * The licence is read from its short name (Commons' LicenseShortName, an API's licence code), matched against known
 * names from the start; the free-text usage terms can only refuse (a NonCommercial or non-free mention anywhere). Until
 * 12 Nov 2026 any "attribution" in the text read as CC BY and Flickr's "no restrictions" as public domain — the first is
 * not a licence name, the second an institution's statement, not a licence.
 */
export function judgeLicense(shortName: string | undefined, usageTerms?: string): LicenseVerdict {
  const raw = `${shortName ?? ""} ${usageTerms ?? ""}`.trim();
  if (!raw) return { ok: false, reason: "EMPTY" };
  const s = raw.toLowerCase();
  if (/\bnc\b|non-?commercial/.test(s)) return { ok: false, reason: "NC" };
  if (/\bnd\b|no-?deriv/.test(s)) return { ok: false, reason: "ND" };
  if (/fair use|non-?free|copyrighted|all rights reserved/.test(s)) return { ok: false, reason: "FAIR_USE" };
  const name = (shortName?.trim() ? shortName : usageTerms ?? "").trim().toLowerCase();
  if (/^(public domain|pd\b|pd-|pdm\b)/.test(name)) return { ok: true, family: "PD", attributionRequired: false };
  if (/^(cc0|cc[- ]zero)\b/.test(name)) return { ok: true, family: "CC0", attributionRequired: false };
  if (/^(cc[- ])?by[- ]sa\b/.test(name)) return { ok: true, family: "CC-BY-SA", attributionRequired: true };
  // "Attribution" alone is Commons' {{Attribution}} licence template (free, credit owed).
  if (/^(cc[- ])?by([- ]\d|$)|^attribution$/.test(name)) return { ok: true, family: "CC-BY", attributionRequired: true };
  return { ok: false, reason: "UNKNOWN" };
}

/** CC BY-SA in a shown picture only with the owner's yes: `ATOLYE_V3_BYSA_IZIN=1` (`.env.v3.local`, read by loadV3Settings). */
export function shareAlikeAllowed(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.ATOLYE_V3_BYSA_IZIN === "1";
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

/** Atölye's own pictures (drawn by code, local SDXL designs, plain grounds): nothing to license. */
const OWN_WORK = /^Atölye\b/;

/**
 * Why a picture shown in the video may not be published, or undefined when it may: its licence must be a recognised
 * free one (an episode-given file without a stated licence, "bölümde belirtilen", is not), and BY-SA needs the
 * owner's yes.
 */
export function shownLicenceProblem(c: CreditRecord, env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  if (OWN_WORK.test(c.author)) return undefined;
  const v = judgeLicense(c.license);
  if (!v.ok) return `${c.title}: lisans "${c.license}" kabul edilmiyor (${v.reason})`;
  if (v.family === "CC-BY-SA" && !shareAlikeAllowed(env)) return `${c.title}: CC BY-SA, owner onayı yok (ATOLYE_V3_BYSA_IZIN=1)`;
  return undefined;
}

/** Plain-text attribution line for the YouTube description and CREDITS.md. */
export function attributionLine(c: CreditRecord): string {
  const parts = [`"${c.title}"`, c.author ? `— ${c.author}` : "", `(${c.license}${c.licenseUrl ? `, ${c.licenseUrl}` : ""})`, c.sourceUrl ? c.sourceUrl : ""];
  return parts.filter(Boolean).join(" ");
}

/**
 * The description's picture lines: the ones whose licence owes a credit first (they are never cut), then the free ones
 * (public domain, CC0) that are named only as a courtesy. `compact` folds the free ones into one count line, for an
 * episode whose description would not fit YouTube's 5000 bytes; CREDITS.md keeps every one.
 */
export function descriptionImageLines(images: readonly CreditRecord[], compact: boolean, en: boolean): { readonly required: string[]; readonly lines: string[] } {
  const required = [...new Set(images.filter((c) => c.attributionRequired).map(attributionLine))];
  const free = [...new Set(images.filter((c) => !c.attributionRequired && c.sourceUrl).map(attributionLine))];
  const summary = en ? `…and ${free.length} public-domain/CC0 image${free.length === 1 ? "" : "s"} (no credit owed; listed in the episode's credits file)` : `…ve ${free.length} kamu malı/CC0 görsel (atıf gerekmez; bölümün jenerik dosyasında listeli)`;
  return { required, lines: [...required, ...(compact && free.length ? [summary] : free)] };
}
