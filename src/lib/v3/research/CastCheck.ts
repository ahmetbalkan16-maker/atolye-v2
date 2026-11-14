import type { Episode } from "../episode/EpisodeTypes";
import { normalizeForMatch } from "./SourceResearch";

/**
 * Invented people in a script about real history (owner, 11 Nov 2026, the Taranto Short: "beyinler yetersiz olduğu
 * yerde devreye gir, hallet ve beyinlere aktar"). The writer gave the Italian side "Admiral Luigi de Pignati" — no such
 * person, `portre.wiki` named an article that does not exist — and a "Lt. Bill Jenkins" pilot, while the sources named
 * the real leader (Kenneth Williamson) and the fleet's commander was Inigo Campioni. The fact check looked at one claim
 * and passed both. Two checks, both from the cast alone:
 * - a character called real (`portre.wiki`) whose Wikipedia article is missing, or is about someone else;
 * - an invented character (no `portre`) given a rank and a personal surname, which a viewer takes for a real officer.
 * Either stops the script at the history gate (V3_SCRIPT_HISTORY) and the next draft is told why.
 */

/** What a Wikipedia title resolves to: its article, "missing", or "error" (offline, rate-limited — never a verdict). */
export type ArticleLookup = (title: string) => Promise<{ readonly title: string; readonly text: string } | "missing" | "error">;

/** Ranks and titles a person's name may carry (English and Turkish). */
const TITLE = /^(?:adm(?:iral)?|vice[- ]?admiral|rear[- ]?admiral|amiral|gen(?:eral)?|lt|lieut(?:enant)?|capt(?:ain)?|cdr|commander|col(?:onel)?|maj(?:or)?|sgt|sergeant|cpl|corporal|pvt|private|ensign|commodore|marshal|field|sir|lord|lady|pasha|paşa|bey|consul|senator|tribune|centurion|yüzbaşı|teğmen|binbaşı|albay|kaptan|reis)\.?$/iu;

/** Words that make a name a role, not a person: kinds of people and of units (an "Italian gunner" is fine). */
const ROLE = /^(?:(?:pilot|sailor|soldier|gunner|crewman|officer|guard|sentry|lookout|messenger|scout|spy|observer|chief|pirate|legion|legionary|knight|archer|rider|cavalryman|envoy|ambassador|priest|monk|merchant|farmer|villager|citizen|navy|army|armie|fleet|squadron|marine|troop|force|garrison|regiment|base|harbour|harbor)s?|infantry|cavalry|air|arm|the|of)$/iu;
/**
 * A nationality's shape ("Italian", "British", "Japanese", "Cilician"): a role word only right before a rank or a role
 * ("Italian Admiral", "Ottoman Pasha", "Cilician Pirate"). Until 14 Nov 2026 any such word was one — and given names
 * and surnames of the same shape (Ivan, Juan, Hassan, Khan, Morgan, Duncan, Eric, Logan) with it, so "Captain Ivan
 * Morgan", an invented officer, passed as a role.
 */
const NATION_LIKE = /^[a-zçğıöşü]+(?:an|ish|ese|ic)$/iu;

/** The words of a cast name with its titles taken off. */
function nameWords(ad: string): { titled: boolean; words: string[] } {
  const all = ad.split(/\s+/).filter(Boolean);
  let titled = false;
  const words = all.filter((w) => (TITLE.test(w) ? ((titled = true), false) : true));
  return { titled, words };
}

/** A name's personal words: capitalised, not a title, not a role, not a nationality before a rank or role. */
function personalWords(ad: string): string[] {
  const all = ad.split(/\s+/).filter(Boolean);
  return all.filter((w, i) => {
    if (TITLE.test(w) || ROLE.test(w) || !/^\p{Lu}/u.test(w)) return false;
    const next = all[i + 1];
    return !(NATION_LIKE.test(w) && next !== undefined && (TITLE.test(next) || ROLE.test(next)));
  });
}

/** The surname a real person's article must name: the last name word that is not a particle. */
function surnameOf(ad: string): string | undefined {
  const words = nameWords(ad).words.filter((w) => /^\p{Lu}/u.test(w));
  return words.at(-1);
}

/**
 * Whether the research's verified text names this person by their full name (titles off): the Siege of Baghdad Short
 * (13 Nov 2026) was stopped for "Bektash Khan", the Safavid commander the siege article names in three quoted facts,
 * because he has no article of his own — the next draft was told a real man was invented.
 */
function namedBySources(ad: string, sources: string): boolean {
  const words = personalWords(ad);
  if (!words.length || !sources) return false;
  return ` ${sources} `.includes(` ${lettersOnly(words.join(" "))} `);
}

/** Lower-case words split by anything but letters and digits ("Khan," and "Khan's" end the word "khan"). */
const lettersOnly = (s: string): string => normalizeForMatch(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The cast's invented-person problems, as reasons for the next draft (English, the writer's language). A lookup that
 * fails ("error") decides nothing: an offline Wikipedia never stops a production. `sources`: the research's verified
 * text (the source bank's facts and quotes); a person it names is real even without an article of their own.
 */
export async function inventedPeople(episode: Pick<Episode, "oyuncu_kadrosu">, lookup: ArticleLookup, sources = ""): Promise<string[]> {
  const out: string[] = [];
  const known = sources ? lettersOnly(sources) : "";
  for (const c of episode.oyuncu_kadrosu) {
    if (!c.gorunur) continue;
    const wiki = c.portre?.wiki?.trim();
    if (wiki) {
      const found = await lookup(wiki);
      if (found === "error") continue;
      const surname = surnameOf(c.ad);
      if (found === "missing") {
        if (namedBySources(c.ad, known)) continue;
        out.push(`"${c.ad}" is not a real person: there is no Wikipedia article "${wiki}". Give the lines to the real person the sources name for this role (look them up), or make the character an unnamed role ("an Italian admiral", no name and no "portre") — never invent a name for a real officer or ruler.`);
      } else if (surname && !normalizeForMatch(`${found.title} ${found.text.slice(0, 1500)}`).includes(normalizeForMatch(surname))) {
        out.push(`"${c.ad}" does not match the article given as their "portre" ("${found.title}" is about someone else): give the exact article of this real person, or make the character an unnamed role.`);
      }
      continue;
    }
    const { titled } = nameWords(c.ad);
    const personal = personalWords(c.ad);
    if (titled && personal.length >= 2 && !namedBySources(c.ad, known)) {
      out.push(`"${c.ad}" is an invented character with a rank and a full name, which viewers take for a real officer of this event: call them by their role ("Swordfish pilot", "Italian gunner") or a first name only, or use the real person the sources name (with "portre").`);
    }
  }
  return out;
}
