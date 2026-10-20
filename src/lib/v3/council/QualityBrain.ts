import { promises as fs } from "node:fs";
import path from "node:path";
import type { AIProvider } from "../../ai/providers/AIProvider";
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

/** `rules`: the owner's standing rules from the brain's memory (faults the owner found that this check missed). */
export function qualityPrompt(donem: string, rules: readonly string[] = []): string {
  return `You are the quality checker of an animated history show for an American YouTube channel (flat cartoon puppets, drawn sets, maps, period pictures). The story is set in ${donem}.
Look at this frame for production faults only (not taste): a character cut in half by the frame edge, text cut off or printed over other text, unreadable text, a missing, empty or broken face or head, black or empty areas, a stretched or glitched image, an obviously modern object in a historical scene.
${rules.length ? `The owner also found these faults in earlier videos that this check missed — look for them too:\n${rules.map((r) => `- ${r}`).join("\n")}\n` : ""}Score 0–10 how clean the frame is (10 = no fault). Return ONLY JSON: {"puan": <0-10>, "sorunlar": ["<fault, Turkish, at most 12 words>"]}`;
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
      const out = await input.judge.generate(qualityPrompt(input.donem, input.rules), { images: [(await fs.readFile(frame)).toString("base64")], maxTokens: 200, jsonSchema: { type: "object", properties: { puan: { type: "integer" }, sorunlar: { type: "array", items: { type: "string" } } }, required: ["puan", "sorunlar"] } });
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
