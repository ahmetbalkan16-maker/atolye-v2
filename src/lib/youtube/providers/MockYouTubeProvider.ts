import type { AssemblyScene } from "@/types/assembly";
import type { AudioSection } from "@/types/audio";
import type { ThumbnailVariant } from "@/types/thumbnail";
import type {
  YouTubeAssetReferences,
  YouTubeChapter,
  YouTubeMetadata,
  YouTubePublishChecklist,
  YouTubePublishingPackage,
} from "@/types/youtube";
import type {
  YouTubeGenerationInput,
  YouTubeGenerationResult,
  YouTubeProvider,
} from "./YouTubeProvider";

export class MockYouTubeProvider implements YouTubeProvider {
  async generatePublishingPackage(
    input: YouTubeGenerationInput,
  ): Promise<YouTubeGenerationResult> {
    const publishingPackage = createMockYouTubePackage(input);

    return {
      provider: "mock",
      model: "mock-youtube-publisher",
      status: "planned",
      package: publishingPackage,
    };
  }
}

export function createMockYouTubePackage(
  input: YouTubeGenerationInput,
): YouTubePublishingPackage {
  const now = new Date().toISOString();
  const title = createTitle(input);
  const selectedThumbnail = selectThumbnailVariant(input.thumbnail?.variants);
  const assetReferences = createAssetReferences(input, selectedThumbnail);
  const chapters = createChapters(input.assembly?.scenes, input.audio?.sections);
  const metadata = createMetadata(input, title, chapters);
  const checklist = createChecklist(input, metadata, assetReferences);

  return {
    projectId: input.projectId,
    slug: input.projectSlug,
    provider: "mock",
    model: "mock-youtube-publisher",
    status: "planned",
    metadata,
    chapters,
    assetReferences,
    checklist,
    notes: createNotes(input, checklist),
    createdAt: now,
    updatedAt: now,
  };
}

function createTitle(input: YouTubeGenerationInput): string {
  const sourceTitle =
    input.title ||
    input.assembly?.title ||
    input.thumbnail?.titleIdea ||
    input.audio?.sections[0]?.title ||
    input.projectSlug ||
    "Atolye Belgeseli";

  return limitText(`${sourceTitle} | Belgesel`, 95);
}

function createMetadata(
  input: YouTubeGenerationInput,
  title: string,
  chapters: YouTubeChapter[],
): YouTubeMetadata {
  const thumbnailText = input.thumbnail?.textSuggestion;
  const totalDuration =
    input.assembly?.totalDuration ||
    input.audio?.production.estimatedTotalDuration ||
    "planlandi";
  const descriptionParts = [
    `${title}`,
    "",
    `Bu yayin paketi Atolye uretim hattindaki video, ses, kurgu ve thumbnail planindan mock-first olarak hazirlandi.`,
    `Tahmini sure: ${totalDuration}.`,
    thumbnailText ? `Thumbnail metin onerisi: ${thumbnailText}.` : undefined,
    chapters.length > 0 ? "Bolumler aciklama alanina eklendi." : undefined,
  ].filter((part): part is string => typeof part === "string");

  return {
    title,
    description: descriptionParts.join("\n"),
    tags: createTags(input),
    category: "Education",
    language: input.audio?.narrator.language || "tr",
    visibility: "private",
    audience: "not-made-for-kids",
  };
}

function createTags(input: YouTubeGenerationInput): string[] {
  const titleWords = [
    input.title,
    input.assembly?.title,
    input.thumbnail?.mainSubject,
    input.thumbnail?.titleIdea,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .flatMap((value) => value.split(/\s+/))
    .map((value) => normalizeTag(value))
    .filter(Boolean);
  const productionTags = [
    "belgesel",
    "tarih",
    "atolye",
    "turkce",
    input.assembly?.style,
    input.audio?.music.mood,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => normalizeTag(value))
    .filter(Boolean);

  return Array.from(new Set([...titleWords, ...productionTags])).slice(0, 12);
}

function createChapters(
  scenes: AssemblyScene[] | undefined,
  sections: AudioSection[] | undefined,
): YouTubeChapter[] {
  const sourceScenes = scenes && scenes.length > 0 ? scenes : undefined;

  if (sourceScenes) {
    let elapsedSeconds = 0;

    return sourceScenes.map((scene, index) => {
      const chapter: YouTubeChapter = {
        startTime: formatTimestamp(elapsedSeconds),
        title:
          sections?.[index]?.title ||
          scene.notes ||
          `Bolum ${scene.sceneId}`,
        sourceSceneId: scene.sceneId,
      };

      elapsedSeconds += parseDuration(scene.duration);

      return chapter;
    });
  }

  if (!sections) {
    return [];
  }

  let elapsedSeconds = 0;

  return sections.map((section) => {
    const chapter: YouTubeChapter = {
      startTime: formatTimestamp(elapsedSeconds),
      title: section.title,
      sourceSceneId: section.chapterId,
    };

    elapsedSeconds += parseDuration(section.duration);

    return chapter;
  });
}

function createAssetReferences(
  input: YouTubeGenerationInput,
  selectedThumbnail: ThumbnailVariant | undefined,
): YouTubeAssetReferences {
  return {
    videoAssetId: input.video?.outputAssetId ?? input.assembly?.sourceVideoAssetId,
    audioAssetId: input.audio?.outputAssetId ?? input.assembly?.sourceAudioAssetId,
    assemblyAssetId: input.assembly?.outputAssetId,
    thumbnailVariantId: selectedThumbnail?.id,
    thumbnailImageUrl: input.thumbnail?.generation?.imageUrl,
  };
}

function createChecklist(
  input: YouTubeGenerationInput,
  metadata: YouTubeMetadata,
  assetReferences: YouTubeAssetReferences,
): YouTubePublishChecklist {
  const hasVideo = Boolean(assetReferences.videoAssetId);
  const hasAudio = Boolean(assetReferences.audioAssetId);
  const hasAssembly = Boolean(input.assembly);
  const hasThumbnail = Boolean(input.thumbnail?.variants.length);
  const hasTitle = Boolean(metadata.title.trim());
  const hasDescription = Boolean(metadata.description.trim());
  const hasTags = metadata.tags.length > 0;

  return {
    hasVideo,
    hasAudio,
    hasAssembly,
    hasThumbnail,
    hasTitle,
    hasDescription,
    hasTags,
    readyToPublish:
      hasVideo &&
      hasAudio &&
      hasAssembly &&
      hasThumbnail &&
      hasTitle &&
      hasDescription &&
      hasTags,
  };
}

function createNotes(
  input: YouTubeGenerationInput,
  checklist: YouTubePublishChecklist,
): string[] {
  const notes = [
    "Mock-first YouTube yayin paketi hazirlandi; gercek YouTube API, OAuth veya upload kullanilmadi.",
  ];

  if (!checklist.readyToPublish) {
    notes.push("Eksik kaynaklar tamamlanmadan paket yayina hazir kabul edilmez.");
  }

  if (!input.thumbnail?.generation?.imageUrl) {
    notes.push("Gercek thumbnail gorseli yok; paket thumbnail varyant referansi tasir.");
  }

  return notes;
}

function selectThumbnailVariant(
  variants: ThumbnailVariant[] | undefined,
): ThumbnailVariant | undefined {
  if (!variants || variants.length === 0) {
    return undefined;
  }

  return [...variants].sort((a, b) => a.priority - b.priority)[0];
}

function normalizeTag(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ]+/gi, "")
    .trim();
}

function limitText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function parseDuration(value: string): number {
  const parts = value.split(":").map((part) => Number.parseInt(part, 10));

  if (parts.some((part) => Number.isNaN(part))) {
    return 30;
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return parts[0] || 30;
}

function formatTimestamp(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      seconds,
    ).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
