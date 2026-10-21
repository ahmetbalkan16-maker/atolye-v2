/**
 * V3 harita önizleme: bir bölümün haritalı sahnesini seslendirmeden, üretimin kendi harita yoluyla (tarihî sınırlar,
 * kabartma zemin, yönetmen planı, Remotion) resim ya da sessiz hareketli klip olarak çizer. Senaryo yazarı, kalite
 * beyni ya da AYAS bir harita anlatımını videodan önce görmek için kullanır; Claude/Codex gerekmez.
 *
 *   npx tsx scripts/v3/harita-onizleme.ts --bolum <episode.json> [--sahne <sahne id>] [--kare <saniye>,…] [--video]
 *        [--dil en|tr] [--onizleme] [--cikti <klasör>]
 *
 * Satır süreleri kelime sayısından (dakikada ~155 kelime) tahmin edilir. Varsayılan: her satırın sonuna yakın birer
 * kare (o satırla gelen her şey ekranda). Örnek: content/v3/ornekler/harita-nigbolu-1396.json.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { crowdCast, toRenderCast } from "../../src/lib/v3/costumes/CastMapper";
import { loadAccessories } from "../../src/lib/v3/costumes/CostumePackLoader";
import { costumeRootsFor } from "../../src/lib/v3/costumes/PartDesigner";
import { buildRenderPlan } from "../../src/lib/v3/director/Director";
import type { Episode } from "../../src/lib/v3/episode/EpisodeTypes";
import { assertEpisode } from "../../src/lib/v3/episode/EpisodeValidator";
import { loadSnapshot } from "../../src/lib/v3/maps/HistoricalBorders";
import { loadMapData, mapWorld, type Polygon } from "../../src/lib/v3/maps/MapBuilder";
import { reliefFor } from "../../src/lib/v3/maps/Relief";
import { PREVIEW_SCALE, renderWithRemotion } from "../../src/lib/v3/render/RemotionRunner";
import { buildTimeline, DEFAULT_TIMELINE, type LineAudio } from "../../src/lib/v3/timeline/Timeline";
import { splitDirections } from "../../src/lib/v3/tts/StageDirections";
import { loadV3Settings, resolveV3Paths } from "../../src/lib/v3/V3Paths";

const FPS = 30;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** A line's spoken length without a voice: ~155 words a minute, at least 2.5 s. */
function estimatedSeconds(text: string): number {
  const words = splitDirections(text).speech.split(/\s+/).filter(Boolean).length;
  return Math.max(2.5, Math.round((words / 2.6) * 10) / 10);
}

async function main() {
  const file = arg("--bolum");
  if (!file) throw new Error("Kullanım: npx tsx scripts/v3/harita-onizleme.ts --bolum <episode.json> [--sahne <id>] [--kare 3,12.5] [--video]");
  loadV3Settings();
  const paths = resolveV3Paths();
  const full = assertEpisode(JSON.parse(await fs.readFile(file, "utf8")));
  const want = arg("--sahne");
  const scene = full.sahneler.find((s) => (want ? s.id === want : s.harita?.merkez && s.harita.genislik_km));
  if (!scene?.harita?.merkez || !scene.harita.genislik_km) throw new Error(want ? `${want}: haritalı sahne değil` : "bölümde haritalı sahne yok");
  const episode: Episode = { ...full, sahneler: [scene] };
  const out = path.resolve(arg("--cikti") ?? path.join(paths.workRoot, "harita-onizleme", `${full.id}-${scene.id}`));
  const pub = path.join(out, "public");
  await fs.mkdir(pub, { recursive: true });

  const years = [...new Set((scene.harita.bolgeler ?? []).flatMap((b) => (b.tarihi ? [b.tarihi.yil] : [])))];
  const bordersDir = path.join(paths.mapsDir, "historical");
  const historical = new Map<number, Map<string, Polygon[]>>();
  for (const y of years) historical.set(y, await loadSnapshot(bordersDir, y));
  const base = await loadMapData(paths.mapsDir);
  const relief = await reliefFor(paths, mapWorld(scene.harita, 1920, 1080), pub, (s) => console.log(s));
  const audio = scene.satirlar.map((l): LineAudio => ({ file: "sessiz.wav", duration: estimatedSeconds(l.metin), visemes: [{ t: 0, v: "X" }], words: [], lipSync: "rms" }));
  const timeline = buildTimeline(episode, [audio], { ...DEFAULT_TIMELINE, introS: 0 });
  const cast = [...toRenderCast(episode.oyuncu_kadrosu, "kukla"), ...crowdCast(episode, "kukla")];
  const plan = buildRenderPlan({
    ...(relief ? { reliefs: new Map([[scene.id, relief]]) } : {}),
    mapData: { ...base, ...(historical.size ? { historical } : {}) },
    episode,
    timeline,
    cast,
    accessories: await loadAccessories(costumeRootsFor(paths), cast),
    // The map draws over the whole frame; the background is never seen (the relief, or the flat map).
    backgrounds: [{ src: relief ?? "bos.png", kind: "archival" }],
    inserts: [undefined],
    language: arg("--dil") === "tr" ? "tr" : "en",
    fps: FPS,
    width: 1920,
    height: 1080,
    showCaptions: false,
    endCard: false,
  });
  const planFile = path.join(out, "plan.json");
  await fs.writeFile(planFile, JSON.stringify({ plan }));
  const scale = process.argv.includes("--onizleme") ? { scale: PREVIEW_SCALE } : {};
  if (process.argv.includes("--video")) {
    const mp4 = path.join(out, `${scene.id}.mp4`);
    let last = "";
    await renderWithRemotion(paths, { planFile, publicDir: pub, out: mp4, kind: "video", muted: true, ...scale, onLine: (l) => {
      const m = /Rendered (\d+)\/(\d+)/.exec(l);
      if (m && m[1] !== last && Number(m[1]) % 150 === 0) console.log(`  render ${m[1]}/${m[2]}`);
      if (m) last = m[1]!;
    } });
    console.log(`video (${(plan.durationInFrames / FPS).toFixed(1)} sn, sessiz): ${mp4}`);
  }
  const asked = arg("--kare")?.split(",").map(Number).filter((s) => Number.isFinite(s));
  const frames = asked?.length ? asked.map((s) => Math.round(s * FPS)) : process.argv.includes("--video") ? [] : timeline.lines.map((l) => Math.round((l.end - 0.3) * FPS));
  for (const fr of frames) {
    const png = path.join(out, `${scene.id}-${String(fr).padStart(5, "0")}.png`);
    await renderWithRemotion(paths, { planFile, publicDir: pub, out: png, kind: "still", frame: Math.min(plan.durationInFrames - 1, Math.max(0, fr)), ...scale });
    console.log(`kare ${(fr / FPS).toFixed(1)} sn: ${png}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
