/**
 * The video's shape by its length (owner decision, 2 Nov 2026; raised to 3 minutes 11 Nov 2026: "shorts videosu 60
 * saniyedi bunu 3 dakikaya çıkartmak istiyorum … 60 saniye kullanmak istemiyorum artık"): 180 seconds or less is a
 * vertical YouTube Short
 * (1080×1920), anything longer a normal 16:9 video. A Short keeps the same drawn world — sets, puppets and living maps
 * are laid out on the 16:9 stage as always — and a vertical window over the stage follows who speaks (ShotView); titles,
 * cards and speech are laid out on the vertical screen. No burned-in subtitles in either (owner, 2 Nov 2026: "koymasan
 * daha iyi").
 */
export const SHORTS_MAX_S = 180;

export const isShorts = (targetS: number): boolean => targetS <= SHORTS_MAX_S;

/**
 * Whether a finished video's length is right. A Short's ordered length is a ceiling, not a target (owner, 2 Nov 2026:
 * the first Short was flagged "51 s / target 60"): anything up to it passes, down to half of it. A normal video stays
 * within ±10% of its target.
 */
export function lengthOk(durationS: number, targetS: number): boolean {
  return isShorts(targetS) ? durationS <= targetS && durationS >= targetS / 2 : Math.abs(durationS - targetS) <= targetS * 0.1;
}

/** Where the director lays out every shot. */
export const STAGE_SIZE = { width: 1920, height: 1080 } as const;

/** A Short's frame. */
export const SHORTS_SIZE = { width: 1080, height: 1920 } as const;
