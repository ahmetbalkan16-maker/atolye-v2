import { CLOSE_MAP_MAX_KM, type CastEntry, type EpisodeScene, type MapUnits } from "../episode/EpisodeTypes";

/**
 * Who speaks on a map and through what (owner, 23 Oct 2026, after the Belgrade trial: two full-size figures talking on
 * the close map hid the siege; the reference documentary's leaders speak from their portrait badges on the map). A
 * character with a badge on the map speaks through it — the portrait talks and the speech bubble rises from it — and is
 * not drawn on the stage. On the close battle map every visible speaker gets a badge: one the writer did not give stands
 * at the tokens of the speaker's side.
 */
export interface MapSpeakerPlan {
  /** Cast ids that speak through their badge on this map. */
  readonly badged: ReadonlySet<string>;
  /** Badges to add on a close map, at a side's tokens from the line the character first speaks. */
  readonly sideBadges: readonly SideBadge[];
  /** Close-map speakers with no badge and no side of theirs on the map: drawn on the stage as before. */
  readonly unplaced: readonly string[];
  /** The lines each badged speaker speaks (their badge stays in view for them). */
  readonly lines: ReadonlyMap<string, readonly number[]>;
}

/** `taraf`: index in the map's `birlikler`; `satir`: the character's first line in the scene; `satirlar`: all of them. */
export interface SideBadge {
  readonly karakter: string;
  readonly taraf: number;
  readonly satir: number;
  readonly satirlar: readonly number[];
}

const NONE: MapSpeakerPlan = { badged: new Set(), sideBadges: [], unplaced: [], lines: new Map() };

/** Words in a side's name that say nothing about who it is. */
const GENERIC = new Set(["the", "and", "army", "armies", "forces", "troops", "side", "empire", "kingdom", "republic", "state", "sultanate", "ordu", "ordusu", "devleti", "kuvvetleri", "imparatorlugu", "imparatorluğu"]);

/** A side's name as stems a role would contain ("Ottomans" → "ottoma", "Hungarians" → "hungar", "Bizans" → "bizan"). */
export function sideStems(taraf: string): string[] {
  return taraf
    .toLocaleLowerCase("en-US")
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 4 && !GENERIC.has(w))
    .map((w) => w.slice(0, Math.min(6, w.length - 1)));
}

function rgb(hex: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colours a writer gives a character and that character's side (Mehmed's #b3263a, the Ottomans' #c0392b). */
const SAME_COLOUR = 48;

function colourDistance(a: string, b: string): number {
  const x = rgb(a);
  const y = rgb(b);
  return x && y ? Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) : Infinity;
}

/**
 * A side's own unit to speak from: its center, else its first entry (a side may be several units — its wings, its
 * reserve — under one `taraf`).
 */
function sideUnit(sides: readonly MapUnits[], taraf: string): number {
  const own = sides.map((s, i) => ({ s, i })).filter((x) => x.s.taraf === taraf);
  return (own.find((x) => x.s.kanat === "merkez") ?? own[0])!.i;
}

/**
 * The unit a cast member stands with: the unit named after them ("Bayezid's wing", "Vuk Brankovic"), else their side's
 * by its name in their name or role, else by their colour.
 */
function sideByName(c: CastEntry, sides: readonly MapUnits[]): number | undefined {
  const text = `${c.ad} ${c.rol}`.toLocaleLowerCase("en-US");
  const own = sides.findIndex((s) => s.ad && sideStems(c.ad).some((st) => st.length >= 3 && s.ad!.toLocaleLowerCase("en-US").includes(st)));
  if (own >= 0) return own;
  const named = [...new Set(sides.filter((s) => sideStems(s.taraf).some((st) => text.includes(st))).map((s) => s.taraf))];
  if (named.length === 1) return sideUnit(sides, named[0]!);
  const near = sides.map((s, i) => ({ i, d: colourDistance(c.renk, s.renk) })).filter((s) => s.d <= SAME_COLOUR).sort((a, b) => a.d - b.d);
  return near[0] ? sideUnit(sides, sides[near[0].i]!.taraf) : undefined;
}

export function mapSpeakers(scene: EpisodeScene, cast: readonly CastEntry[]): MapSpeakerPlan {
  const h = scene.harita;
  if (!h?.merkez) return NONE;
  const byId = new Map(cast.filter((c) => c.gorunur).map((c) => [c.id, c]));
  const speakers = [...new Set(scene.satirlar.map((l) => l.karakter).filter((id) => byId.has(id)))];
  const given = new Set((h.rozetler ?? []).map((r) => r.karakter));
  const badged = new Set(speakers.filter((id) => given.has(id)));
  const close = h.genislik_km !== undefined && h.genislik_km <= CLOSE_MAP_MAX_KM;
  const rest = speakers.filter((id) => !badged.has(id));
  const linesOf = (id: string) => scene.satirlar.flatMap((l, i) => (l.karakter === id ? [i] : []));
  const lines = () => new Map([...badged].map((id) => [id, linesOf(id)] as const));
  if (!close || !rest.length) return { badged, sideBadges: [], unplaced: [], lines: lines() };
  const sides = h.birlikler ?? [];
  const sideOf = new Map<string, number>();
  for (const id of speakers) {
    const s = sideByName(byId.get(id)!, sides);
    if (s !== undefined) sideOf.set(id, s);
  }
  // Two sides and one of them already spoken for: the other speaker is the other side's (Belgrade: the Ottoman
  // sultan and "the defender of Belgrade").
  const unmatched = rest.filter((id) => !sideOf.has(id));
  const used = new Set([...sideOf.values()].map((i) => sides[i]!.taraf));
  const free = [...new Set(sides.map((s) => s.taraf))].filter((t) => !used.has(t));
  if (unmatched.length === 1 && free.length === 1) sideOf.set(unmatched[0]!, sideUnit(sides, free[0]!));
  const sideBadges: SideBadge[] = [];
  const unplaced: string[] = [];
  for (const id of rest) {
    const taraf = sideOf.get(id);
    if (taraf === undefined) {
      unplaced.push(id);
      continue;
    }
    badged.add(id);
    const satirlar = linesOf(id);
    sideBadges.push({ karakter: id, taraf, satir: satirlar[0]!, satirlar });
  }
  return { badged, sideBadges, unplaced, lines: lines() };
}
