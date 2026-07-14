import type { AssemblyScene } from "@/types/assembly";
import type { AudioSection } from "@/types/audio";
import type { ThumbnailData, ThumbnailVariant } from "@/types/thumbnail";
import type { VideoScene } from "@/types/video";
import { deflateSync } from "node:zlib";
import { ThumbnailStorage } from "../ThumbnailStorage";
import type {
  ThumbnailAssetGenerationInput,
  ThumbnailAssetGenerationResult,
  ThumbnailGenerationInput,
  ThumbnailGenerationResult,
  ThumbnailProvider,
} from "./ThumbnailProvider";

export class MockThumbnailProvider implements ThumbnailProvider {
  readonly name = "mock" as const;

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

  async generateThumbnailAsset(
    input: ThumbnailAssetGenerationInput,
  ): Promise<ThumbnailAssetGenerationResult> {
    const assetId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    try {
      const saved = ThumbnailStorage.saveThumbnail({
        projectSlug: input.projectSlug,
        assetId,
        data: createDeterministicThumbnailPng(1280, 720),
        mimeType: "image/png",
      });

      return {
        success: true,
        assetId,
        provider: "mock",
        model: "mock-thumbnail-image",
        status: "generated",
        generationMode: "mock",
        createdAt,
        ...saved,
      };
    } catch {
      return {
        success: false,
        assetId,
        provider: "mock",
        model: "mock-thumbnail-image",
        status: "failed",
        createdAt,
        error: "Mock thumbnail generation failed.",
      };
    }
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

function createDeterministicThumbnailPng(width: number, height: number) {
  const rowLength = width * 3 + 1;
  const raw = Buffer.alloc(rowLength * height);

  for (let y = 0; y < height; y++) {
    const row = y * rowLength;
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const offset = row + 1 + x * 3;
      raw[offset] = 18 + Math.floor((x / width) * 42);
      raw[offset + 1] = 24 + Math.floor((y / height) * 32);
      raw[offset + 2] = 48 + Math.floor(((x + y) / (width + height)) * 72);
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, "ascii");
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return result;
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
