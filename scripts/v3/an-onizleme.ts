/**
 * V3 an önizleme: dönem görseli bulunamayan bir anın resmini üretimin kendi yoluyla çizer (yerel SDXL, iki tohum) ve
 * görüntü hakemine "an" kipinde sordurur — videodan önce tasarlanmış görselin nasıl çıktığını görmek için. Claude/Codex
 * gerekmez; GPU kuralı (A2000_GPU_HARD_STOP_C) her adımda geçerli. Çizimler kütüphaneye eklenir (_kutuphane/anlar),
 * hiçbir eski çizimin üstüne yazılmaz.
 *
 *   npx tsx scripts/v3/an-onizleme.ts --an "<anın İngilizce tarifi>" --donem "1453" [--konu "…"] [--anlatim "…"]
 *        [--cikti <klasör>]
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveOllamaConfig } from "../../src/lib/ai/OllamaConfig";
import { OllamaProvider } from "../../src/lib/ai/providers/OllamaProvider";
import { BackgroundDesigner, momentDesign } from "../../src/lib/v3/backgrounds/BackgroundDesigner";
import { passes, pickBackground, verdictLine } from "../../src/lib/v3/backgrounds/BackgroundJudge";
import { coolGpuProvider } from "../../src/lib/v3/util/Gpu";
import { runChecked } from "../../src/lib/v3/util/Proc";
import { loadV3Settings, resolveV3Paths } from "../../src/lib/v3/V3Paths";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const an = arg("--an");
  const donem = arg("--donem");
  if (!an || !donem) throw new Error('Kullanım: npx tsx scripts/v3/an-onizleme.ts --an "<tarif>" --donem "1453" [--konu "…"] [--anlatim "…"] [--cikti <klasör>]');
  loadV3Settings();
  const paths = resolveV3Paths();
  const out = path.resolve(arg("--cikti") ?? path.join(paths.workRoot, "an-onizleme"));
  await fs.mkdir(out, { recursive: true });
  const log = (s: string) => console.log(s);
  const design = momentDesign(an, { donem });
  const painter = new BackgroundDesigner(paths, log, "anlar");
  const drawn = [];
  try {
    for (const seed of [5000, 12919]) drawn.push(await painter.draw(design, seed, { an: "onizleme" }));
  } finally {
    await painter.close();
  }
  const judge = coolGpuProvider(new OllamaProvider(fetch, () => ({ ...resolveOllamaConfig(), model: process.env.ATOLYE_V3_VISION_MODEL ?? "gemma4:12b", timeoutMs: 180_000, numCtx: 8_192, format: "json" as const, think: false })), log);
  const preview = async (file: string) => {
    const jpg = path.join(paths.asciiTemp, `an-onizleme-${path.basename(file, ".png")}.jpg`);
    await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", file, "-vf", "scale=960:-2", "-q:v", "4", jpg]);
    try {
      return await fs.readFile(jpg);
    } finally {
      await fs.rm(jpg, { force: true });
    }
  };
  const scene = { konu: arg("--konu") ?? an, donem, mekan: arg("--konu") ?? an, tr: an, en: an, tasarim: an, anlatim: arg("--anlatim") ?? an };
  const pick = await pickBackground(drawn.map((d) => ({ title: path.basename(d.file), d })), scene, judge, (c) => preview(c.d.file), log, { mode: "an" });
  for (const [i, d] of drawn.entries()) {
    const copy = path.join(out, `an-${i + 1}${pick.chosen?.d === d ? "-secilen" : ""}.png`);
    await fs.copyFile(d.file, copy);
    const v = pick.verdicts[i];
    console.log(`${v && passes(v) ? "✓" : "·"} ${copy}${v ? ` — ${verdictLine(v)}` : ""}`);
  }
  if (!pick.chosen) console.log("Hiçbir çizim hakemden geçmedi: üretimde bu an gösterilmez.");
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
