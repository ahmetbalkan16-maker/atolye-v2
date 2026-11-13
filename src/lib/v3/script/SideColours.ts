import { STATE_COLOURS } from "../maps/MapBuilder";
import { sideStems } from "../maps/MapSpeakers";

/**
 * One colour per side, and sides that tell apart (owner, 13 Nov 2026, the Baghdad 1638 Short: "haritada ülkelerin rengi
 * aynı" — the writer gave the Ottomans #3fae3a and the Safavids #556B2F, two greens, so the two states on the wide map
 * and the two sides' unit blocks on the close maps could not be told apart). Run on the draft at script time, after the
 * scenes' tactics (DraftNormalizer), on every colour that names a side: states (`harita.bolgeler` by `ad`), armies
 * (`ordular` by `ad`), unit blocks (`birlikler` by `taraf`), strength bars (`guc` and `bilgi_kartlari` sides by `ad`).
 *
 * - A name keeps the colour it first had (the Ottomans' blocks in the last scene are the colour of their first).
 * - Names are one side when their first stem is the same ("Ottoman Empire", "Ottoman Conquests 1600–1638", "Ottomans"),
 *   or when the writer gave them the very same colour — except two `taraf`s fighting in one scene, a strength bar's
 *   two sides, and two states (or two armies) on one map. A side's own entries in other colours (its conquests as a
 *   lighter green) are its shades and stay.
 * - Two sides shown in one scene whose colours are too close (`tooClose`) — the later-introduced side gets the palette
 *   colour (MapBuilder.STATE_COLOURS) farthest from every colour the episode uses, everywhere: its states, blocks, armies,
 *   bars, and the ships and arrows drawn in its old colour. Its shades keep their lightness against the new colour.
 *
 * Returns the fix lines (Turkish, for the log); the draft is changed in place.
 */
export function sideColours(scenes: readonly unknown[]): string[] {
  const entries = collect(scenes);
  if (!entries.length) return [];
  const fixes: string[] = [];

  // 1. A name keeps its first colour.
  const firstOf = new Map<string, string>();
  for (const e of entries) {
    const first = firstOf.get(e.key);
    if (first === undefined) firstOf.set(e.key, e.colour);
    else if (first !== e.colour) {
      fixes.push(`${e.where}.renk ${e.colour} → ${first} ("${e.name}" bölüm boyunca tek renk)`);
      e.set(first);
      e.colour = first;
    }
  }

  // 2. Sides: names joined by their first stem, then by one exact colour unless they fight each other.
  const keys = [...new Set(entries.map((e) => e.key))];
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const stemOf = new Map(keys.map((k) => [k, sideStems(entries.find((e) => e.key === k)!.name)[0]]));
  const apart = new Set<string>();
  for (const group of foes(entries)) for (const a of group) for (const b of group) if (a !== b && (stemOf.get(a) === undefined || stemOf.get(a) !== stemOf.get(b))) apart.add(`${a}\u0000${b}`);
  const members = (root: string) => keys.filter((k) => find(k) === root);
  const canJoin = (a: string, b: string) => members(find(a)).every((x) => members(find(b)).every((y) => !apart.has(`${x}\u0000${y}`)));
  for (const a of keys) for (const b of keys) if (a < b && stemOf.get(a) !== undefined && stemOf.get(a) === stemOf.get(b) && find(a) !== find(b)) parent.set(find(a), find(b));
  // One colour joins two names only where they could be one side: never two states on one map, nor two armies on one
  // map (the writer's "Ottoman Empire" and "Safavid Empire" in one hex stayed one side and one colour), while a state
  // and its army or its blocks in its colour are one side (Venice's state, the Venetians' blocks).
  const kinds = new Map<string, Set<string>>();
  for (const e of entries) if (e.kind === "devlet" || e.kind === "ordu") kinds.set(`${e.key}\u0000${e.scene}`, (kinds.get(`${e.key}\u0000${e.scene}`) ?? new Set()).add(e.kind));
  const scenesOfKey = new Map<string, Set<number>>();
  for (const e of entries) scenesOfKey.set(e.key, (scenesOfKey.get(e.key) ?? new Set()).add(e.scene));
  const alike = (x: string, y: string) => [...(scenesOfKey.get(x) ?? [])].some((s) => [...(kinds.get(`${x}\u0000${s}`) ?? [])].some((k) => kinds.get(`${y}\u0000${s}`)?.has(k)));
  const canShare = (a: string, b: string) => canJoin(a, b) && members(find(a)).every((x) => members(find(b)).every((y) => !alike(x, y)));
  for (const a of keys)
    for (const b of keys)
      if (a < b && find(a) !== find(b) && firstOf.get(a)!.toLowerCase() === firstOf.get(b)!.toLowerCase() && canShare(a, b)) parent.set(find(a), find(b));
  // Sides in the order the episode introduces them.
  const sideOf = (e: Entry) => find(e.key);
  const order = [...new Set(entries.map(sideOf))];

  // 3. Sides shown together that look alike: the later one is recoloured — or, when it was recoloured already or no
  // palette colour is left for it, the earlier one; a pair neither can part is left and the next pair is looked at (a
  // `break` here left every other clash of the scene standing).
  const recoloured = new Set<string>();
  const unparted = new Set<string>();
  const scenesOf = [...new Set(entries.map((e) => e.scene))];
  const usedBy = (side: string) => entries.filter((e) => sideOf(e) !== side).map((e) => e.colour.toLowerCase());
  for (const si of scenesOf) {
    for (let guard = 0; guard < 16; guard++) {
      const here = entries.filter((e) => e.scene === si);
      const sides = order.filter((s) => here.some((e) => sideOf(e) === s));
      const clash = sides.flatMap((a, i) => sides.slice(i + 1).map((b) => [a, b] as const)).find(([a, b]) => {
        if (unparted.has(`${a}\u0000${b}`)) return false;
        const ca = new Set(here.filter((e) => sideOf(e) === a).map((e) => e.colour.toLowerCase()));
        const cb = new Set(here.filter((e) => sideOf(e) === b).map((e) => e.colour.toLowerCase()));
        return [...ca].some((x) => [...cb].some((y) => tooClose(x, y)));
      });
      if (!clash) break;
      const side = [clash[1], clash[0]].find((s) => !recoloured.has(s) && paletteColour(usedBy(s)) !== undefined);
      if (!side) {
        unparted.add(`${clash[0]}\u0000${clash[1]}`);
        continue;
      }
      const other = side === clash[1] ? clash[0] : clash[1];
      const own = entries.filter((e) => sideOf(e) === side);
      const main = own[0]!.colour.toLowerCase();
      const used = usedBy(side);
      const pick = paletteColour(used)!;
      recoloured.add(side);
      const oldColours = new Set(own.map((e) => e.colour.toLowerCase()));
      // A shade keeps its lightness against the new colour unless that lands on another side's colour (then the other
      // way, else the new colour itself).
      const shade = (c: string) => (c.toLowerCase() === main ? pick : ([shadeLike(pick, main, c), shadeLike(pick, main, c, -1)].find((x) => !used.some((u) => tooClose(x, u))) ?? pick));
      for (const e of own) {
        const to = shade(e.colour);
        e.set(to);
        e.colour = to;
      }
      // The side's ships and arrows in its old colour, where no other side has that colour.
      const others = new Set(used);
      let marks = 0;
      for (const m of colourOnly(scenes))
        if (oldColours.has(m.colour.toLowerCase()) && !others.has(m.colour.toLowerCase())) {
          m.set(shade(m.colour));
          marks++;
        }
      const otherName = entries.find((e) => sideOf(e) === other)!.name;
      fixes.push(`taraf "${own[0]!.name}" rengi ${main} → ${pick} ("${otherName}" ile aynı sahnede ayırt edilemiyordu; ${own.length} kayıt${marks ? `, ${marks} gemi/ok` : ""})`);
    }
  }
  return fixes;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const HEX = /^#[0-9a-f]{6}$/i;

interface Entry {
  readonly scene: number;
  readonly key: string;
  readonly name: string;
  readonly where: string;
  /** The group of names this entry stands against in its scene ("birlikler" and each strength bar), if any. */
  readonly foes?: string;
  /** What it colours: a state, an army, a unit block, a strength bar's side. */
  readonly kind: "devlet" | "ordu" | "birlik" | "guc";
  colour: string;
  readonly set: (c: string) => void;
}

const keyOf = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

function collect(scenes: readonly unknown[]): Entry[] {
  const out: Entry[] = [];
  const add = (scene: number, o: unknown, field: "ad" | "taraf", where: string, kind: Entry["kind"], foes?: string) => {
    if (!isObj(o) || typeof o[field] !== "string" || !(o[field] as string).trim() || typeof o.renk !== "string" || !HEX.test(o.renk.trim())) return;
    out.push({ scene, key: keyOf(o[field] as string), name: (o[field] as string).trim(), where, kind, ...(foes ? { foes } : {}), colour: o.renk.trim(), set: (c) => (o.renk = c) });
  };
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  for (const [si, s] of scenes.entries()) {
    if (!isObj(s)) continue;
    const h = isObj(s.harita) ? s.harita : undefined;
    const at = `sahneler[${si}]`;
    if (h) {
      for (const [i, b] of list(h.bolgeler).entries()) add(si, b, "ad", `${at}.harita.bolgeler[${i}]`, "devlet");
      for (const [i, o] of list(h.ordular).entries()) add(si, o, "ad", `${at}.harita.ordular[${i}]`, "ordu");
      for (const [i, u] of list(h.birlikler).entries()) add(si, u, "taraf", `${at}.harita.birlikler[${i}]`, "birlik", `${si}:birlikler`);
      for (const [g, bar] of list(h.guc).entries()) for (const [i, t] of list(isObj(bar) ? bar.taraflar : undefined).entries()) add(si, t, "ad", `${at}.harita.guc[${g}].taraflar[${i}]`, "guc", `${si}:guc${g}`);
    }
    for (const [c, card] of list(s.bilgi_kartlari).entries()) for (const [i, t] of list(isObj(card) ? card.taraflar : undefined).entries()) add(si, t, "ad", `${at}.bilgi_kartlari[${c}].taraflar[${i}]`, "guc", `${si}:kart${c}`);
  }
  return out;
}

/** Groups of names that stand against each other: one scene's unit sides, one strength bar's two sides. */
function foes(entries: readonly Entry[]): string[][] {
  const groups = new Map<string, Set<string>>();
  for (const e of entries) if (e.foes) groups.set(e.foes, (groups.get(e.foes) ?? new Set()).add(e.key));
  return [...groups.values()].map((g) => [...g]);
}

/** Colours on a map that carry no side name: ships (`araclar`) and arrows (`oklar`). */
function colourOnly(scenes: readonly unknown[]): { colour: string; set: (c: string) => void }[] {
  const out: { colour: string; set: (c: string) => void }[] = [];
  for (const s of scenes) {
    const h = isObj(s) && isObj(s.harita) ? s.harita : undefined;
    if (!h) continue;
    for (const list of [h.araclar, h.oklar]) for (const o of Array.isArray(list) ? list : []) if (isObj(o) && typeof o.renk === "string" && HEX.test(o.renk.trim())) out.push({ colour: o.renk.trim(), set: (c) => (o.renk = c) });
  }
  return out;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** CIE L*a*b* (D65) of a #rrggbb colour: distances there follow what the eye sees, unlike RGB. */
export function lab(hex: string): [number, number, number] {
  const lin = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const xyz = [(0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047, 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2], (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = xyz.map(f) as [number, number, number];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const deltaE = (a: string, b: string) => {
  const x = lab(a);
  const y = lab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

/** Two colours under this ΔE (CIE76) are one colour to the eye whatever their hue (greys, browns, near-twins). */
export const SAME_COLOUR_DE = 15;
/**
 * Hues (CIE LCh) closer than this are one colour name: the Baghdad green and olive are 16° apart, green and dark green
 * 19°, and read "both green"; the palette's steps that read as different colours (STATE_COLOURS orange/gold, gold/yellow-green,
 * green/yellow-green) are 24–26° apart, and crimson and orange (#c0392b, #e67e22) 24°.
 */
export const SAME_HUE_DEG = 22;
/** …unless their lightness differs this much: a pale and a dark of one hue still tell apart. */
export const APART_LIGHTNESS = 30;
/** Below this chroma a colour has no hue to speak of (grey, near-black): only ΔE separates it. */
const HUELESS_CHROMA = 15;

/**
 * Whether two side colours are too close to tell apart on a map. ΔE alone is not enough: the Baghdad greens #3fae3a and
 * #556B2F are ΔE ≈ 40 apart (a "different colour" by the usual reading) and still looked the same to the owner, because
 * the eye names a map's states by hue first. So: one hue family (< SAME_HUE_DEG) at a similar lightness (< APART_LIGHTNESS),
 * or nearly the same colour (< SAME_COLOUR_DE).
 */
export function tooClose(a: string, b: string): boolean {
  if (deltaE(a, b) < SAME_COLOUR_DE) return true;
  const [la, aa, ba] = lab(a);
  const [lb, ab, bb] = lab(b);
  if (Math.hypot(aa, ba) < HUELESS_CHROMA || Math.hypot(ab, bb) < HUELESS_CHROMA) return false;
  const ha = (Math.atan2(ba, aa) * 180) / Math.PI;
  const hb = (Math.atan2(bb, ab) * 180) / Math.PI;
  const dh = Math.abs(((ha - hb + 540) % 360) - 180);
  return dh < SAME_HUE_DEG && Math.abs(la - lb) < APART_LIGHTNESS;
}

/** The palette colour too close to none of `used`, farthest (ΔE) from the nearest of them; palette order breaks ties. */
function paletteColour(used: readonly string[]): string | undefined {
  const ok = STATE_COLOURS.filter((c) => !used.some((u) => tooClose(c, u)));
  return ok.map((c) => ({ c, d: Math.min(Infinity, ...used.map((u) => deltaE(c, u))) })).sort((a, b) => b.d - a.d)[0]?.c;
}

function hsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A shade of `pick` as light against it as `shade` was against `main` (a side's conquests stay its lighter colour);
 * `sign` −1: as much the other way.
 */
function shadeLike(pick: string, main: string, shade: string, sign: 1 | -1 = 1): string {
  const [h, s, l] = hsl(pick);
  const dl = hsl(shade)[2] - hsl(main)[2];
  return fromHsl(h, s, Math.min(0.88, Math.max(0.12, l + sign * dl)));
}
