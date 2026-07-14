import type {
  YouTubeChapter,
  YouTubePackageDraft,
  YouTubeProviderName,
  YouTubePublishingPackage,
} from "@/types/youtube";

export const MAX_TITLE_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 5_000;
export const MAX_TAG_COUNT = 50;
export const MAX_TAG_LENGTH = 100;
export const MAX_HASHTAG_COUNT = 15;
export const MAX_HASHTAG_LENGTH = 100;
export const MAX_CHAPTER_COUNT = 100;
export const MAX_CHAPTER_TITLE_LENGTH = 100;
export const MAX_PINNED_COMMENT_LENGTH = 1_000;
export const MAX_THUMBNAIL_TEXT_LENGTH = 100;

const SAFE_SEGMENT = /^[a-zA-Z0-9-_]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

export class YouTubePackageValidationError extends Error {
  readonly code = "YOUTUBE_PACKAGE_INVALID";

  constructor() {
    super("YouTube package is invalid.");
    this.name = "YouTubePackageValidationError";
    this.stack = undefined;
  }
}

export function normalizeYouTubePackageDraft(
  value: unknown,
  videoDurationSeconds: number,
): YouTubePackageDraft {
  try {
    const draft = requireRecord(value);
    const title = normalizeText(draft.title, MAX_TITLE_LENGTH);
    const description = normalizeText(
      draft.description,
      MAX_DESCRIPTION_LENGTH,
    );
    const pinnedComment = normalizeText(
      draft.pinnedComment,
      MAX_PINNED_COMMENT_LENGTH,
    );
    const thumbnailText = normalizeText(
      draft.thumbnailText,
      MAX_THUMBNAIL_TEXT_LENGTH,
    );
    const tags = normalizeTags(draft.tags);
    const hashtags = normalizeHashtags(draft.hashtags);
    const chapters = normalizeChapters(draft.chapters, videoDurationSeconds);

    return {
      title,
      description,
      tags,
      hashtags,
      chapters,
      pinnedComment,
      thumbnailText,
    };
  } catch {
    throw new YouTubePackageValidationError();
  }
}

export function isYouTubePublishingPackage(
  value: unknown,
): value is YouTubePublishingPackage {
  try {
    validateYouTubePublishingPackage(value);
    return true;
  } catch {
    return false;
  }
}

export function validateYouTubePublishingPackage(
  value: unknown,
  expected?: {
    projectId?: string;
    slug?: string;
    videoAssetId?: string;
    thumbnailAssetId?: string;
    videoDurationSeconds?: number;
  },
): asserts value is YouTubePublishingPackage {
  try {
    const candidate = requireRecord(value);
    const allowedKeys = new Set([
      "schemaVersion", "projectId", "slug", "provider", "model", "status",
      "title", "description", "tags", "hashtags", "chapters",
      "pinnedComment", "thumbnailText", "videoAssetId", "thumbnailAssetId",
      "generatedAt",
    ]);
    if (
      Object.keys(candidate).some((key) => !allowedKeys.has(key)) ||
      candidate.schemaVersion !== "1" ||
      candidate.status !== "generated" ||
      !isProviderName(candidate.provider) ||
      typeof candidate.projectId !== "string" ||
      !candidate.projectId.trim() ||
      typeof candidate.slug !== "string" ||
      !SAFE_SEGMENT.test(candidate.slug) ||
      typeof candidate.videoAssetId !== "string" ||
      !candidate.videoAssetId.trim() ||
      typeof candidate.thumbnailAssetId !== "string" ||
      !candidate.thumbnailAssetId.trim() ||
      typeof candidate.generatedAt !== "string" ||
      !Number.isFinite(Date.parse(candidate.generatedAt)) ||
      (candidate.model !== undefined &&
        (typeof candidate.model !== "string" || !candidate.model.trim())) ||
      (expected?.projectId !== undefined &&
        candidate.projectId !== expected.projectId) ||
      (expected?.slug !== undefined && candidate.slug !== expected.slug) ||
      (expected?.videoAssetId !== undefined &&
        candidate.videoAssetId !== expected.videoAssetId) ||
      (expected?.thumbnailAssetId !== undefined &&
        candidate.thumbnailAssetId !== expected.thumbnailAssetId)
    ) {
      throw new Error("invalid");
    }

    const normalized = normalizeYouTubePackageDraft(
      candidate,
      expected?.videoDurationSeconds ?? Number.MAX_SAFE_INTEGER,
    );
    if (
      candidate.title !== normalized.title ||
      candidate.description !== normalized.description ||
      candidate.pinnedComment !== normalized.pinnedComment ||
      candidate.thumbnailText !== normalized.thumbnailText ||
      !sameStrings(candidate.tags, normalized.tags) ||
      !sameStrings(candidate.hashtags, normalized.hashtags) ||
      !sameChapters(candidate.chapters, normalized.chapters)
    ) {
      throw new Error("invalid");
    }
  } catch {
    throw new YouTubePackageValidationError();
  }
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TAG_COUNT) {
    throw new Error("invalid");
  }
  return deduplicate(
    value.map((item) => normalizeText(item, MAX_TAG_LENGTH)),
  );
}

function normalizeHashtags(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_HASHTAG_COUNT
  ) {
    throw new Error("invalid");
  }
  const normalized = value.map((item) => {
    const text = normalizeText(item, MAX_HASHTAG_LENGTH);
    const withoutPrefix = text.replace(/^#+/u, "");
    if (!withoutPrefix || /\s/u.test(withoutPrefix)) throw new Error("invalid");
    const hashtag = `#${withoutPrefix}`;
    if (hashtag.length > MAX_HASHTAG_LENGTH) throw new Error("invalid");
    return hashtag;
  });
  return deduplicate(normalized);
}

function normalizeChapters(
  value: unknown,
  videoDurationSeconds: number,
): YouTubeChapter[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_CHAPTER_COUNT ||
    !Number.isFinite(videoDurationSeconds) ||
    videoDurationSeconds <= 0
  ) {
    throw new Error("invalid");
  }
  let previous = -1;
  return value.map((item, index) => {
    const chapter = requireRecord(item);
    if (
      !Number.isSafeInteger(chapter.startSeconds) ||
      (chapter.startSeconds as number) < 0 ||
      (index === 0 && chapter.startSeconds !== 0) ||
      (chapter.startSeconds as number) <= previous ||
      (chapter.startSeconds as number) > videoDurationSeconds
    ) {
      throw new Error("invalid");
    }
    previous = chapter.startSeconds as number;
    return {
      startSeconds: chapter.startSeconds as number,
      title: normalizeText(chapter.title, MAX_CHAPTER_TITLE_LENGTH),
    };
  });
}

function normalizeText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") throw new Error("invalid");
  if (CONTROL_CHARACTERS.test(value)) throw new Error("invalid");
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > maximumLength) throw new Error("invalid");
  return normalized;
}

function deduplicate(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid");
  }
  return value as Record<string, unknown>;
}

function isProviderName(value: unknown): value is YouTubeProviderName {
  return value === "mock" || value === "openai";
}

function sameStrings(value: unknown, expected: string[]) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function sameChapters(value: unknown, expected: YouTubeChapter[]) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const chapter = item as Record<string, unknown>;
      return (
        Object.keys(chapter).length === 2 &&
        chapter.startSeconds === expected[index].startSeconds &&
        chapter.title === expected[index].title
      );
    })
  );
}
