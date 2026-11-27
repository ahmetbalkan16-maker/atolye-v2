import type { Episode, EpisodeScene, SceneLine } from "../episode/EpisodeTypes";
import { LONG_FORM_MIN_S } from "./V3Budget";

/**
 * Every video ends with its main character inviting the viewer to subscribe (owner, 13 Nov 2026, after the Siege of
 * Baghdad Short: "videonun sonunda ana karakterlere bir mesaj verdirelim, kanalımıza abone olmayı unutmayın gibi güzel
 * bir cümle söylesin … bunu her video sonunda ana karakter yapsın"). The writer is asked for that line (ScriptPrompts
 * rule 7 and the Shorts rules); this is the free fallback when a script comes back without it: the closing line is
 * given to the main character, or one is added. No model.
 */

/** Words that make a line a subscribe invitation. */
const SUBSCRIBE = /\b(?:subscrib\p{L}*)|abone/iu;

/** Whether a line invites the viewer to subscribe (a long episode has it once, at its very end: LongForm.chapterProblems). */
export const invitesToSubscribe = (text: string): boolean => SUBSCRIBE.test(text);

/**
 * The open question a Short's closing invitation opens with (ScriptPrompts, 27 Nov 2026: "So who blinks first now?
 * Subscribe to …"), for the pinned comment (ChannelGoals.subscribeTexts): the last question sentence before the
 * invitation, bracketed stage directions left out. Undefined when the last line is no invitation or asks nothing.
 */
export function closingQuestion(episode: Pick<Episode, "sahneler">): string | undefined {
  const end = episode.sahneler.at(-1)?.satirlar.at(-1);
  if (!end || !invitesToSubscribe(end.metin)) return undefined;
  const speech = end.metin.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  // The last question sentence before the invitation's word ("Who blinks first now?").
  const asked = speech.slice(0, speech.search(SUBSCRIBE)).match(/[^.!?…]*\?/g)?.at(-1)?.trim();
  return asked && /\p{L}/u.test(asked) ? asked : undefined;
}

/**
 * The episode's main character: a visible character named in the topic or the title (the Baghdad Short's first pick by
 * lines alone was a Safavid foot soldier, not Murad IV), else the one with the most lines (ties: the first in the cast).
 * `among` limits the pick to those characters (a long video's last scene: closingSpeaker).
 */
export function mainCharacter(episode: Pick<Episode, "oyuncu_kadrosu" | "sahneler"> & { readonly baslik?: string }, topic = "", among?: ReadonlySet<string>): string | undefined {
  const visible = episode.oyuncu_kadrosu.filter((c) => c.gorunur && (!among || among.has(c.id))).map((c) => c.id);
  if (!visible.length) return undefined;
  const lines = new Map(visible.map((id) => [id, 0]));
  for (const s of episode.sahneler) for (const l of s.satirlar) if (lines.has(l.karakter)) lines.set(l.karakter, lines.get(l.karakter)! + 1);
  const told = `${topic} ${episode.baslik ?? ""}`.toLocaleLowerCase("en-US");
  for (const c of episode.oyuncu_kadrosu) if (lines.has(c.id) && c.ad.trim().length > 2 && told.includes(c.ad.trim().toLocaleLowerCase("en-US"))) lines.set(c.id, lines.get(c.id)! + 1000);
  return visible.reduce((best, id) => (lines.get(id)! > lines.get(best)! ? id : best), visible[0]!);
}

/** The fallback invitation, in the episode's language, with the channel's name. */
export function closingText(dil: "tr" | "en", channel: string): { metin: string; balon: string } {
  return dil === "tr"
    ? { metin: `Bu hikâye hoşuna gittiyse ${channel} kanalına abone olmayı unutma — tarih burada daha eğlenceli!`, balon: "Abone olmayı unutma!" }
    : { metin: `If you enjoyed this story, subscribe to ${channel} — history is more fun here!`, balon: "Don't forget to subscribe!" };
}

/** The visible characters a scene puts on screen: its blocking, its speakers and those spoken to (Director.placeScene). */
export function onStage(scene: Pick<EpisodeScene, "sahne_duzeni" | "satirlar">, visible: ReadonlySet<string>): Set<string> {
  const ids = [...(scene.sahne_duzeni ?? []).map((b) => b.karakter), ...scene.satirlar.flatMap((l) => [l.karakter, typeof l.hedef === "string" ? l.hedef : ""])];
  return new Set(ids.filter((id) => visible.has(id)));
}

/**
 * Who speaks the closing invitation. A Short is one moment: its main character is put on stage if missing (the
 * Baghdad Short's last scene staged only a soldier; the owner wanted Murad IV). A long video's last scene can be decades
 * and countries away from the chapters its main character filled (14 Nov 2026 audit: a 20–30 minute episode's subscribe
 * line could go to a character who is not on stage there, dragged into a scene he was never in): there the line goes to
 * the main character among those on stage (ScriptPrompts rule 7: "on stage in the last scene"); with nobody visible on
 * stage, the main character is still brought on.
 */
export function closingSpeaker(episode: Pick<Episode, "oyuncu_kadrosu" | "sahneler" | "hedef_sure_sn"> & { readonly baslik?: string }, topic = ""): string | undefined {
  const main = mainCharacter(episode, topic);
  const last = episode.sahneler.at(-1);
  if (!main || !last || last.harita !== undefined || !(episode.hedef_sure_sn > LONG_FORM_MIN_S)) return main;
  const present = onStage(last, new Set(episode.oyuncu_kadrosu.filter((c) => c.gorunur).map((c) => c.id)));
  return present.has(main) || !present.size ? main : mainCharacter(episode, topic, present);
}

/**
 * The episode with its last line the main character's subscribe invitation, and what was done (for the log). A last
 * scene on the map gets no new speaker (a character without a badge cannot speak there): the line is added to the last
 * stage scene only when it is the last scene; else, on a map ending, an invitation already written keeps its speaker.
 */
export function ensureClosingLine(episode: Episode, dil: "tr" | "en", channel: string, topic = ""): { episode: Episode; fixes: string[] } {
  const main = closingSpeaker(episode, topic);
  const last = episode.sahneler.at(-1);
  if (!main || !last || !last.satirlar.length) return { episode, fixes: [] };
  const end = last.satirlar.at(-1)!;
  if (end.karakter === main && SUBSCRIBE.test(end.metin)) return { episode, fixes: [] };
  const onMap = last.harita !== undefined;
  const staged = !onMap && onStage(last, new Set([main])).has(main);
  if (onMap) return { episode, fixes: [] };
  const blocking = staged ? last.sahne_duzeni : [...(last.sahne_duzeni ?? []), { karakter: main, x: 0.5 }];
  let satirlar: SceneLine[];
  let fix: string;
  if (SUBSCRIBE.test(end.metin)) {
    satirlar = [...last.satirlar.slice(0, -1), { ...end, karakter: main, duygu: "mutlu", jest: "el_salla" }];
    fix = `son sahnenin abone daveti ana karaktere (${main}) verildi`;
  } else {
    const t = closingText(dil, channel);
    satirlar = [...last.satirlar, { karakter: main, metin: t.metin, balon: t.balon, duygu: "mutlu", jest: "el_salla", kurgu: true }];
    fix = `son satır eklendi: ana karakter (${main}) kanala abone daveti yapar`;
  }
  const sahneler = [...episode.sahneler.slice(0, -1), { ...last, satirlar, ...(blocking ? { sahne_duzeni: blocking } : {}) }];
  return { episode: { ...episode, sahneler }, fixes: [fix] };
}
