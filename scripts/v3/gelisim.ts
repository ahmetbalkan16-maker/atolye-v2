/**
 * Atölye V3 — the brains' self-improvement while no video is being made (owner approval, 2 Nov 2026). The order
 * watcher (`yapim.ts izle`) runs a cycle by itself when no order waits and the pause since the last one is over; a cycle
 * stops at the next task when an order comes in.
 *
 *   npx tsx scripts/v3/gelisim.ts dongu [--zorla] [--yalniz istekler,karsilastir,oneriler,benzer,pekistir,sinav,ayar,ogren,arastir,gelistir]
 *   npx tsx scripts/v3/gelisim.ts durum                    # last cycles, exams, the brains' own changes
 *   npx tsx scripts/v3/gelisim.ts oneriler                 # code proposals for the owner (Gelişim Merkezi)
 *   npx tsx scripts/v3/gelisim.ts onayla <id> [--not "…"]  # the owner's decision; nothing is built by it
 *   npx tsx scripts/v3/gelisim.ts reddet <id> [--not "…"]
 *
 * Tasks: the owner's links are studied; delivered videos are compared with the references (lessons); the productions'
 * code wants are collected as proposals; a video similar to a recent episode is searched and studied; the quality
 * brain sits its exam; it tries one new prompt addition and its one tunable setting, kept only when the exam rises by
 * MIN_GAIN points. Code never changes here. Spend: at most 10 cents a cycle; the eye waits for a cool GPU.
 */
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { knowledgeFromStudy, linkRequestsDue, listLinkRequests, saveLinkRequest } from "../../src/lib/ayas/research/AyasLinkRequests";
import { saveKnowledge } from "../../src/lib/ayas/research/AyasSharedKnowledge";
import { studyLink } from "../../src/lib/ayas/research/AyasWebResearch";
import { brainBudget, brainVision, steadyJudge } from "../../src/lib/v3/council/BrainModels";
import { readJsonAnswer } from "../../src/lib/v3/council/Council";
import { listGrades, readiness } from "../../src/lib/v3/council/DevBrain";
import { developerLock } from "../../src/lib/v3/council/Developer";
import { developerWindow, nextJob } from "../../src/lib/v3/council/DevQueue";
import { learnFromCommits, researchQueue, runDevJob } from "../../src/lib/v3/council/DevResearch";
import { allLessons, forgetSource, forgetWhere, remember } from "../../src/lib/v3/council/ExperienceMemory";
import { CONSOLIDATE_AT, consolidationPrompt, gapLesson, isReferenceLesson, kindOf, listReferences, listStudyRequests, measureGaps, nextSearch, parseConsolidation, pickSimilar, REFERENCE_SUMMARY, referenceTargets, saveStudyRequest, searchVideos, STUDY_BRAINS, studyAttempts, type StudyRequest, studyRequestsDue, type StudySearch, studyReference, type VideoMeasures } from "../../src/lib/v3/council/ReferenceStudy";
import { activeAdditions, additionPrompt, confirmedGain, CYCLE_TASKS, settingTriedWithin, STEADY_TRIAL_EVERY_DAYS, STUDIES_PER_CYCLE, STUDIES_PER_DAY, STEADY_TRIAL_RUNS, steadyVerdict, type CycleRecord, type CycleTask, cycleLine, decideProposal, harvestReport, improvementDir, listCycles, listProposals, MIN_GAIN, readTuning, recordCycle, settleAddition, settleSetting, TASK_NAMES, type TaskResult, taskDue, triedBefore, tunedSetting, writeTuning } from "../../src/lib/v3/council/SelfImprovement";
import { listOrders, type ProductionOrder } from "../../src/lib/v3/orders/ProductionOrders";
import { youtubeSettings } from "../../src/lib/v3/publish/YoutubeAuth";
import { runProcess } from "../../src/lib/v3/util/Proc";
import { loadV3Settings, resolveV3Paths, type V3Paths } from "../../src/lib/v3/V3Paths";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const CYCLE_CAP_USD = 0.1;
/** Code wants are collected from productions of the last this many days. */
const HARVEST_DAYS = 14;
const log = (s: string) => console.log(s);

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
  const tsx = path.join(paths.repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const script = path.join(paths.repoRoot, "scripts", "v3", "kalite-sinavi.ts");
  await runProcess(process.execPath, [tsx, script, "hazirla"], { cwd: paths.repoRoot, timeoutMs: 30 * 60_000, onLine: () => undefined });
  const out = path.join(improvementDir(paths.workRoot), `sinav-${tag}.json`);
  await fs.rm(out, { force: true });
  const r = await runProcess(process.execPath, [tsx, script, "calistir", "--olculu", "--rapor", out, ...extra], { cwd: paths.repoRoot, timeoutMs: 60 * 60_000, onLine: (l) => (/^[✓✗]/.test(l) ? log(`    ${l}`) : undefined) });
  if (r.code !== 0 || !existsSync(out)) return undefined;
  const rep = await readJson<{ dengeli_yuzde?: number; dogru: number; toplam: number; hep_ayni_karar?: boolean; cevaplar: { tur: string; kusurlu: boolean; dogru: boolean; puan: number; sorunlar: string[]; id: string }[] }>(out);
  // A judge that gives every frame the same verdict has no score (kalite-sinavi's own warning).
  return { ...(rep.hep_ayni_karar || rep.dengeli_yuzde === undefined ? {} : { dengeli: rep.dengeli_yuzde }), dogru: rep.dogru, toplam: rep.toplam, cevaplar: rep.cevaplar };
}

/** The exam's flags for the quality brain's settings as they stand (or as given): examples shown, the steady judge. */
const examplesFlag = async (paths: V3Paths, on?: boolean, steady?: boolean) => [
  ...((on ?? (await tunedSetting(paths.workRoot, "kalite", "ornekler"))) ? [] : ["--ornek-yok"]),
  // The judge the production runs: the environment's override first (steadyJudge), then the brain's choice.
  ...((steady ?? steadyJudge(await tunedSetting(paths.workRoot, "kalite", "sabit"))) ? ["--sabit"] : []),
];

async function runTask(task: CycleTask, paths: V3Paths, budget: ReturnType<typeof brainBudget>, orders: readonly ProductionOrder[]): Promise<Omit<TaskResult, "bitis">> {
  const skip = (ayrinti: string) => ({ gorev: task, sonuc: "atlandi" as const, ayrinti });
  const ok = (ayrinti: string) => ({ gorev: task, sonuc: "tamam" as const, ayrinti });
  const research = { repoRoot: paths.repoRoot, workRoot: paths.workRoot, budget: budget.budget, model: budget.critic, log };
  if (task === "ogren") {
    // The developer brain sits its exam on the new V3 commits and adds them to what it knows.
    const r = await learnFromCommits(research);
    return r.okunan ? ok(`${r.ozet}; ${readiness(await listGrades(paths.workRoot)).ozet}`) : skip(r.ozet);
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
      const done = await runDevJob(job, research);
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
    if (!due.length && !links.length) return skip("bekleyen video ya da bağlantı isteği yok");
    const done: string[] = [];
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
      const targets = referenceTargets(refs, kindOf(ours.sureSn));
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
    return yeni || tekrar ? ok(`${yeni} yeni öneri, ${tekrar} tekrar eden istek`) : skip("yeni rapor yok");
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
        target = s.tur === "short" ? 60 : 900;
        neden = `kendi araması: ${query}`;
        history[query] = new Date().toISOString();
        await writeAtomic(historyFile, history);
      }
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
  const flipped = await qualityExam(paths, flipArgs, "ayar-ornek");
  let tuning = await readTuning(paths.workRoot);
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
  try {
    const only = arg("--yalniz")?.split(",").map((s) => s.trim()) as CycleTask[] | undefined;
    const cycles = await listCycles(paths.workRoot);
    for (const task of CYCLE_TASKS) {
      if (only && !only.includes(task)) continue;
      if (!process.argv.includes("--zorla") && !taskDue(cycles, task)) continue;
      const orders = (await listOrders(paths.workRoot)).map((x) => x.order);
      // An order that came in wins: the cycle stops before the next task.
      if (orders.some((o) => o.durum === "bekliyor")) {
        durdu = "sipariş geldi";
        break;
      }
      log(`• ${TASK_NAMES[task]}`);
      const r = await runTask(task, paths, budget, orders).catch((e: Error): Omit<TaskResult, "bitis"> => ({ gorev: task, sonuc: "hata", ayrinti: e.message.slice(0, 300) }));
      log(`  ${r.sonuc}: ${r.ayrinti}`);
      gorevler.push({ ...r, bitis: new Date().toISOString() });
    }
  } finally {
    const record: CycleRecord = { basla, bitis: new Date().toISOString(), gorevler, ...(durdu ? { durdu } : {}), maliyetUsd: budget.budget.spentUsd };
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
    for (const { proposal: p } of await listProposals(paths.workRoot)) log(`${p.durum.padEnd(11)} ${p.id}  [${p.beyin}] ${p.baslik}${p.sayi > 1 ? ` (${p.sayi} kez)` : ""}\n${" ".repeat(12)}${p.neden.slice(0, 200)}`);
    return;
  }
  if (cmd === "onayla" || cmd === "reddet") {
    const id = process.argv[3];
    if (!id) throw new Error(`Kullanım: gelisim.ts ${cmd} <öneri id> [--not "…"]`);
    const p = await decideProposal(paths.workRoot, id, cmd === "onayla" ? "onaylandi" : "reddedildi", arg("--not"));
    log(`${p.durum}: ${p.baslik}${p.durum === "onaylandi" ? ` — geliştirme kuyruğunda; ${developerWindow(process.env).neden} (scripts/v3/gelistirici.ts liste)` : ""}`);
    return;
  }
  throw new Error("Kullanım: gelisim.ts dongu [--zorla] [--yalniz …] | durum | oneriler | onayla <id> | reddet <id>");
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
