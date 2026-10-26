/**
 * Atölye V3 — the battle recordings of the SFX library (owner, 26 Oct 2026: "kılıç sesi gibi değil çekiç sesi gibi;
 * toplu savaşta toplu kılıç sesleri, bağrışmalar olmalı arka planda"). All CC0 from OpenGameArt, each archive pinned by
 * its SHA-256 (a changed download stops the script):
 *
 * - swords: StillNorthMedia "Medieval sound effects - Weapon impacts" (weapon on weapon, 192 kHz takes of 9–30 hits);
 *   the blade-on-blade sword takes are cut into single hits (BattleBed.splitHits) and only hits that are one blow
 *   (SfxDesigner.impactProblems) are kept → `battle/atolye-v3-kilic-snm-NN.wav`, played in turn by the mixer;
 * - men's cries: qubodup "15 vocal male strain/hurt/pain/jump sounds" → `battle/atolye-v3-nara-qubodup-NN.wav`;
 * - the distant roar: StarNinjas "Crowd Shouting/Speaking Ambience", low-passed so no word can be made out →
 *   `crowd/atolye-v3-savas-ugultu-starninjas.wav`.
 *
 * Archives are untrusted data: downloaded into a fresh folder, unpacked by Windows' own tar (libarchive reads 7z), only
 * ever decoded by FFmpeg.
 *
 *   npx tsx scripts/v3/sfx-savas.ts [--kaynak <önceden indirilmiş arşivlerin klasörü>]
 */
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { splitHits } from "../../src/lib/v3/mix/BattleBed";
import { impactProblems } from "../../src/lib/v3/mix/SfxDesigner";
import { runChecked } from "../../src/lib/v3/util/Proc";
import { resolveV3Paths } from "../../src/lib/v3/V3Paths";

const OGA = "https://opengameart.org/sites/default/files";
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

export interface Source {
  readonly file: string;
  readonly sha256: string;
  readonly page: string;
  readonly author: string;
  /** Where the file is downloaded from when not OpenGameArt's files folder. */
  readonly url?: string;
  /** The site named in the sidecar (OpenGameArt by default). */
  readonly site?: string;
  /** CC0 by default; a U.S. government work is "Public domain". */
  readonly license?: string;
}

const SWORDS: readonly Source[] = [
  { file: "medieval_sfx_weapon_on_weapon_1_of_2.7z", sha256: "27a854442ecfc51102dc023bb3ff462fe1bc6b895b39b2f63a54cccf1e8e6ea9", page: "https://opengameart.org/content/medieval-sound-effects-weapon-impacts", author: "StillNorthMedia" },
  { file: "medieval_sfx_weapon_on_weapon_2_of_2.7z", sha256: "cdc209e2edd4511085d1b7a9c764b26f4c1a754cd1a8e53b5274d11898b8f4c9", page: "https://opengameart.org/content/medieval-sound-effects-weapon-impacts", author: "StillNorthMedia" },
];
const CRIES: Source = { file: "slightscreams.7z", sha256: "3220b234efed17305bef05fe82c5d2e2b38302ae02b0d188021af9b045499a1e", page: "https://opengameart.org/content/15-vocal-male-strainhurtpainjump-sounds", author: "qubodup" };
const ROAR: Source = { file: "crowd_shouting_0.ogg", sha256: "a2c23a64c127c77717cbe4abb21f138bac9d9aa6cb3cc89d62bab5d0d96dd7ca", page: "https://opengameart.org/content/crowd-shoutingspeaking-ambience", author: "StarNinjas" };

/** Blade-on-blade takes with a sword in them; hafts, hilts and maces sound of wood or a dull hit. */
const isSwordTake = (name: string) => / Blade on Blade\.wav$/.test(name) && /Norse Sword|Sabre|Katana/.test(name);
/** Hits kept per take (spread over it) and in all. */
const PER_TAKE = 3;
const MAX_HITS = 16;
const RATE = 48_000;

export async function fetchPinned(src: Source, dir: string): Promise<string> {
  // `--kaynak <dir>`: archives downloaded before (a browser, curl) are taken from there; the pin checks them alike.
  const local = arg("--kaynak") ? path.join(arg("--kaynak")!, src.file) : undefined;
  let buf: Buffer;
  if (local && existsSync(local)) buf = await fs.readFile(local);
  else {
    // Streamed to disk by curl (Node's fetch held an 80 MB archive in memory and stalled for 15 minutes).
    const part = path.join(dir, `${src.file}.part`);
    await runChecked("curl", ["-s", "-f", "-L", "--max-time", "1800", "-A", "Mozilla/5.0 (Atolye V3 sound library)", "-o", part, src.url ?? `${OGA}/${src.file}`], { timeoutMs: 31 * 60_000 });
    buf = await fs.readFile(part);
    await fs.rm(part, { force: true });
  }
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha !== src.sha256) throw new Error(`${src.file}: SHA-256 değişmiş (${sha}); kaynak gözden geçirilmeden kullanılmaz`);
  const out = path.join(dir, src.file);
  await fs.writeFile(out, buf);
  return out;
}

export async function unpack(archive: string, dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  await runChecked(tar, ["-xf", archive, "-C", dir], { timeoutMs: 10 * 60_000 });
}

export async function decode(ffmpeg: string, file: string, tmp: string): Promise<{ wav: string; samples: Float32Array }> {
  const wav = path.join(tmp, `${createHash("sha256").update(file).digest("hex").slice(0, 12)}.wav`);
  const raw = `${wav}.f32`;
  await runChecked(ffmpeg, ["-v", "error", "-y", "-i", file, "-ac", "1", "-ar", String(RATE), "-c:a", "pcm_f32le", wav]);
  await runChecked(ffmpeg, ["-v", "error", "-y", "-i", wav, "-f", "f32le", raw]);
  const buf = await fs.readFile(raw);
  await fs.rm(raw, { force: true });
  return { wav, samples: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2) };
}

function peakOf(samples: Float32Array, from = 0, to = samples.length): number {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(samples[i]!));
  return p;
}

export async function writeWithSidecar(out: string, title: string, src: Source, origin: string): Promise<void> {
  const sha256 = createHash("sha256").update(await fs.readFile(out)).digest("hex");
  await fs.writeFile(`${out}.license.json`, `${JSON.stringify({ title, source: `${src.author} (${src.site ?? "OpenGameArt"}), ${origin}; mono 48 kHz`, sourceUrl: src.page, license: src.license ?? "CC0", attribution: "", sha256, externalSamples: true }, null, 2)}\n`);
  console.log(path.relative(process.cwd(), out));
}

async function main() {
  const paths = resolveV3Paths();
  const sfx = path.join(paths.repoRoot, "public", "sfx");
  await fs.mkdir(paths.asciiTemp, { recursive: true });
  const tmp = await fs.mkdtemp(path.join(paths.asciiTemp, "sfx-savas-"));
  try {
    // Swords: single hits out of the blade-on-blade takes.
    const takes = path.join(tmp, "kilic");
    for (const s of SWORDS) await unpack(await fetchPinned(s, tmp), takes);
    const names = (await fs.readdir(takes, { recursive: true })).map(String).filter((n) => isSwordTake(path.basename(n))).sort();
    if (!names.length) throw new Error("kılıç kayıtları bulunamadı");
    let made = 0;
    for (const name of names) {
      if (made >= MAX_HITS) break;
      const { wav, samples } = await decode(paths.ffmpeg, path.join(takes, name), tmp);
      const hits = splitHits(samples, RATE).filter((h) => h.to - h.from > RATE * 0.25 && !impactProblems(samples.subarray(h.from, h.to), RATE).length);
      const loudest = Math.max(...hits.map((h) => h.peakDb));
      const good = hits.filter((h) => h.peakDb > loudest - 12);
      const picks = good.length <= PER_TAKE ? good : [0, 1, 2].map((k) => good[Math.round((k * (good.length - 1)) / (PER_TAKE - 1))]!);
      for (const h of picks) {
        if (made >= MAX_HITS) break;
        made++;
        const out = path.join(sfx, "battle", `atolye-v3-kilic-snm-${String(made).padStart(2, "0")}.wav`);
        const gain = 0.89 / Math.max(1e-6, peakOf(samples, h.from, h.to));
        const len = (h.to - h.from) / RATE;
        await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", wav, "-af", `atrim=start_sample=${h.from}:end_sample=${h.to},asetpts=N/SR/TB,afade=t=in:d=0.003,afade=t=out:st=${Math.max(0, len - 0.04).toFixed(3)}:d=0.04,volume=${gain.toFixed(4)}`, "-ac", "1", "-ar", String(RATE), "-c:a", "pcm_s16le", out]);
        await writeWithSidecar(out, `StillNorthMedia — kılıç çarpışması (${path.basename(name, ".wav")}, ${(h.from / RATE).toFixed(2)} sn)`, SWORDS[0]!, `${path.basename(name)} @ ${(h.from / RATE).toFixed(3)} s`);
      }
    }
    if (made < 8) throw new Error(`yalnız ${made} kılıç vuruşu çıktı`);

    // Men's cries and efforts.
    const cries = path.join(tmp, "nara");
    await unpack(await fetchPinned(CRIES, tmp), cries);
    const flacs = (await fs.readdir(cries, { recursive: true })).map(String).filter((n) => n.endsWith(".flac")).sort();
    for (const [i, name] of flacs.entries()) {
      const out = path.join(sfx, "battle", `atolye-v3-nara-qubodup-${String(i + 1).padStart(2, "0")}.wav`);
      // Quiet head and tail off, then the peak to −1 dBFS like every library sound.
      const edge = "silenceremove=start_periods=1:start_threshold=-45dB";
      const { wav, samples } = await decode(paths.ffmpeg, path.join(cries, name), tmp);
      const gain = 0.89 / Math.max(1e-6, peakOf(samples));
      await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", wav, "-af", `${edge},areverse,${edge},afade=t=in:d=0.03,areverse,volume=${gain.toFixed(4)}`, "-ac", "1", "-ar", String(RATE), "-c:a", "pcm_s16le", out]);
      await writeWithSidecar(out, `qubodup — erkek zorlanma/acı sesi (${path.basename(name)})`, CRIES, path.basename(name));
    }

    // The distant roar: under 2.2 kHz no word survives; a steady level for looping.
    const roar = await fetchPinned(ROAR, tmp);
    const out = path.join(sfx, "crowd", "atolye-v3-savas-ugultu-starninjas.wav");
    await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", roar, "-af", "highpass=f=120,lowpass=f=2200,lowpass=f=2200,loudnorm=I=-20:TP=-3:LRA=7", "-ac", "1", "-ar", String(RATE), "-c:a", "pcm_s16le", out]);
    await writeWithSidecar(out, "StarNinjas — uzak kalabalık uğultusu (crowd_shouting_0.ogg, 2,2 kHz altı)", ROAR, "crowd_shouting_0.ogg");
    if (!existsSync(out)) throw new Error("uğultu yazılamadı");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("sfx-savas.ts")) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  });
}
