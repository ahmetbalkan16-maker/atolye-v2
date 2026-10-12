import crypto from "node:crypto";

import {
  CHARACTER_ANIMATION_FPS,
  CHARACTER_ANIMATION_SCHEMA_VERSION,
  findCharacterAnimationProblems,
  type CharacterAction,
  type CharacterActorPlan,
  type CharacterAnimationPlan,
} from "./CharacterAnimation";
import type { CameraBeat } from "../../character/CameraBeat";
import type { CharacterExpression } from "../../character/CharacterExpression";
import type { CharacterPose } from "../../character/CharacterPose";
import { findCharacterSceneRequestProblems, type CharacterSceneRequest } from "../../character/CharacterSceneManifest";
import type { HistoricalCostumeHint } from "../../character/HistoricalCostumeHint";
import type { HandProp, StageProp } from "../../character/PropLibrary";
import type { BlockedArrow, BlockedCharacter, BlockedProp, SceneBlocking, StageBackdrop, StageTime } from "../../character/SceneBlocking";

/**
 * Atölye stick-figure scene planner — turns one scene's description into a blocking and an animation plan.
 *
 * Deterministic and local: it reads the words of the scene (the visual prompt the visuals stage wrote, its search
 * keywords), in Turkish or English, and chooses from the engine's closed vocabulary. No model is asked, so the same
 * scene always gets the same picture, and a scene the rules do not recognise still gets a narrator figure instead of
 * nothing. Variety between scenes comes from a hash of the scene, not from chance.
 *
 * The plan is a reenactment of what the text describes, never a claim about how it looked: the scene is labelled in
 * the image and its classification says it is evidence of nothing.
 */
export interface CharacterScenePlanInput {
  readonly sceneId: number;
  /** The scene's own words: its visual prompt, description or narration. */
  readonly text: string;
  readonly keywords?: readonly string[];
  readonly language?: "tr" | "en";
  /** New assets may prioritize an explicitly royal palace setting over incidental verbs. */
  readonly contextualDirection?: boolean;
}

export type CharacterSceneKind =
  | "BATTLE" | "MARCH" | "RALLY" | "CELEBRATION" | "COURT" | "COUNCIL" | "VOYAGE"
  | "BUILD" | "MARKET" | "SCHOLAR" | "PRAYER" | "JOURNEY" | "DEATH" | "NARRATOR"
  | "TECHNOLOGY" | "ECONOMY" | "POLITICS";
// Modern explainers use the same rig, props and worker, rather than an AI image model.

export interface CharacterScenePlan {
  readonly kind: CharacterSceneKind;
  readonly request: CharacterSceneRequest;
  readonly animation: CharacterAnimationPlan;
}

type Stems = readonly string[];

/**
 * Stems are matched at the start of a word, on text folded to ASCII. A trailing `$` makes it a whole word. The kind
 * with the most matching stems wins (times its weight); on a tie the earlier rule wins.
 */
const KIND_RULES: readonly (readonly [CharacterSceneKind, Stems, number?])[] = [
  // A death or a wound is the point of the scene even when soldiers and walls are in it too.
  ["DEATH", ["death", "dies", "died", "dying", "killed", "slain", "funeral", "wounded", "assassinat", "execut", "olum", "oldu", "olur$", "olen", "sehit", "cenaze", "yarali", "suikast", "idam"], 2],
  // A leader speaking to the army: the scene is the speech, not the fight it prepares.
  ["RALLY", ["command$", "commands", "commanded", "commanding", "order$", "orders", "address", "speech", "rally", "rallies", "rallied", "inspir", "exhort", "issues", "before his army", "before the army", "emir$", "emretti", "hitap", "nutuk", "seslen", "ferman"]],
  ["BATTLE", ["battle", "fight", "attack", "assault", "clash", "combat", "war$", "warfare", "charge", "storm", "duel", "savas", "saldir", "carpis", "muharebe", "hucum", "catis", "dovus", "cenk"]],
  ["MARCH", ["march", "advanc", "army", "armies", "troops", "soldier", "siege", "besieg", "invad", "approach", "ilerle", "yuru", "ordu", "asker", "kusat", "sefer", "akin"]],
  ["CELEBRATION", ["victory", "celebrat", "triumph", "cheer", "conquest", "rejoic", "zafer", "kutla", "sevin", "fetih", "fethet", "fethedil", "galip", "bayram"]],
  ["VOYAGE", ["ship", "fleet", "sail", "navy", "naval", "voyage", "gemi", "donanma", "yelken", "kadirga"]],
  ["COUNCIL", ["council", "meeting", "negotiat", "treaty", "ambassador", "envoy", "strategy", "discuss", "debate", "advisor", "vizier", "plan$", "plans", "planning", "divan", "meclis", "antlasma", "elci", "toplanti", "strateji", "vezir", "danis", "muzakere"]],
  ["COURT", ["sultan", "king", "emperor", "empress", "queen", "ruler", "throne", "enthron", "coronation", "caliph", "khan$", "padisah", "hukumdar", "kral", "imparator", "taht", "halife", "hakan", "culus", "hanedan", "firavun", "pharaoh"]],
  ["BUILD", ["build", "construct", "worker", "mason", "erect", "insa", "isci", "yapim", "yapildi", "kurulus", "tas$", "taslar"]],
  ["MARKET", ["market", "bazaar", "merchant", "trade", "trading", "street", "bustling", "economy", "economic", "carsi", "pazar", "tuccar", "ticaret", "sokak", "esnaf", "ekonomi"]],
  ["SCHOLAR", ["scholar", "book", "writ", "scien", "teach", "study", "astronom", "poet", "philosoph", "alim", "kitap", "yazdi", "yazar", "bilim", "ogret", "ders", "sair", "medrese", "felsef"]],
  ["PRAYER", ["pray", "worship", "dua$", "namaz", "ibadet", "secde"]],
  ["TECHNOLOGY", ["teknolo", "bilgisayar", "yazilim", "internet", "robot", "yapay zeka", "computer", "software", "technology", "artificial intelligence"]],
  ["ECONOMY", ["enflasyon", "faiz", "borsa", "finans", "banka", "inflation", "interest rate", "stock market", "banking"]],
  ["POLITICS", ["siyaset", "politika", "secim", "oy$", "demokrasi", "parlamento", "politic", "election", "democrac", "parliament"]],
  ["JOURNEY", ["journey", "travel", "migrat", "nomad", "caravan", "goc", "yolculuk", "kervan", "gocebe"]],
];

const BACKDROP_RULES: readonly (readonly [StageBackdrop, Stems])[] = [
  // A city's name is not its walls: only words for walls and sieges draw them.
  ["CITY_WALLS", ["wall", "fortress", "castle", "siege", "besieg", "rampart", "battlement", "citadel", "gate", "kale", "hisar", "sur$", "surlar", "suru$", "kusat", "burc"]],
  ["SEA", ["sea$", "seas$", "ocean", "ship", "fleet", "navy", "naval", "harbo", "bosphorus", "golden horn", "strait", "shore", "coast", "deniz", "gemi", "donanma", "liman", "bogaz", "halic", "sahil", "kiyi"]],
  ["INTERIOR", ["palace", "throne", "court$", "council", "hall", "chamber", "room", "mosque", "church", "cathedral", "library", "interior", "saray", "taht", "divan", "meclis", "oda$", "cami", "kilise", "kutuphane", "medrese", "salon"]],
  ["MOUNTAINS", ["mountain", "hill", "cliff", "alps", "dag$", "daglar", "tepe", "gecit", "yayla"]],
  ["FIELD", ["field", "plain", "battlefield", "camp", "meadow", "steppe", "army", "troops", "march", "ova$", "ovasi", "bozkir", "meydan", "ordu", "ordugah", "kamp", "sefer", "savas"]],
];

const NIGHT: Stems = ["night", "dark", "moon", "midnight", "gece", "karanlik", "mehtap"];
const DUSK: Stems = ["dusk", "sunset", "dawn", "evening", "twilight", "sunrise", "aksam", "safak", "gun batimi", "alacakaranlik", "seher"];

const OTTOMAN: Stems = ["ottoman", "osmanli", "turk", "sultan", "padisah", "janissar", "yeniceri", "seljuk", "selcuk", "mehmed", "mehmet", "fatih", "sinan", "kanuni", "suleyman"];
const WESTERN: Stems = ["byzantin", "bizans", "roman", "roma", "greek", "knight", "sovalye", "crusade", "hacli", "latin", "venetian", "venedik", "genoese", "ceneviz", "constantine", "konstantin", "defender", "savunucu"];
const STEPPE: Stems = ["hun$", "huns", "hunlar", "mongol", "mogol", "nomad", "gocebe", "gokturk", "attila", "atilla", "steppe", "bozkir", "kipcak"];
const RIVALRY: Stems = ["against", "versus", "enemy", "enemies", "defender", "defend", "opponent", "rival", "dusman", "savunucu", "savun", "karsi", "rakip"];

const PROP_RULES: readonly (readonly [StageProp, Stems])[] = [
  ["CANNON", ["cannon", "artiller", "bombard", "gun$", "guns$", "topcu", "toplar", "topu$", "humbara"]],
  ["TENT", ["tent", "camp", "cadir", "ordugah", "otag"]],
  ["HORSE", ["horse", "cavalry", "mounted", "rider", "atli", "suvari", "akinci"]],
  ["TREE", ["forest", "tree", "garden", "orman", "agac", "bahce"]],
  ["TABLE", ["table", "map$", "maps$", "masa", "harita"]],
  ["TOWER", ["tower", "kule", "minaret", "minare"]],
];

const fold = (value: string) => value
  .replace(/İ/g, "i").replace(/I/g, "i").toLowerCase()
  .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c")
  .replace(/[âà]/g, "a").replace(/[îì]/g, "i").replace(/[ûù]/g, "u")
  .normalize("NFD").replace(/\p{M}/gu, "")
  .replace(/[^a-z0-9]+/g, " ");

function matches(text: string, stems: Stems): number {
  let count = 0;
  for (const stem of stems) {
    const whole = stem.endsWith("$");
    const body = (whole ? stem.slice(0, -1) : stem).replace(/ /g, "\\s+");
    if (new RegExp(`(?:^|\\s)${body}${whole ? "(?=\\s|$)" : ""}`).test(text)) count += 1;
  }
  return count;
}

/** A small deterministic source of variety, seeded by the scene. */
function seeded(seed: string) {
  let state = crypto.createHash("sha256").update(seed, "utf8").digest().readUInt32BE(0) || 1;
  const next = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 0x100000000; };
  return {
    next,
    pick: <T>(values: readonly T[]): T => values[Math.floor(next() * values.length) % values.length]!,
    between: (low: number, high: number) => low + (high - low) * next(),
  };
}

const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
/** The deepest a figure or a prop may stand on the sea backdrop and still be on the shore (renderer: 900 - 260·d ≥ 760). */
const SEA_SHORE_DEPTH = 0.5;

interface Figure {
  readonly x: number; readonly depth: number; readonly facing: "LEFT" | "RIGHT";
  readonly pose: CharacterPose; readonly expression: CharacterExpression; readonly costume: HistoricalCostumeHint;
  readonly handProp: HandProp | null; readonly action: CharacterAction; readonly toX?: number; readonly delay?: number;
}

export function classifyCharacterScene(input: CharacterScenePlanInput): {
  kind: CharacterSceneKind; backdrop: StageBackdrop; time: StageTime; text: string;
} {
  const text = ` ${fold([input.text, ...(input.keywords ?? [])].join(" "))} `;
  let kind: CharacterSceneKind = "NARRATOR";
  let best = 0;
  for (const [candidate, stems, weight = 1] of KIND_RULES) {
    const score = matches(text, stems) * weight;
    if (score > best) { best = score; kind = candidate; }
  }
  // A historical technology scene must never acquire a modern computer merely
  // because the prompt uses today's word "technology" to explain it.
  if (kind === "TECHNOLOGY" && (/(?:^|\s)(?:[1-9]\d{2}|1[0-8]\d{2})(?:\s|$)/.test(text) ||
      matches(text, ["osmanli", "bizans", "antik", "orta cag", "medieval", "ottoman", "byzantine"]) > 0)) kind = "SCHOLAR";
  const backdropScores = new Map(BACKDROP_RULES.map(([candidate, stems]) => [candidate, matches(text, stems)] as const));
  let backdrop: StageBackdrop = "PLAIN";
  let backdropScore = 0;
  for (const [candidate, score] of backdropScores) {
    if (score > backdropScore) { backdropScore = score; backdrop = candidate; }
  }
  // Indoor kinds stay indoors whenever the text names a room at all.
  const indoor = kind === "COURT" || kind === "COUNCIL" || kind === "PRAYER" || kind === "SCHOLAR";
  if (indoor && ((backdropScores.get("INTERIOR") ?? 0) > 0 || backdrop === "PLAIN")) backdrop = "INTERIOR";
  if (kind === "VOYAGE" && backdrop !== "SEA") backdrop = "SEA";
  if ((kind === "BATTLE" || kind === "MARCH" || kind === "RALLY") && backdrop === "PLAIN") backdrop = "FIELD";
  const time: StageTime = matches(text, NIGHT) > 0 ? "NIGHT" : matches(text, DUSK) > 0 ? "DUSK" : "DAY";
  return { kind, backdrop, time, text };
}

/**
 * The scene's blocking and animation. Always valid: the planner only writes values the engine accepts, and checks
 * the result with the engine's own validators before handing it out.
 */
export function planCharacterScene(input: CharacterScenePlanInput): CharacterScenePlan {
  if (!Number.isSafeInteger(input.sceneId) || input.sceneId <= 0) throw new Error("CHARACTER_SCENE_PLAN_INVALID");
  const classified = classifyCharacterScene(input);
  const { time, text } = classified;
  let { kind, backdrop } = classified;
  if (input.contextualDirection && !["BATTLE", "DEATH"].includes(kind) && matches(text, ["saray", "palace", "throne", "taht"]) > 0 && matches(text, ["padisah", "sultan", "king", "kral", "imparator", "emperor", "firavun", "pharaoh"]) > 0) { kind = "COURT"; backdrop = "INTERIOR"; }
  const rng = seeded(`${input.sceneId}:${text}`);
  const ottoman = matches(text, OTTOMAN) > 0;
  const western = matches(text, WESTERN) > 0;
  const steppe = matches(text, STEPPE) > 0;
  const twoSides = matches(text, RIVALRY) > 0 || (ottoman && western);
  const soldierHat = (side: "home" | "other"): HistoricalCostumeHint =>
    side === "home" ? (ottoman ? "TURBAN" : steppe ? "HELMET" : western ? "HELMET" : rng.pick(["HELMET", "ARMOR"] as const))
      : (ottoman && western ? "HELMET" : rng.pick(["HELMET", "ARMOR"] as const));
  const rulerHat: HistoricalCostumeHint = ottoman ? "TURBAN" : steppe ? "HELMET" : "CROWN";
  const figures: Figure[] = [];
  const props: BlockedProp[] = [];
  const arrows: BlockedArrow[] = [];
  // The sea backdrop's far half is water: only a ship may stand there; everything else keeps to the shore.
  const onStage = (depth: number, floats = false) => (backdrop === "SEA" && !floats ? Math.min(depth, SEA_SHORE_DEPTH) : depth);
  const addProp = (prop: StageProp, x: number, depth: number, facing: "LEFT" | "RIGHT" = "RIGHT") => {
    if (props.length < 8 && !props.some((item) => item.prop === prop)) props.push({ prop, x: round(x), depth: round(onStage(depth, prop === "SHIP")), facing });
  };
  let cameraBeat: CameraBeat = "HOLD";

  switch (kind) {
    case "BATTLE": {
      cameraBeat = "PUSH_IN";
      const attackers = twoSides ? 3 : 4;
      for (let i = 0; i < attackers; i++) {
        const runner = i % 2 === 1;
        const x = 0.1 + i * 0.1 + rng.between(-0.02, 0.02);
        figures.push({ x, depth: 0.05 + i * 0.12, facing: "RIGHT", pose: runner ? "RUN" : "SWORD_RAISED", expression: rng.pick(["ANGRY", "DETERMINED"] as const),
          costume: soldierHat("home"), handProp: runner ? "SPEAR" : "SWORD", action: runner ? "RUN" : "FIGHT", ...(runner ? { toX: Math.min(0.55, x + 0.18) } : {}), delay: runner ? rng.between(0, 0.8) : rng.between(0, 0.4) });
      }
      if (twoSides) {
        for (let i = 0; i < 3; i++) {
          figures.push({ x: 0.66 + i * 0.1, depth: 0.08 + i * 0.13, facing: "LEFT", pose: i === 0 ? "SWORD_RAISED" : "STAND", expression: rng.pick(["ANGRY", "SURPRISED"] as const),
            costume: soldierHat("other"), handProp: i === 0 ? "SWORD" : i === 1 ? "SHIELD" : "SPEAR", action: i === 0 ? "FIGHT" : i === 1 ? "IDLE" : "POINT", delay: rng.between(0, 0.6) });
        }
        if (matches(text, ["fall", "fell", "dusus", "dustu", "kaybet"]) > 0) figures[figures.length - 1] = { ...figures[figures.length - 1]!, action: "FALL", delay: 2.5 };
      }
      break;
    }
    case "MARCH": {
      cameraBeat = "PAN_RIGHT";
      const marchers = twoSides ? 3 : 4;
      for (let i = 0; i < marchers; i++) {
        const x = 0.06 + i * 0.09;
        figures.push({ x, depth: 0.08 + (i % 2) * 0.22 + i * 0.03, facing: "RIGHT", pose: "WALK", expression: "DETERMINED", costume: soldierHat("home"),
          handProp: i === 0 ? "FLAG" : rng.pick(["SPEAR", "SPEAR", "SHIELD"] as const), action: "WALK", toX: Math.min(0.62, x + 0.24), delay: i * 0.25 });
      }
      if (twoSides) {
        figures.push({ x: 0.84, depth: 0.25, facing: "LEFT", pose: "STAND", expression: "SURPRISED", costume: soldierHat("other"), handProp: "SHIELD", action: "IDLE" });
        figures.push({ x: 0.93, depth: 0.42, facing: "LEFT", pose: "STAND", expression: "ANGRY", costume: soldierHat("other"), handProp: null, action: "POINT", delay: 1 });
      }
      // The march itself moves now; a static arrow would only cut through the marchers.
      break;
    }
    case "RALLY": {
      cameraBeat = "PUSH_IN";
      // The leader faces the ranks and speaks; the ranks listen, and the front one raises a cheer.
      figures.push({ x: 0.26, depth: 0.1, facing: "RIGHT", pose: "STAND", expression: "DETERMINED", costume: rulerHat, handProp: rng.pick(["SWORD", null] as const), action: "TALK" });
      for (let i = 0; i < 3; i++) {
        figures.push({ x: 0.56 + i * 0.12, depth: 0.12 + i * 0.12, facing: "LEFT", pose: "STAND", expression: i === 0 ? "DETERMINED" : "NEUTRAL", costume: soldierHat("home"),
          handProp: i === 0 ? "FLAG" : "SPEAR", action: i === 0 ? "CHEER" : "IDLE", delay: 2.2 });
      }
      break;
    }
    case "MARKET": {
      // Passers-by in both directions, a trader at his stall, a listener.
      addProp("TENT", 0.78, 0.7);
      addProp("TABLE", 0.62, 0.45);
      figures.push({ x: 0.08, depth: 0.1, facing: "RIGHT", pose: "WALK", expression: "HAPPY", costume: ottoman ? "TURBAN" : "NONE", handProp: null, action: "WALK", toX: 0.4 });
      figures.push({ x: 0.92, depth: 0.3, facing: "LEFT", pose: "WALK", expression: "NEUTRAL", costume: "ROBE", handProp: null, action: "WALK", toX: 0.7, delay: 0.6 });
      figures.push({ x: 0.6, depth: 0.25, facing: "LEFT", pose: "STAND", expression: "HAPPY", costume: ottoman ? "TURBAN" : "HOOD", handProp: "SCROLL", action: "TALK", delay: 0.4 });
      figures.push({ x: 0.45, depth: 0.42, facing: "RIGHT", pose: "STAND", expression: "SURPRISED", costume: "NONE", handProp: null, action: "IDLE" });
      break;
    }
    case "CELEBRATION": {
      cameraBeat = "PULL_OUT";
      const count = 4;
      for (let i = 0; i < count; i++) {
        figures.push({ x: 0.2 + i * 0.18 + rng.between(-0.03, 0.03), depth: 0.1 + (i % 2) * 0.25, facing: i < 2 ? "RIGHT" : "LEFT", pose: "STAND", expression: "HAPPY",
          costume: i === 1 ? rulerHat : soldierHat("home"), handProp: i === 0 ? "FLAG" : i === 3 ? "SWORD" : null, action: "CHEER", delay: i * 0.3 });
      }
      break;
    }
    case "COURT": {
      cameraBeat = "PUSH_IN";
      addProp("THRONE", 0.3, 0.55);
      figures.push({ x: 0.36, depth: 0.15, facing: "RIGHT", pose: "STAND", expression: "DETERMINED", costume: rulerHat, handProp: null, action: "TALK" });
      figures.push({ x: 0.64, depth: 0.2, facing: "LEFT", pose: "STAND", expression: "NEUTRAL", costume: ottoman ? "TURBAN" : "HOOD", handProp: "SCROLL", action: "BOW", delay: 0.5 });
      figures.push({ x: 0.8, depth: 0.4, facing: "LEFT", pose: "STAND", expression: "NEUTRAL", costume: soldierHat("home"), handProp: "SPEAR", action: "IDLE" });
      break;
    }
    case "COUNCIL": {
      addProp("TABLE", 0.5, 0.35);
      figures.push({ x: 0.3, depth: 0.12, facing: "RIGHT", pose: "STAND", expression: "DETERMINED", costume: ottoman ? "TURBAN" : rulerHat, handProp: null, action: "TALK" });
      figures.push({ x: 0.7, depth: 0.15, facing: "LEFT", pose: "STAND", expression: "SURPRISED", costume: ottoman ? "TURBAN" : "HOOD", handProp: "SCROLL", action: "IDLE" });
      figures.push({ x: 0.55, depth: 0.45, facing: "LEFT", pose: "STAND", expression: "NEUTRAL", costume: "ROBE", handProp: null, action: "POINT", delay: 1.2 });
      break;
    }
    case "VOYAGE": {
      cameraBeat = "PAN_LEFT";
      addProp("SHIP", 0.62, 0.85);
      figures.push({ x: 0.18, depth: 0.08, facing: "RIGHT", pose: "STAND", expression: "DETERMINED", costume: rulerHat, handProp: null, action: "POINT", delay: 0.4 });
      figures.push({ x: 0.06, depth: 0.25, facing: "RIGHT", pose: "WALK", expression: "NEUTRAL", costume: soldierHat("home"), handProp: "FLAG", action: "WALK", toX: 0.3 });
      break;
    }
    case "BUILD": {
      addProp("TOWER", 0.7, 0.7);
      figures.push({ x: 0.22, depth: 0.1, facing: "RIGHT", pose: "KNEEL", expression: "DETERMINED", costume: "NONE", handProp: null, action: "KNEEL_DOWN" });
      figures.push({ x: 0.4, depth: 0.25, facing: "RIGHT", pose: "WALK", expression: "NEUTRAL", costume: "NONE", handProp: null, action: "WALK", toX: 0.55, delay: 0.3 });
      figures.push({ x: 0.85, depth: 0.2, facing: "LEFT", pose: "STAND", expression: "DETERMINED", costume: ottoman ? "TURBAN" : "HOOD", handProp: "SCROLL", action: "POINT", delay: 0.8 });
      break;
    }
    case "SCHOLAR": {
      addProp("TABLE", 0.45, 0.4);
      figures.push({ x: 0.3, depth: 0.12, facing: "RIGHT", pose: "STAND", expression: "HAPPY", costume: ottoman ? "TURBAN" : "HOOD", handProp: "SCROLL", action: "TALK" });
      figures.push({ x: 0.66, depth: 0.18, facing: "LEFT", pose: "SIT", expression: "SURPRISED", costume: "ROBE", handProp: null, action: "SIT" });
      break;
    }
    case "PRAYER": {
      for (let i = 0; i < 3; i++) {
        figures.push({ x: 0.3 + i * 0.18, depth: 0.15 + i * 0.1, facing: "RIGHT", pose: "STAND", expression: "NEUTRAL", costume: ottoman ? "TURBAN" : "HOOD", handProp: null, action: "KNEEL_DOWN", delay: 0.4 + i * 0.6 });
      }
      break;
    }
    case "JOURNEY": {
      cameraBeat = "PAN_RIGHT";
      addProp("HORSE", 0.2, 0.5);
      for (let i = 0; i < 3; i++) {
        const x = 0.08 + i * 0.12;
        figures.push({ x, depth: 0.1 + i * 0.1, facing: "RIGHT", pose: "WALK", expression: "NEUTRAL", costume: steppe ? "HELMET" : i === 0 ? "HOOD" : "NONE", handProp: i === 0 ? "TORCH" : null, action: "WALK", toX: Math.min(0.7, x + 0.3), delay: i * 0.3 });
      }
      break;
    }
    case "DEATH": {
      cameraBeat = "PUSH_IN";
      figures.push({ x: 0.5, depth: 0.15, facing: "RIGHT", pose: "STAND", expression: "SAD", costume: matches(text, ["sultan", "king", "emperor", "padisah", "kral", "imparator", "hukumdar"]) > 0 ? rulerHat : soldierHat("home"), handProp: null, action: "FALL", delay: 1.5 });
      figures.push({ x: 0.3, depth: 0.25, facing: "RIGHT", pose: "STAND", expression: "SAD", costume: soldierHat("home"), handProp: null, action: "KNEEL_DOWN", delay: 2.4 });
      figures.push({ x: 0.72, depth: 0.3, facing: "LEFT", pose: "STAND", expression: "SURPRISED", costume: soldierHat(twoSides ? "other" : "home"), handProp: twoSides ? "SWORD" : null, action: "IDLE" });
      break;
    }
    case "TECHNOLOGY":
    case "ECONOMY":
    case "POLITICS": {
      addProp(kind === "TECHNOLOGY" ? "MONITOR" : kind === "ECONOMY" ? "CHART" : "MICROPHONE", 0.55, 0.45);
      figures.push({ x: 0.3, depth: 0.12, facing: "RIGHT", pose: "STAND", expression: "HAPPY", costume: "NONE", handProp: null, action: "TALK" });
      figures.push({ x: 0.74, depth: 0.2, facing: "LEFT", pose: "STAND", expression: "SURPRISED", costume: "NONE", handProp: null, action: "POINT", delay: 1.2 });
      break;
    }
    case "NARRATOR": {
      figures.push({ x: 0.36, depth: 0.12, facing: "RIGHT", pose: "STAND", expression: rng.pick(["HAPPY", "NEUTRAL"] as const), costume: ottoman ? "TURBAN" : steppe ? "HELMET" : "NONE", handProp: null, action: "TALK" });
      figures.push({ x: 0.64, depth: 0.2, facing: "LEFT", pose: "STAND", expression: "SURPRISED", costume: "NONE", handProp: null, action: "IDLE" });
      break;
    }
  }

  // A wound or a death named in a crowded scene: someone lies on the ground in front.
  const deathStems = KIND_RULES.find(([candidate]) => candidate === "DEATH")![1];
  if (kind !== "DEATH" && figures.length < 8 && matches(text, deathStems) > 0) {
    figures.push({ x: 0.46, depth: 0, facing: "RIGHT", pose: "FALLEN", expression: "SAD", costume: soldierHat(twoSides ? "other" : "home"), handProp: null, action: "IDLE" });
  }

  // Props the words name, placed behind the figures.
  const propSlots = [0.12, 0.88, 0.5, 0.3, 0.7];
  for (const [prop, stems] of PROP_RULES) {
    // The walls backdrop already has its towers.
    if (prop === "TOWER" && backdrop === "CITY_WALLS") continue;
    if (matches(text, stems) > 0) addProp(prop, propSlots[props.length % propSlots.length]!, rng.between(0.6, 0.9), rng.pick(["LEFT", "RIGHT"] as const));
  }
  if (backdrop === "SEA" && kind !== "VOYAGE" && matches(text, ["ship", "fleet", "gemi", "donanma"]) > 0) addProp("SHIP", 0.75, 0.85);

  const characters: BlockedCharacter[] = figures.slice(0, 8).map((figure, index) => ({
    id: `c${index + 1}`, x: round(figure.x), depth: round(onStage(figure.depth)), facing: figure.facing, pose: figure.pose,
    expression: figure.expression, costume: figure.costume, handProp: figure.handProp,
  }));
  const actors: CharacterActorPlan[] = figures.slice(0, 8).map((figure, index) => {
    const moving = figure.action === "WALK" || figure.action === "RUN";
    const from = characters[index]!.x;
    // A target the figure would have to walk backwards to reach is dropped, and the figure stands its ground.
    const toX = moving && figure.toX !== undefined ? round(figure.toX) : null;
    const forward = toX !== null && (figure.facing === "RIGHT" ? toX > from : toX < from);
    return {
      id: `c${index + 1}`,
      action: moving && !forward ? "IDLE" : figure.action,
      toX: moving && forward ? toX : null,
      delaySeconds: Math.round(Math.min(30, Math.max(0, figure.delay ?? 0)) * 100) / 100,
    };
  });
  const blocking: SceneBlocking = { backdrop, time, characters, props, arrows: arrows.slice(0, 4), caption: null };
  const request: CharacterSceneRequest = {
    sceneId: input.sceneId, format: "DOCUMENTARY", language: input.language ?? "tr", blocking, cameraBeat, claimIds: [],
  };
  const animation: CharacterAnimationPlan = { schemaVersion: CHARACTER_ANIMATION_SCHEMA_VERSION, fps: CHARACTER_ANIMATION_FPS, actors };
  const problems = [...findCharacterSceneRequestProblems(request), ...findCharacterAnimationProblems(animation, blocking)];
  if (problems.length) throw new Error(`CHARACTER_SCENE_PLAN_INVALID: ${problems.join(", ")}`);
  return { kind, request, animation };
}
