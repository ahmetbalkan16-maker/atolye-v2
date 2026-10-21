import { promises as fs } from "node:fs";
import path from "node:path";
import type { AIProvider } from "../../ai/providers/AIProvider";
import type { V3RenderPlan } from "../render/RenderPlanTypes";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";
import { type CouncilLog, readJsonAnswer } from "./Council";

/**
 * The quality brain (Kalite beyni) watches the finished video the way the owner asked a person to: a frame every few
 * seconds goes to the local vision model, which looks for production faults (a character cut by the frame edge, text
 * cut off or on top of other text, a missing or broken face, empty or glitched areas, a modern object in a historical
 * scene). Faults become council findings with their time, for the chief and AYAS.
 */
export const QUALITY_BAR = 7;

/** A stretch of the video that shows something modern on purpose (the channel's own cards), in seconds. */
export interface DesignedWindow {
  readonly from: number;
  readonly to: number;
  readonly what: string;
}

const DESIGNED: Readonly<Partial<Record<V3RenderPlan["shots"][number]["titleCards"][number]["style"], string>>> = {
  kapak: "the episode's title cover (modern lettering)",
  abone: "the channel's own end card (a SUBSCRIBE button and a bell icon)",
};

/**
 * Where the plan puts the channel's own cards. Until 21 Oct 2026 the quality brain scored the closing SUBSCRIBE card
 * 0/10 as "a modern button in a historical scene" and the episode was delivered with a warning.
 */
export function designedWindows(plan: Pick<V3RenderPlan, "fps" | "shots">): DesignedWindow[] {
  return plan.shots.flatMap((s) => s.titleCards.flatMap((c) => (DESIGNED[c.style] ? [{ from: (s.start + c.start) / plan.fps, to: (s.start + c.end) / plan.fps, what: DESIGNED[c.style]! }] : [])));
}

/**
 * `rules`: the owner's standing rules from the brain's memory (faults the owner found that this check missed);
 * `designed`: what this frame shows on purpose (never a fault).
 */
export function qualityPrompt(donem: string, rules: readonly string[] = [], designed?: string): string {
  return `You are the quality checker of an animated history show for an American YouTube channel (flat cartoon puppets, drawn sets, maps, period pictures). The story is set in ${donem}.
Look at this frame for production faults only (not taste): a character cut in half by the frame edge, text cut off or printed over other text, unreadable text, a missing, empty or broken face or head, black or empty areas, a stretched or glitched image, an obviously modern object in a historical scene, a building or symbol of a later era than ${donem} (in antiquity: a church, a cross on a roof or tower, a bell tower, a medieval castle; before Islam: a minaret).
Part of the show, never a fault: the small source line under a real picture (title, artist, year, source), a sash, belt or scroll a cartoon character wears or holds, and in a real photo of ruins as they stand today a little of today far off (the Rome run of 21 Oct 2026 flagged all three).
${rules.length ? `The owner also found these faults in earlier videos that this check missed — look for them too:\n${rules.map((r) => `- ${r}`).join("\n")}\n` : ""}${designed ? `By design this frame shows ${designed}; that is not a fault — judge only the rest of the frame.
` : ""}Score 0–10 how clean the frame is (10 = no fault). Return ONLY JSON: {"puan": <0-10>, "sorunlar": ["<fault, Turkish, at most 12 words>"]}`;
}

export async function qualityReview(input: {
  readonly paths: V3Paths;
  readonly video: string;
  readonly durationS: number;
  readonly donem: string;
  readonly judge: AIProvider;
  readonly council: CouncilLog;
  readonly log: (s: string) => void;
  readonly everyS?: number;
  readonly maxFrames?: number;
  readonly rules?: readonly string[];
  readonly designed?: readonly DesignedWindow[];
}): Promise<{ checked: number; faulty: number; averageScore: number }> {
  const { paths, council } = input;
  const every = input.everyS ?? 6;
  const times: number[] = [];
  for (let t = 2; t < input.durationS - 0.5 && times.length < (input.maxFrames ?? 18); t += every) times.push(t);
  await fs.mkdir(paths.asciiTemp, { recursive: true });
  let faulty = 0;
  let sum = 0;
  for (const t of times) {
    const frame = path.join(paths.asciiTemp, `kalite-${Date.now()}-${Math.round(t * 10)}.jpg`);
    try {
      await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-ss", t.toFixed(2), "-i", input.video, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "4", frame]);
      const designed = input.designed?.find((w) => t >= w.from && t <= w.to)?.what;
      const out = await input.judge.generate(qualityPrompt(input.donem, input.rules, designed), { images: [(await fs.readFile(frame)).toString("base64")], maxTokens: 200, jsonSchema: { type: "object", properties: { puan: { type: "integer" }, sorunlar: { type: "array", items: { type: "string" } } }, required: ["puan", "sorunlar"] } });
      const v = readJsonAnswer<{ puan?: unknown; sorunlar?: unknown[] }>(typeof out === "string" ? out : out.content);
      const score = typeof v?.puan === "number" ? Math.max(0, Math.min(10, Math.round(v.puan))) : QUALITY_BAR;
      sum += score;
      const faults = (v?.sorunlar ?? []).map(String).filter(Boolean).slice(0, 3);
      if (score < QUALITY_BAR && faults.length) {
        faulty++;
        council.find({ beyin: "kalite", onem: score < 5 ? "eksik" : "uyari", baslik: "karede sorun", ayrinti: faults.join("; "), tur: "veri", yer: `${t.toFixed(0)}. sn (puan ${score}/10)` });
      }
    } catch (e) {
      input.log(`  kalite: ${t.toFixed(0)}. sn incelenemedi (${(e as Error).message.slice(0, 80)})`);
    } finally {
      await fs.rm(frame, { force: true });
    }
  }
  return { checked: times.length, faulty, averageScore: times.length ? sum / times.length : 0 };
}
