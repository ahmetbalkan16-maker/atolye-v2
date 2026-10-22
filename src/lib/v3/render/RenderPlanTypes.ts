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

export type V3Garment = "kaftan" | "cubbe" | "zirh" | "onluk" | "bizans" | "yeniceri" | "sade" | "tunik" | "toga" | "ceket" | "uniforma" | "takim" | "elbise";

export type V3HairStyle = "kisa" | "dalgali" | "yan_ayrik" | "uzun" | "topuz" | "orgu" | "kel" | "kivircik" | "kakul" | "geriye" | "seyrek";

export interface V3Hair {
  readonly style: V3HairStyle;
  readonly color: string;
}

export type V3FaceShape = "yuvarlak" | "oval" | "uzun" | "genis" | "kare";
export type V3Nose = "yok" | "kucuk" | "duz" | "iri" | "kemerli" | "kalkik";
export type V3EyeStyle = "nokta" | "detayli";
export type V3Age = "genc" | "orta" | "yasli";

/**
 * A drawn likeness (the reference channel's main characters): the puppet head keeps the house style, but its shape,
 * skin, nose, eyes, brows and age lines follow the real person's portrait. Absent fields keep the plain puppet head.
 */
export interface V3Look {
  readonly faceShape?: V3FaceShape;
  readonly skin?: string;
  readonly nose?: V3Nose;
  readonly eyes?: V3EyeStyle;
  readonly browColor?: string;
  readonly age?: V3Age;
}

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
  /** Colour of a cloak hanging from the shoulders behind the body, pinned on one shoulder (none: no cloak). */
  readonly cape?: string;
  readonly shoes: string;
  /** Hair under (or without) headwear; none draws the bare puppet head. */
  readonly hair?: V3Hair;
  /** A drawn hair part (slot "hair") instead of the parametric hair: a person's own haircut. */
  readonly hairPart?: string;
  /** Worn on the chest over the garment (slot "chest"): a chain of office, a sash, medals. */
  readonly chest?: string;
  readonly look?: V3Look;
}

export interface V3Accessory {
  readonly id: string;
  readonly slot: "head" | "beard" | "mustache" | "hand" | "back" | "hair" | "chest";
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
  /**
   * smooth: glides through consecutive smooth keys, easing only where the camera starts or comes to rest;
   * snap: fast move at the end; cut: instant reframe (a hard cut).
   */
  readonly ease?: "smooth" | "snap" | "cut";
}

export interface V3Shake {
  readonly start: number;
  readonly end: number;
  readonly amplitude: number;
}

export interface V3Background {
  /** Path relative to the render public dir (unused for a drawn set). */
  readonly src: string;
  /**
   * Archival images (maps, paintings) drift slowly; sets stay still and are graded to sit behind characters; a drawn
   * set is composed and animated in the renderer from `drawn`.
   */
  readonly kind: "set" | "archival" | "drawn";
  readonly kenBurns?: { readonly fromZoom: number; readonly toZoom: number; readonly fromX: number; readonly toX: number };
  readonly drawn?: V3DrawnSet;
}

export type V3TimeOfDay = "gun" | "aksam" | "gece" | "safak";
export type V3Landscape = "nehir_kiyisi" | "nehir_gecidi" | "ova" | "tepeler" | "orman" | "sahil" | "sokak" | "meydan" | "saray_ici" | "meclis" | "ordugah" | "sur_onu";
export type V3ArchStyle = "roma" | "yunan" | "misir" | "pers" | "bizans" | "osmanli" | "ortacag" | "cin" | "japon" | "erken_modern" | "modern";
export type V3Weather = "acik" | "bulutlu" | "sis" | "yagmur" | "kar";
export type V3SetLight = "yok" | "mesale" | "kamp_atesi";

/**
 * A drawn living set (owner, 22 Oct 2026: "izleyen o anı yaşamalı"): flat, outlined layers composed from the scene's
 * time of day, landscape, period style and weather, with what lives in it — flowing water, flickering torches, drifting
 * fog, stars. Always about the scene, always in one style, drawn in the renderer (no GPU, no judge).
 */
export interface V3DrawnSet {
  readonly zaman: V3TimeOfDay;
  readonly manzara: V3Landscape;
  readonly uslup: V3ArchStyle;
  readonly hava?: V3Weather;
  readonly isik?: V3SetLight;
  /** nehir_gecidi: where the river runs across the stage (x 0..1, left and right bank). */
  readonly nehir?: readonly [number, number];
  /** Varies hills, trees and buildings between scenes of the same kind. */
  readonly tohum: number;
}

export interface V3TitleCard {
  readonly text: string;
  readonly subtext?: string;
  readonly start: number;
  readonly end: number;
  /**
   * kapak: the opening title cover; abone: the closing subscribe end card (both placed by the director); kucukresim:
   * the YouTube thumbnail's headline (ThumbnailDesigner).
   */
  readonly style: "yer_tarih" | "bolum" | "bilgi" | "kelime" | "kapak" | "abone" | "kucukresim";
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

/** A crowd member: a costume copy standing still with a little life (sway, blinks, a cheer). Never speaks. */
export interface V3Extra {
  readonly castId: string;
  readonly x: number;
  readonly depth: number;
  readonly facing: "left" | "right";
  readonly scale: number;
  readonly mood: "notr" | "coskulu" | "korkmus";
  /** Idle phase seed so copies do not move in step. */
  readonly seed: number;
  /** A march or run (frames of the shot): from `start` to `end` the extra goes from `x` to `toX`, then stays there. */
  readonly move?: { readonly start: number; readonly end: number; readonly toX: number; readonly run: boolean };
}

/** A short line (joke, punchline, key phrase) in a comic speech bubble above the speaking character. */
export interface V3Bubble {
  readonly castId: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** Name and role under a character the first time they speak in the episode. */
export interface V3NameTag {
  readonly castId: string;
  readonly name: string;
  readonly role?: string;
  readonly start: number;
  readonly end: number;
}

/**
 * A period image (painting, engraving, map, period photo) shown full frame over the set while the narrator
 * speaks, with a small source plate — the documentary cutaway. Characters keep acting underneath.
 */
export interface V3Insert {
  readonly src: string;
  readonly start: number;
  readonly end: number;
  readonly kenBurns: { readonly fromZoom: number; readonly toZoom: number; readonly fromX: number; readonly toX: number };
  /** Source plate, e.g. "Rumelihisarı, engraving by W. H. Bartlett (1838)". */
  readonly caption?: string;
}

/** A drawn map (Natural Earth), already projected into frame pixels; things appear at `start` (shot frame). */
export interface V3GeoMap {
  readonly land: string;
  readonly lakes: string;
  readonly rivers: string;
  /**
   * `end`: the frame it fades out from (a border change). `labelSize`: the name's height on a 1080p screen, by the
   * state's size (absent: 46). The period's other states colour the map without a name (`label` empty, no anchor).
   */
  /** `border`: the state's own outline when it is built from provinces (the fill `d` then has their inner edges). */
  /**
   * `spread`: a conquest — the state's land in bands by distance from where the army came; each band comes in after
   * `delay` (0..1, a share of the sweep's time) from `start`, so the colour sweeps across like a front.
   */
  readonly territories: readonly { readonly d: string; readonly border?: string; readonly color: string; readonly label: string; readonly labelX?: number; readonly labelY?: number; readonly labelSize?: number; readonly start: number; readonly end?: number; readonly spread?: readonly { readonly d: string; readonly delay: number }[]; readonly covered?: { readonly start: number; readonly delay: number } }[];
  readonly cities: readonly { readonly x: number; readonly y: number; readonly label: string }[];
  /** `path`: an army that marches (first point = where it stands) from `moveStart`, leaving a dotted trail. */
  readonly armies: readonly { readonly x: number; readonly y: number; readonly label: string; readonly color: string; readonly start: number; readonly path?: readonly { readonly x: number; readonly y: number }[]; readonly moveStart?: number }[];
  /** Lines the story is about (a border river, a wall): drawn glowing, growing from one end, with their name. */
  readonly lines?: readonly { readonly points: readonly { readonly x: number; readonly y: number }[]; readonly label: string; readonly color: string; readonly start: number }[];
  /** `labelX`/`labelY`: where the name stands (off the cities); absent, above the middle point. */
  readonly arrows: readonly { readonly points: readonly { readonly x: number; readonly y: number }[]; readonly color: string; readonly label?: string; readonly labelX?: number; readonly labelY?: number; readonly start: number }[];
  /**
   * Map narration (owner, 21 Oct 2026): the map is a `world` larger than the frame, the camera moves over it. Every
   * coordinate above is then in world pixels; absent, the world is the frame.
   */
  readonly world?: { readonly width: number; readonly height: number };
  /** Camera keys in world pixels: the point at the frame centre and the zoom (1 = the closest view fills the frame). */
  readonly camera?: readonly { readonly frame: number; readonly x: number; readonly y: number; readonly zoom: number }[];
  /** Terrain relief image (public dir) covering the world exactly (Natural Earth, public domain). */
  readonly relief?: string;
  /** Sea names (relief map): spaced italic capitals at the sea's centre, like an atlas. */
  readonly seas?: readonly { readonly x: number; readonly y: number; readonly label: string; readonly size: number }[];
  /** Kilometres per world pixel (the relief map's scale bar). */
  readonly kmPerPx?: number;
  /** Index in `territories` of the story's main state (the script's first): a stronger border. */
  readonly mainTerritory?: number;
  /** Rulers' portrait badges (a cast member's head); with more than one point they travel the path from `moveStart` (default `start`). */
  readonly badges?: readonly { readonly castId: string; readonly label: string; readonly start: number; readonly end?: number; readonly moveStart?: number; readonly path: readonly { readonly x: number; readonly y: number }[] }[];
  readonly battles?: readonly { readonly x: number; readonly y: number; readonly label: string; readonly start: number }[];
}

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
  /** Small "CANLANDIRMA" / "DRAMATIZATION" label: dramatised dialogue is labelled, like the existing documentary rule. */
  readonly dramatized: boolean;
  readonly bubbles?: readonly V3Bubble[];
  readonly nameTags?: readonly V3NameTag[];
  readonly inserts?: readonly V3Insert[];
  readonly extras?: readonly V3Extra[];
  /** A drawn geographic map instead of the background image. */
  readonly geoMap?: V3GeoMap;
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
  /** Burned-in captions; off for finished episodes (speech bubbles + a separate .srt instead). */
  readonly showCaptions: boolean;
  /** On-screen label language (dramatization badge). Default "tr". */
  readonly language?: "tr" | "en";
  /** Mixed soundtrack (voice + music + sfx) relative to the public dir; rendered video carries it for preview. */
  readonly audio?: string;
}
