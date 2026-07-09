import type { AssemblyScene } from "@/types/assembly";
import type { AudioSection } from "@/types/audio";
import type { ThumbnailData, ThumbnailVariant } from "@/types/thumbnail";
import type { VideoScene } from "@/types/video";
import type {
  ThumbnailGenerationInput,
  ThumbnailGenerationResult,
  ThumbnailProvider,
} from "./ThumbnailProvider";

export class MockThumbnailProvider implements ThumbnailProvider {
  async generateThumbnailPlan(
    input: ThumbnailGenerationInput,
  ): Promise<ThumbnailGenerationResult> {
    const thumbnail = createMockThumbnailData(input);

    return {
      provider: "mock",
      model: "mock-thumbnail-planner",
      status: "planned",
      thumbnail,
    };
  }
}

export function createMockThumbnailData(
  input: ThumbnailGenerationInput,
): ThumbnailData {
  const now = new Date().toISOString();
  const title = input.title || input.assembly?.title || input.projectSlug || "Atolye";
  const subject = inferMainSubject(input);
  const primaryScene = input.assembly?.scenes[0];
  const primaryAudio = input.audio?.sections[0];
  const baseComposition =
    primaryScene?.notes ||
    primaryScene?.visualReference ||
    "Merkezde guclu ana konu, arka planda sinematik belgesel atmosferi";
  const variants = buildVariants(title, subject, input);
  const primaryVariant = variants[0];

  return {
    projectId: input.projectId,
    slug: input.projectSlug,
    provider: "mock",
    model: "mock-thumbnail-planner",
    status: "planned",
    sourceAssemblyAssetId: input.assembly?.outputAssetId,
    sourceVideoAssetId: input.video?.outputAssetId ?? input.assembly?.sourceVideoAssetId,
    sourceAudioAssetId: input.audio?.outputAssetId ?? input.assembly?.sourceAudioAssetId,
    variants,
    titleIdea: primaryVariant.title,
    concept: primaryVariant.concept,
    mainSubject: subject,
    composition: primaryVariant.composition || baseComposition,
    colorStyle: primaryAudio?.emotion
      ? `${primaryAudio.emotion} duygu, yuksek kontrast belgesel renkleri`
      : "Yuksek kontrastli sinematik belgesel renkleri",
    textSuggestion: primaryVariant.textOverlaySuggestion,
    imagePrompt: primaryVariant.prompt,
    clickReason:
      "Assembly, video ve audio planindan gelen ana gerilim tek karede toplandigi icin konu hizli anlasilir ve merak uyandirir.",
    generation: {
      provider: "mock",
      model: "mock-thumbnail-planner",
      status: "planned",
    },
    createdAt: now,
    updatedAt: now,
  };
}

function buildVariants(
  title: string,
  subject: string,
  input: ThumbnailGenerationInput,
): ThumbnailVariant[] {
  const scene = input.assembly?.scenes[0];
  const strongestScene = findStrongestScene(input.assembly?.scenes);
  const audio = input.audio?.sections[0];
  const video = input.video?.scenes[0];
  const sourceLine = buildSourceLine(scene, video, audio);

  return [
    {
      id: "mock-variant-hero",
      title: `${subject} Gercegi`,
      concept:
        "Ana karakter ya da konu merkezde, arka planda final videonun en dramatik sahne hissi.",
      prompt: [
        `YouTube documentary thumbnail for "${title}" about ${subject}.`,
        "Strong central subject, cinematic realistic lighting, high contrast, 16:9.",
        sourceLine,
      ].join(" "),
      negativePrompt:
        "low quality, blurry, distorted face, extra fingers, unreadable text, cluttered layout, misleading imagery",
      style: "documentary",
      composition:
        scene?.visualReference ||
        "Merkez kompozisyon, yuz veya ana obje buyuk, arka planda derinlikli atmosfer",
      textOverlaySuggestion: createOverlayText(subject),
      priority: 1,
      status: "planned",
    },
    {
      id: "mock-variant-conflict",
      title: `${subject} Donum Noktasi`,
      concept:
        "Sol tarafta ana konu, sag tarafta karsi guc veya dramatik sonuc; net bir gerilim kurar.",
      prompt: [
        `Split-composition cinematic thumbnail about ${subject}.`,
        "Dramatic before-after tension, sharp rim light, documentary realism, bold negative space for Turkish text.",
        strongestScene?.notes || strongestScene?.transition || "",
      ].join(" "),
      negativePrompt:
        "flat lighting, generic stock photo, crowded background, tiny subject, fake UI, watermark",
      style: "dramatic",
      composition:
        "Iki bolgeli kompozisyon, ana konu solda buyuk, sagda dramatik arka plan ve metin alani",
      textOverlaySuggestion: "NE OLDU?",
      priority: 2,
      status: "planned",
    },
    {
      id: "mock-variant-mystery",
      title: `${subject} Sirri`,
      concept:
        "Yakindan bakis, golge ve tek sembolik detay ile merak odakli kapak alternatifi.",
      prompt: [
        `Mystery-focused historical documentary thumbnail about ${subject}.`,
        "Close-up subject detail, dark cinematic shadows, warm highlight, clean layout, 16:9.",
        audio?.emotion ? `Narration emotion: ${audio.emotion}.` : "",
      ].join(" "),
      negativePrompt:
        "overexposed, noisy, cartoonish, messy typography, unrelated objects, duplicate faces",
      style: "mystery",
      composition:
        "Yakin plan ana detay, arka planda karanlik doku, sag ustte kisa metin icin temiz alan",
      textOverlaySuggestion: "GIZLI GERCEK",
      priority: 3,
      status: "planned",
    },
  ];
}

function inferMainSubject(input: ThumbnailGenerationInput): string {
  const title = input.title || input.assembly?.title;

  if (title?.trim()) {
    return title.trim();
  }

  const firstAudioTitle = input.audio?.sections[0]?.title;

  if (firstAudioTitle?.trim()) {
    return firstAudioTitle.trim();
  }

  return input.projectSlug || "Ana konu";
}

function findStrongestScene(
  scenes: AssemblyScene[] | undefined,
): AssemblyScene | undefined {
  if (!scenes || scenes.length === 0) {
    return undefined;
  }

  return (
    scenes.find((scene) => scene.effects.length > 0 || scene.notes?.trim()) ??
    scenes[0]
  );
}

function buildSourceLine(
  scene: AssemblyScene | undefined,
  video: VideoScene | undefined,
  audio: AudioSection | undefined,
): string {
  const parts = [
    scene?.videoAssetId ? `video asset ${scene.videoAssetId}` : undefined,
    video?.sourceAnimationAssetId
      ? `animation source ${video.sourceAnimationAssetId}`
      : undefined,
    audio?.emotion ? `audio emotion ${audio.emotion}` : undefined,
  ].filter(Boolean);

  return parts.length > 0
    ? `Use production cues from ${parts.join(", ")}.`
    : "Use the available assembly, video and audio plan as production context.";
}

function createOverlayText(subject: string): string {
  return subject
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(" ")
    .toUpperCase() || "GERCEK";
}
