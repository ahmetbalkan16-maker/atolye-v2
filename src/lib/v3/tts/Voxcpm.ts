import type { V3Emotion } from "../render/RenderPlanTypes";
import type { TtsLanguage, TtsProviderId, VoiceProfile } from "./Tts";

/**
 * VoxCPM2 (OpenBMB, Apache-2.0, local; owner approval 20 Oct 2026): acted voices — every line is cloned from the
 * character's own reference clip (consistent timbre) with a style instruction for the line's emotion. A voice without
 * the owner's recording gets its reference designed once from its description and kept. Off until the owner has
 * listened and chosen it (`ATOLYE_V3_TTS_EN=voxcpm`, `ATOLYE_V3_TTS_TR=voxcpm`).
 */
export const VOXCPM_MODEL_ID = "openbmb/VoxCPM2";

/** How the line is played, as VoxCPM's parenthesised style instruction (empty for a neutral line). */
const STYLE: Readonly<Record<V3Emotion, string>> = {
  notr: "",
  mutlu: "cheerful, upbeat tone",
  kizgin: "angry, raised voice",
  saskin: "surprised, astonished",
  korkmus: "scared, trembling voice",
  uzgun: "sad, slower and softer",
  kararli: "determined, firm",
  sinsi: "sly, scheming, quieter",
};

export function voxcpmStyle(emotion: V3Emotion): string {
  return STYLE[emotion] ?? "";
}

/** The line as VoxCPM reads it: the style instruction in parentheses first, then the words. */
export function voxcpmText(text: string, emotion: V3Emotion): string {
  const style = voxcpmStyle(emotion);
  return style ? `(${style})${text}` : text;
}

/**
 * The voice description a reference clip is designed from: the explicit one, else the voice's description before
 * its role list ("young, confident, energetic man: a young ruler…"), with the accent the voice has.
 */
export function voxcpmDescription(voice: Pick<VoiceProfile, "voxcpm_tarif" | "tarif" | "dil" | "kokoro_ses">): string | undefined {
  if (voice.voxcpm_tarif?.trim()) return voice.voxcpm_tarif.trim();
  const base = voice.tarif?.split(":")[0]?.trim();
  if (!base) return undefined;
  const british = /british/i.test(voice.tarif ?? "") || /^b[mf]_/.test(voice.kokoro_ses ?? "");
  const accent = voice.dil === "en" ? (british ? "British English accent" : "American English accent") : "Turkish speaker";
  return `${base.replace(/\s*British-accented\s*/i, " ").replace(/\s+/g, " ").trim()}, ${accent}, clear studio recording`;
}

/** A neutral sentence the designed reference clip says (its transcript is kept with it). */
export const REFERENCE_TEXT: Readonly<Record<TtsLanguage, string>> = {
  en: "Well, here is how I usually sound when I tell a story, calmly and at an ordinary pace.",
  tr: "Ben genellikle bir hikâye anlatırken böyle konuşurum, sakin ve olağan bir hızla.",
};

/**
 * Which engine reads a line: VoxCPM when the owner turned it on for the language, it has not failed in this run and
 * the voice can be cloned (the owner's recording) or designed (a description); else the voice's own engine.
 */
export function chooseEngine(voice: VoiceProfile, language: TtsLanguage, prefer: ReadonlySet<TtsLanguage>, voxcpmOff: boolean): TtsProviderId {
  if (!prefer.has(language) || voxcpmOff) return voice.saglayici;
  return voice.referans || voxcpmDescription(voice) ? "voxcpm" : voice.saglayici;
}

/** Languages the owner turned VoxCPM on for (`ATOLYE_V3_TTS_EN=voxcpm`, `ATOLYE_V3_TTS_TR=voxcpm`). */
export function voxcpmLanguages(env: Readonly<Record<string, string | undefined>> = process.env): Set<TtsLanguage> {
  const out = new Set<TtsLanguage>();
  if (env.ATOLYE_V3_TTS_EN === "voxcpm") out.add("en");
  if (env.ATOLYE_V3_TTS_TR === "voxcpm") out.add("tr");
  return out;
}
