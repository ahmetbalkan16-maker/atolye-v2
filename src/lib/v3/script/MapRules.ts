import type { Episode } from "../episode/EpisodeTypes";

// English words by word boundary; Turkish stems without one (\b does not see "ü" as a letter: "yürüdü").
const MOVES = /\b(?:sail(?:s|ed)?|march(?:es|ed)?|invad(?:e|es|ed)|invasion|cross(?:es|ed)|fleet|armada|campaign|conquer(?:s|ed)?|voyage|expedition)\b|sefer|donanma|işgal|fethet|yürüd|denizi geç/iu;

/**
 * The owner's way of telling (21 Oct 2026): what moves between places is told on the living map. As repair problems:
 * a scene placed on a map without a "harita" (the Mongol test named its outro "Map of East Asia" and drew a set); a map
 * on which nothing happens; a story that sails, marches or invades between places without any map showing the route
 * (the Mongol fleet's crossing was told only on a beach).
 */
export function mapProblems(episode: unknown): string[] {
  if (!episode || typeof episode !== "object" || !Array.isArray((episode as Episode).sahneler)) return [];
  const scenes = (episode as Episode).sahneler;
  const out: string[] = [];
  for (const s of scenes) {
    const h = s.harita;
    if (!h?.merkez && /\b(map|harita)\b/i.test(s.mekan ?? "")) out.push(`scene "${s.id}" is set on a map ("mekan": "${s.mekan}") but has no "harita": give it one (merkez, genislik_km, and what moves on it — MAP NARRATION)`);
    if (h?.merkez) {
      const living =
        (h.kamera?.length ?? 0) > 0 ||
        (h.oklar?.length ?? 0) > 0 ||
        (h.savaslar?.length ?? 0) > 0 ||
        (h.rozetler ?? []).some((r) => (r.yol?.length ?? 0) > 0) ||
        (h.ordular ?? []).some((o) => (o.yol?.length ?? 0) > 0) ||
        (h.cizgiler ?? []).some((c) => (c.satir ?? 0) > 0) ||
        (h.bolgeler ?? []).some((b) => (b.satir ?? 0) > 0 || b.bitis_satir !== undefined || b.yayilma !== undefined);
      if (!living) out.push(`map scene "${s.id}" shows nothing happening: march an army ("ordular" with "yol" and "yol_satir"), sweep a conquest ("yayilma"), draw a route (oklar, or a rozet with "yol"), a battle, a camera move or a border change, each on the line that tells it`);
    }
  }
  // Every character scene lives in its drawn set (owner, 22 Oct 2026: "the viewer must live the moment").
  for (const s of scenes) if (!s.harita?.merkez && !s.ortam) out.push(`character scene "${s.id}" has no "ortam": give it its living set (zaman, manzara, uslup, hava, isik) — LIVING SETS / ORTAM`);
  const routes = scenes.some((s) => (s.harita?.oklar?.length ?? 0) > 0 || (s.harita?.rozetler ?? []).some((r) => (r.yol?.length ?? 0) > 0) || (s.harita?.ordular ?? []).some((o) => (o.yol?.length ?? 0) > 0));
  const moving = scenes.flatMap((s) => s.satirlar).filter((l) => MOVES.test(l.metin)).length;
  if (!routes && moving >= 2) out.push(`the story moves between places (${moving} lines tell a voyage, march, crossing or invasion) but no map shows the route: tell each crossing or campaign on a map scene with its route drawn (oklar, or a rozet with "yol" + "yol_satir") — SCENE KIND BY SCALE`);
  return out;
}
