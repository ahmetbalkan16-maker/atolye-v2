/**
 * Atölye V3 — tek komutla bölüm, her dönem ve konu için: konu → araştırma + senaryo → gardırop (gerçek kişilerin
 * portreden, o yıla göre çizilen benzerliği dahil) → ses → ağız senkronu → dönem görselleri + setler → render → miks → final.
 *
 *   npx tsx scripts/atolye-v3.ts uret --konu "…" --donem "…" [--sure 90sn] [--ton mizahi] [--dil en|tr] (varsayılan en: Amerikan İngilizcesi)
 *        [--kaynaklar <banka.json> | --wiki "Makale 1|Makale 2" | --arastirma-yok] [--saglayici ollama|openai]
 *        [--anlatici <ses id>] [--bolum <episode.json>] [--cikti <klasör>] [--altyazi-gom]
 *        [--from-step senaryo|gardirop|ses|senkron|gorsel|render|miks|birlestir] [--onizleme]
 *
 * Her adımın sonucu bölüm klasöründe dosya olarak durur; var olan adım atlanır, --from-step o adımdan itibaren
 * yeniden üretir. --onizleme 480p/15 fps render eder. OpenAI çağrıları video başına 1 $ tavanla sınırlıdır.
 * Ekranda altyazı yoktur (konuşma yazısı ve isimler; --altyazi-gom eski gömülü altyazıyı açar).
 * Çıktılar: final.mp4, altyazi.srt (YouTube CC), CREDITS.md, aciklama.txt, QC.md (+ ara dosyalar).
 */
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { listTracksForMood } from "../src/lib/audio/music/MusicLibrary";
import { resolveOllamaBaseUrl, resolveOllamaConfig } from "../src/lib/ai/OllamaConfig";
import type { AIProvider } from "../src/lib/ai/providers/AIProvider";
import { OllamaProvider } from "../src/lib/ai/providers/OllamaProvider";
import { OpenAIProvider } from "../src/lib/ai/providers/OpenAIProvider";
import { ClipRanker, clipQuery } from "../src/lib/v3/backgrounds/ClipRanker";
import { ancientPlace, BackgroundDesigner, designFor, type DesignedSet, LANDSCAPE_NEGATIVE, landscapeOnly, periodRewritePrompt, readPeriodRewrite } from "../src/lib/v3/backgrounds/BackgroundDesigner";
import { type CandidateVerdict, fitScore, MIN_FIT_SCORE, passes, pickBackground, type SceneForJudge, unreadableVerdicts, verdictLine } from "../src/lib/v3/backgrounds/BackgroundJudge";
import { type CommonsCandidate, commonsPreview, downloadCommons } from "../src/lib/v3/backgrounds/CommonsProvider";
import { findPeriodCandidates, insertCaption, periodEndYear } from "../src/lib/v3/backgrounds/HistorySources";
import { attributionLine, type CreditRecord } from "../src/lib/v3/backgrounds/LicenseFilter";
import { crowdCast, toRenderCast } from "../src/lib/v3/costumes/CastMapper";
import { checkLikenesses, designLikenesses, keepLikenesses, type LikenessRecord, noteColours } from "../src/lib/v3/faces/LikenessDesigner";
import { clothesClashes, distinctLooks } from "../src/lib/v3/costumes/LookVariety";
import { loadMapData, type Polygon } from "../src/lib/v3/maps/MapBuilder";
import { HISTORICAL_BASEMAPS_CREDIT, loadSnapshot, nearestSnapshots, snapshotNames } from "../src/lib/v3/maps/HistoricalBorders";
import { designThumbnail, type ThumbnailResult } from "../src/lib/v3/thumbnail/ThumbnailDesigner";
import { chapters, chapterText, packagePrompt, readPackage, type YoutubePackage } from "../src/lib/v3/thumbnail/YoutubePackage";
import { chiefReview, CouncilLog, councilMarkdown, writeCouncilReport } from "../src/lib/v3/council/Council";
import { designedWindows, qualityReview } from "../src/lib/v3/council/QualityBrain";
import { decideRepair, describeRepair, type RepairAction } from "../src/lib/v3/council/RepairBrain";
import { learnedRemedy, ollamaEmbedder, type OwnerRule, recall, remedyTopic, remember, seedRules, enableMeaningSearch } from "../src/lib/v3/council/ExperienceMemory";
import { LIKENESS_OK, MAX_RETOUCH_ROUNDS, planRetouch, type RetouchPlan, retouchDebate } from "../src/lib/v3/council/RetouchBrain";
import { OpenAIVisionProvider } from "../src/lib/v3/wardrobe/OpenAIVision";
import { reviewCostumes } from "../src/lib/v3/wardrobe/WardrobeBrain";
import { loadAccessories, packCatalog } from "../src/lib/v3/costumes/CostumePackLoader";
import { applyParts, costumeRootsFor, designParts, partOrders, type PartRecord } from "../src/lib/v3/costumes/PartDesigner";
import { beats, buildRenderPlan, longestEmptyStretch, type SceneInsert, shotEventFrames, stageEmptyScenes } from "../src/lib/v3/director/Director";
import { EPISODE_TONES, type Episode, type EpisodeTone, type SfxId } from "../src/lib/v3/episode/EpisodeTypes";
import { assertEpisode } from "../src/lib/v3/episode/EpisodeValidator";
import { analyzeLines, type LineSync } from "../src/lib/v3/lipsync/LipSync";
import { measureLoudness, planMusic, renderMix, sceneMusicMood, sfxCues, sfxLibraryFile } from "../src/lib/v3/mix/Mixer";
import { composeBeds, MusicComposer } from "../src/lib/v3/mix/MusicComposer";
import { type AmbienceBed, designSounds, SfxDesigner } from "../src/lib/v3/mix/SfxDesigner";
import type { V3Background, V3RenderPlan } from "../src/lib/v3/render/RenderPlanTypes";
import { renderWithRemotion } from "../src/lib/v3/render/RemotionRunner";
import { dialogueSceneRatio, ScriptError, writeScript } from "../src/lib/v3/script/ScriptEngine";
import type { ScriptBrief, ScriptLanguage, SourceBank } from "../src/lib/v3/script/ScriptPrompts";
import { researchTopic } from "../src/lib/v3/research/SourceResearch";
import { V3Budget, type V3ModelChoice } from "../src/lib/v3/script/V3Budget";
import { buildTimeline, DEFAULT_TIMELINE, type EpisodeTimeline, type LineAudio } from "../src/lib/v3/timeline/Timeline";
import { TtsService, type VoiceMap } from "../src/lib/v3/tts/Tts";
import { splitDirections } from "../src/lib/v3/tts/StageDirections";
import { coolGpuProvider, freeGpuMemory, unloadOllama, waitForCoolGpu } from "../src/lib/v3/util/Gpu";
import { runChecked, runProcess } from "../src/lib/v3/util/Proc";
import { PRODUCTION_STEPS } from "../src/lib/v3/orders/ProductionOrders";
import { loadV3Settings, resolveV3Paths, type V3Paths, v3Secret } from "../src/lib/v3/V3Paths";

// One list with the order queue, which resumes an interrupted production after its last finished step.
const STEPS = PRODUCTION_STEPS;

/**
 * Paid-text providers for the script and part stages: OpenAI when chosen (the key is borrowed for this process
 * only), gemma4 as the free fallback the budget falls back to near the cap.
 */
function scriptBudget(paths: V3Paths, capUsd?: number, vision = false): { budget: V3Budget; providerName: "openai" | "ollama" } {
  const providerName = (arg("--saglayici") ?? process.env.ATOLYE_V3_SCRIPT_PROVIDER ?? "ollama") as "openai" | "ollama";
  if (providerName === "openai") {
    const key = v3Secret("OPENAI_API_KEY", paths.repoRoot);
    if (!key) throw new Error("OPENAI_API_KEY bulunamadı (ATOLYE_V3_SECRETS_ENV)");
    process.env.OPENAI_API_KEY = key;
    process.env.AI_PROVIDER = "openai";
  }
  const ollama = coolGpuProvider(new OllamaProvider(fetch, () => ({ ...resolveOllamaConfig(), model: process.env.ATOLYE_V3_OLLAMA_MODEL ?? "gemma4:12b", timeoutMs: 1_200_000, numCtx: 16_384, format: "json" as const, think: false })), (s) => console.log(s));
  return { providerName, budget: new V3Budget({ providers: { openai: vision ? new OpenAIVisionProvider() : new OpenAIProvider(), ollama }, fallback: { provider: "ollama" }, ...(capUsd !== undefined ? { capUsd } : {}) }) };
}

/** The free local vision judge (gemma4 through Ollama) for period images, sets and portraits; it waits for a cool GPU before every call. */
function visionJudge(): AIProvider {
  return coolGpuProvider(new OllamaProvider(fetch, () => ({ ...resolveOllamaConfig(), model: process.env.ATOLYE_V3_VISION_MODEL ?? "gemma4:12b", timeoutMs: 180_000, numCtx: 8_192, format: "json" as const, think: false })), (s) => console.log(s));
}
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

/** Voices for a narration language: Turkish profiles have no `dil`, English ones `dil: "en"`. */
function voicesFor(map: VoiceMap, dil: ScriptLanguage): string[] {
  return Object.entries(map.sesler).filter(([, v]) => (v.dil ?? "tr") === dil).map(([id]) => id);
}

const PALETTE: Readonly<Record<ScriptLanguage, readonly string[]>> = {
  tr: ["mehmed", "halil", "zaganos", "urban", "konstantinos", "giustiniani", "yeniceri", "isci"],
  en: ["en-genc-lider", "en-gur-asker", "en-yasli-temkinli", "en-kurnaz", "en-ingiliz-asil", "en-telasli", "en-gundelik", "en-ingiliz-yasli", "en-ingiliz-genc", "en-kadin-lider", "en-kadin-genc", "en-kadin-ingiliz"],
};

/**
 * Voices: the narrator gets the language's narrator (or --anlatici); a character keeps the voice the script chose
 * when it exists for this language and nobody has it yet, else the next free one from the palette.
 */
function assignVoices(episode: Episode, known: ReadonlySet<string>, dil: ScriptLanguage, narrator: string): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>([narrator]);
  for (const c of episode.oyuncu_kadrosu) {
    if (!c.gorunur) out.set(c.id, narrator);
    else if (known.has(c.ses_id) && !used.has(c.ses_id)) {
      out.set(c.id, c.ses_id);
      used.add(c.ses_id);
    }
  }
  for (const c of episode.oyuncu_kadrosu) {
    if (out.has(c.id)) continue;
    const palette = PALETTE[dil].filter((v) => known.has(v));
    const pick = palette.find((v) => !used.has(v)) ?? palette[out.size % Math.max(1, palette.length)] ?? narrator;
    out.set(c.id, pick);
    used.add(pick);
  }
  return out;
}

/** Library sets (earlier SDXL renders) by keyword: tried first for a scene's set, and kept only if the judge agrees. */
const THEMES: readonly [RegExp, string][] = [
  [/bizans|konstantinopol|sur(lar)?\b|ayasofya|kilise|byzant/i, "byzantine"],
  [/saray|divan|taht|çadır|masa|meclis|palace|throne|tent|council/i, "ottoman"],
  [/liman|deniz|boğaz|kıyı|gemi|harbor|bosphorus|sea|shore/i, "harbor_early"],
  [/avlu|bahçe|inşaat|iskele|hisar|kale|şantiye|courtyard|fortress|castle|scaffold|building site/i, "courtyard_ottoman"],
  [/roma|senato|forum|rome|roman/i, "roman"],
  [/mısır|piramit|egypt|pyramid/i, "egyptian"],
  [/orman|forest/i, "forest"],
];

/** The set a scene's characters act in. */
interface SceneSet extends V3Background {
  readonly credit: CreditRecord;
  /**
   * bolum: the episode's own file; kutuphane: an earlier library render; tasarim: designed for this scene; arsiv: the
   * period image itself (no one on stage); konu: a real photo of the place or subject today (no set could be drawn).
   */
  readonly kaynak: "bolum" | "kutuphane" | "tasarim" | "arsiv" | "harita" | "konu";
  readonly secim?: CandidateVerdict;
  /** A designed set the judge did not pass after every attempt (a QC miss, never silent). */
  readonly esikAlti?: boolean;
  readonly tohum?: number;
}

/** A scene's visuals: its set, and the period image the narrator's lines cut away to (if one exists). */
interface SceneVisual {
  readonly set: SceneSet;
  readonly arsiv?: SceneInsert & { readonly credit: CreditRecord; readonly secim: CandidateVerdict };
  readonly donemGorseli: "bulundu" | "bulunamadi" | "aranmadi" | "bolum";
  /** What happened, in plain words, for the log and QC. */
  readonly not: string;
}

const extOf = (url: string) => (path.extname(new URL(url).pathname) || ".jpg").toLowerCase();

/** A 960 px JPEG of a local image for the vision judge (a full-size PNG is slow to send and adds nothing). */
async function localPreview(paths: V3Paths, file: string): Promise<Buffer> {
  await fs.mkdir(paths.asciiTemp, { recursive: true });
  const out = path.join(paths.asciiTemp, `onizleme-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`);
  await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", file, "-vf", "scale=960:-2", "-q:v", "4", out]);
  try {
    return await fs.readFile(out);
  } finally {
    await fs.rm(out, { force: true });
  }
}

function sceneForJudge(episode: Episode, si: number): SceneForJudge {
  const scene = episode.sahneler[si]!;
  const q = scene.arka_plan_sorgusu;
  return { konu: episode.konu, donem: episode.donem, mekan: scene.mekan, tr: q.tr, en: q.en, anlatim: scene.satirlar.slice(0, 3).map((l) => l.metin).join(" "), ...(q.tasarim ? { tasarim: q.tasarim } : {}) };
}

/**
 * Every scene's visuals. Owner rule (20 Oct 2026): a background must belong to the period. For the narrator's
 * cutaways a period image is searched on history pages (Wikipedia article, The Met, Commons) and judged for subject
 * AND period; if none passes, no unrelated image is used and the log says so plainly. The characters' set comes
 * from the library when the judge passes it for this scene, else it is designed with local SDXL and judged the
 * same way (two rounds of two seeds). Order matters on a 12 GB card: judge (Ollama) → draw (SDXL) → judge.
 */
async function resolveVisuals(paths: V3Paths, work: string, episode: Episode, dil: ScriptLanguage, log: (s: string) => void, redrawSets: ReadonlySet<string> = new Set()): Promise<SceneVisual[]> {
  const pub = path.join(work, "public", "bg");
  await fs.mkdir(pub, { recursive: true });
  const cache = path.join(paths.workRoot, "_onbellek", "commons");
  const judge = visionJudge();
  const clip = new ClipRanker(paths, log);
  const visible = new Set(episode.oyuncu_kadrosu.filter((c) => c.gorunur).map((c) => c.id));
  const periodEnd = periodEndYear(episode.donem);
  const used = new Set<string>();
  const n = episode.sahneler.length;
  const arsiv: (SceneVisual["arsiv"] | undefined)[] = Array(n).fill(undefined);
  const durum: SceneVisual["donemGorseli"][] = Array(n).fill("aranmadi");
  const notlar: string[] = Array(n).fill("");
  const sets: (SceneSet | undefined)[] = Array(n).fill(undefined);
  // Photos of today the period search found for a scene (ancient periods): the subject-photo fallback's candidates.
  const laterPhotos: (readonly CommonsCandidate[] | undefined)[] = Array(n).fill(undefined);

  // 1) Period images, and library sets the judge accepts for the scene.
  for (let si = 0; si < n; si++) {
    const scene = episode.sahneler[si]!;
    const q = scene.arka_plan_sorgusu;
    if (q.dosya) {
      await fs.copyFile(path.resolve(work, q.dosya), path.join(pub, path.basename(q.dosya)));
      sets[si] = { src: `bg/${path.basename(q.dosya)}`, kind: q.tur ?? "set", kaynak: "bolum", credit: { assetId: `bg-${scene.id}`, kind: "image", title: path.basename(q.dosya), author: "bölüm dosyası", license: "bölümde belirtilen", attributionRequired: false } };
      durum[si] = "bolum";
      notlar[si] = "arka plan bölüm dosyasında verilmiş";
      continue;
    }
    if (scene.harita?.merkez) {
      // A drawn map is the whole picture (characters, if any, stand on it): no set to design, no image to find.
      const plain = path.join(pub, "harita-zemin.png");
      if (!existsSync(plain)) await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x22406a:s=1920x1080", "-frames:v", "1", plain]);
      sets[si] = { src: "bg/harita-zemin.png", kind: "archival", kaynak: "harita", credit: { assetId: "natural-earth-50m", kind: "image", title: "Natural Earth 1:50m (harita verisi)", author: "Natural Earth", license: "Public domain", sourceUrl: "https://www.naturalearthdata.com/", attributionRequired: false } };
      durum[si] = "aranmadi";
      notlar[si] = "çizili harita sahnesi (Natural Earth)";
      continue;
    }
    const sj = sceneForJudge(episode, si);
    const narrated = scene.satirlar.some((l) => !visible.has(l.karakter));
    if (narrated) {
      const found = await findPeriodCandidates(cache, { ...(q.wiki ? { wiki: q.wiki } : {}), query: q.en, ...(q.ara ? { alternatives: q.ara } : {}), ...(q.commons_kategori ? { commonsCategory: q.commons_kategori } : {}) }, periodEnd);
      laterPhotos[si] = found.later;
      // CLIP orders the candidates first, so the judge's looks go to the likeliest pictures (search order without it).
      const fresh = await clip.order(found.candidates.filter((c) => !used.has(c.url)), clipQuery({ en: q.en, mekan: scene.mekan }), (c) => commonsPreview(cache, c));
      log(`${scene.id}: dönem görseli aranıyor — ${found.report.join(", ")}`);
      // The cutaway is on screen while the narrator speaks: it must show what those lines name.
      const narration = scene.satirlar.filter((l) => !visible.has(l.karakter)).map((l) => l.metin).join(" ");
      const pick = await pickBackground(fresh, { ...sj, anlatim: narration }, judge, (c) => commonsPreview(cache, c), log, { mode: "arsiv" });
      for (const v of pick.verdicts) log(`  ${passes(v) ? "✓" : "·"} ${verdictLine(v)}`);
      // Passing candidates best first; one that cannot be downloaded gives way to the next.
      const passing = fresh
        .slice(0, pick.verdicts.length)
        .map((c, i) => ({ c, v: pick.verdicts[i]! }))
        .filter((x) => passes(x.v))
        .sort((a, b) => fitScore(b.v) - fitScore(a.v));
      let got: { c: (typeof fresh)[number]; v: CandidateVerdict; credit: CreditRecord; file: string } | undefined;
      for (const { c, v } of passing) {
        const file = path.join(pub, `${scene.id}-donem${extOf(c.downloadUrl)}`);
        const credit = await downloadCommons(c, file, cache).catch((e: Error) => (log(`  ${scene.id}: ${c.title.slice(0, 50)} indirilemedi (${e.message})`), undefined));
        if (credit) {
          got = { c, v, credit, file };
          break;
        }
      }
      if (got) {
        used.add(got.c.url);
        arsiv[si] = { src: `bg/${path.basename(got.file)}`, caption: insertCaption(got.c, dil), credit: got.credit, secim: got.v };
        durum[si] = "bulundu";
        notlar[si] = `döneme ait görsel bulundu (${verdictLine(got.v)})`;
      } else {
        const best = [...pick.verdicts].sort((a, b) => fitScore(b) - fitScore(a))[0];
        durum[si] = "bulunamadi";
        notlar[si] = `DÖNEME AİT GÖRSEL BULUNAMADI — ${pick.verdicts.length} aday incelendi${best ? ` (en iyisi: ${verdictLine(best)})` : ""}. İlgisiz görsel KULLANILMADI; anlatıcı satırları çizilen sette kalır.`;
        log(`⚠ ${scene.id}: ${notlar[si]}`);
      }
    } else {
      notlar[si] = "sahnede anlatıcı satırı yok; dönem görseli gösterilecek an olmadığı için aranmadı";
    }
    const onStage = scene.satirlar.some((l) => visible.has(l.karakter)) || (scene.sahne_duzeni ?? []).some((b) => visible.has(b.karakter));
    if (!onStage && arsiv[si]) {
      // No one on stage: the period image is the whole scene.
      sets[si] = { src: arsiv[si]!.src, kind: "archival", kenBurns: { fromZoom: 1.02, toZoom: 1.1, fromX: 0, toX: -0.015 }, kaynak: "arsiv", credit: arsiv[si]!.credit, secim: arsiv[si]!.secim };
      continue;
    }
    const theme = q.yerel_tema && existsSync(path.join(paths.backdropLibrary, `${q.yerel_tema}.png`)) ? q.yerel_tema : THEMES.find(([re]) => re.test(`${scene.mekan} ${q.tr} ${q.en}`))?.[1];
    // A set the retouch brain sent back is drawn anew, never taken from the library.
    if (theme && !redrawSets.has(scene.id) && existsSync(path.join(paths.backdropLibrary, `${theme}.png`))) {
      const file = path.join(paths.backdropLibrary, `${theme}.png`);
      const pick = await pickBackground([{ title: `kütüphane seti ${theme}`, file }], sj, judge, (c) => localPreview(paths, c.file), log, { mode: "set", max: 1 });
      const v = pick.verdicts[0];
      if (v) log(`  set adayı ${passes(v) ? "✓" : "·"} ${verdictLine(v)}`);
      if (pick.chosen && pick.verdict) {
        await fs.copyFile(file, path.join(pub, `${theme}.png`));
        sets[si] = { src: `bg/${theme}.png`, kind: "set", kaynak: "kutuphane", secim: pick.verdict, credit: { assetId: `bg-${theme}`, kind: "image", title: `Atölye yerel SDXL sahnesi — ${theme}`, author: "Atölye (yerel SDXL üretimi)", license: "CreativeML Open RAIL++-M (üretilen görsel)", attributionRequired: false } };
      }
    }
  }

  // 2) Design the remaining sets: draw two seeds per scene, free the card, judge; one more round for the failures.
  // CLIP is only needed for the period-image search above.
  await clip.close();
  const designer = new BackgroundDesigner(paths, log);
  const tried = new Map<number, { d: DesignedSet; v?: CandidateVerdict }[]>();
  // A set the judge accepted for a scene in an earlier run of this episode is shown to the judge again first, unless
  // the retouch brain sent it back (a rerun without the retouch seeds drew the Rubicon's Corfinium as a medieval
  // castle, 6/10, although an 8/10 set existed).
  const acceptedFile = path.join(work, "setler-kabul.json");
  const accepted: Record<string, { dosya: string; puan: number; donem?: number; tarih: string }> = existsSync(acceptedFile) ? await readJson(acceptedFile) : {};
  for (let si = 0; si < n; si++) {
    const id = episode.sahneler[si]!.id;
    const prev = accepted[id];
    const file = prev ? path.join(designer.libraryDir, prev.dosya) : "";
    if (sets[si] || !prev || redrawSets.has(id) || !existsSync(file) || !existsSync(file.replace(/\.png$/, ".json"))) continue;
    const meta = await readJson<{ seed: number; prompt: string; prompt2: string; negative: string }>(file.replace(/\.png$/, ".json"));
    const pick = await pickBackground([{ title: `önceki kabul ${prev.dosya}`, file }], sceneForJudge(episode, si), judge, (c) => localPreview(paths, c.file), log, { mode: "set", max: 1 });
    const v = pick.verdicts[0];
    if (v) log(`  ${id} önceki kabul edilen set ${passes(v) ? "✓" : "·"} ${verdictLine(v)}`);
    if (pick.chosen && pick.verdict) sets[si] = await designedSet(pub, episode, si, { file, seed: meta.seed, design: { prompt: meta.prompt, prompt2: meta.prompt2, negative: meta.negative }, cached: true }, pick.verdict, false);
  }
  // A place whose drawings came out from a later era gets its description rewritten for the period before the next
  // round (the setting brain, on the local judge model); the judge then expects the rewritten place.
  const rewritten = new Map<number, string>();
  const sceneFor = (si: number) => {
    const sc = episode.sahneler[si]!;
    return rewritten.has(si) ? { ...sc, arka_plan_sorgusu: { ...sc.arka_plan_sorgusu, tasarim: rewritten.get(si)! } } : sc;
  };
  const judgedAs = (si: number): SceneForJudge => ({ ...sceneForJudge(episode, si), ...(rewritten.has(si) ? { tasarim: rewritten.get(si)! } : {}) });
  for (let round = 0; round < 2; round++) {
    const todo = episode.sahneler.map((_, si) => si).filter((si) => !sets[si]);
    if (!todo.length) break;
    for (const si of todo) {
      const failed = (tried.get(si) ?? []).flatMap((t) => (t.v && !passes(t.v) && !t.v.okunamadi ? [t.v] : []));
      if (round === 0 || rewritten.has(si) || !failed.some((v) => (v.donem ?? 10) <= 3)) continue;
      const sc = episode.sahneler[si]!;
      const place = sc.arka_plan_sorgusu.tasarim ?? `${sc.mekan}; ${sc.arka_plan_sorgusu.en}`;
      const reasons = failed.map((v) => v.sonrakiCag ?? v.kacin ?? v.sorun).filter(Boolean);
      // Asked twice (an answer that repeats a castle word is refused); then the ancient wording that worked.
      let text: string | undefined;
      for (let attempt = 0; attempt < 2 && !text; attempt++) {
        const out = await judge.generate(periodRewritePrompt(place, sc.mekan, episode.donem, reasons), { maxTokens: 220 }).catch((e: Error) => (log(`  ${sc.id}: tarif yeniden yazılamadı (${e.message.slice(0, 80)})`), undefined));
        const content = out ? (typeof out === "string" ? out : out.content) : "";
        text = readPeriodRewrite(content);
        if (!text && content) log(`  ${sc.id}: yeniden yazılan tarif kabul edilmedi (${content.replace(/\s+/g, " ").slice(0, 120)})`);
      }
      text ??= ancientPlace(sc.mekan, episode.donem);
      if (text) {
        rewritten.set(si, text);
        log(`  ${sc.id}: set tarifi döneme göre yeniden yazıldı — ${text}`);
      } else {
        log(`  ${sc.id}: set tarifi yeniden yazılamadı; ikinci tur aynı tarifle`);
      }
    }
    const drawn: { si: number; d: DesignedSet }[] = [];
    try {
      for (const si of todo) {
        // The setting brain's lessons: why similar sets were rejected before.
        const sc = sceneFor(si);
        const lessons = await recall(paths.workRoot, "ortam", { konu: `${sc.mekan} ${sc.arka_plan_sorgusu.tasarim ?? sc.arka_plan_sorgusu.en} ${episode.donem}`, tur: "ders", limit: 3 });
        const design = designFor(sc, episode, [], lessons.map((l) => l.metin.slice(0, 120)));
        for (const k of [0, 1]) {
          // A retouched set gets fresh seeds (rounds 2–3), so it is not the same drawing again.
          const seed = 1000 + si * 97 + ((round + (redrawSets.has(episode.sahneler[si]!.id) ? 2 : 0)) * 2 + k) * 7919;
          drawn.push({ si, d: await designer.draw(design, seed, { bolum: episode.id, sahne: episode.sahneler[si]!.id, donem: episode.donem }) });
        }
      }
    } finally {
      await designer.close();
    }
    for (const si of todo) {
      const mine = drawn.filter((x) => x.si === si).map((x) => ({ title: `tasarım ${path.basename(x.d.file)}`, d: x.d }));
      const pick = await pickBackground(mine, judgedAs(si), judge, (c) => localPreview(paths, c.d.file), log, { mode: "set" });
      const list = tried.get(si) ?? [];
      mine.forEach((m, i) => list.push({ d: m.d, ...(pick.verdicts[i] ? { v: pick.verdicts[i] } : {}) }));
      tried.set(si, list);
      for (const v of pick.verdicts) log(`  ${episode.sahneler[si]!.id} tasarım ${passes(v) ? "✓" : "·"} ${verdictLine(v)}`);
      // Rejections become the setting brain's lessons for similar places and periods.
      for (const v of pick.verdicts.filter((x) => !passes(x) && x.kacin)) await remember(paths.workRoot, { bolum: episode.konu, beyin: "ortam", tur: "ders", konu: `${episode.sahneler[si]!.mekan} ${episode.sahneler[si]!.arka_plan_sorgusu.tasarim ?? ""} ${episode.donem}`, metin: v.kacin! }).catch(() => undefined);
      if (pick.chosen && pick.verdict) {
        sets[si] = await designedSet(pub, episode, si, pick.chosen.d, pick.verdict, false);
        accepted[episode.sahneler[si]!.id] = { dosya: path.basename(pick.chosen.d.file), puan: pick.verdict.puan, ...(pick.verdict.donem !== undefined ? { donem: pick.verdict.donem } : {}), tarih: new Date().toISOString() };
        await writeJson(acceptedFile, accepted);
      }
    }
  }
  // Owner (21 Oct 2026): when no good set can be drawn, a real photo of the period or the subject is shown — the place's
  // ruins or site today, an object of the period — judged for exactly this place; never an unrelated photo.
  const subjectPhoto = async (si: number): Promise<SceneSet | undefined> => {
    const scene = episode.sahneler[si]!;
    const q = scene.arka_plan_sorgusu;
    const later = laterPhotos[si] ?? (await findPeriodCandidates(cache, { ...(q.wiki ? { wiki: q.wiki } : {}), query: q.en, ...(q.ara ? { alternatives: q.ara } : {}), ...(q.commons_kategori ? { commonsCategory: q.commons_kategori } : {}) }, periodEnd).catch(() => undefined))?.later ?? [];
    const fresh = later.filter((c) => !used.has(c.url));
    if (!fresh.length) return undefined;
    const sj = { ...sceneForJudge(episode, si), anlatim: scene.satirlar.map((l) => l.metin).join(" ") };
    const pick = await pickBackground(fresh, sj, judge, (c) => commonsPreview(cache, c), log, { mode: "konu" });
    for (const v of pick.verdicts) log(`  ${scene.id} konu fotoğrafı ${passes(v, true) ? "✓" : "·"} ${verdictLine(v)}`);
    const passing = fresh
      .slice(0, pick.verdicts.length)
      .map((c, i) => ({ c, v: pick.verdicts[i]! }))
      .filter((x) => passes(x.v, true))
      .sort((a, b) => fitScore(b.v) - fitScore(a.v));
    for (const { c, v } of passing) {
      const file = path.join(pub, `${scene.id}-konu${extOf(c.downloadUrl)}`);
      const credit = await downloadCommons(c, file, cache).catch((e: Error) => (log(`  ${scene.id}: ${c.title.slice(0, 50)} indirilemedi (${e.message})`), undefined));
      if (!credit) continue;
      used.add(c.url);
      notlar[si] = `${notlar[si]} Çizilen set tutmadı; konunun gerçek fotoğrafı kullanıldı (${verdictLine(v)}).`.trim();
      log(`  ${scene.id}: çizilen set tutmadı — konunun gerçek fotoğrafı kullanılıyor (${c.title.slice(0, 60)})`);
      return { src: `bg/${path.basename(file)}`, kind: "archival", kenBurns: { fromZoom: 1.02, toZoom: 1.1, fromX: 0, toX: -0.015 }, kaynak: "konu", credit, secim: v };
    }
    return undefined;
  };
  for (let si = 0; si < n; si++) {
    if (sets[si]) continue;
    const photo = await subjectPhoto(si);
    if (photo) {
      sets[si] = photo;
      continue;
    }
    // Still nothing the judge passes: the best attempt is used and the QC says so — never an unrelated stock image.
    const unreadable = (tried.get(si) ?? []).filter((t) => t.v?.okunamadi).length;
    if (unreadable) log(`⚠ ${episode.sahneler[si]!.id}: görüntü hakemi ${unreadable} set için okunabilir yanıt vermedi (hakem modeli: ${process.env.ATOLYE_V3_VISION_MODEL ?? "gemma4:12b"})`);
    // A drawing with a building or symbol of a later era is never the fallback (Rome, 21 Oct 2026: the "best attempt"
    // for 49 BC Corfinium had a cross on a tower). When every drawing had one, the place's countryside is drawn instead.
    if ((tried.get(si) ?? []).every((t) => t.v?.sonrakiCag)) {
      const sc = episode.sahneler[si]!;
      const landscape = designFor({ ...sc, arka_plan_sorgusu: { ...sc.arka_plan_sorgusu, tasarim: landscapeOnly(sc.mekan, episode.donem) } }, episode, LANDSCAPE_NEGATIVE);
      log(`⚠ ${sc.id}: her çizimde sonraki çağdan yapı vardı — yalnız kırsal manzara çiziliyor`);
      const extra: { title: string; d: DesignedSet }[] = [];
      try {
        for (const k of [0, 1]) extra.push({ title: "", d: await designer.draw(landscape, 1000 + si * 97 + (8 + k) * 7919, { bolum: episode.id, sahne: sc.id, donem: episode.donem, manzara: "1" }) });
      } finally {
        await designer.close();
      }
      const mine = extra.map((x) => ({ title: `manzara ${path.basename(x.d.file)}`, d: x.d }));
      const pick = await pickBackground(mine, { ...sceneForJudge(episode, si), tasarim: landscapeOnly(sc.mekan, episode.donem) }, judge, (c) => localPreview(paths, c.d.file), log, { mode: "set" });
      for (const v of pick.verdicts) log(`  ${sc.id} manzara ${passes(v) ? "✓" : "·"} ${verdictLine(v)}`);
      tried.set(si, [...(tried.get(si) ?? []), ...mine.map((m, i) => ({ d: m.d, ...(pick.verdicts[i] ? { v: pick.verdicts[i] } : {}) }))]);
      if (pick.chosen && pick.verdict) {
        sets[si] = await designedSet(pub, episode, si, pick.chosen.d, pick.verdict, false);
        continue;
      }
    }
    const clean = (tried.get(si) ?? []).filter((t) => !t.v?.sonrakiCag);
    const best = [...(clean.length ? clean : (tried.get(si) ?? []))].sort((a, b) => (b.v ? fitScore(b.v) : -1) - (a.v ? fitScore(a.v) : -1))[0];
    if (!best) throw new Error(`sahne ${episode.sahneler[si]!.id}: set tasarlanamadı`);
    if (!clean.length) log(`⚠ ${episode.sahneler[si]!.id}: temiz çizim yok — sonraki çağ izi taşıyan en iyi deneme kullanıldı (QC'de işaretli)`);
    sets[si] = await designedSet(pub, episode, si, best.d, best.v, true);
    log(`⚠ ${episode.sahneler[si]!.id}: tasarlanan set hakem eşiğini geçemedi; en iyi deneme kullanıldı (QC'de işaretli)`);
  }
  return sets.map((set, si) => ({ set: set!, ...(arsiv[si] ? { arsiv: arsiv[si] } : {}), donemGorseli: durum[si]!, not: notlar[si]! }));
}

async function designedSet(pub: string, episode: Episode, si: number, d: DesignedSet, v: CandidateVerdict | undefined, esikAlti: boolean): Promise<SceneSet> {
  const scene = episode.sahneler[si]!;
  const name = `${scene.id}-set.png`;
  await fs.copyFile(d.file, path.join(pub, name));
  return {
    src: `bg/${name}`,
    kind: "set",
    kaynak: "tasarim",
    tohum: d.seed,
    ...(v ? { secim: v } : {}),
    ...(esikAlti ? { esikAlti: true } : {}),
    credit: { assetId: path.basename(d.file), kind: "image", title: `Atölye V3 set tasarımı — ${scene.mekan}`, author: "Atölye (yerel SDXL tasarımı)", license: "CreativeML Open RAIL++-M (üretilen görsel)", attributionRequired: false, note: d.design.prompt2 },
  };
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
  // The switches of .env.v3.local (voice engine, composer, judge model…) apply to this run like the paths do.
  loadV3Settings();
  const paths = resolveV3Paths();
  const log = (s: string) => console.log(s);
  // The production council: every brain's findings and debates, reported to AYAS at the end.
  const council = new CouncilLog();
  // Owner decision (20 Oct 2026): the videos are in American English; Turkish only when asked for explicitly.
  const dil = (arg("--dil") ?? "en") as ScriptLanguage;
  const ton = (arg("--ton") ?? "mizahi") as EpisodeTone;
  if (!EPISODE_TONES.includes(ton)) throw new Error(`--ton şunlardan biri olmalı: ${EPISODE_TONES.join(", ")}`);
  // "portre" was a step of its own until the likeness moved into the wardrobe (20 Oct 2026).
  const fromStep = (arg("--from-step") === "portre" ? "gardirop" : (arg("--from-step") ?? undefined)) as Step | undefined;
  if (fromStep && !STEPS.includes(fromStep)) throw new Error(`--from-step şunlardan biri olmalı: ${STEPS.join(", ")}`);
  const preview = process.argv.includes("--onizleme");
  // Retouch round of this run (0 = the first production; the retouch brain starts round 1 by itself).
  const rotusTuru = Number(arg("--rotus-turu") ?? 0);
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
  // The owner's standing rules (faults found in finished videos) reach every brain's memory before anyone works.
  const rulesFile = path.join(paths.contentRoot, "owner-kurallari.json");
  if (existsSync(rulesFile)) {
    const added = await seedRules(paths.workRoot, (await readJson<{ kurallar: OwnerRule[] }>(rulesFile)).kurallar).catch((e: Error) => (log(`owner kuralları hafızaya yazılamadı: ${e.message}`), 0));
    if (added) log(`owner kuralları: ${added} yeni kural beyinlerin hafızasına yazıldı`);
  }
  log(`beyinlerin hafızası: ${await enableMeaningSearch(ollamaEmbedder(resolveOllamaBaseUrl()))}`);
  const bordersDir = path.join(paths.mapsDir, "historical");
  // The retouch brain's plan for this round (written by the previous run of this production), if any.
  const retouch: RetouchPlan | undefined = rotusTuru > 0 && existsSync(f("rotus-plani.json")) ? await readJson<RetouchPlan>(f("rotus-plani.json")) : undefined;
  if (retouch) log(`↺ rötuş turu ${rotusTuru}: ${retouch.kisiler.map((k) => `${k.kisi} yeniden tasarlanıyor`).concat(retouch.setler.map((x) => `${x.sahne} seti yeniden çiziliyor`)).join("; ")}`);
  // Every step runs under the repair brain: a failure is diagnosed and remedied (wait, free the GPU, change an
  // allowed setting, skip an optional step) and the step runs again; only an unrecoverable one stops the production,
  // and then the council report still goes to AYAS. The local model thinks for unknown failures (free, no agent).
  const repairModel = visionJudge();
  const step = async <T>(s: Step, run: () => Promise<T>, skip?: () => Promise<T>): Promise<T> => {
    // The remedy tried for the last failure: its outcome goes to the experience memory, so a cure is reused next time.
    let tried: { topic: string; action: RepairAction } | undefined;
    const outcome = (sonuc: "ise_yaradi" | "ise_yaramadi") =>
      tried ? remember(paths.workRoot, { bolum: konu, beyin: "onarim", tur: "ilac", konu: tried.topic, metin: `${s}: ${describeRepair(tried.action)}`, sonuc, eylem: tried.action }).catch(() => undefined) : undefined;
    for (let attempt = 1; ; attempt++) {
      const started = Date.now();
      try {
        const r = await run();
        log(`✓ ${s} (${Math.round((Date.now() - started) / 1000)} sn)${attempt > 1 ? ` — ${attempt}. denemede` : ""}`);
        await outcome("ise_yaradi");
        return r;
      } catch (e) {
        const message = (e as Error).message;
        await outcome("ise_yaramadi");
        const learned = await learnedRemedy(paths.workRoot, s, message).catch(() => undefined);
        const action = await decideRepair({ step: s, error: message, attempt, optional: !!skip, env: process.env }, repairModel, learned);
        tried = action.tur === "dur" ? undefined : { topic: remedyTopic(s, message), action };
        log(`⚕ onarım beyni [${s}, deneme ${attempt}]: ${describeRepair(action)}`);
        council.find({ beyin: "onarim", onem: action.tur === "dur" ? "eksik" : "uyari", baslik: `${s} adımında hata`, ayrinti: `${message.slice(0, 300)} → ${describeRepair(action)} (${action.kaynak})`, tur: action.kaynak === "bilinen" || action.kaynak === "hafiza" ? "ayar" : "kod", yer: s });
        if (action.tur === "dur" || attempt >= 4) {
          await writeCouncilReport({ workDir: work, workRoot: paths.workRoot, bolum: konu, log: council }).catch(() => undefined);
          throw new Error(`ADIM ${s} başarısız: ${message}`);
        }
        if (action.tur === "atla" && skip) {
          const r = await skip();
          log(`↷ ${s} atlandı, üretim sürüyor`);
          return r;
        }
        if (action.tur === "bekle_tekrar" && action.saniye > 0) await new Promise((res) => setTimeout(res, action.saniye * 1000));
        if (action.tur === "gpu_bosalt") {
          await freeGpuMemory(12_000, log);
          await waitForCoolGpu(log);
        }
        if (action.tur === "ayar") process.env[action.anahtar] = action.deger;
      }
    }
  };

  // 1) Senaryo
  // Whether this run wrote (or copied in) the script, so the wardrobe step knows its saved orders are stale.
  let scriptWritten = false;
  if (given && need("senaryo", "episode.json")) {
    await fs.copyFile(given, f("episode.json"));
    scriptWritten = true;
  }
  if (need("senaryo", "episode.json")) {
    scriptWritten = true;
    await step("senaryo", async () => {
      const { budget, providerName } = scriptBudget(paths);
      const writer: V3ModelChoice = providerName === "openai" ? { provider: "openai", model: process.env.ATOLYE_V3_WRITER_MODEL ?? "gpt-4.1" } : { provider: "ollama" };
      const checker: V3ModelChoice = providerName === "openai" ? { provider: "openai", model: process.env.ATOLYE_V3_CHECKER_MODEL ?? "gpt-4.1" } : { provider: "ollama" };
      try {
        // Sources: a hand-made bank (--kaynaklar), else the one researched for this episode earlier, else research
        // the topic now (Wikipedia revisions, every fact checked against a quote from the article).
        const bankFile = arg("--kaynaklar");
        let bank: SourceBank | undefined = bankFile ? await readJson<SourceBank>(bankFile) : existsSync(f("kaynak-bankasi.json")) ? await readJson<SourceBank>(f("kaynak-bankasi.json")) : undefined;
        if (!bank && !process.argv.includes("--arastirma-yok")) {
          const research = await researchTopic({
            cacheDir: path.join(paths.workRoot, "_onbellek", "wikipedia"),
            konu,
            donem,
            dil,
            budget,
            model: providerName === "openai" ? { provider: "openai", model: process.env.ATOLYE_V3_RESEARCH_MODEL ?? "gpt-4.1-mini" } : { provider: "ollama" },
            extraTitles: (arg("--wiki") ?? "").split("|").map((t) => t.trim()).filter(Boolean),
            log,
          });
          await writeJson(f("kaynak-bankasi.json"), research.bank);
          bank = research.bank;
        }
        const voiceMap = await readJson<VoiceMap>(path.join(paths.contentRoot, "voices.json"));
        // English characters get native voices the writer picks by description; Turkish ones keep their own ids.
        const sesler = dil === "en" ? voicesFor(voiceMap, "en").filter((id) => !id.startsWith("en-anlatici")).map((id) => ({ id, tarif: voiceMap.sesler[id]!.tarif ?? id })) : undefined;
        // The script brain's experience: what the QC and the chief found in earlier episodes.
        const dersler = (await recall(paths.workRoot, "kurgu", { limit: 6 }).catch(() => [])).map((l) => l.metin);
        // The historical atlas's polities nearest the episode's year, for real borders on the maps.
        const year = periodEndYear(donem);
        const tarihiSinirlar = year === undefined ? [] : (await Promise.all(nearestSnapshots(year).map(async (yil) => ({ yil, adlar: await snapshotNames(bordersDir, yil).catch(() => [] as string[]) })))).filter((x) => x.adlar.length);
        const brief: ScriptBrief = { konu, donem, hedefSureSn: seconds(arg("--sure") ?? "90"), ton, dil, ...(bank ? { kaynakBankasi: bank } : {}), ...(sesler ? { sesler } : {}), ...(dersler.length ? { dersler } : {}), ...(tarihiSinirlar.length ? { tarihiSinirlar } : {}) };
        const out = await writeScript({ brief, catalog: await packCatalog(costumeRootsFor(paths)), writer, checker, budget }).catch(async (e: unknown) => {
          if (e instanceof ScriptError && e.draft) await fs.writeFile(f("senaryo-hatali.json"), e.draft);
          throw e;
        });
        await writeJson(f("episode.json"), out.episode);
        await writeJson(f("dogrulama.json"), out.factCheck);
      } finally {
        await writeJson(f("maliyet.json"), { tavanUsd: budget.capUsd, toplamUsd: budget.spentUsd, adimlar: budget.ledger });
      }
    });
  }
  let episode = assertEpisode(await readJson<unknown>(f("episode.json")));

  // 2) Gardırop: parts the catalog lacks ("yeni:…") are drawn, tried on, judged and added to the wardrobe library.
  let parts: PartRecord[] = existsSync(f("gardirop.json")) ? await readJson<PartRecord[]>(f("gardirop.json")) : [];
  let likenesses: LikenessRecord[] = existsSync(f("benzerlik.json")) ? await readJson<LikenessRecord[]>(f("benzerlik.json")) : [];
  if (need("gardirop", "gardirop.json")) {
    parts = await step("gardirop", async () => {
      // The script's own orders are kept, so a rerun of this step can try again the parts that were left off.
      if (scriptWritten || !existsSync(f("episode-siparisli.json"))) await writeJson(f("episode-siparisli.json"), episode);
      else episode = assertEpisode(await readJson<unknown>(f("episode-siparisli.json")));
      let records: PartRecord[] = [];
      const before = existsSync(f("maliyet.json")) ? await readJson<{ toplamUsd: number; adimlar: unknown[] }>(f("maliyet.json")) : { toplamUsd: 0, adimlar: [] };
      // The costume brain (OpenAI with image input for the designer; the small model for historian and chief).
      const { budget, providerName } = scriptBudget(paths, Math.max(0, 1 - before.toplamUsd), true);
      const judge = visionJudge();
      const brain = providerName === "openai" ? { cacheDir: path.join(paths.workRoot, "_onbellek", "commons"), judge, budget, critic: { provider: "openai" as const, model: process.env.ATOLYE_V3_CRITIC_MODEL ?? "gpt-4.1-mini" }, council, log } : undefined;
      try {
        // First the historian reviews the whole cast's costumes (it may order new parts); then the real people are
        // drawn after their portraits as they looked in the episode's period (their parts are ordered too); every named
        // character is made distinct; then the parts are made.
        if (brain) episode = await reviewCostumes(episode, await packCatalog(costumeRootsFor(paths)), brain);
        const designer: V3ModelChoice = providerName === "openai" ? { provider: "openai", model: process.env.ATOLYE_V3_PART_MODEL ?? "gpt-4.1" } : { provider: "ollama" };
        const critic: V3ModelChoice = providerName === "openai" ? { provider: "openai", model: process.env.ATOLYE_V3_CRITIC_MODEL ?? "gpt-4.1-mini" } : { provider: "ollama" };
        const redo = new Map((retouch?.kisiler ?? []).map((k) => [k.castId, k.farklar] as const));
        const likeness = await designLikenesses(episode, { paths, commonsCache: path.join(paths.workRoot, "_onbellek", "commons"), wikiCache: path.join(paths.workRoot, "_onbellek", "wikipedia"), judge, budget, designer, critic, council, log, ...(redo.size ? { redo } : {}) });
        episode = likeness.episode;
        const variety = distinctLooks(episode, new Map(likeness.records.flatMap((r) => (r.not ? [[r.castId, noteColours(r.not.giyim)] as const] : []))));
        episode = variety.episode;
        for (const fix of variety.fixes) log(`  görünüş: ${fix}`);
        const orders = partOrders(episode);
        if (orders.length) {
          const r = await designParts({ paths, orders, donem: episode.donem, budget, model: designer, judge, workDir: path.join(work, "gardirop-prova"), log, likeness: likeness.references, ...(brain ? { brain } : {}) });
          records = r.records;
          episode = assertEpisode(applyParts(episode, r.made));
        }
        const kept = await keepLikenesses(paths, episode, likeness.records, records);
        if (kept.size) log(`  benzerlik: ${kept.size} kişi kişi kütüphanesine eklendi`);
        const checked = await checkLikenesses({ paths, episode, outcome: likeness, budget, designer, workDir: path.join(work, `benzerlik-prova${rotusTuru ? `-rotus${rotusTuru}` : ""}`), council, log, kept, lastRound: rotusTuru >= MAX_RETOUCH_ROUNDS || process.argv.includes("--rotus-yok") }).catch((e: Error) => (log(`  benzerlik kontrolü yapılamadı: ${e.message.slice(0, 160)}`), likeness.records));
        await writeJson(f("benzerlik.json"), checked);
        likenesses = checked;
        await writeJson(f("episode.json"), episode);
      } finally {
        await writeJson(f("maliyet.json"), { tavanUsd: 1, toplamUsd: before.toplamUsd + budget.spentUsd, adimlar: [...before.adimlar, ...budget.ledger] });
      }
      await writeJson(f("gardirop.json"), records);
      return records;
    }, async () => {
      // Without the wardrobe step the video still gets made: ordered parts are left off.
      episode = assertEpisode(applyParts(distinctLooks(episode).episode, new Map()));
      likenesses = [];
      await writeJson(f("benzerlik.json"), []);
      await writeJson(f("episode.json"), episode);
      await writeJson(f("gardirop.json"), []);
      return [];
    });
  }

  // A narrated scene with no one on stage gets the lead as a silent actor, so it is not one still picture throughout.
  const staged = stageEmptyScenes(episode);
  if (staged.fixes.length) {
    episode = assertEpisode(staged.episode);
    for (const fix of staged.fixes) log(`  sahne: ${fix}`);
    await writeJson(f("episode.json"), episode);
  }

  // 3) Ses
  type Voiced = { file: string; duration: number; voice: string };
  let voiced: Voiced[][];
  if (need("ses", "ses.json")) {
    voiced = await step("ses", async () => {
      await freeGpuMemory(5_000, log);
      const tts = await TtsService.load(paths, log);
      const known = new Set(voicesFor(await readJson<VoiceMap>(path.join(paths.contentRoot, "voices.json")), dil));
      const narrator = arg("--anlatici") ?? (dil === "en" ? "en-anlatici" : "anlatici");
      if (!known.has(narrator)) throw new Error(`--anlatici: bu dilde böyle bir ses yok: ${narrator}`);
      const voices = assignVoices(episode, known, dil, narrator);
      const voiceAll = async (): Promise<Voiced[][]> => {
        const out: Voiced[][] = [];
        for (const scene of episode.sahneler) {
          const lines: Voiced[] = [];
          for (const [li, line] of scene.satirlar.entries()) {
            const voice = voices.get(line.karakter) ?? narrator;
            try {
              const r = await tts.synthesize({ text: line.metin, voiceId: voice, emotion: line.duygu, language: dil });
              lines.push({ file: r.file, duration: r.duration, voice });
            } catch (e) {
              throw new Error(`sahne ${scene.id} satır ${li} (${line.karakter}, ses ${voice}): ${(e as Error).message}`);
            }
          }
          out.push(lines);
        }
        return out;
      };
      let out: Voiced[][];
      let motor = tts.voxcpmActive() ? "voxcpm" : "profil";
      try {
        try {
          out = await voiceAll();
        } catch (e) {
          // VoxCPM failed: the whole episode is voiced again with the voices' own engines (never half and half).
          if (!/V3_VOXCPM/.test((e as Error).message) || !tts.voxcpmActive()) throw e;
          log(`⚠ VoxCPM2 kullanılamadı (${(e as Error).message.slice(0, 160)}); bölüm seslerin kendi motorlarıyla seslendiriliyor`);
          council.find({ beyin: "ses", onem: "uyari", baslik: "VoxCPM2 kullanılamadı", ayrinti: (e as Error).message.slice(0, 300), oneri: "kurulumu ve sesleri kontrol et; bu bölüm Kokoro/Chatterbox ile seslendirildi", tur: "ayar", yer: "ses" });
          await tts.disableVoxcpm();
          motor = "profil";
          out = await voiceAll();
        }
      } finally {
        await tts.close();
      }
      await writeJson(f("ses.json"), { sesler: Object.fromEntries(voices), satirlar: out, motor });
      return out;
    });
  } else voiced = (await readJson<{ satirlar: Voiced[][] }>(f("ses.json"))).satirlar;

  // 4) Ağız senkronu + kelime zamanları
  let synced: LineSync[][];
  if (need("senkron", "senkron.json")) {
    synced = await step("senkron", async () => {
      const flat = episode.sahneler.flatMap((s, si) => s.satirlar.map((l, li) => ({ wav: voiced[si]![li]!.file, text: splitDirections(l.metin).speech, language: dil })));
      const res = await analyzeLines(paths, flat, log);
      let k = 0;
      const out = episode.sahneler.map((s) => s.satirlar.map(() => res[k++]!));
      await writeJson(f("senkron.json"), out);
      return out;
    });
  } else synced = await readJson<LineSync[][]>(f("senkron.json"));
  const audio: LineAudio[][] = episode.sahneler.map((s, si) => s.satirlar.map((_, li) => ({ ...voiced[si]![li]!, ...synced[si]![li]! })));
  // The opening cover (episode title over the first picture) is 3.5 s of the timeline; --kapak-yok drops it.
  const timeline = buildTimeline(episode, audio, { ...DEFAULT_TIMELINE, introS: process.argv.includes("--kapak-yok") ? 0 : 3.5 });

  // 5) Görsel (gorseller-v2.json: set + dönem görseli; the old one-image-per-scene file is not reused)
  let visuals: SceneVisual[];
  if (need("gorsel", "gorseller-v2.json")) {
    visuals = await step("gorsel", async () => {
      const out = await resolveVisuals(paths, work, episode, dil, log, new Set((retouch?.setler ?? []).map((x) => x.sahne)));
      await writeJson(f("gorseller-v2.json"), out);
      // A judge that gives no readable answers rejects every image silently: said plainly, as the judge's fault.
      if (unreadableVerdicts()) council.find({ beyin: "ortam", onem: "eksik", baslik: "görüntü hakemi okunamayan yanıt verdi", ayrinti: `${unreadableVerdicts()} değerlendirmede okunabilir yanıt yok (model: ${process.env.ATOLYE_V3_VISION_MODEL ?? "gemma4:12b"}); "bulunamadı" ve "eşik altı" sonuçları hakemden kaynaklanıyor olabilir`, oneri: "beyin sınavını çalıştır (scripts/v3/beyin-sinavi.ts calistir); ATOLYE_V3_VISION_MODEL'i kontrol et", tur: "ayar", yer: "gorsel" });
      return out;
    });
  } else visuals = await readJson<SceneVisual[]>(f("gorseller-v2.json"));
  const backgrounds = visuals.map((v) => v.set);

  // 6) Render (sessiz; ses izi miksten gelir)
  const fps = preview ? 15 : 30;
  // Actors and every scene's crowd groups (extras load their costumes the same way).
  const cast = [...toRenderCast(episode.oyuncu_kadrosu, "kukla"), ...crowdCast(episode, "kukla")];
  const borderYears = [...new Set(episode.sahneler.flatMap((s) => (s.harita?.bolgeler ?? []).flatMap((b) => (b.tarihi ? [b.tarihi.yil] : []))))];
  const baseMap = episode.sahneler.some((s) => s.harita?.merkez) ? await loadMapData(paths.mapsDir) : undefined;
  // Real historical borders the script picked (a missing snapshot only loses that outline, never the map).
  const historical = new Map((await Promise.all(borderYears.map(async (y) => [y, await loadSnapshot(bordersDir, y).catch((e: Error) => (log(`⚠ tarihî sınır ${y} yüklenemedi: ${e.message.slice(0, 120)}`), undefined))] as const))).filter((x): x is [number, Map<string, Polygon[]>] => !!x[1]));
  const mapData = baseMap ? { ...baseMap, ...(historical.size ? { historical } : {}) } : undefined;
  const plan = buildRenderPlan({
    ...(mapData ? { mapData } : {}),
    episode,
    timeline,
    cast,
    accessories: await loadAccessories(costumeRootsFor(paths), cast),
    backgrounds: backgrounds.map((b): V3Background => ({ src: b.src, kind: b.kind, ...(b.kenBurns ? { kenBurns: b.kenBurns } : {}) })),
    inserts: visuals.map((v) => (v.arsiv && v.set.kaynak !== "arsiv" ? { src: v.arsiv.src, ...(v.arsiv.caption ? { caption: v.arsiv.caption } : {}) } : undefined)),
    language: dil,
    fps,
    width: 1920,
    height: 1080,
    // No burned-in subtitles (owner, 20 Oct 2026): speech bubbles on screen, altyazi.srt for YouTube's CC.
    showCaptions: process.argv.includes("--altyazi-gom"),
  });
  const silent = preview ? "video-onizleme.mp4" : "video-sessiz.mp4";
  if (need("render", silent)) {
    await step("render", async () => {
      await writeJson(f("plan.json"), { plan });
      // The render's Chrome workers need RAM; the vision judge is not needed until the cover (PC health first).
      await unloadOllama(log, "render için RAM");
      let last = "";
      await renderWithRemotion(paths, { planFile: f("plan.json"), publicDir: path.join(work, "public"), out: f(silent), kind: "video", muted: true, ...(preview ? { scale: 0.4447 } : {}), ...(Number(process.env.ATOLYE_V3_RENDER_CONCURRENCY) > 0 ? { concurrency: Number(process.env.ATOLYE_V3_RENDER_CONCURRENCY) } : {}), onLine: (l) => {
        const m = /Rendered (\d+)\/(\d+)/.exec(l);
        if (m && m[1] !== last && Number(m[1]) % 300 === 0) log(`  render ${m[1]}/${m[2]}`);
        if (m) last = m[1]!;
      } });
    });
  }

  // 6b) Kapak + YouTube paketi: the thumbnail from the episode's own cast and sets, titles, chapters, tags. Optional:
  // without it the video is still made.
  type YoutubeFile = { paket: YoutubePackage; kapak?: Omit<ThumbnailResult, "file"> & { file: string } };
  let youtube: YoutubeFile | undefined = existsSync(f("youtube.json")) ? await readJson<YoutubeFile>(f("youtube.json")) : undefined;
  if (need("kapak", "youtube.json")) {
    youtube = await step("kapak", async () => {
      const before = existsSync(f("maliyet.json")) ? await readJson<{ toplamUsd: number; adimlar: unknown[] }>(f("maliyet.json")) : { toplamUsd: 0, adimlar: [] };
      const { budget, providerName } = scriptBudget(paths, Math.max(0, 1 - before.toplamUsd));
      let paket: YoutubePackage;
      try {
        const out = await budget.generate("youtube-paketi", providerName === "openai" ? { provider: "openai", model: process.env.ATOLYE_V3_CRITIC_MODEL ?? "gpt-4.1-mini" } : { provider: "ollama" }, packagePrompt(episode), { maxTokens: 900 });
        paket = readPackage(out.result.content, episode);
      } finally {
        await writeJson(f("maliyet.json"), { tavanUsd: 1, toplamUsd: before.toplamUsd + budget.spentUsd, adimlar: [...before.adimlar, ...budget.ledger] });
      }
      const kapak = await designThumbnail({ paths, episode, cast: plan.cast, accessories: plan.accessories, sets: backgrounds.map((b) => ({ src: b.src, kind: b.kind })), publicDir: path.join(work, "public"), headlines: paket.kapakBasliklari, judge: visionJudge(), workDir: work, log });
      const result: YoutubeFile = { paket, ...(kapak ? { kapak } : {}) };
      await writeJson(f("youtube.json"), result);
      return result;
    }, async () => undefined);
  }

  // 7) Miks
  type MixMeta = { integratedLufs: number; truePeakDb: number; credits: readonly string[]; sesTasarimi?: boolean };
  let mix: MixMeta;
  if (need("miks", "miks.json")) {
    mix = await step("miks", async () => {
      const env = { ...process.env, ATOLYE_MUSIC_LIBRARY_ROOT: paths.musicRoot };
      // Music starts under the opening cover.
      const scenes = timeline.scenes.map((s) => ({ start: s.sceneIndex === 0 ? 0 : s.start, end: s.end, mood: sceneMusicMood(episode.sahneler[s.sceneIndex]!.duygu, episode.sahneler[s.sceneIndex]!.muzik_ruh_hali) }));
      let music = planMusic(scenes, (m) => listTracksForMood(m, env), episode.id);
      // The composer: an original piece for every bed (ACE-Step, local); a bed it cannot make keeps its library track.
      const composer = new MusicComposer(paths, log);
      if (process.env.ATOLYE_V3_MUSIC_COMPOSER !== "0" && composer.available()) {
        try {
          const composed = await composeBeds(music, episode, composer, log);
          music = composed.segments;
          for (const line of composed.report) log(`  müzik: ${line}`);
          for (const line of composed.report.filter((l) => l.includes("kütüphane parçası kaldı"))) council.find({ beyin: "ses", onem: "uyari", baslik: "özgün müzik yapılamadı", ayrinti: line, tur: "veri", yer: "miks" });
        } finally {
          await composer.close();
        }
      } else log(`  müzik: besteci ${composer.available() ? "kapalı (ATOLYE_V3_MUSIC_COMPOSER=0)" : "kurulu değil"}; kütüphane parçaları`);
      const sfxDir = path.join(paths.repoRoot, "public", "sfx");
      const cues = sfxCues(episode, timeline);
      // The sound designer: period versions of the effects and a quiet ambience per scene (MOSS, local); whatever it
      // cannot make keeps the Kenney recording or stays silent.
      let periodSfx = new Map<SfxId, string>();
      let ambience: AmbienceBed[] = [];
      const sounds = new SfxDesigner(paths, log);
      if (process.env.ATOLYE_V3_SFX_DESIGNER !== "0" && sounds.available()) {
        try {
          const designed = await designSounds(episode, timeline, cues.map((c) => c.id), sounds);
          periodSfx = designed.effects;
          ambience = designed.ambience;
          for (const line of designed.report) log(`  ses: ${line}`);
          const failed = designed.report.filter((l) => l.includes(" kaldı — ") || l.includes("ortam sesi yok"));
          if (failed.length) council.find({ beyin: "ses", onem: "uyari", baslik: "dönem efekti/ortam sesi yapılamadı", ayrinti: failed.join(" | ").slice(0, 400), tur: "veri", yer: "miks" });
        } finally {
          await sounds.close();
        }
      } else log(`  ses: efektçi ${sounds.available() ? "kapalı (ATOLYE_V3_SFX_DESIGNER=0)" : "kurulu değil"}; Kenney kayıtları, ortam sesi yok`);
      const sfx = cues.flatMap((c) => {
        const file = periodSfx.get(c.id) ?? sfxLibraryFile(sfxDir, c.id);
        return file ? [{ ...c, file }] : [];
      });
      const r = await renderMix(paths, { duration: timeline.duration, dialogue: timeline.lines.map((l) => ({ file: l.file, start: l.start })), music, sfx, ambience }, f("miks.wav"));
      const meta = { integratedLufs: r.integratedLufs, truePeakDb: r.truePeakDb, credits: r.credits, muzik: music.map((m) => ({ ruh_hali: m.mood, parca: m.track.title, bas: m.start, son: m.end })), efekt: sfx.map((s) => ({ id: s.id, t: s.t, ...(periodSfx.has(s.id) ? { donem: true } : {}) })), ortam: ambience.length, sesTasarimi: periodSfx.size > 0 || ambience.length > 0 };
      await writeJson(f("miks.json"), meta);
      return meta;
    });
  } else mix = await readJson<MixMeta>(f("miks.json"));

  // 8) Birleştir + altyazı + jenerik + QC
  let retouchPlan: RetouchPlan | undefined;
  await step("birlestir", async () => {
    const final = preview ? "final-onizleme.mp4" : "final.mp4";
    // AAC lifts peaks: with the ambience beds (broadband river and wind) a −1.5 dBTP mix came out at +1.7 dBTP. A limiter
    // under the codec keeps the loudness (−14.3 measured) and the peaks well under −1; if a file still peaks over −1, the
    // ceiling comes down by the excess and it is encoded again.
    let ceilingDb = -3;
    for (let attempt = 0; attempt < 3; attempt++) {
      await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", f(silent), "-i", f("miks.wav"), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", `alimiter=limit=${(10 ** (ceilingDb / 20)).toFixed(4)}:attack=1:release=50:level=false`, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", f(final)], { timeoutMs: 30 * 60_000 });
      const peak = (await measureLoudness(paths, f(final))).truePeakDb;
      if (peak <= -1) break;
      ceilingDb -= peak + 1.3;
      log(`  ses tepesi ${peak.toFixed(1)} dBTP (sınır −1): sınırlayıcı ${ceilingDb.toFixed(1)} dB ile yeniden kodlanıyor`);
    }
    await fs.writeFile(f("altyazi.srt"), buildSrt(timeline));
    const images = [...new Map([...backgrounds.map((b) => b.credit), ...visuals.flatMap((v) => (v.arsiv ? [v.arsiv.credit] : []))].map((c) => [c.sha256 ?? c.assetId, c])).values()];
    const periodShown = visuals.filter((v) => v.arsiv);
    const imageLines = [...new Set(images.filter((c) => c.attributionRequired || c.sourceUrl).map(attributionLine)), ...(borderYears.length ? [HISTORICAL_BASEMAPS_CREDIT] : [])];
    const en = dil === "en";
    const voiceCredit = en
      ? "Kokoro-82M (hexgrad, Apache-2.0), synthesized locally"
      : "Chatterbox Multilingual 0.1.7 (Resemble AI, MIT); karakter sesleri owner'ın kendi sesinden klonlandı. Çıktıda Resemble'ın duyulmayan Perth filigranı vardır.";
    const H = en
      ? { credits: "Credits", music: "Music", images: "Images", sfx: "Sound effects", sfxLine: `Kenney (CC0) and Atölye V3 effects${mix.sesTasarimi ? "; period effects and ambience generated locally with MOSS-SoundEffect v2 (Apache-2.0)" : ""}`, voices: "Voices", sources: "Sources", none: "none", note: "This video contains dramatization; the dialogue is invented for storytelling. Period images are credited on screen and below." }
      : { credits: "Jenerik", music: "Müzik", images: "Görseller", sfx: "Ses efektleri", sfxLine: `Kenney (CC0) ve Atölye V3 efektleri${mix.sesTasarimi ? "; dönem efektleri ve ortam sesleri yerelde MOSS-SoundEffect v2 (Apache-2.0) ile üretildi" : ""}`, voices: "Seslendirme", sources: "Kaynaklar", none: "yok", note: "Bu video canlandırma içerir; diyaloglar temsilîdir." };
    await fs.writeFile(
      f("CREDITS.md"),
      `# ${H.credits} — ${episode.baslik}\n\n## ${H.music}\n\n${mix.credits.map((c) => `- ${c.replace(/\n/g, " · ")}`).join("\n") || `- ${H.none}`}\n\n## ${H.images}\n\n${images.map((c) => `- ${attributionLine(c)}`).join("\n")}${borderYears.length ? `\n- ${HISTORICAL_BASEMAPS_CREDIT}` : ""}\n\n## ${H.sfx}\n\n- ${H.sfxLine}\n\n## ${H.voices}\n\n- ${voiceCredit}\n\n## ${H.sources}\n\n${episode.kaynaklar.map((k) => `- ${k.kunye}${k.url ? ` — ${k.url}` : ""}`).join("\n")}\n`,
    );
    // YouTube: the package's title, the hook sentences and the chapters first, hashtags last.
    const chs = youtube ? chapters(timeline.scenes.map((sc) => sc.start), youtube.paket.bolumler, timeline.duration) : [];
    if (youtube) await writeJson(f("youtube.json"), { ...youtube, bolumler: chs });
    const hook = youtube?.paket.aciklamaGiris ? `${youtube.paket.aciklamaGiris}\n\n` : "";
    const chapterBlock = chs.length ? `${en ? "Chapters" : "Bölümler"}:\n${chapterText(chs)}\n\n` : "";
    const hashtags = youtube?.paket.hashtagler.length ? `\n${youtube.paket.hashtagler.join(" ")}\n` : "";
    await fs.writeFile(f("aciklama.txt"), `${youtube?.paket.basliklar[0] ?? episode.baslik}\n\n${hook}${chapterBlock}${H.sources}:\n${episode.kaynaklar.map((k) => `• ${k.kunye}`).join("\n")}\n\n${H.music}:\n${mix.credits.join("\n\n")}\n${imageLines.length ? `\n${H.images}:\n${imageLines.join("\n")}\n` : ""}\n${H.voices}: ${voiceCredit}\n\n${H.note}\n${hashtags}`);

    const durationS = Number((await runChecked(paths.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f(final)])).stdout.trim());
    const loud = await measureLoudness(paths, f(final));
    const events = visualEvents(plan);
    const gaps = events.slice(1).map((t, i) => t - events[i]!);
    const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : Infinity;
    const maxGap = Math.max(0, ...gaps, timeline.duration - (events[events.length - 1] ?? 0));
    const emptyStretch = longestEmptyStretch(plan);
    const clashes = clothesClashes(episode);
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
      row(emptyStretch <= 6, `Karaktersiz en uzun süre ${emptyStretch.toFixed(1)} sn (hedef ≤ 6; ekranda kimsenin olmadığı arşiv/tablo kareleri, kapak hariç)`),
      row(!clashes.length, `Adlı karakterlerin kıyafeti: ${clashes.length ? `AYNI — ${clashes.join(", ")}` : `${visible.filter((c) => c.kostum).length} karakter, hepsi farklı`}`),
      row(visible.length >= 3 && new Set(visible.map((c) => voices[c.id])).size === visible.length, `${visible.length} görünür karakter, ${new Set(visible.map((c) => voices[c.id])).size} farklı ses`),
      row(dialogScenes >= 0.3, `Diyaloglu sahne oranı %${Math.round(dialogScenes * 100)} (hedef ≥ %30)`),
      row(lipsync.every((l) => l.lipSync === "rhubarb"), `Ağız senkronu: ${lipsync.filter((l) => l.lipSync === "rhubarb").length}/${lipsync.length} satır Rhubarb, ${lipsync.filter((l) => l.lipSync === "rms").length} RMS yedeği`),
      row(images.every((c) => !/NC|ND/.test(c.license)), `Görsel lisansları: ${[...new Set(images.map((c) => c.license))].join(", ")} (NC/ND yok)`),
      row(
        periodShown.every((v) => passes(v.arsiv!.secim)) && new Set(periodShown.map((v) => v.arsiv!.credit.sha256)).size === periodShown.length,
        `Dönem görselleri: ${periodShown.length}/${visuals.filter((v) => v.donemGorseli !== "aranmadi" && v.donemGorseli !== "bolum").length} aranan sahnede bulundu${periodShown.length ? ` (konu/dönem ${periodShown.map((v) => `${v.arsiv!.secim.puan}/${v.arsiv!.secim.donem ?? "?"}`).join(", ")}; eşik ${MIN_FIT_SCORE})` : ""}; ${visuals.filter((v) => v.donemGorseli === "bulunamadi").length} sahnede bulunamadı — ilgisiz görsel kullanılmadı`,
      ),
      row(!parts.some((p) => p.kaynak === "basarisiz"), `Gardırop: ${parts.filter((p) => p.kaynak === "tasarim").length} yeni parça tasarlandı, ${parts.filter((p) => p.kaynak === "kutuphane").length} kütüphaneden${parts.some((p) => p.kaynak === "basarisiz") ? `, ${parts.filter((p) => p.kaynak === "basarisiz").length} parça kabul edilmedi (kostümden çıkarıldı: ${parts.filter((p) => p.kaynak === "basarisiz").map((p) => p.tarif).join("; ")})` : ""}`),
      row(likenesses.every((l) => l.kaynak !== "degismedi" && (l.benzerlik ?? 10) >= LIKENESS_OK), `Gerçek kişiler: ${likenesses.filter((l) => l.kaynak !== "degismedi").length}/${episode.oyuncu_kadrosu.filter((c) => c.gorunur && c.portre?.wiki).length} portreden ve ${episode.donem} yılına göre çizildi${likenesses.length ? ` (${likenesses.map((l) => `${l.castId}: ${l.kaynak === "kutuphane" ? "kişi kütüphanesinden" : l.kaynak === "degismedi" ? "çizilemedi" : `portre ${l.portre ? "var" : "yok"}${l.benzerlik !== undefined ? `, benzerlik ${l.benzerlik}/10` : ""}`}`).join("; ")})` : ""}`),
      row(!!youtube?.kapak && !youtube.kapak.esikAlti, `Kapak: ${youtube?.kapak ? `${youtube.kapak.varyantlar.length} çeşit, en iyisi ${youtube.kapak.secim ? verdictLine(youtube.kapak.secim) : "puansız"}${youtube.kapak.esikAlti ? " — HAKEM EŞİĞİNİN ALTINDA" : ""}` : "yok"}; YouTube paketi: ${youtube ? `${youtube.paket.basliklar.length} başlık, ${chs.length} bölüm, ${youtube.paket.etiketler.length} etiket` : "yok"}`),
      row(!backgrounds.some((b) => b.esikAlti), `Setler: ${backgrounds.filter((b) => b.kaynak === "tasarim").length} tasarlandı, ${backgrounds.filter((b) => b.kaynak === "kutuphane").length} kütüphaneden (hakem onaylı)${backgrounds.some((b) => b.esikAlti) ? `, ${backgrounds.filter((b) => b.esikAlti).length} hakem eşiğinin ALTINDA` : ""}`),
      row(Math.abs(loud.integratedLufs + 14) <= 1 && loud.truePeakDb <= -1, `Ses seviyesi ${loud.integratedLufs.toFixed(1)} LUFS, gerçek tepe ${loud.truePeakDb.toFixed(1)} dBTP (hedef −14 ±1, ≤ −1)`),
      row(factCheck?.durum === "tamam", `Tarih doğrulaması: ${factCheck ? `${factCheck.durum}, ${factCheck.uygulanan} düzeltme, ${factCheck.iddialar.length} bildirim` : "bölüm dışarıdan verildi, doğrulama kaydı yok"}`),
      row(mix.credits.length > 0 || images.length > 0, "CREDITS.md ve YouTube açıklama metni üretildi"),
      row(Math.abs(durationS - target) <= target * 0.1, `Süre ${durationS.toFixed(1)} sn (hedef ${target} sn ±%10)`),
    ];
    await fs.writeFile(
      f("QC.md"),
      `# QC — ${episode.baslik} (${new Date().toLocaleString("tr-TR")})\n\n${qc.join("\n")}\n\n- Maliyet: $${cost.toplamUsd.toFixed(4)} / $1.00\n- Toplam üretim süresi: ${Math.round((Date.now() - t0) / 1000)} sn${preview ? " (önizleme: 480p, 15 fps)" : ""}\n- Sesler: ${Object.entries(voices).map(([c, v]) => `${c}→${v}`).join(", ")}\n\n## Görsel raporu (sahne sahne)\n\n${visuals
        .map((v, i) => `- ${v.donemGorseli === "bulunamadi" || v.set.esikAlti ? "⚠ " : ""}${episode.sahneler[i]!.id}: ${v.not}. Set: ${v.set.kaynak}${v.set.secim ? ` (${verdictLine(v.set.secim)})` : ""}${v.set.esikAlti ? " — HAKEM EŞİĞİNİN ALTINDA" : ""}`)
        .join("\n")}\n`,
    );
    log(`\nfinal: ${f(final)} (${durationS.toFixed(1)} sn) · QC: ${f("QC.md")}`);
    for (const r of qc) log(r);

    // The council: each brain's findings from what this production left behind, the quality brain's watch of the
    // finished video, the chief's plan, and the report to AYAS's inbox.
    for (const v of visuals) {
      const where = episode.sahneler[visuals.indexOf(v)]!.id;
      if (v.donemGorseli === "bulunamadi") council.find({ beyin: "ortam", onem: "uyari", baslik: "dönem görseli bulunamadı", ayrinti: v.not, oneri: "sahnenin 'ara' alanına eski adlar ve yazımlar, 'wiki' alanına doğru makale", tur: "veri", yer: where });
      if (v.set.esikAlti) council.find({ beyin: "ortam", onem: "eksik", baslik: "set hakem eşiğinin altında", ayrinti: `tasarlanan set geçemedi (${v.set.secim ? verdictLine(v.set.secim) : "puan yok"})`, oneri: "tasarim tarifini somutlaştır, yeniden çiz", tur: "veri", yer: where });
    }
    for (const l of likenesses.filter((x) => x.kaynak === "tasarim" && !x.portre)) council.find({ beyin: "kostum", onem: "bilgi", baslik: "portre bulunamadı", ayrinti: `${l.kisi}: görünüş yalnız tarihçinin notundan çizildi`, oneri: "portre.wiki makale adını kontrol et", tur: "veri", yer: l.castId });
    for (const p of parts.filter((x) => x.kaynak === "basarisiz")) if (!council.findings.some((x) => x.yer === p.tarif)) council.find({ beyin: "kostum", onem: "eksik", baslik: "parça tasarlanamadı", ayrinti: p.tarif, tur: "veri", yer: p.tarif });
    const rms = lipsync.filter((l) => l.lipSync === "rms").length;
    if (rms) council.find({ beyin: "ses", onem: "uyari", baslik: "ağız senkronu yedekte", ayrinti: `${rms}/${lipsync.length} satır Rhubarb yerine ses düzeyiyle`, oneri: "Rhubarb çalıştırma ortamını kontrol et", tur: "ayar" });
    if (Math.abs(durationS - target) > target * 0.1) council.find({ beyin: "kurgu", onem: "uyari", baslik: "süre hedef dışı", ayrinti: `${durationS.toFixed(0)} sn / hedef ${target} sn`, oneri: durationS < target ? "senaryoya sahne bazlı satır ekle" : "satırları kısalt", tur: "ayar" });
    for (const claim of (factCheck?.iddialar ?? []) as { sahne?: string; satir?: number; karar?: string; gerekce?: string; sonuc?: string }[]) {
      if (claim.sonuc === "rapor" || claim.sonuc === "gecersiz_metin") council.find({ beyin: "kurgu", onem: "bilgi", baslik: `tarih editörü: ${claim.karar}`, ayrinti: claim.gerekce ?? "", tur: "veri", yer: `${claim.sahne}#${claim.satir}` });
    }
    const qualityRules = (await recall(paths.workRoot, "kalite", { tur: "kural" }).catch(() => [])).map((l) => l.metin);
    const quality = await qualityReview({ paths, video: f(final), durationS, donem: episode.donem, judge: visionJudge(), council, log, rules: qualityRules, designed: designedWindows(plan) });
    log(`kalite beyni: ${quality.checked} kare incelendi, ${quality.faulty} karede sorun, ortalama ${quality.averageScore.toFixed(1)}/10`);
    let chiefPlan: Awaited<ReturnType<typeof chiefReview>>;
    try {
      const chief = scriptBudget(paths, 0.05);
      chiefPlan = await chiefReview({ budget: chief.budget, model: chief.providerName === "openai" ? { provider: "openai", model: process.env.ATOLYE_V3_CRITIC_MODEL ?? "gpt-4.1-mini" } : { provider: "ollama" }, konu: episode.konu, log: council });
    } catch (e) {
      log(`şef değerlendirmesi yapılamadı: ${(e as Error).message.slice(0, 120)}`);
    }
    // The experience memory: what this episode taught the script brain, and the chief's measures for next time.
    const lessons: { beyin: "kurgu"; metin: string }[] = [];
    if (Math.abs(durationS - target) > target * 0.1) lessons.push({ beyin: "kurgu", metin: `A ${target} s episode ran ${durationS.toFixed(0)} s: ${durationS < target ? "write more lines per scene and fill every scene's sure_hedef" : "write fewer, shorter lines"}.` });
    if (dialogScenes < 0.4) lessons.push({ beyin: "kurgu", metin: `Only ${Math.round(dialogScenes * 100)}% of the scenes had dialogue: let the characters speak more, a quip after the narrator.` });
    if (!episode.sahneler.some((sc) => sc.satirlar.some((l) => l.sfx))) lessons.push({ beyin: "kurgu", metin: "The script gave no sfx at all: put one on a gag, a hit or an entrance in every scene." });
    for (const l of lessons) await remember(paths.workRoot, { bolum: episode.konu, beyin: l.beyin, tur: "ders", konu: "senaryo", metin: l.metin }).catch(() => undefined);
    // A measure the chief tied to no brain stays in the report only (no brain would recall it).
    for (const o of chiefPlan?.onlemler ?? []) if (o.beyin) await remember(paths.workRoot, { bolum: episode.konu, beyin: o.beyin, tur: "onlem", konu: o.baslik, metin: `${o.baslik}: ${o.neden}` }).catch(() => undefined);
    // The retouch brain: what the brains measured decides one more round, run below by the production itself.
    const nextRound = process.argv.includes("--rotus-yok") ? undefined : planRetouch({ round: rotusTuru, likenesses, sets: backgrounds.map((b, si) => ({ sahne: episode.sahneler[si]!.id, ...(b.esikAlti ? { esikAlti: true } : {}), ...(b.secim ? { secim: b.secim } : {}) })) });
    if (nextRound) {
      council.debate("sef", "rötuş kararı", retouchDebate(nextRound));
      await writeJson(f("rotus-plani.json"), nextRound);
    }
    // The quality brain delivers: a production with a missing piece (an "eksik" finding) is delivered with a warning.
    const missing = council.findings.filter((x) => x.onem === "eksik").length;
    const report = await writeCouncilReport({ workDir: work, workRoot: paths.workRoot, bolum: episode.baslik, log: council, ...(chiefPlan ? { plan: chiefPlan } : {}) });
    await fs.writeFile(f("KURUL.md"), councilMarkdown(episode.baslik, council, chiefPlan));
    await fs.appendFile(f("QC.md"), `\n## Yapım kurulu\n\n- Kalite beyni: ${quality.checked} kare, ${quality.faulty} karede sorun, ortalama ${quality.averageScore.toFixed(1)}/10\n- Bulgular: ${missing} eksik, ${council.findings.filter((x) => x.onem === "uyari").length} uyarı (ayrıntı KURUL.md)\n- Teslim: ${missing ? "UYARIYLA teslim — eksikler AYAS'a bildirildi" : "teslim edildi"}\n`);
    log(`kurul raporu: ${report} · ${missing ? `UYARIYLA teslim (${missing} eksik)` : "teslim edildi"}`);
    retouchPlan = nextRound;
  });

  // One retouch round, run by the production itself (no agent needed): the same command from the plan's step. The
  // first cut is kept next to it for comparison. The GPU and cost rules hold in the new run as in this one.
  if (retouchPlan) {
    const finalName = preview ? "final-onizleme.mp4" : "final.mp4";
    await fs.copyFile(f(finalName), f(finalName.replace(/.mp4$/, `-tur${rotusTuru}.mp4`)));
    const keep = process.argv.slice(2).filter((a, i, all) => !["--from-step", "--rotus-turu"].includes(a) && !["--from-step", "--rotus-turu"].includes(all[i - 1] ?? ""));
    const args = [...process.execArgv, process.argv[1]!, ...keep, ...(keep.includes("--cikti") ? [] : ["--cikti", work]), "--from-step", retouchPlan.adim, "--rotus-turu", String(retouchPlan.tur)];
    log(`↺ rötuş beyni: ${retouchPlan.tur}. tur başlıyor ("${retouchPlan.adim}" adımından)`);
    const r = await runProcess(process.execPath, args, { onLine: log, env: process.env });
    if (r.code !== 0) throw new Error(`rötuş turu başarısız (çıkış ${r.code}); ilk kesim ${finalName.replace(/.mp4$/, `-tur${rotusTuru}.mp4`)} olarak duruyor`);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
