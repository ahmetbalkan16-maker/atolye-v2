/**
 * V3 karakter vitrini: Fatih kadrosunun bütün duygu, jest, yürüme ve efektlerini gösteren ~15 sn'lik plan.
 *
 *   npx tsx scripts/v3/karakter-vitrini.ts [--stil kukla|cop] [--kare 45,200] [--video] [--onizleme]
 *
 * Kareler/video `output/v3/vitrin-<stil>/` altına yazılır. Arka planlar mevcut SDXL önbelleğinden kopyalanır.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { toRenderCast } from "../../src/lib/v3/costumes/CastMapper";
import { costumesRoot, loadAccessories } from "../../src/lib/v3/costumes/CostumePackLoader";
import type { CastEntry } from "../../src/lib/v3/episode/EpisodeTypes";
import type { V3CaptionPage, V3CharacterStyle, V3Performer, V3RenderPlan, V3Shot, V3Viseme } from "../../src/lib/v3/render/RenderPlanTypes";
import { renderWithRemotion } from "../../src/lib/v3/render/RemotionRunner";
import { resolveV3Paths } from "../../src/lib/v3/V3Paths";

const FPS = 30;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** Synthetic mouth track for the showcase (real episodes use Rhubarb). */
function fakeVisemes(start: number, end: number): { frame: number; viseme: V3Viseme }[] {
  const seq: V3Viseme[] = ["B", "C", "D", "A", "E", "C", "F", "B", "G", "D", "H", "C", "A"];
  const out: { frame: number; viseme: V3Viseme }[] = [];
  for (let f = start, i = 0; f < end; f += 3, i++) out.push({ frame: f, viseme: seq[i % seq.length]! });
  out.push({ frame: end, viseme: "X" });
  return out;
}

function performer(castId: string, x: number, facing: "left" | "right", extra: Partial<V3Performer> = {}): V3Performer {
  return { castId, x, depth: 0.08, facing, moves: [], gestures: [], faces: [], visemes: [], effects: [], speaking: [], ...extra };
}

function words(text: string, start: number, end: number) {
  const parts = text.split(/\s+/);
  const step = (end - start) / parts.length;
  return parts.map((t, i) => ({ text: t, start: Math.round(start + i * step), end: Math.round(start + (i + 1) * step) }));
}

async function main() {
  const style = (arg("--stil") ?? "kukla") as V3CharacterStyle;
  const paths = resolveV3Paths();
  const bible = JSON.parse(await fs.readFile(path.join(paths.contentRoot, "kadrolar", "fatih-1453.json"), "utf8")) as { oyuncular: CastEntry[] };
  const cast = toRenderCast(bible.oyuncular, style);
  const accessories = await loadAccessories(costumesRoot(paths.repoRoot), cast);

  const work = path.join(paths.workRoot, `vitrin-${style}`);
  const pub = path.join(work, "public");
  await fs.mkdir(path.join(pub, "bg"), { recursive: true });
  for (const name of ["ottoman", "byzantine", "courtyard_ottoman"]) {
    await fs.copyFile(path.join(paths.backdropLibrary, `${name}.png`), path.join(pub, "bg", `${name}.png`));
  }

  const s = (sec: number) => Math.round(sec * FPS);
  const shots: V3Shot[] = [];
  const captions: V3CaptionPage[] = [];

  // 1) Saray: owner'ın referans görselindeki kurgu — tahtta padişah, iki yanında paşalar.
  {
    const start = 0, dur = s(5);
    shots.push({
      id: "saray", sceneId: "vitrin", start, duration: dur, transitionIn: "kes", dramatized: true,
      background: { src: "bg/ottoman.png", kind: "set" },
      props: [{ kind: "taht", x: 0.5, depth: 0.3, scale: 1.3 }],
      performers: [
        performer("mehmed", 0.5, "right", { depth: 0.28, seated: true, speaking: [{ start: 0, end: s(2.6) }], visemes: fakeVisemes(0, s(2.6)), faces: [{ start: 0, emotion: "mutlu" }, { start: s(2.7), emotion: "kararli" }], gestures: [{ gesture: "konus", start: 0, end: s(2.5) }, { gesture: "isaret_et", start: s(2.8), end: s(4.8), toward: "right" }] }),
        performer("halil", 0.2, "right", { faces: [{ start: 0, emotion: "korkmus" }], gestures: [{ gesture: "dusun", start: s(0.4), end: s(4.6) }], effects: [{ effect: "ter", start: s(1.5), end: s(4.5) }] }),
        performer("zaganos", 0.8, "left", { faces: [{ start: 0, emotion: "kararli" }, { start: s(2.8), emotion: "mutlu" }], gestures: [{ gesture: "elleri_belde", start: 0, end: s(2.4) }, { gesture: "yumruk_kaldir", start: s(2.8), end: s(4.8), toward: "right" }], speaking: [{ start: s(3), end: s(4.4) }], visemes: fakeVisemes(s(3), s(4.4)) }),
        performer("yeniceri", 0.93, "left", { depth: 0.45 }),
      ],
      camera: [{ frame: 0, zoom: 1, cx: 0.5, cy: 0.5 }, { frame: s(2.6), zoom: 1, cx: 0.5, cy: 0.5 }, { frame: s(3.1), zoom: 1.28, cx: 0.62, cy: 0.52, ease: "snap" }],
      shakes: [], titleCards: [{ text: "Edirne Sarayı", subtext: "1452", start: s(0.3), end: s(2.4), style: "yer_tarih" }], mapArrows: [],
    });
    captions.push({ start: 0, end: s(2.6), speaker: "II. Mehmed", words: words("Konstantiniyye'yi alacağım, paşalar!", 0, s(2.6)) });
    captions.push({ start: s(3), end: s(4.5), speaker: "Zağanos Paşa", words: words("Ordu hazır, sultanım!", s(3), s(4.4)) });
  }

  // 2) Duygular: her karakter 8 duyguyu sırayla gösterir.
  {
    const start = s(5), dur = s(5);
    const emotions = ["notr", "mutlu", "kizgin", "saskin", "korkmus", "uzgun", "kararli", "sinsi"] as const;
    const faces = (offset: number) => emotions.map((e, i) => ({ start: ((i + offset) % 8) * s(0.6), emotion: e })).sort((a, b) => a.start - b.start);
    shots.push({
      id: "duygular", sceneId: "vitrin", start, duration: dur, transitionIn: "kaydir", dramatized: true,
      background: { src: "bg/byzantine.png", kind: "set" },
      props: [],
      performers: [
        performer("konstantinos", 0.2, "right", { faces: faces(0), gestures: [{ gesture: "sasir", start: s(3.2), end: s(4.4) }], effects: [{ effect: "unlem", start: s(3.2), end: s(4.4) }] }),
        performer("giustiniani", 0.42, "right", { faces: faces(2), gestures: [{ gesture: "kollari_kavustur", start: s(0.3), end: s(4.7) }] }),
        performer("urban", 0.62, "left", { faces: faces(4), gestures: [{ gesture: "omuz_silk", start: s(1), end: s(2.4) }, { gesture: "konus", start: s(2.8), end: s(4.6) }], effects: [{ effect: "soru", start: s(1), end: s(2.4) }] }),
        performer("halil", 0.84, "left", { faces: faces(6), gestures: [{ gesture: "yuz_avucla", start: s(2), end: s(3.8) }], effects: [{ effect: "ofke", start: s(3.9), end: s(4.9) }] }),
      ],
      camera: [{ frame: 0, zoom: 1.04, cx: 0.5, cy: 0.5 }, { frame: dur, zoom: 1.12, cx: 0.5, cy: 0.48 }],
      shakes: [], titleCards: [{ text: "8 duygu", subtext: "nötr · mutlu · kızgın · şaşkın · korkmuş · üzgün · kararlı · sinsi", start: s(0.4), end: s(4.6), style: "bilgi" }], mapArrows: [],
    });
  }

  // 3) Hareket: yürüme, koşma, el sallama, eğilme, kutlama; kamera kaydırma ve top sarsıntısı.
  {
    const start = s(10), dur = s(5);
    shots.push({
      id: "hareket", sceneId: "vitrin", start, duration: dur, transitionIn: "murekkep", dramatized: true,
      background: { src: "bg/courtyard_ottoman.png", kind: "set" },
      props: [{ kind: "top", x: 0.84, depth: 0.35, scale: 0.9, flip: true }],
      performers: [
        performer("urban", 0.08, "right", { moves: [{ start: 0, end: s(1.8), fromX: 0.08, toX: 0.4 }], gestures: [{ gesture: "el_salla", start: s(2), end: s(3.6) }], faces: [{ start: 0, emotion: "mutlu" }] }),
        performer("yeniceri", 1.05, "left", { moves: [{ start: s(0.5), end: s(1.6), fromX: 1.05, toX: 0.66, run: true }], gestures: [{ gesture: "egil", start: s(2), end: s(3.6) }], faces: [{ start: 0, emotion: "kararli" }] }),
        performer("isci", 0.22, "right", { depth: 0.3, moves: [{ start: s(0.2), end: s(2.2), fromX: -0.1, toX: 0.24 }], gestures: [{ gesture: "kutla", start: s(3.6), end: s(4.9) }], faces: [{ start: 0, emotion: "notr" }, { start: s(3.5), emotion: "mutlu" }], effects: [{ effect: "parilti", start: s(3.6), end: s(4.9) }] }),
      ],
      camera: [{ frame: 0, zoom: 1.15, cx: 0.32, cy: 0.52 }, { frame: s(2), zoom: 1.15, cx: 0.55, cy: 0.52 }, { frame: s(3.8), zoom: 1.05, cx: 0.55, cy: 0.5 }],
      shakes: [{ start: s(3.4), end: s(4.1), amplitude: 22 }], titleCards: [{ text: "1452 — Rumeli Hisarı", subtext: "Boğazkesen", start: s(0.2), end: s(2.8), style: "yer_tarih" }], mapArrows: [],
    });
  }

  const plan: V3RenderPlan = {
    version: 1, episodeId: `vitrin-${style}`, title: "V3 karakter vitrini", fps: FPS, width: 1920, height: 1080,
    durationInFrames: s(15), cast, accessories, shots, captions, showCaptions: true,
  };
  const planFile = path.join(work, "plan.json");
  await fs.writeFile(planFile, JSON.stringify({ plan }));
  console.log(`plan: ${planFile} (${shots.length} çekim, ${cast.length} karakter, ${accessories.length} aksesuar)`);

  const frames = (arg("--kare") ?? "").split(",").filter(Boolean).map(Number);
  for (const f of frames) {
    const out = path.join(work, `kare-${String(f).padStart(4, "0")}.png`);
    await renderWithRemotion(paths, { planFile, publicDir: pub, out, kind: "still", frame: f });
    console.log(`kare: ${out}`);
  }
  if (process.argv.includes("--video")) {
    const preview = process.argv.includes("--onizleme");
    const out = path.join(work, preview ? "vitrin-480p.mp4" : "vitrin.mp4");
    const t0 = Date.now();
    await renderWithRemotion(paths, { planFile, publicDir: pub, out, kind: "video", scale: preview ? 0.4447 : 1, crf: preview ? 26 : 18, onLine: (l) => /Rendered|Encoded|error/i.test(l) && process.stdout.write(`  ${l.slice(0, 120)}\n`) });
    console.log(`video: ${out} (${((Date.now() - t0) / 1000).toFixed(1)} sn)`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
