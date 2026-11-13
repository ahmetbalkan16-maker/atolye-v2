/**
 * Atölye V3 — the brains' self-improvement while no video is being made (owner approval, 2 Nov 2026). The order
 * watcher (`yapim.ts izle`) runs a cycle by itself when no order waits and the pause since the last one is over; a cycle
 * stops at the next task when an order comes in.
 *
 *   npx tsx scripts/v3/gelisim.ts dongu [--zorla] [--yalniz istekler,karsilastir,oneriler,benzer,pekistir,sinav,ayar,ogren,arastir,gelistir]
 *   npx tsx scripts/v3/gelisim.ts birlestir                # the same want in other words → counted on the earlier one
 *   npx tsx scripts/v3/gelisim.ts durum                    # last cycles, exams, the brains' own changes
 *   npx tsx scripts/v3/gelisim.ts oneriler                 # code proposals for the owner (Gelişim Merkezi)
 *   npx tsx scripts/v3/gelisim.ts onayla <id> [--not "…"]  # the owner's decision; nothing is built by it
 *   npx tsx scripts/v3/gelisim.ts reddet <id> [--not "…"]
 *
 * Tasks: the owner's links and internet searches are studied; delivered videos are compared with the references (lessons); the productions'
 * code wants are collected as proposals; a video similar to a recent episode is searched and studied; the quality
 * brain sits its exam; it tries one new prompt addition and its one tunable setting, kept only when the exam rises by
 * MIN_GAIN points. Code never changes here. Spend: at most 10 cents a cycle; every local model call waits for a cool
 * GPU, and every task, video study and exam for a fit PC (RAM, disks, processor; fitPc).
 */
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { knowledgeFromStudy, linkRequestsDue, listLinkRequests, listSearchRequests, saveLinkRequest } from "../../src/lib/ayas/research/AyasLinkRequests";
import { saveKnowledge } from "../../src/lib/ayas/research/AyasSharedKnowledge";
import { researchTopic, studyLink } from "../../src/lib/ayas/research/AyasWebResearch";
import { brainBudget, brainVision, steadyJudge, writerBudget } from "../../src/lib/v3/council/BrainModels";
import { readJsonAnswer } from "../../src/lib/v3/council/Council";
import { apprenticePolicy, examCandidates, examCapUsd, examSpendToday, writeExam } from "../../src/lib/v3/council/DevApprentice";
import { listGrades, listWriteExams, readiness, writeReadiness } from "../../src/lib/v3/council/DevBrain";
import { developerLock } from "../../src/lib/v3/council/Developer";
import { developerWindow, nextJob } from "../../src/lib/v3/council/DevQueue";
import { learnAyasCode, learnCommitLessons, learnRefs } from "../../src/lib/v3/council/CommitLessons";
import { learnFromCommits, researchQueue, runDevJob } from "../../src/lib/v3/council/DevResearch";
import { allLessons, forgetSource, forgetWhere, remember } from "../../src/lib/v3/council/ExperienceMemory";
import { localEmbedder } from "../../src/lib/v3/council/MeaningCache";
import { mergeParaphrasedProposals } from "../../src/lib/v3/council/ProposalMerge";
import { CONSOLIDATE_AT, consolidationPrompt, gapLesson, isReferenceLesson, kindOf, listReferences, listStudyRequests, measureGaps, nextSearch, parseConsolidation, pickSimilar, REFERENCE_SUMMARY, referenceTargets, saveStudyRequest, searchVideos, STUDY_BRAINS, studyAttempts, type StudyRequest, studyRequestsDue, type StudySearch, studyReference, type VideoMeasures } from "../../src/lib/v3/council/ReferenceStudy";
import { activeAdditions, additionPrompt, confirmedGain, CYCLE_TASKS, EXAMPLES_TRIAL_EVERY_DAYS, examplesTrialDue, settingTriedWithin, STEADY_TRIAL_EVERY_DAYS, STUDIES_PER_CYCLE, STUDIES_PER_DAY, STEADY_TRIAL_RUNS, steadyVerdict, type CycleRecord, type CycleTask, cycleLine, decideProposal, harvestReport, improvementDir, listCycles, listProposals, MIN_GAIN, readTuning, recordCycle, settleAddition, settleSetting, TASK_NAMES, type TaskResult, taskDue, triedBefore, tunedSetting, writeTuning } from "../../src/lib/v3/council/SelfImprovement";
import { listOrders, type ProductionOrder } from "../../src/lib/v3/orders/ProductionOrders";
import { youtubeSettings } from "../../src/lib/v3/publish/YoutubeAuth";
import { unloadOllama } from "../../src/lib/v3/util/Gpu";
import { healthDirs, healthLine, type PcHealth, waitForPcHealth } from "../../src/lib/v3/util/PcHealth";
import { SHORTS_MAX_S } from "../../src/lib/v3/render/Format";
import { runProcess } from "../../src/lib/v3/util/Proc";
import { loadV3Settings, resolveV3Paths, type V3Paths } from "../../src/lib/v3/V3Paths";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const CYCLE_CAP_USD = 0.1;
/**
 * The developer brain's own spend per cycle (its guesses on gpt-4.1 since 6 Nov 2026, lessons, recipes), apart from
 * the other brains' 10 cents so neither crowds the other out.
 */
const DEV_CAP_USD = 0.15;
/** One writing exam at most, and the exams of one day together (`ATOLYE_V3_CIRAK_SINAV_USD`, `ATOLYE_V3_CIRAK_GUNLUK_USD`). */
const EXAM_CAP_USD = examCapUsd();
const EXAM_DAY_CAP_USD = Number(process.env.ATOLYE_V3_CIRAK_GUNLUK_USD) || 1;
/** Writing exams one cycle may sit, the day's cap still the limit (`ATOLYE_V3_CIRAK_SINAV_DONGU`). */
const EXAMS_PER_CYCLE = Number(process.env.ATOLYE_V3_CIRAK_SINAV_DONGU) || 3;
/** What the writing exams of this cycle spent (their budget is their own). */
let writerSpent = 0;
/** Code wants are collected from productions of the last this many days. */
const HARVEST_DAYS = 14;
const log = (s: string) => console.log(s);

/**
 * Owner rule (5 Nov 2026: "pc sağlığına her zaman dikkat edilecek"): the brains watch the whole PC as a production step
 * does, not only the card — every task, video study and exam starts only when RAM, disks and the processor are fit
 * (PcHealth: short RAM unloads Ollama and rests, a throttling processor rests up to 3 min, a nearly full disk stops).
 * The card's temperature is kept inside every local model call (coolGpuProvider).
 */
const fitPc = (paths: V3Paths): Promise<PcHealth> => waitForPcHealth(healthDirs(paths), log, { free: () => unloadOllama(log, "RAM az") });

const delivered = (o: ProductionOrder) => (o.durum === "teslim" || o.durum === "uyariyla_teslim") && !!o.cikti;
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await fs.readFile(file, "utf8")) as T;

/** A small set of done keys kept beside the cycles (compared orders, searched topics). */
async function doneSet(paths: V3Paths, name: string): Promise<{ has: (k: string) => boolean; add: (k: string) => Promise<void> }> {
  const file = path.join(improvementDir(paths.workRoot), name);
  const keys = new Set<string>(existsSync(file) ? await readJson<string[]>(file) : []);
  return {
    has: (k) => keys.has(k),
    add: async (k) => {
      keys.add(k);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(`${file}.tmp`, JSON.stringify([...keys].slice(-500)));
      await fs.rename(`${file}.tmp`, file);
    },
  };
}

/** Runs the quality exam as the production judges (measured, examples as the brain chose) and returns its report. */
async function qualityExam(paths: V3Paths, extra: readonly string[], tag: string): Promise<{ dengeli?: number; dogru: number; toplam: number; cevaplar: { tur: string; kusurlu: boolean; dogru: boolean; puan: number; sorunlar: string[]; id: string }[] } | undefined> {
  await fitPc(paths);
  const tsx = path.join(paths.repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const script = path.join(paths.repoRoot, "scripts", "v3", "kalite-sinavi.ts");
  await runProcess(process.execPath, [tsx, script, "hazirla"], { cwd: paths.repoRoot, timeoutMs: 30 * 60_000, onLine: () => undefined });
  const out = path.join(improvementDir(paths.workRoot), `sinav-${tag}.json`);
  await fs.rm(out, { force: true });
  // 45+ questions since 9 Nov 2026 (one vision call each, the GPU resting between them when hot).
  const r = await runProcess(process.execPath, [tsx, script, "calistir", "--olculu", "--rapor", out, ...extra], { cwd: paths.repoRoot, timeoutMs: 150 * 60_000, onLine: (l) => (/^[✓✗]/.test(l) ? log(`    ${l}`) : undefined) });
  if (r.code !== 0 || !existsSync(out)) return undefined;
  type Answer = { tur: string; kusurlu: boolean; dogru: boolean; puan: number; sorunlar: string[]; id: string; goz?: boolean; goz_dogru?: boolean };
  type Score = { dengeli_yuzde?: number; dogru: number; toplam: number; hep_ayni_karar?: boolean };
  const rep = await readJson<Score & { goz?: Score; cevaplar: Answer[] }>(out);
  // The settings tuned here change only the vision model's verdict: compare the eye's own score (owner, 9 Nov 2026:
  // 30+ questions so a setting's effect can be measured) and learn from the eye's own mistakes; an older report
  // without it is read as before. A judge that gives every frame the same verdict has no score.
  const s = rep.goz ?? rep;
  const cevaplar = rep.goz ? rep.cevaplar.filter((a) => a.goz).map((a) => ({ ...a, dogru: Boolean(a.goz_dogru) })) : rep.cevaplar;
  return { ...(s.hep_ayni_karar || s.dengeli_yuzde === undefined ? {} : { dengeli: s.dengeli_yuzde }), dogru: s.dogru, toplam: s.toplam, cevaplar };
}

/** The exam's flags for the quality brain's settings as they stand (or as given): examples shown, the steady judge. */
const examplesFlag = async (paths: V3Paths, on?: boolean, steady?: boolean) => [
  ...((on ?? (await tunedSetting(paths.workRoot, "kalite", "ornekler"))) ? [] : ["--ornek-yok"]),
  // The judge the production runs: the environment's override first (steadyJudge), then the brain's choice.
  ...((steady ?? steadyJudge(await tunedSetting(paths.workRoot, "kalite", "sabit"))) ? ["--sabit"] : []),
];

/**
 * One writing exam per cycle (owner, 6 Nov 2026: "Claude olmadan yazabilecek duruma gelsin"), inside its day's cap,
 * only with OpenAI (the local model's code failed the checks and heated the card). `ATOLYE_V3_CIRAK_SINAV=0` stops it.
 */
async function writingExam(paths: V3Paths, research: Parameters<typeof writeExam>[1]["research"]): Promise<{ yapildi: boolean; satir: string }> {
  if (/^(0|kapali|off)$/i.test(process.env.ATOLYE_V3_CIRAK_SINAV ?? "")) return { yapildi: false, satir: "kapalı (ATOLYE_V3_CIRAK_SINAV=0)" };
  // An order that comes in stops the exam at its next round (the watcher waits for this cycle before producing).
  const stop = async () => ((await listOrders(paths.workRoot)).some((o) => o.order.durum === "bekliyor") ? "sipariş geldi" : undefined);
  const lines: string[] = [];
  // Owner, 9 Nov 2026: "Çırağın yazma sınavlarını hızlandırmak … maliyet oluşturmadan": several exams in one cycle while
  // the same day's cap allows (each one cheaper since the cached prompt head is booked at its own price).
  for (let i = 0; i < EXAMS_PER_CYCLE; i++) {
    const spent = await examSpendToday(paths.workRoot);
    if (spent + EXAM_CAP_USD > EXAM_DAY_CAP_USD) {
      if (!lines.length) return { yapildi: false, satir: `bugünkü tavan doldu ($${spent.toFixed(2)} / $${EXAM_DAY_CAP_USD})` };
      break;
    }
    const writer = writerBudget(paths, EXAM_CAP_USD);
    if (!writer) return { yapildi: false, satir: "OpenAI seçili değil ya da anahtarı yok; çırak yerel modelle yazmaz" };
    const next = (await examCandidates(paths.repoRoot, paths.workRoot))[0];
    if (!next) {
      if (!lines.length) return { yapildi: false, satir: "sınava uygun yeni commit yok" };
      break;
    }
    if (await stop()) break;
    await fitPc(paths);
    const x = await writeExam(next, { repoRoot: paths.repoRoot, workRoot: paths.workRoot, research, writer, log, stop });
    writerSpent += x.maliyetUsd;
    lines.push(`"${x.gorev.slice(0, 60)}" ${x.sonuc === "gecti" ? "geçti" : x.sonuc === "kaldi" ? "kaldı" : "sayılmadı"} (${x.turlar} tur, $${x.maliyetUsd.toFixed(3)})`);
    if (x.neden?.startsWith("yarıda kaldı")) break;
  }
  return { yapildi: true, satir: `${lines.join(" · ")}; ${writeReadiness(await listWriteExams(paths.workRoot)).ozet}` };
}

async function runTask(task: CycleTask, paths: V3Paths, budget: ReturnType<typeof brainBudget>, orders: readonly ProductionOrder[], dev: ReturnType<typeof brainBudget> = budget): Promise<Omit<TaskResult, "bitis">> {
  const skip = (ayrinti: string) => ({ gorev: task, sonuc: "atlandi" as const, ayrinti });
  const ok = (ayrinti: string) => ({ gorev: task, sonuc: "tamam" as const, ayrinti });
  const meaning = localEmbedder();
  const research = { repoRoot: paths.repoRoot, workRoot: paths.workRoot, budget: dev.budget, model: dev.critic, guessModel: dev.director, ...(meaning ? { meaning } : {}), log };
  if (task === "ogren") {
    // The developer brain sits its exam on the new V3 commits and adds them to what it knows; then it writes one past
    // commit's change itself (the writing exam: graded by that commit's own new scenarios).
    // Since 12 Nov 2026 (owner: "burda yapılan her şeyi gerekli beyinler öğrensin", "maliyetsiz olsun") it also learns
    // the development branch's commits before they go live, main AYAS's code (Git only) and every commit's lesson
    // trailers (`Ders-<beyin>[konu]: …`, written into that brain's memory without a model); since 13 Nov 2026 their
    // `Vaka` blocks too (a fix commit without one leaves a derived case), into the case library.
    const learn = { ...research, refs: await learnRefs(paths.repoRoot) };
    const r = await learnFromCommits(learn);
    const taught = await learnCommitLessons(learn);
    const ayas = await learnAyasCode(learn);
    const exam = await writingExam(paths, research);
    const extra = `; ${taught.ozet}; ${ayas.ozet}`;
    if (!r.okunan && !taught.ders && !taught.vaka && !ayas.kod && !exam.yapildi) return skip(`${r.ozet}${extra}; yazma sınavı: ${exam.satir}`);
    return ok(`${r.okunan ? `${r.ozet}; ${readiness(await listGrades(paths.workRoot)).ozet}` : r.ozet}${extra}; yazma sınavı: ${exam.satir}`);
  }
  if (task === "arastir") {
    // By day the developer brain researches what waits for the evening (its guess is written before Claude builds).
    const done = await researchQueue((await listProposals(paths.workRoot)).map((x) => x.proposal), research);
    return done.length ? ok(done.join(" · ")) : skip("araştırılacak yeni iş yok");
  }
  if (task === "gelistir") {
    // The development queue: one approved proposal per cycle, only while the developer is switched on and in its hours.
    const window = developerWindow(process.env);
    if (!window.acik) return skip(window.neden);
    const job = nextJob((await listProposals(paths.workRoot)).map((x) => x.proposal));
    if (!job) return skip("kuyrukta iş yok");
    const release = await developerLock(paths.workRoot);
    if (!release) return skip("geliştirici başka bir işte");
    try {
      const cirak = await apprenticePolicy(paths.repoRoot, paths.workRoot);
      const done = await runDevJob(job, research, cirak ? { cirak } : {});
      return ok(
        `"${done.baslik}": ${done.durum === "hazir" ? `hazır — dal ${done.is?.dal}` : done.durum === "yapildi" ? "değişiklik gerekmedi" : done.durum === "onaylandi" ? `Claude kullanım sınırı; ${done.is?.bekle?.slice(0, 16) ?? "?"} sonrasına bırakıldı, deneme sayılmadı` : `yapılamadı — ${(done.is?.sorunlar ?? []).join(" | ").slice(0, 200)}`}`,
      );
    } finally {
      await release();
    }
  }
  if (task === "istekler") {
    // Waiting links, plus a failed one once more an hour later; the same video sent twice is studied once.
    const due = studyRequestsDue(await listStudyRequests(paths.workRoot));
    // Other web links the owner gave AYAS (5 Nov 2026): read through the safe public fetch into the shared knowledge.
    const links = linkRequestsDue(await listLinkRequests(paths.repoRoot));
    // Topics the owner asked AYAS to search the internet for (5 Nov 2026): searched, the first hits read, all sourced.
    const searches = linkRequestsDue(await listSearchRequests(paths.repoRoot));
    if (!due.length && !links.length && !searches.length) return skip("bekleyen video, bağlantı ya da arama isteği yok");
    const done: string[] = [];
    for (const { file, request } of searches.slice(0, 2)) {
      try {
        const r = await researchTopic(request.sorgu);
        const saved = r.records.length ? await saveKnowledge(paths.repoRoot, r.records) : undefined;
        const fresh = saved?.outcomes.filter((o) => o.sonuc !== "AYNI").length ?? 0;
        // Every provider failing is worth one more try an hour later; zero relevant hits is an answer.
        Object.assign(request, { durum: r.report.saglayicilar.some((p) => p.ok) ? "tamam" : "hata", sonuc: `${r.ozet}; ${fresh} yeni/güncel kayıt`.slice(0, 400) });
        done.push(`arama "${request.sorgu.slice(0, 50)}" (${r.ozet.slice(0, 80)})`);
      } catch (e) {
        Object.assign(request, { durum: "hata", sonuc: (e as Error).message.slice(0, 300) });
        done.push(`arama "${request.sorgu.slice(0, 50)}" yapılamadı`);
      }
      Object.assign(request, { deneme: (request.deneme ?? 0) + 1, sonDeneme: new Date().toISOString() });
      await saveLinkRequest(file, request);
    }
    for (const { file, request } of links.slice(0, 5)) {
      try {
        const r = await studyLink(request.url, { ...(request.istek ? { istek: request.istek } : {}) });
        const saved = await saveKnowledge(paths.repoRoot, [r.record]);
        Object.assign(request, { durum: r.record.dogrulama.durum === "ERISILEMEDI" ? "hata" : "tamam", sonuc: `${r.not}; ${saved.outcomes[0]!.sonuc}: ${r.record.baslik}`.slice(0, 400) });
        done.push(`bağlantı "${r.record.baslik.slice(0, 60)}" (${r.not.slice(0, 60)})`);
      } catch (e) {
        Object.assign(request, { durum: "hata", sonuc: (e as Error).message.slice(0, 300) });
        done.push(`bağlantı ${request.url.slice(0, 60)} okunamadı`);
      }
      Object.assign(request, { deneme: (request.deneme ?? 0) + 1, sonDeneme: new Date().toISOString() });
      await saveLinkRequest(file, request);
    }
    for (const { id, items } of due.slice(0, 3)) {
      // Outside the try: an unfit PC stops the task without spending the request's attempt.
      await fitPc(paths);
      let outcome: Pick<StudyRequest, "durum" | "sonuc">;
      try {
        const r = await studyReference({ paths, id, neden: `${items[0]!.request.kaynak} isteği`, eye: brainVision(), budget: budget.budget, model: budget.director, log });
        outcome = { durum: "tamam", sonuc: `${r.dersler.length} ders: ${r.ozet}`.slice(0, 400) };
        done.push(`"${r.baslik}" (${r.dersler.length} ders)`);
        // What the brains learned from the video is findable by AYAS and the other brains too (lessons quoted only).
        if (r.dersler.length) await saveKnowledge(paths.repoRoot, [knowledgeFromStudy(r)]).catch((e: Error) => log(`  ortak bilgiye yazılamadı: ${e.message.slice(0, 120)}`));
      } catch (e) {
        outcome = { durum: "hata", sonuc: (e as Error).message.slice(0, 300) };
        done.push(`${id} incelenemedi (${(e as Error).message.slice(0, 80)})`);
      }
      const at = new Date().toISOString();
      for (const { file, request } of items) {
        Object.assign(request, { ...outcome, deneme: studyAttempts(request) + 1, sonDeneme: at });
        await saveStudyRequest(file, request);
      }
    }
    return ok(done.join(", "));
  }
  if (task === "karsilastir") {
    const refs = await listReferences(paths.workRoot);
    if (!refs.length) return skip("henüz incelenmiş referans yok");
    const compared = await doneSet(paths, "karsilastirilan.json");
    const lines: string[] = [];
    for (const o of orders.filter(delivered)) {
      const file = path.join(o.cikti!, "olcum.json");
      if (compared.has(o.id) || !existsSync(file)) continue;
      const ours = await readJson<VideoMeasures>(file);
      // Words per minute against references in the order's language; an order without one gets no such comparison.
      const targets = referenceTargets(refs, kindOf(ours.sureSn), o.dil ?? "");
      if (!targets) continue;
      const gaps = measureGaps(ours, targets);
      const source = `karsilastirma ${o.id}`;
      for (const b of ["kurgu", "kalite"] as const) await forgetSource(paths.workRoot, b, source);
      for (const g of gaps) {
        const l = gapLesson(g);
        await remember(paths.workRoot, { bolum: source, beyin: l.beyin, tur: "ders", konu: `referans karşılaştırması: ${o.konu.slice(0, 60)}`, metin: l.metin });
      }
      await compared.add(o.id);
      lines.push(`"${o.konu.slice(0, 50)}": ${gaps.length ? gaps.map((g) => gapLesson(g).tr).join("; ") : "referans temposunda"}`);
    }
    return lines.length ? ok(lines.join(" · ")) : skip("karşılaştırılacak yeni video yok");
  }
  if (task === "oneriler") {
    let yeni = 0, tekrar = 0;
    // Only recent productions: an old report's wants were mostly built since (Kosovo, Rome… in October 2026).
    for (const o of orders) {
      if (!o.cikti || Date.now() - Date.parse(o.bitis ?? o.olusturuldu) > HARVEST_DAYS * 86_400_000) continue;
      const r = await harvestReport(paths.workRoot, path.join(o.cikti, "yapim-raporu.json"), o.id);
      yeni += r?.yeni ?? 0;
      tekrar += r?.tekrar ?? 0;
    }
    // The same want in other words is counted on the earlier one (owner, 6 Nov 2026: "onaya bir şey düşmüyor").
    const merged = meaning ? await mergeParaphrasedProposals(paths.workRoot, meaning).catch((e: Error) => (log(`  öneriler anlamca birleştirilemedi: ${e.message.slice(0, 120)}`), undefined)) : undefined;
    const mergedLine = merged?.birlesen ? `; ${merged.birlesen} öneri anlamca öncekiyle birleşti` : "";
    return yeni || tekrar || merged?.birlesen ? ok(`${yeni} yeni öneri, ${tekrar} tekrar eden istek${mergedLine}`) : skip("yeni rapor yok");
  }
  if (task === "benzer") {
    // The studio's own learning (owner, 2 Nov 2026: "don't wait for my links"): a recent episode's topic first, else
    // the studio's own searches (content/v3/referans-aramalari.json), the one searched longest ago; at most
    // STUDIES_PER_CYCLE videos a cycle and STUDIES_PER_DAY a day.
    const refs = await listReferences(paths.workRoot);
    const today = refs.filter((r) => Date.now() - Date.parse(r.tarih) < 86_400_000 && /^(benzer arama|kendi araması)/.test(r.neden)).length;
    if (today >= STUDIES_PER_DAY) return skip(`bugünkü inceleme sınırı doldu (${today}/${STUDIES_PER_DAY})`);
    const searched = await doneSet(paths, "aranan-konular.json");
    const historyFile = path.join(improvementDir(paths.workRoot), "arama-gecmisi.json");
    const history: Record<string, string> = existsSync(historyFile) ? await readJson<Record<string, string>>(historyFile) : {};
    const searchesFile = path.join(paths.contentRoot, "referans-aramalari.json");
    const searches = existsSync(searchesFile) ? (await readJson<{ aramalar?: StudySearch[] }>(searchesFile)).aramalar ?? [] : [];
    const studied = new Set(refs.map((r) => r.id));
    const own = youtubeSettings(paths.repoRoot).channelId;
    // An episode's topic counts as searched only once its search went through; one that fails three times is let go
    // (a 429 or a members-only video must neither lose the topic nor block the loop's own searches for ever).
    const failuresFile = path.join(improvementDir(paths.workRoot), "arama-hatalari.json");
    const failures: Record<string, number> = existsSync(failuresFile) ? await readJson<Record<string, number>>(failuresFile) : {};
    const writeAtomic = async (file: string, data: unknown) => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(`${file}.tmp`, JSON.stringify(data, null, 2));
      await fs.rename(`${file}.tmp`, file);
    };
    const failedNow = new Set<string>();
    const done: string[] = [];
    for (let i = 0; i < Math.min(STUDIES_PER_CYCLE, STUDIES_PER_DAY - today); i++) {
      const next = orders.filter(delivered).sort((a, b) => (b.bitis ?? "").localeCompare(a.bitis ?? "")).slice(0, 3).find((o) => !searched.has(o.id) && !failedNow.has(o.id));
      let query: string, target: number, neden: string;
      if (next) {
        const resolved = existsSync(path.join(next.cikti!, "konu-cozumu.json")) ? (await readJson<{ konu?: string }>(path.join(next.cikti!, "konu-cozumu.json"))).konu : undefined;
        query = `${resolved || next.konu} ${next.dil === "tr" ? "animasyon tarih" : "animated history"}`;
        target = existsSync(path.join(next.cikti!, "olcum.json")) ? (await readJson<VideoMeasures>(path.join(next.cikti!, "olcum.json"))).sureSn : 600;
        neden = `benzer arama: ${query}`;
      } else {
        const s = nextSearch(searches, history);
        if (!s) break;
        query = s.sorgu;
        target = s.tur === "short" ? SHORTS_MAX_S : 900;
        neden = `kendi araması: ${query}`;
        history[query] = new Date().toISOString();
        await writeAtomic(historyFile, history);
      }
      // Outside the try: an unfit PC is not the topic's failure.
      await fitPc(paths);
      try {
        const best = pickSimilar(await searchVideos(paths, query), target, { studied, ...(own ? { ownChannelId: own } : {}) });
        if (!best) done.push(`"${query}": incelenmemiş uygun video yok`);
        else {
          const r = await studyReference({ paths, id: best.id, neden, eye: brainVision(), budget: budget.budget, model: budget.director, log });
          studied.add(r.id);
          done.push(`"${query}" → "${r.baslik}" (${r.kanal}), ${r.dersler.length} ders`);
        }
        if (next) await searched.add(next.id);
      } catch (e) {
        // A video that cannot be read (members only, a 429) is passed; the next search goes on.
        done.push(`"${query}": incelenemedi (${(e as Error).message.slice(0, 80)})`);
        if (next) {
          failedNow.add(next.id);
          failures[next.id] = (failures[next.id] ?? 0) + 1;
          await writeAtomic(failuresFile, failures);
          if (failures[next.id]! >= 3) await searched.add(next.id);
        }
      }
    }
    return done.length ? ok(done.join(" · ")) : skip("aranacak bir şey yok");
  }
  if (task === "pekistir") {
    // Many videos teach the same technique in other words: past CONSOLIDATE_AT single-video lessons a brain keeps the
    // recurring techniques, merged, with how many videos showed each (the records keep every original lesson).
    const lines: string[] = [];
    for (const beyin of STUDY_BRAINS) {
      const all = (await allLessons(paths.workRoot, beyin)).filter(isReferenceLesson);
      const single = all.filter((l) => l.bolum !== REFERENCE_SUMMARY);
      if (single.length < CONSOLIDATE_AT) continue;
      // An earlier summary carries its video count ("referans özeti: 5 video"), so its support adds up instead of
      // counting as one source.
      const support = (l: (typeof all)[number]) => (l.bolum === REFERENCE_SUMMARY ? Number(/(\d+) video/.exec(l.konu)?.[1]) || 1 : 1);
      const out = await budget.budget.generate(`gelisim-pekistir-${beyin}`, budget.director, consolidationPrompt(beyin, all.map((l) => ({ metin: l.metin, kaynak: l.bolum === REFERENCE_SUMMARY ? "özet" : l.konu.replace(/^referans: /, ""), destek: support(l) }))), { maxTokens: 1_500 });
      const merged = parseConsolidation(out.result.content);
      if (!merged) {
        lines.push(`${beyin}: özet okunamadı, dersler olduğu gibi kaldı`);
        continue;
      }
      // Only the lessons that were read and merged go: one a study wrote during the model call stays for the next time.
      const read = new Set(all.map((l) => `${l.tarih}|${l.metin}`));
      await forgetWhere(paths.workRoot, beyin, (l) => isReferenceLesson(l) && read.has(`${l.tarih}|${l.metin}`));
      for (const m of merged) await remember(paths.workRoot, { bolum: REFERENCE_SUMMARY, beyin, tur: "ders", konu: `referans özeti: ${m.destek} video`, metin: m.metin });
      lines.push(`${beyin}: ${all.length} ders → ${merged.length} (en güçlüsü ${merged[0]!.destek} videoda)`);
    }
    return lines.length ? ok(lines.join(" · ")) : skip(`pekiştirilecek kadar ders birikmedi (beyin başına ${CONSOLIDATE_AT})`);
  }
  if (task === "sinav") {
    const exam = await qualityExam(paths, await examplesFlag(paths), "son");
    if (!exam) return { gorev: task, sonuc: "hata", ayrinti: "kalite sınavı çalışmadı" };
    const history = path.join(improvementDir(paths.workRoot), "sinav-gecmisi.jsonl");
    const before = existsSync(history) ? (await fs.readFile(history, "utf8")).trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as { dengeli?: number }).at(-1)?.dengeli : undefined;
    await fs.appendFile(history, `${JSON.stringify({ tarih: new Date().toISOString(), sinav: "kalite", dengeli: exam.dengeli, dogru: exam.dogru, toplam: exam.toplam, ekler: (await activeAdditions(paths.workRoot, "kalite")).length })}\n`);
    const drop = before !== undefined && exam.dengeli !== undefined && before - exam.dengeli >= 10;
    return ok(`kalite beyni ${exam.dogru}/${exam.toplam}, dengeli doğruluk %${exam.dengeli ?? "?"}${before !== undefined ? ` (önceki %${before})` : ""}${drop ? " — UYARI: geriledi, model ya da kurallar değişmiş olabilir" : ""}`);
  }
  // ayar, first the steady judge (owner approval, 2 Nov 2026): three exams with the judge as it is, three with
  // temperature 0 and a fixed seed; kept if the accuracy does not drop. Decided once a week; a cycle with this trial
  // does nothing else (six exams are enough GPU for one cycle).
  if (!settingTriedWithin(await readTuning(paths.workRoot), "kalite", "sabit", STEADY_TRIAL_EVERY_DAYS)) {
    const current = (await tunedSetting(paths.workRoot, "kalite", "sabit")) === true;
    const runsOf = async (steady: boolean, tag: string) => {
      const runs: number[] = [];
      for (let i = 0; i < STEADY_TRIAL_RUNS; i++) {
        const r = await qualityExam(paths, await examplesFlag(paths, undefined, steady), `${tag}-${i + 1}`);
        if (r?.dengeli !== undefined) runs.push(r.dengeli);
      }
      return runs;
    };
    const noisy = await runsOf(false, "sabit-temel");
    const steady = await runsOf(true, "sabit-aday");
    // Too few scores (Ollama down, an exam crashed) decide nothing: the setting stays as it is and the trial comes again.
    if (noisy.length < STEADY_TRIAL_RUNS || steady.length < STEADY_TRIAL_RUNS) return { gorev: task, sonuc: "hata", ayrinti: `sabit hakem denemesi ölçülemedi (şimdiki ${noisy.length}, sabit ${steady.length} sınav puanı); ayar değişmedi` };
    const v = steadyVerdict(noisy, steady);
    // Kept → on; not kept while on → turned off (recorded as a kept "off"); not kept while off → tried, stays off.
    const turnOff = !v.kalici && current;
    await writeTuning(paths.workRoot, settleSetting(await readTuning(paths.workRoot), "kalite", "sabit", !turnOff, v.once, v.sonra, new Date(), v.kalici || turnOff));
    const line = (xs: readonly number[]) => xs.map((x) => `%${x}`).join("/") || "ölçülemedi";
    return ok(`sabit hakem (sıcaklık 0, sabit tohum): şimdiki ${line(noisy)} → sabit ${line(steady)}; ${v.kalici ? "kalıcı yapıldı" : current ? "geri alındı" : "denenip bırakıldı"}${!v.tutarli && steady.length ? " (sabit hakemin cevapları bile değişti: tohum tutmuyor)" : ""}`);
  }
  // Then the examples setting and one new prompt addition, each measured against the exam as it stands; a
  // promising change is measured a second time with the base beside it (confirmedGain: the exam is noisy).
  const baseExamples = (await tunedSetting(paths.workRoot, "kalite", "ornekler")) === true;
  const base = await qualityExam(paths, await examplesFlag(paths, baseExamples), "ayar-temel");
  if (base?.dengeli === undefined) return { gorev: task, sonuc: "hata", ayrinti: "temel sınav ölçülemedi" };
  const baseRuns = [base.dengeli];
  const measure = async (args: readonly string[], tag: string, first: number) => {
    const runs = [first];
    if (first - Math.max(...baseRuns) < MIN_GAIN) return runs;
    if (baseRuns.length < 2) {
      const again = await qualityExam(paths, await examplesFlag(paths, baseExamples), "ayar-temel-2");
      if (again?.dengeli !== undefined) baseRuns.push(again.dengeli);
    }
    const second = await qualityExam(paths, args, `${tag}-2`);
    if (second?.dengeli !== undefined) runs.push(second.dengeli);
    return runs;
  };
  const runsLine = (xs: readonly number[]) => xs.map((x) => `%${x}`).join("/");
  const parts: string[] = [];
  const flipArgs = await examplesFlag(paths, !baseExamples);
  let tuning = await readTuning(paths.workRoot);
  // A setting measured lately is not measured again (it lost four times in nine days, an exam each time).
  const flipDue = examplesTrialDue(tuning);
  const flipped = flipDue ? await qualityExam(paths, flipArgs, "ayar-ornek") : undefined;
  if (!flipDue) {
    const last = [...tuning.ayarGecmisi].reverse().find((h) => h.beyin === "kalite" && h.anahtar === "ornekler");
    parts.push(`örnek kare ayarı son ${EXAMPLES_TRIAL_EVERY_DAYS} gün içinde ölçüldü${last ? ` (%${last.once} → %${last.sonra}, ${last.kalici ? "kalıcı yapıldı" : "geri alındı"})` : ""}: bu döngüde yeniden denenmedi`);
  }
  if (flipped?.dengeli !== undefined) {
    const runs = await measure(flipArgs, "ayar-ornek", flipped.dengeli);
    const g = confirmedGain(baseRuns, runs);
    tuning = settleSetting(tuning, "kalite", "ornekler", !baseExamples, g.once, g.sonra, new Date(), g.kalici);
    parts.push(`örnek kare göstermeyi ${!baseExamples ? "açmak" : "kapatmak"}: ${runsLine(baseRuns)} → ${runsLine(runs)}, ${g.kalici ? "kalıcı yapıldı" : "geri alındı"}`);
    await writeTuning(paths.workRoot, tuning);
  }
  const wrong = base.cevaplar.filter((a) => !a.dogru);
  if (!wrong.length) return ok([...parts, "sınavda yanlış yok: yeni istem eki denenmedi"].join(" · "));
  const current = await activeAdditions(paths.workRoot, "kalite");
  const tried = (tuning.ekler.kalite ?? []).filter((a) => a.durum === "geri_alindi").map((a) => a.metin);
  const out = await budget.budget.generate("gelisim-istem-eki", budget.director, additionPrompt(wrong.map((w) => ({ tur: w.tur, kusurlu: w.kusurlu, beklenen: w.kusurlu ? "it has a fault the model must report" : "nothing is wrong with it", cevap: `${w.puan}/10${w.sorunlar.length ? `, ${w.sorunlar.join("; ")}` : ", no fault named"}` })), current, tried), { maxTokens: 300 });
  const v = readJsonAnswer<{ kural?: unknown; neden?: unknown }>(out.result.content);
  const rule = typeof v?.kural === "string" ? v.kural.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  if (!rule || triedBefore(tuning, "kalite", rule)) return ok([...parts, "yeni bir istem eki önerilemedi"].join(" · "));
  // The addition is measured with the setting as the production uses it; a setting changed just now is measured anew.
  if (((await tunedSetting(paths.workRoot, "kalite", "ornekler")) === true) !== baseExamples) return ok([...parts, "ayar değişti: istem eki bir sonraki döngüde denenecek"].join(" · "));
  const ruleArgs = [...(await examplesFlag(paths)), "--ek-kural", rule];
  const withRule = await qualityExam(paths, ruleArgs, "ayar-ek");
  if (withRule?.dengeli === undefined) return ok([...parts, `istem eki ölçülemedi: "${rule}"`].join(" · "));
  const runs = await measure(ruleArgs, "ayar-ek", withRule.dengeli);
  const g = confirmedGain(baseRuns, runs);
  await writeTuning(paths.workRoot, settleAddition(await readTuning(paths.workRoot), "kalite", { metin: rule, tarih: new Date().toISOString(), ...(typeof v?.neden === "string" ? { neden: v.neden.slice(0, 200) } : {}) }, g.once, g.sonra, g.kalici));
  return ok([...parts, `istem eki "${rule}": ${runsLine(baseRuns)} → ${runsLine(runs)}, ${g.kalici ? "kalıcı yapıldı" : "geri alındı"}`].join(" · "));
}

async function cycle(paths: V3Paths): Promise<CycleRecord> {
  const lock = path.join(improvementDir(paths.workRoot), ".dongu.pid");
  await fs.mkdir(path.dirname(lock), { recursive: true });
  if (existsSync(lock)) {
    const pid = Number((await fs.readFile(lock, "utf8")).trim());
    try {
      if (pid) {
        process.kill(pid, 0);
        throw new Error(`V3_CYCLE_RUNNING: pid ${pid}`);
      }
    } catch (e) {
      if ((e as Error).message.startsWith("V3_CYCLE_RUNNING")) throw e;
    }
  }
  await fs.writeFile(lock, String(process.pid));
  const basla = new Date().toISOString();
  const gorevler: TaskResult[] = [];
  let durdu: string | undefined;
  const budget = brainBudget(paths, CYCLE_CAP_USD);
  const dev = brainBudget(paths, DEV_CAP_USD);
  writerSpent = 0;
  try {
    const only = arg("--yalniz")?.split(",").map((s) => s.trim()) as CycleTask[] | undefined;
    const cycles = await listCycles(paths.workRoot);
    for (const task of CYCLE_TASKS) {
      if (only && !only.includes(task)) continue;
      if (!process.argv.includes("--zorla") && !taskDue(cycles, task)) continue;
      // The PC first (it may rest here), then a fresh look at the orders.
      let health: PcHealth;
      try {
        health = await fitPc(paths);
      } catch (e) {
        durdu = `PC sağlığı: ${(e as Error).message.slice(0, 200)}`;
        break;
      }
      const orders = (await listOrders(paths.workRoot)).map((x) => x.order);
      // An order that came in wins: the cycle stops before the next task.
      if (orders.some((o) => o.durum === "bekliyor")) {
        durdu = "sipariş geldi";
        break;
      }
      log(`• ${TASK_NAMES[task]}`);
      log(`  sağlık: ${healthLine(health)}`);
      const r = await runTask(task, paths, budget, orders, dev).catch((e: Error): Omit<TaskResult, "bitis"> => ({ gorev: task, sonuc: "hata", ayrinti: e.message.slice(0, 300) }));
      log(`  ${r.sonuc}: ${r.ayrinti}`);
      gorevler.push({ ...r, bitis: new Date().toISOString() });
    }
  } finally {
    const record: CycleRecord = { basla, bitis: new Date().toISOString(), gorevler, ...(durdu ? { durdu } : {}), maliyetUsd: Math.round((budget.budget.spentUsd + dev.budget.spentUsd + writerSpent) * 1e6) / 1e6 };
    await recordCycle(paths.workRoot, record);
    // AYAS reads its inbox: the cycle's summary goes there like a production's report.
    if (gorevler.some((t) => t.sonuc !== "atlandi")) await fs.appendFile(path.join(paths.workRoot, "_kutuphane", "ayas-gelen-kutusu.jsonl"), `${JSON.stringify({ tarih: record.bitis, kaynak: "atolye-v3-gelisim", ozet: cycleLine(record), maliyetUsd: record.maliyetUsd })}\n`);
    await fs.rm(lock, { force: true });
  }
  return (await listCycles(paths.workRoot)).at(-1)!;
}

async function main() {
  loadV3Settings();
  const paths = resolveV3Paths();
  const cmd = process.argv[2];
  if (cmd === "dongu") {
    const c = await cycle(paths);
    log(`döngü bitti: ${cycleLine(c)} ($${c.maliyetUsd.toFixed(4)})`);
    return;
  }
  if (cmd === "durum") {
    for (const c of (await listCycles(paths.workRoot)).slice(-5)) log(`${c.bitis.slice(0, 16)}  ${cycleLine(c)}`);
    const t = await readTuning(paths.workRoot);
    for (const [b, list] of Object.entries(t.ekler)) for (const a of list ?? []) log(`istem eki [${b}] ${a.durum}: "${a.metin}" (%${a.olcumOnce} → %${a.olcumSonra})`);
    for (const h of t.ayarGecmisi.slice(-5)) log(`ayar [${h.beyin}] ${h.anahtar}=${h.deger}: %${h.once} → %${h.sonra} ${h.kalici ? "kalıcı" : "geri alındı"}`);
    const waiting = (await listProposals(paths.workRoot)).filter((x) => x.proposal.durum === "bekliyor").length;
    log(`onay bekleyen geliştirme önerisi: ${waiting}`);
    return;
  }
  if (cmd === "oneriler") {
    for (const { proposal: p } of await listProposals(paths.workRoot)) log(`${p.durum.padEnd(11)} ${p.id}  [${p.beyin}] ${p.baslik}${p.sayi > 1 ? ` (${p.sayi} kez)` : ""}${p.birlesti ? ` → ${p.birlesti.hedef} (${p.birlesti.benzerlik})` : ""}\n${" ".repeat(12)}${p.neden.slice(0, 200)}`);
    return;
  }
  if (cmd === "birlestir") {
    // The same want in other words, counted on the earlier proposal (ProposalMerge; the idle loop does it every cycle).
    const e = localEmbedder();
    if (!e) throw new Error("anlam araması kapalı (ATOLYE_V3_EMBED_MODEL=0)");
    const r = await mergeParaphrasedProposals(paths.workRoot, e);
    log(r.birlesen ? r.satirlar.join("\n") : "birleşecek öneri yok");
    return;
  }
  if (cmd === "onayla" || cmd === "reddet") {
    const id = process.argv[3];
    if (!id) throw new Error(`Kullanım: gelisim.ts ${cmd} <öneri id> [--not "…"]`);
    const p = await decideProposal(paths.workRoot, id, cmd === "onayla" ? "onaylandi" : "reddedildi", arg("--not"));
    log(`${p.durum}: ${p.baslik}${p.durum === "onaylandi" ? ` — geliştirme kuyruğunda; ${developerWindow(process.env).neden} (scripts/v3/gelistirici.ts liste)` : ""}`);
    return;
  }
  throw new Error("Kullanım: gelisim.ts dongu [--zorla] [--yalniz …] | durum | oneriler | birlestir | onayla <id> | reddet <id>");
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
