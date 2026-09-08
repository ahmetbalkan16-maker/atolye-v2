/**
 * Atölye Brain Core — the living orb (Sprint 185).
 *
 * Pure presentational. All motion is CSS (see `BrainCore.css`, loaded by the
 * route): layered orbital rings, a breathing energy core, a bright nucleus,
 * drifting energy particles and scanning arcs. No canvas, no WebGL, no JS
 * animation loop — so it renders on the server and in `renderToStaticMarkup`.
 *
 * `size` is optional: omit it and the CSS `clamp()` makes the orb responsive;
 * pass it (e.g. from the smoke suite) to pin an exact pixel size.
 */

import { describeBrainCoreState, type BrainCoreState } from "./brainCore";

export interface BrainCoreOrbProps {
  readonly state: BrainCoreState;
  /** px — omit for the responsive `clamp()` size. */
  readonly size?: number;
  readonly showLabel?: boolean;
}

const RING_COUNT = 5;
const PARTICLE_COUNT = 6;

export function BrainCoreOrb({ state, size, showLabel = true }: BrainCoreOrbProps) {
  const info = describeBrainCoreState(state);
  const rootStyle: React.CSSProperties = { "--bc-intensity": info.intensity } as React.CSSProperties;
  if (typeof size === "number") {
    (rootStyle as Record<string, string>)["--bc-orb-size"] = `${size}px`;
  }

  return (
    <div className="bc-root bc-orb-root" data-hue={info.hue} data-state={state} style={rootStyle}>
      <div
        className="bc-orb"
        data-state={state}
        role="img"
        aria-label={`AYAS — ${info.label} (${info.tr})`}
      >
        <span className="bc-orb__halo" aria-hidden="true" />
        <span className="bc-orb__field bc-orb__field--a" aria-hidden="true" />
        <span className="bc-orb__field bc-orb__field--b" aria-hidden="true" />

        {Array.from({ length: RING_COUNT }, (_, index) => (
          <span key={index} className={`bc-orb__ring bc-orb__ring--${index + 1}`} aria-hidden="true" />
        ))}

        <span className="bc-orb__core" aria-hidden="true">
          <span className="bc-orb__nucleus" aria-hidden="true" />
        </span>

        <span className="bc-orb__particles" aria-hidden="true">
          {Array.from({ length: PARTICLE_COUNT }, (_, index) => (
            <span key={index} className={`bc-orb__particle bc-orb__particle--${index + 1}`} />
          ))}
        </span>

        <svg className="bc-orb__scan" viewBox="0 0 100 100" aria-hidden="true">
          <circle className="bc-orb__scan-arc bc-orb__scan-arc--1" cx="50" cy="50" r="45" pathLength={330} />
          <circle className="bc-orb__scan-arc bc-orb__scan-arc--2" cx="50" cy="50" r="38" pathLength={330} />
        </svg>
      </div>

      {showLabel ? (
        <p className="bc-pip" data-state={state}>
          <span className="bc-pip__dot" aria-hidden="true" />
          {info.label} · {info.tr}
        </p>
      ) : null}
    </div>
  );
}

export default BrainCoreOrb;
