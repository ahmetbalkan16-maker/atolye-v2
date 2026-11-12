import { transitionFrames, type V3Shot, type V3Transition } from "../../../src/lib/v3/render/RenderPlanTypes";
import { easeInOut, smootherstep } from "../character/rig";

/**
 * Shot transitions drawn over the picture before them (owner, 12 Nov 2026: "daha akıcı geçişler"). The outgoing shot
 * stays on screen under the incoming one for the incoming shot's transition frames (Episode extends its Sequence), so
 * a slide, an iris or a dissolve opens onto the last picture, not onto the dark ground (every transition read as a cut
 * to black). Pure: the smoke checks the arithmetic.
 */

/** How one of the two shots is drawn at a moment of a transition. */
export interface TransitionLayer {
  readonly opacity: number;
  /** Sideways move (frame px). */
  readonly dx: number;
  /** Darkening (0..1) of the picture. */
  readonly dim: number;
  /** Motion blur (px). */
  readonly blur: number;
  /** An ink iris: the radius (frame px) of the soft-edged circle the shot is seen through. */
  readonly iris?: { readonly cx: number; readonly cy: number; readonly r: number; readonly feather: number };
}

export interface TransitionLook {
  readonly incoming: TransitionLayer;
  readonly outgoing: TransitionLayer;
  /** White over both (0..1), never a whole white frame. */
  readonly flash: number;
}

const STILL: TransitionLayer = { opacity: 1, dx: 0, dim: 0, blur: 0 };
/** The white flash's strongest moment: the picture still shows through it. */
export const FLASH_PEAK = 0.88;
/** How far the outgoing picture is pushed aside while a slide covers it (share of the frame's width). */
export const SLIDE_PUSH = 0.3;

/** Progress (0 < t < 1) at frame `f` of a `frames`-long transition: no frame is all old or all new picture. */
export function transitionProgress(f: number, frames: number): number {
  return Math.min(1, Math.max(0, (f + 1) / (frames + 1)));
}

/** Frames the outgoing shot `prev` stays drawn under `next` (0 when next cuts in or does not follow straight on). */
export function exitFrames(prev: Pick<V3Shot, "start" | "duration">, next: Pick<V3Shot, "start" | "duration" | "transitionIn">, fps: number): number {
  return next.start === prev.start + prev.duration ? transitionFrames(next, fps) : 0;
}

/** Both shots' look at progress `t` of a `kind` transition on a `width` × `height` frame. */
export function transitionLook(kind: V3Transition, t: number, width: number, height: number): TransitionLook {
  const e = easeInOut(t);
  if (kind === "cozul") return { incoming: { ...STILL, opacity: smootherstep(t) }, outgoing: STILL, flash: 0 };
  if (kind === "kaydir") {
    // Slides in from the right over the last picture, which gives way a little and darkens; a touch of motion blur at
    // the fastest moment. The two always meet: the frame is never left showing the dark ground (the old slide-and-grow
    // left a dark band between two close maps, Kosovo 1389). A Short's whole frame slides, its window with it (measured
    // on the stage, the Taranto Short's window showed another part of the map).
    const blur = 4 * Math.sin(Math.PI * t) * (width / 1920);
    return { incoming: { ...STILL, dx: (1 - e) * width, blur }, outgoing: { ...STILL, dx: -SLIDE_PUSH * e * width, dim: 0.25 * e, blur }, flash: 0 };
  }
  if (kind === "murekkep") {
    // An ink iris with a soft edge, opening from a little under the middle until it has passed every corner.
    const cx = width / 2;
    const cy = height * 0.55;
    const feather = 70 * (width / 1920);
    const far = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
    return { incoming: { ...STILL, iris: { cx, cy, r: e * (far + feather), feather } }, outgoing: { ...STILL, dim: 0.2 * e }, flash: 0 };
  }
  if (kind === "beyaz") {
    // The white rises over the last picture, the new one appears under it at its height and the white clears.
    const up = t < 0.5;
    return { incoming: { ...STILL, opacity: up ? 0 : 1 }, outgoing: STILL, flash: FLASH_PEAK * smootherstep(up ? t * 2 : (1 - t) * 2) };
  }
  return { incoming: STILL, outgoing: STILL, flash: 0 };
}

/** A layer as CSS (on the shot's whole frame). */
export function layerStyle(l: TransitionLayer): Record<string, string | number> {
  const style: Record<string, string | number> = {};
  if (l.opacity < 1) style.opacity = l.opacity;
  if (l.dx) style.transform = `translateX(${l.dx}px)`;
  const filters = [...(l.blur > 0.05 ? [`blur(${l.blur.toFixed(2)}px)`] : []), ...(l.dim > 0.001 ? [`brightness(${(1 - l.dim).toFixed(3)})`] : [])];
  if (filters.length) style.filter = filters.join(" ");
  if (l.iris) {
    const mask = `radial-gradient(circle at ${l.iris.cx}px ${l.iris.cy}px, #000 ${Math.max(0, l.iris.r - l.iris.feather)}px, transparent ${l.iris.r}px)`;
    style.maskImage = mask;
    style.WebkitMaskImage = mask;
  }
  return style;
}

/** How long a period picture takes to fade in and out over the set (seconds; it was 6 frames, linear). */
export const INSERT_FADE_S = 0.4;

/**
 * A period picture's opacity at `frame` of its window `start`..`end` (shot frames): an eased fade at both ends, at most
 * a third of the window each; a picture the scene opens on is there at once (the shot's own transition brings it).
 */
export function insertOpacity(frame: number, start: number, end: number, fps: number): number {
  if (frame < start || frame >= end) return 0;
  const len = Math.max(1, Math.min(Math.round(fps * INSERT_FADE_S), Math.floor((end - start) / 3)));
  const fadeIn = start === 0 ? 1 : smootherstep(Math.min(1, (frame - start + 1) / (len + 1)));
  return Math.min(fadeIn, smootherstep(Math.min(1, (end - frame) / (len + 1))));
}
