/**
 * Atölye V3 — tek komutla bölüm: konu → senaryo → ses → ağız senkronu → görsel → render → miks → final.
 *
 *   npx tsx scripts/atolye-v3.ts uret --konu "…" --donem "…" [--sure 90sn] [--ton mizahi] [--dil tr|en]
 *        [--kaynaklar <banka.json>] [--saglayici ollama|openai] [--bolum <episode.json>] [--cikti <klasör>]
 *        [--from-step senaryo|ses|senkron|gorsel|render|miks|birlestir] [--onizleme]
 *
 * Her adımın sonucu bölüm klasöründe dosya olarak durur; var olan adım atlanır, --from-step o adımdan itibaren
 * yeniden üretir. --onizleme 480p/15 fps render eder. OpenAI çağrıları video başına 1 $ tavanla sınırlıdır.
 * Çıktılar: final.mp4, altyazi.srt, CREDITS.md, aciklama.txt, QC.md (+ ara dosyalar).
 */
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { listTracksForMood } from "../src/lib/audio/music/MusicLibrary";
import { resolveOllamaConfig } from "../src/lib/ai/OllamaConfig";
import { OllamaProvider } from "../src/lib/ai/providers/OllamaProvider";
import { OpenAIProvider } from "../src/lib/ai/providers/OpenAIProvider";
import type { AIProvider } from "../src/lib/ai/providers/AIProvider";
import { type CandidateVerdict, MIN_FIT_SCORE, pickBackground } from "../src/lib/v3/backgrounds/BackgroundJudge";
import { commonsPreview, downloadCommons, searchCommons } from "../src/lib/v3/backgrounds/CommonsProvider";
import { attributionLine, type CreditRecord } from "../src/lib/v3/backgrounds/LicenseFilter";
import { toRenderCast } from "../src/lib/v3/costumes/CastMapper";
import { costumesRoot, loadAccessories, packCatalog } from "../src/lib/v3/costumes/CostumePackLoader";
import { beats, buildRenderPlan, shotEventFrames } from "../src/lib/v3/director/Director";
import { EPISODE_TONES, type Episode, type EpisodeTone, type SfxId } from "../src/lib/v3/episode/EpisodeTypes";
import { assertEpisode } from "../src/lib/v3/episode/EpisodeValidator";
import { analyzeLines, type LineSync } from "../src/lib/v3/lipsync/LipSync";
import { measureLoudness, planMusic, renderMix, sceneMusicMood, sfxCues } from "../src/lib/v3/mix/Mixer";
import type { V3Background, V3RenderPlan } from "../src/lib/v3/render/RenderPlanTypes";
import { renderWithRemotion } from "../src/lib/v3/render/RemotionRunner";
import { dialogueSceneRatio, writeScript } from "../src/lib/v3/script/ScriptEngine";
import type { ScriptBrief, ScriptLanguage, SourceBank } from "../src/lib/v3/script/ScriptPrompts";
import { V3Budget, type V3ModelChoice } from "../src/lib/v3/script/V3Budget";
import { buildTimeline, type EpisodeTimeline, type LineAudio } from "../src/lib/v3/timeline/Timeline";
import { TtsService } from "../src/lib/v3/tts/Tts";
import { freeGpuMemory } from "../src/lib/v3/util/Gpu";
import { runChecked } from "../src/lib/v3/util/Proc";
import { resolveV3Paths, type V3Paths, v3Secret } from "../src/lib/v3/V3Paths";
import { sfxFileName } from "./v3/sfx-uret";

const STEPS = ["senaryo", "ses", "senkron", "gorsel", "render", "miks", "birlestir"] as const;
type Step = (typeof STEPS)[number];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function seconds(text: string): number {
  const m = /^(?:(\d+)\s*dk)?\s*(?:(\d+)\s*(?:sn)?)?$/i.exec(text.trim());
  const total = m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : NaN;
  if (!Number.isFinite(total) || total < 20 || total > 1800) throw new Error(`--sure 20 sn ile 30 dk arasında olmalı: ${text}`);
  return total;
}

function slug(text: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
  return text.toLocaleLowerCase("tr-TR").replace(/[çğıöşüâîû]/g, (c) => map[c] ?? c).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "bolum";
}

const readJson = async <T>(file: string): Promise<T> => JSON.parse(await fs.readFile(file, "utf8")) as T;
const writeJson = (file: string, data: unknown) => fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);

/** Voices: an explicit profile for the cast id, else a distinct one from the palette in order of appearance. */
const PALETTE = ["mehmed", "halil", "zaganos", "urban", "konstantinos", "giustiniani", "yeniceri", "isci"];
function assignVoices(episode: Episode, known: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const c of episode.oyuncu_kadrosu) {
    if (!c.gorunur && !known.has(c.ses_id)) out.set(c.id, "anlatici");
    else if (known.has(c.ses_id)) out.set(c.id, c.ses_id);
    if (out.has(c.id)) used.add(out.get(c.id)!);
  }
  for (const c of episode.oyuncu_kadrosu) {
    if (out.has(c.id)) continue;
    const pick = PALETTE.find((v) => !used.has(v) && known.has(v)) ?? PALETTE[out.size % PALETTE.length]!;
    out.set(c.id, pick);
    used.add(pick);
  }
  return out;
}

/** Local SDXL sets by keyword; anything else goes to Commons. */
const THEMES: readonly [RegExp, string][] = [
  [/bizans|konstantinopol|sur(lar)?\b|ayasofya|kilise|byzant/i, "byzantine"],
  [/saray|divan|taht|çadır|masa|meclis|palace|throne|tent|council/i, "ottoman"],
  [/liman|deniz|boğaz|kıyı|gemi|harbor|bosphorus|sea|shore/i, "harbor_early"],
  [/avlu|bahçe|inşaat|iskele|hisar|kale|şantiye|courtyard|fortress|castle|scaffold|building site/i, "courtyard_ottoman"],
  [/roma|senato|forum|rome|roman/i, "roman"],
  [/mısır|piramit|egypt|pyramid/i, "egyptian"],
  [/orman|forest/i, "forest"],
];

interface ResolvedBackground extends V3Background {
  readonly credit: CreditRecord;
  /** The vision judge's verdict, for an image picked from Commons. */
  readonly secim?: CandidateVerdict;
  /** Nothing fitting was found: a generic set stands in (a QC miss). */
  readonly yedek?: boolean;
}

/**
 * Background of one scene: the episode's own file → a local set (acted-out scenes) → a Commons image the vision
 * judge scored at least MIN_FIT_SCORE (real photos allowed when they show the subject) → a generic set.
 */
async function resolveBackground(paths: V3Paths, work: string, episode: Episode, si: number, judge: AIProvider, log: (s: string) => void): Promise<ResolvedBackground> {
  const scene = episode.sahneler[si]!;
  const q = scene.arka_plan_sorgusu;
  const pub = path.join(work, "public", "bg");
  await fs.mkdir(pub, { recursive: true });
  const local = (theme: string): ResolvedBackground => ({
    src: `bg/${theme}.png`,
    kind: "set",
    credit: { assetId: `bg-${theme}`, kind: "image", title: `Atölye yerel SDXL sahnesi — ${theme}`, author: "Atölye (yerel SDXL üretimi)", license: "CreativeML Open RAIL++-M (üretilen görsel)", attributionRequired: false },
  });
  if (q.dosya) {
    await fs.copyFile(path.resolve(work, q.dosya), path.join(pub, path.basename(q.dosya)));
    return { src: `bg/${path.basename(q.dosya)}`, kind: q.tur ?? "set", credit: { assetId: `bg-${scene.id}`, kind: "image", title: path.basename(q.dosya), author: "bölüm dosyası", license: "bölümde belirtilen", attributionRequired: false } };
  }
  const text = `${q.yerel_tema ?? ""} ${scene.mekan} ${q.tr} ${q.en}`;
  const theme = q.yerel_tema && existsSync(path.join(paths.backdropLibrary, `${q.yerel_tema}.png`)) ? q.yerel_tema : THEMES.find(([re]) => re.test(text))?.[1];
  if (theme && q.tur !== "archival") {
    await fs.copyFile(path.join(paths.backdropLibrary, `${theme}.png`), path.join(pub, `${theme}.png`));
    return local(theme);
  }
  try {
    const cache = path.join(paths.workRoot, "_onbellek", "commons");
    // incategory: matches only files directly in that category, so a broad one ("Architecture") often finds
    // nothing; then the search runs without it.
    let found = await searchCommons(cache, q.commons_kategori ? `${q.en} incategory:"${q.commons_kategori}"` : q.en, { minWidth: 1600, landscape: true, limit: 12 });
    if (!found.length && q.commons_kategori) found = await searchCommons(cache, q.en, { minWidth: 1600, landscape: true, limit: 12 });
    const said = scene.satirlar.slice(0, 3).map((l) => l.metin).join(" ");
    const pick = await pickBackground(found, { konu: episode.konu, donem: episode.donem, mekan: scene.mekan, tr: q.tr, en: q.en, anlatim: said }, judge, (c) => commonsPreview(cache, c), log);
    for (const v of pick.verdicts) log(`  ${scene.id} aday ${v.puan}/10 · ${v.title.replace(/^File:/, "").slice(0, 70)} · ${v.gosterilen}`);
    if (pick.chosen && pick.verdict) {
      const c = pick.chosen;
      const file = path.join(pub, `${scene.id}${path.extname(new URL(c.downloadUrl).pathname) || ".jpg"}`);
      const credit = await downloadCommons(c, file);
      return { src: `bg/${path.basename(file)}`, kind: "archival", kenBurns: { fromZoom: 1.02, toZoom: 1.1, fromX: 0, toX: -0.015 }, credit, secim: pick.verdict };
    }
  } catch (e) {
    log(`Commons araması başarısız (${scene.id}): ${(e as Error).message.slice(0, 160)}`);
  }
  log(`sahne ${scene.id}: uygun görsel bulunamadı, ${theme ? `"${theme}" seti` : "genel set"} kullanıldı`);
  const fallback = theme ?? "courtyard_ottoman";
  await fs.copyFile(path.join(paths.backdropLibrary, `${fallback}.png`), path.join(pub, `${fallback}.png`));
  return theme ? local(fallback) : { ...local(fallback), yedek: true };
}

/** Visual beats of a render plan (the Director's own event definition, near-simultaneous events merged), in seconds. */
function visualEvents(plan: V3RenderPlan): number[] {
  const frames = plan.shots.flatMap((s) => shotEventFrames(s.performers, s.titleCards, s.camera).map((f) => s.start + f));
  return beats(frames, plan.fps).map((f) => f / plan.fps);
}

function srtTime(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

/** Captions: up to two lines of ~42 characters, never longer than 3.5 s, timed by the words. */
function buildSrt(timeline: EpisodeTimeline): string {
  const cues: string[] = [];
  for (const line of timeline.lines) {
    let page: { text: string; start: number; end: number }[] = [];
    const flush = () => {
      if (!page.length) return;
      cues.push(`${cues.length + 1}\n${srtTime(line.start + page[0]!.start)} --> ${srtTime(line.start + page[page.length - 1]!.end)}\n${page.map((w) => w.text).join(" ")}\n`);
      page = [];
    };
    for (const w of line.words) {
      const chars = page.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
      if (page.length && (chars > 84 || line.start + w.end - (line.start + page[0]!.start) > 3.5)) flush();
      page.push(w);
    }
    flush();
  }
  return cues.join("\n");
}

async function main() {
  if (process.argv[2] !== "uret") throw new Error('Kullanım: npx tsx scripts/atolye-v3.ts uret --konu "…" --donem "…" [--sure 90sn] …');
  const paths = resolveV3Paths();
  const log = (s: string) => console.log(s);
  const dil = (arg("--dil") ?? "tr") as ScriptLanguage;
  const ton = (arg("--ton") ?? "mizahi") as EpisodeTone;
  if (!EPISODE_TONES.includes(ton)) throw new Error(`--ton şunlardan biri olmalı: ${EPISODE_TONES.join(", ")}`);
  const fromStep = (arg("--from-step") ?? undefined) as Step | undefined;
  if (fromStep && !STEPS.includes(fromStep)) throw new Error(`--from-step şunlardan biri olmalı: ${STEPS.join(", ")}`);
  const preview = process.argv.includes("--onizleme");
  const given = arg("--bolum");
  const konu = arg("--konu") ?? (given ? (await readJson<Episode>(given)).konu : undefined);
  const donem = arg("--donem") ?? (given ? (await readJson<Episode>(given)).donem : undefined);
  if (!konu || !donem) throw new Error("--konu ve --donem gerekli (ya da --bolum <episode.json>)");
  const work = path.resolve(arg("--cikti") ?? path.join(paths.workRoot, "bolumler", `${slug(konu)}-${dil}`));
  await fs.mkdir(work, { recursive: true });
  const f = (name: string) => path.join(work, name);
  const redo = (s: Step) => fromStep !== undefined && STEPS.indexOf(s) >= STEPS.indexOf(fromStep);
  const need = (s: Step, file: string) => redo(s) || !existsSync(f(file));
  const t0 = Date.now();
  const step = async <T>(s: Step, run: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    try {
      const r = await run();
      log(`✓ ${s} (${Math.round((Date.now() - started) / 1000)} sn)`);
      return r;
    } catch (e) {
      throw new Error(`ADIM ${s} başarısız: ${(e as Error).message}`);
    }
  };

  // 1) Senaryo
  if (given && need("senaryo", "episode.json")) await fs.copyFile(given, f("episode.json"));
  if (need("senaryo", "episode.json")) {
    await step("senaryo", async () => {
      const bankFile = arg("--kaynaklar");
      const bank = bankFile ? await readJson<SourceBank>(bankFile) : undefined;
      const brief: ScriptBrief = { konu, donem, hedefSureSn: seconds(arg("--sure") ?? "90"), ton, dil, ...(bank ? { kaynakBankasi: bank } : {}) };
      const providerName = (arg("--saglayici") ?? process.env.ATOLYE_V3_SCRIPT_PROVIDER ?? "ollama") as "openai" | "ollama";
      if (providerName === "openai") {
        const key = v3Secret("OPENAI_API_KEY", paths.repoRoot);
        if (!key) throw new Error("OPENAI_API_KEY bulunamadı (ATOLYE_V3_SECRETS_ENV)");
        process.env.OPENAI_API_KEY = key;
        process.env.AI_PROVIDER = "openai";
      }
      const ollama = new OllamaProvider(fetch, () => ({ ...resolveOllamaConfig(), model: process.env.ATOLYE_V3_OLLAMA_MODEL ?? "gemma4:12b", timeoutMs: 1_200_000, numCtx: 16_384, format: "json" as const, think: false }));
      const writer: V3ModelChoice = providerName === "openai" ? { provider: "openai", model: process.env.ATOLYE_V3_WRITER_MODEL ?? "gpt-4.1" } : { provider: "ollama" };
      const checker: V3ModelChoice = providerName === "openai" ? { provider: "openai", model: process.env.ATOLYE_V3_CHECKER_MODEL ?? "gpt-4.1" } : { provider: "ollama" };
      const budget = new V3Budget({ providers: { openai: new OpenAIProvider(), ollama }, fallback: { provider: "ollama" } });
      try {
        const out = await writeScript({ brief, catalog: await packCatalog(costumesRoot(paths.repoRoot)), writer, checker, budget });
        await writeJson(f("episode.json"), out.episode);
        await writeJson(f("dogrulama.json"), out.factCheck);
      } finally {
        await writeJson(f("maliyet.json"), { tavanUsd: budget.capUsd, toplamUsd: budget.spentUsd, adimlar: budget.ledger });
      }
    });
  }
  const episode = assertEpisode(await readJson<unknown>(f("episode.json")));

  // 2) Ses
  type Voiced = { file: string; duration: number; voice: string };
  let voiced: Voiced[][];
  if (need("ses", "ses.json")) {
    voiced = await step("ses", async () => {
      await freeGpuMemory(5_000, log);
      const tts = await TtsService.load(paths, log);
      const known = new Set(Object.keys((await readJson<{ sesler: Record<string, unknown> }>(path.join(paths.contentRoot, "voices.json"))).sesler));
      const voices = assignVoices(episode, known);
      const out: Voiced[][] = [];
      try {
        for (const scene of episode.sahneler) {
          const lines: Voiced[] = [];
          for (const [li, line] of scene.satirlar.entries()) {
            const voice = voices.get(line.karakter) ?? "anlatici";
            try {
              const r = await tts.synthesize({ text: line.metin, voiceId: voice, emotion: line.duygu, language: dil });
              lines.push({ file: r.file, duration: r.duration, voice });
            } catch (e) {
              throw new Error(`sahne ${scene.id} satır ${li} (${line.karakter}, ses ${voice}): ${(e as Error).message}`);
            }
          }
          out.push(lines);
        }
      } finally {
        await tts.close();
      }
      await writeJson(f("ses.json"), { sesler: Object.fromEntries(voices), satirlar: out });
      return out;
    });
  } else voiced = (await readJson<{ satirlar: Voiced[][] }>(f("ses.json"))).satirlar;

  // 3) Ağız senkronu + kelime zamanları
  let synced: LineSync[][];
  if (need("senkron", "senkron.json")) {
    synced = await step("senkron", async () => {
      const flat = episode.sahneler.flatMap((s, si) => s.satirlar.map((l, li) => ({ wav: voiced[si]![li]!.file, text: l.metin, language: dil })));
      const res = await analyzeLines(paths, flat, log);
      let k = 0;
      const out = episode.sahneler.map((s) => s.satirlar.map(() => res[k++]!));
      await writeJson(f("senkron.json"), out);
      return out;
    });
  } else synced = await readJson<LineSync[][]>(f("senkron.json"));
  const audio: LineAudio[][] = episode.sahneler.map((s, si) => s.satirlar.map((_, li) => ({ ...voiced[si]![li]!, ...synced[si]![li]! })));
  const timeline = buildTimeline(episode, audio);

  // 4) Görsel
  let backgrounds: ResolvedBackground[];
  if (need("gorsel", "gorseller.json")) {
    backgrounds = await step("gorsel", async () => {
      // Free local vision judge; the same gemma4 AYAS chats with, so it is not unloaded afterwards.
      const judge = new OllamaProvider(fetch, () => ({ ...resolveOllamaConfig(), model: process.env.ATOLYE_V3_VISION_MODEL ?? "gemma4:12b", timeoutMs: 180_000, numCtx: 8_192, format: "json" as const, think: false }));
      const out: ResolvedBackground[] = [];
      for (let si = 0; si < episode.sahneler.length; si++) out.push(await resolveBackground(paths, work, episode, si, judge, log));
      await writeJson(f("gorseller.json"), out);
      return out;
    });
  } else backgrounds = await readJson<ResolvedBackground[]>(f("gorseller.json"));

  // 5) Render (sessiz; ses izi miksten gelir)
  const fps = preview ? 15 : 30;
  const cast = toRenderCast(episode.oyuncu_kadrosu, "kukla");
  const plan = buildRenderPlan({
    episode,
    timeline,
    cast,
    accessories: await loadAccessories(costumesRoot(paths.repoRoot), cast),
    backgrounds: backgrounds.map((b): V3Background => ({ src: b.src, kind: b.kind, ...(b.kenBurns ? { kenBurns: b.kenBurns } : {}) })),
    fps,
    width: 1920,
    height: 1080,
    showCaptions: true,
  });
  const silent = preview ? "video-onizleme.mp4" : "video-sessiz.mp4";
  if (need("render", silent)) {
    await step("render", async () => {
      await writeJson(f("plan.json"), { plan });
      let last = "";
      await renderWithRemotion(paths, { planFile: f("plan.json"), publicDir: path.join(work, "public"), out: f(silent), kind: "video", muted: true, ...(preview ? { scale: 0.4447 } : {}), onLine: (l) => {
        const m = /Rendered (\d+)\/(\d+)/.exec(l);
        if (m && m[1] !== last && Number(m[1]) % 300 === 0) log(`  render ${m[1]}/${m[2]}`);
        if (m) last = m[1]!;
      } });
    });
  }

  // 6) Miks
  type MixMeta = { integratedLufs: number; truePeakDb: number; credits: readonly string[] };
  let mix: MixMeta;
  if (need("miks", "miks.json")) {
    mix = await step("miks", async () => {
      const env = { ...process.env, ATOLYE_MUSIC_LIBRARY_ROOT: paths.musicRoot };
      const scenes = timeline.scenes.map((s) => ({ start: s.start, end: s.end, mood: sceneMusicMood(episode.sahneler[s.sceneIndex]!.duygu, episode.sahneler[s.sceneIndex]!.muzik_ruh_hali) }));
      const music = planMusic(scenes, (m) => listTracksForMood(m, env), episode.id);
      const sfxDir = path.join(paths.repoRoot, "public", "sfx");
      const category: Record<SfxId, string> = { whoosh: "transition", pop: "transition", boing: "transition", kilic: "battle", top_atisi: "battle", davul: "battle", kalabalik: "crowd", cekic: "interior", zil: "interior", dalga: "nature" };
      const sfx = sfxCues(episode, timeline).map((c) => ({ ...c, file: path.join(sfxDir, category[c.id], sfxFileName(c.id)) })).filter((c) => existsSync(c.file));
      const r = await renderMix(paths, { duration: timeline.duration, dialogue: timeline.lines.map((l) => ({ file: l.file, start: l.start })), music, sfx }, f("miks.wav"));
      const meta = { integratedLufs: r.integratedLufs, truePeakDb: r.truePeakDb, credits: r.credits, muzik: music.map((m) => ({ ruh_hali: m.mood, parca: m.track.title, bas: m.start, son: m.end })), efekt: sfx.map((s) => ({ id: s.id, t: s.t })) };
      await writeJson(f("miks.json"), meta);
      return meta;
    });
  } else mix = await readJson<MixMeta>(f("miks.json"));

  // 7) Birleştir + altyazı + jenerik + QC
  await step("birlestir", async () => {
    const final = preview ? "final-onizleme.mp4" : "final.mp4";
    await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", f(silent), "-i", f("miks.wav"), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", f(final)], { timeoutMs: 30 * 60_000 });
    await fs.writeFile(f("altyazi.srt"), buildSrt(timeline));
    const images = backgrounds.map((b) => b.credit);
    const picked = backgrounds.filter((b) => b.secim);
    const imageLines = [...new Set(images.filter((c) => c.attributionRequired || c.sourceUrl).map(attributionLine))];
    await fs.writeFile(
      f("CREDITS.md"),
      `# Jenerik — ${episode.baslik}\n\n## Müzik\n\n${mix.credits.map((c) => `- ${c.replace(/\n/g, " · ")}`).join("\n") || "- yok"}\n\n## Görseller\n\n${images.map((c) => `- ${attributionLine(c)}`).join("\n")}\n\n## Ses efektleri\n\n- Atölye V3 sentez efektleri (FFmpeg, CC0)\n\n## Seslendirme\n\n- Chatterbox Multilingual 0.1.7 (Resemble AI, MIT); karakter sesleri owner'ın kendi sesinden klonlandı. Çıktıda Resemble'ın duyulmayan Perth filigranı vardır.\n\n## Kaynaklar\n\n${episode.kaynaklar.map((k) => `- ${k.kunye}${k.url ? ` — ${k.url}` : ""}`).join("\n")}\n`,
    );
    await fs.writeFile(f("aciklama.txt"), `${episode.baslik}\n\nKaynaklar:\n${episode.kaynaklar.map((k) => `• ${k.kunye}`).join("\n")}\n\nMüzik:\n${mix.credits.join("\n\n")}\n${imageLines.length ? `\nGörseller:\n${imageLines.join("\n")}\n` : ""}\nBu video canlandırma içerir; diyaloglar temsilîdir.\n`);

    const durationS = Number((await runChecked(paths.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f(final)])).stdout.trim());
    const loud = await measureLoudness(paths, f(final));
    const events = visualEvents(plan);
    const gaps = events.slice(1).map((t, i) => t - events[i]!);
    const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : Infinity;
    const maxGap = Math.max(0, ...gaps, timeline.duration - (events[events.length - 1] ?? 0));
    const visible = episode.oyuncu_kadrosu.filter((c) => c.gorunur);
    const voices = (await readJson<{ sesler: Record<string, string> }>(f("ses.json"))).sesler;
    const lipsync = synced.flat();
    const factCheck = existsSync(f("dogrulama.json")) ? await readJson<{ durum: string; uygulanan: number; iddialar: unknown[] }>(f("dogrulama.json")) : undefined;
    const cost = existsSync(f("maliyet.json")) ? await readJson<{ toplamUsd: number }>(f("maliyet.json")) : { toplamUsd: 0 };
    const dialogScenes = dialogueSceneRatio(episode);
    const target = episode.hedef_sure_sn;
    const row = (ok: boolean, text: string) => `- [${ok ? "x" : " "}] ${text}`;
    const qc = [
      row((timeline.lines[0]?.start ?? 99) < 10, `İlk konuşma ${timeline.lines[0]?.start.toFixed(1)} sn'de (kanca ilk 10 sn içinde)`),
      row(avgGap >= 1.5 && avgGap <= 4, `Ortalama görsel olay aralığı ${avgGap.toFixed(1)} sn (hedef 2–4)`),
      row(maxGap <= 6, `En uzun olaysız aralık ${maxGap.toFixed(1)} sn (hedef ≤ 6)`),
      row(visible.length >= 3 && new Set(visible.map((c) => voices[c.id])).size === visible.length, `${visible.length} görünür karakter, ${new Set(visible.map((c) => voices[c.id])).size} farklı ses`),
      row(dialogScenes >= 0.3, `Diyaloglu sahne oranı %${Math.round(dialogScenes * 100)} (hedef ≥ %30)`),
      row(lipsync.every((l) => l.lipSync === "rhubarb"), `Ağız senkronu: ${lipsync.filter((l) => l.lipSync === "rhubarb").length}/${lipsync.length} satır Rhubarb, ${lipsync.filter((l) => l.lipSync === "rms").length} RMS yedeği`),
      row(images.every((c) => !/NC|ND/.test(c.license)), `Görsel lisansları: ${[...new Set(images.map((c) => c.license))].join(", ")} (NC/ND yok)`),
      row(!backgrounds.some((b) => b.yedek), `Arka planlar: ${backgrounds.length - picked.length} çizili set, ${picked.length} gerçek görsel${picked.length ? ` (hakem puanı ${picked.map((b) => b.secim!.puan).join(", ")}; eşik ${MIN_FIT_SCORE})` : ""}, ${backgrounds.filter((b) => b.yedek).length} genel yedek set`),
      row(Math.abs(loud.integratedLufs + 14) <= 1 && loud.truePeakDb <= -1, `Ses seviyesi ${loud.integratedLufs.toFixed(1)} LUFS, gerçek tepe ${loud.truePeakDb.toFixed(1)} dBTP (hedef −14 ±1, ≤ −1)`),
      row(factCheck?.durum === "tamam", `Tarih doğrulaması: ${factCheck ? `${factCheck.durum}, ${factCheck.uygulanan} düzeltme, ${factCheck.iddialar.length} bildirim` : "bölüm dışarıdan verildi, doğrulama kaydı yok"}`),
      row(mix.credits.length > 0 || images.length > 0, "CREDITS.md ve YouTube açıklama metni üretildi"),
      row(Math.abs(durationS - target) <= target * 0.1, `Süre ${durationS.toFixed(1)} sn (hedef ${target} sn ±%10)`),
    ];
    await fs.writeFile(
      f("QC.md"),
      `# QC — ${episode.baslik} (${new Date().toLocaleString("tr-TR")})\n\n${qc.join("\n")}\n\n- Maliyet: $${cost.toplamUsd.toFixed(4)} / $1.00\n- Toplam üretim süresi: ${Math.round((Date.now() - t0) / 1000)} sn${preview ? " (önizleme: 480p, 15 fps)" : ""}\n- Sesler: ${Object.entries(voices).map(([c, v]) => `${c}→${v}`).join(", ")}\n`,
    );
    log(`\nfinal: ${f(final)} (${durationS.toFixed(1)} sn) · QC: ${f("QC.md")}`);
    for (const r of qc) log(r);
  });
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
