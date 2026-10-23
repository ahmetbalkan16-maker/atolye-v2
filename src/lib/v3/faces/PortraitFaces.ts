import type { AIProvider } from "../../ai/providers/AIProvider";
import { type CandidateVerdict, passes, pickBackground, verdictLine } from "../backgrounds/BackgroundJudge";
import { type CommonsCandidate, cachedJson, commonsByTitles, commonsPreview, searchCommons } from "../backgrounds/CommonsProvider";
import { wikipediaCandidates } from "../backgrounds/HistorySources";
import { periodEndYear } from "../episode/Period";

/**
 * Portraits of the real people in an episode, to draw them after (the reference channel draws its main characters
 * from their famous portraits: Henry VIII's cap, beard and fur robe from Holbein): the portrait is found on their
 * Wikipedia article and Commons (free licences only) and the vision judge checks it is this person, clearly visible,
 * a historical likeness near the episode's period. The picture is only looked at — nothing of it is shown in the
 * video; see LikenessDesigner.
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
  readonly candidate: CommonsCandidate;
  /** The small JPEG preview the designer and the likeness check look at. */
  readonly preview: Buffer;
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

/**
 * The best portrait of the person for drawing them (the judge must confirm it is them, ideally at the age they had in
 * the episode's period), with its small preview for the designer. Undefined when none passes — then the likeness is
 * drawn from the historian's notes alone, never from someone else's picture.
 */
export async function findPortrait(input: {
  readonly cacheDir: string;
  readonly judge: AIProvider;
  readonly person: PortraitPerson;
  readonly donem: string;
  readonly log: (s: string) => void;
}): Promise<PortraitResult | undefined> {
  const { person, log } = input;
  const candidates = (await portraitCandidates(input.cacheDir, person)).slice(0, 6);
  if (!candidates.length) {
    log(`⚠ ${person.ad}: portre adayı bulunamadı ("${person.wiki}")`);
    return undefined;
  }
  const scene = { konu: person.ad, donem: input.donem, mekan: person.rol, tr: person.ad, en: person.wiki, anlatim: "" };
  const pick = await pickBackground(candidates, scene, input.judge, (c) => commonsPreview(input.cacheDir, c), log, { mode: "portre", max: 6 });
  for (const v of pick.verdicts) log(`  ${person.ad} portre ${passes(v) ? "✓" : "·"} ${verdictLine(v)}`);
  const traditional = pick.chosen ? undefined : traditionalPortrait(pick.verdicts, periodEndYear(input.donem));
  const chosen = pick.chosen ?? (traditional ? candidates[pick.verdicts.indexOf(traditional)] : undefined);
  const verdict = pick.verdict ?? traditional;
  if (!chosen || !verdict) {
    log(`⚠ ${person.ad}: uygun portre bulunamadı; görünüş tarihçinin notundan çizilecek (başka birinin resmi kullanılmaz)`);
    return undefined;
  }
  if (traditional) log(`  ${person.ad}: yaşadığı çağdan portresi yok; bilinen geleneksel portresi alındı (${verdictLine(traditional)})`);
  const preview = await commonsPreview(input.cacheDir, chosen);
  return { castId: person.id, candidate: chosen, preview, secim: verdict };
}

/** Before this year a person's likeness from their own lifetime rarely survives (medieval rulers, ancient generals). */
export const TRADITIONAL_PORTRAIT_BEFORE = 1500;
/** How sure the judge must be that a later portrait shows this very person. */
export const TRADITIONAL_MIN_SUBJECT = 8;

/**
 * A medieval or ancient person's known portrait when the judge passed none (the Kosovo 1389 trial, 23 Oct 2026: Murad
 * I's portrait after Veronese scored "subject 9, period 2" — every portrait of him is later, so every one was refused
 * and his likeness was guessed). The best one the judge is sure shows them (subject ≥ 8), a painting or drawing, not
 * modern (an actor, a reenactor, a recent illustration) and readable. None for anyone after 1500 or of unknown period.
 */
export function traditionalPortrait(verdicts: readonly CandidateVerdict[], year: number | undefined): CandidateVerdict | undefined {
  if (year === undefined || year >= TRADITIONAL_PORTRAIT_BEFORE) return undefined;
  return verdicts
    .filter((v) => !v.okunamadi && v.modern !== true && v.puan >= TRADITIONAL_MIN_SUBJECT && (v.tur === undefined || v.tur === "eser" || v.tur === "cizim"))
    .sort((a, b) => b.puan - a.puan || (b.donem ?? 0) - (a.donem ?? 0))[0];
}
