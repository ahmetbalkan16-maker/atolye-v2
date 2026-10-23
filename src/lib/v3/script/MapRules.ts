import { CLOSE_MAP_MAX_KM, type Episode, type UnitFormation } from "../episode/EpisodeTypes";
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
  if (!sides.length) out.push(`close map "${s.id}" has no armies: give each side its "birlikler" tokens (fronts, clusters, a siege ring) and move them with the lines — CLOSE BATTLE MAP`);
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
      const near = sides.filter((o) => o !== u).map((o) => at(o, y.satir)).filter((p): p is [number, number] => Boolean(p));
      if (here && near.length && near.every((p) => distanceKm(here, p) > meet)) out.push(`close map "${s.id}": "${u.taraf}" loses tokens on line ${y.satir} but no enemy stands within ${Math.round(meet * 10) / 10} km then: give the other side a formation on line ${y.satir} right against it (across a wall: attackers just outside, defenders just inside) — UNITS AND VEHICLES`);
    }
  // A siege told in the lines, set at a fortress (the Belgrade run's "Close map: Belgrade Fortress and battlefield"), or
  // with a castle standing on the map as a single building.
  const siege = SIEGE.test(s.mekan ?? "") || s.satirlar.some((l) => SIEGE.test(l.metin)) || (h.yapilar ?? []).some((b) => b.tur === "kale");
  if (!(h.surlar?.length) && siege) out.push(`close map "${s.id}" tells a siege or walls but draws none: give the walls ("surlar" with "noktalar" and "osm_ad") or the castle ("kale": {"merkez", "km"}), its gates and the breach on its line — CLOSE BATTLE MAP`);
  return out;
}

/** Lines telling a battle's decisive fight: the assault, the breach, the rout, a fleet broken (English and Turkish stems). */
const CLIMAX = /\b(?:storm(?:s|ed)?|breach(?:es|ed)?|assault(?:s|ed)?|charg(?:e|es|ed)|fl(?:ee|ees|ed)|rout(?:s|ed)?|retreat(?:s|ed)?|push(?:es|ed)? (?:them )?back|repuls(?:e|es|ed)|s[au]nk|smash(?:es|ed)?|overr[au]n|captur(?:e|es|ed)|surrender(?:s|ed)?)\b|hücum|saldır|kaçt|bozgun|püskürt|teslim|gedik/iu;

/**
 * The battle itself on the close map (owner, 23 Oct 2026, after the Belgrade trial: the writer drew the armies on the
 * close map, then told the assault, the breach and the Ottoman flight in a character scene — no token ever fell). When
 * the story tells a fight and has a close map with armies, some line of a close map has losses.
 */
function climaxProblems(scenes: Episode["sahneler"]): string[] {
  const close = scenes.filter((s) => s.harita?.merkez && s.harita.genislik_km !== undefined && s.harita.genislik_km <= CLOSE_MAP_MAX_KM && (s.harita.birlikler?.length ?? 0) > 0);
  if (!close.length || close.some((s) => s.harita!.birlikler!.some((u) => u.yerler.some((y) => (y.kayip ?? 0) > 0)))) return [];
  const told = scenes.flatMap((s) => s.satirlar.map((l, i) => ({ s, i, l }))).filter(({ l }) => CLIMAX.test(l.metin));
  if (!told.length) return [];
  const away = told.find(({ s }) => !close.includes(s));
  const where = away ? ` — scene "${away.s.id}" line ${away.i} tells it off the map ("${away.l.metin.slice(0, 60)}")` : "";
  return [`the battle's climax is never seen on the close map "${close[0]!.id}"${where}: tell the assault, the breach and the rout ON the close map, line by line — on each fight line give both sides a formation side by side with "kayip" (tokens lost), the breach on its line ("surlar[].gedik"), the beaten side's tokens falling back; a character scene may come before (the council) or after (the reaction), never instead — CLOSE BATTLE MAP`];
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
      const living =
        (h.kamera?.length ?? 0) > 0 ||
        (h.oklar?.length ?? 0) > 0 ||
        (h.savaslar?.length ?? 0) > 0 ||
        (h.rozetler ?? []).some((r) => (r.yol?.length ?? 0) > 0) ||
        (h.ordular ?? []).some((o) => (o.yol?.length ?? 0) > 0) ||
        (h.cizgiler ?? []).some((c) => (c.satir ?? 0) > 0) ||
        (h.birlikler ?? []).some((u) => u.yerler.length > 1 || u.yerler.some((y) => (y.kayip ?? 0) > 0)) ||
        (h.araclar ?? []).some((a) => (a.yol?.length ?? 0) > 0 || a.hedef !== undefined) ||
        (h.surlar ?? []).some((w) => w.gedik !== undefined) ||
        (h.bolgeler ?? []).some((b) => (b.satir ?? 0) > 0 || b.bitis_satir !== undefined || b.yayilma !== undefined);
      if (!living) out.push(`map scene "${s.id}" shows nothing happening: march an army ("ordular" with "yol" and "yol_satir"), sweep a conquest ("yayilma"), draw a route (oklar, or a rozet with "yol"), move the tokens ("birlikler" with formations on later lines), a battle, a camera move or a border change, each on the line that tells it`);
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
  if (Array.isArray((episode as Episode).oyuncu_kadrosu)) out.push(...unplacedSpeakers(episode as Episode));
  return out;
}
