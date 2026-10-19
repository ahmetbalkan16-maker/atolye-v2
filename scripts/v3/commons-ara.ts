/**
 * Wikimedia Commons'ta lisansı uygun (PD/CC0/CC BY/CC BY-SA) yatay görsel arar.
 *
 *   npx tsx scripts/v3/commons-ara.ts "Bosphorus map" "Rumelihisarı"
 *   npx tsx scripts/v3/commons-ara.ts --indir "File:Örnek.jpg" --hedef output/v3/x/public/bg/harita.jpg
 */
import path from "node:path";
import { commonsByTitle, downloadCommons, searchCommons } from "../../src/lib/v3/backgrounds/CommonsProvider";
import { resolveV3Paths } from "../../src/lib/v3/V3Paths";

async function main() {
  const paths = resolveV3Paths();
  const cache = path.join(paths.workRoot, "_onbellek", "commons");
  const args = process.argv.slice(2);
  const dl = args.indexOf("--indir");
  if (dl >= 0) {
    const title = args[dl + 1]!;
    const target = args[args.indexOf("--hedef") + 1]!;
    const found = await commonsByTitle(cache, title);
    if (!found) throw new Error(`Bulunamadı ya da lisansı uygun değil: ${title}`);
    const credit = await downloadCommons(found, path.resolve(target));
    console.log(JSON.stringify(credit, null, 2));
    return;
  }
  for (const q of args) {
    const r = await searchCommons(cache, q, { minWidth: 1500 });
    console.log(`== ${q}: ${r.length} uygun`);
    for (const c of r.slice(0, 10)) console.log(`  ${c.width}x${c.height} | ${c.credit.license} | ${c.title} | ${c.credit.author.slice(0, 50)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
