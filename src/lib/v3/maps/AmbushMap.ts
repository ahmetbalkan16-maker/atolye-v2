import { CLOSE_MAP_MAX_KM, type EpisodeScene, type MapUnits, type SceneMap } from "../episode/EpisodeTypes";
import { writtenPoints } from "./LandUnits";

/**
 * An ambush's close map as the battle documentaries draw it (owner, 20 Nov 2026: the Lake Trasimene Short at the quality
 * of the most-viewed video on it, Historia Civilis' — its strength is one held close map read at a glance): the road the
 * victims march on, the ambushers hidden on the high ground beside it as their named units, the victims strung out along
 * the road as one long thin column, fog where the sources tell it. `ambushMapLacks` names what a writer's close map lacks
 * of it (the script's repair round asks for it), for any ambush anywhere; `fogLacks` asks a close map for the fog its
 * lines tell, and for a line telling the fog it draws. Pure.
 */

type Ll = readonly [number, number];
type Xy = [number, number];

/** Lines telling an ambush (English and Turkish stems): never "trap" alone, which any rout can be. */
const AMBUSH = /\b(?:ambush\w*|ambuscade\w*|(?:lay|lie|lies|lying|lain|laid|waited|waiting)\s+in\s+wait)\b|pusu|tuza(?:k|ğ)/iu;

/** Lines telling fog or mist (English and Turkish; "mist" not inside "mistake", Turkish "pus" not "pusu"). */
const FOG = /(?:^|[^\p{L}])(?:fogs?|foggy|fog-?bound|mists?|misty|haze|hazy|sis|sisli|siste|sisin|sisi|pus|puslu)(?!\p{L})/iu;

/** A close map: a centre and a width of at most CLOSE_MAP_MAX_KM. */
const isClose = (h: SceneMap | undefined): h is SceneMap & { merkez: Ll; genislik_km: number } => Boolean(h?.merkez && h.genislik_km !== undefined && h.genislik_km <= CLOSE_MAP_MAX_KM);

/** The words of a scene: its place and every line. */
const sceneText = (s: EpisodeScene) => `${s.mekan ?? ""} ${s.satirlar.map((l) => l.metin).join(" ")}`;

/** A scene that tells an ambush on a close map with two sides or more. */
export function isAmbushMap(s: EpisodeScene): boolean {
  return isClose(s.harita) && new Set((s.harita.birlikler ?? []).map((u) => u.taraf)).size >= 2 && AMBUSH.test(sceneText(s));
}

/** Whether a text tells fog or mist. */
export function toldFog(text: string): boolean {
  return FOG.test(text);
}

/** A local km plane round `ref`. */
function plane(ref: Ll) {
  const kx = 111.32 * Math.max(0.05, Math.cos((ref[1] * Math.PI) / 180));
  return (p: Ll): Xy => [(p[0] - ref[0]) * kx, (p[1] - ref[1]) * 110.57];
}

/** Where a point lies along a line (km from its start) and how far off it (km), in the plane. */
function onLine(line: readonly Xy[], p: Xy): { along: number; off: number } {
  let best = { along: 0, off: Infinity };
  let run = 0;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1]!, line[i]!];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const len = Math.hypot(dx, dy);
    const u = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len))) : 0;
    const off = Math.hypot(p[0] - (a[0] + dx * u), p[1] - (a[1] + dy * u));
    if (off < best.off) best = { along: run + len * u, off };
    run += len;
  }
  return best;
}

/** A unit's first formation (its lowest line). */
const firstStep = (u: MapUnits) => [...u.yerler].sort((a, b) => a.satir - b.satir)[0];

/**
 * What a writer's ambush close map lacks, as asks for the repair round: the road; the victims (the side losing the most
 * tokens) strung out ON it as a long column — their first formations spanning at least a third of the road in view or a
 * fifth of the map, all of it on the road; the ambushers as two or more named units. Empty for a map that is no ambush.
 */
export function ambushMapLacks(s: EpisodeScene): string[] {
  if (!isAmbushMap(s)) return [];
  const h = s.harita as SceneMap & { merkez: Ll; genislik_km: number };
  const out: string[] = [];
  const roads = (h.yollar ?? []).filter((r) => r.noktalar.length >= 2);
  if (!roads.length) out.push(`the road the victims march on ("yollar": [{"ad": "<its name>", "noktalar": its real course through the place, 3–8 points}])`);
  const units = h.birlikler ?? [];
  const sides = [...new Set(units.map((u) => u.taraf))];
  const lost = (t: string) => units.filter((u) => u.taraf === t).reduce((a, u) => a + u.yerler.reduce((b, y) => b + (y.kayip ?? 0), 0), 0);
  const P = plane(h.merkez);
  const road = roads.length ? [...roads].sort((a, b) => b.noktalar.length - a.noktalar.length)[0]!.noktalar.map(P) : undefined;
  const reach = Math.max(0.4, h.genislik_km * 0.03);
  // The victims: the side losing the most; with no losses written, the side standing nearest the road at first.
  const firstPts = (t: string) => units.filter((u) => u.taraf === t).flatMap((u) => ((y) => (y ? writtenPoints(y) : []))(firstStep(u)));
  const nearRoad = (t: string) => (road ? Math.min(Infinity, ...firstPts(t).map((p) => onLine(road, P(p)).off)) : Infinity);
  const victims = [...sides].sort((a, b) => lost(b) - lost(a) || nearRoad(a) - nearRoad(b))[0];
  if (road && victims) {
    const roadKm = onLine(road, road[road.length - 1]!).along || 1;
    const on = firstPts(victims).map((p) => onLine(road, P(p)));
    const span = on.length ? Math.max(...on.map((o) => o.along)) - Math.min(...on.map((o) => o.along)) : 0;
    const want = Math.min(roadKm / 3, h.genislik_km / 5);
    if (!on.length || on.some((o) => o.off > reach) || span < want)
      out.push(`the victims ("${victims}") strung out as one long thin column ON the road: their first formation a "cephe" along "yollar" from the column's head to its rear (3–6 points, about ${Math.round(want * 10) / 10} km or more), or its parts (vanguard, main body, rear) one after another on it`);
  }
  const ambushers = units.filter((u) => u.taraf !== victims);
  if (ambushers.filter((u) => u.ad).length < 2)
    out.push(`the ambushers as their named units hidden on the high ground beside the road (3–5 units, each "ad", "tur" and a first "cephe" along the slope above the road; one across the road at the column's head to block it, one closing its rear)`);
  return out;
}

/**
 * Fog as the lines tell it: a close map whose scene tells fog or mist (its place or a line) draws it ("sis"), and one
 * that draws it has a line in the episode telling it (fog only where the sources tell it, said so in the story).
 */
export function fogLacks(s: EpisodeScene, episodeText: string): string[] {
  const h = s.harita;
  if (!isClose(h)) return [];
  if (!h.sis && toldFog(sceneText(s))) return [`the fog its lines tell: "sis": {"satir": the line that tells it, "bitis_satir": the line it lifts (optional), "alan": [[lon, lat], …] a rough outline of the low ground it lies on — the valley, the shore (optional: the whole view)}`];
  if (h.sis && !toldFog(episodeText)) return [`a line telling the fog it draws ("sis"): fog only where the sources tell it — tell it in a narrator line ("a thick morning fog lay over the lake"), or drop "sis"`];
  return [];
}
