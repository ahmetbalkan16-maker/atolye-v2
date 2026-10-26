/**
 * Atölye V3 — recorded sound effects from Kenney's CC0 packs (kenney.nl), taken from the soundcn collection pinned to
 * one commit (the Remotion skill's recommended source; only its Kenney folders are CC0 — its World of Warcraft folder
 * is Blizzard's and is never used). Each sound is decoded, made mono 48 kHz, peak-normalised to −1 dBFS and written
 * into Atölye's SFX library (`public/sfx/<category>/atolye-v3-<id>-kenney.wav`) with the library's `.license.json`
 * sidecar. The mixer prefers a recording over the synthesised sound of the same id (scripts/v3/sfx-uret.ts).
 *
 *   npx tsx scripts/v3/sfx-kenney.ts
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { SFX_CATEGORY } from "../../src/lib/v3/mix/Mixer";
import type { SfxId } from "../../src/lib/v3/episode/EpisodeTypes";
import { runChecked } from "../../src/lib/v3/util/Proc";
import { resolveV3Paths } from "../../src/lib/v3/V3Paths";

const SOUNDCN_COMMIT = "7cbfbb3f56e8548b81fb26410bdcea657447d087";
const RAW = `https://raw.githubusercontent.com/kapishdima/soundcn/${SOUNDCN_COMMIT}/assets`;

interface Recording {
  readonly id: SfxId;
  readonly pack: string;
  readonly file: string;
  readonly title: string;
}

/**
 * The comic stings were chosen by measuring their pitch direction (zero-crossing rate, first vs last third):
 * PIZZI02 rises (×1.87), PIZZI01 falls (×0.47).
 */
const RECORDINGS: readonly Recording[] = [
  // A clash, not a draw: drawKnife1 (until 26 Oct 2026) was a blade sliding out. impactMetal_light_000 is one sharp hit
  // with clear ringing partials, 39 dB down after 0.2 s (the plates wobble, the medium and heavy hits are duller).
  { id: "kilic", pack: "kenney_impact-sounds", file: "impactMetal_light_000.ogg", title: "kılıç çarpışması (metal vuruşu)" },
  { id: "cekic", pack: "kenney_impact-sounds", file: "impactMetal_heavy_000.ogg", title: "metale çekiç" },
  { id: "yumruk", pack: "kenney_impact-sounds", file: "impactPunch_heavy_000.ogg", title: "yumruk" },
  { id: "dusus", pack: "kenney_impact-sounds", file: "impactSoft_heavy_000.ogg", title: "yere düşüş" },
  { id: "adim", pack: "kenney_impact-sounds", file: "footstep_concrete_000.ogg", title: "ayak sesi" },
  { id: "kapi", pack: "kenney_rpg-audio", file: "doorOpen_1.ogg", title: "kapı açılışı" },
  { id: "para", pack: "kenney_rpg-audio", file: "handleCoins.ogg", title: "para şıngırtısı" },
  { id: "kagit", pack: "kenney_rpg-audio", file: "bookFlip1.ogg", title: "sayfa / parşömen" },
  { id: "basari", pack: "kenney_music-jingles/Pizzicato jingles", file: "jingles_PIZZI02.ogg", title: "komik başarı müziği (yükselen)" },
  { id: "hata", pack: "kenney_music-jingles/Pizzicato jingles", file: "jingles_PIZZI01.ogg", title: "komik başarısızlık müziği (düşen)" },
];

/** File name of a recorded effect; the mixer tries it before the synthesised one. */
export function recordedSfxFileName(id: string): string {
  return `atolye-v3-${id}-kenney.wav`;
}

async function main() {
  const paths = resolveV3Paths();
  const root = path.join(paths.repoRoot, "public", "sfx");
  // Downloads are untrusted data: a fresh directory of their own, only ever decoded by FFmpeg.
  const tmp = await fs.mkdtemp(path.join(paths.asciiTemp, "sfx-kenney-"));
  try {
    for (const r of RECORDINGS) {
      const url = `${RAW}/${r.pack.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(r.file)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${r.file}: HTTP ${res.status}`);
      const src = path.join(tmp, `${r.id}.ogg`);
      await fs.writeFile(src, Buffer.from(await res.arrayBuffer()));
      const raw = path.join(tmp, `${r.id}-raw.wav`);
      await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", src, "-ac", "1", "-ar", "48000", "-c:a", "pcm_f32le", raw]);
      const probe = await runChecked(paths.ffmpeg, ["-hide_banner", "-i", raw, "-af", "astats=measure_perchannel=none", "-f", "null", "-"]);
      const peak = Number(/Peak level dB: (-?[\d.]+)/.exec(probe.stderr)?.[1] ?? "0");
      const dir = path.join(root, SFX_CATEGORY[r.id]);
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, recordedSfxFileName(r.id));
      await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", raw, "-af", `volume=${(-1 - peak).toFixed(2)}dB`, "-c:a", "pcm_s16le", file]);
      const sha256 = createHash("sha256").update(await fs.readFile(file)).digest("hex");
      await fs.writeFile(
        `${file}.license.json`,
        `${JSON.stringify({ title: `Kenney — ${r.title} (${r.file})`, source: `Kenney (kenney.nl), ${r.pack.split("/")[0]}; soundcn ${SOUNDCN_COMMIT.slice(0, 12)}; mono 48 kHz, tepe −1 dBFS`, sourceUrl: url, license: "CC0", attribution: "", sha256, externalSamples: true }, null, 2)}\n`,
      );
      console.log(`${SFX_CATEGORY[r.id]}/${recordedSfxFileName(r.id)} (tepe ${peak.toFixed(1)} → −1 dB)`);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("sfx-kenney.ts")) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  });
}
