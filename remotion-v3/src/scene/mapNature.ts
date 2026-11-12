/**
 * The close battle map's living ground (owner, 12 Nov 2026: "yakın çekim haritalandırmada … harita ortamı daha
 * gerçekçi"): the shapes of its woods, fields and drifting cloud shadows, kept apart from the drawing so they can be
 * proven without Remotion. Every function is pure — the same arguments give the same shapes — and the cloud shadows are
 * a function of the frame alone, because Remotion renders frames in any order and in parallel.
 */

export interface XY {
  readonly x: number;
  readonly y: number;
}

/** One tree of a wood: its place, crown radius, which of the wood's greens it wears and its crown's lobed outline. */
export interface Tree extends XY {
  readonly r: number;
  readonly tone: number;
  readonly crown: string;
}

/**
 * A wood as one mass: the dark underside under its crowns (`outline`, a little inside them so the crowns make its
 * edge), its shadow on the ground (`shade`, as wide as the crowns) and its trees back to front, strays included.
 */
export interface WoodLayout {
  readonly outline: string;
  readonly shade: string;
  readonly trees: readonly Tree[];
}

/** A field plot: its irregular outline, its strips (each a crop with its furrows) and the hedge along some sides. */
export interface FieldLayout {
  readonly outline: string;
  readonly strips: readonly { readonly d: string; readonly tone: number; readonly furrows: string }[];
  readonly hedge: string;
}

/** One soft patch of a cloud's shadow (an ellipse filled with a radial gradient, never a blur filter). */
export interface CloudPuff extends XY {
  readonly rx: number;
  readonly ry: number;
  /** Degrees. */
  readonly angle: number;
  readonly opacity: number;
}

/** A wood's greens: crown and its sunlit side (darker and bluer firs, lighter oaks and beeches). */
export const WOOD_TONES: readonly { readonly crown: string; readonly lit: string }[] = [
  { crown: "#3d5c26", lit: "#5f8139" },
  { crown: "#47692d", lit: "#6c9343" },
  { crown: "#527636", lit: "#7aa04b" },
  { crown: "#365222", lit: "#557638" },
  { crown: "#5b7a35", lit: "#86a453" },
  { crown: "#3f5e33", lit: "#628449" },
];

/** Crop colours close to the ground's own: ripe wheat, stubble, young green, fallow, hay. */
export const FIELD_TONES: readonly string[] = ["#c9bd7c", "#b8ab6c", "#a2b36a", "#ad9b6b", "#bdb877"];

/** How fast a cloud's shadow drifts, in houses (`u`) a second, and its bounds in world px a second. */
const CLOUD_SPEED_U = 0.25;
const CLOUD_SPEED_MIN = 4;
const CLOUD_SPEED_MAX = 10;

export function hash01(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 4.1414) * 43758.5453;
  return x - Math.floor(x);
}

const f1 = (n: number) => Math.round(n * 10) / 10;

/** A closed smooth path through points: quadratic curves from midpoint to midpoint, each point a control point. */
export function smoothClosed(points: readonly XY[]): string {
  const n = points.length;
  const mid = (a: XY, b: XY) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = mid(points[n - 1]!, points[0]!);
  let d = `M${f1(start.x)} ${f1(start.y)}`;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const m = mid(p, points[(i + 1) % n]!);
    d += ` Q${f1(p.x)} ${f1(p.y)} ${f1(m.x)} ${f1(m.y)}`;
  }
  return `${d} Z`;
}

/** A crown seen from above: a ring of rounded leaf masses (scallops of uneven size), not a clip-art disc. */
function crownPath(x: number, y: number, r: number, seed: number): string {
  const lobes = 6 + Math.floor(hash01(seed) * 3);
  const turn = hash01(seed + 1) * Math.PI * 2;
  const at = (a: number, rr: number) => `${f1(x + Math.cos(a) * rr)} ${f1(y + Math.sin(a) * rr)}`;
  let d = `M${at(turn, r * 0.88)}`;
  for (let j = 0; j < lobes; j++) {
    const a0 = turn + (j / lobes) * Math.PI * 2;
    const a1 = turn + ((j + 1) / lobes) * Math.PI * 2;
    // From one dip between two leaf masses to the next, bowing out round the mass between them.
    d += ` Q${at((a0 + a1) / 2, r * (1.22 + hash01(seed + j * 3) * 0.12))} ${at(a1, r * 0.88)}`;
  }
  return `${d} Z`;
}

/**
 * A wood as foresters' maps and aerial photographs show one: an irregular mass of many overlapping crowns of several
 * greens and sizes (bigger, older trees inside), with a few stray trees around its edge. Its outline carries the dark
 * underside that makes the clump read as one mass. Trees come back to front (by `y`).
 */
export function woodLayout(x: number, y: number, size: number, seed: number, u: number): WoodLayout {
  const R = size * 0.42;
  const phase = [hash01(seed + 101), hash01(seed + 102), hash01(seed + 103)].map((p) => p * Math.PI * 2);
  const reach = (a: number) => R * (1 + 0.16 * Math.sin(2 * a + phase[0]!) + 0.1 * Math.sin(3 * a + phase[1]!) + 0.06 * Math.sin(5 * a + phase[2]!));
  const squash = 0.82;
  const ring = (k: number) => Array.from({ length: 20 }, (_, j) => {
    const a = (j / 20) * Math.PI * 2;
    return { x: x + Math.cos(a) * reach(a) * k, y: y + Math.sin(a) * reach(a) * k * squash };
  });
  const area = (size / u) ** 2;
  const n = Math.max(12, Math.min(42, Math.round(area * 1.3)));
  // Crowns large enough to overlap: together about 1.4 times the wood's area.
  const base = Math.max(u * 0.3, R * Math.sqrt(1.4 / n));
  const trees: Tree[] = [];
  for (let i = 0; i < n; i++) {
    const s = seed * 131 + i * 7;
    const a = hash01(s) * Math.PI * 2;
    const t = Math.sqrt(hash01(s + 1));
    const r = base * (0.72 + hash01(s + 2) * 0.5) * (1.12 - 0.3 * t);
    const d = t * Math.max(0, reach(a) - r * 0.35);
    const tx = x + Math.cos(a) * d;
    const ty = y + Math.sin(a) * d * squash;
    trees.push({ x: f1(tx), y: f1(ty), r: f1(r), tone: Math.floor(hash01(s + 3) * WOOD_TONES.length), crown: crownPath(tx, ty, r, s + 4) });
  }
  // A few trees stand apart from the wood, along its edge.
  const strays = 2 + Math.floor(hash01(seed + 7) * 4);
  for (let i = 0; i < strays; i++) {
    const s = seed * 131 + 9000 + i * 7;
    const a = hash01(s) * Math.PI * 2;
    const r = base * (0.55 + hash01(s + 2) * 0.3);
    const d = reach(a) * (1.08 + hash01(s + 1) * 0.25) + r;
    const tx = x + Math.cos(a) * d;
    const ty = y + Math.sin(a) * d * squash;
    trees.push({ x: f1(tx), y: f1(ty), r: f1(r), tone: Math.floor(hash01(s + 3) * WOOD_TONES.length), crown: crownPath(tx, ty, r, s + 4) });
  }
  trees.sort((p, q) => p.y - q.y);
  return { outline: smoothClosed(ring(0.86)), shade: smoothClosed(ring(1.08)), trees };
}

/**
 * A plot of fields in the plot's own frame (centred on 0,0, before its rotation): a slightly crooked quadrilateral
 * split into 3–5 strips of different crops with uneven boundaries, each strip's furrows running along or across it,
 * and a hedge along two or three of its sides. Furrows are spaced from `u`, at most a few dozen a strip.
 */
export function fieldLayout(size: number, seed: number, u: number): FieldLayout {
  const w = size;
  const h = size * 0.68;
  const jx = (i: number) => (hash01(seed + 20 + i) - 0.5) * w * 0.14;
  const jy = (i: number) => (hash01(seed + 30 + i) - 0.5) * h * 0.14;
  const tl = { x: -w / 2 + jx(0), y: -h / 2 + jy(0) };
  const tr = { x: w / 2 + jx(1), y: -h / 2 + jy(1) };
  const br = { x: w / 2 + jx(2), y: h / 2 + jy(2) };
  const bl = { x: -w / 2 + jx(3), y: h / 2 + jy(3) };
  const lerp = (a: XY, b: XY, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const strips = 3 + Math.floor(hash01(seed + 1) * 3);
  // Inner boundaries a little off even, and not parallel (top and bottom move apart).
  const cutsTop = [0, ...Array.from({ length: strips - 1 }, (_, i) => (i + 1) / strips + (hash01(seed + 40 + i) - 0.5) * (0.35 / strips)), 1];
  const cutsBot = cutsTop.map((c, i) => (i === 0 || i === strips ? c : c + (hash01(seed + 50 + i) - 0.5) * (0.3 / strips)));
  const toneShift = Math.floor(hash01(seed + 2) * FIELD_TONES.length);
  const poly = (pts: readonly XY[]) => `M${pts.map((p) => `${f1(p.x)} ${f1(p.y)}`).join(" L")} Z`;
  const out = Array.from({ length: strips }, (_, i) => {
    const a = lerp(tl, tr, cutsTop[i]!);
    const b = lerp(tl, tr, cutsTop[i + 1]!);
    const c = lerp(bl, br, cutsBot[i + 1]!);
    const d = lerp(bl, br, cutsBot[i]!);
    const spacing = Math.max(u * 0.3, size / 45);
    const inset = 0.06;
    let furrows = "";
    if (hash01(seed + 60 + i) < 0.6) {
      // Along the strip: lines from its top edge to its bottom edge.
      const across = Math.hypot(b.x - a.x, b.y - a.y);
      const m = Math.max(1, Math.min(24, Math.floor(across / spacing)));
      for (let j = 1; j <= m; j++) {
        const t = j / (m + 1);
        const p = lerp(lerp(a, b, t), lerp(d, c, t), inset);
        const q = lerp(lerp(a, b, t), lerp(d, c, t), 1 - inset);
        furrows += `M${f1(p.x)} ${f1(p.y)} L${f1(q.x)} ${f1(q.y)} `;
      }
    } else {
      // Across the strip: lines from its left boundary to its right one.
      const along = Math.hypot(d.x - a.x, d.y - a.y);
      const m = Math.max(1, Math.min(30, Math.floor(along / spacing)));
      for (let j = 1; j <= m; j++) {
        const t = j / (m + 1);
        const p = lerp(lerp(a, d, t), lerp(b, c, t), inset);
        const q = lerp(lerp(a, d, t), lerp(b, c, t), 1 - inset);
        furrows += `M${f1(p.x)} ${f1(p.y)} L${f1(q.x)} ${f1(q.y)} `;
      }
    }
    return { d: poly([a, b, c, d]), tone: (i + toneShift + Math.floor(hash01(seed + 70 + i) * 2)) % FIELD_TONES.length, furrows: furrows.trim() };
  });
  // A hedge on two or three sides, starting at a corner of the seed's choosing.
  const corners = [tl, tr, br, bl];
  const first = Math.floor(hash01(seed + 80) * 4);
  const sides = 1 + Math.floor(hash01(seed + 81) * 3);
  const hedgePts = Array.from({ length: sides + 1 }, (_, i) => corners[(first + i) % 4]!);
  return { outline: poly(corners), strips: out, hedge: `M${hedgePts.map((p) => `${f1(p.x)} ${f1(p.y)}`).join(" L")}` };
}

/**
 * A river's line ("M x y L x y …", OpenStreetMap's points) with its corners rounded — a river bends, it never turns a
 * sharp corner — but never more than `reach` world px from each corner, so the water stays where the ships, crossings
 * and fronts drawn on it expect it. The same ends; anything that is not such a line comes back unchanged.
 */
export function smoothRiver(d: string, reach: number): string {
  if (!/^M[\d\s.LMe+-]+$/.test(d.trim())) return d;
  return d
    .trim()
    .split(/(?=M)/)
    .map((part) => {
      const nums = part.replace(/[ML]/g, " ").trim().split(/\s+/).map(Number);
      const pts: XY[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i]!, y: nums[i + 1]! });
      if (pts.length < 3 || pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return part.trim();
      const toward = (p: XY, q: XY) => {
        const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        const t = Math.min(0.5, reach / len);
        return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
      };
      let out = `M${f1(pts[0]!.x)} ${f1(pts[0]!.y)}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i]!;
        const a = toward(p, pts[i - 1]!);
        const b = toward(p, pts[i + 1]!);
        out += ` L${f1(a.x)} ${f1(a.y)} Q${f1(p.x)} ${f1(p.y)} ${f1(b.x)} ${f1(b.y)}`;
      }
      const last = pts[pts.length - 1]!;
      return `${out} L${f1(last.x)} ${f1(last.y)}`;
    })
    .join(" ");
}

/**
 * Cloud shadows drifting over the close map at a frame (owner, 12 Nov 2026: the map must look alive, not only its
 * units): a few large soft patches, each two or three overlapping puffs, carried by one wind a few world px a second.
 * A pure function of the frame. Each cloud wraps round a domain larger than the world by its own size, so it leaves the
 * world entirely before it comes back on the other side — no jump is ever seen.
 */
export function cloudShadowsAt(frame: number, fps: number, world: { readonly width: number; readonly height: number }, u: number, seed = 0): CloudPuff[] {
  const size = Math.max(u * 9, Math.min(world.width, world.height) * 0.16);
  // The wind's direction and speed belong to the map (its size and house), not to the frame.
  const windSeed = seed + Math.round(world.width) * 7 + Math.round(world.height) * 13 + Math.round(u * 10) * 3;
  const wind = (hash01(windSeed) - 0.5) * 1.4 + (hash01(windSeed + 1) < 0.5 ? 0 : Math.PI);
  const speed = Math.max(CLOUD_SPEED_MIN, Math.min(CLOUD_SPEED_MAX, u * CLOUD_SPEED_U));
  const vx = Math.cos(wind) * speed;
  const vy = Math.sin(wind) * speed;
  // About a third of the world in shade: clouds spread over the whole drifting domain (the world and a cloud's reach
  // round it), between 3 and 12 of them.
  const margin = size * 1.05 * 1.75 * 2;
  const count = Math.max(3, Math.min(12, Math.round(((world.width + margin) * (world.height + margin) * 0.33) / (Math.PI * size * size * 0.6))));
  const t = frame / fps;
  const out: CloudPuff[] = [];
  for (let i = 0; i < count; i++) {
    const s = windSeed * 17 + i * 29;
    const rx = size * (0.75 + hash01(s) * 0.6);
    const ry = rx * (0.45 + hash01(s + 1) * 0.2);
    const reach = rx * 1.75;
    const px = world.width + reach * 2;
    const py = world.height + reach * 2;
    const cx = -reach + (((hash01(s + 2) * px + vx * t) % px) + px) % px;
    const cy = -reach + (((hash01(s + 3) * py + vy * t) % py) + py) % py;
    const angle = (wind * 180) / Math.PI + (hash01(s + 4) - 0.5) * 30;
    const opacity = 0.08 + hash01(s + 5) * 0.07;
    const along = { x: Math.cos((angle * Math.PI) / 180), y: Math.sin((angle * Math.PI) / 180) };
    const puffs = 2 + Math.floor(hash01(s + 6) * 2);
    for (let j = 0; j < puffs; j++) {
      const off = j === 0 ? 0 : (j === 1 ? 1 : -1) * rx * (0.45 + hash01(s + 7 + j) * 0.3);
      const side = j === 0 ? 0 : (hash01(s + 9 + j) - 0.5) * ry * 0.8;
      const k = j === 0 ? 1 : 0.55 + hash01(s + 11 + j) * 0.25;
      out.push({
        x: cx + along.x * off - along.y * side,
        y: cy + along.y * off + along.x * side,
        rx: rx * k,
        ry: ry * k,
        angle,
        opacity: j === 0 ? opacity : opacity * 0.85,
      });
    }
  }
  return out;
}
