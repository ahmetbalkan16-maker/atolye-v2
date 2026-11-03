import { easeInOut } from "../character/rig";

/**
 * A Short's vertical window over the 16:9 stage (owner, 2 Nov 2026). It follows whoever speaks, gliding to a new speaker
 * a little before the words; while no one speaks — before the shot's first line, and after a line when the next one is
 * more than a pause away — it holds the shot's lead (the first Caesar Short centred between two characters and cut
 * both). A name tag waits until the window has reached its speaker (it used to appear over the last speaker).
 */

/** The window glides to a new aim in this long (seconds), starting a little before the words. */
export const WINDOW_PAN_S = 0.5;
export const WINDOW_LEAD_S = 0.15;
/** Silence after a line longer than this sends the window back to the lead; a reply after a short pause keeps it. */
export const WINDOW_REST_S = 1.2;
/** How long after a line's end the window starts back to the lead. */
const REST_DELAY_S = 0.3;

/** One speaker's words in the shot, in shot frames. */
export interface WindowTurn {
  readonly castId: string;
  readonly start: number;
  readonly end: number;
}

/**
 * From `frame` on the window aims at `castId` — the lead when undefined — together with `partner`, whom they talk with
 * (fixed for the aim, so the window never flips between two neighbours mid-line). The first aim starts the shot.
 */
export interface WindowAim {
  readonly frame: number;
  readonly castId?: string;
  readonly partner?: string;
}

/** The window's x for an aim: who it holds, and with whom. */
export type AimX = (castId: string | undefined, partner?: string) => number;

export function windowAims(turns: readonly WindowTurn[], fps: number): WindowAim[] {
  const lead = Math.round(fps * WINDOW_LEAD_S);
  const rest = Math.round(fps * WINDOW_REST_S);
  const sorted = [...turns].sort((a, b) => a.start - b.start);
  // A turn's partner: the one who spoke (or acted) before it, else the next one after it.
  const partnerOf = (i: number) => [...sorted.slice(0, i).reverse(), ...sorted.slice(i + 1)].find((o) => o.castId !== sorted[i]!.castId)?.castId;
  // Before anyone speaks the window rests with the first speaker already in it (no glide in the first half second).
  const aims: WindowAim[] = [{ frame: -Infinity, ...(sorted[0] ? { partner: sorted[0].castId } : {}) }];
  sorted.forEach((t, i) => {
    // The same speaker again keeps the window where it is.
    if (aims[aims.length - 1]!.castId !== t.castId) aims.push({ frame: t.start - lead, castId: t.castId, ...(partnerOf(i) ? { partner: partnerOf(i)! } : {}) });
    const next = sorted[i + 1];
    if (!next || next.start - t.end > rest) aims.push({ frame: t.end + Math.round(fps * REST_DELAY_S), partner: t.castId });
  });
  return aims;
}

/**
 * The stage x of the window's centre on `frame`. `xOf` gives an aim's x (the lead's, or the stage's middle, for
 * undefined). A glide cut short by the next aim goes on from where the window is, never jumps.
 */
export function windowCentre(aims: readonly WindowAim[], frame: number, fps: number, xOf: AimX): number {
  const pan = Math.max(1, Math.round(fps * WINDOW_PAN_S));
  let from = xOf(aims[0]?.castId, aims[0]?.partner);
  let to = from;
  let start = -Infinity;
  const at = (fr: number) => (start === -Infinity ? to : from + (to - from) * easeInOut(Math.min(1, Math.max(0, (fr - start) / pan))));
  for (const aim of aims.slice(1)) {
    if (aim.frame > frame) break;
    from = at(aim.frame);
    to = xOf(aim.castId, aim.partner);
    start = aim.frame;
  }
  return at(frame);
}

/** A character's half width on the screen (body and open arms) from its head's radius. */
export const BODY_PER_HEAD = 1.3;

/**
 * Where the window centres to show `x` (the speaker's or the lead's head): between it and the nearest other on stage, so
 * the two are seen together (owner review, 3 Nov 2026: Caesar pointed out of the Short's frame at a pirate it never
 * showed). `x` always stays whole in the window; a partner too far for both is shown as far as it goes, and one a whole
 * window away no longer pulls (smoothly, so the window never jumps while people move).
 */
export function pairAim(x: number, half: number, others: readonly { readonly x: number }[], winW: number): number {
  const other = [...others].sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
  if (!other) return x;
  const lo = x + half - winW / 2;
  const hi = x - half + winW / 2;
  if (lo > hi) return x;
  const mid = Math.min(hi, Math.max(lo, (x + other.x) / 2));
  const pull = Math.min(1, Math.max(0, (1.3 * winW - Math.abs(other.x - x)) / (0.4 * winW)));
  return x + (mid - x) * pull;
}

/**
 * The frame the window starts away from `castId` after their words starting at `frame` (to another speaker, or back
 * to the lead when that is someone else); Infinity when it stays. A name tag ends there (the Caesar remake: the friend's
 * tag hung on while the window glided to Caesar).
 */
export function windowDeparture(aims: readonly WindowAim[], castId: string, frame: number, fps: number, xOf: AimX): number {
  const lead = Math.round(fps * WINDOW_LEAD_S);
  // Where the window is for these words: the aim in effect then.
  const now = [...aims].reverse().find((a) => a.frame <= frame + lead);
  const here = now && now.frame !== -Infinity ? xOf(now.castId, now.partner) : xOf(castId);
  const next = aims.find((a) => a.frame > frame + lead && Math.abs(xOf(a.castId, a.partner) - here) >= 2);
  return next?.frame ?? Infinity;
}

/**
 * The frame the window has reached `castId` for words starting at `frame`: the end of the glide toward them, or `frame`
 * when the window was already there (the same speaker, or the lead it was resting on).
 */
export function windowArrival(aims: readonly WindowAim[], castId: string, frame: number, fps: number, xOf: AimX): number {
  const lead = Math.round(fps * WINDOW_LEAD_S);
  let i = aims.length - 1;
  while (i > 0 && aims[i]!.frame > frame + lead) i--;
  const aim = aims[i]!;
  if (i === 0 || aim.castId !== castId || Math.abs(xOf(aims[i - 1]!.castId, aims[i - 1]!.partner) - xOf(aim.castId, aim.partner)) < 2) return frame;
  return Math.max(frame, aim.frame + Math.round(fps * WINDOW_PAN_S));
}
