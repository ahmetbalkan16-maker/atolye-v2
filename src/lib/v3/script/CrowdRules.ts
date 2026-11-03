import type { CastCostume, CastEntry, Episode, EpisodeScene, SceneCrowd } from "../episode/EpisodeTypes";
import { validateEpisode } from "../episode/EpisodeValidator";
import { periodEndYear } from "../episode/Period";

/**
 * A group the narration tells is seen as a group (owner, 3 Nov 2026: "askerler diyorsa birden fazla asker olacak" —
 * the Caesar Short's "Caesar came back with troops and captured the pirates" played over Caesar and one pirate): a
 * scene whose narrator tells of soldiers, an army, pirates, guards or a mob carries a "kalabalik" of them, several
 * figures, never one character standing in for many. Map scenes tell their armies with tokens and are left out.
 */
interface GroupWord {
  /** The singular a cast member of the group is named by ("pirate" for the Pirate Captain), English or Turkish. */
  readonly stem: string;
  readonly re: RegExp;
  readonly soldiers: boolean;
}

// No \b: it does not see Turkish letters. A group word starts and ends at a non-letter.
const at = (body: string) => new RegExp(`(?<![\\p{L}])(?:${body})(?![\\p{L}])`, "iu");
const en = (stem: string, plural = `${stem}s`, soldiers = false): GroupWord => ({ stem, re: at(plural), soldiers });
// Turkish plurals carry case endings: "korsanları", "askerlerle".
const tr = (stem: string, soldiers = false): GroupWord => ({ stem, re: at(`${stem}(?:lar|ler)\\p{L}*`), soldiers });

const GROUPS: readonly GroupWord[] = [
  en("soldier", "soldiers", true),
  en("troop", "troops", true),
  en("army", "army|armies", true),
  en("legion", "legions?|legionaries", true),
  en("warrior", "warriors", true),
  en("knight", "knights", true),
  en("janissar", "janissaries", true),
  en("guard", "guards|bodyguards", true),
  en("archer", "archers", true),
  en("cavalry", "cavalry|horsemen", true),
  en("infantry", "infantry|spearmen|footmen", true),
  en("pirate"),
  en("sailor", "sailors|crew"),
  en("rebel"),
  en("senator"),
  en("citizen"),
  en("peasant"),
  en("villager"),
  en("worker"),
  en("monk"),
  en("priest"),
  en("noble"),
  en("merchant"),
  en("prisoner"),
  en("crowd", "crowds?|mob"),
  tr("asker", true),
  { stem: "ordu", re: at("ordu(?:su|sunu|suyla|lar\\p{L}*|yu|ya|yla)?"), soldiers: true },
  tr("yeniçeri", true),
  tr("muhafız", true),
  tr("şövalye", true),
  tr("okçu", true),
  tr("süvari", true),
  tr("korsan"),
  tr("denizci"),
  tr("isyancı"),
  tr("köylü"),
  tr("işçi"),
  tr("keşiş"),
  tr("tüccar"),
  tr("esir"),
  { stem: "halk", re: at("halk|kalabalık\\p{L}*"), soldiers: false },
];

const SOLDIER_WORDS = /soldier|troop|legion|warrior|knight|janissar|guard|archer|cavalry|infantry|asker|yeniçeri|muhafız|şövalye|okçu|süvari|lejyon/iu;
const SOLDIER_GARMENTS: ReadonlySet<string> = new Set(["zirh", "uniforma", "yeniceri"]);
/** A past-tense act right after a group's word: "the legions crossed", "askerler kaleye saldırdı". */
const PAST_ACT = /^(?:\p{L}+ed|ran|fled|came|went|fought|took|rode|stood|broke|won|lost|fell|rose|swept|struck|began|drove|threw|sang|cheered|laughed|stormed|\p{L}+(?:d|t)[ıiuü](?:lar|ler)?)$/iu;

export interface ToldGroup {
  readonly stem: string;
  /** The words as the line says them. */
  readonly word: string;
  readonly soldiers: boolean;
  /** The first narrator line that tells it. */
  readonly line: number;
  /** The sentence that tells it, and whether the group is the first one that sentence names (its subject, mostly). */
  readonly sentence: string;
  readonly first: boolean;
  /** Where its word stands in the sentence. */
  readonly index: number;
}

/** A text's sentences. */
const sentences = (text: string) => text.split(/(?<=[.!?;])\s+/);

/**
 * The groups a scene's narrator lines tell, each once, in the order they are first told. `acting`: only a group that
 * does something in its sentence (a past-tense verb within its next four words) — a long episode's narrator also tells
 * of groups far away ("The Senate orders Caesar to disband his army"), a Short's tells its one moment.
 */
export function toldGroups(scene: Pick<EpisodeScene, "satirlar">, narrators: ReadonlySet<string>, acting = false): ToldGroup[] {
  const out: ToldGroup[] = [];
  scene.satirlar.forEach((l, i) => {
    if (!narrators.has(l.karakter)) return;
    for (const sentence of sentences(l.metin)) {
      const found = GROUPS.flatMap((g) => {
        const m = g.re.exec(sentence);
        return m ? [{ g, m }] : [];
      }).sort((a, b) => a.m.index - b.m.index);
      found.forEach(({ g, m }, n) => {
        // One soldiers' group per scene: "the army" and "his troops" are the same men.
        if (out.some((o) => o.stem === g.stem || (o.soldiers && g.soldiers))) return;
        if (acting && !sentence.slice(m.index + m[0].length).split(/[^\p{L}]+/u).filter(Boolean).slice(0, 4).some((w) => PAST_ACT.test(w))) return;
        out.push({ stem: g.stem, word: m[0], soldiers: g.soldiers, line: i, sentence, first: n === 0, index: m.index });
      });
    }
  });
  return out;
}

const shows = (crowd: Pick<SceneCrowd, "ad" | "duzen">, g: ToldGroup) =>
  crowd.ad.toLocaleLowerCase("tr-TR").includes(g.stem.toLocaleLowerCase("tr-TR")) || (g.soldiers && (crowd.duzen === "ordu" || SOLDIER_WORDS.test(crowd.ad)));

/** The told groups a scene does not show (map and photo scenes tell theirs otherwise). */
export function missingCrowds(episode: Pick<Episode, "oyuncu_kadrosu">, scene: EpisodeScene, shorts = false): ToldGroup[] {
  if (scene.harita?.merkez || scene.kip === "fotograf") return [];
  const narrators = new Set(episode.oyuncu_kadrosu.filter((c) => !c.gorunur).map((c) => c.id));
  return toldGroups(scene, narrators, !shorts).filter((g) => !(scene.kalabalik ?? []).some((c) => shows(c, g)));
}

/** The missing crowds as repair problems, asked in the same rounds as the map rules (a valid script is never lost over them). */
export function crowdProblems(episode: unknown, shorts = false): string[] {
  if (typeof episode !== "object" || episode === null || !Array.isArray((episode as Episode).sahneler) || !Array.isArray((episode as Episode).oyuncu_kadrosu)) return [];
  const e = episode as Episode;
  return e.sahneler.flatMap((s) => {
    const missing = missingCrowds(e, s, shorts);
    if (!missing.length) return [];
    return [`scene "${s.id}" tells of ${missing.map((g) => `"${g.word}"`).join(" and ")} but shows no crowd of them: give it a "kalabalik" for each group — several figures (sayi 4–12, "duzen": "ordu" for soldiers), costume from the catalog like a cast costume, "hareket" with the line that moves them — never one character standing in for many — CROWDS`];
  });
}

/** Who a group's crowd is dressed like: the cast member it names ("pirate"), for soldiers anyone dressed or titled as one. */
function sourceFor(cast: readonly CastEntry[], g: ToldGroup): CastEntry | undefined {
  const drawn = cast.filter((c) => c.gorunur && c.kostum);
  const named = drawn.find((c) => `${c.id} ${c.ad} ${c.rol}`.toLocaleLowerCase("tr-TR").includes(g.stem.toLocaleLowerCase("tr-TR")));
  if (named || !g.soldiers) return named;
  return drawn.find((c) => SOLDIER_WORDS.test(`${c.ad} ${c.rol}`)) ?? drawn.find((c) => SOLDIER_GARMENTS.has(c.kostum!.giysi));
}

/** A named character's costume as a crowd's: their face and what they hold or wear as a person stay theirs. */
function crowdCostume(k: CastCostume): CastCostume {
  const out: Record<string, unknown> = { ...k };
  for (const f of ["yuz", "el_on", "el_arka", "gogus"]) delete out[f];
  return out as unknown as CastCostume;
}

/**
 * Soldiers no cast member dresses: the commander's men — the drawn character their sentence names (else the first
 * drawn one) — in armour (a uniform from 1700 on) in the commander's colours, the helmet ordered from the wardrobe,
 * whose designer draws it for the period ("helmet of Julius Caesar's soldiers (75 BC)").
 */
function soldiersOf(cast: readonly CastEntry[], g: ToldGroup, donem: string): { from: CastEntry; kostum: CastCostume } | undefined {
  const drawn = cast.filter((c) => c.gorunur && c.kostum);
  const lower = g.sentence.toLocaleLowerCase("en-US");
  const commander = drawn.find((c) => c.ad.toLocaleLowerCase("en-US").split(/[^\p{L}]+/u).some((w) => w.length >= 3 && lower.includes(w))) ?? drawn[0];
  if (!commander) return undefined;
  const k = commander.kostum!;
  const modern = (periodEndYear(donem) ?? 0) >= 1700;
  const helmet = `yeni:helmet of ${commander.ad}'s soldiers (${donem})`;
  return {
    from: commander,
    kostum: { giysi: modern ? "uniforma" : "zirh", renkler: { ana: k.renkler.ana, ikincil: k.renkler.ikincil, ic: k.renkler.ic, sus: "#8c8c8c" }, ...(helmet.length <= 85 ? { bas: helmet } : {}), ayakkabi: k.ayakkabi },
  };
}

const MOVES: readonly [RegExp, NonNullable<SceneCrowd["hareket"]>["tur"]][] = [
  [/\bcharg|\battack|\bstorm|\bassault|\bsald[ıi]r|\bhücum/iu, "hucum"],
  [/\bfled\b|\bflee|\bran away|\brout|\bkaçt|\bkaçış/iu, "kac"],
  [/\bmarch|\bcame back|\breturn|\barriv|\badvanc|\byürü|\bgeri döndü|\bgeldi/iu, "yuru"],
];
/** A group a sentence tells as caught or beaten stands scared. */
const CAUGHT = /\bcaptur|\bcaught|\bseiz|\barrest|\bdefeat|\bcrucif|\byakala|\besir al|\byendi/iu;

/**
 * The last resort after the repair rounds: each told group still not shown gets a crowd dressed like the cast member it
 * names (soldiers like a soldier of the cast, else as their commander's men). The sentence's move (a march, a charge, a
 * flight) goes to the group it names first; a group it tells as caught stands scared. Logged as fixes; crowds that
 * would break the episode are not added.
 */
export function addToldCrowds(episode: Episode, shorts = false): { episode: Episode; fixes: string[] } {
  const fixes: string[] = [];
  const count = shorts ? 5 : 8;
  const sahneler = episode.sahneler.map((s) => {
    const missing = missingCrowds(episode, s, shorts);
    if (!missing.length) return s;
    const added: SceneCrowd[] = [];
    for (const g of missing) {
      const named = sourceFor(episode.oyuncu_kadrosu, g);
      const dressed = named ? { from: named, kostum: crowdCostume(named.kostum!) } : g.soldiers ? soldiersOf(episode.oyuncu_kadrosu, g, episode.donem) : undefined;
      if (!dressed) {
        fixes.push(`${s.id}: "${g.word}" anlatılıyor ama kalabalığı giydirecek oyuncu yok; kalabalık eklenemedi`);
        continue;
      }
      // Caught when the sentence's capture comes before the group's word ("he captured the pirates"); then it does not move.
      const capture = CAUGHT.exec(g.sentence);
      const caught = capture !== null && capture.index < g.index;
      const move = g.first && !caught ? MOVES.find(([re]) => re.test(g.sentence))?.[1] : undefined;
      const side = missing.length > 1 ? (added.length % 2 === 0 ? "sol" : "sag") : "tum";
      added.push({
        ad: g.word.charAt(0).toLocaleUpperCase("en-US") + g.word.slice(1),
        kostum_paketi: dressed.from.kostum_paketi,
        kostum: dressed.kostum,
        sayi: count,
        duzen: g.soldiers ? "ordu" : "sira",
        taraf: side,
        ruh_hali: move === "kac" || caught ? "korkmus" : move === "hucum" ? "coskulu" : "notr",
        ...(move ? { hareket: { tur: move, satir: g.line } } : {}),
      });
      fixes.push(`${s.id}: "${g.word}" anlatılıyor — ${named ? `${named.ad} gibi giyinmiş` : `${dressed.from.ad}'in askerleri olarak`} ${count} kişilik kalabalık eklendi${move ? ` (${move}, satır ${g.line})` : caught ? " (yakalanmış, korkmuş)" : ""}`);
    }
    return added.length ? { ...s, kalabalik: [...(s.kalabalik ?? []), ...added] } : s;
  });
  if (!sahneler.some((s, i) => s !== episode.sahneler[i])) return { episode, fixes };
  const next = { ...episode, sahneler };
  if (!validateEpisode(next).ok) return { episode, fixes: [...fixes.filter((x) => x.includes("eklenemedi")), "kalabalıklar bölümü bozuyordu; eklenmedi"] };
  return { episode: next, fixes };
}
