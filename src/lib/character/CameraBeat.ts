/**
 * Stage 15J — the camera beat of a character scene.
 *
 * A character scene is one still image. Its movement is the existing motion plan's: the beat names which of the
 * motion types the FFmpeg scene pipeline already renders, and nothing new.
 */
export const CAMERA_BEATS = Object.freeze(["HOLD", "PUSH_IN", "PULL_OUT", "PAN_LEFT", "PAN_RIGHT"] as const);
export type CameraBeat = (typeof CAMERA_BEATS)[number];

/** The motion plan's own motion types. */
export type CharacterSceneMotionType = "static" | "zoom-in" | "zoom-out" | "pan-left" | "pan-right";

export const CAMERA_BEAT_MOTION: Readonly<Record<CameraBeat, CharacterSceneMotionType>> = Object.freeze({
  HOLD: "static", PUSH_IN: "zoom-in", PULL_OUT: "zoom-out", PAN_LEFT: "pan-left", PAN_RIGHT: "pan-right",
});

export function isCameraBeat(value: unknown): value is CameraBeat { return typeof value === "string" && (CAMERA_BEATS as readonly string[]).includes(value); }
