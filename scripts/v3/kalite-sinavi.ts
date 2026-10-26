/**
 * Atölye V3 — the quality brain's frame-fault exam (owner, 26 Oct 2026: "kare kusuru tespitini beyine kur, o da
 * yapabilsin"): frames of finished videos whose verdict is known (`content/v3/kalite-sinavi.json`) go to the same
 * judging call the production's watch uses; a faulty frame must score under the bar and be reported, a clean one must
 * pass. Run it after teaching the brain or changing its model; the brains themselves can run it, no coding agent needed.
 *
 *   npx tsx scripts/v3/kalite-sinavi.ts hazirla                  # cuts the exam frames (outside git)
 *   npx tsx scripts/v3/kalite-sinavi.ts calistir [--model gemma4:12b] [--ornek-yok] [--kenar-yok]
 *   npx tsx scripts/v3/kalite-sinavi.ts ogret --soru <id>         # teach the brain an exam frame it got wrong
 *   npx tsx scripts/v3/kalite-sinavi.ts ogret --video <mp4> --saniye <s> --tur <harita|yakin-harita|sahne|resim|gecis>
 *        --metin "<what is wrong, or why it is fine>" [--temiz] [--ad <name>] [--bolum <episode>]
 *
 * The owner's loop (26 Oct 2026: "the helper brain does it, you check; if it gets it wrong, you do it and the helper
 * brain takes it as experience"): whoever checks a finished video teaches the frames the brain judged wrongly; the
 * production shows them to the brain beside every frame of the same kind from then on. In the exam a question never
 * sees its own frame among the examples, so a pass is the brain recognising the fault, not the picture.
 *
 * Every call waits for a cool GPU. The report goes to `<workRoot>/_kutuphane/sinav/kalite-sonuc-*.json`.
 */
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { resolveOllamaConfig } from "../../src/lib/ai/OllamaConfig";
import { OllamaProvider } from "../../src/lib/ai/providers/OllamaProvider";
import { exampleDir, recall } from "../../src/lib/v3/council/ExperienceMemory";
import { edgeStripArgs, FRAME_KINDS, type FrameKind, frameExamples, judgeFrame, QUALITY_BAR, teachFrame } from "../../src/lib/v3/council/QualityBrain";
import { coolGpuProvider } from "../../src/lib/v3/util/Gpu";
import { runChecked } from "../../src/lib/v3/util/Proc";
import { loadV3Settings, resolveV3Paths } from "../../src/lib/v3/V3Paths";

interface Question {
  readonly id: string;
  readonly kaynak: string;
  readonly saniye: number;
  readonly donem: string;
  readonly tur: FrameKind;
  readonly kusurlu: boolean;
  readonly kusur?: string;
  readonly ne?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** The episode a source video belongs to (its folder under `bolumler/`). */
const episodeOf = (kaynak: string) => /bolumler[\\/]([^\\/]+)/.exec(kaynak)?.[1] ?? path.basename(kaynak);

async function main() {
  loadV3Settings();
  const paths = resolveV3Paths();
  const { sorular } = JSON.parse(await fs.readFile(path.join(paths.contentRoot, "kalite-sinavi.json"), "utf8")) as { sorular: Question[] };
  const dir = path.join(paths.workRoot, "_kutuphane", "sinav", "kalite");
  await fs.mkdir(dir, { recursive: true });
  const frameOf = (q: Question) => path.join(dir, `${q.id}.jpg`);
  const edgesOf = (q: Question) => path.join(dir, `${q.id}.kenar.jpg`);
  const cmd = process.argv[2];
  if (cmd === "hazirla") {
    for (const q of sorular) {
      if (existsSync(frameOf(q)) && existsSync(edgesOf(q))) continue;
      const video = path.join(paths.workRoot, q.kaynak);
      if (!existsSync(video)) {
        console.log(`· ${q.id}: kaynak yok (${q.kaynak})`);
        continue;
      }
      // The production's own cuts: one frame at 960 px, and its edge strips at full size.
      await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-ss", q.saniye.toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "4", frameOf(q)]);
      await runChecked(paths.ffmpeg, edgeStripArgs(video, q.saniye, edgesOf(q)));
      console.log(`✓ ${q.id}`);
    }
    return;
  }
  if (cmd === "ogret") {
    const id = arg("--soru");
    if (id) {
      const q = sorular.find((x) => x.id === id);
      if (!q || !existsSync(frameOf(q))) throw new Error(`soru ya da karesi yok: ${id} (önce "hazirla")`);
      const done = await teachFrame({ workRoot: paths.workRoot, ffmpeg: paths.ffmpeg, ad: q.id, kind: q.tur, kusurlu: q.kusurlu, metin: (q.kusurlu ? q.kusur : q.ne) ?? "", bolum: episodeOf(q.kaynak), frame: frameOf(q) });
      console.log(done ? `✓ öğretildi: ${q.id} (${q.kusurlu ? "kaçırılan kusur" : "yanlış alarm"}, ${q.tur})` : `· zaten öğretilmiş: ${q.id}`);
      return;
    }
    const [video, saniye, tur, metin] = [arg("--video"), Number(arg("--saniye")), arg("--tur") as FrameKind | undefined, arg("--metin")];
    if (!video || !Number.isFinite(saniye) || !tur || !FRAME_KINDS.includes(tur) || !metin) throw new Error(`Kullanım: ogret --soru <id> | ogret --video <mp4> --saniye <s> --tur <${FRAME_KINDS.join("|")}> --metin "<...>" [--temiz]`);
    const ad = arg("--ad") ?? `${episodeOf(video)}-${saniye.toFixed(1)}`;
    const done = await teachFrame({ workRoot: paths.workRoot, ffmpeg: paths.ffmpeg, ad, kind: tur, kusurlu: !process.argv.includes("--temiz"), metin, bolum: arg("--bolum") ?? episodeOf(video), video, saniye });
    console.log(done ? `✓ öğretildi: ${ad}` : `· zaten öğretilmiş: ${ad}`);
    return;
  }
  if (cmd !== "calistir") throw new Error("Kullanım: npx tsx scripts/v3/kalite-sinavi.ts hazirla | calistir [--model <ad>] [--ornek-yok] | ogret …");
  const model = arg("--model") ?? process.env.ATOLYE_V3_VISION_MODEL ?? "gemma4:12b";
  const judge = coolGpuProvider(new OllamaProvider(fetch, () => ({ ...resolveOllamaConfig(), model, timeoutMs: 300_000, numCtx: 8_192, format: "json" as const, think: false })), (s) => console.log(s));
  const rules = (await recall(paths.workRoot, "kalite", { tur: "kural" }).catch(() => [])).map((l) => l.metin);
  const lessons = process.argv.includes("--ornek-yok") ? [] : await recall(paths.workRoot, "kalite", { tur: "ders", limit: 10_000 }).catch(() => []);
  const answers = [];
  let right = 0;
  for (const q of sorular) {
    if (!existsSync(frameOf(q))) {
      console.log(`· ${q.id}: kare yok (önce "hazirla")`);
      continue;
    }
    // Never its own frame among the examples.
    const examples = await frameExamples(lessons, exampleDir(paths.workRoot), q.tur, (file) => file === `${q.id}.jpg`);
    // The edge strips as the production shows them (not for a period picture).
    const edges = !process.argv.includes("--kenar-yok") && q.tur !== "resim" && existsSync(edgesOf(q)) ? (await fs.readFile(edgesOf(q))).toString("base64") : undefined;
    const v = await judgeFrame({ judge, image: (await fs.readFile(frameOf(q))).toString("base64"), donem: q.donem, rules, kind: q.tur, examples, ...(edges ? { edges } : {}) });
    // The production reports a frame under the bar with a fault named; an unreadable answer is no verdict.
    const reported = !v.okunamadi && v.puan < QUALITY_BAR && v.sorunlar.length > 0;
    const dogru = !v.okunamadi && reported === q.kusurlu;
    if (dogru) right++;
    answers.push({ id: q.id, tur: q.tur, kusurlu: q.kusurlu, dogru, puan: v.puan, ornek: examples.length, kenar: Boolean(edges), sorunlar: v.sorunlar, ...(v.okunamadi ? { okunamadi: true } : {}) });
    console.log(`${dogru ? "✓" : "✗"} ${q.id.padEnd(28)} ${q.kusurlu ? "kusurlu" : "temiz  "} → ${v.puan}/10 (${examples.length} örnek) ${v.sorunlar.join("; ").slice(0, 100)}`);
  }
  const report = { tarih: new Date().toISOString(), model, kurallar: rules.length, ornekli: lessons.some((l) => l.ornek), kenarli: !process.argv.includes("--kenar-yok"), dogru: right, toplam: answers.length, cevaplar: answers };
  const out = path.join(paths.workRoot, "_kutuphane", "sinav", `kalite-sonuc-${Date.now()}.json`);
  await fs.writeFile(out, JSON.stringify(report, null, 2));
  const caught = answers.filter((a) => a.kusurlu && a.dogru).length;
  const faulty = answers.filter((a) => a.kusurlu).length;
  const clean = answers.filter((a) => !a.kusurlu && a.dogru).length;
  console.log(`\n${model}: ${right}/${answers.length} doğru — kusurlu karelerin ${caught}/${faulty}'ini buldu, temiz karelerin ${clean}/${answers.length - faulty}'ini geçirdi\nrapor: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
