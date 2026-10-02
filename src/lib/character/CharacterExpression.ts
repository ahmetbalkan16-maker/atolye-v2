/** Stage 15J — the faces a character can make. Each is two brows and a mouth; the renderer draws them on the head. */
export const CHARACTER_EXPRESSIONS = Object.freeze(["NEUTRAL", "HAPPY", "SAD", "ANGRY", "SURPRISED", "DETERMINED"] as const);
export type CharacterExpression = (typeof CHARACTER_EXPRESSIONS)[number];

export interface ExpressionShape {
  /** Tilt of the brows in degrees: positive raises the outer end (anger lowers the inner end instead). */
  readonly browTilt: number;
  /** Raise of both brows, as a fraction of the head radius. */
  readonly browRaise: number;
  /** Curve of the mouth as a fraction of the head radius: positive smiles, negative frowns. */
  readonly mouthCurve: number;
  /** An open, round mouth. */
  readonly mouthOpen: boolean;
}

export const EXPRESSION_SHAPES: Readonly<Record<CharacterExpression, ExpressionShape>> = Object.freeze({
  NEUTRAL: { browTilt: 0, browRaise: 0, mouthCurve: 0, mouthOpen: false },
  HAPPY: { browTilt: 6, browRaise: 0.04, mouthCurve: 0.22, mouthOpen: false },
  SAD: { browTilt: 16, browRaise: 0.02, mouthCurve: -0.2, mouthOpen: false },
  ANGRY: { browTilt: -22, browRaise: -0.04, mouthCurve: -0.1, mouthOpen: false },
  SURPRISED: { browTilt: 4, browRaise: 0.14, mouthCurve: 0, mouthOpen: true },
  DETERMINED: { browTilt: -12, browRaise: -0.02, mouthCurve: 0, mouthOpen: false },
});

export function isCharacterExpression(value: unknown): value is CharacterExpression {
  return typeof value === "string" && (CHARACTER_EXPRESSIONS as readonly string[]).includes(value);
}
