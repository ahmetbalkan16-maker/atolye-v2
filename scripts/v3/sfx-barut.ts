/**
 * Atölye V3 — the gunpowder recordings of the SFX library (owner, 26 Oct 2026, after the sword bed: "top ve tüfek
 * seslerini de bul, kaydet; başka bir video yapıldığında otomatik onu kullansın"). Free sources only, each pinned by its
 * SHA-256 (a changed download stops the script):
 *
 * - rifles and sub-machine guns: "The Free Firearm Sound Library" (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew
 *   Nanney; CC0, 96 kHz field recordings) — the bolt-action rifles of the world wars (Springfield 1917, Arisaka, Mosin
 *   Nagant) cut into single shots → `battle/atolye-v3-tufek-ffsl-NN.wav`; PPSh and Carl Gustav m/45 bursts →
 *   `battle/atolye-v3-makineli-ffsl-NN.wav`;
 * - muskets: no free black-powder musket recording was found, so lever-action and 1917 shots are slowed to 0.78 and
 *   low-passed, the deeper and longer report of a black-powder gun → `battle/atolye-v3-misket-ffsl-NN.wav`;
 * - cannon: the U.S. Military Academy's salute cannon (Wikimedia Commons, public domain as a U.S. government work),
 *   and Thimras "Cannon fire" (CC0), each at four speeds (bigger and smaller guns) →
 *   `battle/atolye-v3-top_atisi-<source>-NN.wav`, which the mixer also plays for a single cannon shot (qubodup's naval
 *   gun was left out: a compressed game sound whose second half stays 6 dB under its peak, not one blow);
 * - shell bursts: NenadSimic "Muffled Distant Explosion" (CC0) at three speeds →
 *   `battle/atolye-v3-patlama-<source>-NN.wav` (Thimras "Cannon hit" was left out: a ship's deck bursting, 4.7 s of
 *   rumble that stays 8 dB under its peak).
 *
 * Every single shot must be one blow (SfxDesigner.impactProblems). Downloads are untrusted data: a fresh folder,
 * Windows' own tar, decoded only by FFmpeg.
 *
 *   npx tsx scripts/v3/sfx-barut.ts [--kaynak <önceden indirilmiş dosyaların klasörü>]
 */
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { splitHits } from "../../src/lib/v3/mix/BattleBed";
import { impactProblems } from "../../src/lib/v3/mix/SfxDesigner";
import { runChecked } from "../../src/lib/v3/util/Proc";
import { resolveV3Paths } from "../../src/lib/v3/V3Paths";
import { decode, fetchPinned, type Source, unpack, writeWithSidecar } from "./sfx-savas";

const OGA = "https://opengameart.org/sites/default/files";
const OGA_PAGE = "https://opengameart.org/content";
const RATE = 48_000;

const FFSL: Source = { file: "Prepared SFX Library.7z", url: `${OGA}/Prepared%20SFX%20Library.7z`, sha256: "cc1ab5a99a0a365105c7c5dd783f4b0b1fe90938114d3ceec53856bfe005f7d6", page: `${OGA_PAGE}/the-free-firearm-sound-library`, author: "The Free Firearm Sound Library — Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney" };
const USMA: Source = { file: "01_Salute_Cannon_Reveille.ogg", url: "https://upload.wikimedia.org/wikipedia/commons/2/2d/01_Salute_Cannon_Reveille.ogg", sha256: "8119fdd493439f442c5ad598a06833f0386446324e6e82b1fcf4519119bb7c6a", page: "https://commons.wikimedia.org/wiki/File:01_Salute_Cannon_Reveille.ogg", author: "United States Military Academy, The Hellcats", site: "Wikimedia Commons", license: "Public domain (PD-USGov)" };
const THIMRAS_FIRE: Source = { file: "cannon_fire_0.ogg", sha256: "2b21ffa41e5c3be4eecdfbd3490544f5aa8b6d1581787265863e13de1a8e599d", page: `${OGA_PAGE}/cannon-fire`, author: "Thimras" };
const NENAD: Source = { file: "NenadSimic - Muffled Distant Explosion.wav", url: `${OGA}/NenadSimic%20-%20Muffled%20Distant%20Explosion.wav`, sha256: "13a0bf75af94ec6d332bc71cba489b573466e05c4b17288158b3d683b41de39f", page: `${OGA_PAGE}/muffled-distant-explosion`, author: "NenadSimic" };

/** World-war bolt-action rifles, near and mid distance. */
const RIFLES = ["1917/B_24P.wav", "1917/B_16P.wav", "Arisaka/E_25P.wav", "Arisaka/E_18P.wav", "Mosin Nagant/M_21P.wav", "Mosin Nagant/M_26P.wav"];
/** Sub-machine-gun bursts, short and long, near and mid distance. */
const BURSTS = ["PPSh/P_32P.wav", "PPSh/P_18P.wav", "PPSh/P_34P.wav", "PPSh/P_22P.wav", "Carl Gustav M45/G_33P.wav", "Carl Gustav M45/G_22P.wav", "Carl Gustav M45/G_35P.wav", "Carl Gustav M45/G_24P.wav"];
/** Shots that become muskets (slowed and darkened). */
const MUSKETS = ["Model 1894/L_23P.wav", "Model 1894/L_17P.wav", "Marlin 336/I_22P.wav", "Marlin 336/I_17P.wav", "1917/B_24P.wav", "1917/B_16P.wav"];
const MUSKET_SPEED = 0.78;
const MUSKET_LOWPASS_HZ = 4500;
/** A cannon at its own speed, two bigger guns and a smaller one; a shell burst at two. */
const CANNON_SPEEDS = [1, 0.8, 0.9, 1.12];
const BLAST_SPEEDS = [1, 0.85, 1.15];
const LIMIT = { tufek: 12, makineli: 8, misket: 8 } as const;
const POOLS = ["tufek", "makineli", "misket", "top_atisi", "patlama"] as const;

/**
 * One take into the library: the piece of the source, faded at both ends, through `extra` (speed, low-pass), its peak
 * then brought to −1 dBFS like every library sound (measured after the filters).
 */
async function writeTake(ffmpeg: string, wav: string, from: number, to: number, extra: string, out: string): Promise<void> {
  const len = (to - from) / RATE;
  const chain = `atrim=start_sample=${from}:end_sample=${to},asetpts=N/SR/TB,afade=t=in:d=0.003,afade=t=out:st=${Math.max(0, len - 0.25).toFixed(3)}:d=0.25${extra ? `,${extra}` : ""}`;
  const probe = await runChecked(ffmpeg, ["-hide_banner", "-nostats", "-i", wav, "-af", `${chain},astats=measure_overall=Peak_level:measure_perchannel=none`, "-f", "null", "-"]);
  const peakDb = Number(/Peak level dB: (-?[\d.]+)/.exec(probe.stderr)?.[1] ?? "0");
  const gain = 10 ** ((-1 - peakDb) / 20);
  await runChecked(ffmpeg, ["-v", "error", "-y", "-i", wav, "-af", `${chain},volume=${gain.toFixed(4)}`, "-ac", "1", "-ar", String(RATE), "-c:a", "pcm_s16le", out]);
}

const speed = (s: number) => (s === 1 ? "" : `asetrate=${Math.round(RATE * s)},aresample=${RATE}`);

async function main() {
  const paths = resolveV3Paths();
  const battle = path.join(paths.repoRoot, "public", "sfx", "battle");
  await fs.mkdir(paths.asciiTemp, { recursive: true });
  const tmp = await fs.mkdtemp(path.join(paths.asciiTemp, "sfx-barut-"));
  // A rerun replaces this script's own takes (fewer takes must not leave old ones behind); nothing else is touched.
  const own = new RegExp(`^atolye-v3-(${POOLS.join("|")})-[a-z]+-\\d{2}\\.wav(\\.license\\.json)?$`);
  for (const n of existsSync(battle) ? await fs.readdir(battle) : []) if (own.test(n)) await fs.rm(path.join(battle, n));
  const made: Record<string, number> = {};
  const next = (pool: string, tag: string) => {
    const k = `${pool}-${tag}`;
    made[k] = (made[k] ?? 0) + 1;
    return path.join(battle, `atolye-v3-${pool}-${tag}-${String(made[k]).padStart(2, "0")}.wav`);
  };
  const count = (pool: string) => Object.entries(made).filter(([k]) => k.startsWith(`${pool}-`)).reduce((a, [, n]) => a + n, 0);
  try {
    const lib = path.join(tmp, "ffsl");
    await unpack(await fetchPinned(FFSL, tmp), lib);
    const root = path.join(lib, "Prepared SFX Library");

    // Rifles and muskets: single shots, each one blow, the echo kept (up to 2 s).
    for (const [pool, files, extra] of [["tufek", RIFLES, ""], ["misket", MUSKETS, `${speed(MUSKET_SPEED)},lowpass=f=${MUSKET_LOWPASS_HZ}`]] as const) {
      for (const name of files) {
        const { wav, samples } = await decode(paths.ffmpeg, path.join(root, name), tmp);
        // The library's sheet names each file's single shots or bursts; the quiet stray noises of a take are left out.
        const loudest = Math.max(...splitHits(samples, RATE, 2).map((h) => h.peakDb));
        const shots = splitHits(samples, RATE, 2).filter((h) => h.to - h.from > RATE * 0.4 && h.peakDb > loudest - 12);
        for (const h of shots.slice(0, 3)) {
          if (count(pool) >= LIMIT[pool]) break;
          const problems = impactProblems(samples.subarray(h.from, h.to), RATE);
          if (problems.length) {
            console.log(`atlandı ${name} @ ${(h.from / RATE).toFixed(2)} sn: ${problems.join("; ")}`);
            continue;
          }
          const out = next(pool, "ffsl");
          await writeTake(paths.ffmpeg, wav, h.from, h.to, extra, out);
          const weapon = path.dirname(name);
          await writeWithSidecar(out, pool === "tufek" ? `The Free Firearm Sound Library — ${weapon} tüfek atışı` : `The Free Firearm Sound Library — ${weapon} atışından misket (×${MUSKET_SPEED}, ${MUSKET_LOWPASS_HZ / 1000} kHz altı)`, FFSL, `${name} @ ${(h.from / RATE).toFixed(3)} s`);
        }
      }
    }

    // Bursts: a burst is one piece (no quiet inside it), with its echo (up to 3.5 s); the loudest of each file.
    for (const name of BURSTS) {
      const { wav, samples } = await decode(paths.ffmpeg, path.join(root, name), tmp);
      const bursts = splitHits(samples, RATE, 3.5).sort((a, b) => b.peakDb - a.peakDb);
      for (const h of bursts.slice(0, 1)) {
        if (count("makineli") >= LIMIT.makineli) break;
        const out = next("makineli", "ffsl");
        await writeTake(paths.ffmpeg, wav, h.from, h.to, "", out);
        await writeWithSidecar(out, `The Free Firearm Sound Library — ${path.dirname(name)} seri atış`, FFSL, `${name} @ ${(h.from / RATE).toFixed(3)} s`);
      }
    }

    // Cannon and shell bursts: the first blow of each recording (the salute cannon is followed by the band's drums).
    const cannons: readonly { src: Source; file: string; tag: string; pool: "top_atisi" | "patlama"; speeds: readonly number[]; endS?: number }[] = [
      { src: USMA, file: await fetchPinned(USMA, tmp), tag: "usma", pool: "top_atisi", speeds: CANNON_SPEEDS, endS: 2.85 },
      { src: THIMRAS_FIRE, file: await fetchPinned(THIMRAS_FIRE, tmp), tag: "thimras", pool: "top_atisi", speeds: CANNON_SPEEDS },
      { src: NENAD, file: await fetchPinned(NENAD, tmp), tag: "nenadsimic", pool: "patlama", speeds: BLAST_SPEEDS },
    ];
    for (const c of cannons) {
      const { wav, samples } = await decode(paths.ffmpeg, c.file, tmp);
      const first = splitHits(samples, RATE, 4)[0];
      if (!first) throw new Error(`${c.src.file}: vuruş bulunamadı`);
      const to = Math.min(first.to, c.endS ? Math.round(c.endS * RATE) : samples.length);
      const problems = c.pool === "top_atisi" ? impactProblems(samples.subarray(first.from, to), RATE) : [];
      if (problems.length) throw new Error(`${c.src.file}: tek atış değil — ${problems.join("; ")}`);
      for (const s of c.speeds) {
        const out = next(c.pool, c.tag);
        await writeTake(paths.ffmpeg, wav, first.from, to, speed(s), out);
        const what = c.pool === "top_atisi" ? "top atışı" : "uzak patlama";
        await writeWithSidecar(out, `${c.src.author} — ${what}${s === 1 ? "" : ` (×${s})`}`, c.src, `${path.basename(c.file)} @ ${(first.from / RATE).toFixed(3)} s`);
      }
    }
    for (const pool of POOLS) if (count(pool) < 3) throw new Error(`${pool}: yalnız ${count(pool)} kayıt çıktı`);
    console.log(POOLS.map((p) => `${p} ${count(p)}`).join(", "));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("sfx-barut.ts")) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  });
}
