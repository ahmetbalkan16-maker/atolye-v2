/**
 * AYAS internet research and shared knowledge (owner, 5 Nov 2026).
 *
 *   npx tsx scripts/ayas-web-research.ts ara "free open source text to video model"   search + learn the hits
 *   npx tsx scripts/ayas-web-research.ts ogren <url> [--istek "..."] [--v3]           study one link (web, GitHub, YouTube)
 *   npx tsx scripts/ayas-web-research.ts hatirla --beyin ses "Turkish TTS"            what a brain recalls for a task
 *   npx tsx scripts/ayas-web-research.ts liste                                         the store by stage, cost, proof
 *   npx tsx scripts/ayas-web-research.ts eksikler                                      Atölye's gaps vs the knowledge
 *   npx tsx scripts/ayas-web-research.ts ekle --dosya bulgular.json                    curated, multi-source findings
 *
 * Every request goes through AyasSafePublicFetch; nothing fetched is run, installed or obeyed; no paid service, no
 * key. Writes only `data/brain/knowledge/records.json` (and, with --v3 on a YouTube link, one V3 study request).
 */
import { promises as fs } from "node:fs";
import { compareWithAtolye } from "../src/lib/ayas/research/AtolyeCapabilityMap";
import {
  applicationGate, ATOLYE_STAGES, type AtolyeStage, canonicalUrl, contentHash, COST_CLASSES, type CostClass, KNOWLEDGE_BRAINS, type KnowledgeBrain,
  knowledgeBlock, knowledgeId, type KnowledgeRecord, loadKnowledge, looksLikeInjection, recallKnowledge, saveKnowledge, STAGE_BRAINS,
} from "../src/lib/ayas/research/AyasSharedKnowledge";
import { hitRecords, searchWeb, studyLink } from "../src/lib/ayas/research/AyasWebResearch";

const repoRoot = process.cwd();
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const positional = (): string => process.argv.slice(3).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && all[i - 1]!.startsWith("--"))).join(" ").trim();

/** A curated finding: one fact with every independent source that states it. */
interface CuratedFinding {
  readonly url: string; readonly baslik: string; readonly ozet: string; readonly alintilar: readonly string[];
  readonly kaynaklar: readonly string[]; readonly maliyet: { readonly sinif: CostClass; readonly kanit: readonly string[] };
  readonly lisans?: { readonly spdx?: string; readonly kanit: string }; readonly asamalar: readonly AtolyeStage[];
  readonly yayinci?: string; readonly yayinTarihi?: string; readonly etiketler?: readonly string[]; readonly firsatlar?: readonly string[];
  readonly resmi?: boolean; readonly istek?: string;
}

function curated(f: CuratedFinding, now: Date): KnowledgeRecord {
  if (!f.url || !f.baslik || !f.ozet) throw new Error(`eksik alan: ${f.url ?? "?"}`);
  if (!COST_CLASSES.includes(f.maliyet?.sinif)) throw new Error(`${f.url}: maliyet.sinif ${COST_CLASSES.join("|")} olmalı`);
  if (!f.asamalar?.length || f.asamalar.some((s) => !ATOLYE_STAGES.includes(s))) throw new Error(`${f.url}: asamalar ${ATOLYE_STAGES.join("|")}`);
  const kaynaklar = [...new Set([canonicalUrl(f.url), ...(f.kaynaklar ?? []).map(canonicalUrl)])];
  const text = [f.baslik, f.ozet, ...f.alintilar].join("\n");
  const base = {
    schemaVersion: 1 as const, id: knowledgeId(f.url), url: canonicalUrl(f.url), baslik: f.baslik, tur: (/github\.com/.test(f.url) ? "github" : /huggingface\.co/.test(f.url) ? "model" : /arxiv\.org/.test(f.url) ? "arxiv" : "web") as KnowledgeRecord["tur"],
    ...(f.yayinci ? { yayinci: f.yayinci } : {}), ...(f.yayinTarihi ? { yayinTarihi: f.yayinTarihi } : {}), erisimTarihi: now.toISOString(),
    ...(f.lisans ? { lisans: f.lisans } : {}), maliyet: { sinif: f.maliyet.sinif, kanit: [...f.maliyet.kanit] }, alintilar: [...f.alintilar], ozet: f.ozet,
    kavramlar: [...f.asamalar], dogrulama: { durum: f.resmi ? "RESMI_KAYNAK" as const : kaynaklar.length > 1 ? "COK_KAYNAK" as const : "TEK_KAYNAK" as const, kaynaklar },
    asamalar: [...f.asamalar], beyinler: [...new Set(f.asamalar.flatMap((s) => STAGE_BRAINS[s]))], firsatlar: [...(f.firsatlar ?? [])],
    tekrarKontrol: new Date(now.getTime() + 30 * 86_400_000).toISOString(), etiketler: [...new Set(["derleme", ...(f.etiketler ?? [])])],
    icerikHash: contentHash(text), enjeksiyonSuphesi: looksLikeInjection(text), otomatikUygulanabilir: false as const, ...(f.istek ? { istek: f.istek } : {}),
  };
  return { ...base, uygulamaEngeli: applicationGate(base) };
}

function show(r: KnowledgeRecord): void {
  console.log(`- ${r.baslik} [${r.tur}] ${r.url}`);
  console.log(`  ${r.ozet.slice(0, 260)}`);
  console.log(`  maliyet ${r.maliyet.sinif}${r.lisans ? `, lisans ${r.lisans.spdx ?? r.lisans.kanit}` : ", lisans ?"}; ${r.dogrulama.durum} (${r.dogrulama.kaynaklar.length} kaynak); aşamalar ${r.asamalar.join(",") || "—"}; beyinler ${r.beyinler.join(",") || "—"}${r.enjeksiyonSuphesi ? "; ⚠ TALİMAT BENZERİ METİN" : ""}`);
  console.log(`  uygulama: ${r.uygulamaEngeli}`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const now = new Date();

  if (command === "ara") {
    const q = positional();
    const report = await searchWeb(q);
    for (const p of report.saglayicilar) console.log(`${p.ok ? "✓" : "✗"} ${p.id}: ${p.ok ? `${p.sayi} sonuç` : p.hata}`);
    const records = hitRecords(report, now);
    const saved = await saveKnowledge(repoRoot, records);
    for (const r of records) show(r);
    console.log(`\n${records.length} sonuç ortak bilgiye işlendi (${saved.outcomes.filter((o) => o.sonuc === "YENI").length} yeni, toplam ${saved.total}). Bunlar arama sağlayıcısının kendi özetleridir; bir aracı kullanmadan önce kendi sayfası "ogren" ile okunmalı.`);
    return;
  }

  if (command === "ogren") {
    const url = positional();
    const result = await studyLink(url, { now, ...(arg("--istek") ? { istek: arg("--istek")! } : {}) });
    const saved = await saveKnowledge(repoRoot, [result.record]);
    show(result.record);
    console.log(`  not: ${result.not} — ${saved.outcomes[0]!.sonuc}`);
    if (result.tur === "youtube" && process.argv.includes("--v3")) {
      const { loadV3Settings, resolveV3Paths } = await import("../src/lib/v3/V3Paths");
      const { placeStudyRequest } = await import("../src/lib/v3/council/ReferenceStore");
      loadV3Settings();
      const req = await placeStudyRequest(resolveV3Paths().workRoot, url, "ayas-web-research");
      console.log(`  V3 inceleme isteği bırakıldı: ${req.id} (boşta döngüsü altyazı, kare ve tempoyu inceler)`);
    }
    return;
  }

  if (command === "hatirla") {
    const beyin = arg("--beyin") as KnowledgeBrain | undefined;
    if (beyin && !KNOWLEDGE_BRAINS.includes(beyin)) throw new Error(`--beyin ${KNOWLEDGE_BRAINS.join("|")}`);
    const recalled = recallKnowledge(await loadKnowledge(repoRoot), { ...(beyin ? { beyin } : {}), soru: positional(), limit: Number(arg("--limit") ?? 5) });
    console.log(recalled.length ? knowledgeBlock(recalled) : "Bu soru için kayıtlı bilgi yok.");
    return;
  }

  if (command === "liste") {
    const records = await loadKnowledge(repoRoot);
    const count = (key: (r: KnowledgeRecord) => readonly string[]) => Object.entries(records.flatMap(key).reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {})).map(([k, n]) => `${k} ${n}`).join(", ");
    console.log(`${records.length} kayıt`);
    console.log(`aşama: ${count((r) => r.asamalar)}`);
    console.log(`maliyet: ${count((r) => [r.maliyet.sinif])}`);
    console.log(`doğrulama: ${count((r) => [r.dogrulama.durum])}`);
    console.log(`yeniden kontrolü geçmiş: ${records.filter((r) => Date.parse(r.tekrarKontrol) < now.getTime()).length}`);
    return;
  }

  if (command === "eksikler") {
    for (const g of compareWithAtolye(await loadKnowledge(repoRoot))) {
      console.log(`\n[${g.asama}] ${g.eksik} — ölçüt: ${g.olcut}`);
      for (const a of g.adaylar) console.log(`  • ${a.baslik} (${a.maliyet}, ${a.dogrulama}) ${a.url}`);
      console.log(`  → ${g.deney}`);
      if (g.uyarlama) console.log(`  ⚖ uyarlama yolu: ${g.uyarlama.yol} — ${g.uyarlama.neden}`);
    }
    return;
  }

  if (command === "ekle") {
    const file = arg("--dosya");
    if (!file) throw new Error("--dosya <bulgular.json> gerekli");
    const findings = JSON.parse(await fs.readFile(file, "utf8")) as { readonly bulgular: readonly CuratedFinding[] };
    const records = findings.bulgular.map((f) => curated(f, now));
    const saved = await saveKnowledge(repoRoot, records);
    for (const r of records) show(r);
    console.log(`\n${records.length} derlenmiş bulgu: ${saved.outcomes.map((o) => o.sonuc).join(", ")} (toplam ${saved.total})`);
    return;
  }
  throw new Error("komut: ara | ogren | hatirla | liste | eksikler | ekle");
}

main().catch((e) => { console.error((e as Error).message); process.exitCode = 1; });
