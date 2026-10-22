import type { EpisodeScene } from "../episode/EpisodeTypes";
import type { V3Background } from "../render/RenderPlanTypes";

/** A stable number from a text: the same scene of the same episode always draws the same hills, trees and houses. */
export function setSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The scene's drawn living set (its "ortam"), or undefined when the script gave none. */
export function drawnBackground(scene: EpisodeScene, episodeId: string): V3Background | undefined {
  const o = scene.ortam;
  if (!o) return undefined;
  return {
    src: "",
    kind: "drawn",
    drawn: { zaman: o.zaman, manzara: o.manzara, uslup: o.uslup, ...(o.hava ? { hava: o.hava } : {}), ...(o.isik ? { isik: o.isik } : {}), ...(o.nehir ? { nehir: o.nehir } : {}), tohum: setSeed(`${episodeId}/${scene.id}`) },
  };
}
