import { CLOSE_MAP_MAX_KM, UNIT_MOVES, UNIT_WINGS, type UnitMove, type UnitWing } from "../episode/EpisodeTypes";

/**
 * A battle's order and its moves on the close map, from the writer's words to coordinates (owner, 26 Oct 2026, after
 * the Kosovo close battle — one block a side, nothing of the tactics seen: "kanaldaki videolar gibi taktik olması
 * lazım; anlatıma göre ordaki askerler hareket etmesi lazım ve askerlerin ne asker olduğu belli olması lazım … bunlar
 * bizim beyine entegre edilecek, yapılan videolarda kendisi kullanacak").
 *
 * The writer gives each side's center unit a formation and every other unit its place in the order of battle
 * (`kanat`: the center, the left or right wing as the side faces the enemy, the screen in front, the reserve behind),
 * then on any later line what it does (`hareket`: hold, advance, charge into `hedef`, sweep round `hedef`'s flank, fall
 * back). Here the units are set out round their center and each move is worked out from where everyone stands on that
 * line, so the writer never has to place a wing or a flanking sweep by hand, anywhere on Earth. A formation the writer
 * gave always wins; what is filled in is a plain front (`cephe`), so everything downstream reads it as if written.
 *
 * Works on the raw draft (before validation): anything malformed is left for the validator to report.
 */

type P = readonly [number, number];
type Obj = Record<string, unknown>;

/** Distances as shares of the map's width (km): a front's lines apart, wings apart, sides touching, a step back. */
const DEPTH_SHARE = 0.045;
const WING_GAP_SHARE = 0.02;
const CONTACT_SHARE = 0.03;
const FALLBACK_SHARE = 0.06;
const FLEE_SHARE = 0.12;
/** A front's width when the center unit gives a point, not a line (share of the map). */
const FRONT_SHARE = 0.16;
/** How far an advance goes of the gap to the enemy. */
const ADVANCE_SHARE = 0.4;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isPt = (v: unknown): v is P => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
const len = (a: P) => Math.hypot(a[0], a[1]);
const unit = (a: P, fallback: P = [0, 1]): P => (len(a) > 1e-9 ? mul(a, 1 / len(a)) : fallback);
/** A side's left hand as it faces `f` (east–north plane, counter-clockwise). */
const leftOf = (f: P): P => [-f[1], f[0]];

/** A unit's shape on a line: its middle, its width along its front, the direction of that front (km plane). */
interface Shape {
  readonly c: P;
  readonly w: number;
  readonly along: P;
}

interface Entry {
  readonly y: Obj;
  readonly satir: number;
}

interface UnitInfo {
  readonly u: Obj;
  readonly index: number;
  readonly side: string;
  readonly name: string;
  readonly wing?: UnitWing;
  readonly kind?: string;
  readonly entries: Entry[];
}

/**
 * Guns stood in front of their infantry until indirect fire (owner, 26 Oct 2026, after the Mohács trial: the writer put
 * the Ottoman guns behind the Janissaries — at Mohács, as at Chaldiran, they were chained in front of them). Before
 * this year a battery set behind its side is moved to the front.
 */
export const DIRECT_FIRE_UNTIL = 1900;

/**
 * Fills the close map's missing unit formations from `kanat` and `hareket`; returns what was done (for the log). The
 * map object is changed in place. `year`: the story's year (guns before DIRECT_FIRE_UNTIL stand in front).
 */
export function resolveTactics(map: Obj, where = "harita", year?: number): string[] {
  const fixes: string[] = [];
  const centre = map.merkez;
  const width = map.genislik_km;
  if (!isPt(centre) || typeof width !== "number" || width > CLOSE_MAP_MAX_KM || !Array.isArray(map.birlikler)) return fixes;
  const kmLon = 111.32 * Math.max(0.2, Math.cos((centre[1] * Math.PI) / 180));
  const toKm = (p: P): P => [(p[0] - centre[0]) * kmLon, (p[1] - centre[1]) * 110.57];
  const toLL = (p: P): [number, number] => [Math.round((centre[0] + p[0] / kmLon) * 1e5) / 1e5, Math.round((centre[1] + p[1] / 110.57) * 1e5) / 1e5];
  const units: UnitInfo[] = (map.birlikler as unknown[]).flatMap((u, index) => {
    if (!isObj(u) || typeof u.taraf !== "string" || !Array.isArray(u.yerler)) return [];
    const entries = (u.yerler as unknown[]).filter(isObj).map((y) => ({ y, satir: typeof y.satir === "number" ? y.satir : 0 }));
    entries.sort((a, b) => a.satir - b.satir);
    const wing = UNIT_WINGS.includes(u.kanat as UnitWing) ? (u.kanat as UnitWing) : undefined;
    return [{ u, index, side: u.taraf.trim().toLocaleLowerCase("en-US"), name: typeof u.ad === "string" ? u.ad : u.taraf, ...(wing ? { wing } : {}), ...(typeof u.tur === "string" ? { kind: u.tur } : {}), entries }];
  });
  if (!units.length) return fixes;
  const label = (x: UnitInfo) => `${where}.birlikler[${x.index}] "${x.name}"`;

  // Shapes of written formations.
  const shapeOf = (y: Obj): Shape | undefined => {
    if (Array.isArray(y.cephe)) {
      const pts = (y.cephe as unknown[]).filter(isPt).map(toKm);
      if (!pts.length) return undefined;
      const c: P = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
      let w = 0;
      for (let i = 1; i < pts.length; i++) w += len(sub(pts[i]!, pts[i - 1]!));
      return { c, w: w > 0 ? w : width * FRONT_SHARE, along: pts.length > 1 ? unit(sub(pts[pts.length - 1]!, pts[0]!), [1, 0]) : [1, 0] };
    }
    const at = isPt(y.kume) ? y.kume : isPt(y.kusatma) ? y.kusatma : undefined;
    if (!at) return undefined;
    const km = typeof y.km === "number" ? y.km : width * FRONT_SHARE * 0.5;
    return { c: toKm(at), w: Math.max(km * 2, width * 0.04), along: [1, 0] };
  };
  const written = (y: Obj) => y.cephe !== undefined || y.kume !== undefined || y.kusatma !== undefined;
  const shapes = new Map<Obj, Shape>();
  for (const x of units)
    for (const e of x.entries) {
      const s = written(e.y) ? shapeOf(e.y) : undefined;
      if (s) shapes.set(e.y, s);
    }
  /** Where a unit stands on a line: its latest formation at or before it (resolved so far). */
  const shapeAt = (x: UnitInfo, line: number, strict = false): Shape | undefined => {
    let s: Shape | undefined;
    for (const e of x.entries) if ((strict ? e.satir < line : e.satir <= line) && shapes.has(e.y)) s = shapes.get(e.y);
    return s;
  };
  const enemies = (x: UnitInfo) => units.filter((o) => o.side !== x.side);
  // Each side's center: its center unit's first formation, else its first written one.
  const sides = [...new Set(units.map((x) => x.side))];
  const anchor = new Map<string, Shape>();
  for (const side of sides) {
    const own = units.filter((x) => x.side === side);
    const first = (x: UnitInfo) => (x.entries[0] && shapes.get(x.entries[0].y)) || undefined;
    const pick = own.find((x) => x.wing === "merkez" && first(x)) ?? own.find((x) => !x.wing && first(x)) ?? own.find((x) => first(x));
    if (pick) anchor.set(side, first(pick)!);
  }
  /** The way a side faces: towards the other sides' centers. */
  const facing = (side: string): P => {
    const own = anchor.get(side);
    const others = sides.filter((s) => s !== side && anchor.has(s)).map((s) => anchor.get(s)!.c);
    if (!own || !others.length) return [0, 1];
    const e: P = [others.reduce((a, p) => a + p[0], 0) / others.length, others.reduce((a, p) => a + p[1], 0) / others.length];
    return unit(sub(e, own.c));
  };
  const front = (s: Shape): [number, number][] => [toLL(add(s.c, mul(s.along, -s.w / 2))), toLL(add(s.c, mul(s.along, s.w / 2)))];
  const set = (x: UnitInfo, e: Entry, s: Shape, note: string, via?: P) => {
    shapes.set(e.y, s);
    e.y.cephe = front(s);
    delete e.y.kume;
    delete e.y.kusatma;
    delete e.y.km;
    if (via) e.y.uzerinden = toLL(via);
    fixes.push(`${label(x)} ${e.satir}. satır: ${note}`);
  };

  // 1) The order of battle: units with no formation on their first line stand round their side's center.
  const depth = width * DEPTH_SHARE;
  const wingGap = width * WING_GAP_SHARE;
  for (const side of sides) {
    const a = anchor.get(side);
    if (!a) continue;
    const f = facing(side);
    const l = leftOf(f);
    const placed: Record<UnitWing, number> = { merkez: 0, sol: 0, sag: 0, on: 0, arka: 0 };
    for (const x of units.filter((o) => o.side === side)) {
      const e = x.entries[0];
      if (!e || shapes.has(e.y)) continue;
      // A second center stands behind the first, as a second line; guns of the direct-fire age in front.
      const guns = x.kind === "topcu" && year !== undefined && year < DIRECT_FIRE_UNTIL && (!x.wing || x.wing === "merkez" || x.wing === "arka");
      if (guns) {
        x.u.kanat = "on";
        fixes.push(`${label(x)}: ${year} yılında toplar piyadesinin önünde ateş eder — öne alındı`);
      }
      const wing: UnitWing = guns ? "on" : !x.wing || x.wing === "merkez" ? "arka" : x.wing;
      const k = placed[wing]++;
      const ww = a.w * (wing === "on" ? 0.75 : wing === "arka" ? 0.6 : 0.5);
      const out = a.w / 2 + wingGap + ww / 2 + k * (ww + wingGap);
      const c: P =
        wing === "sol" ? add(a.c, mul(l, out)) : wing === "sag" ? add(a.c, mul(l, -out)) : wing === "on" ? add(a.c, mul(f, depth * (1 + k * 0.8))) : add(a.c, mul(f, -depth * (1.2 + k * 0.9)));
      set(x, e, { c, w: ww, along: l }, { sol: "sol kanatta", sag: "sağ kanatta", on: "öncü, merkezin önünde", arka: "merkezin arkasında", merkez: "merkezde" }[wing]);
    }
  }

  // 2) The moves, line by line: first what a unit does by itself, then the charges and sweeps at the others as they
  // stand on that line.
  const lines = [...new Set(units.flatMap((x) => x.entries.map((e) => e.satir)))].sort((a, b) => a - b);
  const contact = width * CONTACT_SHARE;
  const nearest = (x: UnitInfo, line: number, from: P) => {
    let best: { o: UnitInfo; s: Shape } | undefined;
    for (const o of enemies(x)) {
      const s = shapeAt(o, line);
      if (s && (!best || len(sub(s.c, from)) < len(sub(best.s.c, from)))) best = { o, s };
    }
    return best;
  };
  const target = (x: UnitInfo, line: number, from: P, hedef: unknown) => {
    const want = typeof hedef === "string" ? hedef.trim().toLocaleLowerCase("en-US") : "";
    if (want) {
      const named = enemies(x).filter((o) => o.name.toLocaleLowerCase("en-US") === want || o.name.toLocaleLowerCase("en-US").includes(want) || want.includes(o.name.toLocaleLowerCase("en-US")));
      const pool = named.length ? named : enemies(x).filter((o) => o.side === want || o.side.includes(want) || want.includes(o.side));
      let best: { o: UnitInfo; s: Shape } | undefined;
      for (const o of pool) {
        const s = shapeAt(o, line);
        if (s && (!best || len(sub(s.c, from)) < len(sub(best.s.c, from)))) best = { o, s };
      }
      if (best) return best;
    }
    return nearest(x, line, from);
  };
  for (const line of lines) {
    for (const pass of [0, 1] as const) {
      for (const x of units) {
        const e = x.entries.find((en) => en.satir === line);
        if (!e || shapes.has(e.y) || e === x.entries[0]) continue;
        const move: UnitMove = UNIT_MOVES.includes(e.y.hareket as UnitMove) ? (e.y.hareket as UnitMove) : "tut";
        if ((move === "hucum" || move === "kusat") !== (pass === 1)) continue;
        const prev = shapeAt(x, line, true);
        if (!prev) continue;
        const foe = move === "hucum" || move === "kusat" ? target(x, line, prev.c, e.y.hedef) : nearest(x, line, prev.c);
        const toward = foe ? unit(sub(foe.s.c, prev.c)) : facing(x.side);
        if (e.y.bozgun === true) {
          set(x, e, { c: add(prev.c, mul(toward, -width * FLEE_SHARE)), w: prev.w, along: prev.along }, "bozgun, düşmandan uzağa kaçar");
          continue;
        }
        switch (move) {
          case "tut":
            set(x, e, prev, "yerini tutar");
            break;
          case "ilerle": {
            const gap = foe ? len(sub(foe.s.c, prev.c)) : depth * 2;
            set(x, e, { c: add(prev.c, mul(toward, Math.max(0, Math.min(gap - contact * 1.5, gap * ADVANCE_SHARE)))), w: prev.w, along: prev.along }, "ilerler");
            break;
          }
          case "geri":
            set(x, e, { c: add(prev.c, mul(toward, -width * FALLBACK_SHARE)), w: prev.w, along: prev.along }, "geri çekilir");
            break;
          case "hucum": {
            if (!foe) {
              set(x, e, prev, "hücum edecek düşman yok, yerini tutar");
              break;
            }
            // Into contact with the target's face it comes at, front to front along the target's line (a charge at a
            // wing from across the field struck its front, not its middle on the slant: the Kosovo trial piled every
            // charging unit onto the enemy's center).
            const ft = facing(foe.o.side);
            const from = unit(sub(prev.c, foe.s.c), ft);
            const face = from[0] * ft[0] + from[1] * ft[1] > 0 ? ft : from;
            set(x, e, { c: add(foe.s.c, mul(face, contact + depth * 0.15)), w: Math.min(prev.w, Math.max(foe.s.w, prev.w * 0.6)), along: leftOf(mul(face, -1)) }, `${foe.o.name} üzerine hücum`);
            break;
          }
          case "kusat": {
            if (!foe) {
              set(x, e, prev, "kuşatacak düşman yok, yerini tutar");
              break;
            }
            // Round the target's nearer flank to its side and a little behind, sweeping wide on the way.
            const ft = facing(foe.o.side);
            const lt = leftOf(ft);
            const s = Math.sign((prev.c[0] - foe.s.c[0]) * lt[0] + (prev.c[1] - foe.s.c[1]) * lt[1]) || 1;
            const flank = add(foe.s.c, mul(lt, s * (foe.s.w / 2 + contact)));
            const dest = add(flank, mul(ft, -contact * 0.6));
            const via = add(add(foe.s.c, mul(lt, s * (foe.s.w / 2 + Math.max(contact * 3, len(sub(prev.c, flank)) * 0.5)))), mul(ft, contact));
            set(x, e, { c: dest, w: Math.min(prev.w, foe.s.w * 0.8), along: ft }, `${foe.o.name} kanadını dolaşıp kuşatır`, via);
            break;
          }
        }
      }
    }
  }
  return fixes;
}
