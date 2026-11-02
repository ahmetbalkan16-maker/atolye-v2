/**
 * The video's shape by its length (owner decision, 2 Nov 2026): 60 seconds or less is a vertical YouTube Short
 * (1080×1920), anything longer a normal 16:9 video. A Short keeps the same drawn world — sets, puppets and living maps
 * are laid out on the 16:9 stage as always — and a vertical window over the stage follows who speaks (ShotView); titles,
 * cards and speech are laid out on the vertical screen. No burned-in subtitles in either (owner, 2 Nov 2026: "koymasan
 * daha iyi").
 */
export const SHORTS_MAX_S = 60;

export const isShorts = (targetS: number): boolean => targetS <= SHORTS_MAX_S;

/** Where the director lays out every shot. */
export const STAGE_SIZE = { width: 1920, height: 1080 } as const;

/** A Short's frame. */
export const SHORTS_SIZE = { width: 1080, height: 1920 } as const;
