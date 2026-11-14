import { CLOSE_MAP_MAX_KM, type SceneMap } from "../episode/EpisodeTypes";
import type { V3GeoMap } from "../render/RenderPlanTypes";
import { SHORTS_SIZE } from "../render/Format";
import { BADGE_STEP_PX, mapNameBoxes, mapOnScreen, mapTilt, mapWorld, type MapWorld, shipReachPx, VEHICLE_TOKEN_PX } from "./MapBuilder";
import { CLOSE_MIN_ZOOM_KM } from "./RouteZoom";

/**
 * A Short's map framed on what acts in each line (owner's standing verdict: "no enactment on the map; the viewer must live
 * the moment"). The Taranto Short (11 Nov 2026, s5/s6) showed mostly empty sea: a Short sees a 1080-px-wide third of the
 * 16:9 map (ShotView's vertical window), and the camera stops — the map's own and RouteZoom's, both chosen for the whole
 * width — left the planes cut at the top corner (their wedge reached 0 px from the frame's top), put the second wave
 * 1,100 stage px off the stage, and the window then followed them into an empty field. Pure: no file, no model.
 */

/** The part of the 16:9 stage a frame shows: `width` share of its width, all of its height; `aspect` = stage h / w. */
export interface FrameWindow {
  readonly width: number;
  readonly aspect: number;
}

/** The whole 16:9 stage as a frame window (a long video, or a Short laid out on the full frame). */
export function fullStage(width: number, height: number): FrameWindow {
  return { width: 1, aspect: height / width };
}

/** A Short's window over the 1920×1080 stage: 1080 px of 1080·1920/1080 ≈ 607 stage px, a 0.316 share. */
export function shortWindow(stage: { readonly width: number; readonly height: number }, output: { readonly width: number; readonly height: number }): FrameWindow {
  return { width: Math.min(1, (output.width / output.height) * (stage.height / stage.width)), aspect: stage.height / stage.width };
}

/** What acts keeps at least this share of the window clear on each side (more when its drawing reaches further). */
export const FRAME_MARGIN = 0.12;
/** Action filling less than this share of the window (both ways) on a close map is a speck: the camera moves in. */
export const TINY_SHARE = 0.2;
/** A badge's ring and its parchment name reach ~70 px round its place (1080p). */
export const BADGE_REACH_PX = 70;
/** No drawing's reach takes more than this share of the window per side (else nothing would fit). */
const MAX_REACH_SHARE = 0.35;

type Pt = readonly [number, number];

/** A place that acts, and how far its drawing reaches round it on the screen (px at 1080p, the tokens' fixed size). */
export interface ActingPlace {
  readonly at: Pt;
  readonly reach: number;
  /**
   * How far (km) its drawing may stand off `at`: a close map's badge is moved a step off what it hides (MapBuilder,
   * BADGE_STEP_PX in the map's own view) — the Taranto Short's s5 at 16.9 s: the admiral's badge stepped off the planes'
   * end, the window followed it and the second wave was cut (92% in the frame).
   */
  readonly driftKm?: number;
}

/**
 * The places that act or are named in line `line` of a map: a vehicle or an army appearing (where it stands), setting out
 * (where it starts and where its route ends), losing some (where it is by then), firing (it and its target); a unit's
 * formation of that line; a badge appearing or travelling; a battle flaring. Each with its drawing's reach: a group of
 * six planes trails its leader in a wedge ~150 px deep, a quarter of a Short's window.
 */
export function lineAction(map: SceneMap, line: number): ActingPlace[] {
  const out: ActingPlace[] = [];
  const put = (reach: number, ...ps: Pt[]) => out.push(...ps.map((at) => ({ at, reach })));
  const close = map.genislik_km !== undefined && map.genislik_km <= CLOSE_MAP_MAX_KM;
  const badge = (...ps: Pt[]) => out.push(...ps.map((at) => ({ at, reach: BADGE_REACH_PX, ...(close ? { driftKm: (BADGE_STEP_PX * map.genislik_km!) / 1920 } : {}) })));
  for (const a of map.araclar ?? []) {
    const end = a.yol?.length ? a.yol[a.yol.length - 1]! : a.konum;
    const reach = shipReachPx(Math.max(1, Math.min(6, Math.round(a.sayi ?? 1))));
    if (a.satir === line) put(reach, a.konum);
    if (a.yol?.length && (a.yol_satir ?? a.satir) === line) put(reach, a.konum, end);
    if (a.kayip_satir === line) put(reach, end);
    if (a.hedef && (a.ates_satir ?? a.yol_satir ?? a.satir) === line) put(reach, end, a.hedef);
  }
  for (const o of map.ordular ?? []) {
    if (o.satir === line) put(BADGE_REACH_PX, o.konum);
    if (o.yol?.length && (o.yol_satir ?? o.satir) === line) put(BADGE_REACH_PX, o.konum, o.yol[o.yol.length - 1]!);
  }
  for (const r of map.rozetler ?? []) {
    if (r.satir === line) badge(r.konum);
    if (r.yol?.length && r.yol_satir === line) put(BADGE_REACH_PX, r.konum, r.yol[r.yol.length - 1]!);
  }
  for (const u of map.birlikler ?? [])
    for (const y of u.yerler) {
      if (y.satir !== line) continue;
      if ("cephe" in y) put(VEHICLE_TOKEN_PX, ...y.cephe);
      else if ("kume" in y) put(VEHICLE_TOKEN_PX, y.kume);
      else put(VEHICLE_TOKEN_PX, y.kusatma);
    }
  for (const s of map.savaslar ?? []) if (s.satir === line) put(BADGE_REACH_PX, s.konum);
  return out;
}

const kmX = (lat: number) => 111.32 * Math.max(0.2, Math.cos((lat * Math.PI) / 180));
const KM_Y = 110.57;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** A place's clear margin as a share of the stage's width: its reach (1080p px on a stage `aspect` high), at least `floor`. */
const margin = (reach: number, win: FrameWindow, floor: number) => Math.max(floor, Math.min(MAX_REACH_SHARE * win.width, (reach * win.aspect) / 1080));

/**
 * Whether a camera view (`centre`, `km` wide) frames these places in the window: together with their drawings' reach
 * (at least FRAME_MARGIN of the window) and how far they may stand off their place they fit in the window centred on their
 * middle — where ShotView's map beats aim it, a step off when a badge has stepped aside —, lie inside the stage's width,
 * and inside its height; and — on a close map — are not a speck in it.
 */
export function framesAction(places: readonly ActingPlace[], centre: Pt, km: number, win: FrameWindow, close: boolean): boolean {
  if (!places.length) return true;
  const kx = kmX(centre[1]);
  const xs = places.map((p) => ({ v: (p.at[0] - centre[0]) * kx, e: km * margin(p.reach, win, FRAME_MARGIN * win.width) + (p.driftKm ?? 0) }));
  const ys = places.map((p) => ({ v: (p.at[1] - centre[1]) * KM_Y, e: km * margin(p.reach, win, FRAME_MARGIN * win.aspect) + (p.driftKm ?? 0) }));
  const winW = km * win.width;
  const winH = km * win.aspect;
  const mid = (Math.max(...xs.map((x) => x.v)) + Math.min(...xs.map((x) => x.v))) / 2;
  const shift = Math.max(...places.map((p) => p.driftKm ?? 0)) / 2;
  if (!xs.every((x) => Math.abs(x.v - mid) + x.e + shift <= winW / 2 + 1e-9)) return false;
  if (!xs.every((x) => Math.abs(x.v) + x.e <= km / 2) || !ys.every((y) => Math.abs(y.v) + y.e <= winH / 2)) return false;
  const spanX = Math.max(...xs.map((x) => x.v)) - Math.min(...xs.map((x) => x.v));
  const spanY = Math.max(...ys.map((y) => y.v)) - Math.min(...ys.map((y) => y.v));
  if (close && km > CLOSE_MIN_ZOOM_KM + 1e-9 && Math.max(spanX / winW, spanY / winH) < TINY_SHARE) return false;
  return true;
}

/**
 * The view that frames these places: centred on them, just wide enough for their extent and their drawings' reach in the
 * window, never closer than `minKm` (a speck — one fleet at one place — is then seen on a few streets' width).
 */
export function viewFor(places: readonly ActingPlace[], win: FrameWindow, minKm: number): { merkez: [number, number]; genislik_km: number } {
  const lons = places.map((p) => p.at[0]);
  const lats = places.map((p) => p.at[1]);
  const merkez: [number, number] = [r4((Math.min(...lons) + Math.max(...lons)) / 2), r4((Math.min(...lats) + Math.max(...lats)) / 2)];
  const spanX = (Math.max(...lons) - Math.min(...lons)) * kmX(merkez[1]);
  const spanY = (Math.max(...lats) - Math.min(...lats)) * KM_Y;
  const reach = Math.max(...places.map((p) => p.reach));
  // A drift on both sides, and the window's middle following it half way (framesAction).
  const drift = Math.max(...places.map((p) => p.driftKm ?? 0));
  const fit = Math.max((spanX + 3 * drift) / (win.width - 2 * margin(reach, win, FRAME_MARGIN * win.width)), (spanY + 2 * drift) / (win.aspect - 2 * margin(reach, win, FRAME_MARGIN * win.aspect)));
  // A hair wider than the bare fit, so rounding never leaves it a pixel short.
  return { merkez, genislik_km: Math.round(Math.max(minKm, fit * 1.02) * 10) / 10 };
}

/**
 * Each line's acting places framed in `win` (a Short's window): where the camera in effect when the line is told (the
 * writer's or RouteZoom's stop, else the map's own view) would leave one outside the window or at its edge — or, on a
 * close map, would show them as a speck — the camera moves to them with that line. A stop that already frames them is
 * kept; a stop on such a line is replaced. Returns the map and the lines whose camera moved. Over the whole 16:9 frame
 * (fullStage: a long video, a Short laid out on the full frame) the camera only brings in what would stand outside it —
 * it never closes in on a "speck" there (owner, 12 Nov 2026: "çok yakın duruyor video … bütün sahnelerin gözüktüğünden
 * emin ol"; the Kosovo s7 close map zoomed past its arrow's name).
 */
export function frameLineAction(map: SceneMap, win: FrameWindow): { map: SceneMap; lines: number[] } {
  if (!map.merkez || !map.genislik_km) return { map, lines: [] };
  const close = map.genislik_km <= CLOSE_MAP_MAX_KM && win.width < 1;
  const used = [
    ...(map.araclar ?? []).flatMap((a) => [a.satir, a.yol_satir, a.kayip_satir, a.ates_satir]),
    ...(map.ordular ?? []).flatMap((o) => [o.satir, o.yol_satir]),
    ...(map.rozetler ?? []).flatMap((r) => [r.satir, r.yol_satir]),
    ...(map.birlikler ?? []).flatMap((u) => u.yerler.map((y) => y.satir)),
    ...(map.savaslar ?? []).map((s) => s.satir),
  ];
  const lines = [...new Set(used.filter((l): l is number => l !== undefined))].sort((a, b) => a - b);
  let keys = [...(map.kamera ?? [])];
  const moved: number[] = [];
  for (const line of lines) {
    const points = lineAction(map, line);
    if (!points.length) continue;
    const last = keys.filter((k) => k.satir <= line).sort((a, b) => b.satir - a.satir)[0];
    const km = last?.genislik_km ?? map.genislik_km;
    const centre = last?.merkez ?? map.merkez;
    // On the whole frame only a place off the picture moves the camera; one near an edge is kept whole by the
    // director's own nudges (badges, names), which a camera move would undo (Kosovo s7's arrow name).
    const onStage = win.width >= 1 && points.every((p) => Math.abs((p.at[0] - centre[0]) * kmX(centre[1])) <= km / 2 && Math.abs((p.at[1] - centre[1]) * KM_Y) <= (km * win.aspect) / 2);
    if (onStage || framesAction(points, centre, km, win, close)) continue;
    // A close map moves in on its action (a few streets at the closest); a wide one pans at its width, widening only
    // when the action needs it (its states and seas are the story's ground).
    const view = viewFor(points, win, close ? CLOSE_MIN_ZOOM_KM : km);
    keys = [...keys.filter((k) => k.satir !== line), { satir: line, ...view }];
    moved.push(line);
  }
  return moved.length ? { map: { ...map, kamera: keys.sort((a, b) => a.satir - b.satir) }, lines: moved } : { map, lines: [] };
}

/**
 * The world a scene's map ground (its relief and coast: MapGround.mapGroundFor) is cut for and the director draws the map
 * on, and the map's tilt — both from the writer's map, so the two always agree (Baghdad s2 and Taranto s2 previews, 14 Nov
 * 2026: the director's own camera stops — frameLineAction's, here over the whole stage and a Short's window — reached past
 * the writer's world, so the relief was stretched over a world it was not cut for and lay off its coasts; Baghdad's
 * 2,020-km stop also turned its 1,800-km map's tilt off in the director only). The writer's world, widened only where such
 * a stop reaches past it. Undefined with `ATOLYE_V3_EGIK_HARITA=0` (everything as before 13 Nov 2026). Pure.
 */
export function groundOf(map: SceneMap, width: number, height: number, env: Readonly<Record<string, string | undefined>> = process.env): { world: MapWorld; tilt: number | undefined } | undefined {
  if (env.ATOLYE_V3_EGIK_HARITA?.trim() === "0" || !map.merkez || !map.genislik_km) return undefined;
  const tilt = mapTilt(map, env);
  const own = mapWorld(map, width, height, tilt !== undefined);
  const stage = { width, height };
  const added = [fullStage(width, height), shortWindow(stage, SHORTS_SIZE)].flatMap((win) => frameLineAction(map, win).map.kamera ?? []).filter((k) => !(map.kamera ?? []).includes(k));
  if (!added.length) return { world: own, tilt };
  const wider = mapWorld({ ...map, kamera: [...(map.kamera ?? []), ...added] }, width, height, tilt !== undefined);
  const b = own.bounds;
  const w = wider.bounds;
  const past = w.west < b.west - 1e-9 || w.east > b.east + 1e-9 || w.south < b.south - 1e-9 || w.north > b.north + 1e-9;
  return { world: past ? wider : own, tilt };
}

/** A map element that acts at a frame, where it stands on the stage, and how far its drawing reaches round that point. */
export interface ActionMark {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly reach: number;
}

/**
 * What acts on a built map at `frame` (shot frames, events begun at exactly that frame) on the stage, through the camera
 * stop in effect then (as mapOnScreen): vehicles appearing, setting out (start and end), losing or firing; unit steps;
 * badges; battles. `reach`: how far the drawing goes round the point (a group of six planes trails its leader in a
 * wedge three rows deep). `viewFrame`: the frame whose camera stop is used (default `frame`).
 */
export function actionAt(m: V3GeoMap, frame: number, width: number, height: number, viewFrame = frame): ActionMark[] {
  const key = m.world && m.camera?.length ? ([...m.camera].reverse().find((c) => c.frame <= viewFrame) ?? m.camera[0]!) : undefined;
  const s = (p: { readonly x: number; readonly y: number }) => (key ? { x: (p.x - key.x) * key.zoom + width / 2, y: (p.y - key.y) * key.zoom + height / 2 } : { x: p.x, y: p.y });
  const u = height / 1080;
  const out: ActionMark[] = [];
  const put = (name: string, p: { readonly x: number; readonly y: number } | undefined, reach: number) => {
    if (p) out.push({ name, ...s(p), reach: reach * u });
  };
  for (const v of m.vehicles ?? []) {
    const name = `${v.kind} ×${v.count}`;
    const reach = shipReachPx(v.count);
    const end = v.path[v.path.length - 1];
    if (v.start === frame) put(name, v.path[0], reach);
    if (v.moveStart === frame) [v.path[0], end].forEach((p) => put(name, p, reach));
    if (v.lossStart !== undefined && v.lossStart === frame) put(name, end, reach);
    if (v.fireStart === frame) [end, v.target].forEach((p) => put(name, p, reach));
  }
  for (const un of m.units ?? []) for (const st of un.steps) if (st.start === frame) st.points.forEach((p) => put(un.name ?? un.side, p, VEHICLE_TOKEN_PX));
  for (const b of m.badges ?? []) {
    if (b.start === frame) put(b.label, b.path[0], BADGE_REACH_PX);
    if (b.moveStart === frame) put(b.label, b.path[b.path.length - 1], BADGE_REACH_PX);
  }
  for (const b of m.battles ?? []) if (b.start === frame) put(b.label, b, BADGE_REACH_PX);
  return out;
}

/**
 * What stands on a built map at `frame` (vehicles and badges up then, where they are by then; battles), on the stage
 * through the camera stop in effect: what a camera move brings into the picture — the Taranto Short's s6 at 9.3 s, the
 * camera closed in on the ships and brought the admiral's badge, up since the start, half behind the sailor.
 */
export function standingAt(m: V3GeoMap, frame: number, width: number, height: number): ActionMark[] {
  const key = m.world && m.camera?.length ? ([...m.camera].reverse().find((c) => c.frame <= frame) ?? m.camera[0]!) : undefined;
  const s = (p: { readonly x: number; readonly y: number }) => (key ? { x: (p.x - key.x) * key.zoom + width / 2, y: (p.y - key.y) * key.zoom + height / 2 } : { x: p.x, y: p.y });
  const u = height / 1080;
  const up = (x: { readonly start: number; readonly end?: number }) => x.start <= frame && (x.end === undefined || frame < x.end);
  const where = <P>(path: readonly P[], moveStart: number | undefined) => (moveStart !== undefined && frame >= moveStart ? path[path.length - 1] : path[0]);
  const out: ActionMark[] = [];
  for (const v of m.vehicles ?? []) {
    const p = where(v.path, v.moveStart);
    if (up(v) && p) out.push({ name: `${v.kind} ×${v.count}`, ...s(p), reach: shipReachPx(v.count) * u });
  }
  for (const b of m.badges ?? []) {
    const p = where(b.path, b.moveStart);
    if (up(b) && p) out.push({ name: b.label, ...s(p), reach: BADGE_REACH_PX * u });
  }
  for (const b of m.battles ?? []) if (b.start <= frame) out.push({ name: b.label, ...s(b), reach: BADGE_REACH_PX * u });
  return out;
}

/** Every frame something on a built map acts (actionAt's events), in order. */
export function actionFrames(m: V3GeoMap): number[] {
  const all = [
    ...(m.vehicles ?? []).flatMap((v) => [v.start, v.moveStart, v.lossStart, v.fireStart]),
    ...(m.units ?? []).flatMap((un) => un.steps.map((st) => st.start)),
    ...(m.badges ?? []).flatMap((b) => [b.start, b.moveStart]),
    ...(m.battles ?? []).map((b) => b.start),
  ];
  return [...new Set(all.filter((f): f is number => f !== undefined))].sort((a, b) => a - b);
}

/** What has acted on a map in the `spanS` seconds up to `frame` (else its latest action before), seen through the camera then. */
export function recentAction(m: V3GeoMap, frame: number, fps: number, width: number, height: number, spanS = 6): ActionMark[] {
  const before = actionFrames(m).filter((f) => f <= frame);
  const recent = before.filter((f) => f >= frame - spanS * fps);
  return (recent.length ? recent : before.slice(-1)).flatMap((f) => actionAt(m, f, width, height, frame));
}

/**
 * A lone character's half width on a Short's stage (share of its width): head radius ~86 px × BODY_PER_HEAD 1.3 of
 * remotion-v3's verticalWindow, on the 1920-px stage.
 */
export const LONE_HALF = 0.058;

/**
 * Where a Short's window centres (stage share) on a lone character at `x` over a map whose action is at `action`: as
 * remotion-v3's pairAim does (ShotView pulls the window toward the map's latest beat) — between the two, the character
 * kept whole; an action more than 1.3 windows away no longer pulls.
 */
export function loneWindowCentre(x: number, action: number, win: FrameWindow, half = LONE_HALF): number {
  const lo = x + half - win.width / 2;
  const hi = x - half + win.width / 2;
  if (lo > hi) return x;
  const mid = Math.min(hi, Math.max(lo, (x + action) / 2));
  const pull = Math.min(1, Math.max(0, (1.3 * win.width - Math.abs(action - x)) / (0.4 * win.width)));
  return x + (mid - x) * pull;
}

/** Whether a window centred at `centre` (stage share) holds every mark whole. */
function holds(marks: readonly ActionMark[], centre: number, width: number, win: FrameWindow): boolean {
  return marks.every((m) => Math.abs(m.x - centre * width) <= (win.width / 2) * width - m.reach);
}

/** Below this share of the stage's height a character standing at the front covers the map (mapStageX's lower 60%). */
export const FIGURE_TOP = 0.38;

/** Whether a mark stands behind a character at stage share `x` (in their width, below the top of their head). */
export function behindFigure(m: ActionMark, x: number, width: number, height: number): boolean {
  return Math.abs(m.x - x * width) < LONE_HALF * width + m.reach && m.y + m.reach > FIGURE_TOP * height;
}

/**
 * Where a lone character stands on a Short's map (stage x 0..1) so the window that holds them also holds what acts on the
 * map then (the Taranto Short's s6: the sailor stood at 0.26 and the window around him never showed the ships at 0.55):
 * just beside the action, on the side that still frames it all and hides none of it (else the one showing the most),
 * nearer the stage's middle on a tie; undefined when nothing acts or the window round `x` already shows it all.
 */
export function besideAction(marks: readonly ActionMark[], x: number, width: number, height: number, win: FrameWindow): number | undefined {
  if (!marks.length) return undefined;
  const mid = marks.reduce((a, m) => a + m.x, 0) / marks.length / width;
  const shown = (at: number) => marks.filter((m) => holds([m], loneWindowCentre(at, mid, win), width, win) && !behindFigure(m, at, width, height)).length;
  if (shown(x) === marks.length) return undefined;
  const xs = marks.map((m) => m.x / width);
  // Clear of the marks: the figure's half width, a mark's reach and a little air.
  const gap = LONE_HALF + Math.max(...marks.map((m) => m.reach)) / width + 0.01;
  const sides = [Math.min(...xs) - gap, Math.max(...xs) + gap].map((at) => Math.min(0.84, Math.max(0.16, at)));
  return sides.sort((a, b) => shown(b) - shown(a) || Math.abs(a - 0.5) - Math.abs(b - 0.5))[0]!;
}

/**
 * How much of a map a lone character standing at stage share `x` spoils over a shot of `duration` frames, as
 * MapFramingCheck reads it: at each action frame what acts outside the window round them (loneWindowCentre), cut at its
 * edge or behind them; at each camera stop what stands behind them (standingAt). The Taranto Short's s3 (11 Nov 2026):
 * de Pignati was placed for the wide view of his own line, and the camera's close-in on the six ships at 0.3 s set them
 * behind him. Also each name they would cover at the shot's first view and at each camera stop (mapNameBoxes: cities,
 * armies, state and arrow names — what mapStageX keeps them off), so a character moved clear of the action does not
 * stand on a name instead. `win`: a vertical Short's window, else the whole 16:9 stage (a long video, a Short laid out
 * on the full frame) — the figure is the same size on the stage either way.
 */
export function loneMisses(m: V3GeoMap, x: number, duration: number, width: number, height: number, win: FrameWindow = fullStage(width, height)): number {
  const winW = win.width * width;
  let misses = 0;
  const acts = actionFrames(m).filter((f) => f < duration);
  for (const frame of acts) {
    const marks = actionAt(m, frame, width, height);
    if (!marks.length) continue;
    const mid = (Math.min(...marks.map((k) => k.x)) + Math.max(...marks.map((k) => k.x))) / 2;
    const x0 = Math.min(width - winW, Math.max(0, loneWindowCentre(x, mid / width, win) * width - winW / 2));
    misses += marks.filter((k) => k.x - k.reach < x0 || k.x + k.reach > x0 + winW || k.y - k.reach < 0 || k.y + k.reach > height || behindFigure(k, x, width, height)).length;
  }
  for (const key of m.camera ?? []) {
    if (key.frame <= 0 || key.frame >= duration || acts.includes(key.frame)) continue;
    misses += standingAt(m, key.frame, width, height).filter((k) => k.x + k.reach > 0 && k.x - k.reach < width && behindFigure(k, x, width, height)).length;
  }
  const views = [0, ...(m.camera ?? []).map((k) => k.frame).filter((f) => f > 0 && f < duration)];
  for (const frame of new Set(views)) misses += mapNameBoxes(mapOnScreen(m, frame, width, height), height).filter((b) => b.y > FIGURE_TOP * height && b.y < height && b.x1 > (x - LONE_HALF) * width && b.x0 < (x + LONE_HALF) * width).length;
  return misses;
}

/**
 * Where a lone character stands on a map so that nothing is spoilt at any camera stop while they are on it
 * (loneMisses): `x` when it is as clear as any spot, else the clearest spot on the stage (0.16–0.84), the nearest to
 * `x` on a tie — so a placement judged at one moment (besideAction, mapStageX) holds over the whole camera move.
 */
export function clearAtEveryStop(m: V3GeoMap, x: number, duration: number, width: number, height: number, win: FrameWindow = fullStage(width, height)): number {
  const spots = [x, ...Array.from({ length: 35 }, (_, i) => Math.round((0.16 + i * 0.02) * 100) / 100)];
  const scored = spots.map((at) => ({ at, misses: loneMisses(m, at, duration, width, height, win) }));
  return scored.sort((a, b) => a.misses - b.misses || Math.abs(a.at - x) - Math.abs(b.at - x))[0]!.at;
}
