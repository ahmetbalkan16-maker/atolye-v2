import { promises as fs } from "node:fs";
import path from "node:path";
import type { AIProvider } from "../../ai/providers/AIProvider";
import { type CandidateVerdict, fitScore, passes, pickBackground, verdictLine } from "../backgrounds/BackgroundJudge";
import type { Episode } from "../episode/EpisodeTypes";
import type { V3Accessory, V3Background, V3CastMember, V3Emotion, V3Gesture, V3RenderPlan } from "../render/RenderPlanTypes";
import { renderWithRemotion } from "../render/RemotionRunner";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";

/**
 * The episode's YouTube thumbnail (owner approval 20 Oct 2026; the higgsfield-youtube-thumbnail skill's rules without
 * its paid service): drawn by our own renderer from the episode's own characters and sets — one large focal
 * character with an emotion, or two rivals face to face — under a 2–4 word headline in heavy outlined letters. Each
 * variant is judged at feed size (a small picture) for a clear subject, a readable headline, emotion and curiosity,
 * and truthfulness; the best becomes `kapak.jpg` (1280×720, under YouTube's 2 MB).
 */
export interface ThumbnailVariant {
  readonly ad: string;
  readonly baslik: string;
  readonly file: string;
  readonly secim?: CandidateVerdict;
}

export interface ThumbnailResult {
  readonly file: string;
  readonly secim?: CandidateVerdict;
  readonly esikAlti: boolean;
  readonly varyantlar: readonly ThumbnailVariant[];
}

interface Pose {
  readonly castId: string;
  readonly x: number;
  readonly facing: "left" | "right";
  readonly emotion: V3Emotion;
  readonly gesture: V3Gesture;
  readonly toward?: "left" | "right";
}

interface VariantPlan {
  readonly ad: string;
  readonly baslik: string;
  readonly background: V3Background;
  readonly poses: readonly Pose[];
  readonly zoom: number;
  readonly cx: number;
}

/** Visible cast members by how many lines they speak, most first. */
export function mainCharacters(episode: Episode, castIds: ReadonlySet<string>): string[] {
  const n = new Map<string, number>();
  for (const s of episode.sahneler) for (const l of s.satirlar) if (castIds.has(l.karakter)) n.set(l.karakter, (n.get(l.karakter) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** The variants worth drawing: a portrait of the lead, the two leads face to face, a portrait of the second lead. */
export function thumbnailPlans(episode: Episode, leads: readonly string[], sets: readonly V3Background[], headlines: readonly string[]): VariantPlan[] {
  const [a, b] = leads;
  if (!a) return [];
  const sceneOf = (ids: readonly string[]) => Math.max(0, episode.sahneler.findIndex((s) => ids.every((id) => s.satirlar.some((l) => l.karakter === id))));
  const bg = (i: number) => sets[i] ?? sets[0]!;
  const h = (i: number) => headlines[i] ?? headlines[0] ?? episode.baslik;
  const out: VariantPlan[] = [{ ad: "portre", baslik: h(0), background: bg(sceneOf([a])), poses: [{ castId: a, x: 0.6, facing: "left", emotion: "saskin", gesture: "sasir" }], zoom: 1.6, cx: 0.6 }];
  if (b) {
    out.push({ ad: "catisma", baslik: h(1), background: bg(sceneOf([a, b])), poses: [{ castId: a, x: 0.33, facing: "right", emotion: "kizgin", gesture: "isaret_et", toward: "right" }, { castId: b, x: 0.67, facing: "left", emotion: "saskin", gesture: "sasir" }], zoom: 1.3, cx: 0.5 });
    out.push({ ad: "portre-2", baslik: h(2), background: bg(sceneOf([b])), poses: [{ castId: b, x: 0.4, facing: "right", emotion: "kararli", gesture: "yumruk_kaldir" }], zoom: 1.6, cx: 0.4 });
  }
  return out;
}

export async function designThumbnail(input: {
  readonly paths: V3Paths;
  readonly episode: Episode;
  readonly cast: readonly V3CastMember[];
  readonly accessories: readonly V3Accessory[];
  /** Each scene's set as in the render plan (`src` under the episode's public dir). */
  readonly sets: readonly V3Background[];
  readonly publicDir: string;
  readonly headlines: readonly string[];
  readonly judge: AIProvider;
  readonly workDir: string;
  readonly log: (s: string) => void;
}): Promise<ThumbnailResult | undefined> {
  const { paths, episode, log } = input;
  const leads = mainCharacters(episode, new Set(input.cast.map((c) => c.id)));
  const plans = thumbnailPlans(episode, leads, input.sets, input.headlines);
  if (!plans.length) return undefined;
  const dir = path.join(input.workDir, "kapak-varyantlar");
  await fs.mkdir(dir, { recursive: true });
  const variants: ThumbnailVariant[] = [];
  for (const v of plans) {
    const cast = input.cast.filter((c) => v.poses.some((p) => p.castId === c.id));
    const plan: V3RenderPlan = {
      version: 1,
      episodeId: `${episode.id}-kapak`,
      title: episode.baslik,
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 30,
      cast,
      accessories: [...input.accessories],
      captions: [],
      showCaptions: false,
      shots: [
        {
          id: "kapak",
          sceneId: "kapak",
          start: 0,
          duration: 30,
          background: v.background,
          performers: v.poses.map((p) => ({ castId: p.castId, x: p.x, depth: 0, facing: p.facing, moves: [], gestures: [{ gesture: p.gesture, start: 0, end: 30, ...(p.toward ? { toward: p.toward } : {}) }], faces: [{ start: 0, emotion: p.emotion }], visemes: [], effects: [], speaking: [] })),
          props: [],
          camera: [{ frame: 0, zoom: v.zoom, cx: v.cx, cy: 0.62 }],
          shakes: [],
          titleCards: [{ text: v.baslik, start: 0, end: 30, style: "kucukresim" }],
          mapArrows: [],
          transitionIn: "kes",
          dramatized: false,
        },
      ],
    };
    const planFile = path.join(dir, `${v.ad}-plan.json`);
    await fs.writeFile(planFile, JSON.stringify({ plan }));
    const still = path.join(dir, `${v.ad}.png`);
    await renderWithRemotion(paths, { planFile, publicDir: input.publicDir, out: still, kind: "still", frame: 26 });
    const file = path.join(dir, `${v.ad}.jpg`);
    await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", still, "-vf", "scale=1280:720", "-q:v", "2", file]);
    await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", still, "-vf", "scale=480:270", "-q:v", "3", path.join(dir, `${v.ad}-kucuk.jpg`)]);
    await fs.rm(still, { force: true });
    variants.push({ ad: v.ad, baslik: v.baslik, file });
  }
  // Judged at feed size, where a thumbnail lives or dies.
  const judged: ThumbnailVariant[] = [];
  for (const v of variants) {
    const pick = await pickBackground([{ title: `kapak ${v.ad}`, small: v.file.replace(/\.jpg$/, "-kucuk.jpg") }], { konu: `${episode.baslik} — ${episode.konu}`, donem: episode.donem, mekan: "thumbnail", tr: v.baslik, en: v.baslik, anlatim: "" }, input.judge, (c) => fs.readFile(c.small), log, { mode: "kapak", max: 1 });
    const s = pick.verdicts[0];
    if (s) log(`  kapak ${v.ad} ${passes(s) ? "✓" : "·"} ${verdictLine(s)}`);
    judged.push({ ...v, ...(s ? { secim: s } : {}) });
  }
  const best = [...judged].sort((x, y) => (y.secim ? fitScore(y.secim) : -1) - (x.secim ? fitScore(x.secim) : -1))[0]!;
  const file = path.join(input.workDir, "kapak.jpg");
  await fs.copyFile(best.file, file);
  return { file, ...(best.secim ? { secim: best.secim } : {}), esikAlti: !best.secim || !passes(best.secim), varyantlar: judged };
}
