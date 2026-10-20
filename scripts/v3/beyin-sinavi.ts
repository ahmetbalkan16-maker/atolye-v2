/**
 * Atölye V3 — the brains' exam: the shared vision judge answers questions whose right verdict is known
 * (`content/v3/beyin-sinavi.json`), one or more local models side by side. Run it after a model update or to choose
 * a new "eye"; the brains themselves can run it, no coding agent needed.
 *
 *   npx tsx scripts/v3/beyin-sinavi.ts hazirla                         # copies the exam pictures (outside git)
 *   npx tsx scripts/v3/beyin-sinavi.ts calistir [--modeller gemma4:12b,qwen3-vl:8b]
 *
 * Every call waits for a cool GPU (owner rule, 73 °C). The report goes to `<workRoot>/_kutuphane/sinav/sonuc-*.json`.
 */
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { resolveOllamaConfig } from "../../src/lib/ai/OllamaConfig";
import { OllamaProvider } from "../../src/lib/ai/providers/OllamaProvider";
import { pickBackground, verdictLine } from "../../src/lib/v3/backgrounds/BackgroundJudge";
import { type ExamManifest, gradeAnswer } from "../../src/lib/v3/council/BrainExam";
import { coolGpuProvider } from "../../src/lib/v3/util/Gpu";
import { resolveV3Paths } from "../../src/lib/v3/V3Paths";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const paths = resolveV3Paths();
  const manifest = JSON.parse(await fs.readFile(path.join(paths.contentRoot, "beyin-sinavi.json"), "utf8")) as ExamManifest;
  const dir = path.join(paths.workRoot, "_kutuphane", "sinav");
  await fs.mkdir(dir, { recursive: true });
  const cmd = process.argv[2];
  if (cmd === "hazirla") {
    for (const q of manifest.sorular) {
      const to = path.join(dir, q.gorsel);
      if (existsSync(to)) continue;
      const from = path.join(paths.workRoot, q.kaynak);
      if (!existsSync(from)) {
        console.log(`· ${q.id}: kaynak yok (${q.kaynak})`);
        continue;
      }
      await fs.copyFile(from, to);
      console.log(`✓ ${q.id}: ${q.gorsel} (${createHash("sha256").update(await fs.readFile(to)).digest("hex").slice(0, 12)})`);
    }
    return;
  }
  if (cmd !== "calistir") throw new Error("Kullanım: beyin-sinavi.ts hazirla | calistir [--modeller a,b]");
  const models = (arg("--modeller") ?? process.env.ATOLYE_V3_VISION_MODEL ?? "gemma4:12b").split(",").map((m) => m.trim()).filter(Boolean);
  const report: { model: string; dogru: number; toplam: number; sorular: { id: string; dogru: boolean; neden: string; cevap?: string }[] }[] = [];
  for (const model of models) {
    const judge = coolGpuProvider(new OllamaProvider(fetch, () => ({ ...resolveOllamaConfig(), model, timeoutMs: 300_000, numCtx: 8_192, format: "json" as const, think: false })), (s) => console.log(s));
    const rows: (typeof report)[number]["sorular"] = [];
    for (const q of manifest.sorular) {
      const file = path.join(dir, q.gorsel);
      if (!existsSync(file)) {
        rows.push({ id: q.id, dogru: false, neden: "görsel yok (önce: hazirla)" });
        continue;
      }
      const pick = await pickBackground([{ title: q.gorsel, file }], q.sahne, judge, async (c) => fs.readFile(c.file), (s) => console.log(s), { mode: q.mod, max: 1 });
      const v = pick.verdicts[0];
      const g = gradeAnswer(q, v);
      rows.push({ id: q.id, dogru: g.dogru, neden: g.neden, ...(v ? { cevap: verdictLine(v) } : {}) });
      console.log(`${g.dogru ? "✓" : "✗"} [${model}] ${q.id}: ${g.neden}${v ? ` — ${verdictLine(v)}` : ""}`);
    }
    report.push({ model, dogru: rows.filter((r) => r.dogru).length, toplam: rows.length, sorular: rows });
  }
  console.log("\nSONUÇ");
  for (const r of report) console.log(`  ${r.model}: ${r.dogru}/${r.toplam}`);
  const out = path.join(dir, `sonuc-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(out, `${JSON.stringify({ surum: manifest.surum, tarih: new Date().toISOString(), sonuclar: report }, null, 2)}\n`);
  console.log(`rapor: ${out}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
