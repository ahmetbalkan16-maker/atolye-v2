/**
 * Atölye Brain Core — the living orb (Sprint 184).
 *
 * Pure presentational. All motion is CSS (see `BrainCore.css`, loaded by the
 * route). No canvas, no WebGL, no JS animation loop — so this renders fine on
 * the server and in `renderToStaticMarkup` for the smoke suite.
 */

import { describeBrainCoreState, type BrainCoreState } from "./brainCore";

export interface BrainCoreOrbProps {
  readonly state: BrainCoreState;
  /** px; defaults to 220. */
  readonly size?: number;
  readonly showLabel?: boolean;
}

export function BrainCoreOrb({ state, size = 220, showLabel = true }: BrainCoreOrbProps) {
  const info = describeBrainCoreState(state);
  return (
    <div
      className="bc-root"
      data-hue={info.hue}
      style={
        {
          "--bc-intensity": info.intensity,
          "--bc-orb-size": `${size}px`,
        } as React.CSSProperties
      }
    >
      <div
        className="bc-orb"
        data-state={state}
        role="img"
        aria-label={`Brain Core — ${info.label} (${info.tr})`}
      >
        <span className="bc-orb__halo" aria-hidden="true" />
        <span className="bc-orb__ring bc-orb__ring--1" aria-hidden="true" />
        <span className="bc-orb__ring bc-orb__ring--2" aria-hidden="true" />
        <span className="bc-orb__ring bc-orb__ring--3" aria-hidden="true" />
        <span className="bc-orb__core" aria-hidden="true" />
        <span className="bc-orb__particles" aria-hidden="true">
          <span className="bc-orb__particle" />
          <span className="bc-orb__particle" />
          <span className="bc-orb__particle" />
        </span>
        <svg className="bc-orb__scan" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="44" pathLength={326} />
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
