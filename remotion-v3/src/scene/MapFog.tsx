import React from "react";
import type { V3GeoMap } from "../../../src/lib/v3/render/RenderPlanTypes";

type Fog = NonNullable<V3GeoMap["fog"]>;

/** Seconds the fog takes to come in from its line, and each bank to thin away once it lifts. */
export const FOG_IN_S = 2;
export const FOG_LIFT_S = 2.5;
/** How long after the fog starts lifting its last bank starts going (the banks go one after another, not all at once). */
export const FOG_LIFT_SPREAD_S = 2;

/**
 * The fog's banks at `frame` (owner, 20 Nov 2026, the Lake Trasimene Short after Historia Civilis' map: a soft band of
 * fog over the valley hiding the army on the hills): each bank drifts slowly back and forth along the valley and
 * breathes a little, all of it fading in from `start`; from `end` the banks thin away one after another, spreading a
 * little as they go. A pure function of the frame (no blur filter: the softness is each bank's radial gradient).
 */
export function fogBanksAt(fog: Fog, frame: number, fps: number): { x: number; y: number; rx: number; ry: number; opacity: number }[] {
  if (frame < fog.start) return [];
  const t = (frame - fog.start) / fps;
  const comeIn = Math.min(1, t / FOG_IN_S);
  return fog.banks.flatMap((b) => {
    const lift = fog.end === undefined ? 0 : Math.max(0, Math.min(1, ((frame - fog.end) / fps - b.seed * FOG_LIFT_SPREAD_S) / FOG_LIFT_S));
    const opacity = comeIn * (1 - lift) * (0.75 + 0.25 * Math.sin(t * 0.21 + b.seed * 17));
    if (opacity <= 0.005) return [];
    // A slow sway along the valley (a 30–40 s swing over about a fifth of a bank), a slower rise and fall.
    const sway = Math.sin(t * (0.16 + b.seed * 0.05) + b.seed * Math.PI * 2) * b.rx * 0.22;
    const heave = Math.sin(t * 0.11 + b.seed * 9) * b.ry * 0.12;
    const breathe = 1 + 0.07 * Math.sin(t * 0.27 + b.seed * 23);
    const spread = 1 + lift * 0.35;
    return [{ x: b.x + sway, y: b.y + heave, rx: b.rx * breathe * spread, ry: b.ry * breathe * spread, opacity }];
  });
}

/**
 * The fog drawn on the map's ground (MapView passes it under the close map's names, CloseGround's `veil`): soft white
 * banks of a radial gradient, see-through so the ground and the road show under it.
 */
export function MapFog({ fog, frame, fps, gid }: { fog: Fog; frame: number; fps: number; gid: string }) {
  const banks = fogBanksAt(fog, frame, fps);
  if (!banks.length) return null;
  return (
    <g pointerEvents="none">
      <defs>
        <radialGradient id={`${gid}-fog`}>
          <stop offset="0%" stopColor="#eef1ee" stopOpacity={0.62} />
          <stop offset="45%" stopColor="#e6ebe8" stopOpacity={0.45} />
          <stop offset="75%" stopColor="#dfe5e2" stopOpacity={0.18} />
          <stop offset="100%" stopColor="#dfe5e2" stopOpacity={0} />
        </radialGradient>
      </defs>
      {banks.map((b, i) => (
        <ellipse key={i} cx={b.x} cy={b.y} rx={b.rx} ry={b.ry} fill={`url(#${gid}-fog)`} opacity={b.opacity} />
      ))}
    </g>
  );
}
