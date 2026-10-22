/**
 * Atölye V3 — the episode sound effects, synthesised locally with FFmpeg (no recordings, no downloads), written
 * into Atölye's existing SFX library (`public/sfx/<category>/`) with the library's `.license.json` sidecar.
 * Our own synthesis → CC0. Deterministic: re-running rewrites identical sounds.
 *
 *   npx tsx scripts/v3/sfx-uret.ts
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runChecked } from "../../src/lib/v3/util/Proc";
import { resolveV3Paths } from "../../src/lib/v3/V3Paths";

interface Effect {
  readonly id: string;
  readonly category: "transition" | "battle" | "crowd" | "interior" | "nature";
  readonly title: string;
  /** lavfi source (no commas inside expressions: they would split the filter graph). */
  readonly source: string;
  readonly filter?: string;
}

const SR = 48000;
const EFFECTS: readonly Effect[] = [
  { id: "whoosh", category: "transition", title: "geçiş hışırtısı", source: `anoisesrc=d=0.5:c=pink:a=0.9:r=${SR}:s=1`, filter: "highpass=f=400,lowpass=f=5000,afade=t=in:curve=qsin:d=0.22,afade=t=out:curve=qsin:st=0.22:d=0.28" },
  { id: "pop", category: "transition", title: "komik pop", source: `aevalsrc=exp(-40*t)*sin(2*PI*(500+2500*exp(-35*t))*t):s=${SR}:d=0.14` },
  { id: "boing", category: "transition", title: "komik boing", source: `aevalsrc=exp(-4*t)*sin(2*PI*(180+70*sin(2*PI*11*t)*exp(-2.5*t))*t):s=${SR}:d=0.8` },
  { id: "kilic", category: "battle", title: "kılıç şakırtısı", source: `aevalsrc=exp(-5*t)*(0.45*sin(2*PI*1870*t)+0.3*sin(2*PI*2933*t)+0.22*sin(2*PI*4210*t)+0.15*sin(2*PI*5617*t))+exp(-70*t)*(random(0)*2-1)*0.5:s=${SR}:d=0.9`, filter: "highpass=f=300,aecho=0.6:0.4:35:0.25" },
  { id: "top_atisi", category: "battle", title: "top atışı", source: `aevalsrc=exp(-2.4*t)*0.8*sin(2*PI*(48+30*exp(-4*t))*t)+exp(-5*t)*(random(0)*2-1)*0.8:s=${SR}:d=2`, filter: "lowpass=f=1000,aecho=0.7:0.5:120|260:0.35|0.2" },
  { id: "davul", category: "battle", title: "savaş davulu vuruşu", source: `aevalsrc=exp(-9*t)*sin(2*PI*(55+70*exp(-12*t))*t)+exp(-45*t)*(random(0)*2-1)*0.25:s=${SR}:d=0.6`, filter: "lowpass=f=2500" },
  { id: "kalabalik", category: "crowd", title: "kalabalık uğultusu", source: `anoisesrc=d=3:c=pink:a=0.7:r=${SR}:s=2`, filter: "bandpass=f=650:width_type=o:w=2.2,tremolo=f=3.1:d=0.35,tremolo=f=1.3:d=0.3,afade=t=in:d=0.6,afade=t=out:st=2.3:d=0.7" },
  { id: "cekic", category: "interior", title: "örs üzerinde çekiç", source: `aevalsrc=exp(-16*t)*(0.5*sin(2*PI*820*t)+0.35*sin(2*PI*1637*t)+0.25*sin(2*PI*2471*t))+exp(-140*t)*(random(0)*2-1)*0.7:s=${SR}:d=0.4` },
  { id: "zil", category: "interior", title: "çan / zil", source: `aevalsrc=exp(-1.4*t)*0.4*sin(2*PI*523.25*t)+exp(-2*t)*0.3*sin(2*PI*1046.5*t)+exp(-3*t)*0.2*sin(2*PI*1396*t)+exp(-4.5*t)*0.15*sin(2*PI*2093*t):s=${SR}:d=2.6` },
  { id: "dalga", category: "nature", title: "kıyıya vuran dalga", source: `anoisesrc=d=5:c=brown:a=0.9:r=${SR}:s=3`, filter: "lowpass=f=1100,tremolo=f=0.25:d=0.8,afade=t=in:d=1.2,afade=t=out:st=3.6:d=1.4" },
  // Wading through shallow water: a slosh every ~0.55 s (sin⁶ envelope, written as a product — pow() needs a comma).
  { id: "su", category: "nature", title: "sığ suda yürüme, şıpırtı", source: `aevalsrc=(random(0)*2-1)*sin(PI*1.8*t)*sin(PI*1.8*t)*sin(PI*1.8*t)*sin(PI*1.8*t)*sin(PI*1.8*t)*sin(PI*1.8*t)*(0.7+0.3*sin(2*PI*31*t)):s=${SR}:d=2.2`, filter: "bandpass=f=1100:width_type=o:w=2.4,lowpass=f=4000,afade=t=in:d=0.05,afade=t=out:st=1.8:d=0.4" },
];

/** File name the V3 mixer looks up by effect id. */
export function sfxFileName(id: string): string {
  return `atolye-v3-${id}-01.wav`;
}

async function main() {
  const paths = resolveV3Paths();
  const root = path.join(paths.repoRoot, "public", "sfx");
  const tmp = path.join(paths.asciiTemp, "sfx");
  await fs.mkdir(tmp, { recursive: true });
  for (const e of EFFECTS) {
    const raw = path.join(tmp, `${e.id}-raw.wav`);
    // Float intermediate: summed partials can exceed full scale and a 16-bit file would clip them.
    await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", e.source, ...(e.filter ? ["-af", e.filter] : []), "-ac", "1", "-ar", String(SR), "-c:a", "pcm_f32le", raw]);
    // Peak-normalise to −1 dBFS (two passes: measure, then apply the exact gain).
    // astats, not volumedetect: volumedetect measures in 16 bit and cannot see peaks above 0 dBFS.
    const probe = await runChecked(paths.ffmpeg, ["-hide_banner", "-i", raw, "-af", "astats=measure_perchannel=none", "-f", "null", "-"]);
    const peak = Number(/Peak level dB: (-?[\d.]+)/.exec(probe.stderr)?.[1] ?? "0");
    const dir = path.join(root, e.category);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, sfxFileName(e.id));
    await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", raw, "-af", `volume=${(-1 - peak).toFixed(2)}dB`, "-c:a", "pcm_s16le", file]);
    const sha256 = createHash("sha256").update(await fs.readFile(file)).digest("hex");
    await fs.writeFile(
      `${file}.license.json`,
      `${JSON.stringify({ title: `Atölye V3 sentez efekti — ${e.title}`, source: "Atölye V3; FFmpeg ile yerelde sentezlendi (scripts/v3/sfx-uret.ts), kayıt veya dış örnek yok", sourceUrl: "https://creativecommons.org/publicdomain/zero/1.0/", license: "CC0", attribution: "", sha256, externalSamples: false }, null, 2)}\n`,
    );
    console.log(`${e.category}/${sfxFileName(e.id)} (tepe ${peak.toFixed(1)} → −1 dB)`);
  }
  await fs.rm(tmp, { recursive: true, force: true });
}

if (process.argv[1]?.endsWith("sfx-uret.ts")) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  });
}
