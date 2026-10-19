import type { CastEntry } from "../episode/EpisodeTypes";
import type { V3CastMember, V3CharacterStyle } from "../render/RenderPlanTypes";

/** Episode cast (Turkish keys) → render cast. The off-screen narrator has no render member. */
export function toRenderCast(cast: readonly CastEntry[], style: V3CharacterStyle): V3CastMember[] {
  return cast
    .filter((c) => c.gorunur && c.kostum)
    .map((c) => {
      const k = c.kostum!;
      return {
        id: c.id,
        name: c.ad,
        scale: c.olcek ?? 1,
        style,
        costume: {
          pack: c.kostum_paketi,
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
        },
      };
    });
}
