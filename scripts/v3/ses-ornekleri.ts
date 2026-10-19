/**
 * Atölye V3 — owner'a dinletilecek ses örnekleri (ses seçimi için).
 *
 *   npx tsx scripts/v3/ses-ornekleri.ts
 *
 * Owner'ın kaydından iki referans klip keser; anlatıcı + 5 karakteri ikişer Türkçe satırla, owner sesiyle İngilizce
 * anlatıcıyı ve Chatterbox'ın hazır sesini (TR + EN) üretir. Owner sesinden türedikleri için çıktılar repo dışında:
 * <ATOLYE_V3_VOICE_REFS>/ornekler/ — tek tek MP3, hepsi-art-arda.mp3 ve ORNEKLER.md. Satırlar yalnız deneme
 * cümleleridir, tarihî iddia taşımaz.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { V3Emotion } from "../../src/lib/v3/render/RenderPlanTypes";
import { prepareOwnerReferences, type TtsLanguage, TtsService } from "../../src/lib/v3/tts/Tts";
import { freeGpuMemory } from "../../src/lib/v3/util/Gpu";
import { runChecked } from "../../src/lib/v3/util/Proc";
import { resolveV3Paths } from "../../src/lib/v3/V3Paths";

interface Sample {
  readonly voice: string;
  readonly label: string;
  readonly language: TtsLanguage;
  readonly emotion: V3Emotion;
  readonly text: string;
}

const SAMPLES: readonly Sample[] = [
  { voice: "anlatici", label: "Anlatıcı (senin sesin)", language: "tr", emotion: "notr", text: "1452 baharı. Genç bir padişah Boğaz'ın haritasına bakıyor... ve gülümsüyor." },
  { voice: "anlatici", label: "Anlatıcı (senin sesin)", language: "tr", emotion: "saskin", text: "Peki bir kaleyi birkaç ayda bitirmek mümkün mü? Hadi birlikte bakalım." },
  { voice: "mehmed", label: "II. Mehmed", language: "tr", emotion: "kararli", text: "Boğazı keseceğiz, paşalar. Bu iş yaz bitmeden bitecek!" },
  { voice: "mehmed", label: "II. Mehmed", language: "tr", emotion: "mutlu", text: "Haritayı getirin. Hayır, öbür haritayı!" },
  { voice: "halil", label: "Çandarlı Halil Paşa", language: "tr", emotion: "korkmus", text: "Sultanım, acele işe şeytan karışır derler." },
  { voice: "halil", label: "Çandarlı Halil Paşa", language: "tr", emotion: "uzgun", text: "Bizans buna çok kızacak... Ben şimdiden üşüdüm." },
  { voice: "zaganos", label: "Zağanos Paşa", language: "tr", emotion: "kararli", text: "Emret sultanım, askerler hazır!" },
  { voice: "zaganos", label: "Zağanos Paşa", language: "tr", emotion: "mutlu", text: "Taşları ben taşırım, gerekirse dağı da!" },
  { voice: "urban", label: "Usta Urban", language: "tr", emotion: "sinsi", text: "Size öyle bir top dökerim ki... ama önce ücreti konuşalım." },
  { voice: "urban", label: "Usta Urban", language: "tr", emotion: "mutlu", text: "Bronz mu? Elbette bronz. Ben acemi miyim?" },
  { voice: "konstantinos", label: "XI. Konstantinos", language: "tr", emotion: "saskin", text: "Bir kale mi? Benim surlarımın dibine mi?" },
  { voice: "konstantinos", label: "XI. Konstantinos", language: "tr", emotion: "kizgin", text: "Elçileri hemen gönderin. Kibarca... ama çok da kibarca değil." },
  { voice: "hazir_ses", label: "Chatterbox hazır ses (karşılaştırma)", language: "tr", emotion: "notr", text: "1452 baharı. Genç bir padişah Boğaz'ın haritasına bakıyor... ve gülümsüyor." },
  { voice: "anlatici", label: "Anlatıcı, İngilizce (senin sesin)", language: "en", emotion: "notr", text: "Spring, 1452. A young sultan looks at a map of the Bosphorus... and smiles." },
  { voice: "anlatici", label: "Anlatıcı, İngilizce (senin sesin)", language: "en", emotion: "saskin", text: "So, can you really build a fortress in just a few months? Let's find out." },
  { voice: "hazir_ses", label: "Chatterbox hazır ses, İngilizce", language: "en", emotion: "notr", text: "Spring, 1452. A young sultan looks at a map of the Bosphorus... and smiles." },
  { voice: "hazir_ses", label: "Chatterbox hazır ses, İngilizce", language: "en", emotion: "saskin", text: "So, can you really build a fortress in just a few months? Let's find out." },
];

async function main() {
  const paths = resolveV3Paths();
  const log = (s: string) => console.log(s);
  const outDir = path.join(paths.voiceRefRoot, "ornekler");
  await fs.mkdir(outDir, { recursive: true });

  const refs = await prepareOwnerReferences(paths, path.join(paths.voiceRefRoot, "owner-source.mp3"));
  log(`referans klipler: ${refs.map((r) => path.basename(r)).join(", ")}`);
  // Chatterbox needs ~4 GB of VRAM.
  await freeGpuMemory(5_000, log);

  const tts = await TtsService.load(paths, log);
  const rows: string[] = [];
  const mp3s: string[] = [];
  const t0 = Date.now();
  try {
    for (const [i, s] of SAMPLES.entries()) {
      const started = Date.now();
      const r = await tts.synthesize({ text: s.text, voiceId: s.voice, emotion: s.emotion, language: s.language });
      const v = tts.voice(s.voice);
      const name = `${String(i + 1).padStart(2, "0")}-${s.voice}-${s.language}.mp3`;
      await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", r.file, "-ac", "1", "-b:a", "160k", path.join(outDir, name)]);
      mp3s.push(path.join(outDir, name));
      const took = (Date.now() - started) / 1000;
      log(`${name}: ${r.duration.toFixed(1)} sn ses, ${took.toFixed(1)} sn sürdü${r.cached ? " (önbellek)" : ""}`);
      rows.push(`| ${i + 1} | \`${name}\` | ${s.label} | ${s.language} | ${s.emotion} | ${v.perde >= 0 ? "+" : ""}${v.perde} / ${v.hiz} / ${v.exaggeration} | ${r.duration.toFixed(1)} sn | ${s.text} |`);
    }
  } finally {
    await tts.close();
  }

  // One file to listen to everything in order, 0.8 s apart.
  const inputs = mp3s.flatMap((f) => ["-i", f]);
  const chain = mp3s.map((_, i) => `[${i}:a]aresample=48000,apad=pad_dur=0.8[a${i}]`).join(";");
  const concat = `${mp3s.map((_, i) => `[a${i}]`).join("")}concat=n=${mp3s.length}:v=0:a=1[out]`;
  await runChecked(paths.ffmpeg, ["-v", "error", "-y", ...inputs, "-filter_complex", `${chain};${concat}`, "-map", "[out]", "-ac", "1", "-b:a", "160k", path.join(outDir, "hepsi-art-arda.mp3")]);

  await fs.writeFile(
    path.join(outDir, "ORNEKLER.md"),
    `# V3 ses örnekleri — ${new Date().toLocaleString("tr-TR")}

Chatterbox Multilingual 0.1.7 (MIT; çıktıda Resemble'ın duyulmayan Perth filigranı var). Karakter sesleri senin kaydından
klonlanıp perde (yarım ton), hız ve duygu yoğunluğu (exaggeration) ile ayrıştırıldı. Hepsini art arda: \`hepsi-art-arda.mp3\`.

| # | Dosya | Ses | Dil | Duygu | Perde / hız / yoğunluk | Süre | Metin |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

Değerlendirirken: (1) karakterler birbirinden ayırt ediliyor mu, (2) Türkçe telaffuz doğal mı, (3) İngilizcede aksan
rahatsız ediyor mu, (4) senin sesin mi yoksa hazır ses mi anlatıcı olsun.
`,
  );
  log(`örnekler: ${outDir} (${SAMPLES.length} satır, ${Math.round((Date.now() - t0) / 1000)} sn)`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
