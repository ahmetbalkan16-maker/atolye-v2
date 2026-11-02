/**
 * Atölye V3 — the brains' self-improvement while no video is being made (owner approval, 2 Nov 2026). The order
 * watcher (`yapim.ts izle`) runs a cycle by itself when no order waits and the pause since the last one is over; a cycle
 * stops at the next task when an order comes in.
 *
 *   npx tsx scripts/v3/gelisim.ts dongu [--zorla] [--yalniz istekler,karsilastir,oneriler,benzer,sinav,ayar]
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
import { brainBudget, brainVision } from "../../src/lib/v3/council/BrainModels";
import { readJsonAnswer } from "../../src/lib/v3/council/Council";
import { forgetSource, remember } from "../../src/lib/v3/council/ExperienceMemory";
import { gapLesson, kindOf, listReferences, listStudyRequests, measureGaps, pickSimilar, referenceTargets, saveStudyRequest, searchVideos, studyReference, type VideoMeasures } from "../../src/lib/v3/council/ReferenceStudy";
import { activeAdditions, additionPrompt, confirmedGain, CYCLE_TASKS, type CycleRecord, type CycleTask, cycleLine, decideProposal, harvestReport, improvementDir, listCycles, listProposals, MIN_GAIN, readTuning, recordCycle, settleAddition, settleSetting, TASK_NAMES, type TaskResult, taskDue, triedBefore, tunedSetting, writeTuning } from "../../src/lib/v3/council/SelfImprovement";
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

const examplesFlag = async (paths: V3Paths, on?: boolean) => ((on ?? (await tunedSetting(paths.workRoot, "kalite", "ornekler"))) ? [] : ["--ornek-yok"]);

async function runTask(task: CycleTask, paths: V3Paths, budget: ReturnType<typeof brainBudget>, orders: readonly ProductionOrder[]): Promise<Omit<TaskResult, "bitis">> {
  const skip = (ayrinti: string) => ({ gorev: task, sonuc: "atlandi" as const, ayrinti });
  const ok = (ayrinti: string) => ({ gorev: task, sonuc: "tamam" as const, ayrinti });
  if (task === "istekler") {
    const waiting = (await listStudyRequests(paths.workRoot)).filter((x) => x.request.durum === "bekliyor");
    if (!waiting.length) return skip("bekleyen video isteği yok");
    const done: string[] = [];
    for (const { file, request } of waiting.slice(0, 3)) {
      try {
        const r = await studyReference({ paths, id: request.id, neden: `${request.kaynak} isteği`, eye: brainVision(), budget: budget.budget, model: budget.director, log });
        Object.assign(request, { durum: "tamam", sonuc: `${r.dersler.length} ders: ${r.ozet}`.slice(0, 400) });
        done.push(`"${r.baslik}" (${r.dersler.length} ders)`);
      } catch (e) {
        Object.assign(request, { durum: "hata", sonuc: (e as Error).message.slice(0, 300) });
        done.push(`${request.id} incelenemedi`);
      }
      await saveStudyRequest(file, request);
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
    const searched = await doneSet(paths, "aranan-konular.json");
    const next = orders.filter(delivered).sort((a, b) => (b.bitis ?? "").localeCompare(a.bitis ?? "")).slice(0, 3).find((o) => !searched.has(o.id));
    if (!next) return skip("aranacak yeni konu yok");
    const resolved = existsSync(path.join(next.cikti!, "konu-cozumu.json")) ? (await readJson<{ konu?: string }>(path.join(next.cikti!, "konu-cozumu.json"))).konu : undefined;
    const query = `${resolved || next.konu} ${next.dil === "tr" ? "animasyon tarih" : "animated history"}`;
    const ours = existsSync(path.join(next.cikti!, "olcum.json")) ? (await readJson<VideoMeasures>(path.join(next.cikti!, "olcum.json"))).sureSn : 600;
    const hits = await searchVideos(paths, query);
    const studied = new Set((await listReferences(paths.workRoot)).map((r) => r.id));
    const own = youtubeSettings(paths.repoRoot).channelId;
    const best = pickSimilar(hits, ours, { studied, ...(own ? { ownChannelId: own } : {}) });
    await searched.add(next.id);
    if (!best) return ok(`"${query}" araması: aynı türden incelenmemiş video yok`);
    const r = await studyReference({ paths, id: best.id, neden: `benzer arama: ${query}`, eye: brainVision(), budget: budget.budget, model: budget.director, log });
    return ok(`"${query}" → "${r.baslik}" (${r.kanal}) incelendi, ${r.dersler.length} ders`);
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
  // ayar: the one tunable setting, then one new prompt addition, each measured against the exam as it stands; a
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
    log(`${p.durum}: ${p.baslik}${p.durum === "onaylandi" ? " — bir geliştirme oturumu bunu yapacak; kod kendiliğinden değişmez" : ""}`);
    return;
  }
  throw new Error("Kullanım: gelisim.ts dongu [--zorla] [--yalniz …] | durum | oneriler | onayla <id> | reddet <id>");
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
