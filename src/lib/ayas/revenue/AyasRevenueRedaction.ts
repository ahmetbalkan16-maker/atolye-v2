/**
 * Stage 16.0 — validation and sensitive-data refusal for revenue adapter traffic.
 *
 * Everything that crosses the adapter boundary is DATA: bounded plain JSON, exact keys, no accessors,
 * prototypes or functions. Secrets, credentials, bank/card/tax identifiers, customer contact details
 * and machine paths are refused, not partially redacted: a value that carries one is not passed on.
 * External identifiers and cursors are identifiers only, never paths, and a cursor is bound to the
 * platform and operation that produced it.
 */
import { containsBrainSecret } from "../../brain/BrainRedaction";
import { AYAS_REVENUE_LIMITS, AYAS_REVENUE_OPERATIONS, AYAS_REVENUE_PLATFORMS, type AyasRevenueOperation, type AyasRevenuePlatform } from "./AyasRevenuePlatformTypes";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
/** Field names that carry credentials or regulated personal/financial data, compared without case or separators. */
const SENSITIVE_KEY_TERMS = ["token", "secret", "secretkey", "password", "passwordhash", "passwd", "apikey", "authorization", "cookie", "session", "sessionid", "sessionkey",
  "credential", "credentials", "privatekey", "iban", "ibannumber", "swift", "bic", "routingnumber", "accountnumber", "cardnumber", "pan", "cvv", "cvc", "ssn", "taxid",
  "taxnumber", "tckn", "vkn", "phone", "phonenumber", "email", "emailaddress"];

export function isAyasRevenuePlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === Object.keys(value).length
    && Object.values(Object.getOwnPropertyDescriptors(value)).every((d) => Object.hasOwn(d, "value"));
}
export const hasExactAyasRevenueKeys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean =>
  required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));

/** Plain JSON only: null, booleans, finite numbers, strings, arrays and plain records, within depth and byte bounds. */
export function isAyasRevenueBoundedJson(value: unknown, maxBytes: number, maxDepth = AYAS_REVENUE_LIMITS.jsonDepth): boolean {
  const visit = (v: unknown, depth: number): boolean => {
    if (depth > maxDepth) return false;
    if (v === null || typeof v === "boolean" || typeof v === "string") return true;
    if (typeof v === "number") return Number.isFinite(v);
    if (Array.isArray(v)) return Object.getPrototypeOf(v) === Array.prototype && Reflect.ownKeys(v).length === v.length + 1
      && Object.values(Object.getOwnPropertyDescriptors(v)).every((d) => Object.hasOwn(d, "value")) && v.every((x) => visit(x, depth + 1));
    if (!isAyasRevenuePlainRecord(v)) return false;
    return Object.entries(v).every(([key, x]) => !FORBIDDEN_KEYS.has(key) && visit(x, depth + 1));
  };
  if (!visit(value, 0)) return false;
  return new TextEncoder().encode(JSON.stringify(value)).length <= maxBytes;
}

/** Luhn-valid 13–19 digit runs (spaces or dashes allowed between digits), wherever they start. */
function hasCardNumber(text: string): boolean {
  for (const match of text.matchAll(/(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g)) {
    const digits = match[0].replace(/\D/g, "");
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}
const IBAN = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}(?![A-Za-z0-9])/i;
const US_SSN = /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/;
/** Turkish identity number: 11 digits with its two check digits. */
function hasTckn(text: string): boolean {
  for (const match of text.matchAll(/(?<!\d)[1-9]\d{10}(?!\d)/g)) {
    const d = [...match[0]].map(Number);
    const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!, even = d[1]! + d[3]! + d[5]! + d[7]!;
    if (((odd * 7 - even) % 10 + 10) % 10 === d[9] && d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10]) return true;
  }
  return false;
}
export function isAyasRevenueSensitiveText(text: string): boolean {
  return containsBrainSecret(text) || hasCardNumber(text) || IBAN.test(text) || US_SSN.test(text) || hasTckn(text);
}
/**
 * The whole normalized name, or a name ending in a term (`accessToken`, `customerEmail`, `userSessionId`).
 * A term at the start does not count, so `sessions`, `sessionCount`, `emailOptIn` and `tokenCount` are not refused.
 */
export function isAyasRevenueSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z]/g, "");
  return SENSITIVE_KEY_TERMS.some((term) => k === term || (term.length > 3 && k.endsWith(term)));
}
/**
 * `true` when any key name or any value (string or number) in a JSON value carries sensitive data. Values are scanned
 * once, on the serialized text, so a number and a string are treated alike.
 */
export function containsAyasRevenueSensitiveData(value: unknown): boolean {
  const keys = (v: unknown): boolean => Array.isArray(v) ? v.some(keys)
    : !!v && typeof v === "object" ? Object.entries(v).some(([key, x]) => isAyasRevenueSensitiveKey(key) || keys(x)) : false;
  return keys(value) || isAyasRevenueSensitiveText(JSON.stringify(value) ?? "");
}
/** One read of a caller's value: getters run once, proxies, functions and symbols are refused. */
export function snapshotAyasRevenueValue(raw: unknown): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try { return { ok: true, value: structuredClone(raw) }; } catch { return { ok: false }; }
}
export function deepFreezeAyasRevenueValue<T>(value: T): T {
  if (value && typeof value === "object") { for (const x of Object.values(value)) deepFreezeAyasRevenueValue(x); Object.freeze(value); }
  return value;
}

export const isAyasRevenueTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const isAyasRevenueRequestId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(value);
/** An external identifier: bounded, no separators that could make it a path, nothing sensitive. */
export const isAyasRevenueExternalId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value) && !value.includes("..") && !isAyasRevenueSensitiveText(value);
export const isAyasRevenueErrorCode = (value: unknown): value is string => typeof value === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(value);
export const isAyasRevenuePlatform = (value: unknown): value is AyasRevenuePlatform =>
  typeof value === "string" && (AYAS_REVENUE_PLATFORMS as readonly string[]).includes(value);
export const isAyasRevenueOperation = (value: unknown): value is AyasRevenueOperation =>
  typeof value === "string" && (AYAS_REVENUE_OPERATIONS as readonly string[]).includes(value);

/** A cursor is `<platform>:<operation>:<opaque>`; it is valid only for the same platform and operation. */
export function bindAyasRevenueCursor(platform: AyasRevenuePlatform, operation: AyasRevenueOperation, opaque: unknown): string | null {
  if (typeof opaque !== "string" || !new RegExp(`^[A-Za-z0-9_-]{1,${AYAS_REVENUE_LIMITS.cursorOpaqueChars}}$`).test(opaque)) return null;
  return `${platform}:${operation}:${opaque}`;
}
export function readAyasRevenueCursor(cursor: unknown, platform: AyasRevenuePlatform, operation: AyasRevenueOperation): string | null {
  if (typeof cursor !== "string") return null;
  const prefix = `${platform}:${operation}:`;
  if (!cursor.startsWith(prefix)) return null;
  const opaque = cursor.slice(prefix.length);
  return bindAyasRevenueCursor(platform, operation, opaque) === cursor ? opaque : null;
}
