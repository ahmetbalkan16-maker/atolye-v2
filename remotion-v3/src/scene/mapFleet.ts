import type { V3GeoMap, V3VehicleFormation } from "../../../src/lib/v3/render/RenderPlanTypes";
import { along, smoothPoints } from "./mapGeometry";
import { planeSlot } from "./mapEffects";

/**
 * A vehicle group that moves and stands as the narration tells it (owner, 27 Nov 2026: "gemilerin sıralanması anlatıldığı
 * şekilde gitmesi ve hareket etmesi, tabi uçaklar için de geçerli"): its leader's place over its steps (the first route,
 * then each `legs` step from where the leader really is), the arrangement of the others (a line abreast, a column on the
 * leader's own path, an echelon, a V) and the blend when the arrangement changes. Everything is a pure function of the
 * frame (Remotion renders frames in any order). A group without `formation` and `legs` never comes here: MapVehicles draws
 * it as it always has.
 */

type P = { x: number; y: number };
type Vehicle = NonNullable<V3GeoMap["vehicles"]>[number];

/** How long a group takes to turn onto a new heading, and to settle into a new arrangement (seconds). */
export const TURN_S = 0.9;
export const FORM_S = 1.6;
/** Spacing in units of a vehicle's size: a column's gap along the path, a line abreast's gap across it. */
export const COLUMN_GAP = 2.6;
const ABREAST_GAP = { ship: 1.9, plane: 2.5 };

/** The way a group's drawing is arranged when the writer gave none: ships in a column, planes in a V. */
export function defaultFormation(kind: Vehicle["kind"]): V3VehicleFormation {
  return kind === "ucak" ? "v" : "kol";
}

/** True when the group is drawn by this module (it has an arrangement or later steps). */
export function isFleet(v: Pick<Vehicle, "formation" | "legs">): boolean {
  return v.formation !== undefined || (v.legs?.length ?? 0) > 0;
}

const inOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** The route's direction at a fraction of its length (radians). */
export function headingOn(route: readonly P[], f: number): number {
  const a = along(route, Math.max(0, f - 0.01));
  const b = along(route, Math.min(1, f + 0.01));
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** `to` turned from `from` by the share `w` of the shorter way round. */
export function turnToward(from: number, to: number, w: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return from + d * w;
}

/** Where a group's leader is at a frame. */
export interface FleetState {
  readonly p: P;
  readonly heading: number;
  readonly moving: boolean;
  /** Progress along the step's route (0..1). */
  readonly t: number;
  /** The step in effect: 0 the first route, then 1.. the `legs`. */
  readonly leg: number;
  readonly formation: V3VehicleFormation | undefined;
  /** The arrangement before the last change, and the frame the change began. */
  readonly before: V3VehicleFormation | undefined;
  readonly since: number;
  readonly target: P | undefined;
  readonly fireStart: number | undefined;
}

/**
 * The leader of a group with an arrangement or later steps at `frame`. `route0` is the smoothed first route (as MapVehicles
 * has it); `travelS(route, from)` how long a route takes on screen (`speed` scales it: planes fly faster). A later step
 * starts from where the leader is at its start (so a group told to turn while it sails turns where it is), turns its
 * heading over TURN_S, and a step with no route only turns the group to its target.
 */
export function fleetLeader(v: Vehicle, route0: readonly P[], frame: number, fps: number, travelS: (path: readonly P[], from: number) => number, speed = 1): FleetState {
  const legs = v.legs ?? [];
  const faceTarget = (p: P, target: P | undefined, fallback: number) => (target ? Math.atan2(target.y - p.y, target.x - p.x) : fallback);
  let pos = route0[0]!;
  let heading = faceTarget(pos, v.target, 0);
  let formation = v.formation;
  let before: V3VehicleFormation | undefined;
  let since = 0;
  let target = v.target;
  let fireStart = v.fireStart;
  let state: FleetState = { p: pos, heading, moving: false, t: 0, leg: 0, formation, before, since, target, fireStart };
  for (let k = 0; k <= legs.length; k++) {
    const st = { start: k === 0 ? v.moveStart : legs[k - 1]!.start, route: k === 0 && route0.length >= 2 ? route0 : undefined };
    if (k > 0) {
      if (st.start! > frame) break;
      const leg = legs[k - 1]!;
      if (leg.formation !== undefined && leg.formation !== formation) {
        before = formation;
        formation = leg.formation;
        since = leg.start;
      }
      if (leg.target !== undefined) {
        target = leg.target;
        fireStart = leg.fireStart;
      }
    }
    // A step's route starts where the leader is when it begins: the earlier steps are final by then.
    const route = k > 0 && legs[k - 1]!.path.length >= 2 ? smoothPoints([pos, ...legs[k - 1]!.path.slice(1)], 10) : st.route;
    const next = legs[k]?.start ?? Infinity;
    const at = Math.min(frame, next);
    let p = pos;
    let h = heading;
    let t = 0;
    let moving = false;
    if (route && st.start !== undefined) {
      const travel = Math.max(1, Math.round(travelS(route, st.start) * speed * fps));
      t = inOut(clamp01((at - st.start) / travel));
      moving = frame === at && t > 0 && t < 1;
      p = along(route, t);
      const wanted = t >= 1 && target ? faceTarget(p, target, 0) : headingOn(route, t);
      h = k === 0 ? wanted : turnToward(heading, wanted, inOut(clamp01((at - st.start) / Math.max(1, TURN_S * fps))));
    } else if (k > 0) {
      // No route: it turns on the spot to its target.
      h = turnToward(heading, faceTarget(pos, target, heading), inOut(clamp01((at - st.start!) / Math.max(1, TURN_S * fps))));
    }
    state = { p, heading: h, moving, t, leg: k, formation, before, since, target, fireStart };
    if (frame < next) return state;
    pos = p;
    heading = h;
  }
  return state;
}

/** A group member's place and heading. */
export interface FleetMember {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  readonly going: boolean;
  readonly t: number;
  readonly leg: number;
}

/** A member's place in a rigid arrangement, in the leader's frame (units of a vehicle's size; `across` to its right). */
export function rigidSlot(formation: V3VehicleFormation, i: number, count: number, plane: boolean): { back: number; across: number } {
  if (formation === "v") return planeSlot(i);
  if (formation === "hat") return { back: 0, across: (i - (count - 1) / 2) * (plane ? ABREAST_GAP.plane : ABREAST_GAP.ship) };
  // An echelon: each one a step further back and to the right of the one before.
  const step = plane ? 1.6 : 1.5;
  return { back: i * step, across: i * (plane ? 1.6 : 1.2) };
}

/**
 * The members of a group at `frame`, `S` px a size. A column follows its leader along the leader's own path, each one
 * COLUMN_GAP sizes behind the one before (sampled back along where the leader has been, and straight back from where it
 * first stood); the other arrangements keep their slots rigidly round the leader and turn with it. When the arrangement
 * changes the members glide from the old places to the new over FORM_S. `leader(f)` is the leader's state at any frame.
 */
export function fleetMembers(v: Pick<Vehicle, "kind" | "count">, leader: (frame: number) => FleetState, frame: number, fps: number, S: number): FleetMember[] {
  const plane = v.kind === "ucak";
  const now = leader(frame);
  const place = (formation: V3VehicleFormation, i: number): FleetMember => {
    if (formation === "kol") return columnPlace(i, leader, frame, S);
    const slot = rigidSlot(formation, i, v.count, plane);
    const d = { x: Math.cos(now.heading), y: Math.sin(now.heading) };
    return { x: now.p.x - d.x * slot.back * S - d.y * slot.across * S, y: now.p.y - d.y * slot.back * S + d.x * slot.across * S, heading: now.heading, going: now.moving, t: now.t, leg: now.leg };
  };
  const formation = now.formation ?? defaultFormation(v.kind);
  return Array.from({ length: v.count }, (_, i) => {
    const to = place(formation, i);
    if (now.before === undefined || now.before === formation) return to;
    const w = inOut(clamp01((frame - now.since) / Math.max(1, FORM_S * fps)));
    if (w >= 1) return to;
    const from = place(now.before, i);
    return { ...to, x: from.x + (to.x - from.x) * w, y: from.y + (to.y - from.y) * w, heading: turnToward(from.heading, to.heading, w) };
  });
}

/** Frames between the samples of a column's trail, and how many it looks back at most. */
const TRAIL_STEP = 3;
const TRAIL_MAX = 200;

/**
 * The `i`th ship of a column: `i × COLUMN_GAP` sizes of the leader's path behind the leader — each on the leader's path,
 * delayed — and where the leader has not yet been that far (it stands, or has just set off), in a line straight back from
 * where it first stood.
 */
function columnPlace(i: number, leader: (frame: number) => FleetState, frame: number, S: number): FleetMember {
  const now = leader(frame);
  if (i === 0) return { x: now.p.x, y: now.p.y, heading: now.heading, going: now.moving, t: now.t, leg: now.leg };
  const need = i * COLUMN_GAP * S;
  let prev = now;
  let acc = 0;
  for (let n = 1; n <= TRAIL_MAX; n++) {
    const f = frame - n * TRAIL_STEP;
    const cur = leader(Math.max(0, f));
    const seg = Math.hypot(prev.p.x - cur.p.x, prev.p.y - cur.p.y);
    if (acc + seg >= need && seg > 1e-6) {
      const w = (need - acc) / seg;
      return { x: prev.p.x + (cur.p.x - prev.p.x) * w, y: prev.p.y + (cur.p.y - prev.p.y) * w, heading: Math.atan2(prev.p.y - cur.p.y, prev.p.x - cur.p.x), going: prev.moving || cur.moving, t: cur.t, leg: cur.leg };
    }
    acc += seg;
    prev = cur;
    if (f <= 0) break;
  }
  // Not that far along yet: in a line straight back from where the trail ends, on the heading it had there.
  const rest = need - acc;
  return { x: prev.p.x - Math.cos(prev.heading) * rest, y: prev.p.y - Math.sin(prev.heading) * rest, heading: prev.heading, going: prev.moving, t: prev.t, leg: prev.leg };
}
