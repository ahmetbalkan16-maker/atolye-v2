/**
 * Atölye V3 — the render plan contract between the director (root, `src/lib/v3`) and the Remotion
 * renderer (`remotion-v3/`). Pure types only: the Remotion package imports this file by relative path,
 * so it must not import anything.
 *
 * Every time is an integer frame at `fps`. Every position is in stage units: x in 0..1 across the frame,
 * depth 0 (front) .. 1 (back).
 */

export type V3Emotion = "notr" | "mutlu" | "kizgin" | "saskin" | "korkmus" | "uzgun" | "kararli" | "sinsi";

/** Rhubarb Lip Sync mouth shapes; X is the rest shape. */
export type V3Viseme = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "X";

export type V3Gesture =
  | "konus" // beat gesture while speaking
  | "isaret_et"
  | "el_salla"
  | "sasir"
  | "egil"
  | "kollari_kavustur"
  | "dusun"
  | "omuz_silk"
  | "yumruk_kaldir"
  | "elleri_belde"
  | "yuz_avucla"
  | "kutla";

export type V3Effect = "ter" | "unlem" | "soru" | "ofke" | "parilti" | "kalp";

export type V3CharacterStyle = "kukla" | "cop";

export type V3Garment = "kaftan" | "cubbe" | "zirh" | "onluk" | "bizans" | "yeniceri" | "sade";

export interface V3Costume {
  /** Accessory pack folder under `public/costumes/`. */
  readonly pack: string;
  readonly garment: V3Garment;
  readonly colors: { readonly main: string; readonly second: string; readonly inner: string; readonly trim: string };
  /** Accessory ids inside the pack (`<id>.svg`), by slot. */
  readonly head?: string;
  readonly beard?: string;
  readonly mustache?: string;
  readonly handFront?: string;
  readonly handBack?: string;
  readonly back?: string;
  readonly collar?: "kurk" | "yok";
  readonly shoes: string;
}

export interface V3Accessory {
  readonly id: string;
  readonly slot: "head" | "beard" | "mustache" | "hand" | "back";
  /** Inner SVG markup (no outer <svg>), coordinates relative to the slot anchor, head radius = 100. */
  readonly markup: string;
  /** Draw behind the head (hair, turban tail) instead of in front. */
  readonly behind?: boolean;
  /** A hand item the fist closes around (sword, staff): the holding hand stays a fist through every gesture. */
  readonly grip?: boolean;
}

export interface V3CastMember {
  readonly id: string;
  readonly name: string;
  readonly costume: V3Costume;
  /** Body scale relative to the default (1). Children/figurants can be smaller. */
  readonly scale: number;
  readonly style: V3CharacterStyle;
}

export interface V3GestureEvent {
  readonly gesture: V3Gesture;
  readonly start: number;
  readonly end: number;
  /** Which side the gesture is aimed at (pointing, waving). */
  readonly toward?: "left" | "right";
}

export interface V3MoveEvent {
  readonly start: number;
  readonly end: number;
  readonly fromX: number;
  readonly toX: number;
  readonly run?: boolean;
}

export interface V3FaceEvent {
  readonly start: number;
  readonly emotion: V3Emotion;
}

export interface V3VisemeKey {
  readonly frame: number;
  readonly viseme: V3Viseme;
}

export interface V3EffectEvent {
  readonly effect: V3Effect;
  readonly start: number;
  readonly end: number;
}

/** One character's performance inside one shot. Frames are relative to the shot start. */
export interface V3Performer {
  readonly castId: string;
  readonly x: number;
  readonly depth: number;
  readonly facing: "left" | "right";
  readonly seated?: boolean;
  readonly visible?: { readonly from: number; readonly to: number };
  readonly moves: readonly V3MoveEvent[];
  readonly gestures: readonly V3GestureEvent[];
  readonly faces: readonly V3FaceEvent[];
  readonly visemes: readonly V3VisemeKey[];
  readonly effects: readonly V3EffectEvent[];
  /** Frames where the character speaks; drives head bob. */
  readonly speaking: readonly { readonly start: number; readonly end: number }[];
  /** Head turns towards whoever is talking. */
  readonly turns?: readonly { readonly frame: number; readonly facing: "left" | "right" }[];
}

export interface V3CameraKey {
  readonly frame: number;
  /** 1 = full stage. */
  readonly zoom: number;
  /** Stage point kept at the frame centre, 0..1. */
  readonly cx: number;
  readonly cy: number;
  /** smooth: eased over the whole segment; snap: fast move at the end; cut: instant reframe (a hard cut). */
  readonly ease?: "smooth" | "snap" | "cut";
}

export interface V3Shake {
  readonly start: number;
  readonly end: number;
  readonly amplitude: number;
}

export interface V3Background {
  /** Path relative to the render public dir. */
  readonly src: string;
  /** Archival images (maps, paintings) drift slowly; sets stay still and are graded to sit behind characters. */
  readonly kind: "set" | "archival";
  readonly kenBurns?: { readonly fromZoom: number; readonly toZoom: number; readonly fromX: number; readonly toX: number };
}

export interface V3TitleCard {
  readonly text: string;
  readonly subtext?: string;
  readonly start: number;
  readonly end: number;
  readonly style: "yer_tarih" | "bolum" | "bilgi";
}

export interface V3MapArrow {
  /** Points in background-image space, 0..1. */
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly start: number;
  readonly end: number;
  readonly color: string;
  readonly label?: string;
}

export interface V3Prop {
  readonly kind: "taht" | "top" | "kule_iskelesi" | "gemi" | "masa" | "sancak";
  readonly x: number;
  readonly depth: number;
  readonly scale?: number;
  readonly flip?: boolean;
}

export type V3Transition = "kes" | "kaydir" | "murekkep" | "beyaz";

export interface V3Shot {
  readonly id: string;
  readonly sceneId: string;
  readonly start: number;
  readonly duration: number;
  readonly background: V3Background;
  readonly performers: readonly V3Performer[];
  readonly props: readonly V3Prop[];
  readonly camera: readonly V3CameraKey[];
  readonly shakes: readonly V3Shake[];
  readonly titleCards: readonly V3TitleCard[];
  readonly mapArrows: readonly V3MapArrow[];
  readonly transitionIn: V3Transition;
  /** Small "CANLANDIRMA" label: dramatised dialogue is labelled, like the existing documentary rule. */
  readonly dramatized: boolean;
}

export interface V3CaptionWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly emphasis?: boolean;
}

export interface V3CaptionPage {
  readonly start: number;
  readonly end: number;
  readonly speaker?: string;
  readonly words: readonly V3CaptionWord[];
}

export interface V3RenderPlan {
  readonly version: 1;
  readonly episodeId: string;
  readonly title: string;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly durationInFrames: number;
  readonly cast: readonly V3CastMember[];
  readonly accessories: readonly V3Accessory[];
  readonly shots: readonly V3Shot[];
  readonly captions: readonly V3CaptionPage[];
  readonly showCaptions: boolean;
  /** Mixed soundtrack (voice + music + sfx) relative to the public dir; rendered video carries it for preview. */
  readonly audio?: string;
}
