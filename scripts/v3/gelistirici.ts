/**
 * Atölye V3 development queue (DevQueue / Developer) and the developer brain (DevBrain / DevResearch): the approved
 * proposals, what the brain researched by day and what Claude built in the evening. The idle loop researches the
 * queue and learns from new commits; from 16:30 the order watcher runs `aksam` (every job that gathered, one after
 * another, while no order waits). These commands look at it, run a part of it now, apply a kept build or close a job.
 *
 *   npx tsx scripts/v3/gelistirici.ts liste
 *   npx tsx scripts/v3/gelistirici.ts karne                          (the developer brain's report card and lessons)
 *   npx tsx scripts/v3/gelistirici.ts arastir [--id <öneri id>]       (research now; the guess is recorded)
 *   npx tsx scripts/v3/gelistirici.ts ogren [--sinav <n>] [--tarif <n>]  (exam on new V3 commits, then learn them and
 *                                                                     their code; n "how it was done" recipes)
 *   npx tsx scripts/v3/gelistirici.ts kod [--id <sha|öneri id>]       (what it learned of a change as code)
 *   npx tsx scripts/v3/gelistirici.ts aksam                          (the evening: every waiting job, inside the hours)
 *   npx tsx scripts/v3/gelistirici.ts calistir [--id <öneri id>]     (builds one now, whatever the hours)
 *   npx tsx scripts/v3/gelistirici.ts uygula --id <öneri id>          (into this checkout's branch; push stays yours)
 *   npx tsx scripts/v3/gelistirici.ts kapat --id <öneri id> --not "…"  (already done elsewhere)
 */
import { brainBudget } from "../../src/lib/v3/council/BrainModels";
import { codeExperienceLines, listCodeExperience, listGrades, loadDevBrainView, readiness, say } from "../../src/lib/v3/council/DevBrain";
import { applyBuild, developerLock } from "../../src/lib/v3/council/Developer";
import { developerWindow, EVENING_MAX_JOBS, nextJob, waitingForLimit } from "../../src/lib/v3/council/DevQueue";
import { EXAMS_PER_PASS, learnFromCommits, RECIPES_PER_PASS, type ResearchDeps, researchJob, researchQueue, runDevJob } from "../../src/lib/v3/council/DevResearch";
import { listProposals, updateProposal } from "../../src/lib/v3/council/SelfImprovement";
import { listOrders } from "../../src/lib/v3/orders/ProductionOrders";
import { unloadOllama } from "../../src/lib/v3/util/Gpu";
import { healthDirs, healthLine, waitForPcHealth } from "../../src/lib/v3/util/PcHealth";
import { loadV3Settings, resolveV3Paths } from "../../src/lib/v3/V3Paths";

const log = (s: string) => console.log(s);
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** The developer brain's model calls per run (cheap: search words, a guess, a lesson). */
const BRAIN_CAP_USD = 0.1;

const LABEL: Readonly<Record<string, string>> = { onaylandi: "kuyrukta", yapiliyor: "geliştiriliyor", hazir: "hazır", yapilamadi: "yapılamadı", yapildi: "yapıldı" };

async function main() {
  loadV3Settings();
  const paths = resolveV3Paths();
  const cmd = process.argv[2];
  const proposals = (await listProposals(paths.workRoot)).map((x) => x.proposal);
  const models = () => brainBudget(paths, BRAIN_CAP_USD);
  const deps = (): ResearchDeps => {
    const m = models();
    return { repoRoot: paths.repoRoot, workRoot: paths.workRoot, budget: m.budget, model: m.critic, log };
  };
  if (cmd === "liste") {
    log(`geliştirici: ${developerWindow(process.env).neden}`);
    for (const p of proposals.filter((x) => x.durum in LABEL)) {
      log(`${LABEL[p.durum]!.padEnd(15)} ${p.id}  ${p.baslik}${waitingForLimit(p) ? `  (Claude sınırı: ${p.is!.bekle!.slice(0, 16)} sonrası)` : ""}`);
      if (p.is?.dal) log(`${" ".repeat(16)}dal: ${p.is.dal} · ${p.is.dosyalar?.length ?? 0} dosya`);
      if (p.is?.sorunlar?.length) log(`${" ".repeat(16)}neden: ${p.is.sorunlar.join(" | ").slice(0, 240)}`);
      if (p.is?.ozet) log(`${" ".repeat(16)}${p.is.ozet.replace(/\s+/g, " ").slice(0, 240)}`);
    }
    return;
  }
  if (cmd === "karne") {
    const v = await loadDevBrainView(paths.workRoot);
    log(`geliştirici beyni: ${v.hazirlik.ozet}`);
    log(`hafıza: ${v.gecmis} değişiklik · ${v.icgudu.toplam} içgüdü (${v.icgudu.dogrulanan} doğrulandı, ${v.icgudu.reddedilen} bırakıldı)`);
    if (v.kod) log(`kod deneyimi: ${v.kod.toplam} değişikliğin kodu (dosya, fonksiyon, eklenen kod, test) · ${v.kod.tarifli} tanesinin "nasıl yapıldı" tarifi${v.kod.sonTarif ? `\n  son tarif — ${v.kod.sonTarif.gorev.slice(0, 70)}: ${v.kod.sonTarif.nasil}` : ""}`);
    for (const n of v.notlar) log(`  ${n.tarih.slice(0, 16)} ${n.gorev.slice(0, 70)} — ${n.satir}`);
    for (const d of v.dersler) log(`  ders: ${d}`);
    return;
  }
  const id = arg("--id");
  if (cmd === "arastir") {
    const d = deps();
    if (id) {
      const p = proposals.find((x) => x.id === id);
      if (!p) throw new Error(`öneri yok: ${id}`);
      const g = await researchJob(p, d);
      log(`${g.karar === "var" ? "zaten var gibi" : `değişecek: ${g.dosyalar.join(", ")}`}\nplan: ${g.plan}`);
      return;
    }
    const done = await researchQueue(proposals, d);
    log(done.length ? done.join("\n") : "araştırılacak yeni iş yok");
    return;
  }
  if (cmd === "ogren") {
    const d = deps();
    const recipes = arg("--tarif");
    const r = await learnFromCommits(d, Number(arg("--sinav")) || EXAMS_PER_PASS, recipes !== undefined && Number.isFinite(Number(recipes)) ? Number(recipes) : RECIPES_PER_PASS);
    log(`${r.ozet}\n${readiness(await listGrades(paths.workRoot)).ozet}`);
    return;
  }
  if (cmd === "kod") {
    // What the brain knows of one change as code (a sha prefix or a job id), else of the newest five.
    const all = (await listCodeExperience(paths.workRoot)).sort((a, b) => Date.parse(b.tarih) - Date.parse(a.tarih));
    const want = arg("--id");
    const pick = want ? all.filter((x) => x.id.startsWith(want)) : all.slice(0, 5);
    if (!pick.length) return log(want ? `kod deneyimi yok: ${want}` : "henüz kod deneyimi yok");
    for (const x of pick) log([`${x.id.slice(0, 10)} ${x.tarih.slice(0, 16)} — ${x.gorev}`, ...codeExperienceLines(x, want ? { ornek: 1_200 } : {})].join("\n"));
    return;
  }
  if (cmd === "aksam") {
    // The evening (owner, 3 Nov 2026: from 16:30 Claude builds what gathered by day): one job after another while the
    // hours last, no order waits and the queue has work; each is researched first if the day missed it.
    const release = await developerLock(paths.workRoot);
    if (!release) return log("geliştirici başka bir işte");
    try {
      const d = deps();
      let made = 0;
      for (; made < EVENING_MAX_JOBS; made++) {
        const w = developerWindow(process.env);
        if (!w.acik) {
          log(`durdu: ${w.neden}`);
          break;
        }
        if ((await listOrders(paths.workRoot)).some((x) => x.order.durum === "bekliyor" || x.order.durum === "calisiyor")) {
          log("durdu: sipariş var");
          break;
        }
        const job = nextJob((await listProposals(paths.workRoot)).map((x) => x.proposal));
        if (!job) {
          log("kuyruk boş");
          break;
        }
        // Owner rule (5 Nov 2026: "pc sağlığına her zaman dikkat edilecek"): Claude's build and the studio's checks load
        // the processor and RAM, so a job starts only on a fit PC (PcHealth, as a production step); a nearly full disk
        // or RAM that stays short ends the evening, the job keeps its turn.
        try {
          log(`sağlık: ${healthLine(await waitForPcHealth(healthDirs(paths), log, { free: () => unloadOllama(log, "RAM az") }))}`);
        } catch (e) {
          log(`durdu: PC sağlığı — ${(e as Error).message.slice(0, 200)}`);
          break;
        }
        const done = await runDevJob(job, d);
        log(`${LABEL[done.durum] ?? done.durum}: ${done.baslik}`);
        if (waitingForLimit(done)) {
          // Every other job would meet the same limit: the evening waits for it (the order watcher calls again).
          log(`durdu: Claude kullanım sınırı, ${done.is!.bekle!.slice(0, 16)} sonrasına kadar`);
          await say(paths.workRoot, `Claude'un kullanım sınırı doldu; "${done.baslik.slice(0, 60)}" ve sıradakiler sınır açılınca (${new Date(done.is!.bekle!).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}) yapılacak, deneme hakları yanmadı.`, "AYAS");
          made++;
          break;
        }
      }
      if (made) await say(paths.workRoot, `Bu akşam ${made} iş Claude'dan geçti; ${readiness(await listGrades(paths.workRoot)).ozet}.`, "AYAS");
    } finally {
      await release();
    }
    return;
  }
  if (cmd === "calistir") {
    const job = id ? proposals.find((p) => p.id === id) : nextJob(proposals);
    if (!job) return log("kuyrukta iş yok");
    if (!["onaylandi", "yapilamadi"].includes(job.durum)) throw new Error(`öneri kuyrukta değil (${job.durum})`);
    const release = await developerLock(paths.workRoot);
    if (!release) throw new Error("geliştirici başka bir işte");
    try {
      const done = await runDevJob(job, deps());
      log(`${LABEL[done.durum] ?? done.durum}: ${done.baslik}`);
    } finally {
      await release();
    }
    return;
  }
  if (cmd === "uygula") {
    const p = proposals.find((x) => x.id === id);
    if (!p) throw new Error(`öneri yok: ${id}`);
    const r = await applyBuild(p, process.cwd());
    if (!r.ok) throw new Error(`uygulanamadı: ${r.neden}`);
    await updateProposal(paths.workRoot, p.id, (q) => ({ ...q, durum: "yapildi", is: { ...q.is!, bitis: new Date().toISOString() } }));
    log(`${r.neden}; öneri "yapıldı". Testleri çalıştırıp push et.`);
    return;
  }
  if (cmd === "kapat") {
    const not = arg("--not");
    if (!id || !not) throw new Error('Kullanım: gelistirici.ts kapat --id <öneri id> --not "…"');
    const p = await updateProposal(paths.workRoot, id, (q) => ({ ...q, durum: "yapildi", is: { deneme: q.is?.deneme ?? 0, baslangic: q.is?.baslangic ?? new Date().toISOString(), bitis: new Date().toISOString(), ozet: not.slice(0, 600) } }));
    log(`yapıldı: ${p.baslik}`);
    return;
  }
  throw new Error('Kullanım: gelistirici.ts liste | karne | arastir [--id <id>] | ogren [--sinav <n>] | aksam | calistir [--id <id>] | uygula --id <id> | kapat --id <id> --not "…"');
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
