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

/** From `frame` on the window aims at `castId` — the lead when undefined. The first aim starts the shot. */
export interface WindowAim {
  readonly frame: number;
  readonly castId?: string;
}

export function windowAims(turns: readonly WindowTurn[], fps: number): WindowAim[] {
  const lead = Math.round(fps * WINDOW_LEAD_S);
  const rest = Math.round(fps * WINDOW_REST_S);
  const sorted = [...turns].sort((a, b) => a.start - b.start);
  const aims: WindowAim[] = [{ frame: -Infinity }];
  sorted.forEach((t, i) => {
    // The same speaker again keeps the window where it is.
    if (aims[aims.length - 1]!.castId !== t.castId) aims.push({ frame: t.start - lead, castId: t.castId });
    const next = sorted[i + 1];
    if (!next || next.start - t.end > rest) aims.push({ frame: t.end + Math.round(fps * REST_DELAY_S) });
  });
  return aims;
}

/**
 * The stage x of the window's centre on `frame`. `xOf` gives an aim's x (the lead's, or the stage's middle, for
 * undefined). A glide cut short by the next aim goes on from where the window is, never jumps.
 */
export function windowCentre(aims: readonly WindowAim[], frame: number, fps: number, xOf: (castId: string | undefined) => number): number {
  const pan = Math.max(1, Math.round(fps * WINDOW_PAN_S));
  let from = xOf(aims[0]?.castId);
  let to = from;
  let start = -Infinity;
  const at = (fr: number) => (start === -Infinity ? to : from + (to - from) * easeInOut(Math.min(1, Math.max(0, (fr - start) / pan))));
  for (const aim of aims.slice(1)) {
    if (aim.frame > frame) break;
    from = at(aim.frame);
    to = xOf(aim.castId);
    start = aim.frame;
  }
  return at(frame);
}

/**
 * The frame the window has reached `castId` for words starting at `frame`: the end of the glide toward them, or `frame`
 * when the window was already there (the same speaker, or the lead it was resting on).
 */
export function windowArrival(aims: readonly WindowAim[], castId: string, frame: number, fps: number, xOf: (castId: string | undefined) => number): number {
  const lead = Math.round(fps * WINDOW_LEAD_S);
  let i = aims.length - 1;
  while (i > 0 && aims[i]!.frame > frame + lead) i--;
  const aim = aims[i]!;
  if (i === 0 || aim.castId !== castId || Math.abs(xOf(aims[i - 1]!.castId) - xOf(castId)) < 2) return frame;
  return Math.max(frame, aim.frame + Math.round(fps * WINDOW_PAN_S));
}
