/**
 * Atölye V3 — the director's council on a finished episode, as a dry run: the critics (script writer, historian,
 * humourist, quality) score the cut and argue, AYAS decides its fixes from the fixed menu — and nothing is applied.
 * For checking the council on any delivered video; the production holds the same council by itself after every cut.
 *
 *   npx tsx scripts/v3/yonetmen-kurulu.ts --cikti <bölüm klasörü> [--saglayici openai|ollama] [--dil tr|en]
 *
 * Reads episode.json, ses.json, senkron.json, QC.md and yapim-raporu.json of the folder; writes
 * yonetmen-kurulu-deneme.json there. Spend: the council's own cap (10 cents for a Short, 30 for a long video).
 */
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { brainBudget } from "../../src/lib/v3/council/BrainModels";
import { BRAIN_NAMES, type Finding } from "../../src/lib/v3/council/Council";
import { councilCapUsd, holdCouncil, sessionDebate, sourcedNumberFacts } from "../../src/lib/v3/council/DirectorCouncil";
import type { SourceBank } from "../../src/lib/v3/script/ScriptPrompts";
import { recall } from "../../src/lib/v3/council/ExperienceMemory";
import { cutMeasures, detectCuts, gapLesson, kindOf, listReferences, measureGaps, measuresLine, referenceTargets, speechMeasures, targetsLine } from "../../src/lib/v3/council/ReferenceStudy";
import { assertEpisode } from "../../src/lib/v3/episode/EpisodeValidator";
import { listOrders } from "../../src/lib/v3/orders/ProductionOrders";
import { isShorts } from "../../src/lib/v3/render/Format";
import { buildTimeline, DEFAULT_TIMELINE, type LineAudio } from "../../src/lib/v3/timeline/Timeline";
import { splitDirections } from "../../src/lib/v3/tts/StageDirections";
import { loadV3Settings, resolveV3Paths } from "../../src/lib/v3/V3Paths";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadV3Settings();
  const paths = resolveV3Paths();
  const dir = arg("--cikti");
  if (!dir || !existsSync(path.join(dir, "episode.json"))) throw new Error("Kullanım: yonetmen-kurulu.ts --cikti <episode.json'lı bölüm klasörü>");
  const f = (n: string) => path.join(dir, n);
  const read = async <T>(n: string): Promise<T> => JSON.parse(await fs.readFile(f(n), "utf8")) as T;
  const episode = assertEpisode(await read<unknown>("episode.json"));
  const shorts = isShorts(episode.hedef_sure_sn);
  const voiced = (await read<{ satirlar: { file: string; duration: number }[][] }>("ses.json")).satirlar;
  const synced = await read<Omit<LineAudio, "file" | "duration">[][]>("senkron.json");
  const audio: LineAudio[][] = episode.sahneler.map((s, si) => s.satirlar.map((_, li) => ({ ...voiced[si]![li]!, ...synced[si]![li]! })));
  const timeline = buildTimeline(episode, audio, { ...DEFAULT_TIMELINE, introS: shorts ? 0 : 3.5 });
  const video = existsSync(f("final.mp4")) ? f("final.mp4") : undefined;
  const durationS = timeline.duration;
  const lines = timeline.lines.map((l) => ({ start: l.start, end: l.end, text: splitDirections(episode.sahneler[l.sceneIndex]?.satirlar[l.lineIndex]?.metin ?? "").speech, turn: false }));
  const turns = timeline.lines.filter((l, i) => i > 0 && l.speaker !== timeline.lines[i - 1]!.speaker).length;
  const ours = { sureSn: durationS, ...speechMeasures(lines, durationS, turns), ...cutMeasures(video ? await detectCuts(paths.ffmpeg, video) : [], durationS) };
  // The episode's language: `--dil`, else the order that made this folder. Only a known one sets a words-per-minute
  // target (from references in that language); the council keeps its old guess from Turkish letters, which an English
  // episode naming "Atatürk" fools — a guess is not good enough for a pace target.
  const argDil = arg("--dil");
  const known = argDil === "tr" || argDil === "en" ? argDil : (await listOrders(paths.workRoot).catch(() => [])).find(({ order }) => order.cikti && path.resolve(order.cikti) === path.resolve(dir))?.order.dil;
  const dil = known ?? (/[çğıöşü]/i.test(episode.sahneler.flatMap((s) => s.satirlar.map((l) => l.metin)).join(" ")) ? "tr" : "en");
  const targets = referenceTargets(await listReferences(paths.workRoot), kindOf(episode.hedef_sure_sn), known ?? "");
  console.log(`tempo: ${measuresLine(ours)}${targets ? `\nhedef: ${targetsLine(targets)}` : ""}`);
  const qc = existsSync(f("QC.md")) ? (await fs.readFile(f("QC.md"), "utf8")).split(/\r?\n/).filter((r) => r.startsWith("- [ ]")).map((r) => r.slice(6)) : [];
  const findings = existsSync(f("yapim-raporu.json")) ? ((await read<{ bulgular?: Finding[] }>("yapim-raporu.json")).bulgular ?? []) : [];
  const models = brainBudget(paths, councilCapUsd(episode.hedef_sure_sn), arg("--saglayici") ?? process.env.ATOLYE_V3_SCRIPT_PROVIDER ?? "openai");
  const session = await holdCouncil({
    budget: models.budget,
    critic: models.critic,
    director: models.director,
    episode,
    dil,
    round: 0,
    canRevise: true,
    context: {
      baslik: episode.baslik,
      sureSn: durationS,
      shorts,
      tempo: [`our cut: ${measuresLine(ours)}`, ...(targets ? [targetsLine(targets), ...measureGaps(ours, targets).map((g) => gapLesson(g).metin)] : [])],
      qc,
      bulgular: findings.filter((x) => x.onem !== "bilgi" && x.baslik !== "kurul notu").slice(0, 30).map((x) => `${BRAIN_NAMES[x.beyin]}: ${x.baslik}${x.yer ? ` (${x.yer})` : ""} — ${x.ayrinti.slice(0, 160)}`),
      kaynakSayilari: sourcedNumberFacts(existsSync(f("kaynak-bankasi.json")) ? await read<SourceBank>("kaynak-bankasi.json") : undefined, episode),
    },
    times: timeline,
    lessons: async (b) => (await recall(paths.workRoot, b, { konu: `${episode.konu} ${episode.donem}`, limit: 4 }).catch(() => [])).map((l) => l.metin),
    earlier: (await recall(paths.workRoot, "sef", { tur: "ders", limit: 5 }).catch(() => [])).map((l) => l.metin),
    check: (e) => void assertEpisode(e),
    log: console.log,
  });
  for (const d of sessionDebate(session)) console.log(`\n${d.rol}:\n  ${d.metin}`);
  await fs.writeFile(f("yonetmen-kurulu-deneme.json"), `${JSON.stringify({ tarih: new Date().toISOString(), olcum: ours, oturum: session }, null, 2)}\n`);
  console.log(`\nmaliyet: $${session.maliyetUsd.toFixed(4)} · ${f("yonetmen-kurulu-deneme.json")} (hiçbir düzeltme uygulanmadı)`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
