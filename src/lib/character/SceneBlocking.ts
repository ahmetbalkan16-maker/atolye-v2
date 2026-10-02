import { isCharacterExpression, type CharacterExpression } from "./CharacterExpression";
import { isCharacterPose, type CharacterPose } from "./CharacterPose";
import { isHistoricalCostumeHint, type HistoricalCostumeHint } from "./HistoricalCostumeHint";
import { isHandProp, isStageProp, type HandProp, type StageProp } from "./PropLibrary";

/**
 * Stage 15J — scene blocking: who and what stands where.
 *
 * Positions are fractions of the stage, so a blocking does not depend on the output size. `depth` moves a figure
 * back: it is drawn smaller, higher and earlier, so nearer figures cover farther ones.
 */
export const STAGE_BACKDROPS = Object.freeze(["PLAIN", "FIELD", "CITY_WALLS", "SEA", "INTERIOR", "MOUNTAINS"] as const);
export type StageBackdrop = (typeof STAGE_BACKDROPS)[number];
export const STAGE_TIMES = Object.freeze(["DAY", "DUSK", "NIGHT"] as const);
export type StageTime = (typeof STAGE_TIMES)[number];

export interface BlockedCharacter {
  readonly id: string;
  /** Horizontal position, 0 (left edge) to 1 (right edge). */
  readonly x: number;
  /** 0 is the front of the stage, 1 the back. */
  readonly depth: number;
  readonly facing: "LEFT" | "RIGHT";
  readonly pose: CharacterPose;
  readonly expression: CharacterExpression;
  readonly costume: HistoricalCostumeHint;
  readonly handProp: HandProp | null;
}
export interface BlockedProp { readonly prop: StageProp; readonly x: number; readonly depth: number; readonly facing: "LEFT" | "RIGHT" }
/** An arrow across the stage, from one fraction pair to another: a march, an attack, a retreat. */
export interface BlockedArrow { readonly fromX: number; readonly fromY: number; readonly toX: number; readonly toY: number }
export interface SceneBlocking {
  readonly backdrop: StageBackdrop;
  readonly time: StageTime;
  readonly characters: readonly BlockedCharacter[];
  readonly props: readonly BlockedProp[];
  readonly arrows: readonly BlockedArrow[];
  /** A short caption on the image: a place and year, or what the scene shows. */
  readonly caption: string | null;
}

export const BLOCKING_LIMITS = Object.freeze({ characters: 8, props: 8, arrows: 4, captionLength: 80 });

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const fraction = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const facing = (value: unknown): value is "LEFT" | "RIGHT" => value === "LEFT" || value === "RIGHT";
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => Object.hasOwn(value, key));

/** Every problem with a blocking, by where it is. An empty list means the renderer will draw it as written. */
export function findSceneBlockingProblems(value: unknown): string[] {
  if (!plain(value) || !exact(value, ["backdrop", "time", "characters", "props", "arrows", "caption"])) return ["BLOCKING_SHAPE"];
  const problems: string[] = [];
  if (!(STAGE_BACKDROPS as readonly unknown[]).includes(value.backdrop)) problems.push("BACKDROP");
  if (!(STAGE_TIMES as readonly unknown[]).includes(value.time)) problems.push("TIME");
  if (!(value.caption === null || (typeof value.caption === "string" && value.caption.trim().length > 0 && value.caption.length <= BLOCKING_LIMITS.captionLength && !/[\u0000-\u001f]/.test(value.caption)))) problems.push("CAPTION");
  const characters = Array.isArray(value.characters) ? value.characters : null;
  const props = Array.isArray(value.props) ? value.props : null;
  const arrows = Array.isArray(value.arrows) ? value.arrows : null;
  if (!characters || characters.length > BLOCKING_LIMITS.characters) problems.push("CHARACTERS");
  if (!props || props.length > BLOCKING_LIMITS.props) problems.push("PROPS");
  if (!arrows || arrows.length > BLOCKING_LIMITS.arrows) problems.push("ARROWS");
  const ids = new Set<string>();
  for (const [index, character] of (characters ?? []).entries()) {
    if (!plain(character) || !exact(character, ["id", "x", "depth", "facing", "pose", "expression", "costume", "handProp"]) || typeof character.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(character.id) || ids.has(character.id) ||
        !fraction(character.x) || !fraction(character.depth) || !facing(character.facing) || !isCharacterPose(character.pose) || !isCharacterExpression(character.expression) || !isHistoricalCostumeHint(character.costume) ||
        !(character.handProp === null || isHandProp(character.handProp))) problems.push(`CHARACTER:${index}`);
    else ids.add(character.id);
  }
  for (const [index, prop] of (props ?? []).entries()) {
    if (!plain(prop) || !exact(prop, ["prop", "x", "depth", "facing"]) || !isStageProp(prop.prop) || !fraction(prop.x) || !fraction(prop.depth) || !facing(prop.facing)) problems.push(`PROP:${index}`);
  }
  for (const [index, arrow] of (arrows ?? []).entries()) {
    if (!plain(arrow) || !exact(arrow, ["fromX", "fromY", "toX", "toY"]) || ![arrow.fromX, arrow.fromY, arrow.toX, arrow.toY].every(fraction) || (arrow.fromX === arrow.toX && arrow.fromY === arrow.toY)) problems.push(`ARROW:${index}`);
  }
  return problems;
}
