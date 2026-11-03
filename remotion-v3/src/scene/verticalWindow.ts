import type { V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";
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

/**
 * Something happening on a map from `frame` on (world x of the points it covers; `last`: where it ends — an arrow's
 * head, a march's goal). A Short is told mostly on the map (owner, 3 Nov 2026, after DFT Tarih's Shorts: ~70%), and the
 * window shows only the middle third of a map held still: it follows these as it follows speakers.
 */
export interface MapBeat {
  readonly frame: number;
  readonly xs: readonly number[];
  readonly last: number;
  /** A ruler's badge (index in `badges`) the window follows from this beat on: it sets out, it marches. */
  readonly badge?: number;
}

/** Aims at a map beat carry this id and the beat's index. */
export const MAP_BEAT_ID = "harita:";

/** Beats closer than this (seconds) are one: two arrows drawn on the same line are shown together. */
const BEAT_MERGE_S = 0.3;

/**
 * An army or a ship setting out is shown where it starts, then — after the shortest march (MapView's MARCH_MIN_S) —
 * where it is going, so it walks into the window.
 */
const MOVE_REACH_S = 4.5;

type Pt = { readonly x: number; readonly y: number };

/**
 * A map's beats in time order: arrows drawn, armies, badges and ships appearing and setting out, ships firing or going
 * down, battles flaring, lines and siege works growing, a breach, a conquest sweeping, tokens moving, highlighted,
 * falling or fighting. What stands on the map from its first frame is its first beat: where the window starts.
 */
export function mapBeats(map: V3GeoMap, fps: number): MapBeat[] {
  const raw: { frame: number; points: readonly Pt[]; last?: Pt; badge?: number }[] = [];
  const add = (frame: number | undefined, points: readonly Pt[], more: { last?: Pt; badge?: number } = {}) => {
    if (frame !== undefined && Number.isFinite(frame) && points.length) raw.push({ frame, points, ...more });
  };
  const setOut = (start: number, from: number | undefined, path: readonly Pt[]) => {
    add(start, path.slice(0, 1));
    if (path.length < 2) return;
    const go = from ?? start;
    add(go, path, { last: path[0]! });
    add(go + Math.round(MOVE_REACH_S * fps), path);
  };
  for (const a of map.arrows) add(a.start, a.points);
  for (const a of map.armies) setOut(a.start, a.moveStart, a.path?.length ? [a, ...a.path] : [a]);
  (map.badges ?? []).forEach((b, i) => {
    add(b.start, b.path.slice(0, 1));
    if (b.path.length > 1) add(b.moveStart ?? b.start, b.path, { badge: i });
  });
  for (const v of map.vehicles ?? []) {
    const end = v.path[v.path.length - 1];
    setOut(v.start, v.moveStart, v.path);
    if (v.target && end) add(v.fireStart, [end, v.target]);
    if (end) add(v.lossStart, [end]);
  }
  for (const b of map.battles ?? []) add(b.start, [b]);
  for (const l of map.lines ?? []) add(l.start, l.points);
  for (const s of map.siegeLines ?? []) add(s.start, s.points);
  for (const w of map.close?.walls ?? []) if (w.breach) add(w.breach.start, [w.breach]);
  for (const t of map.territories) if (t.spread?.length && t.labelX !== undefined && t.labelY !== undefined) add(t.start, [{ x: t.labelX, y: t.labelY }]);
  // Tokens: a formation in effect at a frame (the last step begun), its moves, losses and highlights; a fight is
  // everyone's.
  const units = map.units ?? [];
  const stepAt = (u: (typeof units)[number], frame: number) => [...u.steps].reverse().find((s) => s.start <= frame) ?? u.steps[0];
  for (const u of units) {
    u.steps.forEach((s, i) => {
      add(s.start, [...(i > 0 ? u.steps[i - 1]!.points : []), ...s.points]);
      if (s.losses?.length) add(s.start + Math.round(Math.min(...s.losses) * fps), s.points);
    });
    for (const h of u.highlights ?? []) add(h.start, stepAt(u, h.start)?.points ?? []);
  }
  for (const f of map.fights ?? []) add(f.start, units.flatMap((u) => stepAt(u, f.start)?.points ?? []));
  raw.sort((a, b) => a.frame - b.frame);
  // Merged beats: all their points, the end of the latest, the first marching badge (followed).
  const merged: { frame: number; points: Pt[]; last: Pt; badge?: number }[] = [];
  for (const r of raw) {
    const prev = merged[merged.length - 1];
    const last = r.last ?? r.points[r.points.length - 1]!;
    if (prev && r.frame - prev.frame <= BEAT_MERGE_S * fps) {
      prev.points.push(...r.points);
      prev.last = last;
      if (prev.badge === undefined && r.badge !== undefined) prev.badge = r.badge;
    } else merged.push({ frame: r.frame, points: [...r.points], last, ...(r.badge !== undefined ? { badge: r.badge } : {}) });
  }
  return merged.map((m) => ({ frame: m.frame, xs: m.points.map((p) => p.x), last: m.last.x, ...(m.badge !== undefined ? { badge: m.badge } : {}) }));
}

/**
 * Where the window centres for a beat (stage x): the middle of what it covers, but never so far that its end (`last`)
 * leaves the window — a long arrow is seen arriving.
 */
export function beatAim(xs: readonly number[], last: number, winW: number): number {
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const reach = winW * 0.38;
  return Math.min(last + reach, Math.max(last - reach, mid));
}

/** The latest beat begun by `frame` (with the window's lead), else the first: where the window rests on a map. */
export function beatAt(beats: readonly MapBeat[], frame: number, fps: number): number {
  const lead = Math.round(fps * WINDOW_LEAD_S);
  let i = 0;
  while (i + 1 < beats.length && beats[i + 1]!.frame - lead <= frame) i++;
  return i;
}

/**
 * A map shot's aims: its speakers' (badges with a bubble) and its beats. A beat while a badge speaks — or in the pause
 * after — waits: the window stays on the words, and comes back to the map afterwards (to its latest beat).
 */
export function withMapBeats(aims: readonly WindowAim[], beats: readonly MapBeat[], turns: readonly WindowTurn[], fps: number): WindowAim[] {
  if (!beats.length || !aims.length) return [...aims];
  const lead = Math.round(fps * WINDOW_LEAD_S);
  const rest = Math.round(fps * WINDOW_REST_S);
  const busy = (f: number) => turns.some((t) => f >= t.start - lead && f < t.end + rest);
  const isBeat = (a: WindowAim) => (a.castId?.startsWith(MAP_BEAT_ID) ? 0 : 1);
  const beatAims = beats.flatMap((b, i): WindowAim[] => (busy(b.frame) ? [] : [{ frame: b.frame - lead, castId: `${MAP_BEAT_ID}${i}` }]));
  // On the same frame a speaker wins (the later aim is the one held).
  return [aims[0]!, ...[...aims.slice(1), ...beatAims].sort((a, b) => a.frame - b.frame || isBeat(a) - isBeat(b))];
}
