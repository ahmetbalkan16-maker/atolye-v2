import React, { useEffect, useRef, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";

/**
 * A period picture's 2.5D move (owner, 6 Nov 2026, in place of the Wan 2.2 video model: "bu kadar yüke gerek yok"):
 * the picture's displacement map (DepthMaps, Depth Anything V2 Small on the processor) drives an SVG feDisplacementMap,
 * so along the Ken Burns drift near things travel further than far ones. Red holds 0.5 + (nearness − focus) × gain and
 * fades to 0.5 at the picture's edges (no gap opens there); green is 0.5 (no vertical shift). The browser does the
 * work while it draws the frame: no model, no card, no extra RAM at render time.
 */

/** The nearest thing's sideways travel over a whole shot, as a share of the stage's width (the 5 Nov trial's 3 %). */
export const DEPTH_SHIFT = 0.0375;

/**
 * The displacement's scale at `progress` (0..1, linear like the Ken Burns drift): near things go the way the picture
 * drifts, a little further each frame; a zoom-only drift gets a gentle sideways move to the right.
 */
export function depthShift(progress: number, kb: { readonly fromX: number; readonly toX: number } | undefined, width: number): number {
  const dir = kb && kb.toX !== kb.fromX ? Math.sign(kb.toX - kb.fromX) : 1;
  return -DEPTH_SHIFT * width * dir * (2 * Math.min(1, Math.max(0, progress)) - 1);
}

/**
 * The map as a data URL, held back from the frame until decoded (an feImage pointing at a file loads on its own, after
 * the frame would be taken). No map, or one that fails to load: undefined, the flat drift. The render is never left
 * waiting: an unmounted holder releases it.
 */
export function useDepthMap(src: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  const [handle] = useState(() => (src ? delayRender(`derinlik haritası ${src}`, { timeoutInMilliseconds: 60_000 }) : undefined));
  const released = useRef(false);
  const release = () => {
    if (handle !== undefined && !released.current) {
      released.current = true;
      continueRender(handle);
    }
  };
  useEffect(() => {
    if (!src || handle === undefined) return;
    let live = true;
    fetch(staticFile(src))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => new Promise<string>((ok, fail) => {
        const fr = new FileReader();
        fr.onload = () => ok(String(fr.result));
        fr.onerror = () => fail(fr.error);
        fr.readAsDataURL(b);
      }))
      .then(async (u) => {
        const im = new Image();
        im.src = u;
        await im.decode();
        if (live) setUrl(u);
        else release();
      })
      .catch(() => release());
    return () => {
      live = false;
      release();
    };
    // (`release` reads a ref; the handle and src are fixed for the holder's life.)
  }, [src, handle]);
  useEffect(() => {
    if (url) release();
  }, [url]);
  return url;
}

/** The SVG filter a picture refers to with CSS `filter: url(#id)`; `fit` follows the picture's object-fit. */
export function DepthFilter({ id, href, width, height, fit, shift }: { id: string; href: string; width: number; height: number; fit: "meet" | "slice"; shift: number }) {
  return (
    <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
      <defs>
        <filter id={id} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x={0} y={0} width={width} height={height} colorInterpolationFilters="sRGB">
          <feImage href={href} x={0} y={0} width={width} height={height} preserveAspectRatio={`xMidYMid ${fit}`} result="derinlik" />
          <feDisplacementMap in="SourceGraphic" in2="derinlik" scale={shift} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

/** A filter id safe inside CSS `url(#…)`. */
export const depthFilterId = (...parts: readonly (string | number)[]) => `derinlik-${parts.join("-").replace(/[^A-Za-z0-9_-]/g, "_")}`;
