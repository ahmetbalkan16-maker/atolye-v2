import React, { useLayoutEffect, useRef, useState } from "react";
import { Artifact, continueRender, delayRender, getRemotionEnvironment, useCurrentFrame, useVideoConfig } from "remotion";
import type { V3LayoutBox, V3LayoutFrame, V3LayoutKind } from "../../../src/lib/v3/render/RenderPlanTypes";

/**
 * Where the marked things are on screen, written by the render itself (owner, 2 Nov 2026: the quality exam's faults were
 * mostly geometry — a badge, a label or a state's name cut by the frame edge, text over text — which a 12 B vision
 * model barely sees on a 960 px frame, while the composition knows every box). Every element carrying
 * `data-yer="<kind>"` is measured on every `every`-th frame and the boxes go out as a Remotion artifact
 * (`out/Episode/<dir>/<frame>.json`, collected by ChunkedRender); src/lib/v3/council/LayoutCheck.ts judges them.
 */
export const LAYOUT_ATTR = "data-yer";

/** Spread on an element to mark it (kinds: V3LayoutKind): `<g {...yer("rozet", b.label)}>`. */
export const yer = (kind: V3LayoutKind, name?: string): Record<string, string> => ({ [LAYOUT_ATTR]: kind, ...(name ? { "data-ad": name } : {}) });

/** Under this an element is fading in or out and not judged. */
const MIN_OPACITY = 0.5;

function opacityOf(el: Element, root: Element): number {
  let a = 1;
  for (let e: Element | null = el; e && e !== root; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.display === "none" || s.visibility === "hidden") return 0;
    a *= Number(s.opacity);
  }
  return a;
}

/** Speech and name tags are lettering in a wider box: their text's own extent is measured (a balanced line is narrower than its box, an extra line grows out of it). */
const TEXT_EXTENT: ReadonlySet<string> = new Set(["balon", "ad"]);

function boxOf(el: Element): DOMRect {
  if (!TEXT_EXTENT.has(el.getAttribute(LAYOUT_ATTR) ?? "")) return el.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect();
}

export function measureLayout(root: Element, width: number): V3LayoutBox[] {
  const frame = root.getBoundingClientRect();
  // CSS pixels are the composition's (Remotion scales output through the device scale). On a render tab's first frame
  // the root measured ~1 px wide while its contents stood at full size: no scale is taken from such a root.
  const s = frame.width >= width / 2 ? width / frame.width : 1;
  const out: V3LayoutBox[] = [];
  root.querySelectorAll(`[${LAYOUT_ATTR}]`).forEach((el) => {
    const r = boxOf(el);
    if (r.width < 1 || r.height < 1 || opacityOf(el, root) < MIN_OPACITY) return;
    const name = (el.getAttribute("data-ad") ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 48);
    const round = (v: number) => Math.round(v * s);
    out.push({ tur: el.getAttribute(LAYOUT_ATTR) as V3LayoutKind, ad: name, x: round(r.left - frame.left), y: round(r.top - frame.top), w: round(r.width), h: round(r.height) });
  });
  return out;
}

/**
 * Measures `root` on every `every`-th frame once its fonts are in (a text's box depends on them) and emits the boxes.
 * The frame is held (delayRender) until the artifact is registered. Off outside a render (Studio, Player).
 */
export function LayoutProbe({ root, every, dir }: { root: React.RefObject<HTMLDivElement | null>; every: number; dir: string }) {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const probing = getRemotionEnvironment().isRendering && every > 0 && frame % every === 0;
  const [shot, setShot] = useState<{ frame: number; json: string }>();
  const held = useRef<number | undefined>(undefined);
  const release = () => {
    if (held.current === undefined) return;
    continueRender(held.current);
    held.current = undefined;
  };
  useLayoutEffect(() => {
    if (!probing) return;
    held.current = delayRender(`yerleşim ölçümü, kare ${frame}`);
    let live = true;
    void document.fonts.ready.then(() => {
      if (!live) return;
      const boxes = root.current ? measureLayout(root.current, width) : [];
      setShot({ frame, json: JSON.stringify({ kare: frame, ogeler: boxes } satisfies V3LayoutFrame) });
    });
    return () => {
      live = false;
      release();
    };
  }, [frame, probing, root, width]);
  // The artifact's own layout effect (a child) has registered it by now.
  useLayoutEffect(() => {
    if (shot && shot.frame === frame) release();
  }, [shot, frame]);
  return shot && shot.frame === frame && probing ? <Artifact filename={`${dir}/${frame}.json`} content={shot.json} /> : null;
}
