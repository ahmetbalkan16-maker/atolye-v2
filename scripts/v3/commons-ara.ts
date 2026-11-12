/**
 * Wikimedia Commons'ta lisansı uygun (PD/CC0/CC BY/CC BY-SA) yatay görsel arar. CC BY-SA bir dosya (çoğu hazır harita)
 * videoyu da BY-SA yapabilir: yalnız owner onayıyla, `.env.v3.local` içinde ATOLYE_V3_BYSA_IZIN=1 iken indirilir.
 * Wikimedia'ya giden User-Agent üretimdeki iletişim ayarını (ATOLYE_V3_WIKIMEDIA_CONTACT) aynı yoldan okur.
 *
 *   npx tsx scripts/v3/commons-ara.ts "Bosphorus map" "Rumelihisarı"
 *   npx tsx scripts/v3/commons-ara.ts --indir "File:Örnek.jpg" --hedef output/v3/x/public/bg/harita.jpg
 */
import path from "node:path";
import { commonsByTitle, downloadCommons, searchCommons } from "../../src/lib/v3/backgrounds/CommonsProvider";
import { judgeLicense, shareAlikeAllowed } from "../../src/lib/v3/backgrounds/LicenseFilter";
import { loadV3Settings, resolveV3Paths } from "../../src/lib/v3/V3Paths";

const shareAlike = (license: string) => {
  const v = judgeLicense(license);
  return v.ok && v.family === "CC-BY-SA";
};

async function main() {
  loadV3Settings();
  const paths = resolveV3Paths();
  const cache = path.join(paths.workRoot, "_onbellek", "commons");
  const args = process.argv.slice(2);
  const dl = args.indexOf("--indir");
  if (dl >= 0) {
    const title = args[dl + 1]!;
    const target = args[args.indexOf("--hedef") + 1]!;
    const found = await commonsByTitle(cache, title);
    if (!found) throw new Error(`Bulunamadı ya da lisansı uygun değil: ${title}`);
    if (shareAlike(found.credit.license) && !shareAlikeAllowed()) throw new Error(`${title}: CC BY-SA (${found.credit.license}) — owner onayı olmadan indirilmez (ATOLYE_V3_BYSA_IZIN=1)`);
    const credit = await downloadCommons(found, path.resolve(target));
    console.log(JSON.stringify(credit, null, 2));
    return;
  }
  for (const q of args) {
    const r = await searchCommons(cache, q, { minWidth: 1500 });
    console.log(`== ${q}: ${r.length} uygun`);
    for (const c of r.slice(0, 10)) console.log(`  ${c.width}x${c.height} | ${c.credit.license}${shareAlike(c.credit.license) && !shareAlikeAllowed() ? " (owner onayı gerekir)" : ""} | ${c.title} | ${c.credit.author.slice(0, 50)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
