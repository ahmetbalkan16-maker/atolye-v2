import type { V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";
import { easeInOut } from "../character/rig";

/** How long the map's camera takes to reach a new view (seconds). */
export const CAMERA_MOVE_S = 2.4;

type Key = NonNullable<V3GeoMap["camera"]>[number];
type View = { x: number; y: number; zoom: number };

/**
 * The map's camera at a frame: it rests on the last key reached and glides to a new one as its line begins — from where
 * it is at that moment, so a key that comes while the camera is still on its way turns it smoothly instead of making it
 * jump back to the last key and start again (a move restarted from the previous target). Zoom goes in log space, so
 * zooming out and in feel equally fast.
 */
export function cameraAt(keys: readonly Key[] | undefined, frame: number, fps: number, width: number, height: number): View {
  if (!keys?.length) return { x: width / 2, y: height / 2, zoom: 1 };
  const move = fps * CAMERA_MOVE_S;
  let from: View = { x: keys[0]!.x, y: keys[0]!.y, zoom: keys[0]!.zoom };
  let to = from;
  let start = -Infinity;
  const at = (fr: number): View => {
    if (start === -Infinity) return to;
    const t = easeInOut(Math.min(1, Math.max(0, (fr - start) / move)));
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, zoom: Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * t) };
  };
  for (const key of keys.slice(1)) {
    if (key.frame > frame) break;
    from = at(key.frame);
    to = { x: key.x, y: key.y, zoom: key.zoom };
    start = key.frame;
  }
  return at(frame);
}
