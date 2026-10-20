/**
 * Atölye V3 — the brains' experience memory (`<workRoot>/_kutuphane/deneyim/<beyin>.jsonl`).
 *
 *   npx tsx scripts/v3/beyin-hafiza.ts yukle                      # owner rules (content/v3/owner-kurallari.json) → memory
 *   npx tsx scripts/v3/beyin-hafiza.ts listele [--beyin kurgu] [--tur kural]
 *
 * Every production runs "yukle" by itself at its start; this command is for checking what the brains will read.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { BRAIN_NAMES, type BrainId } from "../../src/lib/v3/council/Council";
import { type Lesson, memoryDir, type OwnerRule, recall, seedRules } from "../../src/lib/v3/council/ExperienceMemory";
import { resolveV3Paths } from "../../src/lib/v3/V3Paths";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const paths = resolveV3Paths();
  const cmd = process.argv[2];
  if (cmd === "yukle") {
    const file = path.join(paths.contentRoot, "owner-kurallari.json");
    const { kurallar } = JSON.parse(await fs.readFile(file, "utf8")) as { kurallar: OwnerRule[] };
    const added = await seedRules(paths.workRoot, kurallar);
    console.log(`${kurallar.length} owner kuralından ${added} tanesi yeni yazıldı → ${memoryDir(paths.workRoot)}`);
    return;
  }
  if (cmd === "listele") {
    const only = arg("--beyin") as BrainId | undefined;
    const tur = arg("--tur") as Lesson["tur"] | undefined;
    for (const beyin of (only ? [only] : Object.keys(BRAIN_NAMES)) as BrainId[]) {
      const lessons = await recall(paths.workRoot, beyin, { ...(tur ? { tur } : {}), limit: 50 });
      if (!lessons.length) continue;
      console.log(`\n${BRAIN_NAMES[beyin]} (${lessons.length})`);
      for (const l of lessons) console.log(`  [${l.tur}] ${l.konu.slice(0, 40)} — ${l.metin}`);
    }
    return;
  }
  console.log("kullanım: beyin-hafiza.ts yukle | listele [--beyin <id>] [--tur kural|ders|ilac|onlem]");
  process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
