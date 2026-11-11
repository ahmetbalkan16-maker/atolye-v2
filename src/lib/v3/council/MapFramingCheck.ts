import { actionAt, actionFrames, type ActionMark, behindFigure, type FrameWindow, loneWindowCentre, shortWindow } from "../maps/UnitFraming";
import type { V3Performer, V3RenderPlan, V3Shot } from "../render/RenderPlanTypes";

/**
 * The quality brain's map framing check for a Short, from the render plan (no picture, no model): when something acts on
 * a map — a fleet appears, planes set out, a ship goes down, a unit moves, a badge comes on — is it inside the frame's
 * window, clear of its edges? The Taranto Short (11 Nov 2026) passed every check while its attack showed empty sea: the
 * planes' wedge was cut at the top corner, the second wave stood off the stage, and in the ships' sinking scene the
 * window held the sailor in front of the map and never the ships. Owner: a fix must also teach the brains.
 */

export interface MapFramingFault {
  /** Seconds (the plan's frames). */
  readonly at: number;
  readonly shot: string;
  readonly ayrinti: string;
}

/** A performer's stage x (0..1) at a frame: their moves so far. */
function performerX(p: V3Performer, frame: number): number {
  let x = p.x;
  for (const m of [...p.moves].sort((a, b) => a.start - b.start)) {
    if (frame >= m.end) x = m.toX;
    else if (frame > m.start) return m.fromX + ((m.toX - m.fromX) * (frame - m.start)) / Math.max(1, m.end - m.start);
  }
  return x;
}

/**
 * Where a Short's window stands over the stage when `marks` act (stage px, left edge), as ShotView aims it: on the marks'
 * middle with no one on the stage; on a lone character pulled toward the marks (loneWindowCentre); on the middle of
 * several characters; kept on the stage. (Speakers' turns are left out: the check asks where the window rests.)
 */
export function windowLeft(shot: Pick<V3Shot, "performers">, marks: readonly ActionMark[], frame: number, stageW: number, win: FrameWindow): number {
  const winW = win.width * stageW;
  const actors = shot.performers.map((p) => performerX(p, frame) * stageW);
  const mid = (Math.min(...marks.map((m) => m.x)) + Math.max(...marks.map((m) => m.x))) / 2;
  const centre = actors.length === 1 ? loneWindowCentre(actors[0]! / stageW, mid / stageW, win) * stageW : actors.length ? (Math.min(...actors) + Math.max(...actors)) / 2 : mid;
  return Math.min(stageW - winW, Math.max(0, centre - winW / 2));
}

/**
 * Each moment something acts on a Short's map outside its window, cut at its edge, or behind a character standing in
 * front of the map. Empty for a plan that is not a Short.
 */
export function mapFramingFaults(plan: Pick<V3RenderPlan, "fps" | "width" | "height" | "stage" | "shots">): MapFramingFault[] {
  if (!plan.stage || plan.height <= plan.width) return [];
  const stage = plan.stage;
  const win = shortWindow(stage, plan);
  const winW = win.width * stage.width;
  const faults: MapFramingFault[] = [];
  for (const shot of plan.shots) {
    const map = shot.geoMap;
    if (!map) continue;
    for (const frame of actionFrames(map)) {
      if (frame >= shot.duration || (shot.inserts ?? []).some((i) => frame >= i.start && frame < i.end)) continue;
      const marks = actionAt(map, frame, stage.width, stage.height);
      if (!marks.length) continue;
      const x0 = windowLeft(shot, marks, frame, stage.width, win);
      const out = marks.filter((m) => m.x + m.reach <= x0 || m.x - m.reach >= x0 + winW || m.y + m.reach <= 0 || m.y - m.reach >= stage.height);
      const edge = marks.filter((m) => !out.includes(m) && (m.x - m.reach < x0 || m.x + m.reach > x0 + winW || m.y - m.reach < 0 || m.y + m.reach > stage.height));
      const actors = shot.performers.map((p) => performerX(p, frame));
      const behind = marks.filter((m) => !out.includes(m) && !edge.includes(m) && actors.some((x) => behindFigure(m, x, stage.width, stage.height)));
      if (!out.length && !edge.length && !behind.length) continue;
      const names = (l: readonly ActionMark[]) => [...new Set(l.map((m) => m.name))].join(", ");
      faults.push({
        at: Math.round(((shot.start + frame) / plan.fps) * 10) / 10,
        shot: shot.id,
        ayrinti: [out.length ? `${names(out)} kadraj dışında` : "", edge.length ? `${names(edge)} kadraj kenarında kesik` : "", behind.length ? `${names(behind)} karakterin arkasında` : ""].filter(Boolean).join("; "),
      });
    }
  }
  return faults;
}
