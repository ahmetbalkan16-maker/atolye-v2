import type { SceneBlocking } from "../../character/SceneBlocking";
import type { CharacterArtDirection } from "../../character/SvgSceneRenderer";
import { characterAnimationFrame, isCharacterAction, type CharacterAction, type CharacterAnimationPlan } from "./CharacterAnimation";
import type { CharacterFrameOverride } from "../../character/SvgSceneRenderer";

export interface CharacterStoryBeat {
  readonly actorId: string;
  readonly action: CharacterAction;
  readonly start: number;
  readonly end: number;
}
export interface CharacterSceneDirection {
  readonly art: CharacterArtDirection;
  /** Estimated scene-relative timing from visual scene sentences; never forced audio alignment. */
  readonly timing: "SCENE_TEXT_ESTIMATE";
  readonly beats: readonly CharacterStoryBeat[];
}
const fold = (s: string) => s.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g");

/** Only explicit words choose historical context. Religion is never inferred from country or a name. */
export function planCharacterSceneDirection(text: string, blocking: SceneBlocking): CharacterSceneDirection {
  const words = fold(text.slice(0, 8192));
  const has = (r: RegExp) => r.test(words);
  const culture: CharacterArtDirection["culture"] = has(/\b(osmanli|ottoman|padisah|fatih|kanuni)\b/) ? "OTTOMAN" : has(/\b(bizans|byzantine)\b/) ? "BYZANTINE" : has(/\b(firavun|pharaoh|ramesses|ramses|nemes)\b/) ? "EGYPTIAN" : has(/\b(roma|roman|caesar|sezar)\b/) ? "ROMAN" : has(/\b(mogol|mongol|gokturk|attila|hun)\b/) ? "STEPPE" : has(/\b(avrupa|european|ingiliz|english|fransiz|french|tudor)\b/) ? "WESTERN" : "UNKNOWN";
  const faith: CharacterArtDirection["faith"] = has(/\b(islam|musluman|muslim)\b/) ? "ISLAM" : has(/\b(hristiyan|christian)\b/) ? "CHRISTIANITY" : has(/\b(ra tapinagi|ancient egyptian religion|antik misir dini)\b/) ? "ANCIENT_EGYPT" : "UNSPECIFIED";
  const court = blocking.props.some(p => p.prop === "THRONE");
  const art: CharacterArtDirection = { version: "1", culture, faith, roles: blocking.characters.map((c, i) => ({ id: c.id, role: court ? i === 0 ? "RULER" : c.handProp === "SPEAR" || c.handProp === "SWORD" ? "GUARD" : "ADVISOR" : i === 0 ? "NARRATOR" : "CITIZEN" })) };
  const sentences = words.split(/[.!?;\n]+/).filter(s => s.trim()).slice(0, 8);
  const total = sentences.reduce((n, s) => n + Math.max(1, s.trim().split(/\s+/).length), 0);
  let used = 0;
  const beats: CharacterStoryBeat[] = [];
  const actorId = blocking.characters[0]?.id;
  if (actorId) for (const sentence of sentences) {
    const weight = Math.max(1, sentence.trim().split(/\s+/).length);
    // Do not turn a negated event into an enacted fact. Unknown prose keeps the original scene action.
    const negated = /\b(not|never|without|degil|yapmadi|etmedi|olmadi|savasmadi|dovusmedi)\b|\b\w+(?:madi|medi)\b/.test(sentence);
    let action: CharacterAction | null = null;
    if (!negated) {
      if (/\b(e[g]?il\w*|selam\w*|bow\w*)\b/.test(sentence)) action = "BOW";
      else if (/\b(otur\w*|sit\w*|tahta gecer)\b/.test(sentence)) action = "SIT";
      else if (/\b(zafer\w*|kutla\w*|celebrat\w*|cheer\w*)\b/.test(sentence)) action = "CHEER";
      else if (/\b(goster\w*|isaret\w*|point\w*)\b/.test(sentence)) action = "POINT";
      else if (/\b(kilic\w*|sword\w*)\b/.test(sentence) && /\b(saldir\w*|attack\w*|savur\w*|swing\w*)\b/.test(sentence)) action = "FIGHT";
      else if (/\b(konus\w*|anlat\w*|speak\w*|explain\w*|talk\w*)\b/.test(sentence)) action = "TALK";
    }
    if (action) beats.push({ actorId, action, start: used / total, end: (used + weight) / total });
    used += weight;
  }
  return { art, timing: "SCENE_TEXT_ESTIMATE", beats };
}

export function findCharacterStoryBeatProblems(value: unknown, blocking: SceneBlocking): string[] {
  if (!Array.isArray(value) || value.length > 8) return ["STORY_BEATS_SHAPE"];
  const ids = new Set(blocking.characters.map(c => c.id));
  const ends = new Map<string, number>();
  for (const b of value) {
    if (!b || typeof b !== "object" || Object.keys(b).length !== 4 || !["actorId", "action", "start", "end"].every(k => Object.hasOwn(b, k)) || !ids.has(b.actorId) || !isCharacterAction(b.action) || ["WALK", "RUN", "FALL", "KNEEL_DOWN"].includes(b.action) || !Number.isFinite(b.start) || !Number.isFinite(b.end) || b.start < 0 || b.end > 1 || b.start >= b.end || b.start < (ends.get(b.actorId) ?? 0)) return ["STORY_BEAT_INVALID"];
    ends.set(b.actorId, b.end);
  }
  return [];
}

/** Existing loop remains unchanged on old assets. New cues are bounded to each selected sentence interval. */
export function characterDirectedFrame(blocking: SceneBlocking, plan: CharacterAnimationPlan, beats: readonly CharacterStoryBeat[], t: number, duration: number): Record<string, CharacterFrameOverride> {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600 || !Number.isFinite(t) || t < 0) throw new Error("CHARACTER_DIRECTION_TIME_INVALID");
  const frames = characterAnimationFrame(blocking, plan, t);
  for (const beat of beats) {
    if (t < beat.start * duration || t >= beat.end * duration) continue;
    const actor = plan.actors.find(a => a.id === beat.actorId);
    if (!actor || actor.action === "WALK" || actor.action === "RUN" || actor.action === "FALL" || actor.action === "KNEEL_DOWN") continue;
    const altered = { ...plan, actors: plan.actors.map(a => a.id === beat.actorId ? { ...a, action: beat.action, toX: null, delaySeconds: 0 } : a) };
    const directed = characterAnimationFrame(blocking, altered, t - beat.start * duration)[beat.actorId]!;
    const base = frames[beat.actorId]!;
    // Blend in/out to avoid snapping from speaking to pointing or bowing.
    const blend = Math.min(1, (t - beat.start * duration) / 0.25, (beat.end * duration - t) / 0.25);
    const scalar = (a: number, b: number) => a + (b - a) * blend;
    const limb = (a: { upper: number; bend: number }, b: { upper: number; bend: number }) => ({ upper: scalar(a.upper, b.upper), bend: scalar(a.bend, b.bend) });
    frames[beat.actorId] = { x: base.x, mouthOpen: beat.action === "TALK" ? directed.mouthOpen : base.mouthOpen, pose: { torsoLean: scalar(base.pose.torsoLean, directed.pose.torsoLean), bodyRotation: scalar(base.pose.bodyRotation, directed.pose.bodyRotation), armFront: limb(base.pose.armFront, directed.pose.armFront), armBack: limb(base.pose.armBack, directed.pose.armBack), legFront: limb(base.pose.legFront, directed.pose.legFront), legBack: limb(base.pose.legBack, directed.pose.legBack) } };
  }
  return frames;
}
