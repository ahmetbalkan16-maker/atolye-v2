import { cachedJson } from "../backgrounds/CommonsProvider";
import type { Episode, SceneMap } from "../episode/EpisodeTypes";

/**
 * Places checked against an independent source (owner, 21 Oct 2026: "our brains research it and place it exactly and
 * correctly"): the script writer gives every city and battle on a map from memory; here each name is looked up on
 * English Wikipedia (free, no key) with its article's coordinates. A point far from where Wikipedia puts that place is
 * moved there — and every badge, route, arrow or army point that stood on the old spot moves with it. A place
 * Wikipedia does not know stays as written. Works anywhere on Earth.
 */
export interface PlaceCandidate {
  readonly title: string;
  readonly lon: number;
  readonly lat: number;
}

export type PlaceLookup = (query: string) => Promise<PlaceCandidate[]>;

const WIKI = "https://en.wikipedia.org/w/api.php";
/** How far a written point may lie from Wikipedia's before it is moved, and the farthest a guess may jump. */
export const PLACE_TOLERANCE_KM = 40;
const NEAREST_MAX_KM = 600;

/** Wikipedia's best articles for a search that have a primary coordinate, in its relevance order. */
export function wikipediaPlaces(cacheDir: string): PlaceLookup {
  return async (query) => {
    const params = new URLSearchParams({ action: "query", format: "json", generator: "search", gsrsearch: query, gsrlimit: "5", gsrnamespace: "0", prop: "coordinates", coprimary: "primary" });
    const json = (await cachedJson(cacheDir, `${WIKI}?${params}`)) as { query?: { pages?: Record<string, { title: string; index?: number; coordinates?: { lat: number; lon: number }[] }> } };
    return Object.values(json.query?.pages ?? {})
      .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
      .flatMap((p) => (p.coordinates?.[0] ? [{ title: p.title, lon: p.coordinates[0].lon, lat: p.coordinates[0].lat }] : []));
  };
}

export function distanceKm(a: readonly [number, number], b: readonly [number, number]): number {
  const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r;
  const dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/^(battle|siege|sack|fall) of /, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Where a place really is: an article named like it (nearest such to the written point), else the nearest article
 * within NEAREST_MAX_KM; moved only when more than PLACE_TOLERANCE_KM away.
 */
export function decidePlace(name: string, at: readonly [number, number], candidates: readonly PlaceCandidate[]): { to: [number, number]; title: string; km: number } | undefined {
  const n = norm(name);
  const scored = candidates.map((c) => ({ c, km: distanceKm(at, [c.lon, c.lat]), named: norm(c.title) === n || norm(c.title).split(",")[0] === n }));
  const named = scored.filter((s) => s.named).sort((a, b) => a.km - b.km)[0];
  const pick = named ?? scored.filter((s) => s.km <= NEAREST_MAX_KM).sort((a, b) => a.km - b.km)[0];
  if (!pick || pick.km <= PLACE_TOLERANCE_KM) return undefined;
  return { to: [Math.round(pick.c.lon * 1000) / 1000, Math.round(pick.c.lat * 1000) / 1000], title: pick.c.title, km: Math.round(pick.km) };
}

export interface PlaceFix {
  readonly sahne: string;
  readonly ad: string;
  readonly tur: "sehir" | "savas";
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly kaynak: string;
  readonly km: number;
}

const same = (a: readonly [number, number], b: readonly [number, number]) => distanceKm(a, b) < 2;

/** One scene's map with its cities and battles checked; points on a moved place move with it. */
export async function checkMapPlaces(sceneId: string, map: SceneMap, lookup: PlaceLookup): Promise<{ map: SceneMap; fixes: PlaceFix[]; unchecked: string[] }> {
  const fixes: PlaceFix[] = [];
  // Places whose lookup failed (no internet, Wikipedia down): reported, never taken for confirmed.
  const unchecked: string[] = [];
  const moves: { from: readonly [number, number]; to: [number, number] }[] = [];
  const ask = async (tur: PlaceFix["tur"], ad: string, konum: readonly [number, number]) => {
    // "Nicopolis 1396" is looked up as "Nicopolis"; a battle first as one ("Battle of …"), then as the bare place.
    const bare = ad.replace(/\s*\d{3,4}\s*(BC|AD)?\s*$/i, "").trim();
    const queries = tur === "savas" && !/^(battle|siege|sack|fall) of /i.test(bare) ? [`Battle of ${bare}`, bare] : [bare];
    for (const q of queries) {
      let candidates: PlaceCandidate[];
      try {
        candidates = await lookup(q);
      } catch {
        unchecked.push(ad);
        return konum;
      }
      const got = decidePlace(bare, konum, candidates);
      if (got) {
        fixes.push({ sahne: sceneId, ad, tur, from: konum, to: got.to, kaynak: `Wikipedia: ${got.title}`, km: got.km });
        moves.push({ from: konum, to: got.to });
        return got.to;
      }
      // Confirmed: an article of that name, or one right where the writer put it.
      if (candidates.some((c) => norm(c.title) === norm(bare) || distanceKm(konum, [c.lon, c.lat]) <= PLACE_TOLERANCE_KM)) return konum;
    }
    return konum;
  };
  const sehirler = [];
  for (const c of map.sehirler ?? []) sehirler.push({ ...c, konum: await ask("sehir", c.ad, c.konum) });
  const savaslar = [];
  for (const w of map.savaslar ?? []) savaslar.push({ ...w, konum: await ask("savas", w.ad, w.konum) });
  const moved = (p: readonly [number, number]): [number, number] => moves.find((m) => same(m.from, p))?.to ?? [p[0], p[1]];
  return {
    map: {
      ...map,
      ...(map.sehirler ? { sehirler } : {}),
      ...(map.savaslar ? { savaslar } : {}),
      ...(map.rozetler ? { rozetler: map.rozetler.map((r) => ({ ...r, konum: moved(r.konum), ...(r.yol ? { yol: r.yol.map(moved) } : {}) })) } : {}),
      ...(map.oklar ? { oklar: map.oklar.map((o) => ({ ...o, noktalar: o.noktalar.map(moved) })) } : {}),
      ...(map.ordular ? { ordular: map.ordular.map((a) => ({ ...a, konum: moved(a.konum) })) } : {}),
    },
    fixes,
    unchecked,
  };
}

/** Every map scene of an episode checked. */
export async function checkEpisodePlaces(episode: Episode, lookup: PlaceLookup): Promise<{ episode: Episode; fixes: PlaceFix[]; unchecked: string[] }> {
  const fixes: PlaceFix[] = [];
  const unchecked: string[] = [];
  const sahneler = [];
  for (const s of episode.sahneler) {
    if (!s.harita?.merkez) {
      sahneler.push(s);
      continue;
    }
    const r = await checkMapPlaces(s.id, s.harita, lookup);
    fixes.push(...r.fixes);
    unchecked.push(...r.unchecked);
    sahneler.push({ ...s, harita: r.map });
  }
  return { episode: { ...episode, sahneler }, fixes, unchecked: [...new Set(unchecked)] };
}
