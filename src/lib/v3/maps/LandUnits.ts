import type { MapUnits, SceneMap, UnitFormation } from "../episode/EpisodeTypes";

/**
 * Land armies stay on land (owner, 20 Nov 2026, for the Lake Trasimene Short: nothing stopped a unit's place on a close
 * map from lying in a lake or the sea). A land unit's formation on water is a writer's slip — unless that step is the
 * unit driven into the water (`suya`: the Romans pushed into the lake and drowning). The script's repair round asks for
 * it (MapRules, with Natural Earth's coarse coast and a tolerance), and the plan pulls a token still on water to the
 * nearest shore (MapBuilder, with the close map's own coast and lakes). Ships are vehicles (`araclar`), never units.
 * Pure: the land test is given.
 */

type Ring = readonly (readonly [number, number])[];
type Polygon = readonly Ring[];

/** A land test on [lon, lat]. */
export type LandTest = (p: readonly [number, number]) => boolean;

/** The sides that are a fleet's crews (a writer's tokens for a navy), which may stand on water. */
const FLEET_SIDE = /\b(?:fleets?|navy|navies|naval|ships?|galleys?|flotillas?|armadas?|marines?)\b|donanma|filo|gemi|kadırga/iu;

/** A unit that marches on land: every unit but a fleet's. */
export function landUnit(u: Pick<MapUnits, "taraf" | "ad">): boolean {
  return !FLEET_SIDE.test(`${u.taraf} ${u.ad ?? ""}`);
}

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Outer rings with their boxes, so a test looks only at the few shapes round its point. */
function boxed(polys: readonly Polygon[]): { ring: Ring; w: number; e: number; s: number; n: number }[] {
  return polys.flatMap((p) => {
    const ring = p[0];
    if (!ring?.length) return [];
    let [w, e, s, n] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [x, y] of ring) [w, e, s, n] = [Math.min(w, x), Math.max(e, x), Math.min(s, y), Math.max(n, y)];
    return [{ ring, w, e, s, n }];
  });
}

/**
 * The map's land test as MapBuilder draws it (land outside the lakes; outer rings, like AdminUnits.inOutline), each shape
 * looked at only when its box holds the point: Natural Earth's whole land is ~100,000 points, and a check walks every
 * unit's every step.
 */
export function landOf(land: readonly Polygon[], lakes: readonly Polygon[]): LandTest {
  const L = boxed(land);
  const W = boxed(lakes);
  const hit = (list: typeof L, lon: number, lat: number) => list.some((b) => lon >= b.w && lon <= b.e && lat >= b.s && lat <= b.n && inRing(lon, lat, b.ring));
  return (p) => hit(L, p[0], p[1]) && !hit(W, p[0], p[1]);
}

/** A point `east` and `north` km from `c`. */
function offset(c: readonly [number, number], east: number, north: number): [number, number] {
  return [c[0] + east / (111.32 * Math.max(0.2, Math.cos((c[1] * Math.PI) / 180))), c[1] + north / 110.57];
}

/** Water with no land within `tolKm` (eight ways, at half and the whole distance): a coarse coast's shore is not water. */
export function deepWater(p: readonly [number, number], onLand: LandTest, tolKm: number): boolean {
  if (onLand(p)) return false;
  for (const f of [0.5, 1])
    for (let j = 0; j < 8; j++) if (onLand(offset(p, Math.cos((j * Math.PI) / 4) * tolKm * f, Math.sin((j * Math.PI) / 4) * tolKm * f))) return false;
  return true;
}

/**
 * Where a formation is written: a cluster's centre, a front's points and the middles between them. A siege ring is left
 * out (MapBuilder.formationPoints keeps its tokens to the land round a coastal city).
 */
export function writtenPoints(f: UnitFormation): [number, number][] {
  if ("kume" in f) return [[f.kume[0], f.kume[1]]];
  if ("kusatma" in f) return [];
  return f.cephe.flatMap((p, i) => {
    const q = f.cephe[i + 1];
    return q ? [[p[0], p[1]] as [number, number], [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as [number, number]] : [[p[0], p[1]] as [number, number]];
  });
}

/** A land unit standing in the water on a line: which unit, which step, where. */
export interface UnitOnWater {
  readonly unit: number;
  readonly step: number;
  readonly satir: number;
  readonly at: [number, number];
  readonly name: string;
}

/**
 * The first step of each land unit whose written formation lies in deep water (`deepWater` with `tolKm`), unless it is
 * marked `suya` (driven into the water). Ships (`araclar`) and a fleet's tokens are not asked.
 */
export function unitsOnWater(map: Pick<SceneMap, "birlikler">, onLand: LandTest, tolKm: number): UnitOnWater[] {
  return (map.birlikler ?? []).flatMap((u, ui) => {
    if (!landUnit(u)) return [];
    for (const [yi, y] of u.yerler.entries()) {
      if (y.suya) continue;
      const at = writtenPoints(y).find((p) => deepWater(p, onLand, tolKm));
      if (at) return [{ unit: ui, step: yi, satir: y.satir, at, name: u.ad ?? u.taraf }];
    }
    return [];
  });
}

/**
 * The land nearest `p` within `maxKm` (rings outward, 16 ways each, the nearest found), or undefined when there is none
 * that near: a token left on water is pulled to the shore it stood off.
 */
export function nearestLand(p: readonly [number, number], onLand: LandTest, maxKm: number, rings = 24): [number, number] | undefined {
  if (onLand(p)) return [p[0], p[1]];
  for (let r = 1; r <= rings; r++) {
    const d = (maxKm * r) / rings;
    let best: [number, number] | undefined;
    for (let j = 0; j < 16 && !best; j++) {
      const q = offset(p, Math.cos((j * Math.PI) / 8) * d, Math.sin((j * Math.PI) / 8) * d);
      if (onLand(q)) best = q;
    }
    if (best) {
      // A step further in, off the very shore line (a token on the shore's stroke still reads as in the water).
      const [ex, ny] = [(best[0] - p[0]) * 111.32 * Math.max(0.2, Math.cos((p[1] * Math.PI) / 180)), (best[1] - p[1]) * 110.57];
      const len = Math.hypot(ex, ny) || 1;
      const more = Math.max(0.06, d * 0.15);
      const inward = offset(best, (ex / len) * more, (ny / len) * more);
      return onLand(inward) ? inward : best;
    }
  }
  return undefined;
}
