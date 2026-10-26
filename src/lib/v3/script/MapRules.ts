import { CLOSE_MAP_MAX_KM, type Episode, type SceneMap, type UnitFormation } from "../episode/EpisodeTypes";
import { periodEndYear } from "../episode/Period";
import { SNAPSHOT_YEARS } from "../maps/HistoricalBorders";
import { mapSpeakers } from "../maps/MapSpeakers";
import { distanceKm } from "../maps/PlaceCheck";

/** Lines telling a siege or walls (English and Turkish stems). */
const SIEGE = /\b(?:siege|besieg\w*|walls?|ramparts?|breach\w*|fortress|castle|citadel|gates?)\b|kuşat|sur(?:lar|u|ları)?\b|kale|hisar|gedik/iu;

/** A formation's middle. */
function formationAt(y: UnitFormation): [number, number] | undefined {
  if ("kume" in y) return [y.kume[0], y.kume[1]];
  if ("kusatma" in y) return [y.kusatma[0], y.kusatma[1]];
  if ("cephe" in y && y.cephe.length) return [y.cephe.reduce((a, p) => a + p[0], 0) / y.cephe.length, y.cephe.reduce((a, p) => a + p[1], 0) / y.cephe.length];
  return undefined;
}

/**
 * The close battle map's own rules (owner, 23 Oct 2026, after the 1453 benchmark): the armies are on it; on a line with
 * losses both sides stand close enough to meet (the defenders fell at the walls while the attackers waited 1.5 km off);
 * a story of a siege has its walls or castle.
 */
function closeMapProblems(s: Episode["sahneler"][number]): string[] {
  const h = s.harita!;
  const out: string[] = [];
  const sides = h.birlikler ?? [];
  // A fleet battle's close map may have only its ships (Belgrade's fourth trial: the Danube blockade broken).
  if (!sides.length && !(h.araclar?.length)) out.push(`close map "${s.id}" has no armies: give each side its "birlikler" tokens (fronts, clusters, a siege ring) and move them with the lines — CLOSE BATTLE MAP`);
  // Where each side stands on a line: its latest formation at or before it.
  const at = (u: (typeof sides)[number], line: number) => {
    const y = [...u.yerler].filter((f) => f.satir <= line).sort((a, b) => b.satir - a.satir)[0];
    return y ? formationAt(y) : undefined;
  };
  const meet = Math.max(0.8, h.genislik_km! * 0.08);
  for (const u of sides)
    for (const y of u.yerler) {
      if (!(y.kayip ?? 0)) continue;
      const here = formationAt(y);
      // A rout's losses fall as the side flees (Belgrade's fourth trial: the Ottomans lost two more on their way back to
      // camp): where it came from on that line counts as where the fight is.
      const from = at(u, y.satir - 1);
      const near = sides.filter((o) => o.taraf !== u.taraf).map((o) => at(o, y.satir)).filter((p): p is [number, number] => Boolean(p));
      if (here && near.length && near.every((p) => distanceKm(here, p) > meet && (!from || distanceKm(from, p) > meet))) out.push(`close map "${s.id}": "${u.taraf}" loses tokens on line ${y.satir} but no enemy stands within ${Math.round(meet * 10) / 10} km then: give the other side a formation on line ${y.satir} right against it (across a wall: attackers just outside, defenders just inside) — UNITS AND VEHICLES`);
    }
  // A siege told in the lines, set at a fortress (the Belgrade run's "Close map: Belgrade Fortress and battlefield"), or
  // with a castle standing on the map as a single building.
  const siege = SIEGE.test(s.mekan ?? "") || s.satirlar.some((l) => SIEGE.test(l.metin)) || (h.yapilar ?? []).some((b) => b.tur === "kale");
  if (!(h.surlar?.length) && siege) out.push(`close map "${s.id}" tells a siege or walls but draws none: give the walls ("surlar" with "noktalar" and "osm_ad") or the castle ("kale": {"merkez", "km"}), its gates and the breach on its line — CLOSE BATTLE MAP`);
  out.push(...tacticsProblems(s, siege));
  return out;
}

/** The kinds of troops a unit's name or strength label speaks of (English and Turkish stems). */
const KIND_WORDS: readonly RegExp[] = [
  /\b(?:infantry|foot(?:men|soldiers)?|janissar\w*|legion\w*|hoplites?|swords?men|men-at-arms)\b|piyade|yeniçeri/iu,
  /\b(?:cavalry|horse(?:men)?|knights?|riders?|sipahis?|hussars?|cuirassiers?|dragoons?|lancers?)\b|süvari|atlı/iu,
  /\b(?:archers?|bowmen|crossbow\w*)\b|okçu/iu,
  /\b(?:musket\w*|rifle\w*|arquebus\w*|fusiliers?)\b|tüfek/iu,
  /\b(?:artillery|cannons?|guns|batter(?:y|ies))\b|topçu/iu,
];

/**
 * The close battle's tactics (owner, 26 Oct 2026, after Kosovo: one block a side, "Janissaries, infantry, cavalry" on
 * it — "askerlerin ne asker olduğu belli olması lazım … taktik olması lazım"): on a field battle where the sides fight,
 * each side is its bodies of troops by kind, and one entry is never two kinds.
 */
function tacticsProblems(s: Episode["sahneler"][number], siege: boolean): string[] {
  const units = s.harita!.birlikler ?? [];
  const out: string[] = [];
  for (const [ui, u] of units.entries()) {
    const words = `${u.ad ?? ""} ${u.etiket ?? ""}`;
    const kinds = KIND_WORDS.filter((re) => re.test(words)).length;
    if (kinds >= 2) out.push(`close map "${s.id}": birlikler[${ui}] ("${words.trim()}") is several kinds of troops in one block: give each kind its own unit ("tur", "ad", "kanat") in the same "taraf", colour and emblem — UNITS AND VEHICLES`);
  }
  const fought = units.some((u) => u.yerler.some((y) => (y.kayip ?? 0) > 0));
  if (!fought || siege) return out;
  const sides = [...new Set(units.map((u) => u.taraf))];
  const lone = sides.filter((t) => units.filter((u) => u.taraf === t).length < 2);
  if (sides.length >= 2 && lone.length) out.push(`close map "${s.id}" is a field battle but ${lone.map((t) => `"${t}"`).join(" and ")} ${lone.length > 1 ? "are" : "is"} one block: split each side into its real order of battle — 3–5 units of one kind each ("tur"), each with "ad" and "kanat" (merkez, sol, sag, on, arka; coordinates only for the merkez), and tell every tactical step as a unit's "hareket" on its line (hucum/kusat with "hedef", ilerle, geri) — UNITS AND VEHICLES`);
  return out;
}

/** Lines telling a battle's decisive fight: the assault, the breach, the rout, a fleet broken (English and Turkish stems). */
const CLIMAX = /\b(?:storm(?:s|ed)?|breach(?:es|ed)?|assault(?:s|ed)?|charg(?:e|es|ed)|fl(?:ee|ees|ed)|rout(?:s|ed)?|retreat(?:s|ed)?|push(?:es|ed)? (?:them )?back|repuls(?:e|es|ed)|s[au]nk|smash(?:es|ed)?|overr[au]n|captur(?:e|es|ed)|surrender(?:s|ed)?)\b|hücum|saldır|kaçt|bozgun|püskürt|teslim|gedik/iu;

/** A battle or a siege named in a scene (English and Turkish stems). */
const BATTLE = /\b(?:battle|battlefield|siege|besieg\w*)\b|savaş(?:ı|ında)?\b|muharebe|kuşatma/iu;

/**
 * The battle itself on the close map (owner, 23 Oct 2026, after the Belgrade trial: the writer drew the armies on the
 * close map, then told the assault, the breach and the Ottoman flight in a character scene — no token ever fell). When
 * the story tells a fight and has a close map with armies, some line of a close map has losses.
 */
function climaxProblems(scenes: Episode["sahneler"]): string[] {
  const close = scenes.filter((s) => s.harita?.merkez && s.harita.genislik_km !== undefined && s.harita.genislik_km <= CLOSE_MAP_MAX_KM && (s.harita.birlikler?.length ?? 0) > 0);
  const told = scenes.flatMap((s) => s.satirlar.map((l, i) => ({ s, i, l }))).filter(({ l }) => CLIMAX.test(l.metin));
  // A battle the story tells (its decisive fight, or a battle marked on a map) with no close map at all (the first AYAS
  // trial of 23 Oct 2026: three still regional maps and six character scenes, not one token on a battlefield).
  const battle = scenes.find((s) => (s.harita?.savaslar?.length ?? 0) > 0 || BATTLE.test(`${s.mekan ?? ""} ${s.satirlar.map((l) => l.metin).join(" ")}`));
  if (!close.length) return battle && told.length ? [`the story tells a battle ("${told[0]!.l.metin.slice(0, 60)}") but no close battle map shows it: give the battlefield its own close map ("genislik_km" 6–40) with both armies' "birlikler" (kinds "tur", fronts "hatlar"), the commander's plan as "oklar" with "stil": "plan", and the fight line by line with "kayip" and the beaten side's "bozgun" — CLOSE BATTLE MAP`] : [];
  const fought = (s: Episode["sahneler"][number]) => s.harita!.birlikler!.some((u) => u.yerler.some((y) => (y.kayip ?? 0) > 0)) || (s.harita!.araclar ?? []).some((a) => (a.kayip ?? 0) > 0);
  if (!told.length) return [];
  const off = (x: (typeof told)[number]) => ` — scene "${x.s.id}" line ${x.i} tells it off the map ("${x.l.metin.slice(0, 60)}")`;
  const fight = `on each fight line give both sides a formation side by side with "kayip" (tokens lost), the breach on its line ("surlar[].gedik"), the beaten side's tokens falling back, lost ships or guns with their "kayip" + "kayip_satir"; a character scene may come before (the council) or after (the reaction), never instead — CLOSE BATTLE MAP`;
  if (!close.some(fought)) {
    const away = told.find(({ s }) => !close.includes(s));
    return [`the battle's climax is never seen on the close map "${close[0]!.id}"${away ? off(away) : ""}: tell the assault, the breach and the rout ON the close map, line by line — ${fight}`];
  }
  // The assault on the walls told in a character scene while no close map shows the walls fought over (Belgrade's
  // second trial: the close map showed the Danube battle, the storming of the walls was told in "Belgrade walls").
  const assault = told.find(({ s, l }) => !s.harita?.merkez && SIEGE.test(l.metin));
  const walls = close.some((s) => (s.harita!.surlar?.length ?? 0) > 0 && (fought(s) || s.harita!.surlar!.some((w) => w.gedik)));
  return assault && !walls ? [`the assault on the walls is never seen on a close map${off(assault)}: give a close map of the walls ("surlar" or the castle) and tell the assault there, line by line — ${fight}`] : [];
}

/**
 * A map drawn with the atlas of a year after the story (the Kosovo 1389 trial: the 1400 atlas painted Serbia and the
 * Kosovo field Ottoman, so Lazar waited for the battle inside the Ottoman Empire — the map showed the result before
 * the battle). When the story tells a battle or a conquest, the writer is asked to draw the other side's state as it
 * was then (its own region wins its provinces over the atlas), or to use the atlas year before the story.
 */
function laterAtlasProblems(episode: Episode): string[] {
  const year = typeof episode.donem === "string" ? periodEndYear(episode.donem) : undefined;
  if (year === undefined) return [];
  const before = [...SNAPSHOT_YEARS].reverse().find((y) => y <= year);
  const fights = episode.sahneler.some((s) => s.satirlar.some((l) => CLIMAX.test(l.metin) || MOVES.test(l.metin)) || BATTLE.test(s.mekan ?? ""));
  if (!fights) return [];
  return episode.sahneler.flatMap((s) => {
    const later = (s.harita?.bolgeler ?? []).find((b) => b.tarihi && b.tarihi.yil > year);
    if (!later) return [];
    const others = (s.harita?.bolgeler ?? []).filter((b) => b !== later && !b.tarihi?.yil);
    return others.length
      ? []
      : [`map scene "${s.id}" uses the atlas of ${later.tarihi!.yil} for "${later.ad}", after the story (${year}): it may already show what the story changes (a conquest, a battle's outcome). Give the other side's state as it was in ${year} as its own region with "noktalar" (a rough outline; it takes its provinces over the atlas)${before !== undefined ? `, or use the atlas of ${before} and draw the gains since` : ""} — MAPS`];
  });
}

/** Close-map speakers the studio cannot seat on the map (no badge, no side of theirs among the tokens). */
function unplacedSpeakers(episode: Episode): string[] {
  const out: string[] = [];
  for (const s of episode.sahneler) {
    if (!s.harita?.merkez || s.harita.genislik_km === undefined || s.harita.genislik_km > CLOSE_MAP_MAX_KM) continue;
    for (const id of mapSpeakers(s, episode.oyuncu_kadrosu).unplaced) out.push(`close map "${s.id}": "${id}" speaks on the map but has no badge there and no side among the tokens: give them a "rozetler" entry where they stand (their army, their tent, the walls) from their first line — they speak from the badge, the battle stays in view`);
  }
  return out;
}

/** Something happens on the map: a camera move, a route, a march, a battle, tokens moving or falling, a border change. */
function mapLives(h: SceneMap): boolean {
  return (
    (h.kamera?.length ?? 0) > 0 ||
    (h.oklar?.length ?? 0) > 0 ||
    (h.savaslar?.length ?? 0) > 0 ||
    (h.rozetler ?? []).some((r) => (r.yol?.length ?? 0) > 0) ||
    (h.ordular ?? []).some((o) => (o.yol?.length ?? 0) > 0) ||
    (h.cizgiler ?? []).some((c) => (c.satir ?? 0) > 0) ||
    (h.birlikler ?? []).some((u) => u.yerler.length > 1 || u.yerler.some((y) => (y.kayip ?? 0) > 0)) ||
    (h.araclar ?? []).some((a) => (a.yol?.length ?? 0) > 0 || a.hedef !== undefined || (a.kayip ?? 0) > 0) ||
    (h.surlar ?? []).some((w) => w.gedik !== undefined) ||
    (h.bolgeler ?? []).some((b) => (b.satir ?? 0) > 0 || b.bitis_satir !== undefined || b.yayilma !== undefined)
  );
}

/**
 * The owner's shares for a long video (23 Oct 2026, after DFT Tarih): ~75–80% map, ~15% stick figures, 6–10% period
 * pictures. Asked of each chapter of a long episode (two minutes or so): too much of it on the stage, or a mostly-map
 * chapter with no picture moment marked.
 */
export function shareProblems(episode: Episode): string[] {
  const scenes = Array.isArray(episode?.sahneler) ? episode.sahneler : [];
  const total = scenes.reduce((a, s) => a + (s.sure_hedef ?? 0), 0);
  if (total < 90) return [];
  const map = scenes.filter((s) => s.harita?.merkez);
  const onStage = total - map.reduce((a, s) => a + (s.sure_hedef ?? 0), 0);
  const out: string[] = [];
  if (onStage / total > 0.35) out.push(`character scenes take ${Math.round((onStage / total) * 100)}% of this part (aim ~15%): tell more of it on the map — the march, the camp, the battle line by line on the close map — and keep one short character scene for the council, the quarrel or the reaction — SHARES OF A LONG VIDEO`);
  if (map.length && !map.some((s) => s.ara_goruntu_satir !== undefined)) out.push(`no map scene marks "ara_goruntu_satir": give one map scene the line whose moment gets its period picture (and its "arka_plan_sorgusu" for that picture) — PERIOD IMAGES`);
  return out;
}

/**
 * The last resort for a map on which the writer left nothing happening after its repair rounds (Belgrade's fourth trial:
 * the outro's two states, still): the camera closes in on the scene's place — its first city or battle, else the map's
 * centre — over its second line (or its only one), so the picture moves with the words. Logged as a fix.
 */
export function livenStillMaps(episode: Episode): { episode: Episode; fixes: string[] } {
  const fixes: string[] = [];
  const sahneler = episode.sahneler.map((s) => {
    const h = s.harita;
    if (!h?.merkez || !h.genislik_km || mapLives(h)) return s;
    const target = h.savaslar?.[0]?.konum ?? h.sehirler?.[0]?.konum ?? h.merkez;
    const satir = Math.min(1, Math.max(0, s.satirlar.length - 1));
    fixes.push(`${s.id}: haritada hiçbir şey olmuyordu; kamera ${satir}. satırda yerine yaklaşır`);
    return { ...s, harita: { ...h, kamera: [{ satir, merkez: [target[0], target[1]] as [number, number], genislik_km: Math.round(h.genislik_km * 0.55) }] } };
  });
  return fixes.length ? { episode: { ...episode, sahneler }, fixes } : { episode, fixes };
}

/** A ruler's fall told in a line: killed, slain, captured, executed (English and Turkish stems). */
const FALL = /\b(?:killed|slain|dies|died|dead|captured|assassinated|executed|beheaded|murdered|falls in battle|fell in battle)\b|öldü|öldürül|şehit|esir düş|idam/iu;
/** A side breaking: collapses, flees, routed (English and Turkish stems). */
const ROUT = /\b(?:collaps(?:e|es|ed)|fl(?:ee|ees|ed)|rout(?:s|ed)?|breaks?|broke|scatter(?:s|ed)?|retreat(?:s|ed)?|withdr[ae]w(?:s|n)?|runs? away)\b|bozgun|kaçt|kaçış|dağıl|geri çekil/iu;
/** A side going forward: charges, attacks, counterattacks, storms (English and Turkish stems). */
const ADVANCE = /\b(?:charg(?:e|es|ed)|attack(?:s|ed)?|counterattack(?:s|ed)?|counter-attack(?:s|ed)?|assault(?:s|ed)?|advanc(?:e|es|ed)|push(?:es|ed)?|storm(?:s|ed)?|smash(?:es|ed)?)\b|hücum|saldır|ilerle/iu;

/** The name a line uses for a cast member: their first name word (≥ 3 letters, titles skipped). */
function nameWord(ad: string): string | undefined {
  return ad.split(/[^\p{L}]+/u).find((w) => w.length >= 3 && !/^(sultan|prince|king|emperor|tsar|czar|khan|lord|sir|general|admiral|duke|count|pope|saint|the)$/i.test(w));
}

const mentions = (text: string, word: string | undefined) => !!word && new RegExp(`(^|[^\\p{L}])${word}`, "iu").test(text);

/** A death told (not a capture: a captured ruler is led away, not struck down). */
const KILLED = /\b(?:killed|slain|dies|died|dead|assassinated|executed|beheaded|murdered|stabbed to death|falls in battle|fell in battle)\b|öldü|öldürül|şehit|idam/iu;
/** Words before it that keep the death from having happened ("would be killed", "tries to kill", "nearly died"). */
const NOT_YET = /\b(?:will|would|could|might|may|nearly|almost|tries|tried|try|plans?|planned|plots?|plotted|if|unless)\b/iu;
/** Turkish says it on the word itself: the future and "must" ("öldürülecek", "ölmeli"). */
const NOT_YET_SUFFIX = /ecek|acak|eceğ|acağ|meli|malı/iu;

/**
 * The words that tell a cast member killed in a line naming them (Kosovo 1389: "Murad I is assassinated"), with where
 * they stand in the text (0..1); undefined when the line does not name them or tells no death that has happened.
 */
export function toldKilled(text: string, ad: string): { word: string; at: number } | undefined {
  if (!mentions(text, nameWord(ad))) return undefined;
  const m = KILLED.exec(text);
  if (!m) return undefined;
  const whole = /^\p{L}+/u.exec(text.slice(m.index))?.[0] ?? m[0];
  if (NOT_YET.test(text.slice(0, m.index)) || NOT_YET_SUFFIX.test(whole)) return undefined;
  return { word: m[0], at: m.index / Math.max(1, text.length) };
}

/**
 * The director's pass over the battle maps (owner, 23 Oct 2026: "what you fixed by hand, our own brains must do"; the
 * Kosovo 1389 trial was directed by hand): on a close map a commander's badge appears with the line that first names
 * him; on any map a ruler a line tells killed or captured gets the red X on his badge from that line; on a close map a
 * side a line tells breaking ("collapses", "flees") routs on that line when its formation moves away from the enemy;
 * and a side a line tells charging gets an arrow from where it stood to where it goes, before the tokens move. Only what
 * the writer left out is filled in; every fix is logged.
 */
export function directBattleMaps(episode: Episode): { episode: Episode; fixes: string[] } {
  const fixes: string[] = [];
  const cast = new Map(episode.oyuncu_kadrosu.map((c) => [c.id, nameWord(c.ad)] as const));
  const sahneler = episode.sahneler.map((s) => {
    const h = s.harita;
    if (!h?.merkez || !h.genislik_km) return s;
    const close = h.genislik_km <= CLOSE_MAP_MAX_KM;
    const said = (id: string, i: number) => s.satirlar[i]!.karakter === id || mentions(s.satirlar[i]!.metin, cast.get(id));
    const rozetler = (h.rozetler ?? []).map((r) => {
      let out = r;
      // On the close map the commander shows up when the narrator first names him (not all at once at the start).
      if (close && !r.yol?.length && (r.satir ?? 0) === 0 && !said(r.karakter, 0)) {
        const first = s.satirlar.findIndex((_, i) => said(r.karakter, i));
        if (first > 0) {
          out = { ...out, satir: first };
          fixes.push(`${s.id}: ${r.karakter} rozeti ${first}. satırda (anıldığı yerde) belirir`);
        }
      }
      if (out.x_satir === undefined) {
        const fall = s.satirlar.findIndex((l, i) => i >= (out.satir ?? 0) && l.karakter !== r.karakter && mentions(l.metin, cast.get(r.karakter)) && FALL.test(l.metin));
        if (fall >= 0) {
          out = { ...out, x_satir: fall };
          fixes.push(`${s.id}: ${r.karakter} ${fall}. satırda düşer — rozetine X`);
        }
      }
      return out;
    });
    let birlikler = h.birlikler;
    const oklar = [...(h.oklar ?? [])];
    if (close && (h.birlikler?.length ?? 0) >= 2) {
      const sides = h.birlikler!;
      const stems = sides.map((u) => (u.taraf.toLocaleLowerCase("en-US").split(/[^\p{L}]+/u).find((w) => w.length >= 4 && !/^(army|forces?|troops|coalition|league|the)$/.test(w)) ?? "").slice(0, 5));
      // The sides a line names, the subject (named first: "the Serbian cavalry charges into the Ottoman lines") first.
      const named = (i: number) => {
        const text = s.satirlar[i]!.metin.toLocaleLowerCase("en-US");
        return stems.filter((st) => st && mentions(text, st)).sort((a, b) => text.search(new RegExp(`(^|[^\\p{L}])${a}`, "u")) - text.search(new RegExp(`(^|[^\\p{L}])${b}`, "u")));
      };
      const at = (u: (typeof sides)[number], line: number, strict = false) => [...u.yerler].filter((y) => (strict ? y.satir < line : y.satir <= line)).sort((a, b) => b.satir - a.satir)[0];
      const enemy = (ui: number, line: number) => {
        const pts = sides.flatMap((o) => (o.taraf === sides[ui]!.taraf ? [] : [at(o, line)].flatMap((y) => (y ? [formationAt(y)].filter((p): p is [number, number] => !!p) : []))));
        return pts.length ? ([pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length] as [number, number]) : undefined;
      };
      const step = Math.max(0.25, h.genislik_km * 0.02);
      birlikler = sides.map((u, ui) => {
        const yerler = u.yerler.map((y) => {
          if (y.bozgun !== undefined || !ROUT.test(s.satirlar[y.satir]?.metin ?? "")) return y;
          const n = named(y.satir);
          if (n.length && !n.includes(stems[ui]!)) return y;
          const before = at(u, y.satir, true);
          const e = enemy(ui, y.satir);
          const [p0, p1] = [before ? formationAt(before) : undefined, formationAt(y)];
          if (!p0 || !p1 || !e || distanceKm(p1, e) <= distanceKm(p0, e) + step) return y;
          fixes.push(`${s.id}: ${u.taraf} ${y.satir}. satırda bozguna uğrar (dağılarak kaçar)`);
          return { ...y, bozgun: true };
        });
        return { ...u, yerler };
      });
      // A unit's charge or sweep (Tactics) is drawn as it goes, in its colour: the tactics read on the map as the narrator
      // tells them (owner, 26 Oct 2026: "taktiği daha net gösteriyorlar"). Its name shows at the unit itself while it
      // moves (the arrow's own label was pushed far off by a crowded field: "VUK BRANKOVIC" stood away from his arrow).
      for (const u of birlikler)
        for (const y of u.yerler) {
          if ((y.hareket !== "hucum" && y.hareket !== "kusat") || !y.satir) continue;
          const before = at(u, y.satir, true);
          const [p0, p1] = [before ? formationAt(before) : undefined, formationAt(y)];
          if (!p0 || !p1 || distanceKm(p0, p1) < step) continue;
          const drawn = oklar.some((o) => o.satir === y.satir && o.renk === u.renk && distanceKm(o.noktalar[o.noktalar.length - 1]! as [number, number], p1) < Math.max(step, distanceKm(p0, p1) * 0.3));
          if (drawn) continue;
          const way: [number, number][] = y.uzerinden ? [p0, [y.uzerinden[0], y.uzerinden[1]], p1] : [p0, p1];
          // A little short at both ends (the tokens stay readable).
          const first = way[1]!;
          const last = way[way.length - 2]!;
          way[0] = [p0[0] + (first[0] - p0[0]) * 0.12, p0[1] + (first[1] - p0[1]) * 0.12];
          way[way.length - 1] = [p1[0] + (last[0] - p1[0]) * 0.12, p1[1] + (last[1] - p1[1]) * 0.12];
          oklar.push({ noktalar: way, renk: u.renk, satir: y.satir, ...(y.satir + 1 < s.satirlar.length ? { bitis_satir: y.satir + 1 } : {}) });
          fixes.push(`${s.id}: ${u.ad ?? u.taraf} ${y.satir}. satırda ${y.hareket === "kusat" ? "kanadı dolaşır" : "hücum eder"} — hareket oku`);
        }
      s.satirlar.forEach((l, li) => {
        if (!ADVANCE.test(l.metin) || oklar.some((o) => o.satir === li)) return;
        const n = named(li);
        sides.forEach((u, ui) => {
          // Only the subject charges; with no side named, a two-side battle's mover is found by its movement. A unit
          // moved by its tactics ("hareket") has its own arrow on its move's line.
          if (u.kanat || u.yerler.some((y) => y.hareket)) return;
          if (n.length ? n[0] !== stems[ui] : sides.length !== 2) return;
          const prev = at(u, li, true) ?? at(u, li);
          const next = [...u.yerler].filter((y) => y.satir >= li && y !== prev).sort((a, b) => a.satir - b.satir)[0];
          const e = enemy(ui, li);
          const [p0, p1] = [prev ? formationAt(prev) : undefined, next ? formationAt(next) : undefined];
          if (!p0 || !p1 || !e || distanceKm(p0, e) - distanceKm(p1, e) < step) return;
          // From where they stand toward where they go, a little short at both ends (the tokens stay readable).
          const from: [number, number] = [p0[0] + (p1[0] - p0[0]) * 0.1, p0[1] + (p1[1] - p0[1]) * 0.1];
          const to: [number, number] = [p0[0] + (p1[0] - p0[0]) * 0.9, p0[1] + (p1[1] - p0[1]) * 0.9];
          oklar.push({ noktalar: [from, to], renk: u.renk, satir: li, ...(li + 1 < s.satirlar.length ? { bitis_satir: Math.min(s.satirlar.length - 1, Math.max(li + 1, next!.satir + 1)) } : {}) });
          fixes.push(`${s.id}: ${u.taraf} ${li}. satırda hücum eder — hareket oku`);
        });
      });
    }
    const changed = rozetler.some((r, i) => r !== h.rozetler?.[i]) || birlikler !== h.birlikler || oklar.length !== (h.oklar?.length ?? 0);
    return changed ? { ...s, harita: { ...h, ...(h.rozetler ? { rozetler } : {}), ...(birlikler ? { birlikler } : {}), ...(oklar.length ? { oklar } : {}) } } : s;
  });
  return fixes.length ? { episode: { ...episode, sahneler }, fixes } : { episode, fixes };
}

// English words by word boundary; Turkish stems without one (\b does not see "ü" as a letter: "yürüdü").
const MOVES = /\b(?:sail(?:s|ed)?|march(?:es|ed)?|invad(?:e|es|ed)|invasion|cross(?:es|ed)|fleet|armada|campaign|conquer(?:s|ed)?|voyage|expedition)\b|sefer|donanma|işgal|fethet|yürüd|denizi geç/iu;
/** Lines telling a crowd fighting, charging, fleeing or storming (English and Turkish stems). */
const ACTION = /\b(?:charg(?:e|es|ed)|attack(?:s|ed)?|storm(?:s|ed)?|fl(?:ee|ees|ed)|r[ua]n away|rout(?:s|ed)?|fell|falls|stormed|besieg(?:e|ed)|assault(?:s|ed)?|advanc(?:e|es|ed)|retreat(?:s|ed)?|climb(?:s|ed)?|crossing|descen(?:t|ds?|ded)|trek(?:s|ked)?|wad(?:e|es|ed))\b|hücum|saldır|kaçt|kaçış|düştü|kuşat|ilerled|geri çekil|tırman|geçiş|iniş/iu;

/**
 * The owner's way of telling (21 Oct 2026): what moves between places is told on the living map. As repair problems:
 * a scene placed on a map without a "harita" (the Mongol test named its outro "Map of East Asia" and drew a set); a map
 * on which nothing happens; a story that sails, marches or invades between places without any map showing the route
 * (the Mongol fleet's crossing was told only on a beach).
 */
export function mapProblems(episode: unknown): string[] {
  if (!episode || typeof episode !== "object" || !Array.isArray((episode as Episode).sahneler)) return [];
  const scenes = (episode as Episode).sahneler;
  const out: string[] = [];
  for (const s of scenes) {
    const h = s.harita;
    if (!h?.merkez && /\b(map|harita)\b/i.test(s.mekan ?? "")) out.push(`scene "${s.id}" is set on a map ("mekan": "${s.mekan}") but has no "harita": give it one (merkez, genislik_km, and what moves on it — MAP NARRATION)`);
    if (h?.merkez) {
      if (!mapLives(h)) out.push(`map scene "${s.id}" shows nothing happening: march an army ("ordular" with "yol" and "yol_satir"), sweep a conquest ("yayilma"), draw a route (oklar, or a rozet with "yol"), move the tokens ("birlikler" with formations on later lines), a battle, a camera move or a border change, each on the line that tells it`);
      if (h.genislik_km !== undefined && h.genislik_km <= CLOSE_MAP_MAX_KM) out.push(...closeMapProblems(s));
    }
  }
  // Every character scene lives in its drawn set (owner, 22 Oct 2026: "the viewer must live the moment"); a scene that
  // is only a one-word card over black needs none.
  const cardOnly = (s: Episode["sahneler"][number]) => (s.yazi_karti ?? []).some((c) => c.stil === "kelime") && s.satirlar.every((l) => l.karakter === "anlatici") && !(s.sahne_duzeni?.length);
  for (const s of scenes) if (!s.harita?.merkez && !s.ortam && !cardOnly(s)) out.push(`character scene "${s.id}" has no "ortam": give it its living set (zaman, manzara, uslup, hava, isik) — LIVING SETS / ORTAM`);
  // A crowd that stands still while its march, charge or flight is told (the Hannibal test, 22 Oct 2026: Saguntum fell
  // and the Alps were crossed by an army standing in rows).
  for (const s of scenes) {
    const crowd = s.kalabalik ?? [];
    if (!crowd.length || crowd.some((g) => g.hareket) || s.harita?.merkez) continue;
    const told = s.satirlar.findIndex((l) => MOVES.test(l.metin) || ACTION.test(l.metin));
    if (told >= 0) out.push(`scene "${s.id}": line ${told} tells the crowd moving or fighting ("${s.satirlar[told]!.metin.slice(0, 60)}") but "${crowd[0]!.ad}" stands still: give it "hareket" {"tur": "yuru" | "kos" | "hucum" | "kac", "satir": ${told}} — CROWDS`);
  }
  const routes = scenes.some((s) => (s.harita?.oklar?.length ?? 0) > 0 || (s.harita?.rozetler ?? []).some((r) => (r.yol?.length ?? 0) > 0) || (s.harita?.ordular ?? []).some((o) => (o.yol?.length ?? 0) > 0));
  const moving = scenes.flatMap((s) => s.satirlar).filter((l) => MOVES.test(l.metin)).length;
  if (!routes && moving >= 2) out.push(`the story moves between places (${moving} lines tell a voyage, march, crossing or invasion) but no map shows the route: tell each crossing or campaign on a map scene with its route drawn (oklar, or a rozet with "yol" + "yol_satir") — SCENE KIND BY SCALE`);
  out.push(...climaxProblems(scenes));
  out.push(...laterAtlasProblems(episode as Episode));
  if (Array.isArray((episode as Episode).oyuncu_kadrosu)) out.push(...unplacedSpeakers(episode as Episode));
  return out;
}
