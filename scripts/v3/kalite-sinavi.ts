/**
 * Atölye V3 — the quality brain's frame-fault exam (owner, 26 Oct 2026: "kare kusuru tespitini beyine kur, o da
 * yapabilsin"): frames of finished videos whose verdict is known (`content/v3/kalite-sinavi.json`) go to the same
 * judging call the production's watch uses; a faulty frame must score under the bar and be reported, a clean one must
 * pass. Run it after teaching the brain or changing its model; the brains themselves can run it, no coding agent needed.
 *
 *   npx tsx scripts/v3/kalite-sinavi.ts hazirla                  # cuts the exam frames (outside git)
 *   npx tsx scripts/v3/kalite-sinavi.ts calistir [--model gemma4:12b] [--ornek-yok] [--kenar-yok] [--olculu]
 *        [--ek-kural "<a candidate rule under test>"] [--rapor <file>]   (the self-improvement loop's prompt tuning)
 *        [--sabit]   the steady judge: temperature 0 and a fixed seed (BrainModels.STEADY_JUDGE)
 *        --olculu: as the production since 2 Nov 2026 — pixel check + the vision model asked only what needs an eye;
 *        a layout question ("olcum": "yerlesim") is measured from the render's own boxes when the question names them
 *        (`yerlesim`, `plan`: newer episodes), else left out (an old video's frame has no boxes)
 *   npx tsx scripts/v3/kalite-sinavi.ts denetle                  # the question file's problems, the eye's question count
 *
 * Two scores (owner, 9 Nov 2026: "kalite sınavını 8 sorudan 30'un üzerine çıkar"): the whole judge's, and the eye's
 * (`goz`: only the frames the vision model decides). The self-improvement loop compares the eye's — the settings it
 * tunes change only the vision model's verdict.
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
import { activeAdditions } from "../../src/lib/v3/council/SelfImprovement";
import { STEADY_JUDGE } from "../../src/lib/v3/council/BrainModels";
import { type LayoutFile, layoutFaults } from "../../src/lib/v3/council/LayoutCheck";
import { pixelFaults, scanVideo } from "../../src/lib/v3/council/PixelCheck";
import { edgeStripArgs, FRAME_KINDS, type FrameKind, frameExamples, judgeFrame, layoutSkip, pixelSkip, QUALITY_BAR, teachFrame } from "../../src/lib/v3/council/QualityBrain";
import { examScore, eyeQuestion, faultsAt, type FrameQuestion as Question, MIN_EYE_QUESTIONS, questionProblems } from "../../src/lib/v3/council/QualityExam";
import type { V3RenderPlan } from "../../src/lib/v3/render/RenderPlanTypes";
import { coolGpuProvider, V3_OLLAMA_THERMAL } from "../../src/lib/v3/util/Gpu";
import { runChecked } from "../../src/lib/v3/util/Proc";
import { loadV3Settings, resolveV3Paths } from "../../src/lib/v3/V3Paths";

/** One question's verdict in the report. */
interface Answer {
  readonly id: string;
  readonly tur: FrameKind;
  readonly kusurlu: boolean;
  /** The whole judge's verdict (measures and the eye) was right. */
  readonly dogru: boolean;
  /** An eye question (QualityExam.eyeQuestion), and whether the vision model's own verdict was right. */
  readonly goz: boolean;
  readonly goz_dogru?: boolean;
  readonly yapay?: true;
  readonly puan?: number;
  readonly ornek: number;
  readonly kenar: boolean;
  readonly sorunlar: readonly string[];
  readonly olculen?: readonly string[];
  readonly okunamadi?: true;
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
  if (cmd === "denetle") {
    const problems = questionProblems(sorular);
    const eye = sorular.filter(eyeQuestion);
    for (const p of problems) console.log(`✗ ${p}`);
    console.log(`${sorular.length} soru (${sorular.filter((q) => q.kusurlu).length} kusurlu, ${sorular.filter((q) => q.bozma).length} yapay); göz sorusu ${eye.length} (${eye.filter((q) => q.kusurlu).length} kusurlu) — en az ${MIN_EYE_QUESTIONS} gerekir`);
    if (problems.length || eye.length < MIN_EYE_QUESTIONS) process.exitCode = 1;
    return;
  }
  if (cmd === "hazirla") {
    for (const q of sorular) {
      // A frame with a laid-on fault has no edge strips (the strips would show the clean video).
      if (existsSync(frameOf(q)) && (q.bozma || existsSync(edgesOf(q)))) continue;
      const video = path.join(paths.workRoot, q.kaynak);
      if (!existsSync(video)) {
        console.log(`· ${q.id}: kaynak yok (${q.kaynak})`);
        continue;
      }
      // The production's own cuts: one frame at 960 px, and its edge strips at full size.
      await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-ss", q.saniye.toFixed(2), "-i", video, "-frames:v", "1", "-vf", `scale=960:-2${q.bozma ? `,${q.bozma}` : ""}`, "-q:v", "4", frameOf(q)]);
      if (!q.bozma) await runChecked(paths.ffmpeg, edgeStripArgs(video, q.saniye, edgesOf(q)));
      console.log(`✓ ${q.id}${q.bozma ? " (yapay kusur)" : ""}`);
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
  // --sabit: the steady judge (temperature 0, fixed seed) the production uses when the brain chose it.
  const steady = process.argv.includes("--sabit");
  const judge = coolGpuProvider(new OllamaProvider(fetch, () => ({ ...resolveOllamaConfig(), model, timeoutMs: 300_000, numCtx: 8_192, format: "json" as const, think: false, ...(steady ? STEADY_JUDGE : {}) }), V3_OLLAMA_THERMAL), (s) => console.log(s));
  // The owner's rules, the brain's own kept prompt additions (SelfImprovement), and a candidate addition under test.
  const candidate = arg("--ek-kural")?.trim();
  const rules = [...(await recall(paths.workRoot, "kalite", { tur: "kural" }).catch(() => [])).map((l) => l.metin), ...(await activeAdditions(paths.workRoot, "kalite").catch(() => [])), ...(candidate ? [candidate] : [])];
  const lessons = process.argv.includes("--ornek-yok") ? [] : await recall(paths.workRoot, "kalite", { tur: "ders", limit: 10_000 }).catch(() => []);
  // --olculu: as the production judges since 2 Nov 2026 — the pixel check over the source video around the frame, and
  // the vision model asked only what needs an eye. A layout fault is measured from the render's own boxes, which an old
  // video's frame does not have: those questions are left out of the score here (the render test covers them).
  const measured = process.argv.includes("--olculu");
  const plans = new Map<string, Pick<V3RenderPlan, "fps" | "shots" | "width" | "height"> | undefined>();
  const planOf = async (rel?: string) => {
    if (!rel) return undefined;
    if (!plans.has(rel)) {
      const file = path.join(paths.workRoot, rel);
      const raw = existsSync(file) ? (JSON.parse(await fs.readFile(file, "utf8")) as { plan?: V3RenderPlan } & V3RenderPlan) : undefined;
      plans.set(rel, raw ? (raw.plan ?? raw) : undefined);
    }
    return plans.get(rel);
  };
  const answers: Answer[] = [];
  const leftOut: string[] = [];
  for (const q of sorular) {
    if (!existsSync(frameOf(q))) {
      console.log(`· ${q.id}: kare yok (önce "hazirla")`);
      continue;
    }
    const plan = await planOf(q.plan);
    const boxes = q.yerlesim ? path.join(paths.workRoot, q.yerlesim) : undefined;
    if (measured && q.olcum === "yerlesim" && !(boxes && existsSync(boxes))) {
      leftOut.push(q.id);
      console.log(`· ${q.id.padEnd(28)} yerleşim kusuru: render kutularıyla ölçülür, bu sorunun kutuları yok`);
      continue;
    }
    // Measured as the production measures: the render's boxes at that moment, the pixel check over the video around it
    // (the plan's designed moments skipped, the frame's own size).
    const layout = measured && boxes && existsSync(boxes) ? faultsAt(layoutFaults(JSON.parse(await fs.readFile(boxes, "utf8")) as LayoutFile, plan ? layoutSkip(plan) : undefined), q.saniye) : [];
    const pixels = measured && !q.bozma ? faultsAt(pixelFaults(await scanVideo(paths.ffmpeg, path.join(paths.workRoot, q.kaynak), { fps: plan?.fps ?? 30, from: Math.max(0, q.saniye - 2), to: q.saniye + 2, ...(plan ? { width: plan.width, height: plan.height } : {}) }), plan ? pixelSkip(plan) : undefined), q.saniye) : [];
    const found = [...layout.map((x) => `[yerleşim] ${x.ayrinti}`), ...pixels.map((p) => `[piksel] ${p.ayrinti}`)];
    // A layout fault the boxes caught needs no eye: the production reports it either way.
    const eye = eyeQuestion(q);
    if (!eye && layout.length) {
      answers.push({ id: q.id, tur: q.tur, kusurlu: q.kusurlu, dogru: q.kusurlu, goz: false, ornek: 0, kenar: false, sorunlar: [], olculen: found });
      console.log(`${q.kusurlu ? "✓" : "✗"} ${q.id.padEnd(28)} ${q.kusurlu ? "kusurlu" : "temiz  "} → ölçüldü: ${found.join("; ").slice(0, 120)}`);
      continue;
    }
    // Never its own frame among the examples.
    const examples = await frameExamples(lessons, exampleDir(paths.workRoot), q.tur, (file) => file === `${q.id}.jpg`);
    // The edge strips as the production shows them (not for a period picture or a laid-on fault; measured, not at all).
    const edges = !measured && !process.argv.includes("--kenar-yok") && q.tur !== "resim" && !q.bozma && existsSync(edgesOf(q)) ? (await fs.readFile(edgesOf(q))).toString("base64") : undefined;
    const v = await judgeFrame({ judge, image: (await fs.readFile(frameOf(q))).toString("base64"), donem: q.donem, rules, kind: q.tur, examples, ...(edges ? { edges } : {}), ...(measured ? { measured: true } : {}) });
    // The production reports a frame under the bar with a fault named; an unreadable answer is no verdict.
    const seen = !v.okunamadi && v.puan < QUALITY_BAR && v.sorunlar.length > 0;
    const reported = seen || found.length > 0;
    const dogru = (!v.okunamadi || found.length > 0) && reported === q.kusurlu;
    // The eye's own verdict: what the vision model said, whatever code measured.
    const gozDogru = !v.okunamadi && seen === q.kusurlu;
    answers.push({ id: q.id, tur: q.tur, kusurlu: q.kusurlu, dogru, goz: eye, ...(eye ? { goz_dogru: gozDogru } : {}), ...(q.bozma ? { yapay: true } : {}), puan: v.puan, ornek: examples.length, kenar: Boolean(edges), sorunlar: v.sorunlar, ...(found.length ? { olculen: found } : {}), ...(v.okunamadi ? { okunamadi: true } : {}) });
    console.log(`${dogru ? "✓" : "✗"} ${q.id.padEnd(28)} ${q.kusurlu ? "kusurlu" : "temiz  "} → ${v.puan}/10 (${examples.length} örnek) ${[...found, ...v.sorunlar].join("; ").slice(0, 120)}`);
  }
  // The plain count rewards a judge that calls every frame faulty (Moondream, 2 Nov 2026: 7/12 like gemma4:12b, with
  // every frame reported and the prompt's fault list copied): the mean of the two hit rates is 50 % for any judge
  // that answers the same for every frame, and such a judge is named as one.
  const all = examScore(answers);
  const eyes = examScore(answers.filter((a) => a.goz).map((a) => ({ kusurlu: a.kusurlu, dogru: Boolean(a.goz_dogru) })));
  const report = {
    tarih: new Date().toISOString(),
    model,
    ...(steady ? { sabit: true } : {}),
    kurallar: rules.length,
    ornekli: lessons.some((l) => l.ornek),
    kenarli: !measured && !process.argv.includes("--kenar-yok"),
    ...(measured ? { olculu: true, disarida_yerlesim: leftOut } : {}),
    dogru: all.dogru,
    toplam: all.toplam,
    ...(all.dengeli !== undefined ? { dengeli_yuzde: all.dengeli } : {}),
    hep_ayni_karar: all.hepAyni,
    // The eye's score: the frames the vision model decides (the self-improvement loop compares this one).
    goz: { dogru: eyes.dogru, toplam: eyes.toplam, kusurlu: eyes.kusurlu, ...(eyes.dengeli !== undefined ? { dengeli_yuzde: eyes.dengeli } : {}), hep_ayni_karar: eyes.hepAyni },
    cevaplar: answers,
  };
  const out = path.join(paths.workRoot, "_kutuphane", "sinav", `kalite-sonuc-${Date.now()}.json`);
  await fs.writeFile(out, JSON.stringify({ ...report, ...(candidate ? { ek_kural: candidate } : {}) }, null, 2));
  // --rapor: the same report where the self-improvement loop reads it.
  if (arg("--rapor")) await fs.writeFile(arg("--rapor")!, JSON.stringify({ ...report, ...(candidate ? { ek_kural: candidate } : {}) }, null, 2));
  console.log(`\n${model}: ${all.dogru}/${all.toplam} doğru — kusurlu karelerin ${all.bulunan}/${all.kusurlu}'ini buldu, temiz karelerin ${all.gecen}/${all.toplam - all.kusurlu}'ini geçirdi${all.dengeli !== undefined ? `; dengeli doğruluk %${all.dengeli} (yazı-tura %50)` : ""}`);
  console.log(`göz (yalnız görsel modelin kararı): ${eyes.dogru}/${eyes.toplam} — kusurlu ${eyes.bulunan}/${eyes.kusurlu}, temiz ${eyes.gecen}/${eyes.toplam - eyes.kusurlu}${eyes.dengeli !== undefined ? `; dengeli %${eyes.dengeli}` : ""}${eyes.toplam < MIN_EYE_QUESTIONS ? ` (UYARI: ${MIN_EYE_QUESTIONS} sorudan az, gürültülü)` : ""}`);
  console.log(`${all.hepAyni || eyes.hepAyni ? "UYARI: her kareye aynı kararı verdi — bu bir yargı değil, puanı yok sayın\n" : ""}rapor: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
