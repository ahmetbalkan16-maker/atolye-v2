/**
 * Stage 15J — the prop library.
 *
 * A closed set of simple objects. A hand prop is held by a character; a stage prop stands on the ground at a place
 * the blocking gives it. Each is drawn from a few primitives by the renderer; none is an image file.
 */
export const HAND_PROPS = Object.freeze(["SWORD", "SPEAR", "SHIELD", "FLAG", "SCROLL", "BOW", "TORCH"] as const);
export type HandProp = (typeof HAND_PROPS)[number];
export const STAGE_PROPS = Object.freeze(["CANNON", "TENT", "THRONE", "TREE", "SHIP", "TOWER", "HORSE", "TABLE"] as const);
export type StageProp = (typeof STAGE_PROPS)[number];

/** Width and height of a stage prop in pixels at scale 1. */
export const STAGE_PROP_SIZE: Readonly<Record<StageProp, { readonly width: number; readonly height: number }>> = Object.freeze({
  CANNON: { width: 260, height: 120 }, TENT: { width: 340, height: 260 }, THRONE: { width: 180, height: 300 }, TREE: { width: 220, height: 380 },
  SHIP: { width: 520, height: 360 }, TOWER: { width: 200, height: 520 }, HORSE: { width: 360, height: 300 }, TABLE: { width: 280, height: 130 },
});

export function isHandProp(value: unknown): value is HandProp { return typeof value === "string" && (HAND_PROPS as readonly string[]).includes(value); }
export function isStageProp(value: unknown): value is StageProp { return typeof value === "string" && (STAGE_PROPS as readonly string[]).includes(value); }
