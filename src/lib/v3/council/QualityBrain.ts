import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { AIProvider } from "../../ai/providers/AIProvider";
import type { V3RenderPlan } from "../render/RenderPlanTypes";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";
import { type CouncilLog, readJsonAnswer } from "./Council";
import { exampleDir, type Lesson, recall, remember } from "./ExperienceMemory";

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
export function qualityPrompt(donem: string, rules: readonly string[] = [], designed?: string, said?: string, pointed?: { readonly kind?: FrameKind; readonly examples?: readonly Pick<FrameExample, "kusurlu" | "metin">[]; readonly edges?: boolean }): string {
  const checks = pointed ? frameChecks(pointed.kind) : [];
  return `You are the quality checker of an animated history show for an American YouTube channel (flat cartoon puppets, drawn sets, maps, period pictures). The story is set in ${donem}.
Look at this frame for production faults only (not taste): a character cut in half by the frame edge, text cut off or printed over other text, unreadable text, a missing, empty or broken face or head, black or empty areas, a stretched or glitched image, an obviously modern object in a historical scene, a building or symbol of a later era than ${donem} (in antiquity: a church, a cross on a roof or tower, a bell tower, a medieval castle; before Islam: a minaret).
Part of the show, never a fault: the small source line under a real picture (title, artist, year, source), a sash, belt or scroll a cartoon character wears or holds, and in a real photo of ruins as they stand today a little of today far off (the Rome run of 21 Oct 2026 flagged all three); on a map, a ruler's round portrait badge with his name on a scroll under it, and the names of states, cities, seas and rivers; a crowd of soldiers or people who all wear the same uniform (the benchmark run of 22 Oct 2026 flagged these).
${rules.length ? `The owner also found these faults in earlier videos that this check missed — look for them too:\n${rules.map((r) => `- ${r}`).join("\n")}\n` : ""}${designed ? `By design this frame shows ${designed}; that is not a fault — judge only the rest of the frame.
` : ""}${said ? `The narration at this moment says: "${said.slice(0, 240)}"
Also score "anlati" 0–10: does the picture SHOW what is being said happening — who moves, arrives, fights, flees, what changes, where it is (owner: the viewer must live the moment)? A still picture of people standing while a march or a battle is told is 0–3; the told action happening on screen is 8–10.
` : ""}${pointed ? examplesAndChecks(pointed.kind, pointed.examples ?? [], pointed.edges) : ""}Score 0–10 how clean the frame is (10 = no fault). Return ONLY JSON: {"puan": <0-10>, ${said ? `"anlati": <0-10>, ` : ""}${checks.map((c) => `"${c.key}": true|false, `).join("")}"sorunlar": ["<fault, Turkish, at most 12 words>"]}`;
}

/** A narration below this ("does the picture show what is said") is reported to the story brain. */
export const SHOWING_BAR = 5;

/** What kind of picture a frame is (from the plan): the questions asked and the examples shown follow it. */
export type FrameKind = "harita" | "yakin-harita" | "sahne" | "resim" | "gecis";
export const FRAME_KINDS: readonly FrameKind[] = ["harita", "yakin-harita", "sahne", "resim", "gecis"];

/**
 * The frame-fault questions, one yes/no each (the quality exam of 26 Oct 2026: asked only for "faults", gemma4 gave the
 * Kosovo video 10/10 with a badge cut at the top edge, land drawn as sea and a beard hanging like a bib; a small vision
 * model answers a pointed question far better than it fills an open list). Each true answer is a fault in Turkish.
 */
export const FRAME_CHECKS: readonly { readonly key: string; readonly kinds: readonly FrameKind[]; readonly ask: string; readonly fault: string }[] = [
  { key: "kenar", kinds: ["harita", "yakin-harita", "sahne", "gecis"], ask: "Look at all four edges: is a round portrait badge, a head or face, a name label, a speech text, or a state's, city's or sea's name cut by the edge of the picture (part of it outside the picture)? A body cut at the bottom by a close shot is normal framing, not a fault.", fault: "kenarda kesik rozet, yüz ya da yazı" },
  { key: "ustuste", kinds: ["harita", "yakin-harita", "sahne", "gecis"], ask: "Is any text printed over other text, or over a token, badge or face, so that one of them cannot be read in full?", fault: "yazı başka bir yazının ya da işaretin üstünde" },
  { key: "bos", kinds: ["harita", "yakin-harita", "sahne", "resim", "gecis"], ask: "Is there a black, dark or one-colour band or area that is not part of the drawing (an empty strip along an edge, a land map drawn all as water with fields and trees floating on it)?", fault: "boş/koyu şerit ya da yanlış renkli zemin" },
  { key: "bozuk", kinds: ["sahne", "gecis"], ask: "Is a cartoon character drawn wrong: a missing or broken face, a beard that does not cover the chin and hangs from it like a bib or scarf, a hat or limb out of place?", fault: "karakter yanlış çizilmiş (yüz, sakal, şapka)" },
];

/** An earlier frame of the show and what the check got wrong on it: a fault it missed, or a fault it saw that was none. */
export interface FrameExample {
  readonly image: string;
  readonly kusurlu: boolean;
  readonly metin: string;
}

/** Examples shown beside a judged frame, at most (each adds a picture to the call). */
export const MAX_EXAMPLES = 2;

/** The questions for a kind of frame, as the prompt asks them and the schema names them. */
export function frameChecks(kind: FrameKind | undefined): typeof FRAME_CHECKS {
  return FRAME_CHECKS.filter((c) => !kind || c.kinds.includes(kind));
}

/**
 * The frame's top and bottom edges at full size, one picture (ffmpeg filter over a 1080p frame): the top edge's left
 * and right parts, then the bottom edge's, one under the other with a white line between. The parts overlap by a tenth
 * of the width: split at the middle, a badge there showed as two halves and was called cut (quality exam, 26 Oct 2026). On the whole frame at the
 * judge's size a badge cut by the top edge is ~40 px and was never seen (quality exam, 26 Oct 2026).
 */
export const EDGE_STRIPS_FILTER = [
  "[0]crop=iw*0.55:ih*0.2:0:0,pad=iw:ih+12:0:0:white[a]",
  "[0]crop=iw*0.55:ih*0.2:iw*0.45:0,pad=iw:ih+12:0:0:white[b]",
  "[0]crop=iw*0.55:ih*0.2:0:ih*0.8,pad=iw:ih+12:0:0:white[c]",
  "[0]crop=iw*0.55:ih*0.2:iw*0.45:ih*0.8[d]",
  "[a][b][c][d]vstack=inputs=4",
].join(";");

/** ffmpeg arguments cutting the edge strips of the frame at `t` seconds of `video` into `out` (JPEG). */
export const edgeStripArgs = (video: string, t: number, out: string): string[] => ["-v", "error", "-y", "-ss", t.toFixed(2), "-i", video, "-frames:v", "1", "-filter_complex", EDGE_STRIPS_FILTER, "-q:v", "4", out];

/**
 * The prompt's part about the pictures (examples first, the frame, its edge strips) and the pointed questions (keys
 * answered true/false).
 */
export function examplesAndChecks(kind: FrameKind | undefined, examples: readonly Pick<FrameExample, "kusurlu" | "metin">[], edges = false): string {
  const n = examples.length + 1;
  const shown = examples.length
    ? `You first see ${examples.length} earlier frame${examples.length > 1 ? "s" : ""} of this show that this check judged wrongly; learn what such a fault looks like, but say it only if you see it in the frame you judge:\n${examples.map((e, i) => `- Picture ${i + 1}: ${e.kusurlu ? `a FAULT the check missed: ${e.metin}` : `NOT a fault, though the check called it one: ${e.metin}`}`).join("\n")}\n`
    : "";
  const judged = examples.length || edges ? `The frame you judge is picture ${n}.${edges ? ` Picture ${n + 1} shows that same frame's top edge (rows 1 and 2: its left and right parts) and bottom edge (rows 3 and 4) at full size, white lines between the rows: a badge, name or text cut by the frame's top edge runs off the top of row 1 or 2, one cut by the bottom edge runs off the bottom of row 3 or 4. The left and right parts overlap in the middle, so something cut only at the side of a row, where the parts meet, is whole in the other row: that is not a fault.` : ""}\n` : "";
  return `${shown}${judged}Answer each question about the frame you judge with true or false:\n${frameChecks(kind).map((c) => `- "${c.key}": ${c.ask}`).join("\n")}\n`;
}

/** What the judge said of one frame. `okunamadi`: no readable answer (scored as passing, never as a fault). */
export interface FrameVerdict {
  readonly puan: number;
  readonly anlati?: number;
  readonly sorunlar: readonly string[];
  readonly okunamadi?: boolean;
}

/** A yes to a pointed question is a fault however high the judge scored the frame. */
const CHECK_FAULT_MAX = 4;

/**
 * One frame to the vision judge (the production's watch and the quality exam use the same call). `image`: base64 JPEG;
 * `kind`: what the frame shows (asks that kind's questions); `examples`: earlier misses shown before it.
 */
export async function judgeFrame(input: { readonly judge: AIProvider; readonly image: string; readonly donem: string; readonly rules?: readonly string[]; readonly designed?: string; readonly said?: string; readonly kind?: FrameKind; readonly examples?: readonly FrameExample[]; readonly edges?: string }): Promise<FrameVerdict> {
  const { said } = input;
  const examples = (input.examples ?? []).slice(0, MAX_EXAMPLES);
  const checks = frameChecks(input.kind);
  const props: Record<string, unknown> = { puan: { type: "integer" }, ...(said ? { anlati: { type: "integer" } } : {}), ...Object.fromEntries(checks.map((c) => [c.key, { type: "boolean" }])), sorunlar: { type: "array", items: { type: "string" } } };
  const prompt = qualityPrompt(input.donem, input.rules, input.designed, said, { ...(input.kind ? { kind: input.kind } : {}), examples, edges: Boolean(input.edges) });
  const out = await input.judge.generate(prompt, { images: [...examples.map((e) => e.image), input.image, ...(input.edges ? [input.edges] : [])], maxTokens: 260, jsonSchema: { type: "object", properties: props, required: ["puan", ...(said ? ["anlati"] : []), ...checks.map((c) => c.key), "sorunlar"] } });
  const v = readJsonAnswer<Record<string, unknown> & { puan?: unknown; anlati?: unknown; sorunlar?: unknown[] }>(typeof out === "string" ? out : out.content);
  const read = typeof v?.puan === "number";
  const yes = checks.filter((c) => v?.[c.key] === true);
  const said0 = (v?.sorunlar ?? []).map(String).filter(Boolean);
  const puan = read ? Math.max(0, Math.min(10, Math.round(v!.puan as number))) : QUALITY_BAR;
  return {
    puan: yes.length ? Math.min(puan, CHECK_FAULT_MAX) : puan,
    ...(said && typeof v?.anlati === "number" ? { anlati: Math.max(0, Math.min(10, Math.round(v.anlati))) } : {}),
    sorunlar: [...yes.map((c) => c.fault), ...said0].slice(0, 3),
    ...(read ? {} : { okunamadi: true }),
  };
}

/**
 * The examples for a frame of this kind from the brain's lessons (as recall gives them, newest first; pictures read from
 * `dir`): a missed fault and a false alarm in turn, so neither kind crowds the other out (the quality exam of 26 Oct
 * 2026: shown only faults the judge repeated them on clean frames; three false alarms taught at once would have hidden
 * every fault).
 */
export async function frameExamples(lessons: readonly Lesson[], dir: string, kind: FrameKind | undefined, skip?: (file: string) => boolean): Promise<FrameExample[]> {
  const usable = lessons.filter((l) => l.ornek && !(skip && skip(l.ornek)) && (!kind || l.konu.endsWith(`· ${kind}`)) && existsSync(path.join(dir, l.ornek)));
  const faults = usable.filter((l) => !l.konu.startsWith(FALSE_ALARM));
  const alarms = usable.filter((l) => l.konu.startsWith(FALSE_ALARM));
  const picked: Lesson[] = [];
  for (let i = 0; picked.length < MAX_EXAMPLES && (i < faults.length || i < alarms.length); i++) for (const l of [faults[i], alarms[i]]) if (l && picked.length < MAX_EXAMPLES) picked.push(l);
  return Promise.all(picked.map(async (l) => ({ image: (await fs.readFile(path.join(dir, l.ornek!))).toString("base64"), kusurlu: !l.konu.startsWith(FALSE_ALARM), metin: l.metin })));
}

/** What the frame at `t` seconds shows, by the plan: a shot's first 0.32 s are its transition in (ShotView). */
export function frameKindAt(plan: Pick<V3RenderPlan, "fps" | "shots">, t: number): FrameKind | undefined {
  const f = Math.round(t * plan.fps);
  const shot = plan.shots.find((s) => f >= s.start && f < s.start + s.duration);
  if (!shot) return undefined;
  const local = f - shot.start;
  if (shot.transitionIn !== "kes" && local < Math.round(plan.fps * 0.32)) return "gecis";
  if ((shot.inserts ?? []).some((i) => local >= i.start && local < i.end)) return "resim";
  if (shot.geoMap) return shot.geoMap.close ? "yakin-harita" : "harita";
  return "sahne";
}

/** Lesson topics: `kare kusuru · <kind>` for a missed fault, `yanlış alarm · <kind>` for a fault that was none. */
export const MISSED = "kare kusuru";
export const FALSE_ALARM = "yanlış alarm";

/**
 * Teaches the quality brain one frame it judged wrongly (Claude's or the owner's check of a finished video): the frame
 * is kept as an example picture and the lesson written to its memory, so it is shown that frame the next time it
 * judges one of the same kind. `frame`: a JPEG already cut, or `video` + `saniye`. Returns false when already taught.
 */
export async function teachFrame(input: { readonly workRoot: string; readonly ffmpeg: string; readonly ad: string; readonly kind: FrameKind; readonly kusurlu: boolean; readonly metin: string; readonly bolum: string; readonly frame?: string; readonly video?: string; readonly saniye?: number }): Promise<boolean> {
  const dir = exampleDir(input.workRoot);
  const name = `${input.ad.replace(/[^a-z0-9-]+/gi, "-").slice(0, 60)}.jpg`;
  if ((await recall(input.workRoot, "kalite", { tur: "ders", limit: 10_000 })).some((l) => l.ornek === name)) return false;
  await fs.mkdir(dir, { recursive: true });
  if (input.frame) await fs.copyFile(input.frame, path.join(dir, name));
  else if (input.video && input.saniye !== undefined) await runChecked(input.ffmpeg, ["-v", "error", "-y", "-ss", input.saniye.toFixed(2), "-i", input.video, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "4", path.join(dir, name)]);
  else throw new Error("teachFrame: frame ya da video + saniye gerekir");
  await remember(input.workRoot, { bolum: input.bolum, beyin: "kalite", tur: "ders", konu: `${input.kusurlu ? MISSED : FALSE_ALARM} · ${input.kind}`, metin: input.metin, ornek: name });
  return true;
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
  /** What is said when (seconds): the frame is also judged on whether it shows it. */
  readonly said?: readonly { readonly from: number; readonly to: number; readonly text: string }[];
  /** What the frame at a time shows (frameKindAt over the plan): asks that kind its questions and shows its examples. */
  readonly kindAt?: (t: number) => FrameKind | undefined;
  /** Also shows the frame's top and bottom edges at full size (EDGE_STRIPS_FILTER), where cut badges and names show. */
  readonly edges?: boolean;
  /**
   * Also shows the frames of the same kind it judged wrongly before (teachFrame). Off unless asked: with gemma4:12b the
   * Kosovo run of 26 Oct 2026 wrote the taught "Lazar's beard hangs like a bib" on four frames, one with no Lazar in it.
   */
  readonly examples?: boolean;
}): Promise<{ checked: number; faulty: number; averageScore: number; showing?: number }> {
  const { paths, council } = input;
  const every = input.everyS ?? 6;
  const times: number[] = [];
  for (let t = 2; t < input.durationS - 0.5 && times.length < (input.maxFrames ?? 18); t += every) times.push(t);
  await fs.mkdir(paths.asciiTemp, { recursive: true });
  // The brain's experience: frames it judged wrongly before, with what it got wrong (taught by teachFrame).
  const lessons = input.examples ? await recall(paths.workRoot, "kalite", { tur: "ders", limit: 10_000 }).catch(() => [] as Lesson[]) : [];
  let faulty = 0;
  let sum = 0;
  const showing: number[] = [];
  for (const t of times) {
    const frame = path.join(paths.asciiTemp, `kalite-${Date.now()}-${Math.round(t * 10)}.jpg`);
    const strips = frame.replace(/\.jpg$/, "-kenar.jpg");
    try {
      await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-ss", t.toFixed(2), "-i", input.video, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "4", frame]);
      const designed = input.designed?.find((w) => t >= w.from && t <= w.to)?.what;
      const said = input.said?.find((s) => t >= s.from && t <= s.to)?.text;
      // The pointed questions of this kind of frame, and the frames of the same kind the brain judged wrongly before.
      const kind = input.kindAt?.(t);
      const examples = await frameExamples(lessons, exampleDir(paths.workRoot), kind);
      const edged = input.edges && kind !== "resim" ? (await runChecked(paths.ffmpeg, edgeStripArgs(input.video, t, strips)), (await fs.readFile(strips)).toString("base64")) : undefined;
      const v = await judgeFrame({ judge: input.judge, image: (await fs.readFile(frame)).toString("base64"), donem: input.donem, ...(input.rules ? { rules: input.rules } : {}), ...(designed ? { designed } : {}), ...(said ? { said } : {}), ...(kind ? { kind } : {}), examples, ...(edged ? { edges: edged } : {}) });
      const score = v.puan;
      sum += score;
      // Does the picture show what is being said (owner, 22 Oct 2026: "the viewer must live the moment").
      if (said && v.anlati !== undefined) {
        const shown = v.anlati;
        showing.push(shown);
        if (shown < SHOWING_BAR) council.find({ beyin: "kurgu", onem: "uyari", baslik: "anlatılan ekranda görünmüyor", ayrinti: `"${said.slice(0, 120)}" söylenirken ekranda bu olmuyor`, oneri: "o satıra hareket ver: kalabalık/ordu yürüsün, karakter girsin/koşsun, haritada ordu yürüsün ya da fetih yayılsın", tur: "veri", yer: `${t.toFixed(0)}. sn (anlatım ${shown}/10)` });
      }
      const faults = v.sorunlar;
      if (score < QUALITY_BAR && faults.length) {
        faulty++;
        council.find({ beyin: "kalite", onem: score < 5 ? "eksik" : "uyari", baslik: "karede sorun", ayrinti: faults.join("; "), tur: "veri", yer: `${t.toFixed(0)}. sn (puan ${score}/10)` });
      }
    } catch (e) {
      input.log(`  kalite: ${t.toFixed(0)}. sn incelenemedi (${(e as Error).message.slice(0, 80)})`);
    } finally {
      await fs.rm(frame, { force: true });
      await fs.rm(strips, { force: true });
    }
  }
  return { checked: times.length, faulty, averageScore: times.length ? sum / times.length : 0, ...(showing.length ? { showing: showing.reduce((a, b) => a + b, 0) / showing.length } : {}) };
}
