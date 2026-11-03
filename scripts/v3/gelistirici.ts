/**
 * Atölye V3 development queue (DevQueue / Developer): the approved proposals and what the studio's developer did with
 * them. The idle loop builds one per cycle while `ATOLYE_V3_GELISTIRICI=1` (night hours by default); these commands
 * look at the queue, build one now, apply a kept build or close a proposal by hand.
 *
 *   npx tsx scripts/v3/gelistirici.ts liste
 *   npx tsx scripts/v3/gelistirici.ts calistir [--id <öneri id>]     (builds now, whatever the hours)
 *   npx tsx scripts/v3/gelistirici.ts uygula --id <öneri id>          (into this checkout's branch; push stays yours)
 *   npx tsx scripts/v3/gelistirici.ts kapat --id <öneri id> --not "…"  (already done elsewhere)
 */
import { applyBuild, develop, developerLock } from "../../src/lib/v3/council/Developer";
import { developerWindow, nextJob } from "../../src/lib/v3/council/DevQueue";
import { listProposals, updateProposal } from "../../src/lib/v3/council/SelfImprovement";
import { loadV3Settings, resolveV3Paths } from "../../src/lib/v3/V3Paths";

const log = (s: string) => console.log(s);
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const LABEL: Readonly<Record<string, string>> = { onaylandi: "kuyrukta", yapiliyor: "geliştiriliyor", hazir: "hazır", yapilamadi: "yapılamadı", yapildi: "yapıldı" };

async function main() {
  loadV3Settings();
  const paths = resolveV3Paths();
  const cmd = process.argv[2];
  const proposals = (await listProposals(paths.workRoot)).map((x) => x.proposal);
  if (cmd === "liste") {
    log(`geliştirici: ${developerWindow(process.env).neden}`);
    for (const p of proposals.filter((x) => x.durum in LABEL)) {
      log(`${LABEL[p.durum]!.padEnd(15)} ${p.id}  ${p.baslik}`);
      if (p.is?.dal) log(`${" ".repeat(16)}dal: ${p.is.dal} · ${p.is.dosyalar?.length ?? 0} dosya`);
      if (p.is?.sorunlar?.length) log(`${" ".repeat(16)}neden: ${p.is.sorunlar.join(" | ").slice(0, 240)}`);
      if (p.is?.ozet) log(`${" ".repeat(16)}${p.is.ozet.replace(/\s+/g, " ").slice(0, 240)}`);
    }
    return;
  }
  const id = arg("--id");
  if (cmd === "calistir") {
    const job = id ? proposals.find((p) => p.id === id) : nextJob(proposals);
    if (!job) return log("kuyrukta iş yok");
    if (!["onaylandi", "yapilamadi"].includes(job.durum)) throw new Error(`öneri kuyrukta değil (${job.durum})`);
    const release = await developerLock(paths.workRoot);
    if (!release) throw new Error("geliştirici başka bir işte");
    try {
      const done = await develop(job, { repoRoot: paths.repoRoot, workRoot: paths.workRoot, log });
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
  throw new Error('Kullanım: gelistirici.ts liste | calistir [--id <id>] | uygula --id <id> | kapat --id <id> --not "…"');
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
