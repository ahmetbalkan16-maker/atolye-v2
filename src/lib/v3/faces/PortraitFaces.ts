import { promises as fs } from "node:fs";
import path from "node:path";
import type { AIProvider } from "../../ai/providers/AIProvider";
import { type CandidateVerdict, fitScore, passes, pickBackground, verdictLine } from "../backgrounds/BackgroundJudge";
import { type CommonsCandidate, cachedJson, commonsByTitles, commonsPreview, downloadCommons, searchCommons } from "../backgrounds/CommonsProvider";
import { wikipediaCandidates } from "../backgrounds/HistorySources";
import type { CreditRecord } from "../backgrounds/LicenseFilter";
import type { V3Face } from "../render/RenderPlanTypes";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";

/**
 * Real faces for the main historical characters (the reference channel puts real faces on cartoon bodies): the
 * person's portrait is found on their Wikipedia article and Commons (free licences only), the vision judge checks
 * it is this person with one clear face and a historical likeness, and a local face detector (OpenCV YuNet) cuts
 * the face and finds the mouth line for the talking jaw. A candidate whose face cannot be found is skipped; when
 * none works the character keeps the drawn face — never someone else's.
 */
const WIKI = "https://en.wikipedia.org/w/api.php";

export interface PortraitPerson {
  readonly id: string;
  readonly ad: string;
  readonly rol: string;
  readonly wiki: string;
}

export interface PortraitResult {
  readonly castId: string;
  readonly face: V3Face;
  readonly credit: CreditRecord;
  readonly secim: CandidateVerdict;
}

/** The article's lead image file ("File:…"), which for a person is usually their best-known portrait. */
export async function leadImage(cacheDir: string, article: string, lang = "en"): Promise<string | undefined> {
  const params = new URLSearchParams({ action: "query", format: "json", titles: article, redirects: "1", prop: "pageimages", piprop: "name" });
  const json = (await cachedJson(cacheDir, `${WIKI.replace("en.", `${lang}.`)}?${params}`)) as { query?: { pages?: Record<string, { pageimage?: string }> } };
  const name = Object.values(json.query?.pages ?? {})[0]?.pageimage;
  return name ? `File:${name}` : undefined;
}

/** Portrait candidates: the lead image first, then the article's other images, then a Commons search. */
export async function portraitCandidates(cacheDir: string, p: PortraitPerson): Promise<CommonsCandidate[]> {
  const out: CommonsCandidate[] = [];
  const lead = await leadImage(cacheDir, p.wiki).catch(() => undefined);
  if (lead) out.push(...(await commonsByTitles(cacheDir, [lead], "wikipedia").catch(() => [])));
  out.push(...(await wikipediaCandidates(cacheDir, p.wiki).catch(() => [])));
  out.push(...(await searchCommons(cacheDir, `${p.wiki} portrait`, { minWidth: 400, landscape: false, limit: 8 }).catch(() => [])));
  const seen = new Set<string>();
  return out.filter((c) => !seen.has(c.url) && seen.add(c.url) && (c.width === 0 || c.height >= 400));
}

export interface FaceCut {
  readonly ok: boolean;
  readonly mouth_y?: number;
  readonly mouth_x?: number;
  readonly flipped?: boolean;
  readonly error?: string;
}

/** Runs the local face cutter; the PNG goes to `out`. */
export async function cutFace(paths: V3Paths, image: string, out: string): Promise<FaceCut> {
  const r = await runChecked(paths.genPython, [path.join(paths.repoRoot, "scripts", "v3", "face_cut.py"), image, out, paths.faceModel], { timeoutMs: 120_000, env: { ...process.env, PYTHONUTF8: "1", TEMP: paths.asciiTemp, TMP: paths.asciiTemp } });
  const line = r.stdout.trim().split(/\r?\n/).pop() ?? "{}";
  return JSON.parse(line) as FaceCut;
}

export async function findPortraitFace(input: {
  readonly paths: V3Paths;
  /** Episode public dir; faces go to `faces/`. */
  readonly publicDir: string;
  readonly cacheDir: string;
  readonly judge: AIProvider;
  readonly person: PortraitPerson;
  readonly donem: string;
  readonly log: (s: string) => void;
}): Promise<PortraitResult | undefined> {
  const { paths, person, log } = input;
  const candidates = (await portraitCandidates(input.cacheDir, person)).slice(0, 6);
  if (!candidates.length) {
    log(`⚠ ${person.ad}: portre adayı bulunamadı ("${person.wiki}"); çizili yüz kalır`);
    return undefined;
  }
  const scene = { konu: person.ad, donem: input.donem, mekan: person.rol, tr: person.ad, en: person.wiki, anlatim: "" };
  const pick = await pickBackground(candidates, scene, input.judge, (c) => commonsPreview(input.cacheDir, c), log, { mode: "portre", max: 6 });
  const ranked = candidates
    .map((c, i) => ({ c, v: pick.verdicts[i] }))
    .filter((x): x is { c: CommonsCandidate; v: CandidateVerdict } => !!x.v && passes(x.v))
    .sort((a, b) => fitScore(b.v) - fitScore(a.v));
  for (const v of pick.verdicts) log(`  ${person.ad} portre ${passes(v) ? "✓" : "·"} ${verdictLine(v)}`);
  const dir = path.join(input.publicDir, "faces");
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(paths.asciiTemp, { recursive: true });
  for (const { c, v } of ranked) {
    const raw = path.join(paths.asciiTemp, `portre-${person.id}${path.extname(new URL(c.downloadUrl).pathname) || ".jpg"}`);
    const credit = await downloadCommons(c, raw);
    const outName = `${person.id}.png`;
    const cut = await cutFace(paths, raw, path.join(dir, outName)).catch((e: Error) => ({ ok: false, error: e.message }) as FaceCut);
    await fs.rm(raw, { force: true });
    if (cut.ok && cut.mouth_y !== undefined && cut.mouth_x !== undefined) {
      log(`  ${person.ad}: yüz kesildi (${c.title.replace(/^File:/, "").slice(0, 60)}${cut.flipped ? ", aynalandı" : ""})`);
      return { castId: person.id, face: { src: `faces/${outName}`, mouthY: cut.mouth_y, mouthX: cut.mouth_x }, credit, secim: v };
    }
    log(`  ${person.ad}: ${c.title.slice(0, 50)} — yüz kesilemedi (${cut.error ?? "?"})`);
  }
  log(`⚠ ${person.ad}: uygun portre yüzü bulunamadı; çizili yüz kalır (başka birinin yüzü kullanılmaz)`);
  return undefined;
}
