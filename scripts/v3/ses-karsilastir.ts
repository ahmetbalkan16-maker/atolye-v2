/**
 * Atölye V3 — owner'ın dinleyip seçmesi için iki ses motoru yan yana: bir bölümün kendi satırları, kendi ses
 * atamalarıyla, önce bugünkü motorla (İngilizcede Kokoro), sonra VoxCPM2 ile.
 *
 *   npx tsx scripts/v3/ses-karsilastir.ts [--bolum output/v3/bolumler/rubicon-en-4] [--satir 2]
 *
 * Çıktı: `<workRoot>/karsilastirma/<bölüm>-<tarih>/` — çiftler (`NN-<ses>-A-mevcut.mp3`, `…-B-voxcpm.mp3`),
 * `hepsi.mp3` (A, kısa ara, B, …) ve KARSILASTIRMA.md. Owner VoxCPM'i seçerse: `.env.v3.local`'a
 * `ATOLYE_V3_TTS_EN=voxcpm` (Türkçe için `ATOLYE_V3_TTS_TR=voxcpm`).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Episode } from "../../src/lib/v3/episode/EpisodeTypes";
import { type TtsLanguage, TtsService } from "../../src/lib/v3/tts/Tts";
import { runChecked } from "../../src/lib/v3/util/Proc";
import { resolveV3Paths } from "../../src/lib/v3/V3Paths";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const paths = resolveV3Paths();
  const dir = path.resolve(arg("--bolum") ?? "output/v3/bolumler/rubicon-en-4");
  const perVoice = Number(arg("--satir") ?? 2);
  const episode = JSON.parse(await fs.readFile(path.join(dir, "episode.json"), "utf8")) as Episode;
  const voices = (JSON.parse(await fs.readFile(path.join(dir, "ses.json"), "utf8")) as { sesler: Record<string, string> }).sesler;
  const language: TtsLanguage = /^en-/.test(Object.values(voices)[0] ?? "") ? "en" : "tr";
  const out = path.join(paths.workRoot, "karsilastirma", `${path.basename(dir)}-${new Date().toISOString().slice(0, 10)}`);
  await fs.mkdir(out, { recursive: true });
  const picked: { karakter: string; metin: string; duygu: Episode["sahneler"][number]["satirlar"][number]["duygu"] }[] = [];
  const count = new Map<string, number>();
  for (const s of episode.sahneler) for (const l of s.satirlar) {
    if ((count.get(l.karakter) ?? 0) >= perVoice || !voices[l.karakter]) continue;
    count.set(l.karakter, (count.get(l.karakter) ?? 0) + 1);
    picked.push({ karakter: l.karakter, metin: l.metin, duygu: l.duygu });
  }
  const tts = await TtsService.load(paths, (s) => console.log(s));
  const rows: string[] = [];
  const sequence: string[] = [];
  try {
    for (const [i, p] of picked.entries()) {
      const voiceId = voices[p.karakter]!;
      const current = tts.voice(voiceId).saglayici;
      const n = String(i + 1).padStart(2, "0");
      const files: string[] = [];
      for (const [tag, provider] of [["A-mevcut", current], ["B-voxcpm", "voxcpm"]] as const) {
        const r = await tts.synthesize({ text: p.metin, voiceId, emotion: p.duygu, language, provider });
        const mp3 = path.join(out, `${n}-${p.karakter}-${tag}.mp3`);
        await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", r.file, "-codec:a", "libmp3lame", "-q:a", "3", mp3]);
        files.push(mp3);
      }
      sequence.push(...files);
      rows.push(`| ${n} | ${p.karakter} (${voiceId}) | ${p.duygu} | ${p.metin.replace(/\|/g, "/")} | ${path.basename(files[0]!)} | ${path.basename(files[1]!)} |`);
      console.log(`${n} ${p.karakter}: hazır`);
    }
  } finally {
    await tts.close();
  }
  // All pairs in one file: A, a short pause, B, a longer pause.
  const gap = path.join(out, "_ara.mp3");
  await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "0.8", "-codec:a", "libmp3lame", "-q:a", "3", gap]);
  const list = path.join(out, "_liste.txt");
  await fs.writeFile(list, sequence.flatMap((f) => [`file '${f.replace(/'/g, "'\\''")}'`, `file '${gap}'`]).join("\n"));
  await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-codec:a", "libmp3lame", "-q:a", "3", path.join(out, "hepsi.mp3")]);
  await fs.rm(list, { force: true });
  await fs.rm(gap, { force: true });
  await fs.writeFile(
    path.join(out, "KARSILASTIRMA.md"),
    `# Ses karşılaştırması — ${episode.baslik}\n\nA = bugünkü motor, B = VoxCPM2 (karakter başına tutarlı tını, satır başına duygu). \`hepsi.mp3\` her satırı önce A sonra B çalar.\n\n| # | Karakter (ses) | Duygu | Satır | A | B |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n\nVoxCPM seçilirse: \`.env.v3.local\` → \`ATOLYE_V3_TTS_EN=voxcpm\`.\n`,
  );
  console.log(`\n${picked.length} satır → ${out}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
