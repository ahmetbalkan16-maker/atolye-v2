/** Official fields become minimal neutral facts. Learner names, titles, bodies and contacts are discarded. */
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import { isAyasRevenuePlainRecord, isAyasRevenueBoundedJson, deepFreezeAyasRevenueValue, snapshotAyasRevenueValue } from "../../AyasRevenueRedaction";
export const udemyNumericId = (v: unknown): string | null => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v)
  : typeof v === "string" && /^[1-9]\d{0,14}$/.test(v) && Number.isSafeInteger(Number(v)) ? v : null;
export const udemyCount = (v: unknown): v is number => Number.isSafeInteger(v) && !Object.is(v, -0) && (v as number) >= 0 && (v as number) <= 10_000_000;
export function snapshotAyasUdemyWire(raw: unknown): unknown | null {
  try {
    if (!isAyasRevenueBoundedJson(raw, 262_144)) return null;
    const s = snapshotAyasRevenueValue(raw);
    return s.ok && isAyasRevenueBoundedJson(s.value, 262_144) ? deepFreezeAyasRevenueValue(s.value) : null;
  } catch { return null; }
}
const idDigest = (kind: string, id: unknown) => { const valid = udemyNumericId(id); return valid === null ? null : digestAyasRevenueData({ platform: "udemy", kind, id: valid }); };
export function normalizeAyasUdemyCourse(raw: unknown): unknown | null {
  const r = snapshotAyasUdemyWire(raw); if (!isAyasRevenuePlainRecord(r)) return null;
  const courseRefDigest = idDigest("COURSE", r.id);
  if (courseRefDigest === null || typeof r.is_paid !== "boolean" || typeof r.is_published !== "boolean" || !udemyCount(r.num_reviews)
    || typeof r.rating !== "number" || !Number.isFinite(r.rating) || r.rating < 0 || r.rating > 5) return null;
  return Object.freeze({ kind: "COURSE", courseRefDigest, paid: r.is_paid, publicationObserved: r.is_published, reviewCount: r.num_reviews, rating: r.rating,
    economicEvidence: "NONE", grantsAuthority: false });
}
/** Pure projector tested separately; no review API route is guessed from its method name. */
export function normalizeAyasUdemyReview(raw: unknown): unknown | null {
  const r = snapshotAyasUdemyWire(raw); if (!isAyasRevenuePlainRecord(r) || !isAyasRevenuePlainRecord(r.course)) return null;
  const reviewRefDigest = idDigest("REVIEW", r.id), courseRefDigest = idDigest("COURSE", r.course.id);
  if (reviewRefDigest === null || courseRefDigest === null || typeof r.rating !== "number" || !Number.isFinite(r.rating) || r.rating < 0 || r.rating > 5) return null;
  return Object.freeze({ kind: "REVIEW", reviewRefDigest, courseRefDigest, rating: r.rating, economicEvidence: "NONE", grantsAuthority: false });
}
export function normalizeAyasUdemyQuestion(raw: unknown): unknown | null {
  const r = snapshotAyasUdemyWire(raw); if (!isAyasRevenuePlainRecord(r) || !isAyasRevenuePlainRecord(r.course)) return null;
  const questionRefDigest = idDigest("QUESTION", r.id), courseRefDigest = idDigest("COURSE", r.course.id);
  if (questionRefDigest === null || courseRefDigest === null || !udemyCount(r.num_replies) || typeof r.is_read !== "boolean") return null;
  return Object.freeze({ kind: "QUESTION", questionRefDigest, courseRefDigest, replyCount: r.num_replies, read: r.is_read, contentRetention: "DISCARDED", grantsAuthority: false });
}
export function normalizeAyasUdemyThread(raw: unknown): unknown | null {
  const r = snapshotAyasUdemyWire(raw); if (!isAyasRevenuePlainRecord(r)) return null;
  const threadRefDigest = idDigest("THREAD", r.id); if (threadRefDigest === null || typeof r.is_read !== "boolean") return null;
  return Object.freeze({ kind: "MESSAGE_THREAD", threadRefDigest, read: r.is_read, contentRetention: "DISCARDED", grantsAuthority: false });
}
