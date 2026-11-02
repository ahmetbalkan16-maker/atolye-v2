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

/** How many portraits the vision judge looks at per person. */
export const MAX_PORTRAIT_CANDIDATES = 8;

const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");
/** A ruler's number after the name ("Murad I", "Mehmed II"). */
const ROMAN = /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi)$/;
/** Words of a name that say nothing about who it is ("the Great", "Sultan"). */
const NOT_A_NAME = new Set(["the", "great", "king", "queen", "sultan", "emperor", "empress", "prince", "princess", "saint", "pope", "lord", "lady", "duke", "first", "second", "third", "magnificent", "conqueror", "elder", "younger"]);

/**
 * Whether a picture's file name (or the start of its description) names the person: one name word, compared by its
 * first four letters so "Julio César" and "Iulius" still name Julius Caesar. The Caesar Short of 2 Nov 2026 was drawn
 * after a bust of Pompey from Caesar's own article — the judge called it "Pompey's marble bust" and still scored it
 * 10/10 as Caesar.
 */
export function namesPerson(c: Pick<CommonsCandidate, "title" | "description">, p: Pick<PortraitPerson, "ad" | "wiki">): boolean {
  const words = (s: string) => plain(s).split(/[^a-z]+/).filter(Boolean);
  const all = [...new Set([...words(p.wiki.replace(/\(.*?\)/g, "")), ...words(p.ad)])].filter((w) => !NOT_A_NAME.has(w) && !ROMAN.test(w));
  const names = all.filter((w) => w.length >= 4).length ? all.filter((w) => w.length >= 4) : all.filter((w) => w.length >= 3);
  const said = words(`${c.title.replace(/^File:/, "").replace(/\.\w+$/, "")} ${c.description.slice(0, 200)}`);
  const isName = (w: string) => names.some((n) => w.startsWith(n.slice(0, 4)) || (w.length >= 4 && n.startsWith(w)));
  if (!said.some(isName)) return false;
  // A ruler's number: "Murad III" is not Murad I, nor is "Mir Ali Murad Khan". A person with a number needs it after
  // their name in the picture's words (the article's lead image is judged without this).
  const own = words(p.wiki).find((w) => ROMAN.test(w));
  return !own || said.some((w, i) => isName(w) && said[i + 1] === own);
}

/**
 * Portrait candidates: the article's lead image first (Wikipedia's choice of the person's likeness, judged even when its
 * file name does not say who it is), then — taken in turn, so no one source fills the list — the article's other
 * pictures and Commons' portraits, paintings and photographs (owner, 2 Nov 2026: "sadece büstlerden değil internetten
 * fotoğraflardan çizilmiş tablolardan da yapabilir"). Until then the article's own pictures filled all six places, and
 * a painting or photograph from Commons never reached the judge. Every one but the lead image must name the person.
 */
export async function portraitCandidates(cacheDir: string, p: PortraitPerson): Promise<CommonsCandidate[]> {
  const search = (q: string) => searchCommons(cacheDir, q, { minWidth: 400, landscape: false, limit: 8 }).catch(() => [] as CommonsCandidate[]);
  const lead = await leadImage(cacheDir, p.wiki).catch(() => undefined);
  const [first, article, portraits, paintings, photographs] = await Promise.all([
    lead ? commonsByTitles(cacheDir, [lead], "wikipedia").catch(() => [] as CommonsCandidate[]) : Promise.resolve([] as CommonsCandidate[]),
    wikipediaCandidates(cacheDir, p.wiki).catch(() => [] as CommonsCandidate[]),
    search(`${p.wiki} portrait`),
    search(`${p.wiki} painting`),
    search(`${p.wiki} photograph`),
  ]);
  const usable = (c: CommonsCandidate) => c.width === 0 || c.height >= 400;
  const out = first.filter(usable).slice(0, 1);
  const seen = new Set(out.map((c) => c.url));
  const queues = [article, portraits, paintings, photographs].map((q) => q.filter((c) => usable(c) && namesPerson(c, p)));
  while (out.length < MAX_PORTRAIT_CANDIDATES && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next && !seen.has(next.url) && out.length < MAX_PORTRAIT_CANDIDATES) {
        seen.add(next.url);
        out.push(next);
      }
    }
  }
  return out;
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
  const candidates = await portraitCandidates(input.cacheDir, person);
  if (!candidates.length) {
    log(`⚠ ${person.ad}: portre adayı bulunamadı ("${person.wiki}")`);
    return undefined;
  }
  const scene = { konu: person.ad, donem: input.donem, mekan: person.rol, tr: person.ad, en: person.wiki, anlatim: "" };
  const pick = await pickBackground(candidates, scene, input.judge, (c) => commonsPreview(input.cacheDir, c), log, { mode: "portre", max: MAX_PORTRAIT_CANDIDATES });
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
