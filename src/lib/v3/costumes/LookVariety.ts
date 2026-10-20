import type { CastCostume, Episode } from "../episode/EpisodeTypes";
import type { V3HairStyle } from "../render/RenderPlanTypes";

/**
 * Every named character must be told apart at a glance (owner direction, 20 Oct 2026: "every character's clothes and
 * hair are different", as on the reference channel). A character with neither headwear nor hair gets hair; two named
 * characters who would look the same (same garment, same main colour, same head) are made different by hair, then by
 * a shade of the main colour. Real people with a likeness are kept as designed and others give way. Crowds are left
 * alone: soldiers in a crowd may share one look.
 */
const HAIR_ROTATION: readonly (readonly [V3HairStyle, string])[] = [
  ["kisa", "#3b2a20"],
  ["dalgali", "#6b4423"],
  ["yan_ayrik", "#1d1b26"],
  ["kivircik", "#4a2f1e"],
  ["geriye", "#8a8580"],
  ["kakul", "#a0522d"],
  ["kisa", "#c9a66b"],
  ["dalgali", "#2b2118"],
];

function lookSignature(k: CastCostume): string {
  const head = k.bas ?? k.sac_parca ?? (k.sac ? `${k.sac.stil}${k.sac.renk.toLowerCase()}` : "");
  return `${k.giysi}|${k.renkler.ana.toLowerCase()}|${head}`;
}

const hairKey = (k: CastCostume) => (k.sac ? `${k.sac.stil}${k.sac.renk.toLowerCase()}` : "");

/** A hex colour lightened (amount > 0) or darkened (amount < 0). */
export function shadeHex(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
  return `#${((1 << 24) | (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).slice(1)}`;
}

export function distinctLooks(episode: Episode): { episode: Episode; fixes: string[] } {
  const fixes: string[] = [];
  const named = episode.oyuncu_kadrosu.filter((c) => c.gorunur && c.kostum);
  // Real people first: they keep their likeness; the invented characters around them change.
  const order = [...named.filter((c) => c.portre), ...named.filter((c) => !c.portre)];
  const usedHair = new Set(named.map((c) => hairKey(c.kostum!)).filter(Boolean));
  const seen = new Set<string>();
  const out = new Map<string, CastCostume>();
  const nextHair = (): readonly [V3HairStyle, string] | undefined => HAIR_ROTATION.find(([s, r]) => !usedHair.has(`${s}${r}`));
  for (const c of order) {
    let k = c.kostum!;
    if (!k.bas && !k.sac && !k.sac_parca) {
      const h = nextHair();
      if (h) {
        k = { ...k, sac: { stil: h[0], renk: h[1] } };
        usedHair.add(`${h[0]}${h[1]}`);
        fixes.push(`${c.id}: başı açıktı, saç verildi (${h[0]})`);
      }
    }
    for (let attempt = 0; seen.has(lookSignature(k)) && attempt < 4; attempt++) {
      const h = !k.bas && !k.sac_parca ? nextHair() : undefined;
      if (h) {
        k = { ...k, sac: { stil: h[0], renk: h[1] } };
        usedHair.add(`${h[0]}${h[1]}`);
        fixes.push(`${c.id}: başka bir karakterle aynı görünüyordu, saçı değişti (${h[0]})`);
      } else {
        const ana = shadeHex(k.renkler.ana, attempt % 2 === 0 ? -0.22 : 0.3);
        k = { ...k, renkler: { ...k.renkler, ana } };
        fixes.push(`${c.id}: başka bir karakterle aynı görünüyordu, ana renk ${ana} oldu`);
      }
    }
    seen.add(lookSignature(k));
    out.set(c.id, k);
  }
  if (!fixes.length) return { episode, fixes };
  return { episode: { ...episode, oyuncu_kadrosu: episode.oyuncu_kadrosu.map((c) => (out.has(c.id) ? { ...c, kostum: out.get(c.id)! } : c)) }, fixes };
}
