import type { V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";

/**
 * The living map's attack and night effects as pure numbers (no Remotion), so a smoke proves them without a render
 * (Taranto Short review, 11 Nov 2026): a torpedo's wake running to its ship and the water column it throws up, the
 * flares an air raid drops at night, the night's searchlights, and the size of a badge's words on the map.
 */

type P = { readonly x: number; readonly y: number };
type Vehicle = NonNullable<V3GeoMap["vehicles"]>[number];

/** Ships: what a torpedo runs at and what throws up a water column when hit. */
export const WATER_KINDS: ReadonlySet<Vehicle["kind"]> = new Set(["kadirga", "yelkenli", "gemi", "denizalti"]);
/** How long a torpedo runs through the water (seconds), the column it throws up stands, and between one plane's drops. */
export const TORPEDO_RUN_S = 1.2;
export const COLUMN_S = 1.1;
export const TORPEDO_EVERY_S = 2.6;
/** How long a flare burns, and how many an air raid drops. */
export const FLARE_S = 7;
const FLARES = 3;

/**
 * A badge's words on the map against a character's on the stage. A Short shows a fifth of the map's width, so its words
 * are lettered full size (owner, 11 Nov 2026: the thin white words at 0.72 could not be read on the phone).
 */
export const MAP_BUBBLE = 0.72;
export function mapBubbleSize(vertical: boolean): number {
  return vertical ? 1 : MAP_BUBBLE;
}

/** Night on the map: only when the script says so — a map without `zaman` is drawn as it always was. */
export function isNightMap(map: Pick<V3GeoMap, "zaman">): boolean {
  return map.zaman === "gece";
}

function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function unit(from: P, to: P, fallback: P): P {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  return d > 1e-6 ? { x: (to.x - from.x) / d, y: (to.y - from.y) / d } : fallback;
}

/** Does a vehicle group's target lie on a ship (a ship of another vehicle group within `reach`)? */
export function shipTargeted(map: V3GeoMap, vi: number, reach: number, aim?: P): boolean {
  const v = map.vehicles?.[vi];
  const target = aim ?? v?.target;
  if (!v || !target) return false;
  return (map.vehicles ?? []).some((o, oi) => oi !== vi && WATER_KINDS.has(o.kind) && [...o.path, ...(o.legs ?? []).flatMap((l) => l.path)].some((q) => Math.hypot(q.x - target.x, q.y - target.y) <= reach));
}

/** Does a plane's target lie on a ship (a ship of another vehicle group within `reach`)? Then it drops torpedoes. */
export function torpedoTarget(map: V3GeoMap, vi: number, reach: number, aim?: P): boolean {
  return map.vehicles?.[vi]?.kind === "ucak" && shipTargeted(map, vi, reach, aim);
}

/**
 * Who sank a lost ship: another side's planes or submarine on the map at that moment (`frame`). Its torpedo comes from
 * where they are headed (their route's end). None: the ship was lost to gunfire and no wake is drawn.
 */
export function torpedoAttacker(map: V3GeoMap, vi: number, frame: number): P | undefined {
  const v = map.vehicles?.[vi];
  if (!v || !WATER_KINDS.has(v.kind)) return undefined;
  const o = (map.vehicles ?? []).find((a, ai) => ai !== vi && (a.kind === "ucak" || a.kind === "denizalti") && a.color !== v.color && a.start <= frame && (a.end === undefined || a.end > frame));
  return o ? o.path[o.path.length - 1] : undefined;
}

/**
 * An air raid: where and from which frame a plane group attacks — its target from `fireStart`, or else the first ship
 * of another side lost while it is on the map (where that ship stands, when it goes down). Undefined: no attack.
 */
export function raidOf(map: V3GeoMap, vi: number, fps: number): { at: P; frame: number } | undefined {
  const v = map.vehicles?.[vi];
  if (!v || v.kind !== "ucak") return undefined;
  if (v.target && v.fireStart !== undefined) return { at: v.target, frame: v.fireStart };
  const attack = (v.legs ?? []).find((l) => l.target && l.fireStart !== undefined);
  if (attack) return { at: attack.target!, frame: attack.fireStart! };
  const sunk = (map.vehicles ?? [])
    .flatMap((o) => (WATER_KINDS.has(o.kind) && o.color !== v.color && o.lossStart !== undefined && o.losses?.length ? [{ at: o.path[0]!, frame: o.lossStart + Math.round(Math.min(...o.losses) * fps) }] : []))
    .filter((s) => v.start <= s.frame && (v.end === undefined || v.end > s.frame))
    .sort((a, b) => a.frame - b.frame)[0];
  return sunk ? { at: sunk.at, frame: sunk.frame } : undefined;
}

const ringCache = new Map<string, P[][]>();

/** The map's land outline (`V3GeoMap.land`: absolute M/L/Z rings, even-odd) as point rings, parsed once per map. */
export function landRings(d: string): P[][] {
  const known = ringCache.get(d);
  if (known) return known;
  const rings = d.split(/M/).map((part) => [...part.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))).filter((r) => r.length > 2);
  if (ringCache.size > 50) ringCache.clear();
  ringCache.set(d, rings);
  return rings;
}

export function onLand(rings: readonly (readonly P[])[], p: P): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [a, b] = [ring[i]!, ring[j]!];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Where a torpedo meant for `hit` enters the water: `run` short of it, on the side its attacker comes from — turned
 * as little as it takes for the whole run to lie on the sea (Taranto: the raid's route ended on land, and the wake ran
 * over the town). No way through the water at that length: half of it; none at all: straight from the attacker.
 */
export function torpedoStart(hit: P, attacker: P, run: number, land: readonly (readonly P[])[] = []): P {
  const d = unit(hit, attacker, { x: -0.92, y: 0.4 });
  const far = Math.hypot(attacker.x - hit.x, attacker.y - hit.y);
  const len = far > 1e-6 ? Math.min(run, far) : run;
  const at = (deg: number, l: number) => {
    const [c, s] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
    return { x: hit.x + (d.x * c - d.y * s) * l, y: hit.y + (d.x * s + d.y * c) * l };
  };
  // The least land on the way wins, the smallest turn and the full run first (a ship the script put ashore: straight in).
  const ways = [len, len / 2].flatMap((l) => [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180].map((deg) => ({ l, deg, dry: [0.25, 0.5, 0.75, 1].filter((f) => onLand(land, at(deg, l * f))).length })));
  const best = ways.reduce((a, b) => (b.dry < a.dry ? b : a));
  return at(best.deg, best.l);
}

/**
 * A torpedo `since` seconds after it entered the water at `from`: its head running to `hit` (eased in, no leap), the
 * white wake from where it entered to the head, and once it strikes, the impact's progress (0..1: burst and water
 * column), while the wake fades. Undefined before it is dropped and after the column has fallen.
 */
export function torpedoAt(since: number, from: P, hit: P): { head: P; wake: number; impact?: number } | undefined {
  if (since < 0 || since >= TORPEDO_RUN_S + COLUMN_S) return undefined;
  const p = Math.min(1, since / TORPEDO_RUN_S);
  const e = p * (2 - p);
  const head = { x: from.x + (hit.x - from.x) * e, y: from.y + (hit.y - from.y) * e };
  if (since < TORPEDO_RUN_S) return { head, wake: 0.85 };
  const impact = (since - TORPEDO_RUN_S) / COLUMN_S;
  return { head, wake: 0.85 * (1 - impact), impact };
}

/** A water column's height and width (in units of a vehicle's size) at an impact's progress: up fast, falling back. */
export function waterColumn(impact: number): { h: number; w: number; alpha: number } | undefined {
  if (impact <= 0 || impact >= 1) return undefined;
  const up = Math.sin(Math.min(1, impact / 0.35) * (Math.PI / 2));
  const down = impact > 0.35 ? (impact - 0.35) / 0.65 : 0;
  return { h: 2.8 * up * (1 - 0.55 * down), w: 0.55 + 0.6 * impact, alpha: 1 - down * down };
}

/**
 * An air raid's flares at night: dropped from 2 s before the attack, one after another round the attack (offsets in
 * units of a vehicle's size), drifting down on their parachutes, flickering and burning out after FLARE_S.
 */
export function flaresAt(frame: number, attack: number, fps: number, seed: number): { dx: number; dy: number; glow: number }[] {
  return Array.from({ length: FLARES }, (_, i) => {
    const t = (frame - attack) / fps + 2 - i * 0.7;
    if (t < 0 || t >= FLARE_S) return undefined;
    const glow = Math.min(1, t / 0.4) * Math.min(1, (FLARE_S - t) / 1.2) * (0.85 + 0.15 * Math.sin(frame * 0.9 + i * 2.1));
    return { dx: (rand(seed + i * 7) - 0.5) * 9 + Math.sin(t * 1.3 + i) * 0.35, dy: -2.6 - rand(seed + i * 13) * 2.4 + t * 0.32, glow };
  }).filter((f): f is { dx: number; dy: number; glow: number } => f !== undefined);
}

/**
 * The night's searchlights: from the harbour's ships and the cities in view (at most three), else from the view's lower
 * corners, each beam sweeping slowly to and fro on its own phase (radians, 0 = right, up is negative).
 */
export function searchlights(map: V3GeoMap, view: { x0: number; y0: number; x1: number; y1: number }, frame: number, fps: number): { x: number; y: number; angle: number }[] {
  const [w, h] = [view.x1 - view.x0, view.y1 - view.y0];
  // A ship just past the frame's edge still sweeps its light into it.
  const inView = (q: P) => q.x >= view.x0 - w * 0.15 && q.x <= view.x1 + w * 0.15 && q.y >= view.y0 - h * 0.15 && q.y <= view.y1 + h * 0.15;
  const ships = (map.vehicles ?? []).filter((v) => WATER_KINDS.has(v.kind) && v.kind !== "denizalti" && v.moveStart === undefined).map((v) => v.path[0]!);
  const found = [...ships, ...map.cities].filter(inView).slice(0, 3);
  const from = found.length ? found : [{ x: view.x0 + w * 0.2, y: view.y1 - h * 0.06 }, { x: view.x0 + w * 0.8, y: view.y1 - h * 0.06 }];
  const t = frame / fps;
  return from.map((q, i) => ({ x: q.x, y: q.y, angle: -Math.PI / 2 + (i % 2 ? 0.35 : -0.35) + Math.sin(t * (0.45 + i * 0.12) + i * 1.9) * 0.75 }));
}

/**
 * Naval and air battle effects (owner, 27 Nov 2026: "gemi savaşlarını, uçak savaşlarını daha kaliteli yap —
 * konumlandırmaları, efektleri, hareketleri"). Every function is a pure function of seconds or frames (Remotion renders
 * frames in any order); offsets are in units of a vehicle's size.
 */

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * A plane's place in its group's V (the leader's frame: `back` behind it along its course, `across` to its right):
 * planes fly abreast of each other, never in the one file the ships keep, and the wings (a plane is two units across) never
 * touch. Slot 0 is the leader, then one each side, row by row.
 */
export function planeSlot(i: number): { back: number; across: number } {
  if (i <= 0) return { back: 0, across: 0 };
  const row = Math.ceil(i / 2);
  return { back: 1.6 * row, across: (i % 2 ? 1 : -1) * 1.6 * row };
}

/** How far a plane banks (−1..1, the sign is the side) going from heading `h0` to `h1` (radians): a half radian is a full bank. */
export function bankOf(h0: number, h1: number): number {
  let d = h1 - h0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.max(-1, Math.min(1, d / 0.5));
}

/** How long a lost ship takes to go down on screen (seconds): it lists, settles into the sea and goes under. */
export const SHIP_SINK_S = 3;
/** How long a wreck's smoke column and oil slick stay on the sea after the ship has gone under. */
export const WRECK_S = 8;

/**
 * A sinking ship's pose at `p` (0..1 of SHIP_SINK_S): `list` the heel in degrees, `drop` how far the hull has settled into
 * the sea (units: 1.15 is all of it), `fade` the last moment's fade, `fire` the burning on deck (up until it settles).
 */
export function sinkPose(p: number): { list: number; drop: number; fade: number; fire: number } {
  const c = clamp01(p);
  const heel = clamp01(c / 0.5);
  return {
    list: 24 * heel * heel * (3 - 2 * heel),
    drop: 1.15 * Math.pow(clamp01((c - 0.2) / 0.8), 1.4),
    fade: c > 0.92 ? 1 - (c - 0.92) / 0.08 : 1,
    fire: c < 0.75 ? 1 : Math.max(0, 1 - (c - 0.75) / 0.25),
  };
}

/**
 * The smoke column over a wreck, `since` seconds after the ship was hit: puffs rising and drifting down wind, thickening
 * while the ship burns and thinning to nothing by WRECK_S. Each puff is a pure function of `since` (a cycle's phase).
 */
export function wreckSmoke(since: number, seed: number): { dx: number; dy: number; r: number; a: number }[] {
  if (since < 0 || since >= WRECK_S) return [];
  const life = Math.min(1, since / 0.6) * Math.min(1, (WRECK_S - since) / 2.5);
  return Array.from({ length: 6 }, (_, j) => {
    const t = (((since * 0.3 + j / 6) % 1) + 1) % 1;
    return { dx: 0.15 * Math.sin(seed + j * 2.1) + t * 1.3, dy: -(0.5 + t * 3.2), r: 0.22 + t * 0.5, a: 0.55 * (1 - t) * life };
  });
}

/** The oil slick spreading over the sea where a ship went down: radius (units) and opacity; none before she is under. */
export function oilSlick(since: number): { r: number; a: number } | undefined {
  const from = SHIP_SINK_S * 0.6;
  if (since < from || since >= WRECK_S) return undefined;
  const g = (since - from) / (WRECK_S - from);
  return { r: 0.8 + 1.6 * Math.sqrt(g), a: 0.3 * Math.min(1, g * 6) * (1 - g) };
}

/**
 * A gun's firing `since` seconds after the shot: the flash (1..0, gone in 0.35 s) and the smoke puff that stays and
 * climbs for 1.6 s (radius and opacity; `rise` in units), where it was a flash of 0.35 s and nothing after.
 */
export function muzzleFx(since: number): { flash: number; smoke?: { r: number; a: number; rise: number } } {
  if (since < 0) return { flash: 0 };
  const t = since / 1.6;
  return { flash: since < 0.35 ? 1 - since / 0.35 : 0, ...(t < 1 ? { smoke: { r: 0.35 + t * 1.1, a: 0.6 * (1 - t), rise: t * 0.8 } } : {}) };
}

/**
 * Where a shell aimed at a ship comes down (units, from the aim point): four in ten strike it, the others fall short or
 * over in a splash 1.4–2.6 units off (the ship's guns did not score a hit with every shot). `seed` is the shot's.
 */
export function shellOutcome(seed: number): { hit: boolean; dx: number; dy: number } {
  if (rand(seed * 3.1 + 0.7) < 0.4) return { hit: true, dx: (rand(seed + 5) - 0.5) * 0.8, dy: (rand(seed + 9) - 0.5) * 0.5 };
  const a = rand(seed + 13) * 2 * Math.PI;
  const d = 1.4 + rand(seed + 17) * 1.2;
  return { hit: false, dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.6 };
}

/** Anti-aircraft fire: how long before an attack it opens up and how long after, in seconds. */
export const FLAK_LEAD_S = 3;
export const FLAK_TAIL_S = 7;

/**
 * The frames an air raid draws flak in (Taranto: the battleships' guns fired at the torpedo planes and not one burst
 * stood round them): a plane group's raid on a map where a ship of another side floats, from FLAK_LEAD_S before the
 * attack to FLAK_TAIL_S after. Undefined: no flak (no raid, or no ship to fire).
 */
export function flakWindow(map: V3GeoMap, vi: number, fps: number): { from: number; to: number } | undefined {
  const v = map.vehicles?.[vi];
  const raid = raidOf(map, vi, fps);
  if (!v || !raid || !(map.vehicles ?? []).some((o) => WATER_KINDS.has(o.kind) && o.color !== v.color)) return undefined;
  return { from: Math.max(v.start, raid.frame - Math.round(FLAK_LEAD_S * fps)), to: raid.frame + Math.round(FLAK_TAIL_S * fps) };
}

/**
 * The flak bursts round a plane group `t` seconds into the barrage: five at a time, each a flash then a black puff that
 * swells and fades over a second, somewhere within a few units of the group (`age` 0..1; offsets in units).
 */
export function flakAt(t: number, seed: number): { dx: number; dy: number; age: number }[] {
  if (t < 0) return [];
  return Array.from({ length: 5 }, (_, i) => {
    const phase = t * 1.1 + i / 5;
    const cycle = Math.floor(phase);
    return { dx: (rand(seed + cycle * 17 + i * 5) - 0.5) * 9, dy: (rand(seed + cycle * 29 + i * 11) - 0.5) * 6, age: phase - cycle };
  });
}

/** A torpedo's drop `since` seconds after it leaves the plane at `from`, falling to the water at `to` in 0.3 s (undefined after). */
export function torpedoDropAt(since: number, from: P, to: P): P | undefined {
  if (since < 0 || since >= 0.3) return undefined;
  const e = (since / 0.3) ** 2;
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
}
