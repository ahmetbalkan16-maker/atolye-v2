/**
 * The brains' case library (DevBrain.DevCase; owner, 13 Nov 2026, CLAUDE.md's standing order: every fix reaches the
 * brains as a whole case). A commit's `Vaka` block is recorded by the idle cycle ("ogren"); this records a fix that has
 * no commit — a patched episode, a stopped and resumed order — and lets a person look the library up. No model, free.
 *
 *   npx tsx scripts/v3/vaka.ts ekle --konu "<topic>" --belirti "<what was seen, where>" --neden "<root cause>"
 *        --cozum "<how it was solved: files, functions, data>" --kanit "<how it was proven>"
 *        --yakala "<how to catch it next time>" --beyin kurgu,kalite [--bolum <video id>] [--dosya a.json,b.ts]
 *   npx tsx scripts/v3/vaka.ts liste [--n 20]
 *   npx tsx scripts/v3/vaka.ts ara "<problem text>" [--n 5]
 */
import { LESSON_BRAINS } from "../../src/lib/v3/council/CommitLessons";
import { caseLine, listCases, recordCase, similarCases } from "../../src/lib/v3/council/DevBrain";
import { loadV3Settings, resolveV3Paths } from "../../src/lib/v3/V3Paths";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  loadV3Settings();
  const { workRoot } = resolveV3Paths();
  const cmd = process.argv[2];
  const n = Math.max(1, Number(arg("--n")) || (cmd === "liste" ? 20 : 5));
  if (cmd === "ekle") {
    const konu = arg("--konu")?.trim();
    const belirti = arg("--belirti")?.trim();
    if (!konu || !belirti) throw new Error("--konu ve --belirti gerekli");
    const missing = ["--neden", "--cozum", "--kanit", "--yakala"].filter((a) => !arg(a)?.trim());
    const beyinler = (arg("--beyin") ?? "").split(/[\s,]+/).filter(Boolean);
    const unknown = beyinler.filter((b) => !(LESSON_BRAINS as readonly string[]).includes(b));
    if (unknown.length) throw new Error(`bilinmeyen beyin: ${unknown.join(", ")} (olanlar: ${LESSON_BRAINS.join(", ")})`);
    const now = new Date();
    const c = await recordCase(workRoot, {
      id: `el-${now.toISOString().replace(/[-:.]/g, "").slice(0, 15)}-${Math.random().toString(36).slice(2, 6)}`,
      tarih: now.toISOString(),
      kaynak: "el",
      konu,
      belirti,
      ...(arg("--neden") ? { neden: arg("--neden")! } : {}),
      ...(arg("--cozum") ? { cozum: arg("--cozum")! } : {}),
      ...(arg("--kanit") ? { kanit: arg("--kanit")! } : {}),
      ...(arg("--yakala") ? { yakala: arg("--yakala")! } : {}),
      ...(arg("--bolum") ? { bolum: arg("--bolum")! } : {}),
      ...(arg("--dosya") ? { dosyalar: arg("--dosya")!.split(",").map((f) => f.trim().replace(/\\/g, "/")).filter(Boolean) } : {}),
      beyinler: beyinler.length ? [...new Set(beyinler)] : ["gelistirici"],
    });
    console.log(`vaka yazıldı: ${c.id}`);
    console.log(caseLine(c, 2_000));
    if (missing.length) console.log(`uyarı: ${missing.join(", ")} boş — bütün vaka beyinlere daha çok şey öğretir`);
    return;
  }
  if (cmd === "liste") {
    const all = await listCases(workRoot);
    console.log(`vaka kitaplığı: ${all.length} vaka (${all.filter((c) => c.kaynak === "turetilmis").length} türetilmiş)`);
    for (const c of all.slice(-n).reverse()) console.log(caseLine(c, 400));
    return;
  }
  if (cmd === "ara") {
    const text = process.argv.slice(3).filter((a, i, all) => a !== "--n" && all[i - 1] !== "--n").join(" ").trim();
    if (!text) throw new Error("aranacak metin gerekli");
    const found = await similarCases(workRoot, text, n);
    if (!found.length) console.log("benzer vaka yok");
    for (const c of found) console.log(`${c.benzerlik.toFixed(2)} ${caseLine(c, 1_200)}`);
    return;
  }
  throw new Error('Kullanım: vaka.ts ekle --konu … --belirti … --neden … --cozum … --kanit … --yakala … --beyin kurgu,kalite [--bolum <video>] [--dosya a,b] | liste [--n 20] | ara "<metin>" [--n 5]');
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
