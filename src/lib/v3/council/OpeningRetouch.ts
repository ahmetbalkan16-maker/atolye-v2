import { cameraChangeFrames } from "../director/Director";
import type { Episode, SceneCameraCue, SfxId } from "../episode/EpisodeTypes";
import { sfxCues } from "../mix/Mixer";
import type { OpeningGap, StudioMade } from "../publish/ChannelGoals";
import type { V3RenderPlan } from "../render/RenderPlanTypes";
import type { EpisodeTimeline } from "../timeline/Timeline";

/**
 * The retouch brain's fix for a Short's opening (owner, 23 Nov 2026, "diğer önerileri de kabul ediyorum"): a camera or
 * an effect missing in the first scenes (ChannelGoals.openingPlanCheck) is put into the script for the next retouch
 * round, from a fixed menu and without a model — a punch-in on who acts there, a sound on the scene's first line. A map
 * scene's camera is the map's own design (MapBuilder frames each line's action; a map is never cut), so it is reported,
 * not changed. Pure apart from what it imports.
 */
export interface OpeningFix {
  readonly sahne: string;
  /** A camera cue for a stage scene that had no camera at all (seconds from the scene's start, like the writer's). */
  readonly kamera?: SceneCameraCue;
  /** A sound effect on a line of a scene that had none (heard at the line's start, Mixer.sfxCues). */
  readonly sfx?: { readonly satir: number; readonly sfx: SfxId };
}

/**
 * What the studio itself gives each scene beyond the writer's plan: a visible camera change the Director made in its
 * shot (Director.cameraChangeFrames: a cut, a punch-in, a map moving to a new view) and an effect the viewer hears or
 * sees there (the Mixer's automatic sounds, a stage act's effect). Read by openingPlanCheck as "made".
 */
export function studioMade(plan: Pick<V3RenderPlan, "shots" | "width" | "stage">, episode: Pick<Episode, "sahneler" | "oyuncu_kadrosu">, timeline: EpisodeTimeline): StudioMade {
  const width = plan.stage?.width ?? plan.width;
  const kamera = new Set(plan.shots.filter((s) => cameraChangeFrames(s, width).length).map((s) => s.sceneId));
  const efekt = new Set<string>();
  // A cue belongs to the scene it is heard in; a whoosh just before a scene's start is that scene's way in.
  for (const c of sfxCues(episode as Episode, timeline)) {
    const si = timeline.scenes.reduce((at, st, i) => (st.start <= c.t + 0.2 ? i : at), -1);
    const id = si >= 0 ? episode.sahneler[si]?.id : undefined;
    if (id) efekt.add(id);
  }
  for (const sc of episode.sahneler) if (sc.satirlar.some((l) => l.oyun?.some((a) => a.efekt))) efekt.add(sc.id);
  return { kamera, efekt };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The fixes for the opening's gaps: a stage scene without a camera gets a punch-in ("zoom" cue: a snap to the face) on
 * the first visible character who speaks there, a little into their line, else on the first one placed or acting on the
 * stage; a scene without an effect gets a sound on its first line without one (a pop on the very first scene, a whoosh
 * on a later one). A gap with no such fix (a map's camera, an empty set) is left out: no round is opened for it.
 */
export function openingFixes(episode: Pick<Episode, "sahneler" | "oyuncu_kadrosu">, timeline: EpisodeTimeline, gaps: readonly OpeningGap[]): OpeningFix[] {
  const visible = new Set(episode.oyuncu_kadrosu.filter((c) => c.gorunur).map((c) => c.id));
  return gaps.flatMap((g) => {
    const si = episode.sahneler.findIndex((s) => s.id === g.sahne);
    const sc = episode.sahneler[si];
    const st = timeline.scenes[si];
    if (!sc || !st) return [];
    const lines = timeline.lines.filter((l) => l.sceneIndex === si);
    const mapped = Boolean(sc.harita?.merkez && sc.harita.genislik_km);
    let kamera: SceneCameraCue | undefined;
    if (g.kamera && !mapped && sc.kip !== "fotograf" && !sc.kamera?.length) {
      const speaks = lines.find((l) => visible.has(l.speaker));
      const placed = [...(sc.sahne_duzeni ?? []).map((b) => b.karakter), ...sc.satirlar.flatMap((l) => (l.oyun ?? []).map((a) => a.karakter))].find((id) => visible.has(id));
      const first = lines[0];
      if (speaks) kamera = { tip: "zoom", t: round2(speaks.start - st.start + Math.min(0.5, (speaks.end - speaks.start) / 3)), hedef: speaks.speaker };
      else if (placed && first) kamera = { tip: "zoom", t: round2(first.start - st.start + Math.min(0.5, (first.end - first.start) / 3)), hedef: placed };
    }
    const quiet = g.efekt ? sc.satirlar.findIndex((l) => !l.sfx) : -1;
    const sfx = quiet >= 0 ? { satir: quiet, sfx: (si === 0 ? "pop" : "whoosh") as SfxId } : undefined;
    return kamera || sfx ? [{ sahne: g.sahne, ...(kamera ? { kamera } : {}), ...(sfx ? { sfx } : {}) }] : [];
  });
}

/** The script with the opening's fixes; a scene that already has a camera cue, or a line that has a sound, keeps its own. */
export function applyOpeningFixes(episode: Episode, fixes: readonly OpeningFix[]): Episode {
  return {
    ...episode,
    sahneler: episode.sahneler.map((sc) => {
      const fix = fixes.find((x) => x.sahne === sc.id);
      if (!fix) return sc;
      const kamera = fix.kamera && !sc.kamera?.length ? [fix.kamera] : sc.kamera;
      const satirlar = sc.satirlar.map((l, li) => (fix.sfx && fix.sfx.satir === li && !l.sfx ? { ...l, sfx: fix.sfx.sfx } : l));
      return { ...sc, ...(kamera ? { kamera } : {}), satirlar };
    }),
  };
}

/** One fix in a line (Turkish, for the log and the retouch debate). */
export function openingFixLine(fix: OpeningFix): string {
  return [
    fix.kamera ? `${fix.sahne}: kamera ${fix.kamera.hedef ?? ""} yakın çekime ${fix.kamera.t.toFixed(1)}. sn'de` : "",
    fix.sfx ? `${fix.sahne}#${fix.sfx.satir}: ${fix.sfx.sfx} efekti` : "",
  ].filter(Boolean).join("; ");
}
