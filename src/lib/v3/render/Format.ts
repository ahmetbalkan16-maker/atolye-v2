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
 * The shortest a finished Short may be: its ordered length is a ceiling, not a target (owner, 2 Nov 2026: the first
 * Short was flagged "51 s / target 60"), but not much under it (owner, 13 Nov 2026: "en fazla 3 dakika olsun ama 2:30
 * dakikanın altına fazla inmesin"; half of it let 107 s pass for 180 s): 80%, 144 s of a 3-minute Short.
 */
export const shortsMinS = (targetS: number): number => targetS * 0.8;

/** Whether a finished video's length is right: a Short from shortsMinS up to its ordered length, a normal video ±10%. */
export function lengthOk(durationS: number, targetS: number): boolean {
  return isShorts(targetS) ? durationS <= targetS && durationS >= shortsMinS(targetS) : Math.abs(durationS - targetS) <= targetS * 0.1;
}

/**
 * The top of lengthOk's band: a Short's ordered length, a normal video's +10%. The timeline is fitted under it
 * (Timeline.fitTimeline) — a Short's since 13 Nov 2026, a long video's too since 14 Nov 2026 (the Shorts' improvements in
 * the long video: a voice slower than the writer's word budget ran a 20-minute video past its band with only a warning).
 */
export const lengthTopS = (targetS: number): number => (isShorts(targetS) ? targetS : targetS * 1.1);

/** Where the director lays out every shot. */
export const STAGE_SIZE = { width: 1920, height: 1080 } as const;

/** A Short's frame. */
export const SHORTS_SIZE = { width: 1080, height: 1920 } as const;

/**
 * How a Short fills its vertical frame. "dondur" (owner, 12 Nov 2026: "shorts videosu hazırlarken bütün sahnelerin
 * gözüktüğünden emin ol, çok yakın duruyor video; yatay videoyu sadece döndürülmüş gibi shorts videoyu ayarla"): the
 * Short is made exactly like a 16:9 video — every scene whole, every check on the full frame — and only the file to
 * upload is turned a quarter clockwise into 1080×1920, so a viewer who turns the phone sees the whole picture full
 * screen. "dikey" (2 Nov – 12 Nov 2026): a vertical window slides over the 16:9 stage (ShotView) — it showed about a
 * third of the stage's width. `ATOLYE_V3_SHORTS_BICIM=dikey` brings the window back.
 */
export type ShortsLayout = "dondur" | "dikey";
export const shortsLayout = (env: Readonly<Record<string, string | undefined>> = process.env): ShortsLayout => (env.ATOLYE_V3_SHORTS_BICIM?.trim() === "dikey" ? "dikey" : "dondur");

/** The frame the director lays a video out for: a Short's vertical window only in the "dikey" layout. */
export const outputFrame = (shorts: boolean, layout: ShortsLayout): { readonly width: number; readonly height: number } | undefined => (shorts && layout === "dikey" ? SHORTS_SIZE : undefined);

/**
 * FFmpeg arguments turning a finished 16:9 video a quarter clockwise into the Short's 1080×1920 upload file: the top of
 * the picture goes to the right edge, so it stands upright when the phone is turned to the left (the usual landscape
 * hold). The sound is copied; the picture is encoded once more (H.264, high quality, YouTube's 4:2:0).
 */
export function rotatedShortArgs(input: string, output: string): string[] {
  return ["-v", "error", "-y", "-i", input, "-vf", "transpose=clock", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", output];
}
