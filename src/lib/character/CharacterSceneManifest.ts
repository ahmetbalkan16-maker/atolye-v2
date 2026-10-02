import crypto from "node:crypto";

import { CAMERA_BEAT_MOTION, isCameraBeat, type CameraBeat, type CharacterSceneMotionType } from "./CameraBeat";
import { STICK_FIGURE_RIG } from "./CharacterRig";
import { findSceneBlockingProblems, type SceneBlocking } from "./SceneBlocking";
import { CHARACTER_SCENE_HEIGHT, CHARACTER_SCENE_WIDTH, REENACTMENT_LABELS, renderCharacterSceneSvg, type ReenactmentLabelLanguage } from "./SvgSceneRenderer";

/**
 * Stage 15J — the character scene manifest.
 *
 * What one drawn scene is, said next to the image: what is in it, how it moves, and above all what it is not. A
 * character scene is synthetic. It is a reenactment, it is evidence of nothing, and in a documentary it carries a
 * visible label. Those facts are fixed here and are not options of the request.
 *
 * Pure: the same request gives the same manifest and the same SVG bytes. Nothing is written and nothing is fetched;
 * turning the SVG into pixels and handing it to the pipeline is someone else's step.
 */
export const CHARACTER_SCENE_MANIFEST_SCHEMA_VERSION = "1" as const;

export interface CharacterSceneRequest {
  readonly sceneId: number;
  readonly format: "DOCUMENTARY" | "GENERAL";
  /** The language of the label written into the image. */
  readonly language: ReenactmentLabelLanguage;
  readonly blocking: SceneBlocking;
  readonly cameraBeat: CameraBeat;
  /** Fact pack claims the scene illustrates. An illustration of a claim is not a source for it. */
  readonly claimIds: readonly string[];
}
export interface CharacterSceneManifest {
  readonly schemaVersion: typeof CHARACTER_SCENE_MANIFEST_SCHEMA_VERSION;
  readonly sceneId: number;
  readonly renderer: { readonly id: "svg-stick-figure"; readonly rig: string; readonly width: number; readonly height: number };
  readonly classification: {
    /** The scene media class of the design: a local SVG stick-figure or character reenactment. */
    readonly mediaClass: "LOCAL_CHARACTER_REENACTMENT";
    readonly origin: "GENERATED";
    readonly synthetic: true;
    /** A drawn scene supports no factual claim. */
    readonly evidenceValue: "NONE";
    readonly reenactmentLabel: "VISIBLE_IN_IMAGE" | "NOT_REQUIRED";
    readonly labelText: string | null;
    readonly rights: "LOCALLY_GENERATED_NO_THIRD_PARTY_MEDIA";
    readonly cost: "LOCAL_ZERO_COST";
  };
  readonly blocking: SceneBlocking;
  readonly cameraBeat: CameraBeat;
  /** The motion plan's motion type the existing scene pipeline renders for this beat. */
  readonly motionType: CharacterSceneMotionType;
  readonly claimIds: readonly string[];
  readonly counts: { readonly characters: number; readonly props: number; readonly arrows: number };
  readonly svgSha256: string;
  readonly svgBytes: number;
}
export interface CharacterScene { readonly manifest: CharacterSceneManifest; readonly svg: string }

const sha256 = (text: string) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

/** Every problem with a request. An empty list means it will be built as written. */
export function findCharacterSceneRequestProblems(value: unknown): string[] {
  const request = value as Partial<CharacterSceneRequest> | null;
  if (!request || typeof request !== "object" || Array.isArray(request)) return ["REQUEST_SHAPE"];
  const keys = ["sceneId", "format", "language", "blocking", "cameraBeat", "claimIds"];
  const problems: string[] = [];
  if (Object.keys(request).some((key) => !keys.includes(key))) problems.push("REQUEST_UNKNOWN_FIELD");
  if (!Number.isSafeInteger(request.sceneId) || request.sceneId! <= 0) problems.push("SCENE_ID");
  if (request.format !== "DOCUMENTARY" && request.format !== "GENERAL") problems.push("FORMAT");
  if (request.language !== "tr" && request.language !== "en") problems.push("LANGUAGE");
  if (!isCameraBeat(request.cameraBeat)) problems.push("CAMERA_BEAT");
  if (!Array.isArray(request.claimIds) || request.claimIds.length > 40 || !request.claimIds.every((id) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id))) problems.push("CLAIM_IDS");
  return [...problems, ...findSceneBlockingProblems(request.blocking)];
}

/**
 * Builds the scene and its manifest. A documentary scene is always labelled in the image. A general scene is
 * labelled too unless nothing in it could be read as a record: no caption that names a place or a time, and no
 * claim it illustrates.
 */
export function buildCharacterScene(request: CharacterSceneRequest): CharacterScene {
  const problems = findCharacterSceneRequestProblems(request);
  if (problems.length) throw new Error(`CHARACTER_SCENE_REQUEST_INVALID: ${problems.join(", ")}`);
  const labelled = request.format === "DOCUMENTARY" || request.claimIds.length > 0 || request.blocking.caption !== null;
  const svg = renderCharacterSceneSvg(request.blocking, { reenactmentLabel: labelled ? request.language : null });
  const manifest: CharacterSceneManifest = {
    schemaVersion: CHARACTER_SCENE_MANIFEST_SCHEMA_VERSION,
    sceneId: request.sceneId,
    renderer: { id: "svg-stick-figure", rig: STICK_FIGURE_RIG.id, width: CHARACTER_SCENE_WIDTH, height: CHARACTER_SCENE_HEIGHT },
    classification: {
      mediaClass: "LOCAL_CHARACTER_REENACTMENT", origin: "GENERATED", synthetic: true, evidenceValue: "NONE",
      reenactmentLabel: labelled ? "VISIBLE_IN_IMAGE" : "NOT_REQUIRED", labelText: labelled ? REENACTMENT_LABELS[request.language] : null,
      rights: "LOCALLY_GENERATED_NO_THIRD_PARTY_MEDIA", cost: "LOCAL_ZERO_COST",
    },
    blocking: request.blocking, cameraBeat: request.cameraBeat, motionType: CAMERA_BEAT_MOTION[request.cameraBeat], claimIds: [...request.claimIds],
    counts: { characters: request.blocking.characters.length, props: request.blocking.props.length, arrows: request.blocking.arrows.length },
    svgSha256: sha256(svg), svgBytes: Buffer.byteLength(svg, "utf8"),
  };
  return { manifest, svg };
}

/**
 * Whether a stored manifest still describes the SVG beside it, and still says what a character scene has to say
 * about itself. A manifest edited to call the scene evidence, real or unlabelled in a documentary is refused.
 */
export function verifyCharacterScene(manifest: CharacterSceneManifest, svg: string, format: "DOCUMENTARY" | "GENERAL"): string[] {
  const problems: string[] = [];
  if (manifest.schemaVersion !== CHARACTER_SCENE_MANIFEST_SCHEMA_VERSION) problems.push("SCHEMA_VERSION");
  if (manifest.svgSha256 !== sha256(svg) || manifest.svgBytes !== Buffer.byteLength(svg, "utf8")) problems.push("SVG_DIGEST_MISMATCH");
  const c = manifest.classification;
  if (!c || c.mediaClass !== "LOCAL_CHARACTER_REENACTMENT" || c.origin !== "GENERATED" || c.synthetic !== true || c.evidenceValue !== "NONE") problems.push("CLASSIFICATION");
  const labelInImage = /data-reenactment-label="(?:tr|en)"/.test(svg);
  if (c?.reenactmentLabel === "VISIBLE_IN_IMAGE" ? !labelInImage : labelInImage) problems.push("LABEL_STATE_MISMATCH");
  if (format === "DOCUMENTARY" && (c?.reenactmentLabel !== "VISIBLE_IN_IMAGE" || !labelInImage)) problems.push("DOCUMENTARY_REENACTMENT_UNLABELLED");
  if (manifest.motionType !== CAMERA_BEAT_MOTION[manifest.cameraBeat]) problems.push("MOTION_TYPE");
  // The image has to be the one this blocking draws: a manifest cannot describe one scene and ship another.
  if (!problems.length && findSceneBlockingProblems(manifest.blocking).length === 0) {
    const expected = renderCharacterSceneSvg(manifest.blocking, { reenactmentLabel: c.reenactmentLabel === "VISIBLE_IN_IMAGE" ? (c.labelText === REENACTMENT_LABELS.en ? "en" : "tr") : null });
    if (expected !== svg) problems.push("SVG_NOT_FROM_BLOCKING");
  } else if (!problems.length) problems.push("BLOCKING");
  return problems;
}
