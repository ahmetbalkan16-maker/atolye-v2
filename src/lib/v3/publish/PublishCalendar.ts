import { SHORTS_MAX_S } from "../render/Format";

/**
 * When an approved V3 video goes public. Pure — no network, no files — so the live server (AYAS approving in the
 * conversation) reaches only this and PublishApproval, never the uploader (the action-firewall smoke pins that).
 */

export type VideoKind = "uzun" | "short";

/** An order's length ("60sn", "3dk", "1dk 30") in seconds; at most a minute is a Short. */
export function videoKind(sure: string): VideoKind {
  const m = /^(?:(\d+)\s*dk)?\s*(?:(\d+)\s*(?:sn)?)?$/i.exec(sure.trim());
  const s = m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : NaN;
  return Number.isFinite(s) && s > 0 && s <= SHORTS_MAX_S ? "short" : "uzun";
}

/**
 * The weekly calendar (owner, 2 Nov 2026: "haftada 2 short 1 uzun video", more on the new PC): the long video on
 * Thursday, the Shorts on Tuesday and Saturday, at 15:00 New York time — the American audience's afternoon, 22:00 or
 * 23:00 in Turkey. A slot holds one video; an approved video takes the first free slot of its kind at least two hours
 * away, so three long videos approved in one week go out over three weeks instead of flooding the channel. Since 23 Nov
 * 2026 three Shorts a week, Tuesday, Thursday and Saturday (owner, "bütün planları uygula": Knowledgia's Shorts drew a
 * median 2.9 M views in 2024 at about one a week and fell to 0.87 M when they thinned out; a fixed, steady rhythm). The
 * Thursday Short shares its day with the long video: they go to different shelves (the Shorts feed, the home page).
 */
export const WEEKLY_SLOTS: Readonly<Record<VideoKind, readonly number[]>> = { uzun: [4], short: [2, 4, 6] };
export const SLOT_HOUR_NEW_YORK = 15;

const DAY_NAMES: Readonly<Record<"tr" | "en", readonly string[]>> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  tr: ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"],
};

/**
 * The calendar's days for a kind, as the viewer reads them ("Tue, Thu & Sat"; "Salı, Perşembe ve Cumartesi"), for the
 * channel's subscribe promise (owner, 27 Nov 2026: "neredeyse hiç takip gelmiyor kanalımıza"): the description and the
 * pinned comment promise exactly the days the uploader keeps, from WEEKLY_SLOTS — never a copy that can drift.
 */
export function slotDaysText(kind: VideoKind, dil: "tr" | "en"): string {
  const names = WEEKLY_SLOTS[kind].map((d) => DAY_NAMES[dil][d]!);
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${dil === "en" ? "&" : "ve"} ${names.at(-1)}`;
}
const SLOT_LEAD_MS = 2 * 3_600_000;

function newYorkClock(at: Date): { y: number; m: number; d: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: n("year"), m: n("month"), d: n("day"), h: n("hour"), min: n("minute") };
}

/** The instant of `hour`:00 New York time on that calendar day (EST or EDT, whichever holds that afternoon). */
export function newYorkTime(y: number, m: number, d: number, hour: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hour + 5));
  const c = newYorkClock(guess);
  const behindH = Math.round((guess.getTime() - Date.UTC(c.y, c.m - 1, c.d, c.h, c.min)) / 3_600_000);
  return new Date(Date.UTC(y, m - 1, d, hour + behindH));
}

/** The next free slot of the kind (ISO), skipping slots the other approved/uploaded videos of that kind hold. */
export function nextSlot(kind: VideoKind, taken: readonly string[], now = new Date()): string {
  const busy = taken.map((t) => Date.parse(t)).filter(Number.isFinite);
  const today = newYorkClock(now);
  for (let i = 0; i < 7 * 52; i++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
    if (!WEEKLY_SLOTS[kind].includes(day.getUTCDay())) continue;
    const at = newYorkTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), SLOT_HOUR_NEW_YORK);
    if (at.getTime() < now.getTime() + SLOT_LEAD_MS || busy.some((b) => Math.abs(b - at.getTime()) < 60_000)) continue;
    return at.toISOString();
  }
  throw new Error("YOUTUBE_NO_SLOT: bir yıl içinde boş yayın günü yok");
}

/** A slot in the owner's words: "5 Kasım Perşembe 23:00" (Turkey's time). */
export function slotText(iso: string): string {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", weekday: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
