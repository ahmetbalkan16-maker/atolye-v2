import type { ReactNode } from "react";
import type { V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";
import { badgeExtent } from "./hudLayout";
import { cameraAt } from "./mapCamera";

/**
 * The close battle map seen from a tilted camera (owner, 12 Nov 2026: "Kings and Generals"-like — the ground and the
 * armies in slight perspective, the far side smaller, the names and badges upright and readable; on by default since
 * 13 Nov 2026, "düzeltip aç"). Pure geometry for MapView and the smokes: a point of the flat map picture (the picture
 * MapView draws without tilt, W×H, after the map's own camera) goes to the screen through the same 4×4 matrix the
 * browser applies to the tilted ground (`tiltMatrix`), so an upright name lands exactly on its place on the tilted ground.
 *
 * The camera turns about the picture's middle. `tiltFor` keeps the whole framed picture in the frame (its near edge as
 * wide as the frame — the armies then ~13 % smaller in the middle); `tiltAt` instead frames the action (owner: "ordu
 * sayısı daha fazla gözüksün"): the armies at least as large as on the flat map, the action and the speakers' badges
 * whole in the frame, the empty near corners cropped, and the ground beyond the picture filling the rest — never a sky.
 * Upright things are drawn at their depth's size but never larger than on the flat map (`uprightScale`).
 */

/** Perspective distance in frame heights: the far edge of the framed picture about 0.75× the near edge's size at 30°. */
export const TILT_PERSPECTIVE_H = 1.6;
/** A steeper camera shows the ground too flat and needs far too much land beyond the framed picture. */
export const MAX_TILT_DEG = 40;

export interface Tilt {
  /** The frame (= the flat picture) size. */
  readonly W: number;
  readonly H: number;
  /** The ground's turn from straight down (degrees, 0..MAX_TILT_DEG). */
  readonly deg: number;
  /** Perspective distance (px). */
  readonly P: number;
  /** The plane's scale before the turn, so the framed picture's near edge is as wide as the frame. */
  readonly s: number;
  /** The screen height the picture's middle row lands on (the framed picture centred in the frame). */
  readonly ys: number;
  /** The picture's column at the frame's middle (W/2; tiltAt pans it to keep the action whole, the far side's lines still meeting over the middle). */
  readonly cx: number;
}

type Pt = { x: number; y: number };
type Box = { x0: number; y0: number; x1: number; y1: number };

/** The tilt for a frame: the scale and height that keep the whole framed picture in the frame, centred. */
export function tiltFor(deg: number, W: number, H: number): Tilt {
  const d = Math.max(0, Math.min(MAX_TILT_DEG, deg));
  const th = (d * Math.PI) / 180;
  const P = TILT_PERSPECTIVE_H * H;
  const a0 = ((H / 2) * Math.sin(th)) / P;
  // The near edge (the picture's bottom, nearest the eye) is the widest: s/(1 − s·a0) = 1 there.
  const s = 1 / (1 + a0);
  const half = (s * Math.cos(th) * H) / 2;
  const top = half / (1 + s * a0);
  const bottom = half / (1 - s * a0);
  return { W, H, deg: d, P, s, ys: H / 2 - (bottom - top) / 2, cx: W / 2 };
}

/** The homogeneous divisor at a picture row (> 0 everywhere on the drawn ground: the horizon lies far above). */
function depth(t: Tilt, y: number): number {
  return 1 - (t.s * Math.sin((t.deg * Math.PI) / 180) * (y - t.H / 2)) / t.P;
}

/**
 * A flat-picture point on the screen through the tilted camera, how large things there look across (`scale`, 1 = as
 * flat) and how much a short upward or downward step on the ground shortens there (`scaleY`: the foreshortening too).
 */
export function tiltProject(t: Tilt, x: number, y: number): Pt & { scale: number; scaleY: number } {
  const w = depth(t, y);
  const c = Math.cos((t.deg * Math.PI) / 180);
  return { x: t.W / 2 + (t.s * (x - t.cx)) / w, y: t.ys + (t.s * c * (y - t.H / 2)) / w, scale: t.s / w, scaleY: (t.s * c) / (w * w) };
}

/** The flat-picture point a screen point shows on the tilted ground (tiltProject's inverse). */
export function tiltUnproject(t: Tilt, X: number, Y: number): Pt {
  const th = (t.deg * Math.PI) / 180;
  const dy = Y - t.ys;
  const yc = dy / (t.s * Math.cos(th) + (dy * t.s * Math.sin(th)) / t.P);
  const w = 1 - (t.s * Math.sin(th) * yc) / t.P;
  return { x: t.cx + ((X - t.W / 2) * w) / t.s, y: t.H / 2 + yc };
}

/**
 * The flat-picture rectangle a screen rectangle shows of the tilted ground, both ways: `cover` holds every point seen
 * (the ground to draw), `inside` is surely seen whole (names slid into it stay in the frame). The far (top) row of the
 * screen shows the widest strip of ground, the near (bottom) row the narrowest.
 */
export function tiltSeen(t: Tilt, r: Box): { cover: Box; inside: Box } {
  const tl = tiltUnproject(t, r.x0, r.y0);
  const tr = tiltUnproject(t, r.x1, r.y0);
  const bl = tiltUnproject(t, r.x0, r.y1);
  const br = tiltUnproject(t, r.x1, r.y1);
  // Surely seen: no lower than the rectangle's own bottom row of the flat picture (the frame's ground below the framed
  // picture is a narrow strip), as wide as the screen shows that row.
  const y1 = Math.min(bl.y, r.y1);
  const Y = tiltProject(t, t.W / 2, y1).y;
  const l = tiltUnproject(t, r.x0, Y);
  const rr = tiltUnproject(t, r.x1, Y);
  return {
    cover: { x0: Math.min(tl.x, bl.x), x1: Math.max(tr.x, br.x), y0: tl.y, y1: bl.y },
    inside: { x0: Math.max(tl.x, l.x), x1: Math.min(tr.x, rr.x), y0: tl.y, y1 },
  };
}

/**
 * The CSS `matrix3d` of the tilted ground: an element whose own (0, 0) is the flat picture's (−ox, −oy), drawn with
 * `transform-origin: 0 0`. The same mapping as tiltProject (z = 0), as a full invertible 4×4 (rotation about x, uniform
 * scale, perspective), column-major as CSS wants it.
 */
export function tiltMatrix(t: Tilt, ox: number, oy: number): number[] {
  const th = (t.deg * Math.PI) / 180;
  const sin = Math.sin(th);
  const cos = Math.cos(th);
  const A = (t.s * sin) / t.P;
  const B = (t.s * cos) / t.P;
  const cx = ox + t.cx;
  const cy = oy + t.H / 2;
  const w0 = 1 + A * cy;
  // Rows acting on (x, y, z, 1): screen x·w, screen y·w, depth, w.
  const rx = [t.s, -(t.W / 2) * A, -(t.W / 2) * B, -t.s * cx + (t.W / 2) * w0];
  const ry = [0, t.s * cos - t.ys * A, -t.s * sin - t.ys * B, -t.s * cos * cy + t.ys * w0];
  const rz = [0, t.s * sin, t.s * cos, -t.s * sin * cy];
  const rw = [0, -A, -B, w0];
  return [0, 1, 2, 3].flatMap((j) => [rx[j]!, ry[j]!, rz[j]!, rw[j]!]);
}

/** A point through a column-major 4×4 (z = 0), as the browser does: for the smoke's check that matrix and projection agree. */
export function applyMatrix(m: readonly number[], x: number, y: number): Pt {
  const X = m[0]! * x + m[4]! * y + m[12]!;
  const Y = m[1]! * x + m[5]! * y + m[13]!;
  const w = m[3]! * x + m[7]! * y + m[15]!;
  return { x: X / w, y: Y / w };
}

/**
 * How large an upright name, badge or flag is drawn where the ground has a scale (`tiltProject`'s): its depth's size —
 * the far side's smaller — but never larger than on the flat map (near the camera the ground grows past 1).
 */
export function uprightScale(p: { scale: number }): number {
  return Math.min(1, p.scale);
}

/**
 * How much room an upright drawing at a flat-picture point takes of the flat picture, against its size on the flat map,
 * across (`fx`) and up the foreshortened ground (`fy`): its screen size over the ground's scale there. Label avoidance
 * works on the flat picture (world px), so a name's box there is its flat box times these (Cannae trial, 13 Nov 2026:
 * flat-sized boxes let "BATTLE OF CANNAE" settle on Maharbal's badge near the far edge).
 */
export function tiltRoom(t: Tilt, x: number, y: number): { fx: number; fy: number } {
  const p = tiltProject(t, x, y);
  const u = uprightScale(p);
  return { fx: u / p.scale, fy: u / p.scaleY };
}

/**
 * Something the tilted camera keeps whole in the frame: a flat-picture point and its drawing round it on the screen
 * (px at scale 1): `l`/`r` across, `u`/`d` up and down. `ground`: drawn on the tilted ground (an army's block, foreshortened
 * with it), else upright (a badge, at `uprightScale`).
 */
export interface TiltItem {
  readonly x: number;
  readonly y: number;
  readonly l: number;
  readonly r: number;
  readonly u: number;
  readonly d: number;
  readonly ground?: boolean;
}

/**
 * How large the armies look on the tilted map against the flat one (owner: "ordu sayısı daha fazla gözüksün"): every
 * block at least this wide, and the blocks' mean area (across × up the foreshortened ground) at least this.
 */
export const TILT_ARMY_GAIN = 1;
/** The camera never comes closer than this (the plane's scale). */
const MAX_TILT_SCALE = 1.35;
/**
 * How far past the framed picture the map's world reaches on every side (fractions of the picture): MapBuilder's
 * TILT_WORLD_SPAN 1.5 → a quarter. The frame's top and bottom rows never show ground beyond it (only sea is drawn there).
 */
export const TILT_WORLD_PAST = 0.25;

/**
 * How much ShotView's set camera and slow push may enlarge the map's picture about the frame's middle (the push and
 * the 3 % overscan, ~1.07 on a map shot): what the tilted camera keeps whole is kept inside the frame shrunk by this.
 */
export const TILT_SHOT_PUSH = 1.08;
/** The atlas corner ShotView draws at the bottom left (compass and scale bar), 1080p px (CloseLabels' CORNER). */
export const ATLAS_CORNER = { x0: 50, x1: 360, up: 275 } as const;

/**
 * The part of the flat picture (W×H, its `view` shown on the output frame `out`) the tilted camera shows under the atlas
 * corner: a name slid there moves up off it (MapView; Baghdad s2, 14 Nov 2026: the near rows' enlarged ground put
 * "MEDITERRANEAN SEA", clear of the scale bar on the flat map, on it once tilted).
 */
export function atlasCornerSeen(t: Tilt, view: Box, out: { readonly width: number; readonly height: number }): Box {
  const u = Math.min(out.width, out.height) / 1080;
  const fx = (x: number) => view.x0 + (x / out.width) * (view.x1 - view.x0);
  const fy = (y: number) => view.y0 + (y / out.height) * (view.y1 - view.y0);
  return tiltSeen(t, { x0: fx(ATLAS_CORNER.x0 * u), x1: fx(ATLAS_CORNER.x1 * u), y0: fy(out.height - ATLAS_CORNER.up * u), y1: fy(out.height) }).cover;
}

/**
 * The tilt that frames `items` (flat-picture px): the plane's scale as large as needed for the armies (the `ground`
 * items, else all) to look at least as large as on the flat map (TILT_ARMY_GAIN: each block as wide, the blocks' mean
 * area as large) — less if that would cut an item, never less than `tiltFor`'s (the whole picture). Kept whole means inside the frame the shot's push
 * leaves (TILT_SHOT_PUSH) less `margin` — or as near the edge as the flat map had it — and no further onto the atlas
 * corner than `tiltFor`'s tilt puts it. The picture pans across as little as that needs (the far side's lines still
 * meet over the frame's middle) and the items are centred up and down, as far as the world's ground reaches.
 * Without items, `tiltFor`'s tilt.
 */
export function tiltFit(deg: number, W: number, H: number, items: readonly TiltItem[], margin = 0.03 * H): Tilt {
  const base = tiltFor(deg, W, H);
  if (!items.length) return base;
  const th = (base.deg * Math.PI) / 180;
  const sin = Math.sin(th);
  const cos = Math.cos(th);
  const P = base.P;
  const w = (s: number, y: number) => 1 - (s * sin * (y - H / 2)) / P;
  // A flat row's screen height with ys = 0.
  const rel = (s: number, y: number) => (s * cos * (y - H / 2)) / w(s, y);
  // The frame left for the items once the shot has pushed in (or as near the edge as the flat map had them), and the
  // atlas corner's place in it.
  const inX = (W / 2 - margin) / TILT_SHOT_PUSH;
  const inY = (H / 2 - margin) / TILT_SHOT_PUSH;
  const lim = {
    x0: Math.min(W / 2 - inX, ...items.map((it) => it.x - it.l)),
    x1: Math.max(W / 2 + inX, ...items.map((it) => it.x + it.r)),
    y0: Math.min(H / 2 - inY, ...items.map((it) => it.y - it.u)),
    y1: Math.max(H / 2 + inY, ...items.map((it) => it.y + it.d)),
  };
  const u = H / 1080;
  const corner = { x0: W / 2 + (ATLAS_CORNER.x0 * u - W / 2) / TILT_SHOT_PUSH, x1: W / 2 + (ATLAS_CORNER.x1 * u - W / 2) / TILT_SHOT_PUSH, top: H / 2 + (H - ATLAS_CORNER.up * u - H / 2) / TILT_SHOT_PUSH };
  // For a scale and a pan: each item's screen box (y with ys = 0); the pans that keep every item inside across.
  const each = (s: number) =>
    items.map((it) => {
      const d = w(s, it.y);
      const sc = s / d;
      const sx = it.ground ? sc : Math.min(1, sc);
      const sy = it.ground ? (s * cos) / (d * d) : Math.min(1, sc);
      const Y = rel(s, it.y);
      // X = W/2 + s(x − cx)/d: inside [lim.x0, lim.x1] for cx in [lo, hi].
      return { d, top: Y - it.u * sy, bottom: Y + it.d * sy, lo: it.x - ((lim.x1 - W / 2 - it.r * sx) * d) / s, hi: it.x - ((lim.x0 - W / 2 + it.l * sx) * d) / s, left: (cx: number) => W / 2 + (s * (it.x - cx)) / d - it.l * sx, right: (cx: number) => W / 2 + (s * (it.x - cx)) / d + it.r * sx };
    });
  // The far rows see W/2·w/s either side of the pan: never past the world's ground (TILT_WORLD_PAST).
  const panRoom = (s: number) => (W / 2) * (w(s, -H * TILT_WORLD_PAST) / s);
  const fit = (s: number, cornerAllowance: number) => {
    const e = each(s);
    const cx = Math.max(-W * TILT_WORLD_PAST + panRoom(s), ...e.map((q) => q.lo));
    const cxHi = Math.min(W * (1 + TILT_WORLD_PAST) - panRoom(s), ...e.map((q) => q.hi));
    if (cx > cxHi + 1e-6) return undefined;
    const pan = Math.min(cxHi, Math.max(cx, W / 2));
    const top = Math.min(...e.map((q) => q.top));
    const bottom = Math.max(...e.map((q) => q.bottom));
    const overCorner = Math.max(-Infinity, ...e.filter((q) => q.left(pan) < corner.x1 && q.right(pan) > corner.x0).map((q) => q.bottom));
    // The world's ground under the frame's top and bottom rows (TILT_WORLD_PAST); the items inside; the corner.
    const lo = Math.max(H - rel(s, H * (1 + TILT_WORLD_PAST)), lim.y0 - top);
    const hi = Math.min(-rel(s, -H * TILT_WORLD_PAST), lim.y1 - bottom, corner.top + cornerAllowance - overCorner);
    return lo <= hi + 1e-6 ? { lo, hi: Math.max(lo, hi), mid: H / 2 - (top + bottom) / 2, cx: pan, overCorner } : undefined;
  };
  // How far an item already reaches onto the atlas corner with the whole picture in the frame (tiltFor): no further.
  const at0 = fit(base.s, Infinity);
  if (!at0) return base;
  const allowance = Math.max(0, base.ys + at0.overCorner - corner.top);
  const room = (s: number) => fit(s, allowance);
  if (!room(base.s)) return base;
  // The scale that shows the armies TILT_ARMY_GAIN as large: the farthest block as wide (s / w = gain there), the
  // blocks' mean area (s² cos / w³) as large.
  const army = items.some((it) => it.ground) ? items.filter((it) => it.ground) : items;
  const large = (s: number) => army.every((it) => s / w(s, it.y) >= TILT_ARMY_GAIN) && army.reduce((a, it) => a + (s * s * cos) / w(s, it.y) ** 3, 0) / army.length >= TILT_ARMY_GAIN;
  let want = MAX_TILT_SCALE;
  if (large(base.s)) want = base.s;
  else if (large(MAX_TILT_SCALE)) {
    let lo = base.s;
    for (let i = 0; i < 24; i++) {
      const m = (lo + want) / 2;
      if (large(m)) want = m;
      else lo = m;
    }
  }
  let s = base.s;
  if (want > base.s) {
    if (room(want)) s = want;
    else {
      let lo = base.s;
      let hi = want;
      for (let i = 0; i < 24; i++) {
        const m = (lo + hi) / 2;
        if (room(m)) lo = m;
        else hi = m;
      }
      s = lo;
    }
  }
  const r = room(s)!;
  return { W, H, deg: base.deg, P, s, ys: Math.min(r.hi, Math.max(r.lo, r.mid)), cx: r.cx };
}

/** An army's block and the room round it on the screen (1080p px): the token, its spacing and its dust. */
const UNIT_ROOM_1080 = 56;
/** A battle's crossed swords (1080p px). */
const SWORDS_ROOM_1080 = 52;
/** An army's marker on a wider map: its flag box 46 px over the place and its name over that (MapView), 1080p px. */
const ARMY_MARK_UP_1080 = 150;
/** A ship's or other vehicle's token and its wake round its place (1080p px). */
const VEHICLE_ROOM_1080 = 44;
/**
 * A group's further ships stand in a wedge behind the first (MapVehicles: each row 1.5 tokens back, 1.1 aside; 30 px a
 * token): this much more room round its place per row (Guadalcanal s2, 14 Nov 2026: the tilt kept the US flagship and cut
 * the four ships behind it at the right edge).
 */
const VEHICLE_ROW_1080 = 45;
/** A campaign arrow's base and head (1080p px). */
const ARROW_END_1080 = 36;
/** A speaking badge swells up to this (MapView's talkSwell). */
const BADGE_SWELL = 1.14;

/**
 * What the tilted camera keeps in the frame while the map's camera rests on each of its keys: the armies in every
 * formation they take before the next key, the badges that speak then and the battles marked by then — each where the
 * key's view puts it on the flat picture (things outside that picture are not in the flat frame either).
 */
export function tiltItems(map: V3GeoMap, fps: number, W: number, H: number): { frame: number; items: TiltItem[] }[] {
  const world = map.world ?? { width: W, height: H };
  const keys = map.camera?.length ? [...map.camera].sort((a, b) => a.frame - b.frame) : [{ frame: 0, x: world.width / 2, y: world.height / 2, zoom: 1 }];
  const u = H / 1080;
  const relief = Boolean(map.relief);
  return keys.map((key, i) => {
    const from = i ? key.frame : -Infinity;
    const to = keys[i + 1]?.frame ?? Infinity;
    const items: TiltItem[] = [];
    // `partly`: kept when any of its drawing is in the flat frame (a speaker's badge standing over a place just below the
    // frame: Taranto s2's Cunningham, whose words then pointed at nothing once tilted), no further out than flat.
    const add = (x: number, y: number, l: number, r: number, up: number, d: number, ground?: boolean, partly?: boolean) => {
      const p = { x: W / 2 + key.zoom * (x - key.x), y: H / 2 + key.zoom * (y - key.y) };
      if (partly ? p.x + r < 0 || p.x - l > W || p.y + d < 0 || p.y - up > H : p.x < 0 || p.x > W || p.y < 0 || p.y > H) return;
      items.push({ ...p, l, r, u: up, d, ...(ground ? { ground } : {}) });
    };
    for (const unit of map.units ?? [])
      unit.steps.forEach((st, j) => {
        const end = unit.steps[j + 1]?.start ?? Infinity;
        if (st.start >= to || end <= from) return;
        const room = UNIT_ROOM_1080 * u;
        for (const p of st.points) add(p.x, p.y, room, room, room, room, true);
      });
    for (const b of map.badges ?? []) {
      if (!(b.talk?.speaking ?? []).some((s) => s.start < to && s.end > from)) continue;
      const ext = badgeExtent(b.label, relief);
      for (const p of b.path) add(p.x, p.y, ext.half * BADGE_SWELL * u, ext.half * BADGE_SWELL * u, ext.up * BADGE_SWELL * u, 6 * u, false, true);
    }
    // A wider map's action (13 Nov 2026, tilted medium maps): the armies' markers where they stand and march to (upright: the
    // flag box and its name over the place), the vehicles along their routes (on the ground, like the blocks), and the
    // campaign arrows' ends.
    for (const a of map.armies ?? []) {
      if (a.start >= to) continue;
      const half = Math.max(48, (a.label.length * (relief ? 0.58 : 0.78) * 34) / 2) * u;
      for (const p of [a, ...(a.path ?? [])]) add(p.x, p.y, half, half, ARMY_MARK_UP_1080 * u, 8 * u);
    }
    for (const v of map.vehicles ?? []) {
      if (v.start >= to || (v.end !== undefined && v.end <= from)) continue;
      const room = (VEHICLE_ROOM_1080 + Math.ceil((Math.max(1, v.count) - 1) / 2) * VEHICLE_ROW_1080) * u;
      for (const p of v.path) add(p.x, p.y, room, room, room, room, true);
    }
    for (const ar of map.arrows ?? []) {
      if (ar.plan || ar.start >= to || (ar.end !== undefined && ar.end <= from) || ar.points.length < 2) continue;
      for (const p of [ar.points[0]!, ar.points[ar.points.length - 1]!]) add(p.x, p.y, ARROW_END_1080 * u, ARROW_END_1080 * u, ARROW_END_1080 * u, ARROW_END_1080 * u);
    }
    // ...and a ruler's badge marching its route there (Baghdad s2, 14 Nov 2026: Murad IV's march from Istanbul is the
    // action; framed on the speakers only, the tilt cut Istanbul and the route's start off): its whole route, upright.
    if (!map.close)
      for (const b of map.badges ?? []) {
        if (b.path.length < 2 || b.start >= to || (b.end !== undefined && b.end <= from)) continue;
        const ext = badgeExtent(b.label, relief);
        for (const p of b.path) add(p.x, p.y, ext.half * u, ext.half * u, ext.up * u, 6 * u);
      }
    for (const b of map.battles ?? []) {
      if (b.start >= to) continue;
      add(b.x, b.y, SWORDS_ROOM_1080 * u, SWORDS_ROOM_1080 * u, SWORDS_ROOM_1080 * u, SWORDS_ROOM_1080 * u);
      // Its name where placeCloseLabels put it (an offset kept on the screen, MapView's spotAt): the scene's title.
      const sp = b.labelSpot;
      if (!sp) continue;
      const two = b.label.length > 12 && b.label.includes(" ");
      const hx = ((two ? Math.ceil(b.label.length / 2) + 2 : b.label.length) * (relief ? 0.58 : 0.78) * 30) / 2;
      const hy = ((two ? 2 : 1) * 30 * (relief ? 0.98 : 1.1)) / 2;
      add(sp.x, sp.y, (hx - sp.dx) * u, (hx + sp.dx) * u, (hy - sp.dy) * u, (hy + sp.dy) * u);
    }
    return { frame: key.frame, items };
  });
}

const fitted = new WeakMap<V3GeoMap, { key: string; keys: { frame: number; s: number; ys: number; cx: number }[] }>();

/**
 * How long the camera takes to tilt from straight down into the 2.5D view, or back (owner, 13 Nov 2026: "bu iki görünüşü
 * de kullansın" — a map opening straight down over its borders glides into the tilt as the armies move, no cut).
 */
export const TILT_GLIDE_S = 1.5;

/** Smooth start and stop (the glide's ease). */
const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/**
 * How far into its tilt the map's camera is at a frame (V3GeoMap.tiltViews): 0 straight down, 1 the full tilt, gliding
 * TILT_GLIDE_S between — from where it is, so a change that comes mid-glide turns it without a jump. 1 all through with
 * no views; 0 on a flat map.
 */
export function tiltShare(map: Pick<V3GeoMap, "tilt" | "tiltViews">, frame: number, fps: number): number {
  if (!map.tilt) return 0;
  const views = [...(map.tiltViews ?? [])].sort((a, b) => a.frame - b.frame);
  if (!views.length) return 1;
  const glide = Math.max(1, fps * TILT_GLIDE_S);
  let from = views[0]!.on ? 1 : 0;
  let to = from;
  let start = -Infinity;
  const at = (f: number) => (start === -Infinity ? to : from + (to - from) * smooth((f - start) / glide));
  for (const v of views.slice(1)) {
    if (v.frame > frame) break;
    from = at(v.frame);
    to = v.on ? 1 : 0;
    start = v.frame;
  }
  return at(frame);
}

/**
 * The tilted camera at a frame (undefined on a flat map, and where the map is seen straight down: tiltShare 0, drawn
 * exactly as a flat map): each camera key's own fit (`tiltFit` of `tiltItems`), held while the map's camera rests there
 * and carried to the next key along the camera's own glide (the same ease, the scale in log space like the zoom), so the
 * frame never jumps; partway into a glide from straight down (tiltShare) the angle, the scale (log space), the height and
 * the pan go that share of the way from the flat picture (deg 0, s 1, the picture centred) to that fit. Pure in the frame;
 * MapView, ShotView's speech bubbles (badgeAnchor) and its atlas corner ask the same.
 */
export function tiltAt(map: V3GeoMap, frame: number, fps: number, W: number, H: number): Tilt | undefined {
  if (!map.tilt) return undefined;
  const share = tiltShare(map, frame, fps);
  if (share <= 0) return undefined;
  const id = `${map.tilt}|${fps}|${W}|${H}`;
  let f = fitted.get(map);
  if (!f || f.key !== id) {
    f = { key: id, keys: tiltItems(map, fps, W, H).map((k) => ({ frame: k.frame, ...pick(tiltFit(map.tilt!, W, H, k.items)) })) };
    fitted.set(map, f);
  }
  const base = tiltFor(map.tilt, W, H);
  const v = cameraAt(f.keys.map((k) => ({ frame: k.frame, x: k.ys, y: k.cx, zoom: k.s })), frame, fps, W, H);
  if (share >= 1) return { ...base, s: v.zoom, ys: v.x, cx: v.y };
  return { ...base, deg: base.deg * share, s: Math.exp(Math.log(v.zoom) * share), ys: H / 2 + (v.x - H / 2) * share, cx: W / 2 + (v.y - W / 2) * share };
}

const pick = (t: Tilt) => ({ s: t.s, ys: t.ys, cx: t.cx });

/**
 * How a name, a badge or a flag is drawn on the tilted map: given its place (world px) and its drawing, the drawing
 * moved upright to where the place lands on the tilted ground (MapView's upright layer), nothing (the tilted ground
 * layer), or — absent — the drawing as it is (the flat map, unchanged).
 */
export type Up = (x: number, y: number, node: ReactNode) => ReactNode;

/**
 * Which of a tilted map's two layers a part is drawn for (MapView): the tilted ground (no upright names), or the
 * upright layer (only them — the ground is not drawn twice); absent, a flat map (everything).
 */
export type TiltLayer = "ground" | "upright";
