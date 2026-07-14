import type { AssemblyScene } from "@/types/assembly";
import type { YouTubeChapter, YouTubePackageDraft } from "@/types/youtube";
import type {
  YouTubeGenerationInput,
  YouTubeGenerationResult,
  YouTubeProvider,
} from "./YouTubeProvider";

export class MockYouTubeProvider implements YouTubeProvider {
  readonly name = "mock" as const;
  readonly model = "mock-youtube-package-v1";

  async generatePublishingPackage(
    input: YouTubeGenerationInput,
  ): Promise<YouTubeGenerationResult> {
    return {
      success: true,
      provider: "mock",
      model: this.model,
      draft: createMockYouTubeDraft(input),
    };
  }
}

export function createMockYouTubeDraft(
  input: YouTubeGenerationInput,
): YouTubePackageDraft {
  const title = input.seo.titleSuggestions[0]?.trim() || input.title.trim();
  const tags = unique([
    ...input.seo.tags,
    ...input.seo.keywords,
    "Atölye",
  ]).slice(0, 20);
  const hashtags = unique(
    input.seo.hashtags.map((value) =>
      value.startsWith("#") ? value : `#${value}`,
    ),
  ).slice(0, 10);

  return {
    title,
    description: input.seo.description.trim(),
    tags: tags.length > 0 ? tags : ["Belgesel"],
    hashtags: hashtags.length > 0 ? hashtags : ["#Belgesel"],
    chapters: createChapters(
      input.assembly.scenes,
      input.videoDurationSeconds,
    ),
    pinnedComment: `${title} hakkında sizce en önemli dönüm noktası hangisiydi?`,
    thumbnailText: input.thumbnail.textSuggestion.trim(),
  };
}

function createChapters(
  scenes: AssemblyScene[],
  durationSeconds: number,
): YouTubeChapter[] {
  let elapsed = 0;
  const chapters: YouTubeChapter[] = [];
  for (const scene of scenes) {
    if (elapsed > durationSeconds) break;
    chapters.push({
      startSeconds: elapsed,
      title: scene.notes?.trim() || `Bölüm ${scene.sceneId}`,
    });
    const parsed = parseDuration(scene.duration);
    elapsed += parsed > 0 ? parsed : 1;
  }
  return chapters.length > 0
    ? chapters
    : [{ startSeconds: 0, title: "Başlangıç" }];
}

function parseDuration(value: string) {
  const parts = value.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
  return Math.round(parts[0] ?? 0);
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLocaleLowerCase("tr-TR");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
