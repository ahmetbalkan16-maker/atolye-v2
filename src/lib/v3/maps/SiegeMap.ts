import { CLOSE_MAP_MAX_KM, type EpisodeScene, type MapUnits, type MapWall, type SceneMap, type UnitFormation } from "../episode/EpisodeTypes";
import { castleRing, kmBetween, lineKm, type Pt, resample } from "./CastleShapes";

/**
 * A siege's close map as the real siege looked (owner, 20 Nov 2026, after the Constantinople Short: "the close battle
 * scenes are very bad — the walls must stand in their real place …, no camp, no troop moves or tactics, no ships hauled,
 * no realism"). What was put in by hand that day (the patch `yama-konstantinopolis.ts`) as rules for any siege anywhere:
 * the besiegers' camp behind their lines, their siege line outside the whole wall with the defenders on it, the guns
 * aimed at the breach, the breach on the wall itself, the fleet and a haul over land where the story tells them.
 * `siegeMapLacks` and `shipLacks` name what a writer's close map lacks (the script's repair rounds ask for it);
 * `fillSiegeMap` puts in what the real wall lets the studio derive, once CloseSite has the wall's real trace. Pure.
 */

type Ll = readonly [number, number];
type Xy = [number, number];

const KY = 110.57;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** A local km plane round `ref` (enough for a close map's few kilometres). */
function plane(ref: Ll) {
  const kx = 111.32 * Math.max(0.05, Math.cos((ref[1] * Math.PI) / 180));
  return {
    to: (p: Ll): Xy => [(p[0] - ref[0]) * kx, (p[1] - ref[1]) * KY],
    from: (q: Xy): [number, number] => [r6(ref[0] + q[0] / kx), r6(ref[1] + q[1] / KY)],
  };
}

/** The nearest point of a line (plane km) to `p`: the point, the distance and the segment's unit direction there. */
function nearest(line: readonly Xy[], p: Xy): { at: Xy; km: number; dir: Xy } {
  let best = { at: line[0] ?? p, km: Infinity, dir: [1, 0] as Xy };
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1]!, line[i]!];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const len = Math.hypot(dx, dy);
    if (!len) continue;
    const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len)));
    const at: Xy = [a[0] + dx * u, a[1] + dy * u];
    const km = Math.hypot(p[0] - at[0], p[1] - at[1]);
    if (km < best.km) best = { at, km, dir: [dx / len, dy / len] };
  }
  return best;
}

function inRing(p: Ll, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const mean = (pts: readonly Ll[]): [number, number] => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];

/** A formation's middle. */
function centreOf(f: UnitFormation): Ll | undefined {
  if ("kume" in f) return f.kume;
  if ("kusatma" in f) return f.kusatma;
  return f.cephe.length ? mean(f.cephe) : undefined;
}

/** A unit's first formation (its lowest line). */
const firstStep = (u: MapUnits) => [...u.yerler].sort((a, b) => a.satir - b.satir)[0];

/** A close map: a centre and a width of at most CLOSE_MAP_MAX_KM. */
const isClose = (h: SceneMap | undefined): h is SceneMap & { merkez: Ll; genislik_km: number } => Boolean(h?.merkez && h.genislik_km !== undefined && h.genislik_km <= CLOSE_MAP_MAX_KM);

/** A close map's wall as a line: its points, or a castle's ring drawn round its centre. */
function wallLine(w: MapWall): { line: Pt[]; ring: boolean } | undefined {
  const pts = (w.noktalar ?? []).map((p): Pt => [p[0], p[1]]);
  if (pts.length >= 2) {
    const closed = pts.length > 3 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1];
    return { line: pts, ring: Boolean(w.kale) || closed };
  }
  return w.kale ? { line: castleRing(w.kale.merkez, w.kale.km, "halka"), ring: true } : undefined;
}

/** The map's main wall (the longest: a city's land wall before its sea walls and citadel). */
function mainWall(h: SceneMap): { wall: MapWall; line: Pt[]; ring: boolean } | undefined {
  return (h.surlar ?? [])
    .flatMap((wall) => ((l) => (l ? [{ wall, ...l }] : []))(wallLine(wall)))
    .sort((a, b) => lineKm(b.line) - lineKm(a.line))[0];
}

/** A siege's close map: walls (or a castle) and the armies or the guns before them. */
export function isSiegeMap(h: SceneMap | undefined): boolean {
  return isClose(h) && (h.surlar?.length ?? 0) > 0 && ((h.birlikler?.length ?? 0) > 0 || (h.araclar ?? []).some((a) => a.tur === "top")) && mainWall(h) !== undefined;
}

/** The place a siege map shows (its main wall's name, else its centre to ~5 km), so the first map of a place is known. */
export function siegePlaceKey(h: SceneMap): string {
  const w = mainWall(h)?.wall;
  const name = (w?.ad ?? w?.osm_ad ?? "").trim();
  return name || `${Math.round((h.merkez?.[0] ?? 0) * 20)}:${Math.round((h.merkez?.[1] ?? 0) * 20)}`;
}

/**
 * Which points stand inside the walls: inside a castle's ring; else on the side of the wall line where the walled town
 * stands (`sur_ici`) and away from the side of the guns (guns stand outside). Undefined when nothing tells, or the two
 * disagree (a town left on the wrong side of a moved wall: nothing is derived from it).
 */
function insideOf(h: SceneMap, main: { line: Pt[]; ring: boolean }, P: ReturnType<typeof plane>): ((p: Ll) => boolean) | undefined {
  if (main.ring) return (p) => inRing(p, main.line);
  const L = main.line.map(P.to);
  const side = (p: Ll) => {
    const q = P.to(p);
    const n = nearest(L, q);
    return Math.sign(n.dir[0] * (q[1] - n.at[1]) - n.dir[1] * (q[0] - n.at[0]));
  };
  const towns = (h.yerlesimler ?? []).filter((y) => y.sur_ici).map((y) => y.konum ?? (y.noktalar?.length ? mean(y.noktalar) : undefined));
  const town = towns.find((p): p is Ll => Boolean(p) && side(p!) !== 0);
  const gun = (h.araclar ?? []).find((a) => a.tur === "top" && side(a.konum) !== 0);
  const s = town ? side(town) : gun ? -side(gun.konum) : 0;
  if (!s || (town && gun && side(gun.konum) === s)) return undefined;
  return (p) => side(p) === s;
}

/**
 * The besiegers (the side standing outside on its first lines) and the defenders (inside). A unit within `clearKm` of the
 * wall tells nothing (a writer's two fronts on the wall itself).
 */
function sidesOf(h: SceneMap, inside: (p: Ll) => boolean, wallKm: (p: Ll) => number, clearKm: number): { attackers?: string; defenders?: string } {
  const units = h.birlikler ?? [];
  const where = [...new Set(units.map((u) => u.taraf))].map((t) => {
    const pts = units.filter((u) => u.taraf === t).flatMap((u) => ((f) => (f ? [centreOf(f)].filter((p): p is Ll => Boolean(p) && wallKm(p!) >= clearKm) : []))(firstStep(u)));
    const ins = pts.filter(inside).length;
    return { t, out: pts.length - ins, ins };
  });
  const attackers = where.find((w) => w.out > w.ins)?.t;
  const defenders = where.find((w) => w.ins > w.out && w.t !== attackers)?.t;
  return { ...(attackers ? { attackers } : {}), ...(defenders ? { defenders } : {}) };
}

/** A camp's or a settlement's tents drawn: an army camp ("ordugah") or the commander's tent ("otag"). */
const hasCamp = (h: SceneMap) => (h.yerlesimler ?? []).some((y) => y.tur === "ordugah") || (h.yapilar ?? []).some((b) => b.tur === "otag");

/** The breach on any wall, with the wall's line. */
function breachOf(h: SceneMap): { at: Ll; line?: Pt[] } | undefined {
  const w = (h.surlar ?? []).find((x) => x.gedik);
  return w?.gedik ? { at: w.gedik.konum, ...((l) => (l ? { line: l.line } : {}))(wallLine(w)) } : undefined;
}

/** Lines telling a breach in the walls (English and Turkish stems). */
const BREACH = /\bbreach\w*|\bpour(?:s|ed|ing)? in\b|\b(?:break|breaks|broke|burst|bursts) through\b|\bthrough the (?:gap|hole)\b|gedik/iu;
/** Lines telling a fleet (English and Turkish stems). */
const FLEET = /\b(?:fleet|navy|ships?|galleys?|warships?|flotilla|armada)\b|donanma|gemi|kadırga/iu;
/** Lines telling ships hauled over land (the 1453 fleet over the hill behind Galata; English and Turkish stems). */
const HAUL = /\b(?:haul\w*|dragg?\w*|roll\w*|carr(?:y|ies|ied))\b[^.]{0,60}\b(?:over|across)\b[^.]{0,30}\b(?:land|hills?|ridge|logs|rollers)\b|\boverland\b|karadan/iu;
/** The vehicles that float (MapBuilder's SHIPS). */
const SHIP_KINDS: ReadonlySet<string> = new Set(["gemi", "kadirga", "yelkenli", "denizalti"]);

/**
 * What a writer's siege close map lacks, as asks for the repair round: the besiegers' camp; the other side; on the
 * first map of a place the siege line along the whole wall and the defenders on it; guns with a target, aimed at the
 * breach when the scene has one; the breach a line tells, on its wall. Empty for a map that is no siege.
 */
export function siegeMapLacks(s: EpisodeScene, first: boolean): string[] {
  const h = s.harita;
  if (!isSiegeMap(h)) return [];
  const map = h!;
  const out: string[] = [];
  const main = mainWall(map)!;
  const P = plane(map.merkez!);
  const L = main.line.map(P.to);
  const wallKm = (p: Ll) => nearest(L, P.to(p)).km;
  if (!hasCamp(map)) out.push(`the besiegers' camp ("yerlesimler": {"tur": "ordugah", "ad": "<side> camp", "konum": where it really stood — behind their lines, opposite the main gate or the breach, "km": 1–2})`);
  const units = map.birlikler ?? [];
  if (new Set(units.map((u) => u.taraf)).size < 2) out.push(`${units.length ? "the other side's" : "both sides'"} "birlikler" (the defenders just inside the wall, the besiegers outside it)`);
  else if (first && !main.ring) {
    const long = units.some((u) => ((y) => Boolean(y && "cephe" in y && lineKm(y.cephe.map((p): Pt => [p[0], p[1]])) >= 0.5 * lineKm(main.line)))(firstStep(u)));
    if (!long) out.push(`the siege line: the besiegers' main unit's first "cephe" just outside the wall along its whole length (3–6 points), not a stub at one gate`);
    const inside = insideOf(map, main, P);
    const reach = Math.max(0.6, map.genislik_km! * 0.06);
    const onWall = inside && units.some((u) => ((y) => ((c) => Boolean(c && inside(c) && wallKm(c) <= reach))(y ? centreOf(y) : undefined))(firstStep(u)));
    if (inside && !onWall) out.push(`the defenders on the wall: their main unit's first "cephe" just inside it`);
  }
  const guns = (map.araclar ?? []).filter((a) => a.tur === "top");
  const breach = breachOf(map);
  if (guns.some((a) => !a.hedef)) out.push(`the guns' target: each "top" with "hedef" on the breach (or the stretch of wall it pounds) and "ates_satir" on the line that tells the bombardment`);
  else if (breach && guns.some((a) => kmBetween(a.hedef!, breach.at) > 0.5 && wallKm(a.hedef!) > 0.25)) out.push(`the guns aimed at the breach: their "hedef" is the breach's "konum"`);
  if (!breach && s.satirlar.some((l) => BREACH.test(l.metin))) out.push(`the breach the lines tell: "gedik" {"konum": a point ON the named wall where it really broke, "satir": the line that tells it}`);
  if (breach?.line && breach.line.length >= 2) {
    const off = nearest(breach.line.map(P.to), P.to(breach.at)).km;
    if (off > 0.3) out.push(`the breach ON its wall: "gedik" stands ${Math.round(off * 10) / 10} km off the wall's line`);
  }
  return out;
}

/** What a close map lacks of the ships its lines tell: the fleet itself, or the route of ships hauled over land. */
export function shipLacks(s: EpisodeScene): string[] {
  const h = s.harita;
  if (!isClose(h)) return [];
  const told = s.satirlar.filter((l) => l.karakter === "anlatici").map((l) => l.metin).join(" ");
  const ships = (h.araclar ?? []).filter((a) => SHIP_KINDS.has(a.tur));
  if (HAUL.test(told) && !ships.some((a) => (a.yol?.length ?? 0) >= 2)) return [`the ships hauled over land: "araclar" ships with "yol" along the real way (from the shore, over the ridge, down into the water) and "yol_satir" on the line that tells it`];
  if (FLEET.test(told) && !ships.length) return [`the fleet the lines tell: "araclar" ships where they really lay (an anchorage, a harbour, before a chain)`];
  return [];
}

/** "Ottomans" → "Ottoman camp" (a plural people's name without its s), "Swiss" stays. */
function campName(side: string): string {
  const stem = side.trim().replace(/^the\s+/i, "");
  return `${/[^s]s$/i.test(stem) && !/(?:us|is)$/i.test(stem) ? stem.slice(0, -1) : stem} camp`.slice(0, 40);
}

/** A line densified to about every 100 m (so a frame cuts it where it should). */
function dense(line: readonly Pt[]): Pt[] {
  return resample(line, Math.max(2, Math.min(400, Math.ceil(lineKm(line) / 0.1) + 1)));
}

/**
 * A siege close map with what the real wall lets the studio put in, after CloseSite moved its walls onto their real
 * trace (the Constantinople patch of 20 Nov 2026, as rules): the breach onto its wall's line; guns with no target, or one
 * off every wall, aimed at the breach (else the nearest stretch of wall); the besiegers' camp behind their lines opposite
 * the breach (or the wall nearest them) when the writer gave none; and on the first map of a place, the besiegers' main
 * front along the whole wall in the frame just outside it and the defenders' just inside it, when the writer's front was
 * a stub along it. Only what the writer left out is filled; nothing when the map cannot tell inside from outside.
 */
export function fillSiegeMap(map: SceneMap, first: boolean): { map: SceneMap; fixes: string[] } {
  if (!isSiegeMap(map)) return { map, fixes: [] };
  const fixes: string[] = [];
  const P = plane(map.merkez!);
  const w = map.genislik_km!;
  let h: SceneMap = map;
  // The breach on its wall's line (a guess, or moved with the map onto a real wall of another shape).
  const movedFrom: Ll[] = [];
  const surlar = (h.surlar ?? []).map((wall) => {
    const line = wall.gedik ? wallLine(wall)?.line : undefined;
    if (!wall.gedik || !line) return wall;
    const n = nearest(line.map(P.to), P.to(wall.gedik.konum));
    if (n.km <= 0.03 || n.km > 2.5) return wall;
    fixes.push(`gedik ${Math.round(n.km * 100) / 100} km yandaydı: surun üstüne alındı`);
    movedFrom.push(wall.gedik.konum);
    return { ...wall, gedik: { ...wall.gedik, konum: P.from(n.at) } };
  });
  if (fixes.length) h = { ...h, surlar };
  const main = mainWall(h)!;
  const L = main.line.map(P.to);
  const breach = breachOf(h);
  // The guns fire at the breach (or, with none, at the wall before them).
  let aimed = false;
  const araclar = (h.araclar ?? []).map((a, i) => {
    if (a.tur !== "top") return a;
    // A gun aimed at the breach where the writer put it follows the breach onto the wall.
    const wasBreach = a.hedef && breach && movedFrom.some((p) => kmBetween(p, a.hedef!) < 0.01);
    const off = a.hedef ? wasBreach || (nearest(L, P.to(a.hedef)).km > 0.25 && (!breach || kmBetween(a.hedef, breach.at) > 0.5)) : true;
    if (!off) return a;
    const hedef = breach ? ([breach.at[0], breach.at[1]] as [number, number]) : P.from(nearest(L, P.to(a.konum)).at);
    aimed = true;
    fixes.push(`araclar[${i}] topları ${breach ? "gediğe" : "önlerindeki sura"} nişan alır`);
    return { ...a, hedef };
  });
  if (aimed) h = { ...h, araclar };
  const inside = insideOf(h, main, P);
  if (!inside) return { map: h, fixes };
  const { attackers, defenders } = sidesOf(h, inside, (p) => nearest(L, P.to(p)).km, 0.08);
  const units = h.birlikler ?? [];
  const frame = { x: w / 2, y: (w * 9) / 32 };
  const inFrame = (q: Xy, share: number) => Math.abs(q[0]) <= frame.x * share && Math.abs(q[1]) <= frame.y * share;
  /** The outward normal of the wall at `q` (unit, plane km). */
  const outward = (q: Xy): Xy | undefined => {
    const n = nearest(L, q);
    for (const s of [1, -1]) {
      const v: Xy = [-n.dir[1] * s, n.dir[0] * s];
      if (!inside(P.from([n.at[0] + v[0] * 0.05, n.at[1] + v[1] * 0.05]))) return v;
    }
    return undefined;
  };
  const centres = (side: string | undefined) => units.filter((u) => u.taraf === side).flatMap((u) => ((y) => (y ? [centreOf(y)].filter((p): p is Ll => Boolean(p)) : []))(firstStep(u)));
  // The besiegers' camp behind their lines (else their guns), opposite the breach (or the wall nearest them), in the frame.
  const guns = (h.araclar ?? []).filter((a) => a.tur === "top" && !inside(a.konum)).map((a) => a.konum);
  const attackersAt = attackers ? centres(attackers) : units.length ? [] : guns;
  if (attackersAt.length && !hasCamp(h)) {
    const c = P.to(mean(attackersAt));
    const anchor = breach ? nearest(L, P.to(breach.at)).at : nearest(L, c).at;
    const n = outward(anchor);
    if (n) {
      const d = Math.max(1, Math.min(Math.max(1, w * 0.2), nearest(L, c).km + 0.8));
      const q: Xy = [Math.max(-frame.x * 0.8, Math.min(frame.x * 0.8, anchor[0] + n[0] * d)), Math.max(-frame.y * 0.8, Math.min(frame.y * 0.8, anchor[1] + n[1] * d))];
      if (!inside(P.from(q))) {
        h = { ...h, yerlesimler: [...(h.yerlesimler ?? []), { tur: "ordugah", ad: attackers ? campName(attackers) : "Siege camp", konum: P.from(q), km: Math.round(Math.max(0.8, Math.min(2, w * 0.12)) * 10) / 10 }] };
        fixes.push(`${attackers ?? "Kuşatanların"} ordugâhı ${breach ? "gediğin" : "surun"} karşısına, hatlarının gerisine kuruldu`);
      }
    }
  }
  // On the first map of a place: the main fronts along the whole wall in view, the besiegers outside, the defenders on it.
  if (!first || main.ring) return { map: h, fixes };
  const run = (() => {
    const pts = dense(main.line).map(P.to);
    let best: Xy[] = [];
    let cur: Xy[] = [];
    for (const q of pts) {
      if (inFrame(q, 0.9)) cur.push(q);
      else cur = [];
      if (cur.length > best.length) best = [...cur];
    }
    return best;
  })();
  const runKm = run.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - run[i]![0], q[1] - run[i]![1]), 0);
  if (run.length < 2 || runKm < 1) return { map: h, fixes };
  const reach = Math.max(1.5, w * 0.15);
  // The wall's left-hand normal along the run, walked one way: outside is on the same hand all along a line wall.
  const left = (i: number): Xy => {
    const [a, b] = [run[Math.max(0, i - 1)]!, run[Math.min(run.length - 1, i + 1)]!];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  };
  const mi = Math.floor(run.length / 2);
  const leftIsOut = !inside(P.from([run[mi]![0] + left(mi)[0] * 0.05, run[mi]![1] + left(mi)[1] * 0.05]));
  const along = (side: "out" | "in", d: number): [number, number][] => {
    const s = (side === "out") === leftIsOut ? 1 : -1;
    const pts = run.map((q, i) => P.from([q[0] + left(i)[0] * s * d, q[1] + left(i)[1] * s * d]));
    return resample(pts, 6).map((p): [number, number] => [r6(p[0]), r6(p[1])]);
  };
  const birlikler = units.map((u) => {
    const role = u.taraf === attackers ? "out" : u.taraf === defenders ? "in" : undefined;
    if (!role || (u.kanat !== undefined && u.kanat !== "merkez")) return u;
    // Only the side's first such unit (its main body); the others stay where the writer and Tactics put them.
    if (units.find((o) => o.taraf === u.taraf && (o.kanat === undefined || o.kanat === "merkez")) !== u) return u;
    const y = firstStep(u);
    if (!y || !("cephe" in y) || y.cephe.length < 1) return u;
    const ds = y.cephe.map((p) => nearest(L, P.to(p)).km);
    const isOut = y.cephe.every((p) => !inside(p));
    const isIn = y.cephe.every((p) => inside(p));
    if (Math.max(...ds) > reach || (role === "out" ? !isOut : !isIn) || lineKm(y.cephe.map((p): Pt => [p[0], p[1]])) >= runKm * 0.5) return u;
    const d = role === "out" ? Math.max(0.3, Math.min(0.8, ds.reduce((a, b) => a + b, 0) / ds.length)) : Math.max(0.1, Math.min(0.3, ds.reduce((a, b) => a + b, 0) / ds.length));
    fixes.push(`${u.ad ?? u.taraf} ${role === "out" ? "surun dışında bütün sur boyunca kuşatma hattında" : "surun üstünde, bütün sur boyunca"} (${Math.round(runKm * 10) / 10} km)`);
    return { ...u, yerler: u.yerler.map((x) => (x === y ? { ...x, cephe: along(role, d) } : x)) };
  });
  if (birlikler.some((u, i) => u !== units[i])) h = { ...h, birlikler };
  return { map: h, fixes };
}
