import { promises as fs } from "node:fs";
import path from "node:path";
import type { EpisodeScene, ScenePicture } from "../episode/EpisodeTypes";
import { runChecked } from "../util/Proc";

/**
 * The pictures of a scene's moments (owner, 23 Oct 2026, after DFT Tarih): the scene's own period picture and its further
 * `gorseller`, each searched online (archive film first when asked), and painted when nothing passes the judge.
 */

/** A picture the scene asks for: its own (`ana`, from `arka_plan_sorgusu`) or one of its `gorseller` (by index). */
export interface PictureRequest {
  readonly slot: "ana" | number;
  readonly satir: number;
  readonly en: string;
  readonly wiki?: string;
  readonly ara?: readonly string[];
  readonly an?: string;
  readonly film?: boolean;
  readonly commonsCategory?: string;
}

/** The scene's further pictures as requests (its own picture is searched by the caller's existing path). */
export function pictureRequests(scene: Pick<EpisodeScene, "gorseller">): PictureRequest[] {
  return (scene.gorseller ?? []).map((g: ScenePicture, i) => ({ slot: i, satir: g.satir, en: g.en, ...(g.wiki ? { wiki: g.wiki } : {}), ...(g.ara?.length ? { ara: g.ara } : {}), ...(g.an ? { an: g.an } : {}), ...(g.film ? { film: true } : {}) }));
}

/**
 * At most this many moments are painted for one video (two drawings of ~40 s each on the 12 GB card, under the GPU
 * rule): one a minute, at least four — the pictures' 6–10% share of a 20-minute video is about 15–20 of them.
 */
export function maxDesignedPictures(seconds: number): number {
  return Math.max(4, Math.round(seconds / 60));
}

/** How long an archive film clip is cut (seconds): longer than any cutaway, so the clip never runs out on screen. */
export const FILM_CLIP_S = 12;

/**
 * Cuts an archive film to a clip the renderer plays: from a little way in (newsreels open on title cards) for
 * FILM_CLIP_S seconds, letterboxed into 1920×1080, silent, H.264. Returns false when the film cannot be read.
 */
export async function cutFilmClip(ffmpeg: string, ffprobe: string, input: string, output: string): Promise<boolean> {
  const probe = await runChecked(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", input]).catch(() => undefined);
  const duration = Number(probe?.stdout.trim());
  if (!Number.isFinite(duration) || duration < 3) return false;
  const start = duration > FILM_CLIP_S + 4 ? Math.min(20, duration * 0.15) : 0;
  await fs.mkdir(path.dirname(output), { recursive: true });
  const r = await runChecked(ffmpeg, ["-v", "error", "-y", "-ss", start.toFixed(2), "-i", input, "-t", String(Math.min(FILM_CLIP_S, duration - start)), "-an", "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0b0a0d,fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", output], { timeoutMs: 10 * 60_000 }).catch(() => undefined);
  return Boolean(r);
}

/** The source plate of a designed picture: plainly not a period image. */
export function designedCaption(language: "tr" | "en"): string {
  return language === "en" ? "Designed illustration of the moment · not a period image" : "Tasarlanmış görsel · dönem görseli değil";
}

/** The source plate of an archive film clip. */
export function filmCaption(caption: string, language: "tr" | "en"): string {
  return `${language === "en" ? "Archive film" : "Arşiv filmi"} · ${caption}`;
}
