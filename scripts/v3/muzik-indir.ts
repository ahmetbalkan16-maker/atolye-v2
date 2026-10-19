/**
 * Atölye V3 — downloads the CC BY music listed in content/v3/muzik_kitapligi.json into ATOLYE_V3_MUSIC_ROOT, in
 * MusicLibrary's layout (`<mood>/<file>.mp3` + `.license.json` with the required credit). Resumable; every file is
 * checked against its pinned SHA-256 (the first download pins it in the index).
 *
 *   npx tsx scripts/v3/muzik-indir.ts
 */
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { runChecked } from "../../src/lib/v3/util/Proc";
import { resolveV3Paths } from "../../src/lib/v3/V3Paths";

interface Track {
  readonly ruh_hali: string;
  readonly baslik: string;
  sha256: string | null;
}

interface Index {
  readonly aciklama: string;
  readonly lisans: string;
  readonly atif_sablonu: string;
  readonly parcalar: Track[];
}

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const urlOf = (title: string) => `https://incompetech.com/music/royalty-free/mp3-royaltyfree/${encodeURIComponent(title)}.mp3`;

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

async function main() {
  const paths = resolveV3Paths();
  const indexFile = path.join(paths.contentRoot, "muzik_kitapligi.json");
  const index = JSON.parse(await fs.readFile(indexFile, "utf8")) as Index;
  let pinned = 0;
  for (const t of index.parcalar) {
    const dir = path.join(paths.musicRoot, t.ruh_hali);
    const file = path.join(dir, `macleod-${slug(t.baslik)}.mp3`);
    await fs.mkdir(dir, { recursive: true });
    if (!existsSync(file) || (t.sha256 && (await sha256(file)) !== t.sha256)) {
      const part = `${file}.part`;
      for (let attempt = 1; attempt <= 20; attempt++) {
        try {
          await runChecked("curl", ["-sS", "-L", "--fail", "-C", "-", "--connect-timeout", "20", "--speed-limit", "20000", "--speed-time", "25", "-o", part, urlOf(t.baslik)], { timeoutMs: 15 * 60_000 });
          break;
        } catch (e) {
          if (attempt === 20) throw e;
        }
      }
      await fs.rename(part, file);
    }
    const sum = await sha256(file);
    if (t.sha256 && t.sha256 !== sum) throw new Error(`MUSIC_SHA256_MISMATCH: ${t.baslik}`);
    if (!t.sha256) {
      t.sha256 = sum;
      pinned++;
    }
    await fs.writeFile(
      `${file}.license.json`,
      `${JSON.stringify({ title: t.baslik, source: "Kevin MacLeod (incompetech.com)", sourceUrl: urlOf(t.baslik), license: index.lisans, attribution: index.atif_sablonu.replace("{baslik}", t.baslik), priority: 20, sha256: sum, externalSamples: false }, null, 2)}\n`,
    );
    console.log(`${t.ruh_hali}/${path.basename(file)} ${(await fs.stat(file)).size >> 10} KB ${sum.slice(0, 12)}`);
  }
  if (pinned) await fs.writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`müzik: ${index.parcalar.length} parça, ${paths.musicRoot}${pinned ? ` (${pinned} sha256 sabitlendi)` : ""}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
