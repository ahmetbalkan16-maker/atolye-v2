import type { CastCostume, CastEntry, Episode } from "../episode/EpisodeTypes";
import type { V3CastMember, V3CharacterStyle, V3Costume, V3Face } from "../render/RenderPlanTypes";

function toCostume(pack: string, k: CastCostume): V3Costume {
  return {
    pack,
    garment: k.giysi,
    colors: { main: k.renkler.ana, second: k.renkler.ikincil, inner: k.renkler.ic, trim: k.renkler.sus },
    ...(k.bas ? { head: k.bas } : {}),
    ...(k.sakal ? { beard: k.sakal } : {}),
    ...(k.biyik ? { mustache: k.biyik } : {}),
    ...(k.el_on ? { handFront: k.el_on } : {}),
    ...(k.el_arka ? { handBack: k.el_arka } : {}),
    ...(k.sirt ? { back: k.sirt } : {}),
    collar: k.yaka ?? "yok",
    shoes: k.ayakkabi,
    ...(k.sac ? { hair: { style: k.sac.stil, color: k.sac.renk } } : {}),
  };
}

/** Episode cast (Turkish keys) → render cast; `faces`: portrait faces by cast id. The off-screen narrator has no render member. */
export function toRenderCast(cast: readonly CastEntry[], style: V3CharacterStyle, faces: ReadonlyMap<string, V3Face> = new Map()): V3CastMember[] {
  return cast
    .filter((c) => c.gorunur && c.kostum)
    .map((c) => {
      const face = faces.get(c.id);
      return { id: c.id, name: c.ad, scale: c.olcek ?? 1, style, costume: { ...toCostume(c.kostum_paketi, c.kostum!), ...(face ? { face } : {}) } };
    });
}

/** Render-cast id of a scene's crowd group. */
export function crowdId(sceneId: string, index: number): string {
  return `kalabalik-${sceneId}-${index}`;
}

/** One render-cast member per crowd group of every scene (their costumes load like the actors'). */
export function crowdCast(episode: Episode, style: V3CharacterStyle): V3CastMember[] {
  return episode.sahneler.flatMap((s) => (s.kalabalik ?? []).map((g, i) => ({ id: crowdId(s.id, i), name: g.ad, scale: 0.94, style, costume: toCostume(g.kostum_paketi, g.kostum) })));
}
